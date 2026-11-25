// SVG and DXF exporters for the dieline.
import { FACE_NAMES, KIND_NAMES } from '../core/builder.js';
const f = (n) => (Math.round(n * 1000) / 1000).toString();
const pts = (l) => l.map((p) => `${f(p[0])},${f(p[1])}`).join(' ');
const ringsD = (rings) => rings.map((r) => 'M' + r.map((p) => `${f(p[0])} ${f(p[1])}`).join(' L') + ' Z').join(' ');

export function buildSVG(geo, { artDataUrl = null, processLayers = [] } = {}) {
  const bl = geo.bboxBleed, bb = geo.bbox;
  const x0 = Math.min(bl.x, bb.x - 30) - 5, y0 = bl.y - 5, w = bl.x1 + 5 - x0, h = Math.max(bl.y1, bb.y1 + 28) + 5 - y0;
  const L = (id, body) => `<g id="${id}" inkscape:groupmode="layer" inkscape:label="${id}">\n${body}\n</g>`;
  let s = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${f(w)}mm" height="${f(h)}mm" viewBox="${f(x0)} ${f(y0)} ${f(w)} ${f(h)}">\n`;
  s += `<defs><clipPath id="bleedClip"><path d="${ringsD(geo.bleedRegion)}"/></clipPath><pattern id="hatch" width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="2" stroke="#999" stroke-width="0.3"/></pattern></defs>\n`;
  if (artDataUrl) s += L('Artwork', `<image clip-path="url(#bleedClip)" x="${f(bl.x)}" y="${f(bl.y)}" width="${f(bl.w)}" height="${f(bl.h)}" preserveAspectRatio="none" xlink:href="${artDataUrl}"/>`);
  s += L('Glue', geo.glue.map((g) => `<polygon points="${pts(g)}" fill="url(#hatch)" stroke="none"/>`).join('\n'));
  s += L('Bleed', `<path d="${ringsD(geo.bleedRegion)}" fill="none" stroke="#2b7bd6" stroke-width="0.15" stroke-dasharray="1.5 1"/>`);
  s += L('Crease', geo.crease.map((l) => `<polyline points="${pts(l)}" fill="none" stroke="#11a04a" stroke-width="0.25" stroke-dasharray="2.5 1.5"/>`).join('\n'));
  s += L('Cut', [...geo.cut.map((l) => `<polyline points="${pts(l)}" fill="none" stroke="#e0262b" stroke-width="0.25"/>`), ...geo.perf.map((l) => `<polyline points="${pts(l)}" fill="none" stroke="#e0262b" stroke-width="0.25" stroke-dasharray="0.8 0.8"/>`)].join('\n'));
  let dm = '';
  for (const d of geo.dims) {
    const v = d.text || (d.dir === 'h' ? d.x2 - d.x1 : d.y2 - d.y1).toFixed(1);
    if (d.dir === 'h') dm += `<path d="M${f(d.x1)} ${f(d.ref)} V${f(d.at + 1.5)} M${f(d.x2)} ${f(d.ref)} V${f(d.at + 1.5)} M${f(d.x1)} ${f(d.at)} H${f(d.x2)}" stroke="#333" stroke-width="0.12" fill="none"/><text x="${f((d.x1 + d.x2) / 2)}" y="${f(d.at - 1)}" font-size="${d.overall ? 3.2 : 2.6}" text-anchor="middle" font-family="Arial">${v}</text>\n`;
    else dm += `<path d="M${f(d.ref)} ${f(d.y1)} H${f(d.at - 1.5)} M${f(d.ref)} ${f(d.y2)} H${f(d.at - 1.5)} M${f(d.at)} ${f(d.y1)} V${f(d.y2)}" stroke="#333" stroke-width="0.12" fill="none"/><text transform="translate(${f(d.at - 1)} ${f((d.y1 + d.y2) / 2)}) rotate(-90)" font-size="${d.overall ? 3.2 : 2.6}" text-anchor="middle" font-family="Arial">${v}</text>\n`;
  }
  for (const m of geo.marks) dm += `<circle cx="${f(m.x)}" cy="${f(m.y)}" r="${f(m.r)}" fill="none" stroke="#333" stroke-width="0.15" stroke-dasharray="0.8 0.8"/>`;
  s += L('Dimensions', dm);
  let lb = geo.panels.map((p) => { const t = p.face ? FACE_NAMES[p.face] : KIND_NAMES[p.kind]; if (!t) return ''; const xs = p.poly.map((q) => q[0]), ys = p.poly.map((q) => q[1]); const sz = Math.max(1.5, Math.min(6, Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.18)); return `<text x="${f((Math.max(...xs) + Math.min(...xs)) / 2)}" y="${f((Math.max(...ys) + Math.min(...ys)) / 2)}" font-size="${f(sz)}" text-anchor="middle" dominant-baseline="middle" fill="#666" font-family='"Noto Sans CJK SC",sans-serif'>${t}</text>`; }).join('\n');
  for (const sh of geo.sheets || []) if (sh.label) {
    const xs = sh.poly.map((q) => q[0]), ys = sh.poly.map((q) => q[1]);
    lb += `<text x="${f((Math.max(...xs)+Math.min(...xs))/2)}" y="${f((Math.max(...ys)+Math.min(...ys))/2)}" font-size="4" text-anchor="middle" dominant-baseline="middle" fill="#666" font-family='"Noto Sans CJK SC",sans-serif'>${sh.label}</text>`;
  }
  s += L('Labels', lb);
  for (const pl of processLayers) {
    const body = (pl.polys || []).map((r) => `<polygon points="${pts(r)}" fill="${pl.color || '#888'}" fill-opacity="0.25" stroke="${pl.color || '#888'}" stroke-width="0.2"/>`).join('\n');
    s += L(pl.pdfSpot, body);
  }
  return s + '\n</svg>\n';
}

