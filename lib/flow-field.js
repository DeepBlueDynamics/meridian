/**
 * flow-field.js — Windy-style animated vector-field renderer. Zero dependencies.
 *
 * Architecture (GPU particle advection, after mapbox/webgl-wind + earth.nullschool):
 *   - Particle positions live in an RGBA8 texture (16-bit fixed point per axis).
 *   - An "update" fragment shader advects every particle by sampling the field
 *     texture (hardware bilinear), with stochastic respawn so streams stay dense.
 *   - A "draw" pass renders particles as round points, colored by local speed
 *     through a 1-D color-ramp texture.
 *   - Trails: particles are drawn into a ping-ponged screen texture on top of
 *     the previous frame faded toward zero (quantized fade -> no ghost residue).
 *   - Optional "heatmap" underlay: full-screen pass that bicubically resamples
 *     the (coarse) field grid and maps speed through the same ramp — this is
 *     what gives Windy its colored-gust look behind the particles.
 *   - Two field textures + a blend factor allow smooth scrubbing between model
 *     timesteps entirely on the GPU (setFields(a, b, t)).
 *
 * Usage:
 *   const flow = new FlowField(canvas);
 *   const wind = flow.addLayer({ colorStops: [...], maxSpeed: 30 });
 *   wind.setField({ width: 7, height: 6, u, v, bounds: [-161, 17.5, -153, 23.5] });
 *   flow.start();
 *
 * Field convention: u/v are Float32Array (or number[]) of length width*height,
 * row-major, row 0 = NORTH edge. u = eastward, v = northward, any units
 * (knots, m/s) — they only need to be consistent with `maxSpeed` and
 * `speedFactor`. bounds = [lonWest, latSouth, lonEast, latNorth].
 */

const QUAD_VS = `
precision mediump float;
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos;
  gl_Position = vec4(2.0 * a_pos - 1.0, 0.0, 1.0); // identity: pixel == texel
}`;

// Quantized fade: floor() guarantees monotonic decay to exactly 0 in 8-bit,
// eliminating the permanent gray ghosting the naive (color * fade) causes.
const FADE_FS = `
precision mediump float;
uniform sampler2D u_tex;
uniform float u_fade;
varying vec2 v_uv;
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  gl_FragColor = floor(255.0 * c * u_fade) / 255.0;
}`;

const COPY_FS = `
precision mediump float;
uniform sampler2D u_tex;
uniform float u_opacity;
varying vec2 v_uv;
void main() {
  gl_FragColor = texture2D(u_tex, v_uv) * u_opacity;
}`;

// ---- particle update ----------------------------------------------------
const UPDATE_FS = `
precision highp float;

uniform sampler2D u_particles;
uniform sampler2D u_fieldA;
uniform sampler2D u_fieldB;
uniform float u_fieldMix;
uniform vec2 u_uvMin;        // decode: vel = mix(u_uvMin, u_uvMax, texel.rg)
uniform vec2 u_uvMax;
uniform float u_maxSpeed;
uniform float u_randSeed;
uniform float u_speedFactor; // field-units -> texcoords/frame (lat axis)
uniform float u_aspect;      // (lonSpan/latSpan) for isotropic motion
uniform vec2 u_latRange;     // [latNorth, latSouth] ; y=0 is north
uniform float u_dropRate;
uniform float u_dropRateBump;

varying vec2 v_uv;

float rand(const vec2 co) {
  const vec3 rc = vec3(12.9898, 78.233, 4375.85453);
  float t = dot(rc.xy, co);
  return fract(sin(t) * (rc.z + t));
}

vec2 lookupVel(const vec2 uv) {
  vec2 a = mix(u_uvMin, u_uvMax, texture2D(u_fieldA, uv).rg);
  vec2 b = mix(u_uvMin, u_uvMax, texture2D(u_fieldB, uv).rg);
  return mix(a, b, u_fieldMix);
}

void main() {
  vec4 c = texture2D(u_particles, v_uv);
  vec2 pos = vec2(c.r / 255.0 + c.b, c.g / 255.0 + c.a); // decode 16-bit

  vec2 vel = lookupVel(pos);
  float speedNorm = clamp(length(vel) / u_maxSpeed, 0.0, 1.0);

  // Geographic correction: a knot of eastward motion covers more longitude
  // at high latitude; v positive (north) decreases y (row 0 = north).
  float lat = mix(u_latRange.x, u_latRange.y, pos.y);
  float coslat = max(cos(radians(lat)), 0.05);
  vec2 offset = vec2(vel.x / (coslat * u_aspect), -vel.y) * u_speedFactor;
  pos = pos + offset;

  // Stochastic respawn (rate rises with speed so fast lanes stay populated),
  // plus forced respawn when a particle exits the field.
  vec2 seed = (pos + v_uv) * u_randSeed;
  float outside = (pos.x < 0.0 || pos.x > 1.0 || pos.y < 0.0 || pos.y > 1.0) ? 1.0 : 0.0;
  float drop = step(1.0 - u_dropRate - speedNorm * u_dropRateBump, rand(seed)) + outside;
  vec2 randomPos = vec2(rand(seed + 1.3), rand(seed + 2.1));
  pos = mix(pos, randomPos, min(drop, 1.0));

  gl_FragColor = vec4(fract(pos * 255.0), floor(pos * 255.0) / 255.0); // encode
}`;

