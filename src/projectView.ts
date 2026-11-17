// The Project view: the open REDcode project, in two groups.
//   Mixes           the sound documents (.edgewave) in the open folder, kept current by a file watcher; those
//                   taken from the Library say so. A click opens one; ▶ plays its render.
//   Project sounds  what is in the project for the game to play, read from the project's own files, wherever
//                   the mix that made it is kept (the Desk, another folder): its named sounds (REDmod custom
//                   sounds in source/resources/info.json: new names, replaced or silenced game events), the
//                   WAVs that override game sounds (<hash>.wav under source/raw, which REDcode imports), and
//                   the sounds of its REDnode packages (their rednode-app.json). A click opens the Hear tab,
//                   ▶ plays it, and the hover's button opens the mix that made it, when one is known.

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { projectSounds, wavSeconds, type ProjectSound } from "./customSound";
import { Extension, type IntoGame } from "./doc";
import { noteEntryFor } from "./library";
import { debounced, mixItem, readMix, same, type MixRow } from "./mixRow";
import { redcode, type ProjectRef } from "./redcode";
import { RedmodTypes } from "./redmod";
import { AppsDir, Manifest } from "./rednode";
import { readIndex } from "./soundEvents";

/** A named sound in the project, by its event name. */
export interface NamedItem extends ProjectSound {
  kind: "named";
  /** The project's folder. */
  dir: string;
  /** How it came: a new name, or a game event replaced or silenced. */
  how: string;
  /** The mix that made it, when one is known. */
  mix?: vscode.Uri;
}

/** An override of a game sound, or a REDnode package's sound: a WAV in the project. */
export interface PlacedItem {
  kind: "placed";
  label: string;
  how: string;
  /** The WAV, as a full path. */
  file: string;
  mix?: vscode.Uri;
}

type Group = "mixes" | "sounds";
type Node = { kind: "group"; group: Group } | MixRow | NamedItem | PlacedItem | { kind: "note"; group: Group; text: string };

/** Where the project keeps its files: REDcode's open project, else an open folder with source/. */
interface Where {
  name?: string;
  dir: string;
  raw: string;
  resources: string;
}

/** A WAV named after a sound's hash, as Add to Project's override writes it and REDcode imports it. */
const OverrideWav = /^(\d{5,10})\.wav$/i;

/** The override WAVs under source/raw, skipping mixes' own folders and dot folders. */
export function overrideWavs(raw: string, most = 2000): { hash: number; file: string }[] {
  const out: { hash: number; file: string }[] = [];
  const walk = (dir: string, depth: number) => {
    if (out.length >= most || depth > 12) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!e.name.endsWith(".sounds") && !e.name.endsWith(".gen")) walk(p, depth + 1);
      } else {
        const m = OverrideWav.exec(e.name);
        if (m) out.push({ hash: Number(m[1]), file: p });
      }
    }
  };
  walk(raw, 0);
  return out;
}

/** The sounds of the project's REDnode packages: each manifest's sounds, with their files. */
export function packageSounds(resources: string): { id: string; dir: string; sound: string; file: string }[] {
  const apps = path.join(resources, ...AppsDir);
  if (!fs.existsSync(apps)) return [];
  return fs.readdirSync(apps, { withFileTypes: true }).flatMap((d) => {
    if (!d.isDirectory()) return [];
    const dir = path.join(apps, d.name);
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, Manifest), "utf8")) as { id?: string; sounds?: Record<string, string | { file?: string }> };
      return Object.entries(m.sounds ?? {}).flatMap(([sound, v]) => {
        const file = typeof v === "string" ? v : v?.file;
        return file ? [{ id: m.id ?? d.name, dir, sound, file: path.join(dir, ...file.split(/[\\/]+/)) }] : [];
      });
    } catch {
      return [];
    }
  });
}

