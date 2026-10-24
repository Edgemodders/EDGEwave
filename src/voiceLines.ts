// Voice Lines (V2, EDGEwave #5): one panel per quest, for the lines another tool (EDGEquest) hands over,
// grouped by scene. The modder picks a voice per speaker (two for V), generates the takes through
// ElevenLabs, plays them, redoes one, swaps in a recording, goes back to the previous take, or opens a take in
// the studio. Everything is kept in voice.json (src/voice.ts, src/voiceBatch.ts), which the other tool reads.

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { Voice } from "./elevenlabs";
import { ElevenLabs } from "./elevenlabs";
import { ViewType } from "./openSound";
import { gendersOf, isV, lineStatus, needsBoth, type Gender, type VoiceLine, type VoiceRecord, type Voices } from "./voice";
import { DefaultModel, keepTake, loadRecord, restorePrevious, saveRecord, studioDoc, voiceBatch } from "./voiceBatch";
import type { VoiceTools } from "./voiceTools";

const NamesState = "edgewave.voiceLines.voiceNames";

interface Open {
  projectDir: string;
  quest: string;
  lines: VoiceLine[];
  voices?: Voices;
  archiveDir?: string;
  /** Lines to show first: the one the other tool's button was for. */
  focus?: string[];
}

interface Panel {
  panel: vscode.WebviewPanel;
  o: Open;
  model: string;
  waiting: ((r: VoiceRecord) => void)[];
  busy?: { cancelled: boolean };
  send(m: unknown): void;
}

type FromPage =
  | { type: "ready" }
  | { type: "voices"; search?: string }
  | { type: "models" }
  | { type: "preview"; url: string }
  | { type: "setVoice"; speaker: string; gender?: Gender; id: string; name?: string }
  | { type: "model"; id: string }
  | { type: "generate"; ids?: string[]; redo?: boolean }
  | { type: "cancel" }
  | { type: "record"; id: string; gender: Gender; wav: unknown }
  | { type: "previous"; id: string }
  | { type: "studio"; id: string; gender: Gender };

const bytes = (x: unknown): Uint8Array => (x instanceof Uint8Array ? x : Uint8Array.from(Object.values(x as Record<string, number>)));

export class VoiceLines {
  private readonly panels = new Map<string, Panel>();

  constructor(private readonly context: vscode.ExtensionContext, private readonly log: vscode.OutputChannel, private readonly tools: VoiceTools) {}

  /** The quest's voice.json, or undefined when nothing was voiced yet. */
  status(projectDir: string, quest: string): VoiceRecord | undefined {
    const r = loadRecord(projectDir, quest);
    return Object.keys(r.lines).length || Object.keys(r.voices).length ? r : undefined;
  }

  /** Opens the panel for these lines (adding them to an open one), resolving with voice.json when it closes. */
  open(o: Open): Promise<VoiceRecord> {
    if (o.archiveDir) {
      const r = loadRecord(o.projectDir, o.quest);
      if (r.archiveDir !== o.archiveDir) saveRecord(o.projectDir, { ...r, archiveDir: o.archiveDir });
    }
    const key = `${path.resolve(o.projectDir).toLowerCase()}|${o.quest}`;
    let p = this.panels.get(key);
    if (p) {
      const byId = new Map(p.o.lines.map((l) => [l.id, l]));
      for (const l of o.lines) byId.set(l.id, l);
      p.o = { ...p.o, ...o, lines: [...byId.values()], voices: { ...p.o.voices, ...o.voices } };
      p.panel.reveal();
      this.push(p);
    } else p = this.create(key, o);
    const panel = p;
    return new Promise((resolve) => panel.waiting.push(resolve));
  }

