// The fight screen. Everything that moves runs on native-driver animations so it stays smooth:
// - Between fights the team walks on while the ground and hills scroll, and the next enemies slide in with the
//   ground until the camera settles, so there is no cut.
// - Melee moves send the attacker to the target to strike it there. Ranged moves fire an element projectile or
//   beam, area moves burst on every target, and support moves sparkle on the creatures they help.
// - A creature that faints is knocked back, squashes and topples onto the ground. Enemies then dissolve in a puff;
//   your own stay down, dimmed, until revived.
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mouthPoint } from '../render/creature';
import { Animated, Easing, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, Ellipse, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { ELEMENTS, ElementId } from '../game/data/elements';
import { Flair, MoveDef, MoveStyle, RARITY_COLORS, StatusKind, moveStyle, supportKind } from '../game/data/moves';
import { Battle, Ev, Unit, act, aiChoose, isBuff, needsPick, nextActor, turnOrder, usable, validTargets } from '../game/battle';
import { Creature, STAGE_NAMES, stageOf, xpToNext } from '../game/creature';
import { express, starRating } from '../game/genome';
import { FightResult, Loot, Run, XpLine, finishFight, startBattle, emptyLoot } from '../game/run';
import { byId } from '../game/save';
import { castSfx, setMusic, sfx, tap } from './audio';
import { FxLayer, FxNew, FxSpec, StatusFx, isBeam } from './Fx';
import { Bar, Btn, C, CreatureView, bodyBoundsCached, hpColor, EggView, LiveCreature, CreatureGround, P, Stars, mixHex, readable, st } from './kit';
import { F, FadeIn, Glow, Grad, Icon, IconName, haptic, shadow } from './look';
import type { Pose } from '../render/creature';
import { rng, useGame } from './store';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
/** A steady number from a name, so a move always plays the same variation for the same kind of creature. */
const hashOf = (s: string) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
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

interface Float { id: number; uid: number; text: string; color: string; big?: boolean; /** A smaller line under the number. */ sub?: string; /** Which way it drifts, -1 or 1. */ dx?: number; small?: boolean; /** How far up it starts, when others are already showing over the same creature. */ lift?: number }

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
   * A bend of the body over its planted feet, in degrees of skew, positive = the top thrown to the right of the
   * screen. Driven by impulses that spring back with a wobble (a blow, the snap of a strike, a landing), so the body
   * flexes and settles like something alive instead of tipping as one stiff piece.
   */
  flex: Animated.Value;
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
  air: new Animated.Value(0), flex: new Animated.Value(0),
});
/** All the animated transforms one creature on the field needs, built once (see `nodesOf` in the fight screen). */
function buildNodes(a: UA, side: number, sz: number, enter: Animated.AnimatedNode, travel: Animated.Value) {
  const fallDir = side === 0 ? -1 : 1;
  const tx = side === 1 ? Animated.add(Animated.add(enter as Animated.Value, a.ox), a.shake) : Animated.add(Animated.add(a.ox, a.shake), Animated.multiply(travel, a.behind));
  const airK = a.air.interpolate({ inputRange: [0, sz], outputRange: [1, 0.55], extrapolate: 'clamp' });
  return {
    place: [{ translateX: tx }, { translateY: a.oy }],
    hud: [{ translateX: tx }, { translateY: Animated.subtract(a.oy, a.air) }],
    shadowOp: Animated.multiply(a.fade, a.air.interpolate({ inputRange: [0, sz], outputRange: [1, 0.4], extrapolate: 'clamp' })),
    shadow: [
      { translateX: a.down.interpolate({ inputRange: [0, 1], outputRange: [0, fallDir * sz * 0.03] }) },
      { scaleX: Animated.multiply(a.down.interpolate({ inputRange: [0, 1], outputRange: [1, 1.2] }), airK) },
      { scaleY: airK },
    ],
    body: [
      { translateY: Animated.multiply(a.air, -1) },
      { translateY: sz * 0.42 },
      // A lean is half a tip of the whole body and half a bend of it over the feet, so the body flexes into a move
      // instead of tilting like a plank; the bend is capped so the face never smears.
      { rotate: a.lean.interpolate({ inputRange: [-90, 90], outputRange: side === 0 ? ['-50deg', '50deg'] : ['50deg', '-50deg'] }) },
      { skewX: Animated.add(Animated.multiply(a.lean, side === 0 ? -0.5 : 0.5), Animated.multiply(a.flex, -1)).interpolate({ inputRange: [-18, 18], outputRange: ['-18deg', '18deg'], extrapolate: 'clamp' }) },
      { scaleX: a.stretch },
      { scaleY: a.stretch.interpolate({ inputRange: [0.5, 1, 1.5], outputRange: [1.4, 1, 0.8] }) },
      { translateY: -sz * 0.42 },
    ],
    bodyOp: Animated.multiply(a.fade, a.blink),
    inner: [
      { rotate: a.spin.interpolate({ inputRange: [0, 360], outputRange: side === 0 ? ['0deg', '360deg'] : ['0deg', '-360deg'] }) },
      // Lying down is in the drawing itself; this only settles it a touch lower, tipped a few degrees.
      { translateX: a.down.interpolate({ inputRange: [0, 1], outputRange: [0, fallDir * sz * 0.03] }) },
      { translateY: a.down.interpolate({ inputRange: [0, 1], outputRange: [0, sz * 0.03] }) },
      { rotate: a.down.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${fallDir * 7}deg`] }) },
      // A crouch squashes low and wide about the feet, so they stay planted on the ground.
      { translateY: sz * 0.42 },
      { scaleX: a.squash.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) },
      { scaleY: a.squash.interpolate({ inputRange: [0, 1], outputRange: [1, 0.72] }) },
      { translateY: -sz * 0.42 },
    ],
  };
}
const tm = (v: Animated.Value, toValue: number, duration: number, easing?: (t: number) => number) =>
  Animated.timing(v, { toValue, duration: Math.max(1, Math.round(duration)), easing, useNativeDriver: ND });
/** What a creature is doing right now, for its drawing: a pose, running legs, or facing back toward its team. */
interface Act { pose?: Pose; moving?: boolean; turned?: boolean; /** Still on its feet while it staggers, before it collapses. */ falling?: boolean }

/** One line of floating text with a dark rim, so it reads over any background. */
function Rimmed({ text, size, color }: { text: string; size: number; color: string }) {
  const base = { position: 'absolute' as const, left: 0, right: 0, textAlign: 'center' as const, fontFamily: F.bold, fontSize: size, lineHeight: size + 4 };
  return (
    <View style={{ height: size + 4 }}>
      {[[-1.2, 0], [1.2, 0], [0, -1.2], [0, 1.6]].map(([x, y], i) => <Text key={i} style={[base, { color: '#170f2b', transform: [{ translateX: x }, { translateY: y }] }]}>{text}</Text>)}
      <Text style={[base, { color }]}>{text}</Text>
    </View>
  );
}

/** A damage number or a word over a creature: pops in with a bounce, drifts up and away, and fades. */
const FloatText = memo(function FloatText({ f, x, y, onDone }: { f: Float; x: number; y: number; onDone: (id: number) => void }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: 1, duration: f.big ? 800 : 680, easing: Easing.linear, useNativeDriver: ND }).start(() => onDone(f.id));
  }, [a, f.id, f.big, onDone]);
  const size = f.big ? 25 : f.small ? 12.5 : 18;
  const rise = f.small ? 9 : 12;
  // `y` is the line the text sits on (just above the creature's health bar); it pops up from there and keeps drifting.
  const h = size + 4 + (f.sub ? 12 : 0);
  return (
    <Animated.View pointerEvents="none" style={{
      position: 'absolute', left: x - 70, top: y - h, width: 140,
      // Up for a beat to be read, then gone: it sits over the creature it is about, so it must not linger there.
      opacity: a.interpolate({ inputRange: [0, 0.06, 0.55, 1], outputRange: [0, 1, 1, 0] }),
      transform: [
        { translateX: a.interpolate({ inputRange: [0, 1], outputRange: [0, (f.dx ?? 0) * 10] }) },
        { translateY: a.interpolate({ inputRange: [0, 0.14, 1], outputRange: [10, -rise * 0.45, -rise] }) },
        { scale: a.interpolate({ inputRange: [0, 0.1, 0.22, 0.34, 1], outputRange: [0.4, f.big ? 1.45 : 1.25, 0.94, 1, 1] }) },
      ],
    }}>
      <Rimmed text={f.text} size={size} color={f.color} />
      {f.sub ? <View style={{ marginTop: -3 }}><Rimmed text={f.sub} size={11} color={f.color} /></View> : null}
    </Animated.View>
  );
});

/** A creature's picture: idles on its own, runs when moving, and shows its current pose. */
const Sprite = memo(function Sprite({ u, size, walking, ko, pose, turned, run }: { u: Unit; size: number; walking: boolean; ko: boolean; pose?: Pose; turned?: boolean; run?: boolean }) {
  // The ground glow is drawn separately, down on the ground, so it stays put when the creature leaps or leans.
  return <LiveCreature ph={u.ph} stage={u.stage} size={size} flip={(u.side === 1) !== !!turned} walking={walking && !ko} run={run} ko={ko} pose={ko ? 'idle' : pose} shadow={false} ground={false} />;
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

/** The name of the move being used: drops in at the top of the field. Rare and legendary moves get a brighter frame. */
const MoveBanner = memo(function MoveBanner({ who, move, color, rarity }: { who: string; move: string; color: string; rarity: number }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.spring(a, { toValue: 1, friction: 7, tension: 150, useNativeDriver: ND }).start(); }, [a]);
  const ink = readable(color), legend = rarity >= 3, rare = rarity === 2;
  return (
    <Animated.View pointerEvents="none" style={{
      position: 'absolute', top: 6, left: 0, right: 0, alignItems: 'center',
      opacity: a.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 1, 1] }),
      transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }, { scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) }],
    }}>
      <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: color, borderRadius: 13, paddingHorizontal: legend ? 14 : 12, paddingVertical: legend ? 5 : 4, borderWidth: legend || rare ? 2 : 1.5, borderColor: legend ? '#ffe9a8' : rare ? '#cfe3ff' : 'rgba(0,0,0,0.35)' }, shadow(legend ? '#ffd34d' : '#000', legend ? 10 : 5, legend ? 0.7 : 0.35, legend ? 0 : 2)]}>
        {legend ? <Icon name="star" size={12} color="#fff3bf" /> : null}
        <Text style={{ color: ink, fontFamily: F.med, fontSize: 12.5, opacity: 0.85 }} numberOfLines={1}>{who}</Text>
        <Text style={{ color: ink, fontFamily: F.bold, fontSize: legend ? 15.5 : 14 }} numberOfLines={1}>{move}</Text>
        {legend ? <Icon name="star" size={12} color="#fff3bf" /> : null}
      </View>
    </Animated.View>
  );
});

const STYLE_ICON: Record<MoveStyle, IconName> = { melee: 'sword', ranged: 'bolt', area: 'sparkle', support: 'shield' };
/** The badge says what a move does: a heart for healing and reviving, a shield only for moves that guard. */
function moveIcon(mv: MoveDef): IconName {
  if (moveStyle(mv) !== 'support') return STYLE_ICON[moveStyle(mv)];
  const k = supportKind(mv);
  return k === 'heal' || k === 'revive' || k === 'cleanse' ? 'heart' : k === 'shield' || k === 'guard' || k === 'ward' ? 'shield' : 'star';
}
/** One size for every name on a creature's move list, small enough that its longest name fits. */
const nameSize = (longest: number) => (longest > 17 ? 12.5 : longest > 15 ? 13 : longest > 13 ? 14 : 15);
/** A move in a few words: how hard it hits, or what it does instead. */
function moveBrief(mv: MoveDef): string {
  if (mv.pow) return `Power ${mv.pow}${(mv.hits ?? 1) > 1 ? ` ×${mv.hits}` : ''}`;
  if (mv.revive) return 'Revive';
  if (mv.heal || mv.teamHeal || mv.fullHeal) return 'Heal';
  if (mv.shield || mv.teamShield) return 'Shield';
  return mv.target === 'enemy' || mv.target === 'enemies' || mv.target === 'two' ? 'Weaken' : 'Boost';
}
const WHO: Record<MoveDef['target'], string> = { enemy: 'one enemy', enemies: 'all enemies', two: 'two enemies', ally: 'one ally', allies: 'the team', self: 'itself', fallen: 'a fallen ally', allFallen: 'all fallen allies' };

/** One move to pick: its element and kind on a badge, its name, and how hard it hits or when it is ready. */
/** How many pixels a line of the card's small print needs at a given size (Fredoka runs about 0.57 em a letter). */
const lineFs = (text: string, room: number) => room / (text.length * 0.57);
/** A card's second line: what it does, its type, and how many turns it rests after use ("CD"). The type is the
 *  first thing to go if a line cannot fit even at the smallest size: the badge's colour already shows it. */
function moveLine(mv: MoveDef, width: number): string {
  const type = mv.id === 'strike' ? 'Typeless' : ELEMENTS[mv.el].name, cd = mv.cd > 0 ? ` · CD ${mv.cd}` : '';
  const full = `${moveBrief(mv)} · ${type}${cd}`;
  return lineFs(full, width - 60) >= 9.5 ? full : `${moveBrief(mv)}${cd}`;
}
/** One size for the small print on every card of a creature's move list. */
const subSize = (moves: MoveDef[], width: number) => Math.max(9.5, Math.min(11.5, ...moves.map(m => lineFs(moveLine(m, width), width - 60))));
const MoveCard = memo(function MoveCard({ mv, ok, cd, on, width, size, sub, onPress }: { mv: MoveDef; ok: boolean; cd: number; on: boolean; width: number; size: number; sub: number; onPress: () => void }) {
  // The plain Strike has no element: it wears a neutral badge and says so.
  const strike = mv.id === 'strike', e = strike ? { ...ELEMENTS[mv.el], base: '#8b84a6', light: '#b9b3cf', name: 'Typeless' } : ELEMENTS[mv.el];
  const ink = readable(e.base);
  // A rarer move has a frame in its rarity's colour (the same colours as everywhere else in the game).
  const frame = on ? '#ffffff' : mv.rarity > 0 ? RARITY_COLORS[mv.rarity] : 'rgba(255,255,255,0.12)';
  return (
    <Pressable disabled={!ok} onPress={onPress} style={({ pressed }) => [{ width, borderRadius: 15, borderWidth: on ? 2 : 1.5, borderColor: frame, overflow: 'hidden', opacity: ok ? 1 : 0.5, transform: [{ scale: pressed ? 0.96 : 1 }] }, on ? shadow(C.gold, 10, 0.6, 0) : shadow('#000', 4, 0.3, 2)]}>
      <Grad colors={[mixHex('#3b2f6a', e.base, on ? 0.5 : 0.32), mixHex('#241c44', e.base, on ? 0.2 : 0.08)]} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: on ? 8.5 : 9, paddingHorizontal: on ? 7.5 : 8 }}>
        <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: e.base, borderWidth: 1.5, borderColor: e.light, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={moveIcon(mv)} size={19} color={ink} accent={e.base} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.text, fontFamily: F.semi, fontSize: size }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{mv.name}</Text>
          <Text style={{ color: cd > 0 ? '#ffb3a8' : C.dim, fontFamily: F.med, fontSize: sub }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
            {cd > 0 ? `Ready in ${cd}` : !ok ? 'Not usable now' : moveLine(mv, width)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
});

/** Your team along the bottom of the fight: a face, a name and a health bar each, so you never lose track of who is hurt. */
const PartyStrip = memo(function PartyStrip({ units, view, actor, W }: { units: Unit[]; view: UV[]; actor: number | null; W: number }) {
  const n = Math.max(3, units.length), gap = 6, cw = Math.min(92, (W - 20 - gap * (n - 1)) / n);
  // Sized so a name's longest word fits the card's width: a word is never split across lines unless it is longer
  // than the card at the smallest size.
  const nameFs = Math.max(8.5, Math.min(10.5, ...units.map(u => (cw - 13) / (Math.max(...u.name.split(' ').map(w => w.length)) * 0.6))));
  return (
    <View style={{ flexDirection: 'row', gap, justifyContent: 'center', marginBottom: 10 }}>
      {units.map(u => {
        const v = view[u.uid];
        if (!v) return null;
        const mine = actor === u.uid, frac = v.hp / u.max.hp;
        return (
          <View key={u.uid} style={{ width: cw, borderRadius: 13, padding: 5, backgroundColor: mine ? 'rgba(245,197,66,0.14)' : 'rgba(255,255,255,0.05)', borderWidth: 1.5, borderColor: mine ? C.gold : 'rgba(255,255,255,0.08)', opacity: v.alive ? 1 : 0.45 }}>
            <View style={{ alignItems: 'center', height: 34, justifyContent: 'flex-end' }}>
              <CreatureView ph={u.ph} stage={u.stage} size={34} shadow={false} ko={!v.alive} />
            </View>
            {/* A long name takes a second line (and shrinks a little first on the phone); it is never cut short. */}
            <View style={{ height: 25, justifyContent: 'center' }}>
              <Text style={{ color: mine ? C.gold : C.text, fontFamily: F.semi, fontSize: nameFs, lineHeight: 12, textAlign: 'center' }} numberOfLines={2}>{u.name}</Text>
            </View>
            <View style={{ marginTop: 2 }}><Bar frac={frac} color={hpColor(frac)} height={5} trail /></View>
            <Text style={{ color: C.dim, fontFamily: F.med, fontSize: 10, textAlign: 'center', marginTop: 1 }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>{v.alive ? `${Math.max(0, Math.round(v.hp))} / ${u.max.hp}` : 'Fainted'}</Text>
          </View>
        );
      })}
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
  const [w, setW] = useState(0);
  // Slides out on the native thread, so it doesn't compete with setting up the next chamber.
  useEffect(() => { Animated.timing(t, { toValue: 0, duration: ms, easing: Easing.linear, useNativeDriver: ND }).start(); }, [t, ms]);
  return (
    <View onLayout={e => setW(e.nativeEvent.layout.width)} style={{ height: 6, borderRadius: 3, backgroundColor: '#120d20', overflow: 'hidden', marginTop: 10 }}>
      {w > 0 ? <Animated.View style={{ height: 6, width: w, borderRadius: 3, backgroundColor: C.gold, transform: [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [-w, 0] }) }] }} /> : null}
    </View>
  );
}

export function LootView({ title, loot }: { title: string; loot: Loot }) {
  const text = lootLines(loot);
  if (!text && !loot.eggs.length) return null;
  return (
    <View style={{ marginTop: 10 }}>
      <Text style={{ color: C.gold, fontFamily: F.bold, fontSize: 15, marginBottom: 5 }}>{title}</Text>
      {text ? <LootChips loot={loot} eggs={0} /> : null}
      {loot.eggs.length ? (
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
          {loot.eggs.map((e, i) => (
            <FadeIn key={e.id} delay={250 + i * 120} dy={10}>
              <View style={{ alignItems: 'center' }}>
                <EggView ph={express(e.g)} size={52} />
                <Stars n={starRating(e.g)} size={10} />
              </View>
            </FadeIn>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** One teammate's share of the experience: its face, what it gained, and how far along its level it now is. */
function XpRow({ c, x, i }: { c: Creature; x: XpLine; i: number }) {
  const frac = c.level >= 100 ? 1 : c.xp / Math.max(1, xpToNext(c.level));
  return (
    <FadeIn delay={120 + i * 80} dy={8}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 7 }}>
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          <CreatureView ph={express(c.g)} stage={stageOf(c)} size={38} shadow={false} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={[st.row, { gap: 6, marginBottom: 3 }]}>
            <Text style={{ color: C.text, fontFamily: F.semi, fontSize: 15, flexShrink: 1 }} numberOfLines={1}>{c.name}</Text>
            {x.levels ? (
              <View style={{ backgroundColor: 'rgba(90,209,122,0.18)', borderColor: C.good, borderWidth: 1, borderRadius: 8, paddingHorizontal: 6 }}>
                <Text style={{ color: C.good, fontFamily: F.bold, fontSize: 12 }}>Lv {c.level - x.levels} → {c.level}</Text>
              </View>
            ) : <Text style={{ color: C.dim, fontFamily: F.med, fontSize: 12 }}>Lv {c.level}</Text>}
            <View style={{ flex: 1 }} />
            <Text style={{ color: '#d9ccff', fontFamily: F.semi, fontSize: 13 }}>+{x.xp} XP</Text>
          </View>
          <Bar frac={frac} color="#a898ff" height={6} />
          {x.newStage != null ? <Text style={{ color: C.gold, fontFamily: F.semi, fontSize: 12, marginTop: 2 }}>Grew into {x.newStage === 3 ? 'an' : 'a'} {STAGE_NAMES[x.newStage]}!</Text> : null}
          {x.learned.map(m => <Text key={m.id} style={{ color: C.accent2, fontFamily: F.med, fontSize: 12, marginTop: 1 }}>Learned {m.name}</Text>)}
        </View>
      </View>
    </FadeIn>
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
  const [banner, setBanner] = useState<{ who: string; move: string; color: string; rarity: number } | null>(null);
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
  /** The scenery dims behind a rare or legendary move, so the move itself stands out. */
  const focus = useRef(new Animated.Value(0)).current;
  const busy = useRef(false);
  /** Who acted last, so the panel can still say whose turn it is in the beat between turns. */
  const lastActor = useRef('');
  const D = W * 0.95; // how far the camera travels between chambers
  const enter = useMemo(() => Animated.subtract(D, travel), [D, travel]);
  // Every animated transform on the field is built once per creature and kept. Building them inline made each
  // re-render of the fight (and there is one for every effect, number and pose change) throw away and rebuild a few
  // dozen animated nodes per creature and re-attach them to the native views: that was the stutter.
  const nodes = useMemo(() => new WeakMap<UA, { side: number; sz: number; n: ReturnType<typeof buildNodes> }>(), [enter, travel]);
  const nodesOf = (a: UA, side: number, sz: number) => {
    let r = nodes.get(a);
    if (!r || r.side !== side || r.sz !== sz) { r = { side, sz, n: buildNodes(a, side, sz, enter, travel) }; nodes.set(a, r); }
    return r.n;
  };

  const A = (uid: number) => (ua.current[uid] ??= newUA());
  /** Each unit's mouth position in its drawing, worked out once. */
  const mouths = useRef(new Map<string, [number, number]>());
  const mouthOf = (u: Unit) => {
    const key = `${u.uid}:${u.stage}`;
    let m = mouths.current.get(key);
    if (!m) { m = mouthPoint(u.ph, u.stage); mouths.current.set(key, m); }
    return m;
  };
  /** Squash low and wide on landing, then spring back. */
  const land = (a: UA) => Animated.sequence([tm(a.squash, 0.55, 60, Easing.out(Easing.quad)), Animated.spring(a.squash, { toValue: 0, friction: 3.4, tension: 170, useNativeDriver: ND })]).start();
  /** Come down from a leap: squash flat, rebound in a little hop, and settle with a wobble. */
  // Landing squashes low and wide about the feet, then springs back.
  const touchdown = (a: UA, hop: number, lean = 0) => Animated.parallel([
    tm(a.stretch, 1, 80),
    Animated.sequence([tm(a.squash, 0.6, 60, Easing.out(Easing.quad)), Animated.spring(a.squash, { toValue: 0, friction: 3.2, tension: 170, useNativeDriver: ND })]),
    Animated.sequence([Animated.delay(50), tm(a.air, hop, 120, Easing.out(Easing.quad)), tm(a.air, 0, 130, Easing.in(Easing.quad))]),
    Animated.sequence([Animated.delay(60), Animated.spring(a.lean, { toValue: lean, friction: 4, tension: 120, useNativeDriver: ND })]),
  ]).start();
  /** Throw the top of the body `deg` degrees one way (screen space) and let it wobble back to upright. */
  const wobble = (a: UA, deg: number, ms = 55, friction = 3.2) =>
    Animated.sequence([tm(a.flex, deg, ms, Easing.out(Easing.quad)), Animated.spring(a.flex, { toValue: 0, friction, tension: 190, useNativeDriver: ND })]).start();
  /** A quick knock backward, for a creature that takes a hit. */
  const jolt = (uid: number, dir: number, px: number) => {
    const a = A(uid);
    Animated.sequence([tm(a.shake, dir * px, 45, Easing.out(Easing.quad)), Animated.spring(a.shake, { toValue: 0, friction: 4, tension: 160, useNativeDriver: ND })]).start();
    wobble(a, dir * Math.min(10, px * 0.9));
  };
  const T = () => (fastRef.current ? 0.5 : 1);

  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);
  /** The rings under the creature whose turn it is, and under anything it can target, breathe gently. */
  const ringPulse = useRef(new Animated.Value(0)).current;
  const ringStyle = useMemo(() => ({ opacity: ringPulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.7, 1, 0.7] }), transform: [{ scale: ringPulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.07, 1] }) }] }), [ringPulse]);
  useEffect(() => {
    const l = Animated.loop(Animated.timing(ringPulse, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }));
    l.start();
    return () => l.stop();
  }, [ringPulse]);

  /** Where the last text over each creature went up, so the next one stacks above it instead of on top of it. */
  const floatStack = useRef<Record<number, { at: number; top: number }>>({});
  const addFloat = useCallback((uid: number, text: string, color: string, o: { big?: boolean; sub?: string; dx?: number; small?: boolean } = {}) => {
    // Lines that arrive together for one creature take turns over three spots (centre, up to one side, up to the
    // other) instead of climbing: there is only a short lane between its name and its feet.
    const now = Date.now(), prev = floatStack.current[uid];
    const slot = prev && now - prev.at < 420 ? (prev.top + 1) % 3 : 0;
    floatStack.current[uid] = { at: now, top: slot };
    setFloats(fs => [...fs.slice(-14), { id: ++nextId.current, uid, text, color, ...o, lift: slot }]);
  }, []);
  const dropFloat = useCallback((id: number) => setFloats(fs => fs.filter(f => f.id !== id)), []);
  const addFx = useCallback((s: FxNew) => setFx(xs => [...xs.slice(-24), { ...(s as FxSpec), id: ++nextId.current }]), []);
  const dropFx = useCallback((id: number) => setFx(xs => xs.filter(x => x.id !== id)), []);
  const patch = (uid: number, fn: (v: UV) => UV) => setView(vs => vs.map((v, i) => (i === uid ? fn(v) : v)));

  // ---------- layout
  const b = bRef.current;
  if (actor != null && b?.units[actor]) lastActor.current = b.units[actor].name;
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
    // `lean` is toward the enemy, so being knocked back away from the hit is a lean the other way.
    const back = push === (u.side === 0 ? -1 : 1) ? -1 : 1;
    // 1. Knocked back by the blow, flashing.
    setAct(u.uid, { pose: 'hurt', falling: true });
    await run(Animated.parallel([
      Animated.timing(a.ox, { toValue: push * 16, duration: 150 * T(), easing: Easing.out(Easing.quad), useNativeDriver: ND }),
      tm(a.lean, back * 16, 150 * T(), Easing.out(Easing.quad)),
      Animated.sequence([
        Animated.timing(a.blink, { toValue: 0.25, duration: 60, useNativeDriver: ND }), Animated.timing(a.blink, { toValue: 1, duration: 60, useNativeDriver: ND }),
        Animated.timing(a.blink, { toValue: 0.25, duration: 60, useNativeDriver: ND }), Animated.timing(a.blink, { toValue: 1, duration: 60, useNativeDriver: ND }),
      ]),
    ]));
    // 2. Stagger: dazed, it sways and stumbles a step, sagging as its strength goes.
    setAct(u.uid, { pose: 'dizzy', falling: true });
    await run(Animated.parallel([
      Animated.sequence([
        tm(a.lean, -back * 9, 170 * T(), Easing.inOut(Easing.sin)),
        tm(a.lean, back * 7, 150 * T(), Easing.inOut(Easing.sin)),
        tm(a.lean, -back * 3, 120 * T(), Easing.inOut(Easing.sin)),
      ]),
      tm(a.ox, push * 24, 440 * T(), Easing.out(Easing.quad)),
      tm(a.stretch, 1.05, 440 * T(), Easing.in(Easing.quad)), // sagging: a little wider and shorter
    ]));
    // 3. The legs give way: it drops into its lying-down pose, flops against the ground with a little bounce,
    // and a puff of dust comes up.
    setAct(u.uid, { pose: undefined, falling: false });
    const p = place(u);
    await run(Animated.parallel([
      // Flattened by the impact (wide and short, pivoting at the feet), then springing back into shape.
      Animated.sequence([tm(a.stretch, 1.3, 90 * T(), Easing.in(Easing.quad)), Animated.spring(a.stretch, { toValue: 1, friction: 4.5, tension: 140, useNativeDriver: ND })]),
      Animated.sequence([Animated.delay(80 * T()), tm(a.air, p.sz * 0.06, 110, Easing.out(Easing.quad)), tm(a.air, 0, 120, Easing.in(Easing.quad))]),
      tm(a.lean, 0, 200 * T(), Easing.out(Easing.quad)),
      tm(a.down, 1, 320 * T(), Easing.out(Easing.quad)),
    ]));
    addFx({ kind: 'puff', x: p.x, y: p.feet - 6 });
    // It lies there a moment, then dissolves in a puff. Fallen teammates leave a ghost marker for revive moves.
    await sleep(520 * T());
    sfx('poof');
    addFx({ kind: 'puff', x: p.x, y: p.feet - p.sz * 0.3, color: ELEMENTS[u.ph.el1].light });
    Animated.timing(a.fade, { toValue: 0, duration: 420, useNativeDriver: ND }).start();
    if (u.side === 0) setLeftBehind(l => (l.includes(u.uid) ? l : [...l, u.uid]));
  }, [addFx, place, setAct, shakeField]);

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

  /**
   * Creatures that are still playing out their faint. The fight doesn't wait for them while others are still
   * standing; it only waits before the results, and before reviving one.
   */
  const fainting = useRef(new Map<number, Promise<void>>());
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
    /** The next damage is a burn or poison taking its toll, not a blow. */
    let ticking = false;
    /** The hit before this one was one of several landed by the same sweep. */
    let wasSpread = false;
    for (let ei = 0; ei < events.length; ei++) {
      const e = events[ei];
      if (!live.current) return;
      switch (e.t) {
        case 'move': {
          const u = b.units[e.u];
          moveEl = e.el;
          attackerSide = u.side;
          setBanner({ who: u.name, move: e.name, color: ELEMENTS[e.el].base, rarity: e.rarity });
          // Only a legendary move dims the scenery: it should feel like an event, not like every other turn.
          if (e.rarity >= 3) tm(focus, 0.2, 220, Easing.out(Easing.quad)).start();
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
            // Legged bodies run in bounding strides; things that swim or float glide.
            const legged = u0.ph.skel === 'biped' || u0.ph.skel === 'quad' || u0.ph.skel === 'multi';
            const runTo = async (ms = 300) => {
              setAct(e.u, { moving: true });
              const d = ms * T(), hopH = pa.sz * 0.06;
              await run(Animated.parallel([
                // Push off, carry speed through the middle, and ease up to the target.
                tm(a.ox, tx, d, Easing.bezier(0.3, 0, 0.35, 1)), tm(a.oy, ty, d, Easing.bezier(0.3, 0, 0.35, 1)), tm(a.lean, 10, d * 0.5, Easing.out(Easing.quad)),
                ...(legged ? [Animated.sequence([tm(a.air, hopH, d * 0.25, Easing.out(Easing.quad)), tm(a.air, 0, d * 0.25, Easing.in(Easing.quad)), tm(a.air, hopH * 0.8, d * 0.25, Easing.out(Easing.quad)), tm(a.air, 0, d * 0.25, Easing.in(Easing.quad))])] : []),
              ]));
              setAct(e.u, { moving: false });
            };
            /**
             * Anticipation before a jump: sink low and wide at the knees (about the feet), braced, leaning back a
             * touch, then a short tremble of held tension before the spring.
             */
            const crouch = async (x0: number, ms = 240) => {
              setAct(e.u, { pose: 'guard' });
              await run(Animated.parallel([tm(a.squash, 0.62, ms * T(), Easing.out(Easing.quad)), tm(a.lean, -5, ms * T(), Easing.out(Easing.quad)), tm(a.ox, x0 - dir * 4, ms * T(), Easing.out(Easing.quad)), tm(a.stretch, 1, ms * T())]));
              await run(Animated.sequence([tm(a.squash, 0.7, 45 * T()), tm(a.squash, 0.6, 45 * T()), tm(a.squash, 0.68, 45 * T())]));
            };
            /** Out of a crouch: the squash lets go as the body snaps tall and thin leaving the ground. */
            const unsquash = (ms = 80) => tm(a.squash, 0, ms, Easing.out(Easing.quad));
            // Wind up: lean back and crouch.
            const windUp = (ms = 130) => run(Animated.parallel([tm(a.lean, -14, ms * T(), Easing.out(Easing.quad)), tm(a.stretch, 0.88, ms * T()), tm(a.ox, tx - dir * 6, ms * T()), tm(a.flex, -dir * 5, ms * T(), Easing.out(Easing.quad))]));
            // Strike: snap forward with the attack pose.
            const strike = (push = 16, ms = 80) => {
              setAct(e.u, { pose: 'attack' });
              sfx('swing');
              // The top lags the snap, then whips through past the feet and wobbles back: follow-through.
              Animated.sequence([tm(a.flex, -dir * 6, ms * 0.5, Easing.out(Easing.quad)), tm(a.flex, dir * 9, ms * 0.9, Easing.out(Easing.quad)), Animated.spring(a.flex, { toValue: 0, friction: 3.2, tension: 170, useNativeDriver: ND })]).start();
              return run(Animated.parallel([tm(a.lean, 18, ms, Easing.out(Easing.quad)), tm(a.stretch, 1.14, ms), tm(a.ox, tx + dir * push, ms, Easing.out(Easing.quad))]));
            };
            switch (e.flair as Flair) {
              case 'pounce': {
                // Coil up at home (a slow sink, then a quick last squeeze), then leap the whole way in one arc and
                // come down on the target. The body tips to follow the arc: nose up on the way up, level at the top,
                // diving at the end.
                await crouch(0, 280);
                setAct(e.u, { pose: 'attack' });
                sfx('swing');
                addFx({ kind: 'puff', x: pa.x, y: pa.feet - 6 });
                // The top of the arc stays under the move's name at the top of the field, even from the back row.
                const hang = 420 * T(), peak = Math.max(Math.min(ty, 0) - fieldH * 0.3, -Math.max(pa.sz * 0.45, pa.top - 34));
                // The feet travel along the ground to the target while the body arcs high above them.
                const high = Math.max(pa.sz * 0.3, ty / 2 - peak);
                await run(Animated.parallel([
                  tm(a.ox, tx + dir * 8, hang, Easing.linear),
                  tm(a.oy, ty, hang, Easing.inOut(Easing.sin)),
                  Animated.sequence([tm(a.air, high, hang * 0.5, Easing.out(Easing.quad)), tm(a.air, 0, hang * 0.5, Easing.in(Easing.quad))]),
                  unsquash(70),
                  // Tall and thin as it springs, round at the top, then reaching forward as it dives.
                  Animated.sequence([tm(a.stretch, 0.84, hang * 0.18, Easing.out(Easing.quad)), tm(a.stretch, 1, hang * 0.34, Easing.inOut(Easing.sin)), tm(a.stretch, 1.16, hang * 0.48, Easing.in(Easing.quad))]),
                  Animated.sequence([tm(a.lean, -18, hang * 0.22, Easing.out(Easing.quad)), tm(a.lean, 4, hang * 0.36, Easing.inOut(Easing.sin)), tm(a.lean, 32, hang * 0.42, Easing.in(Easing.quad))]),
                ]));
                addFx({ kind: 'shock', el: e.el, x: pt.x - dir * pt.sz * 0.2, y: pt.feet, w: pt.sz * 1.3 });
                touchdown(a, pa.sz * 0.1, 12);
                if (big) shakeField(3);
                break;
              }
              case 'slam': {
                await runTo();
                // Crouch, spring up high stretching tall, curl and rear back at the top, then dive and come down hard.
                await crouch(tx, 220);
                setAct(e.u, { pose: 'cast' });
                addFx({ kind: 'puff', x: pa.x + tx, y: pa.feet + ty - 6 });
                const up = Math.max(pa.sz * 0.3, Math.min(pa.sz * 0.8, pa.top + ty - 34));
                await run(Animated.parallel([
                  tm(a.air, up, 260 * T(), Easing.out(Easing.cubic)),
                  unsquash(70),
                  Animated.sequence([tm(a.stretch, 0.82, 110 * T(), Easing.out(Easing.quad)), tm(a.stretch, 0.96, 150 * T(), Easing.inOut(Easing.sin))]),
                  tm(a.lean, -16, 260 * T(), Easing.out(Easing.quad)), tm(a.ox, tx - dir * 2, 260 * T(), Easing.out(Easing.quad)),
                ]));
                // A beat of hang time, drifting a touch higher.
                await run(Animated.parallel([tm(a.air, up + 6, 90 * T(), Easing.inOut(Easing.sin)), tm(a.lean, -20, 90 * T(), Easing.inOut(Easing.sin))]));
                setAct(e.u, { pose: 'attack' });
                sfx('swing');
                await run(Animated.parallel([tm(a.air, 0, 120, Easing.in(Easing.cubic)), tm(a.lean, 26, 120, Easing.in(Easing.quad)), tm(a.stretch, 1.2, 120), tm(a.ox, tx + dir * 12, 120)]));
                addFx({ kind: 'shock', el: e.el, x: pt.x, y: pt.feet, w: pt.sz * 1.7 });
                touchdown(a, pa.sz * 0.08, 10);
                if (big) shakeField(6);
                break;
              }
              case 'slash':
                await runTo();
                await windUp();
                if (hashOf(e.name) % 2 === 0) {
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
                await run(Animated.parallel([tm(a.squash, 0.5, 180 * T(), Easing.out(Easing.quad)), tm(a.lean, -8, 180 * T())]));
                sfx('swing');
                addFx({ kind: 'streak', el: e.el, x1: pa.x, x2: pt.x - dir * pt.sz * 0.3, y: pa.midY + ty * 0.5, h: pa.sz * 0.5 });
                await run(Animated.parallel([
                  tm(a.ox, tx + dir * 10, 340 * T(), Easing.in(Easing.quad)), tm(a.oy, ty, 340 * T()),
                  tm(a.spin, 720, 340 * T(), Easing.in(Easing.quad)), tm(a.lean, 0, 120 * T()), tm(a.stretch, 0.92, 120 * T()), tm(a.squash, 0, 200 * T()),
                ]));
                a.spin.setValue(0);
                addFx({ kind: 'whirl', el: e.el, x: pt.x - dir * pt.sz * 0.15, y: pt.midY, r: pt.sz * 0.5 });
                await strike(18, 70);
                break;
              }
              case 'dash': {
                // Get set like a sprinter: drop low, lean into the run and draw back, dig in with a kick of dust and
                // a tense shuffle, then blink across in a blur and cut straight through, stopping on the far side.
                setAct(e.u, { pose: 'guard' });
                await run(Animated.parallel([tm(a.squash, 0.45, 210 * T(), Easing.out(Easing.quad)), tm(a.lean, 14, 210 * T(), Easing.out(Easing.quad)), tm(a.ox, -dir * 8, 210 * T(), Easing.out(Easing.quad))]));
                addFx({ kind: 'puff', x: pa.x - dir * pa.sz * 0.22, y: pa.feet - 4 });
                await run(Animated.sequence([tm(a.ox, -dir * 11, 60 * T()), tm(a.ox, -dir * 8, 60 * T()), tm(a.ox, -dir * 10, 50 * T())]));
                const past = pt.x + dir * pt.sz * 0.55 - pa.x;
                meleeAt = { tx: past + dir * 16, dir };
                sfx('swing');
                addFx({ kind: 'streak', el: e.el, x1: pa.x, x2: pt.x + dir * pt.sz * 0.55, y: pa.midY + ty * 0.5, h: pa.sz * 0.6 });
                setAct(e.u, { pose: 'attack' });
                await run(Animated.parallel([tm(a.blink, 0.25, 40), unsquash(60), tm(a.ox, past, 90, Easing.out(Easing.cubic)), tm(a.oy, ty, 90), tm(a.lean, 20, 90), tm(a.stretch, 1.15, 90)]));
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
                // Which way a plain attack is thrown depends on the move and the body throwing it, and stays the same each time.
                const v = (hashOf(e.name + u0.ph.skel) % 100) / 100;
                if (v < 0.25) {
                  // Headbutt: rear back, then drive in head first.
                  await run(Animated.parallel([tm(a.lean, -20, 150 * T(), Easing.out(Easing.quad)), tm(a.stretch, 0.84, 150 * T()), tm(a.ox, tx - dir * 8, 150 * T())]));
                  setAct(e.u, { pose: 'roar' });
                  sfx('swing');
                  await run(Animated.parallel([tm(a.lean, 32, 90, Easing.out(Easing.quad)), tm(a.stretch, 1.2, 90), tm(a.ox, tx + dir * 18, 90, Easing.out(Easing.quad))]));
                } else if (v < 0.5) {
                  // Uppercut: crouch low under the target, then spring up through it and launch it.
                  await crouch(tx + dir * 2, 200);
                  setAct(e.u, { pose: 'cast' });
                  sfx('swing');
                  // Spring up through the target, stretching tall, head tipping back as it rises, then drift down and land.
                  await run(Animated.parallel([tm(a.air, pa.sz * 0.26, 120, Easing.out(Easing.cubic)), unsquash(60), tm(a.stretch, 0.82, 90, Easing.out(Easing.quad)), tm(a.lean, -12, 120, Easing.out(Easing.quad)), tm(a.ox, tx + dir * 12, 120, Easing.out(Easing.quad))]));
                  launch = true;
                  Animated.sequence([
                    Animated.parallel([tm(a.air, pa.sz * 0.29, 80, Easing.out(Easing.sin)), tm(a.stretch, 1, 80)]),
                    tm(a.air, 0, 200, Easing.in(Easing.quad)),
                  ]).start(({ finished }) => { if (finished) touchdown(a, 0, 0); });
                } else if (v < 0.7 && u0.ph.tail !== 'stub' && e.name !== 'Strike') {
                  // Tail swipe: sink and coil, then whip round so the tail leads and sweeps through the target,
                  // and turn back to face it. (The plain Strike keeps to a wound-up blow.)
                  await crouch(tx + dir * 2, 170);
                  sfx('swing');
                  setAct(e.u, { turned: true, pose: 'attack' });
                  addFx({ kind: 'slash', el: e.el, x: pt.x, y: pt.feet - pt.sz * 0.22, dir, n: 1, s: pt.sz * 1.2 });
                  await run(Animated.parallel([unsquash(70), tm(a.ox, tx + dir * 14, 90, Easing.out(Easing.quad)), tm(a.lean, -14, 90, Easing.out(Easing.quad))]));
                  await sleep(60);
                  setAct(e.u, { turned: false });
                  await run(tm(a.lean, 8, 80, Easing.out(Easing.quad)));
                } else {
                  await windUp();
                  await strike();
                }
              }
            }
          } else if (e.style === 'ranged') {
            sfx(castSfx(e.el));
            // Shots come out of the creature's actual mouth, wherever its body plan and head put it.
            const mo = mouthOf(b.units[e.u]);
            const mouthX = pa.x + dir * (mo[0] - 50) * pa.sz / 100, mouthY = pa.top + mo[1] * pa.sz / 100;
            const t0 = place(targets[0] ?? b.units[e.u]);
            /**
             * Every ranged attack winds up: the caster rears back and draws in, in its cast pose, while sparks
             * stream into an orb of power at its mouth. Rare and legendary moves gather longer and bigger.
             */
            // Long, four-footed bodies don't rear back and tip like a plank: they plant their feet, drop their
            // head and chest, and brace, the way a quadruped readies a blast.
            const skel = b.units[e.u].ph.skel, long = skel === 'quad' || skel === 'multi';
            /** A tremble that builds over ms: power straining to get out. */
            const tremble = (ms: number, px: number) => {
              const steps = Math.max(2, Math.round(ms / 45)), seq: Animated.CompositeAnimation[] = [];
              for (let i = 0; i < steps; i++) seq.push(tm(a.shake, (i % 2 ? -1 : 1) * px * (0.35 + (0.65 * i) / steps), ms / steps));
              seq.push(tm(a.shake, 0, 40));
              return Animated.sequence(seq);
            };
            const gather = async (ms: number, gx = mouthX, gy = mouthY) => {
              addFx({ kind: 'gather', el: e.el, x: gx, y: gy, dur: Math.round(ms), big });
              if (long) {
                // Brace: sink low and wide on planted feet, head down and forward, shaking as the power builds.
                setAct(e.u, { pose: 'guard' });
                await run(Animated.parallel([tm(a.squash, 0.42, ms, Easing.out(Easing.quad)), tm(a.lean, 6, ms, Easing.out(Easing.quad)), tm(a.ox, -dir * 5, ms, Easing.out(Easing.quad)), tremble(ms, 1.6)]));
                return;
              }
              setAct(e.u, { pose: 'cast' });
              await run(Animated.parallel([tm(a.lean, -12, ms, Easing.out(Easing.quad)), tm(a.squash, 0.2, ms, Easing.out(Easing.quad)), tm(a.ox, -dir * 5, ms, Easing.out(Easing.quad)), tremble(ms, 1)]));
            };
            /**
             * Release: thrust forward with a flash at the mouth and kick back from the shot. A beam keeps pushing
             * while it lasts (`hold` ms): the caster is driven back a little, shaking against it, mouth open, then
             * settles with a spring.
             */
            const release = (tx: number, ty: number, pose: Pose = 'attack', hold = 0) => {
              flashPose(e.u, long ? 'attack' : pose, 420 + hold);
              addFx({ kind: 'muzzle', el: e.el, x: mouthX, y: mouthY, ang: (Math.atan2(ty - mouthY, tx - mouthX) * 180) / Math.PI, big });
              const thrust = long
                ? Animated.parallel([tm(a.lean, 11, 70, Easing.out(Easing.quad)), tm(a.squash, 0.22, 70), tm(a.ox, dir * 6, 70), tm(a.stretch, 1.1, 70)])
                : Animated.parallel([tm(a.lean, 14, 70, Easing.out(Easing.quad)), tm(a.squash, 0, 70), tm(a.stretch, 1.14, 70), tm(a.ox, dir * 6, 70)]);
              const kick = Animated.parallel([tm(a.lean, long ? 2 : -7, 130, Easing.out(Easing.quad)), tm(a.stretch, 0.97, 130), tm(a.ox, -dir * 7, 130, Easing.out(Easing.quad))]);
              const push = hold > 0
                ? [Animated.parallel([tm(a.ox, -dir * 13, hold, Easing.out(Easing.quad)), tm(a.lean, long ? 4 : 6, hold), tm(a.squash, long ? 0.32 : 0.12, hold), tremble(hold, 2.2)])]
                : [];
              Animated.sequence([
                thrust,
                ...(hold > 0 ? push : [kick]),
                Animated.parallel([
                  Animated.spring(a.lean, { toValue: 0, friction: 5, tension: 110, useNativeDriver: ND }),
                  Animated.spring(a.stretch, { toValue: 1, friction: 4, tension: 140, useNativeDriver: ND }),
                  Animated.spring(a.squash, { toValue: 0, friction: 4, tension: 140, useNativeDriver: ND }),
                  Animated.spring(a.ox, { toValue: 0, friction: 6, tension: 90, useNativeDriver: ND }),
                ]),
              ]).start();
            };
            const flair = e.flair as Flair;
            let wait = 0;
            if (flair === 'bolt') {
              // Raise power overhead, then call lightning, or a pillar of light, down from the sky.
              Animated.sequence([tm(a.air, 10, 120, Easing.out(Easing.quad)), tm(a.air, 0, 160, Easing.in(Easing.quad))]).start();
              await gather(230 * T() * (big ? 1.4 : 1), pa.x, pa.midY - pa.sz * 0.55);
              flashPose(e.u, 'roar', 450);
              Animated.parallel([Animated.spring(a.lean, { toValue: 0, friction: 5, tension: 110, useNativeDriver: ND }), Animated.spring(a.stretch, { toValue: 1, friction: 4, tension: 140, useNativeDriver: ND }), Animated.spring(a.ox, { toValue: 0, friction: 6, tension: 90, useNativeDriver: ND })]).start();
              targets.forEach((t, i) => setTimeout(() => { const p2 = place(t); addFx({ kind: 'bolt', el: e.el, x: p2.x, y: p2.feet - p2.sz * 0.08 }); }, i * 80));
              addFx({ kind: 'flash', color: ELEMENTS[e.el].glow });
              if (big) shakeField(3);
              wait = 140 + targets.length * 80;
            } else if (flair === 'erupt') {
              // Stamp the ground, and it bursts up under the target.
              flashPose(e.u, 'cast', 450);
              Animated.sequence([tm(a.air, 12, 110, Easing.out(Easing.quad)), tm(a.air, 0, 110, Easing.in(Easing.quad))]).start();
              await sleep(220 * T());
              land(a);
              targets.forEach((t, i) => setTimeout(() => { const p2 = place(t); addFx({ kind: 'erupt', el: e.el, x: p2.x, y: p2.feet + 2, s: p2.sz * 0.85 }); }, i * 70));
              wait = 180 + targets.length * 70;
            } else if (flair === 'breath') {
              // A deep breath in, then a long blast, leaning into it.
              await gather(220 * T() * (big ? 1.4 : 1));
              release(t0.x, t0.midY);
              Animated.sequence([Animated.delay(200), tm(a.lean, 10, 160), Animated.spring(a.lean, { toValue: 0, friction: 5, tension: 110, useNativeDriver: ND })]).start();
              for (const t of targets) { const p2 = place(t); addFx({ kind: 'breath', el: e.el, x1: mouthX, y1: mouthY, x2: p2.x, y2: p2.midY, dur: 560 * T() }); }
              wait = 320 * T();
            } else if (flair === 'wave') {
              await gather(180 * T() * (big ? 1.4 : 1));
              release(t0.x, t0.feet);
              let longest = 0;
              for (const t of targets) {
                const p2 = place(t), dur = Math.round(Math.min(520, 220 + Math.abs(p2.x - pa.x) * 0.7) * T());
                addFx({ kind: 'wave', el: e.el, x1: pa.x + dir * pa.sz * 0.35, x2: p2.x, y: p2.feet + 2, s: Math.max(p2.sz, pa.sz) * 0.7, dur });
                longest = Math.max(longest, dur);
              }
              wait = longest * 0.85;
            } else {
              const beamMove = flair === 'beam' || (flair === 'proj' && isBeam(e.el));
              await gather((big ? 340 : 230) * T() * (beamMove ? 1.25 : 1));
              // A beam holds the caster braced against it for as long as it pours out.
              const beamDur = Math.round((big ? 660 : 540) * T());
              const beamHold = beamMove ? Math.round(beamDur * 0.82) : 0;
              release(t0.x, t0.midY, 'attack', beamHold);
              await sleep(40);
              for (const t of targets) {
                const p2 = place(t);
                const x1 = mouthX, y1 = mouthY, x2 = p2.x, y2 = p2.midY;
                const dur = Math.round(Math.min(380, 160 + Math.abs(x2 - x1) * 0.5) * T());
                if (flair === 'beam' || (flair === 'proj' && isBeam(e.el))) {
                  addFx({ kind: 'beam', el: e.el, x1, y1, x2, y2, dur: beamDur });
                  // The hit lands as the beam reaches the target, and the beam keeps pouring into it after.
                  wait = Math.max(wait, Math.min(150, beamDur * 0.26));
                } else if (flair === 'volley') {
                  // A spread of smaller shots, one after another.
                  for (let k = 0; k < 4; k++) setTimeout(() => {
                    if (k) addFx({ kind: 'muzzle', el: e.el, x: x1, y: y1, ang: (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI });
                    addFx({ kind: 'proj', el: e.el, x1, y1: y1 + (k - 1.5) * 7, x2: x2 + (k % 2 ? 5 : -5), y2: y2 + (k - 1.5) * 9, dur: Math.round(dur * 0.85) });
                  }, k * 75 * T());
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
            addFx({ kind: 'gather', el: e.el, x: pa.x, y: pa.midY - pa.sz * 0.25, dur: Math.round(260 * T()), big: true });
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
              shakeField(big ? 7 : 4);
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
              if (big) shakeField(3);
              await sleep(160 + targets.length * 90);
            } else {
              // A ring of power rolls out from the caster and breaks over each enemy as it reaches them.
              const far = Math.max(...targets.map(t => Math.abs(place(t).x - pa.x)), W * 0.4);
              addFx({ kind: 'nova', el: e.el, x: pa.x, y: pa.feet - pa.sz * 0.12, r: far + pa.sz * 0.4 });
              targets.forEach(t => {
                const p2 = place(t);
                setTimeout(() => addFx({ kind: 'burst', el: e.el, x: p2.x, y: p2.midY, big: true }), 120 + (Math.abs(p2.x - pa.x) / (far + pa.sz * 0.4)) * 300);
              });
              await sleep(300 * T());
            }
          } else {
            // Support moves are acted out by what they do: a healer lifts its light, a guard digs in, a rally is a
            // roar, a burst of speed is a blur on the spot.
            sfx(e.heal ? 'heal' : castSfx(e.el) === 'magic' ? 'magic' : 'buff');
            const kind = e.support ?? 'ward';
            const glow = ELEMENTS[e.el].glow;
            const settle = () => Animated.parallel([
              Animated.spring(a.lean, { toValue: 0, friction: 5, tension: 110, useNativeDriver: ND }),
              Animated.spring(a.stretch, { toValue: 1, friction: 4, tension: 140, useNativeDriver: ND }),
              Animated.spring(a.squash, { toValue: 0, friction: 4, tension: 150, useNativeDriver: ND }),
              Animated.spring(a.ox, { toValue: 0, friction: 6, tension: 100, useNativeDriver: ND }),
            ]).start();
            const live2 = targets.filter(t => t.alive || e.heal);
            if (kind === 'heal' || kind === 'cleanse' || kind === 'revive') {
              // Gather the light low, then lift it up and let it go.
              flashPose(e.u, 'cast', 620);
              addFx({ kind: 'gather', el: e.el, x: pa.x, y: pa.midY - pa.sz * 0.35, dur: Math.round(240 * T()) });
              await run(Animated.parallel([tm(a.squash, 0.4, 200 * T(), Easing.out(Easing.quad)), tm(a.lean, -4, 200 * T())]));
              Animated.parallel([
                Animated.sequence([tm(a.air, pa.sz * 0.16, 150, Easing.out(Easing.quad)), tm(a.air, 0, 190, Easing.in(Easing.quad))]),
                Animated.sequence([tm(a.squash, 0, 70), tm(a.stretch, 0.9, 110, Easing.out(Easing.quad)), Animated.spring(a.stretch, { toValue: 1, friction: 4, tension: 140, useNativeDriver: ND })]),
              ]).start(({ finished }) => { if (finished) settle(); });
              live2.forEach((t, i) => setTimeout(() => {
                const pt = place(t);
                addFx({ kind: 'pillar', color: kind === 'revive' ? '#fff3bf' : kind === 'cleanse' ? '#e6fbff' : C.good, x: pt.x, y: pt.feet, s: pt.sz, plain: kind === 'heal' });
              }, i * 70));
              await sleep(300 * T());
            } else if (kind === 'shield' || kind === 'guard') {
              // Dig in: drop low and wide with a thump, braced, and the protection rings out from it.
              flashPose(e.u, 'guard', 650);
              await run(Animated.parallel([tm(a.air, pa.sz * 0.1, 110 * T(), Easing.out(Easing.quad)), tm(a.stretch, 0.94, 110 * T())]));
              await run(Animated.parallel([tm(a.air, 0, 90, Easing.in(Easing.quad)), tm(a.stretch, 1, 90)]));
              land(a);
              addFx({ kind: 'shock', el: e.el, x: pa.x, y: pa.feet, w: pa.sz * 1.1 });
              await sleep(240 * T());
            } else if (kind === 'rally') {
              // Rear up tall and roar: a ring of nerve rolls out over the team.
              await run(Animated.parallel([tm(a.squash, 0.45, 170 * T(), Easing.out(Easing.quad)), tm(a.lean, 5, 170 * T())]));
              flashPose(e.u, 'roar', 600);
              Animated.sequence([
                Animated.parallel([tm(a.squash, 0, 70), tm(a.stretch, 0.86, 110, Easing.out(Easing.quad)), tm(a.lean, -10, 110, Easing.out(Easing.quad))]),
                Animated.delay(140),
              ]).start(({ finished }) => { if (finished) settle(); });
              addFx({ kind: 'nova', el: e.el, x: pa.x, y: pa.feet - pa.sz * 0.12, r: pa.sz * 1.5 });
              await sleep(340 * T());
            } else if (kind === 'swift') {
              // A blur on the spot: two quick darts back and forth, leaving streaks.
              flashPose(e.u, 'happy', 520);
              addFx({ kind: 'streak', el: e.el, x1: pa.x - dir * pa.sz * 0.7, x2: pa.x + dir * pa.sz * 0.7, y: pa.midY, h: pa.sz * 0.55 });
              await run(Animated.sequence([
                Animated.parallel([tm(a.ox, dir * 12, 60, Easing.out(Easing.quad)), tm(a.lean, 12, 60), tm(a.stretch, 1.1, 60)]),
                Animated.parallel([tm(a.ox, -dir * 10, 80, Easing.inOut(Easing.quad)), tm(a.lean, -8, 80)]),
                Animated.parallel([tm(a.ox, dir * 7, 70, Easing.inOut(Easing.quad)), tm(a.lean, 6, 70), tm(a.stretch, 1, 70)]),
              ]));
              settle();
              await sleep(200 * T());
            } else {
              // A quiet working: power drawn in, a small rise, and it settles on those it is meant for.
              flashPose(e.u, 'cast', 560);
              addFx({ kind: 'gather', el: e.el, x: pa.x, y: pa.midY - pa.sz * 0.3, dur: Math.round(260 * T()) });
              Animated.sequence([tm(a.air, 12, 140, Easing.out(Easing.quad)), tm(a.air, 0, 170, Easing.in(Easing.quad))]).start();
              await sleep(240 * T());
              for (const t of live2) { const pt = place(t); addFx({ kind: 'aura', color: glow, x: pt.x, y: pt.feet - pt.sz * 0.55 }); }
              await sleep(200 * T());
            }
          }
          break;
        }
        case 'dmg': {
          const t = b.units[e.u];
          const pt = place(t);
          const a = A(e.u);
          const away = t.side === 0 ? -1 : 1; // the way a blow pushes this creature: off toward its own side
          const direct = e.from >= 0 && !ticking;
          ticking = false;
          const frac = e.n / Math.max(1, t.max.hp);
          const heavy = direct && (e.mult > 1 || lastBig || frac > 0.3);
          // One move striking several creatures lands on them a beat apart, not one long turn each.
          const nx = events[ei + 1];
          const more = direct && nx?.t === 'dmg' && nx.from === e.from;
          const spread = more && nx.u !== e.u;
          const prevSpread = wasSpread;
          wasSpread = spread;
          if (direct) {
            // The moment of impact: the flash, the sound, and the target crushed back by the blow...
            // The jagged star is kept for a blow that truly lands hard on one creature; a move that sweeps over
            // several gives each a smaller flare, so three stars don't bury the field.
            const star = e.mult >= 1 && (e.mult > 1 || frac > 0.3) && !spread && !(prevSpread);
            if (lastStyle === 'melee') {
              addFx({ kind: 'impact', el: moveEl, x: pt.x - away * pt.sz * 0.12, y: pt.midY, big: star, dir: away });
              addFx({ kind: 'burst', el: moveEl, x: pt.x, y: pt.midY, big: heavy });
            } else {
              addFx({ kind: 'burst', el: moveEl, x: pt.x, y: pt.midY, big: heavy && !spread && !prevSpread });
              if (lastStyle === 'ranged' || lastStyle === 'area') addFx({ kind: 'impact', el: moveEl, x: pt.x - away * pt.sz * 0.08, y: pt.midY, big: star, dir: away });
            }
            sfx(e.mult > 1 || frac > 0.3 ? 'hitBig' : 'hit');
            if (t.alive) flashPose(e.u, e.shield >= e.n ? 'guard' : 'hurt', 420);
            Animated.parallel([tm(a.lean, heavy ? -15 : -10, 45, Easing.out(Easing.quad)), tm(a.stretch, heavy ? 0.88 : 0.93, 45, Easing.out(Easing.quad)), tm(a.blink, 0.5, 35)]).start();
            // ...held for an instant, attacker and target both frozen, so the hit has weight.
            if (!spread) await sleep((heavy ? 90 : 50) * T());
          }
          // Then everything lets go: the number pops, the health drops, and the target is knocked back.
          patch(e.u, v => ({ ...v, hp: Math.max(0, v.hp - (e.n - e.shield)), shield: Math.max(0, v.shield - e.shield) }));
          addFloat(e.u, `${e.n}`, e.mult > 1 ? '#ffd34d' : e.mult < 1 ? '#c9c3dc' : direct ? '#ffffff' : '#ff9d7b', {
            big: e.mult > 1, dx: away, sub: e.mult >= 4 ? 'Devastating!' : e.mult > 1 ? 'Hits hard!' : e.mult < 1 ? 'Hits weakly' : undefined,
          });
          if (direct && lastStyle === 'melee' && melee != null && !followed) {
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
          // The screen only shakes for a crushing hit: super effective and a big chunk of health at once.
          if (direct && e.mult > 1 && frac > 0.3) shakeField(3);
          if (launch && t.alive) {
            launch = false;
            Animated.sequence([tm(a.air, pt.sz * 0.3, 160, Easing.out(Easing.quad)), tm(a.air, 0, 200, Easing.in(Easing.quad)), tm(a.air, pt.sz * 0.06, 90, Easing.out(Easing.quad)), tm(a.air, 0, 90, Easing.in(Easing.quad))]).start();
          }
          if (e.shield > 0 && t.alive) addFx({ kind: 'shieldUp', x: pt.x, y: pt.midY, s: pt.sz });
          if (direct) {
            // Knocked back in proportion to the blow (a boss barely budges), then springing back to its spot.
            const kb = (heavy ? 15 : 8) * Math.min(1.5, 0.75 + frac * 2) * (t.boss ? 0.5 : 1);
            Animated.parallel([
              Animated.sequence([tm(a.shake, away * kb, 70, Easing.out(Easing.cubic)), Animated.spring(a.shake, { toValue: 0, friction: 5, tension: 130, useNativeDriver: ND })]),
              Animated.sequence([tm(a.lean, heavy ? -18 : -12, 60, Easing.out(Easing.quad)), Animated.spring(a.lean, { toValue: 0, friction: 4, tension: 140, useNativeDriver: ND })]),
              Animated.sequence([tm(a.stretch, 1.05, 80, Easing.out(Easing.quad)), Animated.spring(a.stretch, { toValue: 1, friction: 4, tension: 150, useNativeDriver: ND })]),
              Animated.sequence([tm(a.blink, 0.45, 40), tm(a.blink, 1, 120)]),
              // The blow compresses the body and throws its top away from the attacker; it wobbles back upright.
              Animated.sequence([tm(a.squash, heavy ? 0.32 : 0.2, 50, Easing.out(Easing.quad)), Animated.spring(a.squash, { toValue: 0, friction: 3.6, tension: 200, useNativeDriver: ND })]),
              Animated.sequence([tm(a.flex, away * (heavy ? 13 : 9) * (t.boss ? 0.5 : 1), 55, Easing.out(Easing.quad)), Animated.spring(a.flex, { toValue: 0, friction: 2.9, tension: 200, useNativeDriver: ND })]),
            ]).start();
          } else {
            // Burn, poison and the like: a wince, no blow.
            if (t.alive) flashPose(e.u, 'hurt', 300);
            Animated.sequence([tm(a.shake, 4, 40), tm(a.shake, -3, 50), tm(a.shake, 0, 40)]).start();
            wobble(a, 6, 50, 3.4);
            Animated.sequence([tm(a.blink, 0.55, 50), tm(a.blink, 1, 100)]).start();
            sfx('hit');
          }
          await sleep((spread ? 70 : more ? 110 : lastStyle === 'melee' ? 150 : 160) * T());
          break;
        }
        case 'miss': {
          addFloat(e.u, 'Dodged', '#9fe8ff', { small: true });
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
          addFloat(e.u, `+${e.n}`, '#7dffa0');
          const p2 = place(b.units[e.u]);
          addFx({ kind: 'heal', x: p2.x, y: p2.midY, s: p2.sz, color: C.good });
          flashPose(e.u, 'happy', 650);
          await sleep(120 * T());
        } break;
        case 'shield': if (e.n > 0) {
          patch(e.u, v => ({ ...v, shield: v.shield + e.n }));
          addFloat(e.u, 'Shield', '#9fe8ff', { small: true });
          sfx('shield');
          const p2 = place(b.units[e.u]);
          addFx({ kind: 'shieldUp', x: p2.x, y: p2.midY, s: p2.sz });
          flashPose(e.u, 'guard', 600);
          await sleep(110 * T());
        } break;
        case 'status':
          patch(e.u, v => (v.statuses.includes(e.k) ? v : { ...v, statuses: [...v.statuses, e.k] }));
          // No floating word: the badge that appears under the name says which condition it is.
          {
            const p2 = place(b.units[e.u]);
            addFx({ kind: 'stat', x: p2.x, y: p2.midY, s: p2.sz, color: STATUS_COLOR[e.k], up: isBuff(e.k), k: e.k });
            if (isBuff(e.k)) flashPose(e.u, 'roar', 450);
          }
          if (!statusSound && !isBuff(e.k) && b.units[e.u].side !== attackerSide) { statusSound = true; sfx('debuff'); }
          await sleep(80 * T());
          break;
        // A lost turn is announced where turns are announced, in the banner, not as a word over the creature (its
        // badge already says why).
        case 'skip': setBanner({ who: b.units[e.u].name, move: "can't move", color: '#8a78b8', rarity: 0 }); sfx('debuff'); await sleep(520 * T()); break;
        case 'faint': {
          patch(e.u, v => ({ ...v, alive: false, hp: 0, shield: 0, statuses: [] }));
          // Played alongside the fight rather than holding it up; several can go down together.
          const pr = faintAnim(b.units[e.u], attackerX);
          const uid = e.u;
          fainting.current.set(uid, pr);
          pr.catch(() => {}).finally(() => { if (fainting.current.get(uid) === pr) fainting.current.delete(uid); });
          break;
        }
        case 'revive':
          await fainting.current.get(e.u);
          patch(e.u, v => ({ ...v, alive: true, hp: e.n })); addFloat(e.u, 'Revived!', '#7dffa0'); await reviveAnim(b.units[e.u]); break;
        case 'text': addFloat(e.u, e.s, '#e7e0ff', { small: true }); await sleep(130 * T()); break;
        case 'tick': {
          const p = place(b.units[e.u]);
          moveEl = e.k === 'burn' ? 'ember' : 'venom';
          addFx({ kind: 'burst', el: moveEl, x: p.x, y: p.midY });
          ticking = true;
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
        const hs = bRef.current!.units[m].ph.skel, homeLegs = hs === 'biped' || hs === 'quad' || hs === 'multi', homeHop = place(bRef.current!.units[m]).sz * 0.05;
        // Turn with a little squash so the flip reads as a turn, then run home leaning into it.
        setAct(m, { pose: undefined, turned: true, moving: true });
        tm(a.stretch, 1, 90).start();
        Animated.sequence([tm(a.squash, 0.28, 70), Animated.spring(a.squash, { toValue: 0, friction: 4, tension: 160, useNativeDriver: ND })]).start();
        tm(a.blink, 1, 120).start();
        await run(Animated.parallel([
          Animated.timing(a.ox, { toValue: 0, duration: 340 * T(), easing: Easing.inOut(Easing.cubic), useNativeDriver: ND }),
          Animated.timing(a.oy, { toValue: 0, duration: 340 * T(), easing: Easing.inOut(Easing.cubic), useNativeDriver: ND }),
          // Down first if it is still in the air, then a bounding stride home for anything with legs.
          Animated.sequence([
            tm(a.air, 0, 120 * T(), Easing.in(Easing.quad)),
            ...(homeLegs ? [tm(a.air, homeHop, 55 * T(), Easing.out(Easing.quad)), tm(a.air, 0, 55 * T(), Easing.in(Easing.quad)), tm(a.air, homeHop * 0.7, 55 * T(), Easing.out(Easing.quad)), tm(a.air, 0, 55 * T(), Easing.in(Easing.quad))] : []),
          ]),
          Animated.sequence([tm(a.lean, 6, 120 * T(), Easing.out(Easing.quad)), tm(a.lean, 0, 220 * T(), Easing.inOut(Easing.quad))]),
        ]));
        // Arrive: turn back to face the fight and settle.
        setAct(m, { turned: false, moving: false });
        Animated.sequence([tm(a.squash, 0.32, 70), Animated.spring(a.squash, { toValue: 0, friction: 3.5, tension: 150, useNativeDriver: ND })]).start();
      } else setAct(m, null);
    }
    tm(focus, 0, 300, Easing.inOut(Easing.quad)).start();
    if (live.current) { setView(snap(b)); setOrder(turnOrder(b, 8)); }
  }, [addFloat, addFx, faintAnim, place, reviveAnim, shakeField, fieldH, focus]);

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
      if (b.over != null || (theRun.actionLimit > 0 && b.actions[0] >= theRun.actionLimit)) {
        // Let the last creatures finish going down before the results.
        await Promise.all([...fainting.current.values()]);
        await sleep(400);
        if (live.current) finish();
        return;
      }
      const { actor: uid, events } = nextActor(b);
      await play(events);
      if (uid == null) continue;
      const u = b.units[uid];
      if (u.side === 0 && !autoRef.current) {
        setBanner(null); setActor(uid); setSel(null);
        // A little hop: this one is ready for orders.
        const ar = A(uid);
        Animated.sequence([tm(ar.air, 8, 110, Easing.out(Easing.quad)), tm(ar.air, 0, 130, Easing.in(Easing.quad))]).start();
        return;
      }
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
    fainting.current.clear();
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
      a.ox.setValue(0); a.oy.setValue(0); a.shake.setValue(0); a.blink.setValue(1); a.squash.setValue(0); a.lean.setValue(0); a.stretch.setValue(1); a.spin.setValue(0); a.air.setValue(0); a.flex.setValue(0);
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
        <Animated.View pointerEvents="none" style={{ position: 'absolute', left: -W * 0.1, top: -fieldH * 0.1, width: W * 1.2, height: fieldH * 1.2, backgroundColor: '#0d0722', opacity: focus }} />

        {b && units.map(u => {
          const v = view[u.uid];
          if (!v) return null;
          const pos = place(u);
          const a = A(u.uid);
          const canPick = targets.includes(u.uid);
          const isActor = actor === u.uid;
          const walking = mode === 'walk' && v.alive && u.side === 0;
          const N = nodesOf(a, u.side, pos.sz);
          // Your team's views stay mounted from chamber to chamber; only the new enemies mount, keeping the walk smooth.
          return (
            <Animated.View key={u.side === 0 ? `p_${u.uid}_${u.cid}` : `${fightNo}_${u.uid}`} style={{
              position: 'absolute', left: pos.left, top: pos.top, width: pos.sz, height: pos.sz, transform: N.place,
            }}>
              <Pressable onPress={() => onTapUnit(u.uid)} style={{ width: pos.sz, height: pos.sz }}>
                {(canPick || isActor) ? <Animated.View pointerEvents="none" style={{ position: 'absolute', left: pos.sz * 0.1, right: pos.sz * 0.1, bottom: -2, height: pos.sz * 0.28, borderRadius: pos.sz, borderWidth: 2.5, borderColor: isActor ? C.gold : allyPick ? C.good : C.bad, backgroundColor: isActor ? 'rgba(245,197,66,0.18)' : 'rgba(255,255,255,0.12)',
                  ...ringStyle }} /> : null}
                {/* The shadow lies on the ground on its own, so it stays flat when the creature leans or falls over,
                    and stays down when it leaps, shrinking and fading the higher the creature goes. */}
                <Animated.View pointerEvents="none" style={{
                  position: 'absolute', left: pos.sz * 0.26, top: pos.sz * 0.88, width: pos.sz * 0.48, height: pos.sz * 0.08, borderRadius: pos.sz,
                  backgroundColor: 'rgba(0,0,0,0.2)', opacity: N.shadowOp, transform: N.shadow,
                }} />
                <CreatureGround ph={u.ph} stage={u.stage} size={pos.sz} flip={u.side === 1} air={a.air} opacity={a.fade} />
                {v.alive ? <StatusFx statuses={v.statuses} shield={v.shield > 0} size={pos.sz} part="ground" /> : null}
                <Animated.View style={{
                  // Lean, stretch and breathing all pivot at the feet.
                  width: pos.sz, height: pos.sz, transform: N.body,
                }}>
                <Animated.View style={{
                  width: pos.sz, height: pos.sz, opacity: N.bodyOp, transform: N.inner,
                }}>
                  <Sprite u={u} size={pos.sz} walking={walking || !!acts[u.uid]?.moving} run={!!acts[u.uid]?.moving} ko={!v.alive && !acts[u.uid]?.falling} pose={acts[u.uid]?.pose ?? (v.statuses.includes('stun') || v.statuses.includes('freeze') ? 'dizzy' : undefined)} turned={acts[u.uid]?.turned} />
                  {v.alive ? <StatusFx statuses={v.statuses} shield={v.shield > 0} size={pos.sz} part="body" bounds={bodyBoundsCached(u.ph, u.stage)} flip={u.side === 1} /> : null}
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
          const N2 = nodesOf;
          return (
            <Animated.View key={u.side === 0 ? `hudp_${u.uid}_${u.cid}` : `hud${fightNo}_${u.uid}`} pointerEvents="none" style={{
              position: 'absolute', left: pos.left, top: pos.top, width: pos.sz, transform: N2(a, u.side, pos.sz).hud,
            }}>
              <View style={{ position: 'absolute', top: -9, left: pos.sz * 0.08, right: pos.sz * 0.08 }}>
                <View style={{ borderRadius: 4, borderWidth: 1, borderColor: 'rgba(15,10,30,0.7)' }}><Bar frac={v.hp / u.max.hp} color={hpColor(v.hp / u.max.hp)} height={5} trail /></View>
                {v.shield > 0 ? <View style={{ marginTop: 1 }}><Bar frac={v.shield / (u.max.hp * 0.6)} color="#9fe8ff" height={3} /></View> : null}
                <Text style={{ color: u.side === 1 ? '#ffc2c7' : '#fff', fontSize: 8, fontWeight: '700', textAlign: 'center', textShadowColor: '#000', textShadowRadius: 2 }} numberOfLines={1}>{u.ph.shiny ? '✦ ' : ''}Lv{u.level} {u.name}</Text>
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

        {b && floats.map(f => {
          const u = b.units[f.uid];
          if (!u) return null;
          const pos = place(u);
          // Numbers pop up above the health bar, so the bar can be seen dropping under them.
          // Text pops up over the creature it is about (its head and shoulders), where there is no doubt whose it
          // is: the space above a creature's head belongs to whoever stands in the row behind.
          // The lane: below the creature's own bar, name and condition badges (the top 22 px of its box), above
          // its feet, where the bar of whoever stands in the row in front begins.
          const slot = f.lift ?? 0, fh = (f.big ? 29 : f.small ? 16.5 : 22) + (f.sub ? 12 : 0);
          const fy = Math.max(pos.top + 24 + fh + 12, pos.top + pos.sz * 0.8 - [0, 13, 7][slot]);
          return <FloatText key={f.id} f={f} x={Math.max(40, Math.min(W - 40, pos.x + [0, 24, -24][slot] + (f.dx ?? 0) * pos.sz * 0.2))} y={fy} onDone={dropFloat} />;
        })}

        {banner && mode === 'fight' ? <MoveBanner key={banner.who + banner.move} who={banner.who} move={banner.move} color={banner.color} rarity={banner.rarity} /> : null}
        {mode === 'walk' ? (
          <View pointerEvents="none" style={{ position: 'absolute', top: 6, alignSelf: 'center', backgroundColor: '#0008', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 4 }}>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{fightNo <= 1 ? 'Entering...' : fight?.boss ? 'Something big is ahead...' : 'On to the next chamber...'}</Text>
          </View>
        ) : null}
      </Animated.View>
      </View>

      <View style={{ flex: 1, padding: 10 }}>
        {/* Your team's health sits right under the field, where the eye already is; the moves come below it, in reach of a thumb. */}
        {b && !result && winH >= 700 ? <PartyStrip units={b.units.filter(u => u.side === 0)} view={view} actor={actor} W={W} /> : null}
        <View style={{ flex: 1 }}>
        {me && b ? (
          <>
            <View style={[st.row, { marginBottom: 7 }]}>
              <Text style={{ color: C.gold, fontFamily: F.bold, fontSize: 18, flex: 1 }} numberOfLines={1}>{me.name}'s turn</Text>
              <Text style={{ color: sel && needsPick(sel) ? C.gold : C.dim, fontFamily: F.med, fontSize: 12 }}>{sel ? (needsPick(sel) ? 'Tap a highlighted target' : '') : 'Pick a move'}</Text>
            </View>
            <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {me.moves.map(mv => (
                <MoveCard key={mv.id} mv={mv} size={nameSize(Math.max(...me.moves.map(m => m.name.length)))} sub={subSize(me.moves, (W - 26) / 2)} ok={usable(b, me, mv)} cd={me.cds[mv.id] ?? 0} on={sel?.id === mv.id} width={(W - 26) / 2} onPress={() => { sfx('select'); haptic('select'); setSel(mv); }} />
              ))}
            </ScrollView>
            {sel ? (
              <FadeIn key={sel.id} dy={6}>
                <View style={[st.row, { marginTop: 7, borderRadius: 12, paddingVertical: 7, paddingHorizontal: 10, backgroundColor: 'rgba(255,255,255,0.06)', borderLeftWidth: 3, borderLeftColor: ELEMENTS[sel.el].base }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.text, fontSize: 12.5, lineHeight: 17 }}>{sel.desc}</Text>
                    <Text style={{ color: C.dim, fontFamily: F.med, fontSize: 11, marginTop: 1 }}>Targets {WHO[sel.target]}{sel.cd ? ` · ${sel.cd}-turn cooldown` : ''}</Text>
                  </View>
                  {!needsPick(sel) ? <Btn small kind="gold" label="Use" onPress={() => fire(sel, targets[0] ?? -1)} /> : null}
                </View>
              </FadeIn>
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
        ) : mode === 'fight' && !result && b ? (
          // Someone else is acting: say who, so the panel is never an empty box.
          <Text style={{ color: C.dim, fontFamily: F.semi, fontSize: 15, textAlign: 'center', marginTop: 14 }} numberOfLines={1}>{lastActor.current ? `${lastActor.current}'s turn` : 'Waiting...'}</Text>
        ) : null}
        </View>
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
              {result.xp.map((x, i) => {
                const c = byId(save, x.cid);
                return c ? <XpRow key={x.cid} c={c} x={x} i={i} /> : null;
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
