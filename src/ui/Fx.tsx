// Visual effects for fights: projectiles, beams, impact bursts, support sparkles and dust puffs.
// Each effect runs its own native-driver animation and removes itself when done.
import React, { memo, useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Path, Polygon } from 'react-native-svg';
import { ELEMENTS, ElementId } from '../game/data/elements';

export type FxSpec =
  | { id: number; kind: 'proj'; el: ElementId; x1: number; y1: number; x2: number; y2: number; dur: number }
  | { id: number; kind: 'beam'; el: ElementId; x1: number; y1: number; x2: number; y2: number; dur: number }
  | { id: number; kind: 'burst'; el: ElementId; x: number; y: number; big?: boolean }
  | { id: number; kind: 'charge'; el: ElementId; x: number; y: number }
  | { id: number; kind: 'aura'; color: string; x: number; y: number }
  | { id: number; kind: 'puff'; x: number; y: number; color?: string };

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
        }
      })}
    </View>
  );
});
