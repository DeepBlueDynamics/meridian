const { contextBridge, ipcRenderer } = require("electron");

// ── Meridian Radio bridge (spec-radio §3 / spec-radio-embedded) ─────────────
// The PRELOAD owns the sockets — page code never opens raw connections. It
// sees a narrow surface: window.meridian.radio.onEvent(cb) for the 9081 WS
// stream (binary PCM frames decoded here) and .control() for the 9080 HTTP
// control API. Same key-in-main/narrow-bridge pattern as the tiles proxy.
// Meridian Radio runs as an integrated sidecar; reconnect forever, fail soft.
const RADIO_WS = "ws://127.0.0.1:9081";
const RADIO_CTRL = "http://127.0.0.1:9080";
const radioListeners = new Set();
let radioWs = null, radioConnected = false, radioRetryTimer = null;

function radioEmit(ev) {
  for (const cb of radioListeners) { try { cb(ev); } catch (e) { /* page's problem */ } }
}
function radioConnect() {
  if (radioRetryTimer) { clearTimeout(radioRetryTimer); radioRetryTimer = null; }
  try { radioWs = new WebSocket(RADIO_WS); } catch (e) { radioRetryTimer = setTimeout(radioConnect, 2000); return; }
  radioWs.binaryType = "arraybuffer";
  radioWs.onopen = () => { radioConnected = true; radioEmit({ type: "conn", open: true }); };
  radioWs.onclose = () => {
    if (radioConnected) { radioConnected = false; radioEmit({ type: "conn", open: false }); }
    radioRetryTimer = setTimeout(radioConnect, 2000);
  };
  radioWs.onerror = (e) => {
    console.warn(`[preload-radio] WebSocket connection failed to: ${RADIO_WS}`);
  };
  radioWs.onmessage = (e) => {
    if (typeof e.data === "string") {
      try { radioEmit(JSON.parse(e.data)); } catch (err) { /* skip bad frame */ }
      return;
    }
    // Binary audio frame: 4B channel + 4B freq + 4B signal_db (LE) + f32 PCM
    if (e.data.byteLength < 12) return;
    const v = new DataView(e.data);
    radioEmit({
      type: "audio",
      channel: v.getUint32(0, true) || null,
      freq: v.getUint32(4, true),
      signalDb: v.getFloat32(8, true),
      samples: new Float32Array(e.data, 12),
    });
  };
}
radioConnect();

// ── Signal K bridge (spec-signalk §2) ───────────────────────────────────────
// The PRELOAD owns the connection — discovery, hello→self resolution,
// explicit subscription, snapshot late-join, auto-reconnect — and converts
// SI → display units ONCE here (the #1 source of "why is my wind 4 knots"
// bugs); raw SI stays available for routing/polar math.
const SK_PATHS = [
  "navigation.position", "navigation.headingTrue", "navigation.courseOverGroundTrue",
  "navigation.speedOverGround", "navigation.speedThroughWater",
  "environment.wind.speedTrue", "environment.wind.directionTrue",
  "environment.wind.speedApparent", "environment.wind.angleApparent",
  "environment.current.drift", "environment.current.setTrue",
  "environment.depth.belowTransducer", "environment.water.temperature",
];
const skListeners = new Set(), skLatest = new Map(); // path → {path, si, display, units, ts}
let skWs = null, skGen = 0, skRetryTimer = null;
const skStatus = { connected: false, host: null, self: null, error: null };

function skConvert(path, v) {
  if (v == null) return { si: v, display: v, units: "" };
  if (typeof v === "object") return { si: v, display: v, units: "deg" }; // position is degrees already
  if (/speed|drift/i.test(path)) return { si: v, display: v * 1.94384, units: "kn" };
  if (/heading|course|direction|setTrue/i.test(path)) return { si: v, display: (v * 180 / Math.PI + 360) % 360, units: "°" };
  if (/angle/i.test(path)) return { si: v, display: v * 180 / Math.PI, units: "°" }; // apparent angle is signed
  if (/temperature/i.test(path)) return { si: v, display: v - 273.15, units: "°C" };
  if (/pressure/i.test(path)) return { si: v, display: v / 100, units: "hPa" };
  if (/currentLevel|stateOfCharge/i.test(path)) return { si: v, display: v * 100, units: "%" };
  if (/depth/i.test(path)) return { si: v, display: v, units: "m" };
  return { si: v, display: v, units: "" };
}
function skEmit(ev) { for (const cb of skListeners) { try { cb(ev); } catch (e) { /* page's problem */ } } }
function skSetStatus(patch) { Object.assign(skStatus, patch); skEmit({ type: "status", ...skStatus }); }
function skIngest(path, value, ts) {
  const rec = { path, ...skConvert(path, value), ts: ts || null };
  skLatest.set(path, rec);
  skEmit({ type: "delta", ...rec });
}
function skTeardown() {
  if (skRetryTimer) { clearTimeout(skRetryTimer); skRetryTimer = null; }
  if (skWs) { try { skWs.onclose = null; skWs.onmessage = null; skWs.close(); } catch (e) { /* noop */ } skWs = null; }
  skStatus.self = null;
}
function skConnect(hostport) {
  const gen = ++skGen;
  skTeardown();
  skLatest.clear();
  skSetStatus({ host: hostport, connected: false, error: null });
  try { skWs = new WebSocket(`ws://${hostport}/signalk/v1/stream?subscribe=none`); }
  catch (e) { skSetStatus({ error: String(e.message || e) }); return { ok: false, error: String(e.message || e) }; }
  skWs.onmessage = (e) => {
    if (gen !== skGen) return;
    let m; try { m = JSON.parse(e.data); } catch (err) { return; }
    if (m.self && !skStatus.self) {
      // hello: resolve self from the server, never assume (spec §2)
      skSetStatus({ connected: true, self: m.self });
      skWs.send(JSON.stringify({ context: "vessels.self", subscribe: SK_PATHS.map(p => ({ path: p, period: 1000 })) }));
      // snapshot late-join for initial state
      fetch(`http://${hostport}/signalk/v1/api/vessels/self`).then(r => r.json()).then(snap => {
        if (gen !== skGen) return;
        for (const p of SK_PATHS) {
          let node = snap;
          for (const seg of p.split(".")) { node = node && node[seg]; }
          if (node && node.value !== undefined && !skLatest.has(p)) skIngest(p, node.value, node.timestamp);
        }
      }).catch(() => { /* stream alone is fine */ });
      return;
    }
    for (const u of m.updates || []) for (const v of u.values || []) skIngest(v.path, v.value, u.timestamp);
  };
  skWs.onclose = () => {
    if (gen !== skGen) return;
    skSetStatus({ connected: false });
    // offline is normal on a boat: keep last values, mark down, retry
    skRetryTimer = setTimeout(() => { if (gen === skGen) skConnect(hostport); }, 3000);
  };
  skWs.onerror = () => { /* onclose drives the retry */ };
  return { ok: true };
}

