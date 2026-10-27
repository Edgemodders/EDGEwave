// The voice tools' forms on the page: Generate Sound, Speak Line and Re-Voice. Each sends a request
// to the host (src/voiceTools.ts), which calls ElevenLabs with the modder's key and adds the result as
// a new track; the page then sees the new document and selects that track. Generate Sound's results are
// takes, played here, and only the one the modder adds becomes a track. Previews (an ElevenLabs voice's
// sample, a remix's) play here too.

import type { Audio } from "../src/audio/edits";
import { encodeWav } from "../src/audio/wav";
import { sourceKey, sourceLabel, type Track } from "../src/doc";
import { isKeyError, keyError, keyFix } from "./keyFix";

export interface VoiceHost {
  send(m: unknown): void;
  /** The selected track and its clip after its edits. */
  track(): Track | undefined;
  clip(): Audio | undefined;
  mixCursor(): number;
  audio(): AudioContext;
  /** Stops the editor's own playback. */
  stop(): void;
}

interface Voice {
  id: string;
  name: string;
  labels: Record<string, string>;
  category?: string;
  previewUrl?: string;
}
interface Model {
  id: string;
  name: string;
  speech: boolean;
  voiceChange: boolean;
  maxText?: number;
}

let host: VoiceHost;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let voices: Promise<Voice[]> | null = null;
let models: Promise<{ models: Model[]; speechModel: string; voiceChangerModel: string }> | null = null;
/** The open dialog's status line, and what to load again once a new API key is set. */
let dialogStatus: Status | null = null;
let afterKey: (() => void)[] = [];

/** A form's status line: a message, an error, or an error a new API key may fix (with its buttons). */
type Status = (t: string, error?: boolean, key?: boolean) => void;
/** An error's arguments for a status line. */
const failure = (e: unknown): [string, boolean, boolean] => [(e as Error).message, true, isKeyError(e)];

/** One request to the host; resolves with its answer. */
function ask<T>(req: Record<string, unknown>): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    host.send({ type: "voiceTool", id, req });
  });
}

/** The host's answer to a request. */
export function voiceToolResult(m: { id: number; ok: boolean; result?: unknown; error?: string; key?: boolean }) {
  const p = pending.get(m.id);
  pending.delete(m.id);
  if (!p) return;
  if (m.ok) p.resolve(m.result);
  else p.reject(m.key ? keyError(m.error ?? "No ElevenLabs API key") : new Error(m.error ?? "The request failed"));
}

/** The host's answer to Set ElevenLabs API Key: with a key, the voices and models load again. */
export function keySet(ok: boolean) {
  if (!ok) return;
  voices = null;
  models = null;
  const again = afterKey;
  afterKey = [];
  for (const f of again) f();
  dialogStatus?.("The key is set. Try again.");
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...kids: (Node | string)[]) {
  const e = document.createElement(tag);
  const { class: cls, ...rest } = props;
  Object.assign(e, rest);
  if (cls) e.className = cls;
  e.append(...kids);
  return e;
}

// ---- previews -------------------------------------------------------------------------------------------

let playing: { stop: () => void; button: HTMLButtonElement } | null = null;

function stopPreview() {
  playing?.stop();
  if (playing) playing.button.classList.remove("on");
  playing = null;
}

/** Plays bytes (a WAV, or the MP3 of a voice's preview); the button shows it is playing. */
async function playBytes(data: Uint8Array | Record<string, number>, button: HTMLButtonElement) {
  const again = playing?.button === button;
  stopPreview();
  if (again) return;
  host.stop();
  const ctx = host.audio();
  const copy = (data instanceof Uint8Array ? data.slice() : Uint8Array.from(Object.values(data))).buffer;
  const buf = await ctx.decodeAudioData(copy);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.onended = () => {
    if (playing?.button === button) stopPreview();
  };
  src.start();
  button.classList.add("on");
  playing = { stop: () => src.stop(), button };
}

function playButton(get: () => Promise<Uint8Array>, status: Status): HTMLButtonElement {
  const b = el("button", { type: "button", className: "icon", title: "Play the preview", ariaLabel: "Play the preview" });
  b.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5 13.5 8 4 13.5z" fill="currentColor"/></svg>';
  b.addEventListener("click", async () => {
    try {
      await playBytes(await get(), b);
    } catch (e) {
      status(`The preview cannot play: ${(e as Error).message}`, true);
    }
  });
  return b;
}

// ---- the dialog ------------------------------------------------------------------------------------------

function close() {
  stopPreview();
  dialogStatus = null;
  afterKey = [];
  $("dialog").hidden = true;
  $("dialogBox").replaceChildren();
}

