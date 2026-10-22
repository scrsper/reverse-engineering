// Runtime: turns recipe layers into instanced draw calls and plays them.
//
//   const vfx = new VFX(scene);
//   vfx.play('slash', { position, direction, element: 'ice' });
//   // every frame:
//   vfx.update(dt);
import * as THREE from 'three';
import { Emitter } from './core/emitter.js';
import { makeRandom } from './core/math.js';
import { VERTEX, FRAGMENT } from './shaders.js';
import { texture } from './textures.js';
import { mesh } from './meshes.js';
import { ELEMENTS } from './elements.js';
import { RECIPES } from './recipes.js';

const STEP = 1 / 120;      // fixed simulation step: playback is identical at any frame rate
const MAX_FRAME = 0.25;    // never simulate more than this per update (tab switches, hitches)
const DEG = Math.PI / 180;
const MODES = { billboard: 0, stretched: 1, axial: 2, mesh: 3, flat: 3 };
const ATTRS = [['iPos', 3], ['iVel', 3], ['iSize', 2], ['iRot', 4], ['iColor', 4], ['iData', 4]];
const _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _dir = new THREE.Vector3();

function makeMaterial(L, E, shared) {
  const additive = (L.blend ?? 'add') === 'add';
  const v2 = (a, d) => ({ value: new THREE.Vector2(...(a || d)) });
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    defines: { MODE: MODES[L.render ?? 'billboard'], ...(additive ? { ADDITIVE: '' } : {}) },
    uniforms: {
      uMain: { value: texture(L.texture || 'glow') }, uNoise: { value: texture('noise') },
      uHot: { value: new THREE.Vector3(...(L.hotColor || E.core)) },
      uRamp: v2(L.hot === false ? null : L.hot, L.hot === false ? [9, 10] : [0.6, 1]),
      uIntensity: { value: L.intensity ?? 1 }, uMaster: shared.master, uTime: shared.time,
      uScrollAxis: v2(L.scrollAxis, [1, 0]), uPan: v2(L.pan, [0, 0]),
      uNoiseScale: v2(L.noiseScale, [1, 1]), uNoisePan: v2(L.noisePan, [0, 0]),
      uNoiseAmt: { value: L.noise ?? 0 }, uSoft: { value: L.soft ?? 0.15 }, uFresnel: { value: L.fresnel ?? 0 },
      uGroundFade: { value: L.groundFade ?? 0 }, uFieldFromG: { value: L.fieldFromG ? 1 : 0 },
      uShade: { value: L.shade ? 1 : 0 }, uSwap: { value: L.swapUV ? 1 : 0 },
      uEdgeFade: { value: new THREE.Vector4(...(L.edgeFade || [0, 0, 0, 0])) },
      uAspect: { value: new THREE.Vector3(...(L.aspect || [1, 1, 1])) }, uPivot: v2(L.pivot, [0, 0]),
      uFrames: v2(L.frames && [L.frames.cols, L.frames.rows], [1, 1]),
      uScale: { value: 1 }, uStretch: { value: L.stretch ?? 1 }, uVelStretch: { value: L.velStretch ?? 0 },
    },
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendSrc: additive ? THREE.OneFactor : THREE.SrcAlphaFactor,
    blendDst: additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
}

/**
 * One playing effect: a THREE.Group you can move, rotate or parent like any object.
 * Fires a 'finished' event once every layer has emitted everything and its last particle died
 * (looping effects only finish after stop()).
 */
export class Effect extends THREE.Group {
  constructor(name, layers, { element, seed, time }) {
    super();
    this.name = name;
    this.element = element;
    this.random = makeRandom(seed);
    this.seed = seed;
    this.master = { value: 1 };
    this.tempo = 1;
    this.t = 0; this.clock = 0;
    this.playing = false; this.finished = false;
    this.autoDispose = true;
    this._look = { size: 0, angle: 0, color: [0, 0, 0, 0], data: [0, 0, 0, 0] };
    const E = ELEMENTS[element];
    this.parts = layers.map((L, i) => {
      const base = mesh(L.render === 'mesh' ? L.mesh : 'quad');
      const geo = new THREE.InstancedBufferGeometry();
      // own copies of the base buffers, so disposing this effect never frees buffers another effect still draws
      geo.setIndex(base.index.clone());
      for (const k in base.attributes) geo.setAttribute(k, base.attributes[k].clone());
      const emitter = new Emitter(L, this.random);
      const A = {};
      for (const [k, n] of ATTRS) {
        const a = new THREE.InstancedBufferAttribute(new Float32Array(emitter.max * n), n);
        a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(k, a); A[k] = a;
      }
      geo.instanceCount = 0;
      const mat = makeMaterial(L, E, { master: this.master, time });
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      m.renderOrder = (L.order ?? 0) * 100 + i;
      m.name = L.name || `layer ${i}`;
      const holder = new THREE.Group();   // the layer's own transform: offset and orientation
      if (L.position) holder.position.fromArray(L.position);
      if (L.rotation) holder.rotation.set(L.rotation[0] * DEG, L.rotation[1] * DEG, L.rotation[2] * DEG);
      holder.add(m); this.add(holder);
      const axis = new THREE.Vector3(...(L.spinAxis || (L.render === 'flat' ? [0, 0, 1] : [0, 1, 0]))).normalize();
      return { L, emitter, mesh: m, geo, A, mat, axis, quat: MODES[L.render] === 3, viewBuilt: MODES[L.render ?? 'billboard'] !== 3 };
    });
  }

