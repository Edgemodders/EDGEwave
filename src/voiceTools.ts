// The voice tools: Generate Sound, Speak Line and Re-Voice, through ElevenLabs (src/elevenlabs.ts).
// The page holds the forms and sends requests here; the API key stays on this side: in REDcode's shared key
// store (REDcode's Keys, EDGEwave #12), or with an older REDcode in VS Code's secret storage. Each result is
// a WAV in the document's `<name>.gen` folder and a new track that says how it was made (`made`); Generate Sound's results are takes first, played in the dialog, and become a
// track when the modder adds one. Voices EDGEwave creates (clones of a line, saved remixes) are remembered,
// reused and can be deleted (EDGEwave: ElevenLabs Voices Made by EDGEwave).

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { formatDoc, newTrack, nextTrackId, parseDoc, type Made } from "./doc";
import { DefaultBaseUrl, ElevenLabs, ElevenLabsError, formatRefused, keyRefused, pcmToWav, slug, type Voice } from "./elevenlabs";
import { bridgeExe, keyStore } from "./keysHost";
import { Caller, claudeHoldsKey, KeysBridge, Service } from "./keyStore";

const KeySecret = "edgewave.elevenlabs.apiKey";
const ConsentState = "edgewave.elevenlabs.cloneConsent";
const VoicesState = "edgewave.elevenlabs.voices";
const RateState = "edgewave.elevenlabs.rate";
const PolicyUrl = "https://elevenlabs.io/use-policy";
/** ElevenLabs' help on API keys: where to make one (Developers > API Keys). */
const KeyHelpUrl = "https://help.elevenlabs.io/hc/en-us/articles/14599447207697-How-do-I-authorize-myself-using-an-API-key";
/** The rate tried when the plan refuses the one asked for (only 44.1 kHz needs Pro, per the docs). */
const FallbackRate = 24000;

/** A voice EDGEwave made in the modder's ElevenLabs account. */
interface MadeVoice {
  id: string;
  name: string;
  kind: "clone" | "remix";
  /** For a clone: the line it was made from (its source and edits), so the clone is reused. */
  from?: string;
  made: string;
}

/** The selected track's line, as the page sends it: its clip after its edits, as a WAV. */
interface Line {
  track: string;
  /** sourceKey and edits: the same line gives the same clone. */
  key: string;
  name: string;
  wav: Uint8Array;
  offset: number;
}

export type VoiceRequest =
  | { op: "voices"; search?: string }
  | { op: "models" }
  | { op: "preview"; url: string }
  | { op: "sound"; prompt: string; seconds?: number; loop?: boolean; influence?: number }
  | { op: "addSound"; take: string; at: number }
  | { op: "speak"; text: string; voice?: { id: string; name: string }; line?: Line; model?: string; at: number }
  | { op: "remix"; line: Line; description: string }
  | { op: "revoice"; line: Line; voice?: { id: string; name: string }; generated?: { id: string; description: string }; model?: string; mute: boolean };

/** Bytes from the page: a Uint8Array, or the plain object some VS Code versions turn one into. */
function bytes(x: unknown): Uint8Array {
  if (x instanceof Uint8Array) return x;
  if (x && typeof x === "object") return Uint8Array.from(Object.values(x as Record<string, number>));
  throw new Error("The page sent no audio");
}

/**
 * The game's audio never goes to ElevenLabs (the owner, 2026-11-21): a line whose track plays a game file or a
 * sound effect cannot be cloned, remixed or re-voiced. A sound file of the modder's own (a recording, a take
 * ElevenLabs made) can. A file exported from the game is not told apart: its name is the only sign.
 */
function noGameAudio(line: Line): void {
  if (/^(game|sfx):/.test(line.key)) {
    throw new Error(`${line.name} is the game's own audio, and EDGEwave does not send the game's audio to ElevenLabs. Use your own recording or a sound file, or speak the words in one of your voices (Speak Line with a voice from the list).`);
  }
}

/** How many of Generate Sound's takes are kept for Add; older ones are dropped. */
const MaxTakes = 20;

