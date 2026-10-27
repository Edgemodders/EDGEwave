// The sound editor's page. The host sends the document and, on request, each source's audio; the
// page decodes the audio once, applies each track's edits (src/audio/edits.ts), plays the selected
// clip or the whole mix through the audio graph (graph.ts), and renders the mix. Every change goes
// back as a whole new document, which the host writes into the .edgewave text (so VS Code's undo and
// redo cover it).
//
// Layout: the mix (track lanes on one timeline, the selected track's controls), then the clip editor
// for the selected track (A1's waveform and edits), then the Edits, Effects, Master and Render panes.

import { applyEdits, duration, frames, type Audio } from "../src/audio/edits";
import { audible, Effects, mixEnd, onMix, Presets, presetEffects, tail, type Param } from "../src/audio/mix";
import { encodeWav } from "../src/audio/wav";
import { docLabel, sourceKey, sourceLabel, type Curve, type Edit, type Effect, type EffectType, type SoundDoc, type Track } from "../src/doc";
import { buildMix } from "./graph";
import { keySet, setupVoiceTools, voiceToolResult } from "./voice";

declare function acquireVsCodeApi(): { postMessage(m: unknown): void; getState(): ViewState | undefined; setState(s: ViewState): void };
/**
 * What the page keeps per editor tab (not in the document): the lanes' height, once the splitter is dragged, and
 * the unsaved document (`scratch`: the text as saved, `base`, and as edited, `doc`). VS Code keeps a tab's state
 * across a window reload and drops it with the tab; it marks a custom editor's tab unsaved after a reload but
 * gives the extension the file as saved (seen in VS Code 1.143), so the page puts its unsaved edits back.
 */
type ViewState = { lanesHeight?: number; scratch?: { base: string; doc: string } };
const vscode = acquireVsCodeApi();
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const send = (m: unknown) => vscode.postMessage(m);
const round = (t: number) => Math.round(t * 1e6) / 1e6;

// ---- state ------------------------------------------------------------------------------------

let doc: SoundDoc | null = null;
/** Decoded sources by sourceKey, and those asked for or failed. */
const sources = new Map<string, { audio: Audio; info: string }>();
const asked = new Set<string>();
const failed = new Map<string, string>();
/** Each track's clip after its edits, kept while its source and edits are unchanged. */
const clips = new Map<string, { key: string; audio: Audio; peaks: Peaks }>();
let selId = "";

/** The clip editor's view: the time at the left edge and seconds per pixel, in the clip's seconds. */
let viewStart = 0;
let secPerPx = 0.01;
let cursor = 0;
let selection: { start: number; end: number } | null = null;
/** A copied or cut range of one track, in the times of its clip after `after` edits. */
let clipboard: { track: string; start: number; end: number; after: number } | null = null;
/** The mix view: seconds per pixel from 0, and the mix cursor. */
let mixSecPerPx = 0.01;
let mixCursor = 0;

let ctx: AudioContext | null = null;
let player: {
  mode: "clip" | "mix";
  stop: () => void;
  startedAt: number;
  from: number;
  rate: number;
  loop: { start: number; end: number } | null;
  end: number;
} | null = null;
let looping = false;

const track = (): Track | undefined => doc?.tracks.find((t) => t.id === selId) ?? doc?.tracks[0];
const clip = (t: Track | undefined = track()) => (t ? clipOf(t)?.audio : undefined);
const len = () => {
  const c = clip();
  return c ? duration(c) : 0;
};

// ---- messages from the host -----------------------------------------------------------------------

/** The first document since the page loaded: where unsaved edits lost to a window reload are put back. */
let firstDoc = true;

/** Keeps the unsaved document in the tab's state; the saved one becomes the base. */
function keepScratch(text: string, dirty: boolean) {
  const s = vscode.getState() ?? {};
  vscode.setState({ ...s, scratch: dirty ? { base: s.scratch?.base ?? text, doc: text } : { base: text, doc: text } });
}

window.addEventListener("message", async (e) => {
  const m = e.data;
  if (m.type === "doc") {
    const text = JSON.stringify(m.doc);
    if (firstDoc) {
      firstDoc = false;
      const scratch = vscode.getState()?.scratch;
      // The file as saved, while this tab had unsaved edits on top of it: a reload lost them. Back as unsaved edits.
      if (!m.dirty && scratch && scratch.base === text && scratch.doc !== text) {
        try {
          send({ type: "edit", doc: JSON.parse(scratch.doc) });
          send({ type: "restored" });
          return;
        } catch {
          // Not a document any more: drop it.
        }
      }
    }
    keepScratch(text, !!m.dirty);
    const same = doc && JSON.stringify(doc) === JSON.stringify(m.doc);
    const before = doc ? new Set(doc.tracks.map((t) => t.id)) : null;
    doc = m.doc as SoundDoc;
    // A track that was not in the last document (Add Sound, or undo of a Remove) becomes the selected one.
    const fresh = before ? doc.tracks.filter((t) => !before.has(t.id)) : [];
    if (fresh.length) selectTrack(fresh[fresh.length - 1].id);
    if (!doc.tracks.some((t) => t.id === selId)) selId = doc.tracks[0]?.id ?? "";
    requestSources();
    $("title").textContent = docLabel(doc);
    if (!same) refresh();
  } else if (m.type === "invalid") {
    note(`This document cannot be edited here: ${m.text}. Fix the JSON (Reopen With > Text Editor), then reopen it.`);
  } else if (m.type === "audio") {
    try {
      await loadAudio(m.key, m.data as Uint8Array, m.codec, m.name);
    } catch (err) {
      failed.set(m.key, `The sound could not be decoded: ${(err as Error).message}`);
      send({ type: "error", text: String(err) });
      refresh();
    }
  } else if (m.type === "audioError") {
    failed.set(m.key, `The sound could not be loaded: ${m.text}`);
    refresh();
  } else if (m.type === "voiceToolResult") {
    voiceToolResult(m);
  } else if (m.type === "keySet") {
    keySet(m.ok);
  } else if (m.type === "renderFor") {
    // Add to Project: the mix at the format its route needs; {track} is the channels of the sound it replaces.
    try {
      const target = typeof m.channels === "object" ? doc?.tracks.find((t) => t.id === m.channels.track) : undefined;
      const audio = target ? sources.get(sourceKey(target.source))?.audio : undefined;
      const channels = typeof m.channels === "object" ? Math.min(2, audio?.channels.length ?? 2) : m.channels;
      send({ type: "renderedFor", id: m.id, wav: await renderMix(m.rate, channels) });
    } catch (err) {
      send({ type: "renderedFor", id: m.id, error: (err as Error).message });
    }
  }
});

function requestSources() {
  if (!doc) return;
  for (const t of doc.tracks) {
    const key = sourceKey(t.source);
    if (sources.has(key) || asked.has(key) || failed.has(key)) continue;
    asked.add(key);
    send({ type: "need", key, source: t.source });
  }
}

/** The clip editor's note in a document with no tracks yet (Create a Sound). */
const Empty = "No sound yet. Drop sound files here or on the lanes (hold Shift as you drop them), or use Add Sound (+), Generate Sound or Speak Line.";

function note(text: string | null) {
  $("note").textContent = text ?? "";
  $("note").hidden = !text;
}

