/*
 * ads.js — AdMob 광고 (Capacitor 안드로이드 앱에서만 동작)
 *
 * 웹 브라우저(내 테스트용 웹버전)에서는 Capacitor가 없으므로 모든 함수가
 * 조용히 아무 일도 하지 않는다(no-op). 즉 웹 버전 동작은 전혀 바뀌지 않는다.
 *
 * UX 3원칙:
 *   1) 색칠하는 동안엔 광고 0  → 배너는 갤러리에서만, 색칠 진입 시 즉시 숨김
 *   2) 전면광고는 완성 축하 뒤 "갤러리로" 나갈 때만, 3번에 1번 꼴
 *   3) 보상형은 자발적(💡 버튼) — 강요 아님
 */
(function () {
  // ── 배포 스위치 ──────────────────────────────────────────────
  // true  : 구글 "테스트 광고"만 표시(계정 정지 위험 없음). 개발/검증용.
  // false : 실제 광고 표시. Play 스토어 배포 직전에만 false 로 바꾼다.
  const USE_TEST_ADS = true;

  // 내 실제 광고 단위(배포 시 사용)
  const REAL = {
    banner: "ca-app-pub-7584566407757353/5479429051",
    interstitial: "ca-app-pub-7584566407757353/9765444410",
    rewarded: "ca-app-pub-7584566407757353/5139803694",
  };
  // 구글 공식 테스트 광고 단위(개발 중 안전)
  const TEST = {
    banner: "ca-app-pub-3940256099942544/6300978111",
    interstitial: "ca-app-pub-3940256099942544/1033173712",
    rewarded: "ca-app-pub-3940256099942544/5224354917",
  };
  const IDS = USE_TEST_ADS ? TEST : REAL;

  // 전면광고 빈도: 완성 후 이 횟수마다 1번(3 = 3번에 1번)
  const INTERSTITIAL_EVERY = 3;

  // "광고 제거"(향후 인앱결제용) 저장 키
  const REMOVE_KEY = "coloring:noads:v1";

  // 네이티브(Capacitor 앱)에서만 AdMob 플러그인을 돌려준다. 웹이면 null.
  function admob() {
    const Cap = window.Capacitor;
    if (!Cap || typeof Cap.isNativePlatform !== "function" || !Cap.isNativePlatform())
      return null;
    return (Cap.Plugins && Cap.Plugins.AdMob) || null;
  }

  const Ads = {
    _ready: false,
    _bannerShown: false,
    _interCount: 0,

    // ── 광고 제거 상태 ──
    removed() {
      try { return localStorage.getItem(REMOVE_KEY) === "1"; } catch (e) { return false; }
    },
    setRemoved(v) {
      try { localStorage.setItem(REMOVE_KEY, v ? "1" : "0"); } catch (e) {}
      if (v) this.hideBanner();
    },

    // ── 초기화(앱 부팅 시 1회) ──
    async init() {
      const m = admob();
      if (!m || this.removed()) return;
      try {
        await m.initialize({ initializeForTesting: USE_TEST_ADS });
        this._ready = true;
      } catch (e) {
        // 초기화 실패해도 앱은 정상 동작(광고만 안 나옴)
      }
    },

    // ── 배너: 갤러리 화면 하단에만 ──
    async showGalleryBanner() {
      const m = admob();
      if (!m || !this._ready || this.removed() || this._bannerShown) return;
      try {
        await m.showBanner({
          adId: IDS.banner,
          adSize: "ADAPTIVE_BANNER",
          position: "BOTTOM_CENTER",
          margin: 0,
          isTesting: USE_TEST_ADS,
        });
        this._bannerShown = true;
      } catch (e) {}
    },
    async hideBanner() {
      const m = admob();
      if (!m || !this._bannerShown) return;
      try { await m.hideBanner(); } catch (e) {}
      this._bannerShown = false;
    },

    // ── 전면광고: 완성 후 "갤러리로" 나갈 때만, 3번에 1번 ──
    async maybeInterstitial() {
      const m = admob();
      if (!m || !this._ready || this.removed()) return;
      this._interCount++;
      if (this._interCount % INTERSTITIAL_EVERY !== 0) return;
      try {
        await m.prepareInterstitial({ adId: IDS.interstitial, isTesting: USE_TEST_ADS });
        await m.showInterstitial();
      } catch (e) {}
    },

    // ── 보상형: 자발적. 시청 완료 시 true(보상 지급 신호) ──
    rewardedAvailable() {
      return !!admob() && this._ready && !this.removed();
    },
    async rewarded() {
      const m = admob();
      if (!m || !this._ready || this.removed()) return false;
      try {
        await m.prepareRewardVideoAd({ adId: IDS.rewarded, isTesting: USE_TEST_ADS });
        const reward = await m.showRewardVideoAd();
        return !!reward; // AdMobRewardItem 반환 = 끝까지 시청함
      } catch (e) {
        return false;
      }
    },
  };

  window.Ads = Ads;
})();
