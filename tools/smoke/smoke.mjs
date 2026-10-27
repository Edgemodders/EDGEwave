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
for (const f of ["api.json", "voiceLines.json", "home"]) fs.rmSync(path.join(T, f), { recursive: true, force: true });
fs.mkdirSync(path.join(T, "game"), { recursive: true });
fs.mkdirSync(path.join(T, "proj", "source", "raw"), { recursive: true });
fs.cpSync(path.join(here, "stub"), path.join(T, "stub"), { recursive: true });
// The stub's .wem: a made Ogg Vorbis tone.
fs.copyFileSync(path.join(repo, "test", "fixtures", "tone.ogg"), path.join(T, "tone.ogg"));
// SMOKE_SLOW=2 doubles every wait and the time limit, for a busy machine (other VS Code windows open).
const slow = Math.max(1, Number(process.env.SMOKE_SLOW) || 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * slow));
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
    if (req.headers["xi-api-key"] === "bad-key") return json({ detail: { status: "invalid_api_key", message: "Invalid API key" } }, 401);
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
// EDGEwave's own folder (the event index, the MCP server) in the smoke folder, never the modder's.
const env = { ...process.env, EDGEWAVE_HOME: path.join(T, "home") }; delete env.ELECTRON_RUN_AS_NODE;
const code = spawn(exe, ["--new-window", "--user-data-dir", path.join(T, "ud"), "--extensions-dir", path.join(T, "ex"), "--disable-extensions",
  "--extensionDevelopmentPath", repo, "--extensionDevelopmentPath", path.join(T, "stub"), "--remote-debugging-port=9339", "--force-device-scale-factor=1.5",
  "--skip-welcome", "--skip-release-notes", "--disable-workspace-trust", path.join(T, "proj")], { env, stdio: "ignore" });
const finish = (ok, msg) => { log(ok ? "PASS" : "FAIL", msg); code.kill(); process.exit(ok ? 0 : 1); };
setTimeout(() => finish(false, "timed out"), 240000 * slow);

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
// The A2 render, read now, before Add to Project writes beside it.
const renderedWav = fs.readFileSync(wav);
log("document", JSON.stringify(doc));
// The workbench itself (not the webview), for VS Code's own dialog and quick pick.
let bench;
for (const c of contexts.filter((c) => !c.origin.startsWith("vscode-webview"))) {
  try { if (await evalIn(c, "!!document.querySelector('.monaco-workbench')")) { bench = c; break; } } catch {}
}
// A3: Add to Project, both routes, through the real quick picks. The override replaces track 2's sound
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
log("add to project, second time", JSON.stringify(firstRows));
// A new sound for this project is always first; then the game sounds, in the mixer's order.
const lastFirst = /^A new sound for this project/.test(firstRows[0] ?? "") && /^Override sound 42/.test(firstRows[1] ?? "") && !/last time/.test(firstRows[1]) && firstRows.some((r) => /^Override sound 43/.test(r) && /last time/.test(r));
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
if (!a3) finish(false, "Add to Project did not write what it should");
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

// Voice tools, against the stand-in ElevenLabs: Speak Line with no key, then a wrong one, set from the
// dialog's own button; Generate Sound; Speak Line in a
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

// No key: Speak Line's voice list asks for one; Escape leaves the list saying so, with Set ElevenLabs API
// Key… Set there a wrong key (the stand-in refuses bad-key with a 401), then the right one: the voices load.
const keyBox = () => run(`for (let i = 0; i < 40 && !document.querySelector('#dialog .voices .keyfix') && !document.querySelector('#dialog .voice'); i++) await new Promise((r) => setTimeout(r, 250));
  return { text: document.querySelector('#dialog .voices')?.textContent ?? '', fix: !!document.querySelector('#dialog .voices .keyfix button.primary'), statusFix: !!document.querySelector('#dialog .status .keyfix button.primary:not(:disabled)'), voices: document.querySelectorAll('#dialog .voice').length }`);
