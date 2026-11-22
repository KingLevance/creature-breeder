// Fixed saves and fights for the review captures: one rich save for menu screenshots, and one small fight per
// kind of move so every attack animation can be filmed on demand. Everything is seeded, so runs repeat exactly.
// OUT=/tmp/review/cases npx tsx tools/scratch/review_cases.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { ELEMENT_IDS, ElementId } from '../../src/game/data/elements';
import { Flair, MOVE_LIST, MoveDef, moveFlair, moveStyle } from '../../src/game/data/moves';
import { Creature, Egg, makeCreature, pedNode, stageOf } from '../../src/game/creature';
import { Genome, Skeleton, SKELETONS, breed, express, mulberry32, wildGenome } from '../../src/game/genome';
import { Save, TUT, newSave } from '../../src/game/save';

const OUT = process.env.OUT ?? '/tmp/review/cases';
mkdirSync(OUT, { recursive: true });
/** The pretend "now" the capture scripts set the browser clock to. */
export const NOW = Date.UTC(2026, 10, 21, 12, 0, 0);

function genome(seed: number, sk: Skeleton, el: ElementId, el2: ElementId | 'none' = 'none', quality = 0.5): Genome {
  const g = wildGenome(mulberry32(seed), { els: [el], quality, skels: [sk] });
  g.skel = [sk, sk]; g.el1 = [el, el]; g.el2 = [el2, el2];
  return g;
}
let nextId = 0;
function creature(seed: number, sk: Skeleton, el: ElementId, level: number, moves: string[], name: string, o: { el2?: ElementId; spd?: number; stageAtLeast?: number } = {}): Creature {
  const g = genome(seed, sk, el, o.el2 ?? 'none');
  if (o.spd != null) { g.spd = [o.spd, o.spd]; g.build = o.spd > 5 ? [2, 2] : [-2, -2]; }
  // Grow up early, so every test creature is an adult.
  g.growth = [1, 1];
  const c = makeCreature(mulberry32(seed + 1), g, level, 'wild');
  c.id = 'lab' + nextId++;
  c.name = name;
  if (moves.length) c.moves = [0, 1, 2, 3, 4].map(i => moves[i] ?? null);
  return c;
}
function baseSave(): Save {
  const s = newSave();
  s.tutorial = TUT.DONE; s.auto = false; s.fast = false; s.sound = false; s.music = false; s.cleared = 9;
  s.gold = 12450; s.essence = 380; s.dust = 42; s.shard = 17; s.core = 4; s.scans = 3;
  return s;
}
const write = (name: string, data: unknown) => writeFileSync(`${OUT}/${name}.json`, JSON.stringify(data));

