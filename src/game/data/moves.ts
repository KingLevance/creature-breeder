// Every move in the game: 8 per element (3 Common, 2 Uncommon, 2 Rare, 1 Legendary) plus the built-in Strike.
// Pure data. Names and numbers are placeholders to tune.
import type { ElementId } from './elements';

export type Target = 'enemy' | 'enemies' | 'two' | 'ally' | 'allies' | 'self' | 'fallen' | 'allFallen';

export type StatusKind =
  | 'burn' | 'poison' | 'stun' | 'freeze' | 'slow' | 'haste' | 'atkUp' | 'atkDown' | 'defUp' | 'defDown'
  | 'evade' | 'dodge' | 'regen' | 'counter' | 'hidden' | 'link' | 'boost' | 'wound';

export interface Fx {
  k: StatusKind;
  /** Duration, counted in the affected creature's own actions. */
  t: number;
  /** Strength, usually a percentage. */
  v?: number;
  /** Chance to apply, 0..1. Defaults to 1. */
  ch?: number;
  /** Who gets it. Defaults to the move's targets. */
  on?: 'self' | 'allies' | 'enemies';
  el?: ElementId;
}

export interface MoveDef {
  id: string;
  name: string;
  el: ElementId;
  /** 0 Common, 1 Uncommon, 2 Rare, 3 Legendary. */
  rarity: 0 | 1 | 2 | 3;
  target: Target;
  /** Cooldown, counted in the user's own actions. */
  cd: number;
  desc: string;
  /** Damage as a percentage of Attack, per hit. */
  pow?: number;
  hits?: number;
  /** Healing and shields scale from Attack too. */
  heal?: number;
  shield?: number;
  teamHeal?: number;
  teamShield?: number;
  fx?: Fx[];
  /** Fraction of the turn gauge refunded after acting (fast moves). 1 means act again straight away. */
  quick?: number;
  /** Fraction of the target's Defense ignored. */
  pierce?: number;
  /** Percent of the user's max health lost. */
  recoil?: number;
  /** Fraction of damage dealt returned as healing. */
  drain?: number;
  cleanse?: boolean;
  /** Remove buffs: one buff, all buffs on the target, or all buffs on every enemy. */
  strip?: 'one' | 'target' | 'all';
  /** Revive at this fraction of max health. */
  revive?: number;
  bonusVs?: ElementId[];
  bonusFull?: boolean;
  /** Extra damage equal to this percent of the target's current health. */
  pctHp?: number;
  ignoreShield?: boolean;
  echo?: boolean;
  /** Usable once per fight. */
  once?: boolean;
  fullHeal?: boolean;
}

const C = 0, U = 1, R = 2, L = 3;
const list: MoveDef[] = [];
type Extra = Omit<MoveDef, 'id' | 'name' | 'el' | 'rarity' | 'target' | 'cd' | 'desc'>;

function m(el: ElementId, rarity: 0 | 1 | 2 | 3, name: string, target: Target, cd: number, desc: string, extra: Extra = {}) {
  const id = el + '_' + name.toLowerCase().replace(/[^a-z]+/g, '_');
  list.push({ id, name, el, rarity, target, cd, desc, ...extra });
}
const hit = (el: ElementId, r: 0 | 1 | 2 | 3, name: string, pow: number, cd: number, desc = 'A solid hit.', extra: Extra = {}) =>
  m(el, r, name, 'enemy', cd, desc, { pow, ...extra });
const fast = (el: ElementId, name: string) => m(el, C, name, 'enemy', 0, 'A weak hit that brings the next turn sooner.', { pow: 60, quick: 0.4 });

