import { unionPolys } from '../builder.js';
import { rect, flap, profile, arcPoints, roundRect, circlePoly, euroSlotParts, clamp, add, mul, sub, norm, outward, edgeLen, lerp } from '../geom.js';

export const glueTaper = (g, D) => Math.min(g * 0.3, D * 0.15);

/** Thumb-notch front polygon (semicircle cut into the top edge). */
export function notchedTop(r, rad) {
  if (!rad) return r.poly;
  const cx = r.x + r.w / 2; const arc = arcPoints([cx - rad, r.y], [cx + rad, r.y], -rad, 16);
  return [r.poly[0], ...arc, r.poly[1], r.poly[2], r.poly[3]];
}

/**
 * Four-panel tube with glue flap. Flat order (x): glue | back | left | front | right. Root = front.
 * Returns rects. Fold space: front at z=0, box extends to -z, x = A, y = D, z = B.
 */
export function tube(b, { A, B, D, g, x0 = 0, y0 = 0, pre = '', frontExtra, faces = { front: 'front', back: 'back', left: 'left', right: 'right' }, root = {} }) {
  const X = [x0, x0 + g, x0 + g + A, x0 + g + A + B, x0 + g + 2 * A + B];
  const back = rect(X[1], y0, A, D), left = rect(X[2], y0, B, D), front = rect(X[3], y0, A, D), right = rect(X[4], y0, B, D);
  const fx = frontExtra ? frontExtra(front) : {};
  b.add(pre + 'front', fx.poly || front.poly, { face: faces.front, holes: fx.holes, ...root });
  b.add(pre + 'left', left.poly, { parent: pre + 'front', hinge: front.left, face: faces.left });
  b.add(pre + 'back', back.poly, { parent: pre + 'left', hinge: left.left, face: faces.back });
  b.add(pre + 'right', right.poly, { parent: pre + 'front', hinge: front.right, face: faces.right });
  const c = glueTaper(g, D);
  const gl = flap(back.left, g, { o1: c, o2: c });
  b.add(pre + 'glue', gl.poly, { parent: pre + 'back', hinge: gl.hinge, kind: 'glue', layer: 1 });
  b.glueArea(gl.poly);
  return { back, left, front, right, X, glue: gl };
}

export function tuckLid(b, { id, parent, edge, B, tk, face, faceRot = 0, openable = true }) {
  const lid = flap(edge, B);
  b.add(id, lid.poly, { parent, hinge: lid.hinge, face, faceRot, kind: 'lid', openable });
  const W = edgeLen(edge);
  const tf = flap(lid.far, tk, { o1: 1, o2: 1, r: Math.min(tk * 0.7, W * 0.22) });
  b.add(id + 'Tuck', tf.poly, { parent: id, hinge: tf.hinge, kind: 'tuck', layer: 1 });
  return lid;
}
export function dust(b, { id, parent, edge, df }) {
  const ins = Math.min(df * 0.35, edgeLen(edge) * 0.25);
  const f = flap(edge, df, { o1: ins, o2: ins, r: 2 });
  b.add(id, f.poly, { parent, hinge: f.hinge, kind: 'dust', layer: 1 });
}
/** Seal-end (glued) closure: outer major on `outer` panel (full depth), inner major + two minor flaps. */
export function sealEnd(b, { pre, outerP, innerP, outerE, innerE, sideA, sideB, eA, eB, B, A, face, faceRot }) {
  const om = flap(outerE, B);
  b.add(pre + 'Major', om.poly, { parent: outerP, hinge: om.hinge, face, faceRot, kind: 'flap', layer: 0 });
  const im = flap(innerE, B * 0.6, { o1: 1, o2: 1 });
  b.add(pre + 'Inner', im.poly, { parent: innerP, hinge: im.hinge, kind: 'flap', layer: 2 });
  b.glueArea(im.poly);
  const dm = Math.min(A * 0.45, B * 0.8);
  for (const [i, e, p] of [[1, eA, sideA], [2, eB, sideB]]) {
    const f = flap(e, dm, { o1: Math.min(dm * 0.3, B * 0.2), o2: Math.min(dm * 0.3, B * 0.2), r: 2 });
    b.add(pre + 'Minor' + i, f.poly, { parent: p, hinge: f.hinge, kind: 'dust', layer: 3 });
  }
}
/** 1-2-3 snap-lock bottom. eF/eBk are bottom edges (width A) of front/back, eL/eR of sides (width B). */
export function snapLock(b, { pre = 'snap', front, back, left, right, eF, eBk, eL, eR, A, B }) {
  const h = B / 2, tw = A * 0.3, tl = B * 0.22, c = Math.min(3, A * 0.08);
  const fp = profile(eF, [[0, 0], [A, 0], [A - 1, h - c], [A - c, h], [A / 2 + tw / 2, h], [A / 2 + tw / 2 - 1, h + tl], [A / 2 - tw / 2 + 1, h + tl], [A / 2 - tw / 2, h], [c, h], [1, h - c]]);
  b.add(pre + 'F', fp, { parent: front, hinge: eF, kind: 'lock', face: 'bottom' });
  const bp = profile(eBk, [[0, 0], [A, 0], [A - 1, h - c], [A - c, h], [A / 2 + tw / 2 + 0.5, h], [A / 2 + tw / 2 + 0.5, h - tl], [A / 2 - tw / 2 - 0.5, h - tl], [A / 2 - tw / 2 - 0.5, h], [c, h], [1, h - c]]);
  b.add(pre + 'B', bp, { parent: back, hinge: eBk, kind: 'lock' });
  const ds = Math.min(A * 0.45, B * 0.5);
  for (const [n, e, p] of [['L', eL, left], ['R', eR, right]]) {
    const f = flap(e, ds, { o1: Math.min(ds * 0.4, B * 0.3), o2: Math.min(ds * 0.2, B * 0.15), r: 1.5 });
    b.add(pre + n, f.poly, { parent: p, hinge: f.hinge, kind: 'lock', layer: 1 });
  }
}
/** Auto-lock / crash-lock bottom with glue webs on the A-wide flaps. */
export function crashLock(b, { pre = 'crash', front, back, left, right, eF, eBk, eL, eR, A, B }) {
  const h = B / 2, lk = Math.min(B * 0.18, 10), web = Math.min(h, A * 0.45);
  const major = (e, parent, id, face) => {
    const pts = [[0, 0], [A, 0], [A, web], [A - web, web], [A - web, h + lk], [Math.min(lk, (A - web) * 0.4), h + lk], [0, h + lk - Math.min(lk, (A - web) * 0.4)]];
    const poly = profile(e, pts);
    b.add(id, poly, { parent, hinge: e, kind: 'lock', face, layer: 0 });
    const d = profile(e, [[A, 0], [A - web, web]]); b.crease(d[0], d[1]);
    b.glueArea(profile(e, [[A - 0.5, 1.5], [A - 0.5, web - 0.5], [A - web + 2, web - 0.5]]));
  };
  major(eF, front, pre + 'F', 'bottom'); major(eBk, back, pre + 'B', null);
  const ds = Math.min(A * 0.5 - 0.5, B * 0.9);
  for (const [n, e, p] of [['L', eL, left], ['R', eR, right]]) {
    const f = flap(e, ds, { o1: Math.min(ds * 0.5, B * 0.35), o2: Math.min(ds * 0.15, B * 0.1), r: 1.5 });
    b.add(pre + n, f.poly, { parent: p, hinge: f.hinge, kind: 'lock', layer: 1 });
  }
}

