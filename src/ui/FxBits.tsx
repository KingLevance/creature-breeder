// The little shapes effects are made of, one family per element: embers for fire, droplets for water, shards for
// ice, leaves, sparks, rubble and so on. They are plain views rather than vector drawings, so a burst of a dozen
// costs almost nothing to put on screen, and every element's hits, trails and charges look like that element.
import React, { memo, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { ELEMENTS, ElementId } from '../game/data/elements';

export type Bit = 'dot' | 'ember' | 'drop' | 'leaf' | 'shard' | 'spark' | 'ray' | 'chip' | 'star' | 'bubble' | 'wisp' | 'smoke' | 'arc' | 'bug' | 'ringlet' | 'petal';

/** One particle about 2r across, centred in a 2r box. Pointed shapes point up; sparks and rays lie along x. */
export const BitShape = memo(function BitShape({ kind, r, c, c2 }: { kind: Bit; r: number; c: string; c2: string }) {
  const box = { width: r * 2, height: r * 2, alignItems: 'center' as const, justifyContent: 'center' as const };
  const abs = { position: 'absolute' as const };
  switch (kind) {
    case 'ember': // a tongue of flame with a hot core
      return (
        <View style={box}>
          <View style={{ width: r * 1.5, height: r * 1.5, transform: [{ translateY: r * 0.15 }, { rotate: '45deg' }] }}>
            <View style={[abs, { left: 0, top: 0, width: r * 1.5, height: r * 1.5, borderRadius: r * 0.75, borderTopLeftRadius: 0, backgroundColor: c }]} />
            <View style={[abs, { left: r * 0.5, top: r * 0.5, width: r * 0.8, height: r * 0.8, borderRadius: r * 0.4, borderTopLeftRadius: 0, backgroundColor: c2 }]} />
          </View>
        </View>
      );
    case 'drop': // a water drop with a glint
      return (
        <View style={box}>
          <View style={{ width: r * 1.4, height: r * 1.4, transform: [{ translateY: r * 0.12 }, { rotate: '45deg' }] }}>
            <View style={[abs, { left: 0, top: 0, width: r * 1.4, height: r * 1.4, borderRadius: r * 0.7, borderTopLeftRadius: 0, backgroundColor: c }]} />
            <View style={[abs, { left: r * 0.72, top: r * 0.42, width: r * 0.34, height: r * 0.34, borderRadius: r, backgroundColor: c2 }]} />
          </View>
        </View>
      );
    case 'wisp': // a ghostly teardrop, tail down
      return (
        <View style={box}>
          <View style={{ width: r * 1.5, height: r * 1.5, transform: [{ translateY: -r * 0.15 }, { rotate: '225deg' }] }}>
            <View style={[abs, { left: 0, top: 0, width: r * 1.5, height: r * 1.5, borderRadius: r * 0.75, borderTopLeftRadius: 0, backgroundColor: c, opacity: 0.85 }]} />
            <View style={[abs, { left: r * 0.6, top: r * 0.6, width: r * 0.6, height: r * 0.6, borderRadius: r, backgroundColor: c2 }]} />
          </View>
        </View>
      );
    case 'leaf':
      return (
        <View style={box}>
          <View style={{ width: r * 1.5, height: r * 1.5, borderRadius: r * 1.3, borderTopRightRadius: 0, borderBottomLeftRadius: 0, backgroundColor: c, borderWidth: Math.max(1, r * 0.16), borderColor: 'rgba(18,46,22,0.8)', transform: [{ rotate: '-45deg' }], overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: r * 2.2, height: Math.max(1, r * 0.16), backgroundColor: c2, transform: [{ rotate: '45deg' }] }} />
          </View>
        </View>
      );
    case 'petal':
      return <View style={box}><View style={{ width: r * 1.1, height: r * 1.9, borderRadius: r, backgroundColor: c }} /></View>;
    case 'shard': // a sliver of crystal with a pale facet
      return (
        <View style={box}>
          <View style={{ width: r * 1.5, height: r * 1.5, transform: [{ scaleX: 0.46 }, { rotate: '45deg' }], backgroundColor: c, overflow: 'hidden' }}>
            <View style={[abs, { left: 0, top: 0, width: r * 0.75, height: r * 1.5, backgroundColor: c2, opacity: 0.85 }]} />
          </View>
        </View>
      );
    case 'spark':
      return <View style={box}><View style={{ width: r * 2.4, height: Math.max(1.5, r * 0.5), borderRadius: r, backgroundColor: c }} /></View>;
    case 'ray':
      return <View style={box}><View style={{ width: r * 3.6, height: Math.max(1.5, r * 0.44), borderRadius: r, backgroundColor: c }} /></View>;
    case 'chip': // a chunk of rock, lit from above
      return (
        <View style={box}>
          <View style={{ width: r * 1.7, height: r * 1.5, borderTopLeftRadius: r * 0.75, borderTopRightRadius: r * 0.25, borderBottomRightRadius: r * 0.6, borderBottomLeftRadius: r * 0.3, backgroundColor: c, overflow: 'hidden' }}>
            <View style={[abs, { left: 0, top: 0, width: r * 1.7, height: r * 0.55, backgroundColor: c2, opacity: 0.7 }]} />
          </View>
        </View>
      );
    case 'star': // a four-point twinkle: two crossed slivers
      return (
        <View style={box}>
          <View style={[abs, { width: r * 1.5, height: r * 1.5, backgroundColor: c, transform: [{ scaleX: 0.32 }, { rotate: '45deg' }] }]} />
          <View style={[abs, { width: r * 1.5, height: r * 1.5, backgroundColor: c, transform: [{ scaleY: 0.32 }, { rotate: '45deg' }] }]} />
          <View style={[abs, { width: r * 0.5, height: r * 0.5, borderRadius: r, backgroundColor: c2 }]} />
        </View>
      );
    case 'bubble':
      return (
        <View style={box}>
          <View style={{ width: r * 1.8, height: r * 1.8, borderRadius: r, borderWidth: Math.max(1, r * 0.22), borderColor: c, backgroundColor: c + '55' }}>
            <View style={[abs, { left: r * 0.25, top: r * 0.2, width: r * 0.4, height: r * 0.4, borderRadius: r, backgroundColor: c2 }]} />
          </View>
        </View>
      );
    case 'ringlet':
      return <View style={box}><View style={{ width: r * 1.9, height: r * 1.9, borderRadius: r, borderWidth: Math.max(1.2, r * 0.26), borderColor: c }} /></View>;
    case 'smoke':
      // A puff: three lobes, so it reads as a curl of smoke and not as a flat disc.
      return (
        <View style={[box, { opacity: 0.78 }]}>
          <View style={[abs, { left: r * 0.1, top: r * 0.75, width: r * 1.5, height: r * 1.5, borderRadius: r, backgroundColor: c }]} />
          <View style={[abs, { left: r * 1.0, top: r * 0.95, width: r * 1.15, height: r * 1.15, borderRadius: r, backgroundColor: c }]} />
          <View style={[abs, { left: r * 0.75, top: r * 0.15, width: r * 1.05, height: r * 1.05, borderRadius: r, backgroundColor: c }]} />
        </View>
      );
    case 'arc': // a curl of wind
      return <View style={box}><View style={{ width: r * 2.2, height: r * 2.2, borderRadius: r * 1.1, borderWidth: Math.max(1.5, r * 0.36), borderColor: 'transparent', borderTopColor: c, borderRightColor: c + '66' }} /></View>;
    case 'bug':
      return (
        <View style={box}>
          <View style={[abs, { left: r * 0.15, top: r * 0.1, width: r * 0.9, height: r * 0.9, borderRadius: r, backgroundColor: c2, opacity: 0.7 }]} />
          <View style={[abs, { left: r * 0.95, top: r * 0.1, width: r * 0.9, height: r * 0.9, borderRadius: r, backgroundColor: c2, opacity: 0.7 }]} />
          <View style={{ width: r * 1.1, height: r * 1.1, borderRadius: r, backgroundColor: c, borderWidth: Math.max(1, r * 0.16), borderColor: 'rgba(22,16,6,0.85)', marginTop: r * 0.4 }} />
        </View>
      );
    default:
      return <View style={box}><View style={{ width: r * 1.6, height: r * 1.6, borderRadius: r, backgroundColor: c }} /></View>;
  }
});

export interface Motif {
  /** The shapes a burst is made of, cycled through. */
  bits: Bit[];
  cols: string[];
  /** How far the bits drop (or, negative, float up) over their life, in px. */
  grav: number;
  /** Tumble over a bit's life, in degrees. */
  spin: number;
  /** Turn each bit to point the way it flies (sparks, drops, shards). */
  orient: boolean;
  ring: 'ring' | 'ripple' | 'dash' | 'none' | 'implode';
  /** One colour for every bit's glint or core, instead of the element's own. */
  core?: string;
}

const M = (bits: Bit[], cols: string[], grav: number, spin: number, orient: boolean, ring: Motif['ring']): Motif => ({ bits, cols, grav, spin, orient, ring });
const el = (id: ElementId) => ELEMENTS[id];
export const MOTIF: Record<ElementId, Motif> = {
  plain: M(['star', 'dot', 'star'], ['#ffffff', el('plain').light, '#fff3c4'], 0, 90, false, 'ring'),
  ember: M(['ember', 'ember', 'dot'], ['#ff6a2a', '#ff8f3a', '#ffd166'], -20, 0, false, 'none'),
  tide: M(['drop', 'drop', 'dot'], [el('tide').base, el('tide').light, el('tide').glow], 28, 0, true, 'ripple'),
  verdant: M(['leaf', 'leaf', 'petal'], [el('verdant').base, el('verdant').dark, '#fff0a8'], 10, 240, false, 'none'),
  spark: M(['spark', 'spark', 'star'], ['#ffffff', el('spark').light, el('spark').base], 0, 0, true, 'none'),
  frost: M(['shard', 'shard', 'star'], [el('frost').base, '#ffffff', el('frost').light], 6, 0, true, 'dash'),
  brawn: M(['ray', 'ray', 'star'], ['#ffffff', el('brawn').glow, el('brawn').light], 0, 0, true, 'ring'),
  venom: M(['bubble', 'drop', 'bubble'], [el('venom').glow, el('venom').base, el('venom').light], -16, 0, false, 'none'),
  terra: M(['chip', 'chip', 'smoke'], [el('terra').base, el('terra').dark, el('terra').glow], 30, 280, false, 'none'),
  gale: M(['arc', 'arc', 'spark'], ['#ffffff', el('gale').light, el('gale').base], -4, 200, true, 'none'),
  mind: M(['ringlet', 'star', 'ringlet'], [el('mind').base, el('mind').glow, el('mind').light], 0, 60, false, 'ripple'),
  swarm: M(['bug', 'bug', 'bug'], [el('swarm').dark, el('swarm').base, el('swarm').dark], -6, 0, false, 'none'),
  stone: M(['chip', 'chip', 'chip'], [el('stone').base, el('stone').dark, el('stone').light], 34, 320, false, 'none'),
  spirit: M(['wisp', 'wisp', 'wisp'], [el('spirit').light, el('spirit').base, el('spirit').glow], -24, 0, false, 'ripple'),
  wyrm: M(['ember', 'star', 'ember'], [el('wyrm').base, el('wyrm').glow, el('wyrm').light], -14, 0, false, 'ring'),
  shade: M(['smoke', 'spark', 'smoke'], [el('shade').dark, el('shade').glow, el('shade').base], -8, 0, true, 'implode'),
  forge: M(['spark', 'spark', 'chip'], [el('forge').glow, '#fff1c9', el('forge').light], 26, 0, true, 'none'),
  glimmer: M(['star', 'star', 'dot'], [el('glimmer').glow, '#ffffff', el('glimmer').base], -8, 140, false, 'dash'),
  radiant: M(['ray', 'ray', 'star'], ['#ffffff', el('radiant').base, el('radiant').light], 0, 0, true, 'ring'),
  void: M(['dot', 'star', 'smoke'], [el('void').glow, el('void').light, el('void').dark], 0, 0, false, 'implode'),
};
/** The second colour a bit is drawn with (its glint, core or facet). */
export const bitCore = (e: ElementId, kind: Bit): string =>
  kind === 'ember' ? '#ffe9a8' : kind === 'drop' || kind === 'bubble' ? '#ffffff' : kind === 'chip' ? ELEMENTS[e].light : kind === 'leaf' ? ELEMENTS[e].dark : kind === 'shard' ? '#ffffff' : kind === 'bug' ? ELEMENTS[e].glow : ELEMENTS[e].glow;

/** A small seeded random, so an effect looks the same every time it renders. */
export const seeded = (seed: number) => () => { seed = (seed * 16807 + 11) % 2147483647; return (seed % 10007) / 10007; };

/**
 * Bits thrown out from a point: each flies outward along its own heading, slows, drops or drifts by the
 * element's weight, tumbles, and fades. `t` runs 0..1 over the effect's life. `arc` (radians, with `aim`)
 * narrows the spray to a fan: a hit sprays away from the blow, a full ring by default.
 */
export function Spray({ t, el: id, x, y, n, R, seed, r = 4, aim = 0, arc = Math.PI * 2, inward, late = 0, motif }: {
  t: Animated.Value | Animated.AnimatedInterpolation<number>; el: ElementId; x: number; y: number; n: number; R: number; seed: number;
  r?: number; aim?: number; arc?: number; inward?: boolean; late?: number;
  /** Shapes and colours to use instead of the element's own. */
  motif?: Motif;
}) {
  const m = motif ?? MOTIF[id], j = seeded(seed);
  const out: React.ReactNode[] = [];
  for (let i = 0; i < n; i++) {
    const a = aim + (arc >= Math.PI * 2 - 0.01 ? (i / n) * arc + j() * 0.5 : (i / Math.max(1, n - 1) - 0.5) * arc + (j() - 0.5) * 0.25);
    const d = R * (0.7 + j() * 0.6), kind = m.bits[i % m.bits.length], rr = r * (0.75 + j() * 0.6);
    const t0 = late * j() * 0.6, tt = late ? t.interpolate({ inputRange: [t0, 1], outputRange: [0, 1], extrapolate: 'clamp' }) : t;
    const dx = Math.cos(a) * d, dy = Math.sin(a) * d, g = m.grav * (0.7 + j() * 0.6);
    const rot = m.orient ? (a * 180) / Math.PI : (j() - 0.5) * 40;
    const sp = m.spin * (j() < 0.5 ? -1 : 1) * (0.6 + j() * 0.7);
    out.push(
      <Animated.View key={i} pointerEvents="none" style={{
        position: 'absolute', left: x - rr, top: y - rr, width: rr * 2, height: rr * 2,
        opacity: tt.interpolate({ inputRange: [0, 0.08, 0.65, 1], outputRange: [0, 1, 0.95, 0] }),
        transform: [
          { translateX: tt.interpolate({ inputRange: [0, 0.5, 1], outputRange: inward ? [dx, dx * 0.35, 0] : [dx * 0.12, dx * 0.78, dx] }) },
          { translateY: tt.interpolate({ inputRange: [0, 0.5, 1], outputRange: inward ? [dy, dy * 0.35, 0] : [dy * 0.12, dy * 0.78 + g * 0.22, dy + g] }) },
          { rotate: tt.interpolate({ inputRange: [0, 1], outputRange: [`${rot}deg`, `${rot + sp}deg`] }) },
          { scale: tt.interpolate({ inputRange: [0, 0.15, 0.6, 1], outputRange: [0.3, 1.15, 1, inward ? 0.2 : 0.45] }) },
        ],
      }}>
        <BitShape kind={kind} r={rr} c={m.cols[i % m.cols.length]} c2={m.core ?? bitCore(id, kind)} />
      </Animated.View>,
    );
  }
  return <>{out}</>;
}

/** A ring in the element's manner: a clean shock ring, a double ripple, a dashed frost ring, or one drawn inward. */
export function ElementRing({ t, el: id, x, y, R }: { t: Animated.Value | Animated.AnimatedInterpolation<number>; el: ElementId; x: number; y: number; R: number }) {
  const m = MOTIF[id], e = ELEMENTS[id];
  if (m.ring === 'none') return null;
  const ring = (k: number, col: string, w: number, from: number, to: number, o = 0.9, dashed = false) => (
    <Animated.View key={k} pointerEvents="none" style={{
      position: 'absolute', left: x - R, top: y - R, width: R * 2, height: R * 2, borderRadius: R, borderWidth: w, borderColor: col, borderStyle: dashed ? 'dashed' : 'solid',
      opacity: t.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, o, 0] }),
      transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [from, to] }) }],
    }} />
  );
  if (m.ring === 'implode') return <>{ring(0, e.glow, 2.5, 1.25, 0.15)}{ring(1, e.dark, 5, 1.05, 0.1, 0.6)}</>;
  if (m.ring === 'ripple') return <>{ring(0, e.glow, 2.5, 0.2, 1)}{ring(1, e.light, 1.5, 0.1, 0.72, 0.7)}</>;
  if (m.ring === 'dash') return <>{ring(0, e.glow, 2.5, 0.25, 1, 0.9, true)}</>;
  return <>{ring(0, e.glow, 3, 0.2, 1)}</>;
}

let glowN = 0;
/** A soft-edged glow of light, 2r across: bright in the middle and fading to nothing, never a hard-edged disc. */
export const SoftGlow = memo(function SoftGlow({ r, color, o = 0.8 }: { r: number; color: string; o?: number }) {
  const id = useRef('fg' + ++glowN).current;
  return (
    <Svg width={r * 2} height={r * 2}>
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} stopOpacity={o} /><Stop offset="0.5" stopColor={color} stopOpacity={o * 0.42} /><Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={r} cy={r} r={r} fill={`url(#${id})`} />
    </Svg>
  );
});

export const easeOut = Easing.out(Easing.cubic);
