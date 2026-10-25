// Add to Project (A3): puts the mix (the tracks whose lanes are checked) into the open REDcode project,
// in a layout the game loads, for REDcode's pack. What it replaces is a separate choice: any game sound
// effect on a track, those in the mix first, so a mix of a game sound and a file can override that sound.
// The routes, chosen in a quick pick and remembered in the document (doc.game):
//
// - A new sound for the project (first): a REDmod custom sound under a new event name, edgewave_<name>
//   by default, which quests, scenes and scripts play by that name. Replaces nothing. The project's
//   named sounds are listed in the Sounds view and by soundEvents, for other tools to pick.
// - Override one sound effect variation: a 48 kHz WAV with the original's channels, named after the
//   sound's hash, imported by REDcode (REDbridge's sound.importWavs writes the .opuspak and
//   sfx_container.opusinfo into source/archive). Exact, but mods that do this do not combine: each
//   carries the one shared index, so the last loaded wins.
// - A REDmod custom sound: the WAV in source/customSounds and an entry in source/resources/info.json,
//   as WolvenKit's Sound Modding tool writes them. Replaces an audio event, every variation, beside
//   other mods; the event's own Wwise logic is dropped. Silence is the same with a silent WAV, since
//   REDmod's mod_skip did not silence an event in the hand test.
// - A REDnode sound (EDGEwave #2): the WAV in a REDnode package's sounds folder and its manifest's
//   sounds map, played where the package's code calls audio.play, beside the game's sound. Replaces
//   nothing, and takes voice lines too (src/rednode.ts).
//
// Voice lines (.wem) have no route in place of a game line yet: nothing here makes a .wem.

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { audible } from "./audio/mix";
import { formatDoc, looksLikeVoice, parseDoc, sourceLabel, type IntoGame, type SoundDoc, type Track } from "./doc";
import { projectSounds } from "./customSound";
import { customEventName } from "./events";
import { redcode, type ProjectRef, type REDcodeApi } from "./redcode";
import { RedmodTypes, silenced, soundFileFor, upsertCustomSound, type RedmodType } from "./redmod";
import { readIndex } from "./soundEvents";
import { AppsDir, Manifest, newManifest, newModScript, playLine, readManifest, SoundCategories, soundFile, soundNameFor, upsertSound, validId, validSoundName } from "./rednode";

/** Renders the mix through the page at a rate, with a track's source's channels ({track}: the sound it replaces) or a count. */
export type RenderFor = (rate: number, channels: { track: string } | 1 | 2) => Promise<Uint8Array>;

type Route = IntoGame["route"] | "redmodNamed";
type Item = vscode.QuickPickItem & { route?: Route; track?: Track; soundHash?: number; event?: string };

const Rate = 48000;

/** A sound effect track: what an override or a REDmod event can replace. */
type SfxTrack = Track & { source: Extract<Track["source"], { kind: "sfx" }> };

/**
 * The quick pick's items: for each game sound effect on a track, its override and its event's routes,
 * under the track's name. The tracks in the mix first, in the mixer's order; then a custom sound for
 * a named event; then the tracks out of the mix (still targets: a muted game sound can name what a
 * file in the mix replaces). The last choice is marked where it is, never moved.
 */
