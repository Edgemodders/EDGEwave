// Finds sound documents under a folder, for the Sounds view's Project group when REDcode's project is outside the
// open folder (src/soundsView.ts). No VS Code imports, so the unit tests run it.

import * as fs from "node:fs";
import * as path from "node:path";
import { Extension } from "./doc";

/** The .edgewave documents under a folder, skipping what a project packs or installs and tools' dot folders. */
export function findSoundDocs(root: string, most = 2000): string[] {
  const out: string[] = [];
  const skip = new Set(["node_modules", "packed", "archive", "customSounds"]);
  const walk = (dir: string, depth: number) => {
    if (out.length >= most || depth > 10) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!skip.has(e.name) && !e.name.endsWith(".sounds") && !e.name.endsWith(".gen")) walk(p, depth + 1);
      } else if (e.name.endsWith(Extension) && out.length < most) out.push(p);
    }
  };
  walk(root, 0);
  return out;
}
