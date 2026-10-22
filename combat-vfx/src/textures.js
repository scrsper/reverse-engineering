// Every texture is generated at startup: no image files, nothing borrowed.
// Convention (see shaders.js): .a = shape mask, .r = shading, .g = optional reveal field.
import * as THREE from 'three';
import { clamp, smoothstep, makeRandom, fbm, periodicNoise } from './core/math.js';

const cache = new Map();

function dataTexture(w, h, data, { repeat = false } = {}) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.NoColorSpace;   // masks, not colors
  t.needsUpdate = true;
  return t;
}

/** fn(u, v) → number (mask) or [shade, field, mask]. v = 1 is the top row. */
function pixels(w, h, fn, opts) {
  const d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = fn((x + 0.5) / w, (y + 0.5) / h);
      const [r, g, a] = typeof v === 'number' ? [v, 0, v] : v;
      const i = (y * w + x) * 4;   // DataTexture row 0 is v = 0
      d[i] = clamp(r) * 255; d[i + 1] = clamp(g) * 255; d[i + 2] = 0; d[i + 3] = clamp(a) * 255;
    }
  }
  return dataTexture(w, h, d, opts);
}

/** Draw with a 2D canvas (white on black), then use its brightness as mask; field(u, v) fills .g. */
function drawn(w, h, draw, { field = null, shadeFromAlpha = false } = {}) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  draw(g, w, h);
  const src = g.getImageData(0, 0, w, h).data, d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((h - 1 - y) * w + x) * 4, i = (y * w + x) * 4;   // canvas row 0 is the top
      const mask = shadeFromAlpha ? Math.min(255, src[s + 2] * 2) : src[s];
      const lum = shadeFromAlpha ? Math.max(src[s], src[s + 2] * 0.5) : src[s];   // glow halo keeps half brightness
      d[i] = lum; d[i + 1] = field ? clamp(field((x + 0.5) / w, (y + 0.5) / h)) * 255 : 0; d[i + 2] = 0; d[i + 3] = mask;
    }
  }
  return dataTexture(w, h, d);
}

function jaggedPath(R, x0, y0, x1, y1, rough, depth) {
  // midpoint displacement between two points
  let pts = [[x0, y0], [x1, y1]];
  for (let k = 0; k < depth; k++) {
    const next = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
      const off = (R() - 0.5) * rough * len;
      next.push([(ax + bx) / 2 - (dy / len) * off, (ay + by) / 2 + (dx / len) * off], pts[i]);
    }
    pts = next;
  }
  return pts;
}

function strokeGlow(g, pts, width, glow = 3) {
  g.lineJoin = g.lineCap = 'round';
  g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = width * glow; g.shadowColor = '#fff'; g.shadowBlur = width * 4; g.stroke();
  g.shadowBlur = 0; g.strokeStyle = '#fff'; g.lineWidth = width; g.stroke();
}

