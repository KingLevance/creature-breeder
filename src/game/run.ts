// Runs: a team locked in before a series of fights. Deaths stick, health carries over, and the boss chest ends it.
// Also the endless tower, rival fights and the raid boss, which all reuse the same fight system.
import { AREAS, AreaDef } from './data/areas';
import { ELEMENT_IDS, ElementId } from './data/elements';
import { Battle, Unit, UnitMods, contribution, createBattle, makeUnit } from './battle';
import { Creature, Egg, MAX_LEVEL, XpResult, addXp, makeCreature, newId, stageLevels, xpToNext } from './creature';
import { levelTo, tutorialEgg } from './economy';
import { Genome, Rng, Skeleton, SKELETONS, WildOpts, boostPotential, clamp, eggFromEnemy, express, pick, rint, wildGenome } from './genome';
import { Save, TUT, byId, dayKey, weekKey } from './save';

export interface FightDef {
  enemies: Creature[];
  mods: UnitMods[];
  boss: boolean;
  level: number;
}

export interface Loot { gold: number; dust: number; shard: number; core: number; scans: number; essence: number; eggs: Egg[] }
export const emptyLoot = (): Loot => ({ gold: 0, dust: 0, shard: 0, core: 0, scans: 0, essence: 0, eggs: [] });

export type RunKind = 'tutorial' | 'area' | 'tower' | 'arena' | 'raid';

export interface Run {
  kind: RunKind;
  areaId: number;
  title: string;
  fights: FightDef[];
  idx: number;
  team: string[];
  /** Health fraction and alive flag carried between fights. */
  carry: Record<string, { hp: number; alive: boolean }>;
  loot: Loot;
  sky: [string, string];
  ground: string;
  floor: number;
  /** Raid fights end after this many player actions. */
  actionLimit: number;
  raidDmg: number;
}

function enemyStage(areaId: number, boss: boolean): number {
  const base = areaId === 0 ? 0 : areaId <= 3 ? 1 : areaId <= 11 ? 2 : areaId <= 17 ? 2 : 3;
  return Math.min(4, base + (boss ? 1 : 0));
}

// Wild enemies are weaker than a player's creature of the same level: a run is several fights in a row
// with deaths that stick, so each single fight has to be winnable with room to spare.
const ENEMY = (areaId: number) => ({ hpMul: areaId === 0 ? 0.6 : ENEMY_HP, atkMul: areaId === 0 ? 0.7 : ENEMY_ATK });
export const TUNE = { enemyHp: 0.55, enemyAtk: 0.68, bossHp: 1.7, bossAtk: 1.0 };
const ENEMY_HP = TUNE.enemyHp, ENEMY_ATK = TUNE.enemyAtk, BOSS_HP = TUNE.bossHp, BOSS_ATK = TUNE.bossAtk;

function wildOpts(a: AreaDef): WildOpts {
  return { els: a.els, quality: a.quality, rareCarrier: a.rareCarrier };
}

function bossGenome(rng: Rng, a: AreaDef): Genome {
  const g = wildGenome(rng, { els: [a.boss.el], quality: Math.min(1, a.quality + 0.3), skels: [a.boss.skel], rareCarrier: a.rareCarrier * 2 });
  g.skel = [a.boss.skel, a.boss.skel];
  g.el1[0] = a.boss.el;
  g.el2 = a.boss.el2 ? [a.boss.el2, a.boss.el2] : ['none', 'none'];
  g.build = [-1, -1];
  return g;
}

function areaFights(rng: Rng, a: AreaDef): FightDef[] {
  const fights: FightDef[] = [];
  const n = a.team.length;
  a.team.forEach((count, i) => {
    const level = Math.round(a.lo + ((a.hi - a.lo) * i) / n);
    const enemies = Array.from({ length: count }, () => makeCreature(rng, wildGenome(rng, wildOpts(a)), clamp(level + rint(rng, -1, 0), 1, MAX_LEVEL), 'wild', enemyStage(a.id, false)));
    fights.push({ enemies, mods: enemies.map(() => ({ stage: enemyStage(a.id, false), ...ENEMY(a.id) })), boss: false, level });
  });
  const boss = makeCreature(rng, bossGenome(rng, a), clamp(a.hi + 1, 1, MAX_LEVEL), 'wild', enemyStage(a.id, true));
  boss.name = a.boss.name;
  const minions = Array.from({ length: a.bossMinions }, () => makeCreature(rng, wildGenome(rng, wildOpts(a)), a.hi, 'wild', enemyStage(a.id, false)));
  fights.push({
    enemies: [boss, ...minions],
    mods: [{ boss: true, hpMul: a.id === 0 ? 1.2 : BOSS_HP, atkMul: a.id === 0 ? 0.85 : BOSS_ATK, stage: enemyStage(a.id, true) }, ...minions.map(() => ({ stage: enemyStage(a.id, false), ...ENEMY(a.id) }))],
    boss: true, level: a.hi + 1,
  });
  return fights;
}

