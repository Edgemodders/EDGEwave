// The shared key store (REDcode's Keys, `%APPDATA%\Edgemodders\keys`), read and written through REDbridge's
// keys.* methods (REDbridge 0.18.0, on only when it is started with --keys). EDGEwave #12, the store's pilot.
//
// In VS Code, EDGEwave reads its ElevenLabs key through REDcode's API (api.keys, src/voiceTools.ts), which asks
// the modder once. This client is for where REDcode cannot help: the MCP server, which runs without VS Code, and
// the one-time move of a key from EDGEwave's own secret storage (REDcode's API has no way to save a key that is
// not typed in). REDcode's own bridge client refuses keys.* on purpose, so this is a small one of our own:
// JSON-RPC 2.0 over REDbridge's stdin and stdout, with Content-Length framing, as REDcode's is. No vscode here.

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** keys.get's answer: the key (null when unset or unreadable here) and where it came from. */
export interface KeyRead {
  service: string;
  key: string | null;
  source: "env" | "file" | null;
  unreadable: boolean;
}

/** keys.info's answer, never the key. */
export interface KeyInfo {
  service: string;
  name: string;
  set: boolean;
  source: "env" | "file" | null;
  env: string;
  last4: string | null;
  unreadable: boolean;
}

/** The service and the names EDGEwave reads it under (REDbridge records who read a key, for REDcode's Keys view). */
export const Service = "elevenlabs";
export const Caller = "EDGEwave";
export const McpCaller = "EDGEwave MCP";

/** REDcode's keys.status answer, as far as noKeyReason reads it. */
export interface AccessStatus {
  set: boolean;
  unreadable: boolean;
  access: "allowed" | "denied" | "unasked";
}

/**
 * Why EDGEwave stops, with no password box, after REDcode's keys.get answered no key (EDGEwave #14, as EDGEhack
 * and EDGEmat do it): the modder said Don't Allow, or a key is there and REDcode's question was closed with no
 * answer (a password box would replace that key). Undefined: offer the password box, as before.
 */
export function noKeyReason(s: AccessStatus | undefined): string | undefined {
  if (!s) return undefined;
  if (s.access === "denied") return "You chose Don't Allow when REDcode asked whether EDGEwave may read your ElevenLabs key. To change that, run Forget Tool Permissions for Keys in REDcode's Keys view, then try again.";
  if (s.set && !s.unreadable && s.access === "unasked") return "REDcode's question about your ElevenLabs key was closed without an answer. Try again and choose Allow.";
  return undefined;
}

/** A REDbridge that answers JSON-RPC methods by name has no keys.* when it is older than 0.18.0. */
const MethodNotFound = -32601;
export const TooOld = "The key store needs REDbridge 0.18.0 or later. In VS Code: REDcode: Install REDbridge (or Update REDbridge).";

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

/** One REDbridge started with --keys, for key calls only; started on the first call, kept until close(). */
export class KeysBridge {
  private child?: ChildProcess;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private stderr: string[] = [];

  /**
   * exe is REDbridge.exe; args go before --keys (a test runs a stand-in with node). dotnetRoot is REDcode's
   * redcode.dotnetRoot setting, when the modder set one.
   */
  constructor(private readonly o: { exe: string; args?: string[]; dotnetRoot?: string; timeoutMs?: number }) {}

  get(service: string, tool: string): Promise<KeyRead> {
    return this.call<KeyRead>("keys.get", { service, tool });
  }

  set(service: string, key: string): Promise<KeyInfo> {
    return this.call<KeyInfo>("keys.set", { service, key });
  }

  info(service: string): Promise<KeyInfo> {
    return this.call<KeyInfo>("keys.info", { service });
  }

  close(): void {
    const child = this.child;
    this.child = undefined;
    this.fail(new Error("REDbridge was stopped"));
    if (child && child.exitCode === null) child.kill();
  }

