// EDGEwave's MCP server for assistants ships inside the extension (dist/mcp/edgewave-mcp.cjs, from
// src/mcp/server.ts), as EDGEmat's does. On start the extension copies it to a fixed path in EDGEwave's own
// folder, so a Claude Code registration survives updates. It registers the server with VS Code's own MCP
// support where the editor has it (1.101 and later), with the ElevenLabs key from secret storage. "Connect an
// Assistant (MCP)..." registers it with Claude Code, or copies the command or a JSON entry for other clients.

import { exec, execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { edgewaveHome } from "./events";

type Log = (line: string) => void;

const KeySecret = "edgewave.elevenlabs.apiKey";
export const serverFile = () => path.join(edgewaveHome(), "mcp", "edgewave-mcp.cjs");

/** Copies the bundled server to its fixed path when it is missing or differs. */
export function installServer(extensionPath: string, log: Log): void {
  const from = path.join(extensionPath, "dist", "mcp", "edgewave-mcp.cjs");
  const to = serverFile();
  try {
    if (!fs.existsSync(from)) return log(`MCP: no server in the extension at ${from}`);
    const bundled = fs.readFileSync(from);
    if (fs.existsSync(to) && fs.readFileSync(to).equals(bundled)) return;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    const temp = `${to}.${process.pid}.tmp`;
    fs.writeFileSync(temp, bundled);
    fs.renameSync(temp, to);
    log(`MCP: server updated at ${to}`);
  } catch (e) {
    log(`MCP: could not copy the server to ${to}: ${(e as Error).message}`);
  }
}

async function keyEnv(context: vscode.ExtensionContext): Promise<Record<string, string>> {
  const k = await context.secrets.get(KeySecret);
  return k ? { ELEVENLABS_API_KEY: k } : {};
}

interface McpApi {
  registerMcpServerDefinitionProvider?: (id: string, provider: unknown) => vscode.Disposable;
}
type McpDefinition = new (label: string, command: string, args: string[], env: Record<string, string>, version?: string) => unknown;

const editorMcp = () => {
  const lm = (vscode as unknown as { lm?: McpApi }).lm;
  const Def = (vscode as unknown as { McpStdioServerDefinition?: McpDefinition }).McpStdioServerDefinition;
  return lm?.registerMcpServerDefinitionProvider && Def ? { lm, Def } : undefined;
};

/** Registers the server with the editor's own MCP support, when it has one. VS Code's binary runs it as Node. */
export function registerWithEditor(context: vscode.ExtensionContext, version: string, log: Log): vscode.Disposable[] {
  const api = editorMcp();
  if (!api) return [];
  const changed = new vscode.EventEmitter<void>();
  try {
    return [
      changed,
      api.lm.registerMcpServerDefinitionProvider!("edgewave.mcp", {
        onDidChangeMcpServerDefinitions: changed.event,
        provideMcpServerDefinitions: async () => [new api.Def("EDGEwave", process.execPath, [serverFile()], { ELECTRON_RUN_AS_NODE: "1", ...(await keyEnv(context)) }, version)],
      }),
      context.secrets.onDidChange((e) => {
        if (e.key === KeySecret) changed.fire();
      }),
    ];
  } catch (e) {
    changed.dispose();
    log(`MCP: the editor's MCP support refused the server, so agents in this editor won't see it: ${(e as Error).message}`);
    return [];
  }
}

const quote = (s: string) => `"${s}"`;

/** Node 20 or later on the PATH, for Claude Code to run the server with; else VS Code's own binary as Node. */
function runner(): Promise<{ command: string; env: Record<string, string> }> {
  return new Promise((resolve) => {
    execFile("node", ["--version"], { windowsHide: true, timeout: 10000 }, (err, out) => {
      const major = Number(/^v(\d+)/.exec(String(out).trim())?.[1] ?? 0);
      resolve(!err && major >= 20 ? { command: "node", env: {} } : { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: "1" } });
    });
  });
}

