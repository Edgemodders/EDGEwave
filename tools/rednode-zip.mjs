// Builds EDGEwave Voice's download, a game mod beside the extension on each GitHub release:
// dist/edgewave-voice-<version>.zip with red4ext/plugins/REDnode/apps/edgewave-voice/, so a mod manager or
// an unzip into the game folder puts it where REDnode finds it. Run after a build (npm run build, or the
// vsix's prepublish), which puts the package together in dist/rednode/edgewave-voice.
//   node tools/rednode-zip.mjs
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const built = path.join(root, "dist", "rednode", "edgewave-voice");
if (!fs.existsSync(path.join(built, "core.mjs"))) throw new Error(`${built} has no core.mjs: build first (npm run build)`);
const { version } = JSON.parse(fs.readFileSync(path.join(built, "rednode-app.json"), "utf8"));
const stage = path.join(root, "dist", "rednode-zip");
const zip = path.join(root, "dist", `edgewave-voice-${version}.zip`);

fs.rmSync(stage, { recursive: true, force: true });
fs.rmSync(zip, { force: true });
const into = path.join(stage, "red4ext", "plugins", "REDnode", "apps", "edgewave-voice");
fs.mkdirSync(into, { recursive: true });
// The player's voices.json and cache are never shipped.
for (const f of fs.readdirSync(built)) if (f !== "voices.json" && !f.startsWith(".")) fs.copyFileSync(path.join(built, f), path.join(into, f));
fs.copyFileSync(path.join(root, "LICENSE"), path.join(into, "LICENSE.txt"));

// Windows' own tar writes zip files (-a picks the format from the name); Git's tar does not.
const tar = process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "zip";
const packed = process.platform === "win32" ? spawnSync(tar, ["-a", "-c", "-f", zip, "red4ext"], { cwd: stage, stdio: "inherit" }) : spawnSync("zip", ["-r", "-q", zip, "red4ext"], { cwd: stage, stdio: "inherit" });
if (packed.status !== 0) throw new Error("Zipping failed");
fs.rmSync(stage, { recursive: true, force: true });
console.log(`Packed: ${zip}`);
