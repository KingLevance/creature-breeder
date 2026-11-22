// Every wing type on every body plan, single- and dual-element, to judge colour and how the root meets the body.
// OUT=/tmp/review/base/art npx tsx tools/scratch/wings2.ts
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ELEMENT_IDS, ElementId } from '../../src/game/data/elements';
import { SKELETONS, express, mulberry32, wildGenome } from '../../src/game/genome';
import { drawCreature, shapesToSvg } from '../../src/render/creature';
const OUT = process.env.OUT ?? '/tmp/review/base/art';
mkdirSync(OUT, { recursive: true });
const WINGS = ['feather', 'bat', 'insect', 'flipper', 'fin', 'energy'];
const PAIRS: [ElementId, ElementId | 'none'][] = [['venom', 'spark'], ['glimmer', 'terra'], ['tide', 'none'], ['ember', 'frost'], ['verdant', 'none'], ['shade', 'radiant']];
const cell = 200;
for (const stage of [1, 3]) {
  let out = '';
  SKELETONS.forEach((sk, r) => WINGS.forEach((w, c) => {
    const g = wildGenome(mulberry32(3100 + r * 10 + c), { els: ELEMENT_IDS, quality: 0.5, skels: [sk] });
    const [e1, e2] = PAIRS[(r + c) % PAIRS.length];
    g.skel = [sk, sk]; g.el1 = [e1, e1]; g.el2 = [e2, e2]; g.wings = [w, w]; g.crest = ['none', 'none'];
    const x = c * cell, y = r * cell;
    out += shapesToSvg(drawCreature(express(g), { stage, phase: 0.1 }), cell).replace('<svg ', `<svg x="${x}" y="${y}" `);
    out += `<text x="${x + 5}" y="${y + 14}" font-family="DejaVu Sans, sans-serif" font-size="11" fill="#fff">${sk} ${w} ${e1}${e2 !== 'none' ? '/' + e2 : ''}</text>`;
  }));
  writeFileSync(`${OUT}/wings_st${stage}.png`, new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${WINGS.length * cell}" height="${SKELETONS.length * cell}"><rect width="100%" height="100%" fill="#4a3d86"/>${out}</svg>`).render().asPng());
}
console.log('wings →', OUT);
