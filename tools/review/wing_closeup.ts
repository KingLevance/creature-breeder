// Close-ups of cells from the wings sheet: npx tsx tools/review/wing_closeup.ts out.png <stage> r,c r,c ...
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';
import { ELEMENT_IDS, ElementId } from '../../src/game/data/elements';
import { SKELETONS, express, mulberry32, wildGenome } from '../../src/game/genome';
import { drawCreature, shapesToSvg } from '../../src/render/creature';
const WINGS = ['feather', 'bat', 'insect', 'flipper', 'fin', 'energy'];
const PAIRS: [ElementId, ElementId | 'none'][] = [['venom', 'spark'], ['glimmer', 'terra'], ['tide', 'none'], ['ember', 'frost'], ['verdant', 'none'], ['shade', 'radiant']];
const [out, st, ...cells] = process.argv.slice(2);
const cell = Number(process.env.CELL ?? 360), cols = Number(process.env.COLS ?? 4);
let svg = '';
cells.forEach((rc, n) => {
  const [r, c] = rc.split(',').map(Number);
  const sk = SKELETONS[r], w = WINGS[c];
  const g = wildGenome(mulberry32(3100 + r * 10 + c), { els: ELEMENT_IDS, quality: 0.5, skels: [sk] });
  const [e1, e2] = PAIRS[(r + c) % PAIRS.length];
  g.skel = [sk, sk]; g.el1 = [e1, e1]; g.el2 = [e2, e2]; g.wings = [w, w]; g.crest = ['none', 'none'];
  const x = (n % cols) * cell, y = Math.floor(n / cols) * cell;
  svg += shapesToSvg(drawCreature(express(g), { stage: Number(st), phase: 0.1 }), cell).replace('<svg ', `<svg x="${x}" y="${y}" `);
  svg += `<text x="${x + 6}" y="${y + 16}" font-family="DejaVu Sans, sans-serif" font-size="13" fill="#fff">#${r * 6 + c} ${sk} ${w} ${e1}${e2 !== 'none' ? '/' + e2 : ''}</text>`;
});
const rows = Math.ceil(cells.length / cols);
writeFileSync(out, new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${cols * cell}" height="${rows * cell}"><rect width="100%" height="100%" fill="#4a3d86"/>${svg}</svg>`).render().asPng());
