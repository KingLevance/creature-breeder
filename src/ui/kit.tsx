// Shared look and small building blocks used by every screen.
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';
import { ELEMENTS, ElementId } from '../game/data/elements';
import { MoveDef, RARITY_COLORS, RARITY_NAMES } from '../game/data/moves';
import { Creature, STAGE_NAMES, stageOf, typeLabel } from '../game/creature';
import { Pheno, express, rareCarrierCount, starRating } from '../game/genome';
import { tap } from './audio';
import { Pose, Rig, Shape, bodyBounds, creatureOpacity, drawCreature, drawCreatureRig, drawEgg, poseWeights } from '../render/creature';
import { F, Glow, Grad, Icon, IconName, ND as LOOK_ND, PANEL, haptic, pulse, shadow, useLoop, usePress } from './look';

export const C = {
  bg: '#2f265e', panel: '#35295d', panel2: '#43376f', line: '#5a4b92', text: '#f4efff', dim: '#a99fc9',
  gold: '#f5c542', good: '#5ad17a', bad: '#f0616d', accent: '#8f7cff', accent2: '#ff9f5a', male: '#6fb7ff', female: '#ff8fc7',
};

function ShapeNodes({ shapes }: { shapes: Shape[] }) {
  return (
    <>
      {shapes.map((s, i) => {
        // Every prop is always given an explicit value. When a pose changes, the same native shape is reused for a
        // different part, and react-native-svg keeps a prop's old value if it is just left out (that's how a
        // rotated paw from an attack stuck around and looked like a broken leg).
        const common = { fill: s.fill ?? 'none', stroke: s.stroke ?? 'none', strokeWidth: s.sw ?? 0, opacity: s.op ?? 1, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
        if (s.t === 'path') return <Path key={i} {...common} d={s.d} />;
        if (s.t === 'circle') return <Circle key={i} {...common} cx={s.cx} cy={s.cy} r={s.r} />;
        return <Ellipse key={i} {...common} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} transform={`rotate(${s.rot ?? 0} ${s.cx} ${s.cy})`} />;
      })}
    </>
  );
}

/**
 * A stable key for a creature's looks. Battles build fresh Pheno objects every fight, so caching by object would
 * redraw a whole team's walk cycle in every chamber; keyed by content, each frame is drawn once per session.
 */
const phKeys = new WeakMap<Pheno, string>();
function phKey(ph: Pheno): string {
  let k = phKeys.get(ph);
  if (k == null) { k = JSON.stringify(ph); phKeys.set(ph, k); }
  return k;
}
/** Per-creature caches, keeping the most recently used few dozen creatures. */
function lruFor<K, V>(store: Map<string, Map<K, V>>, ph: Pheno, cap = 40): Map<K, V> {
  const k = phKey(ph);
  let m = store.get(k);
  if (m) { store.delete(k); store.set(k, m); return m; }
  m = new Map();
  store.set(k, m);
  if (store.size > cap) store.delete(store.keys().next().value as string);
  return m;
}

/** The box a creature's body fills (see bodyBounds), measured once per creature and stage. */
const boundsCache = new Map<string, Map<number, ReturnType<typeof bodyBounds>>>();
export function bodyBoundsCached(ph: Pheno, stage: number) {
  const m = lruFor(boundsCache, ph, 60);
  let v = m.get(stage);
  if (!v) { v = bodyBounds(ph, stage); m.set(stage, v); }
  return v;
}

/** Drawn frames per creature. Idle and walk cycles repeat the same dozen frames, so each is drawn once. */
const frameCache = new Map<string, Map<string, Shape[]>>();
function drawCached(ph: Pheno, stage: number, phase: number, walking?: boolean, shadow?: boolean, ko?: boolean, pose?: Pose): Shape[] {
  const m = lruFor(frameCache, ph, 80);
  const key = `${stage}|${phase.toFixed(3)}|${walking ? 1 : 0}|${shadow === false ? 0 : 1}|${ko ? 1 : 0}|${pose ?? 'idle'}`;
  let sh = m.get(key);
  if (!sh) {
    sh = drawCreature(ph, { stage, phase, walking, shadow, ko, pose });
    if (m.size > 80) m.clear();
    m.set(key, sh);
  }
  return sh;
}

interface CreatureViewProps { ph: Pheno; stage: number; size: number; phase?: number; walking?: boolean; flip?: boolean; shadow?: boolean; ko?: boolean; pose?: Pose }
/** One creature, drawn from its visible traits. The same component feeds cards, the nursery and battles. */
export const CreatureView = memo(function CreatureView({ ph, stage, size, phase = 0, walking, flip, shadow, ko, pose }: CreatureViewProps) {
  const shapes = useMemo(() => drawCached(ph, stage, phase, walking, shadow, ko, pose), [ph, stage, phase, walking, shadow, ko, pose]);
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" opacity={creatureOpacity(ph)} style={flip ? { transform: [{ scaleX: -1 }] } : undefined}>
      <ShapeNodes shapes={shapes} />
    </Svg>
  );
});

