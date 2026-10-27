// The Game Assets view in EDGEwave's container: the game's sounds only, so a modder finds a sound without
// going to REDcode's Game Assets and back. Three groups:
//   Sound effects  REDcode's sound index (each event's variations, Opus in the .opuspak files), named from the
//                  game's own event list (src/events.ts), grouped by the parts of their names
//   Voice lines    the .wem files in base\ and ep1\localization\<language>\vo, vo_holocall, vo_helmet and
//                  vo_rewinded, for the languages installed; big folders grouped by name parts (judy, judy_q307)
//   Music and streamed sounds  base\sound\soundbanks\media: Wwise's streamed .wem files, named by number
// A click plays the sound in the Hear panel; inline, Open in EDGEwave, Add to the Open Sound, Copy Name.
// Filter takes words and wildcards (src/assetTree.ts) and searches all three. Folders come from REDcode's
// REDbridge (archive.tree, archive.search), one level per request.

import * as vscode from "vscode";
import { compileFilter, formatSize, groupByParts, isAudioFile, isVoiceFolder, type AssetFilter } from "./assetTree";
import { looksLikeVoice, type Source } from "./doc";
import type { SoundEditorProvider } from "./editor";
import { redcode, type GameFileInfo, type SoundEventInfo, type SoundRef } from "./redcode";
import { eventNotes, type SoundEvents } from "./soundEvents";

/** A sound effect event, named from the game's list when REDcode's index has no name. */
interface SfxEvent {
  hash: number;
  name: string;
  named: boolean;
  tags: string[];
  sounds: number[];
}

type Root = "sfx" | "voice" | "media";

export type AssetNode =
  | { kind: "root"; root: Root }
  | { kind: "sfxGroup"; prefix: string; count: number }
  | { kind: "event"; event: SfxEvent }
  | { kind: "variation"; event: SfxEvent; soundHash: number; index: number }
  | { kind: "voiceRoot"; path: string; label: string }
  | { kind: "language"; path: string; name: string; files: number }
  | { kind: "folder"; path: string; name: string; files: number }
  | { kind: "fileGroup"; folder: string; prefix: string; count: number }
  | { kind: "file"; file: GameFileInfo; inFilter?: boolean }
  | { kind: "note"; id: string; text: string };

const MediaFolder = "base\\sound\\soundbanks\\media";
/** The most files the filter's search returns: the bridge's own limit. */
const SearchCap = 5000;
const Most = 400;

const baseName = (p: string) => p.split("\\").pop() ?? p;
const folderOf = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf("\\")));

export class GameAssets implements vscode.TreeDataProvider<AssetNode> {
  private readonly changed = new vscode.EventEmitter<AssetNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private sfxEvents?: Promise<SfxEvent[]>;
  private readonly folders = new Map<string, Promise<GameFileInfo[]>>();
  private filter?: AssetFilter;
  private found?: Promise<{ events: SfxEvent[]; voice: GameFileInfo[]; media: GameFileInfo[]; capped: boolean }>;

  constructor(
    private readonly events: SoundEvents,
    private readonly editor: SoundEditorProvider,
  ) {}

  refresh(): void {
    this.sfxEvents = undefined;
    this.folders.clear();
    this.found = undefined;
    this.changed.fire(undefined);
  }

  get pattern(): string | undefined {
    return this.filter?.pattern;
  }

  /** Sets the filter (undefined or empty clears it). */
  setFilter(pattern: string | undefined): void {
    this.filter = pattern ? compileFilter(pattern) : undefined;
    this.found = undefined;
    void vscode.commands.executeCommand("setContext", "edgewave.gameAssetsFiltered", !!this.filter);
    this.changed.fire(undefined);
  }

  private async bridge() {
    const b = (await redcode()).bridge();
    if (!b || typeof b.tree !== "function") throw new Error("REDcode's REDbridge is not running: open a REDcode project, or start it from REDcode");
    return b;
  }

