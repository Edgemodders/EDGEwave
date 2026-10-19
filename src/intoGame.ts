// Into the Game (A3): puts the mix (the tracks heard, with mute and solo) into the open REDcode project,
// in a layout the game loads, for REDcode's pack. What it replaces is a separate choice: any game sound
// effect on a track, the heard ones first, so a mix of a game sound and a file can override that sound.
// Two routes, both chosen in a quick pick and remembered in the document (doc.game):
//
// - Override one sound effect variation: a 48 kHz WAV with the original's channels, named after the
//   sound's hash, imported by REDcode (REDbridge's sound.importWavs writes the .opuspak and
//   sfx_container.opusinfo into source/archive). Exact, but mods that do this do not combine: each
//   carries the one shared index, so the last loaded wins.
// - A REDmod custom sound: the WAV in source/customSounds and an entry in source/resources/info.json,
//   as WolvenKit's Sound Modding tool writes them. Replaces an audio event, every variation, beside
//   other mods; the event's own Wwise logic is dropped. Silence is the same with a silent WAV, since
//   REDmod's mod_skip did not silence an event in the hand test.
//
// Voice lines (.wem) have no route yet: nothing here makes a .wem.

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { audible } from "./audio/mix";
import { formatDoc, looksLikeVoice, parseDoc, sourceLabel, type IntoGame, type SoundDoc, type Track } from "./doc";
import { redcode, type ProjectRef } from "./redcode";
import { RedmodTypes, silenceEntry, silentWav, soundFileFor, upsertCustomSound } from "./redmod";

/** Renders the mix through the page at a rate, with a track's source's channels ({track}: the sound it replaces) or a count. */
export type RenderFor = (rate: number, channels: { track: string } | 1 | 2) => Promise<Uint8Array>;

type Route = IntoGame["route"] | "redmodNamed";
type Item = vscode.QuickPickItem & { route?: Route; track?: Track; soundHash?: number; event?: string };

const Rate = 48000;

/** A sound effect track: what an override or a REDmod event can replace. */
type SfxTrack = Track & { source: Extract<Track["source"], { kind: "sfx" }> };

/**
 * The quick pick's items: for each game sound effect on a track, its override and its event's routes,
 * under the track's name. Heard tracks first; among them (and among the rest) the track of the last
 * choice first. The last choice is marked, never moved above a heard track.
 */
function routes(doc: SoundDoc): Item[] {
  const heard = new Set(audible(doc.tracks).map((t) => t.id));
  const sfx = doc.tracks.filter((t): t is SfxTrack => t.source.kind === "sfx");
  const last = doc.game;
  const wasLast = (t: SfxTrack) =>
    !!last && (last.route === "override" ? last.soundHash === t.source.soundHash : last.event === t.source.eventName);
  const rank = (t: SfxTrack) => (heard.has(t.id) ? 0 : 2) + (wasLast(t) ? 0 : 1);
  const ordered = [...sfx].sort((a, b) => rank(a) - rank(b));
  const items: Item[] = [];
  const hashes = new Set<number>();
  const events = new Set<string>();
  for (const t of ordered) {
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
        { label: `$(mute) Silence the event ${eventName}, every variation, with REDmod`, detail: "The game plays a short silent sound in place of the event's.", route: "skip", track: t, event: eventName },
      );
    }
    if (!group.length) continue;
    const n = doc.tracks.indexOf(t) + 1;
    items.push({ label: `Track ${n} · ${sourceLabel(t.source)}${heard.has(t.id) ? "" : " (not heard)"}`, kind: vscode.QuickPickItemKind.Separator }, ...group);
  }
  items.push(
    { label: "Any event", kind: vscode.QuickPickItemKind.Separator },
    { label: "$(package) A REDmod custom sound for an event…", detail: "Name the audio event the game should play this mix for (REDcode's sound list shows the names).", route: "redmodNamed" },
  );
  const chosen = lastItem(items, last);
  if (chosen) chosen.description = [chosen.description, "last time"].filter(Boolean).join(" · ");
  return items;
}

/** The item for the last choice, if this document still offers it. */
function lastItem(items: Item[], last: IntoGame | undefined): Item | undefined {
  if (!last) return undefined;
  if (last.route === "override") return items.find((i) => i.route === "override" && (last.soundHash === undefined || i.soundHash === last.soundHash));
  return items.find((i) => i.route === last.route && i.event === last.event) ?? items.find((i) => i.route === "redmodNamed" && last.route === "redmod");
}