export class ProjectView implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private project: ProjectRef | undefined;
  /** REDcode's sound effects by hash, for override WAVs' event names; undefined until read, or without REDcode. */
  private sfx?: Promise<Map<number, string | null> | undefined>;

  /** `otherMixes`: mixes kept outside the open folder (the Desk, Recent), which may have made a project sound. */
  constructor(context: vscode.ExtensionContext, private readonly otherMixes: () => string[]) {
    const refresh = debounced(() => this.refresh());
    for (const glob of [`**/*${Extension}`, "**/source/resources/info.json", "**/source/raw/**/*.wav", `**/${Manifest}`, "**/source/library.json"]) {
      const w = vscode.workspace.createFileSystemWatcher(glob);
      context.subscriptions.push(w, w.onDidCreate(refresh), w.onDidDelete(refresh), w.onDidChange(refresh));
    }
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(refresh), this.changed);
    redcode().then(
      (api) => {
        this.project = api.project();
        this.refresh();
        context.subscriptions.push(api.onDidChangeProject((p) => ((this.project = p), this.refresh())));
      },
      () => undefined,
    );
  }

  refresh(): void {
    this.changed.fire();
  }

  private where(): Where | undefined {
    if (this.project) return { name: this.project.name, dir: this.project.dir, raw: this.project.raw, resources: this.project.resources };
    const dir = vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath).find((d) => fs.existsSync(path.join(d, "source")));
    return dir ? { dir, raw: path.join(dir, "source", "raw"), resources: path.join(dir, "source", "resources") } : undefined;
  }

  /** The mixes in the open folder. */
  async mixes(): Promise<MixRow[]> {
    if (!vscode.workspace.workspaceFolders?.length) return [];
    const files = await vscode.workspace.findFiles(`**/*${Extension}`, "**/node_modules/**", 2000);
    const dir = this.where()?.dir;
    return files
      .map((uri) => {
        const entry = dir ? noteEntryFor(dir, uri.fsPath) : undefined;
        const row = readMix("project", uri.fsPath, entry ? { where: `from the Library, v${entry.version ?? 1}`, note: `Taken from the Library: ${entry.path}, version ${entry.version ?? 1}. Refresh from Library offers a newer version.` } : {});
        return { ...row, where: row.where ?? vscode.workspace.asRelativePath(path.dirname(uri.fsPath), false) };
      })
      .sort((a, b) => a.uri.fsPath.localeCompare(b.uri.fsPath));
  }

  private sfxNames(): Promise<Map<number, string | null> | undefined> {
    this.sfx ??= redcode()
      .then((api) => api.soundIndex())
      .then(
        (r) => new Map(r.events.flatMap((e) => e.sounds.map((s) => [s, e.name] as [number, string | null]))),
        () => undefined,
      );
    return this.sfx;
  }

  /** Every mix EDGEwave knows, with its last Add to Project choice, to find the one that made a sound. */
  private async choices(): Promise<{ uri: vscode.Uri; game: IntoGame }[]> {
    const files = [...(await this.mixes()).map((m) => m.uri.fsPath), ...this.otherMixes()];
    const seen = new Set<string>();
    return files.flatMap((f) => {
      const key = path.resolve(f).toLowerCase();
      if (seen.has(key)) return [];
      seen.add(key);
      const m = readMix("any", f);
      return m.game ? [{ uri: m.uri, game: m.game }] : [];
    });
  }

  /** What is in the project for the game to play, from its own files. */
  async sounds(): Promise<(NamedItem | PlacedItem)[] | string> {
    const w = this.where();
    if (!w) return "No project open";
    let named: ProjectSound[];
    try {
      named = projectSounds(w.dir);
    } catch (e) {
      return (e as Error).message;
    }
    const choices = await this.choices();
    const gameEvents = new Set((readIndex()?.events ?? []).map((e) => e.name.toLowerCase()));
    const out: (NamedItem | PlacedItem)[] = named.map((s) => {
      const made = choices.find((c) => "event" in c.game && c.game.event.toLowerCase() === s.name.toLowerCase());
      const r = made?.game;
      const how =
        r?.route === "new" ? "a new sound"
        : r?.route === "skip" || s.type === "mod_skip" ? "silences the game's event"
        : r?.route === "redmod" || gameEvents.has(s.name.toLowerCase()) ? "replaces the game's event"
        : "a new sound";
      return { ...s, kind: "named", dir: w.dir, how, mix: made?.uri };
    });
    const names = await this.sfxNames();
    for (const o of overrideWavs(w.raw)) {
      if (names && !names.has(o.hash)) continue;
      const event = names?.get(o.hash);
      const made = choices.find((c) => c.game.route === "override" && c.game.soundHash === o.hash);
      out.push({ kind: "placed", label: `sound ${o.hash}`, how: `overrides the game's sound${event ? ` (${event})` : ""}`, file: o.file, mix: made?.uri });
    }
    for (const p of packageSounds(w.resources)) {
      const made = choices.find((c) => c.game.route === "rednode" && c.game.sound === p.sound && same(path.resolve(w.dir, c.game.package), p.dir));
      out.push({ kind: "placed", label: p.sound, how: `in REDnode package ${p.id}`, file: p.file, mix: made?.uri });
    }
    return out;
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (!node) {
      if (!vscode.workspace.workspaceFolders?.length) return [];
      return [
        { kind: "group", group: "mixes" },
        { kind: "group", group: "sounds" },
      ];
    }
    if (node.kind !== "group") return [];
    if (node.group === "sounds") {
      const s = await this.sounds();
      if (typeof s !== "string" && s.length) return s;
      return [{ kind: "note", group: "sounds", text: typeof s === "string" ? s : "None yet: Add to Project in a mix puts it here" }];
    }
    const mixes = await this.mixes();
    return mixes.length ? mixes : [{ kind: "note", group: "mixes", text: "No mixes in the open folder: + makes one" }];
  }

  getTreeItem(n: Node): vscode.TreeItem {
    if (n.kind === "group") {
      const mixes = n.group === "mixes";
      const item = new vscode.TreeItem(mixes ? "Mixes" : "Project sounds", vscode.TreeItemCollapsibleState.Expanded);
      item.id = `group:${n.group}`;
      item.contextValue = mixes ? "edgewave.mixesGroup" : "edgewave.namedGroup";
      if (mixes) {
        const w = this.where();
        item.description = w?.name ?? vscode.workspace.workspaceFolders?.map((f) => f.name).join(", ");
        item.tooltip = w?.name ? `REDcode project ${w.name}: the mixes in the open folder` : "The mixes in the open folder";
        item.iconPath = new vscode.ThemeIcon("project");
      } else {
        item.tooltip = "What is in the project for the game to play: named sounds (REDmod custom sounds in source/resources/info.json), which quests, scenes and scripts play by name; overrides of game sounds; REDnode package sounds. A click opens the Hear tab";
        item.iconPath = new vscode.ThemeIcon("symbol-event");
      }
      return item;
    }
    if (n.kind === "note") {
      const item = new vscode.TreeItem(n.text, vscode.TreeItemCollapsibleState.None);
      item.id = `note:${n.group}`;
      return item;
    }
    if (n.kind === "mix") return mixItem(n);
    const mixTag = n.mix ? " mix" : "";
    if (n.kind === "named") {
      const item = new vscode.TreeItem(n.name, vscode.TreeItemCollapsibleState.None);
      item.id = `named:${n.name}`;
      const kind = RedmodTypes.find((t) => t.type === n.type)?.label ?? n.type;
      item.description = n.missing ? `${n.how} · WAV missing` : `${n.how} · ${kind}${n.seconds !== undefined ? ` · ${n.seconds.toFixed(2)} s` : ""}`;
      item.tooltip = `${n.name}: ${n.how}; a quest, scene or script plays it by this name\n${n.type}${n.file ? `\n${n.file}` : ""}${n.missing ? " (missing)" : ""}${n.mix ? `\nMade by ${n.mix.fsPath}` : ""}`;
      item.iconPath = new vscode.ThemeIcon(n.missing ? "warning" : n.type === "mod_skip" ? "mute" : "symbol-event");
      item.contextValue = `edgewave.namedSound${n.file && !n.missing ? " playable" : ""}${mixTag}`;
      item.command = { command: "edgewave.hearSound", title: "Hear", arguments: [n] };
      return item;
    }
    const item = new vscode.TreeItem(n.label, vscode.TreeItemCollapsibleState.None);
    item.id = `placed:${n.file}`;
    let seconds = "";
    try {
      seconds = ` · ${wavSeconds(fs.readFileSync(n.file)).toFixed(2)} s`;
    } catch {
      seconds = fs.existsSync(n.file) ? "" : " · WAV missing";
    }
    item.description = `${n.how}${seconds}`;
    item.tooltip = `${n.label}: ${n.how}\n${n.file}${n.mix ? `\nMade by ${n.mix.fsPath}` : ""}`;
    item.iconPath = new vscode.ThemeIcon(n.how.startsWith("in REDnode") ? "package" : "replace");
    item.contextValue = `edgewave.placedSound${fs.existsSync(n.file) ? " playable" : ""}${mixTag}`;
    item.command = { command: "edgewave.hearFile", title: "Hear", arguments: [n] };
    return item;
  }
}
