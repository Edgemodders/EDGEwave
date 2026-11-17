// The EDGE Library, EDGEwave's part. The rules are EDGEbuilder's, shared by every EDGE tool:
// https://edgemodders.github.io/EDGEbuilder/library.html#shared-rules (for modders: https://edgemodders.ai/wiki/library.html).
//
// One root for every EDGE tool, kept in %APPDATA%\EDGE\library.json ({ "root": ... }); the folders under it are
// the modder's, and tools never make folders on their own. EDGEwave's items are sounds, <name>.sound.asset, in the
// same shape as on the Desk (src/desk.ts). Plain .wav, .ogg, .mp3 and .flac files in any folder are items as they
// are. A project notes what it took from the Library in source/library.json, the came-from note every tool
// writes the same way, each tool rewriting only its own entries. No VS Code imports, for the unit tests.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { copyMix, freeFolder, freeItemFolder, isInside, itemNameOf, projectSoundsDir, readItem, removeFolder, renamed, writeRecord, ItemEnding, type AssetRecord, type SoundItem } from "./desk";
import { Extension } from "./doc";

export class LibraryError extends Error {}

// ---- the root -------------------------------------------------------------------------------------------

/** Where the EDGE tools keep the Library's root. EDGE_LIBRARY_CONFIG for the tests. */
export function libraryConfigFile(): string {
  if (process.env.EDGE_LIBRARY_CONFIG) return process.env.EDGE_LIBRARY_CONFIG;
  return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "EDGE", "library.json");
}

/** The root as recorded, even when its folder is missing (a drive unplugged): for saying so. */
export function recordedLibraryRoot(file = libraryConfigFile()): string | undefined {
  try {
    const root = (JSON.parse(fs.readFileSync(file, "utf8")) as { root?: unknown }).root;
    return typeof root === "string" && root.trim() ? root.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** The Library's root, when one is set and its folder is there. */
export function libraryRoot(file = libraryConfigFile()): string | undefined {
  const root = recordedLibraryRoot(file);
  return root && fs.existsSync(root) ? root : undefined;
}

/** Makes the root folder and records it for every EDGE tool, keeping the file's other fields. */
export function setLibraryRoot(root: string, opts: { gameDir?: string; file?: string } = {}): string {
  root = path.resolve(root);
  if (opts.gameDir && (isInside(root, opts.gameDir) || isInside(opts.gameDir, root))) throw new LibraryError(`The Library must not be inside the game's folder, or hold it: ${root}`);
  const file = opts.file ?? libraryConfigFile();
  fs.mkdirSync(root, { recursive: true });
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    // The first tool to set it.
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...data, root }, null, 2));
  return root;
}

