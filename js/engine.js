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
      if (art.custom) {
        // 브러시 선택(순환: 유화→수채→크레용→단색) — 브러시마다 질감·소리 다름
        const BRUSHES = ["oil", "water", "crayon", "flat"];
        const BRUSH_ICON = { oil: "🖌️", water: "💧", crayon: "🖍️", flat: "⬜" };
        const BRUSH_NAME = { oil: "유화", water: "수채", crayon: "크레용", flat: "단색" };
        const texBtn = document.createElement("button");
        texBtn.className = "c-mute-btn";
        const syncTex = () => {
          const k = this._brushKind();
          texBtn.textContent = BRUSH_ICON[k] || "🖌️";
          texBtn.title = "브러시: " + (BRUSH_NAME[k] || k) + " (누르면 변경)";
        };
        texBtn.onclick = () => {
          const k = this._brushKind();
          const next = BRUSHES[(BRUSHES.indexOf(k) + 1) % BRUSHES.length];
          localStorage.setItem("coloring:brush:v1", next);
          syncTex();
          // 이미 칠한 조각들 새 브러시로 다시 채우기
          this.filled.forEach((i) => {
            const { shape, region } = this.regionEls[i];
            shape.style.fill = next === "flat"
              ? this.art.palette[region.c].hex
              : this._svgBrushFill(region.c, this._variantOf(i));
          });
          this._previewCanvasFor = null; // 완성본 미리보기 다시 렌더
        };
        syncTex();
        top.append(back, title, texBtn, muteBtn, previewBtn, this.progressEl);
      } else {
        top.append(back, title, muteBtn, previewBtn, this.progressEl);
      }

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
      // 색→조각 index 목록(선택/강조를 해당 색만 순회하기 위한 인덱스)
      this.colorRegions = art.palette.map(() => []);
      art.regions.forEach((region, i) => {
        const shape = createRegionEl(region);
        shape.setAttribute("class", "region");
        shape.dataset.i = i;
        shape.dataset.c = region.c;
        svg.appendChild(shape);
        this.regionEls.push({ shape, text: null, region });
        this.colorRegions[region.c].push(i);
      });
      this._targeted = []; // 현재 강조 중인 조각 index들
      this._activeSwatch = null;
      this._numsHidden = null;
      this._defs = null; // 브러시 패턴 정의(svg별로 새로 생성)
      this._patterns = {};
      this.guideEl = null; // 길잡이 화살표(무대별로 새로 생성)
      this._guideOn = false;

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
        // 짧게 탭: 색 선택 / 길게(0.45초): 남은 조각 방향 안내(빨간 화살표)
        let lpTimer = null, lpFired = false;
        b.addEventListener("pointerdown", () => {
          lpFired = false;
          clearTimeout(lpTimer);
          lpTimer = setTimeout(() => {
            lpFired = true;
            this._select(idx);
            this._startGuide();
            if (navigator.vibrate) navigator.vibrate(15);
          }, 450);
        });
        ["pointerup", "pointerleave", "pointercancel"].forEach((ev) =>
          b.addEventListener(ev, () => clearTimeout(lpTimer))
        );
        b.onclick = () => { if (!lpFired) this._select(idx); };
        wrap.appendChild(b);
        palette.appendChild(wrap);
        this.swatchWraps.push(wrap);
        return b;
      });
      // 길게 누를 때 모바일 컨텍스트 메뉴 방지
      palette.addEventListener("contextmenu", (e) => e.preventDefault());

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
      this._updateNumsLOD(true);
    }

    /* 번호 LOD: 사진 도안은 축소 상태에서 번호를 숨겨 렌더 비용 절감
       (어차피 읽을 수 없는 크기 — 확대하면 나타남) */
    _updateNumsLOD(force) {
      if (!this.art.custom) return;
      const hide = this.scale < 2.2;
      if (!force && hide === this._numsHidden) return;
      this._numsHidden = hide;
      this.svg.classList.toggle("nums-off", hide);
    }

    /*
     * 뷰포트 컬링: 확대 상태에선 화면(+여유 40%) 밖 조각을 display:none.
     * 브라우저가 다시 그릴 대상이 수십 개로 줄어 고배율에서도
     * 즉시 선명해지고 터치가 밀리지 않는다. 대형 도안에서만 동작.
     */
    _updateCulling() {
      const n = this.art.regions.length;
      if (n <= 1500 || !this.bboxes) return;
      if (!this._cullState) this._cullState = new Uint8Array(n);
      const state = this._cullState;

      // 축소 상태: 컬링 해제(전부 표시)
      if (this.scale < 2.5) {
        if (this._culledAny) {
          for (let i = 0; i < n; i++) {
            if (state[i]) {
              state[i] = 0;
              this.regionEls[i].shape.classList.remove("cull");
              if (this.regionEls[i].text) this.regionEls[i].text.classList.remove("cull");
            }
          }
          this._culledAny = false;
        }
        return;
      }

      const svgR = this.svg.getBoundingClientRect();
      const stR = this.stageEl.getBoundingClientRect();
      if (!svgR.width || !svgR.height) return;
      const vw = this.art.w || 1000, vh = this.art.h || 1000;
      const sx = vw / svgR.width, sy = vh / svgR.height;
      let x0 = (stR.left - svgR.left) * sx, x1 = (stR.right - svgR.left) * sx;
      let y0 = (stR.top - svgR.top) * sy, y1 = (stR.bottom - svgR.top) * sy;
      const mx = (x1 - x0) * 0.4, my = (y1 - y0) * 0.4; // 여유분(빠른 팬 대비)
      x0 -= mx; x1 += mx; y0 -= my; y1 += my;

      for (let i = 0; i < n; i++) {
        const bb = this.bboxes[i];
        const off = bb[2] < x0 || bb[0] > x1 || bb[3] < y0 || bb[1] > y1 ? 1 : 0;
        if (off !== state[i]) {
          state[i] = off;
          const { shape, text } = this.regionEls[i];
          shape.classList.toggle("cull", !!off);
          if (text) text.classList.toggle("cull", !!off);
        }
      }
      this._culledAny = true;
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
      // 조각이 화면 중앙에 오도록 이동 — 컬링으로 숨겨져 있어도 되도록
      // 도안 좌표(bbox)로 계산
      const bb = this.bboxes[i];
      const cxArt = (bb[0] + bb[2]) / 2, cyArt = (bb[1] + bb[3]) / 2;
      const vw = this.art.w || 1000, vh = this.art.h || 1000;
      const svgR = this.svg.getBoundingClientRect();
      const st = this.stageEl.getBoundingClientRect();
      const px = svgR.left + (cxArt / vw) * svgR.width;
      const py = svgR.top + (cyArt / vh) * svgR.height;
      this.tx += st.left + st.width / 2 - px;
      this.ty += st.top + st.height / 2 - py;
      this._applyTransform();
      this._updateCulling(); // 목적지 조각이 바로 보이도록 즉시 컬링 갱신
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

    /* ── 브러시 질감(4종: 유화·수채·크레용·단색) ──
       색×브러시×변형(3방향)별 타일을 만들어두고 조각마다 고정 시드
       랜덤으로 골라 채운다. 브러시마다 색칠 소리도 다르다(_tick). */
    _brushKind() {
      if (!this.art.custom) return "flat";
      return localStorage.getItem("coloring:brush:v1") || "oil";
    }

    _variantOf(i) {
      return ((i * 2654435761) >>> 0) % 3; // 조각별 고정 '랜덤' 변형
    }

    /* 붓결 타일 캔버스(색+브러시+변형별 1회 생성, 전역 캐시) */
    _brushTile(hex, v, kind) {
      if (!ColoringEngine._tiles) ColoringEngine._tiles = {};
      const key = hex + "|" + kind + "|" + v;
      if (ColoringEngine._tiles[key]) return ColoringEngine._tiles[key];
      const S = 128;
      const cvs = document.createElement("canvas");
      cvs.width = S; cvs.height = S;
      const g = cvs.getContext("2d");
      g.fillStyle = hex;
      g.fillRect(0, 0, S, S);
      // 고정 시드 난수(같은 색·브러시·변형이면 항상 같은 질감)
      let seed = v * 7349 + 11;
      for (let k = 0; k < kind.length; k++) seed = (seed * 31 + kind.charCodeAt(k)) >>> 0;
      for (let k = 0; k < hex.length; k++) seed = (seed * 31 + hex.charCodeAt(k)) >>> 0;
      const rnd = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      const wb = (a) => "rgba(" + (rnd() > 0.5 ? "255,255,255" : "0,0,0") + "," + a.toFixed(3) + ")";

      if (kind === "water") {
        // 수채: 넓고 부드러운 얼룩 + 종이 알갱이
        for (let k = 0; k < 10; k++) {
          const x = rnd() * S, y = rnd() * S, r = 22 + rnd() * 46;
          const col = rnd() > 0.45 ? "255,255,255" : "0,0,0";
          const grad = g.createRadialGradient(x, y, 0, x, y, r);
          grad.addColorStop(0, "rgba(" + col + "," + (0.05 + rnd() * 0.06).toFixed(3) + ")");
          grad.addColorStop(1, "rgba(" + col + ",0)");
          g.fillStyle = grad;
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
        }
        for (let k = 0; k < 150; k++) {
          g.fillStyle = wb(0.02 + rnd() * 0.04);
          g.fillRect(rnd() * S, rnd() * S, 1.5, 1.5);
        }
      } else if (kind === "crayon") {
        // 크레용: 짧고 거친 긁힘 + 굵은 결
        const ang = [0.5, -0.4, 1.1][v % 3] + (rnd() - 0.5) * 0.2;
        g.translate(S / 2, S / 2); g.rotate(ang); g.translate(-S / 2, -S / 2);
        g.lineCap = "round";
        for (let k = 0; k < 95; k++) {
          const x = rnd() * S * 1.6 - S * 0.3, y = rnd() * S * 1.6 - S * 0.3;
          const len = 5 + rnd() * 15;
          g.strokeStyle = wb(0.05 + rnd() * 0.1);
          g.lineWidth = 1 + rnd() * 1.7;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + len, y + (rnd() - 0.5) * 5);
          g.stroke();
        }
        for (let k = 0; k < 7; k++) {
          const y = rnd() * S * 1.8 - S * 0.4;
          g.strokeStyle = wb(0.035 + rnd() * 0.05);
          g.lineWidth = 5 + rnd() * 8;
          g.beginPath();
          g.moveTo(-S * 0.5, y);
          g.lineTo(S * 1.5, y + (rnd() - 0.5) * 14);
          g.stroke();
        }
      } else {
        // 유화(기본): 긴 붓결 + 짧은 덧칠
        const ang = [0.35, -0.65, 1.25][v % 3] + (rnd() - 0.5) * 0.25;
        g.translate(S / 2, S / 2); g.rotate(ang); g.translate(-S / 2, -S / 2);
        g.lineCap = "round";
        for (let k = 0; k < 22; k++) {
          const y = rnd() * S * 2 - S * 0.5;
          g.strokeStyle = wb(0.028 + rnd() * 0.065);
          g.lineWidth = 2.5 + rnd() * 6;
          g.beginPath();
          g.moveTo(-S * 0.6, y);
          g.quadraticCurveTo(S * 0.5, y + (rnd() - 0.5) * 16, S * 1.6, y + (rnd() - 0.5) * 14);
          g.stroke();
        }
        for (let k = 0; k < 14; k++) {
          const x = rnd() * S * 1.6 - S * 0.3;
          const y = rnd() * S * 1.6 - S * 0.3;
          const len = 14 + rnd() * 30;
          g.strokeStyle = wb(0.035 + rnd() * 0.075);
          g.lineWidth = 3 + rnd() * 6;
          g.beginPath();
          g.moveTo(x, y);
          g.quadraticCurveTo(x + len * 0.5, y + (rnd() - 0.5) * 8, x + len, y + (rnd() - 0.5) * 6);
          g.stroke();
        }
      }
      ColoringEngine._tiles[key] = cvs;
      return cvs;
    }

    /* SVG <pattern>으로 등록하고 fill용 url 반환 */
    _svgBrushFill(c, v) {
      const kind = this._brushKind();
      const hex = this.art.palette[c].hex;
      const id = "bt-" + kind + "-" + hex.slice(1) + "-" + v;
      if (!this._defs) {
        this._defs = document.createElementNS(SVGNS, "defs");
        this.svg.insertBefore(this._defs, this.svg.firstChild);
      }
      if (!this._patterns[id]) {
        const pat = document.createElementNS(SVGNS, "pattern");
        pat.setAttribute("id", id);
        pat.setAttribute("patternUnits", "userSpaceOnUse");
        pat.setAttribute("width", "90");
        pat.setAttribute("height", "90");
        const img = document.createElementNS(SVGNS, "image");
        img.setAttribute("href", this._brushTile(hex, v, kind).toDataURL("image/png"));
        img.setAttribute("width", "90");
        img.setAttribute("height", "90");
        pat.appendChild(img);
        this._defs.appendChild(pat);
        this._patterns[id] = true;
      }
      return "url(#" + id + ")";
    }

    /* 색칠 효과음(브러시마다 다른 소리) + 진동 */
    _tick() {
      if (this.muted) return;
      try {
        if (!ColoringEngine._audio) {
          ColoringEngine._audio = new (window.AudioContext || window.webkitAudioContext)();
        }
        const ac = ColoringEngine._audio;
        const kind = this._brushKind();
        const n = this.filled.size;
        // 브러시별 음색: 유화=또렷한 톡, 수채=물방울(음 미끄러짐),
        // 크레용=사각사각(사각파+노이즈성 짧음), 단색=기본 틱
        let type = "sine", f0 = 620 + (n % 5) * 60, f1 = 0, dur = 0.09, vol = 0.09;
        if (kind === "water") { type = "sine"; f0 = 520 + (n % 4) * 40; f1 = f0 * 0.55; dur = 0.18; vol = 0.07; }
        else if (kind === "crayon") { type = "square"; f0 = 190 + (n % 3) * 26; dur = 0.045; vol = 0.045; }
        else if (kind === "oil") { type = "triangle"; f0 = 460 + (n % 5) * 55; dur = 0.11; vol = 0.09; }
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = type;
        o.frequency.setValueAtTime(f0, ac.currentTime);
        if (f1) o.frequency.exponentialRampToValueAtTime(f1, ac.currentTime + dur);
        g.gain.setValueAtTime(vol, ac.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
        o.connect(g).connect(ac.destination);
        o.start();
        o.stop(ac.currentTime + dur + 0.02);
      } catch (e) { /* 오디오 미지원 무시 */ }
      if (navigator.vibrate) navigator.vibrate(8);
    }

    /* ── 길잡이: 물감을 길게 누르면 남은 조각 방향을 빨간 화살표로 안내 ── */
    _startGuide() {
      if (!this.guideEl) {
        const el = document.createElement("div");
        el.className = "c-guide-arrow";
        el.textContent = "➤";
        this.stageEl.appendChild(el);
        this.guideEl = el;
      }
      this._guideOn = true;
      this._updateGuide();
    }

    _hideGuide() {
      this._guideOn = false;
      if (this.guideEl) this.guideEl.style.display = "none";
    }

    _updateGuide() {
      if (!this._guideOn || !this.guideEl) return;
      const c = this.selected;
      const remain = this.colorRegions[c].filter((i) => !this.filled.has(i));
      if (!remain.length) { this._hideGuide(); return; }
      const st = this.stageEl.getBoundingClientRect();
      const svgR = this.svg.getBoundingClientRect();
      if (!svgR.width) return;
      const vw = this.art.w || 1000, vh = this.art.h || 1000;
      const cx = st.left + st.width / 2, cy = st.top + st.height / 2;
      // 화면 중심에서 가장 가까운 남은 조각(화면 좌표 기준)
      let best = -1, bd = Infinity, bx = 0, by = 0;
      for (const i of remain) {
        const bb = this.bboxes[i];
        const px = svgR.left + (((bb[0] + bb[2]) / 2) / vw) * svgR.width;
        const py = svgR.top + (((bb[1] + bb[3]) / 2) / vh) * svgR.height;
        const dd = (px - cx) * (px - cx) + (py - cy) * (py - cy);
        if (dd < bd) { bd = dd; best = i; bx = px; by = py; }
      }
      // 화면 안에 있으면: 반짝여주고 안내 종료
      if (bx > st.left + 30 && bx < st.right - 30 && by > st.top + 70 && by < st.bottom - 30) {
        this._flash(best);
        this._hideGuide();
        return;
      }
      // 화면 밖: 가장자리에 방향 화살표
      const ang = Math.atan2(by - cy, bx - cx);
      const cosA = Math.cos(ang), sinA = Math.sin(ang);
      const rx = st.width / 2 - 46, ry = st.height / 2 - 46;
      const t = Math.min(
        cosA !== 0 ? rx / Math.abs(cosA) : Infinity,
        sinA !== 0 ? ry / Math.abs(sinA) : Infinity
      );
      const el = this.guideEl;
      el.style.display = "block";
      el.style.left = (cx + cosA * t - st.left) + "px";
      el.style.top = (cy + sinA * t - st.top) + "px";
      el.style.transform =
        "translate(-50%,-50%) rotate(" + ((ang * 180) / Math.PI).toFixed(1) + "deg)";
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
      // 완성본은 도안당 한 번만 렌더해서 재사용(질감 설정 바뀌면 다시)
      const cacheKey = art.id + ":" + this._brushKind();
      if (!this._previewCanvas || this._previewCanvasFor !== cacheKey) {
        const cvs = document.createElement("canvas");
        const W = 1400;
        cvs.width = W;
        cvs.height = Math.round((W * vh) / vw);
        const ctx = cvs.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, cvs.width, cvs.height);
        ctx.setTransform(W / vw, 0, 0, W / vw, 0, 0);
        const kind = this._brushKind();
        art.regions.forEach((r, i) => {
          const hex = art.palette[r.c].hex;
          const fill = kind === "flat"
            ? hex
            : ctx.createPattern(this._brushTile(hex, this._variantOf(i), kind), "repeat");
          this._drawRegionOnCtx(ctx, r, fill);
        });
        this._previewCanvas = cvs;
        this._previewCanvasFor = cacheKey;
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

    /* 각 영역 중앙에 번호 텍스트 배치(영역 위에 얹음) + 컬링용 bbox 저장 */
    _placeNumbers() {
      const custom = !!this.art.custom;
      const numRe = /-?\d+\.?\d*/g;
      this.bboxes = new Array(this.art.regions.length);
      this.art.regions.forEach((region, i) => {
        let w, h, px, py;
        if (region.shape === "path" && region.nx != null) {
          // 수천 조각 도안: getBBox(레이아웃 강제) 대신 path 좌표를 직접 파싱
          const nums = region.d.match(numRe);
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (let k = 0; k < nums.length; k += 2) {
            const x = +nums[k], y = +nums[k + 1];
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
          w = maxX - minX; h = maxY - minY;
          px = region.nx; py = region.ny;
          this.bboxes[i] = [minX, minY, maxX, maxY];
        } else {
          const bb = this.regionEls[i].shape.getBBox();
          w = bb.width; h = bb.height;
          px = region.nx != null ? region.nx : bb.x + w / 2;
          py = region.ny != null ? region.ny : bb.y + h / 2;
          this.bboxes[i] = [bb.x, bb.y, bb.x + w, bb.y + h];
        }
        const t = document.createElementNS(SVGNS, "text");
        t.setAttribute("x", px);
        t.setAttribute("y", py);
        t.setAttribute("class", "region-num");
        const minSize = custom ? 3.5 : 20;
        const size = Math.max(minSize, Math.min(60, Math.min(w, h) * 0.5));
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
      // 수천 조각 도안에서도 빠르도록: 전체 순회 대신
      // (이전 강조 목록) + (새 색의 조각 목록)만 만진다
      if (this._activeSwatch != null) {
        this.swatchEls[this._activeSwatch].classList.remove("active");
      }
      this.swatchEls[idx].classList.add("active");
      this._activeSwatch = idx;
      this.selected = idx;

      for (const i of this._targeted) {
        const { shape, text } = this.regionEls[i];
        shape.classList.remove("target");
        if (text) text.classList.remove("target-num");
      }
      this._targeted = [];
      for (const i of this.colorRegions[idx]) {
        if (this.filled.has(i)) continue;
        const { shape, text } = this.regionEls[i];
        shape.classList.add("target");
        if (text) text.classList.add("target-num");
        this._targeted.push(i);
      }
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
        if (this._guideOn) this._updateGuide(); // 다음 남은 조각으로 안내 갱신
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
      shape.style.fill = this._brushKind() === "flat"
        ? hex
        : this._svgBrushFill(region.c, this._variantOf(i));
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
      }
      // (색이 남아있으면 방금 칠한 조각의 강조는 _paint에서 이미 제거됨 —
      //  전체 재강조는 불필요해서 하지 않는다. 5000조각에서 중요한 최적화)
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
      this._updateNumsLOD();
      // 미니맵 위치 사각형은 프레임당 1회만 갱신(레이아웃 읽기 절약)
      if (!this._mmPending) {
        this._mmPending = true;
        requestAnimationFrame(() => {
          this._mmPending = false;
          this._updateMinimapView();
          this._updateGuide(); // 화면을 움직이면 길잡이 화살표도 따라감
        });
      }
      // 컬링은 조작이 멈춘 뒤 한 번만(120ms 디바운스)
      clearTimeout(this._cullTimer);
      this._cullTimer = setTimeout(() => this._updateCulling(), 120);
    }

    _bindZoomPan(stage) {
      // 사진 도안(칸이 작음)은 더 크게 확대 가능
      const maxScale = this.art.custom ? 16 : 6;
      const clampScale = (s) => Math.max(1, Math.min(maxScale, s));

      stage.addEventListener("pointerdown", (e) => {
        try { stage.setPointerCapture(e.pointerId); } catch (err) {} // 일부 환경 방어
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
