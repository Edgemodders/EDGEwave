// Into the Game (A3): puts the mix into the open REDcode project, in a layout the game loads, for
// REDcode's pack. Two routes, both chosen in a quick pick and remembered in the document (doc.game):
//
// - Override one sound effect variation: a 48 kHz WAV with the original's channels, named after the
//   sound's hash, imported by REDcode (REDbridge's sound.importWavs writes the .opuspak and
//   sfx_container.opusinfo into source/archive). Exact, but mods that do this do not combine: each
//   carries the one shared index, so the last loaded wins.
// - A REDmod custom sound: the WAV in source/customSounds and an entry in source/resources/info.json,
//   as WolvenKit's Sound Modding tool writes them. Replaces (or silences) an audio event, every
//   variation, beside other mods; the event's own Wwise logic is dropped.
//
// Voice lines (.wem) have no route yet: nothing here makes a .wem.

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { formatDoc, looksLikeVoice, parseDoc, type IntoGame, type SoundDoc } from "./doc";
import { redcode, type ProjectRef } from "./redcode";
import { RedmodTypes, soundFileFor, upsertCustomSound } from "./redmod";

/** Renders the mix through the page at a rate, with the first track's source's channels ("source") or a count. */
export type RenderFor = (rate: number, channels: "source" | 1 | 2) => Promise<Uint8Array>;

type Route = IntoGame["route"] | "redmodNamed";
type Item = vscode.QuickPickItem & { route: Route };

const Rate = 48000;

export async function intoGame(document: vscode.TextDocument, renderFor: RenderFor, log: vscode.OutputChannel): Promise<void> {
  const api = await redcode();
  const project = api.project();
  if (!project) throw new Error("Open a REDcode project first: Into the Game writes into its source folders.");
  if (document.isDirty) await document.save();
  const doc = parseDoc(document.getText());
  const s = doc.tracks[0].source;
  const event = s.kind === "sfx" ? s.eventName : undefined;

  if (doc.tracks.some((t) => t.voice) || (s.kind === "game" && looksLikeVoice(s.path))) {
    void vscode.window.showInformationMessage(
      "Voice lines cannot go into the game as voice lines yet: a .wem needs Wwise to make, which EDGEwave does not have. A REDmod custom sound can still play this mix for an audio event.",
    );
  }

  const items: Item[] = [];
  if (s.kind === "sfx") {
    items.push({
      label: "$(replace) Override this variation",
      description: `sound ${s.soundHash}`,
      detail: "Exactly this sound, in its .opuspak. Mods that override sounds this way do not work together: the last one loaded wins.",
      route: "override",
    });
  }
  if (event) {
    items.push(
      { label: "$(package) Replace the event with REDmod", description: event, detail: "The game plays this mix for the event, every variation. Works beside other mods; the event's own Wwise logic is dropped.", route: "redmod" },
      { label: "$(mute) Silence the event with REDmod", description: event, detail: "The game no longer plays this event.", route: "skip" },
    );
  } else {
    items.push({ label: "$(package) A REDmod custom sound for an event…", detail: "Name the audio event the game should play this mix for (REDcode's sound list shows the names).", route: "redmodNamed" });
  }
  // The last choice first.
  const last = doc.game?.route;
  items.sort((a, b) => Number(b.route === last) - Number(a.route === last));
  const chosen = await vscode.window.showQuickPick(items, { title: "Into the Game: how should this sound go into the mod?" });
  if (!chosen) return;

  let game: IntoGame;
  let done: string;
  if (chosen.route === "override") {
    if (s.kind !== "sfx") return;
    const wav = await renderFor(Rate, "source");
    const file = overrideFile(document, project, s.soundHash);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, wav);
    const r = await api.importFile(file);
    if (!r.ok) throw new Error(`REDcode could not import ${path.basename(file)}; see REDcode's output.`);
    log.appendLine(`Into the Game: sound ${s.soundHash} from ${file} into ${r.written.join(", ")}`);
    game = { route: "override" };
    done = `Sound ${s.soundHash} now overrides the game's, in ${r.written.map((w) => path.relative(project.dir, w)).join(", ")}.`;
  } else {
    let name = event;
    if (chosen.route === "redmodNamed" || !name) {
      name = (await vscode.window.showInputBox({ title: "Into the Game: the audio event", prompt: "The event the game should play this mix for", value: doc.game && doc.game.route !== "override" ? doc.game.event : "" }))?.trim();
      if (!name) return;
    }
    const info = path.join(project.resources, "info.json");
    if (chosen.route === "skip") {
      writeInfo(info, upsertCustomSound(readMaybe(info), { name, type: "mod_skip" }));
      game = { route: "skip", event: name };
      done = `REDmod will silence ${name} (in ${path.relative(project.dir, info)}).`;
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
      const wav = await renderFor(Rate, "source");
      const file = soundFileFor(name);
      const out = path.join(project.dir, "source", "customSounds", file);
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