export class VoiceTools {
  /** Generate Sound's takes, played in the dialog until one is added as a track. */
  private readonly takes = new Map<string, { wav: Uint8Array; made: Made }>();
  private nextTake = 1;
  /** The key's input box while it is open: requests that come meanwhile wait for the same answer. */
  private asking?: Promise<string | undefined>;

  constructor(private readonly context: vscode.ExtensionContext, private readonly log: vscode.OutputChannel) {}

  private config() {
    const c = vscode.workspace.getConfiguration("edgewave.elevenlabs");
    return {
      base: c.get<string>("baseUrl") || DefaultBaseUrl,
      rate: c.get<number>("sampleRate") ?? 48000,
      speechModel: c.get<string>("speechModel") || undefined,
      voiceChangerModel: c.get<string>("voiceChangerModel") || "eleven_multilingual_sts_v2",
    };
  }

  /**
   * Fires when the ElevenLabs key may have changed: set, replaced or removed in REDcode's Keys (by any tool, or
   * the game), or in EDGEwave's own secret storage with an older REDcode. Pages that showed a key error try again.
   */
  private readonly keyChanged = new vscode.EventEmitter<void>();
  readonly onDidChangeKey = this.keyChanged.event;

  /** Listens for key changes, and moves a key EDGEwave kept itself into REDcode's store. Called once at activation. */
  async watch(): Promise<vscode.Disposable[]> {
    const out: vscode.Disposable[] = [
      this.keyChanged,
      this.context.secrets.onDidChange((e) => {
        if (e.key === KeySecret) this.keyChanged.fire();
      }),
    ];
    const keys = await keyStore();
    if (keys) {
      out.push(
        keys.onDidChange((service) => {
          if (service !== Service) return;
          this.log.appendLine("ElevenLabs: the key changed in REDcode's Keys");
          this.keyChanged.fire();
        }),
      );
      void this.moveToStore();
    }
    return out;
  }

  /**
   * The API key. With REDcode's key store (EDGEwave #12): from the store, which asks the modder once whether
   * EDGEwave may read it, after moving a key EDGEwave kept itself into the store; with none set, REDcode's
   * password box, which saves it for every tool. With an older REDcode: from VS Code's secret storage, as before.
   */
  async key(ask = true): Promise<string | undefined> {
    const keys = await keyStore();
    if (!keys) {
      const k = await this.context.secrets.get(KeySecret);
      if (k || !ask) return k;
      this.asking ??= this.setKey().finally(() => (this.asking = undefined));
      return this.asking;
    }
    await this.moveToStore();
    try {
      const k = await keys.get(Service, Caller);
      if (k || !ask) return k;
    } catch (e) {
      // REDbridge not running (yet) or too old: a key EDGEwave still keeps itself, else the reason.
      const own = await this.context.secrets.get(KeySecret);
      if (own) return own;
      throw new Error(`EDGEwave reads the ElevenLabs key from REDcode's Keys, which cannot be reached: ${(e as Error).message}`);
    }
    this.asking ??= keys.ask(Service, Caller).finally(() => (this.asking = undefined));
    return this.asking;
  }

  /** The move, tried once a session; a key read waits for it, so it never finds the store empty mid-move. */
  private moving?: Promise<void>;

  private moveToStore(): Promise<void> {
    this.moving ??= this.move();
    return this.moving;
  }

