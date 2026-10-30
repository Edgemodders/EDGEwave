# Changelog

What changed in each EDGEwave release, for modders. Each release takes its notes from its section here: the GitHub release (written by the Publish workflow), the Marketplace's and Open VSX's Changelog tab (this file, in the `.vsix`) and the version's changelog on the Nexus Mods page (pasted by hand).

How to keep it:

- With each change a modder would notice, add a line under **Unreleased**, in its group: **New**, **Changed**, **Fixed** or **Other**, in the commit that makes the change. One change per line. Leave out what only the tests see.
- Before a release, rename **Unreleased** to `## <version> (<date>)` and start a new empty **Unreleased** above it. The Publish workflow stops if the version has no section.
- Links are full URLs, since the same text goes to GitHub, the stores and Nexus.
- `npm run release:notes` prints the GitHub notes; `npm run release:notes -- --nexus` prints plain lines for Nexus's changelog field, one per change.

## Unreleased

**Fixed**

- When a game sound cannot be heard, the message says why, with REDcode's own error, such as "No sound 746693166 in the game's sound effect index". It used to point to REDcode's output, which had nothing: the errors go to EDGEwave's output, where every one is still written.

## 0.2.0 (2026-10-27)

**New**

- **Game Assets** in EDGEwave's activity bar: the game's sounds only, so there is no going to REDcode and back. Sound effects by event, voice lines by language and folder, music and streamed sounds; big folders grouped by name. Click to hear one; add it to the open sound, open it in EDGEwave, or copy its name. **Filter** takes words or `*` patterns, as REDcode's does ([how](https://edgemodders.github.io/EDGEwave/game-assets.html)).
- Game Assets: a **▶** on every sound plays it at once, without opening a tab; **▶** again while it plays stops it. An event plays one of its variations; a voice line's `.wem` is decoded from Ogg Vorbis in EDGEwave. Windows only for now.
- **Create a Sound** (the + in the Sounds view): a new, empty sound, saved by default in the project's `source/raw/edgewave/sounds`. Fill it with Add Sound, Generate Sound or Speak Line, or by dropping sound files on it.
- Drop sound files on the editor, holding Shift as you drop: on the lanes each becomes a new track; on the clip the first becomes the selected track's sound, its edits cleared. Files from the desktop are copied beside the sound, into `<name>.sounds`; files from VS Code's Explorer are used where they are.
- **A new sound for this project…**, first in Add to Project: name the mix (`edgewave_<name>` by default), and quests, scenes and scripts play it by that name, as a REDmod custom sound. Replaces nothing. Pick how it plays in plain words: a sound effect heard from where it plays, or the same everywhere (2D).
- **Project sounds** in the Sounds view: the project's named sounds, with their type and length. Click one to hear it; copy its name for a quest or a script.
- **Voice Lines** for a quest: EDGEquest hands over a quest's dialogue lines, and EDGEwave voices them through ElevenLabs, two takes for V (female and male) and one for anyone else, named as the game names voice files. Pick a voice per speaker, Generate All or one line, play each take, swap in a recording, go back to the previous take, or edit a take in the studio. Lines whose words changed show as changed and are voiced again; `eleven_v3` follows the lines' delivery tags such as `[softly]` ([#5](https://github.com/Edgemodders/EDGEwave/issues/5), [how](https://edgemodders.github.io/EDGEwave/voice-lines.html)).
- **EDGEwave Voice for REDnode**, a game mod: other REDnode mods speak lines of text on demand, such as an AI companion's replies, in a voice you set up, through ElevenLabs with your own key. Lines are cached, so a line spoken before plays at once without spending credits. **EDGEwave: Voices for REDnode…** installs it in the game and names your voices; it is also its own download on each GitHub release and on Nexus Mods ([how](https://edgemodders.github.io/EDGEwave/rednode-voice.html)).
- Sound events for quests: other tools search the game's own list of sound events (every event in 2.31 has its name), hear one, and make a sound into a new event a quest can post, as a REDmod custom sound ([#7](https://github.com/Edgemodders/EDGEwave/issues/7), [how](https://edgemodders.github.io/EDGEwave/api.html#sound-events)).
- Other tools' sound pickers (EDGEwave's `soundEvents`, the MCP server's `sound_events` with `project`) list the project's own sounds first, so EDGEquest offers them without typing a name ([how](https://edgemodders.github.io/EDGEwave/api.html#sound-events)).
- Music cues, and events with no recordings, play in the running game through REDnode 0.43 or later, with the game's own mix: from other tools' pickers (`playEvent`), and from Game Assets with right-click > **Play in the Game** for any event. Stop Sound stops them ([REDnode #17](https://github.com/Edgemodders/REDnode/issues/17), [how](https://edgemodders.github.io/EDGEwave/api.html#in-the-running-game)).
- Other tools' ▶ buttons play a sound at once, without opening EDGEwave's Hear tab: `playEvent` with `show: false` plays one of the event's recordings, and a second ▶ stops the first. **EDGEwave: Stop Sound** stops it. Windows only for now ([#8](https://github.com/Edgemodders/EDGEwave/issues/8), [how](https://edgemodders.github.io/EDGEwave/api.html#playing-with-no-tab)).
- An API for other EDGE extensions, and an MCP server for assistants such as Claude Code: voice a quest's lines, see which are voiced, list voices, search sound events, make a new event. **EDGEwave: Connect an Assistant (MCP)…** sets it up ([how](https://edgemodders.github.io/EDGEwave/api.html)).
- Add to Project: **As a REDnode sound**. A REDnode package plays the mix where its code calls `audio.play`, beside the game's sound, following the game's volume sliders. No REDmod and no `.wem`, so voice lines too. EDGEwave writes the WAV into a package's `sounds` folder and its `rednode-app.json`, or makes a new package, in the project or in the game folder, where REDnode plays it without a restart ([#2](https://github.com/Edgemodders/EDGEwave/issues/2), [how](https://edgemodders.github.io/EDGEwave/a3-game.html#as-a-rednode-sound)).

**Changed**

- Add to Project's other routes say what they do: **Replace a game event by name…** (was A REDmod custom sound for an event) and **In a REDnode package, for its code to play…** (was As a REDnode sound), now last.
- **Into the Game…** is now **Add to Project…**, as other EDGE tools name the same step. It works as before.
- The Sounds view's + is Create a Sound; Open Sound in EDGEwave… (a sound file from disk) is the folder button beside it.
- Remove takes the last track too, leaving an empty sound.
- Needs REDcode for Cyberpunk 2077 0.10.3 or later.
- Add to Project says how to hear the result: install the mod and restart the game, since a sound override hot-deployed into a running game crashes it, and REDmod deploys custom sounds at start. It offers **Pack and Install** beside **Pack** ([#4](https://github.com/Edgemodders/EDGEwave/issues/4)).

**Fixed**

- Unsaved changes to a sound (such as a track added from Game Assets) were lost when the VS Code window reloaded, though the tab stayed marked unsaved. EDGEwave now puts them back, still unsaved until you save.
- When the ElevenLabs API key is missing or refused ("Invalid API key"), Generate Sound, Speak Line, Re-Voice and Voice Lines said so with no way to fix it there. They now show **Set ElevenLabs API Key…** and a link to where to make one, on the dialog's message line; the voices load again once it is set.
- Open Sound in EDGEwave… in REDcode's Project view shows on sound files only (`.wem`, `.wav`, `.ogg`, `.opus`, `.mp3`, `.flac`), not on every file such as an `.mlsetup` ([#6](https://github.com/Edgemodders/EDGEwave/issues/6)).

**Other**

- Each release now updates the [Nexus Mods page](https://www.nexusmods.com/cyberpunk2077/mods/35493) too: the extension as the main file, EDGEwave Voice for REDnode as an optional file, the changelog and the description.

## 0.1.0 (2026-10-20)

The first release, as a preview. Needs REDcode for Cyberpunk 2077 0.10.0 or later and VS Code 1.90 or later. Every part below passed its hand test, in the game where it applies ([Tests](https://edgemodders.github.io/EDGEwave/testing.html)).

**New**

- **Open a sound.** Open in EDGEwave from REDcode's sound browser or audio player, or Open Sound in EDGEwave… on a `.wav` or `.ogg` file. EDGEwave keeps a `.edgewave` document beside the sound in the project, with the edits and the mix, never the audio. The EDGEwave view lists the project's documents and the ones opened lately.
- **Edit** (A1): select, zoom, play and loop; Trim, Cut, Copy, Paste, Silence, Fade in and out with three curves, Apply gain, Normalize, Mono or Stereo. Each edit is listed and can be removed; undo and redo. Render WAV writes 16-bit WAV at the rate you pick.
- **Mix** (A2): tracks on one timeline, from game sound effects, game files by their path and sound files. A checkbox per lane puts a track in the mix; Only This Track and All Tracks in the lanes' menu. Drag a clip sideways to move it in time, a lane up or down to reorder it (or Move Up and Move Down). Level, Pan, Rate and Start per track. Effects per track and on the master: EQ, Low-pass, High-pass, Band-pass, Reverb, Distortion, Compressor; presets Radio, Holocall, PA speaker and Muffled through a wall. A splitter gives the lanes or the waveform more room.
- **Into the Game** (A3): override one sound effect by its hash (through REDcode's Import and REDbridge's `sound.importWavs`), or replace or silence an audio event, every variation, as a REDmod custom sound (`source/customSounds` and `info.json`, packed by REDcode with `redcode.pack.redmod`). The routes come from every game sound on a track, the tracks in the mix first; the last choice is marked. Verified in the game: an override, a REDmod replacement (48 kHz, 16-bit WAV) and a silence.
- **Voice tools** (V1), through ElevenLabs with your own key in VS Code's secret storage: Generate Sound, Speak Line (in an ElevenLabs voice or a game line's voice) and Re-Voice (by a description, or into one of your voices). Cloning a line's voice asks once first; clones are reused and listed for deletion. Translate is planned.