const ND = Platform.OS !== 'web';
const TAU = Math.PI * 2;
/** A smooth wave over a looping 0..1 value: base + amp * sin(2π(cycles·t + off)), sampled finely enough to look round. */
function wave(v: Animated.Value, amp: number, base: number, cycles = 1, off = 0): Animated.AnimatedInterpolation<number> {
  const n = 16 * cycles, inputRange: number[] = [], outputRange: number[] = [];
  for (let i = 0; i <= n; i++) { const t = i / n; inputRange.push(t); outputRange.push(base + amp * Math.sin((t * cycles + off) * TAU)); }
  return v.interpolate({ inputRange, outputRange });
}
const deg = (v: Animated.AnimatedInterpolation<number> | Animated.Value | Animated.AnimatedAddition<number>) =>
  v.interpolate({ inputRange: [-360, 360], outputRange: ['-360deg', '360deg'] });
/** Rotate a full-size layer about a joint given in drawing units (0..100). */
const about = (pv: [number, number], size: number, angle: Animated.AnimatedInterpolation<string>) => {
  const dx = ((pv[0] - 50) * size) / 100, dy = ((pv[1] - 50) * size) / 100;
  return [{ translateX: dx }, { translateY: dy }, { rotate: angle }, { translateX: -dx }, { translateY: -dy }];
};

/** Drawn rigs per creature, keyed by everything that changes the drawing. */
const rigCache = new Map<string, Map<string, Rig>>();
function rigCached(ph: Pheno, o: { stage: number; phase: number; walking?: boolean; shadow?: boolean; ko?: boolean; pose?: Pose; reach: number; raise: number; guard: number; look: number }): Rig {
  const m = lruFor(rigCache, ph);
  const parts = lruFor(partCache, ph);
  const key = `${o.stage}|${o.phase.toFixed(3)}|${o.walking ? 1 : 0}|${o.shadow === false ? 0 : 1}|${o.ko ? 1 : 0}|${o.pose ?? 'idle'}|${o.reach.toFixed(2)}|${o.raise.toFixed(2)}|${o.guard.toFixed(2)}|${o.look}`;
  let r = m.get(key);
  if (!r) {
    r = drawCreatureRig(ph, o);
    // Share identical layers between frames (the tail and wings rarely change while the legs walk), so the
    // memoised layer views skip re-rendering them.
    const intern = (sh: Shape[]) => { const k = JSON.stringify(sh); const had = parts.get(k); if (had) return had; if (parts.size > 120) parts.clear(); parts.set(k, sh); return sh; };
    r = { ...r, tail: intern(r.tail), wingFar: intern(r.wingFar), wingNear: intern(r.wingNear), ground: intern(r.ground) };
    if (m.size > 160) m.clear();
    m.set(key, r);
  }
  return r;
}
const partCache = new Map<string, Map<string, Shape[]>>();

/** One drawn layer of a creature. Memoised on its shape list, so an unchanged layer doesn't re-render. */
const Layer = memo(function Layer({ shapes, size }: { shapes: Shape[]; size: number }) {
  return <Svg width={size} height={size} viewBox="0 0 100 100" style={StyleSheet.absoluteFill}><ShapeNodes shapes={shapes} /></Svg>;
});
/** Whether anything in a creature's resting drawing moves with the idle cycle (orbiting orbs, flickers, motes). */
const detailCache = new Map<string, Map<number, boolean>>();
function hasIdleDetail(ph: Pheno, stage: number): boolean {
  const m = lruFor(detailCache, ph, 200);
  let v = m.get(stage);
  if (v == null) {
    const at = (phase: number) => { const r = drawCreatureRig(ph, { stage, phase }); return JSON.stringify([r.main, r.ground]); };
    v = at(0) !== at(0.37);
    m.set(stage, v);
  }
  return v;
}

/** How far each tail type swings, in degrees. */
const TAIL_SWING: Record<string, number> = { whip: 9, long: 7, tuft: 6, club: 4, plume: 6, fan: 5, stinger: 5, stub: 3 };
/** Wing flaps: swing in degrees and loop length in ms. Flying bodies flap harder. */
function wingMotion(ph: Pheno): [number, number] {
  const fly = ph.skel === 'floater';
  switch (ph.wings) {
    case 'insect': return [14, 240];
    case 'feather': case 'bat': return fly ? [16, 900] : [9, 1700];
    case 'energy': return [6, 1600];
    case 'flipper': return [7, 1900];
    case 'fin': return [3, 2200];
    default: return [0, 2000];
  }
}

type Fidget = 'hop' | 'look' | 'flick' | 'stretch' | 'wiggle';

/**
 * A creature that lives on screen. The body breathes, the tail swings with a little lag behind it, and the wings
 * flap, all as smooth native animation; drawn frames only change for walking legs, poses and blinks. Poses blend
 * in and out over a few frames, and now and then an idle creature fidgets.
 */
