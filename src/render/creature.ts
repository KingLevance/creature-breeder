// Draws a creature from its visible traits as a flat list of shapes in a 100x100 box, facing right.
// Pure: no React, no SVG library. The app turns the shapes into react-native-svg nodes, and the
// tools turn them into an SVG string, so the same drawing code feeds every screen.
import { ELEMENTS, ElementId } from '../game/data/elements';
import type { Pheno, Skeleton } from '../game/genome';

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

export interface Palette { base: string; light: string; dark: string; glow: string; accent: string; accentDark: string; out: string; mark: string; markGlow: string }

export function paletteFor(ph: Pheno): Palette {
  const e = ELEMENTS[ph.el1];
  const hue = ph.hue ?? 0;
  const tone = (c0: string): string => {
    const c = hue ? shade(c0, 0, 0, hue) : c0;
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
  // A second element shows in the markings (spots, stripes, bands, stars) and in the tail tip.
  const e2 = ph.el2 ? ELEMENTS[ph.el2] : null;
  return { base, light: tone(e.light), dark: tone(e.dark), glow: e.glow, accent: acc, accentDark: shade(acc, -0.18), out: shade(tone(e.dark), -0.14),
    mark: e2 ? e2.dark : tone(e.dark), markGlow: e2 ? e2.glow : e.glow };
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
const OW = 2;

interface Item { g: Layer; out?: Shape; fill: Shape }

/** A rotation about (cx, cy) by deg degrees, then a shift. Used to lean and lower a body into its stance. */
interface Tf { cx: number; cy: number; deg: number; c: number; s: number; dx: number; dy: number }
function mkTf(cx: number, cy: number, deg: number, dx: number, dy: number): Tf {
  const r = (deg * Math.PI) / 180;
  return { cx, cy, deg, c: Math.cos(r), s: Math.sin(r), dx, dy };
}
function tpt(T: Tf, x: number, y: number): [number, number] {
  const X = x - T.cx, Y = y - T.cy;
  return [T.cx + X * T.c - Y * T.s + T.dx, T.cy + X * T.s + Y * T.c + T.dy];
}
const TOKEN = /[MmLlQqCcAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g;
/** Moves a path through a transform. Handles the commands the renderer writes: M L Q C A Z, absolute and relative. */
function tfPath(d: string, T: Tf): string {
  const tok = d.match(TOKEN) ?? [];
  let out = '', cmd = '', i = 0;
  const n = () => parseFloat(tok[i++]);
  const abs = () => { const [x, y] = tpt(T, n(), n()); return f(x) + ' ' + f(y); };
  const rel = () => { const x = n(), y = n(); return f(x * T.c - y * T.s) + ' ' + f(x * T.s + y * T.c); };
  while (i < tok.length) {
    if (/[A-Za-z]/.test(tok[i])) { cmd = tok[i++]; out += cmd; if (cmd === 'Z' || cmd === 'z') continue; } else out += ' ';
    switch (cmd) {
      case 'M': case 'L': out += abs(); break;
      case 'm': case 'l': out += rel(); break;
      case 'Q': out += abs() + ' ' + abs(); break;
      case 'q': out += rel() + ' ' + rel(); break;
      case 'C': out += abs() + ' ' + abs() + ' ' + abs(); break;
      case 'c': out += rel() + ' ' + rel() + ' ' + rel(); break;
      case 'A': case 'a': {
        const rx = n(), ry = n(), rot = n(), la = n(), sw = n();
        out += `${f(rx)} ${f(ry)} ${f(rot + T.deg)} ${la} ${sw} ` + (cmd === 'A' ? abs() : rel());
        break;
      }
      default: i++;
    }
  }
  return out;
}
function tfShape(sh: Shape, T: Tf): Shape {
  if (sh.t === 'path') return { ...sh, d: tfPath(sh.d, T) };
  const [cx, cy] = tpt(T, sh.cx, sh.cy);
  if (sh.t === 'circle') return { ...sh, cx, cy };
  return { ...sh, cx, cy, rot: (sh.rot ?? 0) + T.deg };
}

class Pen {
  items: Item[] = [];
  g: Layer = 'body';
  /** While set, everything drawn is leaned and lowered into the creature's stance. */
  tf: Tf | null = null;
  constructor(public pal: Palette) {}
  private add(fill: Shape, out?: Shape) {
    if (this.tf) { fill = tfShape(fill, this.tf); if (out) out = tfShape(out, this.tf); }
    this.items.push({ g: this.g, fill, out });
  }
  /** Where a point ends up under the current stance. */
  at(x: number, y: number): [number, number] { return this.tf ? tpt(this.tf, x, y) : [x, y]; }
  /** Draw something (a leg) outside the stance transform, so it can reach the ground from a moved hip. */
  free(fn: () => void) { const t = this.tf; this.tf = null; fn(); this.tf = t; }
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
  /** A limb whose width changes along a centre line (widths[i] at pts[i]), rounded at both ends. */
  ribbon(pts: number[][], widths: number[], color: string) {
    const L: string[] = [], R: string[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
      const h = widths[i] / 2;
      L.push(`${f(pts[i][0] - dy * h)} ${f(pts[i][1] + dx * h)}`);
      R.unshift(`${f(pts[i][0] + dy * h)} ${f(pts[i][1] - dx * h)}`);
    }
    this.path('M' + L.join('L') + 'L' + R.join('L') + 'Z', color);
    const n = pts.length - 1;
    this.ell(pts[0][0], pts[0][1], widths[0] / 2, widths[0] / 2, color);
    this.ell(pts[n][0], pts[n][1], widths[n] / 2, widths[n] / 2, color);
  }
  /** A tapered limb from (x1,y1), width w0, to (x2,y2), width w1, optionally bending toward (kx,ky). */
  taper(x1: number, y1: number, x2: number, y2: number, w0: number, w1: number, color: string, kx?: number, ky?: number) {
    const cx = kx ?? (x1 + x2) / 2, cy = ky ?? (y1 + y2) / 2;
    const pts: number[][] = [], ws: number[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8, u = 1 - t;
      pts.push([u * u * x1 + 2 * u * t * cx + t * t * x2, u * u * y1 + 2 * u * t * cy + t * t * y2]);
      ws.push(w0 + (w1 - w0) * t);
    }
    this.ribbon(pts, ws, color);
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

/** Soft shading on a rounded form: a shadow along the underside and a highlight on top, for a sense of volume. */
function shadeForm(p: Pen, cx: number, cy: number, rx: number, ry: number) {
  const sn = 0.15, cs = Math.sqrt(1 - sn * sn);
  p.path(`M${f(cx - rx * cs)} ${f(cy + ry * sn)}A${f(rx)} ${f(ry)} 0 0 0 ${f(cx + rx * cs)} ${f(cy + ry * sn)}Q${f(cx)} ${f(cy + ry * 1.02)} ${f(cx - rx * cs)} ${f(cy + ry * sn)}Z`, p.pal.out, { line: false, op: 0.2 });
  p.ell(cx - rx * 0.28, cy - ry * 0.55, rx * 0.36, ry * 0.15, '#ffffff', { line: false, op: 0.22, rot: -10 });
}

const STAGE = [
  { head: 1.3, body: 0.8, limb: 0.72, feat: 0.42, cue: 0.3 },
  { head: 1.14, body: 0.92, limb: 0.9, feat: 0.72, cue: 0.65 },
  { head: 1, body: 1, limb: 1, feat: 1, cue: 1 },
  { head: 1, body: 1.03, limb: 1, feat: 1.16, cue: 1.1 },
  { head: 1, body: 1.05, limb: 1, feat: 1.28, cue: 1.2 },
];

interface Anchors {
  /** Bodies with a horizontal back (four- and many-legged, swimmers), where things can sit on top. */
  flatBack?: boolean;
  hx: number; hy: number; hr: number;
  bx: number; by: number; brx: number; bry: number;
  tx: number; ty: number; tdir: number;
  wx: number; wy: number;
  backx: number; backy: number;
  /** A point on the back with the outward direction (angle from straight up), for things that sit on the back. */
  back?: [number, number, number];
}

/** A point on an ellipse at angle t, with the angle of its outward normal measured from straight up. */
function ellFrame(cx: number, cy: number, rx: number, ry: number, t: number): [number, number, number] {
  const nx = Math.cos(t) / rx, ny = Math.sin(t) / ry;
  return [cx + rx * Math.cos(t), cy + ry * Math.sin(t), Math.atan2(nx, -ny)];
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
  // A dual type's tail ends in a piece of its second element, which can be bigger than the tail's own tip.
  const room = tx - 2 - (ph.el2 ? Math.max(tip, 12) : tip) * k;
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
  if (ph.tail === 'stub') { p.ell(tx - 2, ty, 4.5 * Math.max(0.7, k), 3.6 * Math.max(0.7, k), c.base); if (ph.el2) tailTip(p, tx - 5, ty, ph.el2, Math.max(0.6, k * 0.75)); return; }
  if (ph.tail === 'stinger') {
    const sx = tx - 6 * k, sy = ty - 20 * k + sway;
    p.taper(tx, ty, sx, sy, w * 1.35, w * 0.75, c.base, tx - 16 * k, ty - 8 * k);
    p.poly([[sx - 3 * k, sy + 1], [sx + 2 * k, sy - 2 * k], [sx + 7 * k, sy + 4 * k]], c.accentDark);
    return;
  }
  if (ph.tail === 'whip') p.taper(tx, ty, ex, ey, 4.2 * Math.max(0.6, k), 1.3, c.base, kx, ky);
  else p.taper(tx, ty, ex, ey, w * 1.4, w * 0.7, c.base, kx, ky);
  if (ph.el2) { tailTip(p, ex, ey, ph.el2, Math.max(0.75, k)); return; }
  if (ph.tail === 'tuft') p.ell(ex, ey, 5 * k, 4.4 * k, c.accent);
  if (ph.tail === 'club') p.ell(ex, ey, 6 * k, 5.4 * k, c.dark);
  if (ph.tail === 'fan') p.poly([[ex + 2, ey], [ex - 8 * k, ey - 8 * k], [ex - 10 * k, ey], [ex - 8 * k, ey + 7 * k]], c.accent);
  if (ph.tail === 'plume') flame(p, ex - 1, ey - 1, 5.5 * k, c.accent, c.glow);
}

/** A dual-type creature's tail ends in a piece of its second element. Drawn around (x, y), about 10 units across. */
function tailTip(p: Pen, x: number, y: number, el: ElementId, k: number) {
  const e = ELEMENTS[el];
  const s = k;
  const P = (pts: number[][]) => pts.map(([a, b]) => [x + a * s, y + b * s]);
  switch (el) {
    case 'ember': flame(p, x - 1, y - 1, 5.5 * s, e.base, e.glow); break;
    case 'tide': p.path(`M${f(x)} ${f(y - 8 * s)}Q${f(x + 6 * s)} ${f(y)} ${f(x)} ${f(y + 4 * s)}Q${f(x - 6 * s)} ${f(y)} ${f(x)} ${f(y - 8 * s)}Z`, e.base); p.dot(x - 1.5 * s, y - 0.5 * s, 1.4 * s, e.glow); break;
    case 'verdant': p.path(`M${f(x + 1)} ${f(y)}Q${f(x - 4 * s)} ${f(y - 9 * s)} ${f(x - 9 * s)} ${f(y - 8 * s)}Q${f(x - 7 * s)} ${f(y + 1 * s)} ${f(x + 1)} ${f(y)}Z`, e.base); p.line(`M${f(x)} ${f(y)}L${f(x - 7 * s)} ${f(y - 6.5 * s)}`, e.dark, 0.9); break;
    case 'spark': p.poly(P([[1, 0], [-3, -5], [-1, -5], [-5, -11], [2, -4], [0, -4], [3, 1]]), e.base); break;
    case 'frost': p.poly(P([[-1, 1], [-4, -8], [0, -3]]), e.light); p.poly(P([[0, 1], [2, -10], [4, -1]]), e.glow); break;
    case 'brawn': p.ell(x - 1 * s, y, 5 * s, 4.5 * s, e.dark); p.line(`M${f(x - 3 * s)} ${f(y - 3 * s)}L${f(x - 3 * s)} ${f(y + 3 * s)}`, e.light, 1.2); break;
    case 'venom': p.path(`M${f(x - 2 * s)} ${f(y - 4 * s)}Q${f(x + 5 * s)} ${f(y - 3 * s)} ${f(x + 2 * s)} ${f(y + 3 * s)}Q${f(x)} ${f(y + 8 * s)} ${f(x - 2 * s)} ${f(y + 3 * s)}Q${f(x - 6 * s)} ${f(y - 2 * s)} ${f(x - 2 * s)} ${f(y - 4 * s)}Z`, e.base); p.dot(x - 0.5 * s, y + 4.5 * s, 1.2 * s, e.glow); break;
    case 'terra': p.poly(P([[-6, 1], [-5, -4], [0, -6], [4, -3], [4, 2], [-1, 4]]), e.dark); p.dot(x - 2 * s, y - 2 * s, 1.1 * s, '#b3aa98'); break;
    case 'gale': p.path(`M${f(x + 1)} ${f(y)}Q${f(x - 3 * s)} ${f(y - 10 * s)} ${f(x - 8 * s)} ${f(y - 11 * s)}Q${f(x - 7 * s)} ${f(y - 3 * s)} ${f(x + 1)} ${f(y)}Z`, e.light); p.line(`M${f(x)} ${f(y)}Q${f(x - 4 * s)} ${f(y - 6 * s)} ${f(x - 7 * s)} ${f(y - 10 * s)}`, e.dark, 0.8); break;
    case 'mind': p.poly(P([[0, -6], [4, 0], [0, 6], [-4, 0]]), e.base); p.poly(P([[0, -3], [2, 0], [0, 3], [-2, 0]]), e.glow, { line: false }); break;
    case 'swarm': p.ell(x - 2 * s, y, 4 * s, 3 * s, e.base); p.ell(x - 6 * s, y - 1 * s, 3 * s, 2.4 * s, e.dark); p.poly(P([[-8, -2], [-12, -3], [-8, 0]]), e.dark); break;
    case 'stone': p.poly(P([[-6, 2], [-6, -3], [-2, -6], [3, -4], [4, 1], [0, 4]]), e.base); p.poly(P([[-3, -3], [0, -5], [1, -2]]), e.light, { line: false }); break;
    case 'spirit': p.path(`M${f(x)} ${f(y)}Q${f(x - 6 * s)} ${f(y - 2 * s)} ${f(x - 5 * s)} ${f(y - 8 * s)}Q${f(x - 2 * s)} ${f(y - 5 * s)} ${f(x - 1 * s)} ${f(y - 10 * s)}Q${f(x + 4 * s)} ${f(y - 4 * s)} ${f(x)} ${f(y)}Z`, e.light, { op: 0.85 }); break;
    case 'wyrm': p.poly(P([[1, 0], [-3, -6], [-9, -2], [-5, 0], [-9, 3], [-3, 5]]), e.base); break;
    case 'shade': p.path(`M${f(x)} ${f(y)}q${f(-6 * s)} ${f(-2 * s)} ${f(-4 * s)} ${f(-8 * s)}q${f(2 * s)} ${f(3 * s)} ${f(5 * s)} ${f(2 * s)}q${f(-1 * s)} ${f(3 * s)} ${f(-1 * s)} ${f(6 * s)}Z`, e.dark); p.dot(x - 2 * s, y - 4 * s, 1 * s, e.glow); break;
    case 'forge': p.ell(x - 1 * s, y, 5 * s, 4 * s, e.base); p.dot(x - 3 * s, y - 1 * s, 0.9 * s, e.dark); p.dot(x + 1 * s, y - 1 * s, 0.9 * s, e.dark); break;
    case 'glimmer': star(p, x - 1 * s, y - 2 * s, 6 * s, e.glow); star(p, x - 1 * s, y - 2 * s, 3 * s, e.base); break;
    case 'radiant': p.dot(x - 1 * s, y - 1 * s, 6 * s, e.glow, 0.45); p.ell(x - 1 * s, y - 1 * s, 3.6 * s, 3.6 * s, e.base); break;
    case 'void': p.ell(x - 1 * s, y, 4.5 * s, 4.5 * s, e.dark); p.dot(x - 2.5 * s, y - 1.5 * s, 0.8 * s, e.glow); p.dot(x + 0.5 * s, y + 1 * s, 0.6 * s, e.glow); break;
    default: p.ell(x - 1 * s, y, 4.5 * s, 4 * s, e.light);
  }
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
    case 'flipper': {
      // A pectoral fin: narrow where it joins the shoulder, fanning out behind into a scalloped edge with ribs,
      // in the wing colour so it reads as a fin and not a horn.
      const sx = a.flatBack ? a.bx + a.brx * 0.42 + (far ? 4 : 0) : x + 4, sy = a.flatBack ? a.by - a.bry * 0.3 + (far ? -1 : 0) : y + 2;
      const lift = up * 0.35;
      const ax = sx - 14 * k, ay = sy + 1 * k - lift, ex = sx - 5.5 * k, ey = sy + 13 * k - lift * 0.6;
      p.path(`M${f(sx + 1.5 * k)} ${f(sy - 1.5 * k)}Q${f(sx - 5 * k)} ${f(sy - 4.5 * k - lift)} ${f(ax)} ${f(ay)}`
        + `Q${f(sx - 11 * k)} ${f(sy + 3 * k - lift)} ${f(sx - 11.5 * k)} ${f(sy + 6 * k - lift)}`
        + `Q${f(sx - 8 * k)} ${f(sy + 7 * k - lift)} ${f(sx - 9 * k)} ${f(sy + 10 * k - lift)}`
        + `Q${f(sx - 6 * k)} ${f(sy + 10 * k - lift)} ${f(ex)} ${f(ey)}`
        + `Q${f(sx - 0.5 * k)} ${f(sy + 8 * k)} ${f(sx - 0.5 * k)} ${f(sy + 2.5 * k)}Z`, col);
      const rib = far ? shade(c.accentDark, -0.12) : c.accentDark;
      for (const [rx, ry] of [[ax + 2 * k, ay + 0.6 * k], [sx - 10.5 * k, sy + 5.5 * k - lift], [sx - 8.5 * k, sy + 9.2 * k - lift], [ex + 0.6 * k, ey - 1.6 * k]]) {
        p.line(`M${f(sx - 0.5 * k)} ${f(sy + 0.8 * k)}L${f(rx)} ${f(ry)}`, rib, 0.8 * k + 0.2);
      }
      break;
    }
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

const EYES = [[0.12, -0.08, 0.27], [0.62, -0.1, 0.2]];
const EYES_MULTI = [[0.18, -0.12, 0.2], [0.56, -0.2, 0.17], [0.42, 0.14, 0.13], [-0.12, -0.3, 0.13]];
const INK = '#1b1420';

/** Iris colour: the complement of the body's hue so the eyes pop, or the second element's own hue on a dual type. */
function irisColor(ph: Pheno): string {
  const [h, sat] = hexToHsl(ELEMENTS[ph.el2 ?? ph.el1].base);
  return hslToHex(h + (ph.el2 ? 0 : 165), Math.max(0.6, sat), 0.47);
}

function drawEyes(p: Pen, x: number, y: number, r: number, ph: Pheno, ko = false, pose: Pose = 'idle') {
  const c = p.pal;
  const spots = ph.eyes === 'multi' ? EYES_MULTI : EYES;
  if (ko) {
    // Knocked out: an X for each eye.
    for (const [dx, dy, er0] of spots) {
      const ex = x + r * dx, ey = y + r * dy, k = r * er0 * 0.9, w = Math.max(1.3, r * er0 * 0.5);
      p.line(`M${f(ex - k)} ${f(ey - k)}L${f(ex + k)} ${f(ey + k)}M${f(ex + k)} ${f(ey - k)}L${f(ex - k)} ${f(ey + k)}`, c.out, w);
    }
    return;
  }
  if (pose === 'blink' || pose === 'hurt') {
    // Closed eyes for a blink; squeezed shut (> <) when hurt.
    spots.forEach(([dx, dy, er0], i) => {
      const ex = x + r * dx, ey = y + r * dy, k = r * er0 * 0.85, w = Math.max(1.1, r * er0 * 0.4), side = i % 2 ? -1 : 1;
      if (pose === 'blink') p.line(`M${f(ex - k)} ${f(ey)}Q${f(ex)} ${f(ey + k * 0.6)} ${f(ex + k)} ${f(ey)}`, c.out, w);
      else p.line(`M${f(ex - k * side)} ${f(ey - k * 0.7)}L${f(ex + k * 0.5 * side)} ${f(ey)}L${f(ex - k * side)} ${f(ey + k * 0.7)}`, c.out, w);
    });
    return;
  }
  const glowy = ph.eyes === 'glow' || ph.el1 === 'shade' || ph.el1 === 'void' || ph.el1 === 'spirit';
  const iris = irisColor(ph);
  const big = ph.eyes === 'big' ? 1.2 : 1;
  spots.forEach(([dx, dy, er0], i) => {
    const ex = x + r * dx, ey = y + r * dy, er = r * er0 * big;
    // The far eye is a little narrower, as if turned away.
    const rx = i === 1 && ph.eyes !== 'multi' ? er * 0.86 : er;
    if (ph.eyes === 'multi') {
      // Spider-like eyes: glossy and round, tinted with the iris colour so they read as eyes, not holes.
      p.ell(ex, ey, er, er, glowy ? c.glow : mix(iris, INK, 0.55));
      if (!glowy) p.dot(ex + er * 0.1, ey + er * 0.15, er * 0.55, mix(iris, INK, 0.2));
      p.dot(ex - er * 0.28, ey - er * 0.3, er * 0.3, '#ffffff');
      p.dot(ex + er * 0.35, ey + er * 0.4, er * 0.12, '#ffffff', 0.8);
      return;
    }
    if (glowy) {
      p.ell(ex, ey, rx, er, c.glow);
      p.dot(ex + rx * 0.1, ey + er * 0.05, er * 0.5, '#ffffff', 0.75);
      return;
    }
    if (ph.eyes === 'slit') {
      const side = i === 0 ? 1 : -1;
      p.ell(ex, ey, rx, er * 0.9, mix(iris, '#ffffff', 0.45));
      p.ell(ex + rx * 0.12, ey, rx * 0.2, er * 0.72, INK, { line: false });
      p.dot(ex - rx * 0.3, ey - er * 0.35, er * 0.16, '#ffffff');
      // A slanted brow gives a fierce look.
      p.line(`M${f(ex - rx * 1.1 * side)} ${f(ey - er * 1.05)}L${f(ex + rx * 1.0 * side)} ${f(ey - er * 0.5)}`, c.out, Math.max(1.2, er * 0.38));
      return;
    }
    p.ell(ex, ey, rx, er, '#ffffff');
    const ir = Math.min(er * (ph.eyes === 'big' ? 0.74 : 0.62), rx * 0.8), ix = ex + rx * 0.16, iy = ey + er * 0.06;
    p.dot(ix, iy, ir, iris);
    p.dot(ix + ir * 0.08, iy + ir * 0.05, ir * 0.55, INK);
    p.dot(ix - ir * 0.32, iy - ir * 0.38, ir * 0.32, '#ffffff');
    if (ph.eyes === 'big') p.dot(ix + ir * 0.38, iy + ir * 0.42, ir * 0.16, '#ffffff', 0.9);
    if (ph.eyes === 'sleepy') {
      // A heavy upper lid.
      p.path(`M${f(ex - rx - 0.2)} ${f(ey - er * 0.02)}A${f(rx + 0.2)} ${f(er + 0.2)} 0 0 1 ${f(ex + rx + 0.2)} ${f(ey - er * 0.02)}Z`, c.base, { line: false });
      p.line(`M${f(ex - rx)} ${f(ey - er * 0.02)}L${f(ex + rx)} ${f(ey - er * 0.02)}`, c.out, 1);
    }
  });
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
  // A wider jaw under the skull gives the head cheeks instead of a plain circle.
  const jaw = () => p.ell(hx + r * 0.1, hy + r * 0.3, r * 0.96, r * 0.62, c.base);
  switch (ph.head) {
    case 'snout':
      p.ell(hx, hy, r, r * 0.95, c.base); jaw();
      p.ell(hx + r * 0.72, hy + r * 0.3, r * 0.6, r * 0.42, c.light);
      shadeForm(p, hx, hy, r, r * 0.95);
      p.dot(hx + r * 1.15, hy + r * 0.18, r * 0.11, c.out);
      break;
    case 'beak':
      p.ell(hx, hy, r, r * 0.95, c.base); jaw();
      p.poly([[hx + r * 0.7, hy - r * 0.05], [hx + r * 1.65, hy + r * 0.3], [hx + r * 0.7, hy + r * 0.6]], '#f0b54a');
      shadeForm(p, hx, hy, r, r * 0.95);
      p.line(`M${f(hx + r * 0.8)} ${f(hy + r * 0.3)}L${f(hx + r * 1.5)} ${f(hy + r * 0.3)}`, '#b9822a', 0.8);
      break;
    case 'blunt': {
      // A rounded skull with a big square jaw.
      p.ell(hx - r * 0.1, hy, r * 0.95, r * 0.92, c.base);
      const x0 = hx + r * 0.05, x1 = hx + r * 1.2, y0 = hy - r * 0.3, y1 = hy + r * 0.88, q = r * 0.36;
      p.path(`M${f(x0)} ${f(y0)}L${f(x1 - q)} ${f(y0)}Q${f(x1)} ${f(y0)} ${f(x1)} ${f(y0 + q)}L${f(x1)} ${f(y1 - q)}Q${f(x1)} ${f(y1)} ${f(x1 - q)} ${f(y1)}L${f(x0)} ${f(y1)}Z`, c.base);
      shadeForm(p, hx - r * 0.1, hy, r * 0.95, r * 0.92);
      p.line(`M${f(hx + r * 0.4)} ${f(hy + r * 0.52)}L${f(x1 - 0.5)} ${f(hy + r * 0.52)}`, c.out, 1.1);
      p.dot(hx + r * 1.0, hy - r * 0.02, r * 0.09, c.out);
      break;
    }
    case 'long':
      p.ell(hx + r * 0.25, hy + r * 0.05, r * 1.3, r * 0.78, c.base);
      shadeForm(p, hx + r * 0.25, hy + r * 0.05, r * 1.3, r * 0.78);
      p.dot(hx + r * 1.3, hy - r * 0.1, r * 0.1, c.out);
      break;
    case 'skull':
      p.ell(hx, hy, r, r * 0.95, c.base); jaw();
      p.ell(hx + r * 0.3, hy + r * 0.05, r * 0.78, r * 0.74, '#f1ead8');
      shadeForm(p, hx, hy, r, r * 0.95);
      break;
    default:
      p.ell(hx, hy, r, r * 0.95, c.base); jaw();
      shadeForm(p, hx, hy, r, r * 0.95);
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
    const mx = ph.head === 'beak' ? hx + r * 1.0 : ph.head === 'long' ? hx + r * 1.0 : ph.head === 'snout' ? hx + r * 0.95 : ph.head === 'blunt' ? hx + r * 0.85 : hx + r * 0.55;
    const my = ph.head === 'beak' ? hy + r * 0.5 : hy + r * 0.48;
    const mr = pose === 'hurt' ? r * 0.14 : pose === 'attack' ? r * 0.3 : r * 0.22;
    p.ell(mx, my, mr, mr * (pose === 'hurt' ? 1 : 0.8), '#3a1626');
    if (pose !== 'hurt') p.ell(mx, my + mr * 0.35, mr * 0.55, mr * 0.3, '#e0677a', { line: false });
  } else if (ph.head !== 'beak' && ph.head !== 'blunt') p.path(`M${f(hx + r * 0.25)} ${f(hy + r * 0.42)}Q${f(hx + r * 0.5)} ${f(hy + r * 0.62)} ${f(hx + r * 0.78)} ${f(hy + r * 0.4)}`, 'none', { stroke: c.out, sw: 1.1 });
}

/** Marking styles that are painted on the hide rather than attached to it. */
const SKIN = new Set(['ember1', 'spark1', 'venom1', 'terra1', 'stone2', 'void2', 'radiant1']);
const isSkin = (ph: Pheno) => ph.skel !== 'serpent' && SKIN.has(ph.el1 + (ph.mark ?? 0));

function drawPattern(p: Pen, a: Anchors, ph: Pheno, cue = 1) {
  const c = p.pal;
  const { bx, by, brx, bry } = a;
  // Painted element markings go first, so the belly patch, the arms and the shading all sit over them.
  if (isSkin(ph)) markStyle(p, a, ph.el1, cue, 0, ph, ph.mark ?? 0);
  switch (ph.pattern) {
    case 'belly': p.ell(bx + brx * 0.1, by + bry * 0.38, brx * 0.68, bry * 0.5, c.light, { line: false }); break;
    case 'spots':
      p.dot(bx - brx * 0.4, by - bry * 0.25, bry * 0.2, c.mark, 0.7); p.dot(bx + brx * 0.05, by - bry * 0.45, bry * 0.15, c.mark, 0.7);
      p.dot(bx - brx * 0.1, by + bry * 0.2, bry * 0.17, c.mark, 0.7); p.dot(bx + brx * 0.45, by - bry * 0.1, bry * 0.13, c.mark, 0.7);
      break;
    case 'stripes':
      for (const t of [-0.45, -0.05, 0.35]) p.path(`M${f(bx + brx * t)} ${f(by - bry * 0.8)}Q${f(bx + brx * (t + 0.14))} ${f(by - bry * 0.3)} ${f(bx + brx * (t - 0.02))} ${f(by + bry * 0.05)}`, 'none', { stroke: c.mark, sw: 2.2, op: 0.8 });
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
      star(p, bx - brx * 0.35, by - bry * 0.2, bry * 0.26, c.markGlow); star(p, bx + brx * 0.2, by + bry * 0.15, bry * 0.2, c.markGlow); star(p, bx + brx * 0.1, by - bry * 0.5, bry * 0.15, c.markGlow);
      break;
  }
}

/** Marking styles 1 and 2 for each element. Returns false when a style doesn't suit this body, so style 0 is used. */
function markStyle(p: Pen, a: Anchors, el: ElementId, s0: number, phase: number, ph: Pheno, v: number): boolean {
  const c = p.pal;
  const s = s0 * 1.2;
  const e = ELEMENTS[el];
  const { bx, by, brx, bry } = a;
  const H = headEllipse(ph, a.hx, a.hy, a.hr);
  // Frame on the back: lx runs toward the head, lo points out from the body.
  const [ox, oy, ang] = a.back ?? [a.backx, a.backy, 0];
  const Tx = Math.cos(ang), Ty = Math.sin(ang), Nx = Math.sin(ang), Ny = -Math.cos(ang);
  const B = (lx: number, lo: number) => [ox + lx * Tx + lo * Nx, oy + lx * Ty + lo * Ny];
  const b = (lx: number, lo: number) => { const [x, y] = B(lx, lo); return f(x) + ' ' + f(y); };
  const head = (deg: number, out = 0) => { const t = (deg * Math.PI) / 180; return [H.cx + (H.rx + out) * Math.cos(t), H.cy + (H.ry + out) * Math.sin(t)]; };
  const top = (u: number) => [H.cx + H.rx * u, H.cy - H.ry * Math.sqrt(Math.max(0, 1 - u * u))];
  const body = (u: number, w: number) => [bx + brx * u, by + bry * w];
  const line = (pts: number[][], col: string, w: number, op?: number) => p.line('M' + pts.map(([x, y]) => f(x) + ' ' + f(y)).join('L'), col, w, op);
  const was = p.g;
  const done = () => { p.g = was; return true; };
  /** A ring of fluffy puffs along the bottom-back of the head: a collar or ruff. */
  const ruff = (col: string, col2: string) => {
    for (let i = 0; i < 6; i++) { const [x, y] = head(95 + i * 22, 0.5); p.ell(x, y, 2.9 * s + 0.6, 2.5 * s + 0.6, i % 2 ? col : col2); }
  };
  /** A band that wraps the body: vertical on four-legged bodies, horizontal on upright ones. */
  const wrap = (u: number, w: number, col: string) => {
    const pts: string[] = [], back: string[] = [];
    for (let k = 0; k <= 6; k++) {
      if (a.flatBack) {
        const tt = u - w / 2 + (w * k) / 6, h = bry * Math.sqrt(Math.max(0, 1 - tt * tt)) * 0.97;
        pts.push(`${f(bx + brx * tt)} ${f(by - h)}`); back.unshift(`${f(bx + brx * tt)} ${f(by + h)}`);
      } else {
        const tt = u - w / 2 + (w * k) / 6, h = brx * Math.sqrt(Math.max(0, 1 - tt * tt)) * 0.97;
        pts.push(`${f(bx - h)} ${f(by + bry * tt)}`); back.unshift(`${f(bx + h)} ${f(by + bry * tt + 0.8)}`);
      }
    }
    p.path('M' + pts.join('L') + 'L' + back.join('L') + 'Z', col, { line: false });
  };
  switch (el) {
    case 'ember':
      if (v === 1) {
        // Painted flames: dark tongues licking up the hide (streaming back along the flank on long bodies),
        // each with a brighter core.
        const dark = mix(c.base, e.dark, 0.62), core = mix(c.base, e.glow, 0.6);
        const tongue = (x0: number, y0: number, x1: number, y1: number, w: number, bend: number, col: string) => {
          const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
          p.path(`M${f(x0 + nx * w / 2)} ${f(y0 + ny * w / 2)}Q${f(x0 + dx * 0.5 + nx * w * (0.75 + bend))} ${f(y0 + dy * 0.5 + ny * w * (0.75 + bend))} ${f(x1)} ${f(y1)}Q${f(x0 + dx * 0.45 - nx * w * (0.75 - bend))} ${f(y0 + dy * 0.45 - ny * w * (0.75 - bend))} ${f(x0 - nx * w / 2)} ${f(y0 - ny * w / 2)}Z`, col, { line: false });
        };
        const flames: [number, number, number, number, number, number][] = a.flatBack
          // from the shoulder, streaming back: [u0, w0, u1, w1, width, bend]
          ? [[0.5, -0.1, -0.5, -0.55, 0.5, 0.25], [0.5, 0.1, -0.72, -0.05, 0.55, -0.15], [0.45, 0.3, -0.35, 0.42, 0.42, 0.2]]
          // from the hips, rising up the back
          : [[-0.62, 0.42, -0.42, -0.58, 0.58, 0.25], [-0.25, 0.38, -0.02, -0.78, 0.62, -0.2], [0.12, 0.3, 0.32, -0.32, 0.42, 0.2]];
        const size = a.flatBack ? bry : brx;
        for (const [u0, w0, u1, w1, wd, bd] of flames) { const [x0, y0] = body(u0, w0), [x1, y1] = body(u1, w1); tongue(x0, y0, x1, y1, size * wd, bd, dark); }
        for (const [u0, w0, u1, w1, wd, bd] of flames) {
          const [x0, y0] = body(u0, w0), [x1, y1] = body(u0 + (u1 - u0) * 0.62, w0 + (w1 - w0) * 0.62);
          tongue(x0, y0, x1, y1, size * wd * 0.45, bd, core);
        }
        return done();
      }
      // A crest of flames along the head.
      [[-0.55, 3.2], [-0.15, 4.4], [0.25, 3.3]].forEach(([u, r]) => { const [x, y] = top(u); flame(p, x, y + 0.5, r * s, e.base, e.glow); });
      return done();
    case 'tide':
      if (v === 1) {
        // Feathery frills fanning out from the back of the head, like an axolotl's, plus gill slits.
        p.g = 'back';
        const sway = Math.sin(phase * TAU) * 0.8;
        [[168, 7], [196, 8.5], [224, 7.5]].forEach(([deg, len], i) => {
          const [x, y] = head(deg, -1.5), t = (deg * Math.PI) / 180;
          const tx = x + Math.cos(t) * len * s, ty = y + Math.sin(t) * len * s - 2 * s + sway * (i - 1);
          p.taper(x, y, tx, ty, 3 * s + 0.5, 1.6 * s + 0.3, '#f7a8c4', x + Math.cos(t) * len * 0.6 * s, y + Math.sin(t) * len * 0.6 * s - 3 * s);
          for (let j = 1; j <= 2; j++) { const q = 0.35 + j * 0.25, fx = x + (tx - x) * q, fy = y + (ty - y) * q; p.line(`M${f(fx)} ${f(fy)}l${f(-1.2 * s)} ${f(-1.6 * s)}M${f(fx)} ${f(fy)}l${f(1.6 * s)} ${f(-1 * s)}`, '#d9668f', 0.7); }
        });
        p.g = 'body';
        for (let i = 0; i < 3; i++) { const x = H.cx - H.rx * 0.45 + i * 1.9 * s, y = H.cy + H.ry * 0.38; p.line(`M${f(x)} ${f(y - 2 * s)}Q${f(x - 1 * s)} ${f(y)} ${f(x)} ${f(y + 2 * s)}`, e.dark, 0.9); }
        return done();
      }
      {
        // A shell that grows over the back like a turtle's: it follows the body's curve, with a pale rim and plates.
        if (ph.skel === 'serpent') return false;
        const shell = mix('#b9824e', e.dark, 0.25), plate = shade(shell, -0.14), rim = '#f1dfb8';
        const rimW = Math.min(brx, bry) * 0.13, N = 12, outer: number[][] = [], inner: number[][] = [];
        for (let i = 0; i <= N; i++) {
          const t = i / N;
          if (a.flatBack) {
            const u = -0.85 + 1.3 * t, h = bry * Math.sqrt(Math.max(0, 1 - u * u));
            outer.push([bx + brx * u, by - h - rimW * 0.6]);
            inner.unshift([bx + brx * u, by - bry * (0.02 + 0.2 * Math.sin(t * Math.PI))]);
          } else {
            const w = -0.85 + 1.5 * t, h = brx * Math.sqrt(Math.max(0, 1 - w * w));
            outer.push([bx - h - rimW * 0.6, by + bry * w]);
            inner.unshift([bx - brx * (0.25 + 0.2 * Math.sin(t * Math.PI)), by + bry * w]);
          }
        }
        p.poly([...outer, ...inner], shell);
        // Plates: seams from the rim up over the dome.
        for (const t of [0.3, 0.55, 0.8]) {
          const i = Math.round(t * N), [ox2, oy2] = outer[i], [ix, iy] = inner[N - i];
          line([[ix + (ox2 - ix) * 0.12, iy + (oy2 - iy) * 0.12], [ix + (ox2 - ix) * 0.85, iy + (oy2 - iy) * 0.85]], plate, 1.2);
        }
        line(outer.slice(2, N - 1).map(([x, y], i) => { const [ix, iy] = inner[N - 2 - i]; return [x + (ix - x) * 0.45, y + (iy - y) * 0.45]; }), plate, 1.1);
        // The pale rim along the lower edge.
        p.line('M' + inner.map(([x, y]) => f(x) + ' ' + f(y)).join('L'), rim, rimW);
        return done();
      }
    case 'verdant':
      if (v === 1) {
        // A blossom on the head with two leaves.
        const [x0, y0] = top(0.1), x = x0, y = y0 - 1.5 * s;
        p.path(`M${f(x)} ${f(y + 1)}Q${f(x - 6 * s)} ${f(y - 1 * s)} ${f(x - 7 * s)} ${f(y + 3 * s)}Q${f(x - 3 * s)} ${f(y + 3 * s)} ${f(x)} ${f(y + 1)}Z`, e.base);
        p.path(`M${f(x)} ${f(y + 1)}Q${f(x + 6 * s)} ${f(y - 1 * s)} ${f(x + 7 * s)} ${f(y + 3 * s)}Q${f(x + 3 * s)} ${f(y + 3 * s)} ${f(x)} ${f(y + 1)}Z`, e.base);
        for (let i = 0; i < 5; i++) { const t = -Math.PI / 2 + (i * 2 * Math.PI) / 5; p.ell(x + Math.cos(t) * 3.2 * s, y - 2.4 * s + Math.sin(t) * 3.2 * s, 2.9 * s, 2 * s, '#f49ac1', { rot: (t * 180) / Math.PI }); }
        p.dot(x, y - 2.4 * s, 1.9 * s + 0.3, '#ffd54a');
        return done();
      }
      // Little mushrooms growing on the back.
      for (const [lx, sc] of [[-3.5, 1], [3.5, 0.75]]) {
        const k = s * sc, mx = lx * s;
        p.path(`M${b(mx - 1.3 * k, -1)}L${b(mx - 1 * k, 4.5 * k)}L${b(mx + 1 * k, 4.5 * k)}L${b(mx + 1.3 * k, -1)}Z`, '#f3e6cf');
        p.path(`M${b(mx - 4.2 * k, 4 * k)}Q${b(mx, 10.5 * k)} ${b(mx + 4.2 * k, 4 * k)}Z`, '#d65745');
        for (const [dx, dy] of [[-1.8, 5.8], [1.2, 6.8], [0, 5]]) p.dot(...(B(mx + dx * k, dy * k) as [number, number]), 0.7 * k, '#fff6ea');
      }
      return done();
    case 'spark':
      if (v === 1) {
        // Zigzag stripes across the body.
        for (const u of [-0.45, 0, 0.42]) {
          const lim = Math.sqrt(1 - u * u) * 0.78, pts: number[][] = [];
          for (let i = 0; i <= 4; i++) pts.push(body(u + (i % 2 ? 0.09 : -0.05), -lim + (2 * lim * i) / 4));
          line(pts, e.dark, 2 * s + 0.6);
        }
        return done();
      }
      {
        // A lure: a stalk from the head ending in a glowing bulb.
        const [x, y] = top(0.15);
        const bxx = x + 6 * s, byy = y - 10 * s + Math.sin(phase * TAU) * 0.8;
        p.taper(x, y + 1, bxx, byy, 1.8 * s + 0.4, 1 * s + 0.3, c.dark, x - 2 * s, y - 9 * s);
        p.g = 'fx';
        p.dot(bxx, byy, 4.2 * s, e.glow, 0.35);
        p.g = 'body';
        p.ell(bxx, byy, 2.4 * s + 0.3, 2.4 * s + 0.3, e.light);
        p.dot(bxx - 0.8 * s, byy - 0.8 * s, 0.8 * s, '#ffffff');
        return done();
      }
    case 'frost':
      if (v === 1) {
        // A cap of snow on the head with icicles at its edge.
        const N = 10, up: string[] = [], dn: string[] = [];
        for (let i = 0; i <= N; i++) {
          const u = -0.8 + (1.4 * i) / N, [x, y] = top(u), bump = 2.6 * s * (1 + 0.25 * Math.sin(i * 1.9)) * Math.sqrt(Math.max(0, 1 - ((u + 0.1) / 0.75) ** 2));
          up.push(`${f(x)} ${f(y - bump)}`); dn.unshift(`${f(x)} ${f(y + 1.2 * s + 0.4)}`);
        }
        p.path('M' + up.join('L') + 'L' + dn.join('L') + 'Z', '#f4fbff');
        for (const u of [0.25, 0.45]) { const [x, y] = top(u); p.poly([[x - 1.1 * s, y + 1], [x, y + 4.5 * s], [x + 1.1 * s, y + 1]], '#cfefff'); }
        return done();
      }
      ruff('#f4fbff', '#dff3ff');
      return done();
    case 'brawn':
      if (v === 1) {
        // A belt with a gold buckle, plus scars.
        if (!a.flatBack && !a.back) return false;
        if (ph.skel === 'serpent') return false;
        wrap(a.flatBack ? 0.12 : 0.22, 0.2, '#3a2b25');
        const [x, y] = a.flatBack ? body(0.12, 0.62) : body(0.62, 0.22);
        p.path(`M${f(x - 2 * s)} ${f(y - 1.8 * s)}L${f(x + 2 * s)} ${f(y - 1.8 * s)}L${f(x + 2 * s)} ${f(y + 1.8 * s)}L${f(x - 2 * s)} ${f(y + 1.8 * s)}Z`, '#e8b93c');
        p.path(`M${f(x - 0.9 * s)} ${f(y - 0.8 * s)}L${f(x + 0.9 * s)} ${f(y - 0.8 * s)}L${f(x + 0.9 * s)} ${f(y + 0.8 * s)}L${f(x - 0.9 * s)} ${f(y + 0.8 * s)}Z`, '#3a2b25', { line: false });
        line([body(-0.5, -0.5), body(-0.25, -0.15)], e.dark, 1.2 * s);
        return done();
      }
      {
        // Bandages: a crossed plaster on the head and a wrap on the body.
        const [x, y] = [H.cx - H.rx * 0.35, H.cy - H.ry * 0.55];
        for (const r of [35, -35]) p.ell(x, y, 4.2 * s + 0.4, 1.5 * s + 0.3, '#f1d6b0', { rot: r });
        wrap(a.flatBack ? -0.3 : -0.05, 0.16, '#f1e4cf');
        const [sx, sy] = a.flatBack ? body(-0.3, -0.2) : body(-0.4, -0.05);
        line([[sx - 1.2 * s, sy], [sx + 1.2 * s, sy]], '#c9b08e', 0.7);
        return done();
      }
    case 'venom':
      if (v === 1) {
        // Bright warning spots.
        for (const [u, w, r] of [[-0.45, -0.3, 2.6], [0.05, -0.5, 2], [-0.1, 0.15, 2.2], [0.42, -0.1, 1.7], [-0.55, 0.3, 1.4]]) {
          const [x, y] = body(u, w);
          p.ell(x, y, r * s + 0.3, r * s + 0.3, e.dark, { line: false });
          p.dot(x, y, r * s * 0.6 + 0.2, e.glow);
        }
        return done();
      }
      // A row of quills down the back with poison-green tips.
      [-6, -2, 2, 6].forEach((lx, i) => {
        const h = (7.5 - Math.abs(lx) * 0.35) * s, x0 = lx * s;
        p.poly([B(x0 - 1.6 * s, -1), B(x0 - 2.2 * s, h), B(x0 + 1.6 * s, -1)], e.base);
        p.poly([B(x0 - 1.2 * s, h * 0.7), B(x0 - 2.2 * s, h), B(x0 - 0.2 * s, h * 0.7)], e.glow, { line: false });
        void i;
      });
      return done();
    case 'terra':
      if (v === 1) {
        // A plated hide like baked, cracked earth: a honeycomb of plates across the back.
        const r = Math.min(brx, bry) * 0.26;
        const [cx, cy] = a.flatBack ? body(-0.2, -0.38) : body(-0.32, -0.22);
        const seam = mix(c.base, e.dark, 0.7);
        for (const [i, j] of [[-1, -0.5], [0, -0.5], [1, -0.5], [-0.5, 0.42], [0.5, 0.42], [1.5, 0.42]]) {
          const x = cx + i * r * 1.75, y = cy + j * r * 1.75, k = r * 0.94;
          const pts = [0, 1, 2, 3, 4, 5].map(q => [x + Math.cos((q * Math.PI) / 3 + Math.PI / 6) * k, y + Math.sin((q * Math.PI) / 3 + Math.PI / 6) * k]);
          p.path('M' + pts.map(([px, py]) => f(px) + ' ' + f(py)).join('L') + 'Z', shade(c.base, (i + j) % 1 === 0 ? 0.13 : 0.07), { stroke: seam, sw: 1.2 });
        }
        return done();
      }
      // A ridge of pebbles along the back.
      [-8, -4, 0, 4, 8].forEach((lx, i) => {
        const [x, y] = B(lx * s, 1.2 * s);
        p.ell(x, y, (2.6 - Math.abs(lx) * 0.08) * s + 0.3, (2.1 - Math.abs(lx) * 0.06) * s + 0.3, ['#9c9384', '#b3aa98', e.light][i % 3], { rot: (ang * 180) / Math.PI });
      });
      return done();
    case 'gale':
      if (v === 1) {
        // A wind-swept mane: long tufts blown back off the head.
        const sway = Math.sin(phase * TAU) * 1.5;
        [[-0.1, 15, e.light], [-0.45, 12, '#ffffff'], [0.25, 11, e.light]].forEach(([u, len, col], i) => {
          const [x, y] = top(u as number), L = (len as number) * s;
          p.taper(x, y + 1.5, x - L, y + 2 * s + sway * (1 + i * 0.3) - i * 1.5 * s, 4 * s + 0.5, 0.8, col as string, x - L * 0.45, y - 5 * s);
        });
        return done();
      }
      // A little cloud riding on the back.
      for (const [lx, lo, r] of [[-5, 2.5, 3.6], [0, 4.5, 4.6], [5, 2.8, 3.4], [-1, 1, 3.6], [3, 1.2, 3.2]]) p.ell(...(B(lx * s, lo * s) as [number, number]), r * s + 0.3, r * s * 0.85 + 0.3, '#ffffff');
      p.ell(...(B(0, 0.8 * s) as [number, number]), 6 * s, 1.6 * s, '#d8ecf6', { line: false });
      return done();
    case 'mind':
      if (v === 1) {
        // A third eye on the forehead.
        p.g = 'face';
        const x = H.cx + H.rx * 0.3, y = H.cy - H.ry * 0.6, w = 3.2 * s + 0.4, h = 1.8 * s + 0.3;
        p.path(`M${f(x - w)} ${f(y)}Q${f(x)} ${f(y - h * 2)} ${f(x + w)} ${f(y)}Q${f(x)} ${f(y + h * 2)} ${f(x - w)} ${f(y)}Z`, '#ffffff');
        p.dot(x, y, h * 0.95, e.base); p.dot(x, y, h * 0.5, INK); p.dot(x - h * 0.35, y - h * 0.35, h * 0.28, '#ffffff');
        return done();
      }
      // Two orbs that orbit the head.
      for (let i = 0; i < 2; i++) {
        const t = phase * TAU + i * Math.PI, x = H.cx + Math.cos(t) * H.rx * 1.45, y = H.cy - H.ry * 0.85 + Math.sin(t) * H.ry * 0.35;
        p.g = Math.sin(t) < 0 ? 'back' : 'fx';
        p.dot(x, y, 4.2 * s + 0.5, e.base, 0.3); p.ell(x, y, 2.2 * s + 0.3, 2.2 * s + 0.3, e.base); p.dot(x - 0.7 * s, y - 0.7 * s, 0.7 * s, '#ffffff');
      }
      return done();
    case 'swarm':
      if (v === 1) {
        // A glossy beetle shell over the back.
        p.path(`M${b(-8 * s, -1.5)}Q${b(-8 * s, 8 * s)} ${b(1 * s, 8.5 * s)}Q${b(8 * s, 7.5 * s)} ${b(8 * s, -1.5)}Z`, e.dark);
        p.line(`M${b(-6 * s, 1 * s)}Q${b(0, 7.6 * s)} ${b(6 * s, 1 * s)}`, shade(e.dark, 0.15), 0.8);
        p.ell(...(B(-2.5 * s, 5.5 * s) as [number, number]), 2.6 * s, 0.9 * s, '#ffffff', { line: false, op: 0.35, rot: (ang * 180) / Math.PI });
        return done();
      }
      // Tiny bugs buzzing around it.
      p.g = 'fx';
      for (let i = 0; i < 3; i++) {
        const t = phase * TAU * 2 + i * 2.1, x = bx + brx * (-0.8 + i * 0.8) + Math.sin(t) * 3, y = by - bry * 1.25 - (i % 2) * 5 + Math.cos(t) * 2;
        p.ell(x - 1.3, y - 1.6, 2.2, 1.2, '#ffffff', { line: false, op: 0.75, rot: -30 }); p.ell(x + 0.8, y - 1.7, 1.9, 1.1, '#ffffff', { line: false, op: 0.75, rot: 30 });
        p.ell(x, y, 1.8, 1.4, e.dark); p.dot(x + 1.1, y - 0.2, 0.5, '#ffffff');
      }
      return done();
    case 'stone':
      if (v === 1) {
        // A single big boulder on the back.
        const pts = [[-8, -1.5], [-8.6, 4], [-5, 8.6], [1, 10], [6.6, 7.6], [8.6, 2.4], [8, -1.5]].map(([lx, lo]) => B(lx * s, lo * s));
        p.poly(pts, e.base);
        p.poly([[-5, 7.6], [0.5, 9], [-1, 5], [-5.5, 4.5]].map(([lx, lo]) => B(lx * s, lo * s)), e.light, { line: false });
        p.line(`M${b(3 * s, 8.5 * s)}L${b(2 * s, 5 * s)}L${b(4 * s, 3 * s)}`, e.dark, 0.8);
        return done();
      }
      // Gems set into the hide, with cracks around them.
      for (const [u, w, col] of [[-0.35, -0.25, '#7fd6e8'], [0.25, -0.4, '#b493e0'], [0.05, 0.25, '#7fe8b0']] as [number, number, string][]) {
        const [x, y] = body(u, w), r = 2.3 * s + 0.3;
        p.poly([0, 1, 2, 3, 4, 5].map(i => [x + Math.cos((i * Math.PI) / 3) * r, y + Math.sin((i * Math.PI) / 3) * r * 0.85]), col);
        p.poly([[x - r * 0.5, y - r * 0.4], [x + r * 0.2, y - r * 0.6], [x, y]], '#ffffff', { line: false, op: 0.5 });
        line([[x + r, y], [x + r * 1.8, y + r * 0.4], [x + r * 2.2, y + r * 0.1]], e.dark, 0.6);
      }
      return done();
    case 'spirit':
      if (v === 1) {
        // A pale ghost-flame flickering on the head.
        const [x, y] = top(-0.05);
        flame(p, x, y + 0.5, (5.6 + Math.sin(phase * TAU * 2) * 0.5) * s, '#7fd0ff', '#e6f8ff');
        return done();
      }
      // Pale soul orbs circling.
      for (let i = 0; i < 3; i++) {
        const t = phase * TAU + (i * TAU) / 3, x = bx + Math.cos(t) * brx * 1.3, y = by - bry * 0.8 + Math.sin(t) * bry * 0.45;
        p.g = Math.sin(t) < 0 ? 'back' : 'fx';
        p.dot(x + Math.sin(t) * 3, y - Math.cos(t) * 1.2, 2 * s + 0.2, '#9fdcff', 0.4);
        p.dot(x, y, 3.6 * s + 0.4, '#9fdcff', 0.45); p.dot(x, y, 2 * s + 0.3, '#ffffff', 0.95);
      }
      return done();
    case 'wyrm':
      if (v === 1) {
        // Spines down the back of the head and neck.
        [178, 198, 218, 238].forEach((deg, i) => {
          const [a1x, a1y] = head(deg - 9), [a2x, a2y] = head(deg + 9), [tx, ty] = head(deg - 6, (7 - i * 0.9) * s);
          p.poly([[a1x, a1y], [tx, ty], [a2x, a2y]], e.glow);
        });
        return done();
      }
      {
        // Long whiskers from the snout, and rows of scales.
        p.g = 'face';
        const sway = Math.sin(phase * TAU) * 1.2;
        const x = H.cx + H.rx * 0.82, y = H.cy + H.ry * 0.3;
        p.taper(x, y, x - 3 * s, y + 11 * s + sway, 1.4 * s + 0.4, 0.4, e.glow, x + 6 * s, y + 4 * s);
        p.taper(x - 1, y + 1, x - 7 * s, y + 9 * s - sway, 1.2 * s + 0.3, 0.4, e.glow, x + 3 * s, y + 6 * s);
        p.g = 'body';
        for (let r = 0; r < 2; r++) for (let i = 0; i < 4; i++) {
          const [sx, sy] = body(-0.45 + i * 0.28 + r * 0.14, -0.35 + r * 0.32);
          p.line(`M${f(sx - 1.6 * s)} ${f(sy)}Q${f(sx)} ${f(sy + 2 * s)} ${f(sx + 1.6 * s)} ${f(sy)}`, e.dark, 0.7, 0.7);
        }
        return done();
      }
    case 'shade':
      if (v === 1) {
        // A hood drawn over the back of the head.
        const pts: string[] = [];
        for (let deg = 160; deg <= 300; deg += 14) { const [x, y] = head(deg, 1); pts.push(`${f(x)} ${f(y)}`); }
        const [px, py] = head(205, 6 * s);
        const [ix, iy] = head(300, -H.rx * 0.35), [jx, jy] = head(160, -H.rx * 0.3);
        p.path(`M${pts[0]}L${f(px)} ${f(py)}L${pts.slice(3).join('L')}Q${f(ix)} ${f(iy)} ${f(H.cx - H.rx * 0.1)} ${f(H.cy)}Q${f(jx)} ${f(jy)} ${pts[0]}Z`, e.dark);
        return done();
      }
      // A tattered cape flowing off the back.
      p.path(`M${b(4 * s, 0)}Q${b(-4 * s, 6 * s)} ${b(-15 * s, 1 * s)}L${b(-13 * s, -6 * s)}L${b(-10 * s, -3.5 * s)}L${b(-7.5 * s, -8 * s)}L${b(-4.5 * s, -4.5 * s)}L${b(-1.5 * s, -7 * s)}L${b(1 * s, -2 * s)}Z`, e.dark);
      p.ell(...(B(3.5 * s, 0.5 * s) as [number, number]), 2.2 * s, 1.6 * s, e.glow, { op: 0.9 });
      return done();
    case 'forge':
      if (v === 1) {
        // A cog turning slowly on the back.
        const [gx, gy] = B(0, 3.5 * s), r1 = 5 * s, r2 = 6.6 * s, rot = (phase * TAU) / 8, pts: number[][] = [];
        for (let i = 0; i < 32; i++) { const t = rot + (i * TAU) / 32, r = i % 4 < 2 ? r2 : r1; pts.push([gx + Math.cos(t) * r, gy + Math.sin(t) * r]); }
        p.poly(pts, e.base);
        p.ell(gx, gy, 2.2 * s, 2.2 * s, e.dark);
        p.dot(gx - 0.7 * s, gy - 0.7 * s, 0.6 * s, '#ffffff', 0.6);
        return done();
      }
      {
        // A riveted metal band and a bolt on the head.
        wrap(a.flatBack ? -0.15 : 0.1, 0.17, '#c98b4f');
        for (const w of [-0.5, 0, 0.5]) { const [x, y] = a.flatBack ? body(-0.15, w) : body(w, 0.1); p.dot(x, y, 0.85 * s + 0.2, '#5a3a22'); }
        const [x, y] = top(0.05);
        p.poly([0, 1, 2, 3, 4, 5].map(i => [x + Math.cos((i * Math.PI) / 3) * 2.4 * s, y - 0.8 * s + Math.sin((i * Math.PI) / 3) * 1.7 * s]), '#c98b4f');
        p.line(`M${f(x - 1.3 * s)} ${f(y - 0.8 * s)}L${f(x + 1.3 * s)} ${f(y - 0.8 * s)}`, '#5a3a22', 0.9);
        return done();
      }
    case 'glimmer':
      if (v === 1) {
        // A ribbon bow on the head.
        const [x0, y0] = top(-0.3), x = x0, y = y0 - 0.5;
        const pink = '#f48fb1', dk = '#c75b86';
        p.path(`M${f(x)} ${f(y)}Q${f(x - 6 * s)} ${f(y - 6 * s)} ${f(x - 6 * s)} ${f(y)}Q${f(x - 6 * s)} ${f(y + 4 * s)} ${f(x)} ${f(y)}Z`, pink);
        p.path(`M${f(x)} ${f(y)}Q${f(x + 6 * s)} ${f(y - 6 * s)} ${f(x + 6 * s)} ${f(y)}Q${f(x + 6 * s)} ${f(y + 4 * s)} ${f(x)} ${f(y)}Z`, pink);
        p.ell(x, y, 1.5 * s + 0.3, 1.5 * s + 0.3, dk);
        return done();
      }
      {
        // A crescent moon on the forehead with sparkles.
        p.g = 'face';
        const x = H.cx + H.rx * 0.2, y = H.cy - H.ry * 0.55, r = 3.8 * s + 0.4;
        p.path(`M${f(x)} ${f(y - r)}A${f(r)} ${f(r)} 0 1 0 ${f(x)} ${f(y + r)}A${f(r * 0.72)} ${f(r)} 0 1 1 ${f(x)} ${f(y - r)}Z`, '#ffd166', { stroke: '#b8862b', sw: 0.8 });
        p.g = 'fx';
        star(p, H.cx + H.rx * 1.1, H.cy - H.ry * 1.0, 2 * s, e.glow); star(p, H.cx - H.rx * 0.9, H.cy - H.ry * 1.15, 1.5 * s, e.glow);
        return done();
      }
    case 'plain':
      if (v === 1) {
        // A cowlick: a tuft of hair curling forward.
        const [x, y] = top(-0.1);
        for (const [dx, h, cur] of [[-2, 4.5, -2], [0, 6, 1], [2, 4.8, 3]]) p.taper(x + dx * s, y + 1.2, x + (dx + cur) * s, y - h * s, 2.6 * s + 0.4, 0.6, c.base, x + (dx - 1.5) * s, y - h * 0.8 * s);
        return done();
      }
      ruff(c.light, mix(c.light, '#ffffff', 0.4));
      return done();
    case 'radiant':
      if (v === 1) {
        // A sun sigil glowing on the chest.
        const [x, y] = a.flatBack ? body(0.3, -0.05) : body(0.15, -0.15), r = 2.4 * s + 0.4;
        for (let i = 0; i < 8; i++) { const t = (i * TAU) / 8; line([[x + Math.cos(t) * r * 1.3, y + Math.sin(t) * r * 1.3], [x + Math.cos(t) * r * 1.9, y + Math.sin(t) * r * 1.9]], e.dark, 0.9); }
        p.ell(x, y, r, r, e.glow); p.dot(x, y, r * 0.5, e.base);
        return done();
      }
      {
        // A mane of sun rays fanning out behind the head.
        p.g = 'back';
        for (let i = 0; i < 12; i++) {
          const t = (i * TAU) / 12, r0 = H.rx * 0.8, r1 = H.rx * 0.85 + (i % 2 ? 5 : 8) * s;
          p.poly([[H.cx + Math.cos(t - 0.22) * r0, H.cy + Math.sin(t - 0.22) * r0 * 0.95], [H.cx + Math.cos(t) * r1, H.cy + Math.sin(t) * r1 * 0.95], [H.cx + Math.cos(t + 0.22) * r0, H.cy + Math.sin(t + 0.22) * r0 * 0.95]], i % 2 ? e.base : e.glow);
        }
        return done();
      }
    case 'void':
      if (v === 1) {
        // Shards of the dark drifting round the body.
        for (let i = 0; i < 3; i++) {
          const t = phase * TAU * 0.5 + i * 2.1, x = bx + Math.cos(t) * brx * 1.3, y = by - bry * 0.5 + Math.sin(t) * bry * 0.55, r = (3.4 - i * 0.4) * s + 0.5;
          p.g = Math.sin(t) < 0 ? 'back' : 'fx';
          p.poly([[x, y - r * 1.4], [x + r * 0.7, y], [x + r * 0.1, y + r * 1.2], [x - r * 0.7, y + r * 0.2]], e.dark);
          p.dot(x + r * 0.1, y - r * 0.3, r * 0.25, e.glow);
        }
        return done();
      }
      {
        // A rift of starlight torn into the body.
        const [x, y] = body(-0.15, -0.1), w = 2.4 * s + 0.4, h = 6 * s + 0.5;
        const d = `M${f(x)} ${f(y - h)}Q${f(x + w * 1.6)} ${f(y)} ${f(x)} ${f(y + h)}Q${f(x - w * 1.6)} ${f(y)} ${f(x)} ${f(y - h)}Z`;
        p.path(d, '#0b0618', { line: false });
        p.path(d, 'none', { stroke: e.glow, sw: 0.9 });
        for (const [dx, dy, r] of [[-0.3, -0.5, 0.6], [0.4, 0.1, 0.5], [-0.1, 0.55, 0.45], [0.2, -0.2, 0.35]]) p.dot(x + dx * w, y + dy * h, r * s + 0.2, e.glow);
        return done();
      }
  }
  p.g = was;
  return false;
}

/** The head's outline as an ellipse, for things that sit on or wrap around it. */
function headEllipse(ph: Pheno, hx: number, hy: number, hr: number) {
  if (ph.head === 'long') return { cx: hx + hr * 0.25, cy: hy + hr * 0.05, rx: hr * 1.3, ry: hr * 0.78 };
  if (ph.head === 'blunt') return { cx: hx - hr * 0.1, cy: hy, rx: hr * 0.95, ry: hr * 0.92 };
  return { cx: hx, cy: hy, rx: hr, ry: hr * 0.95 };
}

/** A fighter's headband: a red band wrapped round the forehead, knotted at the back with two tails. */
function headband(p: Pen, a: Anchors, ph: Pheno, s: number, phase: number) {
  const { cx, cy, rx, ry } = headEllipse(ph, a.hx, a.hy, a.hr);
  // Red cloth, unless the creature is already reddish: then white cloth with a red stripe, so it stands out.
  const [hue, sat] = hexToHsl(p.pal.base);
  const reddish = sat > 0.25 && (hue < 30 || hue > 330);
  const red = reddish ? '#f4efe6' : '#d7443e', dark = reddish ? '#d7443e' : '#9c2724';
  const y1 = cy - ry * 0.7, y2 = cy - ry * 0.7 + ry * 0.26 * Math.max(0.7, s);
  const half = (y: number) => rx * Math.sqrt(Math.max(0, 1 - ((y - cy) / ry) ** 2)) + 0.6;
  const t1 = half(y1), t2 = half(y2), bow = ry * 0.08;
  const was = p.g;
  p.g = 'face';
  // The tails flutter behind the knot.
  const kx = cx - (t1 + t2) / 2, ky = (y1 + y2) / 2;
  const fl = Math.sin(phase * TAU) * 1.5;
  p.taper(kx, ky, kx - 9 * s - 2, ky + 4 * s + fl, 2.6 * s + 0.6, 1.4 * s + 0.4, red, kx - 5 * s, ky - 1);
  p.taper(kx, ky, kx - 7 * s - 2, ky + 8 * s - fl, 2.6 * s + 0.6, 1.4 * s + 0.4, dark, kx - 3 * s, ky + 4 * s);
  p.path(`M${f(cx - t1)} ${f(y1)}Q${f(cx)} ${f(y1 + bow)} ${f(cx + t1)} ${f(y1)}L${f(cx + t2)} ${f(y2)}Q${f(cx)} ${f(y2 + bow)} ${f(cx - t2)} ${f(y2)}Z`, red);
  p.line(`M${f(cx - t1 * 0.9)} ${f((y1 + y2) / 2 + bow * 0.5)}Q${f(cx)} ${f((y1 + y2) / 2 + bow)} ${f(cx + t1 * 0.9)} ${f((y1 + y2) / 2 + bow * 0.5)}`, dark, 0.7);
  p.ell(kx, ky, 2 * s + 0.6, 2.4 * s + 0.6, red);
  p.g = was;
}

/** Element look cues. A baby shows only a hint; the full markings arrive with maturity. */
function drawCues(p: Pen, a: Anchors, el: ElementId, k: number, phase: number, minor: boolean, ph1: Pheno) {
  const c = p.pal;
  const e = ELEMENTS[el];
  const s = k * (minor ? 0.7 : 1);
  const { hx, hy, hr, bx, by, brx, bry, backx, backy } = a;
  // Each element has three marking styles; style 0 is drawn below, styles 1 and 2 in markStyle.
  const style = minor ? 0 : ph1.mark ?? 0;
  if (style > 0 && k < 0.5 && !isSkin(ph1)) { drawCues(p, a, el, k, phase, minor, { ...ph1, mark: 0 }); return; }
  if (style > 0 && (isSkin(ph1) || markStyle(p, a, el, s, phase, ph1, style))) return;
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
      headband(p, a, ph1, s, phase);
      break;
    case 'venom':
      for (const t of [0.2, 0.5, 0.75]) p.path(`M${f(bx - brx * 0.6 + brx * 1.2 * t)} ${f(by + bry * 0.85)}q${f(1.5 * s)} ${f(3.5 * s)} 0 ${f(5 * s)}q${f(-1.5 * s)} ${f(-1.5 * s)} 0 ${f(-5 * s)}Z`, e.glow, { line: false });
      p.poly([[hx + hr * 0.45, hy + hr * 0.5], [hx + hr * 0.55, hy + hr * 0.5 + 4 * s], [hx + hr * 0.68, hy + hr * 0.48]], '#ffffff');
      break;
    case 'terra': {
      // A lumpy mound of soil with a sprout and pebbles. It sits on the body's top surface (or the top of the head
      // for upright, long and floating bodies), sinks a little into it, and fades into it through a soft soil stain.
      const surf = a.flatBack ? { cx: bx, cy: by, rx: brx, ry: bry } : headEllipse(ph1, hx, hy, hr);
      const mx = a.flatBack ? bx - brx * 0.2 : hx - hr * 0.22;
      const sy = (x: number) => surf.cy - surf.ry * Math.sqrt(Math.max(0, 1 - ((x - surf.cx) / surf.rx) ** 2));
      const W = (a.flatBack ? 10 : 7.5) * s, H = (a.flatBack ? 6.5 : 5.2) * s, sink = 1.2 * s + 0.3;
      const soil = e.dark, soilLight = shade(e.dark, 0.12);
      // Soil stain: a band just inside the surface, widest under the mound and thinning out to either side.
      const N = 12, top: string[] = [], bot: string[] = [];
      for (let i = 0; i <= N; i++) {
        const u = (i / N) * 2 - 1, x = mx + u * W * 1.45;
        top.push(`${f(x)} ${f(sy(x) + 0.4)}`);
        bot.unshift(`${f(x)} ${f(sy(x) + 0.4 + 3.6 * s * (1 - u * u))}`);
      }
      p.path('M' + top.join('L') + 'L' + bot.join('L') + 'Z', soil, { line: false, op: 0.3 });
      // The mound: a lumpy top over a base that follows the surface.
      const lump: string[] = [], base: string[] = [];
      for (let i = 0; i <= N; i++) {
        const u = (i / N) * 2 - 1, x = mx + u * W;
        const h = H * Math.pow(Math.max(0, 1 - u * u), 0.6) * (1 + 0.14 * Math.sin((u + 1) * Math.PI * 2.5));
        lump.push(`${f(x)} ${f(sy(x) + sink - h)}`);
        base.unshift(`${f(x)} ${f(sy(x) + sink)}`);
      }
      p.path('M' + lump.join('L') + 'L' + base.join('L') + 'Z', soil);
      p.ell(mx - W * 0.3, sy(mx - W * 0.3) + sink - H * 0.62, W * 0.3, H * 0.18, soilLight, { line: false, op: 0.7, rot: -12 });
      p.dot(mx - W * 0.45, sy(mx - W * 0.45) + sink - H * 0.3, 1.3 * s + 0.3, '#9c9384');
      p.dot(mx + W * 0.42, sy(mx + W * 0.42) + sink - H * 0.25, 1.05 * s + 0.3, '#b3aa98');
      // Crumbs on the body around the mound.
      for (const [u, d] of [[-1.2, 2.2], [1.15, 1.8], [-0.7, 3.4], [0.75, 3.1]]) p.dot(mx + u * W, sy(mx + u * W) + d * s + 0.5, 0.55 * s + 0.25, soil, 0.7);
      // Sprout.
      const g = ELEMENTS.verdant, tx2 = mx + W * 0.05, ty2 = sy(tx2) + sink - H * 0.95;
      p.line(`M${f(tx2)} ${f(ty2)}Q${f(tx2 - 1 * s)} ${f(ty2 - 4 * s)} ${f(tx2 - 4 * s)} ${f(ty2 - 6 * s)}`, g.dark, 1.5 * s + 0.4);
      p.line(`M${f(tx2)} ${f(ty2)}Q${f(tx2 + 1 * s)} ${f(ty2 - 5 * s)} ${f(tx2 + 3.5 * s)} ${f(ty2 - 7 * s)}`, g.base, 1.5 * s + 0.4);
      p.path(`M${f(tx2 + 3.5 * s)} ${f(ty2 - 7 * s)}q${f(4 * s)} ${f(-2 * s)} ${f(5 * s)} ${f(1 * s)}q${f(-3 * s)} ${f(1.5 * s)} ${f(-5 * s)} ${f(-1 * s)}Z`, g.light, { line: false });
      break;
    }
    case 'gale': {
      // A painted wind swirl on the flank (and a small one on the cheek): a spiral that trails off into a gust.
      const swirl = (cx: number, cy: number, R: number) => {
        const pts: string[] = [];
        for (let i = 0; i <= 26; i++) { const t = i / 26, r = R * (0.18 + 0.82 * t), q = Math.PI * 0.2 - t * TAU * 1.15; pts.push(`${f(cx + Math.cos(q) * r)} ${f(cy + Math.sin(q) * r * 0.85)}`); }
        const [ex, ey] = pts[pts.length - 1].split(' ').map(Number);
        const d = 'M' + pts.join('L') + `Q${f(ex - R * 0.9)} ${f(ey + R * 0.25)} ${f(ex - R * 1.9)} ${f(ey - R * 0.05)}`;
        p.line(d, e.dark, 3.4 * s + 0.6); p.line(d, '#ffffff', 2 * s + 0.4);
      };
      if (minor) { swirl(bx - brx * 0.05, by - bry * 0.1, 4 * s); break; }
      if (a.flatBack) swirl(bx - brx * 0.05, by - bry * 0.12, 6.5 * s); else swirl(bx + brx * 0.05, by - bry * 0.12, 6 * s);
      swirl(hx - hr * 0.2, hy + hr * 0.2, 2.8 * s);
      break;
    }
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

/** How each stance leans and lowers each body plan. lean: degrees, forward is positive (head goes down for
 *  long bodies). drop: how far the body sinks, so legs bend. hdx/hdy nudge the head before the lean. px: the
 *  pivot, as a fraction of the body's half-width from its centre. */
interface StancePose { lean: number; drop: number; hdx: number; hdy: number; px?: number; ft?: number; sx?: number }
const S0: StancePose = { lean: 0, drop: 0, hdx: 0, hdy: 0 };
const STANCES: Record<Skeleton, StancePose[]> = {
  biped: [S0, { lean: 9, drop: 4, hdx: 1, hdy: 1, ft: 6 }, { lean: -9, drop: 0, hdx: -1, hdy: -3, ft: 2, sx: 2 }, { lean: 14, drop: 3, hdx: 3, hdy: 6, ft: 3 }],
  // Prowl: low, stalking, head at shoulder height. Proud: chest and neck up. Hunched: a play-bow, front down.
  quad: [S0, { lean: 3, drop: 8, hdx: 3, hdy: 11, ft: 4 }, { lean: -12, drop: 0, hdx: -2, hdy: -8, sx: 4 }, { lean: 16, drop: 1, hdx: 1, hdy: 2, px: -0.7, ft: 2 }],
  multi: [S0, { lean: 0, drop: 7, hdx: 0, hdy: 4, ft: 3, sx: -1 }, { lean: -13, drop: 0, hdx: 0, hdy: -4, sx: 4 }, { lean: 12, drop: 1, hdx: 0, hdy: 3, px: 1, sx: -2 }],
  // Serpents carry the stance in the neck: a low strike, reared up tall, or coiled down.
  serpent: [S0, { lean: 0, drop: 0, hdx: 9, hdy: 16 }, { lean: 0, drop: 0, hdx: -4, hdy: -9 }, { lean: 0, drop: 0, hdx: 3, hdy: 22 }],
  aquatic: [S0, { lean: 14, drop: 4, hdx: 0, hdy: 0 }, { lean: -16, drop: -1, hdx: 0, hdy: 0 }, { lean: 8, drop: 7, hdx: 0, hdy: 2 }],
  floater: [S0, { lean: 16, drop: 2, hdx: 0, hdy: 0 }, { lean: -13, drop: -1, hdx: 0, hdy: 0, sx: 2 }, { lean: 22, drop: 6, hdx: 0, hdy: 3 }],
};

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
  // A fainted creature slumps upright-ish; otherwise it holds its stance.
  const sp = o.ko ? S0 : STANCES[ph.skel][ph.stance ?? 0] ?? S0;
  /** A leg from a hip on the leaned body down to the ground, bending at the knee when the body sinks. */
  const leg = (hx0: number, hy0: number, fx: number, fy: number, w0: number, w1: number, col: string, kx?: number, ky?: number, knee = 1) => {
    const [x1, y1] = p.at(hx0, hy0);
    p.free(() => {
      const bend = Math.max(0, sp.drop + Math.max(0, y1 - hy0 - sp.drop) * 0.6) * 0.9 * knee;
      const mx = kx ?? (x1 + fx) / 2, my = ky ?? (y1 + fy) / 2;
      p.taper(x1, y1, fx, fy, w0, w1, col, mx + bend, my + (ky == null ? 0 : (y1 - hy0) * 0.5));
    });
  };
  const freePaw = (x: number, y: number, w: number, col: string) => p.free(() => paw(x, y, w, col));
  const ft = sp.ft ?? 0;
  const lean = (cx: number, cy: number) => { p.tf = sp.lean || sp.drop ? mkTf(cx, cy, sp.lean, sp.sx ?? 0, sp.drop) : null; };
  let a: Anchors;
  /** A foot with two toe lines, pointing forward. */
  const paw = (x: number, y: number, w: number, col: string) => {
    p.ell(x + w * 0.22, y, w * 0.82, w * 0.46, col);
    p.line(`M${f(x + w * 0.5)} ${f(y - w * 0.08)}l0 ${f(w * 0.36)}M${f(x + w * 0.8)} ${f(y - w * 0.02)}l0 ${f(w * 0.3)}`, pal.out, 0.7);
  };

  p.g = 'aura';
  if (o.stage >= 3) {
    // Ancient and legendary creatures glow from the ground up, in their element's colour.
    const e = ELEMENTS[ph.el1];
    p.ell(50, 91, 34 * b, 6, e.base, { line: false, op: o.stage === 4 ? 0.45 : 0.32 });
    p.ell(50, 91, 22 * b, 3.6, e.light, { line: false, op: 0.4 });
  }
  if (o.shadow !== false) p.ell(50, 92, 24 * b, 4, '#000000', { line: false, op: 0.18 });

  switch (ph.skel) {
    case 'biped': {
      const by = 64 - 3 * (b - 0.8), brx = 14.5 * b, bry = 18 * b;
      const hr = 12.5 * hs;
      const hip = by + bry * 0.5;
      lean(48, hip);
      a = { back: ellFrame(48, by, brx, bry, -Math.PI / 2 - 0.9), hx: 53 + sp.hdx, hy: by - bry - hr * 0.5 + breathe * 0.4 + sp.hdy, hr, bx: 48, by, brx, bry, tx: 48 - brx * 0.8, ty: by + bry * 0.55, tdir: 0.35, wx: 44, wy: by - bry * 0.45, backx: 40, backy: by - bry * 0.72 };
      drawWing(p, a, ph, k, flap, true);
      p.g = 'back';
      leg(52, hip, 54 - sw * 6 + ft, 87.6, 8.5 * ls, 5.4 * ls, far);
      freePaw(54 - sw * 6 + ft, 89.2, 5.6 * ls, far);
      // The far arm: up in a guard for a ready stance, otherwise hanging.
      if (ph.stance === 1 && !o.ko && !reach && !raise) p.taper(55, by - bry * 0.35, 66, by - bry * 0.55, 5 * ls, 4 * ls, far, 64, by - bry * 0.05);
      else p.taper(55, by - bry * 0.35, 63 - sw * 4, by + 3, 5 * ls, 3.6 * ls, far);
      p.g = 'body';
      drawTail(p, a, ph, k, breathe);
      leg(45, hip, 44 + sw * 6 - ft, 87.6, 10 * ls, 6 * ls, pal.base);
      freePaw(44 + sw * 6 - ft, 89.2, 6.2 * ls, pal.base);
      // A pear-shaped torso: the belly is wider than the chest.
      p.ell(48, by, brx, bry, pal.base);
      p.ell(48, by + bry * 0.28, brx * 1.07, bry * 0.72, pal.base);
      // A proud stance puffs the chest out.
      if (ph.stance === 2 && !o.ko) p.ell(48 + brx * 0.35, by - bry * 0.22, brx * 0.78, bry * 0.62, pal.base);
      drawPattern(p, a, ph, st.cue);
      shadeForm(p, 48, by, brx, bry);
      p.g = 'front';
      // The near arm swings forward to strike, or up to cast.
      if (reach) p.taper(50, by - bry * 0.3, 66, by - bry * 0.45, 5.6 * ls, 4.4 * ls, pal.base, 60, by - bry * 0.05);
      else if (raise) p.taper(50, by - bry * 0.3, 60, by - bry * 1.05, 5.6 * ls, 4.4 * ls, pal.base, 59, by - bry * 0.4);
      // Ready: fists up in front of the chest. Proud: the arm relaxed down the side. Hunched: arms hang forward.
      else if (ph.stance === 1 && !o.ko) p.taper(50, by - bry * 0.3, 62, by - bry * 0.4, 5.6 * ls, 4.8 * ls, pal.base, 60, by + bry * 0.12);
      else if (ph.stance === 2 && !o.ko) p.taper(50, by - bry * 0.3, 46 + sw * 3, by + bry * 0.38, 5.6 * ls, 4.2 * ls, pal.base, 51, by + bry * 0.05);
      else if (ph.stance === 3 && !o.ko) p.taper(50, by - bry * 0.3, 58 + sw * 4, by + bry * 0.32, 5.6 * ls, 4.2 * ls, pal.base, 56, by + bry * 0.02);
      else p.taper(50, by - bry * 0.3, 58 + sw * 4, by + 5, 5.6 * ls, 4.2 * ls, pal.base);
      p.g = 'body';
      break;
    }
    case 'quad': {
      const by = 63, brx = 23 * b, bry = 13.5 * b;
      const hr = 12 * hs;
      const hx = 48 + brx * 0.82 + sp.hdx, hy = by - bry * 0.75 - hr * 0.4 + breathe * 0.4 + sp.hdy;
      lean(46 + brx * (sp.px ?? 0), by);
      a = { flatBack: true, back: ellFrame(46, by, brx, bry, -Math.PI / 2 - 0.3), hx, hy, hr, bx: 46, by, brx, bry, tx: 46 - brx * 0.92, ty: by - bry * 0.2, tdir: 0.5, wx: 44, wy: by - bry * 0.7, backx: 40, backy: by - bry * 0.95 };
      drawWing(p, a, ph, k, flap, true);
      const hip = by + bry * 0.3;
      const fx = 46 + brx * 0.55, rx = 46 - brx * 0.6;
      p.g = 'back';
      leg(fx + 4, hip, fx + 4 - sw * 6 + ft, 87.8, 7.5 * ls, 5 * ls, far, undefined, undefined, -0.7);
      freePaw(fx + 4 - sw * 6 + ft, 89.3, 5.2 * ls, far);
      leg(rx + 5, hip, rx + 5 + sw * 6 - ft, 87.8, 8.5 * ls, 5 * ls, far, rx + 5 - 3 * ls + sw * 3, 80, -1);
      freePaw(rx + 5 + sw * 6 - ft, 89.3, 5.2 * ls, far);
      p.g = 'body';
      drawTail(p, a, ph, k, breathe);
      // A front paw swipes forward on an attack.
      const pawX = fx - 2 + sw * 6 + reach * 12 + ft, pawY = 87.8 - reach * 9;
      leg(fx - 2, hip, pawX, pawY, 8.5 * ls, 5.6 * ls, pal.base, undefined, undefined, -0.7);
      freePaw(pawX, pawY + 1.5, 5.8 * ls, pal.base);
      // The hind leg is thick at the haunch and bends back at the hock.
      leg(rx - 1, hip - 1, rx - 1 - sw * 6 - ft, 87.8, 11.5 * ls, 5.6 * ls, pal.base, rx - 1 - 4 * ls - sw * 3, 80, -1);
      freePaw(rx - 1 - sw * 6 - ft, 89.3, 5.8 * ls, pal.base);
      p.taper(46 + brx * 0.6, by - bry * 0.3, hx - hr * 0.3, hy + hr * 0.5, 13 * b, 9 * b, pal.base);
      p.ell(46, by, brx, bry, pal.base);
      // A deeper chest and a rounded rump break up the plain oval.
      p.ell(46 + brx * 0.52, by + bry * 0.08, brx * 0.52, bry * 1.0, pal.base);
      p.ell(46 - brx * 0.58, by - bry * 0.04, brx * 0.46, bry * 0.98, pal.base);
      drawPattern(p, a, ph, st.cue);
      shadeForm(p, 46, by, brx, bry);
      break;
    }
    case 'multi': {
      const by = 66, hr = 10.5 * hs;
      const abx = 34, arx = 17 * b, ary = 12 * b;
      const thx = 34 + arx + 9 * b, thr = 11.5 * b;
      const hx = thx + thr + hr * 0.45 + sp.hdx, hy = by - 6 + breathe * 0.3 + sp.hdy;
      lean(thx + thr * (sp.px ?? 0), by);
      a = { flatBack: true, back: ellFrame(abx, by - 2, arx, ary, -Math.PI / 2 - 0.2), hx, hy, hr, bx: abx, by: by - 2, brx: arx, bry: ary, tx: abx - arx * 0.9, ty: by - 4, tdir: 0.7, wx: thx - 2, wy: by - thr * 0.8, backx: abx, backy: by - 2 - ary * 0.95 };
      drawWing(p, a, ph, k, flap, true);
      p.g = 'back';
      for (let i = 0; i < 3; i++) {
        const lx = thx - 7 + i * 6, s2 = (i % 2 === 0 ? sw : -sw) * 4;
        leg(lx + 2, by + 2, lx + (i - 1) * (9 + ft) + 3 - s2, 90, 3.6 * ls, 1.8 * ls, far, lx + (i - 1) * 8 + 3, by - 4, 0);
      }
      p.g = 'body';
      drawTail(p, a, ph, k, breathe);
      p.ell(abx, by - 2, arx, ary, pal.base);
      drawPattern(p, a, ph, st.cue);
      shadeForm(p, abx, by - 2, arx, ary);
      p.ell(thx, by - 1, thr, thr * 0.9, shade(pal.base, -0.04));
      shadeForm(p, thx, by - 1, thr, thr * 0.9);
      for (let i = 0; i < 3; i++) {
        const lx = thx - 8 + i * 6, s2 = (i % 2 === 0 ? -sw : sw) * 4;
        leg(lx, by + 3, lx + (i - 1) * (10 + ft) - s2, 90, 4.2 * ls, 2 * ls, pal.dark, lx + (i - 1) * 9, by - 6, 0);
      }
      break;
    }
    case 'serpent': {
      const hr = 11.5 * hs, w = 12.5 * b;
      const wv = o.walking ? Math.sin(phase * TAU) * 3 : breathe;
      const hx = 68 + sp.hdx, hy = 40 + breathe * 0.5 + sp.hdy;
      p.tf = null;
      a = { back: [24.5, 79.25 + wv * 0.125 - w * 0.3, 0], hx, hy, hr, bx: 55, by: 76, brx: w * 0.75, bry: w * 0.8, tx: 15, ty: 85 - wv, tdir: 0.5, wx: 57, wy: 60, backx: 56, backy: 62 };
      drawWing(p, a, ph, k, flap, true);
      p.g = 'body';
      drawTail(p, a, ph, k * 0.8, 0);
      // The body is one ribbon: thin at the tail, full through the coils, a little slimmer at the neck.
      const ctrl = [[14, 85 - wv], [24, 74 + wv], [36, 84 - wv * 0.5], [50, 92 + wv * 0.4], [58, 78], [63, 66], [58 + sp.hdx * 0.25, 56 + sp.hdy * 0.35], [56 + sp.hdx * 0.6, 48 + sp.hdy * 0.7], [hx - 3, hy + 5]];
      const pts: number[][] = [], ws: number[] = [];
      for (let sgm = 0; sgm < 4; sgm++) {
        const [x0, y0] = ctrl[sgm * 2], [cx, cy] = ctrl[sgm * 2 + 1], [x1, y1] = ctrl[sgm * 2 + 2];
        for (let i = sgm ? 1 : 0; i <= 6; i++) {
          const t = i / 6, u = 1 - t, g = (sgm + t) / 4;
          pts.push([u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1]);
          ws.push(w * (g < 0.3 ? 0.32 + 0.68 * (g / 0.3) : g < 0.7 ? 1 : 1 - 0.2 * ((g - 0.7) / 0.3)));
        }
      }
      p.ribbon(pts, ws, pal.base);
      if (ph.pattern === 'belly') p.line(`M30 ${f(86 - wv * 0.4)}Q48 ${f(95 + wv * 0.4)} 57 80`, pal.light, w * 0.35);
      else if (ph.pattern !== 'plain' && ph.pattern !== 'mask') {
        const col = ph.pattern === 'stars' ? pal.markGlow : ph.pattern === 'bands' ? pal.accentDark : pal.mark;
        for (const [x, y] of [[30, 81], [40, 86], [50, 87], [58, 76], [60, 62]]) {
          if (ph.pattern === 'stars') star(p, x, y, w * 0.25, col); else p.dot(x, y, w * (ph.pattern === 'spots' ? 0.2 : 0.26), col, 0.75);
        }
      }
      break;
    }
    case 'aquatic': {
      const by = 58 + breathe, brx = 25 * b, bry = 15 * b;
      const hr = 12 * hs;
      lean(48, by);
      a = { flatBack: true, back: ellFrame(48, by, brx, bry, -Math.PI / 2 - 0.35), hx: 50 + brx * 0.5, hy: by - bry * 0.12, hr, bx: 48, by, brx, bry, tx: 48 - brx * 0.9, ty: by, tdir: 0.05, wx: 46, wy: by - bry * 0.75, backx: 44, backy: by - bry * 0.95 };
      drawWing(p, a, ph, k, flap, true);
      p.g = 'body';
      // Every swimmer has a fluke; the tail gene adds to it.
      const fl = sw * 4 + breathe * 2;
      p.path(`M${f(a.tx + 3)} ${f(by)}L${f(a.tx - 12 * b)} ${f(by - 11 * b + fl)}Q${f(a.tx - 7 * b)} ${f(by)} ${f(a.tx - 12 * b)} ${f(by + 11 * b + fl)}Z`, pal.accent);
      if (ph.el2 && (ph.tail === 'stub' || ph.tail === 'fan')) tailTip(p, a.tx - 9 * b, by - 9 * b + fl, ph.el2, 0.8 * k);
      if (ph.tail !== 'stub' && ph.tail !== 'fan') drawTail(p, { ...a, tx: a.tx + 2, ty: by + bry * 0.5 }, ph, k * 0.75, breathe);
      p.ell(48, by, brx, bry, pal.base);
      drawPattern(p, a, ph, st.cue);
      shadeForm(p, 48, by, brx, bry);
      p.g = 'front';
      p.ell(48 + brx * 0.05, by + bry * 0.55, 8 * ls, 4 * ls, shade(pal.base, -0.08), { rot: 28 + sw * 14 });
      p.g = 'body';
      break;
    }
    default: {
      // floater
      const cy = 52 + breathe * 1.4, r = 17 * b;
      const hr = 13 * hs;
      lean(50, cy + r);
      a = { back: ellFrame(50, cy, r, r * 1.1, -Math.PI / 2 - 0.75), hx: 52, hy: cy - r * 0.35, hr, bx: 50, by: cy + r * 0.45, brx: r * 0.8, bry: r * 0.75, tx: 44, ty: cy + r * 1.25, tdir: -0.9, wx: 43, wy: cy - r * 0.1, backx: 40, backy: cy - r * 0.55 };
      drawWing(p, a, ph, k, flap, true);
      const wv = Math.sin(phase * TAU) * 1.6;
      p.g = 'back';
      p.ell(50 - r * 0.75, cy + r * 0.6 - wv, 3.4 * ls, 3 * ls, far);
      p.g = 'body';
      p.path(`M${f(50 - r)} ${f(cy)}Q${f(50 - r)} ${f(cy - r * 1.1)} 50 ${f(cy - r * 1.1)}Q${f(50 + r)} ${f(cy - r * 1.1)} ${f(50 + r)} ${f(cy)}Q${f(50 + r)} ${f(cy + r * 1.1)} ${f(50 + r * 0.55)} ${f(cy + r * 1.45 + wv)}Q${f(50 + r * 0.35)} ${f(cy + r * 1.05)} ${f(50 + r * 0.1)} ${f(cy + r * 1.6 - wv)}Q${f(50 - r * 0.15)} ${f(cy + r * 1.1)} ${f(50 - r * 0.45)} ${f(cy + r * 1.7 + wv)}Q${f(50 - r * 0.95)} ${f(cy + r * 1.1)} ${f(50 - r)} ${f(cy)}Z`, pal.base);
      drawPattern(p, a, ph, st.cue);
      shadeForm(p, 50, cy + r * 0.1, r * 0.86, r * 0.8);
      if (ph.tail !== 'stub') drawTail(p, { ...a, tx: 50 - r * 0.5, ty: cy + r * 1.2, tdir: -0.6 }, ph, k * 0.7, wv);
      p.ell(50 + r * 0.95, cy + r * 0.45 + wv, 3.6 * ls, 3.2 * ls, pal.base);
    }
  }

  drawWing(p, a, ph, k, flap, false);
  p.g = 'body';
  drawHead(p, a, ph, k, o.ko, o.pose);
  p.g = 'body';
  drawCues(p, a, ph.el1, st.cue, phase, false, ph);
  p.tf = null;
  p.g = 'fx';
  if (o.stage >= 3) {
    // Motes drifting up through the idle cycle.
    const e = ELEMENTS[ph.el1];
    for (let i = 0; i < (o.stage === 4 ? 5 : 3); i++) {
      const t = (phase + i / 3) % 1;
      p.dot(26 + ((i * 37) % 50), 88 - t * 60, 1.4 + (i % 2) * 0.6, i % 2 ? e.light : e.base, 0.85 * (1 - t));
    }
  }
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
