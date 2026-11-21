// Speak one line with ElevenLabs' timings (EDGEwave #13, for EDGEfab's Lip Sync tab): the words in, a WAV and
// when each character is spoken out. No project needed: takes are kept in EDGEwave's own folder,
// %LOCALAPPDATA%\EDGEwave\lines\<speaker>\, each WAV with its <name>.timings.json beside it, and the same line in
// the same voice and model is answered from there, free, until a new take is asked for. Character voices (a game
// voice tag such as judy, its ElevenLabs voice) are one list for every tool, characters.json in the same folder.
// No VS Code imports: the API (src/speakLineHost.ts) and the MCP server both run it.

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { formatRefused, pcmToWav, slug, type Alignment, type ElevenLabs } from "./elevenlabs";
import { edgewaveHome } from "./events";
import { readsTags } from "./voice";
import { wavSeconds } from "./customSound";

/** ElevenLabs v3 reads audio tags, so a delivery can be given as one. */
export const DefaultModel = "eleven_v3";
const FallbackRate = 24000;

export const linesDir = () => path.join(edgewaveHome(), "lines");
export const charactersFile = () => path.join(edgewaveHome(), "characters.json");

/** When each character is spoken, and whether it is: an audio tag such as [tired] is read, not spoken. */
export interface Timings extends Alignment {
  /** One per character: false inside an audio tag, brackets included. */
  spoken: boolean[];
  /** ElevenLabs' alignment for the text as it read it (numbers spelled out), when it differs. */
  normalized?: Alignment & { spoken: boolean[] };
}

export interface LineRequest {
  text: string;
  /** Who speaks: a game voice tag (judy, angelica_whelan), its voice from characters.json. */
  character?: string;
  /** V's female or male voice, for a character with two. */
  gender?: "female" | "male";
  /** An ElevenLabs voice id, in place of character. */
  voice?: string;
  /** A direction, such as "tired, quiet": an audio tag on v3; other models do not read one. */
  delivery?: string;
  model?: string;
  /** A take kept before, by its number; "new" for another; absent, the last one kept, or a new one. */
  take?: number | "new";
  /** Write the take here in place of EDGEwave's folder. */
  outDir?: string;
}

export interface SpokenLine {
  /** The WAV, a full path: mono 16-bit PCM. */
  wav: string;
  seconds: number;
  /** Seconds from the WAV's first sample. */
  timings: Timings;
  /** The timings' file, beside the WAV. */
  timingsFile: string;
  voice: { id: string; name?: string };
  model: string;
  take: number;
  /** The text as sent to ElevenLabs: the line, with the delivery as a tag on v3. */
  sent: string;
  /** Characters ElevenLabs counted (its price); 0 when the take was kept from before. */
  characters: number;
  cached: boolean;
  notes: string[];
}

/** What a take's .timings.json holds. */
interface TakeFile {
  edgewave: "line";
  version: 1;
  text: string;
  delivery?: string;
  sent: string;
  voice: { id: string; name?: string };
  model: string;
  take: number;
  made: string;
  rate: number;
  timings: Timings;
}

// ---- character voices -----------------------------------------------------------------------------------

export interface CharacterVoice {
  id: string;
  name?: string;
  /** How it was chosen: picked from the account's voices, or cloned from the character's game lines. */
  how?: "picked" | "cloned" | "voiceLines";
  set?: string;
}

/** A game voice tag as a key: lower case, _ between words ("Judy" and "judy" are one). */
export const tagOf = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
export const characterKey = (character: string, gender?: "female" | "male") => (gender ? `${tagOf(character)}:${gender}` : tagOf(character));

export function readCharacters(file = charactersFile()): Record<string, CharacterVoice> {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8")) as { characters?: Record<string, CharacterVoice> };
    return j.characters && typeof j.characters === "object" ? j.characters : {};
  } catch {
    return {};
  }
}

export function setCharacter(key: string, v: CharacterVoice | undefined, file = charactersFile()): void {
  const all = readCharacters(file);
  if (v) all[key] = { ...v, set: v.set ?? new Date().toISOString() };
  else delete all[key];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ edgewave: "characters", version: 1, characters: all }, null, 2) + "\n");
}

/** A character's voice: its own entry, else (for V with no gender) the female one. */
export function characterVoice(character: string, gender?: "female" | "male", file = charactersFile()): CharacterVoice | undefined {
  const all = readCharacters(file);
  return all[characterKey(character, gender)] ?? (gender ? undefined : all[characterKey(character, "female")] ?? all[characterKey(character, "male")]);
}

// ---- timings --------------------------------------------------------------------------------------------

/** One per character: false from a [ to its ], brackets included (an audio tag is read, not spoken). */
export function spokenMask(characters: string[]): boolean[] {
  let inTag = false;
  return characters.map((c) => {
    if (c === "[") inTag = true;
    const out = !inTag;
    if (c === "]") inTag = false;
    return out;
  });
}

