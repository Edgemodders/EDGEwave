// EDGEwave: the EDGE sound studio for Cyberpunk 2077 modding. Builds on REDcode (src/redcode.ts);
// the design is in docs/design.md.

import * as vscode from "vscode";
import { SoundEditorProvider } from "./editor";
import { openFile, openSound, ViewType } from "./openSound";
import type { SoundRef } from "./redcode";

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel("EDGEwave");
  context.subscriptions.push(
    log,
    vscode.window.registerCustomEditorProvider(ViewType, new SoundEditorProvider(context, log), {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    // REDcode's Open in EDGEwave runs this with the sound now playing.
    vscode.commands.registerCommand("edgewave.openSound", (ref: SoundRef) => {
      log.appendLine(`Open sound: ${JSON.stringify(ref)}`);
      return openSound(ref);
    }),
    vscode.commands.registerCommand("edgewave.open", (uri?: vscode.Uri) => openFile(uri)),
  );
}

export function deactivate(): void {}
