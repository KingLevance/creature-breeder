// Renders contact sheets of creatures to tools/shots/*.png so the art can be checked without a device.
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ELEMENT_IDS } from '../src/game/data/elements';
import { STARTERS } from '../src/game/economy';
import { PARTS, SKELETONS, express, mulberry32, wildGenome } from '../src/game/genome';
import { drawCreature, drawEgg, shapesToSvg } from '../src/render/creature';

const rng = mulberry32(7);
mkdirSync('tools/shots', { recursive: true });

function sheet(name: string, cells: { svg: string; label: string }[], cols: number, cell = 150) {
  const rows = Math.ceil(cells.length / cols);
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * cell}" height="${rows * (cell + 16)}"><rect width="100%" height="100%" fill="#f3efe6"/>`;
  cells.forEach((c, i) => {
    const x = (i % cols) * cell, y = Math.floor(i / cols) * (cell + 16);
    out += c.svg.replace('<svg ', `<svg x="${x}" y="${y}" `).replace(/width="\d+" height="\d+"/, `width="${cell}" height="${cell}"`);
    out += `<text x="${x + cell / 2}" y="${y + cell + 10}" font-size="10" font-family="sans-serif" text-anchor="middle" fill="#333">${c.label}</text>`;
  });
  out += '</svg>';
  writeFileSync(`tools/shots/${name}.png`, new Resvg(out).render().asPng());
  console.log('wrote tools/shots/' + name + '.png');
}

// 1. Every skeleton across the five life stages.
{
  const cells = [];
  for (const skel of SKELETONS) {
    const g = wildGenome(rng, { els: ['ember', 'tide', 'verdant', 'wyrm', 'frost', 'venom'], quality: 0.5, skels: [skel] });
    g.skel = [skel, skel];
    const ph = express(g);
    for (let st = 0; st < 5; st++) cells.push({ svg: shapesToSvg(drawCreature(ph, { stage: st, phase: 0.2 })), label: `${skel} ${ph.el1} s${st}` });
  }
  sheet('stages', cells, 5);
}
// 2. Every element on a rotating skeleton, as adults.
{
  const cells = ELEMENT_IDS.map((el, i) => {
    const skel = SKELETONS[i % 6];
    const g = wildGenome(rng, { els: [el], quality: 0.5, skels: [skel] });
    g.skel = [skel, skel]; g.el1 = [el, el]; g.el2 = ['none', 'none'];
    return { svg: shapesToSvg(drawCreature(express(g), { stage: 2, phase: 0.1 })), label: `${el} ${skel}` };
  });
  sheet('elements', cells, 5);
}
// 3. Part variety: wings, horns, tails, heads on one body each.
{
  const cells = [];
  for (const key of ['wings', 'horns', 'tail', 'head', 'eyes', 'pattern', 'tone'] as const) {
    for (const v of PARTS[key]) {
      const skel = key === 'wings' ? 'quad' : 'biped';
      const g = wildGenome(rng, { els: ['gale'], quality: 0.5 });
      g.skel = [skel, skel]; g.el1 = ['plain', 'plain']; g.el2 = ['none', 'none'];
      for (const k of ['wings', 'horns', 'tail', 'head', 'eyes', 'pattern', 'tone'] as const) g[k] = [PARTS[k][0], PARTS[k][0]];
      g.tail = ['long', 'long']; g[key] = [v, v];
      cells.push({ svg: shapesToSvg(drawCreature(express(g), { stage: 2 })), label: `${key}: ${v}` });
    }
  }
  sheet('parts', cells, 9, 120);
}
// 4. Starters, a walk cycle, random wild mixes, eggs.
{
  const cells = STARTERS.map(s => ({ svg: shapesToSvg(drawCreature(express(s.g), { stage: 0 })), label: s.name + ' (baby)' }));
  cells.push(...STARTERS.map(s => ({ svg: shapesToSvg(drawCreature(express(s.g), { stage: 2 })), label: s.name + ' (adult)' })));
  for (let i = 0; i < 4; i++) cells.push({ svg: shapesToSvg(drawCreature(express(STARTERS[2].g), { stage: 2, phase: i / 4, walking: true })), label: 'walk ' + i });
  for (let i = 0; i < 4; i++) cells.push({ svg: shapesToSvg(drawCreature(express(STARTERS[0].g), { stage: 2, phase: i / 4, walking: true })), label: 'walk ' + i });
  for (let i = 0; i < 16; i++) {
    const g = wildGenome(rng, { els: ELEMENT_IDS, quality: 0.6 });
    const ph = express(g);
    cells.push({ svg: shapesToSvg(drawCreature(ph, { stage: 1 + (i % 4), phase: 0.3 })), label: `${ph.el1}${ph.el2 ? '/' + ph.el2 : ''} ${ph.skel}` });
  }
  for (let i = 0; i < 6; i++) cells.push({ svg: shapesToSvg(drawEgg(express(wildGenome(rng, { els: ELEMENT_IDS, quality: 0.5 })))), label: 'egg' });
  sheet('mix', cells, 6);
}
