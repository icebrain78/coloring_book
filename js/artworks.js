/*
 * artworks.js
 * 내장 도안(색칠 그림) 데이터.
 *
 * 좌표계는 0 0 1000 1000 기준.
 * 각 도안:
 *   id      : 저장/식별용 고유 키
 *   title   : 갤러리에 보이는 이름
 *   palette : 색 배열. 배열 index 0 = 화면 번호 "1"
 *             { hex: 색상, name: 이름 }
 *   regions : 색칠 영역 배열. 렌더 순서 = 배열 순서(뒤로 갈수록 위에 그려짐)
 *             c    : palette 인덱스(0부터). 화면에는 c+1 로 표시.
 *             shape: 'rect' | 'circle' | 'ellipse' | 'polygon' | 'path'
 *             나머지 속성은 shape 별 SVG 속성.
 *
 * 새 도안을 추가하려면 이 배열에 객체 하나만 더 넣으면 됩니다.
 */
window.ARTWORKS = [
  /* ───────────────────────── 1. 산속 오두막 ───────────────────────── */
  {
    id: "cabin",
    title: "산속 오두막",
    palette: [
      { hex: "#AEE3F5", name: "하늘" },
      { hex: "#FFD23F", name: "해" },
      { hex: "#8CC878", name: "언덕" },
      { hex: "#4E9A51", name: "진한 언덕" },
      { hex: "#E06C5E", name: "지붕" },
      { hex: "#F3E9D2", name: "벽" },
      { hex: "#8B5E3C", name: "나무·문" },
      { hex: "#7FC5E8", name: "창문" },
    ],
    regions: [
      { c: 0, shape: "rect", x: 0, y: 0, w: 1000, h: 660 },        // 하늘
      { c: 1, shape: "circle", cx: 815, cy: 175, r: 95 },          // 해
      { c: 2, shape: "rect", x: 0, y: 620, w: 1000, h: 380 },      // 앞 언덕(초록 바닥)
      { c: 3, shape: "ellipse", cx: 210, cy: 800, rx: 430, ry: 250 }, // 뒤 언덕 좌
      { c: 3, shape: "ellipse", cx: 830, cy: 830, rx: 400, ry: 240 }, // 뒤 언덕 우
      { c: 6, shape: "rect", x: 150, y: 610, w: 44, h: 160 },      // 나무 기둥
      { c: 3, shape: "circle", cx: 172, cy: 560, r: 100 },         // 나무 잎
      { c: 5, shape: "rect", x: 360, y: 560, w: 280, h: 250 },     // 벽
      { c: 4, shape: "polygon", points: "330,565 670,565 500,415" }, // 지붕
      { c: 7, shape: "rect", x: 392, y: 600, w: 74, h: 74, rx: 6 },  // 창문 좌
      { c: 7, shape: "rect", x: 534, y: 600, w: 74, h: 74, rx: 6 },  // 창문 우
      { c: 6, shape: "rect", x: 458, y: 665, w: 84, h: 145, rx: 8 }, // 문
    ],
  },

  /* ───────────────────────── 2. 과일 바구니 ───────────────────────── */
  {
    id: "fruit",
    title: "과일 바구니",
    palette: [
      { hex: "#FBE7C6", name: "배경" },
      { hex: "#E4572E", name: "사과" },
      { hex: "#F2A65A", name: "오렌지" },
      { hex: "#6FB03A", name: "잎" },
      { hex: "#7A4A24", name: "바구니" },
      { hex: "#FFCE3A", name: "바나나" },
      { hex: "#9B5DE5", name: "포도" },
      { hex: "#C98A5E", name: "테이블" },
    ],
    regions: [
      { c: 0, shape: "rect", x: 0, y: 0, w: 1000, h: 1000 },       // 배경
      { c: 7, shape: "rect", x: 0, y: 745, w: 1000, h: 255 },      // 테이블
      { c: 5, shape: "path", d: "M300,520 Q360,395 525,415 Q430,485 372,565 Z" }, // 바나나
      { c: 1, shape: "circle", cx: 400, cy: 560, r: 120 },         // 사과 1
      { c: 2, shape: "circle", cx: 525, cy: 475, r: 95 },          // 오렌지
      { c: 1, shape: "circle", cx: 615, cy: 600, r: 108 },         // 사과 2
      { c: 6, shape: "circle", cx: 705, cy: 505, r: 34 },          // 포도
      { c: 6, shape: "circle", cx: 663, cy: 545, r: 34 },
      { c: 6, shape: "circle", cx: 747, cy: 545, r: 34 },
      { c: 6, shape: "circle", cx: 690, cy: 588, r: 34 },
      { c: 6, shape: "circle", cx: 734, cy: 588, r: 34 },
      { c: 3, shape: "polygon", points: "395,445 445,398 452,452" }, // 잎
      { c: 4, shape: "polygon", points: "232,742 768,742 700,958 300,958" }, // 바구니 몸통
      { c: 4, shape: "rect", x: 212, y: 712, w: 576, h: 52, rx: 26 }, // 바구니 테두리
    ],
  },

  /* ───────────────────────── 3. 바다 요트 ───────────────────────── */
  {
    id: "sailboat",
    title: "바다 요트",
    palette: [
      { hex: "#BFEAF5", name: "하늘" },
      { hex: "#F9D371", name: "해" },
      { hex: "#2E86AB", name: "바다" },
      { hex: "#F4F4F4", name: "돛" },
      { hex: "#E63946", name: "배" },
      { hex: "#6F9CEB", name: "앞돛" },
      { hex: "#8B5E3C", name: "돛대" },
      { hex: "#DFF3FA", name: "구름·물결" },
    ],
    regions: [
      { c: 0, shape: "rect", x: 0, y: 0, w: 1000, h: 540 },        // 하늘
      { c: 2, shape: "rect", x: 0, y: 540, w: 1000, h: 460 },      // 바다
      { c: 1, shape: "circle", cx: 175, cy: 175, r: 110 },         // 해
      { c: 7, shape: "circle", cx: 700, cy: 190, r: 70 },          // 구름
      { c: 7, shape: "circle", cx: 640, cy: 215, r: 55 },
      { c: 7, shape: "circle", cx: 770, cy: 210, r: 58 },
      { c: 7, shape: "ellipse", cx: 300, cy: 815, rx: 130, ry: 22 }, // 물결
      { c: 7, shape: "ellipse", cx: 720, cy: 860, rx: 150, ry: 24 },
      { c: 6, shape: "rect", x: 552, y: 300, w: 16, h: 345 },      // 돛대
      { c: 3, shape: "polygon", points: "568,305 568,620 775,620" }, // 큰 돛
      { c: 5, shape: "polygon", points: "548,360 548,620 405,620" }, // 앞돛
      { c: 4, shape: "polygon", points: "378,640 722,640 662,762 438,762" }, // 배
    ],
  },
];

