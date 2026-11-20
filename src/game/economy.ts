// Breeding, incubators, the shop and the roster. Every function changes the save it is given.
import { ELEMENTS, ElementId } from './data/elements';
import { Creature, Egg, addXp, hatch, newId, pedNode, stageLevels, stageOf, typeLabel, xpToNext } from './creature';
import { Genome, Rng, Skeleton, boostPotential, breed, express, starRating, starterGenome } from './genome';
import { Incubator, Save, TUT, byId, dayKey } from './save';

export const MIN = 60000;

// ---------- Starters
export const STARTERS: { name: string; g: Genome; blurb: string }[] = [
  { name: 'Cindertail', blurb: 'A fiery biped. Hits hard.', g: starterGenome('ember', 'biped', { head: 'snout', tail: 'plume', horns: 'nubs', pattern: 'belly' }) },
  { name: 'Ripplefin', blurb: 'A steady swimmer. Hard to knock out.', g: starterGenome('tide', 'aquatic', { head: 'round', tail: 'fan', horns: 'none', wings: 'fin', pattern: 'spots' }) },
  { name: 'Mossback', blurb: 'A leafy quadruped. Can heal.', g: starterGenome('verdant', 'quad', { head: 'eared', tail: 'tuft', horns: 'antlers', pattern: 'belly' }) },
];
// Starters grow up fast, so breeding comes within a few fights. Each also hides a recessive element and
// carries wings it doesn't show, so the very first breeding can already surprise you.
const STARTER_HIDDEN: ElementId[] = ['spark', 'frost', 'venom'];
STARTERS.forEach((s, i) => {
  s.g.growth = [3, 3];
  s.g.el1 = [s.g.el1[0], STARTER_HIDDEN[i]];
  s.g.hp = [3, 5]; s.g.atk = [4, 3]; s.g.def = [3, 4]; s.g.spd = [3, 5];
  if (s.g.wings[0] === 'none') s.g.wings = ['none', 'bat'];
  s.g.pattern = [s.g.pattern[0], 'stripes'];
  // Each starter has its own bearing: Cindertail stands proud, Ripplefin noses forward, Mossback prowls.
  s.g.stance = [[2, 2], [1, 3], [1, 1]][i] as [number, number];
});

export function pickStarter(rng: Rng, s: Save, idx: number): Creature {
  const st = STARTERS[idx];
  const c = hatch(rng, { id: '', g: JSON.parse(JSON.stringify(st.g)), origin: 'starter', mutations: 0 });
  c.name = st.name;
  s.creatures.push(c);
  s.team = [c.id];
  s.tutorialPair = [c.id];
  s.tutorial = TUT.FIGHT;
  return c;
}

/** The scripted egg from the tutorial fight: a different element, low stars, and it grows fast too. */
export function tutorialEgg(s: Save): Egg {
  const starter = byId(s, s.tutorialPair[0]);
  const el = starter ? express(starter.g).el1 : 'ember';
  const pickEl = el === 'ember' ? 'terra' : el === 'tide' ? 'gale' : 'swarm';
  const skel: Skeleton = el === 'verdant' ? 'multi' : el === 'tide' ? 'biped' : 'quad';
  const g = starterGenome(pickEl, skel, pickEl === 'gale' ? { head: 'beak', wings: 'feather', tail: 'fan', horns: 'none' } : pickEl === 'swarm' ? { head: 'round', wings: 'insect', horns: 'antenna', tail: 'stinger', eyes: 'multi' } : { head: 'blunt', tail: 'club', horns: 'nubs' });
  g.growth = [3, 3];
  // It hides the same recessive element as the starter, so their child shows it one time in four.
  if (starter) g.el1 = [pickEl, starter.g.el1[1]];
  g.skel = [skel, 'floater'];
  if (g.wings[0] === 'none') g.wings = ['none', 'bat'];
  g.atk = [4, 5]; g.spd = [4, 3]; g.hp = [5, 3]; g.def = [4, 4];
  g.slots = [[0, 0], [1, 0], [1, 1], [1, 2]];
  return { id: newId('e'), g, origin: 'wild', mutations: 0 };
}