// ---- particle draw -------------------------------------------------------
const DRAW_VS = `
precision highp float;

attribute float a_index;
uniform sampler2D u_particles;
uniform float u_particlesRes;
uniform sampler2D u_fieldA;
uniform sampler2D u_fieldB;
uniform float u_fieldMix;
uniform vec2 u_uvMin;
uniform vec2 u_uvMax;
uniform float u_maxSpeed;
uniform float u_pointSize;
uniform float u_minSpeed;    // field units; particles below it are not drawn
                             // (zeroed/masked cells — land, no-data — stay empty)

varying float v_speedNorm;

void main() {
  vec2 puv = vec2(
    fract(a_index / u_particlesRes) + 0.5 / u_particlesRes,
    floor(a_index / u_particlesRes) / u_particlesRes + 0.5 / u_particlesRes);
  vec4 c = texture2D(u_particles, puv);
  vec2 pos = vec2(c.r / 255.0 + c.b, c.g / 255.0 + c.a);

  vec2 a = mix(u_uvMin, u_uvMax, texture2D(u_fieldA, pos).rg);
  vec2 b = mix(u_uvMin, u_uvMax, texture2D(u_fieldB, pos).rg);
  vec2 vel = mix(a, b, u_fieldMix);
  float spd = length(vel);
  v_speedNorm = clamp(spd / u_maxSpeed, 0.0, 1.0);

  // hide dead particles: zero size + clip-space exile (some GPUs draw size-0)
  float dead = step(spd, u_minSpeed);
  gl_PointSize = u_pointSize * (1.0 - dead);
  gl_Position = mix(vec4(2.0 * pos.x - 1.0, 1.0 - 2.0 * pos.y, 0.0, 1.0),
                    vec4(-2.0, -2.0, 0.0, 1.0), dead);
}`;

const DRAW_FS = `
precision mediump float;
uniform sampler2D u_ramp;
uniform float u_opacity;
varying float v_speedNorm;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  if (dot(d, d) > 0.25) discard;                 // round points
  vec3 rgb = texture2D(u_ramp, vec2(v_speedNorm, 0.5)).rgb;
  gl_FragColor = vec4(rgb, 1.0) * u_opacity;     // premultiplied alpha
}`;

