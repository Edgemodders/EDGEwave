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

## Before the first upload

| To do | Why |
|---|---|
| ~~Publish EDGEwave to the Marketplace and Open VSX~~ | Done 2026-10-20 (0.1.0): the description's links to `Edgemodders.edgewave` and `edgemodders/edgewave` work |
| The four screenshots | The description has placeholders in cyan italics, `(Screenshot N: ...)`. Save each picture in `nexus/images/` (WebP), push, then replace its line with `[img]https://raw.githubusercontent.com/Edgemodders/EDGEwave/main/nexus/images/<name>[/img]` and a one-line caption, as REDcode's page does. Uploading it to the page's Images tab too puts it in the gallery |
| The STATUS box | Updated 2026-10-20: every part tested by hand. Change it when the preview flag goes |
| The Nexus zip | `npm run nexus-zip` builds it after `npm run package`; the publish workflow attaches it to the GitHub release ([Release](https://edgemodders.github.io/EDGEwave/release.html)) |

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
3. Paste the whole file into the description field on Nexus and save.
4. For a new version: upload the release's Nexus zip as the main file with the version from `package.json`, Mod Manager Download off. Archive the old file. Paste the output of `npm run release:notes -- --nexus` into the page's changelog for that version: one plain line per change, from `CHANGELOG.md`.

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
