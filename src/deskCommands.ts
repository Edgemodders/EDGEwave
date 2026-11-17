// The commands of the Desk, Project and Library views: ▶ and Hear on any row, a Desk mix moved to a project,
// added to the Library, renamed or taken off; the Library's folder; a Library sound into a project or back on
// the Desk; Refresh from Library. The work itself is in src/desk.ts and src/library.ts.

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { copyToDesk, deskDir, deskItemOf, moveToProject, newOnDesk, readItem, removeFolder, renameItem, type SoundItem } from "./desk";
import { isDeskRow, type DeskRow, type DeskView } from "./deskView";
import { emptyDoc, isSoundFile, looksLikeVoice, newTrack } from "./doc";
import {
  addFromLibrary,
  addToLibrary,
  editOnDesk,
  gamePathFolders,
  libraryFolders,
  libraryRoot,
  recordedLibraryRoot,
  refreshList,
  safeFolder,
  setLibraryRoot,
  suggestedLibraryRoot,
  type LibrarySound,
} from "./library";
import { librarySoundOf, type LibraryNode, type LibraryView } from "./libraryView";
import { same, type MixRow } from "./mixRow";
import { toolName, ViewType } from "./openSound";
import type { NamedItem, PlacedItem, ProjectView } from "./projectView";
import { redcode } from "./redcode";
import type { SoundEvents } from "./soundEvents";

const FolderState = "edgewave.library.folder";
const GamePathState = "edgewave.library.useGamePath";

type Row = MixRow | DeskRow | NamedItem | PlacedItem | LibraryNode;

/** The sound file a row plays: a mix's render, a project sound's WAV, a Library sound's render or file. */
function fileOf(n: Row | undefined): string | undefined {
  if (!n) return undefined;
  switch (n.kind) {
    case "mix":
      return n.render;
    case "named":
      return n.file && !n.missing ? path.join(n.dir, n.file) : undefined;
    case "placed":
      return n.file;
    case "sound":
      return n.sound.render;
    case "file":
      return n.file;
    default:
      return undefined;
  }
}

const fail = (e: unknown) => void vscode.window.showErrorMessage(`EDGEwave: ${(e as Error).message}`);

/** Saves a mix if it has unsaved changes and closes its tabs, before its folder moves; whether it was open. */
async function release(file: string): Promise<boolean> {
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.scheme === "file" && same(d.uri.fsPath, file));
  if (doc?.isDirty) await doc.save();
  const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => {
    const input = t.input;
    return (input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText) && input.uri.scheme === "file" && same(input.uri.fsPath, file);
  });
  if (tabs.length) await vscode.window.tabGroups.close(tabs);
  return tabs.length > 0;
}

const openMix = (file: string) => vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(file), ViewType);

/** The Desk item a command is about: its row, else the mix in the active tab when it is on the Desk. */
function deskItemFrom(n: unknown): SoundItem | undefined {
  if (isDeskRow(n)) return readItem(n.item.folder);
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  const uri = input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText ? input.uri : undefined;
  return uri?.scheme === "file" ? deskItemOf(uri.fsPath) : undefined;
}

/** The Library's root, asking for one the first time: Documents\EDGE Library, or a folder picked. */
export async function ensureLibraryRoot(ask = true): Promise<string | undefined> {
  const root = libraryRoot();
  if (root && !ask) return root;
  const recorded = recordedLibraryRoot();
  const suggested = suggestedLibraryRoot();
  type It = vscode.QuickPickItem & { pick: "suggested" | "other" | "keep" };
  const items: It[] = [];
  if (root) items.push({ label: `$(check) Keep ${root}`, detail: "Every EDGE tool uses this folder now", pick: "keep" });
  items.push(
    { label: `$(library) ${suggested}`, detail: "The usual place: one folder for every EDGE tool's Library, outside any game or project folder", pick: "suggested" },
    { label: "$(folder-opened) Another folder…", detail: "A bigger drive, or a folder you already use", pick: "other" },
  );
  const pick = await vscode.window.showQuickPick(items, {
    title: recorded && !root ? `The Library's folder is missing (${recorded}): where is it now?` : "Where should the EDGE Library be? Every EDGE tool shares it",
  });
  if (!pick || pick.pick === "keep") return pick ? root : undefined;
  let folder = suggested;
  if (pick.pick === "other") {
    const chosen = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: "Use as the Library", title: "The EDGE Library's folder" });
    if (!chosen?.[0]) return undefined;
    folder = chosen[0].fsPath;
  }
  const gameDir = (await redcode().catch(() => undefined))?.gamePath();
  return setLibraryRoot(folder, { gameDir });
}

