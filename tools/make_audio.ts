// Synthesizes every sound in the game: music loops and sound effects, written as WAV files to assets/.
// All original and generated from code, so there's nothing to license. Re-run with `npx tsx tools/make_audio.ts`.
// Placeholder-quality by design: swap any file in assets/music or assets/sfx for a real recording, same name.
import { mkdirSync, writeFileSync } from 'node:fs';

const SR = 22050;
const TAU = Math.PI * 2;

// ---------- deterministic randomness
let seed = 1234567;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const reseed = (s: number) => { seed = s >>> 0; };

// ---------- buffers
type Buf = Float32Array;
const buf = (sec: number): Buf => new Float32Array(Math.ceil(sec * SR));
function mixIn(dst: Buf, src: Buf, at: number, gain = 1) {
  const o = Math.round(at * SR);
  for (let i = 0; i < src.length; i++) { const j = o + i; if (j >= 0 && j < dst.length) dst[j] += src[i] * gain; }
}
/** Mix in wrapping around the end, for seamless loops. */
function mixWrap(dst: Buf, src: Buf, at: number, gain = 1) {
  const o = Math.round(at * SR), n = dst.length;
  for (let i = 0; i < src.length; i++) dst[(((o + i) % n) + n) % n] += src[i] * gain;
}

function writeWav(path: string, b: Buf, peak = 0.89) {
  let max = 0;
  for (const v of b) max = Math.max(max, Math.abs(v));
  const g = max > 0 ? peak / max : 1;
  const data = Buffer.alloc(b.length * 2);
  for (let i = 0; i < b.length; i++) data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(Math.tanh(b[i] * g * 1.1) / Math.tanh(1.1) * 32767))), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([h, data]));
}

// ---------- oscillators and helpers
type Wave = 'sine' | 'tri' | 'saw' | 'square' | 'pulse25' | 'noise';
function osc(w: Wave, ph: number): number {
  const x = ph - Math.floor(ph);
  switch (w) {
    case 'sine': return Math.sin(TAU * x);
    case 'tri': return 1 - 4 * Math.abs(x - 0.5);
    case 'saw': return 2 * x - 1;
    case 'square': return x < 0.5 ? 1 : -1;
    case 'pulse25': return x < 0.25 ? 1 : -1;
    case 'noise': return rnd() * 2 - 1;
  }
}
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

