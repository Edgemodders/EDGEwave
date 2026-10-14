// Bundles the extension (CommonJS, VS Code's module loader).
// `node esbuild.mjs --watch` rebuilds on change.
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const extension = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  sourcemap: true,
  logLevel: "info",
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  external: ["vscode"],
};

if (watch) await (await esbuild.context(extension)).watch();
else await esbuild.build(extension);