function baseRun(kind: RunKind, title: string, team: string[], fights: FightDef[], a?: AreaDef): Run {
  return {
    kind, areaId: a?.id ?? -1, title, fights, idx: 0, team: [...team], carry: {}, loot: emptyLoot(),
    sky: a?.sky ?? ['#2b2450', '#6b5fae'], ground: a?.ground ?? '#3b3460', floor: 0, actionLimit: 0, raidDmg: 0,
  };
}

export function areaOpen(s: Save, areaId: number): boolean {
  if (s.tutorial < TUT.RUN) return false;
  return areaId <= s.cleared;
}

export function startAreaRun(rng: Rng, s: Save, areaId: number, team: string[]): Run {
  const a = AREAS[areaId];
  s.team = [...team];
  return baseRun('area', a.name, team, areaFights(rng, a), a);
}

export function startTutorialFight(rng: Rng, s: Save): Run {
  const a = AREAS[0];
  const g = wildGenome(rng, { els: ['plain'], quality: 0, skels: ['quad'] });
  g.el1 = ['plain', 'plain']; g.el2 = ['none', 'none'];
  const foe = makeCreature(rng, g, 1);
  foe.name = 'Wild Nibbler';
  return baseRun('tutorial', 'First fight', [s.tutorialPair[0]], [{ enemies: [foe], mods: [{ hpMul: 0.7, atkMul: 0.6 }], boss: false, level: 1 }], a);
}

// ---------- Endless tower
function towerFight(rng: Rng, floor: number): FightDef {
  const level = clamp(3 + floor * 2, 1, MAX_LEVEL);
  const q = clamp(floor / 60, 0.05, 0.95);
  const els = [pick(rng, ELEMENT_IDS), pick(rng, ELEMENT_IDS), pick(rng, ELEMENT_IDS)];
  const boss = floor % 5 === 0;
  const count = clamp(2 + Math.floor(floor / 2), 2, 5);
  const stage = level < 12 ? 1 : level < 70 ? 2 : 3;
  const enemies = Array.from({ length: count }, () => makeCreature(rng, wildGenome(rng, { els, quality: q, rareCarrier: 0.03 + q * 0.2 }), level, 'wild', stage));
  const mods: UnitMods[] = enemies.map(() => ({ stage, hpMul: ENEMY_HP + 0.15, atkMul: ENEMY_ATK + 0.1 }));
  if (boss) { mods[0] = { boss: true, hpMul: BOSS_HP, atkMul: BOSS_ATK, stage: Math.min(4, stage + 1) }; enemies[0].name = 'Floor ' + floor + ' Warden'; }
  return { enemies, mods, boss, level };
}

export function startTowerRun(rng: Rng, s: Save, team: string[]): Run {
  s.team = [...team];
  const run = baseRun('tower', 'Endless Tower', team, [towerFight(rng, 1)]);
  run.floor = 1;
  return run;
}

// ---------- Rivals (offline PvP stand-in) and the raid boss
const RIVAL_NAMES = ['Breeder Ossa', 'Keeper Vane', 'Old Marrow', 'Twin Larks', 'Captain Sedge', 'Nurse Thistle', 'The Collector', 'Professor Quill', 'Lady Ferrow', 'Grandmaster Io'];
export function rivalName(s: Save): string {
  return RIVAL_NAMES[(s.arena.wins + s.arena.losses) % RIVAL_NAMES.length];
}

export function startArenaRun(rng: Rng, s: Save, team: string[]): Run {
  s.team = [...team];
  const r = s.arena.rating;
  const level = clamp(Math.round(3 + r / 18), 2, MAX_LEVEL);
  const q = clamp(r / 2000, 0.05, 0.9);
  const count = clamp(team.length, 2, 5);
  const enemies = Array.from({ length: count }, () => makeCreature(rng, wildGenome(rng, { els: ELEMENT_IDS, quality: q, rareCarrier: 0.02 + q * 0.1 }), clamp(level + rint(rng, -1, 1), 1, MAX_LEVEL), 'wild', level < 12 ? 1 : 2));
  const run = baseRun('arena', rivalName(s), team, [{ enemies, mods: enemies.map(() => ({ stage: level < 12 ? 1 : 2 })), boss: false, level }]);
  run.sky = ['#3a2f5e', '#b79ad6']; run.ground = '#57467f';
  return run;
}

