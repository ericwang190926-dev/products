import { Matrix4, Vector3 } from 'three';
import { Builder } from '../builder.js';
import { rect, flap, profile, roundRect, circlePoly, regularOnEdge, arcPoints, clamp, bbox, add, mul, outward, edgeLen } from '../geom.js';
import { tube, tray, snapLock, dust, hangHole, glueTaper } from './common.js';
import { addWrapSheet, trayWrapShape, coverWrapShape } from '../wrap.js';
import { addInsertToBuilder, sleeveInnerSpec } from '../insert.js';

const bboxOf = (b) => bbox(b.panels.flatMap((p) => p.poly));
const to3 = (x, y, z = 0) => new Vector3(x, -y, z);
/** Matrix moving flat point src (in fold space of its root) to target with rotation R (Matrix4). */
function place(src, target, R = new Matrix4()) {
  return new Matrix4().makeTranslation(target.x, target.y, target.z).multiply(R).multiply(new Matrix4().makeTranslation(-src.x, -src.y, -src.z));
}
const glueP = { key: 'glue', label: '粘口宽', def: (c) => Math.min(c.t >= 1.2 ? 30 : 14, c.B - 2) };

// ---------------- 天地盒 lid & base ----------------
export function lidBase(c) {
  const { A, B, D, t, p } = c; const b = new Builder();
  const cl = p.clear;
  const full = p.lidType === 'full';
  const A2 = c.lidA ?? (A + 2 * t + 2 * cl);
  const B2 = c.lidB ?? (B + 2 * t + 2 * cl);
  // 半盖：盖墙高约整盒高度的 1/3，盖坐在底盒口上。全盖：盖墙到桌面，底盒略矮以便套进盖里。
  const Dl = full ? (c.lidD ?? (D + 2 * t + cl)) : clamp(p.lidH, 5, D + t);
  const Db = D;
  const base = tray(b, { pre: '', x0: 0, y0: 0, A, B, D: Db, t, mirror: true });
  const bb = bboxOf(b);
  const lx = bb.x1 + 12 + (2 * Dl - t), ly = B / 2 - B2 / 2;
  tray(b, { pre: 'lid', x0: lx, y0: ly, A: A2, B: B2, D: Dl, t, faces: { base: 'top' }, root: { part: 'lid' } });
  const R = new Matrix4().makeRotationX(Math.PI);
  // 半盖：盖板中面落在底盒口上方 t；全盖：盖墙落到 z=0（桌面），底盒缩在盖内。
  const lidZ = full ? -Dl : -(Db + t);
  b.roots[1].assemble = place(to3(lx + A2 / 2, ly + B2 / 2), to3(A / 2, B / 2, lidZ), R);
  b.roots[1].openLift = [0, 0, -(Dl + Math.max(20, Db * 0.4))];
  b.byId.lidbase.faceRot = 180;
  b.chains([base.base.x - 2 * Db + t, base.base.x - Db, 0, A, A + Db, A + 2 * Db - t], 0, [-Db, 0, B, B + Db], 0);
  if (full) b.note('全盖（天盖盖到底）：外尺寸是盒盖外面；底盒按板厚和缝隙略缩小，套进盖里，盖墙落到盒底。');
  else b.note('鞋盒式半盖：外尺寸是盒盖长宽和整盒高度；盖只盖住一部分高度，底盒按缝隙略小以便盖上。');
  if (c.wrap) {
    const turn = c.turnIn ?? 15;
    const bbw = bboxOf(b);
    const x = bbw.x1 + 18;
    const baseSh = trayWrapShape({ Lo: A + t, Wo: B + t, wall: Db, turn });
    addWrapSheet(b, { id: 'wrapBase', x0: x, y0: 0, shape: baseSh, label: '裱纸（底盒）' });
    const lidSh = trayWrapShape({ Lo: A2 + t, Wo: B2 + t, wall: Dl, turn });
    addWrapSheet(b, { id: 'wrapLid', x0: x, y0: baseSh.h + 12, shape: lidSh, label: '裱纸（盒盖）' });
    b.note(`硬盒裱纸已按板厚和 ${turn}mm 包边自动展开，与灰板刀版分开裁切。`);
  }
  b.insertSpec = addInsertToBuilder(b, c, { L: c.inner.L, W: c.inner.W, H: c.inner.H }, {
    panelId: 'base', cx: A / 2, cy: B / 2, baseT: t, assemble: null, openLift: 0, rotated: false,
  });
  return b;
}
export const lidBaseExpect = (c) => {
  const cl = c.p.clear;
  const A2 = c.lidA ?? (c.A + 2 * c.t + 2 * cl);
  const B2 = c.lidB ?? (c.B + 2 * c.t + 2 * cl);
  if (c.p.lidType === 'full') {
    const Dl = c.lidD ?? (c.D + 2 * c.t + cl);
    return { size: [A2, B2, Dl] };
  }
  return { size: [A2, B2, c.D + c.t] };
};


