// One row per body plan, one column per silhouette-gene extreme: npx tsx tools/review/silhouettes.ts out.png
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';
import { ELEMENT_IDS } from '../../src/game/data/elements';
import { Genome, SKELETONS, express, mulberry32, wildGenome } from '../../src/game/genome';
import { drawCreature, shapesToSvg } from '../../src/render/creature';
const out = process.argv[2] ?? '/tmp/silhouettes.png';
const cell = Number(process.env.CELL ?? 170);
const COLS: [string, Partial<Record<'torso' | 'neck' | 'headSize' | 'bodyLen', number>>][] = [
  ['average', {}], ['pear', { torso: -2 }], ['top-heavy', { torso: 2 }], ['no neck', { neck: -2 }], ['long neck', { neck: 2 }],
  ['small head', { headSize: -2 }], ['big head', { headSize: 2 }], ['compact', { bodyLen: -2 }], ['long', { bodyLen: 2 }],
];
let svg = '';
SKELETONS.forEach((sk, r) => {
  const g0 = wildGenome(mulberry32(900 + r), { els: ELEMENT_IDS, quality: 0.5, skels: [sk] });
  g0.skel = [sk, sk]; g0.girth = [0, 0]; g0.height = [0, 0]; g0.stance = [0, 0]; g0.wings = ['none', 'none']; g0.crest = ['none', 'none']; g0.horns = ['none', 'none'];
  COLS.forEach(([name, set], c) => {
    const g = JSON.parse(JSON.stringify(g0)) as Genome;
    g.torso = [0, 0]; g.neck = [0, 0]; g.headSize = [0, 0]; g.bodyLen = [0, 0];
    for (const [k, v] of Object.entries(set)) (g as any)[k] = [v, v];
    const x = c * cell, y = r * cell;
    svg += shapesToSvg(drawCreature(express(g), { stage: 3, phase: 0.1 }), cell).replace('<svg ', `<svg x="${x}" y="${y}" `);
    if (c === 0) svg += `<text x="${x + 5}" y="${y + cell - 6}" font-family="DejaVu Sans" font-size="12" fill="#fff">${express(g).skel}</text>`;
    if (r === 0) svg += `<text x="${x + 5}" y="${y + 14}" font-family="DejaVu Sans" font-size="12" fill="#fff">${name}</text>`;
  });
});
writeFileSync(out, new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${COLS.length * cell}" height="${SKELETONS.length * cell}"><rect width="100%" height="100%" fill="#4a3d86"/>${svg}</svg>`).render().asPng());
console.log(out);
