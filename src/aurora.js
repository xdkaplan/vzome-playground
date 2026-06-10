/**
 * aurora.js — "aurora glass" effect, WebGL2. Self-contained, no deps.
 *
 * Soft blue blobs in a mesh gradient; the image mean is locked to a target color
 * in CIELAB; frosted grain on top. One fragment shader does every pixel on the
 * GPU. `createAuroraGridGL` drives many tiles from one shared context, with an
 * optional per-tile hover bloom + breathing.
 */

const TAU = Math.PI * 2;
const easeOutQuad = (t) => t * (2 - t);
const lerp = (a, b, t) => a + (b - a) * t;
const MAXB = 8; // shader's max blob count

// Blue-dominant palette: blues + cyans with one indigo + one violet accent.
const BLUE_PALETTE = [
  [90, 150, 230],  // azure
  [120, 185, 235], // sky
  [70, 120, 220],  // cornflower
  [150, 205, 240], // pale blue
  [100, 165, 235], // cerulean
  [130, 195, 238], // light sky
];

export const DEFAULTS = {
  res: 256,
  blobCount: 6,
  palette: BLUE_PALETTE,
  background: [34, 68, 150], // deep blue behind the glow
  bgWeight: 0.32,            // how much background shows through thin areas
  blobStrength: 1.0,         // blob opacity (0 = blobs vanish → flat target)
  softness: 0.46,            // blob sigma = radius * softness
  grain: 0.05,               // frosted-glass grain (0 = none)
  targetColor: '#8CC2E7',    // image mean matched to this in CIELAB (null = off)
  hueSpread: 1.35,           // chroma variation around the target hue
  lightSpread: 0.95,         // lightness variation (the visible texture)
  drift: 1.0,                // overall motion scale
  speed: 0.3,                // time advanced per second
  maxFps: 60,
  seed: 7,
};

const FALLBACK_TARGET = [76.0, -8.3, -23.9]; // Lab of #8CC2E7

// ---- CPU helpers: blob drift + coarse Lab mean --------------------------

const smooth = (t) => t * t * (3 - 2 * t);

// 3D value noise in [-1, 1]; z axis is time. Only used to drift blob positions.
function makeNoise(seed = 7) {
  const s = seed | 0;
  function hash(x, y, z) {
    let h =
      Math.imul(x | 0, 374761393) ^
      Math.imul(y | 0, 668265263) ^
      Math.imul(z | 0, 1274126177) ^
      Math.imul(s, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  }
  return function noise3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const u = smooth(x - xi), v = smooth(y - yi), w = smooth(z - zi);
    const c000 = hash(xi, yi, zi),       c100 = hash(xi + 1, yi, zi);
    const c010 = hash(xi, yi + 1, zi),   c110 = hash(xi + 1, yi + 1, zi);
    const c001 = hash(xi, yi, zi + 1),   c101 = hash(xi + 1, yi, zi + 1);
    const c011 = hash(xi, yi + 1, zi + 1), c111 = hash(xi + 1, yi + 1, zi + 1);
    const x00 = c000 + (c100 - c000) * u, x10 = c010 + (c110 - c010) * u;
    const x01 = c001 + (c101 - c001) * u, x11 = c011 + (c111 - c011) * u;
    const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
    return (y0 + (y1 - y0) * w) * 2 - 1;
  };
}

function buildBlobs(o) {
  const blobs = [];
  const phase = o.seed * 0.618;
  for (let i = 0; i < o.blobCount; i++) {
    const a = i / o.blobCount;
    blobs.push({
      id: i + 1,
      cx0: 0.5 + 0.34 * Math.cos(TAU * a + phase), // base position around the square
      cy0: 0.5 + 0.34 * Math.sin(TAU * a + phase * 1.3),
      r0: 0.36 + 0.12 * (i % 3) / 2, // a little size variety
      range: 0.18,                   // how far it wanders
      speed: 0.12 + 0.06 * (i % 4),  // each blob drifts at its own pace
      col: o.palette[i % o.palette.length],
    });
  }
  return blobs;
}

