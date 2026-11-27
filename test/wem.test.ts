// The .wem step (V2 step 5): resampling to the game's rate, finding Wwise 2023.1.14, the source list and
// WwiseConsole's problems, and a quest's takes made .wem files with a stand-in WwiseConsole, kept in
// voice.json and made again when a take changes. The last test runs the real Wwise 2023.1.14, only with
// EDGEWAVE_REAL_WWISE=1 (it is not on GitHub's runners): npm test with it set, on a PC with Wwise.

import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { decodeWav, encodeWav } from "../src/audio/wav";
import { resample, toMono } from "../src/audio/resample";
import { frames } from "../src/audio/edits";
import { newRecord, type VoiceLine } from "../src/voice";
import { keepTake, loadRecord, restorePrevious, saveRecord } from "../src/voiceBatch";
import { makeWems, staleWems, wemFile, wemState } from "../src/voiceWem";
import { asVoiceWav, consoleIn, findWwise, problems, sourcesList, versionOf, type Run } from "../src/wwise";

function scratch(): { dir: string; done: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eww-"));
  return { dir, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const tone = (rate: number, seconds: number, hz = 440, channels = 1) => ({
  sampleRate: rate,
  channels: Array.from({ length: channels }, () => Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / rate))),
});

test("resample: 24 kHz to 48 kHz keeps the length, a constant and a tone", () => {
  const a = tone(24000, 0.5);
  const b = resample(a, 48000);
  assert.equal(b.sampleRate, 48000);
  assert.equal(frames(b), 24000);
  // Away from the edges, the 440 Hz tone at 48 kHz matches the true one closely.
  let worst = 0;
  for (let i = 2000; i < 22000; i++) worst = Math.max(worst, Math.abs(b.channels[0][i] - 0.5 * Math.sin((2 * Math.PI * 440 * i) / 48000)));
  assert.ok(worst < 0.01, `worst error ${worst}`);
  const flat = resample({ sampleRate: 22050, channels: [new Float32Array(2205).fill(0.25)] }, 48000);
  for (let i = 0; i < frames(flat); i++) assert.ok(Math.abs(flat.channels[0][i] - 0.25) < 1e-5);
  assert.equal(resample(a, 24000), a);
});

test("resample: going down does not alias a tone above the new Nyquist", () => {
  // 20 kHz at 48 kHz, down to 24 kHz (Nyquist 12 kHz): it should mostly vanish, not fold to 4 kHz.
  const b = resample(tone(48000, 0.2, 20000), 24000);
  let rms = 0;
  for (let i = 500; i < frames(b) - 500; i++) rms += b.channels[0][i] ** 2;
  rms = Math.sqrt(rms / (frames(b) - 1000));
  assert.ok(rms < 0.02, `rms ${rms}`);
});

test("toMono averages the channels; asVoiceWav makes mono 48 kHz 16-bit", () => {
  const st = { sampleRate: 24000, channels: [new Float32Array([0.5, 0.5]), new Float32Array([0.1, -0.5])] };
  assert.deepEqual([...toMono(st).channels[0]].map((x) => Math.round(x * 100) / 100), [0.3, 0]);
  const wav = asVoiceWav(encodeWav(tone(24000, 0.1, 440, 2)));
  const back = decodeWav(wav);
  assert.equal(back.sampleRate, 48000);
  assert.equal(back.channels.length, 1);
  assert.equal(frames(back), 4800);
});

test("findWwise: 2023.1.14 under the Launcher's folders, the latest build; the setting first; off", () => {
  const files = new Set([
    consoleIn("C:\\Audiokinetic\\Wwise_2023.1.14.8770"),
    consoleIn("C:\\Audiokinetic\\Wwise2025.1.7.9143"),
    consoleIn("D:\\Audiokinetic\\Wwise2023.1.14.9001"),
    consoleIn("E:\\Wwise"),
  ]);
  const dirs: Record<string, string[]> = { "C:\\Audiokinetic": ["Wwise_2023.1.14.8770", "Wwise2025.1.7.9143", "Launcher"], "D:\\Audiokinetic": ["Wwise2023.1.14.9001"] };
  const o = { exists: (p: string) => files.has(p), list: (d: string) => dirs[d] ?? [] };
  assert.deepEqual(findWwise({ ...o, roots: ["C:\\Audiokinetic"] }), { exe: consoleIn("C:\\Audiokinetic\\Wwise_2023.1.14.8770"), version: "2023.1.14.8770" });
  assert.equal(findWwise({ ...o, roots: ["C:\\Audiokinetic", "D:\\Audiokinetic"] })?.version, "2023.1.14.9001");
  assert.equal(findWwise({ ...o, roots: ["X:\\none"] }), undefined);
  // Only 2025 installed: not used unless configured.
  assert.equal(findWwise({ exists: o.exists, list: () => ["Wwise2025.1.7.9143"], roots: ["C:\\Audiokinetic"] }), undefined);
  assert.equal(findWwise({ ...o, configured: "C:\\Audiokinetic\\Wwise2025.1.7.9143" })?.version, "2025.1.7.9143");
  assert.deepEqual(findWwise({ ...o, configured: consoleIn("E:\\Wwise") }), { exe: consoleIn("E:\\Wwise"), version: undefined });
  assert.equal(findWwise({ ...o, configured: "off", roots: ["C:\\Audiokinetic"] }), undefined);
  assert.equal(versionOf("Wwise_2023.1.14.8770"), "2023.1.14.8770");
  assert.equal(versionOf("Launcher"), undefined);
});

