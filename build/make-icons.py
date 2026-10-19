"""Generate app, extension and tray icons (run once; outputs are committed)."""
from PIL import Image, ImageDraw, ImageFilter
import math, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def rounded_bg(size, radius_frac=0.225):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    # vertical gradient: deep violet → teal
    grad = Image.new("RGBA", (size, size))
    px = grad.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * size)
            r = int(92 + (38 - 92) * t)
            g = int(60 + (150 - 60) * t)
            b = int(170 + (170 - 170) * t)
            px[x, y] = (r, g, b, 255)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * radius_frac), fill=255)
    img.paste(grad, (0, 0), mask)
    # soft highlight blob
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([-size * 0.2, -size * 0.3, size * 0.7, size * 0.5], fill=(255, 255, 255, 70))
    glow = glow.filter(ImageFilter.GaussianBlur(size * 0.12))
    img = Image.alpha_composite(img, Image.composite(glow, Image.new("RGBA", (size, size)), mask))
    return img


def draw_lines(draw, size, color, scale=1.0):
    """Three 'lyric lines' of decreasing emphasis — the app's motif."""
    s = size * scale
    x0 = size * 0.22
    h = s * 0.085
    rows = [(0.34, 0.56, 255), (0.50, 0.44, 160), (0.66, 0.36, 95)]
    for yf, wf, alpha in rows:
        y = size * yf
        c = (*color[:3], int(color[3] * alpha / 255))
        draw.rounded_rectangle([x0, y - h / 2, x0 + s * wf, y + h / 2], radius=h / 2, fill=c)


def app_icon(size):
    img = rounded_bg(size)
    d = ImageDraw.Draw(img)
    draw_lines(d, size, (255, 255, 255, 255))
    return img


def tray_icon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Template image: pure black with alpha; macOS tints it.
    x0 = size * 0.08
    h = max(1.4, size * 0.13)
    rows = [(0.25, 0.84, 255), (0.5, 0.62, 255), (0.75, 0.42, 255)]
    for yf, wf, alpha in rows:
        y = size * yf
        d.rounded_rectangle([x0, y - h / 2, x0 + size * wf, y + h / 2], radius=h / 2, fill=(0, 0, 0, alpha))
    return img


os.makedirs(os.path.join(ROOT, "extension", "icons"), exist_ok=True)
app_icon(1024).save(os.path.join(ROOT, "build", "icon.png"))
for n in (16, 48, 128):
    app_icon(512).resize((n, n), Image.LANCZOS).save(os.path.join(ROOT, "extension", "icons", f"icon{n}.png"))
tray_icon(16).save(os.path.join(ROOT, "build", "trayTemplate.png"))
tray_icon(32).save(os.path.join(ROOT, "build", "trayTemplate@2x.png"))
print("icons written")
