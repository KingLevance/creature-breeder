// A creature instance: genome plus level, moves and lineage. Stats, life stages and move unlocks live here.
import { ELEMENTS, ElementId } from './data/elements';
import { MOVES, MoveDef, movePool, strikeFor } from './data/moves';
import { Genome, Pheno, Rng, Skeleton, StatKey, express, pick, starRating, weighted } from './genome';

export type Sex = 'M' | 'F';
export type Stage = 0 | 1 | 2 | 3 | 4;
export const STAGE_NAMES = ['Baby', 'Teen', 'Adult', 'Ancient', 'Legendary'];
export const MAX_LEVEL = 100;

/** A snapshot of an ancestor's visible traits, kept so the pedigree survives the ancestor being released. */
export interface PedNode {
  name: string;
  sex: Sex;
  stars: number;
  ph: Pheno;
  m?: PedNode;
  f?: PedNode;
}

export interface Creature {
  id: string;
  name: string;
  g: Genome;
  sex: Sex;
  level: number;
  xp: number;
  /** One slot per life stage. null means not unlocked yet (or no legendary slot). */
  moves: (string | null)[];
  bred: number;
  breedReadyAt: number;
  scanned: boolean;
  origin: 'starter' | 'wild' | 'bred';
  mom?: PedNode;
  dad?: PedNode;
  fav?: boolean;
}

export interface Egg {
  id: string;
  g: Genome;
  origin: 'wild' | 'bred' | 'starter';
  mom?: PedNode;
  dad?: PedNode;
  mutations: number;
}

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter++;
  return prefix + Date.now().toString(36) + idCounter.toString(36) + Math.floor(Math.random() * 1296).toString(36);
}

const SYL_A = ['Ka', 'Mo', 'Zu', 'Ti', 'Ra', 'Lo', 'Fen', 'Bri', 'Ol', 'Sha', 'Nim', 'Vex', 'Gra', 'Pip', 'Yu', 'Dra', 'El', 'Quo', 'Hex', 'Ju', 'Wyn', 'Ash', 'Tor', 'Lum'];
const SYL_B = ['ra', 'mi', 'lo', 'zu', 'ko', 'na', 'bi', 'th', 'sk', 'pa', 'vi', 'ro', 'li', 'do', 'xa', 'ni', 'mo', 'ri'];
const SYL_C = ['x', 'n', 'th', 'la', 'ko', 'ry', 'm', 'ss', 'ble', 'wick', 'fin', 'tu', 'ra', 'zo', 'k', 'bit'];
export function randomName(rng: Rng): string {
  return pick(rng, SYL_A) + (rng() < 0.6 ? pick(rng, SYL_B) : '') + pick(rng, SYL_C);
}

/** Level at which each stage starts: [baby, teen, adult, ancient, legendary]. Rarer elements mature later. */
export function stageLevels(ph: Pheno): number[] {
  const tier = Math.max(ELEMENTS[ph.el1].tier, ph.el2 ? ELEMENTS[ph.el2].tier : 0);
  const delay = [0, 2, 5, 9][tier];
  const g = ph.growth;
  return [1, Math.round(20 - 5 * g + delay * 0.5), Math.round(37 - 7 * g + delay), Math.round(70 - 5 * g + delay), MAX_LEVEL];
}

export function stageOf(c: { g: Genome; level: number }): Stage {
  const lv = stageLevels(express(c.g));
  let s = 0;
  for (let i = 1; i < 5; i++) if (c.level >= lv[i]) s = i;
  return s as Stage;
}

export function xpToNext(level: number): number {
  return Math.round(40 + 14 * level + 0.9 * level * level);
}

const SKEL_MODS: Record<Skeleton, Record<StatKey, number>> = {
  biped: { hp: 1, atk: 1.03, def: 1, spd: 1 },
  quad: { hp: 1, atk: 1, def: 0.98, spd: 1.05 },
  multi: { hp: 0.97, atk: 1, def: 1.1, spd: 0.98 },
  serpent: { hp: 0.95, atk: 1.1, def: 0.97, spd: 1.01 },
  aquatic: { hp: 1.1, atk: 0.97, def: 1.02, spd: 0.97 },
  floater: { hp: 0.9, atk: 1.04, def: 0.95, spd: 1.08 },
};

export type Stats = Record<StatKey, number>;

/** Four stats only. The build gene trades speed and attack against health and defense. */
export function statsFor(g: Genome, level: number): Stats {
  const ph = express(g);
  const b = ph.build;
  const pot = (k: StatKey) => 0.75 + 0.05 * ph.pot[k];
  const sk = SKEL_MODS[ph.skel];
  // Body shape matters a little: a bulky frame is tougher but slower, a slender one quicker but frailer, and a
  // tall one reaches a bit harder but is also a touch slower.
  const gw = ph.girth ?? 0, ht = ph.height ?? 0;
  return {
    hp: Math.round((50 + 11 * level) * pot('hp') * sk.hp * (1 - 0.09 * b) * (1 + 0.06 * gw + 0.02 * ht)),
    atk: Math.round((14 + 3.1 * level) * pot('atk') * sk.atk * (1 + 0.05 * b) * (1 + 0.03 * ht)),
    def: Math.round((12 + 2.8 * level) * pot('def') * sk.def * (1 - 0.05 * b) * (1 + 0.04 * gw)),
    spd: Math.round((95 + 0.35 * level) * (0.9 + 0.02 * ph.pot.spd) * sk.spd * (1 + 0.06 * b) * (1 - 0.06 * gw - 0.02 * ht)),
  };
}

