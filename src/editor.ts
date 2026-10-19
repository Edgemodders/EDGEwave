// The sound editor: a custom editor over the .edgewave document's JSON text, so VS Code gives it
// save, undo and redo as for any file. The page (webview/editor.ts) decodes the sources, applies the
// edits, mixes, plays and renders; this side fetches each source's audio when the page asks, adds
// tracks (Add Sound), and writes the document and the render.

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { formatDoc, looksLikeVoice, newTrack, nextTrackId, parseDoc, type SoundDoc, type Source } from "./doc";
import { intoGame } from "./intoGame";
import { redcode } from "./redcode";
import type { VoiceRequest, VoiceTools } from "./voiceTools";

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
  | { type: "intoGame" }
  | { type: "renderedFor"; id: number; wav?: Uint8Array; error?: string }
  | { type: "edit"; doc: SoundDoc }
  | { type: "render"; wav: Uint8Array }
  | { type: "stub"; tool: "translate" }
  | { type: "voiceTool"; id: number; req: VoiceRequest }
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
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: vscode.OutputChannel,
    private readonly voices: VoiceTools,
    /** Called with each document opened: the Sounds view's Recent. */
    private readonly opened: (uri: vscode.Uri) => void,
  ) {}

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    this.opened(document.uri);
    const webview = panel.webview;
    const dist = vscode.Uri.joinPath(this.context.extensionUri, "dist");
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media");
    webview.options = { enableScripts: true, localResourceRoots: [dist, media] };
    webview.html = this.html(webview, dist, media);

    const post = (m: unknown) => void webview.postMessage(m);

    // Renders the page makes for Into the Game, at the format a route needs.
    let nextRender = 1;
    const renders = new Map<number, { resolve: (wav: Uint8Array) => void; reject: (e: Error) => void }>();
    const renderFor = (rate: number, channels: "source" | 1 | 2) =>
      new Promise<Uint8Array>((resolve, reject) => {
        const id = nextRender++;
        renders.set(id, { resolve, reject });
        post({ type: "renderFor", id, rate, channels });
      });

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
        case "intoGame":
          try {
            await intoGame(document, renderFor, this.log);
          } catch (e) {
            void vscode.window.showErrorMessage(`EDGEwave, Into the Game: ${(e as Error).message}`);
          }
          return;
        case "renderedFor": {
          const r = renders.get(m.id);
          renders.delete(m.id);
          if (!r) return;
          if (m.error || !m.wav) r.reject(new Error(m.error ?? "The page rendered nothing"));
          else r.resolve(bytes(m.wav));
          return;
        }
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
        case "stub":
          void vscode.window.showInformationMessage("Translate is planned: it will speak this line in another language, through an AI service. It is not built yet.");
          return;
        case "voiceTool":
          // Generate Sound, Speak Line and Re-Voice: the answer goes back to the page's form.
          try {
            post({ type: "voiceToolResult", id: m.id, ok: true, result: await this.voices.handle(document, m.req) });
          } catch (e) {
            this.log.appendLine(`ElevenLabs ${m.req.op}: ${(e as Error).message}`);
            post({ type: "voiceToolResult", id: m.id, ok: false, error: (e as Error).message });
          }
          return;
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
  <span class="ai" title="Voice tools, through ElevenLabs (your API key; each use spends your credits)">
    <button id="generateSound" title="Generate Sound: a sound effect from a text prompt, through ElevenLabs, as a new track at the mix cursor">Generate Sound…</button>
    <button id="speakLine" title="Speak Line: text spoken in an ElevenLabs voice, or in the selected voice line's voice, as a new track">Speak Line…</button>
    <button id="revoice" hidden title="Re-Voice: this line's words, timing and delivery in another voice: describe the change (gender, age, emotion) or pick a voice">Re-Voice…</button>
    <button id="translate" hidden title="Speak this line in another language (planned)">Translate</button>
  </span>
  <label class="check" title="Mark this sound as a voice line, for the voice tools"><input type="checkbox" id="voice"> Voice line</label>
