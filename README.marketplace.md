<p align="center">
  <img src="docs/assets/brand/banner.png" alt="EDGEwave: edit, mix and re-voice Cyberpunk 2077's sounds, and put them into your mod, inside the editor." width="100%">
</p>

# EDGEwave

**[Docs](https://edgemodders.github.io/EDGEwave/)** · [Repo](https://github.com/Edgemodders/EDGEwave) · [Issues](https://github.com/Edgemodders/EDGEwave/issues) · [Changelog](https://github.com/Edgemodders/EDGEwave/blob/main/CHANGELOG.md)

EDGEwave is a sound studio for Cyberpunk 2077 modding, inside VS Code. Open one of the game's sounds, edit it, mix it with other sounds and effects, and put the result into your mod. It can also make new sounds and voice lines through ElevenLabs, with your own key.

EDGEwave builds on [REDcode for Cyberpunk 2077](https://marketplace.visualstudio.com/items?itemName=edgemodders.redcode-cyberpunk), which finds and plays the game's sounds and owns the mod project. Installing EDGEwave installs REDcode with it.

> **Preview.** Everything here is tested by hand, in the game where it applies. New features land in small updates. Please report problems on [GitHub](https://github.com/Edgemodders/EDGEwave/issues).

**What you need**
- Windows, and Cyberpunk 2077 (Steam, GOG or Epic).
- REDcode 0.10.0 or later, set up with its REDbridge (REDcode offers to download it).
- VS Code 1.90 or later.
- For the voice tools only: an [ElevenLabs](https://elevenlabs.io) account and API key. Each use spends your ElevenLabs credits.

## Getting started

1. In REDcode, open or create a mod project.
2. Find a sound: REDcode's **Browse Game Sounds**, play one, and click **Open in EDGEwave**. Or right-click a `.wav` or `.ogg` file > **Open Sound in EDGEwave…**.
3. EDGEwave saves a `.edgewave` document next to the sound in your project and opens it in its editor. The document holds your edits, not audio, so the game's sound is never changed on disk.
4. Edit and mix. **Render WAV** writes the mix as a WAV file.
5. **Into the Game…** puts the mix into the project, then **Pack** (REDcode's) builds the mod.

The **EDGEwave** icon in the activity bar lists your sound documents: the project's, and the ones you opened lately.

## The editor

| Part | What it does |
|---|---|
| **Clip** | The selected track's waveform. Select, zoom, play and loop. Trim, Cut, Copy, Paste, Silence, Fade in and out (three curves), Apply gain, Normalize, Mono or Stereo. Every edit is listed and can be removed; Ctrl+Z undoes |
| **Mix** | Several sounds on one timeline. **Add Sound** adds a game sound effect, a game file by its path, or a sound file. Drag a clip sideways to move it in time, a lane up or down to reorder. A checkbox per lane puts the track in the mix or leaves it out; right-click a lane for **Only This Track** and **All Tracks** |
| **Track** | Level, Pan, Rate (pitch and speed together) and Start, for the selected track |
| **Effects** | Per track and on the master: EQ, Low-pass, High-pass, Band-pass, Reverb, Distortion, Compressor. Presets: **Radio**, **Holocall**, **PA speaker**, **Muffled through a wall** |
| **Render** | A 16-bit WAV at the rate you pick, reverb tails included |

Drag the bar between the Track bar and the Clip bar to give the lanes more room.

## Into the game

**Into the Game…** asks what the mix should replace. It lists every game sound effect on a track, the tracks in the mix first:

| Route | What it does | Beside other mods |
|---|---|---|
| **Override sound `<hash>`** | Replaces that one sound (one variation of its event), through REDcode's Import | No: the last mod loaded wins |
| **Replace the event, every variation, with REDmod** | A REDmod custom sound: the game plays your mix for that audio event | Yes |
| **Silence the event, every variation, with REDmod** | The game plays silence for that event | Yes |
| **A REDmod custom sound for an event…** | For an event you name | Yes |

What goes in is the mix of the checked tracks; what it replaces is the row you pick. So a generated sound can replace a game sound left out of the mix. For the REDmod routes, turn on REDcode's `redcode.pack.redmod` setting, and start the game with REDcode's **Run Game** so REDmod deploys.

Voice lines (`.wem`) cannot go into the game as voice lines yet: making a `.wem` needs Wwise. A REDmod custom sound can still play a mix for an event.

## Voice tools (ElevenLabs)

| Button | What it makes |
|---|---|
| **Generate Sound…** | A sound effect from a description, with a length, Loop, and how closely to follow the prompt. Takes are kept in the dialog until you add one |
| **Speak Line…** | A line spoken in one of your ElevenLabs voices, or in the selected game line's voice |
| **Re-Voice…** | The selected line's words, timing and delivery in another voice: describe the change (such as `female, calm`) or pick one of your voices |

Set your key with **EDGEwave: Set ElevenLabs API Key**. It is kept in VS Code's secret storage. Using a game line's voice makes an instant voice clone in your ElevenLabs account; EDGEwave asks once before the first clone, reuses it for that line, and **EDGEwave: ElevenLabs Voices Made by EDGEwave…** lists the clones for deletion. A game line's voice belongs to a real voice actor: use clones only for your own mods, and follow ElevenLabs' terms.

**Translate** is planned.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `edgewave.elevenlabs.sampleRate` | 48000 | The rate the voice tools ask for. If your plan refuses it, EDGEwave uses 24000 from then on |
| `edgewave.elevenlabs.speechModel` | ElevenLabs' default | The model Speak Line starts with |
| `edgewave.elevenlabs.voiceChangerModel` | `eleven_multilingual_sts_v2` | The model Re-Voice starts with |
| `edgewave.elevenlabs.baseUrl` | `https://api.elevenlabs.io` | ElevenLabs' server, for data residency |

## License

MIT. EDGEwave contains no game files and nothing extracted from the game: it reads your own install through REDcode.
