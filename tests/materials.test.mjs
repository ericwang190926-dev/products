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

import { resolveBoxDims, innerFromOuter, outerFromInner } from '../src/core/dims.js';
import { computeFold, foldedBBox } from '../src/core/fold.js';

test('outer dims of a carton shrink inner by 2t on each axis', () => {
  const r = resolveBoxDims('ste', { L: 40, W: 26, H: 201, t: 0.5, dimMode: 'outer' });
  near(r.inner.L, 39, 1e-9, 'inner L');
  near(r.inner.W, 25, 1e-9, 'inner W');
  near(r.inner.H, 200, 1e-9, 'inner H');
  near(r.A, 39.5, 1e-9, 'mid A');
  const geo = buildGeometry('ste', { L: 40, W: 26, H: 201, t: 0.5, dimMode: 'outer' });
  near(bbox(geo.byId.front.poly).w, 39.5, 1e-6, 'front panel = outer L - t');
  near(geo.ctx.outer.L, 40, 1e-9, 'ctx keeps outer L');
});

test('inner-mode carton still grows panels as inner + t (legacy)', () => {
  const geo = buildGeometry('ste', { L: 30, W: 25, H: 200, t: 0.5 });
  near(bbox(geo.byId.front.poly).w, 30.5, 1e-6, 'legacy inner');
});

test('outer and inner conversions are inverse for a tuck box', () => {
  const t = 0.5, L = 30, W = 25, H = 200;
  const o = outerFromInner('ste', { L, W, H, t });
  const i = innerFromOuter('ste', { ...o, t });
  near(i.L, L, 1e-9, 'roundtrip L'); near(i.W, W, 1e-9, 'roundtrip W'); near(i.H, H, 1e-9, 'roundtrip H');
});

test('天地盒 外尺寸 is the lid outside; thicker board reduces inner space', () => {
  const t1 = 1.55, t2 = 2.2, cl = 1;
  const a = resolveBoxDims('lidbase', { L: 220, W: 120, H: 60, t: t1, dimMode: 'outer', params: { clear: cl, lidType: 'half' } });
  const b = resolveBoxDims('lidbase', { L: 220, W: 120, H: 60, t: t2, dimMode: 'outer', params: { clear: cl, lidType: 'half' } });
  assert.ok(b.inner.L < a.inner.L, 'thicker board → smaller inner');
  near(a.outer.L, 220, 1e-9, 'outer L stays');
  // lid mid-plane = outer - t, base mid = lid mid - 2t - 2c
  near(a.A + 2 * t1 + 2 * cl, 220 - t1, 1e-6, 'lid mid from outer');
});

test('天地盒 全盖 lid reaches full height and base is shorter and narrower', () => {
  const g = buildGeometry('lidbase', { L: 200, W: 100, H: 50, t: 2, params: { lidType: 'full', clear: 1 } });
  const base = bbox(g.byId.base.poly), lid = bbox(g.byId.lidbase.poly);
  const cl = g.ctx.p.clear;
  assert.ok(lid.w > base.w, 'lid wider than base');
  near(lid.w - base.w, 2 * 2 + 2 * cl, 1e-6, 'lid allowance 2t+2c');
  const lidWall = bbox(g.byId.lidfront.poly);
  const baseWall = bbox(g.byId.front.poly);
  assert.ok(lidWall.h > baseWall.h + 1, `full lid wall ${lidWall.h} taller than base ${baseWall.h}`);
  near(lidWall.h, g.ctx.lidD, 1e-6, 'lid wall = full lidD');
  const env = foldedBBox(g, computeFold(g, { progress: 1 }));
  const got = [env.size.x, env.size.y, env.size.z].sort((a, b) => a - b);
  const want = [g.ctx.lidA, g.ctx.lidB, g.ctx.lidD].sort((a, b) => a - b);
  for (let i = 0; i < 3; i++) near(got[i], want[i], 0.2, `full-lid envelope ${i}`);
});

test('天地盒 半盖 default lid height is about one third', () => {
  const g = buildGeometry('lidbase', { L: 220, W: 120, H: 60, t: 1.9 });
  assert.notEqual(g.ctx.p.lidType, 'full');
  const wall = bbox(g.byId.lidfront.poly);
  near(wall.h, g.ctx.p.lidH, 1e-6, 'lidH applied');
  assert.ok(g.ctx.p.lidH >= 15 && g.ctx.p.lidH <= g.ctx.D, 'lidH in range');
  assert.ok(Math.abs(g.ctx.p.lidH - (60 + 2 * 1.9) / 3) < 8 || Math.abs(g.ctx.p.lidH - 60 / 3) < 8, `lidH ${g.ctx.p.lidH} near 1/3`);
});

