import { insertSummaryLine, sleeveInnerSummaryLine } from './insert.js';
/**
 * Material model aimed at sales / merchandisers, not converters.
 *
 * The user only picks a structure in plain Chinese and a gram weight (g/m²).
 * This module maps those choices to board caliper (mm) used for dieline
 * allowances (panel = inner + t, lid/sleeve clearance, wrap-paper turn-ins).
 *
 * Thickness figures are industry approximations from Chinese merchant /
 * converter rules of thumb, NOT mill certificates. Actual caliper varies by
 * mill, furnish and moisture; treat them as a starting point for quoting.
 *
 * 铜版纸 (C2S art / coated paper) — dense, typical 裱纸 wrap stock.
 *   Bulk ≈ 0.85–0.90 cm³/g  →  about 0.88 mm per 1000 g/m².
 *   Trade lists commonly quoted by print shops (2020s, 珠三角/长三角):
 *     128g ≈ 0.11 mm, 157g ≈ 0.13–0.14 mm, 200g ≈ 0.17–0.18 mm,
 *     250g ≈ 0.21–0.23 mm, 300g ≈ 0.26–0.28 mm.
 *   This matches the brief's "coated paper ~0.9–1.1 mm per 1000g" at the
 *   lower end of that band (pure art paper is closer to 0.9 than 1.1).
 *
 * 白卡 / 灰底白板 (FBB / GC1 / ivory / duplex folding-carton board) —
 *   bulkier than art paper, ≈ 1.35–1.45 mm per 1000 g/m².
 *   Common merchant tables: 250g ≈ 0.35 mm, 300g ≈ 0.40–0.42 mm,
 *   350g ≈ 0.48–0.50 mm, 400g ≈ 0.55–0.58 mm.
 *   Kept consistent with this tool's earlier presets (300g=0.40, 350g=0.50,
 *   400g=0.58–0.60).
 *
 * 特种纸 (珠光 / 触感 / 牛皮 / 棉 / 艺术): start from the 铜版纸 curve and
 *   apply a small bulk factor (cotton/art papers are looser; pearl/soft-touch
 *   stay close to coated). Always allow a custom gram weight.
 *
 * 灰板 (greyboard / chipboard, 精装灰板) — lower density, ≈ 0.62–0.70 g/cm³,
 *   i.e. about 1.5–1.6 mm per 1000 g/m². Typical South-China merchant lists:
 *     800g ≈ 1.2 mm, 1000g ≈ 1.5–1.6 mm, 1100g ≈ 1.7 mm,
 *     1200g ≈ 1.8–2.0 mm, 1400g ≈ 2.2 mm, 1600g ≈ 2.5 mm.
 *   Table below uses the mid of those ranges (1000→1.55, 1200→1.90, 1400→2.20).
 *
 * 瓦楞: structural thickness is the flute, not the liner gsm.
 *   E (细瓦) ≈ 1.5 mm, B (中瓦) ≈ 3.0 mm, BE (双瓦) ≈ 4.5 mm
 *   (GB/T 6544 flute ranges; converters often quote E 1.1–1.8, B 2.5–3.2).
 */

export const STRUCTURES = [
  { id: 'carton', name: '单层卡纸盒', hint: '常见彩盒：一张卡纸折叠粘好，像牙刷彩盒、扣底盒。' },
  { id: 'rigid', name: '灰板裱纸硬盒', hint: '礼盒做法：里面用灰板做骨架，外面再裱一层印刷纸。天地盒、书型盒、抽屉盒常用。' },
  { id: 'corrugated', name: '瓦楞纸盒', hint: '中间有波浪芯的纸板，更抗压，飞机盒、电商盒常用。' },
];

export const COATED_GSM = [150, 157, 200, 250, 300, 350, 400];
export const BOARD_GSM = [150, 157, 200, 250, 300, 350, 400];
export const GREY_GSM = [800, 1000, 1100, 1200, 1400, 1600];

