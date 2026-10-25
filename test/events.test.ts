// Unit tests for the game's sound event index (src/events.ts), on a hand-made eventsmetadata.json in
// WolvenKit's JSON form (no game data).

import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { encodeWav } from "../src/audio/wav";
import { projectSounds } from "../src/customSound";
import { customEventName, eventsFromMetadata, searchEvents, wwiseId } from "../src/events";

const cn = (s: string) => ({ $type: "CName", $storage: "string", $value: s });
const ev = (name: string, tags: string[], o: { loop?: number; min?: number; max?: number; id?: number } = {}) => ({
  $type: "audioAudioEventMetadataArrayElement",
  isLooping: o.loop ?? 0,
  minDuration: o.min ?? 1,
  maxDuration: o.max ?? 2,
  redId: cn(name),
  tags: tags.map(cn),
  wwiseId: o.id ?? wwiseId(name),
});
const metadata = {
  Data: {
    RootChunk: {
      $type: "JsonResource",
      root: {
        Data: {
          $type: "audioAudioEventArray",
          events: [
            ev("mus_q001_v_meets_dex_01_START_intro_dialogue_choice", ["music_quests_events", "quest_music_start"], { max: 0 }),
            ev("mus_q001_v_meets_dex_05_STOP_end_silent", ["quest_music_stop"]),
            ev("sa_airdrop_package_land", ["sfx_quest_events"]),
            ev("sa_airdrop_package_land", ["sfx_quest_events"]),
            ev("amb_rain_loop", ["amb_global"], { loop: 1 }),
          ],
        },
      },
    },
  },
};

test("wwiseId is FNV-1 32 of the lower-case name", () => {
  assert.equal(wwiseId("Play_Music"), wwiseId("play_music"));
  assert.equal(wwiseId(""), 0x811c9dc5);
});

test("eventsFromMetadata: one per name, sorted, with loops, lengths and tags", () => {
  const e = eventsFromMetadata(metadata);
  assert.deepEqual(e.map((x) => x.name), ["amb_rain_loop", "mus_q001_v_meets_dex_01_START_intro_dialogue_choice", "mus_q001_v_meets_dex_05_STOP_end_silent", "sa_airdrop_package_land"]);
  assert.equal(e[0].loops, true);
  assert.deepEqual(e[3].tags, ["sfx_quest_events"]);
  assert.throws(() => eventsFromMetadata({}), /no events list/);
});

test("searchEvents: words, music, quest, a hash, and the variations", () => {
  const e = eventsFromMetadata(metadata);
  assert.deepEqual(searchEvents(e, { query: "dex start" }).map((x) => x.name), ["mus_q001_v_meets_dex_01_START_intro_dialogue_choice"]);
  assert.deepEqual(searchEvents(e, { music: true }).map((x) => x.name.slice(0, 8)), ["mus_q001", "mus_q001"]);
  assert.deepEqual(searchEvents(e, { quest: true, music: false }).map((x) => x.name), ["sa_airdrop_package_land"]);
  assert.deepEqual(searchEvents(e, { query: "amb_global" }).map((x) => x.name), ["amb_rain_loop"], "a whole tag matches");
  const land = wwiseId("sa_airdrop_package_land");
  const r = searchEvents(e, { query: String(land) }, new Map([[land, [11, 12]]]));
  assert.deepEqual(r.map((x) => [x.name, x.sounds, x.quest, x.music]), [["sa_airdrop_package_land", [11, 12], true, false]]);
  assert.equal(searchEvents(e, { limit: 2 }).length, 2);
  assert.deepEqual(searchEvents(e, { query: "sa" }).map((x) => x.name)[0], "sa_airdrop_package_land", "names starting with the word first");
});

test("customEventName: edgewave_ and a safe name", () => {
  assert.equal(customEventName("Door Knock (2)"), "edgewave_door_knock_2");
  assert.equal(customEventName("edgewave_x"), "edgewave_x");
  assert.throws(() => customEventName("!!"), /needs a name/);
});

test("searchEvents: the project's own sounds first; one with a game event's name replaces it", () => {
  const events = eventsFromMetadata(metadata);
  const own = [
    { name: "edgewave_door_knock", type: "mod_sfx_low_occlusion", file: "source/customSounds/edgewave_door_knock.wav", seconds: 0.5 },
    { name: "sa_airdrop_package_land", type: "mod_sfx_2d", file: "source/customSounds/sa_airdrop_package_land.wav" },
  ];
  const all = searchEvents(events, {}, undefined, own);
  assert.deepEqual(all.slice(0, 2).map((e) => e.name), ["edgewave_door_knock", "sa_airdrop_package_land"]);
  assert.equal(all.filter((e) => e.name === "sa_airdrop_package_land").length, 1);
  assert.deepEqual(all[0].project, { type: "mod_sfx_low_occlusion", file: "source/customSounds/edgewave_door_knock.wav" });
  assert.equal(all[0].max, 0.5);
  assert.equal(all[1].project?.replaces, true);
  assert.ok(all[1].quest && all[1].tags.includes("project"));
  assert.deepEqual(searchEvents(events, { query: "knock" }, undefined, own).map((e) => e.name), ["edgewave_door_knock"]);
  assert.deepEqual(searchEvents(events, { query: "project" }, undefined, own).length, 2);
  assert.equal(searchEvents(events, { music: true }, undefined, own).some((e) => e.project), false);
});

test("projectSounds: info.json's custom sounds with their WAV's length; a missing WAV is marked", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ew-own-"));
  try {
    assert.deepEqual(projectSounds(dir), []);
    fs.mkdirSync(path.join(dir, "source", "resources"), { recursive: true });
    fs.mkdirSync(path.join(dir, "source", "customSounds"), { recursive: true });
    fs.writeFileSync(path.join(dir, "source", "customSounds", "edgewave_a.wav"), encodeWav({ sampleRate: 48000, channels: [new Float32Array(24000)] }));
    fs.writeFileSync(path.join(dir, "source", "resources", "info.json"), JSON.stringify({ name: "m", customSounds: [{ name: "edgewave_a", type: "mod_sfx_2d", file: "edgewave_a.wav" }, { name: "edgewave_b", type: "mod_sfx_room", file: "edgewave_b.wav" }, { name: "x_skip", type: "mod_skip" }] }));
    assert.deepEqual(projectSounds(dir), [
      { name: "edgewave_a", type: "mod_sfx_2d", file: "source/customSounds/edgewave_a.wav", seconds: 0.5 },
      { name: "edgewave_b", type: "mod_sfx_room", file: "source/customSounds/edgewave_b.wav", missing: true },
      { name: "x_skip", type: "mod_skip" },
    ]);
    fs.writeFileSync(path.join(dir, "source", "resources", "info.json"), "{ nope");
    assert.throws(() => projectSounds(dir), /not valid JSON/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
