// The game's sound events by name (EDGEwave #7). base\sound\event\eventsmetadata.json in the player's game
// (a JsonResource holding an audioAudioEventArray) names every event: 23,634 in 2.31, with the Wwise id
// (FNV-1 of the lower-case name, true for all of them), length, looping and tags. EDGEwave reads it through
// REDcode's bridge and keeps a small index in its own folder, for the MCP server too. Never committed: it is
// built from the player's game. Pure, for the unit tests.

import * as os from "node:os";
import * as path from "node:path";

export const MetadataPath = "base\\sound\\event\\eventsmetadata.json";

export interface GameEvent {
  name: string;
  /** Wwise's id: FNV-1 32 of the lower-case name. */
  hash: number;
  loops: boolean;
  /** Seconds, as the game's metadata gives them (0 when unknown). */
  min: number;
  max: number;
  tags: string[];
}

export interface EventIndex {
  edgewave: "events";
  version: 1;
  /** What it was built from: the game folder and its audio archive's size and time, to know when to build again. */
  game: { path: string; stamp: string };
  built: string;
  events: GameEvent[];
}

export interface EventMatch extends GameEvent {
  music: boolean;
  /** Tagged for quests: music_quests_events, quest_music_*, sfx_quest_events. */
  quest: boolean;
  /** The sound effect variations REDcode's index has for it (hashes), when known. */
  sounds?: number[];
  /** The project's own sound (a REDmod custom sound): its type and WAV; replaces, when it has a game event's name. */
  project?: { type: string; file?: string; replaces?: boolean };
}

/** A project's named sound, as searchEvents takes it (customSound.ts's ProjectSound). */
export interface OwnSound {
  name: string;
  type: string;
  file?: string;
  seconds?: number;
}

/** EDGEwave's own folder, beside EDGEmat's and REDcode's: the MCP server and the event index. */
export function edgewaveHome(): string {
  // EDGEWAVE_HOME: another folder, for the smoke test (so it never touches the modder's index).
  if (process.env.EDGEWAVE_HOME?.trim()) return process.env.EDGEWAVE_HOME.trim();
  const base = process.env.LOCALAPPDATA || (process.platform === "win32" ? path.join(os.homedir(), "AppData", "Local") : path.join(os.homedir(), ".local", "share"));
  return path.join(base, "EDGEwave");
}

export const indexFile = () => path.join(edgewaveHome(), "events.json");

/** Wwise's id for a name: FNV-1 32 of its lower-case bytes. */
export function wwiseId(name: string): number {
  let h = 0x811c9dc5;
  for (const c of Buffer.from(name.toLowerCase(), "utf8")) {
    h = Math.imul(h, 0x01000193) >>> 0;
    h = (h ^ c) >>> 0;
  }
  return h >>> 0;
}

const cname = (x: unknown): string | undefined => {
  const v = (x as { $value?: unknown } | undefined)?.$value;
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined;
};

