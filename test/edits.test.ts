// Unit tests for the edit chain and the WAV writer. `npm test` bundles and runs them with node --test.

import { test } from "node:test";
import * as assert from "node:assert/strict";
import { applyEdits, duration, frames, peak, type Audio } from "../src/audio/edits";
import { decodeWav, encodeWav } from "../src/audio/wav";
import { formatDoc, looksLikeVoice, parseDoc, type SoundDoc } from "../src/doc";

/** A ramp 0, 1, 2 ... scaled small, at 10 Hz, so frames and seconds are easy to read. */
function ramp(n: number, ch = 1, rate = 10): Audio {
  return { sampleRate: rate, channels: Array.from({ length: ch }, (_, c) => Float32Array.from({ length: n }, (_, i) => (i + c * 100) / 1000)) };
}
const values = (a: Audio, c = 0) => Array.from(a.channels[c], (x) => Math.round(x * 1000));

test("trim keeps start to end", () => {
  assert.deepEqual(values(applyEdits(ramp(10), [{ op: "trim", start: 0.2, end: 0.5 }])), [2, 3, 4]);
});

test("cut removes start to end, in either order", () => {
  assert.deepEqual(values(applyEdits(ramp(10), [{ op: "cut", start: 0.5, end: 0.2 }])), [0, 1, 5, 6, 7, 8, 9]);
});

test("paste inserts a copy", () => {
  assert.deepEqual(values(applyEdits(ramp(5), [{ op: "paste", at: 0.5, from: { start: 0, end: 0.2 } }])), [0, 1, 2, 3, 4, 0, 1]);
});

test("paste from before a cut: cut then paste moves the range", () => {
  // Cut 0.2 to 0.4 (frames 2, 3), then paste what was cut (from the sound after 0 edits) at the end.
  const a = applyEdits(ramp(6), [
    { op: "cut", start: 0.2, end: 0.4 },
    { op: "paste", at: 0.4, from: { start: 0.2, end: 0.4, after: 0 } },
  ]);
  assert.deepEqual(values(a), [0, 1, 4, 5, 2, 3]);
});

test("paste from an earlier sound survives edits in between", () => {
  const a = applyEdits(ramp(4), [
    { op: "gain", db: 0 },
    { op: "trim", start: 0, end: 0.2 },
    { op: "paste", at: 0.2, from: { start: 0.2, end: 0.4, after: 1 } },
  ]);
  assert.deepEqual(values(a), [0, 1, 2, 3]);
});

test("paste from an earlier stereo sound into mono takes a channel", () => {
  const a = applyEdits(ramp(2, 2), [{ op: "channels", to: 1 }, { op: "paste", at: 0, from: { start: 0, end: 0.1, after: 0 } }]);
  assert.equal(a.channels.length, 1);
  assert.deepEqual(values(a), [0, 50, 51]);
});

test("silence inserts zeros", () => {
  assert.deepEqual(values(applyEdits(ramp(3), [{ op: "silence", at: 0.1, length: 0.2 }])), [0, 0, 0, 1, 2]);
});

test("edits run in order, each on the result of the last", () => {
  const a = applyEdits(ramp(10), [
    { op: "trim", start: 0.2, end: 0.8 },
    { op: "cut", start: 0, end: 0.2 },
  ]);
  assert.deepEqual(values(a), [4, 5, 6, 7]);
});

test("times past the end are clamped", () => {
  assert.equal(frames(applyEdits(ramp(10), [{ op: "trim", start: 0.5, end: 99 }])), 5);
});

test("fade in ramps from silence over the range only", () => {
  const ones: Audio = { sampleRate: 10, channels: [new Float32Array(10).fill(1)] };
  const a = applyEdits(ones, [{ op: "fade", dir: "in", start: 0, end: 0.5 }]);
  assert.deepEqual(Array.from(a.channels[0]).map((x) => Math.round(x * 100)), [0, 25, 50, 75, 100, 100, 100, 100, 100, 100]);
});

test("fade out ends in silence", () => {
  const ones: Audio = { sampleRate: 10, channels: [new Float32Array(10).fill(1)] };
  const a = applyEdits(ones, [{ op: "fade", dir: "out", start: 0.5, end: 1, curve: "smooth" }]);
  assert.equal(a.channels[0][4], 1);
  assert.equal(a.channels[0][5], 1);
  assert.equal(a.channels[0][9], 0);
});

test("gain of -6 dB halves, near enough", () => {
  const a = applyEdits(ramp(10), [{ op: "gain", db: -6.0206 }]);
  assert.ok(Math.abs(a.channels[0][8] - 0.004) < 1e-6);
});

test("normalize brings the peak to the target", () => {
  const a = applyEdits(ramp(10, 2), [{ op: "normalize", peakDb: 0 }]);
  assert.ok(Math.abs(peak(a) - 1) < 1e-6);
});

test("normalize of silence changes nothing", () => {
  const quiet: Audio = { sampleRate: 10, channels: [new Float32Array(5)] };
  assert.equal(peak(applyEdits(quiet, [{ op: "normalize", peakDb: -1 }])), 0);
});

test("channels: stereo to mono averages, mono to stereo copies", () => {
  const mono = applyEdits(ramp(4, 2), [{ op: "channels", to: 1 }]);
  assert.equal(mono.channels.length, 1);
  assert.deepEqual(values(mono), [50, 51, 52, 53]);
  const stereo = applyEdits(mono, [{ op: "channels", to: 2 }]);
  assert.deepEqual(values(stereo, 1), [50, 51, 52, 53]);
});

test("the input is never changed", () => {
  const a = ramp(10);
  applyEdits(a, [{ op: "gain", db: 6 }, { op: "fade", dir: "in", start: 0, end: 1 }, { op: "cut", start: 0, end: 0.5 }]);
  assert.deepEqual(values(a), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("WAV round trip keeps rate, channels and samples to 16 bits", () => {
  const a = ramp(100, 2, 48000);
  const b = decodeWav(encodeWav(a));
  assert.equal(b.sampleRate, 48000);
  assert.equal(b.channels.length, 2);
  assert.equal(duration(b), duration(a));
  for (let i = 0; i < 100; i++) assert.ok(Math.abs(b.channels[1][i] - a.channels[1][i]) < 1 / 16384);
});

test("WAV clips samples past full scale", () => {
  const b = decodeWav(encodeWav({ sampleRate: 8000, channels: [Float32Array.from([2, -2])] }));
  assert.ok(b.channels[0][0] > 0.999 && b.channels[0][1] === -1);
});

test("documents round trip and reject what they are not", () => {
  const doc: SoundDoc = { edgewave: 1, source: { kind: "sfx", soundHash: 42 }, edits: [{ op: "gain", db: 1 }], render: { file: "42.wav" } };
  assert.deepEqual(parseDoc(formatDoc(doc)), doc);
  assert.throws(() => parseDoc("{}"), /Not an EDGEwave/);
  assert.throws(() => parseDoc('{"edgewave":1,"source":{"kind":"game"},"edits":[],"render":{"file":"x"}}'), /source/);
  assert.throws(() => parseDoc("nope"), /JSON/);
});

test("voice lines are found by their localization folder", () => {
  assert.ok(looksLikeVoice("base\\localization\\en-us\\vo\\judy_q000.wem"));
  assert.ok(looksLikeVoice("ep1\\localization\\common\\vo\\civ_mid.wem"));
  assert.ok(!looksLikeVoice("base\\sound\\music\\track.wem"));
});