// ---- Ember
hit('ember', C, 'Cinder Lash', 100, 0);
hit('ember', C, 'Spark Burst', 80, 0, 'A hit with a chance to burn.', { fx: [{ k: 'burn', t: 2, v: 30, ch: 0.3 }] });
m('ember', C, 'Warm Glow', 'self', 2, 'A small speed boost.', { fx: [{ k: 'haste', t: 3, v: 20 }] });
hit('ember', U, 'Inferno Crash', 145, 2, 'A heavy fire hit.');
hit('ember', U, 'Scorch Trail', 70, 2, 'A hit that leaves a lasting burn.', { fx: [{ k: 'burn', t: 3, v: 40 }] });
m('ember', R, 'Kindle', 'allies', 3, "Boosts the team's Ember moves.", { fx: [{ k: 'boost', t: 3, v: 35, el: 'ember' }] });
hit('ember', R, 'Phoenix Dive', 210, 3, 'A big hit that hurts the user a little.', { recoil: 8 });
m('ember', L, 'Sunfall', 'enemies', 5, 'Huge fire damage to all enemies.', { pow: 170 });

// ---- Tide
hit('tide', C, 'Wave Strike', 100, 0);
m('tide', C, 'Bubble Guard', 'self', 2, 'A small shield.', { shield: 90 });
fast('tide', 'Splash Jab');
hit('tide', U, 'Riptide Slam', 145, 2, 'A heavy water hit.');
hit('tide', U, 'Undertow', 95, 2, 'A hit that slows the target.', { fx: [{ k: 'slow', t: 2, v: 30 }] });
m('tide', R, 'Soothing Spring', 'ally', 3, 'Heals an ally.', { heal: 200 });
m('tide', R, 'Tidal Surge', 'enemies', 3, 'A strong hit on all enemies.', { pow: 110 });
m('tide', L, 'Deluge', 'enemies', 5, 'Huge damage to all enemies and a small heal for the team.', { pow: 160, teamHeal: 70 });

// ---- Verdant
hit('verdant', C, 'Thorn Whip', 100, 0);
fast('verdant', 'Leaf Cut');
m('verdant', C, 'Sprout', 'ally', 2, 'A small heal.', { heal: 110 });
hit('verdant', U, 'Overgrowth', 145, 2, 'A heavy plant hit.');
hit('verdant', U, 'Binding Vines', 50, 2, 'Slows an enemy.', { fx: [{ k: 'slow', t: 3, v: 30 }] });
m('verdant', R, 'Bloom', 'ally', 3, 'Heals an ally over time.', { heal: 80, fx: [{ k: 'regen', t: 3, v: 70 }] });
hit('verdant', R, 'Heartwood Slam', 175, 3, 'A strong hit that raises own defense.', { fx: [{ k: 'defUp', t: 3, v: 30, on: 'self' }] });
m('verdant', L, 'Elder Canopy', 'allies', 5, 'A big heal and shield for the team.', { heal: 200, shield: 120 });

// ---- Spark
hit('spark', C, 'Static Snap', 100, 0);
fast('spark', 'Jolt');
hit('spark', C, 'Short Circuit', 75, 0, 'A hit with a small chance to stun.', { fx: [{ k: 'stun', t: 1, ch: 0.2 }] });
hit('spark', U, 'Thunder Crash', 145, 2, 'A heavy lightning hit.');
m('spark', U, 'Chain Arc', 'two', 2, 'Hits two enemies.', { pow: 95 });
m('spark', R, 'Charge Up', 'ally', 3, 'Speeds up an ally.', { fx: [{ k: 'haste', t: 3, v: 40 }] });
hit('spark', R, 'Storm Lance', 175, 3, 'A strong hit that ignores some defense.', { pierce: 0.5 });
m('spark', L, 'Tempest', 'enemies', 5, 'Hits all enemies and speeds up the team.', { pow: 140, fx: [{ k: 'haste', t: 3, v: 30, on: 'allies' }] });

