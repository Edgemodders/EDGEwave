// The voice tools: Generate Sound, Speak Line and Re-Voice, through ElevenLabs (src/elevenlabs.ts).
// The page holds the forms and sends requests here; the API key stays on this side, in VS Code's
// secret storage. Each result is a WAV in the document's `<name>.gen` folder and a new track that says
// how it was made (`made`); Generate Sound's results are takes first, played in the dialog, and become a
// track when the modder adds one. Voices EDGEwave creates (clones of a line, saved remixes) are remembered,
// reused and can be deleted (EDGEwave: ElevenLabs Voices Made by EDGEwave).

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { formatDoc, newTrack, nextTrackId, parseDoc, type Made } from "./doc";
import { DefaultBaseUrl, ElevenLabs, type ElevenLabsError, formatRefused, pcmToWav, slug, type Voice } from "./elevenlabs";

const KeySecret = "edgewave.elevenlabs.apiKey";
const ConsentState = "edgewave.elevenlabs.cloneConsent";
const VoicesState = "edgewave.elevenlabs.voices";
const RateState = "edgewave.elevenlabs.rate";
const PolicyUrl = "https://elevenlabs.io/use-policy";
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

/** How many of Generate Sound's takes are kept for Add; older ones are dropped. */
const MaxTakes = 20;

export class VoiceTools {
  /** Generate Sound's takes, played in the dialog until one is added as a track. */
  private readonly takes = new Map<string, { wav: Uint8Array; made: Made }>();
  private nextTake = 1;

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

  /** The API key: from secret storage, or asked for (and kept) when there is none. */
  async key(ask = true): Promise<string | undefined> {
    const k = await this.context.secrets.get(KeySecret);
    if (k || !ask) return k;
    return this.setKey();
  }

  async setKey(): Promise<string | undefined> {
    const k = await vscode.window.showInputBox({
      title: "EDGEwave: ElevenLabs API key",
      prompt: "For Generate Sound, Speak Line and Re-Voice. Kept in VS Code's secret storage, never in settings. Make one at elevenlabs.io > Developers > API Keys.",
      password: true,
      ignoreFocusOut: true,
      placeHolder: "sk_…",
    });
    if (!k?.trim()) return undefined;
    await this.context.secrets.store(KeySecret, k.trim());
    return k.trim();
  }

  async clearKey(): Promise<void> {
    await this.context.secrets.delete(KeySecret);
    void vscode.window.showInformationMessage("EDGEwave: the ElevenLabs API key is cleared.");
  }

  private async client(): Promise<ElevenLabs> {
    const k = await this.key();
    if (!k) throw new Error("No ElevenLabs API key. EDGEwave: Set ElevenLabs API Key adds one.");
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
          const api = await this.client();
          const { result } = await this.withClone(api, r.line, (id) => this.atRate((rate) => api.remix(id, r.description, rate)));
          return result.map((p) => ({ id: p.generatedVoiceId, wav: p.wav, seconds: p.seconds }));
        });
      case "revoice":
        return this.progress("Re-voicing the line", async () => {
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
