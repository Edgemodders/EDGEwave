// edgewave.openSound: a sound reference from REDcode (or a file) becomes a sound document, made the
// first time and opened after that. Layout, under the project's source/raw (or a folder the modder
// picks when no project is open):
//   a game file    base\...\name.wem   ->  base\...\name.edgewave, rendering name.wav beside it
//   a sound effect                     ->  sfx\<event name or hash>\<sound hash>.edgewave, rendering <sound hash>.wav
// With no project open, a game sound becomes a mix on the Desk (src/desk.ts), found again the next time.
// A file on disk gets its document beside it, rendering <name>.wav (<name>.edit.wav for a .wav).
// Create a Sound (newSound) makes an empty document, by default under source/raw/edgewave/sounds; with no
// project, and from the Desk's +, on the Desk.

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { withDialogFolder } from "./dialogFolder";
import { deskMixFor, newOnDesk } from "./desk";
import { emptyDoc, Extension, formatDoc, isSoundFile, looksLikeVoice, newDoc, sourceKey, SoundExtensions, type SoundDoc, type Source } from "./doc";
import { redcode, type SoundRef } from "./redcode";

/** Says who made an item, in its history: "EDGEwave <version>". */
export const toolName = () => `EDGEwave ${String((vscode.extensions.getExtension("edgemodders.edgewave")?.packageJSON as { version?: string } | undefined)?.version ?? "")}`.trim();

export const ViewType = "edgewave.sound";

/** Characters Windows does not allow in a file name. */
const safe = (s: string) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");

/** A mix in the project's folders, or, with no project open, one on the Desk under a name. */
type Planned = { file: string; doc: SoundDoc } | { desk: string; doc: SoundDoc; gamePath?: string };

async function plan(ref: SoundRef): Promise<Planned | undefined> {
  if (ref.soundHash !== undefined) {
    const api = await redcode();
    const soundHash = ref.soundHash >>> 0;
    const { events } = await api.soundIndex();
    const event = (ref.eventHash !== undefined && events.find((e) => e.hash === ref.eventHash)) || events.find((e) => e.sounds.includes(soundHash));
    const source: Source = { kind: "sfx", soundHash, eventHash: event?.hash ?? ref.eventHash, eventName: event?.name ?? undefined };
    const root = api.project()?.raw;
    if (!root) return { desk: `${event?.name ?? "sound"} ${soundHash}`, doc: newDoc(source, `${soundHash}.wav`) };
    const folder = path.join(root, "sfx", safe(event?.name ?? String(event?.hash ?? ref.eventHash ?? "unknown event")));
    return { file: path.join(folder, `${soundHash}${Extension}`), doc: newDoc(source, `${soundHash}.wav`) };
  }
  if (ref.path) {
    const gamePath = ref.path.replace(/\//g, "\\");
    const root = (await redcode()).project()?.raw;
    const voice = looksLikeVoice(gamePath);
    if (!root) return { desk: path.win32.basename(gamePath).replace(/\.[^.]+$/, ""), doc: newDoc({ kind: "game", path: gamePath }, "sound.wav", voice), gamePath };
    const base = path.join(root, ...gamePath.split("\\").filter(Boolean)).replace(/\.[^.\\/]+$/, "");
    const name = path.basename(base);
    return { file: base + Extension, doc: newDoc({ kind: "game", path: gamePath }, `${name}.wav`, voice) };
  }
  if (ref.uri) {
    const uri = vscode.Uri.parse(ref.uri);
    if (uri.scheme !== "file") throw new Error(`EDGEwave opens game files by their path and other sounds from disk, not ${uri.scheme}: URIs`);
    const file = uri.fsPath;
    const ext = path.extname(file).toLowerCase();
    const base = file.slice(0, file.length - ext.length);
    const name = path.basename(base);
    return {
      file: base + Extension,
      doc: newDoc({ kind: "file", file: path.basename(file) }, ext === ".wav" ? `${name}.edit.wav` : `${name}.wav`, looksLikeVoice(file)),
    };
  }
  throw new Error("A sound reference needs path, soundHash or uri");
}

/** Opens a sound in the editor, making its document first when there is none. */
export async function openSound(ref: SoundRef): Promise<void> {
  try {
    const p = await plan(ref);
    if (!p) return;
    if ("desk" in p) {
      const key = sourceKey(p.doc.tracks[0].source);
      const item = deskMixFor(key) ?? newOnDesk({ name: p.desk, tool: toolName(), doc: p.doc, from: key, gamePath: p.gamePath, did: "Opened from the game with no project open" });
      await vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(item.doc), ViewType);
      void vscode.commands.executeCommand("edgewave.refreshSounds");
      return;
    }
    if (!fs.existsSync(p.file)) {
      fs.mkdirSync(path.dirname(p.file), { recursive: true });
      fs.writeFileSync(p.file, formatDoc(p.doc));
    }
    await vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(p.file), ViewType);
  } catch (e) {
    void vscode.window.showErrorMessage(`EDGEwave: ${(e as Error).message}`);
  }
}

