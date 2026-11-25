import test from 'node:test';
import assert from 'node:assert/strict';
import {
  thicknessFromGsm, interpolateTable, CALIPER_TABLES, resolvedThickness,
  defaultMaterialFor, defaultStructureFor, materialSummary, materialFromLegacy,
  quoteInfoLines, faceThickness,
} from '../src/core/materials.js';
import { buildGeometry } from '../src/core/model.js';
import { bbox } from '../src/core/geom.js';
import { STYLE_MAP } from '../src/core/styles/index.js';
import { trayWrapShape, coverWrapShape } from '../src/core/wrap.js';
import { regionPoly, elementSize, finishRegionsOf } from '../src/core/finish.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a} expected ${b} (tol ${tol})`);

test('350g 白卡 ≈ 0.50 mm', () => near(thicknessFromGsm('board', 350), 0.5, 0.01, '350g board'));
test('300g 白卡 ≈ 0.41 mm', () => near(thicknessFromGsm('board', 300), 0.41, 0.01, '300g board'));
test('400g 白卡 ≈ 0.58 mm', () => near(thicknessFromGsm('board', 400), 0.58, 0.01, '400g board'));
test('157g 铜版纸 ≈ 0.14 mm', () => near(thicknessFromGsm('coated', 157), 0.14, 0.01, '157g coated'));
test('200g 铜版纸 ≈ 0.175 mm', () => near(thicknessFromGsm('coated', 200), 0.175, 0.01, '200g coated'));
test('1000g 灰板 ≈ 1.55 mm (1.5–1.6 range)', () => near(thicknessFromGsm('greyboard', 1000), 1.55, 0.05, '1000g grey'));
test('1200g 灰板 ≈ 1.90 mm (1.8–2.0 range)', () => near(thicknessFromGsm('greyboard', 1200), 1.9, 0.1, '1200g grey'));
test('1400g 灰板 ≈ 2.20 mm', () => near(thicknessFromGsm('greyboard', 1400), 2.2, 0.05, '1400g grey'));
test('800g 灰板 ≈ 1.20 mm', () => near(thicknessFromGsm('greyboard', 800), 1.2, 0.05, '800g grey'));
test('1600g 灰板 ≈ 2.50 mm', () => near(thicknessFromGsm('greyboard', 1600), 2.5, 0.05, '1600g grey'));

test('custom gsm interpolates between table knots', () => {
  const t = thicknessFromGsm('greyboard', 1300);
  near(t, (1.9 + 2.2) / 2, 0.02, '1300g mid');
});

test('特种纸 棉纸 is bulkier than 铜版纸 at the same gsm', () => {
  const coated = thicknessFromGsm('coated', 200);
  const cotton = thicknessFromGsm('special', 200, 'cotton');
  assert.ok(cotton > coated * 1.1, `cotton ${cotton} vs coated ${coated}`);
});

test('default structure: 扣底盒 is carton, 天地盒 is rigid, 飞机盒 is corrugated', () => {
  assert.equal(defaultStructureFor('crash'), 'carton');
  assert.equal(defaultStructureFor('lidbase'), 'rigid');
  assert.equal(defaultStructureFor('book'), 'rigid');
  assert.equal(defaultStructureFor('drawer'), 'rigid');
  assert.equal(defaultStructureFor('mailer'), 'corrugated');
});

test('default materials: 天地盒 1200g灰板+157g铜版, 扣底盒 350g白卡', () => {
  const r = defaultMaterialFor('lidbase');
  assert.equal(r.structure, 'rigid');
  assert.equal(r.boardGsm, 1200);
  assert.equal(r.faceKind, 'coated');
  assert.equal(r.faceGsm, 157);
  near(resolvedThickness(r).t, 1.9, 0.05, 'rigid t');
  near(resolvedThickness(r).faceT, 0.14, 0.01, 'wrap paper t');
  const c = defaultMaterialFor('crash');
  assert.equal(c.structure, 'carton');
  assert.equal(c.boardGsm, 350);
  near(resolvedThickness(c).t, 0.5, 0.01, 'carton t');
});

