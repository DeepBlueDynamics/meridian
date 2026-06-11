# spec-radar.md

_Revised: 2026-06-11 (UTC)_

**Component:** Radar integration via Mayara
**Status:** Designed in conversation. Not built.
**License posture:** Apache-2.0. Meridian talks to **Mayara** (Marine Yacht Radar server, by Kees Verruijt / canboat author) over its HTTP + WebSocket API — a **separate process at a network boundary**. Communicating with an independent program over a socket does not link its code or create a derivative work, so Meridian stays clean **regardless of Mayara's own license** (verify it before bundling vs. recommending-install).

---

## 1. Objective

Add radar overlay and a PPI display to Meridian without reverse-engineering any radar ourselves, by consuming Mayara's open, Signal-K-shaped radar API. Mayara already translates the proprietary Navico/Garmin/Furuno/Raymarine wire formats into an open HTTP/WebSocket interface and serves multiple clients simultaneously.

## 2. Architecture

```
Radar (Ethernet) → Mayara server (separate process) → open API
   • HTTP: discovery, controls (power/range/gain/sea/rain/mode)
   • WebSocket: spoke stream (per-sweep radial data)
        → Meridian: deck.gl/WebGL PPI overlay on MapLibre + control surface
```

Mayara runs on Windows/macOS/Linux incl. Raspberry Pi as its own service; Meridian never embeds it.

## 3. Rendering

- **Overlay mode:** georeference spokes to own-ship position from Signal K; heading-stabilize (north-up / course-up / head-up) using the compass heading Mayara/Signal K provides; draw the sweep as a WebGL layer composited over the chart with adjustable transparency.
- **PPI mode:** a dedicated radar panel (range rings, heading line, EBL/VRM).
- **Targets:** render ARPA/MARPA targets if Mayara exposes them; otherwise correlate visually with AIS targets from Signal K (do not fuse silently — keep sources distinguishable).
- Performance: spoke decode/draw in the WebGL layer; keep the hot path off the React render loop.

## 4. Control surface

Map Mayara HTTP controls to UI: power/standby, range, gain (auto/manual), sea clutter, rain clutter, mode/filters. Multi-radar aware (Mayara can serve dual-range / multiple radars).

## 5. Install / process model

- Detect a running Mayara on the LAN (it's designed for multi-client LAN use); if absent, offer to install/launch the bundled or downloaded binary as a managed sidecar service.
- All interaction is over the network API; no in-process linking. This is the same sidecar pattern as Signal K and Lume.

## 6. Hardware support (from Mayara, verify against live units)

- **Best:** Navico HALO (20/20+/24/4/6/8) and broadband BR24/3G/4G — most mature; recommended unit to own.
- **New unlock:** Furuno DRS-NXT series (incl. dual range), DRS4W WiFi, FAR-2xx7 — previously unsupported in the OpenCPN-era tooling.
- **Pending validation:** Garmin HD/xHD/xHD2/xHD3/Fantom (incl. Doppler/MotionScope), more Furuno.

## 7. Acceptance criteria

- Live spoke stream renders as a georeferenced, heading-stabilized overlay on the chart, and as a standalone PPI.
- Controls (range/gain/clutter/mode) round-trip to the radar via Mayara.
- Runs end-to-end against Mayara's emulator, then against a real Navico HALO.
- Verified: Meridian links no Mayara code; integration is network-API only (license-clean attested).

## 8. Open questions

- Confirm Mayara's license and decide bundle-as-sidecar vs. recommend-install.
- Whether to depend on Mayara's ARPA output or run Meridian's own target tracking over the spoke stream.
- Spoke-stream bandwidth/latency budget on a Pi-class boat computer.
