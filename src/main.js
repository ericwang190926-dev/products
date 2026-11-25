import './style.css';
import { STYLES, STYLE_MAP, CATEGORIES } from './core/styles/index.js';
import {
  STRUCTURES, FACE_KINDS, SPECIAL_TYPES, FLUTES, COATED_GSM, BOARD_GSM, GREY_GSM,
  LAMINATION, PROCESSES, PROCESS_MAP, ADVANCED_PARAMS, MATERIALS,
  defaultMaterialFor, resolvedThickness, materialSummary, materialShort,
  materialFromLegacy, quoteInfoLines, kindName,
} from './core/materials.js';
import { resolveBoxDims, fmtSize } from './core/dims.js';
import { usedProcesses, regionsByProcess } from './core/finish.js';
import { buildGeometry } from './core/model.js';
import { FACE_NAMES } from './core/builder.js';
import { createView2D, elementSize } from './ui/view2d.js';
import { createView3D } from './ui/view3d.js';
import { renderFlat, imageCache } from './render/raster.js';
import { buildPDF } from './export/pdf.js';
import { buildSVG, buildDXF } from './export/vector.js';

const $ = (s) => document.querySelector(s);
const state = {
  styleId: 'hanger', dims: { ...STYLE_MAP.hanger.defaults },
  mat: defaultMaterialFor('hanger'), materialId: 'card350', t: 0.5, faceT: 0, bleed: 3, params: {},
  boxColor: '#ffffff', boardColor: '#f1ede4', faceColors: {}, elements: [], selected: null, selectedFace: 'front',
  selectedFinish: null, lamination: 'none', finishRegions: [], drawFinish: false, finishUid: 1, dimMode: 'outer',
  layers: { art: true, cut: true, crease: true, bleed: true, glue: true, dims: true, labels: true, finish: true, magnet: true },
  dimsTouched: false, materialTouched: false,
};
function syncMaterial() {
  const r = resolvedThickness(state.mat);
  state.t = r.t; state.faceT = r.faceT;
  const hit = MATERIALS.find((m) => m.mat && m.mat.structure === state.mat.structure
    && (state.mat.structure === 'corrugated' ? m.mat.flute === state.mat.flute
      : m.mat.boardGsm === state.mat.boardGsm && (m.mat.faceKind || 'board') === (state.mat.faceKind || 'board')));
  state.materialId = hit && Math.abs((hit.t) - state.t) < 0.03 ? hit.id : 'custom';
}
syncMaterial();
let geo = null; let uid = 1;
const toast = (msg) => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2200); };
window.__app = { state, get geo() { return geo; } };

const view2d = createView2D($('#svg2d'), {
  select: (id, face) => { state.selected = id; if (face) state.selectedFace = face; if (id) { const r = state.finishRegions.find((x) => x.type === 'el' && x.elementId === id); state.selectedFinish = r ? r.id : null; } render2D(); renderArtPanel(); renderStruct(); if (face && !id && !state.drawFinish) switchTab('art'); },
  changed: () => { render2D(); scheduleTexture(); renderArtPanel(); },
  dragging: () => scheduleTexture(),
  finishRect: (face, x, y, w, h) => {
    const r = { id: 'f' + state.finishUid++, type: 'rect', face, x, y, w, h, rot: 0, processes: ['foil-gold'] };
    state.finishRegions.push(r); state.selectedFinish = r.id; state.drawFinish = false;
    $('#svg2d').classList.remove('draw-finish');
    render2D(); scheduleTexture(); renderArtPanel(); renderStruct();
    toast('已在盒面上画了一块区域，默认先做烫金，可在右侧改成别的工艺');
    switchTab('art');
  },
});
const view3d = createView3D($('#three'));
let texPending = false;
function scheduleTexture() { if (texPending) return; texPending = true; requestAnimationFrame(() => { texPending = false; view3d.updateTexture(state); }); }
function render2D(opts) { view2d.render(geo, state, opts); }

function rebuild({ refit = false } = {}) {
  try {
    geo = buildGeometry(state.styleId, { ...state.dims, t: state.t, bleed: state.bleed, params: state.params, wrap: state.mat.structure === 'rigid', turnIn: state.mat.turnIn ?? 15, faceT: state.faceT, dimMode: state.dimMode });
  } catch (e) { console.error(e); toast('参数无效：' + e.message); return; }
  if (!geo.faces.find((f) => f.id === state.selectedFace)) state.selectedFace = geo.faces[0]?.id || null;
  render2D({ fit: refit });
  view3d.setGeometry(geo, state, { refit });
  view3d.setFold(+$('#fold').value, +$('#open').value);
  renderStruct(); renderArtPanel();
  const st = geo.style; const tag = state.dimMode === 'inner' ? '内尺寸' : '外尺寸'; $('#curStyle').textContent = `${st.name}　|　${tag} ${fmtDims()} mm　|　${materialShort(state.mat, state.t)}`;
  document.querySelectorAll('.card').forEach((c) => c.classList.toggle('on', c.dataset.id === state.styleId));
}
const fmtDims = () => { const d = STYLE_MAP[state.styleId].dims; return ['L', 'W', 'H'].filter((k) => d[k]).map((k) => state.dims[k]).join(' × '); };
const matName = () => MATERIALS.find((m) => m.id === state.materialId)?.name || '自定义';

