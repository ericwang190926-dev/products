import { STYLE_MAP } from './styles/index.js';
import { finalize } from './builder.js';
import { resolveBoxDims } from './dims.js';

/** Resolve context (mid-plane panel sizes + params with smart defaults) for a style. */
export function makeContext(style, { L, W, H, t, params = {}, wrap = false, turnIn = 15, faceT = 0, dimMode } = {}) {
  const W0 = style.dims.W ? W : L;
  const sizes = resolveBoxDims(style, { L, W: W0, H, t, dimMode, params });
  const i = sizes.inner;
  const c = {
    L: i.L, W: i.W, H: i.H, t,
    A: sizes.A, B: sizes.B, D: sizes.D,
    p: {}, wrap: !!wrap, turnIn: turnIn ?? 15, faceT: faceT || 0,
    dimMode: sizes.dimMode, inner: sizes.inner, outer: sizes.outer, user: { L, W: W0, H },
  };
  if (sizes.lidA) { c.lidA = sizes.lidA; c.lidB = sizes.lidB; c.lidD = sizes.lidD; }
  for (const pd of style.params) {
    const v = params[pd.key];
    c.p[pd.key] = v === undefined || v === null || v === '' || Number.isNaN(v) ? pd.def(c) : v;
  }
  return c;
}
export function buildGeometry(styleId, opts) {
  const style = STYLE_MAP[styleId]; if (!style) throw new Error('unknown style ' + styleId);
  const ctx = makeContext(style, opts);
  const geo = finalize(style.build(ctx), { bleed: opts.bleed ?? 3 });
  geo.style = style; geo.ctx = ctx; geo.view3d = geo.view3d || style.view3d || { rx: 0, ry: 0 };
  return geo;
}
