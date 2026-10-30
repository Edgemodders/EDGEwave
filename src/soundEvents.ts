// Sound events for other tools (EDGEwave #7, EDGEquest's music and sound pickers): search the game's own
// event list, hear an event, and make a new event a quest can post from a sound made in EDGEwave.
//
// The list comes from the player's game (src/events.ts), built once through REDcode's bridge and kept in
// EDGEwave's folder, where the MCP server reads it too; it is built again when the game's audio archive
// changes. Hearing an event plays its sound effect variations from the archive, through REDcode, in a small
// preview. Music cues are in Wwise's sound banks, which EDGEwave reads only from A4; they play in the running
// game once REDnode can be asked (REDnode #17). A new event is a REDmod custom sound (src/customSound.ts).
// With show false (EDGEwave #8, EDGEquest's picker), one recording plays at once, with no tab (src/player.ts).
// Music cues and events with no recordings play in the running game through REDnode's editor channel
// (REDnode 0.43, src/rednodeEditor.ts), and with inGame any event does, with the game's own mix.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { oggToWav } from "./audio/ogg";
import { customSoundNote, makeCustomSound, projectSounds, wavSeconds, type CustomSoundResult, type ProjectSound } from "./customSound";
import { eventsFromMetadata, indexFile, MetadataPath, searchEvents, type EventIndex, type EventMatch, type EventQuery, type GameEvent } from "./events";
import { QuietPlayer } from "./player";
import { redcode, type REDcodeApi, type SoundRef } from "./redcode";
import { inGame } from "./rednodeEditor";

type Log = (line: string) => void;

/**
 * What playEvent answers: where the sound came from (the archive, the project, or the running game through
 * REDnode), its recordings, the one played when there was no tab, and the game's id for a sound it plays.
 */
export type PlayResult = { ok: true; where: "archive" | "project" | "game"; variations: number; played?: string; playingId?: number } | { ok: false; reason: string };

/** The game's audio archive: when it changes, the event list is built again. */
function gameStamp(gamePath: string): string {
  try {
    const s = fs.statSync(path.join(gamePath, "archive", "pc", "content", "audio_1_general.archive"));
    return `${s.size}:${Math.round(s.mtimeMs)}`;
  } catch {
    return "unknown";
  }
}

/** The event index on disk, if it was built from this game as it is now. */
export function readIndex(gamePath?: string): EventIndex | undefined {
  try {
    const ix = JSON.parse(fs.readFileSync(indexFile(), "utf8")) as EventIndex;
    if (ix.edgewave !== "events" || !Array.isArray(ix.events)) return undefined;
    if (gamePath && (path.resolve(ix.game.path).toLowerCase() !== path.resolve(gamePath).toLowerCase() || ix.game.stamp !== gameStamp(gamePath))) return undefined;
    return ix;
  } catch {
    return undefined;
  }
}

export class SoundEvents {
  private index?: Promise<GameEvent[]>;
  private sounds?: Promise<Map<number, number[]>>;
  private preview?: vscode.WebviewPanel;
  private readonly player: QuietPlayer;
  /** What plays with no tab now, and until when, so ▶ on it again stops it. */
  private now?: { key: string; until: number };
  /** The sound EDGEwave last started in the running game, stopped by the next one and by Stop Sound. */
  private gamePlaying?: number;

  constructor(private readonly context: vscode.ExtensionContext, private readonly log: Log) {
    this.player = new QuietPlayer(log);
    context.subscriptions.push(this.player);
  }

  /** The game's events: from EDGEwave's folder, or built from the game through REDcode's bridge. */
  events(): Promise<GameEvent[]> {
    this.index ??= this.load().catch((e) => {
      this.index = undefined;
      throw e;
    });
    return this.index;
  }

