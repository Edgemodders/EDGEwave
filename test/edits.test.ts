// Unit tests for the edit chain and the WAV writer. `npm test` bundles and runs them with node --test.

import { test } from "node:test";
import * as assert from "node:assert/strict";
import { applyEdits, duration, frames, peak, type Audio } from "../src/audio/edits";
import { decodeWav, encodeWav } from "../src/audio/wav";
import { audible, Effects, mixEnd, onMix, Presets, presetEffects, tail } from "../src/audio/mix";
import { formatDoc, looksLikeVoice, newDoc, newTrack, nextTrackId, parseDoc } from "../src/doc";
import { RedmodTypes, silenced, soundFileFor, upsertCustomSound } from "../src/redmod";

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
  const doc = newDoc({ kind: "sfx", soundHash: 42 }, "42.wav");
  doc.tracks[0].edits.push({ op: "gain", db: 1 });
  doc.tracks.push({ ...newTrack(nextTrackId(doc), { kind: "game", path: "base\a.wem" }, true), offset: 0.5, effects: presetEffects("radio") });
  assert.deepEqual(parseDoc(formatDoc(doc)), doc);
  assert.equal(doc.tracks[1].id, "t2");
  assert.throws(() => parseDoc("{}"), /Not an EDGEwave/);
  assert.throws(() => parseDoc('{"edgewave":2,"tracks":[],"render":{"file":"x"}}'), /no tracks/);
  assert.throws(() => parseDoc('{"edgewave":2,"tracks":[{"id":"t1","source":{"kind":"game"},"edits":[]}],"render":{"file":"x"}}'), /source/);
  assert.throws(() => parseDoc("nope"), /JSON/);
});

test("an A1 document (version 1) opens as one track", () => {
  const v1 = { edgewave: 1, source: { kind: "game", path: "base\vo.wem" }, voice: true, edits: [{ op: "trim", start: 0, end: 1 }], loop: { start: 0, end: 0.5 }, render: { file: "vo.wav", sampleRate: 44100 } };
  const doc = parseDoc(JSON.stringify(v1));
  assert.equal(doc.edgewave, 2);
  assert.equal(doc.tracks.length, 1);
  assert.deepEqual(doc.tracks[0].source, v1.source);
  assert.deepEqual(doc.tracks[0].edits, v1.edits);
  assert.equal(doc.tracks[0].voice, true);
  assert.deepEqual(doc.loop, v1.loop);
  assert.deepEqual(doc.render, v1.render);
  assert.deepEqual(doc.master, { gain: 0, effects: [] });
});

test("mix: mute and solo choose the tracks heard", () => {
  const doc = newDoc({ kind: "sfx", soundHash: 1 }, "x.wav");
  doc.tracks.push(newTrack("t2", { kind: "sfx", soundHash: 2 }), newTrack("t3", { kind: "sfx", soundHash: 3 }));
  assert.deepEqual(audible(doc.tracks).map((t) => t.id), ["t1", "t2", "t3"]);
  doc.tracks[1].mute = true;
  assert.deepEqual(audible(doc.tracks).map((t) => t.id), ["t1", "t3"]);
  doc.tracks[2].solo = true;
  assert.deepEqual(audible(doc.tracks).map((t) => t.id), ["t3"]);
  // A muted solo does not count.
  doc.tracks[2].mute = true;
  assert.deepEqual(audible(doc.tracks).map((t) => t.id), ["t1"]);
});

test("mix: the end is the latest track's end, at its rate; reverbs add their tail", () => {
  const doc = newDoc({ kind: "sfx", soundHash: 1 }, "x.wav");
  doc.tracks.push({ ...newTrack("t2", { kind: "sfx", soundHash: 2 }), offset: 1.5, rate: 2 });
  const lengths = new Map([["t1", 2], ["t2", 2]]);
  assert.equal(mixEnd(doc, lengths), 2.5);
  assert.equal(onMix(doc.tracks[1], 2), 1);
  assert.equal(tail(doc), 0);
  doc.tracks[1].effects = presetEffects("pa");
  assert.equal(tail(doc), 1.4);
  doc.tracks[1].effects[3] = { ...doc.tracks[1].effects[3], bypass: true };
  assert.equal(tail(doc), 0);
});

test("presets are fresh copies, with every effect's parameters known", () => {
  const a = presetEffects("holocall");
  a[0] = { type: "lowpass", hz: 1, q: 1 };
  assert.notDeepEqual(presetEffects("holocall")[0], a[0]);
  for (const name of Object.keys(Presets)) {
    for (const e of presetEffects(name)) {
      for (const p of Effects[e.type].params) assert.equal(typeof (e as unknown as Record<string, number>)[p.key], "number", `${name}: ${e.type}.${p.key}`);
    }
  }
  for (const [type, spec] of Object.entries(Effects)) assert.equal(spec.make().type, type);
});

