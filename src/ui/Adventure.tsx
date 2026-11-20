// The campaign map: areas with their visible loot tables, plus the tutorial's first fight.
import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { AREAS, AreaDef } from '../game/data/areas';
import { Run, areaOpen, lootTable, startAreaRun, startTutorialFight } from '../game/run';
import { TUT } from '../game/save';
import { Btn, C, Card, ElChip, H, P, st } from './kit';
import { TeamPicker } from './Roster';
import { rng, useGame } from './store';

export function AdventureScreen({ onRun }: { onRun: (r: Run) => void }) {
  const { save, mutate } = useGame();
  const [pick, setPick] = useState<AreaDef | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const tut = save.tutorial;
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 14 }}>
        <H>Campaign</H>
        {tut === TUT.FIGHT ? (
          <Card style={{ borderColor: C.gold }}>
            <H>Your first fight</H>
            <P>A wild Nibbler is blocking the path. Tap a move, then tap the enemy.</P>
            <Btn style={{ marginTop: 8 }} kind="gold" label="Fight" onPress={() => onRun(mutate(s => startTutorialFight(rng, s)))} />
          </Card>
        ) : null}
        {AREAS.map(a => {
          const isOpen = areaOpen(save, a.id) && tut >= TUT.RUN;
          const clears = save.clears[String(a.id)] ?? 0;
          const expanded = open === a.id;
          const lt = lootTable(save, a);
          if (!isOpen && a.id > save.cleared + 1) return null;
          return (
            <Card key={a.id} style={{ opacity: isOpen ? 1 : 0.5, borderColor: tut === TUT.RUN && a.id === 0 ? C.gold : C.line }} onPress={() => isOpen && setOpen(expanded ? null : a.id)}>
              <View style={[st.row, { justifyContent: 'space-between' }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.text, fontSize: 16, fontWeight: '800' }}>{a.id + 1}. {a.name}</Text>
                  <P dim>{isOpen ? a.blurb : 'Clear the area before this one to unlock.'}</P>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: C.gold, fontSize: 12, fontWeight: '700' }}>Lv {a.lo}-{a.hi}</Text>
                  {clears ? <Text style={{ color: C.good, fontSize: 11 }}>Cleared x{clears}</Text> : null}
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                {a.els.slice(0, 6).map(e => <ElChip key={e} el={e} small />)}
                {a.els.length > 6 ? <P dim>and more</P> : null}
              </View>
              {expanded && isOpen ? (
                <View style={{ marginTop: 8 }}>
                  <P>{a.team.length} fights, then the boss: <Text style={{ fontWeight: '800' }}>{a.boss.name}</Text></P>
                  <P dim>Fights: {lt.fights}</P>
                  <P dim>Boss chest: {lt.chest}</P>
                  <P style={{ color: C.gold }}>{lt.egg}</P>
                  <Btn style={{ marginTop: 8 }} kind="gold" label="Choose team" onPress={() => setPick(a)} />
                </View>
              ) : null}
            </Card>
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
