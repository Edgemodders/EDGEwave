// The Voice Lines page (src/voiceLines.ts is its host): the speakers' voices, the lines by scene with their
// takes, and buttons that ask the host to generate, redo, swap in a recording, go back or open the studio.
// A recording is decoded here and sent as a 48 kHz mono WAV, as ElevenLabs' takes are.

import { encodeWav } from "../src/audio/wav";

declare function acquireVsCodeApi(): { postMessage(m: unknown): void };
const vscode = acquireVsCodeApi();
const send = (m: unknown) => vscode.postMessage(m);

type Gender = "female" | "male";
interface Line {
  id: string;
  scene: string;
  speaker: string;
  text: string;
  say?: string;
  direction?: string;
  genders: Gender[];
  status: "none" | "made" | "stale";
  takes: Partial<Record<Gender, string>>;
  madeFrom?: { text: string; say?: string; direction?: string; model?: string };
  previous: boolean;
}
interface State {
  quest: string;
  model: string;
  focus: string[];
  busy?: { done: number; total: number };
  names: Record<string, string>;
  voices: Record<string, string | Partial<Record<Gender, string>>>;
  speakers: { speaker: string; both: boolean; isV: boolean }[];
  lines: Line[];
}
interface Voice {
  id: string;
  name: string;
  labels: Record<string, string>;
  previewUrl?: string;
}

const $ = (id: string) => document.getElementById(id)!;
// Props are the element's own properties (textContent, title, disabled, value, onclick...).
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = Object.assign(document.createElement(tag), props) as HTMLElementTagNameMap[K];
  e.append(...kids);
  return e;
};

let state: State | undefined;
let voiceList: Voice[] | undefined;
let models: { id: string; name: string }[] | undefined;
let focused = false;
const player = new Audio();

function play(src: string) {
  player.pause();
  player.src = src;
  void player.play().catch(() => {});
}

window.addEventListener("message", (e) => {
  const m = e.data as { type: string } & Record<string, unknown>;
  if (m.type === "state") {
    state = m as unknown as State;
    render();
  } else if (m.type === "voiceList") {
    voiceList = m.voices as Voice[];
    renderVoices();
  } else if (m.type === "models") {
    models = m.models as { id: string; name: string }[];
    renderModel();
  } else if (m.type === "preview") {
    play(URL.createObjectURL(new Blob([m.data as Uint8Array<ArrayBuffer>], { type: String(m.mime) })));
  } else if (m.type === "error") {
    const box = $("error");
    box.textContent = String(m.message);
    box.hidden = false;
  }
});

$("generate").onclick = () => {
  $("error").hidden = true;
  send({ type: "generate" });
};
$("cancel").onclick = () => send({ type: "cancel" });
($("model") as HTMLSelectElement).onchange = (e) => send({ type: "model", id: (e.target as HTMLSelectElement).value });

function render() {
  if (!state) return;
  const s = state;
  $("title").textContent = `Voice Lines: ${s.quest}`;
  const made = s.lines.filter((l) => l.status === "made").length;
  $("meta").textContent = `${s.lines.length} line${s.lines.length === 1 ? "" : "s"} · ${made} voiced · ${s.lines.length - made} to voice${s.busy ? ` · voicing ${s.busy.done + 1} of ${s.busy.total}…` : ""}`;
  ($("generate") as HTMLButtonElement).disabled = !!s.busy || made === s.lines.length;
  $("cancel").hidden = !s.busy;
  renderModel();
  renderVoices();
  renderLines();
}

function renderModel() {
  if (!state) return;
  const sel = $("model") as HTMLSelectElement;
  const list = models ?? [{ id: state.model, name: state.model }];
  if (!list.some((m) => m.id === state!.model)) list.unshift({ id: state.model, name: state.model });
  sel.replaceChildren(...list.map((m) => el("option", { value: m.id, textContent: m.id === m.name ? m.id : `${m.name} (${m.id})`, selected: m.id === state!.model })));
  sel.onfocus = () => {
    if (!models) send({ type: "models" });
  };
}

function voiceOf(speaker: string, gender?: Gender): string | undefined {
  const v = state?.voices[speaker];
  return typeof v === "string" ? v : gender ? v?.[gender] : undefined;
}

function voicePicker(speaker: string, gender?: Gender): HTMLElement {
  const current = voiceOf(speaker, gender);
  const sel = el("select", { title: "An ElevenLabs voice from your account" });
  const options = voiceList ?? [];
  sel.append(el("option", { value: "", textContent: current ? state!.names[current] ?? current : voiceList ? "Pick a voice…" : "Pick a voice… (click to load)" }));
  for (const v of options) {
    const tags = [v.labels.gender, v.labels.age, v.labels.accent].filter(Boolean).join(", ");
    sel.append(el("option", { value: v.id, textContent: tags ? `${v.name} · ${tags}` : v.name, selected: v.id === current }));
  }
  if (current && options.some((v) => v.id === current)) sel.firstElementChild!.textContent = "Pick a voice…";
  sel.onfocus = () => {
    if (!voiceList) send({ type: "voices" });
  };
  sel.onchange = () => {
    if (!sel.value) return;
    send({ type: "setVoice", speaker, gender, id: sel.value, name: options.find((v) => v.id === sel.value)?.name });
  };
  const hear = el("button", { className: "icon", title: "Hear this voice's sample", textContent: "▶", disabled: !current });
  hear.onclick = () => {
    const url = voiceList?.find((v) => v.id === voiceOf(speaker, gender))?.previewUrl;
    if (url) send({ type: "preview", url });
    else if (!voiceList) send({ type: "voices" });
  };
  return el("span", { className: "picker" }, gender ? el("span", { className: "dim", textContent: gender === "female" ? "female V" : "male V" }) : "", sel, hear);
}

