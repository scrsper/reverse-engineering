// Game-feel helpers that sell an impact alongside the VFX.
import * as THREE from 'three';
import { periodicNoise } from './core/math.js';

/**
 * Trauma-based camera shake: add trauma on impact (0..1), the offset scales with trauma² and uses
 * smooth noise instead of white noise, so small hits barely move and big ones kick hard without jitter.
 */
export class CameraShake {
  constructor({ maxOffset = 0.6, maxRoll = 0.04, decay = 1.6, frequency = 18 } = {}) {
    Object.assign(this, { maxOffset, maxRoll, decay, frequency });
    this.trauma = 0; this.t = 0;
    this.offset = new THREE.Vector3(); this.roll = 0;
  }
  add(amount) { this.trauma = Math.min(1, this.trauma + amount); }
  /** Advance and return the offset to add to the camera position this frame. */
  update(dt) {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - this.decay * dt);
    const k = this.trauma * this.trauma, f = this.t * this.frequency;
    const n = (seed) => periodicNoise(f, seed, 1e6, 64, seed) * 2 - 1;
    this.offset.set(n(1) * this.maxOffset * k, n(2) * this.maxOffset * k * 0.6, n(3) * this.maxOffset * k);
    this.roll = n(4) * this.maxRoll * k;
    return this.offset;
  }
}

/**
 * Hit-stop: freeze gameplay time for a few frames on impact. Feed real dt through scale() and use the
 * result for characters (and VFX if you want them to freeze too). Overlapping requests keep the longest.
 */
export class HitStop {
  constructor() { this.left = 0; }
  trigger(seconds) { this.left = Math.max(this.left, seconds); }
  get active() { return this.left > 0; }
  scale(dt) {
    if (this.left <= 0) return dt;
    const frozen = Math.min(this.left, dt);
    this.left -= frozen;
    return dt - frozen;
  }
}

/** Short white flash on a hit mesh (MeshStandardMaterial): call update(dt) every frame. */
export class HitFlash {
  constructor(material, { duration = 0.15, strength = 6 } = {}) {
    Object.assign(this, { material, duration, strength });
    this.left = 0;
  }
  trigger() { this.left = this.duration; }
  update(dt) {
    this.left = Math.max(0, this.left - dt);
    const k = (this.left / this.duration) * this.strength;
    this.material.emissive.setRGB(k, k, k);
  }
}