// ---------- Breeding
const STAR_COST = [1, 1, 1.5, 2.5, 4, 7];

export function breedCost(mom: Creature, dad: Creature): number {
  const stars = Math.max(starRating(mom.g), starRating(dad.g));
  const stageMul = Math.max(...[mom, dad].map(c => [1, 1, 1, 1.5, 2][stageOf(c)]));
  const rare = Math.max(...[mom, dad].map(c => ELEMENTS[express(c.g).el1].tier));
  return Math.round(60 * STAR_COST[stars] * stageMul * (1 + rare * 0.4) * (1 + 0.35 * (mom.bred + dad.bred)));
}

export function breedCooldownMs(c: Creature): number {
  return Math.min(120, 3 + 4 * c.bred) * MIN;
}

export interface BreedMats { dust: boolean; shard: boolean; core: boolean }
export const MAT_COST = { dust: 5, shard: 3, core: 1 };

export function breedProblem(s: Save, mom: Creature | undefined, dad: Creature | undefined, now: number, mats?: BreedMats): string | null {
  if (!mom || !dad) return 'Pick a female and a male.';
  if (mom.id === dad.id) return 'Pick two different creatures.';
  if (mom.sex === dad.sex) return 'Breeding needs one female and one male.';
  for (const c of [mom, dad]) {
    if (stageOf(c) < 2) return `${c.name} is not an adult yet (adult at level ${stageLevels(express(c.g))[2]}).`;
    if (c.breedReadyAt > now) return `${c.name} is resting.`;
  }
  const free = s.tutorial < TUT.DONE;
  if (!free && s.gold < breedCost(mom, dad)) return 'Not enough gold.';
  if (mats?.dust && s.dust < MAT_COST.dust) return 'Not enough dust.';
  if (mats?.shard && s.shard < MAT_COST.shard) return 'Not enough shards.';
  if (mats?.core && s.core < MAT_COST.core) return 'Not enough cores.';
  if (s.eggs.length >= 20) return 'Egg storage is full.';
  return null;
}

export function doBreed(rng: Rng, s: Save, momId: string, dadId: string, mats: BreedMats, now: number): Egg | null {
  let a = byId(s, momId), b = byId(s, dadId);
  if (a && b && a.sex === 'M') [a, b] = [b, a];
  if (breedProblem(s, a, b, now, mats) || !a || !b) return null;
  const tutorial = s.tutorial < TUT.DONE;
  if (!tutorial) s.gold -= breedCost(a, b);
  if (mats.dust) s.dust -= MAT_COST.dust;
  if (mats.shard) s.shard -= MAT_COST.shard;
  if (mats.core) s.core -= MAT_COST.core;
  // Materials improve odds and quality, never raw power.
  const { g, mutations } = breed(rng, a.g, b.g, {
    mutation: 0.02 + (mats.shard ? 0.03 : 0),
    potBoost: (mats.dust ? 0.07 : 0) + (mats.core ? 0.12 : 0),
    momMoves: a.moves, dadMoves: b.moves,
  });
  if (mats.core) for (const i of [0, 1] as const) if (g.leg[i] === 0 && rng() < 0.12) g.leg[i] = 1;
  const egg: Egg = { id: newId('e'), g, origin: 'bred', mom: pedNode(a), dad: pedNode(b), mutations };
  s.eggs.push(egg);
  for (const c of [a, b]) {
    c.bred++;
    c.breedReadyAt = tutorial ? 0 : now + breedCooldownMs(c);
  }
  s.counts.bred++;
  if (s.tutorial === TUT.BREED) s.tutorial = TUT.HATCH2;
  return egg;
}

export interface Forecast {
  types: { label: string; p: number }[];
  skels: { skel: Skeleton; p: number }[];
  stars: number[];
  legendary: number;
  dual: number;
}

