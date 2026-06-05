import WidgetFrame from "./WidgetFrame.jsx";
import { useShipData } from "../hooks/useShipData.js";
import { useState, useMemo, useCallback } from "react";
import { formatHeading } from "../utils/formatting.js";

const rangeOptions = [0.5, 1, 2, 4];

const AIS = () => {
  const data = useShipData();
  const [rangeNm, setRangeNm] = useState(2);
  const [selectedMmsi, setSelectedMmsi] = useState(null);

  const rings = rangeOptions.filter((r) => r <= rangeNm);

  // Projection logic for radar screen coordinates
  const project = useCallback((lat, lon) => {
    const dx = (lon - data.lon) * 60 * Math.cos((data.lat * Math.PI) / 180); // nm approx
    const dy = (lat - data.lat) * 60; // nm
    const max = rangeNm;
    // Clamp so that targets outside the range stay on the edge
    const clamp = (v) => Math.max(-max, Math.min(max, v));
    return { x: clamp(dx), y: clamp(dy), isClamped: Math.abs(dx) > max || Math.abs(dy) > max };
  }, [data.lat, data.lon, rangeNm]);

  // Calculate relative distance and bearing for each target
  const processedTargets = useMemo(() => {
    const targetsList = data.aisTargets || [];
    return targetsList.map((t) => {
      const dx = (t.lon - data.lon) * 60 * Math.cos((data.lat * Math.PI) / 180);
      const dy = (t.lat - data.lat) * 60;
      const range = Math.sqrt(dx * dx + dy * dy);
      const bearing = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
      const { x, y, isClamped } = project(t.lat, t.lon);
      return { ...t, range, bearing, x, y, isClamped };
    });
  }, [data.aisTargets, data.lat, data.lon, project]);

  const selectedTarget = processedTargets.find((t) => t.mmsi === selectedMmsi);

  return (
    <WidgetFrame title="AIS Collision Avoidance Radar" color="#22c55e">
      <style>{`
        @keyframes radar-sweep {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .radar-sweeper {
          transform-origin: 180px 180px;
          animation: radar-sweep 6s linear infinite;
        }
        .target-blip {
          cursor: pointer;
          transition: transform 0.2s ease;
        }
        .target-blip:hover {
          transform: scale(1.3);
        }
      `}</style>

      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 11, color: "#9ca3af" }}>
        <div>TARGETS IN VIEW: {processedTargets.length}</div>
        <div style={{ display: "flex", gap: 6 }}>
          {rangeOptions.map((r) => (
            <button
              key={r}
              data-no-drag
              onClick={() => setRangeNm(r)}
              style={{
                background: r === rangeNm ? "#22c55e" : "transparent",
                color: r === rangeNm ? "#0b0b0f" : "#22c55e",
                border: `1px solid ${r === rangeNm ? "#22c55e" : "#1e293b"}`,
                borderRadius: 4,
                padding: "2px 6px",
                cursor: "pointer",
                fontSize: 10,
                fontFamily: "JetBrains Mono, monospace",
              }}
            >
              {r} nm
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 12 }}>
        {/* Radar SVG view */}
        <div
          style={{
            width: "100%",
            aspectRatio: "1/1",
            background: "#070913",
            borderRadius: 8,
            border: "1px solid #1e293b",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <RadarSvg
            targets={processedTargets}
            rangeNm={rangeNm}
            rings={rings}
            selectedMmsi={selectedMmsi}
            onSelectTarget={setSelectedMmsi}
          />
        </div>

        {/* Info panel showing selected target info or target list */}
        <div
          style={{
            background: "#0c0e17",
            borderRadius: 8,
            border: "1px solid #1e293b",
            padding: 10,
            fontSize: 11,
            display: "flex",
            flexDirection: "column",
            height: "100%",
            maxHeight: 326,
            overflowY: "auto",
          }}
        >
          {selectedTarget ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #1e293b", paddingBottom: 4 }}>
                <span style={{ fontWeight: "bold", color: "#e5e7eb" }}>TARGET INFORMATION</span>
                <span style={{ cursor: "pointer", color: "#ef4444" }} onClick={() => setSelectedMmsi(null)}>✕ Close</span>
              </div>
              <DetailRow label="NAME" value={selectedTarget.name || "UNKNOWN"} />
              <DetailRow label="MMSI" value={selectedTarget.mmsi} />
              <DetailRow label="TYPE" value={selectedTarget.shipType} color={getShipTypeColor(selectedTarget.shipType)} />
              <DetailRow label="RANGE" value={`${selectedTarget.range.toFixed(2)} nm`} highlight />
              <DetailRow label="BEARING" value={`${Math.round(selectedTarget.bearing).toString().padStart(3, "0")}°`} highlight />
              <DetailRow label="SPEED (SOG)" value={`${selectedTarget.sog.toFixed(1)} kn`} />
              <DetailRow label="COURSE (COG)" value={`${Math.round(selectedTarget.cog).toString().padStart(3, "0")}°`} />
              <DetailRow label="STATUS" value={selectedTarget.sog > 0.5 ? "UNDERWAY" : "ANCHORED"} />
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontWeight: "bold", color: "#9ca3af", fontSize: 10, borderBottom: "1px solid #1e293b", paddingBottom: 4 }}>
                AIS TARGET LIST
              </span>
              {processedTargets.length === 0 ? (
                <div style={{ color: "#4b5563", fontStyle: "italic", textAlign: "center", marginTop: 40 }}>
                  No targets in range
                </div>
              ) : (
                processedTargets.map((t) => (
                  <div
                    key={t.mmsi}
                    onClick={() => setSelectedMmsi(t.mmsi)}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "4px 6px",
                      borderRadius: 4,
                      cursor: "pointer",
                      border: "1px solid transparent",
                      background: "rgba(30, 41, 59, 0.2)",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#22c55e55")}
                    onMouseLeave={(e) => (e.currentTarget.style.borderColor = "transparent")}
                  >
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span style={{ color: "#e5e7eb", fontWeight: "500" }}>{t.name || t.mmsi}</span>
                      <span style={{ color: "#6b7280", fontSize: 9 }}>{t.shipType}</span>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ color: "#22c55e", fontFamily: "JetBrains Mono, monospace" }}>{t.range.toFixed(2)} nm</div>
                      <div style={{ color: "#6b7280", fontSize: 9 }}>{Math.round(t.bearing).toString().padStart(3, "0")}°</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: "#6b7280", display: "flex", justifyContent: "space-between" }}>
        <span>COG: {formatHeading(data.cog || 0)}</span>
        <span>HDG: {formatHeading(data.heading || 0)}</span>
      </div>
    </WidgetFrame>
  );
};

