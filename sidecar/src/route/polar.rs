//! Vessel polar — verbatim transliteration of lib/router.js makePolar
//! (L44–59). Bilinear interpolation over the TWA×TWS boat-speed grid with
//! the exact JS clamps: |twa| folded over 180, below the first row = 0
//! (no-go cone), above the last row clamped; TWS clamped both ends; linear
//! first-match bracket scan (NOT binary search — same cells, same floats).

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VesselPolar {
    pub twa: Vec<f64>,
    pub tws: Vec<f64>,
    pub bsp: Vec<Vec<f64>>,
}

pub struct Polar {
    a: Vec<f64>,
    t: Vec<f64>,
    g: Vec<Vec<f64>>,
    a_min: f64,
    a_max: f64,
    t_min: f64,
    t_max: f64,
}

impl Polar {
    pub fn new(p: &VesselPolar) -> Self {
        Self {
            a_min: p.twa[0],
            a_max: p.twa[p.twa.len() - 1],
            t_min: p.tws[0],
            t_max: p.tws[p.tws.len() - 1],
            a: p.twa.clone(),
            t: p.tws.clone(),
            g: p.bsp.clone(),
        }
    }

    /// polar(twaIn, twsIn) → boat speed kt.
    pub fn bsp(&self, twa_in: f64, tws_in: f64) -> f64 {
        let mut twa = twa_in.abs();
        if twa > 180.0 {
            twa = 360.0 - twa;
        }
        if twa < self.a_min {
            return 0.0;
        }
        if twa > self.a_max {
            twa = self.a_max;
        }
        let tws = if tws_in < self.t_min {
            self.t_min
        } else if tws_in > self.t_max {
            self.t_max
        } else {
            tws_in
        };
        let mut i0 = 0usize;
        for i in 0..self.a.len() - 1 {
            if twa >= self.a[i] && twa <= self.a[i + 1] {
                i0 = i;
                break;
            }
        }
        let mut j0 = 0usize;
        for j in 0..self.t.len() - 1 {
            if tws >= self.t[j] && tws <= self.t[j + 1] {
                j0 = j;
                break;
            }
        }
        let i1 = i0 + 1;
        let j1 = j0 + 1;
        let t = (twa - self.a[i0]) / (self.a[i1] - self.a[i0]);
        let s = (tws - self.t[j0]) / (self.t[j1] - self.t[j0]);
        let v00 = self.g[i0][j0];
        let v01 = self.g[i0][j1];
        let v10 = self.g[i1][j0];
        let v11 = self.g[i1][j1];
        (v00 + (v01 - v00) * s) * (1.0 - t) + (v10 + (v11 - v10) * s) * t
    }
}
