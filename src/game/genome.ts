// The genome: gene slots with two alleles each, simple dominant/recessive for traits, averaged for numbers.
// One genome drives looks, stats and moves.
import { ELEMENTS, ELEMENT_IDS, ElementId } from './data/elements';

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = <T,>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];
export const rint = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export function weighted<T>(rng: Rng, items: readonly T[], w: (t: T) => number): T {
  let total = 0;
  for (const it of items) total += w(it);
  let r = rng() * total;
  for (const it of items) { r -= w(it); if (r <= 0) return it; }
  return items[items.length - 1];
}

export type Skeleton = 'quad' | 'biped' | 'aquatic' | 'serpent' | 'multi' | 'floater';
export type Pair<T> = [T, T];

// Each list runs from most dominant to most recessive: when the two alleles differ, the earlier one shows.
export const SKELETONS: Skeleton[] = ['quad', 'biped', 'aquatic', 'serpent', 'multi', 'floater'];
export const SKELETON_NAMES: Record<Skeleton, string> = {
  quad: 'Quadruped', biped: 'Biped', aquatic: 'Aquatic', serpent: 'Serpentine', multi: 'Multi-legged', floater: 'Floating',
};
export const PARTS = {
  head: ['round', 'snout', 'beak', 'blunt', 'long', 'eared', 'frill', 'skull'],
  eyes: ['round', 'big', 'slit', 'sleepy', 'multi', 'glow'],
  horns: ['none', 'nubs', 'curved', 'spike', 'antenna', 'antlers', 'crown', 'crystal'],
  wings: ['none', 'feather', 'bat', 'insect', 'flipper', 'fin', 'energy'],
  tail: ['stub', 'long', 'tuft', 'fan', 'club', 'whip', 'stinger', 'plume'],
  pattern: ['plain', 'belly', 'spots', 'stripes', 'bands', 'mask', 'stars'],
  tone: ['base', 'pale', 'deep', 'warm', 'cool', 'ashen', 'gilded', 'melanic', 'albino'],
} as const;
export type PartKey = keyof typeof PARTS;
export const PART_KEYS = Object.keys(PARTS) as PartKey[];
export const PART_LABELS: Record<PartKey, string> = {
  head: 'Head', eyes: 'Eyes', horns: 'Horns', wings: 'Wings', tail: 'Tail', pattern: 'Pattern', tone: 'Color tone',
};

/** Secondary element alleles: 'none' sits between the common and uncommon elements, so rare second types hide behind it. */
const firstUncommon = ELEMENT_IDS.findIndex(e => ELEMENTS[e].tier > 0);
export const EL2_ORDER: (ElementId | 'none')[] = [...ELEMENT_IDS.slice(0, firstUncommon), 'none', ...ELEMENT_IDS.slice(firstUncommon)];

export type StatKey = 'hp' | 'atk' | 'def' | 'spd';
export const STAT_KEYS: StatKey[] = ['hp', 'atk', 'def', 'spd'];
export const STAT_LABELS: Record<StatKey, string> = { hp: 'Health', atk: 'Attack', def: 'Defense', spd: 'Speed' };

export interface Genome {
  skel: Pair<Skeleton>;
  el1: Pair<ElementId>;
  el2: Pair<ElementId | 'none'>;
  head: Pair<string>;
  eyes: Pair<string>;
  horns: Pair<string>;
  wings: Pair<string>;
  tail: Pair<string>;
  pattern: Pair<string>;
  tone: Pair<string>;
  /** Glass cannon (+2) to tank (-2). Averaged. */
  build: Pair<number>;
  /** Stat potential, 1..10 per allele. Averaged. A hidden ceiling. */
  hp: Pair<number>;
  atk: Pair<number>;
  def: Pair<number>;
  spd: Pair<number>;
  /** Growth speed: +1 fast, 0 normal, -1 slow. Averaged. */
  growth: Pair<number>;
  /** Rarity of the baby, teen, adult and ancient move slots: 0 Common, 1 Uncommon, 2 Rare. The commoner allele shows. */
  slots: Pair<number>[];
  /** Legendary-slot gene. 1 is the recessive "has a legendary slot" allele: it only shows when both are 1. */
  leg: Pair<number>;
  /** Move bias per slot: move ids passed down from the parents. They weight the roll but never guarantee it. */
  bias: Pair<string | null>[];
}

/** What actually shows. */
export interface Pheno {
  skel: Skeleton;
  el1: ElementId;
  el2: ElementId | null;
  head: string;
  eyes: string;
  horns: string;
  wings: string;
  tail: string;
  pattern: string;
  tone: string;
  build: number;
  pot: Record<StatKey, number>;
  growth: number;
  slots: number[];
  leg: boolean;
}

