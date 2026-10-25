// The release's packaged test: installs the built .vsix into a clean VS Code, which installs REDcode
// for Cyberpunk 2077 from the Marketplace as its dependency (so it needs the network), opens a sound
// document on a generated tone, and checks that the page loads it, renders it, and that Add to Project
// reaches REDcode's API (with no REDcode project open, it says to open one).
//
//   npm run package && node tools/vsix-test.mjs
//
// Runs in a short temp folder, like the smoke test, with the VS Code it downloaded.
import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath } from "@vscode/test-electron";
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { name, version } = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));
const vsix = path.join(repo, `${name}-${version}.vsix`);
if (!fs.existsSync(vsix)) throw new Error(`${path.basename(vsix)} is missing: npm run package first`);
const T = path.join(os.tmpdir(), "ewvsix");
for (const d of ["ud", "ex", "proj"]) fs.rmSync(path.join(T, d), { recursive: true, force: true });
fs.mkdirSync(path.join(T, "proj"), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("[vsix]", ...a);

// A one-second tone and a document with it as its one track.
const rate = 48000, n = rate;
const pcm = Buffer.alloc(n * 2);
for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(0.4 * 32767 * Math.sin((2 * Math.PI * 440 * i) / rate)), i * 2);
const h = Buffer.alloc(44);
h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
fs.writeFileSync(path.join(T, "proj", "tone.wav"), Buffer.concat([h, pcm]));
const docFile = path.join(T, "proj", "tone.edgewave");
fs.writeFileSync(docFile, JSON.stringify({ edgewave: 2, tracks: [{ id: "t1", source: { kind: "file", file: "tone.wav" }, edits: [], offset: 0, gain: 0, pan: 0, effects: [] }], master: { gain: 0, effects: [] }, render: { file: "tone.edit.wav" } }, null, 2));

const exe = await downloadAndUnzipVSCode({ version: "stable", cachePath: path.join(os.tmpdir(), "ewsmoke", "vsc") });
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const profile = ["--user-data-dir", path.join(T, "ud"), "--extensions-dir", path.join(T, "ex")];
// The CLI is code.cmd on Windows, which Node runs only through the shell, so every argument is quoted.
const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(exe, { reuseMachineInstall: true });
const q = (a) => `"${a}"`;
const installed = spawnSync(q(cli), [...cliArgs.filter((a) => !a.startsWith("--extensions-dir") && !a.startsWith("--user-data-dir")), ...profile, "--install-extension", vsix].map(q), { env, encoding: "utf8", shell: true });
log("install", (installed.stdout + installed.stderr).trim().replace(/\s+/g, " "));
const exts = fs.readdirSync(path.join(T, "ex")).filter((d) => !d.startsWith("."));
log("extensions", JSON.stringify(exts));
if (!exts.some((d) => d.startsWith(`edgemodders.${name}-${version}`)) || !exts.some((d) => d.startsWith("edgemodders.redcode-cyberpunk-"))) {
  log("FAIL EDGEwave and REDcode are not both installed");
  process.exit(1);
}

const code = spawn(exe, ["--new-window", ...profile, "--remote-debugging-port=9341", "--skip-welcome", "--skip-release-notes", "--disable-workspace-trust", path.join(T, "proj")], { env, stdio: "ignore" });
const finish = (ok, msg) => { log(ok ? "PASS" : "FAIL", msg); code.kill(); process.exit(ok ? 0 : 1); };
setTimeout(() => finish(false, "timed out"), 180000);

