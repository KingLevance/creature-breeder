// Shared look and small building blocks used by every screen.
import React, { memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';
import { ELEMENTS, ElementId } from '../game/data/elements';
import { MoveDef, RARITY_COLORS, RARITY_NAMES } from '../game/data/moves';
import { Creature, STAGE_NAMES, stageOf, typeLabel } from '../game/creature';
import { Pheno, express, rareCarrierCount, starRating } from '../game/genome';
import { Shape, creatureOpacity, drawCreature, drawEgg } from '../render/creature';

export const C = {
  bg: '#171226', panel: '#231b3a', panel2: '#2e2450', line: '#43366b', text: '#f4efff', dim: '#a99fc9',
  gold: '#f5c542', good: '#5ad17a', bad: '#f0616d', accent: '#8f7cff', accent2: '#ff9f5a', male: '#6fb7ff', female: '#ff8fc7',
};

function ShapeNodes({ shapes }: { shapes: Shape[] }) {
  return (
    <>
      {shapes.map((s, i) => {
        const common = { fill: s.fill ?? 'none', stroke: s.stroke, strokeWidth: s.sw, opacity: s.op, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
        if (s.t === 'path') return <Path key={i} {...common} d={s.d} />;
        if (s.t === 'circle') return <Circle key={i} {...common} cx={s.cx} cy={s.cy} r={s.r} />;
        return <Ellipse key={i} {...common} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} transform={s.rot ? `rotate(${s.rot} ${s.cx} ${s.cy})` : undefined} />;
      })}
    </>
  );
}

interface CreatureViewProps { ph: Pheno; stage: number; size: number; phase?: number; walking?: boolean; flip?: boolean; shadow?: boolean }
/** One creature, drawn from its visible traits. The same component feeds cards, the nursery and battles. */
export const CreatureView = memo(function CreatureView({ ph, stage, size, phase = 0, walking, flip, shadow }: CreatureViewProps) {
  const shapes = useMemo(() => drawCreature(ph, { stage, phase, walking, shadow }), [ph, stage, phase, walking, shadow]);
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" opacity={creatureOpacity(ph)} style={flip ? { transform: [{ scaleX: -1 }] } : undefined}>
      <ShapeNodes shapes={shapes} />
    </Svg>
  );
});

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
    <Pressable onPress={disabled ? undefined : onPress} style={({ pressed }) => [st.btn, small && st.btnSmall, { backgroundColor: bg, borderColor: kind === 'ghost' ? C.line : bg, opacity: pressed ? 0.75 : 1 }, style]}>
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
