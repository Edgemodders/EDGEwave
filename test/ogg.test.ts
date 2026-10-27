// Ogg Vorbis to WAV (src/audio/ogg.ts), for playing a voice line's .wem from Game Assets without a tab.
// test/fixtures/tone.ogg is a made tone (440 Hz, 48 kHz mono, about 2.9 s, encoded with VLC), not a game file.

import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { decodeWav } from "../src/audio/wav";
import { oggToWav } from "../src/audio/ogg";

/** The file's length in samples: the last Ogg page's granule position. */
function granules(b: Buffer): number {
  let last = 0;
  for (let i = b.indexOf("OggS"); i >= 0; i = b.indexOf("OggS", i + 4)) last = Number(b.readBigInt64LE(i + 6));
  return last;
}

test("Ogg: a Vorbis file becomes a 16-bit WAV with its rate, channels and length", async () => {
  const ogg = fs.readFileSync(path.join(__dirname, "..", "test", "fixtures", "tone.ogg"));
  const a = decodeWav(await oggToWav(ogg));
  assert.equal(a.sampleRate, 48000);
  assert.equal(a.channels.length, 1);
  // The decoder drops the stream's first partial block, so a little under the file's own length.
  assert.ok(Math.abs(a.channels[0].length - granules(ogg)) < 200, `${a.channels[0].length} of ${granules(ogg)} samples`);
  const peak = a.channels[0].reduce((m, s) => Math.max(m, Math.abs(s)), 0);
  assert.ok(peak > 0.15 && peak < 0.35, `peak ${peak}`);
  await assert.rejects(oggToWav(new Uint8Array(100)));
});
