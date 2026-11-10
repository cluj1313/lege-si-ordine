#!/usr/bin/env python3
"""Generează icoanele Android din brand/emblem.png (Justiția)."""
import os
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'brand', 'emblem.png')
RES = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
if not os.path.isdir(RES):
    raise SystemExit('android/res lipsește; rulează mai întâi npx cap add android')
img = Image.open(SRC).convert('RGBA')
# fundal negru, ca în emblemă
BG = (0, 0, 0, 255)

def fit_on(size, scale=1.0, bg=BG):
    canvas = Image.new('RGBA', (size, size), bg)
    side = max(1, int(size * scale))
    emblem = img.copy()
    emblem.thumbnail((side, side), Image.Resampling.LANCZOS)
    x = (size - emblem.width) // 2
    y = (size - emblem.height) // 2
    canvas.alpha_composite(emblem, (x, y))
    return canvas

# densități legacy (48dp) și adaptive foreground (108dp)
legacy = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
fg = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}
for dens, px in legacy.items():
    d = os.path.join(RES, f'mipmap-{dens}')
    os.makedirs(d, exist_ok=True)
    # puține marge, inelul rămâne vizibil pe icoana pătrată/rotundă clasică
    ico = fit_on(px, 0.96)
    ico.save(os.path.join(d, 'ic_launcher.png'), 'PNG')
    ico.save(os.path.join(d, 'ic_launcher_round.png'), 'PNG')
for dens, px in fg.items():
    d = os.path.join(RES, f'mipmap-{dens}')
    os.makedirs(d, exist_ok=True)
    # zona sigură adaptive ~66%; 72% păstrează inelul în interiorul măștii
    fit_on(px, 0.72, (0, 0, 0, 0)).save(os.path.join(d, 'ic_launcher_foreground.png'), 'PNG')

# resurse adaptive
mipmap_any = os.path.join(RES, 'mipmap-anydpi-v26')
os.makedirs(mipmap_any, exist_ok=True)
for name in ('ic_launcher.xml', 'ic_launcher_round.xml'):
    with open(os.path.join(mipmap_any, name), 'w') as f:
        f.write('''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
''')
values = os.path.join(RES, 'values')
os.makedirs(values, exist_ok=True)
colors = os.path.join(values, 'ic_launcher_background.xml')
with open(colors, 'w') as f:
    f.write('''<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#000000</color>
</resources>
''')
# icoană 512 pentru referință (nu se pune în APK obligatoriu)
out512 = os.path.join(ROOT, 'brand', 'icon-512-android.png')
fit_on(512, 0.96).save(out512, 'PNG')
print('icoane Android generate din brand/emblem.png')