/** 书型盒包边灰板高度：合上后从封面走到盒底（外高度含板厚，再减去铰缝绕过封面板厚的那一段）。 */
export function bookFlapGap(t, flapGap) {
  const g = flapGap == null || flapGap === '' || Number.isNaN(+flapGap)
    ? Math.round(1.5 * t * 10) / 10
    : +flapGap;
  return Math.max(t, g);
}
export function bookFullFlapH(c) {
  return Math.max(12, +(c.outer.H - bookFlapGap(c.t, c.p?.flapGap)).toFixed(2));
}

// ---------------- 书型盒 book box ----------------
export function bookBox(c) {
  const { A, B, D, t, p } = c; const b = new Builder();
  const ov = p.overhang; const Lc = A + t + 2 * ov, Wc = B + t + 2 * ov, Hs = D + 1.5 * t;
  const flapGap = bookFlapGap(t, p.flapGap);
  const fullFlapH = bookFullFlapH(c);
  const flapH = clamp(p.flapH, 12, fullFlapH);
  const magR = Math.max(3, (p.magnetD ?? 12) / 2);
  // 默认长边打开（更像翻书）；短边打开保留原来从短头掀开的做法
  const shortOpen = p.openDir === 'short';
  const span = shortOpen ? Wc : Lc; // 沿书脊 / 开盒边的长度
  const leaf = shortOpen ? Lc : Wc; // 封面进深（垂直于书脊）
  const inset = Math.min(p.magnetInset ?? 18, Math.max(8, span / 2 - magR - 1));
  // 开盒边：包边 + 铰缝 + 封面 + 书脊 + 封底
  const xHinge = flapH, xLid = flapH + flapGap, xSpine = xLid + leaf, xBack = xSpine + Hs;
  const flapR = rect(0, 0, flapH, span);
  const hingeR = rect(xHinge, 0, flapGap, span);
  const front = rect(xLid, 0, leaf, span);
  const spine = rect(xSpine, 0, Hs, span);
  const back = rect(xBack, 0, leaf, span);
  b.add('cover', back.poly, { face: 'bottom', kind: 'panel' });
  b.add('spine', spine.poly, { parent: 'cover', hinge: back.left, face: 'left', faceRot: 270 });
  b.add('lid', front.poly, { parent: 'spine', hinge: spine.left, face: 'top', faceRot: shortOpen ? 180 : 90, openable: true, kind: 'lid' });
  // 铰缝先随封面翻到水平，再把包边向下折 90°，合上时盖住内盒前墙
  b.add('flapHinge', hingeR.poly, { parent: 'lid', hinge: front.left, angle: 90, kind: 'panel' });
  b.add('flap', flapR.poly, { parent: 'flapHinge', hinge: hingeR.left, angle: 0, kind: 'hem' });
  const trayA = shortOpen ? A : B, trayB = shortOpen ? B : A;
  const tx = back.x + back.w + 15 + 2 * D, ty = span / 2 - trayB / 2;
  const faces = shortOpen
    ? { front: 'back', back: 'front', right: 'right' }
    : { front: 'right', back: 'left', right: 'front', left: 'back' };
  tray(b, { pre: 't', x0: tx, y0: ty, A: trayA, B: trayB, D, t, faces, root: { part: 'tray' } });
  b.roots[1].assemble = place(to3(tx + trayA / 2, ty + trayB / 2), to3(back.cx, back.cy, -t));
  const ys = [inset, span - inset];
  const fx = flapR.x + flapH / 2;
  for (const y of ys) b.mark({ type: 'magnet', x: fx, y, r: magR, text: '磁铁', panel: 'flap' });
  // 开盒侧 = 内盒右墙（与包边相对）；从上口往下 flapH/2，左右边距与包边相同
  const mx = tx + trayA + D - flapH / 2;
  for (const y of ys) b.mark({ type: 'magnet', x: mx, y, r: magR, text: '磁铁', panel: 'tright' });
  b.chains([0, flapH, xLid, xSpine, xBack, xBack + leaf], span, [0, span], 0);
  b.note(`书型盒：封面与内盒分开做，内盒底粘在封底上；${shortOpen ? '短边' : '长边'}打开，开盒那边的包边从封面盖到盒底，左右各一颗磁铁，合上时包边盖住内盒前墙。`);
  b.note('磁铁内嵌在灰板里，外面看不到。');
  if (!shortOpen) b.view3d = { rx: 90, ry: -90 };
  if (c.wrap) {
    const turn = c.turnIn ?? 15;
    const bbw = bboxOf(b);
    const x = bbw.x1 + 18;
    const coverW = flapH + flapGap + 2 * leaf + Hs;
    const cov = coverWrapShape({ w: coverW, h: span, turn, bands: [{ x: flapH, w: flapGap }, { x: flapH + flapGap + leaf, w: Hs }] });
    addWrapSheet(b, { id: 'wrapCover', x0: x, y0: 0, shape: cov, label: '裱纸（封面）' });
    const traySh = trayWrapShape({ Lo: A + t, Wo: B + t, wall: D, turn });
    addWrapSheet(b, { id: 'wrapTray', x0: x, y0: cov.h + 12, shape: traySh, label: '裱纸（内盒）' });
    b.note(`硬盒裱纸已按板厚和 ${turn}mm 包边自动展开，与灰板刀版分开裁切。`);
  }
  b.insertSpec = addInsertToBuilder(b, c, { L: c.inner.L, W: c.inner.W, H: c.inner.H }, {
    panelId: 'tbase', cx: tx + trayA / 2, cy: ty + trayB / 2, baseT: t,
    assemble: b.roots[1].assemble, openLift: 0, rotated: !shortOpen,
  });
  return b;
}
export const bookExpect = (c) => { const L = c.A + c.t + 2 * c.p.overhang; return { size: [L, c.B + c.t + 2 * c.p.overhang, c.D + 1.5 * c.t] }; };