export const LiveCreature = memo(function LiveCreature(props: Omit<CreatureViewProps, 'phase'> & { pose?: Pose; fidget?: boolean; ground?: boolean; /** Legs at a run rather than a walk. */ run?: boolean }) {
  const { ph, stage, size, flip, shadow, ko } = props;
  const walking = !!props.walking && !ko;
  const detail = useMemo(() => hasIdleDetail(ph, stage), [ph, stage]);
  // Drawn frames: walking legs (16 per stride), or slow detail frames for creatures with moving bits.
  const [frame, setFrame] = useState(() => Math.floor(Math.random() * 12));
  useEffect(() => {
    if (!walking && !detail) return;
    const id = setInterval(() => setFrame(f => (f + 1) % (walking ? WALK_FRAMES : IDLE_FRAMES)), walking ? (props.run ? RUN_MS : WALK_MS) : IDLE_MS);
    return () => clearInterval(id);
  }, [walking, detail, props.run]);
  // Blinks.
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    if (ko) return;
    let t: ReturnType<typeof setTimeout>;
    const next = () => { t = setTimeout(() => { setBlink(true); t = setTimeout(() => { setBlink(false); next(); }, 130); }, 2200 + Math.random() * 3200); };
    next();
    return () => clearTimeout(t);
  }, [ko]);
  // Fidgets, now and then, while idling.
  const [fid, setFid] = useState<Fidget | null>(null);
  const [look, setLook] = useState(0);
  const hop = useRef(new Animated.Value(0)).current;
  const flick = useRef(new Animated.Value(0)).current;
  const wiggle = useRef(new Animated.Value(0)).current;
  const idle = !walking && !ko && (!props.pose || props.pose === 'idle') && props.fidget !== false;
  useEffect(() => {
    if (!idle) return;
    let t: ReturnType<typeof setTimeout>;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (ms: number, fn: () => void) => { timers.push(setTimeout(fn, ms)); };
    const next = () => {
      t = setTimeout(() => {
        const pick: Fidget = (['hop', 'look', 'flick', 'stretch', 'wiggle', 'look', 'flick'] as Fidget[])[Math.floor(Math.random() * 7)];
        setFid(pick);
        if (pick === 'hop') { hop.setValue(0); Animated.timing(hop, { toValue: 1, duration: 760, easing: Easing.linear, useNativeDriver: ND }).start(); }
        if (pick === 'flick') Animated.sequence([1, -0.7, 0.4, 0].map(v => Animated.timing(flick, { toValue: v, duration: 110, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }))).start();
        if (pick === 'wiggle') Animated.sequence([1, -1, 0.6, -0.4, 0].map(v => Animated.timing(wiggle, { toValue: v, duration: 90, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }))).start();
        if (pick === 'look') { setLook(-1); later(700, () => setLook(1)); later(1300, () => setLook(0)); }
        later(pick === 'stretch' ? 900 : pick === 'look' ? 1400 : 600, () => setFid(null));
        next();
      }, 5000 + Math.random() * 9000);
    };
    next();
    return () => { clearTimeout(t); timers.forEach(clearTimeout); setFid(null); setLook(0); };
  }, [idle, hop, flick, wiggle]);
  // Poses blend in and out over a few frames instead of snapping.
  const pose: Pose = props.pose && props.pose !== 'idle' ? props.pose : fid === 'stretch' ? 'happy' : blink ? 'blink' : 'idle';
  const target = useMemo(() => poseWeights(ko ? 'idle' : pose === 'blink' ? 'idle' : pose), [pose, ko]);
  const [w, setW] = useState(target);
  const wRef = useRef(target);
  useEffect(() => {
    const from = wRef.current;
    if (from.reach === target.reach && from.raise === target.raise && from.guard === target.guard) return;
    let i = 0;
    const steps = 4;
    const id = setInterval(() => {
      i++;
      const t = 1 - (1 - i / steps) * (1 - i / steps);
      const nw = { reach: from.reach + (target.reach - from.reach) * t, raise: from.raise + (target.raise - from.raise) * t, guard: from.guard + (target.guard - from.guard) * t };
      wRef.current = nw;
      setW(nw);
      if (i >= steps) clearInterval(id);
    }, 32);
    return () => clearInterval(id);
  }, [target]);
  const q = (v: number) => Math.round(v * 20) / 20;
  const phase = walking ? frame / WALK_FRAMES : detail ? frame / IDLE_FRAMES : 0;
  const rig = useMemo(() => rigCached(ph, { stage, phase, walking, shadow, ko, pose, reach: q(w.reach), raise: q(w.raise), guard: q(w.guard), look }), [ph, stage, phase, walking, shadow, ko, pose, w, look]);

  // Native loops: breathing for the body (and the tail swinging a beat behind it), and a separate wing beat.
  const breath = useRef(new Animated.Value(0)).current;
  const beat = useRef(new Animated.Value(0)).current;
  // A slow shift of weight from side to side, out of step with the breathing, so a creature at rest never
  // just pumps up and down on the spot.
  const sway = useRef(new Animated.Value(0)).current;
  const off = useMemo(() => Math.random(), []);
  const [wingSwing, wingMs] = useMemo(() => wingMotion(ph), [ph]);
  const period = useMemo(() => 2400 + Math.random() * 900, []);
  useEffect(() => {
    if (ko) return;
    const l1 = Animated.loop(Animated.timing(breath, { toValue: 1, duration: walking ? (props.run ? 380 : 700) : period, easing: Easing.linear, useNativeDriver: ND }));
    const l2 = Animated.loop(Animated.timing(beat, { toValue: 1, duration: walking ? Math.min(wingMs, 600) : wingMs, easing: Easing.linear, useNativeDriver: ND }));
    const l3 = Animated.loop(Animated.timing(sway, { toValue: 1, duration: period * 2.3, easing: Easing.linear, useNativeDriver: ND }));
    breath.setValue(0); beat.setValue(0);
    l1.start(); l2.start(); l3.start();
    return () => { l1.stop(); l2.stop(); l3.stop(); };
  }, [ko, walking, props.run, period, wingMs, breath, beat, sway]);
  const anim = useMemo(() => {
    const fly = ph.skel === 'floater' || ph.skel === 'aquatic';
    const amp = ko ? 0 : 1;
    const sy = wave(breath, 0.024 * amp, 1, 1, off), sx = wave(breath, -0.011 * amp, 1, 1, off);
    const tailBase = wave(breath, (TAIL_SWING[ph.tail] ?? 5) * amp, 0, 1, off - 0.18);
    const tail = deg(Animated.add(tailBase, Animated.multiply(flick, 16)));
    const wing = deg(wave(beat, wingSwing * amp, 0, 1, off));
    const wingFar = deg(wave(beat, wingSwing * 0.8 * amp, 0, 1, off - 0.08));
    const hover = fly ? wave(breath, 1.6 * amp * (size / 100), 0, 1, off + 0.25) : null;
    // A hop is one timeline: sink and gather, spring up tall and thin, come down, squash on landing, settle.
    const H = [0, 0.2, 0.42, 0.62, 0.7, 0.84, 1];
    const lift = hop.interpolate({ inputRange: H, outputRange: [0, 0, -size * 0.1, 0, 0, 0, 0] });
    const hy = hop.interpolate({ inputRange: H, outputRange: [1, 0.84, 1.1, 1.04, 0.84, 1.04, 1] });
    const hx = hop.interpolate({ inputRange: H, outputRange: [1, 1.12, 0.93, 0.97, 1.13, 0.98, 1] });
    const rot = deg(Animated.multiply(wiggle, 5));
    // The sway is a bend of the body over its planted feet, not a tilt of the whole thing: the top drifts side to
    // side while the feet stay put. The breath gives it a little forward-and-back too, a beat behind the swell.
    const bend = deg(Animated.add(wave(sway, (fly ? 2.4 : 3) * amp * (walking ? 0 : 1), 0, 1, off), wave(breath, 1.1 * amp * (walking ? 0 : 1), 0, 1, off - 0.3)));
    // The shadow stays on the ground through a hop, shrinking a little while the body is up.
    const under = hop.interpolate({ inputRange: H, outputRange: [1, 1.06, 0.8, 1, 1.08, 1, 1] });
    // Built here once, not in render: a walking creature re-renders every frame, and new animated nodes each time
    // would have to be re-attached to the native view on every one of them.
    const body = [
      { translateY: hover ? Animated.add(lift, hover) : lift },
      { translateY: 40 * (size / 100) }, { rotate: rot }, { skewX: bend }, { scaleY: Animated.multiply(sy, hy) }, { scaleX: Animated.multiply(sx, hx) }, { translateY: -40 * (size / 100) },
    ];
    return { tail, wing, wingFar, under, body };
  }, [ph, ko, walking, breath, beat, sway, flick, hop, wiggle, off, wingSwing, size]);

  const s = size / 100, fy = 40 * s;
  const svg = (shapes: Shape[]) => <Layer shapes={shapes} size={size} />;
  const gy = 42 * s;
  return (
    <View style={{ width: size, height: size, opacity: creatureOpacity(ph), transform: [{ scaleX: flip ? -1 : 1 }] }}>
      {/* The ground layer (shadow, ground glow, rising motes) stays down while the body hops, hovers and breathes. */}
      {props.ground !== false && rig.ground.length ? (
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY: gy }, { scale: anim.under }, { translateY: -gy }] }]}>{svg(rig.ground)}</Animated.View>
      ) : null}
    <Animated.View style={[StyleSheet.absoluteFill, { transform: anim.body }]}>
      {rig.wingFar.length && rig.pivots.wingFar ? <Animated.View style={[StyleSheet.absoluteFill, { transform: about(rig.pivots.wingFar, size, anim.wingFar) }]}>{svg(rig.wingFar)}</Animated.View> : null}
      {rig.tail.length && rig.pivots.tail ? <Animated.View style={[StyleSheet.absoluteFill, { transform: about(rig.pivots.tail, size, anim.tail) }]}>{svg(rig.tail)}</Animated.View> : null}
      {svg(rig.main)}
      {rig.wingNear.length && rig.pivots.wingNear ? <Animated.View style={[StyleSheet.absoluteFill, { transform: about(rig.pivots.wingNear, size, anim.wing) }]}>{svg(rig.wingNear)}</Animated.View> : null}
    </Animated.View>
    </View>
  );
});

