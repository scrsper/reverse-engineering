// Effect recipes: each one is a stack of particle layers (see README for every field).
// layers(E, element) gets the element palette E = { core, main, deep } and returns the layer list,
// so all recipes exist in all six elements with the same timing.
//
// Local space: origin = where the effect is played, +Y up, +Z = forward (the attack direction).
import { curve, scale3 } from './core/math.js';
import { NEUTRAL } from './elements.js';

const fadeOut = [[0, 1], [1, 0]];
const popOut = [[0, 1], [0.6, 0.8], [1, 0]];
const shrink = [[0, 1], [1, 0]];
const quickIn = (k = 0.15) => [[0, 0], [k, 1], [1, 1]];

// ---------- building blocks reused across recipes ----------

const flash = (E, { at = 0, size = 3, life = 0.14, glow = 4, position, groundFade } = {}) => ({
  name: 'Flash', role: 'impact_flash', texture: 'glow', bursts: [[at, 1]], life, size, position, groundFade,
  sizeOverLife: [[0, 1], [1, 0.25]], color: E.core, glow: [[0, glow], [1, 0]],
});

const sparks = (E, o = {}) => ({
  name: 'Sparks', role: 'sparks', render: 'stretched', texture: 'spark', max: 48,
  bursts: [[o.at ?? 0, o.count ?? 16]], shape: o.shape ?? { type: 'sphere', radius: 0.1 }, position: o.position,
  speed: o.speed ?? [5, 20], drag: o.drag ?? 4.5, gravity: o.gravity ?? 1, life: o.life ?? [0.25, 0.55],
  size: o.size ?? [0.05, 0.1], sizeOverLife: [[0, 1], [0.4, 0.45], [1, 0]], stretch: 2.5, velStretch: 0.025,
  color: E.main, hot: [0.15, 0.6], intensity: 2.2,
});

const rays = (E, o = {}) => ({
  name: 'Burst streaks', role: 'burst_streaks', render: 'stretched', texture: 'spark',
  bursts: [[o.at ?? 0, o.count ?? 6]], shape: o.shape ?? { type: 'sphere', radius: 0.05 }, position: o.position,
  speed: [0.3, 1.2], life: o.life ?? [0.12, 0.25], size: o.size ?? [0.3, 0.55], stretch: 4,
  sizeOverLife: [[0, 0.6], [0.3, 1], [1, 0.8]], alpha: popOut, color: E.main, hot: [0.2, 0.7], intensity: 2.5,
});

const groundRing = (E, { at = 0, size = 6, life = 0.35, position = [0, 0.04, 0], glow = 1.2 } = {}) => ({
  name: 'Shockwave', role: 'shockwave_ring', render: 'flat', texture: 'ring', rotation: [-90, 0, 0], position,
  bursts: [[at, 1]], life, size, sizeOverLife: [[0, 0.25], [0.3, 0.85], [1, 1]], alpha: fadeOut,
  color: E.main, glow: [[0, glow], [1, 0]], hot: [0.5, 0.9],
});

const dustPuffs = ({ at = 0, count = 12, radius = 0.6, speed = [3, 9], size = [0.8, 1.6], life = [0.7, 1.3], position = [0, 0.25, 0], arc } = {}) => ({
  name: 'Smoke', role: 'smoke', texture: 'smoke', frames: { cols: 2, rows: 2, random: true }, blend: 'alpha',
  bursts: [[at, count]], shape: { type: 'circle', radius, edge: true, arc }, position, speed, drag: 3.5,
  life, size, sizeOverLife: [[0, 0.45], [1, 1.25]], angle: [0, 360], spin: [-60, 60],
  color: NEUTRAL.dust, alpha: [[0, 0.7], [1, 0]], hot: false, noise: 0.2, noiseScale: [1.5, 1.5],
  dissolve: [[0, -0.6], [0.5, -0.2], [1, 0.8]], soft: 0.45, groundFade: 0.25,
});

