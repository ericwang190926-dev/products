#!/usr/bin/env python3
"""Subset Noto Sans CJK SC and dump glyph outlines as PDF-friendly cubics."""
from pathlib import Path
import json, re, sys
from fontTools.ttLib import TTCollection
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.basePen import decomposeQuadraticSegment

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
OUT = ROOT / "src/export/cjk-paths.json"
TTC = Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc")

# Always include ASCII printable + a fixed packaging vocabulary, plus every
# non-ASCII character currently used in the source tree.
EXTRA = """
盒型刀版设计工具内尺寸外尺寸产品放进去的空间用料灰板铜版纸白卡纸特种纸珠光触感牛皮棉艺术
克重裱面裱纸包边板厚约按自动加放覆膜光膜哑膜局部凹凸烫金烫银激凸逆向工艺瓦楞细中双楞
折叠彩盒礼盒硬盒骨架外面再一层印刷纸波浪芯抗压飞机电商常用天地书型抽屉封套腰封插舌
扣底挂钩开窗粘口快锁展示托盘枕头手提六角三角八角吸塑对折吊卡卡类刷头补充装
长宽高边长泡壳卡宽单片深厚斜顶提手挂头头卡前墙封面多出来的边盒盖缝隙外套抽不动
涂胶水那条边一般不用改揭开盖子货架结实正数为往上移负数为往下移
刀线压痕多印的边防止切歪露白涂胶位置面标注图稿尺寸结构参数推荐全部
整盒不指定位置亮光油模具把压出凸起凹陷花纹热压金色银色箔品牌名立体亮哑对比更强
雾面手感高级鲜亮更好擦保护膜展开含专色报价供应商工厂裁切磁铁虚线圆
分开做粘在封底上卡舌插入底板槽不用胶摇盖
毫米约已手动指定细瓦中瓦双瓦
，。、：；（）【】《》—–…·×÷±℃°“”‘’／
"""

def collect_chars():
    chars = set(EXTRA)
    for p in SRC.rglob("*"):
        if p.suffix.lower() in {".js", ".css", ".html", ".md", ".mjs"} and "node_modules" not in p.parts:
            try:
                text = p.read_text(encoding="utf-8")
            except Exception:
                continue
            for ch in text:
                o = ord(ch)
                if o >= 0xA0:
                    chars.add(ch)
    for o in range(32, 127):
        chars.add(chr(o))
    return "".join(sorted(chars, key=ord))

def quad_to_cubic(p0, p1, p2):
    # Quadratic p0,p1,p2 → cubic with control points 2/3 along.
    c1 = (p0[0] + 2 * p1[0]) / 3, (p0[1] + 2 * p1[1]) / 3
    c2 = (p2[0] + 2 * p1[0]) / 3, (p2[1] + 2 * p1[1]) / 3
    return c1, c2, p2