export const FACE_KINDS = [
  { id: 'coated', name: '铜版纸', hint: '最常见的亮面印刷纸，图案颜色准。礼盒裱面常用 157g 或 200g。' },
  { id: 'board', name: '白卡纸', hint: '比铜版纸厚、挺括，折叠彩盒常用 300g–400g。' },
  { id: 'special', name: '特种纸', hint: '有特殊手感或外观的纸，再选下面的种类并填写克重。' },
];

export const SPECIAL_TYPES = [
  { id: 'pearl', name: '珠光纸', hint: '表面有珍珠光泽，显得高档。', bulk: 1.0 },
  { id: 'soft', name: '触感纸', hint: '摸起来有软绒或细腻触感。', bulk: 1.02 },
  { id: 'kraft', name: '牛皮纸', hint: '原色或染色牛皮，偏自然、复古。', bulk: 1.08 },
  { id: 'cotton', name: '棉纸', hint: '纤维感强、比较松厚。', bulk: 1.18 },
  { id: 'art', name: '艺术纸', hint: '各类纹理、色彩艺术纸的统称。', bulk: 1.15 },
];

export const FLUTES = [
  { id: 'E', name: '细瓦（E楞）', hint: '比较薄、表面较平，适合印刷精美的电商盒。', t: 1.5 },
  { id: 'B', name: '中瓦（B楞）', hint: '更厚更抗压，适合较重或要保护的产品。', t: 3.0 },
  { id: 'BE', name: '双瓦（BE楞）', hint: '两层瓦楞贴在一起，最抗压，适合大箱。', t: 4.5 },
];

export const LAMINATION = [
  { id: 'none', name: '不覆膜', hint: '印刷完不再贴保护膜。' },
  { id: 'gloss', name: '光膜', hint: '整面贴一层亮膜，颜色更鲜亮，也更好擦。' },
  { id: 'matte', name: '哑膜', hint: '整面贴一层雾面膜，不反光，手感更高级。' },
  { id: 'softtouch', name: '触感膜', hint: '整面贴一层触感膜，摸起来细腻柔滑，几乎不反光。' },
];

/** Local finishing processes. pdfSpot is the English separation name suppliers expect. */
export const PROCESSES = [
  { id: 'uv', name: '局部UV', en: 'Spot UV', pdfSpot: 'Spot_UV', hint: '只在指定位置涂一层亮光油，比如让 Logo 发亮。', color: '#3b7ddd', cmyk: [1, 0.2, 0, 0] },
  { id: 'emboss', name: '凹凸（凸起）', en: 'Emboss', pdfSpot: 'Emboss', hint: '用模具把纸压出凸起的花纹或字，摸得到。', color: '#7c5cbf', cmyk: [0.4, 0.7, 0, 0] },
  { id: 'deboss', name: '凹凸（凹陷）', en: 'Deboss', pdfSpot: 'Deboss', hint: '用模具把纸压出凹陷的花纹或字。', color: '#5a4a8a', cmyk: [0.5, 0.6, 0, 0.15] },
  { id: 'foil-gold', name: '烫金', en: 'Gold foil', pdfSpot: 'Foil_Gold', hint: '用热压把金色箔烫在纸上，Logo 和品牌名常用。', color: '#c9a227', cmyk: [0, 0.3, 0.9, 0.1] },
  { id: 'foil-silver', name: '烫银', en: 'Silver foil', pdfSpot: 'Foil_Silver', hint: '和烫金一样的做法，但用银色箔。', color: '#8a9199', cmyk: [0, 0, 0, 0.45] },
  { id: 'sculpt', name: '激凸', en: 'Raised emboss', pdfSpot: 'Raised_Emboss', hint: '比普通凹凸更立体，常常和烫金一起做，字像鼓起来一样。', color: '#c45c26', cmyk: [0, 0.6, 1, 0] },
  { id: 'reverse-uv', name: '逆向UV', en: 'Reverse UV', pdfSpot: 'Reverse_UV', hint: '大部分面积很亮，指定位置保持哑光，亮哑对比更强。', color: '#1f8a7a', cmyk: [0.8, 0, 0.45, 0] },
];

export const PROCESS_MAP = Object.fromEntries(PROCESSES.map((p) => [p.id, p]));