/** Odds of what the egg could be, without naming alleles. Sampled, with no mutation. */
export function forecast(rng: Rng, mom: Genome, dad: Genome, n = 400): Forecast {
  const types: Record<string, number> = {}, skels: Record<string, number> = {};
  const stars = [0, 0, 0, 0, 0];
  let legendary = 0, dual = 0;
  for (let i = 0; i < n; i++) {
    const { g } = breed(rng, mom, dad, { mutation: 0 });
    const p = express(g);
    const label = typeLabel(p);
    types[label] = (types[label] ?? 0) + 1;
    skels[p.skel] = (skels[p.skel] ?? 0) + 1;
    stars[starRating(g) - 1]++;
    if (p.leg) legendary++;
    if (p.el2) dual++;
  }
  const sorted = (o: Record<string, number>) => Object.entries(o).sort((x, y) => y[1] - x[1]);
  return {
    types: sorted(types).map(([label, c]) => ({ label, p: c / n })),
    skels: sorted(skels).map(([skel, c]) => ({ skel: skel as Skeleton, p: c / n })),
    stars: stars.map(c => c / n), legendary: legendary / n, dual: dual / n,
  };
}

// ---------- Incubators
const INC_MINUTES = [1, 3, 8, 20, 45];
const TIER_TIME = [1, 1, 0.8, 0.6];
const TIER_BOOST = [0, 0, 0.08, 0.18];
export const INC_SLOT_COST = [0, 800, 4000, 15000];
export const INC_UPGRADE = [null, null, { gold: 500, dust: 20, shard: 5, core: 0 }, { gold: 3000, dust: 0, shard: 20, core: 5 }] as const;

export function incubationMs(egg: Egg, tier: number): number {
  return INC_MINUTES[starRating(egg.g) - 1] * TIER_TIME[tier] * MIN;
}

export function placeEgg(s: Save, incIdx: number, eggId: string, now: number): boolean {
  const inc = s.incubators[incIdx];
  const i = s.eggs.findIndex(e => e.id === eggId);
  if (!inc || inc.egg || i < 0) return false;
  const [egg] = s.eggs.splice(i, 1);
  inc.egg = egg;
  inc.startedAt = now;
  // Tutorial eggs hatch straight away so the loop is shown without a wait.
  inc.readyAt = s.tutorial < TUT.DONE ? now : now + incubationMs(egg, inc.tier);
  return true;
}

/** Speeding up costs gold, and each speed-up in a day costs more than the last, so it stays reasonable. */
export function speedUpCost(s: Save, inc: Incubator, now: number): number {
  const mins = Math.max(0, Math.ceil((inc.readyAt - now) / MIN));
  const n = s.speedups.day === dayKey(now) ? s.speedups.n : 0;
  return Math.round(mins * 15 * (1 + 0.5 * n));
}

export function speedUp(s: Save, incIdx: number, now: number): boolean {
  const inc = s.incubators[incIdx];
  if (!inc?.egg || inc.readyAt <= now) return false;
  const cost = speedUpCost(s, inc, now);
  if (s.gold < cost) return false;
  s.gold -= cost;
  const day = dayKey(now);
  s.speedups = { day, n: (s.speedups.day === day ? s.speedups.n : 0) + 1 };
  inc.readyAt = now;
  return true;
}

export function hatchEgg(rng: Rng, s: Save, incIdx: number, now: number): Creature | null {
  const inc = s.incubators[incIdx];
  if (!inc?.egg || inc.readyAt > now || s.creatures.length >= s.rosterCap) return null;
  const egg = inc.egg;
  if (TIER_BOOST[inc.tier]) boostPotential(rng, egg.g, TIER_BOOST[inc.tier]);
  const c = hatch(rng, egg);
  if (s.tutorial === TUT.INCUBATE) {
    // The first hatchling is always the opposite sex of the starter, so the pair can breed.
    const starter = byId(s, s.tutorialPair[0]);
    if (starter) c.sex = starter.sex === 'M' ? 'F' : 'M';
    s.tutorialPair.push(c.id);
    s.tutorial = TUT.RUN;
    if (!s.team.includes(c.id)) s.team.push(c.id);
  } else if (s.tutorial === TUT.HATCH2) {
    s.tutorial = TUT.DONE;
    s.gold += 300;
    s.scans += 1;
  }
  inc.egg = null;
  s.creatures.push(c);
  s.counts.hatched++;
  return c;
}