// ---- Frost
hit('frost', C, 'Rime Spike', 100, 0);
hit('frost', C, 'Chill Touch', 75, 0, 'A hit that slows slightly.', { fx: [{ k: 'slow', t: 2, v: 15 }] });
m('frost', C, 'Snow Veil', 'self', 2, 'A small dodge boost.', { fx: [{ k: 'evade', t: 3, v: 25 }] });
hit('frost', U, 'Glacial Crush', 145, 2, 'A heavy ice hit.');
m('frost', U, 'Ice Wall', 'ally', 2, 'Shields an ally.', { shield: 150 });
hit('frost', R, 'Deep Freeze', 60, 3, 'Slows an enemy a lot.', { fx: [{ k: 'slow', t: 3, v: 50 }] });
m('frost', R, 'Blizzard', 'enemies', 3, 'Hits all enemies and slows them.', { pow: 100, fx: [{ k: 'slow', t: 2, v: 25 }] });
hit('frost', L, 'Absolute Zero', 260, 5, 'Huge damage, and freezes the target for two turns.', { fx: [{ k: 'freeze', t: 2 }] });

// ---- Brawn
hit('brawn', C, 'Hammer Fist', 100, 0);
hit('brawn', C, 'Low Sweep', 75, 0, 'A hit that slows the target.', { fx: [{ k: 'slow', t: 2, v: 20 }] });
m('brawn', C, 'Flex', 'self', 2, 'A small defense boost.', { fx: [{ k: 'defUp', t: 3, v: 25 }] });
hit('brawn', U, 'Titan Slam', 145, 2, 'A heavy blow.');
m('brawn', U, 'Counter Stance', 'self', 2, 'Returns damage from the next hit.', { fx: [{ k: 'counter', t: 3, v: 100 }] });
m('brawn', R, 'Battle Cry', 'allies', 3, "Boosts the team's attack.", { fx: [{ k: 'atkUp', t: 3, v: 30 }] });
hit('brawn', R, 'Rampage', 70, 3, 'Three strong hits.', { hits: 3 });
hit('brawn', L, "Champion's Fury", 300, 5, 'A massive hit that boosts own attack.', { fx: [{ k: 'atkUp', t: 3, v: 40, on: 'self' }] });

// ---- Venom
hit('venom', C, 'Viper Bite', 100, 0);
m('venom', C, 'Toxic Mist', 'enemies', 2, 'Weak poison on all enemies.', { fx: [{ k: 'poison', t: 2, v: 3 }] });
fast('venom', 'Needle Spit');
hit('venom', U, 'Blight Burst', 145, 2, 'A heavy hit that cuts healing received.', { fx: [{ k: 'wound', t: 2, v: 50 }] });
m('venom', U, 'Weaken', 'enemy', 2, 'Lowers enemy attack.', { fx: [{ k: 'atkDown', t: 3, v: 30 }] });
hit('venom', R, 'Corrode', 50, 3, 'Damage over time on an enemy.', { fx: [{ k: 'poison', t: 4, v: 6 }] });
m('venom', R, 'Plague Wave', 'enemies', 3, 'Poison on all enemies.', { pow: 40, fx: [{ k: 'poison', t: 3, v: 4 }] });
hit('venom', L, 'Lethal Dose', 120, 5, "Damage based on the target's health.", { pctHp: 25 });

// ---- Terra
hit('terra', C, 'Quake Stomp', 100, 0);
m('terra', C, 'Dust Cloud', 'enemy', 2, 'Slows an enemy.', { pow: 30, fx: [{ k: 'slow', t: 3, v: 25 }] });
m('terra', C, 'Burrow', 'self', 2, 'Dodges the next hit.', { fx: [{ k: 'dodge', t: 3 }] });
hit('terra', U, 'Earthen Crush', 145, 2, 'A heavy earth hit.');
hit('terra', U, 'Sinkhole', 95, 2, 'Damage and slows.', { fx: [{ k: 'slow', t: 2, v: 30 }] });
m('terra', R, 'Rampart', 'allies', 3, 'Shields the team.', { shield: 110 });
m('terra', R, 'Landslide', 'enemies', 3, 'Hits all enemies.', { pow: 115 });
m('terra', L, 'Cataclysm', 'enemies', 5, 'Heavy damage to all enemies.', { pow: 190 });

