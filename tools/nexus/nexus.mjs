// Keeps EDGEwave's Nexus Mods page in step with its repo, through Nexus's v3 API (tools/nexus/api.mjs).
// Copied from REDnode's tools/nexus/nexus.mjs (2026-10-27) and extended for a second file: EDGEwave Voice for
// REDnode, a game mod with its own version, beside the extension's zip on the same page.
//
//   node tools/nexus/nexus.mjs pull   [dir] [--ids-only]
//         the live description into <dir>/description.bbcode, the ids into <dir>/nexus.json; with --ids-only,
//         the ids and the live description's hash only, keeping the repo's description (it may then replace
//         the live one at the next release)
//   node tools/nexus/nexus.mjs status [dir]   the page's version and files, and whether its description matches
//   node tools/nexus/nexus.mjs check  [dir] --version <v> [--file <key>=<version>]...
//         what a release would do, and whether it may: stops when the description changed on Nexus
//   node tools/nexus/nexus.mjs release [dir] --version <v> --zip <file> [--notes <file>]
//         [--file <key>=<zip>@<version>]... [--dry-run]
//         uploads the zip as the main file's new version (the old one archived), or as the main file itself
//         on a page with no files yet; each --file the same for nexus.json's "files" entry <key> (created on
//         its first release); adds the version's changelog, and pushes description.bbcode when it differs
//
// <dir> is the folder with nexus.json (default: nexus). nexus.json names the page ("page"), how the main file
// is uploaded ("upload"), and other files ("files": { key: upload settings }). Each file is found by its id
// in nexus.json ("file", or files.<key>.file, which pull fills in), else by its name on the page.
//
// The description is pushed only when the live one is what the repo last saw: the one pulled (nexus.json's
// hash) or the one the previous release pushed (description.bbcode at the previous v* tag). Anything else is
// an edit made on Nexus since, and the release stops before it uploads anything, so that edit is never
// overwritten: pull, merge, commit, and run it again.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { api, modByPage, uploadArchive } from './api.mjs';

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const options = (name) => args.flatMap((a, i) => (a === `--${name}` && args[i + 1] !== undefined ? [args[i + 1]] : []));
const valued = ['--version', '--zip', '--notes', '--file'];
const values = new Set(args.flatMap((a, i) => (valued.includes(a) ? [args[i + 1]] : [])));
const [cmd, dirArg = 'nexus'] = args.filter((a) => !a.startsWith('--') && !values.has(a));
const dryRun = args.includes('--dry-run');
const dir = resolve(dirArg);
const configFile = join(dir, 'nexus.json');
const descFile = join(dir, 'description.bbcode');

// Nexus stores a description with an HTML <br /> on each line and some characters as entities
// (&gt;, &#92; for a backslash). fromNexus turns that back into the plain BBCode the repo keeps,
// with LF line ends; a push sends plain BBCode and Nexus adds its markup again.
const lf = (s) => s.replace(/\r\n/g, '\n');
const ENTITIES = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
const fromNexus = (s) =>
  lf(s ?? '')
    .replace(/\n?<br\s*\/?>/g, '\n')
    .replace(/&(#\d+|#x[0-9a-f]+|lt|gt|quot|apos|amp);/gi, (m, e) =>
      e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()],
    );
// The hash ignores whitespace: Nexus drops the newline after a block such as [/list] or [/quote],
// so a pushed description comes back with the same text but not the same line breaks.
const sha = (s) => createHash('sha256').update(s.replace(/\s+/g, '')).digest('hex');
const readConfig = () => JSON.parse(readFileSync(configFile, 'utf8'));
const repoDescription = () => lf(readFileSync(descFile, 'utf8'));

/** A file on the page and its versions: by its id, else by its name among the active files; null when there is none yet. */
async function findFile(modId, up, id) {
  if (id) return { file: { id: String(id) }, versions: (await api('GET', `/mod-files/${id}/versions`)).versions };
  const { mod_files: files } = await api('GET', `/mods/${modId}/files`);
  const named = files.filter((f) => f.is_active && f.name === up.name);
  if (named.length > 1) throw new Error(`More than one active file named "${up.name}" on the page: set its id in nexus.json`);
  if (!named.length) return { file: null, versions: [] };
  return { file: named[0], versions: (await api('GET', `/mod-files/${named[0].id}/versions`)).versions };
}

