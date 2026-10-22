// HDR bloom + tone mapping. Effects output linear HDR (glow > 1), so only the hot cores bloom.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export function createPost(renderer, scene, camera, { strength = 0.55, radius = 0.2, threshold = 1.0 } = {}) {
  renderer.toneMapping = THREE.NeutralToneMapping;   // keeps saturated element colors from going muddy
  renderer.toneMappingExposure = 1;
  const composer = new EffectComposer(renderer);   // half-float targets: values above 1 survive until the bloom
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), strength, radius, threshold);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  return {
    composer, bloom,
    setSize(w, h) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); },
    render() { composer.render(); },
  };
}