/** "Connect an Assistant (MCP)...". */
export async function connectAssistant(context: vscode.ExtensionContext, log: Log): Promise<void> {
  installServer(context.extensionPath, log);
  const file = serverFile();
  if (!fs.existsSync(file)) {
    void vscode.window.showErrorMessage("EDGEwave: the MCP server file is missing. Reinstall EDGEwave, then try again. The output says why.");
    return;
  }
  const run = await runner();
  const inEditor = editorMcp() ? "Agents inside this editor already see EDGEwave's tools." : "This editor has no MCP support of its own (VS Code 1.101 or later has), so connect an assistant here.";
  const picked = await vscode.window.showQuickPick(
    [
      { label: "$(plug) Connect Claude Code", description: "claude mcp add edgewave ...", detail: "Registers EDGEwave for every Claude Code session, replacing an older registration. Then start a new Claude Code session.", action: "claude" as const },
      { label: "$(terminal) Copy the Claude Code command", description: "to run it yourself", detail: "The same registration, as one line to paste in a terminal.", action: "copy" as const },
      { label: "$(json) Copy a JSON entry", description: "for other MCP clients", detail: "The server entry for a client's MCP settings file.", action: "json" as const },
      { label: "$(file) Reveal the server file", description: file, detail: "Any MCP client can run it with Node 20 or later.", action: "reveal" as const },
    ],
    { title: "EDGEwave: Connect an Assistant (MCP)", placeHolder: inEditor },
  );
  if (!picked) return;
  if (picked.action === "reveal") {
    await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(file));
    return;
  }

  // The ElevenLabs key, only when asked: the client keeps it in its own settings file, in plain text.
  let env = { ...run.env };
  const keys = await keyEnv(context);
  if (keys.ELEVENLABS_API_KEY && picked.action !== "copy") {
    const give = await vscode.window.showQuickPick(
      [
        { label: "Yes, include my ElevenLabs key", detail: "So the assistant can voice lines (voice_lines) and list voices. The client stores the key in its own settings file, in plain text. Voicing spends your credits.", give: true },
        { label: "No", detail: "Sound events and custom sounds work without it. You can connect again later.", give: false },
      ],
      { title: "Give the assistant your ElevenLabs key too?" },
    );
    if (!give) return;
    if (give.give) env = { ...env, ...keys };
  }
  const command = (flags: string[]) => ["claude mcp add --scope user edgewave", ...flags, "--", quote(run.command), quote(file)].join(" ");
  const masked = command(Object.entries(env).map(([k, v]) => `-e ${k}=${k.endsWith("_API_KEY") ? "<key>" : v}`));

  if (picked.action === "copy") {
    await vscode.env.clipboard.writeText(masked);
    void vscode.window.showInformationMessage(keys.ELEVENLABS_API_KEY ? "Copied. Put your ElevenLabs key in place of <key>, or leave out that -e, then paste it in a terminal." : "Copied. Paste it in a terminal, then start a new Claude Code session.");
    log(`MCP: ${masked}`);
    return;
  }
  if (picked.action === "json") {
    await vscode.env.clipboard.writeText(JSON.stringify({ edgewave: { command: run.command, args: [file], ...(Object.keys(env).length ? { env } : {}) } }, null, 2));
    void vscode.window.showInformationMessage("Copied the JSON entry for EDGEwave's server.");
    return;
  }

  log(`MCP: ${masked}`);
  const shell = (line: string) => new Promise<{ ok: boolean; out: string }>((resolve) => exec(line, { windowsHide: true, timeout: 60000 }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}${stderr}`.trim() })));
  await shell("claude mcp remove --scope user edgewave");
  const added = await shell(command(Object.entries(env).map(([k, v]) => `-e ${k}=${v}`)));
  if (added.ok) {
    log(`MCP: ${added.out}`);
    void vscode.window.showInformationMessage("EDGEwave is connected to Claude Code. Start a new Claude Code session and ask it to find a sound event, or to voice a quest's lines.");
    return;
  }
  log(`MCP: claude mcp add failed: ${added.out}`);
  const notFound = /not recognized|not found|ENOENT/i.test(added.out);
  const choice = await vscode.window.showWarningMessage(
    notFound ? "EDGEwave: Claude Code's claude command isn't on the PATH. Copy the command and run it where Claude Code works?" : `EDGEwave: Claude Code didn't take the server: ${added.out.split(/\r?\n/)[0]}`,
    "Copy the Command",
  );
  if (choice === "Copy the Command") await vscode.env.clipboard.writeText(masked);
}
