// The roster, the creature detail sheet (stats, moves, genes, pedigree) and the team picker.
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { ELEMENTS } from '../game/data/elements';
import { MOVES, RARITY_COLORS, RARITY_NAMES, strikeFor } from '../game/data/moves';
import { Creature, MAX_LEVEL, PedNode, STAGE_NAMES, XpResult, buildLabel, slotRarities, stageLevels, stageOf, statsFor, typeLabel, xpToNext } from '../game/creature';
import { NAME_MAX, expandRoster, release, releaseMany, releaseProblem, releaseValue, renameCreature, rosterExpandCost, train, trainCost, useScan } from '../game/economy';
import { FRAME_NAMES, HEIGHT_NAMES, PartKey, PARTS, PART_KEYS, Pheno, PART_LABELS, SKELETON_NAMES, shapeName, stanceName, STAT_KEYS, STAT_LABELS, express, rareCarrierCount, starRating } from '../game/genome';
import { TUT } from '../game/save';
import { Bar, Btn, C, Card, CreatureTile, CreatureView, H, LiveCreature, MoveRow, P, SexMark, Stars, Title, TypeChips, st } from './kit';
import { sfx } from './audio';
import { Backdrop, F, FadeIn, Glow, Icon, Pedestal, haptic } from './look';
import { rng, useGame } from './store';

function PedCard({ n, label, size }: { n?: PedNode; label: string; size: number }) {
  return (
    <View style={{ alignItems: 'center', width: size + 16 }}>
      <Text style={{ color: C.dim, fontSize: 10 }}>{label}</Text>
      {n ? (
        <>
          <CreatureView ph={n.ph} stage={2} size={size} shadow={false} />
          <Text style={{ color: C.text, fontSize: 11, fontWeight: '700' }} numberOfLines={1}>{n.name}</Text>
          <Stars n={n.stars} size={9} />
          <Text style={{ color: C.dim, fontSize: 9, textAlign: 'center' }} numberOfLines={2}>{typeLabel(n.ph)}{'\n'}{SKELETON_NAMES[n.ph.skel]}</Text>
        </>
      ) : <Text style={{ color: C.dim, fontSize: 11, marginTop: 10 }}>Unknown</Text>}
    </View>
  );
}

