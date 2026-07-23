/*
 * billing.js — "광고 제거" 인앱결제 구조 (수익화)
 *
 * 실제 결제는 Google Play Billing 이 필요합니다:
 *   1) Play Console 에 앱 등록(등록비 $25, 1회)
 *   2) 인앱상품(관리형) 추가 — 상품 ID: remove_ads
 *   3) 결제 플러그인 연결(RevenueCat 권장) 후 아래 store()/buyRemoveAds() 채우기
 *
 * 결제 성공 시 Ads.setRemoved(true) 로 모든 광고를 끕니다(로컬 저장).
 * 플러그인이 아직 없으면 "준비 중" 안내만 하고 아무 것도 끄지 않습니다.
 */
(function () {
  const PRODUCT_ID = "remove_ads"; // Play Console 인앱상품 ID

  function native() {
    const Cap = window.Capacitor;
    return !!(Cap && typeof Cap.isNativePlatform === "function" && Cap.isNativePlatform());
  }

  // 결제 플러그인 감지(연결되면 자동으로 잡힘). 없으면 null.
  function store() {
    const Cap = window.Capacitor;
    // RevenueCat(@revenuecat/purchases-capacitor)
    if (Cap && Cap.Plugins && Cap.Plugins.Purchases) return { kind: "revenuecat", api: Cap.Plugins.Purchases };
    // CdvPurchase(cordova-plugin-purchase)
    if (window.CdvPurchase && window.CdvPurchase.store) return { kind: "cdvpurchase", api: window.CdvPurchase };
    return null;
  }

  const Billing = {
    productId: PRODUCT_ID,
    available() { return native(); },
    removed() { return !!(window.Ads && window.Ads.removed && window.Ads.removed()); },

    // 광고 제거 구매. 반환: { ok, already?, notReady?, message? }
    async buyRemoveAds() {
      if (this.removed()) return { ok: true, already: true };
      const s = store();
      if (!s) {
        return {
          ok: false,
          notReady: true,
          message:
            "결제 기능 준비 중이에요.\n" +
            "Play Console에 앱을 올리고 인앱상품(remove_ads)을 등록한 뒤 " +
            "결제 플러그인을 연결하면 바로 작동합니다.",
        };
      }
      try {
        // TODO(결제 연결): 플러그인별 실제 구매 호출.
        //  - RevenueCat:  await s.api.purchaseProduct({ productIdentifier: PRODUCT_ID })
        //  - CdvPurchase: s.api.store.get(PRODUCT_ID).getOffer().order() 등
        // 구매/검증 성공 후에만 아래 실행:
        if (window.Ads) window.Ads.setRemoved(true);
        return { ok: true };
      } catch (e) {
        return { ok: false, message: (e && e.message) || "결제에 실패했어요" };
      }
    },

    // 이전 구매 복원(기기 변경/재설치 시)
    async restore() {
      const s = store();
      if (!s) return { ok: false, notReady: true };
      try {
        // TODO(결제 연결): 복원 조회 후 소유 확인되면 setRemoved(true)
        return { ok: true };
      } catch (e) {
        return { ok: false, message: (e && e.message) || "복원 실패" };
      }
    },
  };

  window.Billing = Billing;
})();
