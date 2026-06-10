// Headless validation of the Google 3D Tiles key + the main.js proxy rewrite.
// Run: node scripts/test-3dtiles-proxy.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const KEY = (env.match(/GOOGLE_MAPS_API_KEY=(.+)/) || [])[1]?.trim();
if (!KEY) { console.error("no key"); process.exit(1); }

const UP = "https://tile.googleapis.com";
const PROXY = "app://3dtiles";

function rewrite(body) {
  return body
    .replaceAll(UP, PROXY)
    .replace(/([?&])key=[^&"']+/g, "$1")
    .replace(/[?&]"/g, '"');
}

const root = `${UP}/v1/3dtiles/root.json?key=${encodeURIComponent(KEY)}`;
console.log("1) GET root.json ...");
const r = await fetch(root);
console.log("   status:", r.status, r.headers.get("content-type"));
console.log("   cache-control:", r.headers.get("cache-control"));
if (!r.ok) { console.error("   body:", (await r.text()).slice(0, 400)); process.exit(1); }

const raw = await r.text();
console.log("   raw length:", raw.length);
const rw = rewrite(raw);
console.log("   contains AIzaSy after rewrite?", rw.includes("AIzaSy"));
console.log("   contains googleapis after rewrite?", rw.includes("tile.googleapis.com"));

// Find a child URI and follow it the way the proxy would.
const json = JSON.parse(raw);
function findUri(node) {
  if (!node || typeof node !== "object") return null;
  if (typeof node.uri === "string") return node.uri;
  if (node.content?.uri) return node.content.uri;
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) { for (const e of v) { const f = findUri(e); if (f) return f; } }
    else if (typeof v === "object") { const f = findUri(v); if (f) return f; }
  }
  return null;
}
const childUri = findUri(json.root);
console.log("\n2) sample child uri from root:", childUri?.slice(0, 90));

if (childUri) {
  // Simulate Cesium resolving it against app://3dtiles/v1/3dtiles/root.json,
  // then the proxy mirroring pathname+query to Google with the key.
  const resolved = new URL(childUri, "app://3dtiles/v1/3dtiles/root.json");
  const qs = new URLSearchParams(resolved.search);
  qs.set("key", KEY);
  const upstreamChild = `${UP}${resolved.pathname}?${qs.toString()}`;
  console.log("   proxy would fetch:", upstreamChild.replace(KEY, "<KEY>").slice(0, 110));
  const cr = await fetch(upstreamChild);
  console.log("   child status:", cr.status, cr.headers.get("content-type"));
  console.log("   session preserved?", qs.has("session"));
}
console.log("\nOK — key valid, rewrite strips key & origin, child path resolves.");
