// Visual effects for fights: projectiles, beams, impact bursts, support sparkles and dust puffs.
// Each effect runs its own native-driver animation and removes itself when done.
import React, { memo, useEffect, useRef } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, Path, Polygon, RadialGradient, Stop } from 'react-native-svg';
import { ELEMENTS, ElementId } from '../game/data/elements';

export type FxSpec =
  | { id: number; kind: 'proj'; el: ElementId; x1: number; y1: number; x2: number; y2: number; dur: number }
  | { id: number; kind: 'beam'; el: ElementId; x1: number; y1: number; x2: number; y2: number; dur: number }
  | { id: number; kind: 'burst'; el: ElementId; x: number; y: number; big?: boolean }
  | { id: number; kind: 'charge'; el: ElementId; x: number; y: number }
  | { id: number; kind: 'aura'; color: string; x: number; y: number }
  | { id: number; kind: 'puff'; x: number; y: number; color?: string }
  /** A comic hit star with speed lines. */
  | { id: number; kind: 'impact'; el: ElementId; x: number; y: number; big?: boolean }
  /** Claw or blade streaks across a target. */
  | { id: number; kind: 'slash'; el: ElementId; x: number; y: number; dir: number; n: number; s: number }
  /** Jaws snapping shut. */
  | { id: number; kind: 'chomp'; x: number; y: number; s: number }
  /** A ring of dust and flying rubble on the ground. */
  | { id: number; kind: 'shock'; el: ElementId; x: number; y: number; w: number }
  /** Speed lines along a dash. */
  | { id: number; kind: 'streak'; el: ElementId; x1: number; x2: number; y: number; h: number }
  /** Lightning or a pillar of light from the sky. */
  | { id: number; kind: 'bolt'; el: ElementId; x: number; y: number }
  /** Spikes, vines or flames bursting out of the ground. */
  | { id: number; kind: 'erupt'; el: ElementId; x: number; y: number; s: number }
  /** A wave rolling along the ground. */
  | { id: number; kind: 'wave'; el: ElementId; x1: number; x2: number; y: number; s: number; dur: number }
  /** A cone of breath from the mouth to the target. */
  | { id: number; kind: 'breath'; el: ElementId; x1: number; y1: number; x2: number; y2: number; dur: number }
  /** A whirl of wind around a rolling attacker. */
  | { id: number; kind: 'whirl'; el: ElementId; x: number; y: number; r: number }
  /** The whole field flashes. */
  | { id: number; kind: 'flash'; color: string }
  /** Healing: a soft ring and plus signs floating up. */
  | { id: number; kind: 'heal'; x: number; y: number; s: number; color: string }
  /** A shield bubble forming around a creature. */
  | { id: number; kind: 'shieldUp'; x: number; y: number; s: number }
  /** A stat going up (arrows rising) or down (arrows sinking). */
  | { id: number; kind: 'stat'; x: number; y: number; s: number; color: string; up: boolean };

/** An effect before it has been given an id. */
export type FxNew = FxSpec extends infer T ? (T extends FxSpec ? Omit<T, 'id'> : never) : never;

const LOBBED: ElementId[] = ['stone', 'terra', 'venom'];
const BEAMS: ElementId[] = ['spark', 'radiant'];
export const isBeam = (el: ElementId) => BEAMS.includes(el);

/** A projectile drawn around (0,0), pointing right, about 24 units across. */
function ProjShape({ el }: { el: ElementId }) {
  const e = ELEMENTS[el];
  switch (el) {
    case 'ember':
      return (<G><Path d="M-12 0 Q-4 -9 6 -5 Q12 0 6 5 Q-4 9 -12 0Z" fill={e.base} /><Circle cx={4} cy={0} r={5.5} fill={e.light} /><Circle cx={5} cy={0} r={3} fill={e.glow} /></G>);
    case 'tide':
      return (<G><Circle r={8} fill={e.base} opacity={0.9} /><Circle cx={-2} cy={-2.5} r={3} fill={e.glow} opacity={0.8} /><Path d="M-8 0 Q-16 -4 -20 0 Q-16 4 -8 0Z" fill={e.light} opacity={0.7} /></G>);
    case 'verdant':
      return (<G><Path d="M-10 0 Q0 -10 10 0 Q0 10 -10 0Z" fill={e.base} stroke={e.dark} strokeWidth={1} /><Path d="M-10 0 L10 0" stroke={e.dark} strokeWidth={1} /></G>);
    case 'frost': case 'forge':
      return (<G><Polygon points="-10,-4 10,0 -10,4 -6,0" fill={el === 'frost' ? e.light : e.base} stroke={e.dark} strokeWidth={1} /><Polygon points="-4,-2 8,0 -4,2" fill={e.glow} /></G>);
    case 'venom':
      return (<G><Circle r={7} fill={e.base} /><Circle cx={2} cy={-2} r={3} fill={e.glow} /><Circle cx={-9} cy={3} r={2.5} fill={e.base} opacity={0.7} /></G>);
    case 'stone': case 'terra': case 'brawn': case 'plain':
      return (<G><Polygon points="-7,-5 2,-8 8,-2 6,6 -3,8 -8,2" fill={e.base} stroke={e.dark} strokeWidth={1.2} /><Polygon points="-3,-4 2,-5 3,-1" fill={e.light} /></G>);
    case 'gale':
      return (<G><Path d="M-6 -10 Q8 0 -6 10 Q2 0 -6 -10Z" fill={e.light} stroke={e.dark} strokeWidth={0.8} /><Path d="M-14 -4 L-6 -4 M-16 3 L-7 3" stroke={e.light} strokeWidth={1.5} /></G>);
    case 'mind':
      return (<G><Ellipse rx={5} ry={10} fill="none" stroke={e.base} strokeWidth={3} /><Ellipse rx={2.5} ry={5} fill="none" stroke={e.glow} strokeWidth={1.5} /></G>);
    case 'swarm':
      return (<G>{[[-6, -4], [0, 2], [5, -3], [-2, 6], [8, 3]].map(([x, y], i) => <Circle key={i} cx={x} cy={y} r={2.2} fill={i % 2 ? e.dark : e.base} />)}</G>);
    case 'spirit':
      return (<G opacity={0.85}><Path d="M-16 2 Q-8 -6 0 -6 Q8 -6 8 0 Q8 6 0 6 Q-8 6 -16 2Z" fill={e.light} /><Circle cx={2} cy={0} r={4} fill={e.glow} /></G>);
    case 'wyrm':
      return (<G><Path d="M-14 0 Q-4 -10 8 -4 Q12 0 8 4 Q-4 10 -14 0Z" fill={e.base} /><Circle cx={4} cy={0} r={4.5} fill="#ffd166" /></G>);
    case 'shade': case 'void':
      return (<G><Circle r={10} fill={e.glow} opacity={0.35} /><Circle r={7} fill={e.dark} /><Circle r={7} fill="none" stroke={e.glow} strokeWidth={1.5} /></G>);
    case 'glimmer':
      return (<Path d="M0 -10 L3 -3 L10 0 L3 3 L0 10 L-3 3 L-10 0 L-3 -3Z" fill={e.glow} stroke={e.base} strokeWidth={1} />);
    default:
      return (<G><Circle r={8} fill={e.base} /><Circle r={4} fill={e.glow} /></G>);
  }
}