const RadarSvg = ({ targets, rangeNm, rings, selectedMmsi, onSelectTarget }) => {
  const size = 326;
  const center = size / 2;
  const scale = (nm) => (nm / rangeNm) * (center - 10);

  const ownShip = (
    <g transform={`translate(${center},${center})`}>
      <circle r="4" fill="#22c55e" opacity="0.9" />
      <polygon points="0,-8 5,4 -5,4" fill="#22c55e" />
    </g>
  );

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${size} ${size}`}>
      <defs>
        <radialGradient id="radarGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#22c55e" stopOpacity="0.1" />
          <stop offset="80%" stopColor="#22c55e" stopOpacity="0.02" />
          <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="sweepGlow" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#22c55e" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Grid background */}
      <rect width={size} height={size} fill="#05070f" />
      <circle cx={center} cy={center} r={center - 10} fill="url(#radarGlow)" />

      {/* Crosshairs */}
      <line x1={10} y1={center} x2={size - 10} y2={center} stroke="#1f2937" strokeWidth={1} />
      <line x1={center} y1={10} x2={center} y2={size - 10} stroke="#1f2937" strokeWidth={1} />

      {/* Rings */}
      {rings.map((r) => (
        <g key={r}>
          <circle cx={center} cy={center} r={scale(r)} stroke="#1e293b" strokeDasharray="3,3" fill="none" />
          <text x={center + scale(r)} y={center - 4} fill="#4b5563" fontSize="8" textAnchor="end">
            {r} nm
          </text>
        </g>
      ))}

      {/* Sweeper Animation */}
      <line
        x1={center}
        y1={center}
        x2={center}
        y2={10}
        stroke="#22c55e"
        strokeWidth="1.5"
        opacity="0.5"
        className="radar-sweep-line"
        style={{
          transformOrigin: `${center}px ${center}px`,
          animation: "radar-sweep 5s linear infinite",
        }}
      />
      <path
        d={`M ${center} ${center} L ${center} 10 A ${center - 10} ${center - 10} 0 0 1 ${center + (center - 10) * Math.sin(Math.PI / 6)} ${center - (center - 10) * Math.cos(Math.PI / 6)} Z`}
        fill="url(#sweepGlow)"
        className="radar-sweep-glow"
        style={{
          transformOrigin: `${center}px ${center}px`,
          animation: "radar-sweep 5s linear infinite",
        }}
      />

      {/* AIS Targets */}
      {targets.map((t) => {
        const px = center + scale(t.x);
        const py = center - scale(t.y);
        const color = getShipTypeColor(t.shipType);
        const isSelected = t.mmsi === selectedMmsi;
        
        // Heading Vector
        const cogRad = ((t.cog || 0) * Math.PI) / 180;
        const vecLen = scale(Math.min(rangeNm * 0.15, (t.sog || 0) * 0.08));
        const vx = Math.sin(cogRad) * vecLen;
        const vy = -Math.cos(cogRad) * vecLen;

        return (
          <g
            key={t.mmsi}
            transform={`translate(${px},${py})`}
            onClick={(e) => {
              e.stopPropagation();
              onSelectTarget(t.mmsi);
            }}
            className="target-blip"
          >
            {/* Pulsing ring if selected */}
            {isSelected && (
              <circle r={10} stroke="#22c55e" strokeWidth={1.5} fill="none" opacity={0.8} />
            )}
            
            {/* Speed vector */}
            {t.sog > 0.5 && (
              <line x1={0} y1={0} x2={vx} y2={vy} stroke={color} strokeWidth={1.5} opacity={0.8} />
            )}

            {/* Target icon */}
            <circle r={isSelected ? 5 : 4} fill={color} stroke="#05070f" strokeWidth={1} />
            
            {/* Target Label */}
            {!t.isClamped && (
              <text y={-8} textAnchor="middle" fill={isSelected ? "#22c55e" : "#9ca3af"} fontSize="8" fontWeight={isSelected ? "bold" : "normal"}>
                {t.name || t.mmsi}
              </text>
            )}
          </g>
        );
      })}

      {/* Own Ship */}
      {ownShip}
    </svg>
  );
};

const getShipTypeColor = (type) => {
  switch (type) {
    case "Cargo": return "#3b82f6"; // Blue
    case "Sailing": return "#22c55e"; // Green
    case "Fishing": return "#fbbf24"; // Yellow
    case "AtoN": return "#ec4899"; // Pink
    default: return "#a78bfa"; // Purple
  }
};

const DetailRow = ({ label, value, highlight = false, color = null }) => (
  <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px dashed #1e293b" }}>
    <span style={{ color: "#6b7280", fontSize: 9 }}>{label}</span>
    <span
      style={{
        fontFamily: highlight ? "JetBrains Mono, monospace" : "inherit",
        color: color || (highlight ? "#22c55e" : "#d1d5db"),
        fontWeight: highlight ? "bold" : "normal",
      }}
    >
      {value}
    </span>
  </div>
);

export default AIS;
