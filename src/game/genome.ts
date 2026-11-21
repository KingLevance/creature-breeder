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
  ears: ['none', 'pointed', 'round', 'floppy', 'tufted', 'long', 'fins'],
  eyes: ['round', 'big', 'slit', 'sleepy', 'multi', 'glow'],
  horns: ['none', 'nubs', 'curved', 'spike', 'antenna', 'antlers', 'crown', 'crystal'],
  // Along the back.
  crest: ['none', 'spikes', 'mane', 'plates', 'quills', 'sail', 'crystals'],
  wings: ['none', 'feather', 'bat', 'insect', 'flipper', 'fin', 'energy'],
  tail: ['stub', 'long', 'tuft', 'fan', 'club', 'whip', 'stinger', 'plume'],
  feet: ['paws', 'claws', 'hooves', 'talons', 'webbed'],
  pattern: ['plain', 'belly', 'spots', 'stripes', 'bands', 'mask', 'stars'],
  tone: ['base', 'pale', 'deep', 'warm', 'cool', 'ashen', 'gilded', 'melanic', 'albino'],
  // Eye colour: brown is dominant, as in people; the bright colours are recessive.
  iris: ['brown', 'amber', 'green', 'blue', 'gold', 'violet', 'red', 'silver'],
  // The face it makes at rest.
  mood: ['calm', 'cheerful', 'fierce', 'grumpy', 'smug', 'shy', 'goofy'],
} as const;
export type PartKey = keyof typeof PARTS;
export const PART_KEYS = Object.keys(PARTS) as PartKey[];
export const PART_LABELS: Record<PartKey, string> = {
  head: 'Head', eyes: 'Eyes', horns: 'Horns', wings: 'Wings', tail: 'Tail', pattern: 'Pattern', tone: 'Color tone',
  iris: 'Eye color', mood: 'Expression', ears: 'Ears', crest: 'Back', feet: 'Feet',
};
/** Looks genes added after the first release. Older saves get them from fillGenome, each from its own stream. */
export const LATE_PARTS: PartKey[] = ['iris', 'mood', 'ears', 'crest', 'feet'];
/** How often a wild allele takes its element's favourite. The later looks genes vary more within an element. */
const PREF_RATE: Partial<Record<PartKey, number>> = { iris: 0.45, mood: 0.3, ears: 0.4, crest: 0.35, feet: 0.45 };
/** Wild chance of the recessive shiny allele: about 1 in 200 wild creatures shows it (0.07²), 1 in 8 carries it. */
export const SHINY_ALLELE = 0.07;

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
  iris: Pair<string>;
  mood: Pair<string>;
  ears: Pair<string>;
  crest: Pair<string>;
  feet: Pair<string>;
  /** Shiny gene: 1 is the recessive shiny allele, which only shows when both are 1 (a rare alternate colouring). */
  shiny: Pair<number>;
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
  /** Which of the element's marking styles shows (0, 1 or 2). The lower number is dominant. */
  mark: Pair<number>;
  /** A small shift of the body's hue, -2..2 per allele. Averaged, so children blend their parents' shades. */
  hue: Pair<number>;
  /** How it stands: 0 upright, 1 prowling low, 2 proud and chest-out, 3 hunched. The lower number is dominant. */
  stance: Pair<number>;
  /** Body proportions, -2..2 per allele and averaged, so children land between their parents: */
  /** how thick the body and limbs are, slender (-2) to bulky (+2), */
  girth: Pair<number>;
  /** and how tall it stands, squat and short-legged (-2) to long-legged and lanky (+2). */
  height: Pair<number>;
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
  /** Later looks genes: optional, because pedigree snapshots from older saves don't have them. */
  iris?: string;
  mood?: string;
  ears?: string;
  crest?: string;
  feet?: string;
  shiny?: boolean;
  build: number;
  pot: Record<StatKey, number>;
  growth: number;
  slots: number[];
  leg: boolean;
  /** Marking style 0..2 and hue shift in degrees. Optional so older snapshots (pedigrees) still draw. */
  mark?: number;
  hue?: number;
  stance?: number;
  /** Proportions, -1..1: thin to thick, and short to tall. Optional for older snapshots. */
  girth?: number;
  height?: number;
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
    ...Object.fromEntries(LATE_PARTS.map(k => [k, dom(PARTS[k], g[k] ?? [PARTS[k][0], PARTS[k][0]])])),
    shiny: !!g.shiny && g.shiny[0] === 1 && g.shiny[1] === 1,
    build: avg(g.build),
    pot: { hp: avg(g.hp), atk: avg(g.atk), def: avg(g.def), spd: avg(g.spd) },
    growth: avg(g.growth),
    slots: g.slots.map(p => Math.min(p[0], p[1])),
    leg: g.leg[0] === 1 && g.leg[1] === 1,
    mark: g.mark ? Math.min(g.mark[0], g.mark[1]) : 0,
    hue: g.hue ? ((g.hue[0] + g.hue[1]) / 2) * 8 : 0,
    stance: g.stance ? Math.min(g.stance[0], g.stance[1]) : 0,
    girth: g.girth ? avg(g.girth) / 2 : 0,
    height: g.height ? avg(g.height) / 2 : 0,
  };
}

