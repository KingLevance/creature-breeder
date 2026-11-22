# Drives the web build in headless Chrome at phone size and saves screenshots.
import sys, time, subprocess, os
from playwright.sync_api import sync_playwright

dist, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765', '--bind', '127.0.0.1', '-d', dist], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--no-sandbox'])
    pg = b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
    pg.goto('http://127.0.0.1:8765/index.html')
    pg.wait_for_timeout(1500)
    n = [0]
    def shot(name):
        n[0] += 1
        pg.screenshot(path=f'{out}/{n[0]:02d}_{name}.png')
    def tap(text, exact=False, nth=0, wait=600):
        pg.get_by_text(text, exact=exact).nth(nth).click()
        pg.wait_for_timeout(wait)
    def fight(max_s=120):
        # turn Auto on and wait for a result panel
        try:
            pg.get_by_text('Auto', exact=True).click(timeout=4000)
        except Exception:
            pass
        t0 = time.time()
        while time.time() - t0 < max_s:
            for label in ['Next fight', 'Face the boss', 'Done']:
                loc = pg.get_by_text(label, exact=True)
                if loc.count():
                    return label
            pg.wait_for_timeout(400)
        return None
    shot('starter')
    tap('Choose Cindertail')
    shot('home_tutorial')
    tap('Fight', exact=True, wait=2500)
    shot('battle_start')
    # manual first move
    try:
        pg.get_by_text('Strike', exact=True).click(timeout=5000); pg.wait_for_timeout(300)
        shot('battle_move_selected')
    except Exception as e:
        errors.append('no Strike button: ' + str(e))
    r = fight(); shot('battle_result1'); print('fight1', r)
    tap('Done', exact=True)
    shot('after_fight1')
    tap('Nursery', exact=True); shot('nursery_egg')
    tap('Place selected egg'); shot('nursery_placed')
    tap('Hatch', exact=True, wait=1200); shot('hatch_stars')
    pg.wait_for_timeout(1500); shot('hatch_reveal')
    tap('Welcome!')
    tap('Campaign', exact=True); shot('campaign')
    tap('1. Mosswake Meadow'); shot('area_open')
    tap('Choose team'); shot('team_picker')
    pg.get_by_text('Start (', exact=False).click(); pg.wait_for_timeout(2200)
    shot('run_fight1')
    for i in range(6):
        r = fight(); shot(f'run_result_{i}'); print('run', i, r)
        if r in (None, 'Done'):
            if r: tap('Done', exact=True)
            break
        tap(r, exact=True, wait=2500)
        if i == 0: shot('run_fight2')
    shot('after_run')
    tap('Breed', exact=True); shot('breed_empty')
    for nm in ['Cindertail']:
        pg.get_by_text(nm, exact=True).last.click(); pg.wait_for_timeout(300)
    # pick the other creature: last tile that isn't Cindertail
    tiles = pg.locator('text=/Lv \\d+ Adult/')
    for i in range(tiles.count()):
        tiles.nth(i).click(); pg.wait_for_timeout(200)
    pg.wait_for_timeout(500); shot('breed_forecast')
    pg.mouse.wheel(0, 500); pg.wait_for_timeout(300); shot('breed_scrolled')
    try:
        pg.get_by_text('Breed (free this time)').click(timeout=3000); pg.wait_for_timeout(700); shot('breed_egg'); tap('OK', exact=True)
    except Exception as e:
        errors.append('breed failed: ' + str(e))
    tap('Nursery', exact=True)
    try:
        tap('Place selected egg'); tap('Hatch', exact=True, wait=3200); shot('hatch2'); tap('Welcome!')
    except Exception as e:
        errors.append('hatch2 failed: ' + str(e))
    tap('Creatures', exact=True); shot('roster')
    pg.locator('text=/Lv \\d+ /').first.click(); pg.wait_for_timeout(800); shot('detail_top')
    pg.mouse.wheel(0, 700); pg.wait_for_timeout(300); shot('detail_mid')
    pg.mouse.wheel(0, 900); pg.wait_for_timeout(300); shot('detail_bottom')
    pg.get_by_text('Close', exact=True).click(); pg.wait_for_timeout(400)
    tap('More', exact=True); shot('more')
    b.close()
srv.terminate()
print('ERRORS:', len(errors))
for e in errors[:15]: print(' ', e[:300])
