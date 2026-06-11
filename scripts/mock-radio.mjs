#!/usr/bin/env node
// Synthetic Meridian Radio feed for UI development without an RTL-SDR:
//   node scripts/mock-radio.mjs
// Serves the same surface the real crate does — WS broadcast on :9081
// (binary PCM audio frames + JSON events) and the HTTP control API on :9080.
// Synthesis: 2.5 s voice-like bursts (F1/F2 formants over a 120 Hz harmonic
// series + onset sibilance) every ~5 s on a rotating channel, silence between.
import http from "node:http";
import crypto from "node:crypto";

const WS_PORT = 9081, CTRL_PORT = 9080, SR = 48000;
const CHANNELS = { 16: 156800000, 9: 156450000, 13: 156650000, 22: 157100000, 68: 156425000 };
const TEXTS = [
  "Sécurité, sécurité — all stations, navigation warning, vessel adrift vicinity of buoy romeo two, mariners advised to keep clear.",
  "Marina this is sailing vessel Wanderlust, requesting a transient slip for tonight, over.",
  "Motor vessel northbound at the bridge, this is the tug Resolute, request you hold for my tow.",
  "Switching six eight. We anchored north side of the cove, good holding in four meters.",
  "Coast guard sector, radio check on one six, over. — Loud and clear, captain, out.",
];

// ── state ──
const state = { mock: true, channel: 16, frequency_hz: CHANNELS[16], recording: true, listen: false,
  squelch: 12, signal_db: -95, noise_floor: -92, squelch_open: false, audio_flatness: 0.85 };
let txLog = [];

// ── minimal WebSocket server (server→client only, no masking needed) ──
const wsClients = new Set();
const wsServer = http.createServer();
wsServer.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.on("error", () => wsClients.delete(socket));
  socket.on("close", () => wsClients.delete(socket));
  wsClients.add(socket);
  console.log("[mock-radio] ws client connected,", wsClients.size, "total");
});
function frame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) { header = Buffer.from([0x80 | opcode, len]); }
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([header, payload]);
}
function sendJson(obj) { const f = frame(1, Buffer.from(JSON.stringify(obj))); for (const s of wsClients) s.write(f); }
function sendAudio(samples) {
  const buf = Buffer.alloc(12 + samples.length * 4);
  buf.writeUInt32LE(state.channel, 0); buf.writeUInt32LE(state.frequency_hz, 4); buf.writeFloatLE(state.signal_db, 8);
  for (let i = 0; i < samples.length; i++) buf.writeFloatLE(samples[i], 12 + i * 4);
  const f = frame(2, buf); for (const s of wsClients) s.write(f);
}

// ── voice-ish synthesis ──
let t = 0, phase = 0; // phase: cycle position in seconds (5 s loop: 0-2.5 voice, 2.5-5 idle)
const CHUNK = 4800;   // 100 ms
let txIdx = 0;
function synth() {
  const out = new Float32Array(CHUNK);
  const voiced = phase < 2.5;
  for (let i = 0; i < CHUNK; i++) {
    const ti = t + i / SR;
    let s = (Math.random() - 0.5) * 0.01;                       // noise floor
    if (voiced) {
      const env = Math.sin(Math.PI * Math.min(1, phase / 2.5)) * (0.7 + 0.3 * Math.sin(ti * 7));
      const f0 = 120 + 18 * Math.sin(ti * 2.2);                  // pitch wobble
      for (let h = 1; h <= 24; h++) {
        const f = f0 * h;
        if (f > 3600) break;
        // formant envelope: F1 ~500, F2 ~1700
        const a = Math.exp(-((f - 500) ** 2) / (2 * 180 ** 2)) + 0.7 * Math.exp(-((f - 1700) ** 2) / (2 * 260 ** 2)) + 0.12;
        s += Math.sin(2 * Math.PI * f * ti) * a * env * 0.05;
      }
      if (phase < 0.18) s += (Math.random() - 0.5) * 0.25 * (1 - phase / 0.18); // onset sibilance
    }
    out[i] = Math.max(-1, Math.min(1, s));
  }
  t += CHUNK / SR;
  return { out, voiced };
}

