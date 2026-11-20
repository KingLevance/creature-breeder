// Rivals, the weekly raid, the endless tower, the essence shop and settings.
import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { ELEMENTS } from '../game/data/elements';
import { SHOP, buy } from '../game/economy';
import { RAID_ACTIONS, RAID_TRIES, Run, raidState, rivalName, startArenaRun, startRaidRun, startTowerRun } from '../game/run';
import { TUT } from '../game/save';
import { Bar, Btn, C, Card, ElChip, H, P, st } from './kit';
import { TeamPicker } from './Roster';
import { rng, useGame } from './store';
import { versionLabel } from './updates';

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
          <H>Rivals</H>
          <P dim>Fight another breeder's team of the same size as yours. These rivals are computer-run for now: real player-versus-player needs an online server, which this build doesn't have yet.</P>
          <View style={[st.row, { justifyContent: 'space-between', marginTop: 6 }]}>
            <Text style={{ color: C.gold, fontWeight: '800' }}>Rating {save.arena.rating}</Text>
            <P dim>{save.arena.wins} wins · {save.arena.losses} losses</P>
          </View>
          <Btn style={{ marginTop: 8 }} label={`Challenge ${rivalName(save)}`} disabled={locked} onPress={() => setPick('arena')} />
        </Card>

        <Card style={{ opacity: locked ? 0.5 : 1 }}>
          <H>Raid: {raid.boss.name}</H>
          <View style={{ flexDirection: 'row', gap: 4, marginBottom: 4 }}><ElChip el={raid.boss.el} small /><ElChip el={raid.boss.el2} small /></View>
          <P dim>A boss too big to beat in one go. You get {RAID_ACTIONS} actions per attempt and {RAID_TRIES} attempts a day; damage adds up over the week. Local for now, so only your own damage counts.</P>
          <View style={{ marginTop: 6 }}>
            <Bar frac={nextTier ? save.raid.dmg / nextTier : 1} color={ELEMENTS[raid.boss.el].base} height={8} />
            <P dim>{save.raid.dmg.toLocaleString()} damage this week{nextTier ? ` · next reward at ${nextTier.toLocaleString()}` : ' · all rewards claimed'}</P>
          </View>
          <Btn style={{ marginTop: 8 }} label={raid.triesLeft > 0 ? `Attack (${raid.triesLeft} left today)` : 'No attempts left today'} disabled={locked || raid.triesLeft <= 0} onPress={() => setPick('raid')} />
        </Card>

        <Card style={{ opacity: locked ? 0.5 : 1 }}>
          <H>Endless Tower</H>
          <P dim>Floor after floor with rewards on each, and a warden with a chest every fifth floor. Leave with what you've earned at any time, or climb until your team falls.</P>
          <P style={{ marginTop: 4 }}>Best floor: {save.tower.best}</P>
          <Btn style={{ marginTop: 8 }} label="Climb" disabled={locked} onPress={() => setPick('tower')} />
        </Card>

        <H>Essence shop</H>
        <P dim style={{ marginBottom: 6 }}>Releasing a creature gives essence. You have {save.essence}.</P>
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

        <H>Bag</H>
        <Card>
          <P>Gold {save.gold} · Essence {save.essence}</P>
          <P>Dust {save.dust} · Shards {save.shard} · Cores {save.core} · Scan lenses {save.scans}</P>
          <P dim style={{ marginTop: 4 }}>Hatched {save.counts.hatched} · Bred {save.counts.bred} · Fights {save.counts.fights}</P>
        </Card>

        <H>Settings</H>
        <Card>
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
