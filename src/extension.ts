// EDGEwave: the EDGE sound studio for Cyberpunk 2077 modding. Builds on REDcode (src/redcode.ts);
// the design is in docs/design.md.

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { makeApi, type EDGEwaveApi } from "./api";
import { SoundEditorProvider } from "./editor";
import { connectAssistant, installServer, registerWithEditor } from "./mcp";
import { newSound, openFile, openSound, ViewType } from "./openSound";
import type { SoundRef } from "./redcode";
import { SoundEvents } from "./soundEvents";
import { SoundsView } from "./soundsView";
import { isV, type VoiceLine } from "./voice";
import { loadRecord } from "./voiceBatch";
import { VoiceLines } from "./voiceLines";
import { VoiceTools } from "./voiceTools";

export function activate(context: vscode.ExtensionContext): EDGEwaveApi {
  const log = vscode.window.createOutputChannel("EDGEwave");
  const voices = new VoiceTools(context, log);
  const voiceLines = new VoiceLines(context, log, voices);
  const events = new SoundEvents(context, (l) => log.appendLine(l));
  const version = String((context.extension.packageJSON as { version?: string }).version ?? "0.0.0");
  const sounds = new SoundsView(context);
  context.subscriptions.push(
    log,
    vscode.window.registerCustomEditorProvider(ViewType, new SoundEditorProvider(context, log, voices, (uri) => void sounds.remember(uri)), {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    // REDcode's Open in EDGEwave runs this with the sound now playing.
    vscode.commands.registerCommand("edgewave.openSound", (ref: SoundRef) => {
      log.appendLine(`Open sound: ${JSON.stringify(ref)}`);
      return openSound(ref);
    }),
    vscode.commands.registerCommand("edgewave.open", (uri?: vscode.Uri) => openFile(uri)),
    vscode.commands.registerCommand("edgewave.newSound", (file?: string) => newSound(file)),
    vscode.commands.registerCommand("edgewave.elevenlabs.setKey", () => voices.setKey()),
    vscode.commands.registerCommand("edgewave.elevenlabs.clearKey", () => voices.clearKey()),
    vscode.commands.registerCommand("edgewave.elevenlabs.voices", async () => {
      try {
        await voices.manageVoices();
      } catch (e) {
        void vscode.window.showErrorMessage(`EDGEwave: ${(e as Error).message}`);
      }
    }),
  );
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("edgewave.sounds", sounds),
    vscode.commands.registerCommand("edgewave.refreshSounds", () => sounds.refresh()),
    vscode.commands.registerCommand("edgewave.forgetRecent", (node) => sounds.forget(node)),
    vscode.commands.registerCommand("edgewave.clearRecent", () => sounds.clearRecent()),
    // With no folder, VS Code's own Open Folder dialog.
    vscode.commands.registerCommand("edgewave.openFolder", () => vscode.commands.executeCommand("vscode.openFolder")),
    vscode.commands.registerCommand("edgewave.voiceLines", () => openRecordedQuest(voiceLines)),
    vscode.commands.registerCommand("edgewave.connectAssistant", () => connectAssistant(context, (l) => log.appendLine(l))),
  );
  installServer(context.extensionPath, (l) => log.appendLine(l));
  context.subscriptions.push(...registerWithEditor(context, version, (l) => log.appendLine(l)));
  return makeApi(version, voiceLines, events);
}

/** Voice Lines on a quest voiced before: its lines as voice.json has them (EDGEquest opens it with the story's). */
async function openRecordedQuest(voiceLines: VoiceLines): Promise<void> {
  const roots = vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [];
  const quests = roots.flatMap((root) => {
    const dir = path.join(root, "source", "raw", "edgewave", "voice");
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter((q) => fs.existsSync(path.join(dir, q, "voice.json"))).map((quest) => ({ root, quest })) : [];
  });
  if (!quests.length) {
    void vscode.window.showInformationMessage("EDGEwave: no quest has voice lines here yet. EDGEquest's Storyboard hands a quest's lines to Voice Lines (its Generate buttons).");
    return;
  }
  const pick = quests.length === 1 ? quests[0] : (await vscode.window.showQuickPick(quests.map((q) => ({ label: q.quest, description: q.root, q })), { title: "EDGEwave: Voice Lines for which quest?" }))?.q;
  if (!pick) return;
  const record = loadRecord(pick.root, pick.quest);
  const lines: VoiceLine[] = Object.entries(record.lines).map(([id, l]) => ({ id, scene: l.scene, speaker: l.speaker, text: l.text, say: l.say, direction: l.direction, both: !!l.male || isV(l.speaker) }));
  void voiceLines.open({ projectDir: pick.root, quest: pick.quest, lines });
}

export function deactivate(): void {}