/** Parts an element tends to bring, used when making wild creatures so they look like their type. */
const EL_PARTS: Partial<Record<ElementId, Partial<Record<PartKey, string[]>>>> = {
  ember: { tail: ['plume', 'tuft'], horns: ['curved', 'nubs'], iris: ['amber', 'red', 'gold'], mood: ['fierce', 'cheerful'], ears: ['pointed'], crest: ['spikes', 'mane'], feet: ['claws'] },
  tide: { wings: ['fin', 'flipper'], tail: ['fan'], iris: ['blue'], mood: ['calm', 'cheerful'], ears: ['fins'], crest: ['sail'], feet: ['webbed'] },
  verdant: { horns: ['antlers', 'nubs'], tail: ['tuft', 'fan'], pattern: ['spots', 'belly'], iris: ['green', 'amber'], mood: ['calm', 'cheerful', 'shy'], ears: ['floppy', 'long', 'round'], crest: ['quills'], feet: ['paws', 'hooves'] },
  spark: { pattern: ['stripes'], tail: ['whip'], horns: ['spike'], iris: ['gold', 'blue'], mood: ['cheerful', 'goofy'], ears: ['pointed', 'tufted', 'long'], crest: ['quills', 'spikes'], feet: ['paws'] },
  frost: { horns: ['crystal', 'spike'], wings: ['flipper'], iris: ['blue', 'silver'], mood: ['calm', 'shy'], ears: ['round', 'pointed'], crest: ['crystals'], feet: ['paws', 'claws'] },
  brawn: { head: ['blunt'], pattern: ['bands'], tail: ['club', 'stub'], iris: ['brown', 'red'], mood: ['fierce', 'grumpy'], ears: ['round'], crest: ['mane'], feet: ['hooves', 'claws'] },
  venom: { tail: ['stinger', 'whip'], head: ['long'], eyes: ['slit'], iris: ['green', 'violet'], mood: ['smug', 'fierce'], ears: ['fins'], crest: ['spikes', 'quills'], feet: ['claws'] },
  terra: { head: ['snout', 'blunt'], tail: ['club'], pattern: ['belly'], iris: ['brown', 'amber'], mood: ['grumpy', 'calm'], ears: ['round', 'floppy'], crest: ['plates'], feet: ['hooves', 'claws'] },
  gale: { wings: ['feather'], head: ['beak'], tail: ['fan'], iris: ['silver', 'blue'], mood: ['cheerful', 'smug'], ears: ['tufted', 'long'], crest: ['mane'], feet: ['talons'] },
  mind: { eyes: ['big', 'glow'], horns: ['crown'], pattern: ['mask'], iris: ['violet'], mood: ['calm', 'smug'], ears: ['long', 'round'], crest: ['mane'], feet: ['paws'] },
  swarm: { wings: ['insect'], horns: ['antenna'], eyes: ['multi'], iris: ['amber', 'red'], mood: ['goofy', 'fierce'], ears: ['none'], crest: ['spikes'], feet: ['claws'] },
  stone: { head: ['blunt'], horns: ['nubs', 'spike'], tail: ['club'], iris: ['brown', 'silver'], mood: ['grumpy', 'calm'], ears: ['round'], crest: ['plates', 'crystals'], feet: ['hooves'] },
  spirit: { eyes: ['glow'], tail: ['plume'], head: ['skull', 'round'], iris: ['silver', 'blue'], mood: ['shy', 'calm'], ears: ['floppy', 'long'], crest: ['none'], feet: ['paws'] },
  wyrm: { wings: ['bat'], horns: ['curved', 'crown'], tail: ['long', 'whip'], head: ['frill', 'long'], iris: ['gold', 'red'], mood: ['fierce', 'smug'], ears: ['fins', 'pointed'], crest: ['spikes', 'sail', 'plates'], feet: ['talons', 'claws'] },
  shade: { eyes: ['glow', 'slit'], head: ['eared'], pattern: ['mask'], iris: ['red', 'violet'], mood: ['smug', 'fierce'], ears: ['pointed', 'tufted'], crest: ['quills', 'spikes'], feet: ['claws'] },
  forge: { pattern: ['bands'], horns: ['spike'], head: ['blunt'], iris: ['amber', 'red'], mood: ['grumpy', 'fierce'], ears: ['round'], crest: ['plates'], feet: ['hooves'] },
  glimmer: { wings: ['insect', 'energy'], horns: ['antenna'], pattern: ['stars'], iris: ['violet', 'gold'], mood: ['cheerful', 'shy'], ears: ['long', 'pointed'], crest: ['crystals'], feet: ['paws'] },
  radiant: { wings: ['energy', 'feather'], horns: ['crown'], pattern: ['stars'], iris: ['gold'], mood: ['calm', 'cheerful'], ears: ['pointed'], crest: ['mane'], feet: ['talons', 'paws'] },
  void: { wings: ['energy'], pattern: ['stars'], eyes: ['glow'], horns: ['crystal'], iris: ['violet', 'silver'], mood: ['calm', 'smug'], ears: ['none'], crest: ['crystals'], feet: ['claws'] },
};

