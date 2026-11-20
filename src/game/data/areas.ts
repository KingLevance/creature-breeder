// Campaign areas. Each is a run of fights ending in a boss and a chest. Pure data.
import type { ElementId } from './elements';
import type { Skeleton } from '../genome';

export interface AreaDef {
  id: number;
  name: string;
  blurb: string;
  els: ElementId[];
  lo: number;
  hi: number;
  /** Enemy count in each normal fight. The boss fight comes after these. */
  team: number[];
  bossMinions: number;
  boss: { name: string; el: ElementId; el2?: ElementId; skel: Skeleton };
  /** 0..1: how good dropped eggs tend to be. */
  quality: number;
  /** Chance an enemy secretly carries a rare element (Wyrm, Radiant, Void). */
  rareCarrier: number;
  sky: [string, string];
  ground: string;
}

const A = (
  id: number, name: string, blurb: string, els: ElementId[], lo: number, hi: number, team: number[], bossMinions: number,
  boss: AreaDef['boss'], quality: number, rareCarrier: number, sky: [string, string], ground: string,
): AreaDef => ({ id, name, blurb, els, lo, hi, team, bossMinions, boss, quality, rareCarrier, sky, ground });

export const AREAS: AreaDef[] = [
  A(0, 'Mosswake Meadow', 'Soft grass and curious hatchlings.', ['verdant', 'plain', 'swarm'], 1, 3, [1, 1, 2], 1, { name: 'Old Bramble', el: 'verdant', skel: 'quad' }, 0.05, 0.02, ['#bfe8ff', '#eaf9d8'], '#7cc36a'),
  A(1, 'Pebble Run', 'A dry riverbed full of hard heads.', ['terra', 'stone', 'plain'], 5, 9, [2, 3, 3], 2, { name: 'Gravelmaw', el: 'stone', skel: 'multi' }, 0.1, 0.02, ['#f6dfb8', '#fbf1dc'], '#b99668'),
  A(2, 'Tidepool Shallows', 'Warm pools, quick fins.', ['tide', 'verdant', 'plain'], 9, 14, [3, 3, 4], 2, { name: 'Brinemother', el: 'tide', skel: 'aquatic' }, 0.15, 0.03, ['#9fd8f5', '#dff6ff'], '#5fb0c9'),
  A(3, 'Cinder Flats', 'The ground still smokes here.', ['ember', 'terra', 'stone'], 14, 19, [3, 4, 4], 3, { name: 'Ashback', el: 'ember', el2: 'terra', skel: 'quad' }, 0.2, 0.03, ['#ffb27a', '#ffe1c2'], '#8f5a3c'),
  A(4, 'Gusty Ridge', 'Hold on to something.', ['gale', 'swarm', 'plain'], 19, 24, [4, 4, 5], 3, { name: 'Skyreaver', el: 'gale', skel: 'biped' }, 0.25, 0.04, ['#a9d9f2', '#f2fbff'], '#9bb58a'),
  A(5, "Brawler's Pit", 'Everything here wants a fight.', ['brawn', 'stone', 'terra'], 24, 29, [4, 5, 5], 4, { name: 'Knuckles the Unmoved', el: 'brawn', el2: 'stone', skel: 'biped' }, 0.3, 0.04, ['#e9b79a', '#f8e4d6'], '#9a6b53'),
  A(6, 'Frostfen', 'A marsh that froze mid-ripple.', ['frost', 'tide', 'gale'], 29, 34, [4, 5, 5, 5], 4, { name: 'Rimeglass', el: 'frost', skel: 'serpent' }, 0.34, 0.05, ['#cfeeff', '#f5fcff'], '#bfe3ee'),
  A(7, 'Stormwire Peaks', 'The air hums before it bites.', ['spark', 'gale', 'stone'], 34, 39, [5, 5, 5, 5], 4, { name: 'Voltwing', el: 'spark', el2: 'gale', skel: 'floater' }, 0.38, 0.05, ['#6f7fb3', '#c9d2ee'], '#6c6f86'),
  A(8, 'Mirebloom Swamp', 'Pretty flowers. Do not sniff.', ['venom', 'verdant', 'swarm'], 39, 44, [5, 5, 5, 5], 4, { name: 'Queen Nettle', el: 'venom', el2: 'verdant', skel: 'multi' }, 0.42, 0.06, ['#a7c98f', '#e0efcf'], '#56704a'),
  A(9, 'Ironroot Foundry', 'Old machines, older tempers.', ['forge', 'ember', 'brawn'], 44, 49, [5, 5, 5, 5], 4, { name: 'The Anvil', el: 'forge', el2: 'ember', skel: 'quad' }, 0.46, 0.06, ['#b7a59a', '#ecdcd0'], '#6b5d57'),
  A(10, 'Dreaming Spires', 'Thoughts drift loose up here.', ['mind', 'glimmer', 'gale'], 49, 54, [5, 5, 5, 5], 4, { name: 'Oracle Moth', el: 'mind', el2: 'glimmer', skel: 'floater' }, 0.5, 0.07, ['#e8b8e0', '#fbeaf8'], '#b58fc0'),
  A(11, 'Gloamwood', 'The trees lean in to listen.', ['shade', 'spirit', 'verdant'], 54, 60, [5, 5, 5, 5], 4, { name: 'Lanternjaw', el: 'shade', el2: 'spirit', skel: 'serpent' }, 0.54, 0.08, ['#4b4668', '#8d86b0'], '#35304a'),
  A(12, 'Hollow Barrow', 'Something here remembers you.', ['spirit', 'venom', 'stone'], 60, 65, [5, 5, 5, 5], 4, { name: 'The Unburied', el: 'spirit', skel: 'biped' }, 0.58, 0.09, ['#6d6aa3', '#b9b6de'], '#4a4770'),
  A(13, 'Faelight Glade', 'Every leaf glitters.', ['glimmer', 'verdant', 'mind'], 65, 70, [5, 5, 5, 5], 4, { name: 'Lady Dewlight', el: 'glimmer', el2: 'radiant', skel: 'floater' }, 0.62, 0.12, ['#ffd3ea', '#fff5d6'], '#e3a9c9'),
  A(14, 'Wyrmscale Cliffs', 'Nests the size of houses.', ['wyrm', 'ember', 'gale'], 70, 76, [5, 5, 5, 5, 5], 4, { name: 'Vaultclaw', el: 'wyrm', el2: 'ember', skel: 'quad' }, 0.66, 0.14, ['#8a87d9', '#d7d5fb'], '#5d5aa0'),
  A(15, 'Starfall Crater', 'The sky left something behind.', ['stone', 'mind', 'shade', 'void'], 76, 81, [5, 5, 5, 5, 5], 4, { name: 'Craterheart', el: 'void', el2: 'stone', skel: 'multi' }, 0.7, 0.18, ['#2a2350', '#6a5fae'], '#231c40'),
  A(16, 'Sunspire', 'Bright enough to hurt.', ['radiant', 'forge', 'glimmer'], 81, 86, [5, 5, 5, 5, 5], 4, { name: 'Halcyon', el: 'radiant', el2: 'forge', skel: 'biped' }, 0.75, 0.2, ['#ffe9a8', '#fffbe6'], '#e0bf63'),
  A(17, 'The Rift', 'The edge of the map, and then some.', ['void', 'shade', 'spirit'], 86, 91, [5, 5, 5, 5, 5], 4, { name: 'Nullmaw', el: 'void', el2: 'shade', skel: 'serpent' }, 0.8, 0.24, ['#120c2a', '#43347e'], '#150f2c'),
  A(18, 'Elder Nest', 'The oldest things still breathing.', ['wyrm', 'radiant', 'void'], 91, 96, [5, 5, 5, 5, 5], 4, { name: 'First Wyrm', el: 'wyrm', el2: 'radiant', skel: 'serpent' }, 0.86, 0.3, ['#51407e', '#f3d98c'], '#3d315f'),
  A(19, 'Worldroot', 'Where every bloodline began.', ['plain', 'ember', 'tide', 'verdant', 'spark', 'frost', 'brawn', 'venom', 'terra', 'gale', 'mind', 'swarm', 'stone', 'spirit', 'wyrm', 'shade', 'forge', 'glimmer', 'radiant', 'void'], 96, 100, [5, 5, 5, 5, 5], 4, { name: 'The Rootmother', el: 'verdant', el2: 'void', skel: 'floater' }, 0.92, 0.35, ['#1d3b2a', '#a8e6b0'], '#173022'),
];
