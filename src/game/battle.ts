// Turn-based team fights. Speed fills a gauge; whoever fills it first acts, so a fast creature can act twice
// before a slow one acts once. One move per action, cooldowns and status effects count a creature's own actions.
import { ElementId, matchup } from './data/elements';
import { Flair, Fx, MOVES, MoveDef, MoveStyle, StatusKind, STRIKE_ID, SupportKind, moveFlair, moveStyle, supportKind } from './data/moves';
import { Creature, Stats, movesOf, stageOf, statsFor } from './creature';
import { Genome, Pheno, Rng, clamp, express } from './genome';

export interface Status { k: StatusKind; t: number; v: number; src: number; el?: ElementId; atk: number }

export interface Unit {
  uid: number;
  side: 0 | 1;
  slot: number;
  cid: string | null;
  name: string;
  g: Genome;
  ph: Pheno;
  level: number;
  stage: number;
  max: Stats;
  hp: number;
  shield: number;
  gauge: number;
  statuses: Status[];
  cds: Record<string, number>;
  used: string[];
  moves: MoveDef[];
  alive: boolean;
  boss: boolean;
  stunGuard: number;
  chain: number;
  contrib: { dmg: number; heal: number; absorb: number; buff: number; revive: number };
}

export type Ev =
  | { t: 'move'; u: number; name: string; el: ElementId; targets: number[]; style: MoveStyle; heal: boolean; flair: Flair; rarity: number; /** For support moves: what kind, so it can be acted out. */ support?: SupportKind }
  | { t: 'dmg'; u: number; from: number; n: number; mult: number; shield: number }
  | { t: 'miss'; u: number }
  | { t: 'heal'; u: number; n: number }
  | { t: 'shield'; u: number; n: number }
  | { t: 'status'; u: number; k: StatusKind; on: boolean }
  | { t: 'tick'; u: number; k: StatusKind; n: number }
  | { t: 'skip'; u: number; k: StatusKind }
  | { t: 'faint'; u: number }
  | { t: 'revive'; u: number; n: number }
  | { t: 'text'; u: number; s: string };

export interface Battle {
  units: Unit[];
  rng: Rng;
  over: 0 | 1 | null;
  lastMove: [MoveDef | null, MoveDef | null];
  actions: [number, number];
}

const GAUGE = 1000;
const BUFFS: StatusKind[] = ['haste', 'atkUp', 'defUp', 'evade', 'dodge', 'regen', 'counter', 'hidden', 'link', 'boost'];
export const isBuff = (k: StatusKind) => BUFFS.includes(k);
const DEFAULT_V: Partial<Record<StatusKind, number>> = { burn: 30, poison: 5, slow: 30, haste: 30, atkUp: 30, atkDown: 30, defUp: 30, defDown: 30, evade: 25, regen: 60, counter: 100, wound: 50 };

export interface UnitMods { hpMul?: number; atkMul?: number; defMul?: number; boss?: boolean; stage?: number; hpFrac?: number }

export function makeUnit(c: Creature, side: 0 | 1, slot: number, mods: UnitMods = {}): Omit<Unit, 'uid'> {
  const s = statsFor(c.g, c.level);
  const max: Stats = {
    hp: Math.round(s.hp * (mods.hpMul ?? 1)), atk: Math.round(s.atk * (mods.atkMul ?? 1)),
    def: Math.round(s.def * (mods.defMul ?? 1)), spd: s.spd,
  };
  return {
    side, slot, cid: side === 0 ? c.id : null, name: c.name, g: c.g, ph: express(c.g), level: c.level, stage: Math.max(stageOf(c), mods.stage ?? 0),
    max, hp: Math.max(1, Math.round(max.hp * (mods.hpFrac ?? 1))), shield: 0, gauge: 0, statuses: [], cds: {}, used: [], moves: movesOf(c), alive: true,
    boss: !!mods.boss, stunGuard: 0, chain: 0, contrib: { dmg: 0, heal: 0, absorb: 0, buff: 0, revive: 0 },
  };
}

export function createBattle(rng: Rng, a: Omit<Unit, 'uid'>[], b: Omit<Unit, 'uid'>[]): Battle {
  const units = [...a, ...b].map((u, i) => ({ ...u, uid: i, gauge: rng() * 120 }));
  return { units, rng, over: null, lastMove: [null, null], actions: [0, 0] };
}

