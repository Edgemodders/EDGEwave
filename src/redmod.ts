// REDmod custom sounds: a mod's info.json lists customSounds, each an audio event by name that the
// game plays from a WAV in the mod's customSounds folder (or skips). In a WolvenKit project the
// entries live in source/resources/info.json and the WAVs in source/customSounds, as WolvenKit's
// Sound Modding tool writes them. Pure, for the unit tests.
//
// Sources: REDmod's own messages and fields in tools/redmod/bin/redMod.exe (customSounds, name, type,
// file, gain, pitch; the WAV is validated), the mod_sfx_* events in WolvenKit's event list, and the
// REDmodding wiki's Audio Modding page (the types' meanings; gain and pitch from 0 to 1).

export type RedmodType =
  | "mod_skip"
  | "mod_sfx_2d"
  | "mod_sfx_city"
  | "mod_sfx_low_occlusion"
  | "mod_sfx_occlusion"
  | "mod_sfx_radio"
  | "mod_sfx_room"
  | "mod_sfx_street"
  | "mod_sfx_ui";

/** How the game plays each type, in the wiki's words. mod_skip is a silence, with no file. */
export const RedmodTypes: { type: Exclude<RedmodType, "mod_skip">; label: string; detail: string }[] = [
  { type: "mod_sfx_2d", label: "2D", detail: "Played without any position or attenuation" },
  { type: "mod_sfx_occlusion", label: "Occlusion", detail: "Medium attenuation with normal occlusion" },
  { type: "mod_sfx_low_occlusion", label: "Low occlusion", detail: "A long attenuation that is not occluded much, such as a voice-over or quest sound" },
  { type: "mod_sfx_room", label: "Room", detail: "A shorter attenuation, heard across a room" },
  { type: "mod_sfx_street", label: "Street", detail: "A medium attenuation, heard down a street" },
  { type: "mod_sfx_city", label: "City", detail: "A longer attenuation, for city sounds" },
  { type: "mod_sfx_radio", label: "Radio", detail: "Needs to be tuned to a broadcast channel" },
  { type: "mod_sfx_ui", label: "UI", detail: "Menu and UI sounds (on the wiki; not in WolvenKit's event list, unverified)" },
];

export interface CustomSound {
  name: string;
  type: RedmodType;
  /** Relative to the mod's customSounds folder; absent for mod_skip. */
  file?: string;
  /** 0 to 1. */
  gain?: number;
  /** Pitch variance, 0 to 1. */
  pitch?: number;
}

/** A WAV file name for an event, safe on Windows. */
export function soundFileFor(event: string): string {
  return `${event.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")}.wav`;
}

/**
 * info.json's text with this custom sound added, or replacing the entry for the same event. Other
 * fields and entries are kept; a missing or empty file becomes { customSounds: [...] }.
 */
export function upsertCustomSound(text: string | undefined, entry: CustomSound): string {
  let info: Record<string, unknown> = {};
  if (text && text.trim()) {
    try {
      info = JSON.parse(text) as Record<string, unknown>;
    } catch (e) {
      throw new Error(`info.json is not valid JSON: ${(e as Error).message}`);
    }
    if (!info || typeof info !== "object" || Array.isArray(info)) throw new Error("info.json is not a JSON object");
  }
  const list = Array.isArray(info.customSounds) ? (info.customSounds as CustomSound[]) : [];
  const clean: CustomSound = entry.type === "mod_skip" ? { name: entry.name, type: "mod_skip" } : { name: entry.name, type: entry.type, file: entry.file, gain: clamp01(entry.gain ?? 1), pitch: clamp01(entry.pitch ?? 0) };
  const others = list.filter((s) => s?.name?.toLowerCase() !== entry.name.toLowerCase());
  info.customSounds = [...others, clean];
  return JSON.stringify(info, null, 2) + "\n";
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