/**
 * Just the ground under a creature (its ground glow and rising motes; the battle draws its own shadow), for when
 * the body is drawn somewhere that leaps and leans. Shrinks and fades as the creature rises by `air` px.
 */
export const CreatureGround = memo(function CreatureGround({ ph, stage, size, flip, air, opacity }: { ph: Pheno; stage: number; size: number; flip?: boolean; air?: Animated.Value; opacity?: Animated.Value }) {
  const detail = useMemo(() => hasIdleDetail(ph, stage), [ph, stage]);
  const [frame, setFrame] = useState(() => Math.floor(Math.random() * IDLE_FRAMES));
  useEffect(() => {
    if (!detail || stage < 3) return;
    const id = setInterval(() => setFrame(f => (f + 1) % IDLE_FRAMES), IDLE_MS);
    return () => clearInterval(id);
  }, [detail, stage]);
  const shapes = useMemo(() => stage >= 3 ? rigCached(ph, { stage, phase: detail ? frame / IDLE_FRAMES : 0, shadow: false, reach: 0, raise: 0, guard: 0, look: 0 }).ground : [], [ph, stage, frame, detail]);
  if (!shapes.length) return null;
  const gy = size * 0.42;
  const k = air ? air.interpolate({ inputRange: [0, size], outputRange: [1, 0.55], extrapolate: 'clamp' }) : 1;
  const op = air ? air.interpolate({ inputRange: [0, size], outputRange: [1, 0.35], extrapolate: 'clamp' }) : 1;
  return (
    <Animated.View pointerEvents="none" style={{
      position: 'absolute', left: 0, top: 0, width: size, height: size,
      opacity: Animated.multiply(Animated.multiply(op, opacity ?? 1), creatureOpacity(ph)),
      transform: [{ scaleX: flip ? -1 : 1 }, { translateY: gy }, { scale: k }, { translateY: -gy }],
    }}>
      <Svg width={size} height={size} viewBox="0 0 100 100" style={StyleSheet.absoluteFill}><ShapeNodes shapes={shapes} /></Svg>
    </Animated.View>
  );
});
// 12 walk frames a stride is smooth enough for legs, and a quarter fewer re-renders than 16 while a team walks.
const IDLE_FRAMES = 12, IDLE_MS = 150, WALK_FRAMES = 12, WALK_MS = 55, RUN_MS = 42;

