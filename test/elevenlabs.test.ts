// Unit tests for the ElevenLabs client (src/elevenlabs.ts), against a stand-in server on localhost:
// the paths, the key header, the PCM output format, the bodies, and errors as a modder reads them.

import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { decodeWav } from "../src/audio/wav";
import { ElevenLabs, ElevenLabsError, errorText, formatRefused, keyRefused, pcmToWav, slug } from "../src/elevenlabs";

interface Seen {
  method: string;
  url: URL;
  key?: string;
  type?: string;
  body: string;
}

/** A stand-in server: answers with reply(seen), records every request. */
async function server(reply: (s: Seen) => { status?: number; json?: unknown; bytes?: Uint8Array }) {
  const seen: Seen[] = [];
  const s = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const r: Seen = { method: req.method!, url: new URL(req.url!, "http://x"), key: req.headers["xi-api-key"] as string, type: req.headers["content-type"], body: Buffer.concat(chunks).toString("latin1") };
      seen.push(r);
      const a = reply(r);
      res.statusCode = a.status ?? 200;
      if (a.json !== undefined) {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(a.json));
      } else res.end(Buffer.from(a.bytes ?? new Uint8Array()));
    });
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  return { base, seen, close: () => new Promise<void>((r) => s.close(() => r())) };
}

/** Raw 16-bit PCM: n samples of a value. */
const pcm = (n: number, v = 1000) => {
  const b = new Uint8Array(n * 2);
  const d = new DataView(b.buffer);
  for (let i = 0; i < n; i++) d.setInt16(i * 2, v, true);
  return b;
};

test("ElevenLabs: a sound effect asks for PCM at the rate, with the key, and clamps its length", async () => {
  const s = await server(() => ({ bytes: pcm(4) }));
  try {
    const out = await new ElevenLabs("k1", s.base).soundEffect({ text: "door slam", seconds: 45, loop: true, influence: 2 }, 48000);
    assert.equal(out.length, 8);
    const r = s.seen[0];
    assert.equal(r.method, "POST");
    assert.equal(r.url.pathname, "/v1/sound-generation");
    assert.equal(r.url.searchParams.get("output_format"), "pcm_48000");
    assert.equal(r.key, "k1");
    assert.deepEqual(JSON.parse(r.body), { text: "door slam", duration_seconds: 30, loop: true, prompt_influence: 1 });
  } finally {
    await s.close();
  }
});

test("ElevenLabs: speech, speech-to-speech and a clone send what each endpoint takes", async () => {
  const s = await server((r) => (r.url.pathname === "/v1/voices/add" ? { json: { voice_id: "clone1", requires_verification: false } } : { bytes: pcm(2) }));
  try {
    const api = new ElevenLabs("k", s.base);
    await api.speak("v 1", { text: "Wake up, samurai.", model: "eleven_multilingual_v2" }, 24000);
    await api.speechToSpeech("v1", new Uint8Array([82, 73, 70, 70]), { model: "eleven_multilingual_sts_v2" }, 24000);
    assert.equal(await api.cloneVoice("EDGEwave judy", new Uint8Array([1, 2, 3])), "clone1");
    const [tts, sts, add] = s.seen;
    assert.equal(tts.url.pathname, "/v1/text-to-speech/v%201");
    assert.deepEqual(JSON.parse(tts.body), { text: "Wake up, samurai.", model_id: "eleven_multilingual_v2" });
    assert.equal(sts.url.pathname, "/v1/speech-to-speech/v1");
    assert.equal(sts.url.searchParams.get("output_format"), "pcm_24000");
    assert.match(sts.type ?? "", /^multipart\/form-data/);
    assert.match(sts.body, /name="audio"; filename="line.wav"/);
    assert.match(sts.body, /name="model_id"\r\n\r\neleven_multilingual_sts_v2/);
    assert.equal(add.url.pathname, "/v1/voices/add");
    assert.match(add.body, /name="name"\r\n\r\nEDGEwave judy/);
    assert.match(add.body, /name="files"; filename="sample.wav"/);
  } finally {
    await s.close();
  }
});