/** gsm → mm lookup tables. Linear interpolation between knots; flat extrapolation outside. */
export const CALIPER_TABLES = {
  coated: [
    [80, 0.07], [105, 0.09], [128, 0.11], [150, 0.13], [157, 0.14],
    [200, 0.175], [250, 0.22], [300, 0.265], [350, 0.31], [400, 0.35],
  ],
  board: [
    [150, 0.21], [157, 0.22], [200, 0.28], [230, 0.32], [250, 0.35],
    [300, 0.41], [350, 0.5], [400, 0.58], [450, 0.65],
  ],
  greyboard: [
    [600, 0.9], [800, 1.2], [1000, 1.55], [1100, 1.7],
    [1200, 1.9], [1400, 2.2], [1600, 2.5], [1800, 2.8], [2000, 3.1],
  ],
};

export function interpolateTable(table, gsm) {
  const g = Number(gsm);
  if (!Number.isFinite(g) || g <= 0) return table[0][1];
  if (g <= table[0][0]) {
    const [g0, t0] = table[0], [g1, t1] = table[1];
    return t0 + ((g - g0) * (t1 - t0)) / (g1 - g0);
  }
  if (g >= table[table.length - 1][0]) {
    const [g0, t0] = table[table.length - 2], [g1, t1] = table[table.length - 1];
    return t0 + ((g - g0) * (t1 - t0)) / (g1 - g0);
  }
  for (let i = 0; i < table.length - 1; i++) {
    const [g0, t0] = table[i], [g1, t1] = table[i + 1];
    if (g >= g0 && g <= g1) return t0 + ((g - g0) * (t1 - t0)) / (g1 - g0);
  }
  return table[table.length - 1][1];
}

export function thicknessFromGsm(kind, gsm, specialType) {
  const table = kind === 'greyboard' ? CALIPER_TABLES.greyboard
    : kind === 'board' ? CALIPER_TABLES.board
    : CALIPER_TABLES.coated;
  let t = interpolateTable(table, gsm);
  if (kind === 'special') {
    const sp = SPECIAL_TYPES.find((s) => s.id === specialType);
    t *= sp?.bulk ?? 1.1;
  }
  return Math.round(t * 1000) / 1000;
}

export function fluteThickness(flute) {
  return FLUTES.find((f) => f.id === flute)?.t ?? 1.5;
}

export function faceThickness(mat) {
  const kind = mat.faceKind === 'special' ? 'special' : mat.faceKind === 'board' ? 'board' : 'coated';
  return thicknessFromGsm(kind, mat.faceGsm, mat.specialType);
}

/** Structural board thickness used for dieline allowances. */
export function resolvedThickness(mat) {
  if (mat.tOverride != null && Number.isFinite(+mat.tOverride) && +mat.tOverride > 0) {
    return { t: +mat.tOverride, faceT: mat.structure === 'rigid' ? faceThickness(mat) : 0, overridden: true };
  }
  if (mat.structure === 'corrugated') {
    return { t: fluteThickness(mat.flute), faceT: 0, overridden: false };
  }
  if (mat.structure === 'rigid') {
    return { t: thicknessFromGsm('greyboard', mat.boardGsm), faceT: faceThickness(mat), overridden: false };
  }
  const kind = mat.faceKind === 'special' ? 'special' : mat.faceKind === 'coated' ? 'coated' : 'board';
  return { t: thicknessFromGsm(kind, mat.boardGsm, mat.specialType), faceT: 0, overridden: false };
}

const RIGID_STYLES = new Set(['lidbase', 'book', 'drawer']);
const CORRUGATED_STYLES = new Set(['mailer']);

export function defaultStructureFor(styleId) {
  if (RIGID_STYLES.has(styleId)) return 'rigid';
  if (CORRUGATED_STYLES.has(styleId)) return 'corrugated';
  return 'carton';
}