  /**
   * Moves a key EDGEwave kept in VS Code's secret storage (EDGEwave 0.2.0 and before) into REDcode's shared
   * store, through REDbridge (REDcode's API saves only a key typed in its box), then removes EDGEwave's copy.
   * When the store already has a key, that one is kept and EDGEwave's copy removed. Says so once. On a failure
   * EDGEwave's copy stays, is used while the store cannot be reached, and the move is tried again next session.
   */
  private async move(): Promise<void> {
    const own = await this.context.secrets.get(KeySecret);
    if (!own) return;
    const exe = bridgeExe();
    if (!exe) return this.log.appendLine("ElevenLabs: the key in EDGEwave's secret storage stays there: REDbridge.exe was not found");
    const bridge = new KeysBridge({ exe, dotnetRoot: vscode.workspace.getConfiguration("redcode").get<string>("dotnetRoot") || undefined });
    try {
      const info = await bridge.info(Service);
      const had = info.source === "file" && !info.unreadable;
      if (!had) await bridge.set(Service, own);
      await this.context.secrets.delete(KeySecret);
      this.log.appendLine(had ? "ElevenLabs: REDcode's Keys had a key already; EDGEwave's own copy removed" : "ElevenLabs: the key moved from EDGEwave's secret storage to REDcode's Keys");
      const claude = claudeHoldsKey();
      const text = had
        ? `EDGEwave: REDcode's Keys already has an ElevenLabs key${info.last4 ? ` (ending ${info.last4})` : ""}, shared by every EDGE tool, so EDGEwave uses it and has removed the copy it kept itself.`
        : "EDGEwave: your ElevenLabs key is now in REDcode's Keys, shared by every EDGE tool, and EDGEwave no longer keeps a copy of its own.";
      // Not awaited: a key read waiting for the move must not wait for the modder to close this.
      void vscode.window
        .showInformationMessage(claude ? `${text} Claude Code's entry for EDGEwave still holds the key; connect again to take it out.` : text, ...(claude ? ["Connect an Assistant…"] : []), "Open REDcode's Keys")
        .then((pick) => {
          if (pick === "Connect an Assistant…") void vscode.commands.executeCommand("edgewave.connectAssistant");
          else if (pick === "Open REDcode's Keys") void vscode.commands.executeCommand("redcode.keys.focus");
        });
    } catch (e) {
      this.log.appendLine(`ElevenLabs: could not move the key to REDcode's Keys, so EDGEwave keeps its own copy for now: ${(e as Error).message}`);
    } finally {
      bridge.close();
    }
  }

  async setKey(): Promise<string | undefined> {
    const keys = await keyStore();
    if (keys) {
      try {
        return await keys.ask(Service, Caller);
      } catch (e) {
        void vscode.window.showErrorMessage(`EDGEwave: REDcode's Keys cannot be reached, so the key cannot be saved: ${(e as Error).message}`);
        return undefined;
      }
    }
    const k = await vscode.window.showInputBox({
      title: "EDGEwave: ElevenLabs API key",
      prompt: "For Generate Sound, Speak Line, Re-Voice and Voice Lines. Kept in VS Code's secret storage, never in settings. Make one at elevenlabs.io > Developers > API Keys, with text to speech, voices, sound effects and voice changer turned on.",
      password: true,
      ignoreFocusOut: true,
      placeHolder: "sk_…",
    });
    if (!k?.trim()) return undefined;
    await this.context.secrets.store(KeySecret, k.trim());
    return k.trim();
  }

  /** Opens ElevenLabs' help on where to make a key. */
  keyHelp(): void {
    void vscode.env.openExternal(vscode.Uri.parse(KeyHelpUrl));
  }

  /** What a page shows for an error: its message, and key when a new API key may fix it. */
  static failure(e: unknown): { error: string; key?: true } {
    const message = (e as Error).message;
    if (!keyRefused(e)) return { error: message };
    const missing = e instanceof ElevenLabsError && e.code === "missing_api_key";
    return { error: missing ? message : `ElevenLabs refused the API key: ${message}. Set a new one; a key made with restricted features needs text to speech, voices, sound effects and voice changer turned on.`, key: true };
  }

  async clearKey(): Promise<void> {
    await this.context.secrets.delete(KeySecret);
    if (!(await keyStore())) {
      void vscode.window.showInformationMessage("EDGEwave: the ElevenLabs API key is cleared.");
      return;
    }
    // The key is every EDGE tool's now: REDcode, its keeper, removes it (Remove Key in its Keys view).
    const pick = await vscode.window.showInformationMessage(
      "EDGEwave: your ElevenLabs key is shared by every EDGE tool, in REDcode's Keys. Remove it there: Remove Key on ElevenLabs.",
      "Open REDcode's Keys",
    );
    if (pick) void vscode.commands.executeCommand("redcode.keys.focus");
  }

