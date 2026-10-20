# EDGEwave design

Status: **draft 2, 2026-10-14.** A1 Edit is done (2026-10-16): see [A1 Edit](a1-edit.html). A2 Mix and A3 Into the game are built (2026-10-16), hand tests pending: see [A2 Mix](a2-mix.html) and [A3 Into the game](a3-game.html).

EDGEwave is the sound studio of the EDGE platform: a VS Code extension where a Cyberpunk 2077 modder edits, mixes and re-voices sounds and puts them into a mod. It works beside [REDcode](https://github.com/Edgemodders/REDcode), which owns the mod project and the quick lookup of game sounds, and reads the game through REDbridge.

What changed from draft 1: REDcode shipped a game sound browser and an audio player (its C5 V2) on 2026-10-14, the day draft 1 was written. So the lookup moved to REDcode, and EDGEwave became the studio, built first; the deep search index comes after it.

## Goals

Asked for by the owner on 2026-10-14:

| Goal | Notes |
|---|---|
| A sound studio for modders | Edit, layer and mix sounds, with effects, and render the result |
| Open any sound from REDcode | REDcode finds and plays a sound; one button opens it in EDGEwave |
| Put the result into the mod | Override a game sound or add a new one, packed by REDcode |
| Voice tools through AI services | **Translate** a voice line to another language; **Re-Voice** a line, keeping the words and the delivery but changing the gender or style of the voice. Defined later; stub buttons for now |
| Quick search of game sounds | To add a sound as a clip in the studio |
| Later: index and search all of the game's audio | The part [SoundDB](https://gitlab.com/cp2077-sounddb/frontend) does: events, banks, switches, voice-over with subtitles, objects, radio |

## REDcode and EDGEwave

Decided by the owner on 2026-10-14 (option A): EDGEwave builds on REDcode and does not repeat it.

| | REDcode (lookup) | EDGEwave (studio) |
|---|---|---|
| Find a sound | **Browse Game Sounds**: the sound effects by event, filter by name, tag or hash | Quick search to add a clip; the full index later (A4) |
| Listen | The player for one sound (waveform, seek, loop, Save) | Playback in the editor, with the edits and the mix |
| Change a sound | Nothing: **Open in EDGEwave** | Edit, mix, effects, voice tools, render |
| Into the mod | Pack, install | Writes the render into the project in the layout the game loads (see "Into the game"), then calls REDcode's pack |

How they connect:

| Direction | How | Built by |
|---|---|---|
| REDcode to EDGEwave | **Open in EDGEwave** in REDcode's sound browser and player runs the command `edgewave.openSound` with a reference to the sound (below). If EDGEwave is not installed, the button offers to install it. A command, so REDcode never imports EDGEwave's code | REDcode, built (its issue #4, REDcode 0.9.0) |
| EDGEwave to REDcode | EDGEwave lists `edgemodders.redcode-cyberpunk` (REDcode's id since 0.8.2) in `extensionDependencies` and uses an API that REDcode exports from `activate()`, as REDcode uses EDGEdeck's `EDGEdeckApi`: the bridge, the sound effect index, a sound as audio bytes, the open project, import and pack. Contract: REDcode's `docs/api.md` (`REDcodeApi` version 1) | REDcode, built (its issue #4, REDcode 0.9.0) |

Both were changes in REDcode, requested in its issue #4 and built by REDcode's session (2026-10-15).

A sound reference, as `edgewave.openSound` takes it (a proposal):

| Kind | Fields | Example |
|---|---|---|
| Game file | `path` | A voice line, `base\localization\en-us\vo\...wem` |
| Sound effect | `soundHash`, optionally `eventHash` | A variation of an event in `sfx_container.opusinfo` |
| Project file | `uri` | A `.wem`, `.opus`, `.wav`, `.ogg`, `.mp3` or `.flac` in the project |

## How the game stores audio

Settled by REDcode's C5 V2 against the game (REDcode `docs/design/view.md`), except where marked.

| Piece | Where | Read today by |
|---|---|---|
| Voice lines and some music, `.wem` with readable paths | `lang_en_voice.archive` (most), `audio_1_general.archive` | REDbridge's `project.export` writes Ogg Vorbis in about 0.1 s |
| Sound effects: 73,139 sounds in 1,879 `.opuspak` files | `audio_2_soundbanks.archive`, indexed by `sfx_container.opusinfo` | REDcode: each sound is a RIFF header and a plain Ogg Opus stream |
| Event names | The index groups sounds under event hashes (Wwise's FNV-1 of the lower-case name) | REDbridge 0.7.2 `sound.events`, WolvenKit's list for game 1.6: 14,476 of 20,569 groups named |
| Wwise sound banks, 202 `.bnk` | `audio_2_soundbanks.archive` | Nothing yet. They hold events and the sounds they act on, with switches (`game_language:en`), parameters (`veh_speed`) and delays |
| Subtitles and scenes | Localization JSON per actor, with female and male variants; scene files tie lines to voice files | REDcode's CR2W editor opens the files; no search over them yet |
| TweakDB | Objects (weapons, vehicles) refer to audio metadata and events; radio stations list their events and tracks | REDbridge's planned `tweakdb` methods (its issues #3 and #4) |

## The studio

Source markers: O, asked for by the owner. E, what being part of EDGE adds. D, from SoundDB's documentation (the search side, under "The index" below).

### The sound document

An edit or a mix is saved as a sound document: JSON that names its sources and lists the edits, never the audio itself. The audio is fetched again through REDcode when the document opens, so the document holds no game data and is safe to commit to a mod's repository. Rendering writes the result as a WAV.

| Item | Proposal |
|---|---|
| File | `<name>.edgewave`, a VS Code custom editor (the extension's name is a proposal) |
| Sources | Sound references as above, plus files the modder adds |
| Where, for an override | Beside the render in `source/raw`, named after what it replaces. How the render becomes a game file depends on the kind of sound; see "Into the game" |
| Where, for a new sound | Any folder in the project |

### Features

| Group | Feature | Source |
|---|---|---|
| Edit | Waveform with zoom, selection and seek; trim, cut, splice | O |
| Edit | Fade in and out, gain, normalize, mono and stereo, resample | O |
| Edit | Loop points, for sounds the game loops | O |
| Edit | Undo and redo through VS Code; the edits are non-destructive | E |
| Mix | Tracks, each a clip with offset, gain and pan; a checkbox for each, in the mix or not (it was mute and solo until 2026-10-19) | O |
| Mix | Add a clip by a quick search of the game's sounds (REDcode's index) or from a file | O |
| Effects | EQ and filters, pitch and speed, reverb, distortion | O |
| Effects | Presets modders reach for: radio, holocall, PA speaker, muffled through a wall | O |
| Voice | **Generate Sound**, **Speak Line** and **Re-Voice** through ElevenLabs (V1); **Translate** a stub for now (below) | O |
| Render | To WAV in the project; to the game's formats in A3 | O |

### How it is built

| Part | Choice |
|---|---|
| Editor | A VS Code custom editor with a webview, like REDcode's player |
| Audio | The browser's Web Audio API in the webview: playback of the mix as it is edited, and `OfflineAudioContext` to render. Filters, EQ, reverb (our own impulse responses) and distortion are built-in nodes |
| Decoding | REDcode supplies each source as Ogg Vorbis or WAV, which the webview decodes with `decodeAudioData`. **Opus does not decode in VS Code's webview** by either browser path (spike below), so REDcode (since 0.8.0) decodes Opus in the extension with opus-decoder (MIT, libopus in WebAssembly) and sends 16-bit WAV. EDGEwave takes that WAV through REDcode's API and needs no decoder of its own |
| Encoding | WAV only, written in plain TypeScript. Opus encoding is decided in A3. Candidates: WebCodecs' `AudioEncoder`, which encodes Opus in VS Code's webview (spike below; EDGEwave would write the Ogg pages), or `opusenc.exe` from opus-tools, which REDbridge already ships through WolvenKit's Modkit |
| Pitch without speed | Changing pitch and speed apart needs a time-stretch algorithm beyond Web Audio's built-in nodes; to choose in A2 |

### Into the game

Found on 2026-10-15 in WolvenKit's source (REDbridge's `external/WolvenKit`):

| Kind | How a modded sound gets in | Status |
|---|---|---|
| Sound effect, in an `.opuspak` | A WAV named after the sound's hash, encoded with `opusenc.exe` into a copy of the pack and a new `sfx_container.opusinfo` in the mod. REDbridge 0.9.0's `sound.importWavs` does it (over WolvenKit's `OpusTools`, REDbridge #6), and REDcode's Import calls it. Mods made this way do not combine: each carries the one shared index | Built in A3; untested in the game |
| An audio event, by name | REDmod custom sounds: the WAV in the mod's `customSounds` folder and an entry in its `info.json`, which the game plays for the event (or skips). Works beside other mods; drops the event's own Wwise logic | Built in A3; REDcode's pack must carry it (REDcode #8) |
| Voice line or music, a `.wem` | Modders re-encode with Wwise (unverified details); nothing here makes a `.wem` | No route yet |

Updated on 2026-10-16; the routes, the research and its sources are on [A3 Into the game](a3-game.html).

### Spike: decoding and encoding in VS Code's webview

Run on 2026-10-15 with a game voice line (Ogg Vorbis, exported by REDbridge) and a game sound effect (Ogg Opus, from `sfx_container_1829.opuspak`), in a webview of VS Code 1.142.0 (Electron 43.7.7, Chromium 150), with headless Chrome 154 as the control. No game data was kept.

| Check | VS Code 1.142 | Chrome 154 |
|---|---|---|
| `decodeAudioData`, Ogg Vorbis | Decodes | Decodes |
| `decodeAudioData`, Ogg Opus | `EncodingError` | Decodes |
| WebCodecs `AudioDecoder`, the game's Opus | `isConfigSupported` says yes, then `configure` fails: "Unsupported configuration" | Decodes |
| WebCodecs, Opus encoded in the same page and decoded back | `configure` fails the same way | Decodes |
| WebCodecs `AudioEncoder`, Opus | Encodes (one second of tone: 51 packets) | Not checked |
| WebCodecs `AudioEncoder`, Vorbis, FLAC, MP3 | Not supported | Not checked |
| `MediaRecorder` | WebM Opus only | Not checked |

So VS Code's build cannot decode Opus in a webview at all. The owner's retest of REDcode's player found the same on 2026-10-15, and REDcode 0.8.0 decodes Opus in the extension instead (see "How it is built").

## Voice tools

Asked for by the owner on 2026-10-14; defined on 2026-10-18 as three tools through [ElevenLabs](https://elevenlabs.io), with the modder's own API key, built as phase V1 ([V1 Voice tools](voice-tools.html)):

| Button | What it does |
|---|---|
| **Generate Sound…** | A sound effect from a text prompt, as a new track |
| **Speak Line…** | Text spoken in one of the modder's ElevenLabs voices, with previews, or in the selected voice line's voice (an instant clone) |
| **Re-Voice…** | On a voice line: the same words and delivery in another voice, by a described change (gender, age, emotion: a remix of the line's clone) or into a picked voice (speech-to-speech) |
| **Translate** | The same line spoken in another language. Still a stub, to be defined |

The owner's choices (2026-10-18): the key in VS Code's secret storage; cloning allowed behind a one-time consent check, since a game line's voice is a real voice actor's; these names; built before the first release.

## The index

The SoundDB part, after the studio. SoundDB's frontend and its extractor have no license file (checked 2026-10-14), which reserves every right by default; its backend is GPL-3.0. So this part is a clean-room implementation:

- EDGEwave never reads, copies or ports SoundDB's source code (frontend, extractor or backend).
- It never uses SoundDB's data files or its API. Its index is built on the player's machine from the player's game, as the rest of EDGE works. (Nor does the EDGE rule allow game data in a repository.)
- The spec below comes only from SoundDB's public documentation: the frontend's README and About page with its search guide, the extractor's README, the public API reference (endpoint and field names, as a description of the features), and screenshots. Each item is marked D.
- Zhincore's bachelor thesis on SoundDB describes the game's audio data. It is documentation and may be read for how the game's audio is organised; it is not a source of code. **Not yet read.**

The studio has no SoundDB counterpart, so the rule does not reach it.

| Feature | Source |
|---|---|
| Five collections: **sounds**, **events**, **objects** (TweakDB items with audio), **radios**, **subtitles** (voice-over lines) | D |
| Free text with the common fields searched by default; field terms (`event:q307_...`, `music:true`, `actor:Nancy`) | D |
| Operators: AND (`+`, the default), OR, NOT (`-`), IN a list, prefix (`"Cyberp"*`), boost (`^`) | D |
| Helper buttons below the search box: the most common values of a field, one click adds or removes the term | D |
| Filters for kind and V's gender | D, O |
| Paging, and a long-scroll mode | D |
| Fields of a sound: hash, music, stream type, delay, opus pack, generator, file name, defining bank, embedding bank, events (all, or per action such as `events.PLAY`), event tags, switches needed, parameters that control it | D |
| Fields of an event: hash, name, stopped by, tags, sounds it plays, switches it sets, radio and track | D |
| Fields of an object: tweak id, display name, audio metadata id, events | D |
| Fields of a radio: tweak id, name, event, tracks | D |
| Fields of a subtitle: id, path, scene, actor, addressee, context, expression, female and male lines, voice-over file, the language a line is spoken in | D |
| A details view per item, with links: event to sounds, sound to events, line to scene | D, O |
| The path of nodes that leads from an event to a sound | D (on SoundDB's to-do list) |
| Copy a hash or name; favorites | D |
| Open any result in the studio | E |
| Find a sound from a file open in the editor: an event name under the cursor in a script or `.ent` | E |

The index is built once per game version on the player's machine, in EDGEwave's storage, then searched offline. REDbridge reads the banks (new `sound.*` methods, agreed with REDbridge's session); EDGEwave indexes the records. About 90,000 sounds and events suggests an in-memory JavaScript index (MiniSearch or FlexSearch, MIT) with no native code; a spike with the real data decides. A small parser turns the query syntax into the engine's terms.

## Architecture

| Part | Role |
|---|---|
| **EDGEwave** (this repository, TypeScript) | The studio (custom editor, Web Audio), `edgewave.openSound`, later the index and its browser, and MCP tools |
| **REDcode** | Owns the mod project; finds and plays game sounds; supplies sources and imports and packs renders, through its exported API |
| **REDbridge** (GPL-3.0, its own program) | Reads the game for REDcode and EDGEwave. Has `sound.events` and `project.export`/`import`; later the bank methods for the index. New methods only by agreement with REDbridge's session |
| **REDnode** | Plays the game's own events in the running game (`game.audio.play`, tested); a package's own sounds once its [Sound API](https://edgemodders.github.io/REDnode/sound.html) exists (planned: next in REDnode's order) |

## Phases

| Phase | Builds | Test proves |
|---|---|---|
| **A0 Scaffold** | The repository: extension skeleton, docs site, this design | Done |
| **A1 Edit** | The REDcode request (Open in EDGEwave, REDcode's API); `edgewave.openSound`; the sound document and its editor with the edit features; render to WAV; the Translate and Re-Voice stub buttons | A game voice line opened from REDcode's browser, trimmed and faded, renders to a WAV in the project |
| **A2 Mix** | Tracks, effects and presets; quick search to add game sounds as clips | Two game sounds layered with the radio preset render to one WAV |
| **A3 Into the game** | Into the Game: overriding a sound effect in its `.opuspak` (REDbridge 0.9.0 `sound.importWavs` through REDcode's Import); REDmod custom sounds for an event, or a silence; voice lines researched, no route yet. No Opus encoder of EDGEwave's own was needed: REDbridge encodes | An edited sound plays in the game after REDcode packs the mod |
| **V1 Voice tools** | Generate Sound, Speak Line and Re-Voice through ElevenLabs: the client, the key in secret storage, the clone consent, the forms with previews, the `made` record | A generated sound, a spoken line and a re-voiced game line, each a track that renders |
| **A4 Index** | REDbridge bank methods; the index; the query language; search with fields, filters and paging; details with links | A search for an event name finds its sounds, switches and parameters |
| **A5 Voices and objects** | Subtitles and scenes; TweakDB objects and radios; V's gender filter | A line of dialogue is found by its text and opened in the studio |
| **A6 EDGE** | MCP tools for agents; play an event in the running game through REDnode; a REDnode package's own sounds once its Sound API exists | An agent finds and edits a sound; an event plays in the running game from EDGEwave |

## Research

| Before | Question | How to find out |
|---|---|---|
| Later | A time-stretch algorithm (pitch without speed) with a clear license: Signalsmith Stretch (MIT, unverified) is a candidate. Deferred from A2 by the owner on 2026-10-16; A2's Rate changes pitch and speed together | Public libraries |
| A3 test | Whether the game plays an override, and which WAV formats REDmod's deploy accepts (EDGEwave writes 48 kHz, 16-bit) | The A3 hand test |
| Later | Voice lines: a `.wem` through the modder's own Wwise install (its command line), or REDnode's Sound API | Wwise's documentation; REDnode's S1 |
| A4 | How events, sounds and switches are laid out in banks; whether WolvenKit reads banks; wwiser's license | Wwise's public documentation, Zhincore's thesis, WolvenKit's code, the data through REDbridge |
| A4 | The search engine | A spike with the real index size |
