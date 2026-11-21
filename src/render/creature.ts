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

export interface Palette {
  base: string; light: string; dark: string; glow: string; accent: string; accentDark: string; out: string; mark: string; markGlow: string;
  /** Two-tone colours: legs, arms, tail and ears (darker on a pointed coat), a darker back, pale socks, pale patches. */
  limb: string; dorsal: string; sock: string; patch: string;
}

/**
 * Shiny colourings, one per element like a species' alternate colours: a hue turn (and a saturation lift for the
 * greyer elements). The element's own flames, sparks and glows keep their colour, so a shiny still reads as its type.
 */
const SHINY: Record<ElementId, [number, number]> = {
  plain: [170, 0.12], terra: [150, 0.05], stone: [190, 0.16], tide: [62, 0], verdant: [-85, 0], ember: [200, 0],
  gale: [130, 0], swarm: [-70, 0.05], brawn: [190, 0], frost: [130, 0], spark: [160, 0], venom: [-160, 0],
  forge: [-170, 0.32], mind: [180, 0], shade: [100, 0.22], spirit: [-100, 0], glimmer: [-150, 0], wyrm: [120, 0],
  radiant: [-60, 0.05], void: [-90, 0.12],
};

export function paletteFor(ph: Pheno): Palette {
  const e = ELEMENTS[ph.el1];
  const hue = ph.hue ?? 0;
  const [sh, ss] = ph.shiny ? SHINY[ph.el1] : [0, 0];
  const tone = (c0: string): string => {
    const c = hue || sh ? shade(c0, 0, ss, hue + sh) : c0;
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
  const dark = tone(e.dark);
  return { base, light: tone(e.light), dark, glow: e.glow, accent: acc, accentDark: shade(acc, -0.18), out: shade(dark, -0.14),
    mark: e2 ? e2.dark : dark, markGlow: e2 ? e2.glow : e.glow,
    limb: ph.twotone === 'points' ? mix(base, dark, 0.72) : base, dorsal: mix(base, dark, 0.42), sock: mix(base, '#fff8ee', 0.72), patch: mix(base, '#fffaf2', 0.78) };
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

/** Pieces that animate on their own, rotating about a joint: everything else is the main body. */
export type Part = 'main' | 'tail' | 'wingFar' | 'wingNear' | 'ground';
interface Item { g: Layer; part: Part; out?: Shape; fill: Shape }

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
  /** Which animated piece is being drawn, and where each piece's joint is. */
  part: Part = 'main';
  pivots: Partial<Record<Part, [number, number]>> = {};
  /** Drawing for the live rig: the tail and wings are drawn at rest, and the app moves them. */
  rig = false;
  /** Where the eyes look: -1 back, 0 ahead, 1 forward. */
  look = 0;
  constructor(public pal: Palette) {}
  private add(fill: Shape, out?: Shape) {
    if (this.tf) { fill = tfShape(fill, this.tf); if (out) out = tfShape(out, this.tf); }
    this.items.push({ g: this.g, part: this.part, fill, out });
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
  /**
   * A soft painted stroke along a polyline: a few see-through layers, each narrower, shorter and denser than the
   * last, so the mark is strongest down its middle and fades out at both sides and both ends, blending into the
   * hide instead of stopping at a hard edge.
   */
  soft(pts: number[][], w: number, color: string, op = 0.8) {
    const L = 5, per = 1 - Math.pow(1 - op, 1 / L);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum[cum.length - 1] || 1;
    const at = (d: number) => {
      let i = 1;
      while (i < cum.length - 1 && cum[i] < d) i++;
      const t = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
    };
    for (let k = 0; k < L; k++) {
      const q = k / (L - 1), trim = total * (0.02 + 0.2 * q), d0 = trim, d1 = total - trim;
      const sub = [at(d0), ...pts.filter((_, i) => cum[i] > d0 && cum[i] < d1), at(d1)];
      this.line('M' + sub.map(([x, y]) => f(x) + ' ' + f(y)).join('L'), color, w * (1.7 - 1.15 * q), per);
    }
  }
  ring(cx: number, cy: number, rx: number, ry: number, color: string, w: number, op?: number) {
    this.add({ t: 'ellipse', cx, cy, rx, ry, fill: 'none', stroke: color, sw: w, op });
  }
  limb(x1: number, y1: number, x2: number, y2: number, w: number, color: string, kx?: number, ky?: number) {
    const d = kx == null ? `M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}` : `M${f(x1)} ${f(y1)}Q${f(kx)} ${f(ky!)} ${f(x2)} ${f(y2)}`;
    this.stroke(d, w, color);
  }
  /** A limb whose width changes along a centre line (widths[i] at pts[i]), rounded at both ends. */
  ribbon(pts: number[][], widths: number[], color: string, line = true) {
    const L: string[] = [], R: string[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
      const h = widths[i] / 2;
      L.push(`${f(pts[i][0] - dy * h)} ${f(pts[i][1] + dx * h)}`);
      R.unshift(`${f(pts[i][0] + dy * h)} ${f(pts[i][1] - dx * h)}`);
    }
    const o = line ? undefined : { line: false };
    this.path('M' + L.join('L') + 'L' + R.join('L') + 'Z', color, o);
    const n = pts.length - 1;
    this.ell(pts[0][0], pts[0][1], widths[0] / 2, widths[0] / 2, color, o);
    this.ell(pts[n][0], pts[n][1], widths[n] / 2, widths[n] / 2, color, o);
  }
  /** A tapered limb from (x1,y1), width w0, to (x2,y2), width w1, optionally bending toward (kx,ky). */
  taper(x1: number, y1: number, x2: number, y2: number, w0: number, w1: number, color: string, kx?: number, ky?: number, line = true) {
    const cx = kx ?? (x1 + x2) / 2, cy = ky ?? (y1 + y2) / 2;
    const pts: number[][] = [], ws: number[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8, u = 1 - t;
      pts.push([u * u * x1 + 2 * u * t * cx + t * t * x2, u * u * y1 + 2 * u * t * cy + t * t * y2]);
      ws.push(w0 + (w1 - w0) * t);
    }
    this.ribbon(pts, ws, color, line);
  }
  poly(pts: number[][], fill: string, o: { op?: number; line?: boolean } = {}) {
    this.path('M' + pts.map(p => f(p[0]) + ' ' + f(p[1])).join('L') + 'Z', fill, o);
  }
  shapes(part?: Part): Shape[] {
    const out: Shape[] = [];
    for (const g of LAYERS) {
      const its = this.items.filter(i => i.g === g && (part == null || i.part === part));
      for (const i of its) if (i.out) out.push(i.out);
      for (const i of its) out.push(i.fill);
    }
    return out;
  }
}

/** Soft shading on a rounded form: a shadow along the underside and a highlight on top, for a sense of volume. */
function shadeForm(p: Pen, cx: number, cy: number, rx: number, ry: number) {
  shadeUnder(p, cx, cy, rx, ry);
  p.ell(cx - rx * 0.28, cy - ry * 0.55, rx * 0.36, ry * 0.15, '#ffffff', { line: false, op: 0.22, rot: -10 });
}
/**
 * Shading for a head made of a skull and a jaw: the underside shadow follows the true bottom edge of the two
 * together. Shading the skull alone left the jaw's lower edge unshaded, so a band of shadow floated across the
 * middle of the face.
 */
function shadeHead(p: Pen, parts: number[][], hlx: number, hly: number, hlrx: number, hlry: number) {
  const sn = 0.15, cs = Math.sqrt(1 - sn * sn);
  const x0 = Math.min(...parts.map(([cx, , rx]) => cx - rx * cs)), x1 = Math.max(...parts.map(([cx, , rx]) => cx + rx * cs));
  const bottom = (x: number) => Math.max(...parts.map(([cx, cy, rx, ry]) => { const u = (x - cx) / rx; return Math.abs(u) < 1 ? cy + ry * Math.sqrt(1 - u * u) : -1e9; }));
  const depth = Math.max(...parts.map(([, , , ry]) => ry)) * 0.42;
  const N = 24, lo: string[] = [], hi: string[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, x = x0 + (x1 - x0) * t, y = bottom(x);
    lo.push(f(x) + ' ' + f(y));
    hi.unshift(f(x) + ' ' + f(y - depth * Math.pow(Math.sin(Math.PI * t), 0.8)));
  }
  p.path('M' + lo.join('L') + 'L' + hi.join('L') + 'Z', p.pal.out, { line: false, op: 0.2 });
  p.ell(hlx, hly, hlrx, hlry, '#ffffff', { line: false, op: 0.22, rot: -10 });
}
/** Just the shadow along the underside of a rounded form, for a part that sits over an already-shaded one. */
function shadeUnder(p: Pen, cx: number, cy: number, rx: number, ry: number, op = 0.2) {
  const sn = 0.15, cs = Math.sqrt(1 - sn * sn);
  p.path(`M${f(cx - rx * cs)} ${f(cy + ry * sn)}A${f(rx)} ${f(ry)} 0 0 0 ${f(cx + rx * cs)} ${f(cy + ry * sn)}Q${f(cx)} ${f(cy + ry * 1.02)} ${f(cx - rx * cs)} ${f(cy + ry * sn)}Z`, p.pal.out, { line: false, op });
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
  /** Limb positions, 0..1, for blending smoothly into and out of a pose. Default: the pose's own. */
  reach?: number;
  raise?: number;
  guard?: number;
  /** Draw for the live rig: no breathing, tail and wings at rest. */
  rig?: boolean;
  /** Eyes glancing back (-1) or forward (1). */
  look?: number;
}

export type Pose = 'idle' | 'blink' | 'attack' | 'cast' | 'hurt' | 'roar' | 'happy' | 'guard' | 'dizzy';
/** How far each pose moves the limbs: reach forward to strike, raise up to cast or cheer, guard in front. */
export function poseWeights(pose?: Pose): { reach: number; raise: number; guard: number } {
  switch (pose) {
    case 'attack': return { reach: 1, raise: 0, guard: 0 };
    case 'cast': case 'happy': return { reach: 0, raise: 1, guard: 0 };
    case 'roar': return { reach: 0.2, raise: 0.55, guard: 0 };
    case 'guard': return { reach: 0, raise: 0, guard: 1 };
    case 'hurt': return { reach: 0, raise: 0.25, guard: 0.3 };
    default: return { reach: 0, raise: 0, guard: 0 };
  }
}

function star(p: Pen, x: number, y: number, r: number, fill: string, op = 1) {
  const q = r * 0.3;
  p.path(`M${f(x)} ${f(y - r)}L${f(x + q)} ${f(y - q)}L${f(x + r)} ${f(y)}L${f(x + q)} ${f(y + q)}L${f(x)} ${f(y + r)}L${f(x - q)} ${f(y + q)}L${f(x - r)} ${f(y)}L${f(x - q)} ${f(y - q)}Z`, fill, { line: false, op });
}

/** A slim four-point glint with long arms, for shinies. */
function twinkle(p: Pen, x: number, y: number, r: number, fill: string, op = 1) {
  const q = r * 0.16, h = r * 0.62;
  p.path(`M${f(x)} ${f(y - r)}Q${f(x + q)} ${f(y - q)} ${f(x + h)} ${f(y)}Q${f(x + q)} ${f(y + q)} ${f(x)} ${f(y + r)}Q${f(x - q)} ${f(y + q)} ${f(x - h)} ${f(y)}Q${f(x - q)} ${f(y - q)} ${f(x)} ${f(y - r)}Z`, fill, { line: false, op });
}

function flame(p: Pen, x: number, y: number, r: number, c1: string, c2: string) {
  p.path(`M${f(x - r * 0.6)} ${f(y + r * 0.5)}Q${f(x - r * 1.1)} ${f(y - r * 0.4)} ${f(x - r * 0.3)} ${f(y - r * 0.6)}Q${f(x - r * 0.4)} ${f(y - r * 1.2)} ${f(x + r * 0.1)} ${f(y - r * 1.6)}Q${f(x + r * 0.9)} ${f(y - r * 0.6)} ${f(x + r * 0.6)} ${f(y + r * 0.5)}Q${f(x)} ${f(y + r)} ${f(x - r * 0.6)} ${f(y + r * 0.5)}Z`, c1);
  p.path(`M${f(x - r * 0.25)} ${f(y + r * 0.4)}Q${f(x - r * 0.5)} ${f(y - r * 0.2)} ${f(x)} ${f(y - r * 0.8)}Q${f(x + r * 0.45)} ${f(y - r * 0.1)} ${f(x + r * 0.25)} ${f(y + r * 0.4)}Z`, c2, { line: false });
}

function drawTail(p: Pen, a: Anchors, ph: Pheno, k: number, sway: number) {
  const was = p.part;
  p.part = 'tail';
  p.pivots.tail = p.at(a.tx, a.ty);
  // A pointed coat darkens the tail like the legs.
  const pal = p.pal;
  if (pal.limb !== pal.base) p.pal = { ...pal, base: pal.limb };
  drawTailShape(p, a, ph, k, p.rig ? 0 : sway);
  p.pal = pal;
  p.part = was;
}

function drawTailShape(p: Pen, a: Anchors, ph: Pheno, k: number, sway: number) {
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
  if (ph.tail === 'fan') {
    // A fluke that grows out of the tail's end: its base starts on the tail at the tail's own width and flares
    // out into two curved lobes, so it reads as part of the tail rather than a kite stuck on the end.
    const dl = Math.hypot(ex - kx, ey - ky) || 1, dx = (ex - kx) / dl, dy = (ey - ky) / dl, nx = -dy, ny = dx;
    const bx = ex - dx * 3 * k, by = ey - dy * 3 * k, hw = w * 0.45;
    const P = (u: number, v: number) => f(bx + dx * u + nx * v) + ' ' + f(by + dy * u + ny * v);
    p.path(`M${P(0, hw)}Q${P(4 * k, 6.5 * k)} ${P(11 * k, 8.5 * k)}Q${P(8.5 * k, 3 * k)} ${P(7.5 * k, 0)}Q${P(8.5 * k, -2.5 * k)} ${P(10.5 * k, -7.5 * k)}Q${P(4 * k, -5.5 * k)} ${P(0, -hw)}Z`, c.accent);
    // The tail's colour runs a little way into the fin, and two soft ribs fan out along it.
    p.path(`M${P(-0.5 * k, hw)}Q${P(2.5 * k, hw * 1.6)} ${P(4 * k, 0)}Q${P(2.5 * k, -hw * 1.6)} ${P(-0.5 * k, -hw)}Z`, c.base, { line: false });
    p.line(`M${P(2 * k, 0.5 * k)}Q${P(5 * k, 3.5 * k)} ${P(9.5 * k, 6.8 * k)}M${P(2 * k, -0.5 * k)}Q${P(5 * k, -3 * k)} ${P(9 * k, -6 * k)}`, c.accentDark, Math.max(0.6, 0.7 * k), 0.45);
  }
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
  const was = p.g, wasPart = p.part;
  p.g = far ? 'back' : 'front';
  p.part = far ? 'wingFar' : 'wingNear';
  const jx = ph.wings === 'flipper' && a.flatBack ? a.bx + a.brx * 0.42 + (far ? 4 : 0) : a.wx + (far ? 4 : 0) + (ph.wings === 'flipper' ? 4 : 0);
  const jy = ph.wings === 'flipper' && a.flatBack ? a.by - a.bry * 0.3 + (far ? -1 : 0) : a.wy + (far ? -1 : 0) + (ph.wings === 'flipper' ? 2 : 0);
  p.pivots[p.part] = p.at(jx, jy);
  drawWingShape(p, a, ph, k, p.rig ? 0 : flap, far);
  p.g = was;
  p.part = wasPart;
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
      // A dorsal fin. It's drawn behind the body with its base sunk into the back, so it rises out of the body
      // along the back's own curve instead of sitting on top with a straight cut along its base. A brighter
      // leading edge and a few soft ribs give it form.
      if (far) {
        const fx = x - 4, fy = y + 1, top = fy - 19 * k - up * 0.4;
        p.path(`M${f(fx + 7 * k)} ${f(fy + 7 * k)}Q${f(fx - 1 * k)} ${f(top)} ${f(fx - 12 * k)} ${f(fy - 15 * k)}Q${f(fx - 7 * k)} ${f(fy - 4 * k)} ${f(fx - 13 * k)} ${f(fy + 7 * k)}Z`, c.accent);
        p.line(`M${f(fx + 4.5 * k)} ${f(fy + 2 * k)}Q${f(fx - 1.5 * k)} ${f(fy - 13 * k)} ${f(fx - 10.5 * k)} ${f(fy - 14 * k)}`, mix(c.accent, '#ffffff', 0.35), Math.max(0.8, 1.3 * k), 0.8);
        for (const [bx, ex, ey] of [[-1, -7, -9], [-4, -9, -5], [-7, -10.5, -1]]) p.line(`M${f(fx + bx * k)} ${f(fy + 3 * k)}L${f(fx + ex * k)} ${f(fy + ey * k)}`, c.accentDark, Math.max(0.5, 0.8 * k), 0.4);
      }
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

/** Eye colours, from the eye-colour gene. */
const IRIS: Record<string, string> = {
  brown: '#9a5a2e', amber: '#e3952b', green: '#3eae58', blue: '#3b8fe2', gold: '#e8c02f', violet: '#9b5ce0', red: '#d9434e', silver: '#8d9fb5',
};
/** Iris colour from the gene; snapshots from before it existed use the complement of the body's hue. */
function irisColor(ph: Pheno): string {
  if (ph.iris && IRIS[ph.iris]) return IRIS[ph.iris];
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
  if (pose === 'happy') {
    // Happy: eyes squeezed into upward arcs.
    for (const [dx, dy, er0] of spots) {
      const ex = x + r * dx, ey = y + r * dy, k = r * er0 * 0.9, w = Math.max(1.2, r * er0 * 0.42);
      p.line(`M${f(ex - k)} ${f(ey + k * 0.35)}Q${f(ex)} ${f(ey - k * 0.95)} ${f(ex + k)} ${f(ey + k * 0.35)}`, c.out, w);
    }
    return;
  }
  if (pose === 'dizzy') {
    // Dazed: spirals for eyes.
    for (const [dx, dy, er0] of spots) {
      const ex = x + r * dx, ey = y + r * dy, er = r * er0;
      p.ell(ex, ey, er, er, '#ffffff');
      const pts: string[] = [];
      for (let i = 0; i <= 18; i++) { const t = i / 18, a2 = t * Math.PI * 3.4, rr = er * 0.82 * t; pts.push(`${f(ex + Math.cos(a2) * rr)} ${f(ey + Math.sin(a2) * rr)}`); }
      p.line('M' + pts.join('L'), c.out, Math.max(0.9, er * 0.22));
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
    // A blink keeps the resting expression's brows and blush, so the face doesn't change mid-blink.
    if (pose === 'blink') moodFace(p, x, y, r, ph, ph.mood ?? 'calm', spots, false);
    return;
  }
  const glowy = ph.eyes === 'glow' || ph.el1 === 'shade' || ph.el1 === 'void' || ph.el1 === 'spirit';
  const iris = irisColor(ph);
  // The resting expression shows at rest and through a blink; battle poses make their own faces.
  const mood = pose === 'idle' ? ph.mood ?? 'calm' : 'calm';
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
    // A goofy face goes a little cross-eyed: each iris drifts toward the other eye.
    const cross = mood === 'goofy' && ph.eyes !== 'sleepy' ? (i === 0 ? 0.26 : -0.34) : 0;
    const ir = Math.min(er * (ph.eyes === 'big' ? 0.74 : 0.62), rx * 0.8), ix = ex + rx * (0.16 + p.look * 0.24 + cross), iy = ey + er * 0.06;
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
  moodFace(p, x, y, r, ph, mood, spots, true);
  if ((pose === 'roar' || pose === 'guard') && ph.eyes !== 'multi') {
    // Brows: angled down toward the nose for a roar, low and level for a determined guard.
    spots.forEach(([dx, dy, er0], i) => {
      const ex = x + r * dx, ey = y + r * dy, er = r * er0, side = i === 0 ? 1 : -1, hi = pose === 'roar' ? 1.25 : 1.05, lo = pose === 'roar' ? 0.62 : 0.92;
      p.line(`M${f(ex - er * 1.05 * side)} ${f(ey - er * hi)}L${f(ex + er * 0.95 * side)} ${f(ey - er * lo)}`, c.out, Math.max(1.2, er * 0.36));
    });
  }
}

/**
 * The resting expression around the eyes: brows, heavy lids, a blush. `open` is false during a blink, when there
 * are no open eyes for lids to cover. Slit eyes have their own fierce brow and many eyes have none.
 */
function moodFace(p: Pen, x: number, y: number, r: number, ph: Pheno, mood: string, spots: number[][], open: boolean) {
  if (mood === 'calm') return;
  const c = p.pal;
  const brows = ph.eyes !== 'multi' && ph.eyes !== 'slit';
  const big = ph.eyes === 'big' ? 1.2 : 1;
  spots.forEach(([dx, dy, er0], i) => {
    if (ph.eyes === 'multi' && i > 1) return;
    const ex = x + r * dx, ey = y + r * dy, er = r * er0 * big, rx = i === 1 && ph.eyes !== 'multi' ? er * 0.86 : er;
    // The inner end of a brow is the end toward the other eye.
    const side = i === 0 ? 1 : -1, bw = Math.max(1.1, er * 0.3);
    /** A lid over the top `frac` of the eye, in the hide's colour, with a dark edge. */
    const lid = (frac: number) => {
      if (!open || ph.eyes === 'sleepy' || ph.eyes === 'multi') return;
      const d = er * (1 - 2 * frac), w = rx * Math.sqrt(Math.max(0, 1 - (d / er) ** 2));
      p.path(`M${f(ex - w - 0.2)} ${f(ey - d)}A${f(rx + 0.2)} ${f(er + 0.2)} 0 ${frac > 0.5 ? 1 : 0} 1 ${f(ex + w + 0.2)} ${f(ey - d)}Z`, c.base, { line: false });
      p.line(`M${f(ex - w)} ${f(ey - d)}L${f(ex + w)} ${f(ey - d)}`, c.out, Math.max(0.9, er * 0.2));
    };
    const slant = (hi: number, lo: number) => p.line(`M${f(ex - rx * 1.05 * side)} ${f(ey - er * hi)}L${f(ex + rx * 0.95 * side)} ${f(ey - er * lo)}`, c.out, bw);
    switch (mood) {
      case 'cheerful':
        // High, round brows.
        if (brows) p.line(`M${f(ex - rx * 0.85)} ${f(ey - er * 1.2)}Q${f(ex)} ${f(ey - er * 1.62)} ${f(ex + rx * 0.85)} ${f(ey - er * 1.2)}`, c.out, bw * 0.85);
        break;
      case 'fierce':
        if (brows) slant(1.32, 0.78);
        lid(0.12);
        break;
      case 'grumpy':
        // Low, knitted brows over heavy lids.
        lid(0.38);
        if (brows) slant(1.0, 0.72);
        break;
      case 'smug':
        // Half-closed eyes; one brow up.
        lid(0.44);
        if (brows && i === 0) p.line(`M${f(ex - rx * 0.9)} ${f(ey - er * 1.28)}Q${f(ex)} ${f(ey - er * 1.62)} ${f(ex + rx * 0.9)} ${f(ey - er * 1.35)}`, c.out, bw * 0.85);
        else if (brows) slant(0.98, 0.98);
        break;
      case 'shy':
        // Worried brows, inner ends raised, and a blush under each eye.
        if (brows) slant(0.95, 1.35);
        p.ell(ex + rx * 0.05 * side, ey + er * 1.35, rx * 0.72, er * 0.34, '#ff6f9e', { line: false, op: 0.62 });
        break;
      case 'goofy':
        if (brows && i === 0) p.line(`M${f(ex - rx * 0.8)} ${f(ey - er * 1.25)}Q${f(ex)} ${f(ey - er * 1.55)} ${f(ex + rx * 0.8)} ${f(ey - er * 1.3)}`, c.out, bw * 0.85);
        break;
    }
  });
}

/** The resting mouth for an expression, under the eyes. Beaks and square jaws keep their own mouths. */
function moodMouth(p: Pen, hx: number, hy: number, r: number, mood: string) {
  const c = p.pal, my = hy + r * 0.42, w = Math.max(1, r * 0.09);
  switch (mood) {
    case 'cheerful': {
      // An open grin.
      const x0 = hx + r * 0.26, x1 = hx + r * 0.8, xm = (x0 + x1) / 2;
      p.path(`M${f(x0)} ${f(my - r * 0.02)}Q${f(xm)} ${f(my - r * 0.06)} ${f(x1)} ${f(my - r * 0.04)}Q${f(xm + r * 0.04)} ${f(my + r * 0.4)} ${f(x0)} ${f(my - r * 0.02)}Z`, '#3a1626', { line: false });
      p.path(`M${f(xm - r * 0.15)} ${f(my + r * 0.16)}Q${f(xm + r * 0.02)} ${f(my + r * 0.1)} ${f(xm + r * 0.18)} ${f(my + r * 0.15)}Q${f(xm + r * 0.04)} ${f(my + r * 0.3)} ${f(xm - r * 0.15)} ${f(my + r * 0.16)}Z`, '#e0677a', { line: false });
      p.line(`M${f(x0)} ${f(my - r * 0.02)}Q${f(xm)} ${f(my - r * 0.06)} ${f(x1)} ${f(my - r * 0.04)}Q${f(xm + r * 0.04)} ${f(my + r * 0.4)} ${f(x0)} ${f(my - r * 0.02)}`, c.out, w);
      break;
    }
    case 'fierce': {
      // A flat, toothy line with a fang at the corner.
      const fx = hx + r * 0.66, fy = my + r * 0.02;
      p.path(`M${f(fx - r * 0.07)} ${f(fy - r * 0.01)}L${f(fx + r * 0.07)} ${f(fy - r * 0.03)}L${f(fx + r * 0.01)} ${f(fy + r * 0.17)}Z`, '#ffffff', { line: false });
      p.line(`M${f(fx - r * 0.07)} ${f(fy - r * 0.01)}L${f(fx + r * 0.01)} ${f(fy + r * 0.17)}L${f(fx + r * 0.07)} ${f(fy - r * 0.03)}`, c.out, Math.max(0.6, w * 0.6));
      p.line(`M${f(hx + r * 0.24)} ${f(my + r * 0.06)}Q${f(hx + r * 0.5)} ${f(my + r * 0.08)} ${f(hx + r * 0.8)} ${f(my - r * 0.04)}`, c.out, w);
      break;
    }
    case 'grumpy':
      p.line(`M${f(hx + r * 0.3)} ${f(my + r * 0.12)}Q${f(hx + r * 0.52)} ${f(my - r * 0.06)} ${f(hx + r * 0.76)} ${f(my + r * 0.1)}`, c.out, w);
      break;
    case 'smug':
      // A one-sided smirk, curling up at the front.
      p.line(`M${f(hx + r * 0.28)} ${f(my + r * 0.06)}Q${f(hx + r * 0.56)} ${f(my + r * 0.12)} ${f(hx + r * 0.8)} ${f(my - r * 0.08)}l${f(r * 0.05)} ${f(-r * 0.02)}`, c.out, w);
      break;
    case 'shy':
      // A small, wobbly mouth.
      p.line(`M${f(hx + r * 0.4)} ${f(my + r * 0.06)}q${f(r * 0.06)} ${f(r * 0.07)} ${f(r * 0.12)} 0q${f(r * 0.06)} ${f(r * 0.07)} ${f(r * 0.12)} 0`, c.out, w * 0.9);
      break;
    case 'goofy': {
      // A smile with the tongue poking out.
      const tx = hx + r * 0.62, ty = my + r * 0.12;
      p.path(`M${f(tx - r * 0.11)} ${f(ty - r * 0.06)}L${f(tx + r * 0.11)} ${f(ty - r * 0.08)}Q${f(tx + r * 0.13)} ${f(ty + r * 0.2)} ${f(tx)} ${f(ty + r * 0.2)}Q${f(tx - r * 0.13)} ${f(ty + r * 0.2)} ${f(tx - r * 0.11)} ${f(ty - r * 0.06)}Z`, '#e86b85', { line: false });
      p.line(`M${f(tx + r * 0.11)} ${f(ty - r * 0.08)}Q${f(tx + r * 0.13)} ${f(ty + r * 0.2)} ${f(tx)} ${f(ty + r * 0.2)}Q${f(tx - r * 0.13)} ${f(ty + r * 0.2)} ${f(tx - r * 0.11)} ${f(ty - r * 0.06)}`, c.out, w * 0.8);
      p.line(`M${f(tx)} ${f(ty - r * 0.02)}l0 ${f(r * 0.1)}`, '#b84a60', w * 0.6);
      p.line(`M${f(hx + r * 0.25)} ${f(hy + r * 0.42)}Q${f(hx + r * 0.5)} ${f(hy + r * 0.6)} ${f(hx + r * 0.8)} ${f(hy + r * 0.38)}`, c.out, w);
      break;
    }
    default:
      p.path(`M${f(hx + r * 0.25)} ${f(hy + r * 0.42)}Q${f(hx + r * 0.5)} ${f(hy + r * 0.62)} ${f(hx + r * 0.78)} ${f(hy + r * 0.4)}`, 'none', { stroke: c.out, sw: 1.1 });
  }
}

/** Points along the back, rear to front: where each sits on the outline and which way is out. */
type Spine = { x: number; y: number; nx: number; ny: number }[];

/**
 * A body's shape for coats and two-tone: the ellipses it's built from (the first is the main one), or a
 * serpent's ribbon (centre points and widths).
 */
type Body = { hull: number[][]; rib?: undefined } | { rib: { pts: number[][]; ws: number[] }; hull?: undefined };
function inBody(b: Body, x: number, y: number, s = 1, skip = -1): boolean {
  if (b.hull) return b.hull.some(([cx, cy, rx, ry], i) => i !== skip && ((x - cx) / (rx * s)) ** 2 + ((y - cy) / (ry * s)) ** 2 < 1);
  const { pts, ws } = b.rib;
  for (let i = 0; i < pts.length; i++) if (Math.hypot(x - pts[i][0], y - pts[i][1]) < (ws[i] / 2) * s) return true;
  return false;
}
function bodyBox(b: Body): [number, number, number, number] {
  if (b.hull) return [Math.min(...b.hull.map(h => h[0] - h[2])), Math.min(...b.hull.map(h => h[1] - h[3])), Math.max(...b.hull.map(h => h[0] + h[2])), Math.max(...b.hull.map(h => h[1] + h[3]))];
  const { pts, ws } = b.rib;
  return [Math.min(...pts.map((q, i) => q[0] - ws[i])), Math.min(...pts.map((q, i) => q[1] - ws[i])), Math.max(...pts.map((q, i) => q[0] + ws[i])), Math.max(...pts.map((q, i) => q[1] + ws[i]))];
}
/** Points about `gap` apart around the outside of a body, with outward normals. `arc` limits a hull to some angles. */
function bodyRim(b: Body, gap: number, arc?: [number, number]): Spine {
  const out: Spine = [];
  if (b.hull) {
    b.hull.forEach(([cx, cy, rx, ry], i) => {
      const [t0, t1] = arc ?? [0, TAU];
      const per = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
      const n = Math.max(3, Math.round((per * (t1 - t0)) / TAU / gap));
      for (let j = 0; j < n; j++) {
        const t = t0 + ((t1 - t0) * (j + 0.5)) / n, x = cx + rx * Math.cos(t), y = cy + ry * Math.sin(t);
        if (inBody(b, x, y, 0.97, i)) continue;
        const nx = Math.cos(t) / rx, ny = Math.sin(t) / ry, L = Math.hypot(nx, ny);
        out.push({ x, y, nx: nx / L, ny: ny / L });
      }
    });
    return out;
  }
  const { pts, ws } = b.rib;
  let run = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    run += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (run < gap) continue;
    run = 0;
    const dx = pts[i + 1][0] - pts[i - 1][0], dy = pts[i + 1][1] - pts[i - 1][1], L = Math.hypot(dx, dy) || 1;
    for (const sd of [1, -1]) { const nx = (sd * -dy) / L, ny = (sd * dx) / L; out.push({ x: pts[i][0] + (nx * ws[i]) / 2, y: pts[i][1] + (ny * ws[i]) / 2, nx, ny }); }
  }
  return out;
}
/** A small number from a creature's looks, so its patches and cracks sit in the same places every time. */
function looksRng(ph: Pheno): () => number {
  let h = 2166136261;
  for (const ch of `${ph.el1}${ph.head}${ph.tail}${ph.eyes}${ph.horns}${ph.mark}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let a = h >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** A soft, irregular blob through `k` points around (x, y). */
function blob(p: Pen, x: number, y: number, r: number, col: string, rng: () => number, o: { op?: number } = {}, k = 7) {
  const pts = Array.from({ length: k }, (_, i) => { const t = (i / k) * TAU, q = r * (0.72 + rng() * 0.4); return [x + Math.cos(t) * q, y + Math.sin(t) * q * 0.85]; });
  const mid = (i: number) => { const a2 = pts[i % k], b2 = pts[(i + 1) % k]; return [(a2[0] + b2[0]) / 2, (a2[1] + b2[1]) / 2]; };
  let d = `M${f(mid(0)[0])} ${f(mid(0)[1])}`;
  for (let i = 1; i <= k; i++) d += `Q${f(pts[i % k][0])} ${f(pts[i % k][1])} ${f(mid(i)[0])} ${f(mid(i)[1])}`;
  p.path(d + 'Z', col, { line: false, op: o.op });
}

/**
 * What a coat adds to the outline, drawn just before the body in the same layer so it merges into the
 * silhouette: fluffy scallops, a shaggy fringe hanging below, feather tips swept back, or rocky lumps.
 */
function coatRim(p: Pen, ph: Pheno, b: Body, z: number, arc?: [number, number]) {
  const coat = ph.coat ?? 'smooth', c = p.pal;
  if (coat === 'smooth' || coat === 'scaly') return;
  const rim = bodyRim(b, z * (coat === 'shaggy' ? 3.4 : coat === 'rocky' ? 5.2 : coat === 'feathered' ? 4.4 : 3.9), arc);
  const rng = looksRng(ph), stone = mix(c.base, '#8d8778', 0.45);
  // Every piece goes into one path (one shape to draw, however many tufts), merged into the body's outline.
  let d = '', shine = '';
  /** An ellipse as path arcs, turned by rot degrees. */
  const oval = (cx: number, cy: number, rx: number, ry: number, rot = 0) => {
    const q = (rot * Math.PI) / 180, ux = Math.cos(q) * rx, uy = Math.sin(q) * rx;
    return `M${f(cx + ux)} ${f(cy + uy)}A${f(rx)} ${f(ry)} ${f(rot)} 1 0 ${f(cx - ux)} ${f(cy - uy)}A${f(rx)} ${f(ry)} ${f(rot)} 1 0 ${f(cx + ux)} ${f(cy + uy)}Z`;
  };
  rim.forEach(({ x, y, nx, ny }, i) => {
    switch (coat) {
      case 'fluffy':
        d += oval(x - nx * z * 0.7, y - ny * z * 0.7, z * 2.9, z * 2.9);
        break;
      case 'shaggy': {
        // Long hair hangs from the lower half of the body.
        if (ny < 0.2) break;
        const L = z * (3.6 + (i % 3) * 1.1), w = z * 1.9, tx = x + nx * L * 0.35 - z * 0.8, ty = y + ny * L * 0.3 + L * 0.75;
        d += `M${f(x - ny * w - nx * z)} ${f(y + nx * w - ny * z)}Q${f(x + nx * L * 0.2)} ${f(y + L * 0.3)} ${f(tx)} ${f(ty)}Q${f(x + nx * L * 0.1 + ny * w * 0.3)} ${f(y + L * 0.2)} ${f(x + ny * w - nx * z)} ${f(y - nx * w - ny * z)}Z`;
        break;
      }
      case 'feathered': {
        // Feather tips lying flat along the outline, overlapping like a bird's, so the edge is a row of small
        // points rather than bumps. They point along the outline whichever way is more down and back.
        if (ny > 0.3) break;
        const flip = ny - nx * 0.6 < 0 ? -1 : 1, rx2 = ny * flip, ry2 = -nx * flip, L = z * 4.6, w = z * 1.5;
        const bx = x - nx * z * 1.4, by = y - ny * z * 1.4, tx = x + rx2 * L + nx * z * 0.7, ty = y + ry2 * L + ny * z * 0.7;
        d += `M${f(bx - rx2 * z)} ${f(by - ry2 * z)}Q${f(x + nx * w + rx2 * L * 0.35)} ${f(y + ny * w + ry2 * L * 0.35)} ${f(tx)} ${f(ty)}Q${f(x + rx2 * L * 0.55 - nx * z * 0.6)} ${f(y + ry2 * L * 0.55 - ny * z * 0.6)} ${f(bx + rx2 * L * 0.4)} ${f(by + ry2 * L * 0.4)}Z`;
        break;
      }
      case 'rocky': {
        // Angular stone lumps along the top and sides.
        if (ny > 0.35) break;
        const r = z * (2.4 + rng() * 1.4), k = 5, pts: number[][] = [];
        for (let j = 0; j < k; j++) { const t = (j / k) * TAU + rng() * 0.5, q = r * (0.75 + rng() * 0.35); pts.push([x + nx * r * 0.05 + Math.cos(t) * q, y + ny * r * 0.05 + Math.sin(t) * q]); }
        d += 'M' + pts.map(q => f(q[0]) + ' ' + f(q[1])).join('L') + 'Z';
        shine += `M${f(pts[0][0])} ${f(pts[0][1])}L${f(pts[1][0])} ${f(pts[1][1])}`;
        break;
      }
    }
  });
  if (d) p.path(d, coat === 'rocky' ? stone : c.base);
  if (shine) p.line(shine, '#ffffff', Math.max(0.5, z * 0.35), 0.3);
}

/** What a coat paints on the hide, over the markings: scales, fur flicks, long strands, feather rows, or cracks. */
function coatSkin(p: Pen, ph: Pheno, b: Body, z: number) {
  const coat = ph.coat ?? 'smooth', c = p.pal;
  if (coat === 'smooth') return;
  const [x0, y0, x1, y1] = bodyBox(b), rng = looksRng(ph);
  let d = '', d2 = '';
  switch (coat) {
    case 'scaly': {
      // Overlapping scales in offset rows.
      const s = z * 3;
      for (let j = 0, y = y0 + s * 0.5; y < y1; y += s * 0.62, j++) for (let x = x0 + (j % 2 ? s * 0.5 : 0); x < x1; x += s) {
        if (!inBody(b, x - s * 0.5, y, 0.86) || !inBody(b, x + s * 0.5, y + s * 0.4, 0.86)) continue;
        d += `M${f(x - s * 0.5)} ${f(y)}Q${f(x)} ${f(y + s * 0.62)} ${f(x + s * 0.5)} ${f(y)}`;
      }
      p.line(d, c.out, Math.max(0.5, z * 0.32), 0.24);
      break;
    }
    case 'feathered': {
      // Rows of feather edges, lit along the top.
      const s = z * 5.6;
      for (let j = 0, y = y0 + s * 0.4; y < y1; y += s * 0.55, j++) for (let x = x0 + (j % 2 ? s * 0.5 : 0); x < x1; x += s) {
        if (!inBody(b, x - s * 0.5, y, 0.84) || !inBody(b, x + s * 0.5, y + s * 0.4, 0.84)) continue;
        d += `M${f(x - s * 0.5)} ${f(y)}Q${f(x)} ${f(y + s * 0.6)} ${f(x + s * 0.5)} ${f(y)}`;
        d2 += `M${f(x - s * 0.3)} ${f(y + s * 0.12)}Q${f(x)} ${f(y + s * 0.42)} ${f(x + s * 0.3)} ${f(y + s * 0.12)}`;
      }
      p.line(d, c.out, Math.max(0.5, z * 0.34), 0.16);
      p.line(d2, '#ffffff', Math.max(0.5, z * 0.36), 0.28);
      break;
    }
    case 'fluffy':
    case 'shaggy': {
      // Fur: short flicks just inside the edge; shaggy adds long strands down the flanks.
      for (const { x, y, nx, ny } of bodyRim(b, z * 4.2)) {
        const ax = x - nx * z * 1.6, ay = y - ny * z * 1.6, bx = x - nx * z * 3.4 - ny * z * 0.8, by = y - ny * z * 3.4 + nx * z * 0.8;
        if (inBody(b, bx, by, 0.9)) d += `M${f(ax)} ${f(ay)}Q${f((ax + bx) / 2 + nx * z * 0.5)} ${f((ay + by) / 2 + ny * z * 0.5)} ${f(bx)} ${f(by)}`;
      }
      if (coat === 'shaggy') {
        const s = z * 3.2;
        for (let x = x0 + s; x < x1; x += s) for (let y = y0 + s; y < y1; y += s * 2.2) {
          const yy = y + (rng() - 0.5) * s, L = z * (4 + rng() * 2.5);
          if (!inBody(b, x, yy, 0.82) || !inBody(b, x - z, yy + L, 0.86)) continue;
          d2 += `M${f(x)} ${f(yy)}Q${f(x + z * 0.6)} ${f(yy + L * 0.5)} ${f(x - z)} ${f(yy + L)}`;
        }
      }
      p.line(d, c.out, Math.max(0.5, z * 0.36), 0.16);
      if (d2) p.line(d2, c.out, Math.max(0.5, z * 0.4), 0.18);
      break;
    }
    case 'rocky': {
      // A few stone patches and cracks.
      const tries = 40, spots: number[][] = [];
      for (let i = 0; i < tries && spots.length < 5; i++) {
        const x = x0 + rng() * (x1 - x0), y = y0 + rng() * (y1 - y0);
        if (inBody(b, x, y, 0.62)) spots.push([x, y]);
      }
      spots.forEach(([x, y], i) => {
        if (i < 2) blob(p, x, y, z * (2.4 + rng() * 1.2), mix(c.base, '#8d8778', 0.45), rng, { op: 0.75 }, 5);
        else {
          let px = x, py = y;
          d += `M${f(px)} ${f(py)}`;
          for (let k = 0; k < 3; k++) {
            const nx2 = px + (rng() - 0.3) * z * 3, ny2 = py + (rng() - 0.5) * z * 3;
            if (!inBody(b, nx2, ny2, 0.8)) break;
            d += `L${f(nx2)} ${f(ny2)}`; px = nx2; py = ny2;
          }
        }
      });
      if (d) p.line(d, c.out, Math.max(0.5, z * 0.38), 0.4);
      break;
    }
  }
}

/**
 * Two-tone over the body, under the markings: a darker back (the side of the line through P facing N), or pale
 * patches. Points and socks are on the limbs and are drawn with them.
 */
function twoTone(p: Pen, ph: Pheno, b: Body, P: [number, number], N: [number, number], z: number) {
  const c = p.pal, kind = ph.twotone ?? 'solid';
  if (kind === 'dorsal') {
    if (b.rib) {
      // A serpent: the back half of the ribbon, darker.
      const { pts, ws } = b.rib, top: string[] = [], mid: string[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a0 = pts[Math.max(0, i - 1)], a1 = pts[Math.min(pts.length - 1, i + 1)], dx = a1[0] - a0[0], dy = a1[1] - a0[1], L = Math.hypot(dx, dy) || 1, nx = dy / L, ny = -dx / L;
        const h = ws[i] / 2;
        top.push(f(pts[i][0] + nx * h * 0.98) + ' ' + f(pts[i][1] + ny * h * 0.98));
        mid.unshift(f(pts[i][0] - nx * h * 0.1) + ' ' + f(pts[i][1] - ny * h * 0.1));
      }
      p.path('M' + top.join('L') + 'L' + mid.join('L') + 'Z', c.dorsal, { line: false });
      return;
    }
    const [nx, ny] = N, dx = -ny, dy = nx;
    const ends: number[] = [];
    for (const [cx, cy, rx, ry] of b.hull) {
      // Where the cut line crosses this ellipse.
      const ux = (P[0] - cx) / rx, uy = (P[1] - cy) / ry, vx = dx / rx, vy = dy / ry;
      const A = vx * vx + vy * vy, B = 2 * (ux * vx + uy * vy), C = ux * ux + uy * uy - 1, disc = B * B - 4 * A * C;
      const centreDorsal = (cx - P[0]) * nx + (cy - P[1]) * ny > 0;
      if (disc <= 0) { if (centreDorsal) p.ell(cx, cy, rx, ry, c.dorsal, { line: false }); continue; }
      const s1 = (-B - Math.sqrt(disc)) / (2 * A), s2 = (-B + Math.sqrt(disc)) / (2 * A);
      ends.push(s1, s2);
      const ax = P[0] + dx * s1, ay = P[1] + dy * s1, bx = P[0] + dx * s2, by = P[1] + dy * s2;
      const sweep = dx * ny - dy * nx < 0 ? 1 : 0;
      p.path(`M${f(ax)} ${f(ay)}A${f(rx)} ${f(ry)} 0 ${centreDorsal ? 1 : 0} ${sweep} ${f(bx)} ${f(by)}Z`, c.dorsal, { line: false });
    }
    if (ends.length) {
      // Feather the edge so it fades into the belly colour.
      const s0 = Math.min(...ends) + z * 1.5, s1 = Math.max(...ends) - z * 1.5, pts: number[][] = [];
      for (let i = 0; i <= 8; i++) { const sv = s0 + ((s1 - s0) * i) / 8; pts.push([P[0] + dx * sv - nx * z * 0.3, P[1] + dy * sv - ny * z * 0.3]); }
      if (s1 > s0) p.soft(pts, z * 2.2, c.dorsal, 0.4);
    }
  } else if (kind === 'piebald') {
    const rng = looksRng(ph);
    if (b.rib) {
      const { pts, ws } = b.rib;
      for (const g of [0.38, 0.6, 0.8]) { const i = Math.round(g * (pts.length - 1)); blob(p, pts[i][0], pts[i][1], ws[i] * 0.34, c.patch, rng); }
      return;
    }
    const [cx, cy, rx, ry] = b.hull[0], r = Math.min(rx, ry);
    const n = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      const u = (i / n - 0.4 + (rng() - 0.5) * 0.2) * 1.2, v = (rng() - 0.5) * 0.8, x = cx + rx * u, y = cy + ry * v;
      // Shrink a patch until it sits inside the body, so none spills past the outline.
      let q = r * (0.3 + rng() * 0.12);
      const fits = () => Array.from({ length: 8 }, (_, j) => (j / 8) * TAU).every(t => inBody(b, x + Math.cos(t) * q * 1.15, y + Math.sin(t) * q * 1.0, 0.95));
      while (q > z * 1.5 && !fits()) q *= 0.85;
      if (fits()) blob(p, x, y, q, c.patch, rng);
    }
  }
}
/** n points along an ellipse's rim between angles t0 and t1 (radians, 0 is the front, -π/2 the top). */
function ellSpine(cx: number, cy: number, rx: number, ry: number, t0: number, t1: number, n: number): Spine {
  const out: Spine = [];
  for (let i = 0; i < n; i++) {
    const t = t0 + ((t1 - t0) * i) / (n - 1), nx = Math.cos(t) / rx, ny = Math.sin(t) / ry, L = Math.hypot(nx, ny);
    out.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t), nx: nx / L, ny: ny / L });
  }
  return out;
}

/**
 * A crest along the back from the crest gene: spikes, a mane, plates, quills, a sail or crystals. It goes down
 * behind the body, with each piece's base a little inside the outline so the body covers it and it grows out
 * of the back. z scales it to the creature.
 */
function drawCrest(p: Pen, ph: Pheno, sp: Spine, z: number) {
  const kind = ph.crest ?? 'none';
  if (kind === 'none' || sp.length < 2) return;
  const c = p.pal, g0 = p.g;
  p.g = 'back';
  const n = sp.length;
  /** Toward the tail along the back, at point i. */
  const rear = (i: number) => {
    const a2 = sp[Math.max(0, i - 1)], b2 = sp[Math.min(n - 1, i + 1)], dx = a2.x - b2.x, dy = a2.y - b2.y, L = Math.hypot(dx, dy) || 1;
    return [dx / L, dy / L];
  };
  const P = (q: [number, number]) => f(q[0]) + ' ' + f(q[1]);
  /** Where a piece at point i reaches: `out` along the outward normal and `back` toward the tail, from `sink` inside. */
  const at = (i: number, out: number, back = 0, sink = 1.6): [number, number] => {
    const { x, y, nx, ny } = sp[i], [rx, ry] = rear(i);
    return [x - nx * sink + nx * out + rx * back, y - ny * sink + ny * out + ry * back];
  };
  const side = (i: number, w: number, sink = 1.6): [[number, number], [number, number]] => {
    const [rx, ry] = rear(i), { x, y, nx, ny } = sp[i];
    return [[x - nx * sink + rx * w, y - ny * sink + ry * w], [x - nx * sink - rx * w, y - ny * sink - ry * w]];
  };
  const swell = (i: number) => 0.55 + 0.45 * Math.sin((Math.PI * (i + 0.5)) / n);
  z *= 1.7;
  switch (kind) {
    case 'spikes':
      for (let i = 0; i < n; i++) {
        const h = z * 6.5 * swell(i), [r0, f0] = side(i, z * 2.2), tip = at(i, h, h * 0.35);
        p.path(`M${P(r0)}L${P(tip)}L${P(f0)}Z`, c.accent);
        p.line(`M${P(at(i, h * 0.15, z * 0.6))}L${P(at(i, h * 0.8, h * 0.3))}`, '#ffffff', Math.max(0.5, z * 0.5), 0.3);
      }
      break;
    case 'plates':
      // Rounded, alternating plates like a stegosaur's, each with a darker rim inside.
      for (let i = 0; i < n; i++) {
        const h = z * (i % 2 ? 6 : 8) * swell(i), w = z * 3.2 * swell(i), [r0, f0] = side(i, w), tip = at(i, h, h * 0.2);
        const cr = at(i, h * 0.7, w * 1.05 + h * 0.15), cf = at(i, h * 0.75, -w * 0.9 + h * 0.15);
        p.path(`M${P(r0)}Q${P(cr)} ${P(tip)}Q${P(cf)} ${P(f0)}Z`, c.accent);
        p.line(`M${P(at(i, h * 0.18, w * 0.55))}Q${P(at(i, h * 0.62, w * 0.6 + h * 0.15))} ${P(at(i, h * 0.8, h * 0.18))}`, c.accentDark, Math.max(0.6, z * 0.45), 0.55);
      }
      break;
    case 'mane': {
      // Tufts of hair swept back, growing fuller toward the front.
      const hair = mix(c.dark, c.accentDark, 0.4);
      for (let i = 0; i < n; i++) {
        const k2 = 0.6 + 0.4 * (i / (n - 1)), h = z * 6.5 * k2, w = z * 2.6 * k2, [r0, f0] = side(i, w), tip = at(i, h * 0.75, h * 0.95);
        p.path(`M${P(f0)}Q${P(at(i, h * 0.95, -w * 0.2))} ${P(tip)}Q${P(at(i, h * 0.3, h * 0.5))} ${P(r0)}Z`, hair);
      }
      break;
    }
    case 'quills':
      // Long, thin spines laid back, pale with dark tips.
      for (let i = 0; i < n * 2 - 1; i++) {
        const j = i / 2, i0 = Math.floor(j), w2 = j - i0, k2 = swell(Math.min(n - 1, Math.round(j)));
        const blend = (q: [number, number], q2: [number, number]): [number, number] => [q[0] + (q2[0] - q[0]) * w2, q[1] + (q2[1] - q[1]) * w2];
        const i1 = Math.min(n - 1, i0 + 1), h = z * (i % 2 ? 6 : 8) * k2;
        const [r0, f0] = side(i0, z * 0.9), [r1, f1] = side(i1, z * 0.9), tip = blend(at(i0, h * 0.7, h * 0.75), at(i1, h * 0.7, h * 0.75));
        const a1 = blend(r0, r1), b1 = blend(f0, f1);
        p.path(`M${P(a1)}L${P(tip)}L${P(b1)}Z`, mix(c.light, '#ffffff', 0.35));
        const m: [number, number] = [a1[0] + (tip[0] - a1[0]) * 0.62, a1[1] + (tip[1] - a1[1]) * 0.62], m2: [number, number] = [b1[0] + (tip[0] - b1[0]) * 0.62, b1[1] + (tip[1] - b1[1]) * 0.62];
        p.path(`M${P(m)}L${P(tip)}L${P(m2)}Z`, c.dark, { line: false });
      }
      break;
    case 'sail': {
      // A webbed sail held up by spines, scooped between them.
      const tips = sp.map((_, i) => at(i, z * 9 * Math.sin((Math.PI * (i + 0.6)) / (n + 0.2)), z * 1.2));
      let d = `M${P(at(0, 0, 0, 2.2))}`;
      tips.forEach((t, i) => {
        if (i === 0) { d += `L${P(t)}`; return; }
        const pr = tips[i - 1], mid = at(i, z * 9 * Math.sin((Math.PI * (i + 0.1)) / (n + 0.2)) * 0.62, z * 2.2);
        d += `Q${P([(pr[0] + t[0]) / 2 * 0.5 + mid[0] * 0.5, (pr[1] + t[1]) / 2 * 0.5 + mid[1] * 0.5])} ${P(t)}`;
      });
      d += `L${P(at(n - 1, 0, 0, 2.2))}Z`;
      p.path(d, mix(c.accent, c.base, 0.25));
      p.line(tips.map((t, i) => `M${P(at(i, 0.4, 0))}L${P(t)}`).join(''), c.accentDark, Math.max(0.6, z * 0.5), 0.75);
      break;
    }
    case 'crystals':
      // Gem shards of different heights, each with a lit face and a shaded one.
      for (let i = 0; i < n; i++) {
        const h = z * (i % 2 ? 6.5 : 9) * swell(i), w = z * 2.3, lean = (i % 3 - 1) * z * 1.5;
        const [r0, f0] = side(i, w), sr = at(i, h * 0.72, w * 1.05 + lean * 0.7), sf = at(i, h * 0.72, -w * 1.0 + lean * 0.7), tip = at(i, h, lean), mid = at(i, 0, 0);
        const glass = mix(c.light, '#ffffff', 0.3);
        p.path(`M${P(r0)}L${P(sr)}L${P(tip)}L${P(sf)}L${P(f0)}Z`, glass);
        p.path(`M${P(mid)}L${P(tip)}L${P(sf)}L${P(f0)}Z`, mix(glass, ELEMENTS[ph.el1].glow, 0.35), { line: false });
        p.path(`M${P(r0)}L${P(sr)}L${P(tip)}L${P(mid)}Z`, c.out, { line: false, op: 0.12 });
      }
      break;
  }
  p.g = g0;
}

/**
 * Ears from the ears gene, on the crown either side of the middle of the face, as a 3/4 view shows them: the
 * near ear toward the back of the head, the far one above the far eye, a little smaller and in shade. They sit on
 * the actual top of the head (long and blunt heads included) and lean out from it. Everything goes down before
 * the skull so the bases tuck under it, except a near floppy ear, which hangs over the back of the head and is
 * drawn with `front`. A head that is already eared keeps its own big ears.
 */
function drawEars(p: Pen, a: Anchors, ph: Pheno, front: boolean) {
  const kind = ph.ears ?? 'none';
  if (kind === 'none' || ph.head === 'eared') return;
  const c = p.pal, { hx, hy, hr: r } = a, H = headEllipse(ph, hx, hy, r);
  const inner = mix(c.accent, '#ff9fbf', 0.35), skin = c.limb, shadeSkin = shade(skin, -0.08);
  /** A point on the top of the head at x, sunk `sink` radii inside, and the outward direction there. */
  const crown = (x: number, sink: number) => {
    const u = Math.max(-0.92, Math.min(0.92, (x - H.cx) / H.rx)), q = Math.sqrt(1 - u * u);
    let nx = u / H.rx, ny = -q / H.ry;
    const L = Math.hypot(nx, ny); nx /= L; ny /= L;
    return { x: H.cx + H.rx * u - nx * sink * r, y: H.cy - H.ry * q - ny * sink * r, nx, ny };
  };
  // Near ear behind the near eye; far ear above the far eye.
  const near = crown(hx - r * 0.28, 0.14), far = crown(hx + r * 0.42, 0.14);
  /** Turn a direction by deg degrees (negative leans back toward the tail). */
  const turn = (nx: number, ny: number, deg: number): [number, number] => { const q = (deg * Math.PI) / 180; return [nx * Math.cos(q) - ny * Math.sin(q), nx * Math.sin(q) + ny * Math.cos(q)]; };
  /** A pointed ear from (bx, by) along (ux, uy), h radii long and w radii wide at the base, with a pink inside. */
  const pointed = (bx: number, by: number, ux: number, uy: number, h: number, w: number, col: string, tuft: boolean, inside = true) => {
    const nx = -uy, ny = ux, H2 = h * r, W2 = w * r;
    const tip: [number, number] = [bx + ux * H2, by + uy * H2];
    const L: [number, number] = [bx - nx * W2, by - ny * W2], R: [number, number] = [bx + nx * W2, by + ny * W2];
    p.path(`M${f(L[0])} ${f(L[1])}Q${f(L[0] + ux * H2 * 0.62 + nx * W2 * 0.1)} ${f(L[1] + uy * H2 * 0.62 + ny * W2 * 0.1)} ${f(tip[0])} ${f(tip[1])}Q${f(R[0] + ux * H2 * 0.55 - nx * W2 * 0.1)} ${f(R[1] + uy * H2 * 0.55 - ny * W2 * 0.1)} ${f(R[0])} ${f(R[1])}Z`, col);
    if (inside) {
      const ix = bx + ux * H2 * 0.2, iy = by + uy * H2 * 0.2, iw = W2 * 0.52;
      p.path(`M${f(ix - nx * iw)} ${f(iy - ny * iw)}Q${f(ix - nx * iw * 0.6 + ux * H2 * 0.45)} ${f(iy - ny * iw * 0.6 + uy * H2 * 0.45)} ${f(tip[0] - ux * H2 * 0.18)} ${f(tip[1] - uy * H2 * 0.18)}Q${f(ix + nx * iw * 0.5 + ux * H2 * 0.4)} ${f(iy + ny * iw * 0.5 + uy * H2 * 0.4)} ${f(ix + nx * iw)} ${f(iy + ny * iw)}Z`, inner, { line: false });
    }
    if (tuft) p.path(`M${f(tip[0] - nx * r * 0.06)} ${f(tip[1] - ny * r * 0.06)}L${f(tip[0] + ux * r * 0.4 - nx * r * 0.08)} ${f(tip[1] + uy * r * 0.4 - ny * r * 0.08)}L${f(tip[0] + nx * r * 0.07)} ${f(tip[1] + ny * r * 0.07)}Z`, c.dark, { line: false });
  };
  /** The pair of pointed-type ears: lean, length and width for each. */
  const pair = (h: number, w: number, leanN: number, leanF: number, tuft: boolean) => {
    const [fx, fy] = turn(far.nx, far.ny, leanF), [nx, ny] = turn(near.nx, near.ny, leanN);
    pointed(far.x, far.y, fx, fy, h * 0.9, w * 0.9, shadeSkin, tuft);
    pointed(near.x, near.y, nx, ny, h, w, skin, tuft);
  };
  switch (kind) {
    case 'pointed':
      if (!front) pair(0.7, 0.27, -14, 10, false);
      break;
    case 'tufted':
      if (!front) pair(0.86, 0.25, -12, 8, true);
      break;
    case 'long':
      // Tall rabbit ears, swept back.
      if (!front) pair(1.38, 0.2, -26, -8, false);
      break;
    case 'round':
      if (!front) {
        for (const [e, col, k] of [[far, shadeSkin, 0.9], [near, skin, 1]] as [typeof near, string, number][]) {
          const ex = e.x + e.nx * r * 0.26, ey = e.y + e.ny * r * 0.26;
          p.ell(ex, ey, r * 0.3 * k, r * 0.28 * k, col);
          p.ell(ex + e.nx * r * 0.02, ey + e.ny * r * 0.02, r * 0.17 * k, r * 0.16 * k, inner, { line: false });
        }
      }
      break;
    case 'floppy': {
      // Soft, rounded ears that fold over at the crown and hang down: the near one over the back of the head
      // (clear of the eye), the far one peeking out behind the crown.
      const ear = (ax: number, ay: number, bx: number, by: number, w: number, col: string, crease: boolean) => {
        const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
        const P = (along: number, across: number) => `${f(ax + ux * L * along + nx * w * across)} ${f(ay + uy * L * along + ny * w * across)}`;
        // Narrow where it joins the head, widest two-thirds down, with a round end.
        p.path(`M${P(0, -0.45)}C${P(0.3, -1.05)} ${P(0.82, -1.1)} ${P(0.97, -0.45)}C${P(1.08, 0.1)} ${P(1.02, 0.7)} ${P(0.8, 0.85)}C${P(0.55, 1.0)} ${P(0.22, 0.75)} ${P(0, 0.4)}Z`, col);
        if (crease) {
          // The fold at the top, and a soft shadow down the side nearest the face.
          p.line(`M${P(0.06, -0.3)}Q${P(0.16, 0.05)} ${P(0.08, 0.38)}`, c.out, Math.max(0.6, r * 0.05), 0.55);
          p.soft([[ax + ux * L * 0.3 + nx * w * 0.5, ay + uy * L * 0.3 + ny * w * 0.5], [ax + ux * L * 0.6 + nx * w * 0.55, ay + uy * L * 0.6 + ny * w * 0.55], [ax + ux * L * 0.85 + nx * w * 0.4, ay + uy * L * 0.85 + ny * w * 0.4]], w * 0.45, shade(col, -0.16), 0.5);
        }
      };
      if (!front) {
        // The far ear hangs down behind the head on the far side; only its outer edge shows past the crown.
        const e = crown(hx + r * 0.48, 0.1);
        ear(e.x, e.y, e.x + r * 0.5, e.y + r * 0.85, r * 0.3, shadeSkin, false);
      } else {
        // The near ear hangs off the back of the head, half over its edge, well clear of the eyes.
        const e = crown(hx - r * 0.55, 0.06);
        ear(e.x, e.y, e.x - r * 0.5, e.y + r * 1.08, r * 0.36, skin, true);
      }
      break;
    }
    case 'fins': {
      // Fanned fins swept back from the side of the head, with ribs, and a smaller one over the crown.
      if (front) break;
      const fin = (bx0: number, by0: number, bx1: number, by1: number, tips: [number, number][], col: string) => {
        let d = `M${f(bx0)} ${f(by0)}`;
        tips.forEach(([tx, ty], i) => {
          const [px, py] = i ? tips[i - 1] : [bx0, by0];
          d += `Q${f((px + tx) / 2 + (bx0 - bx1) * 0.08)} ${f((py + ty) / 2 + (by0 - by1) * 0.08)} ${f(tx)} ${f(ty)}`;
        });
        d += `L${f(bx1)} ${f(by1)}Z`;
        p.path(d, col);
        const mx = (bx0 + bx1) / 2, my = (by0 + by1) / 2;
        p.line(tips.map(([tx, ty]) => `M${f(mx)} ${f(my)}L${f(mx + (tx - mx) * 0.85)} ${f(my + (ty - my) * 0.85)}`).join(''), c.accentDark, Math.max(0.6, r * 0.05), 0.7);
      };
      const t = crown(hx + r * 0.05, 0.1), bk = H.cx - H.rx * 0.78;
      fin(t.x - r * 0.15, t.y, t.x + r * 0.12, t.y + r * 0.08, [[t.x - r * 0.42, t.y - r * 0.6], [t.x - r * 0.1, t.y - r * 0.52]], mix(c.accent, c.base, 0.3));
      fin(bk, hy - r * 0.42, bk + r * 0.02, hy + r * 0.28, [[bk - r * 0.72, hy - r * 0.78], [bk - r * 0.86, hy - r * 0.2], [bk - r * 0.6, hy + r * 0.4]], c.accent);
      break;
    }
  }
}

function drawHead(p: Pen, a: Anchors, ph: Pheno, feat: number, ko = false, pose: Pose = 'idle') {
  const c = p.pal;
  const { hx, hy, hr: r } = a;
  drawHorns(p, a, ph, feat);
  if (ph.coat === 'fluffy' || ph.coat === 'shaggy' || ph.coat === 'feathered') {
    // Cheek tufts behind the jaw, merging into the head's outline.
    p.poly([[hx - r * 0.5, hy + r * 0.05], [hx - r * 1.14, hy + r * 0.4], [hx - r * 0.8, hy + r * 0.5], [hx - r * 0.98, hy + r * 0.86], [hx - r * 0.45, hy + r * 0.72]], c.base);
  }
  if (ph.head === 'eared') {
    p.poly([[hx - r * 0.85, hy - r * 0.3], [hx - r * 0.75, hy - r * 1.45], [hx - r * 0.1, hy - r * 0.8]], c.base);
    p.poly([[hx + r * 0.1, hy - r * 0.8], [hx + r * 0.6, hy - r * 1.5], [hx + r * 0.85, hy - r * 0.45]], c.base);
    p.poly([[hx + r * 0.3, hy - r * 0.8], [hx + r * 0.58, hy - r * 1.25], [hx + r * 0.72, hy - r * 0.6]], c.accent, { line: false });
  }
  if (ph.head === 'frill') {
    p.path(`M${f(hx - r * 0.2)} ${f(hy - r * 0.9)}L${f(hx - r * 1.2)} ${f(hy - r * 1.3)}L${f(hx - r * 0.9)} ${f(hy - r * 0.5)}L${f(hx - r * 1.6)} ${f(hy - r * 0.3)}L${f(hx - r * 0.95)} ${f(hy + r * 0.2)}L${f(hx - r * 1.4)} ${f(hy + r * 0.75)}L${f(hx - r * 0.3)} ${f(hy + r * 0.7)}Z`, c.accent);
  }
  // Ears after the frill, so a frill doesn't hide them.
  drawEars(p, a, ph, false);
  // A wider jaw under the skull gives the head cheeks instead of a plain circle.
  const jaw = () => p.ell(hx + r * 0.1, hy + r * 0.3, r * 0.96, r * 0.62, c.base);
  const shadeSkullJaw = () => shadeHead(p, [[hx, hy, r, r * 0.95], [hx + r * 0.1, hy + r * 0.3, r * 0.96, r * 0.62]], hx - r * 0.28, hy - r * 0.52, r * 0.36, r * 0.14);
  switch (ph.head) {
    case 'snout':
      // The head is shaded before the muzzle goes on, and the muzzle gets its own shadow underneath, so the
      // head's shadow doesn't cut across the muzzle and stop short at the head's edge.
      p.ell(hx, hy, r, r * 0.95, c.base); jaw();
      shadeSkullJaw();
      p.ell(hx + r * 0.72, hy + r * 0.3, r * 0.6, r * 0.42, c.light);
      shadeUnder(p, hx + r * 0.72, hy + r * 0.3, r * 0.6, r * 0.42, 0.14);
      p.dot(hx + r * 1.15, hy + r * 0.18, r * 0.11, c.out);
      break;
    case 'beak': {
      // A curved upper bill with a nostril and a glint along its ridge, over a smaller, darker lower bill. The
      // lower bill and the inside of the mouth go down before the head, so their bases tuck under the face
      // and only the part that sticks out shows; opening, the lower bill swings down on a hinge at the corner
      // of the mouth instead of sliding over the cheek. The head is shaded before the upper bill goes on, so
      // its shadow doesn't fall across the beak.
      const bx0 = hx + r * 0.62, tipx = hx + r * 1.62, tipy = hy + r * 0.34;
      const gape = ko ? 0 : pose === 'roar' ? 1 : pose === 'attack' ? 0.8 : pose === 'cast' ? 0.55 : pose === 'hurt' ? 0.4 : 0;
      const hgx = hx + r * 0.9, hgy = hy + r * 0.42, th = (gape * 32 * Math.PI) / 180, ct = Math.cos(th), st = Math.sin(th);
      const R = (x: number, y: number) => { const dx = x - hgx, dy = y - hgy; return f(hgx + dx * ct - dy * st) + ' ' + f(hgy + dx * st + dy * ct); };
      if (gape) p.path(`M${f(hx + r * 0.75)} ${f(hy + r * 0.4)}L${f(hx + r * 1.46)} ${f(hy + r * 0.4)}L${R(hx + r * 1.4, hy + r * 0.44)}L${R(hx + r * 0.75, hy + r * 0.44)}Z`, '#3a1626', { line: false });
      // Slim, and no deeper than the face's edge where it comes out, so it doesn't hang below the chin.
      p.path(`M${R(hx + r * 0.75, hy + r * 0.4)}L${R(hx + r * 1.42, hy + r * 0.42)}Q${R(hx + r * 1.1, hy + r * 0.58)} ${R(hx + r * 0.75, hy + r * 0.56)}Z`, '#d9933a');
      if (gape) p.path(`M${R(hx + r * 1.0, hy + r * 0.47)}L${R(hx + r * 1.32, hy + r * 0.46)}`, 'none', { stroke: '#e0677a', sw: Math.max(0.8, r * 0.12) });
      p.ell(hx, hy, r, r * 0.95, c.base); jaw();
      shadeSkullJaw();
      p.path(`M${f(bx0)} ${f(hy - r * 0.04)}Q${f(hx + r * 1.22)} ${f(hy - r * 0.06)} ${f(tipx)} ${f(tipy)}Q${f(hx + r * 1.16)} ${f(hy + r * 0.44)} ${f(bx0 + r * 0.06)} ${f(hy + r * 0.38)}Z`, '#f2b84c');
      p.line(`M${f(bx0 + r * 0.14)} ${f(hy + r * 0.04)}Q${f(hx + r * 1.15)} ${f(hy + r * 0.04)} ${f(tipx - r * 0.12)} ${f(tipy - r * 0.04)}`, '#ffe2a0', Math.max(0.7, r * 0.07), 0.75);
      p.dot(hx + r * 0.9, hy + r * 0.14, Math.max(0.5, r * 0.045), '#a8702a');
      break;
    }
    case 'blunt': {
      // A rounded skull with a big square jaw.
      // The skull is shaded first; the jaw goes over it with its own shadow along its bottom edge, which carries
      // on from the skull's, instead of the skull's curved shadow cutting through the middle of the jaw.
      p.ell(hx - r * 0.1, hy, r * 0.95, r * 0.92, c.base);
      shadeForm(p, hx - r * 0.1, hy, r * 0.95, r * 0.92);
      const x0 = hx + r * 0.05, x1 = hx + r * 1.2, y0 = hy - r * 0.3, y1 = hy + r * 0.88, q = r * 0.36;
      p.path(`M${f(x0)} ${f(y0)}L${f(x1 - q)} ${f(y0)}Q${f(x1)} ${f(y0)} ${f(x1)} ${f(y0 + q)}L${f(x1)} ${f(y1 - q)}Q${f(x1)} ${f(y1)} ${f(x1 - q)} ${f(y1)}L${f(x0)} ${f(y1)}Z`, c.base);
      p.path(`M${f(x0)} ${f(y1 - q)}L${f(x1)} ${f(y1 - q)}Q${f(x1)} ${f(y1)} ${f(x1 - q)} ${f(y1)}L${f(x0)} ${f(y1)}Z`, c.out, { line: false, op: 0.2 });
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
      shadeSkullJaw();
      break;
    default:
      p.ell(hx, hy, r, r * 0.95, c.base); jaw();
      shadeSkullJaw();
  }
  if (ph.twotone === 'dorsal') {
    // The darker back carries on over the crown.
    const e = headEllipse(ph, hx, hy, r);
    twoTone(p, ph, { hull: [[e.cx, e.cy, e.rx, e.ry]] }, [hx, hy - r * 0.42], [-0.35, -0.94], r * 0.08);
  } else if (ph.twotone === 'piebald' && looksRng(ph)() < 0.6) {
    // A pale patch over one eye.
    blob(p, hx + r * 0.12, hy - r * 0.12, r * 0.4, c.patch, looksRng(ph));
  }
  if (ph.pattern === 'mask') p.ell(hx + r * 0.32, hy - r * 0.1, r * 0.62, r * 0.36, c.dark, { line: false, op: 0.75 });
  if (ph.ears === 'floppy' && ph.head !== 'eared') {
    // The near floppy ear hangs over the side of the head, so it gets its own outline against it.
    const g0 = p.g;
    p.g = 'front';
    drawEars(p, a, ph, true);
    p.g = g0;
  }
  p.g = 'face';
  drawEyes(p, hx, hy, r, ph, ko, pose);
  const open = !ko && (pose === 'attack' || pose === 'cast' || pose === 'hurt' || pose === 'roar');
  const mouthX = ph.head === 'beak' ? hx + r * 1.0 : ph.head === 'long' ? hx + r * 1.0 : ph.head === 'snout' ? hx + r * 0.95 : ph.head === 'blunt' ? hx + r * 0.85 : hx + r * 0.55;
  if (!ko && pose === 'happy') {
    // A wide, open smile.
    const mx = mouthX - r * 0.05, my = hy + r * 0.42, w = r * 0.3;
    p.path(`M${f(mx - w)} ${f(my)}Q${f(mx)} ${f(my + w * 1.5)} ${f(mx + w)} ${f(my)}Z`, '#3a1626');
    p.path(`M${f(mx - w * 0.5)} ${f(my + w * 0.55)}Q${f(mx)} ${f(my + w * 1.15)} ${f(mx + w * 0.5)} ${f(my + w * 0.55)}Z`, '#e0677a', { line: false });
  } else if (!ko && pose === 'guard') {
    p.line(`M${f(hx + r * 0.3)} ${f(hy + r * 0.5)}L${f(hx + r * 0.72)} ${f(hy + r * 0.46)}`, c.out, 1.2);
  } else if (ko || pose === 'dizzy') {
    // Knocked out: a dazed, wavy mouth instead of a smile.
    const mx = ph.head === 'beak' || ph.head === 'long' ? hx + r * 0.75 : ph.head === 'snout' ? hx + r * 0.75 : hx + r * 0.5;
    const my = hy + r * 0.5, w = r * 0.22;
    p.line(`M${f(mx - w * 1.5)} ${f(my)}q${f(w * 0.37)} ${f(-w * 0.45)} ${f(w * 0.75)} 0q${f(w * 0.37)} ${f(w * 0.45)} ${f(w * 0.75)} 0q${f(w * 0.37)} ${f(-w * 0.45)} ${f(w * 0.75)} 0q${f(w * 0.37)} ${f(w * 0.45)} ${f(w * 0.75)} 0`, c.out, Math.max(1, r * 0.09));
  } else if (open && ph.head !== 'beak') {
    // Open mouth: a roar for attacks and casts, a gasp when hurt. (A beak opens its bill instead.)
    const mx = ph.head === 'beak' ? hx + r * 1.0 : ph.head === 'long' ? hx + r * 1.0 : ph.head === 'snout' ? hx + r * 0.95 : ph.head === 'blunt' ? hx + r * 0.85 : hx + r * 0.55;
    const my = ph.head === 'beak' ? hy + r * 0.5 : hy + r * 0.48;
    const mr = pose === 'hurt' ? r * 0.14 : pose === 'roar' ? r * 0.38 : pose === 'attack' ? r * 0.3 : r * 0.22;
    p.ell(mx, my, mr, mr * (pose === 'hurt' ? 1 : 0.8), '#3a1626');
    if (pose !== 'hurt') p.ell(mx, my + mr * 0.35, mr * 0.55, mr * 0.3, '#e0677a', { line: false });
  } else if (ph.head !== 'beak' && ph.head !== 'blunt') moodMouth(p, hx, hy, r, pose === 'idle' || pose === 'blink' ? ph.mood ?? 'calm' : 'calm');
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
    case 'belly':
      if (a.flatBack) {
        // On a long body the pale belly runs along the underside, out to the outline and following its curve,
        // tapering off toward chest and hips; a floating oval on the flank looked stuck on, worst on bulky ones.
        const lo: string[] = [], hi: string[] = [], N = 14, u0 = -0.86, u1 = 0.88;
        for (let i = 0; i <= N; i++) {
          const t = i / N, u = u0 + (u1 - u0) * t, yb = by + bry * Math.sqrt(Math.max(0, 1 - u * u)) * 0.99;
          lo.push(f(bx + brx * u) + ' ' + f(yb));
          hi.unshift(f(bx + brx * u) + ' ' + f(yb - bry * 0.46 * Math.pow(Math.sin(Math.PI * t), 0.75)));
        }
        p.path('M' + lo.join('L') + 'L' + hi.join('L') + 'Z', c.light, { line: false });
      } else if (ph.skel === 'biped') {
        // An upright body faces right, so its belly is the front and underside of the pear-shaped torso: a band
        // hugging that outline from the chest down round the bottom, widest at the front of the tummy. (A
        // centred oval sat on the side of the body, not on the belly.)
        const parts = [[bx, by, brx, bry], [bx, by + bry * 0.28, brx * 1.07, bry * 0.72]];
        const ox = bx - brx * 0.1, oy = by + bry * 0.12;
        const edge = (th: number) => {
          const dx = Math.cos(th), dy = Math.sin(th);
          let best = 0;
          for (const [ex, ey, rx, ry] of parts) {
            // Where a ray from (ox, oy) leaves this ellipse.
            const px = (ox - ex) / rx, py = (oy - ey) / ry, qx = dx / rx, qy = dy / ry;
            const A = qx * qx + qy * qy, B = 2 * (px * qx + py * qy), C = px * px + py * py - 1;
            const t = (-B + Math.sqrt(Math.max(0, B * B - 4 * A * C))) / (2 * A);
            best = Math.max(best, t);
          }
          return best * 0.985;
        };
        const N = 18, a0 = (-62 * Math.PI) / 180, a1 = (112 * Math.PI) / 180, lo: string[] = [], hi: string[] = [];
        for (let i = 0; i <= N; i++) {
          const t = i / N, th = a0 + (a1 - a0) * t, d = edge(th), k = 1 - 0.5 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), 0.6);
          lo.push(f(ox + Math.cos(th) * d) + ' ' + f(oy + Math.sin(th) * d));
          hi.unshift(f(ox + Math.cos(th) * d * k) + ' ' + f(oy + Math.sin(th) * d * k));
        }
        p.path('M' + lo.join('L') + 'L' + hi.join('L') + 'Z', c.light, { line: false });
      } else p.ell(bx + brx * 0.1, by + bry * 0.38, brx * 0.68, bry * 0.5, c.light, { line: false });
      break;
    case 'spots':
      p.dot(bx - brx * 0.4, by - bry * 0.25, bry * 0.2, c.mark, 0.7); p.dot(bx + brx * 0.05, by - bry * 0.45, bry * 0.15, c.mark, 0.7);
      p.dot(bx - brx * 0.1, by + bry * 0.2, bry * 0.17, c.mark, 0.7); p.dot(bx + brx * 0.45, by - bry * 0.1, bry * 0.13, c.mark, 0.7);
      break;
    case 'stripes':
      // Soft brush strokes down the back, fading out at their edges and ends.
      for (const t of [-0.45, -0.05, 0.35]) {
        const x0 = bx + brx * t, y0 = by - bry * 0.84, cx = bx + brx * (t + 0.14), cy = by - bry * 0.3, x1 = bx + brx * (t - 0.02), y1 = by + bry * 0.12;
        const pts: number[][] = [];
        for (let i = 0; i <= 10; i++) { const u = i / 10, v = 1 - u; pts.push([v * v * x0 + 2 * v * u * cx + u * u * x1, v * v * y0 + 2 * v * u * cy + u * u * y1]); }
        p.soft(pts, 2.4, c.mark, 0.82);
      }
      break;
    case 'bands':
      // Each band is a slice of the body ellipse that wraps it from top to bottom, its ends following the body's
      // curve right out to the outline. It's laid down in see-through layers of decreasing width, so its sides
      // fade softly into the hide.
      for (const t of [-0.35, 0.3]) {
        const dt0 = Math.max(2.5, brx * 0.2) / 2 / brx;
        const layers = [[1.45, 0.98], [1.2, 0.98], [0.95, 0.98], [0.7, 0.98]], per = 1 - Math.pow(1 - 0.85, 1 / layers.length);
        for (const [kw, kh] of layers) {
          const dt = dt0 * kw, top: string[] = [], bot: string[] = [];
          for (let k = 0; k <= 6; k++) {
            const tt = t - dt + (2 * dt * k) / 6;
            const h = bry * Math.sqrt(Math.max(0, 1 - tt * tt)) * kh;
            top.push(`${f(bx + brx * tt)} ${f(by - h)}`);
            bot.unshift(`${f(bx + brx * tt)} ${f(by + h)}`);
          }
          p.path('M' + top.join('L') + 'L' + bot.join('L') + 'Z', c.accentDark, { line: false, op: per });
        }
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
        // They stay clear of the belly patch: along the spine on long bodies, up the back edge on upright ones.
        const flames: [number, number, number, number, number, number][] = a.flatBack
          // from the shoulder, streaming back: [u0, w0, u1, w1, width, bend]
          ? [[0.55, -0.42, -0.5, -0.72, 0.42, 0.25], [0.55, -0.25, -0.78, -0.32, 0.38, -0.15], [0.45, -0.58, -0.1, -0.86, 0.3, 0.2]]
          // from the back edge, licking up and forward
          : [[-0.78, 0.3, -0.52, -0.2, 0.42, 0.2], [-0.82, -0.04, -0.38, -0.62, 0.46, -0.15], [-0.66, -0.45, -0.18, -0.92, 0.36, 0.2]];
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
        // A sea-turtle carapace: a dome that rises above the back, a row of hexagonal plates down the spine,
        // seams out to a scalloped pale rim, and a gloss on top.
        if (ph.skel === 'serpent') return false;
        const shell = '#5e8c6a', scute = '#7aa784', seam = '#3b5c45', rim = '#b9d2a4';
        // On a long, flat back (four legs, many legs, a swimmer) the shell covers nearly the whole back, from the
        // hips to the shoulders, and comes down the flank to about the middle, with rounded ends that overhang the
        // body a little, so it fits the creature like a real carapace instead of perching on top.
        const flat = !!a.flatBack, swim = ph.skel === 'aquatic';
        const u0 = flat ? (swim ? -0.9 : -1.02) : -0.82, u1 = flat ? (swim ? 0.5 : 0.74) : 0.6;
        const dome = Math.min(brx, bry) * (flat ? 0.4 : 0.34);
        const lip = flat ? Math.min(brx, bry) * 0.1 : 0;
        const crest = (t: number): number[] => {
          if (flat) {
            const u = u0 + (u1 - u0) * t, h = bry * Math.sqrt(Math.max(0, 1 - Math.min(1, u * u)));
            // Ends push outward a touch past the body (the overhanging lip); the middle domes up.
            const out = lip * (1 - Math.sin(t * Math.PI));
            return [bx + brx * u + (t < 0.5 ? -out : out), by - h - dome * Math.pow(Math.sin(t * Math.PI), 0.7)];
          }
          const w = -0.82 + 1.42 * t, h = brx * Math.sqrt(Math.max(0, 1 - w * w));
          return [bx - h - dome * Math.sin(t * Math.PI), by + bry * w];
        };
        // The rim runs low and nearly level across the flank, and curls up to meet the dome at both ends.
        const rimAt = (t: number): number[] => {
          const c = crest(t), k = Math.pow(Math.sin(Math.PI * t), flat ? 0.32 : 0.55);
          const base = flat ? [c[0], by + bry * (0.08 - 0.06 * Math.sin(t * Math.PI))] : [bx - brx * (0.18 + 0.12 * Math.sin(t * Math.PI)), c[1]];
          return [c[0] + (base[0] - c[0]) * k, c[1] + (base[1] - c[1]) * k];
        };
        const P = (t: number, r: number) => { const c = crest(t), q = rimAt(t); return [q[0] + (c[0] - q[0]) * r, q[1] + (c[1] - q[1]) * r]; };
        const pts = (list: number[][]) => list.map(([x, y]) => f(x) + ' ' + f(y)).join('L');
        const N = 18, outerL: number[][] = [], innerL: number[][] = [];
        for (let i = 0; i <= N; i++) { outerL.push(P(i / N, 1)); innerL.unshift(P(i / N, 0)); }
        p.poly([...outerL, ...innerL], shell);
        // The scalloped rim.
        const K = 7, bandTop: number[][] = [];
        for (let i = 0; i <= N; i++) bandTop.push(P(i / N, 0.22));
        let d = 'M' + pts(bandTop);
        for (let k = K; k > 0; k--) {
          const t0 = k / K, t1 = (k - 1) / K, [mx, my] = P((t0 + t1) / 2, -0.16), [ex, ey] = P(t1, 0);
          d += `Q${f(mx)} ${f(my)} ${f(ex)} ${f(ey)}`;
        }
        p.path(d + 'Z', rim, { stroke: seam, sw: 0.8 });
        // Seams from the spine plates down to the rim, then the plates themselves.
        const cuts = [0.16, 0.39, 0.61, 0.84];
        for (const t of cuts) { const [x1, y1] = P(t, 0.24), [x2, y2] = P(t, 0.42); p.line(`M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}`, seam, 1); }
        for (let j = 0; j < 3; j++) {
          const t0 = cuts[j], t1 = cuts[j + 1], w = t1 - t0;
          const hex = [P(t0, 0.66), P(t0 + w * 0.18, 0.9), P(t1 - w * 0.18, 0.9), P(t1, 0.66), P(t1 - w * 0.18, 0.42), P(t0 + w * 0.18, 0.42)];
          p.path('M' + pts(hex) + 'Z', scute, { stroke: seam, sw: 1 });
        }
        // A gloss along the top of the dome.
        const gl: number[][] = [];
        for (let i = 0; i <= 6; i++) gl.push(P(0.3 + (0.28 * i) / 6, 0.95));
        p.line('M' + pts(gl), '#ffffff', Math.max(1, dome * 0.18), 0.35);
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
        // Zigzag stripes across the body. A serpent's body is a ribbon, not an oval, so it gets the lure instead.
        if (ph.skel === 'serpent') return false;
        for (const u of [-0.45, 0, 0.42]) {
          const lim = Math.sqrt(1 - u * u) * 0.78, pts: number[][] = [];
          for (let i = 0; i <= 4; i++) pts.push(body(u + (i % 2 ? 0.09 : -0.05), -lim + (2 * lim * i) / 4));
          p.soft(pts, 2 * s + 0.6, e.dark, 0.9);
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
      {
        // A collar of ice: shards of frost jutting back and down from the bottom-back of the head, long and
        // short in turn, each with a glint. (It used to be a ring of white puffs, which read as a wool collar.)
        // It needs a neck: on a floater or a swimmer the head is part of the body, so those get the standard marks.
        if (ph.skel === 'floater' || ph.skel === 'aquatic') return false;
        const N = 7;
        for (let i = N - 1; i >= 0; i--) {
          const deg = 100 + (i * 100) / (N - 1), t = (deg * Math.PI) / 180;
          const [bx0, by0] = head(deg - 7, -0.8), [bx1, by1] = head(deg + 7, -0.8);
          const len = (i % 2 ? 4.2 : 6.6) * s + 0.6, out = 0.25;
          const tx = H.cx + (H.rx + len) * Math.cos(t + out * Math.sin(t)), ty = H.cy + (H.ry + len) * Math.sin(t + out * Math.sin(t));
          p.poly([[bx0, by0], [tx, ty], [bx1, by1]], i % 2 ? '#cdeeff' : '#eefaff');
          const mx = (bx0 + bx1) / 2, my = (by0 + by1) / 2;
          p.line(`M${f(mx + (tx - mx) * 0.15)} ${f(my + (ty - my) * 0.15)}L${f(mx + (tx - mx) * 0.7)} ${f(my + (ty - my) * 0.7)}`, '#ffffff', Math.max(0.5, 0.6 * s), 0.85);
        }
        return done();
      }
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
          // Plates near the edge are pulled in to the body's outline, so the plating wraps around the back
          // instead of sticking out past it.
          const pts = [0, 1, 2, 3, 4, 5].map(q => {
            const px = x + Math.cos((q * Math.PI) / 3 + Math.PI / 6) * k, py = y + Math.sin((q * Math.PI) / 3 + Math.PI / 6) * k;
            const u = (px - bx) / brx, w = (py - by) / bry, d = Math.hypot(u, w), lim = 0.93;
            return d > lim ? [bx + (u * lim / d) * brx, by + (w * lim / d) * bry] : [px, py];
          });
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
        // A wind-swept mane: long tufts blown back off the head. Wings sweep up across the same spot and would
        // leave just a white lump showing, so a winged creature gets the painted wind swirls instead.
        if (ph.wings !== 'none') return false;
        const sway = Math.sin(phase * TAU) * 1.5;
        [[-0.1, 15, e.light], [-0.45, 12, '#ffffff'], [0.25, 11, e.light]].forEach(([u, len, col], i) => {
          const [x, y] = top(u as number), L = (len as number) * s;
          p.taper(x, y + 1.5, x - L, y + 2 * s + sway * (1 + i * 0.3) - i * 1.5 * s, 4 * s + 0.5, 0.8, col as string, x - L * 0.45, y - 5 * s);
        });
        return done();
      }
      // A little cloud riding on the back. Wings or a back crest would cover most of it and leave a stray white
      // lump, so those creatures get the painted wind swirls instead.
      if (ph.wings !== 'none' || (ph.crest ?? 'none') !== 'none') return false;
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
      if (ph.skel === 'floater' || ph.skel === 'aquatic') return false;
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
      // Painted soft into the hide in a pale wind colour, rather than a white ribbon with a dark edge, which
      // read as a white sticker stuck on the creature.
      const swirl = (cx: number, cy: number, R: number) => {
        const pts: number[][] = [];
        for (let i = 0; i <= 26; i++) { const t = i / 26, r = R * (0.18 + 0.82 * t), q = Math.PI * 0.2 - t * TAU * 1.15; pts.push([cx + Math.cos(q) * r, cy + Math.sin(q) * r * 0.85]); }
        const [ex, ey] = pts[pts.length - 1];
        for (let i = 1; i <= 8; i++) { const t = i / 8, u = 1 - t; pts.push([u * u * ex + 2 * u * t * (ex - R * 0.9) + t * t * (ex - R * 1.9), u * u * ey + 2 * u * t * (ey + R * 0.25) + t * t * (ey - R * 0.05)]); }
        p.soft(pts, 1.9 * s + 0.5, mix(c.base, '#ffffff', 0.72), 0.85);
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
  // Ready: a boxer's crouch, upright with knees bent, feet wide and fists up. Proud: chest out, leaning back.
  // Relaxed: settled back on its heels, chin up a little, a hand on its hip with the elbow out behind.
  biped: [S0, { lean: 2, drop: 5, hdx: 1, hdy: 2, ft: 9 }, { lean: -9, drop: 0, hdx: -1, hdy: -3, ft: 2, sx: 2 }, { lean: -5, drop: 1, hdx: -1, hdy: 3, ft: -1, sx: -1 }],
  // Prowl: low, stalking, head at shoulder height. Proud: chest and neck up. Hunched: a play-bow, front down.
  quad: [S0, { lean: 3, drop: 8, hdx: 3, hdy: 11, ft: 4 }, { lean: -12, drop: 0, hdx: -2, hdy: -8, sx: 4 }, { lean: 16, drop: 1, hdx: 1, hdy: 2, px: -0.7, ft: 2 }],
  multi: [S0, { lean: 0, drop: 7, hdx: 0, hdy: 4, ft: 3, sx: -1 }, { lean: -13, drop: 0, hdx: 0, hdy: -4, sx: 4 }, { lean: 12, drop: 1, hdx: 0, hdy: 3, px: 1, sx: -2 }],
  // Serpents carry the stance in the neck: a low strike, reared up tall, or coiled down.
  serpent: [S0, { lean: 0, drop: 0, hdx: 9, hdy: 16 }, { lean: 0, drop: 0, hdx: -4, hdy: -9 }, { lean: 0, drop: 0, hdx: 3, hdy: 22 }],
  aquatic: [S0, { lean: 14, drop: 4, hdx: 0, hdy: 0 }, { lean: -16, drop: -1, hdx: 0, hdy: 0 }, { lean: 8, drop: 7, hdx: 0, hdy: 2 }],
  floater: [S0, { lean: 16, drop: 2, hdx: 0, hdy: 0 }, { lean: -13, drop: -1, hdx: 0, hdy: 0, sx: 2 }, { lean: 22, drop: 6, hdx: 0, hdy: 3 }],
};

/**
 * Knocked out: lying down. The body sinks to the ground with the legs folding under it and the head resting low,
 * instead of standing stiffly with its eyes crossed.
 */
const KO_POSE: Record<Skeleton, StancePose> = {
  biped: { lean: 6, drop: 9, hdx: 2, hdy: 6, ft: 7, sx: 3 },
  quad: { lean: 3, drop: 11, hdx: 3, hdy: 13, ft: 9, sx: 2 },
  multi: { lean: 0, drop: 10, hdx: 0, hdy: 7, ft: 7, sx: 2 },
  serpent: { lean: 0, drop: 0, hdx: 16, hdy: 33 },
  aquatic: { lean: 10, drop: 12, hdx: 0, hdy: 3, sx: 3 },
  floater: { lean: 18, drop: 13, hdx: 0, hdy: 4, sx: 4 },
};

/** Draw a creature. Returns shapes back-to-front. */
export function drawCreature(ph: Pheno, o: DrawOpts): Shape[] {
  return buildCreature(ph, o).shapes();
}

/** A creature split for the live rig: the body, plus a tail and wings that the app swings about their joints. */
export interface Rig {
  main: Shape[]; tail: Shape[]; wingFar: Shape[]; wingNear: Shape[];
  /** The shadow, ground glow and rising motes: drawn under everything, and left on the ground when the body leaps. */
  ground: Shape[];
  pivots: Partial<Record<Part, [number, number]>>;
}
export function drawCreatureRig(ph: Pheno, o: DrawOpts): Rig {
  const p = buildCreature(ph, { ...o, rig: true });
  return { main: p.shapes('main'), tail: p.shapes('tail'), wingFar: p.shapes('wingFar'), wingNear: p.shapes('wingNear'), ground: p.shapes('ground'), pivots: p.pivots };
}

/**
 * The box (in drawing units, 0..100) that a creature's body fills, legs and head included but not the tail or
 * wings: what a shield bubble or a block of ice should fit around. Path extents count their control points,
 * so it errs a touch large.
 */
export function bodyBounds(ph: Pheno, stage: number): { x0: number; y0: number; x1: number; y1: number } {
  const sh = drawCreatureRig(ph, { stage, phase: 0, shadow: false }).main;
  let x0 = 100, y0 = 100, x1 = 0, y1 = 0;
  const add = (x: number, y: number, rx = 0, ry = rx) => { x0 = Math.min(x0, x - rx); x1 = Math.max(x1, x + rx); y0 = Math.min(y0, y - ry); y1 = Math.max(y1, y + ry); };
  for (const s of sh) {
    if (s.op != null && s.op < 0.5) continue; // glows and soft shading
    if (s.t === 'circle') add(s.cx, s.cy, s.r);
    else if (s.t === 'ellipse') add(s.cx, s.cy, Math.max(s.rx, s.ry) * (s.rot ? 1 : 0) + (s.rot ? 0 : s.rx), s.rot ? Math.max(s.rx, s.ry) : s.ry);
    else {
      const tok = s.d.match(TOKEN) ?? [];
      let i = 0, cmd = '', cx = 0, cy = 0;
      const n = () => parseFloat(tok[i++]);
      while (i < tok.length) {
        if (/[A-Za-z]/.test(tok[i])) cmd = tok[i++];
        const lo = cmd.toLowerCase(), rel = cmd !== cmd.toUpperCase();
        if (lo === 'z') continue;
        const pairs = lo === 'q' ? 2 : lo === 'c' ? 3 : lo === 'a' ? 0 : 1;
        if (lo === 'a') { n(); n(); n(); n(); n(); const x = n(), y = n(); cx = rel ? cx + x : x; cy = rel ? cy + y : y; add(cx, cy); continue; }
        let lx = cx, ly = cy;
        for (let k = 0; k < pairs; k++) { const x = n(), y = n(); lx = rel ? cx + x : x; ly = rel ? cy + y : y; add(lx, ly); }
        cx = lx; cy = ly;
        if (lo === 'm') cmd = rel ? 'l' : 'L';
      }
    }
  }
  return { x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(100, x1), y1: Math.min(100, y1) };
}

/** How a pose tips the whole body: a quadruped rears up to cast, a swimmer noses down to strike. */
function poseTilt(skel: Skeleton, reach: number, raise: number, guard: number): [number, number] {
  switch (skel) {
    case 'biped': return [3 * reach - 3 * raise - 4 * guard, 1.5 * guard];
    case 'quad': return [3 * reach - 11 * raise + 3 * guard, 2 * guard];
    case 'multi': return [2 * reach - 9 * raise, 1.5 * guard];
    case 'aquatic': return [6 * reach - 9 * raise, 0];
    case 'floater': return [8 * reach - 7 * raise - 4 * guard, 0];
    default: return [0, 0];
  }
}

function buildCreature(ph: Pheno, o: DrawOpts): Pen {
  const pal = paletteFor(ph);
  const p = new Pen(pal);
  p.rig = !!o.rig;
  p.look = o.look ?? 0;
  const st = STAGE[Math.max(0, Math.min(4, o.stage))];
  const phase = o.phase ?? 0;
  const sw = o.walking ? Math.sin(phase * TAU) : 0;
  // While walking, each foot lifts as it swings forward, and the body rises as the feet pass under it.
  const cw = o.walking ? Math.cos(phase * TAU) : 0;
  const b = st.body, hs = st.head, ls = st.limb, k = st.feat;
  const liftA = Math.max(0, cw) * 4.5 * ls, liftB = Math.max(0, -cw) * 4.5 * ls;
  const bob = o.walking ? -1.8 * (1 - Math.abs(sw)) : 0;
  // On the live rig the app does the breathing, smoothly; drawn frames stay still.
  const breathe = o.rig ? 0 : Math.sin(phase * TAU) * 0.6;
  const far = shade(pal.base, -0.1);
  const flap = Math.sin(phase * TAU * (o.walking ? 2 : 1));
  const pw = poseWeights(o.pose);
  const reach = o.ko ? 0 : o.reach ?? pw.reach, raise = o.ko ? 0 : o.raise ?? pw.raise, guard = o.ko ? 0 : o.guard ?? pw.guard;
  // A fainted creature slumps upright-ish; otherwise it holds its stance.
  const sp = o.ko ? KO_POSE[ph.skel] : STANCES[ph.skel][ph.stance ?? 0] ?? S0;
  const [tiltL, tiltD] = poseTilt(ph.skel, reach, raise, guard);
  // Proportions: gw thickens the body and limbs (-1 slender .. 1 bulky); ht lifts a legged body higher on longer
  // legs, or makes a legless one taller (-1 squat .. 1 lanky).
  const gw = ph.girth ?? 0, ht = ph.height ?? 0;
  const legged = ph.skel === 'biped' || ph.skel === 'quad' || ph.skel === 'multi';
  // (Lying knocked out, every creature rests on the ground whatever its leg length.)
  const rise = legged && !o.ko ? ht * (ph.skel === 'biped' ? 6 : 8) : 0;
  const lw = 1 + 0.28 * gw;
  /** Size of coat details: fur scallops, scales, lumps. */
  const cz = 0.95 * b;
  /** A leg from a hip on the leaned body down to the ground, bending at the knee when the body sinks or the foot lifts. */
  // Two-tone on the limbs: a pointed coat darkens them; socks turn the lower legs, feet and hands pale.
  const limbFar = pal.limb === pal.base ? far : shade(pal.limb, -0.1);
  const limbOf = (col: string) => (col === pal.base ? pal.limb : col === far ? limbFar : col);
  const socks = ph.twotone === 'socks', sockOf = (col: string) => (col === far || col === limbFar ? shade(pal.sock, -0.08) : pal.sock);
  const leg = (hx0: number, hy0: number, fx: number, fy: number, w0: number, w1: number, col0: string, kx?: number, ky?: number, knee = 1, lift = 0) => {
    const [x1, y1] = p.at(hx0, hy0), col = limbOf(col0);
    p.free(() => {
      // Height changes the leg length, not the knee: a short-legged creature stands on short straight legs.
      const bend = (Math.max(0, sp.drop + Math.max(0, y1 - hy0 - sp.drop + rise) * 0.6) * 0.9 + lift * 0.9) * knee;
      const mx = kx ?? (x1 + fx) / 2, my = ky ?? (y1 + fy) / 2;
      const cx = mx + bend, cy = my - lift * 0.5 + (ky == null ? 0 : (y1 - hy0) * 0.5), ex = fx, ey = fy - lift;
      p.taper(x1, y1, ex, ey, w0 * lw, w1 * lw, col, cx, cy);
      if (socks) {
        // The lower part of the leg again, pale: the same curve from t0 down, so the outline doesn't change.
        const t0 = 0.58, u = 1 - t0;
        const sx = u * u * x1 + 2 * u * t0 * cx + t0 * t0 * ex, sy = u * u * y1 + 2 * u * t0 * cy + t0 * t0 * ey;
        p.taper(sx, sy, ex, ey, (w0 + (w1 - w0) * t0) * lw, w1 * lw, sockOf(col), cx + (ex - cx) * t0, cy + (ey - cy) * t0);
      }
    });
  };
  const freePaw = (x: number, y: number, w: number, col: string, lift = 0) => p.free(() => paw(x, y - lift, w * (1 + 0.1 * gw), socks ? sockOf(limbOf(col)) : limbOf(col), lift));
  const ft = sp.ft ?? 0;
  const lean = (cx: number, cy: number) => {
    const L = sp.lean + tiltL, D = sp.drop + tiltD + bob - rise;
    p.tf = L || D || sp.sx ? mkTf(cx, cy, L, sp.sx ?? 0, D) : null;
  };
  /**
   * An arm from the shoulder (sx, sy) to the wrist (ex, ey), bending toward (cx, cy): a full upper arm tapering to
   * the wrist, then a rounded hand turned along the forearm with two finger creases. With `seamless`, the top of
   * the arm has no outline: the outlined part starts a little way down, and a plain shoulder piece over it joins
   * the torso, so the arm grows out of the body instead of being outlined against it at the shoulder.
   */
  const arm = (sx: number, sy: number, ex: number, ey: number, cx: number, cy: number, w0: number, w1: number, col0: string, seamless: boolean) => {
    const col = limbOf(col0);
    if (!seamless) p.taper(sx, sy, ex, ey, w0 * lw, w1 * lw, col, cx, cy);
    else {
      // Split the arm's curve at t0 (outlined below) and t1 (the plain shoulder piece reaches down to here).
      const B = (t: number) => [(1 - t) * (1 - t) * sx + 2 * (1 - t) * t * cx + t * t * ex, (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * cy + t * t * ey];
      const W = (t: number) => (w0 + (w1 - w0) * t) * lw;
      const t0 = 0.24, t1 = 0.42, [ax, ay] = B(t0), [bx2, by2] = B(t1);
      p.taper(ax, ay, ex, ey, W(t0), w1 * lw, col, cx + (ex - cx) * t0, cy + (ey - cy) * t0);
      p.taper(sx, sy, bx2, by2, w0 * lw, W(t1), col, sx + (cx - sx) * t1, sy + (cy - sy) * t1, false);
    }
    const dx = ex - cx, dy = ey - cy, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    const hr = w1 * lw * 0.72, hx = ex + ux * hr * 0.5, hy = ey + uy * hr * 0.5;
    p.ell(hx, hy, hr * 1.1, hr * 0.88, socks ? sockOf(col) : col, { rot: (Math.atan2(uy, ux) * 180) / Math.PI });
    const crease = (o: number) => {
      const bx = hx + ux * hr * 0.35 + nx * hr * o, by2 = hy + uy * hr * 0.35 + ny * hr * o;
      return `M${f(bx)} ${f(by2)}L${f(bx + ux * hr * 0.55)} ${f(by2 + uy * hr * 0.55)}`;
    };
    p.line(crease(0.3) + crease(-0.3), pal.out, Math.max(0.5, hr * 0.14), 0.6);
    if (ph.feet === 'claws' || ph.feet === 'talons') {
      // Clawed creatures have claws on their hands too.
      const ink = ph.feet === 'talons' ? '#2b2330' : '#f4ecd8';
      for (const o of [-0.45, 0, 0.45]) {
        const bx = hx + ux * hr * 0.9 + nx * hr * o, by2 = hy + uy * hr * 0.9 + ny * hr * o;
        p.path(`M${f(bx - nx * hr * 0.16)} ${f(by2 - ny * hr * 0.16)}L${f(bx + ux * hr * 0.5)} ${f(by2 + uy * hr * 0.5)}L${f(bx + nx * hr * 0.16)} ${f(by2 + ny * hr * 0.16)}Z`, ink, { line: false });
      }
    }
  };
  /** An arm, blended from its resting place toward a strike, a raised cast, or a guard. Each target: [x, y, bendx, bendy]. */
  const blendArm = (rest: number[], strike: number[], up: number[], block: number[]) =>
    rest.map((v, i) => v + (strike[i] - v) * reach + (up[i] - v) * raise + (block[i] - v) * guard);
  let a: Anchors;
  /**
   * A foot, pointing forward, from the feet gene: a paw with two toe lines, a paw with claws, a hoof, a bird's
   * talons, or a webbed foot. The toes tip up as the foot lifts.
   */
  const paw = (x: number, y: number, w: number, col: string, lift = 0) => {
    const ang = (-lift * 4 * Math.PI) / 180, ca = Math.cos(ang), sa = Math.sin(ang);
    /** A point on the foot, relative to its centre in foot widths, turned with the lift. */
    const P = (u: number, v: number): [number, number] => [x + (u * ca - v * sa) * w, y + (u * sa + v * ca) * w];
    const M = (pts: [number, number][]) => 'M' + pts.map(q => f(q[0]) + ' ' + f(q[1])).join('L') + 'Z';
    const Q = (u: number, v: number) => P(u, v).map(f).join(' ');
    switch (ph.feet) {
      case 'hooves': {
        // A hoof: a dark, slanted horn block under a band of hide, with a shine on its face.
        const horn = shade(mix(pal.dark, '#3b2f2b', 0.55), col === far ? -0.06 : 0);
        p.path(M([P(-0.5, -0.42), P(0.5, -0.46), P(0.9, 0.46), P(-0.56, 0.46)]), horn);
        p.path(`M${Q(-0.51, -0.52)}L${Q(0.51, -0.56)}L${Q(0.56, -0.3)}Q${Q(0.05, -0.2)} ${Q(-0.52, -0.26)}Z`, col, { line: false });
        p.line(`M${Q(0.5, -0.08)}L${Q(0.7, 0.34)}`, '#ffffff', Math.max(0.5, w * 0.1), 0.3);
        p.line(`M${Q(0.28, -0.08)}L${Q(0.36, 0.44)}`, pal.out, Math.max(0.5, w * 0.08), 0.6);
        return;
      }
      case 'talons': {
        // A bird's foot: three toes forward and one back, each ending in a dark hooked claw.
        const claw = '#2b2330';
        const toes: [number, number][] = [[1.18, 0.36], [0.8, 0.42], [-0.62, 0.4]];
        for (const [u, v] of toes) {
          const [x0, y0] = P(0, 0), [x1, y1] = P(u, v);
          p.taper(x0, y0, x1, y1, w * 0.48, w * 0.28, col);
        }
        p.ell(...P(0, 0.02), w * 0.44, w * 0.38, col);
        for (const [u, v] of toes) {
          const d = u > 0 ? 1 : -1;
          p.path(`M${Q(u - 0.02 * d, v - 0.16)}Q${Q(u + 0.36 * d, v - 0.14)} ${Q(u + 0.4 * d, v + 0.14)}Q${Q(u + 0.16 * d, v + 0.04)} ${Q(u, v + 0.12)}Z`, claw, { line: false });
        }
        return;
      }
      case 'webbed': {
        // A wide flipper of a foot: three long toes with webbing scooped between them.
        const web = mix(col, pal.light, 0.25);
        p.path(`M${Q(-0.45, -0.2)}L${Q(0.25, -0.34)}L${Q(1.28, -0.02)}Q${Q(0.86, 0.12)} ${Q(1.38, 0.26)}Q${Q(0.88, 0.36)} ${Q(1.2, 0.5)}L${Q(-0.5, 0.48)}Z`, web);
        p.path(`M${Q(-0.45, -0.2)}L${Q(0.25, -0.34)}Q${Q(0.4, 0.05)} ${Q(-0.1, 0.12)}Q${Q(-0.5, 0.15)} ${Q(-0.45, -0.2)}Z`, col, { line: false });
        p.line(`M${Q(0.1, -0.05)}L${Q(1.2, 0.04)}M${Q(0.1, 0.1)}L${Q(1.28, 0.28)}M${Q(0.05, 0.25)}L${Q(1.1, 0.46)}`, pal.out, Math.max(0.5, w * 0.08), 0.45);
        return;
      }
      default:
        p.ell(x + w * 0.22, y, w * 0.82, w * 0.46, col, lift ? { rot: -lift * 4 } : undefined);
        if (ph.feet === 'claws') {
          // Three pale claws poking out of the front of the paw.
          for (const v of [-0.22, 0.02, 0.24]) p.path(M([P(0.92, v - 0.1), P(1.28, v + 0.1), P(0.9, v + 0.1)]), '#f4ecd8');
        }
        p.line(`M${f(x + w * 0.5)} ${f(y - w * 0.08)}l0 ${f(w * 0.36)}M${f(x + w * 0.8)} ${f(y - w * 0.02)}l0 ${f(w * 0.3)}`, pal.out, 0.7);
    }
  };

  p.g = 'aura';
  // The shadow and ground glow belong to the ground, so the app keeps them down there when the creature leaps.
  p.part = 'ground';
  if (o.stage >= 3) {
    // Ancient and legendary creatures glow from the ground up, in their element's colour.
    const e = ELEMENTS[ph.el1];
    p.ell(50, 91, 34 * b, 6, e.base, { line: false, op: o.stage === 4 ? 0.45 : 0.32 });
    p.ell(50, 91, 22 * b, 3.6, e.light, { line: false, op: 0.4 });
  }
  if (o.shadow !== false) p.ell(50, 92, 24 * b, 4, '#000000', { line: false, op: 0.18 });
  p.part = 'main';

  switch (ph.skel) {
    case 'biped': {
      const by = 64 - 3 * (b - 0.8), brx = 14.5 * b * (1 + 0.24 * gw - 0.04 * ht), bry = 18 * b * (1 + 0.12 * ht + 0.04 * gw);
      const hr = 12.5 * hs;
      const hip = by + bry * 0.5;
      lean(48, hip);
      a = { back: ellFrame(48, by, brx, bry, -Math.PI / 2 - 0.9), hx: 53 + sp.hdx, hy: by - bry - hr * 0.5 + breathe * 0.4 + sp.hdy, hr, bx: 48, by, brx, bry, tx: 48 - brx * 0.8, ty: by + bry * 0.55, tdir: 0.35, wx: 44, wy: by - bry * 0.45, backx: 40, backy: by - bry * 0.72 };
      drawWing(p, a, ph, k, flap, true);
      drawCrest(p, ph, ellSpine(48, by, brx, bry, Math.PI - 0.1, 1.5 * Math.PI - 0.3, 5), k * b);
      p.g = 'back';
      leg(52, hip, 54 - sw * 6 + ft, 87.6, 8.5 * ls, 5.4 * ls, far, undefined, undefined, 1, liftB);
      freePaw(54 - sw * 6 + ft, 89.2, 5.6 * ls, far, liftB);
      // The far arm: up in a guard for a ready stance, otherwise hanging and swinging against the legs.
      {
        const restX = 63 + sw * 4, rest = ph.stance === 1 && !o.ko ? [66, by - bry * 0.55, 64, by - bry * 0.05]
          : ph.stance === 3 && !o.ko ? [60, by + bry * 0.22, 63, by - bry * 0.05]
          : [restX, by + 3, (55 + restX) / 2 + 1, (by - bry * 0.35 + by + 3) / 2];
        const [ex, ey, cx, cy] = blendArm(rest, [65, by - bry * 0.2, 62, by + bry * 0.12], [58, by - bry * 1.0, 61, by - bry * 0.45], [65, by - bry * 0.5, 63, by]);
        arm(55, by - bry * 0.35, ex, ey, cx, cy, 5.8 * ls, 3.9 * ls, far, false);
      }
      p.g = 'body';
      drawTail(p, a, ph, k, breathe);
      leg(45, hip, 44 + sw * 6 - ft, 87.6, 10 * ls, 6 * ls, pal.base, undefined, undefined, 1, liftA);
      freePaw(44 + sw * 6 - ft, 89.2, 6.2 * ls, pal.base, liftA);
      // A pear-shaped torso: the belly is wider than the chest.
      const torso: Body = { hull: [[48, by, brx, bry], [48, by + bry * 0.28, brx * 1.07, bry * 0.72], ...(ph.stance === 2 && !o.ko ? [[48 + brx * 0.35, by - bry * 0.22, brx * 0.78, bry * 0.62]] : [])] };
      coatRim(p, ph, torso, cz);
      p.ell(48, by, brx, bry, pal.base);
      p.ell(48, by + bry * 0.28, brx * 1.07, bry * 0.72, pal.base);
      // A proud stance puffs the chest out.
      if (ph.stance === 2 && !o.ko) p.ell(48 + brx * 0.35, by - bry * 0.22, brx * 0.78, bry * 0.62, pal.base);
      twoTone(p, ph, torso, [48 - brx * 0.12, by], [-0.9, -0.44], cz);
      drawPattern(p, a, ph, st.cue);
      coatSkin(p, ph, torso, cz);
      shadeForm(p, 48, by, brx, bry);
      p.g = 'front';
      // The near arm rests by stance (ready: fist up; proud: down the side; hunched: hanging forward), swings
      // against the legs when walking, and blends toward a strike, a raised cast or a guard.
      {
        const restX = 58 - sw * 4;
        const rest = o.ko ? [restX, by + 5, (50 + restX) / 2, (by - bry * 0.3 + by + 5) / 2]
          : ph.stance === 1 ? [62, by - bry * 0.4, 60, by + bry * 0.12]
          : ph.stance === 2 ? [46 - sw * 3, by + bry * 0.38, 51, by + bry * 0.05]
          : ph.stance === 3 ? [45, by + bry * 0.3, 38, by - bry * 0.02]
          : [restX, by + 5, (50 + restX) / 2 + 1, (by - bry * 0.3 + by + 5) / 2];
        const [ex, ey, cx, cy] = blendArm(rest, [66, by - bry * 0.45, 60, by - bry * 0.05], [60, by - bry * 1.05, 59, by - bry * 0.4], [61, by - bry * 0.42, 59, by + bry * 0.1]);
        arm(50, by - bry * 0.3, ex, ey, cx, cy, 6.6 * ls, 4.3 * ls, pal.base, true);
      }
      p.g = 'body';
      break;
    }
    case 'quad': {
      const by = 63, brx = 23 * b * (1 + 0.06 * gw + 0.08 * ht), bry = 13.5 * b * (1 + 0.25 * gw - 0.05 * ht);
      const hr = 12 * hs;
      const hx = 48 + brx * 0.82 + sp.hdx, hy = by - bry * 0.75 - hr * 0.4 + breathe * 0.4 + sp.hdy;
      lean(46 + brx * (sp.px ?? 0), by);
      a = { flatBack: true, back: ellFrame(46, by, brx, bry, -Math.PI / 2 - 0.3), hx, hy, hr, bx: 46, by, brx, bry, tx: 46 - brx * 0.92, ty: by - bry * 0.2, tdir: 0.5, wx: 44, wy: by - bry * 0.7, backx: 40, backy: by - bry * 0.95 };
      drawWing(p, a, ph, k, flap, true);
      drawCrest(p, ph, ellSpine(46, by, brx, bry, Math.PI + 0.55, 1.5 * Math.PI + 0.65, 6), k * b);
      const hip = by + bry * 0.3;
      const fx = 46 + brx * 0.55, rx = 46 - brx * 0.6;
      p.g = 'back';
      leg(fx + 4, hip, fx + 4 - sw * 6 + ft, 87.8, 7.5 * ls, 5 * ls, far, undefined, undefined, -0.7, liftB);
      freePaw(fx + 4 - sw * 6 + ft, 89.3, 5.2 * ls, far, liftB);
      leg(rx + 5, hip, rx + 5 + sw * 6 - ft, 87.8, 8.5 * ls, 5 * ls, far, rx + 5 - 3 * ls + sw * 3, 80, -1, liftA);
      freePaw(rx + 5 + sw * 6 - ft, 89.3, 5.2 * ls, far, liftA);
      p.g = 'body';
      drawTail(p, a, ph, k, breathe);
      // A front paw swipes forward on an attack.
      // A front paw swipes forward on an attack, and lifts off the ground when rearing up.
      const pawX = fx - 2 + sw * 6 + reach * 12 + raise * 4 + ft, pawY = 87.8 - reach * 9 - raise * 6;
      leg(fx - 2, hip, pawX, pawY, 8.5 * ls, 5.6 * ls, pal.base, undefined, undefined, -0.7, liftA);
      freePaw(pawX, pawY + 1.5, 5.8 * ls, pal.base, liftA);
      // The hind leg is thick at the haunch and bends back at the hock.
      leg(rx - 1, hip - 1, rx - 1 - sw * 6 - ft, 87.8, 11.5 * ls, 5.6 * ls, pal.base, rx - 1 - 4 * ls - sw * 3, 80, -1, liftB);
      freePaw(rx - 1 - sw * 6 - ft, 89.3, 5.8 * ls, pal.base, liftB);
      const trunk: Body = { hull: [[46, by, brx, bry], [46 + brx * 0.52, by + bry * 0.08, brx * 0.52, bry * 1.0], [46 - brx * 0.58, by - bry * 0.04, brx * 0.46, bry * 0.98]] };
      coatRim(p, ph, trunk, cz);
      p.taper(46 + brx * 0.6, by - bry * 0.3, hx - hr * 0.3, hy + hr * 0.5, 13 * b, 9 * b, pal.base);
      p.ell(46, by, brx, bry, pal.base);
      // A deeper chest and a rounded rump break up the plain oval.
      p.ell(46 + brx * 0.52, by + bry * 0.08, brx * 0.52, bry * 1.0, pal.base);
      p.ell(46 - brx * 0.58, by - bry * 0.04, brx * 0.46, bry * 0.98, pal.base);
      twoTone(p, ph, trunk, [46, by - bry * 0.12], [0, -1], cz);
      drawPattern(p, a, ph, st.cue);
      coatSkin(p, ph, trunk, cz);
      shadeForm(p, 46, by, brx, bry);
      break;
    }
    case 'multi': {
      const by = 66, hr = 10.5 * hs;
      const abx = 34, arx = 17 * b * (1 + 0.1 * ht), ary = 12 * b * (1 + 0.25 * gw);
      const thx = 34 + arx + 9 * b, thr = 11.5 * b * (1 + 0.12 * gw);
      const hx = thx + thr + hr * 0.45 + sp.hdx, hy = by - 6 + breathe * 0.3 + sp.hdy;
      lean(thx + thr * (sp.px ?? 0), by);
      a = { flatBack: true, back: ellFrame(abx, by - 2, arx, ary, -Math.PI / 2 - 0.2), hx, hy, hr, bx: abx, by: by - 2, brx: arx, bry: ary, tx: abx - arx * 0.9, ty: by - 4, tdir: 0.7, wx: thx - 2, wy: by - thr * 0.8, backx: abx, backy: by - 2 - ary * 0.95 };
      drawWing(p, a, ph, k, flap, true);
      drawCrest(p, ph, ellSpine(abx, by - 2, arx, ary, Math.PI + 0.55, 1.5 * Math.PI + 0.75, 5), k * b * 0.9);
      p.g = 'back';
      for (let i = 0; i < 3; i++) {
        const lx = thx - 9 + i * 5.5, s2 = (i % 2 === 0 ? sw : -sw) * 4;
        leg(lx + 2, by + 2, lx + (i - 1) * (10 + ft) + 3 - s2, 90, 3.6 * ls, 1.8 * ls, far, lx + (i - 1) * 8 + 3, by - 4, 0, i % 2 === 0 ? liftB * 0.7 : liftA * 0.7);
      }
      p.g = 'body';
      drawTail(p, a, ph, k, breathe);
      const abdo: Body = { hull: [[abx, by - 2, arx, ary]] }, thor: Body = { hull: [[thx, by - 1, thr, thr * 0.9]] };
      coatRim(p, ph, abdo, cz * 0.9);
      p.ell(abx, by - 2, arx, ary, pal.base);
      twoTone(p, ph, abdo, [abx, by - 2 - ary * 0.1], [0, -1], cz * 0.9);
      drawPattern(p, a, ph, st.cue);
      coatSkin(p, ph, abdo, cz * 0.9);
      shadeForm(p, abx, by - 2, arx, ary);
      coatRim(p, ph, thor, cz * 0.8);
      p.ell(thx, by - 1, thr, thr * 0.9, shade(pal.base, -0.04));
      if (ph.twotone === 'dorsal') twoTone(p, ph, thor, [thx, by - 2 - ary * 0.1], [0, -1], cz * 0.8);
      coatSkin(p, ph, thor, cz * 0.8);
      shadeForm(p, thx, by - 1, thr, thr * 0.9);
      for (let i = 0; i < 3; i++) {
        // The legs hang from the thorax, the front pair angling forward under the head, with their hips back
        // where they show (further forward, the head hid the top of the front leg and it seemed to grow from it).
        const lx = thx - 10.5 + i * 5.5, s2 = (i % 2 === 0 ? -sw : sw) * 4;
        leg(lx, by + 3, lx + (i - 1) * (11.5 + ft) - s2, 90, 4.2 * ls, 2 * ls, pal.dark, lx + (i - 1) * 9, by - 6, 0, i % 2 === 0 ? liftA * 0.7 : liftB * 0.7);
      }
      break;
    }
    case 'serpent': {
      const hr = 11.5 * hs, w = 12.5 * b * (1 + 0.28 * gw);
      const wv = o.walking ? Math.sin(phase * TAU) * 3 : breathe;
      const hx = 68 + sp.hdx + reach * (sp.hdx > 5 ? 1 : 4) - raise * 2, hy = 40 - 7 * ht + breathe * 0.5 + sp.hdy - raise * 5 + reach * 2;
      p.tf = null;
      a = { back: [24.5, 79.25 + wv * 0.125 - w * 0.3, 0], hx, hy, hr, bx: 55, by: 76, brx: w * 0.75, bry: w * 0.8, tx: 15, ty: 85 - wv, tdir: 0.5, wx: 57, wy: 60, backx: 56, backy: 62 };
      drawWing(p, a, ph, k, flap, true);
      p.g = 'body';
      drawTailShape(p, a, ph, k * 0.8, 0);
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
      {
        // The crest runs along the top of the coils and up the neck, on the side away from the belly.
        const spn: Spine = [];
        for (let i = 0; i < pts.length; i++) {
          const g = i / (pts.length - 1);
          if (g < 0.32 || g > 0.9 || i % 2) continue;
          const a0 = pts[Math.max(0, i - 1)], a1 = pts[Math.min(pts.length - 1, i + 1)];
          const dx = a1[0] - a0[0], dy = a1[1] - a0[1], L = Math.hypot(dx, dy) || 1, nx = dy / L, ny = -dx / L;
          spn.push({ x: pts[i][0] + nx * ws[i] / 2, y: pts[i][1] + ny * ws[i] / 2, nx, ny });
        }
        drawCrest(p, ph, spn, k * b * 0.85);
        p.g = 'body';
      }
      const coil: Body = { rib: { pts, ws } };
      coatRim(p, ph, coil, cz * 0.85);
      p.ribbon(pts, ws, pal.base);
      twoTone(p, ph, coil, [0, 0], [0, -1], cz * 0.85);
      if (ph.pattern === 'belly') {
        // The pale belly follows the underside of the ribbon (its left edge as drawn, which is the underside of
        // the coil and the front of the throat), running right out to the outline so it reads as part of the
        // body rather than a stripe painted on it. It tapers away toward the tail.
        const n = pts.length, outer: number[][] = [], inner: number[][] = [];
        for (let i = 0; i < n; i++) {
          const g = i / (n - 1);
          if (g < 0.1) continue;
          const a0 = pts[Math.max(0, i - 1)], a1 = pts[Math.min(n - 1, i + 1)];
          const dx = a1[0] - a0[0], dy = a1[1] - a0[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
          const h = ws[i] / 2, fade = Math.min(1, (g - 0.1) / 0.22);
          const o = h * 0.98, inn = h * (0.98 - 0.62 * fade);
          outer.push([pts[i][0] + nx * o, pts[i][1] + ny * o]);
          inner.unshift([pts[i][0] + nx * inn, pts[i][1] + ny * inn]);
        }
        p.path('M' + [...outer, ...inner].map(([x, y]) => f(x) + ' ' + f(y)).join('L') + 'Z', pal.light, { line: false });
      } else if (ph.pattern !== 'plain' && ph.pattern !== 'mask') {
        const col = ph.pattern === 'stars' ? pal.markGlow : ph.pattern === 'bands' ? pal.accentDark : pal.mark;
        for (const [x, y] of [[30, 81], [40, 86], [50, 87], [58, 76], [60, 62]]) {
          if (ph.pattern === 'stars') star(p, x, y, w * 0.25, col); else p.dot(x, y, w * (ph.pattern === 'spots' ? 0.2 : 0.26), col, 0.75);
        }
      }
      coatSkin(p, ph, coil, cz * 0.85);
      break;
    }
    case 'aquatic': {
      const by = 58 - 4 * ht + breathe, brx = 25 * b * (1 + 0.12 * ht), bry = 15 * b * (1 + 0.25 * gw);
      const hr = 12 * hs;
      lean(48, by);
      a = { flatBack: true, back: ellFrame(48, by, brx, bry, -Math.PI / 2 - 0.35), hx: 50 + brx * 0.5, hy: by - bry * 0.12, hr, bx: 48, by, brx, bry, tx: 48 - brx * 0.9, ty: by, tdir: 0.05, wx: 46, wy: by - bry * 0.75, backx: 44, backy: by - bry * 0.95 };
      drawWing(p, a, ph, k, flap, true);
      drawCrest(p, ph, ellSpine(48, by, brx, bry, Math.PI + 0.45, 1.5 * Math.PI + 0.45, 6), k * b);
      p.g = 'body';
      // Every swimmer has a fluke; the tail gene adds to it.
      const fl = sw * 4 + breathe * 2;
      p.part = 'tail';
      p.pivots.tail = p.at(a.tx + 3, by);
      p.path(`M${f(a.tx + 3)} ${f(by)}L${f(a.tx - 12 * b)} ${f(by - 11 * b + fl)}Q${f(a.tx - 7 * b)} ${f(by)} ${f(a.tx - 12 * b)} ${f(by + 11 * b + fl)}Z`, pal.accent);
      if (ph.el2 && (ph.tail === 'stub' || ph.tail === 'fan')) tailTip(p, a.tx - 9 * b, by - 9 * b + fl, ph.el2, 0.8 * k);
      if (ph.tail !== 'stub' && ph.tail !== 'fan') drawTailShape(p, { ...a, tx: a.tx + 2, ty: by + bry * 0.5 }, ph, k * 0.75, breathe);
      p.part = 'main';
      const fish: Body = { hull: [[48, by, brx, bry]] };
      coatRim(p, ph, fish, cz);
      p.ell(48, by, brx, bry, pal.base);
      twoTone(p, ph, fish, [48, by - bry * 0.08], [0, -1], cz);
      drawPattern(p, a, ph, st.cue);
      coatSkin(p, ph, fish, cz);
      shadeForm(p, 48, by, brx, bry);
      p.g = 'front';
      p.ell(48 + brx * 0.05, by + bry * 0.55, 8 * ls, 4 * ls, shade(ph.twotone === 'socks' ? pal.sock : pal.limb, -0.08), { rot: 28 + sw * 14 - raise * 20 + reach * 10 });
      p.g = 'body';
      break;
    }
    default: {
      // floater: rx is its width, ry its height, from the proportion genes.
      const r = 17 * b, rx = r * (1 + 0.2 * gw - 0.04 * ht), ry = r * (1 + 0.16 * ht);
      const cy = 52 - (ry - r) * 0.9 + breathe * 1.4;
      const hr = 13 * hs;
      lean(50, cy + ry);
      a = { back: ellFrame(50, cy, rx, ry * 1.1, -Math.PI / 2 - 0.75), hx: 52, hy: cy - ry * 0.35, hr, bx: 50, by: cy + ry * 0.45, brx: rx * 0.8, bry: ry * 0.75, tx: 44, ty: cy + ry * 1.25, tdir: -0.9, wx: 43, wy: cy - ry * 0.1, backx: 40, backy: cy - ry * 0.55 };
      drawWing(p, a, ph, k, flap, true);
      drawCrest(p, ph, ellSpine(50, cy, rx, ry, Math.PI + 0.1, 1.5 * Math.PI - 0.25, 5), k * b * 0.85);
      const wv = o.rig && !o.walking ? 0 : Math.sin(phase * TAU) * 1.6;
      p.g = 'back';
      p.ell(50 - rx * 0.75, cy + ry * 0.6 - wv, 3.4 * ls * lw, 3 * ls * lw, socks ? sockOf(far) : limbFar);
      p.g = 'body';
      const dome: Body = { hull: [[50, cy + ry * 0.05, rx * 0.99, ry * 1.04]] };
      coatRim(p, ph, dome, cz * 0.9, [Math.PI * 0.95, Math.PI * 2.05]);
      p.path(`M${f(50 - rx)} ${f(cy)}Q${f(50 - rx)} ${f(cy - ry * 1.1)} 50 ${f(cy - ry * 1.1)}Q${f(50 + rx)} ${f(cy - ry * 1.1)} ${f(50 + rx)} ${f(cy)}Q${f(50 + rx)} ${f(cy + ry * 1.1)} ${f(50 + rx * 0.55)} ${f(cy + ry * 1.45 + wv)}Q${f(50 + rx * 0.35)} ${f(cy + ry * 1.05)} ${f(50 + rx * 0.1)} ${f(cy + ry * 1.6 - wv)}Q${f(50 - rx * 0.15)} ${f(cy + ry * 1.1)} ${f(50 - rx * 0.45)} ${f(cy + ry * 1.7 + wv)}Q${f(50 - rx * 0.95)} ${f(cy + ry * 1.1)} ${f(50 - rx)} ${f(cy)}Z`, pal.base);
      twoTone(p, ph, dome, [50, cy - ry * 0.05], [-0.45, -0.9], cz * 0.9);
      drawPattern(p, a, ph, st.cue);
      coatSkin(p, ph, dome, cz * 0.9);
      shadeForm(p, 50, cy + ry * 0.1, rx * 0.86, ry * 0.8);
      if (ph.tail !== 'stub') drawTail(p, { ...a, tx: 50 - rx * 0.5, ty: cy + ry * 1.2, tdir: -0.6 }, ph, k * 0.7, wv);
      // The near nub of an arm: forward to strike, up to cast.
      p.ell(50 + rx * 0.95 + reach * 4, cy + ry * 0.45 + wv - raise * ry * 0.7 - reach * 2, 3.6 * ls * lw, 3.2 * ls * lw, socks ? pal.sock : pal.limb);
    }
  }
  // A roar throws the head back; a guard tucks it in.
  if (o.pose === 'roar') a = { ...a, hx: a.hx - 1, hy: a.hy - 2.5 };
  else if (guard > 0.5) a = { ...a, hx: a.hx - 1, hy: a.hy + 1.5 };

  drawWing(p, a, ph, k, flap, false);
  p.g = 'body';
  drawHead(p, a, ph, k, o.ko, o.pose);
  p.g = 'body';
  drawCues(p, a, ph.el1, st.cue, phase, false, ph);
  p.tf = null;
  p.g = 'fx';
  if (o.stage >= 3) {
    // Motes drifting up from the ground glow through the idle cycle.
    const e = ELEMENTS[ph.el1];
    p.part = 'ground';
    for (let i = 0; i < (o.stage === 4 ? 5 : 3); i++) {
      const t = (phase + i / 3) % 1;
      p.dot(26 + ((i * 37) % 50), 88 - t * 60, 1.4 + (i % 2) * 0.6, i % 2 ? e.light : e.base, 0.85 * (1 - t));
    }
    p.part = 'main';
  }
  if (ph.shiny && !o.ko) {
    // Shiny: little four-point glints that twinkle in turn around the body and head.
    const spots2 = [[a.hx + a.hr * 1.05, a.hy - a.hr * 0.95, 4.4], [a.bx - a.brx * 1.05, a.by - a.bry * 0.55, 3.6], [a.bx + a.brx * 0.55, a.by + a.bry * 0.95, 3], [a.hx - a.hr * 1.2, a.hy - a.hr * 0.2, 2.6]];
    spots2.forEach(([x, y, r], i) => {
      const tw = 0.35 + 0.65 * Math.max(0, Math.sin((phase + i * 0.27) * TAU));
      const X = Math.max(4, Math.min(96, x)), Y = Math.max(4, Math.min(96, y));
      if (tw * r < 0.5) return;
      twinkle(p, X, Y, r * tw, '#ffffff', 0.95);
      p.dot(X, Y, r * tw * 0.55, '#fff1a8', 0.55);
    });
  }
  if (o.stage === 4) {
    for (let i = 0; i < 5; i++) {
      const ang = phase * TAU + (i * TAU) / 5;
      star(p, 50 + Math.cos(ang) * 40, 54 + Math.sin(ang) * 32, 2.6, pal.glow, 0.9);
    }
  }
  return p;
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
  if (ph.pattern === 'stripes' || ph.pattern === 'bands') {
    const pts: number[][] = [];
    for (let i = 0; i <= 10; i++) { const u = i / 10, v = 1 - u; pts.push([v * v * 24 + 2 * v * u * 50 + u * u * 76, v * v * 58 + 2 * v * u * 48 + u * u * 58]); }
    p.soft(pts, 3, pal.dark, 0.6);
  }
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
