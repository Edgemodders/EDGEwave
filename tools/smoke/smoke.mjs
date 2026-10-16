// EDGEwave's smoke test: downloads VS Code (cached), runs EDGEwave beside a stand-in REDcode
// (tools/smoke/stub, serving a generated tone, so no game or bridge is needed), opens a sound through
// edgewave.openSound and drives the editor page over the DevTools protocol: select, trim, fade out,
// sample rate, voice line, render. Then it checks the saved document and the WAV.
//
//   npm run build && npm run smoke
//
// Runs in a short temp folder (VS Code's files pass Windows' 260-character path limit otherwise),
// with ELECTRON_RUN_AS_NODE cleared (VS Code's own terminals set it).
import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const T = path.join(os.tmpdir(), "ewsmoke");
fs.rmSync(path.join(T, "ud"), { recursive: true, force: true });
fs.rmSync(path.join(T, "proj"), { recursive: true, force: true });
fs.mkdirSync(path.join(T, "proj", "source", "raw"), { recursive: true });
fs.cpSync(path.join(here, "stub"), path.join(T, "stub"), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("[smoke]", ...a);

const exe = await downloadAndUnzipVSCode({ version: "stable", cachePath: path.join(T, "vsc") });
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const code = spawn(exe, ["--new-window", "--user-data-dir", path.join(T, "ud"), "--extensions-dir", path.join(T, "ex"), "--disable-extensions",
  "--extensionDevelopmentPath", repo, "--extensionDevelopmentPath", path.join(T, "stub"), "--remote-debugging-port=9339", "--force-device-scale-factor=1.5",
  "--skip-welcome", "--skip-release-notes", "--disable-workspace-trust", path.join(T, "proj")], { env, stdio: "ignore" });
const finish = (ok, msg) => { log(ok ? "PASS" : "FAIL", msg); code.kill(); process.exit(ok ? 0 : 1); };
setTimeout(() => finish(false, "timed out"), 120000);

// ---- DevTools: find the editor page's execution context, in the main target or an attached frame
let ws, nextId = 1; const waiting = new Map(); const contexts = [];
for (let i = 0; i < 60 && !ws; i++) {
  try {
    const pages = await (await fetch("http://127.0.0.1:9339/json")).json();
    const page = pages.find((p) => p.type === "page" && p.url.includes("workbench"));
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r)); }
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
let page;
for (let i = 0; i < 60 && !page; i++) {
  for (const c of contexts.filter((c) => c.origin.startsWith("vscode-webview"))) {
    try { if (await evalIn(c, "!!document.getElementById('render') && !!document.getElementById('canvas')")) { page = c; break; } } catch {}
  }
  if (!page) await sleep(1000);
}
if (!page) finish(false, "the editor page never appeared");
log("editor page found");
const run = (js) => evalIn(page, `(async () => { ${js} })()`);

// ---- the steps
for (let i = 0; i < 30; i++) { if (await run("return document.getElementById('note').hidden")) break; await sleep(500); }
const loaded = await run("return [document.getElementById('note').hidden, document.getElementById('title').textContent, document.getElementById('meta').textContent, document.getElementById('time').textContent]");
log("loaded", JSON.stringify(loaded));
if (!loaded[0]) finish(false, "the sound did not load: " + (await run("return document.getElementById('note').textContent")));

// The page fits the editor at 150% scaling: the waveform keeps its height and Render stays in view.
const h1 = await run("return document.getElementById('canvas').clientHeight");
await sleep(1500);
const fits = await run("const c = document.getElementById('canvas').clientHeight, r = document.getElementById('render').getBoundingClientRect(); return { canvas: c, renderBottom: Math.round(r.bottom), height: innerHeight, page: document.documentElement.scrollHeight }");
log("layout", JSON.stringify({ before: h1, ...fits }));
if (fits.canvas !== h1 || fits.renderBottom > fits.height || fits.page > fits.height) finish(false, "the page does not fit the editor");
const shot = await cdp("Page.captureScreenshot", { format: "png" });
fs.writeFileSync(path.join(T, "editor.png"), Buffer.from(shot.data, "base64"));
log("screenshot", path.join(T, "editor.png"));

const docFile = path.join(T, "proj", "source", "raw", "sfx", "smoke_event", "42.edgewave");
if (!fs.existsSync(docFile)) finish(false, "no document at " + docFile);

// Select 0.5 s to 1.5 s of the 2 s tone, then Trim.
await run(`
  const c = document.getElementById('canvas'), r = c.getBoundingClientRect();
  const x = (t) => r.left + (t / 2) * r.width, y = r.top + r.height / 2;
  const ev = (type, t) => c.dispatchEvent(new PointerEvent(type, { clientX: x(t), clientY: y, pointerId: 1, bubbles: true }));
  ev('pointerdown', 0.5); ev('pointermove', 1.0); ev('pointermove', 1.5); ev('pointerup', 1.5);`);