  private async load(): Promise<GameEvent[]> {
    const api = await redcode();
    const gamePath = api.gamePath();
    if (!gamePath) throw new Error("REDcode has no game folder set (redcode.gamePath), so EDGEwave cannot read the game's sound events.");
    const known = readIndex(gamePath);
    if (known) return known.events;
    const bridge = api.bridge();
    if (!bridge) throw new Error("REDcode's REDbridge is not running, so EDGEwave cannot read the game's sound events. Open a REDcode project or start the bridge, then try again.");
    return vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: "EDGEwave: reading the game's sound events" }, async () => {
      const temp = path.join(os.tmpdir(), `edgewave-events-${process.pid}.json`);
      try {
        const r = await bridge.toJson(MetadataPath, temp);
        const json = r.json ?? JSON.parse(fs.readFileSync(r.file ?? temp, "utf8"));
        const events = eventsFromMetadata(json);
        const ix: EventIndex = { edgewave: "events", version: 1, game: { path: gamePath, stamp: gameStamp(gamePath) }, built: new Date().toISOString(), events };
        fs.mkdirSync(path.dirname(indexFile()), { recursive: true });
        fs.writeFileSync(indexFile(), JSON.stringify(ix));
        this.log(`Sound events: ${events.length} from ${MetadataPath}, kept in ${indexFile()}`);
        return events;
      } finally {
        fs.rmSync(temp, { force: true });
      }
    });
  }

  /** Sound effect variations by event hash, from REDcode's index. */
  private variations(api: REDcodeApi): Promise<Map<number, number[]>> {
    this.sounds ??= api.soundIndex().then(
      (r) => new Map(r.events.map((e) => [e.hash, e.sounds])),
      (e) => {
        this.sounds = undefined;
        throw e;
      },
    );
    return this.sounds;
  }

  async search(q: EventQuery): Promise<EventMatch[]> {
    const events = await this.events();
    const api = await redcode();
    const sounds = await this.variations(api).catch(() => undefined);
    // A picker that searches may play one next: the player starts now, so that sound does not wait.
    this.player.warm();
    return searchEvents(events, q, sounds, this.own(q.project ?? api.project()?.dir));
  }

  /** A project's named sounds; none when it has none or its info.json cannot be read (logged). */
  own(projectDir: string | undefined): ProjectSound[] {
    if (!projectDir) return [];
    try {
      return projectSounds(projectDir);
    } catch (e) {
      this.log(`Project sounds: ${(e as Error).message}`);
      return [];
    }
  }

  /**
   * Plays an event's sound effect variations in the Hear tab (a project sound: its WAV); a reason when it has
   * none to play here. With show false, one of them (picked as the game does) plays at once, with no tab,
   * stopping the sound playing.
   */
  async play(name: string, projectDir?: string, show = true, game = false): Promise<PlayResult> {
    if (game) return this.playInGame(name.trim());
    if (!show) {
      const why = QuietPlayer.unavailable();
      if (why) return { ok: false, reason: why };
    }
    const api = await redcode();
    const dir = projectDir ?? api.project()?.dir;
    const mine = this.own(dir).find((s) => s.name.toLowerCase() === name.trim().toLowerCase());
    if (mine && dir) {
      if (!mine.file || mine.missing) return { ok: false, reason: `${mine.name} is the project's, but its WAV ${mine.file ?? ""} is missing.` };
      const data = fs.readFileSync(path.join(dir, mine.file));
      if (!show) return this.quiet(data, "audio/wav", "project", 1, path.basename(mine.file));
      this.showPreview(mine.name, [`This project's sound: ${mine.type}${mine.seconds ? `, ${mine.seconds} s` : ""}. A quest, scene or script plays it by this name.`], [{ data, mime: "audio/wav", label: path.basename(mine.file) }]);
      return { ok: true, where: "project", variations: 1 };
    }
    const [event] = (await this.events()).filter((e) => e.name.toLowerCase() === name.trim().toLowerCase());
    if (!event) return { ok: false, reason: `The game has no sound event named ${name}, and the project no sound of that name.` };
    const sounds = (await this.variations(api)).get(event.hash) ?? [];
    if (!sounds.length) {
      // Music lives in Wwise's sound banks, which EDGEwave does not read: the running game plays it.
      const r = await this.playInGame(event.name);
      if (r.ok) return r;
      return {
        ok: false,
        reason: /^mus_/i.test(event.name)
          ? `${event.name} is a music cue: music lives in Wwise's sound banks, which only the game plays. ${r.reason}`
          : `${event.name} has no sound effect recordings in the game's index (it may play music, a voice or other events). ${r.reason}`,
      };
    }
    if (!show) {
      const pick = sounds[Math.floor(Math.random() * sounds.length)];
      let a;
      try {
        a = await api.sound({ soundHash: pick, eventHash: event.hash });
      } catch (e) {
        this.log(`Play ${event.name}: ${pick}: ${(e as Error).message}`);
        return { ok: false, reason: `REDcode could not read ${event.name}'s sound ${pick}: ${(e as Error).message}` };
      }
      return this.quiet(a.data, a.mime, "archive", sounds.length, String(pick));
    }
    const why = await this.hear(event.name, sounds.map((s) => ({ ref: { soundHash: s, eventHash: event.hash }, label: String(s) })), eventNotes(event, sounds.length));
    if (why) return { ok: false, reason: `REDcode could not read ${event.name}'s sounds: ${why} (each one is in EDGEwave's output)` };
    return { ok: true, where: "archive", variations: sounds.length };
  }

  /** Plays audio with no tab (src/player.ts), which takes WAV: Ogg (a .wem from REDcode) is decoded first. */
  private async quiet(data: Uint8Array, mime: string, where: "archive" | "project", variations: number, played: string, key = played): Promise<PlayResult> {
    try {
      const wav = mime === "audio/wav" ? data : mime === "audio/ogg" ? await oggToWav(data) : undefined;
      if (!wav) return { ok: false, reason: `${played} is ${mime}, which plays only in the Hear tab.` };
      await this.player.play(wav);
      let seconds = 0;
      try {
        seconds = wavSeconds(wav);
      } catch {
        // A WAV without a length: ▶ again plays it again.
      }
      this.now = { key, until: Date.now() + seconds * 1000 };
      return { ok: true, where, variations, played };
    } catch (e) {
      this.log(`Play ${played}: ${(e as Error).message}`);
      return { ok: false, reason: `EDGEwave could not play ${played} without its Hear tab: ${(e as Error).message}` };
    }
  }

  /** Posts an event in the running game through REDnode (on V), stopping the one EDGEwave started before. */
  async playInGame(name: string): Promise<PlayResult> {
    if (this.gamePlaying !== undefined) await inGame("sound.stop", { playingId: this.gamePlaying }, 1500);
    const r = await inGame<{ playingId: number }>("sound.play", { name, on: "player" });
    if (!r.ok) return r;
    this.gamePlaying = r.playingId;
    this.log(`Played ${name} in the game (REDnode, playing ${r.playingId})`);
    return { ok: true, where: "game", variations: 0, playingId: r.playingId };
  }

  /** Stops the sound playing with no tab, and the one EDGEwave started in the game, if any. */
  async stop(): Promise<void> {
    this.now = undefined;
    if (this.gamePlaying !== undefined) {
      this.gamePlaying = undefined;
      await inGame("sound.stop", {}, 1500);
    }
    return this.player.stop();
  }

  /**
   * Plays a game sound with no tab (Game Assets' ▶): one of `refs` at random, as the game picks a variation.
   * ▶ again on the same item while it plays stops it.
   */
  async playQuiet(key: string, refs: { ref: SoundRef; label: string }[]): Promise<PlayResult | { ok: true; stopped: true }> {
    const why = QuietPlayer.unavailable();
    if (why) return { ok: false, reason: why };
    if (this.now?.key === key && Date.now() < this.now.until) {
      await this.stop();
      return { ok: true, stopped: true };
    }
    const pick = refs[Math.floor(Math.random() * refs.length)];
    if (!pick) return { ok: false, reason: "Nothing to play." };
    let a;
    try {
      a = await (await redcode()).sound(pick.ref);
    } catch (e) {
      this.log(`Play ${pick.label}: ${(e as Error).message}`);
      return { ok: false, reason: `REDcode could not read ${pick.label}: ${(e as Error).message}` };
    }
    return this.quiet(a.data, a.mime, "archive", refs.length, pick.label, key);
  }

  /**
   * Plays sounds from the game (the first 12) in the Hear panel, through REDcode: a sound effect's
   * variations, a voice line, a streamed .wem. Undefined when it showed them; when REDcode could
   * read none, why (REDcode's first error; every error goes to EDGEwave's output).
   */
  async hear(title: string, refs: { ref: SoundRef; label: string }[], notes: string[]): Promise<string | undefined> {
    const api = await redcode();
    const clips: { data: Uint8Array; mime: string; label: string }[] = [];
    let why: string | undefined;
    for (const r of refs.slice(0, 12)) {
      try {
        const a = await api.sound(r.ref);
        clips.push({ data: a.data, mime: a.mime, label: r.label });
      } catch (e) {
        why ??= (e as Error).message;
        this.log(`Hear ${title}: ${r.label}: ${(e as Error).message}`);
      }
    }
    if (!clips.length) return why ?? "nothing to play";
    if (refs.length > clips.length) notes = [...notes, `${refs.length} recordings, the first ${clips.length} here.`];
    this.showPreview(title, notes, clips);
    return undefined;
  }

  private showPreview(title: string, notes: string[], clips: { data: Uint8Array; mime: string; label: string }[]): void {
    if (!this.preview) {
      this.preview = vscode.window.createWebviewPanel("edgewave.eventPreview", "EDGEwave: Hear", { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true });
      this.preview.onDidDispose(() => (this.preview = undefined));
    } else this.preview.reveal(vscode.ViewColumn.Beside, true);
    const p = this.preview;
    p.title = `Hear: ${title}`;
    const nonce = Math.random().toString(36).slice(2);
    p.webview.html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src blob:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:12px}h2{font-size:1.1em;word-break:break-all}
