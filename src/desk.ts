// EDGEwave's Desk: its own scratch space for mixes in progress, kept across restarts until they go into a
// project (Move to Project) or the Library (Add to Library). A norm for the EDGE tools that make things
// (the Library's shared rules: https://edgemodders.github.io/EDGEbuilder/library.html#shared-rules). Each mix
// on the Desk is an item in the Library's own shape, so Add to Library is a copy:
//
//   %LOCALAPPDATA%\EDGEwave\desk\<name>.sound.asset\
//     asset.json                    id, name, kind "sound", main (the mix), render (the WAV), version, history
//     source\raw\<name>.edgewave    the mix
//     source\raw\<name>.sounds\     sound files dropped on it, and files it used from elsewhere
//     source\raw\<name>.gen\        ElevenLabs takes
//     source\raw\<name>.wav         its render
//
// copyMix copies a mix with its own files to another folder under another name, and takes in the files it
// used from elsewhere, so every copy stands alone: Move to Project, Add to Library, Edit on the Desk, a
// Library sound into a project, and Rename all use it. No VS Code imports, for the unit tests.

import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { emptyDoc, Extension, formatDoc, parseDoc, type SoundDoc } from "./doc";
import { edgewaveHome } from "./events";

export const Kind = "sound";
export const ItemEnding = ".sound.asset";

/** The Desk's folder. EDGEWAVE_HOME moves it with the rest of EDGEwave's folder (the tests). */
export const deskDir = () => path.join(edgewaveHome(), "desk");

/** One line of an item's history. */
export interface HistoryLine {
  tool: string;
  did: string;
  date: string;
}

/** asset.json of a sound item, on the Desk or in the Library. */
export interface AssetRecord {
  format: 1;
  /** Made once, never changed: a project finds the item by it after a rename or a move. */
  id: string;
  name: string;
  kind: "sound";
  /** The mix, relative to the item's folder: the file EDGEwave opens. */
  main: string;
  /** The rendered WAV, relative to the item's folder: what a project takes. */
  render: string;
  /** Raised by each update in the Library. */
  version: number;
  history: HistoryLine[];
  tools?: Record<string, string>;
  /** The game file it was made from, when it was: Add to Library offers its game path as folders. */
  gamePath?: string;
  /** What it was made from (a game sound's source key), so opening that sound again with no project opens it. */
  from?: string;
  /** On the Desk: where Add to Library put it, so Add to Library again updates it there. */
  library?: { path: string; version: number; date: string };
  [more: string]: unknown;
}

export interface SoundItem {
  /** The item's folder, <name>.sound.asset. */
  folder: string;
  /** Its name, from the folder's name, which wins over asset.json. */
  name: string;
  /** asset.json's name, else the folder's. */
  title: string;
  /** The mix and its render, as full paths. */
  doc: string;
  render: string;
  rendered: boolean;
  asset?: AssetRecord;
  /** When it last changed, for the Desk's order. */
  at: number;
}

const ItemName = /^(.+)\.sound\.asset$/i;

/** Characters Windows does not allow in a file name, and a trailing dot or space. */
export function safeName(s: string): string {
  return s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "").trim() || "sound";
}

export const newId = () => randomBytes(8).toString("hex");

export const isInside = (child: string, parent: string): boolean => {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

const same = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/** A sound item from its folder; undefined when the folder is not one. */
export function readItem(folder: string): SoundItem | undefined {
  const m = ItemName.exec(path.basename(folder));
  if (!m) return undefined;
  let asset: AssetRecord | undefined;
  try {
    const a = JSON.parse(fs.readFileSync(path.join(folder, "asset.json"), "utf8")) as AssetRecord;
    if (a && typeof a.id === "string") asset = a;
  } catch {
    // An item with no readable asset.json still shows, by its folder name.
  }
  const name = m[1];
  const rel = (p: string | undefined, fallback: string) => path.join(folder, ...(typeof p === "string" && p ? p : fallback).split(/[\\/]+/));
  const doc = rel(asset?.main, `source/raw/${name}${Extension}`);
  const render = rel(asset?.render, `source/raw/${name}.wav`);
  let at = 0;
  try {
    at = Math.max(fs.statSync(folder).mtimeMs, fs.statSync(doc).mtimeMs);
  } catch {
    // no mix yet
  }
  return { folder, name, title: asset?.name?.trim() || name, doc, render, rendered: fs.existsSync(render), asset, at };
}

/** The mixes on the Desk, the last changed first. */
export function listDesk(dir = deskDir()): SoundItem[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && ItemName.test(e.name))
    .map((e) => readItem(path.join(dir, e.name)))
    .filter((i): i is SoundItem => !!i && fs.existsSync(i.doc))
    .sort((a, b) => b.at - a.at);
}