async function loadAudio(key: string, data: Uint8Array | Record<string, number>, codec: string | undefined, name: string) {
  ctx ??= new AudioContext();
  const copy = (data instanceof Uint8Array ? data.slice() : Uint8Array.from(Object.values(data))).buffer;
  const buf = await ctx.decodeAudioData(copy);
  const audio = { sampleRate: buf.sampleRate, channels: Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c).slice()) };
  const ch = buf.numberOfChannels === 1 ? "mono" : buf.numberOfChannels === 2 ? "stereo" : `${buf.numberOfChannels} ch`;
  sources.set(key, { audio, info: `${name} · ${[codec, ch, `${buf.sampleRate} Hz`].filter(Boolean).join(" ")}` });
  refresh();
  const t = track();
  if (t && sourceKey(t.source) === key) fit();
}

// ---- the edit chains --------------------------------------------------------------------------------

function clipOf(t: Track): { audio: Audio; peaks: Peaks } | undefined {
  const src = sources.get(sourceKey(t.source));
  if (!src) return undefined;
  const key = sourceKey(t.source) + JSON.stringify(t.edits);
  const hit = clips.get(t.id);
  if (hit && hit.key === key) return hit;
  const audio = applyEdits(src.audio, t.edits);
  const made = { key, audio, peaks: makePeaks(audio) };
  clips.set(t.id, made);
  return made;
}

/** After any change: clamp the clip editor to the selected clip, then redraw everything. */
function refresh() {
  const c = clip();
  const l = c ? duration(c) : 0;
  cursor = Math.min(cursor, l);
  if (selection) selection = { start: Math.min(selection.start, l), end: Math.min(selection.end, l) };
  if (selection && selection.end - selection.start <= 0) selection = null;
  const t = track();
  // Undo back past a copy drops it.
  if (clipboard && t && clipboard.track === t.id && clipboard.after > t.edits.length) clipboard = null;
  const key = t ? sourceKey(t.source) : "";
  note(!doc ? "Loading…" : !t ? Empty : failed.get(key) ?? (c ? null : "Loading the sound…"));
  refreshPanels();
  fitMix();
  draw();
}

/** Sends a new document with this change; shows it at once. */
function change(f: (d: SoundDoc) => SoundDoc) {
  if (!doc) return;
  stop();
  doc = f(structuredClone(doc));
  refresh();
  send({ type: "edit", doc });
}

/** A change to the selected track. */
function changeTrack(f: (t: Track) => Track) {
  const id = track()?.id;
  if (!id) return;
  change((d) => ({ ...d, tracks: d.tracks.map((t) => (t.id === id ? f(t) : t)) }));
}

const addEdit = (edit: Edit) => changeTrack((t) => ({ ...t, edits: [...t.edits, edit] }));

function selectTrack(id: string) {
  if (selId === id) return;
  stop();
  selId = id;
  selection = null;
  cursor = 0;
  viewStart = 0;
  refresh();
  fit();
}

// ---- peaks for the waveforms: min and max per block, so long sounds draw fast ----------------------

const Block = 256;
interface Peaks {
  /** Per channel, min and max per block of Block frames. */
  blocks: Float32Array[];
}

function makePeaks(a: Audio): Peaks {
  const n = Math.ceil(frames(a) / Block);
  return {
    blocks: a.channels.map((c) => {
      const out = new Float32Array(n * 2);
      for (let b = 0; b < n; b++) {
        let lo = 0;
        let hi = 0;
        const end = Math.min(c.length, (b + 1) * Block);
        for (let i = b * Block; i < end; i++) {
          if (c[i] < lo) lo = c[i];
          if (c[i] > hi) hi = c[i];
        }
        out[b * 2] = lo;
        out[b * 2 + 1] = hi;
      }
      return out;
    }),
  };
}

/** Min and max of a clip's channel between two frames, from the blocks when the span is long. */
function span(c: { audio: Audio; peaks: Peaks }, ch: number, from: number, to: number): [number, number] {
  let lo = 0;
  let hi = 0;
  if (to - from >= Block * 2) {
    const b = c.peaks.blocks[ch];
    for (let i = Math.max(0, Math.floor(from / Block)); i < Math.ceil(to / Block) && i * 2 < b.length; i++) {
      lo = Math.min(lo, b[i * 2]);
      hi = Math.max(hi, b[i * 2 + 1]);
    }
  } else {
    const s = c.audio.channels[ch];
    for (let i = Math.max(0, from); i < Math.min(s.length, Math.max(to, from + 1)); i++) {
      lo = Math.min(lo, s[i]);
      hi = Math.max(hi, s[i]);
    }
  }
  return [lo, hi];
}

// ---- drawing --------------------------------------------------------------------------------------------

const canvas = $<HTMLCanvasElement>("canvas");
const mixCanvas = $<HTMLCanvasElement>("mix");
const laneChecks = $("laneChecks");
const Ruler = 18;
const Lane = 36;
/** A lane's label strip above its waveform. */
const LaneLabel = 13;

function css(name: string, fallback: string) {
  return getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
}
const colours = () => ({
  wave: css("--cyan", "#19f3ff"),
  accent: css("--accent", "#fcee0a"),
  dim: css("--dim", "#8a93a8"),
  line: css("--line", "#262c3d"),
  shade: css("--vscode-editorWidget-background", "rgba(128,128,128,.08)"),
  font: css("--vscode-editor-font-family", "monospace"),
});

function setup(c: HTMLCanvasElement, h: number): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth || 600;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const g = c.getContext("2d")!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return g;
}

function ruler(g: CanvasRenderingContext2D, w: number, start: number, spp: number, k: ReturnType<typeof colours>) {
  g.fillStyle = k.dim;
  g.strokeStyle = k.line;
  g.font = `10px ${k.font}`;
  const step = niceStep(spp * 90);
  const x = (t: number) => (t - start) / spp;
  for (let t = Math.ceil(start / step) * step; x(t) < w; t += step) {
    const px = Math.round(x(t)) + 0.5;
    g.beginPath();
    g.moveTo(px, Ruler - 6);
    g.lineTo(px, Ruler);
    g.stroke();
    g.fillText(fmt(t, step), px + 3, 10);
  }
  g.beginPath();
  g.moveTo(0, Ruler + 0.5);
  g.lineTo(w, Ruler + 0.5);
  g.stroke();
}

function draw() {
  drawMix();
  drawClip();
}

function width(c: HTMLCanvasElement = canvas) {
  return c.clientWidth || 600;
}

