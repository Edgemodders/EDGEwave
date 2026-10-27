// The reload test (npm run smoke:reload): unsaved edits to a sound survive Developer: Reload Window, and are not
// saved until Ctrl+S. VS Code 1.143 marks a custom editor's tab unsaved after a reload but gives the extension the
// file as saved; the page keeps its unsaved document in the tab's state and puts it back (webview/editor.ts).
// With the smoke test's stand-in REDcode (opening sound 42 once) and a command that adds a voice line through
// Game Assets' + (edgewave.addGameSound). Uses the VS Code that smoke.mjs downloaded.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const T = path.join(os.tmpdir(), "ewreload");
fs.rmSync(T, { recursive: true, force: true });
fs.mkdirSync(path.join(T, "proj", "source", "raw"), { recursive: true });
fs.mkdirSync(path.join(T, "game"), { recursive: true });
fs.mkdirSync(path.join(T, "ud", "User"), { recursive: true });
fs.cpSync(path.join(repo, "tools", "smoke", "stub"), path.join(T, "stub"), { recursive: true });
fs.copyFileSync(path.join(repo, "test", "fixtures", "tone.ogg"), path.join(T, "tone.ogg"));
const pj = JSON.parse(fs.readFileSync(path.join(T, "stub", "package.json"), "utf8"));
pj.contributes.commands.push({ command: "reload.add", title: "Reload test: Add a Voice Line" }, { command: "reload.dump", title: "Reload test: Dump the Document" });
fs.writeFileSync(path.join(T, "stub", "package.json"), JSON.stringify(pj));
{
  const f = path.join(T, "stub", "extension.js");
  const js = fs.readFileSync(f, "utf8").replace('setTimeout(() => vscode.commands.executeCommand("edgewave.openSound", { soundHash: 42, eventHash: 7 }), 3000);', 'if (!fs.existsSync(path.join(T, "opened.flag"))) { fs.writeFileSync(path.join(T, "opened.flag"), "1"); setTimeout(() => vscode.commands.executeCommand("edgewave.openSound", { soundHash: 42, eventHash: 7 }), 3000); }');
  if (!js.includes("opened.flag")) throw new Error("the stub's opening line changed: update tools/smoke/reload.mjs");
  fs.writeFileSync(f, js);
}
fs.appendFileSync(path.join(T, "stub", "extension.js"), `
const prev = exports.activate;
exports.activate = (context) => {
  const api = prev(context);
  context.subscriptions.push(require("vscode").commands.registerCommand("reload.add", () => require("vscode").commands.executeCommand("edgewave.addGameSound", { kind: "file", file: { hash: "1", name: "base\\\\localization\\\\en-us\\\\vo\\\\judy_smoke_f_000000000000002a.wem", size: 41000, archive: "x" } })));
  context.subscriptions.push(require("vscode").commands.registerCommand("reload.dump", () => {
    const d = require("vscode").workspace.textDocuments.find((x) => x.uri.fsPath.endsWith(".edgewave"));
    require("fs").writeFileSync(require("path").join(__dirname, "..", "dump.json"), JSON.stringify({ found: !!d, dirty: d?.isDirty, version: d?.version, tracks: d ? JSON.parse(d.getText()).tracks.length : null }));
  }));
  return api;
};
`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exe = await downloadAndUnzipVSCode({ version: "stable", cachePath: path.join(os.tmpdir(), "ewsmoke", "vsc") });
const env = { ...process.env, EDGEWAVE_HOME: path.join(T, "home") }; delete env.ELECTRON_RUN_AS_NODE;
const code = spawn(exe, ["--new-window", "--user-data-dir", path.join(T, "ud"), "--extensions-dir", path.join(T, "ex"), "--disable-extensions",
  "--extensionDevelopmentPath", repo, "--extensionDevelopmentPath", path.join(T, "stub"), "--remote-debugging-port=9341",
  "--skip-welcome", "--skip-release-notes", "--disable-workspace-trust", path.join(T, "proj")], { env, stdio: "ignore" });
const done = (ok, msg) => { console.log(ok ? "PASS" : "FAIL", msg); code.kill(); process.exit(ok ? 0 : 1); };
setTimeout(() => done(false, "timed out"), 240000);

let ws, nextId = 1; const waiting = new Map(); let contexts = [];
async function connect() {
  ws = undefined;
  for (let i = 0; i < 60 && !ws; i++) {
    try {
      const pages = await (await fetch("http://127.0.0.1:9341/json")).json();
      const page = pages.find((p) => p.type === "page" && p.url.includes("workbench"));
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r)); }
    } catch {}
    if (!ws) await sleep(1000);
  }
  contexts = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) { const w = waiting.get(m.id); waiting.delete(m.id); m.error ? w.reject(new Error(m.error.message)) : w.resolve(m.result); return; }
    if (m.method === "Runtime.executionContextCreated") contexts.push({ id: m.params.context.id, origin: m.params.context.origin, sessionId: m.sessionId, aux: m.params.context.auxData });
    if (m.method === "Runtime.executionContextsCleared") contexts = contexts.filter((c) => c.sessionId !== m.sessionId);
    if (m.method === "Target.attachedToTarget") {
      const s = m.params.sessionId;
      cdp("Runtime.enable", {}, s).catch(() => {});
      cdp("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, s).catch(() => {});
      cdp("Runtime.runIfWaitingForDebugger", {}, s).catch(() => {});
    }
  });
  await cdp("Runtime.enable");
  await cdp("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
}
const cdp = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = nextId++; waiting.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, sessionId }));
});
const evalIn = async (c, expression) => {
  const r = await cdp("Runtime.evaluate", { expression, contextId: c?.id, awaitPromise: true, returnByValue: true }, c?.sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const bench = () => evalIn(undefined, "1");
const key = async (k, c, vk, mod = 0) => { await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: c, windowsVirtualKeyCode: vk, modifiers: mod }); await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: c, windowsVirtualKeyCode: vk, modifiers: mod }); };
const command = async (title) => { await key("F1", "F1", 112); await sleep(800); await cdp("Input.insertText", { text: title }); await sleep(1000); await key("Enter", "Enter", 13); };
const tracks = async () => {
  for (let i = 0; i < 40; i++) {
    for (const c of contexts.filter((c) => c.origin.startsWith("vscode-webview"))) {
      try { const t = await evalIn(c, "document.getElementById('trackName') ? document.getElementById('trackName').textContent + ' / lanes ' + document.querySelectorAll('#laneChecks input').length : null"); if (t) return t; } catch {}
    }
    await sleep(500);
  }
  return null;
};
const tabs = () => evalIn(undefined, "[...document.querySelectorAll('.tab')].map((t) => t.textContent.trim() + (t.classList.contains('dirty') ? ' [dirty]' : ''))");

