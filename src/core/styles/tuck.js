import { Builder } from '../builder.js';
import { rect, flap, roundRect, clamp } from '../geom.js';
import { tube, tuckLid, dust, sealEnd, snapLock, crashLock, notchedTop, hangHole } from './common.js';

export const tuckParams = (o = {}) => [
  { key: 'glue', label: '粘口宽', hint: '侧面涂胶水那条边的宽度，一般不用改。', def: (c) => Math.min(c.t >= 1.2 ? 30 : 14, c.B - 2) },
  ...(o.top === 'tuck' || o.bottom === 'tuck' ? [{ key: 'tuck', label: '插舌长度', hint: '盖子插进盒子的那一截有多长，一般不用改。', def: (c) => clamp(c.B * 0.45, 10, Math.min(25, c.D * 0.5)) }] : []),
  ...(o.top === 'tuck' || o.bottom === 'tuck' ? [{ key: 'dust', label: '两侧小翼长度', hint: '盖子两边挡住缝隙的小翼，一般不用改。', def: (c) => Math.min(c.A * 0.45, Math.max(c.B * 0.6, 10)) }] : []),
  ...(o.top === 'tuck' && o.topOn !== 'front' ? [{ key: 'thumb', label: '拇指缺口', hint: '前面开一个小缺口，方便揭开盖子。', type: 'bool', def: () => true }] : []),
  ...(o.header ? [{ key: 'headerH', label: '挂头高度', hint: '盒子上方用来挂货架的那一块有多高。', def: (c) => clamp(c.A * 0.6, 25, 45) }, { key: 'headerDouble', label: '双层挂头', hint: '挂头向内折一层，更结实。', type: 'bool', def: () => true }] : []),
  ...(o.window ? [{ key: 'winW', label: '开窗宽', def: (c) => Math.round(c.A * 0.6) }, { key: 'winH', label: '开窗高', def: (c) => Math.round(c.D * 0.5) }, { key: 'winY', label: '开窗上下位置', hint: '正数为往上移，负数为往下移。', def: () => 0 }] : []),
];

/** Generic tuck-end / seal-end / lock-bottom carton. */
export function buildTuck(c, o) {
  const { A, B, D, p } = c; const b = new Builder();
  const g = clamp(p.glue, 5, B - 1); const tk = p.tuck ?? 15; const df = p.dust ?? B * 0.6;
  const thumb = o.top === 'tuck' && o.topOn !== 'front' && p.thumb ? Math.min(8, A * 0.18) : 0;
  const T = tube(b, {
    A, B, D, g,
    frontExtra: (r) => {
      const res = { poly: notchedTop(r, thumb) };
      if (o.window) { const ww = clamp(p.winW, 5, A - 6), wh = clamp(p.winH, 5, D - 10); res.holes = [roundRect(r.cx - ww / 2, r.cy - wh / 2 + p.winY, ww, wh, 3)]; }
      return res;
    },
  });
  if (o.window) b.extra3d({ type: 'film', panel: 'front', poly: b.byId.front.holes[0] });
  const P = { front: T.front, back: T.back };
  const ys = [0, D];
  // top
  if (o.top === 'tuck') {
    const on = o.topOn || 'back';
    tuckLid(b, { id: 'top', parent: on, edge: P[on].top, B, tk, face: 'top', faceRot: on === 'back' ? 180 : 0 });
    dust(b, { id: 'dustTL', parent: 'left', edge: T.left.top, df }); dust(b, { id: 'dustTR', parent: 'right', edge: T.right.top, df });
    ys.push(-B, -B - tk);
  } else if (o.top === 'seal') {
    sealEnd(b, { pre: 'top', outerP: 'front', innerP: 'back', outerE: T.front.top, innerE: T.back.top, sideA: 'left', sideB: 'right', eA: T.left.top, eB: T.right.top, A, B, face: 'top', faceRot: 0 });
    ys.push(-B);
  }
  // bottom
  if (o.bottom === 'tuck') {
    const on = o.bottomOn || 'back';
    tuckLid(b, { id: 'bottom', parent: on, edge: P[on].bottom, B, tk, face: 'bottom', faceRot: on === 'back' ? 180 : 0, openable: false });
    dust(b, { id: 'dustBL', parent: 'left', edge: T.left.bottom, df }); dust(b, { id: 'dustBR', parent: 'right', edge: T.right.bottom, df });
    ys.push(D + B, D + B + tk);
  } else if (o.bottom === 'seal') {
    sealEnd(b, { pre: 'bot', outerP: 'front', innerP: 'back', outerE: T.front.bottom, innerE: T.back.bottom, sideA: 'left', sideB: 'right', eA: T.left.bottom, eB: T.right.bottom, A, B, face: 'bottom', faceRot: 0 });
    ys.push(D + B);
  } else if (o.bottom === 'snap') {
    snapLock(b, { front: 'front', back: 'back', left: 'left', right: 'right', eF: T.front.bottom, eBk: T.back.bottom, eL: T.left.bottom, eR: T.right.bottom, A, B });
  } else if (o.bottom === 'crash') {
    crashLock(b, { front: 'front', back: 'back', left: 'left', right: 'right', eF: T.front.bottom, eBk: T.back.bottom, eL: T.left.bottom, eR: T.right.bottom, A, B });
  }
  if (o.header) {
    const hh = Math.max(12, p.headerH);
    const hd = flap(T.back.top, hh);
    const cx = T.back.cx, holeY = -hh + Math.min(10, hh * 0.35);
    const hole = hangHole(cx, holeY, A);
    b.add('header', hd.poly, { parent: 'back', hinge: hd.hinge, angle: 0, join: true, kind: 'header', holes: hole.parts, face: p.headerDouble ? null : 'header' });
    if (p.headerDouble) {
      const h2 = flap(hd.far, hh - 0.5, { o1: 0.5, o2: 0.5 });
      const mir = hole.parts.map((ring) => ring.map(([x, y]) => [x, 2 * -hh - y]).reverse());
      b.add('header2', h2.poly, { parent: 'header', hinge: h2.hinge, angle: 180, kind: 'header', holes: mir, layer: 1, face: 'header', faceRot: 180 });
      b.glueArea(roundRect(T.back.x + 3, -2 * hh + 3, A - 6, hh - 8, 2));
    }
  }
  b.chains([...T.X, T.X[4] + B], D, ys, T.X[1]);
  return b;
}
export const tuckExpect = (c) => ({ size: [c.A, c.D, c.B], filter: (p) => p.kind !== 'header', faces: { front: [c.A, c.D], back: [c.A, c.D], left: [c.B, c.D], right: [c.B, c.D] } });
