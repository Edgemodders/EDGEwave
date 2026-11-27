// WAV to .wem through the modder's own Wwise (V2 step 5, EDGEwave #5). Wwise is Audiokinetic's and never
// ships with EDGEwave (its license): the modder installs 2023.1.14, the version the game uses (the modding
// wiki calls it a hard requirement), from the Audiokinetic Launcher. EDGEwave runs its WwiseConsole:
//
//   1. create-new-project, once per version, in EDGEwave's folder: a blank project already has the factory
//      "Vorbis Quality High" conversion.
//   2. A .wsources list, one <Source> per WAV.
//   3. convert-external-source ... --platform Windows: the .wem files land in <output>\Windows\.
//
// Each WAV is first made mono 48 kHz 16-bit, as the game's voice lines are: Wwise keeps a source's own rate.
// The spike (docs/voice-lines.md, 2026-10-23) checked the header against a game line. No VS Code, so the
// MCP server runs it too.

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { decodeWav, encodeWav } from "./audio/wav";
import { resample, toMono } from "./audio/resample";
import { edgewaveHome } from "./events";

/** The Wwise version the game uses. */
export const WwiseVersion = "2023.1.14";
/** The rate of the game's voice lines. */
export const WemRate = 48000;
export const Conversion = "Vorbis Quality High";
/** Where Audiokinetic's page for the Launcher is, for the modder who has no Wwise. */
export const WwiseDownload = "https://www.audiokinetic.com/en/download/";

export interface Wwise {
  exe: string;
  /** Such as 2023.1.14.8770, from the folder's name; undefined when the folder does not say. */
  version?: string;
}

/** WwiseConsole.exe in a Wwise install folder. */
export const consoleIn = (folder: string) => path.join(folder, "Authoring", "x64", "Release", "bin", "WwiseConsole.exe");

/** The version a Wwise folder's name gives: Wwise_2023.1.14.8770 and Wwise2025.1.7.9143 both name theirs. */
export function versionOf(folder: string): string | undefined {
  return /^wwise[_ -]?v?(\d{4}\.\d+\.\d+(?:\.\d+)?)$/i.exec(path.basename(folder))?.[1];
}

/** The folders Audiokinetic's Launcher installs Wwise under. */
export function wwiseRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const roots = ["C:\\Audiokinetic"];
  for (const k of ["ProgramFiles(x86)", "ProgramFiles", "ProgramW6432"]) if (env[k]) roots.push(path.join(env[k]!, "Audiokinetic"));
  // WWISEROOT names the last version installed, which may not be 2023.1.14: its parent holds the others.
  if (env.WWISEROOT) roots.push(path.dirname(env.WWISEROOT.replace(/[\\/]+$/, "")));
  return roots.filter((r, i) => roots.findIndex((x) => x.toLowerCase() === r.toLowerCase()) === i);
}

export interface FindOptions {
  /** The edgewave.wwise.path setting: WwiseConsole.exe or a Wwise folder, any version. "off": none. */
  configured?: string;
  roots?: string[];
  exists?: (p: string) => boolean;
  list?: (dir: string) => string[];
}

/**
 * The Wwise to use: the one configured, else 2023.1.14 under the Launcher's folders (the latest build of it
 * when there are several). Undefined when there is none, or the setting is "off".
 */
