# Second pass: breeding through the picker, then rivals, tower and raid.
import sys, time, subprocess, os
from playwright.sync_api import sync_playwright
dist, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8766', '--bind', '127.0.0.1', '-d', dist], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--no-sandbox'])
    pg = b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and '404' not in m.text else None)
    pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
    pg.goto('http://127.0.0.1:8766/index.html'); pg.wait_for_timeout(1500)
    n = [0]
    def shot(name):
        n[0] += 1; pg.screenshot(path=f'{out}/{n[0]:02d}_{name}.png')
    def tap(text, exact=False, nth=0, wait=600):
        pg.get_by_text(text, exact=exact).nth(nth).click(); pg.wait_for_timeout(wait)
    def fight(max_s=150):
        try: pg.get_by_text('Auto', exact=True).click(timeout=2500)
        except Exception: pass
        t0 = time.time()
        while time.time() - t0 < max_s:
            for label in ['Next fight', 'Face the boss', 'Done']:
                if pg.get_by_text(label, exact=True).count(): return label
            fl = pg.locator('text=/^Floor \\d+$/')
            if pg.get_by_text('Leave', exact=True).count() and fl.count(): return 'floor'
            pg.wait_for_timeout(400)
        return None
    tap('Mossback', exact=True); tap('Choose Mossback')
    tap('Fight', exact=True, wait=2500)
    print('f1', fight()); tap('Done', exact=True)
    tap('Nursery', exact=True); tap('Place selected egg'); tap('Hatch', exact=True, wait=3200); tap('Welcome!')
    tap('Campaign', exact=True); tap('1. Mosswake Meadow'); tap('Choose team')
    pg.get_by_text('Start (', exact=False).click(); pg.wait_for_timeout(2200)
    for i in range(6):
        r = fight(); print('run', i, r)
        if r in (None, 'Done'):
            if r: tap('Done', exact=True)
            break
        tap(r, exact=True, wait=2500)
    tap('Breed', exact=True)
    tap('Tap to choose', nth=0); shot('pick_mother'); pg.locator('text=/Lv \\d+ Adult/').first.click(); pg.wait_for_timeout(500)
    tap('Tap to choose', nth=0); pg.locator('text=/Lv \\d+ Adult/').first.click(); pg.wait_for_timeout(700)
    shot('breed_ready'); pg.mouse.wheel(0, 400); pg.wait_for_timeout(300); shot('breed_forecast')
    tap('Breed (free this time)', wait=900); shot('breed_egg'); tap('OK', exact=True)
    tap('Nursery', exact=True); shot('nursery2'); tap('Place selected egg'); tap('Hatch', exact=True, wait=3300); shot('child'); tap('Welcome!')
    tap('Creatures', exact=True); shot('roster')
    # open the child (bred) detail: sort by New
    tap('New', exact=True); pg.locator('text=/Lv \\d+ /').first.click(); pg.wait_for_timeout(700)
    pg.mouse.wheel(0, 1500); pg.wait_for_timeout(400); shot('child_pedigree')
    pg.get_by_text('Close', exact=True).click(); pg.wait_for_timeout(400)
    tap('More', exact=True); shot('more')
    pg.get_by_text('Challenge', exact=False).click(); pg.wait_for_timeout(500)
    pg.get_by_text('Start (', exact=False).click(); pg.wait_for_timeout(2200); shot('rival')
    print('rival', fight()); shot('rival_result'); tap('Done', exact=True)
    tap('Climb', exact=True); pg.get_by_text('Start (', exact=False).click(); pg.wait_for_timeout(2200)
    for i in range(4):
        r = fight(); print('tower', i, r)
        if r == 'floor':
            if i == 0: shot('tower_result')
            pg.locator('text=/^Floor \\d+$/').last.click(); pg.wait_for_timeout(2500)
        else:
            if r: tap('Done', exact=True)
            break
    else:
        r = fight(); print('tower end', r)
        if r == 'floor': tap('Leave', exact=True)
        elif r: tap('Done', exact=True)
    pg.get_by_text('Attack (', exact=False).click(); pg.wait_for_timeout(500)
    pg.get_by_text('Attack (', exact=False).last.click(); pg.wait_for_timeout(2500); shot('raid')
    print('raid', fight(240)); shot('raid_result'); tap('Done', exact=True)
    shot('more_after')
    b.close()
srv.terminate()
print('ERRORS:', len(errors))
for e in errors[:15]: print(' ', e[:400])