function useRun(dur: number, done: () => void, easing = Easing.linear) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: dur, easing, useNativeDriver: true }).start(() => done());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return t;
}

const Proj = memo(function Proj({ s, done }: { s: Extract<FxSpec, { kind: 'proj' }>; done: () => void }) {
  const t = useRun(s.dur, done, Easing.in(Easing.quad));
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  const arc = LOBBED.includes(s.el) ? Math.min(60, Math.abs(dx) * 0.25) : 0;
  const copy = (lag: number, scale: number, op: number) => {
    const tt = t.interpolate({ inputRange: [0, 1], outputRange: [-lag, 1 - lag], extrapolate: 'clamp' });
    const x = tt.interpolate({ inputRange: [0, 1], outputRange: [s.x1, s.x2] });
    const y = tt.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [s.y1, s.y1 + dy * 0.25 - arc * 0.75, s.y1 + dy * 0.5 - arc, s.y1 + dy * 0.75 - arc * 0.75, s.y2] });
    const spin = arc ? tt.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '540deg'] }) : `${ang}deg`;
    return (
      <Animated.View key={lag} pointerEvents="none" style={{ position: 'absolute', left: -20, top: -20, width: 40, height: 40, opacity: tt.interpolate({ inputRange: [-0.2, 0, 0.95, 1], outputRange: [0, op, op, 0] }), transform: [{ translateX: x }, { translateY: y }, { rotate: spin as any }, { scale }] }}>
        <Svg width={40} height={40} viewBox="-20 -20 40 40"><ProjShape el={s.el} /></Svg>
      </Animated.View>
    );
  };
  return <>{copy(0.16, 0.55, 0.35)}{copy(0.08, 0.75, 0.6)}{copy(0, 1.15, 1)}</>;
});

const Beam = memo(function Beam({ s, done, W, H }: { s: Extract<FxSpec, { kind: 'beam' }>; done: () => void; W: number; H: number }) {
  const t = useRun(s.dur, done);
  const e = ELEMENTS[s.el];
  let d = `M${s.x1} ${s.y1}`;
  if (s.el === 'spark') {
    const n = 7;
    for (let i = 1; i < n; i++) d += ` L${s.x1 + ((s.x2 - s.x1) * i) / n} ${s.y1 + ((s.y2 - s.y1) * i) / n + (i % 2 ? -10 : 10)}`;
  }
  d += ` L${s.x2} ${s.y2}`;
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, opacity: t.interpolate({ inputRange: [0, 0.15, 0.3, 0.45, 1], outputRange: [0, 1, 0.5, 1, 0] }) }}>
      <Svg width={W} height={H}>
        <Path d={d} stroke={e.base} strokeWidth={s.el === 'radiant' ? 14 : 7} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={0.6} />
        <Path d={d} stroke={e.glow} strokeWidth={s.el === 'radiant' ? 6 : 2.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </Svg>
    </Animated.View>
  );
});

const Burst = memo(function Burst({ s, done }: { s: Extract<FxSpec, { kind: 'burst' }>; done: () => void }) {
  const t = useRun(s.big ? 520 : 400, done, Easing.out(Easing.cubic));
  const e = ELEMENTS[s.el];
  const R = s.big ? 46 : 32;
  const ring = (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', left: s.x - R, top: s.y - R, width: R * 2, height: R * 2, opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.95, 0] }), transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) }] }}>
      <Svg width={R * 2} height={R * 2}><Circle cx={R} cy={R} r={R - 4} stroke={e.glow} strokeWidth={4} fill={e.base} fillOpacity={0.25} /></Svg>
    </Animated.View>
  );
  const parts = Array.from({ length: s.big ? 9 : 6 }, (_, i) => {
    const a = (i / (s.big ? 9 : 6)) * Math.PI * 2 + 0.3;
    const r = R * (0.9 + (i % 3) * 0.2);
    return (
      <Animated.View key={i} pointerEvents="none" style={{ position: 'absolute', left: s.x - 4, top: s.y - 4, width: 8, height: 8, borderRadius: 4, backgroundColor: i % 2 ? e.glow : e.base,
        opacity: t.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 0.8, 0] }),
        transform: [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(a) * r] }) }, { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(a) * r] }) }, { scale: t.interpolate({ inputRange: [0, 1], outputRange: [1.2, 0.3] }) }] }} />
    );
  });
  return <>{ring}{parts}</>;
});

const Charge = memo(function Charge({ s, done }: { s: Extract<FxSpec, { kind: 'charge' }>; done: () => void }) {
  const t = useRun(320, done, Easing.out(Easing.quad));
  const e = ELEMENTS[s.el];
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', left: s.x - 40, top: s.y - 40, width: 80, height: 80, opacity: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0.9, 0] }), transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [1.4, 0.5] }) }] }}>
      <Svg width={80} height={80}><Circle cx={40} cy={40} r={34} fill={e.glow} fillOpacity={0.35} stroke={e.base} strokeWidth={3} /></Svg>
    </Animated.View>
  );
});

const Aura = memo(function Aura({ s, done }: { s: Extract<FxSpec, { kind: 'aura' }>; done: () => void }) {
  const t = useRun(750, done, Easing.out(Easing.quad));
  const bits = [-18, -8, 2, 12, 20].map((dx, i) => (
    <Animated.Text key={i} pointerEvents="none" style={{ position: 'absolute', left: s.x + dx - 6, top: s.y, color: s.color, fontSize: 14 + (i % 2) * 4, fontWeight: '900',
      opacity: t.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 0] }),
      transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [10, -46 - (i % 3) * 10] }) }] }}>{i % 2 ? '✦' : '+'}</Animated.Text>
  ));
  const ring = (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', left: s.x - 34, top: s.y + 6, width: 68, height: 20, opacity: t.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 0.9, 0] }), transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.3] }) }] }}>
      <Svg width={68} height={20}><Ellipse cx={34} cy={10} rx={31} ry={8} stroke={s.color} strokeWidth={3} fill={s.color} fillOpacity={0.2} /></Svg>
    </Animated.View>
  );
  return <>{ring}{bits}</>;
});

const Puff = memo(function Puff({ s, done }: { s: Extract<FxSpec, { kind: 'puff' }>; done: () => void }) {
  const t = useRun(650, done, Easing.out(Easing.quad));
  const col = s.color ?? '#e9e3f5';
  return (
    <>
      {[-22, -10, 0, 10, 22].map((dx, i) => (
        <Animated.View key={i} pointerEvents="none" style={{ position: 'absolute', left: s.x + dx - 9, top: s.y - 9, width: 18, height: 18, borderRadius: 9, backgroundColor: col,
          opacity: t.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.75, 0] }),
          transform: [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, dx * 0.8] }) }, { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -14 - (i % 2) * 14] }) }, { scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.6] }) }] }} />
      ))}
    </>
  );
});

