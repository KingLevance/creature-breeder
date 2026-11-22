// Review sheets for creature art: the same fixed creatures every run, so a before and an after line up cell for cell.
// OUT=/tmp/review/base/art npx tsx tools/scratch/review_art.ts
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ELEMENT_IDS } from '../../src/game/data/elements';
import { Genome, Pheno, Skeleton, SKELETONS, express, mulberry32, wildGenome } from '../../src/game/genome';
import { DrawOpts, Pose, drawCreature, shapesToSvg } from '../../src/render/creature';

const OUT = process.env.OUT ?? '/tmp/review/base/art';
mkdirSync(OUT, { recursive: true });
const BG = '#4a3d86';
const log: string[] = [];

function sheet(name: string, cols: number, cell: number, cells: { ph: Pheno; o: DrawOpts; label?: string; bg?: string }[], scale = 1) {
  const rows = Math.ceil(cells.length / cols);
  let out = '';
  cells.forEach((c, i) => {
    const x = (i % cols) * cell, y = Math.floor(i / cols) * cell;
    if (c.bg) out += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${c.bg}"/>`;
    out += shapesToSvg(drawCreature(c.ph, c.o), cell).replace('<svg ', `<svg x="${x}" y="${y}" `);
    if (c.label) out += `<text x="${x + 5}" y="${y + 15}" font-family="DejaVu Sans, sans-serif" font-size="${Math.max(10, cell * 0.06)}" fill="#fff" stroke="#000" stroke-width="0.5" paint-order="stroke">${c.label}</text>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * cell}" height="${rows * cell}"><rect width="100%" height="100%" fill="${BG}"/>${out}</svg>`;
  writeFileSync(`${OUT}/${name}.png`, new Resvg(svg, { fitTo: { mode: 'zoom', value: scale } }).render().asPng());
}

const describe = (id: string, ph: Pheno, stage: number) =>
  `${id} ${ph.skel} ${ph.el1}${ph.el2 ? '/' + ph.el2 : ''} st${stage} head:${ph.head} ears:${ph.ears} horns:${ph.horns} crest:${ph.crest} wings:${ph.wings} tail:${ph.tail} coat:${ph.coat} pat:${ph.pattern} two:${ph.twotone} tone:${ph.tone} eyes:${ph.eyes} mood:${ph.mood} feet:${ph.feet} shiny:${ph.shiny ? 1 : 0}`;

function wild(seed: number, sk: Skeleton): Genome {
  const g = wildGenome(mulberry32(seed), { els: ELEMENT_IDS, quality: 0.5, skels: [sk] });
  g.skel = [sk, sk];
  return g;
}

// 1. Sixteen fixed creatures per body plan, large, stages rotating adult / ancient / teen.
for (const sk of SKELETONS) {
  const cells = [];
  for (let i = 0; i < 16; i++) {
    const ph = express(wild(7000 + SKELETONS.indexOf(sk) * 100 + i, sk));
    const stage = [2, 3, 1, 2][i % 4];
    log.push(describe(`${sk}#${i}`, ph, stage));
    cells.push({ ph, o: { stage, phase: 0.1 }, label: `${i}` });
  }
  sheet(`plan_${sk}`, 4, 300, cells);
}

// 2. Every stage of one creature per body plan.
{
  const cells = [];
  for (const sk of SKELETONS) {
    const ph = express(wild(7050 + SKELETONS.indexOf(sk) * 100, sk));
    for (let st = 0; st < 5; st++) cells.push({ ph, o: { stage: st, phase: 0.1 }, label: `${sk} st${st}` });
  }
  sheet('stages', 5, 240, cells);
}

// 3. Roster-tile scale: what the player sees most. Drawn at 92 points, 2x pixels.
{
  const cells = [];
  for (let i = 0; i < 60; i++) {
    const sk = SKELETONS[i % 6];
    const ph = express(wild(9000 + i, sk));
    const stage = [1, 2, 2, 3, 0, 4][Math.floor(i / 6) % 6];
    log.push(describe(`small#${i}`, ph, stage));
    cells.push({ ph, o: { stage, phase: 0.1 }, label: `${i}` });
  }
  sheet('small', 10, 92, cells, 2);
}

// 4. Poses, fainted, and four walk phases for one creature per body plan (two of each plan).
const POSES: Pose[] = ['idle', 'blink', 'attack', 'cast', 'hurt', 'roar', 'happy', 'guard', 'dizzy'];
for (const pick of [0, 1]) {
  const cells = [];
  for (const sk of SKELETONS) {
    const ph = express(wild(7000 + SKELETONS.indexOf(sk) * 100 + (pick ? 5 : 2), sk));
    for (const pose of POSES) cells.push({ ph, o: { stage: 2, phase: 0.1, pose }, label: `${sk} ${pose}` });
    cells.push({ ph, o: { stage: 2, phase: 0.1, ko: true }, label: `${sk} ko` });
    for (const phase of [0, 0.25, 0.5, 0.75]) cells.push({ ph, o: { stage: 2, phase, walking: true }, label: `walk ${phase}` });
  }
  sheet(`poses_${pick}`, 14, 170, cells);
}

// 5. Babies and legendaries: the two ends, where proportions strain most.
for (const [name, stage] of [['babies', 0], ['legends', 4]] as const) {
  const cells = [];
  for (let i = 0; i < 24; i++) {
    const sk = SKELETONS[i % 6];
    const ph = express(wild(8000 + i, sk));
    log.push(describe(`${name}#${i}`, ph, stage));
    cells.push({ ph, o: { stage, phase: 0.1 }, label: `${i}` });
  }
  sheet(name, 6, 230, cells);
}

// 6. Shinies beside their ordinary selves.
{
  const cells = [];
  for (let i = 0; i < 12; i++) {
    const sk = SKELETONS[i % 6];
    const g = wild(8500 + i, sk);
    const plain = express({ ...g, shiny: [0, 0] });
    const shiny = express({ ...g, shiny: [1, 1] });
    cells.push({ ph: plain, o: { stage: 2, phase: 0.1 }, label: `${i}` }, { ph: shiny, o: { stage: 2, phase: 0.1 }, label: `${i} shiny` });
  }
  sheet('shiny', 6, 230, cells);
}

writeFileSync(`${OUT}/genes.txt`, log.join('\n'));
console.log('art sheets →', OUT);