export const RAID_BOSSES: { name: string; el: ElementId; el2: ElementId; skel: Skeleton }[] = [
  { name: 'The Hollow King', el: 'void', el2: 'shade', skel: 'serpent' },
  { name: 'Emberheart Titan', el: 'ember', el2: 'stone', skel: 'biped' },
  { name: 'Stormcrown', el: 'spark', el2: 'wyrm', skel: 'floater' },
  { name: 'The Drowned Bell', el: 'tide', el2: 'spirit', skel: 'aquatic' },
];
export const RAID_TRIES = 3;
export const RAID_ACTIONS = 30;
export const RAID_TIERS = [2, 5, 10, 18, 30];

export function raidState(s: Save, now: number) {
  const week = weekKey(now), day = dayKey(now);
  if (s.raid.week !== week) s.raid = { week, dmg: 0, day, tries: 0, claimed: 0 };
  if (s.raid.day !== day) { s.raid.day = day; s.raid.tries = 0; }
  const boss = RAID_BOSSES[Number(week.slice(1)) % RAID_BOSSES.length];
  const top = Math.max(1, ...s.creatures.map(c => c.level));
  const level = clamp(top + 3, 8, MAX_LEVEL);
  const segment = Math.round((40 + 9 * level) * 5);
  return { boss, level, segment, triesLeft: RAID_TRIES - s.raid.tries, tiers: RAID_TIERS.map(t => t * segment) };
}

export function startRaidRun(rng: Rng, s: Save, team: string[], now: number): Run | null {
  const st = raidState(s, now);
  if (st.triesLeft <= 0) return null;
  s.raid.tries++;
  s.team = [...team];
  const g = wildGenome(rng, { els: [st.boss.el], quality: 0.9, skels: [st.boss.skel] });
  g.skel = [st.boss.skel, st.boss.skel]; g.el1 = [st.boss.el, st.boss.el]; g.el2 = [st.boss.el2, st.boss.el2]; g.leg = [1, 1];
  const boss = makeCreature(rng, g, st.level, 'wild', 4);
  boss.name = st.boss.name;
  const run = baseRun('raid', st.boss.name, team, [{ enemies: [boss], mods: [{ boss: true, hpMul: 500, atkMul: 0.9, stage: 4 }], boss: true, level: st.level }]);
  run.sky = ['#1a1030', '#7a3b6e']; run.ground = '#2a1838';
  run.actionLimit = RAID_ACTIONS;
  return run;
}

/** Claim any raid reward tiers the week's total damage has reached. */
export function claimRaid(s: Save, now: number): Loot {
  const st = raidState(s, now);
  const loot = emptyLoot();
  while (s.raid.claimed < st.tiers.length && s.raid.dmg >= st.tiers[s.raid.claimed]) {
    const t = s.raid.claimed++;
    loot.gold += 200 * (t + 1) + st.level * 10;
    loot.dust += 3 + t; loot.shard += 1 + t; if (t >= 2) loot.core += t - 1; if (t >= 3) loot.scans += 1;
  }
  applyLoot(s, loot);
  return loot;
}

// ---------- Fights
export function startBattle(rng: Rng, s: Save, run: Run): Battle {
  const f = run.fights[run.idx];
  const mine = run.team.map(id => byId(s, id)).filter((c): c is Creature => !!c);
  const a = mine.map((c, i) => {
    const carry = run.carry[c.id];
    const u = makeUnit(c, 0, i, { hpFrac: carry ? Math.max(0.01, carry.hp) : 1 });
    if (carry && !carry.alive) { u.alive = false; u.hp = 0; }
    return u;
  });
  const b = f.enemies.map((c, i) => makeUnit(c, 1, i, f.mods[i]));
  return createBattle(rng, a, b);
}

export function applyLoot(s: Save, l: Loot) {
  s.gold += l.gold; s.dust += l.dust; s.shard += l.shard; s.core += l.core; s.scans += l.scans; s.essence += l.essence;
  for (const e of l.eggs) {
    if (s.eggs.length < 20) s.eggs.push(e); else s.essence += 10;
  }
}
function mergeLoot(into: Loot, l: Loot) {
  into.gold += l.gold; into.dust += l.dust; into.shard += l.shard; into.core += l.core; into.scans += l.scans; into.essence += l.essence;
  into.eggs.push(...l.eggs);
}

export interface XpLine extends XpResult { cid: string; xp: number; share: number }

