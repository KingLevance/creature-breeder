// The campaign map: each area is an illustrated banner with its sky, hills and boss, and opens to show its loot.
import React, { useMemo, useState } from 'react';
import { ScrollView, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { AREAS, AreaDef } from '../game/data/areas';
import { ELEMENTS } from '../game/data/elements';
import { express } from '../game/genome';
import { Run, areaOpen, bossPreview, lootTable, startAreaRun, startTutorialFight } from '../game/run';
import { TUT } from '../game/save';
import { Breathing, Btn, C, Card, CreatureView, ElChip, H, P, mixHex, st } from './kit';
import { F, FadeIn, Grad, Icon } from './look';
import { TeamPicker } from './Roster';
import { rng, useGame } from './store';

/** The area's landscape: its sky, a low sun, two lines of hills, and a sprinkle of its elements' colours. */
function Landscape({ a, id }: { a: AreaDef; id: string }) {
  const far = mixHex(a.ground, a.sky[1], 0.45);
  return (
    <Svg width="100%" height="100%" viewBox="0 0 300 100" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute' }}>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={a.sky[0]} /><Stop offset="1" stopColor={a.sky[1]} /></LinearGradient>
      </Defs>
      <Rect width="300" height="100" fill={`url(#${id})`} />
      <Circle cx="70" cy="34" r="22" fill="#ffffff" opacity={0.22} />
      <Circle cx="70" cy="34" r="12" fill="#ffffff" opacity={0.35} />
      <Path d="M0 64 Q40 44 90 58 T180 52 T300 56 V100 H0Z" fill={far} />
      <Path d="M0 78 Q60 62 120 74 T230 68 T300 72 V100 H0Z" fill={a.ground} />
      {a.els.slice(0, 4).map((e, i) => <Circle key={e} cx={30 + i * 52} cy={86 - (i % 2) * 6} r={2.2} fill={ELEMENTS[e].light} opacity={0.9} />)}
    </Svg>
  );
}

function AreaBanner({ a, locked, clears, num }: { a: AreaDef; locked: boolean; clears: number; num: number }) {
  const { width: W } = useWindowDimensions();
  const boss = useMemo(() => express(bossPreview(a)), [a]);
  const H = 104;
  return (
    <View style={{ height: H, overflow: 'hidden' }}>
      <Landscape a={a} id={`sky${a.id}`} />
      <View style={{ position: 'absolute', right: 6, bottom: -6, opacity: locked ? 0.9 : 1, transform: [{ scaleX: -1 }] }}>
        <Breathing size={H * 1.05}><CreatureView ph={boss} stage={3} size={H * 1.05} shadow={false} /></Breathing>
      </View>
      {locked ? <View style={{ position: 'absolute', right: 6, bottom: -6, width: H * 1.05, height: H * 1.05, backgroundColor: 'rgba(15,10,30,0.82)', borderRadius: H }} /> : null}
      <Grad colors={['rgba(10,6,22,0)', 'rgba(10,6,22,0.75)']} style={{ top: H * 0.45 }} />
      <View style={{ position: 'absolute', left: 10, top: 9, width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: locked ? '#3a3256' : '#f6b52e', borderWidth: 2, borderColor: locked ? '#5a5080' : '#ffe58a' }}>
        {locked ? <Icon name="lock" size={15} color="#a99fc9" accent="#3a3256" /> : <Text style={{ fontFamily: F.bold, fontSize: 15, color: '#3d2400' }}>{num}</Text>}
      </View>
      <View style={{ position: 'absolute', left: 48, top: 12, backgroundColor: 'rgba(10,6,22,0.55)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
        <Text style={{ color: '#ffe58a', fontFamily: F.semi, fontSize: 12 }}>Lv {a.lo}-{a.hi}</Text>
      </View>
      {clears ? (
        <View style={{ position: 'absolute', left: 48 + 62, top: 12, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(30,110,60,0.85)', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 }}>
          <Icon name="check" size={11} color="#ffffff" />
          <Text style={{ color: '#fff', fontFamily: F.semi, fontSize: 12 }}>x{clears}</Text>
        </View>
      ) : null}
      <Text numberOfLines={1} style={{ position: 'absolute', left: 12, bottom: 8, right: W * 0.3, color: '#fff', fontFamily: F.bold, fontSize: 22, textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 4 }}>{a.name}</Text>
    </View>
  );
}

function LootLine({ icon, color, children }: { icon: 'sword' | 'chest' | 'egg'; color: string; children: React.ReactNode }) {
  return (
    <View style={[st.row, { alignItems: 'flex-start', marginTop: 5 }]}>
      <Icon name={icon} size={18} color={color} accent="#2b2054" />
      <P style={{ flex: 1, color: icon === 'egg' ? C.gold : C.text }}>{children}</P>
    </View>
  );
}

export function AdventureScreen({ onRun }: { onRun: (r: Run) => void }) {
  const { save, mutate } = useGame();
  const [pick, setPick] = useState<AreaDef | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const tut = save.tutorial;
  let shown = 0;
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 14, paddingTop: 4 }}>
        <H>Campaign</H>
        {tut === TUT.FIGHT ? (
          <FadeIn>
            <Card glow={C.gold} tint="#f5c542">
              <H>Your first fight</H>
              <P>A wild Nibbler is blocking the path. Tap a move, then tap the enemy.</P>
              <Btn style={{ marginTop: 10 }} kind="gold" label="Fight!" icon={<Icon name="sword" size={18} color="#3d2400" />} onPress={() => onRun(mutate(s => startTutorialFight(rng, s)))} />
            </Card>
          </FadeIn>
        ) : null}
        {AREAS.map(a => {
          const isOpen = areaOpen(save, a.id) && tut >= TUT.RUN;
          const clears = save.clears[String(a.id)] ?? 0;
          const expanded = open === a.id;
          const lt = lootTable(save, a);
          if (!isOpen && a.id > save.cleared + 1) return null;
          const highlight = tut === TUT.RUN && a.id === 0;
          return (
            <FadeIn key={a.id} delay={Math.min(8, shown++) * 60}>
              <Card style={{ padding: 0 }} glow={highlight ? C.gold : expanded ? '#8f7cff' : undefined} onPress={() => isOpen && setOpen(expanded ? null : a.id)}>
                <AreaBanner a={a} locked={!isOpen} clears={clears} num={a.id + 1} />
                <View style={{ padding: 12, paddingTop: 10 }}>
                  <P dim>{isOpen ? a.blurb : 'Clear the area before this one to unlock it.'}</P>
                  <View style={{ flexDirection: 'row', gap: 4, marginTop: 7, flexWrap: 'wrap' }}>
                    {a.els.slice(0, 6).map(e => <ElChip key={e} el={e} small />)}
                    {a.els.length > 6 ? <P dim>and more</P> : null}
                  </View>
                  {expanded && isOpen ? (
                    <FadeIn dy={8}>
                      <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', paddingTop: 8 }}>
                        <LootLine icon="sword" color="#cfc6f0">{a.team.length} fights, then the boss <Text style={{ fontFamily: F.semi }}>{a.boss.name}</Text></LootLine>
                        <LootLine icon="chest" color="#e8b35c">Fights: {lt.fights}</LootLine>
                        <LootLine icon="chest" color="#ffd34d">Boss chest: {lt.chest}</LootLine>
                        <LootLine icon="egg" color={C.gold}>{lt.egg}</LootLine>
                        <Btn style={{ marginTop: 12 }} kind="gold" label="Choose team" onPress={() => setPick(a)} />
                      </View>
                    </FadeIn>
                  ) : null}
                </View>
              </Card>
            </FadeIn>
          );
        })}
        {tut < TUT.RUN ? <P dim>Areas open once your first egg has hatched.</P> : null}
      </ScrollView>
      {pick ? (
        <TeamPicker
          title={pick.name}
          note={`Enemies are level ${pick.lo}-${pick.hi}.`}
          onClose={() => setPick(null)}
          onStart={team => { const a = pick; setPick(null); onRun(mutate(s => startAreaRun(rng, s, a.id, team))); }}
        />
      ) : null}
    </View>
  );
}