  /** The ElevenLabs client with the modder's key; asks for the key when there is none. */
  async client(): Promise<ElevenLabs> {
    const k = await this.key();
    if (!k) throw new ElevenLabsError(401, "No ElevenLabs API key is set yet.", "missing_api_key");
    return new ElevenLabs(k, this.config().base);
  }

  /** Runs a request at the configured rate; if the plan refuses that output format, once more at 24 kHz. */
  private async atRate<T>(f: (rate: number) => Promise<T>): Promise<{ result: T; rate: number }> {
    const rate = this.context.globalState.get<number>(RateState) ?? this.config().rate;
    try {
      return { result: await f(rate), rate };
    } catch (e) {
      if (rate <= FallbackRate || !formatRefused(e)) throw e;
      this.log.appendLine(`ElevenLabs refused ${rate} Hz (${(e as Error).message}); using ${FallbackRate} Hz`);
      await this.context.globalState.update(RateState, FallbackRate);
      return { result: await f(FallbackRate), rate: FallbackRate };
    }
  }

  /** Asked once: cloning a voice needs the right to it (ElevenLabs' usage policy). */
  private async consent(): Promise<void> {
    if (this.context.globalState.get<boolean>(ConsentState)) return;
    const yes = "I have the right to clone this voice";
    const policy = "Read ElevenLabs' policy";
    for (;;) {
      const a = await vscode.window.showWarningMessage(
        "This clones the voice in the selected line, in your ElevenLabs account. A game line's voice is a real voice actor's. ElevenLabs' usage policy forbids cloning a real person's voice without their consent, and may block some voices.",
        { modal: true, detail: "Only go on with a voice you have the right to clone, such as your own or one whose owner agreed. EDGEwave asks this once." },
        yes,
        policy,
      );
      if (a === policy) {
        await vscode.env.openExternal(vscode.Uri.parse(PolicyUrl));
        continue;
      }
      if (a !== yes) throw new Error("Cancelled: no clone was made.");
      await this.context.globalState.update(ConsentState, true);
      return;
    }
  }

  /** The voices EDGEwave made in the modder's account (clones of lines, saved remixes), for Voices for REDnode. */
  made(): { id: string; name: string; kind: "clone" | "remix" }[] {
    return this.madeVoices().map(({ id, name, kind }) => ({ id, name, kind }));
  }

  private madeVoices(): MadeVoice[] {
    return this.context.globalState.get<MadeVoice[]>(VoicesState) ?? [];
  }

  private async remember(v: MadeVoice): Promise<void> {
    await this.context.globalState.update(VoicesState, [...this.madeVoices().filter((x) => x.id !== v.id), v]);
  }

  /** The line's voice as a clone: the one made before from the same line, or a new one. */
  private async cloneOf(api: ElevenLabs, line: Line): Promise<string> {
    const from = createHash("sha1").update(line.key).digest("hex");
    const known = this.madeVoices().find((v) => v.kind === "clone" && v.from === from);
    if (known) return known.id;
    await this.consent();
    const name = `EDGEwave ${line.name}`.slice(0, 100);
    const id = await api.cloneVoice(name, bytes(line.wav), "Made by EDGEwave from one line, for Speak Line or Re-Voice.");
    await this.remember({ id, name, kind: "clone", from, made: new Date().toISOString() });
    this.log.appendLine(`Cloned the voice of ${line.name}: ${id}`);
    return id;
  }

  /** A voice designed from a description (speakLine's picker), remembered with the voices EDGEwave made. */
  async rememberDesigned(id: string, name: string): Promise<void> {
    await this.remember({ id, name, kind: "remix", made: new Date().toISOString() });
  }

  /** The sample rate asked of ElevenLabs: 24 kHz once the plan refused the one set. */
  rate(): number {
    return this.context.globalState.get<number>(RateState) ?? this.config().rate;
  }

