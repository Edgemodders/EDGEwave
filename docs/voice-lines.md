# V2 Voice a quest

Status: **steps 1 to 4 built 2026-10-24**, for [EDGEwave #5](https://github.com/Edgemodders/EDGEwave/issues/5) (EDGEquest's Q4 and Q6); hand test pending ([Tests](testing.html#v2-voice-a-quest)). The plan is agreed with the owner (2026-10-23 and 24). EDGEquest [confirmed the contract](https://github.com/Edgemodders/EDGEwave/issues/5#issuecomment-6376619865) on 2026-10-23, adding `say`, `direction` and one line at a time. Step 5, the `.wem` route, is next; its spike is done: [below](#the-wem-spike) and in [Tests](testing.html#spike-wav-to-wem-with-wwise).

EDGEquest writes a quest's dialogue: each new line has an id, a speaker and text. EDGEwave gives those lines a voice, and the game plays it as a real voice line. The modder asks EDGEquest for a quest, or EDGEquest's assistant works through the quest's checklist, and the checklist's `voice/<scene>` item ticks itself once every line in the scene has its voice.

## The order

| Step | What | Status |
|---|---|---|
| 1. The contract | The lines EDGEquest passes in, the WAVs and `voice.json` EDGEwave writes. [Below](#the-contract) | Built 2026-10-24 |
| 2. **Voice Lines…** | One panel per quest, lines by scene. [Below](#the-voice-lines-panel) | Built 2026-10-24 |
| 3. The exported API | `voiceLines` and `voiceStatus` from `activate()`, `apiVersion: 1`. [API and MCP](api.html) | Built 2026-10-24 |
| 4. `edgewave-mcp` | `voice_lines`, `voice_status`, `voice_voices`. [API and MCP](api.html#the-mcp-server). `voice_lines` has no ask-first flag: the owner decided an assistant may voice lines, since the person who asked EDGEquest for the quest is the one in the loop | Built 2026-10-24 |
| 5. The `.wem` route | Each take to a `.wem` through the modder's own Wwise 2023.1.14, under the mod's archive folder, ready for the voice-over map EDGEquest writes | Next; spike done |

The WAVs and `voice.json` go under `source/raw/edgewave/voice/<quest>/` (agreed with the owner 2026-10-23; WolvenKit does not pack `source/raw`, unverified for REDcode's Pack). Only the `.wem` files go under `source/archive/`.

## The contract

A line, as EDGEquest passes it:

| Field | |
|---|---|
| `id` | The line's `locstringId.ruid`, a decimal string. Stable: EDGEquest makes it from the line's own `voice.id` |
| `scene` | The scene's name |
| `speaker` | `V`, or the person's name as written in the story |
| `text` | The subtitle |
| `say` | Optional. As spoken, with ElevenLabs v3's square-bracket delivery tags (`[softly]`, `[sighs]`). Absent: `text` is spoken |
| `direction` | Optional. How it is spoken, in plain words |
| `both` | Optional. Two takes, female and male V. Absent: true for `V`, false for anyone else |

What EDGEwave writes, in `source/raw/edgewave/voice/<quest>/`:

| File | |
|---|---|
| `<speaker>_<quest>_f_<id in 16 hex digits>.wav` | A take, mono, as ElevenLabs gives it (48 kHz, or 24 kHz on a plan without 48 kHz). `_m_` for male V. `<speaker>` and `<quest>` lower case, other characters `_` |
| `<name>.previous.wav` | The take before the last, kept when a line is redone |
| `voice.json` | The record: `quest`, `voices` (per speaker, V's as `{ female, male }`), `archiveDir` when given, and `lines` by id: `scene`, `speaker`, what the take was made from (`text`, `say`, `direction`, `model`, `made`), its files (`female`, `male`, relative to the project) and `previous` |
| `<name>.edgewave`, `<name>.take.wav` | Only after **Studio**: the take as a studio document. Its source is a copy of the take, its render the take itself |

**A line is voiced** while its takes exist and its `text`, `say` and `direction` match what they were made from. Otherwise it is stale, and voicing again redoes only the stale and missing lines. EDGEquest reads `voice.json` for its checklist and writes the voice-over map.

**What is spoken:** `eleven_v3` (the default, setting `edgewave.voiceLines.model`) gets `say` as it is. Other models get `say` with its `[...]` tags removed, or `text`. `direction` is recorded; ElevenLabs' text-to-speech takes no instruction today.

## The Voice Lines panel

EDGEquest's Storyboard opens it with a scene's lines (Generate) or one line (Regenerate), through `voiceLines`. **EDGEwave: Voice Lines…** opens a quest voiced before, with its lines as `voice.json` has them.

| Part | What it does |
|---|---|
| Header | The quest, how many lines are voiced, the model (from the account's list), **Generate All** (the lines with no take or a stale one), **Stop** while it runs |
| Voices | A voice per speaker, two for V (female and male V), from the ElevenLabs account, with a ▶ for the voice's sample. Kept in `voice.json`, so they carry over |
| A line | Speaker and text, `say` and `direction` when given, and what the take says when it is stale. Per take (F and M for V): ▶ plays it, **Use a file…** takes a recording (WAV, MP3, OGG or FLAC, made a 48 kHz mono WAV), **Studio** opens it in the editor. **Generate** or **Regenerate** (just this line), **Previous** (swaps with the take before, and back) |

Each line is saved as soon as it is voiced, so a stopped run keeps what it made. A take replaced while it has a studio document takes the document with it (`<name>.previous.edgewave`, rendering to `<name>.previous.wav`), so a render never writes over the new take.

## What a voiced line needs in the game

From EDGEquest's [formats page](https://edgemodders.github.io/EDGEquest/design/formats.html) and the modding wiki's [custom voice line guide](https://github.com/CDPR-Modding-Documentation/Cyberpunk-Modding-Docs/blob/main/modding-guides/quest/adding-a-custom-voiceline-to-a-scene.md):

| Part | |
|---|---|
| The line's id | EDGEquest's `locstringId.ruid`, a decimal string. The game names voice files by it in 16 hex digits: `<speaker>_<quest>_f_<hex>.wem` (`_m_` for male V) |
| The audio | A `.wem`, Wwise Vorbis. The guide: Wwise **2023.1.14** ("a hard requirement as it is the one currently used in the game"), the **Vorbis Quality High** conversion, mono, 48 kHz |
| The map | A voice-over map entry, `stringId` to `femaleResPath` and `maleResPath`, loaded by ArchiveXL's `localization: vomaps:`. EDGEquest writes it |
| Lip sync | Optional. New lip sync cannot be made from new audio; a game line's can be reused. V has none |

Wwise is not part of EDGEwave and is never shipped with it (its license). The modder installs it from Audiokinetic's Launcher, which keeps versions side by side. Only the `.wem` step needs it; without Wwise a quest's new lines have their WAVs but play as subtitles only.

## The `.wem` spike

Run 2026-10-23 with Wwise 2023.1.14 (build 8770) and 2025.1.7 (build 9143) on the owner's machine. Test audio only: a synthetic tone and a line spoken by Windows' built-in voice. One game voice line (`judy_q307_f_2e6b759be83bc000.wem`) was extracted to the scratchpad to compare headers, and not kept.

How EDGEwave will call it:

1. `WwiseConsole.exe create-new-project <dir>\p.wproj` once: a blank project, which already has the factory **Vorbis Quality High** conversion ShareSet.
2. A `.wsources` list, one `<Source Path="<wav>" Conversion="Vorbis Quality High" Destination="<name>.wem"/>` per take, under `<ExternalSourcesList SchemaVersion="1" Root="<wav folder>">`.
3. `WwiseConsole.exe convert-external-source <project> --platform Windows --source-file <list> --output <dir> --no-wwise-dat`. The files land in `<dir>\Windows\`.

| Check | Result |
|---|---|
| Where the tool is | `C:\Audiokinetic\Wwise_2023.1.14.8770\Authoring\x64\Release\bin\WwiseConsole.exe`. The folder names differ: `Wwise_2023.1.14.8770` and `Wwise2025.1.7.9143`. `WWISEROOT` names the last version installed, so EDGEwave looks for the version, not the variable |
| Speed | 0.5 s for a 2 s tone, including loading the project |
| The header, against Judy's line | The same: RIFF `WAVE`, a 66-byte `fmt ` with codec `0xFFFF` (Wwise Vorbis), 1 channel, 48,000 Hz, channel mask `0x4101`, the same Vorbis setup block sizes; then a 16-byte `hash` chunk and `data` |
| Size | 6.1 s of speech: 45 KB (Judy's 4.1 s line: 41 KB) |
| Read back | WolvenKit (REDcode's `project_export`, through REDbridge) decodes it to Ogg Vorbis: mono, 48 kHz, 96,000 samples, the 2 s of the WAV |
| 2023.1.14 against 2025.1.7 | The same file but the 16 bytes of the `hash` chunk: the Vorbis audio is byte for byte the same. So the version may matter less than the guide says; EDGEwave still asks for 2023.1.14, as the guide does. Unverified in the game |
| Errors | A tab-separated line per problem (`Conversion`, `Error`, `MissingOriginalFile`, `External source file is missing`, `Windows`, `missing.wav`) and exit code 1. `--no-wwise-dat` is not in 2025.1.7 |

**Not yet checked: that the game plays it.** That needs a scene line with a voice-over map entry, which EDGEquest writes; the plan is to test it with EDGEquest's test quest once the contract is agreed.
