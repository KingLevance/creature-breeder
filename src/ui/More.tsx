// Rivals, the weekly raid, the endless tower, the essence shop and settings.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, Text, View } from 'react-native';
import { ELEMENTS } from '../game/data/elements';
import { SHOP, buy } from '../game/economy';
import { RAID_ACTIONS, RAID_TRIES, Run, raidState, rivalName, startArenaRun, startRaidRun, startTowerRun } from '../game/run';
import { TUT } from '../game/save';
import { Bar, Btn, C, Card, ElChip, H, P, Title, st } from './kit';
import { F, FadeIn, Icon, IconName, ND, haptic } from './look';
import { TeamPicker } from './Roster';
import { rng, useGame } from './store';
import { versionLabel } from './updates';

/** A setting with a switch: the label says what it is, the switch says whether it is on. */
function Toggle({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const t = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => { Animated.spring(t, { toValue: on ? 1 : 0, friction: 7, tension: 140, useNativeDriver: ND }).start(); }, [on, t]);
  return (
    <Pressable onPress={() => { haptic('select'); onPress(); }} style={[st.row, { justifyContent: 'space-between', paddingVertical: 7 }]}>
      <Text style={{ color: C.text, fontFamily: F.semi, fontSize: 16 }}>{label}</Text>
      <View style={[st.row, { gap: 8 }]}>
        <Text style={{ color: on ? C.good : C.dim, fontFamily: F.med, fontSize: 13 }}>{on ? 'On' : 'Off'}</Text>
        <View style={{ width: 50, height: 28, borderRadius: 14, backgroundColor: on ? '#3fae62' : 'rgba(10,6,22,0.55)', borderWidth: 1.5, borderColor: on ? '#7de39c' : 'rgba(255,255,255,0.14)', justifyContent: 'center' }}>
          <Animated.View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#ffffff', marginLeft: 3, transform: [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, 21] }) }] }} />
        </View>
      </View>
    </Pressable>
  );
}