// ---------- 1. The menu save: a lived-in game.
{
  const s = baseSave();
  const rng = mulberry32(4242);
  const plan: [Skeleton, ElementId, number, ElementId?][] = [
    ['biped', 'ember', 34], ['quad', 'tide', 31], ['serpent', 'verdant', 28], ['floater', 'spirit', 36, 'frost'], ['multi', 'venom', 30],
    ['aquatic', 'tide', 22], ['quad', 'spark', 41, 'gale'], ['biped', 'brawn', 18], ['quad', 'terra', 12], ['floater', 'mind', 9],
    ['serpent', 'wyrm', 47, 'ember'], ['biped', 'frost', 6], ['multi', 'swarm', 15], ['aquatic', 'glimmer', 25], ['quad', 'shade', 52],
    ['biped', 'radiant', 60, 'forge'], ['quad', 'stone', 3], ['floater', 'void', 64], ['serpent', 'gale', 20], ['biped', 'plain', 1],
  ];
  const NAMES = ['Cindertail', 'Brinass', 'Mossling', 'Wispette', 'Hexwick', 'Kax', 'Voltra', 'Torxary', 'Wynniry', 'Oomi', 'Pyrewyrm', 'Snowbit', 'Skitter', 'Lumifin', 'Duskpaw', 'Solara', 'Pebb', 'Nullo', 'Zephyra', 'Bean'];
  plan.forEach(([sk, el, lv, el2], i) => {
    const g = genome(500 + i, sk, el, el2 ?? 'none', 0.2 + (i % 5) * 0.18);
    if (i === 3 || i === 14) g.shiny = [1, 1];
    const c = makeCreature(rng, g, lv, i < 3 ? 'starter' : i % 3 === 0 ? 'bred' : 'wild');
    c.id = 'm' + i; c.name = NAMES[i];
    c.fav = i === 0 || i === 6;
    c.scanned = i === 1 || i === 10;
    s.creatures.push(c);
  });
  // A bred creature with a family tree.
  const mom = s.creatures[1], dad = s.creatures[6];
  const kid = makeCreature(rng, breed(rng, mom.g, dad.g).g, 14, 'bred');
  kid.id = 'm20'; kid.name = 'Stormpup'; kid.mom = pedNode(mom); kid.dad = pedNode(dad);
  s.creatures.push(kid);
  s.team = ['m0', 'm1', 'm3', 'm6', 'm10'];
  const egg = (i: number, origin: Egg['origin'] = 'wild'): Egg => ({ id: 'e' + i, g: genome(900 + i, SKELETONS[i % 6], ELEMENT_IDS[(i * 3) % ELEMENT_IDS.length]), origin, mutations: i === 2 ? 1 : 0 });
  s.eggs = [egg(0), egg(1), egg(2, 'bred')];
  s.incubators = [
    { tier: 2, egg: egg(3), startedAt: NOW - 600000, readyAt: NOW - 1000 },
    { tier: 1, egg: egg(4, 'bred'), startedAt: NOW - 120000, readyAt: NOW + 754000 },
    { tier: 1, egg: null, startedAt: 0, readyAt: 0 },
  ];
  s.counts = { hatched: 31, bred: 9, fights: 212, released: 7 };
  s.arena = { rating: 1184, wins: 23, losses: 11 };
  s.tower = { best: 17 };
  s.clears = { '0': 6, '1': 4, '2': 3, '3': 2, '4': 2, '5': 1, '6': 1, '7': 1, '8': 1 };
  write('save_menus', s);
  // A brand-new game, for the starter screen.
  write('save_new', newSave());
}

// ---------- 2. One fight per kind of move.
interface Case { name: string; note: string; save: Save; lab: unknown; taps: string[]; targets: string[]; frames: number; pre?: number }
const cases: Case[] = [];
const SK_ROT: Skeleton[] = ['biped', 'quad', 'serpent', 'floater', 'multi', 'aquatic'];
const byFlair = new Map<Flair, MoveDef[]>();
for (const mv of MOVE_LIST) {
  const f = moveFlair(mv);
  byFlair.set(f, [...(byFlair.get(f) ?? []), mv]);
}

function fight(name: string, note: string, o: {
  mover: Skeleton; el: ElementId; moves: string[]; taps: string[]; enemies?: number; enemyHp?: number; enemyMove?: string; enemyEl?: ElementId; enemySk?: Skeleton[];
  boss?: boolean; allies?: number; allyHp?: number; frames?: number; fallen?: boolean; pre?: number; targets?: string[];
}) {
  nextId = 0;
  const s = baseSave();
  const seed = 100 + cases.length * 7;
  const me = creature(seed, o.mover, o.el, 46, o.moves, 'Hero', { spd: 10 });
  s.creatures.push(me);
  const team = [me.id];
  for (let i = 0; i < (o.allies ?? 1); i++) {
    const pal = creature(seed + 2 + i, SK_ROT[(SK_ROT.indexOf(o.mover) + 2 + i) % 6], ELEMENT_IDS[(seed + i) % ELEMENT_IDS.length], 46, [], 'Pal' + (i + 1), { spd: 1 });
    s.creatures.push(pal);
    team.push(pal.id);
  }
  s.team = team;
  const n = o.enemies ?? 3;
  const enemies: Creature[] = [];
  for (let i = 0; i < n; i++) {
    const sk = o.enemySk?.[i] ?? SK_ROT[(SK_ROT.indexOf(o.mover) + 1 + i * 2) % 6];
    enemies.push(creature(seed + 20 + i, sk, o.enemyEl ?? ELEMENT_IDS[(seed + 5 + i * 3) % ELEMENT_IDS.length], 46, o.enemyMove ? [o.enemyMove] : [], 'Foe' + (i + 1), { spd: 1 }));
  }
  const carry: Record<string, { hp: number; alive: boolean }> = {};
  if (o.allyHp != null) carry[me.id] = { hp: o.allyHp, alive: true };
  if (o.fallen) carry[team[1]] = { hp: 0, alive: false };
  const lab = { kind: 'fight', team, enemies, mods: enemies.map((_, i) => ({ hpMul: o.enemyHp ?? 8, atkMul: 0.3, boss: !!o.boss && i === 0, stage: 2 })), boss: !!o.boss, carry };
  cases.push({ name, note, save: s, lab, taps: o.taps, targets: o.targets ?? o.taps.map(() => 'Foe1'), frames: o.frames ?? 40, pre: o.pre });
}

