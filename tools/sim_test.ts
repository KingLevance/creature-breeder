// Engine checks, run with `npm test`. No UI: these exercise the game rules directly.
import { AREAS } from '../src/game/data/areas';
import { ELEMENT_IDS, matchup } from '../src/game/data/elements';
import { MOVE_LIST, MOVES, movePool } from '../src/game/data/moves';
import { act, aiChoose, autoResolve, createBattle, makeUnit, nextActor, turnOrder, usable, validTargets } from '../src/game/battle';
import { Creature, makeCreature, slotRarities, stageLevels, stageOf, statsFor } from '../src/game/creature';
import { STARTERS, renameCreature, breedCost, breedProblem, doBreed, forecast, hatchEgg, pickStarter, placeEgg, release, useScan } from '../src/game/economy';
import { breed, express, fillGenome, mulberry32, rareCarrierCount, starRating, wildGenome } from '../src/game/genome';
import { finishFight, raidState, startAreaRun, startArenaRun, startBattle, startRaidRun, startTowerRun, startTutorialFight } from '../src/game/run';
import { TUT, newSave } from '../src/game/save';

let failed = 0;
function ok(cond: boolean, msg: string) {
  if (!cond) { failed++; console.error('FAIL: ' + msg); } else console.log('ok   ' + msg);
}
const rng = mulberry32(12345);

// --- Data
ok(ELEMENT_IDS.length === 20, '20 elements');
ok(MOVE_LIST.length === 160, '160 moves (' + MOVE_LIST.length + ')');
ok(new Set(MOVE_LIST.map(m => m.id)).size === 160, 'move ids are unique');
for (const el of ELEMENT_IDS) {
  const counts = [0, 1, 2, 3].map(r => movePool(el, r).length).join(',');
  if (counts !== '3,2,2,1') ok(false, `${el} pool is ${counts}, expected 3,2,2,1`);
  if (!movePool(el, 0).some(m => m.pow)) ok(false, `${el} has no damaging common move`);
}
ok(matchup('ember', 'verdant') === 2 && matchup('ember', 'tide') === 0.5 && matchup('spark', 'terra') === 0, 'matchups');
ok(matchup('ember', 'verdant', 'frost') === 4 && matchup('spark', 'tide', 'terra') === 0, 'dual types multiply');
ok(AREAS.length === 20, '20 areas');

// --- Genetics
{
  const stars = [0, 0, 0, 0, 0];
  for (const q of [0.05, 0.3, 0.6, 0.9]) {
    const row = [0, 0, 0, 0, 0];
    for (let i = 0; i < 2000; i++) row[starRating(wildGenome(rng, { els: ['ember', 'tide', 'verdant'], quality: q })) - 1]++;
    console.log(`     stars at quality ${q}: ${row.map(n => (n / 20).toFixed(0) + '%').join(' ')}`);
    row.forEach((n, i) => (stars[i] += n));
  }
  ok(stars.every(n => n > 0), 'every star rating occurs in the wild');
  // Recessive trait hidden in both parents shows in about a quarter of children.
  const a = wildGenome(rng, { els: ['plain'], quality: 0.3 }); a.el1 = ['plain', 'void']; a.el2 = ['none', 'none'];
  const b = JSON.parse(JSON.stringify(a));
  let voids = 0;
  for (let i = 0; i < 4000; i++) if (express(breed(rng, a, b, { mutation: 0 }).g).el1 === 'void') voids++;
  ok(Math.abs(voids / 4000 - 0.25) < 0.03, `two Void carriers give Void about 25% of the time (${(voids / 40).toFixed(1)}%)`);
  a.leg = [0, 0];
  ok(rareCarrierCount(a) === 1 && express(a).el1 === 'plain', 'carrier hint sees the hidden Void');
  const f = forecast(rng, a, b, 600);
  ok(f.types.length === 2 && Math.abs(f.stars.reduce((x, y) => x + y, 0) - 1) < 1e-9, 'forecast gives odds');
  let muts = 0;
  for (let i = 0; i < 2000; i++) muts += breed(rng, a, b).mutations;
  ok(muts > 300 && muts < 1200, `mutations happen at a low rate (${(muts / 2000).toFixed(2)} per egg)`);
}

