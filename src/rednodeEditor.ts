// REDnode's editor channel (REDnode 0.43.0, REDnode #17): plays a game sound event in the running game, with
// the game's own mix, so a music cue or an event with no recordings in the archive can be heard. While REDnode
// runs it writes %LOCALAPPDATA%\REDnode\editor.json with its port and a token made new each run; the calls are
// POST /editor/sound.play { name, on? } and /editor/sound.stop { playingId } or {}. Local only, and refused with
// an Origin header, so it is called from the extension, never from a page. No VS Code imports: the unit tests
// run it against a stand-in. Source: REDnode's docs/overlay-apps.md, "Editor tools: the editor channel".

import * as fs from "node:fs";
import * as path from "node:path";

/** editor.json: where it is. EDGEWAVE_REDNODE_EDITOR points elsewhere for the tests. */
export function editorFile(): string {
  return process.env.EDGEWAVE_REDNODE_EDITOR || path.join(process.env.LOCALAPPDATA ?? "", "REDnode", "editor.json");
}

const NoGame = "Start the game with REDnode 0.43 or later to hear it in the game.";

/** Whether a process runs: editor.json stays behind when the game ends. */
function running(pid: unknown): boolean {
  if (typeof pid !== "number") return true; // no pid written: try the port
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export type GameCall<T> = ({ ok: true } & T) | { ok: false; reason: string };

/** One call to the channel; a reason when the game is not running with REDnode, or REDnode refuses. */
export async function inGame<T extends object>(call: "sound.play" | "sound.stop", body: object, timeoutMs = 4000): Promise<GameCall<T>> {
  let info: { port?: number; token?: string; pid?: number };
  try {
    info = JSON.parse(fs.readFileSync(editorFile(), "utf8"));
  } catch {
    return { ok: false, reason: NoGame };
  }
  if (!info.port || !info.token || !running(info.pid)) return { ok: false, reason: NoGame };
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/editor/${call}`, {
      method: "POST",
      headers: { authorization: `Bearer ${info.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const r = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: string };
    if (r.ok) return r as { ok: true } & T;
    // 409: REDnode runs but the game is not linked yet (the main menu loading).
    return { ok: false, reason: `REDnode: ${r.reason ?? `HTTP ${res.status}`}${res.status === 409 ? ". Wait for the game to load, then try again." : ""}` };
  } catch {
    return { ok: false, reason: NoGame };
  }
}
