// Unit tests for Voice a quest (src/voice.ts, src/voiceBatch.ts): names, status, what is spoken, the
// record, and a batch against a stand-in ElevenLabs on localhost, in a temporary folder.

import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { ElevenLabs } from "../src/elevenlabs";
import { checkLines, hexId, lineStatus, missingVoices, newRecord, readRecord, spoken, takeName, toVoice, withTake, wemPath, type VoiceLine } from "../src/voice";
import { keepTake, loadRecord, voiceBatch } from "../src/voiceBatch";

const v: VoiceLine = { id: "1234567890123456789", scene: "at_the_door", speaker: "V", text: "Open up." };
const judy: VoiceLine = { id: "42", scene: "at_the_door", speaker: "Judy", text: "You came back.", say: "[softly] You... came back.", direction: "Quiet, surprised." };

test("names: the id in 16 hex digits, and the game's voice file name", () => {
  assert.equal(hexId("1234567890123456789"), "112210f47de98115");
  assert.equal(hexId("42"), "000000000000002a");
  assert.throws(() => hexId("0x2a"), /decimal/);
  assert.equal(takeName(v, "My Quest", "female"), "v_my_quest_f_112210f47de98115");
  assert.equal(takeName(judy, "my_quest", "male"), "judy_my_quest_m_000000000000002a");
  assert.equal(wemPath("mod/author/my_quest/vo/", "v_x_f_1"), "mod\\author\\my_quest\\vo\\v_x_f_1.wem");
});

test("spoken: v3 gets say with its tags, other models without them, no say gives the text", () => {
  assert.equal(spoken(judy, "eleven_v3"), "[softly] You... came back.");
  assert.equal(spoken(judy, "eleven_multilingual_v2"), "You... came back.");
  assert.equal(spoken({ ...judy, say: "[sighs] [laughs]" }, "eleven_turbo_v2_5"), "You came back.");
  assert.equal(spoken({ ...judy, say: "Well [pause], fine [laughs]." }, "eleven_flash_v2_5"), "Well, fine.");
  assert.equal(spoken(v, "eleven_v3"), "Open up.");
});

test("status: none, made, stale on any of text, say and direction; V needs both takes", () => {
  let r = newRecord("q");
  assert.equal(lineStatus(v, r), "none");
  r = withTake(r, v, { text: v.text, female: "a.wav" });
  assert.equal(lineStatus(v, r), "stale", "V's male take is missing");
  r = withTake(r, v, { text: v.text, female: "a.wav", male: "b.wav" });
  assert.equal(lineStatus(v, r), "made");
  r = withTake(r, judy, { text: judy.text, say: judy.say, direction: judy.direction, female: "j.wav" });
  assert.equal(lineStatus(judy, r), "made");
  assert.equal(lineStatus({ ...judy, direction: "Loud." }, r), "stale");
  assert.equal(lineStatus({ ...judy, say: undefined }, r), "stale");
  assert.equal(lineStatus({ ...judy, text: "Hi." }, r), "stale");
  assert.deepEqual(toVoice([v, judy, { ...judy, id: "7" }], r).map((l) => l.id), ["7"]);
  assert.equal(toVoice([v, judy], r, true).length, 2);
});

