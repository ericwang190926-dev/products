# 包装刀版设计工具 · Dieline Studio

离线单文件网页工具：选盒型 → 输入内尺寸/纸厚 → 自动生成刀版（刀线、压痕线、出血、粘胶区、尺寸标注）→ 按面贴 Logo/图片/文字 → 实时 3D 预览（可折叠动画、开盖）→ 导出 PDF/SVG/DXF/PNG。

**直接双击 `dist/index.html` 即可使用**（所有 JS/CSS/three.js 已内联，无需联网）。

## 盒型（25 种，参数化定义）
插舌盒：直插盒、反插盒、开窗插舌盒、挂钩插舌盒、粘口盒(四翼封口)
锁底盒：扣底盒(自动锁底)、插舌+快锁底(1-2-3底)、挂钩扣底盒、开窗扣底盒
礼盒/硬盒：天地盒、书型盒(磁吸翻盖)、抽屉盒(外套+内托)、封套盒、腰封
电商/展示/托盘：飞机盒(FEFCO 0427)、展示盒(PDQ)、托盘(四角粘合)、一体翻盖盒
异形盒：枕头盒、手提盒(屋顶盒)、六角盒、三角盒、八角盒
卡类：吸塑背卡(可对折开窗)、对折吊卡

新增盒型：在 `src/core/styles/` 写一个 `build(ctx)`（用 `Builder.add()` 添加面板，指定父面板与折线 `hinge`、折叠角度），并在 `styles/index.js` 注册即可；刀线/压痕线、出血、3D 折叠、缩略图全部自动生成。

## 尺寸规则
输入为内尺寸（mm）。面板按纸张中性层计算：面板 = 内尺寸 + t；天地盒盖/抽屉外套自动加 2t + 间隙。材质预设：300/350/400g 白卡、牛皮卡、E/B 瓦楞、1.5/2mm 灰板，可自定义纸厚。

## 导出
- PDF：矢量刀版，图层(OCG)：Artwork / Glue / Bleed / Crease / Cut / Dimensions / Labels / Info；刀线为专色 `CutContour`，压痕线为专色 `Crease`；图稿为 300dpi 内嵌图并按出血线裁切。
- SVG（分层）、DXF（R12，图层 CUT/CREASE/PERF/BLEED/GLUE/DIM）、平面效果 PNG、3D PNG、项目 JSON（可再打开）。

## 开发
```
npm install
npm run build        # → dist/index.html（单文件）
npm test             # 几何自动校验：每种盒型 × 5 组尺寸 × 2 种纸厚
npm run test:e2e     # Playwright + Chrome 打开 dist/index.html 的端到端测试，截图到 screenshots/
```
