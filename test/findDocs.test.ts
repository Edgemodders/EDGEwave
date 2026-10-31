// Finding sound documents in REDcode's project when it is outside the open folder (src/findDocs.ts).

import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { findSoundDocs } from "../src/findDocs";

test("Sound documents: found in the project's folders, not in what it packs, nor in a mix's own folders", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ewf-"));
  const put = (rel: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), "{}");
  };
  try {
    for (const f of [
      "source/raw/edgewave/sounds/Door.edgewave",
      "source/raw/sfx/smoke_event/42.edgewave",
      "Notes.edgewave",
      "packed/x.edgewave",
      "source/archive/base/y.edgewave",
      "source/raw/edgewave/sounds/Door.sounds/z.edgewave",
      ".git/w.edgewave",
      "source/raw/edgewave/sounds/Door.wav",
    ]) put(f);
    const found = findSoundDocs(root).map((f) => path.relative(root, f).split(path.sep).join("/")).sort();
    assert.deepEqual(found, ["Notes.edgewave", "source/raw/edgewave/sounds/Door.edgewave", "source/raw/sfx/smoke_event/42.edgewave"]);
    assert.equal(findSoundDocs(root, 1).length, 1);
    assert.deepEqual(findSoundDocs(path.join(root, "nowhere")), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