function capital(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
/** Why a looks gene doesn't show on this body, if it doesn't. It still passes down. */
function unseen(k: PartKey, ph: Pheno): string | null {
  if (k === 'feet' && ph.skel !== 'biped' && ph.skel !== 'quad') return 'no feet to show';
  if (k === 'ears' && ph.head === 'eared' && ph.ears !== 'none') return 'hidden by its big ears';
  if (k === 'ears' && ph.skel === 'aquatic' && ph.ears !== 'none') return 'swimmers have none';
  if (k === 'crest' && ph.crest === 'sail' && ph.wings !== 'none') return 'hidden by its wings';
  if (k === 'twotone' && ph.skel === 'serpent' && (ph.twotone === 'points' || ph.twotone === 'socks')) return 'no limbs to show';
  return null;
}

export function CreatureDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { save, mutate } = useGame();
  const { width: W } = useWindowDimensions();
  const [confirm, setConfirm] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [trained, setTrained] = useState<{ n: number; r: XpResult; level: number } | null>(null);
  const c = save.creatures.find(x => x.id === id);
  const ph = useMemo(() => (c ? express(c.g) : null), [c?.g]);
  if (!c || !ph) return null;
  const stage = stageOf(c);
  const stats = statsFor(c.g, c.level);
  const lv = stageLevels(ph);
  const rar = slotRarities(c.g);
  const carriers = rareCarrierCount(c.g);
  const rv = releaseValue(c);
  const hidden = (pair: [string, string], shown: string) => pair.find(a => a !== shown);
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: 50 }}>
        <Backdrop tint={ELEMENTS[ph.el1].base} H={900} />
        <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 40 }}>
          <View style={{ alignItems: 'center' }}>
            <FadeIn dy={24}>
              <View style={{ width: W - 28, height: W * 0.58, alignItems: 'center', justifyContent: 'flex-end' }}>
                <Glow color={ELEMENTS[ph.el1].light} opacity={0.6} cy="62%" r="52%" />
                {ph.el2 ? <Glow color={ELEMENTS[ph.el2].light} opacity={0.35} cx="72%" cy="38%" r="36%" /> : null}
                {/* Centred on the creature's feet. */}
                <Pedestal w={W * 0.7} color={ELEMENTS[ph.el1].light} style={{ bottom: W * 0.055 - W * 0.105 }} />
                <LiveCreature ph={ph} stage={stage} size={W * 0.55} />
              </View>
            </FadeIn>
            {editing != null ? (
              <View style={[st.row, { marginVertical: 4 }]}>
                <TextInput
                  value={editing}
                  onChangeText={setEditing}
                  maxLength={NAME_MAX}
                  autoFocus
                  selectTextOnFocus
                  returnKeyType="done"
                  onSubmitEditing={() => { mutate(s => { renameCreature(s, c.id, editing); }); setEditing(null); }}
                  style={{ color: C.text, fontSize: 20, fontWeight: '800', backgroundColor: C.panel2, borderColor: C.gold, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, minWidth: 170, textAlign: 'center' }}
                />
                <Btn small kind="gold" label="Save" disabled={!editing.trim()} onPress={() => { mutate(s => { renameCreature(s, c.id, editing); }); setEditing(null); }} />
                <Btn small kind="ghost" label="Cancel" onPress={() => setEditing(null)} />
              </View>
            ) : (
              <Pressable onPress={() => setEditing(c.name)} style={st.row} hitSlop={8}>
                <Text style={{ color: C.text, fontSize: 30, fontFamily: F.bold, textShadowColor: 'rgba(0,0,0,0.4)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 4 }}>{c.name}{ph.shiny ? <Text style={{ color: C.gold, fontSize: 22 }}> ✦</Text> : null}</Text>
                <SexMark sex={c.sex} />
                <Text style={{ color: C.dim, fontSize: 16 }}>✎</Text>
              </Pressable>
            )}
            <Stars n={starRating(c.g)} size={20} />
            <View style={{ marginTop: 4 }}><TypeChips ph={ph} /></View>
            <P dim style={{ marginTop: 4 }}>{SKELETON_NAMES[ph.skel]} · {buildLabel(ph.build)} · {c.origin === 'bred' ? 'Bred' : c.origin === 'starter' ? 'Starter' : 'Wild-born'}</P>
          </View>

          <Card style={{ marginTop: 12 }}>
            <View style={[st.row, { justifyContent: 'space-between' }]}>
              <Title icon="star" color="#f6b52e" right={<P dim>{c.level >= 100 ? 'Max' : `${c.xp} / ${xpToNext(c.level)} XP`}</P>}>Level {c.level} · {STAGE_NAMES[stage]}</Title>
            </View>
            <Bar frac={c.level >= 100 ? 1 : c.xp / xpToNext(c.level)} color={C.accent} />
            <P dim style={{ marginTop: 6 }}>Teen at {lv[1]} · Adult at {lv[2]} · Ancient at {lv[3]} · Legendary at 100</P>
            <P dim>Fights give XP: tougher fights and doing more in them give more. You can also train with essence.</P>
            {c.level < MAX_LEVEL ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                {[1, 5].map(n => {
                  const k = Math.min(n, MAX_LEVEL - c.level), cost = trainCost(c, k);
                  return (
                    <Btn key={n} small style={{ flex: 1 }} kind={n === 1 ? 'main' : 'ghost'} disabled={save.essence < cost}
                      icon={<Icon name="gem" size={15} color={n === 1 ? '#ffffff' : '#c9b8ff'} accent="#2b2054" />}
                      label={`+${k} level${k > 1 ? 's' : ''} · ${cost}`}
                      onPress={() => {
                        const r = mutate(s => train(rng, s, c.id, k));
                        if (!r) return;
                        haptic('medium');
                        sfx(r.newStage != null ? 'grow' : 'levelup');
                        setTrained(t => ({ n: (t?.n ?? 0) + 1, r, level: c.level + r.levels }));
                      }} />
                  );
                })}
              </View>
            ) : null}
            {c.level < MAX_LEVEL ? <P dim style={{ marginTop: 4, fontSize: 12 }}>You have {save.essence} essence. Release creatures or discard eggs for more.</P> : null}
            {trained ? (
              <FadeIn key={trained.n} dy={6}>
                <Text style={{ color: C.gold, fontFamily: F.bold, fontSize: 15, marginTop: 6 }}>
                  {trained.r.newStage != null ? `Grew into ${STAGE_NAMES[trained.r.newStage]}! ` : ''}Level {trained.level}!{trained.r.learned.length ? ` Learned ${trained.r.learned.map(m => m.name).join(', ')}.` : ''}
                </Text>
              </FadeIn>
            ) : null}
          </Card>

          <Card>
            <Title icon="bolt" color="#ff7a59">Stats</Title>
            {STAT_KEYS.map(k => (
              <View key={k} style={[st.row, { marginBottom: 4 }]}>
                <Text style={{ color: C.dim, width: 62, fontSize: 12 }}>{STAT_LABELS[k]}</Text>
                <Text style={{ color: C.text, width: 44, fontSize: 13, fontWeight: '700' }}>{stats[k]}</Text>
                <View style={{ flex: 1 }}>{c.scanned ? <Bar frac={ph.pot[k] / 10} color={C.gold} /> : <Bar frac={0} color={C.gold} />}</View>
                <Text style={{ color: C.dim, width: 64, fontSize: 10, textAlign: 'right' }}>{c.scanned ? `potential ${ph.pot[k]}` : 'potential ?'}</Text>
              </View>
            ))}
          </Card>

          <Card>
            <Title icon="sword" color="#8f7cff">Moves</Title>
            <P dim style={{ marginBottom: 6 }}>One slot per life stage. You can see how rare a slot is, but not the move until it unlocks.</P>
            {rar.map((r, i) => {
              const id2 = c.moves[i];
              if (id2 && MOVES[id2]) return <MoveRow key={i} mv={MOVES[id2]} />;
              return (
                <View key={i} style={[st.move, { borderLeftColor: r == null ? '#3a3256' : RARITY_COLORS[r] }]}>
                  <Text style={{ color: r == null ? C.dim : RARITY_COLORS[r], fontWeight: '700', fontSize: 13 }}>
                    {r == null ? 'No legendary slot' : `${RARITY_NAMES[r]} move · hidden`}
                  </Text>
                  <Text style={{ color: C.dim, fontSize: 11 }}>{r == null ? 'Only some bloodlines carry one.' : `Unlocks as ${STAGE_NAMES[i]} (level ${lv[i]})`}</Text>
                </View>
              );
            })}
            <MoveRow mv={strikeFor(ph.el1)} />
          </Card>

          <Card>
            <View style={[st.row, { justifyContent: 'space-between' }]}>
              <Title icon="dna" color="#4fc3a1">Genes</Title>
              {carriers > 0 && !c.scanned ? <Text style={{ color: C.accent2, fontSize: 12, fontWeight: '700' }}>◆ Carries something rare</Text> : null}
            </View>
            {!c.scanned ? <P dim style={{ marginBottom: 6 }}>You see what shows. Each trait also has a hidden second gene. A scan lens reveals them all.</P> : null}
            <GeneRow label="Body" shown={SKELETON_NAMES[ph.skel]} hid={c.scanned ? SKELETON_NAMES[hidden(c.g.skel, ph.skel) as keyof typeof SKELETON_NAMES] : undefined} scanned={c.scanned} />
            <GeneRow label="Element" shown={ELEMENTS[ph.el1].name} hid={c.scanned ? c.g.el1.filter(e => e !== ph.el1).map(e => ELEMENTS[e].name)[0] : undefined} scanned={c.scanned} />
            <GeneRow label="2nd element" shown={ph.el2 ? ELEMENTS[ph.el2].name : 'None'} hid={c.scanned ? c.g.el2.map(e => (e === 'none' ? 'None' : ELEMENTS[e].name)).filter(n => n !== (ph.el2 ? ELEMENTS[ph.el2].name : 'None'))[0] : undefined} scanned={c.scanned} />
            {PART_KEYS.map(k => { const v = ph[k] ?? PARTS[k][0]; return <GeneRow key={k} label={PART_LABELS[k]} shown={capital(v) + (unseen(k, ph) ? ` · ${unseen(k, ph)}` : '')} hid={c.scanned && c.g[k] ? capital(hidden(c.g[k] as [string, string], v) ?? '') || undefined : undefined} scanned={c.scanned} />; })}
            <GeneRow label="Shiny" shown={ph.shiny ? '✦ Yes' : 'No'} hid={c.scanned && !ph.shiny && c.g.shiny && (c.g.shiny[0] === 1 || c.g.shiny[1] === 1) ? 'shiny' : undefined} scanned={c.scanned} />
            <GeneRow label="Markings" shown={`Style ${(ph.mark ?? 0) + 1}`} hid={c.scanned && c.g.mark && c.g.mark[0] !== c.g.mark[1] ? `Style ${Math.max(...c.g.mark) + 1}` : undefined} scanned={c.scanned} />
            <GeneRow label="Stance" shown={stanceName(ph.skel, ph.stance ?? 0)} hid={c.scanned && c.g.stance && c.g.stance[0] !== c.g.stance[1] ? stanceName(ph.skel, Math.max(...c.g.stance)) : undefined} scanned={c.scanned} />
            {/* Proportions blend: a child lands between its two alleles, so a scan shows both. */}
            <GeneRow label="Frame" shown={shapeName(FRAME_NAMES, (ph.girth ?? 0) * 2) + ((ph.girth ?? 0) >= 0.25 ? ' · tough, slow' : (ph.girth ?? 0) <= -0.25 ? ' · quick, frail' : '')} hid={c.scanned && c.g.girth && c.g.girth[0] !== c.g.girth[1] ? `${shapeName(FRAME_NAMES, c.g.girth[0])} & ${shapeName(FRAME_NAMES, c.g.girth[1])}` : undefined} scanned={c.scanned} />
            <GeneRow label="Height" shown={shapeName(HEIGHT_NAMES, (ph.height ?? 0) * 2) + ((ph.height ?? 0) >= 0.25 ? ' · reach, slower' : (ph.height ?? 0) <= -0.25 ? ' · nimble' : '')} hid={c.scanned && c.g.height && c.g.height[0] !== c.g.height[1] ? `${shapeName(HEIGHT_NAMES, c.g.height[0])} & ${shapeName(HEIGHT_NAMES, c.g.height[1])}` : undefined} scanned={c.scanned} />
            {c.scanned ? (
              <>
                <GeneRow label="Legendary slot" shown={ph.leg ? 'Yes' : 'No'} hid={!ph.leg && (c.g.leg[0] === 1 || c.g.leg[1] === 1) ? 'Yes (carried)' : undefined} scanned />
                <GeneRow label="Growth" shown={ph.growth > 0.4 ? 'Fast' : ph.growth < -0.4 ? 'Slow' : 'Normal'} scanned />
              </>
            ) : (
              <Btn small style={{ marginTop: 8 }} label={save.scans > 0 ? `Use a scan lens (${save.scans} left)` : 'No scan lenses (boss chests, shop)'} disabled={save.scans < 1} onPress={() => mutate(s => { useScan(s, c.id); })} />
            )}
          </Card>

          <Card>
            <Title icon="heart" color="#ff7fae">Pedigree</Title>
            {c.mom || c.dad ? (
              <>
                <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
                  <PedCard n={c.mom} label="Mother" size={74} />
                  <PedCard n={c.dad} label="Father" size={74} />
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginTop: 10 }}>
                  <PedCard n={c.mom?.m} label="Her mother" size={46} />
                  <PedCard n={c.mom?.f} label="Her father" size={46} />
                  <PedCard n={c.dad?.m} label="His mother" size={46} />
                  <PedCard n={c.dad?.f} label="His father" size={46} />
                </View>
                <P dim style={{ marginTop: 8 }}>If a parent showed a trait this one doesn't, this one may still carry it.</P>
              </>
            ) : <P dim>{c.origin === 'starter' ? 'Your first creature. Its line starts with you.' : 'Hatched from a wild egg. Its parents are unknown.'}</P>}
          </Card>

          {confirm ? (
            <Card tint={C.bad}>
              <Text style={{ color: C.text, fontFamily: F.bold, fontSize: 16 }}>Release {c.name}?</Text>
              <P dim style={{ marginBottom: 10 }}>You get {rv.essence} essence{rv.dust ? ` and ${rv.dust} dust` : ''}. This can't be undone.</P>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Btn style={{ flex: 1 }} kind="ghost" label="Keep" onPress={() => setConfirm(false)} />
                <Btn style={{ flex: 1 }} kind="danger" label="Release" onPress={() => { mutate(s => { release(s, c.id); }); sfx('poof'); onClose(); }} />
              </View>
            </Card>
          ) : (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Btn style={{ flex: 1 }} kind="ghost" label={c.fav ? '★ Favorite' : '☆ Favorite'} onPress={() => mutate(s => { const x = s.creatures.find(y => y.id === c.id); if (x) x.fav = !x.fav; })} />
              <Btn style={{ flex: 1 }} kind="ghost" label="Release" disabled={save.creatures.length <= 1 || !!c.fav || save.tutorial < TUT.DONE} onPress={() => setConfirm(true)} />
            </View>
          )}
          <Btn style={{ marginTop: 10 }} label="Close" onPress={onClose} />
        </ScrollView>
        {/* Always in reach, wherever the page is scrolled to. */}
        <Pressable onPress={() => { haptic('select'); onClose(); }} hitSlop={10} accessibilityLabel="Close"
          style={({ pressed }) => ({ position: 'absolute', top: 54, right: 14, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(14,9,30,0.72)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.22)', transform: [{ scale: pressed ? 0.9 : 1 }] })}>
          <Svg width={16} height={16} viewBox="0 0 16 16"><Path d="M3 3L13 13M13 3L3 13" stroke="#ffffff" strokeWidth={2.6} strokeLinecap="round" /></Svg>
        </Pressable>
      </View>
    </Modal>
  );
}