/** The files to release: the main one, then each --file, with its settings, archive and version. */
function targets(config, version, zip) {
  const list = [{ key: 'main', up: config.upload, id: config.file, version, zip }];
  for (const spec of options('file')) {
    // key=zip@version (release) or key=version (check)
    const m = /^([a-z0-9_-]+)=(?:(.+)@)?([^@]+)$/i.exec(spec);
    if (!m) throw new Error(`--file ${spec}: expected <key>=<zip>@<version>, or <key>=<version> for check`);
    const up = config.files?.[m[1]];
    if (!up) throw new Error(`--file ${m[1]}: nexus.json has no files.${m[1]}`);
    list.push({ key: m[1], up, id: up.file, version: m[3], zip: m[2] });
  }
  return list;
}

/** description.bbcode as the previous release (the newest v* tag that is not this version; any, with no version) had it, or null. */
function previousReleaseDescription(version) {
  try {
    const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const top = git('rev-parse', '--show-toplevel');
    const tag = git('tag', '--list', 'v*', '--sort=-v:refname').split('\n').find((t) => t && t !== `v${version}`);
    if (!tag) return null;
    return { tag, text: git('show', `${tag}:${relative(top, descFile).replace(/\\/g, '/')}`) };
  } catch {
    return null; // no git, no tag, or the file was not there then
  }
}

/** Whether the description may be pushed, and whether it needs to be. Throws when Nexus has an edit the repo has not seen. */
function descriptionPlan(mod, config, version) {
  const live = sha(fromNexus(mod.description));
  const repo = sha(repoDescription());
  if (live === repo) return { push: false, why: 'the repo and Nexus have the same description' };
  if (live === config.pulled?.sha256) return { push: true, why: 'the live description is the one last pulled' };
  const prev = previousReleaseDescription(version);
  if (prev && live === sha(prev.text)) return { push: true, why: `the live description is the one ${prev.tag} pushed` };
  throw new Error(
    'The description on Nexus has changed since the last pull and the last release, so pushing would lose that edit. ' +
      `Run npm run nexus:pull (or with --ids-only to keep the repo's), check the diff, commit, and run again.`,
  );
}

async function pull() {
  const config = readConfig();
  const mod = await modByPage(config.page);
  const main = await findFile(mod.id, config.upload, config.file);
  const files = { ...(config.files ?? {}) };
  for (const [key, up] of Object.entries(files)) {
    const f = await findFile(mod.id, up, up.file);
    if (f.file) files[key] = { ...up, file: Number(f.file.id) };
  }
  const live = fromNexus(mod.description);
  const idsOnly = args.includes('--ids-only');
  if (!idsOnly) writeFileSync(descFile, live.endsWith('\n') ? live : live + '\n');
  const next = {
    ...config,
    mod: mod.id,
    ...(main.file ? { file: Number(main.file.id) } : {}),
    ...(Object.keys(files).length ? { files } : {}),
    pulled: { sha256: sha(live), at: new Date().toISOString(), version: mod.version },
  };
  writeFileSync(configFile, JSON.stringify(next, null, 2) + '\n');
  console.log(
    idsOnly
      ? `Pulled the ids of ${mod.name} (page ${config.page}, version ${mod.version}); kept the repo's description, which the next release pushes`
      : `Pulled ${mod.name} (page ${config.page}, version ${mod.version}): ${live.length} characters into ${descFile}`,
  );
}

async function status() {
  const config = readConfig();
  const mod = await modByPage(config.page);
  console.log(`${mod.name}: page ${config.page}, mod ${mod.id}, version ${mod.version}`);
  for (const [key, up, id] of [['main', config.upload, config.file], ...Object.entries(config.files ?? {}).map(([k, u]) => [k, u, u.file])]) {
    const { file, versions } = await findFile(mod.id, up, id);
    console.log(
      file
        ? `${key} file ${file.id} (${up.name}): ${versions.map((v) => `${v.version}${v.is_primary ? ' (primary)' : ''}${v.category !== 'main' ? ` (${v.category})` : ''}`).join(', ')}`
        : `${key} file (${up.name}): not on the page yet; the next release creates it`,
    );
  }
  const live = sha(fromNexus(mod.description));
  const prev = previousReleaseDescription();
  const seen =
    live === config.pulled?.sha256
      ? 'the one last pulled'
      : prev && live === sha(prev.text)
        ? `the one ${prev.tag} pushed`
        : 'CHANGED on Nexus since the last pull and the last release (pull before the next release)';
  console.log(`Description: live is ${seen}; repo ${sha(repoDescription()) === live ? 'same as live' : 'differs from live'}`);
}