export function buildDXF(geo) {
  const o = [];
  const g = (code, v) => o.push(String(code), String(v));
  g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$INSUNITS'); g(70, 4); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 2);
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0.0);
  g(0, 'LTYPE'); g(2, 'DASHED'); g(70, 0); g(3, '__ __ __'); g(72, 65); g(73, 2); g(40, 4.0); g(49, 2.5); g(49, -1.5);
  g(0, 'ENDTAB');
  const layers = [['CUT', 1, 'CONTINUOUS'], ['CREASE', 3, 'DASHED'], ['PERF', 6, 'DASHED'], ['BLEED', 5, 'DASHED'], ['GLUE', 8, 'CONTINUOUS'], ['DIM', 7, 'CONTINUOUS']];
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, layers.length);
  for (const [n, c, lt] of layers) { g(0, 'LAYER'); g(2, n); g(70, 0); g(62, c); g(6, lt); }
  g(0, 'ENDTAB'); g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  const line = (layer, a, b) => { g(0, 'LINE'); g(8, layer); g(10, a[0].toFixed(4)); g(20, (-a[1]).toFixed(4)); g(30, 0); g(11, b[0].toFixed(4)); g(21, (-b[1]).toFixed(4)); g(31, 0); };
  const poly = (layer, l, closed) => { for (let i = 0; i < l.length - 1; i++) line(layer, l[i], l[i + 1]); if (closed) line(layer, l[l.length - 1], l[0]); };
  geo.cut.forEach((l) => poly('CUT', l)); geo.crease.forEach((l) => poly('CREASE', l)); geo.perf.forEach((l) => poly('PERF', l));
  geo.bleedRegion.forEach((r) => poly('BLEED', r, true)); geo.glue.forEach((r) => poly('GLUE', r, true));
  const text = (x, y, h, s, rotDeg = 0) => { g(0, 'TEXT'); g(8, 'DIM'); g(10, x.toFixed(3)); g(20, (-y).toFixed(3)); g(30, 0); g(40, h); g(1, s); g(50, rotDeg); g(72, 1); g(11, x.toFixed(3)); g(21, (-y).toFixed(3)); g(31, 0); };
  for (const d of geo.dims) {
    const v = d.text || (d.dir === 'h' ? d.x2 - d.x1 : d.y2 - d.y1).toFixed(1);
    if (d.dir === 'h') { line('DIM', [d.x1, d.at], [d.x2, d.at]); line('DIM', [d.x1, d.ref], [d.x1, d.at + 1.5]); line('DIM', [d.x2, d.ref], [d.x2, d.at + 1.5]); text((d.x1 + d.x2) / 2, d.at - 1, 2.5, v); }
    else { line('DIM', [d.at, d.y1], [d.at, d.y2]); line('DIM', [d.ref, d.y1], [d.at - 1.5, d.y1]); line('DIM', [d.ref, d.y2], [d.at - 1.5, d.y2]); text(d.at - 1, (d.y1 + d.y2) / 2, 2.5, v, 90); }
  }
  g(0, 'ENDSEC'); g(0, 'EOF');
  return o.join('\n') + '\n';
}