/** The clip editor: the selected clip's waveform, A1's view. */
function drawClip() {
  const w = width();
  const h = canvas.clientHeight || 200;
  const g = setup(canvas, h);
  const k = colours();
  ruler(g, w, viewStart, secPerPx, k);
  const t = track();
  const c = t && clipOf(t);
  if (!c || !t || !doc) return;
  const x = (s: number) => (s - viewStart) / secPerPx;
  const end = duration(c.audio);
  if (x(end) < w) {
    g.fillStyle = k.shade;
    g.fillRect(Math.max(0, x(end)), Ruler + 1, w, h);
  }
  // The mix's loop points, in this clip's seconds.
  if (doc.loop) {
    const rate = t.rate ?? 1;
    const a = (doc.loop.start - t.offset) * rate;
    const b = (doc.loop.end - t.offset) * rate;
    g.globalAlpha = 0.1;
    g.fillStyle = k.wave;
    g.fillRect(x(a), Ruler + 1, x(b) - x(a), h);
    g.globalAlpha = 1;
    g.fillRect(x(a), Ruler + 1, 1, h);
    g.fillRect(x(b) - 1, Ruler + 1, 1, h);
  }
  if (selection) {
    g.globalAlpha = 0.16;
    g.fillStyle = k.accent;
    g.fillRect(x(selection.start), Ruler + 1, Math.max(1, x(selection.end) - x(selection.start)), h);
    g.globalAlpha = 1;
  }
  const ch = c.audio.channels.length;
  const lane = (h - Ruler - 1) / ch;
  const rate = c.audio.sampleRate;
  const played = player?.mode === "clip" ? playPosition() : null;
  for (let n = 0; n < ch; n++) {
    const mid = Ruler + 1 + lane * n + lane / 2;
    const amp = lane / 2 - 2;
    for (let px = 0; px < Math.min(w, x(end)); px++) {
      const t0 = viewStart + px * secPerPx;
      const [lo, hi] = span(c, n, Math.floor(t0 * rate), Math.floor((t0 + secPerPx) * rate));
      const top = mid - hi * amp;
      g.fillStyle = played !== null && t0 < played ? k.accent : k.wave;
      g.fillRect(px, top, 1, Math.max(1, mid - lo * amp - top));
    }
    if (n > 0) {
      g.fillStyle = k.line;
      g.fillRect(0, Ruler + lane * n, w, 1);
    }
  }
  g.fillStyle = k.accent;
  g.fillRect(Math.round(x(cursor)), Ruler + 1, 1, h);
  if (played !== null) g.fillRect(Math.round(x(played)), 0, 2, h);
}

/** The mix: one lane per track, each clip where it starts. */
function drawMix() {
  if (!doc) return;
  // With no tracks, one empty lane to drop sounds on.
  const h = Ruler + 1 + Lane * Math.max(1, doc.tracks.length);
  mixCanvas.style.height = `${h}px`;
  sizeLanes();
  const w = width(mixCanvas);
  const g = setup(mixCanvas, h);
  const k = colours();
  ruler(g, w, 0, mixSecPerPx, k);
  if (!doc.tracks.length) {
    g.fillStyle = k.dim;
    g.font = `11px ${k.font}`;
    g.fillText("Drop sound files here to add them as tracks (hold Shift as you drop)", 8, Ruler + 1 + Lane / 2 + 4);
  }
  const heard = new Set(audible(doc.tracks).map((t) => t.id));
  const x = (s: number) => s / mixSecPerPx;
  doc.tracks.forEach((t, i) => {
    const top = Ruler + 1 + Lane * i;
    if (t.id === track()?.id) {
      g.fillStyle = k.shade;
      g.fillRect(0, top, w, Lane);
      g.fillStyle = k.accent;
      g.fillRect(0, top, 2, Lane);
    }
    g.fillStyle = k.line;
    g.fillRect(0, top + Lane - 1, w, 1);
    const c = clipOf(t);
    const offset = dragging?.id === t.id ? dragging.offset : t.offset;
    const length = c ? onMix(t, duration(c.audio)) : 0;
    const x0 = x(offset);
    const x1 = Math.max(x0 + 2, x(offset + length));
    g.globalAlpha = heard.has(t.id) ? 1 : 0.35;
    g.strokeStyle = t.id === track()?.id ? k.accent : k.line;
    g.strokeRect(x0 + 0.5, top + 1.5, x1 - x0 - 1, Lane - 4);
    // The label in its strip, the waveform below it.
    g.fillStyle = t.id === track()?.id ? k.accent : k.dim;
    g.font = `10px ${k.font}`;
    const label = `${i + 1} ${sourceLabel(t.source)}${t.effects.length ? ` · ${t.effects.length} fx` : ""}`;
    g.fillText(label, Math.max(4, x0 + 4), top + 11);
    if (c) {
      const rate = c.audio.sampleRate * (t.rate ?? 1);
      const amp = (Lane - LaneLabel - 6) / 2;
      const mid = top + LaneLabel + 2 + amp;
      g.fillStyle = k.wave;
      for (let px = Math.max(0, Math.floor(x0)); px < Math.min(w, x1); px++) {
        const s0 = (px * mixSecPerPx - offset) * rate;
        const [lo, hi] = span(c, 0, Math.floor(s0), Math.floor(s0 + mixSecPerPx * rate));
        const y = mid - hi * amp;
        g.fillRect(px, y, 1, Math.max(1, mid - lo * amp - y));
      }
    }
    g.globalAlpha = 1;
  });
  const end = mixEnd(doc, lengths());
  if (doc.loop) {
    g.globalAlpha = 0.1;
    g.fillStyle = k.wave;
    g.fillRect(x(doc.loop.start), Ruler + 1, x(doc.loop.end) - x(doc.loop.start), h);
    g.globalAlpha = 1;
  }
  g.fillStyle = k.dim;
  g.fillRect(Math.round(x(end)), Ruler + 1, 1, h);
  g.fillStyle = k.accent;
  g.fillRect(Math.round(x(mixCursor)), Ruler + 1, 1, h);
  const played = player?.mode === "mix" ? playPosition() : null;
  if (played !== null) g.fillRect(Math.round(x(played)), 0, 2, h);
  syncChecks();
}

// ---- the splitter: the lanes' height, kept per editor tab --------------------------------------------------

const lanesBox = mixCanvas.parentElement!;
const split = $("split");
const wave = $("wave");
/** The waveform's least height, as in the CSS. */
const WaveMin = 110;
let lanesHeight = vscode.getState()?.lanesHeight;
/** The lanes' height with every track shown, borders included. */
const lanesFull = () => Ruler + 1 + Lane * (doc?.tracks.length ?? 1) + 2;
const lanesMin = () => Ruler + 1 + Lane + 2;

/** Until the splitter is dragged, the CSS sizes the lanes (up to four tracks); then its height, never past every track. */
function sizeLanes() {
  if (lanesHeight === undefined) {
    lanesBox.style.height = lanesBox.style.maxHeight = "";
    return;
  }
  const h = `${Math.round(Math.max(lanesMin(), Math.min(lanesHeight, lanesFull())))}px`;
  if (lanesBox.style.height !== h) lanesBox.style.height = h;
  lanesBox.style.maxHeight = "none";
}

/** Sets the lanes to h, as far as every track and the waveform's least height allow, and keeps it. */
function setLanes(h: number) {
  const spare = Math.max(0, wave.offsetHeight - WaveMin);
  const most = Math.min(lanesFull(), lanesBox.offsetHeight + spare);
  lanesHeight = Math.round(Math.max(lanesMin(), Math.min(h, Math.max(lanesMin(), most))));
  sizeLanes();
  vscode.setState({ ...vscode.getState(), lanesHeight });
}

let splitDrag: { y: number; h: number } | null = null;
split.addEventListener("pointerdown", (ev) => {
  if (ev.button !== 0) return;
  ev.preventDefault();
  splitDrag = { y: ev.clientY, h: lanesBox.offsetHeight };
  split.classList.add("dragging");
  try {
    split.setPointerCapture(ev.pointerId);
  } catch {
    // A synthetic pointer: the drag still works over the splitter.
  }
});
split.addEventListener("pointermove", (ev) => {
  if (!splitDrag) return;
  // From the drag's start each time, so the limits never drift.
  lanesBox.style.height = `${splitDrag.h}px`;
  setLanes(splitDrag.h + ev.clientY - splitDrag.y);
});
const endSplit = () => {
  splitDrag = null;
  split.classList.remove("dragging");
};
split.addEventListener("pointerup", endSplit);
split.addEventListener("pointercancel", endSplit);
split.addEventListener("dblclick", () => setLanes(lanesFull()));
split.addEventListener("keydown", (ev) => {
  if (ev.key !== "ArrowUp" && ev.key !== "ArrowDown") return;
  ev.preventDefault();
  setLanes(lanesBox.offsetHeight + (ev.key === "ArrowDown" ? Lane : -Lane));
});

