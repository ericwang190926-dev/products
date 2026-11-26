import { Matrix4 } from 'three';
import { rect, flap, clamp } from './geom.js';
import { normalizeSlot, slotPolygon, validateSlots, describeSlot, MIN_WALL, SLOT_SHAPES, NOTCH_SIDES } from './slots.js';
export { SLOT_SHAPES, NOTCH_SIDES, MIN_WALL };
import { to3 } from './fold.js';
import { thicknessFromGsm } from './materials.js';

export const INSERT_STYLES = new Set(['lidbase', 'book', 'drawer', 'sleeve']);

export const INSERT_TYPES = [
  { id: 'none', name: '无内衬', hint: '不加内衬，产品直接放进盒内。' },
  { id: 'eva', name: 'EVA 内衬', hint: '高密度泡棉开槽，缓冲防震，输出裁切平面图。' },
  { id: 'blister', name: '吸塑内衬', hint: '塑料或植绒开模吸塑，输出供模具厂参考的尺寸图。' },
  { id: 'carton', name: '纸盒内衬', hint: '白卡纸或铜版纸折出的中空挖孔内托，输出真实刀版。' },
  { id: 'card', name: '纸卡内衬', hint: '单张白卡纸或铜版纸冲孔固定，输出真实刀版。' },
];

export const SLEEVE_INNER_TYPES = [
  { id: 'rigid', name: '灰板裱纸内盒', hint: '用灰板做内盒骨架，外面裱铜版纸，并一起出内盒裱纸展开图。' },
  { id: 'folding', name: '铜版纸折叠内盒', hint: '单张较厚铜版纸折成内托，轻便省成本，不出单独裱纸。' },
  { id: 'none', name: '只要封套（无内盒）', hint: '只做外面的封套，不画里面的内盒。' },
];

export const EVA_THICKS = [5, 8, 10, 15, 20, 25, 30];
export const BLISTER_SHEETS = [0.3, 0.5, 0.8, 1.0];
export const EVA_COLORS = [
  { id: 'black', name: '黑色', hex: '#23262d' },
  { id: 'white', name: '白色', hex: '#f2f3f5' },
  { id: 'grey', name: '深灰', hex: '#525866' },
];

export const BLISTER_COLORS = [
  { id: 'clear', name: '透明', hex: '#dff0ff', opacity: 0.38, rough: 0.08 },
  { id: 'white', name: '白色', hex: '#f8fafc', opacity: 1, rough: 0.25 },
  { id: 'black', name: '黑色', hex: '#1e2229', opacity: 1, rough: 0.28 },
  { id: 'flock', name: '植绒', hex: '#2c2938', opacity: 1, rough: 0.96 },
];

export const CAVITY_SHAPES = [
  { id: 'roundRect', name: '圆角槽' },
  { id: 'rect', name: '矩形槽' },
  { id: 'circle', name: '圆形孔' },
];

export const INSERT_PAPER_KINDS = [
  { id: 'board', name: '白卡纸' },
  { id: 'coated', name: '铜版纸' },
];

export const INSERT_PAPER_GSM = [250, 300, 350, 400];
export const INNER_GREY_GSM = [800, 1000, 1200, 1400];
export const INNER_WRAP_GSM = [128, 157, 200];

const fmtN = (n) => Number(n).toFixed(1).replace(/\.0$/, '');

/** Compute inner-box dimensions for 封套盒 from sleeve outer size, sleeve t, and clearance. */
export function sleeveInnerSpec(c) {
  const innerBox = c.p?.innerBox || 'rigid';
  if (innerBox === 'none') return { innerBox: 'none' };
  const tS = c.t;
  const cl = c.p?.clear ?? (tS >= 1 || innerBox === 'rigid' ? 1 : 0.5);
  const outerL = c.outer?.L ?? (c.A + tS);
  const outerW = c.outer?.W ?? (c.B + tS);
  const outerH = c.outer?.H ?? c.H;
  const greyGsm = +(c.p?.innerGreyGsm || 1000);
  const wrapGsm = +(c.p?.innerWrapGsm || 157);
  const paperGsm = +(c.p?.innerPaperGsm || 300);
  const tIn = innerBox === 'rigid'
    ? thicknessFromGsm('greyboard', greyGsm)
    : thicknessFromGsm('coated', paperGsm);

  const L_out = Math.max(10, outerL - 2 * tS - 2 * cl);
  const H_out = Math.max(8, outerW - 2 * tS - cl);
  const W_out = Math.max(10, outerH);

  const A = Math.max(6, L_out - tIn);
  const B = Math.max(6, W_out - tIn);
  const D = Math.max(4, H_out - tIn);

  return {
    innerBox,
    cl,
    tIn,
    greyGsm,
    wrapGsm,
    paperGsm,
    outer: { L: L_out, W: W_out, H: H_out },
    A,
    B,
    D,
    interior: {
      L: Math.max(5, A - tIn),
      W: Math.max(5, B - tIn),
      H: Math.max(4, D - tIn),
    },
  };
}