/** Hang hole polygons centred at (cx, cy). */
export function hangHole(cx, cy, avail) {
  if (avail >= 40) return { parts: unionPolys(euroSlotParts(cx, cy - 3)), kind: 'euro' };
  return { parts: [circlePoly(cx, cy, Math.min(3.5, avail * 0.2), 28)], kind: 'round' };
}

/**
 * Tray: base + 4 walls. Long walls (front/back on base bottom/top edges) carry glue corner flaps;
 * end walls (left/right) fold over (double) to cover them. Base is the root; walls fold to -z.
 */
export function tray(b, { pre = '', x0, y0, A, B, D, t, double = true, faces = { base: 'bottom', front: 'front', back: 'back', left: 'left', right: 'right' }, root = {}, skipBackCorners = false, mirror = false }) {
  const base = rect(x0, y0, A, B);
  b.add(pre + 'base', base.poly, { face: faces.base, ...root });
  const f = Math.min(B * 0.45, Math.max(10, D * 0.8));
  const walls = {};
  // mirror: the model is shown rotated 180° about the vertical axis, so the flat-left wall ends up on the viewer's right
  const wallDef = [['front', base.bottom, 180], ['back', base.top, 0], ['left', base.left, 270], ['right', base.right, 90]];
  const faceName = (n) => (mirror && n === 'left' ? faces.right : mirror && n === 'right' ? faces.left : faces[n]);
  for (const [n, e, fr] of wallDef) {
    const w = flap(e, D);
    b.add(pre + n, w.poly, { parent: pre + 'base', hinge: w.hinge, kind: 'wall', face: faceName(n), faceRot: fr });
    walls[n] = w;
    if ((n === 'front' || n === 'back') && !(skipBackCorners && n === 'back')) {
      for (const [k, se] of [['1', w.s1], ['2', w.s2]]) {
        const isStart = true; // side edge runs base → rim for s1, rim → base for s2
        const o = k === '1' ? { o1: Math.min(f * 0.3, D * 0.3), o2: 1 } : { o1: 1, o2: Math.min(f * 0.3, D * 0.3) };
        const cf = flap(se, f, o);
        b.add(pre + n + 'C' + k, cf.poly, { parent: pre + n, hinge: cf.hinge, kind: 'corner', layer: 1 });
        b.glueArea(cf.poly);
      }
    }
    if ((n === 'left' || n === 'right') && double) {
      const iw = flap(w.far, D - t, { o1: 1, o2: 1 });
      b.add(pre + n + 'In', iw.poly, { parent: pre + n, hinge: iw.hinge, angle: 180, kind: 'inner', layer: 2 });
    }
  }
  return { base, walls, f };
}

export { MATERIALS } from '../materials.js';
