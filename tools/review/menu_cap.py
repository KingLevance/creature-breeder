# Screenshots of every menu screen from the fixed review save, on a fake clock so two builds match shot for shot.
#   python3 menu_cap.py <dist> <out> <casedir> <port>
import sys, os, json, subprocess, time, re
from playwright.sync_api import sync_playwright

dist, out, casedir, port = sys.argv[1:5]
only = sys.argv[5:]  # optional: names of flows to run
os.makedirs(out, exist_ok=True)
NOW = 1795262400000
SEED = '''(() => { let a = 20261121; Math.random = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();'''
srv = subprocess.Popen([sys.executable, '-m', 'http.server', port, '--bind', '127.0.0.1', '-d', dist], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
import atexit
atexit.register(srv.terminate)
time.sleep(1)
errors, notes = [], []

def open_page(b, save, lab=None):
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)[:200]))
    pg.on('console', lambda m: errors.append(m.text[:200]) if m.type == 'error' and '404' not in m.text else None)
    pg.add_init_script(SEED)
    js = 'localStorage.setItem("hatchlore.save.v1", %s);' % json.dumps(json.dumps(save))
    if lab:
        js += 'localStorage.setItem("hatchlore.lab", %s);' % json.dumps(json.dumps(lab))
    # Only seed storage on the first load, so a reload keeps what the game has saved since.
    pg.add_init_script('if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); %s }' % js)
    pg.clock.install(time=NOW / 1000)
    pg.goto(f'http://127.0.0.1:{port}/index.html')
    pg.wait_for_timeout(900)
    pg.clock.pause_at((pg.evaluate('Date.now()') + 500) / 1000)
    tick(pg, 3200)
    return ctx, pg

def tick(pg, ms=700):
    # Let animations run on the fake clock, in small steps so React keeps up.
    left = ms
    while left > 0:
        pg.clock.run_for(min(100, left)); left -= 100
        pg.wait_for_timeout(8)

def shot(pg, name, settle=700):
    tick(pg, settle)
    pg.screenshot(path=f'{out}/{name}.png')

def click(pg, text, exact=True, last=False, nth=None):
    loc = pg.get_by_text(text, exact=exact)
    n = loc.count()
    if n == 0:
        notes.append(f'MISSING "{text}"')
        return False
    (loc.last if last else loc.nth(nth) if nth is not None else loc.first).click(timeout=4000, no_wait_after=True)
    return True

def tab(pg, name):
    click(pg, name, last=True)
    tick(pg, 600)
    pg.mouse.move(195, 420)  # so the wheel scrolls the page, not the tab bar

def wheel(pg, dy):
    pg.mouse.move(195, 420)
    pg.mouse.wheel(0, dy)

