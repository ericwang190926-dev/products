// Automated geometry checks for every box style across several L/W/H and board thicknesses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Plane } from 'three';
import { STYLES } from '../src/core/styles/index.js';
import { buildGeometry } from '../src/core/model.js';
import { computeFold, foldedPoints, foldedBBox } from '../src/core/fold.js';
import ClipperLib from 'clipper-lib';
import { bbox, pointOnPolyBoundary, area } from '../src/core/geom.js';

const DIMS = [null, { L: 30, W: 25, H: 200 }, { L: 120, W: 80, H: 60 }, { L: 60, W: 60, H: 60 }, { L: 250, W: 160, H: 90 }];
const THICK = [0.5, 1.5];
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a.toFixed(3)} expected ${b.toFixed(3)} (tol ${tol})`);

let checks = 0;
for (const style of STYLES) {
  for (const dd of DIMS) for (const t of THICK) {
    const d = dd || style.defaults;
    const name = `${style.id} L${d.L} W${d.W} H${d.H} t${t}`;
    test(name, () => {
      const geo = buildGeometry(style.id, { ...d, t, bleed: 3 });
      const c = geo.ctx;
      // 1. finite coordinates, positive areas
      for (const p of geo.panels) {
        for (const q of p.poly) assert.ok(Number.isFinite(q[0]) && Number.isFinite(q[1]), `${p.id} has NaN`);
        assert.ok(Math.abs(area(p.poly)) > 0.5, `${p.id} degenerate area ${area(p.poly)}`);
        checks++;
      }
      // 2. hinges lie on both parent and child boundaries
      for (const p of geo.panels.filter((q) => q.parent)) {
        const par = geo.byId[p.parent];
        for (const h of p.hinge) {
          assert.ok(pointOnPolyBoundary(h, p.poly, 0.01), `${p.id} hinge not on own edge`);
          assert.ok(pointOnPolyBoundary(h, par.poly, 0.01), `${p.id} hinge not on parent ${par.id} edge`);
        }
        checks++;
      }
      // 3. lines exist, bleed region encloses outline
      assert.ok(geo.cut.length > 0 && geo.crease.length > 0, 'needs cut + crease lines');
      const ob = geo.bbox, bb = geo.bboxBleed;
      for (const v of [ob.x - bb.x, bb.x1 - ob.x1, ob.y - bb.y, bb.y1 - ob.y1]) assert.ok(v >= 2.95 && v <= 6.1, 'bleed offset ' + v); // miter corners may extend up to the miter limit
      // 3b. no two panels overlap in the flat layout (sheet must be cuttable)
      const toC = (poly) => poly.map((q) => ({ X: Math.round(q[0] * 1000), Y: Math.round(q[1] * 1000) }));
      for (let i = 0; i < geo.panels.length; i++) for (let j = i + 1; j < geo.panels.length; j++) {
        const a = geo.panels[i], b2 = geo.panels[j]; const ba = bbox(a.poly), bb2 = bbox(b2.poly);
        if (ba.x1 < bb2.x || bb2.x1 < ba.x || ba.y1 < bb2.y || bb2.y1 < ba.y) continue;
        const cl = new ClipperLib.Clipper(); cl.AddPath(toC(a.poly), ClipperLib.PolyType.ptSubject, true); cl.AddPath(toC(b2.poly), ClipperLib.PolyType.ptClip, true);
        const r = new ClipperLib.Paths(); cl.Execute(ClipperLib.ClipType.ctIntersection, r, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
        const ov = r.reduce((s2, path) => s2 + Math.abs(ClipperLib.Clipper.Area(path)) / 1e6, 0);
        assert.ok(ov < 0.05, `panels ${a.id} and ${b2.id} overlap by ${ov.toFixed(2)} mm²`);
      }
      // 3c. every face has a printable region that covers its panel
      for (const f of geo.faces) { const r = geo.faceRegions[f.panelId]; assert.ok(r && r.length, `face ${f.id} has no print region`); const a = r.reduce((s2, ring) => s2 + area(ring), 0); assert.ok(Math.abs(a) >= Math.abs(area(geo.byId[f.panelId].poly)) - 0.5 - Math.abs(geo.byId[f.panelId].holes.reduce((s3, h) => s3 + area(h), 0)), `face ${f.id} print region too small`); }
      // 4. holes inside their panel
      for (const p of geo.panels) for (const h of p.holes) { const hb = bbox(h), pb = bbox(p.poly); assert.ok(hb.x >= pb.x - 0.01 && hb.x1 <= pb.x1 + 0.01 && hb.y >= pb.y - 0.01 && hb.y1 <= pb.y1 + 0.01, `${p.id} hole outside panel`); }
      // 5. face panel dimensions
      const ex = style.expect && style.expect(c);
      if (ex?.faces) for (const [f, [w, h]] of Object.entries(ex.faces)) {
        const fp = geo.panels.find((p) => p.face === f); assert.ok(fp, `face ${f} missing`);
        const pb = bbox(fp.poly); near(pb.w, w, 0.01, `${f} width`); near(pb.h, h, 0.01, `${f} height`); checks++;
      }
      // 6. folding: assembled envelope equals the expected (mid-plane) size and nothing pokes out
      for (const pr of [0, 0.37, 0.8]) { const m = computeFold(geo, { progress: pr, open: 0.3 }); for (const p of geo.panels) for (const v of foldedPoints(geo, m, p)) assert.ok(Number.isFinite(v.x + v.y + v.z), 'NaN fold'); }
      if (ex) {
        const mats = computeFold(geo, { progress: 1 });
        const filt = ex.filter || (() => true);
        const env = foldedBBox(geo, mats, filt);
        const tol = ex.tol ?? 0.05;
        const got = [env.size.x, env.size.y, env.size.z].sort((a, b) => a - b), want = [...ex.size].sort((a, b) => a - b);
        for (let i = 0; i < 3; i++) near(got[i], want[i], tol, `folded envelope axis ${i}`);
        checks++;
        // glue flaps must lie flat against some face panel
        const planes = geo.panels.filter((p) => p.face || p.kind === 'wall' || p.kind === 'panel').map((p) => { const pts = foldedPoints(geo, mats, p); return new Plane().setFromCoplanarPoints(pts[0], pts[1], pts[2]); });
        for (const gp of geo.panels.filter((p) => p.kind === 'glue')) {
          const pts = foldedPoints(geo, mats, gp);
          assert.ok(planes.some((pl) => pts.every((v) => Math.abs(pl.distanceToPoint(v)) < 0.05)), `${gp.id} not lying on a panel`);
          checks++;
        }
      }
    });
  }
}
// Explicit spot checks of production dimensions
test('spot: straight tuck end panel sizes', () => {
  const g = buildGeometry('ste', { L: 30, W: 25, H: 200, t: 0.5 });
  const sz = (id) => { const b = bbox(g.byId[id].poly); return [+b.w.toFixed(3), +b.h.toFixed(3)]; };
  assert.deepEqual(sz('front'), [30.5, 200.5]); assert.deepEqual(sz('left'), [25.5, 200.5]); assert.deepEqual(sz('top'), [30.5, 25.5]);
  assert.equal(+g.bbox.w.toFixed(3), +(g.ctx.p.glue + 2 * 30.5 + 2 * 25.5).toFixed(3));
});
test('spot: lid & base clearance', () => {
  const g = buildGeometry('lidbase', { L: 200, W: 100, H: 50, t: 2 });
  const base = bbox(g.byId.base.poly), lid = bbox(g.byId.lidbase.poly);
  near(lid.w - base.w, 2 * 2 + 2 * g.ctx.p.clear, 1e-6, 'lid longer by 2t+2c'); near(lid.h - base.h, 2 * 2 + 2 * g.ctx.p.clear, 1e-6, 'lid wider');
});
test('spot: gable top meets at handle', () => {
  const g = buildGeometry('gable', { L: 120, W: 70, H: 150, t: 0.5 });
  const m = computeFold(g, { progress: 1 });
  const fH = foldedPoints(g, m, g.byId.frontHandle), bH = foldedPoints(g, m, g.byId.backHandle);
  const zf = fH.reduce((s, v) => s + v.z, 0) / fH.length, zb = bH.reduce((s, v) => s + v.z, 0) / bH.length;
  near(zf, zb, 0.01, 'handles back-to-back');
  // corner triangles' solved corner reaches the gable corner
  for (const id of ['leftCor0', 'leftCor1', 'rightCor0', 'rightCor1']) {
    const p = g.byId[id]; const v = foldedPoints(g, m, p)[1]; const t = new Vector3(p.solve.targetPoint[0], -p.solve.targetPoint[1], 0).applyMatrix4(m[p.solve.target]);
    near(v.distanceTo(t), 0, 0.05, id + ' corner closes');
  }
});
test('spot: pillow panel width equals lens arc', () => {
  const g = buildGeometry('pillow', { L: 160, W: 80, H: 30, t: 0.5 });
  const b = bbox(g.byId.p1.poly); const s = 15, R = (1600 + 225) / 30; near(b.w, 2 * R * Math.asin(80 / (2 * R)) + 0.5, 1e-6, 'pillow panel');
});
test.after?.(() => console.log('geometry checks run:', checks));
