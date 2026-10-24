// Voice a quest's lines through ElevenLabs and keep the takes (V2, EDGEwave #5). No VS Code: the Voice
// Lines panel and the MCP server both run it. Each take is a mono WAV named as the game names voice files,
// in the quest's folder under source/raw/edgewave/voice; voice.json is written after every line, so a
// batch stopped half way keeps what it made. A take that is replaced is kept as <name>.previous.wav.

import * as fs from "node:fs";
import * as path from "node:path";
import { Extension, formatDoc, newDoc, parseDoc } from "./doc";
import { ElevenLabs, formatRefused, pcmToWav } from "./elevenlabs";
import {
  formatRecord,
  gendersOf,
  missingVoices,
  readRecord,
  RecordFile,
  spoken,
  takeName,
  toVoice,
  voiceDir,
  voiceFor,
  withTake,
  type Gender,
  type Take,
  type VoiceLine,
  type VoiceRecord,
  type Voices,
} from "./voice";

/** ElevenLabs v3 reads the delivery tags EDGEquest writes in say. */
export const DefaultModel = "eleven_v3";
/** The rate tried when the plan refuses 48 kHz. */
export const FallbackRate = 24000;

const rel = (projectDir: string, abs: string) => path.relative(projectDir, abs).replace(/\\/g, "/");

export function recordPath(projectDir: string, quest: string): string {
  return path.join(projectDir, voiceDir(quest), RecordFile);
}

/** The quest's voice.json, or a new record when there is none. */
export function loadRecord(projectDir: string, quest: string): VoiceRecord {
  const f = recordPath(projectDir, quest);
  return readRecord(fs.existsSync(f) ? fs.readFileSync(f, "utf8") : undefined, quest);
}

export function saveRecord(projectDir: string, record: VoiceRecord): void {
  const f = recordPath(projectDir, record.quest);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const temp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(temp, formatRecord(record));
  fs.renameSync(temp, f);
}

/**
 * Keeps a line's new take: writes the WAVs given (one gender or both), moves the files they replace to
 * <name>.previous.wav, and records the take, the one before it as previous. A gender not given keeps its
 * file. Returns the new record (not yet saved).
 */
export function keepTake(projectDir: string, record: VoiceRecord, line: VoiceLine, wavs: Partial<Record<Gender, Uint8Array>>, made: Pick<Take, "model">): VoiceRecord {
  const dir = path.join(projectDir, voiceDir(record.quest));
  fs.mkdirSync(dir, { recursive: true });
  const old = record.lines[line.id];
  const take: Take = { text: line.text, made: new Date().toISOString() };
  if (line.say) take.say = line.say;
  if (line.direction) take.direction = line.direction;
  if (made.model) take.model = made.model;
  const moved: Partial<Record<Gender, string>> = {};
  for (const g of gendersOf(line)) {
    const wav = wavs[g];
    if (!wav) {
      if (old?.[g]) take[g] = old[g];
      continue;
    }
    const name = takeName(line, record.quest, g);
    const abs = path.join(dir, `${name}.wav`);
    if (fs.existsSync(abs)) {
      const prev = abs.replace(/\.wav$/i, ".previous.wav");
      fs.renameSync(abs, prev);
      moved[g] = rel(projectDir, prev);
      keepStudioDoc(dir, name);
    }
    fs.writeFileSync(abs, wav);
    take[g] = rel(projectDir, abs);
  }
  const next = withTake(record, line, take);
  const p = next.lines[line.id].previous;
  if (p) for (const g of Object.keys(moved) as Gender[]) p[g] = moved[g];
  return next;
}

/**
 * A take opened in the studio is <name>.edgewave, rendering to <name>.wav. When a new take replaces it, the
 * document goes with the old take: <name>.previous.edgewave, rendering to <name>.previous.wav, so a render
 * never writes over the new take.
 */
function keepStudioDoc(dir: string, name: string): void {
  const docFile = path.join(dir, `${name}${Extension}`);
  if (!fs.existsSync(docFile)) return;
  try {
    const doc = parseDoc(fs.readFileSync(docFile, "utf8"));
    doc.render.file = `${name}.previous.wav`;
    fs.writeFileSync(path.join(dir, `${name}.previous${Extension}`), formatDoc(doc));
    fs.rmSync(docFile);
  } catch {
    // Not a document EDGEwave can read: left as it is.
  }
}