export const EggView = memo(function EggView({ ph, size, wobble = 0 }: { ph: Pheno; size: number; wobble?: number }) {
  const shapes = useMemo(() => drawEgg(ph, wobble), [ph, wobble]);
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <ShapeNodes shapes={shapes} />
    </Svg>
  );
});

const BTN = {
  main: { grad: ['#ac9dff', '#7357ee'], lip: '#42309c', fg: '#ffffff' },
  gold: { grad: ['#ffe58a', '#f6b52e'], lip: '#b4721a', fg: '#3d2400' },
  danger: { grad: ['#ff9a9a', '#e0485a'], lip: '#8c2434', fg: '#ffffff' },
  ghost: { grad: ['#3d3270', '#2c2354'], lip: '#191130', fg: '#e4dcff' },
  off: { grad: ['#3a3256', '#2e2746'], lip: '#1c1630', fg: '#8e84ad' },
};
export function Btn({ label, onPress, disabled, kind = 'main', small, style, icon }: { label: string; onPress: () => void; disabled?: boolean; kind?: 'main' | 'ghost' | 'gold' | 'danger'; small?: boolean; style?: ViewStyle; icon?: React.ReactNode }) {
  const k = disabled ? BTN.off : BTN[kind];
  const press = useRef(new Animated.Value(0)).current;
  const lip = small ? 3 : 4, r = small ? 11 : 15;
  const spring = (to: number) => Animated.spring(press, { toValue: to, speed: to ? 60 : 22, bounciness: to ? 0 : 9, useNativeDriver: LOOK_ND }).start();
  return (
    <Pressable
      disabled={disabled}
      onPress={() => { tap(); haptic(); onPress(); }}
      onPressIn={() => spring(1)} onPressOut={() => spring(0)}
      style={[{ borderRadius: r }, !disabled && kind !== 'ghost' ? shadow(k.lip, 8, 0.45, 3) : null, style]}>
      <View style={{ borderRadius: r, backgroundColor: k.lip, paddingBottom: lip }}>
        <Animated.View style={{ borderRadius: r, overflow: 'hidden', transform: [{ translateY: press.interpolate({ inputRange: [0, 1], outputRange: [0, lip - 1] }) }] }}>
          <Grad colors={k.grad} />
          {/* The glossy top: a clear highlight on a coloured button, only a faint sheen on a dark one, where a
              strong band reads as a grey bar across the label. */}
          <View pointerEvents="none" style={{ position: 'absolute', left: 3, right: 3, top: 2, height: '42%', borderRadius: r - 2, backgroundColor: disabled || kind === 'ghost' ? 'rgba(255,255,255,0.055)' : 'rgba(255,255,255,0.18)' }} />
          <View style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }, small ? { paddingVertical: 6, paddingHorizontal: 12 } : { paddingVertical: 11, paddingHorizontal: 16 }]}>
            {icon}
            <Text numberOfLines={1} style={{ fontFamily: F.bold, fontSize: small ? 14 : 17, color: k.fg, letterSpacing: 0.3, textShadowColor: k.fg === '#ffffff' ? 'rgba(0,0,0,0.3)' : 'transparent', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 1 }}>{label}</Text>
          </View>
        </Animated.View>
      </View>
    </Pressable>
  );
}

