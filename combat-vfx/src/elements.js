// Element palettes. Recipes only ask for slots (core / main / deep), so every effect exists in all six
// elements with identical timing and silhouette: a recolor is a palette swap, not a separate effect.
import { hex } from './core/math.js';

const P = (core, main, deep, ui) => ({ core: hex(core), main: hex(main), deep: hex(deep), ui });

export const ELEMENTS = {
  fire: P('#fff3cf', '#ff7a1f', '#c42a0a', '#ff8a3d'),
  ice: P('#f0fcff', '#5cc8ff', '#1f58d6', '#7fd6ff'),
  lightning: P('#f4f7ff', '#86a8ff', '#3b3cff', '#9fb4ff'),
  holy: P('#fffbea', '#ffd45c', '#ff9a26', '#ffd45c'),
  dark: P('#f2dcff', '#a052ff', '#3c0d72', '#b07bff'),
  poison: P('#f5ffd8', '#8fe03a', '#2a8a2a', '#9be35a'),
};

export const ELEMENT_NAMES = Object.keys(ELEMENTS);

/** Neutral colors that do not follow the element. */
export const NEUTRAL = { dust: hex('#9a8f84'), rock: hex('#8a7c70'), white: [1, 1, 1] };
