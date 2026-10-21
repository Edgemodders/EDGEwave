# A3 Into the game

Status: **done 2026-10-20** (built 2026-10-16; hand test passed after three rounds, [Tests](testing.html#a3-into-the-game)). **Into the Game…** puts the mix into the open REDcode project, in a layout the game loads, for REDcode to pack. REDcode's Pack carries the REDmod route's sounds since [REDcode #8](https://github.com/Edgemodders/REDcode/issues/8) (on REDcode main in `0f8ebe3`, 2026-10-16; ships in REDcode 0.10.0).

## The routes

| Route | For | What EDGEwave writes | Beside other mods |
|---|---|---|---|
| **Override sound `<hash>`** | One sound effect, by its hash | A 48 kHz, 16-bit WAV with the original's channels, `<hash>.wav` beside the document. REDcode's Import (REDbridge 0.9.0 `sound.importWavs`) writes the touched `.opuspak` and a new `sfx_container.opusinfo` into `source/archive` | **No.** Every mod made this way carries the one shared `sfx_container.opusinfo`, so the last one loaded wins |
| **Replace the event `<event>`, every variation, with REDmod** | An audio event by name, every variation: one WAV for all of them | The WAV in `source/customSounds/<event>.wav`, and an entry in `source/resources/info.json`'s `customSounds`, as WolvenKit's Sound Modding tool writes them. If that WAV is there already and this document did not write it last, EDGEwave asks before replacing it | Yes. The event's own Wwise logic (parameters, switches, effects such as slow-motion processing) is dropped |
| **Silence the event `<event>`, every variation, with REDmod** | An audio event by name | The mix rendered as for a replacement (48 kHz, the target sound's channels, the mix's length) with every sample zeroed, as `source/customSounds/<event>.wav`; its entry has the type you pick, at gain 1. Silent in the game (the katana equip). Not `mod_skip`: see below | Yes |
| **A REDmod custom sound for an event…** | Any mix, for an event named by hand | As Replace | Yes |

## What goes in, and what it replaces

Into the Game makes two separate choices:

| Choice | Decided by |
|---|---|
| **What goes in** | The mix of the checked tracks, whichever they are |
| **What it replaces** | The row you pick in Into the Game: a game sound on any track, checked or not, or an event you name (**Any event**) |

A game sound's track in the mixer does two jobs: it can be heard (checked), and it names a sound the mix can replace (always, checked or not). So an unchecked game sound track is only there to say which sound to replace.

**Track numbers.** Track 1 is the top lane in the mixer, whether it is checked or not; the tracks are numbered by their lane, top to bottom, and the number never changes when a box is checked or unchecked. Into the Game names its groups by them (`Track 2 · <event> · <hash>`). Add Sound puts a new track at the bottom; drag a lane up or down, or right-click it > **Move Up** or **Move Down**, to change the order ([A2 Mix](a2-mix.html#moving-lanes-2026-10-20)).

For a mix of a generated sound and two game sounds:

| Lane | Checked | Into the Game lists it |
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

1. The tracks in the mix, in the mixer's order.
2. **Any event**: A REDmod custom sound for an event you name. When no track in the mix is a game sound effect (a generated sound alone, or the swap above), this comes first and says so.
3. The tracks out of the mix, marked **not in the mix**.

A route is the same whichever group it is picked from: a checked or an unchecked track's **Override sound `<hash>`** writes the same override. **Override sound** replaces that one variation (the sound's hash); **Replace the event** and **Silence the event** (REDmod) act on every variation of the track's event.

The override's WAV takes the channels of the sound it replaces. The choice (with the sound's hash for an override) is kept in the document (`game`) and marked **last time** where it is listed, in the row's name and its group's heading; it is never moved (the owner's findings, 2026-10-19). Changed on 2026-10-19 after the owner's finding: before, the routes came from track 1 only, so a game sound added as a later track could not be overridden. After writing, EDGEwave offers **Pack** (REDcode's), and for a REDmod route says when REDcode's `redcode.pack.redmod` setting is off.

**Voice lines** (`.wem`) have no route yet. Into the Game says so and offers the named REDmod route.

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
| REDmod's types and the `info.json` update, pure, with unit tests | `src/redmod.ts`, `test/` |
| The document's `game` (the last choice) | `src/doc.ts` |
| **Into the Game…** in the Mix bar; the page renders the mix at the format a route asks for | `src/editor.ts`, `webview/editor.ts` |

## Tests

The unit tests, the smoke test and the hand test, with its steps and every round's results, are in [Tests](testing.html#a3-into-the-game).