// ---------------- style library ----------------
function thumbSVG(style) {
  try {
    const g = buildGeometry(style.id, { ...style.defaults, t: 0.5, bleed: 0.01 });
    const b = g.bbox; const pad = Math.max(b.w, b.h) * 0.04;
    const d = (ls) => ls.map((l) => 'M' + l.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L')).join('');
    return `<svg viewBox="${b.x - pad} ${b.y - pad} ${b.w + 2 * pad} ${b.h + 2 * pad}" preserveAspectRatio="xMidYMid meet"><path d="${d(g.cut)}" fill="none" stroke="#2f3640" stroke-width="1.2" vector-effect="non-scaling-stroke"/><path d="${d(g.crease)}" fill="none" stroke="#11a04a" stroke-width="0.9" stroke-dasharray="3 2" vector-effect="non-scaling-stroke"/></svg>`;
  } catch (e) { console.error(style.id, e); return '<svg></svg>'; }
}
const thumbs = {};
function renderLibrary(filter = '') {
  const q = filter.trim().toLowerCase(); let html = '';
  for (const cat of CATEGORIES) {
    const list = STYLES.filter((s) => s.category === cat.id && (!q || (s.name + s.en + s.desc).toLowerCase().includes(q)));
    if (!list.length) continue;
    html += `<div class="cat"><h4>${cat.name}</h4><div class="grid">`;
    for (const s of list) { thumbs[s.id] ||= thumbSVG(s); html += `<div class="card ${s.id === state.styleId ? 'on' : ''}" data-id="${s.id}" title="${s.en}：${s.desc}">${thumbs[s.id]}<span>${s.name}</span></div>`; }
    html += `</div></div>`;
  }
  $('#styleList').innerHTML = html || '<p class="desc">没有匹配的盒型</p>';
}
$('#styleList').addEventListener('click', (e) => { const c = e.target.closest('.card'); if (c) selectStyle(c.dataset.id); });
$('#search').addEventListener('input', (e) => renderLibrary(e.target.value));
function selectStyle(id) {
  const st = STYLE_MAP[id]; state.styleId = id; state.params = {};
  if (!state.dimsTouched) state.dims = { ...st.defaults };
  if (!state.materialTouched) { state.mat = defaultMaterialFor(id); syncMaterial(); }
  rebuild({ refit: true });
}

// ---------------- structure panel ----------------
function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : null; }
function tip(label, hint) { return hint ? `<span class="tip" title="${escAttr(hint)}">${label}</span>` : label; }
function escAttr(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function gsmPicks(id, values, current) {
  const known = values.includes(+current);
  let h = `<div class="gsm-picks" data-gsm-group="${id}">`;
  for (const g of values) h += `<button type="button" class="gsm ${+current === g ? 'on' : ''}" data-gsm-group="${id}" data-gsm="${g}">${g}g</button>`;
  h += `<label class="gsm-custom">其他<input type="number" data-gsm-custom="${id}" min="50" max="3000" step="1" value="${known ? '' : current}" placeholder="克重"/></label></div>`;
  return h;
}
function paramBlock(params, advanced) {
  const fullLid = geo.style.id === 'lidbase' && geo.ctx.p.lidType === 'full';
  const list = params.filter((p) => advanced === ADVANCED_PARAMS.has(p.key) && p.type !== 'choice' && !(fullLid && p.key === 'lidH'));
  if (!list.length) return '';
  let h = '';
  const c = geo.ctx;
  for (const p of list) {
    const auto = state.params[p.key] === undefined || state.params[p.key] === null;
    const lab = tip(p.label, p.hint);
    if (p.type === 'bool') h += `<div class="row"><label>${lab}</label><label><input type="checkbox" data-param="${p.key}" ${c.p[p.key] ? 'checked' : ''}/> 启用</label></div>`;
    else h += `<div class="row"><label>${lab}</label><input type="number" step="0.5" data-param="${p.key}" placeholder="自动 ${(+p.def(c)).toFixed(1)}" value="${auto ? '' : state.params[p.key]}"/></div>`;
  }
  return h;
}
function renderStruct() {
  const st = geo.style, c = geo.ctx; const d = st.dims; const mat = state.mat;
  let h = `<div class="sec"><h3>${st.name}</h3><p class="desc">${st.desc}</p></div>`;
  h += `<div class="sec"><h3>盒子尺寸 (mm) <button class="small" id="useDefaults" title="恢复该盒型推荐尺寸">推荐尺寸</button></h3>`;
  if (state.dimMode === 'inner') {
    h += `<p class="desc">当前按<strong>内尺寸</strong>填写（产品放进去的空间）。可在下方高级设置改回外尺寸。</p>`;
  } else {
    h += `<p class="desc">这里填盒子外面量到的尺寸（<strong>外尺寸</strong>），工具会按板厚算出里面能放多大的产品。</p>`;
  }
  h += `<div class="dims3">`;
  for (const k of ['L', 'W', 'H']) if (d[k]) h += `<div><span>${d[k]}</span><input type="number" step="0.5" min="1" data-dim="${k}" value="${state.dims[k]}"/></div>`;
  h += `</div>`;
  const inner = c.inner || { L: c.L, W: c.W, H: c.H };
  const outer = c.outer || { L: c.L + 2 * c.t, W: c.W + 2 * c.t, H: c.H + 2 * c.t };
  const keys = ['L', 'W', 'H'].filter((k) => d[k]);
  if (state.dimMode === 'outer') h += `<p class="desc" style="margin-top:8px">里面大约能放 <b>${fmtSize(inner, keys)}</b> mm 的产品。</p>`;
  else h += `<p class="desc" style="margin-top:8px">成品外面大约 <b>${fmtSize(outer, keys)}</b> mm。</p>`;
  h += `</div>`;

  h += `<div class="sec" id="materialSec"><h3>用料</h3><div class="summary">${materialSummary(mat, state.t)}</div>`;
  h += `<div class="field"><span class="lbl">盒子做法</span><div class="struct-opts">`;
  for (const s of STRUCTURES) h += `<label class="${mat.structure === s.id ? 'on' : ''}"><input type="radio" name="structure" id="struct-${s.id}" value="${s.id}" ${mat.structure === s.id ? 'checked' : ''} hidden/><span class="nm">${s.name}</span><span class="hp">${s.hint}</span></label>`;
  h += `</div></div>`;
  if (mat.structure === 'carton') {
    h += `<div class="field"><span class="lbl">${tip('纸的种类', '折叠彩盒一般用白卡纸；如果客户指定铜版纸或特种纸，这里改一下即可。')}</span><div class="chips" id="faceKindCarton">`;
    for (const k of FACE_KINDS) h += `<span class="chip ${mat.faceKind === k.id ? 'on' : ''}" data-face-kind="${k.id}" title="${escAttr(k.hint)}">${k.name}</span>`;
    h += `</div></div>`;
    if (mat.faceKind === 'special') {
      h += `<div class="field"><span class="lbl">特种纸种类</span><div class="chips" id="specialType">`;
      for (const k of SPECIAL_TYPES) h += `<span class="chip ${mat.specialType === k.id ? 'on' : ''}" data-special="${k.id}" title="${escAttr(k.hint)}">${k.name}</span>`;
      h += `</div></div>`;
    }
    h += `<div class="field"><span class="lbl">${tip('克重', '纸张的重量，数字越大纸越厚。常见彩盒用 300g 或 350g。')}</span>${gsmPicks('boardGsm', BOARD_GSM, mat.boardGsm)}</div>`;
  } else if (mat.structure === 'rigid') {
    h += `<div class="field"><span class="lbl">${tip('灰板克重', '礼盒骨架用的灰板。常用 1000g、1200g、1400g，数字越大板越厚越结实。')}</span>${gsmPicks('boardGsm', GREY_GSM, mat.boardGsm)}</div>`;
    h += `<div class="field"><span class="lbl">${tip('外面裱的纸', '贴在灰板外面、用来印刷图案的那一层纸。')}</span><div class="chips" id="faceKindRigid">`;
    for (const k of FACE_KINDS.filter((x) => x.id !== 'board')) h += `<span class="chip ${mat.faceKind === k.id ? 'on' : ''}" data-face-kind="${k.id}" title="${escAttr(k.hint)}">${k.name}</span>`;
    h += `</div></div>`;
    if (mat.faceKind === 'special') {
      h += `<div class="field"><span class="lbl">特种纸种类</span><div class="chips" id="specialType">`;
      for (const k of SPECIAL_TYPES) h += `<span class="chip ${mat.specialType === k.id ? 'on' : ''}" data-special="${k.id}" title="${escAttr(k.hint)}">${k.name}</span>`;
      h += `</div></div>`;
    }
    h += `<div class="field"><span class="lbl">${tip('裱纸克重', '面纸的重量。铜版纸常用 157g 或 200g。')}</span>${gsmPicks('faceGsm', COATED_GSM, mat.faceGsm)}</div>`;
  } else {
    h += `<div class="field"><span class="lbl">${tip('瓦楞粗细', '中间波浪芯的规格。细瓦更适合印刷，中瓦、双瓦更抗压。')}</span><div class="struct-opts">`;
    for (const fl of FLUTES) h += `<label class="${mat.flute === fl.id ? 'on' : ''}"><input type="radio" name="flute" value="${fl.id}" ${mat.flute === fl.id ? 'checked' : ''} hidden/><span class="nm">${fl.name}</span><span class="hp">${fl.hint}</span></label>`;
    h += `</div></div>`;
  }
  h += `</div>`;

  if (st.id === 'lidbase') {
    const typ = c.p.lidType === 'full' ? 'full' : 'half';
    h += `<div class="sec"><h3>盖型</h3><div class="struct-opts">`;
    h += `<label class="${typ === 'half' ? 'on' : ''}"><input type="radio" name="lidType" value="half" ${typ === 'half' ? 'checked' : ''} hidden/><span class="nm">鞋盒式（半盖）</span><span class="hp">盖只盖住一部分高度，像鞋盒那样，默认大约盖到整盒高度的三分之一，也可以自己改盖高。</span></label>`;
    h += `<label class="${typ === 'full' ? 'on' : ''}"><input type="radio" name="lidType" value="full" ${typ === 'full' ? 'checked' : ''} hidden/><span class="nm">全盖（天盖盖到底）</span><span class="hp">盖子和整盒一样高，一直盖到盒底；底盒会略小一点，刚好套进盖里。外尺寸按盒盖外面算。</span></label>`;
    h += `</div></div>`;
  }
  const vis = paramBlock(st.params, false);
  if (vis) h += `<div class="sec"><h3>这个盒子还可以调</h3>${vis}</div>`;

  h += `<div class="sec"><h3>${tip('包装工艺', '印完之后再做的表面效果，比如烫金、局部发亮、压出凹凸。给供应商报价时会单独出这些层。')}</h3>`;
  h += `<div class="field"><span class="lbl">整盒覆膜</span><div class="chips" id="lamination">`;
  for (const l of LAMINATION) h += `<span class="chip ${state.lamination === l.id ? 'on' : ''}" data-lam="${l.id}" title="${escAttr(l.hint)}">${l.name}</span>`;
  h += `</div></div>`;
  h += `<p class="desc">局部工艺可以加在已经放好的 Logo / 文字上，也可以在盒面上自己画一块区域。</p>`;
  h += `<div class="btns"><button class="small" id="btnDrawFinish">${state.drawFinish ? '正在画区域…再点取消' : '在盒面上画一块区域'}</button></div>`;
  if (state.finishRegions.length) {
    h += `<div style="margin-top:8px">`;
    for (const r of state.finishRegions) {
      const names = (r.processes || []).map((id) => PROCESS_MAP[id]?.name || id).join('、') || '还未选工艺';
      const where = r.type === 'el' ? `图稿 ${(state.elements.find((e) => e.id === r.elementId)?.name || state.elements.find((e) => e.id === r.elementId)?.text || r.elementId)}` : `${FACE_NAMES[r.face] || r.face} 上的一块区域`;
      h += `<div class="fin ${r.id === state.selectedFinish ? 'on' : ''}" data-finish="${r.id}"><div class="head"><span class="nm">${where}</span><button class="small" data-del-finish="${r.id}">✕</button></div><div class="meta">${names}</div></div>`;
    }
    h += `</div>`;
  }
  const target = state.selectedFinish ? state.finishRegions.find((r) => r.id === state.selectedFinish)
    : (state.selected ? (state.finishRegions.find((r) => r.type === 'el' && r.elementId === state.selected) || { processes: [] }) : null);
  if (state.selected || state.selectedFinish) {
    const procs = target?.processes || [];
    h += `<div class="field" style="margin-top:8px"><span class="lbl">${state.selectedFinish ? '这块区域要做的工艺（可多选）' : '给当前选中的图稿做的工艺（可多选）'}</span><div class="proc-grid">`;
    for (const p of PROCESSES) h += `<label class="${procs.includes(p.id) ? 'on' : ''}" style="color:${p.color}" title="${escAttr(p.hint)}"><input type="checkbox" data-proc="${p.id}" ${procs.includes(p.id) ? 'checked' : ''}/> ${p.name}</label>`;
    h += `</div></div>`;
  }
  h += `</div>`;

  const adv = paramBlock(st.params, true);
  h += `<div class="sec"><details class="advanced"><summary>高级设置（一般不用改）</summary>`;
  h += `<div class="field"><span class="lbl">${tip('尺寸怎么填', '默认按盒子外面量到的尺寸。如果要按产品放进去的尺寸来填，选内尺寸。')}</span><div class="chips">`;
  h += `<span class="chip ${state.dimMode === 'outer' ? 'on' : ''}" data-dim-mode="outer">外尺寸</span>`;
  h += `<span class="chip ${state.dimMode === 'inner' ? 'on' : ''}" data-dim-mode="inner">内尺寸</span>`;
  h += `</div></div>`;
  h += `<div class="row"><label>${tip('多印边', '图案多印出来的边，防止切开时切歪了露出白边。一般 3mm 即可。')}</label><input type="number" id="bleed" step="0.5" min="0" max="10" value="${state.bleed}"/></div>`;
  if (mat.structure === 'rigid') h += `<div class="row"><label>${tip('裱纸包边', '面纸折进盒子里面的宽度，礼盒常用 15mm。')}</label><input type="number" id="turnIn" step="0.5" min="8" max="30" value="${mat.turnIn ?? 15}"/></div>`;
  h += `<div class="row"><label>${tip('手动指定板厚', '一般不用填。只有你已经量过实际厚度、想覆盖按克重估算的值时才改。')}</label><input type="number" id="thick" step="0.05" min="0" max="8" placeholder="自动 ${state.t.toFixed(2)}" value="${mat.tOverride ?? ''}"/></div>`;
  if (adv) { h += `<p class="desc" style="margin-top:8px">下面这些结构尺寸会按纸厚自动算，留空即可。</p>${adv}<div class="btns"><button class="small" id="resetParams">全部自动</button></div>`; }
  h += `</details></div>`;

  const tt = state.t, bb = geo.bbox, bl = geo.bboxBleed;
  const ikeys = ['L', 'W', 'H'].filter((k) => d[k]);
  h += `<div class="sec"><h3>算出来的尺寸</h3><div class="info">`;
  h += `外尺寸 <b>${fmtSize(c.outer || { L: c.L + 2 * tt, W: c.W + 2 * tt, H: c.H + 2 * tt }, ikeys)}</b> mm<br/>`;
  h += `内尺寸（里面能放的产品） <b>${fmtSize(c.inner || { L: c.L, W: c.W, H: c.H }, ikeys)}</b> mm<br/>`;
  h += `刀版展开 <b>${bb.w.toFixed(1)} × ${bb.h.toFixed(1)}</b> mm<br/>算上多印边 <b>${bl.w.toFixed(1)} × ${bl.h.toFixed(1)}</b> mm<br/>`;
  const cutLen = geo.cut.reduce((s, l) => s + l.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - l[i][0], p[1] - l[i][1]), 0), 0);
  const crLen = geo.crease.reduce((s, l) => s + Math.hypot(l[1][0] - l[0][0], l[1][1] - l[0][1]), 0);
  h += `切开的线大约 <b>${(cutLen / 1000).toFixed(2)} m</b>，折的线 <b>${(crLen / 1000).toFixed(2)} m</b></div>`;
  for (const n of geo.notes) h += `<div class="note">${n}</div>`;
  h += `</div>`;
  $('#tabStruct').innerHTML = h;
  $('#svg2d').classList.toggle('draw-finish', !!state.drawFinish);
}
let dimTimer;
function applyMatChange() { state.mat.tOverride = null; state.materialTouched = true; syncMaterial(); rebuild(); }
function switchDimMode(next) {
  if (!next || next === state.dimMode) return;
  const st = STYLE_MAP[state.styleId];
  const keys = ['L', 'W', 'H'].filter((k) => st.dims[k]);
  const cur = geo?.ctx;
  if (cur?.inner && cur?.outer) {
    const src = next === 'inner' ? cur.inner : cur.outer;
    for (const k of keys) if (src[k] != null) state.dims[k] = Math.round(src[k] * 10) / 10;
  }
  state.dimMode = next;
  rebuild({ refit: true });
}
$('#tabStruct').addEventListener('input', (e) => {
  const el = e.target;
  clearTimeout(dimTimer);
  dimTimer = setTimeout(() => {
    if (el.dataset.dim) { const v = num(el.value); if (v && v > 0) { state.dims[el.dataset.dim] = v; state.dimsTouched = true; rebuild({ refit: true }); } }
    else if (el.id === 'thick') { const v = el.value === '' ? null : num(el.value); state.mat.tOverride = (v && v > 0) ? v : null; state.materialTouched = true; syncMaterial(); rebuild(); }
    else if (el.id === 'bleed') { const v = num(el.value); if (v !== null && v >= 0) { state.bleed = v; rebuild(); } }
    else if (el.id === 'turnIn') { const v = num(el.value); if (v && v > 0) { state.mat.turnIn = v; state.materialTouched = true; rebuild(); } }
    else if (el.dataset.gsmCustom) { const v = num(el.value); if (v && v > 0) { state.mat[el.dataset.gsmCustom] = v; applyMatChange(); } }
    else if (el.dataset.param) { const k = el.dataset.param; if (el.type === 'checkbox') state.params[k] = el.checked; else state.params[k] = el.value === '' ? null : num(el.value); rebuild(); }
    else if (el.dataset.proc) { toggleProcess(el.dataset.proc, el.checked); }
  }, el.type === 'checkbox' ? 0 : 350);
});
$('#tabStruct').addEventListener('change', (e) => {
  const el = e.target;
  if (el.name === 'structure') {
    const next = defaultMaterialFor(el.value === 'rigid' ? 'lidbase' : el.value === 'corrugated' ? 'mailer' : 'ste');
    next.structure = el.value;
    if (el.value === 'carton' && state.mat.faceKind) { next.faceKind = state.mat.faceKind; next.specialType = state.mat.specialType; next.boardGsm = state.mat.structure === 'carton' ? state.mat.boardGsm : 350; }
    if (el.value === 'rigid') { next.boardGsm = 1200; next.faceKind = state.mat.faceKind === 'board' ? 'coated' : (state.mat.faceKind || 'coated'); next.faceGsm = state.mat.faceGsm || 157; next.specialType = state.mat.specialType; }
    state.mat = next; applyMatChange();
  }
  if (el.name === 'flute') { state.mat.flute = el.value; applyMatChange(); }
  if (el.name === 'lidType') { state.params.lidType = el.value; if (el.value === 'full') delete state.params.lidH; rebuild({ refit: true }); }
});
$('#tabStruct').addEventListener('click', (e) => {
  const gsmBtn = e.target.closest('button.gsm');
  if (gsmBtn) { state.mat[gsmBtn.dataset.gsmGroup] = +gsmBtn.dataset.gsm; applyMatChange(); return; }
  const faceKind = e.target.closest('[data-face-kind]');
  if (faceKind) { state.mat.faceKind = faceKind.dataset.faceKind; if (state.mat.structure === 'carton') state.mat.faceGsm = state.mat.boardGsm; applyMatChange(); return; }
  const sp = e.target.closest('[data-special]');
  if (sp) { state.mat.specialType = sp.dataset.special; applyMatChange(); return; }
  const dmode = e.target.closest('[data-dim-mode]');
  if (dmode) { switchDimMode(dmode.dataset.dimMode); return; }
  const lam = e.target.closest('[data-lam]');
  if (lam) { state.lamination = lam.dataset.lam; scheduleTexture(); render2D(); renderStruct(); return; }
  const fin = e.target.closest('[data-finish]');
  if (fin && !e.target.dataset.delFinish) { state.selectedFinish = fin.dataset.finish; state.selected = null; renderStruct(); renderArtPanel(); render2D(); return; }
  if (e.target.dataset.delFinish) { state.finishRegions = state.finishRegions.filter((r) => r.id !== e.target.dataset.delFinish); if (state.selectedFinish === e.target.dataset.delFinish) state.selectedFinish = null; renderStruct(); render2D(); scheduleTexture(); return; }
  if (e.target.id === 'btnDrawFinish') { state.drawFinish = !state.drawFinish; $('#svg2d').classList.toggle('draw-finish', state.drawFinish); if (state.drawFinish) toast('在左边刀版图的某个面上拖出一块矩形'); renderStruct(); return; }
  if (e.target.id === 'resetParams') { state.params = {}; rebuild(); }
  if (e.target.id === 'useDefaults') { state.dims = { ...STYLE_MAP[state.styleId].defaults }; state.dimsTouched = false; rebuild({ refit: true }); }
});

