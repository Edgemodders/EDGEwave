// A dialog's starting folder is there while it shows, and gone after unless it was there before or holds something (src/dialogFolder.ts).

import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { withDialogFolder } from "../src/dialogFolder";

const inTemp = async (run: (root: string) => Promise<void>) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ewd-"));
  try {
    await run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

test("Dialog folder: made for the dialog, every level gone after it", () =>
  inTemp(async (root) => {
    const dir = path.join(root, "source", "raw", "edgewave", "sounds");
    const seen = await withDialogFolder(dir, async () => fs.existsSync(dir));
    assert.equal(seen, true);
    assert.deepEqual(fs.readdirSync(root), []);
  }));

test("Dialog folder: stays when it was there before, and so does its parent", () =>
  inTemp(async (root) => {
    const dir = path.join(root, "source", "raw");
    fs.mkdirSync(dir, { recursive: true });
    await withDialogFolder(dir, async () => undefined);
    assert.equal(fs.existsSync(dir), true);
    await withDialogFolder(path.join(dir, "edgewave", "sounds"), async () => undefined);
    assert.deepEqual(fs.readdirSync(dir), []);
  }));

test("Dialog folder: what the dialog's user made in it stays", () =>
  inTemp(async (root) => {
    const dir = path.join(root, "edgewave", "sounds");
    await withDialogFolder(dir, async () => fs.mkdirSync(path.join(dir, "made in the dialog")));
    assert.equal(fs.existsSync(path.join(dir, "made in the dialog")), true);
  }));

test("Dialog folder: gone after a dialog that fails too", () =>
  inTemp(async (root) => {
    const dir = path.join(root, "edgewave", "sounds");
    await assert.rejects(withDialogFolder(dir, async () => { throw new Error("no"); }), /no/);
    assert.deepEqual(fs.readdirSync(root), []);
  }));
