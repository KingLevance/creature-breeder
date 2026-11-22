# Compare two sheets of the same grid cell by cell: list the cells that changed and write a montage of
# before | after pairs for them, largest change first.
#   python3 celldiff.py before.png after.png <cell px> <out.png> [max pairs] [pairs per row]
import sys
import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFont
a, b = Image.open(sys.argv[1]).convert('RGB'), Image.open(sys.argv[2]).convert('RGB')
cell, out = int(sys.argv[3]), sys.argv[4]
maxn = int(sys.argv[5]) if len(sys.argv) > 5 else 18
per = int(sys.argv[6]) if len(sys.argv) > 6 else 3
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 14)
if a.size != b.size:
    print('SIZE DIFFERS', a.size, b.size); sys.exit(1)
cols, rows = a.width // cell, a.height // cell
changed = []
for r in range(rows):
    for c in range(cols):
        box = (c * cell, r * cell, (c + 1) * cell, (r + 1) * cell)
        d = ImageChops.difference(a.crop(box), b.crop(box)).convert('L')
        n = int((np.asarray(d) > 12).sum())
        if n:
            changed.append((n / (cell * cell), r * cols + c, box))
changed.sort(reverse=True)
print(f'{len(changed)} of {cols * rows} cells changed:', ', '.join(f'#{i} ({p * 100:.1f}%)' for p, i, _ in changed))
if not changed:
    sys.exit(0)
show = changed[:maxn]
n = len(show)
W = per * (2 * cell + 8)
H = ((n + per - 1) // per) * (cell + 20)
sheet = Image.new('RGB', (W, H), '#15121f')
dr = ImageDraw.Draw(sheet)
for k, (p, i, box) in enumerate(show):
    x, y = (k % per) * (2 * cell + 8), (k // per) * (cell + 20)
    dr.text((x + 4, y + 2), f'#{i}   before | after   ({p * 100:.1f}% of pixels differ)', fill='#fff', font=font)
    sheet.paste(a.crop(box), (x, y + 20)); sheet.paste(b.crop(box), (x + cell, y + 20))
sheet.save(out)
print('wrote', out, sheet.size)
