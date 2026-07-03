//! fdlibm 5.3 sin/cos — the exact lineage V8's src/base/ieee754.cc derives
//! from. Rust's `libm` crate ports musl, whose kernel polynomials are
//! restructured for ILP (split w=z*z evaluation) and drift 1 ulp from V8 on
//! ~0.9% of inputs (proven by tests/math_parity.rs). These transliterations
//! use fdlibm's exact nested-Horner forms and Cody-Waite reduction.
//!
//! Argument reduction: the medium path covers |x| <= 2^19·π (~1.6e6 rad).
//! The route engine's angles are radians derived from degrees < ~1e3, so the
//! giant-argument Payne-Hanek path is unreachable; beyond the medium range
//! we fall back to libm (documented, corpus-verified never hit).
//!
//! fdlibm's npio2_hw fast-path table is intentionally omitted: it only
//! short-circuits the precision-escalation check, which computes the same
//! y0 = r - w when no cancellation occurred — result-identical, just
//! marginally slower.

const HALF: f64 = 0.5;
const INVPIO2: f64 = 6.36619772367581382433e-01;
const PIO2_1: f64 = 1.57079632673412561417e+00;
const PIO2_1T: f64 = 6.07710050650619224932e-11;
const PIO2_2: f64 = 6.07710050630396597660e-11;
const PIO2_2T: f64 = 2.02226624879595063154e-21;
const PIO2_3: f64 = 2.02226624871116645580e-21;
const PIO2_3T: f64 = 8.47842766036889956997e-32;

const S1: f64 = -1.66666666666666324348e-01;
const S2: f64 = 8.33333333332248946124e-03;
const S3: f64 = -1.98412698298579493134e-04;
const S4: f64 = 2.75573137070700676789e-06;
const S5: f64 = -2.50507602534068634195e-08;
const S6: f64 = 1.58969099521155010221e-10;

const C1: f64 = 4.16666666666666019037e-02;
const C2: f64 = -1.38888888888741095749e-03;
const C3: f64 = 2.48015872894767294178e-05;
const C4: f64 = -2.75573143513906633035e-07;
const C5: f64 = 2.08757232129817482790e-09;
const C6: f64 = -1.13596475577881948265e-11;

#[inline]
fn high_word(x: f64) -> i32 {
    (x.to_bits() >> 32) as i32
}

/// __kernel_sin(x, y, iy): sine on |x| < π/4, x = head, y = tail.
#[inline]
fn kernel_sin(x: f64, y: f64, iy: i32) -> f64 {
    let z = x * x;
    let v = z * x;
    let r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
    if iy == 0 {
        x + v * (S1 + z * r)
    } else {
        x - ((z * (HALF * y - v * r) - y) - v * S1)
    }
}

/// __kernel_cos(x, y): cosine on |x| < π/4.
#[inline]
fn kernel_cos(x: f64, y: f64) -> f64 {
    let ix = high_word(x) & 0x7fffffff;
    let z = x * x;
    let r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
    if ix < 0x3FD33333 {
        // |x| < 0.3
        1.0 - (HALF * z - (z * r - x * y))
    } else {
        let qx = if ix > 0x3fe90000 {
            // |x| > 0.78125
            0.28125
        } else {
            // qx = x/4 via exponent drop, low word zero
            f64::from_bits((((ix - 0x00200000) as u64) << 32))
        };
        let hz = HALF * z - qx;
        let a = 1.0 - qx;
        a - (hz - (z * r - x * y))
    }
}

