# EDGEwave design

Status: **draft 2, 2026-10-14.** Phase A0 (the scaffold and this design). Nothing past the scaffold is built.

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
| Into the mod | Import (`.wav` to `.wem` through WolvenKit's Modkit), pack, install | Writes the render into the project and calls REDcode's import and pack |

How they connect:

| Direction | How | Built by |
|---|---|---|
| REDcode to EDGEwave | **Open in EDGEwave** in REDcode's sound browser and player runs the command `edgewave.openSound` with a reference to the sound (below). If EDGEwave is not installed, the button offers to install it. A command, so REDcode never imports EDGEwave's code | REDcode, by request |
| EDGEwave to REDcode | EDGEwave lists `edgemodders.redcode` in `extensionDependencies` and uses an API that REDcode exports from `activate()`, as REDcode uses REDdeck's `REDdeckApi`: the bridge, the sound effect index, a sound as audio bytes, the open project, import and pack | REDcode, by request |

Both are changes in REDcode, so they go to REDcode as a request issue with the shape that would work, and REDcode's session builds them. The API's exact shape is agreed there.

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
| Where, for an override | Beside the render in `source/raw`, at the game file's own path: `source/raw/<path>.edgewave` renders `source/raw/<path>.wav`, which REDcode's import turns into `source/archive/<path>.wem`. Unverified for audio: the round trip is tested in A3 |
| Where, for a new sound | Any folder in the project |

### Features

| Group | Feature | Source |
|---|---|---|
| Edit | Waveform with zoom, selection and seek; trim, cut, splice | O |
| Edit | Fade in and out, gain, normalize, mono and stereo, resample | O |
| Edit | Loop points, for sounds the game loops | O |
| Edit | Undo and redo through VS Code; the edits are non-destructive | E |
| Mix | Tracks, each a clip with offset, gain and pan; mute and solo | O |
| Mix | Add a clip by a quick search of the game's sounds (REDcode's index) or from a file | O |
| Effects | EQ and filters, pitch and speed, reverb, distortion | O |
| Effects | Presets modders reach for: radio, holocall, PA speaker, muffled through a wall | O |
| Voice | **Translate** and **Re-Voice** buttons on a voice line, stubs for now (below) | O |
| Render | To WAV in the project; to the game's formats in A3 | O |

### How it is built

| Part | Choice |
|---|---|
| Editor | A VS Code custom editor with a webview, like REDcode's player |
| Audio | The browser's Web Audio API in the webview: playback of the mix as it is edited, and `OfflineAudioContext` to render. Filters, EQ, reverb (our own impulse responses) and distortion are built-in nodes |
| Decoding | REDcode supplies each source as Ogg (Vorbis or Opus) or WAV; the webview decodes it. Unverified: that `decodeAudioData` in VS Code's webview decodes Ogg Opus and Vorbis (the `<audio>` element plays both) |
| Encoding | WAV only, written in plain TypeScript. Opus or Vorbis encoding is decided in A3: a WebAssembly encoder in EDGEwave, or a REDbridge method |
| Pitch without speed | Changing pitch and speed apart needs a time-stretch algorithm beyond Web Audio's built-in nodes; to choose in A2 |

## Voice tools

Asked for by the owner on 2026-10-14, to be defined in detail later. For now they are two stub buttons in the editor's layout, on a voice line (a sound from a `lang_*_voice` archive, or any clip the modder marks as voice):

| Button | The idea |
|---|---|
| **Translate** | The same line spoken in another language |
| **Re-Voice** | The same words and delivery in a different voice: another gender or style |

Both will call third-party services, likely with the modder's own API key. Until they are defined, the buttons say the feature is planned. Their phase is set when they are defined.

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
| **A0 Scaffold** | The repository: extension skeleton, docs site, this design | Done when this design is agreed |
| **A1 Edit** | The REDcode request (Open in EDGEwave, REDcode's API); `edgewave.openSound`; the sound document and its editor with the edit features; render to WAV; the Translate and Re-Voice stub buttons | A game voice line opened from REDcode's browser, trimmed and faded, renders to a WAV in the project |
| **A2 Mix** | Tracks, effects and presets; quick search to add game sounds as clips | Two game sounds layered with the radio preset render to one WAV |
| **A3 Into the game** | Overriding a voice `.wem` through REDcode's import; overriding a sound effect in an `.opuspak` (research); REDmod custom sounds; Opus or Vorbis encoding decided and built | An edited sound plays in the game after REDcode packs the mod |
| **A4 Index** | REDbridge bank methods; the index; the query language; search with fields, filters and paging; details with links | A search for an event name finds its sounds, switches and parameters |
| **A5 Voices and objects** | Subtitles and scenes; TweakDB objects and radios; V's gender filter | A line of dialogue is found by its text and opened in the studio |
| **A6 EDGE** | MCP tools for agents; play an event in the running game through REDnode; a REDnode package's own sounds once its Sound API exists | An agent finds and edits a sound; an event plays in the running game from EDGEwave |

## Research

| Before | Question | How to find out |
|---|---|---|
| A1 | The shape of REDcode's API and of Open in EDGEwave | A request issue on REDcode, agreed with its session |
| A1 | Does `decodeAudioData` in VS Code's webview decode Ogg Opus and Vorbis? | A spike |
| A1 | Does REDcode's `.wav` import make a `.wem` the game plays, and does WolvenKit need Wwise installed for it? | REDbridge and WolvenKit code, then a test |
| A2 | A time-stretch algorithm (pitch without speed) with a clear license | Public libraries |
| A3 | How a mod overrides a sound effect in an `.opuspak` (rebuild the pack and its `.opusinfo`?), and REDmod's custom sounds | WolvenKit's Opus tooling and REDmod's documentation |
| A3 | Opus or Vorbis encoding: a WebAssembly encoder or a REDbridge method; the licenses | Their repositories |
| A4 | How events, sounds and switches are laid out in banks; whether WolvenKit reads banks; wwiser's license | Wwise's public documentation, Zhincore's thesis, WolvenKit's code, the data through REDbridge |
| A4 | The search engine | A spike with the real index size |