function dom<T>(order: readonly T[], pair: Pair<T>): T {
  return order.indexOf(pair[0]) <= order.indexOf(pair[1]) ? pair[0] : pair[1];
}
const avg = (p: Pair<number>) => (p[0] + p[1]) / 2;

export function express(g: Genome): Pheno {
  const el1 = dom(ELEMENT_IDS, g.el1);
  const e2 = dom(EL2_ORDER, g.el2);
  return {
    skel: dom(SKELETONS, g.skel),
    el1,
    el2: e2 === 'none' || e2 === el1 ? null : e2,
    head: dom(PARTS.head, g.head),
    eyes: dom(PARTS.eyes, g.eyes),
    horns: dom(PARTS.horns, g.horns),
    wings: dom(PARTS.wings, g.wings),
    tail: dom(PARTS.tail, g.tail),
    pattern: dom(PARTS.pattern, g.pattern),
    tone: dom(PARTS.tone, g.tone),
    build: avg(g.build),
    pot: { hp: avg(g.hp), atk: avg(g.atk), def: avg(g.def), spd: avg(g.spd) },
    growth: avg(g.growth),
    slots: g.slots.map(p => Math.min(p[0], p[1])),
    leg: g.leg[0] === 1 && g.leg[1] === 1,
  };
}

/** Parts an element tends to bring, used when making wild creatures so they look like their type. */
const EL_PARTS: Partial<Record<ElementId, Partial<Record<PartKey, string[]>>>> = {
  ember: { tail: ['plume', 'tuft'], horns: ['curved', 'nubs'] },
  tide: { wings: ['fin', 'flipper'], tail: ['fan'] },
  verdant: { horns: ['antlers', 'nubs'], tail: ['tuft', 'fan'], pattern: ['spots', 'belly'] },
  spark: { pattern: ['stripes'], tail: ['whip'], horns: ['spike'] },
  frost: { horns: ['crystal', 'spike'], wings: ['flipper'] },
  brawn: { head: ['blunt'], pattern: ['bands'], tail: ['club', 'stub'] },
  venom: { tail: ['stinger', 'whip'], head: ['long'], eyes: ['slit'] },
  terra: { head: ['snout', 'blunt'], tail: ['club'], pattern: ['belly'] },
  gale: { wings: ['feather'], head: ['beak'], tail: ['fan'] },
  mind: { eyes: ['big', 'glow'], horns: ['crown'], pattern: ['mask'] },
  swarm: { wings: ['insect'], horns: ['antenna'], eyes: ['multi'] },
  stone: { head: ['blunt'], horns: ['nubs', 'spike'], tail: ['club'] },
  spirit: { eyes: ['glow'], tail: ['plume'], head: ['skull', 'round'] },
  wyrm: { wings: ['bat'], horns: ['curved', 'crown'], tail: ['long', 'whip'], head: ['frill', 'long'] },
  shade: { eyes: ['glow', 'slit'], head: ['eared'], pattern: ['mask'] },
  forge: { pattern: ['bands'], horns: ['spike'], head: ['blunt'] },
  glimmer: { wings: ['insect', 'energy'], horns: ['antenna'], pattern: ['stars'] },
  radiant: { wings: ['energy', 'feather'], horns: ['crown'], pattern: ['stars'] },
  void: { wings: ['energy'], pattern: ['stars'], eyes: ['glow'], horns: ['crystal'] },
};

export interface WildOpts {
  /** Elements that can show. */
  els: ElementId[];
  /** 0..1: how good the hidden potential and move slots tend to be. */
  quality: number;
  skels?: Skeleton[];
  /** Chance that the hidden element allele is a rare one (Wyrm, Radiant, Void). */
  rareCarrier?: number;
}

function rollPart(rng: Rng, key: PartKey, el: ElementId): string {
  const pref = EL_PARTS[el]?.[key];
  if (pref && rng() < 0.6) return pick(rng, pref);
  const list: readonly string[] = PARTS[key];
  // Earlier (commoner) variants are likelier.
  return weighted(rng, list, v => 1 / (1 + list.indexOf(v) * 0.5));
}

function rollPot(rng: Rng, q: number): number {
  const centre = 2 + q * 5.5;
  return clamp(Math.round(centre + (rng() + rng() - 1) * 2.5), 1, 10);
}

function rollSlot(rng: Rng, q: number, slot: number): number {
  // Later slots lean rarer.
  const r = rng();
  const rareP = 0.02 + q * 0.2 + slot * 0.05;
  const uncP = 0.2 + q * 0.3 + slot * 0.08;
  return r < rareP ? 2 : r < rareP + uncP ? 1 : 0;
}

const RARE_ELS: ElementId[] = ['wyrm', 'wyrm', 'radiant', 'void'];

