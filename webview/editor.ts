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

declare function acquireVsCodeApi(): { postMessage(m: unknown): void };
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
const seenTracks = new Set<string>();

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

window.addEventListener("message", async (e) => {
  const m = e.data;
  if (m.type === "doc") {
    const same = doc && JSON.stringify(doc) === JSON.stringify(m.doc);
    doc = m.doc as SoundDoc;
    // A track that appeared since the last document (Add Sound) becomes the selected one.
    const fresh = doc.tracks.filter((t) => !seenTracks.has(t.id));
    doc.tracks.forEach((t) => seenTracks.add(t.id));
    if (fresh.length && seenTracks.size > fresh.length) selectTrack(fresh[fresh.length - 1].id);
    if (!doc.tracks.some((t) => t.id === selId)) selId = doc.tracks[0].id;
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
  } else if (m.type === "renderFor") {
    // Into the Game: the mix at the format its route needs.
    try {
      const first = doc ? sources.get(sourceKey(doc.tracks[0].source))?.audio : undefined;
      const channels = m.channels === "source" ? Math.min(2, first?.channels.length ?? 2) : m.channels;
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
  sources.set(key, { audio, info: `${name} · ${codec ?? ""} ${ch} ${buf.sampleRate} Hz` });
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
  note(!doc ? "Loading…" : failed.get(key) ?? (c ? null : "Loading the sound…"));
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
  const h = Ruler + 1 + Lane * doc.tracks.length;
  mixCanvas.style.height = `${h}px`;
  const w = width(mixCanvas);
  const g = setup(mixCanvas, h);
  const k = colours();
  ruler(g, w, 0, mixSecPerPx, k);
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
    const label = `${i + 1} ${sourceLabel(t.source)}${t.mute ? " · muted" : ""}${t.solo ? " · solo" : ""}${t.effects.length ? ` · ${t.effects.length} fx` : ""}`;
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
  if (!clip()) return;
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
  if (drag && !drag.moved) {
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

// ---- the mix's mouse: select a lane, drag a clip to move it, click elsewhere to place the mix cursor -----

let dragging: { id: string; grab: number; offset: number; moved: boolean } | null = null;
const mixAt = (ev: MouseEvent) => {
  const r = mixCanvas.getBoundingClientRect();
  return { t: Math.max(0, (ev.clientX - r.left) * mixSecPerPx), lane: Math.floor((ev.clientY - r.top - Ruler - 1) / Lane) };
};

mixCanvas.addEventListener("pointerdown", (ev) => {
  if (!doc) return;
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
  if (t >= tr.offset && t <= end) {
    capture(mixCanvas, ev.pointerId);
    dragging = { id: tr.id, grab: t - tr.offset, offset: tr.offset, moved: false };
  } else {
    mixCursor = t;
  }
  draw();
});
mixCanvas.addEventListener("pointermove", (ev) => {
  if (!dragging) return;
  const { t } = mixAt(ev);
  const offset = Math.max(0, t - dragging.grab);
  if (Math.abs(offset - dragging.offset) / mixSecPerPx > 1) dragging.moved = true;
  if (dragging.moved) dragging.offset = offset;
  drawMix();
});
mixCanvas.addEventListener("pointerup", (ev) => {
  if (!dragging) return;
  const d = dragging;
  dragging = null;
  if (d.moved) changeTrack((t) => ({ ...t, offset: Math.round(d.offset * 1000) / 1000 }));
  else {
    mixCursor = mixAt(ev).t;
    draw();
  }
});

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
  $("play").textContent = "Play clip";
  $("playMix").textContent = "Play mix";
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
  $("play").textContent = "Stop";
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
  $("playMix").textContent = "Stop";
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
  const r = selOr(() => (cursor > 0 ? { start: 0, end: cursor } : null));
  if (r) addEdit({ op: "fade", dir: "in", start: round(r.start), end: round(r.end), curve: curve() });
});
on("fadeOut", () => {
  const r = selOr(() => (cursor < len() ? { start: cursor, end: len() } : null));
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
on("mute", () => changeTrack((t) => ({ ...t, mute: !t.mute || undefined })));
on("solo", () => changeTrack((t) => ({ ...t, solo: !t.solo || undefined })));
on("removeTrack", () => {
  const t = track();
  if (!t || !doc || doc.tracks.length < 2) return;
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
on("revoice", () => send({ type: "stub", tool: "revoice" }));

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
  if (target.tagName === "INPUT" || target.tagName === "SELECT") return;
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

function refreshPanels() {
  if (!doc) return;
  const t = track()!;
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
  $("mute").classList.toggle("on", !!t.mute);
  $("solo").classList.toggle("on", !!t.solo);
  $<HTMLButtonElement>("removeTrack").disabled = doc.tracks.length < 2;
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

send({ type: "ready" });
