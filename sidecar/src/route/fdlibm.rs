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