// ---- Gale
hit('gale', C, 'Wind Slash', 100, 0);
fast('gale', 'Gust');
m('gale', C, 'Feather Dance', 'enemy', 2, 'Lowers enemy attack slightly.', { pow: 30, fx: [{ k: 'atkDown', t: 3, v: 15 }] });
hit('gale', U, 'Cyclone Dive', 145, 2, 'A heavy diving hit.');
m('gale', U, 'Slipstream', 'ally', 2, 'Speeds up an ally.', { fx: [{ k: 'haste', t: 3, v: 30 }] });
m('gale', R, 'Updraft', 'ally', 3, 'An ally dodges the next hit.', { fx: [{ k: 'dodge', t: 4 }] });
hit('gale', R, 'Sky Rend', 170, 3, 'A strong hit that brings the next turn sooner.', { quick: 0.5 });
m('gale', L, 'Hurricane', 'enemies', 5, 'Hits all enemies and slows them.', { pow: 150, fx: [{ k: 'slow', t: 3, v: 30 }] });

// ---- Mind
hit('mind', C, 'Mind Lance', 100, 0);
m('mind', C, 'Focus', 'self', 2, 'Raises own attack.', { fx: [{ k: 'atkUp', t: 3, v: 25 }] });
hit('mind', C, 'Daze', 75, 0, 'A hit with a small chance to stun.', { fx: [{ k: 'stun', t: 1, ch: 0.2 }] });
hit('mind', U, 'Thought Crush', 145, 2, 'A heavy psychic hit.');
m('mind', U, 'Mind Link', 'ally', 2, 'Shares damage between the user and an ally.', { fx: [{ k: 'link', t: 3 }, { k: 'link', t: 3, on: 'self' }] });
m('mind', R, 'Clarity', 'ally', 3, "Clears an ally's debuffs.", { cleanse: true, heal: 60 });
hit('mind', R, 'Mind Storm', 160, 3, "A strong hit that lowers the target's attack.", { fx: [{ k: 'atkDown', t: 3, v: 30 }] });
hit('mind', L, 'Mind Shatter', 270, 5, "Huge damage, and clears the target's buffs.", { strip: 'target' });

// ---- Swarm
hit('swarm', C, 'Stinger Barrage', 52, 0, 'Two quick stings.', { hits: 2 });
fast('swarm', 'Pincer Nip');
m('swarm', C, 'Skitter', 'self', 2, 'A small speed boost.', { fx: [{ k: 'haste', t: 3, v: 20 }] });
hit('swarm', U, 'Locust Surge', 145, 2, 'A heavy swarming hit.');
m('swarm', U, 'Webbing', 'enemy', 2, 'Slows an enemy.', { pow: 40, fx: [{ k: 'slow', t: 3, v: 30 }] });
m('swarm', R, 'Hive Cloak', 'ally', 3, 'A decoy absorbs one hit.', { fx: [{ k: 'dodge', t: 4 }] });
hit('swarm', R, 'Swarm Assault', 42, 3, 'Several hits on one target.', { hits: 5 });
m('swarm', L, 'Plague of Wings', 'enemies', 5, 'Many weak hits on all enemies.', { pow: 55, hits: 3 });

// ---- Stone
hit('stone', C, 'Pebble Volley', 35, 0, 'Three small hits.', { hits: 3 });
hit('stone', C, 'Rubble Toss', 85, 0, 'A weak hit that comes back a little sooner.', { quick: 0.2 });
m('stone', C, 'Harden', 'self', 2, 'A small defense boost.', { fx: [{ k: 'defUp', t: 3, v: 25 }] });
hit('stone', U, 'Boulder Drop', 145, 2, 'A heavy rock hit.');
m('stone', U, 'Crumble', 'enemy', 2, 'Lowers enemy defense.', { pow: 40, fx: [{ k: 'defDown', t: 3, v: 30 }] });
m('stone', R, 'Stone Skin', 'ally', 3, 'A big defense boost for one ally.', { fx: [{ k: 'defUp', t: 3, v: 60 }] });
m('stone', R, 'Avalanche', 'enemies', 3, 'Hits all enemies.', { pow: 115 });
hit('stone', L, 'Meteor Fall', 280, 5, 'Huge damage to one enemy, and stuns it.', { fx: [{ k: 'stun', t: 1 }] });