test("ElevenLabs: voices page through, and a remix's previews become WAVs", async () => {
  const s = await server((r) => {
    if (r.url.pathname === "/v2/voices") {
      const second = r.url.searchParams.get("next_page_token") === "p2";
      return { json: second ? { voices: [{ voice_id: "b", name: "Bea" }], has_more: false } : { voices: [{ voice_id: "a", name: "Al", labels: { gender: "male" }, preview_url: "http://p/a.mp3" }], has_more: true, next_page_token: "p2" } };
    }
    if (r.url.pathname === "/v1/text-to-voice/clone1/remix") return { json: { previews: [{ generated_voice_id: "g1", audio_base_64: Buffer.from(pcm(3)).toString("base64"), media_type: "audio/pcm", duration_secs: 0.1 }], text: "…" } };
    if (r.url.pathname === "/v1/text-to-voice") return { json: { voice_id: "saved1" } };
    return { status: 404, json: { detail: "no" } };
  });
  try {
    const api = new ElevenLabs("k", s.base);
    const v = await api.voices();
    assert.deepEqual(v.map((x) => x.id), ["a", "b"]);
    assert.equal(v[0].previewUrl, "http://p/a.mp3");
    assert.equal(v[0].labels.gender, "male");
    const p = await api.remix("clone1", "female, calm", 22050);
    assert.equal(p[0].generatedVoiceId, "g1");
    const a = decodeWav(p[0].wav);
    assert.equal(a.sampleRate, 22050);
    assert.equal(a.channels[0].length, 3);
    assert.deepEqual(JSON.parse(s.seen[2].body), { voice_description: "female, calm", auto_generate_text: true });
    assert.equal(await api.saveRemix("g1", "EDGEwave x", "female, calm"), "saved1");
    assert.deepEqual(JSON.parse(s.seen[3].body), { voice_name: "EDGEwave x", voice_description: "female, calm", generated_voice_id: "g1" });
  } finally {
    await s.close();
  }
});

test("ElevenLabs: errors read as their message; a refused output format is told apart", async () => {
  const s = await server(() => ({ status: 403, json: { detail: { status: "output_format_not_allowed", message: "pcm_44100 needs the Pro tier" } } }));
  try {
    await assert.rejects(new ElevenLabs("k", s.base).speak("v", { text: "x" }, 44100), (e: unknown) => {
      assert.ok(e instanceof ElevenLabsError);
      assert.equal(e.status, 403);
      assert.equal(e.message, "pcm_44100 needs the Pro tier");
      assert.ok(formatRefused(e));
      return true;
    });
  } finally {
    await s.close();
  }
  assert.equal(errorText(401, JSON.stringify({ detail: { status: "invalid_api_key", message: "Invalid API key" } })).message, "Invalid API key");
  assert.equal(errorText(422, JSON.stringify({ detail: [{ loc: ["body", "text"], msg: "field required", type: "missing" }] })).message, "field required");
  assert.equal(errorText(500, "Bad gateway").message, "Bad gateway");
  assert.ok(!formatRefused(new ElevenLabsError(401, "Invalid API key", "invalid_api_key")));
  assert.ok(!formatRefused(new Error("output_format")));
});

test("ElevenLabs: PCM becomes a mono WAV; file names from prompts", () => {
  const a = decodeWav(pcmToWav(pcm(5, -16384), 48000));
  assert.equal(a.sampleRate, 48000);
  assert.equal(a.channels.length, 1);
  assert.equal(a.channels[0].length, 5);
  assert.ok(Math.abs(a.channels[0][0] + 0.5) < 1e-3);
  assert.equal(slug("A heavy metal door slams, in a concrete corridor!"), "a-heavy-metal-door-slams-in-a");
  assert.equal(slug("¡Olé! Café"), "ole-cafe");
  assert.equal(slug("…"), "sound");
});

test("ElevenLabs: a refused key is told apart from a used-up quota and a refused format", () => {
  assert.ok(keyRefused(new ElevenLabsError(401, "Invalid API key", "invalid_api_key")));
  assert.ok(keyRefused(new ElevenLabsError(401, "No ElevenLabs API key is set yet.", "missing_api_key")));
  assert.ok(keyRefused(new ElevenLabsError(401, "The API key is missing the permission voices_read", "missing_permissions")));
  assert.ok(!keyRefused(new ElevenLabsError(401, "This request exceeds your quota of 10000", "quota_exceeded")));
  assert.ok(!keyRefused(new ElevenLabsError(403, "pcm_44100 needs the Pro tier", "output_format_not_allowed")));
  assert.ok(!keyRefused(new ElevenLabsError(500, "Server error")));
  assert.ok(!keyRefused(new Error("Invalid API key")));
});
