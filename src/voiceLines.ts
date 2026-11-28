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
import { DefaultModel, keepTake, loadRecord, recordPath, restorePrevious, saveRecord, studioDoc, voiceBatch } from "./voiceBatch";
import { VoiceTools } from "./voiceTools";
import { makeWems, staleWems, wemState, type WemResult } from "./voiceWem";
import { findWwise, WwiseDownload, type Wwise } from "./wwise";

/** The edgewave.wwise.path setting: WwiseConsole.exe or a Wwise folder, "off" for none. */
export const wwiseSetting = () => vscode.workspace.getConfiguration("edgewave.wwise").get<string>("path") ?? "";

/** The modder's Wwise, as the setting or the Launcher's folders give it. */
export const theWwise = (): Wwise | undefined => findWwise({ configured: wwiseSetting() });

/** An error for the page: its message, and key when a new ElevenLabs key may fix it. */
const failure = (e: unknown): { message: string; key?: true } => {
  const f = VoiceTools.failure(e);
  return { message: f.error, key: f.key };
};

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
  /** voice.json's time when the page last heard of it. */
  seen?: number;
  /** The .wem step: running, and what the last run could not make. */
  wem: { busy?: boolean; failed?: string };
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
  | { type: "studio"; id: string; gender: Gender }
  | { type: "setKey" }
  | { type: "keyHelp" }
  | { type: "wem" }
  | { type: "wemHelp" };

const bytes = (x: unknown): Uint8Array => (x instanceof Uint8Array ? x : Uint8Array.from(Object.values(x as Record<string, number>)));

const recordTime = (p: Panel): number | undefined => {
  try {
    return fs.statSync(recordPath(p.o.projectDir, p.o.quest)).mtimeMs;
  } catch {
    return undefined;
  }
};

export class VoiceLines {
  private readonly panels = new Map<string, Panel>();
  /** A speaker's voice was picked: offered to the other tools' character voices (src/speakLineHost.ts). */
  offer?: (speaker: string, gender: Gender | undefined, id: string, name: string | undefined) => Promise<void>;

