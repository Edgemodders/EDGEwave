// Unit tests for EDGEwave Voice, the REDnode package (src/voicePackage): voice names, the cache, voices.json,
// and the engine with stand-ins for REDnode's secrets and audio and for ElevenLabs on localhost.

import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { voiceName, voicesConfig } from "../src/voicePackage/config";
import { CacheDir, cacheName, createVoice, KeySecret, pruneCache, resolveVoice, VoicesFile, type VoicesConfig } from "../src/voicePackage/core";

const Judy = "AbCdEfGhIjKlMnOpQrSt";
const config: VoicesConfig = { edgewave: "voices", version: 1, provider: "elevenlabs", default: "judy", voices: { judy: { id: Judy, label: "EDGEwave judy_q003" }, viktor: { id: "VvVvVvVvVvVvVvVvVvVv", model: "eleven_v3" } } };

test("EDGEwave Voice: a voice by its name, an ElevenLabs id, or the default", () => {
  assert.deepEqual(resolveVoice(config, "JUDY"), { name: "judy", id: Judy, model: undefined });
  assert.equal(resolveVoice(config, "viktor").model, "eleven_v3");
  assert.equal(resolveVoice(config, undefined).name, "judy");
  assert.equal(resolveVoice(config, "ZzZzZzZzZzZzZzZzZzZz").id, "ZzZzZzZzZzZzZzZzZzZz");
  assert.throws(() => resolveVoice(config, "panam"), /No voice named panam\. The names set up: judy, viktor/);
  assert.throws(() => resolveVoice(undefined, undefined), /none set up/);
});

test("EDGEwave Voice: the cache's name follows the voice, model and text; the oldest go first", () => {
  assert.equal(cacheName(Judy, "m", "Hey."), cacheName(Judy, "m", "Hey."));
  assert.notEqual(cacheName(Judy, "m", "Hey."), cacheName(Judy, "m", "Hey!"));
  assert.notEqual(cacheName(Judy, "m", "Hey."), cacheName(Judy, "n", "Hey."));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ewv-"));
  try {
    for (const [i, f] of ["a.wav", "b.wav", "c.wav"].entries()) {
      fs.writeFileSync(path.join(dir, f), new Uint8Array(100));
      fs.utimesSync(path.join(dir, f), new Date(1000 * (i + 1)), new Date(1000 * (i + 1)));
    }
    assert.equal(pruneCache(dir, 250), 1);
    assert.deepEqual(fs.readdirSync(dir).sort(), ["b.wav", "c.wav"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("EDGEwave Voice: voices.json keeps a voice's name and the default, and names new ones", () => {
  assert.equal(voiceName("Judy Alvarez (clone)", new Set()), "judy_alvarez");
  assert.equal(voiceName("EDGEwave judy_q003_f_1a2b", new Set()), "edgewave_judy_q003_f_1a2b");
  assert.equal(voiceName("Rachel", new Set(["rachel"])), "rachel_2");
  assert.equal(voiceName("???", new Set()), "voice");
  const c = voicesConfig(config, [
    { id: "VvVvVvVvVvVvVvVvVvVv", label: "Viktor's line" },
    { id: "NnNnNnNnNnNnNnNnNnNn", label: "Rachel" },
  ]);
  assert.deepEqual(Object.keys(c.voices), ["viktor", "rachel"]);
  assert.equal(c.voices.viktor.model, "eleven_v3");
  assert.equal(c.default, "viktor"); // judy is gone, so the first
  assert.equal(voicesConfig(c, [{ id: "NnNnNnNnNnNnNnNnNnNn", label: "Rachel" }, { id: "VvVvVvVvVvVvVvVvVvVv", label: "x" }]).default, "viktor");
  assert.equal(voicesConfig(undefined, []).default, undefined);
});

test("EDGEwave Voice: speaks through ElevenLabs once, then from the cache; asks for the key; a refused key says so", async () => {
  let calls = 0;
  let status = 200;
  const s = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      calls++;
      if (status !== 200) {
        res.statusCode = status;
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify({ detail: { status: "invalid_api_key", message: "Invalid API key" } }));
      }
      assert.equal(req.headers["xi-api-key"], "sk_test");
      assert.match(req.url!, /^\/v1\/text-to-speech\/AbCdEfGhIjKlMnOpQrSt\?output_format=pcm_24000/);
      res.end(Buffer.alloc(48000)); // 1 s at 24 kHz, 16-bit mono
    });
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ewv-"));
  fs.writeFileSync(path.join(dir, VoicesFile), JSON.stringify(config));
  const store = new Map<string, string>();
  const played: { sound: string; options?: Record<string, unknown> }[] = [];
  const events: { event: string; data: unknown }[] = [];
  let finish: (end: { why: string }) => void = () => {};
  const voice = createVoice({
    dir,
    secrets: { get: async (k) => store.get(k) ?? null, set: async (k, v) => void store.set(k, v), delete: async (k) => void store.delete(k) },
    audio: {
      play: async (sound, options) => {
        played.push({ sound, options });
        return { id: played.length, ended: new Promise((r) => (finish = r)), stop: async () => finish({ why: "stopped" }) };
      },
    },
    emit: (event, data) => events.push({ event, data }),
    log: () => {},
    baseUrl: `http://127.0.0.1:${(s.address() as AddressInfo).port}`,
  });
  try {
    await assert.rejects(voice.speak("Hey, choom."), /No ElevenLabs API key yet/);
    assert.equal((await voice.status()).key, false);
    await voice.setKey("  sk_test ");
    assert.equal(store.get(KeySecret), "sk_test");

    const [a, b] = await Promise.all([voice.prepare("Hey, choom."), voice.prepare("Hey, choom.")]);
    assert.equal(calls, 1); // the same line at once: one request
    assert.deepEqual(a, { seconds: 1, cached: false, voice: "judy" });
    assert.equal(b.cached, false);
    const r = await voice.speak("Hey, choom.", undefined, { volume: 0.8 }, { id: "chat", name: "Chat" });
    assert.deepEqual(r, { id: 1, seconds: 1, cached: true, voice: "judy" });
    assert.equal(calls, 1);
    assert.equal(played[0].sound, `${CacheDir}/${cacheName(Judy, "eleven_flash_v2_5", "Hey, choom.")}`);
    assert.deepEqual(played[0].options, { category: "dialogue", volume: 0.8 });
    assert.ok(fs.existsSync(path.join(dir, played[0].sound)));
    assert.deepEqual(await voice.stop(), { stopped: 1 });
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(events, [{ event: "ended", data: { id: 1, why: "stopped", caller: { id: "chat", name: "Chat" } } }]);

    await assert.rejects(voice.speak(""), /Nothing to speak/);
    await assert.rejects(voice.speak("x".repeat(2501)), /up to 2500/);
    await assert.rejects(voice.speak("Hi", "panam"), /No voice named panam/);
    status = 401;
    await assert.rejects(voice.speak("Something new."), /ElevenLabs refused the API key: Invalid API key/);
    assert.match((await voice.status()).lastError ?? "", /refused the API key/);
    assert.deepEqual(voice.voices().map((v) => [v.name, v.default]), [["judy", true], ["viktor", false]]);
  } finally {
    await new Promise<void>((r) => s.close(() => r()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