test('tuck-end front panel grows with board gram weight', () => {
  const t350 = resolvedThickness(defaultMaterialFor('ste')).t;
  const t400 = resolvedThickness({ ...defaultMaterialFor('ste'), boardGsm: 400 }).t;
  const a = buildGeometry('ste', { L: 30, W: 25, H: 200, t: t350 });
  const b = buildGeometry('ste', { L: 30, W: 25, H: 200, t: t400 });
  near(bbox(a.byId.front.poly).w, 30 + t350, 1e-6, '350g front');
  near(bbox(b.byId.front.poly).w, 30 + t400, 1e-6, '400g front');
  assert.ok(bbox(b.byId.front.poly).w > bbox(a.byId.front.poly).w, 'thicker board → wider panel');
});

test('天地盒 lid grows when switching 1000g → 1400g 灰板', () => {
  const t1 = thicknessFromGsm('greyboard', 1000);
  const t2 = thicknessFromGsm('greyboard', 1400);
  const a = buildGeometry('lidbase', { L: 200, W: 100, H: 50, t: t1 });
  const b = buildGeometry('lidbase', { L: 200, W: 100, H: 50, t: t2 });
  assert.ok(bbox(b.byId.lidbase.poly).w > bbox(a.byId.lidbase.poly).w, 'thicker greyboard → larger lid');
  // lid inner is base outer + 2*clearance; mid-plane lid = that + t, so lid-base = 2t + 2c
  near(bbox(b.byId.lidbase.poly).w - bbox(b.byId.base.poly).w, 2 * t2 + 2 * b.ctx.p.clear, 1e-6, 'lid allowance');
});

test('rigid wrap sheets are added only when wrap:true and sit beside the board', () => {
  const t = thicknessFromGsm('greyboard', 1200);
  const plain = buildGeometry('lidbase', { L: 220, W: 120, H: 60, t, wrap: false });
  const wrapped = buildGeometry('lidbase', { L: 220, W: 120, H: 60, t, wrap: true, turnIn: 15 });
  assert.equal((plain.sheets || []).length, 0);
  assert.equal((wrapped.sheets || []).length, 2);
  assert.ok(wrapped.bbox.w > plain.bbox.w + 20, 'wrap extends flat width');
  const boardRight = Math.max(...plain.panels.flatMap((p) => p.poly.map((q) => q[0])));
  for (const s of wrapped.sheets) {
    const left = Math.min(...s.poly.map((q) => q[0]));
    assert.ok(left >= boardRight + 10, `${s.id} overlaps or too close to board (${left} vs ${boardRight})`);
  }
  // wrap size ≈ outer + 2*wall + 2*turn
  const base = wrapped.sheets[0];
  const Lo = (220 + t) + t, Wo = (120 + t) + t, wall = 60 + t;
  near(bbox(base.poly).w, Lo + 2 * wall + 2 * 15, 0.2, 'base wrap length');
  near(bbox(base.poly).h, Wo + 2 * wall + 2 * 15, 0.2, 'base wrap width');
});

test('book + drawer wrap layouts also appear', () => {
  const t = 1.9;
  const book = buildGeometry('book', { L: 220, W: 120, H: 60, t, wrap: true, turnIn: 15 });
  const drawer = buildGeometry('drawer', { L: 200, W: 80, H: 40, t, wrap: true, turnIn: 15 });
  assert.equal((book.sheets || []).length, 2);
  assert.equal((drawer.sheets || []).length, 1);
});

test('tray wrap outline is a simple closed cross', () => {
  const s = trayWrapShape({ Lo: 100, Wo: 60, wall: 40, turn: 15 });
  assert.ok(s.poly.length >= 16);
  assert.equal(s.creases.length, 8);
  const c = coverWrapShape({ w: 200, h: 80, turn: 15, spine: { x: 90, w: 20 } });
  assert.equal(c.poly.length, 8);
  assert.ok(c.creases.length >= 6);
});

test('plain-language summary mentions grams and inner size, not jargon', () => {
  const s = materialSummary(defaultMaterialFor('lidbase'));
  assert.match(s, /1200g灰板/);
  assert.match(s, /157g铜版纸/);
  assert.match(s, /内尺寸/);
  assert.doesNotMatch(s, /caliper|FEFCO|CutContour|bleed/i);
});