interface ToneOpts {
  wave?: Wave; dur: number; freq: number | ((t: number) => number);
  a?: number; d?: number; s?: number; r?: number; gain?: number; vib?: number; vibRate?: number; lp?: number; lpEnd?: number; detune?: number;
}
/** One note with an ADSR envelope and an optional sweeping low-pass. */
function tone(o: ToneOpts): Buf {
  const a = o.a ?? 0.005, d = o.d ?? 0.08, s = o.s ?? 0.6, r = o.r ?? 0.08;
  const total = o.dur + r;
  const b = buf(total);
  let ph = 0, ph2 = 0, lpv = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    let f = typeof o.freq === 'function' ? o.freq(t) : o.freq;
    if (o.vib) f *= 1 + o.vib * Math.sin(TAU * (o.vibRate ?? 5.5) * t);
    ph += f / SR; ph2 += (f * (1 + (o.detune ?? 0))) / SR;
    let v = osc(o.wave ?? 'sine', ph);
    if (o.detune) v = (v + osc(o.wave ?? 'sine', ph2)) * 0.5;
    const env = t < a ? t / a : t < a + d ? 1 - (1 - s) * ((t - a) / d) : t < o.dur ? s : s * Math.max(0, 1 - (t - o.dur) / r);
    if (o.lp) {
      const cut = o.lpEnd != null ? o.lp + (o.lpEnd - o.lp) * Math.min(1, t / total) : o.lp;
      const k = 1 - Math.exp((-TAU * cut) / SR);
      lpv += k * (v - lpv); v = lpv;
    }
    b[i] = v * env * (o.gain ?? 1);
  }
  return b;
}
function lowpass(b: Buf, cut: number): Buf {
  const k = 1 - Math.exp((-TAU * cut) / SR); let v = 0;
  for (let i = 0; i < b.length; i++) { v += k * (b[i] - v); b[i] = v; }
  return b;
}
function highpass(b: Buf, cut: number): Buf {
  const k = 1 - Math.exp((-TAU * cut) / SR); let v = 0;
  for (let i = 0; i < b.length; i++) { v += k * (b[i] - v); b[i] = b[i] - v; }
  return b;
}
/** A small Schroeder reverb. Returns only the wet signal. */
function reverb(b: Buf, size = 1, wrap = false): Buf {
  const out = new Float32Array(b.length);
  const n = b.length;
  const combs = [1557, 1617, 1491, 1422].map(x => Math.round((x * size * SR) / 44100));
  for (const L of combs) {
    const line = new Float32Array(L); let idx = 0, lp = 0;
    const passes = wrap ? 2 : 1;
    for (let p = 0; p < passes; p++) for (let i = 0; i < n; i++) {
      const y = line[idx]; lp = y * 0.7 + lp * 0.3;
      line[idx] = b[i] + lp * 0.8; idx = (idx + 1) % L;
      if (p === passes - 1) out[i] += y * 0.25;
    }
  }
  for (const L of [225, 556].map(x => Math.round((x * SR) / 44100))) {
    const line = new Float32Array(L); let idx = 0;
    for (let i = 0; i < n; i++) { const y = line[idx]; const x = out[i] + y * 0.5; line[idx] = x; out[i] = y - x * 0.5; idx = (idx + 1) % L; }
  }
  return out;
}
function add(...bs: { b: Buf; at?: number; g?: number }[]): Buf {
  const len = Math.max(...bs.map(x => x.b.length + Math.round((x.at ?? 0) * SR)));
  const out = new Float32Array(len);
  for (const x of bs) mixIn(out, x.b, x.at ?? 0, x.g ?? 1);
  return out;
}
function withVerb(b: Buf, wet = 0.3, size = 1): Buf {
  const tail = new Float32Array(b.length + Math.round(SR * 0.8 * size));
  tail.set(b);
  const w = reverb(tail, size);
  for (let i = 0; i < tail.length; i++) tail[i] += w[i] * wet;
  return tail;
}
const noise = (dur: number, a = 0.002, d = 0.1, s = 0.0, r = 0.05) => tone({ wave: 'noise', dur, freq: 1, a, d, s, r });

// ---------- drums
const kick = (g = 1) => tone({ wave: 'sine', dur: 0.16, freq: t => 50 + 110 * Math.exp(-t * 30), a: 0.001, d: 0.15, s: 0, r: 0.02, gain: g });
const snare = (g = 1) => add({ b: highpass(noise(0.14, 0.001, 0.13), 900), g: 0.7 * g }, { b: tone({ wave: 'tri', dur: 0.08, freq: t => 220 - 80 * t, d: 0.08, s: 0, gain: 0.5 * g }) });
const hat = (g = 1, open = false) => highpass(noise(open ? 0.12 : 0.03, 0.001, open ? 0.12 : 0.03), 6000).map(v => v * g);
const tom = (n: number, g = 1) => tone({ wave: 'sine', dur: 0.22, freq: t => midi(n) * (1 + Math.exp(-t * 20)), a: 0.001, d: 0.22, s: 0, gain: g });

// ---------- music
interface Song { bpm: number; bars: number; key: number; minor: boolean; chords: number[][] }
/** Chord as scale-degree triad rooted on a semitone offset from the key. */
const chordNotes = (key: number, c: number[]) => c.map(x => key + x);

