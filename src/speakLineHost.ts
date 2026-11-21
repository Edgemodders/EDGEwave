// speakLine for other tools (EDGEwave #13, EDGEfab's Lip Sync tab), in VS Code: the core is src/speakLine.ts.
// EDGEwave's own rules hold when another tool calls (agreed with the owner, 2026-11-20):
//   - the key is the modder's, in EDGEwave's secret storage, asked for when there is none;
//   - before a tool first spends credits, the modder is asked once whether it may (remembered per tool);
//   - a character with no voice yet gets EDGEwave's voice picker: one of the account's voices, or a voice designed
//     from a description of the character (no game audio goes to ElevenLabs: the owner, 2026-11-21). The choice goes in the one list
//     of character voices (characters.json), which Voice Lines offers to fill too.
// Every answer is a take or a reason in plain words, never an exception.

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { keyRefused } from "./elevenlabs";
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
   * No game audio is sent to ElevenLabs (the owner, 2026-11-21): there is no clone from game lines.
   */
  async pick(character: string, gender?: "female" | "male"): Promise<CharacterVoice | undefined> {
    type It = vscode.QuickPickItem & { design?: boolean; v?: { id: string; name: string } };
    const who = gender ? `${character} (${gender})` : character;
    const items = (async (): Promise<It[]> => {
      const head: It[] = [
        { label: `$(sparkle) Design a voice for ${who} from a description…`, detail: "Describe them (age, accent, how they sound); ElevenLabs makes new voices to hear, and you keep one. Nothing of the game's is sent.", design: true, alwaysShow: true },
        { label: "Your ElevenLabs voices", kind: vscode.QuickPickItemKind.Separator },
      ];
      try {
        const voices = await (await this.tools.client()).voices();
        return [...head, ...voices.map((v) => ({ label: v.name, description: [v.labels.gender, v.labels.accent, v.labels.age].filter(Boolean).join(", "), detail: v.category, v: { id: v.id, name: v.name } }))];
      } catch (e) {
        return [...head, { label: `$(warning) ${VoiceTools.failure(e).error}` }];
      }
    })();
    const p = await vscode.window.showQuickPick(items, { title: `EDGEwave: a voice for ${who}, kept for every tool that speaks ${character}'s lines`, matchOnDescription: true, ignoreFocusOut: true });
    if (!p) return undefined;
    const v: CharacterVoice | undefined = p.v ? { id: p.v.id, name: p.v.name, how: "picked" } : p.design ? await this.design(character, gender) : undefined;
    if (v) setCharacter(characterKey(character, gender), v);
    return v;
  }

  /**
   * Design a voice from a description (ElevenLabs' voice design): the modder describes the character, ElevenLabs
   * makes previews speaking a sample text, the modder hears them (▶ on each) and keeps one, saved in the account
   * as "EDGEwave <character>". Describe Again asks again. Undefined when the modder stops.
   */
  private async design(character: string, gender?: "female" | "male"): Promise<CharacterVoice | undefined> {
    const who = gender ? `${character} (${gender})` : character;
    let description = "";
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
      const dir = path.join(linesDir(), tagOf(character) || "voice", "designs");
      fs.mkdirSync(dir, { recursive: true });
      const files = previews.map((pv, i) => {
        const f = path.join(dir, `${Date.now()}-${i + 1}.wav`);
        fs.writeFileSync(f, pv.wav);
        return f;
      });
      type It = vscode.QuickPickItem & { i?: number; again?: boolean };
      const kept = await new Promise<number | "again" | undefined>((resolve) => {
        const qp = vscode.window.createQuickPick<It>();
        qp.title = `${who}: hear each voice (▶), then pick the one to keep`;
        qp.placeholder = description;
        qp.ignoreFocusOut = true;
        const play = { iconPath: new vscode.ThemeIcon("play"), tooltip: "Play" };
        qp.items = [
          ...previews.map((pv, i): It => ({ label: `$(person) Voice ${i + 1}`, description: pv.seconds ? `${pv.seconds.toFixed(1)} s` : undefined, detail: "Enter keeps it; ▶ plays it", buttons: [play], i })),
          { label: "$(edit) Describe again…", again: true },
        ];
        let done = false;
        qp.onDidTriggerItemButton((e) => e.item.i !== undefined && void this.events.playFile(files[e.item.i]));
        qp.onDidAccept(() => {
          const s = qp.selectedItems[0];
          if (!s) return;
          done = true;
          resolve(s.again ? "again" : s.i);
          qp.hide();
        });
        qp.onDidHide(() => {
          if (!done) resolve(undefined);
          qp.dispose();
        });
        qp.show();
        void this.events.playFile(files[0]);
      });
      void this.events.stop();
      if (kept === "again") continue;
      for (const f of files) fs.rmSync(f, { force: true });
      if (kept === undefined) return undefined;
      const name = `EDGEwave ${character}`.slice(0, 100);
      const id = await api.saveRemix(previews[kept].generatedVoiceId, name, description);
      await this.tools.rememberDesigned(id, name);
      this.log.appendLine(`speakLine: designed ${who}'s voice (${id}) from "${description}"`);
      return { id, name, how: "designed", description };
    }
  }

  /** EDGEwave: Character Voices…: see, change or forget the voice of each character. */
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
      const v = await this.pick(tag, g);
      if (v) void vscode.window.showInformationMessage(`EDGEwave: ${tag} speaks as ${v.name ?? v.id}.`);
      return;
    }
    const [tag, gender] = p.key!.split(":") as [string, "female" | "male" | undefined];
    const a = await vscode.window.showQuickPick(["Change the voice", "Forget it"], { title: `${p.label}: ${all[p.key!].name ?? all[p.key!].id}` });
    if (a === "Forget it") setCharacter(p.key!, undefined);
    else if (a === "Change the voice") await this.pick(tag, gender);
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
