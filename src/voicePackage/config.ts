// voices.json for EDGEwave Voice (src/voicePackage/core.ts): the ElevenLabs voices a mod may name. Pure, so
// the unit tests run it; src/voicePackage/install.ts writes it into the package in the game folder.

import { DefaultModel, type VoicesConfig } from "./core";

/** A short name a mod types for a voice: lower-case letters, digits and _, unique among `taken`. */
export function voiceName(label: string, taken: ReadonlySet<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/\(.*?\)|\[.*?\]/g, " ")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 32) || "voice";
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}_${n}`;
  return name;
}

/** voices.json for the voices picked: a voice already named keeps its name; the default stays if still there. */
export function voicesConfig(existing: VoicesConfig | undefined, picked: { id: string; label: string }[]): VoicesConfig {
  const voices: VoicesConfig["voices"] = {};
  const before = Object.entries(existing?.voices ?? {});
  const taken = new Set<string>();
  for (const p of picked) {
    const kept = before.find(([, v]) => v.id === p.id);
    const name = kept && !taken.has(kept[0]) ? kept[0] : voiceName(p.label, taken);
    taken.add(name);
    voices[name] = { ...(kept?.[1] ?? {}), id: p.id, label: p.label };
  }
  const names = Object.keys(voices);
  const config: VoicesConfig = { edgewave: "voices", version: 1, provider: "elevenlabs", model: existing?.model ?? DefaultModel, voices };
  const keep = existing?.default && names.includes(existing.default) ? existing.default : names[0];
  if (keep) config.default = keep;
  return config;
}