/** The modder's Documents folder, wherever Windows keeps it (OneDrive or another drive). */
function documentsFolder(): string {
  const fallback = path.join(os.homedir(), "Documents");
  if (process.platform !== "win32") return fallback;
  try {
    const out = execFileSync("reg", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders", "/v", "Personal"], { encoding: "utf8", windowsHide: true, timeout: 5000 });
    const m = /Personal\s+REG_(?:EXPAND_)?SZ\s+(.+)/.exec(out);
    return m ? m[1].trim().replace(/%([^%]+)%/g, (all, name: string) => process.env[name] ?? all) : fallback;
  } catch {
    return fallback;
  }
}

/** The folder offered the first time: Documents\EDGE Library. */
export const suggestedLibraryRoot = () => path.join(documentsFolder(), "EDGE Library");

// ---- folders ----------------------------------------------------------------------------------------------

/** Items of any tool end so; they are not folders to walk into. */
const AnyItem = /\.(asset|bake)$/i;
const toRel = (root: string, p: string) => path.relative(root, p).split(path.sep).join("/");

/** A folder under the root as the modder typed it, with `/`; throws on what could leave the root. "" is the root. */
export function safeFolder(folder: string | undefined): string {
  const parts = (folder ?? "").split(/[\\/]+/).filter((p) => p !== "");
  for (const p of parts) {
    if (p === "." || p === "..") throw new LibraryError(`A Library folder cannot go through "${p}": ${folder}`);
    if (/[<>:"|?*\u0000-\u001f]/.test(p) || /[. ]$/.test(p)) throw new LibraryError(`Not a folder name: "${p}"`);
    if (AnyItem.test(p)) throw new LibraryError(`"${p}" is a Library item, not a folder.`);
  }
  return parts.join("/");
}

export const folderPath = (root: string, rel: string) => path.join(root, ...safeFolder(rel).split("/").filter(Boolean));

/** The modder's folders under the root, with `/`, leaving out items and hidden folders. */
export function libraryFolders(root: string, cap = 2000): string[] {
  const found: string[] = [];
  const walk = (dir: string, rel: string, depth: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (found.length >= cap) return;
      if (!e.isDirectory() || e.name.startsWith(".") || AnyItem.test(e.name)) continue;
      const child = rel ? `${rel}/${e.name}` : e.name;
      found.push(child);
      if (depth < 16) walk(path.join(dir, e.name), child, depth + 1);
    }
  };
  walk(root, "", 0);
  return found.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/** Plain sound files that are Library items as they are. */
export const PlainSound = /\.(wav|ogg|mp3|flac)$/i;

export interface LibrarySound extends SoundItem {
  /** Its folder under the root, with `/`. */
  rel: string;
}

export interface LibraryFolder {
  /** This folder under the root, with `/`; "" for the root. */
  rel: string;
  folders: { name: string; rel: string }[];
  /** EDGEwave's sound items. Other tools' items are not EDGEwave's to show. */
  sounds: LibrarySound[];
  /** Plain sound files. */
  files: { name: string; file: string }[];
}

const withRel = (root: string, item: SoundItem | undefined): LibrarySound | undefined => (item ? { ...item, rel: toRel(root, item.folder) } : undefined);

/** One folder of the Library: its sub-folders, its sound items and its plain sound files. */
export function libraryFolder(root: string, rel = ""): LibraryFolder {
  const here = safeFolder(rel);
  const dir = folderPath(root, here);
  const out: LibraryFolder = { rel: here, folders: [], sounds: [], files: [] };
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  const by = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });
  for (const e of entries.sort((a, b) => by(a.name, b.name))) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name.toLowerCase().endsWith(ItemEnding)) {
        const s = withRel(root, readItem(full));
        if (s) out.sounds.push(s);
      } else if (!AnyItem.test(e.name)) out.folders.push({ name: e.name, rel: here ? `${here}/${e.name}` : e.name });
    } else if (PlainSound.test(e.name)) out.files.push({ name: e.name, file: full });
  }
  return out;
}

