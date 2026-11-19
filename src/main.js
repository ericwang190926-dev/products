import './style.css';
import { STYLES, STYLE_MAP, CATEGORIES } from './core/styles/index.js';
import { MATERIALS } from './core/styles/common.js';
import { buildGeometry } from './core/model.js';
import { FACE_NAMES } from './core/builder.js';
import { createView2D, elementSize } from './ui/view2d.js';
import { createView3D } from './ui/view3d.js';
import { renderFlat, imageCache } from './render/raster.js';
import { buildPDF } from './export/pdf.js';
import { buildSVG, buildDXF } from './export/vector.js';

const $ = (s) => document.querySelector(s);
const state = {
  styleId: 'hanger', dims: { ...STYLE_MAP.hanger.defaults }, materialId: 'card350', t: 0.5, bleed: 3, params: {},
  boxColor: '#ffffff', boardColor: '#f1ede4', faceColors: {}, elements: [], selected: null, selectedFace: 'front',
  layers: { art: true, cut: true, crease: true, bleed: true, glue: true, dims: true, labels: true },
  dimsTouched: false, materialTouched: false,
};
let geo = null; let uid = 1;
const toast = (msg) => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2200); };
window.__app = { state, get geo() { return geo; } };

const view2d = createView2D($('#svg2d'), {
  select: (id, face) => { state.selected = id; if (face) state.selectedFace = face; render2D(); renderArtPanel(); if (face && !id) switchTab('art'); },
  changed: () => { render2D(); scheduleTexture(); renderArtPanel(); },
  dragging: () => scheduleTexture(),
});
const view3d = createView3D($('#three'));
let texPending = false;
function scheduleTexture() { if (texPending) return; texPending = true; requestAnimationFrame(() => { texPending = false; view3d.updateTexture(state); }); }
function render2D(opts) { view2d.render(geo, state, opts); }

function rebuild({ refit = false } = {}) {
  try {
    geo = buildGeometry(state.styleId, { ...state.dims, t: state.t, bleed: state.bleed, params: state.params });
  } catch (e) { console.error(e); toast('参数无效：' + e.message); return; }
  if (!geo.faces.find((f) => f.id === state.selectedFace)) state.selectedFace = geo.faces[0]?.id || null;
  render2D({ fit: refit });
  view3d.setGeometry(geo, state, { refit });
  view3d.setFold(+$('#fold').value, +$('#open').value);
  renderStruct(); renderArtPanel();
  const st = geo.style; $('#curStyle').textContent = `${st.name} · ${st.en}　|　内尺寸 ${fmtDims()} mm　|　${matName()} ${state.t}mm`;
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
  if (!state.materialTouched) { const m = MATERIALS.find((x) => x.id === (st.material || 'card350')); state.materialId = m.id; state.t = m.t; }
  rebuild({ refit: true });
}