// ---------------- 抽屉盒 drawer ----------------
export function drawer(c) {
  const { A, B, D, t, p } = c; const b = new Builder();
  const cl = p.clear; const As = B + 2 * t + 2 * cl, Ds = D + 2 * t + cl, Ls = A + t;
  const g = Math.min(p.glue, Ds - 2);
  const T = tube(b, { A: As, B: Ds, D: Ls, g, faces: { front: 'top', back: 'bottom', left: 'left', right: 'right' } });
  // finger notches on both sleeve-top ends? (thumb cut on the open ends of the top panel)
  const bb = bboxOf(b);
  const tx = bb.x1 + 15 + 2 * D, ty = Ls / 2 - B / 2;
  tray(b, { pre: 't', x0: tx, y0: ty, A, B, D, t, faces: { left: 'drawer' }, root: { part: 'tray' } });
  const R = new Matrix4().set(0, 1, 0, 0, 1, 0, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1);
  b.roots[1].assemble = place(to3(tx + A / 2, ty + B / 2), to3(T.front.cx, T.front.cy, -(Ds - t)), R);
  b.roots[1].openLift = [0, -A * 0.55, 0];
  b.chains([...T.X, T.X[4] + Ds], Ls, [0, Ls], T.X[1]);
  b.note('抽屉盒：外套和内托分开做；外套会按内托外面再加一点缝隙自动放大。');
  if (c.wrap) {
    const turn = c.turnIn ?? 15;
    const bbw = bboxOf(b);
    addWrapSheet(b, { id: 'wrapTray', x0: bbw.x1 + 18, y0: 0, shape: trayWrapShape({ Lo: A + t, Wo: B + t, wall: D, turn }), label: '裱纸（内托）' });
    b.note(`内托裱纸已按板厚和 ${turn}mm 包边自动展开，与灰板刀版分开裁切。`);
  }
  b.insertSpec = addInsertToBuilder(b, c, { L: c.inner.L, W: c.inner.W, H: c.inner.H }, {
    panelId: 'tbase', cx: tx + A / 2, cy: ty + B / 2, baseT: t,
    assemble: b.roots[1].assemble, openLift: b.roots[1].openLift, rotated: false,
  });
  return b;
}
export const drawerExpect = (c) => ({ size: [c.B + 2 * c.t + 2 * c.p.clear, c.A + c.t, c.D + 2 * c.t + c.p.clear] });