await run("document.getElementById('speakLine').click()");
await sleep(1500);
await key("Escape", "Escape", 27); // the key's input box
const noKey = await keyBox();
await run("document.querySelector('#dialog .voices .keyfix button.primary').click()");
await sleep(1500);
await cdp("Input.insertText", { text: "bad-key" });
await key("Enter", "Enter", 13);
await sleep(1000);
const badKey = await keyBox();
await run("document.querySelector('#dialog .voices .keyfix button.primary').click()");
await sleep(1500);
await cdp("Input.insertText", { text: "smoke-key" });
await key("Enter", "Enter", 13);
await sleep(1000);
const goodKey = await keyBox();
log("api key", JSON.stringify({ noKey, badKey, goodKey }));
await run("document.querySelector('#dialog .x').click()");
// The buttons are on the dialog's status line too, which is never dimmed (the voice list is, for the line's own voice).
const keyOk = noKey.fix && noKey.statusFix && badKey.statusFix && /No ElevenLabs API key/.test(noKey.text) && badKey.fix && /refused the API key: Invalid API key/.test(badKey.text) && !goodKey.fix && goodKey.voices === 1;
if (!keyOk) finish(false, "a missing or wrong ElevenLabs key did not offer Set ElevenLabs API Key");

// Generate Sound makes takes in the dialog; only the one added becomes a track.
const takeCount = (n) => run(`for (let i = 0; i < 40 && document.querySelectorAll('#dialog .takes .voice').length < ${n}; i++) await new Promise((r) => setTimeout(r, 250));
  return document.querySelectorAll('#dialog .takes .voice').length`);
await run(`document.getElementById('generateSound').click(); await new Promise((r) => setTimeout(r, 300));
  document.querySelector('#dialog textarea').value = 'a metal door slams';
  document.querySelector('#dialog .actions .primary').click();`);
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
  eleven.every((r) => r.path.startsWith("/preview/") ? !r.key : r.key === "smoke-key" || (r.key === "bad-key" && ["/v2/voices", "/v1/models"].includes(r.path))) &&
  posts[0].path === "/v1/sound-generation" && posts[0].fmt === "pcm_48000" && posts[1].fmt === "pcm_24000" &&
  eleven.filter((r) => r.path === "/v1/voices/add").length === 1 && eleven.filter((r) => r.fmt === "pcm_48000").length === 1;
if (!voiceOk) finish(false, "the voice tools did not do what they should");

// The lanes' checkboxes: track 1 (left out by Re-Voice) is unchecked; check it. Then right-click the
// generated sound's lane > Only This Track: a file alone in the mix, so Add to Project offers the named
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
const allRows = await evalIn(bench, `[...document.querySelectorAll('.quick-input-list .monaco-list-row')].map((r) => r.textContent.trim())`);
const fileRows = allRows.slice(0, 3);
// The last choice (Silence smoke_event, track 1's) is marked in its label and its group's heading, though out of the mix.
const lastMarked = allRows.some((r) => /^Silence the event smoke_event, every variation, with REDmod · last time/.test(r)) &&
  allRows.some((r) => /^Override sound 42.*Track 1 · smoke_event · 42 · not in the mix · last time$/.test(r));
await key("Escape", "Escape", 27);
log("checkboxes", JSON.stringify({ checksBefore, checksAfter, checksOnly, mutes, fileRows, lastMarked }));
const checksOk =
  JSON.stringify(checksBefore) === JSON.stringify([false, true, true, true, true, true]) &&
  JSON.stringify(checksAfter) === JSON.stringify([true, true, true, true, true, true]) &&
  JSON.stringify(checksOnly) === JSON.stringify([false, false, true, false, false, false]) &&
  JSON.stringify(mutes) === JSON.stringify([true, true, false, true, true, true]) && lastMarked &&
  /^A new sound for this project/.test(fileRows[0] ?? "") && /^Replace a game event by name/.test(fileRows[1] ?? "") && /No track in the mix is a game sound effect \(track 3\)/.test(fileRows[1] ?? "");
if (!checksOk) finish(false, "the lanes' checkboxes or Only This Track did not set the mix");

