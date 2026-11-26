// 内衬槽位：每个槽单独设置（形状 / 大小 / 位置 / 深度 / 手扣位）、厚度、提示、吸附、排布小工具、导出
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGeometry } from '../src/core/model.js';
import { bbox, area } from '../src/core/geom.js';
import { STYLE_MAP } from '../src/core/styles/index.js';
import { defaultMaterialFor, quoteInfoLines, resolvedThickness } from '../src/core/materials.js';
import { insertSummaryLines } from '../src/core/insert.js';
import {
  normalizeSlot, slotPolygon, slotExtents, validateSlots, snapSlot, addSlot, duplicateSlot, removeSlot,
  centerAll, centerSlot, distribute, setSpacing, quickArray, defaultSlot, describeSlot, MIN_WALL,
} from '../src/core/slots.js';
import { computeFold } from '../src/core/fold.js';
import { buildSVG, buildDXF } from '../src/export/vector.js';
import { buildPDF } from '../src/export/pdf.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a} expected ${b} (tol ${tol})`);
const INS = { L: 200, W: 100 };
const lid = (params, extra = {}) => buildGeometry('lidbase', { L: 220, W: 120, H: 60, t: 1.9, dimMode: 'outer', params, ...extra });

test('slot shapes: 矩形 / 圆角矩形 / 圆形 / 长圆槽 areas', () => {
  const a = (shape, w, h, extra = {}) => Math.abs(area(slotPolygon(normalizeSlot({ shape, w, h, x: 50, y: 50, ...extra }, INS))));
  near(a('rect', 40, 20), 800, 1e-6, 'rect');
  assert.ok(a('roundRect', 40, 20, { r: 6 }) < 800 && a('roundRect', 40, 20, { r: 6 }) > 800 - (4 - Math.PI) * 36 - 5, 'roundRect corners cut');
  near(a('circle', 30, 99), Math.PI * 225, Math.PI * 225 * 0.02, 'circle uses w as the diameter');
  near(a('oblong', 40, 20), 20 * 20 + Math.PI * 100, 8, 'stadium');
});

test('rotation swaps extents; finger notch widens the outline on the chosen side', () => {
  const s = normalizeSlot({ shape: 'rect', w: 40, h: 20, x: 100, y: 50 }, INS);
  const e0 = slotExtents(s), e90 = slotExtents({ ...s, rot: 90 });
  near(e0.w, 40, 1e-6, 'w'); near(e90.w, 20, 1e-6, 'rotated w'); near(e90.h, 40, 1e-6, 'rotated h');
  const nt = slotExtents({ ...s, notch: true, notchSide: 'top', notchR: 8 });
  near(nt.t, 10 + 8, 1e-6, 'notch sticks out 8 mm above the top edge');
  near(nt.b, 10, 1e-6, 'bottom unchanged');
  const nr = slotExtents({ ...s, rot: 90, notch: true, notchSide: 'top', notchR: 8 });
  near(nr.r, 10 + 8, 1e-6, 'a "top" notch follows the slot rotation (→ right after 90°)');
});

test('normalizeSlot keeps every slot valid and independent', () => {
  const s = normalizeSlot({ shape: 'weird', w: -4, h: 'x', rot: 450, depth: 0 }, INS);
  assert.equal(s.shape, 'roundRect');
  assert.ok(s.w >= 3 && s.h >= 3);
  near(s.rot, 90, 1e-9, 'rot wrapped to 90');
  assert.equal(s.depth, null);
  assert.equal(normalizeSlot({ shape: 'circle', w: 20, h: 55 }, INS).h, 20);
});

