# Release

How a version of EDGEwave goes out: to the VS Code Marketplace and Open VSX by the **Publish** workflow, and to Nexus Mods by hand. The first release is 0.1.0, as a preview (`"preview": true` in `package.json`).

## What ships

| Where | What | Made by |
|---|---|---|
| VS Code Marketplace | `edgemodders.edgewave`, which installs `edgemodders.redcode-cyberpunk` with it | `vsce publish` in the workflow (`VSCE_PAT`) |
| Open VSX | `edgemodders/edgewave` | `ovsx publish` in the workflow (`OVSX_PAT`) |
| GitHub release | The `.vsix`, the Nexus zip and the version's CHANGELOG section | `gh release create` in the workflow |
| Nexus Mods | `EDGEwave-<version>-nexus.zip`: the `.vsix`, `README.txt`, `LICENSE.txt` | `tools/nexus-zip.mjs`; uploaded by hand ([nexus/README.md](https://github.com/Edgemodders/EDGEwave/blob/main/nexus/README.md)) |

The `.vsix` is one file for every platform: EDGEwave has no native parts and no runtime dependencies. It holds the two bundles in `dist/` (minified, no source maps: `node esbuild.mjs --production`, vsce's prepublish), `media/editor.css`, the icons, the Marketplace README (`README.marketplace.md`, through `--readme-path`), the CHANGELOG and the LICENSE; `.vscodeignore` leaves out the rest. The repo's own `README.md` stays the GitHub page.

## Steps

1. **Tests.** Every phase in the release has passed its hand test ([Tests](testing.html)); `npm run typecheck`, `npm test` and `npm run smoke` pass.
2. **Version.** Set `version` in `package.json` (and `npm install`, so `package-lock.json` follows). Add a `## <version> (<date>)` section at the top of `CHANGELOG.md`: the workflow fails without one, and puts it in the GitHub release.
3. **Package and test the package.**
   ```powershell
   npm run package      # edgewave-<version>.vsix in the repo folder
   npm run vsix-test    # a clean VS Code: installs it, and REDcode from the Marketplace; opens, renders, Into the Game
   npm run nexus-zip    # dist/EDGEwave-<version>-nexus.zip
   ```
4. **Commit and push** to `main`.
5. **Tag** (the owner): `git tag v<version>` and `git push origin v<version>`. The **Publish** workflow checks that the tag matches `package.json` and has a CHANGELOG section, typechecks, tests, packages, publishes to both stores and makes the GitHub release.
6. **Nexus** (the owner): upload the release's Nexus zip as the main file, with **Mod Manager Download** off; update the description from `nexus/description.bbcode` ([nexus/README.md](https://github.com/Edgemodders/EDGEwave/blob/main/nexus/README.md)).
7. **After:** the README's and the Nexus page's status, and `docs/` where a page says what is released.

## The packaged test

`tools/vsix-test.mjs` (`npm run vsix-test`) checks the `.vsix` as a modder gets it, in a clean VS Code profile (the VS Code the smoke test downloaded):

| Check | Expected |
|---|---|
| `--install-extension edgewave-<version>.vsix` | EDGEwave and REDcode for Cyberpunk 2077 installed (REDcode from the Marketplace, as the dependency) |
| Quick Open (Ctrl+P) of a `.edgewave` document on a generated tone | The EDGEwave editor opens it and loads the tone |
| Render WAV | The WAV next to the document |
| Into the Game…, with no REDcode project open | EDGEwave reaches REDcode's API, which has no project: "Open a REDcode project first" |

It needs the network (the Marketplace). Found while writing it: a `.edgewave` passed on the command line to a brand-new profile opens as JSON text, since VS Code opens it before it has read the extensions' editors; opened from the Explorer, Quick Open, the Sounds view or REDcode, it gets the EDGEwave editor.

## Releases

| Version | Date | Notes |
|---|---|---|
| 0.1.0 | Not tagged yet | The first release: A1 Edit, A2 Mix, A3 Into the game, V1 Voice tools. Needs REDcode 0.10.0 |
