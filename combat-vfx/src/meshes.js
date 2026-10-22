// Procedural meshes for mesh particles. UV conventions match the textures in textures.js.
import * as THREE from 'three';

const cache = new Map();

/**
 * Flat crescent for sword swings, lying in the XZ plane around the origin.
 * u runs along the swing (from → to, degrees, 0 = +Z, 90 = +X), v runs from the inner to the outer radius.
 * The outer edge dips slightly so the blade reads as a shallow cone instead of a paper disc.
 */
export function arcGeometry({ inner = 1.1, outer = 2.1, from = -110, to = 110, segments = 48, dip = 0.18 } = {}) {
  const pos = [], uv = [], nrm = [], idx = [];
  for (let i = 0; i <= segments; i++) {
    const u = i / segments, th = THREE.MathUtils.degToRad(from + (to - from) * u);
    for (let j = 0; j <= 1; j++) {
      const r = j ? outer : inner;
      pos.push(Math.sin(th) * r, -j * dip, Math.cos(th) * r);
      uv.push(u, j);
      nrm.push(0, 1, 0);
    }
    if (i < segments) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

const GEN = {
  quad: () => new THREE.PlaneGeometry(1, 1),
  arc: () => arcGeometry(),
  // open tube, base at y = 0, unit radius and height (u around, v up)
  cylinder: () => new THREE.CylinderGeometry(1, 1, 1, 40, 1, true).translate(0, 0.5, 0),
  // open cone, wide at the top (impact flashes that flare upward)
  flare: () => new THREE.CylinderGeometry(1, 0.35, 1, 40, 1, true).translate(0, 0.5, 0),
  sphere: () => new THREE.SphereGeometry(1, 40, 24),
};

export function mesh(name) {
  if (!cache.has(name)) {
    if (!GEN[name]) throw new Error(`combat-vfx: unknown mesh "${name}"`);
    cache.set(name, GEN[name]());
  }
  return cache.get(name);
}
