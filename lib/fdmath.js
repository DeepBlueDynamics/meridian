// FdMath — fdlibm 5.3 sin/cos/atan2 in JS. Classic script; window.FdMath.
//
// WHY: the route engine's results must be bit-identical across JS engines
// (Electron's V8 13.0 and node's V8 13.6 disagree by 1 ulp on sin/cos/atan2
// — measured live) AND across languages (the Rust sidecar port must match
// exactly; one flipped ulp flips a pruning branch and reroutes a member).
// Native Math.* ties results to the browser build; FdMath ties them to an
// algorithm. The Rust sidecar carries the same transliteration
// (sidecar/src/route/fdlibm.rs) — THESE TWO FILES MUST CHANGE TOGETHER,
// and sidecar corpus tests (scripts/gen-math-corpus.mjs) prove they agree.
//
// Only the route-affecting call sites use FdMath (router.js, landmask.js,
// routing.html's guard-path helpers). Display math stays on Math.*.
// asin/sqrt stay native: measured identical across engines (both correctly
// rounded / same kernels).
(function () {
  const buf = new ArrayBuffer(8), dv = new DataView(buf);
  function hi(x) { dv.setFloat64(0, x); return dv.getInt32(0); }           // high word (big-endian layout)
  function fromHi(h) { dv.setInt32(0, h); dv.setInt32(4, 0); return dv.getFloat64(0); }

  // ── kernels ──
  const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03,
        S3 = -1.98412698298579493134e-04, S4 = 2.75573137070700676789e-06,
        S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
  const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03,
        C3 = 2.48015872894767294178e-05, C4 = -2.75573143513906633035e-07,
        C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;

  function kernelSin(x, y, iy) {
    const z = x * x, v = z * x;
    const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
    if (iy === 0) return x + v * (S1 + z * r);
    return x - ((z * (0.5 * y - v * r) - y) - v * S1);
  }
  function kernelCos(x, y) {
    const ix = hi(x) & 0x7fffffff;
    const z = x * x;
    const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
    if (ix < 0x3FD33333) return 1.0 - (0.5 * z - (z * r - x * y));
    const qx = ix > 0x3fe90000 ? 0.28125 : fromHi(ix - 0x00200000);
    const hz = 0.5 * z - qx, a = 1.0 - qx;
    return a - (hz - (z * r - x * y));
  }

  // ── argument reduction (medium path — |x| <= 2^19·π covers all engine
  //    inputs; beyond it fall back to native, unreachable in the router) ──
  const INVPIO2 = 6.36619772367581382433e-01,
        PIO2_1 = 1.57079632673412561417e+00, PIO2_1T = 6.07710050650619224932e-11,
        PIO2_2 = 6.07710050630396597660e-11, PIO2_2T = 2.02226624879595063154e-21,
        PIO2_3 = 2.02226624871116645580e-21, PIO2_3T = 8.47842766036889956997e-32;

  function remPio2(x) {
    const hx = hi(x), ix = hx & 0x7fffffff;
    if (ix < 0x4002d97c) { // |x| < 3π/4
      let z, y0, y1;
      if (hx > 0) {
        z = x - PIO2_1;
        if (ix !== 0x3ff921fb) { y0 = z - PIO2_1T; y1 = (z - y0) - PIO2_1T; }
        else { z -= PIO2_2; y0 = z - PIO2_2T; y1 = (z - y0) - PIO2_2T; }
        return [1, y0, y1];
      } else {
        z = x + PIO2_1;
        if (ix !== 0x3ff921fb) { y0 = z + PIO2_1T; y1 = (z - y0) + PIO2_1T; }
        else { z += PIO2_2; y0 = z + PIO2_2T; y1 = (z - y0) + PIO2_2T; }
        return [-1, y0, y1];
      }
    }
    const t = Math.abs(x);
    const n = (t * INVPIO2 + 0.5) | 0;
    const fn = n;
    let r = t - fn * PIO2_1;
    let w = fn * PIO2_1T;
    let y0 = r - w;
    const j = ix >> 20;
    let i = j - ((hi(y0) >> 20) & 0x7ff);
    if (i > 16) {
      let tt = r;
      w = fn * PIO2_2;
      r = tt - w;
      w = fn * PIO2_2T - ((tt - r) - w);
      y0 = r - w;
      i = j - ((hi(y0) >> 20) & 0x7ff);
      if (i > 49) {
        tt = r;
        w = fn * PIO2_3;
        r = tt - w;
        w = fn * PIO2_3T - ((tt - r) - w);
        y0 = r - w;
      }
    }
    const y1 = (r - y0) - w;
    if (hx < 0) return [-n, -y0, -y1];
    return [n, y0, y1];
  }

  function sin(x) {
    const ix = hi(x) & 0x7fffffff;
    if (ix <= 0x3fe921fb) {
      if (ix < 0x3e500000) return x;
      return kernelSin(x, 0.0, 0);
    }
    if (ix >= 0x7ff00000) return x - x;
    if (ix > 0x413921fb) return Math.sin(x); // beyond medium reduction — unreachable in the router
    const [n, y0, y1] = remPio2(x);
    switch (n & 3) {
      case 0: return kernelSin(y0, y1, 1);
      case 1: return kernelCos(y0, y1);
      case 2: return -kernelSin(y0, y1, 1);
      default: return -kernelCos(y0, y1);
    }
  }

  function cos(x) {
    const ix = hi(x) & 0x7fffffff;
    if (ix <= 0x3fe921fb) {
      if (ix < 0x3e400000) return 1.0;
      return kernelCos(x, 0.0);
    }
    if (ix >= 0x7ff00000) return x - x;
    if (ix > 0x413921fb) return Math.cos(x);
    const [n, y0, y1] = remPio2(x);
    switch (n & 3) {
      case 0: return kernelCos(y0, y1);
      case 1: return -kernelSin(y0, y1, 1);
      case 2: return -kernelCos(y0, y1);
      default: return kernelSin(y0, y1, 1);
    }
  }

  // ── atan / atan2 (fdlibm s_atan.c / e_atan2.c) ──
  const atanhi = [4.63647609000806093515e-01, 7.85398163397448278999e-01,
                  9.82793723247329054082e-01, 1.57079632679489655800e+00];
  const atanlo = [2.26987774529616870924e-17, 3.06161699786838301793e-17,
                  1.39033110312309984516e-17, 6.12323399573676603587e-17];
  const aT = [3.33333333333329318027e-01, -1.99999999998764832476e-01,
              1.42857142725034663711e-01, -1.11111104054623557880e-01,
              9.09088713343650656196e-02, -7.69187620504482999495e-02,
              6.66107313738753120669e-02, -5.83357013379057348645e-02,
              4.97687799461593236017e-02, -3.65315727442169155270e-02,
              1.62858201153657823623e-02];

  function atan(x) {
    const hx = hi(x), ix = hx & 0x7fffffff;
    if (ix >= 0x44100000) { // |x| >= 2^66
      if (Number.isNaN(x)) return x + x;
      return hx > 0 ? atanhi[3] + atanlo[3] : -atanhi[3] - atanlo[3];
    }
    let id;
    if (ix < 0x3fdc0000) { // |x| < 0.4375
      if (ix < 0x3e200000) return x; // |x| < 2^-29
      id = -1;
    } else {
      x = Math.abs(x);
      if (ix < 0x3ff30000) { // |x| < 1.1875
        if (ix < 0x3fe60000) { id = 0; x = (2.0 * x - 1.0) / (2.0 + x); }
        else { id = 1; x = (x - 1.0) / (x + 1.0); }
      } else {
        if (ix < 0x40038000) { id = 2; x = (x - 1.5) / (1.0 + 1.5 * x); }
        else { id = 3; x = -1.0 / x; }
      }
    }
    const z = x * x, w = z * z;
    const s1 = z * (aT[0] + w * (aT[2] + w * (aT[4] + w * (aT[6] + w * (aT[8] + w * aT[10])))));
    const s2 = w * (aT[1] + w * (aT[3] + w * (aT[5] + w * (aT[7] + w * aT[9]))));
    if (id < 0) return x - x * (s1 + s2);
    const zz = atanhi[id] - ((x * (s1 + s2) - atanlo[id]) - x);
    return hx < 0 ? -zz : zz;
  }

  const PI_O_4 = 7.8539816339744827900e-01, PI_O_2 = 1.5707963267948965580e+00,
        PI = 3.1415926535897931160e+00, PI_LO = 1.2246467991473531772e-16;
  const TINY = 1.0e-300;

  function lo(x) { dv.setFloat64(0, x); return dv.getInt32(4); }

  function atan2(y, x) {
    if (Number.isNaN(x) || Number.isNaN(y)) return x + y;
    const hx = hi(x), ix = hx & 0x7fffffff, lx = lo(x);
    const hy = hi(y), iy = hy & 0x7fffffff, ly = lo(y);
    if (hx === 0x3ff00000 && lx === 0) return atan(y); // x == 1.0
    const m = ((hy >> 31) & 1) | ((hx >> 30) & 2);
    if ((iy | ly) === 0) { // y = 0
      switch (m) {
        case 0: case 1: return y;
        case 2: return PI + TINY;
        default: return -PI - TINY;
      }
    }
    if ((ix | lx) === 0) return hy < 0 ? -PI_O_2 - TINY : PI_O_2 + TINY; // x = 0
    if (ix === 0x7ff00000) { // x = ±inf
      if (iy === 0x7ff00000) {
        switch (m) {
          case 0: return PI_O_4 + TINY;
          case 1: return -PI_O_4 - TINY;
          case 2: return 3.0 * PI_O_4 + TINY;
          default: return -3.0 * PI_O_4 - TINY;
        }
      } else {
        switch (m) {
          case 0: return 0.0;
          case 1: return -0.0;
          case 2: return PI + TINY;
          default: return -PI - TINY;
        }
      }
    }
    if (iy === 0x7ff00000) return hy < 0 ? -PI_O_2 - TINY : PI_O_2 + TINY; // y = ±inf
    const k = (iy - ix) >> 20;
    let z;
    if (k > 60) z = PI_O_2 + 0.5 * PI_LO;          // |y/x| > 2^60
    else if (hx < 0 && k < -60) z = 0.0;           // x < 0 and |y|/x tiny
    else z = atan(Math.abs(y / x));
    switch (m) {
      case 0: return z;
      case 1: return -z;
      case 2: return PI - (z - PI_LO);
      default: return (z - PI_LO) - PI;
    }
  }

  window.FdMath = { sin, cos, atan, atan2 };
})();
