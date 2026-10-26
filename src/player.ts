// Plays a WAV at once from the extension, with no page (EDGEwave #8: EDGEquest's sound picker plays an event
// on its ▶ without opening the Hear tab). A webview may refuse to play before it has had a click; this asks
// none. On Windows a hidden PowerShell is kept running with a System.Media.SoundPlayer, which plays each WAV
// from memory; a new sound stops the one playing. It starts on first use (about a second) and is closed with
// the extension. Elsewhere there is no player yet, and the caller gets a reason.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as readline from "node:readline";

// Each line in is a WAV as base64, or "stop"; each line out is "ok" or "error <message>".
const Script = `
$p = New-Object System.Media.SoundPlayer
while ($null -ne ($l = [Console]::In.ReadLine())) {
  try {
    $p.Stop()
    if ($l -ne 'stop') { $p.Stream = New-Object IO.MemoryStream(,[Convert]::FromBase64String($l)); $p.Load(); $p.Play() }
    [Console]::Out.WriteLine('ok')
  } catch { [Console]::Out.WriteLine('error ' + $_.Exception.Message) }
}`;

export class QuietPlayer {
  private ps?: ChildProcessWithoutNullStreams;
  private replies: ((line: string) => void)[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly log: (line: string) => void) {}

  /** Why sounds cannot play this way here, or undefined when they can. */
  static unavailable(): string | undefined {
    return process.platform === "win32" ? undefined : "EDGEwave plays a sound without its Hear tab on Windows only; call playEvent without show: false to hear it there.";
  }

  /** Starts the player ahead of the first sound, so that one does not wait for it. */
  warm(): void {
    if (!QuietPlayer.unavailable()) this.start();
  }

  /** Plays a PCM WAV, stopping the sound playing; resolves once it plays. */
  play(wav: Uint8Array): Promise<void> {
    return this.send(Buffer.from(wav).toString("base64"));
  }

  stop(): Promise<void> {
    return this.ps ? this.send("stop") : Promise.resolve();
  }

  dispose(): void {
    this.ps?.kill();
    this.ps = undefined;
  }

  private start(): ChildProcessWithoutNullStreams {
    if (this.ps) return this.ps;
    const ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(Script, "utf16le").toString("base64")], { windowsHide: true });
    readline.createInterface({ input: ps.stdout }).on("line", (line) => this.replies.shift()?.(line));
    ps.on("error", (e) => this.log(`Player: ${e.message}`));
    ps.on("exit", (code) => {
      if (this.ps === ps) this.ps = undefined;
      for (const r of this.replies.splice(0)) r(`error the player stopped (exit ${code})`);
    });
    this.ps = ps;
    return ps;
  }

  /** One line to the player and its answer, one at a time. */
  private send(line: string): Promise<void> {
    const next = this.queue.then(
      () =>
        new Promise<void>((resolve, reject) => {
          const why = QuietPlayer.unavailable();
          if (why) return reject(new Error(why));
          const ps = this.start();
          this.replies.push((answer) => (answer === "ok" ? resolve() : reject(new Error(answer.replace(/^error /, "")))));
          ps.stdin.write(`${line}\n`);
        }),
    );
    this.queue = next.catch(() => undefined);
    return next;
  }
}