// --- Stats and stages
{
  const g = wildGenome(rng, { els: ['void'], quality: 0.5 }); g.el1 = ['void', 'void'];
  const h = wildGenome(rng, { els: ['plain'], quality: 0.5 }); h.el1 = ['plain', 'plain']; h.el2 = ['none', 'none']; h.growth = g.growth;
  ok(stageLevels(express(g))[2] > stageLevels(express(h))[2], 'rarer elements reach adulthood later');
  const glass = JSON.parse(JSON.stringify(h)); glass.build = [2, 2];
  const tank = JSON.parse(JSON.stringify(h)); tank.build = [-2, -2];
  const sg = statsFor(glass, 50), st = statsFor(tank, 50);
  ok(sg.spd > st.spd && sg.hp < st.hp, 'glass cannons are faster and frailer than tanks');
  const c = makeCreature(rng, h, 100);
  ok(stageOf(c) === 4 && c.moves.slice(0, 4).every(Boolean), 'a level 100 creature is legendary with its moves unlocked');
  ok((c.moves[4] != null) === (slotRarities(c.g)[4] != null), 'the legendary move only exists with the legendary-slot gene');
}

// --- Battles
function team(n: number, level: number, q: number, els = ELEMENT_IDS): Creature[] {
  return Array.from({ length: n }, () => makeCreature(rng, wildGenome(rng, { els, quality: q }), level, 'wild', level < 15 ? 1 : 2));
}
{
  let total = 0, wins = 0, unfinished = 0;
  for (let i = 0; i < 300; i++) {
    const lv = 5 + (i % 90);
    const b = createBattle(rng, team(5, lv, 0.4).map((c, j) => makeUnit(c, 0, j)), team(5, lv, 0.4).map((c, j) => makeUnit(c, 1, j)));
    autoResolve(b);
    if (b.over == null) unfinished++;
    if (b.over === 0) wins++;
    total += b.actions[0] + b.actions[1];
  }
  ok(unfinished === 0, 'even fights always finish');
  ok(wins > 110 && wins < 190, `even fights are fair (${wins}/300 won by side 0)`);
  console.log(`     average actions per 5v5 fight: ${(total / 300).toFixed(1)}`);
  // Speed: a much faster creature acts more often.
  const fast = team(1, 30, 0.5)[0], slow = team(1, 30, 0.5)[0];
  const b = createBattle(rng, [makeUnit(fast, 0, 0)], [makeUnit(slow, 1, 0)]);
  b.units[0].max.spd = 200; b.units[1].max.spd = 100;
  const order = turnOrder(b, 9);
  ok(order.filter(u => u === 0).length === 6, 'a creature twice as fast acts twice as often');
  // Every move can be used without crashing.
  let bad = 0;
  for (const mv of MOVE_LIST) {
    const cs = team(3, 40, 0.5), es = team(3, 40, 0.5);
    const bt = createBattle(rng, cs.map((c, j) => makeUnit(c, 0, j)), es.map((c, j) => makeUnit(c, 1, j)));
    bt.units[1].alive = false; bt.units[1].hp = 0;
    const u = bt.units[0];
    u.moves = [mv, ...u.moves.filter(m => m.id === 'strike')];
    u.gauge = 5000;
    const { actor } = nextActor(bt);
    if (actor !== 0 || !usable(bt, u, mv)) { bad++; console.error('  cannot use ' + mv.id); continue; }
    const tg = validTargets(bt, u, mv);
    const ev = act(bt, 0, mv.id, tg[0]);
    if (!ev.length || bt.units.some(x => Number.isNaN(x.hp) || x.hp < 0 || x.hp > x.max.hp)) { bad++; console.error('  bad result from ' + mv.id); }
    autoResolve(bt);
    if (bt.over == null) { bad++; console.error('  fight stuck after ' + mv.id); }
  }
  ok(bad === 0, 'every move works in a fight');
  ok(Object.keys(MOVES).length === 160, 'move lookup');
}

