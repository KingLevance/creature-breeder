import sys, time, subprocess, os
from playwright.sync_api import sync_playwright
dist, out, port = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(out, exist_ok=True)
save = open('/tmp/save.json').read()
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
    def tab(name, shot, wait=900):
        pg.get_by_text(name, exact=True).last.click(); pg.wait_for_timeout(wait); pg.screenshot(path=f'{out}/{shot}.png')
    tab('Campaign', '1_campaign')
    pg.mouse.click(195, 330); pg.wait_for_timeout(600); pg.screenshot(path=f'{out}/1b_campaign_open.png')
    tab('Creatures', '2_creatures')
    pg.mouse.click(100, 260); pg.wait_for_timeout(900); pg.screenshot(path=f'{out}/2b_detail.png')
    pg.mouse.wheel(0, 700); pg.wait_for_timeout(400); pg.screenshot(path=f'{out}/2c_detail_scroll.png')
    pg.keyboard.press('Escape')
    tab('Nursery', '3_nursery')
    tab('Breed', '4_breed')
    tab('More', '5_more')
    b.close()
srv.terminate()
print('ERRORS:', len(errors)); [print(' ', e[:200]) for e in errors[:10]]
