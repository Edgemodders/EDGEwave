// The sound document: a .edgewave file, JSON that names the sources and lists the edits, never the
// audio. Version 2 (A2 Mix) holds tracks, each a source with its own edits, placement and effects,
// mixed into one sound; version 1 (A1, one source) opens as one track. No VS Code or Node imports,
// so the editor page uses it too.

/** Where a sound comes from. Fetched again (through REDcode for the game) each time the document opens. */
export type Source =
  /** A game file, such as a voice line .wem, by its path in the archives. */
  | { kind: "game"; path: string }
  /** A sound effect in the game's sfx_container.opusinfo. */
  | { kind: "sfx"; soundHash: number; eventHash?: number; eventName?: string }
  /** A file, relative to the document's folder (or absolute). */
  | { kind: "file"; file: string };

/** Times are seconds on the clip as it is after the edits before this one. */
export type Edit =
  /** Keep only start to end. */
  | { op: "trim"; start: number; end: number }
  /** Remove start to end. */
  | { op: "cut"; start: number; end: number }
  /**
   * Insert a copy of from.start to from.end at at. from.after says which sound the copy was taken
   * from: the sound after that many edits (so a Cut's range can still be pasted after the cut).
   * Absent, it is the sound just before this paste.
   */
  | { op: "paste"; at: number; from: { start: number; end: number; after?: number } }
  /** Insert silence of length seconds at at. */
  | { op: "silence"; at: number; length: number }
  /** A gain ramp from silence (in) or to silence (out) over start to end. */
  | { op: "fade"; dir: "in" | "out"; start: number; end: number; curve?: Curve }
  /** Gain in decibels, over start to end or the whole sound. */
  | { op: "gain"; db: number; start?: number; end?: number }
  /** Gain that brings the peak over start to end (or the whole sound) to peakDb. */
  | { op: "normalize"; peakDb: number; start?: number; end?: number }
  /** Mix down to mono, or copy mono to both stereo channels. */
  | { op: "channels"; to: 1 | 2 };

export type Curve = "linear" | "exponential" | "smooth";

/** An effect in a track's chain or the master's, in order. Played and rendered by the browser's audio engine. */
export type Effect =
  /** Three bands in dB: a low shelf at 250 Hz, a peak at 1.5 kHz, a high shelf at 4 kHz. */
  | { type: "eq"; low: number; mid: number; high: number; bypass?: boolean }
  /** A filter at hz, with resonance q. */
  | { type: "lowpass" | "highpass" | "bandpass"; hz: number; q: number; bypass?: boolean }
  /** A room: a decay of seconds, mixed in at mix (0 to 1). */
  | { type: "reverb"; seconds: number; mix: number; bypass?: boolean }
  /** Soft clipping, amount 0 to 1. */
  | { type: "distortion"; amount: number; bypass?: boolean }
  /** Levels above threshold dB are reduced by ratio. */
  | { type: "compressor"; threshold: number; ratio: number; bypass?: boolean };

export type EffectType = Effect["type"];

/** How a voice tool (ElevenLabs) made a track's source file, so it can be traced or made again. */
export type Made =
  /** Generate Sound: a sound effect from a prompt. */
  | { by: "elevenlabs"; tool: "sound"; prompt: string; seconds?: number; loop?: boolean; influence?: number }
  /** Speak Line: text in a voice; from, the track whose voice was cloned. */
  | { by: "elevenlabs"; tool: "speak"; text: string; voiceId: string; voiceName?: string; model?: string; from?: string }
  /** Re-Voice: a track's line in another voice; description, the change asked for. */
  | { by: "elevenlabs"; tool: "revoice"; from: string; voiceId: string; voiceName?: string; description?: string; model?: string };

export interface Track {
  /** Stable within the document. */
  id: string;
  source: Source;
  /** A voice line: shows Translate and Re-Voice. */
  voice?: boolean;
  /** Made by a voice tool. */
  made?: Made;
  edits: Edit[];
  /** Where the clip starts on the mix, in seconds. */
  offset: number;
  /** dB. */
  gain: number;
  /** -1 (left) to 1 (right). */
  pan: number;
  /** Playback rate: pitch and speed together. 1 when absent. */
  rate?: number;
  /** Out of the mix: the lane's checkbox is unchecked. */
  mute?: boolean;
  effects: Effect[];
}