// ---- Spirit
hit('spirit', C, 'Haunting Touch', 100, 0);
m('spirit', C, 'Chill Wail', 'enemy', 2, 'Lowers enemy attack slightly.', { pow: 30, fx: [{ k: 'atkDown', t: 3, v: 15 }] });
m('spirit', C, 'Fade', 'self', 2, 'A small dodge boost.', { fx: [{ k: 'evade', t: 3, v: 25 }] });
hit('spirit', U, 'Soul Rend', 145, 2, 'A heavy ghostly hit.');
hit('spirit', U, 'Drain Touch', 100, 2, 'Damage that heals the user.', { drain: 0.6 });
m('spirit', R, 'Revenant Call', 'fallen', 5, 'Revives a fallen ally.', { revive: 0.4 });
m('spirit', R, 'Wraith Pulse', 'enemies', 3, 'Hits all enemies and ignores shields.', { pow: 100, ignoreShield: true });
m('spirit', L, 'Second Life', 'allFallen', 8, 'Revives all fallen allies at low health.', { revive: 0.25 });

// ---- Wyrm
hit('wyrm', C, 'Drake Claw', 100, 0);
m('wyrm', C, 'Scale Guard', 'self', 2, 'A small defense boost.', { fx: [{ k: 'defUp', t: 3, v: 25 }] });
hit('wyrm', C, 'Tail Whip', 85, 0, 'A weak hit that comes back a little sooner.', { quick: 0.2 });
hit('wyrm', U, 'Wyrmfire Breath', 145, 2, 'A heavy breath attack.');
m('wyrm', U, 'Wing Buffet', 'enemies', 2, 'A weak hit on all enemies.', { pow: 55 });
m('wyrm', R, 'Ancient Roar', 'enemies', 3, 'Lowers enemy attack.', { fx: [{ k: 'atkDown', t: 3, v: 25 }] });
hit('wyrm', R, 'Crushing Fang', 170, 3, 'A strong hit that lowers enemy defense.', { fx: [{ k: 'defDown', t: 3, v: 30 }] });
m('wyrm', L, 'Draconic Ascension', 'self', 5, 'A big boost to own attack and speed for three turns.', { fx: [{ k: 'atkUp', t: 3, v: 60 }, { k: 'haste', t: 3, v: 40 }], quick: 0.5 });

// ---- Shade
hit('shade', C, 'Shadow Strike', 100, 0);
m('shade', C, 'Cloak', 'self', 2, 'A small dodge boost.', { fx: [{ k: 'evade', t: 3, v: 25 }] });
m('shade', C, 'Gloom', 'enemy', 2, 'Lowers enemy attack slightly.', { pow: 30, fx: [{ k: 'atkDown', t: 3, v: 15 }] });
hit('shade', U, 'Night Ambush', 145, 2, 'A heavy hit from the dark.');
m('shade', U, 'Shadow Step', 'self', 3, 'Acts again straight away, with a small dodge boost.', { quick: 1, fx: [{ k: 'evade', t: 2, v: 20 }] });
m('shade', R, 'Dusk Veil', 'ally', 3, 'Hides an ally so enemies target someone else.', { fx: [{ k: 'hidden', t: 2 }] });
hit('shade', R, 'Eclipse Slash', 160, 3, 'A strong hit with bonus damage to a full-health target.', { bonusFull: true });
m('shade', L, 'Midnight', 'enemies', 5, 'Heavy damage to all enemies, lowering their attack and speed.', { pow: 150, fx: [{ k: 'atkDown', t: 3, v: 25 }, { k: 'slow', t: 3, v: 25 }] });

