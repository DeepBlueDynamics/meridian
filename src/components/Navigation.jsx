import WidgetFrame from "./WidgetFrame.jsx";
import { useShipData } from "../hooks/useShipData.js";
import { formatHeading, formatLat, formatLon, formatSpeed } from "../utils/formatting.js";
import { useEffect } from "react";

const XTEBar = ({ xte }) => {
  const limit = 0.25; // nm shown either side
  const clamped = Math.max(-limit, Math.min(limit, xte));
  const percent = ((clamped + limit) / (2 * limit)) * 100;
  const alarm = Math.abs(xte) > 0.1;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#889" }}>
        <span>PORT</span>
        <span style={{ color: alarm ? "#f87171" : "#22c55e", fontWeight: "bold" }}>
          XTE {xte.toFixed(3)} nm
        </span>
        <span>STBD</span>
      </div>
      <div style={{ position: "relative", height: 8, marginTop: 4, background: "#0c0e17", borderRadius: 4, border: "1px solid #1e293b" }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${percent}%`,
            background: alarm ? "rgba(239, 68, 68, 0.15)" : "rgba(34, 197, 94, 0.1)",
            borderRadius: 4,
            transition: "width 0.2s ease",
          }}
        />
        {/* Center line */}
        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "#374151" }} />
        {/* Ship indicator pin */}
        <div
          style={{
            position: "absolute",
            left: `${percent}%`,
            top: -2,
            width: 8,
            height: 12,
            background: alarm ? "#ef4444" : "#22c55e",
            borderRadius: 2,
            boxShadow: `0 0 6px ${alarm ? "#ef4444" : "#22c55e"}`,
            transform: "translateX(-50%)",
            transition: "left 0.2s ease",
          }}
        />
      </div>
    </div>
  );
};

const Navigation = () => {
  const data = useShipData();
  const wp = data.nextWaypoint || { name: "--", bearing: 0, range: 0 };
  
  const caution = data.depth < 6;
  const danger = data.depth < 3;
  const depthColor = danger ? "#ef4444" : caution ? "#fbbf24" : "#22c55e";
  
  const audioAlarmActive = danger && !data.muteAlarm;

  // Audible depth alarm synthesizer
  useEffect(() => {
    if (!audioAlarmActive) return;

    const playBeep = () => {
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.type = "sine";
        // If extremely shallow (< 2m), use a higher frequency panic tone
        const pitch = data.depth < 2 ? 1400 : 880;
        oscillator.frequency.setValueAtTime(pitch, audioCtx.currentTime);
        
        gainNode.gain.setValueAtTime(0.03, audioCtx.currentTime); // very quiet beep to avoid annoyance

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.18);
      } catch {
        // Browser might restrict autoplay until user interaction
      }
    };

    playBeep();
    const timer = setInterval(playBeep, 1500);

    return () => clearInterval(timer);
  }, [audioAlarmActive, data.depth]);

  return (
    <WidgetFrame title="Instruments & Navigation" color="#22c55e">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Depth Alarm Banner */}
        {caution && (
          <div
            style={{
              background: danger ? "rgba(239, 68, 68, 0.2)" : "rgba(251, 191, 36, 0.15)",
              border: `1px solid ${danger ? "#ef4444" : "#fbbf24"}`,
              borderRadius: 6,
              padding: "6px 10px",
              textAlign: "center",
              fontSize: 10,
              color: danger ? "#fca5a5" : "#fde047",
              fontWeight: "bold",
              animation: danger ? "pulse 1s ease-in-out infinite" : "none",
              letterSpacing: 0.5,
            }}
          >
            {danger ? "🚨 DANGER: SHALLOW WATER DEPTH ALARM!" : "⚠️ CAUTION: SHALLOW WATER AREA"}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 12 }}>
          {/* Dashboard Telemetry */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
            <InfoBlock label="HDG" value={formatHeading(data.heading)} accent="#22c55e" large />
            <InfoBlock label="COG" value={formatHeading(data.cog)} />
            <InfoBlock label="SOG" value={formatSpeed(data.sog)} />
            <InfoBlock label="LAT" value={formatLat(data.lat)} />
            <InfoBlock label="LON" value={formatLon(data.lon)} />
            <InfoBlock label="DEPTH" value={`${data.depth.toFixed(1)} m`} accent={depthColor} />
          </div>

          {/* Next Waypoint Info */}
          <div style={{ display: "flex", flexDirection: "column", justifyBetween: "space-between" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontSize: 10, color: "#6b7280", letterSpacing: 0.5 }}>NEXT WAYPOINT</div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "#0c0e17",
                  border: "1px solid #1e293b",
                  borderRadius: 6,
                  padding: "8px 10px",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ color: "#e5e7eb", fontSize: 11, fontWeight: "bold", letterSpacing: 0.5 }}>{wp.name}</span>
                  <span style={{ color: "#6b7280", fontSize: 9 }}>BRG {formatHeading(wp.bearing)}</span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ color: "#22c55e", fontSize: 18, fontFamily: "JetBrains Mono, monospace", fontWeight: "bold" }}>
                    {wp.range.toFixed(2)}
                  </div>
                  <div style={{ color: "#6b7280", fontSize: 9 }}>nm</div>
                </div>
              </div>
            </div>
            
            <div style={{ marginTop: "auto" }}>
              <XTEBar xte={data.xte || 0} />
            </div>
          </div>
        </div>
      </div>
    </WidgetFrame>
  );
};

const InfoBlock = ({ label, value, accent = "#9ca3af", large = false }) => (
  <div
    style={{
      background: "#0c0e17",
      borderRadius: 6,
      padding: "6px 8px",
      border: "1px solid #1e293b",
      display: "flex",
      flexDirection: "column",
      gap: 4,
      minHeight: 52,
      justifyContent: "center",
    }}
  >
    <span style={{ color: "#4b5563", fontSize: 8, letterSpacing: 0.5 }}>{label}</span>
    <span
      style={{
        color: accent,
        fontSize: large ? 20 : 13,
        fontFamily: "JetBrains Mono, monospace",
        fontWeight: "bold",
        lineHeight: 1,
      }}
    >
      {value}
    </span>
  </div>
);

export default Navigation;
