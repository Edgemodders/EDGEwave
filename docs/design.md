# EDGEwave design

Status: **draft 1, 2026-10-14.** Phase A0 (the scaffold and this design). Nothing past the scaffold is built.

EDGEwave is a VS Code extension with sound tools for Cyberpunk 2077 modding. It runs beside [REDcode](https://github.com/Edgemodders/REDcode) as part of a modder's workflow on the EDGE platform. It finds, explains and plays the game's audio, and puts a sound into the mod being made.

## Goals

Asked for by the owner on 2026-10-14:

| Goal | Notes |
|---|---|
| Index and search all of the game's audio | Sound effects, voice-over, music, radio |
| Show the details of an audio asset | Which events play or stop it, its bank, tags, switches, parameters; for voice, the subtitle lines and scene |
| Play game sounds | A preview in VS Code |
| Add or override game sounds in the open REDcode mod | Also reachable from REDcode's Game Assets explorer; EDGEwave adds the sound-aware path |
| Filter by kind | Sounds, voice-over, music, and more |

The model is [SoundDB](https://gitlab.com/cp2077-sounddb/frontend) (Cyberpunk 2077 SoundDB, by Zhincore), a website that does the searching and listening part. EDGEwave is a clean-room implementation of the same idea, inside the editor, working from the player's own game, and joined to the rest of EDGE.

## Clean-room rule

SoundDB's frontend and its extractor have no license file (checked 2026-10-14), which reserves every right by default; its backend is GPL-3.0. So:

- EDGEwave never reads, copies or ports SoundDB's source code (frontend, extractor or backend).
- It never uses SoundDB's data files or its API. Its index is built on the player's machine from the player's game, as the rest of EDGE works. (Nor does the EDGE rule allow game data in a repository.)
- The spec below comes only from SoundDB's public documentation: the frontend's README and About page with its search guide, the extractor's README, the public API reference (endpoint and field names, as a description of the features), and screenshots. Each spec item says where it came from.
- Zhincore's bachelor thesis on SoundDB describes the game's audio data. It is documentation and may be read for how the game's audio is organised; it is not a source of code. **Not yet read.**

## How the game stores audio

From SoundDB's documentation and the extractor's README; to confirm in research.

| Piece | What it is |
|---|---|
| Wwise | The game's audio engine. Sounds are played by **events** (`q307_09_cutscene_intro_alone`) that act on sounds: play, stop, and more |
| Sound banks (`.bnk`) | Define events and the sounds they act on, with switches (`game_language:en`), parameters (`veh_speed` controls volume) and delays. A sound is defined in one bank and may be embedded in another |
| Media (`.wem`) | Wwise audio files, in the game's archives |
| Opus packs (`.opuspak`, `.opusinfo`) | Packs of Opus audio, used for voice-over and sound effects; a sound records which pack holds it |
| Stream types | How a sound is loaded: generated, external source, preloaded, prefetch streaming, streaming. Some sounds are generated (silence, sine, a voice-receive effect) and have no file |
| Subtitles and scenes | Localization JSON with the lines, per actor, with a female and a male variant; scene files tie them to voice-over files |
| TweakDB | Objects (weapons, vehicles) refer to audio metadata and the events they use; radio stations list their events and tracks |

## Feature spec

D: from SoundDB's documentation. O: asked for by the owner. E: what being part of EDGE adds.

### Search

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
| Copy a hash or name; favorites | D |
| Find a sound from REDcode's Game Assets explorer or a file open in the editor (a `.wem`, an event name under the cursor in a script or `.ent`) | E |

### Details and listening

| Feature | Source |
|---|---|
| A details view per item, with links between items: event to sounds, sound to events, line to scene | D, O |
| The path of nodes that leads from an event to a sound | D (on SoundDB's to-do list) |
| Preview playback, with play, stop and seek; a waveform | D, O |
| Full quality on demand, not only previews | O (SoundDB says its previews are low quality) |
| Play an event in the running game, through REDnode | E, needs REDnode (below) |

### Using a sound in a mod

| Feature | Source |
|---|---|
| Export a sound to the open REDcode project as an editable file (WAV) | O |
| Override a game sound: put a replacement in the project in the layout the game loads, and pack it with REDcode | O, research which layouts work (archive override of `.wem` or Opus, REDmod custom sounds) |
| Add a new sound for a REDnode package | O, waits for REDnode's Sound API (below) |
| Agents can search and describe sounds (an MCP tool) | E |

## Architecture

| Part | Role |
|---|---|
| **EDGEwave** (this repository, TypeScript) | Commands, the browser as a webview, the search index, playback, the hand-off to REDcode |
| **REDbridge** (GPL-3.0, its own program) | Reads the game: archives, banks, Opus packs, TweakDB, localization and scenes; converts audio to WAV. Reached over JSON-RPC, as REDdeck and REDcode reach it. New methods go there as an `audio` group, by agreement with REDbridge's owner session |
| **REDcode** | Owns the mod project: EDGEwave calls REDcode's commands or API to add files, as REDdeck does |
| **REDnode** | Plays events in the running game and, later, a package's own sounds. Its [Sound API](https://edgemodders.github.io/REDnode/sound.html) is **planned, not built**: phases S1 to S4, after REDnode's TweakDB API and Spaces |

### The index

Built once per game version on the player's machine, in EDGEwave's storage, then searched offline. The building happens in REDbridge (it already loads the archive index in about three seconds); the result is a set of JSON records per collection that EDGEwave indexes for search. Options for the search engine, to decide in A1:

| Option | For | Against |
|---|---|---|
| A JavaScript full-text index (MiniSearch or FlexSearch, MIT) | No native code; works in any VS Code | The whole index in memory; SoundDB's sound collection alone holds about 79,000 items |
| SQLite FTS5 | Fast, on disk | A native module, or Node's built-in SQLite, which VS Code's Node may not offer yet |
| Our own inverted index | Exactly the query syntax we want | More code |

The query syntax follows the spec above whatever the engine; a small parser turns it into the engine's terms.

## Phases

| Phase | Builds | Test proves |
|---|---|---|
| **A0 Scaffold** | This repository: the extension skeleton, the docs site, this design | Done when this design is agreed |
| **A1 Index** | REDbridge's `audio` methods (banks, events, sounds, Opus packs); the index; the browser with search, fields, filters and paging | A search for an event name finds its sounds, from the player's own game |
| **A2 Listen** | Decoding to WAV through REDbridge, a cache, playback in the webview, the details view with links | Clicking a result plays it; the details show its events, bank and switches |
| **A3 Voices and objects** | Subtitles and scenes, TweakDB objects and radios, V's gender filter | A line of dialogue is found by its text and played |
| **A4 Mod** | Export and override into the open REDcode project | A replaced sound plays in the game after REDcode packs the mod |
| **A5 EDGE** | The MCP tool for agents; play in the running game through REDnode; a REDnode package's sounds once REDnode's Sound API exists | An agent finds a sound; an event plays in the running game from EDGEwave |

## Research before A1

| Question | How to find out |
|---|---|
| What WolvenKit already reads: archives yes; Opus packs (WolvenKit has Opus tooling), Wwise banks (the extractor uses a separate bank parser, wwiser), `.wem` decoding (REDbridge ships vgmstream's library for WolvenKit) | Read WolvenKit's and REDbridge's own code and docs, which are open source and ours to use |
| The licenses of any tool EDGEwave or REDbridge would ship (wwiser, vgmstream) | Their repositories |
| How events, sounds and switches are laid out in banks | Wwise's public documentation, Zhincore's thesis, and the data itself through REDbridge |
| How a mod overrides a game sound today (archive override, REDmod custom sounds) and which REDcode can pack | REDmod's documentation, REDcode's pack (its S1) |
| The search engine (table above) | A spike with the real index size |
| Whether VS Code webviews play WAV and Ogg (Chromium does; VS Code's build has some codecs removed) | A spike |
