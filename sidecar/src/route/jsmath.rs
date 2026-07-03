//! JS-number semantics layer. EVERY float operation in the route port that
//! could differ from V8 goes through here — nothing in `route/` may call
//! `std::f64::{sin,cos,asin,atan2,min,max,round}` directly.
//!
//! - Transcendentals: `libm` (fdlibm lineage, same ancestry as V8's
//!   src/base/ieee754.cc). Bit-parity is PROVEN, not assumed — see
//!   tests/math_parity.rs against the node-generated corpus.
//! - `js_min`/`js_max`: JS Math.min/max propagate NaN; Rust's f64::min/max
//!   return the non-NaN operand.
//! - `js_round`: JS Math.round is half-toward-+infinity (round(-2.5) == -2,
//!   round(-0.5) == -0); Rust round() is half-away-from-zero.
//! - `js_mod360`: the literal `((x % 360) + 360) % 360` double-mod. NOT
//!   rem_euclid — for tiny negative x, `x + 360` rounds to exactly 360.0
//!   and rem_euclid would return 360.0 where JS returns 0.0.

// sin/cos: vendored fdlibm 5.3 (libm's musl kernels drift 1 ulp from V8 on
// ~0.9% of inputs — caught by the corpus test). asin/atan2: libm bit-matches.
#[inline]
pub fn sin(x: f64) -> f64 {
    super::fdlibm::sin(x)
}
#[inline]
pub fn cos(x: f64) -> f64 {
    super::fdlibm::cos(x)
}
#[inline]
pub fn asin(x: f64) -> f64 {
    libm::asin(x)
}
#[inline]
pub fn atan2(y: f64, x: f64) -> f64 {
    libm::atan2(y, x)
}
/// Math.sqrt is correctly rounded everywhere — hardware sqrt is exact.
#[inline]
pub fn sqrt(x: f64) -> f64 {
    x.sqrt()
}

/// JS Math.min: NaN-propagating.
#[inline]
pub fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a < b {
        a
    } else {
        b
    }
}

/// JS Math.max: NaN-propagating.
#[inline]
pub fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a > b {
        a
    } else {
        b
    }
}

/// JS Math.round: half toward +infinity. Exact for engine magnitudes
/// (|x| <= 50 for sector keys). floor(x)+1 when frac >= 0.5 — do NOT use
/// floor(x + 0.5) (breaks on 0.49999999999999994).
#[inline]
pub fn js_round(x: f64) -> f64 {
    let f = x.floor();
    if x - f >= 0.5 {
        f + 1.0
    } else {
        f
    }
}

/// The literal `((x % 360) + 360) % 360` — JS `%` is fmod (truncated),
/// identical to Rust's `%` on f64.
#[inline]
pub fn js_mod360(x: f64) -> f64 {
    ((x % 360.0) + 360.0) % 360.0
}

/// JS `x | 0`: ToInt32 — truncation toward zero (with wrap semantics we
/// never hit at engine magnitudes). Used for memo keys and raster indices.
#[inline]
pub fn js_trunc_i64(x: f64) -> i64 {
    x as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_matches_js() {
        // Pinned against node: Math.round(-2.5)=-2, Math.round(-0.5)=-0,
        // Math.round(0.49999999999999994)=0 (not 1), Math.round(2.5)=3
        assert_eq!(js_round(-2.5), -2.0);
        assert_eq!(js_round(-0.5), 0.0); // -0 == 0
        assert_eq!(js_round(0.49999999999999994), 0.0);
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(-2.51), -3.0);
    }

    #[test]
    fn minmax_propagate_nan() {
        assert!(js_max(f64::NAN, 1.0).is_nan());
        assert!(js_min(1.0, f64::NAN).is_nan());
        assert_eq!(js_max(1.0, 2.0), 2.0);
        assert_eq!(js_min(-1.0, 2.0), -1.0);
    }

    #[test]
    fn mod360_edge() {
        // Pinned against node: ((-1e-15 % 360) + 360) % 360 === 0 exactly
        // (the +360 rounds to 360.0, second mod folds it to 0).
        assert_eq!(js_mod360(-1e-15), 0.0);
        assert_eq!(js_mod360(-30.0), 330.0);
        assert_eq!(js_mod360(370.0), 10.0);
    }
}