</header>
<div class="toolbar mixbar">
  <span class="label">Mix</span>
  <span class="transport">
    <button id="toPrev" class="icon" title="Mix cursor to the previous clip edge: a track's start or end, or the start" aria-label="Previous clip edge"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3v10" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M13 3 5 8l8 5z" fill="currentColor"/></svg></button>
    <button id="playMix" class="icon" title="Play the mix from the mix cursor, with the master (Shift+Space)" aria-label="Play mix"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5 13.5 8 4 13.5z" fill="currentColor"/></svg></button>
    <button id="stopMix" class="icon" title="Stop" aria-label="Stop"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" fill="currentColor"/></svg></button>
    <button id="toNext" class="icon" title="Mix cursor to the next clip edge: a track's start or end" aria-label="Next clip edge"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 3v10" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M3 3l8 5-8 5z" fill="currentColor"/></svg></button>
    <button id="loopPlay" class="icon" title="Loop: the clip's selection or the whole clip; the mix's loop points or the whole mix" aria-label="Loop"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 9V7a3 3 0 0 1 3-3h7" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M11 1.5 13.5 4 11 6.5" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M13.5 7v2a3 3 0 0 1-3 3h-7" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M5 9.5 2.5 12 5 14.5" stroke="currentColor" stroke-width="1.6" fill="none"/></svg></button>
  </span>
  <button id="addSound" class="icon" title="Add Sound: a game sound effect, a game file or a sound file, as a new track" aria-label="Add Sound"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v11M2.5 8h11" stroke="currentColor" stroke-width="1.8" fill="none"/></svg></button>
  <span class="spacer"></span>
  <span id="mixTime" class="mono"></span>
  <button id="render" class="primary" title="Write the mix as a 16-bit WAV, reverb tails included (settings in Master)">Render WAV</button>
  <button id="intoGame" class="primary" title="Put the mix into the REDcode project for the game: override this sound effect, or a REDmod custom sound for an event">Into the Game…</button>
</div>
<div class="lanes"><canvas id="mix"></canvas></div>
<div class="toolbar track">
  <span class="label">Track</span><span id="trackName" class="mono trackname"></span>
  <label class="param" title="The track's level in the mix, in dB. To change the clip itself, use Apply gain below the waveform">Level <input id="trackGain" type="number" step="0.5" min="-60" max="24"> dB</label>
  <label class="param" title="-1 left, 0 centre, 1 right">Pan <input id="trackPan" type="number" step="0.1" min="-1" max="1"></label>
  <label class="param" title="Playback rate: pitch and speed together (0.25 to 4)">Rate <input id="trackRate" type="number" step="0.05" min="0.25" max="4"></label>
  <label class="param" title="Where the clip starts on the mix; or drag it in the lanes">Start <input id="trackOffset" type="number" step="0.01" min="0"> s</label>
  <button id="mute" title="Mute this track">Mute</button>
  <button id="solo" title="Hear only the soloed tracks">Solo</button>
  <button id="removeTrack" title="Remove this track from the mix">Remove</button>
</div>
<div class="toolbar">
  <span class="label">Clip</span>
  <span class="transport">
    <button id="play" class="icon" title="Play the selected clip, with its track's effects, from the cursor or the selection (Space)" aria-label="Play clip"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5 13.5 8 4 13.5z" fill="currentColor"/></svg></button>
    <button id="stopClip" class="icon" title="Stop" aria-label="Stop"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" fill="currentColor"/></svg></button>
  </span>
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
  <button id="fadeIn" title="Fade in over the selection; with none, from the start to the cursor, or over the first half second">Fade in</button>
  <button id="fadeOut" title="Fade out over the selection; with none, from the cursor to the end, or over the last half second">Fade out</button>
  <select id="curve" title="The fades' curve"><option value="linear">Linear</option><option value="exponential">Exponential</option><option value="smooth">Smooth</option></select>
  <span class="sep"></span>
  <input id="gainDb" type="number" step="0.5" value="-6" title="dB to add (negative is quieter)"><button id="gain" title="Change the clip's volume by this many dB: the selection, or the whole clip. An edit, listed in Edits">Apply gain</button>
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
<div class="dialog" id="dialog" hidden><div class="box" role="dialog" aria-modal="true" id="dialogBox"></div></div>
<script nonce="${nonce}" src="${js}"></script>
</body></html>`;
  }
}