// ---- the lanes' checkboxes: checked, the track is in the mix (played, rendered, put into the game) ------

function syncChecks() {
  if (!doc) return;
  while (laneChecks.children.length > doc.tracks.length) laneChecks.lastElementChild!.remove();
  while (laneChecks.children.length < doc.tracks.length) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.addEventListener("change", () => {
      // Read now: the change redraws the lanes, which sets every box from the document.
      const on = box.checked;
      const id = doc?.tracks[[...laneChecks.children].indexOf(box.parentElement!)]?.id;
      if (id) setInMix((t) => (t.id === id ? on : !t.mute));
    });
    const row = document.createElement("div");
    row.append(box);
    laneChecks.append(row);
  }
  doc.tracks.forEach((t, i) => {
    const box = laneChecks.children[i].querySelector("input")!;
    box.checked = !t.mute;
    box.title = `Track ${i + 1}: ${t.mute ? "not in the mix. Check to put it in" : "in the mix. Uncheck to leave it out"}`;
  });
}

// ---- moving a lane: drag it up or down (the mix's mouse, below), or the lanes' menu ---------------------

const dropLine = document.createElement("div");
dropLine.className = "dropline";
dropLine.hidden = true;
mixCanvas.parentElement!.append(dropLine);

/** Moves the track at index `from` to stand before the track now at `to` (0 to the number of tracks). */
function moveTrack(from: number, to: number) {
  const tr = doc?.tracks[from];
  if (!tr || to === from || to === from + 1) return;
  selectTrack(tr.id);
  change((d) => {
    const ts = [...d.tracks];
    const [t] = ts.splice(from, 1);
    ts.splice(to > from ? to - 1 : to, 0, t);
    return { ...d, tracks: ts };
  });
}

/** Puts each track in the mix or leaves it out; out is saved as mute. */
function setInMix(inMix: (t: Track) => boolean) {
  change((d) => ({ ...d, tracks: d.tracks.map((t) => ({ ...t, mute: inMix(t) ? undefined : true })) }));
}

function lengths(): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of doc?.tracks ?? []) {
    const c = clipOf(t);
    if (c) m.set(t.id, duration(c.audio));
  }
  return m;
}

function niceStep(s: number) {
  for (const n of [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]) if (n >= s) return n;
  return 600;
}

function fmt(t: number, step = 0.001) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  return `${m}:${s.toFixed(digits).padStart(digits ? 3 + digits : 2, "0")}`;
}

// ---- views ----------------------------------------------------------------------------------------------

function clampView() {
  const total = len();
  secPerPx = Math.min(Math.max(secPerPx, 1 / 48000 / 4), (Math.max(total, 0.01) / width()) * 1.5);
  viewStart = Math.max(0, Math.min(viewStart, Math.max(0, total - width() * secPerPx * 0.5)));
}

function fit() {
  secPerPx = Math.max(len(), 0.01) / width();
  viewStart = 0;
  clampView();
  draw();
}

function fitMix() {
  if (!doc) return;
  const end = Math.max(mixEnd(doc, lengths()) + tail(doc), doc.loop?.end ?? 0, 0.5);
  mixSecPerPx = (end * 1.1) / width(mixCanvas);
}

function zoom(factor: number, around = viewStart + (width() * secPerPx) / 2) {
  const px = (around - viewStart) / secPerPx;
  secPerPx *= factor;
  clampView();
  viewStart = around - px * secPerPx;
  clampView();
  draw();
}

// ---- the clip editor's mouse ------------------------------------------------------------------------------

let drag: { anchor: number; moved: boolean } | null = null;
const timeAt = (ev: MouseEvent) => {
  const r = canvas.getBoundingClientRect();
  return Math.max(0, Math.min(len(), viewStart + (ev.clientX - r.left) * secPerPx));
};
const capture = (c: HTMLCanvasElement, id: number) => {
  try {
    c.setPointerCapture(id);
  } catch {
    // Not a live pointer (a synthetic event): the drag still works inside the canvas.
  }
};

canvas.addEventListener("pointerdown", (ev) => {
  // Only the left button selects; the right one opens the clip's menu and leaves the selection.
  if (!clip() || ev.button !== 0) return;
  capture(canvas, ev.pointerId);
  const t = timeAt(ev);
  if (ev.shiftKey) {
    const anchor = selection ? (Math.abs(t - selection.start) < Math.abs(t - selection.end) ? selection.end : selection.start) : cursor;
    selection = { start: Math.min(anchor, t), end: Math.max(anchor, t) };
    drag = { anchor, moved: true };
  } else {
    drag = { anchor: t, moved: false };
    cursor = t;
  }
  refreshTime();
  draw();
});
canvas.addEventListener("pointermove", (ev) => {
  if (!drag) return;
  const t = timeAt(ev);
  if (Math.abs(t - drag.anchor) / secPerPx > 2) drag.moved = true;
  if (drag.moved) selection = { start: Math.min(drag.anchor, t), end: Math.max(drag.anchor, t) };
  refreshTime();
  draw();
});
canvas.addEventListener("pointerup", () => {
  if (!drag) return;
  if (!drag.moved) {
    selection = null;
    if (player?.mode === "clip") playClip(cursor);
  }
  if (selection) cursor = selection.start;
  drag = null;
  refreshTime();
  draw();
});
canvas.addEventListener(
  "wheel",
  (ev) => {
    ev.preventDefault();
    if (ev.ctrlKey || ev.metaKey || (Math.abs(ev.deltaY) > Math.abs(ev.deltaX) && !ev.shiftKey)) {
      const r = canvas.getBoundingClientRect();
      zoom(ev.deltaY > 0 ? 1.25 : 0.8, viewStart + (ev.clientX - r.left) * secPerPx);
    } else {
      viewStart += (ev.shiftKey ? ev.deltaY : ev.deltaX) * secPerPx;
      clampView();
      draw();
    }
  },
  { passive: false },
);
new ResizeObserver(() => {
  clampView();
  fitMix();
  draw();
}).observe(canvas);

// ---- the mix's mouse: a click selects a lane and places the mix cursor; a drag sideways moves a clip in
// time, up or down moves the lane. The first few pixels pick the direction, and it holds for the drag. -----

let dragging: {
  id: string;
  lane: number;
  grab: number;
  offset: number;
  x: number;
  y: number;
  inClip: boolean;
  mode: "time" | "lane" | null;
  to: number;
} | null = null;
const mixAt = (ev: MouseEvent) => {
  const r = mixCanvas.getBoundingClientRect();
  return { t: Math.max(0, (ev.clientX - r.left) * mixSecPerPx), lane: Math.floor((ev.clientY - r.top - Ruler - 1) / Lane) };
};