/* ───────────────────────── 추가 도안 (생성기 포함) ───────────────────────── */
(function () {
  const P = (r, a, cx, cy) => (cx + r * Math.cos(a)).toFixed(1) + " " + (cy + r * Math.sin(a)).toFixed(1);

  /* 꽃잎 path: 중심(cx,cy)에서 각도 a 방향, r0(밑)~r1(끝), halfw(반폭 라디안) */
  function petal(cx, cy, a, r0, r1, halfw) {
    const b1 = P(r0, a - halfw, cx, cy);
    const b2 = P(r0, a + halfw, cx, cy);
    const c1 = P(r1 * 0.92, a - halfw, cx, cy);
    const c2 = P(r1 * 0.92, a + halfw, cx, cy);
    const tip = P(r1, a, cx, cy);
    return "M" + b1 + "Q" + c1 + " " + tip + "Q" + c2 + " " + b2 + "Z";
  }

  /* ── 만다라 ── */
  const mandala = {
    id: "mandala",
    title: "만다라",
    palette: [
      { hex: "#F6F1E7", name: "배경" },
      { hex: "#E4572E", name: "주홍" },
      { hex: "#F2A65A", name: "귤색" },
      { hex: "#FFD23F", name: "노랑" },
      { hex: "#6FB03A", name: "초록" },
      { hex: "#2E86AB", name: "파랑" },
      { hex: "#9B5DE5", name: "보라" },
      { hex: "#D64550", name: "장미" },
    ],
    regions: [{ c: 0, shape: "rect", x: 0, y: 0, w: 1000, h: 1000 }],
  };
  (function () {
    const cx = 500, cy = 500;
    // 바깥 점 16개
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      mandala.regions.push({ c: 3 + (i % 2) * 3, shape: "circle",
        cx: +(cx + 452 * Math.cos(a)).toFixed(1), cy: +(cy + 452 * Math.sin(a)).toFixed(1), r: 22 });
    }
    // 3겹 꽃잎: 바깥(16) → 중간(12) → 안(8)
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      mandala.regions.push({ c: 5 + (i % 2), shape: "path", d: petal(cx, cy, a, 210, 420, 0.16) });
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
      mandala.regions.push({ c: 1 + (i % 2), shape: "path", d: petal(cx, cy, a, 130, 300, 0.2) });
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      mandala.regions.push({ c: 2 + (i % 2), shape: "path", d: petal(cx, cy, a, 60, 190, 0.3) });
    }
    mandala.regions.push({ c: 3, shape: "circle", cx: cx, cy: cy, r: 78 });
    mandala.regions.push({ c: 7, shape: "circle", cx: cx, cy: cy, r: 40 });
  })();

  /* ── 해바라기 ── */
  const sunflower = {
    id: "sunflower",
    title: "해바라기",
    palette: [
      { hex: "#BFEAF5", name: "하늘" },
      { hex: "#FFD23F", name: "꽃잎" },
      { hex: "#F2A65A", name: "속꽃잎" },
      { hex: "#7A4A24", name: "씨앗" },
      { hex: "#4E9A51", name: "줄기·잎" },
      { hex: "#8CC878", name: "밝은 잎" },
      { hex: "#FFFFFF", name: "구름" },
    ],
    regions: [
      { c: 0, shape: "rect", x: 0, y: 0, w: 1000, h: 1000 },
      { c: 6, shape: "circle", cx: 170, cy: 160, r: 62 },
      { c: 6, shape: "circle", cx: 250, cy: 185, r: 50 },
      { c: 6, shape: "circle", cx: 110, cy: 190, r: 46 },
      { c: 4, shape: "rect", x: 478, y: 560, w: 44, h: 440 },
      { c: 5, shape: "path", d: "M478,760 Q330,700 300,580 Q430,610 478,700 Z" },
      { c: 4, shape: "path", d: "M522,830 Q670,780 705,660 Q570,690 522,770 Z" },
    ],
  };
  (function () {
    const cx = 500, cy = 360;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      sunflower.regions.push({ c: 1, shape: "path", d: petal(cx, cy, a, 130, 300, 0.19) });
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.PI / 10;
      sunflower.regions.push({ c: 2, shape: "path", d: petal(cx, cy, a, 90, 190, 0.26) });
    }
    sunflower.regions.push({ c: 3, shape: "circle", cx: cx, cy: cy, r: 105 });
  })();

  /* ── 무지개 하늘 ── */
  function arcBand(cx, cy, r0, r1) {
    return "M" + (cx - r1) + " " + cy +
      "A" + r1 + " " + r1 + " 0 0 1 " + (cx + r1) + " " + cy +
      "L" + (cx + r0) + " " + cy +
      "A" + r0 + " " + r0 + " 0 0 0 " + (cx - r0) + " " + cy + "Z";
  }
  const rainbow = {
    id: "rainbow",
    title: "무지개",
    palette: [
      { hex: "#CDEBF7", name: "하늘" },
      { hex: "#E63946", name: "빨강" },
      { hex: "#F2A65A", name: "주황" },
      { hex: "#FFD23F", name: "노랑" },
      { hex: "#6FB03A", name: "초록" },
      { hex: "#2E86AB", name: "파랑" },
      { hex: "#9B5DE5", name: "보라" },
      { hex: "#FFFFFF", name: "구름" },
      { hex: "#8CC878", name: "언덕" },
    ],
    regions: [
      { c: 0, shape: "rect", x: 0, y: 0, w: 1000, h: 1000 },
      { c: 1, shape: "path", d: arcBand(500, 830, 380, 440) },
      { c: 2, shape: "path", d: arcBand(500, 830, 320, 380) },
      { c: 3, shape: "path", d: arcBand(500, 830, 260, 320) },
      { c: 4, shape: "path", d: arcBand(500, 830, 200, 260) },
      { c: 5, shape: "path", d: arcBand(500, 830, 140, 200) },
      { c: 6, shape: "path", d: arcBand(500, 830, 80, 140) },
      { c: 8, shape: "ellipse", cx: 500, cy: 1000, rx: 640, ry: 190 },
      { c: 7, shape: "circle", cx: 150, cy: 810, r: 80 },
      { c: 7, shape: "circle", cx: 250, cy: 840, r: 66 },
      { c: 7, shape: "circle", cx: 85, cy: 855, r: 58 },
      { c: 7, shape: "circle", cx: 850, cy: 810, r: 80 },
      { c: 7, shape: "circle", cx: 748, cy: 843, r: 64 },
      { c: 7, shape: "circle", cx: 918, cy: 855, r: 56 },
      { c: 7, shape: "circle", cx: 220, cy: 170, r: 62 },
      { c: 7, shape: "circle", cx: 300, cy: 195, r: 50 },
      { c: 3, shape: "circle", cx: 820, cy: 160, r: 82 },
    ],
  };

  /* ── 열대어 ── */
  const fish = {
    id: "tropical-fish",
    title: "열대어",
    palette: [
      { hex: "#A7DCEB", name: "바다" },
      { hex: "#F2A65A", name: "몸통" },
      { hex: "#E4572E", name: "줄무늬" },
      { hex: "#FFD23F", name: "지느러미" },
      { hex: "#FFFFFF", name: "배·눈" },
      { hex: "#1D3557", name: "눈동자" },
      { hex: "#4E9A51", name: "해초" },
      { hex: "#E8D9B0", name: "모래" },
      { hex: "#CDEBF7", name: "물방울" },
    ],
    regions: [
      { c: 0, shape: "rect", x: 0, y: 0, w: 1000, h: 1000 },
      { c: 7, shape: "ellipse", cx: 500, cy: 1010, rx: 620, ry: 160 },
      { c: 6, shape: "path", d: "M120,940 Q90,780 150,660 Q180,780 160,940 Z" },
      { c: 6, shape: "path", d: "M210,950 Q230,800 190,700 Q260,790 250,950 Z" },
      { c: 6, shape: "path", d: "M860,950 Q830,810 880,700 Q910,810 895,950 Z" },
      { c: 3, shape: "polygon", points: "270,470 130,360 160,500 130,640 270,530" },
      { c: 1, shape: "ellipse", cx: 520, cy: 500, rx: 270, ry: 185 },
      { c: 3, shape: "path", d: "M470,318 Q520,220 620,240 Q560,300 545,330 Z" },
      { c: 3, shape: "path", d: "M480,680 Q530,770 630,755 Q565,695 550,668 Z" },
      { c: 2, shape: "path", d: "M430,330 Q410,500 430,668 Q490,500 430,330 Z" },
      { c: 2, shape: "path", d: "M560,330 Q545,500 560,665 Q625,495 560,330 Z" },
      { c: 4, shape: "ellipse", cx: 660, cy: 560, rx: 90, ry: 60 },
      { c: 4, shape: "circle", cx: 685, cy: 445, r: 42 },
      { c: 5, shape: "circle", cx: 697, cy: 445, r: 20 },
      { c: 8, shape: "circle", cx: 840, cy: 300, r: 30 },
      { c: 8, shape: "circle", cx: 890, cy: 210, r: 22 },
      { c: 8, shape: "circle", cx: 850, cy: 130, r: 16 },
    ],
  };

  window.ARTWORKS.push(mandala, sunflower, rainbow, fish);
})();
