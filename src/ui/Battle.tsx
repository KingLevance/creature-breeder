// The fight screen. Everything that moves runs on native-driver animations so it stays smooth:
// - Between fights the team walks on while the ground and hills scroll, and the next enemies slide in with the
//   ground until the camera settles, so there is no cut.
// - Melee moves send the attacker to the target to strike it there. Ranged moves fire an element projectile or
//   beam, area moves burst on every target, and support moves sparkle on the creatures they help.
// - A creature that faints is knocked back, squashes and topples onto the ground. Enemies then dissolve in a puff;
//   your own stay down, dimmed, until revived.
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, Ellipse, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { ELEMENTS, ElementId } from '../game/data/elements';
import { MoveDef, StatusKind } from '../game/data/moves';
import { Battle, Ev, Unit, act, aiChoose, isBuff, needsPick, nextActor, turnOrder, usable, validTargets } from '../game/battle';
import { STAGE_NAMES } from '../game/creature';
import { express, starRating } from '../game/genome';
import { FightResult, Loot, Run, finishFight, startBattle } from '../game/run';
import { byId } from '../game/save';
import { castSfx, setMusic, sfx, tap } from './audio';
import { FxLayer, FxNew, FxSpec, isBeam } from './Fx';
import { Bar, Btn, C, CreatureView, EggView, P, Stars, readable, st } from './kit';
import { rng, useGame } from './store';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const ND = true; // native driver for every transform and opacity animation
const run = (a: Animated.CompositeAnimation) => new Promise<void>(r => a.start(() => r()));

interface UV { hp: number; shield: number; alive: boolean; statuses: StatusKind[] }
const snap = (b: Battle): UV[] => b.units.map(u => ({ hp: u.hp, shield: u.shield, alive: u.alive, statuses: u.statuses.map(s => s.k) }));

const STATUS_TAG: Record<StatusKind, string> = {
  burn: 'BRN', poison: 'PSN', stun: 'STN', freeze: 'FRZ', slow: 'SPD-', haste: 'SPD+', atkUp: 'ATK+', atkDown: 'ATK-', defUp: 'DEF+',
  defDown: 'DEF-', evade: 'EVA', dodge: 'DGE', regen: 'RGN', counter: 'CTR', hidden: 'HID', link: 'LNK', boost: 'BST', wound: 'WND',
};
const STATUS_WORD: Record<StatusKind, string> = {
  burn: 'Burned', poison: 'Poisoned', stun: 'Stunned', freeze: 'Frozen', slow: 'Slowed', haste: 'Faster', atkUp: 'Attack up', atkDown: 'Attack down',
  defUp: 'Defense up', defDown: 'Defense down', evade: 'Evasive', dodge: 'Will dodge', regen: 'Regenerating', counter: 'Countering', hidden: 'Hidden',
  link: 'Linked', boost: 'Boosted', wound: 'Wounded',
};

const SLOTS = [[0.36, 0.52], [0.36, 0.86], [0.13, 0.36], [0.13, 0.68], [0.13, 1.0]];
const BOSS_SLOTS = [[0.34, 0.66], [0.1, 0.34], [0.1, 0.68], [0.12, 1.0], [0.4, 1.0]];

interface Float { id: number; uid: number; text: string; color: string; big?: boolean }

/** Per-creature animation values. */
interface UA {
  ox: Animated.Value; oy: Animated.Value; shake: Animated.Value; blink: Animated.Value;
  down: Animated.Value; squash: Animated.Value; fade: Animated.Value;
}
const newUA = (): UA => ({
  ox: new Animated.Value(0), oy: new Animated.Value(0), shake: new Animated.Value(0), blink: new Animated.Value(1),
  down: new Animated.Value(0), squash: new Animated.Value(0), fade: new Animated.Value(1),
});

const FloatText = memo(function FloatText({ f, x, y, onDone }: { f: Float; x: number; y: number; onDone: (id: number) => void }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: 1, duration: 850, easing: Easing.out(Easing.quad), useNativeDriver: ND }).start(() => onDone(f.id));
  }, [a, f.id, onDone]);
  return (
    <Animated.Text pointerEvents="none" style={{
      position: 'absolute', left: x - 60, top: y, width: 120, textAlign: 'center', color: f.color, fontWeight: '900', fontSize: f.big ? 19 : 14,
      textShadowColor: '#000', textShadowRadius: 3, textShadowOffset: { width: 0, height: 1 },
      opacity: a.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] }),
      transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [0, -34] }) }],
    }}>{f.text}</Animated.Text>
  );
});

/** A creature's picture. When walking it steps through its walk cycle on its own timer. */
const Sprite = memo(function Sprite({ u, size, walking }: { u: Unit; size: number; walking: boolean }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!walking) { setFrame(0); return; }
    const id = setInterval(() => setFrame(f => (f + 1) % 12), 55);
    return () => clearInterval(id);
  }, [walking]);
  return <CreatureView ph={u.ph} stage={u.stage} size={size} flip={u.side === 1} phase={frame / 12} walking={walking} />;
});

