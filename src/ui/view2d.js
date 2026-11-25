// Interactive SVG view of the dieline + flat artwork.
import { FACE_NAMES, KIND_NAMES } from '../core/builder.js';
import { imageCache } from '../render/raster.js';
import { elementSize, finishRegionsOf, regionPoly, flatToFaceLocal, faceAtPoint } from '../core/finish.js';
import { PROCESS_MAP } from '../core/materials.js';
export { elementSize };

const f = (n) => (Math.round(n * 100) / 100).toString();
const ringsD = (rings) => rings.map((r) => 'M' + r.map((p) => `${f(p[0])} ${f(p[1])}`).join('L') + 'Z').join('');
const polyline = (l) => 'M' + l.map((p) => `${f(p[0])} ${f(p[1])}`).join('L');
const escX = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const blobUrls = new Map();
export function displayUrl(src) {
  if (!src) return '';
  if (!src.startsWith('data:')) return src;
  let u = blobUrls.get(src);
  if (!u) {
    const [meta, b64] = src.split(','); const mime = meta.slice(5).split(';')[0]; const bin = atob(b64); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    u = URL.createObjectURL(new Blob([arr], { type: mime })); blobUrls.set(src, u);
  }
  return u;
}

export function createView2D(svg, hooks) {
  let geo = null, state = null, vb = null;
  const elTransform = (fc, el) => `translate(${f(fc.cx)} ${f(fc.cy)}) rotate(${fc.rot}) translate(${f(el.x)} ${f(el.y)}) rotate(${f(el.rot)})`;

  function render(g, s, { fit = false } = {}) {
    geo = g; state = s; const L = s.layers;
    if (fit || !vb) fitView();
    let o = `<defs><pattern id="hatch" width="2.4" height="2.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="2.4" stroke="#8a8f98" stroke-width="0.35"/></pattern>`;
    for (const fc of geo.faces) o += `<clipPath id="clip-${fc.panelId}"><path d="${ringsD(geo.faceRegions[fc.panelId])}"/></clipPath>`;
    o += `</defs>`;
    // background + sheet
    o += `<g id="lyr-art" ${L.art ? '' : 'display="none"'}>`;
    o += `<path d="${ringsD(geo.bleedRegion)}" fill="${s.boxColor}" stroke="none"/>`;
    for (const fc of geo.faces) { const c = s.faceColors[fc.id]; if (c) o += `<path d="${ringsD(geo.faceRegions[fc.panelId])}" fill="${c}"/>`; }
    o += `</g>`;
    // hit layer for panels
    o += `<g id="lyr-hit">`;
    for (const p of geo.panels) o += `<path data-panel="${p.id}" data-face="${p.face || ''}" d="${ringsD([p.poly])}" fill="transparent" stroke="none"/>`;
    o += `</g>`;
    // artwork elements
    o += `<g id="lyr-els" ${L.art ? '' : 'display="none"'}>`;
    for (const el of s.elements) {
      const fc = geo.faces.find((q) => q.id === el.face); if (!fc) continue;
      const [w, h] = elementSize(el);
      o += `<g clip-path="url(#clip-${fc.panelId})"><g data-el="${el.id}" transform="${elTransform(fc, el)}" style="cursor:move">`;
      if (el.type === 'image') o += `<image href="${displayUrl(el.src)}" x="${f(-w / 2)}" y="${f(-h / 2)}" width="${f(w)}" height="${f(h)}" preserveAspectRatio="none"/>`;
      else { const lines = String(el.text).split('\n'); lines.forEach((ln, i) => (o += `<text x="0" y="${f((i - (lines.length - 1) / 2) * el.size * 1.25)}" font-size="${f(el.size)}" fill="${el.color}" font-weight="${el.bold ? 700 : 400}" text-anchor="middle" dominant-baseline="central" font-family='"Noto Sans CJK SC","PingFang SC","Microsoft YaHei",sans-serif'>${escX(ln)}</text>`)); }
      o += `<rect x="${f(-w / 2)}" y="${f(-h / 2)}" width="${f(w)}" height="${f(h)}" fill="transparent" stroke="none"/>`;
      o += `</g></g>`;
    }
    o += `</g>`;
    o += `<g id="lyr-glue" ${L.glue ? '' : 'display="none"'}>${geo.glue.map((g2) => `<path d="${ringsD([g2])}" fill="url(#hatch)" pointer-events="none"/>`).join('')}</g>`;
    if (L.finish !== false) {
      o += `<g id="lyr-finish" pointer-events="none">`;
      for (const r of finishRegionsOf(s)) {
        const poly = regionPoly(geo, r); if (!poly) continue;
        const d = ringsD([poly]);
        for (const id of r.processes) {
          const pr = PROCESS_MAP[id]; if (!pr) continue;
          o += `<path d="${d}" fill="${pr.color}" fill-opacity="0.28" stroke="${pr.color}" stroke-width="0.9" vector-effect="non-scaling-stroke"/>`;
        }
        if (r.id && r.id === s.selectedFinish) o += `<path d="${d}" fill="none" stroke="#111" stroke-width="1.2" stroke-dasharray="3 2" vector-effect="non-scaling-stroke"/>`;
      }
      o += `</g>`;
    }
    o += `<g pointer-events="none" fill="none" stroke-linejoin="round">`;
    if (L.bleed) o += `<path d="${ringsD(geo.bleedRegion)}" stroke="#2b7bd6" stroke-width="1" vector-effect="non-scaling-stroke" stroke-dasharray="3 3"/>`;
    if (L.crease) o += `<path d="${geo.crease.map(polyline).join('')}" stroke="#11a04a" stroke-width="1.3" vector-effect="non-scaling-stroke" stroke-dasharray="7 4"/>`;
    if (L.cut) { o += `<path d="${geo.cut.map(polyline).join('')}" stroke="#e0262b" stroke-width="1.4" vector-effect="non-scaling-stroke"/>`; if (geo.perf.length) o += `<path d="${geo.perf.map(polyline).join('')}" stroke="#e0262b" stroke-width="1.2" vector-effect="non-scaling-stroke" stroke-dasharray="2 2"/>`; }
    for (const m of geo.marks) {
      if (m.type === 'label') { o += `<text x="${f(m.x)}" y="${f(m.y)}" font-size="3.6" fill="#6b7280" stroke="none" text-anchor="middle" dominant-baseline="central">${escX(m.text || '')}</text>`; }
    }
    o += `</g>`;
    if (L.magnet !== false) {
      const magnets = geo.marks.filter((m) => m.type === 'magnet');
      if (magnets.length) {
        o += `<g id="lyr-magnet" pointer-events="none" fill="none">`;
        for (const m of magnets) {
          o += `<circle cx="${f(m.x)}" cy="${f(m.y)}" r="${f(m.r)}" stroke="#7c3aed" stroke-width="1" vector-effect="non-scaling-stroke" stroke-dasharray="3 2"/><text x="${f(m.x)}" y="${f(m.y + m.r + 3.5)}" font-size="3" fill="#7c3aed" stroke="none" text-anchor="middle">${escX(m.text || '磁铁')}</text>`;
        }
        o += `</g>`;
      }
    }
    if (L.labels) {
      o += `<g pointer-events="none" fill="#5b6170" text-anchor="middle" dominant-baseline="central" font-family='"Noto Sans CJK SC",sans-serif'>`;
      for (const p of geo.panels) {
        const t = p.face ? FACE_NAMES[p.face] : KIND_NAMES[p.kind]; if (!t) continue;
        const xs = p.poly.map((q) => q[0]), ys = p.poly.map((q) => q[1]); const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
        const fs = Math.max(1.6, Math.min(7, Math.min(w / (t.length * 1.3), h * 0.22)));
        o += `<text x="${f((Math.max(...xs) + Math.min(...xs)) / 2)}" y="${f((Math.max(...ys) + Math.min(...ys)) / 2)}" font-size="${f(fs)}" opacity="${p.face ? 0.75 : 0.5}">${t}</text>`;
      }
      o += `</g>`;
    }
    if (L.dims) o += dimsSVG(geo);
    // selection
    if (s.selectedFace) {
      const fc = geo.faces.find((q) => q.id === s.selectedFace);
      if (fc) o += `<path d="${ringsD([geo.byId[fc.panelId].poly])}" fill="rgba(31,111,235,0.07)" stroke="#1f6feb" stroke-width="2" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
    }
    const sel = s.elements.find((e) => e.id === s.selected);
    if (sel) { const fc = geo.faces.find((q) => q.id === sel.face); if (fc) { const [w, h] = elementSize(sel); o += `<g id="selbox" transform="${elTransform(fc, sel)}" pointer-events="none"><rect x="${f(-w / 2)}" y="${f(-h / 2)}" width="${f(w)}" height="${f(h)}" fill="none" stroke="#1f6feb" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-dasharray="5 3"/></g>`; } }
    svg.innerHTML = o;
    applyVB();
  }
  function dimsSVG(g) {
    let o = `<g pointer-events="none" stroke="#4b5563" fill="#374151" font-family="Arial" text-anchor="middle">`;
    for (const d of g.dims) {
      const v = d.text || (d.dir === 'h' ? d.x2 - d.x1 : d.y2 - d.y1).toFixed(1); const fs = d.overall ? 4 : 3;
      if (d.dir === 'h') o += `<path d="M${f(d.x1)} ${f(d.ref)}V${f(d.at + 1.5)}M${f(d.x2)} ${f(d.ref)}V${f(d.at + 1.5)}M${f(d.x1)} ${f(d.at)}H${f(d.x2)}M${f(d.x1 - 1.2)} ${f(d.at + 1.2)}l2.4 -2.4M${f(d.x2 - 1.2)} ${f(d.at + 1.2)}l2.4 -2.4" stroke-width="0.6" vector-effect="non-scaling-stroke" fill="none"/><text x="${f((d.x1 + d.x2) / 2)}" y="${f(d.at - 1.2)}" font-size="${fs}" stroke="none" font-weight="${d.overall ? 700 : 400}">${v}</text>`;
      else o += `<path d="M${f(d.ref)} ${f(d.y1)}H${f(d.at - 1.5)}M${f(d.ref)} ${f(d.y2)}H${f(d.at - 1.5)}M${f(d.at)} ${f(d.y1)}V${f(d.y2)}M${f(d.at - 1.2)} ${f(d.y1 - 1.2)}l2.4 2.4M${f(d.at - 1.2)} ${f(d.y2 - 1.2)}l2.4 2.4" stroke-width="0.6" vector-effect="non-scaling-stroke" fill="none"/><text transform="translate(${f(d.at - 1.2)} ${f((d.y1 + d.y2) / 2)}) rotate(-90)" font-size="${fs}" stroke="none" font-weight="${d.overall ? 700 : 400}">${v}</text>`;
    }
    return o + `</g>`;
  }
  function fitView() {
    if (!geo) return; const b = geo.bboxBleed; const x0 = Math.min(b.x, geo.bbox.x - 30), y1 = Math.max(b.y1, geo.bbox.y1 + 28);
    const pad = 8; vb = { x: x0 - pad, y: b.y - pad, w: b.x1 - x0 + 2 * pad, h: y1 - b.y + 2 * pad };
    const r = svg.getBoundingClientRect(); if (r.width && r.height) { const a = r.width / r.height, va = vb.w / vb.h; if (a > va) { const nw = vb.h * a; vb.x -= (nw - vb.w) / 2; vb.w = nw; } else { const nh = vb.w / a; vb.y -= (nh - vb.h) / 2; vb.h = nh; } }
    applyVB();
  }
  const applyVB = () => vb && svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  const toMM = (e) => { const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const m = svg.getScreenCTM(); const q = pt.matrixTransform(m.inverse()); return [q.x, q.y]; };
  function zoom(k, cx, cy) { if (!vb) return; if (cx === undefined) { cx = vb.x + vb.w / 2; cy = vb.y + vb.h / 2; } vb = { x: cx - (cx - vb.x) * k, y: cy - (cy - vb.y) * k, w: vb.w * k, h: vb.h * k }; applyVB(); }
  svg.addEventListener('wheel', (e) => { e.preventDefault(); const [x, y] = toMM(e); zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12, x, y); }, { passive: false });
  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    const elNode = e.target.closest('[data-el]');
    const start = toMM(e);
    if (state.drawFinish) {
      const fc = faceAtPoint(geo, start[0], start[1]) || (state.selectedFace && geo.faces.find((q) => q.id === state.selectedFace));
      if (!fc) { drag = { type: 'pan', sx: e.clientX, sy: e.clientY, vb0: { ...vb }, face: null, moved: false }; }
      else {
        const loc = flatToFaceLocal(fc, start[0], start[1]);
        drag = { type: 'finish', fc, start, loc, moved: false };
        hooks.select?.(null, fc.id);
      }
    } else if (elNode && state.layers.art) {
      const id = elNode.getAttribute('data-el'); const el = state.elements.find((q) => q.id === id);
      hooks.select(id, el.face);
      drag = { type: 'el', el, start, x0: el.x, y0: el.y, moved: false };
    } else {
      const pn = e.target.closest('[data-panel]');
      drag = { type: 'pan', sx: e.clientX, sy: e.clientY, vb0: { ...vb }, face: pn && pn.getAttribute('data-face'), moved: false };
    }
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (drag.type === 'pan') {
      const r = svg.getBoundingClientRect(); const dx = ((e.clientX - drag.sx) * vb.w) / r.width, dy = ((e.clientY - drag.sy) * vb.h) / r.height;
      if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 3) drag.moved = true;
      vb = { ...drag.vb0, x: drag.vb0.x - dx, y: drag.vb0.y - dy }; applyVB(); return;
    }
    if (drag.type === 'finish') {
      const p = toMM(e); const loc = flatToFaceLocal(drag.fc, p[0], p[1]);
      if (Math.hypot(p[0] - drag.start[0], p[1] - drag.start[1]) > 0.8) drag.moved = true;
      drag.loc2 = loc;
      let prev = svg.querySelector('#finishPreview'); if (prev) prev.remove();
      const x = (drag.loc[0] + loc[0]) / 2, y = (drag.loc[1] + loc[1]) / 2;
      const w = Math.abs(loc[0] - drag.loc[0]), h = Math.abs(loc[1] - drag.loc[1]);
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      g.id = 'finishPreview';
      g.setAttribute('transform', `translate(${f(drag.fc.cx)} ${f(drag.fc.cy)}) rotate(${drag.fc.rot}) translate(${f(x)} ${f(y)})`);
      g.setAttribute('x', f(-w / 2)); g.setAttribute('y', f(-h / 2)); g.setAttribute('width', f(w)); g.setAttribute('height', f(h));
      g.setAttribute('fill', 'rgba(201,162,39,0.2)'); g.setAttribute('stroke', '#c9a227'); g.setAttribute('stroke-width', '1.2'); g.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.appendChild(g);
      return;
    }
    const p = toMM(e); const dx = p[0] - drag.start[0], dy = p[1] - drag.start[1];
    const fc = geo.faces.find((q) => q.id === drag.el.face); const a = (-fc.rot * Math.PI) / 180;
    drag.el.x = drag.x0 + dx * Math.cos(a) - dy * Math.sin(a); drag.el.y = drag.y0 + dx * Math.sin(a) + dy * Math.cos(a); drag.moved = true;
    const node = svg.querySelector(`[data-el="${drag.el.id}"]`); if (node) node.setAttribute('transform', elTransform(fc, drag.el));
    const sb = svg.querySelector('#selbox'); if (sb) sb.setAttribute('transform', elTransform(fc, drag.el));
    hooks.dragging?.(drag.el);
  });
  const end = () => {
    if (!drag) return;
    if (drag.type === 'el' && drag.moved) hooks.changed();
    if (drag.type === 'pan' && !drag.moved) hooks.select(null, drag.face || null);
    if (drag.type === 'finish') {
      const prev = svg.querySelector('#finishPreview'); if (prev) prev.remove();
      if (drag.moved && drag.loc2) {
        const x = (drag.loc[0] + drag.loc2[0]) / 2, y = (drag.loc[1] + drag.loc2[1]) / 2;
        const w = Math.abs(drag.loc2[0] - drag.loc[0]), h = Math.abs(drag.loc2[1] - drag.loc[1]);
        if (w > 1 && h > 1) hooks.finishRect?.(drag.fc.id, x, y, w, h);
      }
    }
    drag = null;
  };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  new ResizeObserver(() => geo && fitView()).observe(svg);
  return { render, fitView, zoom };
}
