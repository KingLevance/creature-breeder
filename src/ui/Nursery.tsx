// Incubators, eggs and breeding. Also the hatch reveal: stars first, then the creature.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { Creature, Egg, STAGE_NAMES, stageLevels, stageOf, typeLabel } from '../game/creature';
import { BreedMats, INC_SLOT_COST, INC_UPGRADE, MAT_COST, breedCost, breedProblem, doBreed, forecast, hatchEgg, incubationMs, placeEgg, speedUp, speedUpCost, buyIncubator, upgradeIncubator } from '../game/economy';
import { SKELETON_NAMES, express, starRating } from '../game/genome';
import { TUT } from '../game/save';
import { Bar, Btn, C, Card, CreatureTile, CreatureView, EggView, H, P, SexMark, Stars, TypeChips, st } from './kit';
import { CreatureDetail } from './Roster';
import { fmtTime, rng, useGame, useNow } from './store';

function HatchReveal({ c, onClose }: { c: Creature; onClose: () => void }) {
  const { width: W } = useWindowDimensions();
  const [step, setStep] = useState(0);
  const pop = useRef(new Animated.Value(0)).current;
  const ph = useMemo(() => express(c.g), [c.g]);
  const stars = starRating(c.g);
  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), 900);
    const t2 = setTimeout(() => { setStep(2); Animated.spring(pop, { toValue: 1, friction: 5, useNativeDriver: true }).start(); }, 2000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [pop]);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000d', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        {step < 2 ? (
          <>
            <EggView ph={ph} size={W * 0.5} wobble={step} />
            <Text style={{ color: C.text, fontSize: 18, fontWeight: '800', marginTop: 10 }}>{step === 0 ? 'The egg is cracking...' : ''}</Text>
            {step === 1 ? <Stars n={stars} size={34} /> : null}
          </>
        ) : (
          <>
            <Stars n={stars} size={30} />
            <Animated.View style={{ transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }] }}>
              <CreatureView ph={ph} stage={stageOf(c)} size={W * 0.6} />
            </Animated.View>
            <View style={st.row}>
              <Text style={{ color: C.text, fontSize: 24, fontWeight: '900' }}>{c.name}</Text>
              <SexMark sex={c.sex} />
            </View>
            <View style={{ marginVertical: 6 }}><TypeChips ph={ph} /></View>
            <P dim>{SKELETON_NAMES[ph.skel]} · {c.origin === 'bred' ? 'Bred' : 'Wild-born'}</P>
            {c.mom && c.dad ? <P dim>Child of {c.mom.name} and {c.dad.name}</P> : null}
            <Btn style={{ marginTop: 16, minWidth: 180 }} kind="gold" label="Welcome!" onPress={onClose} />
          </>
        )}
      </View>
    </Modal>
  );
}

function EggCard({ egg, onPress, selected }: { egg: Egg; onPress?: () => void; selected?: boolean }) {
  const ph = useMemo(() => express(egg.g), [egg.g]);
  return (
    <Card onPress={onPress} style={{ width: 96, alignItems: 'center', marginBottom: 0, padding: 6, borderColor: selected ? C.gold : C.line, borderWidth: selected ? 2 : 1 }}>
      <EggView ph={ph} size={60} />
      <Stars n={starRating(egg.g)} size={11} />
      <Text style={{ color: C.dim, fontSize: 10 }}>{egg.origin === 'bred' ? 'Bred' : 'Wild'}{egg.mutations ? ' · mutated' : ''}</Text>
    </Card>
  );
}

