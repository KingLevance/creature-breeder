// Close-ups of numbered creatures from the review plan sheets: npx tsx tools/scratch/pick2.ts out.png floater:4 quad:9 ...
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';
import { ELEMENT_IDS } from '../../src/game/data/elements';
import { Skeleton, SKELETONS, express, mulberry32, wildGenome } from '../../src/game/genome';
import { drawCreature, shapesToSvg } from '../../src/render/creature';
const [out, ...picks] = process.argv.slice(2);
const cell = Number(process.env.CELL ?? 400);
let svg = '';
picks.forEach((pk, n) => {
  // body:number[:stage] picks from the plan sheets; seed:<n>:<body>[:stage] picks any other sheet's creature by its seed.
  const bits = pk.split(':');
  const bySeed = bits[0] === 'seed';
  const sk = bySeed ? bits[2] : bits[0], is = bits[1], st = bySeed ? bits[3] : bits[2];
  const i = Number(is);
  const g = wildGenome(mulberry32(bySeed ? i : 7000 + SKELETONS.indexOf(sk as Skeleton) * 100 + i), { els: ELEMENT_IDS, quality: 0.5, skels: [sk as Skeleton] });
  g.skel = [sk as Skeleton, sk as Skeleton];
  const stage = st != null ? Number(st) : [2, 3, 1, 2][i % 4];
  svg += shapesToSvg(drawCreature(express(g), { stage, phase: 0.1 }), cell).replace('<svg ', `<svg x="${n * cell}" y="0" `);
  svg += `<text x="${n * cell + 6}" y="16" font-family="DejaVu Sans, sans-serif" font-size="13" fill="#fff">${pk}</text>`;
});
writeFileSync(out, new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${picks.length * cell}" height="${cell}"><rect width="100%" height="100%" fill="#4a3d86"/>${svg}</svg>`).render().asPng());
