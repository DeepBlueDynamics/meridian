// Sidecar bridge — the app is the CLIENT of meridian-sidecar's WebSocket bus
// (ws://127.0.0.1:9124/ws). Reconnect forever: the app must work fine with no
// sidecar running (plain dev without cargo), and sidecar restarts must be
// invisible. The sidecar sends {type, seq, ...} commands; we execute them via
// the same handlers the :9123 control server uses and reply
// {type:"ToolResult", seq, result:"<json string>"}.
// Pattern transposed from Hyperia app/bridge.ts (connect/backoff/heartbeat).
import WebSocket from "ws";

const RECONNECT_BASE_MS = 2000, RECONNECT_MAX_MS = 30000, HEARTBEAT_MS = 5000;
const PORT = +(process.env.MERIDIAN_SIDECAR_PORT || 9124);

let ws = null, stopped = false, reconnectTimer = null, heartbeatTimer = null;
let reconnectDelay = RECONNECT_BASE_MS;
let opts = null; // { appVersion, getView, execute(msg) -> Promise<object> }

export function startBridge(o) {
  opts = o;
  stopped = false;
  connect();
}

export function stopBridge() {
  stopped = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  stopHeartbeat();
  try { if (ws) ws.close(); } catch (e) { /* noop */ }
  ws = null;
}

export function notifyViewChanged(view) {
  send({ type: "ViewChanged", view });
}

function connect() {
  if (stopped) return;
  try { ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`); }
  catch (e) { scheduleReconnect(); return; }

  ws.on("open", () => {
    reconnectDelay = RECONNECT_BASE_MS;
    send({ type: "Hello", appVersion: opts.appVersion, view: opts.getView(), pid: process.pid });
    startHeartbeat();
  });

  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch (e) { return; }
    if (typeof msg.seq !== "number") return; // commands are always seq'd
    let result;
    try { result = await opts.execute(msg); }
    catch (e) { result = { ok: false, error: String((e && e.message) || e) }; }
    send({ type: "ToolResult", seq: msg.seq, result: JSON.stringify(result ?? null) });
  });

  ws.on("close", () => { stopHeartbeat(); ws = null; scheduleReconnect(); });
  ws.on("error", () => { /* close drives the retry */ });
}

function scheduleReconnect() {
  if (stopped || reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => send({ type: "Heartbeat", view: opts.getView() }), HEARTBEAT_MS);
}

function stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(obj)); } catch (e) { /* noop */ }
  }
}
