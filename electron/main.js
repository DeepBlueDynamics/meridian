import { app, BrowserWindow, protocol, net, ipcMain, shell, screen, Menu } from "electron";
import { startBridge, stopBridge, notifyViewChanged } from "./bridge.js";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── .env (main process only) ──────────────────────────────────────────────
// The Google key lives ONLY here. It is never sent to the renderer; the proxy
// below signs outbound requests and rewrites the tileset so the page only ever
// talks to app://3dtiles/*.
function loadDotEnv() {
  try {
    const envPath = path.join(__dirname, "..", ".env");
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (k && !(k in process.env)) process.env[k] = v;
    }
  } catch (e) {
    console.warn("[env] load failed:", e.message);
  }
}
loadDotEnv();

const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY || "";
const UPSTREAM = "https://tile.googleapis.com";
const PROXY_ORIGIN = "app://3dtiles";

if (!GOOGLE_KEY) {
  console.warn("[3dtiles] GOOGLE_MAPS_API_KEY not set — 3D tiles will be unavailable. Add it to .env (see .env.example).");
}

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// ── Google Photorealistic 3D Tiles proxy ──────────────────────────────────
// ToS: key never in any response body; rewrite Google origins → proxy origin;
// preserve the `session` param; pass Cache-Control through; add no caching.
function registerTilesProxy() {
  protocol.handle("app", async (req) => {
    const url = new URL(req.url);
    if (url.hostname !== "3dtiles") return new Response("Not found", { status: 404 });
    if (!GOOGLE_KEY) {
      return new Response(JSON.stringify({ error: "GOOGLE_MAPS_API_KEY not configured." }),
        { status: 503, headers: { "content-type": "application/json" } });
    }
    const qs = new URLSearchParams(url.search);
    qs.set("key", GOOGLE_KEY);
    const upstreamUrl = `${UPSTREAM}${url.pathname}?${qs.toString()}`;

    let upstream;
    try {
      upstream = await net.fetch(upstreamUrl);
    } catch (err) {
      console.error("[3dtiles] upstream error:", err);
      return new Response(JSON.stringify({ error: "Upstream error" }), { status: 502, headers: { "content-type": "application/json" } });
    }

    const headers = new Headers();
    for (const h of ["content-type", "cache-control", "etag", "last-modified"]) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }
    const ct = upstream.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const body = await upstream.text();
      const rewritten = body
        .replaceAll(UPSTREAM, PROXY_ORIGIN)
        .replace(/([?&])key=[^&"']+/g, "$1")
        .replace(/[?&]"/g, '"');
      return new Response(rewritten, { status: upstream.status, headers });
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  });
}

// ── Control server (127.0.0.1:9123) ───────────────────────────────────────
// A local API so the agent can drive + observe the app over curl (the practical
// stand-in for MCP tools):
//   GET  /health         → "ok"
//   GET  /screenshot     → PNG of the actual rendered canvas (no OS occlusion)
//   POST /eval  body=JS  → runs JS in the renderer, returns JSON result
//                          (window.m.* exposes camera/clip/ocean helpers)
//   POST /reload         → reload the page
let mainWin = null;
const CONTROL_PORT = 9123;

// Renderer telemetry sink — stub for a future remote endpoint. For now every
// event is appended as a JSON line to telemetry.log at the repo root so errors
// are inspectable locally (and by the agent) after the fact.
const TELEMETRY_LOG = path.join(__dirname, "..", "telemetry.log");
function logTelemetry(entry) {
  try {
    fs.appendFileSync(TELEMETRY_LOG, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
  } catch (e) { console.warn("[telemetry] write failed:", e.message); }
}

// ── Meridian service auth (spec-service-usage §3) ─────────────────────────
// Login happens in the SYSTEM browser (nuts-auth magic link / OAuth); the
// redirect lands here on the loopback control server and the JWT persists in
// userData. The renderer reads it through the narrow auth bridge — pages
// never see the redirect flow.
const authTokenFile = () => path.join(app.getPath("userData"), "meridian-jwt.txt");
function readAuthToken() {
  try {
    const filePath = authTokenFile();
    if (!fs.existsSync(filePath)) return null;
    const t = fs.readFileSync(filePath, "utf8").trim();
    if (!t) return null;
    const parts = t.split(".");
    if (parts.length === 3) {
      try {
        const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
        if (payload.exp && payload.exp < Date.now() / 1000) {
          console.log("[auth] JWT token has expired, clearing file");
          try { fs.unlinkSync(filePath); } catch (e) {}
          notifyAuthChanged();
          return null;
        }
      } catch (err) {
        console.warn("[auth] failed to parse JWT payload:", err.message);
      }
    }
    return t;
  } catch (e) {
    return null;
  }
}
function notifyAuthChanged() {
  try { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send("meridian:auth-changed"); } catch (e) { /* noop */ }
}

// ── MCP endpoint (Streamable HTTP, JSON responses) ────────────────────────
// Lets coding agents drive the app window — sized recordings need exact
// content dimensions. POST /mcp speaks MCP JSON-RPC; .mcp.json at the repo
// root registers it with Claude Code. Same loopback-only server as /eval.
const MCP_PRESETS = {
  "720p": [1280, 720], "1080p": [1920, 1080], "1440p": [2560, 1440],
  "4k": [3840, 2160], "square": [1080, 1080], "vertical": [1080, 1920],
};
const MCP_TOOLS = [
  {
    name: "window_resize",
    description: "Resize (and optionally move) the Meridian app window. Sizes the CONTENT area by default so screen recordings capture exact pixel dimensions. Pass a preset or explicit width/height. Returns the resulting bounds.",
    inputSchema: {
      type: "object",
      properties: {
        preset: { type: "string", enum: Object.keys(MCP_PRESETS), description: "Named content size — overrides width/height" },
        width: { type: "number" }, height: { type: "number" },
        x: { type: "number", description: "Window position (pass both x and y)" }, y: { type: "number" },
        center: { type: "boolean", description: "Center on the current display after resizing" },
        outer: { type: "boolean", description: "Size the whole window incl. titlebar instead of the content area" },
      },
    },
  },
  {
    name: "window_bounds",
    description: "Current Meridian window bounds, content size, and display info (work area, scale factor) — check before/after a recording resize.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "app_screenshot",
    description: "Screenshot the Meridian app (PNG image content). Canvas-primary capture works even when the window is occluded. Same contract as the meridian sidecar's tool.",
    inputSchema: {
      type: "object",
      properties: {
        view: { type: "string", enum: ["main", "dep", "arr"], description: "Which canvas: main (default), or the routing view's dep/arr miniviews" },
      },
    },
  },
  {
    name: "telemetry_tail",
    description: "Tail meridian/telemetry.log (JSON-lines: renderer errors, unhandled rejections, custom events). The first place to look when a view misbehaves.",
    inputSchema: {
      type: "object",
      properties: {
        lines: { type: "number", description: "Trailing lines (default 20, max 200)" },
      },
    },
  },
];
function mcpWindowBounds() {
  const b = mainWin.getBounds();
  const [cw, ch] = mainWin.getContentSize();
  const d = screen.getDisplayMatching(b);
  return { bounds: b, contentSize: { width: cw, height: ch },
           display: { workArea: d.workArea, size: d.size, scaleFactor: d.scaleFactor } };
}
function mcpWindowResize(a = {}) {
  let w = a.width, h = a.height;
  if (a.preset) {
    if (!MCP_PRESETS[a.preset]) throw new Error("unknown preset: " + a.preset);
    [w, h] = MCP_PRESETS[a.preset];
  }
  if (w && h) {
    if (mainWin.isFullScreen()) mainWin.setFullScreen(false);
    if (mainWin.isMaximized()) mainWin.unmaximize();
    if (a.outer) mainWin.setSize(Math.round(w), Math.round(h));
    else mainWin.setContentSize(Math.round(w), Math.round(h));
  }
  if (typeof a.x === "number" && typeof a.y === "number") mainWin.setPosition(Math.round(a.x), Math.round(a.y));
  else if (a.center) mainWin.center();
  return mcpWindowBounds();
}

// ── shared app-control handlers ────────────────────────────────────────────
// One implementation each; both the :9123 HTTP control server and the
// meridian-sidecar bridge (:9124 agent surface) dispatch here.
const VIEW_FILES = { setup: "setup.html", routing: "routing.html", layers: "layers.html", helm: "helm.html", harbor: "index.html", radio: "radio.html" };
let currentView = "setup";
function viewFromUrl(u) {
  const f = String(u || "").split("/").pop().split("?")[0];
  return Object.keys(VIEW_FILES).find((k) => VIEW_FILES[k] === f) || f.replace(".html", "");
}

function evalInRenderer(code) {
  return mainWin.webContents.executeJavaScript(`(async () => { ${code} })()`, true);
}

// Renderer-canvas capture is primary: capturePage() returns empty when the
// window is occluded. view=dep|arr captures the routing miniviews.
async function captureScreenshot(which) {
  const expr =
    "(()=>{const M=window.m;if(!M)return '';" +
    "const v=" + (which === "dep" ? "M.depViewer" : which === "arr" ? "M.arrViewer" : "(M.mainViewer||M.viewer)") + ";" +
    "if(!v)return '';v.scene.render();return v.scene.canvas.toDataURL('image/png');})()";
  const dataUrl = await mainWin.webContents.executeJavaScript(expr, true).catch(() => "");
  if (dataUrl && dataUrl.startsWith("data:image/png")) return dataUrl;
  try { return (await mainWin.webContents.capturePage()).toDataURL(); } catch (e) { return ""; }
}

// loadFile resolves after did-finish-load — callers may eval immediately after.
async function loadView(view) {
  const page = VIEW_FILES[view];
  if (!page) throw new Error("unknown view: " + view + " (setup|routing|layers|harbor|radio)");
  await mainWin.loadFile(path.join(__dirname, "..", page));
  return view;
}

async function executeBridgeCommand(msg) {
  if (!mainWin || mainWin.isDestroyed()) return { ok: false, error: "no app window" };
  switch (msg.type) {
    case "AppStatus":
      return { ok: true, view: currentView, ...mcpWindowBounds(), signedIn: !!readAuthToken(), fullscreen: mainWin.isFullScreen() };
    case "Eval": {
      const r = await evalInRenderer(String(msg.code || ""));
      return { ok: true, result: r === undefined ? null : r };
    }
    case "Screenshot": {
      const d = await captureScreenshot(msg.view || "main");
      return d ? { ok: true, dataUrl: d } : { ok: false, error: "capture produced no pixels" };
    }
    case "WindowResize": return { ok: true, ...mcpWindowResize(msg) };
    case "WindowBounds": return { ok: true, ...mcpWindowBounds() };
    case "Navigate": return { ok: true, view: await loadView(String(msg.view || "")) };
    case "Reload": mainWin.reload(); return { ok: true };
    default: return { ok: false, error: "unknown command: " + msg.type };
  }
}

function startControlServer() {
  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    const url = new URL(req.url, "http://127.0.0.1");
    try {
      if (url.pathname === "/health") { res.end("ok"); return; }
      if (url.pathname === "/auth-callback") {
        let token = url.searchParams.get("token") || "";
        if (!token) {
          const rawUrl = req.url || "";
          const m = rawUrl.match(/[?&]token=([^&?#]+)/);
          if (m) token = decodeURIComponent(m[1]);
        }
        if (token) {
          try { fs.writeFileSync(authTokenFile(), token); } catch (e) { console.warn("[auth] persist failed:", e.message); }
          notifyAuthChanged();
          console.log("[auth] signed in via loopback");
        }
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(`<!doctype html><body style="font-family:ui-monospace,monospace;background:#0a0f18;color:#e8ecf3;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><div style="font-size:22px;margin-bottom:8px">${token ? "Signed in to Meridian" : "No token received"}</div><div style="color:#54627c;font-size:12px">you can close this tab and return to the app</div></div></body>`);
        return;
      }
      if (url.pathname === "/telemetry" && req.method === "POST") {
        let body = "";
        for await (const c of req) body += c;
        let entry;
        try { entry = JSON.parse(body); } catch { entry = { type: "raw", body: body.slice(0, 2000) }; }
        logTelemetry(entry);
        console.warn("[telemetry]", entry.type || "?", entry.message || "");
        res.end("ok");
        return;
      }
      // Config surface for the Setup view: key status + live .env writes.
      // The key takes effect immediately (the relay reads process.env per
      // request) — no restart. Never echo the key back.
      if (url.pathname === "/config/status") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ anthropicKey: !!process.env.ANTHROPIC_API_KEY }));
        return;
      }
      if (url.pathname === "/config/anthropic-key" && req.method === "POST") {
        let body = "";
        for await (const c of req) body += c;
        let key = "";
        try { key = String((JSON.parse(body) || {}).key || "").trim(); } catch (e) { /* empty */ }
        const envPath = path.join(__dirname, "..", ".env");
        let env = "";
        try { env = fs.readFileSync(envPath, "utf8"); } catch (e) { /* new file */ }
        const line = "ANTHROPIC_API_KEY=" + key;
        if (/^ANTHROPIC_API_KEY=.*$/m.test(env)) env = env.replace(/^ANTHROPIC_API_KEY=.*$/m, line);
        else env += (env.endsWith("\n") || env === "" ? "" : "\n") + line + "\n";
        fs.writeFileSync(envPath, env);
        if (key) process.env.ANTHROPIC_API_KEY = key; else delete process.env.ANTHROPIC_API_KEY;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, set: !!key }));
        return;
      }
      // Anthropic relay for the Helm terminal's widget builder — the key
      // stays in the MAIN process (.env ANTHROPIC_API_KEY), the renderer
      // only sees this loopback endpoint. Wire shape = the Messages API.
      if (url.pathname === "/anthropic/messages" && req.method === "POST") {
        const key = process.env.ANTHROPIC_API_KEY || "";
        res.setHeader("Content-Type", "application/json");
        if (!key) {
          res.statusCode = 503;
          res.end(JSON.stringify({ error: { message: "ANTHROPIC_API_KEY not set in .env — the widget builder needs it (or the service infer.complete executor, pending)" } }));
          return;
        }
        let body = "";
        for await (const c of req) body += c;
        try {
          const upstream = await net.fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
            body,
          });
          res.statusCode = upstream.status;
          res.end(await upstream.text());
        } catch (e) {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: { message: "relay: " + (e && e.message || e) } }));
        }
        return;
      }
      // Repo-relative lib assets over http — Babel standalone can't fetch
      // file:// sources (Chromium blocks file XHR), so the Helm terminal
      // loads its JSX from here.
      if (url.pathname.startsWith("/lib/") && req.method === "GET") {
        const name = path.basename(url.pathname);
        const fp = path.join(__dirname, "..", "lib", name);
        if (!/\.(js|jsx|css)$/.test(name) || !fs.existsSync(fp)) { res.statusCode = 404; res.end("not found"); return; }
        res.setHeader("Content-Type", "text/javascript; charset=utf-8");
        res.end(fs.readFileSync(fp));
        return;
      }
      // Local chart data with HTTP Range support — PMTiles readers fetch
      // byte ranges, and file:// pages can't fetch local files directly.
      if (url.pathname.startsWith("/charts/") && req.method === "GET") {
        const name = path.basename(url.pathname);
        const fp = path.join(__dirname, "..", "charts", name);
        if (!name.endsWith(".pmtiles") || !fs.existsSync(fp)) { res.statusCode = 404; res.end("not found"); return; }
        const size = fs.statSync(fp).size;
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Content-Type", "application/octet-stream");
        const m = (req.headers.range || "").match(/bytes=(\d+)-(\d*)/);
        if (m) {
          const start = +m[1], end = m[2] ? Math.min(+m[2], size - 1) : size - 1;
          res.statusCode = 206;
          res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
          res.setHeader("Content-Length", end - start + 1);
          fs.createReadStream(fp, { start, end }).pipe(res);
        } else {
          res.setHeader("Content-Length", size);
          fs.createReadStream(fp).pipe(res);
        }
        return;
      }

      if (url.pathname === "/mcp" && req.method === "POST") {
        let body = "";
        for await (const c of req) body += c;
        let msg;
        try { msg = JSON.parse(body); } catch { res.statusCode = 400; res.end(); return; }
        // notifications (e.g. notifications/initialized) get 202, no body
        if (msg.method && msg.method.startsWith("notifications/")) { res.statusCode = 202; res.end(); return; }
        const reply = (result, error) => {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(error ? { jsonrpc: "2.0", id: msg.id ?? null, error }
                                       : { jsonrpc: "2.0", id: msg.id ?? null, result }));
        };
        if (msg.method === "initialize")
          return reply({ protocolVersion: (msg.params && msg.params.protocolVersion) || "2025-03-26",
                         capabilities: { tools: {} }, serverInfo: { name: "meridian-control", version: "1.0.0" } });
        if (msg.method === "ping") return reply({});
        if (msg.method === "tools/list") return reply({ tools: MCP_TOOLS });
        if (msg.method === "tools/call") {
          const name = msg.params && msg.params.name, args = (msg.params && msg.params.arguments) || {};
          try {
            if (name === "telemetry_tail") {
              let text = "telemetry.log not found — no telemetry has been written yet";
              try {
                const lines = fs.readFileSync(TELEMETRY_LOG, "utf8").split(/\r?\n/).filter(Boolean);
                text = lines.slice(-Math.min(args.lines || 20, 200)).join("\n") || "telemetry.log is empty";
              } catch (err) { /* keep the not-found text */ }
              return reply({ content: [{ type: "text", text }] });
            }
            if (!mainWin || mainWin.isDestroyed()) throw new Error("no app window");
            if (name === "app_screenshot") {
              const dataUrl = await captureScreenshot(args.view || "main");
              const i = dataUrl.indexOf("base64,");
              if (i < 0) return reply({ content: [{ type: "text", text: "capture produced no image data — the window may be mid-boot; retry" }] });
              return reply({ content: [
                { type: "image", data: dataUrl.slice(i + 7), mimeType: "image/png" },
                { type: "text", text: "view: " + (args.view || "main") },
              ] });
            }
            let out;
            if (name === "window_resize") out = mcpWindowResize(args);
            else if (name === "window_bounds") out = mcpWindowBounds();
            else return reply(null, { code: -32602, message: "unknown tool: " + name });
            return reply({ content: [{ type: "text", text: JSON.stringify(out) }] });
          } catch (e) {
            return reply({ content: [{ type: "text", text: String((e && e.message) || e) }], isError: true });
          }
        }
        return reply(null, { code: -32601, message: "method not found: " + msg.method });
      }
      if (url.pathname === "/mcp") { res.statusCode = 405; res.end("POST JSON-RPC only"); return; }

      if (!mainWin || mainWin.isDestroyed()) { res.statusCode = 503; res.end("no window"); return; }

      // plain-REST convenience over the same window helpers (curl-friendly)
      if (url.pathname === "/window") {
        let out;
        if (req.method === "POST") {
          let body = "";
          for await (const c of req) body += c;
          out = mcpWindowResize(body ? JSON.parse(body) : {});
        } else out = mcpWindowBounds();
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, ...out }));
        return;
      }

      if (url.pathname === "/screenshot") {
        const dataUrl = await captureScreenshot(url.searchParams.get("view") || "main");
        const idx = dataUrl.indexOf("base64,");
        const png = idx >= 0 ? Buffer.from(dataUrl.slice(idx + 7), "base64") : Buffer.alloc(0);
        res.setHeader("Content-Type", "image/png");
        res.end(png);
        return;
      }
      if (url.pathname === "/eval" && req.method === "POST") {
        let body = "";
        for await (const c of req) body += c;
        let code = body;
        try { const j = JSON.parse(body); if (j && typeof j.code === "string") code = j.code; } catch { /* raw */ }
        const result = await evalInRenderer(code);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, result: result ?? null }));
        return;
      }
      if (url.pathname === "/reload") { mainWin.reload(); res.end("reloading"); return; }
      res.statusCode = 404; res.end("not found");
    } catch (e) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
    }
  });
  server.on("error", (e) => console.error("[control] server error:", e.message));
  server.listen(CONTROL_PORT, "127.0.0.1", () => console.log(`[control] http://127.0.0.1:${CONTROL_PORT}  (/screenshot /eval /reload /window /mcp)`));
}

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#04101c",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // keep rendering when occluded so capturePage works
    },
  });
  win.webContents.on("console-message", (_e, _lvl, message, line, src) => {
    console.log(`[RENDERER] ${message} (${src}:${line})`);
  });
  mainWin = win;
  // Track the live view (topbar nav swaps file:// pages) and tell the sidecar.
  win.webContents.on("did-finish-load", () => {
    currentView = viewFromUrl(win.webContents.getURL());
    notifyViewChanged(currentView);
  });
  // Start on the Vessel Setup view; nav links toggle to routing/layers/harbor at runtime.
  // MERIDIAN_VIEW=routing|layers|radio|harbor changes the start page.
  const v = process.env.MERIDIAN_VIEW;
  const page = VIEW_FILES[v] || "setup.html";
  currentView = viewFromUrl(page);
  win.loadFile(path.join(__dirname, "..", page));
  win.focus();
  // DevTools off by default (set MERIDIAN_DEVTOOLS=1 to open it).
  if (process.env.MERIDIAN_DEVTOOLS === "1") win.webContents.openDevTools({ mode: "detach" });
};