// ---------- scrolling background
function hills(W: number, H: number) {
  const out: string[] = [];
  for (let k = -1; k <= 2; k++) for (const [x, r, h] of [[0.1, 0.32, 0.1], [0.45, 0.26, 0.07], [0.78, 0.36, 0.12]]) {
    const cx = (x + k) * W, rx = r * W;
    out.push(`M${cx - rx} ${H} Q${cx} ${H - h * 2 * W * 0.6} ${cx + rx} ${H}Z`);
  }
  return out.join(' ');
}
const DECOR: [number, number, number, number][] = Array.from({ length: 14 }, (_, i) => [((i * 137) % 100) / 100, 0.08 + ((i * 53) % 90) / 100, 10 + ((i * 29) % 26), i % 3]);

const Backdrop = memo(function Backdrop({ W, H, sky, ground, travel }: { W: number; H: number; sky: [string, string]; ground: string; travel: Animated.Value }) {
  const horizon = H * 0.22;
  const far = useMemo(() => Animated.multiply(Animated.modulo(Animated.multiply(travel, 0.3), W), -1), [travel, W]);
  const near = useMemo(() => Animated.multiply(Animated.modulo(travel, W), -1), [travel, W]);
  const groundH = H - horizon;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, overflow: 'hidden' }}>
      <Svg width={W} height={H} style={{ position: 'absolute' }}>
        <Defs>
          <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={sky[0]} /><Stop offset="1" stopColor={sky[1]} /></LinearGradient>
          <LinearGradient id="gnd" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={ground} stopOpacity={0.85} /><Stop offset="1" stopColor={ground} /></LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={W} height={H} fill="url(#sky)" />
        <Rect x={0} y={horizon} width={W} height={groundH} fill="url(#gnd)" />
      </Svg>
      <Animated.View style={{ position: 'absolute', left: 0, top: 0, width: W * 2, height: horizon + 2, transform: [{ translateX: far }] }}>
        <Svg width={W * 2} height={horizon + 2}><Path d={hills(W, horizon + 2)} fill={ground} opacity={0.55} /></Svg>
      </Animated.View>
      <Animated.View style={{ position: 'absolute', left: 0, top: horizon, width: W * 2, height: groundH, transform: [{ translateX: near }] }}>
        <Svg width={W * 2} height={groundH}>
          {[-1, 0, 1, 2].flatMap(k => DECOR.map(([x, y, r, kind], i) => {
            const cx = (x + k) * W, cy = y * groundH;
            if (kind === 0) return <Ellipse key={k + '_' + i} cx={cx} cy={cy} rx={r} ry={r * 0.22} fill="#000" opacity={0.08} />;
            if (kind === 1) return <Path key={k + '_' + i} d={`M${cx - 6} ${cy} L${cx - 3} ${cy - 9} L${cx} ${cy} L${cx + 3} ${cy - 11} L${cx + 6} ${cy}Z`} fill="#000" opacity={0.1} />;
            return <Ellipse key={k + '_' + i} cx={cx} cy={cy} rx={r * 0.35} ry={r * 0.2} fill="#fff" opacity={0.1} />;
          }))}
        </Svg>
      </Animated.View>
    </View>
  );
});

function lootLines(l: Loot): string {
  const parts: string[] = [];
  if (l.gold) parts.push(`${l.gold} gold`);
  if (l.dust) parts.push(`${l.dust} dust`);
  if (l.shard) parts.push(`${l.shard} shard${l.shard > 1 ? 's' : ''}`);
  if (l.core) parts.push(`${l.core} core${l.core > 1 ? 's' : ''}`);
  if (l.scans) parts.push(`${l.scans} scan lens`);
  if (l.essence) parts.push(`${l.essence} essence`);
  return parts.join(' · ');
}

