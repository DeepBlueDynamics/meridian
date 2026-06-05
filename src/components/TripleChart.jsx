import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useShipData } from "../hooks/useShipData.js";
import WidgetFrame from "./WidgetFrame.jsx";

const PaneConfig = [
  { id: "main", title: "Main (Seamarks)", base: "osm", seamarks: true, zoom: 13, seamarkOpacity: 0.9 },
  { id: "sat", title: "Imagery (Wide)", base: "esri", seamarks: true, zoom: 10, seamarkOpacity: 0.7 },
  { id: "bathy", title: "Zoomed Seamarks", base: "none", seamarks: true, zoom: 15, seamarkOpacity: 1 },
];

const TripleChart = () => {
  const data = useShipData();
  const [sync, setSync] = useState(true);
  return (
    <WidgetFrame title="Charts x3" color="#22c55e">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <ChartPane cfg={PaneConfig[0]} data={data} sync={sync} />
        <ChartPane cfg={PaneConfig[1]} data={data} sync={sync} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <ChartPane cfg={PaneConfig[2]} data={data} sync={sync} wide />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <label style={{ fontSize: 12, color: "#9ca3af", display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} />
          Sync center/zoom
        </label>
      </div>
    </WidgetFrame>
  );
};

const ChartPane = ({ cfg, data, sync, wide }) => {
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const markerRef = useRef(null);
  const headingRef = useRef(null);
  const courseRef = useRef(null);
  const wpRef = useRef(null);
  const wpLineRef = useRef(null);
  const seamarkLayerRef = useRef(null);
  const [opacity, setOpacity] = useState(cfg.seamarkOpacity ?? 0.9);

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: false, worldCopyJump: true, zoomSnap: 0.25 });
    map.setView([data.lat, data.lon], cfg.zoom || 12);

    let baseLayer = null;
    if (cfg.base === "esri") {
      baseLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        attribution: "© Esri",
        maxZoom: 18,
      });
    } else if (cfg.base === "none") {
      // No base; use dark background via CSS only.
    } else {
      baseLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OSM",
        maxZoom: 19,
        subdomains: ["a", "b", "c"],
      });
    }
    if (baseLayer) baseLayer.addTo(map);
    if (cfg.seamarks) {
      const seamark = L.tileLayer("https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png", {
        maxZoom: 18,
        opacity: cfg.seamarkOpacity ?? 0.9,
      }).addTo(map);
      seamarkLayerRef.current = seamark;
    }
    const vesselIcon = L.divIcon({
      className: "",
      html: `<div style="width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-bottom:14px solid #22c55e; transform: translate(-50%, -50%) rotate(${data.heading || 0}deg);"></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
    const marker = L.marker([data.lat, data.lon], { icon: vesselIcon }).addTo(map);
    const headingLine = L.polyline(
      [
        [data.lat, data.lon],
        destinationPoint(data.lat, data.lon, data.heading || 0, 0.5),
      ],
      { color: "#22c55e", weight: 3, opacity: 0.7 }
    ).addTo(map);
    const courseLine = L.polyline(
      [
        [data.lat, data.lon],
        destinationPoint(data.lat, data.lon, data.cog || 0, Math.max(0.2, data.sog * 0.1)),
      ],
      { color: "#38bdf8", weight: 2, dashArray: "6,4", opacity: 0.7 }
    ).addTo(map);

    const wpLatLng = { lat: data.lat + 0.01, lon: data.lon + 0.01 };
    const wp = L.circleMarker([wpLatLng.lat, wpLatLng.lon], {
      radius: 6,
      color: "#ec4899",
      weight: 2,
      fillColor: "#ec4899",
      fillOpacity: 0.7,
    }).addTo(map);
    const wpLine = L.polyline(
      [
        [data.lat, data.lon],
        [wpLatLng.lat, wpLatLng.lon],
      ],
      { color: "#ef4444", weight: 2, dashArray: "6,4", opacity: 0.8 }
    ).addTo(map);

    mapRef.current = map;
    markerRef.current = marker;
    headingRef.current = headingLine;
    courseRef.current = courseLine;
    wpRef.current = wp;
    wpLineRef.current = wpLine;
  }, [cfg, data.heading, data.lat, data.lon, data.cog, data.sog]);

  useEffect(() => {
    if (!mapRef.current) return;
    const marker = markerRef.current;
    const headingLine = headingRef.current;
    const courseLine = courseRef.current;
    const wp = wpRef.current;
    const wpLine = wpLineRef.current;
    const { lat, lon, heading = 0, cog = 0, sog = 0 } = data;
    marker.setLatLng([lat, lon]);
    marker.setIcon(
      L.divIcon({
        className: "",
        html: `<div style="width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-bottom:14px solid #22c55e; transform: translate(-50%, -50%) rotate(${heading}deg);"></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      })
    );
    headingLine.setLatLngs([
      [lat, lon],
      destinationPoint(lat, lon, heading, 0.5),
    ]);
    courseLine.setLatLngs([
      [lat, lon],
      destinationPoint(lat, lon, cog, Math.max(0.2, sog * 0.1)),
    ]);
    if (wp && wpLine) {
      const wplat = wp.getLatLng();
      wpLine.setLatLngs([
        [lat, lon],
        [wplat.lat, wplat.lng],
      ]);
    }
    if (sync) {
      mapRef.current.setView([lat, lon], mapRef.current.getZoom());
    }
  }, [data, sync]);

  // Update seamark opacity when slider moves.
  useEffect(() => {
    if (seamarkLayerRef.current) {
      seamarkLayerRef.current.setOpacity(opacity);
    }
  }, [opacity]);

  return (
    <div
      style={{
        border: "1px solid #1f2937",
        borderRadius: 10,
        overflow: "hidden",
        height: wide ? 360 : 300,
        background: cfg.base === "none" ? "#05080f" : "transparent",
        position: "relative",
      }}
    >
      <div style={{ padding: "6px 10px", fontSize: 12, color: "#9ca3af", borderBottom: "1px solid #1f2937" }}>
        {cfg.title}
      </div>
      <div ref={containerRef} style={{ width: "100%", height: "calc(100% - 30px)" }} />
      {cfg.seamarks && (
        <div style={{ position: "absolute", top: 6, right: 8, background: "rgba(5,8,15,0.8)", padding: "4px 6px", borderRadius: 6, border: "1px solid #1f2937", color: "#e5e7eb", fontSize: 11 }}>
          <div style={{ marginBottom: 4 }}>Seamarks</div>
          <input
            data-no-drag
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={opacity}
            onChange={(e) => setOpacity(parseFloat(e.target.value))}
          />
        </div>
      )}
    </div>
  );
};

function destinationPoint(lat, lon, bearingDeg, distanceNm) {
  const R = 3440.065;
  const brng = (bearingDeg * Math.PI) / 180;
  const dByR = distanceNm / R;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(dByR) + Math.cos(lat1) * Math.sin(dByR) * Math.cos(brng));
  const lon2 =
    lon1 +
    Math.atan2(Math.sin(brng) * Math.sin(dByR) * Math.cos(lat1), Math.cos(dByR) - Math.sin(lat1) * Math.sin(lat2));
  return [(lat2 * 180) / Math.PI, ((lon2 * 180) / Math.PI + 540) % 360 - 180];
}

export default TripleChart;