export function wildGenome(rng: Rng, o: WildOpts): Genome {
  const q = o.quality;
  const el = pick(rng, o.els);
  const hiddenEl: ElementId = rng() < (o.rareCarrier ?? 0.03) ? pick(rng, RARE_ELS) : rng() < 0.3 ? pick(rng, o.els) : el;
  const second: ElementId | 'none' = rng() < 0.3 ? pick(rng, o.els) : 'none';
  const second2: ElementId | 'none' = rng() < 0.25 ? pick(rng, ELEMENT_IDS.filter(e => ELEMENTS[e].tier <= 1)) : second;
  const skel = pick(rng, o.skels ?? SKELETONS);
  const het = <T,>(a: T, alt: () => T, p = 0.35): Pair<T> => (rng() < p ? [a, alt()] : [a, a]);
  const part = (k: PartKey): Pair<string> => {
    const a = rollPart(rng, k, el);
    return het(a, () => rollPart(rng, k, hiddenEl));
  };
  const potPair = (): Pair<number> => [rollPot(rng, q), rollPot(rng, q)];
  return {
    skel: het(skel, () => pick(rng, SKELETONS), 0.3),
    el1: [el, hiddenEl],
    el2: [second, second2],
    head: part('head'), eyes: part('eyes'), horns: part('horns'), wings: part('wings'),
    tail: part('tail'), pattern: part('pattern'), tone: part('tone'),
    build: [rint(rng, -2, 2), rint(rng, -2, 2)],
    hp: potPair(), atk: potPair(), def: potPair(), spd: potPair(),
    growth: [rint(rng, -1, 1), rint(rng, -1, 1)],
    slots: [0, 1, 2, 3].map(i => [rollSlot(rng, q, i), rollSlot(rng, q, i)] as Pair<number>),
    leg: [rng() < 0.05 + q * 0.3 ? 1 : 0, rng() < 0.05 + q * 0.3 ? 1 : 0],
    bias: [0, 1, 2, 3, 4].map(() => [null, null] as Pair<string | null>),
  };
}

export interface BreedOpts {
  /** Chance per gene of a mutation. */
  mutation?: number;
  /** Chance per stat-potential allele of a +1 bump (incubator quality and breeding materials). */
  potBoost?: number;
  /** What each parent's unlocked moves are, so they can bias the child's rolls. */
  momMoves?: (string | null)[];
  dadMoves?: (string | null)[];
}

function mutateAllele(rng: Rng, g: Genome, key: keyof Genome, idx: 0 | 1) {
  switch (key) {
    case 'skel': g.skel[idx] = pick(rng, SKELETONS); break;
    case 'el1': g.el1[idx] = weighted(rng, ELEMENT_IDS, e => [1, 0.8, 0.5, 0.4][ELEMENTS[e].tier]); break;
    case 'el2': g.el2[idx] = weighted(rng, ELEMENT_IDS, e => [1, 0.8, 0.5, 0.4][ELEMENTS[e].tier]); break;
    case 'build': g.build[idx] = clamp(g.build[idx] + (rng() < 0.5 ? 1 : -1), -2, 2); break;
    case 'hp': case 'atk': case 'def': case 'spd':
      g[key][idx] = clamp(g[key][idx] + (rng() < 0.7 ? 1 : -1) * rint(rng, 1, 2), 1, 10); break;
    case 'growth': g.growth[idx] = clamp(g.growth[idx] + (rng() < 0.5 ? 1 : -1), -1, 1); break;
    case 'leg': g.leg[idx] = 1; break;
    case 'slots': { const s = rint(rng, 0, 3); g.slots[s][idx] = clamp(g.slots[s][idx] + 1, 0, 2); break; }
    case 'bias': break;
    default: (g[key] as Pair<string>)[idx] = pick(rng, PARTS[key as PartKey] as readonly string[]);
  }
}

const GENE_KEYS: (keyof Genome)[] = ['skel', 'el1', 'el2', 'head', 'eyes', 'horns', 'wings', 'tail', 'pattern', 'tone', 'build', 'hp', 'atk', 'def', 'spd', 'growth', 'slots', 'leg'];

