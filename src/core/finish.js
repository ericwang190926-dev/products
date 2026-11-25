import { PROCESSES, PROCESS_MAP } from './materials.js';

/** Size of an artwork element in face-local millimetres (centred on the element). */
export function elementSize(el) {
  if (el.type === 'image') {
    const r = el.ratio || 1;
    return [el.w, el.w * r];
  }
  const lines = String(el.text || '').split('\n');
  const longest = Math.max(...lines.map((l) => [...l].reduce((s, ch) => s + (ch.charCodeAt(0) > 255 ? 1 : 0.58), 0)));
  return [Math.max(4, longest * el.size), lines.length * el.size * 1.25];
}

/** Live finish regions (element-linked ones pick up current size/position). */
export function finishRegionsOf(state) {
  const out = [];
  for (const r of state.finishRegions || []) {
    if (r.type === 'el') {
      const el = (state.elements || []).find((e) => e.id === r.elementId);
      if (!el) continue;
      const [w, h] = elementSize(el);
      out.push({ ...r, face: el.face, x: el.x, y: el.y, w, h, rot: el.rot, processes: r.processes || [] });
    } else {
      out.push({ ...r, processes: r.processes || [] });
    }
  }
  return out;
}

export function regionPoly(geo, region) {
  const f = geo.faces.find((q) => q.id === region.face);
  if (!f) return null;
  const w = +region.w || 0, h = +region.h || 0;
  if (w < 0.2 || h < 0.2) return null;
  const corners = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  const r1 = ((region.rot || 0) * Math.PI) / 180, r2 = ((f.rot || 0) * Math.PI) / 180;
  const x = region.x || 0, y = region.y || 0;
  return corners.map(([px, py]) => {
    const qx = px * Math.cos(r1) - py * Math.sin(r1) + x;
    const qy = px * Math.sin(r1) + py * Math.cos(r1) + y;
    return [qx * Math.cos(r2) - qy * Math.sin(r2) + f.cx, qx * Math.sin(r2) + qy * Math.cos(r2) + f.cy];
  });
}

export function regionsByProcess(state, geo) {
  const map = {};
  for (const r of finishRegionsOf(state)) {
    const poly = regionPoly(geo, r);
    if (!poly) continue;
    for (const id of r.processes) {
      if (!PROCESS_MAP[id]) continue;
      (map[id] ||= []).push({ region: r, poly });
    }
  }
  return map;
}

export function usedProcesses(state) {
  const ids = new Set();
  for (const r of state.finishRegions || []) for (const p of r.processes || []) if (PROCESS_MAP[p]) ids.add(p);
  return PROCESSES.filter((p) => ids.has(p.id));
}

/** Point in face-local coordinates (origin at face centre, face rot already applied). */
export function flatToFaceLocal(fc, x, y) {
  const a = ((-fc.rot || 0) * Math.PI) / 180;
  const dx = x - fc.cx, dy = y - fc.cy;
  return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
}

export function faceAtPoint(geo, x, y) {
  for (const f of geo.faces) {
    const rings = geo.faceRegions[f.panelId];
    if (rings && pointInRings(rings, x, y)) return f;
  }
  return null;
}

function pointInRings(rings, x, y) {
  let n = 0;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-15) + xi) n++;
    }
  }
  return n % 2 === 1;
}