/** A studio document for a take, made the first time: its source a copy of the take, its render the take. */
export function studioDoc(projectDir: string, line: VoiceLine, quest: string, gender: Gender): string {
  const dir = path.join(projectDir, voiceDir(quest));
  const name = takeName(line, quest, gender);
  const docFile = path.join(dir, `${name}${Extension}`);
  if (fs.existsSync(docFile)) return docFile;
  const take = path.join(dir, `${name}.wav`);
  if (!fs.existsSync(take)) throw new Error("This take has no WAV yet: generate it first.");
  fs.copyFileSync(take, path.join(dir, `${name}.take.wav`));
  fs.writeFileSync(docFile, formatDoc(newDoc({ kind: "file", file: `${name}.take.wav` }, `${name}.wav`, true)));
  return docFile;
}

/** Swaps a line's take with its previous one: the files and what each was made from. */
export function restorePrevious(projectDir: string, record: VoiceRecord, line: VoiceLine): VoiceRecord {
  const cur = record.lines[line.id];
  const prev = cur?.previous;
  if (!cur || !prev) throw new Error("This line has no previous take.");
  const { previous: _p, scene, speaker, ...now } = cur;
  const back: Take = { ...prev };
  for (const g of ["female", "male"] as Gender[]) {
    if (!prev[g] || !now[g] || prev[g] === now[g]) continue;
    const a = path.join(projectDir, now[g]!), b = path.join(projectDir, prev[g]!);
    const t = `${a}.${process.pid}.swap`;
    fs.renameSync(a, t);
    fs.renameSync(b, a);
    fs.renameSync(t, b);
    back[g] = now[g];
    now[g] = prev[g];
  }
  return { ...record, lines: { ...record.lines, [line.id]: { scene, speaker, ...back, previous: now } } };
}

export interface BatchOptions {
  projectDir: string;
  quest: string;
  lines: VoiceLine[];
  /** Voices chosen now; voice.json's are used for the rest, and these are saved to it. */
  voices?: Voices;
  /** Every line, not only those not voiced as they are. */
  redo?: boolean;
  model?: string;
  /** Hz; FallbackRate when the plan refuses it. */
  rate?: number;
  api: ElevenLabs;
  log?: (line: string) => void;
  /** After each line, with how many are done. */
  progress?: (done: number, total: number, line: VoiceLine) => void;
  /** Stops before the next line. */
  cancelled?: () => boolean;
}

export interface BatchResult {
  record: VoiceRecord;
  /** The lines voiced now. */
  voiced: string[];
  /** Lines that failed, with ElevenLabs' message. */
  failed: { id: string; message: string }[];
  /** Characters sent to ElevenLabs (what the plan counts). */
  characters: number;
  rate: number;
  model: string;
}

/** Voices the lines that need it (all of them with redo), saving voice.json after each. */
export async function voiceBatch(o: BatchOptions): Promise<BatchResult> {
  const model = o.model || DefaultModel;
  let record = loadRecord(o.projectDir, o.quest);
  const voices: Voices = { ...record.voices, ...(o.voices ?? {}) };
  const todo = toVoice(o.lines, record, o.redo);
  const missing = missingVoices(todo, voices);
  if (missing.length) throw new Error(`No voice chosen for ${missing.join(", ")}. Pick one per speaker (two for V, female and male).`);
  record = { ...record, voices };
  saveRecord(o.projectDir, record);
  let rate = o.rate ?? 48000;
  let characters = 0;
  const voiced: string[] = [];
  const failed: BatchResult["failed"] = [];
  const say = async (voiceId: string, text: string): Promise<Uint8Array> => {
    try {
      return pcmToWav(await o.api.speak(voiceId, { text, model }, rate), rate);
    } catch (e) {
      if (rate <= FallbackRate || !formatRefused(e)) throw e;
      o.log?.(`ElevenLabs refused ${rate} Hz (${(e as Error).message}); using ${FallbackRate} Hz`);
      rate = FallbackRate;
      return pcmToWav(await o.api.speak(voiceId, { text, model }, rate), rate);
    }
  };
  for (const [i, line] of todo.entries()) {
    if (o.cancelled?.()) break;
    try {
      const text = spoken(line, model);
      const wavs: Partial<Record<Gender, Uint8Array>> = {};
      for (const g of gendersOf(line)) {
        wavs[g] = await say(voiceFor(voices, line.speaker, g)!, text);
        characters += text.length;
      }
      record = keepTake(o.projectDir, record, line, wavs, { model });
      saveRecord(o.projectDir, record);
      voiced.push(line.id);
      o.log?.(`Voiced ${line.speaker}: ${text}`);
    } catch (e) {
      failed.push({ id: line.id, message: (e as Error).message });
      o.log?.(`Could not voice line ${line.id}: ${(e as Error).message}`);
      // A missing key or no credits fails every line the same way: stop at the first.
      if (/401|402|quota|credit|api key|unauthorized/i.test((e as Error).message)) break;
    }
    o.progress?.(i + 1, todo.length, line);
  }
  return { record, voiced, failed, characters, rate, model };
}
