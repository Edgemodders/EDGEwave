// The sound editor: a custom editor over the .edgewave document's JSON text, so VS Code gives it
// save, undo and redo as for any file. The page (webview/editor.ts) decodes the sources, applies the
// edits, mixes, plays and renders; this side fetches each source's audio when the page asks, adds
// tracks (Add Sound), and writes the document and the render.

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { formatDoc, looksLikeVoice, newTrack, nextTrackId, parseDoc, type SoundDoc, type Source } from "./doc";
import { redcode } from "./redcode";

/** Formats the page decodes itself, read straight from disk. */
const Direct: Record<string, string> = { ".wav": "audio/wav", ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".flac": "audio/flac" };

interface SourceAudio {
  data: Uint8Array;
  mime: string;
  codec?: string;
  channels?: number;
  sampleRate?: number;
  name: string;
}

/** The source's audio in a form the page decodes: through REDcode for the game, Opus and .wem; straight from disk otherwise. */
async function loadSource(docFile: string, s: Source): Promise<SourceAudio> {
  if (s.kind === "file") {
    const file = path.resolve(path.dirname(docFile), s.file);
    if (!fs.existsSync(file)) throw new Error(`The source file is missing: ${file}`);
    const mime = Direct[path.extname(file).toLowerCase()];
    if (mime) return { data: fs.readFileSync(file), mime, name: path.basename(file) };
    return (await redcode()).sound({ uri: vscode.Uri.file(file).toString() });
  }
  const api = await redcode();
  return s.kind === "game" ? api.sound({ path: s.path }) : api.sound({ soundHash: s.soundHash, eventHash: s.eventHash });
}

/** Bytes from the page: a Uint8Array, or the plain object some VS Code versions turn one into. */
function bytes(x: unknown): Uint8Array {
  if (x instanceof Uint8Array) return x;
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (x && typeof x === "object") return Uint8Array.from(Object.values(x as Record<string, number>));
  throw new Error("The page sent no audio");
}

type FromPage =
  | { type: "ready" }
  | { type: "need"; key: string; source: Source }
  | { type: "addSound" }
  | { type: "edit"; doc: SoundDoc }
  | { type: "render"; wav: Uint8Array }
  | { type: "stub"; tool: "translate" | "revoice" }
  | { type: "error"; text: string };

type Pick = vscode.QuickPickItem & { pick?: "file" | "path"; event?: { hash: number; name: string | null; tags: string[]; sounds: number[] } };