export function findWwise(o: FindOptions = {}): Wwise | undefined {
  const exists = o.exists ?? ((p: string) => fs.existsSync(p));
  const list = o.list ?? ((d: string) => {
    try {
      return fs.readdirSync(d);
    } catch {
      return [];
    }
  });
  const configured = o.configured?.trim();
  if (configured?.toLowerCase() === "off") return undefined;
  if (configured) {
    if (/\.exe$/i.test(configured)) return exists(configured) ? { exe: configured, version: versionOf(path.resolve(configured, "..", "..", "..", "..", "..")) } : undefined;
    const exe = consoleIn(configured);
    return exists(exe) ? { exe, version: versionOf(configured) } : undefined;
  }
  const found: Wwise[] = [];
  for (const root of o.roots ?? wwiseRoots()) {
    for (const name of list(root)) {
      const version = versionOf(name);
      if (!version || (version !== WwiseVersion && !version.startsWith(`${WwiseVersion}.`))) continue;
      const exe = consoleIn(path.join(root, name));
      if (exists(exe)) found.push({ exe, version });
    }
  }
  const build = (w: Wwise) => Number(w.version?.split(".")[3] ?? 0);
  return found.sort((a, b) => build(b) - build(a))[0];
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A .wsources list: each source's WAV (relative to root) to its .wem's name. */
export function sourcesList(root: string, items: { wav: string; wem: string }[]): string {
  const rows = items.map((i) => `  <Source Path="${xml(i.wav)}" Conversion="${xml(Conversion)}" Destination="${xml(i.wem)}"/>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<ExternalSourcesList SchemaVersion="1" Root="${xml(root)}">\n${rows.join("\n")}\n</ExternalSourcesList>\n`;
}

/**
 * WwiseConsole's problems from its output: one tab-separated line each, such as
 * "Conversion<TAB>Error<TAB>MissingOriginalFile<TAB>External source file is missing<TAB>Windows<TAB>x.wav".
 */
export function problems(output: string): { level: string; message: string; file?: string }[] {
  const out: { level: string; message: string; file?: string }[] = [];
  for (const line of output.split(/\r?\n/)) {
    const f = line.split("\t");
    if (f.length < 4 || !/^(error|fatal ?error|warning)$/i.test(f[1].trim())) continue;
    out.push({ level: f[1].trim(), message: f[3].trim() || f[2].trim(), file: f[5]?.trim() || undefined });
  }
  return out;
}

/** Runs a program, resolving with its exit code and output (never rejecting on a non-zero exit). */
export type Run = (exe: string, args: string[], timeoutMs: number) => Promise<{ code: number; output: string }>;

export const run: Run = (exe, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(exe, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (e, stdout, stderr) => {
      const output = `${stdout ?? ""}${stderr ?? ""}`;
      if (e && typeof (e as { code?: unknown }).code !== "number") return reject(new Error(`WwiseConsole did not run: ${e.message}`));
      resolve({ code: e ? Number((e as { code?: number }).code) : 0, output });
    });
  });

/** Whether this WwiseConsole takes --no-wwise-dat: 2023.1 does, 2025.1.7 refuses it. */
const takesNoDat = (w: Wwise) => !w.version || Number(w.version.split(".")[0]) < 2025;

/** EDGEwave's blank Wwise project for this version, made the first time. */
export async function wwiseProject(w: Wwise, exec: Run = run, home = edgewaveHome()): Promise<string> {
  // Wwise refuses a project whose file is not named after its folder.
  const proj = path.join(home, "wwise", w.version ?? "configured", "EDGEwave", "EDGEwave.wproj");
  if (fs.existsSync(proj)) return proj;
  fs.rmSync(path.dirname(proj), { recursive: true, force: true });
  fs.mkdirSync(path.dirname(path.dirname(proj)), { recursive: true });
  const r = await exec(w.exe, ["create-new-project", proj, "--quiet"], 120_000);
  if (!fs.existsSync(proj)) throw new Error(`Wwise could not make its project (exit ${r.code}): ${r.output.trim().slice(0, 500) || "no output"}`);
  return proj;
}

/** A WAV as the game's voice lines are: mono, 48 kHz, 16-bit. */
export function asVoiceWav(wav: Uint8Array): Uint8Array {
  const a = resample(toMono(decodeWav(wav)), WemRate);
  return encodeWav(a);
}

export interface ConvertItem {
  /** The WAV, any rate and channels (16-bit PCM). */
  wav: string;
  /** Where its .wem goes. */
  out: string;
}

export interface ConvertResult {
  made: string[];
  failed: { out: string; message: string }[];
}

/**
 * Makes a .wem for each WAV, in one WwiseConsole run. A WAV EDGEwave cannot read, or Wwise refuses, is in
 * failed with the reason; the others are made.
 */
export async function convert(w: Wwise, items: ConvertItem[], o: { exec?: Run; home?: string; log?: (s: string) => void } = {}): Promise<ConvertResult> {
  const exec = o.exec ?? run;
  const home = o.home ?? edgewaveHome();
  const result: ConvertResult = { made: [], failed: [] };
  if (!items.length) return result;
  const proj = await wwiseProject(w, exec, home);
  const work = path.join(home, "wwise", "work", `${process.pid}-${Date.now()}`);
  fs.mkdirSync(work, { recursive: true });
  try {
    const sources: { wav: string; wem: string; item: ConvertItem }[] = [];
    items.forEach((item, i) => {
      try {
        const name = `s${i}`;
        fs.writeFileSync(path.join(work, `${name}.wav`), asVoiceWav(fs.readFileSync(item.wav)));
        sources.push({ wav: `${name}.wav`, wem: `${name}.wem`, item });
      } catch (e) {
        result.failed.push({ out: item.out, message: `${path.basename(item.wav)}: ${(e as Error).message}` });
      }
    });
    if (!sources.length) return result;
    const list = path.join(work, "sources.wsources");
    fs.writeFileSync(list, sourcesList(work, sources));
    const output = path.join(work, "out");
    const args = ["convert-external-source", proj, "--platform", "Windows", "--source-file", list, "--output", output, "--quiet"];
    if (takesNoDat(w)) args.push("--no-wwise-dat");
    const r = await exec(w.exe, args, 300_000);
    const said = problems(r.output);
    for (const s of sources) {
      const made = path.join(output, "Windows", s.wem);
      if (fs.existsSync(made) && fs.statSync(made).size > 0) {
        fs.mkdirSync(path.dirname(s.item.out), { recursive: true });
        fs.copyFileSync(made, s.item.out);
        result.made.push(s.item.out);
      } else {
        const why = said.find((p) => p.file && path.basename(p.file).toLowerCase() === s.wav.toLowerCase()) ?? said[0];
        result.failed.push({ out: s.item.out, message: why ? why.message : `Wwise made no .wem (exit ${r.code})${r.output.trim() ? `: ${r.output.trim().slice(0, 300)}` : ""}` });
      }
    }
    o.log?.(`Wwise ${w.version ?? ""}: ${result.made.length} .wem made, ${result.failed.length} failed`);
    return result;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
