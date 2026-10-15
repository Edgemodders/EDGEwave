// REDcode, which EDGEwave builds on (extensionDependencies). Found at runtime and never imported:
// the interfaces below copy the contract of REDcodeApi version 1 (REDcode 0.9.0,
// extensions/redcode/src/api.ts there; https://edgemodders.github.io/REDcode/api.html).

import * as vscode from "vscode";

export const REDcodeId = "edgemodders.redcode-cyberpunk";

/** A sound: a game file by path, a sound effect by hash, or a file by URI. edgewave.openSound takes the same. */
export interface SoundRef {
  /** A game file, such as a voice line: base\localization\en-us\vo\....wem. */
  path?: string;
  /** A sound effect in the game's sfx_container.opusinfo, by its hash. */
  soundHash?: number;
  /** The event the sound effect belongs to, when known. */
  eventHash?: number;
  /** A file on disk or a redcode-game: URI, as a URI string. */
  uri?: string;
}

/** A sound as audio a webview can decode: WAV for anything that was Opus, Ogg Vorbis for a .wem. */
export interface SoundAudio {
  data: Uint8Array;
  mime: string;
  codec: string;
  channels?: number;
  sampleRate?: number;
  name: string;
}

export interface SoundEventInfo {
  hash: number;
  name: string | null;
  tags: string[];
  sounds: number[];
}

export interface ProjectRef {
  name: string;
  modName: string;
  file: string;
  dir: string;
  archive: string;
  raw: string;
  resources: string;
  packed: string;
}

export interface REDcodeApi {
  readonly apiVersion: 1;
  readonly version: string;
  /** REDcode's REDbridge client; EDGEwave does not use it directly yet. */
  bridge(): unknown;
  gamePath(): string | undefined;
  project(): ProjectRef | undefined;
  readonly onDidChangeProject: vscode.Event<ProjectRef | undefined>;
  soundIndex(): Promise<{ count: number; events: SoundEventInfo[] }>;
  sound(ref: SoundRef): Promise<SoundAudio>;
  importFile(file: string): Promise<{ ok: boolean; written: string[] }>;
  pack(): Promise<{ packedDir: string; archive?: string; archiveFiles: number }>;
}

/** REDcode's API, activating REDcode if needed. Throws with a message for the user when it is missing or too old. */
export async function redcode(): Promise<REDcodeApi> {
  const ext = vscode.extensions.getExtension<Partial<REDcodeApi> | undefined>(REDcodeId);
  if (!ext) throw new Error("EDGEwave needs REDcode for Cyberpunk 2077 (edgemodders.redcode-cyberpunk). Install it from the Marketplace.");
  const api = ext.isActive ? ext.exports : await ext.activate();
  if (!api || api.apiVersion !== 1 || typeof api.sound !== "function") {
    const version = String((ext.packageJSON as { version?: string }).version ?? "unknown");
    throw new Error(`EDGEwave needs REDcode 0.9.0 or later, with its API version 1; REDcode ${version} is installed. Update REDcode.`);
  }
  return api as REDcodeApi;
}