  /** REDcode's sound effect events, each with a name: REDcode's, else the game's event list's, else its hash. */
  private sfx(): Promise<SfxEvent[]> {
    this.sfxEvents ??= (async () => {
      const { events } = await (await redcode()).soundIndex();
      const names = new Map((await this.events.events().catch(() => [])).map((e) => [e.hash, e.name]));
      const out = events
        .filter((e: SoundEventInfo) => e.sounds.length)
        .map((e): SfxEvent => {
          const name = e.name ?? names.get(e.hash);
          return { hash: e.hash, name: name ?? `event ${e.hash}`, named: !!name, tags: e.tags, sounds: e.sounds };
        });
      return out.sort((a, b) => Number(!a.named) - Number(!b.named) || a.name.localeCompare(b.name));
    })().catch((e) => {
      this.sfxEvents = undefined;
      throw e;
    });
    return this.sfxEvents;
  }

  /** A folder's audio files, from the bridge once. */
  private files(folder: string): Promise<GameFileInfo[]> {
    let p = this.folders.get(folder);
    if (!p) {
      p = this.bridge()
        .then((b) => b.tree(folder))
        .then((t) => t.files.filter((f) => isAudioFile(f.name)));
      p.catch(() => this.folders.delete(folder));
      this.folders.set(folder, p);
    }
    return p;
  }

  /** What the filter finds: sound effect events by name or hash, .wem files through the bridge's search. */
  private search(f: AssetFilter) {
    this.found ??= (async () => {
      const events = (await this.sfx().catch(() => [])).filter((e) => f.test(e.name) || f.seed === String(e.hash) || e.sounds.some((s) => String(s) === f.seed));
      let voice: GameFileInfo[] = [];
      let media: GameFileInfo[] = [];
      let capped = false;
      if (f.seed.length >= 2) {
        const r = await (await this.bridge()).search(f.seed, SearchCap);
        capped = r.total > r.items.length;
        const audio = r.items.filter((x) => isAudioFile(x.name) && f.test(x.name));
        media = audio.filter((x) => x.name.toLowerCase().startsWith(MediaFolder));
        voice = audio.filter((x) => !x.name.toLowerCase().startsWith(MediaFolder));
      }
      return { events, voice, media, capped };
    })();
    return this.found;
  }

  async getChildren(n?: AssetNode): Promise<AssetNode[]> {
    try {
      return await this.children(n);
    } catch (e) {
      return [{ kind: "note", id: `error:${n ? JSON.stringify(n).slice(0, 80) : "root"}`, text: (e as Error).message }];
    }
  }

  private async children(n?: AssetNode): Promise<AssetNode[]> {
    if (!n) return (["sfx", "voice", "media"] as Root[]).map((root) => ({ kind: "root", root }));
    const f = this.filter;
    switch (n.kind) {
      case "root": {
        if (f) {
          const r = await this.search(f);
          if (n.root === "sfx") return this.sfxLevel(r.events, "") ?? [{ kind: "note", id: "none:sfx", text: "No sound effect event matches" }];
          const list = n.root === "voice" ? r.voice : r.media;
          if (f.seed.length < 2) return [{ kind: "note", id: `short:${n.root}`, text: "Type at least two letters to search the files" }];
          const out = this.fileLevel(list, `filter:${n.root}`, "", true);
          if (r.capped) out.push({ kind: "note", id: `capped:${n.root}`, text: `The search stopped at ${SearchCap} files: narrow the filter to see the rest` });
          return out.length ? out : [{ kind: "note", id: `none:${n.root}`, text: "No file matches" }];
        }
        if (n.root === "sfx") return this.sfxLevel(await this.sfx(), "") ?? [];
        if (n.root === "media") return this.fileLevel(await this.files(MediaFolder), MediaFolder, "");
        return [
          { kind: "voiceRoot", path: "base\\localization", label: "Base game" },
          { kind: "voiceRoot", path: "ep1\\localization", label: "Phantom Liberty" },
        ];
      }
      case "sfxGroup":
        return this.sfxLevel(f ? (await this.search(f)).events : await this.sfx(), n.prefix) ?? [];
      case "event":
        return n.event.sounds.map((soundHash, index) => ({ kind: "variation", event: n.event, soundHash, index }));
      case "voiceRoot": {
        const b = await this.bridge();
        const langs = (await b.tree(n.path)).folders;
        // Only the languages with voice lines installed (their vo folders).
        const withVoice = await Promise.all(
          langs.map(async (l) => {
            const vo = (await b.tree(l.path)).folders.filter((x) => isVoiceFolder(x.name));
            return vo.length ? ({ kind: "language", path: l.path, name: l.name, files: vo.reduce((s, x) => s + x.files, 0) } as AssetNode) : undefined;
          }),
        );
        const out = withVoice.filter((x): x is AssetNode => !!x);
        return out.length ? out : [{ kind: "note", id: `novoice:${n.path}`, text: "No voice lines installed here" }];
      }
      case "language":
        return (await (await this.bridge()).tree(n.path)).folders.filter((x) => isVoiceFolder(x.name)).map((x) => ({ kind: "folder", path: x.path, name: x.name, files: x.files }));
      case "folder":
        return this.fileLevel(await this.files(n.path), n.path, "");
      case "fileGroup": {
        if (n.folder.startsWith("filter:")) {
          const r = await this.search(f!);
          return this.fileLevel(n.folder === "filter:media" ? r.media : r.voice, n.folder, n.prefix, true);
        }
        return this.fileLevel(await this.files(n.folder), n.folder, n.prefix);
      }
      default:
        return [];
    }
  }

