# spec-radio-audit.md

**Component:** VHF Radio Stack (gnosis-radio & Electron Integration)
**Spec-ID:** radio-audit
**Version:** v1
**Status:** draft
**Revised:** 2026-06-11 (UTC)
**Depends-on:** spec-radio, spec-radio-embedded
**Referenced-by:** —
**Supersedes:** —
**License-posture:** MIT / Proprietary

---

## 1. Objective

This specification provides a thorough code and architecture audit of the Meridian VHF Radio Stack, analyzing the integration between the Electron frontend, the preload IPC socket bridges, the mock data services, and the reference Rust `gnosis-radio` sidecar specifications. The goal is to verify compliance with performance targets, security postures, DSP correctness, FCC regulations, and highlight exact implementation discrepancies or code issues.

## 2. Scope

**In-Scope:**
- **IPC & Wire Protocols:** Auditing the WebSocket binary protocol (9081) and the HTTP control API (9080) implemented in [preload.js](file:///workspace/meridian/electron/preload.js) and [mock-radio.mjs](file:///workspace/meridian/scripts/mock-radio.mjs).
- **DSP & Visualization:** Auditing the Hanning-windowed STFT calculation, voice confidence metrics, spectrogram rendering, and audio queuing inside [radio.html](file:///workspace/meridian/radio.html).
- **Compliance & Security:** Reviewing hardware bounds, potential transmit routes (PTT), and key/credential isolation.
- **Embedded Lifecycle:** Inspecting the process supervisor plans against the current Electron main loop implementation.

**Out-of-Scope:**
- Modifying the external Rust RTL-SDR demodulator crate code directly.
- Performance optimization of the GPU shaders or system-level audio output selection.

## 3. Architecture & Data Flow Audited

The current data flow relies on a local loopback bridge between the host OS services and the Electron runtime:

```
[RTL-SDR USB Dongle] 
       │ (FM Demodulation)
       ▼
 [gnosis-radio] ──(9081 WS Binary/JSON)──▶ [preload.js] ──(Window Event)──▶ [radio.html (Renderer)]
 (Rust Service)                                                            (STFT, WebAudio, Canvas)
       ▲                                                                       │
       │                                                                       ▼
       └──────────(9080 HTTP Control)◀───────────────────────────── [radio.control()]
```

---

## 4. Key Audit Findings & Risks

### 4.1. Visual & Threading Bottlenecks (Performance Risk)
- **Problem:** [radio.html:350-393](file:///workspace/meridian/radio.html#L350-L393) performs a 2048-point radix-2 Fast Fourier Transform (STFT) with Hanning windowing and voice-confidence evaluation in the **main UI thread** on every 100ms chunk of incoming demodulated audio. It then draws directly onto a 2D canvas context.
- **Impact:** On resource-constrained target devices like Raspberry Pi 4/5 models, rendering Google 3D Tiles alongside continuous Javascript-based FFT operations and canvas repaints in the same thread will result in layout stutters, UI thread blocking, and audio buffer underruns.
- **Mitigation:**
  - Offload the FFT computation and voice confidence logic to a **Web Worker**.
  - Alternatively, since the Rust `gnosis-radio` sidecar already possesses high-performance DSP loops (`rustfft`), modify the wire protocol to send pre-computed spectral magnitude bins directly over the WebSocket, reducing the frontend to a simple rendering client.

### 4.2. Audio Playback Underflow & Jitter (DSP Quality Risk)
- **Problem:** [radio.html:453-472](file:///workspace/meridian/radio.html#L453-L472) schedules Web Audio API buffer playback directly at `Math.max(audioCtx.currentTime + 0.02, playhead)`. It lacks a jitter buffer, clock drift correction, or packet loss concealment (PLC).
- **Impact:** Any delay in IPC message processing, garbage collection (GC) pauses in the renderer, or network congestion on loopback port 9081 will cause audio glitches, audible "pops," or drift.
- **Mitigation:** Implement a simple sliding ring buffer queue with a small buffer delay (e.g., 100-200ms) to absorb frame arrival jitter, only feeding scheduling time offsets when buffer depth shifts outside nominal bounds.

### 4.3. Missing Process Supervisor (Implementation Gap)
- **Problem:** The embedded sidecar architecture described in `spec-radio-embedded.md` states that the Electron main process should spawn, restart, and kill the Rust `radio` executable, and handle port collisions. However, [main.js](file:///workspace/meridian/electron/main.js) has **no code** to spawn or monitor the Rust executable; it only boots the static files and starts port 9123.
- **Impact:** The application fails to boot the radio service on launch. The user must manually run the SDR service or run `node scripts/mock-radio.mjs` in a separate terminal.
- **Mitigation:** Implement the `sidecar-supervisor` logic in [main.js](file:///workspace/meridian/electron/main.js) to spawn the Rust sidecar from a designated relative path (e.g., `./bin/radio`), handle stdout state parsing, and write a PID lock file.

### 4.4. Stubbed Transcription Configuration (Implementation Gap)
- **Problem:** The toggles "Remote transcription service" and "Save logs remotely" in [radio.html:601-613](file:///workspace/meridian/radio.html#L601-L613) only update local UI states (`localStorage.getItem('meridian.transcribe')`). There is no operational integration in the preload script or the main process to redirect transcription WAV binaries to either a local `whisper.cpp` engine or a remote API.
- **Impact:** Transcripts are only generated if the Rust backend happens to make a background HTTP POST itself. The frontend UI toggles have no functional impact on the actual transcription routing.
- **Mitigation:** Define clear IPC routes (e.g., `meridian:transcribe`) so that when "Remote transcription" is toggled, the audio is routed through the main process or Electron net requests to the remote service API defined in `spec-service-layer.md`.

### 4.5. Safety & FCC Compliance (Compliance Verification)
- **Status:** **PASS**
- **Analysis:** A deep scan of the radio control surface and mock services shows **no transmitter endpoints, PTT (Push-To-Talk) RF logic, or microphone-to-SDR hooks**. The system remains strictly listen-only and acts as a passive consumer of SDR-demodulated audio. This keeps the stack fully within the unregulated receive-only FCC boundary.

---

## 5. Wire Contract Verification

The audited payload interfaces match the reference specification:

### 5.1. WebSocket Stream (9081)
- **Binary Audio Frame Layout:**
  - Bytes 0-3: `Channel Number` (Uint32LE)
  - Bytes 4-7: `Frequency in Hz` (Uint32LE)
  - Bytes 8-11: `Signal Strength in dB` (Float32LE)
  - Bytes 12+: `48kHz Float32 PCM Samples`
- **JSON Event Frames:**
  - `{ type: "squelch", channel: Number, freq: Number, open: Boolean, signal_db: Number, classification: "Voice"|"Carrier"|"Static" }`
  - `{ type: "transcription", channel: Number, freq: Number, text: String }`
  - `{ type: "signal_level", ... }`

### 5.2. HTTP Control API (9080)
- GET `/api/status` -> Exposes device and squelch states.
- POST `/channel` -> `{ channel: Number }` to retune the SDR.
- POST `/squelch` -> `{ squelch: Number }` to adjust threshold margins.

---

## 6. Audit Recommendations Summary

| Ref | Target File | Issue | Severity | Recommendation |
| :--- | :--- | :--- | :--- | :--- |
| **A-01** | `radio.html` | UI Thread FFT Demodulation | **Medium** | Offload FFT loop to Web Worker or move to Rust sidecar. |
| **A-02** | `radio.html` | Playback Jitter & Clicks | **Low** | Implement a sliding frame jitter buffer. |
| **A-03** | `main.js` | Missing Rust sidecar supervisor | **High** | Implement subprocess spawning, health check, and stale port cleanup. |
| **A-04** | `radio.html` | Stubbed remote transcription switches | **Medium** | Wire local/remote service routing hooks based on UI toggle states. |
