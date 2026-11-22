import sys, time, subprocess, os
from playwright.sync_api import sync_playwright
dist, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8775', '--bind', '127.0.0.1', '-d', dist], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--no-sandbox', '--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    pg.on('console', lambda m: errors.append(m.text) if m.type in ('error','warning') and '404' not in m.text and 'useNativeDriver' not in m.text else None)
    pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
    pg.goto('http://127.0.0.1:8775/index.html'); pg.wait_for_timeout(1500)
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
            pg.wait_for_timeout(300)
        return None
    def hatch(tag):
        tap('Hatch', exact=True, wait=700); shot(tag+'_egg')
        pg.mouse.click(195, 380); pg.wait_for_timeout(250); shot(tag+'_crack1')
        pg.mouse.click(195, 380); pg.wait_for_timeout(250)
        pg.mouse.click(195, 380); pg.wait_for_timeout(200); shot(tag+'_burst')
        pg.wait_for_timeout(700); shot(tag+'_stars')
        pg.wait_for_timeout(2600); shot(tag+'_creature')
        tap('Welcome!')
    tap('Cindertail', exact=True); tap('Choose Cindertail')
    tap('Fight', exact=True, wait=100)
    pg.wait_for_timeout(700); shot('walk_in_mid')
    pg.wait_for_timeout(1700); shot('first_turn')
    pg.get_by_text('Strike', exact=True).click(); pg.wait_for_timeout(200)
    box = pg.get_by_text('Lv1 Wild Nibbler').bounding_box()
    pg.mouse.click(box['x'] + box['width']/2, box['y'] + 50)
    for i in range(12): pg.wait_for_timeout(70); shot(f'strike_{i:02d}')
    print('f1', fight()); tap('Done', exact=True)
    tap('Nursery', exact=True); tap('Place selected egg')
    hatch('h1')
    tap('Campaign', exact=True); tap('1. Mosswake Meadow'); tap('Choose team')
    pg.get_by_text('Start (', exact=False).click(); pg.wait_for_timeout(150)
    for i in range(4): pg.wait_for_timeout(330); shot(f'walk_{i}')
    for i in range(70): pg.wait_for_timeout(110); shot(f'fx_{i:02d}')
    r = fight(); print('run', r)
    if r and r != 'Done':
        tap(r, exact=True, wait=100)
        for i in range(5): pg.wait_for_timeout(350); shot(f'walk2_{i}')
    for _ in range(6):
        r = fight(); print('run', r)
        if r in (None, 'Done'):
            if r: tap('Done', exact=True)
            break
        tap(r, exact=True, wait=2500)
    tap('Breed', exact=True)
    tap('Tap to choose', nth=0); pg.locator('text=/Lv \\d+ Adult/').first.click(); pg.wait_for_timeout(400)
    tap('Tap to choose', nth=0); pg.locator('text=/Lv \\d+ Adult/').first.click(); pg.wait_for_timeout(500)
    tap('Breed (free this time)', wait=900); tap('OK', exact=True)
    tap('Nursery', exact=True); tap('Place selected egg'); hatch('h2')
    tap('More', exact=True); pg.mouse.wheel(0, 3000); pg.wait_for_timeout(400); shot('settings')
    b.close()
srv.terminate()
print('ERRORS:', len(errors))
for e in errors[:20]: print(' ', e[:300])
