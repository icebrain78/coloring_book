# 🎨 컬러링 (Color by Number) — 광고 없는 웹앱

번호를 따라 색칠하는 힐링 컬러링 앱입니다. **광고·결제·로그인 전혀 없음.**
설치 없이 링크만 열면 폰에서 앱처럼 동작하고, "홈 화면에 추가"하면 아이콘이 생깁니다(PWA).

| | |
|---|---|
| 기술 | 순수 HTML/CSS/JavaScript (빌드 도구·서버 불필요) |
| 저장 | 진행상황은 폰 안에 자동 저장 (localStorage) |
| 오프라인 | 서비스워커로 캐시 → 비행기 모드에서도 동작 |
| 내장 도안 | 산속 오두막 · 과일 바구니 · 바다 요트 (3종) |
| **사진 변환** | 내 사진 → 넘버링 도안 자동 변환 (16~32색, 전부 폰 안에서 처리) |

### 📷 내 사진으로 만들기

갤러리 첫 카드 **"내 사진으로 만들기"** 를 누르면:

1. **사진 선택** → 앨범/카메라에서 고르기 (사진은 서버로 전송되지 않고 폰 안에서만 처리)
2. **색 개수** 선택: 16 / 20 / 24 / **32**
3. **정밀도** 선택: 쉬움 / 보통 / 자세히 / **최고**
   (최고 = 실제 페인팅 키트 수준의 세밀함. 칸이 잘아지므로 확대(최대 16배)해서 칠하기)
4. **미리보기 만들기** → 완성 모습 미리 확인, 마음에 안 들면 옵션 바꿔 다시
5. **이 그림 색칠 시작** → 갤러리에 저장되고 이어칠하기 가능

변환 원리(전부 브라우저 내부): 색 양자화(k-means) → 잡티 제거 → 같은 색 영역 묶기
→ 작은 조각 병합 → 윤곽선 추적 → 번호 배치.

---

## 1. 내 컴퓨터에서 바로 실행해보기

이 폴더(`coloring-app/`)에서 아래 한 줄이면 됩니다:

```bash
python3 -m http.server 8099
```

그리고 브라우저에서 `http://localhost:8099` 접속.
(파일을 그냥 더블클릭해도 색칠은 되지만, 오프라인 캐시는 `http://`로 열어야 켜집니다.)

## 2. 폰에서 진짜 앱처럼 쓰기 — GitHub Pages 무료 배포

폰에서 쓰려면 인터넷 주소(HTTPS)가 필요합니다. GitHub Pages가 **무료**입니다.

1. 저장소 페이지에서 **⚙️ Settings → Pages** 이동
   (주소: `https://github.com/icebrain78/coloring_book/settings/pages`)
2. **Source**: `Deploy from a branch` 선택
3. **Branch**: `main`, 폴더 `/ (root)` → **Save**
4. 1~2분 뒤 나오는 주소로 접속:
   ```
   https://icebrain78.github.io/coloring_book/
   ```
5. 폰 브라우저(크롬/사파리)에서 그 주소 열기 → **메뉴 → 홈 화면에 추가**
   → 홈 화면에 컬러링 아이콘 생성, 전체화면 앱처럼 실행 ✅

---

## 3. 도안(그림) 추가하는 법

`js/artworks.js` 의 `ARTWORKS` 배열에 객체 하나만 더 넣으면 갤러리에 자동 등장합니다.
좌표계는 `0 0 1000 1000`. 각 영역은 `c`(색 번호, 0부터) 와 도형을 지정합니다.

```js
{
  id: "myart",                 // 고유 키(저장용)
  title: "내 그림",
  palette: [                   // 배열 index 0 = 화면 번호 "1"
    { hex: "#AEE3F5", name: "하늘" },
    { hex: "#E06C5E", name: "지붕" },
  ],
  regions: [
    { c: 0, shape: "rect",   x: 0, y: 0, w: 1000, h: 600 },        // 하늘(색1)
    { c: 1, shape: "circle", cx: 500, cy: 700, r: 120 },           // 원(색2)
    // shape: rect | circle | ellipse | polygon | path
    // polygon → points:"x1,y1 x2,y2 ...", path → d:"M... Z"
  ],
}
```

번호는 각 영역의 중심에 자동 배치됩니다(직접 좌표 안 넣어도 됨).

---

## 4. 클라우드 동기화(회원가입) 설정 — 5분

기본 저장은 브라우저 안(localStorage)이라 브라우저 데이터를 지우거나 다른
기기로 가면 사라집니다. **무료 Supabase**를 연결하면 이메일 회원가입 +
기기 간 자동 동기화가 켜집니다. (연결 전에도 "백업 저장/불러오기" 버튼으로
파일 백업은 가능)