export interface Render {
  /** The WAV the render writes, relative to the document's folder. */
  file: string;
  /** Hz; the first track's rate when absent. */
  sampleRate?: number;
}

/** How Add to Project put this sound in the mod last time, offered first next time. */
export type IntoGame =
  /** A new sound in the project: a REDmod custom sound under a new event name, which quests, scenes and scripts play by that name. */
  | { route: "new"; event: string; type: string }
  /** Replace one sound effect variation in its .opuspak (REDbridge's sound.importWavs, through REDcode's Import); which one (absent before 2026-10-19: track 1's). */
  | { route: "override"; soundHash?: number }
  /** A REDmod custom sound: the game plays the render for this event (all its variations), as type. */
  | { route: "redmod"; event: string; type: string; gain: number; pitch: number }
  /** A REDmod custom sound that silences this event: the render with its samples zeroed, as type (absent before 2026-10-19: mod_skip). */
  | { route: "skip"; event: string; type?: string }
  /** A REDnode package's own sound (EDGEwave #2): the render as sounds/<sound>.wav in the package (relative to the project's folder when in it), in its manifest with the category. */
  | { route: "rednode"; package: string; sound: string; category: string };

export interface SoundDoc {
  edgewave: 2;
  tracks: Track[];
  /** After the tracks are mixed. */
  master: { gain: number; effects: Effect[] };
  /** Loop points, seconds on the mix. */
  loop?: { start: number; end: number } | null;
  render: Render;
  /** The last Add to Project choice. */
  game?: IntoGame;
}

/** Version 1, as A1 wrote it. */
interface DocV1 {
  edgewave: 1;
  source: Source;
  voice?: boolean;
  edits: Edit[];
  loop?: { start: number; end: number } | null;
  render: Render;
}

export const Extension = ".edgewave";

function isSource(s: unknown): s is Source {
  const x = s as Partial<Record<string, unknown>> | undefined;
  return (
    !!x &&
    ((x.kind === "game" && typeof x.path === "string") ||
      (x.kind === "sfx" && typeof x.soundHash === "number") ||
      (x.kind === "file" && typeof x.file === "string"))
  );
}

/** A new track for a source, at the start of the mix, with no edits or effects. */
export function newTrack(id: string, source: Source, voice?: boolean): Track {
  const t: Track = { id, source, edits: [], offset: 0, gain: 0, pan: 0, effects: [] };
  if (voice) t.voice = true;
  return t;
}

/** A new document with one track. */
export function newDoc(source: Source, renderFile: string, voice?: boolean): SoundDoc {
  return { ...emptyDoc(renderFile), tracks: [newTrack("t1", source, voice)] };
}

/** A new document with no tracks yet (Create a Sound): sounds dropped on it, Add Sound or a voice tool fill it. */
export function emptyDoc(renderFile: string): SoundDoc {
  return { edgewave: 2, tracks: [], master: { gain: 0, effects: [] }, render: { file: renderFile } };
}

/** The sound files EDGEwave opens, as Add Sound's file picker and a drop take them. */
export const SoundExtensions = ["wav", "ogg", "mp3", "flac", "opus", "wem"];
export const isSoundFile = (name: string) => new RegExp(`\\.(${SoundExtensions.join("|")})$`, "i").test(name);

/** An id no track in the document has yet. */
export function nextTrackId(doc: SoundDoc): string {
  let n = doc.tracks.length + 1;
  while (doc.tracks.some((t) => t.id === `t${n}`)) n++;
  return `t${n}`;
}

