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
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const T = path.join(os.tmpdir(), "ewsmoke");
fs.rmSync(path.join(T, "ud"), { recursive: true, force: true });
fs.rmSync(path.join(T, "proj"), { recursive: true, force: true });
fs.rmSync(path.join(T, "imported.json"), { force: true });
fs.mkdirSync(path.join(T, "proj", "source", "raw"), { recursive: true });
fs.cpSync(path.join(here, "stub"), path.join(T, "stub"), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("[smoke]", ...a);

// A stand-in ElevenLabs (the voice tools): tones as 16-bit PCM at the asked rate. Like a plan without
// 48 kHz it refuses pcm_48000, so EDGEwave falls back to 24 kHz. Every request is recorded.
const eleven = [];
const pcmTone = (seconds, rate, hz) => {
  const n = Math.round(seconds * rate), b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(0.4 * 32767 * Math.sin(2 * Math.PI * hz * i / rate)), i * 2);
  return b;
};
const wavOf = (pcm, rate) => {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
};
const elevenServer = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("latin1");
    const fmt = url.searchParams.get("output_format");
    eleven.push({ method: req.method, path: url.pathname, fmt, key: req.headers["xi-api-key"], body: body.slice(0, 400) });
    const json = (o, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    if (fmt === "pcm_48000") return json({ detail: { status: "output_format_not_allowed", message: "pcm_48000 is not available on your plan" } }, 403);
    const rate = fmt ? Number(fmt.split("_")[1]) : 24000;
    const p = url.pathname;
    if (p === "/v2/voices") return json({ voices: [{ voice_id: "v_smoke", name: "Smoke Voice", labels: { gender: "female", accent: "american" }, category: "premade", preview_url: `http://127.0.0.1:${elevenServer.address().port}/preview/v_smoke.wav` }], has_more: false });
    if (p.startsWith("/preview/")) { res.writeHead(200, { "content-type": "audio/wav" }); return res.end(wavOf(pcmTone(0.3, 24000, 500), 24000)); }
    if (p === "/v1/models") return json([{ model_id: "eleven_multilingual_v2", name: "Eleven Multilingual v2", can_do_text_to_speech: true }, { model_id: "eleven_multilingual_sts_v2", name: "Eleven Multilingual v2 STS", can_do_voice_conversion: true }]);
    if (p === "/v1/voices/add") return json({ voice_id: "clone_smoke", requires_verification: false });
    if (p === "/v1/text-to-voice") return json({ voice_id: "remix_saved" });
    if (p.endsWith("/remix")) return json({ previews: [1, 2].map((i) => ({ generated_voice_id: `gen_${i}`, audio_base_64: pcmTone(0.4, rate, 300 + 100 * i).toString("base64"), media_type: "audio/pcm", duration_secs: 0.4 })), text: "…" });
    const pcm = p === "/v1/sound-generation" ? pcmTone(0.5, rate, 220) : p.startsWith("/v1/text-to-speech/") ? pcmTone(0.8, rate, 330) : p.startsWith("/v1/speech-to-speech/") ? pcmTone(1.0, rate, 440) : null;
    if (!pcm) return json({ detail: "not found" }, 404);
    res.writeHead(200, { "content-type": "application/octet-stream" });
    res.end(pcm);
  });
});
await new Promise((r) => elevenServer.listen(0, "127.0.0.1", r));
fs.mkdirSync(path.join(T, "ud", "User"), { recursive: true });
// Custom dialogs, so the clone consent's modal is in the page and can be clicked.
fs.writeFileSync(path.join(T, "ud", "User", "settings.json"), JSON.stringify({ "edgewave.elevenlabs.baseUrl": `http://127.0.0.1:${elevenServer.address().port}`, "window.dialogStyle": "custom" }));

const exe = await downloadAndUnzipVSCode({ version: "stable", cachePath: path.join(T, "vsc") });
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const code = spawn(exe, ["--new-window", "--user-data-dir", path.join(T, "ud"), "--extensions-dir", path.join(T, "ex"), "--disable-extensions",
  "--extensionDevelopmentPath", repo, "--extensionDevelopmentPath", path.join(T, "stub"), "--remote-debugging-port=9339", "--force-device-scale-factor=1.5",
  "--skip-welcome", "--skip-release-notes", "--disable-workspace-trust", path.join(T, "proj")], { env, stdio: "ignore" });