function ensureFinishForSelection() {
  if (state.selectedFinish) return state.finishRegions.find((r) => r.id === state.selectedFinish);
  if (state.selected) {
    let r = state.finishRegions.find((x) => x.type === 'el' && x.elementId === state.selected);
    if (!r) { r = { id: 'f' + state.finishUid++, type: 'el', elementId: state.selected, processes: [] }; state.finishRegions.push(r); }
    return r;
  }
  return null;
}
function toggleProcess(id, on) {
  const r = ensureFinishForSelection(); if (!r) return;
  const set = new Set(r.processes || []);
  if (on) set.add(id); else set.delete(id);
  r.processes = [...set];
  if (!r.processes.length && r.type === 'el') state.finishRegions = state.finishRegions.filter((x) => x !== r);
  state.selectedFinish = r.processes.length || r.type === 'rect' ? r.id : state.selectedFinish;
  renderStruct(); renderArtPanel(); render2D(); scheduleTexture();
}

// ---------------- artwork panel ----------------
const faceInfo = (id) => geo.faces.find((f) => f.id === id);
function renderArtPanel() {
  let h = `<div class="sec"><h3>整体颜色</h3><div class="row"><label>盒子底色</label><div class="colorrow"><input type="color" id="boxColor" value="${state.boxColor}"/><span class="hint">印刷面整体底色</span></div></div>`;
  h += `<div class="row"><label>纸板内面色</label><div class="colorrow"><input type="color" id="boardColor" value="${state.boardColor}"/><span class="hint">3D 中盒子内侧</span></div></div>`;
  h += `<div class="btns"><button class="small" id="demoArt">一键示例图稿</button><button class="small" id="clearArt">清空图稿</button></div></div>`;
  h += `<div class="sec"><h3>选择面</h3><div class="chips">`;
  for (const f of geo.faces) h += `<span class="chip ${f.id === state.selectedFace ? 'on' : ''}" data-face="${f.id}"><span class="dot" style="background:${state.faceColors[f.id] || state.boxColor}"></span>${FACE_NAMES[f.id] || f.id}</span>`;
  h += `</div><p class="desc" style="margin-top:6px">也可以在左侧刀版图上直接点击某个面。</p></div>`;
  const f = faceInfo(state.selectedFace);
  if (f) {
    h += `<div class="sec"><h3>${FACE_NAMES[f.id]}（${f.w.toFixed(1)} × ${f.h.toFixed(1)} mm）</h3>`;
    h += `<div class="row"><label>面底色</label><div class="colorrow"><input type="color" id="faceColor" value="${state.faceColors[f.id] || state.boxColor}"/><button class="small" id="faceColorClear">跟随整体</button></div></div>`;
    h += `<div class="btns"><label class="btn small">＋ 图片 / Logo<input type="file" id="addImage" accept="image/*" multiple hidden/></label><button class="small" id="addText">＋ 文字</button></div></div>`;
    const els = state.elements.filter((e) => e.face === f.id);
    h += `<div class="sec"><h3>此面图层（${els.length}）</h3>`;
    for (const el of els) {
      const on = el.id === state.selected;
      h += `<div class="el ${on ? 'on' : ''}" data-id="${el.id}"><div class="head">${el.type === 'image' ? `<img src="${el.src}"/>` : '<b style="width:34px;text-align:center">T</b>'}<span class="nm">${el.type === 'image' ? el.name || '图片' : el.text}</span>`;
      h += `<button class="small" data-act="up" title="上移一层">↑</button><button class="small" data-act="down" title="下移一层">↓</button><button class="small" data-act="del" title="删除">✕</button></div>`;
      if (on) {
        const rng = (k, label, min, max, step) => `<div class="row"><label>${label}</label><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${el[k]}"/><input type="number" data-k="${k}" step="${step}" value="${(+el[k]).toFixed(1)}"/></div>`;
        const lim = Math.max(f.w, f.h);
        h += rng('x', 'X', -lim, lim, 0.5) + rng('y', 'Y', -lim, lim, 0.5);
        if (el.type === 'image') h += rng('w', '宽度', 2, lim * 2, 0.5); else h += rng('size', '字号', 1, lim / 2, 0.5);
        h += rng('rot', '旋转°', -180, 180, 1);
        if (el.type === 'text') h += `<div class="row"><label>内容</label><textarea data-k="text" rows="2" style="grid-column: span 2">${el.text}</textarea></div><div class="row"><label>颜色</label><input type="color" data-k="color" value="${el.color}"/><label><input type="checkbox" data-k="bold" ${el.bold ? 'checked' : ''}/>粗</label></div>`;
        h += `<div class="btns"><button class="small" data-act="center">居中</button>${el.type === 'image' ? '<button class="small" data-act="fill">铺满此面(含多印边)</button><button class="small" data-act="fit">适应此面</button>' : ''}<button class="small" data-act="rot90">旋转 90°</button><button class="small" data-act="dup">复制到…</button></div>`;
        const procs = (state.finishRegions.find((r) => r.type === 'el' && r.elementId === el.id) || { processes: [] }).processes || [];
        h += `<div class="field" style="margin-top:8px"><span class="lbl">这块图稿要做的工艺（可多选）</span><div class="proc-grid">`;
        for (const p of PROCESSES) h += `<label class="${procs.includes(p.id) ? 'on' : ''}" style="color:${p.color}" title="${p.hint.replace(/"/g, '&quot;')}"><input type="checkbox" data-proc="${p.id}" ${procs.includes(p.id) ? 'checked' : ''}/> ${p.name}</label>`;
        h += `</div></div>`;
      }
      h += `</div>`;
    }
    if (!els.length) h += `<p class="desc">此面还没有图稿。上传客户 Logo、产品图或整面设计稿，可拖动、缩放、旋转。</p>`;
    h += `</div>`;
  }
  $('#tabArt').innerHTML = h;
}
const artChanged = () => { render2D(); scheduleTexture(); };
function addImageFromDataURL(src, name, face = state.selectedFace, opts = {}) {
  const im = new Image();
  im.onload = () => {
    imageCache.set(src, im);
    const f = faceInfo(face); const ratio = im.naturalHeight / im.naturalWidth;
    let w = f.w * 0.6; if (w * ratio > f.h * 0.6) w = (f.h * 0.6) / ratio;
    const el = { id: 'e' + uid++, type: 'image', face, src, name, ratio, x: 0, y: 0, w, rot: 0, ...opts };
    state.elements.push(el); state.selected = el.id; renderArtPanel(); artChanged();
  };
  im.src = src;
}
$('#tabArt').addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'addImage') {
    for (const file of t.files) { const r = new FileReader(); r.onload = () => addImageFromDataURL(r.result, file.name); r.readAsDataURL(file); }
    t.value = '';
  }
});
$('#tabArt').addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.proc) { if (t.closest('.el')) state.selected = t.closest('.el').dataset.id; toggleProcess(t.dataset.proc, t.checked); return; }
  if (t.id === 'boxColor') { state.boxColor = t.value; artChanged(); return; }
  if (t.id === 'boardColor') { state.boardColor = t.value; scheduleTexture(); return; }
  if (t.id === 'faceColor') { state.faceColors[state.selectedFace] = t.value; artChanged(); const dot = document.querySelector(`.chip[data-face="${state.selectedFace}"] .dot`); if (dot) dot.style.background = t.value; return; }
  const box = t.closest('.el'); if (!box || !t.dataset.k) return;
  const el = state.elements.find((q) => q.id === box.dataset.id); const k = t.dataset.k;
  if (t.type === 'checkbox') el[k] = t.checked; else if (k === 'text' || k === 'color') el[k] = t.value; else { const v = num(t.value); if (v === null) return; el[k] = v; box.querySelectorAll(`[data-k="${k}"]`).forEach((n) => n !== t && (n.value = n.type === 'number' ? v.toFixed(1) : v)); }
  artChanged();
});
$('#tabArt').addEventListener('click', (e) => {
  const t = e.target;
  if (t.dataset.proc) { if (t.closest('.el')) state.selected = t.closest('.el').dataset.id; toggleProcess(t.dataset.proc, t.checked); return; }
  const chip = t.closest('.chip'); if (chip) { state.selectedFace = chip.dataset.face; state.selected = null; renderArtPanel(); render2D(); return; }
  if (t.id === 'faceColorClear') { delete state.faceColors[state.selectedFace]; renderArtPanel(); artChanged(); return; }
  if (t.id === 'addText') { const f = faceInfo(state.selectedFace); const el = { id: 'e' + uid++, type: 'text', face: f.id, text: '品牌名称', size: Math.max(3, Math.min(30, f.w * 0.12)), color: '#1f2329', bold: true, x: 0, y: 0, rot: 0 }; state.elements.push(el); state.selected = el.id; renderArtPanel(); artChanged(); return; }
  if (t.id === 'demoArt') { demoArtwork(); return; }
  if (t.id === 'clearArt') { state.elements = []; state.faceColors = {}; state.selected = null; renderArtPanel(); artChanged(); return; }
  const box = t.closest('.el'); if (!box) return;
  const idx = state.elements.findIndex((q) => q.id === box.dataset.id); const el = state.elements[idx];
  const act = t.dataset.act;
  if (!act) { if (t.closest('.head')) { state.selected = state.selected === el.id ? null : el.id; renderArtPanel(); render2D(); } return; }
  const f = faceInfo(el.face);
  if (act === 'del') { state.elements.splice(idx, 1); state.selected = null; }
  if (act === 'up' && idx < state.elements.length - 1) [state.elements[idx], state.elements[idx + 1]] = [state.elements[idx + 1], state.elements[idx]];
  if (act === 'down' && idx > 0) [state.elements[idx], state.elements[idx - 1]] = [state.elements[idx - 1], state.elements[idx]];
  if (act === 'center') { el.x = 0; el.y = 0; }
  if (act === 'rot90') el.rot = ((el.rot + 90 + 180) % 360) - 180;
  if (act === 'fill' || act === 'fit') { const r = el.ratio || 1; const b = act === 'fill' ? 2 * state.bleed : 0; el.x = 0; el.y = 0; el.rot = 0; el.w = act === 'fill' ? Math.max(f.w + b, (f.h + b) / r) : Math.min(f.w, f.h / r); }
  if (act === 'dup') {
    const names = geo.faces.filter((q) => q.id !== el.face).map((q) => `${q.id}=${FACE_NAMES[q.id]}`).join('  ');
    const target = prompt('复制到哪个面？输入面代号（多个用逗号分隔，all = 全部）：\n' + names, 'all'); if (!target) return;
    const ids = target.trim() === 'all' ? geo.faces.map((q) => q.id).filter((q) => q !== el.face) : target.split(/[,，\s]+/);
    for (const id of ids) if (faceInfo(id)) state.elements.push({ ...el, id: 'e' + uid++, face: id });
  }
  renderArtPanel(); artChanged();
});

