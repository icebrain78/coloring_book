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
      back.onclick = () => this.onExit && this.onExit();
      const title = document.createElement("div");
      title.className = "c-title";
      title.textContent = art.title;
      this.progressEl = document.createElement("div");
      this.progressEl.className = "c-progress";
      top.append(back, title, this.progressEl);

      /* 캔버스 영역(줌 무대) */
      const stage = document.createElement("div");
      stage.className = "c-stage";
      const viewport = document.createElement("div");
      viewport.className = "c-viewport";
      const svg = document.createElementNS(SVGNS, "svg");
      svg.setAttribute("viewBox", "0 0 1000 1000");
      svg.setAttribute("class", "c-svg");
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
      this.swatchEls = art.palette.map((col, idx) => {
        const b = document.createElement("button");
        b.className = "swatch";
        b.style.background = col.hex;
        b.dataset.idx = idx;
        const num = document.createElement("span");
        num.className = "swatch-num";
        num.textContent = idx + 1;
        b.appendChild(num);
        b.onclick = () => this._select(idx);
        palette.appendChild(b);
        return b;
      });

      this.root.append(top, stage, palette);

      // SVG가 DOM에 붙은 뒤에야 getBBox가 실제 크기를 반환 → 번호는 지금 배치
      this._placeNumbers();
      this._applyFilledState();
      this._select(this._firstUnfinishedColor());
      this._updateProgress();
      this._bindZoomPan(stage);
    }

    /* 각 영역 중앙에 번호 텍스트 배치(영역 위에 얹음) */
    _placeNumbers() {
      this.art.regions.forEach((region, i) => {
        const shape = this.regionEls[i].shape;
        const bb = shape.getBBox();
        const t = document.createElementNS(SVGNS, "text");
        t.setAttribute("x", bb.x + bb.width / 2);
        t.setAttribute("y", bb.y + bb.height / 2);
        t.setAttribute("class", "region-num");
        const size = Math.max(20, Math.min(60, Math.min(bb.width, bb.height) * 0.42));
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
      // 선택한 번호에 해당하는 남은 영역 강조
      this.regionEls.forEach(({ shape, region }, i) => {
        const isTarget = region.c === idx && !this.filled.has(i);
        shape.classList.toggle("target", isTarget);
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
      shape.style.fill = this.art.palette[region.c].hex;
      shape.classList.add("filled");
      shape.classList.remove("target");
      if (animate) shape.classList.add("pop");
      if (text) text.style.display = "none";
    }

    _afterPaint(i) {
      this._updateProgress();
      const c = this.art.regions[i].c;
      // 해당 색 완료 표시
      const colorDone = !this.art.regions.some(
        (r, idx) => r.c === c && !this.filled.has(idx)
      );
      if (colorDone) {
        this.swatchEls[c].classList.add("done");
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
    }

    _bindZoomPan(stage) {
      const clampScale = (s) => Math.max(1, Math.min(6, s));

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