/** Slots as the legacy single-template controls would lay them out (projects saved before per-slot editing). */
function legacySlotsRaw(c, insL, insW) {
  const shapeId = ['roundRect', 'rect', 'circle'].includes(c.p?.insShape) ? c.p.insShape : 'roundRect';
  const count = clamp(Math.round(+(c.p?.insCount ?? 1) || 1), 1, 12);
  const align = c.p?.insAlign === 'along' ? 'along' : 'across';
  const rawL = c.p?.insCavL, rawW = c.p?.insCavW;
  const has = (v) => v != null && v !== '' && !Number.isNaN(+v);
  let cavL, cavW;
  if (shapeId === 'circle') {
    const dMaxMain = align === 'along' ? Math.max(4, (insL - 6 - (count - 1) * 2) / count) : Math.max(4, (insW - 6 - (count - 1) * 2) / count);
    const dMaxCross = align === 'along' ? Math.max(4, insW - 6) : Math.max(4, insL - 6);
    const limit = Math.max(4, Math.min(dMaxMain, dMaxCross));
    const defD = Math.round(clamp(Math.min(insL, insW) * 0.34, 6, limit));
    cavL = cavW = clamp(has(rawL) ? +rawL : defD, 4, limit);
  } else if (align === 'across') {
    const maxL = Math.max(4, insL - 6);
    const maxW = Math.max(4, (insW - 6 - (count - 1) * 2) / count);
    cavL = clamp(has(rawL) ? +rawL : Math.round(clamp(insL * 0.72, 6, maxL)), 4, maxL);
    cavW = clamp(has(rawW) ? +rawW : Math.round(clamp(Math.min(30, maxW * 0.65), 6, maxW)), 4, maxW);
  } else {
    const maxL = Math.max(4, (insL - 6 - (count - 1) * 2) / count);
    const maxW = Math.max(4, insW - 6);
    cavL = clamp(has(rawL) ? +rawL : Math.round(clamp(Math.min(30, maxL * 0.65), 6, maxL)), 4, maxL);
    cavW = clamp(has(rawW) ? +rawW : Math.round(clamp(insW * 0.72, 6, maxW)), 4, maxW);
  }
  const out = [];
  if (align === 'across') {
    const gap = (insW - count * cavW) / (count + 1);
    for (let i = 0; i < count; i++) out.push({ shape: shapeId, w: cavL, h: cavW, x: insL / 2, y: gap + cavW / 2 + i * (cavW + gap) });
  } else {
    const gap = (insL - count * cavL) / (count + 1);
    for (let i = 0; i < count; i++) out.push({ shape: shapeId, w: cavL, h: cavW, x: gap + cavL / 2 + i * (cavL + gap), y: insW / 2 });
  }
  return out;
}