/** A small seeded random, so an effect looks the same every time it renders. */
const rand = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return (seed % 1000) / 1000; };
const STAR = (R: number, r: number, n = 8, jitter?: () => number) =>
  Array.from({ length: n * 2 }, (_, i) => {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r : R * (jitter ? 0.75 + jitter() * 0.4 : 1);
    return `${(Math.cos(a) * rr).toFixed(1)},${(Math.sin(a) * rr).toFixed(1)}`;
  }).join(' ');

const Impact = memo(function Impact({ s, done }: { s: Extract<FxSpec, { kind: 'impact' }>; done: () => void }) {
  const t = useRun(s.big ? 360 : 280, done, Easing.out(Easing.cubic));
  const e = ELEMENTS[s.el];
  const R = s.big ? 40 : 28, j = rand(s.id + 3);
  const lines = Array.from({ length: 7 }, (_, i) => {
    const a = (i / 7) * Math.PI * 2 + j() * 0.5;
    return (
      <Animated.View key={i} pointerEvents="none" style={{ position: 'absolute', left: s.x - 9, top: s.y - 1.5, width: 18, height: 3, borderRadius: 2, backgroundColor: i % 2 ? '#ffffff' : e.glow,
        opacity: t.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 0] }),
        transform: [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [Math.cos(a) * R * 0.5, Math.cos(a) * R * 1.5] }) }, { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [Math.sin(a) * R * 0.5, Math.sin(a) * R * 1.5] }) }, { rotate: `${(a * 180) / Math.PI}deg` }] }} />
    );
  });
  return (
    <>
      <Animated.View pointerEvents="none" style={{ position: 'absolute', left: s.x - R, top: s.y - R, width: R * 2, height: R * 2,
        opacity: t.interpolate({ inputRange: [0, 0.15, 0.6, 1], outputRange: [0, 1, 0.9, 0] }),
        transform: [{ scale: t.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.3, 1.05, 1.2] }) }, { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['-8deg', '10deg'] }) }] }}>
        <Svg width={R * 2} height={R * 2} viewBox={`${-R} ${-R} ${R * 2} ${R * 2}`}>
          <Polygon points={STAR(R * 0.98, R * 0.5, 8, j)} fill={e.base} />
          <Polygon points={STAR(R * 0.68, R * 0.34, 8)} fill="#ffffff" />
          <Circle r={R * 0.2} fill={e.glow} />
        </Svg>
      </Animated.View>
      {lines}
    </>
  );
});

const Slash = memo(function Slash({ s, done }: { s: Extract<FxSpec, { kind: 'slash' }>; done: () => void }) {
  const t = useRun(260 + s.n * 50, done, Easing.out(Easing.quad));
  const e = ELEMENTS[s.el];
  const L = s.s, Hh = L * 0.36;
  const d = `M${-L / 2} ${-Hh / 2} Q0 ${Hh * 0.55} ${L / 2} ${Hh / 2} Q0 ${Hh * 0.05} ${-L / 2} ${-Hh / 2}Z`;
  return (
    <>
      {Array.from({ length: s.n }, (_, i) => {
        const off = (i - (s.n - 1) / 2) * L * 0.2, t0 = (i / s.n) * 0.25;
        const tt = t.interpolate({ inputRange: [t0, Math.min(1, t0 + 0.35)], outputRange: [0, 1], extrapolate: 'clamp' });
        return (
          <Animated.View key={i} pointerEvents="none" style={{ position: 'absolute', left: s.x - L / 2, top: s.y - Hh / 2 + off, width: L, height: Hh,
            opacity: t.interpolate({ inputRange: [t0, t0 + 0.05, 0.7, 1], outputRange: [0, 1, 0.9, 0], extrapolate: 'clamp' }),
            transform: [{ scaleX: s.dir }, { rotate: '-28deg' }, { translateX: tt.interpolate({ inputRange: [0, 1], outputRange: [-L * 0.35, 0] }) }, { scaleX: tt.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) }] }}>
            <Svg width={L} height={Hh} viewBox={`${-L / 2} ${-Hh / 2} ${L} ${Hh}`}>
              <Path d={d} fill={e.base} stroke={e.dark} strokeWidth={1} />
              <Path d={d} fill="#ffffff" transform="scale(0.85 0.45)" />
            </Svg>
          </Animated.View>
        );
      })}
    </>
  );
});

const Chomp = memo(function Chomp({ s, done }: { s: Extract<FxSpec, { kind: 'chomp' }>; done: () => void }) {
  const t = useRun(420, done, Easing.linear);
  const W = s.s, Hh = s.s * 0.42;
  const teeth = (down: boolean) => {
    const n = 5, w = W / n;
    let d = down ? `M0 0 L${W} 0 ` : `M0 ${Hh} L${W} ${Hh} `;
    for (let i = n - 1; i >= 0; i--) d += down ? `L${(i + 0.5) * w} ${Hh * 0.75} L${i * w} 0 ` : `L${(i + 0.5) * w} ${Hh * 0.25} L${i * w} ${Hh} `;
    return d + 'Z';
  };
  const jaw = (down: boolean) => (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', left: s.x - W / 2, top: s.y - Hh + (down ? -Hh * 0.2 : Hh * 1.2), width: W, height: Hh,
      opacity: t.interpolate({ inputRange: [0, 0.1, 0.75, 1], outputRange: [0, 1, 1, 0] }),
      transform: [{ translateY: t.interpolate({ inputRange: [0, 0.35, 0.45, 1], outputRange: down ? [-Hh * 0.9, Hh * 0.2, Hh * 0.15, Hh * 0.15] : [Hh * 0.9, -Hh * 0.2, -Hh * 0.15, -Hh * 0.15] }) }] }}>
      <Svg width={W} height={Hh}><Path d={teeth(down)} fill="#ffffff" stroke="#3a2f45" strokeWidth={1.6} strokeLinejoin="round" /></Svg>
    </Animated.View>
  );
  return <>{jaw(true)}{jaw(false)}</>;
});

