/*
 * photo.js
 * 사진 → 넘버링 색칠 도안 변환기 (전부 브라우저 안에서 처리, 서버 X)
 *
 *  1) 사진을 cols×rows 격자로 축소 (drawImage 다운스케일 = 셀 평균색)
 *  2) 선명화(unsharp)로 이목구비 대비 강화
 *  3) Lab 색공간에서 k-means 양자화 (사람 눈 기준 색 분리)
 *  4) 모드 필터로 잡티 제거
 *  5) 같은 색 셀 연결(connected components) → 영역
 *  6) 작은 영역 병합 — 단, 주변과 색 대비가 큰 작은 영역(눈·입술 등)은 보존
 *  7) 각 영역 윤곽선을 곡선 path로 추적 + 번호 위치 계산
 *  → 기존 엔진과 같은 artwork 형식으로 반환
 */
window.PhotoConverter = (function () {
  function dist2(a, b) {
    const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
    return dr * dr + dg * dg + db * db;
  }
  function toHex(c) {
    const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
    return "#" + h(c[0]) + h(c[1]) + h(c[2]);
  }
  function luminance(c) { return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; }

  /* ── sRGB → Lab (지각적으로 균일한 색공간) ── */
  function rgb2lab(c) {
    let r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    const f = (v) => (v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92);
    r = f(r); g = f(g); b = f(b);
    let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
    let y = r * 0.2126 + g * 0.7152 + b * 0.0722;
    let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
    const t = (v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
    x = t(x); y = t(y); z = t(z);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }

  /* ── 언샤프 마스크: 3×3 블러 대비 강조 (이목구비 뭉개짐 방지) ── */
  function unsharp(cells, cols, rows, amount) {
    const out = new Array(cells.length);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let sr = 0, sg = 0, sb = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            const c = cells[ny * cols + nx];
            sr += c[0]; sg += c[1]; sb += c[2]; n++;
          }
        }
        const c = cells[y * cols + x];
        const clamp = (v) => Math.max(0, Math.min(255, v));
        out[y * cols + x] = [
          clamp(c[0] + amount * (c[0] - sr / n)),
          clamp(c[1] + amount * (c[1] - sg / n)),
          clamp(c[2] + amount * (c[2] - sb / n)),
        ];
      }
    }
    return out;
  }

  /* ── k-means (k-means++ 초기화) ── */
  function kmeans(cells, K, iters) {
    const N = cells.length;
    const centroids = [cells[(Math.random() * N) | 0].slice()];
    while (centroids.length < K) {
      const d2 = new Float64Array(N);
      let sum = 0;
      for (let i = 0; i < N; i++) {
        let m = Infinity;
        for (let k = 0; k < centroids.length; k++) {
          const dd = dist2(cells[i], centroids[k]);
          if (dd < m) m = dd;
        }
        d2[i] = m; sum += m;
      }
      let r = Math.random() * sum, idx = 0;
      for (let i = 0; i < N; i++) { r -= d2[i]; if (r <= 0) { idx = i; break; } }
      centroids.push(cells[idx].slice());
    }
    const labels = new Int32Array(N);
    const assign = () => {
      for (let i = 0; i < N; i++) {
        let m = Infinity, b = 0;
        for (let k = 0; k < K; k++) {
          const dd = dist2(cells[i], centroids[k]);
          if (dd < m) { m = dd; b = k; }
        }
        labels[i] = b;
      }
    };
    for (let it = 0; it < iters; it++) {
      assign();
      const sum = Array.from({ length: K }, () => [0, 0, 0, 0]);
      for (let i = 0; i < N; i++) {
        const k = labels[i], c = cells[i];
        sum[k][0] += c[0]; sum[k][1] += c[1]; sum[k][2] += c[2]; sum[k][3]++;
      }
      for (let k = 0; k < K; k++) {
        if (sum[k][3] > 0) centroids[k] = [sum[k][0] / sum[k][3], sum[k][1] / sum[k][3], sum[k][2] / sum[k][3]];
        else centroids[k] = cells[(Math.random() * N) | 0].slice();
      }
    }
    assign();
    return { labels, centroids };
  }

  /*
   * ── 모드 필터 (3×3 최빈값) ──
   * 완전히 고립된 셀(3×3 안에 같은 색이 자기뿐)만 최빈값으로 교체.
   * 붓터치처럼 폭 1~2칸짜리 가늘고 긴 획은 이웃에 같은 색이 이어져
   * 있으므로 지워지지 않는다(뭉개짐 방지).
   */
  function modeFilter(grid, cols, rows) {
    const out = grid.slice();
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const me = grid[y * cols + x];
        const counts = {};
        let best = me, bestc = 0, myc = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            const v = grid[ny * cols + nx];
            counts[v] = (counts[v] || 0) + 1;
            if (v === me) myc++;
            if (counts[v] > bestc) { bestc = counts[v]; best = v; }
          }
        }
        out[y * cols + x] = myc <= 1 ? best : me; // 고립 셀만 교체
      }
    }
    return out;
  }

  /* ── 연결 요소 (4-이웃) ── */
  function components(grid, cols, rows) {
    const N = cols * rows;
    const comp = new Int32Array(N).fill(-1);
    const list = [];
    const stack = [];
    for (let s = 0; s < N; s++) {
      if (comp[s] !== -1) continue;
      const label = grid[s], id = list.length, cells = [];
      comp[s] = id; stack.push(s);
      while (stack.length) {
        const p = stack.pop(); cells.push(p);
        const x = p % cols, y = (p / cols) | 0;
        const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
        for (let n = 0; n < 4; n++) {
          const nx = nb[n][0], ny = nb[n][1];
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const q = ny * cols + nx;
          if (comp[q] === -1 && grid[q] === label) { comp[q] = id; stack.push(q); }
        }
      }
      list.push({ label, cells });
    }
    return { list, comp };
  }

  /*
   * ── 작은 영역을 이웃 색으로 병합 ──
   * 단, "작지만 주변과 색 대비가 뚜렷한" 영역(눈동자·눈썹·입술 라인 등)은
   * 지우면 그림이 뭉개지므로 3칸 이상이면 병합하지 않고 보존한다.
   */
  function mergeSmall(grid, cols, rows, minRegion, labCentroids) {
    const KEEP_CONTRAST = 17; // Lab 색차. 이보다 크면 '뚜렷이 다른 색'
    grid = grid.slice();
    for (let pass = 0; pass < 8; pass++) {
      const { list, comp } = components(grid, cols, rows);
      const small = list
        .map((c, i) => ({ i, size: c.cells.length }))
        .filter((o) => o.size < minRegion)
        .sort((a, b) => a.size - b.size);
      if (!small.length) break;
      let changed = false;
      for (const o of small) {
        const cells = list[o.i].cells;
        const myLabel = list[o.i].label;
        const counts = {};
        for (const p of cells) {
          const x = p % cols, y = (p / cols) | 0;
          const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
          for (let n = 0; n < 4; n++) {
            const nx = nb[n][0], ny = nb[n][1];
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            const q = ny * cols + nx;
            if (comp[q] !== o.i) {
              const lab = grid[q];
              counts[lab] = (counts[lab] || 0) + 1;
            }
          }
        }
        let bestLab = null, bestc = -1;
        for (const k in counts) if (counts[k] > bestc) { bestc = counts[k]; bestLab = +k; }
        if (bestLab === null) continue;
        // 대비 보존: 3칸 이상 + 이웃과 색차가 크면 그대로 둔다
        if (o.size >= 3 && labCentroids) {
          const dd = Math.sqrt(dist2(labCentroids[myLabel], labCentroids[bestLab]));
          if (dd > KEEP_CONTRAST) continue;
        }
        for (const p of cells) grid[p] = bestLab;
        changed = true;
      }
      if (!changed) break;
    }
    return grid;
  }

  /* ── 한 영역의 윤곽선 → path d 문자열 (영역 셀만 순회) ── */
  function tracePath(comp, id, cellsOf, cols, rows, cw, ch) {
    const inC = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && comp[y * cols + x] === id;
    const edges = new Map(); // "x,y" → [[x2,y2], ...]
    const add = (x1, y1, x2, y2) => {
      const k = x1 + "," + y1;
      if (!edges.has(k)) edges.set(k, []);
      edges.get(k).push([x2, y2]);
    };
    for (const p of cellsOf) {
      const x = p % cols, y = (p / cols) | 0;
      if (!inC(x, y - 1)) add(x, y, x + 1, y);         // 위
      if (!inC(x + 1, y)) add(x + 1, y, x + 1, y + 1); // 오른쪽
      if (!inC(x, y + 1)) add(x + 1, y + 1, x, y + 1); // 아래
      if (!inC(x - 1, y)) add(x, y + 1, x, y);         // 왼쪽
    }
    const loops = [];
    for (const [startKey, arr] of edges) {
      while (arr.length) {
        const [sx, sy] = startKey.split(",").map(Number);
        let cx = sx, cy = sy;
        const loop = [[cx, cy]];
        let nxt = arr.shift();
        cx = nxt[0]; cy = nxt[1]; loop.push([cx, cy]);
        let guard = 0;
        while (!(cx === sx && cy === sy) && guard++ < 100000) {
          const nb = edges.get(cx + "," + cy);
          if (!nb || !nb.length) break;
          nxt = nb.shift();
          cx = nxt[0]; cy = nxt[1]; loop.push([cx, cy]);
        }
        loops.push(loop);
      }
    }
    let d = "";
    for (const loop of loops) {
      const pts = simplify(loop);
      if (pts.length < 3) continue;
      d += smoothRing(pts, cw, ch);
    }
    return d;
  }

  /* 직선 위 중간 꼭짓점 제거 */
  function simplify(loop) {
    const pts = loop.slice(0, loop.length - 1);
    const n = pts.length, out = [];
    for (let i = 0; i < n; i++) {
      const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (cross === 0) continue;
      out.push(b);
    }
    return out;
  }

  /*
   * 닫힌 다각형 → 모서리를 둥글린 곡선 path.
   * 각 꼭짓점에서 양쪽 변을 따라 최대 R(셀 1칸)까지 들어간 지점을 잇는
   * quadratic Bézier로 모서리만 둥글린다.
   *  - 격자 계단(변 길이 1칸)은 중점끼리 이어져 완만한 곡선이 되고,
   *  - 긴 직선 변은 직선 그대로 유지된다(띠 모양이 렌즈처럼 붕괴하지 않음).
   * 절단 거리 min(변/2, R)은 진행 방향을 뒤집어도 같으므로 이웃 영역과
   * 공유하는 경계가 같은 모양으로 그려져 이음새가 벌어지지 않는다.
   */
  function smoothRing(pts, cw, ch) {
    const n = pts.length;
    const P = pts.map((p) => [p[0] * cw, p[1] * ch]);
    const R = Math.min(cw, ch); // 모서리 반경 = 셀 1칸
    const r = (v) => Math.round(v); // 정수 좌표(0.1% 오차, 저장 용량 절약)
    const pt = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

    let d = "";
    for (let i = 0; i < n; i++) {
      const prev = P[(i - 1 + n) % n], v = P[i], next = P[(i + 1) % n];
      const lIn = len(prev, v), lOut = len(v, next);
      const tIn = Math.min(lIn / 2, R) / lIn;    // v에서 prev 쪽으로
      const tOut = Math.min(lOut / 2, R) / lOut; // v에서 next 쪽으로
      const a = pt(v, prev, tIn);
      const b = pt(v, next, tOut);
      d += (i === 0 ? "M" + r(a[0]) + " " + r(a[1]) : "L" + r(a[0]) + " " + r(a[1]));
      d += "Q" + r(v[0]) + " " + r(v[1]) + " " + r(b[0]) + " " + r(b[1]);
    }
    return d + "Z";
  }

  /* ── 메인 변환 ── */
  function convert(img, opts) {
    const K = opts.colors;
    const cols = opts.cols;
    const minRegion = opts.minRegion;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const rows = Math.max(8, Math.round(cols * ih / iw));

    // 1) 다운스케일 → 셀 평균색
    const cvs = document.createElement("canvas");
    cvs.width = cols; cvs.height = rows;
    const ctx = cvs.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cols, rows);
    const data = ctx.getImageData(0, 0, cols, rows).data;
    const N = cols * rows;
    let cells = new Array(N);
    for (let i = 0; i < N; i++) cells[i] = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];

    // 2) 선명화(이목구비·붓터치 대비 강화) → 3) Lab 공간에서 양자화
    cells = unsharp(cells, cols, rows, 0.7);
    const labCells = cells.map(rgb2lab);
    // 붓터치 보존의 핵심: 색을 사용자가 고른 K보다 훨씬 잘게(Kfine) 나눠
    // "비슷하지만 다른" 이웃 획이 별개 영역으로 분리되게 한다.
    // 팔레트는 아래 8)에서 K개로 응집 — 이웃 조각이 같은 번호를 공유할 수
    // 있는 실제 페인팅 키트 방식.
    const Kfine = Math.min(72, K * 2 + 8);
    const { labels, centroids } = kmeans(labCells, Kfine, 10);

    // 4) 잡티 제거 → 5) 작은 영역 병합(고대비 조각은 보존)
    let grid = modeFilter(labels, cols, rows);
    grid = mergeSmall(grid, cols, rows, minRegion, centroids);

    // 6) 최종 연결 요소
    const { list, comp } = components(grid, cols, rows);

    // 7) 세분 라벨별 평균 RGB·사용량 집계
    const usedLabels = [...new Set(list.map((c) => c.label))];
    const rgbSum = {};
    for (let i = 0; i < N; i++) {
      const lab = grid[i];
      if (!rgbSum[lab]) rgbSum[lab] = [0, 0, 0, 0];
      const s = rgbSum[lab], c = cells[i];
      s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; s[3]++;
    }
    const avgRGB = {}, weightOf = {};
    usedLabels.forEach((lab) => {
      const s = rgbSum[lab] || [128, 128, 128, 1];
      avgRGB[lab] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
      weightOf[lab] = s[3];
    });

    // 8) 팔레트 응집: 세분 클러스터를 색이 가까운 것끼리 합쳐 K개로.
    //    영역 경계(세분 기준)는 그대로 → 획 모양이 유지된다.
    let nodes = usedLabels.map((l) => ({
      labs: [l],
      c: centroids[l].slice(), // Lab
      w: weightOf[l],
    }));
    while (nodes.length > K) {
      let bi = -1, bj = -1, bd = Infinity;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dd = dist2(nodes[i].c, nodes[j].c);
          if (dd < bd) { bd = dd; bi = i; bj = j; }
        }
      }
      const a = nodes[bi], b = nodes[bj], w = a.w + b.w;
      a.c = [
        (a.c[0] * a.w + b.c[0] * b.w) / w,
        (a.c[1] * a.w + b.c[1] * b.w) / w,
        (a.c[2] * a.w + b.c[2] * b.w) / w,
      ];
      a.labs = a.labs.concat(b.labs);
      a.w = w;
      nodes.splice(bj, 1);
    }
    // 최종 팔레트 색 = 소속 세분 라벨들의 가중 평균 RGB
    nodes.forEach((n) => {
      let r = 0, g = 0, b = 0, w = 0;
      n.labs.forEach((l) => {
        const c = avgRGB[l], wl = weightOf[l];
        r += c[0] * wl; g += c[1] * wl; b += c[2] * wl; w += wl;
      });
      n.rgb = [r / w, g / w, b / w];
    });
    nodes.sort((a, b) => luminance(a.rgb) - luminance(b.rgb));
    const labelToIdx = {};
    const palette = nodes.map((n, idx) => {
      n.labs.forEach((l) => { labelToIdx[l] = idx; });
      return { hex: toHex(n.rgb), name: "색 " + (idx + 1) };
    });

    // 7) 영역 → path + 번호 위치
    const W = 1000, H = Math.round(1000 * rows / cols);
    const cw = W / cols, ch = H / rows;
    const regions = [];
    for (let id = 0; id < list.length; id++) {
      const cellsOf = list[id].cells;
      const d = tracePath(comp, id, cellsOf, cols, rows, cw, ch);
      if (!d) continue;
      // 무게중심에 가장 가까운 셀 → 번호 위치
      let mx = 0, my = 0;
      for (const p of cellsOf) { mx += p % cols; my += (p / cols) | 0; }
      mx /= cellsOf.length; my /= cellsOf.length;
      let best = cellsOf[0], bd = Infinity;
      for (const p of cellsOf) {
        const x = p % cols, y = (p / cols) | 0;
        const dd = (x - mx) * (x - mx) + (y - my) * (y - my);
        if (dd < bd) { bd = dd; best = p; }
      }
      const bx = best % cols, by = (best / cols) | 0;
      regions.push({
        c: labelToIdx[list[id].label],
        shape: "path",
        d,
        nx: (bx + 0.5) * cw,
        ny: (by + 0.5) * ch,
      });
    }

    return {
      id: "photo-" + Date.now(),
      title: "내 사진",
      custom: true,
      w: W, h: H,
      palette,
      regions,
    };
  }

  return { convert };
})();