  private sfxLevel(all: SfxEvent[], prefix: string): AssetNode[] | undefined {
    if (!all.length) return undefined;
    const g = groupByParts(all, (e) => e.name, prefix, Most);
    return [...g.groups.map((x): AssetNode => ({ kind: "sfxGroup", prefix: x.prefix, count: x.count })), ...g.items.map((event): AssetNode => ({ kind: "event", event }))];
  }

  private fileLevel(all: GameFileInfo[], folder: string, prefix: string, inFilter = false): AssetNode[] {
    const g = groupByParts(all, (x) => baseName(x.name), prefix, Most);
    return [
      ...g.groups.map((x): AssetNode => ({ kind: "fileGroup", folder, prefix: x.prefix, count: x.count })),
      ...g.items.sort((a, b) => a.name.localeCompare(b.name)).map((file): AssetNode => ({ kind: "file", file, inFilter })),
    ];
  }

  getTreeItem(n: AssetNode): vscode.TreeItem {
    const C = vscode.TreeItemCollapsibleState;
    const open = this.filter ? C.Expanded : C.Collapsed;
    switch (n.kind) {
      case "root": {
        const label = { sfx: "Sound effects", voice: "Voice lines", media: "Music and streamed sounds" }[n.root];
        const item = new vscode.TreeItem(label, this.filter ? C.Expanded : C.Collapsed);
        item.id = `root:${n.root}:${this.filter?.pattern ?? ""}`;
        item.iconPath = new vscode.ThemeIcon({ sfx: "symbol-event", voice: "comment", media: "music" }[n.root]);
        item.tooltip = {
          sfx: "The game's sound effects by event (REDcode's sound index): each event's variations. A quest, scene or script plays an event by its name",
          voice: "Spoken lines (.wem), by language, for the languages installed. The game names them <speaker>_<quest>_f_<id> (m for male V)",
          media: "Wwise's streamed sounds (.wem in base\\sound\\soundbanks\\media), mostly music and long sounds, named by number",
        }[n.root];
        if (this.filter) item.description = `filter: ${this.filter.pattern}`;
        return item;
      }
      case "sfxGroup":
      case "fileGroup": {
        // The shared start of the names inside, in full; the count after it, which the view cuts first when narrow.
        const item = new vscode.TreeItem(n.prefix, open);
        item.id = `${n.kind}:${n.kind === "fileGroup" ? n.folder : ""}:${n.prefix}:${this.filter?.pattern ?? ""}`;
        item.description = `${n.count.toLocaleString("en-US")} ${n.kind === "sfxGroup" ? "events" : "files"}`;
        item.tooltip = `${n.count.toLocaleString("en-US")} ${n.kind === "sfxGroup" ? "events" : "files"} whose names start with ${n.prefix}_`;
        item.iconPath = new vscode.ThemeIcon("folder");
        return item;
      }
      case "event": {
        const e = n.event;
        const item = new vscode.TreeItem(e.name, e.sounds.length > 1 ? C.Collapsed : C.None);
        item.id = `event:${e.hash}:${this.filter?.pattern ?? ""}`;
        item.description = `${e.sounds.length} variation${e.sounds.length === 1 ? "" : "s"}${e.named ? "" : " · no name"}`;
        item.tooltip = `${e.name}\nevent ${e.hash}${e.tags.length ? `\n${e.tags.join(", ")}` : ""}\nClick to hear it`;
        item.iconPath = new vscode.ThemeIcon("symbol-event");
        item.contextValue = e.named ? "edgewave.gameEvent" : "edgewave.gameEventUnnamed";
        item.command = { command: "edgewave.hearGameSound", title: "Hear", arguments: [n] };
        return item;
      }
      case "variation": {
        const item = new vscode.TreeItem(`Variation ${n.index + 1}`, C.None);
        item.id = `variation:${n.event.hash}:${n.soundHash}:${this.filter?.pattern ?? ""}`;
        item.description = String(n.soundHash);
        item.tooltip = `Sound ${n.soundHash} of ${n.event.name}\nClick to hear it`;
        item.iconPath = new vscode.ThemeIcon("pulse");
        item.contextValue = "edgewave.gameSound";
        item.command = { command: "edgewave.hearGameSound", title: "Hear", arguments: [n] };
        return item;
      }
      case "voiceRoot": {
        const item = new vscode.TreeItem(n.label, C.Collapsed);
        item.id = `voiceRoot:${n.path}`;
        item.iconPath = new vscode.ThemeIcon("folder");
        return item;
      }
      case "language": {
        const item = new vscode.TreeItem(n.name, C.Collapsed);
        item.id = `language:${n.path}`;
        item.description = `${n.files.toLocaleString("en-US")} lines`;
        item.iconPath = new vscode.ThemeIcon("globe");
        return item;
      }
      case "folder": {
        const item = new vscode.TreeItem(n.name, C.Collapsed);
        item.id = `folder:${n.path}`;
        item.description = n.files.toLocaleString("en-US");
        item.tooltip = n.path;
        item.iconPath = new vscode.ThemeIcon("folder");
        return item;
      }
      case "file": {
        const item = new vscode.TreeItem(baseName(n.file.name), C.None);
        item.id = `file:${n.file.name}:${this.filter?.pattern ?? ""}`;
        item.description = n.inFilter ? `${formatSize(n.file.size)} · ${folderOf(n.file.name)}` : formatSize(n.file.size);
        item.tooltip = `${n.file.name}\n${formatSize(n.file.size)} in ${n.file.archive}\nClick to hear it`;
        item.iconPath = new vscode.ThemeIcon(looksLikeVoice(n.file.name) ? "comment" : "pulse");
        item.contextValue = "edgewave.gameSound";
        item.command = { command: "edgewave.hearGameSound", title: "Hear", arguments: [n] };
        return item;
      }
      case "note": {
        const item = new vscode.TreeItem(n.text, C.None);
        item.id = `note:${n.id}`;
        item.iconPath = new vscode.ThemeIcon("info");
        return item;
      }
    }
  }

