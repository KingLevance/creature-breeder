// Shared look and small building blocks used by every screen.
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';
import { ELEMENTS, ElementId } from '../game/data/elements';
import { MoveDef, RARITY_COLORS, RARITY_NAMES } from '../game/data/moves';
import { Creature, STAGE_NAMES, stageOf, typeLabel } from '../game/creature';
import { Pheno, express, rareCarrierCount, starRating } from '../game/genome';
import { tap } from './audio';
import { Pose, Rig, Shape, creatureOpacity, drawCreature, drawCreatureRig, drawEgg, poseWeights } from '../render/creature';

export const C = {
  bg: '#171226', panel: '#231b3a', panel2: '#2e2450', line: '#43366b', text: '#f4efff', dim: '#a99fc9',
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

/** Drawn frames per creature. Idle and walk cycles repeat the same dozen frames, so each is drawn once. */
const frameCache = new WeakMap<Pheno, Map<string, Shape[]>>();
function drawCached(ph: Pheno, stage: number, phase: number, walking?: boolean, shadow?: boolean, ko?: boolean, pose?: Pose): Shape[] {
  let m = frameCache.get(ph);
  if (!m) { m = new Map(); frameCache.set(ph, m); }
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
const rigCache = new WeakMap<Pheno, Map<string, Rig>>();
function rigCached(ph: Pheno, o: { stage: number; phase: number; walking?: boolean; shadow?: boolean; ko?: boolean; pose?: Pose; reach: number; raise: number; guard: number; look: number }): Rig {
  let m = rigCache.get(ph);
  if (!m) { m = new Map(); rigCache.set(ph, m); }
  const key = `${o.stage}|${o.phase.toFixed(3)}|${o.walking ? 1 : 0}|${o.shadow === false ? 0 : 1}|${o.ko ? 1 : 0}|${o.pose ?? 'idle'}|${o.reach.toFixed(2)}|${o.raise.toFixed(2)}|${o.guard.toFixed(2)}|${o.look}`;
  let r = m.get(key);
  if (!r) {
    r = drawCreatureRig(ph, o);
    if (m.size > 160) m.clear();
    m.set(key, r);
  }
  return r;
}
/** Whether anything in a creature's resting drawing moves with the idle cycle (orbiting orbs, flickers, motes). */
const detailCache = new WeakMap<Pheno, Map<number, boolean>>();
function hasIdleDetail(ph: Pheno, stage: number): boolean {
  let m = detailCache.get(ph);
  if (!m) { m = new Map(); detailCache.set(ph, m); }
  let v = m.get(stage);
  if (v == null) {
    const at = (phase: number) => JSON.stringify(drawCreatureRig(ph, { stage, phase }).main);
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
export const LiveCreature = memo(function LiveCreature(props: Omit<CreatureViewProps, 'phase'> & { pose?: Pose; fidget?: boolean }) {
  const { ph, stage, size, flip, shadow, ko } = props;
  const walking = !!props.walking && !ko;
  const detail = useMemo(() => hasIdleDetail(ph, stage), [ph, stage]);
  // Drawn frames: walking legs (16 per stride), or slow detail frames for creatures with moving bits.
  const [frame, setFrame] = useState(() => Math.floor(Math.random() * 12));
  useEffect(() => {
    if (!walking && !detail) return;
    const id = setInterval(() => setFrame(f => (f + 1) % (walking ? WALK_FRAMES : IDLE_FRAMES)), walking ? WALK_MS : IDLE_MS);
    return () => clearInterval(id);
  }, [walking, detail]);
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
        if (pick === 'hop') Animated.sequence([0, 1, 0, 0.6, 0].map((v, i) => Animated.timing(hop, { toValue: v, duration: [1, 150, 170, 120, 140][i], easing: v ? Easing.out(Easing.quad) : Easing.in(Easing.quad), useNativeDriver: ND }))).start();
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
  const off = useMemo(() => Math.random(), []);
  const [wingSwing, wingMs] = useMemo(() => wingMotion(ph), [ph]);
  const period = useMemo(() => 2400 + Math.random() * 900, []);
  useEffect(() => {
    if (ko) return;
    const l1 = Animated.loop(Animated.timing(breath, { toValue: 1, duration: walking ? 700 : period, easing: Easing.linear, useNativeDriver: ND }));
    const l2 = Animated.loop(Animated.timing(beat, { toValue: 1, duration: walking ? Math.min(wingMs, 600) : wingMs, easing: Easing.linear, useNativeDriver: ND }));
    breath.setValue(0); beat.setValue(0);
    l1.start(); l2.start();
    return () => { l1.stop(); l2.stop(); };
  }, [ko, walking, period, wingMs, breath, beat]);
  const anim = useMemo(() => {
    const fly = ph.skel === 'floater' || ph.skel === 'aquatic';
    const amp = ko ? 0 : 1;
    const sy = wave(breath, 0.024 * amp, 1, 1, off), sx = wave(breath, -0.011 * amp, 1, 1, off);
    const tailBase = wave(breath, (TAIL_SWING[ph.tail] ?? 5) * amp, 0, 1, off - 0.18);
    const tail = deg(Animated.add(tailBase, Animated.multiply(flick, 16)));
    const wing = deg(wave(beat, wingSwing * amp, 0, 1, off));
    const wingFar = deg(wave(beat, wingSwing * 0.8 * amp, 0, 1, off - 0.08));
    const hover = fly ? wave(breath, 1.6 * amp * (size / 100), 0, 1, off + 0.25) : null;
    const lift = Animated.multiply(hop, -size * 0.08);
    const rot = deg(Animated.multiply(wiggle, 5));
    return { sy, sx, tail, wing, wingFar, hover, lift, rot };
  }, [ph, ko, breath, beat, flick, hop, wiggle, off, wingSwing, size]);

  const s = size / 100, fy = 40 * s;
  const svg = (shapes: Shape[]) => (
    <Svg width={size} height={size} viewBox="0 0 100 100" style={StyleSheet.absoluteFill}><ShapeNodes shapes={shapes} /></Svg>
  );
  return (
    <Animated.View style={{
      width: size, height: size, opacity: creatureOpacity(ph),
      transform: [
        { scaleX: flip ? -1 : 1 },
        { translateY: anim.hover ? Animated.add(anim.lift, anim.hover) : anim.lift },
        { translateY: fy }, { rotate: anim.rot }, { scaleY: anim.sy }, { scaleX: anim.sx }, { translateY: -fy },
      ],
    }}>
      {rig.wingFar.length && rig.pivots.wingFar ? <Animated.View style={[StyleSheet.absoluteFill, { transform: about(rig.pivots.wingFar, size, anim.wingFar) }]}>{svg(rig.wingFar)}</Animated.View> : null}
      {rig.tail.length && rig.pivots.tail ? <Animated.View style={[StyleSheet.absoluteFill, { transform: about(rig.pivots.tail, size, anim.tail) }]}>{svg(rig.tail)}</Animated.View> : null}
      {svg(rig.main)}
      {rig.wingNear.length && rig.pivots.wingNear ? <Animated.View style={[StyleSheet.absoluteFill, { transform: about(rig.pivots.wingNear, size, anim.wing) }]}>{svg(rig.wingNear)}</Animated.View> : null}
    </Animated.View>
  );
});
const IDLE_FRAMES = 12, IDLE_MS = 150, WALK_FRAMES = 16, WALK_MS = 42;

export const EggView = memo(function EggView({ ph, size, wobble = 0 }: { ph: Pheno; size: number; wobble?: number }) {
  const shapes = useMemo(() => drawEgg(ph, wobble), [ph, wobble]);
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <ShapeNodes shapes={shapes} />
    </Svg>
  );
});

export function Btn({ label, onPress, disabled, kind = 'main', small, style }: { label: string; onPress: () => void; disabled?: boolean; kind?: 'main' | 'ghost' | 'gold' | 'danger'; small?: boolean; style?: ViewStyle }) {
  const bg = disabled ? '#3a3256' : kind === 'gold' ? C.gold : kind === 'danger' ? C.bad : kind === 'ghost' ? 'transparent' : C.accent;
  const fg = disabled ? C.dim : kind === 'gold' ? '#2a1d00' : C.text;
  return (
    <Pressable onPress={disabled ? undefined : () => { tap(); onPress(); }} style={({ pressed }) => [st.btn, small && st.btnSmall, { backgroundColor: bg, borderColor: kind === 'ghost' ? C.line : bg, opacity: pressed ? 0.75 : 1 }, style]}>
      <Text style={[st.btnText, small && { fontSize: 13 }, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

export function Card({ children, style, onPress }: { children: React.ReactNode; style?: ViewStyle; onPress?: () => void }) {
  if (onPress) return <Pressable onPress={onPress} style={({ pressed }) => [st.card, style, pressed && { opacity: 0.8 }]}>{children}</Pressable>;
  return <View style={[st.card, style]}>{children}</View>;
}

export const H = ({ children }: { children: React.ReactNode }) => <Text style={st.h}>{children}</Text>;
export const P = ({ children, dim, style }: { children: React.ReactNode; dim?: boolean; style?: any }) => <Text style={[st.p, dim && { color: C.dim }, style]}>{children}</Text>;

export function Stars({ n, size = 13 }: { n: number; size?: number }) {
  return (
    <Text style={{ fontSize: size, letterSpacing: 1 }}>
      <Text style={{ color: C.gold }}>{'★'.repeat(n)}</Text>
      <Text style={{ color: '#4a416b' }}>{'★'.repeat(5 - n)}</Text>
    </Text>
  );
}

export function ElChip({ el, small }: { el: ElementId; small?: boolean }) {
  const e = ELEMENTS[el];
  return (
    <View style={[st.chip, { backgroundColor: e.base, borderColor: e.dark }, small && { paddingHorizontal: 5, paddingVertical: 1 }]}>
      <Text style={[st.chipText, small && { fontSize: 10 }, { color: readable(e.base) }]}>{e.name}</Text>
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

export const SexMark = ({ sex }: { sex: 'M' | 'F' }) => <Text style={{ color: sex === 'M' ? C.male : C.female, fontWeight: '800', fontSize: 14 }}>{sex === 'M' ? '♂' : '♀'}</Text>;

export function Bar({ frac, color, height = 6, back = '#120d20' }: { frac: number; color: string; height?: number; back?: string }) {
  return (
    <View style={{ height, backgroundColor: back, borderRadius: height / 2, overflow: 'hidden' }}>
      <View style={{ width: `${Math.max(0, Math.min(1, frac)) * 100}%`, height, backgroundColor: color, borderRadius: height / 2 }} />
    </View>
  );
}

/** A roster tile: portrait, name, level, stars, type. */
export const CreatureTile = memo(function CreatureTile({ c, onPress, selected, badge, dimmed, width }: { c: Creature; onPress?: () => void; selected?: boolean; badge?: string; dimmed?: boolean; width: number }) {
  const ph = useMemo(() => express(c.g), [c.g]);
  const stage = stageOf(c);
  const carrier = rareCarrierCount(c.g) > 0;
  return (
    <Pressable onPress={onPress} style={[st.tile, { width, opacity: dimmed ? 0.45 : 1, borderColor: selected ? C.gold : C.line, borderWidth: selected ? 2 : 1 }]}>
      <View style={{ alignItems: 'center' }}>
        <CreatureView ph={ph} stage={stage} size={width - 26} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Text numberOfLines={1} style={[st.p, { fontWeight: '700', flexShrink: 1 }]}>{c.name}</Text>
        <SexMark sex={c.sex} />
        {carrier ? <Text style={{ color: C.accent2, fontSize: 11 }}>◆</Text> : null}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: C.dim, fontSize: 11 }}>Lv {c.level} {STAGE_NAMES[stage]}</Text>
        <Stars n={starRating(c.g)} size={10} />
      </View>
      <TypeChips ph={ph} small />
      {badge ? <View style={st.badge}><Text style={{ color: '#1b1420', fontSize: 10, fontWeight: '800' }}>{badge}</Text></View> : null}
    </Pressable>
  );
});

export function MoveRow({ mv, cd, compact }: { mv: MoveDef; cd?: number; compact?: boolean }) {
  const e = ELEMENTS[mv.el];
  return (
    <View style={[st.move, { borderLeftColor: e.base }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={[st.p, { fontWeight: '700', flex: 1 }]} numberOfLines={1}>{mv.name}</Text>
        <Text style={{ color: RARITY_COLORS[mv.rarity], fontSize: 10, fontWeight: '700' }}>{RARITY_NAMES[mv.rarity]}</Text>
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
  btnText: { fontSize: 15, fontWeight: '800' },
  card: { backgroundColor: C.panel, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: C.line, marginBottom: 10 },
  h: { color: C.text, fontSize: 18, fontWeight: '800', marginBottom: 6 },
  p: { color: C.text, fontSize: 13, lineHeight: 18 },
  chip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, borderWidth: 1 },
  chipText: { fontSize: 11, fontWeight: '800' },
  tile: { backgroundColor: C.panel, borderRadius: 12, padding: 6, gap: 2 },
  badge: { position: 'absolute', top: 4, left: 4, backgroundColor: C.gold, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  move: { backgroundColor: C.panel2, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 8, borderLeftWidth: 4, marginBottom: 5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
