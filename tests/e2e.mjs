// End-to-end test of the built single-file app (dist/index.html) in headless Chromium via file://
import { chromium } from 'playwright-core';
import fs from 'fs'; import path from 'path'; import { execSync } from 'child_process';
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const SHOTS = path.join(ROOT, 'screenshots'); const OUT = path.join(ROOT, 'test-output');
fs.mkdirSync(SHOTS, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
const results = []; const ok = (name, pass, detail = '') => { results.push({ name, pass: !!pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const LOGO = process.env.TEST_IMAGE || path.join(ROOT, 'tests/fixtures/customer_logo.png');

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const url = 'file://' + path.join(ROOT, 'dist/index.html');
await page.goto(url); await page.waitForTimeout(1200);
ok('app loads from file:// (single HTML, offline)', await page.locator('.card').count() >= 20, `${await page.locator('.card').count()} style cards`);
const net = []; page.on('request', (r) => !r.url().startsWith('file:') && !r.url().startsWith('blob:') && !r.url().startsWith('data:') && net.push(r.url()));

const setMode = async (m) => { await page.click(`#viewMode button[data-mode="${m}"]`); await page.waitForTimeout(350); };
const setFold = (f, o = 0) => page.evaluate(([f, o]) => { const F = document.querySelector('#fold'); F.value = f; F.dispatchEvent(new Event('input')); const O = document.querySelector('#open'); O.value = o; O.dispatchEvent(new Event('input')); }, [f, o]);
const STYLES = [['hanger', null], ['crash', null], ['mailer', { open: 0.55 }], ['lidbase', { open: 0.6 }], ['book', { open: 0.45 }], ['drawer', { open: 0.6 }], ['gable', null], ['hex', null], ['pillow', null], ['display', null], ['blister', null], ['ste', { fold: 0.55 }]];
for (const [id, o] of STYLES) {
  await page.click(`.card[data-id="${id}"]`); await page.waitForTimeout(400);
  await page.evaluate(() => window.__app.demo()); await page.waitForTimeout(700);
  const info = await page.evaluate(() => { const g = window.__app.geo; return { id: g.style.id, panels: g.panels.length, cut: g.cut.length, w: g.bbox.w, h: g.bbox.h }; });
  await setMode('2d'); await page.locator('#v2d').screenshot({ path: `${SHOTS}/${id}_dieline.png` });
  await setMode('3d'); await setFold(o?.fold ?? 1, o?.open ?? 0); await page.waitForTimeout(500);
  await page.locator('#v3d').screenshot({ path: `${SHOTS}/${id}_3d.png` });
  if (o?.fold) { await setFold(1, 0); await page.waitForTimeout(300); await page.locator('#v3d').screenshot({ path: `${SHOTS}/${id}_3d_closed.png` }); }
  await setFold(1, 0); await setMode('split');
  ok(`style ${id}: dieline + 3D rendered`, info.id === id && info.cut > 0 && fs.statSync(`${SHOTS}/${id}_3d.png`).size > 15000, `${info.panels} panels, flat ${info.w.toFixed(1)}×${info.h.toFixed(1)} mm`);
}
// every style builds in the UI without errors
const allOk = await page.evaluate(async () => { const ids = [...document.querySelectorAll('.card')].map((c) => c.dataset.id); const bad = []; for (const id of ids) { try { window.__app.selectStyle(id); if (window.__app.geo.style.id !== id) bad.push(id); } catch (e) { bad.push(id + ':' + e.message); } } return { n: ids.length, bad }; });
ok('all styles selectable in UI', allOk.bad.length === 0, `${allOk.n} styles${allOk.bad.length ? ' bad: ' + allOk.bad.join(',') : ''}`);

// dimension edit updates geometry
await page.click('.card[data-id="ste"]'); await page.waitForTimeout(300);
await page.fill('input[data-dim="L"]', '40'); await page.waitForTimeout(800);
const frontW = await page.evaluate(() => { const g = window.__app.geo; const xs = g.byId.front.poly.map((p) => p[0]); return Math.max(...xs) - Math.min(...xs); });
ok('editing L updates the dieline (front = 外尺寸 - t)', Math.abs(frontW - 39.5) < 1e-6, `front width ${frontW}`);
await page.fill('input[data-dim="L"]', '30'); await page.waitForTimeout(800);
// material change accounts for thickness (plain-Chinese structure picker)
await page.locator('label:has(#struct-corrugated)').click(); await page.waitForTimeout(600);
const fw2 = await page.evaluate(() => { const g = window.__app.geo; const xs = g.byId.front.poly.map((p) => p[0]); return Math.max(...xs) - Math.min(...xs); });
ok('细瓦（E楞）按外尺寸会减小内面板（板更厚）', Math.abs(fw2 - 28.5) < 1e-6, `front width ${fw2}`);
await page.locator('label:has(#struct-carton)').click(); await page.waitForTimeout(600);
const materialCopy = await page.evaluate(() => document.querySelector('#materialSec .summary')?.textContent || '');
ok('material summary is in plain Chinese with gram weight', /350g/.test(materialCopy) && /白卡|铜版|特种/.test(materialCopy) && /内尺寸/.test(materialCopy), materialCopy);

// image upload + drag on the hanger box
await page.click('.card[data-id="hanger"]'); await page.waitForTimeout(400);
await page.evaluate(() => window.__app.demo()); await page.waitForTimeout(500);
await page.click('#propTabs button[data-tab="art"]');
await page.click('.chip[data-face="front"]');
await page.setInputFiles('#addImage', LOGO); await page.waitForTimeout(1200);
const nImg = await page.evaluate(() => window.__app.state.elements.filter((e) => e.type === 'image' && e.name && e.name === 'customer_logo.png').length);
ok('upload image onto a face', nImg === 1);
const sel = await page.evaluate(() => window.__app.state.selected);
const box = await page.locator(`[data-el="${sel}"]`).boundingBox();
const before = await page.evaluate((id) => window.__app.state.elements.find((e) => e.id === id).y, sel);
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 40, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(400);
const after = await page.evaluate((id) => window.__app.state.elements.find((e) => e.id === id).y, sel);
ok('drag artwork on dieline moves it', after > before + 1, `y ${before.toFixed(1)} → ${after.toFixed(1)} mm`);
await page.fill('.el.on input[type=number][data-k="rot"]', '15'); await page.waitForTimeout(300);
await page.fill('#faceColor', '#c8102e').catch(() => {}); await page.evaluate(() => { const i = document.querySelector('#faceColor'); i.value = '#0f4c9c'; i.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(600);
await page.locator('#app').screenshot({ path: `${SHOTS}/app_overview_hanger.png` });

// material UI + finishing processes
await page.evaluate(() => { window.__app.state.materialTouched = false; });
await page.click('.card[data-id="lidbase"]'); await page.waitForTimeout(600);
await page.click('#propTabs button[data-tab="struct"]'); await page.waitForTimeout(200);
await page.click('#useDefaults'); await page.waitForTimeout(500);
ok('lidbase defaults to 灰板裱纸 + 1200g', await page.evaluate(() => {
  const s = window.__app.state; return s.mat.structure === 'rigid' && s.mat.boardGsm === 1200 && Math.abs(s.t - 1.9) < 0.05 && (document.querySelector('#materialSec .summary')||{}).textContent.includes('1200g灰板');
}), await page.evaluate(() => window.__app.state.t + ' ' + document.querySelector('#materialSec .summary')?.textContent));
await page.locator('#props').screenshot({ path: `${SHOTS}/material_ui.png` });
await page.click('#propTabs button[data-tab="art"]'); await page.waitForTimeout(300);
await page.evaluate(() => window.__app.demo()); await page.waitForTimeout(700);
await page.evaluate(() => {
  const st = window.__app.state;
  const frontLogo = st.elements.find((e) => e.type === 'image' && e.face === 'front');
  const topLogo = st.elements.find((e) => e.type === 'image' && e.face === 'top');
  st.finishRegions = [];
  if (topLogo) st.finishRegions.push({ id: 'fdemo', type: 'el', elementId: topLogo.id, processes: ['foil-gold'] });
  if (frontLogo) st.finishRegions.push({ id: 'fuv', type: 'el', elementId: frontLogo.id, processes: ['uv'] });
  st.lamination = 'matte';
  st.selectedFinish = st.finishRegions[0]?.id || null;
  st.selected = (topLogo || frontLogo)?.id || null;
});
await page.evaluate(() => window.__app.refresh()); await page.waitForTimeout(400);
await page.click('#propTabs button[data-tab="struct"]'); await page.waitForTimeout(200);
await page.evaluate(() => { const el = document.querySelector('.sec h3 .tip') || [...document.querySelectorAll('.sec h3')].find((n) => n.textContent.includes('包装工艺')); el?.closest('.sec')?.scrollIntoView({ block: 'start' }); });
await page.waitForTimeout(200);
await page.locator('#props').screenshot({ path: `${SHOTS}/finish_ui.png` });
await page.click('#propTabs button[data-tab="art"]');
await setMode('3d'); await setFold(1, 0.12); await page.waitForTimeout(600);
await page.locator('#v3d').screenshot({ path: `${SHOTS}/finish_3d.png` });
await setMode('split');
ok('finish processes attach to artwork', await page.evaluate(() => { const regs = window.__app.state.finishRegions || []; return regs.some((r) => (r.processes || []).includes('foil-gold')) && regs.some((r) => (r.processes || []).includes('uv')); }));

// 天地盒 半盖 / 全盖 + 书型盒包边磁铁
await page.evaluate(() => { window.__app.state.materialTouched = false; window.__app.state.dimsTouched = false; window.__app.state.dimMode = 'outer'; window.__app.state.params = {}; });
await page.click('#propTabs button[data-tab="struct"]'); await page.waitForTimeout(200);
await page.click('.card[data-id="lidbase"]'); await page.waitForTimeout(500);
await page.click('#useDefaults'); await page.waitForTimeout(500);
await page.evaluate(() => window.__app.demo()); await page.waitForTimeout(700);
await setMode('3d'); await setFold(1, 0.2); await page.waitForTimeout(500);
await page.locator('#v3d').screenshot({ path: `${SHOTS}/lidbase_half_3d.png` });
ok('天地盒 半盖 lid is shorter than the base', await page.evaluate(() => {
  const g = window.__app.geo; const lid = g.byId.lidfront, base = g.byId.front;
  const h = (id) => { const ys = g.byId[id].poly.map((p) => p[1]); return Math.max(...ys) - Math.min(...ys); };
  return h('lidfront') < h('front') && g.ctx.p.lidType !== 'full';
}));
await page.click('#propTabs button[data-tab="struct"]');
await page.locator('label:has(input[name="lidType"][value="full"])').click();
await page.waitForTimeout(700);
await setMode('3d'); await setFold(1, 0.22); await page.waitForTimeout(500);
await page.locator('#v3d').screenshot({ path: `${SHOTS}/lidbase_full_3d.png` });
ok('天地盒 全盖 lid reaches the bottom', await page.evaluate(() => {
  const g = window.__app.geo;
  const h = (id) => { const ys = g.byId[id].poly.map((p) => p[1]); return Math.max(...ys) - Math.min(...ys); };
  return g.ctx.p.lidType === 'full' && h('lidfront') > h('front') + 1;
}));

await page.evaluate(() => { window.__app.state.params = {}; window.__app.state.dimsTouched = false; });
await page.click('#propTabs button[data-tab="struct"]'); await page.waitForTimeout(200);
await page.click('.card[data-id="book"]'); await page.waitForTimeout(500);
await page.click('#useDefaults'); await page.waitForTimeout(500);
await page.evaluate(() => window.__app.demo()); await page.waitForTimeout(700);
await setMode('2d'); await page.waitForTimeout(400);
await page.locator('#v2d').screenshot({ path: `${SHOTS}/book_dieline.png` });
await page.locator('#v2d').screenshot({ path: `${SHOTS}/book_magnet_dieline.png` });
ok('书型盒 defaults to 长边打开, full-height flap, hidden 3D magnets', await page.evaluate(() => {
  const g = window.__app.geo;
  const flap = g.byId.flap, lid = g.byId.lid;
  const span = Math.max(...flap.poly.map((p) => p[1])) - Math.min(...flap.poly.map((p) => p[1]));
  const lh = Math.max(...lid.poly.map((p) => p[1])) - Math.min(...lid.poly.map((p) => p[1]));
  const fw = Math.max(...flap.poly.map((p) => p[0])) - Math.min(...flap.poly.map((p) => p[0]));
  const want = g.ctx.outer.H - g.ctx.p.flapGap;
  const magLbl = document.querySelector('#lblShowMagnets');
  const magChk = document.querySelector('#showMagnets');
  return g.ctx.p.openDir === 'long'
    && g.marks.filter((m) => m.type === 'magnet').length === 4
    && Math.abs(span - lh) < 1
    && Math.abs(fw - want) < 0.2
    && fw > g.ctx.H * 0.8
    && magLbl && !magLbl.hidden
    && magChk && !magChk.checked
    && window.__app.state.showMagnets === false
    && /磁铁内嵌在灰板里，外面看不到/.test(document.querySelector('#v2d')?.innerHTML || document.body.innerText);
}));
await setMode('3d'); await setFold(1, 0); await page.waitForTimeout(600);
await page.locator('#v3d').screenshot({ path: `${SHOTS}/book_closed_long_3d.png` });
await page.locator('#v3d').screenshot({ path: `${SHOTS}/book_long_3d.png` });
await setFold(1, 0.5); await page.waitForTimeout(500);
await page.locator('#v3d').screenshot({ path: `${SHOTS}/book_halfopen_3d.png` });
ok('显示磁铁位置 toggle works and is off by default', await page.evaluate(() => {
  const chk = document.querySelector('#showMagnets');
  return chk && !chk.checked && window.__app.state.showMagnets === false;
}));
await page.click('#showMagnets'); await page.waitForTimeout(200);
ok('显示磁铁位置 can be turned on', await page.evaluate(() => window.__app.state.showMagnets === true));
await page.click('#showMagnets'); await page.waitForTimeout(200);
await page.click('#propTabs button[data-tab="struct"]');
await page.locator('label:has(input[name="openDir"][value="short"])').click();
await page.waitForTimeout(700);
await setMode('3d'); await setFold(1, 0); await page.waitForTimeout(600);
await page.locator('#v3d').screenshot({ path: `${SHOTS}/book_closed_short_3d.png` });
await page.locator('#v3d').screenshot({ path: `${SHOTS}/book_short_3d.png` });
ok('书型盒 短边打开 keeps a full-height flap on the short edge', await page.evaluate(() => {
  const g = window.__app.geo;
  const flap = g.byId.flap, lid = g.byId.lid;
  const span = Math.max(...flap.poly.map((p) => p[1])) - Math.min(...flap.poly.map((p) => p[1]));
  const lh = Math.max(...lid.poly.map((p) => p[1])) - Math.min(...lid.poly.map((p) => p[1]));
  const fw = Math.max(...flap.poly.map((p) => p[0])) - Math.min(...flap.poly.map((p) => p[0]));
  const want = g.ctx.outer.H - g.ctx.p.flapGap;
  return g.ctx.p.openDir === 'short' && Math.abs(span - lh) < 1 && span < 150
    && Math.abs(fw - want) < 0.2 && fw > g.ctx.H * 0.8;
}));
ok('覆膜 options include 触感膜', await page.evaluate(() => /触感膜/.test(document.body.innerText)));

// Closed corners at fold=100% (thickness-aware joints)
const shot3d = async (id, file, open = 0) => {
  await page.evaluate(() => { window.__app.state.materialTouched = false; window.__app.state.dimsTouched = false; window.__app.state.params = {}; });
  await page.click('#propTabs button[data-tab="struct"]');
  await page.click(`.card[data-id="${id}"]`); await page.waitForTimeout(350);
  if (await page.locator('#useDefaults').count()) { try { await page.click('#useDefaults', { timeout: 800 }); } catch {} }
  await page.evaluate(() => window.__app.demo()); await page.waitForTimeout(550);
  await setMode('3d'); await setFold(1, open); await page.waitForTimeout(450);
  await page.locator('#v3d').screenshot({ path: `${SHOTS}/${file}` });
};
await shot3d('lidbase', 'lidbase_corners_3d.png', 0.35);
{
  const box = await page.locator('#v3d').boundingBox();
  await page.mouse.move(box.x + box.width * 0.68, box.y + box.height * 0.40);
  for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, -90); await page.waitForTimeout(40); }
  await page.waitForTimeout(250);
  await page.locator('#v3d').screenshot({ path: `${SHOTS}/lidbase_corners_closeup.png` });
  await page.locator('button:has-text("重置视角")').click(); await page.waitForTimeout(200);
}
await shot3d('drawer', 'drawer_corners_3d.png', 0);
await shot3d('book', 'book_corners_3d.png', 0);
await shot3d('sleeve', 'sleeve_corners_3d.png', 0.35);
await shot3d('ste', 'ste_corners_3d.png', 0);
ok('corner close-up screenshots saved', ['lidbase_corners_closeup','lidbase_corners_3d','drawer_corners_3d','book_corners_3d','sleeve_corners_3d','ste_corners_3d'].every((n) => fs.existsSync(`${SHOTS}/${n}.png`) && fs.statSync(`${SHOTS}/${n}.png`).size > 20000));


// 封套盒 inner box (rigid + folding) + 内衬 (EVA / 吸塑 / 纸盒 / 纸卡)
await page.evaluate(() => { window.__app.state.materialTouched = false; window.__app.state.dimsTouched = false; window.__app.state.dimMode = 'outer'; window.__app.state.params = {}; });
await page.click('#propTabs button[data-tab="struct"]'); await page.waitForTimeout(200);
await page.click('.card[data-id="sleeve"]'); await page.waitForTimeout(500);
await page.click('#useDefaults'); await page.waitForTimeout(500);
await page.evaluate(() => window.__app.demo()); await page.waitForTimeout(700);
await setMode('3d'); await setFold(1, 0.42); await page.waitForTimeout(600);
await page.locator('#v3d').screenshot({ path: `${SHOTS}/sleeve_rigid_3d.png` });
ok('封套盒 defaults to 灰板裱纸内盒 and slides out in 3D', await page.evaluate(() => {
  const g = window.__app.geo;
  return g.sleeveInner?.innerBox === 'rigid' && !!g.byId.tbase && g.sheets.some((s) => s.id === 'wrapTray');
}));

await page.click('#propTabs button[data-tab="struct"]');
await page.locator('label:has(input[name="innerBox"][value="folding"])').click();
await page.waitForTimeout(600);
await setMode('3d'); await setFold(1, 0.42);
await page.click('#sleeveGhost'); await page.waitForTimeout(500);
await page.locator('#v3d').screenshot({ path: `${SHOTS}/sleeve_folding_3d.png` });
ok('封套半透明 toggle works', await page.evaluate(() => window.__app.state.sleeveGhost === true));
await page.click('#sleeveGhost');
ok('封套盒 switches to 铜版纸折叠内盒', await page.evaluate(() => {
  const g = window.__app.geo;
  return g.sleeveInner?.innerBox === 'folding' && !!g.byId.tbase && !g.sheets.some((s) => s.id === 'wrapTray');
}));

// EVA insert on 天地盒 3D
await page.evaluate(() => { window.__app.state.materialTouched = false; window.__app.state.dimsTouched = false; window.__app.state.params = {}; });
await page.click('#propTabs button[data-tab="struct"]'); await page.waitForTimeout(200);
await page.click('.card[data-id="lidbase"]'); await page.waitForTimeout(450);
await page.click('#useDefaults'); await page.waitForTimeout(450);
await page.click('[data-insert-type="eva"]'); await page.waitForTimeout(500);
await page.click('[data-slot-dup="0"]'); await page.waitForTimeout(600);
await page.evaluate(() => window.__app.demo()); await page.waitForTimeout(700);
await setMode('3d'); await setFold(1, 0.95); await page.waitForTimeout(600);
await page.locator('#v3d').screenshot({ path: `${SHOTS}/eva_insert_3d.png` });
ok('EVA insert renders on 天地盒 with 2 cavities', await page.evaluate(() => {
  const g = window.__app.geo;
  return g.insertSpec?.type === 'eva' && g.insertSpec.count === 2 && g.extras3d.some((e) => e.type === 'insert-eva' && e.holes.length === 2) && (g.insertSpec.slots[0].x !== g.insertSpec.slots[1].x || g.insertSpec.slots[0].y !== g.insertSpec.slots[1].y);
}));

// 纸盒 insert dieline + 纸卡 insert dieline
await page.click('#propTabs button[data-tab="struct"]');
await page.click('[data-insert-type="carton"]'); await page.waitForTimeout(500);
await setMode('2d');
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
await page.waitForTimeout(300);
await page.locator('#v2d').screenshot({ path: `${SHOTS}/carton_insert_dieline.png` });
ok('纸盒 insert generates folding dieline', await page.evaluate(() => !!window.__app.geo.byId.insTop && window.__app.geo.byId.insTop.holes.length === 2));

await page.click('[data-insert-type="card"]'); await page.waitForTimeout(500);
await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOTS}/card_insert_dieline.png`, clip: await page.locator('#v2d').boundingBox() });
ok('纸卡 insert generates card dieline', await page.evaluate(() => !!window.__app.geo.byId.insCard && window.__app.geo.byId.insCard.holes.length === 2));
await setMode('3d'); await page.waitForTimeout(300);

// ---- 内衬：每个槽单独设置（厚度 / 形状 / 大小 / 位置 / 深度 / 手扣位） ----
const slotsNow = () => page.evaluate(() => window.__app.geo.insertSpec.slots.map((q) => ({ shape: q.shape, w: q.w, h: q.h, x: q.x, y: q.y, rot: q.rot, depth: q.depth, notch: q.notch, through: q.through, r: q.r })));
await page.click('#propTabs button[data-tab="struct"]');
await page.click('[data-insert-type="eva"]'); await page.waitForTimeout(500);
ok('槽位编辑：每个槽一张卡片', await page.locator('.slot[data-slot-card]').count() === 2, `${await page.locator('.slot[data-slot-card]').count()} cards`);
await page.click('[data-slot-add]'); await page.waitForTimeout(600);
ok('槽位编辑：可以添加槽', (await slotsNow()).length === 3);
await page.click('summary[data-slot-select="1"]'); await page.waitForTimeout(300);
await page.fill('input[data-slot="1"][data-key="w"]', '55'); await page.waitForTimeout(800);
let sl = await slotsNow();
ok('槽位编辑：改一个槽的长度不影响其他槽', sl[1].w === 55 && sl[0].w !== 55 && sl[2].w !== 55, JSON.stringify(sl.map((q) => q.w)));
await page.click('[data-slot-set][data-slot="1"][data-key="shape"][data-val="oblong"]'); await page.waitForTimeout(500);
await page.fill('input[data-slot="1"][data-key="rot"]', '90'); await page.waitForTimeout(800);
sl = await slotsNow();
ok('槽位编辑：单独改形状和旋转（长圆槽 90°）', sl[1].shape === 'oblong' && sl[1].rot === 90 && sl[0].shape === 'roundRect', `${sl[1].shape} ${sl[1].rot}`);
await page.click('input[data-slot="1"][data-key="notch"]'); await page.waitForTimeout(600);
ok('槽位编辑：取物手扣位', (await slotsNow())[1].notch === true && (await page.evaluate(() => window.__app.geo.insertSpec.slots[1].poly.length)) > 20);
await page.fill('input[data-slot="1"][data-key="depth"]', '8'); await page.waitForTimeout(800);
sl = await slotsNow();
ok('槽位编辑：EVA 单槽深度（不通凹位）', sl[1].depth === 8 && sl[1].through === false && sl[0].through === true);
await page.click('[data-slot-layout="distX"]'); await page.waitForTimeout(500);
await page.click('[data-slot-layout="centerAll"]'); await page.waitForTimeout(500);
ok('排布小工具：水平均分 / 整体居中', await page.evaluate(() => { const sp = window.__app.geo.insertSpec; const xs = sp.slots.map((q) => q.poly.flat().filter((_, i) => i % 2 === 0)); const lo = Math.min(...xs.flat()), hi = Math.max(...xs.flat()); return Math.abs((lo + hi) / 2 - sp.insL / 2) < 0.5; }));
await page.click('[data-slot-del="1"]'); await page.waitForTimeout(500);
ok('槽位编辑：可以删除槽', (await slotsNow()).length === 2);

// 厚度选项
await page.click('[data-eva-thick="25"]'); await page.waitForTimeout(500);
ok('EVA 厚度 25mm', await page.evaluate(() => window.__app.geo.insertSpec.evaThick === 25 && window.__app.geo.extras3d.some((e) => e.type === 'insert-eva' && e.depth === 25)));
await page.click('[data-insert-type="blister"]'); await page.waitForTimeout(500);
await page.click('[data-set-param="blisterSheet"][data-val="0.8"]'); await page.waitForTimeout(500);
ok('吸塑片材厚度 0.8mm', await page.evaluate(() => window.__app.geo.insertSpec.blisterSheet === 0.8 && window.__app.geo.extras3d.some((e) => e.type === 'insert-blister' && e.sheet === 0.8)));
await page.click('[data-insert-type="card"]'); await page.waitForTimeout(500);
await page.fill('input[data-param="insCardLift"]', '6'); await page.waitForTimeout(800);
ok('纸卡离盒底高度', await page.evaluate(() => window.__app.geo.insertSpec.cardLift === 6));
await page.fill('input[data-param="insCardLift"]', ''); await page.waitForTimeout(600);

// 固定一组 3 个自定义槽：EVA 3D、纸卡刀版、2D 拖动
await page.evaluate(() => {
  const a = window.__app; const sp = a.geo.insertSpec; const L = sp.insL, W = sp.insW;
  a.state.params.insSlots = [
    { shape: 'roundRect', w: 84, h: 46, r: 9, rot: 0, depth: null, x: L * 0.30, y: W * 0.32, notch: true, notchSide: 'top', notchR: 9 },
    { shape: 'circle', w: 36, h: 36, rot: 0, depth: null, x: L * 0.72, y: W * 0.30, notch: false },
    { shape: 'oblong', w: 72, h: 24, rot: 0, depth: 12, x: L * 0.66, y: W * 0.74, notch: false },
  ];
  a.state.params.evaThick = 20; a.state.params.insertType = 'eva'; a.state.selectedSlot = 1; a.rebuild();
});
await page.waitForTimeout(800);
await page.click('#propTabs button[data-tab="struct"]');
await page.setViewportSize({ width: 1600, height: 1750 }); await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('#insertSec').scrollIntoView({ block: 'start' })); await page.waitForTimeout(300);
await page.locator('#props').screenshot({ path: `${SHOTS}/insert_panel_ui.png` });
await page.setViewportSize({ width: 1600, height: 900 }); await page.waitForTimeout(300);
ok('3 个自定义槽（形状 / 大小 / 深度各不相同）', await page.evaluate(() => { const q = window.__app.geo.insertSpec.slots; return q.length === 3 && new Set(q.map((s) => s.shape)).size === 3 && q[2].through === false && q[0].notch; }));
await setMode('3d'); await setFold(1, 1); await page.waitForTimeout(700);
{
  const vb = await page.locator('#v3d').boundingBox();
  await page.mouse.move(vb.x + vb.width * 0.5, vb.y + vb.height * 0.45); await page.mouse.down();
  for (let i = 1; i <= 10; i++) { await page.mouse.move(vb.x + vb.width * 0.5, vb.y + vb.height * 0.45 + i * 9); await page.waitForTimeout(25); }
  await page.mouse.up(); await page.waitForTimeout(600);
}
await page.locator('#v3d').screenshot({ path: `${SHOTS}/eva_custom_slots_3d.png` });
await page.locator('#resetView').click(); await page.waitForTimeout(200);

await page.click('#propTabs button[data-tab="struct"]');
await page.click('[data-insert-type="card"]'); await page.waitForTimeout(600);
await setMode('2d'); await page.waitForTimeout(500);
const zoomToInsert = async (steps = 6) => {
  const pt = await page.evaluate(() => {
    const sp = window.__app.geo.insertSpec; const svg = document.querySelector('#svg2d');
    const p = svg.createSVGPoint(); p.x = sp.edit.ox + sp.insL / 2; p.y = sp.edit.oy + sp.insW / 2;
    const q = p.matrixTransform(svg.getScreenCTM()); return { x: q.x, y: q.y };
  });
  await page.mouse.move(pt.x, pt.y);
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(30); }
  await page.waitForTimeout(250);
};
const settle = async () => { await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); await page.waitForTimeout(350); };
await zoomToInsert(6); await settle();
await page.screenshot({ path: `${SHOTS}/card_slots_dieline.png`, clip: await page.locator('#v2d').boundingBox() });
ok('纸卡刀版带 3 个自定义槽孔', await page.evaluate(() => window.__app.geo.byId.insCard.holes.length === 3 && window.__app.geo.cut.length > 0));

// 在 2D 里拖动槽
const slotBefore = (await slotsNow())[1];
const sb = await page.locator('#svg2d [data-slot="1"]').boundingBox();
const cx = sb.x + sb.width / 2, cy = sb.y + sb.height / 2;
await page.mouse.move(cx, cy); await page.mouse.down();
for (let i = 1; i <= 12; i++) { await page.mouse.move(cx - i * 6, cy + i * 3.2); await page.waitForTimeout(20); }
await settle();
await page.screenshot({ path: `${SHOTS}/slot_drag_2d.png`, clip: await page.locator('#v2d').boundingBox() });
const live = await page.inputValue('input[data-slot="1"][data-key="x"]');
await page.mouse.up(); await page.waitForTimeout(700);
const slotAfter = (await slotsNow())[1];
ok('2D 拖动槽：位置改变并写回数值', slotAfter.x < slotBefore.x - 1 && slotAfter.y > slotBefore.y + 1 && Math.abs(parseFloat(live) - slotAfter.x) < 0.6, `x ${slotBefore.x.toFixed(1)}→${slotAfter.x} y ${slotBefore.y.toFixed(1)}→${slotAfter.y}`);
ok('2D 拖动槽：只动被拖的槽', await page.evaluate(() => { const q = window.__app.geo.insertSpec.slots; return Math.abs(q[0].x - window.__app.geo.insertSpec.insL * 0.30) < 0.02; }));
await page.click('#zoomFit'); await setMode('3d');

await page.click('.card[data-id="hanger"]'); await page.waitForTimeout(400);
await page.evaluate(() => window.__app.demo()); await page.waitForTimeout(500);

// fold animation
await page.click('#playFold'); await page.waitForTimeout(1100); const mid = +(await page.inputValue('#fold'));
await page.locator('#v3d').screenshot({ path: `${SHOTS}/hanger_3d_folding.png` });
await page.waitForTimeout(1600); const end = +(await page.inputValue('#fold'));
ok('fold/unfold animation runs', mid > 0.02 && mid < 0.98 && end < 0.02, `mid ${mid.toFixed(2)} end ${end.toFixed(2)}`);
await page.locator('#v3d').screenshot({ path: `${SHOTS}/hanger_3d_unfolded.png` });
await setFold(1, 0);

// exports
const dl = async (sel) => { const [d] = await Promise.all([page.waitForEvent('download'), page.click(sel)]); const p = path.join(OUT, d.suggestedFilename()); await d.saveAs(p); return p; };
const pdfPath = await dl('#expPDF');
let pdfinfo = ''; try { pdfinfo = execSync(`pdfinfo "${pdfPath}"`).toString(); } catch (e) { pdfinfo = 'ERR ' + e.message; }
const pdfBuf = fs.readFileSync(pdfPath); const pdfStr = pdfBuf.toString('latin1');
const layers = ['Artwork', 'Glue', 'Bleed', 'Crease', 'Cut', 'Dimensions'].filter((n) => pdfStr.includes(`/Type /OCG /Name (${n})`));
ok('PDF export is a valid PDF (pdfinfo)', pdfBuf.slice(0, 5).toString() === '%PDF-' && /Pages:\s+1/.test(pdfinfo) && !/ERR|Syntax Error/.test(pdfinfo), (pdfinfo.match(/Page size:.*/) || [''])[0]);
ok('PDF has layers + spot colours', layers.length === 6 && pdfStr.includes('/Separation /CutContour') && pdfStr.includes('/Separation /Crease'), layers.join(','));
try { execSync(`pdftoppm -r 50 -png -singlefile "${pdfPath}" "${SHOTS}/hanger_pdf_preview"`); ok('PDF renders with poppler (pdftoppm)', fs.existsSync(`${SHOTS}/hanger_pdf_preview.png`)); } catch (e) { ok('PDF renders with poppler (pdftoppm)', false, e.message); }
try {
  const py = `import pypdf,sys,json\nr=pypdf.PdfReader(sys.argv[1], strict=True)\noc=r.trailer['/Root']['/OCProperties']\nprint(json.dumps({'pages':len(r.pages),'ocgs':[str(o.get_object()['/Name']) for o in oc['/OCGs']],'images':len(r.pages[0].images)}))`;
  const res = JSON.parse(execSync(`python3 -c "${py.replace(/"/g, '\\"')}" "${pdfPath}"`).toString());
  ok('PDF parses strictly with pypdf; layers + embedded artwork', res.pages === 1 && res.ocgs.includes('Cut') && res.images === 1, `OCGs: ${res.ocgs.join('/')}`);
} catch (e) { ok('PDF parses strictly with pypdf', false, e.message.slice(0, 200)); }
const svgPath = await dl('#expSVG'); const svg = fs.readFileSync(svgPath, 'utf8');
ok('SVG export has Cut/Crease/Bleed layers', /id="Cut"/.test(svg) && /id="Crease"/.test(svg) && /id="Bleed"/.test(svg) && svg.trim().endsWith('</svg>'), `${(svg.length / 1024).toFixed(0)} KB`);
const dxfPath = await dl('#expDXF'); const dxf = fs.readFileSync(dxfPath, 'utf8');
ok('DXF export has CUT/CREASE layers and LINE entities', /\nCUT\n/.test(dxf) && /\nCREASE\n/.test(dxf) && (dxf.match(/\nLINE\n/g) || []).length > 20 && dxf.trim().endsWith('EOF'), `${(dxf.match(/\nLINE\n/g) || []).length} lines`);
const flatPath = await dl('#expFlat'); const f3 = await dl('#exp3D');
const isPng = (p) => fs.readFileSync(p).slice(1, 4).toString() === 'PNG';
ok('flat mockup PNG + 3D PNG export', isPng(flatPath) && isPng(f3) && fs.statSync(flatPath).size > 20000 && fs.statSync(f3).size > 20000, `${path.basename(flatPath)}, ${path.basename(f3)}`);
fs.copyFileSync(flatPath, `${SHOTS}/hanger_flat_mockup_export.png`); fs.copyFileSync(f3, `${SHOTS}/hanger_3d_export.png`);
// save / load project
const jsonPath = await dl('#btnSave'); const proj = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const nEls = proj.elements.length;
await page.click('.card[data-id="mailer"]'); await page.evaluate(() => { window.__app.state.elements = []; }); await page.waitForTimeout(300);
await page.setInputFiles('#fileProject', jsonPath); await page.waitForTimeout(1200);
const restored = await page.evaluate(() => ({ s: window.__app.state.styleId, n: window.__app.state.elements.length, c: window.__app.state.faceColors.front }));
ok('save + load project JSON round-trip', restored.s === 'hanger' && restored.n === nEls && restored.c === '#0f4c9c', `${restored.s}, ${restored.n} elements`);
ok('no external network requests', net.length === 0, net.slice(0, 3).join(' '));
ok('no JS errors in console', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
fs.writeFileSync(path.join(OUT, 'e2e-results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.pass).length; console.log(`\n${results.length - failed}/${results.length} e2e checks passed`); process.exit(failed ? 1 : 0);
