# -*- coding: utf-8 -*-
"""
鲸鱼娘素材处理器
================================================

输入（assets-src/）：
    whale-girl-logo.png                —— Q 版头像（带透明通道）
    dafeiyu-chibi-character-sheet.png  —— Q 版设定图
    dafeiyu-mature-character-sheet.png —— 成熟比例设定图

输出：
    1. 启动图标（含 adaptive icon 前景 + 传统密度图标）-> android/res/
       支持在设置里动态切换桌面图标
    2. 网页端插图 -> android/assets/www/img/

素材来源：https://github.com/TreapGoGo/deepseek-whale-girl
授权：MIT License, Copyright (c) 2026 TreapGoGo
（鲸鱼娘是社区二创形象，与深度求索公司无隶属关系）

用法： python tools/whale_assets.py
"""

import os
import sys
from PIL import Image, ImageDraw, ImageFilter
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, 'assets-src')
ANDROID = os.path.join(ROOT, 'android')
RES = os.path.join(ANDROID, 'res')
WWW_IMG = os.path.join(ANDROID, 'assets', 'www', 'img')

DENSITIES = [
    ('mdpi', 48, 108),
    ('hdpi', 72, 162),
    ('xhdpi', 96, 216),
    ('xxhdpi', 144, 324),
    ('xxxhdpi', 192, 432),
]


# --------------------------------------------------------------- 工具函数

def load(name):
    return Image.open(os.path.join(SRC, name)).convert('RGBA')


def trim_alpha(im, pad_ratio=0.04):
    """按 alpha 通道裁掉透明边，再留一点边距"""
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    pad = int(max(im.size) * pad_ratio)
    out = Image.new('RGBA', (im.width + pad * 2, im.height + pad * 2), (0, 0, 0, 0))
    out.paste(im, (pad, pad))
    return out


def remove_white(im, thresh=42):
    """
    抠掉设定图的白底。

    关键点：不能用「所有接近白色的像素都变透明」这种判断——
    眼白、围裙、蕾丝高光都是白的，那样会把人物挖出一堆洞。
    正确做法是从画面四边往里 flood fill，只抠**与边缘连通的**那片白。
    """
    im = im.convert('RGBA')
    w, h = im.size
    rgb = im.convert('RGB')
    sentinel = (255, 0, 255)

    seeds = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1),
             (w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2)]

    for s in seeds:
        p = rgb.getpixel(s)
        if p == sentinel:
            continue
        # 只从「本身是接近白色」的边界点开始灌
        if p[0] >= 232 and p[1] >= 232 and p[2] >= 232:
            ImageDraw.floodfill(rgb, s, sentinel, thresh=thresh)

    a = np.array(rgb).astype(np.int16)
    is_bg = (a[:, :, 0] == 255) & (a[:, :, 1] == 0) & (a[:, :, 2] == 255)
    out = np.array(im)
    out[:, :, 3] = np.where(is_bg, 0, out[:, :, 3])
    return Image.fromarray(out, 'RGBA')


def fit_contain(im, box_w, box_h):
    """等比缩放到能放进 box，不裁剪"""
    scale = min(box_w / im.width, box_h / im.height)
    return im.resize((max(1, int(im.width * scale)),
                      max(1, int(im.height * scale))), Image.LANCZOS)


def fit_square(im, size, bg=None):
    """等比缩放并居中放到正方形画布上"""
    im = im.copy()
    im.thumbnail((size, size), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), bg or (0, 0, 0, 0))
    canvas.paste(im, ((size - im.width) // 2, (size - im.height) // 2), im)
    return canvas


def center_crop_square(im):
    """居中裁成正方形"""
    w, h = im.size
    s = min(w, h)
    return im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s))


def circle_mask(size, inset=0):
    m = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(m)
    d.ellipse((inset, inset, size - 1 - inset, size - 1 - inset), fill=255)
    return m


def rounded_mask(size, radius_ratio=0.22):
    m = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(m)
    r = int(size * radius_ratio)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=r, fill=255)
    return m


