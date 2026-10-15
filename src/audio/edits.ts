// Applies a document's edits to decoded audio. Pure: no DOM, VS Code or Node imports, so the editor
// page runs it for playback and render, and the unit tests run it in Node.

import type { Curve, Edit } from "../doc";

/** One channel's samples, -1 to 1, in their own ArrayBuffer (Web Audio's copyToChannel needs that). */
export type Samples = Float32Array<ArrayBuffer>;

/** Decoded audio: one channel of samples each, all the same length. */
export interface Audio {
  sampleRate: number;
  channels: Samples[];
}

export const frames = (a: Audio): number => a.channels[0]?.length ?? 0;
export const duration = (a: Audio): number => frames(a) / a.sampleRate;

/** A time in seconds as a frame index, clamped to the sound. */
function at(a: Audio, t: number): number {
  return Math.max(0, Math.min(frames(a), Math.round(t * a.sampleRate)));
}

/** start to end as frame indices, ordered and clamped; the whole sound when both are absent. */
function range(a: Audio, start?: number, end?: number): [number, number] {
  if (start === undefined && end === undefined) return [0, frames(a)];
  const s = at(a, start ?? 0);
  const e = at(a, end ?? duration(a));
  return s <= e ? [s, e] : [e, s];
}

function map(a: Audio, f: (c: Samples) => Samples): Audio {
  return { sampleRate: a.sampleRate, channels: a.channels.map(f) };
}

function joined(parts: Float32Array[]): Samples {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const gainToDb = (g: number): number => 20 * Math.log10(g);

/** The ramp's gain at x from 0 to 1 for a fade in; a fade out runs it backwards. */
function shape(curve: Curve, x: number): number {
  switch (curve) {
    case "exponential":
      return x * x;
    case "smooth":
      return 0.5 - 0.5 * Math.cos(Math.PI * x);
    default:
      return x;
  }
}

/** The highest absolute sample over a frame range, across channels. */
export function peak(a: Audio, s = 0, e = frames(a)): number {
  let p = 0;
  for (const c of a.channels) for (let i = s; i < e; i++) p = Math.max(p, Math.abs(c[i]));
  return p;
}

export function applyEdit(a: Audio, edit: Edit): Audio {
  switch (edit.op) {
    case "trim": {
      const [s, e] = range(a, edit.start, edit.end);
      return map(a, (c) => c.slice(s, e));
    }
    case "cut": {
      const [s, e] = range(a, edit.start, edit.end);
      return map(a, (c) => joined([c.subarray(0, s), c.subarray(e)]));
    }
    case "paste": {
      const [s, e] = range(a, edit.from.start, edit.from.end);
      const p = at(a, edit.at);
      return map(a, (c) => joined([c.subarray(0, p), c.subarray(s, e), c.subarray(p)]));
    }
    case "silence": {
      const p = at(a, edit.at);
      const n = Math.max(0, Math.round(edit.length * a.sampleRate));
      return map(a, (c) => joined([c.subarray(0, p), new Float32Array(n), c.subarray(p)]));
    }
    case "fade": {
      const [s, e] = range(a, edit.start, edit.end);
      const n = e - s;
      const curve = edit.curve ?? "linear";
      return map(a, (c) => {
        const out = c.slice();
        for (let i = 0; i < n; i++) {
          const x = n === 1 ? 1 : i / (n - 1);
          out[s + i] *= shape(curve, edit.dir === "in" ? x : 1 - x);
        }
        return out;
      });
    }
    case "gain": {
      const [s, e] = range(a, edit.start, edit.end);
      const g = dbToGain(edit.db);
      return map(a, (c) => {
        const out = c.slice();
        for (let i = s; i < e; i++) out[i] *= g;
        return out;
      });
    }
    case "normalize": {
      const [s, e] = range(a, edit.start, edit.end);
      const p = peak(a, s, e);
      if (p === 0) return a;
      const g = dbToGain(edit.peakDb) / p;
      return map(a, (c) => {
        const out = c.slice();
        for (let i = s; i < e; i++) out[i] *= g;
        return out;
      });
    }
    case "channels": {
      if (edit.to === a.channels.length) return a;
      if (edit.to === 1) {
        const out = new Float32Array(frames(a));
        for (const c of a.channels) for (let i = 0; i < out.length; i++) out[i] += c[i] / a.channels.length;
        return { sampleRate: a.sampleRate, channels: [out] };
      }
      const mono = a.channels[0];
      return { sampleRate: a.sampleRate, channels: [mono.slice(), mono.slice()] };
    }
  }
}

/** The sound after all the edits, in order. The input is not changed. */
export function applyEdits(a: Audio, edits: readonly Edit[]): Audio {
  return edits.reduce(applyEdit, a);
}