// ---- heatmap underlay (bicubic so a 7x6 grid renders as smooth gusts) ----
const HEAT_FS = `
precision highp float;

uniform sampler2D u_fieldA;
uniform sampler2D u_fieldB;
uniform float u_fieldMix;
uniform vec2 u_fieldRes;
uniform vec2 u_uvMin;
uniform vec2 u_uvMax;
uniform float u_maxSpeed;
uniform sampler2D u_ramp;
uniform float u_opacity;
varying vec2 v_uv;

vec2 texelVel(vec2 ij) {
  vec2 uv = (clamp(ij, vec2(0.0), u_fieldRes - 1.0) + 0.5) / u_fieldRes;
  vec2 a = mix(u_uvMin, u_uvMax, texture2D(u_fieldA, uv).rg);
  vec2 b = mix(u_uvMin, u_uvMax, texture2D(u_fieldB, uv).rg);
  return mix(a, b, u_fieldMix);
}

vec2 cubic(vec2 p0, vec2 p1, vec2 p2, vec2 p3, float t) {
  // Catmull-Rom
  return p1 + 0.5 * t * (p2 - p0 + t * (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3
         + t * (3.0 * (p1 - p2) + p3 - p0)));
}

void main() {
  // framebuffer v=1 is top of screen = north; field row 0 = north
  vec2 st = vec2(v_uv.x, 1.0 - v_uv.y) * u_fieldRes - 0.5;
  vec2 base = floor(st);
  vec2 f = st - base;

  vec2 rows[4];
  for (int j = -1; j <= 2; j++) {
    vec2 r0 = texelVel(base + vec2(-1.0, float(j)));
    vec2 r1 = texelVel(base + vec2( 0.0, float(j)));
    vec2 r2 = texelVel(base + vec2( 1.0, float(j)));
    vec2 r3 = texelVel(base + vec2( 2.0, float(j)));
    rows[j + 1] = cubic(r0, r1, r2, r3, f.x);
  }
  vec2 vel = cubic(rows[0], rows[1], rows[2], rows[3], f.y);

  float speedNorm = clamp(length(vel) / u_maxSpeed, 0.0, 1.0);
  vec4 c = texture2D(u_ramp, vec2(speedNorm, 0.5));
  gl_FragColor = vec4(c.rgb, 1.0) * (u_opacity * c.a);
}`;

// ===========================================================================

function createShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error('Shader compile error: ' + gl.getShaderInfoLog(s) + '\n' + src);
  }
  return s;
}

function createProgram(gl, vsSrc, fsSrc) {
  const p = gl.createProgram();
  gl.attachShader(p, createShader(gl, gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, createShader(gl, gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('Program link error: ' + gl.getProgramInfoLog(p));
  }
  const wrapper = { program: p };
  const nAttr = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < nAttr; i++) {
    const a = gl.getActiveAttrib(p, i);
    wrapper[a.name] = gl.getAttribLocation(p, a.name);
  }
  const nUni = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < nUni; i++) {
    const u = gl.getActiveUniform(p, i);
    wrapper[u.name.replace('[0]', '')] = gl.getUniformLocation(p, u.name);
  }
  return wrapper;
}

function createTexture(gl, filter, data, width, height) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA,
                gl.UNSIGNED_BYTE, data);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return t;
}

function bindTexture(gl, texture, unit) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
}

function bindFramebuffer(gl, fb, texture) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  if (fb) {
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D,
                            texture, 0);
  }
}

/** Build a 256x1 RGBA ramp texture from color stops.
 *  stops: [{ stop: 0..1, color: 'rgba(...)' | '#hex' | [r,g,b,a?] }] */
function buildRamp(stops) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 1;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 256, 0);
  for (const s of stops) {
    const c = Array.isArray(s.color)
      ? `rgba(${s.color[0]},${s.color[1]},${s.color[2]},${s.color[3] ?? 1})`
      : s.color;
    grad.addColorStop(Math.min(Math.max(s.stop, 0), 1), c);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 1);
  return new Uint8Array(ctx.getImageData(0, 0, 256, 1).data);
}

// ===========================================================================

class ParticleLayer {
  constructor(flow, opts = {}) {
    this._flow = flow;
    const gl = flow.gl;
    this.gl = gl;

    this.enabled = opts.enabled ?? true;
    this.speedFactor   = opts.speedFactor   ?? 1.0;   // visual multiplier
    this.dropRate      = opts.dropRate      ?? 0.003; // respawn chance / frame
    this.dropRateBump  = opts.dropRateBump  ?? 0.01;  // extra respawn ~ speed
    this.fadeOpacity   = opts.fadeOpacity   ?? 0.965; // trail length
    this.pointSize     = opts.pointSize     ?? 1.6;   // device px
    this.minSpeed      = opts.minSpeed      ?? 0;     // hide particles below (field units)
    this.opacity       = opts.opacity       ?? 1.0;
    this.maxSpeed      = opts.maxSpeed      ?? 30;    // ramp normalization
    this.heatmapOpacity = opts.heatmapOpacity ?? 0.0; // 0 = underlay off

    this.setColorRamp(opts.colorStops ?? [
      { stop: 0.0, color: 'rgba(120,140,160,0.0)' },
      { stop: 0.15, color: '#5b7da0' },
      { stop: 0.35, color: '#7fd4c1' },
      { stop: 0.55, color: '#f4e76e' },
      { stop: 0.75, color: '#f08c42' },
      { stop: 1.0, color: '#e0455e' },
    ]);
    if (opts.heatmapStops) this.setHeatmapRamp(opts.heatmapStops);

    this._fieldA = null;
    this._fieldB = null;
    this._fieldMix = 0;
    this._fieldRes = [2, 2];
    this._uvMin = [0, 0];
    this._uvMax = [1, 1];
    this._latRange = [25, 15];
    this._aspect = 1;

    this._fb = gl.createFramebuffer();
    this.setNumParticles(opts.numParticles ?? 16384);
    this._resizeTrails();
  }

