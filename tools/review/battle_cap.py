# Films fights from the test bench on a fake clock: every frame is taken at an exact game time, so two builds
# can be compared frame for frame. Writes one contact sheet per case.
#   python3 battle_cap.py <dist> <out> <casedir> <port> [case names... | all] [--step=45] [--scale=1]
import sys, os, json, subprocess, time, io, re
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFont

args = [a for a in sys.argv[1:] if not a.startswith('--')]
opts = dict(a[2:].split('=') for a in sys.argv[1:] if a.startswith('--'))
dist, out, casedir, port = args[0], args[1], args[2], args[3]
names = args[4:]
STEP = int(opts.get('step', 70))
COLS = int(opts.get('cols', 4))
ROWS = int(opts.get('rows', 5))
DPR = float(opts.get('dpr', 1))
SHEETS = int(opts.get('sheets', 0))    # 0: as many as the case asks for
KEEP = opts.get('keep') == '1'          # also keep the single frames
FULL = opts.get('full') == '1'          # film the whole screen, not just the field
index = json.load(open(f'{casedir}/index.json'))
if not names or names == ['all']:
    names = [c['name'] for c in index]
os.makedirs(out, exist_ok=True)
NOW = 1795262400000  # 2026-11-21T12:00:00Z
SEED = '''(() => { let a = 20261121; Math.random = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();'''
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 13)
except Exception:
    font = ImageFont.load_default()

srv = subprocess.Popen([sys.executable, '-m', 'http.server', port, '--bind', '127.0.0.1', '-d', dist], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
import atexit
atexit.register(srv.terminate)
time.sleep(1)
report = []
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--no-sandbox'])
    for name in names:
      try:
          case = json.load(open(f'{casedir}/fight_{name}.json'))
          errors = []
          ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=DPR)
          pg = ctx.new_page()
          pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)[:200]))
          pg.on('console', lambda m: errors.append(m.text[:200]) if m.type == 'error' and '404' not in m.text else None)
          pg.add_init_script(SEED)
          pg.add_init_script('localStorage.setItem("hatchlore.save.v1", %s); localStorage.setItem("hatchlore.lab", %s);' % (json.dumps(json.dumps(case['save'])), json.dumps(json.dumps(case['lab']))))
          pg.clock.install(time=NOW / 1000)
          pg.goto(f'http://127.0.0.1:{port}/index.html')
          pg.wait_for_timeout(700)
          # Freeze the game clock: from here time only moves when this script says so.
          pg.clock.pause_at((pg.evaluate('Date.now()') + 500) / 1000)
          ok = False
          for _ in range(160):  # walk in, line up, and let anyone ahead of the hero take a turn (skipped through quickly)
              pg.clock.fast_forward(240)
              pg.wait_for_timeout(10)
              if pg.get_by_text("Hero's turn", exact=True).count():
                  ok = True
                  break
              if pg.get_by_text("Pick a move", exact=True).count() and pg.get_by_text('Strike', exact=True).count():
                  try:
                      pg.get_by_text('Strike', exact=True).first.click(timeout=3000, no_wait_after=True)
                  except Exception:
                      pass
          pg.clock.run_for(600)
          pg.wait_for_timeout(30)
          clip = None if FULL else {'x': 0, 'y': 86, 'width': 390, 'height': 364}
          frames = []
          taps = list(case['taps'])
          targets = list(case.get('targets') or ['Foe1'] * len(taps))
          def tap():
              # Pick the move, then its target (or press Use when the move needs no target).
              if not taps or pg.get_by_text("Hero's turn", exact=True).count() == 0:
                  return False
              loc = pg.get_by_text(taps[0], exact=True)
              if loc.count() == 0:
                  return False
              try:
                  loc.first.click(timeout=3000, no_wait_after=True)
              except Exception:
                  return False
              pg.wait_for_timeout(40)
              use = pg.get_by_text('Use', exact=True)
              if use.count():
                  use.first.click(timeout=3000, no_wait_after=True)
              else:
                  lab = pg.get_by_text(re.compile(targets[0] + '$'))
                  if lab.count() == 0:
                      return False
                  box = lab.first.bounding_box()
                  pg.mouse.click(box['x'] + box['width'] / 2, box['y'] + box['height'] + 36)
              taps.pop(0); targets.pop(0)
              return True
          shot = lambda: pg.screenshot(clip=clip) if clip else pg.screenshot()
          frames.append((0, shot()))
          tap()
          per = COLS * ROWS
          n = SHEETS * per if SHEETS else max(per, (case.get('frames', 2 * per) + per - 1) // per * per)
          for i in range(1, n):
              pg.clock.run_for(STEP)
              pg.wait_for_timeout(12)
              frames.append((i * STEP, shot()))
              if taps and i % 4 == 0 and i * STEP > 1200:
                  tap()
          ctx.close()
          ims = [(t, Image.open(io.BytesIO(d)).convert('RGB')) for t, d in frames]
          if KEEP:
              os.makedirs(f'{out}/{name}', exist_ok=True)
              for t, im in ims:
                  im.save(f'{out}/{name}/{t:05d}.png')
          fw, fh = ims[0][1].size
          tw = (1560 // COLS) if not FULL else 195
          th = round(fh * tw / fw)
          for s0 in range(0, len(ims), per):
              chunk = ims[s0:s0 + per]
              rows = (len(chunk) + COLS - 1) // COLS
              sheet = Image.new('RGB', (COLS * tw, rows * th), '#111')
              d = ImageDraw.Draw(sheet)
              for j, (t, im) in enumerate(chunk):
                  x, y = (j % COLS) * tw, (j // COLS) * th
                  sheet.paste(im.resize((tw, th), Image.LANCZOS), (x, y))
                  d.rectangle([x, y, x + 54, y + 16], fill='#000')
                  d.text((x + 3, y + 1), f'{t}ms', fill='#fff', font=font)
              sheet.save(f'{out}/{name}_{s0 // per}.png')
          report.append((name, f'{len(ims)} frames', errors[:3]))
      except Exception as ex:
        report.append((name, 'FAILED: ' + str(ex)[:160].replace(chr(10), ' '), []))
        try:
            ctx.close()
        except Exception:
            pass
    b.close()
srv.terminate()
for r in report:
    print(r[0], '|', r[1], '|', r[2] if r[2] else '')