const Shock = memo(function Shock({ s, done }: { s: Extract<FxSpec, { kind: 'shock' }>; done: () => void }) {
  const t = useRun(620, done, Easing.out(Easing.quad));
  const e = ELEMENTS[s.el];
  const dust = '#e3d3b4', j = rand(s.id + 11);
  const W = s.w, Hh = W * 0.24;
  const ring = (k: number, col: string) => (
    <Animated.View key={k} pointerEvents="none" style={{ position: 'absolute', left: s.x - W / 2, top: s.y - Hh / 2, width: W, height: Hh,
      opacity: t.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 0.9, 0] }),
      transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.25 + k * 0.1, 1.25 + k * 0.25] }) }] }}>
      <Svg width={W} height={Hh}><Ellipse cx={W / 2} cy={Hh / 2} rx={W / 2 - 3} ry={Hh / 2 - 2} stroke={col} strokeWidth={4 - k} fill={col} fillOpacity={0.12} /></Svg>
    </Animated.View>
  );
  const rocks = Array.from({ length: 8 }, (_, i) => {
    const dx = (i - 3.5) * W * 0.11 + (j() - 0.5) * 8, up = 18 + j() * 30, r = 3 + j() * 3.5;
    return (
      <Animated.View key={'r' + i} pointerEvents="none" style={{ position: 'absolute', left: s.x - r, top: s.y - r, width: r * 2, height: r * 2, borderRadius: r * 0.5, backgroundColor: i % 3 === 0 ? e.dark : i % 3 === 1 ? dust : e.base,
        opacity: t.interpolate({ inputRange: [0, 0.75, 1], outputRange: [1, 1, 0] }),
        transform: [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, dx * 1.6] }) }, { translateY: t.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, -up, 4] }) }, { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${(j() - 0.5) * 400}deg`] }) }] }} />
    );
  });
  return <>{ring(0, dust)}{ring(1, e.base)}{rocks}</>;
});

const Streak = memo(function Streak({ s, done }: { s: Extract<FxSpec, { kind: 'streak' }>; done: () => void }) {
  const t = useRun(300, done, Easing.out(Easing.quad));
  const e = ELEMENTS[s.el];
  const x0 = Math.min(s.x1, s.x2), len = Math.abs(s.x2 - s.x1);
  return (
    <>
      {[-0.4, -0.15, 0.1, 0.32].map((f, i) => (
        <Animated.View key={i} pointerEvents="none" style={{ position: 'absolute', left: x0, top: s.y + f * s.h, width: len, height: i % 2 ? 2.5 : 4, borderRadius: 2, backgroundColor: i % 2 ? '#ffffff' : e.light,
          opacity: t.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.85, 0] }),
          transform: [{ scaleX: t.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.3, 1, 0.6] }) }, { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, (s.x2 > s.x1 ? 1 : -1) * len * 0.2] }) }] }} />
      ))}
    </>
  );
});

const Bolt = memo(function Bolt({ s, done, H }: { s: Extract<FxSpec, { kind: 'bolt' }>; done: () => void; H: number }) {
  const t = useRun(460, done);
  const e = ELEMENTS[s.el];
  const pillar = s.el === 'radiant' || s.el === 'glimmer';
  const j = rand(s.id + 5);
  let d = `M${s.x + (j() - 0.5) * 30} -10`;
  const n = 7;
  for (let i = 1; i < n; i++) d += ` L${s.x + (j() - 0.5) * 34} ${-10 + ((s.y + 10) * i) / n}`;
  d += ` L${s.x} ${s.y}`;
  return (
    <>
      <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, opacity: t.interpolate({ inputRange: [0, 0.08, 0.2, 0.3, 0.45, 1], outputRange: [0, 1, 0.35, 1, 0.9, 0] }) }}>
        <Svg width={s.x + 60} height={H}>
          {pillar ? (
            <>
              <Path d={`M${s.x - 26} -10 L${s.x + 26} -10 L${s.x + 18} ${s.y} L${s.x - 18} ${s.y}Z`} fill={e.base} opacity={0.45} />
              <Path d={`M${s.x - 11} -10 L${s.x + 11} -10 L${s.x + 7} ${s.y} L${s.x - 7} ${s.y}Z`} fill={e.glow} />
            </>
          ) : (
            <>
              <Path d={d} stroke={e.base} strokeWidth={9} fill="none" strokeLinejoin="round" strokeLinecap="round" opacity={0.6} />
              <Path d={d} stroke="#ffffff" strokeWidth={3} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            </>
          )}
          <Ellipse cx={s.x} cy={s.y} rx={30} ry={8} fill={e.glow} opacity={0.7} />
        </Svg>
      </Animated.View>
    </>
  );
});

const ERUPT_COL: Partial<Record<ElementId, [string, string]>> = {
  frost: ['#bfeaff', '#ffffff'], stone: ['#9c9384', '#c9c1b1'], terra: ['#8a6440', '#b48a5c'], verdant: ['#3f9a4a', '#8fd16a'],
  ember: ['#ff6a2a', '#ffd34d'], shade: ['#2d2240', '#9b6cff'], void: ['#1b1030', '#b48cff'], spirit: ['#7e7bc9', '#e9e8ff'],
};
type SpikeKind = 'rock' | 'crystal' | 'thorn' | 'flame';
const SPIKE_KIND: Partial<Record<ElementId, SpikeKind>> = {
  frost: 'crystal', glimmer: 'crystal', mind: 'crystal', radiant: 'crystal',
  verdant: 'thorn', venom: 'thorn', swarm: 'thorn',
  ember: 'flame', shade: 'flame', void: 'flame', spirit: 'flame',
};
/** One spike in a w×h box, base along the bottom, tip leaning by `ln` (a fraction of w). Two-tone faces give it form. */
function Spike({ kind, w, h, ln, c1, c2, dark }: { kind: SpikeKind; w: number; h: number; ln: number; c1: string; c2: string; dark: string }) {
  const tx = w / 2 + ln * w, mid = w * 0.5 + ln * w * 0.35;
  switch (kind) {
    case 'flame':
      return (
        <Svg width={w} height={h}>
          <Path d={`M0 ${h} Q${w * 0.02} ${h * 0.45} ${tx} 0 Q${w * 0.62 + ln * w} ${h * 0.35} ${w * 0.72} ${h * 0.22} Q${w * 1.02} ${h * 0.6} ${w} ${h}Z`} fill={c1} stroke={dark} strokeWidth={1.3} strokeLinejoin="round" />
          <Path d={`M${w * 0.22} ${h} Q${w * 0.2} ${h * 0.6} ${tx} ${h * 0.3} Q${w * 0.8} ${h * 0.65} ${w * 0.78} ${h}Z`} fill={c2} />
        </Svg>
      );
    case 'thorn':
      return (
        <Svg width={w} height={h}>
          <Path d={`M0 ${h} Q${w * 0.05} ${h * 0.45} ${tx} 0 Q${w * 0.62} ${h * 0.5} ${w} ${h}Z`} fill={c1} stroke={dark} strokeWidth={1.3} strokeLinejoin="round" />
          <Path d={`M${w * 0.45} ${h} Q${w * 0.5} ${h * 0.5} ${tx} ${h * 0.04} Q${w * 0.62} ${h * 0.5} ${w} ${h}Z`} fill={dark} opacity={0.28} />
          <Path d={`M${w * 0.3} ${h * 0.85} Q${w * 0.3} ${h * 0.45} ${tx - w * 0.04} ${h * 0.1}`} stroke={c2} strokeWidth={Math.max(1, w * 0.08)} strokeLinecap="round" fill="none" opacity={0.8} />
        </Svg>
      );
    case 'crystal':
      return (
        <Svg width={w} height={h}>
          <Path d={`M0 ${h} L${w * 0.08} ${h * 0.3} L${tx} 0 L${w * 0.92} ${h * 0.3} L${w} ${h}Z`} fill={c1} stroke={dark} strokeWidth={1.2} strokeLinejoin="round" opacity={0.92} />
          <Path d={`M${w * 0.08} ${h * 0.3} L${tx} 0 L${mid} ${h * 0.34} L${mid} ${h}L0 ${h}Z`} fill={c2} opacity={0.75} />
          <Path d={`M${w * 0.24} ${h * 0.85} L${w * 0.24} ${h * 0.4} L${tx - w * 0.08} ${h * 0.1}`} stroke="#ffffff" strokeWidth={Math.max(1, w * 0.07)} strokeLinecap="round" fill="none" opacity={0.85} />
        </Svg>
      );
    default:
      return (
        <Svg width={w} height={h}>
          <Path d={`M0 ${h} L${w * 0.14} ${h * 0.55} L${tx} 0 L${w * 0.84} ${h * 0.42} L${w} ${h}Z`} fill={c1} stroke={dark} strokeWidth={1.3} strokeLinejoin="round" />
          <Path d={`M${w * 0.14} ${h * 0.55} L${tx} 0 L${mid} ${h}L0 ${h}Z`} fill={c2} />
          <Path d={`M${mid} ${h} L${tx} ${h * 0.02}`} stroke={dark} strokeWidth={0.8} opacity={0.5} />
          <Path d={`M${w * 0.3} ${h * 0.7} L${w * 0.36} ${h * 0.52}`} stroke={dark} strokeWidth={0.9} strokeLinecap="round" opacity={0.45} />
        </Svg>
      );
  }
}
/**
 * Spikes bursting up out of the ground under a target: the ground cracks, then the spikes punch up one after
 * another (the tallest first) with a little overshoot, kicking up dust and chips; they hold a moment and sink back.
 */
const Erupt = memo(function Erupt({ s, done }: { s: Extract<FxSpec, { kind: 'erupt' }>; done: () => void }) {
  const t = useRun(900, done);
  const e = ELEMENTS[s.el];
  const [c1, c2] = ERUPT_COL[s.el] ?? [e.base, e.light];
  const kind = SPIKE_KIND[s.el] ?? 'rock';
  const W = s.s * 1.7, Hh = s.s * 1.15;
  // [x (fraction of W from centre), height, width, lean, order they come up in]
  const spikes = [[-0.34, 0.5, 0.17, -0.3, 3], [0.33, 0.56, 0.17, 0.3, 4], [-0.17, 0.78, 0.21, -0.15, 1], [0.16, 0.72, 0.2, 0.14, 2], [0, 1, 0.25, 0.02, 0]];
  const rise = (k: number) => {
    const a = 0.08 + k * 0.045;
    return t.interpolate({ inputRange: [0, a, a + 0.09, a + 0.15, 0.74 + k * 0.02, 0.92 + k * 0.015, 1], outputRange: [1, 1, -0.08, 0, 0, 1, 1], extrapolate: 'clamp' });
  };
  const chips = [[-0.5, -0.9, -200], [0.45, -0.8, 160], [-0.25, -1.15, 90], [0.3, -1.05, -120]];
  const gy = s.y; // the ground line
  return (
    <>
      {/* The crack in the ground. */}
      <Animated.View pointerEvents="none" style={{ position: 'absolute', left: s.x - W * 0.55, top: gy - 7, width: W * 1.1, height: 14,
        opacity: t.interpolate({ inputRange: [0, 0.06, 0.8, 1], outputRange: [0, 1, 0.8, 0] }), transform: [{ scaleX: t.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0.2, 1, 1], extrapolate: 'clamp' }) }] }}>
        <Svg width={W * 1.1} height={14}>
          <Path d={`M${W * 0.04} 7 L${W * 0.2} 5 L${W * 0.32} 9 L${W * 0.46} 4 L${W * 0.58} 8.5 L${W * 0.72} 5 L${W * 0.86} 8 L${W * 1.04} 6.5`} stroke="#2a1f1a" strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" fill="none" opacity={0.55} />
          <Ellipse cx={W * 0.55} cy={7} rx={W * 0.5} ry={5} fill={c1} opacity={0.22} />
        </Svg>
      </Animated.View>
      {/* The spikes, clipped at the ground so they come up out of it rather than growing in mid-air. */}
      <View pointerEvents="none" style={{ position: 'absolute', left: s.x - W / 2, top: gy - Hh, width: W, height: Hh + 1, overflow: 'hidden' }}>
        {spikes.map(([x, h, w, ln, k], i) => {
          const sw = W * w, sh = Hh * h;
          return (
            <Animated.View key={i} style={{ position: 'absolute', left: W / 2 + x * W - sw / 2, top: Hh + 1 - sh, width: sw, height: sh,
              transform: [{ translateY: Animated.multiply(rise(k), sh) }] }}>
              <Spike kind={kind} w={sw} h={sh} ln={ln} c1={c1} c2={c2} dark={e.dark} />
            </Animated.View>
          );
        })}
      </View>
      {/* Dust rolling out from the base. */}
      {[-1, 1].map(d => (
        <Animated.View key={d} pointerEvents="none" style={{ position: 'absolute', left: s.x - W * 0.25 + d * W * 0.18, top: gy - 10, width: W * 0.5, height: 16, borderRadius: 16,
          backgroundColor: kind === 'flame' ? c2 : '#e8dcc6',
          opacity: t.interpolate({ inputRange: [0, 0.1, 0.16, 0.6], outputRange: [0, 0, 0.55, 0], extrapolate: 'clamp' }),
          transform: [{ translateX: t.interpolate({ inputRange: [0, 0.6], outputRange: [0, d * W * 0.22], extrapolate: 'clamp' }) }, { scale: t.interpolate({ inputRange: [0.1, 0.6], outputRange: [0.4, 1.3], extrapolate: 'clamp' }) }] }} />
      ))}
      {/* Chips thrown up into the air. */}
      {kind === 'flame' ? null : chips.map(([dx, dy, rot], i) => {
        const a = 0.1 + i * 0.04, cs = Math.max(4, s.s * 0.07);
        const tt = t.interpolate({ inputRange: [a, a + 0.42], outputRange: [0, 1], extrapolate: 'clamp' });
        return (
          <Animated.View key={i} pointerEvents="none" style={{ position: 'absolute', left: s.x - cs / 2, top: gy - cs, width: cs, height: cs,
            opacity: t.interpolate({ inputRange: [a, a + 0.02, a + 0.36, a + 0.42], outputRange: [0, 1, 1, 0], extrapolate: 'clamp' }),
            transform: [
              { translateX: tt.interpolate({ inputRange: [0, 1], outputRange: [0, dx * W * 0.6] }) },
              { translateY: tt.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, dy * Hh * 0.7, dy * Hh * 0.25] }) },
              { rotate: tt.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${rot}deg`] }) },
            ] }}>
            <Svg width={cs} height={cs} viewBox="0 0 10 10"><Path d="M1 4 L4 1 L9 3 L8 8 L3 9Z" fill={kind === 'crystal' ? c2 : c1} stroke={e.dark} strokeWidth={1.2} strokeLinejoin="round" /></Svg>
          </Animated.View>
        );
      })}
    </>
  );
});