/** A document from its text, version 1 opened as one track; throws with a readable message when it is not one. */
export function parseDoc(text: string): SoundDoc {
  let d: unknown;
  try {
    d = JSON.parse(text);
  } catch (e) {
    throw new Error(`Not valid JSON: ${(e as Error).message}`);
  }
  const raw = d as { edgewave?: unknown } | null;
  if (!raw || typeof raw !== "object" || (raw.edgewave !== 1 && raw.edgewave !== 2)) throw new Error('Not an EDGEwave sound document ("edgewave": 1 or 2 is missing)');
  if (raw.edgewave === 1) {
    const v1 = raw as Partial<DocV1>;
    if (!isSource(v1.source)) throw new Error("The document's source is missing or not one of game, sfx or file");
    if (!Array.isArray(v1.edits)) throw new Error("The document's edits are missing");
    if (!v1.render || typeof v1.render.file !== "string") throw new Error("The document's render file is missing");
    const doc = newDoc(v1.source, v1.render.file, v1.voice);
    doc.tracks[0].edits = v1.edits;
    doc.render = v1.render;
    if (v1.loop !== undefined) doc.loop = v1.loop;
    return doc;
  }
  const doc = raw as Partial<SoundDoc>;
  // No tracks is a sound not started yet (Create a Sound).
  if (!Array.isArray(doc.tracks)) throw new Error("The document's tracks are missing");
  doc.tracks.forEach((t, i) => {
    if (!t || typeof t.id !== "string") throw new Error(`Track ${i + 1} has no id`);
    if (!isSource(t.source)) throw new Error(`Track ${i + 1}'s source is missing or not one of game, sfx or file`);
    if (!Array.isArray(t.edits)) throw new Error(`Track ${i + 1}'s edits are missing`);
    t.offset ??= 0;
    t.gain ??= 0;
    t.pan ??= 0;
    t.effects ??= [];
  });
  // Solo, before 2026-10-19: the tracks it let be heard stay in the mix, the others leave it.
  const old = doc.tracks as (Track & { solo?: boolean })[];
  if (old.some((t) => t.solo && !t.mute)) for (const t of old) if (!t.solo) t.mute = true;
  for (const t of old) delete t.solo;
  doc.master ??= { gain: 0, effects: [] };
  doc.master.effects ??= [];
  if (!doc.render || typeof doc.render.file !== "string") throw new Error("The document's render file is missing");
  return doc as SoundDoc;
}

/** The text of a document, as the editor writes it. */
export function formatDoc(doc: SoundDoc): string {
  return JSON.stringify(doc, null, 2) + "\n";
}

/** A stable key for a source, for caching its audio. */
export function sourceKey(s: Source): string {
  return s.kind === "game" ? `game:${s.path.toLowerCase()}` : s.kind === "sfx" ? `sfx:${s.soundHash}` : `file:${s.file}`;
}

/** A short name for a source, for titles. */
export function sourceLabel(s: Source): string {
  switch (s.kind) {
    case "game":
      return s.path.split(/[\\/]/).pop() ?? s.path;
    case "sfx":
      return `${s.eventName ?? (s.eventHash !== undefined ? `event ${s.eventHash}` : "sound effect")} · ${s.soundHash}`;
    case "file":
      return s.file.split(/[\\/]/).pop() ?? s.file;
  }
}

/** A short name for a document: its first track's source, and how many more there are; with no track, its render's name. */
export function docLabel(doc: SoundDoc): string {
  if (!doc.tracks.length) return (doc.render.file.split(/[\\/]/).pop() ?? doc.render.file).replace(/\.wav$/i, "");
  const first = sourceLabel(doc.tracks[0].source);
  return doc.tracks.length > 1 ? `${first} + ${doc.tracks.length - 1} more` : first;
}

/**
 * Voice lines live under localization\<language or common>\vo, vo_holocall, vo_helmet or vo_rewinded
 * (base and ep1), and their names end in _f_ or _m_ and 16 hex digits (V's gender, the line's id).
 * The name catches a copy outside the game's folders, such as an exported WAV. Checked on 2.31 over
 * all 119,857 .wem files: the folders hold every voice line, the name rule matches no other file.
 */
export function looksLikeVoice(path: string): boolean {
  if (/(^|[\\/])localization[\\/][^\\/]+[\\/]vo(_[a-z]+)?[\\/]/i.test(path)) return true;
  const name = path.split(/[\\/]/).pop() ?? "";
  return /_[fm]_[0-9a-f]{16}(?![0-9a-f])/i.test(name);
}
