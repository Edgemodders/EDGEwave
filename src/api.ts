// EDGEwave's API for other EDGE tools, returned from activate() (EDGEwave #5 and #7, agreed with EDGEquest
// 2026-10-23 and 24). Other extensions copy these interfaces and never import EDGEwave's code, as EDGEwave
// does with REDcode's. Documented in docs/api.md.

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { EventMatch, EventQuery } from "./events";
import { redcode } from "./redcode";
import type { CustomSoundResult } from "./customSound";
import type { SoundEvents } from "./soundEvents";
import { checkLines, type VoiceLine, type VoiceRecord, type Voices } from "./voice";
import type { VoiceLines } from "./voiceLines";

export interface EDGEwaveApi {
  readonly apiVersion: 1;
  readonly version: string;
  /** Opens Voice Lines on these lines (adding them to the quest's open panel); resolves with voice.json when the panel closes. */
  voiceLines(o: { quest: string; lines: VoiceLine[]; voices?: Voices; archiveDir?: string; project?: string }): Promise<VoiceRecord>;
  /** The quest's voice.json, or undefined when nothing is voiced yet. */
  voiceStatus(quest: string, project?: string): Promise<VoiceRecord | undefined>;
  /** The game's sound events matching a query (the game's own list, 2.31: every event named). */
  soundEvents(o: EventQuery): Promise<EventMatch[]>;
  /** Plays an event's sound effect recordings in EDGEwave's preview, or says why it cannot. */
  playEvent(o: { name: string }): Promise<{ ok: true; where: "archive"; variations: number } | { ok: false; reason: string }>;
  /** A sound made in EDGEwave as a new event a quest can post: a REDmod custom sound, edgewave_<name>. */
  customSound(o: { project?: string; wav: string | Uint8Array; name: string; kind?: "sfx" | "music" }): Promise<(CustomSoundResult & { note: string }) | { reason: string }>;
}

/** The project's folder: given, REDcode's open project, or the workspace folder that has source/. */
async function projectDir(given?: string): Promise<string> {
  if (given) return given;
  const p = (await redcode().catch(() => undefined))?.project();
  if (p) return p.dir;
  const ws = vscode.workspace.workspaceFolders?.find((f) => fs.existsSync(path.join(f.uri.fsPath, "source")));
  if (ws) return ws.uri.fsPath;
  throw new Error("EDGEwave: no project. Open the WolvenKit project in REDcode, or pass its folder as project.");
}

export function makeApi(version: string, voiceLines: VoiceLines, events: SoundEvents): EDGEwaveApi {
  return {
    apiVersion: 1,
    version,
    async voiceLines(o) {
      if (!o?.quest) throw new Error("EDGEwave: voiceLines needs the quest's id");
      const lines = checkLines(o.lines);
      return voiceLines.open({ projectDir: await projectDir(o.project), quest: o.quest, lines, voices: o.voices, archiveDir: o.archiveDir, focus: lines.length === 1 ? [lines[0].id] : undefined });
    },
    async voiceStatus(quest, project) {
      return voiceLines.status(await projectDir(project), quest);
    },
    soundEvents: (o) => events.search(o ?? {}),
    playEvent: (o) => events.play(o.name),
    customSound: (o) => events.custom(o),
  };
}