export function defaultMaterialFor(styleId) {
  const structure = defaultStructureFor(styleId);
  if (structure === 'rigid') {
    return { structure, boardGsm: 1200, faceKind: 'coated', faceGsm: 157, specialType: 'pearl', flute: 'E', turnIn: 15, tOverride: null };
  }
  if (structure === 'corrugated') {
    return { structure, boardGsm: 350, faceKind: 'board', faceGsm: 350, specialType: 'pearl', flute: 'E', turnIn: 15, tOverride: null };
  }
  return { structure, boardGsm: 350, faceKind: 'board', faceGsm: 350, specialType: 'pearl', flute: 'E', turnIn: 15, tOverride: null };
}

export function kindName(mat) {
  if (mat.faceKind === 'special') return SPECIAL_TYPES.find((s) => s.id === mat.specialType)?.name || '特种纸';
  return FACE_KINDS.find((k) => k.id === mat.faceKind)?.name || '卡纸';
}

export function materialSummary(mat, t) {
  const { t: tt, faceT, overridden } = t != null ? { t, faceT: mat.structure === 'rigid' ? faceThickness(mat) : 0, overridden: mat.tOverride != null } : resolvedThickness(mat);
  const thick = `板厚约${tt.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}mm${overridden ? '（已手动指定）' : ''}`;
  const auto = '按外尺寸填写，内尺寸已按板厚自动算出';
  if (mat.structure === 'rigid') {
    return `用料：${mat.boardGsm}g灰板 + ${mat.faceGsm}g${kindName(mat)}裱面，${thick}，${auto}`;
  }
  if (mat.structure === 'corrugated') {
    const fl = FLUTES.find((f) => f.id === mat.flute);
    return `用料：${fl?.name || mat.flute}瓦楞纸，${thick}，${auto}`;
  }
  const paper = mat.faceKind === 'special' ? `${mat.boardGsm}g${kindName(mat)}（特种纸）` : `${mat.boardGsm}g${kindName(mat)}`;
  return `用料：${paper}，${thick}，${auto}`;
}

export function materialShort(mat, t) {
  const { t: tt } = t != null ? { t } : resolvedThickness(mat);
  if (mat.structure === 'rigid') return `${mat.boardGsm}g灰板 + ${mat.faceGsm}g${kindName(mat)}  ${tt.toFixed(2)}mm`;
  if (mat.structure === 'corrugated') {
    const fl = FLUTES.find((f) => f.id === mat.flute);
    return `${fl?.name || mat.flute}  ${tt.toFixed(2)}mm`;
  }
  return `${mat.boardGsm}g${kindName(mat)}  ${tt.toFixed(2)}mm`;
}

export function finishSummary(lamination, regions) {
  const parts = [];
  const lam = LAMINATION.find((l) => l.id === lamination);
  if (lam && lam.id !== 'none') parts.push(`整盒${lam.name}`);
  const used = new Set();
  for (const r of regions || []) for (const p of r.processes || []) used.add(p);
  for (const p of PROCESSES) if (used.has(p.id)) parts.push(p.name);
  return parts.length ? `工艺：${parts.join('、')}` : '工艺：无特殊表面工艺';
}

function fmtQuoteDims(style, obj) {
  const dkeys = ['L', 'W', 'H'].filter((k) => style.dims[k]);
  const val = (k) => {
    const n = obj?.[k];
    if (n == null) return '';
    const s = (+n).toFixed(1).replace(/\.0$/, '');
    return s;
  };
  const lab = (k) => style.dims[k].replace(/\s*[A-Z]\s*$/, '').trim() || k;
  return dkeys.map((k) => `${lab(k)} ${val(k)}`).join(' × ') + ' mm';
}

