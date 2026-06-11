// Wind & current chart layers — deck.gl render of a WxField with the project's
// COMMITTED indicator convention (spec docs/04, §4 — do not re-litigate):
//   wind    = WHITE line from the sample point, length ∝ speed, NO arrowhead,
//             pointing the direction the wind is moving TOWARD (native dir +180°)
//   current = BLUE #4fa3ff line from the SAME anchor, length ∝ speed × ~7,
//             NO arrowhead, no flip (native dir already = direction of flow)
//   speed labels in matching colour at the line's end; no anchor offset.
//
// Sampling is a SCREEN-SPACE grid (~48 px) re-sampled from the field at the
// current view — density stays readable across zooms (spec §4). Classic script;
// exposes window.FieldLayer. deck.gl global (`deck`) is passed in, not assumed.
(function () {
  const D2R = Math.PI / 180;
  const WIND_COLOR = [244, 247, 252];           // white (suite --mean)
  const CUR_COLOR  = [79, 163, 255];            // #4fa3ff
  const PX_PER_KT  = 2.2;                       // wind line px per knot
  // Current length uses a sqrt scale, not the old linear ×7: linear made
  // 0.2 vs 0.6 kt look wildly different and a 4 kt stream absurd. sqrt keeps
  // weak drift visible while compressing the high end (0.2→5px · 0.6→9 ·
  // 1.0→12 · 4.0→23).
  const CUR_PX_SQRT = 11.5;                     // px per √knot
  const MAX_PX     = 110, MIN_PX = 3;

  // small great-circle walk (self-contained — no Router dependency)
  function sphereWalk(lat, lon, brgDeg, distNm) {
    const R = 3440.065, d = distNm / R, b = brgDeg * D2R;
    const la1 = lat * D2R, lo1 = lon * D2R;
    const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b));
    const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1),
                                 Math.cos(d) - Math.sin(la1) * Math.sin(la2));
    return { lat: la2 / D2R, lon: ((lo2 / D2R + 540) % 360) - 180 };
  }
  // web-mercator ground resolution at a latitude/zoom
  function metersPerPixel(lat, zoom) {
    return 156543.03392 * Math.cos(lat * D2R) / Math.pow(2, zoom);
  }

  // Screen-space sample grid: every ~`spacingPx`, unprojected to lat/lon.
  // `unproject([x,y]) -> [lon,lat]` comes from MapLibre or the Cesium camera —
  // same data model, different projection (spec §5).
  function screenGridSamples({ width, height, unproject, spacingPx = 48 }) {
    const out = [];
    const x0 = (width % spacingPx) / 2, y0 = (height % spacingPx) / 2;
    for (let y = y0; y <= height; y += spacingPx) {
      for (let x = x0; x <= width; x += spacingPx) {
        const ll = unproject([x, y]);
        if (!ll) continue;
        const lon = ll[0] != null ? ll[0] : ll.lng, lat = ll[1] != null ? ll[1] : ll.lat;
        if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 85) out.push({ lat, lon });
      }
    }
    return out;
  }

  // Build per-sample line segments for one field at scrub time tHours.
  // Returns [{ source:[lon,lat], target:[lon,lat], speed, dir }]
  function lineData(field, samples, tHours, zoom, WxField) {
    const wind = field.kind === "wind";
    const out = [];
    for (const s of samples) {
      const v = WxField.sample(field, s.lat, s.lon, tHours);
      if (!v || !(v.speed >= 0)) continue;
      const flowTo = WxField.flowDir(field.kind, v.dir);          // wind flips, current doesn't
      const rawPx = wind ? v.speed * PX_PER_KT : Math.sqrt(v.speed) * CUR_PX_SQRT;
      const px = Math.min(MAX_PX, Math.max(MIN_PX, rawPx));
      const lenNm = px * metersPerPixel(s.lat, zoom) / 1852;
      const end = sphereWalk(s.lat, s.lon, flowTo, lenNm);
      out.push({ source: [s.lon, s.lat], target: [end.lon, end.lat],
                 speed: v.speed, dir: v.dir, p5: v.p5, p95: v.p95 });
    }
    return out;
  }

  // deck.gl layers for one field: LineLayer (no arrowheads) + dot anchors +
  // optional TextLayer speed labels at the line end, colour-matched.
  function makeDeckLayers(deck, field, data, { visible = true, labels = true, id } = {}) {
    const wind = field.kind === "wind";
    const color = wind ? WIND_COLOR : CUR_COLOR;
    const alpha = wind ? 235 : 245;
    const base = id || field.kind;
    const layers = [
      new deck.ScatterplotLayer({
        id: base + "-anchor", data, visible,
        getPosition: d => d.source, radiusUnits: "pixels",
        getRadius: 1.6, getFillColor: [...color, 200],
        pickable: false,
      }),
      new deck.LineLayer({
        id: base + "-line", data, visible,
        getSourcePosition: d => d.source, getTargetPosition: d => d.target,
        getColor: [...color, alpha],
        getWidth: wind ? 1.6 : 1.9, widthUnits: "pixels",
        pickable: false,
      }),
    ];
    if (labels) layers.push(new deck.TextLayer({
      id: base + "-label", data, visible,
      getPosition: d => d.target,
      getText: d => (wind ? Math.round(d.speed) : d.speed.toFixed(1)) + "",
      getColor: [...color, wind ? 200 : 230],
      getSize: 10.5, sizeUnits: "pixels",
      fontFamily: "'Fira Code', monospace", fontWeight: 500,
      getTextAnchor: "start", getAlignmentBaseline: "center",
      getPixelOffset: [4, 0],
      pickable: false,
    }));
    return layers;
  }

  globalThis.FieldLayer = {
    screenGridSamples, lineData, makeDeckLayers,
    sphereWalk, metersPerPixel,
    WIND_COLOR, CUR_COLOR, CUR_SCALE,
  };
})();
