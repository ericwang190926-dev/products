// 2D geometry helpers. Flat layout coordinates are millimetres, x → right, y → down.
export const EPS = 1e-6;
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const mul = (a, s) => [a[0] * s, a[1] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
export const len = (a) => Math.hypot(a[0], a[1]);
export const dist = (a, b) => len(sub(a, b));
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const rot = (a, ang) => { const c = Math.cos(ang), s = Math.sin(ang); return [a[0] * c - a[1] * s, a[0] * s + a[1] * c]; };
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const deg = (r) => (r * 180) / Math.PI;
export const rad = (d) => (d * Math.PI) / 180;

/** Axis-aligned rectangle with clockwise (screen) edges; outward normal of edge p1→p2 is (dy,-dx). */
export function rect(x, y, w, h) {
  const tl = [x, y], tr = [x + w, y], br = [x + w, y + h], bl = [x, y + h];
  return { x, y, w, h, poly: [tl, tr, br, bl], top: [tl, tr], right: [tr, br], bottom: [br, bl], left: [bl, tl], cx: x + w / 2, cy: y + h / 2 };
}
export const outward = (e) => { const d = norm(sub(e[1], e[0])); return [d[1], -d[0]]; };
export const edgeLen = (e) => dist(e[0], e[1]);
export const rev = (e) => [e[1], e[0]];
/** Sub-segment of an edge from distance a to distance b along it. */
export function subEdge(e, a, b) { const d = norm(sub(e[1], e[0])); return [add(e[0], mul(d, a)), add(e[0], mul(d, b))]; }

export function bbox(points) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) { if (p[0] < x0) x0 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[0] > x1) x1 = p[0]; if (p[1] > y1) y1 = p[1]; }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, x1, y1 };
}
export function area(poly) { let a = 0; for (let i = 0; i < poly.length; i++) a += cross(poly[i], poly[(i + 1) % poly.length]); return a / 2; }
export function centroid(poly) {
  let cx = 0, cy = 0, a = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; const c = cross(p, q); a += c; cx += (p[0] + q[0]) * c; cy += (p[1] + q[1]) * c; }
  if (Math.abs(a) < EPS) { const b = bbox(poly); return [b.x + b.w / 2, b.y + b.h / 2]; }
  return [cx / (3 * a), cy / (3 * a)];
}
export function pointOnSegment(p, a, b, tol = 1e-3) {
  const ab = sub(b, a), l = len(ab); if (l < EPS) return dist(p, a) < tol;
  const t = dot(sub(p, a), ab) / (l * l); if (t < -tol / l || t > 1 + tol / l) return false;
  return Math.abs(cross(sub(p, a), ab)) / l < tol;
}
export function pointOnPolyBoundary(p, poly, tol = 1e-3) {
  for (let i = 0; i < poly.length; i++) if (pointOnSegment(p, poly[i], poly[(i + 1) % poly.length], tol)) return true;
  return false;
}
export function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/**
 * Flap polygon standing on edge e (outward side). Options:
 *  b1,b2 inset of the hinge from each end; o1,o2 extra inward inset of the outer edge; r corner radius of outer corners.
 * Returns { poly, hinge } (hinge = the part of e the flap is attached to).
 */
export function flap(e, depth, { b1 = 0, b2 = 0, o1 = 0, o2 = 0, r = 0, seg = 6 } = {}) {
  const d = norm(sub(e[1], e[0])), n = outward(e), L = edgeLen(e);
  const B1 = add(e[0], mul(d, b1)), B2 = add(e[0], mul(d, L - b2));
  const O1 = add(add(B1, mul(n, depth)), mul(d, o1)), O2 = add(add(B2, mul(n, depth)), mul(d, -o2));
  let poly = [B1, B2, O2, O1];
  if (r > 0) poly = filletPoly(poly, [2, 3], r, seg);
  return { poly, hinge: [B1, B2], far: [O1, O2], s1: [B1, O1], s2: [O2, B2] };
}
/** General flap from a local profile [[u,v]...] where u runs along e (mm from e[0]) and v outward. Hinge is u∈[0,L] at v=0. */
export function profile(e, pts) {
  const d = norm(sub(e[1], e[0])), n = outward(e);
  return pts.map(([u, v]) => add(add(e[0], mul(d, u)), mul(n, v)));
}
export const toLocal = (e) => { const d = norm(sub(e[1], e[0])), n = outward(e); return (u, v) => add(add(e[0], mul(d, u)), mul(n, v)); };

