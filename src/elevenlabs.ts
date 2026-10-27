// The ElevenLabs API, for the voice tools (src/voiceTools.ts): sound effects from a prompt, speech in a
// voice, instant voice clones, voice remixes and speech-to-speech. Plain fetch, no VS Code imports, so
// the unit tests run it against a local stand-in server. Audio comes back as raw 16-bit PCM, which
// pcmToWav wraps; formats other than 44.1 kHz need no Pro plan (ElevenLabs' docs, 2026-10-18).
// API reference: https://elevenlabs.io/docs/api-reference

import { encodeWav } from "./audio/wav";

export const DefaultBaseUrl = "https://api.elevenlabs.io";

export interface Voice {
  id: string;
  name: string;
  /** Such as gender, accent, age, use case. */
  labels: Record<string, string>;
  category?: string;
  previewUrl?: string;
}

export interface Model {
  id: string;
  name: string;
  speech: boolean;
  voiceChange: boolean;
  maxText?: number;
}

export interface RemixPreview {
  generatedVoiceId: string;
  /** A WAV, made from the preview's PCM. */
  wav: Uint8Array;
  seconds?: number;
}

/** An error from ElevenLabs, with its HTTP status and a message a modder can read. */
export class ElevenLabsError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
  }
}

/** The readable part of an error body: {detail: {message, status}}, {detail: [{msg}]}, {detail: "..."} or text. */
export function errorText(status: number, body: string): { message: string; code?: string } {
  try {
    const j = JSON.parse(body) as { detail?: unknown; message?: unknown };
    const d = j.detail;
    if (typeof d === "string") return { message: d };
    if (Array.isArray(d)) return { message: d.map((x) => (x as { msg?: string }).msg ?? JSON.stringify(x)).join("; ") };
    if (d && typeof d === "object") {
      const o = d as { message?: string; status?: string };
      if (o.message) return { message: o.message, code: o.status };
    }
    if (typeof j.message === "string") return { message: j.message };
  } catch {
    // Not JSON.
  }
  return { message: body.trim().slice(0, 300) || `HTTP ${status}` };
}

/** Raw 16-bit little-endian mono PCM as a WAV file. */
export function pcmToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const n = Math.floor(pcm.length / 2);
  const v = new DataView(pcm.buffer, pcm.byteOffset, n * 2);
  const ch = new Float32Array(n);
  for (let i = 0; i < n; i++) ch[i] = v.getInt16(i * 2, true) / 0x8000;
  return encodeWav({ sampleRate, channels: [ch] });
}

/** The output format for a rate: PCM, so no decoder is needed. */
export const pcmFormat = (rate: number) => `pcm_${rate}`;

/** Whether an error means the plan does not allow this output format, so a lower rate may work. */
export function formatRefused(e: unknown): boolean {
  if (!(e instanceof ElevenLabsError) || ![400, 401, 403, 422].includes(e.status)) return false;
  return /output_format|output format|tier|subscription|plan/i.test(`${e.code ?? ""} ${e.message}`);
}

/**
 * Whether an error means the API key is missing, wrong or lacks a permission, so another key may fix it.
 * ElevenLabs answers 401 for those, and also for a used-up quota, which a key does not fix.
 */
export function keyRefused(e: unknown): boolean {
  if (!(e instanceof ElevenLabsError) || e.status !== 401 || formatRefused(e)) return false;
  return !/quota|credit/i.test(`${e.code ?? ""} ${e.message}`);
}

export class ElevenLabs {
  constructor(private readonly key: string, private readonly base = DefaultBaseUrl) {}

