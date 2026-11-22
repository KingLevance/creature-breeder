import sys, time, subprocess, os, json, collections
from playwright.sync_api import sync_playwright
dist, area, secs = sys.argv[1], sys.argv[2], int(sys.argv[3])
save = open('/tmp/save.json').read()
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8795', '--bind', '127.0.0.1', '-d', dist], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome', headless=True, args=['--no-sandbox'])
    pg = b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    pg.goto('http://127.0.0.1:8795/index.html'); pg.wait_for_timeout(800)
    pg.evaluate('s => localStorage.setItem("hatchlore.save.v1", s)', save)
    pg.reload(); pg.wait_for_timeout(1500)
    pg.evaluate('''() => { window.__lt = []; new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ entryTypes: ['longtask'] });
      window.__marks = []; const ob = new MutationObserver(() => { const t = document.body.innerText; const on = t.includes('On to the next chamber') || t.includes('Something big is ahead'); if (on !== window.__on) { window.__on = on; window.__marks.push([Math.round(performance.now()), on ? 'walk' : 'fight']); } }); ob.observe(document.body, { subtree: true, childList: true, characterData: true }); }''')
    pg.get_by_text('Campaign', exact=True).last.click(); pg.wait_for_timeout(600)
    pg.get_by_text(area, exact=True).first.click(); pg.wait_for_timeout(700)
    pg.get_by_text('Choose team').click(); pg.wait_for_timeout(500)
    cdp = pg.context.new_cdp_session(pg)
    cdp.send('Profiler.enable'); cdp.send('Profiler.setSamplingInterval', {'interval': 200}); cdp.send('Profiler.start')
    pg.get_by_text('Start (', exact=False).click()
    pg.wait_for_timeout(secs * 1000)
    prof = cdp.send('Profiler.stop')['profile']
    lt = pg.evaluate('window.__lt'); marks = pg.evaluate('window.__marks')
    b.close()
srv.terminate()
json.dump(prof, open('/tmp/prof.json', 'w'))
print('marks', marks)
print('longtasks', lt)
# self time per function
nodes = {n['id']: n for n in prof['nodes']}
self_t = collections.Counter()
dt = prof['timeDeltas']; samples = prof['samples']
for s, d in zip(samples, dt):
    cf = nodes[s]['callFrame']
    self_t[(cf['functionName'] or '(anon)') + ' ' + cf['url'].split('/')[-1][:30] + ':' + str(cf['lineNumber'])] += d
tot = sum(dt)
for k, v in self_t.most_common(30): print(f'{v/1000:8.1f}ms {100*v/tot:5.1f}%  {k}')
