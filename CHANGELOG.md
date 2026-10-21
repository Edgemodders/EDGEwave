# Changelog

What changed in each EDGEwave release, for modders. Each release takes its notes from its section here: the GitHub release (written by the Publish workflow), the Marketplace's and Open VSX's Changelog tab (this file, in the `.vsix`) and the version's changelog on the Nexus Mods page (pasted by hand).

How to keep it:

- With each change a modder would notice, add a line under **Unreleased**, in its group: **New**, **Changed**, **Fixed** or **Other**, in the commit that makes the change. One change per line. Leave out what only the tests see.
- Before a release, rename **Unreleased** to `## <version> (<date>)` and start a new empty **Unreleased** above it. The Publish workflow stops if the version has no section.
- Links are full URLs, since the same text goes to GitHub, the stores and Nexus.
- `npm run release:notes` prints the GitHub notes; `npm run release:notes -- --nexus` prints plain lines for Nexus's changelog field, one per change.

## Unreleased

## 0.1.0 (2026-10-20)

The first release, as a preview. Needs REDcode for Cyberpunk 2077 0.10.0 or later and VS Code 1.90 or later. Every part below passed its hand test, in the game where it applies ([Tests](https://edgemodders.github.io/EDGEwave/testing.html)).

**New**

- **Open a sound.** Open in EDGEwave from REDcode's sound browser or audio player, or Open Sound in EDGEwave… on a `.wav` or `.ogg` file. EDGEwave keeps a `.edgewave` document beside the sound in the project, with the edits and the mix, never the audio. The EDGEwave view lists the project's documents and the ones opened lately.
- **Edit** (A1): select, zoom, play and loop; Trim, Cut, Copy, Paste, Silence, Fade in and out with three curves, Apply gain, Normalize, Mono or Stereo. Each edit is listed and can be removed; undo and redo. Render WAV writes 16-bit WAV at the rate you pick.
- **Mix** (A2): tracks on one timeline, from game sound effects, game files by their path and sound files. A checkbox per lane puts a track in the mix; Only This Track and All Tracks in the lanes' menu. Drag a clip sideways to move it in time, a lane up or down to reorder it (or Move Up and Move Down). Level, Pan, Rate and Start per track. Effects per track and on the master: EQ, Low-pass, High-pass, Band-pass, Reverb, Distortion, Compressor; presets Radio, Holocall, PA speaker and Muffled through a wall. A splitter gives the lanes or the waveform more room.
- **Into the Game** (A3): override one sound effect by its hash (through REDcode's Import and REDbridge's `sound.importWavs`), or replace or silence an audio event, every variation, as a REDmod custom sound (`source/customSounds` and `info.json`, packed by REDcode with `redcode.pack.redmod`). The routes come from every game sound on a track, the tracks in the mix first; the last choice is marked. Verified in the game: an override, a REDmod replacement (48 kHz, 16-bit WAV) and a silence.
- **Voice tools** (V1), through ElevenLabs with your own key in VS Code's secret storage: Generate Sound, Speak Line (in an ElevenLabs voice or a game line's voice) and Re-Voice (by a description, or into one of your voices). Cloning a line's voice asks once first; clones are reused and listed for deletion. Translate is planned.