/// __ieee754_rem_pio2 medium path: returns (n, y0, y1) with x = n·π/2 + y.
/// Caller guarantees π/4 < |x| <= 2^19·π.
fn rem_pio2(x: f64) -> (i32, f64, f64) {
    let hx = high_word(x);
    let ix = hx & 0x7fffffff;

    if ix < 0x4002d97c {
        // |x| < 3π/4 — one or minus-one quadrant, extended-precision subtract
        if hx > 0 {
            let mut z = x - PIO2_1;
            let (y0, y1);
            if ix != 0x3ff921fb {
                // 33+53 bits of pi is good enough
                y0 = z - PIO2_1T;
                y1 = (z - y0) - PIO2_1T;
            } else {
                // near pi/2, use 33+33+53 bits
                z -= PIO2_2;
                y0 = z - PIO2_2T;
                y1 = (z - y0) - PIO2_2T;
            }
            return (1, y0, y1);
        } else {
            let mut z = x + PIO2_1;
            let (y0, y1);
            if ix != 0x3ff921fb {
                y0 = z + PIO2_1T;
                y1 = (z - y0) + PIO2_1T;
            } else {
                z += PIO2_2;
                y0 = z + PIO2_2T;
                y1 = (z - y0) + PIO2_2T;
            }
            return (-1, y0, y1);
        }
    }

    // medium: |x| <= 2^19·π — Cody-Waite with escalation on cancellation
    let t = x.abs();
    let n = (t * INVPIO2 + HALF) as i32;
    let fnn = n as f64;
    let mut r = t - fnn * PIO2_1;
    let mut w = fnn * PIO2_1T;
    let mut y0 = r - w;
    let j = ix >> 20;
    let i = j - ((high_word(y0) >> 20) & 0x7ff);
    if i > 16 {
        // 2nd iteration, good to 118 bits
        let tt = r;
        w = fnn * PIO2_2;
        r = tt - w;
        w = fnn * PIO2_2T - ((tt - r) - w);
        y0 = r - w;
        let i = j - ((high_word(y0) >> 20) & 0x7ff);
        if i > 49 {
            // 3rd iteration, 151 bits
            let tt = r;
            w = fnn * PIO2_3;
            r = tt - w;
            w = fnn * PIO2_3T - ((tt - r) - w);
            y0 = r - w;
        }
    }
    let y1 = (r - y0) - w;
    if hx < 0 {
        (-n, -y0, -y1)
    } else {
        (n, y0, y1)
    }
}

pub fn sin(x: f64) -> f64 {
    let ix = high_word(x) & 0x7fffffff;
    if ix <= 0x3fe921fb {
        // |x| <= π/4
        if ix < 0x3e500000 {
            // |x| < 2^-26: sin(x) = x with inexact
            return x;
        }
        kernel_sin(x, 0.0, 0)
    } else if ix >= 0x7ff00000 {
        // NaN / Inf
        x - x
    } else if ix > 0x413921fb {
        // beyond the medium reduction range (~1.6e6 rad) — unreachable for
        // the route engine's degree-derived radians; libm keeps it sane.
        libm::sin(x)
    } else {
        let (n, y0, y1) = rem_pio2(x);
        match n & 3 {
            0 => kernel_sin(y0, y1, 1),
            1 => kernel_cos(y0, y1),
            2 => -kernel_sin(y0, y1, 1),
            _ => -kernel_cos(y0, y1),
        }
    }
}

pub fn cos(x: f64) -> f64 {
    let ix = high_word(x) & 0x7fffffff;
    if ix <= 0x3fe921fb {
        // |x| <= π/4
        if ix < 0x3e400000 {
            // |x| < 2^-27
            return 1.0;
        }
        kernel_cos(x, 0.0)
    } else if ix >= 0x7ff00000 {
        x - x
    } else if ix > 0x413921fb {
        libm::cos(x)
    } else {
        let (n, y0, y1) = rem_pio2(x);
        match n & 3 {
            0 => kernel_cos(y0, y1),
            1 => -kernel_sin(y0, y1, 1),
            2 => -kernel_cos(y0, y1),
            _ => kernel_sin(y0, y1, 1),
        }
    }
}

// ── atan / atan2 (fdlibm s_atan.c / e_atan2.c) — V8 engines disagree with
// each other on atan2 too (measured), so it's pinned like sin/cos. Mirror of
// lib/fdmath.js — THESE MUST CHANGE TOGETHER. ──────────────────────────────

#[inline]
fn low_word(x: f64) -> i32 {
    x.to_bits() as u32 as i32
}

