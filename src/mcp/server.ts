// EDGEwave as an MCP server over stdio, for assistants such as Claude Code and EDGEquest's (EDGEwave #5 and
// #7): voice a quest's lines through ElevenLabs, see which are voiced, list voices; search the game's sound
// events; make a new event from a sound. Every tool is the twin of a part of the extension: the same code
// (src/voice*.ts, src/events.ts, src/customSound.ts) and the same files, so the extension and EDGEquest see
// what the server made. It runs without VS Code: the event list is the one the extension built in EDGEwave's
// folder; settings come from VS Code's settings file; the ElevenLabs key from ELEVENLABS_API_KEY.
//
// voice_lines has no ask-first flag: the owner decided (2026-10-23) that an assistant may voice lines, since
// the person who asked for the quest is the one in the loop. Each call spends ElevenLabs credits; the result
// says how many characters.
//
// stdout is the MCP channel; logs go to stderr.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { customSoundNote, makeCustomSound, projectSounds } from "../customSound";
import { DefaultBaseUrl, ElevenLabs } from "../elevenlabs";
import { indexFile, searchEvents, type EventIndex } from "../events";
import { checkLines, lineStatus, type Voices } from "../voice";
import { DefaultModel, loadRecord, saveRecord, voiceBatch } from "../voiceBatch";

declare const __VERSION__: string;

const log = (line: string) => process.stderr.write(`[edgewave-mcp] ${line}\n`);
const set = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

/** A setting from VS Code's user settings file (JSON with comments): a string, number or boolean. */
function vscodeSetting(key: string): string | number | boolean | undefined {
  const base = process.platform === "win32" ? process.env.APPDATA : process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support") : path.join(os.homedir(), ".config");
  let text = "";
  try {
    if (base) text = fs.readFileSync(path.join(base, "Code", "User", "settings.json"), "utf8");
  } catch {
    return undefined;
  }
  const m = text.match(new RegExp(`"${key.replace(/\./g, "\\.")}"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*"|-?\\d+(?:\\.\\d+)?|true|false)`));
  if (!m) return undefined;
  const v = JSON.parse(m[1]) as string | number | boolean;
  return typeof v === "string" ? set(v) : v;
}

function elevenLabs(): ElevenLabs {
  const key = set(process.env.ELEVENLABS_API_KEY);
  if (!key) throw new Error("No ElevenLabs API key. In VS Code: EDGEwave: Connect an Assistant (MCP) and include the key, or set ELEVENLABS_API_KEY for this server.");
  return new ElevenLabs(key, set(process.env.ELEVENLABS_BASE_URL) ?? String(vscodeSetting("edgewave.elevenlabs.baseUrl") ?? DefaultBaseUrl));
}

function events(): EventIndex {
  try {
    return JSON.parse(fs.readFileSync(indexFile(), "utf8")) as EventIndex;
  } catch {
    throw new Error(`EDGEwave has not read the game's sound events yet (${indexFile()}). Open VS Code with REDcode and EDGEwave, and search for a sound event once (or have EDGEquest's sound picker do it).`);
  }
}

const text = (v: unknown): CallToolResult => ({ content: [{ type: "text", text: JSON.stringify(v, null, 2) }] });
const failure = (e: unknown): CallToolResult => ({ isError: true, content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }] });

const lineSchema = z.object({
  id: z.string().describe("The line's locstringId.ruid, a decimal string"),
  scene: z.string(),
  speaker: z.string().describe("V, or the person's name as written in the story"),
  text: z.string().describe("The subtitle"),
  say: z.string().optional().describe("As spoken, with ElevenLabs v3 [delivery] tags; absent: text"),
  direction: z.string().optional().describe("How it is spoken, in plain words"),
  both: z.boolean().optional().describe("Two takes, female and male V. Absent: true for V, false for anyone else"),
});
const voicesSchema = z
  .record(z.union([z.string(), z.object({ female: z.string().optional(), male: z.string().optional() })]))
  .describe('ElevenLabs voice ids per speaker: { "V": { "female": "...", "male": "..." }, "Judy": "..." }. Those voice.json has are used for the rest');

const server = new McpServer({ name: "edgewave", version: __VERSION__ });

