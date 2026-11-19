// Minimal PDF 1.5 writer: vector dieline with Optional Content Groups (layers) and spot colours,
// plus an embedded JPEG artwork layer clipped to the bleed outline.
import { FACE_EN, KIND_EN } from '../core/builder.js';

const K = 72 / 25.4;
const f2 = (n) => (Math.round(n * 1000) / 1000).toString();
const esc = (s) => String(s).replace(/[\\()]/g, (m) => '\\' + m).replace(/[^\x20-\x7e]/g, '?');

export function buildPDF(geo, { art = null, info = [] } = {}) {
  const bb = geo.bbox, bl = geo.bboxBleed;
  const minX = Math.min(bl.x, bb.x - 30) - 8, maxX = Math.max(bl.x1 + 12, minX + 190), minY = bl.y - 12, legendH = 34;
  const maxY = Math.max(bl.y1, bb.y1 + 26) + 8 + legendH;
  const W = (maxX - minX) * K, H = (maxY - minY) * K;
  const X = (x) => f2((x - minX) * K), Y = (y) => f2((maxY - y) * K);
  const out = [];
  const path = (pts, close) => pts.map((p, i) => `${X(p[0])} ${Y(p[1])} ${i ? 'l' : 'm'}`).join('\n') + (close ? '\nh' : '');
  const layer = (name, body) => { out.push(`/OC /${name} BDC\n${body}\nEMC`); };

  if (art) {
    const iw = bl.w * K, ih = bl.h * K;
    layer('ocArt', `q\n${geo.bleedRegion.map((r) => path(r, true)).join('\n')}\nW n\n${f2(iw)} 0 0 ${f2(ih)} ${X(bl.x)} ${Y(bl.y1)} cm\n/Im1 Do\nQ`);
  }
  // glue: hatched
  {
    let s = 'q 0 0 0 0.45 K 0.3 w\n';
    for (const g of geo.glue) {
      const xs = g.map((p) => p[0]), ys = g.map((p) => p[1]); const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      s += `q\n${path(g, true)}\nW n\n`;
      for (let d = x0 - (y1 - y0); d < x1; d += 2) s += `${X(d)} ${Y(y1)} m ${X(d + (y1 - y0))} ${Y(y0)} l\n`;
      s += 'S\nQ\n';
    }
    layer('ocGlue', s + 'Q');
  }
  layer('ocBleed', `q 1 0.3 0 0 K 0.35 w [2 1.5] 0 d\n${geo.bleedRegion.map((r) => path(r, true)).join('\n')}\nS Q`);
  layer('ocCrease', `q /CSCrease CS 1 SCN 0.6 w [4 2.5] 0 d\n${geo.crease.map((l) => path(l)).join('\n')}\nS Q`);
  if (geo.perf.length) layer('ocCut', `q /CSCut CS 1 SCN 0.6 w [1.5 1.5] 0 d\n${geo.perf.map((l) => path(l)).join('\n')}\nS Q`);
  layer('ocCut', `q /CSCut CS 1 SCN 0.6 w\n${geo.cut.map((l) => path(l)).join('\n')}\nS Q`);
  // marks + dimensions
  {
    let s = 'q 0 0 0 1 K 0 0 0 1 k 0.3 w\n';
    for (const m of geo.marks) { const n = 24; const pts = []; for (let i = 0; i < n; i++) pts.push([m.x + m.r * Math.cos((i / n) * 6.283), m.y + m.r * Math.sin((i / n) * 6.283)]); s += `[1 1] 0 d ${path(pts, true)} S [] 0 d\n`; s += txt(m.x, m.y + m.r + 3, 5, 'MAGNET'); }
    for (const d of geo.dims) s += dimOps(d);
    out.push(`/OC /ocDims BDC\n${s}Q\nEMC`);
  }
  {
    let s = 'q 0 0 0 0.6 k\n';
    for (const p of geo.panels) {
      const t = p.face ? FACE_EN[p.face] : KIND_EN[p.kind]; if (!t) continue;
      const xs = p.poly.map((q) => q[0]), ys = p.poly.map((q) => q[1]); const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
      s += txt((Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2 + 1, Math.max(4, Math.min(16, Math.min(w, h) * 0.5)), t);
    }
    out.push(`/OC /ocLabels BDC\n${s}Q\nEMC`);
  }
  // legend / title block
  {
    const ly = maxY - legendH + 4; let s = 'q 0 0 0 1 k\n';
    info.forEach((line, i) => (s += txtL(minX + 8, ly + i * 4.6, 8, line)));
    const items = [['Cut (spot CutContour)', 'cut'], ['Crease (spot Crease)', 'crease'], ['Bleed', 'bleed'], ['Glue area', 'glue']];
    items.forEach(([name, k], i) => {
      const yy = ly + info.length * 4.6 + 1.5, lx = minX + 8 + i * 45;
      if (k === 'cut') s += `q /CSCut CS 1 SCN 0.8 w ${X(lx)} ${Y(yy)} m ${X(lx + 12)} ${Y(yy)} l S Q\n`;
      if (k === 'crease') s += `q /CSCrease CS 1 SCN 0.8 w [4 2.5] 0 d ${X(lx)} ${Y(yy)} m ${X(lx + 12)} ${Y(yy)} l S Q\n`;
      if (k === 'bleed') s += `q 1 0.3 0 0 K 0.5 w [2 1.5] 0 d ${X(lx)} ${Y(yy)} m ${X(lx + 12)} ${Y(yy)} l S Q\n`;
      if (k === 'glue') s += `q 0 0 0 0.45 K 0.3 w ${X(lx)} ${Y(yy + 1.2)} m ${X(lx + 2)} ${Y(yy - 1.2)} l ${X(lx + 4)} ${Y(yy + 1.2)} m ${X(lx + 6)} ${Y(yy - 1.2)} l ${X(lx + 8)} ${Y(yy + 1.2)} m ${X(lx + 10)} ${Y(yy - 1.2)} l S Q\n`;
      s += txtL(lx + 15, yy + 1, 7, name);
    });
    out.push(`/OC /ocInfo BDC\n${s}Q\nEMC`);
  }
  function txt(x, y, size, t) { const w = t.length * size * 0.5 * 0.55 / K; return `BT /F1 ${f2(size)} Tf ${X(x - w)} ${Y(y)} Td (${esc(t)}) Tj ET\n`; }
  function txtL(x, y, size, t) { return `BT /F1 ${f2(size)} Tf ${X(x)} ${Y(y)} Td (${esc(t)}) Tj ET\n`; }
  function dimOps(d) {
    const tk = 1.5; let s = '';
    const val = d.text || (d.dir === 'h' ? d.x2 - d.x1 : d.y2 - d.y1).toFixed(1);
    if (d.dir === 'h') {
      s += `${X(d.x1)} ${Y(d.ref)} m ${X(d.x1)} ${Y(d.at + tk)} l ${X(d.x2)} ${Y(d.ref)} m ${X(d.x2)} ${Y(d.at + tk)} l ${X(d.x1)} ${Y(d.at)} m ${X(d.x2)} ${Y(d.at)} l S\n`;
      s += `${X(d.x1 - tk)} ${Y(d.at + tk)} m ${X(d.x1 + tk)} ${Y(d.at - tk)} l ${X(d.x2 - tk)} ${Y(d.at + tk)} m ${X(d.x2 + tk)} ${Y(d.at - tk)} l S\n`;
      s += txt((d.x1 + d.x2) / 2, d.at - 1, d.overall ? 8 : 6.5, val);
    } else {
      s += `${X(d.ref)} ${Y(d.y1)} m ${X(d.at - tk)} ${Y(d.y1)} l ${X(d.ref)} ${Y(d.y2)} m ${X(d.at - tk)} ${Y(d.y2)} l ${X(d.at)} ${Y(d.y1)} m ${X(d.at)} ${Y(d.y2)} l S\n`;
      s += `${X(d.at - tk)} ${Y(d.y1 - tk)} m ${X(d.at + tk)} ${Y(d.y1 + tk)} l ${X(d.at - tk)} ${Y(d.y2 - tk)} m ${X(d.at + tk)} ${Y(d.y2 + tk)} l S\n`;
      const size = d.overall ? 8 : 6.5; const w = val.length * size * 0.28;
      s += `BT /F1 ${size} Tf 0 1 -1 0 ${X(d.at - 1)} ${f2((maxY - (d.y1 + d.y2) / 2) * K - w)} Tm (${esc(val)}) Tj ET\n`;
    }
    return s;
  }

  const content = out.join('\n');
  const layers = [['ocArt', 'Artwork'], ['ocGlue', 'Glue'], ['ocBleed', 'Bleed'], ['ocCrease', 'Crease'], ['ocCut', 'Cut'], ['ocDims', 'Dimensions'], ['ocLabels', 'Labels'], ['ocInfo', 'Info']];
  // objects
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const catalogId = add(null), pagesId = add(null), pageId = add(null);
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const imgId = art ? add({ dict: `<< /Type /XObject /Subtype /Image /Width ${art.w} /Height ${art.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${art.bytes.length} >>`, bin: art.bytes }) : null;
  const csCut = add('[/Separation /CutContour /DeviceCMYK << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [0 1 1 0] /N 1 >>]');
  const csCrease = add('[/Separation /Crease /DeviceCMYK << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [1 0 1 0] /N 1 >>]');
  const ocIds = layers.map(([, name]) => add(`<< /Type /OCG /Name (${name}) >>`));
  const contentId = add({ dict: `<< /Length ${new TextEncoder().encode(content).length} >>`, bin: new TextEncoder().encode(content) });
  const ocRefs = ocIds.map((i) => `${i} 0 R`).join(' ');
  objs[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R /PageMode /UseOC /OCProperties << /OCGs [${ocRefs}] /D << /Name (Layers) /Order [${ocRefs}] /ON [${ocRefs}] >> >> >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>`;
  objs[pageId - 1] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${f2(W)} ${f2(H)}] /Resources << /Font << /F1 ${fontId} 0 R >> ${imgId ? `/XObject << /Im1 ${imgId} 0 R >>` : ''} /ColorSpace << /CSCut ${csCut} 0 R /CSCrease ${csCrease} 0 R >> /Properties << ${layers.map(([k], i) => `/${k} ${ocIds[i]} 0 R`).join(' ')} >> >> /Contents ${contentId} 0 R >>`;
  // serialise
  const enc = new TextEncoder(); const chunks = []; let pos = 0; const offs = [];
  const push = (u8) => { chunks.push(u8); pos += u8.length; };
  push(enc.encode('%PDF-1.5\n%\xE2\xE3\xCF\xD3\n'));
  objs.forEach((o, i) => {
    offs.push(pos);
    if (typeof o === 'string') push(enc.encode(`${i + 1} 0 obj\n${o}\nendobj\n`));
    else { push(enc.encode(`${i + 1} 0 obj\n${o.dict}\nstream\n`)); push(o.bin); push(enc.encode('\nendstream\nendobj\n')); }
  });
  const xref = pos;
  let x = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`; for (const o of offs) x += `${String(o).padStart(10, '0')} 00000 n \n`;
  x += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R /Info << /Producer (Dieline Studio) /Title (${esc(geo.style?.en || 'Dieline')}) >> >>\nstartxref\n${xref}\n%%EOF\n`;
  push(enc.encode(x));
  const res = new Uint8Array(pos); let o = 0; for (const c of chunks) { res.set(c, o); o += c.length; } return res;
}