const OUTER_KEYS = new Set(['margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginHorizontal', 'marginVertical', 'opacity', 'flex', 'width', 'alignSelf', 'position', 'left', 'right', 'top', 'bottom']);
function splitStyle(style?: ViewStyle | (ViewStyle | false | null | undefined)[]): [ViewStyle, ViewStyle] {
  const flat = StyleSheet.flatten(style) ?? {};
  const outer: any = {}, inner: any = {};
  for (const [k, v] of Object.entries(flat)) (OUTER_KEYS.has(k) ? outer : inner)[k] = v;
  return [outer, inner];
}
export function Card({ children, style, onPress, glow, tint }: { children: React.ReactNode; style?: ViewStyle | (ViewStyle | false | null | undefined)[]; onPress?: () => void; glow?: string; tint?: string }) {
  const pr = usePress(0.975);
  const [outer, inner] = splitStyle(style);
  const body = (
    <View style={[st.card, glow ? { borderColor: glow, borderWidth: 1.5 } : null, inner]}>
      <Grad colors={tint ? [mixHex(PANEL[0], tint, 0.22), PANEL[1]] : PANEL} />
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.16)' }} />
      {children}
    </View>
  );
  const wrap: ViewStyle = { marginBottom: 12, borderRadius: 18, ...shadow(glow ?? '#000', glow ? 12 : 10, glow ? 0.55 : 0.35, glow ? 0 : 4), ...outer };
  if (!onPress) return <View style={wrap}>{body}</View>;
  return (
    <Pressable onPress={() => { haptic('select'); onPress(); }} onPressIn={pr.onPressIn} onPressOut={pr.onPressOut}>
      <Animated.View style={[wrap, { transform: [{ scale: pr.scale }] }]}>{body}</Animated.View>
    </Pressable>
  );
}
/** Mix two #rrggbb colours. */
export function mixHex(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (sh: number) => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t);
  return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
}

