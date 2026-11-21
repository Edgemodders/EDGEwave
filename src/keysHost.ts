// The VS Code side's helpers for the shared key store (EDGEwave #12): where REDbridge is, for the one-time move
// and for the MCP server VS Code runs; whether REDcode has the store.

import * as vscode from "vscode";
import { findBridge } from "./keyStore";
import { redcode, REDcodeId, type KeysApi } from "./redcode";

/** REDcode's shared key store (REDcode 0.10.16 and later), or undefined with an older REDcode or none. */
export async function keyStore(): Promise<KeysApi | undefined> {
  try {
    return (await redcode()).keys;
  } catch {
    return undefined;
  }
}

/** REDbridge.exe as REDcode finds it: redcode.bridgePath, else the one inside REDcode, else on the PATH. */
export function bridgeExe(): string | undefined {
  const redcodeDir = vscode.extensions.getExtension(REDcodeId)?.extensionPath;
  return findBridge({
    configured: vscode.workspace.getConfiguration("redcode").get<string>("bridgePath") || undefined,
    redcodeDirs: redcodeDir ? [redcodeDir] : [],
    pathEnv: process.env.PATH,
  });
}