test("sourcesList escapes paths; problems reads WwiseConsole's tab-separated lines", () => {
  const xml = sourcesList("C:\\a & b", [{ wav: "s0.wav", wem: "s0.wem" }]);
  assert.match(xml, /Root="C:\\a &amp; b"/);
  assert.match(xml, /<Source Path="s0.wav" Conversion="Vorbis Quality High" Destination="s0.wem"\/>/);
  const p = problems("Some banner\nConversion\tError\tMissingOriginalFile\tExternal source file is missing\tWindows\tmissing.wav\nDone\n");
  assert.deepEqual(p, [{ level: "Error", message: "External source file is missing", file: "missing.wav" }]);
});

/** A stand-in WwiseConsole: makes the project, and a .wem per source (its WAV's bytes, after a header). */
function fakeWwise(calls: string[][], refuse = new Set<string>()): Run {
  return async (_exe, args) => {
    calls.push(args);
    if (args[0] === "create-new-project") {
      fs.mkdirSync(path.dirname(args[1]), { recursive: true });
      fs.writeFileSync(args[1], "<wproj/>");
      return { code: 0, output: "" };
    }
    const list = fs.readFileSync(args[args.indexOf("--source-file") + 1], "utf8");
    const root = /Root="([^"]+)"/.exec(list)![1];
    const out = path.join(args[args.indexOf("--output") + 1], "Windows");
    fs.mkdirSync(out, { recursive: true });
    let output = "";
    for (const m of list.matchAll(/Path="([^"]+)"[^>]*Destination="([^"]+)"/g)) {
      const wav = fs.readFileSync(path.join(root, m[1]));
      if (refuse.has(m[1])) {
        output += `Conversion\tError\tBad\tWwise refused it\tWindows\t${m[1]}\n`;
        continue;
      }
      fs.writeFileSync(path.join(out, m[2]), Buffer.concat([Buffer.from("WEM!"), wav]));
    }
    return { code: output ? 1 : 0, output };
  };
}

const lineV: VoiceLine = { id: "1234567890123", scene: "arrival", speaker: "V", text: "Here it is." };
const lineJ: VoiceLine = { id: "77", scene: "arrival", speaker: "Judy", text: "Took you long enough." };

function quest(dir: string, archiveDir?: string) {
  let r = { ...newRecord("eq_test"), ...(archiveDir ? { archiveDir } : {}) };
  r = keepTake(dir, r, lineV, { female: encodeWav(tone(48000, 0.2)), male: encodeWav(tone(24000, 0.2, 330)) }, { model: "m" });
  r = keepTake(dir, r, lineJ, { female: encodeWav(tone(48000, 0.1, 550)) }, { model: "m" });
  saveRecord(dir, r);
  return r;
}

