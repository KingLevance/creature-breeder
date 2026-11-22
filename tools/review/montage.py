# Tile screenshots side by side with their names: python3 montage.py <out.png> <cols> <cellw> <img...>
import sys
from PIL import Image, ImageDraw, ImageFont
out, cols, cw = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
files = sys.argv[4:]
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 13)
ims = []
for f in files:
    im = Image.open(f).convert('RGB')
    h = round(im.height * cw / im.width)
    ims.append((f.split('/')[-1].replace('.png', ''), im.resize((cw, h), Image.LANCZOS)))
ch = max(im.height for _, im in ims) + 18
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * cw, rows * ch), '#101018')
d = ImageDraw.Draw(sheet)
for i, (n, im) in enumerate(ims):
    x, y = (i % cols) * cw, (i // cols) * ch
    d.text((x + 4, y + 2), n, fill='#fff', font=font)
    sheet.paste(im, (x, y + 18))
sheet.save(out)
print(out, sheet.size)