mixCanvas.addEventListener("pointerdown", (ev) => {
  if (!doc || ev.button !== 0) return;
  const { t, lane } = mixAt(ev);
  const tr = doc.tracks[lane];
  if (!tr) {
    mixCursor = t;
    draw();
    return;
  }
  selectTrack(tr.id);
  const c = clipOf(tr);
  const end = tr.offset + (c ? onMix(tr, duration(c.audio)) : 0);
  capture(mixCanvas, ev.pointerId);
  dragging = { id: tr.id, lane, grab: t - tr.offset, offset: tr.offset, x: ev.clientX, y: ev.clientY, inClip: t >= tr.offset && t <= end, mode: null, to: lane };
  draw();
});
mixCanvas.addEventListener("pointermove", (ev) => {
  if (!dragging || !doc) return;
  const dx = ev.clientX - dragging.x, dy = ev.clientY - dragging.y;
  if (!dragging.mode && Math.hypot(dx, dy) > 4) {
    dragging.mode = Math.abs(dy) > Math.abs(dx) ? "lane" : dragging.inClip ? "time" : null;
    if (dragging.mode === "lane") mixCanvas.style.cursor = "ns-resize";
  }
  if (dragging.mode === "time") {
    dragging.offset = Math.max(0, mixAt(ev).t - dragging.grab);
    drawMix();
  } else if (dragging.mode === "lane") {
    const box = mixCanvas.parentElement!, r = box.getBoundingClientRect();
    // Past the top or bottom edge, the lanes scroll.
    if (ev.clientY < r.top + 16) box.scrollTop -= 12;
    else if (ev.clientY > r.bottom - 16) box.scrollTop += 12;
    const y = ev.clientY - r.top - box.clientTop + box.scrollTop - Ruler - 1;
    dragging.to = Math.max(0, Math.min(doc.tracks.length, Math.round(y / Lane)));
    dropLine.hidden = dragging.to === dragging.lane || dragging.to === dragging.lane + 1;
    dropLine.style.top = `${Ruler + 1 + dragging.to * Lane}px`;
  }
});
const endMixDrag = (ev: PointerEvent) => {
  if (!dragging) return;
  const d = dragging;
  dragging = null;
  mixCanvas.style.cursor = "";
  dropLine.hidden = true;
  if (ev.type === "pointercancel") return drawMix();
  if (d.mode === "time") changeTrack((t) => ({ ...t, offset: Math.round(d.offset * 1000) / 1000 }));
  else if (d.mode === "lane") moveTrack(d.lane, d.to);
  else if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) <= 4) {
    mixCursor = mixAt(ev).t;
    draw();
  }
};
mixCanvas.addEventListener("pointerup", endMixDrag);
mixCanvas.addEventListener("pointercancel", endMixDrag);

// ---- playback ---------------------------------------------------------------------------------------------

/** Where the player is: in the clip's seconds (clip mode) or the mix's (mix mode). */
function playPosition(): number | null {
  if (!player || !ctx) return null;
  const moved = (ctx.currentTime - player.startedAt) * player.rate;
  if (player.loop) {
    const first = player.loop.end - player.from;
    if (moved < first) return player.from + moved;
    return player.loop.start + ((moved - first) % (player.loop.end - player.loop.start));
  }
  return Math.min(player.end, player.from + moved);
}

function stop() {
  if (player) {
    const p = player;
    player = null;
    p.stop();
  }
  $("play").classList.remove("on");
  $("playMix").classList.remove("on");
  draw();
}