/** Reads the page and says what a release would do; throws if it may not. */
async function plan(version, zip) {
  if (!version) throw new Error('--version is required');
  const config = readConfig();
  if (!config.upload) throw new Error(`nexus.json has no "upload" settings`);
  const mod = await modByPage(config.page);
  const description = descriptionPlan(mod, config, version);
  console.log(`${mod.name} on Nexus (page ${config.page}): version ${mod.version}`);
  const files = [];
  for (const t of targets(config, version, zip)) {
    const { file, versions } = await findFile(mod.id, t.up, t.id);
    const already = versions.find((v) => v.version === t.version);
    const previous = versions.find((v) => v.is_primary) ?? versions.filter((v) => v.category !== 'archived').at(-1) ?? null;
    const mm = `mod manager download ${t.up.modManager ? 'on' : 'off'}`;
    console.log(
      `${t.up.name}: ` +
        (already
          ? `${t.version} is already on Nexus (version ${already.id}); no upload`
          : !file
            ? `create the file with ${t.version}; ${mm}`
            : `upload ${t.version} as the file's new version${previous ? `, replacing ${previous.version}${t.up.archivePrevious ? ' (archived)' : ''}` : ''}; ${mm}`) +
        (t.key === 'main' && !already ? `; the page's version becomes ${t.version}` : ''),
    );
    files.push({ ...t, file, already, previous });
  }
  console.log(`Description: ${description.push ? 'push' : 'no push'} (${description.why})`);
  return { config, mod, files, description };
}

async function check() {
  await plan(option('version'));
}

async function release() {
  const version = option('version');
  const zip = option('zip');
  const notesFile = option('notes');
  if (!zip || !existsSync(zip)) throw new Error(`--zip must name the archive to upload (got ${zip})`);
  const p = await plan(version, zip);
  for (const f of p.files) if (!f.already && (!f.zip || !existsSync(f.zip))) throw new Error(`${f.up.name}: the archive ${f.zip} is missing`);
  if (dryRun) return console.log('Dry run: nothing changed on Nexus');

  for (const f of p.files) {
    if (f.already) continue;
    const up = f.up;
    const fields = {
      name: up.name,
      description: up.description ? up.description.replaceAll('{version}', f.version) : null,
      version: f.version,
      file_category: up.category ?? 'main',
      primary_mod_manager_download: !!up.primary,
      allow_mod_manager_download: !!up.modManager,
      // Only the main file sets the page's version (the extension's); another file has its own.
      update_mod_version: f.key === 'main',
    };
    const uploadId = await uploadArchive(f.zip);
    if (!f.file) {
      const created = await api('POST', '/mod-files', { upload_id: uploadId, mod_id: p.mod.id, ...fields });
      console.log(`Created the file ${up.name} (${created.id ?? created.mod_file?.id}) with ${f.version}`);
    } else {
      const created = await api('POST', `/mod-files/${f.file.id}/versions`, {
        upload_id: uploadId,
        ...fields,
        archive_existing_file: !!up.archivePrevious,
        previous_version_id: f.previous?.id ?? null,
      });
      console.log(`Made version ${f.version} of ${up.name} (file ${f.file.id}, version ${created.version?.id})`);
    }
  }

  if (!p.files[0].already) {
    // Changelogs only add: posted once, with the version it belongs to, so a rerun never doubles it.
    const notes = notesFile ? readFileSync(notesFile, 'utf8').trim() : '';
    if (notes) {
      await api('POST', `/mods/${p.mod.id}/changelogs`, { version, changelog: notes });
      console.log(`Added the changelog for ${version} (${notes.split('\n').length} lines)`);
    }
  }

  if (p.description.push) {
    await api('PATCH', `/mods/${p.mod.id}`, { description: repoDescription() });
    const after = await modByPage(p.config.page);
    const same = sha(fromNexus(after.description)) === sha(repoDescription());
    console.log(same ? 'Pushed the description' : 'Pushed the description, but Nexus answers with a different text: check the page');
  }
}

const commands = { pull, status, check, release };
if (!commands[cmd]) {
  console.error(
    'usage: node tools/nexus/nexus.mjs <pull|status|check|release> [dir] [--ids-only] [--version <v>] [--zip <file>] [--notes <file>] [--file <key>=<zip>@<version>] [--dry-run]',
  );
  process.exit(1);
}
await commands[cmd]().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
