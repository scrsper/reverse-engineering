// One particle layer of an effect: when particles are emitted, how they move, and how they look over their life.
// Pure JS (no three.js) so it can be unit tested in Node. Space is the layer's local space: +Y up, +Z forward.
import { value, evalCurve, evalGradient } from './math.js';

const DEG = Math.PI / 180;
const WHITE = [1, 1, 1];

function randomUnit(R) {
  const z = R() * 2 - 1, a = R() * Math.PI * 2, s = Math.sqrt(1 - z * z);
  return [s * Math.cos(a), z, s * Math.sin(a)];
}

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Two unit vectors perpendicular to axis (for cones around an arbitrary axis). */
function basis(axis) {
  const a = normalize(axis);
  const ref = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = normalize([a[1] * ref[2] - a[2] * ref[1], a[2] * ref[0] - a[0] * ref[2], a[0] * ref[1] - a[1] * ref[0]]);
  const v = [a[1] * u[2] - a[2] * u[1], a[2] * u[0] - a[0] * u[2], a[0] * u[1] - a[1] * u[0]];
  return [a, u, v];
}

/**
 * Sample a start position and direction from an emission shape.
 *   point                       dir (default +Z)
 *   sphere / hemisphere         radius, shell (surface only); hemisphere opens toward +Y
 *   circle                      in the XZ plane: radius, arc [fromDeg, toDeg] (0 = +Z, 90 = +X), edge, tangent (+1/-1)
 *   cone                        axis (default +Y), angle (deg), radius of the base disc
 *   box                         size [x, y, z], dir (default +Y)
 * Every shape takes offset [x, y, z].
 */
export function sampleShape(S, R) {
  let pos = [0, 0, 0], dir = [0, 0, 1];
  if (!S || S.type === 'point') dir = S?.dir ? normalize(S.dir) : dir;
  else if (S.type === 'sphere' || S.type === 'hemisphere') {
    dir = randomUnit(R);
    if (S.type === 'hemisphere') dir[1] = Math.abs(dir[1]);
    const r = (S.radius ?? 0) * (S.shell ? 1 : Math.cbrt(R()));
    pos = [dir[0] * r, dir[1] * r, dir[2] * r];
  } else if (S.type === 'circle') {
    const [a0, a1] = S.arc || [0, 360];
    const th = (a0 + (a1 - a0) * R()) * DEG, r = (S.radius ?? 0) * (S.edge ? 1 : Math.sqrt(R()));
    const radial = [Math.sin(th), 0, Math.cos(th)];
    pos = [radial[0] * r, 0, radial[2] * r];
    dir = S.tangent ? [Math.cos(th) * S.tangent, 0, -Math.sin(th) * S.tangent] : radial;
  } else if (S.type === 'cone') {
    const [a, u, v] = basis(S.axis || [0, 1, 0]);
    const th = R() * Math.PI * 2, tilt = (S.angle ?? 25) * DEG * Math.sqrt(R());
    const s = Math.sin(tilt), c = Math.cos(tilt), ct = Math.cos(th), st = Math.sin(th);
    dir = [a[0] * c + (u[0] * ct + v[0] * st) * s, a[1] * c + (u[1] * ct + v[1] * st) * s, a[2] * c + (u[2] * ct + v[2] * st) * s];
    const r = (S.radius ?? 0) * Math.sqrt(R());
    pos = [(u[0] * ct + v[0] * st) * r, (u[1] * ct + v[1] * st) * r, (u[2] * ct + v[2] * st) * r];
  } else if (S.type === 'box') {
    const sz = S.size || [1, 1, 1];
    pos = [(R() - 0.5) * sz[0], (R() - 0.5) * sz[1], (R() - 0.5) * sz[2]];
    dir = normalize(S.dir || [0, 1, 0]);
  }
  if (S?.offset) { pos[0] += S.offset[0]; pos[1] += S.offset[1]; pos[2] += S.offset[2]; }
  return [pos, dir];
}

export class Emitter {
  /** @param def layer definition (see README)  @param random shared deterministic () => [0, 1) */
  constructor(def, random) {
    this.def = def;
    this.random = random;
    this.max = def.max ?? 64;
    this.particles = [];
    const lastBurst = Math.max(0, ...(def.bursts || []).map((b) => b[0]));
    this.duration = def.duration ?? (def.rate ? 1 : lastBurst + 1e-3);
    this.reset();
  }

  reset() {
    this.particles.length = 0;
    this.delay = value(this.def.delay ?? 0, 0, this.random());
    this.localTime = -this.delay;
    this.cycle = 0;
    this.fired = (this.def.bursts || []).map(() => false);
    this.carry = 0;
    this.stopped = false;
  }

