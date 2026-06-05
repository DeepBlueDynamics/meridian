import { useState, useEffect } from "react";
import "./App.css";
import Chart from "./components/Chart.jsx";
import TripleChart from "./components/TripleChart.jsx";
import AIS from "./components/AIS.jsx";
import Navigation from "./components/Navigation.jsx";
import PilotControl from "./components/PilotControl.jsx";
import { ShipDataProvider } from "./context/ShipDataContext.jsx";
import { useShipData } from "./hooks/useShipData.js";
import { formatLat, formatLon } from "./utils/formatting.js";

const DashboardContent = () => {
  const [viewMode, setViewMode] = useState("tactical"); // "tactical" | "charts"
  const [time, setTime] = useState(new Date());
  const data = useShipData();

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const formatUTCTime = (t) => {
    return t.toUTCString().replace("GMT", "UTC");
  };

  return (
    <div className="ecdis-app">
      {/* HUD Header Bar */}
      <header className="ecdis-header">
        <div className="header-left">
          <span className="glow-title">MERIDIAN NAVIGATOR</span>
          <span className="badge">ECDIS v1.2</span>
        </div>

        <div className="header-center">
          <div className="telemetry-pill">
            <span className="label">OWN SHIP GPS FIX</span>
            <span className="val font-mono">{formatLat(data.lat)} / {formatLon(data.lon)}</span>
          </div>
          <div className="telemetry-pill">
            <span className="label">SIMULATION ENGINE</span>
            <span className="val green-glow">ACTIVE</span>
          </div>
        </div>

        <div className="header-right">
          <div className="time-display font-mono">{formatUTCTime(time)}</div>
          <div className="tab-buttons">
            <button
              data-no-drag
              className={`tab-btn ${viewMode === "tactical" ? "active" : ""}`}
              onClick={() => setViewMode("tactical")}
            >
              🛰 Tactical Panel
            </button>
            <button
              data-no-drag
              className={`tab-btn ${viewMode === "charts" ? "active" : ""}`}
              onClick={() => setViewMode("charts")}
            >
              🗺 Multi-Scale Charts
            </button>
          </div>
        </div>
      </header>

      {/* Workspace Area */}
      <main className="ecdis-main">
        {viewMode === "tactical" ? (
          <div className="tactical-layout">
            <div className="map-panel">
              <Chart />
            </div>
            <div className="side-panel">
              <Navigation />
              <AIS />
              <PilotControl />
            </div>
          </div>
        ) : (
          <div className="charts-layout">
            <TripleChart />
          </div>
        )}
      </main>
    </div>
  );
};

function App() {
  return (
    <ShipDataProvider>
      <DashboardContent />
    </ShipDataProvider>
  );
}

export default App;
