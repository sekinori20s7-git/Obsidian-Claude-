"""サンプル漫画の文字入れ（英語セリフ・ナレーション・効果音）。

使い方: python letter_pages.py            # 全ページ
        python letter_pages.py 1 6        # 指定ページだけ
入力:  test/pN.png（文字なしの原画, 1024x1536）
出力:  lettered/pN.png と ../lp/sample/pN.webp
フォント: fonts/ の Comic Neue Bold・Bangers・Caveat（すべてSIL OFL。商用利用可）
セリフの出典は 20261017_ネーム_RunAfter40_8p.md。
"""
from __future__ import annotations
import math, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
SRC, OUT = HERE / "test", HERE / "lettered"
LP = HERE.parent / "lp" / "sample"
F_TALK = str(HERE / "fonts" / "ComicNeue-Bold.ttf")
F_SFX = str(HERE / "fonts" / "Bangers-Regular.ttf")
F_HAND = str(HERE / "fonts" / "Caveat[wght].ttf")
S = 2  # 2倍で描いて縮小（輪郭をなめらかにする）
INK, PAPER = (15, 15, 15, 255), (255, 255, 255, 255)


def font(path, size):
    return ImageFont.truetype(path, size * S)


def wrap(d, text, f, width):
    lines = []
    for para in text.split("\n"):
        cur = ""
        for w in para.split():
            t = (cur + " " + w).strip()
            if d.textlength(t, font=f) <= width * S or not cur:
                cur = t
            else:
                lines.append(cur)
                cur = w
        lines.append(cur)
    return lines


def block(d, lines, f, gap=1.18):
    lh = f.size * gap
    w = max(d.textlength(l, font=f) for l in lines)
    return w, lh * len(lines), lh


def draw_lines(d, lines, f, x, y, lh, fill, center=None):
    for i, l in enumerate(lines):
        lx = x if center is None else center - d.textlength(l, font=f) / 2
        d.text((lx, y + i * lh), l, font=f, fill=fill)


def caption(d, x, y, w, text, size=21, dark=False):
    f = font(F_TALK, size)
    lines = wrap(d, text.upper(), f, w - 24)
    tw, th, lh = block(d, lines, f)
    x, y, pad = x * S, y * S, 12 * S
    box = (x, y, x + tw + pad * 2, y + th + pad * 2 - f.size * 0.18)
    d.rectangle(box, fill=INK if dark else PAPER, outline=PAPER if dark else INK, width=3 * S)
    draw_lines(d, lines, f, x + pad, y + pad - f.size * 0.08, lh, PAPER if dark else INK)


def _ellipse_for(d, cx, cy, w, text, size):
    f = font(F_TALK, size)
    lines = wrap(d, text.upper(), f, w)
    tw, th, lh = block(d, lines, f)
    rx, ry = tw / 2 * 1.22 + 20 * S, th / 2 * 1.3 + 18 * S
    return f, lines, lh, th, cx * S, cy * S, rx, ry


def bubble(d, cx, cy, w, text, tail=None, size=22, dark=False, thought=False):
    f, lines, lh, th, cx, cy, rx, ry = _ellipse_for(d, cx, cy, w, text, size)
    fill, line = (INK, PAPER) if dark else (PAPER, INK)
    o = 3 * S
    tri = None
    if tail and not thought:
        tx, ty = tail[0] * S, tail[1] * S
        a = math.atan2(ty - cy, tx - cx)
        b1 = (cx + rx * 0.8 * math.cos(a - 0.28), cy + ry * 0.8 * math.sin(a - 0.28))
        b2 = (cx + rx * 0.8 * math.cos(a + 0.28), cy + ry * 0.8 * math.sin(a + 0.28))
        tri = [b1, (tx, ty), b2]
        d.polygon(tri, fill=line, outline=line, width=o * 2)
    d.ellipse((cx - rx - o, cy - ry - o, cx + rx + o, cy + ry + o), fill=line)
    if tri:
        d.polygon(tri, fill=fill)
    d.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=fill)
    if tail and thought:
        tx, ty = tail[0] * S, tail[1] * S
        a = math.atan2(ty - cy, tx - cx)
        ex, ey = cx + rx * math.cos(a), cy + ry * math.sin(a)
        for k, r in ((0.35, 13), (0.7, 8)):
            px, py = ex + (tx - ex) * k, ey + (ty - ey) * k
            r *= S
            d.ellipse((px - r - o, py - r - o, px + r + o, py + r + o), fill=line)
            d.ellipse((px - r, py - r, px + r, py + r), fill=fill)
    draw_lines(d, lines, f, 0, cy - th / 2 - f.size * 0.06, lh, line, center=cx)


