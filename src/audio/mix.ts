// The mix's arithmetic, the effects' parameters and the presets. Pure, like edits.ts: the page builds
// the audio graph from these (webview/graph.ts), and the unit tests check them in Node.

import type { Effect, EffectType, SoundDoc, Track } from "../doc";

/** The tracks in the mix: those whose lane is checked (out of the mix is saved as mute). */
export function audible(tracks: readonly Track[]): Track[] {
  return tracks.filter((t) => !t.mute);
}

/** Seconds a clip lasts on the mix, at its track's rate. */
export function onMix(t: Track, clipSeconds: number): number {
  return clipSeconds / (t.rate && t.rate > 0 ? t.rate : 1);
}

/** Where the mix ends: the latest end of a heard track, or 0. lengths are the clips' seconds by track id. */
export function mixEnd(doc: SoundDoc, lengths: ReadonlyMap<string, number>): number {
  return audible(doc.tracks).reduce((end, t) => Math.max(end, t.offset + onMix(t, lengths.get(t.id) ?? 0)), 0);
}

/** How long reverbs ring past the end: the longest decay, through tracks and master. */
export function tail(doc: SoundDoc): number {
  const longest = (effects: Effect[]) => effects.reduce((s, e) => (e.type === "reverb" && !e.bypass ? Math.max(s, e.seconds) : s), 0);
  return Math.max(longest(doc.master.effects), ...audible(doc.tracks).map((t) => longest(t.effects)));
}

export interface Param {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}

/** Each effect's name and parameters, for the effects panel. */
export const Effects: Record<EffectType, { label: string; params: Param[]; make: () => Effect }> = {
  eq: {
    label: "EQ",
    params: [
      { key: "low", label: "Low", min: -24, max: 24, step: 0.5, unit: "dB" },
      { key: "mid", label: "Mid", min: -24, max: 24, step: 0.5, unit: "dB" },
      { key: "high", label: "High", min: -24, max: 24, step: 0.5, unit: "dB" },
    ],
    make: () => ({ type: "eq", low: 0, mid: 0, high: 0 }),
  },
  lowpass: { label: "Low-pass", params: filterParams(), make: () => ({ type: "lowpass", hz: 3000, q: 0.7 }) },
  highpass: { label: "High-pass", params: filterParams(), make: () => ({ type: "highpass", hz: 300, q: 0.7 }) },
  bandpass: { label: "Band-pass", params: filterParams(), make: () => ({ type: "bandpass", hz: 1500, q: 1 }) },
  reverb: {
    label: "Reverb",
    params: [
      { key: "seconds", label: "Decay", min: 0.1, max: 8, step: 0.1, unit: "s" },
      { key: "mix", label: "Mix", min: 0, max: 1, step: 0.05, unit: "" },
    ],
    make: () => ({ type: "reverb", seconds: 1.2, mix: 0.25 }),
  },
  distortion: { label: "Distortion", params: [{ key: "amount", label: "Amount", min: 0, max: 1, step: 0.05, unit: "" }], make: () => ({ type: "distortion", amount: 0.2 }) },
  compressor: {
    label: "Compressor",
    params: [
      { key: "threshold", label: "Threshold", min: -60, max: 0, step: 1, unit: "dB" },
      { key: "ratio", label: "Ratio", min: 1, max: 20, step: 0.5, unit: ":1" },
    ],
    make: () => ({ type: "compressor", threshold: -24, ratio: 4 }),
  },
};

function filterParams(): Param[] {
  return [
    { key: "hz", label: "Freq", min: 20, max: 20000, step: 10, unit: "Hz" },
    { key: "q", label: "Q", min: 0.1, max: 20, step: 0.1, unit: "" },
  ];
}

/** Starting chains for sounds modders often want. Applying one replaces the chain; every value stays editable. */
export const Presets: Record<string, { label: string; effects: Effect[] }> = {
  radio: {
    label: "Radio",
    effects: [
      { type: "highpass", hz: 300, q: 0.7 },
      { type: "lowpass", hz: 3400, q: 0.7 },
      { type: "eq", low: 0, mid: 4, high: 0 },
      { type: "distortion", amount: 0.25 },
      { type: "compressor", threshold: -24, ratio: 4 },
    ],
  },
  holocall: {
    label: "Holocall",
    effects: [
      { type: "highpass", hz: 400, q: 0.7 },
      { type: "lowpass", hz: 5000, q: 0.7 },
      { type: "eq", low: -3, mid: 2, high: 3 },
      { type: "distortion", amount: 0.1 },
      { type: "reverb", seconds: 0.3, mix: 0.12 },
    ],
  },
  pa: {
    label: "PA speaker",
    effects: [
      { type: "highpass", hz: 250, q: 0.7 },
      { type: "lowpass", hz: 4500, q: 0.7 },
      { type: "distortion", amount: 0.15 },
      { type: "reverb", seconds: 1.4, mix: 0.3 },
    ],
  },
  wall: {
    label: "Muffled through a wall",
    effects: [
      { type: "lowpass", hz: 600, q: 0.7 },
      { type: "eq", low: 3, mid: -2, high: -6 },
      { type: "reverb", seconds: 0.5, mix: 0.15 },
    ],
  },
};

/** A preset's chain, as a fresh copy to put in a document. */
export function presetEffects(name: string): Effect[] {
  const p = Presets[name];
  if (!p) throw new Error(`No preset ${name}`);
  return p.effects.map((e) => ({ ...e }));
}