export function LootView({ title, loot }: { title: string; loot: Loot }) {
  const text = lootLines(loot);
  if (!text && !loot.eggs.length) return null;
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={{ color: C.gold, fontWeight: '800', fontSize: 13 }}>{title}</Text>
      {text ? <P>{text}</P> : null}
      {loot.eggs.length ? (
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
          {loot.eggs.map(e => (
            <View key={e.id} style={{ alignItems: 'center' }}>
              <EggView ph={express(e.g)} size={52} />
              <Stars n={starRating(e.g)} size={10} />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function BattleScreen({ run: theRun, onExit }: { run: Run; onExit: () => void }) {
  const { save, mutate } = useGame();
  const { width: W, height: winH } = useWindowDimensions();
  const fieldH = Math.round(Math.min(W * 0.92, winH * 0.46));
  const bRef = useRef<Battle | null>(null);
  const live = useRef(true);
  const autoRef = useRef(save.auto);
  const fastRef = useRef(save.fast);
  autoRef.current = save.auto; fastRef.current = save.fast;
  const [view, setView] = useState<UV[]>([]);
  const [order, setOrder] = useState<number[]>([]);
  const [actor, setActor] = useState<number | null>(null);
  const [sel, setSel] = useState<MoveDef | null>(null);
  const [banner, setBanner] = useState<{ text: string; color: string } | null>(null);
  const [floats, setFloats] = useState<Float[]>([]);
  const [fx, setFx] = useState<FxSpec[]>([]);
  const [result, setResult] = useState<FightResult | null>(null);
  const [mode, setMode] = useState<'walk' | 'fight'>('walk');
  const [fightNo, setFightNo] = useState(0);
  const nextId = useRef(0);
  const ua = useRef<Record<number, UA>>({});
  const bob = useRef(new Animated.Value(0)).current;
  const travel = useRef(new Animated.Value(0)).current;
  const busy = useRef(false);
  const D = W * 0.95; // how far the camera travels between chambers
  const enter = useMemo(() => Animated.subtract(D, travel), [D, travel]);

  const A = (uid: number) => (ua.current[uid] ??= newUA());
  const T = () => (fastRef.current ? 0.5 : 1);

  useEffect(() => {
    live.current = true;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(bob, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
      Animated.timing(bob, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
    ]));
    loop.start();
    return () => { live.current = false; loop.stop(); };
  }, [bob]);

  const addFloat = useCallback((uid: number, text: string, color: string, big?: boolean) => {
    setFloats(fs => [...fs.slice(-14), { id: ++nextId.current, uid, text, color, big }]);
  }, []);
  const dropFloat = useCallback((id: number) => setFloats(fs => fs.filter(f => f.id !== id)), []);
  const addFx = useCallback((s: FxNew) => setFx(xs => [...xs.slice(-24), { ...(s as FxSpec), id: ++nextId.current }]), []);
  const dropFx = useCallback((id: number) => setFx(xs => xs.filter(x => x.id !== id)), []);
  const patch = (uid: number, fn: (v: UV) => UV) => setView(vs => vs.map((v, i) => (i === uid ? fn(v) : v)));

  // ---------- layout
  const b = bRef.current;
  const biggest = b ? Math.max(b.units.filter(u => u.side === 0).length, b.units.filter(u => u.side === 1).length) : 5;
  const size = Math.min(W * 0.21, fieldH * 0.25) * (biggest <= 2 ? 1.35 : biggest === 3 ? 1.15 : 1);
  const place = useCallback((u: Unit) => {
    const bossFight = bRef.current!.units.some(x => x.side === 1 && x.boss);
    const slots = u.side === 1 && bossFight ? BOSS_SLOTS : SLOTS;
    const [cx, fy] = slots[u.slot % 5];
    const sz = size * (u.boss ? 1.55 : u.stage === 0 ? 0.82 : 1);
    const x = (u.side === 0 ? cx : 1 - cx) * W;
    const feet = fieldH * (0.2 + fy * 0.76);
    return { left: x - sz / 2, top: feet - sz, sz, feet, x, midY: feet - sz * 0.45 };
  }, [size, W, fieldH]);

  // ---------- animations
  const faintAnim = useCallback(async (u: Unit, fromX: number | null) => {
    const a = A(u.uid);
    const dir = u.side === 0 ? -1 : 1; // pushed away from the other team
    const push = fromX == null ? dir : Math.sign(place(u).x - fromX) || dir;
    sfx('faint');
    await run(Animated.parallel([
      Animated.timing(a.ox, { toValue: push * 16, duration: 140 * T(), easing: Easing.out(Easing.quad), useNativeDriver: ND }),
      Animated.sequence([
        Animated.timing(a.blink, { toValue: 0.25, duration: 60, useNativeDriver: ND }), Animated.timing(a.blink, { toValue: 1, duration: 60, useNativeDriver: ND }),
        Animated.timing(a.blink, { toValue: 0.25, duration: 60, useNativeDriver: ND }), Animated.timing(a.blink, { toValue: 1, duration: 60, useNativeDriver: ND }),
      ]),
      Animated.timing(a.squash, { toValue: 1, duration: 140 * T(), useNativeDriver: ND }),
    ]));
    // Topple over onto the ground and settle with a small bounce.
    await run(Animated.parallel([
      Animated.timing(a.squash, { toValue: 0, duration: 120 * T(), useNativeDriver: ND }),
      Animated.timing(a.down, { toValue: 1, duration: 380 * T(), easing: Easing.bounce, useNativeDriver: ND }),
    ]));
    const p = place(u);
    addFx({ kind: 'puff', x: p.x, y: p.feet - 6 });
    if (u.side === 1) {
      await sleep(180 * T());
      sfx('poof');
      addFx({ kind: 'puff', x: p.x, y: p.feet - p.sz * 0.3, color: ELEMENTS[u.ph.el1].light });
      Animated.timing(a.fade, { toValue: 0, duration: 420, useNativeDriver: ND }).start();
    } else {
      Animated.timing(a.fade, { toValue: 0.4, duration: 400, useNativeDriver: ND }).start();
    }
  }, [addFx, place]);

  const reviveAnim = useCallback(async (u: Unit) => {
    const a = A(u.uid);
    const p = place(u);
    sfx('revive');
    addFx({ kind: 'aura', color: C.good, x: p.x, y: p.feet - p.sz * 0.5 });
    await run(Animated.parallel([
      Animated.timing(a.fade, { toValue: 1, duration: 250, useNativeDriver: ND }),
      Animated.timing(a.down, { toValue: 0, duration: 350 * T(), easing: Easing.out(Easing.back(1.5)), useNativeDriver: ND }),
      Animated.timing(a.ox, { toValue: 0, duration: 350 * T(), useNativeDriver: ND }),
    ]));
  }, [addFx, place]);

  const play = useCallback(async (events: Ev[]) => {
    const b = bRef.current!;
    let moveEl: ElementId = 'plain';
    let melee: number | null = null;
    let attackerX: number | null = null;
    let attackerSide = -1;
    let statusSound = false;
    for (const e of events) {
      if (!live.current) return;
      switch (e.t) {
        case 'move': {
          const u = b.units[e.u];
          moveEl = e.el;
          attackerSide = u.side;
          setBanner({ text: `${u.name}: ${e.name}`, color: ELEMENTS[e.el].base });
          const pa = place(u);
          attackerX = pa.x;
          const a = A(e.u);
          const dir = u.side === 0 ? 1 : -1;
          const targets = e.targets.map(t => b.units[t]).filter(Boolean);
          if (e.style === 'melee' && targets[0]) {
            const pt = place(targets[0]);
            const tx = pt.x - dir * (pt.sz * 0.42 + pa.sz * 0.3) - pa.x;
            const ty = pt.feet - pa.feet + 2;
            melee = e.u;
            sfx('swing');
            await run(Animated.parallel([
              Animated.timing(a.ox, { toValue: tx, duration: 240 * T(), easing: Easing.in(Easing.quad), useNativeDriver: ND }),
              Animated.timing(a.oy, { toValue: ty, duration: 240 * T(), easing: Easing.in(Easing.quad), useNativeDriver: ND }),
            ]));
            Animated.sequence([
              Animated.timing(a.ox, { toValue: tx + dir * 12, duration: 60, useNativeDriver: ND }),
              Animated.timing(a.ox, { toValue: tx, duration: 90, useNativeDriver: ND }),
            ]).start();
            await sleep(50);
          } else if (e.style === 'ranged') {
            sfx(castSfx(e.el));
            Animated.sequence([
              Animated.timing(a.ox, { toValue: dir * 8, duration: 90, useNativeDriver: ND }),
              Animated.timing(a.ox, { toValue: 0, duration: 140, useNativeDriver: ND }),
            ]).start();
            let wait = 0;
            for (const t of targets) {
              const pt = place(t);
              const x1 = pa.x + dir * pa.sz * 0.25, y1 = pa.midY, x2 = pt.x, y2 = pt.midY;
              const dur = Math.round(Math.min(380, 160 + Math.abs(x2 - x1) * 0.5) * T());
              if (isBeam(e.el)) addFx({ kind: 'beam', el: e.el, x1, y1, x2, y2, dur: dur + 120 });
              else addFx({ kind: 'proj', el: e.el, x1, y1, x2, y2, dur });
              wait = Math.max(wait, isBeam(e.el) ? 90 : dur);
            }
            await sleep(wait);
          } else if (e.style === 'area') {
            sfx(castSfx(e.el));
            addFx({ kind: 'charge', el: e.el, x: pa.x, y: pa.midY });
            await sleep(260 * T());
            targets.forEach((t, i) => setTimeout(() => { const pt = place(t); addFx({ kind: 'burst', el: e.el, x: pt.x, y: pt.midY, big: true }); }, i * 45));
            await sleep(120 * T());
          } else {
            sfx(e.heal ? 'heal' : castSfx(e.el) === 'magic' ? 'magic' : 'buff');
            Animated.sequence([
              Animated.timing(a.oy, { toValue: -12, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: ND }),
              Animated.timing(a.oy, { toValue: 0, duration: 160, easing: Easing.in(Easing.quad), useNativeDriver: ND }),
            ]).start();
            for (const t of targets) {
              if (!t.alive && !e.heal) continue;
              const pt = place(t);
              addFx({ kind: 'aura', color: e.heal ? C.good : ELEMENTS[e.el].glow, x: pt.x, y: pt.feet - pt.sz * 0.55 });
            }
            await sleep(320 * T());
          }
          break;
        }
        case 'dmg': {
          const t = b.units[e.u];
          const pt = place(t);
          patch(e.u, v => ({ ...v, hp: Math.max(0, v.hp - (e.n - e.shield)), shield: Math.max(0, v.shield - e.shield) }));
          addFloat(e.u, `-${e.n}${e.mult > 1 ? '!' : ''}`, e.mult > 1 ? '#ffd34d' : e.mult < 1 ? '#b9b3cc' : '#ff7b7b', e.mult > 1);
          if (e.mult > 1) addFloat(e.u, e.mult >= 4 ? 'Devastating' : 'Hits hard', '#ffd34d');
          else if (e.mult < 1) addFloat(e.u, 'Hits weakly', '#b9b3cc');
          if (e.from >= 0) addFx({ kind: 'burst', el: moveEl, x: pt.x, y: pt.midY, big: e.mult > 1 });
          sfx(e.mult > 1 || e.n > t.max.hp * 0.3 ? 'hitBig' : 'hit');
          const a = A(e.u);
          Animated.sequence([
            Animated.timing(a.shake, { toValue: 7, duration: 40, useNativeDriver: ND }), Animated.timing(a.shake, { toValue: -6, duration: 50, useNativeDriver: ND }),
            Animated.timing(a.shake, { toValue: 3, duration: 40, useNativeDriver: ND }), Animated.timing(a.shake, { toValue: 0, duration: 40, useNativeDriver: ND }),
          ]).start();
          Animated.sequence([
            Animated.timing(a.blink, { toValue: 0.45, duration: 50, useNativeDriver: ND }), Animated.timing(a.blink, { toValue: 1, duration: 90, useNativeDriver: ND }),
          ]).start();
          await sleep(200 * T());
          break;
        }
        case 'miss': {
          addFloat(e.u, 'Dodged', '#9fe8ff');
          sfx('miss');
          const a = A(e.u);
          const dir = b.units[e.u].side === 0 ? -1 : 1;
          Animated.sequence([
            Animated.timing(a.oy, { toValue: -16, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: ND }),
            Animated.timing(a.oy, { toValue: 0, duration: 140, easing: Easing.in(Easing.quad), useNativeDriver: ND }),
          ]).start();
          Animated.sequence([
            Animated.timing(a.ox, { toValue: dir * 14, duration: 110, useNativeDriver: ND }),
            Animated.timing(a.ox, { toValue: 0, duration: 160, useNativeDriver: ND }),
          ]).start();
          await sleep(200 * T());
          break;
        }
        case 'heal': if (e.n > 0) { patch(e.u, v => ({ ...v, hp: v.hp + e.n })); addFloat(e.u, `+${e.n}`, C.good); await sleep(120 * T()); } break;
        case 'shield': if (e.n > 0) { patch(e.u, v => ({ ...v, shield: v.shield + e.n })); addFloat(e.u, 'Shield', '#9fe8ff'); sfx('shield'); await sleep(110 * T()); } break;
        case 'status':
          patch(e.u, v => (v.statuses.includes(e.k) ? v : { ...v, statuses: [...v.statuses, e.k] }));
          addFloat(e.u, STATUS_WORD[e.k], isBuff(e.k) ? '#9fe8a0' : '#f3a5ff');
          if (!statusSound && !isBuff(e.k) && b.units[e.u].side !== attackerSide) { statusSound = true; sfx('debuff'); }
          await sleep(80 * T());
          break;
        case 'skip': addFloat(e.u, e.k === 'freeze' ? 'Frozen' : 'Stunned', '#f3a5ff', true); sfx('debuff'); await sleep(380 * T()); break;
        case 'faint': patch(e.u, v => ({ ...v, alive: false, hp: 0, shield: 0, statuses: [] })); await faintAnim(b.units[e.u], attackerX); break;
        case 'revive': patch(e.u, v => ({ ...v, alive: true, hp: e.n })); addFloat(e.u, 'Revived!', C.good, true); await reviveAnim(b.units[e.u]); break;
        case 'text': addFloat(e.u, e.s, '#e7e0ff'); await sleep(130 * T()); break;
        case 'tick': {
          const p = place(b.units[e.u]);
          addFx({ kind: 'burst', el: e.k === 'burn' ? 'ember' : 'venom', x: p.x, y: p.midY });
          break;
        }
      }
    }
    // A melee attacker runs back to its spot.
    if (melee != null && live.current) {
      const a = A(melee);
      if (bRef.current!.units[melee].alive) {
        await run(Animated.parallel([
          Animated.timing(a.ox, { toValue: 0, duration: 260 * T(), easing: Easing.inOut(Easing.quad), useNativeDriver: ND }),
          Animated.timing(a.oy, { toValue: 0, duration: 260 * T(), easing: Easing.inOut(Easing.quad), useNativeDriver: ND }),
        ]));
      }
    }
    if (live.current) { setView(snap(b)); setOrder(turnOrder(b, 8)); }
  }, [addFloat, addFx, faintAnim, place, reviveAnim]);

  const finish = useCallback(() => {
    const b = bRef.current!;
    if (b.over == null) b.over = 0; // raid: out of actions
    const res = mutate(s => finishFight(rng, s, theRun, b, Date.now()));
    setBanner(null); setActor(null); setSel(null);
    setMusic(null);
    sfx(theRun.kind === 'raid' || res.won ? 'victory' : 'defeat');
    if (res.chest) setTimeout(() => sfx('chest'), 900);
    if (res.xp.some(x => x.newStage != null)) setTimeout(() => sfx('grow'), 1400);
    else if (res.xp.some(x => x.levels > 0)) setTimeout(() => sfx('levelup'), 1400);
    setResult(res);
  }, [mutate, theRun]);

  const step = useCallback(async () => {
    const b = bRef.current!;
    for (;;) {
      if (!live.current) return;
      if (b.over != null || (theRun.actionLimit > 0 && b.actions[0] >= theRun.actionLimit)) { await sleep(500); if (live.current) finish(); return; }
      const { actor: uid, events } = nextActor(b);
      await play(events);
      if (uid == null) continue;
      const u = b.units[uid];
      if (u.side === 0 && !autoRef.current) { setBanner(null); setActor(uid); setSel(null); return; }
      await sleep((u.side === 0 ? 150 : 300) * T());
      const c = aiChoose(b, uid);
      await play(act(b, uid, c.move, c.target));
    }
  }, [finish, play, theRun]);

  const fire = useCallback(async (mv: MoveDef, target: number) => {
    const b = bRef.current!;
    if (busy.current || actor == null) return;
    busy.current = true;
    const uid = actor;
    setActor(null); setSel(null);
    await play(act(b, uid, mv.id, target));
    busy.current = false;
    step();
  }, [actor, play, step]);

  useEffect(() => {
    if (save.auto && actor != null && bRef.current && !busy.current) {
      const c = aiChoose(bRef.current, actor);
      const mv = bRef.current.units[actor].moves.find(m => m.id === c.move);
      if (mv) fire(mv, c.target);
    }
  }, [save.auto, actor, fire]);

  /** Set up the next chamber and walk into it: the ground scrolls and the enemies arrive with it. */
  const enterChamber = useCallback(() => {
    const b = mutate(s => startBattle(rng, s, theRun));
    bRef.current = b;
    ua.current = {};
    for (const u of b.units) if (!u.alive) { const a = A(u.uid); a.down.setValue(1); a.fade.setValue(u.side === 0 ? 0.4 : 0); }
    setView(snap(b)); setOrder(turnOrder(b, 8)); setResult(null); setFloats([]); setFx([]);
    setMode('walk');
    setFightNo(n => n + 1);
    const f = theRun.fights[theRun.idx];
    setMusic(f?.boss ? 'boss' : 'battle');
    travel.setValue(0);
    Animated.timing(travel, { toValue: D, duration: 1800, easing: Easing.inOut(Easing.cubic), useNativeDriver: ND }).start(() => {
      if (!live.current) return;
      setMode('fight');
      setOrder(turnOrder(b, 8));
      setTimeout(() => { if (live.current) step(); }, 300);
    });
  }, [D, mutate, step, theRun, travel]);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    enterChamber();
  }, [enterChamber]);

  const fight = theRun.fights[Math.min(theRun.idx, theRun.fights.length - 1)];
  const targets = useMemo(() => (b && actor != null && sel ? validTargets(b, b.units[actor], sel) : []), [b, actor, sel, view]);
  const onTapUnit = (uid: number) => {
    if (actor == null || !sel || !b) return;
    if (targets.includes(uid)) { tap(); fire(sel, uid); }
  };
  const units = b ? [...b.units].sort((x, y) => place(x).feet - place(y).feet) : [];
  const me = b && actor != null ? b.units[actor] : null;
  const allyPick = sel && (sel.target === 'ally' || sel.target === 'allies' || sel.target === 'self' || sel.target === 'fallen' || sel.target === 'allFallen');
  const leave = () => { setMusic('hub'); onExit(); };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={[st.row, { paddingHorizontal: 12, paddingVertical: 6, justifyContent: 'space-between' }]}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.text, fontWeight: '800', fontSize: 15 }} numberOfLines={1}>{theRun.title}</Text>
          <Text style={{ color: C.dim, fontSize: 11 }}>
            {theRun.kind === 'tower' ? `Floor ${theRun.floor}` : theRun.kind === 'raid' && b ? `Actions left: ${Math.max(0, theRun.actionLimit - b.actions[0])}` : theRun.fights.length > 1 ? `Fight ${theRun.idx + 1} of ${theRun.fights.length}` : ''}
            {fight?.boss ? '  ·  Boss' : ''}
          </Text>
        </View>
        <Btn small kind={save.auto ? 'main' : 'ghost'} label={save.auto ? 'Auto on' : 'Auto'} onPress={() => mutate(s => { s.auto = !s.auto; })} />
        <Btn small kind={save.fast ? 'main' : 'ghost'} label={save.fast ? '2x' : '1x'} onPress={() => mutate(s => { s.fast = !s.fast; })} />
        <Btn small kind="ghost" label="Flee" onPress={leave} />
      </View>

      <View style={[st.row, { paddingHorizontal: 10, height: 44, gap: 4 }]}>
        <Text style={{ color: C.dim, fontSize: 10, width: 30 }}>Next</Text>
        {mode === 'fight' && b ? order.map((uid, i) => {
          const u = b.units[uid];
          return (
            <View key={i} style={{ width: i === 0 ? 40 : 34, height: i === 0 ? 40 : 34, borderRadius: 8, borderWidth: 2, borderColor: u.side === 0 ? C.male : C.bad, backgroundColor: C.panel, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <CreatureView ph={u.ph} stage={u.stage} size={i === 0 ? 34 : 28} flip={u.side === 1} shadow={false} />
            </View>
          );
        }) : null}
      </View>

      <View style={{ width: W, height: fieldH, overflow: 'hidden' }}>
        <Backdrop W={W} H={fieldH} sky={theRun.sky} ground={theRun.ground} travel={travel} />

        {b && units.map(u => {
          const v = view[u.uid];
          if (!v) return null;
          const pos = place(u);
          const a = A(u.uid);
          const canPick = targets.includes(u.uid);
          const isActor = actor === u.uid;
          const walking = mode === 'walk' && v.alive && u.side === 0;
          const fallDir = u.side === 0 ? -1 : 1;
          const showBars = v.alive && (mode === 'fight' || u.side === 0);
          return (
            <Animated.View key={u.uid} style={{
              position: 'absolute', left: pos.left, top: pos.top, width: pos.sz, height: pos.sz,
              transform: [
                { translateX: u.side === 1 ? Animated.add(Animated.add(enter, a.ox), a.shake) : Animated.add(a.ox, a.shake) },
                { translateY: Animated.add(a.oy, v.alive && !walking ? bob.interpolate({ inputRange: [0, 1], outputRange: u.uid % 2 ? [0, -3] : [-3, 0] }) : 0) },
              ],
            }}>
              <Pressable onPress={() => onTapUnit(u.uid)} style={{ width: pos.sz, height: pos.sz }}>
                {(canPick || isActor) ? <View pointerEvents="none" style={{ position: 'absolute', left: pos.sz * 0.1, right: pos.sz * 0.1, bottom: -2, height: pos.sz * 0.28, borderRadius: pos.sz, borderWidth: 2.5, borderColor: isActor ? C.gold : allyPick ? C.good : C.bad, backgroundColor: isActor ? 'rgba(245,197,66,0.18)' : 'rgba(255,255,255,0.12)' }} /> : null}
                <Animated.View style={{
                  width: pos.sz, height: pos.sz, opacity: Animated.multiply(a.fade, a.blink),
                  transform: [
                    { translateX: a.down.interpolate({ inputRange: [0, 1], outputRange: [0, fallDir * pos.sz * 0.12] }) },
                    { translateY: a.down.interpolate({ inputRange: [0, 1], outputRange: [0, pos.sz * 0.24] }) },
                    { rotate: a.down.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${fallDir * 90}deg`] }) },
                    { scaleX: a.squash.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) },
                    { scaleY: a.squash.interpolate({ inputRange: [0, 1], outputRange: [1, 0.72] }) },
                  ],
                }}>
                  <Sprite u={u} size={pos.sz} walking={walking} />
                </Animated.View>
                {showBars ? (
                  <View pointerEvents="none" style={{ position: 'absolute', top: -9, left: pos.sz * 0.08, right: pos.sz * 0.08 }}>
                    <Bar frac={v.hp / u.max.hp} color={u.side === 0 ? C.good : C.bad} height={5} />
                    {v.shield > 0 ? <View style={{ marginTop: 1 }}><Bar frac={v.shield / (u.max.hp * 0.6)} color="#9fe8ff" height={3} /></View> : null}
                    <Text style={{ color: '#fff', fontSize: 8, fontWeight: '700', textAlign: 'center', textShadowColor: '#000', textShadowRadius: 2 }} numberOfLines={1}>Lv{u.level} {u.name}</Text>
                  </View>
                ) : null}
                {v.alive && v.statuses.length ? (
                  <View pointerEvents="none" style={{ position: 'absolute', bottom: -9, left: -6, right: -6, flexDirection: 'row', justifyContent: 'center', gap: 2, flexWrap: 'wrap' }}>
                    {v.statuses.slice(0, 4).map(k => (
                      <Text key={k} style={{ fontSize: 7, fontWeight: '800', color: '#fff', backgroundColor: isBuff(k) ? '#2e8b57' : '#a8324a', paddingHorizontal: 2, borderRadius: 3, overflow: 'hidden' }}>{STATUS_TAG[k]}</Text>
                    ))}
                  </View>
                ) : null}
              </Pressable>
            </Animated.View>
          );
        })}

        <FxLayer items={fx} onDone={dropFx} W={W} H={fieldH} />

        {b && floats.map((f, i) => {
          const u = b.units[f.uid];
          if (!u) return null;
          const pos = place(u);
          return <FloatText key={f.id} f={f} x={pos.x} y={pos.top + (i % 3) * 12 - 4} onDone={dropFloat} />;
        })}

        {banner && mode === 'fight' ? (
          <View pointerEvents="none" style={{ position: 'absolute', top: 4, alignSelf: 'center', backgroundColor: banner.color, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 4, borderWidth: 1, borderColor: '#0006' }}>
            <Text style={{ color: readable(banner.color), fontWeight: '800', fontSize: 13 }}>{banner.text}</Text>
          </View>
        ) : null}
        {mode === 'walk' ? (
          <View pointerEvents="none" style={{ position: 'absolute', top: 6, alignSelf: 'center', backgroundColor: '#0008', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 4 }}>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{fightNo <= 1 ? 'Entering...' : fight?.boss ? 'Something big is ahead...' : 'On to the next chamber...'}</Text>
          </View>
        ) : null}
      </View>

      <View style={{ flex: 1, padding: 10 }}>
        {me && b ? (
          <>
            <View style={[st.row, { marginBottom: 6 }]}>
              <Text style={{ color: C.gold, fontWeight: '800', fontSize: 14, flex: 1 }} numberOfLines={1}>{me.name}'s turn</Text>
              <Text style={{ color: C.dim, fontSize: 11 }}>{sel ? (needsPick(sel) ? 'Tap a highlighted target' : '') : 'Pick a move'}</Text>
            </View>
            <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {me.moves.map(mv => {
                const ok = usable(b, me, mv);
                const cd = me.cds[mv.id] ?? 0;
                const e = ELEMENTS[mv.el];
                const on = sel?.id === mv.id;
                return (
                  <Pressable key={mv.id} disabled={!ok} onPress={() => { sfx('select'); setSel(mv); }} style={{ width: (W - 26) / 2, backgroundColor: on ? C.panel2 : C.panel, borderRadius: 10, borderWidth: on ? 2 : 1, borderColor: on ? C.gold : C.line, borderLeftWidth: 6, borderLeftColor: e.base, padding: 7, opacity: ok ? 1 : 0.45 }}>
                    <Text style={{ color: C.text, fontWeight: '800', fontSize: 13 }} numberOfLines={1}>{mv.name}</Text>
                    <Text style={{ color: C.dim, fontSize: 10 }} numberOfLines={1}>{cd > 0 ? `Ready in ${cd}` : !ok ? 'Not usable' : mv.id === 'strike' ? 'Typeless' : e.name}{mv.cd && cd <= 0 ? ` · cd ${mv.cd}` : ''}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {sel ? (
              <View style={[st.row, { marginTop: 6 }]}>
                <Text style={{ color: C.text, fontSize: 12, flex: 1 }}>{sel.desc}</Text>
                {!needsPick(sel) ? <Btn small kind="gold" label="Use" onPress={() => fire(sel, targets[0] ?? -1)} /> : null}
              </View>
            ) : null}
          </>
        ) : (
          <P dim style={{ textAlign: 'center', marginTop: 12 }}>{mode === 'walk' ? '' : save.auto ? 'Auto battle is on.' : result ? '' : 'Waiting...'}</P>
        )}
      </View>

      {result ? (
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: '#000a', justifyContent: 'center', padding: 16 }}>
          <View style={[st.card, { maxHeight: winH * 0.8 }]}>
            <Text style={{ color: result.won ? C.gold : C.bad, fontSize: 22, fontWeight: '900', textAlign: 'center' }}>
              {theRun.kind === 'raid' ? 'Raid attempt over' : result.won ? (result.cleared && theRun.kind === 'area' ? 'Area cleared!' : 'Victory') : 'Defeated'}
            </Text>
            {result.note ? <P style={{ textAlign: 'center', marginTop: 4 }}>{result.note}</P> : null}
            <ScrollView style={{ marginTop: 8 }}>
              {result.xp.map(x => {
                const c = byId(save, x.cid);
                if (!c) return null;
                return (
                  <View key={x.cid} style={{ marginBottom: 5 }}>
                    <Text style={{ color: C.text, fontSize: 13 }}>
                      <Text style={{ fontWeight: '800' }}>{c.name}</Text>  +{x.xp} XP{x.levels ? <Text style={{ color: C.good }}>  Lv {c.level - x.levels} → {c.level}</Text> : null}
                    </Text>
                    {x.newStage != null ? <Text style={{ color: C.gold, fontSize: 12, fontWeight: '700' }}>Grew into {x.newStage === 3 ? 'an' : 'a'} {STAGE_NAMES[x.newStage]}!</Text> : null}
                    {x.learned.map(m => <Text key={m.id} style={{ color: C.accent2, fontSize: 12 }}>Learned {m.name}</Text>)}
                  </View>
                );
              })}
              <LootView title="Drops" loot={result.drops} />
              {result.chest ? <LootView title={theRun.kind === 'raid' ? 'Raid rewards' : 'Boss chest'} loot={result.chest} /> : null}
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              {!result.runOver ? <Btn style={{ flex: 1 }} kind="ghost" label="Leave" onPress={leave} /> : null}
              {!result.runOver
                ? <Btn style={{ flex: 2 }} kind="gold" label={theRun.kind === 'tower' ? `Floor ${theRun.floor}` : theRun.fights[theRun.idx]?.boss ? 'Face the boss' : 'Next fight'} onPress={enterChamber} />
                : <Btn style={{ flex: 1 }} kind="gold" label="Done" onPress={leave} />}
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}