test("record: a new take keeps the one before as previous; voices; reading checks", () => {
  let r = withTake(newRecord("q"), judy, { text: "old", female: "j.wav" });
  r = withTake(r, judy, { text: judy.text, female: "j.wav" });
  assert.equal(r.lines[judy.id].previous?.text, "old");
  assert.ok(!("previous" in r.lines[judy.id].previous!), "only one take back");
  assert.deepEqual(missingVoices([v, judy], { V: { female: "f" }, judy: "j" }), ["V (male)"]);
  assert.deepEqual(missingVoices([v, judy], { V: { female: "f", male: "m" }, Judy: "j" }), []);
  assert.equal(readRecord(undefined, "q").quest, "q");
  assert.throws(() => readRecord("{}", "q"), /not EDGEwave's/);
  assert.throws(() => checkLines([{ id: "1", scene: "s", speaker: "V" }]), /no text/);
  assert.throws(() => checkLines([]), /No lines/);
});

test("keepTake: writes the WAV, moves the one it replaces to .previous.wav, keeps the other gender", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ew-"));
  try {
    let r = keepTake(dir, newRecord("q"), v, { female: new Uint8Array([1]), male: new Uint8Array([2]) }, { model: "m" });
    assert.equal(r.lines[v.id].female, "source/raw/edgewave/voice/q/v_q_f_112210f47de98115.wav");
    r = keepTake(dir, r, { ...v, text: "Open the door." }, { female: new Uint8Array([3]) }, { model: "recording" });
    const line = r.lines[v.id];
    assert.equal(line.text, "Open the door.");
    assert.equal(line.male, "source/raw/edgewave/voice/q/v_q_m_112210f47de98115.wav");
    assert.equal(line.previous?.female, "source/raw/edgewave/voice/q/v_q_f_112210f47de98115.previous.wav");
    assert.deepEqual([...fs.readFileSync(path.join(dir, line.female!))], [3]);
    assert.deepEqual([...fs.readFileSync(path.join(dir, line.previous!.female!))], [1]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("voiceBatch: speaks each take in its voice and model, saves voice.json, falls back to 24 kHz, skips voiced lines", async () => {
  const seen: { voice: string; body: { text: string; model_id?: string }; format: string | null }[] = [];
  const s = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url!, "http://x");
      const format = url.searchParams.get("output_format");
      seen.push({ voice: url.pathname.split("/").pop()!, body: JSON.parse(Buffer.concat(chunks).toString()), format });
      if (format === "pcm_48000") {
        res.statusCode = 403;
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify({ detail: { status: "output_format_not_allowed", message: "Your subscription does not allow this output format" } }));
      }
      res.end(Buffer.alloc(480));
    });
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ew-"));
  try {
    const api = new ElevenLabs("k", `http://127.0.0.1:${(s.address() as AddressInfo).port}`);
    const voices = { V: { female: "vf", male: "vm" }, Judy: "jv" };
    await assert.rejects(voiceBatch({ projectDir: dir, quest: "q", lines: [v, judy], api }), /No voice chosen for V \(female\), V \(male\), Judy/);
    const r = await voiceBatch({ projectDir: dir, quest: "q", lines: [v, judy], voices, api });
    assert.deepEqual(r.voiced, [v.id, judy.id]);
    assert.equal(r.rate, 24000);
    assert.equal(r.model, "eleven_v3");
    assert.equal(r.characters, "Open up.".length * 2 + judy.say!.length);
    assert.deepEqual(seen.filter((x) => x.format === "pcm_24000").map((x) => [x.voice, x.body.text, x.body.model_id]), [
      ["vf", "Open up.", "eleven_v3"],
      ["vm", "Open up.", "eleven_v3"],
      ["jv", "[softly] You... came back.", "eleven_v3"],
    ]);
    const saved = loadRecord(dir, "q");
    assert.deepEqual(saved.voices, voices);
    assert.equal(lineStatus(v, saved), "made");
    assert.equal(lineStatus(judy, saved), "made");
    const wav = fs.readFileSync(path.join(dir, saved.lines[judy.id].female!));
    assert.equal(wav.toString("ascii", 0, 4), "RIFF");
    assert.equal(wav.readUInt32LE(24), 24000);
    // Voiced lines are skipped; voices come from voice.json; one line with redo is redone.
    const again = await voiceBatch({ projectDir: dir, quest: "q", lines: [v, judy], api, rate: 24000 });
    assert.deepEqual(again.voiced, []);
    const one = await voiceBatch({ projectDir: dir, quest: "q", lines: [judy], redo: true, api, rate: 24000, model: "eleven_multilingual_v2" });
    assert.deepEqual(one.voiced, [judy.id]);
    assert.equal(seen.at(-1)!.body.text, "You... came back.");
    assert.ok(loadRecord(dir, "q").lines[judy.id].previous);
  } finally {
    s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