/** The events from eventsmetadata.json as WolvenKit's JSON has it, one per name. */
export function eventsFromMetadata(json: unknown): GameEvent[] {
  const root = (json as { Data?: { RootChunk?: { root?: unknown } } })?.Data?.RootChunk?.root as { Data?: { events?: unknown }; events?: unknown } | undefined;
  const list = (root?.Data?.events ?? root?.events) as unknown[] | undefined;
  if (!Array.isArray(list)) throw new Error("eventsmetadata.json has no events list (audioAudioEventArray.events)");
  const seen = new Map<string, GameEvent>();
  for (const e of list as Record<string, unknown>[]) {
    const name = cname(e.redId);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.set(name.toLowerCase(), {
      name,
      hash: typeof e.wwiseId === "number" ? e.wwiseId : wwiseId(name),
      loops: !!e.isLooping,
      min: round(Number(e.minDuration) || 0),
      max: round(Number(e.maxDuration) || 0),
      tags: Array.isArray(e.tags) ? (e.tags as unknown[]).map(cname).filter((t): t is string => !!t) : [],
    });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const round = (s: number) => Math.round(s * 1000) / 1000;

const MusicTags = /^(music_quests_events|quest_music_start|quest_music_stop)$/i;
const QuestTags = /^(music_quests_events|quest_music_start|quest_music_stop|sfx_quest_events)$/i;
export const isMusic = (e: GameEvent) => /^mus_/i.test(e.name) || e.tags.some((t) => MusicTags.test(t));
export const isQuest = (e: GameEvent) => e.tags.some((t) => QuestTags.test(t));

export interface EventQuery {
  /** Words that must all be in the name or a tag; or a decimal hash. */
  query?: string;
  /** true: only music; false: no music. */
  music?: boolean;
  /** Only events tagged for quests. */
  quest?: boolean;
  limit?: number;
  /** The project whose own sounds come first: its folder; absent, the open REDcode project's. */
  project?: string;
}

/**
 * Events matching a query, names starting with the first word first. A project's own sounds (`own`) come
 * before the game's, tagged "project" and their type; one with a game event's name replaces it, and stands
 * in its place.
 */
export function searchEvents(events: readonly GameEvent[], q: EventQuery, sounds?: ReadonlyMap<number, number[]>, own: readonly OwnSound[] = []): EventMatch[] {
  const text = (q.query ?? "").trim().toLowerCase();
  const limit = Math.max(1, Math.min(q.limit ?? 50, 1000));
  const words = text.split(/\s+/).filter(Boolean);
  const byHash = /^\d+$/.test(text) ? Number(text) : undefined;
  const game = new Map(events.map((e) => [e.name.toLowerCase(), e]));
  const mine = own.map((s): EventMatch => {
    const was = game.get(s.name.toLowerCase());
    const secs = s.seconds ?? 0;
    const m: EventMatch = {
      name: s.name,
      hash: wwiseId(s.name),
      loops: false,
      min: secs,
      max: secs,
      tags: ["project", s.type, ...(was?.tags ?? [])],
      music: was ? isMusic(was) : false,
      quest: was ? isQuest(was) : false,
      project: { type: s.type, ...(s.file ? { file: s.file } : {}), ...(was ? { replaces: true } : {}) },
    };
    return m;
  });
  const replaced = new Set(mine.map((m) => m.name.toLowerCase()));
  const out: EventMatch[] = [];
  const firsts: EventMatch[] = [];
  for (const m of mine) {
    if (byHash !== undefined ? m.hash !== byHash : !words.every((w) => m.name.toLowerCase().includes(w) || m.tags.some((t) => t.toLowerCase() === w))) continue;
    if (q.music !== undefined && m.music !== q.music) continue;
    if (q.quest && !m.quest) continue;
    firsts.push(m);
  }
  for (const e of events) {
    if (replaced.has(e.name.toLowerCase())) continue;
    if (byHash !== undefined ? e.hash !== byHash : !words.every((w) => e.name.toLowerCase().includes(w) || e.tags.some((t) => t.toLowerCase() === w))) continue;
    const m: EventMatch = { ...e, music: isMusic(e), quest: isQuest(e) };
    if (q.music !== undefined && m.music !== q.music) continue;
    if (q.quest && !m.quest) continue;
    const s = sounds?.get(e.hash);
    if (s?.length) m.sounds = s;
    out.push(m);
  }
  const first = words[0];
  const order = (a: EventMatch, b: EventMatch) => Number(!a.name.toLowerCase().startsWith(first)) - Number(!b.name.toLowerCase().startsWith(first)) || a.name.localeCompare(b.name);
  if (first) {
    out.sort(order);
    firsts.sort(order);
  }
  return [...firsts, ...out].slice(0, limit);
}

/** A new event's name for a sound made in EDGEwave: edgewave_<name>, lower case, letters, digits and _. */
export function customEventName(name: string): string {
  const s = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!s) throw new Error("The sound needs a name");
  return s.startsWith("edgewave_") ? s : `edgewave_${s}`;
}