/** A source for a new track, chosen by the modder; undefined when they cancel. */
async function pickSource(docDir: string): Promise<Source | undefined> {
  const items = (async (): Promise<Pick[]> => {
    const head: Pick[] = [
      { label: "$(file) A sound file…", pick: "file", alwaysShow: true },
      { label: "$(archive) A game file by its path…", description: "such as a voice line .wem", pick: "path", alwaysShow: true },
    ];
    const sep: Pick = { label: "Sound effects", kind: vscode.QuickPickItemKind.Separator };
    try {
      const { events } = await (await redcode()).soundIndex();
      const named = events.filter((e) => e.name).sort((a, b) => a.name!.localeCompare(b.name!));
      const unnamed = events.filter((e) => !e.name);
      const row = (e: (typeof events)[number]): Pick => ({
        label: e.name ?? `event ${e.hash}`,
        description: e.tags.join(", "),
        detail: `${e.sounds.length} variation${e.sounds.length === 1 ? "" : "s"}`,
        event: e,
      });
      return [...head, sep, ...named.map(row), ...unnamed.map(row)];
    } catch (e) {
      return [...head, sep, { label: `$(warning) ${(e as Error).message}` }];
    }
  })();
  const chosen = await vscode.window.showQuickPick(items, { title: "Add a sound as a new track", placeHolder: "Type a sound effect's event name or tag", matchOnDescription: true });
  if (!chosen) return undefined;
  if (chosen.pick === "file") {
    const pick = await vscode.window.showOpenDialog({ canSelectMany: false, defaultUri: vscode.Uri.file(docDir), filters: { Sounds: ["wav", "ogg", "mp3", "flac", "opus", "wem"] }, title: "A sound file for the new track" });
    const file = pick?.[0]?.fsPath;
    if (!file) return undefined;
    const rel = path.relative(docDir, file);
    // Relative when it can be (the document moves with its project); absolute across drives.
    return { kind: "file", file: path.isAbsolute(rel) ? file : rel };
  }
  if (chosen.pick === "path") {
    const p = await vscode.window.showInputBox({ title: "A game file for the new track", prompt: "Its path in the archives, as REDcode's Game Assets shows it", placeHolder: "base\\localization\\en-us\\vo\\....wem" });
    return p?.trim() ? { kind: "game", path: p.trim().replace(/\//g, "\\") } : undefined;
  }
  const event = chosen.event;
  if (!event) return undefined;
  let soundHash = event.sounds[0];
  if (event.sounds.length > 1) {
    const v = await vscode.window.showQuickPick(
      event.sounds.map((h, i) => ({ label: `Variation ${i + 1}`, description: String(h), hash: h })),
      { title: `${event.name ?? `event ${event.hash}`}: which variation?` },
    );
    if (!v) return undefined;
    soundHash = v.hash;
  }
  return { kind: "sfx", soundHash, eventHash: event.hash, eventName: event.name ?? undefined };
}

export class SoundEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext, private readonly log: vscode.OutputChannel) {}

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    const webview = panel.webview;
    const dist = vscode.Uri.joinPath(this.context.extensionUri, "dist");
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media");
    webview.options = { enableScripts: true, localResourceRoots: [dist, media] };
    webview.html = this.html(webview, dist, media);

    const post = (m: unknown) => void webview.postMessage(m);

    /** Sends the document; the page asks for the sources it has not got. */
    const sendDoc = () => {
      try {
        post({ type: "doc", doc: parseDoc(document.getText()) });
      } catch (e) {
        post({ type: "invalid", text: (e as Error).message });
      }
    };

    const sendSource = async (key: string, source: Source) => {
      try {
        const audio = await loadSource(document.uri.fsPath, source);
        // A plain Uint8Array with its own buffer: a Node Buffer does not reach the page as bytes.
        post({ type: "audio", key, data: new Uint8Array(audio.data), mime: audio.mime, codec: audio.codec, name: audio.name });
      } catch (e) {
        post({ type: "audioError", key, text: (e as Error).message });
      }
    };

    const changed = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString() && e.contentChanges.length) void sendDoc();
    });
    panel.onDidDispose(() => changed.dispose());

    webview.onDidReceiveMessage(async (m: FromPage) => {
      switch (m.type) {
        case "ready":
          return sendDoc();
        case "need":
          return sendSource(m.key, m.source);
        case "addSound":
          return this.addSound(document);
        case "edit": {
          const text = formatDoc(m.doc);
          if (text === document.getText()) return;
          const edit = new vscode.WorkspaceEdit();
          edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), text);
          await vscode.workspace.applyEdit(edit);
          return;
        }
        case "render":
          return this.render(document, bytes(m.wav));
        case "stub": {
          const name = m.tool === "translate" ? "Translate" : "Re-Voice";
          const what = m.tool === "translate" ? "speak this line in another language" : "keep the words and delivery in a different voice";
          void vscode.window.showInformationMessage(`${name} is planned: it will ${what}, through an AI service. It is not built yet.`);
          return;
        }
        case "error":
          this.log.appendLine(`Page: ${m.text}`);
          return;
      }
    });
  }

  /** Add Sound: a quick pick over the game's sound effects (REDcode's index), a game path or a file; the choice becomes a new track. */
  private async addSound(document: vscode.TextDocument): Promise<void> {
    try {
      const dir = path.dirname(document.uri.fsPath);
      const source = await pickSource(dir);
      if (!source) return;
      const doc = parseDoc(document.getText());
      const voice = source.kind === "game" ? looksLikeVoice(source.path) : source.kind === "file" ? looksLikeVoice(path.resolve(dir, source.file)) : false;
      doc.tracks.push(newTrack(nextTrackId(doc), source, voice));
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), formatDoc(doc));
      await vscode.workspace.applyEdit(edit);
    } catch (e) {
      void vscode.window.showErrorMessage(`EDGEwave: ${(e as Error).message}`);
    }
  }

  private async render(document: vscode.TextDocument, wav: Uint8Array): Promise<void> {
    try {
      // The saved document always matches the render it made.
      if (document.isDirty) await document.save();
      const doc = parseDoc(document.getText());
      const dir = path.dirname(document.uri.fsPath);
      const out = path.resolve(dir, doc.render.file);
      for (const t of doc.tracks) {
        if (t.source.kind === "file" && path.resolve(dir, t.source.file).toLowerCase() === out.toLowerCase()) {
          throw new Error("The render file is a track's source file. Change render.file in the document so the source is kept.");
        }
      }
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, wav);
      this.log.appendLine(`Rendered ${out} (${wav.length} bytes)`);
      const open = await vscode.window.showInformationMessage(`Rendered ${path.basename(out)}.`, "Show in Explorer");
      if (open) await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(out));
    } catch (e) {
      void vscode.window.showErrorMessage(`EDGEwave render: ${(e as Error).message}`);
    }
  }

  private html(webview: vscode.Webview, dist: vscode.Uri, media: vscode.Uri): string {
    const nonce = Array.from({ length: 24 }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 62)]).join("");
    const css = webview.asWebviewUri(vscode.Uri.joinPath(media, "editor.css"));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(dist, "editor.js"));
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${css}">
</head><body>
<header>
  <span class="name" id="title">Loading…</span><span class="meta" id="meta"></span><span class="spacer"></span>
  <label class="check" title="Mark this sound as a voice line, for the voice tools"><input type="checkbox" id="voice"> Voice line</label>
  <button id="translate" hidden title="Speak this line in another language (planned)">Translate</button>
  <button id="revoice" hidden title="Keep the words and delivery in a different voice: another gender or style (planned)">Re-Voice</button>