def flatten(pen_value):
    """Convert RecordingPen value to a list of [op, ...coords] with only M/L/C/Z."""
    out = []
    cur = None
    start = None
    for op, pts in pen_value:
        if op == "moveTo":
            cur = pts[0]
            start = cur
            out.append(["M", cur[0], cur[1]])
        elif op == "lineTo":
            cur = pts[0]
            out.append(["L", cur[0], cur[1]])
        elif op == "qCurveTo":
            # fontTools may give a chain of off-curve points; decompose.
            # RecordingPen for qCurveTo: last point is on-curve (or implied).
            offs = list(pts)
            if cur is None:
                continue
            # Use fontTools decompose if needed
            segs = list(decomposeQuadraticSegment([cur, *offs]))
            # decomposeQuadraticSegment expects [pt0, off, off, ..., on] and
            # yields ((c1, on), ...) relative? Let's do it manually.
            # Actually RecordingPen qCurveTo args are all points after the current,
            # last is on-curve unless it's None (implied start).
            points = [cur] + list(offs)
            if points[-1] is None:
                points[-1] = start
            # Convert implied on-curve midpoints between consecutive off-curves
            i = 0
            a = points[0]
            seq = points[1:]
            j = 0
            while j < len(seq):
                if j == len(seq) - 1:
                    c1, c2, p2 = quad_to_cubic(a, seq[j], seq[j] if False else seq[j])
                    # last is on-curve
                    c1, c2, p2 = quad_to_cubic(a, seq[j] if j == 0 and False else seq[j], seq[j])
                    # wait this is wrong when last is on-curve and previous is off
                    on = seq[j]
                    # Need the off-curve: if only one point, it's off? No - qCurveTo(p1, p2)
                    # in fontTools: control points then on-curve. If one off: qCurveTo(c, on)
                    break
                j += 1
            # Simpler robust approach:
            pts2 = list(offs)
            implied = False
            if pts2 and pts2[-1] is None:
                pts2[-1] = start
            # Rebuild on/off: all but last are off-curve; insert midpoints
            controls = pts2[:-1]
            on = pts2[-1]
            chain = controls + [on]
            prev_on = cur
            k = 0
            while k < len(chain) - 1:
                off = chain[k]
                nxt = chain[k + 1]
                # if nxt is also off (i.e. not the last), on-curve is midpoint
                if k + 1 < len(chain) - 1:
                    mid = ((off[0] + nxt[0]) / 2, (off[1] + nxt[1]) / 2)
                    c1, c2, p2 = quad_to_cubic(prev_on, off, mid)
                    out.append(["C", c1[0], c1[1], c2[0], c2[1], p2[0], p2[1]])
                    prev_on = mid
                    k += 1
                else:
                    c1, c2, p2 = quad_to_cubic(prev_on, off, on)
                    out.append(["C", c1[0], c1[1], c2[0], c2[1], p2[0], p2[1]])
                    prev_on = on
                    k += 1
            cur = on
        elif op == "curveTo":
            p1, p2, p3 = pts
            out.append(["C", p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]])
            cur = p3
        elif op == "closePath":
            out.append(["Z"])
            cur = start
        else:
            # addComponent shouldn't appear after decomposing
            raise SystemExit(f"unhandled pen op {op}")
    return out

def r3(n):
    v = round(n, 2)
    if v == int(v):
        return int(v)
    return v

def compact(cmds):
    out = []
    for c in cmds:
        out.append([c[0], *[r3(x) for x in c[1:]]])
    return out

def main():
    chars = collect_chars()
    print(f"charset: {len(chars)} chars", file=sys.stderr)
    col = TTCollection(str(TTC))
    font = col.fonts[2]  # Noto Sans CJK SC
    glyf_or_cff = "CFF " if "CFF " in font else ("glyf" if "glyf" in font else None)
    print("tables", glyf_or_cff, "units", font["head"].unitsPerEm, file=sys.stderr)
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]
    glyph_set = font.getGlyphSet()
    units = font["head"].unitsPerEm
    os2 = font["OS/2"]
    glyphs = {}
    missing = []
    for ch in chars:
        gid = cmap.get(ord(ch))
        if not gid:
            if ord(ch) >= 32:
                missing.append(ch)
            continue
        pen = RecordingPen()
        try:
            glyph_set[gid].draw(pen)
        except Exception as e:
            print("draw fail", ch, gid, e, file=sys.stderr)
            missing.append(ch)
            continue
        try:
            cmds = compact(flatten(pen.value))
        except Exception as e:
            print("flatten fail", ch, e, "ops", [op for op,_ in pen.value[:8]], file=sys.stderr)
            raise
        w, _lsb = hmtx[gid]
        glyphs[ch] = {"w": r3(w), "d": cmds}
    def fmt(n):
        v = round(n, 1)
        return str(int(v)) if abs(v - int(v)) < 1e-9 else str(v)
    packed = {}
    for ch, g in glyphs.items():
        parts = []
        for c in g["d"]:
            if c[0] == "Z":
                parts.append("Z")
            else:
                parts.append(c[0] + " ".join(fmt(x) for x in c[1:]))
        packed[ch] = {"w": g["w"], "d": "".join(parts)}
    out = {
        "font": "Noto Sans CJK SC",
        "unitsPerEm": units,
        "ascent": os2.sTypoAscender,
        "descent": os2.sTypoDescender,
        "glyphs": packed,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT}  glyphs={len(packed)}  missing={missing!r}  bytes={OUT.stat().st_size}", file=sys.stderr)

if __name__ == "__main__":
    main()