// As a REDnode sound (EDGEwave #2): no package yet and no game folder, so New package in the project,
// its id from the mod's name, the sound named after the document, Sound effects (no voice in the mix).
await run("document.getElementById('intoGame').click()");
await pickFirst("In a REDnode package");
await pickFirst(""); // New package in the project…
await pickFirst(""); // id: smoke
await pickFirst(""); // name: 42
await pickFirst(""); // Sound effects
const pkgDir = path.join(T, "proj", "source", "resources", "red4ext", "plugins", "REDnode", "apps", "smoke");
const pkgWav = path.join(pkgDir, "sounds", "42.wav");
for (let i = 0; i < 20 && !fs.existsSync(pkgWav); i++) await sleep(500);
await sleep(800);
await key("Escape", "Escape", 27); // the notification
const pkgManifest = fs.existsSync(path.join(pkgDir, "rednode-app.json")) ? JSON.parse(fs.readFileSync(path.join(pkgDir, "rednode-app.json"), "utf8")) : null;
const pkgGame = JSON.parse(fs.readFileSync(docFile, "utf8")).game;
log("REDnode sound", JSON.stringify({ pkgManifest, pkgGame, wav: fs.existsSync(pkgWav) ? wavFormat(pkgWav) : null }));
const rednodeOk =
  pkgManifest?.id === "smoke" && pkgManifest.main === "mod.mjs" && pkgManifest.open === true &&
  JSON.stringify(pkgManifest.sounds) === JSON.stringify({ 42: { file: "sounds/42.wav", category: "sfx" } }) &&
  fs.existsSync(path.join(pkgDir, "mod.mjs")) && /audio\.play\("42"\)/.test(fs.readFileSync(path.join(pkgDir, "mod.mjs"), "utf8")) &&
  wavFormat(pkgWav).rate === 48000 &&
  pkgGame?.route === "rednode" && pkgGame.sound === "42" && pkgGame.category === "sfx" && pkgGame.package === path.join("source", "resources", "red4ext", "plugins", "REDnode", "apps", "smoke");
if (!rednodeOk) finish(false, "As a REDnode sound did not write the package");

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

// EDGEwave's API, called by the stand-in REDcode as EDGEquest does (#7): the game's sound events from the
// bridge's eventsmetadata.json, hearing one (the preview), a music cue (a reason), a custom sound.
const command = async (title) => {
  await key("F1", "F1", 112);
  await sleep(600);
  await cdp("Input.insertText", { text: title });
  await sleep(800);
  await key("Enter", "Enter", 13);
};
const waitFile = async (f, n = 40) => { for (let i = 0; i < n && !fs.existsSync(f); i++) await sleep(500); return fs.existsSync(f); };
await command("Smoke: EDGEwave API");
if (!(await waitFile(path.join(T, "api.json")))) finish(false, "the API calls never finished");
const apiOut = JSON.parse(fs.readFileSync(path.join(T, "api.json"), "utf8"));
log("api", JSON.stringify(apiOut));
const customWav = path.join(T, "proj", "source", "customSounds", "edgewave_smoke_knock.wav");
const infoNow = JSON.parse(fs.readFileSync(path.join(T, "proj", "source", "resources", "info.json"), "utf8"));
const apiOk = apiOut.apiVersion === 1 && !apiOut.error
  && apiOut.events.map((e) => e.name).join() === "smoke_event,smoke_second,mus_smoke_01_START" && apiOut.events[0].project?.replaces === true && apiOut.events[0].quest === true
  && apiOut.music.map((e) => e.name).join() === "mus_smoke_01_START" && apiOut.music[0].loops === true
  && apiOut.play.ok === true && apiOut.play.where === "project" && apiOut.play.variations === 1 && apiOut.playMusic.ok === false && /music cue/.test(apiOut.playMusic.reason)
  && [apiOut.quiet, apiOut.quietAgain].every((q) => q.ok === true && q.where === "archive" && q.variations === 2 && ["43", "44"].includes(q.played))
  && !apiOut.tabsAfter.includes("Hear: smoke_second")
  && apiOut.custom.event === "edgewave_smoke_knock" && apiOut.custom.type === "mod_sfx_low_occlusion" && fs.existsSync(customWav) && fs.readFileSync(customWav).readUInt32LE(24) === 48000
  && infoNow.customSounds.some((c) => c.name === "edgewave_smoke_knock" && c.file === "edgewave_smoke_knock.wav")
  && apiOut.status === undefined && fs.existsSync(path.join(T, "home", "events.json"));
if (!apiOk) finish(false, "EDGEwave's sound event calls did not answer as expected");

