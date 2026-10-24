// Bundles the extension (CommonJS, VS Code's module loader), the editor and Voice Lines pages (browser
// scripts) and the MCP server. `node esbuild.mjs --watch` rebuilds on change; `--tests` bundles test/*.test.ts for
// `node --test "dist-test/*.test.cjs"`; `--production` (vsce's prepublish) minifies, with no source maps.
import * as esbuild from "esbuild";
import * as fs from "node:fs";

const watch = process.argv.includes("--watch");
const tests = process.argv.includes("--tests");
const production = process.argv.includes("--production");

const common = { bundle: true, sourcemap: !production, minify: production, logLevel: "info" };

const extension = {
  ...common,
  platform: "node",
  format: "cjs",
  target: "node18",
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  external: ["vscode"],
};

const page = {
  ...common,
  platform: "browser",
  format: "iife",
  target: "es2022",
  entryPoints: ["webview/editor.ts"],
  outfile: "dist/editor.js",
};

const voiceLinesPage = { ...page, entryPoints: ["webview/voiceLines.ts"], outfile: "dist/voiceLines.js" };

// The MCP server for assistants: one file, run by Node 20 (or VS Code's binary as Node); src/mcp.ts installs it.
const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const mcp = {
  ...common,
  platform: "node",
  format: "cjs",
  target: "node20",
  entryPoints: ["src/mcp/server.ts"],
  outfile: "dist/mcp/edgewave-mcp.cjs",
  define: { __VERSION__: JSON.stringify(version) },
};

const testBuild = {
  ...common,
  platform: "node",
  format: "cjs",
  target: "node18",
  entryPoints: fs.readdirSync("test").filter((f) => f.endsWith(".test.ts")).map((f) => `test/${f}`),
  outdir: "dist-test",
  outExtension: { ".js": ".cjs" },
  logLevel: "warning",
};

if (tests) await esbuild.build(testBuild);
else if (watch) await Promise.all([extension, page, voiceLinesPage, mcp].map(async (o) => (await esbuild.context(o)).watch()));
else await Promise.all([extension, page, voiceLinesPage, mcp].map((o) => esbuild.build(o)));