function song(name: string, s: Song, parts: (b: Buf, beat: number, bar: number, chord: number[], beatLen: number) => void, sendVerb = 0.22) {
  const beat = 60 / s.bpm;
  const len = s.bars * 4 * beat;
  const dry = buf(len);
  for (let bar = 0; bar < s.bars; bar++) {
    const ch = chordNotes(s.key, s.chords[bar % s.chords.length]);
    parts(dry, bar * 4 * beat, bar, ch, beat);
  }
  // Seamless loop: the reverb is computed over two passes so the tail wraps into the start.
  const wet = reverb(dry, 1.1, true);
  for (let i = 0; i < dry.length; i++) dry[i] += wet[i] * sendVerb;
  writeWav(`assets/music/${name}.wav`, dry, 0.8);
  console.log(`music ${name}: ${len.toFixed(1)}s`);
}

/** A melody built from repeating motifs, so it sounds composed rather than random. */
function melody(bars: number, chordsOf: (bar: number) => number[], scale: number[], rhythmA: number[], rhythmB: number[], seedN: number) {
  reseed(seedN);
  const notes: { bar: number; at: number; len: number; n: number }[] = [];
  const motif = (bar: number, rhythm: number[], shift: number) => {
    const ch = chordsOf(bar);
    let pos = 0; let prev = ch[1] + 12;
    for (let i = 0; i < rhythm.length; i++) {
      const len = rhythm[i];
      if (len > 0) {
        const strong = pos === 0 || pos === 2;
        let n: number;
        if (strong) n = ch[[0, 1, 2][Math.floor(rnd() * 3)]] + 12;
        else { const idx = scale.indexOf(((prev % 12) + 12) % 12); const step = rnd() < 0.5 ? 1 : -1; n = prev + ((scale[(idx + step + scale.length) % scale.length] - scale[(idx + scale.length) % scale.length] + 12) % 12) * (step > 0 ? 1 : 0) - (step < 0 ? ((scale[(idx + scale.length) % scale.length] - scale[(idx - 1 + scale.length) % scale.length] + 12) % 12) : 0); }
        n += shift;
        while (n < 64) n += 12; while (n > 84) n -= 12;
        notes.push({ bar, at: pos, len, n }); prev = n;
      }
      pos += Math.abs(len);
    }
  };
  for (let bar = 0; bar < bars; bar++) {
    const phrase = Math.floor(bar / 4) % 4, inPhrase = bar % 4;
    const rhythm = inPhrase === 3 ? rhythmB : rhythmA;
    // A A' B A shape: phrase 2 lifts, the others repeat the opening seed.
    reseed(seedN + inPhrase * 31 + (phrase === 2 ? 977 : 0));
    motif(bar, rhythm, phrase === 2 ? 0 : 0);
  }
  return notes;
}

