// The fight screen: turn-order bar, the two teams, move buttons, and the result of each fight in a run.
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, Ellipse, LinearGradient, Rect, Stop } from 'react-native-svg';
import { ELEMENTS } from '../game/data/elements';
import { MoveDef, StatusKind } from '../game/data/moves';
import { Battle, Ev, Unit, act, aiChoose, isBuff, needsPick, nextActor, turnOrder, usable, validTargets } from '../game/battle';
import { STAGE_NAMES } from '../game/creature';
import { express, starRating } from '../game/genome';
import { FightResult, Loot, Run, finishFight, startBattle } from '../game/run';
import { byId } from '../game/save';
import { Bar, Btn, C, CreatureView, EggView, P, Stars, readable, st } from './kit';
import { rng, useGame } from './store';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

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

const FloatText = memo(function FloatText({ f, x, y, onDone }: { f: Float; x: number; y: number; onDone: (id: number) => void }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: 1, duration: 850, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(() => onDone(f.id));
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

const UnitSprite = memo(function UnitSprite({ u, v, size, phase, walking }: { u: Unit; v: UV; size: number; phase: number; walking: boolean }) {
  return (
    <View style={{ opacity: v.alive ? 1 : 0.22, transform: v.alive ? undefined : [{ rotate: u.side === 0 ? '-80deg' : '80deg' }] }}>
      <CreatureView ph={u.ph} stage={u.stage} size={size} flip={u.side === 1} phase={phase} walking={walking} />
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

export function BattleScreen({ run, onExit }: { run: Run; onExit: () => void }) {
  const { save, mutate } = useGame();
  const { width: W, height: winH } = useWindowDimensions();
  const fieldH = Math.min(W * 0.92, winH * 0.46);
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
  const [result, setResult] = useState<FightResult | null>(null);
  const [mode, setMode] = useState<'fight' | 'walk'>('walk');
  const [tick, setTick] = useState(0);
  const [fightNo, setFightNo] = useState(0);
  const floatId = useRef(0);
  const anims = useRef<Record<number, { lunge: Animated.Value; hit: Animated.Value }>>({});
  const bob = useRef(new Animated.Value(0)).current;
  const busy = useRef(false);

  const anim = (uid: number) => (anims.current[uid] ??= { lunge: new Animated.Value(0), hit: new Animated.Value(0) });
  const T = () => (fastRef.current ? 0.45 : 1);

  useEffect(() => {
    live.current = true;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(bob, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(bob, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => { live.current = false; loop.stop(); };
  }, [bob]);

  const addFloat = useCallback((uid: number, text: string, color: string, big?: boolean) => {
    setFloats(fs => [...fs.slice(-14), { id: ++floatId.current, uid, text, color, big }]);
  }, []);
  const dropFloat = useCallback((id: number) => setFloats(fs => fs.filter(f => f.id !== id)), []);

  const patch = (uid: number, fn: (v: UV) => UV) => setView(vs => vs.map((v, i) => (i === uid ? fn(v) : v)));

  const play = useCallback(async (events: Ev[]) => {
    const b = bRef.current!;
    for (const e of events) {
      if (!live.current) return;
      switch (e.t) {
        case 'move': {
          const u = b.units[e.u];
          setBanner({ text: `${u.name}: ${e.name}`, color: ELEMENTS[e.el].base });
          const a = anim(e.u).lunge;
          Animated.sequence([
            Animated.timing(a, { toValue: u.side === 0 ? 22 : -22, duration: 110 * T(), useNativeDriver: true }),
            Animated.timing(a, { toValue: 0, duration: 160 * T(), useNativeDriver: true }),
          ]).start();
          await sleep(330 * T());
          break;
        }
        case 'dmg': {
          patch(e.u, v => ({ ...v, hp: Math.max(0, v.hp - (e.n - e.shield)), shield: Math.max(0, v.shield - e.shield) }));
          addFloat(e.u, `-${e.n}${e.mult > 1 ? '!' : ''}`, e.mult > 1 ? '#ffd34d' : e.mult < 1 ? '#b9b3cc' : '#ff7b7b', e.mult > 1);
          if (e.mult > 1) addFloat(e.u, e.mult >= 4 ? 'Devastating' : 'Hits hard', '#ffd34d');
          else if (e.mult < 1) addFloat(e.u, 'Hits weakly', '#b9b3cc');
          const a = anim(e.u).hit;
          Animated.sequence([
            Animated.timing(a, { toValue: 6, duration: 45, useNativeDriver: true }), Animated.timing(a, { toValue: -5, duration: 45, useNativeDriver: true }),
            Animated.timing(a, { toValue: 0, duration: 45, useNativeDriver: true }),
          ]).start();
          await sleep(190 * T());
          break;
        }
        case 'miss': addFloat(e.u, 'Dodged', '#9fe8ff'); await sleep(160 * T()); break;
        case 'heal': if (e.n > 0) { patch(e.u, v => ({ ...v, hp: v.hp + e.n })); addFloat(e.u, `+${e.n}`, C.good); await sleep(150 * T()); } break;
        case 'shield': if (e.n > 0) { patch(e.u, v => ({ ...v, shield: v.shield + e.n })); addFloat(e.u, 'Shield', '#9fe8ff'); await sleep(120 * T()); } break;
        case 'status':
          patch(e.u, v => (v.statuses.includes(e.k) ? v : { ...v, statuses: [...v.statuses, e.k] }));
          addFloat(e.u, STATUS_WORD[e.k], isBuff(e.k) ? '#9fe8a0' : '#f3a5ff');
          await sleep(90 * T());
          break;
        case 'skip': addFloat(e.u, e.k === 'freeze' ? 'Frozen' : 'Stunned', '#f3a5ff', true); await sleep(380 * T()); break;
        case 'faint': patch(e.u, v => ({ ...v, alive: false, hp: 0, shield: 0, statuses: [] })); await sleep(260 * T()); break;
        case 'revive': patch(e.u, v => ({ ...v, alive: true, hp: e.n })); addFloat(e.u, 'Revived!', C.good, true); await sleep(300 * T()); break;
        case 'text': addFloat(e.u, e.s, '#e7e0ff'); await sleep(140 * T()); break;
        case 'tick': break;
      }
    }
    if (live.current) { setView(snap(b)); setOrder(turnOrder(b, 8)); }
  }, [addFloat]);

  const finish = useCallback(() => {
    const b = bRef.current!;
    if (b.over == null) b.over = 0; // raid: time ran out
    const res = mutate(s => finishFight(rng, s, run, b, Date.now()));
    setBanner(null); setActor(null); setSel(null);
    setResult(res);
  }, [mutate, run]);

  const step = useCallback(async () => {
    const b = bRef.current!;
    for (;;) {
      if (!live.current) return;
      if (b.over != null || (run.actionLimit > 0 && b.actions[0] >= run.actionLimit)) { await sleep(350); if (live.current) finish(); return; }
      const { actor: uid, events } = nextActor(b);
      await play(events);
      if (uid == null) continue;
      const u = b.units[uid];
      if (u.side === 0 && !autoRef.current) { setBanner(null); setActor(uid); setSel(null); return; }
      await sleep((u.side === 0 ? 120 : 260) * T());
      const c = aiChoose(b, uid);
      await play(act(b, uid, c.move, c.target));
    }
  }, [finish, play, run]);

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

  // Auto switched on while it's the player's turn: let the AI take it.
  useEffect(() => {
    if (save.auto && actor != null && bRef.current && !busy.current) {
      const c = aiChoose(bRef.current, actor);
      const mv = bRef.current.units[actor].moves.find(m => m.id === c.move);
      if (mv) fire(mv, c.target);
    }
  }, [save.auto, actor, fire]);

  const begin = useCallback(() => {
    const b = mutate(s => startBattle(rng, s, run));
    bRef.current = b;
    anims.current = {};
    setView(snap(b)); setOrder(turnOrder(b, 8)); setResult(null); setFloats([]);
    setMode('fight');
    setFightNo(n => n + 1);
    setTimeout(() => { if (live.current) step(); }, 500);
  }, [mutate, run, step]);

  // Walk into the chamber, then the fight starts.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    bRef.current = mutate(s => startBattle(rng, s, run));
    setView(snap(bRef.current));
    const id = setInterval(() => setTick(t => t + 1), 90);
    setTimeout(() => { clearInterval(id); if (live.current) begin(); }, 1300);
  }, [begin, mutate, run]);

  const nextFight = () => {
    setResult(null);
    setMode('walk');
    bRef.current = mutate(s => startBattle(rng, s, run));
    setView(snap(bRef.current));
    const id = setInterval(() => setTick(t => t + 1), 90);
    setTimeout(() => { clearInterval(id); if (live.current) begin(); }, 1300);
  };

  const b = bRef.current;
  const fight = run.fights[Math.min(run.idx, run.fights.length - 1)];
  const biggest = b ? Math.max(b.units.filter(u => u.side === 0).length, b.units.filter(u => u.side === 1).length) : 5;
  const size = Math.min(W * 0.21, fieldH * 0.25) * (biggest <= 2 ? 1.35 : biggest === 3 ? 1.15 : 1);
  const targets = useMemo(() => (b && actor != null && sel ? validTargets(b, b.units[actor], sel) : []), [b, actor, sel, view]);

  const place = (u: Unit) => {
    const bossFight = b!.units.some(x => x.side === 1 && x.boss);
    const slots = u.side === 1 && bossFight ? BOSS_SLOTS : SLOTS;
    const [cx, fy] = slots[u.slot % 5];
    const sz = size * (u.boss ? 1.55 : u.stage === 0 ? 0.82 : 1);
    const x = (u.side === 0 ? cx : 1 - cx) * W;
    const feet = fieldH * (0.2 + fy * 0.76);
    return { left: x - sz / 2, top: feet - sz, sz, feet, x };
  };

  const onTapUnit = (uid: number) => {
    if (actor == null || !sel || !b) return;
    if (targets.includes(uid)) fire(sel, uid);
  };

  const units = b ? [...b.units].sort((x, y) => place(x).feet - place(y).feet) : [];
  const me = b && actor != null ? b.units[actor] : null;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Header */}
      <View style={[st.row, { paddingHorizontal: 12, paddingVertical: 6, justifyContent: 'space-between' }]}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.text, fontWeight: '800', fontSize: 15 }} numberOfLines={1}>{run.title}</Text>
          <Text style={{ color: C.dim, fontSize: 11 }}>
            {run.kind === 'tower' ? `Floor ${run.floor}` : run.kind === 'raid' && b ? `Actions left: ${Math.max(0, run.actionLimit - b.actions[0])}` : run.fights.length > 1 ? `Fight ${run.idx + 1} of ${run.fights.length}` : ''}
            {fight?.boss ? '  ·  Boss' : ''}
          </Text>
        </View>
        <Btn small kind={save.auto ? 'main' : 'ghost'} label={save.auto ? 'Auto on' : 'Auto'} onPress={() => mutate(s => { s.auto = !s.auto; })} />
        <Btn small kind={save.fast ? 'main' : 'ghost'} label={save.fast ? '2x' : '1x'} onPress={() => mutate(s => { s.fast = !s.fast; })} />
        <Btn small kind="ghost" label="Flee" onPress={onExit} />
      </View>

      {/* Turn order */}
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

      {/* Field */}
      <View style={{ width: W, height: fieldH, overflow: 'hidden' }}>
        <Svg width={W} height={fieldH} style={{ position: 'absolute' }}>
          <Defs>
            <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={run.sky[0]} /><Stop offset="1" stopColor={run.sky[1]} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={W} height={fieldH} fill="url(#sky)" />
          <Ellipse cx={W * 0.25} cy={fieldH * 0.24} rx={W * 0.4} ry={fieldH * 0.09} fill={run.ground} opacity={0.5} />
          <Ellipse cx={W * 0.8} cy={fieldH * 0.24} rx={W * 0.35} ry={fieldH * 0.07} fill={run.ground} opacity={0.5} />
          <Rect x={0} y={fieldH * 0.22} width={W} height={fieldH * 0.78} fill={run.ground} />
          {[0, 1, 2, 3, 4, 5].map(i => {
            const span = W + 80;
            const x = (((i * 131 - (mode === 'walk' ? tick * 16 : 0)) % span) + span) % span - 40;
            return <Ellipse key={i} cx={x} cy={fieldH * (0.34 + ((i * 37) % 60) / 100)} rx={26 + (i % 3) * 10} ry={5} fill="#000" opacity={0.08} />;
          })}
        </Svg>

        {b && units.map(u => {
          const v = view[u.uid];
          if (!v) return null;
          if (mode === 'walk' && u.side === 1) return null;
          const pos = place(u);
          const a = anim(u.uid);
          const canPick = targets.includes(u.uid);
          const isActor = actor === u.uid;
          const walking = mode === 'walk' && v.alive;
          return (
            <Animated.View key={u.uid} style={{
              position: 'absolute', left: pos.left, top: pos.top, width: pos.sz,
              transform: [{ translateX: Animated.add(a.lunge, a.hit) }, { translateY: v.alive && !walking ? bob.interpolate({ inputRange: [0, 1], outputRange: u.uid % 2 ? [0, -3] : [-3, 0] }) : 0 }],
            }}>
              <Pressable onPress={() => onTapUnit(u.uid)}>
                {(canPick || isActor) ? <View pointerEvents="none" style={{ position: 'absolute', left: pos.sz * 0.1, right: pos.sz * 0.1, bottom: -2, height: pos.sz * 0.28, borderRadius: pos.sz, borderWidth: 2.5, borderColor: isActor ? C.gold : sel && (sel.target === 'ally' || sel.target === 'allies' || sel.target === 'self' || sel.target === 'fallen' || sel.target === 'allFallen') ? C.good : C.bad, backgroundColor: isActor ? 'rgba(245,197,66,0.18)' : 'rgba(255,255,255,0.12)' }} /> : null}
                <UnitSprite u={u} v={v} size={pos.sz} phase={walking ? (tick % 8) / 8 : 0} walking={walking} />
                {v.alive && mode === 'fight' ? (
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
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{fightNo === 0 ? 'Entering...' : 'On to the next chamber...'}</Text>
          </View>
        ) : null}
      </View>

      {/* Moves */}
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
                  <Pressable key={mv.id} disabled={!ok} onPress={() => setSel(mv)} style={{ width: (W - 26) / 2, backgroundColor: on ? C.panel2 : C.panel, borderRadius: 10, borderWidth: on ? 2 : 1, borderColor: on ? C.gold : C.line, borderLeftWidth: 6, borderLeftColor: e.base, padding: 7, opacity: ok ? 1 : 0.45 }}>
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

      {/* Result */}
      {result ? (
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: '#000a', justifyContent: 'center', padding: 16 }}>
          <View style={[st.card, { maxHeight: winH * 0.8 }]}>
            <Text style={{ color: result.won ? C.gold : C.bad, fontSize: 22, fontWeight: '900', textAlign: 'center' }}>
              {run.kind === 'raid' ? 'Raid attempt over' : result.won ? (result.cleared && run.kind === 'area' ? 'Area cleared!' : 'Victory') : 'Defeated'}
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
              {result.chest ? <LootView title={run.kind === 'raid' ? 'Raid rewards' : 'Boss chest'} loot={result.chest} /> : null}
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              {!result.runOver ? <Btn style={{ flex: 1 }} kind="ghost" label="Leave" onPress={onExit} /> : null}
              {!result.runOver
                ? <Btn style={{ flex: 2 }} kind="gold" label={run.kind === 'tower' ? `Floor ${run.floor}` : run.fights[run.idx]?.boss ? 'Face the boss' : 'Next fight'} onPress={nextFight} />
                : <Btn style={{ flex: 1 }} kind="gold" label="Done" onPress={onExit} />}
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}