test('每个槽单独设置：3 个槽形状 / 大小 / 深度 / 位置各不相同，EVA 导出对应', () => {
  const g = lid({
    insertType: 'eva', evaThick: 20,
    insSlots: [
      { shape: 'roundRect', w: 80, h: 40, r: 7, x: 60, y: 35 },
      { shape: 'circle', w: 30, x: 140, y: 30 },
      { shape: 'oblong', w: 70, h: 22, x: 140, y: 80, depth: 10 },
    ],
  });
  const sp = g.insertSpec;
  assert.equal(sp.count, 3);
  assert.deepEqual(sp.slots.map((s) => s.shape), ['roundRect', 'circle', 'oblong']);
  assert.deepEqual(sp.slots.map((s) => s.through), [true, true, false]);
  near(sp.slots[2].depthEff, 10, 1e-9, 'blind depth');
  const sheet = g.sheets.find((s) => s.id === 'insertEva');
  assert.equal(sheet.holes.length, 2, 'only through slots are cut out');
  assert.ok(sheet.creases.length >= 8, 'blind pocket is drawn as a reference outline');
  const ex = g.extras3d.find((e) => e.type === 'insert-eva');
  assert.equal(ex.holes.length, 2);
  assert.deepEqual(ex.slots.map((s) => s.depth), [20, 20, 10]);
  // each slot has its own flat position
  const edit = sp.edit;
  const hb = bbox(sheet.holes[1]);
  near(hb.x + hb.w / 2, edit.ox + 140, 0.05, 'hole 2 centre X');
  near(hb.y + hb.h / 2, edit.oy + 30, 0.05, 'hole 2 centre Y');
  const labels = g.marks.filter((m) => m.type === 'label' && /^\d  /.test(m.text));
  assert.equal(labels.length, 3, 'one dimension label per slot');
});

test('legacy projects (insShape / insCount / insAlign / insCavL) still open the same way', () => {
  const g = lid({ insertType: 'eva', evaThick: 20, insShape: 'circle', insCount: 3, insCavL: 22, insAlign: 'along' });
  const sp = g.insertSpec;
  assert.equal(sp.custom, false);
  assert.equal(sp.count, 3);
  assert.ok(sp.slots.every((s) => s.shape === 'circle' && Math.abs(s.w - 22) < 1e-9));
  const xs = sp.slots.map((s) => s.x), gap = xs[1] - xs[0];
  near(xs[2] - xs[1], gap, 1e-6, 'evenly spread like before');
  near((xs[0] + xs[2]) / 2, sp.insL / 2, 1e-6, 'centred like before');
  near(sp.slots[0].y, sp.insW / 2, 1e-6, 'single row on the centre line');
  // JSON round trip of a saved project keeps every per-slot value
  const g2 = lid(JSON.parse(JSON.stringify({ insertType: 'card', insSlots: [{ shape: 'rect', w: 33, h: 12, rot: 90, x: 50, y: 40, notch: true, notchSide: 'left', notchR: 5 }] })));
  const s0 = g2.insertSpec.slots[0];
  assert.deepEqual([s0.shape, s0.w, s0.h, s0.rot, s0.x, s0.y, s0.notch, s0.notchSide, s0.notchR], ['rect', 33, 12, 90, 50, 40, true, 'left', 5]);
});

test('thickness / height options for every insert type', () => {
  const eva = lid({ insertType: 'eva', evaThick: 25 }).insertSpec;
  assert.equal(eva.evaThick, 25);
  assert.equal(lid({ insertType: 'eva', evaThick: 5 }).insertSpec.evaThick, 5, 'EVA 5 mm chip');
  const bl = lid({ insertType: 'blister', blisterSheet: 0.8, blisterDepth: 22 });
  assert.equal(bl.insertSpec.blisterSheet, 0.8);
  assert.equal(bl.insertSpec.blisterHeight, 22);
  const blE = bl.extras3d.find((e) => e.type === 'insert-blister');
  assert.equal(blE.sheet, 0.8);
  assert.equal(blE.depth, 22);
  assert.equal(lid({ insertType: 'blister' }).insertSpec.blisterSheet, 0.5, 'default sheet 0.5');
  const deep = lid({ insertType: 'blister', blisterDepth: 12, insSlots: [{ shape: 'rect', w: 40, h: 30, x: 100, y: 55, depth: 30 }] });
  assert.equal(deep.insertSpec.blisterHeight, 30, 'overall height grows to the deepest slot');
  const car = lid({ insertType: 'carton', insPaperGsm: 300, insPaperKind: 'board', insPlatH: 18 }).insertSpec;
  assert.equal(car.platH, 18);
  const car350 = lid({ insertType: 'carton', insPaperGsm: 400, insPaperKind: 'board', insPlatH: 18 }).insertSpec;
  assert.ok(car350.tIns > car.tIns, 'heavier paper is thicker');
  const card = lid({ insertType: 'card', insCardLift: 8, insPaperGsm: 350 });
  assert.equal(card.insertSpec.cardLift, 8);
  assert.ok(card.notes.some((n) => n.includes('离盒底 8')), 'lift is stated in the note');
  const flat = lid({ insertType: 'card', insCardLift: 0 });
  const zOf = (g) => computeFold(g, { progress: 1 }).insCard.elements[14];
  assert.ok(Math.abs(zOf(card) - zOf(flat)) > 7, 'raised card sits at a different height inside the box');
});

