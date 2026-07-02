# spec-signalk.md

**Component:** Signal K interconnect (Meridian client) + boat-data simulator
**Spec-ID:** signalk
**Version:** v1
**Status:** draft
**Revised:** 2026-06-11 (UTC)
**Depends-on:** spec-n2k-interop, spec-radar, spec-acp-and-search-v2, spec-userdata
**Referenced-by:** MERIDIAN-VIZ-PLAN (W2), spec-wind-current-layers (live-at-boat)
**Supersedes:** —
**License-posture:** Apache-2.0. Signal K is the open marine data standard (Apache-2.0 reference server). Meridian is a **client**, not a server. The simulator is first-party dev tooling.

---

## 0. Objective

Make **Signal K the interconnect** between the boat's data and Meridian: instruments → (canboat/N2K per spec-n2k-interop, radar per spec-radar, radio) → Signal K bus → **Meridian subscribes as a client** → live data drives instruments, AIS, anchor watch, the live-at-boat overlay, and "graph any path." And because we're **not on a boat**, build a **simulator** that speaks the Signal K wire format so Meridian connects to it *identically* to a real boat — the dev interconnect and the demo harness.

## 1. What Signal K is (the parts that matter)

- **Data model:** a JSON tree rooted at `vessels.<self>` with standard paths: `navigation.*`, `environment.*`, `electrical.*`, `tanks.*`, `propulsion.*`; other vessels (AIS) live under `vessels.<urn>`.
- **Two access modes:** **full** snapshot (REST) and **delta** stream (WebSocket). Deltas are incremental `{path, value}` updates.
- **Units are SI** (m/s, radians, Kelvin, Pascal, meters) — **position is the exception (degrees)**. Meridian converts to display units (knots, degrees, °C). This is the #1 source of "why is my wind 4 knots" bugs.
- **Reference server:** `signalk/signalk-server` (Node, Apache-2.0), default **port 3000** (the host:port the LAYERS view already prompts for).

## 2. Connection architecture (Meridian as client)

- **Discovery:** `GET http://host:3000/signalk` → endpoints (`signalk-http`, `signalk-ws`, version).
- **Stream:** `ws://host:3000/signalk/v1/stream?subscribe=none`, then send an explicit subscription. On connect the server sends a **hello** with `self` (the own-ship context urn) — resolve `self` from it; never assume.
- **Subscribe** to only what's needed (per-path period), e.g.:
  ```json
  { "context":"vessels.self",
    "subscribe":[
      {"path":"navigation.position","period":1000},
      {"path":"environment.wind.speedApparent","period":1000},
      {"path":"environment.wind.angleApparent","period":1000},
      {"path":"navigation.speedOverGround","period":1000} ] }
  ```
- **Delta shape** to parse:
  ```json
  { "context":"vessels.urn:mrn:...",
    "updates":[{ "$source":"...","timestamp":"...",
      "values":[{"path":"navigation.position","value":{"latitude":0,"longitude":0}}] }] }
  ```
- **Snapshot:** `GET /signalk/v1/api/vessels/self` for initial state / late-join.
- **Where it runs:** the **Electron main process** holds the WS/REST connection (renderer never opens raw sockets — same rule as `app://3dtiles` / `127.0.0.1:9123`), and exposes a narrow bridge `window.meridian.signalk.*` (subscribe(path), latest(path), ownship(), status()). The LAYERS view's existing host:port + CONNECT stub wires to this.
- **Resilience:** auto-reconnect with backoff; on disconnect, keep last values + mark stale; offline is normal (a boat rarely loses its own bus, but the UI must not crash on a gap).

## 3. Paths Meridian consumes (initial set)

| Domain | Path | Use |
|---|---|---|
| Nav | `navigation.position` | own-ship marker, track |
| Nav | `navigation.headingTrue` / `headingMagnetic` | heading, head-up |
| Nav | `navigation.courseOverGroundTrue`, `navigation.speedOverGround` | COG/SOG |
| Nav | `navigation.speedThroughWater` | STW (polar/leeway) |
| Env | `environment.wind.{speedApparent,angleApparent,speedTrue,angleTrueWater,directionTrue}` | live-at-boat wind |
| Env | `environment.current.{drift,setTrue}` | live current |
| Env | `environment.depth.belowTransducer` / `belowKeel` | depth, anchor watch |
| Env | `environment.water.temperature` | instruments |
| Elec | `electrical.batteries.<id>.{voltage,capacity.stateOfCharge}` | battery pane |
| Tanks | `tanks.{fuel,freshWater,wasteWater,blackWater}.<id>.currentLevel` | tank panes |
| Prop | `propulsion.<id>.{revolutions,temperature,runTime}` | engine pane |
| AIS | `vessels.<urn>.navigation.*`, `.name`, `.mmsi` | AIS targets |

## 4. Unit handling (one place, always)