contextBridge.exposeInMainWorld("meridian", {
  isElectron: true,
  platform: process.platform, // 'win32' | 'darwin' | 'linux' — drives OS-specific setup UI
  // External links open in the system browser, never navigate the app.
  openExternal: (url) => ipcRenderer.invoke("meridian:open-external", url),
  // The renderer only learns the proxied root URL — never the key.
  tiles: {
    rootUrl: "app://3dtiles/v1/3dtiles/root.json",
  },
  // Meridian service auth (loopback login → main persists the JWT).
  auth: {
    getToken: () => ipcRenderer.invoke("meridian:auth-token"),
    logout: () => ipcRenderer.invoke("meridian:auth-logout"),
    onChange: (cb) => { if (typeof cb === "function") ipcRenderer.on("meridian:auth-changed", () => cb()); },
  },
  // Signal K client (spec-signalk §2): connect/disconnect, latest values
  // (SI + display), own-ship position, event stream. Renderer never opens
  // the socket; the bridge tags everything as MEASURED data.
  signalk: {
    connect: (hostport) => skConnect(String(hostport || "").trim()),
    disconnect: () => { skGen++; skTeardown(); skSetStatus({ connected: false, host: null }); },
    status: () => ({ ...skStatus }),
    latest: (path) => skLatest.get(path) || null,
    ownship: () => { const p = skLatest.get("navigation.position"); return (p && p.si) ? { lat: p.si.latitude, lon: p.si.longitude } : null; },
    onEvent: (cb) => {
      if (typeof cb !== "function") return () => {};
      skListeners.add(cb);
      try { cb({ type: "status", ...skStatus }); } catch (e) { /* noop */ }
      return () => skListeners.delete(cb);
    },
  },
  // Remote-transcription relay control (main owns the :8765 relay).
  transcribe: {
    setConfig: (cfg) => ipcRenderer.invoke("meridian:transcribe-config", cfg),
    onBackend: (cb) => { if (typeof cb === "function") ipcRenderer.on("meridian:transcribe-backend", (_e, b) => cb(b)); },
  },
  radio: {
    // Subscribe to the radio event stream. Fires {type:"conn",open} immediately,
    // then audio / squelch / signal_level / channel_activity / transcription /
    // voice_paint events as they arrive. Returns an unsubscribe function.
    onEvent: (cb) => {
      if (typeof cb !== "function") return () => {};
      radioListeners.add(cb);
      try { cb({ type: "conn", open: radioConnected }); } catch (e) { /* noop */ }
      return () => radioListeners.delete(cb);
    },
    // Immediate retry — e.g. the setup pane's refresh button after a driver
    // install. Drops any pending backoff and reconnects right now.
    reconnect: () => {
      try { if (radioWs) { radioWs.onclose = null; radioWs.close(); } } catch (e) { /* noop */ }
      if (radioConnected) { radioConnected = false; radioEmit({ type: "conn", open: false }); }
      radioConnect();
    },
    // Narrow control surface → Meridian Radio :9080.
    //   control("/api/status")                      GET
    //   control("/channel", {channel:16})           POST
    //   control("/listen", {listen:true})           POST
    //   control("/recording", {recording:true})     POST
    //   control("/squelch", {squelch:12})           POST
    control: async (path, body) => {
      const opts = body === undefined ? {} :
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
      const r = await fetch(RADIO_CTRL + path, opts);
      try { return await r.json(); } catch (e) { return { status: r.status }; }
    },
  },
});