/** Resolve insert outer dimensions + per-slot geometry in the insert's own frame ((0,0) = top-left). */
export function computeInsertSpec(c, boxInterior) {
  const type = c.p?.insertType || 'none';
  if (type === 'none') return null;

  const insL = Math.max(10, +(boxInterior?.L ?? c.inner?.L ?? c.L));
  const insW = Math.max(10, +(boxInterior?.W ?? c.inner?.W ?? c.W));
  const insH = Math.max(6, +(boxInterior?.H ?? c.inner?.H ?? c.H));
  const ins = { L: insL, W: insW };

  const evaThickDef = clamp(Math.round((insH * 0.65) / 5) * 5 || 15, 10, Math.max(10, Math.floor(insH)));
  const evaThick = clamp(+(c.p?.evaThick || evaThickDef), 3, Math.max(3, insH));
  const evaColorObj = EVA_COLORS.find((x) => x.id === c.p?.evaColor) || EVA_COLORS[0];

  const blisterColorObj = BLISTER_COLORS.find((x) => x.id === c.p?.blisterColor) || BLISTER_COLORS[0];
  const blisterSheet = clamp(+(c.p?.blisterSheet || 0.5), 0.1, 3);
  const blisterDef = Math.round(clamp(insH * 0.65, 5, insH));
  const blisterDepth = clamp(+(c.p?.blisterDepth || blisterDef), 4, insH);

  const paperKind = c.p?.insPaperKind === 'coated' ? 'coated' : 'board';
  const paperName = paperKind === 'coated' ? '铜版纸' : '白卡纸';
  const paperGsm = +(c.p?.insPaperGsm || (type === 'carton' ? 300 : 350));
  const tIns = thicknessFromGsm(paperKind, paperGsm);
  const platHDef = Math.round(clamp(insH * 0.6, 8, insH));
  const platH = clamp(+(c.p?.insPlatH || platHDef), Math.max(6, tIns + 4), insH);
  const cardLift = clamp(+(c.p?.insCardLift || 0), 0, Math.max(0, insH - tIns));

  const custom = Array.isArray(c.p?.insSlots);
  const rawSlots = custom ? c.p.insSlots : legacySlotsRaw(c, insL, insW);
  const slots = rawSlots.slice(0, 24).map((r, i) => {
    const n = normalizeSlot(r, ins);
    const poly = slotPolygon(n);
    let depthEff = null, through = false;
    if (type === 'eva') {
      depthEff = n.depth ? Math.min(n.depth, evaThick) : evaThick;
      through = depthEff >= evaThick - 0.01;
    } else if (type === 'blister') {
      depthEff = clamp(n.depth || blisterDepth, 3, insH);
    } else through = true;
    return {
      ...n, i, cx: n.x, cy: n.y, poly,
      localPoly: poly.map(([x, y]) => [x - insL / 2, y - insW / 2]),
      depthEff, through,
    };
  });
  const maxSlotDepth = slots.reduce((a, s) => Math.max(a, s.depthEff || 0), 0);
  const blisterHeight = Math.max(blisterDepth, maxSlotDepth);
  const warnings = validateSlots(slots, ins, type);
  const first = slots[0];

  const shape = first?.shape || 'roundRect';
  return {
    type,
    typeName: INSERT_TYPES.find((x) => x.id === type)?.name || type,
    insL, insW, insH,
    custom,
    shape, shapeName: SLOT_SHAPES.find((x) => x.id === shape)?.name || '', count: slots.length,
    align: c.p?.insAlign === 'along' ? 'along' : 'across',
    cavL: first?.w ?? 0, cavW: first?.h ?? 0, slots, warnings,
    minWall: MIN_WALL[type] ?? 3,
    evaThick, evaColor: evaColorObj.id, evaColorName: evaColorObj.name, evaColorHex: evaColorObj.hex,
    blisterColor: blisterColorObj.id, blisterColorName: blisterColorObj.name,
    blisterColorHex: blisterColorObj.hex, blisterOpacity: blisterColorObj.opacity, blisterRough: blisterColorObj.rough,
    blisterSheet, blisterDepth, blisterHeight,
    paperKind, paperName, paperGsm, tIns, platH, cardLift,
    edit: null,
  };
}

/**
 * Append insert 2D drawing / dieline + 3D preview to a Builder.
 * trayFloor = { panelId, cx, cy, baseT, assemble, openLift, rotated }
 */
