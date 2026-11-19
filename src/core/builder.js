import ClipperLib from 'clipper-lib';
import { add, sub, norm, dot, cross, dist, len, bbox, area, centroid, pointOnSegment } from './geom.js';

const SCALE = 1000; // clipper integer scale (µm)
const toC = (poly) => poly.map((p) => ({ X: Math.round(p[0] * SCALE), Y: Math.round(p[1] * SCALE) }));
const fromC = (path) => path.map((p) => [p.X / SCALE, p.Y / SCALE]);

export const FACE_NAMES = { front: '正面', back: '背面', left: '左侧面', right: '右侧面', top: '顶面', bottom: '底面', header: '挂头/展示面', inside: '内面' };
export const FACE_EN = { front: 'FRONT', back: 'BACK', left: 'LEFT', right: 'RIGHT', top: 'TOP', bottom: 'BOTTOM', header: 'HEADER', inside: 'INSIDE' };
export const KIND_NAMES = { panel: '', glue: '粘口', tuck: '插舌', dust: '防尘翼', lid: '盖', flap: '折翼', lock: '锁扣', wall: '墙板', inner: '内折', corner: '粘角', header: '挂头', handle: '提手', ear: '耳翼' };
export const KIND_EN = { glue: 'GLUE', tuck: 'TUCK', dust: 'DUST FLAP', lid: 'LID', flap: 'FLAP', lock: 'LOCK', wall: 'WALL', inner: 'INNER', corner: 'CORNER', header: 'HEADER', handle: 'HANDLE', ear: 'EAR' };

/**
 * Collects panels (a hinge tree for 3D folding) plus extra lines; then derives cut/crease lines.
 * Panel: { id, poly, holes, parent, hinge:[p1,p2], angle (deg, + = fold away from printed side), face, faceRot, kind, label, layer, openable, solve }
 */
export class Builder {
  constructor() { this.panels = []; this.byId = {}; this.creases = []; this.perfs = []; this.glue = []; this.dims = []; this.marks = []; this.notes = []; this.roots = []; this.extras3d = []; }
  add(id, poly, o = {}) {
    if (this.byId[id]) throw new Error('duplicate panel ' + id);
    const p = { join: !!o.join, id, poly, holes: o.holes || [], parent: o.parent || null, hinge: o.hinge || null, angle: o.angle ?? 90, face: o.face || null, faceRot: o.faceRot || 0, kind: o.kind || 'panel', label: o.label, layer: o.layer || 0, openable: !!o.openable, solve: o.solve || null, bulge: o.bulge || 0, part: o.part };
    if (!p.parent) { this.roots.push({ id, assemble: o.assemble || null, openLift: o.openLift || 0 }); }
    this.panels.push(p); this.byId[id] = p; return p;
  }
  crease(a, b) { this.creases.push([a, b]); }
  creasePath(pts) { for (let i = 0; i < pts.length - 1; i++) this.creases.push([pts[i], pts[i + 1]]); }
  perf(a, b) { this.perfs.push([a, b]); }
  glueArea(poly) { this.glue.push(poly); }
  /** horizontal dimension of x1..x2 measured at yRef, drawn on line y=yLine */
  dimH(x1, x2, yRef, yLine, text) { if (Math.abs(x2 - x1) > 0.5) this.dims.push({ dir: 'h', x1: Math.min(x1, x2), x2: Math.max(x1, x2), ref: yRef, at: yLine, text }); }
  /** vertical dimension of y1..y2 measured at xRef, drawn on line x=xLine */
  dimV(y1, y2, xRef, xLine, text) { if (Math.abs(y2 - y1) > 0.5) this.dims.push({ dir: 'v', y1: Math.min(y1, y2), y2: Math.max(y1, y2), ref: xRef, at: xLine, text }); }
  mark(m) { this.marks.push(m); }
  note(s) { this.notes.push(s); }
  extra3d(e) { this.extras3d.push(e); }
  /** dimension chains placed automatically outside the layout */
  chains(xs, refY, ys, refX) { this.chainX = xs && { xs, ref: refY }; this.chainY = ys && { ys, ref: refX }; }
}