const FLAIR_ORDER: Flair[] = ['lunge', 'pounce', 'slam', 'slash', 'bite', 'flurry', 'roll', 'dash', 'touch', 'proj', 'volley', 'beam', 'bolt', 'erupt', 'wave', 'breath', 'nova', 'rain', 'quake', 'sweep', 'storm', 'buff'];
let rot = 0;
for (const fl of FLAIR_ORDER) {
  const list = byFlair.get(fl) ?? [];
  if (!list.length) { console.log('no move uses flair', fl); continue; }
  // Two moves per flair, from different elements where possible; attacks only for the non-support flairs.
  const picks: MoveDef[] = [];
  const pool = fl === 'buff' ? [] : list.filter(m => (m.pow ?? 0) > 0);
  for (const m of pool.length ? pool : list) {
    if (picks.length >= 2) break;
    if (!picks.some(p => p.el === m.el)) picks.push(m);
  }
  if (fl === 'buff') continue; // support moves get their own cases below
  picks.forEach((mv, i) => {
    const sk = SK_ROT[rot++ % 6];
    fight(`${fl}_${i}_${sk}`, `${moveStyle(mv)} / ${fl}: ${mv.name} (${mv.el}) used by a ${sk}`, { mover: sk, el: mv.el, moves: [mv.id], taps: [mv.name] });
  });
}
// The pairings AJ has complained about before, pinned so they are always filmed.
const find = (pred: (m: MoveDef) => boolean) => MOVE_LIST.find(pred)!;
const beam = find(m => moveFlair(m) === 'beam');
fight('beam_quad', `ranged / beam: ${beam.name} from a four-legged body (was stiff; shot must leave the mouth)`, { mover: 'quad', el: beam.el, moves: [beam.id], taps: [beam.name] });
fight('beam_multi', `ranged / beam: ${beam.name} from a many-legged body`, { mover: 'multi', el: beam.el, moves: [beam.id], taps: [beam.name] });
const pounce = find(m => moveFlair(m) === 'pounce');
fight('pounce_biped', `melee / pounce: ${pounce.name} from an upright body (needs a crouch before the jump)`, { mover: 'biped', el: pounce.el, moves: [pounce.id], taps: [pounce.name] });
const dash = find(m => moveFlair(m) === 'dash');
fight('dash_quad', `melee / dash: ${dash.name} from a four-legged body (needs a set before the dash)`, { mover: 'quad', el: dash.el, moves: [dash.id], taps: [dash.name] });
fight('strike_all', 'the basic Strike, which every creature has', { mover: 'biped', el: 'plain', moves: [], taps: ['Strike'] });

// Support moves: a heal, a team shield, a self buff, a debuff-only move, a revive.
const heal = find(m => !!m.heal && m.target === 'ally');
const tshield = find(m => m.target === 'allies' && !!m.shield && !m.heal);
const selfBuff = find(m => m.target === 'self' && !!m.fx?.length);
const teamHeal = find(m => m.target === 'allies' && !!m.heal);
const revive = find(m => !!m.revive);
fight('support_heal', `support: ${heal.name} (single heal)`, { mover: 'floater', el: heal.el, moves: [heal.id], taps: [heal.name], allyHp: 0.4, targets: ['Hero'] });
fight('support_teamshield', `support: ${tshield.name} (team shield)`, { mover: 'quad', el: tshield.el, moves: [tshield.id], taps: [tshield.name], allies: 2 });
fight('support_selfbuff', `support: ${selfBuff.name} (self buff)`, { mover: 'biped', el: selfBuff.el, moves: [selfBuff.id], taps: [selfBuff.name] });
fight('support_teamheal', `support: ${teamHeal.name} (team heal)`, { mover: 'serpent', el: teamHeal.el, moves: [teamHeal.id], taps: [teamHeal.name], allies: 2, allyHp: 0.5 });
fight('support_revive', `support: ${revive.name} (revive a fallen ally)`, { mover: 'biped', el: revive.el, moves: [revive.id], taps: [revive.name], allies: 2, fallen: true, targets: ['Pal1'] });

