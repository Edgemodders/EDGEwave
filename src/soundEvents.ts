// Sound events for other tools (EDGEwave #7, EDGEquest's music and sound pickers): search the game's own
// event list, hear an event, and make a new event a quest can post from a sound made in EDGEwave.
//
// The list comes from the player's game (src/events.ts), built once through REDcode's bridge and kept in
// EDGEwave's folder, where the MCP server reads it too; it is built again when the game's audio archive
// changes. Hearing an event plays its sound effect variations from the archive, through REDcode, in a small
// preview. Music cues are in Wwise's sound banks, which EDGEwave reads only from A4; they play in the running
// game once REDnode can be asked (REDnode #17). A new event is a REDmod custom sound (src/customSound.ts).

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { customSoundNote, makeCustomSound, type CustomSoundResult } from "./customSound";
import { eventsFromMetadata, indexFile, MetadataPath, searchEvents, type EventIndex, type EventMatch, type EventQuery, type GameEvent } from "./events";
import { redcode, type REDcodeApi } from "./redcode";

type Log = (line: string) => void;

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

  constructor(private readonly context: vscode.ExtensionContext, private readonly log: Log) {}

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
    return searchEvents(events, q, sounds);
  }

  /** Plays an event's sound effect variations in a preview; a reason when it has none to play here. */
  async play(name: string): Promise<{ ok: true; where: "archive"; variations: number } | { ok: false; reason: string }> {
    const [event] = (await this.events()).filter((e) => e.name.toLowerCase() === name.trim().toLowerCase());
    if (!event) return { ok: false, reason: `The game has no sound event named ${name}.` };
    const api = await redcode();
    const sounds = (await this.variations(api)).get(event.hash) ?? [];
    if (!sounds.length)
      return {
        ok: false,
        reason: /^mus_/i.test(event.name)
          ? `${event.name} is a music cue. Music lives in Wwise's sound banks, which EDGEwave cannot play yet; it will play in the running game through REDnode (REDnode #17).`
          : `${event.name} has no sound effect recordings in the game's index (it may play music, a voice or other events); it can only be heard in the running game, through REDnode (REDnode #17).`,
      };
    const clips: { sound: number; data: Uint8Array; mime: string }[] = [];
    for (const s of sounds.slice(0, 12)) {
      try {
        const a = await api.sound({ soundHash: s, eventHash: event.hash });
        clips.push({ sound: s, data: a.data, mime: a.mime });
      } catch (e) {
        this.log(`Sound events: ${s} of ${event.name}: ${(e as Error).message}`);
      }
    }
    if (!clips.length) return { ok: false, reason: `REDcode could not read ${event.name}'s sounds; see REDcode's output.` };
    this.showPreview(event, clips, sounds.length);
    return { ok: true, where: "archive", variations: sounds.length };
  }

  private showPreview(event: GameEvent, clips: { sound: number; data: Uint8Array; mime: string }[], total: number): void {
    if (!this.preview) {
      this.preview = vscode.window.createWebviewPanel("edgewave.eventPreview", "EDGEwave: Hear", { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true });
      this.preview.onDidDispose(() => (this.preview = undefined));
    } else this.preview.reveal(vscode.ViewColumn.Beside, true);
    const p = this.preview;
    p.title = `Hear: ${event.name}`;
    const nonce = Math.random().toString(36).slice(2);
    p.webview.html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src blob:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:12px}h2{font-size:1.1em;word-break:break-all}
.m{color:var(--vscode-descriptionForeground)}button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;padding:4px 10px;margin:2px;cursor:pointer}
button.on{outline:1px solid var(--vscode-focusBorder)}</style></head><body>
<h2>${esc(event.name)}</h2>
<p class="m">${event.loops ? "Loops. " : ""}${event.max ? `${event.min === event.max ? event.max : `${event.min} to ${event.max}`} s. ` : ""}${total} recording${total === 1 ? "" : "s"}${total > clips.length ? `, the first ${clips.length} here` : ""}. Each play picks one, as the game does; these are the raw recordings, without the game's effects.</p>
<p class="m">${event.tags.map(esc).join(", ")}</p>
<div id="b"></div>
<script nonce="${nonce}">
const clips = ${JSON.stringify(clips.map((c) => ({ sound: c.sound, mime: c.mime, b64: Buffer.from(c.data).toString("base64") })))};
const audio = new Audio(); const b = document.getElementById("b");
const play = (i) => { const c = clips[i]; const bytes = Uint8Array.from(atob(c.b64), (x) => x.charCodeAt(0));
  audio.src = URL.createObjectURL(new Blob([bytes], { type: c.mime })); audio.play().catch(() => {});
  [...b.children].forEach((x, j) => x.classList.toggle("on", j === i)); };
clips.forEach((c, i) => { const x = document.createElement("button"); x.textContent = "Play " + c.sound; x.onclick = () => play(i); b.append(x); });
const r = document.createElement("button"); r.textContent = "Play a random one"; r.onclick = () => play(Math.floor(Math.random() * clips.length)); b.append(r);
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

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