1. [supabase.com](https://supabase.com) 가입 → **New project** (무료 플랜)
2. 왼쪽 **SQL Editor** → 아래 SQL 붙여넣고 **Run**:

   ```sql
   create table public.user_data (
     user_id uuid primary key references auth.users(id) on delete cascade,
     payload jsonb not null default '{}'::jsonb,
     updated_at timestamptz not null default now()
   );
   alter table public.user_data enable row level security;
   create policy "own data" on public.user_data
     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
   ```

3. **Authentication → Sign In / Up** 에서 *Confirm email* 을 **끄기**
   (켜두면 가입 후 메일 확인 링크를 눌러야 로그인됩니다 — 취향대로)
4. **Project Settings → API** 에서 두 값 복사:
   - Project URL (예: `https://abcdefghij.supabase.co`)
   - `anon` `public` 키
5. 이 저장소의 `js/cloud-config.js` 를 GitHub 웹에서 편집해 두 값을 넣고 커밋:

   ```js
   window.CLOUD_CONFIG = {
     url: "https://abcdefghij.supabase.co",
     anonKey: "eyJhbGciOi...",
   };
   ```

> anon 키는 공개돼도 괜찮은 키입니다. 데이터 접근은 행 단위 보안규칙(RLS)이
> 막아줘요 — 위 SQL의 policy가 "자기 데이터만 읽고 쓸 수 있음"을 보장합니다.

배포가 반영되면 갤러리 상단에 **"☁️ 로그인 / 회원가입"** 버튼이 나타납니다.

### 도안 공유 기능용 테이블 (추가 SQL — 한 번 실행)

내 사진 도안의 🔗 버튼으로 공유 링크를 만들려면 아래 SQL도 실행해두세요:

```sql
create table public.shared_art (
  id text primary key,
  owner uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  payload jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.shared_art enable row level security;
create policy "anyone can read" on public.shared_art
  for select using (true);
create policy "owner can insert" on public.shared_art
  for insert with check (auth.uid() = owner);
create policy "owner can delete" on public.shared_art
  for delete using (auth.uid() = owner);
```

공유 링크(`...?share=도안id`)를 받은 사람은 로그인 없이도 도안을 받아
자기 갤러리에서 색칠할 수 있습니다.

---

## 안드로이드 APK 만들기 (PWABuilder — 코딩 불필요)

이 앱은 PWA라서 [PWABuilder](https://www.pwabuilder.com)에 주소만 넣으면
설치형 안드로이드 앱(APK/AAB)이 나옵니다:

1. https://www.pwabuilder.com 접속
2. 주소창에 `https://icebrain78.github.io/coloring_book/` 입력 → **Start**
3. 점수 확인 후 **Package for Stores → Android**
4. 옵션 기본값으로 **Download** → `.apk` 파일 생성
5. APK를 폰에 옮겨 설치 (설정에서 "출처를 알 수 없는 앱 허용" 필요)
   — Play 스토어에 올리려면 같은 화면의 `.aab` + 개발자 계정($25)을 사용

앱 아이콘용 PNG(192/512)와 manifest는 이미 준비되어 있습니다.

---

## 5. 다음 단계 (로드맵)

이번 v1은 **엔진 + 내장 도안 + PWA**까지 완성했습니다. 이어서:

- [ ] **내 사진 → 넘버링 도안 자동 변환**
  - 브라우저에서: 이미지 → 색상 양자화(k-means로 N색 축소) → 영역 라벨링 → 각 영역 번호 부여
  - 같은 `regions` 데이터 형식으로 출력하도록 만들면 엔진은 그대로 재사용
- [ ] 도안 더 추가 (동물/풍경/캐릭터), 난이도(색 개수) 옵션
- [ ] 완성작 이미지로 저장/공유(canvas → PNG 내보내기)
- [ ] **안드로이드 APK**: 이 웹앱을 그대로 감싸서 앱으로 배포
  - 가장 쉬운 길: [PWABuilder](https://www.pwabuilder.com) 에 배포 주소 입력 → APK 생성
  - 또는 Flutter/Capacitor 로 WebView 래핑

---

## 폴더 구조

```
coloring_book/              (저장소 루트)
├── index.html              앱 껍데기
├── manifest.webmanifest    PWA 설정(홈 화면 설치)
├── sw.js                   서비스워커(오프라인 캐시)
├── assets/icon.svg         앱 아이콘
├── css/style.css           스타일
└── js/
    ├── artworks.js         도안 데이터 (여기에 그림 추가)
    ├── engine.js           색칠 엔진 (렌더/탭/줌/저장)
    └── app.js              갤러리·화면전환·완성 축하
```
