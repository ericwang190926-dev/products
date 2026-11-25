// three.js preview: every panel is a mesh folded about its hinge; artwork comes from the flat raster.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { computeFold, foldedBBox } from '../core/fold.js';
import { centroid, bbox } from '../core/geom.js';
import { renderFlat, renderFinishMaps } from '../render/raster.js';

export function createView3D(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 1, 10000);
  const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = 0.1; controls.addEventListener('start', () => (userMoved = true));
  // IBL so metallic foil has something to reflect (without an env map, metalness=1 looks black).
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new RoomEnvironment();
  scene.environment = pmrem.fromScene(envScene, 0.04).texture;
  scene.environmentIntensity = 1.05;
  envScene.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa0aa, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 1.15); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); scene.add(sun); scene.add(sun.target);
  const fill = new THREE.DirectionalLight(0xffffff, 0.4); scene.add(fill);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.16 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const root = new THREE.Group(); scene.add(root);
  let geo = null, meshes = [], tex = null, maskTex = null, fold = 1, open = 0, radius = 100, center0 = new THREE.Vector3(), viewM = new THREE.Matrix4();
  let frontMat = null, backMat = null, bulgeFront = null, bulgeBack = null;

  let userMoved = false;
  function resize() { const w = container.clientWidth || 1, h = container.clientHeight || 1; renderer.setSize(w, h, false); renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%'; camera.aspect = w / h; camera.updateProjectionMatrix(); if (geo && !userMoved) resetView(); }
  new ResizeObserver(resize).observe(container); resize();

  function uvFor(g, bb) {
    const pos = g.attributes.position; const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) { uv[2 * i] = (pos.getX(i) - bb.x) / bb.w; uv[2 * i + 1] = 1 - (-pos.getY(i) - bb.y) / bb.h; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  const shapeOf = (poly, holes = []) => { const s = new THREE.Shape(poly.map((p) => new THREE.Vector2(p[0], -p[1]))); for (const h of holes) s.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p[0], -p[1])))); return s; };

  function bulgeGeometry(p, bb) {
    const pb = bbox(p.poly); const g = new THREE.PlaneGeometry(pb.w, pb.h, 48, 64); g.translate(pb.x + pb.w / 2, -(pb.y + pb.h / 2), 0);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) { const u = (pos.getX(i) - pb.x) / pb.w, v = (-pos.getY(i) - pb.y) / pb.h; pos.setZ(i, p.bulge * Math.sin(Math.PI * u) * Math.pow(Math.sin(Math.PI * v), 0.35)); }
    g.computeVertexNormals(); uvFor(g, bb); return g;
  }

  function setGeometry(g, state, { refit = true } = {}) {
    geo = g;
    for (const m of meshes) { m.geometry.dispose(); root.remove(m); }
    meshes = [];
    const bb = geo.bboxBleed;
    frontMat?.dispose(); backMat?.dispose(); bulgeFront?.dispose(); bulgeBack?.dispose();
    frontMat = new THREE.MeshPhysicalMaterial({ roughness: 0.55, metalness: 0, side: THREE.FrontSide, clearcoat: 0 });
    backMat = new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.BackSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
    bulgeFront = new THREE.MeshPhysicalMaterial({ roughness: 0.5, side: THREE.FrontSide, alphaTest: 0.5 });
    bulgeBack = new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.BackSide, alphaTest: 0.5 });
    for (const p of geo.panels) {
      let sg;
      if (p.bulge) sg = bulgeGeometry(p, bb); else { sg = new THREE.ShapeGeometry(shapeOf(p.poly, p.holes)); uvFor(sg, bb); }
      for (const [mat, side] of [[p.bulge ? bulgeFront : frontMat, 'f'], [p.bulge ? bulgeBack : backMat, 'b']]) {
        const m = new THREE.Mesh(sg, mat); m.matrixAutoUpdate = false; m.castShadow = true; m.userData = { panel: p, side }; root.add(m); meshes.push(m);
      }
    }
    for (const e of geo.extras3d) {
      const p = geo.byId[e.panel]; if (!p) continue; let m;
      if (e.type === 'film') m = new THREE.Mesh(new THREE.ShapeGeometry(shapeOf(e.poly)), new THREE.MeshStandardMaterial({ color: 0xdfefff, transparent: true, opacity: 0.22, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false }));
      if (e.type === 'blister') { const eg = new THREE.ExtrudeGeometry(shapeOf(e.poly), { depth: e.depth, bevelEnabled: true, bevelThickness: Math.min(4, e.depth * 0.3), bevelSize: 2, bevelSegments: 4 }); m = new THREE.Mesh(eg, new THREE.MeshPhysicalMaterial({ color: 0xf2f8ff, transparent: true, opacity: 0.28, roughness: 0.08, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false })); }
      if (!m) continue; m.matrixAutoUpdate = false; m.userData = { panel: p, extra: e }; m.renderOrder = 2; root.add(m); meshes.push(m);
    }
    const v = geo.view3d; viewM = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler((v.rx * Math.PI) / 180, (v.ry * Math.PI) / 180, 0, 'YXZ'));
    // reference size from the folded state
    const full = computeFold(geo, { progress: 1 }); const env = foldedBBox(geo, full); radius = Math.max(20, env.size.length() / 2);
    updateTexture(state);
    update();
    if (refit) resetView();
  }

  function updateTexture(state) {
    if (!geo) return;
    const bb = geo.bboxBleed; const ppm = Math.min(5, 2048 / Math.max(bb.w, bb.h));
    const { canvas } = renderFlat(geo, state, { ppm, maxPx: 2048 });
    tex?.dispose(); tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy(); tex.generateMipmaps = true;
    // alpha mask (for bulged panels with plain-colored back)
    const mc = document.createElement('canvas'); mc.width = 768; mc.height = Math.max(8, Math.round((768 * bb.h) / bb.w)); const mx = mc.getContext('2d');
    mx.fillStyle = '#000'; mx.fillRect(0, 0, mc.width, mc.height); mx.setTransform(mc.width / bb.w, 0, 0, mc.height / bb.h, (-bb.x * mc.width) / bb.w, (-bb.y * mc.height) / bb.h);
    mx.fillStyle = '#fff'; mx.beginPath(); for (const p of geo.panels) { p.poly.forEach((q, i) => (i ? mx.lineTo(q[0], q[1]) : mx.moveTo(q[0], q[1]))); mx.closePath(); } mx.fill();
    maskTex?.dispose(); maskTex = new THREE.CanvasTexture(mc);
    frontMat.map = tex; bulgeFront.map = tex;
    backMat.color.set(state.boardColor); bulgeBack.color.set(state.boardColor); bulgeBack.alphaMap = maskTex; bulgeBack.needsUpdate = true; bulgeFront.alphaMap = maskTex;
    const maps = renderFinishMaps(geo, state, { ppm, maxPx: 2048 });
    const asTex = (cv) => { const t2 = new THREE.CanvasTexture(cv); t2.colorSpace = THREE.NoColorSpace; t2.anisotropy = tex.anisotropy; return t2; };
    const lam = state.lamination || 'none';
    for (const mat of [frontMat, bulgeFront]) {
      mat.roughnessMap?.dispose(); mat.metalnessMap?.dispose(); mat.bumpMap?.dispose(); mat.clearcoatMap?.dispose();
      if (maps.hasFinish) {
        mat.roughnessMap = asTex(maps.roughness); mat.roughness = 1;
        // metalness only where the map is white (foil). Without IBL this used to render as a black rectangle.
        if (maps.hasMetal) { mat.metalnessMap = asTex(maps.metalness); mat.metalness = 1; mat.envMapIntensity = 1.25; }
        else { mat.metalnessMap = null; mat.metalness = 0; mat.envMapIntensity = 1; }
        if (maps.hasBump) { mat.bumpMap = asTex(maps.bump); mat.bumpScale = maps.hasSculpt ? 1.1 : 0.45; }
        else { mat.bumpMap = null; mat.bumpScale = 0; }
        if (maps.hasCoat) {
          mat.clearcoatMap = asTex(maps.clearcoat); mat.clearcoat = 1; mat.clearcoatRoughness = 0.1;
        } else if (lam === 'gloss') {
          mat.clearcoatMap = null; mat.clearcoat = 0.4; mat.clearcoatRoughness = 0.16;
        } else {
          mat.clearcoatMap = null; mat.clearcoat = 0; mat.clearcoatRoughness = lam === 'matte' ? 0.5 : 0.25;
        }
      } else {
        mat.roughnessMap = null; mat.metalnessMap = null; mat.bumpMap = null; mat.clearcoatMap = null;
        mat.roughness = 0.55; mat.metalness = 0; mat.bumpScale = 0; mat.clearcoat = 0;
      }
      mat.needsUpdate = true;
    }
  }

  function update() {
    if (!geo) return;
    const mats = computeFold(geo, { progress: fold, open });
    const env = foldedBBox(geo, mats); const C = env.min.clone().add(env.max).multiplyScalar(0.5);
    const delta = Math.max(0.25, geo.ctx.t * 0.9);
    for (const m of meshes) {
      const p = m.userData.panel; const M = mats[p.id]; if (!M) continue;
      let off = new THREE.Matrix4();
      const layer = m.userData.extra ? (m.userData.extra.type === 'film' ? 0.5 : 0) : p.layer;
      if (layer) {
        const n = new THREE.Vector3(0, 0, 1).transformDirection(M); const c = centroid(p.poly); const P = new THREE.Vector3(c[0], -c[1], 0).applyMatrix4(M);
        // 180° fold-backs lie on the parent's unprinted side: push along own printed normal; others toward box centre
        const sgn = p.angle >= 179 ? 1 : Math.sign(n.dot(C.clone().sub(P))) || -1; const d = n.multiplyScalar(sgn * layer * delta);
        off.makeTranslation(d.x, d.y, d.z);
      }
      const half = (geo.ctx.t || 0) / 2;
      const zOff = new THREE.Matrix4();
      if (!m.userData.extra && half) zOff.makeTranslation(0, 0, m.userData.side === 'b' ? -half : half);
      m.matrix.copy(viewM).multiply(off).multiply(M).multiply(zOff); m.matrixWorldNeedsUpdate = true;
    }
    // centre model at origin, ground below
    root.position.set(0, 0, 0); root.updateMatrixWorld(true);
    const box = new THREE.Box3(); for (const m of meshes) if (!m.userData.extra) box.expandByObject(m);
    const c = box.getCenter(new THREE.Vector3());
    root.position.set(-c.x, -c.y, -c.z); root.updateMatrixWorld(true);
    ground.position.set(0, box.min.y - c.y - 0.3, 0); ground.scale.set(radius * 8, radius * 8, 1);
    sun.position.set(radius * 1.2, radius * 3, radius * 1.6); sun.target.position.set(0, 0, 0);
    const sc = sun.shadow.camera; sc.left = sc.bottom = -radius * 2; sc.right = sc.top = radius * 2; sc.near = 1; sc.far = radius * 10; sc.updateProjectionMatrix();
    fill.position.set(-radius * 2, radius, -radius);
  }

  function resetView() {
    const vf = (camera.fov * Math.PI) / 360, hf = Math.atan(Math.tan(vf) * camera.aspect);
    const d = (radius / Math.sin(Math.min(vf, hf))) * 1.08;
    const dir = new THREE.Vector3(0.55, 0.42, 0.78).normalize(); camera.position.copy(dir.multiplyScalar(d)); camera.near = Math.max(0.5, radius / 50); camera.far = radius * 50; camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0); controls.update(); userMoved = false;
  }
  let raf;
  const loop = () => { raf = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); };
  loop();
  let anim = null;
  function playFold(onTick) {
    const from = fold > 0.5 ? 1 : 0, to = 1 - from, t0 = performance.now(), dur = 2200;
    cancelAnimationFrame(anim);
    const step = () => { const k = Math.min(1, (performance.now() - t0) / dur); const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; fold = from + (to - from) * e; update(); onTick?.(fold); if (k < 1) anim = requestAnimationFrame(step); };
    step();
  }
  function snapshot(scale = 2) {
    const w = container.clientWidth, h = container.clientHeight; const pr = renderer.getPixelRatio();
    renderer.setPixelRatio(scale); renderer.setSize(w, h, false); renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png'); renderer.setPixelRatio(pr); renderer.setSize(w, h, false); return url;
  }
  return { setGeometry, updateTexture, setFold: (p, o) => { fold = p; open = o; update(); }, getFold: () => fold, playFold, resetView, snapshot, renderer };
}