export function buyIncubator(s: Save): boolean {
  const cost = INC_SLOT_COST[s.incubators.length];
  if (cost == null || s.gold < cost) return false;
  s.gold -= cost;
  s.incubators.push({ tier: 1, egg: null, startedAt: 0, readyAt: 0 });
  return true;
}

export function upgradeIncubator(s: Save, incIdx: number): boolean {
  const inc = s.incubators[incIdx];
  const cost = inc && INC_UPGRADE[inc.tier + 1];
  if (!inc || !cost) return false;
  if (s.gold < cost.gold || s.dust < cost.dust || s.shard < cost.shard || s.core < cost.core) return false;
  s.gold -= cost.gold; s.dust -= cost.dust; s.shard -= cost.shard; s.core -= cost.core;
  inc.tier = (inc.tier + 1) as 2 | 3;
  return true;
}

// ---------- Roster and shop
export function releaseValue(c: Creature): { essence: number; dust: number } {
  const st = starRating(c.g);
  return { essence: st * st * 3 + Math.floor(c.level / 5), dust: st };
}

export function release(s: Save, id: string): boolean {
  const c = byId(s, id);
  if (!c || s.creatures.length <= 1 || c.fav) return false;
  const v = releaseValue(c);
  s.essence += v.essence; s.dust += v.dust;
  s.creatures = s.creatures.filter(x => x.id !== id);
  s.team = s.team.filter(x => x !== id);
  s.counts.released++;
  return true;
}

export function rosterExpandCost(s: Save): number | null {
  return s.rosterCap >= 100 ? null : 1500 * ((s.rosterCap - 30) / 10 + 1);
}
export function expandRoster(s: Save): boolean {
  const cost = rosterExpandCost(s);
  if (cost == null || s.gold < cost) return false;
  s.gold -= cost; s.rosterCap += 10;
  return true;
}

export const SHOP = [
  { id: 'scan', name: 'Scan lens', desc: "Reveals all of one creature's hidden genes.", essence: 30 },
  { id: 'dust', name: 'Dust x5', desc: 'Common material for incubators and breeding.', essence: 10 },
  { id: 'shard', name: 'Shard', desc: 'Uncommon material. Raises mutation odds in breeding.', essence: 15 },
  { id: 'core', name: 'Core', desc: 'Rare material. Raises hidden potential in breeding.', essence: 60 },
] as const;

export function buy(s: Save, id: string): boolean {
  const item = SHOP.find(x => x.id === id);
  if (!item || s.essence < item.essence) return false;
  s.essence -= item.essence;
  if (id === 'scan') s.scans++; else if (id === 'dust') s.dust += 5; else if (id === 'shard') s.shard++; else s.core++;
  return true;
}

export const NAME_MAX = 16;
/** Rename a creature. Names are trimmed and must have at least one visible character. */
export function renameCreature(s: Save, id: string, name: string): boolean {
  const c = byId(s, id);
  const n = name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
  if (!c || !n) return false;
  c.name = n;
  return true;
}

export function useScan(s: Save, id: string): boolean {
  const c = byId(s, id);
  if (!c || c.scanned || s.scans < 1) return false;
  s.scans--; c.scanned = true;
  return true;
}

/** Give a creature enough XP to reach a level. Used by the tutorial. */
export function levelTo(rng: Rng, c: Creature, level: number) {
  let need = -c.xp;
  for (let l = c.level; l < level; l++) need += xpToNext(l);
  if (need > 0) addXp(rng, c, need);
}