  private async call(method: string, path: string, init: { json?: unknown; form?: FormData; query?: Record<string, string | undefined> } = {}): Promise<Response> {
    const url = new URL(path, this.base.replace(/\/+$/, "") + "/");
    for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined) url.searchParams.set(k, v);
    const headers: Record<string, string> = { "xi-api-key": this.key };
    let body: string | FormData | undefined;
    if (init.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.json);
    } else if (init.form) body = init.form;
    const r = await fetch(url, { method, headers, body });
    if (!r.ok) {
      const e = errorText(r.status, await r.text());
      throw new ElevenLabsError(r.status, e.message, e.code);
    }
    return r;
  }

  private async audio(r: Response): Promise<Uint8Array> {
    return new Uint8Array(await r.arrayBuffer());
  }

  /** The account's voices (its own and saved ones, and the default voices), filtered by a search. */
  async voices(search?: string): Promise<Voice[]> {
    const out: Voice[] = [];
    let token: string | undefined;
    do {
      const r = await this.call("GET", "v2/voices", { query: { search: search || undefined, page_size: "100", next_page_token: token } });
      const j = (await r.json()) as { voices: { voice_id: string; name?: string; labels?: Record<string, string>; category?: string; preview_url?: string }[]; has_more?: boolean; next_page_token?: string | null };
      for (const v of j.voices) out.push({ id: v.voice_id, name: v.name ?? v.voice_id, labels: v.labels ?? {}, category: v.category, previewUrl: v.preview_url ?? undefined });
      token = j.has_more && j.next_page_token ? j.next_page_token : undefined;
    } while (token && out.length < 500);
    return out;
  }

  async models(): Promise<Model[]> {
    const r = await this.call("GET", "v1/models");
    const j = (await r.json()) as { model_id: string; name?: string; can_do_text_to_speech?: boolean; can_do_voice_conversion?: boolean; maximum_text_length_per_request?: number }[];
    return j.map((m) => ({ id: m.model_id, name: m.name ?? m.model_id, speech: !!m.can_do_text_to_speech, voiceChange: !!m.can_do_voice_conversion, maxText: m.maximum_text_length_per_request }));
  }

  /** A sound effect from a prompt, 0.5 to 30 seconds (from the prompt when absent), as raw PCM. */
  async soundEffect(o: { text: string; seconds?: number; loop?: boolean; influence?: number }, rate: number): Promise<Uint8Array> {
    const json: Record<string, unknown> = { text: o.text };
    if (o.seconds !== undefined) json.duration_seconds = Math.max(0.5, Math.min(30, o.seconds));
    if (o.loop) json.loop = true;
    if (o.influence !== undefined) json.prompt_influence = Math.max(0, Math.min(1, o.influence));
    return this.audio(await this.call("POST", "v1/sound-generation", { json, query: { output_format: pcmFormat(rate) } }));
  }

  /** Text spoken in a voice, as raw PCM. */
  async speak(voiceId: string, o: { text: string; model?: string; seed?: number }, rate: number): Promise<Uint8Array> {
    const json: Record<string, unknown> = { text: o.text };
    if (o.model) json.model_id = o.model;
    if (o.seed !== undefined) json.seed = o.seed;
    return this.audio(await this.call("POST", `v1/text-to-speech/${encodeURIComponent(voiceId)}`, { json, query: { output_format: pcmFormat(rate) } }));
  }

  /** A recording spoken again in another voice, keeping its words, timing and delivery, as raw PCM. */
  async speechToSpeech(voiceId: string, wav: Uint8Array, o: { model?: string; seed?: number }, rate: number): Promise<Uint8Array> {
    const form = new FormData();
    form.append("audio", new Blob([wav], { type: "audio/wav" }), "line.wav");
    if (o.model) form.append("model_id", o.model);
    if (o.seed !== undefined) form.append("seed", String(o.seed));
    return this.audio(await this.call("POST", `v1/speech-to-speech/${encodeURIComponent(voiceId)}`, { form, query: { output_format: pcmFormat(rate) } }));
  }

  /** An instant voice clone from one recording; its voice id. */
  async cloneVoice(name: string, wav: Uint8Array, description?: string): Promise<string> {
    const form = new FormData();
    form.append("name", name);
    form.append("files", new Blob([wav], { type: "audio/wav" }), "sample.wav");
    if (description) form.append("description", description);
    const j = (await (await this.call("POST", "v1/voices/add", { form })).json()) as { voice_id: string };
    return j.voice_id;
  }

  /** Previews of a voice changed as described (such as "female, angry"); each can be saved with saveRemix. */
  async remix(voiceId: string, description: string, rate: number): Promise<RemixPreview[]> {
    const r = await this.call("POST", `v1/text-to-voice/${encodeURIComponent(voiceId)}/remix`, {
      json: { voice_description: description, auto_generate_text: true },
      query: { output_format: pcmFormat(rate) },
    });
    const j = (await r.json()) as { previews: { generated_voice_id: string; audio_base_64: string; duration_secs?: number }[] };
    return j.previews.map((p) => ({ generatedVoiceId: p.generated_voice_id, wav: pcmToWav(new Uint8Array(Buffer.from(p.audio_base_64, "base64")), rate), seconds: p.duration_secs }));
  }

  /** A remix preview saved as a voice; its voice id. */
  async saveRemix(generatedVoiceId: string, name: string, description: string): Promise<string> {
    const j = (await (await this.call("POST", "v1/text-to-voice", { json: { voice_name: name, voice_description: description, generated_voice_id: generatedVoiceId } })).json()) as { voice_id: string };
    return j.voice_id;
  }

  async deleteVoice(voiceId: string): Promise<void> {
    await this.call("DELETE", `v1/voices/${encodeURIComponent(voiceId)}`);
  }

  /** Bytes from a voice's preview URL (no key needed; usually an MP3). */
  static async fetchPreview(url: string): Promise<{ data: Uint8Array; mime: string }> {
    const r = await fetch(url);
    if (!r.ok) throw new ElevenLabsError(r.status, `The preview could not be fetched (HTTP ${r.status})`);
    return { data: new Uint8Array(await r.arrayBuffer()), mime: r.headers.get("content-type") ?? "audio/mpeg" };
  }
}

/** A short file-name part from a prompt or a line: lower case, words joined by dashes. */
export function slug(text: string, max = 32): string {
  const s = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // Cut at a whole word when the text is longer.
  const cut = s.length > max ? s.slice(0, max + 1).replace(/-[^-]*$/, "") || s.slice(0, max) : s;
  return cut.replace(/-+$/, "") || "sound";
}