function checkBookOpening(openDir) {
  const g = buildGeometry('book', { L: 220, W: 120, H: 60, t: 1.9, wrap: true, params: { openDir } });
  assert.equal(g.ctx.p.openDir, openDir, `openDir ${openDir}`);
  assert.ok(g.byId.flap && g.byId.flapHinge, 'flap + hinge panels');
  const flap = bbox(g.byId.flap.poly);
  const lid = bbox(g.byId.lid.poly);
  const cover = bbox(g.byId.cover.poly);
  const ov = g.ctx.p.overhang, t = 1.9;
  const wantLc = g.ctx.A + t + 2 * ov, wantWc = g.ctx.B + t + 2 * ov;
  const span = openDir === 'short' ? wantWc : wantLc;
  const leaf = openDir === 'short' ? wantLc : wantWc;
  near(flap.w, g.ctx.p.flapH, 0.05, 'flap height');
  near(flap.h, span, 0.05, `flap spans the ${openDir} opening edge`);
  near(lid.w, leaf, 0.05, 'lid depth');
  near(lid.h, span, 0.05, 'lid along opening');
  near(cover.w, leaf, 0.05, 'cover depth');
  near(cover.h, span, 0.05, 'cover along spine');
  const mags = g.marks.filter((m) => m.type === 'magnet');
  assert.equal(mags.length, 4, `got ${mags.length} magnets`);
  for (const m of mags) near(m.r, 6, 1e-6, 'default Ø12 → r=6');
  const onFlap = mags.filter((m) => m.panel === 'flap');
  const onTray = mags.filter((m) => m.panel === 'tright');
  assert.equal(onFlap.length, 2);
  assert.equal(onTray.length, 2);
  const inset = g.ctx.p.magnetInset;
  const ys = onFlap.map((m) => m.y).sort((a, b) => a - b);
  near(ys[0], inset, 0.2, 'left inset');
  near(ys[1], flap.h - inset, 0.2, 'right inset');
  const tys = onTray.map((m) => m.y).sort((a, b) => a - b);
  near(tys[0], ys[0], 0.2, 'tray matches flap y0');
  near(tys[1], ys[1], 0.2, 'tray matches flap y1');
  const wrap = g.sheets.find((s) => s.label === '裱纸（封面）');
  assert.ok(wrap, 'wrap includes cover');
  const wb = bbox(wrap.poly);
  assert.ok(wb.h > span, 'cover wrap follows the opening-edge length');
  assert.ok(g.notes.some((n) => n.includes(openDir === 'short' ? '短边打开' : '长边打开')), 'note names the opening');
  return g;
}

test('书型盒 defaults to 长边打开', () => {
  const g = buildGeometry('book', { L: 220, W: 120, H: 60, t: 1.9 });
  assert.equal(g.ctx.p.openDir, 'long');
  const lid = bbox(g.byId.lid.poly);
  assert.ok(lid.h > lid.w, 'lid is taller along the long opening edge');
});

test('书型盒 长边打开: flap and magnets sit on the long edge', () => {
  checkBookOpening('long');
});

test('书型盒 短边打开: flap and magnets sit on the short edge', () => {
  checkBookOpening('short');
});

test('书型盒 magnet diameter and inset are adjustable', () => {
  const g = buildGeometry('book', { L: 220, W: 120, H: 60, t: 1.9, params: { magnetD: 10, magnetInset: 20 } });
  const mags = g.marks.filter((m) => m.type === 'magnet');
  assert.ok(mags.every((m) => Math.abs(m.r - 5) < 1e-9), 'Ø10');
  const ys = mags.filter((m) => m.panel === 'flap').map((m) => m.y).sort((a, b) => a - b);
  near(ys[0], 20, 0.2, 'inset 20');
});

test('quote lines list 外尺寸 and 内尺寸, 盖型, and 触感膜', () => {
  const style = STYLE_MAP.lidbase;
  const mat = defaultMaterialFor('lidbase');
  const { t, faceT } = resolvedThickness(mat);
  const sizes = resolveBoxDims(style, { ...style.defaults, t, dimMode: 'outer', params: { lidType: 'full' } });
  const lines = quoteInfoLines({
    style, dims: style.defaults, mat, t, faceT, bleed: 3,
    lamination: 'softtouch', finishRegions: [],
    outer: sizes.outer, inner: sizes.inner, lidType: 'full',
  });
  const blob = lines.join('\n');
  assert.match(blob, /外尺寸/);
  assert.match(blob, /内尺寸/);
  assert.match(blob, /盖型：全盖/);
  assert.match(blob, /触感膜/);
});