function routes(doc: SoundDoc): Item[] {
  const inMix = new Set(audible(doc.tracks).map((t) => t.id));
  const sfx = (t: Track): t is SfxTrack => t.source.kind === "sfx";
  const items: Item[] = [
    { label: "This project", kind: vscode.QuickPickItemKind.Separator },
    {
      label: "$(add) A new sound for this project…",
      detail: "Name it, and quests, scenes and scripts play it by that name, as a REDmod custom sound. Replaces nothing. EDGEquest and EDGEwave's Sounds view list it.",
      route: "new",
    },
  ];
  const hashes = new Set<number>();
  const events = new Set<string>();
  const group = (t: SfxTrack) => {
    const { soundHash, eventName } = t.source;
    const group: Item[] = [];
    if (!hashes.has(soundHash)) {
      hashes.add(soundHash);
      group.push({
        label: `$(replace) Override sound ${soundHash}`,
        description: eventName,
        detail: "Exactly this sound, in its .opuspak. Mods that override sounds this way do not work together: the last one loaded wins.",
        route: "override",
        track: t,
        soundHash,
      });
    }
    if (eventName && !events.has(eventName)) {
      events.add(eventName);
      group.push(
        { label: `$(package) Replace the event ${eventName}, every variation, with REDmod`, detail: "The game plays this mix in place of each of the event's sounds. Works beside other mods; the event's own Wwise logic is dropped.", route: "redmod", track: t, event: eventName },
        { label: `$(mute) Silence the event ${eventName}, every variation, with REDmod`, detail: "The game plays silence in place of the event's sounds: this mix, as long and in the same format, with every sample zeroed.", route: "skip", track: t, event: eventName },
      );
    }
    if (!group.length) return;
    const n = doc.tracks.indexOf(t) + 1;
    items.push({ label: `Track ${n} · ${sourceLabel(t.source)}${inMix.has(t.id) ? "" : " · not in the mix"}`, kind: vscode.QuickPickItemKind.Separator }, ...group);
  };
  for (const t of doc.tracks) if (inMix.has(t.id) && sfx(t)) group(t);
  // Tracks in the mix with no game sound of their own (a file, a generated sound, a voice line).
  const own = doc.tracks.filter((t) => inMix.has(t.id) && !sfx(t)).map((t) => `track ${doc.tracks.indexOf(t) + 1}`);
  const none = own.length && !doc.tracks.some((t) => inMix.has(t.id) && sfx(t));
  items.push(
    { label: "Any game event", kind: vscode.QuickPickItemKind.Separator },
    {
      label: "$(package) Replace a game event by name…",
      detail: none
        ? `No track in the mix is a game sound effect (${own.join(", ")}): name the game's event this mix plays in place of (EDGEwave's Game Assets and REDcode's sound list show the names), or add the sound it replaces as a track.`
        : "Name the game's event this mix plays in place of, every variation, with REDmod (EDGEwave's Game Assets and REDcode's sound list show the names).",
      route: "redmodNamed",
    },
  );
  for (const t of doc.tracks) if (!inMix.has(t.id) && sfx(t)) group(t);
  items.push(
    { label: "REDnode", kind: vscode.QuickPickItemKind.Separator },
    {
      label: "$(play) In a REDnode package, for its code to play…",
      detail: "Only that package's code plays it (audio.play), beside the game's sound; quests cannot post it. No REDmod and no .wem, so voice lines too. Needs REDnode in the game.",
      route: "rednode",
    },
  );
  // Marked in its label and its group's heading: a description is small, dim and cut off first.
  const chosen = lastItem(items, doc.game);
  if (chosen) {
    chosen.label += " · last time";
    const heading = items.slice(0, items.indexOf(chosen)).reverse().find((i) => i.kind === vscode.QuickPickItemKind.Separator);
    if (heading) heading.label += " · last time";
  }
  return items;
}

/** The item for the last choice, if this document still offers it. */
function lastItem(items: Item[], last: IntoGame | undefined): Item | undefined {
  if (!last) return undefined;
  if (last.route === "override") return items.find((i) => i.route === "override" && (last.soundHash === undefined || i.soundHash === last.soundHash));
  if (last.route === "rednode") return items.find((i) => i.route === "rednode");
  if (last.route === "new") return items.find((i) => i.route === "new");
  return items.find((i) => i.route === last.route && i.event === last.event) ?? items.find((i) => i.route === "redmodNamed" && last.route === "redmod");
}

