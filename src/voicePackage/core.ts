// EDGEwave Voice, the REDnode package (rednode/edgewave-voice): speaks lines of text on demand in the running
// game, for mods that write their dialogue as they go. This is its engine, bundled into the package as
// core.mjs; mod.mjs (its window) and service.mjs (what other packages call) share one instance. It takes
// REDnode's parts as arguments, so the unit tests run it with stand-ins.
//
// A line goes to ElevenLabs with the player's key (REDnode's secrets), comes back as PCM, is kept as a WAV
// in the package's .cache folder and plays through REDnode's audio on the Dialogue slider. The same text in
// the same voice plays from the cache. audio.play takes only files inside the package's folder, and hot
// reload skips dot folders, so the cache is there and not in pkg.dataDir (REDnode #20 asks for a better
// way). Voices are named in voices.json, which EDGEwave writes (src/voicePackage/install.ts).

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { ElevenLabs, keyRefused, pcmToWav } from "../elevenlabs";

export const PackageId = "edgewave-voice";
export const KeySecret = "elevenlabs-key";
export const VoicesFile = "voices.json";
export const CacheDir = ".cache";
/** Low latency and fine for dialogue on the fly (ElevenLabs' docs: Flash v2.5, about 75 ms of model time). */
export const DefaultModel = "eleven_flash_v2_5";
/** 24 kHz PCM: every plan has it, and it is half the bytes of 48 kHz. */
export const Rate = 24000;
/** A line longer than this is refused: speak a conversation line by line, so each starts sooner. */
export const MaxText = 2500;
export const MaxCacheBytes = 200 * 1024 * 1024;

/** voices.json: the voices a mod may name, written by EDGEwave. */
export interface VoicesConfig {
  edgewave: "voices";
  version: 1;
  provider: "elevenlabs";
  model?: string;
  /** The voice used when a call names none. */
  default?: string;
  voices: Record<string, { id: string; label?: string; model?: string }>;
}

export interface SpeakOptions {
  model?: string;
  volume?: number;
  pan?: number;
  category?: "dialogue" | "sfx" | "music";
}

/** REDnode's parts the engine uses: the package's folder, its secrets, audio and events, and a log. */
export interface Deps {
  dir: string;
  secrets: { get(name: string): Promise<string | null>; set(name: string, value: string): Promise<void>; delete(name: string): Promise<void> };
  audio: { play(sound: string, options?: Record<string, unknown>): Promise<{ id: number; ended: Promise<{ why: string }>; stop(o?: { fadeOut?: number }): Promise<void> }> };
  emit(event: string, data: unknown): void;
  log(line: string): void;
  /** ElevenLabs' address: the real one unless a test gives a stand-in. */
  baseUrl?: string;
}

/** A voice by its name in voices.json (any case), or an ElevenLabs voice id as it is. */
export function resolveVoice(config: VoicesConfig | undefined, voice: string | undefined): { name: string; id: string; model?: string } {
  const voices = config?.voices ?? {};
  const names = Object.keys(voices);
  const wanted = voice?.trim() || config?.default || names[0];
  if (!wanted) throw new Error("No voice named and none set up: in VS Code, EDGEwave: Voices for REDnode… names some, or pass an ElevenLabs voice id.");
  const name = names.find((n) => n.toLowerCase() === wanted.toLowerCase());
  if (name) return { name, id: voices[name].id, model: voices[name].model };
  // ElevenLabs' voice ids are 20 letters and digits.
  if (/^[A-Za-z0-9]{20}$/.test(wanted)) return { name: wanted, id: wanted };
  throw new Error(`No voice named ${wanted}. ${names.length ? `The names set up: ${names.join(", ")}.` : "None are set up yet."} Pass one of them or an ElevenLabs voice id.`);
}

/** The cache's file for a line: the same text in the same voice and model is the same file. */
export function cacheName(voiceId: string, model: string, text: string): string {
  return `${createHash("sha1").update(`elevenlabs\n${voiceId}\n${model}\n${Rate}\n${text}`).digest("hex")}.wav`;
}

/** Deletes the cache's oldest files (by last use) until it is under the limit. */
export function pruneCache(dir: string, max = MaxCacheBytes): number {
  let files: { file: string; size: number; used: number }[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".wav")).map((f) => {
      const s = fs.statSync(path.join(dir, f));
      return { file: f, size: s.size, used: s.mtimeMs };
    });
  } catch {
    return 0;
  }
  let total = files.reduce((n, f) => n + f.size, 0);
  let removed = 0;
  for (const f of files.sort((a, b) => a.used - b.used)) {
    if (total <= max) break;
    fs.rmSync(path.join(dir, f.file), { force: true });
    total -= f.size;
    removed++;
  }
  return removed;
}

/** A WAV's length in seconds, from its header (16-bit PCM, as pcmToWav writes). */
function seconds(wav: Uint8Array): number {
  const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const rate = v.getUint32(24, true);
  const block = v.getUint16(32, true);
  return rate && block ? Math.round(((wav.byteLength - 44) / block / rate) * 100) / 100 : 0;
}

export type Voice = ReturnType<typeof createVoice>;

