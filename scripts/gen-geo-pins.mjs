#!/usr/bin/env node
// Pins bit-exact reference values from the REAL lib/router.js for the Rust
// geo/polar unit tests. Prints f64 bit patterns (hex) — paste into
// sidecar/tests/geo_parity.rs when the pin set changes.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
global.window = {};
eval(fs.readFileSync(path.join(root, "lib/router.js"), "utf8"));
eval(fs.readFileSync(path.join(root, "lib/vessel.js"), "utf8"));
const R = window.Router;
const J120 = window.Vessel.DEFAULT;

const bits = (x) => {
  const b = Buffer.alloc(8);
  b.writeDoubleLE(x);
  return "0x" + b.readBigUInt64LE().toString(16).padStart(16, "0");
};

const NEWPORT = { lat: 41.4945, lon: -71.3173 };
const STGEORGE = { lat: 32.3833, lon: -64.675 };
const polar = R.makePolar(J120);

const pins = {
  gc_newport_bermuda: R.gcDistance(NEWPORT, STGEORGE),
  bearing_newport_bermuda: R.bearing(NEWPORT, STGEORGE),
  walk_lat: R.sphereWalk(NEWPORT, 123.45, 15.7).lat,
  walk_lon: R.sphereWalk(NEWPORT, 123.45, 15.7).lon,
  circ_350_10: R.circDiff(350, 10),
  circ_10_350: R.circDiff(10, 350),
  polar_close_reach: polar(47.3, 11.2),
  polar_fold: polar(200, 5),          // folds to 160
  polar_nogo: polar(20, 8),           // below aMin → 0
  polar_clamp_high: polar(185, 30),   // folds to 175, tws clamped to 25
  polar_neg: polar(-64.2, 17.9),      // abs()
};
for (const [k, v] of Object.entries(pins)) console.log(`${k} = ${bits(v)}  // ${v}`);
