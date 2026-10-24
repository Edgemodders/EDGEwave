// Voice a quest (V2, EDGEwave #5): the contract with EDGEquest, agreed 2026-10-23 and 24. EDGEquest
// passes a quest's lines; EDGEwave makes a take per line (two for V, female and male) and records them in
// source/raw/edgewave/voice/<quest>/voice.json, which EDGEquest reads to write the voice-over map and tick
// its checklist. A line is voiced while its text, say and direction match what the take was made from.
// Pure (no VS Code), so the MCP server uses it too.

import * as path from "node:path";

/** A line as EDGEquest passes it. */
export interface VoiceLine {
  /** The line's locstringId.ruid, a decimal string. */
  id: string;
  scene: string;
  /** V, or the person's name as written in the story. */
  speaker: string;
  /** The subtitle. */
  text: string;
  /** As spoken, with ElevenLabs v3's square-bracket delivery tags ([softly], [sighs]). Absent: text. */
  say?: string;
  /** How it is spoken, in plain words. */
  direction?: string;
  /** Two takes, female and male. Absent: true for V, false for anyone else. */
  both?: boolean;
}

/** A voice per speaker: V's two, anyone else's one (ElevenLabs voice ids). */
export type Voices = Record<string, string | { female?: string; male?: string }>;

export type Gender = "female" | "male";

/** What a take was made from, and its files (relative to the project's folder, forward slashes). */
export interface Take {
  text: string;
  say?: string;
  direction?: string;
  female?: string;
  male?: string;
  /** Game paths of the .wem files under the archive folder, for the voice-over map. */
  wem?: { female?: string; male?: string };
  /** The model and voices used. */
  model?: string;
  made?: string;
}

export interface LineRecord extends Take {
  scene: string;
  speaker: string;
  /** The take before the last, kept for going back to it. */
  previous?: Take;
}

/** voice.json. */
export interface VoiceRecord {
  edgewave: "voice";
  version: 1;
  quest: string;
  voices: Voices;
  /** Where the .wem files go under source/archive, as the other tool named it (mod\<author>\<quest>\vo). */
  archiveDir?: string;
  lines: Record<string, LineRecord>;
}

export type LineStatus = "none" | "made" | "stale";

/** Where a quest's takes and voice.json live, relative to the project's folder. */
export const voiceDir = (quest: string) => path.join("source", "raw", "edgewave", "voice", quest);
export const RecordFile = "voice.json";

/** A part of a file name: lower case, anything but letters and digits as _. */
export function namePart(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "x";
}

/** The line id in 16 hex digits, as the game's voice files are named. */
export function hexId(id: string): string {
  if (!/^\d+$/.test(id)) throw new Error(`A line id is a decimal number, not "${id}"`);
  const h = BigInt(id).toString(16);
  if (h.length > 16) throw new Error(`The line id ${id} is longer than 64 bits`);
  return h.padStart(16, "0");
}

/** <speaker>_<quest>_f_<hex>: the game's voice file name, without its extension. */
export function takeName(line: Pick<VoiceLine, "id" | "speaker">, quest: string, gender: Gender): string {
  return `${namePart(line.speaker)}_${namePart(quest)}_${gender === "female" ? "f" : "m"}_${hexId(line.id)}`;
}

export const isV = (speaker: string) => speaker.trim().toLowerCase() === "v";
export const needsBoth = (line: VoiceLine) => line.both ?? isV(line.speaker);
export const gendersOf = (line: VoiceLine): Gender[] => (needsBoth(line) ? ["female", "male"] : ["female"]);

const same = (a?: string, b?: string) => (a ?? "") === (b ?? "");

/** none: no take; made: a take of the line as it is; stale: a take of what it said before. */
export function lineStatus(line: VoiceLine, record?: VoiceRecord): LineStatus {
  const r = record?.lines[line.id];
  if (!r || !gendersOf(line).some((g) => r[g])) return "none";
  const complete = gendersOf(line).every((g) => r[g]);
  return complete && r.text === line.text && same(r.say, line.say) && same(r.direction, line.direction) ? "made" : "stale";
}