/** Splits a segment list by line and merges overlapping collinear intervals; subtracts crease intervals from cut. */
function lineKey(a, b) {
  let d = norm(sub(b, a)); if (d[0] < -1e-9 || (Math.abs(d[0]) < 1e-9 && d[1] < 0)) d = [-d[0], -d[1]];
  const nrm = [-d[1], d[0]]; const off = dot(nrm, a);
  return { key: `${d[0].toFixed(4)},${d[1].toFixed(4)},${off.toFixed(2)}`, d, origin: [nrm[0] * off, nrm[1] * off] };
}
function intervals(segs) {
  const groups = new Map();
  for (const [a, b] of segs) {
    if (dist(a, b) < 1e-4) continue;
    const k = lineKey(a, b); let g = groups.get(k.key); if (!g) { g = { d: k.d, o: k.origin, iv: [] }; groups.set(k.key, g); }
    const t1 = dot(sub(a, g.o), g.d), t2 = dot(sub(b, g.o), g.d); g.iv.push([Math.min(t1, t2), Math.max(t1, t2)]);
  }
  return groups;
}
function mergeIv(iv) { iv.sort((a, b) => a[0] - b[0]); const out = []; for (const i of iv) { const l = out[out.length - 1]; if (l && i[0] <= l[1] + 1e-3) l[1] = Math.max(l[1], i[1]); else out.push([...i]); } return out; }
function subtractIv(iv, cut) { let res = iv; for (const c of cut) { const nr = []; for (const i of res) { if (c[1] <= i[0] + 1e-3 || c[0] >= i[1] - 1e-3) { nr.push(i); continue; } if (c[0] > i[0] + 1e-3) nr.push([i[0], c[0]]); if (c[1] < i[1] - 1e-3) nr.push([c[1], i[1]]); } res = nr; } return res; }