// ---------------- structure panel ----------------
function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : null; }
function renderStruct() {
  const st = geo.style, c = geo.ctx; const d = st.dims;
  let h = `<div class="sec"><h3>${st.name}</h3><p class="desc">${st.desc}</p></div>`;
  h += `<div class="sec"><h3>内尺寸 (mm) <button class="small" id="useDefaults" title="恢复该盒型推荐尺寸">推荐尺寸</button></h3><div class="dims3">`;
  for (const k of ['L', 'W', 'H']) if (d[k]) h += `<div><span>${d[k]}</span><input type="number" step="0.5" min="1" data-dim="${k}" value="${state.dims[k]}"/></div>`;
  h += `</div></div>`;
  h += `<div class="sec"><h3>材质 / 纸厚</h3><div class="row"><label>材质</label><select id="matSel">${MATERIALS.map((m) => `<option value="${m.id}" ${m.id === state.materialId ? 'selected' : ''}>${m.name}（${m.t}mm）</option>`).join('')}<option value="custom" ${state.materialId === 'custom' ? 'selected' : ''}>自定义</option></select></div>`;
  h += `<div class="row"><label>纸厚 t</label><input type="number" id="thick" step="0.05" min="0.1" max="8" value="${state.t}"/></div>`;
  h += `<div class="row"><label>出血</label><input type="number" id="bleed" step="0.5" min="0" max="10" value="${state.bleed}"/></div></div>`;
  if (st.params.length) {
    h += `<div class="sec"><h3>结构参数 <button class="small" id="resetParams">全部自动</button></h3>`;
    for (const p of st.params) {
      const auto = state.params[p.key] === undefined || state.params[p.key] === null;
      if (p.type === 'bool') h += `<div class="row"><label>${p.label}</label><label><input type="checkbox" data-param="${p.key}" ${c.p[p.key] ? 'checked' : ''}/> 启用</label></div>`;
      else h += `<div class="row"><label>${p.label}</label><input type="number" step="0.5" data-param="${p.key}" placeholder="自动 ${(+p.def(c)).toFixed(1)}" value="${auto ? '' : state.params[p.key]}"/></div>`;
    }
    h += `<p class="desc">留空 = 按尺寸与纸厚自动计算。</p></div>`;
  }
  const t = state.t, bb = geo.bbox, bl = geo.bboxBleed;
  h += `<div class="sec"><h3>尺寸信息</h3><div class="info">`;
  h += `面板尺寸(中性层) <b>${c.A.toFixed(1)} × ${c.B.toFixed(1)} × ${c.D.toFixed(1)}</b><br/>`;
  h += `成品外尺寸 ≈ <b>${(c.L + 2 * t).toFixed(1)} × ${(c.W + 2 * t).toFixed(1)} × ${(c.H + 2 * t).toFixed(1)}</b><br/>`;
  h += `展开尺寸 <b>${bb.w.toFixed(1)} × ${bb.h.toFixed(1)}</b><br/>含出血 <b>${bl.w.toFixed(1)} × ${bl.h.toFixed(1)}</b><br/>`;
  const cutLen = geo.cut.reduce((s, l) => s + l.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - l[i][0], p[1] - l[i][1]), 0), 0);
  const crLen = geo.crease.reduce((s, l) => s + Math.hypot(l[1][0] - l[0][0], l[1][1] - l[0][1]), 0);
  h += `刀线总长 <b>${(cutLen / 1000).toFixed(2)} m</b>，压痕线 <b>${(crLen / 1000).toFixed(2)} m</b></div>`;
  for (const n of geo.notes) h += `<div class="note">${n}</div>`;
  h += `<p class="desc" style="margin-top:8px">输入为内尺寸；面板按纸张中性层 (内尺寸 + t) 计算，盖/外套自动加纸厚与间隙。</p></div>`;
  $('#tabStruct').innerHTML = h;
}
let dimTimer;
$('#tabStruct').addEventListener('input', (e) => {
  const el = e.target;
  clearTimeout(dimTimer);
  dimTimer = setTimeout(() => {
    if (el.dataset.dim) { const v = num(el.value); if (v && v > 0) { state.dims[el.dataset.dim] = v; state.dimsTouched = true; rebuild({ refit: true }); } }
    else if (el.id === 'thick') { const v = num(el.value); if (v && v > 0) { state.t = v; state.materialId = MATERIALS.find((m) => m.t === v)?.id || 'custom'; state.materialTouched = true; rebuild(); } }
    else if (el.id === 'bleed') { const v = num(el.value); if (v !== null && v >= 0) { state.bleed = v; rebuild(); } }
    else if (el.dataset.param) { const k = el.dataset.param; if (el.type === 'checkbox') state.params[k] = el.checked; else state.params[k] = el.value === '' ? null : num(el.value); rebuild(); }
  }, el.type === 'checkbox' ? 0 : 350);
});
$('#tabStruct').addEventListener('change', (e) => { if (e.target.id === 'matSel') { const m = MATERIALS.find((x) => x.id === e.target.value); state.materialId = e.target.value; if (m) state.t = m.t; state.materialTouched = true; rebuild(); } });
$('#tabStruct').addEventListener('click', (e) => {
  if (e.target.id === 'resetParams') { state.params = {}; rebuild(); }
  if (e.target.id === 'useDefaults') { state.dims = { ...STYLE_MAP[state.styleId].defaults }; state.dimsTouched = false; rebuild({ refit: true }); }
});

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
        h += `<div class="btns"><button class="small" data-act="center">居中</button>${el.type === 'image' ? '<button class="small" data-act="fill">铺满此面(含出血)</button><button class="small" data-act="fit">适应此面</button>' : ''}<button class="small" data-act="rot90">旋转 90°</button><button class="small" data-act="dup">复制到…</button></div>`;
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
  for (const fid of fronts) {
    const f = faceInfo(fid);
    const big = fid === 'front' || fid === 'top' || fid === 'header';
    state.elements.push({ id: 'e' + uid++, type: 'text', face: fid, text: fid === 'front' ? 'BestClean\n声波电动牙刷' : 'BestClean', size: Math.max(2.5, Math.min(f.w, f.h) * (big ? 0.12 : 0.16)), color: fid === 'front' ? '#ffffff' : '#0f4c9c', bold: true, x: 0, y: fid === 'front' ? f.h * 0.22 : 0, rot: f.w < f.h && !big ? -90 : 0 });
  }
  const im = new Image(); im.onload = () => {
    imageCache.set(logo, im);
    for (const fid of fronts.filter((q) => ['front', 'top', 'header'].includes(q))) { const f = faceInfo(fid); const w = Math.min(f.w, f.h) * 0.5; state.elements.push({ id: 'e' + uid++, type: 'image', face: fid, src: logo, name: 'logo.png', ratio: 1, x: 0, y: fid === 'front' ? -f.h * 0.12 : 0, w, rot: 0 }); }
    renderArtPanel(); artChanged();
  };
  im.src = logo; renderArtPanel(); artChanged();
}

