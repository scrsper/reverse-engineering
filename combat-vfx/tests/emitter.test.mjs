import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Emitter, sampleShape } from '../src/core/emitter.js';
import { makeRandom, value, evalCurve, curve, evalGradient } from '../src/core/math.js';

const run = (def, seconds, seed = 42, dt = 1 / 120) => {
  const e = new Emitter(def, makeRandom(seed));
  for (let t = 0; t < seconds - 1e-9; t += dt) e.step(dt);
  return e;
};

test('curves and value specs', () => {
  assert.equal(evalCurve([[0, 1], [1, 0]], 0.25), 0.75);
  assert.equal(evalCurve([[0.2, 5], [0.8, 7]], 0), 5);    // held before the first key
  assert.equal(evalCurve([[0.2, 5], [0.8, 7]], 1), 7);    // and after the last
  assert.equal(value(3, 0.5, 0.9), 3);
  assert.equal(value([2, 4], 0, 0.5), 3);
  assert.equal(value(curve([[0, 1], [1, 0]], 10), 0.5, 0), 5);
  assert.deepEqual(evalGradient([[0, [1, 0, 0]], [1, [0, 0, 1]]], 0.5, [0, 0, 0]), [0.5, 0, 0.5]);
});

test('same seed replays identically, a different seed does not', () => {
  const def = { bursts: [[0, 20]], shape: { type: 'sphere', radius: 1 }, speed: [1, 5], life: [0.5, 1], gravity: 1, drag: 2 };
  const a = run(def, 0.3, 7).particles.map((p) => p.pos);
  const b = run(def, 0.3, 7).particles.map((p) => p.pos);
  const c = run(def, 0.3, 8).particles.map((p) => p.pos);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('bursts fire once at their time, respecting delay', () => {
  const e = new Emitter({ delay: 0.1, bursts: [[0, 3], [0.05, 2]], life: 5 }, makeRandom(1));
  for (let i = 0; i < 11; i++) e.step(1 / 120);   // 0.0917 s: still inside the delay
  assert.equal(e.particles.length, 0);
  for (let i = 0; i < 2; i++) e.step(1 / 120);    // past 0.1 s
  assert.equal(e.particles.length, 3);
  for (let i = 0; i < 12; i++) e.step(1 / 120);   // past 0.15 s
  assert.equal(e.particles.length, 5);
  for (let i = 0; i < 60; i++) e.step(1 / 120);
  assert.equal(e.particles.length, 5);            // no repeats for a one-shot
});

test('rate emission matches rate × duration and stops after duration', () => {
  const e = run({ rate: 40, duration: 0.5, life: 10, max: 500 }, 1);
  assert.ok(Math.abs(e.particles.length - 20) <= 1, `got ${e.particles.length}`);
});

test('looping emitters re-fire bursts every cycle', () => {
  const e = run({ loop: true, duration: 0.25, bursts: [[0, 2]], life: 10, max: 100 }, 1.01);
  assert.equal(e.particles.length, 10);   // cycles at 0, .25, .5, .75, 1.0
});

test('particles die at end of life and the emitter reports done', () => {
  const e = run({ bursts: [[0, 4]], life: 0.2 }, 0.19);
  assert.equal(e.particles.length, 4);
  assert.equal(e.done, false);
  for (let i = 0; i < 4; i++) e.step(1 / 120);
  assert.equal(e.particles.length, 0);
  assert.equal(e.done, true);
});

test('gravity: a particle dropped under 6 g falls ~6 m in 0.45 s (the hammer)', () => {
  const e = new Emitter({ bursts: [[0, 1]], life: 1, gravity: 6 }, makeRandom(1));
  e.step(1 / 120);
  const p = e.particles[0];
  for (let i = 1; i < 54; i++) e.step(1 / 120);
  // analytic 5.96 m; semi-implicit Euler at 120 Hz lands within ~2%
  assert.ok(Math.abs(p.pos[1] + 5.96) < 0.15, `fell to ${p.pos[1]}`);
});

test('sustained particles hold mid-life until stop(), then finish', () => {
  const e = new Emitter({ bursts: [[0, 1]], life: 1, sustain: 0.5 }, makeRandom(1));
  for (let i = 0; i < 600; i++) e.step(1 / 120);   // 5 s
  assert.equal(e.particles.length, 1);
  assert.ok(Math.abs(e.particles[0].age - 0.5) < 1e-9);
  e.stop();
  for (let i = 0; i < 61; i++) e.step(1 / 120);
  assert.equal(e.particles.length, 0);
});

test('spin integrates angular velocity (deg/s) over life', () => {
  const e = new Emitter({ bursts: [[0, 1]], life: 2, spin: 90 }, makeRandom(1));
  for (let i = 0; i < 120; i++) e.step(1 / 120);
  assert.ok(Math.abs(e.particles[0].angle - Math.PI / 2) < 1e-6);
});

test('shapes: hemisphere opens upward, tangent circle emits along the arc', () => {
  const R = makeRandom(3);
  for (let i = 0; i < 200; i++) assert.ok(sampleShape({ type: 'hemisphere', radius: 1 }, R)[1][1] >= 0);
  const [pos, dir] = sampleShape({ type: 'circle', radius: 2, edge: true, arc: [0, 0], tangent: 1 }, R);
  assert.deepEqual(pos.map((v) => +v.toFixed(6)), [0, 0, 2]);
  assert.deepEqual(dir.map((v) => +v.toFixed(6) + 0), [1, 0, 0]);
  const cone = sampleShape({ type: 'cone', axis: [0, 0, 1], angle: 10 }, R)[1];
  assert.ok(cone[2] > Math.cos((10 * Math.PI) / 180) - 1e-9);
});

test('look(): flipbook frames advance with fps and wrap', () => {
  const def = { bursts: [[0, 1]], life: 1, frames: { cols: 4, rows: 1, fps: 10 } };
  const e = run(def, 0.35);
  const out = { color: [0, 0, 0, 0], data: [0, 0, 0, 0] };
  assert.equal(e.look(e.particles[0], out).data[3], 3);
  for (let i = 0; i < 12; i++) e.step(1 / 120);
  assert.equal(e.look(e.particles[0], out).data[3], 0);
});
