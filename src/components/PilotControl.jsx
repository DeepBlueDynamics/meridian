import WidgetFrame from "./WidgetFrame.jsx";
import { useShipData, useShipDataSetter } from "../hooks/useShipData.js";

const PilotControl = () => {
  const data = useShipData();
  const setData = useShipDataSetter();

  const isManual = data.manualControl || false;
  const manualHeading = data.manualHeading ?? data.heading;
  const manualSog = data.manualSog ?? data.sog;
  const manualDepth = data.manualDepthOffset ?? data.depth;
  const muteAlarm = data.muteAlarm || false;

  const handleToggleManual = () => {
    setData((prev) => ({
      ...prev,
      manualControl: !prev.manualControl,
      manualHeading: prev.heading,
      manualSog: prev.sog,
      manualDepthOffset: prev.depth,
    }));
  };

  const handleHeadingChange = (val) => {
    setData((prev) => ({
      ...prev,
      manualHeading: val,
    }));
  };

  const handleSogChange = (val) => {
    setData((prev) => ({
      ...prev,
      manualSog: val,
    }));
  };

  const handleDepthChange = (val) => {
    setData((prev) => ({
      ...prev,
      manualDepthOffset: val,
    }));
  };

  const handleToggleMute = () => {
    setData((prev) => ({
      ...prev,
      muteAlarm: !prev.muteAlarm,
    }));
  };

  return (
    <WidgetFrame title="Autopilot & Pilot Control" color="#22c55e">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Toggle Mode */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#9ca3af" }}>CONTROL MODE:</span>
          <button
            data-no-drag
            onClick={handleToggleManual}
            style={{
              background: isManual ? "#ef4444" : "#22c55e",
              color: "#05080f",
              border: "none",
              borderRadius: 6,
              padding: "6px 12px",
              fontWeight: "bold",
              cursor: "pointer",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 11,
              letterSpacing: 0.5,
              boxShadow: isManual ? "0 0 10px rgba(239, 68, 68, 0.4)" : "0 0 10px rgba(34, 197, 94, 0.4)",
              transition: "all 0.2s ease",
            }}
          >
            {isManual ? "⚠️ MANUAL STEER" : "🛰 AUTOPILOT"}
          </button>
        </div>

        {/* Sliders */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, opacity: isManual ? 1 : 0.4, transition: "opacity 0.2s" }}>
          {/* Heading Slider */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#9ca3af", marginBottom: 4 }}>
              <span>HEADING</span>
              <span style={{ fontFamily: "JetBrains Mono, monospace", color: "#22c55e" }}>
                {Math.round(manualHeading).toString().padStart(3, "0")}°
              </span>
            </div>
            <input
              data-no-drag
              type="range"
              min="0"
              max="359"
              disabled={!isManual}
              value={manualHeading}
              onChange={(e) => handleHeadingChange(parseFloat(e.target.value))}
              style={{
                width: "100%",
                accentColor: "#22c55e",
                background: "#1e293b",
                height: 4,
                borderRadius: 2,
                cursor: isManual ? "pointer" : "not-allowed",
              }}
            />
          </div>

          {/* SOG Slider */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#9ca3af", marginBottom: 4 }}>
              <span>THROTTLE (SPEED)</span>
              <span style={{ fontFamily: "JetBrains Mono, monospace", color: "#22c55e" }}>
                {manualSog.toFixed(1)} kn
              </span>
            </div>
            <input
              data-no-drag
              type="range"
              min="0"
              max="15"
              step="0.5"
              disabled={!isManual}
              value={manualSog}
              onChange={(e) => handleSogChange(parseFloat(e.target.value))}
              style={{
                width: "100%",
                accentColor: "#22c55e",
                background: "#1e293b",
                height: 4,
                borderRadius: 2,
                cursor: isManual ? "pointer" : "not-allowed",
              }}
            />
          </div>

          {/* Depth Slider */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#9ca3af", marginBottom: 4 }}>
              <span>SIMULATED DEPTH</span>
              <span style={{ fontFamily: "JetBrains Mono, monospace", color: manualDepth < 3 ? "#ef4444" : manualDepth < 6 ? "#fbbf24" : "#22c55e" }}>
                {manualDepth.toFixed(1)} m
              </span>
            </div>
            <input
              data-no-drag
              type="range"
              min="1.5"
              max="40"
              step="0.5"
              disabled={!isManual}
              value={manualDepth}
              onChange={(e) => handleDepthChange(parseFloat(e.target.value))}
              style={{
                width: "100%",
                accentColor: "#22c55e",
                background: "#1e293b",
                height: 4,
                borderRadius: 2,
                cursor: isManual ? "pointer" : "not-allowed",
              }}
            />
          </div>
        </div>

        {/* Audio Mute button */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #1e293b", paddingTop: 8 }}>
          <span style={{ fontSize: 11, color: "#9ca3af" }}>DEPTH AUDIBLE ALARM:</span>
          <button
            data-no-drag
            onClick={handleToggleMute}
            style={{
              background: muteAlarm ? "#475569" : "#dc2626",
              color: "#e5e7eb",
              border: "none",
              borderRadius: 6,
              padding: "4px 10px",
              cursor: "pointer",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 10,
            }}
          >
            {muteAlarm ? "🔇 MUTED" : "🔊 ACTIVE"}
          </button>
        </div>
      </div>
    </WidgetFrame>
  );
};

export default PilotControl;
