# One full-screen shot of a fight case waiting for the player's move (optionally with a move picked).
#   python3 shot_case.py <dist> <out.png> <casedir> <port> <case> [move to pick]
import sys, json, subprocess, time, atexit
from playwright.sync_api import sync_playwright
dist, out, casedir, port, name = sys.argv[1:6]
pick = sys.argv[6] if len(sys.argv) > 6 else None
case = json.load(open(f'{casedir}/fight_{name}.json'))
srv = subprocess.Popen([sys.executable, '-m', 'http.server', port, '--bind', '127.0.0.1', '-d', dist], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
atexit.register(srv.terminate)
time.sleep(1)
SEED = '''(() => { let a = 20261121; Math.random = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();'''
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    pg = ctx.new_page()
    pg.add_init_script(SEED)
    pg.add_init_script('localStorage.setItem("hatchlore.save.v1", %s); localStorage.setItem("hatchlore.lab", %s);' % (json.dumps(json.dumps(case['save'])), json.dumps(json.dumps(case['lab']))))
    pg.clock.install(time=1795262400)
    pg.goto(f'http://127.0.0.1:{port}/index.html')
    pg.wait_for_timeout(900)
    pg.clock.pause_at((pg.evaluate('Date.now()') + 500) / 1000)
    for _ in range(160):
        pg.clock.fast_forward(240); pg.wait_for_timeout(10)
        if pg.get_by_text("Hero's turn", exact=True).count():
            break
    pg.clock.run_for(600); pg.wait_for_timeout(50)
    if pick:
        pg.get_by_text(pick, exact=True).first.click(timeout=3000, no_wait_after=True)
        pg.clock.run_for(500); pg.wait_for_timeout(50)
    pg.screenshot(path=out)
    b.close()
print('wrote', out)