// Status effects sitting on an enemy: one case per visible status.
for (const k of ['burn', 'poison', 'freeze', 'stun', 'slow', 'defDown', 'atkDown', 'wound'] as const) {
  const mv = MOVE_LIST.find(m => (m.target === 'enemy' || m.target === 'enemies') && m.fx?.some(x => x.k === k && (x.ch ?? 1) >= 1 && x.on !== 'self' && x.on !== 'allies'));
  if (!mv) { console.log('no sure-fire move for status', k); continue; }
  fight(`status_${k}`, `status ${k} landing on an enemy and staying on it: ${mv.name}`, { mover: SK_ROT[rot++ % 6], el: mv.el, moves: [mv.id], taps: [mv.name], frames: 60 });
}

// Knock-outs and endings.
fight('faint_one_of_two', 'an enemy is knocked out and the fight carries on (must not pause for the faint)', { mover: 'biped', el: 'ember', moves: [], taps: ['Strike', 'Strike'], targets: ['Foe1', 'Foe2'], enemies: 2, enemyHp: 0.05, frames: 80 });
fight('win', 'the last enemy falls: victory beat and the result card', { mover: 'quad', el: 'tide', moves: [], taps: ['Strike'], enemies: 1, enemyHp: 0.05, frames: 80 });
fight('boss', 'a boss fight opening and a hit on the boss', { mover: 'biped', el: 'spark', moves: [], taps: ['Strike'], enemies: 3, boss: true, frames: 40, pre: 0 });
const big = find(m => m.rarity === 3 && moveStyle(m) === 'melee');
fight('legendary_melee', `a legendary melee move: ${big.name} (the only place a big screen shake belongs)`, { mover: 'biped', el: big.el, moves: [big.id], taps: [big.name], frames: 60 });
const bigR = find(m => m.rarity === 3 && moveStyle(m) === 'ranged');
fight('legendary_ranged', `a legendary ranged move: ${bigR.name}`, { mover: 'quad', el: bigR.el, moves: [bigR.id], taps: [bigR.name], frames: 60 });
const bigA = find(m => m.rarity === 3 && moveStyle(m) === 'area');
fight('legendary_area', `a legendary area move: ${bigA.name}`, { mover: 'serpent', el: bigA.el, moves: [bigA.id], taps: [bigA.name], frames: 60 });

for (const c of cases) write('fight_' + c.name, c);
writeFileSync(`${OUT}/index.json`, JSON.stringify(cases.map(c => ({ name: c.name, note: c.note, taps: c.taps, targets: c.targets, frames: c.frames }))));
writeFileSync(`${OUT}/index.txt`, cases.map(c => `${c.name}: ${c.note}`).join('\n'));
const lv30 = cases[0].save.creatures[0];
console.log(cases.length, 'fight cases; hero stage', stageOf(lv30), '→', OUT);
console.log([...byFlair.entries()].map(([k, v]) => `${k}:${v.length}`).join(' '));

// The longest move names, to check nothing is cut off on the move cards.
{
  const before = cases.length;
  const ids = (names: string[]) => names.map(n => MOVE_LIST.find(m => m.name === n)!.id);
  fight('long_names', 'the four longest move names on the move cards (nothing may be cut off)', { mover: 'biped', el: 'wyrm', moves: ids(['Draconic Ascension', 'Soothing Spring', "Champion's Fury", 'Stinger Barrage']), taps: ['Draconic Ascension'] });
  fight('long_names2', 'more long move names', { mover: 'quad', el: 'swarm', moves: ids(['Plague of Wings', 'Wyrmfire Breath', 'Starlight Burst', 'Heartwood Slam']), taps: ['Plague of Wings'] });
  for (const c of cases.slice(before)) write('fight_' + c.name, c);
}