// ---------------- 封套盒 sleeve ----------------
export function sleeve(c) {
  const { A, B, H, t, p } = c; const b = new Builder();
  const g = Math.min(p.glue, B - 2);
  const T = tube(b, { A, B, D: H, g });
  b.chains([...T.X, T.X[4] + B], H, [0, H], T.X[1]);
  const si = sleeveInnerSpec(c);
  b.sleeveInner = si;
  if (si.innerBox !== 'none') {
    const bb = bboxOf(b);
    const tx = bb.x1 + 20 + 2 * si.D;
    const ty = H / 2 - si.B / 2;
    tray(b, {
      pre: 't', x0: tx, y0: ty, A: si.A, B: si.B, D: si.D, t: si.tIn, thick: si.tIn,
      double: si.D > si.tIn + 1.5, faces: {}, root: { part: 'tray' },
    });
    const R = new Matrix4().makeRotationX(Math.PI);
    const zBase = -(B - t / 2 - si.tIn / 2);
    b.roots[1].assemble = place(to3(tx + si.A / 2, ty + si.B / 2), to3(T.front.cx, T.front.cy, zBase), R);
    b.roots[1].openLift = [0, -H * 0.55, 0];
    b.view3d = { rx: -90, ry: 0 };
    b.mark({ type: 'label', x: T.front.cx, y: -7, text: '封套刀版' });
    const trayTopY = Math.min(ty - si.D, 0);
    const innerTitle = si.innerBox === 'rigid'
      ? `内盒刀版（${si.greyGsm}g灰板）`
      : `内盒刀版（${si.paperGsm}g铜版纸折叠）`;
    b.mark({ type: 'label', x: tx + si.A / 2, y: trayTopY - 7, text: innerTitle });
    b.note(si.innerBox === 'rigid'
      ? `封套盒：配灰板裱纸内盒（${si.greyGsm}g灰板 + ${si.wrapGsm}g铜版纸裱面），内盒按封套外尺寸减去板厚与 ${si.cl}mm 缝隙自动计算，并单独展开内盒裱纸。`
      : `封套盒：配 ${si.paperGsm}g 铜版纸折叠内盒，内盒按封套外尺寸减去板厚与 ${si.cl}mm 缝隙自动计算。`);
    const bbw = bboxOf(b);
    const wrapX = bbw.x1 + 20;
    let nextY = 0;
    if (si.innerBox === 'rigid') {
      const turn = c.turnIn ?? 15;
      const traySh = trayWrapShape({ Lo: si.A + si.tIn, Wo: si.B + si.tIn, wall: si.D, turn });
      addWrapSheet(b, { id: 'wrapTray', x0: wrapX, y0: nextY, shape: traySh, label: '裱纸（内盒）' });
      b.mark({ type: 'label', x: wrapX + traySh.w / 2, y: nextY - 7, text: `内盒裱纸（${si.wrapGsm}g铜版纸 · 包边${turn}mm）` });
      nextY += traySh.h + 18;
    }
    if (c.wrap) {
      const turn = c.turnIn ?? 15;
      const covSh = coverWrapShape({ w: g + 2 * A + 2 * B, h: H, turn, bands: [] });
      addWrapSheet(b, { id: 'wrapSleeve', x0: wrapX, y0: nextY, shape: covSh, label: '裱纸（封套）' });
    }
    b.insertSpec = addInsertToBuilder(b, c, si.interior, {
      panelId: 'tbase', cx: tx + si.A / 2, cy: ty + si.B / 2, baseT: si.tIn,
      assemble: b.roots[1].assemble, openLift: b.roots[1].openLift, rotated: false,
    });
  } else {
    b.note('封套盒：仅生成外封套刀版（无内盒）。');
    b.insertSpec = addInsertToBuilder(b, c, {
      L: Math.max(10, c.inner.L),
      W: Math.max(10, c.inner.H),
      H: Math.max(6, c.inner.W),
    }, {
      panelId: 'back', cx: T.back.cx, cy: T.back.cy, baseT: t,
      assemble: null, openLift: 0, rotated: false,
    });
  }
  return b;
}

// ---------------- 腰封 band ----------------
export function band(c) {
  const { A, B, H, p } = c; const b = new Builder();
  const T = tube(b, { A, B, D: H, g: Math.min(p.glue, B - 2) });
  b.chains([...T.X, T.X[4] + B], H, [0, H], T.X[1]);
  return b;
}
export const sleeveExpect = (c) => ({ size: [c.A, c.H, c.B] });

// ---------------- 托盘 tray ----------------
export function plainTray(c) { const b = new Builder(); const { A, B, D, t } = c; tray(b, { x0: 0, y0: 0, A, B, D, t, mirror: true }); b.chains([-2 * D + t, -D, 0, A, A + D, A + 2 * D - t], 0, [-D, 0, B, B + D], 0); return b; }
export const trayExpect = (c) => ({ size: [c.A, c.B, c.D] });