test('纸盒 / 纸卡 holes follow the individual slots', () => {
  const slots = [{ shape: 'circle', w: 26, x: 50, y: 30 }, { shape: 'rect', w: 40, h: 20, rot: 90, x: 120, y: 50, notch: true, notchSide: 'bottom' }];
  for (const type of ['card', 'carton']) {
    const g = lid({ insertType: type, insSlots: slots });
    const panel = g.byId[type === 'card' ? 'insCard' : 'insTop'];
    assert.equal(panel.holes.length, 2, `${type} holes`);
    const hb = bbox(panel.holes[0]);
    near(hb.x + hb.w / 2, g.insertSpec.edit.ox + 50, 0.05, `${type} hole 1 X`);
    near(hb.w, 26, 0.05, `${type} hole 1 diameter`);
    const hb2 = bbox(panel.holes[1]); near(hb2.h, 40, 0.05, `${type} hole 2 is rotated 90°`); assert.ok(hb2.w > 26, `${type} hole 2 has its finger notch`);
  }
});

test('plain-Chinese warnings: outside, thin wall, overlap, thin bridge', () => {
  const ins = { L: 100, W: 60 };
  const mk = (arr) => arr.map((r) => { const n = normalizeSlot(r, ins); return { ...n, poly: slotPolygon(n) }; });
  const out = validateSlots(mk([{ shape: 'rect', w: 40, h: 20, x: 95, y: 30 }]), ins, 'eva');
  assert.equal(out[0].kind, 'bounds'); assert.match(out[0].text, /超出了内衬的右边/);
  const thin = (type) => validateSlots(mk([{ shape: 'rect', w: 40, h: 20, x: 24, y: 30 }]), ins, type);
  assert.equal(thin('eva').length, 0, '4 mm wall is fine for EVA (min 3)');
  assert.equal(thin('card')[0].kind, 'wall', '4 mm wall is too thin for paper (min 5)');
  assert.match(thin('card')[0].text, /最小壁厚 5 mm/);
  assert.equal(MIN_WALL.eva, 3); assert.equal(MIN_WALL.carton, 5);
  const ov = validateSlots(mk([{ shape: 'rect', w: 30, h: 20, x: 35, y: 30 }, { shape: 'circle', w: 24, x: 50, y: 30 }]), ins, 'eva');
  assert.ok(ov.some((w) => w.kind === 'overlap' && /第 1 个和第 2 个槽重叠/.test(w.text)));
  const gap = validateSlots(mk([{ shape: 'rect', w: 30, h: 20, x: 25, y: 30 }, { shape: 'rect', w: 30, h: 20, x: 58, y: 30 }]), ins, 'card');
  assert.ok(gap.some((w) => w.kind === 'gap' && /之间只剩 3 mm/.test(w.text)));
  const fine = validateSlots(mk([{ shape: 'rect', w: 30, h: 20, x: 25, y: 30 }, { shape: 'rect', w: 30, h: 20, x: 70, y: 30 }]), ins, 'card');
  assert.equal(fine.length, 0);
  // the same warnings appear on the built geometry
  const g = lid({ insertType: 'eva', insSlots: [{ shape: 'rect', w: 400, h: 20, x: 100, y: 55 }] });
  assert.ok(g.insertSpec.warnings.some((w) => w.kind === 'bounds'));
});

