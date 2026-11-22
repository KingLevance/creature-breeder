// The stockiest, squattest (and the lankiest, thinnest) of each legged body plan, where proportions strain most.
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';
import { ELEMENT_IDS } from '../../src/game/data/elements';
import { Skeleton, express, mulberry32, wildGenome } from '../../src/game/genome';
import { drawCreature, shapesToSvg } from '../../src/render/creature';
const out = process.argv[2] ?? '/tmp/squat.png';
const cell = 220;
const SK: Skeleton[] = ['quad', 'multi', 'biped'];
const SHAPES: [number, number, string][] = [[2, -2, 'bulky squat'], [0, -2, 'squat'], [2, 0, 'bulky'], [-2, 2, 'slender lanky'], [2, 2, 'bulky lanky']];
let svg = '';
let row = 0;
for (const sk of SK) for (const stage of [1, 2, 4]) {
  SHAPES.forEach(([gw, ht, name], c) => {
    const g = wildGenome(mulberry32(5200 + row * 7 + c), { els: ELEMENT_IDS, quality: 0.5, skels: [sk] });
    g.skel = [sk, sk]; g.girth = [gw, gw]; g.height = [ht, ht]; g.stance = [c % 4, c % 4];
    svg += shapesToSvg(drawCreature(express(g), { stage, phase: 0.1 }), cell).replace('<svg ', `<svg x="${c * cell}" y="${row * cell}" `);
    svg += `<text x="${c * cell + 5}" y="${row * cell + 14}" font-family="DejaVu Sans, sans-serif" font-size="11" fill="#fff">${sk} st${stage} ${name} stance${c % 4}</text>`;
  });
  row++;
}
writeFileSync(out, new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${SHAPES.length * cell}" height="${row * cell}"><rect width="100%" height="100%" fill="#4a3d86"/>${svg}</svg>`).render().asPng());
console.log(out);
