/*
 * app.js
 * 화면 전환(갤러리 ↔ 색칠 ↔ 사진변환), 갤러리 렌더, 완성 축하, 서비스워커 등록.
 */
(function () {
  const SVGNS = "http://www.w3.org/2000/svg";
  const APP_VERSION = "v1.0"; // 갤러리에 표시 — 폰이 최신 코드인지 확인용
  const CUSTOM_KEY = "coloring:custom:v1";
  const galleryEl = document.getElementById("gallery");
  const canvasEl = document.getElementById("canvas");
  const converterEl = document.getElementById("converter");
  const overlayEl = document.getElementById("overlay");

  const engine = new ColoringEngine(canvasEl);
  engine.onExit = showGallery;
  engine.onComplete = celebrate;

  /* ── 내 사진 도안 저장소 ── */
  function loadCustom() {
    try { return JSON.parse(localStorage.getItem(CUSTOM_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveCustomArt(art) {
    const list = loadCustom();
    list.unshift(art);
    while (list.length > 4) list.pop(); // 용량 보호(유화 세밀 도안은 도안당 1~2MB)
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); }
    catch (e) { alert("저장 공간이 부족해요. 기존 사진 도안을 지운 뒤 다시 시도해주세요."); }
  }
  function deleteCustom(id) {
    const list = loadCustom().filter((a) => a.id !== id);
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
    const prog = ColoringStore.loadAllProgress();
    delete prog[id];
    localStorage.setItem("coloring:progress:v1", JSON.stringify(prog));
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

  /* ── 화면 전환 ── */
  function showGallery() {
    renderGallery();
    galleryEl.classList.remove("hidden");
    canvasEl.classList.add("hidden");
    converterEl.classList.add("hidden");
    overlayEl.classList.add("hidden");
  }
  function openArt(art) {
    galleryEl.classList.add("hidden");
    canvasEl.classList.remove("hidden");
    converterEl.classList.add("hidden");
    overlayEl.classList.add("hidden");
    engine.start(art);
  }

  /* ── 완성 축하 ── */
  function celebrate(art) {
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
    const galleryBtn = document.createElement("button");
    galleryBtn.className = "o-btn primary";
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
    btns.append(galleryBtn, againBtn);

    box.append(thumb, h, p, btns);
    overlayEl.append(confetti, box);
    overlayEl.classList.remove("hidden");
  }

  /* ── 서비스워커(오프라인/설치) ── */
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  showGallery();
})();
