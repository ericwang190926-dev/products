import { buildTuck, tuckParams, tuckExpect } from './tuck.js';
import * as O from './others.js';
import { clamp } from '../geom.js';

export const CATEGORIES = [
  { id: 'tuck', name: '插舌盒 / 彩盒' },
  { id: 'lock', name: '锁底盒' },
  { id: 'rigid', name: '礼盒 / 硬盒' },
  { id: 'ship', name: '电商 / 展示 / 托盘' },
  { id: 'special', name: '异形盒' },
  { id: 'card', name: '卡类' },
];
const LWH = { L: '长 L', W: '宽 W', H: '高 H' };
const glueP = { key: 'glue', label: '粘口宽', def: (c) => Math.min(c.t >= 1.2 ? 30 : 14, c.B - 2) };
const tuckStyle = (id, name, en, category, desc, o, extra = {}) => ({
  id, name, en, category, desc, dims: LWH, defaults: { L: 30, W: 25, H: 200 }, params: tuckParams(o),
  build: (c) => buildTuck(c, o), expect: tuckExpect, ...extra,
});

export const STYLES = [
  tuckStyle('ste', '直插盒（同向插舌）', 'Straight Tuck End', 'tuck', '上下插舌在同一面，最常见的彩盒，适合牙刷、刷头。', { top: 'tuck', topOn: 'back', bottom: 'tuck', bottomOn: 'back' }),
  tuckStyle('rte', '反插盒（反向插舌）', 'Reverse Tuck End', 'tuck', '上下插舌方向相反，排版省纸，正面上下边干净。', { top: 'tuck', topOn: 'back', bottom: 'tuck', bottomOn: 'front' }),
  tuckStyle('window', '开窗插舌盒', 'Window Tuck Box', 'tuck', '正面开窗（可贴 PET 胶片），直观展示产品。', { top: 'tuck', topOn: 'back', bottom: 'tuck', bottomOn: 'front', window: true }),
  tuckStyle('hanger', '挂钩插舌盒（带挂孔）', 'Hanger Tuck Box', 'tuck', '背板延伸挂头带挂孔（宽≥40 用欧式挂孔），超市挂架常用，牙刷首选。', { top: 'tuck', topOn: 'front', bottom: 'tuck', bottomOn: 'back', header: true }),
  tuckStyle('seal', '粘口盒（四翼封口）', 'Seal End Carton', 'tuck', '上下四翼胶粘封口，适合自动包装线。', { top: 'seal', bottom: 'seal' }),
  tuckStyle('crash', '扣底盒（自动锁底）', 'Crash-Lock Bottom', 'lock', '上插舌 + 预粘自动锁底，撑开即成型，承重好。', { top: 'tuck', topOn: 'back', bottom: 'crash' }, { defaults: { L: 70, W: 50, H: 180 } }),
  tuckStyle('snap', '插舌 + 快锁底（1-2-3底）', 'Tuck Top Snap-Lock Bottom', 'lock', '底部四翼互扣，无需胶粘，适合中等重量产品。', { top: 'tuck', topOn: 'back', bottom: 'snap' }, { defaults: { L: 70, W: 50, H: 180 } }),
  tuckStyle('crash-hanger', '挂钩扣底盒', 'Hanger Crash-Lock', 'lock', '自动锁底 + 挂头，适合电动牙刷整机挂卖。', { top: 'tuck', topOn: 'front', bottom: 'crash', header: true }, { defaults: { L: 60, W: 45, H: 230 } }),
  tuckStyle('crash-window', '开窗扣底盒', 'Window Crash-Lock', 'lock', '自动锁底 + 正面开窗。', { top: 'tuck', topOn: 'back', bottom: 'crash', window: true }, { defaults: { L: 70, W: 50, H: 180 } }),
  {
    id: 'lidbase', name: '天地盒（天地盖）', en: 'Lid & Base (Telescope)', category: 'rigid', desc: '底盒 + 盖两件式，盖自动加间隙；盖高可调（全盖/半盖）。', dims: LWH, defaults: { L: 220, W: 120, H: 60 }, material: 'grey2',
    params: [{ key: 'lidH', label: '盖高', def: (c) => Math.round(clamp(c.H * 0.4, 15, c.H)) }, { key: 'clear', label: '盖与底间隙', def: (c) => (c.t >= 1 ? 1 : 0.5) }],
    build: O.lidBase, expect: O.lidBaseExpect, view3d: { rx: 90, ry: 180 },
  },
  {
    id: 'book', name: '书型盒（磁吸翻盖）', en: 'Magnetic Book Box', category: 'rigid', desc: '封面 + 书脊 + 封底包内盒，翻盖带磁铁位，高档礼盒常用。', dims: LWH, defaults: { L: 220, W: 120, H: 60 }, material: 'grey2',
    params: [{ key: 'overhang', label: '封面外伸', def: (c) => (c.t >= 1 ? 2 : 1) }],
    build: O.bookBox, expect: O.bookExpect, view3d: { rx: 90, ry: 0 },
  },
  {
    id: 'drawer', name: '抽屉盒（外套 + 内托）', en: 'Sleeve & Tray Drawer', category: 'rigid', desc: '内托沿长度方向抽出，外套为封套结构。', dims: LWH, defaults: { L: 200, W: 80, H: 40 },
    params: [glueP, { key: 'clear', label: '外套间隙', def: (c) => (c.t >= 1 ? 1 : 0.5) }],
    build: O.drawer, expect: O.drawerExpect, view3d: { rx: -90, ry: 0 },
  },
  {
    id: 'sleeve', name: '封套盒', en: 'Sleeve', category: 'rigid', desc: '两端开口的套筒，可套在内盒/托盘外。H 为封套宽度。', dims: { L: '长 L', W: '宽 W', H: '封套宽 H' }, defaults: { L: 200, W: 80, H: 120 },
    params: [glueP], build: O.sleeve, expect: O.sleeveExpect,
  },
  {
    id: 'band', name: '腰封', en: 'Belly Band', category: 'rigid', desc: '窄封套，套在盒子中段做品牌/促销信息。H 为腰封宽度。', dims: { L: '长 L', W: '宽 W', H: '腰封宽 H' }, defaults: { L: 200, W: 80, H: 50 },
    params: [glueP], build: O.sleeve, expect: O.sleeveExpect,
  },
  {
    id: 'mailer', name: '飞机盒', en: 'Mailer Box (FEFCO 0427)', category: 'ship', desc: '电商快递常用，双层侧墙，盖前插舌，无需胶粘。', dims: LWH, defaults: { L: 220, W: 160, H: 60 }, material: 'eflute',
    params: [{ key: 'tuck', label: '盖前插舌深', def: (c) => Math.round(Math.min(c.D * 0.7, 40)) }],
    build: O.mailer, expect: O.mailerExpect, view3d: { rx: 90, ry: 180 },
  },
  {
    id: 'display', name: '展示盒（柜台 PDQ）', en: 'Counter Display Box', category: 'ship', desc: '低前墙 + 斜侧墙 + 双层头卡，放柜台陈列多支牙刷。', dims: { L: '长 L', W: '深 W', H: '背高 H' }, defaults: { L: 200, W: 120, H: 80 },
    params: [{ key: 'frontH', label: '前墙高', def: (c) => Math.round(c.D * 0.4) }, { key: 'headerH', label: '头卡高(背板以上)', def: (c) => Math.round(c.D * 0.9) }],
    build: O.display, expect: O.displayExpect, view3d: { rx: 90, ry: 180 },
  },
  {
    id: 'tray', name: '托盘（四角粘合）', en: 'Corner-Glued Tray', category: 'ship', desc: '开口托盘，长墙带粘角、端墙双层回折，可做内托/天地盒内盒。', dims: LWH, defaults: { L: 200, W: 120, H: 40 },
    params: [], build: O.plainTray, expect: O.trayExpect, view3d: { rx: 90, ry: 180 },
  },
  {
    id: 'traylid', name: '一体翻盖盒', en: 'Tray with Hinged Lid', category: 'ship', desc: '托盘 + 后墙连体翻盖，盖前插舌与两侧防尘翼。', dims: LWH, defaults: { L: 200, W: 120, H: 40 },
    params: [{ key: 'tuck', label: '盖前插舌深', def: (c) => Math.round(Math.min(c.D * 0.6, 25)) }], build: O.trayLid, expect: O.trayExpect, view3d: { rx: 90, ry: 180 },
  },
  {
    id: 'pillow', name: '枕头盒', en: 'Pillow Box', category: 'special', desc: '弧形压痕端口，适合小礼品、刷头替换装。L=长 W=宽 H=鼓起厚度。', dims: { L: '长 L', W: '宽 W', H: '厚 H' }, defaults: { L: 160, W: 80, H: 30 },
    params: [glueP, { key: 'arc', label: '端口弧深', def: (c) => Math.round(Math.min(c.H * 0.6, c.W * 0.25) * 10) / 10 }],
    build: O.pillow, expect: null,
  },
  {
    id: 'gable', name: '手提盒（屋顶盒）', en: 'Gable Box', category: 'special', desc: '带提手的屋顶形盒，礼品/套装常用，底部快锁。', dims: LWH, defaults: { L: 120, W: 70, H: 150 },
    params: [glueP, { key: 'gableH', label: '斜顶高', def: (c) => Math.round(Math.max(c.B * 0.75, c.B / 2 + 5)) }, { key: 'handleH', label: '提手高', def: () => 40 }],
    build: O.gable, expect: O.gableExpect,
  },
  {
    id: 'hex', name: '六角盒', en: 'Hexagonal Box', category: 'special', desc: '六棱柱，上下多边形插盖 + 防尘翼。L 为边长。', dims: { L: '边长 S', H: '高 H' }, defaults: { L: 40, W: 40, H: 120 },
    params: [glueP, { key: 'tuck', label: '插舌深', def: (c) => Math.round(clamp(c.L * 0.4, 8, 20)) }],
    build: (c) => O.prism(c, 6), expect: (c) => O.prismExpect(c, 6),
  },
  {
    id: 'tri', name: '三角盒', en: 'Triangular Prism Box', category: 'special', desc: '三棱柱，适合巧克力/条状产品。L 为边长。', dims: { L: '边长 S', H: '长 H' }, defaults: { L: 45, W: 45, H: 200 },
    params: [glueP, { key: 'tuck', label: '插舌深', def: (c) => Math.round(clamp(c.L * 0.3, 8, 18)) }],
    build: (c) => O.prism(c, 3), expect: (c) => O.prismExpect(c, 3),
  },
  {
    id: 'oct', name: '八角盒', en: 'Octagonal Box', category: 'special', desc: '八棱柱礼盒。L 为边长。', dims: { L: '边长 S', H: '高 H' }, defaults: { L: 30, W: 30, H: 100 },
    params: [glueP, { key: 'tuck', label: '插舌深', def: (c) => Math.round(clamp(c.L * 0.5, 8, 20)) }],
    build: (c) => O.prism(c, 8), expect: (c) => O.prismExpect(c, 8),
  },
  {
    id: 'blister', name: '吸塑背卡', en: 'Blister Card', category: 'card', desc: '吸塑泡壳背卡，可选对折双层（前片开窗夹泡壳）。L=卡宽 H=卡高 W=泡壳深。', dims: { L: '卡宽 L', W: '泡壳深 W', H: '卡高 H' }, defaults: { L: 60, W: 25, H: 230 },
    params: [{ key: 'fold', label: '对折双层', type: 'bool', def: () => true }, { key: 'hole', label: '挂孔', type: 'bool', def: () => true }, { key: 'winW', label: '泡壳宽', def: (c) => Math.round(c.L * 0.6) }, { key: 'winH', label: '泡壳高', def: (c) => Math.round(c.H * 0.7) }, { key: 'winY', label: '泡壳上下偏移', def: (c) => Math.round(c.H * 0.06) }],
    build: (c) => O.card(c, 'blister'), expect: O.cardExpect,
  },
  {
    id: 'headercard', name: '对折吊卡（袋装头卡）', en: 'Fold-over Header Card', category: 'card', desc: '订在 OPP 袋口的对折头卡，适合刷头补充装。L=宽 H=单片高。', dims: { L: '宽 L', H: '单片高 H' }, defaults: { L: 100, W: 10, H: 45 },
    params: [{ key: 'fold', label: '对折双层', type: 'bool', def: () => true }, { key: 'hole', label: '挂孔', type: 'bool', def: () => true }],
    build: (c) => O.card(c, 'header'), expect: O.cardExpect,
  },
];
export const STYLE_MAP = Object.fromEntries(STYLES.map((s) => [s.id, s]));
