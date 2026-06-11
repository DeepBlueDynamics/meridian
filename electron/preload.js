const { contextBridge } = require("electron");

// ── gnosis-radio bridge (spec-radio §3) ─────────────────────────────────────
// The PRELOAD owns the sockets — page code never opens raw connections. It
// sees a narrow surface: window.meridian.radio.onEvent(cb) for the 9081 WS
// stream (binary PCM frames decoded here) and .control() for the 9080 HTTP
// control API. Same key-in-main/narrow-bridge pattern as the tiles proxy.
// gnosis-radio is a separate process; reconnect forever, fail soft.
const RADIO_WS = "ws://127.0.0.1:9081";
const RADIO_CTRL = "http://127.0.0.1:9080";
const radioListeners = new Set();
let radioWs = null, radioConnected = false;

function radioEmit(ev) {
  for (const cb of radioListeners) { try { cb(ev); } catch (e) { /* page's problem */ } }
}
function radioConnect() {
  try { radioWs = new WebSocket(RADIO_WS); } catch (e) { setTimeout(radioConnect, 2000); return; }
  radioWs.binaryType = "arraybuffer";
  radioWs.onopen = () => { radioConnected = true; radioEmit({ type: "conn", open: true }); };
  radioWs.onclose = () => {
    if (radioConnected) { radioConnected = false; radioEmit({ type: "conn", open: false }); }
    setTimeout(radioConnect, 2000);
  };
  radioWs.onerror = () => { /* onclose handles retry */ };
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

contextBridge.exposeInMainWorld("meridian", {
  isElectron: true,
  // The renderer only learns the proxied root URL — never the key.
  tiles: {
    rootUrl: "app://3dtiles/v1/3dtiles/root.json",
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
    // Narrow control surface → gnosis-radio :9080.
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