const crackle = (E, { at = 0, duration = 0.6, rate = 25, radius = 1.5, size = [0.5, 1.4], position = [0, 0.3, 0] } = {}) => ({
  name: 'Crackle', role: 'lightning_arcs', texture: 'lightning', frames: { cols: 4, rows: 1, fps: 30, random: true },
  delay: at, duration, rate: curve([[0, 1], [1, 0.2]], rate), shape: { type: 'circle', radius }, position,
  life: [0.06, 0.16], size, aspect: [0.35, 1, 1], angle: [0, 360], color: E.main, hot: [0.2, 0.6], intensity: 2.2,
});

/** The element's own flavour layer: flames, ice shards, arcs, glints, void wisps or bubbles. */
export function signature(E, element, { at = 0, s = 1, position } = {}) {
  switch (element) {
    case 'fire': return {
      name: 'Flames', role: 'flames', texture: 'smoke', frames: { cols: 2, rows: 2, random: true }, position,
      bursts: [[at, 8]], shape: { type: 'sphere', radius: 0.3 * s }, speed: [0.3, 1.5], velocity: [0, 2 * s, 0],
      life: [0.25, 0.5], size: [0.45 * s, 0.9 * s], sizeOverLife: [[0, 0.4], [0.3, 1], [1, 0.6]], angle: [0, 360],
      colorOverLife: [[0, E.core], [0.25, E.main], [1, E.deep]], hot: [0.35, 0.8], intensity: 1.6,
      dissolve: [[0, -0.3], [1, 0.9]], noise: 0.6, noiseScale: [2, 2], noisePan: [0, -1],
    };
    case 'ice': return {
      name: 'Shards', role: 'ice_shards', render: 'stretched', texture: 'shard', position,
      bursts: [[at, 9]], shape: { type: 'sphere', radius: 0.15 * s }, speed: [3 * s, 8 * s], drag: 4, gravity: 0.8,
      life: [0.35, 0.7], size: [0.12 * s, 0.22 * s], stretch: 4, sizeOverLife: [[0, 1], [0.7, 0.9], [1, 0]],
      colorOverLife: [[0, E.core], [1, E.main]], hot: [0.4, 0.9], intensity: 1.8,
    };
    case 'lightning': return {
      name: 'Arcs', role: 'lightning_arcs', texture: 'lightning', frames: { cols: 4, rows: 1, fps: 30, random: true }, position,
      bursts: [[at, 3], [at + 0.08, 3]], shape: { type: 'sphere', radius: 0.5 * s }, life: [0.08, 0.18],
      size: [0.7 * s, 1.4 * s], aspect: [0.35, 1, 1], angle: [0, 360], color: E.main, hot: [0.2, 0.6], intensity: 2.4,
    };
    case 'holy': return {
      name: 'Glints', role: 'sparkle', texture: 'star', position,
      bursts: [[at, 10]], shape: { type: 'sphere', radius: 0.2 * s }, speed: [1.5 * s, 4 * s], drag: 2.5, velocity: [0, 0.6, 0],
      life: [0.4, 0.8], size: [0.15 * s, 0.35 * s], sizeOverLife: shrink, color: E.main, hot: [0.3, 0.7], intensity: 2.5,
    };
    case 'dark': return {
      name: 'Void wisps', role: 'smoke', texture: 'smoke', frames: { cols: 2, rows: 2, random: true }, blend: 'alpha', position,
      bursts: [[at, 7]], shape: { type: 'sphere', radius: 0.25 * s }, speed: [0.5, 2 * s], drag: 2, velocity: [0, 0.6, 0],
      life: [0.4, 0.75], size: [0.5 * s, 1 * s], sizeOverLife: [[0, 0.5], [1, 1.2]], angle: [0, 360],
      color: scale3(E.deep, 0.35), alpha: [[0, 0.85], [1, 0]], hot: false, noise: 0.5, noiseScale: [2, 2],
      dissolve: [[0, -0.4], [1, 0.8]], soft: 0.3,
    };
    case 'poison': return {
      name: 'Bubbles', role: 'bubbles', texture: 'bubble', position,
      bursts: [[at, 10]], shape: { type: 'sphere', radius: 0.35 * s }, speed: [0.5, 2 * s], drag: 1.2, velocity: [0, 1.4, 0],
      life: [0.4, 0.8], size: [0.1 * s, 0.25 * s], sizeOverLife: [[0, 0.3], [0.2, 1], [1, 0.8]], alpha: popOut,
      color: E.main, hot: [0.5, 0.9], intensity: 1.6,
    };
  }
  return null;
}