export function createVoice(d: Deps) {
  const cache = path.join(d.dir, CacheDir);
  const making = new Map<string, Promise<{ file: string; seconds: number; cached: boolean }>>();
  const playing = new Map<number, { stop(o?: { fadeOut?: number }): Promise<void> }>();
  let lastError: string | undefined;
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((f) => f());

  const config = (): VoicesConfig | undefined => {
    try {
      const c = JSON.parse(fs.readFileSync(path.join(d.dir, VoicesFile), "utf8")) as VoicesConfig;
      return c?.edgewave === "voices" && c.voices && typeof c.voices === "object" ? c : undefined;
    } catch {
      return undefined;
    }
  };

  const failed = (message: string): never => {
    lastError = message;
    changed();
    throw new Error(message);
  };

  /** The line's WAV in the cache, made through ElevenLabs when it is not there yet. */
  async function make(text: string, voice?: string, o: SpeakOptions = {}) {
    text = String(text ?? "").trim();
    if (!text) failed("Nothing to speak: the text is empty.");
    if (text.length > MaxText) failed(`The text is ${text.length} characters; EDGEwave Voice speaks up to ${MaxText} at a time. Speak it line by line.`);
    const c = config();
    let v: ReturnType<typeof resolveVoice>;
    try {
      v = resolveVoice(c, voice);
    } catch (e) {
      return failed((e as Error).message);
    }
    const model = o.model || v.model || c?.model || DefaultModel;
    const name = cacheName(v.id, model, text);
    const file = path.join(cache, name);
    if (fs.existsSync(file)) {
      const now = new Date();
      fs.utimesSync(file, now, now);
      return { file: `${CacheDir}/${name}`, seconds: seconds(fs.readFileSync(file)), cached: true, voice: v.name };
    }
    let job = making.get(name);
    if (!job) {
      job = (async () => {
        const key = await d.secrets.get(KeySecret);
        if (!key) failed("No ElevenLabs API key yet: open EDGEwave Voice from REDnode's launcher (F10) and paste it there.");
        let pcm: Uint8Array;
        try {
          pcm = await new ElevenLabs(key!, d.baseUrl).speak(v.id, { text, model }, Rate);
        } catch (e) {
          if (keyRefused(e)) failed(`ElevenLabs refused the API key: ${(e as Error).message}. Paste a new one in EDGEwave Voice's window.`);
          const m = (e as Error).message;
          failed(/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(m) ? `EDGEwave Voice could not reach ElevenLabs: ${m}` : `ElevenLabs: ${m}`);
        }
        const wav = pcmToWav(pcm!, Rate);
        fs.mkdirSync(cache, { recursive: true });
        fs.writeFileSync(file, wav);
        pruneCache(cache);
        d.log(`Spoke ${text.length} characters in ${v.name} (${model}): ${seconds(wav)} s`);
        lastError = undefined;
        changed();
        return { file: `${CacheDir}/${name}`, seconds: seconds(wav), cached: false };
      })().finally(() => making.delete(name));
      making.set(name, job);
    }
    return { ...(await job), voice: v.name };
  }

  return {
    /** Fetches a line ahead of time, so speaking it later starts at once. */
    async prepare(text: string, voice?: string, o?: SpeakOptions) {
      const r = await make(text, voice, o);
      return { seconds: r.seconds, cached: r.cached, voice: r.voice };
    },

    /** Speaks a line: made (or found in the cache), then played on the Dialogue slider. Resolves once it plays. */
    async speak(text: string, voice?: string, o: SpeakOptions = {}, caller?: unknown) {
      const r = await make(text, voice, o);
      const options: Record<string, unknown> = { category: o.category ?? "dialogue" };
      if (o.volume !== undefined) options.volume = o.volume;
      if (o.pan !== undefined) options.pan = o.pan;
      const sound = await d.audio.play(r.file, options);
      playing.set(sound.id, sound);
      void sound.ended.then((end) => {
        playing.delete(sound.id);
        d.emit("ended", { id: sound.id, why: end.why, caller });
      });
      return { id: sound.id, seconds: r.seconds, cached: r.cached, voice: r.voice };
    },

    /** Stops one line by its id, or every line this package plays. */
    async stop(id?: number, fadeOut = 0) {
      const all = id === undefined ? [...playing.values()] : [playing.get(id)].filter((s) => !!s);
      await Promise.all(all.map((s) => s!.stop({ fadeOut })));
      return { stopped: all.length };
    },

    /** The voices mods may name, from voices.json. */
    voices() {
      const c = config();
      return Object.entries(c?.voices ?? {}).map(([name, v]) => ({ name, label: v.label ?? name, default: name === (c?.default ?? Object.keys(c!.voices)[0]) }));
    },

    async status() {
      const key = !!(await d.secrets.get(KeySecret));
      return { provider: "elevenlabs", key, voices: this.voices().length, model: config()?.model ?? DefaultModel, lastError };
    },

    async setKey(key: string) {
      key = key.trim();
      if (!key) return;
      await d.secrets.set(KeySecret, key);
      lastError = undefined;
      changed();
    },

    async clearKey() {
      await d.secrets.delete(KeySecret);
      changed();
    },

    /** Calls back when the key, a line's result or the last error changes, for the window. */
    onChange(f: () => void) {
      listeners.add(f);
    },
  };
}