export function registerDeskCommands(context: vscode.ExtensionContext, o: { desk: DeskView; project: ProjectView; library: LibraryView; events: SoundEvents; log: (line: string) => void }): void {
  const { desk, project, library, events, log } = o;
  const refreshAll = () => {
    desk.refresh();
    project.refresh();
    library.refresh();
  };
  const tool = () => toolName();
  const reg = (id: string, fn: (...args: never[]) => unknown) =>
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async (...args: never[]) => {
        try {
          return await fn(...args);
        } catch (e) {
          fail(e);
        }
      }),
    );

  // ---- any row ----
  reg("edgewave.playRender", async (n: Row) => {
    const file = fileOf(n);
    if (!file) return;
    const r = await events.playFile(file);
    if (!r.ok) void vscode.window.showInformationMessage(`EDGEwave: ${r.reason}`);
  });
  // Shown, greyed, in place of ▶ on a mix with no render (its enablement is false).
  reg("edgewave.renderFirst", () => undefined);
  reg("edgewave.hearFile", (n: Row) => {
    const file = fileOf(n);
    if (!file || !fs.existsSync(file)) return void vscode.window.showInformationMessage("EDGEwave: its WAV is not there.");
    const title = n.kind === "placed" ? n.label : n.kind === "sound" ? n.sound.title : path.basename(file);
    const notes = n.kind === "placed" ? [n.how[0].toUpperCase() + n.how.slice(1) + "."] : n.kind === "sound" ? [`A sound in the Library, version ${n.sound.asset?.version ?? 1}: its render.`] : [];
    events.hearFile(title, file, notes);
  });
  reg("edgewave.openMadeMix", (n: NamedItem | PlacedItem) => n?.mix && openMix(n.mix.fsPath));
  reg("edgewave.reveal", (n: Row) => {
    const file = n?.kind === "mix" ? n.uri.fsPath : n?.kind === "sound" ? n.sound.folder : fileOf(n);
    if (file) return vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(file));
  });
  reg("edgewave.refreshSounds", refreshAll);

  // ---- the Desk ----
  reg("edgewave.desk.moveToProject", async (n?: DeskRow) => {
    const item = deskItemFrom(n);
    if (!item) return void vscode.window.showInformationMessage("EDGEwave: pick a mix on the Desk to move.");
    const p = (await redcode()).project();
    if (!p) return void vscode.window.showInformationMessage("EDGEwave: open a REDcode project first; Move to Project puts the mix in its source/raw/edgewave/sounds.");
    const ok = await vscode.window.showInformationMessage(
      `Move ${item.title} into ${p.name}?`,
      { modal: true, detail: `The mix, its own files and its render go to source/raw/edgewave/sounds/${item.name}/ and leave the Desk.${item.asset?.library ? " Its Library copy stays as it is." : ""} Then Add to Project in the mix puts it in the game.` },
      "Move",
    );
    if (ok !== "Move") return;
    const wasOpen = await release(item.doc);
    const r = moveToProject(item, p.raw);
    log(`Desk: moved ${item.folder} to ${r.doc}`);
    refreshAll();
    if (wasOpen) await openMix(r.doc);
    const pick = await vscode.window.showInformationMessage(`${item.title} is in the project: ${path.relative(p.dir, path.dirname(r.doc))}.${r.missing.length ? ` Missing sources, kept by their path: ${r.missing.join(", ")}.` : ""}`, ...(wasOpen ? [] : ["Open It"]));
    if (pick === "Open It") await openMix(r.doc);
  });

  reg("edgewave.desk.addToLibrary", async (n?: DeskRow) => {
    const item = deskItemFrom(n);
    if (!item) return void vscode.window.showInformationMessage("EDGEwave: Add to Library takes a mix on the Desk. Put a project's mix there with Copy to the Desk, or make one with the Desk's +.");
    const doc = vscode.workspace.textDocuments.find((d) => same(d.uri.fsPath, item.doc));
    if (doc?.isDirty) await doc.save();
    if (!item.rendered) return void vscode.window.showInformationMessage(`EDGEwave: render ${item.title} first (Render WAV in the mix): a project takes its WAV from the Library.`);
    const root = await ensureLibraryRoot(false);
    if (!root) return;
    const linked = item.asset?.library;
    let folder: string | undefined;
    let useGamePath = false;
    const update = linked && fs.existsSync(path.join(root, ...linked.path.split("/")));
    if (!update) {
      const last = context.globalState.get<string>(FolderState);
      type It = vscode.QuickPickItem & { rel?: string; make?: boolean };
      const folders = libraryFolders(root);
      const items: It[] = [
        ...(last !== undefined && (last === "" || folders.includes(last)) ? [{ label: `$(history) ${last || "The Library's top folder"}`, description: "last time", rel: last }] : []),
        { label: "$(new-folder) A new folder…", make: true },
        { label: "$(root-folder) The Library's top folder", rel: "" },
        ...folders.map((f) => ({ label: `$(folder) ${f}`, rel: f })),
      ];
      const pick = await vscode.window.showQuickPick(items, { title: `Add ${item.title} to the Library: in which folder?`, placeHolder: "The folders are yours: pick one, or make one" });
      if (!pick) return;
      folder = pick.rel;
      if (pick.make) {
        folder = (
          await vscode.window.showInputBox({
            title: "A new Library folder",
            prompt: "Under the Library's top folder; / between folders, such as Sounds/Doors",
            validateInput: (v) => {
              try {
                return safeFolder(v) ? undefined : "A folder name, please";
              } catch (e) {
                return (e as Error).message;
              }
            },
          })
        )?.trim();
        if (!folder) return;
        folder = safeFolder(folder);
      }
      await context.globalState.update(FolderState, folder);
      if (item.asset?.gamePath) {
        const lastGame = context.globalState.get<boolean>(GamePathState, false);
        const where = gamePathFolders(item.asset.gamePath).join("/");
        const choices = [
          { label: `In ${folder || "the top folder"}`, detail: `${folder ? `${folder}/` : ""}${item.name}.sound.asset`, game: false },
          { label: "Under its game path", detail: `${folder ? `${folder}/` : ""}${where}/${item.name}.sound.asset: the Library reads like the game's folders`, game: true },
        ].sort((a, b) => Number(b.game === lastGame) - Number(a.game === lastGame));
        const g = await vscode.window.showQuickPick(choices, { title: `${item.title} comes from ${item.asset.gamePath}: use its game path?` });
        if (!g) return;
        useGamePath = g.game;
        await context.globalState.update(GamePathState, useGamePath);
      }
    }
    const gameDir = (await redcode().catch(() => undefined))?.gamePath();
    const r = addToLibrary({ item, root, folder, useGamePath, tool: tool(), gameDir });
    log(`Library: ${r.updated ? "updated" : "added"} ${r.folder}, version ${r.version}`);
    refreshAll();
    void vscode.window.showInformationMessage(
      r.updated ? `${item.title} is updated in the Library: ${r.rel}, version ${r.version}. Projects that took it see it in Refresh from Library.` : `${item.title} is in the Library: ${r.rel}.${r.missing.length ? ` Missing sources, kept by their path: ${r.missing.join(", ")}.` : ""}`,
    );
  });

  reg("edgewave.copyToDesk", async (n?: MixRow) => {
    if (n?.kind !== "mix") return;
    const doc = vscode.workspace.textDocuments.find((d) => same(d.uri.fsPath, n.uri.fsPath));
    if (doc?.isDirty) await doc.save();
    const item = copyToDesk(n.uri.fsPath, tool());
    desk.refresh();
    const pick = await vscode.window.showInformationMessage(`${item.title} is on the Desk now, with its files: change it there, or Add to Library from there. The mix where it was stays as it is.`, "Open It");
    if (pick) await openMix(item.doc);
  });

  reg("edgewave.desk.rename", async (n?: DeskRow) => {
    const item = deskItemFrom(n);
    if (!item) return;
    const name = (await vscode.window.showInputBox({ title: `Rename ${item.title}`, value: item.title, validateInput: (v) => (v.trim() ? undefined : "A name, please") }))?.trim();
    if (!name || name === item.title) return;
    const wasOpen = await release(item.doc);
    const r = renameItem(item, name, tool());
    refreshAll();
    if (wasOpen) await openMix(r.doc);
  });

  reg("edgewave.desk.remove", async (n?: DeskRow) => {
    const item = deskItemFrom(n);
    if (!item) return;
    const ok = await vscode.window.showWarningMessage(
      `Take ${item.title} off the Desk?`,
      { modal: true, detail: `Its folder goes to the Recycle Bin: ${item.folder}.${item.asset?.library ? " Its Library copy stays." : ""}` },
      "Take It Off",
    );
    if (ok !== "Take It Off") return;
    await release(item.doc);
    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(item.folder), { recursive: true, useTrash: true });
    } catch {
      removeFolder(item.folder);
    }
    refreshAll();
  });

  // ---- the Library ----
  reg("edgewave.library.setRoot", async () => {
    const root = await ensureLibraryRoot(true);
    if (root) void vscode.window.showInformationMessage(`EDGEwave: the EDGE Library is ${root}, for every EDGE tool.`);
    library.refresh();
  });
  reg("edgewave.library.open", () => {
    const root = libraryRoot();
    if (root) return vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(root));
  });
  reg("edgewave.library.refresh", () => library.refresh());

  reg("edgewave.library.addToProject", async (n: LibraryNode) => {
    const sound = librarySoundOf(n);
    if (!sound) return;
    const p = (await redcode()).project();
    if (!p) return void vscode.window.showInformationMessage("EDGEwave: open a REDcode project first; Add to Project copies the sound into it.");
    const r = addFromLibrary(sound, { dir: p.dir, raw: p.raw });
    log(`Library: ${sound.rel} version ${r.version} into ${p.dir} (${r.files.length} files)`);
    project.refresh();
    const pick = await vscode.window.showInformationMessage(
      `${sound.title} ${r.replaced ? "is updated" : "is"} in ${p.name}: ${path.relative(p.dir, path.dirname(r.doc))}, noted in source/library.json. Open the mix and use its Add to Project to put it in the game.`,
      "Open the Mix",
    );
    if (pick) await openMix(r.doc);
  });

  reg("edgewave.library.editOnDesk", async (n: LibraryNode) => {
    const sound = librarySoundOf(n);
    if (!sound) return;
    let r;
    try {
      r = editOnDesk(sound, { desk: deskDir(), tool: tool() });
    } catch (e) {
      const there = fs.readdirSync(deskDir()).map((d) => readItem(path.join(deskDir(), d))).find((i) => i?.asset?.id === sound.asset?.id);
      if (!there) throw e;
      const pick = await vscode.window.showInformationMessage(`${sound.title} is on the Desk already.`, { modal: true, detail: "Open that copy, or replace it with the Library's (its changes on the Desk are lost)." }, "Open It", "Replace It");
      if (pick === "Open It") return openMix(there.doc);
      if (pick !== "Replace It") return;
      await release(there.doc);
      r = editOnDesk(sound, { desk: deskDir(), tool: tool(), replace: true });
    }
    desk.refresh();
    await openMix(r.item.doc);
  });

  // A plain sound file: a new mix on the Desk with it as track 1 (copied in when the mix is added or moved).
  reg("edgewave.library.openOnDesk", async (n: LibraryNode) => {
    if (n?.kind !== "file" || !isSoundFile(n.file)) return;
    const doc = emptyDoc("sound.wav");
    doc.tracks.push(newTrack("t1", { kind: "file", file: n.file }, looksLikeVoice(n.file)));
    const item = newOnDesk({ name: path.basename(n.file, path.extname(n.file)), tool: tool(), doc, did: `Made from ${n.file}` });
    desk.refresh();
    await openMix(item.doc);
  });

  // ---- the project ----
  reg("edgewave.refreshFromLibrary", async () => {
    const p = (await redcode()).project();
    if (!p) return void vscode.window.showInformationMessage("EDGEwave: open a REDcode project first.");
    const root = libraryRoot();
    if (!root) return void vscode.window.showInformationMessage("EDGEwave: no EDGE Library is set (the Library view's Set the Library Folder).");
    const lines = refreshList(p.dir, root);
    if (!lines.length) return void vscode.window.showInformationMessage(`EDGEwave: ${p.name} has no sounds from the Library (its source/library.json).`);
    const newer = lines.filter((l) => l.state === "newer");
    const lost = lines.filter((l) => l.state === "missing").map((l) => l.entry.path);
    if (!newer.length) return void vscode.window.showInformationMessage(`EDGEwave: the project's sounds from the Library are up to date.${lost.length ? ` Not found in the Library: ${lost.join(", ")}.` : ""}`);
    const picks = await vscode.window.showQuickPick(
      newer.map((l) => ({ label: l.sound!.title, description: `version ${l.entry.version ?? 1} → ${l.sound!.asset?.version ?? 1}`, detail: `${l.sound!.rel}. Replaces the project's copy, with any change made to it in the project`, picked: true, sound: l.sound as LibrarySound })),
      { title: "Refresh from Library: which sounds?", canPickMany: true },
    );
    if (!picks?.length) return;
    for (const x of picks) {
      const mix = newer.find((l) => l.sound === x.sound)?.entry.files.find((f) => f.endsWith(".edgewave"));
      const wasOpen = mix ? await release(path.join(p.dir, ...mix.split("/"))) : false;
      const r = addFromLibrary(x.sound, { dir: p.dir, raw: p.raw });
      if (wasOpen) await openMix(r.doc);
    }
    project.refresh();
    void vscode.window.showInformationMessage(`EDGEwave: ${picks.length} sound${picks.length === 1 ? "" : "s"} refreshed from the Library. Add to Project in each mix puts the new version in the game.${lost.length ? ` Not found in the Library: ${lost.join(", ")}.` : ""}`);
  });
}