export function MoreScreen({ onRun }: { onRun: (r: Run) => void }) {
  const { save, mutate, reset } = useGame();
  const [pick, setPick] = useState<'arena' | 'raid' | 'tower' | null>(null);
  const [wipe, setWipe] = useState(false);
  const locked = save.tutorial < TUT.DONE;
  const raid = raidState(save, Date.now());
  const nextTier = raid.tiers[save.raid.claimed];
  const start = (team: string[]) => {
    const kind = pick;
    setPick(null);
    const run = mutate(s => (kind === 'arena' ? startArenaRun(rng, s, team) : kind === 'tower' ? startTowerRun(rng, s, team) : startRaidRun(rng, s, team, Date.now())));
    if (run) onRun(run);
  };
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 14 }}>
        {locked ? <P dim style={{ marginBottom: 8 }}>These open once you finish the tutorial.</P> : null}

        <Card style={{ opacity: locked ? 0.5 : 1 }}>
          <Title icon="crown" color="#f6b52e">Rivals</Title>
          <P dim>Fight a rival's team the same size as yours. Win to climb the ratings. Rivals are computer-run.</P>
          <View style={[st.row, { justifyContent: 'space-between', marginTop: 6 }]}>
            <Text style={{ color: C.gold, fontWeight: '800' }}>Rating {save.arena.rating}</Text>
            <P dim>{save.arena.wins} wins · {save.arena.losses} losses</P>
          </View>
          <Btn style={{ marginTop: 8 }} label={`Challenge ${rivalName(save)}`} disabled={locked} onPress={() => setPick('arena')} />
        </Card>

        <Card style={{ opacity: locked ? 0.5 : 1 }}>
          <Title icon="skull" color="#b06cff">Raid: {raid.boss.name}</Title>
          <View style={{ flexDirection: 'row', gap: 4, marginBottom: 4 }}><ElChip el={raid.boss.el} small /><ElChip el={raid.boss.el2} small /></View>
          <P dim>A boss too big to beat in one go. You get {RAID_ACTIONS} actions per attempt and {RAID_TRIES} attempts a day; your damage adds up over the week.</P>
          <View style={{ marginTop: 6 }}>
            <Bar frac={nextTier ? save.raid.dmg / nextTier : 1} color={ELEMENTS[raid.boss.el].base} height={8} />
            <P dim>{save.raid.dmg.toLocaleString()} damage this week{nextTier ? ` · next reward at ${nextTier.toLocaleString()}` : ' · all rewards claimed'}</P>
          </View>
          <Btn style={{ marginTop: 8 }} label={raid.triesLeft > 0 ? `Attack (${raid.triesLeft} left today)` : 'No attempts left today'} disabled={locked || raid.triesLeft <= 0} onPress={() => setPick('raid')} />
        </Card>

        <Card style={{ opacity: locked ? 0.5 : 1 }}>
          <Title icon="tower" color="#5fb2ff">Endless Tower</Title>
          <P dim>Floor after floor with rewards on each, and a warden with a chest every fifth floor. Leave with what you've earned at any time, or climb until your team falls.</P>
          <P style={{ marginTop: 4 }}>Best floor: {save.tower.best}</P>
          <Btn style={{ marginTop: 8 }} label="Climb" disabled={locked} onPress={() => setPick('tower')} />
        </Card>

        <Title icon="gem" color="#8f6cff">Essence shop</Title>
        <P dim style={{ marginBottom: 6 }}>Releasing creatures and discarding eggs gives essence. Spend it here, or train a creature from its page. You have {save.essence}.</P>
        {SHOP.map(item => (
          <Card key={item.id}>
            <View style={st.row}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.text, fontWeight: '800' }}>{item.name}</Text>
                <P dim>{item.desc}</P>
              </View>
              <Btn small label={`${item.essence} essence`} disabled={save.essence < item.essence} onPress={() => mutate(s => { buy(s, item.id); })} />
            </View>
          </Card>
        ))}

        <Title icon="bag" color="#e8a24f">Bag</Title>
        <Card>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {([
              ['coin', '#ffd34d', save.gold, 'Gold'], ['gem', '#c9b8ff', save.essence, 'Essence'], ['sparkle', '#e8d9b0', save.dust, 'Dust'],
              ['gem', '#9fd8ff', save.shard, 'Shards'], ['bolt', '#7fe8b0', save.core, 'Cores'], ['scan', '#9fe8ff', save.scans, 'Scan lenses'],
            ] as [IconName, string, number, string][]).map(([icon, color, n, name]) => (
              <View key={name} style={{ width: '31%', flexGrow: 1, borderRadius: 12, paddingVertical: 7, paddingHorizontal: 9, backgroundColor: 'rgba(10,6,22,0.38)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
                <View style={[st.row, { gap: 5 }]}>
                  <Icon name={icon} size={16} color={color} />
                  <Text style={{ color: C.text, fontFamily: F.bold, fontSize: 16 }} numberOfLines={1}>{n.toLocaleString('en-US')}</Text>
                </View>
                <Text style={{ color: C.dim, fontFamily: F.med, fontSize: 11.5, marginTop: 1 }} numberOfLines={1}>{name}</Text>
              </View>
            ))}
          </View>
          <P dim style={{ marginTop: 9 }}>Hatched {save.counts.hatched} · Bred {save.counts.bred} · Fights {save.counts.fights}</P>
        </Card>

        <Title icon="compass" color="#7a8bb0">Settings</Title>
        <Card>
          <Toggle label="Sound effects" on={save.sound} onPress={() => mutate(s => { s.sound = !s.sound; })} />
          <Toggle label="Music" on={save.music} onPress={() => mutate(s => { s.music = !s.music; })} />
          <View style={{ height: 6 }} />
          {wipe ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Btn style={{ flex: 1 }} kind="ghost" label="Keep my save" onPress={() => setWipe(false)} />
              <Btn style={{ flex: 1 }} kind="danger" label="Erase everything" onPress={() => { setWipe(false); reset(); }} />
            </View>
          ) : <Btn kind="ghost" label="Start over (erase save)" onPress={() => setWipe(true)} />}
        </Card>
        <P dim style={{ textAlign: 'center', marginBottom: 20 }}>{versionLabel()}</P>
      </ScrollView>
      {pick ? (
        <TeamPicker
          title={pick === 'arena' ? rivalName(save) : pick === 'raid' ? raid.boss.name : 'Endless Tower'}
          note={pick === 'raid' ? `Boss level ${raid.level}. You have ${RAID_ACTIONS} actions.` : pick === 'arena' ? 'The rival brings as many creatures as you do.' : 'Floor 1 starts easy and climbs fast.'}
          startLabel={pick === 'raid' ? 'Attack' : 'Start'}
          onClose={() => setPick(null)}
          onStart={start}
        />
      ) : null}
    </View>
  );
}