/** Quote-sheet lines in plain Chinese (also used on the PDF title block). */
export function quoteInfoLines({ style, dims, mat, t, faceT, bleed, bbox, bboxBleed, lamination, finishRegions, outer, inner, lidType, openDir, sleeveInner, insertSpec }) {
  const outerObj = outer && !Array.isArray(outer) ? outer : (Array.isArray(outer) ? { L: outer[0], W: outer[1], H: outer[2] } : null);
  const innerObj = inner || dims;
  const lines = [
    `盒型：${style.name}（${style.en}）`,
  ];
  if (style.id === 'lidbase') {
    lines.push(`盖型：${lidType === 'full' ? '全盖（天盖盖到底）' : '鞋盒式半盖'}`);
  }
  if (style.id === 'book') {
    lines.push(`开盒方向：${openDir === 'short' ? '短边打开' : '长边打开'}`);
  }
  if (style.id === 'sleeve' && sleeveInner) {
    lines.push(sleeveInnerSummaryLine(sleeveInner));
  }
  if (outerObj) lines.push(`外尺寸（外面量到的尺寸）：${fmtQuoteDims(style, outerObj)}`);
  if (innerObj) lines.push(`内尺寸（里面能放的产品）：${fmtQuoteDims(style, innerObj)}`);
  lines.push(materialSummary(mat, t));
  if (mat.structure === 'rigid') {
    lines.push(`裱纸包边 ${mat.turnIn ?? 15} mm，面纸厚约${(faceT ?? faceThickness(mat)).toFixed(2)}mm`);
  }
  const insLine = insertSummaryLine(insertSpec);
  if (insLine) lines.push(insLine);
  lines.push(finishSummary(lamination, finishRegions));
  if (bbox) lines.push(`展开尺寸 ${bbox.w.toFixed(1)} × ${bbox.h.toFixed(1)} mm` + (bboxBleed ? `（含多印边 ${bboxBleed.w.toFixed(1)} × ${bboxBleed.h.toFixed(1)}）` : ''));
  if (bleed != null) lines.push(`多印边（出血） ${bleed} mm；刀线专色 CutContour，压痕专色 Crease` + processSpotNote(finishRegions));
  return lines;
}

function processSpotNote(regions) {
  const used = [];
  const seen = new Set();
  for (const r of regions || []) for (const id of r.processes || []) {
    if (seen.has(id)) continue; seen.add(id);
    const p = PROCESS_MAP[id]; if (p) used.push(`${p.name}=${p.pdfSpot}`);
  }
  return used.length ? `；工艺专色 ${used.join('、')}` : '';
}

/** Backward-compatible material presets (old project files / earlier UI). */
export const MATERIALS = [
  { id: 'card300', name: '300g 白卡纸', t: 0.41, mat: { structure: 'carton', boardGsm: 300, faceKind: 'board', faceGsm: 300 } },
  { id: 'card350', name: '350g 白卡纸', t: 0.5, mat: { structure: 'carton', boardGsm: 350, faceKind: 'board', faceGsm: 350 } },
  { id: 'card400', name: '400g 白卡纸', t: 0.58, mat: { structure: 'carton', boardGsm: 400, faceKind: 'board', faceGsm: 400 } },
  { id: 'kraft', name: '350g 牛皮纸', t: thicknessFromGsm('special', 350, 'kraft'), mat: { structure: 'carton', boardGsm: 350, faceKind: 'special', faceGsm: 350, specialType: 'kraft' } },
  { id: 'eflute', name: '细瓦（E楞）', t: 1.5, mat: { structure: 'corrugated', flute: 'E' } },
  { id: 'bflute', name: '中瓦（B楞）', t: 3, mat: { structure: 'corrugated', flute: 'B' } },
  { id: 'grey15', name: '1000g 灰板', t: 1.55, mat: { structure: 'rigid', boardGsm: 1000, faceKind: 'coated', faceGsm: 157 } },
  { id: 'grey2', name: '1200g 灰板', t: 1.9, mat: { structure: 'rigid', boardGsm: 1200, faceKind: 'coated', faceGsm: 157 } },
];

export function materialFromLegacy(materialId, t) {
  const preset = MATERIALS.find((m) => m.id === materialId);
  const base = defaultMaterialFor('ste');
  if (preset) return { ...base, ...preset.mat, tOverride: (t != null && Math.abs(t - preset.t) > 0.02) ? t : null };
  if (t != null) return { ...base, tOverride: t };
  return base;
}

export const ADVANCED_PARAMS = new Set(['glue', 'clear', 'overhang', 'tuck', 'arc', 'magnetD', 'magnetInset', 'flapGap']);
