// A mix as a row in EDGEwave's views (Desk, Recent, the Project view's Mixes): its name, tracks and edits,
// whether it has a render for ▶, and its last Add to Project choice. A click opens the mix.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { docLabel, Extension, parseDoc, type IntoGame } from "./doc";
import { ViewType } from "./openSound";

export interface MixRow {
  kind: "mix";
  /** Which list it is in, for its id and its menus. */
  group: string;
  uri: vscode.Uri;
  /** The row's name: the Desk item's, else the file's. */
  name: string;
  /** The source's label, or the error when the mix cannot be read. */
  label: string;
  voice: boolean;
  edits: number;
  tracks: number;
  error?: string;
  game?: IntoGame;
  /** Its render, and whether it is there. */
  render?: string;
  rendered: boolean;
  /** A line after the tracks and edits: where it is, or that it is in the Library. */
  where?: string;
  /** More for its tooltip. */
  note?: string;
  /** Extra words for its contextValue (package.json's menus match them). */
  tags?: string[];
}

export function readMix(group: string, file: string, more: Partial<MixRow> = {}): MixRow {
  const uri = vscode.Uri.file(file);
  const name = path.basename(file, Extension);
  try {
    const doc = parseDoc(fs.readFileSync(file, "utf8"));
    const render = path.resolve(path.dirname(file), doc.render.file);
    return {
      kind: "mix",
      group,
      uri,
      name,
      label: docLabel(doc),
      voice: doc.tracks.some((t) => t.voice),
      edits: doc.tracks.reduce((n, t) => n + t.edits.length, 0),
      tracks: doc.tracks.length,
      game: doc.game,
      render,
      rendered: fs.existsSync(render),
      ...more,
    };
  } catch (e) {
    return { kind: "mix", group, uri, name, label: name, voice: false, edits: 0, tracks: 0, error: (e as Error).message, rendered: false, ...more };
  }
}

export function mixItem(n: MixRow): vscode.TreeItem {
  const item = new vscode.TreeItem(n.name, vscode.TreeItemCollapsibleState.None);
  item.id = `${n.group}:${n.uri.fsPath}`;
  const tracks = n.tracks === 0 ? "empty · " : n.tracks > 1 ? `${n.tracks} tracks · ` : "";
  item.description = n.error ? "cannot be read" : `${tracks}${n.edits} edit${n.edits === 1 ? "" : "s"}${n.where ? ` · ${n.where}` : ""}`;
  item.tooltip = n.error ? `${n.uri.fsPath}\n${n.error}` : [n.label, n.uri.fsPath, n.rendered ? `Rendered: ${path.basename(n.render!)}; ▶ plays it` : "Not rendered yet: Render WAV in the mix", n.note].filter(Boolean).join("\n");
  item.iconPath = new vscode.ThemeIcon(n.error ? "warning" : n.voice ? "comment" : "pulse");
  item.resourceUri = n.uri;
  item.contextValue = ["edgewave.mix", n.group, n.rendered ? "rendered" : "unrendered", ...(n.tags ?? [])].join(" ");
  item.command = { command: "vscode.openWith", title: "Open", arguments: [n.uri, ViewType] };
  return item;
}

/** The mix's folder: relative to the open folder when inside it, else the full path (home as ~). */
export function folderOf(uri: vscode.Uri): string {
  const dir = path.dirname(uri.fsPath);
  if (vscode.workspace.getWorkspaceFolder(uri)) return vscode.workspace.asRelativePath(dir, false);
  const home = os.homedir();
  return dir.toLowerCase().startsWith(home.toLowerCase() + path.sep) ? `~${dir.slice(home.length)}` : dir;
}

export const same = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/** A refresh that waits a moment, so a burst of file changes refreshes once. */
export function debounced(fn: () => void, ms = 250): () => void {
  let timer: NodeJS.Timeout | undefined;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}