export function timingsOf(alignment: Alignment | undefined, normalized?: Alignment): Timings {
  const a = alignment ?? { characters: [], starts: [], ends: [] };
  const t: Timings = { ...a, spoken: spokenMask(a.characters) };
  if (normalized && normalized.characters.join("") !== a.characters.join("")) t.normalized = { ...normalized, spoken: spokenMask(normalized.characters) };
  return t;
}

// ---- the text sent --------------------------------------------------------------------------------------

const Tags = /\s*\[[^\]\n]{1,60}\]\s*/g;

/** The text as sent: on a model that reads tags, the delivery as a tag in front; elsewhere, tags taken out. */
export function textToSend(text: string, delivery: string | undefined, model: string): { sent: string; notes: string[] } {
  const words = text.trim();
  if (readsTags(model)) return { sent: delivery?.trim() ? `[${delivery.trim().replace(/[[\]]/g, "")}] ${words}` : words, notes: [] };
  const plain = words.replace(Tags, " ").replace(/\s+([,.!?…])/g, "$1").replace(/\s+/g, " ").trim();
  const notes: string[] = [];
  if (delivery?.trim()) notes.push(`${model} does not read a delivery; it was left out. eleven_v3 reads it.`);
  if (plain !== words) notes.push(`${model} does not read audio tags; they were taken out.`);
  return { sent: plain || words, notes };
}

// ---- takes ----------------------------------------------------------------------------------------------

/** The takes' folder for a speaker, and the base name every take of this line, voice and model shares. */
function takeBase(o: { dir: string; speaker: string; text: string; delivery?: string; voiceId: string; model: string }): { dir: string; base: string } {
  const key = createHash("sha1").update(JSON.stringify([o.text.trim(), o.delivery?.trim() ?? "", o.voiceId, o.model])).digest("hex").slice(0, 10);
  return { dir: path.join(o.dir, tagOf(o.speaker) || "voice"), base: `${slug(o.text, 40)}-${key}` };
}

const takeFile = (dir: string, base: string, n: number) => path.join(dir, `${base}-${n}`);

