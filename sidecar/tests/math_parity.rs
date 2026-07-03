//! R-1 gate: bit-parity of the Rust math layer against V8.
//!
//! Corpus files are generated on this machine by
//! `node scripts/gen-math-corpus.mjs` (1e6 samples per function, inputs AND
//! V8 outputs as little-endian f64). Each test bit-compares the engine's
//! jsmath layer against the recorded V8 output — ZERO mismatches required.
//! Outcome history: libm's asin/atan2 matched V8 outright; its musl-lineage
//! sin/cos drifted 1 ulp on ~0.9% of inputs → vendored fdlibm 5.3 kernels
//! (route::fdlibm) now carry sin/cos.
//!
//! Tests skip (loudly) when the corpus is absent — regeneratable, gitignored.

use meridian_sidecar::route::jsmath;
use std::path::PathBuf;

fn corpus(name: &str) -> Option<Vec<u8>> {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/corpus").join(name);
    match std::fs::read(&p) {
        Ok(b) => Some(b),
        Err(_) => {
            eprintln!("SKIP: corpus {} missing — run `node scripts/gen-math-corpus.mjs`", p.display());
            None
        }
    }
}

fn f64_at(buf: &[u8], i: usize) -> f64 {
    f64::from_le_bytes(buf[i * 8..i * 8 + 8].try_into().unwrap())
}

/// Bit equality (±0 distinguished) except both-NaN (any payload).
fn bits_eq(a: f64, b: f64) -> bool {
    a.to_bits() == b.to_bits() || (a.is_nan() && b.is_nan())
}

fn check_unary(name: &str, f: fn(f64) -> f64) {
    let Some(buf) = corpus(name) else { return };
    let n = buf.len() / 16;
    let mut bad = 0usize;
    let mut first: Option<(f64, f64, f64)> = None;
    for i in 0..n {
        let x = f64_at(&buf, i * 2);
        let v8 = f64_at(&buf, i * 2 + 1);
        let rs = f(x);
        if !bits_eq(rs, v8) {
            bad += 1;
            if first.is_none() {
                first = Some((x, v8, rs));
            }
        }
    }
    if bad > 0 {
        let (x, v8, rs) = first.unwrap();
        panic!(
            "{name}: {bad}/{n} mismatches vs V8; first: x={x:?} v8={v8:?} rust={rs:?} (bits {:#x} vs {:#x})",
            v8.to_bits(), rs.to_bits()
        );
    }
}

#[test]
fn sin_bit_parity() {
    check_unary("sin.bin", jsmath::sin);
}
#[test]
fn cos_bit_parity() {
    check_unary("cos.bin", jsmath::cos);
}
#[test]
fn asin_bit_parity() {
    check_unary("asin.bin", jsmath::asin);
}

#[test]
fn atan2_bit_parity() {
    let Some(buf) = corpus("atan2.bin") else { return };
    let n = buf.len() / 24;
    let mut bad = 0usize;
    let mut first: Option<(f64, f64, f64, f64)> = None;
    for i in 0..n {
        let y = f64_at(&buf, i * 3);
        let x = f64_at(&buf, i * 3 + 1);
        let v8 = f64_at(&buf, i * 3 + 2);
        let rs = jsmath::atan2(y, x);
        if !bits_eq(rs, v8) {
            bad += 1;
            if first.is_none() {
                first = Some((y, x, v8, rs));
            }
        }
    }
    assert_eq!(bad, 0, "atan2: {bad}/{n} mismatches vs V8; first: {first:?}");
}