test('quote lines include box style, inner size and materials by gram', () => {
  const style = STYLE_MAP.lidbase;
  const mat = defaultMaterialFor('lidbase');
  const { t, faceT } = resolvedThickness(mat);
  const lines = quoteInfoLines({ style, dims: style.defaults, mat, t, faceT, bleed: 3, lamination: 'matte', finishRegions: [{ processes: ['foil-gold', 'uv'] }] });
  const blob = lines.join('\n');
  assert.match(blob, /天地盒/);
  assert.match(blob, /内尺寸/);
  assert.match(blob, /1200g/);
  assert.match(blob, /157g/);
  assert.match(blob, /烫金/);
  assert.match(blob, /局部UV/);
  assert.match(blob, /哑膜/);
});

test('legacy grey2 / eflute project files still map', () => {
  const g = materialFromLegacy('grey2', 2);
  assert.equal(g.structure, 'rigid');
  assert.equal(g.boardGsm, 1200);
  const e = materialFromLegacy('eflute', 1.5);
  assert.equal(e.structure, 'corrugated');
  assert.equal(e.flute, 'E');
  near(resolvedThickness(e).t, 1.5, 1e-9, 'E flute');
});

test('finish region of a logo maps into dieline coordinates', () => {
  const geo = buildGeometry('ste', { L: 30, W: 25, H: 200, t: 0.5 });
  const front = geo.faces.find((f) => f.id === 'front');
  const state = {
    elements: [{ id: 'e1', type: 'image', face: 'front', x: 0, y: 0, w: 10, ratio: 1, rot: 0 }],
    finishRegions: [{ id: 'f1', type: 'el', elementId: 'e1', processes: ['foil-gold'] }],
  };
  const [w, h] = elementSize(state.elements[0]);
  assert.equal(w, 10); assert.equal(h, 10);
  const r = finishRegionsOf(state)[0];
  const poly = regionPoly(geo, r);
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  near((Math.min(...xs) + Math.max(...xs)) / 2, front.cx, 0.05, 'cx');
  near((Math.min(...ys) + Math.max(...ys)) / 2, front.cy, 0.05, 'cy');
  near(Math.max(...xs) - Math.min(...xs), 10, 0.05, 'width');
});

test('caliper tables are monotonic', () => {
  for (const [name, table] of Object.entries(CALIPER_TABLES)) {
    for (let i = 1; i < table.length; i++) {
      assert.ok(table[i][0] > table[i - 1][0] && table[i][1] > table[i - 1][1], `${name} not increasing at ${table[i]}`);
    }
    // interpolator should hit knots exactly
    for (const [g, th] of table) near(interpolateTable(table, g), th, 1e-12, `${name} knot ${g}`);
  }
});

test('PDF includes process spot colours and remains a valid PDF', async () => {
  const { buildPDF } = await import('../src/export/pdf.js');
  const style = STYLE_MAP.lidbase;
  const mat = defaultMaterialFor('lidbase');
  const { t, faceT } = resolvedThickness(mat);
  const geo = buildGeometry('lidbase', { ...style.defaults, t, wrap: true, turnIn: 15, bleed: 3 });
  const lines = quoteInfoLines({ style, dims: style.defaults, mat, t, faceT, bleed: 3, bbox: geo.bbox, bboxBleed: geo.bboxBleed, lamination: 'matte', finishRegions: [{ processes: ['foil-gold', 'uv'] }] });
  const pdf = buildPDF(geo, { info: lines, processLayers: [
    { name: '烫金', pdfSpot: 'Foil_Gold', color: '#c9a227', cmyk: [0, 0.3, 0.9, 0.1], polys: [[[0, 0], [20, 0], [20, 12], [0, 12]]] },
    { name: '局部UV', pdfSpot: 'Spot_UV', color: '#3b7ddd', cmyk: [1, 0.2, 0, 0], polys: [[[2, 2], [18, 2], [18, 10], [2, 10]]] },
  ] });
  const head = Buffer.from(pdf.slice(0, 5)).toString();
  const s = Buffer.from(pdf).toString('latin1');
  assert.equal(head, '%PDF-');
  assert.ok(s.includes('/Separation /Foil_Gold') && s.includes('/Separation /Spot_UV') && s.includes('/Separation /CutContour'));
  assert.ok(s.includes('/Type /OCG /Name (Cut)') && s.includes('/Type /OCG /Name (Foil_Gold)'));
  assert.ok(pdf.length > 20000, 'pdf has outline font paths');
});
