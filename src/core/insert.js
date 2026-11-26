import { Matrix4 } from 'three';
import { rect, flap, roundRect, circlePoly, clamp } from './geom.js';
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

export const EVA_THICKS = [10, 15, 20, 25, 30];
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

function dedupPoly(pts) {
  const out = [];
  for (const p of pts) {
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 1e-4) out.push(p);
  }
  if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 1e-4) out.pop();
  return out;
}

function makeSlotPoly(shape, cx, cy, w, h) {
  if (shape === 'circle') return dedupPoly(circlePoly(cx, cy, Math.min(w, h) / 2, 28));
  if (shape === 'roundRect' && Math.min(w, h) > 3) {
    const r = Math.max(0.5, Math.min(w, h) * 0.24);
    return dedupPoly(roundRect(cx - w / 2, cy - h / 2, w, h, r, 6));
  }
  return rect(cx - w / 2, cy - h / 2, w, h).poly;
}

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

/** Resolve insert outer dimensions + cavity geometry in local (0..insL) x (0..insW). */
export function computeInsertSpec(c, boxInterior) {
  const type = c.p?.insertType || 'none';
  if (type === 'none') return null;

  const insL = Math.max(10, +(boxInterior?.L ?? c.inner?.L ?? c.L));
  const insW = Math.max(10, +(boxInterior?.W ?? c.inner?.W ?? c.W));
  const insH = Math.max(6, +(boxInterior?.H ?? c.inner?.H ?? c.H));

  const shape = CAVITY_SHAPES.some((s) => s.id === c.p?.insShape) ? c.p.insShape : 'roundRect';
  const shapeName = CAVITY_SHAPES.find((s) => s.id === shape)?.name || '圆角槽';
  const count = clamp(Math.round(+(c.p?.insCount ?? 1) || 1), 1, 12);
  const align = c.p?.insAlign === 'along' ? 'along' : 'across';

  let cavL, cavW;
  const rawL = c.p?.insCavL;
  const rawW = c.p?.insCavW;
  if (shape === 'circle') {
    const dMaxMain = align === 'along'
      ? Math.max(4, (insL - 6 - (count - 1) * 2) / count)
      : Math.max(4, (insW - 6 - (count - 1) * 2) / count);
    const dMaxCross = align === 'along' ? Math.max(4, insW - 6) : Math.max(4, insL - 6);
    const limit = Math.max(4, Math.min(dMaxMain, dMaxCross));
    const defD = Math.round(clamp(Math.min(insL, insW) * 0.34, 6, limit));
    const d = clamp(rawL != null && rawL !== '' && !Number.isNaN(+rawL) ? +rawL : defD, 4, limit);
    cavL = d;
    cavW = d;
  } else if (align === 'across') {
    const maxL = Math.max(4, insL - 6);
    const maxW = Math.max(4, (insW - 6 - (count - 1) * 2) / count);
    const defL = Math.round(clamp(insL * 0.72, 6, maxL));
    const defW = Math.round(clamp(Math.min(30, maxW * 0.65), 6, maxW));
    cavL = clamp(rawL != null && rawL !== '' && !Number.isNaN(+rawL) ? +rawL : defL, 4, maxL);
    cavW = clamp(rawW != null && rawW !== '' && !Number.isNaN(+rawW) ? +rawW : defW, 4, maxW);
  } else {
    const maxL = Math.max(4, (insL - 6 - (count - 1) * 2) / count);
    const maxW = Math.max(4, insW - 6);
    const defL = Math.round(clamp(Math.min(30, maxL * 0.65), 6, maxL));
    const defW = Math.round(clamp(insW * 0.72, 6, maxW));
    cavL = clamp(rawL != null && rawL !== '' && !Number.isNaN(+rawL) ? +rawL : defL, 4, maxL);
    cavW = clamp(rawW != null && rawW !== '' && !Number.isNaN(+rawW) ? +rawW : defW, 4, maxW);
  }

  const slots = [];
  if (align === 'across') {
    const gap = (insW - count * cavW) / (count + 1);
    for (let i = 0; i < count; i++) {
      const cx = insL / 2;
      const cy = gap + cavW / 2 + i * (cavW + gap);
      slots.push({
        cx, cy, w: cavL, h: cavW,
        poly: makeSlotPoly(shape, cx, cy, cavL, cavW),
        localPoly: makeSlotPoly(shape, cx - insL / 2, cy - insW / 2, cavL, cavW),
      });
    }
  } else {
    const gap = (insL - count * cavL) / (count + 1);
    for (let i = 0; i < count; i++) {
      const cx = gap + cavL / 2 + i * (cavL + gap);
      const cy = insW / 2;
      slots.push({
        cx, cy, w: cavL, h: cavW,
        poly: makeSlotPoly(shape, cx, cy, cavL, cavW),
        localPoly: makeSlotPoly(shape, cx - insL / 2, cy - insW / 2, cavL, cavW),
      });
    }
  }

  const evaThickDef = clamp(Math.round((insH * 0.65) / 5) * 5 || 15, 10, Math.max(10, Math.floor(insH)));
  const evaThick = clamp(+(c.p?.evaThick || evaThickDef), 3, Math.max(3, insH));
  const evaColorObj = EVA_COLORS.find((x) => x.id === c.p?.evaColor) || EVA_COLORS[0];

  const blisterColorObj = BLISTER_COLORS.find((x) => x.id === c.p?.blisterColor) || BLISTER_COLORS[0];
  const blisterDef = Math.round(clamp(insH * 0.65, 5, insH));
  const blisterDepth = clamp(+(c.p?.blisterDepth || blisterDef), 4, insH);

  const paperKind = c.p?.insPaperKind === 'coated' ? 'coated' : 'board';
  const paperName = paperKind === 'coated' ? '铜版纸' : '白卡纸';
  const paperGsm = +(c.p?.insPaperGsm || (type === 'carton' ? 300 : 350));
  const tIns = thicknessFromGsm(paperKind, paperGsm);
  const platHDef = Math.round(clamp(insH * 0.6, 8, insH));
  const platH = clamp(+(c.p?.insPlatH || platHDef), Math.max(6, tIns + 4), insH);

  return {
    type,
    typeName: INSERT_TYPES.find((x) => x.id === type)?.name || type,
    insL, insW, insH,
    shape, shapeName, count, align, cavL, cavW, slots,
    evaThick, evaColor: evaColorObj.id, evaColorName: evaColorObj.name, evaColorHex: evaColorObj.hex,
    blisterColor: blisterColorObj.id, blisterColorName: blisterColorObj.name,
    blisterColorHex: blisterColorObj.hex, blisterOpacity: blisterColorObj.opacity, blisterRough: blisterColorObj.rough,
    blisterDepth,
    paperKind, paperName, paperGsm, tIns, platH,
  };
}

