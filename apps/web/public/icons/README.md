# PWA icons — PLACEHOLDERS

`icon-192.png` and `icon-512.png` are **placeholder** app icons: a solid
`#0a0a0b` field (the app's `theme_color`) with white "OR" text, full-bleed so
the same file serves both the `purpose: "any"` and `purpose: "maskable"`
entries in `manifest.webmanifest` (kept as separate entries per size — a
combined `"any maskable"` string trips a manifest lint warning).

Replace them with real branding before GA. Keep the same filenames, sizes
(192×192, 512×512), format (PNG), and full-bleed background (no transparency,
no baked-in rounded corners — the OS applies the mask).

## Regenerating the placeholders

Needs Python with Pillow (`pip install Pillow`). Run from the repo root:

```python
import os
from PIL import Image, ImageDraw, ImageFont

OUT = "apps/web/public/icons"
BG, FG = (10, 10, 11), (255, 255, 255)  # #0a0a0b / white
FONTS = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Arial Bold.ttf",
]

def font_for(size):
    for p in FONTS:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def make(px):
    img = Image.new("RGB", (px, px), BG)
    d = ImageDraw.Draw(img)
    f = font_for(int(px * 0.42))  # inside the maskable safe zone
    b = d.textbbox((0, 0), "OR", font=f)
    w, h = b[2] - b[0], b[3] - b[1]
    d.text(((px - w) / 2 - b[0], (px - h) / 2 - b[1]), "OR", font=f, fill=FG)
    img.save(f"{OUT}/icon-{px}.png")

os.makedirs(OUT, exist_ok=True)
make(192)
make(512)
```