function GeneRow({ label, shown, hid, scanned }: { label: string; shown: string; hid?: string; scanned: boolean }) {
  return (
    <View style={[st.row, { paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: '#2c2348' }]}>
      <Text style={{ color: C.dim, fontSize: 12, width: 104 }}>{label}</Text>
      <Text style={{ color: C.text, fontSize: 13, fontWeight: '700', flex: 1 }}>{shown}</Text>
      <Text style={{ color: hid ? C.accent2 : C.dim, fontSize: 12 }}>{scanned ? (hid ? `carries ${hid}` : 'pure') : '?'}</Text>
    </View>
  );
}

export function RosterScreen() {
  const { save, mutate } = useGame();
  const { width: W } = useWindowDimensions();
  const [open, setOpen] = useState<string | null>(null);
  const [sort, setSort] = useState<'level' | 'stars' | 'new'>('level');
  // Picking several creatures to release at once.
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [sure, setSure] = useState(false);
  const [gone, setGone] = useState<{ count: number; essence: number; dust: number } | null>(null);
  const tw = (W - 28 - 16) / 3;
  const list = useMemo(() => {
    const l = [...save.creatures];
    if (sort === 'level') l.sort((a, b) => b.level - a.level);
    if (sort === 'stars') l.sort((a, b) => starRating(b.g) - starRating(a.g) || b.level - a.level);
    if (sort === 'new') l.reverse();
    return l;
  }, [save.creatures, sort]);
  const cost = rosterExpandCost(save);
  const blocked = (c: Creature) => releaseProblem(save, c);
  const pickedCs = save.creatures.filter(c => picked.includes(c.id));
  // Always leave at least one creature.
  const tooMany = pickedCs.length >= save.creatures.length;
  const value = pickedCs.reduce((a, c) => { const v = releaseValue(c); return { essence: a.essence + v.essence, dust: a.dust + v.dust }; }, { essence: 0, dust: 0 });
  const toggle = (c: Creature) => { setSure(false); setPicked(p => (p.includes(c.id) ? p.filter(x => x !== c.id) : [...p, c.id])); };
  const pickStars = (n: number) => {
    setSure(false);
    const add = save.creatures.filter(c => starRating(c.g) === n && !blocked(c) && !save.team.includes(c.id)).map(c => c.id);
    setPicked(p => [...new Set([...p, ...add])]);
  };
  const stop = () => { setPicking(false); setPicked([]); setSure(false); };
  const canRelease = save.tutorial >= TUT.DONE && save.creatures.length > 1;
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: picking ? 170 : 14 }}>
        <View style={[st.row, { justifyContent: 'space-between', marginBottom: 6 }]}>
          <H>Creatures {save.creatures.length}/{save.rosterCap}</H>
          {canRelease ? <Btn small kind={picking ? 'main' : 'ghost'} label={picking ? 'Done' : 'Multi-Release'} onPress={() => (picking ? stop() : setPicking(true))} /> : null}
        </View>
        <View style={[st.row, { marginBottom: 8, gap: 4 }]}>
          {picking ? (
            <>
              <Text style={{ color: C.dim, fontFamily: F.semi, fontSize: 13, marginRight: 2 }}>Pick all</Text>
              {[1, 2, 3].map(n => <Btn key={n} small kind="ghost" label={`${n}★`} onPress={() => pickStars(n)} />)}
              {picked.length ? <Btn small kind="ghost" label="Clear" onPress={() => { setPicked([]); setSure(false); }} /> : null}
            </>
          ) : (
            <>
              <Text style={{ color: C.dim, fontFamily: F.semi, fontSize: 13, marginRight: 2 }}>Sort</Text>
              {(['level', 'stars', 'new'] as const).map(k => <Btn key={k} small kind={sort === k ? 'main' : 'ghost'} label={capital(k)} onPress={() => setSort(k)} />)}
            </>
          )}
        </View>
        {picking ? <P dim style={{ marginBottom: 8 }}>Tap creatures to pick them. Favorites can't be picked, and "Pick all" leaves your team alone.</P> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {list.map(c => picking
            ? <CreatureTile key={c.id} c={c} width={tw} selected={picked.includes(c.id)} dimmed={!!blocked(c)} badge={picked.includes(c.id) ? '✓' : c.fav ? '★' : undefined} onPress={blocked(c) ? undefined : () => toggle(c)} />
            : <CreatureTile key={c.id} c={c} width={tw} onPress={() => setOpen(c.id)} badge={c.fav ? '★' : undefined} />)}
        </View>
        {!picking ? <P dim style={{ marginTop: 10 }}>◆ means it carries a rare hidden gene; ✦ is a shiny, a rare colouring that breeds true. Tap a creature for its stats, moves, genes and pedigree.</P> : null}
        {!picking && cost != null ? <Btn style={{ marginTop: 10 }} kind="ghost" label={`Add 10 roster slots (${cost} gold)`} disabled={save.gold < cost} onPress={() => mutate(s => { expandRoster(s); })} /> : null}
        {gone && !picking ? (
          <FadeIn key={gone.count + '_' + gone.essence}>
            <P style={{ color: C.gold, marginTop: 10, textAlign: 'center' }}>Released {gone.count}. +{gone.essence} essence{gone.dust ? `, +${gone.dust} dust` : ''}.</P>
          </FadeIn>
        ) : null}
      </ScrollView>
      {picking ? (
        <FadeIn dy={20} style={{ position: 'absolute', left: 10, right: 10, bottom: 8 }}>
          <Card tint={picked.length ? C.bad : undefined} style={{ marginBottom: 0 }}>
            <Text style={{ color: C.text, fontFamily: F.bold, fontSize: 16 }}>
              {picked.length ? `${picked.length} picked` : 'Pick creatures to release'}
            </Text>
            <P dim style={{ marginBottom: 10 }}>
              {tooMany ? 'Keep at least one creature.' : picked.length ? `You get ${value.essence} essence${value.dust ? ` and ${value.dust} dust` : ''}.${sure ? " This can't be undone." : ''}` : 'Releasing gives essence for training and the shop.'}
            </P>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Btn style={{ flex: 1 }} kind="ghost" label={sure ? 'Wait' : 'Cancel'} onPress={() => (sure ? setSure(false) : stop())} />
              <Btn style={{ flex: 1 }} kind="danger" label={sure ? `Release ${picked.length}` : 'Release'} disabled={!picked.length || tooMany}
                onPress={() => {
                  if (!sure) { setSure(true); haptic('select'); return; }
                  const r = mutate(s => releaseMany(s, picked));
                  sfx('poof');
                  haptic('medium');
                  setGone(r);
                  stop();
                }} />
            </View>
          </Card>
        </FadeIn>
      ) : null}
      {open ? <CreatureDetail id={open} onClose={() => setOpen(null)} /> : null}
    </View>
  );
}

