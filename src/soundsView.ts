// The Sounds view in EDGEwave's activity bar container, in three groups:
//   Project  the sound documents (.edgewave) in the open folder and in REDcode's open project, which may be
//            outside it; kept current by file watchers; the REDcode project's name beside it
//   Project sounds  what EDGEwave put into the project: its named sounds (REDmod custom sounds in
//            source/resources/info.json: new names, replaced or silenced game events), what quests, scenes
//            and scripts play by name, a click plays one; and, from each document's last Add to Project
//            choice, the overrides of a game sound and the REDnode package sounds, a click opens the mix
//   Recent   the sound documents opened lately, from any folder, so a modder can try sounds without a
//            project (globalState, newest first, the last 20; files gone from disk are dropped)
// Each sound opens in the editor. With neither, the view shows its welcome text (package.json).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { projectSounds, type ProjectSound } from "./customSound";
import { docLabel, Extension, parseDoc, type IntoGame } from "./doc";
import { findSoundDocs } from "./findDocs";
import { ViewType } from "./openSound";
import { redcode } from "./redcode";
import { RedmodTypes } from "./redmod";
import { readIndex } from "./soundEvents";

const RecentState = "edgewave.recentSounds";
const MaxRecent = 20;

type Group = "project" | "named" | "recent";

interface SoundItem {
  kind: "sound";
  group: Group;
  uri: vscode.Uri;
  /** The source's label, or the error when the document cannot be read. */
  label: string;
  voice: boolean;
  edits: number;
  tracks?: number;
  error?: string;
  /** Its last Add to Project choice. */
  game?: IntoGame;
}

/** A named sound in the project, by its event name. */
export interface NamedItem extends ProjectSound {
  kind: "named";
  /** The project's folder. */
  dir: string;
  /** How it came: a new name, or a game event replaced or silenced (from the documents, else the game's event list). */
  how: string;
}

/** Something else a document put into the project (an override, a REDnode package sound): opens the document. */
interface PlacedItem {
  kind: "placed";
  label: string;
  how: string;
  doc: vscode.Uri;
}

type Node = { kind: "group"; group: Group } | SoundItem | NamedItem | PlacedItem | { kind: "note"; group: Group; text: string };

const same = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