/** The Desk item that holds this mix, when it is on the Desk. */
export function deskItemOf(docFile: string, dir = deskDir()): SoundItem | undefined {
  if (!isInside(docFile, dir)) return undefined;
  const top = path.relative(dir, docFile).split(/[\\/]+/)[0];
  const item = top ? readItem(path.join(dir, top)) : undefined;
  return item && same(item.doc, docFile) ? item : undefined;
}

/** A folder for a new item called `name` (or a numbered name) in `parent`, not made yet. */
export function freeItemFolder(parent: string, name: string): string {
  const base = safeName(name);
  let target = path.join(parent, `${base}${ItemEnding}`);
  for (let n = 2; fs.existsSync(target); n++) target = path.join(parent, `${base}_${n}${ItemEnding}`);
  return target;
}

/** A free plain folder called `name` (or numbered) in `parent`. */
export function freeFolder(parent: string, name: string): string {
  const base = safeName(name);
  let target = path.join(parent, base);
  for (let n = 2; fs.existsSync(target); n++) target = path.join(parent, `${base}_${n}`);
  return target;
}

export const itemNameOf = (folder: string) => path.basename(folder).replace(/\.sound\.asset$/i, "");

/** The record for a new item. */
export function newRecord(name: string, tool: string, did: string, more: Partial<AssetRecord> = {}): AssetRecord {
  const file = safeName(name);
  return {
    format: 1,
    id: newId(),
    name,
    kind: "sound",
    main: `source/raw/${file}${Extension}`,
    render: `source/raw/${file}.wav`,
    version: 1,
    history: [{ tool, did, date: new Date().toISOString() }],
    tools: { edgewave: tool.replace(/^EDGEwave /, "") },
    ...more,
  };
}

export function writeRecord(folder: string, record: AssetRecord): void {
  fs.writeFileSync(path.join(folder, "asset.json"), JSON.stringify(record, null, 2) + "\n");
}

/** A record for an item now called `name`: main and render follow it. */
export function renamed(record: AssetRecord, name: string): AssetRecord {
  const file = safeName(name);
  return { ...record, name, main: `source/raw/${file}${Extension}`, render: `source/raw/${file}.wav` };
}

/**
 * A new mix on the Desk: an empty one (Create a Sound), or `doc` (a game sound opened with no project).
 * `from` is what it was made from, said in its history.
 */
export function newOnDesk(o: { name: string; tool: string; doc?: SoundDoc; did?: string; gamePath?: string; from?: string; dir?: string }): SoundItem {
  const dir = o.dir ?? deskDir();
  const folder = freeItemFolder(dir, o.name);
  const name = itemNameOf(folder);
  const raw = path.join(folder, "source", "raw");
  fs.mkdirSync(raw, { recursive: true });
  const doc = o.doc ? { ...o.doc, render: { ...o.doc.render, file: `${name}.wav` } } : emptyDoc(`${name}.wav`);
  fs.writeFileSync(path.join(raw, `${name}${Extension}`), formatDoc(doc));
  writeRecord(folder, newRecord(name, o.tool, o.did ?? "Made on the Desk", { ...(o.gamePath ? { gamePath: o.gamePath } : {}), ...(o.from ? { from: o.from } : {}) }));
  return readItem(folder)!;
}

/** The Desk's mix made from this game sound before (asset.json's from, its source's key), if any: opening the sound again opens it. */
export function deskMixFor(sourceKey: string, dir = deskDir()): SoundItem | undefined {
  return listDesk(dir).find((i) => i.asset?.from === sourceKey);
}

export interface CopiedMix {
  /** The new mix. */
  doc: string;
  /** Every file written, as full paths. */
  files: string[];
  /** Sources that were missing, kept as they were. */
  missing: string[];
}

const filesUnder = (dir: string): string[] =>
  fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(path.join(dir, e.name)) : [path.join(dir, e.name)])) : [];

/**
 * Copies the mix `docFile` into `destDir` as `<name>.edgewave`, with its own folders (<name>.sounds, <name>.gen),
 * its render as <name>.wav, and every sound file it uses from elsewhere copied into <name>.sounds (the same file
 * twice is one copy), its tracks pointing at the copies. Game sounds stay references to the player's game.
 */
