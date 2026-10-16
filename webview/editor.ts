// The sound editor's page. The host sends the document and the source's audio; the page decodes
// the audio once, applies the document's edits (src/audio/edits.ts) for the waveform, playback and
// render, and sends every change back as a whole new document, which the host writes into the
// .edgewave text (so VS Code's undo and redo cover it).

import { applyEdits, duration, frames, type Audio } from "../src/audio/edits";
import { encodeWav } from "../src/audio/wav";
import type { Curve, Edit, SoundDoc } from "../src/doc";

declare function acquireVsCodeApi(): { postMessage(m: unknown): void };
const vscode = acquireVsCodeApi();
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const send = (m: unknown) => vscode.postMessage(m);

// ---- state ------------------------------------------------------------------------------------

let doc: SoundDoc | null = null;
let source: Audio | null = null;
let sourceInfo = "";
let edited: Audio | null = null;
let peaks: Peaks | null = null;
/** The view: the time at the left edge, and seconds per CSS pixel. */
let viewStart = 0;
let secPerPx = 0.01;
let cursor = 0;
let selection: { start: number; end: number } | null = null;
/** A copied range, in the current sound's times; dropped when an edit changes the length. */
let clipboard: { start: number; end: number } | null = null;

let ctx: AudioContext | null = null;
let player: { node: AudioBufferSourceNode; startedAt: number; offset: number; loop: { start: number; end: number } | null; end: number } | null = null;
let looping = false;

// ---- messages from the host -----------------------------------------------------------------------

window.addEventListener("message", async (e) => {
  const m = e.data;
  if (m.type === "doc") {
    const same = doc && JSON.stringify(doc) === JSON.stringify(m.doc);
    const oldEdits = doc ? JSON.stringify(doc.edits) : "";
    doc = m.doc as SoundDoc;
    $("title").textContent = m.label;
    if (!same) {
      if (JSON.stringify(doc.edits) !== oldEdits) recompute();
      refreshPanels();
      draw();
    }
  } else if (m.type === "invalid") {
    note(`This document cannot be edited here: ${m.text}. Fix the JSON (Reopen With > Text Editor), then reopen it.`);
  } else if (m.type === "audio") {
    try {
      await loadAudio(m.data as Uint8Array, m.codec, m.name);
    } catch (err) {
      note(`The sound could not be decoded: ${(err as Error).message}`);
      send({ type: "error", text: String(err) });
    }
  } else if (m.type === "audioError") {
    note(`The sound could not be loaded: ${m.text}`);
  }
});

function note(text: string | null) {
  $("note").textContent = text ?? "";
  $("note").hidden = !text;
}

async function loadAudio(data: Uint8Array | Record<string, number>, codec: string | undefined, name: string) {
  ctx ??= new AudioContext();
  const copy = (data instanceof Uint8Array ? data.slice() : Uint8Array.from(Object.values(data))).buffer;
  const buf = await ctx.decodeAudioData(copy);
  source = { sampleRate: buf.sampleRate, channels: Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c).slice()) };
  sourceInfo = `${name} · ${codec ?? ""} ${buf.numberOfChannels === 1 ? "mono" : buf.numberOfChannels === 2 ? "stereo" : `${buf.numberOfChannels} ch`} ${buf.sampleRate} Hz`;
  note(null);
  recompute();
  fit();
  refreshPanels();
}

// ---- the edit chain ---------------------------------------------------------------------------------

function recompute() {
  if (!source || !doc) return;
  stop();
  const before = edited ? frames(edited) : -1;
  edited = applyEdits(source, doc.edits);
  peaks = makePeaks(edited);
  if (frames(edited) !== before) clipboard = null;
  const len = duration(edited);
  cursor = Math.min(cursor, len);
  if (selection) selection = { start: Math.min(selection.start, len), end: Math.min(selection.end, len) };
  if (selection && selection.end - selection.start <= 0) selection = null;
}

/** Sends a new document with this change; shows it at once. */
function change(f: (d: SoundDoc) => SoundDoc) {
  if (!doc) return;
  const next = f(structuredClone(doc));
  const editsChanged = JSON.stringify(next.edits) !== JSON.stringify(doc.edits);
  doc = next;
  if (editsChanged) recompute();
  refreshPanels();
  draw();
  send({ type: "edit", doc });
}

const addEdit = (edit: Edit) => change((d) => ({ ...d, edits: [...d.edits, edit] }));
const round = (t: number) => Math.round(t * 1e6) / 1e6;
const len = () => (edited ? duration(edited) : 0);

// ---- peaks for the waveform: min and max per block, so long sounds draw fast ------------------------

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