export async function intoGame(document: vscode.TextDocument, renderFor: RenderFor, log: vscode.OutputChannel): Promise<void> {
  const api = await redcode();
  const project = api.project();
  if (!project) throw new Error("Open a REDcode project first: Add to Project writes into its source folders.");
  if (document.isDirty) await document.save();
  const doc = parseDoc(document.getText());
  const inMix = audible(doc.tracks);
  if (!inMix.length) throw new Error("No track is in the mix: check a track's box in the lanes to put it in.");

  // A voice line in the mix, and no sound effect to put the mix in place of.
  if (!inMix.some((t) => t.source.kind === "sfx") && inMix.some((t) => t.voice || (t.source.kind === "game" && looksLikeVoice(t.source.path)))) {
    void vscode.window.showInformationMessage(
      "Voice lines cannot replace a game line yet: a .wem needs Wwise to make, which EDGEwave does not have. A REDnode package can play this mix from its code, and a REDmod custom sound for an audio event.",
    );
  }

  const chosen = await vscode.window.showQuickPick(routes(doc), { title: "Add to Project: what should the mix replace?" });
  if (!chosen?.route) return;
  if (chosen.route === "rednode") return asRednodeSound(document, doc, project, api.gamePath(), renderFor, log);
  if (chosen.route === "new") return newProjectSound(document, doc, project, api, { track: inMix[0].id }, renderFor, log);
  // The channels of the sound replaced; for a named event, the first track in the mix.
  const channels = { track: (chosen.track ?? inMix[0]).id };

  let game: IntoGame;
  let done: string;
  if (chosen.route === "override") {
    const hash = chosen.soundHash!;
    const wav = await renderFor(Rate, channels);
    const file = overrideFile(document, project, hash);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, wav);
    const r = await api.importFile(file);
    if (!r.ok) throw new Error(`REDcode could not import ${path.basename(file)}; see REDcode's output.`);
    log.appendLine(`Add to Project: sound ${hash} from ${file} into ${r.written.join(", ")}`);
    game = { route: "override", soundHash: hash };
    done = `Sound ${hash} now overrides the game's, in ${r.written.map((w) => path.relative(project.dir, w)).join(", ")}.`;
  } else {
    let name = chosen.event;
    if (chosen.route === "redmodNamed" || !name) {
      name = (await vscode.window.showInputBox({ title: "Add to Project: the audio event", prompt: "The event the game should play this mix for", value: doc.game && "event" in doc.game ? doc.game.event : "" }))?.trim();
      if (!name) return;
    }
    const info = path.join(project.resources, "info.json");
    const out = path.join(project.dir, "source", "customSounds", soundFileFor(name));
    if (!(await mayReplace(out, name, doc.game))) return;
    // Silence is a replacement like any other, with the samples zeroed: same type, gain, rate, channels
    // and length as a replacement that plays (the hand test: a 0.1 s mono 2D silence at gain 0 did not take).
    const silence = chosen.route === "skip";
    const lastType = doc.game?.route === "redmod" || doc.game?.route === "skip" ? doc.game.type : undefined;
    const types = [...RedmodTypes].sort((a, b) => Number(b.type === lastType) - Number(a.type === lastType));
    const t = await vscode.window.showQuickPick(
      types.map((x) => ({ label: x.label, description: x.type, detail: x.detail, type: x.type })),
      { title: silence ? `Add to Project: how does the game play ${name}? (the silence takes its place)` : `Add to Project: how should the game play ${name}?` },
    );
    if (!t) return;
    const gain = doc.game?.route === "redmod" ? doc.game.gain : 1;
    const pitch = doc.game?.route === "redmod" ? doc.game.pitch : 0;
    // REDmod checks the WAV's format; which rates it takes is unverified, so the game's own 48 kHz.
    const mix = await renderFor(Rate, channels);
    const wav = silence ? silenced(mix) : mix;
    const file = path.basename(out);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, wav);
    writeInfo(info, upsertCustomSound(readMaybe(info), { name, type: t.type, file, gain, pitch }));
    game = silence ? { route: "skip", event: name, type: t.type } : { route: "redmod", event: name, type: t.type, gain, pitch };
    done = silence
      ? `REDmod will play silence for ${name}, as ${t.type}: ${path.relative(project.dir, out)} (in ${path.relative(project.dir, info)}).`
      : `REDmod will play ${path.relative(project.dir, out)} for ${name}, as ${t.type} (in ${path.relative(project.dir, info)}).`;
    log.appendLine(`Add to Project: ${done}`);
  }

  await remember(document, doc, game);
  const redmodOff = game.route !== "override" && !vscode.workspace.getConfiguration("redcode").get<boolean>("pack.redmod", false);
  const note = redmodOff ? " REDmod custom sounds need REDcode to pack the mod as a REDmod (the redcode.pack.redmod setting)." : "";
  // The game reads its sound at start (EDGEwave #4): an override's sound paks crash a running game when
  // hot-deployed, and REDmod deploys custom sounds when the game starts. So install, then restart.
  const hear = game.route === "override"
    ? " To hear it: Pack and Install, then restart the game. Don't hot-deploy it (Pack and Try): a sound archive in Red Hot Tools' hot folder crashes the running game."
    : " To hear it: Pack and Install, then restart the game; REDmod deploys custom sounds when the game starts.";
  const actions = redmodOff ? ["Pack and Install", "Pack", "Open Setting"] : ["Pack and Install", "Pack"];
  const pick = await vscode.window.showInformationMessage(`${done}${note}${hear}`, ...actions);
  if (pick === "Open Setting") await vscode.commands.executeCommand("workbench.action.openSettings", "redcode.pack.redmod");
  else if (pick === "Pack and Install") await vscode.commands.executeCommand("redcode.packAndInstall");
  else if (pick === "Pack") {
    const r = await api.pack();
    void vscode.window.showInformationMessage(`REDcode packed the mod into ${path.relative(project.dir, r.packedDir) || r.packedDir}.`);
  }
}

