import { Matrix4, Vector3, Quaternion } from 'three';
import { centroid } from './geom.js';

export const to3 = (p) => new Vector3(p[0], -p[1], 0);

function hingeMatrix(panel, angleDeg) {
  const [a, b] = panel.hinge;
  const A = to3(a), B = to3(b);
  const axis = B.clone().sub(A).normalize();
  const c = to3(centroid(panel.poly)).sub(A);
  // positive angle = child moves to -z (away from printed side, which faces +z when flat)
  const zdir = new Vector3().crossVectors(axis, c).z;
  const sign = zdir > 0 ? -1 : 1;
  const R = new Matrix4().makeRotationAxis(axis, sign * (angleDeg * Math.PI) / 180);
  return new Matrix4().makeTranslation(A.x, A.y, A.z).multiply(R).multiply(new Matrix4().makeTranslation(-A.x, -A.y, -A.z));
}

function lerpMatrix(m, t) {
  const p = new Vector3(), q = new Quaternion(), s = new Vector3(); m.decompose(p, q, s);
  const q2 = new Quaternion().slerp(q, t); // identity → q
  return new Matrix4().compose(p.multiplyScalar(t), q2, new Vector3(1, 1, 1));
}

/** World matrices (fold space, before view orientation) for every panel. */
export function computeFold(geo, { progress = 1, open = 0 } = {}) {
  const mats = {};
  const children = {};
  for (const p of geo.panels) if (p.parent) (children[p.parent] ||= []).push(p);
  const effAngle = (p) => {
    let a = p.angle * progress;
    if (p.openable) a -= open * (p.openRange ?? 110);
    return a;
  };
  const visit = (p, M, deferSolve) => {
    mats[p.id] = M;
    for (const c of children[p.id] || []) {
      if (c.solve && deferSolve) continue;
      visit(c, M.clone().multiply(hingeMatrix(c, c.solve ? solvedAngle(geo, c, M) * progress : effAngle(c))), deferSolve);
    }
  };
  for (const r of geo.roots) {
    let M = new Matrix4();
    if (r.assemble) M = lerpMatrix(r.assemble, progress);
    if (r.openLift && open) M = new Matrix4().makeTranslation(r.openLift[0] * open, r.openLift[1] * open, r.openLift[2] * open).multiply(M);
    visit(geo.byId[r.id], M, true);
  }
  // solved panels (need their target computed)
  for (const p of geo.panels) if (p.solve && !mats[p.id] && mats[p.parent]) {
    const full = progress === 1 && !open ? mats : computeFoldCached(geo);
    const ang = solvedAngle(geo, p, full[p.parent], full);
    visit(p, mats[p.parent].clone().multiply(hingeMatrix(p, ang * progress)), false);
  }
  return mats;
}
let cacheGeo = null, cacheMats = null;
function computeFoldCached(geo) {
  if (cacheGeo !== geo) { cacheMats = computeFold(geo, { progress: 1, open: 0 }); cacheGeo = geo; }
  return cacheMats;
}
function solvedAngle(geo, p, parentM, full) {
  if (p._solved !== undefined) return p._solved;
  full = full || computeFoldCached(geo);
  const target = to3(p.solve.targetPoint).applyMatrix4(full[p.solve.target]);
  const pt = to3(p.solve.point);
  const f = (a) => pt.clone().applyMatrix4(parentM.clone().multiply(hingeMatrix(p, a))).distanceTo(target);
  let best = 0, bv = Infinity;
  for (let a = -180; a <= 180; a += 2) { const v = f(a); if (v < bv) { bv = v; best = a; } }
  let lo = best - 2, hi = best + 2;
  for (let i = 0; i < 60; i++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (f(m1) < f(m2)) hi = m2; else lo = m1; }
  p._solved = (lo + hi) / 2; return p._solved;
}

export function foldedPoints(geo, mats, panel) { return panel.poly.map((q) => to3(q).applyMatrix4(mats[panel.id])); }
export function foldedBBox(geo, mats, filter = () => true) {
  const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const p of geo.panels) if (filter(p)) for (const v of foldedPoints(geo, mats, p)) { min.min(v); max.max(v); }
  return { min, max, size: max.clone().sub(min) };
}