test('quote lines list 开盒方向 for 书型盒', () => {
  const style = STYLE_MAP.book;
  const mat = defaultMaterialFor('book');
  const { t, faceT } = resolvedThickness(mat);
  const sizes = resolveBoxDims(style, { ...style.defaults, t, dimMode: 'outer' });
  const longLines = quoteInfoLines({
    style, dims: style.defaults, mat, t, faceT, bleed: 3,
    lamination: 'matte', finishRegions: [],
    outer: sizes.outer, inner: sizes.inner, openDir: 'long',
  });
  assert.match(longLines.join('\n'), /开盒方向：长边打开/);
  const shortLines = quoteInfoLines({
    style, dims: style.defaults, mat, t, faceT, bleed: 3,
    lamination: 'matte', finishRegions: [],
    outer: sizes.outer, inner: sizes.inner, openDir: 'short',
  });
  assert.match(shortLines.join('\n'), /开盒方向：短边打开/);
});

test('书型盒 PDF has a 磁铁位置 layer', async () => {
  const { buildPDF } = await import('../src/export/pdf.js');
  const { buildSVG } = await import('../src/export/vector.js');
  const style = STYLE_MAP.book;
  const geo = buildGeometry('book', { ...style.defaults, t: 1.9, wrap: true, bleed: 3 });
  const pdf = buildPDF(geo, { info: ['书型盒'] });
  const s = Buffer.from(pdf).toString('latin1');
  assert.ok(s.includes('/OC /ocMagnet') || s.includes('ocMagnet'), 'pdf magnet OCG');
  const svg = buildSVG(geo);
  assert.match(svg, /磁铁位置/);
});

import { buildSVG, buildDXF } from '../src/export/vector.js';
import { buildPDF } from '../src/export/pdf.js';

test('封套盒 defaults to 灰板裱纸内盒 with wrap sheet and clearance', () => {
  const g = buildGeometry('sleeve', { L: 200, W: 80, H: 120, t: 0.5, dimMode: 'outer', params: { clear: 1 } });
  assert.equal(g.sleeveInner.innerBox, 'rigid');
  assert.ok(g.byId.tbase && g.byId.front, 'has both outer sleeve and inner tray');
  const wrap = g.sheets.find((s) => s.id === 'wrapTray');
  assert.ok(wrap && wrap.label === '裱纸（内盒）', 'rigid inner box emits wrap sheet');
  near(g.sleeveInner.outer.L, 200 - 2 * 0.5 - 2 * 1, 1e-6, 'inner L = outer L - 2t - 2*clear');
  near(g.sleeveInner.outer.H, 80 - 2 * 0.5 - 1, 1e-6, 'inner H = outer W - 2t - clear');
  near(g.sleeveInner.outer.W, 120, 1e-6, 'inner W = outer H');
  const gTight = buildGeometry('sleeve', { L: 200, W: 80, H: 120, t: 0.5, dimMode: 'outer', params: { clear: 2 } });
  near(g.sleeveInner.outer.L - gTight.sleeveInner.outer.L, 2, 1e-6, 'larger clear shrinks inner box by 2*delta');
});

test('封套盒 supports 铜版纸折叠内盒 and 无内盒, and 腰封 stays plain band', () => {
  const gf = buildGeometry('sleeve', { L: 200, W: 80, H: 120, t: 0.5, dimMode: 'outer', params: { innerBox: 'folding', innerPaperGsm: 350 } });
  assert.equal(gf.sleeveInner.innerBox, 'folding');
  assert.ok(gf.byId.tbase, 'folding inner tray built');
  assert.ok(!gf.sheets.some((s) => s.id === 'wrapTray'), 'folding inner box does not emit wrapTray');
  near(gf.sleeveInner.tIn, thicknessFromGsm('coated', 350), 1e-6, '350g coated paper thickness');

  const gn = buildGeometry('sleeve', { L: 200, W: 80, H: 120, t: 0.5, dimMode: 'outer', params: { innerBox: 'none' } });
  assert.equal(gn.sleeveInner.innerBox, 'none');
  assert.ok(!gn.byId.tbase, 'no inner tray when innerBox=none');

  const gb = buildGeometry('band', { L: 200, W: 80, H: 50, t: 0.5, dimMode: 'outer' });
  assert.ok(!gb.byId.tbase && !gb.sleeveInner, '腰封 stays a plain band');
});