function startTicking(mode: "clip" | "mix") {
  const tick = () => {
    if (!player || player.mode !== mode) return;
    const p = playPosition();
    if (p !== null && !player.loop && p >= player.end) {
      if (mode === "mix" && looping) playMix(doc?.loop?.start ?? 0);
      else stop();
      return;
    }
    refreshTime();
    draw();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** The selected clip through its track's effects, gain and pan: within the selection, looping it when Loop is on. */
function playClip(from = cursor) {
  const t = track();
  const c = clip();
  if (!doc || !t || !c) return;
  stop();
  ctx ??= new AudioContext();
  void ctx.resume();
  let end = duration(c);
  if (selection) {
    end = selection.end;
    if (from < selection.start || from >= selection.end) from = selection.start;
  }
  let loop: { start: number; end: number } | null = null;
  if (looping) {
    loop = selection ?? { start: 0, end: duration(c) };
    if (from < loop.start || from >= loop.end) from = loop.start;
  }
  const built = buildMix(ctx, doc, (x) => clipOf(x)?.audio, from, ctx.destination, { track: t, loop, end });
  player = { mode: "clip", stop: () => built.sources.forEach((s) => s.stop()), startedAt: ctx.currentTime, from, rate: t.rate ?? 1, loop, end };
  $("play").classList.add("on");
  startTicking("clip");
}

/** The whole mix from the mix cursor (or a time), with the master; Loop starts it over at the end. */
function playMix(from = mixCursor) {
  if (!doc) return;
  stop();
  ctx ??= new AudioContext();
  void ctx.resume();
  const end = (doc.loop && looping ? doc.loop.end : mixEnd(doc, lengths()) + tail(doc)) || 0;
  if (from >= end) from = doc.loop && looping ? doc.loop.start : 0;
  const built = buildMix(ctx, doc, (x) => clipOf(x)?.audio, from, ctx.destination);
  player = { mode: "mix", stop: () => built.sources.forEach((s) => s.stop()), startedAt: ctx.currentTime, from, rate: 1, loop: null, end };
  $("playMix").classList.add("on");
  startTicking("mix");
}

// ---- the buttons -------------------------------------------------------------------------------------------

function on(id: string, f: () => void) {
  $(id).addEventListener("click", () => {
    if (!doc) return;
    f();
  });
}
const selOr = (fallback: () => { start: number; end: number } | null) => selection ?? fallback();

on("play", () => (player?.mode === "clip" ? stop() : playClip()));
on("playMix", () => (player?.mode === "mix" ? stop() : playMix()));
on("loopPlay", () => {
  looping = !looping;
  $("loopPlay").classList.toggle("on", looping);
  if (player?.mode === "clip") playClip(playPosition() ?? cursor);
  else if (player?.mode === "mix") playMix(playPosition() ?? mixCursor);
});
on("addSound", () => send({ type: "addSound" }));
on("stopMix", stop);
on("stopClip", stop);

/** Where clips start and end on the mix, with 0, in order. */
function edges(): number[] {
  const at = new Set<number>([0]);
  for (const t of doc?.tracks ?? []) {
    const c = clipOf(t);
    at.add(round(t.offset));
    if (c) at.add(round(t.offset + onMix(t, duration(c.audio))));
  }
  return [...at].sort((a, b) => a - b);
}
const jumped = () => {
  if (player?.mode === "mix") playMix(mixCursor);
  refreshTime();
  draw();
};
on("toPrev", () => {
  const before = edges().filter((x) => x < mixCursor - 1e-6);
  mixCursor = before.length ? before[before.length - 1] : 0;
  jumped();
});
on("toNext", () => {
  const after = edges().filter((x) => x > mixCursor + 1e-6);
  if (after.length) mixCursor = after[0];
  jumped();
});
on("zoomIn", () => zoom(0.5));
on("zoomOut", () => zoom(2));
on("zoomFit", fit);
on("zoomSel", () => {
  if (!selection) return;
  secPerPx = (selection.end - selection.start) / width();
  viewStart = selection.start;
  clampView();
  draw();
});

on("trim", () => {
  if (!selection) return;
  const s = selection;
  selection = null;
  cursor = 0;
  addEdit({ op: "trim", start: round(s.start), end: round(s.end) });
  fit();
});
const cut = () => {
  const t = track();
  if (!selection || !t) return;
  const s = selection;
  // What was cut can be pasted: it stays in the clip before this cut.
  clipboard = { track: t.id, start: s.start, end: s.end, after: t.edits.length };
  selection = null;
  cursor = s.start;
  addEdit({ op: "cut", start: round(s.start), end: round(s.end) });
};
on("cut", cut);
const copy = () => {
  const t = track();
  if (selection && t) clipboard = { track: t.id, start: selection.start, end: selection.end, after: t.edits.length };
  refreshPanels();
};
on("copy", copy);
const paste = () => {
  const t = track();
  if (!clipboard || !t || clipboard.track !== t.id) return;
  const from = clipboard;
  const at = cursor;
  // Name the clip the copy came from only when edits came after it.
  const range = { start: round(from.start), end: round(from.end) };
  addEdit({ op: "paste", at: round(at), from: from.after === t.edits.length ? range : { ...range, after: from.after } });
  selection = { start: at, end: at + (from.end - from.start) };
  draw();
};
on("paste", paste);
on("silence", () => {
  const length = selection ? selection.end - selection.start : 0.5;
  addEdit({ op: "silence", at: round(cursor), length: round(length) });
});
const curve = () => $<HTMLSelectElement>("curve").value as Curve;
on("fadeIn", () => {
  // No selection: start to the cursor, or the first half second when the cursor is at the start.
  const r = selOr(() => (cursor > 0 ? { start: 0, end: cursor } : { start: 0, end: Math.min(0.5, len() / 4) }));
  if (r) addEdit({ op: "fade", dir: "in", start: round(r.start), end: round(r.end), curve: curve() });
});
on("fadeOut", () => {
  // No selection: the cursor to the end, or the last half second when the cursor is at the start or the end.
  const r = selOr(() => (cursor > 0 && cursor < len() ? { start: cursor, end: len() } : { start: len() - Math.min(0.5, len() / 4), end: len() }));
  if (r) addEdit({ op: "fade", dir: "out", start: round(r.start), end: round(r.end), curve: curve() });
});
on("gain", () => {
  const db = Number($<HTMLInputElement>("gainDb").value);
  if (!Number.isFinite(db) || db === 0) return;
  addEdit(selection ? { op: "gain", db, start: round(selection.start), end: round(selection.end) } : { op: "gain", db });
});
on("normalize", () => {
  const peakDb = Math.min(0, Number($<HTMLInputElement>("peakDb").value));
  if (!Number.isFinite(peakDb)) return;
  addEdit(selection ? { op: "normalize", peakDb, start: round(selection.start), end: round(selection.end) } : { op: "normalize", peakDb });
});
on("channels", () => {
  const c = clip();
  if (c) addEdit({ op: "channels", to: c.channels.length === 1 ? 2 : 1 });
});
on("setLoop", () => {
  const t = track();
  if (!selection || !t) return;
  // The clip's selection, as times on the mix.
  const rate = t.rate ?? 1;
  const s = { start: round(t.offset + selection.start / rate), end: round(t.offset + selection.end / rate) };
  change((d) => ({ ...d, loop: s }));
});
on("clearLoop", () => change((d) => ({ ...d, loop: null })));

// The selected track's controls.
const numberInput = (id: string, f: (v: number) => void) =>
  $<HTMLInputElement>(id).addEventListener("change", (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    if (Number.isFinite(v)) f(v);
  });
numberInput("trackGain", (v) => changeTrack((t) => ({ ...t, gain: v })));
numberInput("trackPan", (v) => changeTrack((t) => ({ ...t, pan: Math.max(-1, Math.min(1, v)) })));
numberInput("trackRate", (v) => changeTrack((t) => ({ ...t, rate: v > 0 && v !== 1 ? Math.max(0.25, Math.min(4, v)) : undefined })));
numberInput("trackOffset", (v) => changeTrack((t) => ({ ...t, offset: Math.max(0, v) })));
on("removeTrack", () => {
  const t = track();
  if (!t || !doc) return;
  change((d) => ({ ...d, tracks: d.tracks.filter((x) => x.id !== t.id) }));
});
numberInput("masterGain", (v) => change((d) => ({ ...d, master: { ...d.master, gain: v } })));

/** A preset menu: applying one replaces the chain it is for. */
function presetMenu(id: string, apply: (effects: Effect[]) => void) {
  const s = $<HTMLSelectElement>(id);
  s.replaceChildren(new Option("Preset…", ""), ...Object.entries(Presets).map(([k, p]) => new Option(p.label, k)));
  s.addEventListener("change", () => {
    if (s.value) apply(presetEffects(s.value));
    s.value = "";
  });
}
presetMenu("trackPreset", (effects) => changeTrack((t) => ({ ...t, effects })));
presetMenu("masterPreset", (effects) => change((d) => ({ ...d, master: { ...d.master, effects } })));

/** An Add effect menu. */
function addMenu(id: string, add: (e: Effect) => void) {
  const s = $<HTMLSelectElement>(id);
  s.replaceChildren(new Option("Add effect…", ""), ...Object.entries(Effects).map(([k, e]) => new Option(e.label, k)));
  s.addEventListener("change", () => {
    if (s.value) add(Effects[s.value as EffectType].make());
    s.value = "";
  });
}
addMenu("trackAdd", (e) => changeTrack((t) => ({ ...t, effects: [...t.effects, e] })));
addMenu("masterAdd", (e) => change((d) => ({ ...d, master: { ...d.master, effects: [...d.master.effects, e] } })));

$<HTMLInputElement>("voice").addEventListener("change", (e) => {
  const v = (e.target as HTMLInputElement).checked;
  changeTrack((t) => ({ ...t, voice: v || undefined }));
});
on("translate", () => send({ type: "stub", tool: "translate" }));

$<HTMLSelectElement>("rate").addEventListener("change", (e) => {
  const v = (e.target as HTMLSelectElement).value;
  change((d) => ({ ...d, render: { ...d.render, sampleRate: v ? Number(v) : undefined } }));
});

// ---- render: the mix through an OfflineAudioContext, the same graph as playback --------------------------

function renderFormat() {
  if (!doc) return null;
  const heard = audible(doc.tracks)
    .map((t) => clipOf(t)?.audio)
    .filter((a): a is Audio => !!a);
  const first = clip(doc.tracks[0]) ?? heard[0];
  const rate = doc.render.sampleRate ?? first?.sampleRate ?? 48000;
  const reverb = (es: Effect[]) => es.some((e) => e.type === "reverb" && !e.bypass);
  const stereo = heard.some((a) => a.channels.length > 1) || audible(doc.tracks).some((t) => t.pan !== 0 || reverb(t.effects)) || reverb(doc.master.effects);
  const seconds = mixEnd(doc, lengths()) + tail(doc);
  return { rate, channels: stereo ? 2 : 1, seconds };
}

/** The mix as a 16-bit WAV at a rate and channel count. */
async function renderMix(rate: number, channels: number): Promise<Uint8Array> {
  if (!doc) throw new Error("No document");
  const f = renderFormat();
  if (!f || f.seconds <= 0) throw new Error("The mix is empty");
  const off = new OfflineAudioContext(channels, Math.max(1, Math.ceil(f.seconds * rate)), rate);
  buildMix(off, doc, (x) => clipOf(x)?.audio, 0, off.destination);
  const r = await off.startRendering();
  return encodeWav({ sampleRate: rate, channels: Array.from({ length: r.numberOfChannels }, (_, c) => r.getChannelData(c).slice()) });
}

on("intoGame", () => send({ type: "intoGame" }));

on("render", async () => {
  if (!doc) return;
  const f = renderFormat();
  if (!f || f.seconds <= 0) return;
  const btn = $<HTMLButtonElement>("render");
  btn.disabled = true;
  try {
    send({ type: "render", wav: await renderMix(f.rate, f.channels) });
  } catch (err) {
    send({ type: "error", text: `Render failed: ${(err as Error).message}` });
  } finally {
    btn.disabled = false;
  }
});

document.addEventListener("keydown", (ev) => {
  const target = ev.target as HTMLElement;
  if (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA" || !$("dialog").hidden) return;
  const mod = ev.ctrlKey || ev.metaKey;
  if (ev.key === " ") {
    ev.preventDefault();
    // Space: the clip. Shift+Space: the mix.
    if (ev.shiftKey) player?.mode === "mix" ? stop() : playMix();
    else player?.mode === "clip" ? stop() : playClip();
  } else if ((ev.key === "Delete" || ev.key === "Backspace") && selection) {
    ev.preventDefault();
    cut();
  } else if (mod && ev.key.toLowerCase() === "x" && selection) {
    ev.preventDefault();
    cut();
  } else if (mod && ev.key.toLowerCase() === "c" && selection) {
    ev.preventDefault();
    copy();
  } else if (mod && ev.key.toLowerCase() === "v" && clipboard) {
    ev.preventDefault();
    paste();
  } else if (mod && ev.key.toLowerCase() === "a") {
    ev.preventDefault();
    selection = { start: 0, end: len() };
    draw();
    refreshTime();
  } else if (ev.key === "Home") {
    cursor = 0;
    selection = null;
    draw();
    refreshTime();
  } else if (ev.key === "End") {
    cursor = len();
    selection = null;
    draw();
    refreshTime();
  }
});

// ---- panels -----------------------------------------------------------------------------------------------

function describe(e: Edit): string {
  const r = (s?: number, t?: number) => (s === undefined ? "whole clip" : `${fmt(s)} to ${fmt(t ?? 0)}`);
  switch (e.op) {
    case "trim":
      return `Trim to ${r(e.start, e.end)}`;
    case "cut":
      return `Cut ${r(e.start, e.end)}`;
    case "paste":
      return `Paste ${r(e.from.start, e.from.end)}${e.from.after !== undefined ? ` (as before edit ${e.from.after + 1})` : ""} at ${fmt(e.at)}`;
    case "silence":
      return `Silence of ${e.length.toFixed(3)} s at ${fmt(e.at)}`;
    case "fade":
      return `Fade ${e.dir} ${r(e.start, e.end)}${e.curve && e.curve !== "linear" ? `, ${e.curve}` : ""}`;
    case "gain":
      return `Gain ${e.db > 0 ? "+" : ""}${e.db} dB, ${r(e.start, e.end)}`;
    case "normalize":
      return `Normalize to ${e.peakDb} dBFS, ${r(e.start, e.end)}`;
    case "channels":
      return e.to === 1 ? "Mix to mono" : "Mono to stereo";
  }
}

/** An effects list: each effect's parameters as number fields, an on switch and a remove button. */
function effectsList(list: HTMLElement, effects: Effect[], set: (next: Effect[]) => void) {
  list.replaceChildren(
    ...effects.map((e, i) => {
      const li = document.createElement("li");
      const on = document.createElement("input");
      on.type = "checkbox";
      on.checked = !e.bypass;
      on.title = "On, or bypassed";
      on.addEventListener("change", () => set(effects.map((x, j) => (j === i ? { ...x, bypass: !on.checked || undefined } : x))));
      const name = document.createElement("span");
      name.className = "fx";
      name.textContent = Effects[e.type].label;
      // The parameters wrap within their own column, never under the name.
      const params = document.createElement("span");
      params.className = "params";
      for (const p of Effects[e.type].params) params.append(paramField(e, p, (v) => set(effects.map((x, j) => (j === i ? ({ ...x, [p.key]: v } as Effect) : x)))));
      li.append(on, name, params);
      const x = document.createElement("button");
      x.className = "x";
      x.textContent = "×";
      x.title = "Remove this effect";
      x.addEventListener("click", () => set(effects.filter((_, j) => j !== i)));
      li.append(x);
      return li;
    }),
  );
}

function paramField(e: Effect, p: Param, set: (v: number) => void): HTMLElement {
  const label = document.createElement("label");
  label.className = "param";
  label.textContent = p.label;
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(p.min);
  input.max = String(p.max);
  input.step = String(p.step);
  input.value = String((e as unknown as Record<string, number>)[p.key]);
  input.title = `${p.label}${p.unit ? ` (${p.unit})` : ""}, ${p.min} to ${p.max}`;
  input.addEventListener("change", () => {
    const v = Number(input.value);
    if (Number.isFinite(v)) set(Math.max(p.min, Math.min(p.max, v)));
  });
  label.append(input);
  if (p.unit) label.append(p.unit);
  return label;
}

/** The controls that need a track, off while the document has none. */
const TrackControls = ["trackGain", "trackPan", "trackRate", "trackOffset", "removeTrack", "play", "stopClip", "trim", "cut", "copy", "paste", "silence", "fadeIn", "fadeOut", "curve", "gainDb", "gain", "peakDb", "normalize", "channels", "setLoop", "trackPreset", "trackAdd", "voice", "playMix", "render", "intoGame"];

function refreshPanels() {
  if (!doc) return;
  const t = track();
  for (const id of TrackControls) $<HTMLInputElement>(id).disabled = !t;
  if (!t) {
    for (const id of ["meta", "trackName", "editsOf", "effectsOf", "renderInfo"]) $(id).textContent = "";
    for (const id of ["edits", "trackEffects"]) $(id).replaceChildren();
    for (const id of ["trackGain", "trackPan", "trackRate", "trackOffset"]) $<HTMLInputElement>(id).value = "";
    $<HTMLInputElement>("voice").checked = false;
    $("translate").hidden = $("revoice").hidden = true;
    $("noEdits").hidden = $("noEffects").hidden = true;
    $<HTMLInputElement>("masterGain").value = String(doc.master.gain);
    effectsList($("masterEffects"), doc.master.effects, (effects) => change((d) => ({ ...d, master: { ...d.master, effects } })));
    $("renderFile").textContent = doc.render.file;
    $<HTMLSelectElement>("rate").value = doc.render.sampleRate ? String(doc.render.sampleRate) : "";
    refreshTime();
    return;
  }
  const c = clip(t);
  $("meta").textContent = sources.get(sourceKey(t.source))?.info ?? "";
  const voice = !!t.voice;
  $<HTMLInputElement>("voice").checked = voice;
  $("translate").hidden = !voice;
  $("revoice").hidden = !voice;
  $("trackName").textContent = `${doc.tracks.indexOf(t) + 1} · ${sourceLabel(t.source)}`;
  $<HTMLInputElement>("trackGain").value = String(t.gain);
  $<HTMLInputElement>("trackPan").value = String(t.pan);
  $<HTMLInputElement>("trackRate").value = String(t.rate ?? 1);
  $<HTMLInputElement>("trackOffset").value = String(t.offset);
  $("channels").textContent = c && c.channels.length === 1 ? "Stereo" : "Mono";
  $<HTMLButtonElement>("paste").disabled = !clipboard || clipboard.track !== t.id;

  $("editsOf").textContent = `Track ${doc.tracks.indexOf(t) + 1}`;
  $("edits").replaceChildren(
    ...t.edits.map((e, i) => {
      const li = document.createElement("li");
      const text = document.createElement("span");
      text.textContent = describe(e);
      const x = document.createElement("button");
      x.className = "x";
      x.textContent = "×";
      x.title = "Remove this edit. Later edits keep their times, so they may land elsewhere.";
      x.addEventListener("click", () => changeTrack((tr) => ({ ...tr, edits: tr.edits.filter((_, j) => j !== i) })));
      li.append(text, x);
      return li;
    }),
  );
  $("noEdits").hidden = t.edits.length > 0;
  $("effectsOf").textContent = `Track ${doc.tracks.indexOf(t) + 1}`;
  effectsList($("trackEffects"), t.effects, (effects) => changeTrack((tr) => ({ ...tr, effects })));
  $("noEffects").hidden = t.effects.length > 0;
  $<HTMLInputElement>("masterGain").value = String(doc.master.gain);
  effectsList($("masterEffects"), doc.master.effects, (effects) => change((d) => ({ ...d, master: { ...d.master, effects } })));

  $("renderFile").textContent = doc.render.file;
  $<HTMLSelectElement>("rate").value = doc.render.sampleRate ? String(doc.render.sampleRate) : "";
  const f = renderFormat();
  $("renderInfo").textContent = f && f.seconds > 0 ? `${fmt(f.seconds)} · ${f.channels === 1 ? "mono" : "stereo"} · ${f.rate} Hz · 16-bit` : "";
  refreshTime();
}

function refreshTime() {
  const p = playPosition();
  const clipParts = [`${fmt(player?.mode === "clip" && p !== null ? p : cursor)} / ${fmt(len())}`];
  if (selection) clipParts.push(`selection ${fmt(selection.start)} to ${fmt(selection.end)} (${(selection.end - selection.start).toFixed(3)} s)`);
  $("time").textContent = clipParts.join(" · ");
  const end = doc ? mixEnd(doc, lengths()) : 0;
  const mixParts = [`${fmt(player?.mode === "mix" && p !== null ? p : mixCursor)} / ${fmt(end)}`];
  if (doc?.loop) mixParts.push(`loop ${fmt(doc.loop.start)} to ${fmt(doc.loop.end)}`);
  $("mixTime").textContent = mixParts.join(" · ");
}

// ---- the clip's menu: right-click on the waveform, its edit actions at the pointer --------------------

const menu = document.createElement("div");
menu.className = "menu";
menu.hidden = true;
document.body.append(menu);
const hideMenu = () => (menu.hidden = true);
const canPaste = () => !!clipboard && clipboard.track === track()?.id;
const MenuItems: [string, string, () => boolean][] = [
  ["Play clip", "play", () => true],
  ["Trim", "trim", () => !!selection],
  ["Cut", "cut", () => !!selection],
  ["Copy", "copy", () => !!selection],
  ["Paste", "paste", canPaste],
  ["Silence", "silence", () => true],
  ["Fade in", "fadeIn", () => true],
  ["Fade out", "fadeOut", () => true],
  ["Apply gain", "gain", () => true],
  ["Normalize", "normalize", () => true],
  ["Set loop", "setLoop", () => !!selection],
];
/** Shows the menu at the pointer: a label, whether it is enabled, and what it does. */
function showMenu(ev: MouseEvent, items: [string, boolean, () => void][]) {
  menu.replaceChildren(
    ...items.map(([label, ok, act]) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.disabled = !ok;
      b.addEventListener("click", () => {
        hideMenu();
        act();
      });
      return b;
    }),
  );
  menu.hidden = false;
  menu.style.left = `${Math.max(0, Math.min(ev.clientX, innerWidth - menu.offsetWidth - 4))}px`;
  menu.style.top = `${Math.max(0, Math.min(ev.clientY, innerHeight - menu.offsetHeight - 4))}px`;
}
canvas.addEventListener("contextmenu", (ev) => {
  ev.preventDefault();
  ev.stopPropagation();
  if (!clip()) return;
  showMenu(ev, MenuItems.map(([label, id, ok]) => [label, ok(), () => $<HTMLButtonElement>(id).click()]));
});
// The lanes' menu: right-click a lane or its checkbox.
mixCanvas.parentElement!.addEventListener("contextmenu", (ev) => {
  ev.preventDefault();
  ev.stopPropagation();
  const i = mixAt(ev).lane;
  const tr = doc?.tracks[i];
  if (!doc || !tr) return;
  selectTrack(tr.id);
  const others = doc.tracks.some((t) => t.id !== tr.id && !t.mute);
  showMenu(ev, [
    ["Only This Track", !!tr.mute || others, () => setInMix((t) => t.id === tr.id)],
    ["All Tracks", doc.tracks.some((t) => t.mute), () => setInMix(() => true)],
    ["Move Up", i > 0, () => moveTrack(i, i - 1)],
    ["Move Down", i < doc.tracks.length - 1, () => moveTrack(i, i + 2)],
  ]);
});
document.addEventListener("pointerdown", (e) => {
  if (!menu.contains(e.target as Node)) hideMenu();
}, true);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideMenu();
});
window.addEventListener("blur", hideMenu);

