# A3 Into the game

Status: **done 2026-10-20** (built 2026-10-16; hand test passed after three rounds, [Tests](testing.html#a3-into-the-game)). Added 2026-10-21, hand test pending: how to hear the result (EDGEwave #4) and the **As a REDnode sound** route (EDGEwave #2). **Add to Project…** puts the mix into the open REDcode project, in a layout the game loads, for REDcode to pack. REDcode's Pack carries the REDmod route's sounds since [REDcode #8](https://github.com/Edgemodders/REDcode/issues/8) (on REDcode main in `0f8ebe3`, 2026-10-16; ships in REDcode 0.10.0). Added 2026-10-24 at the owner's request, hand test pending: [A new sound for this project](#a-new-sound-for-this-project), first in the list, and the project's sounds in the Sounds view and for other tools.

## The routes

| Route | For | What EDGEwave writes | Beside other mods |
|---|---|---|---|
| **A new sound for this project…** | Any mix, as a sound that quests, scenes and scripts play by its name. Replaces nothing | The WAV at 48 kHz in `source/customSounds/<name>.wav`, and its entry in `source/resources/info.json`'s `customSounds` (gain 1), as Replace. The name is `edgewave_<document name>` by default; a game event's name is refused. See [below](#a-new-sound-for-this-project) | Yes |
| **Override sound `<hash>`** | One sound effect, by its hash | A 48 kHz, 16-bit WAV with the original's channels, `<hash>.wav` beside the document. REDcode's Import (REDbridge 0.9.0 `sound.importWavs`) writes the touched `.opuspak` and a new `sfx_container.opusinfo` into `source/archive` | **No.** Every mod made this way carries the one shared `sfx_container.opusinfo`, so the last one loaded wins |
| **Replace the event `<event>`, every variation, with REDmod** | An audio event by name, every variation: one WAV for all of them | The WAV in `source/customSounds/<event>.wav`, and an entry in `source/resources/info.json`'s `customSounds`, as WolvenKit's Sound Modding tool writes them. If that WAV is there already and this document did not write it last, EDGEwave asks before replacing it | Yes. The event's own Wwise logic (parameters, switches, effects such as slow-motion processing) is dropped |
| **Silence the event `<event>`, every variation, with REDmod** | An audio event by name | The mix rendered as for a replacement (48 kHz, the target sound's channels, the mix's length) with every sample zeroed, as `source/customSounds/<event>.wav`; its entry has the type you pick, at gain 1. Silent in the game (the katana equip). Not `mod_skip`: see below | Yes |
| **Replace a game event by name…** (was A REDmod custom sound for an event) | Any mix, in place of a game event named by hand | As Replace | Yes |
| **In a REDnode package, for its code to play…** (was As a REDnode sound; [EDGEwave #2](https://github.com/Edgemodders/EDGEwave/issues/2)) | Any mix, voice lines too. Replaces nothing: a REDnode package plays it where its code calls `audio.play` | The mix at 48 kHz as `sounds/<name>.wav` in a REDnode package, and its entry in the package's `rednode-app.json` `sounds` with the category you pick. See [As a REDnode sound](#as-a-rednode-sound) | Yes: each package plays its own sounds |

## What goes in, and what it replaces

Add to Project makes two separate choices:

| Choice | Decided by |
|---|---|
| **What goes in** | The mix of the checked tracks, whichever they are |
| **What it replaces** | The row you pick in Add to Project: a game sound on any track, checked or not, or a game event you name (**Any game event**); or nothing, for a new sound |

A game sound's track in the mixer does two jobs: it can be heard (checked), and it names a sound the mix can replace (always, checked or not). So an unchecked game sound track is only there to say which sound to replace.

**Track numbers.** Track 1 is the top lane in the mixer, whether it is checked or not; the tracks are numbered by their lane, top to bottom, and the number never changes when a box is checked or unchecked. Add to Project names its groups by them (`Track 2 · <event> · <hash>`). Add Sound puts a new track at the bottom; drag a lane up or down, or right-click it > **Move Up** or **Move Down**, to change the order ([A2 Mix](a2-mix.html#moving-lanes-2026-10-20)).

For a mix of a generated sound and two game sounds:

| Lane | Checked | Add to Project lists it |
|---|---|---|
| Track 1: a generated sound (a file) | ☑ | Nothing: a file has no game sound to replace |
| Track 2: the katana equip (a game sound) | ☐ | Under **Track 2 · … · not in the mix** |
| Track 3: an engine start (a game sound) | ☐ | Under **Track 3 · … · not in the mix** |

Picking **Override sound `<hash>`** under Track 2 then puts the generated sound into the game in place of the katana sound: a straight swap. With track 1 and track 2:

| Track 1 (a file) | Track 2 (the game sound) | What the game plays in place of track 2's sound |
|---|---|---|
| ☑ | ☐ | Track 1 alone: a straight swap |
| ☑ | ☑ | Both mixed: the katana with the file layered on |
| ☐ | ☑ | The katana as edited in EDGEwave |

**The list's order.** For each game sound effect on a track, a group under the track's name with its three routes (Override sound, Replace the event, Silence the event):

1. **This project**: A new sound for this project, always first.
2. The tracks in the mix, in the mixer's order.
3. **Any game event**: Replace a game event by name. When no track in the mix is a game sound effect (a generated sound alone, or the swap above), this comes right after the new sound and says so.
4. The tracks out of the mix, marked **not in the mix**.
5. **REDnode**: In a REDnode package, for its code to play.

A route is the same whichever group it is picked from: a checked or an unchecked track's **Override sound `<hash>`** writes the same override. **Override sound** replaces that one variation (the sound's hash); **Replace the event** and **Silence the event** (REDmod) act on every variation of the track's event.

The override's WAV takes the channels of the sound it replaces. The choice (with the sound's hash for an override) is kept in the document (`game`) and marked **last time** where it is listed, in the row's name and its group's heading; it is never moved (the owner's findings, 2026-10-19). Changed on 2026-10-19 after the owner's finding: before, the routes came from track 1 only, so a game sound added as a later track could not be overridden. After writing, EDGEwave offers **Pack and Install** and **Pack** (REDcode's), and for a REDmod route says when REDcode's `redcode.pack.redmod` setting is off.

**Hearing it in the game** needs a restart ([EDGEwave #4](https://github.com/Edgemodders/EDGEwave/issues/4)). The game reads its sound index once, at start:

| Route | To hear it | Why |
|---|---|---|
| Override | Pack and Install, then restart the game | A hot deploy (REDcode's Pack and Try, Red Hot Tools' hot folder) of an archive with the game's sound paks crashes the running game a few seconds later ([REDnode's research](https://edgemodders.github.io/REDnode/world.html#h1-limit-sound-paks-crash-a-swap)). REDnode 0.26.8 or later swaps one safely through its `archives.reload` or its MCP tool `archives_reload` (game paused, audio held, the sound index read again); a sound that just played may keep its old version until the game loads it again (for a weapon, equip it again); REDcode is asked to route Pack and Try through it ([REDcode #11](https://github.com/Edgemodders/REDcode/issues/11)) |
| Replace or Silence (REDmod) | Pack and Install, then start the game (with `-modded`, as REDcode's Run Game does) | REDmod deploys custom sounds when the game starts |

EDGEwave's message after Add to Project says so, and **Pack and Install** runs REDcode's.

**Voice lines** (`.wem`) have no route yet. Add to Project says so and offers the named REDmod route.

## A new sound for this project

The owner's request, 2026-10-24, from EDGEquest's test: a modder makes sounds ahead of time, names them, and picks them later in the tools that play a sound, such as a quest's sound and music steps, or a REDnode mod. In the game a sound is never played by its file: quest nodes, scenes and scripts post an **event name**. So a named sound in the project is a REDmod custom sound under a new event name, the same thing EDGEwave's `customSound` makes for EDGEquest ([API and MCP](api.html#a-new-event)).

| Step | What it asks |
|---|---|
| The name | `edgewave_<document name>` by default (the part after `edgewave_` selected, to type over). Letters, digits and `_`. One of the game's events is refused, since the game would play the sound in place of it (that is **Replace a game event by name**); a sound the project has already is a warning, as the new one takes its place |
| How it plays | **A sound effect, heard from where it plays** (`mod_sfx_low_occlusion`, offered first: fades with distance, not muffled much); **The same everywhere (2D)** (`mod_sfx_2d`: music, a phone or interface sound; on the effects slider, as REDmod has no music type); or **Another of REDmod's types…**, the [list below](#the-redmod-types) |
| Then | A message with the name, **Copy Name**, and **Pack and Install** (REDmod reads custom sounds when the game starts). Without `redcode.pack.redmod`, it says REDcode packs them only as a REDmod |

**Where the project's sounds show:**

| Where | What |
|---|---|
| EDGEwave's Sounds view, **Project sounds** | Every entry in `info.json`'s `customSounds`, with its type and length (a missing WAV is marked). Click one to hear it; **Copy Name**; **Show the WAV** |
| `soundEvents` (the API) and `sound_events` (the MCP server, with `project`) | The project's sounds first, with `project: { type, file }`; one under a game event's name is marked `replaces` and stands in that event's place. So EDGEquest's sound pickers offer them ([API and MCP](api.html#sound-events)) |
| `playEvent` | A project sound plays its WAV in the Hear panel |

Unverified: that a quest phase's `questAudioEventNodeType` or a scene's `scnAudioEvent` plays a new event name (EDGEquest's in-game test 6 checks it, [#7](https://github.com/Edgemodders/EDGEwave/issues/7)); that a REDnode mod's `game.audio.play` plays one. REDmod can add new events (the wiki), and scripts post them.

## As a REDnode sound

Add to Project's **In a REDnode package, for its code to play…** (named As a REDnode sound until 2026-10-24). Only that package's code plays the sound; a quest cannot post it.


Built 2026-10-21 for [EDGEwave #2](https://github.com/Edgemodders/EDGEwave/issues/2), at REDnode's request. REDnode's Sound API (S1 Play, passed in game with REDnode 0.24.1) plays a package's own WAV, OGG, MP3 and FLAC files beside the game's sound. They follow the game's volume sliders and pause in menus. The sounds need no REDmod, no pack step and no `.wem`, so this route takes a voice line too. It replaces nothing: the sound plays when the package's code calls it. REDnode's docs: [Your own sounds](https://edgemodders.github.io/REDnode/overlay-apps.html#your-own-sounds).

| Step | What EDGEwave asks and does |
|---|---|
| The package | The REDnode packages it finds (a folder with a `rednode-app.json` that has an `id`), the last one first and marked: in the project under `source/resources/red4ext/plugins/REDnode/apps/`, and in the game folder's `red4ext/plugins/REDnode/apps/` when REDnode is installed there. Or **New package in the project…** or **New package in the game folder…**, with an id (lower case, digits, dashes; the mod's name by default) |
| The name | What the code plays it by, `audio.play(name)`, and the file's name: `sounds/<name>.wav`. The document's name by default, then last time's. If the package has that sound and this document did not write it last time, EDGEwave asks before replacing it |
| The slider | `sfx` (Sound effects), `dialogue` (Dialogue) or `music` (Music): Dialogue first when a voice line is in the mix, then last time's |
| Writes | The mix at 48 kHz, with the first track in the mix's channels (REDnode plays any rate and mixes in stereo), as `sounds/<name>.wav`; the manifest's `sounds.<name>` as `{ "file": "sounds/<name>.wav", "category": ... }`, keeping settings set there by hand (`volume`, `loop` and so on). A new package also gets its manifest (`id`, `name`, `version`, `description`, `main: "mod.mjs"`, `open: true`, so it starts when it appears) and a `mod.mjs` that plays the sound once, to build on |
| Then | A message with the line that plays it, **Copy Code** (`import { audio } from 'rednode'; await audio.play("<name>");`), **Open Manifest**, and for a package in the project **Pack and Install** |

Where the package is decides how it gets into the game:

| Package | Into the game | Ships with the mod |
|---|---|---|
| In the project, `source/resources/red4ext/plugins/REDnode/apps/<id>/` | REDcode's Pack copies every file under `source/resources` to the same path under `packed` (REDcode's `pack.ts`), so Pack and Install puts it in the game folder | Yes |
| In the game folder | At once: REDnode watches its apps folders while it runs, so a new package starts and a changed manifest restarts its package, without restarting the game | No: for trying a sound out |

The choice is kept in the document (`game`: `{ route: "rednode", package, sound, category }`, the package relative to the project's folder when it is in it). Unverified in the game: that REDnode starts a package Pack and Install puts in its apps folder while the game runs, as it does one made there.

**Later, with REDnode's S3:** S3's `effects` setting will take A2's effect objects as they are (`{ type: "lowpass", hz, q }`, `{ type: "reverb", seconds, mix }` and so on, `Effect` in `src/doc.ts`), with A2's preset names and values. This route could then write the chain into the manifest instead of baking it into the WAV, so the effect can change while the game runs. So the effect objects' shape is a contract with REDnode: tell REDnode when it changes.

## The REDmod types

From the REDmodding wiki:

| Type | How the game plays it |
|---|---|
| `mod_sfx_2d` | Without any position or attenuation |
| `mod_sfx_occlusion` | Medium attenuation with normal occlusion |
| `mod_sfx_low_occlusion` | A long attenuation that is not occluded much, such as a voice-over or quest sound |
| `mod_sfx_room` | A shorter attenuation, heard across a room |
| `mod_sfx_street` | A medium attenuation, heard down a street |
| `mod_sfx_city` | A longer attenuation, for city sounds |
| `mod_sfx_radio` | Needs to be tuned to a broadcast channel |
| `mod_sfx_ui` | Menu and UI sounds. On the wiki; not in WolvenKit's event list (unverified) |
| `mod_skip` | Not played, by the wiki. In the hand test it did not silence an event on its own (`w_melee_katana_equip`), so EDGEwave does not write it |

`gain` (0 to 1) starts at 1 and `pitch` (pitch variance, 0 to 1) at 0. Change them in the document's `game` or the project's `info.json`.


## Research, 2026-10-16

| Question | Found | Source |
|---|---|---|
| REDmod's custom sound fields | `customSounds` entries with `name`, `type`, `file`, `gain`, `pitch`. REDmod's deploy checks each WAV: RIFF, format, channels, rate, byte rate, block align, bits. Which values pass is not in the binary | `tools/redmod/bin/redMod.exe` (its strings) |
| The types | `mod_sfx_2d`, `_city`, `_low_occlusion`, `_occlusion`, `_radio`, `_room`, `_street` are game events; `mod_skip` is in REDmod | WolvenKit's `soundEvents.json`, `redMod.exe` |
| Layout and meanings | WAVs in `mods/<name>/customSounds`, `info.json` at the mod's root; the types' meanings; gain and pitch 0 to 1; custom sounds override events, not `.wem` files, and drop the event's Wwise logic | [REDmodding wiki: Audio Modding](https://wiki.redmodding.org/cyberpunk-2077-modding/for-mod-creators-theory/modding-tools/redmod/audio-modding) |
| A WolvenKit project's layout | WAVs in `source/customSounds`, entries in `source/resources/info.json`; WolvenKit's pack copies each listed file to `packed/mods/<name>/customSounds` | WolvenKit's `Cp77Project`, `RED4Controller`, `SoundModdingViewModel` |
| Overrides and other mods | "Mods made this way are incompatible with each other"; prefer REDmod or Audioware | [REDmodding wiki: Replacing sound effects](https://wiki.redmodding.org/cyberpunk-2077-modding/modding-guides/sound/replacing-sounds-effects) |
| The override's WAV | `opusenc` takes 16-bit, 24-bit or float WAV at any rate and encodes at 48 kHz, keeping the channel count; an override read back from the pack correlates 0.981 with its input | [REDbridge #6](https://github.com/Edgemodders/REDbridge/issues/6) |
| Voice lines | Modders re-encode WAV to `.wem` with Wwise (2019.2 in one guide) and pack it at the original path. EDGEwave cannot ship Wwise; using a modder's own install is a candidate for later (unverified) | [A Nexus Mods guide](https://www.nexusmods.com/cyberpunk2077/articles/770), [REDmodding wiki: sound](https://wiki.redmodding.org/cyberpunk-2077-modding/modding-guides/sound/converting-.wem-to-.wav) |

**Verified 2026-10-19 by the owner:** the game plays an override (a katana equip sound, from a later track alone in the mix, packed and deployed). REDmod accepts EDGEwave's 48 kHz 16-bit WAV, and the game plays it for the event (`dev_vending_machine_can_falls`, `mod_sfx_room`).

**Why Silence is a silent WAV** (the A3 hand test, round 2, 2026-10-19).

| Test | Result |
|---|---|
| A custom sound for `dev_vending_machine_can_falls` | Played. A short ping in its place showed why the next tests misled: a can dropping plays several events layered together, and only this one was replaced |
| `mod_skip`, then a silent WAV, for that event | The can still sounded the same: the other layers. The silences were not proven either way |
| A silent WAV for `w_melee_katana_equip`, one event on its own | **Silent.** The mix rendered as for a replacement, every sample zeroed, at gain 1 |
| `mod_skip` for `w_melee_katana_equip`, by hand, with the event's audible WAV left in `customSounds` | **Not silent.** The game's executable contains the string `mod_skip`, beside the code that reads `mods.json`; why it does not take is unknown |
| `gain` 0 in `info.json`, on a loud replacement | Still loud: gain seems to be ignored (unverified: whether `mods.json` had the 0) |

So Silence writes a silent WAV, as modders do, and never `mod_skip`. An older `mod_skip` entry in `info.json` is replaced the next time that event is silenced or replaced.

## What is built

| Part | Where |
|---|---|
| The routes, the quick picks, writing the files, REDcode's Import and Pack | `src/intoGame.ts` |
| The REDnode route's manifest edits, names and sample code (pure, `test/rednode.test.ts`) | `src/rednode.ts` |
| REDmod's types and the `info.json` update, pure, with unit tests | `src/redmod.ts`, `test/` |
| The document's `game` (the last choice) | `src/doc.ts` |
| **Add to Project…** in the Mix bar; the page renders the mix at the format a route asks for | `src/editor.ts`, `webview/editor.ts` |

## Tests

The unit tests, the smoke test and the hand test, with its steps and every round's results, are in [Tests](testing.html#a3-into-the-game).
