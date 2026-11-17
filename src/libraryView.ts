// The Library view: the EDGE Library's folders, the modder's own, with only the sounds in them: EDGEwave's sound
// items (<name>.sound.asset) and plain .wav, .ogg, .mp3 and .flac files. Other tools' items are theirs to show.
// A click opens the Hear tab; ▶ plays it; Add to Project copies a sound into the open project, Edit on the Desk
// takes a copy to change. With no Library set, the welcome text offers to set one (package.json).

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { libraryConfigFile, libraryFolder, libraryRoot, recordedLibraryRoot, type LibrarySound } from "./library";
import { debounced } from "./mixRow";

export type LibraryNode =
  | { kind: "folder"; rel: string; name: string }
  | { kind: "sound"; sound: LibrarySound }
  | { kind: "file"; file: string; name: string }
  | { kind: "line"; label: string; detail?: string; icon: string; tooltip?: string };

export const librarySoundOf = (n: unknown): LibrarySound | undefined => (n && typeof n === "object" && (n as LibraryNode).kind === "sound" ? (n as { sound: LibrarySound }).sound : undefined);

export class LibraryView implements vscode.TreeDataProvider<LibraryNode> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private watch?: vscode.Disposable;
  private watching?: string;

  constructor(context: vscode.ExtensionContext) {
    // library.json: another EDGE tool may set or move the root.
    const file = libraryConfigFile();
    const config = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(file)), path.basename(file)));
    const refresh = debounced(() => this.refresh());
    context.subscriptions.push(config, config.onDidCreate(refresh), config.onDidChange(refresh), config.onDidDelete(refresh), this.changed, { dispose: () => this.watch?.dispose() });
    this.refresh();
  }

  refresh(): void {
    const root = libraryRoot();
    void vscode.commands.executeCommand("setContext", "edgewave.hasLibrary", !!root);
    if (root !== this.watching) {
      this.watch?.dispose();
      this.watch = undefined;
      this.watching = root;
      if (root) {
        const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(root), "**"));
        const again = debounced(() => this.changed.fire(), 400);
        this.watch = vscode.Disposable.from(w, w.onDidCreate(again), w.onDidDelete(again), w.onDidChange(again));
      }
    }
    this.changed.fire();
  }

  getChildren(node?: LibraryNode): LibraryNode[] {
    const root = libraryRoot();
    if (!root) {
      const recorded = recordedLibraryRoot();
      return recorded ? [{ kind: "line", label: "The Library's folder is missing", detail: recorded, icon: "warning", tooltip: `${recorded}\nA drive may be unplugged. Set the Library Folder to choose another.` }] : [];
    }
    if (node && node.kind !== "folder") return [];
    const here = libraryFolder(root, node?.kind === "folder" ? node.rel : "");
    const out: LibraryNode[] = [
      ...here.folders.map((f) => ({ kind: "folder" as const, rel: f.rel, name: f.name })),
      ...here.sounds.map((sound) => ({ kind: "sound" as const, sound })),
      ...here.files.map((f) => ({ kind: "file" as const, file: f.file, name: f.name })),
    ];
    if (!node && !out.length) out.push({ kind: "line", label: "No sounds yet", detail: "Add to Library from the Desk", icon: "info", tooltip: root });
    return out;
  }

  getTreeItem(node: LibraryNode): vscode.TreeItem {
    if (node.kind === "line") {
      const t = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      t.description = node.detail;
      t.iconPath = new vscode.ThemeIcon(node.icon);
      t.tooltip = node.tooltip;
      return t;
    }
    if (node.kind === "folder") {
      const t = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Collapsed);
      t.id = `folder:${node.rel}`;
      t.iconPath = vscode.ThemeIcon.Folder;
      t.contextValue = "edgewave.libFolder";
      return t;
    }
    if (node.kind === "file") {
      const t = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None);
      t.id = `file:${node.file}`;
      t.iconPath = new vscode.ThemeIcon("file-media");
      t.tooltip = `${node.file}\nA sound file, an item as it is. A click opens the Hear tab`;
      t.contextValue = "edgewave.libFile playable";
      t.command = { command: "edgewave.hearFile", title: "Hear", arguments: [node] };
      return t;
    }
    const s = node.sound;
    const t = new vscode.TreeItem(s.title, vscode.TreeItemCollapsibleState.None);
    t.id = `sound:${s.folder}`;
    const last = s.asset?.history.at(-1);
    t.description = `v${s.asset?.version ?? 1}${s.rendered ? "" : " · no render"}`;
    t.tooltip = new vscode.MarkdownString(
      [`**${s.title}**, a sound, version ${s.asset?.version ?? 1}`, last ? `${last.date.slice(0, 10)}: ${last.did}` : "", s.folder, s.rendered ? "A click opens the Hear tab; Add to Project copies it into the open project" : "Its render is missing: Edit on the Desk, render, and Add to Library again"].filter(Boolean).join("\n\n"),
    );
    t.iconPath = new vscode.ThemeIcon(s.rendered ? "pulse" : "warning");
    t.contextValue = `edgewave.libSound${s.rendered && fs.existsSync(s.render) ? " playable" : ""}`;
    if (s.rendered) t.command = { command: "edgewave.hearFile", title: "Hear", arguments: [node] };
    return t;
  }
}
