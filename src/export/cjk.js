// Path-based CJK (and Latin) text for the PDF writer, using a subset of Noto Sans CJK SC.
import font from './cjk-paths.json' with { type: 'json' };

const cache = new Map();
function parsePath(d) {
  let p = cache.get(d);
  if (p) return p;
  p = [];
  const re = /([MLCZ])([^MLCZ]*)/g;
  let m;
  while ((m = re.exec(d))) {
    const nums = m[2].trim() ? m[2].trim().split(/\s+/).map(Number) : [];
    p.push([m[1], ...nums]);
  }
  cache.set(d, p);
  return p;
}

export const CJK_FONT = font;

export function measureText(s, sizePt) {
  const sc = sizePt / font.unitsPerEm;
  let w = 0;
  for (const ch of String(s)) w += (font.glyphs[ch]?.w ?? font.unitsPerEm * 0.6) * sc;
  return w;
}

/**
 * Paint a left-aligned string at (x, y) mm in dieline space.
 * sizePt is in PDF points (same as the old Helvetica Tf size).
 * X/Y convert mm → PDF points; for glyph Y we add fontY * sc to Y(baseline)
 * because PDF Y already points up.
 */
export function textPathOps(s, x, y, sizePt, X, Y, { align = 'left', rotate = 0 } = {}) {
  const sc = sizePt / font.unitsPerEm;
  const width = measureText(s, sizePt);
  let x0 = 0;
  if (align === 'center') x0 = -width / 2;
  if (align === 'right') x0 = -width;
  const parts = [];
  let adv = 0;
  const ox = +X(x), oy = +Y(y);
  const rad = (rotate * Math.PI) / 180;
  const cr = Math.cos(rad), sr = Math.sin(rad);
  const xf = (px, py) => {
    const rx = (px + x0) * cr - py * sr;
    const ry = (px + x0) * sr + py * cr;
    return `${(ox + rx).toFixed(2)} ${(oy + ry).toFixed(2)}`;
  };
  for (const ch of String(s)) {
    const g = font.glyphs[ch];
    if (!g) { adv += font.unitsPerEm * 0.5 * sc; continue; }
    const cmds = parsePath(g.d);
    for (const c of cmds) {
      if (c[0] === 'M') parts.push(`${xf(adv + c[1] * sc, c[2] * sc)} m`);
      else if (c[0] === 'L') parts.push(`${xf(adv + c[1] * sc, c[2] * sc)} l`);
      else if (c[0] === 'C') parts.push(`${xf(adv + c[1] * sc, c[2] * sc)} ${xf(adv + c[3] * sc, c[4] * sc)} ${xf(adv + c[5] * sc, c[6] * sc)} c`);
      else if (c[0] === 'Z') parts.push('h');
    }
    adv += g.w * sc;
  }
  if (!parts.length) return '';
  return parts.join('\n') + '\nf\n';
}
