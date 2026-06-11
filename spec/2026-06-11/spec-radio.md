# spec-radio.md

**Component:** VHF radio monitor, transcription & voice control (gnosis-radio)
**Spec-ID:** radio
**Version:** v1
**Status:** active
**Revised:** 2026-06-11 (UTC) — merged with Meridian app commit 369de01
**Depends-on:** spec-service-layer, spec-acp-and-search-v2, spec-auth, spec-userdata
**Referenced-by:** spec-service-layer, spec-radio-audit
**Supersedes:** —
**License-posture:** Apache-2.0. Existing `gnosis-radio` Rust crate (RTL-SDR) + existing Meridian Electron app. Transcription model server local; service fallback online. FCC: **listen/transcribe/local-PTT only — never auto-transmit.**

> **Merge target (the actual Meridian app, commit 369de01):** Electron shell, multi-page renderer (routing/setup), Google 3D tiles proxy in the main process via `app://3dtiles` (key never reaches renderer, no caching, ToS-as-code), isochrone router in `lib/router.js`, vessel/polar store (`lib/vessel.js`, `lib/orcdata.js` → DeepBlueDynamics/orc-data), global land mask (`lib/landmask.js`). **The app already runs a localhost control server in the main process at `127.0.0.1:9123` (`/screenshot /eval /reload /telemetry`)** and exposes a narrow `contextBridge` (`window.meridian`). This is the seam the radio integrates through — same localhost-service + key-in-main + narrow-bridge pattern. **No agent lives in the app** (confirmed by the code): the app is client/display; gnosis-radio and the standalone agent are separate processes it talks to.

---

## 1. Objective

Integrate the existing **gnosis-radio** VHF stack as a first-class Meridian source: monitor marine VHF, auto-detect voice, record transmissions, transcribe them, and feed the results into the logbook/search and the voice-control floor — with transcription running **locally in the desktop app by default** and **falling back to the service when online**. Listening and transcription are unregulated; the system never transmits.

## 2. What already exists (inherit, don't rebuild)

The `gnosis-radio` crate is a working RTL-SDR marine VHF monitor in Rust:

- **SDR + DSP:** `rtlsdr`, `cpal`, `rustfft`; `SDR_RATE 240k`, decimation, AFC, prebuffer (`main.rs`, `dsp.rs`, `wideband.rs`).
- **Marine channel map:** full US marine VHF channel↔frequency table incl. channel 16 (`channels.rs`).
- **Squelch + classification:** `SignalClassification { Static, Carrier, Voice }` from signal/noise/spectral-flatness/harmonics + voice detection (`pipeline/squelch.rs`) — **voice detection already kicks on by itself**, no model needed.
- **Recorder:** per-transmission WAV with timestamp/channel/freq filenames, fades (`pipeline/recorder.rs`), into `recordings/`.
- **Transcription:** background thread POSTs WAV to a local Whisper server (`http://localhost:8765`, `large-v3`) and broadcasts the result (`transcribe.rs`).
- **Broadcast bus:** `AudioMessage` enum (Audio, ChannelActivity, SquelchEvent, SignalLevel, Transcription, VoicePaint) over crossbeam → WebSocket (`broadcast.rs`, `web.rs`, **WS_PORT 9081**).
- **Control surface:** HTTP control on **CONTROL_PORT 9080** — get status, set channel/frequency, recording on/off, listen on/off, squelch margin (`control.rs`).
- **Agentic state + voicepaint:** activity/transcript ring buffers, voice-painting spectral analysis (`agentic.rs`, `voicepaint.rs`).
- **TUI + web UI + viz** (`tui.rs`, `viz.rs`, `web.rs`).

**The control ports (9080 HTTP, 9081 WS) are exactly the "tool with ports exposed for control" pattern** — this is the standalone-agent integration seam.

## 3. Architecture in Meridian (merged with the real app)

```
RTL-SDR ─▶ gnosis-radio (standalone process; ports 9080 ctrl / 9081 ws)
   • squelch+voice detect (no model) ─▶ record WAV ─▶ transcribe
                                                       │
        transcription source selection:               ▼
        ┌─ LOCAL (default, desktop): local Whisper server :8765
        └─ SERVICE (fallback, online): POST WAV to /transcribe (spec-service-layer)
                                                       │
   transcripts + activity (ws 9081) ─┬─▶ Meridian Electron app (renderer view)
                                     │     via main-process subscriber → contextBridge
                                     │     (same pattern as the :9123 control server +
                                     │      window.meridian bridge already in the app)
                                     ├─▶ logbook/search index (spec-userdata, Shivvr/Lume)
                                     └─▶ voice-control floor (entity→command)
```