function makeMusic() {
  mkdirSync('assets/music', { recursive: true });

  // Hub: calm and curious. F major, I-V-vi-IV / I-iii-IV-V.
  {
    const s: Song = { bpm: 92, bars: 16, key: 53, minor: false, chords: [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12], [0, 4, 7], [4, 7, 11], [5, 9, 12], [7, 11, 14]] };
    const scale = [0, 2, 4, 5, 7, 9, 11].map(x => (x + 5) % 12);
    const mel = melody(16, bar => chordNotes(s.key, s.chords[bar % 8]), scale, [1, 0.5, 0.5, 1, 1], [1.5, 0.5, 2], 11);
    song('hub', s, (b, t0, bar, ch, beat) => {
      // pad
      for (const n of ch) mixWrap(b, tone({ wave: 'saw', dur: beat * 4 - 0.05, freq: midi(n), a: 0.5, d: 0.5, s: 0.7, r: 0.4, lp: 900, detune: 0.004, gain: 0.07 }), t0);
      // bass
      for (const at of [0, 1.5, 2, 3]) mixWrap(b, tone({ wave: 'tri', dur: beat * 0.45, freq: midi(ch[0] - 12), d: 0.2, s: 0.4, r: 0.05, gain: 0.32 }), t0 + at * beat);
      // marimba-ish arpeggio
      const arp = [0, 1, 2, 1, 2, 1, 0, 1];
      arp.forEach((k, i) => mixWrap(b, add({ b: tone({ wave: 'sine', dur: 0.02, freq: midi(ch[k] + 12), a: 0.002, d: 0.25, s: 0, r: 0.2, gain: 0.13 }) }, { b: tone({ wave: 'sine', dur: 0.02, freq: midi(ch[k] + 12) * 4, a: 0.001, d: 0.05, s: 0, r: 0.05, gain: 0.03 }) }), t0 + (i * beat) / 2));
      // shaker
      for (let i = 0; i < 8; i++) mixWrap(b, hat(i % 2 ? 0.05 : 0.09), t0 + (i * beat) / 2);
      // lead
      for (const m of mel.filter(x => x.bar === bar)) mixWrap(b, tone({ wave: 'tri', dur: m.len * beat * 0.9, freq: midi(m.n), a: 0.02, d: 0.2, s: 0.55, r: 0.15, vib: 0.006, gain: 0.2 }), t0 + m.at * beat);
    }, 0.3);
  }

  // Battle: driving. A minor, i-VI-III-VII.
  {
    const s: Song = { bpm: 138, bars: 16, key: 57, minor: true, chords: [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5], [0, 3, 7], [-4, 0, 3], [5, 8, 12], [7, 11, 14]] };
    const scale = [0, 2, 3, 5, 7, 8, 10].map(x => (x + 9) % 12);
    const mel = melody(16, bar => chordNotes(s.key, s.chords[bar % 8]), scale, [0.5, 0.5, 1, 0.5, 0.5, 1], [0.75, 0.75, 0.5, 2], 23);
    song('battle', s, (b, t0, bar, ch, beat) => {
      for (let i = 0; i < 8; i++) mixWrap(b, tone({ wave: 'saw', dur: beat * 0.4, freq: midi(ch[0] - 24 + (i % 4 === 3 ? 12 : 0)), d: 0.12, s: 0.5, r: 0.04, lp: 500, lpEnd: 300, gain: 0.28 }), t0 + (i * beat) / 2);
      for (let i = 0; i < 16; i++) mixWrap(b, tone({ wave: 'pulse25', dur: beat * 0.2, freq: midi(ch[i % 3] + 12), d: 0.06, s: 0.3, r: 0.03, lp: 2400, gain: 0.07 }), t0 + (i * beat) / 4);
      for (const at of [0, 1.5, 2, 2.75]) mixWrap(b, kick(0.8), t0 + at * beat);
      for (const at of [1, 3]) mixWrap(b, snare(0.55), t0 + at * beat);
      for (let i = 0; i < 8; i++) mixWrap(b, hat(i % 2 ? 0.12 : 0.2, i === 7), t0 + (i * beat) / 2);
      if (bar % 4 === 3) for (let i = 0; i < 4; i++) mixWrap(b, tom(50 - i * 3, 0.45), t0 + (3 + i / 4) * beat);
      if (bar >= 4) for (const m of mel.filter(x => x.bar === bar)) mixWrap(b, tone({ wave: 'square', dur: m.len * beat * 0.85, freq: midi(m.n), a: 0.005, d: 0.1, s: 0.6, r: 0.06, vib: 0.008, lp: 3000, gain: 0.11 }), t0 + m.at * beat);
    }, 0.16);
  }

  // Boss: heavier. D minor with a harmonic-minor V.
  {
    const s: Song = { bpm: 148, bars: 16, key: 50, minor: true, chords: [[0, 3, 7], [0, 3, 7], [-4, 0, 3], [-5, -1, 2], [5, 8, 12], [-4, 0, 3], [-2, 2, 5], [-5, -1, 2]] };
    const scale = [0, 2, 3, 5, 7, 8, 11].map(x => (x + 2) % 12);
    const mel = melody(16, bar => chordNotes(s.key, s.chords[bar % 8]), scale, [1, 0.5, 0.5, 0.5, 0.5, 1], [0.5, 0.5, 0.5, 0.5, 2], 47);
    song('boss', s, (b, t0, bar, ch, beat) => {
      for (let i = 0; i < 16; i++) mixWrap(b, tone({ wave: 'saw', dur: beat * 0.2, freq: midi(ch[0] - 24), d: 0.06, s: 0.6, r: 0.02, lp: 420, detune: 0.01, gain: 0.3 }), t0 + (i * beat) / 4);
      for (const n of ch) mixWrap(b, tone({ wave: 'saw', dur: beat * 4 - 0.05, freq: midi(n), a: 0.08, d: 0.3, s: 0.6, r: 0.2, lp: 1200, detune: 0.006, gain: 0.05 }), t0);
      for (const at of [0, 0.5, 1.5, 2, 2.5, 3.5]) mixWrap(b, kick(0.9), t0 + at * beat);
      for (const at of [1, 3]) mixWrap(b, snare(0.65), t0 + at * beat);
      for (let i = 0; i < 16; i++) mixWrap(b, hat(i % 4 === 2 ? 0.14 : 0.07), t0 + (i * beat) / 4);
      if (bar % 2 === 1) for (let i = 0; i < 4; i++) mixWrap(b, tom(45 - i * 2, 0.5), t0 + (2 + i / 2) * beat);
      for (const m of mel.filter(x => x.bar === bar)) mixWrap(b, tone({ wave: 'saw', dur: m.len * beat * 0.85, freq: midi(m.n - 12), a: 0.01, d: 0.1, s: 0.7, r: 0.06, vib: 0.01, lp: 2600, detune: 0.005, gain: 0.12 }), t0 + m.at * beat);
    }, 0.14);
  }
}

