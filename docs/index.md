# EDGE<span class="y">wave</span> docs

EDGEwave is the sound studio of the EDGE platform: a VS Code extension where you edit, mix and re-voice Cyberpunk 2077's sounds and put them into the mod you are making in [REDcode](https://github.com/Edgemodders/REDcode). REDcode finds and plays a game sound; **Open in EDGEwave** takes it into the studio.

| Document | What it covers |
|---|---|
| [A1 Edit](a1-edit.html) | What A1 built |
| [A2 Mix](a2-mix.html) | What A2 built, the effects and presets |
| [A3 Into the game](a3-game.html) | The routes into the game and the research behind them |
| [V1 Voice tools](voice-tools.html) | Generate Sound, Speak Line and Re-Voice through ElevenLabs: the tools, the key, cloning and consent, the audio format |
| [Tests](testing.html) | Every test run so far, automated and by hand: how to run it again, what to expect, and what it showed |
| [Design](design.html) | The goals, the split with REDcode, how the game stores audio, the studio, the voice tools, the index and its clean-room rule, and the phases |
| [Dev setup](dev-setup.html) | The tools and steps to build EDGEwave |

## Roadmap status

As of 2026-10-16.

| Phase | Status |
|---|---|
| A0 Scaffold | Done: the extension skeleton, this site and the design (draft 2) |
| A1 Edit | Done: Open in EDGEwave from REDcode, the sound editor, render to WAV |
| A2 Mix | Built, hand test passed but one retest: tracks, effects and presets, Add Sound, a mixed render |
| A3 Into the game | Built, hand test pending: override a sound effect, or a REDmod custom sound for an event |
| V1 Voice tools | Built, hand test pending: Generate Sound, Speak Line and Re-Voice through ElevenLabs |
| A4 Index | Planned: the game's sound banks, the full search |
| A5 Voices and objects | Planned: subtitles and scenes, TweakDB objects and radios |
| A6 EDGE | Planned: agents, and the running game through REDnode |

Source code, releases and issues: [github.com/Edgemodders/EDGEwave](https://github.com/Edgemodders/EDGEwave)