const has = (u: Unit, k: StatusKind) => u.statuses.find(s => s.k === k);
const pct = (u: Unit, up: StatusKind, down: StatusKind) => 1 + ((has(u, up)?.v ?? 0) - (has(u, down)?.v ?? 0)) / 100;
export const effAtk = (u: Unit) => u.max.atk * pct(u, 'atkUp', 'atkDown');
export const effDef = (u: Unit) => u.max.def * pct(u, 'defUp', 'defDown');
export const effSpd = (u: Unit) => Math.max(20, u.max.spd * pct(u, 'haste', 'slow'));

const allies = (b: Battle, u: Unit, alive = true) => b.units.filter(x => x.side === u.side && x.alive === alive);
const enemies = (b: Battle, u: Unit) => b.units.filter(x => x.side !== u.side && x.alive);

function checkOver(b: Battle) {
  const a0 = b.units.some(u => u.side === 0 && u.alive);
  const a1 = b.units.some(u => u.side === 1 && u.alive);
  if (!a0) b.over = 1; else if (!a1) b.over = 0;
}

/** Who acts next, in order, without changing anything. Used for the turn-order bar. */
export function turnOrder(b: Battle, n: number): number[] {
  const sim = b.units.filter(u => u.alive).map(u => ({ uid: u.uid, g: u.gauge, s: effSpd(u) }));
  const out: number[] = [];
  if (!sim.length) return out;
  for (let i = 0; i < n; i++) {
    let best = sim[0], bt = Infinity;
    for (const x of sim) { const t = Math.max(0, GAUGE - x.g) / x.s; if (t < bt) { bt = t; best = x; } }
    for (const x of sim) x.g += x.s * bt;
    best.g = 0;
    out.push(best.uid);
  }
  return out;
}

function addStatus(b: Battle, tgt: Unit, src: Unit, fx: Fx, ev: Ev[]) {
  if (!tgt.alive) return;
  if (fx.ch != null && b.rng() > fx.ch * (tgt.boss && (fx.k === 'stun' || fx.k === 'freeze') ? 0.5 : 1)) return;
  if ((fx.k === 'stun' || fx.k === 'freeze') && tgt.stunGuard > 0) { ev.push({ t: 'text', u: tgt.uid, s: 'Resisted' }); return; }
  let v = fx.v ?? DEFAULT_V[fx.k] ?? 0;
  if (fx.k === 'poison' && tgt.boss) v *= 0.4;
  const cur = tgt.statuses.find(s => s.k === fx.k && (fx.k !== 'boost' || s.el === fx.el));
  // Same-kind effects never stack: the stronger value stays and the duration refreshes.
  if (cur) { cur.t = Math.max(cur.t, fx.t); if (v >= cur.v) { cur.v = v; cur.src = src.uid; cur.atk = effAtk(src); } }
  else tgt.statuses.push({ k: fx.k, t: fx.t, v, src: src.uid, el: fx.el, atk: effAtk(src) });
  ev.push({ t: 'status', u: tgt.uid, k: fx.k, on: true });
  if (src.side === tgt.side ? isBuff(fx.k) : !isBuff(fx.k)) src.contrib.buff += effAtk(src) * 0.4;
}

function faint(b: Battle, u: Unit, ev: Ev[]) {
  u.alive = false; u.hp = 0; u.shield = 0; u.statuses = []; u.gauge = 0;
  ev.push({ t: 'faint', u: u.uid });
}