const ATANHI: [f64; 4] = [
    4.63647609000806093515e-01,
    7.85398163397448278999e-01,
    9.82793723247329054082e-01,
    1.57079632679489655800e+00,
];
const ATANLO: [f64; 4] = [
    2.26987774529616870924e-17,
    3.06161699786838301793e-17,
    1.39033110312309984516e-17,
    6.12323399573676603587e-17,
];
const AT: [f64; 11] = [
    3.33333333333329318027e-01,
    -1.99999999998764832476e-01,
    1.42857142725034663711e-01,
    -1.11111104054623557880e-01,
    9.09088713343650656196e-02,
    -7.69187620504482999495e-02,
    6.66107313738753120669e-02,
    -5.83357013379057348645e-02,
    4.97687799461593236017e-02,
    -3.65315727442169155270e-02,
    1.62858201153657823623e-02,
];

pub fn atan(mut x: f64) -> f64 {
    let hx = high_word(x);
    let ix = hx & 0x7fffffff;
    if ix >= 0x44100000 {
        // |x| >= 2^66
        if x.is_nan() {
            return x + x;
        }
        return if hx > 0 { ATANHI[3] + ATANLO[3] } else { -ATANHI[3] - ATANLO[3] };
    }
    let id: i32;
    if ix < 0x3fdc0000 {
        // |x| < 0.4375
        if ix < 0x3e200000 {
            // |x| < 2^-29
            return x;
        }
        id = -1;
    } else {
        x = x.abs();
        if ix < 0x3ff30000 {
            // |x| < 1.1875
            if ix < 0x3fe60000 {
                id = 0;
                x = (2.0 * x - 1.0) / (2.0 + x);
            } else {
                id = 1;
                x = (x - 1.0) / (x + 1.0);
            }
        } else if ix < 0x40038000 {
            id = 2;
            x = (x - 1.5) / (1.0 + 1.5 * x);
        } else {
            id = 3;
            x = -1.0 / x;
        }
    }
    let z = x * x;
    let w = z * z;
    let s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
    let s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
    if id < 0 {
        return x - x * (s1 + s2);
    }
    let zz = ATANHI[id as usize] - ((x * (s1 + s2) - ATANLO[id as usize]) - x);
    if hx < 0 { -zz } else { zz }
}

const PI_O_4: f64 = 7.8539816339744827900e-01;
const PI_O_2: f64 = 1.5707963267948965580e+00;
const PI_F: f64 = 3.1415926535897931160e+00;
const PI_LO: f64 = 1.2246467991473531772e-16;
const TINY: f64 = 1.0e-300;

pub fn atan2(y: f64, x: f64) -> f64 {
    if x.is_nan() || y.is_nan() {
        return x + y;
    }
    let hx = high_word(x);
    let ix = hx & 0x7fffffff;
    let lx = low_word(x);
    let hy = high_word(y);
    let iy = hy & 0x7fffffff;
    let ly = low_word(y);
    if hx == 0x3ff00000 && lx == 0 {
        // x == 1.0
        return atan(y);
    }
    let m = ((hy >> 31) & 1) | ((hx >> 30) & 2);
    if (iy | ly) == 0 {
        // y = 0
        return match m {
            0 | 1 => y,
            2 => PI_F + TINY,
            _ => -PI_F - TINY,
        };
    }
    if (ix | lx) == 0 {
        // x = 0
        return if hy < 0 { -PI_O_2 - TINY } else { PI_O_2 + TINY };
    }
    if ix == 0x7ff00000 {
        // x = ±inf
        if iy == 0x7ff00000 {
            return match m {
                0 => PI_O_4 + TINY,
                1 => -PI_O_4 - TINY,
                2 => 3.0 * PI_O_4 + TINY,
                _ => -3.0 * PI_O_4 - TINY,
            };
        }
        return match m {
            0 => 0.0,
            1 => -0.0,
            2 => PI_F + TINY,
            _ => -PI_F - TINY,
        };
    }
    if iy == 0x7ff00000 {
        // y = ±inf
        return if hy < 0 { -PI_O_2 - TINY } else { PI_O_2 + TINY };
    }
    let k = (iy - ix) >> 20;
    let z = if k > 60 {
        PI_O_2 + 0.5 * PI_LO
    } else if hx < 0 && k < -60 {
        0.0
    } else {
        atan((y / x).abs())
    };
    match m {
        0 => z,
        1 => -z,
        2 => PI_F - (z - PI_LO),
        _ => (z - PI_LO) - PI_F,
    }
}