// ---------- sound effects
function sfx(name: string, b: Buf) {
  mkdirSync('assets/sfx', { recursive: true });
  // Short fade-out so nothing clicks at the end.
  const f = Math.min(b.length, Math.round(SR * 0.01));
  for (let i = 0; i < f; i++) b[b.length - 1 - i] *= i / f;
  writeWav(`assets/sfx/${name}.wav`, b, 0.85);
}
const sweep = (w: Wave, dur: number, f0: number, f1: number, g = 1, extra: Partial<ToneOpts> = {}) =>
  tone({ wave: w, dur, freq: t => f0 * Math.pow(f1 / f0, Math.min(1, t / dur)), a: 0.003, d: dur, s: 0.2, r: 0.04, gain: g, ...extra });
const arp = (w: Wave, notes: number[], step: number, len: number, g = 1, extra: Partial<ToneOpts> = {}) =>
  add(...notes.map((n, i) => ({ b: tone({ wave: w, dur: len, freq: midi(n), a: 0.003, d: len, s: 0.3, r: 0.12, gain: g, ...extra }), at: i * step })));

function makeSfx() {
  reseed(99);
  sfx('tap', tone({ wave: 'sine', dur: 0.025, freq: t => 1400 - 9000 * t, a: 0.001, d: 0.025, s: 0, r: 0.01, gain: 0.6 }));
  sfx('select', arp('square', [79, 86], 0.05, 0.04, 0.35, { lp: 3000 }));
  sfx('hit', add({ b: lowpass(noise(0.12, 0.001, 0.12), 2500), g: 0.9 }, { b: tone({ wave: 'sine', dur: 0.14, freq: t => 60 + 160 * Math.exp(-t * 35), d: 0.14, s: 0, gain: 1 }) }));
  sfx('hitBig', withVerb(add({ b: lowpass(noise(0.25, 0.001, 0.25), 3200), g: 1 }, { b: tone({ wave: 'sine', dur: 0.25, freq: t => 45 + 200 * Math.exp(-t * 25), d: 0.25, s: 0, gain: 1.2 }) }, { b: tone({ wave: 'square', dur: 0.06, freq: 160, d: 0.06, s: 0, lp: 1200, gain: 0.4 }) }), 0.25, 0.7));
  sfx('miss', tone({ wave: 'noise', dur: 0.28, freq: 1, a: 0.08, d: 0.2, s: 0.2, r: 0.05, lp: 600, lpEnd: 3500, gain: 0.6 }));
  sfx('heal', withVerb(arp('sine', [84, 88, 91, 96, 100], 0.06, 0.12, 0.5), 0.4));
  sfx('buff', withVerb(add({ b: sweep('square', 0.3, 300, 900, 0.25, { lp: 2500 }) }, { b: arp('tri', [76, 83, 88], 0.08, 0.1, 0.4), at: 0.05 }), 0.25));
  sfx('debuff', withVerb(sweep('square', 0.35, 700, 160, 0.3, { lp: 1800 }), 0.25));
  sfx('shield', withVerb(add(...[1, 2.76, 5.4, 8.93].map((m, i) => ({ b: tone({ wave: 'sine', dur: 0.02, freq: 520 * m, a: 0.002, d: 0.4, s: 0, r: 0.3, gain: 0.35 / (i + 1) }) }))), 0.35));
  sfx('faint', add({ b: sweep('tri', 0.6, 520, 90, 0.6, { vib: 0.03, vibRate: 9 }) }, { b: lowpass(noise(0.3, 0.05, 0.3), 700), at: 0.35, g: 0.4 }));
  sfx('revive', withVerb(add({ b: arp('tri', [67, 71, 74, 79, 83], 0.07, 0.25, 0.45) }, { b: sweep('sine', 0.5, 300, 1200, 0.2), at: 0.05 }), 0.4));
  sfx('poof', lowpass(noise(0.35, 0.02, 0.33, 0, 0.05), 1400));

  // Casting sounds by element family.
  sfx('fire', add({ b: lowpass(tone({ wave: 'noise', dur: 0.4, freq: 1, a: 0.02, d: 0.35, s: 0.2, r: 0.1 }), 1500), g: 0.8 }, ...Array.from({ length: 8 }, (_, i) => ({ b: highpass(noise(0.015, 0.001, 0.015), 2000), at: 0.03 + rnd() * 0.35, g: 0.5 })), { b: tone({ wave: 'sine', dur: 0.3, freq: t => 90 - 30 * t, d: 0.3, s: 0.2, gain: 0.5 }) }));
  sfx('water', add(...Array.from({ length: 6 }, (_, i) => ({ b: tone({ wave: 'sine', dur: 0.05, freq: t => (300 + i * 90 + rnd() * 100) * (1 + 6 * t), a: 0.002, d: 0.05, s: 0, r: 0.02, gain: 0.5 }), at: i * 0.045 })), { b: lowpass(noise(0.3, 0.05, 0.25), 900), g: 0.3 }));
  sfx('zap', add({ b: tone({ wave: 'saw', dur: 0.25, freq: () => 200 + rnd() * 1800, a: 0.001, d: 0.25, s: 0.2, r: 0.04, gain: 0.35 }) }, { b: highpass(noise(0.2, 0.001, 0.2), 3000), g: 0.4 }));
  sfx('ice', withVerb(add(...[88, 95, 91, 100].map((n, i) => ({ b: tone({ wave: 'sine', dur: 0.01, freq: midi(n), a: 0.001, d: 0.25, s: 0, r: 0.2, gain: 0.35 }), at: i * 0.04 })), { b: highpass(noise(0.12, 0.001, 0.12), 5000), g: 0.25 }), 0.4));
  sfx('nature', add({ b: tone({ wave: 'noise', dur: 0.35, freq: 1, a: 0.06, d: 0.25, s: 0.3, r: 0.08, lp: 800, lpEnd: 2400, gain: 0.6 }) }, ...Array.from({ length: 5 }, (_, i) => ({ b: tone({ wave: 'tri', dur: 0.03, freq: 900 + i * 150, a: 0.002, d: 0.03, s: 0, r: 0.02, gain: 0.2 }), at: 0.05 + i * 0.05 }))));
  sfx('magic', withVerb(add({ b: arp('sine', [81, 85, 88, 93, 97, 100], 0.035, 0.08, 0.35) }, { b: arp('tri', [69, 76], 0.1, 0.25, 0.2) }), 0.45));
  sfx('dark', withVerb(add({ b: sweep('saw', 0.45, 220, 55, 0.35, { lp: 700, detune: 0.02 }) }, { b: lowpass(noise(0.4, 0.1, 0.3), 400), g: 0.4 }), 0.45, 1.3));
  sfx('venom', add(...Array.from({ length: 5 }, (_, i) => ({ b: tone({ wave: 'sine', dur: 0.07, freq: t => (180 + rnd() * 120) * (1 + 3 * t * (1 - t * 8)), a: 0.003, d: 0.07, s: 0, r: 0.03, gain: 0.55 }), at: i * 0.06 }))));
  sfx('rock', add({ b: tone({ wave: 'sine', dur: 0.25, freq: t => 40 + 120 * Math.exp(-t * 20), d: 0.25, s: 0, gain: 1 }) }, { b: lowpass(noise(0.35, 0.001, 0.3), 900), g: 0.7 }, ...Array.from({ length: 4 }, () => ({ b: lowpass(noise(0.03, 0.001, 0.03), 2500), at: 0.08 + rnd() * 0.2, g: 0.4 }))));
  sfx('roar', add({ b: tone({ wave: 'saw', dur: 0.6, freq: t => 90 + 40 * Math.sin(t * 9), a: 0.05, d: 0.5, s: 0.4, r: 0.1, lp: 900, vib: 0.05, vibRate: 23, detune: 0.03, gain: 0.5 }) }, { b: lowpass(noise(0.6, 0.05, 0.5), 1200), g: 0.35 }));
  sfx('swing', tone({ wave: 'noise', dur: 0.14, freq: 1, a: 0.04, d: 0.1, s: 0.1, r: 0.03, lp: 1500, lpEnd: 4500, gain: 0.5 }));

  // Eggs and growth.
  sfx('crack', add({ b: highpass(noise(0.04, 0.001, 0.04), 1500), g: 0.9 }, { b: tone({ wave: 'sine', dur: 0.05, freq: 1300, d: 0.05, s: 0, gain: 0.3 }) }));
  sfx('crackBig', add({ b: highpass(noise(0.08, 0.001, 0.08), 900), g: 1 }, { b: tone({ wave: 'sine', dur: 0.08, freq: t => 900 - 3000 * t, d: 0.08, s: 0, gain: 0.4 }) }, { b: highpass(noise(0.03, 0.001, 0.03), 2000), at: 0.07, g: 0.6 }));
  sfx('hatch', withVerb(add({ b: tone({ wave: 'sine', dur: 0.1, freq: t => 200 + 2000 * t, d: 0.1, s: 0, gain: 0.5 }) }, { b: lowpass(noise(0.2, 0.001, 0.2), 3000), g: 0.5 }, { b: arp('sine', [84, 88, 91, 96], 0.05, 0.2, 0.4), at: 0.08 }), 0.35));
  for (let i = 1; i <= 5; i++) sfx('star' + i, withVerb(add({ b: tone({ wave: 'sine', dur: 0.02, freq: midi(76 + [0, 2, 4, 7, 12][i - 1]), a: 0.002, d: 0.5, s: 0, r: 0.4, gain: 0.5 }) }, { b: tone({ wave: 'sine', dur: 0.02, freq: midi(88 + [0, 2, 4, 7, 12][i - 1]), a: 0.002, d: 0.3, s: 0, r: 0.2, gain: 0.15 }) }), 0.4));
  sfx('reveal', withVerb(arp('tri', [72, 76, 79, 84, 88], 0.07, 0.35, 0.4), 0.4));
  sfx('levelup', withVerb(arp('square', [72, 76, 79, 84], 0.07, 0.12, 0.25, { lp: 3500 }), 0.3));
  sfx('grow', withVerb(add({ b: arp('square', [67, 72, 76, 79, 84, 88], 0.08, 0.15, 0.22, { lp: 3500 }) }, { b: tone({ wave: 'saw', dur: 0.6, freq: midi(60), a: 0.05, d: 0.4, s: 0.5, r: 0.3, lp: 1500, detune: 0.01, gain: 0.15 }), at: 0.4 }), 0.35));
  sfx('egg', withVerb(arp('tri', [79, 83, 86, 91], 0.06, 0.2, 0.4), 0.35));
  sfx('breed', withVerb(add({ b: arp('sine', [72, 76, 79], 0.12, 0.35, 0.35) }, { b: arp('sine', [84, 88], 0.12, 0.3, 0.2), at: 0.3 }), 0.4));
  sfx('coin', add({ b: tone({ wave: 'square', dur: 0.05, freq: midi(83), d: 0.05, s: 0.5, r: 0.02, lp: 4000, gain: 0.25 }) }, { b: tone({ wave: 'square', dur: 0.18, freq: midi(88), d: 0.18, s: 0.4, r: 0.08, lp: 4000, gain: 0.25 }), at: 0.05 }));
  sfx('chest', withVerb(add({ b: tone({ wave: 'sine', dur: 0.12, freq: t => 120 - 60 * t, d: 0.12, s: 0, gain: 0.6 }) }, ...Array.from({ length: 7 }, (_, i) => ({ b: tone({ wave: 'square', dur: 0.06, freq: midi(84 + [0, 4, 7, 12, 7, 12, 16][i]), d: 0.06, s: 0.4, r: 0.04, lp: 4000, gain: 0.18 }), at: 0.1 + i * 0.06 }))), 0.3));

  // Jingles.
  sfx('victory', withVerb(add(
    { b: arp('square', [67, 72, 76], 0.11, 0.1, 0.25, { lp: 3500 }) },
    { b: tone({ wave: 'square', dur: 0.7, freq: midi(79), a: 0.01, d: 0.2, s: 0.7, r: 0.3, lp: 3500, vib: 0.01, gain: 0.25 }), at: 0.34 },
    { b: tone({ wave: 'tri', dur: 1.0, freq: midi(48), a: 0.01, d: 0.3, s: 0.6, r: 0.3, gain: 0.35 }), at: 0.34 },
    { b: tone({ wave: 'saw', dur: 1.0, freq: midi(64), a: 0.05, d: 0.3, s: 0.5, r: 0.4, lp: 1400, gain: 0.1 }), at: 0.34 },
    { b: tone({ wave: 'saw', dur: 1.0, freq: midi(60), a: 0.05, d: 0.3, s: 0.5, r: 0.4, lp: 1400, gain: 0.1 }), at: 0.34 },
  ), 0.3));
  sfx('defeat', withVerb(add(
    { b: arp('tri', [67, 66, 65], 0.25, 0.22, 0.35) },
    { b: tone({ wave: 'tri', dur: 0.9, freq: midi(64), a: 0.01, d: 0.3, s: 0.5, r: 0.4, vib: 0.012, gain: 0.35 }), at: 0.75 },
    { b: tone({ wave: 'sine', dur: 1.1, freq: midi(40), a: 0.02, d: 0.4, s: 0.5, r: 0.4, gain: 0.35 }), at: 0.75 },
  ), 0.35));
}

makeSfx();
makeMusic();