/** XP is proportionate to the value a creature brought, and scales with the fight's difficulty against its level. */
export function awardXp(rng: Rng, s: Save, b: Battle, f: FightDef, mult: number): XpLine[] {
  const mine = b.units.filter(u => u.side === 0 && u.cid);
  const total = mine.reduce((a, u) => a + contribution(u), 0);
  const base = (30 + 12 * f.level) * (f.boss ? 1.6 : 1) * Math.max(0.6, f.enemies.length / 4);
  const lines: XpLine[] = [];
  for (const u of mine) {
    const c = byId(s, u.cid!);
    if (!c) continue;
    const share = total > 0 ? contribution(u) / total : 1 / mine.length;
    const diff = clamp(Math.pow((f.level + 4) / (c.level + 4), 1.6), 0.08, 6);
    let xp = base * diff * (0.35 + 0.65 * clamp(share * mine.length, 0, 2.2)) * mult;
    if (!u.alive) xp *= 0.4;
    // Cap per fight: at most about three levels, so the system can't be farmed.
    let cap = 0;
    for (let l = c.level; l < Math.min(MAX_LEVEL, c.level + 3); l++) cap += xpToNext(l);
    xp = Math.round(Math.min(xp, cap));
    lines.push({ cid: c.id, xp, share, ...addXp(rng, c, xp) });
  }
  return lines;
}

function fightDrops(rng: Rng, run: Run, f: FightDef, a: AreaDef | undefined): Loot {
  const l = emptyLoot();
  const tier = a ? a.id : Math.floor(f.level / 5);
  l.gold = Math.round((12 + f.level * 3.5) * Math.max(0.5, f.enemies.length / 3) * (0.8 + rng() * 0.4));
  if (rng() < 0.3 + tier * 0.02) l.dust = rint(rng, 1, 2 + Math.floor(tier / 5));
  if (rng() < 0.04 + tier * 0.012) l.shard = 1;
  // A small chance of an egg from one of the enemies you just fought, a bit higher in later fights.
  if (a && rng() < 0.07 + run.idx * 0.015) {
    const src = pick(rng, f.enemies.filter((_, i) => !f.mods[i].boss).length ? f.enemies.filter((_, i) => !f.mods[i].boss) : f.enemies);
    l.eggs.push({ id: newId('e'), g: eggFromEnemy(rng, src.g, wildOpts(a)), origin: 'wild', mutations: 0 });
  }
  return l;
}

export const PITY_LIMIT = 3;

function chestDrops(rng: Rng, s: Save, a: AreaDef, f: FightDef): Loot {
  const l = emptyLoot();
  l.gold = Math.round((60 + f.level * 16) * (0.9 + rng() * 0.2));
  l.dust = rint(rng, 2, 4 + Math.floor(a.id / 4));
  if (rng() < 0.7) l.shard = rint(rng, 1, 2 + Math.floor(a.id / 6));
  if (rng() < 0.18 + a.id * 0.012) l.core = 1;
  if (rng() < 0.15) l.scans = 1;
  const key = String(a.id);
  const first = !s.clears[key];
  const pity = s.pity[key] ?? 0;
  // Bad-luck protection: the rare egg is guaranteed on a first clear and after three dry chests in a row.
  if (first || pity >= PITY_LIMIT || rng() < 0.4) {
    const g = eggFromEnemy(rng, f.enemies[0].g, { ...wildOpts(a), quality: Math.min(1, a.quality + 0.25) });
    boostPotential(rng, g, 0.3);
    l.eggs.push({ id: newId('e'), g, origin: 'wild', mutations: 0 });
    s.pity[key] = 0;
  } else s.pity[key] = pity + 1;
  return l;
}

export interface FightResult {
  won: boolean;
  runOver: boolean;
  cleared: boolean;
  xp: XpLine[];
  drops: Loot;
  chest: Loot | null;
  note: string | null;
}

