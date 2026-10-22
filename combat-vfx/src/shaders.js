// The whole look comes from one "dissolve uber-shader" driven by per-particle data:
//   iData.x  dissolve threshold  (noise field below it is eaten away; -1 = intact, 1 = gone)
//   iData.y  UV scroll           (slides the texture along uScrollAxis, e.g. a slash wiping along its arc)
//   iData.z  glow boost          (added to intensity; values over 1 feed the bloom pass)
//   iData.w  flipbook frame
// Textures are grayscale masks: .a = shape, .r = shading (only with uShade), .g = optional reveal field.

export const VERTEX = /* glsl */ `
attribute vec3 iPos; attribute vec3 iVel; attribute vec2 iSize; attribute vec4 iRot;
attribute vec4 iColor; attribute vec4 iData;
uniform vec3 uAspect; uniform vec2 uPivot; uniform vec2 uFrames;
uniform float uScale, uStretch, uVelStretch;
varying vec2 vUv; varying vec2 vQuad; varying vec4 vColor; varying vec4 vData;
varying vec3 vNormal; varying vec3 vView; varying float vWorldY; varying float vSeed;

vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }

void main() {
  vec4 mv;
  vNormal = vec3(0.0, 0.0, 1.0);
#if MODE == 0
  // billboard: faces the camera, spun in the view plane
  mv = modelViewMatrix * vec4(iPos, 1.0);
  vec2 c = (position.xy + uPivot) * uAspect.xy * iSize.x * uScale;
  float s = sin(iRot.x), k = cos(iRot.x);
  mv.xy += vec2(c.x * k - c.y * s, c.x * s + c.y * k);
#elif MODE == 1
  // stretched: long axis follows the velocity, turned around it to face the camera; uv.y = 1 at the head
  mv = modelViewMatrix * vec4(iPos, 1.0);
  vec3 v = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
  vec3 along = length(v) > 1e-5 ? normalize(v) : vec3(0.0, 1.0, 0.0);
  vec3 side = cross(along, normalize(-mv.xyz));
  side = length(side) > 1e-4 ? normalize(side) : vec3(1.0, 0.0, 0.0);
  float len = (iSize.x * uStretch + length(iVel) * uVelStretch) * uScale;
  mv.xyz += along * (position.y + uPivot.y) * len + side * position.x * iSize.x * uAspect.x * uScale;
#elif MODE == 2
  // axial: stands along the layer's +Y and only turns around it (lightning bolts, falling hammers)
  mv = modelViewMatrix * vec4(iPos, 1.0);
  vec3 up = normalize((modelViewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  vec3 side = cross(up, normalize(-mv.xyz));
  side = length(side) > 1e-4 ? normalize(side) : vec3(1.0, 0.0, 0.0);
  vec2 c = (position.xy + uPivot) * uAspect.xy * iSize.x * uScale;
  mv.xyz += side * c.x + up * c.y;
#else
  // mesh / flat quad: oriented by the instance quaternion inside the layer's transform
  vec3 p = qrot(iRot, (position + vec3(uPivot, 0.0)) * uAspect * iSize.x);
  mv = modelViewMatrix * vec4(iPos + p, 1.0);
  vNormal = normalize(normalMatrix * qrot(iRot, normal));
#endif
  vView = normalize(-mv.xyz);
  vQuad = uv;
  float cols = uFrames.x, rows = uFrames.y;
  float col = mod(iData.w, cols), row = floor(iData.w / cols);
  vUv = (uv + vec2(col, rows - 1.0 - row)) / uFrames;
  vColor = iColor; vData = iData; vSeed = iSize.y;
  vWorldY = (inverse(viewMatrix) * mv).y;
  gl_Position = projectionMatrix * mv;
}`;

export const FRAGMENT = /* glsl */ `
uniform sampler2D uMain, uNoise;
uniform vec3 uHot; uniform vec2 uRamp; uniform float uIntensity, uMaster;
uniform vec2 uScrollAxis, uPan, uNoiseScale, uNoisePan;
uniform float uNoiseAmt, uSoft, uFresnel, uGroundFade, uFieldFromG, uShade, uSwap, uTime;
uniform vec4 uEdgeFade;   // fade widths at u = 0, u = 1, v = 0, v = 1
varying vec2 vUv; varying vec2 vQuad; varying vec4 vColor; varying vec4 vData;
varying vec3 vNormal; varying vec3 vView; varying float vWorldY; varying float vSeed;

float fade(float w, float x) { return w > 0.0 ? smoothstep(0.0, w, x) : 1.0; }

void main() {
  vec2 uv = vUv + uScrollAxis * vData.y + uPan * uTime;
  if (uSwap > 0.5) uv = uv.yx;
  vec4 tex = texture2D(uMain, uv);
  float n = texture2D(uNoise, vQuad * uNoiseScale + uNoisePan * uTime + vSeed * 7.31).r;

  // shape, broken up by noise, then eaten by the dissolve threshold
  float shape = tex.a * mix(1.0, n * 2.0, uNoiseAmt);
  float field = mix(n, tex.g, uFieldFromG);
  float a = shape * smoothstep(0.0, uSoft, field - vData.x);

  a *= fade(uEdgeFade.x, vQuad.x) * fade(uEdgeFade.y, 1.0 - vQuad.x) * fade(uEdgeFade.z, vQuad.y) * fade(uEdgeFade.w, 1.0 - vQuad.y);
  if (uFresnel > 0.0) a *= pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), uFresnel);
  if (uGroundFade > 0.0) a *= smoothstep(0.0, uGroundFade, vWorldY);

  // two-tone ramp: dense parts of the shape go white-hot, thin edges keep the element color
  float hot = smoothstep(uRamp.x, uRamp.y, a);
  vec3 col = mix(vColor.rgb, uHot, hot) * (uIntensity + vData.z) * uMaster;
  if (uShade > 0.5) col *= tex.r;
  a = clamp(a * vColor.a, 0.0, 1.0);
#ifdef ADDITIVE
  gl_FragColor = vec4(col * a, 1.0);
#else
  gl_FragColor = vec4(col, a);
#endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
