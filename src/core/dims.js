/**
 * Convert between the size the user types and the mid-plane context
 * (A = inner + t) used by every style builder.
 *
 * Default in the app is 外尺寸 (outside of the closed box). Tests and older
 * project files that omit dimMode keep the original 内尺寸 meaning.
 *
 * Mid-plane reminder: a carton panel is inner + t wide, so the measured
 * outside of a simple box is inner + 2t = mid-plane + t.
 */

export function defaultClear(t) { return t >= 1 ? 1 : 0.5; }
export function defaultOverhang(t) { return t >= 1 ? 2 : 1; }

const MIN = 5;

function clampMin(n) { return Math.max(MIN, +n || MIN); }

function simpleFromInner(L, W, H, t) {
  return { L: L + 2 * t, W: W + 2 * t, H: H + 2 * t };
}
function simpleInnerFromOuter(L, W, H, t) {
  return { L: clampMin(L - 2 * t), W: clampMin(W - 2 * t), H: clampMin(H - 2 * t) };
}

function lidClear(params, t) {
  const v = params?.clear;
  return v === undefined || v === null || v === '' || Number.isNaN(+v) ? defaultClear(t) : +v;
}
function bookOverhang(params, t) {
  const v = params?.overhang;
  return v === undefined || v === null || v === '' || Number.isNaN(+v) ? defaultOverhang(t) : +v;
}

/** Physical / quoted outer size when the entered dims are inner (product space). */
export function outerFromInner(styleId, { L, W, H, t, params = {} }) {
  const cl = lidClear(params, t);
  if (styleId === 'lidbase') {
    const full = params.lidType === 'full';
    const A = L + t, B = W + t, D = H + t;
    const A2 = A + 2 * t + 2 * cl, B2 = B + 2 * t + 2 * cl;
    if (full) {
      const Dl = D + 2 * t + cl;
      return { L: A2 + t, W: B2 + t, H: Dl + t };
    }
    return { L: A2 + t, W: B2 + t, H: D + 2 * t };
  }
  if (styleId === 'book') {
    const ov = bookOverhang(params, t);
    const A = L + t, B = W + t, D = H + t;
    return { L: A + t + 2 * ov, W: B + t + 2 * ov, H: D + 1.5 * t };
  }
  if (styleId === 'drawer') {
    return { L: L + 2 * t, W: W + 3 * t + 2 * cl, H: H + 3 * t + cl };
  }
  return simpleFromInner(L, W, H, t);
}

/** Inner (product) size and any lid extras when the entered dims are outer. */
export function innerFromOuter(styleId, { L, W, H, t, params = {} }) {
  const cl = lidClear(params, t);
  if (styleId === 'lidbase') {
    const full = params.lidType === 'full';
    // Outer L/W is the lid outside. Mid-plane lid = outer - t.
    const A2 = L - t, B2 = W - t;
    const A = A2 - 2 * t - 2 * cl, B = B2 - 2 * t - 2 * cl;
    if (full) {
      const Dl = H - t;
      const Db = Dl - 2 * t - cl;
      return {
        L: clampMin(A - t), W: clampMin(B - t), H: clampMin(Db - t),
        lidA: A2, lidB: B2, lidD: Math.max(MIN, Dl),
      };
    }
    const D = H - 2 * t;
    return { L: clampMin(A - t), W: clampMin(B - t), H: clampMin(D - t) };
  }
  if (styleId === 'book') {
    const ov = bookOverhang(params, t);
    // Outer L/W is the cover board; H is the closed book thickness (spine width).
    const Lc = L, Wc = W, Hs = H;
    const A = Lc - t - 2 * ov, B = Wc - t - 2 * ov, D = Hs - 1.5 * t;
    return { L: clampMin(A - t), W: clampMin(B - t), H: clampMin(D - t) };
  }
  if (styleId === 'drawer') {
    // Outer is the sleeve: W is the sleeve's wider outside, L the draw length, H the height.
    const As = W - t, Ds = H - t, Ls = L - t;
    const B = As - 2 * t - 2 * cl, D = Ds - 2 * t - cl, A = Ls - t;
    return { L: clampMin(A - t), W: clampMin(B - t), H: clampMin(D - t) };
  }
  return simpleInnerFromOuter(L, W, H, t);
}

/**
 * Resolve mid-plane A/B/D plus inner/outer for a style.
 * dimMode 'inner' (default) keeps historical builder input.
 * dimMode 'outer' treats L/W/H as the closed box's outside.
 */
export function resolveBoxDims(style, { L, W, H, t, dimMode, params = {} }) {
  const id = typeof style === 'string' ? style : style.id;
  const Ww = W == null ? L : W;
  const mode = dimMode === 'outer' ? 'outer' : 'inner';
  let inner, outer, extra = {};
  if (mode === 'outer') {
    const r = innerFromOuter(id, { L, W: Ww, H, t, params });
    inner = { L: r.L, W: r.W, H: r.H };
    outer = { L, W: Ww, H };
    if (r.lidA) extra = { lidA: r.lidA, lidB: r.lidB, lidD: r.lidD };
  } else {
    inner = { L, W: Ww, H };
    outer = outerFromInner(id, { L, W: Ww, H, t, params });
    if (id === 'lidbase' && params.lidType === 'full') {
      const cl = lidClear(params, t);
      const A = L + t, B = Ww + t, D = H + t;
      extra = { lidA: A + 2 * t + 2 * cl, lidB: B + 2 * t + 2 * cl, lidD: D + 2 * t + cl };
    }
  }
  return {
    dimMode: mode,
    inner,
    outer,
    A: inner.L + t,
    B: inner.W + t,
    D: inner.H + t,
    ...extra,
  };
}

export function fmtSize(obj, keys = ['L', 'W', 'H']) {
  return keys.filter((k) => obj[k] != null).map((k) => Number(obj[k]).toFixed(1).replace(/\.0$/, '')).join(' × ');
}
