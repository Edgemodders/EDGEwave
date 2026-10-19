// EDGEwave: the EDGE sound studio for Cyberpunk 2077 modding. Builds on REDcode (src/redcode.ts);
// the design is in docs/design.md.

import * as vscode from "vscode";
import { SoundEditorProvider } from "./editor";
import { openFile, openSound, ViewType } from "./openSound";
import type { SoundRef } from "./redcode";
import { SoundsView } from "./soundsView";
import { VoiceTools } from "./voiceTools";

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel("EDGEwave");
  const voices = new VoiceTools(context, log);
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
  );
}

export function deactivate(): void {}
