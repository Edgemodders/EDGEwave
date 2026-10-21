// Unit tests for the REDnode sound route's manifest edits (src/rednode.ts).

import { test } from "node:test";
import * as assert from "node:assert/strict";
import { newManifest, newModScript, playLine, readManifest, soundNameFor, upsertSound, validId, validSoundName } from "../src/rednode";

test("upsertSound adds the sound with its file and category", () => {
  const out = JSON.parse(upsertSound(JSON.stringify(newManifest("my-mod", "My mod")), "alarm", "sfx"));
  assert.deepEqual(out.sounds, { alarm: { file: "sounds/alarm.wav", category: "sfx" } });
  assert.equal(out.main, "mod.mjs");
  assert.equal(out.open, true);
});

test("upsertSound keeps hand-set settings, other sounds and other fields", () => {
  const text = JSON.stringify({ id: "x", author: "me", sounds: { alarm: { file: "old.ogg", volume: 0.5, loop: true }, click: "sounds/click.wav" } });
  const out = JSON.parse(upsertSound(text, "alarm", "dialogue"));
  assert.equal(out.author, "me");
  assert.deepEqual(out.sounds.alarm, { file: "sounds/alarm.wav", volume: 0.5, loop: true, category: "dialogue" });
  assert.equal(out.sounds.click, "sounds/click.wav");
});

test("upsertSound turns a bare file into an object, and makes sounds when there is none", () => {
  assert.deepEqual(JSON.parse(upsertSound(JSON.stringify({ id: "x", sounds: { a: "a.wav" } }), "a", "music")).sounds.a, { file: "sounds/a.wav", category: "music" });
  assert.deepEqual(JSON.parse(upsertSound(JSON.stringify({ id: "x" }), "b", "sfx")).sounds, { b: { file: "sounds/b.wav", category: "sfx" } });
});

test("upsertSound refuses a manifest that is not a JSON object", () => {
  assert.throws(() => upsertSound("{ nope", "a", "sfx"), /not valid JSON/);
  assert.throws(() => upsertSound("[1]", "a", "sfx"), /not a JSON object/);
});

test("names: ids, sound names and a sound name from a file name", () => {
  assert.ok(validId("my-mod2"));
  assert.ok(!validId("My Mod"));
  assert.ok(!validId("-x"));
  assert.ok(validSoundName("v_line_01"));
  assert.ok(!validSoundName("a b"));
  assert.equal(soundNameFor("w_melee_katana_equip.edgewave"), "w_melee_katana_equip");
  assert.equal(soundNameFor("my sound (2).edgewave"), "my_sound_2");
  assert.equal(soundNameFor("..."), "sound");
});

test("readManifest gives the id, name and sounds, or undefined", () => {
  assert.deepEqual(readManifest(JSON.stringify({ id: "a", name: "A", sounds: { x: "x.wav" } })), { id: "a", name: "A", sounds: ["x"] });
  assert.deepEqual(readManifest(JSON.stringify({ id: "a" })), { id: "a", name: "a", sounds: [] });
  assert.equal(readManifest("{}"), undefined);
  assert.equal(readManifest("nope"), undefined);
});

test("the sample code plays the sound by its name", () => {
  assert.match(newModScript("alarm"), /await audio\.play\("alarm"\);/);
  assert.match(playLine("alarm"), /^import \{ audio \} from 'rednode';\nawait audio\.play\("alarm"\);$/);
});