test('snapSlot snaps to centre lines, neighbours and edge margin, else the 1 mm grid', () => {
  const slots = [normalizeSlot({ shape: 'rect', w: 40, h: 20, x: 50, y: 30 }, INS), normalizeSlot({ shape: 'rect', w: 30, h: 30, x: 140, y: 60 }, INS)];
  let r = snapSlot(slots, 1, INS.L / 2 + 1.2, 61.3, INS, { tol: 2 });
  near(r.x, 100, 1e-9, 'snaps to centre line'); assert.ok(r.guides.some((g) => g.axis === 'x' && g.pos === 100));
  r = snapSlot(slots, 1, 140, 31.4, INS, { tol: 2 });
  near(r.y, 30, 1e-9, 'aligns centre Y with slot 1'); 
  r = snapSlot(slots, 1, 73.4, 84.2, INS, { tol: 0.1 });
  near(r.x, 73, 1e-9, 'grid x'); near(r.y, 84, 1e-9, 'grid y'); assert.equal(r.guides.length, 0);
  const left = snapSlot(slots, 0, 21.2, 30, INS, { tol: 2, margin: 3 });
  near(left.x - 20, 3, 1e-9, 'left edge keeps the 3 mm margin');
});

test('layout helpers: 居中 / 水平均分 / 垂直均分 / 设置间距 / 快速排列', () => {
  const ins = { L: 200, W: 100 };
  const a = [{ shape: 'rect', w: 20, h: 20, x: 10, y: 20 }, { shape: 'rect', w: 40, h: 20, x: 30, y: 20 }, { shape: 'rect', w: 20, h: 20, x: 60, y: 20 }].map((s) => normalizeSlot(s, ins));
  const c = centerAll(a, ins);
  const ext = (arr) => { let lo = Infinity, hi = -Infinity, t = Infinity, b = -Infinity; for (const s of arr) { const e = slotExtents(s); lo = Math.min(lo, s.x - e.l); hi = Math.max(hi, s.x + e.r); t = Math.min(t, s.y - e.t); b = Math.max(b, s.y + e.b); } return { lo, hi, t, b }; };
  let e = ext(c); near((e.lo + e.hi) / 2, 100, 1e-6, 'centred X'); near((e.t + e.b) / 2, 50, 1e-6, 'centred Y');
  const d = distribute(a, ins, 'x');
  const gaps = []; const sorted = [...d].sort((p, q) => p.x - q.x);
  let prev = 0; for (const s of sorted) { const ee = slotExtents(s); gaps.push(s.x - ee.l - prev); prev = s.x + ee.r; } gaps.push(ins.L - prev);
  assert.ok(gaps.every((v) => Math.abs(v - gaps[0]) < 1e-6), `equal gaps ${gaps.map((v) => v.toFixed(2))}`);
  assert.ok(d.every((s) => s.y === 20), 'distributing X leaves Y alone');
  const dv = distribute([{ ...a[0], y: 5 }, { ...a[0], y: 30 }], ins, 'y');
  near(dv[0].y - 10, (100 - 40) / 3, 1e-6, 'first vertical gap');
  const sp = setSpacing(a, ins, 'x', 6);
  const s2 = [...sp].sort((p, q) => p.x - q.x);
  near((s2[1].x - 20) - (s2[0].x + 10), 6, 1e-6, 'spacing 6 mm between slots 1 and 2');
  e = ext(sp); near((e.lo + e.hi) / 2, 100, 1e-6, 'row is centred');
  const q = quickArray([a[0]], 4, ins, 'along');
  assert.equal(q.length, 4); assert.ok(q.every((s) => s.w === 20 && s.y === 50));
  const tight = quickArray([normalizeSlot({ shape: 'rect', w: 80, h: 20, x: 0, y: 0 }, ins)], 4, ins, 'along');
  assert.ok(tight[0].w < 80, 'template shrinks so the copies fit');
  near(centerSlot(a, 1, 'y', ins)[1].y, 50, 1e-9, 'centre one slot only'); assert.equal(centerSlot(a, 1, 'y', ins)[0].y, 20);
});