const finish = (ok, msg) => { log(ok ? "PASS" : "FAIL", msg); code.kill(); process.exit(ok ? 0 : 1); };
setTimeout(() => finish(false, "timed out"), 240000);

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
// The owner's A2 findings, kept fixed:
// Apply gain is an edit; Fade in works with no selection and the cursor at the start.
await run("const g = document.getElementById('gainDb'); g.value = '-12'; document.getElementById('gain').click()");
await sleep(300);
await run("document.getElementById('fadeIn').click()");
await sleep(300);
// Right-click keeps the selection and opens the clip's menu.
const rightClick = await run(`
  const c = document.getElementById('canvas'), r = c.getBoundingClientRect();
  const x = (t) => r.left + (t / 1.5) * r.width, y = r.top + r.height / 2;
  const ev = (type, t, button = 0) => c.dispatchEvent(new PointerEvent(type, { clientX: x(t), clientY: y, pointerId: 1, button, bubbles: true }));
  ev('pointerdown', 0.6); ev('pointermove', 0.8); ev('pointermove', 1.0); ev('pointerup', 1.0);
  const before = document.getElementById('time').textContent;
  ev('pointerdown', 0.2, 2); ev('pointerup', 0.2, 2);
  c.dispatchEvent(new MouseEvent('contextmenu', { clientX: x(0.2), clientY: y, button: 2, bubbles: true, cancelable: true }));
  const menu = document.querySelector('.menu');
  const out = { kept: document.getElementById('time').textContent === before, menu: !menu.hidden, items: menu.children.length };
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return out;`);
log("right-click", JSON.stringify(rightClick));
// The next-edge button: from 0 to track 2's start.
await run("document.getElementById('toNext').click()");
const edge = await run("return document.getElementById('mixTime').textContent");
log("next edge", edge);
// Remove track 2, then undo (Ctrl+Z): it comes back selected.
await run("document.getElementById('removeTrack').click()");
await sleep(800);
await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "z", code: "KeyZ", windowsVirtualKeyCode: 90, modifiers: 2 });
await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "z", code: "KeyZ", windowsVirtualKeyCode: 90, modifiers: 2 });
await sleep(1200);
const afterUndo = await run("return document.getElementById('trackName').textContent");
log("after undo", afterUndo);
const findings = rightClick.kept && rightClick.menu && rightClick.items === 11 && edge.startsWith("0:00.250") && afterUndo.startsWith("2");
if (!findings) finish(false, "one of the A2 findings is back");

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
// The A2 render, read now, before Into the Game writes beside it.
const renderedWav = fs.readFileSync(wav);
log("document", JSON.stringify(doc));
// The workbench itself (not the webview), for VS Code's own dialog and quick pick.
let bench;
for (const c of contexts.filter((c) => !c.origin.startsWith("vscode-webview"))) {
  try { if (await evalIn(c, "!!document.querySelector('.monaco-workbench')")) { bench = c; break; } } catch {}
}
// A3: Into the Game, both routes, through the real quick picks. The override replaces track 2's sound
// (43, mono), so the target is not track 1 and the WAV has the target's channels.
const pickFirst = async (filter) => {
  await sleep(1200);
  if (filter) await cdp("Input.insertText", { text: filter });
  await sleep(600);
  await key("Enter", "Enter", 13);
};
await run("document.getElementById('intoGame').click()");
await sleep(1500);
fs.writeFileSync(path.join(T, "intogame.png"), Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"));
await cdp("Input.insertText", { text: "Override sound 43" });
await sleep(600);
await key("Enter", "Enter", 13);
const imported = path.join(T, "imported.json");
for (let i = 0; i < 20 && !fs.existsSync(imported); i++) await sleep(500);
const override = fs.existsSync(imported) ? JSON.parse(fs.readFileSync(imported, "utf8")).file : null;
log("override imported", override);
await sleep(800);
await key("Escape", "Escape", 27); // the notification
await run("document.getElementById('intoGame').click()");
// Both tracks are in the mix: they come in the mixer's order, the last choice (track 2's override) marked where it is.
await sleep(1200);
const firstRows = await evalIn(bench, `[...document.querySelectorAll('.quick-input-list .monaco-list-row')].slice(0, 6).map((r) => r.textContent.trim())`);
log("into the game, second time", JSON.stringify(firstRows));
const lastFirst = /^Override sound 42/.test(firstRows[0] ?? "") && !/last time/.test(firstRows[0]) && firstRows.some((r) => /^Override sound 43/.test(r) && /last time/.test(r));
await pickFirst("Replace the event smoke_event");
await pickFirst(""); // 2D
const info = path.join(T, "proj", "source", "resources", "info.json");
const custom = path.join(T, "proj", "source", "customSounds", "smoke_event.wav");
for (let i = 0; i < 20 && !fs.existsSync(info); i++) await sleep(500);
await sleep(800);
const infoJson = fs.existsSync(info) ? JSON.parse(fs.readFileSync(info, "utf8")) : null;
log("REDmod info.json", JSON.stringify(infoJson));
const wavFormat = (f) => { const x = fs.readFileSync(f); return { rate: x.readUInt32LE(24), ch: x.readUInt16LE(22) }; };
const overrideFormat = override && fs.existsSync(override) ? wavFormat(override) : null;
const customFormat = fs.existsSync(custom) ? wavFormat(custom) : null;
log("formats", JSON.stringify({ overrideFormat, customFormat }));
const game = JSON.parse(fs.readFileSync(docFile, "utf8")).game;
log("document game", JSON.stringify(game));
const a3 =
  !!override && path.basename(override) === "43.wav" && overrideFormat?.rate === 48000 && overrideFormat?.ch === 1 &&
  customFormat?.rate === 48000 && customFormat.ch === 2 && infoJson?.customSounds?.[0]?.name === "smoke_event" && infoJson.customSounds[0].type === "mod_sfx_2d" && infoJson.customSounds[0].file === "smoke_event.wav" &&
  game?.route === "redmod" && game.type === "mod_sfx_2d" && lastFirst;
if (!a3) finish(false, "Into the Game did not write what it should");
// Silence the same event: this document wrote its WAV, so no question; the type as last time (2D);
// the same WAV as the replacement, every sample zeroed; not a mod_skip.
const replaced = fs.readFileSync(custom);
await sleep(800);
await key("Escape", "Escape", 27); // the notification
await run("document.getElementById('intoGame').click()");
await pickFirst("Silence the event smoke_event");
await pickFirst(""); // 2D, last time's type
let silentBytes = replaced;
for (let i = 0; i < 20 && silentBytes.subarray(44).some((b) => b !== 0); i++) {
  await sleep(500);
  silentBytes = fs.readFileSync(custom);
}
const silenced = JSON.parse(fs.readFileSync(info, "utf8")).customSounds;
const docGame = JSON.parse(fs.readFileSync(docFile, "utf8")).game;
log("silence", JSON.stringify({ silenced, docGame, bytes: silentBytes.length, replacedBytes: replaced.length, ch: silentBytes.readUInt16LE(22) }));
const silenceOk =
  silenced?.length === 1 && silenced[0].type === "mod_sfx_2d" && silenced[0].file === "smoke_event.wav" && silenced[0].gain === 1 &&
  silentBytes.length === replaced.length && silentBytes.subarray(0, 44).equals(replaced.subarray(0, 44)) && silentBytes.subarray(44).every((b) => b === 0) &&
  docGame?.route === "skip" && docGame.type === "mod_sfx_2d";
if (!silenceOk) finish(false, "Silence the event did not write a silent WAV");

// Voice tools, against the stand-in ElevenLabs: Generate Sound (asks for the key), Speak Line in a
// picked voice (with its preview), Speak Line in track 1's voice (the clone consent), Re-Voice by
// description (remix previews, reusing the clone). Each adds a track.
const tracksNow = () => run("return document.getElementById('trackName').textContent");
const waitTrack = async (n) => { for (let i = 0; i < 40; i++) { if ((await tracksNow()).startsWith(`${n} `)) return true; await sleep(500); } return false; };
const dialogStatus = () => run("return document.querySelector('#dialog .status')?.textContent ?? ''");
const selectLane = (lane) => run(`
  const c = document.getElementById('mix'), r = c.getBoundingClientRect();
  const y = r.top + 18 + 1 + ${lane} * 36 + 18, x = r.left + 4;
  c.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerId: 2, button: 0, bubbles: true }));
  c.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, pointerId: 2, button: 0, bubbles: true }));`);
const clickDialogButton = async (text) => {
  for (let i = 0; i < 20; i++) {
    const done = await evalIn(bench, `(() => { const b = [...document.querySelectorAll('.monaco-dialog-box .dialog-buttons .monaco-button')].find((x) => x.textContent.includes(${JSON.stringify(text)})); if (b) b.click(); return !!b; })()`);
    if (done) return true;
    await sleep(500);
  }
  return false;
};

// Generate Sound makes takes in the dialog; only the one added becomes a track.
const takeCount = (n) => run(`for (let i = 0; i < 40 && document.querySelectorAll('#dialog .takes .voice').length < ${n}; i++) await new Promise((r) => setTimeout(r, 250));
  return document.querySelectorAll('#dialog .takes .voice').length`);
await run(`document.getElementById('generateSound').click(); await new Promise((r) => setTimeout(r, 300));
  document.querySelector('#dialog textarea').value = 'a metal door slams';
  document.querySelector('#dialog .actions .primary').click();`);
await sleep(1500);
await cdp("Input.insertText", { text: "smoke-key" }); // the key's input box
await key("Enter", "Enter", 13);
const take1 = await takeCount(1);
await run(`document.querySelector('#dialog textarea').value = 'a metal door slams, long echo';
  document.querySelector('#dialog .actions .primary').click();`);
const take2 = await takeCount(2);
await run("document.querySelector('#dialog .takes .voice:last-child button.icon').click()"); // play take 1
await sleep(600);
const takes = await run(`return { open: !document.getElementById('dialog').hidden, status: document.querySelector('#dialog .status').textContent, playing: !!document.querySelector('#dialog .takes button.icon.on'), first: document.querySelector('#dialog .takes .vname').textContent }`);
const notAdded = !(await tracksNow()).startsWith("3 ");
log("generate sound takes", JSON.stringify({ take1, take2, notAdded, ...takes }));
fs.writeFileSync(path.join(T, "takes.png"), Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"));
log("screenshot", path.join(T, "takes.png"));
await run("document.querySelector('#dialog .takes button.add').click()"); // add take 2, the newest, on top
const generated = take1 === 1 && take2 === 2 && notAdded && takes.open && takes.playing && takes.first === "Take 2" && !/cannot/.test(takes.status) && (await waitTrack(3));
log("generate sound", generated, await dialogStatus());
await run(`document.getElementById('speakLine').click();
  for (let i = 0; i < 40 && !document.querySelector('#dialog .voice'); i++) await new Promise((r) => setTimeout(r, 250));
  document.querySelector('#dialog textarea').value = 'Wake up, samurai.';
  document.querySelector('#dialog .voice input').click();
  document.querySelector('#dialog .voice button').click();`);
await sleep(1200);
const preview = await run("return { status: document.querySelector('#dialog .status').textContent, models: document.querySelector('#dialog select').options.length }");
log("voice preview", JSON.stringify(preview));
await run("document.querySelector('#dialog .actions .primary').click()");
const spoken = await waitTrack(4);
log("speak line", spoken, await dialogStatus());
await selectLane(0);
await sleep(500);
await run(`document.getElementById('speakLine').click(); await new Promise((r) => setTimeout(r, 300));
  document.querySelector('#dialog textarea').value = 'In my own voice.';
  document.querySelector('#dialog .actions .primary').click();`);
const consented = await clickDialogButton("I have the right");
const cloned = await waitTrack(5);
log("speak in the line's voice", { consented, cloned }, await dialogStatus());
await selectLane(0);
await sleep(500);
await run(`document.getElementById('revoice').click(); await new Promise((r) => setTimeout(r, 300));
  document.querySelector('#dialog .describe textarea').value = 'female, calm';
  document.querySelector('#dialog .describe button').click();
  for (let i = 0; i < 40 && !document.querySelector('#dialog .describe .voice'); i++) await new Promise((r) => setTimeout(r, 250));`);
const shot3 = await cdp("Page.captureScreenshot", { format: "png" });
fs.writeFileSync(path.join(T, "revoice.png"), Buffer.from(shot3.data, "base64"));
log("screenshot", path.join(T, "revoice.png"));
await run("document.querySelector('#dialog .actions .primary').click()");
const revoiced = await waitTrack(6);
log("re-voice", revoiced, await dialogStatus());
// The new tracks are unsaved changes, as Add Sound's are: Ctrl+S.
await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "s", code: "KeyS", windowsVirtualKeyCode: 83, modifiers: 2 });
await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "s", code: "KeyS", windowsVirtualKeyCode: 83, modifiers: 2 });
await sleep(1200);
const vdoc = JSON.parse(fs.readFileSync(docFile, "utf8"));
const made = vdoc.tracks.slice(2).map((t) => ({ id: t.id, file: t.source.file, voice: !!t.voice, offset: t.offset, made: t.made }));
log("voice tracks", JSON.stringify(made));
log("ElevenLabs requests", JSON.stringify(eleven.map((r) => `${r.method} ${r.path}${r.fmt ? ` ${r.fmt}` : ""}`)));
const genFormats = made.map((t) => (t.file && fs.existsSync(path.join(path.dirname(docFile), t.file)) ? wavFormat(path.join(path.dirname(docFile), t.file)).rate : null));
const posts = eleven.filter((r) => r.method === "POST");
const voiceOk =
  generated && spoken && cloned && revoiced && consented && !preview.status && preview.models >= 2 &&
  made.length === 4 && genFormats.every((r) => r === 24000) &&
  made[0].made?.tool === "sound" && made[0].made.prompt === "a metal door slams, long echo" &&!made[0].voice &&
  made[1].made?.tool === "speak" && made[1].made.voiceId === "v_smoke" && made[1].voice &&
  made[2].made?.tool === "speak" && made[2].made.voiceId === "clone_smoke" && made[2].made.from === "t1" &&
  made[3].made?.tool === "revoice" && made[3].made.voiceId === "remix_saved" && made[3].made.description === "female, calm" && made[3].offset === vdoc.tracks[0].offset &&
  vdoc.tracks[0].mute === true &&
  eleven.every((r) => r.path.startsWith("/preview/") ? !r.key : r.key === "smoke-key") &&
  posts[0].path === "/v1/sound-generation" && posts[0].fmt === "pcm_48000" && posts[1].fmt === "pcm_24000" &&
  eleven.filter((r) => r.path === "/v1/voices/add").length === 1 && eleven.filter((r) => r.fmt === "pcm_48000").length === 1;