// ---------------- tabs, view mode, layers, 3D controls ----------------
function switchTab(tab) { document.querySelectorAll('#propTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab)); $('#tabStruct').hidden = tab !== 'struct'; $('#tabArt').hidden = tab !== 'art'; }
$('#propTabs').addEventListener('click', (e) => e.target.dataset.tab && switchTab(e.target.dataset.tab));
$('#viewMode').addEventListener('click', (e) => { const m = e.target.dataset.mode; if (!m) return; document.querySelectorAll('#viewMode button').forEach((b) => b.classList.toggle('on', b === e.target)); $('#views').className = m === 'split' ? 'split' : 'm' + m; setTimeout(() => view2d.fitView(), 30); });
const LAYER_NAMES = { art: '图稿', cut: '刀线', crease: '压痕线', bleed: '出血', glue: '粘胶区', dims: '尺寸', labels: '面标注' };
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
function infoLines() {
  const c = geo.ctx; const d = geo.style.dims;
  return [`Dieline: ${geo.style.en}   (${geo.style.id})`, `Inner size ${['L', 'W', 'H'].filter((k) => d[k]).map((k) => `${k} ${state.dims[k]}`).join(' x ')} mm   Board t = ${state.t} mm   Bleed ${state.bleed} mm`, `Flat size ${geo.bbox.w.toFixed(1)} x ${geo.bbox.h.toFixed(1)} mm (with bleed ${geo.bboxBleed.w.toFixed(1)} x ${geo.bboxBleed.h.toFixed(1)})   Panels (mid-plane) ${c.A.toFixed(1)} / ${c.B.toFixed(1)} / ${c.D.toFixed(1)}`, `Generated ${new Date().toISOString().slice(0, 10)} - Dieline Studio. Layers: Artwork / Glue / Bleed / Crease / Cut / Dimensions / Labels`];
}
function exportPDF() {
  const hasArt = true;
  const { canvas } = renderFlat(geo, state, { ppm: 300 / 25.4, maxPx: 6000, background: '#ffffff' });
  const jpg = canvas.toDataURL('image/jpeg', 0.9);
  const pdf = buildPDF(geo, { art: hasArt ? { bytes: dataURLtoBytes(jpg), w: canvas.width, h: canvas.height } : null, info: infoLines() });
  download(baseName() + '_dieline.pdf', new Blob([pdf], { type: 'application/pdf' }));
  toast('已导出 PDF（图层：图稿 / 粘胶 / 出血 / 压痕 / 刀线 / 尺寸）');
  return pdf;
}
$('#expPDF').onclick = exportPDF;
$('#expSVG').onclick = () => { const { canvas } = renderFlat(geo, state, { ppm: 6, maxPx: 4000 }); download(baseName() + '_dieline.svg', buildSVG(geo, { artDataUrl: canvas.toDataURL('image/png') }), 'image/svg+xml'); };
$('#expDXF').onclick = () => download(baseName() + '_dieline.dxf', buildDXF(geo), 'application/dxf');
$('#expFlat').onclick = () => { const { canvas } = renderFlat(geo, state, { ppm: 8, maxPx: 6000, lines: true, background: '#ffffff' }); canvas.toBlob((b) => download(baseName() + '_flat.png', b)); };
$('#exp3D').onclick = () => download(baseName() + '_3d.png', new Blob([dataURLtoBytes(view3d.snapshot(2))], { type: 'image/png' }));
$('#btnSave').onclick = () => {
  const { styleId, dims, materialId, t, bleed, params, boxColor, boardColor, faceColors, elements } = state;
  download(baseName() + '.json', JSON.stringify({ app: 'dieline-studio', version: 1, styleId, dims, materialId, t, bleed, params, boxColor, boardColor, faceColors, elements }, null, 1), 'application/json');
};
$('#fileProject').addEventListener('change', (e) => {
  const file = e.target.files[0]; if (!file) return; const r = new FileReader();
  r.onload = () => { try { loadProject(JSON.parse(r.result)); toast('项目已打开'); } catch (err) { toast('无法读取项目文件：' + err.message); } };
  r.readAsText(file); e.target.value = '';
});
function loadProject(p) {
  if (p.app !== 'dieline-studio' || !STYLE_MAP[p.styleId]) throw new Error('不是有效的刀版项目');
  Object.assign(state, { styleId: p.styleId, dims: p.dims, materialId: p.materialId, t: p.t, bleed: p.bleed ?? 3, params: p.params || {}, boxColor: p.boxColor, boardColor: p.boardColor, faceColors: p.faceColors || {}, elements: p.elements || [], selected: null, dimsTouched: true, materialTouched: true });
  uid = 1 + Math.max(0, ...state.elements.map((e) => parseInt(String(e.id).slice(1)) || 0));
  let pending = 0;
  for (const el of state.elements) if (el.type === 'image' && !imageCache.get(el.src)?.complete) { pending++; const im = new Image(); im.onload = () => { imageCache.set(el.src, im); if (--pending === 0) artChanged(); }; im.src = el.src; imageCache.set(el.src, im); }
  rebuild({ refit: true });
}
window.__app.loadProject = loadProject; window.__app.exportPDF = () => exportPDF(); window.__app.selectStyle = selectStyle; window.__app.demo = () => demoArtwork();
$('#btnNew').onclick = () => { if (confirm('清空当前图稿？（结构参数保留）')) { state.elements = []; state.faceColors = {}; state.boxColor = '#ffffff'; renderArtPanel(); artChanged(); } };

renderLibrary();
rebuild({ refit: true });
