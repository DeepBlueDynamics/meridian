// ORC fleet data service — loads DeepBlueDynamics/orc-data, maps each boat's VPP
// allowances into a polar grid, and searches. Classic script; exposes window.OrcData.
//
// Source JSON (CORS-enabled raw): array of ORC certificates, each with
//   vpp.angles = [TWA...], vpp.speeds = [TWS...], vpp["<twa>"] = [bsp per TWS],
//   plus boat meta (designer, year, type, sizes.loa) and rating.
(function () {
  const URL = "https://raw.githubusercontent.com/DeepBlueDynamics/orc-data/master/orc-data.json";
  let _fleet = null;

  function mapBoat(x) {
    const v = x.vpp;
    if (!v || !Array.isArray(v.angles) || !Array.isArray(v.speeds)) return null;
    const b = x.boat || {};
    const s = b.sizes || {};
    const maker = b.builder && b.builder.trim() ? titleCase(b.builder.trim()) : "—";
    const model = b.type && b.type.trim() ? b.type.trim() : "—";
    if (maker === "—" && model === "—") return null; // need an identity
    const asym = s.spinnaker_asym || 0, sym = s.spinnaker || 0;
    return {
      id: (maker + "|" + model).toLowerCase(),
      maker, model, label: maker + " · " + model,
      designer: b.designer || "—",
      year: b.year || "—",
      loa: s.loa != null ? s.loa.toFixed(1) + " m" : "—",
      beam: s.beam != null ? s.beam.toFixed(2) + " m" : "—",
      draft: s.draft != null ? s.draft.toFixed(2) + " m" : "—",
      displacement: s.displacement != null ? Math.round(s.displacement) + " kg" : "—",
      // Sail plan (areas in m²) from the ORC certificate.
      sail: {
        main: s.main || 0,
        genoa: s.genoa || 0,
        spinnaker: Math.max(sym, asym),
        spinType: asym > 0 ? "Asymmetric" : sym > 0 ? "Symmetric" : "None",
      },
      gph: x.rating && x.rating.gph,
      twa: v.angles.slice(),
      tws: v.speeds.slice(),
      bsp: v.angles.map((a) => (v[String(a)] || []).slice()),
    };
  }

  function titleCase(s) { return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()); }

  // ── built-in boats ───────────────────────────────────────────────────────
  // ORC only certifies monohulls, so popular cruising catamarans (Lagoon etc.)
  // will never appear in orc-data. These are ESTIMATED cruising polars (flagged
  // est:true → badged in the UI), good enough for passage planning demos.
  function scaleGrid(g, f) { return g.map((row) => row.map((v) => Math.round(v * f * 10) / 10)); }
  const CAT_TWA = [50, 60, 75, 90, 110, 120, 135, 150, 165, 180];
  const CAT_TWS = [4, 6, 8, 10, 12, 14, 16, 20, 25];
  const LAGOON42_BSP = [
    [2.4, 3.4, 4.3, 5.0, 5.5, 5.9, 6.2, 6.5, 6.5],
    [2.8, 3.9, 4.9, 5.6, 6.2, 6.6, 6.9, 7.3, 7.4],
    [3.2, 4.5, 5.6, 6.4, 7.0, 7.5, 7.8, 8.3, 8.5],
    [3.4, 4.8, 6.0, 6.9, 7.6, 8.1, 8.5, 9.0, 9.2],
    [3.3, 4.7, 6.0, 7.0, 7.8, 8.4, 8.9, 9.5, 9.8],
    [3.1, 4.5, 5.8, 6.8, 7.6, 8.3, 8.8, 9.5, 9.9],
    [2.7, 4.0, 5.2, 6.2, 7.1, 7.8, 8.4, 9.2, 9.7],
    [2.2, 3.4, 4.5, 5.5, 6.4, 7.1, 7.7, 8.6, 9.2],
    [1.9, 2.9, 3.9, 4.8, 5.6, 6.3, 6.9, 7.8, 8.5],
    [1.7, 2.6, 3.6, 4.4, 5.2, 5.9, 6.5, 7.4, 8.1],
  ];
  function cat(model, year, loa, beam, disp, sailMain, sailGenoa, sailSpin, f) {
    return {
      id: ("lagoon|" + model).toLowerCase(), maker: "Lagoon", model, label: "Lagoon · " + model,
      designer: "VPLP", year, loa, beam, draft: "1.30 m", displacement: disp, est: true,
      sail: { main: sailMain, genoa: sailGenoa, spinnaker: sailSpin, spinType: "Asymmetric" },
      gph: null, twa: CAT_TWA.slice(), tws: CAT_TWS.slice(), bsp: scaleGrid(LAGOON42_BSP, f),
    };
  }
  const BUILTIN = [
    cat("Lagoon 380", 2000, "11.6 m", "6.53 m", "7260 kg", 35, 27, 65, 0.88),
    cat("Lagoon 42", 2016, "12.8 m", "7.70 m", "12000 kg", 55, 35, 75, 1.0),
    cat("Lagoon 450F", 2014, "14.0 m", "7.84 m", "15000 kg", 60, 40, 90, 1.06),
  ];

  async function load() {
    if (_fleet) return _fleet;
    let arr = [];
    try {
      const r = await fetch(URL);
      if (!r.ok) throw new Error("orc-data HTTP " + r.status);
      arr = await r.json();
    } catch (e) {
      // Offline / GitHub hiccup: still usable with the built-in boats.
      console.warn("[orcdata] ORC fleet unavailable, built-in boats only:", e.message);
      if (window.Telemetry) window.Telemetry.send("orcdata-load-failed", { message: e.message });
      _fleet = BUILTIN.slice();
      return _fleet;
    }
    // Dedupe by maker+model — the source has one cert per individual vessel; we
    // want unique boat models (maker + model), not owner-given vessel names.
    const seen = new Set();
    _fleet = [];
    for (const m of arr.map(mapBoat)) {
      if (!m || seen.has(m.id)) continue;
      seen.add(m.id);
      _fleet.push(m);
    }
    _fleet.push(...BUILTIN);
    _fleet.sort((a, b) => (a.maker + " " + a.model).localeCompare(b.maker + " " + b.model));
    return _fleet;
  }

  // Filter by free text over maker / model / designer. Caps results.
  function search(fleet, q, limit = 100) {
    q = (q || "").trim().toLowerCase();
    if (!q) return fleet.slice(0, limit);
    const hit = (b) => (b.maker + " " + b.model + " " + b.designer).toLowerCase().includes(q);
    return fleet.filter(hit).slice(0, limit);
  }

  window.OrcData = { load, search, URL };
})();