function renderVoices() {
  if (!state) return;
  const rows = state.speakers.map((s) =>
    el("div", { className: "speaker" }, el("span", { className: "who", textContent: s.speaker }), ...(s.both ? [voicePicker(s.speaker, "female"), voicePicker(s.speaker, "male")] : [voicePicker(s.speaker)])),
  );
  $("voices").replaceChildren(el("div", { className: "label", textContent: "Voices" }), ...rows);
}

const StatusText = { none: "no take", made: "voiced", stale: "changed since" } as const;

function renderLines() {
  if (!state) return;
  const s = state;
  const byScene = new Map<string, Line[]>();
  for (const l of s.lines) byScene.set(l.scene, [...(byScene.get(l.scene) ?? []), l]);
  const out: HTMLElement[] = [];
  for (const [scene, lines] of byScene) {
    out.push(el("h3", { textContent: scene }));
    for (const l of lines) out.push(lineRow(l, s));
  }
  $("lines").replaceChildren(...out);
  if (!focused && s.focus.length) {
    focused = true;
    document.querySelector(`[data-id="${s.focus[0]}"]`)?.scrollIntoView({ block: "center" });
  }
}

function lineRow(l: Line, s: State): HTMLElement {
  const busy = !!s.busy;
  const row = el("div", { className: `line ${l.status}${s.focus.includes(l.id) ? " focus" : ""}` });
  row.dataset.id = l.id;
  const words = el("div", { className: "words" }, el("span", { className: "who", textContent: l.speaker }), el("span", { className: "text", textContent: l.text }));
  if (l.say && l.say !== l.text) words.append(el("div", { className: "say mono", textContent: `say: ${l.say}`, title: "As spoken: eleven_v3 reads the [tags]; other models get them removed" }));
  if (l.direction) words.append(el("div", { className: "direction", textContent: l.direction }));
  if (l.status === "stale" && l.madeFrom) words.append(el("div", { className: "dim", textContent: `The take says: ${l.madeFrom.say ?? l.madeFrom.text}` }));
  const takes = el("div", { className: "takes" });
  for (const g of l.genders) {
    const src = l.takes[g];
    const label = l.genders.length > 1 ? (g === "female" ? "F" : "M") : "";
    const playB = el("button", { className: "icon", textContent: "▶", title: `Play the ${l.genders.length > 1 ? `${g} ` : ""}take`, disabled: !src });
    if (src) playB.onclick = () => play(src);
    const rec = el("button", { textContent: "Use a file…", title: "Use a recording (WAV, MP3, OGG or FLAC) as this take: it becomes a 48 kHz mono WAV", disabled: busy });
    rec.onclick = () => pickRecording(l.id, g);
    const studio = el("button", { textContent: "Studio", title: "Edit this take in EDGEwave's studio; its Render writes the take", disabled: !src || busy });
    studio.onclick = () => send({ type: "studio", id: l.id, gender: g });
    takes.append(el("span", { className: "take" }, label ? el("span", { className: "dim", textContent: label }) : "", playB, rec, studio));
  }
  const gen = el("button", { className: l.status === "made" ? "" : "primary", textContent: l.status === "none" ? "Generate" : "Regenerate", disabled: busy });
  gen.onclick = () => {
    $("error").hidden = true;
    send({ type: "generate", ids: [l.id], redo: true });
  };
  const actions = el("div", { className: "actions" }, el("span", { className: `chip ${l.status}`, textContent: StatusText[l.status] }), gen);
  if (l.previous) {
    const back = el("button", { textContent: "Previous", title: "Swap back to the take before this one (and back again)", disabled: busy });
    back.onclick = () => send({ type: "previous", id: l.id });
    actions.append(back);
  }
  row.append(words, takes, actions);
  return row;
}

function pickRecording(id: string, gender: Gender) {
  const input = el("input", { type: "file", accept: "audio/*,.wav,.mp3,.ogg,.flac" });
  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      const ctx = new AudioContext();
      const decoded = await ctx.decodeAudioData(await f.arrayBuffer());
      void ctx.close();
      const rate = 48000;
      const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate);
      const src = off.createBufferSource();
      src.buffer = decoded;
      src.connect(off.destination);
      src.start();
      const out = await off.startRendering();
      send({ type: "record", id, gender, wav: encodeWav({ sampleRate: rate, channels: [out.getChannelData(0)] }) });
    } catch (e) {
      const box = $("error");
      box.textContent = `That file could not be read as audio: ${(e as Error).message}`;
      box.hidden = false;
    }
  };
  input.click();
}

send({ type: "ready" });