export const H = ({ children, style }: { children: React.ReactNode; style?: any }) => <Text style={[st.h, style]}>{children}</Text>;
/** A section heading with a small coloured icon badge. */
export function Title({ icon, color = C.accent, children, right }: { icon: IconName; color?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <View style={[{ width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' }, shadow(color, 6, 0.5, 0)]}>
        <Grad colors={[mixHex(color, '#ffffff', 0.25), mixHex(color, '#000000', 0.25)]} />
        <View><Icon name={icon} size={18} color="#ffffff" accent={mixHex(color, '#000000', 0.4)} /></View>
      </View>
      <Text style={[st.h, { marginBottom: 0, flex: 1 }]}>{children}</Text>
      {right}
    </View>
  );
}
export const P = ({ children, dim, style }: { children: React.ReactNode; dim?: boolean; style?: any }) => <Text style={[st.p, dim && { color: C.dim }, style]}>{children}</Text>;

const STAR_D = 'M12 2.5 L14.8 8.6 L21.5 9.3 L16.5 13.8 L17.9 20.5 L12 17.1 L6.1 20.5 L7.5 13.8 L2.5 9.3 L9.2 8.6Z';
export const Stars = memo(function Stars({ n, size = 13 }: { n: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: Math.max(1, size * 0.08) }}>
      {[0, 1, 2, 3, 4].map(i => (
        <Svg key={i} width={size} height={size} viewBox="0 0 24 24">
          {i < n ? (
            <>
              <Path d={STAR_D} fill="#f7b52e" stroke="#a8670f" strokeWidth={1.6} strokeLinejoin="round" />
              <Path d="M12 5.5 L13.9 9.8 L18 10.3 L12 12.5 L6 10.3 L10.1 9.8Z" fill="#ffe58a" />
            </>
          ) : <Path d={STAR_D} fill="#2c2450" stroke="#4d4380" strokeWidth={1.6} strokeLinejoin="round" />}
        </Svg>
      ))}
    </View>
  );
});

export function ElChip({ el, small }: { el: ElementId; small?: boolean }) {
  const e = ELEMENTS[el];
  return (
    <View style={[st.chip, { backgroundColor: e.base, borderColor: e.dark, overflow: 'hidden' }, small && { paddingHorizontal: 7, paddingVertical: 0 }]}>
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: '50%', backgroundColor: 'rgba(255,255,255,0.18)' }} />
      <Text style={[st.chipText, small && { fontSize: 10.5 }, { color: readable(e.base) }, readable(e.base) === '#ffffff' ? { textShadowColor: 'rgba(0,0,0,0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 1 } : null]}>{e.name}</Text>
    </View>
  );
}
export function TypeChips({ ph, small }: { ph: Pheno; small?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      <ElChip el={ph.el1} small={small} />
      {ph.el2 ? <ElChip el={ph.el2} small={small} /> : null}
    </View>
  );
}
export function readable(hex: string): string {
  const v = parseInt(hex.slice(1), 16);
  const lum = (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
  return lum > 0.6 ? '#1b1420' : '#ffffff';
}

/** Male or female, drawn (a text symbol would come out in whatever font the phone falls back to). */
export const SexMark = memo(function SexMark({ sex, size = 13 }: { sex: 'M' | 'F'; size?: number }) {
  const col = sex === 'M' ? C.male : C.female;
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16">
      {sex === 'M' ? (
        <>
          <Circle cx={6.4} cy={9.6} r={4} stroke={col} strokeWidth={2} fill="none" />
          <Path d="M9.4 6.6 L13.6 2.4 M9.8 2.4 H13.6 V6.2" stroke={col} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </>
      ) : (
        <>
          <Circle cx={8} cy={5.8} r={4} stroke={col} strokeWidth={2} fill="none" />
          <Path d="M8 9.8 V15 M5.2 12.6 H10.8" stroke={col} strokeWidth={2} strokeLinecap="round" fill="none" />
        </>
      )}
    </Svg>
  );
});

/** The little marks beside a name: a gold twinkle for a shiny, an orange gem for a creature carrying something rare. */
export const Mark = memo(function Mark({ kind, size = 12 }: { kind: 'shiny' | 'carrier'; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16">
      {kind === 'shiny'
        ? <Path d="M8 0.8 Q8.8 6.2 15.2 8 Q8.8 9.8 8 15.2 Q7.2 9.8 0.8 8 Q7.2 6.2 8 0.8Z" fill={C.gold} stroke="#a8670f" strokeWidth={0.9} strokeLinejoin="round" />
        : <Path d="M8 1.6 L14 8 L8 14.4 L2 8Z" fill={C.accent2} stroke="#a3501a" strokeWidth={0.9} strokeLinejoin="round" />}
    </Svg>
  );
});

/** Health colours: green while healthy, yellow once it's down to half, red when it's in danger. */
export function hpColor(frac: number): string {
  return frac > 0.5 ? '#5ad17a' : frac > 0.2 ? '#f5c542' : '#f0616d';
}

export const Bar = memo(function Bar({ frac, color, height = 6, back = '#120d20', trail }: { frac: number; color: string; height?: number; back?: string; /** Show the amount just lost as a pale sliver that drains after a beat. */ trail?: boolean }) {
  const f = Math.max(0, Math.min(1, frac));
  const [w, setW] = useState(0);
  // A fight's bars start at their value; menu bars sweep up from empty when they appear.
  const grow = useRef(new Animated.Value(trail ? f : 0)).current;
  const ghost = useRef(new Animated.Value(f)).current;
  const last = useRef(f);
  // The fill is always full width and slides in from the left on the native thread (so a screen full of bars
  // changing at once costs the JS thread nothing). Sliding, rather than scaling, keeps the end rounded and
  // lets it reach right to the end on iOS.
  useEffect(() => {
    const drop = f < last.current;
    last.current = f;
    Animated.timing(grow, { toValue: f, duration: trail && drop ? 160 : 550, easing: Easing.out(Easing.cubic), useNativeDriver: ND }).start();
    if (!trail) return;
    // Losing health: the bar drops at once and the lost part lingers, then drains. Gaining: both rise together.
    if (drop) Animated.sequence([Animated.delay(340), Animated.timing(ghost, { toValue: f, duration: 420, easing: Easing.inOut(Easing.quad), useNativeDriver: ND })]).start();
    else Animated.timing(ghost, { toValue: f, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: ND }).start();
  }, [f, grow, ghost, trail]);
  const slide = (v: Animated.Value) => ({ transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-w, 0] }) }] });
  return (
    <View onLayout={e => setW(e.nativeEvent.layout.width)} style={{ height, backgroundColor: back, borderRadius: height / 2, overflow: 'hidden', borderWidth: height >= 6 ? 1 : 0, borderColor: 'rgba(0,0,0,0.35)' }}>
      {w > 0 && trail ? <Animated.View style={[{ position: 'absolute', left: 0, top: 0, bottom: 0, width: w, borderRadius: height / 2, backgroundColor: '#fff4d6' }, slide(ghost)]} /> : null}
      {w > 0 ? (
        <Animated.View style={[{ position: 'absolute', left: 0, top: 0, bottom: 0, width: w, borderRadius: height / 2, overflow: 'hidden', backgroundColor: color }, slide(grow)]}>
          <Grad colors={[mixHex(color, '#ffffff', 0.35), color]} />
          {height >= 5 ? <View style={{ position: 'absolute', left: 2, right: 2, top: 1, height: Math.max(1, height * 0.28), borderRadius: height, backgroundColor: 'rgba(255,255,255,0.3)' }} /> : null}
        </Animated.View>
      ) : null}
    </View>
  );
});

/** A creature that breathes gently: cheap enough for a whole grid of them. */
export const Breathing = memo(function Breathing({ children, size }: { children: React.ReactNode; size: number }) {
  const t = useLoop(useMemo(() => 2400 + Math.random() * 1000, []));
  const fy = size * 0.4;
  return (
    <Animated.View style={{ transform: [{ translateY: fy }, { scaleY: pulse(t, 1, 1.03) }, { scaleX: pulse(t, 1, 0.988) }, { translateY: -fy }] }}>
      {children}
    </Animated.View>
  );
});