// External links from the renderer (e.g. the driver tool in the radio setup
// pane) open in the system browser; only http(s) is allowed through.
ipcMain.handle("meridian:open-external", (_e, url) => {
  if (typeof url === "string" && /^https?:\/\//i.test(url)) return shell.openExternal(url);
  return false;
});

// Auth bridge: the renderer reads/clears the persisted service JWT.
ipcMain.handle("meridian:auth-token", () => readAuthToken());
ipcMain.handle("meridian:auth-logout", () => {
  try { fs.unlinkSync(authTokenFile()); } catch (e) { /* already gone */ }
  notifyAuthChanged();
  return true;
});

// ── Remote transcription relay (spec-service-usage §7, audit A-04) ─────────
// The radio crate POSTs WAVs to a local Whisper server on :8765. This relay
// IS that server when the user's "Remote transcription service" toggle is ON
// and a JWT exists: it forwards to the Meridian service /transcribe (same
// contract — "a resolver only swaps the base URL") and normalizes the one
// wire difference (service "running" → crate "processing"). Toggle OFF or
// signed out → 503, which the crate treats as transcriber-unavailable (its
// existing queue/skip behavior). If a REAL local Whisper already owns :8765,
// the relay stays out of the way (port-in-use → relay disabled, local wins).
const SERVICE_BASE = process.env.MERIDIAN_SERVICE_URL || "https://meridian-service-ugcdy6vw7a-uc.a.run.app";
let transcribeCfg = { remote: false, saveLogs: false };
ipcMain.handle("meridian:transcribe-config", (_e, cfg) => {
  if (cfg && typeof cfg === "object") transcribeCfg = { ...transcribeCfg, ...cfg };
  return transcribeCfg;
});
function notifyTranscribeBackend(backend) {
  try { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send("meridian:transcribe-backend", backend); } catch (e) { /* noop */ }
}

function startTranscribeRelay() {
  const relay = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    const token = readAuthToken();
    const enabled = transcribeCfg.remote && !!token;
    const deny = (msg) => { res.statusCode = 503; res.end(JSON.stringify({ status: "failed", error: msg })); };
    try {
      if (req.method === "POST" && req.url === "/transcribe") {
        if (!enabled) return deny(transcribeCfg.remote ? "remote transcription: sign in required" : "remote transcription disabled");
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const upstream = await net.fetch(SERVICE_BASE + "/transcribe", {
          method: "POST",
          headers: { "content-type": req.headers["content-type"] || "application/octet-stream", authorization: "Bearer " + token },
          body: Buffer.concat(chunks),
        });
        res.statusCode = upstream.status;
        res.end(await upstream.text());
        return;
      }
      const mStatus = req.url && req.url.match(/^\/status\/([\w-]+)$/);
      if (req.method === "GET" && mStatus) {
        if (!enabled) return deny("remote transcription disabled");
        const upstream = await net.fetch(`${SERVICE_BASE}/status/${mStatus[1]}`, { headers: { authorization: "Bearer " + token } });
        let j = {};
        try { j = await upstream.json(); } catch (e) { /* non-JSON upstream */ }
        if (j.status === "running") j.status = "processing"; // crate matches queued|processing
        if (j.backend) notifyTranscribeBackend(j.backend);
        res.statusCode = upstream.ok ? 200 : upstream.status;
        res.end(JSON.stringify(j));
        return;
      }
      const mDl = req.url && req.url.match(/^\/download\/([\w-]+)$/);
      if (req.method === "GET" && mDl) {
        if (!enabled) return deny("remote transcription disabled");
        const upstream = await net.fetch(`${SERVICE_BASE}/download/${mDl[1]}`, { headers: { authorization: "Bearer " + token } });
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.statusCode = upstream.status;
        res.end(await upstream.text());
        return;
      }
      res.statusCode = 404; res.end('{"error":"not found"}');
    } catch (e) {
      deny("relay error: " + (e && e.message || e));
    }
  });
  relay.on("error", (e) => {
    if (e.code === "EADDRINUSE") console.log("[transcribe-relay] :8765 already owned (local Whisper?) — relay disabled, local wins");
    else console.error("[transcribe-relay] error:", e.message);
  });
  relay.listen(8765, "127.0.0.1", () => console.log("[transcribe-relay] http://127.0.0.1:8765 → " + SERVICE_BASE + " (gated by remote toggle + JWT)"));
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // no File/Edit/View chrome — this is a helm app
  registerTilesProxy();
  createWindow();
  startControlServer();
  startTranscribeRelay();
  // Agent surface: dial the meridian-sidecar's WS bus (:9124). Fail-soft —
  // the app is fully functional with no sidecar running.
  startBridge({ appVersion: app.getVersion(), getView: () => currentView, execute: executeBridgeCommand });
});

app.on("window-all-closed", () => { stopBridge(); if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