// sRGB → CIELAB (D65). Only direction needed on the CPU (for the coarse mean).
const Xn = 0.95047, Yn = 1.0, Zn = 1.08883;
const srgbToLinear = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const fLab = (t) => (t > 0.008856451679 ? Math.cbrt(t) : 7.787037 * t + 0.137931);
function rgbToLab(r, g, b, out) {
  const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
  const x = fLab((0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / Xn);
  const y = fLab((0.2126729 * lr + 0.7151522 * lg + 0.0721750 * lb) / Yn);
  const z = fLab((0.0193339 * lr + 0.1191920 * lg + 0.9503041 * lb) / Zn);
  out[0] = 116 * y - 16; out[1] = 500 * (x - y); out[2] = 200 * (y - z);
}
function parseColor(c) {
  if (Array.isArray(c)) return c;
  let h = String(c).replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// ---- shaders ------------------------------------------------------------

const VERT = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;

#define MAXB ${MAXB}
uniform vec2  u_res;
uniform float u_seed;
uniform int   u_count;
uniform vec3  u_blobPos[MAXB]; // x, y, invSigma2 (normalized coords)
uniform vec3  u_blobCol[MAXB]; // sRGB 0..1
uniform vec3  u_bg;            // sRGB 0..1
uniform float u_bgWeight;
uniform float u_blobStrength;
uniform float u_match;         // 1 = lock mean to target, 0 = off
uniform vec3  u_target;        // Lab
uniform vec3  u_mean;          // Lab
uniform float u_hueSpread;
uniform float u_lightSpread;
uniform float u_grain;

// static per-pixel hash for the frosted grain
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

// sRGB <-> CIELAB (D65)
const vec3 WN = vec3(0.95047, 1.0, 1.08883);
float s2l(float c) { c = max(c, 0.0); return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4); }
float l2s(float c) { c = max(c, 0.0); return c <= 0.0031308 ? 12.92 * c : 1.055 * pow(c, 1.0 / 2.4) - 0.055; }
float fl(float t)  { return t > 0.008856451679 ? pow(t, 1.0 / 3.0) : 7.787037 * t + 0.137931; }
float fli(float t) { float t3 = t * t * t; return t3 > 0.008856451679 ? t3 : (t - 0.137931) / 7.787037; }
vec3 rgb2lab(vec3 c) {
  vec3 lin = vec3(s2l(c.r), s2l(c.g), s2l(c.b));
  float x = fl((0.4124564*lin.r + 0.3575761*lin.g + 0.1804375*lin.b) / WN.x);
  float y = fl((0.2126729*lin.r + 0.7151522*lin.g + 0.0721750*lin.b) / WN.y);
  float z = fl((0.0193339*lin.r + 0.1191920*lin.g + 0.9503041*lin.b) / WN.z);
  return vec3(116.0*y - 16.0, 500.0*(x - y), 200.0*(y - z));
}
vec3 lab2rgb(vec3 lab) {
  float fy = (lab.x + 16.0) / 116.0, fx = fy + lab.y / 500.0, fz = fy - lab.z / 200.0;
  vec3 xyz = vec3(fli(fx) * WN.x, fli(fy) * WN.y, fli(fz) * WN.z);
  vec3 lin = vec3(
     3.2404542*xyz.x - 1.5371385*xyz.y - 0.4985314*xyz.z,
    -0.9692660*xyz.x + 1.8760108*xyz.y + 0.0415560*xyz.z,
     0.0556434*xyz.x - 0.2040259*xyz.y + 1.0572252*xyz.z);
  return clamp(vec3(l2s(lin.r), l2s(lin.g), l2s(lin.b)), 0.0, 1.0);
}

void main() {
  vec2 uv = vec2(gl_FragCoord.x / u_res.x, 1.0 - gl_FragCoord.y / u_res.y);

  // mesh gradient: weighted blend of background + every blob
  vec3 acc = u_bg * u_bgWeight;
  float w = u_bgWeight;
  for (int i = 0; i < u_count; i++) {
    vec2 d = uv - u_blobPos[i].xy;
    float g = exp(-dot(d, d) * u_blobPos[i].z) * u_blobStrength;
    acc += g * u_blobCol[i];
    w += g;
  }
  vec3 col = acc / w;

  // recenter the image mean onto the target in Lab, scaling the deviation
  if (u_match > 0.5) {
    vec3 lab = rgb2lab(col);
    lab = u_target + (lab - u_mean) * vec3(u_lightSpread, u_hueSpread, u_hueSpread);
    col = lab2rgb(lab);
  }

  // frosted-glass grain (static per pixel)
  if (u_grain > 0.0) col += (hash13(vec3(gl_FragCoord.xy, u_seed)) - 0.5) * u_grain;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

// ---- GL plumbing --------------------------------------------------------

function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error('aurora shader compile: ' + gl.getShaderInfoLog(s));
  }
  return s;
}

