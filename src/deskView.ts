// The Desk view (id edgewave.sounds, the Sounds view until 0.3): EDGEwave's scratch space (src/desk.ts) and,
// below it, Recent, the mixes opened lately from any folder (globalState, newest first, the last 20; files gone
// from disk are dropped; those on the Desk are not repeated). Each opens in the editor; ▶ plays its render.
// With neither, the view shows its welcome text (package.json).

import * as fs from "node:fs";
import * as vscode from "vscode";
import { deskDir, deskVersion, isInside, listDesk, type SoundItem } from "./desk";
import { debounced, folderOf, mixItem, readMix, same, type MixRow } from "./mixRow";

const RecentState = "edgewave.recentSounds";
const MaxRecent = 20;

/** A Desk mix row, with its item. */
export interface DeskRow extends MixRow {
  item: SoundItem;
}

type Group = "desk" | "recent";
type Node = { kind: "group"; group: Group } | MixRow | DeskRow | { kind: "note"; group: Group; text: string };

export const isDeskRow = (n: unknown): n is DeskRow => !!n && typeof n === "object" && (n as MixRow).kind === "mix" && !!(n as DeskRow).item;

export class DeskView implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    // The Desk's folder is EDGEwave's own: made here so it can be watched.
    fs.mkdirSync(deskDir(), { recursive: true });
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(deskDir()), "**"));
    const refresh = debounced(() => this.refresh());
    context.subscriptions.push(watcher, watcher.onDidCreate(refresh), watcher.onDidDelete(refresh), watcher.onDidChange(refresh), this.changed);
  }

  refresh(): void {
    void vscode.commands.executeCommand("setContext", "edgewave.deskEmpty", !listDesk().length);
    this.changed.fire();
  }

  private recentFiles(): string[] {
    return this.context.globalState.get<string[]>(RecentState) ?? [];
  }

  /** A mix was opened: first in Recent. */
  async remember(uri: vscode.Uri): Promise<void> {
    if (uri.scheme !== "file") return;
    const file = uri.fsPath;
    const list = [file, ...this.recentFiles().filter((f) => !same(f, file))].slice(0, MaxRecent);
    await this.context.globalState.update(RecentState, list);
    this.refresh();
  }

  async forget(node?: Node): Promise<void> {
    if (node?.kind !== "mix") return;
    await this.context.globalState.update(RecentState, this.recentFiles().filter((f) => !same(f, node.uri.fsPath)));
    this.refresh();
  }

  async clearRecent(): Promise<void> {
    await this.context.globalState.update(RecentState, []);
    this.refresh();
  }

  /** The mixes on the Desk, as rows. */
  deskRows(): DeskRow[] {
    return listDesk().map((item) => {
      // The Desk's own version; the Library's is on its own row, and in the hover beside Reveal in Library.
      const library = item.asset?.library;
      const version = deskVersion(item);
      return {
        ...readMix("desk", item.doc, {
          name: item.title,
          where: `v${version}`,
          note: library
            ? `Version ${version} here. In the Library: version ${library.version}, ${library.path}${version > library.version ? `. Add to Library makes this version ${version} there too` : ", the same"}. Reveal in Library shows it.`
            : `Version ${version}, not in the Library yet.`,
          tags: library ? ["inLibrary"] : [],
        }),
        item,
      };
    });
  }

  /** Recent mixes that are still there and not on the Desk. */
  async recentRows(): Promise<MixRow[]> {
    const all = this.recentFiles();
    const there = all.filter((f) => fs.existsSync(f));
    if (there.length !== all.length) await this.context.globalState.update(RecentState, there);
    const desk = deskDir();
    return there.filter((f) => !isInside(f, desk)).map((f) => {
      const row = readMix("recent", f);
      return { ...row, where: folderOf(row.uri) };
    });
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (!node) {
      const recent = await this.recentRows();
      // Nothing in either: no groups, so the welcome text shows.
      if (!listDesk().length && !recent.length) return [];
      return [
        { kind: "group", group: "desk" },
        { kind: "group", group: "recent" },
      ];
    }
    if (node.kind !== "group") return [];
    const items: Node[] = node.group === "desk" ? this.deskRows() : await this.recentRows();
    if (items.length) return items;
    return [{ kind: "note", group: node.group, text: node.group === "desk" ? "Empty: + makes a sound here; a game sound opened with no project lands here" : "None yet: sounds you open show here" }];
  }

  getTreeItem(n: Node): vscode.TreeItem {
    if (n.kind === "group") {
      const desk = n.group === "desk";
      const item = new vscode.TreeItem(desk ? "On the Desk" : "Recent", vscode.TreeItemCollapsibleState.Expanded);
      item.id = `group:${n.group}`;
      item.contextValue = desk ? "edgewave.deskGroup" : "edgewave.recentGroup";
      item.tooltip = desk
        ? `Mixes in progress, kept across restarts until you move them to a project or add them to the Library (${deskDir()})`
        : "Mixes you opened lately, from any folder";
      item.iconPath = new vscode.ThemeIcon(desk ? "inbox" : "history");
      return item;
    }
    if (n.kind === "note") {
      const item = new vscode.TreeItem(n.text, vscode.TreeItemCollapsibleState.None);
      item.id = `note:${n.group}`;
      return item;
    }
    const item = mixItem(n);
    if (isDeskRow(n)) item.iconPath = new vscode.ThemeIcon(n.error ? "warning" : n.item.asset?.library ? "library" : n.voice ? "comment" : "pulse");
    return item;
  }
}