export function buildLabel(b: number): string {
  return b >= 1.5 ? 'Glass cannon' : b >= 0.5 ? 'Swift' : b <= -1.5 ? 'Tank' : b <= -0.5 ? 'Sturdy' : 'Balanced';
}

/** The rarity of each of the five stage slots, or null when the creature has no legendary slot. */
export function slotRarities(g: Genome): (number | null)[] {
  const ph = express(g);
  return [...ph.slots, ph.leg ? 3 : null];
}

/** Roll the move for a slot when it unlocks. Parents' moves weight the roll but never guarantee it. */
export function rollMove(rng: Rng, c: Creature, slot: number): string | null {
  const ph = express(c.g);
  const rar = slotRarities(c.g)[slot];
  if (rar == null) return null;
  const els: ElementId[] = ph.el2 ? [ph.el1, ph.el2] : [ph.el1];
  const known = new Set(c.moves.filter(Boolean) as string[]);
  const order = rar === 3 ? [3, 2, 1, 0] : [rar, rar - 1, rar - 2, rar + 1, rar + 2].filter(r => r >= 0 && r <= 2);
  for (const r of order) {
    let pool: MoveDef[] = els.flatMap(e => movePool(e, r)).filter(m => !known.has(m.id));
    // A baby's first move should be able to hurt something.
    if (slot === 0 && pool.some(m => m.pow)) pool = pool.filter(m => m.pow);
    if (pool.length) {
      const bias = c.g.bias[slot];
      return weighted(rng, pool, m => (bias[0] === m.id ? 4 : 0) + (bias[1] === m.id ? 4 : 0) + 1).id;
    }
  }
  return null;
}

/** Unlock any move slots the creature's stage now allows. Returns the newly learned moves. */
export function unlockMoves(rng: Rng, c: Creature, minStage = 0): MoveDef[] {
  const stage = Math.max(stageOf(c), minStage);
  const learned: MoveDef[] = [];
  for (let i = 0; i <= stage; i++) {
    if (c.moves[i] == null) {
      const id = rollMove(rng, c, i);
      if (id) { c.moves[i] = id; learned.push(MOVES[id]); }
    }
  }
  return learned;
}

export function movesOf(c: Creature): MoveDef[] {
  const ph = express(c.g);
  return [...(c.moves.filter(Boolean) as string[]).map(id => MOVES[id]).filter(Boolean), strikeFor(ph.el1)];
}

export interface XpResult { levels: number; newStage: Stage | null; learned: MoveDef[] }

export function addXp(rng: Rng, c: Creature, amount: number): XpResult {
  const before = stageOf(c);
  let levels = 0;
  c.xp += Math.max(0, Math.round(amount));
  while (c.level < MAX_LEVEL && c.xp >= xpToNext(c.level)) {
    c.xp -= xpToNext(c.level);
    c.level++;
    levels++;
  }
  if (c.level >= MAX_LEVEL) c.xp = 0;
  const after = stageOf(c);
  const learned = unlockMoves(rng, c);
  return { levels, newStage: after !== before ? after : null, learned };
}

export function pedNode(c: Creature): PedNode {
  const strip = (n?: PedNode): PedNode | undefined => (n ? { name: n.name, sex: n.sex, stars: n.stars, ph: n.ph } : undefined);
  return { name: c.name, sex: c.sex, stars: starRating(c.g), ph: express(c.g), m: strip(c.mom), f: strip(c.dad) };
}

export function hatch(rng: Rng, egg: Egg, level = 1): Creature {
  const c: Creature = {
    id: newId('c'), name: randomName(rng), g: egg.g, sex: rng() < 0.5 ? 'M' : 'F', level, xp: 0,
    moves: [null, null, null, null, null], bred: 0, breedReadyAt: 0, scanned: false,
    origin: egg.origin, mom: egg.mom, dad: egg.dad,
  };
  unlockMoves(rng, c);
  return c;
}

/** Build a creature straight from a genome, used for enemies and starters. */
export function makeCreature(rng: Rng, g: Genome, level: number, origin: Creature['origin'] = 'wild', minStage = 0): Creature {
  const c = hatch(rng, { id: '', g, origin, mutations: 0 }, level);
  if (minStage > 0) unlockMoves(rng, c, minStage);
  return c;
}

export function typeLabel(ph: Pheno): string {
  return ELEMENTS[ph.el1].name + (ph.el2 ? ' / ' + ELEMENTS[ph.el2].name : '');
}
