"""Generate the PWA icon set for the Fitness Data Visualiser.

A heart-rate / ECG trace in the app accent blue on the app dark background.
Writes the sizes vite-plugin-pwa + iOS expect into web/public/icons/.

Requires Pillow:  python -m pip install Pillow
Run:              python deploy/make-icons.py
"""
import os
from PIL import Image, ImageDraw

BG = (20, 23, 28)        # #14171c app background
ACCENT = (95, 168, 230)  # #5fa8e6 app accent blue

OUT = os.path.join(os.path.dirname(__file__), "..", "web", "public", "icons")
os.makedirs(OUT, exist_ok=True)

# Normalised ECG polyline (x, y) in 0..1 — flat, small dip, tall spike, recover.
PULSE = [
    (0.08, 0.52), (0.30, 0.52), (0.37, 0.44), (0.44, 0.70),
    (0.52, 0.20), (0.60, 0.60), (0.67, 0.52), (0.92, 0.52),
]


def render(size, inset, rounded):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if rounded:
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=BG)
    else:
        d.rectangle([0, 0, size, size], fill=BG)

    # Map the pulse into the safe area (inset keeps it clear of maskable cropping).
    span = size * (1 - 2 * inset)
    pts = [(inset * size + x * span, inset * size + y * span) for x, y in PULSE]

    width = max(2, int(size * 0.06))
    r = width / 2
    for (x, y) in pts:  # rounded joints
        d.ellipse([x - r, y - r, x + r, y + r], fill=ACCENT)
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        d.line([x0, y0, x1, y1], fill=ACCENT, width=width)

    return img


def save(img, name):
    img.save(os.path.join(OUT, name))
    print("wrote", name)


save(render(192, 0.18, rounded=True), "pwa-192x192.png")
save(render(512, 0.18, rounded=True), "pwa-512x512.png")
save(render(512, 0.28, rounded=False), "maskable-512x512.png")          # full-bleed safe zone
save(render(180, 0.18, rounded=False).convert("RGB"), "apple-touch-icon-180x180.png")
save(render(32, 0.12, rounded=True), "favicon-32x32.png")