setInterval(() => {
  const prevVoiced = phase < 2.5;
  const { out, voiced } = synth();
  phase += CHUNK / SR;
  state.signal_db = voiced ? -48 + Math.random() * 6 : -91 + Math.random() * 3;
  state.squelch_open = voiced;
  state.audio_flatness = voiced ? 0.32 + Math.random() * 0.1 : 0.82 + Math.random() * 0.1;
  if (voiced !== prevVoiced || (phase >= 5)) {
    if (voiced && !prevVoiced) { /* never happens mid-loop */ }
  }
  // squelch edge events
  if (voiced && !synth._open) {
    synth._open = true;
    sendJson({ type: "squelch", channel: state.channel, freq: state.frequency_hz, open: true, signal_db: state.signal_db, classification: "Voice" });
  } else if (!voiced && synth._open) {
    synth._open = false;
    sendJson({ type: "squelch", channel: state.channel, freq: state.frequency_hz, open: false, signal_db: state.signal_db, classification: "Voice" });
    // transcription ~1 s after the burst ends, then rotate channel
    const ch = state.channel, freq = state.frequency_hz, text = TEXTS[txIdx++ % TEXTS.length];
    setTimeout(() => {
      const entry = { timestamp: new Date().toISOString(), channel: ch, freq, text };
      txLog.push(entry); if (txLog.length > 100) txLog.shift();
      sendJson({ type: "transcription", channel: ch, freq, text });
    }, 1000);
    const keys = Object.keys(CHANNELS).map(Number);
    state.channel = keys[(keys.indexOf(state.channel) + 1) % keys.length];
    state.frequency_hz = CHANNELS[state.channel];
  }
  if (phase >= 5) phase = 0;
  sendAudio(out);
}, 100);

setInterval(() => {
  sendJson({ type: "signal_level", channel: state.channel, freq: state.frequency_hz, signal_db: state.signal_db,
    noise_floor: state.noise_floor, squelch_open: state.squelch_open, audio_flatness: state.audio_flatness });
}, 200);

setInterval(() => {
  const active = Object.entries(CHANNELS).map(([ch, f]) => ({
    channel: +ch, label: "CH" + ch, freq: f,
    signal_db: +ch === state.channel ? state.signal_db : -95 + Math.random() * 8,
    classification: +ch === state.channel && state.squelch_open ? "Voice" : Math.random() < 0.2 ? "Carrier" : "Static",
  }));
  sendJson({ type: "channel_activity", active, noise_floor: state.noise_floor });
}, 2000);

// ── control API ──
const ctrl = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  let body = "";
  req.on("data", (c) => body += c);
  req.on("end", () => {
    const j = (() => { try { return JSON.parse(body); } catch { return {}; } })();
    if (req.url === "/api/status") return res.end(JSON.stringify(state));
    if (req.url === "/api/transcriptions") return res.end(JSON.stringify(txLog));
    if (req.url === "/channel" && req.method === "POST") {
      if (j.channel && CHANNELS[j.channel]) { state.channel = j.channel; state.frequency_hz = CHANNELS[j.channel]; }
      return res.end(JSON.stringify({ status: "ok", channel: state.channel, frequency_hz: state.frequency_hz }));
    }
    if (req.url === "/recording" && req.method === "POST") { state.recording = !!j.recording; return res.end(JSON.stringify({ status: "ok", recording: state.recording })); }
    if (req.url === "/listen" && req.method === "POST") { state.listen = !!j.listen; return res.end(JSON.stringify({ status: "ok", listen: state.listen })); }
    if (req.url === "/squelch" && req.method === "POST") { state.squelch = +j.squelch || 12; return res.end(JSON.stringify({ status: "ok", squelch: state.squelch })); }
    res.statusCode = 404; res.end('{"error":"not found"}');
  });
});

wsServer.listen(WS_PORT, () => console.log(`[mock-radio] ws://127.0.0.1:${WS_PORT}`));
ctrl.listen(CTRL_PORT, () => console.log(`[mock-radio] control http://127.0.0.1:${CTRL_PORT}`));
