#!/usr/bin/env node
// Generates build/icon.ico — the app icon, drawn in code so the repo needs
// no image toolchain. A 256px PNG (node zlib) wrapped in a one-image ICO
// (PNG-in-ICO is valid from Vista on, and it's what electron-builder emits
// for NSIS/exe resources anyway).
//
//   node scripts/gen-icon.mjs
//
// Design: deep-navy disc, thin cyan ring, vertical meridian line, amber
// north needle — the app's suite palette (see index.html top bar).

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const SIZE = 256;
const SS = 4; // supersample factor for edge smoothing
const N = SIZE * SS;

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const NAVY = hex("#0a0f18");
const RING = hex("#39d2ff");
const LINE = hex("#54627c");
const AMBER = hex("#ffb938");
const SOUTH = hex("#26313f");

// point-in-triangle via sign tests
function inTri(px, py, ax, ay, bx, by, cx, cy) {
  const s1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const s2 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
  const s3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
}

// sample color at supersampled coords → [r,g,b,a]
function sample(x, y) {
  const c = N / 2;
  const dx = x - c, dy = y - c;
  const r = Math.sqrt(dx * dx + dy * dy);
  const R = N * 0.47, ringW = N * 0.018;
  if (r > R) return [0, 0, 0, 0];
  if (r > R - ringW) return [...RING, 255];
  // needle: north amber (up), south dark — slim diamonds
  const halfW = N * 0.055, tipN = c - N * 0.34, tipS = c + N * 0.34;
  if (inTri(x, y, c, tipN, c - halfW, c, c + halfW, c)) return [...AMBER, 255];
  if (inTri(x, y, c, tipS, c - halfW, c, c + halfW, c)) return [...SOUTH, 255];
  // vertical meridian line through the disc
  if (Math.abs(dx) < N * 0.006 && Math.abs(dy) < R - ringW * 2) return [...LINE, 255];
  // faint horizontal
  if (Math.abs(dy) < N * 0.004 && Math.abs(dx) < R - ringW * 2) return [...LINE, 200];
  return [...NAVY, 255];
}

// downsample to SIZE with box filter
const rgba = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const [pr, pg, pb, pa] = sample(x * SS + sx + 0.5, y * SS + sy + 0.5);
        r += pr * pa; g += pg * pa; b += pb * pa; a += pa;
      }
    }
    const i = (y * SIZE + x) * 4, n = SS * SS;
    rgba[i] = a ? Math.round(r / a) : 0;
    rgba[i + 1] = a ? Math.round(g / a) : 0;
    rgba[i + 2] = a ? Math.round(b / a) : 0;
    rgba[i + 3] = Math.round(a / n);
  }
}

// ── minimal PNG encoder (filter 0 rows + zlib) ──
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  rgba.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

// ── wrap in ICO (single PNG entry) ──
const ico = Buffer.alloc(6 + 16);
ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4); // icon dir, 1 image
ico[6] = 0; ico[7] = 0;        // 256 → encoded as 0
ico[8] = 0; ico[9] = 0;        // palette, reserved
ico.writeUInt16LE(1, 10);      // planes
ico.writeUInt16LE(32, 12);     // bpp
ico.writeUInt32LE(png.length, 14);
ico.writeUInt32LE(6 + 16, 18); // offset
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "build");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "icon.ico"), Buffer.concat([ico, png]));
fs.writeFileSync(path.join(outDir, "icon.png"), png);
console.log("build/icon.ico + icon.png written,", png.length, "bytes png");
