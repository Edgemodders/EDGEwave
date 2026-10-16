// The mix as a Web Audio graph. Playback (an AudioContext) and render (an OfflineAudioContext) build
// the same graph, so what is heard is what is rendered: per track, the edited clip at its rate, its
// effects, gain and pan; then the master's effects and gain.

import { dbToGain, frames, type Audio } from "../src/audio/edits";
import { audible } from "../src/audio/mix";
import type { Effect, SoundDoc, Track } from "../src/doc";

/** An AudioBuffer of the audio. */
export function bufferOf(ctx: BaseAudioContext, a: Audio): AudioBuffer {
  const buf = ctx.createBuffer(a.channels.length, Math.max(1, frames(a)), a.sampleRate);
  a.channels.forEach((c, i) => buf.copyToChannel(c, i));
  return buf;
}

/** A decaying noise burst for the reverb, the same every time (a fixed seed), so renders repeat. */
const impulses = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();
function impulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  let cache = impulses.get(ctx);
  if (!cache) impulses.set(ctx, (cache = new Map()));
  const key = seconds.toFixed(2);
  const hit = cache.get(key);
  if (hit) return hit;
  const n = Math.max(1, Math.round(seconds * ctx.sampleRate));
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  let seed = 0x2077;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0xffffffff) * 2 - 1;
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = random() * Math.pow(1 - i / n, 3);
  }
  cache.set(key, buf);
  return buf;
}

function distortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const k = amount * 100;
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

/** One effect between input and its returned output. */
function effectNode(ctx: BaseAudioContext, e: Effect, input: AudioNode): AudioNode {
  switch (e.type) {
    case "eq": {
      const low = new BiquadFilterNode(ctx, { type: "lowshelf", frequency: 250, gain: e.low });
      const mid = new BiquadFilterNode(ctx, { type: "peaking", frequency: 1500, Q: 0.9, gain: e.mid });
      const high = new BiquadFilterNode(ctx, { type: "highshelf", frequency: 4000, gain: e.high });
      input.connect(low).connect(mid).connect(high);
      return high;
    }
    case "lowpass":
    case "highpass":
    case "bandpass": {
      const f = new BiquadFilterNode(ctx, { type: e.type, frequency: e.hz, Q: e.q });
      input.connect(f);
      return f;
    }
    case "reverb": {
      const out = new GainNode(ctx);
      const dry = new GainNode(ctx, { gain: 1 - e.mix });
      const wet = new GainNode(ctx, { gain: e.mix });
      const conv = new ConvolverNode(ctx, { buffer: impulse(ctx, e.seconds) });
      input.connect(dry).connect(out);
      input.connect(conv).connect(wet).connect(out);
      return out;
    }
    case "distortion": {
      const shaper = new WaveShaperNode(ctx, { curve: distortionCurve(e.amount), oversample: "4x" });
      // Soft clipping raises the level; bring it back about where it was.
      const trim = new GainNode(ctx, { gain: 1 / (1 + e.amount * 1.5) });
      input.connect(shaper).connect(trim);
      return trim;
    }
    case "compressor": {
      const c = new DynamicsCompressorNode(ctx, { threshold: e.threshold, ratio: e.ratio, attack: 0.005, release: 0.15, knee: 6 });
      input.connect(c);
      return c;
    }
  }
}

/** A chain of effects after input, skipping bypassed ones; returns the last node. */
export function chain(ctx: BaseAudioContext, effects: readonly Effect[], input: AudioNode): AudioNode {
  return effects.filter((e) => !e.bypass).reduce((node, e) => effectNode(ctx, e, node), input);
}

/** A track's chain from input: effects, gain, pan. Returns the pan node. */
function trackChain(ctx: BaseAudioContext, t: Track, input: AudioNode): AudioNode {
  const gain = new GainNode(ctx, { gain: dbToGain(t.gain) });
  const pan = new StereoPannerNode(ctx, { pan: Math.max(-1, Math.min(1, t.pan)) });
  chain(ctx, t.effects, input).connect(gain).connect(pan);
  return pan;
}

export interface Built {
  sources: AudioBufferSourceNode[];
}

/**
 * The mix from time `from` (seconds on the mix) into dest. clipOf gives a track's edited clip (none
 * yet: the track is left out). With `only`, just that track, from `from` seconds into its clip, with
 * its effects but without the master's (the clip editor's playback).
 */
export function buildMix(
  ctx: BaseAudioContext,
  doc: SoundDoc,
  clipOf: (t: Track) => Audio | undefined,
  from: number,
  dest: AudioNode,
  only?: { track: Track; loop?: { start: number; end: number } | null; end?: number },
): Built {
  const sources: AudioBufferSourceNode[] = [];
  const at = ctx.currentTime;
  if (only) {
    const clip = clipOf(only.track);
    if (!clip) return { sources };
    const src = new AudioBufferSourceNode(ctx, { buffer: bufferOf(ctx, clip), playbackRate: only.track.rate ?? 1 });
    trackChain(ctx, only.track, src).connect(dest);
    if (only.loop) {
      src.loop = true;
      src.loopStart = only.loop.start;
      src.loopEnd = only.loop.end;
      src.start(at, from);
    } else {
      src.start(at, from, Math.max(0, (only.end ?? clip.channels[0].length / clip.sampleRate) - from));
    }
    sources.push(src);
    return { sources };
  }
  const master = new GainNode(ctx, { gain: dbToGain(doc.master.gain) });
  const bus = new GainNode(ctx);
  chain(ctx, doc.master.effects, bus).connect(master).connect(dest);
  for (const t of audible(doc.tracks)) {
    const clip = clipOf(t);
    if (!clip) continue;
    const rate = t.rate && t.rate > 0 ? t.rate : 1;
    const length = clip.channels[0].length / clip.sampleRate;
    // Into the clip, in the clip's own seconds.
    const into = Math.max(0, (from - t.offset) * rate);
    if (into >= length) continue;
    const src = new AudioBufferSourceNode(ctx, { buffer: bufferOf(ctx, clip), playbackRate: rate });
    trackChain(ctx, t, src).connect(bus);
    src.start(at + Math.max(0, t.offset - from), into);
    sources.push(src);
  }
  return { sources };
}