// V2 Voice Lines (#5): the stub hands over a quest's two lines; pick the voices (V's two, Judy's), Generate
// All against the stand-in ElevenLabs (24 kHz, eleven_v3, Judy's say with its tags), then close the panel.
const elevenBefore = eleven.length;
await command("Smoke: Voice Lines");
let vl;
for (let i = 0; i < 40 && !vl; i++) {
  for (const c of contexts.filter((c) => c.origin.startsWith("vscode-webview"))) {
    try { if (await evalIn(c, "!!document.getElementById('lines') && !!document.getElementById('voices') && document.querySelectorAll('.line').length === 2")) { vl = c; break; } } catch {}
  }
  if (!vl) await sleep(500);
}
if (!vl) finish(false, "the Voice Lines panel never appeared");
const vrun = (js) => evalIn(vl, `(async () => { ${js} })()`);
await vrun("document.querySelector('#voices select').dispatchEvent(new FocusEvent('focus'))");
for (let i = 0; i < 20; i++) { if (await vrun("return document.querySelector('#voices select').options.length > 1")) break; await sleep(300); }
for (let n = 0; n < 3; n++) {
  await vrun(`const s = [...document.querySelectorAll('#voices select')][${n}]; s.value = 'v_smoke'; s.dispatchEvent(new Event('change'));`);
  await sleep(500);
}
const picked = await vrun("return [...document.querySelectorAll('#voices select')].map((s) => s.value)");
await vrun("document.getElementById('generate').click()");
let vmeta = "";
for (let i = 0; i < 40; i++) { vmeta = await vrun("return document.getElementById('meta').textContent"); if (vmeta.includes("2 voiced")) break; await sleep(500); }
const vshot = await cdp("Page.captureScreenshot", { format: "png" });
fs.writeFileSync(path.join(T, "voiceLines.png"), Buffer.from(vshot.data, "base64"));
const record = JSON.parse(fs.readFileSync(path.join(T, "proj", "source", "raw", "edgewave", "voice", "smoke_quest", "voice.json"), "utf8"));
const tts = eleven.slice(elevenBefore).filter((r) => r.path.startsWith("/v1/text-to-speech/") && r.fmt === "pcm_24000").map((r) => JSON.parse(r.body));
log("voice lines", JSON.stringify({ picked, vmeta, tts, record }));
const vLine = record.lines["1234567890123456789"], jLine = record.lines["42"];
const takeWav = jLine && fs.readFileSync(path.join(T, "proj", jLine.female));
await command("View: Close Editor");
const closed = await waitFile(path.join(T, "voiceLines.json"), 20);
const vlOk = picked.join() === "v_smoke,v_smoke,v_smoke" && vmeta.includes("2 voiced")
  && vLine?.female === "source/raw/edgewave/voice/smoke_quest/v_smoke_quest_f_112210f47de98115.wav" && vLine?.male?.endsWith("v_smoke_quest_m_112210f47de98115.wav")
  && jLine?.female?.endsWith("judy_smoke_quest_f_000000000000002a.wav") && !jLine.male && jLine.say === "[softly] You... came back." && jLine.model === "eleven_v3"
  && record.archiveDir === "mod/smoke/smoke_quest/vo" && record.voices.V?.female === "v_smoke" && record.voices.Judy === "v_smoke"
  && tts.length === 3 && tts.every((b) => b.model_id === "eleven_v3") && tts.some((b) => b.text === "[softly] You... came back.")
  && takeWav?.readUInt32LE(24) === 24000 && closed && JSON.parse(fs.readFileSync(path.join(T, "voiceLines.json"), "utf8")).lines["42"];
if (!vlOk) finish(false, "Voice Lines did not voice the quest's lines as expected");

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