export function addInsertToBuilder(b, c, boxInterior, trayFloor) {
  const spec = computeInsertSpec(c, boxInterior);
  if (!spec) return null;

  const { insL, insW, slots } = spec;
  const bb = b.panels.flatMap((p) => p.poly).concat((b.sheets || []).flatMap((s) => s.poly));
  const maxX = bb.length ? Math.max(...bb.map((p) => p[0])) : 0;
  const move = (pts, ox, oy) => pts.map((p) => [p[0] + ox, p[1] + oy]);
  const sizeText = (s) => (s.shape === 'circle' ? `Ø${fmtN(s.w)}` : `${fmtN(s.w)}×${fmtN(s.h)}`);
  const slotLabel = (s, ox, oy, extra = '') => b.mark({ type: 'label', x: ox + s.x, y: oy + s.y, text: `${s.i + 1}  ${sizeText(s)}${extra}` });
  const slotsNote = slots.length ? `共 ${slots.length} 个槽（${slots.map((s) => `${s.i + 1}号 ${sizeText(s)}`).join('、')}）` : '未开槽';
  const through = slots.filter((s) => s.through);
  const blind = slots.filter((s) => !s.through);

  if (spec.type === 'eva' || spec.type === 'blister') {
    const x0 = maxX + 26;
    const y0 = 0;
    spec.edit = { ox: x0, oy: y0 };
    const outerPoly = rect(x0, y0, insL, insW).poly;

    if (spec.type === 'eva') {
      b.wrapSheet({
        id: 'insertEva', kind: 'eva', noBleed: true, poly: outerPoly,
        holes: through.map((s) => move(s.poly, x0, y0)),
        creases: blind.flatMap((s) => { const p = move(s.poly, x0, y0); return p.map((q, i) => [q, p[(i + 1) % p.length]]); }),
        fill: spec.evaColorHex, label: '',
      });
      b.mark({ type: 'label', x: x0 + insL / 2, y: y0 - 7, text: `EVA内衬裁切图（厚 ${fmtN(spec.evaThick)}mm · ${spec.evaColorName}）` });
      for (const s of slots) slotLabel(s, x0, y0, s.through ? '' : ` 深${fmtN(s.depthEff)}`);
      b.note(`EVA 内衬（裁切平面图）：外尺寸 ${fmtN(insL)} × ${fmtN(insW)} mm，厚 ${fmtN(spec.evaThick)} mm（${spec.evaColorName}），${slotsNote}。${blind.length ? '虚线的槽是不通的凹位，只开到标注的深度。' : ''}`);
      b.extra3d({
        type: 'insert-eva', panel: trayFloor.panelId, cx: trayFloor.cx, cy: trayFloor.cy, baseT: trayFloor.baseT,
        rotated: !!trayFloor.rotated, L: insL, W: insW, depth: spec.evaThick, color: spec.evaColorHex,
        holes: through.map((s) => s.localPoly),
        slots: slots.map((s) => ({ poly: s.localPoly, depth: s.depthEff })),
      });
    } else {
      const creases = [];
      if (insL > 12 && insW > 12) {
        const flange = rect(x0 + 3, y0 + 3, insL - 6, insW - 6).poly;
        for (let i = 0; i < flange.length; i++) creases.push([flange[i], flange[(i + 1) % flange.length]]);
      }
      for (const s of slots) {
        const p = move(s.poly, x0, y0);
        for (let i = 0; i < p.length; i++) creases.push([p[i], p[(i + 1) % p.length]]);
      }
      b.wrapSheet({ id: 'insertBlister', kind: 'blister', noBleed: true, poly: outerPoly, holes: [], creases, fill: spec.blisterColorHex, label: '' });
      b.mark({ type: 'label', x: x0 + insL / 2, y: y0 - 7, text: `吸塑内托参考图（${spec.blisterColorName} · 片材厚 ${fmtN(spec.blisterSheet)}mm · 整体高 ${fmtN(spec.blisterHeight)}mm · 需开模）` });
      for (const s of slots) slotLabel(s, x0, y0, ` 深${fmtN(s.depthEff)}`);
      b.note(`吸塑内衬需开吸塑模具成型，此图为外框与凹槽参考尺寸（${spec.blisterColorName}，片材厚 ${fmtN(spec.blisterSheet)} mm，整体高 ${fmtN(spec.blisterHeight)} mm，${slotsNote}），不作直接裁切刀版。`);
      b.extra3d({
        type: 'insert-blister', panel: trayFloor.panelId, cx: trayFloor.cx, cy: trayFloor.cy, baseT: trayFloor.baseT,
        rotated: !!trayFloor.rotated, L: insL, W: insW, depth: spec.blisterHeight, sheet: spec.blisterSheet,
        color: spec.blisterColorHex, opacity: spec.blisterOpacity, rough: spec.blisterRough,
        slots: slots.map((s) => ({ cx: s.cx - insL / 2, cy: s.cy - insW / 2, w: s.w, h: s.h, poly: s.localPoly, depth: s.depthEff })),
      });
    }
    b.dimH(x0, x0 + insL, y0 + insW + 2, y0 + insW + 10, fmtN(insL));
    b.dimV(y0, y0 + insW, x0 - 2, x0 - 10, fmtN(insW));
    return spec;
  }

  // Build assemble matrix relative to the tray floor panel so the insert sits inside the tray
  const trayM = trayFloor.assemble ? trayFloor.assemble.clone() : new Matrix4();
  const rotM = new Matrix4().makeRotationX(Math.PI);
  if (trayFloor.rotated) rotM.multiply(new Matrix4().makeRotationZ(Math.PI / 2));

  if (spec.type === 'card') {
    const x0 = maxX + 26;
    const y0 = 0;
    spec.edit = { ox: x0, oy: y0 };
    const cardR = rect(x0, y0, insL, insW);
    const holes = slots.map((s) => move(s.poly, x0, y0));
    const zInTray = -(trayFloor.baseT / 2 + spec.tIns / 2 + spec.cardLift + 0.2);
    const relM = new Matrix4()
      .makeTranslation(trayFloor.cx, -trayFloor.cy, zInTray)
      .multiply(rotM)
      .multiply(new Matrix4().makeTranslation(-cardR.cx, cardR.cy, 0));
    b.add('insCard', cardR.poly, {
      holes, kind: 'insert', thick: spec.tIns, part: 'insert',
      assemble: trayM.clone().multiply(relM), openLift: trayFloor.openLift || 0,
    });
    b.mark({ type: 'label', x: cardR.cx, y: y0 - 7, text: `内衬刀版（纸卡 · ${spec.paperGsm}g${spec.paperName}）` });
    for (const s of slots) slotLabel(s, x0, y0);
    b.dimH(x0, x0 + insL, y0 + insW + 2, y0 + insW + 10, fmtN(insL));
    b.dimV(y0, y0 + insW, x0 - 2, x0 - 10, fmtN(insW));
    b.note(`纸卡内衬：${spec.paperGsm}g${spec.paperName}（厚约 ${spec.tIns.toFixed(2)} mm），外尺寸 ${fmtN(insL)} × ${fmtN(insW)} mm，${slotsNote}。${spec.cardLift > 0 ? `纸卡抬高离盒底 ${fmtN(spec.cardLift)} mm（悬空部分需另加垫条或折脚，此处只示意高度）。` : ''}`);
    return spec;
  }

  // spec.type === 'carton': real folding riser tray with cutout holes on the top deck
  const tI = spec.tIns;
  const Ai = Math.max(6, insL - tI);
  const Bi = Math.max(6, insW - tI);
  const Di = Math.max(5, spec.platH - tI);
  const foot = Math.min(12, Bi * 0.22, Di * 0.85);
  const f = Math.min(10, Bi * 0.3, Di * 0.8, Ai * 0.28);
  const dx = maxX + 26 + Math.max(Di, f);
  const dy = Di + foot;
  const deck = rect(dx, dy, Ai, Bi);
  const ox = dx - (insL - Ai) / 2, oy = dy - (insW - Bi) / 2;
  spec.edit = { ox, oy };
  const holes = slots.map((s) => move(s.poly, ox, oy));

  const zTop = -(trayFloor.baseT / 2 + Di + tI / 2);
  const relM = new Matrix4()
    .makeTranslation(trayFloor.cx, -trayFloor.cy, zTop)
    .multiply(rotM)
    .multiply(new Matrix4().makeTranslation(-deck.cx, deck.cy, 0));

  b.add('insTop', deck.poly, {
    holes, kind: 'insert', thick: tI, part: 'insert',
    assemble: trayM.clone().multiply(relM), openLift: trayFloor.openLift || 0,
  });

  const wf = flap(deck.bottom, Di);
  b.add('insF', wf.poly, { parent: 'insTop', hinge: wf.hinge, kind: 'wall', thick: tI, part: 'insert' });
  const wb = flap(deck.top, Di);
  b.add('insBk', wb.poly, { parent: 'insTop', hinge: wb.hinge, kind: 'wall', thick: tI, part: 'insert' });
  const wl = flap(deck.left, Di);
  b.add('insL', wl.poly, { parent: 'insTop', hinge: wl.hinge, kind: 'wall', thick: tI, part: 'insert' });
  const wr = flap(deck.right, Di);
  b.add('insR', wr.poly, { parent: 'insTop', hinge: wr.hinge, kind: 'wall', thick: tI, part: 'insert' });

  if (foot >= 3) {
    const ff = flap(wf.far, foot, { o1: 1, o2: 1 });
    b.add('insFFoot', ff.poly, { parent: 'insF', hinge: ff.hinge, kind: 'flap', thick: tI, part: 'insert' });
    const fb = flap(wb.far, foot, { o1: 1, o2: 1 });
    b.add('insBkFoot', fb.poly, { parent: 'insBk', hinge: fb.hinge, kind: 'flap', thick: tI, part: 'insert' });
  }
  if (f >= 3) {
    for (const [w, id] of [[wf, 'insF'], [wb, 'insBk']]) {
      for (const [k, se] of [['1', w.s1], ['2', w.s2]]) {
        const ch = Math.min(f * 0.3, Di * 0.3);
        const o = k === '1' ? { o1: ch, o2: 1 } : { o1: 1, o2: ch };
        const cf = flap(se, f, o);
        b.add(`${id}C${k}`, cf.poly, { parent: id, hinge: cf.hinge, kind: 'corner', layer: 1, thick: tI, part: 'insert' });
      }
    }
  }

  b.mark({ type: 'label', x: deck.cx, y: dy - Di - foot - 7, text: `内衬刀版（折纸盒 · ${spec.paperGsm}g${spec.paperName} · 高${fmtN(spec.platH)}mm）` });
  for (const s of slots) slotLabel(s, ox, oy);
  b.dimH(dx, dx + Ai, dy + Bi + Di + foot + 2, dy + Bi + Di + foot + 10, fmtN(insL));
  b.dimV(dy, dy + Bi, dx - Di - 2, dx - Di - 10, fmtN(insW));
  b.note(`纸盒内衬：${spec.paperGsm}g${spec.paperName}（厚约 ${tI.toFixed(2)} mm），外尺寸 ${fmtN(insL)} × ${fmtN(insW)} mm，托高 ${fmtN(spec.platH)} mm，${slotsNote}。`);
  return spec;
}

