// A quest's takes as .wem files (V2 step 5, EDGEwave #5): each current take's WAV through the modder's
// Wwise (src/wwise.ts) to <project>/source/archive/<archiveDir>/<name>.wem, the folder EDGEquest names
// (mod\<author>\<quest>\vo), with its game path in voice.json's wem, which EDGEquest's voice-over map points
// at. A .wem is made again when its take's WAV changes (a new take, Previous, a studio render). No VS Code:
// the Voice Lines panel and the MCP server both run it.

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { wemPath, type Gender, type VoiceRecord } from "./voice";
import { loadRecord, saveRecord } from "./voiceBatch";
import { convert, findWwise, WwiseVersion, type Run, type Wwise } from "./wwise";

const Genders: Gender[] = ["female", "male"];

/** Hashes by file, kept while its size and time are the same: the panel asks on every change. */
const hashes = new Map<string, { key: string; hash: string }>();

export function sha1(file: string): string {
  const s = fs.statSync(file);
  const key = `${s.size}:${s.mtimeMs}`;
  const known = hashes.get(file);
  if (known?.key === key) return known.hash;
  const hash = createHash("sha1").update(fs.readFileSync(file)).digest("hex");
  hashes.set(file, { key, hash });
  return hash;
}

/** A .wem's file in the project, from its game path. */
export const wemFile = (projectDir: string, gamePath: string) => path.join(projectDir, "source", "archive", ...gamePath.split(/[\\/]+/));

export interface WemTodo {
  id: string;
  gender: Gender;
  wav: string;
  gamePath: string;
  hash: string;
}

/** The takes whose .wem is missing, made from another WAV, or at another path than archiveDir gives now. */
export function staleWems(projectDir: string, record: VoiceRecord, ids?: string[]): WemTodo[] {
  if (!record.archiveDir) return [];
  const out: WemTodo[] = [];
  for (const [id, line] of Object.entries(record.lines)) {
    if (ids && !ids.includes(id)) continue;
    for (const g of Genders) {
      const take = line[g];
      if (!take) continue;
      const wav = path.join(projectDir, take);
      if (!fs.existsSync(wav)) continue;
      const gamePath = wemPath(record.archiveDir, path.basename(take).replace(/\.wav$/i, ""));
      const hash = sha1(wav);
      const fresh = line.wem?.[g] === gamePath && line.wemFrom?.[g] === hash && fs.existsSync(wemFile(projectDir, gamePath));
      if (!fresh) out.push({ id, gender: g, wav, gamePath, hash });
    }
  }
  return out;
}

/** How a quest's .wem files stand, for the panel and the MCP tools. */
export interface WemState {
  /** Takes with a current .wem. */
  made: number;
  /** Takes with a WAV. */
  takes: number;
  /** Why none can be made now: no Wwise, no archive folder. */
  reason?: string;
  /** The Wwise used, such as 2023.1.14.8770. */
  wwise?: string;
}

export function wemState(projectDir: string, record: VoiceRecord, wwise: Wwise | undefined): WemState {
  let takes = 0;
  for (const line of Object.values(record.lines)) for (const g of Genders) if (line[g] && fs.existsSync(path.join(projectDir, line[g]!))) takes++;
  const stale = staleWems(projectDir, record).length;
  const state: WemState = { made: record.archiveDir ? takes - stale : 0, takes, wwise: wwise?.version };
  if (!record.archiveDir) state.reason = "No archive folder for the .wem files yet: EDGEquest names it (mod\\<author>\\<quest>\\vo) when it opens Voice Lines or calls voice_lines.";
  else if (!wwise) state.reason = `Wwise ${WwiseVersion} was not found, so the lines have WAVs and play as subtitles only. Install it from the Audiokinetic Launcher, or set edgewave.wwise.path.`;
  return state;
}

export interface WemResult extends WemState {
  /** Takes made into a .wem now. */
  converted: number;
  failed: { id: string; gender: Gender; message: string }[];
  record: VoiceRecord;
}

export interface WemOptions {
  projectDir: string;
  quest: string;
  /** Only these lines; all of them without. */
  ids?: string[];
  /** The edgewave.wwise.path setting. */
  configured?: string;
  wwise?: Wwise;
  exec?: Run;
  home?: string;
  log?: (s: string) => void;
}

/** Makes the .wem files the quest's takes need, in one Wwise run, and records them in voice.json. */
export async function makeWems(o: WemOptions): Promise<WemResult> {
  const wwise = o.wwise ?? findWwise({ configured: o.configured });
  let record = loadRecord(o.projectDir, o.quest);
  const todo = wwise ? staleWems(o.projectDir, record, o.ids) : [];
  const failed: WemResult["failed"] = [];
  let converted = 0;
  if (wwise && todo.length) {
    const items = todo.map((t) => ({ wav: t.wav, out: wemFile(o.projectDir, t.gamePath) }));
    const r = await convert(wwise, items, { exec: o.exec, home: o.home, log: o.log });
    // voice.json is read again: a take may have been kept while Wwise ran. A .wem is recorded only while
    // its take is still the WAV it was made from.
    record = loadRecord(o.projectDir, o.quest);
    const lines = { ...record.lines };
    todo.forEach((t, i) => {
      const bad = r.failed.find((f) => f.out === items[i].out);
      if (bad) return void failed.push({ id: t.id, gender: t.gender, message: bad.message });
      const line = lines[t.id];
      if (!line?.[t.gender] || path.join(o.projectDir, line[t.gender]!) !== t.wav || sha1(t.wav) !== t.hash) return;
      lines[t.id] = { ...line, wem: { ...line.wem, [t.gender]: t.gamePath }, wemFrom: { ...line.wemFrom, [t.gender]: t.hash } };
      converted++;
    });
    record = { ...record, lines };
    saveRecord(o.projectDir, record);
    for (const f of failed) o.log?.(`No .wem for line ${f.id} (${f.gender}): ${f.message}`);
  }
  return { ...wemState(o.projectDir, record, wwise), converted, failed, record };
}