// ---------------- 一体翻盖盒 tray with hinged lid ----------------
export function trayLid(c) {
  const { A, B, D, t, p } = c; const b = new Builder();
  const T = tray(b, { x0: 0, y0: 0, A, B, D, t, mirror: true, faces: { base: 'bottom', front: 'front', back: 'back', left: 'left', right: 'right' } });
  const lid = flap(T.walls.back.far, B);
  b.add('lid', lid.poly, { parent: 'back', hinge: lid.hinge, kind: 'lid', face: 'top', faceRot: 180, openable: true });
  const tk = Math.min(p.tuck, D - 2 * t);
  const tf = flap(lid.far, tk, { o1: 2, o2: 2, r: Math.min(8, tk * 0.5) });
  b.add('lidTuck', tf.poly, { parent: 'lid', hinge: tf.hinge, kind: 'tuck', layer: 3 });
  const sd = Math.min(D - 2 * t, B * 0.5);
  for (const [k, e] of [['1', lid.s1], ['2', lid.s2]]) {
    const o = k === '1' ? { o1: 2, o2: Math.min(sd, B * 0.3) } : { o1: Math.min(sd, B * 0.3), o2: 2 };
    const f = flap(e, sd, { ...o, r: 2 }); b.add('lidSide' + k, f.poly, { parent: 'lid', hinge: f.hinge, kind: 'dust', layer: 3 });
  }
  b.chains([-2 * D + t, -D, 0, A, A + D, A + 2 * D - t], 0, [-D - B - tk, -D - B, -D, 0, B, B + D], 0);
  return b;
}

// ---------------- 飞机盒 mailer (FEFCO 0427 style) ----------------
export function mailer(c) {
  const { A, B, D, t, p } = c; const b = new Builder();
  const base = rect(0, 0, A, B);
  // slots for inner-front lock tabs
  const tabs = [[A * 0.2, A * 0.35], [A * 0.65, A * 0.8]];
  const slotH = t + 1;
  const slots = tabs.map(([x1, x2]) => rect(x1 - 0.5, B - t - slotH - 0.5, x2 - x1 + 1, slotH).poly);
  b.add('base', base.poly, { face: 'bottom', holes: slots });
  const fw = flap(base.bottom, D); b.add('front', fw.poly, { parent: 'base', hinge: fw.hinge, kind: 'wall', face: 'front', faceRot: 180 });
  const ih = D - t, tabD = t + 1;
  const u = (x) => A - x; // front.far runs right→left
  const inner = profile(fw.far, [[0, 0], [A, 0], [A - 1, ih], [u(tabs[0][0]), ih], [u(tabs[0][0]), ih + tabD], [u(tabs[0][1]), ih + tabD], [u(tabs[0][1]), ih], [u(tabs[1][0]), ih], [u(tabs[1][0]), ih + tabD], [u(tabs[1][1]), ih + tabD], [u(tabs[1][1]), ih], [1, ih]]);
  b.add('frontIn', inner, { parent: 'front', hinge: fw.far, angle: 180, kind: 'inner', layer: 2 });
  const bw = flap(base.top, D); b.add('back', bw.poly, { parent: 'base', hinge: bw.hinge, kind: 'wall', face: 'back' });
  for (const [n, e, fr] of [['left', base.left, 270], ['right', base.right, 90]]) {
    const w = flap(e, D); b.add(n, w.poly, { parent: 'base', hinge: w.hinge, kind: 'wall', face: n === 'left' ? 'right' : 'left', faceRot: fr });
    const iw = flap(w.far, D - t, { o1: 1, o2: 1 }); b.add(n + 'In', iw.poly, { parent: n, hinge: iw.hinge, angle: 180, kind: 'inner', layer: 3 });
  }
  const e = Math.min(B * 0.42, Math.max(D, 20));
  for (const [w, id] of [[fw, 'front'], [bw, 'back']]) {
    for (const [k, se] of [['1', w.s1], ['2', w.s2]]) {
      const o = k === '1' ? { o1: 1, o2: Math.min(e * 0.4, D * 0.3) } : { o1: Math.min(e * 0.4, D * 0.3), o2: 1 };
      const f = flap(se, e, { ...o, r: 3 }); b.add(id + 'Ear' + k, f.poly, { parent: id, hinge: f.hinge, kind: 'ear', layer: 1 });
    }
  }
  const lid = flap(bw.far, B); b.add('lid', lid.poly, { parent: 'back', hinge: lid.hinge, kind: 'lid', face: 'top', faceRot: 180, openable: true });
  const tk = Math.max(5, Math.min(p.tuck, D - 2 * t));
  const tf = flap(lid.far, tk, { o1: 2, o2: 2, r: Math.min(10, tk * 0.5) }); b.add('lidTuck', tf.poly, { parent: 'lid', hinge: tf.hinge, kind: 'tuck', layer: 4 });
  const sd = D - 2 * t;
  for (const [k, se] of [['1', lid.s1], ['2', lid.s2]]) {
    const o = k === '1' ? { o1: 2, o2: Math.min(sd * 0.8, B * 0.3) } : { o1: Math.min(sd * 0.8, B * 0.3), o2: 2 };
    const f = flap(se, sd, { ...o, r: 3 }); b.add('lidSide' + k, f.poly, { parent: 'lid', hinge: f.hinge, kind: 'dust', layer: 4 });
  }
  b.chains([-2 * D + t, -D, 0, A, A + D, A + 2 * D - t], 0, [-D - B - tk, -D - B, -D, 0, B, B + D, B + 2 * D - t], 0);
  b.note('飞机盒：前墙和侧墙是双层折进去的，前面的卡舌会插进底板的卡槽，不用涂胶。');
  return b;
}
export const mailerExpect = (c) => ({ size: [c.A, c.B, c.D], tol: c.t + 1.6 });