// ---- Forge
hit('forge', C, 'Iron Jab', 100, 0);
m('forge', C, 'Sharpen', 'self', 2, 'Raises own attack.', { fx: [{ k: 'atkUp', t: 3, v: 25 }] });
m('forge', C, 'Plate Up', 'self', 2, 'A small defense boost.', { fx: [{ k: 'defUp', t: 3, v: 25 }] });
hit('forge', U, 'Anvil Crash', 145, 2, 'A heavy metal hit.');
hit('forge', U, 'Heated Edge', 100, 2, 'Damage that lowers enemy defense.', { fx: [{ k: 'defDown', t: 3, v: 25 }] });
m('forge', R, 'Temper', 'ally', 3, 'A small attack and defense boost for an ally.', { fx: [{ k: 'atkUp', t: 3, v: 25 }, { k: 'defUp', t: 3, v: 25 }] });
hit('forge', R, 'Hammer Barrage', 65, 3, 'Several strong hits.', { hits: 3 });
m('forge', L, 'Masterwork', 'allies', 5, 'A big attack and defense boost for the team.', { fx: [{ k: 'atkUp', t: 3, v: 45 }, { k: 'defUp', t: 3, v: 45 }] });

// ---- Glimmer
hit('glimmer', C, 'Prism Bolt', 100, 0);
m('glimmer', C, 'Twinkle', 'ally', 2, 'A small heal.', { heal: 110 });
m('glimmer', C, 'Glitter Cloud', 'enemy', 2, 'Lowers enemy attack slightly.', { pow: 30, fx: [{ k: 'atkDown', t: 3, v: 15 }] });
hit('glimmer', U, 'Starlight Burst', 145, 2, 'A heavy burst of light.');
hit('glimmer', U, 'Dazzle', 75, 2, 'A hit with a chance to stun.', { fx: [{ k: 'stun', t: 1, ch: 0.35 }] });
m('glimmer', R, 'Mending Light', 'allies', 3, 'Heals the team a little.', { heal: 90 });
hit('glimmer', R, 'Moonbeam', 150, 3, 'A strong hit that heals the team a little.', { teamHeal: 50 });
m('glimmer', L, 'Wishing Star', 'allies', 5, 'Fully heals the team, once per fight.', { fullHeal: true, once: true });

// ---- Plain
hit('plain', C, 'Quick Strike', 100, 0);
hit('plain', C, 'Scuffle', 85, 0, 'A weak hit that comes back a little sooner.', { quick: 0.2 });
m('plain', C, 'Brace', 'self', 2, 'A small defense boost.', { fx: [{ k: 'defUp', t: 3, v: 25 }] });
hit('plain', U, 'Power Slam', 145, 2, 'A heavy hit.');
m('plain', U, 'Second Wind', 'self', 2, 'A small heal.', { heal: 130 });
m('plain', R, 'Rally', 'allies', 3, 'A small boost for the team.', { fx: [{ k: 'atkUp', t: 3, v: 15 }, { k: 'haste', t: 3, v: 15 }] });
hit('plain', R, 'Overpower', 205, 3, 'A strong hit that hurts the user a little.', { recoil: 8 });
hit('plain', L, 'Echo Strike', 160, 4, "Repeats the last move an ally used. If there is none, it's a strong hit.", { echo: true });

// ---- Radiant
hit('radiant', C, 'Dawn Ray', 100, 0);
m('radiant', C, 'Glow', 'ally', 2, 'A small heal.', { heal: 110 });
m('radiant', C, 'Shine', 'enemy', 2, 'Lowers enemy attack slightly.', { pow: 30, fx: [{ k: 'atkDown', t: 3, v: 15 }] });
hit('radiant', U, 'Solar Burst', 145, 2, 'A heavy burst of light.');
m('radiant', U, 'Beacon', 'ally', 2, "Raises an ally's attack.", { fx: [{ k: 'atkUp', t: 3, v: 30 }] });
m('radiant', R, 'Blessing', 'ally', 3, 'Heals an ally and clears debuffs.', { heal: 160, cleanse: true });
hit('radiant', R, 'Judgment Beam', 160, 3, 'A strong hit with extra damage to Shade and Void.', { bonusVs: ['shade', 'void'] });
m('radiant', L, 'Daybreak', 'enemies', 5, 'Heals the team and clears its debuffs, and damages all enemies.', { pow: 110, teamHeal: 120, cleanse: true });

