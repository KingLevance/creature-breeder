# Films a line-up of living creatures (standing or walking) on the frozen clock: one contact sheet per creature,
# so breathing, swaying, tails and legs can be judged frame by frame.
#   python3 zoo_cap.py <dist> <out> <casedir> <port> <idle|walk|run> [--step=80] [--frames=24] [--ids=m0,m1,...]
import sys, os, json, subprocess, time, io, atexit
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFont
args = [a for a in sys.argv[1:] if not a.startswith('--')]
opts = dict(a[2:].split('=') for a in sys.argv[1:] if a.startswith('--'))
dist, out, casedir, port, mode = args[:5]
STEP = int(opts.get('step', 80)); N = int(opts.get('frames', 24))
ids = opts.get('ids', 'm0,m1,m2,m3,m4,m5').split(',')
os.makedirs(out, exist_ok=True)
save = json.load(open(f'{casedir}/save_menus.json'))
lab = {'kind': 'zoo', 'ids': ids, 'size': 170, 'cols': 2, 'walking': mode in ('walk', 'run'), 'bg': '#6fbf5a'}
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 12)
srv = subprocess.Popen([sys.executable, '-m', 'http.server', port, '--bind', '127.0.0.1', '-d', dist], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
atexit.register(srv.terminate)
time.sleep(1)
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=1)
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
    pg.add_init_script('(() => { let a = 20261121; Math.random = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();')
    pg.add_init_script('localStorage.setItem("hatchlore.save.v1", %s); localStorage.setItem("hatchlore.lab", %s);' % (json.dumps(json.dumps(save)), json.dumps(json.dumps(lab))))
    pg.clock.install(time=1795262400)
    pg.goto(f'http://127.0.0.1:{port}/index.html')
    pg.wait_for_timeout(900)
    pg.clock.pause_at((pg.evaluate('Date.now()') + 500) / 1000)
    for _ in range(20):
        pg.clock.run_for(150); pg.wait_for_timeout(10)
    frames = []
    for i in range(N):
        frames.append(Image.open(io.BytesIO(pg.screenshot())).convert('RGB'))
        pg.clock.run_for(STEP); pg.wait_for_timeout(10)
    b.close()
cw, ch = 195, 192
for k, cid in enumerate(ids):
    x0, y0 = (k % 2) * cw, (k // 2) * ch
    cols = 8
    rows = (N + cols - 1) // cols
    sheet = Image.new('RGB', (cols * cw, rows * ch), '#111')
    d = ImageDraw.Draw(sheet)
    for i, im in enumerate(frames):
        x, y = (i % cols) * cw, (i // cols) * ch
        sheet.paste(im.crop((x0, y0, x0 + cw, y0 + ch)), (x, y))
        d.rectangle([x, y, x + 50, y + 15], fill='#000'); d.text((x + 3, y + 1), f'{i * STEP}ms', fill='#fff', font=font)
    name = next((c['name'] for c in save['creatures'] if c['id'] == cid), cid)
    sheet.save(f'{out}/{mode}_{k}_{name}.png')
print(mode, 'frames', N, 'errors', errs[:2])