/** Round the polygon corners at the given vertex indices with radius r (clamped to fit). */
export function filletPoly(poly, idxs, r, seg = 6) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const V = poly[i];
    if (!idxs.includes(i) || r <= 0) { out.push(V); continue; }
    const P = poly[(i - 1 + poly.length) % poly.length], N = poly[(i + 1) % poly.length];
    const a = norm(sub(P, V)), b = norm(sub(N, V));
    const ang = Math.acos(clamp(dot(a, b), -1, 1));
    if (ang < 1e-3 || Math.abs(ang - Math.PI) < 1e-3) { out.push(V); continue; }
    let tdist = r / Math.tan(ang / 2);
    const maxT = Math.min(dist(P, V), dist(N, V)) * 0.49;
    let rr = r; if (tdist > maxT) { tdist = maxT; rr = tdist * Math.tan(ang / 2); }
    const T1 = add(V, mul(a, tdist)), T2 = add(V, mul(b, tdist));
    const bis = norm(add(a, b)); const C = add(V, mul(bis, rr / Math.sin(ang / 2)));
    let a1 = Math.atan2(T1[1] - C[1], T1[0] - C[0]), a2 = Math.atan2(T2[1] - C[1], T2[0] - C[0]);
    let da = a2 - a1; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    for (let k = 0; k <= seg; k++) { const t = a1 + (da * k) / seg; out.push([C[0] + rr * Math.cos(t), C[1] + rr * Math.sin(t)]); }
  }
  return out;
}
/** Circular arc through p1→p2 bulging by sagitta s to the left of p1→p2 (screen coords: use outward() side when s>0). */
export function arcPoints(p1, p2, s, seg = 24) {
  const c = dist(p1, p2); if (Math.abs(s) < 1e-6) return [p1, p2];
  const R = (c * c / 4 + s * s) / (2 * Math.abs(s));
  const m = lerp(p1, p2, 0.5), d = norm(sub(p2, p1)); const n = [d[1], -d[0]];
  const sign = Math.sign(s);
  const C = add(m, mul(n, -sign * (R - Math.abs(s))));
  const a1 = Math.atan2(p1[1] - C[1], p1[0] - C[0]); const a2 = Math.atan2(p2[1] - C[1], p2[0] - C[0]);
  let da = a2 - a1;
  // choose arc that passes through apex m + n*s
  const apex = add(m, mul(n, s)); const aa = Math.atan2(apex[1] - C[1], apex[0] - C[0]);
  const norm2 = (x) => { while (x > Math.PI) x -= 2 * Math.PI; while (x < -Math.PI) x += 2 * Math.PI; return x; };
  da = norm2(da); const dapex = norm2(aa - a1);
  if (Math.sign(dapex) !== Math.sign(da) || Math.abs(dapex) > Math.abs(da)) da = da > 0 ? da - 2 * Math.PI : da + 2 * Math.PI;
  const out = []; for (let k = 0; k <= seg; k++) { const t = a1 + (da * k) / seg; out.push([C[0] + R * Math.cos(t), C[1] + R * Math.sin(t)]); }
  out[0] = p1; out[seg] = p2; return out;
}
export function circlePoly(cx, cy, r, seg = 32) { const o = []; for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; o.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return o; }
export function roundRect(x, y, w, h, r, seg = 6) { return filletPoly(rect(x, y, w, h).poly, [0, 1, 2, 3], Math.min(r, w / 2, h / 2), seg); }
/** Regular polygon with first edge p1→p2, lying on the outward side of that edge. */
export function regularOnEdge(p1, p2, n) {
  const s = dist(p1, p2), ap = s / (2 * Math.tan(Math.PI / n)), out = outward([p1, p2]);
  const C = add(lerp(p1, p2, 0.5), mul(out, ap)); const R = s / (2 * Math.sin(Math.PI / n));
  const a0 = Math.atan2(p1[1] - C[1], p1[0] - C[0]); const a1 = Math.atan2(p2[1] - C[1], p2[0] - C[0]);
  let step = a1 - a0; while (step > Math.PI) step -= 2 * Math.PI; while (step < -Math.PI) step += 2 * Math.PI;
  const pts = []; for (let k = 0; k < n; k++) pts.push([C[0] + R * Math.cos(a0 + step * k), C[1] + R * Math.sin(a0 + step * k)]);
  pts[0] = p1; pts[1] = p2; return pts;
}
/** Euro hang slot (≈30×6 mm slot with Ø9 round top) centred horizontally at cx with slot top at cy. */
export function euroSlotParts(cx, cy, w = 30) {
  return [roundRect(cx - w / 2, cy, w, 6, 3), circlePoly(cx, cy + 1.5, 4.5, 28)];
}
