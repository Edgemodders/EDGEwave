// speakLine for other tools (EDGEwave #13, EDGEfab's Lip Sync tab), in VS Code: the core is src/speakLine.ts.
// EDGEwave's own rules hold when another tool calls (agreed with the owner, 2026-11-20):
//   - the key is the modder's, in REDcode's shared key store (or EDGEwave's secret storage), asked for when there is none;
//   - before a tool first spends credits, the modder is asked once whether it may (remembered per tool);
//   - a character with no voice yet gets EDGEwave's voice picker: one of the account's voices, or a voice designed
//     from a description of the character (no game audio goes to ElevenLabs: the owner, 2026-11-21). The choice goes in the one list
//     of character voices (characters.json), which Voice Lines offers to fill too.
// Every answer is a take or a reason in plain words, never an exception.

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { keyRefused, pcmToWav } from "./elevenlabs";
import { redcode } from "./redcode";
import { characterKey, characterVoice, linesDir, readCharacters, setCharacter, speakLine, tagOf, type CharacterVoice, type LineRequest, type SpokenLine } from "./speakLine";
import type { SoundEvents } from "./soundEvents";
import { loadRecord } from "./voiceBatch";
import { VoiceTools } from "./voiceTools";

const AllowedState = "edgewave.speakLine.allowed";
/** What a designed voice's previews say: ElevenLabs asks for 100 to 1,000 characters. */
const SampleText = "Listen, I don't have all night. You want my help, you tell me the truth, all of it. Then we'll see what we can do about it.";

export type SpeakLineRequest = LineRequest & { project?: string; by?: string };

export class LineSpeaker {
  constructor(private readonly context: vscode.ExtensionContext, private readonly log: vscode.OutputChannel, private readonly tools: VoiceTools, private readonly events: SoundEvents) {}

  async speak(o: SpeakLineRequest): Promise<SpokenLine | { reason: string }> {
    try {
      if (!o?.text?.trim()) return { reason: "There are no words to speak." };
      if (!o.character?.trim() && !o.voice?.trim()) return { reason: "Say who speaks: a character (the game's voice tag, such as judy) or a voice." };
      const by = o.by?.trim() || "Another tool";
      const voice = o.voice?.trim() ? { id: o.voice.trim(), name: undefined as string | undefined } : await this.voiceOf(o.character!, o.gender, o.project);
      if ("reason" in voice) return voice;
      if (!(await this.tools.key(true))) return { reason: "No ElevenLabs API key is set. EDGEwave: Set ElevenLabs API Key, then try again." };
      const api = await this.tools.client();
      return await speakLine({
        ...o,
        speaker: o.character ?? voice.name ?? "voice",
        voiceId: voice.id,
        voiceName: voice.name,
        api,
        rate: this.tools.rate(),
        log: (l) => this.log.appendLine(`speakLine (${by}): ${l}`),
        beforeSpend: (characters) => this.allow(by, characters),
      });
    } catch (e) {
      if (e instanceof Refused) return { reason: e.message };
      const f = VoiceTools.failure(e);
      this.log.appendLine(`speakLine: ${f.error}`);
      if (keyRefused(e)) {
        void vscode.window.showWarningMessage(`EDGEwave: ${f.error}`, "Set ElevenLabs API Key…").then((a) => a && this.tools.setKey());
      }
      return { reason: f.error };
    }
  }

  /** Asked once per tool, before its first line spends credits. */
  private async allow(by: string, characters: number): Promise<void> {
    const allowed = this.context.globalState.get<string[]>(AllowedState) ?? [];
    if (allowed.includes(by)) return;
    const yes = `Allow ${by}`;
    const a = await vscode.window.showInformationMessage(
      `${by} wants EDGEwave to speak lines with your ElevenLabs key.`,
      { modal: true, detail: `Each new line spends your ElevenLabs credits, about one per character: this one ${characters}. A line spoken before plays again for free. EDGEwave asks this once for ${by}; EDGEwave: Character Voices… shows the voices it uses.` },
      yes,
    );
    if (a !== yes) throw new Refused(`The modder did not allow ${by} to spend ElevenLabs credits.`);
    await this.context.globalState.update(AllowedState, [...allowed, by]);
  }

