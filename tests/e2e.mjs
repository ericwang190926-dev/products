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
await page.locator('#v2d').screenshot({ path: `${SHOTS}/book_magnet_dieline.png` });
await setMode('3d'); await setFold(1, 0.12); await page.waitForTimeout(600);
await page.locator('#v3d').screenshot({ path: `${SHOTS}/book_long_3d.png` });
ok('书型盒 defaults to 长边打开 with flap along the long edge', await page.evaluate(() => {
  const g = window.__app.geo;
  const flap = g.byId.flap, lid = g.byId.lid;
  const fh = Math.max(...flap.poly.map((p) => p[1])) - Math.min(...flap.poly.map((p) => p[1]));
  const lh = Math.max(...lid.poly.map((p) => p[1])) - Math.min(...lid.poly.map((p) => p[1]));
  return g.ctx.p.openDir === 'long' && g.marks.filter((m) => m.type === 'magnet').length === 4 && Math.abs(fh - lh) < 1;
}));
await page.click('#propTabs button[data-tab="struct"]');
await page.locator('label:has(input[name="openDir"][value="short"])').click();
await page.waitForTimeout(700);
await setMode('3d'); await setFold(1, 0.12); await page.waitForTimeout(600);
await page.locator('#v3d').screenshot({ path: `${SHOTS}/book_short_3d.png` });
ok('书型盒 短边打开 moves flap to the short edge', await page.evaluate(() => {
  const g = window.__app.geo;
  const flap = g.byId.flap, lid = g.byId.lid;
  const fh = Math.max(...flap.poly.map((p) => p[1])) - Math.min(...flap.poly.map((p) => p[1]));
  const lh = Math.max(...lid.poly.map((p) => p[1])) - Math.min(...lid.poly.map((p) => p[1]));
  return g.ctx.p.openDir === 'short' && Math.abs(fh - lh) < 1 && fh < 150;
}));
ok('覆膜 options include 触感膜', await page.evaluate(() => /触感膜/.test(document.body.innerText)));

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