/** A wave crest drawn on (0,0)-(W,H), moving right. */
function WaveShape({ el, W, H }: { el: ElementId; W: number; H: number }) {
  const e = ELEMENTS[el];
  switch (el) {
    case 'tide':
      return (<Svg width={W} height={H}><Path d={`M0 ${H} Q${W * 0.3} ${H * 0.75} ${W * 0.55} ${H * 0.2} Q${W * 0.8} ${-H * 0.05} ${W * 0.95} ${H * 0.35} Q${W * 0.75} ${H * 0.25} ${W * 0.7} ${H * 0.55} Q${W * 0.85} ${H} ${W} ${H}Z`} fill={e.base} stroke={e.dark} strokeWidth={1.5} /><Path d={`M${W * 0.5} ${H * 0.35} Q${W * 0.7} ${H * 0.05} ${W * 0.9} ${H * 0.3}`} stroke="#ffffff" strokeWidth={3} fill="none" strokeLinecap="round" /></Svg>);
    case 'gale':
      return (<Svg width={W} height={H}>{[0.25, 0.5, 0.75].map((y, i) => <Path key={i} d={`M0 ${H * y} Q${W * 0.5} ${H * (y - 0.25)} ${W * 0.8} ${H * y} Q${W} ${H * (y + 0.15)} ${W * 0.85} ${H * (y + 0.2)}`} stroke={i === 1 ? '#ffffff' : e.light} strokeWidth={4} fill="none" strokeLinecap="round" />)}</Svg>);
    case 'terra':
      return (<Svg width={W} height={H}><Path d={`M0 ${H} Q${W * 0.2} ${H * 0.4} ${W * 0.5} ${H * 0.3} Q${W * 0.85} ${H * 0.25} ${W} ${H}Z`} fill={e.base} stroke={e.dark} strokeWidth={1.5} /><Circle cx={W * 0.4} cy={H * 0.15} r={4} fill={e.dark} /><Circle cx={W * 0.7} cy={H * 0.05} r={3} fill={e.base} /></Svg>);
    default:
      return (<Svg width={W} height={H}><Path d={`M${W * 0.25} 0 Q${W} ${H * 0.5} ${W * 0.25} ${H} Q${W * 0.7} ${H * 0.5} ${W * 0.25} 0Z`} fill={e.light} stroke={e.base} strokeWidth={2} opacity={0.9} /><Path d={`M0 ${H * 0.3} L${W * 0.35} ${H * 0.3} M0 ${H * 0.7} L${W * 0.35} ${H * 0.7}`} stroke={e.light} strokeWidth={3} strokeLinecap="round" /></Svg>);
  }
}
const Wave = memo(function Wave({ s, done }: { s: Extract<FxSpec, { kind: 'wave' }>; done: () => void }) {
  const t = useRun(s.dur, done, Easing.inOut(Easing.quad));
  const W = s.s * 1.1, Hh = s.s * 0.8, dir = s.x2 >= s.x1 ? 1 : -1;
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', left: s.x1 - W / 2, top: s.y - Hh, width: W, height: Hh,
      opacity: t.interpolate({ inputRange: [0, 0.1, 0.85, 1], outputRange: [0, 1, 1, 0] }),
      transform: [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, s.x2 - s.x1] }) }, { scaleX: dir }, { scaleY: t.interpolate({ inputRange: [0, 0.2, 0.5, 0.8, 1], outputRange: [0.3, 1, 0.9, 1.1, 0.6] }) }] }}>
      <WaveShape el={s.el} W={W} H={Hh} />
    </Animated.View>
  );
});