  /** A character's voice: the list, else a project's Voice Lines, else the modder picks one now. */
  private async voiceOf(character: string, gender: "female" | "male" | undefined, project: string | undefined): Promise<{ id: string; name?: string } | { reason: string }> {
    const known = characterVoice(character, gender);
    if (known) return known;
    const fromQuest = await this.fromVoiceLines(character, gender, project);
    if (fromQuest) {
      setCharacter(characterKey(character, gender), fromQuest);
      this.log.appendLine(`speakLine: ${character}'s voice from Voice Lines, kept in the character voices`);
      return fromQuest;
    }
    const picked = await this.pick(character, gender);
    return picked ?? { reason: `There is no voice for ${character} yet, and none was picked. EDGEwave: Character Voices… sets one.` };
  }

  /** The voice a project's Voice Lines chose for a speaker of this name, if any. */
  private async fromVoiceLines(character: string, gender: "female" | "male" | undefined, project: string | undefined): Promise<CharacterVoice | undefined> {
    const dir = project ?? (await redcode().catch(() => undefined))?.project()?.dir ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const quests = dir ? path.join(dir, "source", "raw", "edgewave", "voice") : undefined;
    if (!quests || !fs.existsSync(quests)) return undefined;
    for (const q of fs.readdirSync(quests)) {
      const voices = loadRecord(dir!, q).voices;
      const entry = Object.entries(voices).find(([speaker]) => tagOf(speaker) === tagOf(character))?.[1];
      const id = typeof entry === "string" ? entry : entry?.[gender ?? "female"] ?? entry?.male;
      if (id) return { id, how: "voiceLines" };
    }
    return undefined;
  }

  /**
   * EDGEwave's voice picker for a character: a voice designed from a description, or one of the account's voices.
   * No game audio is sent to ElevenLabs (the owner, 2026-11-21): there is no clone from game lines. Says which voice
   * the character speaks in. Picking the voice the character already has keeps its record (a design's description).
   */
  async pick(character: string, gender?: "female" | "male"): Promise<CharacterVoice | undefined> {
    type It = vscode.QuickPickItem & { design?: boolean; v?: { id: string; name: string } };
    const who = gender ? `${character} (${gender})` : character;
    const key = characterKey(character, gender);
    const current = readCharacters()[key];
    const items = (async (): Promise<It[]> => {
      const head: It[] = [
        { label: `$(sparkle) Design a voice for ${who} from a description…`, detail: "Describe them (age, accent, how they sound); ElevenLabs makes new voices to hear, and you keep one. Nothing of the game's is sent.", design: true, alwaysShow: true },
        { label: "Your ElevenLabs voices", kind: vscode.QuickPickItemKind.Separator },
      ];
      try {
        const voices = await (await this.tools.client()).voices();
        return [
          ...head,
          ...voices.map((v) => ({
            label: v.name,
            description: [v.id === current?.id ? `${who}'s voice now` : "", v.labels.gender, v.labels.accent, v.labels.age].filter(Boolean).join(", "),
            detail: v.category,
            v: { id: v.id, name: v.name },
          })),
        ];
      } catch (e) {
        return [...head, { label: `$(warning) ${VoiceTools.failure(e).error}` }];
      }
    })();
    const p = await vscode.window.showQuickPick(items, { title: `EDGEwave: a voice for ${who}, kept for every tool that speaks ${character}'s lines`, matchOnDescription: true, ignoreFocusOut: true });
    if (!p) return undefined;
    const v: CharacterVoice | undefined = p.v
      ? p.v.id === current?.id
        ? current
        : { id: p.v.id, name: p.v.name, how: "picked" }
      : p.design
        ? await this.design(character, gender)
        : undefined;
    if (!v) return undefined;
    if (v !== current) setCharacter(key, v);
    void vscode.window.showInformationMessage(v === current ? `EDGEwave: ${who} still speaks as ${v.name ?? v.id}.` : `EDGEwave: ${who} speaks as ${v.name ?? v.id} now, in every tool that speaks ${character}'s lines.`);
    return v;
  }