/** The plain choices for a new sound's type, then the rest of REDmod's. */
const NewTypes: { type: RedmodType; label: string; detail: string }[] = [
  { type: "mod_sfx_low_occlusion", label: "A sound effect, heard from where it plays", detail: "Fades with distance and is not muffled much: a quest or scene sound, a voice-over (REDmod's low occlusion)" },
  { type: "mod_sfx_2d", label: "The same everywhere (2D)", detail: "No position: music, a phone or interface sound, a sound in V's head. On the effects slider: REDmod has no music type" },
];

/** Add to Project > A new sound for this project: the mix as a REDmod custom sound under a new event name. */
async function newProjectSound(document: vscode.TextDocument, doc: SoundDoc, project: ProjectRef, api: REDcodeApi, channels: { track: string }, renderFor: RenderFor, log: vscode.OutputChannel): Promise<void> {
  const last = doc.game?.route === "new" ? doc.game : undefined;
  const gameEvents = new Set((readIndex(api.gamePath())?.events ?? []).map((e) => e.name.toLowerCase()));
  const mine = new Map(projectSoundsOf(project.dir).map((s) => [s.name.toLowerCase(), s]));
  let suggested = last?.event;
  if (!suggested) {
    try {
      suggested = customEventName(path.basename(document.uri.fsPath, path.extname(document.uri.fsPath)));
    } catch {
      suggested = "edgewave_sound";
    }
  }
  const name = (
    await vscode.window.showInputBox({
      title: "A new sound for this project: its name",
      prompt: "Quests, scenes and scripts play it by this name. Letters, digits and _; edgewave_ in front keeps it apart from the game's own events",
      value: suggested,
      valueSelection: suggested.startsWith("edgewave_") ? [9, suggested.length] : undefined,
      validateInput: (v) => {
        const n = v.trim();
        if (!/^[a-z0-9_]+$/i.test(n)) return "Letters, digits and _ only";
        if (gameEvents.has(n.toLowerCase())) return { message: `${n} is one of the game's events: the game would play this in place of it. Pick another name, or use Replace a game event.`, severity: vscode.InputBoxValidationSeverity.Error };
        const had = mine.get(n.toLowerCase());
        if (had && n.toLowerCase() !== last?.event.toLowerCase()) return { message: `The project has a sound named ${n} already (${had.file ?? had.type}); this one would take its place.`, severity: vscode.InputBoxValidationSeverity.Warning };
        return undefined;
      },
    })
  )?.trim();
  if (!name) return;
  type TypeItem = vscode.QuickPickItem & { type?: RedmodType; more?: boolean };
  const lastType = last?.type ?? mine.get(name.toLowerCase())?.type;
  const plain: TypeItem[] = NewTypes.map((t) => ({ label: t.label + (t.type === lastType ? " · last time" : ""), description: t.type, detail: t.detail, type: t.type }));
  plain.sort((a, b) => Number(b.type === lastType) - Number(a.type === lastType));
  let t: TypeItem | undefined = await vscode.window.showQuickPick([...plain, { label: "$(list-unordered) Another of REDmod's types…", more: true }], { title: `A new sound for this project: how does the game play ${name}?` });
  if (t?.more) t = await vscode.window.showQuickPick(RedmodTypes.map((x): TypeItem => ({ label: x.label, description: x.type, detail: x.detail, type: x.type })), { title: `How does the game play ${name}?` });
  if (!t?.type) return;
  const out = path.join(project.dir, "source", "customSounds", soundFileFor(name));
  if (!(await mayReplace(out, name, doc.game))) return;
  const wav = await renderFor(Rate, channels);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, wav);
  const info = path.join(project.resources, "info.json");
  writeInfo(info, upsertCustomSound(readMaybe(info), { name, type: t.type, file: path.basename(out), gain: 1, pitch: 0 }));
  log.appendLine(`Add to Project: a new sound ${name} (${t.type}) in ${path.relative(project.dir, out)}`);
  await remember(document, doc, { route: "new", event: name, type: t.type });
  const redmodOff = !vscode.workspace.getConfiguration("redcode").get<boolean>("pack.redmod", false);
  const note = redmodOff ? " REDcode packs it only as a REDmod (the redcode.pack.redmod setting)." : "";
  const actions = ["Copy Name", "Pack and Install", ...(redmodOff ? ["Open Setting"] : [])];
  void vscode.commands.executeCommand("edgewave.refreshSounds");
  const pick = await vscode.window.showInformationMessage(
    `${name} is a sound in the project now: a quest, scene or script plays it by that name (${path.relative(project.dir, out)}, ${t.type}).${note} To hear it in the game: Pack and Install, then restart the game; REDmod reads custom sounds when the game starts.`,
    ...actions,
  );
  if (pick === "Copy Name") await vscode.env.clipboard.writeText(name);
  else if (pick === "Open Setting") await vscode.commands.executeCommand("workbench.action.openSettings", "redcode.pack.redmod");
  else if (pick === "Pack and Install") await vscode.commands.executeCommand("redcode.packAndInstall");
}