.m{color:var(--vscode-descriptionForeground)}button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;padding:4px 10px;margin:2px;cursor:pointer}
button.on{outline:1px solid var(--vscode-focusBorder)}</style></head><body>
<h2>${esc(title)}</h2>
${notes.map((n) => `<p class="m">${esc(n)}</p>`).join("")}
<div id="b"></div>
<script nonce="${nonce}">
const clips = ${JSON.stringify(clips.map((c) => ({ label: c.label, mime: c.mime, b64: Buffer.from(c.data).toString("base64") })))};
const audio = new Audio(); const b = document.getElementById("b");
const play = (i) => { const c = clips[i]; const bytes = Uint8Array.from(atob(c.b64), (x) => x.charCodeAt(0));
  audio.src = URL.createObjectURL(new Blob([bytes], { type: c.mime })); audio.play().catch(() => {});
  [...b.children].forEach((x, j) => x.classList.toggle("on", j === i)); };
clips.forEach((c, i) => { const x = document.createElement("button"); x.textContent = clips.length === 1 ? "Play" : "Play " + c.label; x.onclick = () => play(i); b.append(x); });
if (clips.length > 1) { const r = document.createElement("button"); r.textContent = "Play a random one"; r.onclick = () => play(Math.floor(Math.random() * clips.length)); b.append(r); }
play(Math.floor(Math.random() * clips.length));
</script></body></html>`;
  }

  /** A sound made in EDGEwave as a new event a quest can post (src/customSound.ts), in the open project or the one given. */
  async custom(o: { project?: string; wav: string | Uint8Array; name: string; kind?: "sfx" | "music" }): Promise<(CustomSoundResult & { note: string }) | { reason: string }> {
    const dir = o.project ?? (await redcode()).project()?.dir;
    if (!dir) return { reason: "No project: open a REDcode project, or pass its folder." };
    try {
      const r = makeCustomSound({ projectDir: dir, wav: o.wav, name: o.name, kind: o.kind });
      this.log(`Custom sound: ${r.event} (${r.type}) from ${r.file}`);
      return { ...r, note: customSoundNote(o.kind, vscode.workspace.getConfiguration("redcode").get<boolean>("pack.redmod", false)) };
    } catch (e) {
      return { reason: (e as Error).message };
    }
  }
}

/** What the Hear panel says about a game event: loops, length, its recordings, its tags. */
export function eventNotes(event: GameEvent, total: number): string[] {
  const length = event.max ? `${event.min === event.max ? event.max : `${event.min} to ${event.max}`} s. ` : "";
  return [
    `${event.loops ? "Loops. " : ""}${length}${total} recording${total === 1 ? "" : "s"}. Each play picks one, as the game does; these are the raw recordings, without the game's effects.`,
    ...(event.tags.length ? [event.tags.join(", ")] : []),
  ];
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