const Breath = memo(function Breath({ s, done, W, H }: { s: Extract<FxSpec, { kind: 'breath' }>; done: () => void; W: number; H: number }) {
  const t = useRun(s.dur, done);
  const e = ELEMENTS[s.el];
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
  const cone = (w0: number, w1: number) => `M${s.x1 + nx * w0} ${s.y1 + ny * w0} L${s.x2 + nx * w1} ${s.y2 + ny * w1} Q${s.x2 + dx / len * w1 * 0.8} ${s.y2 + dy / len * w1 * 0.8} ${s.x2 - nx * w1} ${s.y2 - ny * w1} L${s.x1 - nx * w0} ${s.y1 - ny * w0}Z`;
  const puffs = Array.from({ length: 6 }, (_, i) => {
    const t0 = i * 0.09, r = 7 + i * 1.5;
    const tt = t.interpolate({ inputRange: [t0, t0 + 0.4], outputRange: [0, 1], extrapolate: 'clamp' });
    return (
      <Animated.View key={i} pointerEvents="none" style={{ position: 'absolute', left: s.x1 - r, top: s.y1 - r, width: r * 2, height: r * 2, borderRadius: r, backgroundColor: i % 2 ? e.glow : e.light,
        opacity: tt.interpolate({ inputRange: [0, 0.1, 0.8, 1], outputRange: [0, 0.9, 0.7, 0] }),
        transform: [{ translateX: tt.interpolate({ inputRange: [0, 1], outputRange: [0, dx] }) }, { translateY: tt.interpolate({ inputRange: [0, 1], outputRange: [0, dy + (i % 2 ? 6 : -6)] }) }, { scale: tt.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.6] }) }] }} />
    );
  });
  return (
    <>
      <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, opacity: t.interpolate({ inputRange: [0, 0.15, 0.3, 0.45, 0.6, 0.8, 1], outputRange: [0, 0.95, 0.7, 0.95, 0.75, 0.6, 0] }) }}>
        <Svg width={W} height={H}>
          <Path d={cone(5, 30)} fill={e.base} opacity={0.55} />
          <Path d={cone(3, 17)} fill={e.light} opacity={0.8} />
          <Path d={cone(1.5, 7)} fill={e.glow} />
        </Svg>
      </Animated.View>
      {puffs}
    </>
  );
});

const Whirl = memo(function Whirl({ s, done }: { s: Extract<FxSpec, { kind: 'whirl' }>; done: () => void }) {
  const t = useRun(420, done, Easing.out(Easing.quad));
  const e = ELEMENTS[s.el], R = s.r;
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', left: s.x - R, top: s.y - R, width: R * 2, height: R * 2,
      opacity: t.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.9, 0] }),
      transform: [{ rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-420deg'] }) }, { scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.15] }) }] }}>
      <Svg width={R * 2} height={R * 2} viewBox={`${-R} ${-R} ${R * 2} ${R * 2}`}>
        {[0, 120, 240].map(a => <Path key={a} d={`M${R * 0.85} 0 A${R * 0.85} ${R * 0.85} 0 0 1 ${R * 0.85 * Math.cos(1.6)} ${R * 0.85 * Math.sin(1.6)}`} stroke={a ? e.light : '#ffffff'} strokeWidth={4} fill="none" strokeLinecap="round" transform={`rotate(${a})`} />)}
      </Svg>
    </Animated.View>
  );
});

const Flash = memo(function Flash({ s, done, W, H }: { s: Extract<FxSpec, { kind: 'flash' }>; done: () => void; W: number; H: number }) {
  const t = useRun(260, done, Easing.out(Easing.quad));
  return <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, backgroundColor: s.color, opacity: t.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.5, 0] }) }} />;
});

