// Active-vessel store — the single source of truth for "which boat + its polar",
// shared across the multi-page app via localStorage so it survives view changes.
// Classic script (no ES module) to avoid file:// import CORS. Exposes window.Vessel.
//
// A vessel = { id, name, designer, year, type, loa, twa[], tws[], bsp[twa][tws] }
// (bsp grid keyed by twa row × tws col — same shape the polar diagram + router use).
(function () {
  const KEY = "meridian.vessel";

  // Default until the user picks one in Setup (J/120 — a sane all-rounder).
  const DEFAULT = {
    id: "j boats|j/120", maker: "J Boats", model: "J/120", label: "J Boats · J/120",
    designer: "Rod Johnstone", year: 1995, loa: "12.2 m",
    sail: { main: 38.0, genoa: 30.0, spinnaker: 92.0, spinType: "Symmetric" },
    twa: [28, 35, 45, 60, 75, 90, 110, 130, 150, 165, 180],
    tws: [4, 6, 8, 10, 12, 14, 16, 20, 25],
    bsp: [
      [3.0, 4.0, 4.5, 4.8, 5.0, 5.1, 5.2, 5.3, 5.2],
      [3.6, 4.7, 5.5, 5.9, 6.2, 6.3, 6.4, 6.5, 6.4],
      [4.2, 5.5, 6.3, 6.7, 6.9, 7.1, 7.2, 7.3, 7.2],
      [4.5, 6.0, 6.9, 7.4, 7.6, 7.8, 7.9, 8.0, 8.0],
      [4.6, 6.2, 7.2, 7.8, 8.0, 8.2, 8.3, 8.4, 8.4],
      [4.6, 6.2, 7.3, 8.0, 8.2, 8.4, 8.5, 8.6, 8.6],
      [4.3, 6.0, 7.2, 8.0, 8.4, 8.6, 8.7, 8.9, 8.9],
      [3.8, 5.6, 6.9, 7.8, 8.3, 8.6, 8.8, 9.0, 9.0],
      [3.1, 4.7, 6.0, 6.9, 7.5, 7.9, 8.2, 8.5, 8.5],
      [2.8, 4.2, 5.4, 6.3, 6.9, 7.3, 7.6, 8.0, 8.0],
      [2.6, 4.0, 5.0, 5.9, 6.5, 7.0, 7.4, 7.8, 7.8]
    ]
  };

  function get() {
    try { const s = localStorage.getItem(KEY); if (s) return JSON.parse(s); } catch (e) { /* fall through */ }
    return DEFAULT;
  }
  function set(v) {
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { console.warn("[vessel] save failed", e); }
  }
  function isDefault() {
    try { return !localStorage.getItem(KEY); } catch (e) { return true; }
  }

  window.Vessel = { get, set, isDefault, DEFAULT };
})();
