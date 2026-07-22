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
    let custom = [], progress = {}, deleted = {};
    try { custom = JSON.parse(localStorage.getItem(CUSTOM_KEY)) || []; } catch (e) {}
    try { progress = JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {}; } catch (e) {}
    try { deleted = JSON.parse(localStorage.getItem(DELETED_KEY)) || {}; } catch (e) {}
    return { custom, progress, deleted, t: Date.now() };
  }
  function writeLocal(data) {
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(data.custom)); } catch (e) {}
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(data.progress)); } catch (e) {}
    try { localStorage.setItem(DELETED_KEY, JSON.stringify(data.deleted || {})); } catch (e) {}
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
    return { custom, progress, deleted, t: Date.now() };
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

  return {
    enabled,
    user: () => (session ? session.user : null),
    state: () => lastState,
    onStatus: (cb) => { statusCb = cb; },
    signup, login, logout,
    init, pullMerge, schedulePush, pushNow,
    mergeData, localData, writeLocal, // 백업 가져오기에서도 재사용
  };
})();