export function NurseryScreen() {
  const { save, mutate } = useGame();
  const now = useNow(1000);
  const [selEgg, setSelEgg] = useState<string | null>(null);
  const [born, setBorn] = useState<Creature | null>(null);
  const full = save.creatures.length >= save.rosterCap;
  const nextSlot = INC_SLOT_COST[save.incubators.length];
  const egg = save.eggs.find(e => e.id === selEgg) ?? save.eggs[0];
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 14 }}>
        <H>Incubators</H>
        {save.incubators.length === 0 ? <P dim>You'll get your first incubator after your first fight.</P> : null}
        {save.incubators.map((inc, i) => {
          const up = INC_UPGRADE[inc.tier + 1];
          const left = inc.egg ? inc.readyAt - now : 0;
          const total = inc.egg ? Math.max(1, inc.readyAt - inc.startedAt) : 1;
          const ready = !!inc.egg && left <= 0;
          const cost = inc.egg ? speedUpCost(save, inc, now) : 0;
          return (
            <Card key={i} style={{ borderColor: ready ? C.gold : C.line }}>
              <View style={st.row}>
                <View style={{ width: 70, alignItems: 'center' }}>
                  {inc.egg ? <EggView ph={express(inc.egg.g)} size={66} wobble={ready ? Math.sin(now / 200) : 0} /> : <Text style={{ fontSize: 30, color: C.line }}>◯</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.text, fontWeight: '800' }}>Incubator {i + 1} · Tier {inc.tier}</Text>
                  {inc.egg ? (
                    <>
                      <Stars n={starRating(inc.egg.g)} />
                      {ready ? <P style={{ color: C.gold }}>Ready to hatch!</P> : (
                        <>
                          <Bar frac={1 - left / total} color={C.accent} />
                          <P dim>{fmtTime(left)} left</P>
                        </>
                      )}
                    </>
                  ) : <P dim>{inc.tier > 1 ? 'Better tiers hatch faster and raise hidden potential.' : 'Empty. Pick an egg below.'}</P>}
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                {ready ? <Btn style={{ flex: 1 }} kind="gold" label={full ? 'Roster is full' : 'Hatch'} disabled={full} onPress={() => { const c = mutate(s => hatchEgg(rng, s, i, Date.now())); if (c) setBorn(c); }} /> : null}
                {inc.egg && !ready ? <Btn style={{ flex: 1 }} small kind="ghost" label={`Speed up (${cost} gold)`} disabled={save.gold < cost} onPress={() => mutate(s => { speedUp(s, i, Date.now()); })} /> : null}
                {!inc.egg && egg ? <Btn style={{ width: '100%' }} label="Place selected egg" onPress={() => mutate(s => { placeEgg(s, i, egg.id, Date.now()); })} /> : null}
                {!inc.egg && up ? <Btn small kind="ghost" label={`Upgrade: ${up.gold}g${up.dust ? ` ${up.dust} dust` : ''}${up.shard ? ` ${up.shard} shards` : ''}${up.core ? ` ${up.core} cores` : ''}`} disabled={save.gold < up.gold || save.dust < up.dust || save.shard < up.shard || save.core < up.core} onPress={() => mutate(s => { upgradeIncubator(s, i); })} /> : null}
              </View>
              {inc.egg && !ready && cost > 0 ? <P dim style={{ marginTop: 4 }}>Each speed-up in a day costs more than the last.</P> : null}
            </Card>
          );
        })}
        {save.incubators.length > 0 && nextSlot != null ? <Btn kind="ghost" label={`Buy another incubator (${nextSlot} gold)`} disabled={save.gold < nextSlot} onPress={() => mutate(s => { buyIncubator(s); })} /> : null}

        <View style={{ height: 16 }} />
        <H>Eggs {save.eggs.length}/20</H>
        {save.eggs.length === 0 ? <P dim>No eggs. Enemies sometimes drop them, boss chests often do, and you can breed two adults.</P> : (
          <>
            <P dim style={{ marginBottom: 8 }}>Stars show how good the hatchling's genes are. The colour hints at its element.</P>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {save.eggs.map(e => <EggCard key={e.id} egg={e} selected={egg?.id === e.id} onPress={() => setSelEgg(e.id)} />)}
            </View>
            {egg ? <P dim style={{ marginTop: 8 }}>Selected egg takes {fmtTime(incubationMs(egg, 1))} in a tier 1 incubator{save.tutorial < TUT.DONE ? ' (instant during the tutorial)' : ''}.</P> : null}
          </>
        )}
      </ScrollView>
      {born ? <HatchReveal c={born} onClose={() => setBorn(null)} /> : null}
    </View>
  );
}

