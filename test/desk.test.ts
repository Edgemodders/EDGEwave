// The Desk and the Library (src/desk.ts, src/library.ts): copying a mix with its files, Desk items, Add to
// Library and its updates, Edit on the Desk, a Library sound into a project with the came-from note, Refresh.

import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { changedSinceLibrary, copyMix, deskItemOf, deskVersion, listDesk, moveToProject, newOnDesk, readItem, renameItem } from "../src/desk";
import { emptyDoc, formatDoc, newTrack, parseDoc } from "../src/doc";
import { addFromLibrary, addToLibrary, editOnDesk, libraryFolder, librarySounds, readNote, refreshList, safeFolder, setLibraryRoot, libraryRoot } from "../src/library";

const Tool = "EDGEwave 0.3.0";

function scratch(): { dir: string; done: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ewd-"));
  return { dir, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const put = (file: string, text: string | Buffer = "x") => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

/** A mix with a dropped file, an ElevenLabs take, a file from elsewhere (twice) and a game sound. */
function mixIn(dir: string, outside: string): string {
  const doc = emptyDoc("Door.wav");
  doc.tracks.push(newTrack("t1", { kind: "file", file: "Door.sounds/knock.wav" }));
  doc.tracks.push(newTrack("t2", { kind: "file", file: "Door.gen/speak-hi.wav" }));
  doc.tracks.push(newTrack("t3", { kind: "file", file: path.relative(dir, outside) }));
  doc.tracks.push(newTrack("t4", { kind: "file", file: outside }));
  doc.tracks.push(newTrack("t5", { kind: "sfx", soundHash: 42 }));
  put(path.join(dir, "Door.sounds", "knock.wav"), "knock");
  put(path.join(dir, "Door.gen", "speak-hi.wav"), "hi");
  put(path.join(dir, "Door.gen", "speak-hi.previous.wav"), "old hi");
  put(path.join(dir, "Door.wav"), "render");
  put(outside, "creak");
  const file = path.join(dir, "Door.edgewave");
  put(file, formatDoc(doc));
  return file;
}

test("copyMix: own folders whole, outside files taken in once, the render renamed, game sounds kept", () => {
  const s = scratch();
  try {
    const src = mixIn(path.join(s.dir, "a"), path.join(s.dir, "elsewhere", "creak.wav"));
    const r = copyMix(src, path.join(s.dir, "b"), "Front door");
    const doc = parseDoc(fs.readFileSync(r.doc, "utf8"));
    assert.equal(path.basename(r.doc), "Front door.edgewave");
    assert.equal(doc.render.file, "Front door.wav");
    assert.deepEqual(doc.tracks.map((t) => (t.source.kind === "file" ? t.source.file : t.source.kind)), [
      "Front door.sounds/knock.wav",
      "Front door.gen/speak-hi.wav",
      "Front door.sounds/creak.wav",
      "Front door.sounds/creak.wav",
      "sfx",
    ]);
    const b = (rel: string) => fs.readFileSync(path.join(s.dir, "b", rel), "utf8");
    assert.equal(b("Front door.sounds/creak.wav"), "creak");
    assert.equal(b("Front door.gen/speak-hi.previous.wav"), "old hi");
    assert.equal(b("Front door.wav"), "render");
    assert.deepEqual(r.missing, []);
    assert.equal(r.files.length, 6);
  } finally {
    s.done();
  }
});

test("copyMix: a missing source is kept by its full path and reported; a different file of the same name gets a number", () => {
  const s = scratch();
  try {
    const a = path.join(s.dir, "a");
    const doc = emptyDoc("M.wav");
    doc.tracks.push(newTrack("t1", { kind: "file", file: "gone.wav" }), newTrack("t2", { kind: "file", file: "x/k.wav" }), newTrack("t3", { kind: "file", file: "y/k.wav" }));
    put(path.join(a, "x", "k.wav"), "one");
    put(path.join(a, "y", "k.wav"), "two");
    put(path.join(a, "M.edgewave"), formatDoc(doc));
    const r = copyMix(path.join(a, "M.edgewave"), path.join(s.dir, "b"), "M");
    const out = parseDoc(fs.readFileSync(r.doc, "utf8"));
    assert.deepEqual(r.missing, [path.join(a, "gone.wav")]);
    assert.deepEqual(out.tracks.map((t) => (t.source.kind === "file" ? t.source.file : "")), [path.join(a, "gone.wav"), "M.sounds/k.wav", "M.sounds/k 2.wav"]);
  } finally {
    s.done();
  }
});

test("The Desk: a new mix is an item in the Library's shape; listed, found by its mix, renamed with its id", () => {
  const s = scratch();
  try {
    const desk = path.join(s.dir, "desk");
    const item = newOnDesk({ name: "New sound", tool: Tool, dir: desk });
    assert.equal(path.basename(item.folder), "New sound.sound.asset");
    assert.equal(item.asset?.kind, "sound");
    assert.equal(item.asset?.main, "source/raw/New sound.edgewave");
    assert.equal(item.asset?.render, "source/raw/New sound.wav");
    assert.equal(parseDoc(fs.readFileSync(item.doc, "utf8")).render.file, "New sound.wav");
    assert.equal(item.rendered, false);
    const again = newOnDesk({ name: "New sound", tool: Tool, dir: desk });
    assert.equal(again.name, "New sound_2");
    assert.deepEqual(listDesk(desk).map((i) => i.name).sort(), ["New sound", "New sound_2"]);
    assert.equal(deskItemOf(item.doc, desk)?.folder, item.folder);
    assert.equal(deskItemOf(path.join(s.dir, "x.edgewave"), desk), undefined);
    const r = renameItem(item, "Knock", Tool);
    assert.equal(r.name, "Knock");
    assert.equal(r.asset?.id, item.asset?.id);
    assert.equal(r.asset?.main, "source/raw/Knock.edgewave");
    assert.equal(fs.existsSync(item.folder), false);
    assert.match(r.asset!.history.at(-1)!.did, /Renamed from New sound/);
  } finally {
    s.done();
  }
});

test("Move to Project: the mix and its files under source/raw/edgewave/sounds/<name>/, off the Desk", () => {
  const s = scratch();
  try {
    const desk = path.join(s.dir, "desk");
    const item = newOnDesk({ name: "Door", tool: Tool, dir: desk });
    const src = mixIn(path.join(item.folder, "source", "raw"), path.join(s.dir, "elsewhere", "creak.wav"));
    assert.equal(src, item.doc);
    const raw = path.join(s.dir, "proj", "source", "raw");
    const r = moveToProject(readItem(item.folder)!, raw);
    assert.equal(r.doc, path.join(raw, "edgewave", "sounds", "Door", "Door.edgewave"));
    assert.equal(fs.existsSync(path.join(raw, "edgewave", "sounds", "Door", "Door.sounds", "creak.wav")), true);
    assert.equal(fs.existsSync(item.folder), false);
  } finally {
    s.done();
  }
});

test("The Library's root: recorded for every tool, keeping other fields; folders checked", () => {
  const s = scratch();
  try {
    const file = path.join(s.dir, "EDGE", "library.json");
    put(file, JSON.stringify({ other: 1 }));
    const root = setLibraryRoot(path.join(s.dir, "Lib"), { file });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { other: 1, root });
    assert.equal(libraryRoot(file), root);
    assert.throws(() => setLibraryRoot(path.join(s.dir, "game", "Lib"), { file, gameDir: path.join(s.dir, "game") }), /inside the game's folder/);
    assert.equal(safeFolder("Production\\Doors/"), "Production/Doors");
    assert.throws(() => safeFolder("../up"), /cannot go through/);
    assert.throws(() => safeFolder("x/knock.sound.asset"), /is a Library item/);
  } finally {
    s.done();
  }
});

test("Add to Library, again (one version up, where it is), Edit on the Desk, into a project, Refresh", () => {
  const s = scratch();
  try {
    const desk = path.join(s.dir, "desk");
    const root = path.join(s.dir, "Lib");
    fs.mkdirSync(path.join(root, "Doors"), { recursive: true });
    put(path.join(root, "Doors", "old.wav"), "plain");
    put(path.join(root, "Doors", "chair.prop.asset", "asset.json"), "{}");
    const item = newOnDesk({ name: "Door", tool: Tool, dir: desk, gamePath: "base\\localization\\en-us\\vo\\door_f_0123456789abcdef.wem" });
    assert.throws(() => addToLibrary({ item, root, folder: "Doors", tool: Tool }), /Render Door first/);
    mixIn(path.join(item.folder, "source", "raw"), path.join(s.dir, "elsewhere", "creak.wav"));

    const first = addToLibrary({ item: readItem(item.folder)!, root, folder: "Doors", tool: Tool });
    assert.equal(first.rel, "Doors/Door.sound.asset");
    assert.equal(first.version, 1);
    assert.equal(first.updated, false);
    const here = libraryFolder(root, "Doors");
    assert.deepEqual(here.sounds.map((x) => x.name), ["Door"]);
    assert.deepEqual(here.files.map((x) => x.name), ["old.wav"]);
    assert.equal(readItem(item.folder)!.asset?.library?.path, "Doors/Door.sound.asset");

    const second = addToLibrary({ item: readItem(item.folder)!, root, folder: "Elsewhere", tool: Tool });
    assert.equal(second.rel, "Doors/Door.sound.asset");
    assert.equal(second.version, 2);
    assert.equal(second.updated, true);
    assert.equal(librarySounds(root).length, 1);

    const game = newOnDesk({ name: "Line", tool: Tool, dir: desk, gamePath: "base\\localization\\en-us\\vo\\line.wem" });
    put(game.render, "r");
    assert.equal(addToLibrary({ item: readItem(game.folder)!, root, folder: "", useGamePath: true, tool: Tool }).rel, "base/localization/en-us/vo/Line.sound.asset");

    const lib = librarySounds(root).find((x) => x.name === "Door")!;
    const projectDir = path.join(s.dir, "proj");
    put(path.join(projectDir, "source", "library.json"), JSON.stringify({ format: 1, items: [{ id: "p1", kind: "prop", path: "x", added: "", by: "edgefab", files: ["source/archive/x.ent"] }] }));
    const raw = path.join(projectDir, "source", "raw");
    const into = addFromLibrary(lib, { dir: projectDir, raw });
    assert.equal(into.doc, path.join(raw, "edgewave", "sounds", "Door", "Door.edgewave"));
    assert.equal(into.version, 2);
    const note = readNote(projectDir);
    assert.deepEqual(note.items.map((i) => i.by), ["edgefab", "edgewave"]);
    assert.ok(note.items[1].files.includes("source/raw/edgewave/sounds/Door/Door.sounds/creak.wav"));
    assert.deepEqual(refreshList(projectDir, root).map((l) => l.state), ["same"]);

    const edit = editOnDesk(lib, { desk: path.join(s.dir, "desk2"), tool: Tool });
    assert.equal(edit.item.asset?.id, lib.asset?.id);
    assert.equal(edit.item.asset?.library?.version, 2);
    assert.throws(() => editOnDesk(lib, { desk: path.join(s.dir, "desk2"), tool: Tool }), /on the Desk already/);
    assert.equal(addToLibrary({ item: edit.item, root, tool: Tool }).version, 3);
    assert.deepEqual(refreshList(projectDir, root).map((l) => l.state), ["newer"]);

    // Taken again: in the same folder, the earlier files removed.
    fs.writeFileSync(path.join(raw, "edgewave", "sounds", "Door", "Door.sounds", "creak.wav"), "stale");
    const again = addFromLibrary(librarySounds(root).find((x) => x.name === "Door")!, { dir: projectDir, raw });
    assert.equal(again.replaced, true);
    assert.equal(again.doc, into.doc);
    assert.equal(fs.readFileSync(path.join(raw, "edgewave", "sounds", "Door", "Door.sounds", "creak.wav"), "utf8"), "creak");
    assert.deepEqual(readNote(projectDir).items.map((i) => [i.by, i.version]), [["edgefab", undefined], ["edgewave", 3]]);
  } finally {
    s.done();
  }
});

test("A Desk mix in the Library: the same until its mix or render changes, then changed since (the version waits for Add to Library)", () => {
  const s = scratch();
  try {
    const desk = path.join(s.dir, "desk");
    const root = path.join(s.dir, "Lib");
    fs.mkdirSync(root, { recursive: true });
    const item = newOnDesk({ name: "Door", tool: Tool, dir: desk });
    assert.equal(changedSinceLibrary(item), false);
    put(item.render, "r");
    addToLibrary({ item: readItem(item.folder)!, root, tool: Tool });
    const added = readItem(item.folder)!;
    assert.equal(changedSinceLibrary(added), false);
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(added.render, later, later);
    assert.equal(changedSinceLibrary(added), true);
    assert.equal(added.asset?.library?.version, 1);
    addToLibrary({ item: added, root, tool: Tool });
    const again = readItem(item.folder)!;
    assert.equal(again.asset?.library?.version, 2);
  } finally {
    s.done();
  }
});

test("A Desk mix's own version: 1 before the Library, the Library's when the same, one more once changed", () => {
  const s = scratch();
  try {
    const desk = path.join(s.dir, "desk");
    const root = path.join(s.dir, "Lib");
    fs.mkdirSync(root, { recursive: true });
    const item = newOnDesk({ name: "Door", tool: Tool, dir: desk });
    put(item.render, "r");
    assert.equal(deskVersion(readItem(item.folder)!), 1);
    addToLibrary({ item: readItem(item.folder)!, root, tool: Tool });
    assert.equal(deskVersion(readItem(item.folder)!), 1);
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(item.doc, later, later);
    assert.equal(deskVersion(readItem(item.folder)!), 2);
    assert.equal(addToLibrary({ item: readItem(item.folder)!, root, tool: Tool }).version, 2);
  } finally {
    s.done();
  }
});
