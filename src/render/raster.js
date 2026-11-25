// Canvas renderer for flat artwork (used for 3D textures, PNG export and PDF/SVG artwork layer).
import { FACE_EN, KIND_EN } from '../core/builder.js';
import { regionsByProcess, usedProcesses } from '../core/finish.js';

export const imageCache = new Map();
export function getImage(el) {
  if (!el.src) return null;
  let im = imageCache.get(el.src);
  if (!im) { im = new Image(); im.src = el.src; imageCache.set(el.src, im); }
  return im.complete && im.naturalWidth ? im : null;
}
export function ringsPath(ctx, rings) { ctx.beginPath(); for (const r of rings) { r.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); } }

/** Face local → flat transform for an element; returns a function that applies it to a ctx. */
export function faceOf(geo, faceId) { return geo.faces.find((f) => f.id === faceId); }

export function drawElements(ctx, geo, state, faceFilter) {
  for (const el of state.elements) {
    const f = faceOf(geo, el.face); if (!f || (faceFilter && !faceFilter(el))) continue;
    const region = geo.faceRegions[f.panelId]; if (!region) continue;
    ctx.save(); ringsPath(ctx, region); ctx.clip('nonzero');
    ctx.translate(f.cx, f.cy); ctx.rotate((f.rot * Math.PI) / 180); ctx.translate(el.x, el.y); ctx.rotate((el.rot * Math.PI) / 180);
    if (el.type === 'image') {
      const im = getImage(el); if (im) { const h = (el.w * im.naturalHeight) / im.naturalWidth; ctx.drawImage(im, -el.w / 2, -h / 2, el.w, h); }
    } else if (el.type === 'text') {
      ctx.fillStyle = el.color || '#000'; ctx.font = `${el.bold ? 'bold ' : ''}${el.size}px ${el.font || '"Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif'}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const lines = String(el.text || '').split('\n'); lines.forEach((ln, i) => ctx.fillText(ln, 0, (i - (lines.length - 1) / 2) * el.size * 1.25));
    }
    ctx.restore();
  }
}

export function paintArtwork(ctx, geo, state) {
  ctx.fillStyle = state.boxColor; ringsPath(ctx, geo.bleedRegion); ctx.fill('nonzero');
  for (const f of geo.faces) {
    const col = state.faceColors[f.id]; if (!col) continue;
    ctx.fillStyle = col; ringsPath(ctx, geo.faceRegions[f.panelId]); ctx.fill('nonzero');
  }
  drawElements(ctx, geo, state);
}

export function drawLines(ctx, geo, { lw = 0.3, labels = true, dims = true, bleed = true } = {}) {
  const seg = (list, style, dash) => { ctx.strokeStyle = style; ctx.setLineDash(dash); ctx.beginPath(); for (const l of list) { l.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); } ctx.stroke(); };
  ctx.lineWidth = lw;
  if (bleed) { ctx.lineWidth = lw * 0.7; ctx.strokeStyle = '#2b7bd6'; ctx.setLineDash([1.5, 1]); ringsPath(ctx, geo.bleedRegion); ctx.stroke(); ctx.lineWidth = lw; }
  seg(geo.crease, '#11a04a', [2.5, 1.5]);
  seg(geo.perf, '#e0262b', [0.8, 0.8]);
  seg(geo.cut, '#e0262b', []);
  ctx.setLineDash([]);
  if (labels) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const p of geo.panels) {
      const t = p.face ? FACE_EN[p.face] : KIND_EN[p.kind]; if (!t) continue;
      const xs = p.poly.map((q) => q[0]), ys = p.poly.map((q) => q[1]);
      const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
      const fs = Math.max(1.5, Math.min(6, Math.min(w, h) * 0.18)); ctx.font = `${fs}px sans-serif`;
      ctx.fillText(t, (Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2);
    }
  }
}

/** Render artwork (and optionally the dieline) to a canvas. ppm = pixels per millimetre. */
export function renderFlat(geo, state, { ppm = 4, lines = false, maxPx = 4096, background = null } = {}) {
  const bb = geo.bboxBleed;
  ppm = Math.min(ppm, maxPx / Math.max(bb.w, bb.h));
  const cv = document.createElement('canvas'); cv.width = Math.ceil(bb.w * ppm); cv.height = Math.ceil(bb.h * ppm);
  const ctx = cv.getContext('2d');
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, cv.width, cv.height); }
  ctx.setTransform(ppm, 0, 0, ppm, -bb.x * ppm, -bb.y * ppm);
  paintArtwork(ctx, geo, state);
  paintFinishColor(ctx, geo, state);
  if (lines) drawLines(ctx, geo, { lw: Math.max(0.25, 1.2 / ppm) });
  return { canvas: cv, ppm, bbox: bb };
}


const FOIL_HEX = { 'foil-gold': '#d4a017', 'foil-silver': '#c5c8cc' };

function eachProcPoly(geo, state, fn) {
  const by = regionsByProcess(state, geo);
  for (const [id, items] of Object.entries(by)) for (const it of items) fn(id, it.poly);
}

/** Overlay foil colours onto an artwork canvas already transformed to mm space. */
export function paintFinishColor(ctx, geo, state) {
  eachProcPoly(geo, state, (id, poly) => {
    const hex = FOIL_HEX[id]; if (!hex) return;
    ctx.save(); ctx.fillStyle = hex; ctx.beginPath();
    poly.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath(); ctx.fill(); ctx.restore();
  });
}

/** PBR maps (roughness / metalness / bump) in the same frame as the artwork texture. */
export function renderFinishMaps(geo, state, { ppm = 4, maxPx = 2048 } = {}) {
  const bb = geo.bboxBleed;
  ppm = Math.min(ppm, maxPx / Math.max(bb.w, bb.h));
  const w = Math.max(2, Math.ceil(bb.w * ppm)), h = Math.max(2, Math.ceil(bb.h * ppm));
  const make = (fill) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
    x.fillStyle = fill; x.fillRect(0, 0, w, h);
    x.setTransform(ppm, 0, 0, ppm, -bb.x * ppm, -bb.y * ppm);
    return [c, x];
  };
  const lam = state.lamination || 'none';
  const used = usedProcesses(state);
  const hasRev = used.some((p) => p.id === 'reverse-uv');
  const hasUV = used.some((p) => p.id === 'uv');
  let baseR = lam === 'gloss' ? 40 : lam === 'matte' ? 210 : 120;
  if (hasRev) baseR = 24; // flood gloss, matte only in reverse-uv regions
  const [roughCv, rough] = make(`rgb(${baseR},${baseR},${baseR})`);
  const [metalCv, metal] = make('#000');
  const [bumpCv, bump] = make('#808080');
  const fillPolys = (ctx, polys, style) => {
    ctx.fillStyle = style; ctx.beginPath();
    for (const poly of polys) { poly.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); }
    ctx.fill();
  };
  const by = regionsByProcess(state, geo);
  if (by.uv) fillPolys(rough, by.uv.map((x) => x.poly), '#0a0a0a');
  if (by['reverse-uv']) fillPolys(rough, by['reverse-uv'].map((x) => x.poly), '#d0d0d0');
  if (by['foil-gold']) { fillPolys(metal, by['foil-gold'].map((x) => x.poly), '#fff'); fillPolys(rough, by['foil-gold'].map((x) => x.poly), '#3a3a3a'); }
  if (by['foil-silver']) { fillPolys(metal, by['foil-silver'].map((x) => x.poly), '#fff'); fillPolys(rough, by['foil-silver'].map((x) => x.poly), '#2a2a2a'); }
  if (by.emboss) fillPolys(bump, by.emboss.map((x) => x.poly), '#d0d0d0');
  if (by.deboss) fillPolys(bump, by.deboss.map((x) => x.poly), '#404040');
  if (by.sculpt) fillPolys(bump, by.sculpt.map((x) => x.poly), '#f2f2f2');
  return { roughness: roughCv, metalness: metalCv, bump: bumpCv, ppm, hasFinish: used.length > 0 || lam !== 'none', hasSculpt: !!by.sculpt, hasUV: hasUV || hasRev || lam === 'gloss' };
}

