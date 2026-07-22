/*
 * photo.js
 * 사진 → 넘버링 색칠 도안 변환기 (전부 브라우저 안에서 처리, 서버 X)
 *
 *  1) 사진을 cols×rows 격자로 축소 (drawImage 다운스케일 = 셀 평균색)
 *  2) k-means 색 양자화 (20~32색)
 *  3) 모드 필터로 잡티 제거
 *  4) 같은 색 셀 연결(connected components) → 영역
 *  5) 작은 영역을 이웃에 병합
 *  6) 각 영역 윤곽선을 SVG path(d)로 추적 + 번호 위치(무게중심) 계산
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

  /* ── 모드 필터 (3×3 최빈값) ── */
  function modeFilter(grid, cols, rows) {
    const out = grid.slice();
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const counts = {};
        let best = grid[y * cols + x], bestc = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            const v = grid[ny * cols + nx];
            counts[v] = (counts[v] || 0) + 1;
            if (counts[v] > bestc) { bestc = counts[v]; best = v; }
          }
        }
        out[y * cols + x] = best;
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

  /* ── 작은 영역을 이웃 색으로 병합 ── */
  function mergeSmall(grid, cols, rows, minRegion) {
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
        if (bestLab !== null) { for (const p of cells) grid[p] = bestLab; changed = true; }
      }
      if (!changed) break;
    }
    return grid;
  }

  /* ── 한 영역의 윤곽선 → path d 문자열 ── */
  function tracePath(comp, id, cols, rows, cw, ch) {
    const inC = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && comp[y * cols + x] === id;
    const edges = new Map(); // "x,y" → [[x2,y2], ...]
    const add = (x1, y1, x2, y2) => {
      const k = x1 + "," + y1;
      if (!edges.has(k)) edges.set(k, []);
      edges.get(k).push([x2, y2]);
    };
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (comp[y * cols + x] !== id) continue;
        if (!inC(x, y - 1)) add(x, y, x + 1, y);         // 위
        if (!inC(x + 1, y)) add(x + 1, y, x + 1, y + 1); // 오른쪽
        if (!inC(x, y + 1)) add(x + 1, y + 1, x, y + 1); // 아래
        if (!inC(x - 1, y)) add(x, y + 1, x, y);         // 왼쪽
      }
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
    const r = (v) => Math.round(v * 10) / 10;
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
    const cells = new Array(N);
    for (let i = 0; i < N; i++) cells[i] = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];

    // 2) 양자화
    const { labels, centroids } = kmeans(cells, K, 14);

    // 3) 잡티 제거 → 4) 작은 영역 병합
    let grid = modeFilter(labels, cols, rows);
    grid = mergeSmall(grid, cols, rows, minRegion);

    // 5) 최종 연결 요소
    const { list, comp } = components(grid, cols, rows);

    // 6) 사용된 색만 팔레트로 remap (밝기순 정렬)
    const usedLabels = [...new Set(list.map((c) => c.label))];
    usedLabels.sort((a, b) => luminance(centroids[a]) - luminance(centroids[b]));
    const labelToIdx = {};
    const palette = usedLabels.map((lab, idx) => {
      labelToIdx[lab] = idx;
      return { hex: toHex(centroids[lab]), name: "색 " + (idx + 1) };
    });

    // 7) 영역 → path + 번호 위치
    const W = 1000, H = Math.round(1000 * rows / cols);
    const cw = W / cols, ch = H / rows;
    const regions = [];
    for (let id = 0; id < list.length; id++) {
      const cellsOf = list[id].cells;
      const d = tracePath(comp, id, cols, rows, cw, ch);
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