// ---- Void
hit('void', C, 'Rift Slash', 100, 0);
m('void', C, 'Hollow', 'enemy', 2, 'Lowers enemy defense.', { pow: 30, fx: [{ k: 'defDown', t: 3, v: 20 }] });
m('void', C, 'Dim', 'enemy', 2, 'Slows an enemy.', { pow: 30, fx: [{ k: 'slow', t: 3, v: 25 }] });
hit('void', U, 'Collapse', 145, 2, 'A heavy crushing hit.');
m('void', U, 'Gravity Well', 'enemies', 2, 'Slows all enemies.', { fx: [{ k: 'slow', t: 2, v: 25 }] });
hit('void', R, 'Unravel', 60, 3, "Strips an enemy's boosts.", { strip: 'target' });
hit('void', R, 'Null Pulse', 160, 3, 'A strong hit that removes a buff.', { strip: 'one' });
hit('void', L, 'Oblivion', 230, 5, 'Huge damage, and strips all enemy boosts.', { strip: 'all' });

/** Moves where the user runs up and strikes in person. Every other single-target attack is a projectile or beam. */
const MELEE = new Set([
  'Cinder Lash', 'Inferno Crash', 'Phoenix Dive', 'Riptide Slam', 'Splash Jab', 'Thorn Whip', 'Heartwood Slam', 'Static Snap',
  'Thunder Crash', 'Glacial Crush', 'Chill Touch', 'Hammer Fist', 'Low Sweep', 'Titan Slam', 'Rampage', "Champion's Fury",
  'Viper Bite', 'Quake Stomp', 'Earthen Crush', 'Cyclone Dive', 'Sky Rend', 'Pincer Nip', 'Locust Surge', 'Swarm Assault',
  'Haunting Touch', 'Drain Touch', 'Soul Rend', 'Drake Claw', 'Tail Whip', 'Crushing Fang', 'Shadow Strike', 'Night Ambush',
  'Eclipse Slash', 'Iron Jab', 'Anvil Crash', 'Heated Edge', 'Hammer Barrage', 'Quick Strike', 'Scuffle', 'Power Slam',
  'Overpower', 'Echo Strike', 'Rift Slash', 'Strike',
]);

export type MoveStyle = 'melee' | 'ranged' | 'area' | 'support';
/** How a move looks when used. Presentation only: it changes nothing in the rules. */
export function moveStyle(mv: MoveDef): MoveStyle {
  if (mv.target === 'enemies') return 'area';
  if (mv.target === 'enemy' && MELEE.has(mv.name)) return 'melee';
  if (mv.target === 'enemy' || mv.target === 'two') return 'ranged';
  return 'support';
}

/** How a move is acted out. Presentation only: picked from the move's name and element so every move has a look. */
export type Flair =
  // melee
  | 'lunge' | 'pounce' | 'slam' | 'slash' | 'bite' | 'flurry' | 'roll' | 'dash' | 'touch'
  // ranged
  | 'proj' | 'volley' | 'beam' | 'bolt' | 'erupt' | 'wave' | 'breath'
  // area
  | 'nova' | 'rain' | 'quake' | 'sweep' | 'storm'
  | 'buff';