/** Plain-Chinese title-block lines: one headline (thickness etc.) + one line per slot. */
export function insertSummaryLines(spec) {
  if (!spec) return [];
  const size = `${fmtN(spec.insL)} × ${fmtN(spec.insW)} mm`;
  const n = spec.slots.length;
  let head = null;
  if (spec.type === 'eva') head = `内衬：EVA（厚 ${fmtN(spec.evaThick)} mm，${spec.evaColorName}），外尺寸 ${size}，共 ${n} 个槽`;
  else if (spec.type === 'blister') head = `内衬：吸塑（${spec.blisterColorName}，片材厚 ${fmtN(spec.blisterSheet)} mm，整体高 ${fmtN(spec.blisterHeight)} mm，需开模参考），外尺寸 ${size}，共 ${n} 个槽`;
  else if (spec.type === 'carton') head = `内衬：折纸盒内托（${spec.paperGsm}g${spec.paperName}，厚约 ${spec.tIns.toFixed(2)} mm，高 ${fmtN(spec.platH)} mm），外尺寸 ${size}，共 ${n} 个槽`;
  else if (spec.type === 'card') head = `内衬：纸卡（${spec.paperGsm}g${spec.paperName}，厚约 ${spec.tIns.toFixed(2)} mm${spec.cardLift > 0 ? `，离盒底 ${fmtN(spec.cardLift)} mm` : ''}），外尺寸 ${size}，共 ${n} 个槽`;
  if (!head) return [];
  const opts = { type: spec.type, thick: spec.evaThick, defaultDepth: spec.blisterDepth };
  const lines = [head];
  spec.slots.slice(0, 10).forEach((s, i) => lines.push('　' + describeSlot(s, i, opts)));
  if (n > 10) lines.push(`　…其余 ${n - 10} 个槽见刀版上的标注`);
  return lines;
}
export function insertSummaryLine(spec) { return insertSummaryLines(spec)[0] || null; }

export function sleeveInnerSummaryLine(si) {
  if (!si || si.innerBox === 'none') return '内盒：无（仅封套）';
  const sz = `${fmtN(si.outer.L)} × ${fmtN(si.outer.W)} × ${fmtN(si.outer.H)} mm`;
  if (si.innerBox === 'rigid') return `内盒：灰板裱纸内盒（${si.greyGsm}g灰板 + ${si.wrapGsm}g铜版纸裱面，约${si.tIn.toFixed(2)}mm，外尺寸 ${sz}，已配内盒裱纸）`;
  return `内盒：铜版纸折叠内盒（${si.paperGsm}g铜版纸，约${si.tIn.toFixed(2)}mm，外尺寸 ${sz}）`;
}