**Integration seam (concrete, against commit 369de01):**
- gnosis-radio stays a **separate process** (its own 9080/9081). The Electron **main process** subscribes to the radio WS (9081) — mirroring how main already owns the `app://3dtiles` proxy and the `127.0.0.1:9123` control server — and forwards radio events to the renderer through the existing `contextBridge` (`window.meridian.radio.*`), so the renderer never opens raw sockets, same as it never sees the Google key.
- The app's existing localhost-control convention (`127.0.0.1:9123`) is the model for issuing radio control (channel/recording/squelch) from the app to gnosis-radio's 9080 — but gated as **Act** (single-tap + scoped token) per §6.
- **No agent in the app.** Control originates from the user (tap) or the standalone agent (separate process, also talking to 9080) — never from logic embedded in the renderer.

## 4. Transcription: local-default, service-fallback

- **Local (default, gated in the desktop app):** the existing `transcribe.rs` path to a local Whisper server (`large-v3` @ :8765). Works offline. This is the sovereign/desktop default.
- **Service fallback (online):** when the local model isn't present (coastal tier, no GPU) or is unavailable, POST the WAV to the service `/transcribe` endpoint (add to `spec-service-layer`), authorized by Nuts JWT, billed per `sub`. Same multipart pattern `transcribe.rs` already builds.
- **Selection:** local if a local transcription server responds; else service if online; else **queue the WAV** for later transcription (offline coastal — recordings are kept, transcribed when a model becomes reachable). Recording + voice-detect never depend on a model.

## 5. Outputs feed three consumers

1. **Logbook/search** (`spec-userdata`): every transcript + activity entry is indexed (Shivvr/Lume, `SearchSource::Logs`) so "what did the marina say on 16 this morning" resolves offline. Stored **locally**; uploaded only on opt-in.
2. **Voice-control floor:** transcripts run through `entities()` → deterministic command mapping (the no-model floor). The radio is *also* an input channel for the voice copilot (key the handset, talk).
3. **App display:** live channel activity, transcripts, and voicepaint viz over WS 9081.

## 6. Control via ACP/MCP

The 9080 control surface (channel, frequency, recording, listen, squelch) is wrapped as capabilities so the standalone agent can drive the radio: `radio.status` (Read), `radio.set_channel` / `radio.set_recording` / `radio.set_listen` / `radio.set_squelch` (**Act → single-tap confirm + scoped token**). Setting channel/recording is an `Act`; reading status/transcripts is `Read`.

## 7. FCC / safety boundary (inviolable)

- **Listen / transcribe / record only.** No transmit path. No automated transmission on 16/9 or any channel. The system has no PTT-out to the radio; the "handset as mic" is a **local control input**, not an RF transmission.
- This keeps the whole feature in the unregulated zone (receiving/decoding marine VHF needs no license).

## 8. Implementation phases

1. Run gnosis-radio as the standalone radio service (9080/9081). In the Electron **main process**, add a WS subscriber to 9081 and forward events to the renderer via `contextBridge` (`window.meridian.radio`) — mirroring the existing `app://3dtiles` proxy + `127.0.0.1:9123` control patterns; renderer opens no raw sockets.
2. Service `/transcribe` fallback endpoint + selection logic (local→service→queue).
3. Pipe transcripts/activity into `spec-userdata` local store + Shivvr/Lume index.
4. Wrap 9080 control as ACP capabilities (`radio.*`) with Read/Act gating; route app-originated control through main (like 9123), never raw from renderer.
5. Voice-control floor: transcript → `entities()` → command.

**Port note:** gnosis-radio uses 9080/9081; the Meridian app uses 9123 (control) and `app://3dtiles`. No conflict today — keep a single registry of localhost ports so future services (transcription :8765, agent, service proxy) don't collide.

## 9. Acceptance criteria

- Voice transmissions on a monitored channel auto-record and transcribe with **no model in the detection path** (squelch/voice classification only).
- Local transcription works fully offline; service fallback engages only when online and local is absent; offline-with-no-local **queues** WAVs (never drops them).
- Transcripts index into the local logbook and resolve via offline search; upload only on opt-in (`spec-userdata`).
- `radio.set_*` (Act) requires single-tap confirm + scoped JWT; `radio.status` (Read) does not.
- No transmit path exists anywhere in the integration (audited).

## 10. Open questions

- Local transcription model packaging for the desktop app (bundle Whisper server vs. detect existing) and Pi-class viability of `large-v3` vs. a smaller model.
- Whether voicepaint/spectral viz ships in v1 or is deferred.
- DSC decode (digital selective calling on 70) as a later structured-data source — out of scope v1.
