// Draws a creature from its visible traits as a flat list of shapes in a 100x100 box, facing right.
// Pure: no React, no SVG library. The app turns the shapes into react-native-svg nodes, and the
// tools turn them into an SVG string, so the same drawing code feeds every screen.
import { ELEMENTS, ElementId } from '../game/data/elements';
import type { Pheno } from '../game/genome';

export type Shape =
  | { t: 'path'; d: string; fill?: string; stroke?: string; sw?: number; op?: number }
  | { t: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill?: string; stroke?: string; sw?: number; op?: number; rot?: number }
  | { t: 'circle'; cx: number; cy: number; r: number; fill?: string; stroke?: string; sw?: number; op?: number };

// ---------- Colour helpers
function hexToHsl(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  const r = ((v >> 16) & 255) / 255, g = ((v >> 8) & 255) / 255, b = (v & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (q: number) => Math.round((q + m) * 255).toString(16).padStart(2, '0');
  return '#' + to(r) + to(g) + to(b);
}
export function shade(hex: string, dl: number, ds = 0, dh = 0): string {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex(h + dh, s + ds, l + dl);
}
function mix(a: string, b: string, t: number): string {
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
  const ch = (sh: number) => Math.round(((x >> sh) & 255) * (1 - t) + ((y >> sh) & 255) * t).toString(16).padStart(2, '0');
  return '#' + ch(16) + ch(8) + ch(0);
}

export interface Palette { base: string; light: string; dark: string; glow: string; accent: string; accentDark: string; out: string }

export function paletteFor(ph: Pheno): Palette {
  const e = ELEMENTS[ph.el1];
  const tone = (c: string): string => {
    switch (ph.tone) {
      case 'pale': return shade(c, 0.12, -0.15);
      case 'deep': return shade(c, -0.1, 0.12);
      case 'warm': return shade(c, 0, 0, 16);
      case 'cool': return shade(c, 0, 0, -16);
      case 'ashen': return shade(c, 0.02, -0.45);
      case 'gilded': return mix(c, '#e8b93c', 0.35);
      case 'melanic': return shade(c, -0.24, -0.1);
      case 'albino': return shade(c, 0.3, -0.5);
      default: return c;
    }
  };
  const base = tone(e.base);
  const acc = ph.el2 ? ELEMENTS[ph.el2].base : tone(e.light);
  return { base, light: tone(e.light), dark: tone(e.dark), glow: e.glow, accent: acc, accentDark: shade(acc, -0.18), out: shade(tone(e.dark), -0.14) };
}

// ---------- Drawing helpers
const f = (v: number) => (Math.round(v * 10) / 10).toString();
const TAU = Math.PI * 2;

/** Draw order of the layers. Within a layer every outline is drawn first and every fill after, so shapes that
 * overlap inside one layer merge into one silhouette with no seam where they join. Parts that sit in front of the
 * body (a near arm, a near wing) go in a later layer, so they keep a line where they cross it. */
const LAYERS = ['aura', 'back', 'body', 'front', 'face', 'fx'] as const;
type Layer = (typeof LAYERS)[number];
/** Outline width. Only the outer half shows, because the fill covers the inner half. */
const OW = 2.4;

interface Item { g: Layer; out?: Shape; fill: Shape }

class Pen {
  items: Item[] = [];
  g: Layer = 'body';
  constructor(public pal: Palette) {}
  private add(fill: Shape, out?: Shape) { this.items.push({ g: this.g, fill, out }); }
  ell(cx: number, cy: number, rx: number, ry: number, fill: string, o: { rot?: number; op?: number; line?: boolean } = {}) {
    const base = { t: 'ellipse' as const, cx, cy, rx: Math.max(0.1, rx), ry: Math.max(0.1, ry), rot: o.rot, op: o.op };
    if (o.line === false) return this.add({ ...base, fill });
    // See-through parts can't hide an outline under their fill, so they keep a plain stroke.
    if (o.op != null && o.op < 1) return this.add({ ...base, fill, stroke: this.pal.out, sw: 1.2 });
    this.add({ ...base, fill }, { ...base, op: undefined, fill: this.pal.out, stroke: this.pal.out, sw: OW });
  }
  dot(cx: number, cy: number, r: number, fill: string, op?: number) {
    this.add({ t: 'circle', cx, cy, r: Math.max(0.1, r), fill, op });
  }
  /** A filled shape gets a merged outline; an unfilled path is a line drawn on top (a stripe, a mouth). */
  path(d: string, fill: string | undefined, o: { stroke?: string; sw?: number; op?: number; line?: boolean } = {}) {
    const filled = fill !== undefined && fill !== 'none';
    if (!filled || o.line === false || o.stroke) return this.add({ t: 'path', d, fill: fill ?? 'none', stroke: o.stroke, sw: o.sw, op: o.op });
    if (o.op != null && o.op < 1) return this.add({ t: 'path', d, fill, stroke: this.pal.out, sw: 1.2, op: o.op });
    this.add({ t: 'path', d, fill }, { t: 'path', d, fill: this.pal.out, stroke: this.pal.out, sw: OW });
  }
  /** A thick stroked path (a limb, a serpent's body) with an outline around it. */
  stroke(d: string, w: number, color: string, extra = OW) {
    this.add({ t: 'path', d, fill: 'none', stroke: color, sw: w }, { t: 'path', d, fill: 'none', stroke: this.pal.out, sw: w + extra });
  }
  /** A thin coloured line with no outline. */
  line(d: string, color: string, w: number, op?: number) { this.add({ t: 'path', d, fill: 'none', stroke: color, sw: w, op }); }
  ring(cx: number, cy: number, rx: number, ry: number, color: string, w: number, op?: number) {
    this.add({ t: 'ellipse', cx, cy, rx, ry, fill: 'none', stroke: color, sw: w, op });
  }
  limb(x1: number, y1: number, x2: number, y2: number, w: number, color: string, kx?: number, ky?: number) {
    const d = kx == null ? `M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}` : `M${f(x1)} ${f(y1)}Q${f(kx)} ${f(ky!)} ${f(x2)} ${f(y2)}`;
    this.stroke(d, w, color);
  }
  poly(pts: number[][], fill: string, o: { op?: number; line?: boolean } = {}) {
    this.path('M' + pts.map(p => f(p[0]) + ' ' + f(p[1])).join('L') + 'Z', fill, o);
  }
  shapes(): Shape[] {
    const out: Shape[] = [];
    for (const g of LAYERS) {
      const its = this.items.filter(i => i.g === g);
      for (const i of its) if (i.out) out.push(i.out);
      for (const i of its) out.push(i.fill);
    }
    return out;
  }
}

const STAGE = [
  { head: 1.3, body: 0.8, limb: 0.72, feat: 0.42, cue: 0.3 },
  { head: 1.14, body: 0.92, limb: 0.9, feat: 0.72, cue: 0.65 },
  { head: 1, body: 1, limb: 1, feat: 1, cue: 1 },
  { head: 1, body: 1.03, limb: 1, feat: 1.16, cue: 1.1 },
  { head: 1, body: 1.05, limb: 1, feat: 1.28, cue: 1.2 },
];

interface Anchors {
  hx: number; hy: number; hr: number;
  bx: number; by: number; brx: number; bry: number;
  tx: number; ty: number; tdir: number;
  wx: number; wy: number;
  backx: number; backy: number;
}

export interface DrawOpts {
  /** Life stage 0..4. */
  stage: number;
  /** Walk-cycle phase 0..1. */
  phase?: number;
  walking?: boolean;
  shadow?: boolean;
  /** Fainted: X eyes. */
  ko?: boolean;
  /** A momentary expression or action. */
  pose?: Pose;
}

export type Pose = 'idle' | 'blink' | 'attack' | 'cast' | 'hurt';

function star(p: Pen, x: number, y: number, r: number, fill: string, op = 1) {
  const q = r * 0.3;
  p.path(`M${f(x)} ${f(y - r)}L${f(x + q)} ${f(y - q)}L${f(x + r)} ${f(y)}L${f(x + q)} ${f(y + q)}L${f(x)} ${f(y + r)}L${f(x - q)} ${f(y + q)}L${f(x - r)} ${f(y)}L${f(x - q)} ${f(y - q)}Z`, fill, { line: false, op });
}

function flame(p: Pen, x: number, y: number, r: number, c1: string, c2: string) {
  p.path(`M${f(x - r * 0.6)} ${f(y + r * 0.5)}Q${f(x - r * 1.1)} ${f(y - r * 0.4)} ${f(x - r * 0.3)} ${f(y - r * 0.6)}Q${f(x - r * 0.4)} ${f(y - r * 1.2)} ${f(x + r * 0.1)} ${f(y - r * 1.6)}Q${f(x + r * 0.9)} ${f(y - r * 0.6)} ${f(x + r * 0.6)} ${f(y + r * 0.5)}Q${f(x)} ${f(y + r)} ${f(x - r * 0.6)} ${f(y + r * 0.5)}Z`, c1);
  p.path(`M${f(x - r * 0.25)} ${f(y + r * 0.4)}Q${f(x - r * 0.5)} ${f(y - r * 0.2)} ${f(x)} ${f(y - r * 0.8)}Q${f(x + r * 0.45)} ${f(y - r * 0.1)} ${f(x + r * 0.25)} ${f(y + r * 0.4)}Z`, c2, { line: false });
}

function drawTail(p: Pen, a: Anchors, ph: Pheno, k: number, sway: number) {
  const { tx, ty } = a;
  const c = p.pal;
  let len = (ph.tail === 'stub' ? 5 : ph.tail === 'whip' ? 26 : 19) * k;
  // Keep the tail inside the drawing box, or it gets cut off flat at the edge. How far past its end each tip reaches:
  const tip = { fan: 10.5, plume: 7, club: 7, tuft: 6, whip: 2.5, long: 4, stinger: 3, stub: 0 }[ph.tail as 'fan'] ?? 4;
  const room = tx - 2 - tip * k;
  // Running out of room: curl the tail upward first, and only shorten it if curling isn't enough.
  let tdir = a.tdir;
  if (len * Math.cos(tdir) > room) {
    tdir = Math.min(1.25, Math.max(tdir, Math.acos(Math.max(0, Math.min(1, room / len)))));
    if (len * Math.cos(tdir) > room) len = Math.max(4, room / Math.cos(tdir));
  }
  // The tail leaves the body pointing back (left) and curls up a little.
  const ex = tx - len * Math.cos(tdir), ey = ty - len * Math.sin(tdir) + sway;
  const kx = tx - len * 0.6 * Math.cos(tdir) / Math.cos(a.tdir || 0.01), ky = ty + 4 * k;
  const w = ph.tail === 'whip' ? 2.4 : 5 * Math.max(0.6, k);
  if (ph.tail === 'stub') { p.ell(tx - 2, ty, 4.5 * Math.max(0.7, k), 3.6 * Math.max(0.7, k), c.base); return; }
  if (ph.tail === 'stinger') {
    const sx = tx - 6 * k, sy = ty - 20 * k + sway;
    p.limb(tx, ty, sx, sy, w, c.base, tx - 16 * k, ty - 8 * k);
    p.poly([[sx - 3 * k, sy + 1], [sx + 2 * k, sy - 2 * k], [sx + 7 * k, sy + 4 * k]], c.accentDark);
    return;
  }
  p.limb(tx, ty, ex, ey, w, c.base, kx, ky);
  if (ph.tail === 'tuft') p.ell(ex, ey, 5 * k, 4.4 * k, c.accent);
  if (ph.tail === 'club') p.ell(ex, ey, 6 * k, 5.4 * k, c.dark);
  if (ph.tail === 'fan') p.poly([[ex + 2, ey], [ex - 8 * k, ey - 8 * k], [ex - 10 * k, ey], [ex - 8 * k, ey + 7 * k]], c.accent);
  if (ph.tail === 'plume') flame(p, ex - 1, ey - 1, 5.5 * k, c.accent, c.glow);
}

function drawWing(p: Pen, a: Anchors, ph: Pheno, k: number, flap: number, far: boolean) {
  if (ph.wings === 'none') return;
  const was = p.g;
  p.g = far ? 'back' : 'front';
  drawWingShape(p, a, ph, k, flap, far);
  p.g = was;
}

function drawWingShape(p: Pen, a: Anchors, ph: Pheno, k: number, flap: number, far: boolean) {
  const c = p.pal;
  const x = a.wx + (far ? 4 : 0), y = a.wy + (far ? -1 : 0);
  const up = flap * 7 * k;
  const col = far ? c.accentDark : c.accent;
  switch (ph.wings) {
    case 'feather': {
      const tipx = x - 24 * k, tipy = y - 16 * k - up;
      p.path(`M${f(x)} ${f(y)}Q${f(x - 8 * k)} ${f(y - 20 * k - up)} ${f(tipx)} ${f(tipy)}Q${f(x - 20 * k)} ${f(y - 6 * k - up * 0.5)} ${f(x - 22 * k)} ${f(y - 2 * k)}Q${f(x - 15 * k)} ${f(y - 1 * k)} ${f(x - 16 * k)} ${f(y + 4 * k)}Q${f(x - 9 * k)} ${f(y + 2 * k)} ${f(x - 8 * k)} ${f(y + 7 * k)}Q${f(x - 3 * k)} ${f(y + 5 * k)} ${f(x)} ${f(y)}Z`, col);
      break;
    }
    case 'bat': {
      const tx = x - 26 * k, ty = y - 18 * k - up;
      p.path(`M${f(x)} ${f(y)}L${f(tx)} ${f(ty)}Q${f(x - 20 * k)} ${f(y - 8 * k)} ${f(x - 22 * k)} ${f(y + 1 * k)}Q${f(x - 15 * k)} ${f(y - 3 * k)} ${f(x - 13 * k)} ${f(y + 6 * k)}Q${f(x - 7 * k)} ${f(y)} ${f(x - 3 * k)} ${f(y + 7 * k)}Z`, col);
      p.path(`M${f(x)} ${f(y)}L${f(x - 22 * k)} ${f(y + 1 * k)}M${f(x)} ${f(y)}L${f(x - 13 * k)} ${f(y + 6 * k)}`, 'none', { stroke: c.out, sw: 0.9 });
      break;
    }
    case 'insect':
      p.ell(x - 10 * k, y - 10 * k - up, 13 * k, 5.5 * k, c.light, { rot: 35 + flap * 12, op: far ? 0.45 : 0.7 });
      if (!far) p.ell(x - 9 * k, y - 2 * k - up * 0.5, 10 * k, 4.2 * k, c.light, { rot: 12 + flap * 8, op: 0.6 });
      break;
    case 'flipper':
      p.ell(x - 6 * k, y + 8 * k - up * 0.6, 5 * k, 11 * k, far ? c.dark : shade(c.base, -0.06), { rot: 24 - flap * 14 });
      break;
    case 'fin':
      if (!far) p.path(`M${f(x + 6 * k)} ${f(y + 1)}Q${f(x - 2 * k)} ${f(y - 18 * k - up * 0.4)} ${f(x - 12 * k)} ${f(y - 14 * k)}Q${f(x - 8 * k)} ${f(y - 4 * k)} ${f(x - 12 * k)} ${f(y + 2)}Z`, col);
      break;
    case 'energy':
      for (let i = 0; i < 3; i++) {
        const ang = 0.5 + i * 0.5 + flap * 0.15, r = (22 - i * 4) * k;
        const ex = x - Math.cos(ang) * r, ey = y - Math.sin(ang) * r - up * 0.5;
        p.poly([[x - 1, y - 1], [ex + 3 * k, ey - 2 * k], [ex, ey], [ex + 1 * k, ey + 4 * k]], c.glow, { op: far ? 0.35 : 0.75, line: false });
      }
      break;
  }
}

function drawHorns(p: Pen, a: Anchors, ph: Pheno, k: number) {
  const c = p.pal;
  const { hx, hy, hr } = a;
  const top = hy - hr * 0.82;
  const bone = mix(c.light, '#fff6dc', 0.5);
  switch (ph.horns) {
    case 'nubs':
      p.ell(hx - hr * 0.35, top, 2.6 * k + 0.8, 3.4 * k + 0.8, bone, { rot: -15 });
      p.ell(hx + hr * 0.3, top + 0.5, 2.6 * k + 0.8, 3.4 * k + 0.8, bone, { rot: 15 });
      break;
    case 'curved':
      for (const s of [-1, 1]) {
        const bx = hx + s * hr * 0.32 - hr * 0.05;
        p.path(`M${f(bx - 2.4 * k)} ${f(top + 2)}Q${f(bx - 9 * k)} ${f(top - 9 * k)} ${f(bx - 3 * k + s * 2)} ${f(top - 15 * k)}Q${f(bx - 2 * k)} ${f(top - 7 * k)} ${f(bx + 2.6 * k)} ${f(top + 2)}Z`, bone);
      }
      break;
    case 'spike':
      p.poly([[hx + hr * 0.15, top + 2], [hx + hr * 0.55, top - 15 * k], [hx + hr * 0.75, top + 5]], bone);
      break;
    case 'antenna':
      for (const s of [-1, 1]) {
        const ex = hx + s * 4 * k + 6 * k, ey = top - 14 * k;
        p.path(`M${f(hx + s * 3)} ${f(top + 2)}Q${f(hx + s * 3)} ${f(top - 8 * k)} ${f(ex)} ${f(ey)}`, 'none', { stroke: c.out, sw: 1.3 });
        p.dot(ex, ey, 1.8 * k + 0.6, c.accent);
      }
      break;
    case 'antlers':
      for (const s of [-1, 1]) {
        const bx = hx + s * hr * 0.35;
        p.stroke(`M${f(bx)} ${f(top + 2)}L${f(bx + s * 3 * k)} ${f(top - 9 * k)}L${f(bx + s * 8 * k)} ${f(top - 13 * k)}M${f(bx + s * 3 * k)} ${f(top - 9 * k)}L${f(bx - s * 1 * k)} ${f(top - 15 * k)}M${f(bx + s * 1.5 * k)} ${f(top - 4 * k)}L${f(bx + s * 7 * k)} ${f(top - 5 * k)}`, 1.8 * Math.max(0.6, k), bone, 1.8);
      }
      break;
    case 'crown':
      p.poly([[hx - hr * 0.55, top + 3], [hx - hr * 0.6, top - 8 * k], [hx - hr * 0.2, top - 2 * k], [hx + hr * 0.05, top - 12 * k], [hx + hr * 0.3, top - 2 * k], [hx + hr * 0.65, top - 8 * k], [hx + hr * 0.6, top + 3]], c.glow);
      break;
    case 'crystal':
      p.poly([[hx - hr * 0.4, top + 3], [hx - hr * 0.55, top - 7 * k], [hx - hr * 0.2, top - 13 * k], [hx, top + 1]], c.glow, { op: 0.9 });
      p.poly([[hx + hr * 0.05, top + 2], [hx + hr * 0.3, top - 16 * k], [hx + hr * 0.6, top - 6 * k], [hx + hr * 0.5, top + 4]], mix(c.glow, c.light, 0.4), { op: 0.9 });
      break;
  }
}

function drawEyes(p: Pen, x: number, y: number, r: number, ph: Pheno, ko = false, pose: Pose = 'idle') {
  const c = p.pal;
  if (!ko && (pose === 'blink' || pose === 'hurt')) {
    // Closed eyes for a blink; squeezed shut (> <) when hurt.
    const shut = (ex: number, ey: number, er: number, side: number) => {
      const k = er * 0.85, w = Math.max(1.1, er * 0.4);
      if (pose === 'blink') p.line(`M${f(ex - k)} ${f(ey)}Q${f(ex)} ${f(ey + k * 0.6)} ${f(ex + k)} ${f(ey)}`, c.out, w);
      else p.line(`M${f(ex - k * side)} ${f(ey - k * 0.7)}L${f(ex + k * 0.5 * side)} ${f(ey)}L${f(ex - k * side)} ${f(ey + k * 0.7)}`, c.out, w);
    };
    if (ph.eyes === 'multi') { shut(x + r * 0.18, y - r * 0.12, r * 0.2, 1); shut(x + r * 0.56, y - r * 0.2, r * 0.17, -1); shut(x + r * 0.42, y + r * 0.14, r * 0.13, -1); shut(x - r * 0.12, y - r * 0.3, r * 0.13, 1); }
    else { shut(x + r * 0.08, y - r * 0.1, r * 0.24, 1); shut(x + r * 0.6, y - r * 0.1, r * 0.2, -1); }
    return;
  }
  if (ko) {
    // Knocked out: an X for each eye.
    const xEye = (ex: number, ey: number, er: number) => {
      const k = er * 0.95, w = Math.max(1.3, er * 0.5);
      p.line(`M${f(ex - k)} ${f(ey - k)}L${f(ex + k)} ${f(ey + k)}M${f(ex + k)} ${f(ey - k)}L${f(ex - k)} ${f(ey + k)}`, c.out, w);
    };
    if (ph.eyes === 'multi') { xEye(x + r * 0.18, y - r * 0.12, r * 0.2); xEye(x + r * 0.56, y - r * 0.2, r * 0.17); xEye(x + r * 0.42, y + r * 0.14, r * 0.13); xEye(x - r * 0.12, y - r * 0.3, r * 0.13); }
    else { xEye(x + r * 0.08, y - r * 0.1, r * 0.24); xEye(x + r * 0.6, y - r * 0.1, r * 0.2); }
    return;
  }
  const glowy = ph.eyes === 'glow' || ph.el1 === 'shade' || ph.el1 === 'void' || ph.el1 === 'spirit';
  const white = glowy ? c.glow : '#ffffff';
  const pupil = glowy ? shade(c.glow, 0.2) : '#1b1420';
  const eye = (ex: number, ey: number, er: number) => {
    if (ph.eyes === 'slit') { p.ell(ex, ey, er, er * 0.92, white); p.ell(ex + er * 0.15, ey, er * 0.22, er * 0.75, pupil, { line: false }); return; }
    p.ell(ex, ey, er, er, white);
    if (!glowy) { p.dot(ex + er * 0.25, ey + er * 0.05, er * 0.55, pupil); p.dot(ex + er * 0.05, ey - er * 0.25, er * 0.2, '#ffffff'); }
    if (ph.eyes === 'sleepy') p.path(`M${f(ex - er - 0.4)} ${f(ey - er * 0.1)}Q${f(ex)} ${f(ey - er * 1.5)} ${f(ex + er + 0.4)} ${f(ey - er * 0.1)}Z`, c.base);
  };
  const big = ph.eyes === 'big' ? 1.3 : ph.eyes === 'sleepy' ? 1.05 : 1;
  if (ph.eyes === 'multi') {
    eye(x + r * 0.18, y - r * 0.12, r * 0.2); eye(x + r * 0.56, y - r * 0.2, r * 0.17); eye(x + r * 0.42, y + r * 0.14, r * 0.13); eye(x - r * 0.12, y - r * 0.3, r * 0.13);
  } else {
    eye(x + r * 0.08, y - r * 0.1, r * 0.24 * big);
    eye(x + r * 0.6, y - r * 0.1, r * 0.2 * big);
  }
}

function drawHead(p: Pen, a: Anchors, ph: Pheno, feat: number, ko = false, pose: Pose = 'idle') {
  const c = p.pal;
  const { hx, hy, hr: r } = a;
  drawHorns(p, a, ph, feat);
  if (ph.head === 'eared') {
    p.poly([[hx - r * 0.85, hy - r * 0.3], [hx - r * 0.75, hy - r * 1.45], [hx - r * 0.1, hy - r * 0.8]], c.base);
    p.poly([[hx + r * 0.1, hy - r * 0.8], [hx + r * 0.6, hy - r * 1.5], [hx + r * 0.85, hy - r * 0.45]], c.base);
    p.poly([[hx + r * 0.3, hy - r * 0.8], [hx + r * 0.58, hy - r * 1.25], [hx + r * 0.72, hy - r * 0.6]], c.accent, { line: false });
  }
  if (ph.head === 'frill') {
    p.path(`M${f(hx - r * 0.2)} ${f(hy - r * 0.9)}L${f(hx - r * 1.2)} ${f(hy - r * 1.3)}L${f(hx - r * 0.9)} ${f(hy - r * 0.5)}L${f(hx - r * 1.6)} ${f(hy - r * 0.3)}L${f(hx - r * 0.95)} ${f(hy + r * 0.2)}L${f(hx - r * 1.4)} ${f(hy + r * 0.75)}L${f(hx - r * 0.3)} ${f(hy + r * 0.7)}Z`, c.accent);
  }
  switch (ph.head) {
    case 'snout':
      p.ell(hx, hy, r, r * 0.95, c.base);
      p.ell(hx + r * 0.72, hy + r * 0.3, r * 0.6, r * 0.42, c.light);
      p.dot(hx + r * 1.15, hy + r * 0.18, r * 0.11, c.out);
      break;
    case 'beak':
      p.ell(hx, hy, r, r * 0.95, c.base);
      p.poly([[hx + r * 0.7, hy - r * 0.05], [hx + r * 1.65, hy + r * 0.3], [hx + r * 0.7, hy + r * 0.6]], '#f0b54a');
      break;
    case 'blunt':
      p.path(`M${f(hx - r)} ${f(hy - r * 0.5)}Q${f(hx - r)} ${f(hy - r)} ${f(hx - r * 0.4)} ${f(hy - r)}L${f(hx + r * 0.6)} ${f(hy - r)}Q${f(hx + r * 1.15)} ${f(hy - r)} ${f(hx + r * 1.15)} ${f(hy - r * 0.4)}L${f(hx + r * 1.15)} ${f(hy + r * 0.45)}Q${f(hx + r * 1.15)} ${f(hy + r * 0.95)} ${f(hx + r * 0.6)} ${f(hy + r * 0.95)}L${f(hx - r * 0.4)} ${f(hy + r * 0.95)}Q${f(hx - r)} ${f(hy + r * 0.95)} ${f(hx - r)} ${f(hy + r * 0.4)}Z`, c.base);
      p.path(`M${f(hx + r * 0.2)} ${f(hy + r * 0.55)}L${f(hx + r * 1.1)} ${f(hy + r * 0.55)}`, 'none', { stroke: c.out, sw: 1.1 });
      break;
    case 'long':
      p.ell(hx + r * 0.25, hy + r * 0.05, r * 1.3, r * 0.78, c.base);
      p.dot(hx + r * 1.3, hy - r * 0.1, r * 0.1, c.out);
      break;
    case 'skull':
      p.ell(hx, hy, r, r * 0.95, c.base);
      p.ell(hx + r * 0.3, hy + r * 0.05, r * 0.78, r * 0.74, '#f1ead8');
      break;
    default:
      p.ell(hx, hy, r, r * 0.95, c.base);
  }
  if (ph.pattern === 'mask') p.ell(hx + r * 0.32, hy - r * 0.1, r * 0.62, r * 0.36, c.dark, { line: false, op: 0.75 });
  p.g = 'face';
  drawEyes(p, hx, hy, r, ph, ko, pose);
  const open = !ko && (pose === 'attack' || pose === 'cast' || pose === 'hurt');
  if (ko) {
    // Knocked out: a dazed, wavy mouth instead of a smile.
    const mx = ph.head === 'beak' || ph.head === 'long' ? hx + r * 0.75 : ph.head === 'snout' ? hx + r * 0.75 : hx + r * 0.5;
    const my = hy + r * 0.5, w = r * 0.22;
    p.line(`M${f(mx - w * 1.5)} ${f(my)}q${f(w * 0.37)} ${f(-w * 0.45)} ${f(w * 0.75)} 0q${f(w * 0.37)} ${f(w * 0.45)} ${f(w * 0.75)} 0q${f(w * 0.37)} ${f(-w * 0.45)} ${f(w * 0.75)} 0q${f(w * 0.37)} ${f(w * 0.45)} ${f(w * 0.75)} 0`, c.out, Math.max(1, r * 0.09));
  } else if (open) {
    // Open mouth: a roar for attacks and casts, a gasp when hurt.
    const mx = ph.head === 'beak' ? hx + r * 1.0 : ph.head === 'long' ? hx + r * 1.0 : ph.head === 'snout' ? hx + r * 0.95 : hx + r * 0.55;
    const my = ph.head === 'beak' ? hy + r * 0.5 : hy + r * 0.48;
    const mr = pose === 'hurt' ? r * 0.14 : pose === 'attack' ? r * 0.3 : r * 0.22;
    p.ell(mx, my, mr, mr * (pose === 'hurt' ? 1 : 0.8), '#3a1626');
    if (pose !== 'hurt') p.ell(mx, my + mr * 0.35, mr * 0.55, mr * 0.3, '#e0677a', { line: false });
  } else if (ph.head !== 'beak' && ph.head !== 'blunt') p.path(`M${f(hx + r * 0.25)} ${f(hy + r * 0.42)}Q${f(hx + r * 0.5)} ${f(hy + r * 0.62)} ${f(hx + r * 0.78)} ${f(hy + r * 0.4)}`, 'none', { stroke: c.out, sw: 1.1 });
}

function drawPattern(p: Pen, a: Anchors, ph: Pheno) {
  const c = p.pal;
  const { bx, by, brx, bry } = a;
  switch (ph.pattern) {
    case 'belly': p.ell(bx + brx * 0.1, by + bry * 0.38, brx * 0.68, bry * 0.5, c.light, { line: false }); break;
    case 'spots':
      p.dot(bx - brx * 0.4, by - bry * 0.25, bry * 0.2, c.dark, 0.7); p.dot(bx + brx * 0.05, by - bry * 0.45, bry * 0.15, c.dark, 0.7);
      p.dot(bx - brx * 0.1, by + bry * 0.2, bry * 0.17, c.dark, 0.7); p.dot(bx + brx * 0.45, by - bry * 0.1, bry * 0.13, c.dark, 0.7);
      break;
    case 'stripes':
      for (const t of [-0.45, -0.05, 0.35]) p.path(`M${f(bx + brx * t)} ${f(by - bry * 0.8)}Q${f(bx + brx * (t + 0.14))} ${f(by - bry * 0.3)} ${f(bx + brx * (t - 0.02))} ${f(by + bry * 0.05)}`, 'none', { stroke: c.dark, sw: 2.2, op: 0.8 });
      break;
    case 'bands':
      // Each band is a slice of the body ellipse, so its ends follow the body's curve instead of poking out.
      for (const t of [-0.35, 0.3]) {
        const dt = Math.max(2.5, brx * 0.2) / 2 / brx;
        const top: string[] = [], bot: string[] = [];
        for (let k = 0; k <= 6; k++) {
          const tt = t - dt + (2 * dt * k) / 6;
          const h = bry * Math.sqrt(Math.max(0, 1 - tt * tt)) * 0.96;
          top.push(`${f(bx + brx * tt)} ${f(by - h)}`);
          bot.unshift(`${f(bx + brx * tt)} ${f(by + h)}`);
        }
        p.path('M' + top.join('L') + 'L' + bot.join('L') + 'Z', c.accentDark, { line: false, op: 0.85 });
      }
      break;
    case 'stars':
      star(p, bx - brx * 0.35, by - bry * 0.2, bry * 0.26, c.glow); star(p, bx + brx * 0.2, by + bry * 0.15, bry * 0.2, c.glow); star(p, bx + brx * 0.1, by - bry * 0.5, bry * 0.15, c.glow);
      break;
  }
}

/** Element look cues. A baby shows only a hint; the full markings arrive with maturity. */
function drawCues(p: Pen, a: Anchors, el: ElementId, k: number, phase: number, minor: boolean) {
  const c = p.pal;
  const e = ELEMENTS[el];
  const s = k * (minor ? 0.7 : 1);
  const { hx, hy, hr, bx, by, brx, bry, backx, backy } = a;
  switch (el) {
    case 'ember': flame(p, backx - 1, backy - 1, 5 * s, e.base, e.glow); if (!minor) flame(p, backx + brx * 0.45, backy - 0.5, 3.4 * s, e.light, e.glow); break;
    case 'tide':
      p.path(`M${f(backx - 7 * s)} ${f(backy + 2)}Q${f(backx - 4 * s)} ${f(backy - 8 * s)} ${f(backx)} ${f(backy - 1)}Q${f(backx + 3 * s)} ${f(backy - 9 * s)} ${f(backx + 7 * s)} ${f(backy + 1)}Z`, e.light);
      p.path(`M${f(bx + brx * 0.9)} ${f(by + bry * 0.9)}q${f(1.6 * s)} ${f(3 * s)} 0 ${f(4.4 * s)}q${f(-1.6 * s)} ${f(-1.4 * s)} 0 ${f(-4.4 * s)}Z`, e.glow, { line: false, op: 0.9 });
      break;
    case 'verdant':
      p.path(`M${f(hx - hr * 0.1)} ${f(hy - hr * 0.9)}Q${f(hx - 7 * s)} ${f(hy - hr - 9 * s)} ${f(hx + 1 * s)} ${f(hy - hr - 12 * s)}Q${f(hx + 6 * s)} ${f(hy - hr - 5 * s)} ${f(hx - hr * 0.1)} ${f(hy - hr * 0.9)}Z`, e.base);
      p.path(`M${f(backx - 4 * s)} ${f(backy + 1)}Q${f(backx - 9 * s)} ${f(backy - 6 * s)} ${f(backx - 2 * s)} ${f(backy - 8 * s)}Q${f(backx + 1 * s)} ${f(backy - 3 * s)} ${f(backx - 4 * s)} ${f(backy + 1)}Z`, e.light);
      break;
    case 'spark':
      p.poly([[backx - 2 * s, backy - 10 * s], [backx + 3 * s, backy - 10 * s], [backx, backy - 5 * s], [backx + 4 * s, backy - 5 * s], [backx - 3 * s, backy + 3 * s], [backx - 1 * s, backy - 3 * s], [backx - 5 * s, backy - 3 * s]], e.base);
      if (!minor) p.poly([[bx + brx * 0.2, by - bry * 0.1], [bx + brx * 0.45, by - bry * 0.1], [bx + brx * 0.3, by + bry * 0.2], [bx + brx * 0.5, by + bry * 0.2], [bx + brx * 0.15, by + bry * 0.7], [bx + brx * 0.25, by + bry * 0.3], [bx + brx * 0.05, by + bry * 0.3]], e.light, { line: false });
      break;
    case 'frost':
      p.poly([[backx - 7 * s, backy + 2], [backx - 5 * s, backy - 9 * s], [backx - 1 * s, backy + 1]], e.light, { op: 0.95 });
      p.poly([[backx - 1 * s, backy + 1], [backx + 3 * s, backy - 12 * s], [backx + 6 * s, backy + 1]], e.glow, { op: 0.95 });
      break;
    case 'brawn':
      p.path(`M${f(bx - brx * 0.1)} ${f(by - bry * 0.55)}L${f(bx + brx * 0.25)} ${f(by - bry * 0.1)}M${f(bx + brx * 0.05)} ${f(by - bry * 0.6)}L${f(bx + brx * 0.4)} ${f(by - bry * 0.15)}`, 'none', { stroke: e.dark, sw: 1.3 * Math.max(0.7, s) });
      p.path(`M${f(hx - hr * 0.75)} ${f(hy - hr * 0.5)}L${f(hx + hr * 0.75)} ${f(hy - hr * 0.62)}`, 'none', { stroke: '#f5f0e6', sw: 2.4 * Math.max(0.6, s) });
      break;
    case 'venom':
      for (const t of [0.2, 0.5, 0.75]) p.path(`M${f(bx - brx * 0.6 + brx * 1.2 * t)} ${f(by + bry * 0.85)}q${f(1.5 * s)} ${f(3.5 * s)} 0 ${f(5 * s)}q${f(-1.5 * s)} ${f(-1.5 * s)} 0 ${f(-5 * s)}Z`, e.glow, { line: false });
      p.poly([[hx + hr * 0.45, hy + hr * 0.5], [hx + hr * 0.55, hy + hr * 0.5 + 4 * s], [hx + hr * 0.68, hy + hr * 0.48]], '#ffffff');
      break;
    case 'terra': {
      // A mound of earth on the back with a sprout and a couple of pebbles in it.
      const mx = backx + 1 * s, my = backy + 2.5;
      p.path(`M${f(mx - 10 * s)} ${f(my)}Q${f(mx - 8 * s)} ${f(my - 7 * s)} ${f(mx)} ${f(my - 7.5 * s)}Q${f(mx + 8 * s)} ${f(my - 7 * s)} ${f(mx + 10 * s)} ${f(my)}Z`, e.dark);
      p.dot(mx - 4 * s, my - 2.5 * s, 1.5 * s + 0.3, '#9c9384');
      p.dot(mx + 4.5 * s, my - 1.8 * s, 1.2 * s + 0.3, '#b3aa98');
      const g = ELEMENTS.verdant;
      p.line(`M${f(mx)} ${f(my - 7 * s)}Q${f(mx - 1 * s)} ${f(my - 11 * s)} ${f(mx - 4 * s)} ${f(my - 13 * s)}`, g.dark, 1.6 * s + 0.4);
      p.line(`M${f(mx)} ${f(my - 7 * s)}Q${f(mx + 1 * s)} ${f(my - 12 * s)} ${f(mx + 3.5 * s)} ${f(my - 14 * s)}`, g.base, 1.6 * s + 0.4);
      p.path(`M${f(mx + 3.5 * s)} ${f(my - 14 * s)}q${f(4 * s)} ${f(-2 * s)} ${f(5 * s)} ${f(1 * s)}q${f(-3 * s)} ${f(1.5 * s)} ${f(-5 * s)} ${f(-1 * s)}Z`, g.light, { line: false });
      break;
    }
    case 'gale':
      p.path(`M${f(backx - 16 * s)} ${f(backy - 4 * s)}q${f(8 * s)} ${f(-6 * s)} ${f(12 * s)} 0M${f(backx - 20 * s)} ${f(backy + 4 * s)}q${f(7 * s)} ${f(-5 * s)} ${f(11 * s)} 0`, 'none', { stroke: e.light, sw: 1.6, op: 0.9 });
      p.path(`M${f(hx - hr * 0.3)} ${f(hy - hr * 0.85)}Q${f(hx - hr * 0.9)} ${f(hy - hr * 1.7)} ${f(hx - hr * 1.3)} ${f(hy - hr * 1.2)}Q${f(hx - hr * 0.7)} ${f(hy - hr * 1.1)} ${f(hx - hr * 0.5)} ${f(hy - hr * 0.7)}Z`, e.light);
      break;
    case 'mind': {
      const gy = hy - hr - 6 * s + Math.sin(phase * TAU) * 1.2;
      p.poly([[hx + hr * 0.2, gy - 4.5 * s], [hx + hr * 0.2 + 3.4 * s, gy], [hx + hr * 0.2, gy + 4.5 * s], [hx + hr * 0.2 - 3.4 * s, gy]], e.glow);
      p.dot(hx + hr * 0.2, gy, 7 * s, e.light, 0.25);
      break;
    }
    case 'swarm':
      for (const t of [-0.3, 0.1, 0.5]) p.path(`M${f(bx + brx * t)} ${f(by - bry * 0.9)}Q${f(bx + brx * (t + 0.08))} ${f(by)} ${f(bx + brx * t)} ${f(by + bry * 0.9)}`, 'none', { stroke: e.dark, sw: 1.1, op: 0.7 });
      p.path(`M${f(hx + hr * 0.3)} ${f(hy - hr * 0.85)}q${f(2 * s)} ${f(-7 * s)} ${f(7 * s)} ${f(-8 * s)}`, 'none', { stroke: c.out, sw: 1.1 });
      break;
    case 'stone':
      p.poly([[backx - 9 * s, backy + 3], [backx - 6 * s, backy - 6 * s], [backx - 1 * s, backy - 4 * s], [backx, backy + 2]], e.base);
      p.poly([[backx, backy + 2], [backx + 2 * s, backy - 7 * s], [backx + 8 * s, backy - 3 * s], [backx + 9 * s, backy + 3]], e.light);
      break;
    case 'spirit':
      p.path(`M${f(bx - brx * 0.9)} ${f(by + bry * 0.6)}q${f(-6 * s)} ${f(5 * s)} ${f(-10 * s)} ${f(2 * s)}q${f(-3 * s)} ${f(-2 * s)} ${f(-6 * s)} ${f(1 * s)}`, 'none', { stroke: e.light, sw: 2.2 * s + 0.6, op: 0.6 });
      p.dot(backx - 8 * s, backy - 8 * s + Math.sin(phase * TAU) * 1.5, 2.2 * s, e.glow, 0.7);
      break;
    case 'wyrm':
      for (let i = 0; i < 3; i++) { const x0 = backx - 8 * s + i * 7 * s; p.poly([[x0 - 3 * s, backy + 2], [x0 - 1 * s, backy - (7 - i) * s], [x0 + 3 * s, backy + 2]], e.glow); }
      break;
    case 'shade':
      p.path(`M${f(backx - 4 * s)} ${f(backy)}q${f(-6 * s)} ${f(-6 * s)} ${f(-1 * s)} ${f(-11 * s)}q${f(1 * s)} ${f(5 * s)} ${f(5 * s)} ${f(4 * s)}q${f(-1 * s)} ${f(5 * s)} ${f(-4 * s)} ${f(7 * s)}Z`, e.dark, { line: false, op: 0.7 });
      p.path(`M${f(bx - brx)} ${f(by + bry * 0.3)}q${f(-7 * s)} ${f(-3 * s)} ${f(-9 * s)} ${f(-9 * s)}q${f(4 * s)} ${f(2 * s)} ${f(7 * s)} ${f(1 * s)}Z`, e.dark, { line: false, op: 0.6 });
      break;
    case 'forge':
      p.path(`M${f(backx - 9 * s)} ${f(backy + 3)}Q${f(backx)} ${f(backy - 7 * s)} ${f(backx + 9 * s)} ${f(backy + 3)}Z`, e.base);
      for (const t of [-5, 0, 5]) p.dot(backx + t * s, backy + 0.5 - (t === 0 ? 2.4 * s : 0), 0.9 * s + 0.3, e.dark);
      p.dot(bx + brx * 0.35, by + bry * 0.1, 1 * s + 0.3, e.glow);
      break;
    case 'glimmer':
      star(p, backx - 12 * s, backy - 8 * s, 3 * s, e.glow); star(p, hx + hr + 4 * s, hy - hr - 2 * s, 2.4 * s, e.glow); star(p, bx - brx - 3 * s, by + bry * 0.5, 2 * s, '#ffffff');
      break;
    case 'radiant':
      p.ring(hx, hy - hr - 4 * s, hr * 0.7, 2.4 * s + 0.6, e.base, 1.8);
      for (let i = 0; i < 5; i++) { const ang = -Math.PI * (0.15 + i * 0.175); p.path(`M${f(hx + Math.cos(ang) * (hr + 7 * s))} ${f(hy + Math.sin(ang) * (hr + 7 * s))}L${f(hx + Math.cos(ang) * (hr + 12 * s))} ${f(hy + Math.sin(ang) * (hr + 12 * s))}`, 'none', { stroke: e.glow, sw: 1.4, op: 0.8 }); }
      break;
    case 'void':
      for (const [dx, dy, r] of [[-0.5, -0.3, 1.1], [0.1, 0.25, 0.9], [0.4, -0.4, 0.7], [-0.15, -0.6, 0.6], [-0.6, 0.35, 0.6]]) p.dot(bx + brx * dx, by + bry * dy, r * s + 0.3, e.glow, 0.95);
      p.path(`M${f(bx - brx * 0.2)} ${f(by - bry * 0.1)}l${f(3 * s)} ${f(3 * s)}l${f(-2 * s)} ${f(3 * s)}l${f(4 * s)} ${f(2 * s)}`, 'none', { stroke: e.glow, sw: 1, op: 0.9 });
      break;
  }
}

/** Draw a creature. Returns shapes back-to-front. */
export function drawCreature(ph: Pheno, o: DrawOpts): Shape[] {
  const pal = paletteFor(ph);
  const p = new Pen(pal);
  const st = STAGE[Math.max(0, Math.min(4, o.stage))];
  const phase = o.phase ?? 0;
  const sw = o.walking ? Math.sin(phase * TAU) : 0;
  const breathe = Math.sin(phase * TAU) * 0.6;
  const b = st.body, hs = st.head, ls = st.limb, k = st.feat;
  const far = shade(pal.base, -0.1);
  const flap = Math.sin(phase * TAU * (o.walking ? 2 : 1));
  const reach = o.pose === 'attack' ? 1 : 0;
  const raise = o.pose === 'cast' ? 1 : 0;
  let a: Anchors;

  p.g = 'aura';
  if (o.stage >= 3) {
    // Ancient and legendary creatures get an aura, layered behind the same parts.
    p.ell(50, 56, 44, 38, pal.glow, { line: false, op: o.stage === 4 ? 0.3 : 0.2 });
    p.ring(50, 56, 40, 34, pal.glow, 1.2, 0.55);
  }
  if (o.shadow !== false) p.ell(50, 92, 24 * b, 4, '#000000', { line: false, op: 0.18 });

  switch (ph.skel) {
    case 'biped': {
      const by = 64 - 3 * (b - 0.8), brx = 14.5 * b, bry = 18 * b;
      const hr = 12.5 * hs;
      a = { hx: 53, hy: by - bry - hr * 0.5 + breathe * 0.4, hr, bx: 48, by, brx, bry, tx: 48 - brx * 0.8, ty: by + bry * 0.55, tdir: 0.35, wx: 44, wy: by - bry * 0.45, backx: 40, backy: by - bry * 0.72 };
      drawWing(p, a, ph, k, flap, true);
      const hip = by + bry * 0.6;
      p.g = 'back';
      p.limb(52, hip, 54 - sw * 6, 89, 6.2 * ls, far);
      p.ell(56 - sw * 6, 89.5, 4.2 * ls, 2.4 * ls, shade(pal.dark, -0.05));
      p.limb(55, by - bry * 0.35, 63 - sw * 4, by + 3, 4.6 * ls, far);
      p.g = 'body';
      drawTail(p, a, ph, k, breathe);
      p.limb(45, hip, 44 + sw * 6, 89, 6.6 * ls, pal.base);
      p.ell(46 + sw * 6, 89.5, 4.6 * ls, 2.6 * ls, pal.dark);
      p.ell(48, by, brx, bry, pal.base);
      drawPattern(p, a, ph);
      p.g = 'front';
      // The near arm swings forward to strike, or up to cast.
      if (reach) p.limb(50, by - bry * 0.3, 66, by - bry * 0.45, 4.8 * ls, pal.base, 60, by - bry * 0.05);
      else if (raise) p.limb(50, by - bry * 0.3, 60, by - bry * 1.05, 4.8 * ls, pal.base, 59, by - bry * 0.4);
      else p.limb(50, by - bry * 0.3, 58 + sw * 4, by + 5, 4.8 * ls, pal.base);
      p.g = 'body';
      break;
    }
    case 'quad': {
      const by = 63, brx = 23 * b, bry = 13.5 * b;
      const hr = 12 * hs;
      const hx = 48 + brx * 0.82, hy = by - bry * 0.75 - hr * 0.4 + breathe * 0.4;
      a = { hx, hy, hr, bx: 46, by, brx, bry, tx: 46 - brx * 0.92, ty: by - bry * 0.2, tdir: 0.5, wx: 44, wy: by - bry * 0.7, backx: 40, backy: by - bry * 0.95 };
      drawWing(p, a, ph, k, flap, true);
      const hip = by + bry * 0.5;
      const fx = 46 + brx * 0.55, rx = 46 - brx * 0.6;
      p.g = 'back';
      p.limb(fx + 4, hip, fx + 4 - sw * 6, 89, 5.6 * ls, far);
      p.limb(rx + 5, hip, rx + 5 + sw * 6, 89, 5.6 * ls, far);
      p.ell(fx + 5 - sw * 6, 89.6, 3.8 * ls, 2.2 * ls, shade(pal.dark, -0.05));
      p.ell(rx + 6 + sw * 6, 89.6, 3.8 * ls, 2.2 * ls, shade(pal.dark, -0.05));
      p.g = 'body';
      drawTail(p, a, ph, k, breathe);
      // A front paw swipes forward on an attack.
      const pawX = fx - 2 + sw * 6 + reach * 12, pawY = 89 - reach * 9;
      p.limb(fx - 2, hip, pawX, pawY, 6 * ls, pal.base);
      p.limb(rx - 1, hip, rx - 1 - sw * 6, 89, 6 * ls, pal.base);
      p.ell(pawX + 1, pawY + 0.6, 4 * ls, 2.3 * ls, pal.dark, { rot: reach * -30 });
      p.ell(rx - sw * 6, 89.6, 4 * ls, 2.3 * ls, pal.dark);
      p.limb(46 + brx * 0.6, by - bry * 0.3, hx - hr * 0.3, hy + hr * 0.5, 9 * b, pal.base);
      p.ell(46, by, brx, bry, pal.base);
      drawPattern(p, a, ph);
      break;
    }
    case 'multi': {
      const by = 66, hr = 10.5 * hs;
      const abx = 34, arx = 17 * b, ary = 12 * b;
      const thx = 34 + arx + 9 * b, thr = 11.5 * b;
      const hx = thx + thr + hr * 0.45, hy = by - 6 + breathe * 0.3;
      a = { hx, hy, hr, bx: abx, by: by - 2, brx: arx, bry: ary, tx: abx - arx * 0.9, ty: by - 4, tdir: 0.7, wx: thx - 2, wy: by - thr * 0.8, backx: abx, backy: by - 2 - ary * 0.95 };
      drawWing(p, a, ph, k, flap, true);
      p.g = 'back';
      for (let i = 0; i < 3; i++) {
        const lx = thx - 7 + i * 6, s2 = (i % 2 === 0 ? sw : -sw) * 4;
        p.limb(lx + 2, by + 2, lx + (i - 1) * 9 + 3 - s2, 90, 2.6 * ls, far, lx + (i - 1) * 8 + 3, by - 4);
      }
      p.g = 'body';
      drawTail(p, a, ph, k, breathe);
      p.ell(abx, by - 2, arx, ary, pal.base);
      drawPattern(p, a, ph);
      p.ell(thx, by - 1, thr, thr * 0.9, shade(pal.base, -0.04));
      for (let i = 0; i < 3; i++) {
        const lx = thx - 8 + i * 6, s2 = (i % 2 === 0 ? -sw : sw) * 4;
        p.limb(lx, by + 3, lx + (i - 1) * 10 - s2, 90, 3 * ls, pal.dark, lx + (i - 1) * 9, by - 6);
      }
      break;
    }
    case 'serpent': {
      const hr = 11.5 * hs, w = 12 * b;
      const wv = o.walking ? Math.sin(phase * TAU) * 3 : breathe;
      const hx = 68, hy = 40 + breathe * 0.5;
      const d = `M14 ${f(85 - wv)}Q24 ${f(74 + wv)} 36 ${f(84 - wv * 0.5)}Q50 ${f(92 + wv * 0.4)} 58 ${f(78)}Q63 66 58 56Q56 48 ${f(hx - 3)} ${f(hy + 5)}`;
      a = { hx, hy, hr, bx: 55, by: 76, brx: w * 0.75, bry: w * 0.8, tx: 15, ty: 85 - wv, tdir: 0.5, wx: 57, wy: 60, backx: 56, backy: 62 };
      drawWing(p, a, ph, k, flap, true);
      p.g = 'body';
      drawTail(p, a, ph, k * 0.8, 0);
      p.stroke(d, w, pal.base);
      if (ph.pattern === 'belly') p.line(`M30 ${f(86 - wv * 0.4)}Q48 ${f(95 + wv * 0.4)} 57 80`, pal.light, w * 0.35);
      else if (ph.pattern !== 'plain' && ph.pattern !== 'mask') {
        const col = ph.pattern === 'stars' ? pal.glow : ph.pattern === 'bands' ? pal.accentDark : pal.dark;
        for (const [x, y] of [[24, 79], [36, 84], [48, 87], [58, 76], [60, 62]]) {
          if (ph.pattern === 'stars') star(p, x, y, w * 0.25, col); else p.dot(x, y, w * (ph.pattern === 'spots' ? 0.2 : 0.26), col, 0.75);
        }
      }
      break;
    }
    case 'aquatic': {
      const by = 58 + breathe, brx = 25 * b, bry = 15 * b;
      const hr = 12 * hs;
      a = { hx: 50 + brx * 0.5, hy: by - bry * 0.12, hr, bx: 48, by, brx, bry, tx: 48 - brx * 0.9, ty: by, tdir: 0.05, wx: 46, wy: by - bry * 0.75, backx: 44, backy: by - bry * 0.95 };
      drawWing(p, a, ph, k, flap, true);
      p.g = 'body';
      // Every swimmer has a fluke; the tail gene adds to it.
      const fl = sw * 4 + breathe * 2;
      p.path(`M${f(a.tx + 3)} ${f(by)}L${f(a.tx - 12 * b)} ${f(by - 11 * b + fl)}Q${f(a.tx - 7 * b)} ${f(by)} ${f(a.tx - 12 * b)} ${f(by + 11 * b + fl)}Z`, pal.accent);
      if (ph.tail !== 'stub' && ph.tail !== 'fan') drawTail(p, { ...a, tx: a.tx + 2, ty: by + bry * 0.5 }, ph, k * 0.75, breathe);
      p.ell(48, by, brx, bry, pal.base);
      drawPattern(p, a, ph);
      p.g = 'front';
      p.ell(48 + brx * 0.05, by + bry * 0.55, 8 * ls, 4 * ls, shade(pal.base, -0.08), { rot: 28 + sw * 14 });
      p.g = 'body';
      break;
    }
    default: {
      // floater
      const cy = 52 + breathe * 1.4, r = 17 * b;
      const hr = 13 * hs;
      a = { hx: 52, hy: cy - r * 0.35, hr, bx: 50, by: cy + r * 0.45, brx: r * 0.8, bry: r * 0.75, tx: 44, ty: cy + r * 1.25, tdir: -0.9, wx: 43, wy: cy - r * 0.1, backx: 40, backy: cy - r * 0.55 };
      drawWing(p, a, ph, k, flap, true);
      p.g = 'back';
      p.ell(50 - r * 0.75, cy + r * 0.6 - Math.sin(phase * TAU) * 1.6, 3.4 * ls, 3 * ls, far);
      p.g = 'body';
      const wv = Math.sin(phase * TAU) * 1.6;
      p.path(`M${f(50 - r)} ${f(cy)}Q${f(50 - r)} ${f(cy - r * 1.1)} 50 ${f(cy - r * 1.1)}Q${f(50 + r)} ${f(cy - r * 1.1)} ${f(50 + r)} ${f(cy)}Q${f(50 + r)} ${f(cy + r * 1.1)} ${f(50 + r * 0.55)} ${f(cy + r * 1.45 + wv)}Q${f(50 + r * 0.35)} ${f(cy + r * 1.05)} ${f(50 + r * 0.1)} ${f(cy + r * 1.6 - wv)}Q${f(50 - r * 0.15)} ${f(cy + r * 1.1)} ${f(50 - r * 0.45)} ${f(cy + r * 1.7 + wv)}Q${f(50 - r * 0.95)} ${f(cy + r * 1.1)} ${f(50 - r)} ${f(cy)}Z`, pal.base);
      drawPattern(p, a, ph);
      if (ph.tail !== 'stub') drawTail(p, { ...a, tx: 50 - r * 0.5, ty: cy + r * 1.2, tdir: -0.6 }, ph, k * 0.7, wv);
      p.ell(50 + r * 0.95, cy + r * 0.45 + wv, 3.6 * ls, 3.2 * ls, pal.base);
    }
  }

  drawWing(p, a, ph, k, flap, false);
  p.g = 'body';
  drawHead(p, a, ph, k, o.ko, o.pose);
  p.g = 'body';
  drawCues(p, a, ph.el1, st.cue, phase, false);
  if (ph.el2) drawCues(p, a, ph.el2, st.cue, phase, true);
  p.g = 'fx';
  if (o.stage === 4) {
    for (let i = 0; i < 5; i++) {
      const ang = phase * TAU + (i * TAU) / 5;
      star(p, 50 + Math.cos(ang) * 40, 54 + Math.sin(ang) * 32, 2.6, pal.glow, 0.9);
    }
  }
  return p.shapes();
}

/** An egg, tinted by what will hatch: a hint, not the whole story. */
export function drawEgg(ph: Pheno, wobble = 0): Shape[] {
  const pal = paletteFor(ph);
  const p = new Pen(pal);
  p.ell(50, 90, 22, 4, '#000000', { line: false, op: 0.16 });
  const t = wobble * 3;
  p.path(`M50 ${f(14)}Q${f(78 + t)} 22 80 60Q80 88 50 88Q20 88 20 60Q${f(22 + t)} 22 50 14Z`, mix(pal.base, '#fff8ea', 0.35));
  p.ell(38, 44, 6, 9, '#ffffff', { line: false, op: 0.35, rot: 20 });
  const spot = ph.el2 ? ELEMENTS[ph.el2].base : pal.dark;
  p.dot(60, 40, 5, spot, 0.7); p.dot(44, 66, 6.5, spot, 0.7); p.dot(64, 68, 4, spot, 0.7); p.dot(36, 52, 3, pal.accent, 0.8);
  if (ph.pattern === 'stars') { star(p, 54, 54, 5, pal.glow); star(p, 40, 34, 3, pal.glow); }
  if (ph.pattern === 'stripes' || ph.pattern === 'bands') p.path('M24 58Q50 48 76 58', 'none', { stroke: pal.dark, sw: 3, op: 0.6 });
  return p.shapes();
}

/** Spirits are a little see-through. Applied to the whole drawing so no inner lines show through. */
export function creatureOpacity(ph: Pheno): number {
  return ph.el1 === 'spirit' || ph.el2 === 'spirit' ? 0.86 : 1;
}

/** Shapes as an SVG string, for tools and tests. */
export function shapesToSvg(shapes: Shape[], size = 200, bg?: string): string {
  const at = (sh: Shape) =>
    (sh.fill ? ` fill="${sh.fill}"` : ' fill="none"') + (sh.stroke ? ` stroke="${sh.stroke}" stroke-width="${sh.sw ?? 1}" stroke-linecap="round" stroke-linejoin="round"` : '') + (sh.op != null && sh.op < 1 ? ` opacity="${sh.op}"` : '');
  const body = shapes.map(sh => {
    if (sh.t === 'path') return `<path d="${sh.d}"${at(sh)}/>`;
    if (sh.t === 'circle') return `<circle cx="${f(sh.cx)}" cy="${f(sh.cy)}" r="${f(sh.r)}"${at(sh)}/>`;
    return `<ellipse cx="${f(sh.cx)}" cy="${f(sh.cy)}" rx="${f(sh.rx)}" ry="${f(sh.ry)}"${sh.rot ? ` transform="rotate(${f(sh.rot)} ${f(sh.cx)} ${f(sh.cy)})"` : ''}${at(sh)}/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">${bg ? `<rect width="100" height="100" fill="${bg}"/>` : ''}${body}</svg>`;
}
