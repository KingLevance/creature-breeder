// A test bench for capture scripts, web only. A script writes a spec into browser storage under 'hatchlore.lab'
// and the app opens straight into that fight or line-up. A phone never has the key, so players never see this.
import React from 'react';
import { Platform, Text, View } from 'react-native';
import type { UnitMods } from '../game/battle';
import type { Creature } from '../game/creature';
import { express } from '../game/genome';
import { Run, emptyLoot } from '../game/run';
import type { Save } from '../game/save';
import type { Pose } from '../render/creature';
import { C, LiveCreature } from './kit';
import { F } from './look';

export type LabSpec =
  | { kind: 'fight'; team: string[]; enemies: Creature[]; mods?: UnitMods[]; boss?: boolean; sky?: [string, string]; ground?: string; carry?: Run['carry'] }
  | { kind: 'zoo'; ids: string[]; size: number; cols: number; walking?: boolean; pose?: Pose; ko?: boolean; stage?: number; bg?: string };

export function readLab(): LabSpec | null {
  if (Platform.OS !== 'web') return null;
  try {
    const raw = (globalThis as any).localStorage?.getItem('hatchlore.lab');
    return raw ? (JSON.parse(raw) as LabSpec) : null;
  } catch {
    return null;
  }
}

export function labRun(spec: Extract<LabSpec, { kind: 'fight' }>): Run {
  const level = Math.max(1, ...spec.enemies.map(e => e.level));
  return {
    kind: 'area', areaId: 1, title: 'Test bench', idx: 0, team: spec.team, carry: spec.carry ?? {}, loot: emptyLoot(),
    fights: [{ enemies: spec.enemies, mods: spec.mods ?? spec.enemies.map(() => ({})), boss: !!spec.boss, level }],
    sky: spec.sky ?? ['#6fb7ff', '#cfeaff'], ground: spec.ground ?? '#6fbf5a', floor: 0, actionLimit: 0, raidDmg: 0,
  };
}

/** A grid of living creatures on a plain floor, for filming how they stand, breathe and walk. */
export function LabZoo({ spec, save }: { spec: Extract<LabSpec, { kind: 'zoo' }>; save: Save }) {
  const list = spec.ids.map(id => save.creatures.find(c => c.id === id)).filter((c): c is Creature => !!c);
  return (
    <View style={{ flex: 1, backgroundColor: spec.bg ?? '#3d3270', flexDirection: 'row', flexWrap: 'wrap', alignContent: 'flex-start' }}>
      {list.map(c => (
        <View key={c.id} style={{ width: `${100 / spec.cols}%`, alignItems: 'center', paddingVertical: 6 }}>
          <LiveCreature ph={express(c.g)} stage={spec.stage ?? 2} size={spec.size} walking={spec.walking} pose={spec.pose} ko={spec.ko} />
          <Text style={{ color: C.dim, fontSize: 10, fontFamily: F.med }}>{c.name}</Text>
        </View>
      ))}
    </View>
  );
}
