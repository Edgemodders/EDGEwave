// REDnode's editor channel (src/rednodeEditor.ts), against a stand-in on localhost: the token, the calls, and
// a reason when the game is not running with REDnode (no editor.json, one left by a game that ended, a
// refused connection) or the game is not linked yet.

import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { inGame } from "../src/rednodeEditor";

test("REDnode's editor channel: plays and stops with the run's token; a reason without a game", async () => {
  const seen: { url: string; auth?: string; body: unknown }[] = [];
  let linked = true;
  const s = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ url: req.url!, auth: req.headers.authorization, body: body ? JSON.parse(body) : undefined });
      res.setHeader("content-type", "application/json");
      if (req.headers.authorization !== "Bearer run-token") return res.writeHead(401).end(JSON.stringify({ ok: false, reason: "wrong token" }));
      if (!linked) return res.writeHead(409).end(JSON.stringify({ ok: false, reason: "the game is not linked" }));
      res.end(JSON.stringify(req.url === "/editor/sound.play" ? { ok: true, playingId: 7, on: "player" } : { ok: true, stopped: 1 }));
    });
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ewr-"));
  const file = path.join(dir, "editor.json");
  process.env.EDGEWAVE_REDNODE_EDITOR = file;
  const write = (o: object) => fs.writeFileSync(file, JSON.stringify(o));
  const port = (s.address() as AddressInfo).port;
  try {
    const none = await inGame("sound.play", { name: "x" });
    assert.ok(!none.ok && /Start the game with REDnode 0\.43/.test(none.reason));

    write({ port, token: "run-token", pid: process.pid });
    const played = await inGame<{ playingId: number }>("sound.play", { name: "mus_q001_start", on: "player" });
    assert.deepEqual(played, { ok: true, playingId: 7, on: "player" });
    assert.deepEqual(seen.at(-1), { url: "/editor/sound.play", auth: "Bearer run-token", body: { name: "mus_q001_start", on: "player" } });
    assert.deepEqual(await inGame("sound.stop", {}), { ok: true, stopped: 1 });

    linked = false;
    const loading = await inGame("sound.play", { name: "x" });
    assert.ok(!loading.ok && /REDnode: the game is not linked\. Wait for the game to load/.test(loading.reason));
    linked = true;

    write({ port, token: "old-token", pid: process.pid });
    const wrong = await inGame("sound.play", { name: "x" });
    assert.ok(!wrong.ok && /wrong token/.test(wrong.reason));

    // A game that ended leaves editor.json behind: its pid no longer runs, so nothing is called.
    const before = seen.length;
    write({ port, token: "run-token", pid: 999999 });
    const ended = await inGame("sound.play", { name: "x" });
    assert.ok(!ended.ok && /Start the game/.test(ended.reason));
    assert.equal(seen.length, before);
  } finally {
    delete process.env.EDGEWAVE_REDNODE_EDITOR;
    await new Promise<void>((r) => s.close(() => r()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // The port closed: a refused connection is no game too.
  fs.mkdirSync(dir, { recursive: true });
  process.env.EDGEWAVE_REDNODE_EDITOR = file;
  try {
    fs.writeFileSync(file, JSON.stringify({ port, token: "run-token", pid: process.pid }));
    const refused = await inGame("sound.play", { name: "x" });
    assert.ok(!refused.ok && /Start the game/.test(refused.reason));
  } finally {
    delete process.env.EDGEWAVE_REDNODE_EDITOR;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
