#!/usr/bin/env node
// Signal K ingest bridge — skiff POSTs deltas to $SIGNALK_HOST/signalk/v1/api/
// but stock signalk-server has NO http delta ingest (404); the standard way
// in is the WebSocket stream. This shim accepts skiff's POSTs on :3100 and
// forwards each delta verbatim over a WS client connection to the real
// server. Point skiff at SIGNALK_HOST=http://127.0.0.1:3100 (run-sim.ps1
// does). Zero new deps — reuses the app's `ws` package; run from the repo.

import http from "node:http";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const PORT = +(process.env.SK_BRIDGE_PORT || 3100);
const SK_WS = process.env.SK_WS || "ws://127.0.0.1:3000/signalk/v1/stream?subscribe=none";

let ws = null, open = false;
const queue = [];
let forwarded = 0;

function connect() {
  ws = new WebSocket(SK_WS);
  ws.on("open", () => {
    open = true;
    console.log("[sk-bridge] upstream connected:", SK_WS);
    for (const m of queue.splice(0)) ws.send(m);
  });
  ws.on("close", () => { open = false; setTimeout(connect, 2000); });
  ws.on("error", () => { /* close drives the retry */ });
  ws.on("message", () => { /* hello/acks — ignore */ });
}
connect();

http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (open) { ws.send(body); forwarded++; }
      else queue.push(body);
      res.end('{"ok":true}');
    });
    return;
  }
  res.end(JSON.stringify({ bridge: "skiff→signalk", upstream: SK_WS, connected: open, forwarded }));
}).listen(PORT, "127.0.0.1", () => console.log(`[sk-bridge] http://127.0.0.1:${PORT} → ${SK_WS}`));