  /** Where a character's kept voice sample is: the preview of a designed voice, or the sample sentence spoken once. */
  private sampleFile(character: string, gender?: "female" | "male"): string {
    return path.join(linesDir(), tagOf(character) || "voice", "designs", `${gender ? `${gender}-` : ""}voice.wav`);
  }

  /**
   * Design a voice from a description (ElevenLabs' voice design): the modder describes the character, ElevenLabs
   * makes previews speaking a sample text, the modder hears them and keeps one, saved in the account as
   * "EDGEwave <character>", its preview kept as the character's sample. Clicking or Enter on a voice plays it (a
   * click on a list row is its choice in VS Code, so a voice row never keeps); the Keep row keeps the voice played
   * last. Describe Again asks again with the words kept. Undefined when the modder stops.
   */
  private async design(character: string, gender?: "female" | "male", start = ""): Promise<CharacterVoice | undefined> {
    const who = gender ? `${character} (${gender})` : character;
    let description = start;
    for (;;) {
      description =
        (
          await vscode.window.showInputBox({
            title: `Design a voice for ${who}: describe them`,
            prompt: "Age, gender, accent and how they sound, in a sentence or two. Each try spends ElevenLabs credits for the previews' text",
            placeHolder: "A woman in her thirties, a Nomad from the Badlands: low, dry, a little raspy, confident and wry",
            value: description,
            ignoreFocusOut: true,
            validateInput: (s) => (s.trim().length >= 20 ? undefined : "A little more, please: at least a sentence"),
          })
        )?.trim() ?? "";
      if (!description) return undefined;
      const api = await this.tools.client();
      const rate = this.tools.rate();
      const previews = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `EDGEwave: designing voices for ${who} with ElevenLabs` }, () => api.design(description, SampleText, rate));
      if (!previews.length) throw new Refused("ElevenLabs made no voices from that description; try other words.");
      const dir = path.dirname(this.sampleFile(character, gender));
      fs.mkdirSync(dir, { recursive: true });
      const files = previews.map((pv, i) => {
        const f = path.join(dir, `${Date.now()}-${i + 1}.wav`);
        fs.writeFileSync(f, pv.wav);
        return f;
      });
      type It = vscode.QuickPickItem & { i?: number; again?: boolean; keep?: boolean };
      const kept = await new Promise<number | "again" | undefined>((resolve) => {
        const qp = vscode.window.createQuickPick<It>();
        qp.title = `${who}: click a voice (or Enter) to hear it, then Keep`;
        qp.placeholder = description;
        qp.ignoreFocusOut = true;
        qp.matchOnDescription = true;
        const play = { iconPath: new vscode.ThemeIcon("play"), tooltip: "Play" };
        const voices = previews.map((pv, i): It => ({ label: `$(person) Voice ${i + 1}`, description: pv.seconds ? `${pv.seconds.toFixed(1)} s` : undefined, detail: "Click or Enter plays it", buttons: [play], i }));
        const again: It = { label: "$(edit) Describe again…", detail: "Your words, to change; new voices to hear", again: true };
        let last: number | undefined;
        const keepRow = (): It =>
          last === undefined
            ? { label: "$(check) Keep a voice", detail: "Play one first", keep: true, alwaysShow: true }
            : { label: `$(check) Keep Voice ${last + 1}`, detail: `${who} speaks as it from now on, in every tool; saved in your ElevenLabs account as EDGEwave ${character}`, keep: true, alwaysShow: true };
        const playVoice = (i: number) => {
          last = i;
          void this.events.playFile(files[i]);
          qp.items = [keepRow(), ...voices, again];
          qp.activeItems = [voices[i]];
        };
        let done = false;
        const finish = (r: number | "again") => {
          done = true;
          resolve(r);
          qp.hide();
        };
        qp.onDidTriggerItemButton((e) => e.item.i !== undefined && playVoice(e.item.i));
        qp.onDidAccept(() => {
          const s = qp.selectedItems[0] ?? qp.activeItems[0];
          if (!s) return;
          if (s.again) finish("again");
          else if (s.keep) {
            if (last !== undefined) finish(last);
          } else if (s.i !== undefined) playVoice(s.i);
        });
        qp.onDidHide(() => {
          if (!done) resolve(undefined);
          qp.dispose();
        });
        qp.items = [keepRow(), ...voices, again];
        qp.show();
        playVoice(0);
      });
      void this.events.stop();
      if (kept === "again") {
        for (const f of files) fs.rmSync(f, { force: true });
        continue;
      }
      if (kept === undefined) {
        for (const f of files) fs.rmSync(f, { force: true });
        return undefined;
      }
      const name = `EDGEwave ${character}`.slice(0, 100);
      const id = await api.saveRemix(previews[kept].generatedVoiceId, name, description);
      await this.tools.rememberDesigned(id, name);
      // The kept preview becomes the character's sample, for Hear It; the others go.
      const sample = this.sampleFile(character, gender);
      fs.rmSync(sample, { force: true });
      fs.renameSync(files[kept], sample);
      for (const f of files) fs.rmSync(f, { force: true });
      this.log.appendLine(`speakLine: designed ${who}'s voice (${id}) from "${description}"`);
      return { id, name, how: "designed", description, sample };
    }
  }

  /**
   * Plays a character's voice: its kept sample, else the sample sentence spoken once in it (spends credits; kept
   * after, so it is free from then on).
   */
  private async hear(key: string, character: string, gender: "female" | "male" | undefined, v: CharacterVoice): Promise<void> {
    if (v.sample && fs.existsSync(v.sample)) {
      await this.events.playFile(v.sample);
      return;
    }
    const api = await this.tools.client();
    const rate = this.tools.rate();
    const pcm = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `EDGEwave: ${v.name ?? v.id} speaks a sample sentence (ElevenLabs)` }, () => api.speak(v.id, { text: SampleText }, rate));
    const sample = this.sampleFile(character, gender);
    fs.mkdirSync(path.dirname(sample), { recursive: true });
    fs.writeFileSync(sample, pcmToWav(pcm, rate));
    setCharacter(key, { ...v, sample });
    await this.events.playFile(sample);
  }

  /** EDGEwave: Character Voices…: see, hear, change or forget the voice of each character. */
  async manage(): Promise<void> {
    const all = readCharacters();
    type It = vscode.QuickPickItem & { key?: string; add?: boolean };
    const items: It[] = [
      { label: "$(add) A voice for another character…", add: true },
      ...Object.entries(all).map(([key, v]) => ({ label: key.replace(":", " · "), description: v.name ?? v.id, detail: `${v.how === "designed" ? `Designed: ${v.description ?? ""}` : v.how === "cloned" ? "Cloned from the character's game lines" : v.how === "voiceLines" ? "From Voice Lines" : "Picked"}${v.set ? `, ${v.set.slice(0, 10)}` : ""} · ${v.id}`, key })),
    ];
    const p = await vscode.window.showQuickPick(items, { title: "EDGEwave: Character Voices, used by every tool that speaks a character's lines (EDGEfab's Lip Sync)" });
    if (!p) return;
    if (p.add) {
      const tag = (await vscode.window.showInputBox({ title: "The character's game voice tag", prompt: "As a scene names it, such as judy or angelica_whelan; v for V (then female or male)", validateInput: (s) => (tagOf(s) ? undefined : "A voice tag, please") }))?.trim();
      if (!tag) return;
      const g = tagOf(tag) === "v" ? ((await vscode.window.showQuickPick(["female", "male"], { title: "V's female or male voice?" })) as "female" | "male" | undefined) : undefined;
      if (tagOf(tag) === "v" && !g) return;
      await this.pick(tag, g);
      return;
    }
    const key = p.key!;
    const [tag, gender] = key.split(":") as [string, "female" | "male" | undefined];
    const v = all[key];
    const who = gender ? `${tag} (${gender})` : tag;
    const lines = path.join(linesDir(), tagOf(tag) || "voice");
    type Act = vscode.QuickPickItem & { act: "hear" | "redesign" | "pick" | "reveal" | "forget" };
    const hasSample = !!v.sample && fs.existsSync(v.sample);
    const acts: Act[] = [
      { label: "$(play) Hear It", detail: hasSample ? "Its sample, free" : "Speaks a sample sentence once (about 120 characters of your ElevenLabs credits), then keeps it", act: "hear" },
      { label: "$(sparkle) Design Again from Its Description…", detail: v.description ? `"${v.description}", to change` : "Describe them; new voices to hear", act: "redesign" },
      { label: "$(person) Pick Another Voice…", detail: "One of your ElevenLabs voices", act: "pick" },
      ...(fs.existsSync(lines) ? [{ label: "$(folder-opened) Reveal in File Explorer", detail: `${who}'s spoken lines: ${lines}`, act: "reveal" } as Act] : []),
      { label: "$(trash) Forget It", detail: `${who} gets the voice picker again next time; the voice stays in your ElevenLabs account`, act: "forget" },
    ];
    const a = await vscode.window.showQuickPick(acts, { title: `${who} speaks as ${v.name ?? v.id}${v.how === "designed" ? " (designed)" : ""}` });
    if (!a) return;
    try {
      if (a.act === "hear") await this.hear(key, tag, gender, v);
      else if (a.act === "pick") await this.pick(tag, gender);
      else if (a.act === "reveal") await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(lines));
      else if (a.act === "forget") {
        setCharacter(key, undefined);
        void vscode.window.showInformationMessage(`EDGEwave: ${who}'s voice is forgotten; the voice picker comes up next time.`);
      } else if (a.act === "redesign") {
        const d = await this.design(tag, gender, v.description ?? "");
        if (d) {
          setCharacter(key, d);
          void vscode.window.showInformationMessage(`EDGEwave: ${who} speaks as the new ${d.name ?? d.id} now, in every tool that speaks ${tag}'s lines.`);
        }
      }
    } catch (e) {
      void vscode.window.showErrorMessage(`EDGEwave: ${e instanceof Refused ? e.message : VoiceTools.failure(e).error}`);
    }
  }

  /** Voice Lines picked a speaker's voice: offer it to the other tools, once per speaker. */
  async offerFromVoiceLines(speaker: string, gender: "female" | "male" | undefined, id: string, name: string | undefined): Promise<void> {
    const key = characterKey(speaker, gender);
    if (!tagOf(speaker) || readCharacters()[key]?.id === id) return;
    const asked = this.context.globalState.get<string[]>("edgewave.speakLine.offered") ?? [];
    if (asked.includes(`${key}=${id}`)) return;
    await this.context.globalState.update("edgewave.speakLine.offered", [...asked, `${key}=${id}`]);
    const yes = "Use It Everywhere";
    const a = await vscode.window.showInformationMessage(`Use ${name ?? id} as ${speaker}${gender ? ` (${gender})` : ""}'s voice in other tools too, such as EDGEfab's Lip Sync?`, yes, "Not Now");
    if (a === yes) setCharacter(key, { id, name, how: "voiceLines" });
  }
}

/** A plain stop: the modder said no, or something EDGEwave needs is missing. */
class Refused extends Error {}
