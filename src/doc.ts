// The sound document: a .edgewave file, JSON that names a source and lists the edits, never the
// audio. No VS Code or Node imports, so the editor page uses it too.

/** Where the sound comes from. Fetched again (through REDcode for the game) each time the document opens. */
export type Source =
  /** A game file, such as a voice line .wem, by its path in the archives. */
  | { kind: "game"; path: string }
  /** A sound effect in the game's sfx_container.opusinfo. */
  | { kind: "sfx"; soundHash: number; eventHash?: number; eventName?: string }
  /** A file, relative to the document's folder (or absolute). */
  | { kind: "file"; file: string };

/** Times are seconds on the sound as it is after the edits before this one. */
export type Edit =
  /** Keep only start to end. */
  | { op: "trim"; start: number; end: number }
  /** Remove start to end. */
  | { op: "cut"; start: number; end: number }
  /** Insert a copy of from.start to from.end at at. */
  | { op: "paste"; at: number; from: { start: number; end: number } }
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

export interface Render {
  /** The WAV the render writes, relative to the document's folder. */
  file: string;
  /** Hz; the source's rate when absent. */
  sampleRate?: number;
}

export interface SoundDoc {
  edgewave: 1;
  source: Source;
  /** A voice line: shows Translate and Re-Voice. */
  voice?: boolean;
  edits: Edit[];
  /** Loop points for playback, seconds on the edited sound. */
  loop?: { start: number; end: number } | null;
  render: Render;
}

export const Extension = ".edgewave";

/** A document from its text; throws with a readable message when it is not one. */
export function parseDoc(text: string): SoundDoc {
  let d: unknown;
  try {
    d = JSON.parse(text);
  } catch (e) {
    throw new Error(`Not valid JSON: ${(e as Error).message}`);
  }
  const doc = d as Partial<SoundDoc>;
  if (!doc || typeof doc !== "object" || doc.edgewave !== 1) throw new Error('Not an EDGEwave sound document ("edgewave": 1 is missing)');
  const s = doc.source as Partial<Source> | undefined;
  const ok =
    s &&
    ((s.kind === "game" && typeof (s as { path?: unknown }).path === "string") ||
      (s.kind === "sfx" && typeof (s as { soundHash?: unknown }).soundHash === "number") ||
      (s.kind === "file" && typeof (s as { file?: unknown }).file === "string"));
  if (!ok) throw new Error("The document's source is missing or not one of game, sfx or file");
  if (!Array.isArray(doc.edits)) throw new Error("The document's edits are missing");
  if (!doc.render || typeof doc.render.file !== "string") throw new Error("The document's render file is missing");
  return doc as SoundDoc;
}

/** The text of a document, as the editor writes it. */
export function formatDoc(doc: SoundDoc): string {
  return JSON.stringify(doc, null, 2) + "\n";
}

/** A short name for the source, for titles. */
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

/** Voice lines live under localization\<language>\vo (and ep1's). */
export function looksLikeVoice(gamePath: string): boolean {
  return /(^|[\\/])localization[\\/][^\\/]+[\\/]vo[\\/]/i.test(gamePath);
}