/** A roster tile: the creature on a little lit stage in its element's colour, with name, level, stars and type. */
export const CreatureTile = memo(function CreatureTile({ c, onPress, selected, badge, dimmed, width }: { c: Creature; onPress?: () => void; selected?: boolean; badge?: string; dimmed?: boolean; width: number }) {
  const ph = useMemo(() => express(c.g), [c.g]);
  const stage = stageOf(c);
  const carrier = rareCarrierCount(c.g) > 0;
  const stars = starRating(c.g);
  const e = ELEMENTS[ph.el1];
  const pr = usePress(0.95);
  const shine = useLoop(2600, stars >= 4);
  const art = width - 14;
  return (
    <Pressable onPress={onPress ? () => { haptic('select'); onPress(); } : undefined} onPressIn={pr.onPressIn} onPressOut={pr.onPressOut}>
      <Animated.View style={[{ width, opacity: dimmed ? 0.45 : 1, borderRadius: 16, transform: [{ scale: pr.scale }] }, shadow(selected ? C.gold : '#000', selected ? 12 : 8, selected ? 0.6 : 0.3, selected ? 0 : 3)]}>
        <View style={[st.tile, { borderColor: selected ? C.gold : 'rgba(255,255,255,0.08)', borderWidth: selected ? 2 : 1 }]}>
          <Grad colors={[mixHex(PANEL[0], e.base, 0.28), PANEL[1]]} />
          {stars >= 4 ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: 15, borderWidth: 1.5, borderColor: stars >= 5 ? '#ffd34d' : '#c2b0ff', opacity: pulse(shine, 0.25, 0.9) }]} /> : null}
          <View style={{ width: art, height: art * 0.92, alignSelf: 'center', alignItems: 'center', justifyContent: 'flex-end' }}>
            <Glow color={e.light} opacity={0.5} cy="58%" r="48%" />
            <Svg width={art * 0.62} height={art * 0.12} style={{ position: 'absolute', bottom: art * 0.05 }}><Ellipse cx={art * 0.31} cy={art * 0.06} rx={art * 0.31} ry={art * 0.06} fill="#000000" opacity={0.28} /></Svg>
            <View style={{ position: 'absolute', bottom: -art * 0.04 }}>
              <Breathing size={art}>
                <CreatureView ph={ph} stage={stage} size={art} shadow={false} />
              </Breathing>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            {/* The marks after the name are small, and a name that would not fit beside them is set a size down
                (and shrinks further on the phone) before it is ever cut short. */}
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ color: C.text, fontFamily: F.semi, fontSize: c.name.length + 1.6 * (1 + (ph.shiny ? 1 : 0) + (carrier ? 1 : 0)) > 11.5 ? 12 : 14, flexShrink: 1 }}>{c.name}</Text>
            <SexMark sex={c.sex} size={11} />
            {ph.shiny ? <Mark kind="shiny" size={11} /> : null}
            {carrier ? <Mark kind="carrier" size={10} /> : null}
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 }}>
              <Text style={{ color: '#e9e1ff', fontFamily: F.semi, fontSize: 10.5 }}>Lv {c.level} · {STAGE_NAMES[stage]}</Text>
            </View>
          </View>
          <Stars n={stars} size={10} />
          <TypeChips ph={ph} small />
          {badge ? (
            <View style={st.badge}>
              {badge === '✓' ? <Icon name="check" size={11} color="#3d2400" /> : badge === '★' ? <Icon name="star" size={11} color="#3d2400" /> : <Text style={{ color: '#3d2400', fontSize: 10, fontFamily: F.bold }}>{badge}</Text>}
            </View>
          ) : null}
        </View>
      </Animated.View>
    </Pressable>
  );
});

export function MoveRow({ mv, cd, compact }: { mv: MoveDef; cd?: number; compact?: boolean }) {
  const e = ELEMENTS[mv.el];
  return (
    <View style={[st.move, { borderLeftColor: e.base, overflow: 'hidden' }]}>
      <Grad colors={[mixHex('#43376f', e.base, 0.16), '#3a2e66']} horizontal />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={{ color: C.text, fontFamily: F.semi, fontSize: 15, flex: 1 }} numberOfLines={1}>{mv.name}</Text>
        <View style={{ borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1, borderWidth: 1, borderColor: RARITY_COLORS[mv.rarity] }}>
          <Text style={{ color: RARITY_COLORS[mv.rarity], fontSize: 10, fontFamily: F.semi }}>{RARITY_NAMES[mv.rarity]}</Text>
        </View>
      </View>
      {compact ? null : <Text style={{ color: C.dim, fontSize: 11 }}>{mv.desc}{mv.cd ? `  · cooldown ${mv.cd}` : ''}</Text>}
      {cd ? <Text style={{ color: C.bad, fontSize: 11 }}>Ready in {cd}</Text> : null}
    </View>
  );
}

export const describeCreature = (c: Creature) => `${typeLabel(express(c.g))} · Lv ${c.level} ${STAGE_NAMES[stageOf(c)]}`;

export const st = StyleSheet.create({
  btn: { paddingVertical: 11, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center', borderWidth: 1 },
  btnSmall: { paddingVertical: 7, paddingHorizontal: 11, borderRadius: 9 },
  btnText: { fontSize: 16, fontFamily: F.bold },
  card: { backgroundColor: C.panel, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  h: { color: C.text, fontSize: 21, fontFamily: F.bold, marginBottom: 6, letterSpacing: 0.2 },
  p: { color: C.text, fontSize: 13, lineHeight: 18 },
  chip: { paddingHorizontal: 9, paddingVertical: 2, borderRadius: 10, borderWidth: 1 },
  chipText: { fontSize: 11.5, fontFamily: F.semi },
  tile: { backgroundColor: C.panel, borderRadius: 16, padding: 7, gap: 3, overflow: 'hidden' },
  badge: { position: 'absolute', top: 6, left: 6, backgroundColor: C.gold, borderRadius: 7, paddingHorizontal: 6, paddingVertical: 1 },
  move: { backgroundColor: C.panel2, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10, borderLeftWidth: 4, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