def sfx(base, x, y, text, size=90, rot=-8):
    f = ImageFont.truetype(F_SFX, size * S)
    tmp = Image.new("RGBA", (size * S * (len(text) + 2), size * S * 2), (0, 0, 0, 0))
    td = ImageDraw.Draw(tmp)
    td.text((size * S // 2, size * S // 3), text, font=f, fill=INK, stroke_width=6 * S, stroke_fill=PAPER)
    tmp = tmp.crop(tmp.getbbox()).rotate(rot, expand=True, resample=Image.BICUBIC)
    base.alpha_composite(tmp, (x * S, y * S))


def note(d, x, y, w, text, size=30):
    f = ImageFont.truetype(F_HAND, size * S)
    f.set_variation_by_axes([700])
    lines = wrap(d, text, f, w - 30)
    tw, th, lh = block(d, lines, f, 1.05)
    x, y, pad = x * S, y * S, 14 * S
    d.rectangle((x, y, x + w * S, y + th + pad * 2), fill=(250, 248, 240, 255), outline=INK, width=3 * S)
    for i in range(len(lines)):
        ly = y + pad + (i + 1) * lh - 4 * S
        d.line((x + 8 * S, ly, x + w * S - 8 * S, ly), fill=(170, 170, 170, 255), width=S)
    draw_lines(d, lines, f, x + pad, y + pad - f.size * 0.12, lh, INK)


def big(d, box, text, size, sub=None, dark=False, font_path=F_SFX):
    x0, y0, x1, y1 = [v * S for v in box]
    f = ImageFont.truetype(font_path, size * S)
    lines = wrap(d, text, f, (x1 - x0) / S - 60)
    tw, th, lh = block(d, lines, f, 1.08)
    fs = font(F_TALK, 22) if sub else None
    total = th + (fs.size * 1.8 if sub else 0)
    top = (y0 + y1) / 2 - total / 2
    draw_lines(d, lines, f, 0, top, lh, PAPER if dark else INK, center=(x0 + x1) / 2)
    if sub:
        d.text(((x0 + x1) / 2 - d.textlength(sub, font=fs) / 2, top + th + fs.size * 0.6), sub, font=fs, fill=(215, 38, 61, 255))


# ---- ページごとの配置（座標は1024x1536の原画基準） -------------------------
PAGES = {
    1: [
        ("cap", dict(x=30, y=28, w=440, text="Hong Kong, 2017. I was 40, an expat, and running on empty.")),
        ("cap", dict(x=26, y=528, w=300, text="My only pleasure: a bowl of ramen at midnight.")),
        ("bub", dict(cx=200, cy=1090, w=250, size=20, text="I'm running a half marathon this weekend!", tail=(170, 1160))),
        ("tho", dict(cx=815, cy=620, w=300, size=20, text="…Is there any real reason he can do this and I can't?", tail=(800, 860))),
    ],
    2: [
        ("cap", dict(x=420, y=22, w=225, text="New shoes. A silent contract: no going back.")),
        ("tho", dict(cx=783, cy=100, w=130, size=15, text="Can't even make it to the next lamppost.", tail=(930, 60))),
        ("sfx", dict(x=470, y=540, text="HAH… HAH…", size=58, rot=-6)),
        ("cap", dict(x=610, y=1408, w=385, text="Just one kilometer. But it was a promise I'd kept to myself.")),
    ],
    3: [
        ("cap", dict(x=28, y=20, w=330, size=19, text="100 meters farther than yesterday.")),
        ("sfx", dict(x=700, y=380, text="GA YAU!", size=80, rot=-10)),
        ("cap", dict(x=28, y=578, w=420, text="Years later, back in Japan, I started a running club in Ibaraki.")),
        ("cap", dict(x=640, y=1064, w=355, text="Personal best: 3:21. Next: the mountains.")),
        ("bub", dict(cx=530, cy=1200, w=230, size=21, text="Sub-3. Then UTMB. Why not?", tail=(345, 1110))),
    ],
    4: [
        ("cap", dict(x=230, y=10, w=520, size=20, text="October 2026. The Hasetsune Cup — 71.5 km through the mountains of Tokyo.")),
        ("cap", dict(x=596, y=112, w=270, size=20, text="My second time. Goal: 13½ hours.")),
        ("tho", dict(cx=290, cy=590, w=200, size=18, text="A little less water than last year. Lighter is faster.", tail=(200, 700))),
        ("cap", dict(x=440, y=528, w=140, size=19, text="1:00 p.m.")),
        ("sfx", dict(x=560, y=560, text="BANG!", size=96, rot=-12)),
        ("cap", dict(x=600, y=1032, w=395, size=20, text="The plan: don't push the first 20 km. Eat early. No bonking.")),
        ("cap", dict(x=26, y=1440, w=400, size=20, text="But the afternoon was hot — 24°C.")),
    ],
    5: [
        ("cap", dict(x=26, y=14, w=330, text="Past halfway. Around 42 km.", dark=True)),
        ("cap", dict(x=26, y=402, w=360, text="Dehydrated. Then my stomach gave up. I couldn't keep any food down.", dark=True)),
        ("bub", dict(cx=810, cy=470, w=230, size=20, text="Keep going. Quitting is weakness.", tail=(820, 560), dark=True)),
        ("tho", dict(cx=780, cy=1150, w=360, size=20, text="No aid station until the next point. With this food… this water… I won't make it.", tail=(560, 1260))),
    ],
    6: [
        ("cap", dict(x=26, y=22, w=380, text="Two years of trail running. I had always finished.")),
        ("bub", dict(cx=175, cy=440, w=200, size=24, text="I'm dropping out.", tail=(350, 520))),
        ("big", dict(box=(518, 1110, 1010, 1512), text="DNF.", size=150, sub="Did Not Finish.", dark=True)),
    ],
    7: [
        ("cap", dict(x=28, y=12, w=320, text="The next day. My legs hurt. My pride hurt more.")),
        ("chat", dict(boxes=[(893, 195, 992, 245), (893, 255, 992, 305)], texts=["Nice try!", "That's going to pay off next time!"])),
        ("cap", dict(x=28, y=556, w=280, text="I wrote down everything.")),
        ("note", dict(x=690, y=560, w=305, size=28, text="1. Carry MORE water, not less.\n2. Train my stomach on longer runs.\n3. Plan for the heat.")),
        ("bub", dict(cx=210, cy=1200, w=270, size=21, text="When you win, you celebrate. When you fail, you start to think.", tail=(470, 1380))),
    ],
    8: [
        ("cap", dict(x=26, y=16, w=560, text="Finishing is only one kind of result. What matters is what you learn — and getting back up with your friends.")),
        ("cap", dict(x=26, y=764, w=240, size=20, text="That's my rinen. My philosophy. I learned it in the mud, not on a podium.", dark=True)),
        ("big", dict(box=(14, 1256, 1010, 1530), text="Every company has a DNF story. That's where your values really live.", size=50, sub="Let's draw yours. — Rinen Studio")),
    ],
}


def chat(d, boxes, texts):
    for (x0, y0, x1, y1), t in zip(boxes, texts):
        f = font(F_TALK, 11)
        lines = wrap(d, t, f, x1 - x0 - 10)
        while len(lines) * f.size * 1.1 > (y1 - y0 - 6) * S and f.size > 8 * S:
            f = ImageFont.truetype(F_TALK, f.size - S)
            lines = wrap(d, t, f, x1 - x0 - 10)
        tw, th, lh = block(d, lines, f, 1.05)
        d.rounded_rectangle((x0 * S, y0 * S, x1 * S, y1 * S), radius=10 * S, fill=PAPER, outline=(120, 120, 120, 255), width=S)
        draw_lines(d, lines, f, (x0 + 6) * S, (y0 + y1) / 2 * S - th / 2, lh, INK)


def letter(n: int):
    src = Image.open(SRC / f"p{n}.png").convert("RGBA")
    W, H = src.size
    layer = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for kind, kw in PAGES[n]:
        if kind == "cap":
            caption(d, **kw)
        elif kind == "bub":
            bubble(d, **kw)
        elif kind == "tho":
            bubble(d, thought=True, **kw)
        elif kind == "sfx":
            sfx(layer, **kw)
        elif kind == "note":
            note(d, **kw)
        elif kind == "big":
            big(d, **kw)
        elif kind == "chat":
            chat(d, **kw)
    out = Image.alpha_composite(src, layer.resize((W, H), Image.LANCZOS)).convert("RGB")
    OUT.mkdir(exist_ok=True)
    LP.mkdir(parents=True, exist_ok=True)
    out.save(OUT / f"p{n}.png")
    out.save(LP / f"p{n}.webp", "WEBP", quality=82, method=6)
    print(f"p{n} ok")


if __name__ == "__main__":
    for n in [int(a) for a in sys.argv[1:]] or sorted(PAGES):
        letter(n)
