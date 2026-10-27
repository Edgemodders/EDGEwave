# Release

How a version of EDGEwave goes out: to the VS Code Marketplace and Open VSX by the **Publish** workflow, run by hand from the Actions tab as REDnode's Release workflow is, and to Nexus Mods by hand. The first release is 0.1.0, as a preview (`"preview": true` in `package.json`).

## What ships

| Where | What | Made by |
|---|---|---|
| VS Code Marketplace | `edgemodders.edgewave`, which installs `edgemodders.redcode-cyberpunk` with it | `vsce publish` in the workflow (`VSCE_PAT`) |
| Open VSX | `edgemodders/edgewave` | `ovsx publish` in the workflow (`OVSX_PAT`) |
| GitHub release `v<version>` | The `.vsix`, the Nexus zip, `edgewave-voice-<version>.zip` (EDGEwave Voice, a REDnode package: a game mod, its own version) and the version's CHANGELOG section; it tags the commit | `gh release create` in the workflow; the package zip by `tools/rednode-zip.mjs` |
| Nexus Mods | `EDGEwave-<version>-nexus.zip`: the `.vsix`, `README.txt`, `LICENSE.txt` | `tools/nexus-zip.mjs`; uploaded by hand ([nexus/README.md](https://github.com/Edgemodders/EDGEwave/blob/main/nexus/README.md)) |

The `.vsix` is one file for every platform: EDGEwave has no native parts and no runtime dependencies. It holds the two bundles in `dist/` (minified, no source maps: `node esbuild.mjs --production`, vsce's prepublish), `media/editor.css`, the icons, the Marketplace README (`README.marketplace.md`, through `--readme-path`), the CHANGELOG and the LICENSE; `.vscodeignore` leaves out the rest. The repo's own `README.md` stays the GitHub page.

## Steps

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
6. **Nexus** (the owner): upload the release's Nexus zip as the main file, with **Mod Manager Download** off; paste `npm run release:notes -- --nexus` into the version's changelog; update the description from `nexus/description.bbcode` ([nexus/README.md](https://github.com/Edgemodders/EDGEwave/blob/main/nexus/README.md)).
7. **After:** the README's and the Nexus page's status, and `docs/` where a page says what is released.

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