  private create(key: string, o: Open): Panel {
    const dist = vscode.Uri.joinPath(this.context.extensionUri, "dist");
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media");
    const panel = vscode.window.createWebviewPanel("edgewave.voiceLines", `Voice Lines: ${o.quest}`, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [dist, media, vscode.Uri.file(o.projectDir)],
    });
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, "docs", "assets", "brand", "icon.png");
    const p: Panel = {
      panel,
      o,
      model: vscode.workspace.getConfiguration("edgewave.voiceLines").get<string>("model") || DefaultModel,
      waiting: [],
      send: (m) => void panel.webview.postMessage(m),
    };
    this.panels.set(key, p);
    panel.webview.html = this.html(panel.webview, dist, media);
    panel.webview.onDidReceiveMessage((m: FromPage) => this.handle(p, m).catch((e) => p.send({ type: "error", message: (e as Error).message })));
    panel.onDidDispose(() => {
      this.panels.delete(key);
      if (p.busy) p.busy.cancelled = true;
      const r = loadRecord(p.o.projectDir, p.o.quest);
      for (const w of p.waiting) w(r);
    });
    return p;
  }

  private names(): Record<string, string> {
    return this.context.globalState.get<Record<string, string>>(NamesState) ?? {};
  }

  /** What the page shows: the lines with their status and takes, the speakers and their voices. */
  private push(p: Panel, busy?: { done: number; total: number }): void {
    const record = loadRecord(p.o.projectDir, p.o.quest);
    const voices = { ...record.voices, ...(p.o.voices ?? {}) };
    const uri = (rel?: string) => {
      if (!rel) return undefined;
      const abs = path.join(p.o.projectDir, rel);
      if (!fs.existsSync(abs)) return undefined;
      return `${p.panel.webview.asWebviewUri(vscode.Uri.file(abs))}?t=${Math.round(fs.statSync(abs).mtimeMs)}`;
    };
    const speakers = new Map<string, boolean>();
    for (const l of p.o.lines) speakers.set(l.speaker, (speakers.get(l.speaker) ?? false) || needsBoth(l));
    p.send({
      type: "state",
      quest: p.o.quest,
      model: p.model,
      focus: p.o.focus ?? [],
      busy,
      names: this.names(),
      voices,
      speakers: [...speakers].map(([speaker, both]) => ({ speaker, both, isV: isV(speaker) })),
      lines: p.o.lines.map((l) => {
        const r = record.lines[l.id];
        return {
          ...l,
          genders: gendersOf(l),
          status: lineStatus(l, record),
          takes: { female: uri(r?.female), male: uri(r?.male) },
          madeFrom: r ? { text: r.text, say: r.say, direction: r.direction, model: r.model } : undefined,
          previous: !!r?.previous,
        };
      }),
    });
  }

  private async handle(p: Panel, m: FromPage): Promise<void> {
    switch (m.type) {
      case "ready":
        return this.push(p);
      case "voices": {
        const list: Voice[] = await (await this.tools.client()).voices(m.search);
        await this.context.globalState.update(NamesState, { ...this.names(), ...Object.fromEntries(list.map((v) => [v.id, v.name])) });
        p.send({ type: "voiceList", voices: list });
        return;
      }
      case "models": {
        const models = (await (await this.tools.client()).models()).filter((x) => x.speech);
        p.send({ type: "models", models });
        return;
      }
      case "preview":
        p.send({ type: "preview", ...(await ElevenLabs.fetchPreview(m.url)) });
        return;
      case "setVoice": {
        const record = loadRecord(p.o.projectDir, p.o.quest);
        const was = record.voices[m.speaker];
        const v = m.gender ? { ...(typeof was === "object" ? was : {}), [m.gender]: m.id } : m.id;
        record.voices = { ...record.voices, [m.speaker]: v };
        if (p.o.voices) delete p.o.voices[m.speaker];
        saveRecord(p.o.projectDir, record);
        if (m.name) await this.context.globalState.update(NamesState, { ...this.names(), [m.id]: m.name });
        return this.push(p);
      }
      case "model":
        p.model = m.id;
        await vscode.workspace.getConfiguration("edgewave.voiceLines").update("model", m.id, vscode.ConfigurationTarget.Global);
        return this.push(p);
      case "cancel":
        if (p.busy) p.busy.cancelled = true;
        return;
      case "generate":
        return this.generate(p, m.ids, m.redo);
      case "record": {
        const line = this.line(p, m.id);
        const record = keepTake(p.o.projectDir, loadRecord(p.o.projectDir, p.o.quest), line, { [m.gender]: bytes(m.wav) }, { model: "recording" });
        saveRecord(p.o.projectDir, record);
        return this.push(p);
      }
      case "previous": {
        saveRecord(p.o.projectDir, restorePrevious(p.o.projectDir, loadRecord(p.o.projectDir, p.o.quest), this.line(p, m.id)));
        return this.push(p);
      }
      case "studio": {
        const file = studioDoc(p.o.projectDir, this.line(p, m.id), p.o.quest, m.gender);
        await vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(file), ViewType);
        return;
      }
    }
  }

  private line(p: Panel, id: string): VoiceLine {
    const l = p.o.lines.find((x) => x.id === id);
    if (!l) throw new Error(`No line ${id} in this panel`);
    return l;
  }

  private async generate(p: Panel, ids?: string[], redo?: boolean): Promise<void> {
    if (p.busy) return;
    const lines = ids?.length ? p.o.lines.filter((l) => ids.includes(l.id)) : p.o.lines;
    const busy = { cancelled: false };
    p.busy = busy;
    try {
      const api = await this.tools.client();
      const r = await voiceBatch({
        projectDir: p.o.projectDir,
        quest: p.o.quest,
        lines,
        voices: p.o.voices,
        redo,
        model: p.model,
        rate: vscode.workspace.getConfiguration("edgewave.elevenlabs").get<number>("sampleRate") ?? 48000,
        api,
        log: (s) => this.log.appendLine(`Voice Lines: ${s}`),
        progress: (done, total) => this.push(p, done < total ? { done, total } : undefined),
        cancelled: () => busy.cancelled,
      });
      this.log.appendLine(`Voice Lines: ${p.o.quest}: ${r.voiced.length} voiced, ${r.failed.length} failed, ${r.characters} characters, ${r.rate} Hz, ${r.model}`);
      if (r.failed.length) p.send({ type: "error", message: `${r.failed.length} line${r.failed.length === 1 ? "" : "s"} could not be voiced: ${r.failed[0].message}` });
    } finally {
      p.busy = undefined;
      this.push(p);
    }
  }

  private html(webview: vscode.Webview, dist: vscode.Uri, media: vscode.Uri): string {
    const nonce = Array.from({ length: 24 }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 62)]).join("");
    const css = webview.asWebviewUri(vscode.Uri.joinPath(media, "voiceLines.css"));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(dist, "voiceLines.js"));
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; media-src ${webview.cspSource} blob:; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${css}">
</head><body>
<header>
  <span class="name" id="title">Voice Lines</span><span class="meta" id="meta"></span><span class="spacer"></span>
  <label class="mono" title="The ElevenLabs model. eleven_v3 reads the [delivery] tags in a line's say; other models get them removed">Model <select id="model"></select></label>
  <button id="generate" class="primary" title="Voice every line that has no take, or whose text, say or direction changed since">Generate All</button>
  <button id="cancel" hidden>Stop</button>
</header>
<section id="voices" class="voices"></section>
<div id="error" class="error" hidden></div>
<main id="lines"></main>
<script nonce="${nonce}" src="${js}"></script>
</body></html>`;
  }
}
