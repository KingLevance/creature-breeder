// How high the top of a creature sits (in drawing units, smaller = taller) across stances, poses and a walk
// cycle: to check that strides still bob and guards still dip, and that squat builds stay lower than tall ones.
import { Resvg } from '@resvg/resvg-js';
import { ELEMENT_IDS } from '../../src/game/data/elements';
import { Skeleton, express, mulberry32, wildGenome } from '../../src/game/genome';
import { DrawOpts, drawCreature, shapesToSvg } from '../../src/render/creature';
function topOf(ph: any, o: DrawOpts): number {
  const svg = shapesToSvg(drawCreature(ph, { ...o, shadow: false } as DrawOpts), 200);
  const img = new Resvg(svg).render();
  const px = img.pixels, w = img.width, h = img.height;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 40) return +(y / 2).toFixed(1);
  return -1;
}
for (const sk of ['quad', 'multi'] as Skeleton[]) for (const [name, gw, ht] of [['normal', 0, 0], ['squat', 0, -2], ['bulky squat', 2, -2], ['lanky', 0, 2]] as [string, number, number][]) for (const stance of [0, 1, 2, 3]) {
  const g = wildGenome(mulberry32(4100), { els: ELEMENT_IDS, quality: 0.5, skels: [sk] });
  g.skel = [sk, sk]; g.girth = [gw, gw]; g.height = [ht, ht]; g.stance = [stance, stance];
  g.horns = ['none', 'none']; g.ears = ['none', 'none']; g.wings = ['none', 'none']; g.crest = ['none', 'none']; g.el1 = ['plain', 'plain']; g.el2 = ['none', 'none'];
  const ph = express(g);
  const row = [topOf(ph, { stage: 2, phase: 0.1 }), topOf(ph, { stage: 2, phase: 0.1, pose: 'guard' }), ...[0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875].map(phase => topOf(ph, { stage: 2, phase, walking: true }))];
  console.log(`${sk.padEnd(5)} ${name.padEnd(11)} stance${stance}  idle ${row[0]}  guard ${row[1]}  walk ${row.slice(2).join(' ')}`);
}