// ---------------- 展示盒 display box ----------------
export function display(c) {
  const { A, B, D, t, p } = c; const b = new Builder();
  const Hf = clamp(p.frontH, 5, D), hh = Math.max(0, p.headerH);
  const base = rect(0, 0, A, B);
  b.add('base', base.poly, { face: 'bottom' });
  const fw = flap(base.bottom, Hf); b.add('front', fw.poly, { parent: 'base', hinge: fw.hinge, kind: 'wall', face: 'front', faceRot: 180 });
  const bw = flap(base.top, D + hh); b.add('back', bw.poly, { parent: 'base', hinge: bw.hinge, kind: 'wall', face: 'back' });
  const ib = flap(bw.far, D + hh - t, { o1: 0.5, o2: 0.5 }); b.add('backIn', ib.poly, { parent: 'back', hinge: ib.hinge, angle: 180, kind: 'inner', layer: 2, face: 'header', faceRot: 180 });
  const sl = [[0, 0], [0, B], [-Hf, B], [-D, 0]], sr = [[A, 0], [A + D, 0], [A + Hf, B], [A, B]];
  b.add('left', sl, { parent: 'base', hinge: base.left, kind: 'wall', face: 'right', faceRot: 270 });
  b.add('right', sr, { parent: 'base', hinge: base.right, kind: 'wall', face: 'left', faceRot: 90 });
  const f = Math.min(A * 0.3, 25), fF = Math.min(A * 0.3, 25);
  const cf = (id, parent, e, startIsBase, depth, h) => {
    const ch = Math.min(depth * 0.3, h * 0.3);
    const o = startIsBase ? { o1: ch, o2: 1 } : { o1: 1, o2: ch };
    const r = flap(e, depth, o); b.add(id, r.poly, { parent, hinge: r.hinge, kind: 'corner', layer: 1 }); b.glueArea(r.poly);
  };
  cf('leftCB', 'left', [[-D, 0], [0, 0]], false, f, D);
  cf('leftCF', 'left', [[0, B], [-Hf, B]], true, fF, Hf);
  cf('rightCB', 'right', [[A, 0], [A + D, 0]], true, f, D);
  cf('rightCF', 'right', [[A + Hf, B], [A, B]], false, fF, Hf);
  b.chains([-D, -Hf, 0, A, A + Hf, A + D], B, [-(2 * (D + hh) - t), -(D + hh), -D, 0, B, B + Hf], 0);
  b.note('展示盒：背板双层回折，内层为头卡展示面（面向顾客）。');
  return b;
}
export const displayExpect = (c) => ({ size: [c.A, c.B, c.D + Math.max(0, c.p.headerH)] });

