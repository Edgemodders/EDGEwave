# V2 Voice a quest

Status: **planned 2026-10-23**, for [EDGEwave #5](https://github.com/Edgemodders/EDGEwave/issues/5) (EDGEquest's Q4 and Q6). The plan is agreed with the owner. The contract with EDGEquest is [proposed on #5](https://github.com/Edgemodders/EDGEwave/issues/5#issuecomment-6376619865) and waits for EDGEquest's answer. The `.wem` spike is done: [below](#the-wem-spike) and in [Tests](testing.html#spike-wav-to-wem-with-wwise).

EDGEquest writes a quest's dialogue: each new line has an id, a speaker and text. EDGEwave gives those lines a voice, and the game plays it as a real voice line. The modder asks EDGEquest for a quest, or EDGEquest's assistant works through the quest's checklist, and the checklist's `voice/<scene>` item ticks itself once every line in the scene has its voice.

## The order

| Step | What |
|---|---|
| 1. The contract | The lines EDGEquest passes in, the WAVs and `voice.json` EDGEwave writes. On #5 |
| 2. **Voice Lines…** | One panel for a quest's lines by scene: a voice per speaker (two for V, female and male), Generate All through ElevenLabs, then play, redo, swap in a recording, or open a line in the studio |
| 3. The exported API | `voiceLines` and `voiceStatus` from `activate()`, `apiVersion: 1` |
| 4. `edgewave-mcp` | `voice_lines`, `voice_status`, `voice_voices`, bundled in the extension and registered as EDGEmat's is. `voice_lines` has no ask-first flag: the owner decided an assistant may voice lines, since the person who asked EDGEquest for the quest is the one in the loop |
| 5. The `.wem` route | Each take to a `.wem` through the modder's own Wwise 2023.1.14, under the mod's archive folder, ready for the voice-over map EDGEquest writes |

The WAVs and `voice.json` go under `source/raw/edgewave/voice/<quest>/` (agreed with the owner 2026-10-23; WolvenKit does not pack `source/raw`, unverified for REDcode's Pack). Only the `.wem` files go under `source/archive/`.

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
