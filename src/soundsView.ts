// The Sounds view in EDGEwave's activity bar container, in three groups:
//   Project  the open folder's sound documents (.edgewave), kept current by a file watcher; the REDcode
//            project's name beside it when one is open
//   Project sounds  the project's named sounds (REDmod custom sounds in source/resources/info.json, made with
//            Add to Project's A new sound): what quests, scenes and scripts play by name. A click plays one
//   Recent   the sound documents opened lately, from any folder, so a modder can try sounds without a
//            project (globalState, newest first, the last 20; files gone from disk are dropped)
// Each sound opens in the editor. With neither, the view shows its welcome text (package.json).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { projectSounds, type ProjectSound } from "./customSound";
import { docLabel, Extension, parseDoc } from "./doc";
import { ViewType } from "./openSound";
import { redcode } from "./redcode";
import { RedmodTypes } from "./redmod";

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
}

/** A named sound in the project, by its event name. */
export interface NamedItem extends ProjectSound {
  kind: "named";
  /** The project's folder. */
  dir: string;
}

type Node = { kind: "group"; group: Group } | SoundItem | NamedItem | { kind: "note"; group: Group; text: string };

const same = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

export class SoundsView implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private projectName: string | undefined;
  private projectDir: string | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    const watcher = vscode.workspace.createFileSystemWatcher(`**/*${Extension}`);
    const info = vscode.workspace.createFileSystemWatcher("**/source/resources/info.json");
    const refresh = () => this.refresh();
    context.subscriptions.push(watcher, watcher.onDidCreate(refresh), watcher.onDidDelete(refresh), watcher.onDidChange(refresh), vscode.workspace.onDidChangeWorkspaceFolders(refresh), this.changed);
    context.subscriptions.push(info, info.onDidCreate(refresh), info.onDidDelete(refresh), info.onDidChange(refresh));
    // The REDcode project's name, when one is open. Without REDcode the view still lists the folder.
    redcode().then(
      (api) => {
        this.projectName = api.project()?.name;
        this.projectDir = api.project()?.dir;
        context.subscriptions.push(
          api.onDidChangeProject((p) => {
            this.projectName = p?.name;
            this.projectDir = p?.dir;
            this.refresh();
          }),
        );
        this.refresh();
      },
      () => undefined,
    );
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
      return { kind: "sound", group, uri, label: docLabel(doc), voice: doc.tracks.some((t) => t.voice), edits: doc.tracks.reduce((n, t) => n + t.edits.length, 0), tracks: doc.tracks.length };
    } catch (e) {
      return { kind: "sound", group, uri, label: path.basename(uri.fsPath), voice: false, edits: 0, error: (e as Error).message };
    }
  }

  private async project(): Promise<SoundItem[]> {
    if (!vscode.workspace.workspaceFolders?.length) return [];
    const files = await vscode.workspace.findFiles(`**/*${Extension}`, "**/node_modules/**", 2000);
    return files.map((uri) => this.read("project", uri)).sort((a, b) => a.uri.fsPath.localeCompare(b.uri.fsPath));
  }

  /** The project whose named sounds are listed: REDcode's, else the open folder with source/. */
  private namedDir(): string | undefined {
    return this.projectDir ?? vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath).find((d) => fs.existsSync(path.join(d, "source")));
  }

  private named(): NamedItem[] | string {
    const dir = this.namedDir();
    if (!dir) return "No project open";
    try {
      return projectSounds(dir).map((s) => ({ ...s, kind: "named", dir }));
    } catch (e) {
      return (e as Error).message;
    }
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
      const named = this.named();
      if (typeof named !== "string" && named.length) return named;
      return [{ kind: "note", group: "named", text: typeof named === "string" ? named : "None yet: Add to Project > A new sound for this project names one" }];
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
        item.tooltip = "The project's named sounds (REDmod custom sounds in source/resources/info.json): quests, scenes and scripts play each by its name. A click plays one";
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
      item.description = n.missing ? "WAV missing" : `${kind}${n.seconds !== undefined ? ` · ${n.seconds.toFixed(2)} s` : ""}`;
      item.tooltip = `${n.name}: a quest, scene or script plays it by this name
${n.type}${n.file ? `
${n.file}` : ""}${n.missing ? " (missing)" : ""}`;
      item.iconPath = new vscode.ThemeIcon(n.missing ? "warning" : n.type === "mod_skip" ? "mute" : "symbol-event");
      item.contextValue = "edgewave.namedSound";
      item.command = { command: "edgewave.hearSound", title: "Hear", arguments: [n] };
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
