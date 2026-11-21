// Speaking one line with ElevenLabs' timings (src/speakLine.ts, EDGEwave #13): the text sent, which characters
// are spoken, kept takes and new ones, and character voices.

import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ElevenLabsError, type ElevenLabs } from "../src/elevenlabs";
import { characterKey, characterVoice, readCharacters, setCharacter, speakLine, spokenMask, textToSend, timingsOf } from "../src/speakLine";

test("textToSend: a delivery is a tag in front on v3; other models drop tags and the delivery, and say so", () => {
  assert.deepEqual(textToSend("Home.", "tired, quiet", "eleven_v3"), { sent: "[tired, quiet] Home.", notes: [] });
  assert.deepEqual(textToSend("[whispers] Home.", undefined, "eleven_v3").sent, "[whispers] Home.");
  const other = textToSend("[whispers] Home. [sighs]", "tired", "eleven_multilingual_v2");
  assert.equal(other.sent, "Home.");
  assert.equal(other.notes.length, 2);
});

test("spokenMask: an audio tag, brackets included, is not spoken; normalized only when it differs", () => {
  assert.deepEqual(spokenMask([..."[a] b"]), [false, false, false, true, true]);
  const a = { characters: [..."2 cats"], starts: [0, 0, 0, 0, 0, 0], ends: [0, 0, 0, 0, 0, 0] };
  assert.equal(timingsOf(a, a).normalized, undefined);
  const n = { characters: [..."two cats"], starts: Array(8).fill(0), ends: Array(8).fill(0) };
  assert.equal(timingsOf(a, n).normalized?.characters.join(""), "two cats");
});

test("speakLine: a take with its timings beside it; the same line again is the kept take, free; take new is another", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ewsl-"));
  const calls: { voice: string; text: string; model?: string; rate: number }[] = [];
  const api = {
    speakWithTimings: async (voice: string, o: { text: string; model?: string }, rate: number) => {
      calls.push({ voice, text: o.text, model: o.model, rate });
      if (rate === 48000) throw new ElevenLabsError(403, "Your subscription does not allow this output format", "output_format_not_allowed");
      const chars = [...o.text];
      return { pcm: new Uint8Array(rate / 10 * 2), alignment: { characters: chars, starts: chars.map((_, i) => i / 100), ends: chars.map((_, i) => (i + 1) / 100) } };
    },
  } as unknown as ElevenLabs;
  try {
    const o = { text: "Home. Something feels different.", delivery: "suspicious", speaker: "judy", voiceId: "jv", voiceName: "Judy's", api, dir };
    const first = await speakLine(o);
    assert.equal(first.cached, false);
    assert.equal(first.take, 1);
    assert.equal(first.model, "eleven_v3");
    assert.equal(first.sent, "[suspicious] Home. Something feels different.");
    assert.equal(first.characters, first.sent.length);
    assert.equal(first.seconds, 0.1);
    assert.equal(first.timings.spoken.indexOf(true), "[suspicious]".length);
    assert.equal(path.dirname(first.wav), path.join(dir, "judy"));
    assert.ok(fs.existsSync(first.timingsFile) && first.timingsFile === first.wav.replace(/wav$/, "timings.json"));
    assert.equal(fs.readFileSync(first.wav).readUInt32LE(24), 24000);

    const again = await speakLine(o);
    assert.equal(again.cached, true);
    assert.equal(again.characters, 0);
    assert.equal(again.wav, first.wav);
    assert.deepEqual(again.timings, first.timings);

    const next = await speakLine({ ...o, take: "new", rate: 24000 });
    assert.equal(next.take, 2);
    assert.equal(next.cached, false);
    assert.equal((await speakLine({ ...o, take: 1 })).wav, first.wav);
    assert.equal((await speakLine(o)).take, 2);
    // Another voice or model is another line.
    assert.equal((await speakLine({ ...o, model: "eleven_multilingual_v2", rate: 24000 })).take, 1);
    assert.equal(calls.filter((c) => c.rate === 24000).length, 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Character voices: one list by game voice tag; V's two by gender, the female one when none is asked", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ewch-"));
  const file = path.join(dir, "characters.json");
  try {
    assert.deepEqual(readCharacters(file), {});
    setCharacter(characterKey("Judy"), { id: "jv", name: "Judy's", how: "picked" }, file);
    setCharacter(characterKey("v", "female"), { id: "vf" }, file);
    setCharacter(characterKey("v", "male"), { id: "vm" }, file);
    assert.equal(characterVoice("judy", undefined, file)?.id, "jv");
    assert.equal(characterVoice("JUDY", undefined, file)?.name, "Judy's");
    assert.equal(characterVoice("v", undefined, file)?.id, "vf");
    assert.equal(characterVoice("v", "male", file)?.id, "vm");
    assert.equal(characterVoice("panam", undefined, file), undefined);
    setCharacter("judy", undefined, file);
    assert.equal(characterVoice("judy", undefined, file), undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ElevenLabs.design: a description and a sample text in, previews as WAVs out; no recording is sent", async () => {
  const http = await import("node:http");
  const seen: { path: string; format: string | null; body: Record<string, unknown>; type?: string }[] = [];
  const s = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const url = new URL(req.url!, "http://x");
      seen.push({ path: url.pathname, format: url.searchParams.get("output_format"), body: JSON.parse(Buffer.concat(chunks).toString()), type: req.headers["content-type"] });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ previews: [1, 2, 3].map((i) => ({ generated_voice_id: `g${i}`, audio_base_64: Buffer.alloc(4800).toString("base64"), duration_secs: 0.1 })), text: "…" }));
    });
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  try {
    const { ElevenLabs } = await import("../src/elevenlabs");
    const api = new ElevenLabs("k", `http://127.0.0.1:${(s.address() as import("node:net").AddressInfo).port}`);
    const previews = await api.design("A woman in her thirties, low and dry.", "Listen, I don't have all night.", 24000);
    assert.deepEqual(previews.map((p) => p.generatedVoiceId), ["g1", "g2", "g3"]);
    assert.equal(Buffer.from(previews[0].wav).toString("ascii", 0, 4), "RIFF");
    assert.deepEqual(seen[0], { path: "/v1/text-to-voice/design", format: "pcm_24000", body: { voice_description: "A woman in her thirties, low and dry.", text: "Listen, I don't have all night." }, type: "application/json" });
    await api.design("A man in his fifties.", undefined, 24000);
    assert.deepEqual(seen[1].body, { voice_description: "A man in his fifties.", auto_generate_text: true });
  } finally {
    s.close();
  }
});