export function copyMix(docFile: string, destDir: string, name: string): CopiedMix {
  const doc = parseDoc(fs.readFileSync(docFile, "utf8"));
  const from = path.dirname(docFile);
  const old = path.basename(docFile, path.extname(docFile));
  name = safeName(name);
  fs.mkdirSync(destDir, { recursive: true });
  const files: string[] = [];
  const missing: string[] = [];
  // The mix's own folders, whole: dropped files, ElevenLabs takes and their earlier takes.
  const own = new Map<string, string>();
  for (const ext of [".sounds", ".gen"]) {
    const src = path.join(from, old + ext);
    const dst = path.join(destDir, name + ext);
    if (!fs.existsSync(src) || same(src, dst)) continue;
    fs.cpSync(src, dst, { recursive: true });
    files.push(...filesUnder(dst));
    own.set(src, name + ext);
  }
  const taken = new Map<string, string>();
  const intoSounds = (abs: string): string => {
    const known = taken.get(abs.toLowerCase());
    if (known) return known;
    const data = fs.readFileSync(abs);
    const ext = path.extname(abs);
    const base = path.basename(abs, ext);
    let rel = `${name}.sounds/${base}${ext}`;
    for (let n = 2; ; n++) {
      const at = path.join(destDir, ...rel.split("/"));
      if (!fs.existsSync(at)) {
        fs.mkdirSync(path.dirname(at), { recursive: true });
        fs.writeFileSync(at, data);
        files.push(at);
        break;
      }
      if (fs.readFileSync(at).equals(data)) break;
      rel = `${name}.sounds/${base} ${n}${ext}`;
    }
    taken.set(abs.toLowerCase(), rel);
    return rel;
  };
  for (const t of doc.tracks) {
    if (t.source.kind !== "file") continue;
    const abs = path.resolve(from, t.source.file);
    const inOwn = [...own.entries()].find(([src]) => isInside(abs, src));
    if (inOwn) {
      t.source = { ...t.source, file: [inOwn[1], ...path.relative(inOwn[0], abs).split(/[\\/]+/)].join("/") };
    } else if (fs.existsSync(abs)) {
      t.source = { ...t.source, file: intoSounds(abs) };
    } else {
      missing.push(abs);
      t.source = { ...t.source, file: abs };
    }
  }
  const render = path.resolve(from, doc.render.file);
  doc.render = { ...doc.render, file: `${name}.wav` };
  const renderTo = path.join(destDir, `${name}.wav`);
  if (fs.existsSync(render) && !same(render, renderTo)) {
    fs.copyFileSync(render, renderTo);
    files.push(renderTo);
  }
  const out = path.join(destDir, `${name}${Extension}`);
  fs.writeFileSync(out, formatDoc(doc));
  files.push(out);
  return { doc: out, files, missing };
}

/** A whole folder away, retrying a moment while Windows still holds a file in it. */
export function removeFolder(folder: string): void {
  fs.rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

/**
 * Renames a Desk item: a new folder under the new name with the mix copied (its folders and render follow
 * the name), the same id and history, then the old folder removed.
 */
export function renameItem(item: SoundItem, name: string, tool: string): SoundItem {
  const parent = path.dirname(item.folder);
  const folder = freeItemFolder(parent, name);
  const now = itemNameOf(folder);
  try {
    copyMix(item.doc, path.join(folder, "source", "raw"), now);
    const record = item.asset ?? newRecord(item.name, tool, "Made on the Desk");
    writeRecord(folder, { ...renamed(record, now), history: [...record.history, { tool, did: `Renamed from ${item.name}`, date: new Date().toISOString() }] });
  } catch (e) {
    removeFolder(folder);
    throw e;
  }
  removeFolder(item.folder);
  return readItem(folder)!;
}

/** Where a project keeps the mixes it took from the Desk or the Library: source/raw/edgewave/sounds/<name>/. */
export const projectSoundsDir = (raw: string) => path.join(raw, "edgewave", "sounds");

/**
 * Move to Project: the mix, its files and its render copied into the project's source/raw/edgewave/sounds/<name>/,
 * then taken off the Desk. Its Library copy, if it has one, stays as it is.
 */
export function moveToProject(item: SoundItem, raw: string): CopiedMix {
  const dest = freeFolder(projectSoundsDir(raw), item.name);
  const copied = copyMix(item.doc, dest, item.name);
  removeFolder(item.folder);
  return copied;
}

/** Copy to the Desk: a mix kept anywhere (a project, another folder) as a new Desk item, its files taken in. */
export function copyToDesk(docFile: string, tool: string, dir = deskDir()): SoundItem {
  const folder = freeItemFolder(dir, path.basename(docFile, path.extname(docFile)));
  const name = itemNameOf(folder);
  try {
    copyMix(docFile, path.join(folder, "source", "raw"), name);
    writeRecord(folder, newRecord(name, tool, `Copied to the Desk from ${docFile}`));
  } catch (e) {
    removeFolder(folder);
    throw e;
  }
  return readItem(folder)!;
}

/**
 * Whether a Desk mix changed since Add to Library (or Edit on the Desk) last matched it with the Library: its mix,
 * its render or a file in its own folders written after then. The Library's version goes up only with the next
 * Add to Library, so the Desk says "changed since" in between.
 */
export function changedSinceLibrary(item: SoundItem): boolean {
  const date = item.asset?.library ? Date.parse(item.asset.library.date) : NaN;
  if (Number.isNaN(date)) return false;
  const raw = path.dirname(item.doc);
  const own = [".sounds", ".gen"].flatMap((ext) => filesUnder(path.join(raw, item.name + ext)));
  // A moment's grace: the copy is written just before the date is.
  return [item.doc, item.render, ...own].some((f) => {
    try {
      return fs.statSync(f).mtimeMs > date + 2000;
    } catch {
      return false;
    }
  });
}