if (!voiceOk) finish(false, "the voice tools did not do what they should");

// The lanes' checkboxes: track 1 (left out by Re-Voice) is unchecked; check it. Then right-click the
// generated sound's lane > Only This Track: a file alone in the mix, so Into the Game offers the named
// event first, saying why.
const checks = () => run("return [...document.querySelectorAll('#laneChecks input')].map((b) => b.checked)");
const checksBefore = await checks();
await run("document.querySelector('#laneChecks input').click()");
await sleep(400);
const checksAfter = await checks();
await run(`
  const c = document.getElementById('mix'), r = c.getBoundingClientRect();
  c.dispatchEvent(new MouseEvent('contextmenu', { clientX: r.left + 40, clientY: r.top + 18 + 1 + 2 * 36 + 18, bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  [...document.querySelectorAll('.menu button')].find((b) => b.textContent === 'Only This Track').click();`);
await sleep(400);
const checksOnly = await checks();
await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "s", code: "KeyS", windowsVirtualKeyCode: 83, modifiers: 2 });
await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "s", code: "KeyS", windowsVirtualKeyCode: 83, modifiers: 2 });
await sleep(1200);
const mutes = JSON.parse(fs.readFileSync(docFile, "utf8")).tracks.map((t) => !!t.mute);
await run("document.getElementById('intoGame').click()");
await sleep(1500);
const fileRows = await evalIn(bench, `[...document.querySelectorAll('.quick-input-list .monaco-list-row')].slice(0, 3).map((r) => r.textContent.trim())`);
await key("Escape", "Escape", 27);
log("checkboxes", JSON.stringify({ checksBefore, checksAfter, checksOnly, mutes, fileRows }));
const checksOk =
  JSON.stringify(checksBefore) === JSON.stringify([false, true, true, true, true, true]) &&
  JSON.stringify(checksAfter) === JSON.stringify([true, true, true, true, true, true]) &&
  JSON.stringify(checksOnly) === JSON.stringify([false, false, true, false, false, false]) &&
  JSON.stringify(mutes) === JSON.stringify([true, true, false, true, true, true]) &&
  /^\$?\(?.*A REDmod custom sound for an event/.test(fileRows[0] ?? "") && /No track in the mix is a game sound effect \(track 3\)/.test(fileRows[0] ?? "");
if (!checksOk) finish(false, "the lanes' checkboxes or Only This Track did not set the mix");

// The splitter under the track bar: six tracks show four until it is dragged; drag far up to the
// one-lane least, then one lane down; double-click fits every track, as far as the waveform's least height allows.
const lanesH = () => run("return document.querySelector('.lanes').offsetHeight");
const dragSplit = (dy) => run(`
  const s = document.getElementById('split'), r = s.getBoundingClientRect(), y = r.top + 3;
  const ev = (type, cy) => s.dispatchEvent(new PointerEvent(type, { clientX: r.left + 50, clientY: cy, pointerId: 7, button: 0, bubbles: true }));
  ev('pointerdown', y); ev('pointermove', y + ${dy} / 2); ev('pointermove', y + ${dy}); ev('pointerup', y + ${dy});`);
const split0 = await lanesH();
await dragSplit(-1000);
await sleep(200);
const split1 = await lanesH();
await dragSplit(36);
await sleep(200);
const split2 = await lanesH();
const spare = await run("return document.getElementById('wave').offsetHeight - 110");
await run("document.getElementById('split').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))");
await sleep(200);
const split3 = await lanesH();
log("splitter", JSON.stringify({ split0, split1, split2, spare, split3 }));
const splitOk = split0 === 19 + 4 * 36 + 2 && split1 === 19 + 36 + 2 && split2 === split1 + 36 && split3 === Math.min(19 + 6 * 36 + 2, split2 + spare) && split3 > split2;
if (!splitOk) finish(false, "the splitter did not resize the lanes");

// Moving lanes: drag track 3's lane up above track 1 (its clip keeps its start); right-click the top lane >
// Move Down; then undo.
const saveDoc = async () => {
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "s", code: "KeyS", windowsVirtualKeyCode: 83, modifiers: 2 });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "s", code: "KeyS", windowsVirtualKeyCode: 83, modifiers: 2 });
  await sleep(1200);
  return JSON.parse(fs.readFileSync(docFile, "utf8")).tracks.map((t) => t.id);
};
// First sideways, with a little wobble: track 1's clip moves in time, the order stays.
const sideBefore = JSON.parse(fs.readFileSync(docFile, "utf8")).tracks;
await run(`
  const box = document.querySelector('.lanes'); box.scrollTop = 0;
  const c = document.getElementById('mix'), r = c.getBoundingClientRect();
  const t1 = ${JSON.stringify(sideBefore[0].offset)}, x = r.left + 5, y = r.top + 19 + 18;
  const ev = (type, cx, cy) => c.dispatchEvent(new PointerEvent(type, { clientX: cx, clientY: cy, pointerId: 9, button: 0, bubbles: true }));
  ev('pointerdown', x, y); ev('pointermove', x + 8, y + 3); ev('pointermove', x + 40, y + 6); ev('pointerup', x + 40, y + 6);`);
