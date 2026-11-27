// Changes audio's sample rate, and mixes it down to mono. Pure, like edits.ts. The .wem step uses it:
// the game's voice lines are mono 48 kHz, and Wwise keeps a source's own rate (a 24 kHz take stays 24 kHz).

import { frames, type Audio, type Samples } from "./edits";

/** The channels averaged into one. */
export function toMono(a: Audio): Audio {
  if (a.channels.length <= 1) return a;
  const n = frames(a);
  const out = new Float32Array(n);
  for (const c of a.channels) for (let i = 0; i < n; i++) out[i] += c[i];
  for (let i = 0; i < n; i++) out[i] /= a.channels.length;
  return { sampleRate: a.sampleRate, channels: [out] };
}

/** sin(pi x) / (pi x). */
const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

/** A Blackman window over -1 to 1. */
const blackman = (t: number) => (Math.abs(t) >= 1 ? 0 : 0.42 + 0.5 * Math.cos(Math.PI * t) + 0.08 * Math.cos(2 * Math.PI * t));

/**
 * Audio at another sample rate, by windowed sinc interpolation: `zeros` zero crossings on each side, with
 * the cut-off at the lower rate's Nyquist, so going down does not alias. Each output sample's weights are
 * normalised, so a constant stays constant.
 */
export function resample(a: Audio, rate: number, zeros = 16): Audio {
  if (!(rate > 0)) throw new Error(`Not a sample rate: ${rate}`);
  if (a.sampleRate === rate) return a;
  const ratio = rate / a.sampleRate;
  const cut = Math.min(1, ratio);
  const reach = zeros / cut;
  const inN = frames(a);
  const n = Math.max(0, Math.round(inN * ratio));
  const channels = a.channels.map((src) => {
    const out: Samples = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i / ratio;
      const lo = Math.max(0, Math.ceil(x - reach));
      const hi = Math.min(inN - 1, Math.floor(x + reach));
      let sum = 0;
      let weights = 0;
      for (let k = lo; k <= hi; k++) {
        const d = x - k;
        const w = cut * sinc(cut * d) * blackman(d / reach);
        sum += src[k] * w;
        weights += w;
      }
      out[i] = weights ? sum / weights : 0;
    }
    return out;
  });
  return { sampleRate: rate, channels };
}