</header>
<div class="toolbar mixbar">
  <span class="label">Mix</span>
  <button id="playMix" title="Play the whole mix from the mix cursor, with the master (Shift+Space)">Play mix</button>
  <button id="loopPlay" title="Loop: the clip's selection or the whole clip; the mix's loop points or the whole mix">Loop</button>
  <button id="addSound" title="Add a game sound effect, a game file or a sound file as a new track">Add Sound…</button>
  <span class="spacer"></span>
  <span id="mixTime" class="mono"></span>
  <button id="render" class="primary" title="Write the mix as a 16-bit WAV, reverb tails included (settings in Master)">Render WAV</button>
</div>
<div class="lanes"><canvas id="mix"></canvas></div>
<div class="toolbar track">
  <span class="label">Track</span><span id="trackName" class="mono trackname"></span>
  <label class="param" title="The track's level in dB">Gain <input id="trackGain" type="number" step="0.5" min="-60" max="24"> dB</label>
  <label class="param" title="-1 left, 0 centre, 1 right">Pan <input id="trackPan" type="number" step="0.1" min="-1" max="1"></label>
  <label class="param" title="Playback rate: pitch and speed together (0.25 to 4)">Rate <input id="trackRate" type="number" step="0.05" min="0.25" max="4"></label>
  <label class="param" title="Where the clip starts on the mix; or drag it in the lanes">Start <input id="trackOffset" type="number" step="0.01" min="0"> s</label>
  <button id="mute" title="Mute this track">Mute</button>
  <button id="solo" title="Hear only the soloed tracks">Solo</button>
  <button id="removeTrack" title="Remove this track from the mix">Remove</button>