test("makeWems: every take to a .wem under the archive folder, recorded; nothing again until a take changes", async () => {
  const s = scratch();
  try {
    const project = path.join(s.dir, "proj");
    const home = path.join(s.dir, "home");
    quest(project, "mod\\me\\eq_test\\vo");
    const calls: string[][] = [];
    const wwise = { exe: "WwiseConsole.exe", version: "2023.1.14.8770" };
    const r = await makeWems({ projectDir: project, quest: "eq_test", wwise, exec: fakeWwise(calls), home });
    assert.equal(r.converted, 3);
    assert.deepEqual(r.failed, []);
    assert.equal(r.made, 3);
    assert.equal(r.takes, 3);
    const rec = loadRecord(project, "eq_test");
    const f = rec.lines[lineV.id].wem!.female!;
    assert.equal(f, "mod\\me\\eq_test\\vo\\v_eq_test_f_0000011f71fb04cb.wem");
    assert.equal(rec.lines[lineV.id].wem!.male, "mod\\me\\eq_test\\vo\\v_eq_test_m_0000011f71fb04cb.wem");
    assert.equal(rec.lines[lineJ.id].wem!.female, "mod\\me\\eq_test\\vo\\judy_eq_test_f_000000000000004d.wem");
    const made = fs.readFileSync(wemFile(project, f));
    assert.equal(made.subarray(0, 4).toString(), "WEM!");
    // What Wwise was given: mono 48 kHz, also for the 24 kHz male take.
    const male = decodeWav(fs.readFileSync(wemFile(project, rec.lines[lineV.id].wem!.male!)).subarray(4));
    assert.equal(male.sampleRate, 48000);
    assert.equal(calls[0][0], "create-new-project");
    assert.ok(calls[1].includes("--no-wwise-dat"));
    assert.ok(fs.existsSync(path.join(home, "wwise", "2023.1.14.8770", "EDGEwave", "EDGEwave.wproj")));
    assert.deepEqual(fs.readdirSync(path.join(home, "wwise", "work")), [], "the work folder is cleared");

    // Nothing stale: no Wwise run.
    const again = await makeWems({ projectDir: project, quest: "eq_test", wwise, exec: fakeWwise(calls), home });
    assert.equal(again.converted, 0);
    assert.equal(calls.length, 2);

    // A studio render changes Judy's take: only it is made again.
    fs.writeFileSync(path.join(project, rec.lines[lineJ.id].female!), encodeWav(tone(48000, 0.15, 600)));
    assert.deepEqual(staleWems(project, loadRecord(project, "eq_test")).map((t) => t.id), [lineJ.id]);
    const third = await makeWems({ projectDir: project, quest: "eq_test", wwise, exec: fakeWwise(calls), home });
    assert.equal(third.converted, 1);
    assert.equal((calls.at(-1)!.join(" ").match(/source-file/g) ?? []).length, 1);

    // A new take drops the line's .wem fields (the previous take has none); the next run makes it again.
    let r2 = keepTake(project, loadRecord(project, "eq_test"), lineJ, { female: encodeWav(tone(48000, 0.1, 700)) }, { model: "recording" });
    assert.equal(r2.lines[lineJ.id].wem, undefined);
    assert.equal(r2.lines[lineJ.id].previous?.wem, undefined);
    saveRecord(project, r2);
    assert.equal((await makeWems({ projectDir: project, quest: "eq_test", wwise, exec: fakeWwise(calls), home })).converted, 1);

    // Previous swaps the WAVs: the .wem is made from the take now current.
    r2 = restorePrevious(project, loadRecord(project, "eq_test"), lineJ);
    assert.equal(r2.lines[lineJ.id].wem, undefined);
    saveRecord(project, r2);
    const back = await makeWems({ projectDir: project, quest: "eq_test", wwise, exec: fakeWwise(calls), home });
    assert.equal(back.converted, 1);
    const wavNow = fs.readFileSync(path.join(project, back.record.lines[lineJ.id].female!));
    const wemNow = fs.readFileSync(wemFile(project, back.record.lines[lineJ.id].wem!.female!));
    assert.deepEqual(decodeWav(wemNow.subarray(4)).channels[0].length, decodeWav(wavNow).channels[0].length);
  } finally {
    s.done();
  }
});

test("makeWems: a take Wwise refuses is reported, the others are made; no archive folder or no Wwise says why", async () => {
  const s = scratch();
  try {
    const project = path.join(s.dir, "proj");
    quest(project, "mod\\me\\eq_test\\vo");
    const calls: string[][] = [];
    const r = await makeWems({ projectDir: project, quest: "eq_test", wwise: { exe: "x", version: "2025.1.7.9143" }, exec: fakeWwise(calls, new Set(["s1.wav"])), home: path.join(s.dir, "home") });
    assert.equal(r.converted, 2);
    assert.equal(r.failed.length, 1);
    assert.equal(r.failed[0].message, "Wwise refused it");
    assert.ok(!calls[1].includes("--no-wwise-dat"), "2025 refuses --no-wwise-dat");

    const p2 = path.join(s.dir, "p2");
    quest(p2);
    assert.match(wemState(p2, loadRecord(p2, "eq_test"), { exe: "x" }).reason!, /No archive folder/);
    assert.equal((await makeWems({ projectDir: p2, quest: "eq_test", wwise: { exe: "x" }, exec: fakeWwise([]) })).converted, 0);
    const none = wemState(project, loadRecord(project, "eq_test"), undefined);
    assert.match(none.reason!, /Wwise 2023\.1\.14 was not found/);
  } finally {
    s.done();
  }
});

test("the real Wwise 2023.1.14: a 24 kHz and a 48 kHz take become Wwise Vorbis, mono, 48 kHz", { skip: process.env.EDGEWAVE_REAL_WWISE !== "1" && "set EDGEWAVE_REAL_WWISE=1 on a PC with Wwise" }, async () => {
  const wwise = findWwise();
  assert.ok(wwise, "Wwise 2023.1.14 is not installed");
  const s = scratch();
  try {
    const project = path.join(s.dir, "proj");
    quest(project, "mod\\me\\eq_test\\vo");
    const started = Date.now();
    const r = await makeWems({ projectDir: project, quest: "eq_test", wwise, home: path.join(s.dir, "home") });
    assert.deepEqual(r.failed, []);
    assert.equal(r.converted, 3);
    for (const line of Object.values(r.record.lines))
      for (const g of ["female", "male"] as const) {
        if (!line.wem?.[g]) continue;
        const b = fs.readFileSync(wemFile(project, line.wem[g]!));
        assert.equal(b.subarray(0, 4).toString(), "RIFF");
        assert.equal(b.subarray(8, 12).toString(), "WAVE");
        assert.equal(b.readUInt16LE(20), 0xffff, "Wwise Vorbis");
        assert.equal(b.readUInt16LE(22), 1, "mono");
        assert.equal(b.readUInt32LE(24), 48000, "48 kHz");
      }
    console.log(`real Wwise ${wwise.version}: 3 .wem in ${Date.now() - started} ms, project made the first time`);
  } finally {
    s.done();
  }
});
