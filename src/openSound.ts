// edgewave.openSound: a sound reference from REDcode (or a file) becomes a sound document, made the
// first time and opened after that. Layout, under the project's source/raw (or a folder the modder
// picks when no project is open):
//   a game file    base\...\name.wem   ->  base\...\name.edgewave, rendering name.wav beside it
//   a sound effect                     ->  sfx\<event name or hash>\<sound hash>.edgewave, rendering <sound hash>.wav
// A file on disk gets its document beside it, rendering <name>.wav (<name>.edit.wav for a .wav).

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { Extension, formatDoc, looksLikeVoice, type SoundDoc, type Source } from "./doc";
import { redcode, type SoundRef } from "./redcode";

export const ViewType = "edgewave.sound";

/** Characters Windows does not allow in a file name. */
const safe = (s: string) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");

/** The folder that game sounds' documents go under: the project's source/raw, or one the modder picks. */
async function soundsRoot(): Promise<string | undefined> {
  const api = await redcode();
  const raw = api.project()?.raw;
  if (raw) return raw;
  const pick = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
    openLabel: "Keep sound documents here",
    title: "No REDcode project is open. Where should EDGEwave keep this sound's document?",
  });
  return pick?.[0]?.fsPath;
}

interface Planned {
  file: string;
  doc: SoundDoc;
}

async function plan(ref: SoundRef): Promise<Planned | undefined> {
  if (ref.soundHash !== undefined) {
    const api = await redcode();
    const soundHash = ref.soundHash >>> 0;
    const { events } = await api.soundIndex();
    const event = (ref.eventHash !== undefined && events.find((e) => e.hash === ref.eventHash)) || events.find((e) => e.sounds.includes(soundHash));
    const source: Source = { kind: "sfx", soundHash, eventHash: event?.hash ?? ref.eventHash, eventName: event?.name ?? undefined };
    const root = await soundsRoot();
    if (!root) return undefined;
    const folder = path.join(root, "sfx", safe(event?.name ?? String(event?.hash ?? ref.eventHash ?? "unknown event")));
    return { file: path.join(folder, `${soundHash}${Extension}`), doc: { edgewave: 1, source, edits: [], render: { file: `${soundHash}.wav` } } };
  }
  if (ref.path) {
    const gamePath = ref.path.replace(/\//g, "\\");
    const root = await soundsRoot();
    if (!root) return undefined;
    const base = path.join(root, ...gamePath.split("\\").filter(Boolean)).replace(/\.[^.\\/]+$/, "");
    const name = path.basename(base);
    return { file: base + Extension, doc: { edgewave: 1, source: { kind: "game", path: gamePath }, voice: looksLikeVoice(gamePath) || undefined, edits: [], render: { file: `${name}.wav` } } };
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
      doc: { edgewave: 1, source: { kind: "file", file: path.basename(file) }, voice: looksLikeVoice(file) || undefined, edits: [], render: { file: ext === ".wav" ? `${name}.edit.wav` : `${name}.wav` } },
    };
  }
  throw new Error("A sound reference needs path, soundHash or uri");
}

/** Opens a sound in the editor, making its document first when there is none. */
export async function openSound(ref: SoundRef): Promise<void> {
  try {
    const p = await plan(ref);
    if (!p) return;
    if (!fs.existsSync(p.file)) {
      fs.mkdirSync(path.dirname(p.file), { recursive: true });
      fs.writeFileSync(p.file, formatDoc(p.doc));
    }
    await vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(p.file), ViewType);
  } catch (e) {
    void vscode.window.showErrorMessage(`EDGEwave: ${(e as Error).message}`);
  }
}

/** edgewave.open: a sound file from the Explorer's menu or a file picker. */
export async function openFile(uri?: vscode.Uri): Promise<void> {
  if (!(uri instanceof vscode.Uri)) {
    const pick = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { Sounds: ["wav", "ogg", "mp3", "flac", "opus", "wem"], "EDGEwave documents": ["edgewave"] },
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