/**
 * edgewave.newSound (Create a Sound): an empty document with no tracks, filled by dropping sound files on
 * it, Add Sound or a voice tool. Saved where the modder says, by default the project's
 * source/raw/edgewave/sounds; `file` skips the question (the smoke test).
 */
export async function newSound(file?: string): Promise<void> {
  try {
    if (typeof file !== "string") {
      const raw = (await redcode().catch(() => undefined))?.project()?.raw;
      if (!raw) return newDeskSound();
      const dir = raw ? path.join(raw, "edgewave", "sounds") : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      let name = "New sound";
      for (let n = 2; dir && fs.existsSync(path.join(dir, name + Extension)); n++) name = `New sound ${n}`;
      const ask = () =>
        vscode.window.showSaveDialog({
          defaultUri: dir ? vscode.Uri.file(path.join(dir, name + Extension)) : undefined,
          filters: { "EDGEwave documents": ["edgewave"] },
          saveLabel: "Create",
          title: "Create a sound: its name and where to keep it (the render, a WAV, goes beside it)",
        });
      const pick = await (dir ? withDialogFolder(dir, ask) : ask());
      if (!pick) return;
      file = pick.fsPath;
    }
    if (!file.toLowerCase().endsWith(Extension)) file += Extension;
    const name = path.basename(file, Extension);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, formatDoc(emptyDoc(`${name}.wav`)));
    await vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(file), ViewType);
  } catch (e) {
    void vscode.window.showErrorMessage(`EDGEwave: ${(e as Error).message}`);
  }
}

/** edgewave.newDeskSound (the Desk's +): an empty mix on the Desk, under a name the modder gives. */
export async function newDeskSound(): Promise<void> {
  try {
    const name = (
      await vscode.window.showInputBox({
        title: "Create a sound on the Desk: its name",
        prompt: "The Desk keeps it until you move it to a project or add it to the Library",
        value: "New sound",
        validateInput: (v) => (v.trim() ? undefined : "A name, please"),
      })
    )?.trim();
    if (!name) return;
    const item = newOnDesk({ name, tool: toolName() });
    await vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(item.doc), ViewType);
    void vscode.commands.executeCommand("edgewave.refreshSounds");
  } catch (e) {
    void vscode.window.showErrorMessage(`EDGEwave: ${(e as Error).message}`);
  }
}

/**
 * edgewave.open: a sound file from the Explorer's menu, REDcode's Project view (its node, with the
 * file in `file`), or a file picker.
 */
export async function openFile(arg?: vscode.Uri | { file?: string; resourceUri?: vscode.Uri }): Promise<void> {
  let uri = arg instanceof vscode.Uri ? arg : arg?.resourceUri ?? (typeof arg?.file === "string" ? vscode.Uri.file(arg.file) : undefined);
  if (uri && !isSoundFile(uri.fsPath) && !uri.fsPath.toLowerCase().endsWith(Extension)) {
    void vscode.window.showInformationMessage(`EDGEwave opens sounds (.wav, .ogg, .mp3, .flac, .opus, .wem); ${path.basename(uri.fsPath)} is not one.`);
    return;
  }
  if (!uri) {
    const pick = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { Sounds: SoundExtensions, "EDGEwave documents": ["edgewave"] },
      title: "Open a sound in EDGEwave",
    });
    uri = pick?.[0];
    if (!uri) return;
  }
  if (uri.fsPath.toLowerCase().endsWith(Extension)) {
    await vscode.commands.executeCommand("vscode.openWith", uri, ViewType);
    return;
  }
  await openSound({ uri: uri.toString() });
}