  /** The base URL, for clients made elsewhere. */
  baseUrl(): string {
    return this.config().base;
  }

  /** Runs f with the line's clone; a clone deleted on the website since is made again, once. */
  private async withClone<T>(api: ElevenLabs, line: Line, f: (voiceId: string) => Promise<T>): Promise<T> {
    const id = await this.cloneOf(api, line);
    try {
      return await f(id);
    } catch (e) {
      if (!/voice_not_found|voice[^.]{0,40}(not.?found|does not exist)/i.test(`${(e as ElevenLabsError).code ?? ""} ${(e as Error).message}`)) throw e;
      this.log.appendLine(`The clone ${id} is gone from the account; making it again`);
      await this.context.globalState.update(VoicesState, this.madeVoices().filter((v) => v.id !== id));
      return f(await this.cloneOf(api, line));
    }
  }

  /** Answers one request from the page. */
  async handle(document: vscode.TextDocument, r: VoiceRequest): Promise<unknown> {
    switch (r.op) {
      case "voices":
        return (await this.client()).voices(r.search);
      case "models": {
        const c = this.config();
        return { models: await (await this.client()).models(), speechModel: c.speechModel ?? "eleven_multilingual_v2", voiceChangerModel: c.voiceChangerModel };
      }
      case "preview":
        return ElevenLabs.fetchPreview(r.url);
      case "sound":
        return this.progress("Generating the sound", async () => {
          const api = await this.client();
          const { result, rate } = await this.atRate((rate) => api.soundEffect({ text: r.prompt, seconds: r.seconds, loop: r.loop, influence: r.influence }, rate));
          const made: Made = { by: "elevenlabs", tool: "sound", prompt: r.prompt };
          if (r.seconds !== undefined) made.seconds = r.seconds;
          if (r.loop) made.loop = true;
          if (r.influence !== undefined) made.influence = r.influence;
          const take = `take${this.nextTake++}`;
          this.takes.set(take, { wav: pcmToWav(result, rate), made });
          for (const k of [...this.takes.keys()].slice(0, -MaxTakes)) this.takes.delete(k);
          return { take, wav: this.takes.get(take)!.wav, seconds: result.length / 2 / rate };
        });
      case "addSound": {
        const t = this.takes.get(r.take);
        if (!t) throw new Error("That take is gone: generate it again.");
        const made = t.made as Extract<Made, { tool: "sound" }>;
        const added = await this.addTrack(document, "sound", made.prompt, t.wav, made, r.at, false);
        this.takes.delete(r.take);
        return added;
      }
      case "speak":
        return this.progress("Speaking the line", async () => {
          const api = await this.client();
          const model = r.model ?? this.config().speechModel;
          let voice: { id: string; name?: string } = { id: "" };
          const say = (id: string) => this.atRate((rate) => api.speak(id, { text: r.text, model }, rate));
          let spoken: { result: Uint8Array; rate: number };
          if (r.line) {
            const line = r.line;
            noGameAudio(line);
            spoken = await this.withClone(api, line, (id) => {
              voice = { id, name: `the voice of ${line.name}` };
              return say(id);
            });
          } else if (r.voice) {
            voice = r.voice;
            spoken = await say(voice.id);
          } else throw new Error("Pick a voice, or select a voice line to speak in its voice.");
          const { result, rate } = spoken;
          const made: Made = { by: "elevenlabs", tool: "speak", text: r.text, voiceId: voice.id };
          if (voice.name) made.voiceName = voice.name;
          if (model) made.model = model;
          if (r.line) made.from = r.line.track;
          return this.addTrack(document, "speak", r.text, pcmToWav(result, rate), made, r.at, true);
        });
      case "remix":
        return this.progress("Remixing the voice", async () => {
          noGameAudio(r.line);
          const api = await this.client();
          const { result } = await this.withClone(api, r.line, (id) => this.atRate((rate) => api.remix(id, r.description, rate)));
          return result.map((p) => ({ id: p.generatedVoiceId, wav: p.wav, seconds: p.seconds }));
        });
      case "revoice":
        return this.progress("Re-voicing the line", async () => {
          noGameAudio(r.line);
          const api = await this.client();
          let voice: { id: string; name?: string };
          if (r.generated) {
            const name = `EDGEwave ${r.line.name}: ${r.generated.description}`.slice(0, 100);
            voice = { id: await api.saveRemix(r.generated.id, name, r.generated.description), name: r.generated.description };
            await this.remember({ id: voice.id, name, kind: "remix", made: new Date().toISOString() });
          } else if (r.voice) voice = r.voice;
          else throw new Error("Describe the change, or pick a voice.");
          const model = r.model ?? this.config().voiceChangerModel;
          const { result, rate } = await this.atRate((rate) => api.speechToSpeech(voice.id, bytes(r.line.wav), { model }, rate));
          const made: Made = { by: "elevenlabs", tool: "revoice", from: r.line.track, voiceId: voice.id, model };
          if (voice.name) made.voiceName = voice.name;
          if (r.generated) made.description = r.generated.description;
          return this.addTrack(document, "revoice", `${r.line.name} ${voice.name ?? ""}`, pcmToWav(result, rate), made, r.line.offset, true, r.mute ? r.line.track : undefined);
        });
    }
  }