// demo artwork: brand-colour background, logo badge and product name on each visible face
function makeLogo(text = 'BRAND', color = '#1f6feb') {
  const c = document.createElement('canvas'); c.width = 600; c.height = 600; const x = c.getContext('2d');
  x.fillStyle = color; x.beginPath(); x.arc(300, 300, 280, 0, Math.PI * 2); x.fill();
  x.strokeStyle = '#fff'; x.lineWidth = 18; x.beginPath(); x.arc(300, 300, 230, 0, Math.PI * 2); x.stroke();
  x.fillStyle = '#fff'; x.font = 'bold 120px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 300, 300);
  return c.toDataURL('image/png');
}
function demoArtwork() {
  state.boxColor = '#eaf4ff'; state.faceColors = { front: '#0f4c9c' };
  state.elements = state.elements.filter(() => false);
  const logo = makeLogo('BC', '#ff7a1a');
  const fronts = geo.faces.map((f) => f.id);
  const logoFaces = new Set(['front', 'top', 'header']);
  const logos = [];
  for (const fid of fronts) {
    const f = faceInfo(fid);
    const big = logoFaces.has(fid);
    const short = Math.min(f.w, f.h);
    const text = fid === 'front' ? 'BestClean\n声波电动牙刷' : 'BestClean';
    const lines = text.split('\n').length;
    const size = Math.max(2.5, short * (big ? 0.1 : 0.14));
    const textH = lines * size * 1.25;
    const rot = f.w < f.h && !big ? -90 : 0;
    let textY = 0, logoY = 0, logoW = 0;
    if (big) {
      logoW = Math.min(short * 0.28, f.h * 0.30, f.w * 0.32);
      const minGap = Math.max(4, short * 0.07);
      if (logoW + minGap + textH > f.h * 0.92) logoW = Math.max(8, f.h * 0.92 - minGap - textH);
      const packed = logoW + minGap + textH;
      if (f.h > packed * 1.6) {
        logoY = -Math.min(f.h * 0.20, f.h / 2 - logoW / 2 - 4);
        textY = Math.min(f.h * 0.18, f.h / 2 - textH / 2 - 4);
      }
      if (!(f.h > packed * 1.6) || textY - textH / 2 - (logoY + logoW / 2) < minGap) {
        logoY = -packed / 2 + logoW / 2;
        textY = packed / 2 - textH / 2;
      }
    }
    state.elements.push({ id: 'e' + uid++, type: 'text', face: fid, text, size, color: fid === 'front' ? '#ffffff' : '#0f4c9c', bold: true, x: 0, y: textY, rot });
    if (big) logos.push({ fid, logoW, logoY });
  }
  const im = new Image(); im.onload = () => {
    imageCache.set(logo, im);
    for (const { fid, logoW, logoY } of logos) state.elements.push({ id: 'e' + uid++, type: 'image', face: fid, src: logo, name: 'logo.png', ratio: 1, x: 0, y: logoY, w: logoW, rot: 0 });
    renderArtPanel(); artChanged();
  };
  im.src = logo; renderArtPanel(); artChanged();
}

