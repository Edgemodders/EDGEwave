// The sound editor: a custom editor over the .edgewave document's JSON text, so VS Code gives it
// save, undo and redo as for any file. The page (webview/editor.ts) decodes the source, applies the
// edits, plays and renders; this side fetches the source's audio and writes the document and the render.

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { formatDoc, parseDoc, sourceLabel, type SoundDoc, type Source } from "./doc";
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
  | { type: "edit"; doc: SoundDoc }
  | { type: "render"; wav: Uint8Array }
  | { type: "stub"; tool: "translate" | "revoice" }
  | { type: "error"; text: string };

export class SoundEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext, private readonly log: vscode.OutputChannel) {}

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    const webview = panel.webview;
    const dist = vscode.Uri.joinPath(this.context.extensionUri, "dist");
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media");
    webview.options = { enableScripts: true, localResourceRoots: [dist, media] };
    webview.html = this.html(webview, dist, media);

    let loadedSource = "";
    const post = (m: unknown) => void webview.postMessage(m);

    /** Sends the document; fetches the source's audio again when the source changed. */
    const sendDoc = async () => {
      let doc: SoundDoc;
      try {
        doc = parseDoc(document.getText());
      } catch (e) {
        post({ type: "invalid", text: (e as Error).message });
        return;
      }
      post({ type: "doc", doc, label: sourceLabel(doc.source) });
      const key = JSON.stringify(doc.source);
      if (key === loadedSource) return;
      loadedSource = key;
      try {
        const audio = await loadSource(document.uri.fsPath, doc.source);
        // A plain Uint8Array with its own buffer: a Node Buffer does not reach the page as bytes.
        post({ type: "audio", data: new Uint8Array(audio.data), mime: audio.mime, codec: audio.codec, name: audio.name });
      } catch (e) {
        loadedSource = "";
        post({ type: "audioError", text: (e as Error).message });
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

  private async render(document: vscode.TextDocument, wav: Uint8Array): Promise<void> {
    try {
      // The saved document always matches the render it made.
      if (document.isDirty) await document.save();
      const doc = parseDoc(document.getText());
      const dir = path.dirname(document.uri.fsPath);
      const out = path.resolve(dir, doc.render.file);
      if (doc.source.kind === "file" && path.resolve(dir, doc.source.file).toLowerCase() === out.toLowerCase()) {
        throw new Error("The render file is the source file. Change render.file in the document so the source is kept.");
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
<div class="toolbar">
  <button id="play" title="Play from the cursor, or the selection (Space)">Play</button>
  <button id="loopPlay" title="Loop the selection, the loop points or the whole sound">Loop</button>
  <span class="sep"></span>
  <button id="zoomIn" title="Zoom in (Ctrl+wheel)">+</button><button id="zoomOut" title="Zoom out">−</button><button id="zoomFit" title="Show the whole sound">Fit</button><button id="zoomSel" title="Zoom to the selection">Sel</button>
  <span class="spacer"></span>
  <span id="time" class="mono"></span>
</div>
<div class="wave" id="wave"><canvas id="canvas"></canvas><div class="note" id="note">Loading the sound…</div></div>
<div class="toolbar">
  <button id="trim" title="Keep only the selection">Trim</button>
  <button id="cut" title="Remove the selection (Delete)">Cut</button>
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
  <button id="setLoop" title="Set the loop points to the selection">Set loop</button>
  <button id="clearLoop" title="Clear the loop points">Clear loop</button>
</div>
<div class="panes">
  <section>
    <h2>Edits</h2>
    <ol id="edits"></ol>
    <p class="dim" id="noEdits">No edits yet. Undo and redo work as in any file.</p>
  </section>
  <section>
    <h2>Render</h2>
    <div class="row"><span>File</span><span id="renderFile" class="mono"></span></div>
    <div class="row"><span>Sample rate</span><select id="rate"><option value="">As the source</option><option>48000</option><option>44100</option><option>32000</option><option>24000</option><option>22050</option><option>16000</option></select></div>
    <div class="row"><span>Result</span><span id="renderInfo" class="mono"></span></div>
    <button id="render" class="primary" title="Write the edited sound as a 16-bit WAV">Render WAV</button>
  </section>
</div>
<script nonce="${nonce}" src="${js}"></script>
</body></html>`;
  }
}
