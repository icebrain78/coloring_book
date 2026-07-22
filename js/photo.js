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

  /*
   * ── Felzenszwalb 그래프 세그멘테이션 ──
   * 셀을 노드로, 이웃 셀 간 색차를 간선 가중치로 하는 그래프에서
   * "영역 내부의 색 변화 + k/크기" 보다 약한 간선만 병합한다.
   * → 색이 서서히 변하는 긴 붓터치는 끝까지 한 조각으로 이어지고,
   *   뚜렷한 이음새(간선 가중치 큰 곳)에서만 끊긴다.
   * k가 클수록 큰 조각. 반환: 0..count-1 로 재매긴 라벨 grid.
   */
  function fhSegment(labCells, cols, rows, k) {
    const N = cols * rows;
    const parent = new Int32Array(N);
    const size = new Int32Array(N).fill(1);
    const intd = new Float32Array(N); // 컴포넌트 내부 최대 간선 가중치
    for (let i = 0; i < N; i++) parent[i] = i;
    const find = (x) => {
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    };
    const edges = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        if (x < cols - 1) edges.push([Math.sqrt(dist2(labCells[i], labCells[i + 1])), i, i + 1]);
        if (y < rows - 1) edges.push([Math.sqrt(dist2(labCells[i], labCells[i + cols])), i, i + cols]);
      }
    }
    edges.sort((a, b) => a[0] - b[0]);
    for (let e = 0; e < edges.length; e++) {
      const w = edges[e][0];
      const a = find(edges[e][1]), b = find(edges[e][2]);
      if (a === b) continue;
      const ta = intd[a] + k / size[a], tb = intd[b] + k / size[b];
      if (w <= Math.min(ta, tb)) {
        parent[b] = a;
        size[a] += size[b];
        intd[a] = Math.max(intd[a], Math.max(intd[b], w));
      }
    }
    const grid = new Int32Array(N);
    const map = new Map();
    for (let i = 0; i < N; i++) {
      const r = find(i);
      if (!map.has(r)) map.set(r, map.size);
      grid[i] = map.get(r);
    }
    return { grid, count: map.size };
  }

  /*
   * ── 방향장(orientation field) ──
   * 이미지의 결(그라디언트의 수직 방향)을 계산하고 부드럽게 편 각도 맵.
   * 붓터치가 이 방향을 따라 흐른다. 결이 약한 평평한 영역은 주변 방향을
   * 물려받고, 그래도 없으면 은은하게 굽이치는 기본 흐름을 쓴다.
   */
  function orientationField(cells, cols, rows) {
    const N = cols * rows;
    const lum = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      lum[i] = 0.299 * cells[i][0] + 0.587 * cells[i][1] + 0.114 * cells[i][2];
    }
    // 3×3 블러
    const bl = new Float32Array(N);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            s += lum[ny * cols + nx]; n++;
          }
        }
        bl[y * cols + x] = s / n;
      }
    }
    // Sobel → 획 방향(그라디언트 수직)을 배각(2θ) 벡터로
    let vx = new Float32Array(N), vy = new Float32Array(N);
    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        const i = y * cols + x;
        const gx =
          bl[i - cols + 1] + 2 * bl[i + 1] + bl[i + cols + 1] -
          bl[i - cols - 1] - 2 * bl[i - 1] - bl[i + cols - 1];
        const gy =
          bl[i + cols - 1] + 2 * bl[i + cols] + bl[i + cols + 1] -
          bl[i - cols - 1] - 2 * bl[i - cols] - bl[i - cols + 1];
        const theta = Math.atan2(gy, gx) + Math.PI / 2;
        const mag = Math.hypot(gx, gy);
        vx[i] = mag * Math.cos(2 * theta);
        vy[i] = mag * Math.sin(2 * theta);
      }
    }
    // 방향 스무딩(3회) — 결이 약한 곳이 주변 흐름을 물려받게
    for (let pass = 0; pass < 3; pass++) {
      const nvx = new Float32Array(N), nvy = new Float32Array(N);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          let sx = 0, sy = 0, n = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx2 = x + dx, ny2 = y + dy;
              if (nx2 < 0 || ny2 < 0 || nx2 >= cols || ny2 >= rows) continue;
              const j = ny2 * cols + nx2;
              sx += vx[j]; sy += vy[j]; n++;
            }
          }
          nvx[y * cols + x] = sx / n;
          nvy[y * cols + x] = sy / n;
        }
      }
      vx = nvx; vy = nvy;
    }
    const ang = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const m = Math.hypot(vx[i], vy[i]);
      if (m < 0.6) {
        // 결이 없는 곳: 은은하게 굽이치는 기본 흐름
        const x = i % cols, y = (i / cols) | 0;
        ang[i] = 0.55 * Math.sin(x * 0.045 + y * 0.02) + 0.55 * Math.cos(y * 0.038);
      } else {
        ang[i] = Math.atan2(vy[i], vx[i]) / 2;
      }
    }
    return ang;
  }

  /*
   * ── 유화 붓터치 합성 ──
   * 방향장을 따라 흐르는 붓터치를 촘촘히 그려서 라벨 grid를 만든다.
   * 획은 색이 뚜렷이 바뀌는 경계를 넘지 않으므로 형태는 유지되고,
   * 평평한 영역도 전부 획 조각으로 나뉜다(조각 하나 = 붓터치 하나).
   */
  function oilStrokes(cells, cols, rows, strokeW, strokeLen) {
    const N = cols * rows;
    const ang = orientationField(cells, cols, rows);
    const labels = new Int32Array(N).fill(-1);
    const r = Math.max(1, strokeW / 2);
    const spacing = Math.max(1.5, strokeW * 0.9);
    const tol = 34 * 34 * 3; // 획이 넘지 못하는 색 경계(RGB 거리²)

    // 살짝 흔들린 격자 위치를 무작위 순서로
    const pos = [];
    for (let y = 0; y < rows; y += spacing) {
      for (let x = 0; x < cols; x += spacing) {
        pos.push([
          x + (Math.random() - 0.5) * spacing,
          y + (Math.random() - 0.5) * spacing,
        ]);
      }
    }
    for (let i = pos.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = pos[i]; pos[i] = pos[j]; pos[j] = t;
    }

    const stamp = (fx, fy, lab) => {
      const x0 = Math.max(0, Math.round(fx - r)), x1 = Math.min(cols - 1, Math.round(fx + r));
      const y0 = Math.max(0, Math.round(fy - r)), y1 = Math.min(rows - 1, Math.round(fy + r));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x - fx, dy = y - fy;
          if (dx * dx + dy * dy <= r * r) labels[y * cols + x] = lab;
        }
      }
    };

    let id = 0;
    for (const p of pos) {
      const cx = Math.min(cols - 1, Math.max(0, p[0]));
      const cy = Math.min(rows - 1, Math.max(0, p[1]));
      const c0 = cells[(cy | 0) * cols + (cx | 0)];
      const path = [[cx, cy]];
      // 시작점에서 양방향으로 방향장을 따라 걷기(곡선 획)
      for (const dir of [1, -1]) {
        let x = cx, y = cy;
        for (let s = 0; s < strokeLen / 2; s++) {
          const a = ang[(y | 0) * cols + (x | 0)];
          const nx = x + Math.cos(a) * dir;
          const ny = y + Math.sin(a) * dir;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) break;
          const c = cells[(ny | 0) * cols + (nx | 0)];
          const dr = c[0] - c0[0], dg = c[1] - c0[1], db = c[2] - c0[2];
          if (dr * dr + dg * dg + db * db > tol) break; // 색 경계에서 멈춤
          x = nx; y = ny;
          if (dir === 1) path.push([x, y]); else path.unshift([x, y]);
        }
      }
      for (const q of path) stamp(q[0], q[1], id);
      id++;
    }

    // 아직 안 덮인 셀은 가장 가까운 획으로 채움(다중 시작 BFS)
    const queue = [];
    for (let i = 0; i < N; i++) if (labels[i] !== -1) queue.push(i);
    let head = 0;
    while (head < queue.length) {
      const i = queue[head++];
      const x = i % cols, y = (i / cols) | 0;
      if (x > 0 && labels[i - 1] === -1) { labels[i - 1] = labels[i]; queue.push(i - 1); }
      if (x < cols - 1 && labels[i + 1] === -1) { labels[i + 1] = labels[i]; queue.push(i + 1); }
      if (y > 0 && labels[i - cols] === -1) { labels[i - cols] = labels[i]; queue.push(i - cols); }
      if (y < rows - 1 && labels[i + cols] === -1) { labels[i + cols] = labels[i]; queue.push(i + cols); }
    }
    return { grid: labels, count: id };
  }

  /* 라벨 grid 기준으로 벡터(vecs)의 라벨별 평균 */
  function averageBy(grid, vecs, count) {
    const dim = vecs[0].length;
    const sum = Array.from({ length: count }, () => new Float64Array(dim + 1));
    for (let i = 0; i < grid.length; i++) {
      const s = sum[grid[i]], v = vecs[i];
      for (let d = 0; d < dim; d++) s[d] += v[d];
      s[dim]++;
    }
    return sum.map((s) => {
      const out = new Array(dim);
      for (let d = 0; d < dim; d++) out[d] = s[d] / (s[dim] || 1);
      return out;
    });
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

    // 2) 선명화(이목구비·붓터치 대비 강화)
    cells = unsharp(cells, cols, rows, 0.7);
    const labCells = cells.map(rgb2lab);

    // 3) 영역 나누기 — 두 방식:
    //    'oil' 유화 붓터치 합성(기본): 방향장을 따라 획을 그려서 평평한
    //          영역까지 전부 붓터치 조각으로 나눈다.
    //    'seg' 그래프 세그멘테이션: 색 경계를 따라 영역을 키운다.
    let seg;
    if (opts.style === "seg") {
      const fhK = opts.fhK || 9;
      seg = fhSegment(labCells, cols, rows, fhK);
    } else {
      const strokeW = Math.max(2.4, cols / 85);
      seg = oilStrokes(cells, cols, rows, strokeW, strokeW * 4.5);
    }
    let segLab = averageBy(seg.grid, labCells, seg.count);

    // 4) 작은 조각 병합(주변과 대비 큰 조각 — 눈동자 등 — 은 보존)
    let grid = mergeSmall(seg.grid, cols, rows, minRegion, segLab);

    // 5) 최종 연결 요소
    const { list, comp } = components(grid, cols, rows);

    // 6) 라벨(세그먼트)별 평균 RGB/Lab·크기 집계
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

    // 7) 팔레트 축소: 세그먼트 대표색들을 k-means로 K개 그룹으로.
    //    영역 경계는 그대로 → 이웃 조각이 같은 번호를 공유할 수 있는
    //    실제 페인팅 키트 방식.
    let clusterOf; // usedLabels 인덱스 → 클러스터 번호
    if (usedLabels.length <= K) {
      clusterOf = usedLabels.map((_, i) => i);
    } else {
      const pts = usedLabels.map((l) => rgb2lab(avgRGB[l]));
      clusterOf = Array.from(kmeans(pts, K, 12).labels);
    }
    // 클러스터별 가중 평균 RGB → 팔레트 색
    const cSum = {};
    usedLabels.forEach((l, i) => {
      const cl = clusterOf[i];
      if (!cSum[cl]) cSum[cl] = [0, 0, 0, 0];
      const s = cSum[cl], c = avgRGB[l], w = weightOf[l];
      s[0] += c[0] * w; s[1] += c[1] * w; s[2] += c[2] * w; s[3] += w;
    });
    const clusters = Object.keys(cSum).map((cl) => ({
      cl: +cl,
      rgb: [cSum[cl][0] / cSum[cl][3], cSum[cl][1] / cSum[cl][3], cSum[cl][2] / cSum[cl][3]],
    }));
    clusters.sort((a, b) => luminance(a.rgb) - luminance(b.rgb));
    const clusterToIdx = {};
    const palette = clusters.map((o, idx) => {
      clusterToIdx[o.cl] = idx;
      return { hex: toHex(o.rgb), name: "색 " + (idx + 1) };
    });
    const labelToIdx = {};
    usedLabels.forEach((l, i) => { labelToIdx[l] = clusterToIdx[clusterOf[i]]; });

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
