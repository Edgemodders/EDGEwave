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
| `playEvent({ name, project?, show?, inGame? })` | Plays an event's sound effect recordings in EDGEwave's **Hear** panel: `{ ok: true, where: "archive", variations }`; a project sound plays its WAV (`where: "project"`). A music cue, or an event with no recordings, plays in the running game through REDnode (`where: "game"`, `playingId`), or gives `{ ok: false, reason }` when the game is not running with REDnode 0.43 or later. `inGame: true` plays any event in the game, a project's own after Pack and Install too; see [In the running game](#in-the-running-game). With `show: false` ([#8](https://github.com/Edgemodders/EDGEwave/issues/8), added 2026-10-26), see [Playing with no tab](#playing-with-no-tab) |
| `stopSound()` | Stops the sound `playEvent` is playing with `show: false`, and the one it started in the game, if any. Also the command **EDGEwave: Stop Sound** |
| `customSound({ project?, wav, name, kind? })` | A sound as a new event a quest can post: `{ event, file, type, note }`, or `{ reason }`. See [A new event](#a-new-event) |
| `speakLine({ text, character?, gender?, voice?, delivery?, model?, take?, outDir?, project?, by? })` | One line spoken through ElevenLabs with when each character is spoken, for lip sync ([#13](https://github.com/Edgemodders/EDGEwave/issues/13), EDGEfab's Lip Sync, added 2026-11-20). See [Speaking a line with timings](#speaking-a-line-with-timings) |

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

**Hearing an event:** sound effects play from the archive through REDcode, in the **Hear** panel: the raw recordings, without the game's effects. Music cues live in Wwise's sound banks, which EDGEwave reads only from A4: they play in the running game, with the game's own mix (below).

### In the running game

Added 2026-10-27, with REDnode 0.43.0's editor channel ([REDnode #17](https://github.com/Edgemodders/REDnode/issues/17)); `src/rednodeEditor.ts`.

| | |
|---|---|
| How | While the game runs with REDnode, REDnode writes `%LOCALAPPDATA%\REDnode\editor.json` with a local port and a token made new each run. EDGEwave reads it and posts `sound.play { name, on: "player" }`: the game plays the event on V, as a quest would, with its mix and effects |
| When | `playEvent` on a music cue or an event with no recordings; `playEvent({ name, inGame: true })` for any event; Game Assets' right-click **Play in the Game** |
| Again | The next sound EDGEwave plays in the game stops the one before. `stopSound()` and **EDGEwave: Stop Sound** stop it |
| No game | `{ ok: false, reason }`: start the game with REDnode 0.43 or later. Also when `editor.json` is left from a game that ended (its process is gone), the connection is refused, or the player turned the channel off. While the game is still loading: wait, then try again |
| Not checked by the game | REDnode's channel plays nothing for a name the game does not know, and does not say so |

*Unverified until the hand test:* that every music cue starts this way (a `_START` cue may need its `_STOP` to end; Stop Sound stops what EDGEwave started).

## A new event

`customSound` makes a WAV into a REDmod custom sound under a new event name, `edgewave_<name>`. It writes the WAV to `source/customSounds/<event>.wav` (48 kHz, 16-bit, its channels kept) and adds the entry to `source/resources/info.json`, as Add to Project's REDmod route does.

| `kind` | REDmod type | |
|---|---|---|
| `sfx` (default) | `mod_sfx_low_occlusion` | A long attenuation, not muffled: the wiki's type for a quest sound |
| `music` | `mod_sfx_2d` | No position. REDmod has no music type, so it follows the **effects** slider, not the music one, and no music state |

Unverified: that a quest phase's `questAudioEventNodeType` or a scene's `scnAudioEvent` plays a new event name. REDmod can add new events (the wiki), and scripts post them. EDGEquest's test quest will check it ([#7](https://github.com/Edgemodders/EDGEwave/issues/7)). The game reads custom sounds when it starts, and REDcode packs them only with `redcode.pack.redmod` on.

## Speaking a line with timings

Added 2026-11-20 for EDGEfab's Lip Sync tab ([#13](https://github.com/Edgemodders/EDGEwave/issues/13)), as agreed with the owner the same day. `src/speakLine.ts` (the core, which the MCP server runs too) and `src/speakLineHost.ts` (VS Code).

| In | |
|---|---|
| `text` | The words. Audio tags such as `[whispers]` are read on `eleven_v3` and taken out for other models |
| `character` | The game's voice tag (`judy`, `angelica_whelan`; `v` for V, with `gender`). Its voice comes from EDGEwave's **character voices** (below) |
| `gender` | `female` or `male`, for V. Without it, V's female voice |
| `voice` | An ElevenLabs voice id, in place of `character` |
| `delivery` | How it is spoken, such as `"tired, quiet"`: on `eleven_v3` a tag in front, `[tired, quiet] …`; other models do not read one, and `notes` says it was left out |
| `model` | Default `eleven_v3` |
| `take` | A take kept before, by its number; `"new"` for another; absent, the last one kept, or a first one |
| `outDir` | Keep the take here, in place of EDGEwave's folder |
| `project` | Only to find a voice Voice Lines chose for this speaker. Nothing is written into a project |
| `by` | The calling tool's name, for the one-time question (below) |

Out, a take or `{ reason }` in plain words (no key, no voice picked, the modder said no):

```ts
{
  wav: string;          // full path, mono 16-bit PCM WAV, 48 kHz (24 kHz when the plan refuses 48)
  seconds: number;
  timings: {
    characters: string[]; starts: number[]; ends: number[];  // seconds from the WAV's first sample
    spoken: boolean[];  // false inside an audio tag, brackets included: skip those for mouth shapes
    normalized?: { characters; starts; ends; spoken };       // ElevenLabs' alignment of the text as it read it, when it differs
  };
  timingsFile: string;  // <take>.timings.json, beside the WAV
  voice: { id: string; name?: string };
  model: string;
  take: number;
  sent: string;         // the text as sent: with the delivery tag on v3
  characters: number;   // what ElevenLabs counted; 0 for a kept take
  cached: boolean;      // a take kept from before, free
  notes: string[];
}
```

| | |
|---|---|
| Where takes are kept | `%LOCALAPPDATA%\EDGEwave\lines\<character>\<words>-<10 hex>-<take>.wav`, with `<same>.timings.json` (the text, what was sent, the voice, the model, the rate and the timings). The same words, delivery, voice and model share the name; another voice or model is another line |
| Character voices | One list for every tool, `%LOCALAPPDATA%\EDGEwave\characters.json`, by voice tag (`v:female`, `v:male` for V). For a character not in it, EDGEwave first takes the voice a project's Voice Lines chose for a speaker of that name. Else it shows its voice picker: one of the account's voices, or **Clone <character>'s voice from their game lines** (up to a minute of their English lines from the archives, joined, cloned once, behind the one-time clone consent). Voice Lines offers each speaker's voice to the list when it is picked. **EDGEwave: Character Voices…** shows, changes or forgets them |
| Cost | Before a tool's first line that spends credits, EDGEwave asks once whether that tool (`by`) may, with the line's cost; the answer is kept for that tool. A kept take costs nothing and asks nothing |
| Voice Lines | Its takes keep the same `<take>.timings.json` beside each WAV since 2026-11-20 (the same request, the same price), moved with the take to `.previous` and back. Takes made before have none |

**Checked with the owner's key** (2026-11-20, 124 characters):

| Line | Took | Length, last `ends` | First spoken letter's `starts` | First sound in the WAV |
|---|---|---|---|---|
| `eleven_v3`, delivery `suspicious` and an inline `[whispers]` | 1.2 s | 2.880 s, 2.888 | 0.464 s (the tag's characters take 0 to 0.32 s) | 0.12 s |
| `eleven_multilingual_v2`, "Home at 9." | 0.47 s | 2.229 s, 2.229 | 0 | 0.08 s |
| `eleven_v3`, a voice EDGEwave cloned | 1.3 s | 2.960 s, 2.960 | 0 | 0.06 s |

Every model gave timings, the cloned voice too, at 48 kHz on the owner's plan. Times count from the WAV's first sample: the first character starts at 0 and the last ends at the WAV's length. Audio tags are in the alignment with times of their own, so `spoken` matters. On `eleven_v3` after a tag, the first spoken letter is placed later (0.46 s) than the voice is heard (0.12 s): *unverified* which is right, so a lip sync may start a little late after a tag. `eleven_multilingual_v2` gave a `normalized` alignment with spaces around the text and the number as typed ("9", not "nine").

Not built yet ([#13](https://github.com/Edgemodders/EDGEwave/issues/13), later): timings for a line re-voiced or recorded (forced alignment), and speaking from a package outside VS Code.

## The MCP server

`edgewave-mcp` ships inside the extension. On start EDGEwave copies it to `%LOCALAPPDATA%\EDGEwave\mcp\edgewave-mcp.cjs`, a path that stays the same across updates. VS Code 1.101 and later see it through their own MCP support, with the ElevenLabs key from secret storage. **EDGEwave: Connect an Assistant (MCP)…** registers it with Claude Code (`claude mcp add --scope user edgewave`), or copies the command or a JSON entry for other clients. It asks before it gives the client the ElevenLabs key, which the client keeps in plain text.

| Tool | Writes | |
|---|---|---|
| `voice_lines` | Yes | `{ project, quest, lines, voices?, redo?, model?, archiveDir? }`: voices the lines that need it (or all with `redo`) and saves `voice.json`. Returns each line's status and files, the characters sent (what ElevenLabs counts), the model and the rate. **No ask-first flag**: the owner allowed assistants to voice lines (2026-10-23). It spends ElevenLabs credits |
| `voice_status` | No | `{ project, quest, lines? }`: with lines, made, stale or none for each, and the voices. Without, the whole `voice.json` |
| `voice_voices` | No | `{ search? }`: the ElevenLabs account's voices, with labels and a preview URL |
| `sound_events` | No | `{ query?, music?, quest?, limit?, project? }`: as `soundEvents`, from the index EDGEwave built; with `project`, its own sounds first. Before VS Code has built the index, it says so |
| `sound_custom` | Yes | `{ project, wav, name, kind? }`: as `customSound` |
| `voice_speak_line` | Yes | `{ text, character?, gender?, voice?, delivery?, model?, take?, outDir? }`: as `speakLine`. The character's voice must be in the character voices list (set in VS Code); else it says so. No one-time question: assistants may voice lines (the owner, 2026-10-23). Spends credits for a new take |

It needs no VS Code to run. Settings (`edgewave.voiceLines.model`, `edgewave.elevenlabs.sampleRate`, `edgewave.elevenlabs.baseUrl`, `redcode.pack.redmod`) come from VS Code's user settings file. The key comes from `ELEVENLABS_API_KEY`. Logs go to stderr.