/** Wild marking alleles: the dominant style 0 is the rarest allele, so all three styles turn up often. */
export const rollMark = (rng: Rng) => { const r = rng(); return r < 0.2 ? 0 : r < 0.55 ? 1 : 2; };
/** Wild stance alleles, weighted so each of the four stances shows in about a quarter of wild creatures. */
export const rollStance = (rng: Rng) => { const r = rng(); return r < 0.134 ? 0 : r < 0.293 ? 1 : r < 0.5 ? 2 : 3; };
export const STANCE_NAMES = ['Upright', 'Prowling', 'Proud', 'Hunched'];
const STANCE_NAMES_BY: Partial<Record<Skeleton, string[]>> = {
  biped: ['Upright', 'Ready', 'Proud', 'Relaxed'],
  quad: ['Upright', 'Prowling', 'Proud', 'Playful'],
  serpent: ['Upright', 'Striking', 'Rearing', 'Coiled'],
  aquatic: ['Level', 'Diving', 'Rising', 'Lunging'],
  floater: ['Upright', 'Drifting', 'Proud', 'Swooping'],
};
/** What a stance looks like on this body plan. */
export const stanceName = (skel: Skeleton, i: number) => (STANCE_NAMES_BY[skel] ?? STANCE_NAMES)[i] ?? STANCE_NAMES[0];
export const rollHue = (rng: Rng) => rint(rng, -2, 2);
export const rollShape = (rng: Rng) => rint(rng, -2, 2);
export const FRAME_NAMES = ['Slender', 'Lean', 'Average', 'Stocky', 'Bulky'];
export const HEIGHT_NAMES = ['Squat', 'Short', 'Average', 'Tall', 'Lanky'];
/** A name for a proportion allele (-2..2) or an expressed value (-1..1, pass it times 2). */
export const shapeName = (names: string[], v: number) => names[Math.max(0, Math.min(4, Math.round(v) + 2))];

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
  if (pref && rng() < (PREF_RATE[key] ?? 0.6)) return pick(rng, pref);
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
    mark: [rollMark(rng), rollMark(rng)],
    hue: [rollHue(rng), rollHue(rng)],
    stance: [rollStance(rng), rollStance(rng)],
    girth: [rollShape(rng), rollShape(rng)],
    height: [rollShape(rng), rollShape(rng)],
    ...lateParts(k => part(k)),
    shiny: [rng() < SHINY_ALLELE ? 1 : 0, rng() < SHINY_ALLELE ? 1 : 0],
  };
}
/** The later looks genes as an object, rolled in a fixed order. */
const lateParts = (roll: (k: PartKey) => Pair<string>) => Object.fromEntries(LATE_PARTS.map(k => [k, roll(k)])) as Pick<Genome, 'iris' | 'mood' | 'ears' | 'crest' | 'feet'>;

