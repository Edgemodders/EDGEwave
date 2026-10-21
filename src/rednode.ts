// REDnode sounds (EDGEwave #2): a REDnode package plays its own WAV, OGG, MP3 and FLAC files beside the
// game's sound, from its code (`audio.play(name)` in the `rednode` package), following the game's
// volume sliders. A package is a folder with a rednode-app.json manifest whose `sounds` map names a
// file and its settings. No REDmod, no pack step and no .wem, so it also takes voice lines. Pure, for
// the unit tests.
//
// Source: REDnode's docs, "Your own sounds" and "Node mods" (overlay-apps.md), and the request in
// EDGEwave #2: the manifest's fields, the categories and the settings.

/** The game volume slider a sound follows. */
export type SoundCategory = "sfx" | "dialogue" | "music";

export const SoundCategories: { category: SoundCategory; label: string; detail: string }[] = [
  { category: "sfx", label: "Sound effects", detail: "Follows the game's Sound effects slider" },
  { category: "dialogue", label: "Dialogue", detail: "Follows the Dialogue slider: voice lines" },
  { category: "music", label: "Music", detail: "Follows the Music slider; read as it plays" },
];

/** The manifest's file name in a package's folder. */
export const Manifest = "rednode-app.json";

/** Where packages live, under the game folder (and under source/resources in a project, which REDcode's Pack copies to the game folder). */
export const AppsDir = ["red4ext", "plugins", "REDnode", "apps"] as const;

/** A package id: lower case letters, digits and dashes, starting with a letter or digit. */
export function validId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(id);
}

/** A sound's name in the manifest, which is also its file's name: letters, digits, dashes and underscores. */
export function validSoundName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name);
}

/** A sound name from any text, such as the document's file name. */
export function soundNameFor(text: string): string {
  return text.replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^[_-]+|[_-]+$/g, "") || "sound";
}

/** The sound's file, relative to the package's folder. */
export function soundFile(name: string): string {
  return `sounds/${name}.wav`;
}

/** A new Node mod's manifest: it starts when it appears (`open`), so its sounds can play at once. */
export function newManifest(id: string, name: string): Record<string, unknown> {
  return { id, name, version: "0.1.0", description: "Sounds made in EDGEwave.", main: "mod.mjs", open: true, sounds: {} };
}

/** A new Node mod's code: plays the first sound once, as an example to build on. */
export function newModScript(sound: string): string {
  return [
    "import { audio } from 'rednode';",
    "",
    `// Plays the sound "${sound}" (rednode-app.json's sounds) once when the mod starts. Call audio.play`,
    "// where your mod needs it: on an event, a key, a quest step. https://edgemodders.github.io/REDnode/overlay-apps.html#your-own-sounds",
    `await audio.play(${JSON.stringify(sound)});`,
    "",
  ].join("\n");
}

/** The line that plays a sound from the package's code. */
export function playLine(sound: string): string {
  return `import { audio } from 'rednode';\nawait audio.play(${JSON.stringify(sound)});`;
}

/**
 * The manifest's text with the sound added, or its file and category changed. Its other settings
 * (volume, loop and so on, set by hand) and the manifest's other fields are kept; a name given as a
 * bare file becomes an object.
 */
export function upsertSound(text: string, name: string, category: SoundCategory): string {
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(text) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`${Manifest} is not valid JSON: ${(e as Error).message}`);
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error(`${Manifest} is not a JSON object`);
  const sounds = manifest.sounds && typeof manifest.sounds === "object" && !Array.isArray(manifest.sounds) ? (manifest.sounds as Record<string, unknown>) : {};
  const old = sounds[name];
  const kept = old && typeof old === "object" && !Array.isArray(old) ? (old as Record<string, unknown>) : {};
  manifest.sounds = { ...sounds, [name]: { ...kept, file: soundFile(name), category } };
  return JSON.stringify(manifest, null, 2) + "\n";
}

/** A package's id and name from its manifest's text, or undefined when it is not one. */
export function readManifest(text: string): { id: string; name: string; sounds: string[] } | undefined {
  try {
    const m = JSON.parse(text) as Record<string, unknown>;
    if (!m || typeof m !== "object" || typeof m.id !== "string") return undefined;
    const sounds = m.sounds && typeof m.sounds === "object" && !Array.isArray(m.sounds) ? Object.keys(m.sounds) : [];
    return { id: m.id, name: typeof m.name === "string" ? m.name : m.id, sounds };
  } catch {
    return undefined;
  }
}