Convert SI→display **at the bridge**, once, not per-view: m/s→kn (x1.94384), rad→deg (x180/pi), K→°C (−273.15), Pa→hPa (÷100), ratio→%. Keep raw SI available too (the routing/polar math wants SI). Position stays degrees.

## 5. Live rendering rules (tie to viz)

- **Measured != forecast.** Signal K wind/current draws **at own-ship in cyan**, never merged into the forecast field (spec-wind-current-layers; stated on the LAYERS view). The bridge tags values as measured so the viz can't accidentally blend them.
- **Graph any path** (VIZ W2): any subscribed numeric path becomes a time-series **pane** — the agent or user says "graph the starboard tank," the bridge subscribes, the viz renders a pane, routed to a display. This is the generalized primitive the whole boat-OS display layer rides on.

## 6. THE SIMULATOR (boatless dev + demo harness) — first-class, build early

A standalone service that **speaks the Signal K wire format** so Meridian connects to it exactly as to a real boat — **zero-change swap** to a real bus later.

- **Wire-faithful:** serves `/signalk` discovery, the `/signalk/v1/stream` WS (with hello + `self`), and `/signalk/v1/api` snapshot on a configurable port (default 3000). Emits standard paths in **SI units**. If Meridian can't tell it from a real server, it's correct.
- **Scenario-driven (JSON):** start position, a **track or a Meridian-computed route**, a vessel polar (reuse `lib/vessel.js` J/120 or Lagoon), a true-wind source (synthetic field **or pull the same Open-Meteo field the app uses** for realism), tank start levels + drain rates, battery profile, engine schedule, and **AIS targets** (each with its own track).
- **Physics-lite tick loop:** advance own-ship along the track at boat speed (polar given local true wind) → COG/SOG; compute **apparent wind** from true wind + boat vector; update depth (synthetic or bathy lookup); drain tanks; cycle battery; toggle engine; advance AIS targets; emit per-path deltas at realistic rates (position ~1 Hz, wind ~1-2 Hz).
- **Time control:** real-time / accelerated / pause / **scrub** — and ideally **slaved to the app timeline** so sim time aligns with forecast time. *Killer demo:* watch the sim boat sail through the exact forecast field shown in the LAYERS view.
- **Routing integration:** feed it a Meridian-computed optimal route so the sim boat **follows its own route through the real weather** — develop + demo routing, viz, AIS, anchor watch, and the voice "how are we tracking?" all together, on land.
- **Log replay (optional, for fidelity):** replay recorded real NMEA/Signal K logs.
- **Conformance check:** periodically validate Meridian against the **real `signalk-server`** (sample/demo mode) so the sim never drifts from the standard.

The simulator is not throwaway: it's the permanent dev interconnect, the CI harness for boat-data features, and the demo rig for design partners / YouTubers before anyone's aboard.

## 7. Implementation phases

1. **Client connect:** main-process WS/REST to a Signal K server, `self` resolution, subscription, the `window.meridian.signalk.*` bridge, SI→display conversion. Wire the LAYERS CONNECT stub.
2. **Simulator v1:** wire-faithful discovery+stream+snapshot, one scenario (a passage near Hawaii to match the demo), own-ship + wind + depth + SOG/COG. Meridian connects to it unchanged.
3. **Live-at-boat overlay:** measured wind/current at own-ship in cyan, never merged.
4. **Graph-any-path panes** (VIZ W2): subscribe→time-series pane→display routing.
5. **Simulator v2:** AIS targets, tanks/battery/engine, route-following, timeline slaving, Open-Meteo true-wind.
6. **AIS + anchor-watch** consumers off the live bus.

## 8. Acceptance criteria

- Meridian connects to a real `signalk-server` **and** the simulator with **no code difference** (same discovery/stream/snapshot/`self`).
- All consumed paths convert SI→display once at the bridge; raw SI still available to routing/polar.
- Measured wind/current renders at own-ship in cyan and is **never** blended into the forecast field (verified).
- Any subscribed numeric path can be graphed as a pane and routed to a display.
- The simulator drives a full scenario (own-ship moving along a route, wind, depth, tanks draining, AIS targets) with time scrub; the sim boat can follow a Meridian-computed route through an Open-Meteo field.
- Disconnect/reconnect never crashes the UI; stale values marked.

## 9. Open questions

- Simulator in Node (reuse signalk-server internals) vs. standalone Rust (matches the sidecar pattern, ships as one binary). Lean: standalone, wire-faithful, no signalk-server dependency — but conformance-check against the real server.
- Does Meridian ever **run** a Signal K server (for boats without one) or always connect to an existing one? (Lean: client-only v1; bundle/recommend signalk-server separately.)
- Anchor-watch + alarm thresholds: in Meridian or read from Signal K notifications (`notifications.*`)?
- AIS target volume / CPA-TCPA computation: in the bridge or a viz consumer?
