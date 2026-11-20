// App shell: starter pick, the five tabs, the tutorial banner, and the fight screen over everything.
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { preloadSfx, setAudioPrefs, setMusic } from './audio';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { STARTERS, pickStarter } from '../game/economy';
import { express, starRating } from '../game/genome';
import { Run } from '../game/run';
import { TUT } from '../game/save';
import { AdventureScreen } from './Adventure';
import { BattleScreen } from './Battle';
import { Btn, C, Card, CreatureView, H, P, Stars, TypeChips, st } from './kit';
import { MoreScreen } from './More';
import { BreedScreen, NurseryScreen } from './Nursery';
import { RosterScreen } from './Roster';
import { GameProvider, rng, useGame } from './store';
import { UpdateGate } from './updates';

type Tab = 'run' | 'roster' | 'nursery' | 'breed' | 'more';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'run', label: 'Campaign', icon: '⚔' },
  { id: 'roster', label: 'Creatures', icon: '❖' },
  { id: 'nursery', label: 'Nursery', icon: '◉' },
  { id: 'breed', label: 'Breed', icon: '♥' },
  { id: 'more', label: 'More', icon: '☰' },
];

const TUTORIAL: Record<number, { text: string; tab: Tab }> = {
  [TUT.FIGHT]: { text: 'Start with your first fight on the Campaign tab.', tab: 'run' },
  [TUT.INCUBATE]: { text: 'You found an egg and an incubator. Go to the Nursery, place the egg, and hatch it.', tab: 'nursery' },
  [TUT.RUN]: { text: 'Take both creatures through Mosswake Meadow on the Campaign tab. They level up by fighting.', tab: 'run' },
  [TUT.BREED]: { text: 'Both are adults now. Go to Breed, pick the two of them, and make an egg.', tab: 'breed' },
  [TUT.HATCH2]: { text: 'Hatch your new egg in the Nursery to see what the pair made.', tab: 'nursery' },
};

function StarterPick() {
  const { mutate } = useGame();
  const { width: W } = useWindowDimensions();
  const [sel, setSel] = useState(0);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 24 }}>
      <Text style={{ color: C.text, fontSize: 28, fontWeight: '900', textAlign: 'center' }}>Hatchlore</Text>
      <P dim style={{ textAlign: 'center', marginBottom: 14 }}>Hatch, raise and breed creatures. Every egg is a surprise. Pick your first.</P>
      {STARTERS.map((s, i) => {
        const ph = express(s.g);
        return (
          <Card key={s.name} onPress={() => setSel(i)} style={{ borderColor: sel === i ? C.gold : C.line, borderWidth: sel === i ? 2 : 1 }}>
            <View style={st.row}>
              <CreatureView ph={ph} stage={0} size={W * 0.26} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.text, fontSize: 18, fontWeight: '800' }}>{s.name}</Text>
                <TypeChips ph={ph} />
                <P style={{ marginTop: 4 }}>{s.blurb}</P>
                <Stars n={starRating(s.g)} />
              </View>
            </View>
          </Card>
        );
      })}
      <P dim style={{ textAlign: 'center', marginBottom: 10 }}>Starters are humble on purpose. Their children can be much better.</P>
      <Btn kind="gold" label={`Choose ${STARTERS[sel].name}`} onPress={() => mutate(s => { pickStarter(rng, s, sel); })} />
    </ScrollView>
  );
}

function Shell() {
  const { save } = useGame();
  const [tab, setTab] = useState<Tab>('run');
  const [run, setRun] = useState<Run | null>(null);
  const [runKey, setRunKey] = useState(0);
  const start = (r: Run) => { setRunKey(k => k + 1); setRun(r); };
  useEffect(() => { setAudioPrefs(save.sound, save.music); }, [save.sound, save.music]);
  useEffect(() => { if (!run) setMusic('hub'); }, [run]);
  useEffect(() => { const t = setTimeout(preloadSfx, 1500); return () => clearTimeout(t); }, []);

  if (save.tutorial === TUT.PICK) return <StarterPick />;
  if (run) return <BattleScreen key={runKey} run={run} onExit={() => setRun(null)} />;

  const tip = TUTORIAL[save.tutorial];
  const ready = save.incubators.some(i => i.egg && i.readyAt <= Date.now());
  return (
    <View style={{ flex: 1 }}>
      <View style={[st.row, { paddingHorizontal: 14, paddingVertical: 8, justifyContent: 'space-between' }]}>
        <Text style={{ color: C.text, fontSize: 18, fontWeight: '900' }}>Hatchlore</Text>
        <View style={[st.row, { gap: 12 }]}>
          <Text style={{ color: C.gold, fontWeight: '800' }}>● {save.gold}</Text>
          <Text style={{ color: '#b9a6ff', fontWeight: '800' }}>✦ {save.essence}</Text>
        </View>
      </View>
      {tip ? (
        <Pressable onPress={() => setTab(tip.tab)} style={{ marginHorizontal: 14, marginBottom: 6, backgroundColor: '#3b2f10', borderColor: C.gold, borderWidth: 1, borderRadius: 12, padding: 10 }}>
          <Text style={{ color: C.gold, fontSize: 11, fontWeight: '800' }}>NEXT STEP</Text>
          <Text style={{ color: C.text, fontSize: 13 }}>{tip.text}</Text>
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }}>
        {tab === 'run' ? <AdventureScreen onRun={start} /> : tab === 'roster' ? <RosterScreen /> : tab === 'nursery' ? <NurseryScreen /> : tab === 'breed' ? <BreedScreen /> : <MoreScreen onRun={start} />}
      </View>
      <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.panel }}>
        {TABS.map(t => {
          const on = tab === t.id;
          const dot = (t.id === 'nursery' && (ready || save.eggs.length > 0)) || (tip?.tab === t.id && !on);
          return (
            <Pressable key={t.id} onPress={() => setTab(t.id)} style={{ flex: 1, alignItems: 'center', paddingVertical: 8 }}>
              <Text style={{ fontSize: 18, color: on ? C.gold : C.dim }}>{t.icon}</Text>
              <Text style={{ fontSize: 10, fontWeight: '700', color: on ? C.gold : C.dim }}>{t.label}</Text>
              {dot ? <View style={{ position: 'absolute', top: 6, right: '28%', width: 8, height: 8, borderRadius: 4, backgroundColor: C.accent2 }} /> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
        <UpdateGate>
          <GameProvider fallback={<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><H>Hatchlore</H></View>}>
            <Shell />
          </GameProvider>
        </UpdateGate>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
