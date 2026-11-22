import sys, time, subprocess, os
from playwright.sync_api import sync_playwright
dist, out, port = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(out, exist_ok=True)
save = open('/tmp/save3.json').read()
srv = subprocess.Popen([sys.executable, '-m', 'http.server', port, '--bind', '127.0.0.1', '-d', dist], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--no-sandbox'])
    pg = b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and '404' not in m.text else None)
    pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
    pg.goto(f'http://127.0.0.1:{port}/index.html'); pg.wait_for_timeout(800)
    pg.evaluate('s => localStorage.setItem("hatchlore.save.v1", s)', save)
    pg.reload(); pg.wait_for_timeout(1800)
    shot = lambda n: pg.screenshot(path=f'{out}/{n}.png')
    pg.get_by_text('Creatures', exact=True).last.click(); pg.wait_for_timeout(600)
    pg.mouse.click(70, 260); pg.wait_for_timeout(900); shot('1_detail_top')
    pg.mouse.wheel(0, 1200); pg.wait_for_timeout(500); shot('2_detail_mid')
    pg.get_by_label('Close').last.click(); pg.wait_for_timeout(700); shot('3_closed')
    pg.get_by_text('Nursery', exact=True).last.click(); pg.wait_for_timeout(900); shot('4_nursery')
    pg.get_by_text('Hatch all', exact=False).last.click(); pg.wait_for_timeout(700); shot('5_hatching')
    pg.wait_for_timeout(1800); shot('6_hatched')
    pg.get_by_text('Welcome!', exact=True).last.click(); pg.wait_for_timeout(700); shot('7_after')
    b.close()
srv.terminate()
print('ERRORS:', len(errors)); [print(' ', e[:200]) for e in errors[:10]]