log("selection", await run("return document.getElementById('time').textContent"));
await run("document.getElementById('trim').click()");
await sleep(300);
await run("document.getElementById('fadeOut').click()");
await sleep(300);
// Cut 0.1 s to 0.3 s of the trimmed 1 s sound with Ctrl+X, click at 0.4 s, paste with Ctrl+V.
await run(`
  const c = document.getElementById('canvas'), r = c.getBoundingClientRect();
  const x = (t) => r.left + t * r.width, y = r.top + r.height / 2;
  const ev = (type, t) => c.dispatchEvent(new PointerEvent(type, { clientX: x(t), clientY: y, pointerId: 1, bubbles: true }));
  const key = (k) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true, bubbles: true }));
  ev('pointerdown', 0.1); ev('pointermove', 0.2); ev('pointermove', 0.3); ev('pointerup', 0.3);
  key('x');
  await new Promise((r) => setTimeout(r, 200));
  ev('pointerdown', 0.4); ev('pointerup', 0.4);
  key('v');`);
await sleep(300);
await run("const s = document.getElementById('rate'); s.value = '44100'; s.dispatchEvent(new Event('change'))");
await sleep(500);
const voiceHidden = await run("return document.getElementById('translate').hidden");
await run("const v = document.getElementById('voice'); v.checked = true; v.dispatchEvent(new Event('change'))");
const voiceShown = !(await run("return document.getElementById('translate').hidden"));
log("voice stubs: hidden before", voiceHidden, "shown after", voiceShown);

// A2: Add Sound through VS Code's quick pick (typed over DevTools), the radio preset, a start of 0.25 s.
const key = async (k, code, vk) => {
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk });
};
await run("document.getElementById('addSound').click()");
await sleep(1500);
await cdp("Input.insertText", { text: "smoke_second" });
await sleep(800);
await key("Enter", "Enter", 13);
await sleep(1000);
await key("Enter", "Enter", 13); // variation 1: sound 43
for (let i = 0; i < 20; i++) { if ((await run("return document.getElementById('trackName').textContent")).startsWith("2")) break; await sleep(500); }
const second = await run("return document.getElementById('trackName').textContent");
log("added", second);
if (!second.startsWith("2")) finish(false, "Add Sound did not add a track");
await sleep(500);
await run("const s = document.getElementById('trackPreset'); s.value = 'radio'; s.dispatchEvent(new Event('change'))");
await sleep(300);
await run("const s = document.getElementById('trackOffset'); s.value = '0.25'; s.dispatchEvent(new Event('change'))");
await sleep(800);
const fx = await run("return document.getElementById('trackEffects').children.length");
log("track 2 effects", fx, "render", await run("return document.getElementById('renderInfo').textContent"));
const shot2 = await cdp("Page.captureScreenshot", { format: "png" });
fs.writeFileSync(path.join(T, "mix.png"), Buffer.from(shot2.data, "base64"));
log("screenshot", path.join(T, "mix.png"));

await run("document.getElementById('render').click()");
const wav = path.join(T, "proj", "source", "raw", "sfx", "smoke_event", "42.wav");
for (let i = 0; i < 20 && !fs.existsSync(wav); i++) await sleep(500);
if (!fs.existsSync(wav)) finish(false, "no render at " + wav);
await sleep(500);
const doc = JSON.parse(fs.readFileSync(docFile, "utf8"));
log("document", JSON.stringify(doc));
const t1 = doc.tracks[0], t2 = doc.tracks[1];
const ops = t1.edits.map((e) => e.op).join(",");
if (doc.edgewave !== 2 || ops !== "trim,fade,cut,paste" || t1.edits[3].from.after !== 2 || doc.render.sampleRate !== 44100 || t1.voice !== true) finish(false, "the saved document does not hold track 1's edits");
if (!t2 || t2.source.soundHash !== 43 || t2.source.eventName !== "smoke_second" || t2.effects.length !== 5 || t2.offset !== 0.25) finish(false, "the saved document does not hold track 2");
const b = fs.readFileSync(wav);
const rate = b.readUInt32LE(24), ch = b.readUInt16LE(22), n = b.readUInt32LE(40) / (2 * ch);
const peakAt = (sec) => Math.max(...Array.from({ length: 400 }, (_, i) => Math.abs(b.readInt16LE(44 + (Math.floor(sec * rate) + i) * ch * 2))));
const early = peakAt(0.1), late = peakAt(1.5);
log("render", JSON.stringify({ rate, ch, seconds: n / rate, peakAt0_1: early, peakAt1_5: late }));
// The mix ends with track 2: 0.25 s + 1.5 s. At 1.5 s only track 2 (through the radio chain) plays.
const ok = rate === 44100 && ch === 2 && Math.abs(n / rate - 1.75) < 0.001 && early > 5000 && late > 1000 && voiceHidden && voiceShown && fx === 5;
finish(ok, ok ? "A1 edits, and A2: Add Sound, preset, start, a two-track render" : "render or mix checks failed");
