import { app, BrowserWindow, protocol, net, ipcMain, shell } from "electron";
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
  try { const t = fs.readFileSync(authTokenFile(), "utf8").trim(); return t || null; } catch (e) { return null; }
}
function notifyAuthChanged() {
  try { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send("meridian:auth-changed"); } catch (e) { /* noop */ }
}

function startControlServer() {
  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    const url = new URL(req.url, "http://127.0.0.1");
    try {
      if (url.pathname === "/health") { res.end("ok"); return; }
      if (url.pathname === "/auth-callback") {
        const token = url.searchParams.get("token") || "";
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

      if (!mainWin || mainWin.isDestroyed()) { res.statusCode = 503; res.end("no window"); return; }

      if (url.pathname === "/screenshot") {
        // Renderer-canvas capture is primary: capturePage() returns empty when the
        // window is occluded. Captures the main Cesium view (panel/harbors verified
        // separately). Optional ?view=dep|arr captures those canvases.
        const which = url.searchParams.get("view") || "main";
        const expr =
          "(()=>{const M=window.m;if(!M)return '';" +
          "const v=" + (which === "dep" ? "M.depViewer" : which === "arr" ? "M.arrViewer" : "(M.mainViewer||M.viewer)") + ";" +
          "if(!v)return '';v.scene.render();return v.scene.canvas.toDataURL('image/png');})()";
        let png = Buffer.alloc(0);
        const dataUrl = await mainWin.webContents.executeJavaScript(expr, true).catch(() => "");
        if (dataUrl && dataUrl.startsWith("data:image/png")) png = Buffer.from(dataUrl.split(",")[1], "base64");
        if (png.length === 0) { try { png = (await mainWin.webContents.capturePage()).toPNG(); } catch { /* noop */ } }
        res.setHeader("Content-Type", "image/png");
        res.end(png);
        return;
      }
      if (url.pathname === "/eval" && req.method === "POST") {
        let body = "";
        for await (const c of req) body += c;
        let code = body;
        try { const j = JSON.parse(body); if (j && typeof j.code === "string") code = j.code; } catch { /* raw */ }
        const result = await mainWin.webContents.executeJavaScript(`(async () => { ${code} })()`, true);
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
  server.listen(CONTROL_PORT, "127.0.0.1", () => console.log(`[control] http://127.0.0.1:${CONTROL_PORT}  (/screenshot /eval /reload)`));
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
  // Start on the Vessel Setup view; nav links toggle to routing/layers/harbor at runtime.
  // MERIDIAN_VIEW=routing|layers|radio|harbor changes the start page.
  const v = process.env.MERIDIAN_VIEW;
  const page = v === "harbor" ? "index.html" : v === "routing" ? "routing.html"
             : v === "layers" ? "layers.html" : v === "radio" ? "radio.html" : "setup.html";
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
  registerTilesProxy();
  createWindow();
  startControlServer();
  startTranscribeRelay();
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
