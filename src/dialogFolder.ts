// Windows' file dialogs ignore a starting folder that does not exist and open the last one used, so a
// dialog meant to start in a folder not made yet has it made first. The folders made are taken away
// after the dialog, when still empty, so cancelling leaves nothing behind; what the caller then writes
// makes the folders it needs.

import * as fs from "node:fs";
import * as path from "node:path";

/** Runs a dialog (`ask`) with `dir` there for it to start in. */
export async function withDialogFolder<T>(dir: string, ask: () => PromiseLike<T>): Promise<T> {
  // Listed before making them, deepest first; on Windows mkdirSync names what it made as \\?\C:\...
  const missing: string[] = [];
  for (let d = path.resolve(dir); !fs.existsSync(d) && d !== path.dirname(d); d = path.dirname(d)) missing.push(d);
  fs.mkdirSync(dir, { recursive: true });
  try {
    return await ask();
  } finally {
    for (const d of missing) {
      try {
        fs.rmdirSync(d);
      } catch {
        break;
      }
    }
  }
}