  play() {
    this.random.reset(this.seed);
    for (const l of this.parts) l.emitter.reset();
    this.t = 0; this.clock = 0; this.playing = true; this.finished = false;
    this._write();
    return this;
  }

  /** Stop emitting; live particles finish naturally, sustained layers play their outro. */
  stop() { for (const l of this.parts) l.emitter.stop(); return this; }

  /** intensity (brightness multiplier), tempo (playback speed), scale (uniform size) */
  set({ intensity, tempo, scale } = {}) {
    if (intensity != null) this.master.value = intensity;
    if (tempo != null) this.tempo = tempo;
    if (scale != null) this.scale.setScalar(scale);
    return this;
  }

  update(dt) {
    if (!this.playing) return;
    this.clock += Math.min(dt, MAX_FRAME) * this.tempo;
    while (this.t + STEP <= this.clock + 1e-9) {
      this.t += STEP;
      for (const l of this.parts) l.emitter.step(STEP);
    }
    this._write();
    if (this.parts.every((l) => l.emitter.done)) {
      this.finished = true; this.playing = false;
      this.dispatchEvent({ type: 'finished' });
    }
  }

  _write() {
    const st = this._look;
    for (const l of this.parts) {
      const { A, emitter } = l, ps = emitter.particles, n = ps.length;
      if (l.viewBuilt) { l.mesh.getWorldScale(_s); l.mat.uniforms.uScale.value = _s.x; }   // view-space quads ignore the model scale
      const P = A.iPos.array, V = A.iVel.array, S = A.iSize.array, Q = A.iRot.array, C = A.iColor.array, D = A.iData.array;
      for (let i = 0; i < n; i++) {
        const p = ps[i];
        emitter.look(p, st);
        P[i * 3] = p.pos[0]; P[i * 3 + 1] = p.pos[1]; P[i * 3 + 2] = p.pos[2];
        V[i * 3] = p.vel[0]; V[i * 3 + 1] = p.vel[1]; V[i * 3 + 2] = p.vel[2];
        S[i * 2] = st.size; S[i * 2 + 1] = p.seed;
        if (l.quat) {
          _q.setFromAxisAngle(l.axis, st.angle);
          Q[i * 4] = _q.x; Q[i * 4 + 1] = _q.y; Q[i * 4 + 2] = _q.z; Q[i * 4 + 3] = _q.w;
        } else Q[i * 4] = st.angle;
        for (let k = 0; k < 4; k++) { C[i * 4 + k] = st.color[k]; D[i * 4 + k] = st.data[k]; }
      }
      for (const k in A) A[k].needsUpdate = true;
      l.geo.instanceCount = n;
    }
  }

  dispose() {
    for (const l of this.parts) { l.geo.dispose(); l.mat.dispose(); }
    this.parts.length = 0;
    this.removeFromParent();
  }
}

/** Position / orient an object: local +Z is turned toward `direction` (flattened onto the ground). */
export function place(obj, o) {
  if (o.position) Array.isArray(o.position) ? obj.position.fromArray(o.position) : obj.position.copy(o.position);
  let yaw = 0;
  if (o.direction) {
    _dir.copy(o.direction); _dir.y = 0;
    if (_dir.lengthSq() > 1e-10) yaw = Math.atan2(_dir.x, _dir.z);
  }
  obj.rotation.set((o.pitch || 0) * DEG, yaw + (o.yaw || 0) * DEG, (o.roll || 0) * DEG, 'YXZ');
  return obj;
}

export class VFX {
  constructor(scene, { element = 'fire' } = {}) {
    this.scene = scene;
    this.element = element;
    this.live = new Set();
    this.time = { value: 0 };
  }

  /**
   * Spawn an effect.
   *   name       recipe name (see RECIPES) or { name, layers(E, element) }
   *   position   Vector3 | [x, y, z]
   *   direction  Vector3: the effect's forward (+Z) is turned toward it
   *   yaw, pitch, roll   extra rotation in degrees (roll: 180 mirrors a swing into a back-hand)
   *   element    'fire' | 'ice' | 'lightning' | 'holy' | 'dark' | 'poison' (default: this.element)
   *   parent     object to attach to (follows it). Default: the scene.
   *   intensity, tempo, scale   see Effect.set
   *   seed       fixed seed for a repeatable look
   *   autoDispose  free the effect when it finishes (default true)
   */
  play(name, o = {}) {
    const recipe = typeof name === 'string' ? RECIPES[name] : name;
    if (!recipe) throw new Error(`combat-vfx: unknown effect "${name}"`);
    const element = o.element ?? this.element;
    const fx = new Effect(recipe.name, recipe.layers(ELEMENTS[element], element), {
      element, seed: o.seed ?? 1 + Math.floor(Math.random() * 2 ** 31), time: this.time,
    });
    place(fx, o);
    (o.parent || this.scene).add(fx);
    fx.set(o);
    fx.autoDispose = o.autoDispose ?? true;
    fx.play();
    this.live.add(fx);
    return fx;
  }

  /** Advance every live effect. dt in seconds (pass 0 during a hit-stop to freeze them). */
  update(dt) {
    this.time.value += dt;
    for (const fx of this.live) {
      fx.update(dt);
      if (fx.finished && fx.autoDispose) { fx.dispose(); this.live.delete(fx); }
    }
  }

  stopAll() { for (const fx of this.live) fx.stop(); }

  clear() { for (const fx of this.live) fx.dispose(); this.live.clear(); }
}