/** Apply damage to a unit, going through dodge, link, shield and counter. Returns health actually lost. */
function hurt(b: Battle, tgt: Unit, src: Unit | null, amount: number, mult: number, ev: Ev[], o: { ignoreShield?: boolean; direct?: boolean } = {}): number {
  if (!tgt.alive) return 0;
  let n = Math.max(1, Math.round(amount));
  if (!o.direct) {
    const dodge = has(tgt, 'dodge');
    if (dodge) { tgt.statuses = tgt.statuses.filter(s => s !== dodge); ev.push({ t: 'miss', u: tgt.uid }); return 0; }
    const ev2 = has(tgt, 'evade');
    if (ev2 && b.rng() * 100 < ev2.v) { ev.push({ t: 'miss', u: tgt.uid }); return 0; }
    if (has(tgt, 'link')) {
      const partner = b.units.find(x => x !== tgt && x.side === tgt.side && x.alive && has(x, 'link'));
      if (partner) { const half = Math.floor(n / 2); n -= half; hurt(b, partner, src, half, mult, ev, { direct: true }); }
    }
  }
  let sh = 0;
  if (tgt.shield > 0 && !o.ignoreShield) { sh = Math.min(tgt.shield, n); tgt.shield -= sh; n -= sh; }
  const lost = Math.min(tgt.hp, n);
  tgt.hp -= lost;
  ev.push({ t: 'dmg', u: tgt.uid, from: src ? src.uid : -1, n: lost + sh, mult, shield: sh });
  if (src && src.side !== tgt.side) src.contrib.dmg += lost + sh;
  tgt.contrib.absorb += lost + sh;
  if (tgt.hp <= 0) faint(b, tgt, ev);
  else if (!o.direct && src && src.alive && src.side !== tgt.side) {
    const counter = has(tgt, 'counter');
    if (counter) {
      tgt.statuses = tgt.statuses.filter(s => s !== counter);
      hurt(b, src, tgt, (lost + sh) * counter.v / 100, 1, ev, { direct: true });
    }
  }
  return lost;
}

function heal(tgt: Unit, src: Unit, amount: number, ev: Ev[], b?: Battle) {
  if (!tgt.alive) return;
  let n = Math.round(amount / (b ? frenzy(b) : 1));
  const w = has(tgt, 'wound');
  if (w) n = Math.round(n * (1 - w.v / 100));
  const real = Math.min(n, tgt.max.hp - tgt.hp);
  tgt.hp += real;
  src.contrib.heal += real; // only real healing counts toward XP
  ev.push({ t: 'heal', u: tgt.uid, n: real });
}

function shieldUp(tgt: Unit, src: Unit, amount: number, ev: Ev[]) {
  if (!tgt.alive) return;
  const cap = Math.round(tgt.max.hp * 0.6);
  const add = Math.max(0, Math.min(Math.round(amount), cap - tgt.shield));
  tgt.shield += add;
  src.contrib.buff += add * 0.5;
  ev.push({ t: 'shield', u: tgt.uid, n: add });
}

/** Long fights heat up: past 100 actions damage climbs and healing fades, so no fight can stall forever. */
export function frenzy(b: Battle): number {
  const total = b.actions[0] + b.actions[1];
  return total <= 100 ? 1 : 1 + (total - 100) / 30;
}

export function moveDamage(b: Battle, src: Unit, tgt: Unit, mv: MoveDef): { n: number; mult: number } {
  const atk = effAtk(src);
  const def = effDef(tgt) * (1 - (mv.pierce ?? 0));
  // Strike is typeless, so no creature is ever locked out of dealing damage.
  let mult = mv.id === STRIKE_ID ? 1 : matchup(mv.el, tgt.ph.el1, tgt.ph.el2);
  let n = ((mv.pow ?? 0) / 100) * atk * (atk / (atk + def)) * 2 * mult * frenzy(b);
  const boost = src.statuses.find(s => s.k === 'boost' && s.el === mv.el);
  if (boost) n *= 1 + boost.v / 100;
  if (mv.bonusVs && (mv.bonusVs.includes(tgt.ph.el1) || (tgt.ph.el2 && mv.bonusVs.includes(tgt.ph.el2)))) n *= 1.5;
  if (mv.bonusFull && tgt.hp >= tgt.max.hp) n *= 1.5;
  if (mv.pctHp && mult > 0) n += Math.min(tgt.hp * mv.pctHp / 100, atk * 4);
  return { n, mult };
}

export function usable(b: Battle, u: Unit, mv: MoveDef): boolean {
  if ((u.cds[mv.id] ?? 0) > 0) return false;
  if (mv.once && u.used.includes(mv.id)) return false;
  if ((mv.target === 'fallen' || mv.target === 'allFallen') && allies(b, u, false).length === 0) return false;
  return true;
}

/** The units a player may pick for this move. Moves that hit everyone still return the group, for highlighting. */
export function validTargets(b: Battle, u: Unit, mv: MoveDef): number[] {
  switch (mv.target) {
    case 'enemy': case 'two': {
      const es = enemies(b, u);
      const seen = es.filter(e => !has(e, 'hidden'));
      return (seen.length ? seen : es).map(e => e.uid);
    }
    case 'enemies': return enemies(b, u).map(e => e.uid);
    case 'ally': case 'allies': return allies(b, u).map(e => e.uid);
    case 'self': return [u.uid];
    case 'fallen': case 'allFallen': return allies(b, u, false).map(e => e.uid);
  }
}
export const needsPick = (mv: MoveDef) => mv.target === 'enemy' || mv.target === 'two' || mv.target === 'ally' || mv.target === 'fallen';