/** Pick up to five creatures before a run. The team is locked once the run starts. */
export function TeamPicker({ title, note, max = 5, onStart, onClose, startLabel = 'Start' }: { title: string; note?: string; max?: number; onStart: (team: string[]) => void; onClose: () => void; startLabel?: string }) {
  const { save } = useGame();
  const { width: W } = useWindowDimensions();
  const [team, setTeam] = useState<string[]>(() => save.team.filter(id => save.creatures.some(c => c.id === id)).slice(0, max));
  const tw = (W - 28 - 16) / 3;
  const list = useMemo(() => [...save.creatures].sort((a, b) => b.level - a.level), [save.creatures]);
  const toggle = (id: string) => setTeam(t => (t.includes(id) ? t.filter(x => x !== id) : t.length < max ? [...t, id] : t));
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: 50 }}>
        <View style={{ paddingHorizontal: 14 }}>
          <H>{title}</H>
          <P dim>Pick up to {max}. No swapping mid-run, and a creature that falls stays down unless someone can revive it.</P>
          {note ? <P style={{ color: C.gold, marginTop: 4 }}>{note}</P> : null}
        </View>
        <ScrollView contentContainerStyle={{ padding: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {list.map(c => <CreatureTile key={c.id} c={c} width={tw} selected={team.includes(c.id)} badge={team.includes(c.id) ? String(team.indexOf(c.id) + 1) : undefined} onPress={() => toggle(c.id)} />)}
        </ScrollView>
        <View style={{ flexDirection: 'row', gap: 8, padding: 14, paddingBottom: 30 }}>
          <Btn style={{ flex: 1 }} kind="ghost" label="Back" onPress={onClose} />
          <Btn style={{ flex: 2 }} kind="gold" label={`${startLabel} (${team.length}/${max})`} disabled={team.length === 0} onPress={() => onStart(team)} />
        </View>
      </View>
    </Modal>
  );
}

export type { Creature };