// ---------------- 多边形柱盒 polygon prism (hexagon / triangle / octagon) ----------------
export function prism(c, n) {
  const { D, t, p } = c; const b = new Builder();
  const s = c.L + t * Math.tan(Math.PI / n);
  const g = Math.min(p.glue, s * 0.8);
  const ext = 360 / n;
  const P = []; for (let i = 0; i < n; i++) P.push(rect(i * s, 0, s, D));
  b.add('p0', P[0].poly, { face: 'front' });
  const faceFor = (i) => (i === 0 ? 'front' : i === Math.floor(n / 2) ? 'back' : null);
  for (let i = 1; i < n; i++) b.add('p' + i, P[i].poly, { parent: 'p' + (i - 1), hinge: P[i - 1].right, angle: ext, face: faceFor(i) });
  const gl = flap(P[n - 1].right, g, { o1: glueTaper(g, D), o2: glueTaper(g, D) });
  b.add('glue', gl.poly, { parent: 'p' + (n - 1), hinge: gl.hinge, angle: ext, kind: 'glue', layer: 1 }); b.glueArea(gl.poly);
  const ap = s / (2 * Math.tan(Math.PI / n));
  const tk = Math.min(p.tuck, D * 0.5, s * 0.9);
  for (const [side, edgeOf] of [['top', (r) => r.top], ['bottom', (r) => r.bottom]]) {
    const e = edgeOf(P[0]);
    const lid = regularOnEdge(e[0], e[1], n);
    b.add(side, lid, { parent: 'p0', hinge: e, kind: 'lid', face: side, openable: side === 'top' });
    const k = Math.floor(n / 2); const te = [lid[(k + 1) % n], lid[k]];
    const tf = flap(te, tk, { o1: 1, o2: 1, r: Math.min(tk * 0.6, s * 0.2) });
    b.add(side + 'Tuck', tf.poly, { parent: side, hinge: tf.hinge, kind: 'tuck', layer: 1 });
    const dd = ap * 0.55, ins = dd * Math.tan(Math.PI / n) + 0.5;
    const lidB = bbox(lid);
    for (let i = 1; i < n; i++) {
      if (i === 1 && lidB.x1 > P[1].x + 0.5) continue; // the polygon lid already spans this panel's top
      const f = flap(edgeOf(P[i]), dd, { o1: ins, o2: ins, r: 1.5 });
      b.add(side + 'Dust' + i, f.poly, { parent: 'p' + i, hinge: f.hinge, kind: 'dust', layer: 1 });
    }
  }
  b.chains([...P.map((r) => r.x), n * s, n * s + g], D, [0, D], 0);
  return b;
}
export function prismExpect(c, n) {
  const s = c.L + c.t * Math.tan(Math.PI / n);
  const xs = [], zs = []; let x = 0, z = 0, ang = 0;
  for (let i = 0; i < n; i++) { xs.push(x); zs.push(z); x += s * Math.cos(ang); z -= s * Math.sin(ang); ang += (2 * Math.PI) / n; }
  return { size: [Math.max(...xs) - Math.min(...xs), c.D, Math.max(...zs) - Math.min(...zs)] };
}

// ---------------- 枕头盒 pillow ----------------
export function pillow(c) {
  const { L, W, H, t, p } = c; const b = new Builder();
  const s = H / 2, R = (W * W / 4 + s * s) / (2 * s);
  const Wp = 2 * R * Math.asin(Math.min(1, W / (2 * R))) + t;
  const g = Math.min(p.glue, Wp * 0.4), sc = p.arc, Ln = L + t;
  const mk = (x0) => {
    const top = arcPoints([x0, 0], [x0 + Wp, 0], 2 * sc, 28); const bot = arcPoints([x0 + Wp, Ln], [x0, Ln], 2 * sc, 28);
    b.creasePath(arcPoints([x0, 0], [x0 + Wp, 0], sc, 28)); b.creasePath(arcPoints([x0 + Wp, Ln], [x0, Ln], sc, 28));
    return [...top, ...bot];
  };
  b.add('p1', mk(g), { face: 'front', bulge: H / 2 });
  b.add('p2', mk(g + Wp), { parent: 'p1', hinge: [[g + Wp, 0], [g + Wp, Ln]], angle: 180, face: 'back', bulge: H / 2 });
  const gl = flap([[g, Ln], [g, 0]], g, { o1: 2, o2: 2 });
  b.add('glue', gl.poly, { parent: 'p1', hinge: gl.hinge, angle: 180, kind: 'glue', layer: 1 }); b.glueArea(gl.poly);
  b.chains([0, g, g + Wp, g + 2 * Wp], Ln, [-2 * sc, 0, Ln, Ln + 2 * sc], g);
  b.note('枕头盒 3D 为近似曲面预览。弧线深度可在参数中调整。');
  return b;
}