await sleep(400);
await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "s", code: "KeyS", windowsVirtualKeyCode: 83, modifiers: 2 });
await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "s", code: "KeyS", windowsVirtualKeyCode: 83, modifiers: 2 });
await sleep(1200);
const before0 = JSON.parse(fs.readFileSync(docFile, "utf8")).tracks;
const sidewaysOk = before0.map((t) => t.id).join() === sideBefore.map((t) => t.id).join() && before0[0].offset > sideBefore[0].offset;
log("sideways", JSON.stringify({ from: sideBefore[0].offset, to: before0[0].offset, sidewaysOk }));
const order0 = before0.map((t) => t.id);
await run(`
  const box = document.querySelector('.lanes'); box.scrollTop = 0;
  const c = document.getElementById('mix'), r = c.getBoundingClientRect(), x = r.left + 3, y = r.top + 19 + 2 * 36 + 18;
  const ev = (type, cx, cy) => c.dispatchEvent(new PointerEvent(type, { clientX: cx, clientY: cy, pointerId: 8, button: 0, bubbles: true }));
  ev('pointerdown', x, y); ev('pointermove', x + 2, y - 10); ev('pointermove', x + 3, y - 50); ev('pointermove', x + 3, r.top + 19 + 4);
  window.__dropShown = !document.querySelector('.dropline').hidden;
  ev('pointerup', x + 3, r.top + 19 + 4);`);