/**
 * Append insert 2D drawing / dieline + 3D preview to a Builder.
 * trayFloor = { panelId, cx, cy, baseT, assemble, openLift, rotated }
 */
export function addInsertToBuilder(b, c, boxInterior, trayFloor) {
  const spec = computeInsertSpec(c, boxInterior);
  if (!spec) return null;

  const { insL, insW, slots, shape, cavL, cavW, count } = spec;
  const bb = b.panels.flatMap((p) => p.poly).concat((b.sheets || []).flatMap((s) => s.poly));
  const maxX = bb.length ? Math.max(...bb.map((p) => p[0])) : 0;
  const move = (pts, ox, oy) => pts.map((p) => [p[0] + ox, p[1] + oy]);
  const slotText = shape === 'circle' ? `Ø${fmtN(cavL)}` : `${fmtN(cavL)}×${fmtN(cavW)}`;

  if (spec.type === 'eva' || spec.type === 'blister') {
    const x0 = maxX + 26;
    const y0 = 0;
    const outerPoly = rect(x0, y0, insL, insW).poly;

    if (spec.type === 'eva') {
      const holes = slots.map((s) => move(s.poly, x0, y0));
      b.wrapSheet({
        id: 'insertEva',
        kind: 'eva',
        noBleed: true,
        poly: outerPoly,
        holes,
        creases: [],
        fill: spec.evaColorHex,
        label: '',
      });
      b.mark({ type: 'label', x: x0 + insL / 2, y: y0 - 7, text: `EVA内衬裁切图（厚 ${fmtN(spec.evaThick)}mm · ${spec.evaColorName}）` });
      b.mark({ type: 'label', x: x0 + slots[0].cx, y: y0 + slots[0].cy, text: `${slotText}${count > 1 ? ` ×${count}` : ''}` });
      b.note(`EVA 内衬（裁切平面图）：外尺寸 ${fmtN(insL)} × ${fmtN(insW)} mm，厚 ${fmtN(spec.evaThick)} mm（${spec.evaColorName}），${count} 个${spec.shapeName}（${slotText}）居中均分。`);
      b.extra3d({
        type: 'insert-eva',
        panel: trayFloor.panelId,
        cx: trayFloor.cx,
        cy: trayFloor.cy,
        baseT: trayFloor.baseT,
        rotated: !!trayFloor.rotated,
        L: insL,
        W: insW,
        depth: spec.evaThick,
        color: spec.evaColorHex,
        holes: slots.map((s) => s.localPoly),
      });
    } else {
      // 吸塑：外框按裁边，内部台阶和槽位按参考虚线（需开模成型）
      const creases = [];
      if (insL > 12 && insW > 12) {
        const flange = rect(x0 + 3, y0 + 3, insL - 6, insW - 6).poly;
        for (let i = 0; i < flange.length; i++) creases.push([flange[i], flange[(i + 1) % flange.length]]);
      }
      for (const s of slots) {
        const p = move(s.poly, x0, y0);
        for (let i = 0; i < p.length; i++) creases.push([p[i], p[(i + 1) % p.length]]);
      }
      b.wrapSheet({
        id: 'insertBlister',
        kind: 'blister',
        noBleed: true,
        poly: outerPoly,
        holes: [],
        creases,
        fill: spec.blisterColorHex,
        label: '',
      });
      b.mark({ type: 'label', x: x0 + insL / 2, y: y0 - 7, text: `吸塑内托参考图（${spec.blisterColorName} · 槽深 ${fmtN(spec.blisterDepth)}mm · 需开模）` });
      b.mark({ type: 'label', x: x0 + slots[0].cx, y: y0 + slots[0].cy, text: `${slotText} 深${fmtN(spec.blisterDepth)}` });
      b.note(`吸塑内衬需开吸塑模具成型，此图为外框与凹槽参考尺寸（${spec.blisterColorName}，槽深 ${fmtN(spec.blisterDepth)} mm，${count} 个${spec.shapeName} ${slotText}），不作直接裁切刀版。`);
      b.extra3d({
        type: 'insert-blister',
        panel: trayFloor.panelId,
        cx: trayFloor.cx,
        cy: trayFloor.cy,
        baseT: trayFloor.baseT,
        rotated: !!trayFloor.rotated,
        L: insL,
        W: insW,
        depth: spec.blisterDepth,
        color: spec.blisterColorHex,
        opacity: spec.blisterOpacity,
        rough: spec.blisterRough,
        slots: slots.map((s) => ({ cx: s.cx - insL / 2, cy: s.cy - insW / 2, w: s.w, h: s.h, poly: s.localPoly })),
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
    const cardR = rect(x0, y0, insL, insW);
    const holes = slots.map((s) => move(s.poly, x0, y0));
    const zInTray = -(trayFloor.baseT / 2 + spec.tIns / 2 + 1.5);
    const relM = new Matrix4()
      .makeTranslation(trayFloor.cx, -trayFloor.cy, zInTray)
      .multiply(rotM)
      .multiply(new Matrix4().makeTranslation(-cardR.cx, cardR.cy, 0));
    b.add('insCard', cardR.poly, {
      holes,
      kind: 'insert',
      thick: spec.tIns,
      part: 'insert',
      assemble: trayM.clone().multiply(relM),
      openLift: trayFloor.openLift || 0,
    });
    b.mark({ type: 'label', x: cardR.cx, y: y0 - 7, text: `内衬刀版（纸卡 · ${spec.paperGsm}g${spec.paperName}）` });
    b.dimH(x0, x0 + insL, y0 + insW + 2, y0 + insW + 10, fmtN(insL));
    b.dimV(y0, y0 + insW, x0 - 2, x0 - 10, fmtN(insW));
    b.note(`纸卡内衬：${spec.paperGsm}g${spec.paperName}，外尺寸 ${fmtN(insL)} × ${fmtN(insW)} mm，${count} 个${spec.shapeName}（${slotText}）居中冲孔。`);
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
  const holes = slots.map((s) => move(s.poly, dx - (insL - Ai) / 2, dy - (insW - Bi) / 2));

  const zTop = -(trayFloor.baseT / 2 + Di + tI / 2);
  const relM = new Matrix4()
    .makeTranslation(trayFloor.cx, -trayFloor.cy, zTop)
    .multiply(rotM)
    .multiply(new Matrix4().makeTranslation(-deck.cx, deck.cy, 0));

  b.add('insTop', deck.poly, {
    holes,
    kind: 'insert',
    thick: tI,
    part: 'insert',
    assemble: trayM.clone().multiply(relM),
    openLift: trayFloor.openLift || 0,
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
  b.dimH(dx, dx + Ai, dy + Bi + Di + foot + 2, dy + Bi + Di + foot + 10, fmtN(insL));
  b.dimV(dy, dy + Bi, dx - Di - 2, dx - Di - 10, fmtN(insW));
  b.note(`纸盒内衬：${spec.paperGsm}g${spec.paperName}，外尺寸 ${fmtN(insL)} × ${fmtN(insW)} mm，托高 ${fmtN(spec.platH)} mm，${count} 个${spec.shapeName}（${slotText}）居中挖孔。`);
  return spec;
}

export function insertSummaryLine(spec) {
  if (!spec) return null;
  const slotText = spec.shape === 'circle' ? `Ø${fmtN(spec.cavL)}` : `${fmtN(spec.cavL)}×${fmtN(spec.cavW)}`;
  const size = `${fmtN(spec.insL)} × ${fmtN(spec.insW)} mm`;
  if (spec.type === 'eva') return `内衬：EVA（厚 ${fmtN(spec.evaThick)} mm，${spec.evaColorName}），外尺寸 ${size}，${spec.count} 个${spec.shapeName}（${slotText}，居中均分）`;
  if (spec.type === 'blister') return `内衬：吸塑（${spec.blisterColorName}，槽深 ${fmtN(spec.blisterDepth)} mm，需开模参考），外尺寸 ${size}，${spec.count} 个${spec.shapeName}（${slotText}）`;
  if (spec.type === 'carton') return `内衬：折纸盒内托（${spec.paperGsm}g${spec.paperName}，高 ${fmtN(spec.platH)} mm），外尺寸 ${size}，${spec.count} 个${spec.shapeName}（${slotText}）`;
  if (spec.type === 'card') return `内衬：纸卡（${spec.paperGsm}g${spec.paperName}），外尺寸 ${size}，${spec.count} 个${spec.shapeName}（${slotText}）`;
  return null;
}

export function sleeveInnerSummaryLine(si) {
  if (!si || si.innerBox === 'none') return '内盒：无（仅封套）';
  const sz = `${fmtN(si.outer.L)} × ${fmtN(si.outer.W)} × ${fmtN(si.outer.H)} mm`;
  if (si.innerBox === 'rigid') return `内盒：灰板裱纸内盒（${si.greyGsm}g灰板 + ${si.wrapGsm}g铜版纸裱面，约${si.tIn.toFixed(2)}mm，外尺寸 ${sz}，已配内盒裱纸）`;
  return `内盒：铜版纸折叠内盒（${si.paperGsm}g铜版纸，约${si.tIn.toFixed(2)}mm，外尺寸 ${sz}）`;
}