const Heal = memo(function Heal({ s, done }: { s: Extract<FxSpec, { kind: 'heal' }>; done: () => void }) {
  const t = useRun(900, done, Easing.out(Easing.quad));
  const R = s.s * 0.5, j = rand(s.id + 7);
  return (
    <>
      <Animated.View pointerEvents="none" style={{ position: 'absolute', left: s.x - R, top: s.y + R * 0.55 - R * 0.3, width: R * 2, height: R * 0.6, borderRadius: R, borderWidth: 3, borderColor: s.color,
        opacity: t.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.9, 0] }), transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.3] }) }] }} />
      {Array.from({ length: 6 }, (_, i) => {
        const dx = (j() - 0.5) * R * 1.5, t0 = i * 0.08, r = 5 + j() * 4;
        const tt = t.interpolate({ inputRange: [t0, Math.min(1, t0 + 0.6)], outputRange: [0, 1], extrapolate: 'clamp' });
        return (
          <Animated.View key={i} pointerEvents="none" style={{ position: 'absolute', left: s.x + dx - r, top: s.y + R * 0.3 - r, width: r * 2, height: r * 2,
            opacity: tt.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 1, 1, 0] }),
            transform: [{ translateY: tt.interpolate({ inputRange: [0, 1], outputRange: [0, -R * 1.5] }) }, { scale: tt.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.4, 1.1, 0.8] }) }] }}>
            <Svg width={r * 2} height={r * 2} viewBox="-10 -10 20 20"><Path d="M-3 -9 H3 V-3 H9 V3 H3 V9 H-3 V3 H-9 V-3 H-3Z" fill={i % 2 ? '#ffffff' : s.color} stroke="#1d4a2c" strokeWidth={1.2} /></Svg>
          </Animated.View>
        );
      })}
    </>
  );
});

const ShieldUp = memo(function ShieldUp({ s, done }: { s: Extract<FxSpec, { kind: 'shieldUp' }>; done: () => void }) {
  const t = useRun(700, done, Easing.out(Easing.back(1.6)));
  const R = s.s * 0.52;
  const hex = Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * Math.PI * 2 + Math.PI / 6; return `${(Math.cos(a) * R * 0.42).toFixed(1)},${(Math.sin(a) * R * 0.42).toFixed(1)}`; }).join(' ');
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', left: s.x - R, top: s.y - R, width: R * 2, height: R * 2,
      opacity: t.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 1, 0.9, 0] }), transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }] }}>
      <Svg width={R * 2} height={R * 2} viewBox={`${-R} ${-R} ${R * 2} ${R * 2}`}>
        <Circle r={R - 2} fill="#9fe8ff" fillOpacity={0.18} stroke="#bff3ff" strokeWidth={2.5} />
        <Polygon points={hex} fill="none" stroke="#e6fbff" strokeWidth={1.6} opacity={0.8} />
        {[0, 1, 2, 3, 4, 5].map(i => { const a = (i / 6) * Math.PI * 2; return <Path key={i} d={`M${(Math.cos(a) * R * 0.42).toFixed(1)} ${(Math.sin(a) * R * 0.42).toFixed(1)} L${(Math.cos(a) * (R - 2)).toFixed(1)} ${(Math.sin(a) * (R - 2)).toFixed(1)}`} stroke="#e6fbff" strokeWidth={1.2} opacity={0.6} />; })}
        <Ellipse cx={-R * 0.35} cy={-R * 0.45} rx={R * 0.25} ry={R * 0.12} fill="#ffffff" opacity={0.7} transform="rotate(-30)" />
      </Svg>
    </Animated.View>
  );
});

const Stat = memo(function Stat({ s, done }: { s: Extract<FxSpec, { kind: 'stat' }>; done: () => void }) {
  const t = useRun(800, done, Easing.out(Easing.quad));
  const R = s.s * 0.45;
  return (
    <>
      {[-0.55, 0, 0.55].map((dx, i) => {
        const t0 = i * 0.12, tt = t.interpolate({ inputRange: [t0, Math.min(1, t0 + 0.65)], outputRange: [0, 1], extrapolate: 'clamp' });
        const w = 12, h = 16;
        return (
          <Animated.View key={i} pointerEvents="none" style={{ position: 'absolute', left: s.x + dx * R - w / 2, top: s.y + (s.up ? R * 0.4 : -R * 0.6) - h / 2, width: w, height: h,
            opacity: tt.interpolate({ inputRange: [0, 0.2, 0.75, 1], outputRange: [0, 1, 1, 0] }),
            transform: [{ translateY: tt.interpolate({ inputRange: [0, 1], outputRange: [0, (s.up ? -1 : 1) * R * 0.9] }) }, { scaleY: s.up ? 1 : -1 }] }}>
            <Svg width={w} height={h} viewBox="-6 -8 12 16"><Path d="M0 -7.5 L5.5 -1 H2 V7.5 H-2 V-1 H-5.5Z" fill={s.color} stroke="#1b1420" strokeWidth={1.1} strokeLinejoin="round" /></Svg>
          </Animated.View>
        );
      })}
    </>
  );
});

