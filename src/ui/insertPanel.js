// 内衬 panel: material + thickness controls, then one editable card per slot (primary),
// then small layout helpers (secondary).
import {
  INSERT_TYPES, EVA_THICKS, EVA_COLORS, BLISTER_COLORS, BLISTER_SHEETS, INSERT_PAPER_KINDS, INSERT_PAPER_GSM,
  SLOT_SHAPES, NOTCH_SIDES,
} from '../core/insert.js';

const f1 = (n) => (Math.round(n * 10) / 10).toString();
const f2 = (n) => (Math.round(n * 100) / 100).toString();

export function insertPanelHTML(spec, { state, tip, escAttr, gsmPicks, insType }) {
  let h = `<div class="sec" id="insertSec"><h3>${tip('内衬', '放在盒里面固定产品的托盘或隔卡。外尺寸按盒内空间自动算好，每个槽可以单独设置形状、大小、位置。')}</h3>`;
  h += `<div class="chips" id="insertTypes">`;
  for (const it of INSERT_TYPES) h += `<span class="chip ${insType === it.id ? 'on' : ''}" data-insert-type="${it.id}" title="${escAttr(it.hint)}">${it.name}</span>`;
  h += `</div>`;
  if (!spec) return h + `</div>`;

  h += `<div class="summary" style="margin-top:8px">内衬外尺寸已自动适配盒内空间：<b>${f1(spec.insL)} × ${f1(spec.insW)}</b> mm（盒内深约 ${f1(spec.insH)} mm）</div>`;

  // ---- material + thickness ----
  if (spec.type === 'eva') {
    const known = EVA_THICKS.includes(+spec.evaThick);
    h += `<div class="field"><span class="lbl">${tip('EVA 厚度 (mm)', '泡棉整块的厚度。槽默认开通；想做不通的凹位，在槽里填“深度”。')}</span><div class="gsm-picks">`;
    for (const tv of EVA_THICKS) if (tv <= spec.insH + 0.01) h += `<button type="button" class="gsm ${+spec.evaThick === tv ? 'on' : ''}" data-eva-thick="${tv}">${tv}mm</button>`;
    h += `<label class="gsm-custom">其他<input type="number" data-param="evaThick" min="3" max="${Math.max(10, Math.floor(spec.insH))}" step="1" value="${known ? '' : spec.evaThick}" placeholder="mm"/></label></div></div>`;
    h += `<div class="field"><span class="lbl">EVA 颜色</span><div class="chips">`;
    for (const cl of EVA_COLORS) h += `<span class="chip ${spec.evaColor === cl.id ? 'on' : ''}" data-eva-color="${cl.id}">${cl.name}</span>`;
    h += `</div></div>`;
  } else if (spec.type === 'blister') {
    h += `<div class="field"><span class="lbl">吸塑材质/颜色</span><div class="chips">`;
    for (const cl of BLISTER_COLORS) h += `<span class="chip ${spec.blisterColor === cl.id ? 'on' : ''}" data-blister-color="${cl.id}">${cl.name}</span>`;
    h += `</div></div>`;
    const knownS = BLISTER_SHEETS.includes(+spec.blisterSheet);
    h += `<div class="field"><span class="lbl">${tip('片材厚度 (mm)', '吸塑用的塑料片原来的厚度，常用 0.3 / 0.5 / 0.8 / 1.0。')}</span><div class="gsm-picks">`;
    for (const tv of BLISTER_SHEETS) h += `<button type="button" class="gsm ${+spec.blisterSheet === tv ? 'on' : ''}" data-set-param="blisterSheet" data-val="${tv}">${tv}mm</button>`;
    h += `<label class="gsm-custom">其他<input type="number" data-param="blisterSheet" min="0.1" max="3" step="0.1" value="${knownS ? '' : spec.blisterSheet}" placeholder="mm"/></label></div></div>`;
    h += `<div class="row"><label>${tip('整体高度 (mm)', '吸塑托从边沿到最深处的高度，也是每个槽默认的深度。')}</label><input type="number" step="1" min="4" max="${Math.floor(spec.insH)}" data-param="blisterDepth" placeholder="自动 ${f1(spec.blisterDepth)}" value="${state.params.blisterDepth ?? ''}"/></div>`;
    h += `<div class="note">提示：吸塑需开吸塑模具成型，导出图纸为外框与凹槽尺寸参考，不作直接裁切刀版。</div>`;
  } else {
    h += `<div class="field"><span class="lbl">内衬用纸</span><div class="chips">`;
    for (const pk of INSERT_PAPER_KINDS) h += `<span class="chip ${spec.paperKind === pk.id ? 'on' : ''}" data-ins-paper="${pk.id}">${pk.name}</span>`;
    h += `</div></div>`;
    h += `<div class="field"><span class="lbl">纸张克重（厚约 ${f2(spec.tIns)} mm）</span>${gsmPicks('insPaperGsm', INSERT_PAPER_GSM, spec.paperGsm, true)}</div>`;
    if (spec.type === 'carton') {
      h += `<div class="row"><label>${tip('内托高度 (mm)', '纸盒内托垫起来的高度，产品离盒底多高。')}</label><input type="number" step="1" min="6" max="${Math.floor(spec.insH)}" data-param="insPlatH" placeholder="自动 ${f1(spec.platH)}" value="${state.params.insPlatH ?? ''}"/></div>`;
    } else {
      h += `<div class="row"><label>${tip('离盒底 (mm)', '纸卡抬高多少。0 就是平放在盒底；抬高的话，下面需要另加垫条或折脚，这里只示意高度。')}</label><input type="number" step="1" min="0" max="${Math.max(0, Math.floor(spec.insH - spec.tIns))}" data-param="insCardLift" placeholder="0（平放）" value="${state.params.insCardLift ?? ''}"/></div>`;
    }
  }

  // ---- slots (primary) ----
  const slots = spec.slots;
  const sel = Math.min(Math.max(0, state.selectedSlot ?? 0), Math.max(0, slots.length - 1));
  const center = state.slotCoord === 'center';
  h += `<h4 class="subh">${tip('槽位（每个槽单独设置）', '每个槽都是独立的：形状、大小、角度、深度、位置都可以不一样。在左边刀版图上也可以直接拖动槽来改位置。')}</h4>`;
  h += `<div class="field"><span class="lbl">位置坐标从</span><div class="chips">`;
  h += `<span class="chip ${!center ? 'on' : ''}" data-slot-coord="edge">内衬左上角</span><span class="chip ${center ? 'on' : ''}" data-slot-coord="center">内衬中心</span></div></div>`;
  if (spec.warnings.length) {
    h += `<div class="warnbox" id="slotWarnings">`;
    for (const w of spec.warnings) h += `<div class="warn" data-warn-slot="${w.slots[0]}">⚠ ${w.text}</div>`;
    h += `</div>`;
  } else if (slots.length) {
    h += `<div class="okbox">槽位都在内衬范围内，没有重叠，壁厚够（至少 ${spec.minWall} mm）。</div>`;
  }
  if (!slots.length) h += `<div class="note">现在没有槽。点下面的“添加槽”开一个。</div>`;
  const posLabel = (axis) => (center ? (axis === 'x' ? '中心偏右' : '中心偏下') : (axis === 'x' ? '距左边' : '距上边'));
  const numIn = (i, key, val, { min, max, step = 0.5, ph = '' } = {}) => `<input type="number" data-slot="${i}" data-key="${key}" step="${step}" ${min != null ? `min="${min}"` : ''} ${max != null ? `max="${max}"` : ''} value="${val ?? ''}" ${ph ? `placeholder="${ph}"` : ''}/>`;
  slots.forEach((s, i) => {
    const size = s.shape === 'circle' ? `Ø${f1(s.w)}` : `${f1(s.w)} × ${f1(s.h)}`;
    const shapeName = SLOT_SHAPES.find((x) => x.id === s.shape)?.name || '';
    const bad = spec.warnings.some((w) => w.slots.includes(i));
    h += `<details class="slot ${i === sel ? 'on' : ''} ${bad ? 'bad' : ''}" data-slot-card="${i}" ${i === sel ? 'open' : ''}>`;
    h += `<summary data-slot-select="${i}"><span class="no">${i + 1}</span><span class="nm">${shapeName} ${size}</span>`;
    h += `<span class="act"><button type="button" class="small" data-slot-dup="${i}" title="复制这个槽">复制</button><button type="button" class="small" data-slot-del="${i}" title="删除这个槽">删除</button></span></summary>`;
    h += `<div class="slot-body">`;
    h += `<div class="chips">`;
    for (const sh of SLOT_SHAPES) h += `<span class="chip ${s.shape === sh.id ? 'on' : ''}" data-slot-set data-slot="${i}" data-key="shape" data-val="${sh.id}">${sh.name}</span>`;
    h += `</div>`;
    h += `<div class="slot-grid">`;
    if (s.shape === 'circle') h += `<label>直径</label>${numIn(i, 'w', f2(s.w), { min: 3 })}<span></span><span></span>`;
    else h += `<label>长（横向）</label>${numIn(i, 'w', f2(s.w), { min: 3 })}<label>宽（纵向）</label>${numIn(i, 'h', f2(s.h), { min: 3 })}`;
    if (s.shape === 'roundRect') h += `<label>圆角半径</label>${numIn(i, 'r', s.r ?? '', { min: 0, ph: `自动 ${f1(Math.max(0.5, Math.min(s.w, s.h) * 0.24))}` })}<span></span><span></span>`;
    const px = center ? s.x - spec.insL / 2 : s.x, py = center ? s.y - spec.insW / 2 : s.y;
    h += `<label>${posLabel('x')}</label>${numIn(i, 'x', f2(px), { step: 1 })}<label>${posLabel('y')}</label>${numIn(i, 'y', f2(py), { step: 1 })}`;
    h += `<label>旋转（度）</label>${numIn(i, 'rot', f2(s.rot), { step: 15 })}<span class="chips mini"><span class="chip ${Math.abs(s.rot) < 0.01 ? 'on' : ''}" data-slot-set data-slot="${i}" data-key="rot" data-val="0">0°</span><span class="chip ${Math.abs(Math.abs(s.rot) - 90) < 0.01 ? 'on' : ''}" data-slot-set data-slot="${i}" data-key="rot" data-val="90">90°</span></span>`;
    if (spec.type === 'eva') {
      h += `<label>${tip('深度', 'EVA 里这个槽开多深。不填或填满厚度就是开通；比厚度小就是不通的凹位。')}</label>${numIn(i, 'depth', s.depth ?? '', { min: 1, max: spec.evaThick, step: 1, ph: '通孔' })}<span class="chips mini"><span class="chip ${s.through ? 'on' : ''}" data-slot-set data-slot="${i}" data-key="depth" data-val="">通孔</span></span>`;
    } else if (spec.type === 'blister') {
      h += `<label>${tip('槽深', '吸塑里这个槽凹下去多深，默认等于整体高度。')}</label>${numIn(i, 'depth', s.depth ?? '', { min: 3, max: spec.insH, step: 1, ph: `整体 ${f1(spec.blisterDepth)}` })}<span></span><span></span>`;
    }
    h += `</div>`;
    const l = s.poly.reduce((a, p) => Math.min(a, p[0]), Infinity), r = spec.insL - s.poly.reduce((a, p) => Math.max(a, p[0]), -Infinity);
    const t = s.poly.reduce((a, p) => Math.min(a, p[1]), Infinity), b = spec.insW - s.poly.reduce((a, p) => Math.max(a, p[1]), -Infinity);
    h += `<div class="slot-edges">离边：左 ${f1(l)} · 右 ${f1(r)} · 上 ${f1(t)} · 下 ${f1(b)} mm`;
    h += `　<button type="button" class="small" data-slot-center="${i}" data-axis="x">水平居中</button><button type="button" class="small" data-slot-center="${i}" data-axis="y">垂直居中</button></div>`;
    h += `<label class="notch-row"><input type="checkbox" data-slot="${i}" data-key="notch" ${s.notch ? 'checked' : ''}/> ${tip('取物手扣位', '在槽边上多开一个半圆缺口，方便用手指把产品抠出来。')}</label>`;
    if (s.notch) {
      h += `<div class="chips">`;
      for (const ns of NOTCH_SIDES) h += `<span class="chip ${s.notchSide === ns.id ? 'on' : ''}" data-slot-set data-slot="${i}" data-key="notchSide" data-val="${ns.id}">${ns.name}</span>`;
      h += `</div><div class="slot-grid"><label>缺口半径</label>${numIn(i, 'notchR', f2(s.notchR), { min: 2, max: 40, step: 1 })}<span></span><span></span></div>`;
    }
    h += `</div></details>`;
  });
  h += `<div class="btns"><button type="button" class="small primary" data-slot-add>＋ 添加槽</button></div>`;

  // ---- layout helpers (secondary) ----
  if (slots.length) {
    h += `<details class="helpers" open><summary>排布小工具（批量调整，可不用）</summary>`;
    h += `<div class="btns"><button type="button" class="small" data-slot-layout="centerAll">整体居中</button><button type="button" class="small" data-slot-layout="distX">水平均分</button><button type="button" class="small" data-slot-layout="distY">垂直均分</button></div>`;
    h += `<div class="slot-grid"><label>统一间距 (mm)</label><input type="number" id="slotGap" step="1" min="0" value="${state.slotGap ?? 6}"/>`;
    h += `<button type="button" class="small" data-slot-layout="gapX">横向排开</button><button type="button" class="small" data-slot-layout="gapY">纵向排开</button></div>`;
    h += `<div class="slot-grid"><label>快速排 N 个</label><input type="number" id="slotQuickN" step="1" min="1" max="24" value="${slots.length}"/>`;
    h += `<button type="button" class="small" data-slot-layout="quickAcross" title="照第 1 个槽复制，沿内衬宽度方向并排">沿宽并排</button><button type="button" class="small" data-slot-layout="quickAlong" title="照第 1 个槽复制，沿内衬长度方向顺排">沿长顺排</button></div>`;
    h += `<div class="hint">“快速排 N 个”会按第 1 个槽的样子重新生成，其他槽的单独设置会被覆盖。</div>`;
    h += `</details>`;
  }
  h += `</div>`;
  return h;
}