const RANGED: Record<ElementId, Flair[]> = {
  ember: ['proj', 'breath', 'erupt'], tide: ['proj', 'wave', 'beam'], verdant: ['volley', 'erupt'], spark: ['beam', 'bolt'],
  frost: ['volley', 'erupt', 'breath'], brawn: ['wave', 'proj'], venom: ['proj', 'volley'], terra: ['proj', 'erupt', 'wave'],
  gale: ['wave', 'volley'], mind: ['proj', 'beam'], swarm: ['volley'], stone: ['proj', 'erupt'], spirit: ['proj', 'volley'],
  wyrm: ['breath', 'proj'], shade: ['proj', 'erupt'], forge: ['volley', 'proj'], glimmer: ['volley', 'beam'], plain: ['proj', 'wave'],
  radiant: ['beam', 'bolt'], void: ['proj', 'erupt'],
};
const AREA: Partial<Record<ElementId, Flair>> = {
  ember: 'rain', frost: 'rain', glimmer: 'rain', radiant: 'rain', void: 'rain',
  terra: 'quake', stone: 'quake', brawn: 'quake', forge: 'quake', plain: 'quake',
  tide: 'sweep', gale: 'sweep', swarm: 'sweep', venom: 'sweep', wyrm: 'sweep', spark: 'storm',
};
const nameHash = (s: string) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

export function moveFlair(mv: MoveDef): Flair {
  const style = moveStyle(mv), n = mv.name;
  if (style === 'support') return 'buff';
  if (style === 'area') return AREA[mv.el] ?? 'nova';
  if (style === 'melee') {
    if (/Bite|Fang|Nip|Snap/.test(n)) return 'bite';
    if (/Dive|Ambush/.test(n)) return 'pounce';
    if (/Slam|Crash|Crush|Stomp/.test(n)) return 'slam';
    if (/Barrage|Rampage|Surge|Assault|Fury|Scuffle/.test(n) || (mv.hits ?? 1) > 1) return 'flurry';
    if (/Sweep|Whip|Overpower/.test(n)) return 'roll';
    if (/Shadow|Rift|Eclipse|Quick|Echo|Sky Rend/.test(n)) return 'dash';
    if (/Slash|Rend|Claw|Lash|Edge/.test(n)) return 'slash';
    if (/Touch/.test(n)) return 'touch';
    return 'lunge';
  }
  const opts = RANGED[mv.el];
  if ((mv.hits ?? 1) > 1 && opts.includes('volley')) return 'volley';
  // The showiest look goes to the rarest moves.
  if (mv.rarity >= 2 && opts.length > 1) return opts[opts.length - 1 - (nameHash(n) % 2)];
  return opts[nameHash(n) % opts.length];
}

/** What a support move does at heart, so each kind can be acted out its own way. Presentation only. */
export type SupportKind = 'heal' | 'shield' | 'revive' | 'cleanse' | 'rally' | 'guard' | 'swift' | 'ward';
export function supportKind(mv: MoveDef): SupportKind {
  if (mv.revive) return 'revive';
  if (mv.heal || mv.teamHeal || mv.fullHeal) return 'heal';
  if (mv.shield || mv.teamShield) return 'shield';
  const k = mv.fx?.find(x => x.on !== 'enemies')?.k;
  if (k === 'atkUp' || k === 'boost') return 'rally';
  if (k === 'defUp' || k === 'counter') return 'guard';
  if (k === 'haste' || k === 'evade' || k === 'dodge' || k === 'hidden') return 'swift';
  if (k === 'regen') return 'heal';
  if (mv.cleanse) return 'cleanse';
  return 'ward';
}

export const MOVE_LIST: MoveDef[] = list;
export const MOVES: Record<string, MoveDef> = Object.fromEntries(list.map(x => [x.id, x]));

/** Every creature can always Strike, so no one is ever stuck on cooldowns. Its element is the user's primary. */
export const STRIKE_ID = 'strike';
export function strikeFor(el: ElementId): MoveDef {
  return { id: STRIKE_ID, name: 'Strike', el, rarity: 0, target: 'enemy', cd: 0, pow: 65, desc: 'A basic hit. Always available.' };
}

export function movePool(el: ElementId, rarity: number): MoveDef[] {
  return list.filter(x => x.el === el && x.rarity === rarity);
}

export const RARITY_NAMES = ['Common', 'Uncommon', 'Rare', 'Legendary'];
export const RARITY_COLORS = ['#9aa3ad', '#4caf50', '#3b82f6', '#f5a623'];
