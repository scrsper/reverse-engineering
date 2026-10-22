// Small dependency-free helpers shared by the simulation, the recipes and the texture generators.

/** Deterministic PRNG (mulberry32): the same seed always replays the same effect. */
export function makeRandom(seed = 1) {
  let a = seed >>> 0;
  const random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  random.reset = (s) => { a = s >>> 0; };
  return random;
}

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** Piecewise-linear curve. points = [[t, v], ...] sorted by t; held flat outside the first/last key. */
export function evalCurve(points, t) {
  const n = points.length;
  if (!n) return 0;
  if (t <= points[0][0]) return points[0][1];
  for (let i = 1; i < n; i++) {
    const b = points[i];
    if (t <= b[0]) {
      const a = points[i - 1], span = b[0] - a[0];
      return span > 0 ? lerp(a[1], b[1], (t - a[0]) / span) : b[1];
    }
  }
  return points[n - 1][1];
}

/** Curve spec helper: curve([[0, 1], [1, 0]], 2) → a curve from 2 to 0. */
export const curve = (points, scale = 1) => ({ curve: points, scale });

/**
 * Evaluate a value spec at normalized time t with a per-particle random r in [0, 1):
 *   5                       constant
 *   [2, 4]                  random between 2 and 4, fixed per particle
 *   { curve, scale }        curve over t, times scale
 *   { curve, scale, range } curve over t, times a random factor between range[0] and range[1]
 */
export function value(spec, t, r) {
  if (spec == null) return 0;
  if (typeof spec === 'number') return spec;
  if (Array.isArray(spec)) return spec[0] + (spec[1] - spec[0]) * r;
  if (spec.curve) {
    const k = spec.range ? lerp(spec.range[0], spec.range[1], r) : 1;
    return evalCurve(spec.curve, t) * (spec.scale ?? 1) * k;
  }
  return 0;
}

/** Color gradient: stops = [[t, [r, g, b]], ...] (linear RGB, may exceed 1 for HDR). */
export function evalGradient(stops, t, out) {
  const n = stops.length;
  let a = stops[0], b = stops[n - 1], s = 0;
  if (t <= a[0]) b = a;
  else if (t >= b[0]) a = b;
  else {
    for (let i = 1; i < n; i++) {
      if (t <= stops[i][0]) { a = stops[i - 1]; b = stops[i]; break; }
    }
    s = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
  }
  out[0] = lerp(a[1][0], b[1][0], s); out[1] = lerp(a[1][1], b[1][1], s); out[2] = lerp(a[1][2], b[1][2], s);
  return out;
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** '#rrggbb' → linear RGB array, optionally scaled (k > 1 gives HDR values that bloom). */
export function hex(h, k = 1) {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => srgbToLinear(c / 255) * k);
}

export const scale3 = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/** Tileable 2D value noise: periodic in x with period px and in y with period py (integer lattice units). */
export function periodicNoise(x, y, px, py, seed = 0) {
  const hash = (i, j) => {
    i = ((i % px) + px) % px; j = ((j % py) + py) % py;
    let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 982451653);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return lerp(lerp(hash(xi, yi), hash(xi + 1, yi), u), lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), u), v);
}

/** Fractal (fBm) version of periodicNoise, normalized to roughly [0, 1]. */
export function fbm(x, y, px, py, octaves = 4, seed = 0) {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * periodicNoise(x * f, y * f, px * f, py * f, seed + o);
    norm += amp; amp *= 0.5; f *= 2;
  }
  return sum / norm;
}