export class SoundsView implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private projectName: string | undefined;
  private projectDir: string | undefined;
  /** Watches REDcode's project folder when it is outside the open folder. */
  private projectWatch?: vscode.Disposable;

  constructor(private readonly context: vscode.ExtensionContext) {
    const watcher = vscode.workspace.createFileSystemWatcher(`**/*${Extension}`);
    const info = vscode.workspace.createFileSystemWatcher("**/source/resources/info.json");
    const refresh = () => this.refresh();
    context.subscriptions.push(watcher, watcher.onDidCreate(refresh), watcher.onDidDelete(refresh), watcher.onDidChange(refresh), vscode.workspace.onDidChangeWorkspaceFolders(refresh), this.changed);
    context.subscriptions.push(info, info.onDidCreate(refresh), info.onDidDelete(refresh), info.onDidChange(refresh));
    // The REDcode project's name, when one is open. Without REDcode the view still lists the folder.
    redcode().then(
      (api) => {
        this.setProject(api.project());
        context.subscriptions.push(api.onDidChangeProject((p) => this.setProject(p)), { dispose: () => this.projectWatch?.dispose() });
      },
      () => undefined,
    );
  }

  /** REDcode's open project: its name, and a watcher on its folder when the open folder does not hold it. */
  private setProject(p: { name: string; dir: string } | undefined): void {
    this.projectName = p?.name;
    this.projectDir = p?.dir;
    this.projectWatch?.dispose();
    this.projectWatch = undefined;
    if (p?.dir && !vscode.workspace.getWorkspaceFolder(vscode.Uri.file(p.dir))) {
      const refresh = () => this.refresh();
      const docs = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(p.dir), `**/*${Extension}`));
      const info = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(p.dir), "source/resources/info.json"));
      this.projectWatch = vscode.Disposable.from(docs, info, docs.onDidCreate(refresh), docs.onDidDelete(refresh), docs.onDidChange(refresh), info.onDidCreate(refresh), info.onDidChange(refresh), info.onDidDelete(refresh));
    }
    this.refresh();
  }

  refresh(): void {
    this.changed.fire();
  }

  private recentFiles(): string[] {
    return this.context.globalState.get<string[]>(RecentState) ?? [];
  }

  /** A sound document was opened: first in Recent. */
  async remember(uri: vscode.Uri): Promise<void> {
    if (uri.scheme !== "file") return;
    const file = uri.fsPath;
    const list = [file, ...this.recentFiles().filter((f) => !same(f, file))].slice(0, MaxRecent);
    await this.context.globalState.update(RecentState, list);
    this.refresh();
  }

  async forget(node?: Node): Promise<void> {
    if (node?.kind !== "sound") return;
    await this.context.globalState.update(RecentState, this.recentFiles().filter((f) => !same(f, node.uri.fsPath)));
    this.refresh();
  }

  async clearRecent(): Promise<void> {
    await this.context.globalState.update(RecentState, []);
    this.refresh();
  }

  private read(group: Group, uri: vscode.Uri): SoundItem {
    try {
      const doc = parseDoc(fs.readFileSync(uri.fsPath, "utf8"));
      return { kind: "sound", group, uri, label: docLabel(doc), voice: doc.tracks.some((t) => t.voice), edits: doc.tracks.reduce((n, t) => n + t.edits.length, 0), tracks: doc.tracks.length, game: doc.game };
    } catch (e) {
      return { kind: "sound", group, uri, label: path.basename(uri.fsPath), voice: false, edits: 0, error: (e as Error).message };
    }
  }

  /** The sound documents in the open folder, and in REDcode's project when the open folder does not hold it. */
  private async project(): Promise<SoundItem[]> {
    const files = vscode.workspace.workspaceFolders?.length ? await vscode.workspace.findFiles(`**/*${Extension}`, "**/node_modules/**", 2000) : [];
    const seen = new Set(files.map((u) => path.resolve(u.fsPath).toLowerCase()));
    if (this.projectDir && !vscode.workspace.getWorkspaceFolder(vscode.Uri.file(this.projectDir))) {
      for (const f of findSoundDocs(this.projectDir)) if (!seen.has(path.resolve(f).toLowerCase())) files.push(vscode.Uri.file(f));
    }
    return files.map((uri) => this.read("project", uri)).sort((a, b) => a.uri.fsPath.localeCompare(b.uri.fsPath));
  }

  /** The project whose named sounds are listed: REDcode's, else the open folder with source/. */
  private namedDir(): string | undefined {
    return this.projectDir ?? vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath).find((d) => fs.existsSync(path.join(d, "source")));
  }

  /**
   * What EDGEwave put into the project: info.json's named sounds, each said how it came (a document's last
   * choice, else whether a game event has that name), then the documents' overrides and REDnode package sounds.
   */
  private async named(): Promise<(NamedItem | PlacedItem)[] | string> {
    const dir = this.namedDir();
    if (!dir) return "No project open";
    let sounds: ProjectSound[];
    try {
      sounds = projectSounds(dir);
    } catch (e) {
      return (e as Error).message;
    }
    const inProject = (u: vscode.Uri) => {
      const rel = path.relative(dir, u.fsPath);
      return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
    };
    const docs = (await this.project()).filter((d) => d.game && inProject(d.uri));
    const routeOf = (name: string) => docs.find((d) => d.game && "event" in d.game && d.game.event.toLowerCase() === name.toLowerCase())?.game;
    const gameEvents = new Set((readIndex()?.events ?? []).map((e) => e.name.toLowerCase()));
    const named: (NamedItem | PlacedItem)[] = sounds.map((s) => {
      const r = routeOf(s.name);
      const how =
        r?.route === "new"
          ? "a new sound"
          : r?.route === "skip" || s.type === "mod_skip"
            ? "silences the game's event"
            : r?.route === "redmod" || gameEvents.has(s.name.toLowerCase())
              ? "replaces the game's event"
              : "a new sound";
      return { ...s, kind: "named", dir, how };
    });
    for (const d of docs) {
      const g = d.game!;
      const doc = path.basename(d.uri.fsPath, Extension);
      if (g.route === "override") named.push({ kind: "placed", label: `${doc}`, how: `overrides game sound ${g.soundHash ?? ""}`.trim(), doc: d.uri });
      else if (g.route === "rednode") named.push({ kind: "placed", label: g.sound, how: `in REDnode package ${path.basename(g.package)}`, doc: d.uri });
    }
    return named;
  }

  private async recent(): Promise<SoundItem[]> {
    const all = this.recentFiles();
    const there = all.filter((f) => fs.existsSync(f));
    if (there.length !== all.length) await this.context.globalState.update(RecentState, there);
    return there.map((f) => this.read("recent", vscode.Uri.file(f)));
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (!node) {
      // Nothing in either: no groups, so the welcome text shows.
      if (!vscode.workspace.workspaceFolders?.length && !this.recentFiles().some((f) => fs.existsSync(f))) return [];
      return [
        { kind: "group", group: "project" },
        { kind: "group", group: "named" },
        { kind: "group", group: "recent" },
      ];
    }
    if (node.kind !== "group") return [];
    if (node.group === "named") {
      const named = await this.named();
      if (typeof named !== "string" && named.length) return named;
      return [{ kind: "note", group: "named", text: typeof named === "string" ? named : "None yet: Add to Project puts a mix into the project" }];
    }
    const items = node.group === "project" ? await this.project() : await this.recent();
    if (items.length) return items;
    const text =
      node.group === "recent"
        ? "None yet: sounds you open show here"
        : vscode.workspace.workspaceFolders?.length
          ? "No sound documents in the open folder"
          : "No folder open";
    return [{ kind: "note", group: node.group, text }];
  }

  getTreeItem(n: Node): vscode.TreeItem {
    if (n.kind === "group") {
      const item = new vscode.TreeItem(n.group === "project" ? "Project" : n.group === "named" ? "Project sounds" : "Recent", vscode.TreeItemCollapsibleState.Expanded);
      item.id = `group:${n.group}`;
      item.contextValue = n.group === "project" ? "edgewave.projectGroup" : n.group === "named" ? "edgewave.namedGroup" : "edgewave.recentGroup";
      if (n.group === "named") {
        item.tooltip = "What EDGEwave put into the project: named sounds (REDmod custom sounds in source/resources/info.json), which quests, scenes and scripts play by name, a click plays one; overrides of game sounds and REDnode package sounds, a click opens the mix";
        item.iconPath = new vscode.ThemeIcon("symbol-event");
      } else if (n.group === "project") {
        const folders = vscode.workspace.workspaceFolders ?? [];
        item.description = this.projectName ?? folders.map((f) => f.name).join(", ");
        item.tooltip = this.projectName ? `REDcode project ${this.projectName}: the sound documents in the open folder` : "The sound documents in the open folder";
        item.iconPath = new vscode.ThemeIcon("project");
      } else {
        item.tooltip = "Sound documents you opened lately, from any folder";
        item.iconPath = new vscode.ThemeIcon("history");
      }
      return item;
    }
    if (n.kind === "note") {
      const item = new vscode.TreeItem(n.text, vscode.TreeItemCollapsibleState.None);
      item.id = `note:${n.group}`;
      if (n.group === "project" && !vscode.workspace.workspaceFolders?.length) {
        // Its hover icon (package.json) and a click both open a folder.
        item.contextValue = "edgewave.noFolder";
        item.command = { command: "edgewave.openFolder", title: "Open Folder…" };
      }
      return item;
    }
    if (n.kind === "named") {
      const item = new vscode.TreeItem(n.name, vscode.TreeItemCollapsibleState.None);
      item.id = `named:${n.name}`;
      const kind = RedmodTypes.find((t) => t.type === n.type)?.label ?? n.type;
      item.description = n.missing ? `${n.how} · WAV missing` : `${n.how} · ${kind}${n.seconds !== undefined ? ` · ${n.seconds.toFixed(2)} s` : ""}`;
      item.tooltip = `${n.name}: ${n.how}; a quest, scene or script plays it by this name\n${n.type}${n.file ? `\n${n.file}` : ""}${n.missing ? " (missing)" : ""}`;
      item.iconPath = new vscode.ThemeIcon(n.missing ? "warning" : n.type === "mod_skip" ? "mute" : "symbol-event");
      item.contextValue = "edgewave.namedSound";
      item.command = { command: "edgewave.hearSound", title: "Hear", arguments: [n] };
      return item;
    }
    if (n.kind === "placed") {
      const item = new vscode.TreeItem(n.label, vscode.TreeItemCollapsibleState.None);
      item.id = `placed:${n.doc.fsPath}`;
      item.description = n.how;
      item.tooltip = `${n.how}, from ${n.doc.fsPath}. A click opens the mix`;
      item.iconPath = new vscode.ThemeIcon(n.how.startsWith("in REDnode") ? "package" : "replace");
      item.command = { command: "vscode.openWith", title: "Open", arguments: [n.doc, ViewType] };
      return item;
    }
    const item = new vscode.TreeItem(path.basename(n.uri.fsPath, Extension), vscode.TreeItemCollapsibleState.None);
    item.id = `${n.group}:${n.uri.fsPath}`;
    const tracks = n.tracks && n.tracks > 1 ? `${n.tracks} tracks · ` : "";
    item.description = n.error ? "cannot be read" : `${tracks}${n.edits} edit${n.edits === 1 ? "" : "s"} · ${folderOf(n.uri)}`;
    item.tooltip = n.error ? `${n.uri.fsPath}\n${n.error}` : `${n.label}\n${n.uri.fsPath}`;
    item.iconPath = new vscode.ThemeIcon(n.error ? "warning" : n.voice ? "comment" : "pulse");
    item.resourceUri = n.uri;
    item.contextValue = n.group === "recent" ? "edgewave.recentSound" : "edgewave.projectSound";
    item.command = { command: "vscode.openWith", title: "Open", arguments: [n.uri, ViewType] };
    return item;
  }
}

/** The document's folder: relative to the open folder when inside it, else the full path (home as ~). */
function folderOf(uri: vscode.Uri): string {
  const dir = path.dirname(uri.fsPath);
  if (vscode.workspace.getWorkspaceFolder(uri)) return vscode.workspace.asRelativePath(dir, false);
  const home = os.homedir();
  return dir.toLowerCase().startsWith(home.toLowerCase() + path.sep) ? `~${dir.slice(home.length)}` : dir;
}