/** Opens the dialog with a title, a body, and a status line the form writes to. */
function open(title: string, intro: string, body: (status: Status, busy: (b: boolean) => void) => HTMLElement[]) {
  const box = $("dialogBox");
  const status = el("p", { class: "status" });
  const setStatus: Status = (t, error = false, key = false) => {
    status.replaceChildren(t, ...(key ? [keyFix((m) => host.send(m))] : []));
    status.classList.toggle("error", error);
  };
  dialogStatus = setStatus;
  const x = el("button", { type: "button", class: "x", title: "Close (Escape)", textContent: "×" });
  x.addEventListener("click", close);
  const parts = body(setStatus, (b) => box.classList.toggle("busy", b));
  box.replaceChildren(el("div", { class: "head" }, el("h2", { textContent: title }), x), el("p", { class: "dim", textContent: intro }), ...parts, status);
  $("dialog").hidden = false;
  (box.querySelector("textarea, input") as HTMLElement | null)?.focus();
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("dialog").hidden) {
    e.stopPropagation();
    close();
  }
});

/** A labelled field row. */
const field = (label: string, input: HTMLElement, hint?: string) => el("label", { class: "field" }, el("span", { textContent: label }), input, ...(hint ? [el("span", { class: "dim", textContent: hint })] : []));

/** The selected track's line: its clip after its edits as a WAV, and what identifies it. */
function line() {
  const t = host.track();
  const c = host.clip();
  if (!t || !c) return undefined;
  return { track: t.id, key: sourceKey(t.source) + JSON.stringify(t.edits), name: sourceLabel(t.source).replace(/\.[a-z0-9]+$/i, ""), wav: encodeWav(c), offset: t.offset };
}

/** Runs a request with the form busy; closes the dialog when it worked, unless `stay`. */
async function run(button: HTMLButtonElement, status: Status, busy: (b: boolean) => void, working: string, f: () => Promise<unknown>, stay = false) {
  button.disabled = true;
  busy(true);
  status(working);
  try {
    await f();
    if (!stay) close();
  } catch (e) {
    status(...failure(e));
  } finally {
    button.disabled = false;
    busy(false);
  }
}

// ---- the voice list, shared by Speak Line and Re-Voice ---------------------------------------------------

function voiceList(status: Status) {
  let chosen: Voice | undefined;
  const search = el("input", { type: "search", placeholder: "Search by name, gender, accent…" });
  const list = el("div", { class: "voices" }, el("p", { class: "dim", textContent: "Loading your ElevenLabs voices…" }));
  const name = `voice${nextId++}`;
  let all: Voice[] = [];
  const show = () => {
    const q = search.value.trim().toLowerCase();
    const hits = all.filter((v) => !q || `${v.name} ${Object.values(v.labels).join(" ")} ${v.category ?? ""}`.toLowerCase().includes(q));
    if (!hits.length) {
      list.replaceChildren(el("p", { class: "dim", textContent: all.length ? "No voice matches." : "No voices in this account." }));
      return;
    }
    list.replaceChildren(
      ...hits.slice(0, 200).map((v) => {
        const radio = el("input", { type: "radio", name, checked: chosen?.id === v.id });
        radio.addEventListener("change", () => (chosen = v));
        const labels = Object.entries(v.labels)
          .filter(([k]) => ["gender", "age", "accent", "descriptive", "description", "use_case", "use case"].includes(k))
          .map(([, x]) => x)
          .join(", ");
        const row = el("label", { class: "voice" }, radio, el("span", { class: "vname", textContent: v.name }), el("span", { class: "dim", textContent: [labels, v.category].filter(Boolean).join(" · ") }));
        if (v.previewUrl) {
          let bytes: Promise<Uint8Array> | null = null;
          row.append(playButton(() => (bytes ??= ask<{ data: Uint8Array }>({ op: "preview", url: v.previewUrl }).then((p) => p.data)), status));
        }
        return row;
      }),
    );
  };
  search.addEventListener("input", show);
  const load = () => {
    voices ??= ask<Voice[]>({ op: "voices" });
    voices.then(
      (v) => {
        all = v;
        show();
      },
      (e) => {
        voices = null;
        const p = el("p", { class: "status error", textContent: (e as Error).message });
        if (isKeyError(e)) {
          p.append(keyFix((m) => host.send(m)));
          // The list may be dimmed (Speak Line in the line's own voice): the status line is never.
          status(...failure(e));
          afterKey.push(() => {
            list.replaceChildren(el("p", { class: "dim", textContent: "Loading your ElevenLabs voices…" }));
            load();
          });
        }
        list.replaceChildren(p);
      },
    );
  };
  load();
  return { element: el("div", { class: "voicepick" }, search, list), chosen: () => chosen };
}