export async function intoGame(document: vscode.TextDocument, renderFor: RenderFor, log: vscode.OutputChannel): Promise<void> {
  const api = await redcode();
  const project = api.project();
  if (!project) throw new Error("Open a REDcode project first: Into the Game writes into its source folders.");
  if (document.isDirty) await document.save();
  const doc = parseDoc(document.getText());
  const heard = audible(doc.tracks);
  if (!heard.length) throw new Error("Every track is muted: Into the Game puts the tracks you hear into the mod.");

  // A voice line heard, and no sound effect to put the mix in place of.
  if (!heard.some((t) => t.source.kind === "sfx") && heard.some((t) => t.voice || (t.source.kind === "game" && looksLikeVoice(t.source.path)))) {
    void vscode.window.showInformationMessage(
      "Voice lines cannot go into the game as voice lines yet: a .wem needs Wwise to make, which EDGEwave does not have. A REDmod custom sound can still play this mix for an audio event.",
    );
  }

  const chosen = await vscode.window.showQuickPick(routes(doc), { title: "Into the Game: what should the tracks you hear replace?" });
  if (!chosen?.route) return;
  // The channels of the sound replaced; for a named event, the first track heard.
  const channels = { track: (chosen.track ?? heard[0]).id };

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
    log.appendLine(`Into the Game: sound ${hash} from ${file} into ${r.written.join(", ")}`);
    game = { route: "override", soundHash: hash };
    done = `Sound ${hash} now overrides the game's, in ${r.written.map((w) => path.relative(project.dir, w)).join(", ")}.`;
  } else {
    let name = chosen.event;
    if (chosen.route === "redmodNamed" || !name) {
      name = (await vscode.window.showInputBox({ title: "Into the Game: the audio event", prompt: "The event the game should play this mix for", value: doc.game && doc.game.route !== "override" ? doc.game.event : "" }))?.trim();
      if (!name) return;
    }
    const info = path.join(project.resources, "info.json");
    const out = path.join(project.dir, "source", "customSounds", soundFileFor(name));
    if (!(await mayReplace(out, name, doc.game))) return;
    if (chosen.route === "skip") {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, silentWav());
      writeInfo(info, upsertCustomSound(readMaybe(info), silenceEntry(name)));
      game = { route: "skip", event: name };
      done = `REDmod will play silence for ${name}: ${path.relative(project.dir, out)} (in ${path.relative(project.dir, info)}).`;
    } else {
      const lastType = doc.game?.route === "redmod" ? doc.game.type : undefined;
      const types = [...RedmodTypes].sort((a, b) => Number(b.type === lastType) - Number(a.type === lastType));
      const t = await vscode.window.showQuickPick(
        types.map((x) => ({ label: x.label, description: x.type, detail: x.detail, type: x.type })),
        { title: `Into the Game: how should the game play ${name}?` },
      );
      if (!t) return;
      const gain = doc.game?.route === "redmod" ? doc.game.gain : 1;
      const pitch = doc.game?.route === "redmod" ? doc.game.pitch : 0;
      // REDmod checks the WAV's format; which rates it takes is unverified, so the game's own 48 kHz.
      const wav = await renderFor(Rate, channels);
      const file = path.basename(out);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, wav);
      writeInfo(info, upsertCustomSound(readMaybe(info), { name, type: t.type, file, gain, pitch }));
      game = { route: "redmod", event: name, type: t.type, gain, pitch };
      done = `REDmod will play ${path.relative(project.dir, out)} for ${name}, as ${t.type} (in ${path.relative(project.dir, info)}).`;
    }
    log.appendLine(`Into the Game: ${done}`);
  }

  await remember(document, doc, game);
  const redmodOff = game.route !== "override" && !vscode.workspace.getConfiguration("redcode").get<boolean>("pack.redmod", false);
  const note = redmodOff ? " REDmod custom sounds need REDcode to pack the mod as a REDmod (the redcode.pack.redmod setting)." : "";
  const actions = redmodOff ? ["Pack", "Open Setting"] : ["Pack"];
  const pick = await vscode.window.showInformationMessage(`${done}${note}`, ...actions);
  if (pick === "Open Setting") await vscode.commands.executeCommand("workbench.action.openSettings", "redcode.pack.redmod");
  else if (pick === "Pack") {
    const r = await api.pack();
    void vscode.window.showInformationMessage(`REDcode packed the mod into ${path.relative(project.dir, r.packedDir) || r.packedDir}.`);
  }
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
  if (last && last.route !== "override" && last.event.toLowerCase() === event.toLowerCase()) return true;
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

/** Keeps the choice in the document, saved, so the next Into the Game offers it first. */
async function remember(document: vscode.TextDocument, doc: SoundDoc, game: IntoGame) {
  if (JSON.stringify(doc.game) === JSON.stringify(game)) return;
  doc.game = game;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), formatDoc(doc));
  await vscode.workspace.applyEdit(edit);
  await document.save();
}
