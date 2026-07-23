/*
 * cloud.js
 * 간단 회원가입/로그인 + 기기 간 동기화 (Supabase REST 직접 호출, SDK 없음).
 *
 * - 로그인하면 도안/진행상황을 클라우드에 자동 저장(4초 디바운스)
 * - 앱 시작 시 클라우드 내용을 내려받아 로컬과 병합
 * - 설정(cloud-config.js)이 비어 있으면 전부 비활성 — 로컬 저장만 사용
 *
 * 데이터: user_data 테이블에 사용자당 1행 { user_id, payload(jsonb) }
 * payload = { custom: [도안...], progress: {도안id: [칠한 index...]}, t: 저장시각 }
 */
window.Cloud = (function () {
  const CFG = window.CLOUD_CONFIG || {};
  const enabled = !!(CFG.url && CFG.anonKey);
  const SESSION_KEY = "coloring:cloud:session:v1";
  const CUSTOM_KEY = "coloring:custom:v1";
  const PROGRESS_KEY = "coloring:progress:v1";
  const DELETED_KEY = "coloring:deleted:v1"; // { 도안id: 삭제시각 } — 삭제 전파용
  const STATS_KEY = "coloring:stats:v1";
  const BRUSHES_KEY = "coloring:brushes:v1"; // { 도안id: { 조각index: 브러시 } }

  let session = null; // { access_token, refresh_token, expires_at, user:{id,email} }
  let pushTimer = null;
  let statusCb = null; // (state, detail) => void  state: 'off'|'out'|'syncing'|'synced'|'error'
  let lastState = "out";

  try { session = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) {}

  function setStatus(state, detail) {
    lastState = state;
    if (statusCb) statusCb(state, detail || "");
  }

  function saveSession(s) {
    session = s;
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  }

  async function authFetch(path, body) {
    const res = await fetch(CFG.url + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: CFG.anonKey },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.error_description || data.msg || data.message || ("오류 " + res.status);
      throw new Error(msg);
    }
    return data;
  }

  function sessionFrom(data) {
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      user: { id: data.user.id, email: data.user.email },
    };
  }

  // 액세스 토큰으로 사용자 정보 조회(소셜 로그인은 응답에 user가 없음)
  async function fetchUser(accessToken) {
    const res = await fetch(CFG.url + "/auth/v1/user", {
      headers: { apikey: CFG.anonKey, Authorization: "Bearer " + accessToken },
    });
    if (!res.ok) throw new Error("사용자 정보를 가져오지 못했어요");
    return res.json();
  }

  async function signup(email, password) {
    const data = await authFetch("/auth/v1/signup", { email, password });
    if (data.access_token) {
      saveSession(sessionFrom(data));
      await pullMerge();
      schedulePush(0);
      return { loggedIn: true };
    }
    // 이메일 확인이 켜져 있는 프로젝트면 세션 없이 응답됨
    return { loggedIn: false, needConfirm: true };
  }

  async function login(email, password) {
    const data = await authFetch("/auth/v1/token?grant_type=password", { email, password });
    saveSession(sessionFrom(data));
    await pullMerge();
    schedulePush(0);
  }

  function logout() {
    saveSession(null);
    setStatus("out");
  }

  /* ── 소셜 로그인 (Google · Kakao) — Supabase OAuth ──
     웹: authorize로 이동 → 돌아오면 URL #해시에 토큰 → checkOAuthRedirect가 처리
     앱: 시스템 브라우저로 열고 커스텀 스킴 딥링크로 토큰 수신 */
  function oauthUrl(provider, redirectTo) {
    let u =
      CFG.url + "/auth/v1/authorize?provider=" + encodeURIComponent(provider) +
      "&redirect_to=" + encodeURIComponent(redirectTo);
    // 카카오: 개인(비즈 아님) 앱은 이메일 동의항목을 못 켬(account_email → KOE205).
    // 닉네임만 요청해서 개인 앱에서도 로그인되게 한다.
    if (provider === "kakao") u += "&scopes=profile_nickname";
    return u;
  }

  async function completeOAuth(params) {
    const accessToken = params.get("access_token");
    if (!accessToken) {
      const err = params.get("error_description") || params.get("error");
      if (err) throw new Error(decodeURIComponent(err.replace(/\+/g, " ")));
      return false;
    }
    const user = await fetchUser(accessToken);
    saveSession({
      access_token: accessToken,
      refresh_token: params.get("refresh_token"),
      expires_at: Date.now() + (parseInt(params.get("expires_in") || "3600", 10)) * 1000,
      user: { id: user.id, email: user.email },
    });
    await pullMerge();
    schedulePush(0);
    return true;
  }

  // 앱 시작 시 1회: 소셜 로그인 후 돌아온 URL(#access_token=...)이면 세션 확립
  async function checkOAuthRedirect() {
    if (!enabled) return false;
    const hash = location.hash || "";
    if (hash.indexOf("access_token=") < 0 && hash.indexOf("error=") < 0) return false;
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    history.replaceState(null, "", location.pathname + location.search); // 해시 정리
    try {
      return await completeOAuth(params);
    } catch (e) {
      setStatus("error", e.message);
      throw e;
    }
  }

  async function oauth(provider) {
    if (!enabled) throw new Error("클라우드가 설정되지 않았어요");
    const Cap = window.Capacitor;
    const native = Cap && typeof Cap.isNativePlatform === "function" && Cap.isNativePlatform();
    if (native) return oauthNative(provider);
    // 웹: 현재 페이지로 되돌아오게 하고 이동(반환 없음 — 페이지 전환됨)
    location.href = oauthUrl(provider, location.origin + location.pathname);
    return new Promise(() => {});
  }

  // 앱(Capacitor): 시스템 브라우저 + 커스텀 스킴 딥링크로 토큰 회수
  async function oauthNative(provider) {
    const Cap = window.Capacitor;
    const Browser = Cap.Plugins && Cap.Plugins.Browser;
    const App = Cap.Plugins && Cap.Plugins.App;
    if (!Browser || !App) throw new Error("브라우저 플러그인이 없어요");
    const redirectTo = "io.github.icebrain78.coloring://login-callback";
    return new Promise((resolve, reject) => {
      let handle = null;
      const finish = (fn, arg) => {
        if (handle && handle.remove) handle.remove();
        Browser.close().catch(() => {});
        fn(arg);
      };
      App.addListener("appUrlOpen", async (data) => {
        const url = (data && data.url) || "";
        if (url.indexOf("login-callback") < 0) return;
        const hi = url.indexOf("#");
        if (hi < 0) { finish(reject, new Error("로그인 응답이 올바르지 않아요")); return; }
        try {
          const ok = await completeOAuth(new URLSearchParams(url.substring(hi + 1)));
          finish(resolve, ok);
        } catch (e) { finish(reject, e); }
      }).then((h) => { handle = h; });
      Browser.open({ url: oauthUrl(provider, redirectTo) }).catch((e) => finish(reject, e));
    });
  }

  async function ensureToken() {
    if (!session) throw new Error("로그인이 필요해요");
    if (Date.now() < session.expires_at - 60000) return;
    const data = await authFetch("/auth/v1/token?grant_type=refresh_token", {
      refresh_token: session.refresh_token,
    });
    saveSession(sessionFrom(data));
  }

  async function restFetch(method, path, body) {
    await ensureToken();
    const res = await fetch(CFG.url + "/rest/v1" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        apikey: CFG.anonKey,
        Authorization: "Bearer " + session.access_token,
        Prefer: method === "POST" ? "resolution=merge-duplicates,return=minimal" : "",
      },
      body: body == null ? undefined : JSON.stringify(body),
    });
    if (res.status === 401) {
      // 토큰 만료 → 1회 갱신 후 재시도
      session.expires_at = 0;
      await ensureToken();
      return restFetch(method, path, body);
    }
    if (!res.ok) throw new Error("동기화 오류 " + res.status);
    if (method === "GET") return res.json();
    return null;
  }

  /* ── 로컬 데이터 읽기/쓰기 ── */
  function localData() {
    let custom = [], progress = {}, deleted = {}, stats = null, brushes = {};
    // 대용량(도안·브러시)은 IndexedDB(AppDB), 나머지는 localStorage
    if (window.AppDB) {
      custom = window.AppDB.getCustom();
      brushes = window.AppDB.getBrushes();
    }
    try { progress = JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {}; } catch (e) {}
    try { deleted = JSON.parse(localStorage.getItem(DELETED_KEY)) || {}; } catch (e) {}
    try { stats = JSON.parse(localStorage.getItem(STATS_KEY)); } catch (e) {}
    return { custom, progress, deleted, brushes, stats: stats || { pieces: 0, completed: 0, days: {} }, t: Date.now() };
  }
  function writeLocal(data) {
    if (window.AppDB) {
      window.AppDB.setCustom(data.custom || []);
      window.AppDB.setBrushes(data.brushes || {});
    }
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(data.progress)); } catch (e) {}
    try { localStorage.setItem(DELETED_KEY, JSON.stringify(data.deleted || {})); } catch (e) {}
    try { if (data.stats) localStorage.setItem(STATS_KEY, JSON.stringify(data.stats)); } catch (e) {}
  }

  /*
   * 병합 규칙:
   * - 삭제 기록(deleted: id→삭제시각)을 양쪽 합침(더 최근 시각 우선)
   * - 도안: id 기준 합집합, 같은 id면 savedAt이 최신인 쪽.
   *   단, 삭제 시각이 도안 저장 시각보다 나중이면 제외 → 삭제가 모든
   *   기기로 전파되고, 삭제 후 새로 만든 도안(새 id)은 살아남는다.
   * - 진행상황: 도안별로 더 많이 칠한 쪽. 삭제된 도안 것은 버림.
   */
  function mergeData(a, b) {
    const deleted = {};
    [a.deleted || {}, b.deleted || {}].forEach((m) => {
      for (const k in m) deleted[k] = Math.max(deleted[k] || 0, m[k]);
    });
    const byId = {};
    (a.custom || []).concat(b.custom || []).forEach((art) => {
      const prev = byId[art.id];
      if (!prev || (art.savedAt || 0) >= (prev.savedAt || 0)) byId[art.id] = art;
    });
    const custom = Object.values(byId)
      .filter((art) => !((deleted[art.id] || 0) >= (art.savedAt || 0)))
      .sort((x, y) => (y.savedAt || 0) - (x.savedAt || 0))
      .slice(0, 8); // 클라우드 포함 보관 한도
    const alive = new Set(custom.map((c) => c.id));
    const progress = {};
    const keys = new Set(
      Object.keys(a.progress || {}).concat(Object.keys(b.progress || {}))
    );
    keys.forEach((k) => {
      if (deleted[k] && !alive.has(k)) return; // 삭제된 도안의 진행상황
      const pa = (a.progress || {})[k] || [];
      const pb = (b.progress || {})[k] || [];
      progress[k] = pa.length >= pb.length ? pa : pb;
    });
    // 조각별 브러시: 도안별로 합치기(더 많이 칠한 쪽 진행과 자연스럽게 맞음)
    const brushes = {};
    const bKeys = new Set(
      Object.keys(a.brushes || {}).concat(Object.keys(b.brushes || {}))
    );
    bKeys.forEach((k) => {
      if (deleted[k] && !alive.has(k)) return;
      brushes[k] = Object.assign({}, (a.brushes || {})[k], (b.brushes || {})[k]);
    });
    // 통계: 수치는 큰 쪽, 활동일은 합집합
    const sa = a.stats || { pieces: 0, completed: 0, days: {} };
    const sb = b.stats || { pieces: 0, completed: 0, days: {} };
    const stats = {
      pieces: Math.max(sa.pieces || 0, sb.pieces || 0),
      completed: Math.max(sa.completed || 0, sb.completed || 0),
      days: Object.assign({}, sa.days || {}, sb.days || {}),
    };
    return { custom, progress, deleted, brushes, stats, t: Date.now() };
  }

  /* 클라우드에서 내려받아 로컬과 병합 → 로컬 저장 */
  async function pullMerge() {
    if (!enabled || !session) return false;
    setStatus("syncing");
    try {
      const rows = await restFetch(
        "GET",
        "/user_data?select=payload&user_id=eq." + session.user.id
      );
      const remote = rows && rows[0] && rows[0].payload ? rows[0].payload : { custom: [], progress: {} };
      const merged = mergeData(localData(), remote);
      writeLocal(merged);
      setStatus("synced");
      return true;
    } catch (e) {
      setStatus("error", e.message);
      return false;
    }
  }

  async function pushNow() {
    if (!enabled || !session) return;
    setStatus("syncing");
    try {
      await restFetch("POST", "/user_data", [
        { user_id: session.user.id, payload: localData() },
      ]);
      setStatus("synced");
    } catch (e) {
      setStatus("error", e.message);
    }
  }

  /* 저장 이벤트마다 호출 — 4초 디바운스로 묶어서 업로드 */
  function schedulePush(delay) {
    if (!enabled || !session) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, delay == null ? 4000 : delay);
  }

  async function init() {
    if (!enabled) { setStatus("off"); return; }
    if (!session) { setStatus("out"); return; }
    await pullMerge();
  }

  /* ── 도안 공유: shared_art 테이블(누구나 읽기, 본인만 등록/삭제) ── */
  async function shareArt(art) {
    if (!enabled || !session) throw new Error("로그인이 필요해요");
    const id = (art.id + "-" + Date.now().toString(36)).replace(/[^a-z0-9-]/gi, "");
    await restFetch("POST", "/shared_art", [
      { id, owner: session.user.id, title: art.title || "물들임", payload: art },
    ]);
    const base = location.origin + location.pathname;
    return base + "?share=" + encodeURIComponent(id);
  }

  /* 공유받은 도안 가져오기 — 로그인 없이도 가능(anon 읽기) */
  async function fetchShared(id) {
    if (!enabled) throw new Error("클라우드 미설정");
    const res = await fetch(
      CFG.url + "/rest/v1/shared_art?select=title,payload&id=eq." + encodeURIComponent(id),
      { headers: { apikey: CFG.anonKey } }
    );
    if (!res.ok) throw new Error("가져오기 실패 " + res.status);
    const rows = await res.json();
    if (!rows.length) throw new Error("공유 도안을 찾을 수 없어요(삭제됐을 수 있음)");
    return rows[0];
  }

  return {
    enabled,
    user: () => (session ? session.user : null),
    state: () => lastState,
    onStatus: (cb) => { statusCb = cb; },
    signup, login, logout,
    oauth, checkOAuthRedirect,
    init, pullMerge, schedulePush, pushNow,
    shareArt, fetchShared,
    mergeData, localData, writeLocal, // 백업 가져오기에서도 재사용
  };
})();
