/**
 * Wrap-paper (裱纸) layouts for rigid boxes.
 *
 * A greyboard tray is wrapped with a single cross-shaped sheet of face paper.
 * Size rule used by gift-box workshops:
 *   裱纸长 = 盒外长 + 2 × 墙高 + 2 × 包边
 *   裱纸宽 = 盒外宽 + 2 × 墙高 + 2 × 包边
 * Default 包边 (turn-in) is 15 mm; corners of the turn-in are cut at 45°,
 * and a small gap is left at the four inner corners so the paper does not
 * pile up when it is folded over the walls.
 */

/** Cross-shaped tray wrap. Lo/Wo = outer length/width of the boarded base; wall = wall height. */
export function trayWrapShape({ Lo, Wo, wall, turn = 15, gap = 1.5 }) {
  const ti = turn, g = Math.min(gap, wall * 0.25, 3);
  const arm = wall + ti;
  const x1 = arm, x2 = arm + Lo, x3 = arm + Lo + arm;
  const y1 = arm, y2 = arm + Wo, y3 = arm + Wo + arm;
  const poly = [
    [x1 + ti, 0],
    [x2 - ti, 0],
    [x2, ti],
    [x2, y1 - g],
    [x2 + g, y1],
    [x3 - ti, y1],
    [x3, y1 + ti],
    [x3, y2 - ti],
    [x3 - ti, y2],
    [x2 + g, y2],
    [x2, y2 + g],
    [x2, y3 - ti],
    [x2 - ti, y3],
    [x1 + ti, y3],
    [x1, y3 - ti],
    [x1, y2 + g],
    [x1 - g, y2],
    [ti, y2],
    [0, y2 - ti],
    [0, y1 + ti],
    [ti, y1],
    [x1 - g, y1],
    [x1, y1 - g],
    [x1, ti],
  ];
  const creases = [
    // around the boarded base (folds up the walls)
    [[x1, y1], [x2, y1]],
    [[x2, y1], [x2, y2]],
    [[x2, y2], [x1, y2]],
    [[x1, y2], [x1, y1]],
    // rim folds (paper turns over the wall into the box)
    [[x1, ti], [x2, ti]],
    [[x1, y3 - ti], [x2, y3 - ti]],
    [[ti, y1], [ti, y2]],
    [[x3 - ti, y1], [x3 - ti, y2]],
  ];
  return { poly, creases, w: x3, h: y3, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 };
}

/** Rectangular wrap for a flat cover (书型盒封面+书脊+封底), with 15 mm turn-in and 45° corners. */
export function coverWrapShape({ w, h, turn = 15, spine, bands: bandsArg } = {}) {
  const T = turn, W = w + 2 * T, H = h + 2 * T;
  const poly = [
    [T, 0], [W - T, 0], [W, T], [W, H - T], [W - T, H], [T, H], [0, H - T], [0, T],
  ];
  const creases = [
    [[T, T], [T + w, T]],
    [[T + w, T], [T + w, T + h]],
    [[T + w, T + h], [T, T + h]],
    [[T, T + h], [T, T]],
  ];
  const bands = [...(bandsArg || []), ...(spine && spine.w > 0 ? [spine] : [])];
  for (const band of bands) {
    if (!band || !(band.w > 0)) continue;
    const x0 = T + band.x, x1 = T + band.x + band.w;
    creases.push([[x0, T], [x0, T + h]], [[x1, T], [x1, T + h]]);
  }
  return { poly, creases, w: W, h: H, cx: T + w / 2, cy: T + h / 2 };
}

export function placeShape(shape, x0, y0) {
  const move = (p) => [p[0] + x0, p[1] + y0];
  return {
    poly: shape.poly.map(move),
    creases: shape.creases.map(([a, b]) => [move(a), move(b)]),
    w: shape.w,
    h: shape.h,
    cx: shape.cx + x0,
    cy: shape.cy + y0,
  };
}

export function addWrapSheet(b, { id, x0, y0, shape, label }) {
  const s = placeShape(shape, x0, y0);
  b.wrapSheet({ id, poly: s.poly, creases: s.creases, label, kind: 'wrap' });
  if (label) b.mark({ type: 'label', x: s.cx, y: s.cy, text: label });
  return s;
}
