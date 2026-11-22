// Prints the release notes for one version from its section of CHANGELOG.md. The Publish workflow
// uses it for the GitHub release, and stops when the version has no section.
//
//   node tools/release-notes.mjs [version]            markdown for GitHub
//   node tools/release-notes.mjs [version] --nexus    the section's Nexus summary, "<!-- nexus" ... "-->"
//   --out <file>                                      writes the notes to a file (UTF-8)
//
// The version defaults to package.json's.
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const nexus = args.includes("--nexus");
const outAt = args.indexOf("--out");
const out = outAt >= 0 ? args.splice(outAt, 2)[1] : null;
const version = args.find((a) => !a.startsWith("--")) ?? JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const lines = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8").split(/\r?\n/);

// "## 0.1.0" or "## 0.1.0 (2026-10-20)"
const heading = new RegExp(`^## ${version.replace(/\./g, "\\.")}(\\s|$)`);
const start = lines.findIndex((line) => heading.test(line));
if (start < 0) {
  console.error(`CHANGELOG.md has no section for ${version}: rename Unreleased to "## ${version} (date)" first`);
  process.exit(1);
}
let end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
if (end < 0) end = lines.length;
let section = lines.slice(start + 1, end);
if (!section.some((line) => line.trim())) {
  console.error(`CHANGELOG.md: the section for ${version} is empty`);
  process.exit(1);
}

// Nexus's changelog is a short summary written by hand (EDGErepo's README, "Nexus changelogs": one
// plain line per change, at most 120 characters, "Full changelog: <link>" last), kept in the section
// as an HTML comment that GitHub, the stores and Pages hide: "<!-- nexus" ... "-->".
const open = section.findIndex((line) => line.trim() === "<!-- nexus");
const close = open < 0 ? -1 : section.findIndex((line, i) => i > open && line.trim() === "-->");
if (open >= 0 && close < 0) {
  console.error(`CHANGELOG.md: the section for ${version} has "<!-- nexus" with no "-->"`);
  process.exit(1);
}
const summary = open < 0 ? [] : section.slice(open + 1, close).map((line) => line.trim()).filter(Boolean);
if (open >= 0) section = [...section.slice(0, open), ...section.slice(close + 1)];

if (nexus) {
  if (!summary.length) {
    console.error(`CHANGELOG.md: the section for ${version} has no Nexus summary. Under its heading add "<!-- nexus", one short plain line per change ("New: ...", at most 120 characters), "Full changelog: <link>", then "-->"`);
    process.exit(1);
  }
  write(summary.join("\n"));
} else {
  write(`${section.join("\n").trim()}

**Install:** from the VS Code Marketplace or Open VSX (search for EDGEwave), which add REDcode for Cyberpunk 2077 with it, or the \`.vsix\` below with Extensions > ... > Install from VSIX... Docs: https://edgemodders.github.io/EDGEwave/ (changelog: https://github.com/Edgemodders/EDGEwave/blob/main/CHANGELOG.md)`);
}

function write(text) {
  if (out) fs.writeFileSync(out, text + "\n", "utf8");
  else console.log(text);
}