const pct = (p: number) => (p > 0 && p < 0.01 ? '<1%' : Math.round(p * 100) + '%');

export function BreedScreen() {
  const { save, mutate } = useGame();
  const { width: W } = useWindowDimensions();
  const now = useNow(1000);
  const [momId, setMom] = useState<string | null>(null);
  const [dadId, setDad] = useState<string | null>(null);
  const [mats, setMats] = useState<BreedMats>({ dust: false, shard: false, core: false });
  const [made, setMade] = useState<Egg | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [picking, setPicking] = useState<'F' | 'M' | null>(null);
  const mom = save.creatures.find(c => c.id === momId);
  const dad = save.creatures.find(c => c.id === dadId);
  const problem = breedProblem(save, mom, dad, now, mats);
  const fc = useMemo(() => (mom && dad ? forecast(rng, mom.g, dad.g, 500) : null), [mom?.id, dad?.id]);
  const tw = (W - 28 - 16) / 3;
  const adults = useMemo(() => [...save.creatures].sort((a, b) => stageOf(b) - stageOf(a) || b.level - a.level), [save.creatures]);
  const choose = (c: Creature) => (c.sex === 'F' ? setMom(c.id) : setDad(c.id));
  const tutorial = save.tutorial < TUT.DONE;
  const Slot = ({ c, label, sex }: { c?: Creature; label: string; sex: 'F' | 'M' }) => (
    <Pressable onPress={() => setPicking(sex)} style={{ flex: 1, alignItems: 'center', backgroundColor: C.panel2, borderRadius: 12, padding: 8, borderWidth: 1, borderColor: c ? C.line : C.gold }}>
      <Text style={{ color: C.dim, fontSize: 11 }}>{label}</Text>
      {c ? (
        <>
          <CreatureView ph={express(c.g)} stage={stageOf(c)} size={84} />
          <Text style={{ color: C.text, fontWeight: '800' }}>{c.name}</Text>
          <Stars n={starRating(c.g)} size={11} />
          <Text style={{ color: C.dim, fontSize: 10 }}>Bred {c.bred} time{c.bred === 1 ? '' : 's'}</Text>
          <Btn small kind="ghost" label="Pedigree" onPress={() => setDetail(c.id)} />
        </>
      ) : <Text style={{ color: C.gold, marginVertical: 30, fontWeight: '700' }}>Tap to choose</Text>}
    </Pressable>
  );
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 14 }}>
        <H>Breeding</H>
        <P dim style={{ marginBottom: 8 }}>Each parent passes one of its two genes for every trait. The egg can look like either parent, a mix, or show something both were hiding.</P>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Slot c={mom} label="Mother ♀" sex="F" />
          <Slot c={dad} label="Father ♂" sex="M" />
        </View>

        {fc ? (
          <Card style={{ marginTop: 10 }}>
            <H>Forecast</H>
            <P dim>Odds only. It doesn't say which hidden genes are behind them.</P>
            <Text style={{ color: C.gold, fontSize: 12, fontWeight: '700', marginTop: 6 }}>Type</Text>
            {fc.types.slice(0, 5).map(t => (
              <View key={t.label} style={[st.row, { marginVertical: 1 }]}>
                <Text style={{ color: C.text, fontSize: 12, width: 130 }} numberOfLines={1}>{t.label}</Text>
                <View style={{ flex: 1 }}><Bar frac={t.p} color={C.accent} /></View>
                <Text style={{ color: C.dim, fontSize: 11, width: 34, textAlign: 'right' }}>{pct(t.p)}</Text>
              </View>
            ))}
            <Text style={{ color: C.gold, fontSize: 12, fontWeight: '700', marginTop: 6 }}>Body</Text>
            <P>{fc.skels.map(s => `${SKELETON_NAMES[s.skel]} ${pct(s.p)}`).join(' · ')}</P>
            <Text style={{ color: C.gold, fontSize: 12, fontWeight: '700', marginTop: 6 }}>Stars</Text>
            <P>{fc.stars.map((p, i) => (p > 0 ? `${i + 1}★ ${pct(p)}` : null)).filter(Boolean).join(' · ')}</P>
            <P dim>Legendary move slot: {pct(fc.legendary)} · Dual type: {pct(fc.dual)}</P>
          </Card>
        ) : null}

        <Card style={{ marginTop: 10 }}>
          <H>Extras (optional)</H>
          <P dim>Materials improve odds and quality, never raw power.</P>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <Btn small kind={mats.dust ? 'main' : 'ghost'} label={`${MAT_COST.dust} dust: better potential`} onPress={() => setMats(m => ({ ...m, dust: !m.dust }))} />
            <Btn small kind={mats.shard ? 'main' : 'ghost'} label={`${MAT_COST.shard} shards: more mutation`} onPress={() => setMats(m => ({ ...m, shard: !m.shard }))} />
            <Btn small kind={mats.core ? 'main' : 'ghost'} label={`${MAT_COST.core} core: rarer genes`} onPress={() => setMats(m => ({ ...m, core: !m.core }))} />
          </View>
          <P dim style={{ marginTop: 4 }}>You have {save.dust} dust, {save.shard} shards, {save.core} cores.</P>
        </Card>

        <Btn
          kind="gold"
          label={mom && dad ? (tutorial ? 'Breed (free this time)' : `Breed for ${breedCost(mom, dad)} gold`) : 'Pick two parents'}
          disabled={!!problem}
          onPress={() => { const e = mutate(s => doBreed(rng, s, momId!, dadId!, mats, Date.now())); if (e) { setMade(e); setMats({ dust: false, shard: false, core: false }); } }}
        />
        {problem && (mom || dad) ? <P style={{ color: C.bad, marginTop: 4, textAlign: 'center' }}>{problem}</P> : null}
        <P dim style={{ marginTop: 4, textAlign: 'center' }}>Cost rises with the parents' rarity and how often they've bred. Parents rest afterwards.</P>

      </ScrollView>
      {made ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setMade(null)}>
          <View style={{ flex: 1, backgroundColor: '#000c', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <Text style={{ color: C.text, fontSize: 20, fontWeight: '900' }}>A new egg!</Text>
            <EggView ph={express(made.g)} size={W * 0.5} />
            <Stars n={starRating(made.g)} size={30} />
            {made.mutations ? <P style={{ color: C.accent2, marginTop: 4 }}>Something mutated. It may show a trait neither parent had.</P> : null}
            <P dim style={{ marginTop: 6, textAlign: 'center' }}>Put it in an incubator in the Nursery to find out what it is.</P>
            <Btn style={{ marginTop: 14, minWidth: 180 }} kind="gold" label="OK" onPress={() => setMade(null)} />
          </View>
        </Modal>
      ) : null}
      {picking ? (
        <Modal visible animationType="slide" onRequestClose={() => setPicking(null)}>
          <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: 50 }}>
            <View style={{ paddingHorizontal: 14 }}>
              <H>Choose the {picking === 'F' ? 'mother' : 'father'}</H>
              <P dim>Only adults can breed, and parents rest after each egg.</P>
            </View>
            <ScrollView contentContainerStyle={{ padding: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {adults.filter(c => c.sex === picking).map(c => {
                const adult = stageOf(c) >= 2;
                const resting = c.breedReadyAt > now;
                return <CreatureTile key={c.id} c={c} width={tw} selected={c.id === momId || c.id === dadId} dimmed={!adult || resting} badge={!adult ? `Adult at ${stageLevels(express(c.g))[2]}` : resting ? fmtTime(c.breedReadyAt - now) : undefined} onPress={() => { choose(c); setPicking(null); }} />;
              })}
              {adults.filter(c => c.sex === picking).length === 0 ? <P dim>You have no {picking === 'F' ? 'females' : 'males'} yet.</P> : null}
            </ScrollView>
            <View style={{ padding: 14, paddingBottom: 30 }}><Btn kind="ghost" label="Back" onPress={() => setPicking(null)} /></View>
          </View>
        </Modal>
      ) : null}
      {detail ? <CreatureDetail id={detail} onClose={() => setDetail(null)} /> : null}
    </View>
  );
}

export { STAGE_NAMES, typeLabel };