/** Settle a finished fight: XP, drops, carried health, and what happens to the run. Changes the save and the run. */
export function finishFight(rng: Rng, s: Save, run: Run, b: Battle, now: number): FightResult {
  const f = run.fights[run.idx];
  const a = run.areaId >= 0 ? AREAS[run.areaId] : undefined;
  const won = b.over === 0;
  const res: FightResult = { won, runOver: false, cleared: false, xp: [], drops: emptyLoot(), chest: null, note: null };
  s.counts.fights++;
  for (const u of b.units) if (u.side === 0 && u.cid) run.carry[u.cid] = { hp: u.alive ? Math.min(1, u.hp / u.max.hp + 0.3) : 0, alive: u.alive };

  if (run.kind === 'raid') {
    const dmg = Math.round(b.units.filter(u => u.side === 0).reduce((x, u) => x + u.contrib.dmg, 0));
    run.raidDmg = dmg;
    s.raid.dmg += dmg;
    res.xp = awardXp(rng, s, b, f, 0.6);
    res.runOver = true; res.won = true;
    res.chest = claimRaid(s, now);
    res.note = `Your team dealt ${dmg.toLocaleString()} damage.`;
    return res;
  }

  const tutorialBoost = s.tutorial < TUT.DONE ? 3 : 1;
  if (won || run.kind !== 'arena') res.xp = awardXp(rng, s, b, f, (won ? 1 : 0.3) * tutorialBoost * (run.kind === 'arena' ? 0.7 : 1));

  if (!won) {
    res.runOver = true;
    if (run.kind === 'arena') { s.arena.rating = Math.max(0, s.arena.rating - 15); s.arena.losses++; res.note = 'Rating -15'; }
    if (run.kind === 'tower') res.note = `You reached floor ${run.floor}.`;
    return res;
  }

  if (run.kind === 'tutorial') {
    const starter = byId(s, s.tutorialPair[0]);
    if (starter) levelTo(rng, starter, stageLevels(express(starter.g))[1]);
    res.drops.eggs.push(tutorialEgg(s));
    if (s.incubators.length === 0) s.incubators.push({ tier: 1, egg: null, startedAt: 0, readyAt: 0 });
    s.tutorial = TUT.INCUBATE;
    res.note = 'You found an egg, and your first incubator!';
    res.runOver = true; res.cleared = true;
  } else if (run.kind === 'arena') {
    s.arena.rating += 25; s.arena.wins++;
    res.drops.gold = 80 + Math.round(s.arena.rating * 0.8);
    if (rng() < 0.5) res.drops.shard = 1;
    res.drops.dust = rint(rng, 1, 3);
    res.note = 'Rating +25';
    res.runOver = true; res.cleared = true;
  } else if (run.kind === 'tower') {
    res.drops = fightDrops(rng, run, f, undefined);
    res.drops.gold = Math.round(res.drops.gold * 1.3);
    if (f.boss) {
      const q = clamp(run.floor / 60, 0.1, 0.95);
      res.chest = emptyLoot();
      res.chest.gold = 100 + run.floor * 25; res.chest.dust = rint(rng, 2, 5); res.chest.shard = rint(rng, 1, 3);
      if (rng() < 0.25 + q * 0.3) res.chest.core = 1;
      if (rng() < 0.35) res.chest.eggs.push({ id: newId('e'), g: eggFromEnemy(rng, f.enemies[0].g, { els: [express(f.enemies[0].g).el1], quality: q, rareCarrier: 0.05 + q * 0.2 }), origin: 'wild', mutations: 0 });
    }
    s.tower.best = Math.max(s.tower.best, run.floor);
    run.floor++;
    run.fights.push(towerFight(rng, run.floor));
    run.idx++;
  } else {
    res.drops = fightDrops(rng, run, f, a);
    if (f.boss && a) {
      res.chest = chestDrops(rng, s, a, f);
      const key = String(a.id);
      s.clears[key] = (s.clears[key] ?? 0) + 1;
      if (s.cleared <= a.id) s.cleared = a.id + 1;
      res.runOver = true; res.cleared = true;
      if (s.tutorial === TUT.RUN) {
        // The tutorial pair grows up by the end of the first run, so breeding can be shown next.
        for (const id of s.tutorialPair) { const c = byId(s, id); if (c) levelTo(rng, c, stageLevels(express(c.g))[2]); }
        s.tutorial = TUT.BREED;
        res.note = 'Your two creatures are adults now. Time to breed them!';
      }
    } else run.idx++;
  }
  mergeLoot(run.loot, res.drops);
  applyLoot(s, res.drops);
  if (res.chest) { mergeLoot(run.loot, res.chest); applyLoot(s, res.chest); }
  return res;
}

/** What a run can drop, shown before you start so you can plan which run to repeat. */
export function lootTable(s: Save, a: AreaDef) {
  const pity = s.pity[String(a.id)] ?? 0;
  const first = !s.clears[String(a.id)];
  return {
    fights: 'Gold, dust, a small chance of an egg from an enemy',
    chest: 'More gold, dust, shards, sometimes a core or scan lens',
    egg: first ? 'Rare egg: guaranteed on first clear' : pity >= PITY_LIMIT ? 'Rare egg: guaranteed this time' : `Rare egg: 40% (guaranteed in ${PITY_LIMIT - pity + 1} clears at most)`,
  };
}

export { SKELETONS };
