# Release

How a version of EDGEwave goes out: to the VS Code Marketplace and Open VSX by the **Publish** workflow, run by hand from the Actions tab as REDnode's Release workflow is, and to Nexus Mods by hand. The first release is 0.1.0, as a preview (`"preview": true` in `package.json`).

## What ships

| Where | What | Made by |
|---|---|---|
| VS Code Marketplace | `edgemodders.edgewave`, which installs `edgemodders.redcode-cyberpunk` with it | `vsce publish` in the workflow (`VSCE_PAT`) |
| Open VSX | `edgemodders/edgewave` | `ovsx publish` in the workflow (`OVSX_PAT`) |
| GitHub release `v<version>` | The `.vsix`, the Nexus zip, `edgewave-voice-<version>.zip` (EDGEwave Voice, a REDnode package: a game mod, its own version) and the version's CHANGELOG section; it tags the commit | `gh release create` in the workflow; the package zip by `tools/rednode-zip.mjs` |
| Nexus Mods, [page 35493](https://www.nexusmods.com/cyberpunk2077/mods/35493) | The main file `EDGEwave-<version>-nexus.zip` (the `.vsix`, `README.txt`, `LICENSE.txt`; Mod Manager Download off), the optional file `edgewave-voice-<version>.zip` (Mod Manager Download on), the changelog and the description | `tools/nexus-zip.mjs`; the workflow's **Update Nexus Mods** (`tools/nexus/nexus.mjs`, the org's `NEXUS_KEY`), added 2026-10-27 ([nexus/README.md](https://github.com/Edgemodders/EDGEwave/blob/main/nexus/README.md)) |

The `.vsix` is one file for every platform: EDGEwave has no native parts and no runtime dependencies. It holds the two bundles in `dist/` (minified, no source maps: `node esbuild.mjs --production`, vsce's prepublish), `media/editor.css`, the icons, the Marketplace README (`README.marketplace.md`, through `--readme-path`), the CHANGELOG and the LICENSE; `.vscodeignore` leaves out the rest. The repo's own `README.md` stays the GitHub page.

## Steps

**0.3.0 is released with the other key tools** (the owner's rule, 2026-11-19, in REDcode's `docs/design/keys.md`, Releases): EDGEwave reads the ElevenLabs key from REDcode's key store (#12). Its pilot passed on 2026-11-21. Next, K4d moves EDGEhack, EDGEmat and EDGEfab to the key API, and then every key-using tool is released at once, REDcode included, unless the owner decides otherwise.

1. **Tests.** Every phase in the release has passed its hand test ([Tests](testing.html)); `npm run typecheck`, `npm test` and `npm run smoke` pass.
2. **Version.** Set `version` in `package.json` (and `npm install`, so `package-lock.json` follows). In `CHANGELOG.md`, rename **Unreleased** to `## <version> (<date>)` and start a new empty **Unreleased** above it: the workflow fails without the version's section, and puts it in the GitHub release (`npm run release:notes` prints what it will say).
3. **Package and test the package.**
   ```powershell
   npm run package      # edgewave-<version>.vsix in the repo folder
   npm run vsix-test    # a clean VS Code: installs it, and REDcode from the Marketplace; opens, renders, Add to Project
   npm run nexus-zip    # dist/EDGEwave-<version>-nexus.zip
   npm run rednode-zip  # dist/edgewave-voice-<version>.zip, EDGEwave Voice for REDnode (its version is in rednode/edgewave-voice/rednode-app.json)
   ```
4. **Commit and push** to `main`.
5. **Publish** (the owner): Actions > **Publish** > **Run workflow** on `main`.
   - Unticked, it checks, tests and packages, and keeps the `.vsix` and the Nexus zip as the run's artifact. Nothing is published: a dry run.
   - With **Make a release** ticked, it also publishes to the Marketplace and Open VSX and makes the GitHub release `v<version>`, which tags the commit. It stops first if that tag exists (raise the version) or `CHANGELOG.md` has no section for the version.
   - With **Update Nexus Mods** ticked too, it first checks the Nexus page (`nexus.mjs check`), before anything is published, and stops if the description changed on Nexus since the last pull, or if the changelog section has no short Nexus summary (`<!-- nexus` ... `-->`, see the top of `CHANGELOG.md`). After the GitHub release it uploads the Nexus zip as the main file's new version (the old one archived), EDGEwave Voice's zip when its version is new (its own version, in `rednode/edgewave-voice/rednode-app.json`), adds the version's changelog (`release:notes --nexus`), and pushes `nexus/description.bbcode` when it differs.
6. **Nexus, before the run:** `npm run nexus:status` on the dev PC (the key in `%APPDATA%\Edgemodders\nexus-key.txt`, see EDGErepo's `tools/nexus/api.mjs`; the Nexus commands need [EDGErepo](https://github.com/Edgemodders/EDGErepo) checked out beside this repo). If the description changed on Nexus, `npm run nexus:pull`, merge the repo's changes back in (`git diff nexus/`), and commit. `node ../EDGErepo/tools/nexus/nexus.mjs check --version <v> --file voice=<voice version>` says what the release will do. If the Nexus step fails after the other stores, run `node ../EDGErepo/tools/nexus/nexus.mjs release` on the dev PC with the workflow's arguments.
7. **After:** the README's and the Nexus page's status, and `docs/` where a page says what is released.
8. **The wiki, in EDGEweb** (added 2026-11-21: no release step did it, and EDGEweb's session did 0.2.0's on 2026-11-13). In the sibling checkout `../EDGEweb`, bring every page that tells a modder about EDGEwave up to the version, from its changelog section: `docs/wiki/edgewave/*.md`, EDGEwave's rows in `docs/wiki/library.md` and the glossary, and the EDGEwave card on `docs/index.html` and section on `docs/platform.html`. Set each changed page's `reviewed` date, and EDGEwave's dashboard entry (`docs/assets/dashboard/status.js`, see `CLAUDE.md`, Dashboard). The wiki describes what is released, not `main`: change it with the release, never before. Commit and push to EDGEweb's `main`.

### For the next release's wiki

What 0.3.0's step 8 needs, kept here as it is built, so none of it is forgotten:

| Change on `main` | Wiki pages |
|---|---|
| The Sounds view is the **Desk**; a new **Project** view (Mixes, Project sounds read from the project's files, ▶ on every row); the **Library** view ([Desk, Project and Library](desk-library.html)) | `finding.md` (The Sounds view), `install.md` (the views), `settings.md` (the Sounds view's commands), `troubleshooting.md` (Project empty), `tutorial.md` and screenshots that show the Sounds view; `wiki/library.md` (EDGEwave's Desk and sound items, no longer planned) |
| No game audio goes to ElevenLabs: Speak Line in a line's voice, Re-Voice and its remix take only your own recordings and files | `voices.md` (Voice clones), `voice-lines.md` (a cloned game voice), `troubleshooting.md` (clones), the glossary's Voice clone |
| **EDGEwave: Character Voices…**, a voice designed from a description, and speaking a line with timings for other tools (EDGEfab's Lip Sync) | `voices.md`, `assistants.md` (`voice_speak_line`), `settings.md` (the command) |
| Voice Lines keeps `<take>.timings.json` beside each take | `voice-lines.md` |
| The ElevenLabs key lives in REDcode's Keys, shared by every EDGE tool; a one-time move; Connect an Assistant no longer gives the client the key (#12). Only once REDcode's release with Keys is out | `voices.md` and `install.md` (the key), `assistants.md` (Connect, no key in the client), `settings.md` (Set and Clear ElevenLabs API Key), `troubleshooting.md` (a refused or missing key, Don't Allow); `wiki/glossary.md` if it has the key store |

## The packaged test

`tools/vsix-test.mjs` (`npm run vsix-test`) checks the `.vsix` as a modder gets it, in a clean VS Code profile (the VS Code the smoke test downloaded):

| Check | Expected |
|---|---|
| `--install-extension edgewave-<version>.vsix` | EDGEwave and REDcode for Cyberpunk 2077 installed (REDcode from the Marketplace, as the dependency) |
| Quick Open (Ctrl+P) of a `.edgewave` document on a generated tone | The EDGEwave editor opens it and loads the tone |
| Render WAV | The WAV next to the document |
| Add to Project…, with no REDcode project open | EDGEwave reaches REDcode's API, which has no project: "Open a REDcode project first" |

It needs the network (the Marketplace). Found while writing it: a `.edgewave` passed on the command line to a brand-new profile opens as JSON text, since VS Code opens it before it has read the extensions' editors; opened from the Explorer, Quick Open, the Sounds view or REDcode, it gets the EDGEwave editor.

## Releases

| Version | Date | Notes |
|---|---|---|
| 0.1.0 | 2026-10-20 | The first release: A1 Edit, A2 Mix, A3 Into the game, V1 Voice tools. Needs REDcode 0.10.0. On the [Marketplace](https://marketplace.visualstudio.com/items?itemName=edgemodders.edgewave), [Open VSX](https://open-vsx.org/extension/edgemodders/edgewave) and [GitHub](https://github.com/Edgemodders/EDGEwave/releases/tag/v0.1.0); Nexus by hand |
| 0.2.0 | 2026-11-07 | Game Assets, Create a Sound, Add to Project's new sound and REDnode package routes, V2 (Voice Lines, sound events, the API and MCP server for EDGEquest), and EDGEwave Voice for REDnode 0.1.0 as Nexus's optional file. Needs REDcode 0.10.3. Every store by the Publish run ([run 42365914740](https://github.com/Edgemodders/EDGEwave/actions/runs/42365914740)): the Marketplace, Open VSX, [GitHub](https://github.com/Edgemodders/EDGEwave/releases/tag/v0.2.0) and Nexus |
| 0.3.0 | 2026-11-22 | The joint key release with REDcode 0.10.16 and the other key tools: the Desk, the Project view and the Library, Character Voices, `speakLine` with timings (#13), the ElevenLabs key in REDcode's Keys (#12, #14), no game audio to ElevenLabs. Needs REDcode 0.10.3, 0.10.16 for the shared keys. The Publish run ([run 45083033980](https://github.com/Edgemodders/EDGEwave/actions/runs/45083033980)) published the Marketplace, Open VSX and [GitHub](https://github.com/Edgemodders/EDGEwave/releases/tag/v0.3.0), then stopped at Nexus: EDGErepo's Nexus tool now takes a short summary (its README, Nexus changelogs; the owner's rule of 2026-11-18), and the changelog section was not one. The summary is now kept in the section (`<!-- nexus` ... `-->`), checked before anything is published; Nexus was done from the dev PC with the release's own zips (`nexus.mjs release`), then the description for 0.3.0 and `nexus:pull -- --ids-only`. EDGEwave Voice stays 0.1.0 |
