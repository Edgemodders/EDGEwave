// A stand-in for REDcode's API version 1 (edgemodders.redcode-cyberpunk) for tools/smoke/smoke.mjs:
// a project in the smoke folder and two sound effect events: smoke_event (sound 42, a 2 s 440 Hz stereo
// tone) and smoke_second (sounds 43, 1.5 s at 660 Hz, and 44, 0.5 s at 880 Hz, both mono).
// Opens sound 42 in EDGEwave three seconds after startup. Its bridge's toJson gives a small
// eventsmetadata.json (smoke_event, smoke_second and a music cue). Two commands call EDGEwave's own API as
// EDGEquest does: Smoke: EDGEwave API (sound events, hearing one, a custom sound; the results in api.json) and
// Smoke: Voice Lines (a quest's two lines; voiceLines.json when the panel closes). Smoke: New Empty Sound
// runs Create a Sound with a known path (the real command asks with a save dialog).
const vscode = require("vscode");
const path = require("path");
const T = path.resolve(__dirname, "..");
function tone(seconds, rate, ch, hz = 440) {
  const n = Math.round(seconds * rate), data = n * ch * 2, b = Buffer.alloc(44 + data);
  b.write("RIFF", 0); b.writeUInt32LE(36 + data, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(ch, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * ch * 2, 28); b.writeUInt16LE(ch * 2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(data, 40);
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) b.writeInt16LE(Math.round(0.5 * 32767 * Math.sin(2 * Math.PI * hz * i / rate)), 44 + (i * ch + c) * 2);
  return b;
}
const cn = (s) => ({ $type: "CName", $storage: "string", $value: s });
const metaEvent = (name, wwiseId, tags, loop = 0) => ({ $type: "audioAudioEventMetadataArrayElement", isLooping: loop, minDuration: 1, maxDuration: 2, redId: cn(name), tags: tags.map(cn), wwiseId });
const metadata = { Data: { RootChunk: { $type: "JsonResource", root: { Data: { $type: "audioAudioEventArray", events: [
  metaEvent("smoke_event", 7, ["sfx_quest_events"]), metaEvent("smoke_second", 8, ["smoke"]), metaEvent("mus_smoke_01_START", 9, ["music_quests_events", "quest_music_start"], 1),
] } } } } };
const file = (name, size) => ({ hash: "1", name, size, archive: "lang_en_voice.archive" });
const tree = {
  "base\\localization": { folders: [{ name: "de-de", path: "base\\localization\\de-de", files: 1 }, { name: "en-us", path: "base\\localization\\en-us", files: 3 }], files: [] },
  "base\\localization\\de-de": { folders: [{ name: "subtitles", path: "base\\localization\\de-de\\subtitles", files: 1 }], files: [] },
  "base\\localization\\en-us": { folders: [{ name: "subtitles", path: "base\\localization\\en-us\\subtitles", files: 1 }, { name: "vo", path: "base\\localization\\en-us\\vo", files: 2 }], files: [] },
  "base\\localization\\en-us\\vo": { folders: [], files: [file("base\\localization\\en-us\\vo\\judy_smoke_f_000000000000002a.wem", 41000), file("base\\localization\\en-us\\vo\\v_smoke_m_112210f47de98115.wem", 30000)] },
  "ep1\\localization": { folders: [], files: [] },
  "base\\sound\\soundbanks\\media": { folders: [], files: [file("base\\sound\\soundbanks\\media\\61753991.wem", 167751), { ...file("base\\sound\\soundbanks\\media\\init.bnk", 1), archive: "audio_2_soundbanks.archive" }] },
};
exports.activate = (context) => {
  const fs = require("fs");
  const p = path.join(T, "proj");
  const edgewave = async () => { const e = vscode.extensions.getExtension("edgemodders.edgewave"); return e.isActive ? e.exports : e.activate(); };
  context.subscriptions.push(
    vscode.commands.registerCommand("smoke.api", async () => {
      const api = await edgewave();
      const out = { apiVersion: api.apiVersion };
      try {
        out.events = await api.soundEvents({ query: "smoke" });
        out.music = await api.soundEvents({ music: true });
        out.play = await api.playEvent({ name: "smoke_event" });
        out.playMusic = await api.playEvent({ name: "mus_smoke_01_START" });
        fs.writeFileSync(path.join(T, "knock.wav"), tone(0.5, 24000, 1, 300));
        out.custom = await api.customSound({ wav: path.join(T, "knock.wav"), name: "Smoke Knock" });
        out.status = await api.voiceStatus("smoke_quest");
      } catch (e) { out.error = e.message; }
      fs.writeFileSync(path.join(T, "api.json"), JSON.stringify(out, null, 2));
    }),
    vscode.commands.registerCommand("smoke.voiceLines", async () => {
      const api = await edgewave();
      const lines = [
        { id: "1234567890123456789", scene: "at_the_door", speaker: "V", text: "Open up." },
        { id: "42", scene: "at_the_door", speaker: "Judy", text: "You came back.", say: "[softly] You... came back.", direction: "Quiet, surprised." },
      ];
      const r = await api.voiceLines({ quest: "smoke_quest", lines, archiveDir: "mod/smoke/smoke_quest/vo" });
      fs.writeFileSync(path.join(T, "voiceLines.json"), JSON.stringify(r, null, 2));
    }),
    // Create a Sound at a known path (the real command asks with a save dialog).
    vscode.commands.registerCommand("smoke.newSound", () => vscode.commands.executeCommand("edgewave.newSound", path.join(p, "source", "raw", "edgewave", "sounds", "Smoke New.edgewave"))),
  );
  const api = {
    apiVersion: 1, version: "0.9.0-stub", gamePath: () => path.join(T, "game"),
    bridge: () => ({
      toJson: async (gamePath, outFile) => { require("fs").writeFileSync(outFile, JSON.stringify(metadata)); return { file: outFile, bytes: 1 }; },
      // A few made-up game files for EDGEwave's Game Assets: English voice lines (German has subtitles only) and a streamed sound.
      tree: async (p = "") => {
        const t = tree[p.toLowerCase()];
        if (!t) throw new Error(`'${p}' is not a folder in the loaded archives`);
        return { path: p, folders: t.folders, files: t.files };
      },
      search: async (q, limit = 200) => {
        const all = Object.values(tree).flatMap((t) => t.files).filter((f) => f.name.toLowerCase().includes(q.toLowerCase()));
        return { total: all.length, items: all.slice(0, limit) };
      },
    }),
    project: () => ({ name: "Smoke", modName: "Smoke", file: path.join(p, "Smoke.cpmodproj"), dir: p, archive: path.join(p, "source", "archive"), raw: path.join(p, "source", "raw"), resources: path.join(p, "source", "resources"), packed: path.join(p, "packed") }),
    onDidChangeProject: new vscode.EventEmitter().event,
    soundIndex: async () => ({ count: 3, events: [{ hash: 7, name: "smoke_event", tags: [], sounds: [42] }, { hash: 8, name: "smoke_second", tags: ["smoke"], sounds: [43, 44] }] }),
    sound: async (ref) => {
      // A game file (the Game Assets' voice lines): a 1 s mono tone, as REDcode serves a .wem decoded.
      if (ref.path) return { data: tone(1, 48000, 1, 500), mime: "audio/wav", codec: "Vorbis", channels: 1, sampleRate: 48000, name: ref.path.split("\\").pop() };
      const s = { 42: [2, 2, 440], 43: [1.5, 1, 660], 44: [0.5, 1, 880] }[ref.soundHash];
      if (!s) throw new Error("no such sound");
      return { data: tone(s[0], 48000, s[1], s[2]), mime: "audio/wav", codec: "PCM", channels: s[1], sampleRate: 48000, name: `${ref.soundHash}.wav` };
    },
    // Records what EDGEwave imports (Add to Project's override), as REDcode's Import would take it.
    importFile: async (file) => {
      require("fs").writeFileSync(path.join(T, "imported.json"), JSON.stringify({ file }));
      return { ok: true, written: [path.join(p, "source", "archive", "base", "sound", "soundbanks", "sfx_container_1.opuspak")] };
    },
    pack: async () => ({ packedDir: path.join(p, "packed"), archiveFiles: 0 }),
  };
  setTimeout(() => vscode.commands.executeCommand("edgewave.openSound", { soundHash: 42, eventHash: 7 }), 3000);
  return api;
};