/** The project's named sounds, or none when its info.json cannot be read. */
function projectSoundsOf(dir: string) {
  try {
    return projectSounds(dir);
  } catch {
    return [];
  }
}

/** A REDnode package: in the project (source/resources, which Pack copies to the game folder) or in the game folder itself. */
type Pkg = { dir: string; id: string; name: string; where: "project" | "game"; isNew?: boolean };

/** The packages in an apps folder: each subfolder with a manifest that has an id. */
function packagesIn(root: string, where: Pkg["where"]): Pkg[] {
  const apps = path.join(root, ...AppsDir);
  if (!fs.existsSync(apps)) return [];
  return fs.readdirSync(apps, { withFileTypes: true }).flatMap((d) => {
    const dir = path.join(apps, d.name);
    const m = d.isDirectory() ? readManifest(readMaybe(path.join(dir, Manifest)) ?? "") : undefined;
    return m ? [{ dir, id: m.id, name: m.name, where }] : [];
  });
}

/** The package to write into: one found, the last one first, or a new one (made only once the rest is chosen). */
async function pickPackage(project: ProjectRef, gamePath: string | undefined, last: string | undefined): Promise<Pkg | undefined> {
  const rednode = gamePath && fs.existsSync(path.join(gamePath, ...AppsDir.slice(0, 3))) ? gamePath : undefined;
  const found = [...packagesIn(project.resources, "project"), ...(rednode ? packagesIn(rednode, "game") : [])];
  const lastDir = last && path.resolve(project.dir, last).toLowerCase();
  found.sort((a, b) => Number(b.dir.toLowerCase() === lastDir) - Number(a.dir.toLowerCase() === lastDir));
  const where = {
    project: "In the project: Pack and Install puts it in the game folder with your mod",
    game: "In the game folder, not in your mod: REDnode plays it at once, for trying a sound out; Pack does not carry it",
  };
  type PkgItem = vscode.QuickPickItem & { pkg?: Pkg; make?: Pkg["where"] };
  const items: PkgItem[] = found.map((p) => ({
    label: `$(package) ${p.name}${p.dir.toLowerCase() === lastDir ? " · last time" : ""}`,
    description: p.id,
    detail: where[p.where],
    pkg: p,
  }));
  items.push({ label: "$(add) New package in the project…", detail: `A Node mod under ${path.relative(project.dir, path.join(project.resources, ...AppsDir))}, which REDcode packs with your mod`, make: "project" });
  if (rednode) items.push({ label: "$(add) New package in the game folder…", detail: "A Node mod in REDnode's apps folder, for trying a sound out; not in your mod", make: "game" });
  const pick = await vscode.window.showQuickPick(items, { title: "As a REDnode sound: which package plays it?" });
  if (!pick) return undefined;
  if (pick.pkg) return pick.pkg;
  const root = pick.make === "game" ? rednode! : project.resources;
  const suggested = project.modName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "my-sounds";
  const id = (
    await vscode.window.showInputBox({
      title: "As a REDnode sound: the new package's id",
      prompt: "Lower case letters, digits and dashes; also its folder's name",
      value: suggested,
      validateInput: (v) => (!validId(v.trim()) ? "Lower case letters, digits and dashes, starting with a letter or digit" : fs.existsSync(path.join(root, ...AppsDir, v.trim())) ? "A folder of that name is there already" : undefined),
    })
  )?.trim();
  if (!id) return undefined;
  return { dir: path.join(root, ...AppsDir, id), id, name: project.modName || id, where: pick.make!, isNew: true };
}

