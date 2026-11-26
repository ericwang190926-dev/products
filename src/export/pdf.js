// Minimal PDF 1.5 writer: vector dieline with Optional Content Groups (layers) and spot colours,
// plus an embedded JPEG artwork layer clipped to the bleed outline.
// Title-block text is drawn as outlines from a Noto Sans CJK SC subset so Chinese labels
// (盒型, 用料克重, 工艺) print correctly without a live CJK font in Illustrator.
import { FACE_NAMES, KIND_NAMES, FACE_EN, KIND_EN } from '../core/builder.js';
import { textPathOps } from './cjk.js';

const K = 72 / 25.4;
const f2 = (n) => (Math.round(n * 1000) / 1000).toString();
const esc = (s) => String(s).replace(/[\\()]/g, (m) => '\\' + m).replace(/[^\x20-\x7e]/g, '?');

export function buildPDF(geo, { art = null, info = [], processLayers = [] } = {}) {
  const bb = geo.bbox, bl = geo.bboxBleed;
  const minX = Math.min(bl.x, bb.x - 30) - 8, maxX = Math.max(bl.x1 + 12, minX + 220);
  const minY = Math.min(bl.y, ...((geo.marks || []).filter((m) => m.type === 'label').map((m) => m.y - 6))) - 12;
  const infoH = Math.max(18, info.length * 4.8 + 6);
  const legendRows = Math.ceil((4 + processLayers.length) / 4);
  const legendH = infoH + 6 + legendRows * 5.2 + 4;
  const maxY = Math.max(bl.y1, bb.y1 + 26) + 8 + legendH;
  const W = (maxX - minX) * K, H = (maxY - minY) * K;
  const X = (x) => f2((x - minX) * K), Y = (y) => f2((maxY - y) * K);
  const out = [];
  const path = (pts, close) => pts.map((p, i) => `${X(p[0])} ${Y(p[1])} ${i ? 'l' : 'm'}`).join('\n') + (close ? '\nh' : '');
  const layer = (name, body) => { out.push(`/OC /${name} BDC\n${body}\nEMC`); };
  const txt = (x, y, size, t, align = 'center') => textPathOps(t, x, y, size, X, Y, { align });
  const txtL = (x, y, size, t) => textPathOps(t, x, y, size, X, Y, { align: 'left' });

  if (art) {
    const iw = bl.w * K, ih = bl.h * K;
    layer('ocArt', `q\n${geo.bleedRegion.map((r) => path(r, true)).join('\n')}\nW n\n${f2(iw)} 0 0 ${f2(ih)} ${X(bl.x)} ${Y(bl.y1)} cm\n/Im1 Do\nQ`);
  }
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
  const insSheets = (geo.sheets || []).filter((sh) => sh.kind === 'eva' || sh.kind === 'blister');
  if (insSheets.length) {
    let ts = 'q\n';
    for (const sh of insSheets) {
      ts += sh.kind === 'blister' ? '0.12 0.04 0 0 k\n' : '0 0 0 0.08 k\n';
      ts += [sh.poly, ...(sh.holes || [])].map((r) => path(r, true)).join('\n') + '\nf*\n';
    }
    layer('ocLabels', ts + 'Q');
  }
  layer('ocBleed', `q 1 0.3 0 0 K 0.35 w [2 1.5] 0 d\n${geo.bleedRegion.map((r) => path(r, true)).join('\n')}\nS Q`);
  layer('ocCrease', `q /CSCrease CS 1 SCN 0.6 w [4 2.5] 0 d\n${geo.crease.map((l) => path(l)).join('\n')}\nS Q`);
  if (geo.perf.length) layer('ocCut', `q /CSCut CS 1 SCN 0.6 w [1.5 1.5] 0 d\n${geo.perf.map((l) => path(l)).join('\n')}\nS Q`);
  layer('ocCut', `q /CSCut CS 1 SCN 0.6 w\n${geo.cut.map((l) => path(l)).join('\n')}\nS Q`);

  processLayers.forEach((pl, i) => {
    if (!pl.polys?.length) return;
    const cs = `/CSProc${i}`;
    let s = `q ${cs} CS ${cs} cs 1 SCN 1 scn 0.5 w 0.18 ca 0.85 CA\n`;
    s += pl.polys.map((r) => path(r, true)).join('\n') + '\nB Q';
    layer('oc' + pl.pdfSpot, s);
  });

  {
    let s = 'q 0 0 0 1 K 0 0 0 1 k 0.3 w\n';
    for (const m of geo.marks) {
      if (m.type === 'label' && m.text) s += txt(m.x, m.y, 8, m.text, 'center');
    }
    for (const d of geo.dims) s += dimOps(d);
    out.push(`/OC /ocDims BDC\n${s}Q\nEMC`);
  }
  {
    const magnets = (geo.marks || []).filter((m) => m.type === 'magnet');
    if (magnets.length) {
      let s = 'q 0.45 0.7 0 0.1 K 0.35 w\n';
      for (const m of magnets) {
        const n = 24; const pts = []; for (let i = 0; i < n; i++) pts.push([m.x + m.r * Math.cos((i / n) * 6.283), m.y + m.r * Math.sin((i / n) * 6.283)]);
        s += `[1 1] 0 d ${path(pts, true)} S [] 0 d\n`;
        s += txt(m.x, m.y + m.r + 3, 6, m.text || '磁铁', 'center');
      }
      s += txt(magnets[0].x, magnets[0].y - magnets[0].r - 5, 7, `磁铁位置 ×${magnets.length}`, 'center');
      out.push(`/OC /ocMagnet BDC\n${s}Q\nEMC`);
    }
  }
  {
    let s = 'q 0 0 0 0.6 k\n';
    for (const p of geo.panels) {
      const t = p.face ? FACE_NAMES[p.face] : KIND_NAMES[p.kind]; if (!t) continue;
      const xs = p.poly.map((q) => q[0]), ys = p.poly.map((q) => q[1]); const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
      s += txt((Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2 + 1, Math.max(4, Math.min(16, Math.min(w, h) * 0.5)), t, 'center');
    }
    for (const sh of geo.sheets || []) {
      if (!sh.label) continue;
      const xs = sh.poly.map((q) => q[0]), ys = sh.poly.map((q) => q[1]);
      s += txt((Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2, 9, sh.label, 'center');
    }
    out.push(`/OC /ocLabels BDC\n${s}Q\nEMC`);
  }
  {
    const ly = maxY - legendH + 4; let s = 'q 0 0 0 1 k\n';
    info.forEach((line, i) => (s += txtL(minX + 8, ly + i * 4.8, 8, line)));
    const items = [
      ['刀线 Cut (CutContour)', 'cut'],
      ['压痕线 Crease', 'crease'],
      ['多印边 Bleed', 'bleed'],
      ['涂胶位置 Glue', 'glue'],
      ...processLayers.map((pl) => [`${pl.name} ${pl.pdfSpot}`, 'proc:' + pl.pdfSpot]),
    ];
    items.forEach(([name, k], i) => {
      const col = i % 4, row = Math.floor(i / 4);
      const yy = ly + info.length * 4.8 + 3 + row * 5.2, lx = minX + 8 + col * 52;
      if (k === 'cut') s += `q /CSCut CS 1 SCN 0.8 w ${X(lx)} ${Y(yy)} m ${X(lx + 12)} ${Y(yy)} l S Q\n`;
      else if (k === 'crease') s += `q /CSCrease CS 1 SCN 0.8 w [4 2.5] 0 d ${X(lx)} ${Y(yy)} m ${X(lx + 12)} ${Y(yy)} l S Q\n`;
      else if (k === 'bleed') s += `q 1 0.3 0 0 K 0.5 w [2 1.5] 0 d ${X(lx)} ${Y(yy)} m ${X(lx + 12)} ${Y(yy)} l S Q\n`;
      else if (k === 'glue') s += `q 0 0 0 0.45 K 0.3 w ${X(lx)} ${Y(yy + 1.2)} m ${X(lx + 2)} ${Y(yy - 1.2)} l ${X(lx + 4)} ${Y(yy + 1.2)} m ${X(lx + 6)} ${Y(yy - 1.2)} l ${X(lx + 8)} ${Y(yy + 1.2)} m ${X(lx + 10)} ${Y(yy - 1.2)} l S Q\n`;
      else s += `q /CSProc${processLayers.findIndex((p) => p.pdfSpot === k.slice(5))} CS 1 SCN 1.2 w ${X(lx)} ${Y(yy)} m ${X(lx + 12)} ${Y(yy)} l S Q\n`;
      s += txtL(lx + 15, yy + 1, 6.5, name);
    });
    out.push(`/OC /ocInfo BDC\n${s}Q\nEMC`);
  }
  function dimOps(d) {
    const tk = 1.5; let s = '';
    const val = d.text || (d.dir === 'h' ? d.x2 - d.x1 : d.y2 - d.y1).toFixed(1);
    if (d.dir === 'h') {
      s += `${X(d.x1)} ${Y(d.ref)} m ${X(d.x1)} ${Y(d.at + tk)} l ${X(d.x2)} ${Y(d.ref)} m ${X(d.x2)} ${Y(d.at + tk)} l ${X(d.x1)} ${Y(d.at)} m ${X(d.x2)} ${Y(d.at)} l S\n`;
      s += `${X(d.x1 - tk)} ${Y(d.at + tk)} m ${X(d.x1 + tk)} ${Y(d.at - tk)} l ${X(d.x2 - tk)} ${Y(d.at + tk)} m ${X(d.x2 + tk)} ${Y(d.at - tk)} l S\n`;
      s += txt((d.x1 + d.x2) / 2, d.at - 1, d.overall ? 8 : 6.5, val, 'center');
    } else {
      s += `${X(d.ref)} ${Y(d.y1)} m ${X(d.at - tk)} ${Y(d.y1)} l ${X(d.ref)} ${Y(d.y2)} m ${X(d.at - tk)} ${Y(d.y2)} l ${X(d.at)} ${Y(d.y1)} m ${X(d.at)} ${Y(d.y2)} l S\n`;
      s += `${X(d.at - tk)} ${Y(d.y1 - tk)} m ${X(d.at + tk)} ${Y(d.y1 + tk)} l ${X(d.at - tk)} ${Y(d.y2 - tk)} m ${X(d.at + tk)} ${Y(d.y2 + tk)} l S\n`;
      const size = d.overall ? 8 : 6.5;
      s += textPathOps(val, d.at - 1, (d.y1 + d.y2) / 2, size, X, Y, { align: 'center', rotate: 90 });
    }
    return s;
  }

  const content = out.join('\n');
  const baseLayers = [['ocArt', 'Artwork'], ['ocGlue', 'Glue'], ['ocBleed', 'Bleed'], ['ocCrease', 'Crease'], ['ocCut', 'Cut'], ['ocDims', 'Dimensions'], ['ocLabels', 'Labels'], ['ocInfo', 'Info']];
  if ((geo.marks || []).some((m) => m.type === 'magnet')) baseLayers.push(['ocMagnet', '磁铁位置']);
  const procLayerDefs = processLayers.map((pl) => ['oc' + pl.pdfSpot, pl.pdfSpot]);
  const layers = [...baseLayers, ...procLayerDefs];
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const catalogId = add(null), pagesId = add(null), pageId = add(null);
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const imgId = art ? add({ dict: `<< /Type /XObject /Subtype /Image /Width ${art.w} /Height ${art.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${art.bytes.length} >>`, bin: art.bytes }) : null;
  const csCut = add('[/Separation /CutContour /DeviceCMYK << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [0 1 1 0] /N 1 >>]');
  const csCrease = add('[/Separation /Crease /DeviceCMYK << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [1 0 1 0] /N 1 >>]');
  const csProc = processLayers.map((pl) => {
    const [c, m, y, k] = pl.cmyk;
    return add(`[/Separation /${pl.pdfSpot} /DeviceCMYK << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [${c} ${m} ${y} ${k}] /N 1 >>]`);
  });
  const ocName = (name) => {
    if (!/[^\x20-\x7e]/.test(name)) return `(${name})`;
    const bytes = [0xfe, 0xff];
    for (const ch of name) { const c = ch.codePointAt(0); bytes.push((c >> 8) & 0xff, c & 0xff); }
    return '<' + bytes.map((b) => b.toString(16).padStart(2, '0')).join('') + '>';
  };
  const ocIds = layers.map(([, name]) => add(`<< /Type /OCG /Name ${ocName(name)} >>`));
  const contentId = add({ dict: `<< /Length ${new TextEncoder().encode(content).length} >>`, bin: new TextEncoder().encode(content) });
  const ocRefs = ocIds.map((i) => `${i} 0 R`).join(' ');
  const procCS = csProc.map((id, i) => `/CSProc${i} ${id} 0 R`).join(' ');
  objs[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R /PageMode /UseOC /OCProperties << /OCGs [${ocRefs}] /D << /Name (Layers) /Order [${ocRefs}] /ON [${ocRefs}] >> >> >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>`;
  objs[pageId - 1] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${f2(W)} ${f2(H)}] /Resources << /Font << /F1 ${fontId} 0 R >> ${imgId ? `/XObject << /Im1 ${imgId} 0 R >>` : ''} /ColorSpace << /CSCut ${csCut} 0 R /CSCrease ${csCrease} 0 R ${procCS} >> /Properties << ${layers.map(([k], i) => `/${k} ${ocIds[i]} 0 R`).join(' ')} >> >> /Contents ${contentId} 0 R >>`;
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
