# How "hun0fx Stylized Combat VFX — Web Demo" works

Target: <https://hun0fx.itch.io/combat-vfx-demo> (free itch.io web demo of a paid VFX asset pack, build `html/19578060`, examined 2026-10-22).

> **Licensing.** The page says: *"The effects and textures in this demo are for preview only and may not be reused or redistributed."*
> This document describes **how** the effects are built: architecture, techniques, timings and numbers observed in the build.
> None of the pack's textures, meshes, effect files or code are included in this repository. The implementation in
> [`src/`](src/) is written from scratch with procedurally generated textures. If you want the original
> art itself, buy the full pack from the author.

## 1. Method

The investigation followed the [REA](https://github.com/morluto/rea) workflow: identify the target, inspect its shipped artifacts statically, trace the code that implements the feature, and report evidence and unknowns.

1. **Target identification.** The itch.io page embeds `html-classic.itch.zone/html/19578060/index.html`. Its page tags name it a three.js build (also tagged Unity / Godot because the pack ships for those engines).
2. **Artifact inventory.** The build is plain, **unminified ES modules** loaded through an import map: `src/{index,library,effect,sim,material,shaders,post}.js`, `common.js`, four pages (`home`, `index` = gallery, `play`, `combat`), `manifest.json`, `listing.json`, and per-effect data under `fx/`, `textures/`, `meshes/`. Nothing was executed; files were fetched and read as text.
3. **REA static analysis.** `rea analyze-javascript-application` on the mirrored build (provider `rea-javascript-application` v1, authority *shipped-artifact*, confidence *derived*) parsed 8 JS files / 14 626 AST nodes with 0 parse failures and recovered the module graph:
   `common.js → src/index.js → {library, effect, post, sim}`, `library → effect`, `effect → {material, sim, three}`, `material → {shaders, sim}`. Network endpoints: `library.js` (`fetch(baseUrl + path)`: manifest, effect files, meshes) and `common.js` (`./listing.json`). REA's stated limitation is that it does not analyze inline `<script>` bodies in the HTML pages, so the game logic in `play.html` / `combat.html` / `index.html` was read by hand.
4. **Data sampling.** Seven representative effect definitions were decoded with a small summarizer (layer name, role, timing, render mode, shader keywords): `Slash_fire`, `Hit_01_Fire`, `Skill_Thunder`, `Skill_HolyJustice`, `Slash_Hit_fire`, `Slash_dust_01`, `Skill_DivineShield`.

## 2. Architecture

```
Unity (authoring)                      three.js (runtime in the demo)
───────────────────                    ────────────────────────────────────────────────
ParticleSystem prefabs  ──export──▶  fx/<id>.json      one JSON per effect: emitters[] with Shuriken modules
SH_HunFX_* shaders      ──port───▶  shaders.js        GLSL ports of the custom Unity shaders
Textures / meshes       ──export──▶  textures/*.webp, meshes/*.json
                                     sim.js            Shuriken subset in plain JS (no three.js), Unity space
                                     effect.js         one THREE.Group per playing effect, one instanced mesh per emitter
                                     library.js        loader + play()/update() + placement presets
                                     post.js           HDR target → bloom → Neutral tonemap → vignette
```

Key observations:

- **It is a converter, not a hand-authored three.js system.** Effects were authored as Unity Shuriken particle systems and exported to JSON. The runtime is a port of the subset of Shuriken the pack uses. Coordinates stay in Unity's left-handed space in the simulation and are flipped (`z → -z`) only when writing GPU buffers.
- **Deterministic fixed step.** Every effect advances in fixed **1/120 s** steps from a seeded Park–Miller PRNG, capped at 0.25 s of catch-up per frame. A given seed replays identically at any frame rate. This is also how the gallery's speed slider and "step through the combo" mode work: they just scale the clock.
- **One draw call per emitter.** Each emitter is an `InstancedBufferGeometry` (quad or mesh) with per-instance attributes: position, velocity, 3D size, rotation (quaternion or angle), color, flipbook UV rect, 4 custom-data floats and flip flags. The CPU simulates and the GPU only builds quads.
- **Data size.** The sample has 50 effects (21 of them element variants), 98 textures and 15 meshes. The gallery listing (`listing.json`) has 298 entries (the store page says 312), of which 44 are playable in the demo and the rest are video previews. Element variants are stored as *diffs* against a base effect (`fx/_variants.json`) and can borrow ("mix") signature layers from other effects, for example flames from the fire hit placed onto a holy hit.

### 2.1 Emitter model (what the JSON carries)

Each emitter carries the Shuriken modules the pack uses:

| Module | Fields used |
| --- | --- |
| Main | duration, loop, prewarm, start delay, lifetime, speed, size (1D or 3D), rotation (1D or 3D, random flip), start color, gravity modifier, max particles (clamped to 256), simulation space (local/world) |
| Emission | rate over time (curve) and bursts `[time, count, cycles, interval]` |
| Shape | sphere, hemisphere, cone (incl. volume), circle/edge, box; position/rotation/scale; *align to direction* |
| Over lifetime | size (uniform or per-axis), rotation (angular velocity), color gradient, velocity (linear, orbital, radial, speed modifier), force, limit velocity (dampen + drag), noise (approximated with three sines) |
| Texture sheet | grid flipbook: whole sheet or single/random row; frame-over-time curve × cycles, or fixed FPS |
| Custom data | **4 curves per particle**: these drive the shader (see 2.2) |
| Trails | per-particle ribbons drawn as stretched segments |
| Renderer | billboard, stretched billboard (length scale + velocity scale), mesh; render alignment (view/world/local); pivot; flip; sorting fudge |

Values are Shuriken `MinMaxCurve`s: constant, random-between-two, curve × multiplier, or random-between-two-curves. Curves are cubic Hermite keys.

### 2.2 The shader: one dissolve "uber-shader"

Almost every layer uses `SH_HunFX_common`. It does four jobs, all driven by per-particle custom data so a single material animates differently per particle:

| Input | Effect |
| --- | --- |
| `custom.x` | **Dissolve threshold.** `alpha *= smoothstep(lo, hi, dissolveTex.g − custom.x)`, so as custom.x rises over life the noise texture eats the shape away from its thin parts first. This is the signature "hand-drawn burn-out" look. |
| `custom.y` | **UV scroll** along U (or X with a keyword): wipes a gradient along a slash mesh. |
| `custom.z` | **Intensity boost** added to the color intensity: the flash at birth that feeds the bloom. |
| main texture `.r` | **Two-tone ramp:** `color = mix(color2, color1, smoothstep(a, b, main.r))`, a hot core and a darker element-colored edge from one grayscale texture. |
| mask texture `.b` | × `MaskMult` (often 3–10): hard-edged shapes from soft masks. |
| distortion texture | offsets all UVs (heat-haze wobble). |
| edge fade `_Mask_udrl` | fades the four UV edges so mesh ribbons never show hard borders. |
| fresnel (keyword) | rim alpha for bubbles and shields. |
| depth fade (keyword) | soft intersection with the floor, done analytically against the plane y = 0 instead of reading a depth buffer. |

Smaller variants: `SH_HunFX_simple` (texture × vertex color, alpha from the **green** channel: "gas alpha" for embers), `SH_HunFX_Stencil` (threshold reveal for ground cracks), and Unity legacy `Particles/Additive`. Textures carry an sRGB flag in the manifest (94 of 98 are sRGB) and are decoded in the shader (the GPU sampler is left linear). Colors are converted gamma → linear, and HDR values above 1 use pow 2.2.

Blending is standard alpha (`SrcAlpha, OneMinusSrcAlpha`) for every layer except the legacy additive one, so brightness comes from HDR values and bloom rather than from additive stacking.

### 2.3 Recoloring (the "recolor" slider)

The catalog stores each effect's **dominant hue and saturation**. Recoloring builds a 3×3 hue-rotate × saturation matrix in linear RGB that turns the dominant hue into the requested one and scales saturation (clamped 0.4–1.6). It is applied after the original shader as a uniform, so recoloring costs nothing per particle and never touches the shared data. The six "elements" for signature skills are *authored* variants, not just recolors: they swap or borrow layers.

### 2.4 Post-processing

Scene → half-float target (linear HDR) → bloom (threshold **1.0**, soft knee 0.5, 4 mips, separable 9-tap Gaussian, weights .35/.30/.20/.15, strength 0.9) → **Neutral** tone mapping → vignette 0.25 → sRGB. Because only values above 1 bloom, the `custom.z` intensity spike at birth is what makes the flashes bloom.

## 3. How individual effects are built

Times in seconds. "Role" is the pack's own layer label.

### Sword slash (`Slash_fire`, 0.77 s, 6 layers)

| Layer | Render | Timing | Notes |
| --- | --- | --- | --- |
| Arc A (slash_arc) | mesh: crescent | burst 1 @0, life 0.5 | 6-frame flipbook of a slash; **angular velocity −5.24 rad/s decaying linearly to 0** (≈75° of spin that decelerates); intensity curve 2.4→0 |
| Arc B (slash_arc) | mesh: same crescent | life 0.6 | noise main texture panning 0.7/s, slash-shaped mask ×3, dissolve −0.52→1 over life, two-tone ramp |
| Wind swirl A | mesh: crescent | life 0.3 | wind streak texture scrolled along the arc by custom.y (−0.7→0.7), intensity 10, edge fades |
| Flames | billboard, 5×4 flipbook | rate 15 + burst 10 @0.2 on a circle | size 0.34→1, intensity 2→0 |
| Embers | stretched | burst 25 @0, speed 5–20 | gas-alpha sparks shrinking 1→0 |
| Wind swirl B | mesh: torus | delay 0.05, life 0.4 | dissolve −0.29→0.66, distortion 0.11 |

The slash itself is mostly **mesh particles on a crescent mesh** that spin and decelerate, rather than a trail. The motion comes from the angular-velocity curve, and the "cut" from dissolve and scroll.

### Hit (`Hit_01_Fire`, 0.72 s, 7 layers)

Flash (billboard, size 7, life **0.2**, size 1→0.01, intensity 5→0), a radial burst growing 0.37→1, 5 stretched "burst streaks" (life 0.15–0.3), 15 sparks (speed 5–25, size curve 1→0.26→0.17→0), 3 flame streaks, a flame flipbook burst at 0.1, and 3 **open cylinders** ("wind swirl") that grow 0.36→1 while dissolving away (custom.x −0.1→1.1). Everything fires at t = 0 except the swirl (0.05) and flames (0.1): the impact reads in the first 3–4 frames.

### Lightning strike (`Skill_Thunder`, 0.93 s, 8 layers)

| t | Layer |
| --- | --- |
| 0.00 | bolt A (billboard 3×3 flipbook, life 0.4), glow A (size 8, life 0.4), small arcs on a circle at rate 25 for 0.7 s |
| 0.07 | 4 burst streaks (hemisphere) |
| 0.09 | 20 sparks, speed **10–40** |
| 0.10 | bolt B (local-aligned quad), glow B (legacy additive, size 10, life 0.8), flickering arcs (rate 10, dissolve 0→2) |

The game then spawns the ground impact (`Skill_Thunder_Hit`) **0.12 s** later, with camera shake 0.25 and 3 damage in a 2.4 m radius.

### Hammer from the sky (`Skill_HolyJustice`, 4.48 s, 19 layers)

The hammer is a **billboard texture of a hammer**, not a mesh. From 0 s two hammer billboards grow (0.36→1) and swing into place (rotation speed 1.75 rad/s decaying to 0) over 0.4 s. At **0.45 s** a held pair replaces them for 3 s and dissolves away in the last 15% of its life, and everything else lands: two impact-flash cylinders (front and back faces) that reach 82% of their size in the first quarter of a 0.15–0.25 s life, 8 burst streaks, 15 smoke puffs (speed 3–15), a large glow (size 15), 30 sparkles at 0.48 s (speed 3–50), crackling arcs whose rate decays from 30 to 0 over 1.5–2 s, a shockwave ring at 0.5 s, a stencil **ground crack** at 0.5 s that lives 3.5 s and erodes from 60% of its life, 18 billboard **rocks** at 0.55 s (speed 5–15, random spin), and at 3 s lingering sparkles with a negative gravity modifier, so they drift upward. The effect is authored to land 3 m ahead of its pivot. The game applies shake 0.6 and 8 damage in a 4.2 m radius at 0.5 s and roots the player for 0.7 s.

### Divine shield (`Skill_DivineShield`, looping)

Two "wing" billboards (local-aligned quads) that unfold via opposite rotation-over-life curves (±0.7 rad/s decaying), a looping **fresnel sphere** (line texture plus noise distortion, front faces), a shockwave ring at 0 (0.21→0.81 in 8% of life), 60 sparkles bursting on a circle, and looping rising sparkles at rate 20.

### Dust (`Slash_dust_01`, 0.38 s)

A single mesh particle (a curved "wind" sheet) with a directional smoke flipbook (4×2), depth fade against the floor, size 0→0.69→1. Used for dash kicks and deaths.

## 4. Game feel in the demo (`play.html`, `combat.html`)

| Mechanic | Value |
| --- | --- |
| Camera | top-down follow, offset (0, 15, 10.5), exponential lerp `1 − e^(−6·dt)`, looks at chest height 0.8 |
| Camera shake | single scalar set to max(current, k) on impact (thunder 0.25, meteor 0.3, hammer 0.6), decays **linearly at 1.6/s**, random offset per frame scaled by the value (vertical × 0.6) |
| Hit flash | enemy emissive set to 6 × remaining flash time (flash = 0.15 s) |
| Knockback | impulse 5 + damage along the hit direction, decays `e^(−8·dt)` |
| Hit-stop | **none**: the demo never freezes time |
| Swing | alternates fore- and back-hand by playing the same slash with roll 180°. The damage check runs 0.08 s after the swing: within 2.8 m and a ~78° half-angle cone in front |
| Dash | 22 m/s for 0.17 s, plus dust |
| Combo (`combat.html`) | slash → back-hand slash (hit at +0.1 s) → spin → thrust → cross-cut → thunder → power-up → finisher. Each step is a table of `[delay, effect, placement]` on a shared clock, so the speed slider slows the whole sequence |
| Placement presets | per category: swings at chest height (1.2 m) with yaw 180, hits 1 m up and 1.5 m ahead, AoE 3 m ahead on the ground, auras parented to the actor |

## 5. Unknowns and limits

- Only 7 of 50 effect definitions were decoded in detail. The rest were inventoried from the manifest (ids, categories, durations, palettes, tags).
- Unity-side details that didn't survive export (exact Shuriken noise, sub-emitters, light modules) are only visible through how the port approximates them.
- The "full pack" Unity/Godot versions were not examined.

## 6. What the rebuild in this repo keeps, and what it changes

| Technique | Original | This repo |
| --- | --- | --- |
| Simulation | Shuriken port, fixed 1/120 s, seeded | same idea, own emitter model (`src/core/emitter.js`), fixed 1/120 s, mulberry32 seed |
| Rendering | instanced quads/meshes, 1 draw call per layer | same |
| Look | dissolve uber-shader driven by custom data | own uber-shader: dissolve / scroll / glow / frame per particle, two-tone hot ramp, edge fade, fresnel, ground fade |
| Art | hand-painted textures and meshes | **procedural** textures (noise, crescent, sparks, lightning, cracks, rune circle, hammer, rocks) and procedural meshes |
| Recolor | hue-rotate matrix from the catalog's dominant hue | recipes reference palette slots (`core` / `main` / `deep`) so each element is a clean palette swap, plus one element-specific signature layer |
| Post | custom bloom + Neutral tonemap | three.js `UnrealBloomPass` (threshold 1) + Neutral tonemap |
| Shake | linear decay, white noise | trauma² with smooth noise |
| Hit-stop | none | optional `HitStop` (0.06 s swing, 0.09 s hammer), freezing gameplay and VFX together |

### Porting the techniques to Unity or Godot

| Concept | Unity | Godot 4 |
| --- | --- | --- |
| Layer / emitter | ParticleSystem (Shuriken) or VFX Graph | GPUParticles3D + ParticleProcessMaterial |
| Per-particle dissolve/scroll/glow | Custom Data module → `TEXCOORD` streams (Renderer → Custom Vertex Streams) | `CUSTOM` in a particle shader, or `INSTANCE_CUSTOM` in the draw pass shader |
| Dissolve uber-shader | Shader Graph: `Step/Smoothstep(noise − custom.x)` × alpha | spatial shader with `smoothstep(0.0, soft, noise - INSTANCE_CUSTOM.x)` |
| Crescent slash mesh | mesh render mode + rotation-over-lifetime | `draw_pass_1` = arc mesh, `angular_velocity` curve |
| Stretched sparks | Render Mode: Stretched Billboard | `particle_flag_align_y` + velocity-aligned billboards |
| Bloom on HDR > 1 | URP Bloom, threshold 1 | WorldEnvironment glow, HDR threshold 1 |
| Recolor per element | material property block / palette uniforms | shader uniforms per instance |