/** The voice a line's take is spoken in, or undefined when none is chosen. */
export function voiceFor(voices: Voices, speaker: string, gender: Gender): string | undefined {
  const v = voices[speaker] ?? Object.entries(voices).find(([k]) => k.toLowerCase() === speaker.toLowerCase())?.[1];
  if (typeof v === "string") return v || undefined;
  return v?.[gender] || undefined;
}

/** The speakers (and V's genders) the lines need a voice for and have none. */
export function missingVoices(lines: VoiceLine[], voices: Voices): string[] {
  const out = new Set<string>();
  for (const l of lines)
    for (const g of gendersOf(l))
      if (!voiceFor(voices, l.speaker, g)) out.add(needsBoth(l) ? `${l.speaker} (${g})` : l.speaker);
  return [...out];
}

/** Square-bracket delivery tags, as ElevenLabs v3 reads them. */
const Tag = /\s*\[[^\]\n]{1,40}\]\s*/g;

/** Whether a model reads the tags (ElevenLabs v3); others get them removed. */
export const readsTags = (model: string | undefined) => /(^|_)v3($|_)/.test(model ?? "");

/** The words to send for a line: say with its tags for v3, without them for other models, or the text. */
export function spoken(line: VoiceLine, model: string | undefined): string {
  if (!line.say?.trim()) return line.text;
  if (readsTags(model)) return line.say.trim();
  const plain = line.say.replace(Tag, " ").replace(/\s+([,.!?…])/g, "$1").replace(/\s+/g, " ").trim();
  return plain || line.text;
}

/** The lines that need a take: those not voiced as they are, or all with redo. */
export function toVoice(lines: VoiceLine[], record: VoiceRecord | undefined, redo = false): VoiceLine[] {
  return lines.filter((l) => redo || lineStatus(l, record) !== "made");
}

export function newRecord(quest: string): VoiceRecord {
  return { edgewave: "voice", version: 1, quest, voices: {}, lines: {} };
}

/** voice.json's text as a record; a new one when it is missing or not EDGEwave's. */
export function readRecord(text: string | undefined, quest: string): VoiceRecord {
  if (!text?.trim()) return newRecord(quest);
  let j: Partial<VoiceRecord>;
  try {
    j = JSON.parse(text) as Partial<VoiceRecord>;
  } catch (e) {
    throw new Error(`voice.json is not valid JSON: ${(e as Error).message}`);
  }
  if (!j || j.edgewave !== "voice" || !j.lines || typeof j.lines !== "object") throw new Error("voice.json is not EDGEwave's voice record");
  const r: VoiceRecord = { edgewave: "voice", version: 1, quest: j.quest ?? quest, voices: j.voices ?? {}, lines: j.lines };
  if (typeof j.archiveDir === "string") r.archiveDir = j.archiveDir;
  return r;
}

export const formatRecord = (r: VoiceRecord) => JSON.stringify(r, null, 2) + "\n";

/** The record with a line's new take; the take it replaces becomes previous. */
export function withTake(record: VoiceRecord, line: VoiceLine, take: Take): VoiceRecord {
  const old = record.lines[line.id];
  const entry: LineRecord = { scene: line.scene, speaker: line.speaker, ...take };
  if (old && (old.female || old.male)) {
    const { scene: _s, speaker: _p, previous: _q, ...was } = old;
    entry.previous = was;
  }
  return { ...record, lines: { ...record.lines, [line.id]: entry } };
}

/** The game path of a take's .wem under the archive folder EDGEquest names (mod\<author>\<quest>\vo). */
export const wemPath = (archiveDir: string, name: string) => `${archiveDir.replace(/[\\/]+$/, "").replace(/\//g, "\\")}\\${name}.wem`;

/** Checks lines as they come from another tool, with a message naming what is wrong. */
export function checkLines(lines: unknown): VoiceLine[] {
  if (!Array.isArray(lines) || !lines.length) throw new Error("No lines to voice");
  return lines.map((l, i) => {
    const x = l as Partial<VoiceLine>;
    for (const k of ["id", "scene", "speaker", "text"] as const)
      if (typeof x[k] !== "string" || !x[k]) throw new Error(`Line ${i + 1} has no ${k}`);
    hexId(x.id!);
    return x as VoiceLine;
  });
}