  // ---- the commands --------------------------------------------------------------------------------------

  async hear(n?: AssetNode): Promise<void> {
    try {
      if (n?.kind === "event") {
        const game = (await this.events.events().catch(() => [])).find((e) => e.hash === n.event.hash);
        const notes = game ? eventNotes(game, n.event.sounds.length) : [`${n.event.sounds.length} recordings. Each play picks one, as the game does.`];
        const ok = await this.events.hear(n.event.name, n.event.sounds.map((s) => ({ ref: { soundHash: s, eventHash: n.event.hash }, label: String(s) })), notes);
        if (!ok) throw new Error(`REDcode could not read ${n.event.name}'s sounds; see REDcode's output`);
      } else if (n?.kind === "variation") {
        const ok = await this.events.hear(`${n.event.name} · ${n.soundHash}`, [{ ref: { soundHash: n.soundHash, eventHash: n.event.hash }, label: `Variation ${n.index + 1}` }], [`Sound ${n.soundHash}, variation ${n.index + 1} of ${n.event.sounds.length}: the raw recording, without the game's effects.`]);
        if (!ok) throw new Error(`REDcode could not read sound ${n.soundHash}; see REDcode's output`);
      } else if (n?.kind === "file") {
        const ok = await this.events.hear(baseName(n.file.name), [{ ref: { path: n.file.name }, label: baseName(n.file.name) }], [n.file.name, `${formatSize(n.file.size)} in ${n.file.archive}.`]);
        if (!ok) throw new Error(`REDcode could not read ${baseName(n.file.name)}; see REDcode's output`);
      }
    } catch (e) {
      void vscode.window.showErrorMessage(`EDGEwave: ${(e as Error).message}`);
    }
  }