</div>
<div class="toolbar">
  <button id="play" title="Play the selected clip, with its track's effects, from the cursor or the selection (Space)">Play clip</button>
  <span class="sep"></span>
  <button id="zoomIn" title="Zoom in (Ctrl+wheel)">+</button><button id="zoomOut" title="Zoom out">−</button><button id="zoomFit" title="Show the whole clip">Fit</button><button id="zoomSel" title="Zoom to the selection">Sel</button>
  <span class="spacer"></span>
  <span id="time" class="mono"></span>
</div>
<div class="wave" id="wave"><canvas id="canvas"></canvas><div class="note" id="note">Loading the sound…</div></div>
<div class="toolbar">
  <button id="trim" title="Keep only the selection">Trim</button>
  <button id="cut" title="Remove the selection and keep it for Paste (Ctrl+X, Delete)">Cut</button>
  <button id="copy" title="Copy the selection (Ctrl+C)">Copy</button>
  <button id="paste" title="Insert the copy at the cursor (Ctrl+V)">Paste</button>
  <button id="silence" title="Insert silence at the cursor, as long as the selection or half a second">Silence</button>
  <span class="sep"></span>
  <button id="fadeIn" title="Fade in over the selection, or from the start to the cursor">Fade in</button>
  <button id="fadeOut" title="Fade out over the selection, or from the cursor to the end">Fade out</button>
  <select id="curve" title="The fades' curve"><option value="linear">Linear</option><option value="exponential">Exponential</option><option value="smooth">Smooth</option></select>
  <span class="sep"></span>
  <input id="gainDb" type="number" step="0.5" value="-3" title="Gain in dB"><button id="gain" title="Change the volume of the selection, or the whole sound">Gain dB</button>
  <input id="peakDb" type="number" step="0.5" value="-1" max="0" title="Peak in dBFS"><button id="normalize" title="Bring the loudest peak of the selection, or the whole sound, to this level">Normalize</button>
  <button id="channels" title="Mix down to mono, or make mono stereo">Mono</button>
  <span class="sep"></span>
  <button id="setLoop" title="Set the mix's loop points to the selection">Set loop</button>
  <button id="clearLoop" title="Clear the loop points">Clear loop</button>
</div>
<div class="panes">
  <section>
    <h2>Edits · <span id="editsOf"></span></h2>
    <ol id="edits"></ol>
    <p class="dim" id="noEdits">No edits yet. Undo and redo work as in any file.</p>
  </section>
  <section>
    <h2>Effects · <span id="effectsOf"></span></h2>
    <div class="fxbar"><select id="trackPreset" title="Replace this track's effects with a preset chain"></select><select id="trackAdd" title="Add an effect to the end of this track's chain"></select></div>
    <ol id="trackEffects" class="effects"></ol>
    <p class="dim" id="noEffects">No effects. Pick a preset or add one.</p>
  </section>
  <section>
    <h2>Master</h2>
    <div class="fxbar"><label class="param" title="The mix's level in dB">Gain <input id="masterGain" type="number" step="0.5" min="-60" max="24"> dB</label><select id="masterPreset" title="Replace the master's effects with a preset chain"></select><select id="masterAdd" title="Add an effect to the master"></select></div>
    <ol id="masterEffects" class="effects"></ol>
    <h2>Render</h2>
    <div class="row"><span>File</span><span id="renderFile" class="mono"></span></div>
    <div class="row"><span>Sample rate</span><select id="rate"><option value="">As the first track</option><option>48000</option><option>44100</option><option>32000</option><option>24000</option><option>22050</option><option>16000</option></select></div>
    <div class="row"><span>Result</span><span id="renderInfo" class="mono"></span></div>
  </section>
</div>
<script nonce="${nonce}" src="${js}"></script>
</body></html>`;
  }
}
