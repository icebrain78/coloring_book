/*
 * app.js
 * 화면 전환(갤러리 ↔ 색칠 ↔ 사진변환), 갤러리 렌더, 완성 축하, 서비스워커 등록.
 */
(function () {
  const SVGNS = "http://www.w3.org/2000/svg";
  const APP_VERSION = "v2.8"; // 갤러리에 표시 — 폰이 최신 코드인지 확인용
  const CUSTOM_KEY = "coloring:custom:v1";
  const galleryEl = document.getElementById("gallery");
  const canvasEl = document.getElementById("canvas");
  const converterEl = document.getElementById("converter");
  const overlayEl = document.getElementById("overlay");

  const engine = new ColoringEngine(canvasEl);
  engine.onExit = showGallery;
  engine.onComplete = celebrate;

  /* ── 통계 (총 칠한 칸·완성작·연속 일수) ── */
  const STATS_KEY = "coloring:stats:v1";
  const AppStats = {
    load() {
      try { return JSON.parse(localStorage.getItem(STATS_KEY)) || { pieces: 0, completed: 0, days: {} }; }
      catch (e) { return { pieces: 0, completed: 0, days: {} }; }
    },
    save(s) {
      try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch (e) {}
    },
    today() { return new Date().toISOString().slice(0, 10); },
    paint() {
      const s = this.load();
      s.pieces++;
      s.days[this.today()] = 1;
      this.save(s);
    },
    complete() {
      const s = this.load();
      s.completed++;
      this.save(s);
      Cloud.schedulePush();
    },
    streak() {
      const s = this.load();
      let n = 0;
      const d = new Date();
      while (s.days[d.toISOString().slice(0, 10)]) {
        n++;
        d.setDate(d.getDate() - 1);
      }
      return n;
    },
  };
  window.AppStats = AppStats;

  /* ── 화면 상단 토스트(저장 실패 등 중요 경고) ── */
  window.AppToast = function (msg) {
    let t = document.getElementById("app-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "app-toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), 6000);
  };

  // 앱을 떠나는 순간(홈으로, 새로고침, 탭 전환) 대기 중인 클라우드
  // 업로드를 즉시 실행 — 4초 디바운스 대기 중 이탈로 인한 유실 방지
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && Cloud.enabled && Cloud.user()) Cloud.pushNow();
  });
  window.addEventListener("pagehide", () => {
    if (Cloud.enabled && Cloud.user()) Cloud.pushNow();
  });

  /* ── 완성작 PNG 저장/공유 ── */
  function saveArtImage(art) {
    const vw = art.w || 1000, vh = art.h || 1000;
    const W = 1600;
    const cvs = document.createElement("canvas");
    cvs.width = W;
    cvs.height = Math.round((W * vh) / vw);
    const ctx = cvs.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cvs.width, cvs.height);
    ctx.setTransform(W / vw, 0, 0, W / vw, 0, 0);
    // 사진 도안이면 조각별 브러시(기록) 그대로 내보내기
    const isCur = art.custom && engine.art === art;
    const globalKind = isCur ? engine._brushKind() : "flat";
    const bmap = (isCur && engine.brushMap) || {};
    art.regions.forEach((r, i) => {
      const hex = art.palette[r.c].hex;
      const kind = bmap[i] || globalKind;
      const fill = kind === "flat"
        ? hex
        : ctx.createPattern(engine._brushTile(hex, engine._variantOf(i), kind), "repeat");
      engine._drawRegionOnCtx(ctx, r, fill);
    });
    cvs.toBlob(async (blob) => {
      const file = new File([blob], (art.title || "컬러링") + ".png", { type: "image/png" });
      // 모바일: 공유 시트(카톡 등), 미지원 시 다운로드
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: art.title }); return; } catch (e) {}
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, "image/png");
  }
  window.AppShare = saveArtImage;

  /* ── 내 사진 도안 저장소 (IndexedDB — 용량 제한 사실상 없음) ── */
  function loadCustom() {
    return AppDB.getCustom();
  }
  function saveCustomArt(art) {
    art.savedAt = Date.now(); // 동기화 병합 시 최신 판별용
    const list = loadCustom().slice();
    list.unshift(art);
    while (list.length > 8) list.pop(); // 클라우드 보관 한도와 일치
    AppDB.setCustom(list);
    Cloud.schedulePush();
  }
  function deleteCustom(id) {
    AppDB.setCustom(loadCustom().filter((a) => a.id !== id));
    const prog = ColoringStore.loadAllProgress();
    delete prog[id];
    localStorage.setItem("coloring:progress:v1", JSON.stringify(prog));
    // 삭제 기록 → 다른 기기에서도 지워지도록(병합 시 전파)
    try {
      const del = JSON.parse(localStorage.getItem("coloring:deleted:v1")) || {};
      del[id] = Date.now();
      localStorage.setItem("coloring:deleted:v1", JSON.stringify(del));
    } catch (e) {}
    Cloud.schedulePush();
  }

  /* ── 백업 내보내기/가져오기 (클라우드 설정 없이도 동작) ── */
  function exportBackup() {
    const blob = new Blob([JSON.stringify(Cloud.localData())], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "컬러링백업.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || (!data.custom && !data.progress)) throw new Error("형식이 달라요");
        Cloud.writeLocal(Cloud.mergeData(Cloud.localData(), data));
        Cloud.schedulePush();
        showGallery();
        alert("백업을 불러왔어요!");
      } catch (e) {
        alert("백업 파일을 읽지 못했어요: " + e.message);
      }
    };
    reader.readAsText(file);
  }

  /* ── 로그인/회원가입 화면 ── */
  function showAuth() {
    let el = document.getElementById("auth");
    if (el) { el.classList.remove("hidden"); navPush(); return; }
    el = document.createElement("div");
    el.id = "auth";
    el.className = "auth-overlay";
    el.innerHTML =
      '<form class="auth-box" novalidate>' +
      "<h2>☁️ 클라우드 동기화</h2>" +
      '<p class="auth-sub">로그인하면 도안과 진행상황이 자동 저장되고<br>다른 기기에서도 이어서 칠할 수 있어요.</p>' +
      '<input type="email" class="auth-input" id="auth-email" placeholder="이메일" autocomplete="email" inputmode="email">' +
      '<input type="password" class="auth-input" id="auth-pw" placeholder="비밀번호 (6자 이상)" autocomplete="new-password">' +
      '<div class="auth-msg" id="auth-msg"></div>' +
      '<button type="submit" class="o-btn primary" id="auth-login">로그인</button>' +
      '<button type="button" class="o-btn" id="auth-signup">회원가입</button>' +
      '<button type="button" class="auth-close" id="auth-close">닫기</button>' +
      "</form>";
    document.body.appendChild(el);
    navPush(); // 뒤로가기 한 단계 = 로그인창 닫기
    const msg = el.querySelector("#auth-msg");
    const loginBtn = el.querySelector("#auth-login");
    const signupBtn = el.querySelector("#auth-signup");
    let running = false;
    const run = async (fn, btn, doingText, okText) => {
      if (running) return;
      const email = el.querySelector("#auth-email").value.trim();
      const pw = el.querySelector("#auth-pw").value;
      msg.className = "auth-msg";
      if (!email || !email.includes("@")) { msg.textContent = "이메일을 입력해주세요"; return; }
      if (pw.length < 6) { msg.textContent = "비밀번호는 6자 이상이어야 해요"; return; }
      running = true;
      const orig = btn.textContent;
      btn.textContent = doingText;
      loginBtn.disabled = signupBtn.disabled = true;
      msg.textContent = "서버에 연결하는 중…";
      try {
        const r = await fn(email, pw);
        if (r && r.needConfirm) {
          msg.className = "auth-msg ok";
          msg.textContent = "가입 완료! 이메일의 확인 링크를 누른 뒤 로그인해주세요.";
        } else {
          showGalleryRaw();   // 뒤 갤러리 갱신(로그인 상태 반영)
          history.back();      // 로그인창 닫기 + pushed state 소비
          if (okText) alert(okText);
        }
      } catch (e) {
        const m = (e && e.message) || "알 수 없는 오류";
        msg.textContent =
          m === "Invalid login credentials" ? "이메일 또는 비밀번호가 달라요" :
          m === "User already registered" ? "이미 가입된 이메일이에요 — 로그인을 눌러주세요" :
          m === "Failed to fetch" || m === "Load failed" ? "서버 연결 실패 — 인터넷 연결을 확인해주세요" :
          m;
      } finally {
        running = false;
        btn.textContent = orig;
        loginBtn.disabled = signupBtn.disabled = false;
      }
    };
    el.querySelector("form").onsubmit = (e) => {
      e.preventDefault();
      run(Cloud.login, loginBtn, "로그인 중…", "로그인 완료! 동기화가 켜졌어요 ☁️");
    };
    signupBtn.onclick = () =>
      run(Cloud.signup, signupBtn, "가입 중…", "가입 완료! 동기화가 켜졌어요 ☁️");
    el.querySelector("#auth-close").onclick = () => history.back();
  }

  /* ── 갤러리 썸네일용 미니 SVG ── */
  function buildThumb(art, progress, fullColor) {
    const filled = new Set(progress);
    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("viewBox", "0 0 " + (art.w || 1000) + " " + (art.h || 1000));
    svg.setAttribute("class", "thumb-svg");
    art.regions.forEach((region, i) => {
      let el;
      switch (region.shape) {
        case "rect":
          el = document.createElementNS(SVGNS, "rect");
          el.setAttribute("x", region.x); el.setAttribute("y", region.y);
          el.setAttribute("width", region.w); el.setAttribute("height", region.h);
          if (region.rx != null) el.setAttribute("rx", region.rx);
          break;
        case "circle":
          el = document.createElementNS(SVGNS, "circle");
          el.setAttribute("cx", region.cx); el.setAttribute("cy", region.cy);
          el.setAttribute("r", region.r);
          break;
        case "ellipse":
          el = document.createElementNS(SVGNS, "ellipse");
          el.setAttribute("cx", region.cx); el.setAttribute("cy", region.cy);
          el.setAttribute("rx", region.rx); el.setAttribute("ry", region.ry);
          break;
        case "polygon":
          el = document.createElementNS(SVGNS, "polygon");
          el.setAttribute("points", region.points);
          break;
        case "path":
          el = document.createElementNS(SVGNS, "path");
          el.setAttribute("d", region.d);
          break;
      }
      const painted = fullColor || filled.has(i);
      const hex = art.palette[region.c].hex;
      if (!art.custom) {
        el.setAttribute("stroke", "#d8d8d8"); el.setAttribute("stroke-width", "3");
      } else if (painted) {
        // 사진 도안: 칠해진 칸은 경계도 같은 색 → 이음새 없이 매끈
        el.setAttribute("stroke", hex); el.setAttribute("stroke-width", "2");
      }
      el.setAttribute("fill", painted ? hex : "#ffffff");
      svg.appendChild(el);
    });
    return svg;
  }

  /* ── 갤러리 렌더 ── */
  function renderGallery() {
    galleryEl.innerHTML = "";

    const header = document.createElement("header");
    header.className = "g-header";
    header.innerHTML =
      '<h1>🎨 컬러링</h1><p class="g-sub">번호대로 색칠하는 힐링 타임 · 광고 없음 · ' + APP_VERSION + "</p>";

    // 계정/백업 줄
    const bar = document.createElement("div");
    bar.className = "g-account";
    if (Cloud.enabled) {
      const u = Cloud.user();
      if (u) {
        const who = document.createElement("span");
        who.className = "g-account-who";
        who.textContent = "☁️ " + u.email;
        const sync = document.createElement("span");
        sync.className = "g-sync";
        sync.id = "g-sync";
        sync.textContent = "동기화됨";
        const out = document.createElement("button");
        out.className = "g-account-btn";
        out.textContent = "로그아웃";
        out.onclick = () => { Cloud.logout(); showGallery(); };
        bar.append(who, sync, out);
      } else {
        const login = document.createElement("button");
        login.className = "g-account-btn primary";
        login.textContent = "☁️ 로그인 / 회원가입";
        login.onclick = showAuth;
        bar.appendChild(login);
      }
    }
    const exp = document.createElement("button");
    exp.className = "g-account-btn";
    exp.textContent = "백업 저장";
    exp.onclick = exportBackup;
    const impInput = document.createElement("input");
    impInput.type = "file";
    impInput.accept = "application/json,.json";
    impInput.style.display = "none";
    impInput.onchange = () => impInput.files[0] && importBackup(impInput.files[0]);
    const imp = document.createElement("button");
    imp.className = "g-account-btn";
    imp.textContent = "백업 불러오기";
    imp.onclick = () => impInput.click();
    bar.append(exp, imp, impInput);
    header.appendChild(bar);

    // 통계 줄
    const st = AppStats.load();
    // 저장 공간 사용량(localStorage ~5MB 기준 추정)
    let usedKB = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        usedKB += ((localStorage.getItem(k) || "").length + k.length) / 512; // UTF-16 ≈ 2B/char
      }
    } catch (e) {}
    const usedPct = Math.round((usedKB / 5120) * 100);
    if (st.pieces > 0 || usedPct >= 70) {
      const stats = document.createElement("p");
      stats.className = "g-stats";
      const streak = AppStats.streak();
      let line =
        "🧩 " + st.pieces.toLocaleString() + "칸 칠함 · 🖼 완성 " + st.completed + "개" +
        (streak > 1 ? " · 🔥 연속 " + streak + "일" : "");
      if (usedPct >= 70) {
        line += " · ⚠️ 저장공간 " + usedPct + "% — 안 쓰는 도안을 삭제해주세요";
        stats.style.color = "#d64545";
      } else {
        line += " · 💾 " + usedPct + "%";
      }
      stats.textContent = line;
      header.appendChild(stats);
    }
    galleryEl.appendChild(header);

    const grid = document.createElement("div");
    grid.className = "g-grid";

    // 내 사진으로 만들기 카드
    const addCard = document.createElement("button");
    addCard.className = "g-card g-add";
    addCard.onclick = showConverter;
    addCard.innerHTML =
      '<div class="g-thumb g-add-thumb"><span class="g-add-plus">＋</span></div>' +
      '<div class="g-meta"><span class="g-name">내 사진으로 만들기</span></div>';
    grid.appendChild(addCard);

    // 내 사진 도안 + 기본 도안
    const custom = loadCustom();
    const all = custom.concat(ARTWORKS);
    all.forEach((art) => {
      const progress = ColoringStore.getProgress(art.id);
      const pct = Math.round((progress.length / art.regions.length) * 100);

      const card = document.createElement("button");
      card.className = "g-card";
      card.onclick = () => openArt(art);

      const thumbWrap = document.createElement("div");
      thumbWrap.className = "g-thumb";
      // 내 사진은 알아보기 쉽게 완성 색상 미리보기
      thumbWrap.appendChild(buildThumb(art, progress, !!art.custom));
      if (pct === 100) {
        const badge = document.createElement("div");
        badge.className = "g-badge";
        badge.textContent = "완성 ✓";
        thumbWrap.appendChild(badge);
      }
      if (art.custom) {
        const del = document.createElement("span");
        del.className = "g-del";
        del.textContent = "✕";
        del.title = "삭제";
        del.onclick = (e) => {
          e.stopPropagation();
          if (confirm("이 사진 도안을 삭제할까요?")) { deleteCustom(art.id); renderGallery(); }
        };
        thumbWrap.appendChild(del);
        // 공유(로그인 시): 링크를 만들어 누구나 이 도안을 칠할 수 있게
        if (Cloud.enabled && Cloud.user()) {
          const sh = document.createElement("span");
          sh.className = "g-share";
          sh.textContent = "🔗";
          sh.title = "도안 공유";
          sh.onclick = async (e) => {
            e.stopPropagation();
            sh.textContent = "…";
            try {
              const url = await Cloud.shareArt(art);
              if (navigator.share) {
                try { await navigator.share({ title: art.title, url }); } catch (e2) {}
              } else if (navigator.clipboard) {
                await navigator.clipboard.writeText(url);
                alert("공유 링크를 복사했어요!\n" + url);
              } else {
                prompt("공유 링크:", url);
              }
            } catch (err) {
              alert("공유 실패: " + err.message);
            }
            sh.textContent = "🔗";
          };
          thumbWrap.appendChild(sh);
        }
      }

      const meta = document.createElement("div");
      meta.className = "g-meta";
      const name = document.createElement("span");
      name.className = "g-name";
      name.textContent = art.title;
      const bar = document.createElement("div");
      bar.className = "g-bar";
      const fill = document.createElement("div");
      fill.className = "g-bar-fill";
      fill.style.width = pct + "%";
      bar.appendChild(fill);
      meta.append(name, bar);

      card.append(thumbWrap, meta);
      grid.appendChild(card);
    });

    galleryEl.appendChild(grid);
  }

  /* ── 사진 변환 화면 ── */
  function showConverter() {
    converterEl.innerHTML = "";
    let pickedImg = null;   // 로드된 Image
    let builtArt = null;    // 변환 결과 artwork

    const top = document.createElement("div");
    top.className = "c-top";
    const back = document.createElement("button");
    back.className = "c-back";
    back.innerHTML = "‹ 갤러리";
    back.onclick = showGallery;
    const title = document.createElement("div");
    title.className = "c-title";
    title.textContent = "내 사진으로 만들기";
    top.append(back, title, document.createElement("div"));

    const body = document.createElement("div");
    body.className = "cv-body";

    // 파일 선택
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.style.display = "none";

    const pickBtn = document.createElement("button");
    pickBtn.className = "cv-pick";
    pickBtn.textContent = "📷 사진 선택";
    pickBtn.onclick = () => fileInput.click();

    // 미리보기 영역
    const preview = document.createElement("div");
    preview.className = "cv-preview";
    preview.innerHTML = '<span class="cv-hint">사진을 선택하면 여기에 미리보기가 나와요</span>';

    // 옵션: 색 개수 / 정밀도 / 스타일
    const optColors = segmented("색 개수", ["16", "20", "24", "32"], 2); // 기본 24
    const optDetail = segmented("정밀도", ["쉬움", "보통", "자세히", "최고"], 2); // 기본 자세히
    const optStyle = segmented("스타일", ["유화 붓터치", "영역 따라"], 0); // 기본 유화

    const info = document.createElement("div");
    info.className = "cv-info";

    // 액션 버튼
    const makeBtn = document.createElement("button");
    makeBtn.className = "cv-action";
    makeBtn.textContent = "미리보기 만들기";
    makeBtn.disabled = true;
    const startBtn = document.createElement("button");
    startBtn.className = "cv-action primary";
    startBtn.textContent = "이 그림 색칠 시작";
    startBtn.style.display = "none";

    body.append(pickBtn, preview, optColors.el, optDetail.el, optStyle.el, info, makeBtn, startBtn, fileInput);
    converterEl.append(top, body);

    // 파일 로드
    fileInput.onchange = () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.onload = () => {
        pickedImg = img;
        preview.innerHTML = "";
        img.className = "cv-src";
        preview.appendChild(img);
        makeBtn.disabled = false;
        startBtn.style.display = "none";
        info.textContent = "";
      };
      img.src = url;
    };

    // cols: 격자 가로 칸수(클수록 세밀), minRegion: 이보다 작은 조각은 병합 시도
    // (주변과 색 대비가 큰 작은 조각은 병합하지 않고 보존 — photo.js 참고)
    // fhK: 세그멘테이션 스케일(작을수록 조각이 잘게, 획 단위로)
    const DETAIL = {
      "쉬움": { cols: 72, minRegion: 26, fhK: 16 },
      "보통": { cols: 110, minRegion: 14, fhK: 12 },
      "자세히": { cols: 170, minRegion: 7, fhK: 9 },
      "최고": { cols: 280, minRegion: 4, fhK: 7 }, // 실제 페인팅 키트급
    };

    makeBtn.onclick = () => {
      if (!pickedImg) return;
      makeBtn.disabled = true;
      makeBtn.textContent = "변환 중… ⏳";
      // 다음 프레임에 무거운 작업 실행 (버튼 상태가 먼저 그려지도록)
      setTimeout(() => {
        const colors = parseInt(optColors.value(), 10);
        const d = DETAIL[optDetail.value()];
        const style = optStyle.value() === "유화 붓터치" ? "oil" : "seg";
        builtArt = PhotoConverter.convert(pickedImg, { colors, cols: d.cols, minRegion: d.minRegion, fhK: d.fhK, style });
        // 완성 색상 미리보기
        preview.innerHTML = "";
        preview.appendChild(buildThumb(builtArt, [], true));
        info.textContent =
          "색 " + builtArt.palette.length + "개 · 영역 " + builtArt.regions.length + "칸";
        makeBtn.disabled = false;
        makeBtn.textContent = "다시 만들기";
        startBtn.style.display = "";
      }, 30);
    };

    startBtn.onclick = () => {
      if (!builtArt) return;
      const name = prompt("도안 이름을 정해주세요", "내 사진");
      if (name) builtArt.title = name.slice(0, 20);
      saveCustomArt(builtArt);
      openArt(builtArt);
    };

    if (!inSubScreen()) navPush(); // 갤러리에서 진입할 때만 한 단계 push
    converterEl.classList.remove("hidden");
    galleryEl.classList.add("hidden");
    canvasEl.classList.add("hidden");
    overlayEl.classList.add("hidden");
  }

  // 세그먼트 컨트롤 생성
  function segmented(label, options, defaultIdx) {
    const wrap = document.createElement("div");
    wrap.className = "cv-seg-wrap";
    const lab = document.createElement("div");
    lab.className = "cv-seg-label";
    lab.textContent = label;
    const seg = document.createElement("div");
    seg.className = "cv-seg";
    let current = options[defaultIdx];
    const btns = options.map((o, i) => {
      const b = document.createElement("button");
      b.textContent = o;
      b.className = i === defaultIdx ? "on" : "";
      b.onclick = () => {
        current = o;
        btns.forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
      };
      seg.appendChild(b);
      return b;
    });
    wrap.append(lab, seg);
    return { el: wrap, value: () => current };
  }

  /* ── 뒤로가기 처리 (안드로이드 하드웨어 back + 브라우저 back) ──
     화면에 진입할 때 history state를 쌓아, 뒤로가기가 오버레이 → 색칠/변환
     화면 → 갤러리 순으로 닫히게 하고, 갤러리(루트)에서만 앱을 나가게 한다. */
  let navPushed = 0;
  function navPush() { navPushed++; history.pushState({ nav: navPushed }, ""); }
  function inSubScreen() {
    return !canvasEl.classList.contains("hidden") || !converterEl.classList.contains("hidden");
  }
  window.addEventListener("popstate", () => {
    if (navPushed > 0) navPushed--;
    // 위에서부터 열려있는 것을 하나 닫는다
    const auth = document.getElementById("auth");
    if (auth && !auth.classList.contains("hidden")) { auth.classList.add("hidden"); return; }
    if (!overlayEl.classList.contains("hidden")) { showGalleryRaw(); return; }
    if (inSubScreen()) { showGalleryRaw(); return; }
    // 갤러리(루트) — 더 닫을 것 없음. 웹뷰 기본 동작(앱 종료)에 맡긴다.
  });

  // Capacitor 앱: 네이티브 하드웨어 뒤로가기 → 웹 히스토리와 연결
  // (닫을 화면/오버레이가 있으면 그것부터, 갤러리 루트면 앱 종료)
  (function () {
    const Cap = window.Capacitor;
    const App = Cap && Cap.Plugins && Cap.Plugins.App;
    if (!App || !App.addListener) return;
    App.addListener("backButton", () => {
      const auth = document.getElementById("auth");
      const authOpen = auth && !auth.classList.contains("hidden");
      if (navPushed > 0 || authOpen || !overlayEl.classList.contains("hidden") || inSubScreen()) {
        history.back();
      } else {
        App.exitApp();
      }
    });
  })();

  /* ── 화면 전환 ── */
  function showGalleryRaw() {
    renderGallery();
    galleryEl.classList.remove("hidden");
    canvasEl.classList.add("hidden");
    converterEl.classList.add("hidden");
    overlayEl.classList.add("hidden");
  }
  // 갤러리로 복귀: 쌓인 history가 있으면 back으로 소비(동기화 유지)
  function showGallery() {
    if (navPushed > 0) history.back();
    else showGalleryRaw();
  }
  function openArt(art) {
    if (!inSubScreen()) navPush(); // 갤러리에서 진입할 때만 한 단계 push
    galleryEl.classList.add("hidden");
    canvasEl.classList.remove("hidden");
    converterEl.classList.add("hidden");
    overlayEl.classList.add("hidden");
    engine.start(art);
  }

  /* ── 완성 축하 ── */
  function celebrate(art) {
    AppStats.complete();
    overlayEl.innerHTML = "";
    const box = document.createElement("div");
    box.className = "o-box";

    const confetti = document.createElement("div");
    confetti.className = "o-confetti";
    for (let i = 0; i < 30; i++) {
      const s = document.createElement("i");
      s.style.left = Math.round((i / 30) * 100) + "%";
      s.style.animationDelay = (i % 10) * 0.12 + "s";
      s.style.background = art.palette[i % art.palette.length].hex;
      confetti.appendChild(s);
    }

    const thumb = document.createElement("div");
    thumb.className = "o-thumb";
    thumb.appendChild(buildThumb(art, art.regions.map((_, i) => i)));

    const h = document.createElement("h2");
    h.textContent = "완성! 🎉";
    const p = document.createElement("p");
    p.textContent = art.title + " 을(를) 다 칠했어요.";

    const btns = document.createElement("div");
    btns.className = "o-btns";
    const saveBtn = document.createElement("button");
    saveBtn.className = "o-btn primary";
    saveBtn.textContent = "💾 이미지 저장 / 공유";
    saveBtn.onclick = () => saveArtImage(art);
    const replayBtn = document.createElement("button");
    replayBtn.className = "o-btn";
    replayBtn.textContent = "🎬 리플레이 보기";
    replayBtn.onclick = () => {
      if (replayBtn.disabled) return;
      replayBtn.disabled = true;
      playReplay(art, thumb, () => { replayBtn.disabled = false; });
    };
    const galleryBtn = document.createElement("button");
    galleryBtn.className = "o-btn";
    galleryBtn.textContent = "갤러리로";
    galleryBtn.onclick = showGallery;
    const againBtn = document.createElement("button");
    againBtn.className = "o-btn";
    againBtn.textContent = "다시 칠하기";
    againBtn.onclick = () => {
      const all = ColoringStore.loadAllProgress();
      delete all[art.id];
      localStorage.setItem("coloring:progress:v1", JSON.stringify(all));
      openArt(art);
    };
    btns.append(saveBtn, replayBtn, galleryBtn, againBtn);

    box.append(thumb, h, p, btns);
    overlayEl.append(confetti, box);
    overlayEl.classList.remove("hidden");
  }

  /* ── 리플레이: 칠한 순서 그대로 타임랩스 재생 ── */
  function playReplay(art, container, onEnd) {
    const vw = art.w || 1000, vh = art.h || 1000;
    const order = ColoringStore.getProgress(art.id); // 저장 순서 = 칠한 순서
    const seq = order.length === art.regions.length ? order : art.regions.map((_, i) => i);
    const cvs = document.createElement("canvas");
    const W = 640;
    cvs.width = W;
    cvs.height = Math.round((W * vh) / vw);
    cvs.style.width = "100%";
    cvs.style.height = "100%";
    cvs.style.objectFit = "contain";
    const ctx = cvs.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cvs.width, cvs.height);
    ctx.setTransform(W / vw, 0, 0, W / vw, 0, 0);
    container.innerHTML = "";
    container.appendChild(cvs);

    // 약 4초 안에 끝나도록 프레임당 개수 조절
    const perFrame = Math.max(1, Math.ceil(seq.length / 240));
    let pos = 0;
    (function step() {
      for (let k = 0; k < perFrame && pos < seq.length; k++, pos++) {
        const r = art.regions[seq[pos]];
        engine._drawRegionOnCtx(ctx, r, art.palette[r.c].hex);
      }
      if (pos < seq.length) requestAnimationFrame(step);
      else if (onEnd) onEnd();
    })();
  }

  /* ── 서비스워커(오프라인/설치) ── */
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  // 동기화 상태를 갤러리 헤더에 반영
  Cloud.onStatus((state, detail) => {
    const el = document.getElementById("g-sync");
    if (!el) return;
    el.textContent =
      state === "syncing" ? "동기화 중…" :
      state === "synced" ? "동기화됨 ✓" :
      state === "error" ? "동기화 실패(" + detail + ")" : "";
  });

  AppDB.ready.then(boot);
  function boot() {
  showGallery();

  // 공유 링크(?share=...)로 들어온 경우: 도안 내려받아 갤러리에 추가 후 열기
  (function () {
    const m = location.search.match(/[?&]share=([^&]+)/);
    if (!m || !Cloud.enabled) return;
    const shareId = decodeURIComponent(m[1]);
    history.replaceState(null, "", location.pathname); // URL 정리
    Cloud.fetchShared(shareId)
      .then((row) => {
        const art = row.payload;
        art.id = "shared-" + shareId; // 내 저장소용 id (중복 수신 시 갱신)
        art.custom = true;
        art.title = row.title || art.title;
        // 이미 받은 적 있으면 중복 추가 안 함
        if (!loadCustom().some((a) => a.id === art.id)) saveCustomArt(art);
        showGallery();
        openArt(art);
      })
      .catch((e) => alert("공유 도안 가져오기 실패: " + e.message));
  })();

  // 로그인돼 있으면 클라우드 내려받아 병합 후 갤러리 갱신
  let lastPull = Date.now();
  Cloud.init().then(() => {
    if (!galleryEl.classList.contains("hidden")) showGallery();
  });

  // 창으로 돌아올 때마다 클라우드 최신 내용 반영(다른 기기의 변경 수신)
  function pullIfStale() {
    if (!Cloud.enabled || !Cloud.user()) return;
    if (Date.now() - lastPull < 10000) return; // 10초 쿨다운
    lastPull = Date.now();
    Cloud.pullMerge().then((ok) => {
      if (ok && !galleryEl.classList.contains("hidden")) showGallery();
    });
  }
  window.addEventListener("focus", pullIfStale);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) pullIfStale();
  });
  } // boot()
})();
