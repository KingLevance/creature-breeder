import sys, time, subprocess, os, json
from playwright.sync_api import sync_playwright
dist, out, area, frames = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
os.makedirs(out, exist_ok=True)
save = open('/tmp/save.json').read()
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8776', '--bind', '127.0.0.1', '-d', dist], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--no-sandbox'])
    pg = b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    pg.on('console', lambda m: errors.append(m.text) if m.type in ('error','warning') and '404' not in m.text and 'useNativeDriver' not in m.text else None)
    pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
    pg.goto('http://127.0.0.1:8776/index.html'); pg.wait_for_timeout(800)
    pg.evaluate('s => localStorage.setItem("hatchlore.save.v1", s)', save)
    pg.reload(); pg.wait_for_timeout(1500)
    pg.get_by_text('Campaign', exact=True).last.click(); pg.wait_for_timeout(600)
    pg.get_by_text(area, exact=True).first.click(); pg.wait_for_timeout(700)
    pg.get_by_text('Choose team').click(); pg.wait_for_timeout(500)
    pg.get_by_text('Start (', exact=False).click(); pg.wait_for_timeout(2500)
    for i in range(frames):
        pg.wait_for_timeout(90)
        pg.screenshot(path=f'{out}/f{i:03d}.png', clip={'x': 0, 'y': 75, 'width': 390, 'height': 380})
        for label in ['Next fight', 'Face the boss']:
            if pg.get_by_text(label, exact=True).count(): pg.get_by_text(label, exact=True).click(); pg.wait_for_timeout(300)
    b.close()
srv.terminate()
print('ERRORS:', len(errors))
for e in errors[:20]: print(' ', e[:300])