// Create a Sound: an empty document. Then sound files dragged from the desktop, as the OS would hand them
// to VS Code (DevTools' dispatchDragEvent with file paths), with Shift held: two on the lanes become
// tracks 1 and 2, copied into Smoke New.sounds; one on the clip becomes the selected track's sound, its
// edits cleared. Last, one dropped without Shift: what VS Code does with it is logged, not checked.
const dropDir = path.join(T, "drops");
fs.mkdirSync(dropDir, { recursive: true });
const dropWav = (name, seconds, hz) => { const f = path.join(dropDir, name); fs.writeFileSync(f, wavOf(pcmTone(seconds, 24000, hz), 24000)); return f; };
const drops = [dropWav("kick.wav", 0.4, 120), dropWav("snare.wav", 0.6, 300), dropWav("hat.wav", 0.3, 900), dropWav("noshift.wav", 0.2, 600)];
const newFile = path.join(T, "proj", "source", "raw", "edgewave", "sounds", "Smoke New.edgewave");
await command("Smoke: New Empty Sound");
let np;
for (let i = 0; i < 40 && !np; i++) {
  for (const c of contexts.filter((c) => c.origin.startsWith("vscode-webview"))) {
    try { if (await evalIn(c, "document.getElementById('title')?.textContent === 'Smoke New' && !document.getElementById('note').hidden")) { np = c; break; } } catch {}
  }
  if (!np) await sleep(500);
}
if (!np) finish(false, "Create a Sound did not open an empty sound");
const nrun = (js) => evalIn(np, `(async () => { ${js} })()`);
const empty = await nrun("return { note: document.getElementById('note').textContent, render: document.getElementById('render').disabled, project: document.getElementById('intoGame').textContent, tracks: document.getElementById('laneChecks').children.length }");
log("create a sound", JSON.stringify({ file: JSON.parse(fs.readFileSync(newFile, "utf8")), empty }));
// Where an element of the new page is in the window: the webview's frame in the workbench, plus the element in the page.
const frameAt = await evalIn(bench, "(() => { const f = [...document.querySelectorAll('iframe.webview')].find((f) => f.offsetParent && f.getBoundingClientRect().width > 0 && f.closest('.editor-instance, [data-parent-flow-to-element-id]') !== null) ?? [...document.querySelectorAll('iframe.webview')].filter((f) => f.getBoundingClientRect().width > 0).pop(); const r = f.getBoundingClientRect(); return { x: r.left, y: r.top }; })()");
const nativeDrop = async (files, el, modifiers) => {
  const r = await nrun(`const r = document.querySelector('${el}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }`);
  const at = { x: frameAt.x + r.x, y: frameAt.y + r.y };
  const data = { items: [], files, dragOperationsMask: 1 };
  for (const type of ["dragEnter", "dragOver", "dragOver", "drop"]) {
    await cdp("Input.dispatchDragEvent", { type, ...at, data, modifiers });
    await sleep(150);
  }
  await sleep(1200);
};
await nativeDrop(drops.slice(0, 2), ".lanes", 8);
const afterLanes = await nrun("return document.getElementById('laneChecks').children.length");
await nativeDrop([drops[2]], "#wave", 8);
await saveDoc();
const filled = JSON.parse(fs.readFileSync(newFile, "utf8"));
const copies = fs.existsSync(path.join(path.dirname(newFile), "Smoke New.sounds")) ? fs.readdirSync(path.join(path.dirname(newFile), "Smoke New.sounds")).sort() : [];
const nshot = await cdp("Page.captureScreenshot", { format: "png" });
fs.writeFileSync(path.join(T, "created.png"), Buffer.from(nshot.data, "base64"));
await nativeDrop([drops[3]], ".lanes", 0);
const noShift = { tracks: await nrun("return document.getElementById('laneChecks').children.length").catch(() => "page gone"), tabs: await evalIn(bench, "[...document.querySelectorAll('.tab .label-name')].map((e) => e.textContent)") };
log("drops", JSON.stringify({ afterLanes, filled: filled.tracks.map((t) => [t.id, t.source.file, t.edits.length]), copies, noShift }));
const createOk = empty.render === true && empty.project === "Add to Project…" && empty.tracks === 0 && /Drop sound files/.test(empty.note)
  && afterLanes === 2 && filled.tracks.length === 2 && filled.render.file === "Smoke New.wav"
  && filled.tracks[0].source.file === "Smoke New.sounds/kick.wav" && filled.tracks[1].source.file === "Smoke New.sounds/hat.wav"
  && copies.join() === "hat.wav,kick.wav,snare.wav";
if (!createOk) finish(false, "Create a Sound or dropping sound files did not do what it should");