function resolveTargets(b: Battle, u: Unit, mv: MoveDef, target: number): Unit[] {
  const valid = validTargets(b, u, mv);
  if (!valid.length) return [];
  const chosen = valid.includes(target) ? target : valid[0];
  switch (mv.target) {
    case 'enemy': case 'ally': case 'fallen': return [b.units[chosen]];
    case 'two': {
      const others = valid.filter(v => v !== chosen);
      const second = others.length ? others[Math.floor(b.rng() * others.length)] : null;
      return second == null ? [b.units[chosen]] : [b.units[chosen], b.units[second]];
    }
    default: return valid.map(v => b.units[v]);
  }
}

function perform(b: Battle, u: Unit, mv: MoveDef, target: number, ev: Ev[]) {
  const targets = resolveTargets(b, u, mv, target);
  ev.push({ t: 'move', u: u.uid, name: mv.name, el: mv.el, targets: targets.map(t => t.uid), style: moveStyle(mv), heal: !!(mv.heal || mv.teamHeal || mv.fullHeal || mv.revive), flair: moveFlair(mv), rarity: mv.rarity, support: moveStyle(mv) === 'support' ? supportKind(mv) : undefined });
  const hostile = mv.target === 'enemy' || mv.target === 'two' || mv.target === 'enemies';
  let dealt = 0;

  if (mv.revive) {
    for (const t of targets) {
      if (t.alive) continue;
      t.alive = true; t.hp = Math.max(1, Math.round(t.max.hp * mv.revive)); t.gauge = 0; t.statuses = []; t.shield = 0;
      u.contrib.revive += t.hp * 2;
      ev.push({ t: 'revive', u: t.uid, n: t.hp });
    }
  }
  if (hostile && mv.pow) {
    for (let h = 0; h < (mv.hits ?? 1); h++) {
      for (const t of targets) {
        if (!t.alive || !u.alive) continue;
        const { n, mult } = moveDamage(b, u, t, mv);
        if (mult === 0) { ev.push({ t: 'text', u: t.uid, s: 'No effect' }); continue; }
        dealt += hurt(b, t, u, n * (0.92 + b.rng() * 0.16), mult, ev, { ignoreShield: mv.ignoreShield });
      }
    }
  }
  if (mv.strip) {
    const pool = mv.strip === 'all' ? enemies(b, u) : targets;
    for (const t of pool) {
      const buffs = t.statuses.filter(s => isBuff(s.k));
      if (!buffs.length && t.shield <= 0) continue;
      if (mv.strip === 'one') { if (buffs.length) t.statuses = t.statuses.filter(s => s !== buffs[0]); else t.shield = 0; }
      else { t.statuses = t.statuses.filter(s => !isBuff(s.k)); t.shield = 0; }
      u.contrib.buff += effAtk(u) * 0.4;
      ev.push({ t: 'text', u: t.uid, s: 'Boosts stripped' });
    }
  }
  const team = allies(b, u);
  if (mv.cleanse) {
    for (const t of hostile ? team : targets) {
      if (t.statuses.some(s => !isBuff(s.k))) { t.statuses = t.statuses.filter(s => isBuff(s.k)); u.contrib.buff += effAtk(u) * 0.4; ev.push({ t: 'text', u: t.uid, s: 'Cleansed' }); }
    }
  }
  const atk = effAtk(u);
  if (!hostile) {
    for (const t of targets) {
      if (mv.fullHeal) heal(t, u, t.max.hp, ev, b);
      if (mv.heal) heal(t, u, atk * mv.heal / 100 * 1.6, ev, b);
      if (mv.shield) shieldUp(t, u, atk * mv.shield / 100 * 1.6, ev);
    }
  }
  if (mv.teamHeal) for (const t of team) heal(t, u, atk * mv.teamHeal / 100 * 1.6, ev, b);
  if (mv.teamShield) for (const t of team) shieldUp(t, u, atk * mv.teamShield / 100 * 1.6, ev);
  if (mv.drain && dealt > 0 && u.alive) heal(u, u, dealt * mv.drain, ev);
  for (const fx of mv.fx ?? []) {
    const who = fx.on === 'self' ? [u] : fx.on === 'allies' ? team : fx.on === 'enemies' ? enemies(b, u) : targets;
    for (const t of who) addStatus(b, t, u, fx, ev);
  }
  if (mv.recoil && u.alive) hurt(b, u, null, u.max.hp * mv.recoil / 100, 1, ev, { direct: true });
  if (u.alive && u.hp <= 0) faint(b, u, ev);
}