def linear_gradient(size, c1, c2, diagonal=True):
    """生成线性渐变（左上 -> 右下）"""
    w, h = size
    base = Image.new('RGB', (w, h))
    px = base.load()
    for y in range(h):
        for x in range(w):
            t = ((x / max(1, w - 1)) + (y / max(1, h - 1))) / 2 if diagonal else (y / max(1, h - 1))
            px[x, y] = (
                int(c1[0] + (c2[0] - c1[0]) * t),
                int(c1[1] + (c2[1] - c1[1]) * t),
                int(c1[2] + (c2[2] - c1[2]) * t),
            )
    return base.convert('RGBA')


# --------------------------------------------------------------- 图标定义

# res: 生成的资源名前缀（会写入 mipmap-*/<res>.png 与 mipmap-anydpi-v26/<res>.xml）
# fg : 'logo' 用 Q 版头像；'q_face' 用 Q 版面部特写；'m_face' 用成熟版面部特写
# bg : 背景渐变两端颜色
ICON_VARIANTS = [
    {
        'id': 'whale_q_blue',
        'res': 'ic_launcher',
        'label': 'Q版鲸鱼娘 · 深海蓝（默认）',
        'fg': 'logo',
        'bg': ((0x1E, 0x63, 0xD8), (0x0B, 0x2E, 0x6B)),
    },
    {
        'id': 'whale_q_pink',
        'res': 'ic_launcher_pink',
        'label': 'Q版鲸鱼娘 · 樱花粉',
        'fg': 'logo',
        'bg': ((0xFF, 0x8F, 0xC8), (0xC2, 0x3B, 0x86)),
    },
    {
        'id': 'whale_q_light',
        'res': 'ic_launcher_light',
        'label': 'Q版鲸鱼娘 · 清透白',
        'fg': 'logo',
        'bg': ((0xEE, 0xF4, 0xFF), (0xC9, 0xDC, 0xF7)),
    },
    {
        'id': 'whale_q_face',
        'res': 'ic_launcher_face',
        'label': 'Q版鲸鱼娘 · 表情包',
        'fg': 'q_face',
        'bg': ((0x2E, 0x7B, 0xE8), (0x12, 0x3C, 0x8A)),
        'fill': True,          # 铺满方格，不裁圆、不描边、不留白边
    },
    {
        'id': 'whale_m_blue',
        'res': 'ic_launcher_mature',
        'label': '鲸鱼娘 · 成熟版',
        'fg': 'm_face',
        'bg': ((0x30, 0x53, 0xC8), (0x10, 0x1C, 0x5E)),
        'fill': True,
    },
    {
        'id': 'fish_meme',
        'res': 'ic_launcher_fish',
        'label': '大肥鱼',
        'fg': 'fish',
        'bg': None,            # None = 不要渐变底
        'white': True,         # 改成纯白底
        'fill': True,
        'anchor': 'se',        # 图案右下角对齐方格右下角
    },
]


def build_foregrounds(sources):
    """所有图标共用的前景图（同一种表情只生成一份，多个背景复用）"""
    out = {}

    logo = trim_alpha(sources['logo'])
    out['logo'] = logo

    q_face = center_crop_square(sources['q_face'])
    out['q_face'] = q_face

    m_face = center_crop_square(sources['m_face'])
    out['m_face'] = m_face

    # 表情包本来就是带透明通道的半身像，不用再裁圆
    out['fish'] = trim_alpha(sources['fish'])

    return out


