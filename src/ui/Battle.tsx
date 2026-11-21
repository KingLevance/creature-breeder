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
import { Flair, MoveDef, StatusKind } from '../game/data/moves';
import { Battle, Ev, Unit, act, aiChoose, isBuff, needsPick, nextActor, turnOrder, usable, validTargets } from '../game/battle';
import { STAGE_NAMES } from '../game/creature';
import { express, starRating } from '../game/genome';
import { FightResult, Loot, Run, finishFight, startBattle, emptyLoot } from '../game/run';
import { byId } from '../game/save';
import { castSfx, setMusic, sfx, tap } from './audio';
import { FxLayer, FxNew, FxSpec, StatusFx, isBeam } from './Fx';
import { Bar, Btn, C, CreatureView, hpColor, EggView, LiveCreature, CreatureGround, P, Stars, mixHex, readable, st } from './kit';
import { F, FadeIn, Glow, Grad, Icon, haptic, shadow } from './look';
import type { Pose } from '../render/creature';
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
const STATUS_COLOR: Record<StatusKind, string> = {
  atkUp: '#ff7a59', defUp: '#6fb7ff', haste: '#ffd34d', evade: '#9fe8ff', dodge: '#9fe8ff', regen: '#5ad17a', counter: '#ff9f5a',
  hidden: '#b9b3cc', link: '#ff8fc7', boost: '#b48cff', burn: '#ff7a2a', poison: '#b45cff', stun: '#f3e05a', freeze: '#9fe8ff',
  slow: '#7aa8ff', atkDown: '#ff7a59', defDown: '#6fb7ff', wound: '#d9534f',
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
  /** Lean in degrees (positive = toward the enemy) and a stretch along the body, both pivoting at the feet. */
  lean: Animated.Value; stretch: Animated.Value;
  /** -1 for a fallen teammate left behind: it scrolls away with the ground during the walk. */
  behind: Animated.Value;
  /** A spin about the body's middle, in degrees, for rolling attacks. */
  spin: Animated.Value;
  /**
   * Height off the ground in px, for leaps and hops. Only the body rises: the shadow, ground glow and target ring
   * stay down on the ground (oy is where on the ground the creature stands).
   */
  air: Animated.Value;
}
const newUA = (): UA => ({
  ox: new Animated.Value(0), oy: new Animated.Value(0), shake: new Animated.Value(0), blink: new Animated.Value(1),
  down: new Animated.Value(0), squash: new Animated.Value(0), fade: new Animated.Value(1),
  lean: new Animated.Value(0), stretch: new Animated.Value(1), behind: new Animated.Value(0), spin: new Animated.Value(0),
  air: new Animated.Value(0),
});
const tm = (v: Animated.Value, toValue: number, duration: number, easing?: (t: number) => number) =>
  Animated.timing(v, { toValue, duration: Math.max(1, Math.round(duration)), easing, useNativeDriver: ND });
/** What a creature is doing right now, for its drawing: a pose, running legs, or facing back toward its team. */
interface Act { pose?: Pose; moving?: boolean; turned?: boolean }

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

/** A creature's picture: idles on its own, runs when moving, and shows its current pose. */
const Sprite = memo(function Sprite({ u, size, walking, ko, pose, turned }: { u: Unit; size: number; walking: boolean; ko: boolean; pose?: Pose; turned?: boolean }) {
  // The ground glow is drawn separately, down on the ground, so it stays put when the creature leaps or leans.
  return <LiveCreature ph={u.ph} stage={u.stage} size={size} flip={(u.side === 1) !== !!turned} walking={walking && !ko} ko={ko} pose={ko ? 'idle' : pose} shadow={false} ground={false} />;
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

/** Loot as a row of small icon chips. */
function LootChips({ loot, eggs }: { loot: Loot; eggs?: number }) {
  const items: [React.ReactNode, string, string][] = [];
  if (loot.gold) items.push([<Icon key="g" name="coin" size={15} />, String(loot.gold), '#ffd34d']);
  if (loot.dust) items.push([<Icon key="d" name="sparkle" size={14} color="#e8d9b0" />, `${loot.dust} dust`, '#e8d9b0']);
  if (loot.shard) items.push([<Icon key="s" name="gem" size={14} />, `${loot.shard} shard${loot.shard > 1 ? 's' : ''}`, '#c9b8ff']);
  if (loot.core) items.push([<Icon key="c" name="bolt" size={14} color="#7fe8b0" />, `${loot.core} core${loot.core > 1 ? 's' : ''}`, '#7fe8b0']);
  if (loot.scans) items.push([<Icon key="l" name="scan" size={14} color="#9fe8ff" />, `${loot.scans} lens`, '#9fe8ff']);
  if (loot.essence) items.push([<Icon key="e" name="gem" size={14} />, `${loot.essence} essence`, '#c9b8ff']);
  const n = eggs ?? loot.eggs.length;
  if (n) items.push([<Icon key="egg" name="egg" size={14} color="#ffd34d" accent="#b4721a" />, `${n} egg${n > 1 ? 's' : ''}`, '#ffd34d']);
  if (!items.length) return <P dim>Nothing yet.</P>;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {items.map(([icon, text, color], i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(10,6,22,0.5)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
          <View>{icon}</View>
          <Text style={{ color, fontFamily: F.semi, fontSize: 13 }}>{text}</Text>
        </View>
      ))}
    </View>
  );
}

const addLoot = (a: Loot, b: Loot | null): Loot => (b ? {
  gold: a.gold + b.gold, dust: a.dust + b.dust, shard: a.shard + b.shard, core: a.core + b.core, scans: a.scans + b.scans, essence: a.essence + b.essence, eggs: [...a.eggs, ...b.eggs],
} : a);

/** The countdown to the next fight, as a bar that drains. */
function Countdown({ ms }: { ms: number }) {
  const t = useRef(new Animated.Value(1)).current;
  useEffect(() => { Animated.timing(t, { toValue: 0, duration: ms, easing: Easing.linear, useNativeDriver: false }).start(); }, [t, ms]);
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: '#120d20', overflow: 'hidden', marginTop: 10 }}>
      <Animated.View style={{ height: 6, borderRadius: 3, backgroundColor: C.gold, width: t.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
    </View>
  );
}

