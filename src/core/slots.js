// Per-slot model for inserts (EVA / 吸塑 / 纸盒 / 纸卡).
// Every slot is its own object: shape, size, corner radius, rotation, depth, position, finger notch.
// Coordinates are in the insert's own frame: (0,0) = top-left corner, x → right, y → down (mm).
import ClipperLib from 'clipper-lib';
import { rect, roundRect, circlePoly, bbox, area, clamp } from './geom.js';

const SC = 1000;

export const SLOT_SHAPES = [
  { id: 'rect', name: '矩形' },
  { id: 'roundRect', name: '圆角矩形' },
  { id: 'circle', name: '圆形' },
  { id: 'oblong', name: '长圆槽' },
];
export const NOTCH_SIDES = [
  { id: 'top', name: '上' },
  { id: 'bottom', name: '下' },
  { id: 'left', name: '左' },
  { id: 'right', name: '右' },
];
/** Smallest wall (mm) we allow to remain at the insert edge / between slots. */
export const MIN_WALL = { eva: 3, blister: 3, carton: 5, card: 5 };
export const MIN_SLOT = 3;

const fin = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(+v);
const r2 = (n) => Math.round(n * 100) / 100;

function dedup(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-4) out.push(p);
  }
  if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 1e-4) out.pop();
  return out;
}
const toC = (poly) => poly.map(([x, y]) => ({ X: Math.round(x * SC), Y: Math.round(y * SC) }));
const fromC = (path) => path.map((p) => [p.X / SC, p.Y / SC]);