  private start(): ChildProcess {
    if (this.child && this.child.exitCode === null) return this.child;
    const env = { ...process.env };
    if (this.o.dotnetRoot) env.DOTNET_ROOT = this.o.dotnetRoot;
    // No --game: the keys need no game, and REDbridge starts faster without loading it.
    const child = spawn(this.o.exe, [...(this.o.args ?? []), "--keys"], { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.child = child;
    this.buffer = Buffer.alloc(0);
    this.stderr = [];
    child.stdout!.on("data", (b: Buffer) => this.read(b));
    // Its log, kept for an error message; a key is never logged by REDbridge.
    child.stderr!.on("data", (b: Buffer) => {
      this.stderr.push(...String(b).split(/\r?\n/).filter(Boolean));
      this.stderr = this.stderr.slice(-5);
    });
    child.on("error", (e) => this.fail(new Error(`REDbridge could not start (${this.o.exe}): ${e.message}`)));
    child.on("exit", (code) => {
      if (this.child === child) this.child = undefined;
      this.fail(new Error(`REDbridge stopped (exit code ${code})${this.stderr.length ? `: ${this.stderr.join(" ")}` : ""}`));
    });
    // A stdin write after it exited would throw; the exit handler has already answered.
    child.stdin!.on("error", () => undefined);
    return child;
  }

  private call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const child = this.start();
    const id = this.nextId++;
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, method, params }), "utf8");
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`REDbridge did not answer ${method} in time`));
      }, this.o.timeoutMs ?? 30000);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      child.stdin!.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]));
    });
  }

  private read(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const end = this.buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      const length = Number(/content-length:\s*(\d+)/i.exec(this.buffer.subarray(0, end).toString("ascii"))?.[1]);
      if (!Number.isFinite(length)) {
        // Not a header: drop it and look for the next one.
        this.buffer = this.buffer.subarray(end + 4);
        continue;
      }
      if (this.buffer.length < end + 4 + length) return;
      const text = this.buffer.subarray(end + 4, end + 4 + length).toString("utf8");
      this.buffer = this.buffer.subarray(end + 4 + length);
      this.answer(text);
    }
  }

  private answer(text: string): void {
    let m: { id?: number; result?: unknown; error?: { code?: number; message?: string } };
    try {
      m = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof m.id !== "number") return; // a notification
    const p = this.pending.get(m.id);
    if (!p) return;
    this.pending.delete(m.id);
    clearTimeout(p.timer);
    if (!m.error) return p.resolve(m.result);
    p.reject(new Error(m.error.code === MethodNotFound ? TooOld : (m.error.message ?? "REDbridge refused the call")));
  }

  private fail(e: Error): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(e);
      this.pending.delete(id);
    }
  }
}

const isFile = (p: string) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/**
 * REDbridge.exe, found as REDcode finds it: the redcode.bridgePath setting (the file, or a folder holding it);
 * else the one inside an installed REDcode (newest first), else one on the PATH. Undefined when none is there.
 */
export function findBridge(o: { configured?: string; redcodeDirs?: string[]; pathEnv?: string }): string | undefined {
  if (o.configured) {
    const inFolder = path.join(o.configured, "REDbridge.exe");
    return isFile(o.configured) ? o.configured : isFile(inFolder) ? inFolder : undefined;
  }
  for (const dir of o.redcodeDirs ?? []) {
    const bundled = path.join(dir, "bridge", "REDbridge.exe");
    if (isFile(bundled)) return bundled;
  }
  for (const dir of (o.pathEnv ?? "").split(path.delimiter)) {
    const candidate = dir && path.join(dir, "REDbridge.exe");
    if (candidate && isFile(candidate)) return candidate;
  }
  return undefined;
}

/** Installed REDcode extensions' folders, newest version first (for findBridge outside VS Code). */
export function installedRedcodeDirs(extensionsDir = path.join(os.homedir(), ".vscode", "extensions")): string[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(extensionsDir).filter((n) => /^edgemodders\.redcode-cyberpunk-\d/.test(n));
  } catch {
    return [];
  }
  const version = (n: string) => (/-(\d+)\.(\d+)\.(\d+)/.exec(n) ?? []).slice(1).map(Number);
  return names
    .sort((a, b) => {
      const va = version(a);
      const vb = version(b);
      for (let i = 0; i < 3; i++) if ((va[i] ?? 0) !== (vb[i] ?? 0)) return (vb[i] ?? 0) - (va[i] ?? 0);
      return 0;
    })
    .map((n) => path.join(extensionsDir, n));
}

/** Whether Claude Code's user-scope entry for EDGEwave passes the ElevenLabs key (EDGEwave 0.2.0's Connect could). The key is not read out. */
export function claudeHoldsKey(file = path.join(os.homedir(), ".claude.json")): boolean {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8")) as { mcpServers?: Record<string, { env?: Record<string, string> }> };
    return !!j.mcpServers?.edgewave?.env?.ELEVENLABS_API_KEY;
  } catch {
    return false;
  }
}