/** Saves from before marking styles and hue existed: give those genomes alleles, stable per creature. */
export function fillGenome(g: Genome, key: string) {
  const seed = (k: string) => { let h = 2166136261; for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 16777619); return mulberry32(h >>> 0); };
  const rng = seed(key);
  if (!g.mark) g.mark = [rollMark(rng), rollMark(rng)];
  if (!g.hue) g.hue = [rollHue(rng), rollHue(rng)];
  if (!g.stance) { rng(); g.stance = [rollStance(rng), rollStance(rng)]; }
  // Proportions came later still: their own stream, so the genes filled in above stay exactly as they were.
  const r2 = seed(key + '#shape');
  if (!g.girth) g.girth = [rollShape(r2), rollShape(r2)];
  if (!g.height) g.height = [rollShape(r2), rollShape(r2)];
  // The later looks genes: one stream each, so adding another later never changes these. They follow the
  // creature's element, and its hidden element for the second allele, like a wild one's.
  for (const k of LATE_PARTS) {
    if (g[k]) continue;
    const r = seed(key + '#' + k), a = rollPart(r, k, g.el1[0]);
    g[k] = r() < 0.35 ? [a, rollPart(r, k, g.el1[1])] : [a, a];
  }
  if (!g.shiny) { const r = seed(key + '#shiny'); g.shiny = [r() < SHINY_ALLELE ? 1 : 0, r() < SHINY_ALLELE ? 1 : 0]; }
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
    case 'mark': g.mark[idx] = rint(rng, 0, 2); break;
    case 'hue': g.hue[idx] = clamp(g.hue[idx] + (rng() < 0.5 ? 1 : -1), -2, 2); break;
    case 'stance': g.stance[idx] = rint(rng, 0, 3); break;
    case 'girth': g.girth[idx] = clamp(g.girth[idx] + (rng() < 0.5 ? 1 : -1), -2, 2); break;
    case 'height': g.height[idx] = clamp(g.height[idx] + (rng() < 0.5 ? 1 : -1), -2, 2); break;
    case 'shiny': g.shiny[idx] = 1; break;
    case 'bias': break;
    default: (g[key] as Pair<string>)[idx] = pick(rng, PARTS[key as PartKey] as readonly string[]);
  }
}

const GENE_KEYS: (keyof Genome)[] = ['skel', 'el1', 'el2', 'head', 'eyes', 'horns', 'wings', 'tail', 'pattern', 'tone', 'build', 'hp', 'atk', 'def', 'spd', 'growth', 'slots', 'leg', 'mark', 'hue', 'stance', 'girth', 'height', ...LATE_PARTS, 'shiny'];

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
    mark: pair(mom.mark ?? [0, 0], dad.mark ?? [0, 0]),
    hue: pair(mom.hue ?? [0, 0], dad.hue ?? [0, 0]),
    stance: pair(mom.stance ?? [0, 0], dad.stance ?? [0, 0]),
    girth: pair(mom.girth ?? [0, 0], dad.girth ?? [0, 0]),
    height: pair(mom.height ?? [0, 0], dad.height ?? [0, 0]),
    ...lateParts(k => pair(mom[k] ?? [PARTS[k][0], PARTS[k][0]], dad[k] ?? [PARTS[k][0], PARTS[k][0]])),
    shiny: pair(mom.shiny ?? [0, 0], dad.shiny ?? [0, 0]),
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
  if (!p.shiny && g.shiny && (g.shiny[0] === 1 || g.shiny[1] === 1)) n++;
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
    mark: [0, 0],
    hue: [0, 0],
    stance: [0, 0],
    girth: [0, 0],
    height: [0, 0],
    ...lateParts(k => same(parts[k] ?? STARTER_LOOKS[k] ?? PARTS[k][0])),
    shiny: [0, 0],
  };
}
const STARTER_LOOKS: Partial<Record<PartKey, string>> = { mood: 'cheerful', iris: 'amber' };