await connect();
const before = await tracks();
await command("Reload test: Add a Voice Line");
await sleep(2500);
const added = await tracks();
const tabsBefore = await tabs();
const file = fs.readdirSync(path.join(T, "proj"), { recursive: true }).find((f) => String(f).endsWith(".edgewave"));
const onDisk = JSON.parse(fs.readFileSync(path.join(T, "proj", String(file)), "utf8")).tracks.length;
console.log(JSON.stringify({ before, added, tabsBefore, file, onDisk }));
if (!/lanes 1$/.test(before ?? "") || !/lanes 2$/.test(added ?? "") || onDisk !== 1 || !tabsBefore.some((t) => t.endsWith("[dirty]"))) done(false, "the voice line was not added as an unsaved edit");
await sleep(2000); // let a backup be written
await command("Developer: Reload Window");
await sleep(6000);
await connect();
await sleep(4000);
const after = await tracks();
await command("Reload test: Dump the Document");
await sleep(1500);
const dump = fs.existsSync(path.join(T, "dump.json")) ? JSON.parse(fs.readFileSync(path.join(T, "dump.json"), "utf8")) : null;
const tabsAfter = await tabs();
const backups = fs.existsSync(path.join(T, "ud", "Backups")) ? fs.readdirSync(path.join(T, "ud", "Backups"), { recursive: true }) : [];
console.log(JSON.stringify({ after, tabsAfter, dump }));
if (!/lanes 2$/.test(after ?? "") || !dump?.dirty || dump.tracks !== 2) done(false, "the unsaved edit was lost in the reload");
if (JSON.parse(fs.readFileSync(path.join(T, "proj", String(file)), "utf8")).tracks.length !== 1) done(false, "the reload saved the edit");

// Saved, then reloaded: the file has both tracks, nothing to put back.
// Ctrl+S on the editor's tab (focused by a click on it), as the modder saves.
await evalIn(undefined, "[...document.querySelectorAll('.tab')].find((t) => t.textContent.includes('.edgewave'))?.click()");
await sleep(600);
await key("s", "KeyS", 83, 2);
await sleep(2000);
const saved = JSON.parse(fs.readFileSync(path.join(T, "proj", String(file)), "utf8")).tracks.length;
await command("Developer: Reload Window");
await sleep(6000);
await connect();
await sleep(4000);
const again = await tracks();
fs.rmSync(path.join(T, "dump.json"), { force: true });
await command("Reload test: Dump the Document");
await sleep(1500);
const dump2 = fs.existsSync(path.join(T, "dump.json")) ? JSON.parse(fs.readFileSync(path.join(T, "dump.json"), "utf8")) : null;
const logs = fs.readdirSync(path.join(T, "ud", "logs"), { recursive: true }).filter((f) => String(f).endsWith("EDGEwave.log")).map((f) => fs.readFileSync(path.join(T, "ud", "logs", String(f)), "utf8")).join("");
const restoredCount = (logs.match(/Restored the unsaved edits/g) ?? []).length;
console.log(JSON.stringify({ saved, again, dump2, restoredCount }));
done(saved === 2 && /lanes 2$/.test(again ?? "") && dump2?.dirty === false && dump2.tracks === 2 && restoredCount === 1,
  "unsaved edits survive a reload (put back once, still unsaved, the file untouched); after Ctrl+S, a reload has nothing to put back");