// ---------------- tabs, view mode, layers, 3D controls ----------------
function switchTab(tab) { document.querySelectorAll('#propTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab)); $('#tabStruct').hidden = tab !== 'struct'; $('#tabArt').hidden = tab !== 'art'; }
$('#propTabs').addEventListener('click', (e) => e.target.dataset.tab && switchTab(e.target.dataset.tab));
$('#viewMode').addEventListener('click', (e) => { const m = e.target.dataset.mode; if (!m) return; document.querySelectorAll('#viewMode button').forEach((b) => b.classList.toggle('on', b === e.target)); $('#views').className = m === 'split' ? 'split' : 'm' + m; setTimeout(() => view2d.fitView(), 30); });
const LAYER_NAMES = { art: '图稿', cut: '刀线', crease: '压痕线', bleed: '多印边', glue: '涂胶位置', dims: '尺寸', labels: '面标注', finish: '工艺', magnet: '磁铁位置' };
$('#layerToggles').innerHTML = Object.entries(LAYER_NAMES).map(([k, n]) => `<label><input type="checkbox" data-layer="${k}" checked/>${n}</label>`).join('');
$('#layerToggles').addEventListener('change', (e) => { state.layers[e.target.dataset.layer] = e.target.checked; render2D(); });
$('#zoomFit').onclick = () => view2d.fitView(); $('#zoomIn').onclick = () => view2d.zoom(1 / 1.25); $('#zoomOut').onclick = () => view2d.zoom(1.25);
$('#fold').addEventListener('input', () => view3d.setFold(+$('#fold').value, +$('#open').value));
$('#open').addEventListener('input', () => view3d.setFold(+$('#fold').value, +$('#open').value));
$('#playFold').onclick = () => view3d.playFold((v) => ($('#fold').value = v));
$('#resetView').onclick = () => view3d.resetView();

// ---------------- export / project ----------------
const baseName = () => `${geo.style.id}_${fmtDims().replace(/ × /g, 'x')}mm`;
function download(name, data, type) { const blob = data instanceof Blob ? data : new Blob([data], { type }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
const dataURLtoBytes = (u) => { const b = atob(u.split(',')[1]); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; };
function processLayers() {
  const by = regionsByProcess(state, geo);
  return usedProcesses(state).map((p) => ({ id: p.id, name: p.name, pdfSpot: p.pdfSpot, color: p.color, cmyk: p.cmyk, polys: (by[p.id] || []).map((x) => x.poly) })).filter((p) => p.polys.length);
}
function infoLines() {
  const c = geo.ctx;
  const lines = quoteInfoLines({
    style: geo.style, dims: state.dims, mat: state.mat, t: state.t, faceT: state.faceT,
    bleed: state.bleed, bbox: geo.bbox, bboxBleed: geo.bboxBleed,
    lamination: state.lamination, finishRegions: state.finishRegions,
    outer: c.outer, inner: c.inner, lidType: c.p?.lidType,
  });
  const day = new Date();
  const local = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  lines.push(`生成日期 ${local}（当地时间） · 包装刀版设计工具`);
  return lines;
}
function exportPDF() {
  const hasArt = true;
  const { canvas } = renderFlat(geo, state, { ppm: 300 / 25.4, maxPx: 6000, background: '#ffffff' });
  const jpg = canvas.toDataURL('image/jpeg', 0.9);
  const pdf = buildPDF(geo, { art: hasArt ? { bytes: dataURLtoBytes(jpg), w: canvas.width, h: canvas.height } : null, info: infoLines(), processLayers: processLayers() });
  download(baseName() + '_dieline.pdf', new Blob([pdf], { type: 'application/pdf' }));
  toast('已导出 PDF（含刀线、压痕和工艺专色图层，可供供应商报价）');
  return pdf;
}
$('#expPDF').onclick = exportPDF;
$('#expSVG').onclick = () => { const { canvas } = renderFlat(geo, state, { ppm: 6, maxPx: 4000 }); download(baseName() + '_dieline.svg', buildSVG(geo, { artDataUrl: canvas.toDataURL('image/png'), processLayers: processLayers() }), 'image/svg+xml'); };
$('#expDXF').onclick = () => download(baseName() + '_dieline.dxf', buildDXF(geo), 'application/dxf');
$('#expFlat').onclick = () => { const { canvas } = renderFlat(geo, state, { ppm: 8, maxPx: 6000, lines: true, background: '#ffffff' }); canvas.toBlob((b) => download(baseName() + '_flat.png', b)); };
$('#exp3D').onclick = () => download(baseName() + '_3d.png', new Blob([dataURLtoBytes(view3d.snapshot(2))], { type: 'image/png' }));
$('#btnSave').onclick = () => {
  const { styleId, dims, materialId, t, bleed, params, boxColor, boardColor, faceColors, elements, mat, lamination, finishRegions, faceT, dimMode } = state;
  download(baseName() + '.json', JSON.stringify({ app: 'dieline-studio', version: 3, styleId, dims, materialId, t, faceT, bleed, params, boxColor, boardColor, faceColors, elements, mat, lamination, finishRegions, dimMode }, null, 1), 'application/json');
};
$('#fileProject').addEventListener('change', (e) => {
  const file = e.target.files[0]; if (!file) return; const r = new FileReader();
  r.onload = () => { try { loadProject(JSON.parse(r.result)); toast('项目已打开'); } catch (err) { toast('无法读取项目文件：' + err.message); } };
  r.readAsText(file); e.target.value = '';
});
function loadProject(p) {
  if (p.app !== 'dieline-studio' || !STYLE_MAP[p.styleId]) throw new Error('不是有效的刀版项目');
  const mat = p.mat || materialFromLegacy(p.materialId, p.t);
  Object.assign(state, { styleId: p.styleId, dims: p.dims, mat, materialId: p.materialId, t: p.t, bleed: p.bleed ?? 3, params: p.params || {}, boxColor: p.boxColor, boardColor: p.boardColor, faceColors: p.faceColors || {}, elements: p.elements || [], selected: null, selectedFinish: null, lamination: p.lamination || 'none', finishRegions: p.finishRegions || [], dimsTouched: true, materialTouched: true, drawFinish: false, dimMode: p.dimMode || (p.version >= 3 ? 'outer' : 'inner') });
  syncMaterial();
  if (p.t != null && p.mat && p.mat.tOverride == null && Math.abs(state.t - p.t) > 0.02) { state.mat.tOverride = p.t; syncMaterial(); }
  uid = 1 + Math.max(0, ...state.elements.map((e) => parseInt(String(e.id).slice(1)) || 0));
  state.finishUid = 1 + Math.max(0, ...state.finishRegions.map((r) => parseInt(String(r.id).slice(1)) || 0));
  let pending = 0;
  for (const el of state.elements) if (el.type === 'image' && !imageCache.get(el.src)?.complete) { pending++; const im = new Image(); im.onload = () => { imageCache.set(el.src, im); if (--pending === 0) artChanged(); }; im.src = el.src; imageCache.set(el.src, im); }
  rebuild({ refit: true });
}
window.__app.loadProject = loadProject; window.__app.exportPDF = () => exportPDF(); window.__app.selectStyle = selectStyle; window.__app.demo = () => demoArtwork(); window.__app.rebuild = () => rebuild(); window.__app.refresh = () => { render2D(); scheduleTexture(); renderStruct(); renderArtPanel(); };
$('#btnNew').onclick = () => { if (confirm('清空当前图稿？（结构参数保留）')) { state.elements = []; state.faceColors = {}; state.boxColor = '#ffffff'; renderArtPanel(); artChanged(); } };

renderLibrary();
rebuild({ refit: true });