/** Each parent passes one random allele per gene slot. Returns the child genome and how many genes mutated. */
export function breed(rng: Rng, mom: Genome, dad: Genome, o: BreedOpts = {}): { g: Genome; mutations: number } {
  const one = <T,>(p: Pair<T>): T => p[rng() < 0.5 ? 0 : 1];
  const pair = <T,>(a: Pair<T>, b: Pair<T>): Pair<T> => [one(a), one(b)];
  const biasFrom = (g: Genome, moves: (string | null)[] | undefined, i: number): string | null => {
    const own = moves?.[i];
    if (own && rng() < 0.6) return own;
    return one(g.bias[i]) ?? own ?? null;
  };
  const g: Genome = {
    skel: pair(mom.skel, dad.skel), el1: pair(mom.el1, dad.el1), el2: pair(mom.el2, dad.el2),
    head: pair(mom.head, dad.head), eyes: pair(mom.eyes, dad.eyes), horns: pair(mom.horns, dad.horns),
    wings: pair(mom.wings, dad.wings), tail: pair(mom.tail, dad.tail), pattern: pair(mom.pattern, dad.pattern),
    tone: pair(mom.tone, dad.tone), build: pair(mom.build, dad.build),
    hp: pair(mom.hp, dad.hp), atk: pair(mom.atk, dad.atk), def: pair(mom.def, dad.def), spd: pair(mom.spd, dad.spd),
    growth: pair(mom.growth, dad.growth),
    slots: mom.slots.map((s, i) => pair(s, dad.slots[i])),
    leg: pair(mom.leg, dad.leg),
    bias: [0, 1, 2, 3, 4].map(i => [biasFrom(mom, o.momMoves, i), biasFrom(dad, o.dadMoves, i)] as Pair<string | null>),
  };
  let mutations = 0;
  const mu = o.mutation ?? 0.02;
  for (const key of GENE_KEYS) {
    if (rng() < mu) { mutateAllele(rng, g, key, rng() < 0.5 ? 0 : 1); mutations++; }
  }
  if (o.potBoost) boostPotential(rng, g, o.potBoost);
  return { g, mutations };
}

export function boostPotential(rng: Rng, g: Genome, chance: number) {
  for (const k of STAT_KEYS) for (const i of [0, 1] as const) if (rng() < chance) g[k][i] = clamp(g[k][i] + 1, 1, 10);
}

/** An egg dropped by an enemy inherits most, not all, of its traits. */
export function eggFromEnemy(rng: Rng, enemy: Genome, o: WildOpts): Genome {
  const fresh = wildGenome(rng, o);
  const g = JSON.parse(JSON.stringify(enemy)) as Genome;
  for (const key of GENE_KEYS) {
    if (key === 'slots') { g.slots.forEach((_, i) => { if (rng() < 0.3) g.slots[i] = fresh.slots[i]; }); continue; }
    if (rng() < 0.18) (g as any)[key] = (fresh as any)[key];
  }
  g.bias = g.bias.map(() => [null, null] as Pair<string | null>);
  return g;
}

/** 0..100 quality score from the genome's potential, not from level. */
export function qualityScore(g: Genome): number {
  const p = express(g);
  const pot = (p.pot.hp + p.pot.atk + p.pot.def + p.pot.spd) / 4;
  let s = ((pot - 1) / 9) * 50;
  s += (p.slots.reduce((a, b) => a + b, 0) / 8) * 22;
  if (p.leg) s += 12;
  s += (ELEMENTS[p.el1].tier / 3) * 10;
  if (p.el2) s += 3 + (ELEMENTS[p.el2].tier / 3) * 3;
  return s;
}

export const STAR_CUTS = [24, 36, 48, 62];
export function starRating(g: Genome): number {
  const s = qualityScore(g);
  let stars = 1;
  for (const c of STAR_CUTS) if (s >= c) stars++;
  return stars;
}

/** How many rare things this creature carries without showing: a rare element or the legendary-slot allele. */
export function rareCarrierCount(g: Genome): number {
  const p = express(g);
  let n = 0;
  for (const e of g.el1) if (e !== p.el1 && ELEMENTS[e].tier >= 2) n++;
  for (const e of g.el2) if (e !== 'none' && e !== p.el2 && e !== p.el1 && ELEMENTS[e].tier >= 2) n++;
  if (!p.leg && (g.leg[0] === 1 || g.leg[1] === 1)) n++;
  return n;
}

/** The low-star starters offered in the tutorial. They grow fast so breeding comes quickly. */
export function starterGenome(el: ElementId, skel: Skeleton, parts: Partial<Record<PartKey, string>>): Genome {
  const same = <T,>(v: T): Pair<T> => [v, v];
  return {
    skel: same(skel), el1: same(el), el2: same<ElementId | 'none'>('none'),
    head: same(parts.head ?? 'round'), eyes: same(parts.eyes ?? 'big'), horns: same(parts.horns ?? 'nubs'),
    wings: same(parts.wings ?? 'none'), tail: same(parts.tail ?? 'long'), pattern: same(parts.pattern ?? 'belly'),
    tone: same('base'), build: same(0),
    hp: [3, 3], atk: [3, 3], def: [3, 3], spd: [3, 3],
    growth: [1, 1],
    slots: [[0, 0], [0, 0], [1, 0], [1, 0]],
    leg: [0, 0],
    bias: [0, 1, 2, 3, 4].map(() => [null, null] as Pair<string | null>),
  };
}