/** A model menu: the account's models that can do speech or voice changing, starting at the default. */
function modelMenu(kind: "speech" | "voiceChange") {
  const s = el("select");
  s.append(new Option("ElevenLabs' default", ""));
  const load = () => {
    models ??= ask({ op: "models" });
    models.then(
      (m) => {
        const start = kind === "speech" ? m.speechModel : m.voiceChangerModel;
        for (const x of m.models.filter((x) => x[kind])) s.append(new Option(x.name === x.id ? x.id : `${x.name} (${x.id})`, x.id));
        if ([...s.options].some((o) => o.value === start)) s.value = start;
      },
      (e) => {
        models = null;
        if (isKeyError(e)) afterKey.push(load);
      },
    );
  };
  load();
  return s;
}

// ---- the tools -------------------------------------------------------------------------------------------

function generateSound() {
  open("Generate Sound", "A sound effect from a description, through ElevenLabs. Each try is a take: play it, change the description and generate again, then Add the one you want as a new track at the mix cursor. Each take spends ElevenLabs credits.", (status, busy) => {
    const prompt = el("textarea", { rows: 3, placeholder: "Such as: a heavy metal door slams in a concrete corridor, short echo" });
    const seconds = el("input", { type: "number", min: "0.5", max: "30", step: "0.5", placeholder: "auto" });
    const loop = el("input", { type: "checkbox" });
    const influence = el("input", { type: "number", min: "0", max: "1", step: "0.1", value: "0.3" });
    const go = el("button", { type: "button", class: "primary", textContent: "Generate" });
    const takes = el("div", { class: "voices takes", hidden: true });
    let n = 0;
    go.addEventListener("click", () => {
      const text = prompt.value.trim();
      if (!text) return status("Describe the sound first.", true);
      const req: Record<string, unknown> = { op: "sound", prompt: text };
      if (seconds.value) req.seconds = Number(seconds.value);
      if (loop.checked) req.loop = true;
      if (influence.value && Number(influence.value) !== 0.3) req.influence = Number(influence.value);
      void run(
        go,
        status,
        busy,
        "Generating…",
        async () => {
          const t = await ask<{ take: string; wav: Uint8Array; seconds: number }>(req);
          const name = `Take ${++n}`;
          const add = el("button", { type: "button", class: "primary add", textContent: "Add" });
          add.addEventListener("click", () => {
            for (const b of takes.querySelectorAll<HTMLButtonElement>("button.add")) b.disabled = true;
            void run(add, status, busy, `Adding ${name}…`, () => ask({ op: "addSound", take: t.take, at: host.mixCursor() })).finally(() => {
              for (const b of takes.querySelectorAll<HTMLButtonElement>("button.add")) b.disabled = false;
            });
          });
          const about = [`${t.seconds.toFixed(1)} s`, text, req.loop ? "loop" : ""].filter(Boolean).join(" · ");
          takes.prepend(el("div", { class: "voice" }, playButton(async () => t.wav, status), el("span", { class: "vname", textContent: name }), el("span", { class: "dim", textContent: about, title: text }), add));
          takes.hidden = false;
          go.textContent = "Generate again";
          status(`${name} is ready: play it, then Add it, or change the description and generate again.`);
        },
        true,
      );
    });
    return [
      field("Description", prompt),
      el("div", { class: "fields" }, field("Length", seconds, "s, 0.5 to 30"), field("Loop", loop, "seamless"), field("Follow the prompt", influence, "0 to 1")),
      el("div", { class: "actions" }, go),
      takes,
    ];
  });
}

function speakLine() {
  const t = host.track();
  const fromLine = !!t?.voice && !!host.clip();
  open("Speak Line", "Text spoken in a voice, through ElevenLabs, added as a new voice-line track at the mix cursor. Spends ElevenLabs credits.", (status, busy) => {
    const text = el("textarea", { rows: 3, placeholder: "What the line says" });
    const own = el("input", { type: "radio", name: "speakVoice", checked: fromLine, disabled: !fromLine });
    const pick = el("input", { type: "radio", name: "speakVoice", checked: !fromLine });
    const picker = voiceList(status);
    const model = modelMenu("speech");
    const go = el("button", { type: "button", class: "primary", textContent: "Speak" });
    const sync = () => picker.element.classList.toggle("off", own.checked);
    own.addEventListener("change", sync);
    pick.addEventListener("change", sync);
    sync();
    go.addEventListener("click", () => {
      const words = text.value.trim();
      if (!words) return status("Write the line first.", true);
      const req: Record<string, unknown> = { op: "speak", text: words, at: host.mixCursor() };
      if (model.value) req.model = model.value;
      if (own.checked) {
        const l = line();
        if (!l) return status("The selected line has not loaded yet.", true);
        req.line = l;
      } else {
        const v = picker.chosen();
        if (!v) return status("Pick a voice.", true);
        req.voice = { id: v.id, name: v.name };
      }
      void run(go, status, busy, own.checked ? "Cloning the line's voice (first time only), then speaking…" : "Speaking…", () => ask(req));
    });
    return [
      field("Text", text),
      el(
        "div",
        { class: "choice" },
        el("label", { class: "check" }, own, `In the selected line's voice${fromLine ? ` (${sourceLabel(t!.source)})` : ": select a voice line first"}`),
        el("label", { class: "check" }, pick, "In one of your ElevenLabs voices"),
      ),
      picker.element,
      el("div", { class: "fields" }, field("Model", model)),
      el("p", { class: "dim", textContent: "The line's voice is an instant clone, made once per line and reused. A longer line makes a better clone." }),
      el("div", { class: "actions" }, go),
    ];
  });
}

