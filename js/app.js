/*
 * app.js
 * 화면 전환(갤러리 ↔ 색칠), 갤러리 렌더, 완성 축하 오버레이, 서비스워커 등록.
 */
(function () {
  const SVGNS = "http://www.w3.org/2000/svg";
  const galleryEl = document.getElementById("gallery");
  const canvasEl = document.getElementById("canvas");
  const overlayEl = document.getElementById("overlay");

  const engine = new ColoringEngine(canvasEl);
  engine.onExit = showGallery;
  engine.onComplete = celebrate;

  /* ── 갤러리 썸네일용 미니 SVG ── */
  function buildThumb(art, progress) {
    const filled = new Set(progress);
    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("viewBox", "0 0 1000 1000");
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
      el.setAttribute("stroke", "#d8d8d8");
      el.setAttribute("stroke-width", "3");
      el.setAttribute("fill", filled.has(i) ? art.palette[region.c].hex : "#ffffff");
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
      '<h1>🎨 컬러링</h1><p class="g-sub">번호대로 색칠하는 힐링 타임 · 광고 없음</p>';
    galleryEl.appendChild(header);

    const grid = document.createElement("div");
    grid.className = "g-grid";

    ARTWORKS.forEach((art) => {
      const progress = ColoringStore.getProgress(art.id);
      const pct = Math.round((progress.length / art.regions.length) * 100);

      const card = document.createElement("button");
      card.className = "g-card";
      card.onclick = () => openArt(art);

      const thumbWrap = document.createElement("div");
      thumbWrap.className = "g-thumb";
      thumbWrap.appendChild(buildThumb(art, progress));
      if (pct === 100) {
        const badge = document.createElement("div");
        badge.className = "g-badge";
        badge.textContent = "완성 ✓";
        thumbWrap.appendChild(badge);
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

  /* ── 화면 전환 ── */
  function showGallery() {
    renderGallery();
    galleryEl.classList.remove("hidden");
    canvasEl.classList.add("hidden");
    overlayEl.classList.add("hidden");
  }
  function openArt(art) {
    galleryEl.classList.add("hidden");
    canvasEl.classList.remove("hidden");
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
