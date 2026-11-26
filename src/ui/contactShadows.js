// Contact-style ground shadow: render depth from below, fade with height, blur,
// and composite a tight contact plus a wider, slightly-cast pool. Re-render only
// when the caller says the fold / lid / geometry changed.
import * as THREE from 'three';
import { HorizontalBlurShader } from 'three/examples/jsm/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/examples/jsm/shaders/VerticalBlurShader.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const compositeShader = {
  uniforms: {
    tTight: { value: null },
    tWide: { value: null },
    opacity: { value: 0.86 },
    tightWeight: { value: 1.0 },
    wideWeight: { value: 0.4 },
    uCast: { value: new THREE.Vector2(0, 0) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tTight, tWide;
    uniform float opacity, tightWeight, wideWeight;
    uniform vec2 uCast;
    varying vec2 vUv;
    void main() {
      float tight = texture2D(tTight, vUv).r;
      float wide = texture2D(tWide, vUv + uCast).r;
      float s = min(1.0, tight * tightWeight + wide * wideWeight);
      vec2 e = smoothstep(0.0, 0.12, vUv) * smoothstep(1.0, 0.88, vUv);
      float a = s * opacity * e.x * e.y;
      gl_FragColor = vec4(0.0, 0.0, 0.0, a);
    }`,
};

function makeRT(res, depth) {
  const rt = new THREE.WebGLRenderTarget(res, res, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: !!depth,
    stencilBuffer: false,
    generateMipmaps: false,
  });
  rt.texture.generateMipmaps = false;
  rt.texture.wrapS = rt.texture.wrapT = THREE.ClampToEdgeWrapping;
  return rt;
}

export function createContactShadows(renderer, scene, { res = 512 } = {}) {
  const rtEnc = makeRT(res, false);
  const rtA = makeRT(res, false);
  const rtTight = makeRT(res, false);
  const rtWide = makeRT(res, false);

  const depthMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { uGroundY: { value: 0 }, uFar: { value: 80 } },
    vertexShader: `
      varying float vHeight;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vHeight = w.y;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform float uGroundY, uFar;
      varying float vHeight;
      void main() {
        float h = clamp((vHeight - uGroundY) / max(1.0, uFar), 0.0, 1.0);
        float s = pow(1.0 - h, 1.25);
        gl_FragColor = vec4(s, s, s, 1.0);
      }`,
  });
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 80);
  cam.up.set(0, 0, -1);

  const hMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(HorizontalBlurShader.uniforms),
    vertexShader: HorizontalBlurShader.vertexShader,
    fragmentShader: HorizontalBlurShader.fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  const vMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(VerticalBlurShader.uniforms),
    vertexShader: VerticalBlurShader.vertexShader,
    fragmentShader: VerticalBlurShader.fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  const fsQ = new FullScreenQuad(hMat);

  const planeMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(compositeShader.uniforms),
    vertexShader: compositeShader.vertexShader,
    fragmentShader: compositeShader.fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    toneMapped: false,
  });
  planeMat.uniforms.tTight.value = rtTight.texture;
  planeMat.uniforms.tWide.value = rtWide.texture;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), planeMat);
  plane.rotation.x = -Math.PI / 2;
  plane.renderOrder = 1;
  plane.frustumCulled = false;
  plane.name = 'contactShadow';
  scene.add(plane);

  const hideDuring = (obj) => {
    if (!obj.visible) return false;
    if (obj === plane || obj.name === 'studioFloor') return true;
    const t = obj.userData?.extra?.type;
    return t === 'magnet' || t === 'film';
  };

  function blit(mat, input, output, setUV) {
    fsQ.material = mat;
    if (mat.uniforms.tDiffuse) mat.uniforms.tDiffuse.value = input.texture;
    if (mat.uniforms.tDepth) mat.uniforms.tDepth.value = input.texture;
    setUV?.(mat);
    renderer.setRenderTarget(output);
    renderer.clear();
    fsQ.render(renderer);
  }

  function blur(input, output, amount) {
    const px = amount / res;
    blit(hMat, input, rtA, (m) => { m.uniforms.h.value = px; });
    blit(vMat, rtA, output, (m) => { m.uniforms.v.value = px; });
  }

  function configure({ width, depth, y, far, cast = [0.012, -0.016] }) {
    plane.position.set(0, y + 0.12, 0);
    plane.scale.set(width, depth, 1);
    cam.left = -width / 2; cam.right = width / 2;
    cam.top = depth / 2; cam.bottom = -depth / 2;
    const reach = Math.max(20, far);
    cam.near = 0.5; cam.far = reach + 4;
    cam.position.set(0, y + reach + 1, 0);
    cam.lookAt(0, y, 0);
    cam.updateProjectionMatrix();
    depthMat.uniforms.uGroundY.value = y;
    depthMat.uniforms.uFar.value = reach;
    planeMat.uniforms.uCast.value.set(cast[0], cast[1]);
  }

  function render() {
    const hidden = [];
    scene.traverse((o) => { if (hideDuring(o)) { o.visible = false; hidden.push(o); } });

    const prevTarget = renderer.getRenderTarget();
    const prevTM = renderer.toneMapping;
    const prevCS = renderer.outputColorSpace;
    const prevBG = scene.background;
    const prevOverride = scene.overrideMaterial;
    const prevAuto = renderer.autoClear;
    const prevShadow = renderer.shadowMap.enabled;
    const prevClear = new THREE.Color(); renderer.getClearColor(prevClear);
    const prevAlpha = renderer.getClearAlpha();

    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.shadowMap.enabled = false;
    renderer.autoClear = true;
    scene.background = null;
    scene.overrideMaterial = depthMat;
    renderer.setClearColor(0x000000, 1);
    renderer.setRenderTarget(rtEnc);
    renderer.clear();
    const culled = [];
    scene.traverse((o) => { if (o.isMesh && o.frustumCulled) { o.frustumCulled = false; culled.push(o); } });
    renderer.render(scene, cam);
    for (const o of culled) o.frustumCulled = true;

    scene.overrideMaterial = prevOverride;
    blur(rtEnc, rtTight, 5);
    blur(rtEnc, rtWide, 13);

    renderer.toneMapping = prevTM;
    renderer.outputColorSpace = prevCS;
    scene.background = prevBG;
    renderer.shadowMap.enabled = prevShadow;
    renderer.autoClear = prevAuto;
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.setRenderTarget(prevTarget);
    for (const o of hidden) o.visible = true;
  }

  function dispose() {
    scene.remove(plane);
    for (const rt of [rtEnc, rtA, rtTight, rtWide]) rt.dispose();
    depthMat.dispose(); hMat.dispose(); vMat.dispose(); planeMat.dispose();
    fsQ.dispose(); plane.geometry.dispose();
  }

  return { configure, render, plane, dispose };
}

export function createStudioFloor(scene) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTint: { value: new THREE.Color(0xe4e7ee) },
      uRadius: { value: 1 },
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform vec3 uTint; uniform float uRadius; varying vec3 vWorld;
      void main() {
        float d = length(vWorld.xz) / max(1.0, uRadius);
        float bowl = 1.0 - smoothstep(0.0, 0.62, d);
        float alpha = 0.16 * bowl * (1.0 - smoothstep(0.55, 1.0, d));
        gl_FragColor = vec4(uTint, alpha);
      }`,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 1), mat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = false;
  floor.castShadow = false;
  floor.renderOrder = -2;
  floor.name = 'studioFloor';
  floor.frustumCulled = false;
  scene.add(floor);
  return {
    mesh: floor,
    place(y, radius) {
      floor.position.set(0, y, 0);
      const span = radius * 7;
      floor.scale.set(span, span, 1);
      mat.uniforms.uRadius.value = span * 0.5;
    },
    dispose() { scene.remove(floor); floor.geometry.dispose(); mat.dispose(); },
  };
}