  /** ▶ on a sound: plays it at once with no tab (an event: one of its variations); again while it plays stops it. */
  async play(n?: AssetNode): Promise<void> {
    const refs =
      n?.kind === "event"
        ? n.event.sounds.map((s) => ({ ref: { soundHash: s, eventHash: n.event.hash }, label: String(s) }))
        : n?.kind === "variation"
          ? [{ ref: { soundHash: n.soundHash, eventHash: n.event.hash }, label: String(n.soundHash) }]
          : n?.kind === "file"
            ? [{ ref: { path: n.file.name }, label: baseName(n.file.name) }]
            : [];
    if (!n || !refs.length) return;
    const name = n.kind === "file" ? baseName(n.file.name) : n.kind === "event" || n.kind === "variation" ? n.event.name : "";
    try {
      const r = await this.events.playQuiet(n.kind === "file" ? n.file.name : `${n.kind}:${refs.map((x) => x.label).join()}`, refs);
      if (!r.ok) {
        const hear = "Open in the Hear Tab";
        if ((await vscode.window.showWarningMessage(`EDGEwave: ${r.reason}`, hear)) === hear) await this.hear(n);
      } else if ("stopped" in r) vscode.window.setStatusBarMessage(`EDGEwave: stopped ${name}`, 2000);
      else vscode.window.setStatusBarMessage(`EDGEwave: playing ${name}${r.variations > 1 ? ` (${r.played}, one of ${r.variations})` : ""}; ▶ again stops it`, 4000);
    } catch (e) {
      void vscode.window.showErrorMessage(`EDGEwave: ${(e as Error).message}`);
    }
  }

  /** The sound a node names, as edgewave.openSound and a track take it. */
  private ref(n?: AssetNode): { ref: SoundRef; source: Source; voice: boolean } | undefined {
    if (n?.kind === "event" || n?.kind === "variation") {
      const soundHash = n.kind === "variation" ? n.soundHash : n.event.sounds[0];
      return { ref: { soundHash, eventHash: n.event.hash }, source: { kind: "sfx", soundHash, eventHash: n.event.hash, eventName: n.event.named ? n.event.name : undefined }, voice: false };
    }
    if (n?.kind === "file") return { ref: { path: n.file.name }, source: { kind: "game", path: n.file.name }, voice: looksLikeVoice(n.file.name) };
    return undefined;
  }

  async open(n?: AssetNode): Promise<void> {
    const r = this.ref(n);
    if (r) await vscode.commands.executeCommand("edgewave.openSound", r.ref);
  }

  async addToOpen(n?: AssetNode): Promise<void> {
    const r = this.ref(n);
    if (!r) return;
    try {
      const name = await this.editor.addToOpen(r.source, r.voice);
      if (name) vscode.window.setStatusBarMessage(`EDGEwave: added to ${name} as a new track`, 4000);
      else {
        const pick = await vscode.window.showInformationMessage("No sound is open in EDGEwave to add it to. Open it in EDGEwave on its own, or create a sound first.", "Open in EDGEwave", "Create a Sound");
        if (pick === "Open in EDGEwave") await this.open(n);
        else if (pick === "Create a Sound") await vscode.commands.executeCommand("edgewave.newSound");
      }
    } catch (e) {
      void vscode.window.showErrorMessage(`EDGEwave: ${(e as Error).message}`);
    }
  }

  async copyName(n?: AssetNode): Promise<void> {
    const text = n?.kind === "event" ? n.event.name : n?.kind === "variation" ? String(n.soundHash) : n?.kind === "file" ? n.file.name : undefined;
    if (!text) return;
    await vscode.env.clipboard.writeText(text);
    vscode.window.setStatusBarMessage(`EDGEwave: copied ${text}`, 3000);
  }

  async askFilter(): Promise<void> {
    const v = await vscode.window.showInputBox({
      title: "Filter the game's sounds",
      prompt: "Words that must all be in the name (judy q307), or a pattern with * and ? (*_q307_f_*)",
      value: this.filter?.pattern ?? "",
    });
    if (v !== undefined) this.setFilter(v.trim() || undefined);
  }
}