/** Advance time to the next creature able to act. Burns, poison and regen tick, and stunned creatures lose the turn. */
export function nextActor(b: Battle): { actor: number | null; events: Ev[] } {
  const ev: Ev[] = [];
  for (let guard = 0; guard < 200; guard++) {
    checkOver(b);
    if (b.over != null) return { actor: null, events: ev };
    const live = b.units.filter(u => u.alive);
    let best = live[0], bt = Infinity;
    for (const u of live) { const t = Math.max(0, GAUGE - u.gauge) / effSpd(u); if (t < bt) { bt = t; best = u; } }
    for (const u of live) u.gauge += effSpd(u) * bt;
    const u = best;
    // Start-of-turn ticks.
    for (const s of [...u.statuses]) {
      if (!u.alive) break;
      if (s.k === 'burn') { ev.push({ t: 'tick', u: u.uid, k: 'burn', n: 0 }); hurt(b, u, b.units[s.src] ?? null, s.atk * s.v / 100, 1, ev, { direct: true }); }
      if (s.k === 'poison') { ev.push({ t: 'tick', u: u.uid, k: 'poison', n: 0 }); hurt(b, u, b.units[s.src] ?? null, u.max.hp * s.v / 100, 1, ev, { direct: true }); }
      if (s.k === 'regen') heal(u, b.units[s.src] ?? u, s.atk * s.v / 100 * 1.6, ev, b);
    }
    if (!u.alive) continue;
    const stun = has(u, 'stun') ?? has(u, 'freeze');
    if (stun) {
      ev.push({ t: 'skip', u: u.uid, k: stun.k });
      endAction(b, u, 0);
      // Repeated stuns get weaker: a creature that lost a turn resists the next stun for a while.
      u.stunGuard = 3;
      continue;
    }
    return { actor: u.uid, events: ev };
  }
  return { actor: null, events: ev };
}

function endAction(b: Battle, u: Unit, refund: number) {
  for (const k of Object.keys(u.cds)) if (u.cds[k] > 0) u.cds[k]--;
  for (const s of u.statuses) s.t--;
  u.statuses = u.statuses.filter(s => s.t > 0);
  if (u.stunGuard > 0) u.stunGuard--;
  // At most one extra action in a row, so follow-ups can't chain endlessly.
  if (refund >= 1) { if (u.chain >= 1) refund = 0.5; else u.chain++; } else u.chain = 0;
  u.gauge = GAUGE * clamp(refund, 0, 1);
  b.actions[u.side]++;
  checkOver(b);
}

export function act(b: Battle, uid: number, moveId: string, target: number): Ev[] {
  const u = b.units[uid];
  const ev: Ev[] = [];
  if (!u || !u.alive || b.over != null) return ev;
  let mv = u.moves.find(m => m.id === moveId) ?? u.moves[u.moves.length - 1];
  if (!usable(b, u, mv)) mv = u.moves.find(m => m.id === STRIKE_ID) ?? mv;
  const own = mv;
  if (mv.echo) {
    const last = b.lastMove[u.side];
    if (last && usable(b, { ...u, cds: {}, used: [] } as Unit, last)) {
      ev.push({ t: 'text', u: u.uid, s: 'Echo: ' + last.name });
      const tg = last.target === own.target ? target : aiTarget(b, u, last);
      perform(b, u, last, tg, ev);
    } else perform(b, u, { ...mv, echo: false }, target, ev);
  } else {
    perform(b, u, mv, target, ev);
    b.lastMove[u.side] = mv;
  }
  if (own.cd > 0) u.cds[own.id] = own.cd + 1;
  if (own.once) u.used.push(own.id);
  if (u.alive) endAction(b, u, own.quick ?? 0); else { b.actions[u.side]++; checkOver(b); }
  return ev;
}

const hpFrac = (u: Unit) => u.hp / u.max.hp;