/** Min and max of a channel between two frames, from the blocks when the span is long. */
function span(c: number, from: number, to: number): [number, number] {
  if (!edited || !peaks) return [0, 0];
  let lo = 0;
  let hi = 0;
  if (to - from >= Block * 2) {
    const b = peaks.blocks[c];
    for (let i = Math.floor(from / Block); i < Math.ceil(to / Block) && i * 2 < b.length; i++) {
      lo = Math.min(lo, b[i * 2]);
      hi = Math.max(hi, b[i * 2 + 1]);
    }
  } else {
    const s = edited.channels[c];
    for (let i = Math.max(0, from); i < Math.min(s.length, Math.max(to, from + 1)); i++) {
      lo = Math.min(lo, s[i]);
      hi = Math.max(hi, s[i]);
    }
  }
  return [lo, hi];
}

// ---- drawing ------------------------------------------------------------------------------------------

const canvas = $<HTMLCanvasElement>("canvas");
const Ruler = 18;

function css(name: string, fallback: string) {
  return getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
}

function width() {
  return canvas.clientWidth || 600;
}

function draw() {
  const dpr = window.devicePixelRatio || 1;
  const w = width();
  const h = canvas.clientHeight || 200;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext("2d")!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  // REDcode's player colours: a cyan waveform, yellow for what has played, the cursor and the selection.
  const wave = css("--cyan", "#19f3ff");
  const accent = css("--accent", "#fcee0a");
  const dim = css("--dim", "#8a93a8");
  const line = css("--line", "#262c3d");
  const x = (t: number) => (t - viewStart) / secPerPx;

  // ruler
  g.fillStyle = dim;
  g.strokeStyle = line;
  g.font = `10px ${css("--vscode-editor-font-family", "monospace")}`;
  const step = niceStep(secPerPx * 90);
  for (let t = Math.ceil(viewStart / step) * step; x(t) < w; t += step) {
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
  if (!edited) return;

  const end = len();
  // past the end
  if (x(end) < w) {
    g.fillStyle = css("--vscode-editorWidget-background", "rgba(128,128,128,.08)");
    g.fillRect(Math.max(0, x(end)), Ruler + 1, w, h);
  }
  // loop points
  if (doc?.loop) {
    g.globalAlpha = 0.1;
    g.fillStyle = wave;
    g.fillRect(x(doc.loop.start), Ruler + 1, x(doc.loop.end) - x(doc.loop.start), h);
    g.globalAlpha = 1;
    g.fillRect(x(doc.loop.start), Ruler + 1, 1, h);
    g.fillRect(x(doc.loop.end) - 1, Ruler + 1, 1, h);
  }
  // selection
  if (selection) {
    g.globalAlpha = 0.16;
    g.fillStyle = accent;
    g.fillRect(x(selection.start), Ruler + 1, Math.max(1, x(selection.end) - x(selection.start)), h);
    g.globalAlpha = 1;
  }
  // waveform, one lane per channel
  const ch = edited.channels.length;
  const lane = (h - Ruler - 1) / ch;
  const rate = edited.sampleRate;
  const played = playPosition();
  for (let c = 0; c < ch; c++) {
    const mid = Ruler + 1 + lane * c + lane / 2;
    const amp = lane / 2 - 2;
    for (let px = 0; px < Math.min(w, x(end)); px++) {
      const t0 = viewStart + px * secPerPx;
      const [lo, hi] = span(c, Math.floor(t0 * rate), Math.floor((t0 + secPerPx) * rate));
      const top = mid - hi * amp;
      g.fillStyle = played !== null && t0 < played ? accent : wave;
      g.fillRect(px, top, 1, Math.max(1, mid - lo * amp - top));
    }
    if (c > 0) {
      g.fillStyle = line;
      g.fillRect(0, Ruler + lane * c, w, 1);
    }
  }
  // cursor and playhead
  g.fillStyle = accent;
  g.fillRect(Math.round(x(cursor)), Ruler + 1, 1, h);
  if (played !== null) {
    g.fillStyle = accent;
    g.fillRect(Math.round(x(played)), 0, 2, h);
  }
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

// ---- view ---------------------------------------------------------------------------------------------

function clampView() {
  const total = len();
  secPerPx = Math.min(Math.max(secPerPx, 1 / 48000 / 4), Math.max(total, 0.01) / width() * 1.5);
  viewStart = Math.max(0, Math.min(viewStart, Math.max(0, total - width() * secPerPx * 0.5)));
}

function fit() {
  secPerPx = Math.max(len(), 0.01) / width();
  viewStart = 0;
  clampView();
  draw();
}

function zoom(factor: number, around = viewStart + (width() * secPerPx) / 2) {
  const px = (around - viewStart) / secPerPx;
  secPerPx *= factor;
  clampView();
  viewStart = around - px * secPerPx;
  clampView();
  draw();
}

// ---- mouse ----------------------------------------------------------------------------------------------

let drag: { anchor: number; moved: boolean } | null = null;
const timeAt = (ev: MouseEvent) => {
  const r = canvas.getBoundingClientRect();
  return Math.max(0, Math.min(len(), viewStart + (ev.clientX - r.left) * secPerPx));
};

canvas.addEventListener("pointerdown", (ev) => {
  if (!edited) return;
  try {
    canvas.setPointerCapture(ev.pointerId);
  } catch {
    // Not a live pointer (a synthetic event): the drag still works inside the canvas.
  }
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
    if (player) play(cursor);
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
    if (ev.ctrlKey || ev.metaKey || Math.abs(ev.deltaY) > Math.abs(ev.deltaX) && !ev.shiftKey) {
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
  draw();
}).observe(canvas);

// ---- playback -------------------------------------------------------------------------------------------

function playPosition(): number | null {
  if (!player || !ctx) return null;
  const elapsed = ctx.currentTime - player.startedAt;
  if (player.loop) {
    const first = player.loop.end - player.offset;
    if (elapsed < first) return player.offset + elapsed;
    const l = player.loop.end - player.loop.start;
    return player.loop.start + ((elapsed - first) % l);
  }
  return Math.min(player.end, player.offset + elapsed);
}

function stop() {
  if (player) {
    player.node.onended = null;
    try {
      player.node.stop();
    } catch {
      // already stopped
    }
    player = null;
  }
  $("play").textContent = "Play";
  draw();
}

/** Plays from a time: within the selection when there is one, looping the selection, the loop points or the whole sound when Loop is on. */
function play(from = cursor) {
  if (!edited) return;
  stop();
  ctx ??= new AudioContext();
  void ctx.resume();
  const buf = ctx.createBuffer(edited.channels.length, Math.max(1, frames(edited)), edited.sampleRate);
  edited.channels.forEach((c, i) => buf.copyToChannel(c, i));
  const node = ctx.createBufferSource();
  node.buffer = buf;
  node.connect(ctx.destination);
  let loop: { start: number; end: number } | null = null;
  let end = len();
  if (selection) {
    end = selection.end;
    if (from < selection.start || from >= selection.end) from = selection.start;
  }
  if (looping) {
    loop = selection ?? doc?.loop ?? { start: 0, end: len() };
    if (from < loop.start || from >= loop.end) from = loop.start;
    node.loop = true;
    node.loopStart = loop.start;
    node.loopEnd = loop.end;
    node.start(0, from);
  } else {
    node.start(0, from, Math.max(0, end - from));
  }
  node.onended = () => {
    if (player?.node === node) stop();
  };
  player = { node, startedAt: ctx.currentTime, offset: from, loop, end };
  $("play").textContent = "Stop";
  const tick = () => {
    if (!player || player.node !== node) return;
    refreshTime();
    draw();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ---- the buttons -------------------------------------------------------------------------------------------

/** The selection, or a range the button names when there is none. */
const selOr = (fallback: () => { start: number; end: number } | null) => selection ?? fallback();

function on(id: string, f: () => void) {
  $(id).addEventListener("click", () => {
    if (!doc) return;
    f();
  });
}

on("play", () => (player ? stop() : play()));
on("loopPlay", () => {
  looping = !looping;
  $("loopPlay").classList.toggle("on", looping);
  if (player) play(playPosition() ?? cursor);
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
  if (!selection) return;
  const s = selection;
  selection = null;
  cursor = s.start;
  addEdit({ op: "cut", start: round(s.start), end: round(s.end) });
};
on("cut", cut);
const copy = () => {
  if (selection) clipboard = { ...selection };
  refreshPanels();
};
on("copy", copy);
const paste = () => {
  if (!clipboard) return;
  const from = clipboard;
  const at = cursor;
  addEdit({ op: "paste", at: round(at), from: { start: round(from.start), end: round(from.end) } });
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
  if (!edited) return;
  addEdit({ op: "channels", to: edited.channels.length === 1 ? 2 : 1 });
});
on("setLoop", () => {
  if (!selection) return;
  const s = selection;
  change((d) => ({ ...d, loop: { start: round(s.start), end: round(s.end) } }));
});
on("clearLoop", () => change((d) => ({ ...d, loop: null })));

$<HTMLInputElement>("voice").addEventListener("change", (e) => {
  const v = (e.target as HTMLInputElement).checked;
  change((d) => ({ ...d, voice: v || undefined }));
});
on("translate", () => send({ type: "stub", tool: "translate" }));
on("revoice", () => send({ type: "stub", tool: "revoice" }));

$<HTMLSelectElement>("rate").addEventListener("change", (e) => {
  const v = (e.target as HTMLSelectElement).value;
  change((d) => ({ ...d, render: { ...d.render, sampleRate: v ? Number(v) : undefined } }));
});

on("render", async () => {
  if (!edited || !doc) return;
  const btn = $<HTMLButtonElement>("render");
  btn.disabled = true;
  try {
    const out = await resample(edited, doc.render.sampleRate ?? edited.sampleRate);
    send({ type: "render", wav: encodeWav(out) });
  } catch (err) {
    send({ type: "error", text: `Render failed: ${(err as Error).message}` });
  } finally {
    btn.disabled = false;
  }
});

/** The sound at another rate, through the browser's own resampler. */
async function resample(a: Audio, rate: number): Promise<Audio> {
  if (rate === a.sampleRate) return a;
  const n = Math.max(1, Math.round((frames(a) * rate) / a.sampleRate));
  const off = new OfflineAudioContext(a.channels.length, n, rate);
  const buf = off.createBuffer(a.channels.length, Math.max(1, frames(a)), a.sampleRate);
  a.channels.forEach((c, i) => buf.copyToChannel(c, i));
  const node = off.createBufferSource();
  node.buffer = buf;
  node.connect(off.destination);
  node.start();
  const r = await off.startRendering();
  return { sampleRate: rate, channels: Array.from({ length: r.numberOfChannels }, (_, c) => r.getChannelData(c).slice()) };
}

document.addEventListener("keydown", (ev) => {
  const target = ev.target as HTMLElement;
  if (target.tagName === "INPUT" || target.tagName === "SELECT") return;
  const mod = ev.ctrlKey || ev.metaKey;
  if (ev.key === " ") {
    ev.preventDefault();
    if (player) stop();
    else play();
  } else if ((ev.key === "Delete" || ev.key === "Backspace") && selection) {
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
  const r = (s?: number, t?: number) => (s === undefined ? "whole sound" : `${fmt(s)} to ${fmt(t ?? 0)}`);
  switch (e.op) {
    case "trim":
      return `Trim to ${r(e.start, e.end)}`;
    case "cut":
      return `Cut ${r(e.start, e.end)}`;
    case "paste":
      return `Paste ${r(e.from.start, e.from.end)} at ${fmt(e.at)}`;
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

function refreshPanels() {
  if (!doc) return;
  $("meta").textContent = sourceInfo;
  const voice = !!doc.voice;
  $<HTMLInputElement>("voice").checked = voice;
  $("translate").hidden = !voice;
  $("revoice").hidden = !voice;
  $("channels").textContent = edited && edited.channels.length === 1 ? "Stereo" : "Mono";
  $<HTMLButtonElement>("paste").disabled = !clipboard;
  const list = $("edits");
  list.replaceChildren(
    ...doc.edits.map((e, i) => {
      const li = document.createElement("li");
      const text = document.createElement("span");
      text.textContent = describe(e);
      const x = document.createElement("button");
      x.className = "x";
      x.textContent = "×";
      x.title = "Remove this edit. Later edits keep their times, so they may land elsewhere.";
      x.addEventListener("click", () => change((d) => ({ ...d, edits: d.edits.filter((_, j) => j !== i) })));
      li.append(text, x);
      return li;
    }),
  );
  $("noEdits").hidden = doc.edits.length > 0;
  $("renderFile").textContent = doc.render.file;
  $<HTMLSelectElement>("rate").value = doc.render.sampleRate ? String(doc.render.sampleRate) : "";
  if (edited) {
    const rate = doc.render.sampleRate ?? edited.sampleRate;
    $("renderInfo").textContent = `${fmt(len())} · ${edited.channels.length === 1 ? "mono" : `${edited.channels.length} ch`} · ${rate} Hz · 16-bit`;
  }
  refreshTime();
}

function refreshTime() {
  const p = playPosition();
  const parts = [`${fmt(p ?? cursor)} / ${fmt(len())}`];
  if (selection) parts.push(`selection ${fmt(selection.start)} to ${fmt(selection.end)} (${(selection.end - selection.start).toFixed(3)} s)`);
  if (doc?.loop) parts.push(`loop ${fmt(doc.loop.start)} to ${fmt(doc.loop.end)}`);
  $("time").textContent = parts.join(" · ");
}

send({ type: "ready" });
