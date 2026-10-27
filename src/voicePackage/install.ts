// EDGEwave: Voices for REDnode…: installs EDGEwave Voice (the REDnode package built into dist/rednode) in the
// game's REDnode apps folder, or updates it, and writes its voices.json from the modder's ElevenLabs voices.
// The key is not copied: a REDnode package reads only its own secrets, so the player pastes it in the
// package's window once (Copy the Key helps).

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { redcode } from "../redcode";
import { AppsDir } from "../rednode";
import type { VoiceTools } from "../voiceTools";
import { voicesConfig } from "./config";
import { CacheDir, PackageId, VoicesFile, type VoicesConfig } from "./core";

const DocsUrl = "https://edgemodders.github.io/EDGEwave/rednode-voice.html";

/** The package's files, as the extension ships them; voices.json and the cache are the player's. */
function bundled(context: vscode.ExtensionContext): string {
  return path.join(context.extensionPath, "dist", "rednode", PackageId);
}

function readConfig(dir: string): VoicesConfig | undefined {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(dir, VoicesFile), "utf8")) as VoicesConfig;
    return c?.edgewave === "voices" ? c : undefined;
  } catch {
    return undefined;
  }
}

export async function voicesForRednode(context: vscode.ExtensionContext, tools: VoiceTools, log: vscode.OutputChannel): Promise<void> {
  const game = (await redcode().catch(() => undefined))?.gamePath();
  if (!game) throw new Error("REDcode has no game folder set (redcode.gamePath), so EDGEwave cannot find REDnode in the game.");
  const rednodeDir = path.join(game, ...AppsDir.slice(0, 3));
  if (!fs.existsSync(rednodeDir)) throw new Error(`REDnode is not installed in ${game}: EDGEwave Voice is a REDnode package. Install REDnode first (https://github.com/Edgemodders/REDnode).`);
  const from = bundled(context);
  if (!fs.existsSync(path.join(from, "rednode-app.json"))) throw new Error(`This EDGEwave has no EDGEwave Voice package (${from} is missing).`);
  const dir = path.join(game, ...AppsDir, PackageId);

  // Pick the voices: EDGEwave's own first (clones of lines, remixes), then the account's others.
  const api = await tools.client();
  const account = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "EDGEwave: reading your ElevenLabs voices" }, () => api.voices());
  const made = new Map(tools.made().map((m) => [m.id, m]));
  const before = readConfig(dir);
  const chosen = new Set(Object.values(before?.voices ?? {}).map((v) => v.id));
  const rank = (id: string, category?: string) => (made.has(id) ? 0 : category === "premade" ? 2 : 1);
  const items = account
    .map((v) => {
      const m = made.get(v.id);
      const tags = [v.labels.gender, v.labels.age, v.labels.accent].filter(Boolean).join(", ");
      return {
        label: v.name,
        description: m ? (m.kind === "clone" ? "made by EDGEwave: a line's voice" : "made by EDGEwave: a remix") : [tags, v.category].filter(Boolean).join(" · "),
        detail: v.id,
        picked: chosen.has(v.id),
        v,
      };
    })
    .sort((a, b) => rank(a.v.id, a.v.category) - rank(b.v.id, b.v.category) || a.label.localeCompare(b.label));
  const picks = await vscode.window.showQuickPick(items, {
    title: "EDGEwave Voice: the voices REDnode mods may name",
    placeHolder: "Pick the voices; each gets a short name, such as judy, that a mod passes to speak",
    canPickMany: true,
    matchOnDescription: true,
    matchOnDetail: true,
    ignoreFocusOut: true,
  });
  if (!picks) return;

  // Install or update the package's files; the player's voices.json and cache stay.
  fs.mkdirSync(dir, { recursive: true });
  const was = fs.existsSync(path.join(dir, "rednode-app.json"));
  for (const f of fs.readdirSync(from)) if (f !== VoicesFile && f !== CacheDir) fs.copyFileSync(path.join(from, f), path.join(dir, f));
  const config = voicesConfig(before, picks.map((p) => ({ id: p.v.id, label: p.v.name })));
  fs.writeFileSync(path.join(dir, VoicesFile), JSON.stringify(config, null, 2) + "\n");
  const names = Object.keys(config.voices);
  log.appendLine(`EDGEwave Voice ${was ? "updated" : "installed"} in ${dir}: ${names.join(", ") || "no voices"}`);

  const copy = "Copy the Key";
  const open = "Open voices.json";
  const how = "How to Use It";
  const a = await vscode.window.showInformationMessage(
    `EDGEwave Voice is ${was ? "updated" : "installed"} in the game, with ${names.length} voice${names.length === 1 ? "" : "s"}: ${names.join(", ") || "none"}. In the game, open EDGEwave Voice from REDnode's launcher (F10) and paste your ElevenLabs key there once.`,
    copy,
    open,
    how,
  );
  if (a === copy) {
    const key = await tools.key(false);
    if (key) {
      await vscode.env.clipboard.writeText(key);
      void vscode.window.showInformationMessage("EDGEwave: your ElevenLabs key is on the clipboard. Paste it in EDGEwave Voice's window, then copy something else over it.");
    }
  } else if (a === open) await vscode.window.showTextDocument(vscode.Uri.file(path.join(dir, VoicesFile)));
  else if (a === how) await vscode.env.openExternal(vscode.Uri.parse(DocsUrl));
}
