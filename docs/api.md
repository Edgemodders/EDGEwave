# API and MCP

Status: **built 2026-10-24** for EDGEquest ([EDGEwave #5](https://github.com/Edgemodders/EDGEwave/issues/5) and [#7](https://github.com/Edgemodders/EDGEwave/issues/7)); hand test pending ([Tests](testing.html#v2-voice-a-quest)). Other EDGE tools reach EDGEwave in two ways: its **API**, for VS Code extensions, and its **MCP server**, for assistants. Both use the same code and the same files.

## The API

`activate()` returns it. Copy the interfaces into your extension; never import EDGEwave's code (EDGEwave does the same with REDcode's). The source of truth is `src/api.ts`.

```ts
const ext = vscode.extensions.getExtension("edgemodders.edgewave");
const api = ext && (ext.isActive ? ext.exports : await ext.activate());
if (api?.apiVersion === 1) { ... }
```

| Member | |
|---|---|
| `apiVersion` | `1` |
| `version` | EDGEwave's version |
| `voiceLines({ quest, lines, voices?, archiveDir?, project? })` | Opens [Voice Lines](voice-lines.html#the-voice-lines-panel) on these lines, adding them to the quest's panel when it is open. One line opens the panel on it. Resolves with `voice.json` when the panel closes. `lines` as in [the contract](voice-lines.html#the-contract). `project`: the project's folder, else REDcode's open project, else the workspace folder with `source/` |
| `voiceStatus(quest, project?)` | The quest's `voice.json`, with `voices`, or `undefined` when nothing is voiced yet |
| `soundEvents({ query?, music?, quest?, limit?, project? })` | The project's own named sounds, then the game's sound events, matching a query. See [Sound events](#sound-events) |
| `playEvent({ name, project?, show? })` | Plays an event's sound effect recordings in EDGEwave's **Hear** panel: `{ ok: true, where: "archive", variations }`; a project sound plays its WAV (`where: "project"`). A music cue, or an event with no recordings, gives `{ ok: false, reason }`. With `show: false` ([#8](https://github.com/Edgemodders/EDGEwave/issues/8), added 2026-10-26), see [Playing with no tab](#playing-with-no-tab) |
| `stopSound()` | Stops the sound `playEvent` is playing with `show: false`, if one is. Also the command **EDGEwave: Stop Sound** |
| `customSound({ project?, wav, name, kind? })` | A sound as a new event a quest can post: `{ event, file, type, note }`, or `{ reason }`. See [A new event](#a-new-event) |

## Playing with no tab

`playEvent({ name, show: false })` plays at once, for a picker's ▶. No tab opens or comes forward.

| | |
|---|---|
| What plays | One recording, picked at random as the game does: `played` in the result names it (the sound's number, or a project sound's file). The Hear panel (`show` left out) still has all of them |
| Again | A second call stops the first sound and plays the new one. `stopSound()` stops it |
| How | A hidden Windows player in EDGEwave's extension host (a PowerShell with `System.Media.SoundPlayer`), not a webview, so no click is needed first. It starts when `soundEvents` is first called, or on the first play (about a second); later sounds start at once |
| Where it cannot | Not on Windows: `{ ok: false, reason }`; call again without `show: false` for the Hear panel. A recording REDcode does not give as WAV, a music cue, or an event with no recordings: a reason, as with the panel |

*Unverified:* that the hidden player is heard on every Windows setup. It plays through Windows' default output device, whatever VS Code's own sound uses.

## Sound events

The list is the game's own: `base\sound\event\eventsmetadata.json` (an `audioAudioEventArray`). In game 2.31 it names **every** event: 23,634 entries, 23,530 names. Each has its Wwise id (FNV-1 32 of the lower-case name; true for every one), its min and max length, whether it loops, and tags. REDbridge's older list (`sound.events`, from WolvenKit for game 1.6) names 14,476 of 20,569 groups.

EDGEwave reads the file through REDcode's bridge (`cr2w.toJson`) the first time it is asked. It keeps a small index (3.3 MB) in its own folder, `%LOCALAPPDATA%\EDGEwave\events.json`, where the MCP server reads it too. It builds it again when the game's `audio_1_general.archive` changes. The index is built from the player's game and never shipped or committed.

| Query field | |
|---|---|
| `query` | Words that must all be in the name, or be one of its tags. A decimal number finds an event by its hash |
| `music` | `true`: only music cues (a `mus_` name, or a `music_quests_events`, `quest_music_start` or `quest_music_stop` tag; 1,741 in 2.31). `false`: no music |
| `quest` | Only events tagged for quests: the music tags and `sfx_quest_events` (790 in 2.31). Quests post other events too |
| `limit` | 50 by default, up to 1,000 |

Each result: `name`, `hash`, `loops`, `min`, `max` (seconds), `tags`, `music`, `quest`, and `sounds` (the variations REDcode's index has, for sound effects).

**The project's own sounds come first** (added 2026-10-24): every REDmod custom sound in the project's `source/resources/info.json` (`project`, else REDcode's open project), made with Add to Project's [A new sound for this project](a3-game.html#a-new-sound-for-this-project) or `customSound`. Each has `project: { type, file }`, the tags `project` and its type, and its WAV's length as `min` and `max`. One under a game event's name is marked `replaces: true` and stands in that event's place, with the event's tags, so a picker shows what the game will play. The query matches them as it does the game's.

**Hearing an event:** sound effects play from the archive through REDcode, in the **Hear** panel: the raw recordings, without the game's effects. Music cues live in Wwise's sound banks, which EDGEwave reads only from A4. They will play in the running game, with the game's own mix, once REDnode can be asked from VS Code ([REDnode #17](https://github.com/Edgemodders/REDnode/issues/17), requested 2026-10-24).

## A new event

`customSound` makes a WAV into a REDmod custom sound under a new event name, `edgewave_<name>`. It writes the WAV to `source/customSounds/<event>.wav` (48 kHz, 16-bit, its channels kept) and adds the entry to `source/resources/info.json`, as Add to Project's REDmod route does.

| `kind` | REDmod type | |
|---|---|---|
| `sfx` (default) | `mod_sfx_low_occlusion` | A long attenuation, not muffled: the wiki's type for a quest sound |
| `music` | `mod_sfx_2d` | No position. REDmod has no music type, so it follows the **effects** slider, not the music one, and no music state |

Unverified: that a quest phase's `questAudioEventNodeType` or a scene's `scnAudioEvent` plays a new event name. REDmod can add new events (the wiki), and scripts post them. EDGEquest's test quest will check it ([#7](https://github.com/Edgemodders/EDGEwave/issues/7)). The game reads custom sounds when it starts, and REDcode packs them only with `redcode.pack.redmod` on.

## The MCP server

`edgewave-mcp` ships inside the extension. On start EDGEwave copies it to `%LOCALAPPDATA%\EDGEwave\mcp\edgewave-mcp.cjs`, a path that stays the same across updates. VS Code 1.101 and later see it through their own MCP support, with the ElevenLabs key from secret storage. **EDGEwave: Connect an Assistant (MCP)…** registers it with Claude Code (`claude mcp add --scope user edgewave`), or copies the command or a JSON entry for other clients. It asks before it gives the client the ElevenLabs key, which the client keeps in plain text.

| Tool | Writes | |
|---|---|---|
| `voice_lines` | Yes | `{ project, quest, lines, voices?, redo?, model?, archiveDir? }`: voices the lines that need it (or all with `redo`) and saves `voice.json`. Returns each line's status and files, the characters sent (what ElevenLabs counts), the model and the rate. **No ask-first flag**: the owner allowed assistants to voice lines (2026-10-23). It spends ElevenLabs credits |
| `voice_status` | No | `{ project, quest, lines? }`: with lines, made, stale or none for each, and the voices. Without, the whole `voice.json` |
| `voice_voices` | No | `{ search? }`: the ElevenLabs account's voices, with labels and a preview URL |
| `sound_events` | No | `{ query?, music?, quest?, limit?, project? }`: as `soundEvents`, from the index EDGEwave built; with `project`, its own sounds first. Before VS Code has built the index, it says so |
| `sound_custom` | Yes | `{ project, wav, name, kind? }`: as `customSound` |

It needs no VS Code to run. Settings (`edgewave.voiceLines.model`, `edgewave.elevenlabs.sampleRate`, `edgewave.elevenlabs.baseUrl`, `redcode.pack.redmod`) come from VS Code's user settings file. The key comes from `ELEVENLABS_API_KEY`. Logs go to stderr.
