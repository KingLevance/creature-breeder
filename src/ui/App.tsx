// App shell: starter pick, the five tabs, the tutorial banner, and the fight screen over everything.
import { Fredoka_500Medium, Fredoka_600SemiBold, Fredoka_700Bold, useFonts } from '@expo-google-fonts/fredoka';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import { preloadSfx, setAudioPrefs, setMusic, tap } from './audio';
import { Animated, Easing, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { STARTERS, pickStarter } from '../game/economy';
import { express, starRating } from '../game/genome';
import { Run } from '../game/run';
import { TUT } from '../game/save';
import { AdventureScreen } from './Adventure';
import { BattleScreen } from './Battle';
import { Btn, C, Card, CreatureView, H, LiveCreature, P, Stars, TypeChips, st } from './kit';
import { MoreScreen } from './More';
import { BreedScreen, NurseryScreen } from './Nursery';
import { RosterScreen } from './Roster';
import { GameProvider, rng, useGame } from './store';
import { UpdateGate } from './updates';
import { Backdrop, F, FadeIn, Glow, Grad, Icon, ND, haptic, pulse, shadow, useLoop } from './look';

type Tab = 'run' | 'roster' | 'nursery' | 'breed' | 'more';
const TABS: { id: Tab; label: string; icon: 'sword' | 'paw' | 'egg' | 'heart' | 'compass'; tint: string }[] = [
  { id: 'run', label: 'Campaign', icon: 'sword', tint: '#4fc3a1' },
  { id: 'roster', label: 'Creatures', icon: 'paw', tint: '#8f7cff' },
  { id: 'nursery', label: 'Nursery', icon: 'egg', tint: '#ffb35c' },
  { id: 'breed', label: 'Breed', icon: 'heart', tint: '#ff7fae' },
  { id: 'more', label: 'More', icon: 'compass', tint: '#5fb2ff' },
];

/** A number that rolls to its new value, with a little bump. */
function Counter({ value, color }: { value: number; color: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const bump = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = from.current, b = value;
    if (a === b) return;
    from.current = b;
    Animated.sequence([
      Animated.timing(bump, { toValue: 1, duration: 120, useNativeDriver: ND }),
      Animated.spring(bump, { toValue: 0, friction: 4, tension: 160, useNativeDriver: ND }),
    ]).start();
    let i = 0;
    const id = setInterval(() => { i++; setShown(Math.round(a + (b - a) * (1 - Math.pow(1 - i / 14, 3)))); if (i >= 14) clearInterval(id); }, 30);
    return () => clearInterval(id);
  }, [value, bump]);
  return (
    <Animated.Text style={{ color, fontFamily: F.bold, fontSize: 15, transform: [{ scale: bump.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] }) }] }}>
      {shown.toLocaleString()}
    </Animated.Text>
  );
}
function Currency({ icon, value, color }: { icon: 'coin' | 'gem'; value: number; color: string }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(10,6,22,0.55)', borderRadius: 14, paddingLeft: 3, paddingRight: 10, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }]}>
      <Icon name={icon} size={20} />
      <Counter value={value} color={color} />
    </View>
  );
}

