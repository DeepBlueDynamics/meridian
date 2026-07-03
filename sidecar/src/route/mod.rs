//! Isochrone route engine — a faithful Rust emulation of `lib/router.js` +
//! `lib/landmask.js`. Fidelity doctrine (see the plan + spec-route-sidecar):
//! verbatim expression transliteration, `jsmath` for every transcendental
//! and JS-semantics helper, no algebraic cleanup. Divergence from the JS
//! engine is binary — one flipped branch reroutes a member — so parity is
//! proven bit-exact by golden fixtures, not tolerances.

pub mod fdlibm;
pub mod geo;
pub mod jsmath;
pub mod polar;