server.registerTool(
  "voice_lines",
  {
    description:
      "Voices a quest's dialogue lines through ElevenLabs, with the modder's key, and records the takes in <project>/source/raw/edgewave/voice/<quest>/voice.json, which EDGEquest reads. " +
      "Only lines with no take, or whose text, say or direction changed, are voiced, unless redo is true (one line with redo regenerates just that line; its last take is kept as previous). " +
      "V gets two takes (female and male V), anyone else one. Every speaker needs a voice: pass voices, or call voice_status to see those already chosen and voice_voices to pick. " +
      "Spends ElevenLabs credits: the result says how many characters were sent. Default model eleven_v3, which reads [tags] in say.",
    inputSchema: {
      project: z.string().describe("The WolvenKit project's folder"),
      quest: z.string().describe("The quest's id"),
      lines: z.array(lineSchema).min(1),
      voices: voicesSchema.optional(),
      redo: z.boolean().default(false),
      model: z.string().optional().describe("An ElevenLabs text-to-speech model id; default the edgewave.voiceLines.model setting, else eleven_v3"),
      archiveDir: z.string().optional().describe("Where the .wem files will go under source/archive, such as mod\\author\\quest\\vo (kept for the .wem step)"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  async ({ project, quest, lines, voices, redo, model, archiveDir }) => {
    try {
      const checked = checkLines(lines);
      const r = await voiceBatch({
        projectDir: project,
        quest,
        lines: checked,
        voices: voices as Voices | undefined,
        redo,
        model: model ?? set(String(vscodeSetting("edgewave.voiceLines.model") ?? "")) ?? DefaultModel,
        rate: Number(vscodeSetting("edgewave.elevenlabs.sampleRate") ?? 48000),
        api: elevenLabs(),
        log,
      });
      if (archiveDir && r.record.archiveDir !== archiveDir) saveRecord(project, { ...loadRecord(project, quest), archiveDir });
      return text({
        voiced: r.voiced.length,
        failed: r.failed.map(({ id, message }) => ({ id, message })),
        characters: r.characters,
        model: r.model,
        sampleRate: r.rate,
        record: path.join(project, "source", "raw", "edgewave", "voice", quest, "voice.json"),
        lines: checked.map((l) => ({ id: l.id, status: lineStatus(l, r.record), female: r.record.lines[l.id]?.female, male: r.record.lines[l.id]?.male })),
      });
    } catch (e) {
      return failure(e);
    }
  },
);

server.registerTool(
  "voice_status",
  {
    description:
      "Which of a quest's lines are voiced (made), changed since their take (stale) or have none (none), from voice.json; and the voices chosen per speaker. " +
      "Without lines, every line voice.json has, with what each take was made from.",
    inputSchema: { project: z.string(), quest: z.string(), lines: z.array(lineSchema).optional() },
    annotations: { readOnlyHint: true },
  },
  async ({ project, quest, lines }) => {
    try {
      const record = loadRecord(project, quest);
      if (!lines) return text(record);
      const checked = checkLines(lines);
      const status = checked.map((l) => ({ id: l.id, scene: l.scene, status: lineStatus(l, record), female: record.lines[l.id]?.female, male: record.lines[l.id]?.male }));
      return text({ quest, voices: record.voices, made: status.filter((s) => s.status === "made").length, stale: status.filter((s) => s.status === "stale").length, none: status.filter((s) => s.status === "none").length, lines: status });
    } catch (e) {
      return failure(e);
    }
  },
);

server.registerTool(
  "voice_voices",
  {
    description: "The ElevenLabs account's voices (its own, saved and default ones), with their labels (gender, age, accent) and a preview URL. A search narrows them by name or label.",
    inputSchema: { search: z.string().optional(), limit: z.number().int().min(1).max(500).default(100) },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ search, limit }) => {
    try {
      const list = await elevenLabs().voices(search);
      return text({ total: list.length, voices: list.slice(0, limit) });
    } catch (e) {
      return failure(e);
    }
  },
);

server.registerTool(
  "sound_events",
  {
    description:
      "Searches the game's sound events by name: the game's own list (base\\sound\\event\\eventsmetadata.json in the user's game; 2.31 names every event). " +
      "Every word must be in the name, or be one of its tags; a decimal number finds an event by its Wwise hash. music: true keeps music cues (mus_*, quest music tags), false leaves them out; quest: true keeps events tagged for quests. " +
      "A quest node posts an event by its name. Each has its hash, loops, min and max length in seconds, and tags. " +
      "With project, the project's own named sounds (REDmod custom sounds in its source/resources/info.json, made with Add to Project or sound_custom) come first, with project: { type, file }, and replaces: true when one has a game event's name.",
    inputSchema: {
      query: z.string().default(""),
      music: z.boolean().optional(),
      quest: z.boolean().optional(),
      limit: z.number().int().min(1).max(500).default(50),
      project: z.string().optional().describe("The WolvenKit project's folder, for its own sounds"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ query, music, quest, limit, project }) => {
    try {
      const ix = events();
      const found = searchEvents(ix.events, { query, music, quest, limit }, undefined, project ? projectSounds(project) : []);
      return text({ events: found, builtFrom: ix.game.path, built: ix.built });
    } catch (e) {
      return failure(e);
    }
  },
);

server.registerTool(
  "sound_custom",
  {
    description:
      "Makes a sound (a 16-bit PCM WAV, such as an EDGEwave render) into a new sound event a quest can post: a REDmod custom sound named edgewave_<name> in the project (source/customSounds and source/resources/info.json). " +
      "kind sfx plays with low occlusion (not muffled); music plays as 2D, on the effects slider (REDmod has no music type). The game reads it at start: pack and install, then restart.",
    inputSchema: {
      project: z.string().describe("The WolvenKit project's folder"),
      wav: z.string().describe("The WAV file, absolute or relative to the project"),
      name: z.string().describe("The sound's name; the event is edgewave_<name>"),
      kind: z.enum(["sfx", "music"]).default("sfx"),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  async ({ project, wav, name, kind }) => {
    try {
      const r = makeCustomSound({ projectDir: project, wav, name, kind });
      return text({ ...r, note: customSoundNote(kind, vscodeSetting("redcode.pack.redmod") === true) });
    } catch (e) {
      return failure(e);
    }
  },
);

server.connect(new StdioServerTransport()).then(
  () => log(`EDGEwave MCP ${__VERSION__} ready`),
  (e) => {
    log(`could not start: ${(e as Error).message}`);
    process.exit(1);
  },
);