export function finalize(b, { bleed = 3 } = {}) {
  const edges = [];
  for (const p of b.panels) {
    for (const ring of [p.poly, ...p.holes]) for (let i = 0; i < ring.length; i++) edges.push([ring[i], ring[(i + 1) % ring.length]]);
  }
  const creaseSegs = [...b.panels.filter((p) => p.hinge && !p.join).map((p) => p.hinge), ...b.creases];
  const joinG = intervals(b.panels.filter((p) => p.join).map((p) => p.hinge));
  const eg = intervals(edges), cg = intervals(creaseSegs), pg = intervals(b.perfs);
  const cut = [], crease = [], perf = [];
  for (const [key, g] of eg) {
    let iv = mergeIv(g.iv);
    const c = cg.get(key); if (c) iv = subtractIv(iv, mergeIv([...c.iv]));
    const pf = pg.get(key); if (pf) iv = subtractIv(iv, mergeIv([...pf.iv]));
    const jn = joinG.get(key); if (jn) iv = subtractIv(iv, mergeIv([...jn.iv]));
    for (const [t1, t2] of iv) if (t2 - t1 > 1e-3) cut.push([add(g.o, [g.d[0] * t1, g.d[1] * t1]), add(g.o, [g.d[0] * t2, g.d[1] * t2])]);
  }
  for (const [, g] of cg) for (const [t1, t2] of mergeIv(g.iv)) crease.push([add(g.o, [g.d[0] * t1, g.d[1] * t1]), add(g.o, [g.d[0] * t2, g.d[1] * t2])]);
  for (const [, g] of pg) for (const [t1, t2] of mergeIv(g.iv)) perf.push([add(g.o, [g.d[0] * t1, g.d[1] * t1]), add(g.o, [g.d[0] * t2, g.d[1] * t2])]);

  // union outline & bleed via Clipper
  const c = new ClipperLib.Clipper();
  for (const p of b.panels) { c.AddPath(toC(p.poly), ClipperLib.PolyType.ptSubject, true); }
  const uni = new ClipperLib.Paths(); c.Execute(ClipperLib.ClipType.ctUnion, uni, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  const holesC = b.panels.flatMap((p) => p.holes.map(toC));
  const outline = fromPaths(uni);
  const off = new ClipperLib.ClipperOffset(2, 0.05 * SCALE); off.AddPaths(uni, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  const bl = new ClipperLib.Paths(); off.Execute(bl, bleed * SCALE);
  const bleedRegion = fromPaths(bl);
  // per-face bleed regions: panel offset by bleed, minus the other panels, within bleed outline
  const faceRegions = {};
  for (const p of b.panels.filter((q) => q.face)) {
    const o2 = new ClipperLib.ClipperOffset(2, 0.05 * SCALE); o2.AddPath(ClipperLib.Clipper.Orientation(toC(p.poly)) ? toC(p.poly) : toC(p.poly).reverse(), ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
    const grown = new ClipperLib.Paths(); o2.Execute(grown, bleed * SCALE);
    const cc = new ClipperLib.Clipper(); cc.AddPaths(grown, ClipperLib.PolyType.ptSubject, true); cc.AddPaths(bl, ClipperLib.PolyType.ptClip, true);
    const inter = new ClipperLib.Paths(); cc.Execute(ClipperLib.ClipType.ctIntersection, inter, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    const others = b.panels.filter((q) => q !== p).map((q) => toC(q.poly));
    const cd = new ClipperLib.Clipper(); cd.AddPaths(inter, ClipperLib.PolyType.ptSubject, true); cd.AddPaths(others, ClipperLib.PolyType.ptClip, true);
    const res = new ClipperLib.Paths(); cd.Execute(ClipperLib.ClipType.ctDifference, res, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    faceRegions[p.id] = fromPaths(res);
  }
  const all = b.panels.flatMap((p) => p.poly);
  const bb = bbox(all); const bbBleed = bbox(bleedRegion.flat());
  const dims = [...b.dims];
  const uniq = (a) => [...new Set(a.map((v) => Math.round(v * 100) / 100))].sort((p, q) => p - q);
  if (b.chainX) { const xs = uniq(b.chainX.xs); for (let i = 0; i < xs.length - 1; i++) dims.push({ dir: 'h', x1: xs[i], x2: xs[i + 1], ref: bb.y1 + 2, at: bb.y1 + 10 }); }
  if (b.chainY) { const ys = uniq(b.chainY.ys); for (let i = 0; i < ys.length - 1; i++) dims.push({ dir: 'v', y1: ys[i], y2: ys[i + 1], ref: bb.x - 2, at: bb.x - 10 }); }
  dims.push({ dir: 'h', x1: bb.x, x2: bb.x1, ref: bb.y1 + 2, at: bb.y1 + 22, overall: true });
  dims.push({ dir: 'v', y1: bb.y, y2: bb.y1, ref: bb.x - 2, at: bb.x - 22, overall: true });
  b.dims = dims.filter((d) => (d.dir === 'h' ? d.x2 - d.x1 : d.y2 - d.y1) > 0.5);
  // faces: one entry per face id (first panel carrying it)
  const faces = [];
  for (const p of b.panels) if (p.face && !faces.find((f) => f.id === p.face)) {
    const pb = bbox(p.poly); faces.push({ id: p.face, panelId: p.id, cx: pb.x + pb.w / 2, cy: pb.y + pb.h / 2, w: (p.faceRot % 180 ? pb.h : pb.w), h: (p.faceRot % 180 ? pb.w : pb.h), rot: p.faceRot });
  }
  return { ...b, byId: b.byId, cut: chain(cut), crease, perf, outline, bleedRegion, faceRegions, bbox: bb, bboxBleed: bbBleed, faces, holesCount: holesC.length, bleed };
}
function fromPaths(paths) { return paths.map(fromC).filter((r) => r.length > 2); }

/** Chain cut segments into polylines (for nicer DXF/PDF output). */
function chain(segs) {
  const key = (p) => `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`;
  const used = new Array(segs.length).fill(false); const map = new Map();
  segs.forEach((s, i) => { for (const e of [0, 1]) { const k = key(s[e]); if (!map.has(k)) map.set(k, []); map.get(k).push(i); } });
  const out = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue; used[i] = true; const line = [segs[i][0], segs[i][1]];
    for (const dir of [1, 0]) {
      let extended = true;
      while (extended) {
        extended = false; const end = dir ? line[line.length - 1] : line[0];
        for (const j of map.get(key(end)) || []) {
          if (used[j]) continue; const s = segs[j]; const nxt = key(s[0]) === key(end) ? s[1] : s[0];
          used[j] = true; if (dir) line.push(nxt); else line.unshift(nxt); extended = true; break;
        }
      }
    }
    out.push(line);
  }
  return out;
}
export function unionPolys(polys) {
  const c = new ClipperLib.Clipper(); for (const p of polys) c.AddPath(toC(p), ClipperLib.PolyType.ptSubject, true);
  const r = new ClipperLib.Paths(); c.Execute(ClipperLib.ClipType.ctUnion, r, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return fromPaths(r);
}
export const polyArea = area; export { centroid };
