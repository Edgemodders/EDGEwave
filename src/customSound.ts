// A sound made in EDGEwave as a new sound event a quest can post (EDGEwave #7): a REDmod custom sound named
// edgewave_<name>, its WAV in the project's source/customSounds and its entry in source/resources/info.json,
// as Add to Project's REDmod route writes them. sfx is low occlusion (a quest sound that is not muffled); music
// is 2D, with no position, on the effects slider: REDmod has no music type. No VS Code, for the MCP server.

import * as fs from "node:fs";
import * as path from "node:path";
import type { Audio } from "./audio/edits";
import { decodeWav, encodeWav } from "./audio/wav";
import { customEventName } from "./events";
import { soundFileFor, upsertCustomSound, type CustomSound, type RedmodType } from "./redmod";

export interface CustomSoundResult {
  event: string;
  /** The WAV, relative to the project's folder. */
  file: string;
  type: RedmodType;
}

export function makeCustomSound(o: { projectDir: string; wav: string | Uint8Array; name: string; kind?: "sfx" | "music" }): CustomSoundResult {
  const event = customEventName(o.name);
  const bytes = typeof o.wav === "string" ? fs.readFileSync(path.isAbsolute(o.wav) ? o.wav : path.join(o.projectDir, o.wav)) : o.wav;
  let wav: Uint8Array;
  try {
    wav = to48k(bytes);
  } catch (e) {
    throw new Error(`The sound must be a 16-bit PCM WAV: ${(e as Error).message}`);
  }
  const type: RedmodType = o.kind === "music" ? "mod_sfx_2d" : "mod_sfx_low_occlusion";
  const out = path.join(o.projectDir, "source", "customSounds", soundFileFor(event));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, wav);
  const info = path.join(o.projectDir, "source", "resources", "info.json");
  fs.mkdirSync(path.dirname(info), { recursive: true });
  fs.writeFileSync(info, upsertCustomSound(fs.existsSync(info) ? fs.readFileSync(info, "utf8") : undefined, { name: event, type, file: path.basename(out), gain: 1, pitch: 0 }));
  return { event, file: path.relative(o.projectDir, out).replace(/\\/g, "/"), type };
}

/** A named sound in a project: a REDmod custom sound in source/resources/info.json, its WAV in source/customSounds. */
export interface ProjectSound {
  /** The event name the game, quests, scenes and scripts play it by. */
  name: string;
  type: RedmodType;
  /** The WAV, relative to the project's folder; absent for mod_skip. */
  file?: string;
  /** Its length, from the WAV's header; absent when the file is missing or not a WAV. */
  seconds?: number;
  /** The WAV is not there. */
  missing?: boolean;
}

/** The project's named sounds, in info.json's order; none when it has no info.json. Throws when info.json is not valid JSON. */
export function projectSounds(projectDir: string): ProjectSound[] {
  const info = path.join(projectDir, "source", "resources", "info.json");
  if (!fs.existsSync(info)) return [];
  const text = fs.readFileSync(info, "utf8");
  if (!text.trim()) return [];
  let parsed: { customSounds?: unknown };
  try {
    parsed = JSON.parse(text) as { customSounds?: unknown };
  } catch (e) {
    throw new Error(`${path.relative(projectDir, info)} is not valid JSON: ${(e as Error).message}`);
  }
  const list = Array.isArray(parsed?.customSounds) ? (parsed.customSounds as Partial<CustomSound>[]) : [];
  return list.flatMap((c): ProjectSound[] => {
    if (!c || typeof c.name !== "string" || !c.name) return [];
    const s: ProjectSound = { name: c.name, type: (c.type ?? "mod_sfx_2d") as RedmodType };
    if (typeof c.file === "string" && c.file) {
      const abs = path.join(projectDir, "source", "customSounds", c.file);
      s.file = path.relative(projectDir, abs).replace(/\\/g, "/");
      try {
        s.seconds = wavSeconds(fs.readFileSync(abs));
      } catch {
        if (!fs.existsSync(abs)) s.missing = true;
      }
    }
    return [s];
  });
}

/** A PCM WAV's length in seconds, from its fmt and data chunks. */
export function wavSeconds(b: Uint8Array): number {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (b.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("Not a WAV file");
  let byteRate = 0;
  for (let o = 12; o + 8 <= b.length; ) {
    const size = v.getUint32(o + 4, true);
    if (tag(o) === "fmt ") byteRate = v.getUint32(o + 16, true);
    else if (tag(o) === "data") {
      if (!byteRate) throw new Error("The WAV has no format before its data");
      return Math.round((Math.min(size, b.length - o - 8) / byteRate) * 1000) / 1000;
    }
    o += 8 + size + (size & 1);
  }
  throw new Error("The WAV file has no data");
}

/** What a modder needs to know to hear it. */
export function customSoundNote(kind: "sfx" | "music" | undefined, redmodPacked: boolean): string {
  return [
    redmodPacked ? "" : "REDcode packs REDmod custom sounds only with the redcode.pack.redmod setting on.",
    kind === "music" ? "REDmod has no music type: it plays as a 2D sound on the effects slider." : "",
    "The game reads it when it starts: Pack and Install, then restart the game.",
  ].filter(Boolean).join(" ");
}

/** The WAV as the game's 48 kHz 16-bit PCM (REDmod's custom sounds were tested at 48 kHz), its channels kept. */
export function to48k(bytes: Uint8Array): Uint8Array {
  const a = decodeWav(bytes);
  if (a.sampleRate === 48000) return bytes;
  const ratio = a.sampleRate / 48000;
  const n = Math.floor(a.channels[0].length / ratio);
  const out: Audio = {
    sampleRate: 48000,
    channels: a.channels.map((c) => {
      const o = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = i * ratio;
        const j = Math.floor(x);
        const f = x - j;
        o[i] = c[j] * (1 - f) + (c[j + 1] ?? c[j]) * f;
      }
      return o;
    }),
  };
  return encodeWav(out);
}