test('内衬 EVA / 吸塑 / 纸盒 / 纸卡 auto-fit 天地盒, 抽屉盒, 书型盒, 封套盒', () => {
  // 1. EVA on 天地盒
  const gEva = buildGeometry('lidbase', {
    L: 220, W: 120, H: 60, t: 1.9, dimMode: 'outer',
    params: { insertType: 'eva', evaThick: 20, evaColor: 'black', insShape: 'roundRect', insCount: 2, insCavL: 170, insCavW: 28 },
  });
  assert.equal(gEva.insertSpec.type, 'eva');
  near(gEva.insertSpec.insL, gEva.ctx.inner.L, 1e-6, 'EVA fits inner L');
  near(gEva.insertSpec.insW, gEva.ctx.inner.W, 1e-6, 'EVA fits inner W');
  const evaSh = gEva.sheets.find((s) => s.id === 'insertEva');
  assert.ok(evaSh && evaSh.noBleed && evaSh.holes.length === 2, 'EVA sheet has 2 cavity holes and noBleed');
  assert.ok(gEva.extras3d.some((e) => e.type === 'insert-eva' && e.holes.length === 2), '3D EVA extra');

  // 2. Blister on 抽屉盒
  const gBl = buildGeometry('drawer', {
    L: 200, W: 80, H: 40, t: 1.9, dimMode: 'outer',
    params: { insertType: 'blister', blisterColor: 'flock', blisterDepth: 18, insCount: 1 },
  });
  assert.equal(gBl.insertSpec.type, 'blister');
  assert.ok(gBl.sheets.some((s) => s.id === 'insertBlister' && s.creases.length > 4), 'blister reference plan');
  assert.ok(gBl.notes.some((n) => n.includes('模具') && n.includes('参考')), 'plain-Chinese mold-tooling note');
  assert.ok(gBl.extras3d.some((e) => e.type === 'insert-blister' && e.color === '#2c2938'), '3D blister flock extra');

  // 3. Carton folding insert on 书型盒 (long open rotates 90 deg)
  const gCar = buildGeometry('book', {
    L: 220, W: 120, H: 60, t: 1.9, dimMode: 'outer',
    params: { insertType: 'carton', insPaperKind: 'board', insPaperGsm: 350, insPlatH: 24, insShape: 'circle', insCount: 3, insCavL: 22 },
  });
  assert.ok(gCar.byId.insTop && gCar.byId.insF && gCar.byId.insL && gCar.byId.insFFoot, 'carton insert has real folding panels');
  assert.equal(gCar.byId.insTop.holes.length, 3, '3 circular holes');
  assert.ok(gCar.cut.length > 0 && gCar.crease.length > 0);
  const mats = computeFold(gCar, { progress: 1 });
  const topPts = gCar.byId.insTop.poly.map((q) => {
    const v = new (mats.insTop.constructor)().copy(mats.insTop);
    return [q[0], q[1], v.elements[12]];
  });
  assert.ok(Number.isFinite(topPts[0][2]), 'carton insert folds cleanly');

  // 4. Card insert on 封套盒 with inner box
  const gCard = buildGeometry('sleeve', {
    L: 200, W: 80, H: 120, t: 0.5, dimMode: 'outer',
    params: { innerBox: 'rigid', insertType: 'card', insPaperKind: 'coated', insPaperGsm: 350, insCount: 2 },
  });
  assert.ok(gCard.byId.insCard && gCard.byId.insCard.holes.length === 2, 'card insert dieline has 2 holes');
  near(gCard.insertSpec.insL, gCard.sleeveInner.interior.L, 1e-6, 'card fits sleeve inner box L');

  // 5. Quote lines + PDF / SVG / DXF include sleeve inner & insert details
  const style = STYLE_MAP.sleeve;
  const mat = defaultMaterialFor('sleeve');
  const lines = quoteInfoLines({
    style, dims: style.defaults, mat, t: 0.5, faceT: 0, bleed: 3,
    bbox: gCard.bbox, bboxBleed: gCard.bboxBleed,
    lamination: 'none', finishRegions: [],
    outer: gCard.ctx.outer, inner: gCard.ctx.inner,
    sleeveInner: gCard.sleeveInner, insertSpec: gCard.insertSpec,
  });
  const txt = lines.join('\n');
  assert.match(txt, /灰板裱纸内盒/);
  assert.match(txt, /内衬：纸卡/);
  const pdf = buildPDF(gCard, { info: lines });
  assert.equal(Buffer.from(pdf.slice(0, 5)).toString(), '%PDF-');
  const svg = buildSVG(gCard);
  assert.match(svg, /封套刀版/);
  assert.match(svg, /内盒刀版/);
  assert.match(svg, /内衬刀版/);
  const dxf = buildDXF(gCard);
  assert.match(dxf, /封套刀版/);
});