  // -- public ---------------------------------------------------------------

  setNumParticles(n) {
    const gl = this.gl;
    const res = this._particlesRes = Math.ceil(Math.sqrt(n));
    this.numParticles = res * res;

    const state = new Uint8Array(this.numParticles * 4);
    for (let i = 0; i < state.length; i++) state[i] = Math.floor(Math.random() * 256);
    if (this._stateTex0) { gl.deleteTexture(this._stateTex0); gl.deleteTexture(this._stateTex1); }
    this._stateTex0 = createTexture(gl, gl.NEAREST, state, res, res);
    this._stateTex1 = createTexture(gl, gl.NEAREST, state, res, res);

    const indices = new Float32Array(this.numParticles);
    for (let i = 0; i < this.numParticles; i++) indices[i] = i;
    if (this._indexBuf) gl.deleteBuffer(this._indexBuf);
    this._indexBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._indexBuf);
    gl.bufferData(gl.ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  }

  setColorRamp(stops) {
    const gl = this.gl;
    const sharedHeat = this._heatRampTex && this._heatRampTex === this._rampTex;
    if (this._rampTex) gl.deleteTexture(this._rampTex);
    this._rampTex = createTexture(gl, gl.LINEAR, buildRamp(stops), 256, 1);
    if (sharedHeat || !this._heatRampTex) this._heatRampTex = this._rampTex;
  }

  /** Optional separate ramp (with alpha) for the heatmap underlay. */
  setHeatmapRamp(stops) {
    const gl = this.gl;
    if (this._heatRampTex && this._heatRampTex !== this._rampTex) {
      gl.deleteTexture(this._heatRampTex);
    }
    this._heatRampTex = createTexture(gl, gl.LINEAR, buildRamp(stops), 256, 1);
  }

  /**
   * Upload one field (both slots get it). field = { width, height, u, v,
   * bounds:[lonW, latS, lonE, latN] }, row 0 = north.
   */
  setField(field) { this.setFields(field, field, 0); }

  /**
   * Upload two model timesteps; `mix` in [0,1] blends them on the GPU.
   * Call setFieldMix(t) every frame for buttery timeline scrubbing.
   */
  setFields(a, b, mix = 0) {
    const gl = this.gl;
    // Shared normalization across both steps so RG bytes are comparable.
    let min = Infinity, max = -Infinity;
    for (const f of [a, b]) {
      for (let i = 0; i < f.u.length; i++) {
        if (f.u[i] < min) min = f.u[i]; if (f.u[i] > max) max = f.u[i];
        if (f.v[i] < min) min = f.v[i]; if (f.v[i] > max) max = f.v[i];
      }
    }
    if (!isFinite(min)) { min = -1; max = 1; }
    if (max - min < 1e-6) max = min + 1e-6;
    this._uvMin = [min, min];
    this._uvMax = [max, max];

    const enc = (f) => {
      const n = f.width * f.height;
      const data = new Uint8Array(n * 4);
      for (let i = 0; i < n; i++) {
        data[i * 4]     = Math.round(255 * (f.u[i] - min) / (max - min));
        data[i * 4 + 1] = Math.round(255 * (f.v[i] - min) / (max - min));
        data[i * 4 + 2] = 0;
        data[i * 4 + 3] = 255;
      }
      return data;
    };

    if (this._fieldA) gl.deleteTexture(this._fieldA);
    if (this._fieldB) gl.deleteTexture(this._fieldB);
    this._fieldA = createTexture(gl, gl.LINEAR, enc(a), a.width, a.height);
    this._fieldB = createTexture(gl, gl.LINEAR, enc(b), b.width, b.height);
    this._fieldRes = [a.width, a.height];
    this._fieldMix = mix;

    const [lonW, latS, lonE, latN] = a.bounds ?? [-1, -1, 1, 1];
    this._latRange = [latN, latS];
    const latSpan = Math.max(Math.abs(latN - latS), 1e-6);
    const lonSpan = Math.max(Math.abs(lonE - lonW), 1e-6);
    this._aspect = lonSpan / latSpan;
  }