// Add to Project > A new sound for this project, its name as suggested (edgewave_smoke_new), the first
// type (a sound effect, low occlusion): a REDmod custom sound under a new name, listed in the Sounds view's
// Project sounds and by the API's soundEvents (the project's sounds first).
await key("Escape", "Escape", 27);
await nrun("document.getElementById('intoGame').click()");
await sleep(1200);
const newRows = await evalIn(bench, `[...document.querySelectorAll('.quick-input-list .monaco-list-row')].slice(0, 3).map((r) => r.textContent.trim())`);
await key("Enter", "Enter", 13); // A new sound for this project…
await pickFirst(""); // the name, as suggested
await pickFirst(""); // A sound effect, heard from where it plays
const newWav = path.join(T, "proj", "source", "customSounds", "edgewave_smoke_new.wav");
await waitFile(newWav, 20);
await sleep(800);
await key("Escape", "Escape", 27); // the notification
const newInfo = JSON.parse(fs.readFileSync(path.join(T, "proj", "source", "resources", "info.json"), "utf8")).customSounds.find((c) => c.name === "edgewave_smoke_new");
const newGame = JSON.parse(fs.readFileSync(newFile, "utf8")).game;
let namedRows = [];
for (let i = 0; i < 10; i++) {
  namedRows = await evalIn(bench, `[...document.querySelectorAll('.part.sidebar .monaco-list-row')].filter((r) => r.offsetParent).map((r) => r.textContent.trim())`);
  if (namedRows.some((r) => r.startsWith("edgewave_smoke_new"))) break;
  await sleep(500);
}
log("new sound", JSON.stringify({ newRows, newInfo, newGame, wav: fs.existsSync(newWav) ? wavFormat(newWav) : null, namedRows }));
const at = (g) => namedRows.findIndex((r) => r === g || r.startsWith(g + " ") || r.startsWith(g));
const newOk = /^A new sound for this project/.test(newRows[0] ?? "") && newInfo?.type === "mod_sfx_low_occlusion" && newInfo.file === "edgewave_smoke_new.wav"
  && wavFormat(newWav).rate === 48000 && newGame?.route === "new" && newGame.event === "edgewave_smoke_new"
  && at("Project sounds") > 0 && namedRows.some((r) => r.startsWith("edgewave_smoke_new")) && namedRows.some((r) => r.startsWith("edgewave_smoke_knock"));
if (!newOk) finish(false, "A new sound for this project did not name the sound in the project");

// Game Assets: the game's sounds only. Sound effects lists the stub's two events; Voice lines shows English
// (German has no voice folder); a click on an event plays it in the Hear panel. Then Filter "judy": the voice
// line, whose Add to the Open Sound puts it on Smoke New as track 3.
await command("EDGEwave: Focus on Game Assets View");
await sleep(800);
const assetRows = async () => evalIn(bench, `[...document.querySelectorAll('.part.sidebar .pane')].find((p) => /Game Assets/i.test(p.querySelector('.pane-header')?.textContent ?? ''))?.querySelectorAll('.monaco-list-row') ?? []`).then(() =>
  evalIn(bench, `(() => { const p = [...document.querySelectorAll('.part.sidebar .pane')].find((p) => /Game Assets/i.test(p.querySelector('.pane-header')?.textContent ?? '')); return p ? [...p.querySelectorAll('.monaco-list-row')].map((r) => r.textContent.trim()) : []; })()`));