// ---- dropping sound files: on the lanes, new tracks; on the clip, the selected track's sound -------------
// VS Code opens a file dropped on an editor itself unless Shift is held, so the notes say to hold it.
// Files from VS Code's Explorer come as URIs; files from the desktop only as their bytes.

function dropTarget(el: HTMLElement, on: "mix" | "clip") {
  const files = (ev: DragEvent) => !!ev.dataTransfer && [...ev.dataTransfer.types].some((t) => t === "Files" || t.endsWith("uri-list"));
  el.addEventListener("dragover", (ev) => {
    if (!doc || !files(ev)) return;
    ev.preventDefault();
    ev.dataTransfer!.dropEffect = "copy";
    el.classList.add("dropping");
  });
  el.addEventListener("dragleave", (ev) => {
    if (!el.contains(ev.relatedTarget as Node)) el.classList.remove("dropping");
  });
  el.addEventListener("drop", async (ev) => {
    el.classList.remove("dropping");
    if (!doc || !ev.dataTransfer) return;
    ev.preventDefault();
    const dt = ev.dataTransfer;
    const list = (dt.getData("application/vnd.code.uri-list") || (dt.files.length ? "" : dt.getData("text/uri-list")))
      .split(/\r?\n/)
      .map((u) => u.trim())
      .filter((u) => u && !u.startsWith("#"));
    const dropped = list.length ? [] : await Promise.all([...dt.files].map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
    if (list.length || dropped.length) send({ type: "dropped", on, track: track()?.id, uris: list, files: dropped });
  });
}
dropTarget(mixCanvas.parentElement!, "mix");
dropTarget(wave, "clip");

setupVoiceTools({
  send,
  track,
  clip: () => clip(),
  mixCursor: () => mixCursor,
  audio: () => (ctx ??= new AudioContext()),
  stop,
});

send({ type: "ready" });