  setFieldMix(mix) { this._fieldMix = Math.min(Math.max(mix, 0), 1); }

  // -- internal -------------------------------------------------------------

  _resizeTrails() {
    const gl = this.gl;
    const w = gl.canvas.width, h = gl.canvas.height;
    const empty = new Uint8Array(w * h * 4);
    if (this._trailTex0) { gl.deleteTexture(this._trailTex0); gl.deleteTexture(this._trailTex1); }
    this._trailTex0 = createTexture(gl, gl.NEAREST, empty, w, h);
    this._trailTex1 = createTexture(gl, gl.NEAREST, empty, w, h);
  }

  _update(randSeed) {
    if (!this._fieldA) return;
    const gl = this.gl, flow = this._flow, p = flow._updateProg;

    bindFramebuffer(gl, this._fb, this._stateTex1);
    gl.viewport(0, 0, this._particlesRes, this._particlesRes);
    gl.disable(gl.BLEND);

    gl.useProgram(p.program);
    flow._bindQuad(p.a_pos);
    bindTexture(gl, this._stateTex0, 0); gl.uniform1i(p.u_particles, 0);
    bindTexture(gl, this._fieldA, 1);    gl.uniform1i(p.u_fieldA, 1);
    bindTexture(gl, this._fieldB, 2);    gl.uniform1i(p.u_fieldB, 2);
    gl.uniform1f(p.u_fieldMix, this._fieldMix);
    gl.uniform2fv(p.u_uvMin, this._uvMin);
    gl.uniform2fv(p.u_uvMax, this._uvMax);
    gl.uniform1f(p.u_maxSpeed, this.maxSpeed);
    gl.uniform1f(p.u_randSeed, randSeed);
    // Pacing: at speedFactor = 1, a particle moving at maxSpeed crosses the
    // lat axis in ~8 s @ 60 fps; everything else scales linearly with speed.
    gl.uniform1f(p.u_speedFactor, this.speedFactor * 0.8 / (this.maxSpeed * 400));
    gl.uniform1f(p.u_aspect, this._aspect);
    gl.uniform2fv(p.u_latRange, this._latRange);
    gl.uniform1f(p.u_dropRate, this.dropRate);
    gl.uniform1f(p.u_dropRateBump, this.dropRateBump);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    const t = this._stateTex0; this._stateTex0 = this._stateTex1; this._stateTex1 = t;
  }

  _drawTrailFrame() {
    if (!this._fieldA) return;
    const gl = this.gl, flow = this._flow;
    const w = gl.canvas.width, h = gl.canvas.height;

    // 1) previous trail, faded, into current trail target
    bindFramebuffer(gl, this._fb, this._trailTex1);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.BLEND);