const clickAsset = (text, selector = "") => evalIn(bench, `(() => { const p = [...document.querySelectorAll('.part.sidebar .pane')].find((p) => /Game Assets/i.test(p.querySelector('.pane-header')?.textContent ?? '')); const r = [...p.querySelectorAll('.monaco-list-row')].find((r) => r.textContent.trim().startsWith(${JSON.stringify(text)})); if (!r) return false; (${JSON.stringify(selector)} ? r.querySelector(${JSON.stringify(selector)}) : r).click(); return true; })()`);
const rowsBefore = await assetRows();
await clickAsset("Sound effects");
await sleep(1500);
await clickAsset("Voice lines");
await sleep(800);
await clickAsset("Base game");
await sleep(1500);
const rowsOpen = await assetRows();
await clickAsset("smoke_event");
let hearTab = "";
for (let i = 0; i < 20 && !hearTab; i++) {
  hearTab = (await evalIn(bench, "[...document.querySelectorAll('.tab .label-name')].map((e) => e.textContent).find((t) => t.startsWith('Hear: ')) ?? ''"));
  if (!hearTab) await sleep(500);
}
await command("EDGEwave: Filter the Game's Sounds");
await sleep(800);
await cdp("Input.insertText", { text: "judy" });
await sleep(300);
await key("Enter", "Enter", 13);
await sleep(2000);
const rowsFiltered = await assetRows();
const added = await clickAsset("judy_smoke_f_000000000000002a.wem", ".action-label[aria-label='Add to the Open Sound'], .action-label[title='Add to the Open Sound']");
await sleep(1200);
// ▶ on the voice line plays it with no tab (the stub gives a .wem as Ogg Vorbis, as REDcode does: decoded to WAV
// for the hidden player); ▶ again while it plays stops it. The status bar says which.
const tabsBeforePlay = await evalIn(bench, "document.querySelectorAll('.tab').length");
const statusText = () => evalIn(bench, "document.querySelector('.part.statusbar')?.textContent ?? ''");
const playButton = ".action-label[aria-label='Play'], .action-label[title='Play']";
const played = await clickAsset("judy_smoke_f_000000000000002a.wem", playButton);
let playStatus = "";
for (let i = 0; i < 20 && !/playing judy_smoke/.test(playStatus); i++) { await sleep(300); playStatus = await statusText(); }
await clickAsset("judy_smoke_f_000000000000002a.wem", playButton);
let stopStatus = "";
for (let i = 0; i < 20 && !/stopped judy_smoke/.test(stopStatus); i++) { await sleep(300); stopStatus = await statusText(); }
const tabsAfterPlay = await evalIn(bench, "document.querySelectorAll('.tab').length");
const playOk = played && /playing judy_smoke_f_000000000000002a\.wem/.test(playStatus) && /stopped judy_smoke_f_000000000000002a\.wem/.test(stopStatus) && tabsAfterPlay === tabsBeforePlay;
const toasts = await evalIn(bench, "[...document.querySelectorAll('.notification-toast, .notifications-center .monaco-list-row')].map((t) => t.textContent.trim()).join(' | ')");
log("game assets play", JSON.stringify({ toasts, played, playStatus: playStatus.match(/EDGEwave: [^]*?(?=\s{2}|$)/)?.[0], stopStatus: stopStatus.match(/EDGEwave: [^]*?(?=\s{2}|$)/)?.[0], tabsBeforePlay, tabsAfterPlay }));
if (!playOk) finish(false, "Game Assets' play button did not play and stop the voice line without a tab");
// Save Smoke New (the sound added to) from its tab.
await evalIn(bench, "[...document.querySelectorAll('.tab')].find((t) => t.textContent.includes('Smoke New'))?.click()");
await sleep(600);
await saveDoc();
const withVoice = JSON.parse(fs.readFileSync(newFile, "utf8")).tracks;
log("game assets", JSON.stringify({ rowsBefore, rowsOpen, hearTab, rowsFiltered, added, tracks: withVoice.map((t) => [t.id, t.source]) }));
const assetsOk = rowsBefore.join() === "Sound effects,Voice lines,Music and streamed sounds"
  && rowsOpen.some((r) => r.startsWith("smoke_event")) && rowsOpen.some((r) => r.startsWith("smoke_second2 variations")) && rowsOpen.some((r) => r.startsWith("en-us")) && !rowsOpen.some((r) => r.startsWith("de-de"))
  && hearTab === "Hear: smoke_event"
  && rowsFiltered.some((r) => r.startsWith("judy_smoke_f_000000000000002a.wem")) && !rowsFiltered.some((r) => r.startsWith("v_smoke_m_")) && !rowsFiltered.some((r) => r.startsWith("smoke_event"))
  && added && withVoice.length === 3 && withVoice[2].source.kind === "game" && withVoice[2].source.path === "base\\localization\\en-us\\vo\\judy_smoke_f_000000000000002a.wem" && withVoice[2].voice === true;
if (!assetsOk) finish(false, "Game Assets did not list, play or add the game's sounds as expected");

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
finish(ok, ok ? "A1 edits; A2 Add Sound, preset, start, a two-track render; A3 Add to Project, override of track 2, REDmod and silence, a REDnode sound; voice tools against a stand-in ElevenLabs, with Set ElevenLabs API Key offered for a missing and a wrong key; the API: sound events, hearing one, playing one with no tab, a custom sound; Voice Lines for a quest; the lanes' checkboxes and Only This Track; the splitter; moving lanes; the Sounds view; Create a Sound and sound files dropped on it; a new sound for the project, in Project sounds; Game Assets: listing, hearing, filtering, adding to the open sound, playing a .wem (Ogg) with no tab" : "render or mix checks failed");