  constructor(private readonly context: vscode.ExtensionContext, private readonly log: vscode.OutputChannel, private readonly tools: VoiceTools) {
    // Wwise set, cleared or turned off: every open panel looks again.
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("edgewave.wwise.path")) for (const p of this.panels.values()) void this.wems(p);
      }),
    );
  }

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
      wem: {},
      send: (m) => void panel.webview.postMessage(m),
    };
    this.panels.set(key, p);
    panel.webview.html = this.html(panel.webview, dist, media);
    panel.webview.onDidReceiveMessage((m: FromPage) => this.handle(p, m).catch((e) => p.send({ type: "error", ...failure(e) })));
    // voice.json also changes from outside the panel: an assistant's voice_lines runs in the MCP server's process.
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(o.projectDir), path.relative(o.projectDir, recordPath(o.projectDir, o.quest)).split(path.sep).join("/")));
    let timer: NodeJS.Timeout | undefined;
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!p.busy && recordTime(p) !== p.seen) this.push(p);
      }, 200);
    };
    watcher.onDidChange(changed);
    watcher.onDidCreate(changed);
    // The ElevenLabs key changed (in REDcode's Keys, by any tool): the page loads the voices again.
    const keyChanged = this.tools.onDidChangeKey(() => p.send({ type: "keyChanged" }));
    panel.onDidDispose(() => {
      clearTimeout(timer);
      watcher.dispose();
      keyChanged.dispose();
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
  private push(p: Panel, busy?: { done: number; total: number; id: string }): void {
    p.seen = recordTime(p);
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
    const wwise = theWwise();
    const stale = new Set(staleWems(p.o.projectDir, record).map((t) => `${t.id}:${t.gender}`));
    const hasWem = (id: string, g: Gender) => !!record.archiveDir && !!record.lines[id]?.[g] && !stale.has(`${id}:${g}`);
    p.send({
      type: "state",
      quest: p.o.quest,
      model: p.model,
      focus: p.o.focus ?? [],
      busy,
      wem: { ...wemState(p.o.projectDir, record, wwise), ...p.wem, noWwise: !!record.archiveDir && !wwise },
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
          wem: { female: hasWem(l.id, "female") ? r?.wem?.female : undefined, male: hasWem(l.id, "male") ? r?.wem?.male : undefined },
          madeFrom: r ? { text: r.text, say: r.say, direction: r.direction, model: r.model, made: r.made } : undefined,
          previous: !!r?.previous,
        };
      }),
    });
  }

  private async handle(p: Panel, m: FromPage): Promise<void> {
    switch (m.type) {
      case "ready":
        this.push(p);
        return void this.wems(p);
      case "wem":
        return void this.wems(p);
      case "wemHelp":
        return void vscode.env.openExternal(vscode.Uri.parse(WwiseDownload));
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
      // A missing or refused ElevenLabs key: the page's buttons (webview/keyFix.ts).
      case "setKey":
        p.send({ type: "keySet", ok: !!(await this.tools.setKey()) });
        return;
      case "keyHelp":
        this.tools.keyHelp();
        return;
      case "setVoice": {
        const record = loadRecord(p.o.projectDir, p.o.quest);
        const was = record.voices[m.speaker];
        const v = m.gender ? { ...(typeof was === "object" ? was : {}), [m.gender]: m.id } : m.id;
        record.voices = { ...record.voices, [m.speaker]: v };
        if (p.o.voices) delete p.o.voices[m.speaker];
        saveRecord(p.o.projectDir, record);
        if (m.name) await this.context.globalState.update(NamesState, { ...this.names(), [m.id]: m.name });
        void this.offer?.(m.speaker, m.gender, m.id, m.name);
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
        this.push(p);
        return void this.wems(p);
      }
      case "previous": {
        saveRecord(p.o.projectDir, restorePrevious(p.o.projectDir, loadRecord(p.o.projectDir, p.o.quest), this.line(p, m.id)));
        this.push(p);
        return void this.wems(p);
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
        progress: (done, total, line) => this.push(p, { done, total, id: line.id }),
        cancelled: () => busy.cancelled,
      });
      this.log.appendLine(`Voice Lines: ${p.o.quest}: ${r.voiced.length} voiced, ${r.failed.length} failed, ${r.characters} characters, ${r.rate} Hz, ${r.model}`);
      if (r.failed.length) {
        const f = failure(r.failed[0].error ?? new Error(r.failed[0].message));
        p.send({ type: "error", ...f, message: `${r.failed.length} line${r.failed.length === 1 ? "" : "s"} could not be voiced: ${f.message}` });
      }
    } finally {
      p.busy = undefined;
      this.push(p);
      void this.wems(p);
    }
  }

  /** The .wem runs, one at a time per quest: a run asked for while one runs waits for it. */
  private readonly wemRuns = new Map<string, Promise<WemResult | undefined>>();

  /**
   * Makes the quest's missing and stale .wem files through the modder's Wwise (src/voiceWem.ts), with no
   * question: it is free and local. Nothing happens with no Wwise or no archive folder; the page says why.
   */
  makeWems(projectDir: string, quest: string): Promise<WemResult | undefined> {
    const key = `${path.resolve(projectDir).toLowerCase()}|${quest}`;
    const once = async (): Promise<WemResult | undefined> => {
      const wwise = theWwise();
      const record = loadRecord(projectDir, quest);
      const p = this.panels.get(key);
      if (!wwise || !staleWems(projectDir, record).length) {
        // Nothing to make, but the page may still show what was before (Look Again after the setting changed).
        if (p) {
          p.wem = {};
          if (!p.busy) this.push(p);
        }
        return undefined;
      }
      if (p) {
        p.wem = { busy: true };
        if (!p.busy) this.push(p);
      }
      let r: WemResult | undefined;
      try {
        r = await makeWems({ projectDir, quest, wwise, log: (s) => this.log.appendLine(`Voice Lines: ${s}`) });
        this.log.appendLine(`Voice Lines: ${quest}: ${r.converted} .wem made with Wwise ${wwise.version ?? ""}, ${r.failed.length} failed`);
        if (p) p.wem = r.failed.length ? { failed: `${r.failed.length} take${r.failed.length === 1 ? "" : "s"} could not be made a .wem: ${r.failed[0].message}` } : {};
      } catch (e) {
        this.log.appendLine(`Voice Lines: ${quest}: the .wem step failed: ${(e as Error).message}`);
        if (p) p.wem = { failed: `The .wem step failed: ${(e as Error).message}` };
      }
      const now = this.panels.get(key);
      if (now && !now.busy) this.push(now);
      return r;
    };
    // A queued run finds nothing stale when the one before it made everything, and returns at once.
    const next = (this.wemRuns.get(key) ?? Promise.resolve(undefined)).then(once, once);
    this.wemRuns.set(key, next);
    void next.finally(() => {
      if (this.wemRuns.get(key) === next) this.wemRuns.delete(key);
    });
    return next;
  }

  private wems(p: Panel): Promise<WemResult | undefined> {
    return this.makeWems(p.o.projectDir, p.o.quest);
  }

  /**
   * A studio render wrote a file: when it is a quest's take (source/raw/edgewave/voice/<quest>/<name>.wav
   * beside voice.json), that quest's .wem is made again.
   */
  rendered(file: string): void {
    const dir = path.dirname(file);
    const parts = path.resolve(dir).split(path.sep);
    const n = parts.length;
    if (n < 6 || parts.slice(n - 5, n - 1).map((x) => x.toLowerCase()).join("/") !== "source/raw/edgewave/voice") return;
    if (!/\.wav$/i.test(file) || !fs.existsSync(path.join(dir, "voice.json"))) return;
    void this.makeWems(parts.slice(0, n - 5).join(path.sep), parts[n - 1]);
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
<div id="wem" class="wem" hidden></div>
<section id="voices" class="voices"></section>
<div id="error" class="error" hidden></div>
<main id="lines"></main>
<script nonce="${nonce}" src="${js}"></script>
</body></html>`;
  }
}