test('add / duplicate / delete keep slots independent and inside the insert', () => {
  const ins = { L: 200, W: 100 };
  let s = [normalizeSlot({ shape: 'circle', w: 30, x: 100, y: 50 }, ins)];
  s = duplicateSlot(s, 0, ins);
  assert.equal(s.length, 2); assert.notDeepEqual([s[0].x, s[0].y], [s[1].x, s[1].y]);
  s[1].w = 18; assert.equal(s[0].w, 30, 'changing the copy does not change the original');
  s = addSlot(s, ins);
  assert.equal(s.length, 3);
  const all = s.map((x) => normalizeSlot(x, ins));
  for (const x of all) { const e = slotExtents(x); assert.ok(x.x - e.l >= -1e-6 && x.x + e.r <= ins.L + 1e-6 && x.y - e.t >= -1e-6 && x.y + e.b <= ins.W + 1e-6, 'inside'); }
  s = removeSlot(s, 1); assert.equal(s.length, 2); assert.equal(s[0].w, 30);
  assert.equal(defaultSlot(ins).x, 100);
});

test('title block lists thickness and every slot; SVG / DXF / PDF carry them', () => {
  const g = lid({
    insertType: 'eva', evaThick: 20, insSlots: [
      { shape: 'roundRect', w: 80, h: 40, r: 7, x: 60, y: 35, notch: true, notchSide: 'top' },
      { shape: 'oblong', w: 70, h: 22, rot: 90, x: 140, y: 55, depth: 10 },
    ],
  });
  const lines = insertSummaryLines(g.insertSpec);
  assert.match(lines[0], /内衬：EVA（厚 20 mm/);
  assert.match(lines[1], /槽1 圆角矩形 80×40，圆角R7，通孔，中心距左60 距上35，手扣位/);
  assert.match(lines[2], /槽2 长圆槽 70×22，转90°，深10（不通）/);
  const style = STYLE_MAP.lidbase; const mat = defaultMaterialFor('lidbase'); const { t, faceT } = resolvedThickness(mat);
  const info = quoteInfoLines({ style, dims: style.defaults, mat, t, faceT, bleed: 3, lamination: 'none', finishRegions: [], outer: g.ctx.outer, inner: g.ctx.inner, insertSpec: g.insertSpec });
  assert.ok(info.some((l) => /内衬：EVA（厚 20 mm/.test(l)) && info.some((l) => /槽2 长圆槽/.test(l)));
  const svg = buildSVG(g);
  assert.match(svg, />1  80×40</); assert.match(svg, />2  70×22 深10</);
  const dxf = buildDXF(g); assert.ok(dxf.includes('EVA'), 'dxf mentions the insert sheet');
  const pdf = buildPDF(g, { info });
  assert.equal(Buffer.from(pdf.slice(0, 5)).toString(), '%PDF-');
  const bl = lid({ insertType: 'blister', blisterSheet: 0.5, blisterDepth: 20 });
  assert.match(insertSummaryLines(bl.insertSpec)[0], /片材厚 0\.5 mm，整体高 20 mm/);
  assert.match(insertSummaryLines(lid({ insertType: 'carton', insPaperGsm: 350, insPlatH: 20 }).insertSpec)[0], /折纸盒内托（350g白卡纸，厚约 .* mm，高 20 mm）/);
  assert.match(insertSummaryLines(lid({ insertType: 'card', insPaperGsm: 300 }).insertSpec)[0], /纸卡（300g白卡纸/);
  assert.match(describeSlot(normalizeSlot({ shape: 'rect', w: 10, h: 5, x: 1, y: 2 }, INS), 0, { type: 'card' }), /槽1 矩形 10×5/);
});

test('slots work on every insert-capable box (天地盒 / 抽屉盒 / 书型盒 / 封套盒)', () => {
  const slots = [{ shape: 'roundRect', w: 40, h: 20, x: 60, y: 40 }, { shape: 'circle', w: 20, x: 120, y: 40 }];
  for (const id of ['lidbase', 'drawer', 'book', 'sleeve']) {
    for (const type of ['eva', 'blister', 'carton', 'card']) {
      const dims = id === 'sleeve' ? { L: 200, W: 80, H: 120 } : { L: 220, W: 120, H: 60 };
      const g = buildGeometry(id, { ...dims, t: id === 'sleeve' ? 0.5 : 1.9, dimMode: 'outer', params: { insertType: type, insSlots: slots } });
      assert.equal(g.insertSpec.count, 2, `${id}/${type}`);
      assert.ok(g.insertSpec.edit && Number.isFinite(g.insertSpec.edit.ox), `${id}/${type} has an edit mapping`);
    }
  }
});
