// The Sounds view in EDGEwave's activity bar container: the workspace's sound documents (.edgewave),
// by folder, each opening in the editor. Kept current by a file watcher.

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { Extension, parseDoc, sourceLabel } from "./doc";
import { ViewType } from "./openSound";

interface SoundItem {
  uri: vscode.Uri;
  /** The source's label, or the error when the document cannot be read. */
  label: string;
  voice: boolean;
  edits: number;
  error?: string;
}

export class SoundsView implements vscode.TreeDataProvider<SoundItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(context: vscode.ExtensionContext) {
    const watcher = vscode.workspace.createFileSystemWatcher(`**/*${Extension}`);
    const refresh = () => this.refresh();
    context.subscriptions.push(watcher, watcher.onDidCreate(refresh), watcher.onDidDelete(refresh), watcher.onDidChange(refresh), this.changed);
  }

  refresh(): void {
    this.changed.fire();
  }

  async getChildren(element?: SoundItem): Promise<SoundItem[]> {
    if (element) return [];
    const files = await vscode.workspace.findFiles(`**/*${Extension}`, "**/node_modules/**", 2000);
    return files
      .map((uri): SoundItem => {
        try {
          const doc = parseDoc(fs.readFileSync(uri.fsPath, "utf8"));
          return { uri, label: sourceLabel(doc.source), voice: !!doc.voice, edits: doc.edits.length };
        } catch (e) {
          return { uri, label: path.basename(uri.fsPath), voice: false, edits: 0, error: (e as Error).message };
        }
      })
      .sort((a, b) => a.uri.fsPath.localeCompare(b.uri.fsPath));
  }

  getTreeItem(s: SoundItem): vscode.TreeItem {
    const item = new vscode.TreeItem(path.basename(s.uri.fsPath, Extension), vscode.TreeItemCollapsibleState.None);
    const folder = vscode.workspace.asRelativePath(path.dirname(s.uri.fsPath), false);
    item.description = s.error ? "cannot be read" : `${s.edits} edit${s.edits === 1 ? "" : "s"} · ${folder}`;
    item.tooltip = s.error ? `${s.uri.fsPath}\n${s.error}` : `${s.label}\n${s.uri.fsPath}`;
    item.iconPath = new vscode.ThemeIcon(s.error ? "warning" : s.voice ? "comment" : "pulse");
    item.resourceUri = s.uri;
    item.command = { command: "vscode.openWith", title: "Open", arguments: [s.uri, ViewType] };
    return item;
  }
}
