# Changelog

What changed in each EDGEwave release, for modders. Each release takes its notes from its section here: the GitHub release (written by the Publish workflow), the Marketplace's and Open VSX's Changelog tab (this file, in the `.vsix`) and the version's changelog on the Nexus Mods page (pasted by hand).

How to keep it:

- With each change a modder would notice, add a line under **Unreleased**, in its group: **New**, **Changed**, **Fixed** or **Other**, in the commit that makes the change. One change per line. Leave out what only the tests see.
- Before a release, rename **Unreleased** to `## <version> (<date>)` and start a new empty **Unreleased** above it. The Publish workflow stops if the version has no section.
- Links are full URLs, since the same text goes to GitHub, the stores and Nexus.
- Under each version's heading, a short summary for Nexus in an HTML comment that GitHub and the stores hide: `<!-- nexus`, one plain line per change (`New: ...`, at most 120 characters, at most 13 lines, no markdown), `Full changelog: <link>` last, then `-->` (EDGErepo's README, Nexus changelogs). Nexus cannot edit a changelog once posted.
- `npm run release:notes` prints the GitHub notes; `npm run release:notes -- --nexus` prints the Nexus summary.

## Unreleased

**New**

- Voice Lines makes each take a `.wem` for the game through your own Wwise 2023.1.14 (free, on your PC), in the mod's archive folder that EDGEquest names, with its game path in `voice.json` for EDGEquest's voice-over map. Made again when a take changes, a studio render included; without Wwise the panel says so and where to get it. The setting `edgewave.wwise.path` points at another Wwise, or `off`. Not yet heard in the game (https://github.com/Edgemodders/EDGEwave/issues/5)
- The MCP tool `voice_lines` makes the `.wem` files too, and `voice_status` says how many takes have one

**Changed**

- Add to Project's message after an override names REDcode's Pack and Play, the new name of Pack and Try (https://github.com/Edgemodders/EDGEwave/issues/10)

## 0.3.0 (2026-11-22)

<!-- nexus
New: The Desk, a scratch space for sounds in progress, and the Library view, shared by every EDGE tool
New: A Project view with the project's mixes and sounds, and a play button on every mix
New: Character Voices: one voice per game character, designed from a description of them
New: Other tools can have EDGEwave speak a line with its timings, for lip sync
New: Voice Lines keeps each take's timings beside its WAV
Changed: Your ElevenLabs key is kept in REDcode's Keys, shared by every EDGE tool, and moves there by itself
Changed: The game's own audio is never sent to ElevenLabs
Changed: The Sounds view is now the Desk; a copied mix takes its sound files with it
Needs: REDcode 0.10.3 or later; 0.10.16 or later, with REDbridge 0.18.0, for the shared keys
Full changelog: https://github.com/Edgemodders/EDGEwave/blob/main/CHANGELOG.md
-->

**New**

- The **Desk**: EDGEwave's own scratch space for the sounds you are working on, kept across restarts until you move them to a project or add them to the Library. Its **+** makes a sound there; with no project open, Create a Sound and Open in EDGEwave on a game sound land there too, with no question about a folder. Each mix's right-click has **Move to Project…**, **Add to Library…**, **Rename…** and **Take Off the Desk…** ([how](https://edgemodders.github.io/EDGEwave/desk-library.html#the-desk)).
- The **Library** view: the EDGE Library's folders, shared by every EDGE tool, with the sounds in them. Add a Desk sound to it, then **Add to Project** copies it into any project, noted in the project's `source/library.json`; **Refresh from Library…** in the Project view brings in newer versions; **Edit on the Desk** takes a copy to change ([how](https://edgemodders.github.io/EDGEwave/desk-library.html#the-library), [the Library](https://edgemodders.ai/wiki/library.html)).
- A **▶** on every mix in the Desk and Project views plays its render at once, with no tab; a mix not rendered yet shows it greyed, **Render it first**. Project sounds and Library sounds have one too.
- **Copy to the Desk** on a project's mix, or a Recent one: a copy with its files, to change or add to the Library.
- Other tools can have EDGEwave speak one line with ElevenLabs' timings, when each letter is spoken, for lip sync (EDGEfab's Lip Sync tab): `speakLine` in the API and `voice_speak_line` for assistants. It needs no project, keeps each take with its timings, and plays a line spoken before again for free. EDGEwave asks you once before a tool first spends your credits ([#13](https://github.com/Edgemodders/EDGEwave/issues/13), [how](https://edgemodders.github.io/EDGEwave/api.html#speaking-a-line-with-timings)).
- **EDGEwave: Character Voices…**: one voice per game character (by its voice tag, such as `judy`) for every tool that speaks their lines. Pick one of your ElevenLabs voices, or **design a voice from a description** of the character: ElevenLabs makes a few voices, you click each to hear it, then **Keep** the one you want. A character's menu has **Hear It**, **Design Again from Its Description…** (your words, ready to change), **Pick Another Voice…**, **Reveal in File Explorer** (the lines spoken in it) and **Forget It**. Voice Lines offers each speaker's voice to it.
- Voice Lines keeps each take's timings beside its WAV (`<take>.timings.json`), at no extra cost, so a line voiced now can get lip sync later.

**Changed**

- Your ElevenLabs key is now kept in **REDcode's Keys**, shared by every EDGE tool: set it once there or in EDGEwave, and EDGEwave asks you once whether it may read it. A key EDGEwave kept before moves there by itself, once. Assistants connected with **Connect an Assistant** read it from there too, so their settings no longer hold it: connect again to take it out of an older entry. If you choose Don't Allow, EDGEwave says how to change that and does not ask you to type the key. Needs REDcode 0.10.16 or later, with REDbridge 0.18.0; with an older REDcode, EDGEwave keeps its own key as before ([#12](https://github.com/Edgemodders/EDGEwave/issues/12), [#14](https://github.com/Edgemodders/EDGEwave/issues/14)).
- EDGEwave no longer sends the game's audio to ElevenLabs: on a track that plays a game voice line or sound effect, Speak Line does not offer the line's voice and Re-Voice says why at once, its buttons off. Your own recordings and files work as before.
- The Sounds view is now the **Desk**, with Recent below the Desk's mixes. The project's mixes and **Project sounds** moved to a new **Project** view, whose **+** is Create a Sound in the Project.
- **Project sounds** reads the project's own files, so it lists an override of a game sound and a REDnode package's sounds wherever the mix that made them is kept. A click on any of them opens the Hear tab; the hover has ▶ and a button that opens the mix that made it.
- A copied mix stands alone: moving, adding to the Library or copying a mix takes in the sound files it used from other folders.

## 0.2.0 (2026-11-07)

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

- When a game sound cannot be heard, the message says why, with REDcode's own error, such as "No sound 746693166 in the game's sound effect index". It used to point to REDcode's output, which had nothing: the errors go to EDGEwave's output, where every one is still written.
- The Sounds view's **Project sounds** says how each came (a new sound, or a game event replaced or silenced) and also lists overrides of game sounds and sounds put in a REDnode package; a click opens their mix.
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
