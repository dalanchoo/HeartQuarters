"""Builds HeartQuarters' icons from the Heart Mind Fusion logo cut-out.

The logo sits on a dark rounded tile with an orange glow on the heart side and
a blue glow on the brain side (like the HMF title card).

Outputs:
  assets/heartquarters.ico   Windows shortcut icon (16-256 px)
  web/public/icon.png        512 px, shown in the app header
  web/public/favicon.png     64 px, the browser tab icon

Run:  <python with Pillow + numpy> scripts/make_icon.py [path/to/logo.png]
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_LOGO = Path(
    r"D:\Google Drive\HeartMind\HMF_SYS\Skills\HMF_Skills\longform-edit\scripts\graphics\hyperframes starter\assets\hero-alpha-filled.png"
)

SIZE = 1024
RADIUS = 220  # corner rounding of the tile
TILE_TOP = (38, 34, 30)
TILE_BOTTOM = (16, 14, 12)
ORANGE = (255, 140, 40)
BLUE = (40, 130, 255)


def vertical_gradient(size, top, bottom):
    img = Image.new("RGB", (1, size))
    for y in range(size):
        t = y / (size - 1)
        img.putpixel((0, y), tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
    return img.resize((size, size))


def glow(color, center, radius, strength):
    layer = Image.new("RGBA", (SIZE, SIZE), color + (0,))
    mask = Image.new("L", (SIZE, SIZE), 0)
    cx, cy = center
    ImageDraw.Draw(mask).ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=strength)
    layer.putalpha(mask.filter(ImageFilter.GaussianBlur(radius * 0.6)))
    return layer


def build(logo_path: Path) -> Image.Image:
    tile = vertical_gradient(SIZE, TILE_TOP, TILE_BOTTOM).convert("RGBA")
    tile = Image.alpha_composite(tile, glow(ORANGE, (SIZE * 0.30, SIZE * 0.52), 300, 150))
    tile = Image.alpha_composite(tile, glow(BLUE, (SIZE * 0.72, SIZE * 0.52), 300, 150))

    logo = Image.open(logo_path).convert("RGBA")
    logo = logo.crop(logo.getchannel("A").point(lambda a: 255 if a > 20 else 0).getbbox())
    scale = (SIZE * 0.78) / max(logo.size)
    logo = logo.resize((round(logo.width * scale), round(logo.height * scale)), Image.LANCZOS)

    # Soft shadow under the logo so it lifts off the tile.
    shadow = Image.new("RGBA", logo.size, (0, 0, 0, 0))
    shadow.putalpha(logo.getchannel("A").point(lambda a: a * 0.6))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))

    x = (SIZE - logo.width) // 2
    y = (SIZE - logo.height) // 2
    tile.alpha_composite(shadow, (x + 10, y + 22))
    tile.alpha_composite(logo, (x, y))

    rounded = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(rounded).rounded_rectangle((0, 0, SIZE - 1, SIZE - 1), RADIUS, fill=255)
    tile.putalpha(rounded)
    return tile


def main():
    logo_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_LOGO
    icon = build(logo_path)

    (ROOT / "assets").mkdir(exist_ok=True)
    (ROOT / "web" / "public").mkdir(parents=True, exist_ok=True)

    icon.resize((512, 512), Image.LANCZOS).save(ROOT / "web" / "public" / "icon.png")
    icon.resize((64, 64), Image.LANCZOS).save(ROOT / "web" / "public" / "favicon.png")
    icon.resize((256, 256), Image.LANCZOS).save(
        ROOT / "assets" / "heartquarters.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print("Icons written to assets/ and web/public/")


if __name__ == "__main__":
    main()
