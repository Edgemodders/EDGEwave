// A sound made in EDGEwave as a new sound event a quest can post (EDGEwave #7): a REDmod custom sound named
// edgewave_<name>, its WAV in the project's source/customSounds and its entry in source/resources/info.json,
// as Into the Game's REDmod route writes them. sfx is low occlusion (a quest sound that is not muffled); music
// is 2D, with no position, on the effects slider: REDmod has no music type. No VS Code, for the MCP server.

import * as fs from "node:fs";
import * as path from "node:path";
import type { Audio } from "./audio/edits";
import { decodeWav, encodeWav } from "./audio/wav";
import { customEventName } from "./events";
import { soundFileFor, upsertCustomSound, type RedmodType } from "./redmod";

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