/** Add to Project > As a REDnode sound: the render in a package's sounds folder and manifest. */
async function asRednodeSound(document: vscode.TextDocument, doc: SoundDoc, project: ProjectRef, gamePath: string | undefined, renderFor: RenderFor, log: vscode.OutputChannel) {
  const last = doc.game?.route === "rednode" ? doc.game : undefined;
  const pkg = await pickPackage(project, gamePath, last?.package);
  if (!pkg) return;
  const sound = (
    await vscode.window.showInputBox({
      title: "As a REDnode sound: its name",
      prompt: `The name the package's code plays it by, audio.play(name); the file is ${soundFile("<name>")}`,
      value: last?.sound ?? soundNameFor(path.basename(document.uri.fsPath)),
      validateInput: (v) => (validSoundName(v.trim()) ? undefined : "Letters, digits, - and _, starting with a letter or digit"),
    })
  )?.trim();
  if (!sound) return;
  const inMix = audible(doc.tracks);
  const voice = inMix.some((t) => t.voice || (t.source.kind === "game" && looksLikeVoice(t.source.path)));
  const lastCategory = last?.category ?? (voice ? "dialogue" : "sfx");
  const categories = [...SoundCategories].sort((a, b) => Number(b.category === lastCategory) - Number(a.category === lastCategory));
  const c = await vscode.window.showQuickPick(
    categories.map((x) => ({ label: x.label, description: x.category, detail: x.detail, category: x.category })),
    { title: `As a REDnode sound: which of the game's volume sliders does ${sound} follow?` },
  );
  if (!c) return;

  const stored = path.relative(project.dir, pkg.dir).startsWith("..") ? pkg.dir : path.relative(project.dir, pkg.dir);
  const out = path.join(pkg.dir, ...soundFile(sound).split("/"));
  const again = last && path.resolve(project.dir, last.package).toLowerCase() === pkg.dir.toLowerCase() && last.sound === sound;
  if (fs.existsSync(out) && !again) {
    const ok = await vscode.window.showWarningMessage(`${pkg.name} has a sound ${sound} already. Replace it?`, { modal: true, detail: `${soundFile(sound)} is written over with this mix.` }, "Replace");
    if (ok !== "Replace") return;
  }
  // REDnode plays any rate and mixes in stereo; the first track in the mix gives the channels.
  const wav = await renderFor(Rate, { track: inMix[0].id });
  const manifest = path.join(pkg.dir, Manifest);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (pkg.isNew) {
    fs.writeFileSync(manifest, JSON.stringify(newManifest(pkg.id, pkg.name), null, 2) + "\n");
    fs.writeFileSync(path.join(pkg.dir, "mod.mjs"), newModScript(sound));
  }
  fs.writeFileSync(out, wav);
  fs.writeFileSync(manifest, upsertSound(fs.readFileSync(manifest, "utf8"), sound, c.category));
  await remember(document, doc, { route: "rednode", package: stored, sound, category: c.category });

  const shown = pkg.where === "project" ? path.relative(project.dir, out) : out;
  log.appendLine(`Add to Project: REDnode sound ${sound} (${c.category}) in ${pkg.dir}${pkg.isNew ? ", a new package" : ""}`);
  const hear = pkg.where === "game"
    ? " REDnode picks up the change while the game runs (a new package starts, a changed one restarts), so it plays without a restart."
    : " To hear it: Pack and Install puts the package in the game folder, where REDnode starts it (or restarts it while the game runs).";
  const made = pkg.isNew ? ` The new package's mod.mjs plays it once when it starts; build on it.` : "";
  const actions = pkg.where === "project" ? ["Copy Code", "Open Manifest", "Pack and Install"] : ["Copy Code", "Open Manifest"];
  const pick = await vscode.window.showInformationMessage(`${sound} is in ${pkg.name}: ${shown}, listed in its ${Manifest}. Play it from the package's code with audio.play("${sound}").${made}${hear}`, ...actions);
  if (pick === "Copy Code") await vscode.env.clipboard.writeText(playLine(sound));
  else if (pick === "Open Manifest") await vscode.window.showTextDocument(vscode.Uri.file(manifest));
  else if (pick === "Pack and Install") await vscode.commands.executeCommand("redcode.packAndInstall");
}