const compact = (layers) => layers.filter(Boolean);

// ---------- recipes ----------

export const RECIPES = {
  /** Horizontal sword swing around the attacker (play at chest height; roll: 180 for the back-hand). */
  slash: {
    name: 'slash', duration: 0.6, place: 'chest',
    layers: (E, el) => compact([
      { // the blade crescent: spins fast and decelerates while the hot head wipes along the arc
        name: 'Arc core', role: 'slash_arc', render: 'mesh', mesh: 'arc', texture: 'slash',
        bursts: [[0, 1]], life: 0.3, size: 1, angle: -55, spin: curve([[0, 1], [1, 0]], 560),
        color: E.main, hot: [0.35, 0.8], intensity: 1.4, glow: [[0, 2.6], [1, 0]],
        scroll: [[0, -0.3], [1, 0.12]], dissolve: [[0, -1], [0.4, -0.25], [1, 1]], noise: 0.3, noiseScale: [3, 1], soft: 0.25,
      },
      { // a wider, noisier copy lagging behind gives the arc thickness and a smeared tail
        name: 'Arc trail', role: 'slash_arc', render: 'mesh', mesh: 'arc', texture: 'slash',
        delay: 0.02, bursts: [[0, 1]], life: 0.4, size: 1.08, angle: -70, spin: curve([[0, 1], [1, 0]], 420),
        color: E.deep, hot: [0.6, 1.1], intensity: 1.3, opacity: 0.85,
        scroll: [[0, -0.4], [1, 0]], dissolve: [[0, -0.5], [1, 1]], noise: 0.8, noiseScale: [4, 1], noisePan: [-2, 0], soft: 0.2,
      },
      { // fast wind streaks on top
        name: 'Wind', role: 'swirl_mesh', render: 'mesh', mesh: 'arc', texture: 'streak',
        delay: 0.03, bursts: [[0, 1]], life: 0.24, size: 1.12, aspect: [1, 1, 1], angle: -40, spin: curve([[0, 1], [1, 0]], 650),
        color: E.core, opacity: 0.55, hot: false, intensity: 1.5, pan: [-3, 0], edgeFade: [0.25, 0.1, 0.2, 0.2],
        dissolve: [[0, -0.3], [1, 0.9]],
      },
      sparks(E, { at: 0.05, count: 14, shape: { type: 'circle', radius: 1.9, edge: true, arc: [-40, 100], tangent: 1 }, speed: [6, 14], drag: 3, gravity: 0.6, life: [0.18, 0.4], size: [0.05, 0.11] }),
      {
        name: 'Embers', role: 'embers', texture: 'soft', bursts: [[0.05, 8]],
        shape: { type: 'circle', radius: 1.8, edge: true, arc: [-30, 90], tangent: 1 }, speed: [1, 3], velocity: [0, 1.2, 0], drag: 1,
        life: [0.4, 0.8], size: [0.05, 0.1], color: E.main, alpha: fadeOut, intensity: 3,
      },
      signature(E, el, { at: 0.06, s: 0.7, position: [0, 0, 1.6] }),
    ]),
  },

  /** Impact on a target (play at the target's chest, direction = attack direction). */
  hit: {
    name: 'hit', duration: 0.7, place: 'target',
    layers: (E, el) => compact([
      flash(E, { size: 3.2 }),
      {
        name: 'Burst', role: 'impact_flash', texture: 'burst', bursts: [[0, 1]], life: 0.22, size: 2.6, angle: [0, 360],
        sizeOverLife: [[0, 0.35], [0.2, 0.85], [1, 1]], color: E.main, hot: [0.4, 0.85], intensity: 1.6,
        dissolve: [[0, -0.5], [1, 1]], noise: 0.4, noiseScale: [2, 2],
      },
      { // thin cut line across the target
        name: 'Cut', role: 'slash_line', texture: 'line', bursts: [[0, 1]], life: 0.2, size: 3.2, aspect: [1, 0.16, 1],
        angle: [-25, 25], sizeOverLife: [[0, 0.2], [0.15, 1], [1, 1.1]], alpha: [[0, 1], [0.6, 1], [1, 0]],
        color: E.main, glow: [[0, 3], [1, 0]], hot: [0.3, 0.7],
      },
      rays(E, { count: 6 }),
      sparks(E, { count: 16, shape: { type: 'cone', axis: [0, 0, 1], angle: 70, radius: 0.1 }, speed: [5, 22] }),
      { // wind tunnels pushed through the target along the hit direction
        name: 'Swirl', role: 'swirl_mesh', render: 'mesh', mesh: 'cylinder', texture: 'streak', swapUV: true,
        rotation: [90, 0, 0], position: [0, 0, -0.4], bursts: [[0.03, 2]], life: [0.25, 0.4],
        size: [0.55, 0.8], aspect: [1, 2.2, 1], sizeOverLife: [[0, 0.4], [1, 1]], angle: [0, 360], spin: [200, 400],
        color: E.main, opacity: 0.8, hot: [0.6, 1], intensity: 1.3, pan: [0, -3], edgeFade: [0, 0, 0.35, 0.35],
        dissolve: [[0, -0.2], [1, 1]],
      },
      { // ring perpendicular to the hit direction
        name: 'Ring', role: 'shockwave_ring', render: 'flat', texture: 'ring', bursts: [[0, 1]], life: 0.2, size: 2.2,
        sizeOverLife: [[0, 0.3], [1, 1]], alpha: fadeOut, color: E.main, glow: [[0, 1], [1, 0]],
      },
      signature(E, el, { at: 0.02 }),
    ]),
  },

  /** Lightning strike from the sky (play on the ground at the target point). */
  thunder: {
    name: 'thunder', duration: 0.9, place: 'ground',
    layers: (E, el) => compact([
      {
        name: 'Bolt', role: 'lightning_bolt', render: 'axial', texture: 'lightning', frames: { cols: 4, rows: 1, fps: 24, random: true },
        bursts: [[0, 1]], life: 0.38, size: 1, aspect: [2.2, 11, 1], pivot: [0, 0.5],
        color: E.main, hot: [0.12, 0.5], intensity: 2.5, glow: [[0, 3], [0.3, 1], [1, 0]],
        alpha: [[0, 1], [0.15, 0.35], [0.3, 1], [0.5, 0.25], [0.7, 0.8], [1, 0]],   // strobe flicker
      },
      {
        name: 'Bolt echo', role: 'lightning_bolt', render: 'axial', texture: 'lightning', frames: { cols: 4, rows: 1, fps: 30, random: true },
        delay: 0.1, bursts: [[0, 1]], shape: { type: 'box', size: [0.8, 0, 0.8] }, life: 0.3, size: 1, aspect: [1.8, 10, 1], pivot: [0, 0.5],
        color: E.main, hot: [0.15, 0.5], intensity: 2, alpha: [[0, 1], [0.3, 0.3], [0.5, 1], [1, 0]],
      },
      // big camera-facing glows fade out toward y = 0 instead of being cut by the floor
      { name: 'Sky glow', role: 'glow', texture: 'glow', position: [0, 1.5, 0], bursts: [[0, 1]], life: 0.45, size: 9, color: E.deep, alpha: fadeOut, intensity: 1.2, hot: false, groundFade: 1.5 },
      flash(E, { size: 4, life: 0.22, glow: 3, position: [0, 0.5, 0], groundFade: 0.6 }),
      { name: 'Ground glow', role: 'glow', render: 'flat', texture: 'glow', rotation: [-90, 0, 0], position: [0, 0.03, 0], bursts: [[0, 1]], life: 0.6, size: 5, color: E.main, alpha: fadeOut, intensity: 1.5 },
      rays(E, { at: 0.07, count: 5, shape: { type: 'hemisphere', radius: 0.1 }, size: [1.2, 2], life: [0.15, 0.3] }),
      sparks(E, { at: 0.09, count: 20, shape: { type: 'hemisphere', radius: 0.2 }, speed: [8, 28], gravity: 1.5 }),
      crackle(E, { duration: 0.7, rate: 25, radius: 1.6 }),
      signature(E, el, { at: 0.05, position: [0, 0.4, 0] }),
    ]),
  },

  /** Ground impact under a strike (play on the ground, ~0.12 s after 'thunder'). */
  thunderImpact: {
    name: 'thunderImpact', duration: 1.4, place: 'ground',
    layers: (E) => compact([
      groundRing(E, { size: 5, life: 0.45 }),
      {
        name: 'Scorch', role: 'ground_crack', render: 'flat', texture: 'crack', fieldFromG: true, rotation: [-90, 0, 0], position: [0, 0.02, 0],
        bursts: [[0, 1]], life: 1.4, size: 3.4, angle: [0, 360], soft: 0.08,
        dissolve: [[0, 1], [0.1, 0], [1, 0]], alpha: [[0, 1], [0.7, 0.7], [1, 0]],
        colorOverLife: [[0, E.core], [0.15, E.main], [1, E.deep]], glow: [[0, 2], [0.4, 0]], hot: [0.5, 0.9],
      },
      dustPuffs({ count: 9, radius: 0.5, speed: [2, 5], size: [0.6, 1.2], life: [0.5, 0.9] }),
      crackle(E, { at: 0.05, duration: 0.6, rate: 12, radius: 1.2 }),
    ]),
  },

  /** Giant hammer falls from the sky and slams the ground 3 m ahead (impact at 0.45 s). */
  hammer: {
    name: 'hammer', duration: 3.2, place: 'feet', impactAt: 0.45, impactAhead: 3,
    layers: (E, el) => {
      const at = 0.45, P = (y = 0) => [0, y, 3];
      return compact([
        { name: 'Portal glow', role: 'glow', texture: 'glow', position: P(6.6), bursts: [[0, 1]], life: 0.55, size: 4, color: E.main, alpha: [[0, 0], [0.2, 1], [1, 0]], intensity: 1.6 },
        { // falls 6 m in 0.45 s under ~6 g, bottom of the quad (the hammer head) on the particle
          name: 'Hammer', role: 'hammer', render: 'axial', texture: 'hammer', shade: true, position: P(6),
          bursts: [[0, 1]], life: at, size: 1, aspect: [2.2, 3.3, 1], pivot: [0, 0.5], gravity: 6,
          color: E.main, hot: [0.85, 1.3], intensity: 1.6, alpha: quickIn(0.2), glow: [[0, 0.4], [1, 1.2]],
        },
        {
          name: 'Fall streak', role: 'trail', render: 'stretched', texture: 'spark', position: P(6.4),
          bursts: [[0, 1]], life: at, size: 1.1, stretch: 0, velStretch: 0.1, pivot: [0, -0.5], gravity: 6,
          color: E.main, alpha: quickIn(0.3), intensity: 1.5,
        },
        { // the planted hammer shatters away after the slam
          name: 'Planted hammer', role: 'hammer', render: 'axial', texture: 'hammer', shade: true, position: P(-0.25),
          delay: at, bursts: [[0, 1]], life: 1.3, size: 1, aspect: [2.2, 3.3, 1], pivot: [0, 0.5],
          color: E.main, hot: [0.85, 1.3], intensity: 1.6, glow: [[0, 2], [0.15, 0.4], [1, 0]],
          dissolve: [[0, -0.6], [0.55, -0.2], [1, 1]], noise: 0.5, noiseScale: [2, 3], soft: 0.12,
        },
        { // flaring tube of light at the impact
          name: 'Impact pillar', role: 'impact_flash', render: 'mesh', mesh: 'flare', texture: 'pillar', position: P(0),
          delay: at, bursts: [[0, 1]], life: 0.24, size: 1, aspect: [1.6, 3.4, 1.6], sizeOverLife: [[0, 0.2], [0.25, 0.85], [1, 1]],
          color: E.main, hot: [0.5, 0.9], intensity: 1.1, glow: [[0, 1.5], [1, 0]], pan: [0.6, 0], edgeFade: [0, 0, 0, 0.4],
          dissolve: [[0, -0.4], [1, 1]], noise: 0.3, noiseScale: [3, 1],
        },
        { ...flash(E, { size: 4.5, life: 0.16, glow: 2, position: P(0.6), groundFade: 0.6 }), delay: at },
        { ...groundRing(E, { size: 9, life: 0.38, position: P(0.05), glow: 0.6 }), delay: at },
        {
          name: 'Crack', role: 'ground_crack', render: 'flat', texture: 'crack', fieldFromG: true, rotation: [-90, 0, 0], position: P(0.03),
          delay: at, bursts: [[0, 1]], life: 3, size: 7, angle: [0, 360], soft: 0.06,
          dissolve: [[0, 1], [0.05, 0], [1, 0]], alpha: [[0, 1], [0.75, 0.8], [1, 0]],
          colorOverLife: [[0, E.core], [0.12, E.main], [1, E.deep]], glow: [[0, 1.5], [0.2, 0.3], [1, 0]], hot: [0.5, 0.9],
        },
        {
          name: 'Rocks', role: 'debris_rock', texture: 'rock', frames: { cols: 2, rows: 2, random: true }, blend: 'alpha', shade: true, position: P(0.2),
          delay: at + 0.05, bursts: [[0, 16]], shape: { type: 'cone', axis: [0, 1, 0], angle: 45, radius: 0.6 }, speed: [6, 13], gravity: 2.2,
          life: [0.9, 1.4], size: [0.25, 0.55], sizeOverLife: [[0, 1], [0.85, 0.9], [1, 0]], angle: [0, 360], spin: [-400, 400],
          color: NEUTRAL.rock, hot: false, intensity: 1.3,
        },
        { ...dustPuffs({ count: 14, radius: 0.8, speed: [4, 11], size: [0.9, 1.8], life: [0.8, 1.5], position: P(0.3) }), delay: at },
        { ...sparks(E, { count: 26, shape: { type: 'hemisphere', radius: 0.3 }, speed: [3, 22], drag: 3.5, gravity: 0.4, life: [0.5, 1.1], size: [0.12, 0.3], position: P(0.3) }),
          name: 'Sparkles', role: 'sparkle', render: 'billboard', texture: 'star', delay: at, sizeOverLife: shrink, intensity: 2.5 },
        { ...rays(E, { count: 8, shape: { type: 'hemisphere', radius: 0.1 }, size: [2, 3], life: [0.2, 0.3], position: P(0.2) }), delay: at },
        { ...crackle(E, { duration: 1.5, rate: 30, radius: 3, position: P(0.3) }), delay: at + 0.05 },
        {
          name: 'Afterglow', role: 'sparkle', texture: 'star', position: P(0.2), delay: at + 1.4, duration: 0.6, rate: 20,
          shape: { type: 'box', size: [3, 0.2, 3] }, velocity: [0, 0.8, 0], life: [0.6, 1.2], size: [0.08, 0.2],
          sizeOverLife: shrink, color: E.main, hot: [0.3, 0.7], intensity: 2.5,
        },
        { ...signature(E, el, { s: 1.6, position: P(0.4) }), delay: at },
      ]);
    },
  },

  /** Protective bubble on the caster. Loops until stop(), then plays its outro. */
  shield: {
    name: 'shield', duration: Infinity, place: 'attach',
    layers: (E) => [
      { // fresnel rim: bright where the surface turns away from the camera, clear in the middle
        name: 'Bubble', role: 'shield', render: 'mesh', mesh: 'sphere', texture: 'solid', position: [0, 1, 0],
        bursts: [[0, 1]], life: 1.2, sustain: 0.5, size: 1.35, sizeOverLife: [[0, 0.6], [0.25, 1.05], [0.5, 1], [1, 1.25]],
        alpha: [[0, 0], [0.2, 1], [0.5, 1], [1, 0]], fresnel: 2.5, color: E.main, hot: [0.6, 1], intensity: 1.4,
        noise: 0.5, noiseScale: [4, 2], noisePan: [0.05, 0.12],
      },
      { // energy bands flowing around it
        name: 'Bubble bands', role: 'shield', render: 'mesh', mesh: 'sphere', texture: 'streak', position: [0, 1, 0],
        bursts: [[0, 1]], life: 1.2, sustain: 0.5, size: 1.37, sizeOverLife: [[0, 0.6], [0.25, 1.05], [0.5, 1], [1, 1.25]],
        alpha: [[0, 0], [0.2, 0.7], [0.5, 0.7], [1, 0]], fresnel: 1.2, color: E.main, hot: false, intensity: 1.2, pan: [0.15, 0],
      },
      {
        name: 'Rune circle', role: 'rune', render: 'flat', texture: 'rune', rotation: [-90, 0, 0], position: [0, 0.03, 0],
        bursts: [[0, 1]], life: 1.2, sustain: 0.5, size: 3.2, sizeOverLife: [[0, 0.5], [0.25, 1], [1, 1.1]], spin: 40,
        alpha: [[0, 0], [0.2, 1], [0.5, 1], [1, 0]], color: E.main, hot: [0.5, 1], intensity: 1.6,
      },
      groundRing(E, { size: 4.5, life: 0.5 }),
      { ...sparks(E, { count: 30, shape: { type: 'circle', radius: 1.2, edge: true }, speed: [2, 6], drag: 3, gravity: 0, life: [0.5, 1], size: [0.1, 0.22], position: [0, 0.3, 0] }),
        name: 'Intro glints', role: 'sparkle', render: 'billboard', texture: 'star', sizeOverLife: shrink },
      {
        name: 'Motes', role: 'sparkle', texture: 'star', loop: true, duration: 1, rate: 14,
        shape: { type: 'circle', radius: 1.2 }, velocity: [0, 1.2, 0], life: [0.8, 1.6], size: [0.06, 0.14],
        sizeOverLife: [[0, 0], [0.2, 1], [1, 0]], color: E.main, hot: [0.3, 0.7], intensity: 2.5,
      },
    ],
  },

  /** Power-up aura around the caster. Loops until stop(). */
  aura: {
    name: 'aura', duration: Infinity, place: 'attach',
    layers: (E, el) => compact([
      {
        name: 'Ground glow', role: 'glow', render: 'flat', texture: 'glow', rotation: [-90, 0, 0], position: [0, 0.03, 0],
        bursts: [[0, 1]], life: 1, sustain: 0.5, size: 2.8, alpha: [[0, 0], [0.2, 1], [0.5, 1], [1, 0]], color: E.main, intensity: 1.4,
      },
      {
        name: 'Wisps', role: 'flames', texture: 'smoke', frames: { cols: 2, rows: 2, random: true }, loop: true, duration: 1, rate: 22,
        shape: { type: 'circle', radius: 0.55 }, speed: [0, 0.4], velocity: [0, 2.2, 0], life: [0.4, 0.8], size: [0.35, 0.7],
        sizeOverLife: [[0, 1], [1, 0.2]], angle: [0, 360], spin: [-90, 90],
        colorOverLife: [[0, E.core], [0.3, E.main], [1, E.deep]], hot: [0.4, 0.9], intensity: 1.4,
        noise: 0.5, noiseScale: [2, 2], noisePan: [0, -1], dissolve: [[0, -0.4], [1, 0.8]],
      },
      {
        name: 'Rising sparks', role: 'sparks', render: 'stretched', texture: 'spark', loop: true, duration: 1, rate: 14,
        shape: { type: 'circle', radius: 0.7 }, speed: [0, 0.5], velocity: [0, 4, 0], life: [0.3, 0.6], size: [0.04, 0.07],
        stretch: 2, velStretch: 0.04, color: E.main, hot: [0.2, 0.6], intensity: 2.5, alpha: fadeOut,
      },
      el === 'holy' || el === 'lightning' ? { ...crackle(E, { duration: 1, rate: 6, radius: 0.7, size: [0.4, 0.9], position: [0, 0.8, 0] }), loop: true } : null,
    ]),
  },

  /** Ground dust kick for dashes, landings and deaths (neutral color). */
  dust: {
    name: 'dust', duration: 0.6, place: 'feet',
    layers: () => [
      dustPuffs({ count: 7, radius: 0.3, speed: [2, 5], size: [0.4, 0.9], life: [0.35, 0.6], position: [0, 0.15, 0], arc: [110, 250] }),
      {
        name: 'Dust ring', role: 'smoke', render: 'flat', texture: 'ring', blend: 'alpha', rotation: [-90, 0, 0], position: [0, 0.03, 0],
        bursts: [[0, 1]], life: 0.3, size: 1.6, sizeOverLife: [[0, 0.3], [1, 1]], color: NEUTRAL.dust, alpha: [[0, 0.6], [1, 0]], hot: false,
      },
    ],
  },
};

export const RECIPE_NAMES = Object.keys(RECIPES);
