/* eslint-disable react-refresh/only-export-components */
import { createContext, useEffect, useState } from "react";

export const ShipDataContext = createContext(null);

const WAYPOINTS = [
  { name: "PASS ENTRY", lat: 32.6888, lon: -117.5922 },
  { name: "POINT LOMA", lat: 32.6650, lon: -117.2500 },
  { name: "SD HARBOR", lat: 32.7050, lon: -117.1800 }
];

const initialData = {
  heading: 127,
  cog: 125,
  sog: 7.2,
  lat: 32.7147, // West of San Diego
  lon: -117.62,
  depth: 12.4,
  xte: 0.02, // nm
  waypointIndex: 0,
  nextWaypoint: {
    name: "PASS ENTRY",
    lat: 32.6888,
    lon: -117.5922,
    bearing: 138,
    range: 2.1, // nm
  },
  buoys: [
    { id: "B1", name: "West Pass Buoy", lat: 32.7100, lon: -117.6400, type: "port" },
    { id: "B2", name: "Lagoon Safe Water", lat: 32.7200, lon: -117.6000, type: "safe" },
    { id: "B3", name: "Shallow Patch", lat: 32.7000, lon: -117.5800, type: "warning" },
  ],
  aisTargets: [
    { mmsi: "520001234", name: "MV ARANUI 5", lat: 32.7100, lon: -117.6200, cog: 145, sog: 12.5, shipType: "Cargo" },
    { mmsi: "227001234", name: "SY MOANA", lat: 32.6900, lon: -117.5200, cog: 280, sog: 5.8, shipType: "Sailing" },
    { mmsi: "503001234", name: "FV TUHAA PAE", lat: 32.7200, lon: -117.6500, cog: 90, sog: 3.2, shipType: "Fishing" },
    { mmsi: "992501001", name: "TIKEHAU WEST", lat: 32.7100, lon: -117.6300, cog: 0, sog: 0, shipType: "AtoN" },
  ],
  manualControl: false,
  manualHeading: 127,
  manualSog: 7.2,
  manualDepthOffset: 12.4,
  muteAlarm: false,
};

export const ShipDataProvider = ({ children }) => {
  const [data, setData] = useState(initialData);

  // Simulate NMEA dead reckoning movement
  useEffect(() => {
    const id = setInterval(() => {
      setData((prev) => {
        // Autopilot vs manual steering
        const targetHeading = prev.manualControl ? prev.manualHeading : prev.heading;
        const targetSog = prev.manualControl ? prev.manualSog : prev.sog;

        // Apply a small smoothing/drift towards targets
        const headingDiff = ((targetHeading - prev.heading + 180 + 360) % 360) - 180;
        const heading = (prev.heading + headingDiff * 0.1 + (Math.random() - 0.5) * 0.05 + 360) % 360;
        const cog = (heading + (Math.random() - 0.5) * 0.2 + 360) % 360;
        
        // Speed updates with dampening
        const sog = Math.max(0, prev.sog + (targetSog - prev.sog) * 0.15 + (Math.random() - 0.5) * 0.02);

        // Dead reckoning: calculate distance traveled in dt = 0.2s
        const dt = 0.2; // seconds
        const speedNmPerSec = sog / 3600;
        const distNm = speedNmPerSec * dt;
        const headingRad = (heading * Math.PI) / 180;
        const latRad = (prev.lat * Math.PI) / 180;

        const dLat = (distNm * Math.cos(headingRad)) / 60;
        const dLon = (distNm * Math.sin(headingRad)) / (60 * Math.cos(latRad));

        const lat = prev.lat + dLat;
        const lon = prev.lon + dLon;

        // Depth updates
        let depth = prev.depth;
        if (prev.manualControl) {
          depth = Math.max(1.5, prev.depth + (prev.manualDepthOffset - prev.depth) * 0.2 + (Math.random() - 0.5) * 0.02);
        } else {
          depth = Math.max(2.0, Math.min(60, prev.depth + (Math.random() - 0.5) * 0.05));
        }

        // Waypoint progression
        let waypointIndex = prev.waypointIndex ?? 0;
        let activeWp = WAYPOINTS[waypointIndex];

        let dx = (activeWp.lon - lon) * 60 * Math.cos((lat * Math.PI) / 180);
        let dy = (activeWp.lat - lat) * 60;
        let range = Math.sqrt(dx * dx + dy * dy);

        // Arrived at waypoint: advance route!
        if (range < 0.15) {
          waypointIndex = (waypointIndex + 1) % WAYPOINTS.length;
          activeWp = WAYPOINTS[waypointIndex];
          dx = (activeWp.lon - lon) * 60 * Math.cos((lat * Math.PI) / 180);
          dy = (activeWp.lat - lat) * 60;
          range = Math.sqrt(dx * dx + dy * dy);
        }

        const bearing = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
        const wpHeadingDiff = ((bearing - heading + 180 + 360) % 360) - 180;
        const xte = range * Math.sin((wpHeadingDiff * Math.PI) / 180);

        const nextWaypoint = {
          name: activeWp.name,
          lat: activeWp.lat,
          lon: activeWp.lon,
          bearing,
          range,
        };

        // AIS target motion simulation
        const aisTargets = (prev.aisTargets || []).map((t) => {
          if (t.shipType === "AtoN") return t; // Stationary Aid to Navigation

          const tHeadingRad = (t.cog * Math.PI) / 180;
          const tSpeedNmPerSec = t.sog / 3600;
          const tDistNm = tSpeedNmPerSec * dt;
          const tLatRad = (t.lat * Math.PI) / 180;

          const tdLat = (tDistNm * Math.cos(tHeadingRad)) / 60;
          const tdLon = (tDistNm * Math.sin(tHeadingRad)) / (60 * Math.cos(tLatRad));

          const driftLat = t.lat + tdLat + (Math.random() - 0.5) * 0.00001;
          const driftLon = t.lon + tdLon + (Math.random() - 0.5) * 0.00001;
          const tCog = (t.cog + (Math.random() - 0.5) * 0.3 + 360) % 360;
          const tSog = Math.max(0, Math.min(22, t.sog + (Math.random() - 0.5) * 0.02));

          return { ...t, lat: driftLat, lon: driftLon, cog: tCog, sog: tSog };
        });

        return {
          ...prev,
          heading,
          cog,
          sog,
          lat,
          lon,
          depth,
          xte,
          waypointIndex,
          nextWaypoint,
          aisTargets,
        };
      });
    }, 200);
    return () => clearInterval(id);
  }, []);

  return <ShipDataContext.Provider value={{ data, setData }}>{children}</ShipDataContext.Provider>;
};