function createRenderer(canvas, preserve) {
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: !!preserve, antialias: false, alpha: false });
  if (!gl) throw new Error('WebGL2 not supported');

  const prog = gl.createProgram();
  gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('aurora link: ' + gl.getProgramInfoLog(prog));
  }

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const U = (n) => gl.getUniformLocation(prog, n);
  const u = {
    res: U('u_res'), seed: U('u_seed'), count: U('u_count'),
    blobPos: U('u_blobPos'), blobCol: U('u_blobCol'), bg: U('u_bg'), bgWeight: U('u_bgWeight'),
    blobStrength: U('u_blobStrength'), match: U('u_match'), target: U('u_target'), mean: U('u_mean'),
    hueSpread: U('u_hueSpread'), lightSpread: U('u_lightSpread'), grain: U('u_grain'),
  };
  return { gl, prog, vao, u };
}

// ---- per-tile state -----------------------------------------------------

function labOf(c) {
  if (!c) return FALLBACK_TARGET.slice();
  const rgb = parseColor(c);
  const out = [0, 0, 0];
  rgbToLab(rgb[0], rgb[1], rgb[2], out);
  return out;
}

function makeState(opts) {
  const o = { ...DEFAULTS, ...opts };
  return {
    o,
    noise: makeNoise(o.seed),
    blobs: buildBlobs(o),
    target: labOf(o.targetColor),
    pos: new Float32Array(MAXB * 3),
    col: new Float32Array(MAXB * 3),
    time: o.time || 0,
  };
}

function applyOptions(state, partial) {
  Object.assign(state.o, partial);
  if ('seed' in partial) state.noise = makeNoise(state.o.seed);
  if ('seed' in partial || 'blobCount' in partial || 'palette' in partial) state.blobs = buildBlobs(state.o);
  if ('targetColor' in partial) state.target = labOf(state.o.targetColor);
}

// Coarse Lab mean of the blob field, so the shader can recenter onto the target.
const MEAN = [0, 0, 0];
function coarseMeanLab(pos, col, count, o, out) {
  const N = 12, bg = o.background, bgW = o.bgWeight, bs = o.blobStrength, lab = [0, 0, 0];
  let sL = 0, sa = 0, sb = 0;
  for (let j = 0; j < N; j++) {
    const py = j / (N - 1);
    for (let i = 0; i < N; i++) {
      const px = i / (N - 1);
      let r = bg[0] * bgW, g = bg[1] * bgW, b = bg[2] * bgW, w = bgW;
      for (let k = 0; k < count; k++) {
        const dx = px - pos[k * 3], dy = py - pos[k * 3 + 1];
        const wt = Math.exp(-(dx * dx + dy * dy) * pos[k * 3 + 2]) * bs;
        r += wt * col[k * 3] * 255; g += wt * col[k * 3 + 1] * 255; b += wt * col[k * 3 + 2] * 255; w += wt;
      }
      const inv = 1 / w;
      rgbToLab(r * inv, g * inv, b * inv, lab);
      sL += lab[0]; sa += lab[1]; sb += lab[2];
    }
  }
  const n = N * N;
  out[0] = sL / n; out[1] = sa / n; out[2] = sb / n;
}

