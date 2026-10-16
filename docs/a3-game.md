# A3 Into the game

Status: **built 2026-10-16, hand test pending.** **Into the Game…** puts the mix into the open REDcode project, in a layout the game loads, for REDcode to pack. REDcode's Pack carries the REDmod route's sounds since [REDcode #8](https://github.com/Edgemodders/REDcode/issues/8) (on REDcode main in `0f8ebe3`, 2026-10-16; ships in REDcode 0.10.0).

## The routes

| Route | For | What EDGEwave writes | Beside other mods |
|---|---|---|---|
| **Override this variation** | One sound effect, by its hash | A 48 kHz, 16-bit WAV with the original's channels, `<hash>.wav` beside the document. REDcode's Import (REDbridge 0.9.0 `sound.importWavs`) writes the touched `.opuspak` and a new `sfx_container.opusinfo` into `source/archive` | **No.** Every mod made this way carries the one shared `sfx_container.opusinfo`, so the last one loaded wins |
| **Replace the event with REDmod** | An audio event by name, every variation | The WAV in `source/customSounds/<event>.wav`, and an entry in `source/resources/info.json`'s `customSounds`, as WolvenKit's Sound Modding tool writes them | Yes. The event's own Wwise logic (parameters, switches, effects such as slow-motion processing) is dropped |
| **Silence the event with REDmod** | An audio event by name | A `mod_skip` entry, no file | Yes |
| **A REDmod custom sound for an event…** | Any mix, for an event named by hand | As Replace | Yes |

The routes offered depend on the first track: a sound effect gets all three; anything else gets the named REDmod route. The choice is kept in the document (`game`) and offered first next time. After writing, EDGEwave offers **Pack** (REDcode's), and for a REDmod route says when REDcode's `redcode.pack.redmod` setting is off.

The REDmod types, from the REDmodding wiki:

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
| `mod_skip` | Not played (the Silence route) |

`gain` (0 to 1) starts at 1 and `pitch` (pitch variance, 0 to 1) at 0. Change them in the document's `game` or the project's `info.json`.

**Voice lines** (`.wem`) have no route yet. Into the Game says so and offers the named REDmod route.

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

**Unverified until the hand test:** that the game plays an override, and that REDmod accepts a 48 kHz 16-bit WAV.

## What is built

| Part | Where |
|---|---|
| The routes, the quick picks, writing the files, REDcode's Import and Pack | `src/intoGame.ts` |
| REDmod's types and the `info.json` update, pure, with unit tests | `src/redmod.ts`, `test/` |
| The document's `game` (the last choice) | `src/doc.ts` |
| **Into the Game…** in the Mix bar; the page renders the mix at the format a route asks for | `src/editor.ts`, `webview/editor.ts` |

## Tests

The unit tests, the smoke test and the hand test, with its steps and every round's results, are in [Tests](testing.html#a3-into-the-game).