/** The override's WAV: beside the document when it is under source/raw, else source/raw/sfx. Named after the hash, as REDcode's Import wants. */
function overrideFile(document: vscode.TextDocument, project: ProjectRef, hash: number): string {
  const dir = path.dirname(document.uri.fsPath);
  const underRaw = !path.relative(project.raw, dir).startsWith("..") && !path.isAbsolute(path.relative(project.raw, dir));
  return path.join(underRaw ? dir : path.join(project.raw, "sfx"), `${hash}.wav`);
}

/**
 * Whether to write the event's WAV: yes when there is none, or when this document wrote it last time
 * (the usual re-render); else the modder is asked, since one WAV serves every variation of an event.
 */
async function mayReplace(out: string, event: string, last: IntoGame | undefined): Promise<boolean> {
  if (!fs.existsSync(out)) return true;
  if (last && "event" in last && last.event.toLowerCase() === event.toLowerCase()) return true;
  const pick = await vscode.window.showWarningMessage(
    `customSounds already has ${path.basename(out)} for ${event}. Replace it?`,
    { modal: true, detail: "REDmod plays one sound for every variation of an event, so this replaces what the game plays for the whole event." },
    "Replace",
  );
  return pick === "Replace";
}

function readMaybe(file: string): string | undefined {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
}

function writeInfo(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** Keeps the choice in the document, saved, so the next Add to Project offers it first. */
async function remember(document: vscode.TextDocument, doc: SoundDoc, game: IntoGame) {
  if (JSON.stringify(doc.game) === JSON.stringify(game)) return;
  doc.game = game;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), formatDoc(doc));
  await vscode.workspace.applyEdit(edit);
  await document.save();
}
