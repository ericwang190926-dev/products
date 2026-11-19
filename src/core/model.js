import { STYLE_MAP } from './styles/index.js';
import { finalize } from './builder.js';

/** Resolve context (mid-plane panel sizes + params with smart defaults) for a style. */
export function makeContext(style, { L, W, H, t, params = {} }) {
  const c = { L, W: style.dims.W ? W : L, H, t, A: L + t, B: (style.dims.W ? W : L) + t, D: H + t, p: {} };
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
  geo.style = style; geo.ctx = ctx; geo.view3d = style.view3d || { rx: 0, ry: 0 };
  return geo;
}