    const fp = flow._fadeProg;
    gl.useProgram(fp.program);
    flow._bindQuad(fp.a_pos);
    bindTexture(gl, this._trailTex0, 0);
    gl.uniform1i(fp.u_tex, 0);
    gl.uniform1f(fp.u_fade, this.fadeOpacity);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 2) fresh particles on top (premultiplied over)
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const dp = flow._drawProg;
    gl.useProgram(dp.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._indexBuf);
    gl.enableVertexAttribArray(dp.a_index);
    gl.vertexAttribPointer(dp.a_index, 1, gl.FLOAT, false, 0, 0);
    bindTexture(gl, this._stateTex0, 0); gl.uniform1i(dp.u_particles, 0);
    bindTexture(gl, this._fieldA, 1);    gl.uniform1i(dp.u_fieldA, 1);
    bindTexture(gl, this._fieldB, 2);    gl.uniform1i(dp.u_fieldB, 2);
    bindTexture(gl, this._rampTex, 3);   gl.uniform1i(dp.u_ramp, 3);
    gl.uniform1f(dp.u_fieldMix, this._fieldMix);
    gl.uniform1f(dp.u_particlesRes, this._particlesRes);
    gl.uniform2fv(dp.u_uvMin, this._uvMin);
    gl.uniform2fv(dp.u_uvMax, this._uvMax);
    gl.uniform1f(dp.u_maxSpeed, this.maxSpeed);
    gl.uniform1f(dp.u_minSpeed, this.minSpeed);
    gl.uniform1f(dp.u_pointSize, this.pointSize * (window.devicePixelRatio || 1));
    gl.uniform1f(dp.u_opacity, this.opacity);
    gl.drawArrays(gl.POINTS, 0, this.numParticles);
    gl.disable(gl.BLEND);

    const t = this._trailTex0; this._trailTex0 = this._trailTex1; this._trailTex1 = t;
  }

  _composite() {
    if (!this._fieldA) return;
    const gl = this.gl, flow = this._flow;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    if (this.heatmapOpacity > 0.001) {
      const hp = flow._heatProg;
      gl.useProgram(hp.program);
      flow._bindQuad(hp.a_pos);
      bindTexture(gl, this._fieldA, 0);      gl.uniform1i(hp.u_fieldA, 0);
      bindTexture(gl, this._fieldB, 1);      gl.uniform1i(hp.u_fieldB, 1);
      bindTexture(gl, this._heatRampTex, 2); gl.uniform1i(hp.u_ramp, 2);
      gl.uniform1f(hp.u_fieldMix, this._fieldMix);
      gl.uniform2fv(hp.u_fieldRes, this._fieldRes);
      gl.uniform2fv(hp.u_uvMin, this._uvMin);
      gl.uniform2fv(hp.u_uvMax, this._uvMax);
      gl.uniform1f(hp.u_maxSpeed, this.maxSpeed);
      gl.uniform1f(hp.u_opacity, this.heatmapOpacity);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    const cp = flow._copyProg;
    gl.useProgram(cp.program);
    flow._bindQuad(cp.a_pos);
    bindTexture(gl, this._trailTex0, 0);
    gl.uniform1i(cp.u_tex, 0);
    gl.uniform1f(cp.u_opacity, 1.0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.disable(gl.BLEND);
  }
}

// ===========================================================================

class FlowField {
  constructor(canvas, glOptions = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: false,
      premultipliedAlpha: true, ...glOptions })
      || canvas.getContext('webgl', { alpha: true, antialias: false,
      premultipliedAlpha: true, ...glOptions });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;

    this._updateProg = createProgram(gl, QUAD_VS, UPDATE_FS);
    this._drawProg   = createProgram(gl, DRAW_VS, DRAW_FS);
    this._fadeProg   = createProgram(gl, QUAD_VS, FADE_FS);
    this._copyProg   = createProgram(gl, QUAD_VS, COPY_FS);
    this._heatProg   = createProgram(gl, QUAD_VS, HEAT_FS);

    this._quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER,
      new Float32Array([0,0, 1,0, 0,1, 0,1, 1,0, 1,1]), gl.STATIC_DRAW);

    this.layers = [];
    this._raf = null;
    this._running = false;
  }

  addLayer(opts) {
    const layer = new ParticleLayer(this, opts);
    this.layers.push(layer);
    return layer;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (w === this.canvas.width && h === this.canvas.height) return;
    this.canvas.width = w; this.canvas.height = h;
    for (const l of this.layers) l._resizeTrails();
  }

  start() {
    if (this._running) return;
    this._running = true;
    const frame = () => {
      if (!this._running) return;
      this.renderFrame();
      this._raf = requestAnimationFrame(frame);
    };
    this._raf = requestAnimationFrame(frame);
  }

  stop() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  renderFrame() {
    const gl = this.gl;
    this.resize();
    const seed = Math.random();
    for (const l of this.layers) if (l.enabled) l._update(seed);
    for (const l of this.layers) if (l.enabled) l._drawTrailFrame();

    bindFramebuffer(gl, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (const l of this.layers) if (l.enabled) l._composite();
  }

  _bindQuad(attrLoc) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._quadBuf);
    gl.enableVertexAttribArray(attrLoc);
    gl.vertexAttribPointer(attrLoc, 2, gl.FLOAT, false, 0, 0);
  }
}

// Classic-script global (file:// pages cannot import ES modules — opaque origin).
window.FlowField = FlowField;