let ws, nextId = 1; const waiting = new Map(); const contexts = [];
for (let i = 0; i < 60 && !ws; i++) {
  try {
    const pages = await (await fetch("http://127.0.0.1:9341/json")).json();
    const p = pages.find((p) => p.type === "page" && p.url.includes("workbench"));
    if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r)); }
  } catch {}
  if (!ws) await sleep(1000);
}
if (!ws) finish(false, "no DevTools target");
const cdp = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = nextId++; waiting.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, sessionId }));
});
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { const w = waiting.get(m.id); waiting.delete(m.id); m.error ? w.reject(new Error(m.error.message)) : w.resolve(m.result); return; }
  if (m.method === "Runtime.executionContextCreated") contexts.push({ id: m.params.context.id, origin: m.params.context.origin, sessionId: m.sessionId });
  if (m.method === "Target.attachedToTarget") {
    const s = m.params.sessionId;
    cdp("Runtime.enable", {}, s).catch(() => {});
    cdp("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, s).catch(() => {});
    cdp("Runtime.runIfWaitingForDebugger", {}, s).catch(() => {});
  }
});
await cdp("Runtime.enable");
await cdp("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
const evalIn = async (c, expression) => {
  const r = await cdp("Runtime.evaluate", { expression, contextId: c.id, awaitPromise: true, returnByValue: true }, c.sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const bench = contexts.find((c) => !c.sessionId) ?? contexts[0];
// Open the document as a modder would, with Quick Open (Ctrl+P), once the workbench is up: a file
// passed on the command line to a new profile opens before VS Code has read the extensions' editors.
for (let i = 0; i < 60; i++) { if (await evalIn(bench, "!!document.querySelector('.explorer-folders-view .monaco-list-row')").catch(() => false)) break; await sleep(500); }
await sleep(2000);
const key = async (k, code, vk, modifiers = 0) => {
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers });
};
await key("p", "KeyP", 80, 2);
await sleep(800);
await cdp("Input.insertText", { text: "tone.edgewave" });
await sleep(1200);
await key("Enter", "Enter", 13);
let page;
for (let i = 0; i < 90 && !page; i++) {
  for (const c of contexts.filter((c) => c.origin.startsWith("vscode-webview"))) {
    try { if (await evalIn(c, "!!document.getElementById('render') && !!document.getElementById('canvas')")) { page = c; break; } } catch {}
  }
  if (!page) await sleep(1000);
}
if (!page) {
  fs.writeFileSync(path.join(T, "nopage.png"), Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"));
  finish(false, `the editor page never appeared (${path.join(T, "nopage.png")})`);
}
const run = (js) => evalIn(page, `(async () => { ${js} })()`);
for (let i = 0; i < 30; i++) { if (await run("return document.getElementById('note').hidden")) break; await sleep(500); }
const loaded = await run("return [document.getElementById('note').hidden, document.getElementById('meta').textContent, document.getElementById('time').textContent]");
log("loaded", JSON.stringify(loaded));
if (!loaded[0]) finish(false, "the sound did not load: " + (await run("return document.getElementById('note').textContent")));

// Render: the WAV beside the document.
await run("document.getElementById('render').click()");
const wav = path.join(T, "proj", "tone.edit.wav");
let rendered = "";
for (let i = 0; i < 20 && !rendered; i++) {
  rendered = fs.readdirSync(path.join(T, "proj")).filter((f) => f.endsWith(".wav") && f !== "tone.wav").join();
  if (!rendered) await sleep(500);
}
log("rendered", rendered, fs.existsSync(wav));

// Add to Project: EDGEwave asks REDcode's API for the project; with none open, it says to open one.
await run("document.getElementById('intoGame').click()");
let toast = "";
for (let i = 0; i < 20 && !toast; i++) {
  const texts = await evalIn(bench, "[...document.querySelectorAll('.notifications-toasts .notification-list-item-message')].map((e) => e.textContent)");
  toast = texts.find((t) => /REDcode project/.test(t)) ?? "";
  if (!toast) await sleep(500);
}
log("add to project", toast);
const ok = fs.existsSync(wav) && /Open a REDcode project first/.test(toast);
finish(ok, ok ? `${path.basename(vsix)} with REDcode ${exts.find((d) => d.startsWith("edgemodders.redcode-cyberpunk-")).match(/\d+\.\d+\.\d+/)[0]}: the page loads and renders a sound, and Add to Project reaches REDcode's API` : "the packaged extension did not do what it should");