/** The floating tab bar: a glowing bubble slides to the chosen tab, and its icon pops. */
function TabBar({ tab, onTab, dots }: { tab: Tab; onTab: (t: Tab) => void; dots: Partial<Record<Tab, boolean>> }) {
  const { width: W } = useWindowDimensions();
  const barW = W - 20, tw = barW / TABS.length;
  const idx = TABS.findIndex(t => t.id === tab);
  const slide = useRef(new Animated.Value(idx)).current;
  const pops = useRef(TABS.map((_, i) => new Animated.Value(i === idx ? 1 : 0))).current;
  const blink = useLoop(1400);
  useEffect(() => {
    Animated.spring(slide, { toValue: idx, friction: 7, tension: 90, useNativeDriver: ND }).start();
    pops.forEach((p, i) => Animated.spring(p, { toValue: i === idx ? 1 : 0, friction: 5, tension: 140, useNativeDriver: ND }).start());
  }, [idx, slide, pops]);
  const cur = TABS[idx];
  return (
    <View style={[{ marginHorizontal: 10, marginBottom: 6, borderRadius: 24, height: 64 }, shadow('#000', 14, 0.5, 6)]}>
      <View style={{ flex: 1, borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
        <Grad colors={['#4e4089', '#382c66']} />
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.18)' }} />
        <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 6, width: tw - 12, height: 52, left: 6, borderRadius: 18, overflow: 'hidden', transform: [{ translateX: slide.interpolate({ inputRange: [0, TABS.length - 1], outputRange: [0, tw * (TABS.length - 1)] }) }] }}>
          <Grad colors={[cur.tint + 'aa', cur.tint + '33']} />
          <Glow color="#ffffff" opacity={0.25} cy="20%" />
        </Animated.View>
        <View style={{ flexDirection: 'row', flex: 1 }}>
          {TABS.map((t, i) => {
            const on = i === idx;
            return (
              <Pressable key={t.id} onPress={() => { if (!on) { tap(); haptic('select'); onTab(t.id); } }} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Animated.View style={{ alignItems: 'center', transform: [{ translateY: pops[i].interpolate({ inputRange: [0, 1], outputRange: [3, -1] }) }, { scale: pops[i].interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.12] }) }] }}>
                  <Icon name={t.icon} size={24} color={on ? '#ffffff' : '#9d93c4'} accent={on ? '#2b2054' : '#2b2054'} />
                </Animated.View>
                <Text style={{ fontSize: 11, fontFamily: F.semi, color: on ? '#ffffff' : '#9d93c4', marginTop: 1 }}>{t.label}</Text>
                {dots[t.id] ? <Animated.View style={{ position: 'absolute', top: 8, right: '24%', width: 10, height: 10, borderRadius: 5, backgroundColor: '#ff7a59', borderWidth: 1.5, borderColor: '#2a2050', transform: [{ scale: pulse(blink, 0.85, 1.2) }] }} /> : null}
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

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
    <View style={{ flex: 1 }}>
    <Backdrop tint="#ffb35c" H={800} />
    <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 24 }}>
      <FadeIn><Text style={{ color: C.gold, fontSize: 40, fontFamily: F.bold, textAlign: 'center', textShadowColor: 'rgba(245,197,66,0.5)', textShadowRadius: 16 }}>Hatchlore</Text></FadeIn>
      <FadeIn delay={80}><P dim style={{ textAlign: 'center', marginBottom: 14 }}>Hatch, raise and breed creatures. Every egg is a surprise. Pick your first.</P></FadeIn>
      {STARTERS.map((s, i) => {
        const ph = express(s.g);
        return (
          <FadeIn key={s.name} delay={140 + i * 80}>
          <Card onPress={() => setSel(i)} glow={sel === i ? C.gold : undefined} tint={sel === i ? '#f5c542' : undefined}>
            <View style={st.row}>
              <LiveCreature ph={ph} stage={0} size={W * 0.26} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.text, fontSize: 21, fontFamily: F.bold }}>{s.name}</Text>
                <TypeChips ph={ph} />
                <P style={{ marginTop: 4 }}>{s.blurb}</P>
                <Stars n={starRating(s.g)} />
              </View>
            </View>
          </Card>
          </FadeIn>
        );
      })}
      <P dim style={{ textAlign: 'center', marginBottom: 10 }}>Starters are humble on purpose. Their children can be much better.</P>
      <Btn kind="gold" label={`Choose ${STARTERS[sel].name}`} onPress={() => mutate(s => { pickStarter(rng, s, sel); })} />
    </ScrollView>
    </View>
  );
}

function Shell() {
  const { save } = useGame();
  const { height: winH } = useWindowDimensions();
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
  const dots: Partial<Record<Tab, boolean>> = {};
  for (const t of TABS) dots[t.id] = (t.id === 'nursery' && (ready || save.eggs.length > 0)) || (tip?.tab === t.id && tab !== t.id);
  const tint = TABS.find(t => t.id === tab)!.tint;
  return (
    <View style={{ flex: 1 }}>
      <Backdrop tint={tint} H={winH} />
      <View style={[st.row, { paddingHorizontal: 14, paddingTop: 6, paddingBottom: 8, justifyContent: 'space-between' }]}>
        <View style={[st.row, { gap: 6 }]}>
          <Icon name="egg" size={24} color="#ffd34d" accent="#b4721a" />
          <Text style={{ color: '#fff', fontSize: 24, fontFamily: F.bold, letterSpacing: 0.3, textShadowColor: 'rgba(143,124,255,0.6)', textShadowRadius: 10 }}>Hatchlore</Text>
        </View>
        <View style={[st.row, { gap: 8 }]}>
          <Currency icon="coin" value={save.gold} color="#ffd34d" />
          <Currency icon="gem" value={save.essence} color="#c9b8ff" />
        </View>
      </View>
      {tip ? (
        <FadeIn key={save.tutorial}>
          <Pressable onPress={() => { haptic('select'); setTab(tip.tab); }} style={[{ marginHorizontal: 14, marginBottom: 8, borderRadius: 16, overflow: 'hidden', borderColor: C.gold, borderWidth: 1.5 }, shadow(C.gold, 10, 0.4, 0)]}>
            <Grad colors={['#5a4413', '#33270b']} />
            <View style={{ padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Icon name="sparkle" size={22} color={C.gold} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.gold, fontSize: 12, fontFamily: F.bold, letterSpacing: 1 }}>NEXT STEP</Text>
                <Text style={{ color: C.text, fontSize: 13 }}>{tip.text}</Text>
              </View>
            </View>
          </Pressable>
        </FadeIn>
      ) : null}
      <FadeIn key={tab} style={{ flex: 1 }} dy={18}>
        {tab === 'run' ? <AdventureScreen onRun={start} /> : tab === 'roster' ? <RosterScreen /> : tab === 'nursery' ? <NurseryScreen /> : tab === 'breed' ? <BreedScreen /> : <MoreScreen onRun={start} />}
      </FadeIn>
      <TabBar tab={tab} onTab={setTab} dots={dots} />
    </View>
  );
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({ Fredoka_500Medium, Fredoka_600SemiBold, Fredoka_700Bold });
  const [waited, setWaited] = useState(false);
  useEffect(() => { const t = setTimeout(() => setWaited(true), 2500); return () => clearTimeout(t); }, []);
  if (!fontsLoaded && !fontError && !waited) return <View style={{ flex: 1, backgroundColor: C.bg }} />;
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
