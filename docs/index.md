# EDGE<span class="y">wave</span> docs

EDGEwave is the sound studio of the EDGE platform: a VS Code extension where you edit, mix and re-voice Cyberpunk 2077's sounds and put them into the mod you are making in [REDcode](https://github.com/Edgemodders/REDcode). REDcode finds and plays a game sound; **Open in EDGEwave** takes it into the studio.

| Document | What it covers |
|---|---|
| [A1 Edit](a1-edit.html) | What A1 built |
| [A2 Mix](a2-mix.html) | What A2 built, the effects and presets |
| [A3 Into the game](a3-game.html) | The routes into the game and the research behind them |
| [V1 Voice tools](voice-tools.html) | Generate Sound, Speak Line and Re-Voice through ElevenLabs: the tools, the key, cloning and consent, the audio format |
| [V2 Voice a quest](voice-lines.html) | The Voice Lines panel: a quest's dialogue lines from EDGEquest, voiced through ElevenLabs; the contract, the files, the `.wem` spike |
| [API and MCP](api.html) | EDGEwave's API for other extensions and its MCP server for assistants: voice lines, sound events, a new event |
| [Release](release.html) | How a version goes out, and the releases so far |
| [Tests](testing.html) | Every test run so far, automated and by hand: how to run it again, what to expect, and what it showed |
| [Design](design.html) | The goals, the split with REDcode, how the game stores audio, the studio, the voice tools, the index and its clean-room rule, and the phases |
| [Dev setup](dev-setup.html) | The tools and steps to build EDGEwave |

## Roadmap status

As of 2026-10-24. Released: 0.1.0 (2026-10-20), with A1, A2, A3 and V1.

| Phase | Status |
|---|---|
| A0 Scaffold | Done: the extension skeleton, this site and the design (draft 2) |
| A1 Edit | Done: Open in EDGEwave from REDcode, the sound editor, render to WAV |
| A2 Mix | Done 2026-10-20: tracks, effects and presets, Add Sound, a mixed render |
| A3 Into the game | Done 2026-10-20: override a sound effect, or a REDmod custom sound for an event. Added 2026-10-21, hand test pending: **As a REDnode sound** |
| V1 Voice tools | Done 2026-10-20: Generate Sound, Speak Line and Re-Voice through ElevenLabs |
| V2 Voice a quest | Steps 1 to 4 built 2026-10-24, hand test pending: the Voice Lines panel, the API and the MCP server, and sound events for EDGEquest. Next: step 5, the `.wem` route |
| A4 Index | Planned: the game's sound banks, the full search |
| A5 Voices and objects | Planned: subtitles and scenes, TweakDB objects and radios |
| A6 EDGE | Started: the MCP server (with V2) and the REDnode sound route are built; playing an event in the running game from VS Code waits for [REDnode #17](https://github.com/Edgemodders/REDnode/issues/17) |

Source code, releases and issues: [github.com/Edgemodders/EDGEwave](https://github.com/Edgemodders/EDGEwave)