await sleep(400);
const dropShown = await run("return window.__dropShown");
await run(`
  const c = document.getElementById('mix'), r = c.getBoundingClientRect();
  c.dispatchEvent(new MouseEvent('contextmenu', { clientX: r.left + 40, clientY: r.top + 19 + 18, bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));
  [...document.querySelectorAll('.menu button')].find((b) => b.textContent === 'Move Down').click();`);
await sleep(400);
const order1 = await saveDoc();
await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "z", code: "KeyZ", windowsVirtualKeyCode: 90, modifiers: 2 });
await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "z", code: "KeyZ", windowsVirtualKeyCode: 90, modifiers: 2 });
await sleep(800);
const order2 = await saveDoc();
log("move lanes", JSON.stringify({ order0, dropShown, order1, order2 }));
const [o0, o1, o2] = [order0, order1, order2].map((o) => o.join());
const [a0, b0, c0, ...rest0] = order0;
const offsetKept = JSON.parse(fs.readFileSync(docFile, "utf8")).tracks.find((t) => t.id === order0[2]).offset === before0[2].offset;
const moveOk = sidewaysOk && dropShown === true && offsetKept && o1 === [a0, c0, b0, ...rest0].join() && o2 === [c0, a0, b0, ...rest0].join() && o0 !== o1;
if (!moveOk) finish(false, "moving lanes did not reorder the tracks");

