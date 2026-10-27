# EDGEwave on Nexus Mods

The source of EDGEwave's Nexus Mods page lives here, so updates are edits in the repo, not in Nexus's text box. It follows REDcode's and EDGEdeck's (their `nexus/` folders).

| File | What it is |
|---|---|
| `description.bbcode` | The page's description, in Nexus's BBCode. Paste the whole file into the description field (the editor's source mode, or switch to BBCode) |
| `README.md` | This page: the other fields of the Nexus form, the download file, and how to update |

## The Nexus form

| Field | Value |
|---|---|
| Mod name | EDGEwave |
| Version | EDGEwave's version, from `package.json` (the first release is planned as 0.1.0) |
| Category | Modders Resources and Tutorials, as REDcode (check the list for Cyberpunk 2077 when creating the page) |
| Brief overview | A sound studio for Cyberpunk 2077 modding in VS Code: open the game's sounds, edit, mix, add effects, make sounds and voices with ElevenLabs, and put them into your mod. Needs REDcode. A VS Code extension, not a game mod. (255 characters at most; this is 221) |
| Author | Edgemodders |
| Language | English |
| Primary image | `docs/assets/brand/social.png` (1280 x 640). The banner (`docs/assets/brand/banner.png`) is already at the top of the description |
| Requirements | On Nexus: REDcode for Cyberpunk 2077 (mod 35356). Off-site: VS Code 1.90 or later (or VSCodium, or EDGEkit); optional, an ElevenLabs account for the voice tools |
| Permissions | MIT: open source, free to modify and redistribute with the license notice |
| Tags | Modders resource, utility, tools, audio |

## The page and the release

The page is [35493](https://www.nexusmods.com/cyberpunk2077/mods/35493), first uploaded by hand (0.1.0, 2026-10-21). From 0.2.0 the Publish workflow's **Update Nexus Mods** box keeps it current ([Release](https://edgemodders.github.io/EDGEwave/release.html)), through `tools/nexus/nexus.mjs` (copied from REDnode's on 2026-10-27, extended for a second file) and the organisation's `NEXUS_KEY`.

| File | What it says |
|---|---|
| `nexus.json` | The page, the main file's upload settings (`upload`) and the optional file's (`files.voice`), the ids `pull` found, and the hash of the description last pulled |
| `description.bbcode` | The description. The release pushes it when it differs from the live one, but only when the live one is the one last pulled or the one the previous release pushed; otherwise it stops, so an edit made on Nexus is never lost |

| Command | Does |
|---|---|
| `npm run nexus:status` | The page's version, both files and their versions, and whether the description matches |
| `npm run nexus:pull` | The live description into `description.bbcode`, the ids into `nexus.json`. Then `git diff nexus/` and merge. With `-- --ids-only`, the ids and the live description's hash, keeping the repo's description |
| `node tools/nexus/nexus.mjs check --version <v> --file voice=<v>` | What a release would do, and whether it may |

Pulled 2026-10-27: the live page had the owner's six screenshots and the 0.1.0 text; the repo's text was merged with them (the screenshots stay on Nexus's own image host).

## The download

One main file: `EDGEwave-<version>-nexus.zip`, with:

| File | What it is |
|---|---|
| `edgewave-<version>.vsix` | The extension, the same file the Marketplace and Open VSX have |
| `README.txt` | How to install it: REDcode first, then Install from VSIX in VS Code, or `code --install-extension` |
| `LICENSE.txt` | EDGEwave's license |

**When uploading, turn off the Mod Manager Download button** for this file (Nexus's file form has the option). It is a VS Code extension: Vortex would deploy it into the game folder, where it does nothing.

File description on Nexus:

> EDGEwave &lt;version&gt;, the VS Code extension. Needs REDcode. Extract, then in VS Code: Extensions view, ..., Install from VSIX. Or install it from the Marketplace or Open VSX, which add REDcode and update themselves.

## Updating the page

1. Edit `description.bbcode` here, commit, push.
2. Check it: `node tools/check-bbcode.mjs nexus/description.bbcode`.
3. The next release pushes it (above). To push it sooner, paste it into the description on Nexus, then `npm run nexus:pull -- --ids-only` so the repo knows the live one.

The optional file, **EDGEwave Voice for REDnode** (`edgewave-voice-<version>.zip`, from `tools/rednode-zip.mjs`): a game mod, so Mod Manager Download is on; it unzips into the game folder as `red4ext/plugins/REDnode/apps/edgewave-voice/`. Its version is its own, and the release uploads it only when that version is not on Nexus yet.

Keep these in step with the extension (its README and CHANGELOG):

| Where in the description | Update when |
|---|---|
| The STATUS box near the top | A hand test passes, or the preview flag goes |
| "Highlights" | A release adds something a modder would notice |
| "Into the game" | A route is verified in the game, or one is added (voice lines, if a way to make a `.wem` comes) |
| "Coming next" | Its items are released (move them to Highlights) or new ones are built |
| "Requirements" | The VS Code minimum (`engines.vscode`) or the REDcode minimum changes |

## BBCode used

Nexus's BBCode has no tables or Markdown, so the page uses only: `[b]`, `[i]`, `[size=2..5]`, `[color=#hex]`, `[center]`, `[quote]`, `[line]`, `[list]` with `[*]`, `[url=...]` and `[img]`. Square brackets that are not tags confuse the checker, so placeholders use parentheses. The banner is linked from this repo's `main` branch on GitHub, so it must stay at its path. The colours are the house palette: yellow `#fcee0a` for headings, cyan `#19f3ff` for highlights.