  /** Stop emitting. Sustained particles (def.sustain) are released and play their outro. */
  stop() { this.stopped = true; }

  get emitting() { return !this.stopped && (this.def.loop || this.localTime <= this.duration); }
  get done() { return !this.emitting && this.localTime >= 0 && this.particles.length === 0; }

  /** Advance by dt seconds. */
  step(dt) {
    const d = this.def, R = this.random;
    this.localTime += dt;
    const lt = this.localTime;
    if (!this.stopped && lt >= 0 && (d.loop || lt - dt <= this.duration)) {
      const cyc = d.loop ? Math.floor(lt / this.duration) : 0;
      if (cyc !== this.cycle) { this.cycle = cyc; this.fired.fill(false); }
      const ct = lt - cyc * this.duration;   // time inside the current cycle
      (d.bursts || []).forEach(([at, count], i) => {
        if (!this.fired[i] && ct >= at) { this.fired[i] = true; this.spawn(Math.round(value(count, 0, R())), ct); }
      });
      if (d.rate && ct <= this.duration) {
        this.carry += value(d.rate, ct / this.duration, R()) * dt;
        const n = Math.floor(this.carry);
        if (n > 0) { this.carry -= n; this.spawn(n, ct); }
      }
    }
    const grav = -9.81 * (d.gravity ?? 0), drag = d.drag ? Math.exp(-d.drag * dt) : 1;
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.age += dt;
      if (d.sustain != null && !this.stopped) p.age = Math.min(p.age, p.life * d.sustain);   // hold until stop()
      if (p.age >= p.life) { ps[i] = ps[ps.length - 1]; ps.pop(); continue; }
      const t = p.age / p.life, v = p.vel;
      v[1] += grav * dt;
      v[0] *= drag; v[1] *= drag; v[2] *= drag;
      p.pos[0] += v[0] * dt; p.pos[1] += v[1] * dt; p.pos[2] += v[2] * dt;
      if (d.spin != null) p.angle += value(d.spin, t, p.r) * DEG * dt;   // spin is an angular velocity (deg/s)
    }
  }

  spawn(n, ct) {
    const d = this.def, R = this.random, et = ct / this.duration;
    const add = d.velocity || [0, 0, 0];
    for (let i = 0; i < n && this.particles.length < this.max; i++) {
      const [pos, dir] = sampleShape(d.shape, R);
      const speed = value(d.speed ?? 0, et, R());
      const frames = d.frames ? d.frames.cols * d.frames.rows : 1;
      this.particles.push({
        age: 0,
        life: Math.max(0.01, value(d.life ?? 1, et, R())),
        pos,
        vel: [dir[0] * speed + add[0], dir[1] * speed + add[1], dir[2] * speed + add[2]],
        size: value(d.size ?? 1, et, R()),
        angle: value(d.angle ?? 0, et, R()) * DEG,
        frame: d.frames?.random ? Math.floor(R() * frames) : 0,
        r: R(),      // per-particle random for ranged curves
        seed: R(),   // offsets the noise lookup so particles don't share a dissolve pattern
      });
    }
  }

  /**
   * Per-particle look at its current age, written into out:
   *   size, angle, color [r, g, b, a], data [dissolve, scroll, glow, frame]
   */
  look(p, out) {
    const d = this.def, t = p.age / p.life;
    out.size = p.size * (d.sizeOverLife ? evalCurve(d.sizeOverLife, t) : 1);
    out.angle = p.angle;
    const c = out.color;
    if (d.colorOverLife) evalGradient(d.colorOverLife, t, c);
    else { const k = d.color || WHITE; c[0] = k[0]; c[1] = k[1]; c[2] = k[2]; }
    c[3] = (d.alpha ? evalCurve(d.alpha, t) : 1) * (d.opacity ?? 1);
    const D = out.data;
    D[0] = d.dissolve ? evalCurve(d.dissolve, t) : -1;   // -1: nothing dissolved
    D[1] = d.scroll ? evalCurve(d.scroll, t) : 0;
    D[2] = d.glow ? evalCurve(d.glow, t) : 0;
    if (d.frames) {
      const n = d.frames.cols * d.frames.rows;
      const step = d.frames.fps ? Math.floor(p.age * d.frames.fps) : Math.floor(t * n * (d.frames.cycles ?? 1));
      D[3] = (p.frame + step) % n;
    } else D[3] = 0;
    return out;
  }
}