test("voice lines are found by their localization folder, or by their name", () => {
  assert.ok(looksLikeVoice("base\\localization\\en-us\\vo\\judy_q000.wem"));
  assert.ok(looksLikeVoice("ep1\\localization\\common\\vo\\civ_mid.wem"));
  assert.ok(looksLikeVoice("ep1\\localization\\en-us\\vo_holocall\\songbird_q301.wem"));
  assert.ok(looksLikeVoice("base\\localization\\common\\vo_helmet\\a.wem"));
  assert.ok(looksLikeVoice("base\\localization\\en-us\\vo_rewinded\\a.wem"));
  // A copy on disk, found by its name (the owner's A2 finding), and the game's _alt variants.
  assert.ok(looksLikeVoice("C:\\Users\\me\\Desktop\\civ_mid_m_83_jap_30_mt_ow_chats_f_2db31806b446a000.wav"));
  assert.ok(looksLikeVoice("songbird_q306_f_2cdf192dc6518000_alt2 .wem"));
  assert.ok(!looksLikeVoice("base\\sound\\music\\track.wem"));
  assert.ok(!looksLikeVoice("base\\sound\\soundbanks\\media\\1000720341.wem"));
  assert.ok(!looksLikeVoice("E:\\proj\\source\\raw\\sfx\\w_gun_shot\\1829305393887079760.wav"));
  assert.ok(!looksLikeVoice("base\\localization\\en-us\\subtitles\\judy_f_2db31806b446a0001.json"));
});

test("REDmod: a custom sound is added to info.json, keeping its other fields", () => {
  const text = upsertCustomSound(JSON.stringify({ name: "MyMod", version: "1.0", customSounds: [{ name: "other_event", type: "mod_skip" }] }), {
    name: "w_gun_pistol_fire",
    type: "mod_sfx_2d",
    file: soundFileFor("w_gun_pistol_fire"),
  });
  const info = JSON.parse(text);
  assert.equal(info.name, "MyMod");
  assert.deepEqual(info.customSounds, [
    { name: "other_event", type: "mod_skip" },
    { name: "w_gun_pistol_fire", type: "mod_sfx_2d", file: "w_gun_pistol_fire.wav", gain: 1, pitch: 0 },
  ]);
});

test("REDmod: the same event again replaces its entry; a skip has no file; gain and pitch stay 0 to 1", () => {
  let text = upsertCustomSound(undefined, { name: "Ev", type: "mod_sfx_room", file: "Ev.wav", gain: 3, pitch: -1 });
  assert.deepEqual(JSON.parse(text).customSounds, [{ name: "Ev", type: "mod_sfx_room", file: "Ev.wav", gain: 1, pitch: 0 }]);
  text = upsertCustomSound(text, { name: "ev", type: "mod_skip", file: "ignored.wav" });
  assert.deepEqual(JSON.parse(text).customSounds, [{ name: "ev", type: "mod_skip" }]);
  assert.throws(() => upsertCustomSound("not json", { name: "x", type: "mod_skip" }), /not valid JSON/);
  assert.equal(soundFileFor('a:b/c'), "a_b_c.wav");
});

test("REDmod: silence is the render with its samples zeroed, same format and length", () => {
  const wav = encodeWav({ sampleRate: 48000, channels: [Float32Array.from([0.5, -0.5, 0.25]), Float32Array.from([1, 0, -1])] });
  const s = silenced(wav);
  assert.equal(s.length, wav.length);
  assert.deepEqual(s.subarray(0, 44), wav.subarray(0, 44));
  const a = decodeWav(s);
  assert.equal(a.sampleRate, 48000);
  assert.equal(a.channels.length, 2);
  assert.equal(a.channels[0].length, 3);
  assert.ok(a.channels.every((c) => c.every((x) => x === 0)));
  assert.ok(decodeWav(wav).channels[0][0] !== 0, "the render itself is untouched");
  assert.throws(() => silenced(new Uint8Array(12)), /Not a WAV/);
});

test("REDmod: every type but mod_skip is offered, once", () => {
  const types = RedmodTypes.map((t) => t.type);
  assert.equal(new Set(types).size, types.length);
  assert.ok(!types.includes("mod_skip" as never));
  assert.ok(types.includes("mod_sfx_2d") && types.includes("mod_sfx_occlusion"));
});
