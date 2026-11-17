---
title: Desk, Project and Library
---

# Desk, Project and Library

Status: **built 2026-11-16, hand test to run** ([steps](testing.html#desk-project-and-library)). Agreed with the owner on 2026-10-31 and 2026-11-04 (build the Desk and the Library together after 0.2.0, one test round), and on 2026-11-16 (the Project view split; the go to build). EDGEwave's side of the [EDGE Library's shared rules](https://edgemodders.github.io/EDGEbuilder/library.html#shared-rules), which every EDGE tool follows. For modders, the platform's wiki explains the Library: [The EDGE Library](https://edgemodders.ai/wiki/library.html).

EDGEwave's activity bar now has four views:

| View | What it holds | Until 0.2 |
|---|---|---|
| **Desk** | Mixes you are working on, kept across restarts until they go into a project or the Library. Below them, **Recent**: mixes you opened lately, from any folder | The Sounds view's Recent. The view's id, `edgewave.sounds`, is kept |
| **Project** | The open project: **Mixes**, its `.edgewave` files, and **Project sounds**, what it puts in the game | The Sounds view's Project and Project sounds |
| **Library** | Your Library's folders, with the sounds in them | New |
| **Game Assets** | The game's sounds | As before |

## The Desk

The Desk is EDGEwave's own scratch space, `%LOCALAPPDATA%\EDGEwave\desk`. No other tool reads it. Each mix on it is an item in the Library's own shape, so Add to Library is a copy:

| In `<name>.sound.asset\` | What it is |
|---|---|
| `asset.json` | `format` 1, `id` (made once, never changed), `name`, `kind` `"sound"`, `main` (the mix), `render` (the WAV), `version`, `history`; `gamePath` when it was made from a game file, `from` when it was opened from a game sound, `library` once it is in the Library |
| `source\raw\<name>.edgewave` | The mix |
| `source\raw\<name>.sounds\` | Sound files dropped on it, and files it used from elsewhere |
| `source\raw\<name>.gen\` | ElevenLabs takes |
| `source\raw\<name>.wav` | Its render |

`main` and `render` are relative to the item's folder. The shared rules say a sound's `main` role is played by `render`, the WAV a project takes. EDGEwave writes both: `main` is the mix, the file EDGEwave opens (as a quickhack's `main` is its document); `render` is the WAV.

| How a mix gets on the Desk | |
|---|---|
| The Desk's **+** (**Create a Sound on the Desk…**) | Asks a name; an empty mix |
| **Create a Sound** with no project open | The same |
| **Open in EDGEwave** on a game sound with no project open (Game Assets, REDcode) | A mix of that sound. Opening the same sound again opens it. Until 0.2 this asked for a folder |
| **Copy to the Desk** on a project's mix or a Recent one | A copy with its files; the mix where it was stays |
| **Edit on the Desk** on a Library sound | A copy with the same id, to change and add to the Library again |
| **Open on the Desk** on a plain sound file in the Library | A new mix with the file as track 1 |

**Versions.** A Desk row shows the Desk's own version, a Library row the Library's (the owner's design, 2026-11-16), so the two can be compared. A Desk mix never in the Library is v1. One added to the Library, or taken from it, has the Library's version until it changes; after a change to its mix, its render or its own files, it is one more, the version Add to Library makes there next. After Add to Library both say the same.

What a Desk mix offers (right-click; ▶, Add to Library and Reveal in Library on the row):

| | |
|---|---|
| ▶ | Plays its render at once, no tab. With no render yet, ▶ is greyed: **Render it first** |
| **Move to Project…** | Copies it into the open project's `source/raw/edgewave/sounds/<name>/` and takes it off the Desk. Then its own **Add to Project…** puts it in the game |
| **Add to Library…** | Asks a Library folder (the last one first, the top folder, or a new one). It needs a render, since a project takes the WAV. For a mix made from a game file, the folder list starts with **Use the game path**, as the rules say (beside the folder picker): select it to turn it on or off, and each folder's line shows where the sound goes, under its game path's folders. The last choice is kept. Again later, it updates the item where it is, one version up |
| **Reveal in Library** | On a mix with a Library copy (hover, or right-click): selects that copy in the Library view, its folders opened. The row's hover says both versions |
| **Rename…** | The folder, the mix, its folders and its render follow the name; the id stays |
| **Take Off the Desk…** | Its folder goes to the Recycle Bin; a Library copy stays |

Every copy (Move to Project, Add to Library, Copy to the Desk, Edit on the Desk, a Library sound into a project, Rename) goes through one step, `copyMix` in `src/desk.ts`. It copies the mix with its `.sounds` and `.gen` folders and its render, all under the new name. Each sound file the mix uses from elsewhere is copied into `.sounds`, and its track points at the copy, so the copy stands alone. Game sounds stay references to the player's game: nothing from the game is copied. A missing file is kept by its full path, and the message says so.

## The Project view

| Group | Rows | A click | Hover |
|---|---|---|---|
| **Mixes** | The `.edgewave` files in the open folder. Those taken from the Library say **from the Library, v*n*** | Opens the mix | ▶ its render |
| **Project sounds** | What the project puts in the game, read from its own files, wherever the mix that made it is kept (the Desk, another folder). The owner's finding of 2026-11-06 (Sounds view step 8: an override from a mix outside the project was missing) | Opens the Hear tab | ▶; the mix that made it, when one is known; Copy Name for named sounds |

Project sounds lists:

| Kind | Read from |
|---|---|
| Named sounds (a new sound, a game event replaced or silenced) | `source/resources/info.json`'s `customSounds` and `source/customSounds` |
| Overrides of a game sound | `<hash>.wav` under `source/raw`, as Add to Project writes it and REDcode imports it. With REDcode's sound index, only hashes that are game sounds count, and the event's name is shown |
| REDnode package sounds | Each package's `rednode-app.json` `sounds` under `source/resources/red4ext/plugins/REDnode/apps/` |

The title bar: **+** (**Create a Sound in the Project…**, the save dialog as before), **Refresh from Library…**, Refresh.

## The Library

One root for every EDGE tool, recorded in `%APPDATA%\EDGE\library.json`. The first time, EDGEwave offers `Documents\EDGE Library` or a folder you pick, and refuses one inside the game's folder. The folders under it are yours, and EDGEwave never makes one on its own. The view shows every folder, but only the sounds in it: EDGEwave's `<name>.sound.asset` items and plain `.wav`, `.ogg`, `.mp3` and `.flac` files. Other tools' items are theirs to show.

| On a Library sound | |
|---|---|
| A click | The Hear tab, with its render |
| ▶ | Plays its render at once |
| **Add to Project** | Copies it into the open project's `source/raw/edgewave/sounds/<name>/` and notes it in the project's came-from note. Again later, it replaces that copy in its folder |
| **Edit on the Desk** | A copy on the Desk with the same id. If it is on the Desk already: open that copy, or replace it |

**The came-from note**, `source/library.json`, is the one every tool writes the same way. EDGEwave writes only its own entries (`by: "edgewave"`) and keeps the rest:

```json
{ "id": "5f2c…", "kind": "sound", "path": "Doors/Door.sound.asset", "version": 3, "added": "2026-11-16T…", "by": "edgewave",
  "files": ["source/raw/edgewave/sounds/Door/Door.edgewave", "source/raw/edgewave/sounds/Door/Door.wav", "…"] }
```

**Refresh from Library…** (the Project view's title bar) reads the note and finds each sound in the Library, by `id` first, then by `path`. It lists those with a newer version, and copies the ones you tick over the project's copies. A change made to a copy in the project is lost then, and the list says so.

## Not built yet

| | |
|---|---|
| Relocate (moving the whole Library) | The shared rules leave it for later, for every tool |
| An MCP tool for the Desk and the Library | As EDGEfab's `fab_desk` and `fab_library`: when an assistant needs it |
| Add to Project's **Pick a game sound to replace…** row; the REDnode package list's labels | Agreed for after 0.2.0, separate from this |