function reVoice() {
  const t = host.track();
  if (!t || !host.clip()) return;
  open(`Re-Voice · ${sourceLabel(t.source)}`, "The selected line's words, timing and delivery in another voice, through ElevenLabs, as a new track at the same place. Spends ElevenLabs credits.", (status, busy) => {
    const describe = el("input", { type: "radio", name: "revoiceHow", checked: true });
    const pick = el("input", { type: "radio", name: "revoiceHow" });
    const change = el("textarea", { rows: 2, placeholder: "Such as: female · older and raspy · calm and tired · shouting, angry" });
    const make = el("button", { type: "button", textContent: "Make previews" });
    const previews = el("div", { class: "voices" });
    let chosen: { id: string; description: string } | undefined;
    const describing = el("div", { class: "describe" }, change, el("div", { class: "actions left" }, make), previews);
    const picker = voiceList(status);
    const model = modelMenu("voiceChange");
    const mute = el("input", { type: "checkbox", checked: true });
    const go = el("button", { type: "button", class: "primary", textContent: "Re-Voice" });
    const sync = () => {
      describing.classList.toggle("off", !describe.checked);
      picker.element.classList.toggle("off", describe.checked);
    };
    describe.addEventListener("change", sync);
    pick.addEventListener("change", sync);
    sync();
    make.addEventListener("click", () => {
      const d = change.value.trim();
      if (!d) return status("Describe the change first.", true);
      const l = line();
      if (!l) return status("The line has not loaded yet.", true);
      chosen = undefined;
      make.disabled = true;
      busy(true);
      status("Cloning the line's voice (first time only), then making previews…");
      ask<{ id: string; wav: Uint8Array; seconds?: number }[]>({ op: "remix", line: l, description: d })
        .then((list) => {
          status(`${list.length} preview${list.length === 1 ? "" : "s"}: play them and pick one.`);
          previews.replaceChildren(
            ...list.map((p, i) => {
              const radio = el("input", { type: "radio", name: "remixPick", checked: i === 0 });
              if (i === 0) chosen = { id: p.id, description: d };
              radio.addEventListener("change", () => (chosen = { id: p.id, description: d }));
              return el("label", { class: "voice" }, radio, el("span", { class: "vname", textContent: `Preview ${i + 1}` }), el("span", { class: "dim", textContent: p.seconds ? `${p.seconds.toFixed(1)} s` : "" }), playButton(async () => p.wav, status));
            }),
          );
        })
        .catch((e) => status(...failure(e)))
        .finally(() => {
          make.disabled = false;
          busy(false);
        });
    });
    go.addEventListener("click", () => {
      const l = line();
      if (!l) return status("The line has not loaded yet.", true);
      const req: Record<string, unknown> = { op: "revoice", line: l, mute: mute.checked };
      if (model.value) req.model = model.value;
      if (describe.checked) {
        if (!chosen) return status("Make previews and pick one first.", true);
        req.generated = chosen;
      } else {
        const v = picker.chosen();
        if (!v) return status("Pick a voice.", true);
        req.voice = { id: v.id, name: v.name };
      }
      void run(go, status, busy, "Re-voicing…", () => ask(req));
    });
    return [
      el("div", { class: "choice" }, el("label", { class: "check" }, describe, "Describe the change (clones the line's voice, then remixes it)"), el("label", { class: "check" }, pick, "Into one of your ElevenLabs voices")),
      describing,
      picker.element,
      el("div", { class: "fields" }, field("Model", model), field("Mute the original", mute)),
      el("div", { class: "actions" }, go),
    ];
  });
}

export function setupVoiceTools(h: VoiceHost) {
  host = h;
  $("generateSound").addEventListener("click", generateSound);
  $("speakLine").addEventListener("click", speakLine);
  $("revoice").addEventListener("click", reVoice);
  $("dialog").addEventListener("pointerdown", (e) => {
    if (e.target === $("dialog")) close();
  });
}
