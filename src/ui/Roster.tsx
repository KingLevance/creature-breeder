// The roster, the creature detail sheet (stats, moves, genes, pedigree) and the team picker.
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { ELEMENTS } from '../game/data/elements';
import { MOVES, RARITY_COLORS, RARITY_NAMES, strikeFor } from '../game/data/moves';
import { Creature, PedNode, STAGE_NAMES, buildLabel, slotRarities, stageLevels, stageOf, statsFor, typeLabel, xpToNext } from '../game/creature';
import { NAME_MAX, expandRoster, release, releaseValue, renameCreature, rosterExpandCost, useScan } from '../game/economy';
import { PART_KEYS, PART_LABELS, SKELETON_NAMES, STANCE_NAMES, STAT_KEYS, STAT_LABELS, express, rareCarrierCount, starRating } from '../game/genome';
import { TUT } from '../game/save';
import { Bar, Btn, C, Card, CreatureTile, CreatureView, H, MoveRow, P, SexMark, Stars, TypeChips, st } from './kit';
import { useGame } from './store';

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

export function CreatureDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { save, mutate } = useGame();
  const { width: W } = useWindowDimensions();
  const [confirm, setConfirm] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
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
        <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 40 }}>
          <View style={{ alignItems: 'center' }}>
            <CreatureView ph={ph} stage={stage} size={W * 0.55} />
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
                <Text style={{ color: C.text, fontSize: 22, fontWeight: '900' }}>{c.name}</Text>
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
              <H>Level {c.level} · {STAGE_NAMES[stage]}</H>
              <P dim>{c.level >= 100 ? 'Max' : `${c.xp} / ${xpToNext(c.level)} XP`}</P>
            </View>
            <Bar frac={c.level >= 100 ? 1 : c.xp / xpToNext(c.level)} color={C.accent} />
            <P dim style={{ marginTop: 6 }}>Teen at {lv[1]} · Adult at {lv[2]} · Ancient at {lv[3]} · Legendary at 100</P>
            <P dim>Levels only by fighting. Tougher fights and doing more in them give more XP.</P>
          </Card>

          <Card>
            <H>Stats</H>
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
            <H>Moves</H>
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
              <H>Genes</H>
              {carriers > 0 && !c.scanned ? <Text style={{ color: C.accent2, fontSize: 12, fontWeight: '700' }}>◆ Carries something rare</Text> : null}
            </View>
            {!c.scanned ? <P dim style={{ marginBottom: 6 }}>You see what shows. Each trait also has a hidden second gene. A scan lens reveals them all.</P> : null}
            <GeneRow label="Body" shown={SKELETON_NAMES[ph.skel]} hid={c.scanned ? SKELETON_NAMES[hidden(c.g.skel, ph.skel) as keyof typeof SKELETON_NAMES] : undefined} scanned={c.scanned} />
            <GeneRow label="Element" shown={ELEMENTS[ph.el1].name} hid={c.scanned ? c.g.el1.filter(e => e !== ph.el1).map(e => ELEMENTS[e].name)[0] : undefined} scanned={c.scanned} />
            <GeneRow label="2nd element" shown={ph.el2 ? ELEMENTS[ph.el2].name : 'None'} hid={c.scanned ? c.g.el2.map(e => (e === 'none' ? 'None' : ELEMENTS[e].name)).filter(n => n !== (ph.el2 ? ELEMENTS[ph.el2].name : 'None'))[0] : undefined} scanned={c.scanned} />
            {PART_KEYS.map(k => <GeneRow key={k} label={PART_LABELS[k]} shown={capital(ph[k])} hid={c.scanned ? capital(hidden(c.g[k] as [string, string], ph[k]) ?? '') || undefined : undefined} scanned={c.scanned} />)}
            <GeneRow label="Markings" shown={`Style ${(ph.mark ?? 0) + 1}`} hid={c.scanned && c.g.mark && c.g.mark[0] !== c.g.mark[1] ? `Style ${Math.max(...c.g.mark) + 1}` : undefined} scanned={c.scanned} />
            <GeneRow label="Stance" shown={STANCE_NAMES[ph.stance ?? 0]} hid={c.scanned && c.g.stance && c.g.stance[0] !== c.g.stance[1] ? STANCE_NAMES[Math.max(...c.g.stance)] : undefined} scanned={c.scanned} />
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
            <H>Pedigree</H>
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

          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Btn style={{ flex: 1 }} kind="ghost" label={c.fav ? '★ Favorite' : '☆ Favorite'} onPress={() => mutate(s => { const x = s.creatures.find(y => y.id === c.id); if (x) x.fav = !x.fav; })} />
            {confirm
              ? <Btn style={{ flex: 1 }} kind="danger" label={`Confirm (+${rv.essence} essence)`} onPress={() => { mutate(s => { release(s, c.id); }); onClose(); }} />
              : <Btn style={{ flex: 1 }} kind="ghost" label="Release" disabled={save.creatures.length <= 1 || !!c.fav || save.tutorial < TUT.DONE} onPress={() => setConfirm(true)} />}
          </View>
          <Btn style={{ marginTop: 10 }} label="Close" onPress={onClose} />
        </ScrollView>
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
  const tw = (W - 28 - 16) / 3;
  const list = useMemo(() => {
    const l = [...save.creatures];
    if (sort === 'level') l.sort((a, b) => b.level - a.level);
    if (sort === 'stars') l.sort((a, b) => starRating(b.g) - starRating(a.g) || b.level - a.level);
    if (sort === 'new') l.reverse();
    return l;
  }, [save.creatures, sort]);
  const cost = rosterExpandCost(save);
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 14 }}>
        <View style={[st.row, { justifyContent: 'space-between', marginBottom: 8 }]}>
          <H>Creatures {save.creatures.length}/{save.rosterCap}</H>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {(['level', 'stars', 'new'] as const).map(k => <Btn key={k} small kind={sort === k ? 'main' : 'ghost'} label={capital(k)} onPress={() => setSort(k)} />)}
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {list.map(c => <CreatureTile key={c.id} c={c} width={tw} onPress={() => setOpen(c.id)} badge={c.fav ? '★' : undefined} />)}
        </View>
        <P dim style={{ marginTop: 10 }}>◆ means it carries a rare hidden gene. Tap a creature for its stats, moves, genes and pedigree.</P>
        {cost != null ? <Btn style={{ marginTop: 10 }} kind="ghost" label={`Add 10 roster slots (${cost} gold)`} disabled={save.gold < cost} onPress={() => mutate(s => { expandRoster(s); })} /> : null}
      </ScrollView>
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
