// EDGEwave: sound tools for Cyberpunk 2077 modding. Phase A0 is the scaffold only;
// the design is in docs/design.md.

import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("edgewave.open", () => {
      void vscode.window.showInformationMessage(
        "EDGEwave is in its design phase. The sound browser arrives in phase A1; see the design on the docs site.",
      );
    }),
  );
}

export function deactivate(): void {}
