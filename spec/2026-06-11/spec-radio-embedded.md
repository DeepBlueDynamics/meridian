# spec-radio-embedded.md

**Component:** Embedded radio stack — all radio code lives in this repo; zero user setup
**Spec-ID:** radio-embedded
**Version:** v1
**Status:** draft
**Revised:** 2026-06-11 (UTC)
**Depends-on:** spec-radio, spec-service-layer
**Referenced-by:** spec-radio-audit
**Supersedes:** — (refines spec-radio §3: gnosis-radio was the *reference*, not the shipping shape)
**License-posture:** Apache-2.0. Vendored Rust derived from gnosis-radio (same author); whisper.cpp (MIT); RTL-SDR via librtlsdr.

## 1. Objective

Ship the VHF radio capability inside the Meridian app: one install, one launch,
no separate processes for the user to start, no manual driver hunts. The
external gnosis-radio crate served as the reference implementation; its proven
pipeline gets vendored into this repo and supervised by the Electron main
process. Target hardware includes Raspberry Pi class machines.

## 2. Decisions (owner-confirmed 2026-06-11)

- **Sidecar, in-repo** — vendor the Rust pipeline into `radio/` (workspace
  member), spawned/supervised by Electron main. Not a Node port.
- **Driver onboarding in the center pane** — when no radio is detected, the
  radio view's middle column shows the guided setup (implemented; static steps
  today, live device-state detection once the supervisor reports it).
- **Transcription** — whisper.cpp sidecar, **small model** (Pi-class), with a
  **remote transcription service** fallback/override. UI: one toggle "Remote
  transcription service" (when ON it is the whole story — local row hides) plus
  a "Save logs remotely" toggle. Both shipped as STUB-badged toggles persisted
  in `localStorage meridian.transcribe`; remote spec arrives separately
  (service-layer agent's territory).
- **Standardized top bar** — one nav (Setup · Routing · Layers · Harbor ·
  Radio) via `lib/topbar.js`, mounted with `<nav data-meridian-nav>` in every
  view (implemented). **Pane notifications:** the Radio chip carries an unread
  badge — transcriptions arriving while on any other view increment it (the
  preload bridge exists on every page); opening Radio clears it. Pattern is
  generic: future panes can register their own badges the same way.
- **Synthetic data must self-identify** — `scripts/mock-radio.mjs` stays as a
  dev tool; it flags `mock:true` in `/api/status` and the view banners
  "⚠ SYNTHETIC FEED". It is never auto-started.

## 3. Architecture

```
meridian/
  radio/                  ← vendored Rust (from gnosis-radio; TUI/web-UI/entropy stripped)
    src/…  Cargo.toml        keeps: wideband scan, squelch/voice classify, recorder,
                             transcribe client, broadcast bus, WS :9081, control :9080
  electron/main.js        ← sidecar supervisor: spawn/restart/kill, state events
  electron/preload.js     ← window.meridian.radio.* bridge (implemented)
  radio.html              ← view (implemented; engine ported from the reference web UI)
  scripts/mock-radio.mjs  ← synthetic feed for dev (implemented)
```

Wire contract is frozen as implemented: WS :9081 (binary PCM frame =
4B channel + 4B freq + 4B f32 signal_db + f32 samples; JSON events
channel_activity / squelch / signal_level / transcription / voice_paint),
control :9080 (`/api/status`, `/channel`, `/recording`, `/listen`,
`/squelch`, `/api/transcriptions`).

## 4. Build agents (for agent-spec authoring)

1. **radio-core** (Rust) — vendor + strip the reference crate into `radio/`;
   headless `scan` only; structured startup/state JSON on stdout so the
   supervisor can distinguish `running / no-device / no-driver / crashed`;
   keep the wire contract bit-exact. **Hard-won field findings (2026-06-11)
   that are requirements:** (a) bundle the **rtl-sdr-blog patched librtlsdr**
   — the stock osmocom DLL misdetects the RTL-SDR Blog V4 (R828D) as R820T,
   the PLL never locks (`[R82XX] PLL not locked!`, i2c write failures) and the
   receiver silently sits on noise; (b) **scan mode must broadcast on the WS
   like monitor mode does** — IMPLEMENTED in the reference crate 2026-06-11,
   port verbatim: `always_stream` pipeline flag (continuous demod audio incl.
   static from a "tap" channel — user-selected via /channel, CH 16 default,
   slot never auto-removed), ChannelActivity + SignalLevel heartbeats even
   when idle, lock derived ONLY from squelch-open pipelines (raw FFT
   detections flipped UIs between noise birdies; scanning reports
   channel: None and UIs render a SCANNING state); (c) the squelch noise-floor EMA **tracks
   continuous carriers** (NOAA/broadcast never open squelch) — use a frozen /
   min-hold floor or a slow-decay envelope so constant signals are detectable.
   Acceptance: builds in-repo on Windows + Pi (aarch64), runs against an
   RTL-SDR Blog V4, the existing radio view works unchanged, NOAA weather
   audio opens squelch.
2. **sidecar-supervisor** (Electron main) — child-process lifecycle (spawn at
   app start, restart with backoff, kill on quit), port-collision guard,
   `window.meridian.radio.sidecarState` events, npm hooks so `npm start`
   builds/uses the sidecar transparently. Must handle the **stale-instance
   case** (observed live 2026-06-11): a half-dead prior instance holding
   :9080/:9081 AND the USB device blocks any new start (`usb_open -3`) — on
   startup, detect and kill stale instances the supervisor owns (PID file /
   process name) before spawning. Acceptance: kill -9 the sidecar → app heals;
   quit app → no orphan processes; relaunch after a crashed app reclaims ports
   and dongle without user action.
3. **driver-onboarding** (Windows UX) — live device detection (RTL2838
   VID/PID + driver-bound state), drives the radio view's setup pane states;
   investigate bundled libwdi for one-tap WinUSB install (single elevation);
   graceful manual-Zadig fallback. Acceptance: plugging a virgin dongle leads
   to a working radio without leaving the app.
4. **transcribe-local** — whisper.cpp sidecar, small model,
   download-on-first-use; queue WAVs when offline; honor the remote toggle
   (route to service `/transcribe` instead when ON — contract from the
   service-layer agent). Acceptance: spoken test WAV → transcript event on
   :9081 within seconds on Pi-class CPU.
5. **radio-view** (frontend — this agent) — wire supervisor states into the
   setup pane, unread-badge polish, voicepaint overlay on real data, logbook
   hook (spec-userdata) later.

## 5. Acceptance (end-to-end)

Fresh machine, dongle in: install app → launch → radio view shows guided
driver step only if needed → after driver, live spectrogram + transcripts with
zero terminal commands. On Pi: sustained scan + small-model transcription
without starving the chart UI. Radio chip badges transmissions from any view.

## 6. Open questions

- libwdi bundling vs. documented Zadig step (lean: try libwdi behind the
  one-tap; it is what Zadig uses).
- Remote transcription/log contract — pending owner spec (service layer).
- Pi audio out path (cpal device selection) — defer to radio-core agent.