/** Lasting signs of a creature's conditions, drawn over it while they last: flames, bubbles, dizzy stars, ice, a shield. */
export const StatusFx = memo(function StatusFx({ statuses, shield, size, part, bounds, flip }: {
  statuses: string[]; shield: boolean; size: number; part?: 'ground' | 'body';
  /** The body's box in drawing units (0..100), so the shield and ice fit this creature's shape. */
  bounds?: { x0: number; y0: number; x1: number; y1: number }; flip?: boolean;
}) {
  const t = useRef(new Animated.Value(0)).current;
  const buff = statuses.includes('atkUp') ? '#ff7a59' : statuses.includes('defUp') ? '#6fb7ff' : statuses.includes('haste') ? '#ffd34d' : statuses.includes('boost') ? '#b48cff' : statuses.includes('regen') ? '#5ad17a' : null;
  // Split for creatures that leap: the buff glow and its sparks belong on the ground, the rest on the body.
  const ground = part !== 'body', body = part !== 'ground';
  const any = (ground && !!buff) || (body && (shield || statuses.some(k => k === 'freeze' || k === 'burn' || k === 'poison' || k === 'stun')));
  useEffect(() => {
    if (!any) return;
    t.setValue(0);
    const l = Animated.loop(Animated.timing(t, { toValue: 1, duration: 1800, easing: Easing.linear, useNativeDriver: true }));
    l.start();
    return () => l.stop();
  }, [any, t]);
  if (!any) return null;
  const S = size, has = (k: string) => body && statuses.includes(k);
  const cyc = (off: number, n = 1) => t.interpolate({ inputRange: [0, 1], outputRange: [off, off + n] });
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: S, height: S }}>
      {buff && ground ? (
        <>
          <Animated.View style={{ position: 'absolute', left: S * 0.14, top: S * 0.8, width: S * 0.72, height: S * 0.2, opacity: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.45, 0.9, 0.45] }) }}>
            <Svg width={S * 0.72} height={S * 0.2}><Defs><RadialGradient id={`bf${S}`} cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor={buff} stopOpacity={0.75} /><Stop offset="1" stopColor={buff} stopOpacity={0} /></RadialGradient></Defs><Ellipse cx={S * 0.36} cy={S * 0.1} rx={S * 0.36} ry={S * 0.1} fill={`url(#bf${S})`} /></Svg>
          </Animated.View>
          {[0, 1, 2].map(i => {
            const p01 = cyc(i / 3).interpolate({ inputRange: [0, 1, 1.0001, 2], outputRange: [0, 1, 0, 1] });
            return (
              <Animated.View key={'s' + i} style={{ position: 'absolute', left: S * (0.3 + i * 0.2), top: S * 0.82, width: 5, height: 5, borderRadius: 3, backgroundColor: buff,
                opacity: p01.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 1, 0.8, 0] }), transform: [{ translateY: p01.interpolate({ inputRange: [0, 1], outputRange: [0, -S * 0.35] }) }] }} />
            );
          })}
        </>
      ) : null}
      {shield && body ? (() => {
        // An oval bubble around this creature's own outline (tall for a biped, long and low for a quadruped).
        const B = bounds ?? { x0: 12, y0: 20, x1: 88, y1: 96 };
        const k = S / 100, pad = 6;
        const w = (B.x1 - B.x0 + pad * 2) * k, h = (B.y1 - B.y0 + pad * 2) * k;
        const left = (flip ? 100 - B.x1 - pad : B.x0 - pad) * k, top = (B.y0 - pad) * k;
        return (
          <Animated.View style={{ position: 'absolute', left, top, width: w, height: h, opacity: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.6, 0.9, 0.6] }) }}>
            <Svg width={w} height={h}>
              <Ellipse cx={w / 2} cy={h / 2} rx={w / 2 - 1.5} ry={h / 2 - 1.5} fill="#9fe8ff" fillOpacity={0.12} stroke="#bff3ff" strokeWidth={2} />
              <Ellipse cx={w * 0.34} cy={h * 0.24} rx={w * 0.14} ry={h * 0.06} fill="#ffffff" opacity={0.45} transform={`rotate(-25 ${w * 0.34} ${h * 0.24})`} />
            </Svg>
          </Animated.View>
        );
      })() : null}
      {has('freeze') ? (() => {
        // A block of ice over the body.
        const B = bounds ?? { x0: 20, y0: 30, x1: 80, y1: 90 };
        const k = S / 100, w = (B.x1 - B.x0) * 0.9 * k, h = (B.y1 - B.y0) * 0.85 * k;
        const left = ((flip ? 100 - B.x1 : B.x0) + (B.x1 - B.x0) * 0.05) * k, top = (B.y0 + (B.y1 - B.y0) * 0.1) * k;
        return <View style={{ position: 'absolute', left, top, width: w, height: h, borderRadius: Math.min(w, h) * 0.25, backgroundColor: 'rgba(170,230,255,0.35)', borderWidth: 1.5, borderColor: '#e6fbff' }} />;
      })() : null}
      {has('burn') ? [0, 1].map(i => (
        <Animated.View key={'b' + i} style={{ position: 'absolute', left: S * (0.36 + i * 0.22), top: S * (0.5 + i * 0.08), width: S * 0.12, height: S * 0.18,
          opacity: cyc(i * 0.5, 4).interpolate({ inputRange: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5], outputRange: [0.9, 0.6, 0.9, 0.6, 0.9, 0.6, 0.9, 0.6, 0.9, 0.6, 0.9] }),
          transform: [{ scaleY: cyc(i * 0.5, 4).interpolate({ inputRange: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5], outputRange: [1, 0.8, 1.1, 0.85, 1, 0.8, 1.1, 0.85, 1, 0.8, 1] }) }] }}>
          <Svg width={S * 0.12} height={S * 0.18} viewBox="-6 -10 12 18"><Path d="M0 -9 Q6 -2 4 3 Q2 8 0 8 Q-2 8 -4 3 Q-6 -2 0 -9Z" fill="#ff7a2a" /><Path d="M0 -3 Q3 1 2 4 Q0 7 -2 4 Q-3 1 0 -3Z" fill="#ffd34d" /></Svg>
        </Animated.View>
      )) : null}
      {has('poison') ? [0, 1, 2].map(i => {
        const tt = cyc(i / 3).interpolate({ inputRange: [0, 1, 2], outputRange: [0, 1, 0] , extrapolate: 'clamp' });
        const ph = cyc(i / 3);
        const p01 = ph.interpolate({ inputRange: [0, 1, 1.0001, 2], outputRange: [0, 1, 0, 1] });
        void tt;
        return (
          <Animated.View key={'p' + i} style={{ position: 'absolute', left: S * (0.32 + i * 0.16), top: S * 0.55, width: S * 0.07, height: S * 0.07, borderRadius: S, backgroundColor: '#b45cff', borderWidth: 1, borderColor: '#5a2380',
            opacity: p01.interpolate({ inputRange: [0, 0.15, 0.8, 1], outputRange: [0, 1, 0.8, 0] }), transform: [{ translateY: p01.interpolate({ inputRange: [0, 1], outputRange: [0, -S * 0.4] }) }] }} />
        );
      }) : null}
      {has('stun') ? (
        <Animated.View style={{ position: 'absolute', left: S * 0.3, top: S * 0.06, width: S * 0.4, height: S * 0.4, transform: [{ scaleY: 0.35 }, { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '720deg'] }) }] }}>
          {[0, 1, 2].map(i => { const a = (i / 3) * Math.PI * 2; return <Text key={i} style={{ position: 'absolute', left: S * 0.2 + Math.cos(a) * S * 0.18 - 6, top: S * 0.2 + Math.sin(a) * S * 0.18 - 8, fontSize: 13, color: '#ffe066' }}>★</Text>; })}
        </Animated.View>
      ) : null}
    </View>
  );
});

export const FxLayer = memo(function FxLayer({ items, onDone, W, H }: { items: FxSpec[]; onDone: (id: number) => void; W: number; H: number }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: W, height: H }}>
      {items.map(s => {
        const done = () => onDone(s.id);
        switch (s.kind) {
          case 'proj': return <Proj key={s.id} s={s} done={done} />;
          case 'beam': return <Beam key={s.id} s={s} done={done} W={W} H={H} />;
          case 'burst': return <Burst key={s.id} s={s} done={done} />;
          case 'charge': return <Charge key={s.id} s={s} done={done} />;
          case 'aura': return <Aura key={s.id} s={s} done={done} />;
          case 'puff': return <Puff key={s.id} s={s} done={done} />;
          case 'impact': return <Impact key={s.id} s={s} done={done} />;
          case 'slash': return <Slash key={s.id} s={s} done={done} />;
          case 'chomp': return <Chomp key={s.id} s={s} done={done} />;
          case 'shock': return <Shock key={s.id} s={s} done={done} />;
          case 'streak': return <Streak key={s.id} s={s} done={done} />;
          case 'bolt': return <Bolt key={s.id} s={s} done={done} H={H} />;
          case 'erupt': return <Erupt key={s.id} s={s} done={done} />;
          case 'wave': return <Wave key={s.id} s={s} done={done} />;
          case 'breath': return <Breath key={s.id} s={s} done={done} W={W} H={H} />;
          case 'whirl': return <Whirl key={s.id} s={s} done={done} />;
          case 'flash': return <Flash key={s.id} s={s} done={done} W={W} H={H} />;
          case 'heal': return <Heal key={s.id} s={s} done={done} />;
          case 'shieldUp': return <ShieldUp key={s.id} s={s} done={done} />;
          case 'stat': return <Stat key={s.id} s={s} done={done} />;
        }
      })}
    </View>
  );
});