def write_adaptive_foreground(fg_img, kind, name, fill=False):
    """
    生成 adaptive icon 的前景：108dp 画布，内容放在中间安全区内。
    带透明通道，交给启动器裁剪。fill=True 时铺满整块画布。
    """
    for dens, _legacy, fg_size in DENSITIES:
        target_dir = os.path.join(RES, 'drawable-' + dens)
        os.makedirs(target_dir, exist_ok=True)

        canvas = Image.new('RGBA', (fg_size, fg_size), (0, 0, 0, 0))
        inner = int(fg_size * (0.99 if fill else 0.60))   # 安全区约 66/108

        if fill:
            art = fit_square(fg_img, inner)
        elif kind == 'logo':
            art = fit_square(fg_img, inner)
        else:
            # 面部特写裁成圆形，更像一枚头像
            art = fit_square(fg_img, inner)
            art = art.resize((inner, inner), Image.LANCZOS)
            mask = circle_mask(inner, inset=max(2, inner // 90))
            circled = Image.new('RGBA', (inner, inner), (0, 0, 0, 0))
            circled.paste(art, (0, 0), mask)

            # 描一圈半透明白边，提升在深色背景上的辨识度
            ring = Image.new('RGBA', (inner, inner), (0, 0, 0, 0))
            rd = ImageDraw.Draw(ring)
            rd.ellipse((1, 1, inner - 2, inner - 2), outline=(255, 255, 255, 190),
                       width=max(2, inner // 80))
            circled = Image.alpha_composite(circled, ring)
            art = circled

        canvas.paste(art, ((fg_size - art.width) // 2, (fg_size - art.height) // 2), art)
        canvas.save(os.path.join(target_dir, 'ic_fg_%s.png' % name), optimize=True)


def paste_art(canvas, art, anchor='center'):
    """把图案贴到画布上；anchor='se' 表示右下角对齐"""
    size = canvas.width
    if anchor == 'se':
        pos = (size - art.width, size - art.height)
    else:
        pos = ((size - art.width) // 2, (size - art.height) // 2)
    canvas.paste(art, pos, art)
    return canvas


def write_legacy_icon(fg_img, kind, variant, name):
    """传统启动图标（API 24/25 使用）：背景 + 图案"""
    bg_colors = variant.get('bg')
    white_bg = bool(variant.get('white'))
    # 铺满款：图案放大到几乎占满方格，不裁圆不描边
    fill = bool(variant.get('fill'))
    anchor = variant.get('anchor', 'center')

    for dens, legacy_size, _fg in DENSITIES:
        target_dir = os.path.join(RES, 'mipmap-' + dens)
        os.makedirs(target_dir, exist_ok=True)

        if fill:
            inner = int(legacy_size * 0.99)
        elif bg_colors is None:
            inner = int(legacy_size * 0.94)
        else:
            inner = int(legacy_size * 0.74)

        if kind in ('logo', 'fish') or fill:
            art = fit_square(fg_img, inner)
        else:
            art = fit_square(fg_img, inner)
            art = art.resize((inner, inner), Image.LANCZOS)
            mask = circle_mask(inner, inset=max(1, inner // 90))
            circled = Image.new('RGBA', (inner, inner), (0, 0, 0, 0))
            circled.paste(art, (0, 0), mask)
            art = circled

        if white_bg:
            bg = Image.new('RGBA', (legacy_size, legacy_size), (255, 255, 255, 255))
        elif bg_colors is None:
            bg = Image.new('RGBA', (legacy_size, legacy_size), (0, 0, 0, 0))
        else:
            c1, c2 = bg_colors
            bg = linear_gradient((legacy_size, legacy_size), c1, c2)
            bg.putalpha(rounded_mask(legacy_size))
        paste_art(bg, art, anchor).save(
            os.path.join(target_dir, '%s.png' % name), optimize=True)

        # 圆形版
        if white_bg:
            round_bg = Image.new('RGBA', (legacy_size, legacy_size), (255, 255, 255, 255))
        elif bg_colors is None:
            round_bg = Image.new('RGBA', (legacy_size, legacy_size), (0, 0, 0, 0))
        else:
            c1, c2 = bg_colors
            round_bg = linear_gradient((legacy_size, legacy_size), c1, c2)
            round_bg.putalpha(circle_mask(legacy_size))
        paste_art(round_bg, art, anchor).save(
            os.path.join(target_dir, '%s_round.png' % name), optimize=True)


FG_DRAWABLE = {
    'logo': 'ic_fg_logo',
    'q_face': 'ic_fg_q_face',
    'm_face': 'ic_fg_m_face',
    'fish': 'ic_fg_fish',
}


def write_adaptive_xml(variant, name):
    """adaptive-icon 描述文件 + 背景矢量图"""
    anydpi = os.path.join(RES, 'mipmap-anydpi-v26')
    os.makedirs(anydpi, exist_ok=True)
    drawable = os.path.join(RES, 'drawable')
    os.makedirs(drawable, exist_ok=True)

    if variant.get('white'):
        # 纯白底（大肥鱼图标）
        bg_xml = '''<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path android:pathData="M0,0h108v108h-108z" android:fillColor="#FFFFFFFF" />
</vector>
'''
        with open(os.path.join(drawable, 'ic_bg_%s.xml' % name), 'w', encoding='utf-8') as f:
            f.write(bg_xml)
        bg_ref = '@drawable/ic_bg_%s' % name
    elif variant.get('bg') is None:
        # 透明背景：adaptive icon 必须有个 background，这里用系统透明色
        bg_ref = '@android:color/transparent'
    else:
        c1, c2 = variant['bg']
        hexc = lambda c: '#FF%02X%02X%02X' % c

        bg_xml = '''<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:aapt="http://schemas.android.com/aapt"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path android:pathData="M0,0h108v108h-108z">
        <aapt:attr name="android:fillColor">
            <gradient
                android:endX="108"
                android:endY="108"
                android:startX="0"
                android:startY="0"
                android:type="linear">
                <item android:color="%s" android:offset="0" />
                <item android:color="%s" android:offset="1" />
            </gradient>
        </aapt:attr>
    </path>
</vector>
''' % (hexc(c1), hexc(c2))

        with open(os.path.join(drawable, 'ic_bg_%s.xml' % name), 'w', encoding='utf-8') as f:
            f.write(bg_xml)
        bg_ref = '@drawable/ic_bg_%s' % name

    adaptive = '''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="%s" />
    <foreground android:drawable="@drawable/%s" />
</adaptive-icon>
''' % (bg_ref, FG_DRAWABLE[variant['fg']])

    for fname in ('%s.xml' % name, '%s_round.xml' % name):
        with open(os.path.join(anydpi, fname), 'w', encoding='utf-8') as f:
            f.write(adaptive)


# --------------------------------------------------------------- 网页插图

def make_theme_bg(character, top_color, bottom_color, size=(640, 1138)):
    """
    生成主题的默认背景：竖版正面立绘 + 竖向渐变底。

    设定图是白底的，先抠掉与边缘连通的白底再叠到渐变上，
    否则会带一个白色方块，或者把人物内部的白色一起挖空。
    """
    W, H = size
    canvas = linear_gradient((W, H), top_color, bottom_color, diagonal=False).convert('RGBA')
    canvas.putalpha(255)

    art = trim_alpha(character, pad_ratio=0.01)
    if art.width == 0 or art.height == 0:
        return canvas

    # 人物高度占画面约 74%，贴着底边放，看起来像站在画面里
    target_h = int(H * 0.74)
    art = fit_contain(art, int(W * 0.9), target_h)

    x = (W - art.width) // 2
    y = H - art.height - int(H * 0.04)
    canvas.paste(art, (x, y), art)
    return canvas


def write_web_images(sources, fg):
    os.makedirs(WWW_IMG, exist_ok=True)

    # 主题头像（透明）
    mascot = fit_square(trim_alpha(sources['logo']), 256)
    mascot.save(os.path.join(WWW_IMG, 'mascot-q.png'), optimize=True)

    # 表情包头像（用户提供的那张，本身就是透明底）
    fish = fit_square(fg['fish'], 320)
    fish.save(os.path.join(WWW_IMG, 'mascot-fish.png'), optimize=True)

    # 主题默认背景（竖版正面立绘）。渐变底不透明，存 JPEG 体积小很多
    make_theme_bg(sources['q_body'], (0x1B, 0x3A, 0x7A), (0x08, 0x11, 0x2B)) \
        .convert('RGB').save(os.path.join(WWW_IMG, 'bg-q.jpg'), quality=86, optimize=True)
    make_theme_bg(sources['m_body'], (0x24, 0x2F, 0x6E), (0x0A, 0x0E, 0x28)) \
        .convert('RGB').save(os.path.join(WWW_IMG, 'bg-m.jpg'), quality=86, optimize=True)

    # Q 版面部特写
    qf = center_crop_square(sources['q_face']).resize((320, 320), Image.LANCZOS)
    qf.save(os.path.join(WWW_IMG, 'mascot-q-face.png'), optimize=True)

    # 成熟版面部特写
    mf = center_crop_square(sources['m_face']).resize((320, 320), Image.LANCZOS)
    mf.save(os.path.join(WWW_IMG, 'mascot-m-face.png'), optimize=True)

    # 立绘（用于目标卡片兜底插图 / 关于页）
    qb = sources['q_body']
    qb.thumbnail((360, 560), Image.LANCZOS)
    qb.save(os.path.join(WWW_IMG, 'art-q.png'), optimize=True)

    mb = sources['m_body']
    mb.thumbnail((260, 560), Image.LANCZOS)
    mb.save(os.path.join(WWW_IMG, 'art-m.png'), optimize=True)


# --------------------------------------------------------------- 主流程

def main():
    need = [
        'whale-girl-logo.png',
        'dafeiyu-chibi-character-sheet.png',
        'dafeiyu-mature-character-sheet.png',
        'dafeiyu-meme-face.png',
    ]
    for n in need:
        if not os.path.exists(os.path.join(SRC, n)):
            print('缺少素材：%s' % n)
            sys.exit(1)

    print('读取素材 ...')
    sheet_q = load('dafeiyu-chibi-character-sheet.png').convert('RGB')
    sheet_m = load('dafeiyu-mature-character-sheet.png').convert('RGB')

    # 关键顺序：先在整张设定图上把白底抠掉，再裁剪。
    # 反过来做的话，裁切出来的直边会把一部分背景封成封闭区域，
    # flood fill 进不去，叠到渐变上就会留下一个白方块。
    print('抠掉设定图白底 ...')
    cut_q = remove_white(sheet_q)
    cut_m = remove_white(sheet_m)

    sources = {
        'logo': load('whale-girl-logo.png'),
        'fish': load('dafeiyu-meme-face.png'),
        'sheet_q': sheet_q,
        'sheet_m': sheet_m,
        'q_body': cut_q.crop((11, 10, 535, 620)),
        'q_face': cut_q.crop((16, 636, 570, 1080)),
        # 成熟版正面立绘的右边界在 x≈370（裙摆最宽处）；
        # 再往右是旁边侧视图角色的头发，裁到 380 刚好避开
        'm_body': cut_m.crop((12, 10, 380, 1030)),
        'm_face': cut_m.crop((1060, 55, 1440, 500)),
    }

    print('生成图标前景 ...')
    fgs = build_foregrounds(sources)
    # 每种表情只生成一份前景，多个背景复用（减小包体）
    write_adaptive_foreground(fgs['logo'], 'logo', 'logo')
    write_adaptive_foreground(fgs['q_face'], 'face', 'q_face', fill=True)
    write_adaptive_foreground(fgs['m_face'], 'face', 'm_face', fill=True)
    write_adaptive_foreground(fgs['fish'], 'logo', 'fish', fill=True)

    print('生成启动图标 ...')
    for v in ICON_VARIANTS:
        name = v['res']
        kind = 'logo' if v['fg'] == 'logo' else 'face'
        write_legacy_icon(fgs[v['fg']], kind, v, name)
        write_adaptive_xml(v, name)
        print('   %-22s %s' % (name, v['label']))

    print('生成网页插图 ...')
    write_web_images(sources, fgs)

    # 顺便把真实图标导一份到网页目录，设置页的预览就用它，
    # 这样预览和桌面上的实际图标完全一致（含白底、是否留边）
    print('导出图标预览 ...')
    # classic 由 tools/make-icons.js 生成，不在这份 ICON_VARIANTS 里，
    # 但只要文件已经存在，就一并导出预览
    preview_srcs = [(v['id'], v['res']) for v in ICON_VARIANTS]
    preview_srcs.append(('classic', 'ic_launcher_classic'))
    for vid, res in preview_srcs:
        s = os.path.join(RES, 'mipmap-xxxhdpi', '%s.png' % res)
        if os.path.exists(s):
            Image.open(s).convert('RGBA').resize((192, 192), Image.LANCZOS) \
                 .save(os.path.join(WWW_IMG, 'icon-%s.png' % vid), optimize=True)
        else:
            print('   跳过 %s（缺 %s.png）' % (vid, res))

    print('完成。')
    print('图标变体数量：%d' % len(ICON_VARIANTS))


if __name__ == '__main__':
    main()
