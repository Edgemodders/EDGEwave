// A stand-in for REDcode's API version 1 (edgemodders.redcode-cyberpunk) for tools/smoke/smoke.mjs:
// a project in the smoke folder and two sound effect events: smoke_event (sound 42, a 2 s 440 Hz stereo
// tone) and smoke_second (sounds 43, 1.5 s at 660 Hz, and 44, 0.5 s at 880 Hz, both mono).
// Opens sound 42 in EDGEwave three seconds after startup.
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
exports.activate = () => {
  const p = path.join(T, "proj");
  const api = {
    apiVersion: 1, version: "0.9.0-stub", bridge: () => undefined, gamePath: () => undefined,
    project: () => ({ name: "Smoke", modName: "Smoke", file: path.join(p, "Smoke.cpmodproj"), dir: p, archive: path.join(p, "source", "archive"), raw: path.join(p, "source", "raw"), resources: path.join(p, "source", "resources"), packed: path.join(p, "packed") }),
    onDidChangeProject: new vscode.EventEmitter().event,
    soundIndex: async () => ({ count: 3, events: [{ hash: 7, name: "smoke_event", tags: [], sounds: [42] }, { hash: 8, name: "smoke_second", tags: ["smoke"], sounds: [43, 44] }] }),
    sound: async (ref) => {
      const s = { 42: [2, 2, 440], 43: [1.5, 1, 660], 44: [0.5, 1, 880] }[ref.soundHash];
      if (!s) throw new Error("no such sound");
      return { data: tone(s[0], 48000, s[1], s[2]), mime: "audio/wav", codec: "PCM", channels: s[1], sampleRate: 48000, name: `${ref.soundHash}.wav` };
    },
    // Records what EDGEwave imports (Into the Game's override), as REDcode's Import would take it.
    importFile: async (file) => {
      require("fs").writeFileSync(path.join(T, "imported.json"), JSON.stringify({ file }));
      return { ok: true, written: [path.join(p, "source", "archive", "base", "sound", "soundbanks", "sfx_container_1.opuspak")] };
    },
    pack: async () => ({ packedDir: path.join(p, "packed"), archiveFiles: 0 }),
  };
  setTimeout(() => vscode.commands.executeCommand("edgewave.openSound", { soundHash: 42, eventHash: 7 }), 3000);
  return api;
};
