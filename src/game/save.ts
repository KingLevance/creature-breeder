// The saved game. Plain JSON so it can be stored as-is.
import type { Creature, Egg } from './creature';

export const SAVE_VERSION = 1;

export interface Incubator {
  tier: 1 | 2 | 3;
  egg: Egg | null;
  startedAt: number;
  readyAt: number;
}

/** Tutorial steps, in order. */
export const TUT = { PICK: 0, FIGHT: 1, INCUBATE: 2, RUN: 3, BREED: 4, HATCH2: 5, DONE: 6 } as const;

export interface Save {
  v: number;
  gold: number;
  essence: number;
  dust: number;
  shard: number;
  core: number;
  scans: number;
  creatures: Creature[];
  eggs: Egg[];
  incubators: Incubator[];
  rosterCap: number;
  /** Number of areas cleared in order: area N is open when cleared >= N. */
  cleared: number;
  clears: Record<string, number>;
  /** Boss chests opened without a rare egg, per area. Drives bad-luck protection. */
  pity: Record<string, number>;
  tutorial: number;
  tutorialPair: string[];
  team: string[];
  speedups: { day: string; n: number };
  arena: { rating: number; wins: number; losses: number };
  raid: { week: string; dmg: number; day: string; tries: number; claimed: number };
  tower: { best: number };
  counts: { hatched: number; bred: number; fights: number; released: number };
  auto: boolean;
  fast: boolean;
}

export function newSave(): Save {
  return {
    v: SAVE_VERSION, gold: 150, essence: 0, dust: 0, shard: 0, core: 0, scans: 0,
    creatures: [], eggs: [], incubators: [], rosterCap: 30, cleared: 0, clears: {}, pity: {},
    tutorial: TUT.PICK, tutorialPair: [], team: [], speedups: { day: '', n: 0 },
    arena: { rating: 100, wins: 0, losses: 0 }, raid: { week: '', dmg: 0, day: '', tries: 0, claimed: 0 },
    tower: { best: 0 }, counts: { hatched: 0, bred: 0, fights: 0, released: 0 }, auto: false, fast: false,
  };
}

export function migrate(raw: any): Save {
  const base = newSave();
  if (!raw || typeof raw !== 'object') return base;
  return { ...base, ...raw, arena: { ...base.arena, ...raw.arena }, raid: { ...base.raid, ...raw.raid }, tower: { ...base.tower, ...raw.tower }, counts: { ...base.counts, ...raw.counts }, speedups: { ...base.speedups, ...raw.speedups }, v: SAVE_VERSION };
}

export const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);
export function weekKey(now: number): string {
  return 'w' + Math.floor((now / 86400000 + 3) / 7);
}

export const byId = (s: Save, id: string) => s.creatures.find(c => c.id === id);