export function LootView({ title, loot }: { title: string; loot: Loot }) {
  const text = lootLines(loot);
  if (!text && !loot.eggs.length) return null;
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={{ color: C.gold, fontFamily: F.bold, fontSize: 15 }}>{title}</Text>
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
  /** Everything won so far this run, and fights won, for the auto-battle panel. */
  const [runLoot, setRunLoot] = useState<Loot>(emptyLoot());
  const [wins, setWins] = useState(0);
  const [mode, setMode] = useState<'walk' | 'fight'>('walk');
  const [fightNo, setFightNo] = useState(0);
  const [acts, setActs] = useState<Record<number, Act>>({});
  /** Teammates who fell in an earlier chamber and were left behind. */
  const [leftBehind, setLeftBehind] = useState<number[]>([]);
  const setAct = useCallback((uid: number, patch: Act | null) => setActs(m => ({ ...m, [uid]: patch ? { ...m[uid], ...patch } : {} })), []);
  /** Hold a pose for a moment, then go back to idle. */
  const flashPose = useCallback((uid: number, pose: Pose, ms: number) => {
    setAct(uid, { pose });
    setTimeout(() => setActs(m => (m[uid]?.pose === pose ? { ...m, [uid]: { ...m[uid], pose: undefined } } : m)), ms);
  }, [setAct]);
  const nextId = useRef(0);
  const ua = useRef<Record<number, UA>>({});
  const travel = useRef(new Animated.Value(0)).current;
  /** The whole field shakes on heavy blows. */
  const quake = useRef(new Animated.Value(0)).current;
  const shakeField = useCallback((p: number) => {
    Animated.sequence([p, -p * 0.8, p * 0.55, -p * 0.3, p * 0.12, 0].map(v => tm(quake, v, 42))).start();
  }, [quake]);
  const busy = useRef(false);
  const D = W * 0.95; // how far the camera travels between chambers
  const enter = useMemo(() => Animated.subtract(D, travel), [D, travel]);

  const A = (uid: number) => (ua.current[uid] ??= newUA());
  /** Squash on landing, then spring back. */
  const land = (a: UA) => Animated.sequence([tm(a.stretch, 0.78, 70), Animated.spring(a.stretch, { toValue: 1, friction: 3, tension: 180, useNativeDriver: ND })]).start();
  /** Come down from a leap: squash flat, rebound in a little hop, and settle with a wobble. */
  const touchdown = (a: UA, hop: number, lean = 0) => Animated.parallel([
    Animated.sequence([tm(a.stretch, 0.68, 60, Easing.out(Easing.quad)), Animated.spring(a.stretch, { toValue: 1, friction: 3.2, tension: 170, useNativeDriver: ND })]),
    Animated.sequence([Animated.delay(50), tm(a.air, hop, 120, Easing.out(Easing.quad)), tm(a.air, 0, 130, Easing.in(Easing.quad))]),
    Animated.sequence([Animated.delay(60), Animated.spring(a.lean, { toValue: lean, friction: 4, tension: 120, useNativeDriver: ND })]),
  ]).start();
  /** A quick knock backward, for a creature that takes a hit. */
  const jolt = (uid: number, dir: number, px: number) => {
    const a = A(uid);
    Animated.sequence([tm(a.shake, dir * px, 45, Easing.out(Easing.quad)), Animated.spring(a.shake, { toValue: 0, friction: 4, tension: 160, useNativeDriver: ND })]).start();
  };
  const T = () => (fastRef.current ? 0.5 : 1);

  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

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
    // Everyone who faints dissolves in a puff. Fallen teammates leave a ghost marker for revive moves.
    await sleep(180 * T());
    sfx('poof');
    addFx({ kind: 'puff', x: p.x, y: p.feet - p.sz * 0.3, color: ELEMENTS[u.ph.el1].light });
    Animated.timing(a.fade, { toValue: 0, duration: 420, useNativeDriver: ND }).start();
    if (u.side === 0) setLeftBehind(l => (l.includes(u.uid) ? l : [...l, u.uid]));
  }, [addFx, place]);

  const reviveAnim = useCallback(async (u: Unit) => {
    const a = A(u.uid);
    const p = place(u);
    sfx('revive');
    // It comes back to its spot under a beam of light.
    {
      a.fade.setValue(0); a.behind.setValue(0); a.ox.setValue(0); a.down.setValue(1);
      setLeftBehind(l => l.filter(x => x !== u.uid));
      addFx({ kind: 'beam', el: 'radiant', x1: p.x, y1: -20, x2: p.x, y2: p.feet, dur: 520 });
      await sleep(220);
      addFx({ kind: 'puff', x: p.x, y: p.feet - 6, color: '#fff6c8' });
    }
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
    /** Where the melee attacker struck from, so it can bounce off the hit. */
    let meleeAt = { tx: 0, dir: 1 };
    let followed = false;
    let attackerX: number | null = null;
    let attackerSide = -1;
    let statusSound = false;
    let lastStyle = '';
    let lastBig = false;
    let launch = false;
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
          const big = e.rarity >= 2;
          lastStyle = e.style; lastBig = big;
          if (e.style === 'melee' && targets[0]) {
            const pt = place(targets[0]);
            const u0 = b.units[e.u];
            const tx = pt.x - dir * (pt.sz * 0.42 + pa.sz * 0.36) - pa.x;
            const ty = pt.feet - pa.feet + 2;
            melee = e.u;
            meleeAt = { tx, dir };
            followed = false;
            const runTo = async (ms = 300) => {
              setAct(e.u, { moving: true });
              await run(Animated.parallel([tm(a.ox, tx, ms * T(), Easing.inOut(Easing.quad)), tm(a.oy, ty, ms * T(), Easing.inOut(Easing.quad)), tm(a.lean, 8, 200 * T())]));
              setAct(e.u, { moving: false });
            };
            // Wind up: lean back and crouch.
            const windUp = (ms = 130) => run(Animated.parallel([tm(a.lean, -14, ms * T(), Easing.out(Easing.quad)), tm(a.stretch, 0.88, ms * T()), tm(a.ox, tx - dir * 6, ms * T())]));
            // Strike: snap forward with the attack pose.
            const strike = (push = 16, ms = 80) => {
              setAct(e.u, { pose: 'attack' });
              sfx('swing');
              return run(Animated.parallel([tm(a.lean, 18, ms, Easing.out(Easing.quad)), tm(a.stretch, 1.14, ms), tm(a.ox, tx + dir * push, ms, Easing.out(Easing.quad))]));
            };
            switch (e.flair as Flair) {
              case 'pounce': {
                // Coil up at home (a slow sink, then a quick last squeeze), then leap the whole way in one arc and
                // come down on the target. The body tips to follow the arc: nose up on the way up, level at the top,
                // diving at the end.
                await run(Animated.parallel([
                  Animated.sequence([tm(a.stretch, 0.84, 150 * T(), Easing.out(Easing.quad)), tm(a.stretch, 0.72, 70 * T(), Easing.in(Easing.quad))]),
                  tm(a.lean, -14, 220 * T(), Easing.out(Easing.quad)), tm(a.ox, -dir * 6, 220 * T(), Easing.out(Easing.quad)),
                ]));
                setAct(e.u, { pose: 'attack' });
                sfx('swing');
                addFx({ kind: 'puff', x: pa.x, y: pa.feet - 6 });
                const hang = 420 * T(), peak = Math.max(Math.min(ty, 0) - fieldH * 0.3, -pa.top - pa.sz * 0.25);
                // The feet travel along the ground to the target while the body arcs high above them.
                const high = Math.max(pa.sz * 0.3, ty / 2 - peak);
                await run(Animated.parallel([
                  tm(a.ox, tx + dir * 8, hang, Easing.linear),
                  tm(a.oy, ty, hang, Easing.inOut(Easing.sin)),
                  Animated.sequence([tm(a.air, high, hang * 0.5, Easing.out(Easing.quad)), tm(a.air, 0, hang * 0.5, Easing.in(Easing.quad))]),
                  Animated.sequence([tm(a.stretch, 1.24, hang * 0.18, Easing.out(Easing.quad)), tm(a.stretch, 0.94, hang * 0.34, Easing.inOut(Easing.sin)), tm(a.stretch, 1.16, hang * 0.48, Easing.in(Easing.quad))]),
                  Animated.sequence([tm(a.lean, -18, hang * 0.22, Easing.out(Easing.quad)), tm(a.lean, 4, hang * 0.36, Easing.inOut(Easing.sin)), tm(a.lean, 32, hang * 0.42, Easing.in(Easing.quad))]),
                ]));
                addFx({ kind: 'shock', el: e.el, x: pt.x - dir * pt.sz * 0.2, y: pt.feet, w: pt.sz * 1.3 });
                touchdown(a, pa.sz * 0.1, 12);
                shakeField(5);
                break;
              }
              case 'slam': {
                await runTo();
                // Crouch, spring up high with a stretch, curl and rear back at the top, then dive and come down hard.
                await run(Animated.parallel([tm(a.stretch, 0.76, 110 * T(), Easing.out(Easing.quad)), tm(a.lean, 2, 110 * T())]));
                setAct(e.u, { pose: 'cast' });
                addFx({ kind: 'puff', x: pa.x + tx, y: pa.feet + ty - 6 });
                const up = Math.max(pa.sz * 0.3, Math.min(pa.sz * 0.8, pa.top + ty + pa.sz * 0.25));
                await run(Animated.parallel([
                  tm(a.air, up, 260 * T(), Easing.out(Easing.cubic)),
                  Animated.sequence([tm(a.stretch, 1.22, 110 * T(), Easing.out(Easing.quad)), tm(a.stretch, 0.92, 150 * T(), Easing.inOut(Easing.sin))]),
                  tm(a.lean, -16, 260 * T(), Easing.out(Easing.quad)), tm(a.ox, tx - dir * 2, 260 * T(), Easing.out(Easing.quad)),
                ]));
                // A beat of hang time, drifting a touch higher.
                await run(Animated.parallel([tm(a.air, up + 6, 90 * T(), Easing.inOut(Easing.sin)), tm(a.lean, -20, 90 * T(), Easing.inOut(Easing.sin))]));
                setAct(e.u, { pose: 'attack' });
                sfx('swing');
                await run(Animated.parallel([tm(a.air, 0, 120, Easing.in(Easing.cubic)), tm(a.lean, 26, 120, Easing.in(Easing.quad)), tm(a.stretch, 1.2, 120), tm(a.ox, tx + dir * 12, 120)]));
                addFx({ kind: 'shock', el: e.el, x: pt.x, y: pt.feet, w: pt.sz * 1.7 });
                touchdown(a, pa.sz * 0.08, 10);
                shakeField(big ? 11 : 7);
                break;
              }
              case 'slash':
                await runTo();
                await windUp();
                if (Math.random() < 0.5) {
                  await strike(24, 90);
                  addFx({ kind: 'slash', el: e.el, x: pt.x, y: pt.midY, dir, n: 3, s: pt.sz * 0.95 });
                } else {
                  // A crossing X: one cut each way.
                  await strike(18, 80);
                  addFx({ kind: 'slash', el: e.el, x: pt.x, y: pt.midY, dir, n: 1, s: pt.sz * 1.1 });
                  setAct(e.u, { pose: 'cast' });
                  sfx('swing');
                  await run(Animated.parallel([tm(a.lean, -6, 70), tm(a.ox, tx + dir * 4, 70)]));
                  setAct(e.u, { pose: 'attack' });
                  await run(Animated.parallel([tm(a.lean, 20, 80, Easing.out(Easing.quad)), tm(a.ox, tx + dir * 22, 80)]));
                  addFx({ kind: 'slash', el: e.el, x: pt.x, y: pt.midY, dir: -dir, n: 1, s: pt.sz * 1.1 });
                }
                break;
              case 'bite':
                await runTo();
                await windUp(150);
                addFx({ kind: 'chomp', x: pt.x - dir * pt.sz * 0.05, y: pt.midY, s: pt.sz * 0.64 });
                await strike(12, 100);
                break;
              case 'flurry': {
                await runTo();
                for (let i = 0; i < 4; i++) {
                  setAct(e.u, { pose: i % 2 ? 'cast' : 'attack' });
                  sfx('swing');
                  await run(Animated.parallel([tm(a.ox, tx + dir * (10 + (i % 2) * 8), 60), tm(a.lean, 12 + (i % 2) * 10, 60), tm(a.stretch, 1.08, 60)]));
                  addFx({ kind: 'impact', el: e.el, x: pt.x - dir * pt.sz * 0.15 + (i % 2 ? 7 : -7), y: pt.midY + (i - 1.5) * 9 });
                  jolt(targets[0].uid, dir, 5);
                  await run(Animated.parallel([tm(a.ox, tx - dir * 3, 70), tm(a.lean, -4, 70), tm(a.stretch, 0.95, 70)]));
                }
                await strike(22, 80);
                break;
              }
              case 'roll': {
                // Curl up and roll in like a wheel, with a whirl of wind around the hit.
                await run(Animated.parallel([tm(a.stretch, 0.84, 130 * T()), tm(a.lean, -8, 130 * T())]));
                sfx('swing');
                addFx({ kind: 'streak', el: e.el, x1: pa.x, x2: pt.x - dir * pt.sz * 0.3, y: pa.midY + ty * 0.5, h: pa.sz * 0.5 });
                await run(Animated.parallel([
                  tm(a.ox, tx + dir * 10, 340 * T(), Easing.in(Easing.quad)), tm(a.oy, ty, 340 * T()),
                  tm(a.spin, 720, 340 * T(), Easing.in(Easing.quad)), tm(a.lean, 0, 120 * T()), tm(a.stretch, 0.92, 120 * T()),
                ]));
                a.spin.setValue(0);
                addFx({ kind: 'whirl', el: e.el, x: pt.x - dir * pt.sz * 0.15, y: pt.midY, r: pt.sz * 0.5 });
                await strike(18, 70);
                break;
              }
              case 'dash': {
                // Blink across in a blur and cut straight through, stopping on the far side.
                await run(Animated.parallel([tm(a.lean, -10, 120 * T()), tm(a.stretch, 0.86, 120 * T())]));
                const past = pt.x + dir * pt.sz * 0.55 - pa.x;
                meleeAt = { tx: past + dir * 16, dir };
                sfx('swing');
                addFx({ kind: 'streak', el: e.el, x1: pa.x, x2: pt.x + dir * pt.sz * 0.55, y: pa.midY + ty * 0.5, h: pa.sz * 0.6 });
                setAct(e.u, { pose: 'attack' });
                await run(Animated.parallel([tm(a.blink, 0.25, 40), tm(a.ox, past, 90, Easing.out(Easing.cubic)), tm(a.oy, ty, 90), tm(a.lean, 20, 90), tm(a.stretch, 1.15, 90)]));
                tm(a.blink, 1, 140).start();
                addFx({ kind: 'slash', el: e.el, x: pt.x, y: pt.midY, dir, n: 1, s: pt.sz * 1.35 });
                await sleep(100);
                break;
              }
              case 'touch':
                // Drift over, half-faded like a ghost, and lay a chilling hand on the target.
                await run(Animated.parallel([
                  tm(a.blink, 0.5, 200 * T()), tm(a.ox, tx, 380 * T(), Easing.inOut(Easing.sin)),
                  tm(a.oy, ty, 380 * T(), Easing.inOut(Easing.sin)),
                  Animated.sequence([tm(a.air, 16, 190 * T(), Easing.out(Easing.quad)), tm(a.air, 0, 190 * T(), Easing.in(Easing.quad))]),
                  tm(a.lean, 10, 300 * T()),
                ]));
                setAct(e.u, { pose: 'attack' });
                sfx(castSfx(e.el));
                addFx({ kind: 'charge', el: e.el, x: pt.x, y: pt.midY });
                await run(Animated.parallel([tm(a.ox, tx + dir * 14, 130), tm(a.blink, 1, 170)]));
                break;
              default: {
                await runTo();
                const v = Math.random();
                if (v < 0.25) {
                  // Headbutt: rear back, then drive in head first.
                  await run(Animated.parallel([tm(a.lean, -20, 150 * T(), Easing.out(Easing.quad)), tm(a.stretch, 0.84, 150 * T()), tm(a.ox, tx - dir * 8, 150 * T())]));
                  setAct(e.u, { pose: 'roar' });
                  sfx('swing');
                  await run(Animated.parallel([tm(a.lean, 32, 90, Easing.out(Easing.quad)), tm(a.stretch, 1.2, 90), tm(a.ox, tx + dir * 18, 90, Easing.out(Easing.quad))]));
                } else if (v < 0.5) {
                  // Uppercut: crouch, then spring up through the target and launch it.
                  await run(Animated.parallel([tm(a.stretch, 0.78, 130 * T(), Easing.out(Easing.quad)), tm(a.lean, 8, 130 * T()), tm(a.ox, tx - dir * 2, 130 * T())]));
                  setAct(e.u, { pose: 'cast' });
                  sfx('swing');
                  // Spring up through the target, head tipping back as it rises, then drift down and land.
                  await run(Animated.parallel([tm(a.air, pa.sz * 0.26, 120, Easing.out(Easing.cubic)), tm(a.stretch, 1.24, 90, Easing.out(Easing.quad)), tm(a.lean, -12, 120, Easing.out(Easing.quad)), tm(a.ox, tx + dir * 12, 120, Easing.out(Easing.quad))]));
                  launch = true;
                  Animated.sequence([
                    Animated.parallel([tm(a.air, pa.sz * 0.29, 80, Easing.out(Easing.sin)), tm(a.stretch, 1, 80)]),
                    tm(a.air, 0, 200, Easing.in(Easing.quad)),
                  ]).start(({ finished }) => { if (finished) touchdown(a, 0, 0); });
                } else if (v < 0.7 && u0.ph.tail !== 'stub') {
                  // Tail swipe: a quick spin on the spot, the tail sweeping through the target.
                  sfx('swing');
                  for (let i = 0; i < 4; i++) { setAct(e.u, { turned: i % 2 === 0 }); await sleep(55); }
                  addFx({ kind: 'whirl', el: e.el, x: pa.x + tx + dir * pa.sz * 0.15, y: pa.feet + ty - pa.sz * 0.25, r: pa.sz * 0.5 });
                  addFx({ kind: 'slash', el: e.el, x: pt.x, y: pt.feet - pt.sz * 0.22, dir, n: 1, s: pt.sz * 1.2 });
                  setAct(e.u, { turned: false, pose: 'attack' });
                  await run(Animated.parallel([tm(a.ox, tx + dir * 12, 80), tm(a.lean, 10, 80)]));
                } else {
                  await windUp();
                  await strike();
                }
              }
            }
          } else if (e.style === 'ranged') {
            sfx(castSfx(e.el));
            const mouthX = pa.x + dir * pa.sz * 0.3, mouthY = pa.midY - pa.sz * 0.1;
            // Rare and legendary moves gather power first.
            if (big) {
              flashPose(e.u, 'cast', 420);
              addFx({ kind: 'charge', el: e.el, x: pa.x, y: pa.midY });
              await sleep(240 * T());
            }
            const recoil = () => Animated.sequence([
              Animated.parallel([tm(a.lean, -8, 90), tm(a.stretch, 0.92, 90)]),
              Animated.parallel([tm(a.lean, 10, 80), tm(a.stretch, 1.08, 80), tm(a.ox, dir * 8, 80)]),
              Animated.parallel([tm(a.lean, 0, 200), tm(a.stretch, 1, 200), tm(a.ox, 0, 200)]),
            ]).start();
            const flair = e.flair as Flair;
            let wait = 0;
            if (flair === 'bolt') {
              // Call lightning, or a pillar of light, down from the sky.
              flashPose(e.u, 'cast', 500);
              Animated.sequence([tm(a.air, 10, 120, Easing.out(Easing.quad)), tm(a.air, 0, 160, Easing.in(Easing.quad))]).start();
              await sleep(160 * T());
              targets.forEach((t, i) => setTimeout(() => { const p2 = place(t); addFx({ kind: 'bolt', el: e.el, x: p2.x, y: p2.feet - p2.sz * 0.08 }); }, i * 80));
              addFx({ kind: 'flash', color: ELEMENTS[e.el].glow });
              shakeField(4);
              wait = 140 + targets.length * 80;
            } else if (flair === 'erupt') {
              // Stamp the ground, and it bursts up under the target.
              flashPose(e.u, 'cast', 450);
              Animated.sequence([tm(a.air, 12, 110, Easing.out(Easing.quad)), tm(a.air, 0, 110, Easing.in(Easing.quad))]).start();
              await sleep(220 * T());
              land(a);
              shakeField(3);
              targets.forEach((t, i) => setTimeout(() => { const p2 = place(t); addFx({ kind: 'erupt', el: e.el, x: p2.x, y: p2.feet + 2, s: p2.sz * 0.85 }); }, i * 70));
              wait = 180 + targets.length * 70;
            } else if (flair === 'breath') {
              flashPose(e.u, 'attack', 520);
              Animated.sequence([tm(a.lean, -10, 110), tm(a.lean, 8, 120), tm(a.lean, 0, 300)]).start();
              await sleep(110);
              for (const t of targets) { const p2 = place(t); addFx({ kind: 'breath', el: e.el, x1: mouthX, y1: mouthY, x2: p2.x, y2: p2.midY, dur: 520 * T() }); }
              wait = 300 * T();
            } else if (flair === 'wave') {
              flashPose(e.u, 'attack', 400);
              recoil();
              await sleep(120);
              let longest = 0;
              for (const t of targets) {
                const p2 = place(t), dur = Math.round(Math.min(520, 220 + Math.abs(p2.x - pa.x) * 0.7) * T());
                addFx({ kind: 'wave', el: e.el, x1: pa.x + dir * pa.sz * 0.35, x2: p2.x, y: p2.feet + 2, s: Math.max(p2.sz, pa.sz) * 0.7, dur });
                longest = Math.max(longest, dur);
              }
              wait = longest * 0.85;
            } else {
              if (!big) flashPose(e.u, 'cast', 450);
              recoil();
              await sleep(150);
              for (const t of targets) {
                const p2 = place(t);
                const x1 = mouthX, y1 = pa.midY, x2 = p2.x, y2 = p2.midY;
                const dur = Math.round(Math.min(380, 160 + Math.abs(x2 - x1) * 0.5) * T());
                if (flair === 'beam' || (flair === 'proj' && isBeam(e.el))) {
                  addFx({ kind: 'beam', el: e.el, x1, y1, x2, y2, dur: dur + 120 });
                  wait = Math.max(wait, 90);
                } else if (flair === 'volley') {
                  // A spread of smaller shots, one after another.
                  for (let k = 0; k < 4; k++) setTimeout(() => addFx({ kind: 'proj', el: e.el, x1, y1: y1 + (k - 1.5) * 7, x2: x2 + (k % 2 ? 5 : -5), y2: y2 + (k - 1.5) * 9, dur: Math.round(dur * 0.85) }), k * 75 * T());
                  wait = Math.max(wait, dur * 0.85 + 3 * 75 * T());
                } else {
                  addFx({ kind: 'proj', el: e.el, x1, y1, x2, y2, dur });
                  wait = Math.max(wait, dur);
                }
              }
            }
            await sleep(wait);
          } else if (e.style === 'area') {
            sfx(castSfx(e.el));
            flashPose(e.u, 'cast', 650);
            Animated.sequence([
              tm(a.stretch, 0.86, 220 * T()),
              Animated.spring(a.stretch, { toValue: 1, friction: 3, tension: 160, useNativeDriver: ND }),
            ]).start();
            addFx({ kind: 'charge', el: e.el, x: pa.x, y: pa.midY });
            await sleep(240 * T());
            const flair = e.flair as Flair;
            if (flair === 'rain') {
              // Meteors, hail, stars or shards come down from the sky on every target.
              targets.forEach((t, i) => {
                const p2 = place(t);
                for (let k = 0; k < 3; k++) setTimeout(() => addFx({ kind: 'proj', el: e.el, x1: p2.x - dir * 50 + (k - 1) * 22, y1: -30, x2: p2.x + (k - 1) * 12, y2: p2.midY + (k - 1) * 6, dur: Math.round(300 * T()) }), (i * 50 + k * 90) * T());
              });
              await sleep((300 + 180) * T());
            } else if (flair === 'quake') {
              // Leap and stamp: the ground heaves under the whole enemy side.
              await run(Animated.sequence([tm(a.air, 20, 140 * T(), Easing.out(Easing.quad)), tm(a.air, 0, 110, Easing.in(Easing.quad))]));
              land(a);
              shakeField(10);
              targets.forEach((t, i) => setTimeout(() => { const p2 = place(t); addFx({ kind: 'shock', el: e.el, x: p2.x, y: p2.feet, w: p2.sz * 1.5 }); }, i * 60));
              await sleep(140 * T());
            } else if (flair === 'sweep') {
              // A wave, a gale or a cloud rolls across the whole enemy side.
              let longest = 0;
              for (const t of targets) {
                const p2 = place(t), dur = Math.round(Math.min(620, 260 + Math.abs(p2.x - pa.x) * 0.8) * T());
                addFx({ kind: 'wave', el: e.el, x1: pa.x + dir * pa.sz * 0.3, x2: p2.x + dir * p2.sz * 0.6, y: p2.feet + 2, s: p2.sz * 0.85, dur });
                longest = Math.max(longest, dur);
              }
              await sleep(longest * 0.7);
            } else if (flair === 'storm') {
              targets.forEach((t, i) => setTimeout(() => { const p2 = place(t); addFx({ kind: 'bolt', el: e.el, x: p2.x, y: p2.feet - p2.sz * 0.08 }); }, i * 90));
              addFx({ kind: 'flash', color: ELEMENTS[e.el].glow });
              shakeField(5);
              await sleep(160 + targets.length * 90);
            } else {
              targets.forEach((t, i) => setTimeout(() => { const p2 = place(t); addFx({ kind: 'burst', el: e.el, x: p2.x, y: p2.midY, big: true }); }, i * 45));
              await sleep(120 * T());
            }
          } else {
            sfx(e.heal ? 'heal' : castSfx(e.el) === 'magic' ? 'magic' : 'buff');
            flashPose(e.u, e.heal || !targets.some(t => t.side === b.units[e.u].side) ? 'cast' : 'roar', 500);
            Animated.sequence([
              tm(a.air, 12, 120, Easing.out(Easing.quad)),
              tm(a.air, 0, 160, Easing.in(Easing.quad)),
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
          if (e.from >= 0 && lastStyle === 'melee' && melee != null && !followed) {
            // Follow-through: the attacker rebounds off the hit and settles, instead of freezing mid-strike.
            followed = true;
            const am = A(melee), mu = melee;
            setTimeout(() => setActs(m => (m[mu]?.pose === 'attack' || m[mu]?.pose === 'roar' || m[mu]?.pose === 'cast' ? { ...m, [mu]: { ...m[mu], pose: undefined } } : m)), 90);
            Animated.parallel([
              Animated.spring(am.ox, { toValue: meleeAt.tx - meleeAt.dir * 10, friction: 6, tension: 90, useNativeDriver: ND }),
              Animated.sequence([tm(am.lean, -7, 120, Easing.out(Easing.quad)), Animated.spring(am.lean, { toValue: 0, friction: 5, tension: 110, useNativeDriver: ND })]),
              Animated.spring(am.stretch, { toValue: 1, friction: 4, tension: 140, useNativeDriver: ND }),
              tm(am.blink, 1, 120),
            ]).start();
          }
          if (e.from >= 0 && lastStyle === 'melee') {
            addFx({ kind: 'impact', el: moveEl, x: pt.x - (t.side === 0 ? -1 : 1) * pt.sz * 0.12, y: pt.midY, big: e.mult > 1 || lastBig });
            addFx({ kind: 'burst', el: moveEl, x: pt.x, y: pt.midY });
            jolt(e.u, t.side === 0 ? -1 : 1, e.mult > 1 || lastBig ? 14 : 8);
          } else if (e.from >= 0) addFx({ kind: 'burst', el: moveEl, x: pt.x, y: pt.midY, big: e.mult > 1 });
          if (e.from >= 0 && (e.mult > 1 || e.n > t.max.hp * 0.3)) shakeField(e.mult > 1 ? 6 : 4);
          if (launch && t.alive) {
            launch = false;
            const ta = A(e.u);
            Animated.sequence([tm(ta.air, pt.sz * 0.3, 160, Easing.out(Easing.quad)), tm(ta.air, 0, 200, Easing.in(Easing.quad)), tm(ta.air, pt.sz * 0.06, 90, Easing.out(Easing.quad)), tm(ta.air, 0, 90, Easing.in(Easing.quad))]).start();
          }
          if (e.shield > 0 && t.alive) addFx({ kind: 'shieldUp', x: pt.x, y: pt.midY, s: pt.sz });
          sfx(e.mult > 1 || e.n > t.max.hp * 0.3 ? 'hitBig' : 'hit');
          const a = A(e.u);
          if (t.alive) flashPose(e.u, e.shield >= e.n ? 'guard' : 'hurt', 320);
          Animated.sequence([
            Animated.timing(a.lean, { toValue: -10, duration: 60, useNativeDriver: ND }),
            Animated.spring(a.lean, { toValue: 0, friction: 4, tension: 140, useNativeDriver: ND }),
          ]).start();
          Animated.sequence([
            Animated.timing(a.shake, { toValue: 7, duration: 40, useNativeDriver: ND }), Animated.timing(a.shake, { toValue: -6, duration: 50, useNativeDriver: ND }),
            Animated.timing(a.shake, { toValue: 3, duration: 40, useNativeDriver: ND }), Animated.timing(a.shake, { toValue: 0, duration: 40, useNativeDriver: ND }),
          ]).start();
          Animated.sequence([
            Animated.timing(a.blink, { toValue: 0.45, duration: 50, useNativeDriver: ND }), Animated.timing(a.blink, { toValue: 1, duration: 90, useNativeDriver: ND }),
          ]).start();
          await sleep((lastStyle === 'melee' ? 190 : 200) * T());
          break;
        }
        case 'miss': {
          addFloat(e.u, 'Dodged', '#9fe8ff');
          sfx('miss');
          flashPose(e.u, 'guard', 450);
          const a = A(e.u);
          const dir = b.units[e.u].side === 0 ? -1 : 1;
          Animated.sequence([
            tm(a.air, 16, 110, Easing.out(Easing.quad)),
            tm(a.air, 0, 140, Easing.in(Easing.quad)),
          ]).start();
          Animated.sequence([
            Animated.timing(a.ox, { toValue: dir * 14, duration: 110, useNativeDriver: ND }),
            Animated.timing(a.ox, { toValue: 0, duration: 160, useNativeDriver: ND }),
          ]).start();
          await sleep(200 * T());
          break;
        }
        case 'heal': if (e.n > 0) {
          patch(e.u, v => ({ ...v, hp: v.hp + e.n }));
          addFloat(e.u, `+${e.n}`, C.good);
          const p2 = place(b.units[e.u]);
          addFx({ kind: 'heal', x: p2.x, y: p2.midY, s: p2.sz, color: C.good });
          flashPose(e.u, 'happy', 650);
          await sleep(120 * T());
        } break;
        case 'shield': if (e.n > 0) {
          patch(e.u, v => ({ ...v, shield: v.shield + e.n }));
          addFloat(e.u, 'Shield', '#9fe8ff');
          sfx('shield');
          const p2 = place(b.units[e.u]);
          addFx({ kind: 'shieldUp', x: p2.x, y: p2.midY, s: p2.sz });
          flashPose(e.u, 'guard', 600);
          await sleep(110 * T());
        } break;
        case 'status':
          patch(e.u, v => (v.statuses.includes(e.k) ? v : { ...v, statuses: [...v.statuses, e.k] }));
          addFloat(e.u, STATUS_WORD[e.k], isBuff(e.k) ? '#9fe8a0' : '#f3a5ff');
          {
            const p2 = place(b.units[e.u]);
            addFx({ kind: 'stat', x: p2.x, y: p2.midY, s: p2.sz, color: STATUS_COLOR[e.k], up: isBuff(e.k) });
            if (isBuff(e.k)) flashPose(e.u, 'roar', 450);
          }
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
      const m = melee;
      if (bRef.current!.units[m].alive) {
        a.spin.setValue(0);
        // Turn with a little squash so the flip reads as a turn, then run home leaning into it.
        setAct(m, { pose: undefined, turned: true, moving: true });
        Animated.sequence([tm(a.stretch, 0.9, 70), Animated.spring(a.stretch, { toValue: 1, friction: 4, tension: 160, useNativeDriver: ND })]).start();
        tm(a.blink, 1, 120).start();
        await run(Animated.parallel([
          Animated.timing(a.ox, { toValue: 0, duration: 340 * T(), easing: Easing.inOut(Easing.cubic), useNativeDriver: ND }),
          Animated.timing(a.oy, { toValue: 0, duration: 340 * T(), easing: Easing.inOut(Easing.cubic), useNativeDriver: ND }),
          tm(a.air, 0, 160 * T(), Easing.in(Easing.quad)),
          Animated.sequence([tm(a.lean, 6, 120 * T(), Easing.out(Easing.quad)), tm(a.lean, 0, 220 * T(), Easing.inOut(Easing.quad))]),
        ]));
        // Arrive: turn back to face the fight and settle.
        setAct(m, { turned: false, moving: false });
        Animated.sequence([tm(a.stretch, 0.88, 70), Animated.spring(a.stretch, { toValue: 1, friction: 3.5, tension: 150, useNativeDriver: ND })]).start();
      } else setAct(m, null);
    }
    if (live.current) { setView(snap(b)); setOrder(turnOrder(b, 8)); }
  }, [addFloat, addFx, faintAnim, place, reviveAnim, shakeField, fieldH]);

  const finish = useCallback(() => {
    const b = bRef.current!;
    if (b.over == null) b.over = 0; // raid: out of actions
    const res = mutate(s => finishFight(rng, s, theRun, b, Date.now()));
    setRunLoot(l => addLoot(addLoot(l, res.drops), res.chest));
    if (res.won) setWins(w => w + 1);
    setBanner(null); setActor(null); setSel(null);
    setMusic(null);
    sfx(theRun.kind === 'raid' || res.won ? 'victory' : 'defeat');
    if (res.chest) setTimeout(() => sfx('chest'), 900);
    if (res.xp.some(x => x.newStage != null)) setTimeout(() => sfx('grow'), 1400);
    else if (res.xp.some(x => x.levels > 0)) setTimeout(() => sfx('levelup'), 1400);
    if (res.won && theRun.kind !== 'raid') {
      // The winners cheer and hop before the results come up.
      b.units.filter(u => u.side === 0 && u.alive).forEach((u, i) => {
        const a = A(u.uid);
        setTimeout(() => {
          flashPose(u.uid, 'happy', 1300);
          Animated.sequence([
            tm(a.air, place(u).sz * 0.22, 170, Easing.out(Easing.quad)), tm(a.air, 0, 170, Easing.in(Easing.quad)),
            tm(a.air, place(u).sz * 0.14, 140, Easing.out(Easing.quad)), tm(a.air, 0, 140, Easing.in(Easing.quad)),
          ]).start();
          Animated.sequence([tm(a.stretch, 0.85, 90), tm(a.stretch, 1.1, 170), Animated.spring(a.stretch, { toValue: 1, friction: 3, tension: 160, useNativeDriver: ND })]).start();
        }, i * 90);
      });
      setTimeout(() => setResult(res), 1100);
    } else setResult(res);
  }, [mutate, theRun, flashPose, place]);

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
    // Send the enemy side back off screen first. The last fight's enemy views are still mounted on the same values
    // until the next render, and reviving their opacity below while they still stood in place flashed them on screen.
    travel.stopAnimation();
    travel.setValue(0);
    // Reset every animation value in place. Swapping in new Animated.Values on a natively-driven view can leave
    // the native side holding the old value (a faded-out enemy's opacity 0), which made new enemies invisible.
    for (const u of b.units) {
      const a = A(u.uid);
      a.ox.setValue(0); a.oy.setValue(0); a.shake.setValue(0); a.blink.setValue(1); a.squash.setValue(0); a.lean.setValue(0); a.stretch.setValue(1); a.spin.setValue(0); a.air.setValue(0);
      a.down.setValue(u.alive ? 0 : 1);
      // Enemies start hidden and fade in once the walk is under way. These values are shared by uid with the last
      // fight's (dead, faded) enemies, whose views are still mounted for a moment: showing them now would flash
      // the old team standing in place before the new one walks in.
      a.fade.setValue(u.alive && u.side === 0 ? 1 : 0);
      a.behind.setValue(0);
    }
    setLeftBehind(b.units.filter(u => !u.alive && u.side === 0).map(u => u.uid));
    setView(snap(b)); setOrder(turnOrder(b, 8)); setResult(null); setFloats([]); setFx([]); setActs({});
    setMode('walk');
    setFightNo(n => n + 1);
    const f = theRun.fights[theRun.idx];
    setMusic(f?.boss ? 'boss' : 'battle');
    for (const u of b.units) if (u.side === 1 && u.alive) Animated.sequence([Animated.delay(120), tm(A(u.uid).fade, 1, 200)]).start();
    Animated.timing(travel, { toValue: D, duration: 1800, easing: Easing.inOut(Easing.cubic), useNativeDriver: ND }).start(() => {
      if (!live.current) return;
      for (const u of b.units) if (!u.alive && u.side === 0) A(u.uid).fade.setValue(0);
      setMode('fight');
      setOrder(turnOrder(b, 8));
      setTimeout(() => { if (live.current) step(); }, 300);
    });
  }, [D, mutate, step, theRun, travel]);

  // With auto battle on, the run rolls straight on to the next fight after a moment to see the rewards.
  useEffect(() => {
    if (!result || result.runOver || !save.auto) return;
    const t = setTimeout(() => { if (live.current) enterChamber(); }, 1800);
    return () => clearTimeout(t);
  }, [result, save.auto, enterChamber]);

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
      <Grad colors={['#2a2054', '#160f2c', '#0f0a1e']} />
      <View style={[st.row, { paddingHorizontal: 12, paddingVertical: 6, justifyContent: 'space-between' }]}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.text, fontFamily: F.bold, fontSize: 18 }} numberOfLines={1}>{theRun.title}</Text>
          <Text style={{ color: C.dim, fontSize: 12, fontFamily: F.med }}>
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

      <View style={{ width: W, height: fieldH, overflow: 'hidden', backgroundColor: theRun.ground }}>
      <Animated.View style={{ position: 'absolute', left: 0, top: 0, width: W, height: fieldH, transform: [{ translateX: quake }, { translateY: Animated.multiply(quake, 0.4) }] }}>
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
          return (
            <Animated.View key={`${fightNo}_${u.uid}`} style={{
              position: 'absolute', left: pos.left, top: pos.top, width: pos.sz, height: pos.sz,
              transform: [
                { translateX: u.side === 1 ? Animated.add(Animated.add(enter, a.ox), a.shake) : Animated.add(Animated.add(a.ox, a.shake), Animated.multiply(travel, a.behind)) },
                { translateY: a.oy },
              ],
            }}>
              <Pressable onPress={() => onTapUnit(u.uid)} style={{ width: pos.sz, height: pos.sz }}>
                {(canPick || isActor) ? <View pointerEvents="none" style={{ position: 'absolute', left: pos.sz * 0.1, right: pos.sz * 0.1, bottom: -2, height: pos.sz * 0.28, borderRadius: pos.sz, borderWidth: 2.5, borderColor: isActor ? C.gold : allyPick ? C.good : C.bad, backgroundColor: isActor ? 'rgba(245,197,66,0.18)' : 'rgba(255,255,255,0.12)' }} /> : null}
                {/* The shadow lies on the ground on its own, so it stays flat when the creature leans or falls over,
                    and stays down when it leaps, shrinking and fading the higher the creature goes. */}
                <Animated.View pointerEvents="none" style={{
                  position: 'absolute', left: pos.sz * 0.26, top: pos.sz * 0.88, width: pos.sz * 0.48, height: pos.sz * 0.08, borderRadius: pos.sz,
                  backgroundColor: 'rgba(0,0,0,0.2)',
                  opacity: Animated.multiply(a.fade, a.air.interpolate({ inputRange: [0, pos.sz], outputRange: [1, 0.4], extrapolate: 'clamp' })),
                  transform: [
                    { translateX: a.down.interpolate({ inputRange: [0, 1], outputRange: [0, fallDir * pos.sz * 0.14] }) },
                    { scaleX: Animated.multiply(a.down.interpolate({ inputRange: [0, 1], outputRange: [1, 1.4] }), a.air.interpolate({ inputRange: [0, pos.sz], outputRange: [1, 0.55], extrapolate: 'clamp' })) },
                    { scaleY: a.air.interpolate({ inputRange: [0, pos.sz], outputRange: [1, 0.55], extrapolate: 'clamp' }) },
                  ],
                }} />
                <CreatureGround ph={u.ph} stage={u.stage} size={pos.sz} flip={u.side === 1} air={a.air} opacity={a.fade} />
                {v.alive ? <StatusFx statuses={v.statuses} shield={v.shield > 0} size={pos.sz} part="ground" /> : null}
                <Animated.View style={{
                  width: pos.sz, height: pos.sz,
                  // Lean, stretch and breathing all pivot at the feet.
                  transform: [
                    { translateY: Animated.multiply(a.air, -1) },
                    { translateY: pos.sz * 0.42 },
                    { rotate: a.lean.interpolate({ inputRange: [-90, 90], outputRange: u.side === 0 ? ['-90deg', '90deg'] : ['90deg', '-90deg'] }) },
                    { scaleX: a.stretch },
                    { scaleY: a.stretch.interpolate({ inputRange: [0.5, 1, 1.5], outputRange: [1.4, 1, 0.8] }) },
                    { translateY: -pos.sz * 0.42 },
                  ],
                }}>
                <Animated.View style={{
                  width: pos.sz, height: pos.sz, opacity: Animated.multiply(a.fade, a.blink),
                  transform: [
                    { rotate: a.spin.interpolate({ inputRange: [0, 360], outputRange: u.side === 0 ? ['0deg', '360deg'] : ['0deg', '-360deg'] }) },
                    { translateX: a.down.interpolate({ inputRange: [0, 1], outputRange: [0, fallDir * pos.sz * 0.12] }) },
                    { translateY: a.down.interpolate({ inputRange: [0, 1], outputRange: [0, pos.sz * 0.24] }) },
                    { rotate: a.down.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${fallDir * 90}deg`] }) },
                    { scaleX: a.squash.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) },
                    { scaleY: a.squash.interpolate({ inputRange: [0, 1], outputRange: [1, 0.72] }) },
                  ],
                }}>
                  <Sprite u={u} size={pos.sz} walking={walking || !!acts[u.uid]?.moving} ko={!v.alive} pose={acts[u.uid]?.pose ?? (v.statuses.includes('stun') || v.statuses.includes('freeze') ? 'dizzy' : undefined)} turned={acts[u.uid]?.turned} />
                  {v.alive ? <StatusFx statuses={v.statuses} shield={v.shield > 0} size={pos.sz} part="body" /> : null}
                </Animated.View>
                </Animated.View>
              </Pressable>
            </Animated.View>
          );
        })}

        {b ? b.units.map(u => {
          const v = view[u.uid];
          if (!v || !v.alive || !(mode === 'fight' || u.side === 0)) return null;
          const pos = place(u);
          const a = A(u.uid);
          return (
            <Animated.View key={`hud${fightNo}_${u.uid}`} pointerEvents="none" style={{
              position: 'absolute', left: pos.left, top: pos.top, width: pos.sz,
              transform: [
                { translateX: u.side === 1 ? Animated.add(Animated.add(enter, a.ox), a.shake) : Animated.add(Animated.add(a.ox, a.shake), Animated.multiply(travel, a.behind)) },
                { translateY: Animated.subtract(a.oy, a.air) },
              ],
            }}>
              <View style={{ position: 'absolute', top: -9, left: pos.sz * 0.08, right: pos.sz * 0.08 }}>
                <Bar frac={v.hp / u.max.hp} color={hpColor(v.hp / u.max.hp)} height={5} />
                {v.shield > 0 ? <View style={{ marginTop: 1 }}><Bar frac={v.shield / (u.max.hp * 0.6)} color="#9fe8ff" height={3} /></View> : null}
                <Text style={{ color: u.side === 1 ? '#ffc2c7' : '#fff', fontSize: 8, fontWeight: '700', textAlign: 'center', textShadowColor: '#000', textShadowRadius: 2 }} numberOfLines={1}>Lv{u.level} {u.name}</Text>
                {v.statuses.length ? (
                  <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 2, marginTop: 1 }}>
                    {v.statuses.slice(0, 4).map(k => (
                      <View key={k} style={{ backgroundColor: isBuff(k) ? '#2e8b57' : '#a8324a', borderRadius: 4, paddingHorizontal: 3, borderWidth: 1, borderColor: 'rgba(0,0,0,0.35)' }}>
                        <Text style={{ fontSize: 7.5, fontFamily: F.bold, color: '#fff' }}>{STATUS_TAG[k]}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            </Animated.View>
          );
        }) : null}

        {b && sel && (sel.target === 'fallen' || sel.target === 'allFallen') ? leftBehind.map(uid => {
          const u = b.units[uid];
          if (!u || u.alive) return null;
          const pos = place(u);
          return (
            <Pressable key={'ghost' + uid} onPress={() => onTapUnit(uid)} style={{ position: 'absolute', left: pos.left, top: pos.top, width: pos.sz, height: pos.sz, opacity: 0.45 }}>
              <View pointerEvents="none" style={{ position: 'absolute', left: pos.sz * 0.1, right: pos.sz * 0.1, bottom: -2, height: pos.sz * 0.28, borderRadius: pos.sz, borderWidth: 2.5, borderColor: C.good, backgroundColor: 'rgba(90,209,122,0.2)' }} />
              <CreatureView ph={u.ph} stage={u.stage} size={pos.sz} ko shadow={false} />
            </Pressable>
          );
        }) : null}

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
      </Animated.View>
      </View>

      <View style={{ flex: 1, padding: 10 }}>
        {me && b ? (
          <>
            <View style={[st.row, { marginBottom: 6 }]}>
              <Text style={{ color: C.gold, fontFamily: F.bold, fontSize: 17, flex: 1 }} numberOfLines={1}>{me.name}'s turn</Text>
              <Text style={{ color: C.dim, fontSize: 11 }}>{sel ? (needsPick(sel) ? 'Tap a highlighted target' : '') : 'Pick a move'}</Text>
            </View>
            <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {me.moves.map(mv => {
                const ok = usable(b, me, mv);
                const cd = me.cds[mv.id] ?? 0;
                const e = ELEMENTS[mv.el];
                const on = sel?.id === mv.id;
                return (
                  <Pressable key={mv.id} disabled={!ok} onPress={() => { sfx('select'); haptic('select'); setSel(mv); }} style={({ pressed }) => [{ width: (W - 26) / 2, borderRadius: 14, borderWidth: on ? 2 : 1, borderColor: on ? C.gold : 'rgba(255,255,255,0.1)', overflow: 'hidden', opacity: ok ? 1 : 0.45, transform: [{ scale: pressed ? 0.96 : 1 }] }, on ? shadow(C.gold, 10, 0.6, 0) : null]}>
                    <Grad colors={[mixHex('#352a60', e.base, on ? 0.45 : 0.3), '#231b40']} />
                    <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, backgroundColor: e.base }} />
                    <View style={{ padding: 8, paddingLeft: 12 }}>
                    <Text style={{ color: C.text, fontFamily: F.semi, fontSize: 15 }} numberOfLines={1}>{mv.name}</Text>
                    <Text style={{ color: C.dim, fontSize: 10.5 }} numberOfLines={1}>{cd > 0 ? `Ready in ${cd}` : !ok ? 'Not usable' : mv.id === 'strike' ? 'Typeless' : e.name}{mv.cd && cd <= 0 ? ` · cd ${mv.cd}` : ''}</Text>
                    </View>
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
        ) : save.auto && result && !result.runOver ? (
          <FadeIn key={'res' + fightNo} dy={10}>
            <View style={[st.row, { marginBottom: 6 }]}>
              <Icon name="crown" size={22} color={C.gold} accent="#2b2054" />
              <Text style={{ color: C.gold, fontFamily: F.bold, fontSize: 20, flex: 1 }}>{result.cleared && theRun.kind === 'area' ? 'Area cleared!' : 'Fight won!'}</Text>
              <Text style={{ color: C.dim, fontFamily: F.semi, fontSize: 13 }}>{theRun.fights[theRun.idx]?.boss ? 'Boss next' : theRun.kind === 'tower' ? `Floor ${theRun.floor} next` : 'Next fight'}</Text>
            </View>
            {result.xp.map(x => {
              const c = byId(save, x.cid);
              if (!c) return null;
              return (
                <View key={x.cid} style={[st.row, { marginBottom: 3 }]}>
                  <Text style={{ color: C.text, fontFamily: F.semi, fontSize: 14, width: 96 }} numberOfLines={1}>{c.name}</Text>
                  <Text style={{ color: C.dim, fontSize: 12, width: 64 }}>+{x.xp} XP</Text>
                  <View style={{ flex: 1 }}>
                    {x.levels ? <Text style={{ color: C.good, fontFamily: F.semi, fontSize: 13 }}>Lv {c.level - x.levels} → {c.level}</Text> : null}
                    {x.newStage != null ? <Text style={{ color: C.gold, fontFamily: F.semi, fontSize: 12 }}>Grew into {x.newStage === 3 ? 'an' : 'a'} {STAGE_NAMES[x.newStage]}!</Text> : null}
                    {x.learned.map(m => <Text key={m.id} style={{ color: C.accent2, fontSize: 12 }}>Learned {m.name}</Text>)}
                  </View>
                </View>
              );
            })}
            <View style={{ marginTop: 6 }}><LootChips loot={addLoot(result.drops, result.chest)} /></View>
            <Countdown ms={1800} />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <Btn small style={{ flex: 1 }} kind="ghost" label="Leave" onPress={leave} />
              <Btn small style={{ flex: 2 }} kind="gold" label="Go now" onPress={enterChamber} />
            </View>
          </FadeIn>
        ) : save.auto && mode === 'fight' ? (
          <FadeIn dy={8}>
            <View style={[st.row, { marginBottom: 8 }]}>
              <Icon name="bolt" size={20} color="#a898ff" />
              <Text style={{ color: C.text, fontFamily: F.bold, fontSize: 18, flex: 1 }}>Auto battle</Text>
              {theRun.fights.length > 1 && theRun.kind !== 'tower' ? (
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  {theRun.fights.map((f, i) => (
                    <View key={i} style={{ width: f.boss ? 14 : 10, height: f.boss ? 14 : 10, borderRadius: 7, backgroundColor: i < theRun.idx ? C.good : i === theRun.idx ? C.gold : '#3a3060', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.2)' }} />
                  ))}
                </View>
              ) : null}
            </View>
            <Text style={{ color: C.dim, fontFamily: F.semi, fontSize: 13, marginBottom: 6 }}>Won so far this run{wins ? ` (${wins} fight${wins > 1 ? 's' : ''})` : ''}</Text>
            <LootChips loot={runLoot} />
          </FadeIn>
        ) : (
          <P dim style={{ textAlign: 'center', marginTop: 12 }}>{mode === 'walk' || result ? '' : 'Waiting...'}</P>
        )}
      </View>

      {result && !(save.auto && !result.runOver) ? (
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: '#000a', justifyContent: 'center', padding: 16 }}>
          <FadeIn dy={30}>
          <View style={[st.card, { maxHeight: winH * 0.8, borderColor: result.won ? C.gold + 'aa' : C.bad + 'aa', borderWidth: 1.5 }, shadow(result.won ? C.gold : C.bad, 18, 0.5, 0)]}>
            <Grad colors={['#3a2e6b', '#221a42']} />
            <Glow color={result.won ? C.gold : C.bad} opacity={0.35} cy="0%" r="70%" />
            <View style={{ alignItems: 'center', marginBottom: 2 }}><Icon name={result.won ? 'crown' : 'skull'} size={34} color={result.won ? C.gold : C.bad} accent="#2b2054" /></View>
            <Text style={{ color: result.won ? C.gold : C.bad, fontSize: 30, fontFamily: F.bold, textAlign: 'center', textShadowColor: (result.won ? C.gold : C.bad) + '88', textShadowRadius: 12 }}>
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
                      <Text style={{ fontFamily: F.semi, fontSize: 15 }}>{c.name}</Text>  +{x.xp} XP{x.levels ? <Text style={{ color: C.good, fontFamily: F.semi }}>  Lv {c.level - x.levels} → {c.level}</Text> : null}
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
            {!result.runOver && save.auto ? <P dim style={{ textAlign: 'center', marginTop: 6, fontSize: 12 }}>Auto is on: carrying on in a moment. Tap Leave to stop here.</P> : null}
          </View>
          </FadeIn>
        </View>
      ) : null}
    </View>
  );
}
