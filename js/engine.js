/*
 * engine.js
 * 색칠 화면 엔진.
 *  - 도안 SVG 렌더 (영역 + 번호)
 *  - 색 선택 팔레트
 *  - 탭으로 색칠 (선택한 번호와 영역 번호가 맞으면 채움)
 *  - 확대/축소, 드래그 이동, 두 손가락 핀치 줌
 *  - 진행상황 localStorage 저장/복원
 */
(function () {
  const SVGNS = "http://www.w3.org/2000/svg";
  const STORE_KEY = "coloring:progress:v1";

  /* ── 저장소 헬퍼 ── */
  function loadAllProgress() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    } catch (e) {
      return {};
    }
  }
  function saveProgress(artId, filledIndices) {
    try {
      const all = loadAllProgress();
      all[artId] = filledIndices;
      localStorage.setItem(STORE_KEY, JSON.stringify(all));
    } catch (e) {
      /* 저장소 사용 불가(사파리 비공개 모드 등) — 무시하고 계속 */
    }
    if (window.Cloud) window.Cloud.schedulePush(); // 로그인 상태면 클라우드에도
  }
  function getProgress(artId) {
    return loadAllProgress()[artId] || [];
  }

  /* ── 영역 shape → SVG 엘리먼트 생성 ── */
  function createRegionEl(region) {
    let el;
    switch (region.shape) {
      case "rect":
        el = document.createElementNS(SVGNS, "rect");
        el.setAttribute("x", region.x);
        el.setAttribute("y", region.y);
        el.setAttribute("width", region.w);
        el.setAttribute("height", region.h);
        if (region.rx != null) el.setAttribute("rx", region.rx);
        break;
      case "circle":
        el = document.createElementNS(SVGNS, "circle");
        el.setAttribute("cx", region.cx);
        el.setAttribute("cy", region.cy);
        el.setAttribute("r", region.r);
        break;
      case "ellipse":
        el = document.createElementNS(SVGNS, "ellipse");
        el.setAttribute("cx", region.cx);
        el.setAttribute("cy", region.cy);
        el.setAttribute("rx", region.rx);
        el.setAttribute("ry", region.ry);
        break;
      case "polygon":
        el = document.createElementNS(SVGNS, "polygon");
        el.setAttribute("points", region.points);
        break;
      case "path":
        el = document.createElementNS(SVGNS, "path");
        el.setAttribute("d", region.d);
        break;
      default:
        throw new Error("알 수 없는 shape: " + region.shape);
    }
    return el;
  }

  /* ── 엔진 클래스 ── */
  class ColoringEngine {
    constructor(rootEl) {
      this.root = rootEl;      // 색칠 화면 컨테이너
      this.art = null;
      this.selected = 0;       // 선택된 팔레트 index
      this.filled = new Set(); // 채워진 region index
      this.regionEls = [];     // region index -> {shape, text}
      this.onComplete = null;
      this.onExit = null;

      // 뷰 변환(확대/이동)
      this.scale = 1;
      this.tx = 0;
      this.ty = 0;
      this._pointers = new Map();
      this._moved = false;
      this._pinchStart = null;
    }

    start(art) {
      this.art = art;
      this.selected = 0;
      this.filled = new Set(getProgress(art.id));
      this.scale = 1;
      this.tx = 0;
      this.ty = 0;
      this._render();
    }

    /* 전체 화면 구성 */
    _render() {
      const art = this.art;
      this.root.innerHTML = "";

      /* 상단 바 */
      const top = document.createElement("div");
      top.className = "c-top";
      const back = document.createElement("button");
      back.className = "c-back";
      back.innerHTML = "‹ 갤러리";
      back.onclick = () => {
        clearTimeout(this._hintTimer);
        this.onExit && this.onExit();
      };
      const title = document.createElement("div");
      title.className = "c-title";
      title.textContent = art.title;
      this.progressEl = document.createElement("div");
      this.progressEl.className = "c-progress";
      const muteBtn = document.createElement("button");
      muteBtn.className = "c-mute-btn";
      this.muted = localStorage.getItem("coloring:muted:v1") === "1";
      muteBtn.textContent = this.muted ? "🔇" : "🔊";
      muteBtn.onclick = () => {
        this.muted = !this.muted;
        localStorage.setItem("coloring:muted:v1", this.muted ? "1" : "0");
        muteBtn.textContent = this.muted ? "🔇" : "🔊";
      };
      const previewBtn = document.createElement("button");
      previewBtn.className = "c-preview-btn";
      previewBtn.textContent = "완성본";
      previewBtn.onclick = () => this._togglePreview();
      top.append(back, title, muteBtn, previewBtn, this.progressEl);

      /* 캔버스 영역(줌 무대) */
      const stage = document.createElement("div");
      stage.className = "c-stage";
      this.stageEl = stage;
      this.previewEl = null;
      const viewport = document.createElement("div");
      viewport.className = "c-viewport";
      const svg = document.createElementNS(SVGNS, "svg");
      const vw = art.w || 1000, vh = art.h || 1000;
      svg.setAttribute("viewBox", "0 0 " + vw + " " + vh);
      // 영역이 아주 많은 도안은 강조 애니메이션을 꺼서 성능 확보
      const huge = art.regions.length > 1500 ? " huge" : "";
      svg.setAttribute("class", "c-svg" + (art.custom ? " custom-art" : "") + huge);
      this.svg = svg;
      this.viewport = viewport;
      viewport.appendChild(svg);
      stage.appendChild(viewport);

      /* 영역 렌더 */
      this.regionEls = [];
      art.regions.forEach((region, i) => {
        const shape = createRegionEl(region);
        shape.setAttribute("class", "region");
        shape.dataset.i = i;
        shape.dataset.c = region.c;
        svg.appendChild(shape);
        this.regionEls.push({ shape, text: null, region });
      });

      /* 하단 팔레트 */
      const palette = document.createElement("div");
      palette.className = "c-palette";
      this.paletteEl = palette;
      this.swatchWraps = [];
      this.swatchEls = art.palette.map((col, idx) => {
        // 링(진행률) + 색 버튼
        const wrap = document.createElement("div");
        wrap.className = "swatch-wrap";
        const b = document.createElement("button");
        b.className = "swatch";
        b.style.background = col.hex;
        b.dataset.idx = idx;
        const num = document.createElement("span");
        num.className = "swatch-num";
        num.textContent = idx + 1;
        b.appendChild(num);
        b.onclick = () => this._select(idx);
        wrap.appendChild(b);
        palette.appendChild(wrap);
        this.swatchWraps.push(wrap);
        return b;
      });

      // 색별 조각 수/완료 수 (팔레트 링 표시용)
      this.colorTotal = art.palette.map(
        (_, c) => art.regions.filter((r) => r.c === c).length
      );
      this.colorDone = art.palette.map(() => 0);
      this.filled.forEach((i) => this.colorDone[art.regions[i].c]++);

      this.root.append(top, stage, palette);

      // SVG가 DOM에 붙은 뒤에야 getBBox가 실제 크기를 반환 → 번호는 지금 배치
      this._placeNumbers();
      this._buildMinimap(stage);
      this._applyFilledState();
      // 저장된 진행에 맞춰 링·완료 표시 복원
      art.palette.forEach((_, c) => {
        this._updateRing(c);
        if (this.colorTotal[c] > 0 && this.colorDone[c] >= this.colorTotal[c]) {
          this.swatchEls[c].classList.add("done");
        }
      });
      this._select(this._firstUnfinishedColor());
      this._updateProgress();
      this._bindZoomPan(stage);

      // 🔍 남은 조각 찾기 버튼(무대 우하단)
      const findBtn = document.createElement("button");
      findBtn.className = "c-findbtn";
      findBtn.innerHTML = "🔍";
      findBtn.title = "남은 조각 찾기";
      findBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
      findBtn.onclick = () => this._findNext();
      stage.appendChild(findBtn);

      this._findIdx = -1;
      this._armHint();
    }

    /* 선택색의 남은 조각으로 화면 이동(누를 때마다 다음 조각 순환) */
    _findNext() {
      const c = this.selected;
      const remain = [];
      this.art.regions.forEach((r, i) => {
        if (r.c === c && !this.filled.has(i)) remain.push(i);
      });
      if (!remain.length) return;
      this._findIdx = (this._findIdx + 1) % remain.length;
      const i = remain[this._findIdx];
      // 편한 배율로 확대(이미 더 크게 보고 있으면 유지)
      const wantScale = this.art.custom ? 6 : 2.2;
      if (this.scale < wantScale) this.scale = wantScale;
      this._applyTransform();
      // 조각이 화면 중앙에 오도록 이동
      const bb = this.regionEls[i].shape.getBoundingClientRect();
      const st = this.stageEl.getBoundingClientRect();
      this.tx += st.left + st.width / 2 - (bb.left + bb.width / 2);
      this.ty += st.top + st.height / 2 - (bb.top + bb.height / 2);
      this._applyTransform();
      this._flash(i);
    }

    /* 특정 조각 반짝임 */
    _flash(i) {
      const el = this.regionEls[i].shape;
      el.classList.remove("hintflash");
      void el.offsetWidth;
      el.classList.add("hintflash");
      setTimeout(() => el.classList.remove("hintflash"), 1900);
    }

    /* 20초 동안 색칠이 없으면 남은 조각 하나를 반짝여주는 힌트 */
    _armHint() {
      clearTimeout(this._hintTimer);
      this._hintTimer = setTimeout(() => {
        if (this.filled.size < this.art.regions.length) {
          const c = this.selected;
          const i = this.art.regions.findIndex(
            (r, idx) => r.c === c && !this.filled.has(idx)
          );
          if (i >= 0) this._flash(i);
        }
        this._armHint();
      }, 20000);
    }

    /* 색칠 효과음(짧은 틱) + 진동 */
    _tick() {
      if (this.muted) return;
      try {
        if (!ColoringEngine._audio) {
          ColoringEngine._audio = new (window.AudioContext || window.webkitAudioContext)();
        }
        const ac = ColoringEngine._audio;
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = "sine";
        o.frequency.value = 620 + (this.filled.size % 5) * 60; // 살짝씩 다른 음
        g.gain.setValueAtTime(0.09, ac.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.09);
        o.connect(g).connect(ac.destination);
        o.start();
        o.stop(ac.currentTime + 0.1);
      } catch (e) { /* 오디오 미지원 무시 */ }
      if (navigator.vibrate) navigator.vibrate(8);
    }

    /* 팔레트 원 둘레의 진행률 링 갱신 */
    _updateRing(c) {
      const total = this.colorTotal[c] || 1;
      const pct = Math.min(100, (this.colorDone[c] / total) * 100);
      const done = this.colorDone[c] >= this.colorTotal[c] && this.colorTotal[c] > 0;
      this.swatchWraps[c].style.background = done
        ? "conic-gradient(#2eb872 100%, #2eb872 0)"
        : "conic-gradient(var(--brand) " + pct + "%, var(--line) 0)";
    }

    /* 색 하나 완료 시 파티클 터짐 효과 */
    _burst(x, y, hex) {
      const holder = document.createElement("div");
      holder.className = "burst";
      holder.style.left = x + "px";
      holder.style.top = y + "px";
      for (let i = 0; i < 14; i++) {
        const p = document.createElement("i");
        const a = (i / 14) * Math.PI * 2;
        const d = 36 + Math.random() * 28;
        p.style.setProperty("--dx", Math.cos(a) * d + "px");
        p.style.setProperty("--dy", Math.sin(a) * d + "px");
        p.style.background = i % 3 === 2 ? "#ffd23f" : hex;
        p.style.animationDelay = Math.random() * 0.06 + "s";
        holder.appendChild(p);
      }
      document.body.appendChild(holder);
      setTimeout(() => holder.remove(), 850);
    }

    /* ── 캔버스에 영역 하나를 그리는 헬퍼(미니맵·완성본 미리보기 공용) ── */
    _drawRegionOnCtx(ctx, region, color) {
      ctx.fillStyle = color;
      switch (region.shape) {
        case "path":
          ctx.fill(new Path2D(region.d));
          break;
        case "rect":
          ctx.fillRect(region.x, region.y, region.w, region.h);
          break;
        case "circle":
          ctx.beginPath();
          ctx.arc(region.cx, region.cy, region.r, 0, Math.PI * 2);
          ctx.fill();
          break;
        case "ellipse":
          ctx.beginPath();
          ctx.ellipse(region.cx, region.cy, region.rx, region.ry, 0, 0, Math.PI * 2);
          ctx.fill();
          break;
        case "polygon": {
          const pts = region.points.split(" ").map((s) => s.split(",").map(Number));
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
          ctx.closePath();
          ctx.fill();
          break;
        }
      }
    }

    /* ── 미니맵: 전체 그림 축소판 + 현재 보이는 위치 표시, 탭하면 이동 ── */
    _buildMinimap(stage) {
      const art = this.art;
      const vw = art.w || 1000, vh = art.h || 1000;
      const wrap = document.createElement("div");
      wrap.className = "c-minimap";
      const cvs = document.createElement("canvas");
      const MW = 220; // 내부 해상도
      cvs.width = MW;
      cvs.height = Math.round((MW * vh) / vw);
      const view = document.createElement("div");
      view.className = "c-minimap-view";
      wrap.append(cvs, view);
      stage.appendChild(wrap);

      const ctx = cvs.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, cvs.width, cvs.height);
      ctx.setTransform(MW / vw, 0, 0, MW / vw, 0, 0);
      this.minimap = { wrap, cvs, view, ctx };

      // 미니맵 조작이 화면 이동/색칠로 번지지 않게 차단
      wrap.addEventListener("pointerdown", (e) => e.stopPropagation());
      wrap.addEventListener("click", (e) => {
        e.stopPropagation();
        this._minimapJump(e);
      });
      this._updateMinimapView();
    }

    /* 미니맵 위 현재 화면 위치 사각형 갱신 */
    _updateMinimapView() {
      if (!this.minimap) return;
      const stageR = this.stageEl.getBoundingClientRect();
      const svgR = this.svg.getBoundingClientRect();
      if (!svgR.width || !svgR.height) return;
      const clamp01 = (v) => Math.max(0, Math.min(1, v));
      const x0 = clamp01((stageR.left - svgR.left) / svgR.width);
      const y0 = clamp01((stageR.top - svgR.top) / svgR.height);
      const x1 = clamp01((stageR.right - svgR.left) / svgR.width);
      const y1 = clamp01((stageR.bottom - svgR.top) / svgR.height);
      const s = this.minimap.view.style;
      s.left = (x0 * 100).toFixed(2) + "%";
      s.top = (y0 * 100).toFixed(2) + "%";
      s.width = ((x1 - x0) * 100).toFixed(2) + "%";
      s.height = ((y1 - y0) * 100).toFixed(2) + "%";
    }

    /* 미니맵 탭 → 그 지점이 화면 중앙에 오도록 이동 */
    _minimapJump(e) {
      const r = this.minimap.cvs.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width;
      const fy = (e.clientY - r.top) / r.height;
      const svgR = this.svg.getBoundingClientRect();
      const stageR = this.stageEl.getBoundingClientRect();
      const px = svgR.left + fx * svgR.width;
      const py = svgR.top + fy * svgR.height;
      this.tx += stageR.left + stageR.width / 2 - px;
      this.ty += stageR.top + stageR.height / 2 - py;
      this._applyTransform();
    }

    /* ── 완성본 미리보기 토글 ── */
    _togglePreview() {
      if (this.previewEl) {
        this.previewEl.remove();
        this.previewEl = null;
        return;
      }
      const art = this.art;
      const vw = art.w || 1000, vh = art.h || 1000;
      // 완성본은 도안당 한 번만 렌더해서 재사용
      if (!this._previewCanvas || this._previewCanvasFor !== art.id) {
        const cvs = document.createElement("canvas");
        const W = 1400;
        cvs.width = W;
        cvs.height = Math.round((W * vh) / vw);
        const ctx = cvs.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, cvs.width, cvs.height);
        ctx.setTransform(W / vw, 0, 0, W / vw, 0, 0);
        art.regions.forEach((r) => this._drawRegionOnCtx(ctx, r, art.palette[r.c].hex));
        this._previewCanvas = cvs;
        this._previewCanvasFor = art.id;
      }
      const div = document.createElement("div");
      div.className = "c-preview";
      const label = document.createElement("div");
      label.className = "c-preview-label";
      label.textContent = "완성본 미리보기 · 탭하면 닫혀요";
      const save = document.createElement("button");
      save.className = "c-preview-save";
      save.textContent = "💾 이미지 저장 / 공유";
      save.onclick = (e) => {
        e.stopPropagation();
        if (window.AppShare) window.AppShare(this.art);
      };
      div.append(this._previewCanvas, save, label);
      div.addEventListener("pointerdown", (e) => e.stopPropagation());
      div.onclick = () => this._togglePreview();
      this.stageEl.appendChild(div);
      this.previewEl = div;
    }

    /* 각 영역 중앙에 번호 텍스트 배치(영역 위에 얹음) */
    _placeNumbers() {
      const custom = !!this.art.custom;
      this.art.regions.forEach((region, i) => {
        const shape = this.regionEls[i].shape;
        const bb = shape.getBBox();
        // 사진 도안은 region.nx/ny(영역 무게중심)를 우선 사용
        const px = region.nx != null ? region.nx : bb.x + bb.width / 2;
        const py = region.ny != null ? region.ny : bb.y + bb.height / 2;
        const t = document.createElementNS(SVGNS, "text");
        t.setAttribute("x", px);
        t.setAttribute("y", py);
        t.setAttribute("class", "region-num");
        const minSize = custom ? 3.5 : 20;
        const size = Math.max(minSize, Math.min(60, Math.min(bb.width, bb.height) * 0.5));
        t.setAttribute("font-size", size);
        t.textContent = region.c + 1;
        this.svg.appendChild(t);
        this.regionEls[i].text = t;
      });
    }

    /* 저장된 채움 상태 반영 */
    _applyFilledState() {
      this.filled.forEach((i) => this._paint(i, false));
    }

    _firstUnfinishedColor() {
      for (let c = 0; c < this.art.palette.length; c++) {
        const anyLeft = this.art.regions.some(
          (r, i) => r.c === c && !this.filled.has(i)
        );
        if (anyLeft) return c;
      }
      return 0;
    }

    _select(idx) {
      this.selected = idx;
      this.swatchEls.forEach((b, i) =>
        b.classList.toggle("active", i === idx)
      );
      // 선택한 번호에 해당하는 남은 영역 강조(테두리+배경+숫자 모두)
      this.regionEls.forEach(({ shape, text, region }, i) => {
        const isTarget = region.c === idx && !this.filled.has(i);
        shape.classList.toggle("target", isTarget);
        if (text) text.classList.toggle("target-num", isTarget);
      });
    }

    _tap(i) {
      if (this._moved) return;            // 드래그였으면 무시
      if (this.filled.has(i)) return;     // 이미 칠함
      const region = this.art.regions[i];
      if (region.c === this.selected) {
        this._paint(i, true);
        this.filled.add(i);
        saveProgress(this.art.id, [...this.filled]);
        this._tick();                      // 효과음+진동
        this._armHint();                   // 힌트 타이머 리셋
        this._findIdx = -1;
        if (window.AppStats) window.AppStats.paint(); // 통계
        this._afterPaint(i);
      } else {
        // 색이 안 맞음 → 흔들기 피드백
        const el = this.regionEls[i].shape;
        el.classList.remove("shake");
        void el.offsetWidth;
        el.classList.add("shake");
      }
    }

    _paint(i, animate) {
      const { shape, text, region } = this.regionEls[i];
      // 인라인 style로 칠해야 CSS(.region{fill}) 규칙을 이깁니다
      const hex = this.art.palette[region.c].hex;
      shape.style.fill = hex;
      // 사진 도안: 경계선도 같은 색으로 → 완성 부분이 이음새 없이 매끈
      if (this.art.custom) shape.style.stroke = hex;
      // 미니맵에도 칠하기
      if (this.minimap) this._drawRegionOnCtx(this.minimap.ctx, region, hex);
      shape.classList.add("filled");
      shape.classList.remove("target");
      if (animate) shape.classList.add("pop");
      if (text) text.style.display = "none";
    }

    _afterPaint(i) {
      this._updateProgress();
      const c = this.art.regions[i].c;
      this.colorDone[c]++;
      this._updateRing(c);
      const colorDone = this.colorDone[c] >= this.colorTotal[c];
      if (colorDone) {
        // 한 색 완료: 링 초록 + ✓ 배지 + 팔레트 원에서 파티클 터짐
        const sw = this.swatchEls[c];
        sw.classList.add("done");
        sw.classList.remove("donePop");
        void sw.offsetWidth;
        sw.classList.add("donePop");
        const r = sw.getBoundingClientRect();
        this._burst(r.left + r.width / 2, r.top + r.height / 2, this.art.palette[c].hex);
        if (this.filled.size < this.art.regions.length) {
          this._select(this._firstUnfinishedColor());
        }
      } else if (c === this.selected) {
        this._select(c); // 강조 갱신
      }
      if (this.filled.size === this.art.regions.length) {
        setTimeout(() => this.onComplete && this.onComplete(this.art), 400);
      }
    }

    _updateProgress() {
      const done = this.filled.size;
      const total = this.art.regions.length;
      const pct = Math.round((done / total) * 100);
      this.progressEl.textContent = pct + "%";
    }

    /* ── 확대/이동/핀치 ── */
    _applyTransform() {
      this.viewport.style.transform =
        `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
      // 미니맵 위치 사각형은 프레임당 1회만 갱신(레이아웃 읽기 절약)
      if (!this._mmPending) {
        this._mmPending = true;
        requestAnimationFrame(() => {
          this._mmPending = false;
          this._updateMinimapView();
        });
      }
    }

    _bindZoomPan(stage) {
      // 사진 도안(칸이 작음)은 더 크게 확대 가능
      const maxScale = this.art.custom ? 16 : 6;
      const clampScale = (s) => Math.max(1, Math.min(maxScale, s));

      stage.addEventListener("pointerdown", (e) => {
        stage.setPointerCapture(e.pointerId);
        this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this._pointers.size === 1) {
          this._moved = false;
          this._last = { x: e.clientX, y: e.clientY };
        } else if (this._pointers.size === 2) {
          const pts = [...this._pointers.values()];
          this._pinchStart = {
            dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
            scale: this.scale,
          };
        }
      });

      stage.addEventListener("pointermove", (e) => {
        if (!this._pointers.has(e.pointerId)) return;
        this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (this._pointers.size === 2 && this._pinchStart) {
          const pts = [...this._pointers.values()];
          const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          this.scale = clampScale(
            (this._pinchStart.scale * dist) / this._pinchStart.dist
          );
          this._moved = true;
          this._applyTransform();
        } else if (this._pointers.size === 1 && this.scale > 1) {
          const dx = e.clientX - this._last.x;
          const dy = e.clientY - this._last.y;
          if (Math.abs(dx) + Math.abs(dy) > 4) this._moved = true;
          this.tx += dx;
          this.ty += dy;
          this._last = { x: e.clientX, y: e.clientY };
          this._applyTransform();
        }
      });

      const up = (e) => {
        const wasSingle = this._pointers.size === 1;
        this._pointers.delete(e.pointerId);
        if (this._pointers.size < 2) this._pinchStart = null;
        if (this._pointers.size === 0) {
          // 움직임이 거의 없었으면 '탭'으로 간주해 해당 영역 색칠
          if (wasSingle && !this._moved) {
            const hit = document.elementFromPoint(e.clientX, e.clientY);
            if (hit && hit.classList.contains("region") && hit.dataset.i != null) {
              this._tap(Number(hit.dataset.i));
            }
          }
          this._moved = false;
        }
      };
      stage.addEventListener("pointerup", up);
      stage.addEventListener("pointercancel", up);

      // 데스크톱: 휠 줌
      stage.addEventListener("wheel", (e) => {
        e.preventDefault();
        this.scale = clampScale(this.scale - e.deltaY * 0.001 * this.scale);
        if (this.scale === 1) {
          this.tx = 0;
          this.ty = 0;
        }
        this._applyTransform();
      }, { passive: false });
    }
  }

  window.ColoringEngine = ColoringEngine;
  window.ColoringStore = { getProgress, loadAllProgress };
})();