/** The take numbers kept for a line, lowest first. */
function takesKept(dir: string, base: string): number[] {
  if (!fs.existsSync(dir)) return [];
  const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)\\.wav$`);
  return fs
    .readdirSync(dir)
    .map((f) => re.exec(f)?.[1])
    .filter((n): n is string => !!n)
    .map(Number)
    .filter((n) => fs.existsSync(`${takeFile(dir, base, n)}.timings.json`))
    .sort((a, b) => a - b);
}

function readTake(file: string): SpokenLine {
  const j = JSON.parse(fs.readFileSync(`${file}.timings.json`, "utf8")) as TakeFile;
  const wav = `${file}.wav`;
  return { wav, seconds: wavSeconds(fs.readFileSync(wav)), timings: j.timings, timingsFile: `${file}.timings.json`, voice: j.voice, model: j.model, take: j.take, sent: j.sent, characters: 0, cached: true, notes: [] };
}

/**
 * Speaks the line in the voice given (an ElevenLabs id), or answers with a take kept before. Throws
 * ElevenLabs' errors as they are; the caller says them in plain words.
 */
export async function speakLine(o: LineRequest & { voiceId: string; voiceName?: string; speaker: string; api: ElevenLabs; rate?: number; dir?: string; log?: (l: string) => void; beforeSpend?: (characters: number) => Promise<void> }): Promise<SpokenLine> {
  const text = o.text?.trim();
  if (!text) throw new Error("No words to speak.");
  const model = o.model || DefaultModel;
  const { dir, base } = takeBase({ dir: o.outDir ?? o.dir ?? linesDir(), speaker: o.speaker, text, delivery: o.delivery, voiceId: o.voiceId, model });
  const kept = takesKept(dir, base);
  if (typeof o.take === "number" && kept.includes(o.take)) return readTake(takeFile(dir, base, o.take));
  if (o.take === undefined && kept.length) return readTake(takeFile(dir, base, kept[kept.length - 1]));
  const n = (kept[kept.length - 1] ?? 0) + 1;

  const { sent, notes } = textToSend(text, o.delivery, model);
  // Only a new take costs: the caller may ask the modder first, and stop by throwing.
  await o.beforeSpend?.(sent.length);
  let rate = o.rate ?? 48000;
  let r: Awaited<ReturnType<ElevenLabs["speakWithTimings"]>>;
  try {
    r = await o.api.speakWithTimings(o.voiceId, { text: sent, model }, rate);
  } catch (e) {
    if (rate <= FallbackRate || !formatRefused(e)) throw e;
    o.log?.(`ElevenLabs refused ${rate} Hz (${(e as Error).message}); using ${FallbackRate} Hz`);
    rate = FallbackRate;
    r = await o.api.speakWithTimings(o.voiceId, { text: sent, model }, rate);
  }
  if (!r.alignment) notes.push(`ElevenLabs gave no timings for this line with ${model}.`);
  const timings = timingsOf(r.alignment, r.normalized);
  const file = takeFile(dir, base, n);
  fs.mkdirSync(dir, { recursive: true });
  // ElevenLabs' PCM is mono 16-bit.
  const wav = pcmToWav(r.pcm, rate);
  fs.writeFileSync(`${file}.wav`, wav);
  const voice = { id: o.voiceId, ...(o.voiceName ? { name: o.voiceName } : {}) };
  const record: TakeFile = { edgewave: "line", version: 1, text, ...(o.delivery?.trim() ? { delivery: o.delivery.trim() } : {}), sent, voice, model, take: n, made: new Date().toISOString(), rate, timings };
  fs.writeFileSync(`${file}.timings.json`, JSON.stringify(record, null, 1) + "\n");
  o.log?.(`Spoke ${o.speaker}: ${sent} (${model}, take ${n}, ${sent.length} characters)`);
  return { wav: `${file}.wav`, seconds: wavSeconds(wav), timings, timingsFile: `${file}.timings.json`, voice, model, take: n, sent, characters: sent.length, cached: false, notes };
}

/** Timings kept beside any take: <name>.timings.json next to <name>.wav. */
export const timingsFileOf = (wav: string) => wav.replace(/\.wav$/i, "") + ".timings.json";

/** Writes timings beside a WAV (Voice Lines' takes). */
export function writeTimings(wav: string, o: { text: string; sent: string; voice: string; model: string; rate: number; timings: Timings }): void {
  fs.writeFileSync(timingsFileOf(wav), JSON.stringify({ edgewave: "line", version: 1, text: o.text, sent: o.sent, voice: { id: o.voice }, model: o.model, made: new Date().toISOString(), rate: o.rate, timings: o.timings }, null, 1) + "\n");
}

// ---- a character's clone samples ----------------------------------------------------------------------------

/** The sample a clone is made from: what ElevenLabs asks of an instant clone (clean, varied, one to two minutes). */
export const CloneSample = { minSeconds: 3, maxSeconds: 9, totalSeconds: 120, maxLines: 18 };

/**
 * A character's voice lines in the order to try them for a clone: one language (English when there is any),
 * no combat or vehicle barks (vs_, vset), one copy of a line the game has for both female and male V, files of a
 * line's size (3 to 9 seconds, from the size; the decoded length is checked after), and taken in turn from each
 * quest or scene so the voice is heard in many moods. Pure: names and sizes in, names out.
 */
export function cloneCandidates(files: { name: string; size: number }[], tag: string, o: { minBytes?: number; maxBytes?: number } = {}): string[] {
  const t = tagOf(tag);
  const sep = String.fromCharCode(92);
  const base = (n: string) => n.split(sep).pop()!.toLowerCase();
  const lang = (n: string) => n.toLowerCase().split(sep + "localization" + sep)[1]?.split(sep)[0] ?? "";
  const mine = files.filter((f) => base(f.name).startsWith(`${t}_`) && base(f.name).endsWith(".wem") && inVoFolder(f.name));
  const langs = new Set(mine.map((f) => lang(f.name)));
  const pick = langs.has("en-us") ? "en-us" : [...langs].sort()[0];
  const minBytes = o.minBytes ?? 28_000, maxBytes = o.maxBytes ?? 110_000;
  const seen = new Set<string>();
  const groups = new Map<string, { name: string; size: number }[]>();
  for (const f of mine) {
    const b = base(f.name);
    if (lang(f.name) !== pick || /_vs_|vset/.test(b) || f.size < minBytes || f.size > maxBytes) continue;
    const id = /_[fm]_([0-9a-f]{16})/.exec(b)?.[1] ?? b;
    if (seen.has(id)) continue;
    seen.add(id);
    const group = b.slice(t.length + 1).replace(/_[fm]_[0-9a-f]{16}.*$/, "");
    groups.set(group, [...(groups.get(group) ?? []), f]);
  }
  // Within a group the middle sizes first (whole sentences, not the longest speeches); then one from each in turn.
  const lists = [...groups.values()].map((g) => {
    const mid = (minBytes + maxBytes) / 2;
    return [...g].sort((a, b) => Math.abs(a.size - mid) - Math.abs(b.size - mid));
  });
  const out: string[] = [];
  for (let i = 0; lists.some((l) => l.length > i); i++) for (const l of lists) if (l[i]) out.push(l[i].name);
  return out;
}

/** In a vo folder (vo, not vo_holocall or vo_helmet: those carry a phone's or a helmet's sound). */
function inVoFolder(name: string): boolean {
  const parts = name.toLowerCase().split(String.fromCharCode(92));
  return parts.at(-2) === "vo";
}
