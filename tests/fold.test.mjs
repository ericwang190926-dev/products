// Regression: after a full fold, printed (outer) faces of adjacent walls meet at
// corners. Midplane-only rotation leaves a gap of t·sin(θ/2) once each face is
// offset by ±t/2 along its own normal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { STYLES, STYLE_MAP } from '../src/core/styles/index.js';
import { buildGeometry } from '../src/core/model.js';
import { computeFold, to3 } from '../src/core/fold.js';
import { rect, outsetPoly, bbox, area } from '../src/core/geom.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a.toFixed(4)} expected ${b.toFixed(4)} (tol ${tol})`);

function thickOf(p, geo) { return p.thick ?? geo.ctx.t ?? 0; }

function worldFacePt(panel, mats, geo, q, side) {
  const half = thickOf(panel, geo) / 2;
  const v = to3(q);
  v.z += side === 'b' ? -half : half;
  return v.applyMatrix4(mats[panel.id]);
}

function hingePrintedGap(geo, mats, child) {
  const par = geo.byId[child.parent];
  const pts = [child.hinge[0], child.hinge[1], [(child.hinge[0][0] + child.hinge[1][0]) / 2, (child.hinge[0][1] + child.hinge[1][1]) / 2]];
  let max = 0;
  for (const q of pts) {
    const a = worldFacePt(par, mats, geo, q, 'f');
    const b = worldFacePt(child, mats, geo, q, 'f');
    max = Math.max(max, a.distanceTo(b));
  }
  return max;
}

function distPointSeg(p, a, b) {
  const ab = b.clone().sub(a);
  const len = ab.length();
  if (len < 1e-9) return p.distanceTo(a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / (len * len)));
  return p.distanceTo(a.clone().add(ab.multiplyScalar(t)));
}

function edgesCoincide(a0, a1, b0, b1, tol) {
  if (a0.distanceTo(a1) < 1 || b0.distanceTo(b1) < 1) return false;
  return distPointSeg(a0, b0, b1) < tol && distPointSeg(a1, b0, b1) < tol
    && distPointSeg(b0, a0, a1) < tol && distPointSeg(b1, a0, a1) < tol;
}

function structural(p) {
  if (p.layer) return false;
  const k = p.kind;
  return !k || k === 'panel' || k === 'wall' || k === 'lid' || k === 'base';
}

function printedEdgePts(panel, mats, geo, i) {
  const a = panel.poly[i], b = panel.poly[(i + 1) % panel.poly.length];
  return [worldFacePt(panel, mats, geo, a, 'f'), worldFacePt(panel, mats, geo, b, 'f')];
}

function midEdgePts(panel, mats, i) {
  const a = panel.poly[i], b = panel.poly[(i + 1) % panel.poly.length];
  return [to3(a).applyMatrix4(mats[panel.id]), to3(b).applyMatrix4(mats[panel.id])];
}

function siblingPrintedGaps(geo, midMats, thickMats) {
  const panels = geo.panels.filter((p) => structural(p) && midMats[p.id]);
  const gaps = [];
  for (let i = 0; i < panels.length; i++) {
    for (let j = i + 1; j < panels.length; j++) {
      const A = panels[i], B = panels[j];
      if (A.parent === B.id || B.parent === A.id) continue;
      for (let ea = 0; ea < A.poly.length; ea++) {
        const [a0, a1] = midEdgePts(A, midMats, ea);
        for (let eb = 0; eb < B.poly.length; eb++) {
          const [b0, b1] = midEdgePts(B, midMats, eb);
          if (!edgesCoincide(a0, a1, b0, b1, 0.2)) continue;
          const [pa, pb] = printedEdgePts(A, thickMats, geo, ea);
          const [qa, qb] = printedEdgePts(B, thickMats, geo, eb);
          const d = Math.min(
            distPointSeg(pa, qa, qb), distPointSeg(pb, qa, qb),
            distPointSeg(qa, pa, pb), distPointSeg(qb, pa, pb),
          );
          gaps.push({ a: A.id, b: B.id, d });
        }
      }
    }
  }
  return gaps;
}

function build(styleId, extra = {}) {
  const style = STYLE_MAP[styleId];
  const d = style.defaults;
  const t = extra.t ?? (style.material === 'grey2' || style.category === 'rigid' ? 1.9 : 0.5);
  return buildGeometry(styleId, { L: d.L, W: d.W, H: d.H, t, wrap: style.category === 'rigid', ...extra, params: { ...(extra.params || {}) } });
}

const HINGE_TOL = 0.08;
const CORNER_TOL = 0.12;

for (const style of STYLES) {
  test(`printed faces meet at hinges: ${style.id}`, () => {
    const geo = build(style.id);
    const mats = computeFold(geo, { progress: 1, open: 0, thickness: true });
    const t = geo.ctx.t;
    for (const p of geo.panels) {
      if (!p.parent || !p.hinge || !mats[p.id] || !mats[p.parent]) continue;
      const ang = p.angle || 0;
      if (Math.abs(ang) < 8 || Math.abs(ang) > 135) continue;
      const gap = hingePrintedGap(geo, mats, p);
      assert.ok(gap <= HINGE_TOL, `${style.id} ${p.parent}→${p.id} (${p.kind}, ${ang}°, t=${t}) printed hinge gap ${gap.toFixed(4)} mm`);
    }
  });
}