// --- The whole tutorial, then every area with a level-appropriate team
{
  const s = newSave();
  let now = 1_700_000_000_000;
  const play = (run: ReturnType<typeof startAreaRun>) => {
    for (let guard = 0; guard < 400; guard++) {
      const b = startBattle(rng, s, run);
      autoResolve(b);
      const res = finishFight(rng, s, run, b, now);
      if (res.runOver) return res;
    }
    throw new Error('run never ended');
  };
  const starter = pickStarter(rng, s, 0);
  ok(s.tutorial === TUT.FIGHT && starRating(starter.g) <= 2, 'starter picked, low stars');
  let res = play(startTutorialFight(rng, s));
  ok(res.won && s.tutorial === TUT.INCUBATE && s.eggs.length === 1 && s.incubators.length === 1, 'first fight gives an egg and an incubator');
  ok(stageOf(starter) === 1, 'starter is a teen after the first fight');
  ok(placeEgg(s, 0, s.eggs[0].id, now), 'egg goes in the incubator');
  const second = hatchEgg(rng, s, 0, now)!;
  ok(!!second && second.sex !== starter.sex && s.tutorial === TUT.RUN && s.creatures.length === 2, 'egg hatches at once, opposite sex');
  res = play(startAreaRun(rng, s, 0, [starter.id, second.id]));
  ok(res.won && res.cleared && s.cleared === 1, 'first area cleared');
  ok(stageOf(starter) === 2 && stageOf(second) === 2 && s.tutorial === TUT.BREED, 'both are adults after the first run');
  ok(breedProblem(s, starter, second, now) === null, 'the pair can breed');
  ok(forecast(rng, starter.g, second.g, 600).types.length >= 3, 'the first breeding has several possible outcomes');
  const egg = doBreed(rng, s, starter.id, second.id, { dust: false, shard: false, core: false }, now)!;
  ok(!!egg && !!egg.mom && !!egg.dad && s.tutorial === TUT.HATCH2, 'breeding makes an egg with a pedigree');
  const slot = s.incubators.findIndex(i => !i.egg);
  placeEgg(s, slot, egg.id, now);
  const third = hatchEgg(rng, s, slot, now)!;
  ok(!!third && s.tutorial === TUT.DONE && s.creatures.length >= 3, 'tutorial ends with three or more creatures');
  ok(!!third.mom && !!third.dad, 'child remembers its parents');
  ok(breedCost(starter, second) > 0 && starter.bred === 1, 'breeding cost and count');
  s.scans = 1;
  ok(useScan(s, third.id) && third.scanned, 'scan lens reveals genes');
  ok(renameCreature(s, third.id, '  Sir   Fluffington the Third  ') && third.name === 'Sir Fluffington' && !renameCreature(s, third.id, '   ') && third.name === 'Sir Fluffington', 'renaming trims, caps length and refuses blanks');
  // After the tutorial, eggs take time.
  s.eggs.push({ id: 'x', g: wildGenome(rng, { els: ['ember'], quality: 0.5 }), origin: 'wild', mutations: 0 });
  const free = s.incubators.findIndex(i => !i.egg);
  placeEgg(s, free, 'x', now);
  ok(hatchEgg(rng, s, free, now) === null && hatchEgg(rng, s, free, now + 3600_000) !== null, 'incubation takes time after the tutorial');

  // Every area: a team at the area's level should usually win, and a far weaker one should lose.
  let lines = '';
  for (const a of AREAS) {
    let wins = 0;
    const N = 12;
    for (let i = 0; i < N; i++) {
      const t = team(5, Math.round((a.lo + a.hi) / 2) + 3, Math.min(1, a.quality + 0.15));
      s.creatures.push(...t);
      const r = play(startAreaRun(rng, s, a.id, t.map(c => c.id)));
      if (r.won) wins++;
      s.creatures = s.creatures.filter(c => !t.includes(c));
    }
    lines += `${a.id}:${wins}/${N} `;
    if (wins === 0) ok(false, `area ${a.id} (${a.name}) is unwinnable at level`);
  }
  console.log('     area win rates at level+3: ' + lines);
  const weak = team(5, 5, 0.1);
  s.creatures.push(...weak);
  ok(!play(startAreaRun(rng, s, 10, weak.map(c => c.id))).won, 'an under-levelled team loses');

  // Tower, rivals, raid
  const strong = team(5, 40, 0.6);
  s.creatures.push(...strong);
  const ids = strong.map(c => c.id);
  res = play(startTowerRun(rng, s, ids));
  ok(!res.won && s.tower.best >= 3, `tower ends in a loss eventually (best floor ${s.tower.best})`);
  const before = s.arena.rating;
  res = play(startArenaRun(rng, s, ids));
  ok(s.arena.rating !== before, 'rival fight changes rating');
  const raid = startRaidRun(rng, s, ids, now)!;
  const rb = startBattle(rng, s, raid);
  for (let i = 0; rb.over == null && rb.actions[0] < raid.actionLimit; i++) {
    const { actor } = nextActor(rb);
    if (actor == null) break;
    const c = aiChoose(rb, actor);
    act(rb, actor, c.move, c.target);
  }
  res = finishFight(rng, s, raid, rb, now);
  ok(s.raid.dmg > 0 && raidState(s, now).triesLeft === 2, `raid damage is recorded (${s.raid.dmg})`);
  console.log('     raid tiers: ' + raidState(s, now).tiers.join(', '));
  const n = s.creatures.length;
  ok(release(s, weak[0].id) && s.creatures.length === n - 1 && s.essence > 0, 'releasing gives essence');
  ok(STARTERS.length === 3, 'three starters');

  // Markings, hue and stance: varied in the wild, inherited, and filled in for old saves.
  {
    const marks = [0, 0, 0], stances = [0, 0, 0, 0];
    let hues = 0;
    for (let i = 0; i < 2000; i++) {
      const ph = express(wildGenome(rng, { els: ELEMENT_IDS, quality: 0.5 }));
      marks[ph.mark ?? 0]++; stances[ph.stance ?? 0]++; if (ph.hue) hues++;
    }
    console.log(`     marking styles ${marks.join('/')}, stances ${stances.join('/')}, shifted hues ${hues}/2000`);
    ok(marks.every(n => n > 300) && stances.every(n => n > 300) && hues > 1000, 'wild creatures vary in markings, stance and hue');
    const p1 = wildGenome(rng, { els: ['ember'], quality: 0.5 }), p2 = wildGenome(rng, { els: ['ember'], quality: 0.5 });
    p1.mark = [2, 2]; p2.mark = [2, 2]; p1.stance = [3, 3]; p2.stance = [3, 3];
    let same = 0;
    for (let i = 0; i < 200; i++) { const k = express(breed(rng, p1, p2, { mutation: 0 }).g); if (k.mark === 2 && k.stance === 3) same++; }
    ok(same === 200, 'markings and stance breed true');
    const old = wildGenome(rng, { els: ['tide'], quality: 0.5 }) as any;
    delete old.mark; delete old.hue; delete old.stance;
    const copy = JSON.parse(JSON.stringify(old));
    fillGenome(old, 'abc'); fillGenome(copy, 'abc');
    ok(old.mark && old.hue && old.stance && JSON.stringify(old) === JSON.stringify(copy), 'old saves get stable markings, hue and stance');
  }
  JSON.parse(JSON.stringify(s));
  ok(true, 'save is plain JSON');
}

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nAll checks passed');