// ---------------- 手提盒 gable ----------------
export function gable(c) {
  const { A, B, D, p } = c; const b = new Builder();
  const g = Math.min(p.glue, B - 2);
  const gh = Math.max(p.gableH, B / 2 + 2), hh = Math.max(15, p.handleH);
  const phi = (Math.asin(B / 2 / gh) * 180) / Math.PI;
  const T = tube(b, { A, B, D, g });
  snapLock(b, { front: 'front', back: 'back', left: 'left', right: 'right', eF: T.front.bottom, eBk: T.back.bottom, eL: T.left.bottom, eR: T.right.bottom, A, B });
  const hw = Math.min(A * 0.55, 95), hht = Math.min(22, hh * 0.45);
  for (const n of ['front', 'back']) {
    const r = T[n]; const gp = flap(r.top, gh);
    b.add(n + 'Gable', gp.poly, { parent: n, hinge: gp.hinge, angle: phi, kind: 'flap', face: n === 'front' ? 'top' : null });
    const hp = flap(gp.far, hh);
    const hole = roundRect(r.cx - hw / 2, -gh - hh + (hh - hht) / 2 - 2, hw, hht, hht / 2, 8);
    b.add(n + 'Handle', hp.poly, { parent: n + 'Gable', hinge: hp.hinge, angle: -phi, kind: 'handle', holes: [hole] });
  }
  for (const n of ['left', 'right']) {
    const r = T[n]; const apex = [r.cx, -gh];
    b.add(n + 'Tri', [[r.x, 0], [r.x + B, 0], apex], { parent: n, hinge: r.top, angle: phi, kind: 'flap' });
    // corner triangles: attach to centre triangle along diagonal; solve so outer corner meets the gable panel corner
    const neighbors = n === 'left' ? [['backGable', [T.back.x + A, -gh]], ['frontGable', [T.front.x, -gh]]] : [['frontGable', [T.front.x + A, -gh]], ['backGable', [T.back.x, -gh]]];
    const corners = [[[r.x, 0], [r.x, -gh]], [[r.x + B, 0], [r.x + B, -gh]]];
    corners.forEach(([C, Tp], i) => {
      b.add(n + 'Cor' + i, [C, Tp, apex], { parent: n + 'Tri', hinge: [C, apex], kind: 'gusset', layer: 1, solve: { target: neighbors[i][0], point: Tp, targetPoint: neighbors[i][1] } });
      if (!(n === 'right' && i === 1)) b.crease(C, Tp);
    });
  }
  b.chains([...T.X, T.X[4] + B], D, [-gh - hh, -gh, 0, D], T.X[1]);
  b.note('手提盒(屋顶盒)：底部为 1-2-3 快锁底；顶部斜面向内合拢，两片提手贴合。');
  return b;
}
export const gableExpect = (c) => { const gh = Math.max(c.p.gableH, c.B / 2 + 2); const phi = Math.asin(c.B / 2 / gh); return { size: [c.A, c.D + gh * Math.cos(phi) + Math.max(15, c.p.handleH), c.B] }; };

// ---------------- 吸塑背卡 / 对折吊卡 ----------------
export function card(c, kind) {
  const { L, H, W, p } = c; const b = new Builder();
  const fr = rect(0, 0, L, H);
  const hole = p.hole ? hangHole(L / 2, Math.min(12, H * 0.08) + 3, L) : null;
  const holes = [];
  let win = null;
  if (kind === 'blister') {
    const ww = clamp(p.winW, 5, L - 6), wh = clamp(p.winH, 5, H - 30);
    win = roundRect(L / 2 - ww / 2, H / 2 - wh / 2 + p.winY, ww, wh, 4);
    if (p.fold) holes.push(win);
    b.extra3d({ type: 'blister', panel: 'front', poly: win, depth: W });
  }
  b.add('front', fr.poly, { face: 'front', holes: [...holes, ...(hole ? hole.parts : [])] });
  if (p.fold) {
    const bk = flap(fr.top, H);
    const mir = hole ? hole.parts.map((ring) => ring.map(([x, y]) => [x, -y]).reverse()) : [];
    b.add('back', bk.poly, { parent: 'front', hinge: bk.hinge, angle: 180, face: 'back', faceRot: 180, holes: mir });
  }
  b.chains([0, L], H, p.fold ? [-H, 0, H] : [0, H], 0);
  if (kind === 'blister') b.note(p.fold ? '对折吸塑卡：前片开窗，吸塑泡壳夹在两层之间。' : '单层吸塑卡：泡壳热封于正面。');
  return b;
}
export const cardExpect = (c) => ({ size: [c.L, c.H, 0] });
