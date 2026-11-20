// Draws the app icon and splash image from the game's own art.
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';
import { STARTERS } from '../src/game/economy';
import { express, wildGenome, mulberry32 } from '../src/game/genome';
import { drawCreature, drawEgg, shapesToSvg } from '../src/render/creature';

const inner = (svg: string, x: number, y: number, s: number) => svg.replace('<svg ', `<svg x="${x}" y="${y}" `).replace(/width="\d+" height="\d+"/, `width="${s}" height="${s}"`);
const g = wildGenome(mulberry32(3), { els: ['wyrm'], quality: 0.9 });
g.el1 = ['wyrm', 'wyrm']; g.el2 = ['ember', 'ember']; g.pattern = ['stars', 'stars'];
const egg = shapesToSvg(drawEgg(express(g)).slice(1));
const pet = shapesToSvg(drawCreature(express(STARTERS[0].g), { stage: 0, shadow: false }));
const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><defs><radialGradient id="g" cx="50%" cy="42%" r="70%"><stop offset="0" stop-color="#5a44b8"/><stop offset="1" stop-color="#171226"/></radialGradient></defs><rect width="1024" height="1024" fill="url(#g)"/>${inner(egg, 120, 60, 660)}${inner(pet, 430, 400, 560)}</svg>`;
writeFileSync('assets/icon.png', new Resvg(icon).render().asPng());
const splash = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">${inner(egg, 40, 20, 330)}${inner(pet, 210, 200, 290)}</svg>`;
writeFileSync('assets/splash-icon.png', new Resvg(splash).render().asPng());
console.log('wrote icon and splash');
