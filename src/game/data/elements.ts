// The 20 elements, their colours and the matchup chart. Pure data: tune here, no code changes needed.

export type ElementId =
  | 'ember' | 'tide' | 'verdant' | 'spark' | 'frost' | 'brawn' | 'venom' | 'terra' | 'gale' | 'mind'
  | 'swarm' | 'stone' | 'spirit' | 'wyrm' | 'shade' | 'forge' | 'glimmer' | 'plain' | 'radiant' | 'void';

export interface ElementDef {
  id: ElementId;
  name: string;
  theme: string;
  base: string;
  light: string;
  dark: string;
  glow: string;
  /** 0 common, 1 uncommon, 2 rare, 3 very rare. Rarer elements are recessive and mature later. */
  tier: 0 | 1 | 2 | 3;
}

const E = (id: ElementId, name: string, theme: string, base: string, light: string, dark: string, glow: string, tier: 0 | 1 | 2 | 3): ElementDef =>
  ({ id, name, theme, base, light, dark, glow, tier });

/** Listed from most dominant to most recessive: when a creature carries two different element alleles, the earlier one shows. */
export const ELEMENT_LIST: ElementDef[] = [
  E('plain', 'Plain', 'Normal', '#C9B59A', '#EDE0CC', '#8A7860', '#FFFFFF', 0),
  E('terra', 'Terra', 'Earth', '#B07A46', '#DDB688', '#6B4423', '#F3D9A6', 0),
  E('stone', 'Stone', 'Rock', '#8D8778', '#C2BCAB', '#524E44', '#E8E2D0', 0),
  E('tide', 'Tide', 'Water', '#2E86C1', '#7FD1E8', '#174A75', '#A8F0FF', 0),
  E('verdant', 'Verdant', 'Plants', '#4CAF50', '#A5D66B', '#23632A', '#D9F99D', 0),
  E('ember', 'Ember', 'Fire', '#E4572E', '#FFB347', '#8C2A12', '#FFD166', 0),
  E('gale', 'Gale', 'Wind', '#7FC8D6', '#D8F3F0', '#3E7F8E', '#FFFFFF', 0),
  E('swarm', 'Swarm', 'Insects', '#9BB034', '#D5E27A', '#55641A', '#F4F7B0', 0),
  E('brawn', 'Brawn', 'Fighting', '#C0563B', '#E8A07E', '#6E2A1A', '#FFD9B8', 0),
  E('frost', 'Frost', 'Ice', '#8FD3F4', '#E3F6FF', '#4A8DB0', '#FFFFFF', 1),
  E('spark', 'Spark', 'Lightning', '#F2C230', '#FFF07A', '#9A7410', '#FFFFFF', 1),
  E('venom', 'Venom', 'Poison', '#8E44AD', '#C79BE0', '#4A1F60', '#B6F25A', 1),
  E('forge', 'Forge', 'Steel', '#9AA7B4', '#D4DDE5', '#55616D', '#FF9F45', 1),
  E('mind', 'Mind', 'Psychic', '#E26BB5', '#F7B6DD', '#8A2F6A', '#FFE3F4', 1),
  E('shade', 'Shade', 'Darkness', '#4A4458', '#7C748F', '#1F1B29', '#C26BFF', 1),
  E('spirit', 'Spirit', 'Ghost', '#7E7BC9', '#C9C7F2', '#403D85', '#E9E8FF', 1),
  E('glimmer', 'Glimmer', 'Fairy', '#F4A6C8', '#FFE0EE', '#B55F86', '#FFF6A3', 1),
  E('wyrm', 'Wyrm', 'Dragon', '#5B55C7', '#9E9AF0', '#2B2780', '#FFD166', 2),
  E('radiant', 'Radiant', 'Light', '#F7E08A', '#FFFBE0', '#C79A2C', '#FFFFFF', 3),
  E('void', 'Void', 'Void', '#2A1F4E', '#5B4A9C', '#100A24', '#B9A6FF', 3),
];

export const ELEMENTS = Object.fromEntries(ELEMENT_LIST.map(e => [e.id, e])) as Record<ElementId, ElementDef>;
export const ELEMENT_IDS = ELEMENT_LIST.map(e => e.id);

/** Attacker row: [hits hard 2x, hits weakly 0.5x, no effect 0x]. Everything unlisted is 1x. */
const CHART: Record<ElementId, [string, string, string]> = {
  ember: ['verdant frost swarm forge', 'ember tide stone wyrm', ''],
  tide: ['ember terra stone', 'tide verdant wyrm', ''],
  spark: ['tide gale', 'spark verdant wyrm', 'terra'],
  verdant: ['tide terra stone', 'ember verdant venom gale swarm wyrm forge', ''],
  frost: ['verdant terra gale wyrm', 'ember tide frost forge', ''],
  brawn: ['plain frost stone shade forge', 'venom gale mind swarm glimmer', 'spirit'],
  venom: ['verdant glimmer', 'venom terra stone spirit', 'forge'],
  terra: ['ember spark venom stone forge', 'verdant swarm', 'gale'],
  gale: ['verdant brawn swarm', 'spark stone forge', ''],
  mind: ['brawn venom', 'mind forge', 'shade'],
  swarm: ['verdant mind shade', 'ember brawn venom gale spirit forge glimmer', ''],
  stone: ['ember frost gale swarm', 'brawn terra forge', ''],
  spirit: ['mind spirit', 'shade', 'plain'],
  wyrm: ['wyrm', 'forge', 'glimmer'],
  shade: ['mind spirit radiant', 'brawn shade glimmer', ''],
  forge: ['frost stone glimmer', 'ember tide spark forge', ''],
  glimmer: ['brawn wyrm shade', 'ember venom forge', ''],
  plain: ['', 'stone forge', 'spirit'],
  radiant: ['shade spirit void', 'radiant forge terra', ''],
  void: ['radiant mind glimmer', 'void forge brawn', ''],
};

const table: Record<string, number> = {};
for (const atk of ELEMENT_IDS) {
  const [hard, weak, none] = CHART[atk];
  for (const d of hard.split(' ').filter(Boolean)) table[atk + '>' + d] = 2;
  for (const d of weak.split(' ').filter(Boolean)) table[atk + '>' + d] = 0.5;
  for (const d of none.split(' ').filter(Boolean)) table[atk + '>' + d] = 0;
}

/** Damage multiplier of an attacking element against a defender with one or two elements (dual types multiply). */
export function matchup(atk: ElementId, def1: ElementId, def2?: ElementId | null): number {
  const a = table[atk + '>' + def1] ?? 1;
  const b = def2 && def2 !== def1 ? (table[atk + '>' + def2] ?? 1) : 1;
  return a * b;
}

export function elementRank(id: ElementId): number {
  return ELEMENT_IDS.indexOf(id);
}