const GEN = {
  // tileable fBm noise used for dissolves and breakup
  noise: () => pixels(256, 256, (u, v) => fbm(u * 8, v * 8, 8, 8, 5, 7), { repeat: true }),

  solid: () => pixels(4, 4, () => 1),

  glow: () => pixels(128, 128, (u, v) => { const r = Math.hypot(u - 0.5, v - 0.5) * 2; return Math.exp(-r * r * 5) * (1 - smoothstep(0.8, 1, r)); }),

  soft: () => pixels(64, 64, (u, v) => 1 - smoothstep(0.3, 1, Math.hypot(u - 0.5, v - 0.5) * 2)),

  // streak for stretched particles: head at v = 1, thin tail
  spark: () => pixels(32, 128, (u, v) => Math.exp(-Math.pow((u - 0.5) * 6, 2)) * Math.pow(v, 1.6) * smoothstep(1, 0.85, v)),

  ring: () => pixels(256, 256, (u, v) => {
    const r = Math.hypot(u - 0.5, v - 0.5) * 2;
    return Math.exp(-Math.pow((r - 0.82) / 0.05, 2)) + 0.25 * smoothstep(0.3, 0.8, r) * (1 - smoothstep(0.8, 0.86, r));
  }),

  // crescent for slash arcs: u along the swing (head near u = 0.9), v across (outer edge v = 0.8)
  slash: () => pixels(256, 64, (u, v) => {
    const along = Math.pow(smoothstep(0, 0.9, u), 1.5) * (1 - smoothstep(0.9, 1, u));
    const across = v < 0.8 ? Math.pow(v / 0.8, 3) : 1 - smoothstep(0.8, 1, v);
    return along * across;
  }),

  // long wind streaks along u (tileable in u)
  streak: () => pixels(256, 64, (u, v) => {
    const n = periodicNoise(u * 3, v * 14, 3, 14, 3) * 0.7 + periodicNoise(u * 6, v * 28, 6, 28, 4) * 0.3;
    return smoothstep(0.5, 0.85, n) * Math.sin(Math.PI * v);
  }, { repeat: true }),

  // thin cut line for sword impacts, tapered at both ends
  line: () => pixels(256, 32, (u, v) => Math.exp(-Math.pow((v - 0.5) * 9, 2)) * Math.pow(Math.sin(Math.PI * u), 0.7)),

  // impact pillar wrapped around a cylinder: bright at the base, streaky upward (tileable in u)
  pillar: () => pixels(128, 128, (u, v) => (1 - smoothstep(0, 1, v)) * (0.35 + 0.65 * smoothstep(0.35, 0.8, periodicNoise(u * 12, v * 2, 12, 2, 9))), { repeat: true }),

  // radial spike burst
  burst: () => pixels(256, 256, (u, v) => {
    const x = u - 0.5, y = v - 0.5, r = Math.hypot(x, y) * 2, a = (Math.atan2(y, x) / (2 * Math.PI) + 0.5) * 18;
    const reach = 0.3 + 0.7 * Math.pow(periodicNoise(a, 0, 18, 1, 5), 2);
    return (1 - smoothstep(reach * 0.6, reach, r)) * (1 - smoothstep(0, 1, r) * 0.6);
  }),

  // four-point star glint
  star: () => pixels(64, 64, (u, v) => {
    const x = Math.abs(u - 0.5) * 2, y = Math.abs(v - 0.5) * 2, r = Math.hypot(x, y);
    return clamp(Math.exp(-x * 14) * Math.exp(-y * 2.2) + Math.exp(-y * 14) * Math.exp(-x * 2.2) + Math.exp(-r * 6) * 0.8);
  }),

  // ice shard: elongated diamond with a bright edge
  shard: () => pixels(32, 128, (u, v) => {
    const w = 0.5 * (1 - Math.abs(2 * v - 1)), x = Math.abs(u - 0.5);
    return w > 0 ? (1 - smoothstep(w * 0.75, w, x)) * (0.55 + 0.45 * smoothstep(0, w, x)) : 0;
  }),

  bubble: () => pixels(64, 64, (u, v) => {
    const r = Math.hypot(u - 0.5, v - 0.5) * 2, hl = Math.exp(-Math.pow(Math.hypot(u - 0.36, v - 0.64) * 9, 2));
    return clamp((smoothstep(0.55, 0.9, r) - smoothstep(0.9, 1, r)) * 0.9 + hl + 0.12 * (1 - smoothstep(0.8, 1, r)));
  }),

  // smoke / flame puffs: 2x2 flipbook of noisy blobs
  smoke: () => pixels(256, 256, (u, v) => {
    const cx = Math.floor(u * 2), cy = Math.floor(v * 2), fu = u * 2 - cx, fv = v * 2 - cy;
    const r = Math.hypot(fu - 0.5, fv - 0.5) * 2, n = fbm(fu * 4, fv * 4, 4, 4, 4, 11 + cx + cy * 2);
    return 1 - smoothstep(0.35, 0.95, r + (n - 0.5) * 0.7);
  }),

  // 4 vertical lightning bolts side by side (cols = 4): top of each frame is the sky
  lightning: () => drawn(256, 512, (g, w, h) => {
    const R = makeRandom(1234), fw = w / 4;
    for (let f = 0; f < 4; f++) {
      const cx = fw * f + fw / 2;
      const main = jaggedPath(R, cx + (R() - 0.5) * 10, 0, cx + (R() - 0.5) * 10, h, 0.45, 6);
      strokeGlow(g, main.map(([x, y]) => [Math.min(fw * (f + 1) - 8, Math.max(fw * f + 8, x)), y]), 3.2);
      for (let b = 0; b < 2; b++) {
        const s = main[8 + Math.floor(R() * 40)];
        const br = jaggedPath(R, s[0], s[1], s[0] + (R() - 0.5) * fw * 0.8, s[1] + 60 + R() * 90, 0.6, 4);
        strokeGlow(g, br.map(([x, y]) => [Math.min(fw * (f + 1) - 6, Math.max(fw * f + 6, x)), y]), 1.4);
      }
    }
  }),

  // ground crack decal; .g = 1 at the centre, 0 at the rim, so a falling threshold reveals it outward
  crack: () => drawn(512, 512, (g, w, h) => {
    const R = makeRandom(77), cx = w / 2, cy = h / 2;
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, w * 0.16);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    const crack = (x, y, ang, len, width, depth) => {
      const pts = [[x, y]];
      for (let s = 0; s < len; s++) {
        ang += (R() - 0.5) * 0.7; const step = 10 + R() * 14;
        x += Math.cos(ang) * step; y += Math.sin(ang) * step; pts.push([x, y]);
        if (depth < 2 && R() < 0.12) crack(x, y, ang + (R() < 0.5 ? -1 : 1) * (0.5 + R() * 0.6), len - s - 2, width * 0.6, depth + 1);
      }
      g.lineJoin = g.lineCap = 'round';
      for (let i = 1; i < pts.length; i++) {
        const k = 1 - i / pts.length;
        g.strokeStyle = '#fff'; g.lineWidth = Math.max(1, width * k);
        g.beginPath(); g.moveTo(...pts[i - 1]); g.lineTo(...pts[i]); g.stroke();
      }
    };
    for (let i = 0; i < 9; i++) crack(cx, cy, (i / 9) * Math.PI * 2 + R() * 0.4, 12 + Math.floor(R() * 6), 7, 0);
  }, { field: (u, v) => 1 - Math.min(1, Math.hypot(u - 0.5, v - 0.5) * 2) }),

  // magic circle for the shield: rings, ticks and glyph strokes
  rune: () => drawn(512, 512, (g, w) => {
    const R = makeRandom(5), c = w / 2;
    g.strokeStyle = '#fff'; g.lineCap = 'round';
    for (const [r, lw] of [[0.94, 5], [0.86, 2.5], [0.62, 3], [0.56, 1.5]]) { g.lineWidth = lw; g.beginPath(); g.arc(c, c, r * c, 0, Math.PI * 2); g.stroke(); }
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2, r0 = 0.86 * c, r1 = (i % 4 ? 0.82 : 0.78) * c;
      g.lineWidth = 2; g.beginPath(); g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0); g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); g.stroke();
    }
    for (let i = 0; i < 12; i++) {   // glyphs between the 0.62 and 0.78 rings
      const a = (i / 12) * Math.PI * 2, r = 0.7 * c, gx = c + Math.cos(a) * r, gy = c + Math.sin(a) * r;
      g.lineWidth = 3; g.beginPath();
      for (let s = 0; s < 3; s++) { const x0 = (R() - 0.5) * 28, y0 = (R() - 0.5) * 28, x1 = (R() - 0.5) * 28, y1 = (R() - 0.5) * 28; g.moveTo(gx + x0, gy + y0); g.lineTo(gx + x1, gy + y1); }
      g.stroke();
    }
    for (let i = 0; i < 6; i++) {   // hexagram
      const a = (i / 6) * Math.PI * 2, b = ((i + 2) / 6) * Math.PI * 2;
      g.lineWidth = 2.5; g.beginPath(); g.moveTo(c + Math.cos(a) * 0.56 * c, c + Math.sin(a) * 0.56 * c); g.lineTo(c + Math.cos(b) * 0.56 * c, c + Math.sin(b) * 0.56 * c); g.stroke();
    }
  }),

  // stylized war hammer, head down: shading in .r, silhouette + glow in .a (from the blue channel)
  hammer: () => drawn(256, 384, (g, w, h) => {
    const glow = (fn) => { g.save(); g.shadowColor = 'rgb(0,0,255)'; g.shadowBlur = 22; g.fillStyle = 'rgb(0,0,255)'; fn(); g.restore(); };
    const handle = () => g.fillRect(w / 2 - 13, 18, 26, 240);
    const head = () => { g.beginPath(); g.roundRect(26, 250, w - 52, 112, 14); g.fill(); };
    glow(handle); glow(head);
    const shade = (y0, y1) => { const s = g.createLinearGradient(0, y0, w, y1); s.addColorStop(0, 'rgb(255,255,255)'); s.addColorStop(1, 'rgb(150,150,255)'); return s; };
    g.fillStyle = shade(18, 258); handle();
    g.fillStyle = 'rgb(120,120,255)';
    for (let y = 40; y < 200; y += 22) g.fillRect(w / 2 - 15, y, 30, 6);   // grip wraps
    g.fillStyle = shade(250, 362); head();
    g.fillStyle = 'rgb(255,255,255)'; g.beginPath(); g.arc(w / 2, 306, 26, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgb(170,170,255)'; g.fillRect(w / 2 - 5, 282, 10, 48); g.fillRect(w / 2 - 24, 301, 48, 10);
  }, { shadeFromAlpha: true }),

  // 2x2 flipbook of rock chunks: shading in .r, silhouette in .a
  rock: () => drawn(256, 256, (g, w) => {
    const R = makeRandom(31), cw = w / 2;
    for (let f = 0; f < 4; f++) {
      const ox = (f % 2) * cw + cw / 2, oy = Math.floor(f / 2) * cw + cw / 2, n = 7 + Math.floor(R() * 3);
      const pts = Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2, r = cw * (0.28 + R() * 0.16); return [ox + Math.cos(a) * r, oy + Math.sin(a) * r]; });
      const s = g.createLinearGradient(ox - cw * 0.4, oy - cw * 0.4, ox + cw * 0.4, oy + cw * 0.4);
      s.addColorStop(0, 'rgb(255,255,255)'); s.addColorStop(1, 'rgb(90,90,255)');
      g.fillStyle = s; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
    }
  }, { shadeFromAlpha: true }),
};

/** Get (and cache) a generated texture by name. */
export function texture(name) {
  if (!cache.has(name)) {
    if (!GEN[name]) throw new Error(`combat-vfx: unknown texture "${name}"`);
    cache.set(name, GEN[name]());
  }
  return cache.get(name);
}

export const TEXTURES = Object.keys(GEN);
