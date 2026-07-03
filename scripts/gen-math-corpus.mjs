#!/usr/bin/env node
// Math-parity corpus generator (R-1 of the isochrone Rust port).
//
// The route engine's behavior is branch-saturated: a 1-ulp difference in a
// transcendental flips discrete decisions and reroutes a member entirely.
// This script pins V8's Math.{sin,cos,asin,atan2} outputs over a large input
// corpus; the Rust side (sidecar/tests/math_parity.rs) bit-compares libm
// against these files. Run once per corpus bump:
//
//   node scripts/gen-math-corpus.mjs [N]     (default 1e6 per function)
//
// Output: sidecar/tests/corpus/{sin,cos,asin,atan2}.bin
//   sin/cos/asin:  N pairs of f64 LE  (input, output)
//   atan2:         N triples of f64 LE (y, x, output)
// Files are regeneratable and gitignored.

import fs from "node:fs";
global.window = {};
import path from "node:path";
import { fileURLToPath } from "node:url";

eval(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "lib/fdmath.js"), "utf8"));
const FdMath = global.window.FdMath;
const N = Math.max(1000, parseInt(process.argv[2] || "1000000", 10));
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "sidecar", "tests", "corpus");
fs.mkdirSync(outDir, { recursive: true });

// Deterministic RNG (mulberry32) so corpora are reproducible.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Engine-realistic domains + adversarial edges.
const EDGE = [0, -0, 1e-320, -1e-320, 1e-15, -1e-15, 0.5, -0.5, 1, -1,
  Math.PI, -Math.PI, Math.PI / 2, -Math.PI / 2, 2 * Math.PI, -2 * Math.PI,
  0.9999999999999999, -0.9999999999999999, 6.2831853, 100, -100];

function genUnary(name, fn, sampler, seed) {
  const rnd = mulberry32(seed);
  const buf = Buffer.alloc(N * 16);
  for (let i = 0; i < N; i++) {
    const x = i < EDGE.length ? EDGE[i] : sampler(rnd);
    buf.writeDoubleLE(x, i * 16);
    buf.writeDoubleLE(fn(x), i * 16 + 8);
  }
  fs.writeFileSync(path.join(outDir, name + ".bin"), buf);
  console.log(`${name}.bin  ${N} samples`);
}

// sin/cos: angles the engine actually feeds (deg*D2R up to ±2π, plus big)
const angleSampler = (rnd) => {
  const r = rnd();
  if (r < 0.7) return (rnd() * 4 - 2) * Math.PI;          // ±2π
  if (r < 0.9) return (rnd() * 720 - 360) * (Math.PI / 180); // deg-derived
  return (rnd() * 2e6 - 1e6) / 1000;                       // wilder
};
genUnary("sin", FdMath.sin, angleSampler, 0xC0FFEE);
genUnary("cos", FdMath.cos, angleSampler, 0xBEEF01);
// asin: domain [-1,1] with heavy density near ±1 (gcDistance hits sqrt(a)≈1)
genUnary("asin", Math.asin, (rnd) => {
  const r = rnd();
  if (r < 0.5) return rnd() * 2 - 1;
  const near = 1 - Math.pow(10, -(rnd() * 16 + 1));
  return rnd() < 0.5 ? near : -near;
}, 0xA51DE5);

// atan2: quadrant pairs incl. tiny/huge magnitude ratios
{
  const rnd = mulberry32(0xA7A2A7A2);
  const buf = Buffer.alloc(N * 24);
  const mag = () => Math.pow(10, rnd() * 12 - 6) * (rnd() < 0.5 ? -1 : 1);
  for (let i = 0; i < N; i++) {
    let y, x;
    if (i < EDGE.length * EDGE.length && i < 400) { y = EDGE[i % EDGE.length]; x = EDGE[(i / EDGE.length) | 0]; }
    else { y = mag(); x = mag(); }
    buf.writeDoubleLE(y, i * 24);
    buf.writeDoubleLE(x, i * 24 + 8);
    buf.writeDoubleLE(FdMath.atan2(y, x), i * 24 + 16);
  }
  fs.writeFileSync(path.join(outDir, "atan2.bin"), buf);
  console.log(`atan2.bin  ${N} samples`);
}
console.log("corpus →", outDir);