/** Every sound item in the Library. */
export function librarySounds(root: string, cap = 5000): LibrarySound[] {
  const out: LibrarySound[] = [];
  const walk = (dir: string, depth: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= cap || !e.isDirectory() || e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.name.toLowerCase().endsWith(ItemEnding)) {
        const s = withRel(root, readItem(full));
        if (s) out.push(s);
      } else if (!AnyItem.test(e.name) && depth < 16) walk(full, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

export const soundById = (root: string, id: string) => librarySounds(root).find((s) => s.asset?.id === id);

/** A game path's folders, for Use the game path: base\localization\en-us\vo\x.wem gives base/localization/en-us/vo. */
export function gamePathFolders(gamePath: string): string[] {
  return gamePath.split(/[\\/]+/).filter(Boolean).slice(0, -1).map((p) => p.replace(/[<>:"|?*\u0000-\u001f]/g, "_"));
}

// ---- Add to Library ---------------------------------------------------------------------------------------

export interface LibraryAddResult {
  folder: string;
  /** Under the root, with `/`. */
  rel: string;
  id: string;
  version: number;
  /** An earlier version in the Library was updated, where it is. */
  updated: boolean;
  /** Sources the mix names that were missing. */
  missing: string[];
}

/**
 * Add to Library: a Desk mix as a sound item in the Library, in `folder` (and under its game path's folders
 * with `useGamePath`). The same mix again (by its id) updates the item where it is, one version up. It is
 * built in a hidden folder beside its place and moved there whole, so a failure leaves nothing half made.
 * The Desk item remembers where it went.
 */
export function addToLibrary(o: { item: SoundItem; root: string; folder?: string; useGamePath?: boolean; tool: string; gameDir?: string }): LibraryAddResult {
  const root = path.resolve(o.root);
  if (!fs.existsSync(root)) throw new LibraryError(`The Library's folder is missing: ${root}`);
  if (o.gameDir && isInside(root, o.gameDir)) throw new LibraryError(`The Library must not be inside the game's folder: ${root}`);
  if (isInside(o.item.folder, root)) throw new LibraryError("That sound is in the Library already. Edit it on the Desk, then Add to Library from there to update it.");
  if (!o.item.asset) throw new LibraryError(`${o.item.name} has no asset.json: it is not one of EDGEwave's Desk mixes.`);
  if (!o.item.rendered) throw new LibraryError(`Render ${o.item.title} first: a project takes its WAV.`);
  const desk = o.item.asset;
  const existing = soundById(root, desk.id);

  let target: string;
  if (existing) target = existing.folder;
  else {
    const parent = path.join(folderPath(root, o.folder ?? ""), ...(o.useGamePath && desk.gamePath ? gamePathFolders(desk.gamePath) : []));
    target = freeItemFolder(parent, o.item.name);
  }
  const name = itemNameOf(target);
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true });
  const work = path.join(parent, `.edgewave-add-${Date.now().toString(36)}`);
  const building = path.join(work, path.basename(target));
  try {
    const copied = copyMix(o.item.doc, path.join(building, "source", "raw"), name);
    const version = existing ? (existing.asset?.version ?? 0) + 1 : desk.version;
    const date = new Date().toISOString();
    const did = existing ? `Updated in the Library, version ${version}` : "Added to the Library";
    const { library: _onDesk, ...kept } = desk;
    const history = [...desk.history, { tool: o.tool, did, date }];
    writeRecord(building, { ...renamed(kept as AssetRecord, name), version, history, tools: { ...desk.tools, edgewave: o.tool.replace(/^EDGEwave /, "") } });
    if (existing) {
      const old = path.join(work, "old");
      fs.renameSync(target, old);
      try {
        fs.renameSync(building, target);
      } catch (e) {
        fs.renameSync(old, target);
        throw e;
      }
    } else fs.renameSync(building, target);
    const rel = toRel(root, target);
    writeRecord(o.item.folder, { ...desk, version, history, library: { path: rel, version, date } });
    return { folder: target, rel, id: desk.id, version, updated: !!existing, missing: copied.missing };
  } finally {
    removeFolder(work);
  }
}

// ---- Edit on the Desk -------------------------------------------------------------------------------------

/**
 * A Library sound back on the Desk, with its id, to change: Add to Library from there updates the Library's
 * item, one version up. A Desk item with the same id is replaced only with `replace`.
 */
export function editOnDesk(sound: LibrarySound, opts: { desk: string; tool: string; replace?: boolean }): { item: SoundItem; replaced: boolean } {
  const id = sound.asset?.id;
  if (!id || !sound.asset) throw new LibraryError(`${sound.title} has no asset.json: it is not one of EDGEwave's sounds.`);
  fs.mkdirSync(opts.desk, { recursive: true });
  const onDesk = fs
    .readdirSync(opts.desk)
    .filter((d) => d.toLowerCase().endsWith(ItemEnding))
    .map((d) => readItem(path.join(opts.desk, d)))
    .find((i) => i?.asset?.id === id);
  if (onDesk && !opts.replace) throw new LibraryError(`${sound.title} is on the Desk already: ${onDesk.folder}`);
  if (onDesk) removeFolder(onDesk.folder);
  const folder = freeItemFolder(opts.desk, sound.name);
  const name = itemNameOf(folder);
  copyMix(sound.doc, path.join(folder, "source", "raw"), name);
  const date = new Date().toISOString();
  writeRecord(folder, {
    ...renamed(sound.asset, name),
    library: { path: sound.rel, version: sound.asset.version, date },
    history: [...sound.asset.history, { tool: opts.tool, did: `Copied from the Library (version ${sound.asset.version}) to change`, date }],
  });
  return { item: readItem(folder)!, replaced: !!onDesk };
}

// ---- the came-from note -----------------------------------------------------------------------------------

/** One item of a project's source/library.json. Other tools' items are kept as they are. */
export interface NoteItem {
  id?: string;
  kind: string;
  path: string;
  version?: number;
  hash?: string;
  added: string;
  by: string;
  files: string[];
  [more: string]: unknown;
}

export interface Note {
  format: 1;
  items: NoteItem[];
  [more: string]: unknown;
}

export const By = "edgewave";
const noteFile = (projectDir: string) => path.join(projectDir, "source", "library.json");

export function readNote(projectDir: string): Note {
  try {
    const data = JSON.parse(fs.readFileSync(noteFile(projectDir), "utf8"));
    if (Array.isArray(data?.items)) return { ...data, format: 1, items: data.items };
  } catch {
    // none yet, or not readable: a new one is written
  }
  return { format: 1, items: [] };
}

function writeNote(projectDir: string, note: Note): void {
  fs.mkdirSync(path.dirname(noteFile(projectDir)), { recursive: true });
  fs.writeFileSync(noteFile(projectDir), JSON.stringify(note, null, 2) + "\n");
}

// ---- a Library sound into a project -----------------------------------------------------------------------

export interface FromLibraryResult {
  /** The mix in the project. */
  doc: string;
  version: number;
  /** Files copied, relative to the project's folder with `/`. */
  files: string[];
  /** The project had this sound already, and its copy was replaced. */
  replaced: boolean;
  missing: string[];
}

/**
 * Add to Project from the Library: the mix, its files and its render copied into the project's
 * source/raw/edgewave/sounds/<name>/, and the came-from note. A sound the project took before is replaced in
 * its folder, its earlier files removed first, so nothing stale stays.
 */
export function addFromLibrary(sound: LibrarySound, project: { dir: string; raw: string }): FromLibraryResult {
  const id = sound.asset?.id;
  if (!id) throw new LibraryError(`${sound.title} has no asset.json: it is not one of EDGEwave's sounds.`);
  const projectDir = path.resolve(project.dir);
  const note = readNote(projectDir);
  const earlier = note.items.find((i) => i.by === By && i.id === id);
  let dest: string | undefined;
  if (earlier) {
    const mix = earlier.files.find((f) => f.endsWith(Extension));
    if (mix) dest = path.dirname(path.join(projectDir, ...mix.split("/")));
    for (const f of earlier.files) {
      const file = path.resolve(projectDir, ...f.split("/"));
      if (isInside(file, projectDir) && file !== projectDir) fs.rmSync(file, { force: true });
    }
  }
  dest ??= freeFolder(projectSoundsDir(project.raw), sound.name);
  const copied = copyMix(sound.doc, dest, sound.name);
  const files = copied.files.map((f) => toRel(projectDir, f));
  const entry: NoteItem = { id, kind: "sound", path: sound.rel, version: sound.asset?.version ?? 1, added: new Date().toISOString(), by: By, files };
  note.items = [...note.items.filter((i) => !(i.by === By && i.id === id)), entry];
  writeNote(projectDir, note);
  return { doc: copied.doc, version: entry.version!, files, replaced: !!earlier, missing: copied.missing };
}

// ---- Refresh from Library ---------------------------------------------------------------------------------

export interface RefreshLine {
  entry: NoteItem;
  /** The Library's item now, when found (by id, else by path). */
  sound?: LibrarySound;
  /** newer: the Library has a later version; same: up to date; missing: not found in the Library. */
  state: "newer" | "same" | "missing";
}

/** EDGEwave's sounds in a project, from its came-from note, against the Library. */
export function refreshList(projectDir: string, root: string): RefreshLine[] {
  const ours = readNote(projectDir).items.filter((i) => i.by === By && i.kind === "sound");
  if (!ours.length) return [];
  const sounds = librarySounds(root);
  return ours.map((entry) => {
    const sound = sounds.find((s) => entry.id && s.asset?.id === entry.id) ?? sounds.find((s) => s.rel === entry.path);
    if (!sound) return { entry, state: "missing" as const };
    return { entry, sound, state: (sound.asset?.version ?? 0) > (entry.version ?? 0) ? ("newer" as const) : ("same" as const) };
  });
}

/** A project's note entry for the mix at `docFile`, when it came from the Library. */
export function noteEntryFor(projectDir: string, docFile: string): NoteItem | undefined {
  const rel = toRel(path.resolve(projectDir), path.resolve(docFile));
  return readNote(projectDir).items.find((i) => i.by === By && i.files.some((f) => f.toLowerCase() === rel.toLowerCase()));
}