function aiTarget(b: Battle, u: Unit, mv: MoveDef): number {
  const valid = validTargets(b, u, mv).map(i => b.units[i]);
  if (!valid.length) return -1;
  if (mv.target === 'enemy' || mv.target === 'two') {
    let best = valid[0], bs = -1;
    for (const t of valid) {
      const { n } = moveDamage(b, u, t, mv);
      const s = n * (n >= t.hp + t.shield ? 2 : 1) + (1 - hpFrac(t)) * 5 + b.rng();
      if (s > bs) { bs = s; best = t; }
    }
    return best.uid;
  }
  if (mv.target === 'ally') {
    if (mv.heal || mv.shield) return valid.reduce((a, c) => (hpFrac(c) < hpFrac(a) ? c : a)).uid;
    const fresh = valid.filter(t => !(mv.fx ?? []).every(f => has(t, f.k)));
    return (fresh.length ? fresh : valid).reduce((a, c) => (effAtk(c) > effAtk(a) ? c : a)).uid;
  }
  return valid[0].uid;
}

/** A simple scoring AI, used for enemies and for the player's Auto mode. */
export function aiChoose(b: Battle, uid: number): { move: string; target: number } {
  const u = b.units[uid];
  const team = allies(b, u);
  const foes = enemies(b, u);
  const avgHp = team.reduce((a, c) => a + hpFrac(c), 0) / Math.max(1, team.length);
  let best = { move: STRIKE_ID, target: foes[0]?.uid ?? -1 }, bs = -Infinity;
  for (const mv of u.moves) {
    if (!usable(b, u, mv)) continue;
    const target = aiTarget(b, u, mv);
    const t = b.units[target];
    let s = 0;
    const hostile = mv.target === 'enemy' || mv.target === 'two' || mv.target === 'enemies';
    if (mv.revive) s = 900;
    else if (mv.fullHeal) s = avgHp < 0.5 ? 1000 : 0;
    else if (hostile) {
      if (mv.pow) {
        const each = mv.target === 'enemies' ? foes : [t];
        for (const e of each) { const { n } = moveDamage(b, u, e, mv); const total = n * (mv.hits ?? 1); s += (total / Math.max(1, u.max.atk)) * 100 + (total >= e.hp + e.shield ? 120 : 0); }
        if (mv.target === 'two') s *= 1.6;
      }
      const fresh = (mv.fx ?? []).filter(f => !f.on && t && !has(t, f.k));
      s += fresh.length * (mv.pow && mv.pow >= 60 ? 30 : 110) * (mv.target === 'enemies' ? Math.min(3, foes.length) * 0.6 : 1);
      if (mv.strip && foes.some(e => e.statuses.some(x => isBuff(x.k)) || e.shield > 0)) s += 140;
      if (mv.teamHeal) s += (1 - avgHp) * 300;
    } else {
      const group = mv.target === 'allies' ? team : t ? [t] : [];
      if (mv.heal) { const miss = group.reduce((a, c) => a + (1 - hpFrac(c)), 0); s += miss > 0.35 * group.length ? miss * 420 : miss * 60; }
      if (mv.shield) s += group.filter(c => c.shield <= 0).length * 90 + (1 - avgHp) * 60;
      if (mv.cleanse) s += group.filter(c => c.statuses.some(x => !isBuff(x.k))).length * 150;
      for (const f of mv.fx ?? []) s += group.filter(c => !has(c, f.k)).length * (mv.target === 'allies' ? 70 : 120);
      if (mv.quick && mv.quick >= 1) s += 60;
    }
    s *= 0.9 + b.rng() * 0.2;
    if (s > bs) { bs = s; best = { move: mv.id, target }; }
  }
  return best;
}

/** Run a whole fight with AI on both sides. Used by tests and for quick simulation. */
export function autoResolve(b: Battle, maxActions = 600): Battle {
  for (let i = 0; i < maxActions && b.over == null; i++) {
    const { actor } = nextActor(b);
    if (actor == null) break;
    const c = aiChoose(b, actor);
    act(b, actor, c.move, c.target);
  }
  return b;
}

/** A creature's value in a fight: damage, healing, damage absorbed, buffs and revives. */
export function contribution(u: Unit): number {
  const c = u.contrib;
  return c.dmg + c.heal * 1.2 + c.absorb * 0.5 + c.buff + c.revive;
}

export { MOVES };