  private progress<T>(title: string, f: () => Promise<T>): Thenable<T> {
    return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `EDGEwave: ${title} with ElevenLabs…` }, f);
  }

  /** Writes the WAV to the document's .gen folder and adds it as a new track; mutes `mute` (the line it replaces). */
  private async addTrack(document: vscode.TextDocument, tool: string, text: string, wav: Uint8Array, made: Made, at: number, voice: boolean, mute?: string): Promise<{ track: string; file: string }> {
    const docFile = document.uri.fsPath;
    const genDir = `${path.basename(docFile, path.extname(docFile))}.gen`;
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
    const file = path.join(genDir, `${tool}-${slug(text)}-${stamp}.wav`);
    const abs = path.resolve(path.dirname(docFile), file);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, wav);
    this.log.appendLine(`ElevenLabs ${tool}: wrote ${abs} (${wav.length} bytes)`);
    const doc = parseDoc(document.getText());
    const t = newTrack(nextTrackId(doc), { kind: "file", file: file.replace(/\\/g, "/") }, voice);
    t.offset = Math.max(0, Math.round(at * 1e6) / 1e6);
    t.made = made;
    doc.tracks = doc.tracks.map((x) => (x.id === mute ? { ...x, mute: true } : x));
    doc.tracks.push(t);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), formatDoc(doc));
    await vscode.workspace.applyEdit(edit);
    return { track: t.id, file };
  }

  /** The voices EDGEwave made in the modder's account, to delete the ones no longer needed. */
  async manageVoices(): Promise<void> {
    const list = this.madeVoices();
    if (!list.length) {
      void vscode.window.showInformationMessage("EDGEwave has made no ElevenLabs voices yet.");
      return;
    }
    const picks = await vscode.window.showQuickPick(
      list.map((v) => ({ label: v.name, description: v.kind === "clone" ? "clone of a line" : "remix", detail: `${v.id} · made ${v.made.slice(0, 10)}`, v })),
      { title: "ElevenLabs voices made by EDGEwave: pick the ones to delete", canPickMany: true },
    );
    if (!picks?.length) return;
    const api = await this.client();
    for (const p of picks) {
      try {
        await api.deleteVoice(p.v.id);
      } catch (e) {
        // A voice deleted on the website is already gone.
        if (!/not.?found|404/i.test((e as Error).message)) throw e;
      }
      await this.context.globalState.update(VoicesState, this.madeVoices().filter((x) => x.id !== p.v.id));
    }
    void vscode.window.showInformationMessage(`EDGEwave: deleted ${picks.length} ElevenLabs voice${picks.length === 1 ? "" : "s"}.`);
  }
}

export type { Voice };