// The Sounds view: Project (the open folder) and Recent (opened lately), each listing 42.
await key("F1", "F1", 112);
await sleep(600);
await cdp("Input.insertText", { text: "EDGEwave: Focus on Sounds View" });
await sleep(800);
await key("Enter", "Enter", 13);
let soundRows = [];
for (let i = 0; i < 20; i++) {
  soundRows = await evalIn(bench, `[...document.querySelectorAll('.part.sidebar .monaco-list-row')].filter((r) => r.offsetParent).map((r) => r.textContent.trim())`);
  if (soundRows.some((r) => r.startsWith("Recent"))) break;
  await sleep(500);
}
log("sounds view", JSON.stringify(soundRows));
const groupAt = (g) => soundRows.findIndex((r) => r.startsWith(g));
const viewOk = groupAt("Project") === 0 && groupAt("Recent") > 1 && soundRows[1].startsWith("42") && soundRows[groupAt("Recent") + 1]?.startsWith("42");
if (!viewOk) finish(false, "the Sounds view does not list 42 under Project and Recent");

const t1 = doc.tracks[0], t2 = doc.tracks[1];
const ops = t1.edits.map((e) => e.op).join(",");
if (doc.edgewave !== 2 || ops !== "trim,fade,cut,paste" || t1.edits[3].from.after !== 2 || doc.render.sampleRate !== 44100 || t1.voice !== true) finish(false, "the saved document does not hold track 1's edits");
if (!t2 || t2.source.soundHash !== 43 || t2.source.eventName !== "smoke_second" || t2.effects.length !== 5 || t2.offset !== 0.25) finish(false, "the saved document does not hold track 2");
const t2ops = JSON.stringify(t2.edits);
if (t2ops !== JSON.stringify([{ op: "gain", db: -12 }, { op: "fade", dir: "in", start: 0, end: 0.375, curve: "linear" }])) finish(false, "track 2's edits are not Apply gain and Fade in: " + t2ops);
const b = renderedWav;
const rate = b.readUInt32LE(24), ch = b.readUInt16LE(22), n = b.readUInt32LE(40) / (2 * ch);
const peakAt = (sec) => Math.max(...Array.from({ length: 400 }, (_, i) => Math.abs(b.readInt16LE(44 + (Math.floor(sec * rate) + i) * ch * 2))));
const early = peakAt(0.1), late = peakAt(1.5);
log("render", JSON.stringify({ rate, ch, seconds: n / rate, peakAt0_1: early, peakAt1_5: late }));
// The mix ends with track 2: 0.25 s + 1.5 s. At 1.5 s only track 2 (through the radio chain) plays.
const ok = rate === 44100 && ch === 2 && Math.abs(n / rate - 1.75) < 0.001 && early > 5000 && late > 1000 && voiceHidden && voiceShown && fx === 5;
finish(ok, ok ? "A1 edits; A2 Add Sound, preset, start, a two-track render; A3 Into the Game, override of track 2, REDmod and silence; voice tools against a stand-in ElevenLabs; the lanes' checkboxes and Only This Track; the splitter; moving lanes; the Sounds view" : "render or mix checks failed");