for (const style of STYLES) {
  test(`printed faces meet at sibling corners: ${style.id}`, () => {
    const geo = build(style.id);
    const mid = computeFold(geo, { progress: 1, open: 0, thickness: false });
    const thick = computeFold(geo, { progress: 1, open: 0, thickness: true });
    const gaps = siblingPrintedGaps(geo, mid, thick);
    for (const g of gaps) {
      assert.ok(g.d <= CORNER_TOL, `${style.id} ${g.a}↔${g.b} printed corner gap ${g.d.toFixed(4)} mm`);
    }
  });
}

test('天地盒 half and full lid both close at corners', () => {
  for (const lidType of ['half', 'full']) {
    const geo = build('lidbase', { params: { lidType } });
    const mats = computeFold(geo, { progress: 1, open: 0, thickness: true });
    const mid = computeFold(geo, { progress: 1, open: 0, thickness: false });
    for (const id of ['front', 'lidfront']) {
      const p = geo.byId[id];
      const gap = hingePrintedGap(geo, mats, p);
      assert.ok(gap <= HINGE_TOL, `lidbase ${lidType} ${id} hinge gap ${gap.toFixed(4)}`);
    }
    const gaps = siblingPrintedGaps(geo, mid, mats);
    const pairs = gaps.filter((g) => (g.a === 'front' && g.b === 'left') || (g.a === 'left' && g.b === 'front')
      || (g.a === 'lidfront' && g.b === 'lidleft') || (g.a === 'lidleft' && g.b === 'lidfront'));
    assert.ok(pairs.length > 0, `lidbase ${lidType} should have front/left printed corners`);
    for (const g of pairs) assert.ok(g.d <= CORNER_TOL, `lidbase ${lidType} ${g.a}↔${g.b} ${g.d.toFixed(4)}`);
  }
});

test('书型盒 long and short opening both close at tray corners', () => {
  for (const openDir of ['long', 'short']) {
    const geo = build('book', { t: 1.9, wrap: true, params: { openDir } });
    const mats = computeFold(geo, { progress: 1, open: 0, thickness: true });
    const mid = computeFold(geo, { progress: 1, open: 0, thickness: false });
    for (const p of geo.panels) {
      if (!p.parent || !p.hinge || Math.abs(p.angle) < 8 || Math.abs(p.angle) > 135) continue;
      if (!mats[p.id] || !mats[p.parent]) continue;
      const gap = hingePrintedGap(geo, mats, p);
      assert.ok(gap <= HINGE_TOL, `book ${openDir} ${p.parent}→${p.id} ${gap.toFixed(4)}`);
    }
    for (const g of siblingPrintedGaps(geo, mid, mats)) {
      assert.ok(g.d <= CORNER_TOL, `book ${openDir} ${g.a}↔${g.b} ${g.d.toFixed(4)}`);
    }
  }
});

test('封套盒 with rigid and folding inner boxes close at corners', () => {
  for (const innerBox of ['rigid', 'folding']) {
    const geo = build('sleeve', { t: 0.5, wrap: true, params: { innerBox } });
    const mats = computeFold(geo, { progress: 1, open: 0, thickness: true });
    const mid = computeFold(geo, { progress: 1, open: 0, thickness: false });
    for (const p of geo.panels) {
      if (!p.parent || !p.hinge || Math.abs(p.angle) < 8 || Math.abs(p.angle) > 135) continue;
      if (!mats[p.id] || !mats[p.parent]) continue;
      const gap = hingePrintedGap(geo, mats, p);
      assert.ok(gap <= HINGE_TOL, `sleeve ${innerBox} ${p.parent}→${p.id} ${gap.toFixed(4)}`);
    }
    for (const g of siblingPrintedGaps(geo, mid, mats)) {
      assert.ok(g.d <= CORNER_TOL, `sleeve ${innerBox} ${g.a}↔${g.b} ${g.d.toFixed(4)}`);
    }
  }
});

test('midplane fold (thickness:false) still leaves the classic t·sin(θ/2) gap', () => {
  const geo = build('lidbase', { t: 1.9 });
  const mats = computeFold(geo, { progress: 1, open: 0, thickness: false });
  const gap = hingePrintedGap(geo, mats, geo.byId.front);
  near(gap, 1.9 * Math.sin(Math.PI / 4), 0.02, 'uncompensated 90° gap');
});

test('outsetPoly expands a rectangle by the given margin', () => {
  const o = outsetPoly(rect(0, 0, 100, 100).poly, 2);
  const b = bbox(o);
  near(b.x, -2, 1e-6, 'outset x');
  near(b.y, -2, 1e-6, 'outset y');
  near(b.w, 104, 1e-6, 'outset w');
  near(b.h, 104, 1e-6, 'outset h');
  assert.ok(area(o) > 10000, 'area grows');
});