def flow(name):
    return not only or name in only

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--no-sandbox'])
    save = json.load(open(f'{casedir}/save_menus.json'))

    if flow('starter'):
        ctx, pg = open_page(b, json.load(open(f'{casedir}/save_new.json')))
        shot(pg, '00_starter_pick')
        ctx.close()

    if flow('campaign'):
        ctx, pg = open_page(b, save)
        shot(pg, '10_campaign')
        wheel(pg, 700); shot(pg, '11_campaign_scrolled')
        wheel(pg, -2000); tick(pg, 300)
        click(pg, 'Pebble Run'); shot(pg, '12_campaign_area_open')
        click(pg, 'Choose team'); shot(pg, '13_team_picker')
        ctx.close()

    if flow('roster'):
        ctx, pg = open_page(b, save)
        tab(pg, 'Creatures'); shot(pg, '20_roster')
        wheel(pg, 600); shot(pg, '21_roster_scrolled')
        wheel(pg, -2000); tick(pg, 300)
        click(pg, 'Brinass'); shot(pg, '22_detail_top', 900)
        pg.mouse.move(195, 500)
        wheel(pg, 520); shot(pg, '23_detail_stats')
        wheel(pg, 620); shot(pg, '24_detail_moves')
        wheel(pg, 620); shot(pg, '25_detail_genes')
        wheel(pg, 700); shot(pg, '26_detail_genes2')
        wheel(pg, 3000); shot(pg, '27_detail_bottom')
        ctx.close()
        ctx, pg = open_page(b, save)
        tab(pg, 'Creatures')
        click(pg, 'Stormpup'); tick(pg, 600)
        pg.mouse.move(195, 500); wheel(pg, 3000); shot(pg, '28_detail_pedigree')
        ctx.close()
        ctx, pg = open_page(b, save)
        tab(pg, 'Creatures')
        click(pg, 'Multi-Release'); shot(pg, '29_multi_release')
        click(pg, 'Bean'); click(pg, 'Pebb'); shot(pg, '29b_multi_release_picked')
        ctx.close()

    if flow('nursery'):
        ctx, pg = open_page(b, save)
        tab(pg, 'Nursery'); shot(pg, '30_nursery')
        wheel(pg, 600); shot(pg, '31_nursery_scrolled')
        wheel(pg, -2000); tick(pg, 300)
        if click(pg, 'Hatch', exact=True):
            shot(pg, '32_hatching', 500)
            shot(pg, '33_hatch_mid', 900)
            shot(pg, '34_hatch_wait', 2200)
            # Tap the egg until it opens, then watch the reveal.
            for i in range(3):
                pg.mouse.click(195, 400); tick(pg, 350)
                pg.screenshot(path=f'{out}/35_hatch_tap{i + 1}.png')
            shot(pg, '36_hatch_burst', 250)
            shot(pg, '37_hatch_reveal', 700)
            shot(pg, '38_hatch_revealed', 2500)
            pg.mouse.move(195, 500); pg.mouse.wheel(0, 600)
            shot(pg, '39_hatch_revealed_scrolled', 500)
        ctx.close()

    if flow('breed'):
        ctx, pg = open_page(b, save)
        tab(pg, 'Breed'); shot(pg, '40_breed')
        # The slot labels were "Mother ♀" / "Father ♂" before the menu pass and are "Mother" / "Father" after it.
        mum = 'Mother ♀' if pg.get_by_text('Mother ♀', exact=True).count() else 'Mother'
        dad = 'Father ♂' if pg.get_by_text('Father ♂', exact=True).count() else 'Father'
        if click(pg, mum):
            shot(pg, '41_breed_pick_mother')
            click(pg, 'Brinass'); tick(pg, 500)
        if click(pg, dad):
            tick(pg, 500)
            click(pg, 'Voltra'); tick(pg, 500)
        shot(pg, '42_breed_pair')
        wheel(pg, 600); shot(pg, '43_breed_forecast')
        wheel(pg, 900); shot(pg, '44_breed_bottom')
        ctx.close()

    if flow('more'):
        ctx, pg = open_page(b, save)
        tab(pg, 'More'); shot(pg, '50_more')
        wheel(pg, 650); shot(pg, '51_more_2')
        wheel(pg, 650); shot(pg, '52_more_3')
        wheel(pg, 900); shot(pg, '53_more_bottom')
        ctx.close()

    if flow('battle'):
        # The fight screen itself: waiting for a move, a move picked, and the result card after a win.
        case = json.load(open(f'{casedir}/fight_win.json'))
        ctx, pg = open_page(b, case['save'], case['lab'])
        for _ in range(60):
            if pg.get_by_text("Hero's turn", exact=True).count():
                break
            tick(pg, 200)
        shot(pg, '60_battle_your_turn', 400)
        click(pg, 'Strike'); shot(pg, '61_battle_move_picked', 300)
        lab = pg.get_by_text(re.compile('Foe1$'))
        if lab.count():
            box = lab.first.bounding_box()
            pg.mouse.click(box['x'] + box['width'] / 2, box['y'] + box['height'] + 36)
        shot(pg, '62_battle_hit', 500)
        shot(pg, '63_battle_after', 1500)
        shot(pg, '64_battle_result', 2500)
        shot(pg, '65_battle_result_settled', 2500)
        ctx.close()
        case = json.load(open(f'{casedir}/fight_boss.json'))
        ctx, pg = open_page(b, case['save'], case['lab'])
        for _ in range(60):
            if pg.get_by_text("Hero's turn", exact=True).count():
                break
            tick(pg, 200)
        shot(pg, '66_battle_boss', 400)
        ctx.close()
    b.close()
srv.terminate()
print('ERRORS:', len(errors)); [print(' ', e) for e in errors[:10]]
print('NOTES:', notes)
