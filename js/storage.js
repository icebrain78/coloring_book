/*
 * storage.js
 * 대용량 데이터(사진 도안, 조각별 브러시 기록)를 IndexedDB에 저장.
 *
 * localStorage는 약 5MB 제한이라 세밀 도안 몇 개면 가득 차서
 * 진행 저장이 실패하는 사고가 났다 → 큰 데이터를 IndexedDB(수백 MB)로.
 *
 * 사용법:
 *  - AppDB.ready(Promise)가 끝난 뒤부터 사용 (app.js 부팅에서 대기)
 *  - AppDB.getCustom()/setCustom(list), getBrushes()/setBrushes(map)
 *    — 읽기는 메모리 캐시라 동기, 쓰기는 캐시 갱신 + 비동기 영속화
 *  - 첫 실행 시 localStorage의 기존 데이터를 자동 이관하고
 *    localStorage에서 제거해 용량을 확보한다
 *  - IndexedDB를 못 쓰는 환경이면 localStorage로 자동 폴백
 */
window.AppDB = (function () {
  const LS_CUSTOM = "coloring:custom:v1";
  const LS_BRUSHES = "coloring:brushes:v1";
  const cache = { custom: null, brushes: null };
  let db = null;
  let fallback = false;
  let warned = false;

  function warn(msg) {
    if (warned) return;
    warned = true;
    if (window.AppToast) window.AppToast(msg);
  }

  function loadFromLS() {
    try { cache.custom = JSON.parse(localStorage.getItem(LS_CUSTOM)) || []; }
    catch (e) { cache.custom = []; }
    try { cache.brushes = JSON.parse(localStorage.getItem(LS_BRUSHES)) || {}; }
    catch (e) { cache.brushes = {}; }
  }

  function idbSet(key, val) {
    if (fallback || !db) {
      // 폴백: localStorage (기존 방식)
      try {
        localStorage.setItem(key === "custom" ? LS_CUSTOM : LS_BRUSHES, JSON.stringify(val));
      } catch (e) {
        warn("⚠️ 저장 공간이 가득 차서 도안이 저장되지 않아요! 안 쓰는 도안을 삭제해주세요.");
      }
      return;
    }
    try {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(val, key);
      tx.onerror = () => warn("⚠️ 도안 저장에 실패했어요(기기 저장 공간 확인).");
    } catch (e) {
      warn("⚠️ 도안 저장에 실패했어요(기기 저장 공간 확인).");
    }
  }

  /* 첫 실행: localStorage 데이터를 IndexedDB로 이관하고 LS에서 제거 */
  function migrate() {
    try {
      if (cache.custom == null) {
        const ls = localStorage.getItem(LS_CUSTOM);
        cache.custom = ls ? JSON.parse(ls) : [];
        if (ls) {
          idbSet("custom", cache.custom);
          localStorage.removeItem(LS_CUSTOM); // 5MB 용량 즉시 확보
        }
      }
      if (cache.brushes == null) {
        const ls = localStorage.getItem(LS_BRUSHES);
        cache.brushes = ls ? JSON.parse(ls) : {};
        if (ls) {
          idbSet("brushes", cache.brushes);
          localStorage.removeItem(LS_BRUSHES);
        }
      }
    } catch (e) { /* 이관 실패 시 아래 기본값 */ }
    if (cache.custom == null) cache.custom = [];
    if (cache.brushes == null) cache.brushes = {};
  }

  const ready = new Promise((resolve) => {
    if (!window.indexedDB) {
      fallback = true;
      loadFromLS();
      resolve();
      return;
    }
    let req;
    try { req = indexedDB.open("coloring", 1); }
    catch (e) { fallback = true; loadFromLS(); resolve(); return; }
    req.onupgradeneeded = () => {
      req.result.createObjectStore("kv");
    };
    req.onerror = () => {
      fallback = true;
      loadFromLS();
      resolve();
    };
    req.onsuccess = () => {
      db = req.result;
      try {
        const store = db.transaction("kv", "readonly").objectStore("kv");
        const gc = store.get("custom");
        const gb = store.get("brushes");
        let n = 0;
        const done = () => { if (++n === 2) { migrate(); resolve(); } };
        gc.onsuccess = () => { cache.custom = gc.result != null ? gc.result : null; done(); };
        gc.onerror = done;
        gb.onsuccess = () => { cache.brushes = gb.result != null ? gb.result : null; done(); };
        gb.onerror = done;
      } catch (e) {
        fallback = true;
        loadFromLS();
        resolve();
      }
    };
  });

  return {
    ready,
    getCustom: () => cache.custom || [],
    setCustom: (list) => { cache.custom = list; idbSet("custom", list); },
    getBrushes: () => cache.brushes || {},
    setBrushes: (map) => { cache.brushes = map; idbSet("brushes", map); },
  };
})();