function unionTwo(a, b) {
  const c = new ClipperLib.Clipper();
  c.AddPath(toC(a), ClipperLib.PolyType.ptSubject, true);
  c.AddPath(toC(b), ClipperLib.PolyType.ptClip, true);
  const res = new ClipperLib.Paths();
  c.Execute(ClipperLib.ClipType.ctUnion, res, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  if (!res.length) return a;
  let best = res[0], ba = 0;
  for (const p of res) { const ar = Math.abs(ClipperLib.Clipper.Area(p)); if (ar > ba) { ba = ar; best = p; } }
  const out = fromC(best);
  return Math.sign(area(out)) === Math.sign(area(a)) ? out : out.reverse();
}

/** Intersection area (mm²) of two polygons. */
export function polyIntersectArea(a, b) {
  const c = new ClipperLib.Clipper();
  c.AddPath(toC(a), ClipperLib.PolyType.ptSubject, true);
  c.AddPath(toC(b), ClipperLib.PolyType.ptClip, true);
  const res = new ClipperLib.Paths();
  c.Execute(ClipperLib.ClipType.ctIntersection, res, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return res.reduce((s, p) => s + Math.abs(ClipperLib.Clipper.Area(p)) / (SC * SC), 0);
}

function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
/** Smallest distance between two (non-overlapping) polygon outlines. */
export function polyGap(a, b) {
  let d = Infinity;
  for (const [P, Q] of [[a, b], [b, a]]) {
    for (const p of P) for (let i = 0; i < Q.length; i++) d = Math.min(d, segDist(p, Q[i], Q[(i + 1) % Q.length]));
  }
  return d;
}

/** Default values for one slot. */
export function defaultSlot(ins, over = {}) {
  const w = Math.round(clamp(ins.L * 0.5, 8, Math.max(8, ins.L - 6)));
  const h = Math.round(clamp(Math.min(30, ins.W * 0.4), 8, Math.max(8, ins.W - 6)));
  return { shape: 'roundRect', w, h, r: null, rot: 0, depth: null, x: ins.L / 2, y: ins.W / 2, notch: false, notchSide: 'top', notchR: 8, ...over };
}

/** Clean up one raw slot (from saved params or the UI). Never throws. */
export function normalizeSlot(raw = {}, ins) {
  const shape = SLOT_SHAPES.some((s) => s.id === raw.shape) ? raw.shape : 'roundRect';
  let w = fin(raw.w) ? clamp(+raw.w, MIN_SLOT, 2000) : 30;
  let h = fin(raw.h) ? clamp(+raw.h, MIN_SLOT, 2000) : 30;
  if (shape === 'circle') h = w;
  let rot = fin(raw.rot) ? +raw.rot : 0;
  rot = ((rot % 360) + 540) % 360 - 180; // (-180, 180]
  if (rot === -180) rot = 180;
  const maxR = Math.min(w, h) / 2;
  const r = shape === 'roundRect' && fin(raw.r) ? clamp(+raw.r, 0, maxR) : null;
  const depth = fin(raw.depth) && +raw.depth > 0 ? +raw.depth : null;
  const notchSide = NOTCH_SIDES.some((s) => s.id === raw.notchSide) ? raw.notchSide : 'top';
  const notchR = fin(raw.notchR) ? clamp(+raw.notchR, 2, 40) : 8;
  return {
    shape, w: r2(w), h: r2(h), r: r === null ? null : r2(r), rot: r2(rot), depth,
    x: fin(raw.x) ? r2(+raw.x) : r2((ins?.L ?? 0) / 2),
    y: fin(raw.y) ? r2(+raw.y) : r2((ins?.W ?? 0) / 2),
    notch: !!raw.notch, notchSide, notchR: r2(notchR),
  };
}

/** Polygon of one slot in insert coordinates (rotation + finger notch applied). */
export function slotPolygon(s) {
  let base;
  if (s.shape === 'circle') base = dedup(circlePoly(0, 0, s.w / 2, 28));
  else if (s.shape === 'oblong' && Math.abs(s.w - s.h) > 0.05) base = dedup(roundRect(-s.w / 2, -s.h / 2, s.w, s.h, Math.min(s.w, s.h) / 2, 8));
  else if (s.shape === 'oblong') base = dedup(circlePoly(0, 0, s.w / 2, 28));
  else if (s.shape === 'roundRect' && Math.min(s.w, s.h) > 3) {
    const r = s.r != null ? s.r : Math.max(0.5, Math.min(s.w, s.h) * 0.24);
    base = r > 0.05 ? dedup(roundRect(-s.w / 2, -s.h / 2, s.w, s.h, r, 6)) : rect(-s.w / 2, -s.h / 2, s.w, s.h).poly;
  } else base = rect(-s.w / 2, -s.h / 2, s.w, s.h).poly;
  let poly = base;
  if (s.notch) {
    const hx = s.w / 2, hy = s.shape === 'circle' ? s.w / 2 : s.h / 2;
    const [px, py] = s.notchSide === 'top' ? [0, -hy] : s.notchSide === 'bottom' ? [0, hy] : s.notchSide === 'left' ? [-hx, 0] : [hx, 0];
    poly = unionTwo(base, dedup(circlePoly(px, py, s.notchR, 20)));
  }
  const a = (s.rot * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a);
  return poly.map(([x, y]) => [s.x + x * co - y * si, s.y + x * si + y * co]);
}

/** Offsets from the slot centre to the left / right / top / bottom of its outline. */
export function slotExtents(s) {
  const bb = bbox(slotPolygon({ ...s, x: 0, y: 0 }));
  return { l: -bb.x, r: bb.x + bb.w, t: -bb.y, b: bb.y + bb.h, w: bb.w, h: bb.h };
}

/**
 * Check slots against the insert outline and each other. Returns plain-Chinese warnings.
 * type: eva | blister | carton | card
 */
export function validateSlots(slots, ins, type) {
  const minWall = MIN_WALL[type] ?? 3;
  const warnings = [];
  const polys = slots.map((s) => s.poly || slotPolygon(s));
  const f1 = (n) => (Math.round(n * 10) / 10).toString();
  polys.forEach((p, i) => {
    const bb = bbox(p);
    const over = [];
    if (bb.x < -0.01) over.push('左边');
    if (bb.x + bb.w > ins.L + 0.01) over.push('右边');
    if (bb.y < -0.01) over.push('上边');
    if (bb.y + bb.h > ins.W + 0.01) over.push('下边');
    if (over.length) {
      warnings.push({ kind: 'bounds', slots: [i], text: `第 ${i + 1} 个槽超出了内衬的${over.join('、')}，请移动或缩小。` });
      return;
    }
    const wall = Math.min(bb.x, bb.y, ins.L - (bb.x + bb.w), ins.W - (bb.y + bb.h));
    if (wall < minWall - 0.01) {
      warnings.push({ kind: 'wall', slots: [i], text: `第 ${i + 1} 个槽离内衬边缘只剩 ${f1(wall)} mm，小于最小壁厚 ${minWall} mm，边上容易断裂。` });
    }
  });
  for (let i = 0; i < polys.length; i++) {
    for (let j = i + 1; j < polys.length; j++) {
      const bi = bbox(polys[i]), bj = bbox(polys[j]);
      if (bi.x > bj.x + bj.w + minWall || bj.x > bi.x + bi.w + minWall || bi.y > bj.y + bj.h + minWall || bj.y > bi.y + bi.h + minWall) continue;
      if (polyIntersectArea(polys[i], polys[j]) > 0.05) {
        warnings.push({ kind: 'overlap', slots: [i, j], text: `第 ${i + 1} 个和第 ${j + 1} 个槽重叠了，请错开。` });
        continue;
      }
      const g = polyGap(polys[i], polys[j]);
      if (g < minWall - 0.01) warnings.push({ kind: 'gap', slots: [i, j], text: `第 ${i + 1} 个和第 ${j + 1} 个槽之间只剩 ${f1(g)} mm，小于最小壁厚 ${minWall} mm。` });
    }
  }
  return warnings;
}

/**
 * Snap a dragged slot centre. Candidates: insert centre lines, edge margin, other slots' centres and edges.
 * Returns { x, y, guides:[{axis:'x'|'y', pos}] }.
 */
export function snapSlot(slots, idx, x, y, ins, { tol = 2, grid = 1, margin = 3 } = {}) {
  const me = slots[idx];
  const ex = slotExtents({ ...me, x: 0, y: 0 });
  const xc = [{ at: ins.L / 2, ref: 0, label: 'c' }, { at: margin, ref: -ex.l }, { at: ins.L - margin, ref: ex.r }];
  const yc = [{ at: ins.W / 2, ref: 0, label: 'c' }, { at: margin, ref: -ex.t }, { at: ins.W - margin, ref: ex.b }];
  slots.forEach((o, j) => {
    if (j === idx) return;
    const e = slotExtents({ ...o, x: 0, y: 0 });
    xc.push({ at: o.x, ref: 0 }, { at: o.x - e.l, ref: -ex.l }, { at: o.x + e.r, ref: ex.r }, { at: o.x - e.l, ref: ex.r }, { at: o.x + e.r, ref: -ex.l });
    yc.push({ at: o.y, ref: 0 }, { at: o.y - e.t, ref: -ex.t }, { at: o.y + e.b, ref: ex.b }, { at: o.y - e.t, ref: ex.b }, { at: o.y + e.b, ref: -ex.t });
  });
  const pick = (pos, cands) => {
    let best = null, bd = tol;
    for (const c of cands) {
      const edge = pos + c.ref; // where the reference (centre / left edge / right edge) currently is
      const d = Math.abs(edge - c.at);
      if (d <= bd) { bd = d; best = { v: pos + (c.at - edge), guide: c.at }; }
    }
    return best;
  };
  const sx = pick(x, xc), sy = pick(y, yc);
  const guides = [];
  let nx = x, ny = y;
  if (sx) { nx = sx.v; guides.push({ axis: 'x', pos: sx.guide }); } else nx = Math.round(x / grid) * grid;
  if (sy) { ny = sy.v; guides.push({ axis: 'y', pos: sy.guide }); } else ny = Math.round(y / grid) * grid;
  return { x: r2(nx), y: r2(ny), guides };
}

// ---------- editing helpers (all return new arrays of raw slots) ----------
const cloneRaw = (s) => ({ ...s });
const extOf = (s) => slotExtents(s);

export function addSlot(slots, ins) {
  const n = slots.length;
  const s = defaultSlot(ins);
  if (n) {
    const last = slots[n - 1];
    s.w = last.w; s.h = last.h; s.shape = last.shape; s.r = last.r;
  }
  return placeBeside([...slots.map(cloneRaw)], s, ins);
}
export function duplicateSlot(slots, i, ins) {
  const src = slots[i];
  return placeBeside(slots.map(cloneRaw), { ...src }, ins, src);
}
function placeBeside(slots, s, ins, src = null) {
  const e = extOf(s);
  if (src) {
    const gap = 5;
    // right of the source, else below, else a small diagonal nudge
    const tryR = { ...s, x: src.x + e.r + gap + e.l, y: src.y };
    const tryB = { ...s, x: src.x, y: src.y + e.b + gap + e.t };
    const inside = (c) => c.x - e.l >= 0 && c.x + e.r <= ins.L && c.y - e.t >= 0 && c.y + e.b <= ins.W;
    s = inside(tryR) ? tryR : inside(tryB) ? tryB : { ...s, x: clamp(src.x + 8, e.l, ins.L - e.r), y: clamp(src.y + 8, e.t, ins.W - e.b) };
  } else if (slots.length) {
    // first free position, scanning rows
    const step = 4;
    outer: for (let yy = e.t; yy + e.b <= ins.W; yy += step) {
      for (let xx = e.l; xx + e.r <= ins.L; xx += step) {
        const cand = { ...s, x: xx, y: yy };
        const p = slotPolygon(normalizeSlot(cand, ins));
        if (slots.every((o) => polyIntersectArea(p, slotPolygon(normalizeSlot(o, ins))) < 0.05 && polyGap(p, slotPolygon(normalizeSlot(o, ins))) >= 3)) { s = cand; break outer; }
      }
    }
  }
  slots.push(normalizeSlot(s, ins));
  return slots;
}
export function removeSlot(slots, i) { return slots.filter((_, k) => k !== i).map(cloneRaw); }

export function centerSlot(slots, i, axis, ins) {
  return slots.map((s, k) => (k !== i ? cloneRaw(s) : { ...s, [axis]: r2(axis === 'x' ? ins.L / 2 : ins.W / 2) }));
}
/** Centre the whole group inside the insert. */
export function centerAll(slots, ins) {
  if (!slots.length) return slots;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of slots) { const e = extOf(s); x0 = Math.min(x0, s.x - e.l); x1 = Math.max(x1, s.x + e.r); y0 = Math.min(y0, s.y - e.t); y1 = Math.max(y1, s.y + e.b); }
  const dx = ins.L / 2 - (x0 + x1) / 2, dy = ins.W / 2 - (y0 + y1) / 2;
  return slots.map((s) => ({ ...s, x: r2(s.x + dx), y: r2(s.y + dy) }));
}
/** Equal gaps (also to the insert edges) along an axis, keeping the other axis. axis: 'x' | 'y'. */
export function distribute(slots, ins, axis) {
  const n = slots.length; if (!n) return slots;
  const total = axis === 'x' ? ins.L : ins.W;
  const order = slots.map((s, i) => i).sort((a, b) => slots[a][axis] - slots[b][axis]);
  const size = (s) => { const e = extOf(s); return axis === 'x' ? e.l + e.r : e.t + e.b; };
  const lead = (s) => { const e = extOf(s); return axis === 'x' ? e.l : e.t; };
  const gap = (total - order.reduce((a, i) => a + size(slots[i]), 0)) / (n + 1);
  const out = slots.map(cloneRaw);
  let cur = 0;
  for (const i of order) { cur += gap; out[i][axis] = r2(cur + lead(slots[i])); cur += size(slots[i]); }
  return out;
}
/** Place slots in a row/column with a fixed edge-to-edge spacing, group centred on that axis. */
export function setSpacing(slots, ins, axis, gap) {
  const n = slots.length; if (!n) return slots;
  const total = axis === 'x' ? ins.L : ins.W;
  const order = slots.map((s, i) => i).sort((a, b) => slots[a][axis] - slots[b][axis]);
  const size = (s) => { const e = extOf(s); return axis === 'x' ? e.l + e.r : e.t + e.b; };
  const lead = (s) => { const e = extOf(s); return axis === 'x' ? e.l : e.t; };
  const span = order.reduce((a, i) => a + size(slots[i]), 0) + gap * (n - 1);
  const out = slots.map(cloneRaw);
  let cur = (total - span) / 2;
  for (const i of order) { out[i][axis] = r2(cur + lead(slots[i])); cur += size(slots[i]) + gap; }
  return out;
}
/** Make n copies of the first slot, evenly spread across (沿宽并排) or along (沿长顺排) the insert. */
export function quickArray(slots, n, ins, align = 'across') {
  const src = slots[0] ? cloneRaw(slots[0]) : defaultSlot(ins);
  const k = clamp(Math.round(n) || 1, 1, 24);
  const axis = align === 'along' ? 'x' : 'y';
  const e = extOf(src);
  const size = axis === 'x' ? e.l + e.r : e.t + e.b;
  const room = (axis === 'x' ? ins.L : ins.W) - (k + 1) * 4;
  if (k * size > room && room > 0) { const f = room / (k * size); src.w = r2(Math.max(MIN_SLOT, src.w * f)); src.h = r2(Math.max(MIN_SLOT, src.h * f)); }
  const copies = Array.from({ length: k }, () => ({ ...src, x: ins.L / 2, y: ins.W / 2 }));
  return distribute(copies, ins, axis);
}

const SHAPE_NAME = Object.fromEntries(SLOT_SHAPES.map((s) => [s.id, s.name]));
const f1 = (n) => Number(n).toFixed(1).replace(/\.0$/, '');
/** One-line plain-Chinese description for exports / the title block. */
export function describeSlot(s, i, { type, thick, defaultDepth } = {}) {
  const size = s.shape === 'circle' ? `Ø${f1(s.w)}` : `${f1(s.w)}×${f1(s.h)}`;
  const parts = [`槽${i + 1} ${SHAPE_NAME[s.shape] || s.shape} ${size}`];
  if (s.shape === 'roundRect') parts.push(`圆角R${f1(s.r != null ? s.r : Math.max(0.5, Math.min(s.w, s.h) * 0.24))}`);
  if (Math.abs(s.rot) > 0.01) parts.push(`转${f1(s.rot)}°`);
  if (type === 'eva') parts.push(s.depth && s.depth < thick - 0.01 ? `深${f1(s.depth)}（不通）` : '通孔');
  if (type === 'blister') parts.push(`深${f1(s.depth || defaultDepth)}`);
  parts.push(`中心距左${f1(s.x)} 距上${f1(s.y)}`);
  if (s.notch) parts.push(`手扣位（${NOTCH_SIDES.find((x) => x.id === s.notchSide)?.name}，R${f1(s.notchR)}）`);
  return parts.join('，');
}