function draw(R, RES, state, time) {
  const { gl, prog, vao, u } = R;
  const o = state.o, noise3 = state.noise, blobs = state.blobs;
  const count = Math.min(MAXB, blobs.length);
  const t = time * o.drift;

  for (let i = 0; i < count; i++) {
    const b = blobs[i];
    const x = b.cx0 + b.range * noise3(b.id * 10.1, 1.7, t * b.speed);
    const y = b.cy0 + b.range * noise3(4.3, b.id * 10.1, t * b.speed * 0.92);
    const r = b.r0 * (1 + 0.18 * noise3(b.id * 3.3, b.id * 1.7, t * b.speed * 0.6));
    const sigma = Math.max(1e-3, r * o.softness);
    state.pos[i * 3] = x;
    state.pos[i * 3 + 1] = y;
    state.pos[i * 3 + 2] = 1 / (2 * sigma * sigma);
    state.col[i * 3] = b.col[0] / 255;
    state.col[i * 3 + 1] = b.col[1] / 255;
    state.col[i * 3 + 2] = b.col[2] / 255;
  }

  const matching = o.targetColor ? 1 : 0;
  if (matching) coarseMeanLab(state.pos, state.col, count, o, MEAN);

  gl.viewport(0, 0, RES, RES);
  gl.useProgram(prog);
  gl.bindVertexArray(vao);
  gl.uniform2f(u.res, RES, RES);
  gl.uniform1f(u.seed, o.seed);
  gl.uniform1i(u.count, count);
  gl.uniform3fv(u.blobPos, state.pos);
  gl.uniform3fv(u.blobCol, state.col);
  gl.uniform3f(u.bg, o.background[0] / 255, o.background[1] / 255, o.background[2] / 255);
  gl.uniform1f(u.bgWeight, o.bgWeight);
  gl.uniform1f(u.blobStrength, o.blobStrength);
  gl.uniform1f(u.match, matching);
  gl.uniform3f(u.target, state.target[0], state.target[1], state.target[2]);
  gl.uniform3f(u.mean, MEAN[0], MEAN[1], MEAN[2]);
  gl.uniform1f(u.hueSpread, o.hueSpread);
  gl.uniform1f(u.lightSpread, o.lightSpread);
  gl.uniform1f(u.grain, o.grain);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

// ---- public API ---------------------------------------------------------

/**
 * Animate many tiles from ONE shared WebGL2 context. Each tile keeps its own 2D
 * canvas (so borders/labels/hover keep working); we render into a shared GL
 * canvas and drawImage the result into each tile. Optional per-tile hover tween
 * + breathing via baseOpts.hover = { duration, from, to, breath:{rate,amount} }.
 */
export function createAuroraGridGL(canvases, optsList = [], baseOpts = {}) {
  const RES = baseOpts.res || DEFAULTS.res;
  const glCanvas = (typeof OffscreenCanvas !== 'undefined')
    ? new OffscreenCanvas(RES, RES)
    : Object.assign(document.createElement('canvas'), { width: RES, height: RES });
  const R = createRenderer(glCanvas, true);

  const hover = baseOpts.hover || null;
  const hoverDur = hover ? (hover.duration || 0.4) : 0;
  const breath = (hover && hover.breath) || null; // { rate(Hz), amount: { key: amp } }

  const tiles = canvases.map((canvas, i) => {
    if (!canvas.width) canvas.width = RES;
    if (!canvas.height) canvas.height = RES;
    const state = makeState({ ...baseOpts, ...(optsList[i] || {}) });
    const tile = { ctx: canvas.getContext('2d'), state };
    if (hover) {
      Object.assign(state.o, hover.from);   // start at the rest values
      tile.h = 0;                           // hover amount, 0 (rest) .. 1 (bloomed)
      tile.tween = { active: false, t: 0, from: 0, to: 0 };
      tile.breathOffset = i * 0.37;         // desync each tile's breathing
    }
    return tile;
  });

  let raf = 0, running = false, last = 0, clock = 0;
  const cap = () => baseOpts.maxFps || DEFAULTS.maxFps;

  function renderAll(dt) {
    clock += dt;
    for (const t of tiles) {
      if (hover) {
        const tw = t.tween;
        let changed = false;
        if (tw.active) {
          tw.t = hoverDur > 0 ? Math.min(1, tw.t + dt / hoverDur) : 1;
          t.h = lerp(tw.from, tw.to, easeOutQuad(tw.t)); // square ease-out, both directions
          if (tw.t >= 1) tw.active = false;
          changed = true;
        }
        // Recompute every frame while bloomed so the breath keeps animating.
        if (changed || t.h > 0) {
          const phase = breath ? Math.sin((clock + t.breathOffset) * TAU * breath.rate) : 0;
          for (const key in hover.to) {
            let v = lerp(hover.from[key], hover.to[key], t.h);
            if (breath && breath.amount[key]) v += phase * breath.amount[key] * t.h;
            t.state.o[key] = v;
          }
        }
      }
      t.state.time += dt * t.state.o.speed;
      draw(R, RES, t.state, t.state.time);
      const c = t.ctx.canvas;
      t.ctx.drawImage(glCanvas, 0, 0, RES, RES, 0, 0, c.width, c.height);
    }
  }
  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const fps = cap();
    if (last && fps > 0 && now - last < 1000 / fps) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    renderAll(dt);
  }
  function start() { if (!running) { running = true; last = 0; raf = requestAnimationFrame(frame); } }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
  function setOptions(p) { for (const t of tiles) applyOptions(t.state, p); renderAll(0); }
  // Re-base the tween on the CURRENT value toward rest/hover, so a direction
  // change mid-flight still eases out from where it is.
  function setHover(index, hovered) {
    const t = tiles[index];
    if (!t || !hover) return;
    t.tween = { active: true, t: 0, from: t.h, to: hovered ? 1 : 0 };
  }

  renderAll(0); // immediate first frame so tiles aren't blank

  // Self-test: if the shader compiled but produced a blank frame (a logic bug),
  // throw so the caller can degrade gracefully instead of showing black.
  const probe = new Uint8Array(4);
  R.gl.readPixels(RES >> 1, RES >> 1, 1, 1, R.gl.RGBA, R.gl.UNSIGNED_BYTE, probe);
  if (probe[0] + probe[1] + probe[2] < 8) throw new Error('aurora produced a blank frame');

  start();
  return { start, stop, setOptions, setHover };
}
