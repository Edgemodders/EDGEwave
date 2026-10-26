# <span class="y">Tests</span>

Every test run on EDGEwave so far: how to run it again, what to expect, and what it showed. Each phase ends with a hand test by the owner ([design, "Phases"](design.html#phases)); new tests are added here when they are first run.

Last updated 2026-10-24.

## At a glance

| Test | Kind | Phase | Last run | Result |
|---|---|---|---|---|
| [Type check, build and unit tests](#type-check-build-and-unit-tests) | Automated, also on GitHub (Check) | A1 to V2 | 2026-10-26 | Pass, 54 tests |
| [Smoke test](#smoke-test-vs-code-with-a-stand-in-redcode) | Automated, no game or ElevenLabs needed | A1 to V2 | 2026-10-26 | Pass |
| [MCP server over stdio](#mcp-server-over-stdio) | By script, no VS Code | V2 | 2026-10-24 | Pass |
| [Packaged test](release.html#the-packaged-test) | Automated, needs the network (the Marketplace) | Release | 2026-10-20 | Pass: `edgewave-0.1.0.vsix` with REDcode 0.10.2 |
| [Spike: decoding and encoding in the webview](#spike-decoding-and-encoding-in-vs-codes-webview) | By script, with game sounds | A1 | 2026-10-15 | Done |
| [Spike: WAV to `.wem` with Wwise](#spike-wav-to-wem-with-wwise) | By script, with Wwise 2023.1.14 | V2 | 2026-10-23 | Done; in the game not yet |
| [A1 Edit hand test](#a1-edit) | By hand, F5 | A1 | 2026-10-16 | Pass, after four rounds |
| [A2 Mix hand test](#a2-mix) | By hand, F5 | A2 | 2026-10-20 | Pass, after four rounds; steps 14 and 15 (2026-10-24) to test |
| [A3 Into the game hand test](#a3-into-the-game) | By hand, F5 and in the game | A3 | 2026-10-20 | Pass, after three rounds; steps 9 and 10 (2026-10-21), 11 and 12 (2026-10-24) to test |
| [V1 Voice tools hand test](#v1-voice-tools) | By hand, with an ElevenLabs key (spends credits) | V1 | 2026-10-20 | Pass, first round |
| [Game Assets hand test](#game-assets) | By hand, F5, with the game | Game Assets | | To run |
| [V2 Voice a quest hand test](#v2-voice-a-quest) | By hand, with EDGEquest and an ElevenLabs key (spends credits) | V2 | | To run |
| [Sounds view: Project and Recent hand test](#sounds-view-project-and-recent) | By hand, F5 | A1 | 2026-10-19 | Pass |

## Automated

### Type check, build and unit tests

```powershell
npm install
npm run typecheck
npm run build
npm test
```

Expected: no errors, `dist/extension.js` and `dist/editor.js` written, and every unit test passing. The **Check** workflow (`.github/workflows/check.yml`) runs the same on every push to `main` that changes code, and on pull requests.

The unit tests are in `test/edits.test.ts`, over the pure code in `src/audio/`, `src/doc.ts` and `src/redmod.ts`, and `test/elevenlabs.test.ts`, over the ElevenLabs client against a stand-in server on localhost:

| Area | Tests |
|---|---|
| Edits | Trim; cut in either order; paste; paste after a cut moves the range; a paste from an earlier sound survives edits in between; a stereo paste into mono takes a channel; silence; edits run in order; times past the end are clamped; fade in and fade out over their range only; gain of -6 dB halves; normalize to a target, and of silence; stereo to mono and back; the input is never changed |
| WAV | A round trip keeps the rate, the channels and the samples to 16 bits; samples past full scale are clipped |
| Documents | A round trip, and what is not a document is rejected; an A1 document (version 1) opens as one track; voice lines are found by their folder (`vo`, `vo_holocall`, `vo_helmet`, `vo_rewinded`) or, for a copy on disk, by their name |
| Mix | The checked tracks are in the mix (out of it is saved as `mute`); a document with `solo` opens as the tracks it let be heard; the end is the latest track's end at its rate, plus reverb tails; presets are fresh copies with every parameter known |
| REDmod | A custom sound is added to `info.json`, keeping its other fields; the same event replaces its entry; a skip has no file; gain and pitch stay 0 to 1; silence is the render with its samples zeroed, the same format and length; every type but `mod_skip` is offered once |
| ElevenLabs | A sound effect asks for PCM at the rate, with the key, and clamps its length and prompt influence; speech, speech-to-speech and a clone send each endpoint's fields (JSON, or multipart with the WAV); voices page through; a remix's base64 previews become WAVs; a saved remix sends its fields; errors read as their message (`detail.message`, a validation list, or text); a refused output format is told apart from a bad key; PCM becomes a mono WAV; file names from prompts end on a whole word |

### Smoke test: VS Code with a stand-in REDcode

```powershell
npm run build
npm run smoke
```

Downloads VS Code stable once (cached in `%TEMP%\ewsmoke`), and runs it at 150% scaling with EDGEwave, a stand-in REDcode (`tools/smoke/stub`) and a stand-in ElevenLabs (a local server in `smoke.mjs`, which refuses 48 kHz as a plan without it would). The stub serves generated tones, so no game or REDbridge is needed: sound 42 (2 s stereo, 440 Hz, event `smoke_event`) and sound 43 (1.5 s mono, 660 Hz, event `smoke_second`). The script drives the editor page over the DevTools protocol, including VS Code's own quick picks and Ctrl+Z, then checks the files written. It writes `editor.png`, `mix.png`, `intogame.png`, `takes.png`, `revoice.png` and `voiceLines.png` to `%TEMP%\ewsmoke`. EDGEwave's own folder (`EDGEWAVE_HOME`) is `%TEMP%\ewsmoke\home` there, so the modder's event index is never touched. The stub's bridge gives a small `eventsmetadata.json` (`smoke_event`, `smoke_second`, `mus_smoke_01_START`), and two stub commands call EDGEwave's API as EDGEquest does.

On a busy machine (other VS Code windows running), `SMOKE_SLOW=2` doubles every wait and the time limit. To run it from a terminal inside VS Code, unset `ELECTRON_RUN_AS_NODE` (the script does this for the VS Code it starts). Keep the temp path short: VS Code's files pass Windows' 260-character limit otherwise.

| Phase | Check | Expected |
|---|---|---|
| A1 | The page fits the editor | The waveform keeps its height across redraws; Render and the page stay inside the editor |
| A1 | Open by sound hash | A document at `source/raw/sfx/smoke_event/42.edgewave` |
| A1 | Select, trim, fade out, cut and paste by keyboard, 44.1 kHz, Voice line | The document holds `trim, fade, cut, paste`, the paste names the earlier sound, the rate is 44,100, `voice` is set; Translate and Re-Voice show only on a voice line |
| A2 | Add Sound through the quick pick | A second track, selected: `2 · smoke_second · 43` |
| A2 | The radio preset and a start of 0.25 s on track 2 | 5 effects, offset 0.25 |
| A2 | Apply gain -12 and Fade in, with no selection | Track 2's edits are `gain -12` and a fade in over 0 to 0.375 s |
| A2 | Right-click on a selection | The selection is kept and the menu opens with 11 items |
| A2 | The next-edge icon from 0 | The mix cursor at `0:00.250` |
| A2 | Remove track 2, then Ctrl+Z | Track 2 comes back selected |
| A2 | Render WAV | 1.75 s (0.25 s + track 2's 1.5 s), stereo, 44.1 kHz, with sound from both tracks |
| A3 | Add to Project > Override sound 43 (track 2, not track 1) | `43.wav` at 48 kHz, mono like sound 43, handed to REDcode's Import (the stub writes `imported.json`); the menu, before typing, is `intogame.png` |
| A3 | Add to Project, second time | Both tracks in the mix: the first row is Override sound 42 (the mixer's order), and Override sound 43 below it is marked last time |
| A3 | Add to Project > Replace the event smoke_event with REDmod, 2D | `source/customSounds/smoke_event.wav` at 48 kHz stereo, an entry in `source/resources/info.json`, and the document's `game` keeps the choice |
| A3 | Add to Project > Silence the event smoke_event, 2D | No question (this document wrote the WAV); `smoke_event.wav` keeps the replacement's header and length, every sample zero; its entry `mod_sfx_2d`, gain 1; the document's `game` is the skip route with its type |
| V1 | Generate Sound | The key's password box (typed); the 48 kHz request refused and the same at 24 kHz; two takes in the dialog (the second with a changed prompt) and no track yet; a take plays; Add on take 2 makes track 3, at the mix cursor, a 24 kHz WAV in `42.gen/`, `made` with take 2's prompt |
| V1 | Speak Line in a picked voice | The voice list and the model menu fill; the voice's preview plays; track 4, a voice line, `made` with the voice |
| V1 | Speak Line in track 1's voice | VS Code's consent modal (clicked); one clone; track 5, `made.from` track 1 |
| V1 | Re-Voice by description | Two remix previews, the same clone reused; the pick saved, then speech-to-speech; track 6 at track 1's start, track 1 out of the mix |
| A2 | The lanes' checkboxes; right-click the generated sound's lane > Only This Track; Add to Project | Track 1's box checks; then only track 3's is checked, saved as `mute` on the others; Add to Project's first row is the named REDmod route, saying no track in the mix is a game sound effect (track 3); the last choice, track 1's Silence, is marked in its label and its group's heading, out of the mix |
| A3 | Add to Project > As a REDnode sound > New package in the project, the defaults | `source/resources/red4ext/plugins/REDnode/apps/smoke/` with `rednode-app.json` (`main`, `open`, `sounds.42` as `sounds/42.wav`, `sfx`), `mod.mjs` playing it, and `sounds/42.wav` at 48 kHz; the document's `game` is the REDnode route |
| A2 | The splitter: drag it far up, then one lane down; double-click it | The lanes go to one lane, then two; double-click fits every track, as far as the waveform's least height (110 px) allows |
| A2 | Moving lanes: drag track 1's clip sideways with a little wobble; drag track 3's lane up above track 1; right-click the top lane > Move Down; Ctrl+Z | The sideways drag moves the clip in time and keeps the order; the drop line shows; track 3 keeps its start; the order is 1, 3, 2, then 3, 1, 2 after the undo (one edit) |
| V1 | Every request | Carries the key, except the voice preview's (a public URL) |
| A1 | The Sounds view | **Project** first, with the REDcode project's name, then **Recent**; 42 under each |
| V2 | `playEvent({ name: "smoke_second", show: false })` twice, then `stopSound` ([#8](https://github.com/Edgemodders/EDGEwave/issues/8)) | Each answers `ok`, `where: "archive"`, 2 variations, `played` 43 or 44; no **Hear: smoke_second** tab opens. The stub's tone really plays through the speakers (the hidden player); nothing checks that it is heard |
| V2 | The API, from the stub: `soundEvents`, `playEvent`, `customSound` | The events from the bridge's file, `smoke_event` with its sound 42 and the quest tag, the music cue as music and looping; `smoke_event` plays in the Hear panel, the music cue gives a reason; `edgewave_smoke_knock.wav` at 48 kHz and its `info.json` entry as `mod_sfx_low_occlusion`; the index in the smoke's own EDGEwave folder |
| V2 | Voice Lines, from the stub's `voiceLines` (V and Judy, Judy with `say` and `direction`) | The panel with 2 lines; three voices picked (V's two, Judy's); Generate All voices both: three requests at 24 kHz with `eleven_v3`, Judy's text `[softly] You... came back.`; `voice.json` with V's `_f_` and `_m_` takes named by the id in hex, Judy's one take, the voices and `archiveDir`; closing the panel resolves `voiceLines` with the record |
| A2 | Create a Sound (the stub's Smoke: New Empty Sound, a known path); then two WAVs dragged from the desktop onto the lanes and one onto the clip, with Shift (DevTools' `Input.dispatchDragEvent` with file paths, as the OS hands them to VS Code); then one more onto the lanes without Shift | An empty document (`tracks: []`, rendering `Smoke New.wav`), the note says to drop sound files, Render WAV off, the button reads **Add to Project…**; the two become tracks 1 and 2, the clip's drop replaces track 2's sound (`hat.wav`, no edits); `kick.wav`, `snare.wav` and `hat.wav` copied into `Smoke New.sounds`; without Shift the page gets nothing (logged); the screenshot is `created.png` |
| A3 | Add to Project on Smoke New (two files) > A new sound for this project, the name and the type as offered | The list starts with A new sound for this project, then Replace a game event by name (no track is a game sound effect), then In a REDnode package; `source/customSounds/edgewave_smoke_new.wav` at 48 kHz, its `info.json` entry `mod_sfx_low_occlusion`, the document's `game` the `new` route; the Sounds view's **Project sounds** lists `smoke_event`, `edgewave_smoke_knock` and `edgewave_smoke_new`. Earlier in the run, the API's `soundEvents` gives the project's `smoke_event` (the REDmod replacement) first, marked `replaces`, and `playEvent` plays its WAV |
| Game Assets | The view (the stub's bridge has two English voice lines, German subtitles only, a streamed `.wem` and a `.bnk`): open Sound effects, Voice lines, Base game; click `smoke_event`; Filter `judy`; Judy's line's **Add to the Open Sound** | Sound effects, Voice lines, Music and streamed sounds; `smoke_event` and `smoke_second` (2 variations); en-us, not de-de; the Hear panel `Hear: smoke_event`; the filter shows only Judy's line (with its folder), no event; Smoke New gets it as track 3, a game source marked as a voice line |

Last run 2026-10-26, with `SMOKE_SLOW=2`: **pass** (`PASS A1 edits; A2 Add Sound, preset, start, a two-track render; A3 Add to Project, override of track 2, REDmod and silence, a REDnode sound; voice tools against a stand-in ElevenLabs; the API: sound events, hearing one, playing one with no tab, a custom sound; Voice Lines for a quest; the lanes' checkboxes and Only This Track; the splitter; moving lanes; the Sounds view; Create a Sound and sound files dropped on it; a new sound for the project, in Project sounds; Game Assets: listing, hearing, filtering, adding to the open sound`). Without it, on a machine busy with other VS Code windows, four runs failed at four different quick-pick steps (their fixed waits ran out); the same happened once on the code before this change.

### Spike: decoding and encoding in VS Code's webview

Run on 2026-10-15 with a game voice line (Ogg Vorbis, exported by REDbridge) and a game sound effect (Ogg Opus, from `sfx_container_1829.opuspak`), in a webview of VS Code 1.142.0 (Electron 43.7.7, Chromium 150), with headless Chrome 154 as the control. No game data was kept. The results decided how EDGEwave gets its audio ([design, "How it is built"](design.html#how-it-is-built)).

| Check | VS Code 1.142 | Chrome 154 |
|---|---|---|
| `decodeAudioData`, Ogg Vorbis | Decodes | Decodes |
| `decodeAudioData`, Ogg Opus | `EncodingError` | Decodes |
| WebCodecs `AudioDecoder`, the game's Opus | `isConfigSupported` says yes, then `configure` fails: "Unsupported configuration" | Decodes |
| WebCodecs, Opus encoded in the same page and decoded back | `configure` fails the same way | Decodes |
| WebCodecs `AudioEncoder`, Opus | Encodes (one second of tone: 51 packets) | Not checked |
| WebCodecs `AudioEncoder`, Vorbis, FLAC, MP3 | Not supported | Not checked |
| `MediaRecorder` | WebM Opus only | Not checked |

The owner's retest of REDcode's player found the same on 2026-10-15; REDcode 0.8.0 decodes Opus in the extension and serves WAV.

### Spike: WAV to `.wem` with Wwise

Run 2026-10-23 for [V2 Voice a quest](voice-lines.html#the-wem-spike), which has the commands and the full results. Needs Wwise 2023.1.14 from Audiokinetic's Launcher.

1. Make a mono 48 kHz 16-bit WAV (a tone, or Windows' voice: `System.Speech`'s `SpeechSynthesizer` with `SpeechAudioFormatInfo(48000, Sixteen, Mono)`).
2. `WwiseConsole.exe create-new-project <dir>\p.wproj`, then `convert-external-source <dir>\p.wproj --platform Windows --source-file <list>.wsources --output <out> --no-wwise-dat`, the list naming the WAV with `Conversion="Vorbis Quality High"`.
3. Read the `.wem`'s RIFF chunks and compare them with a game voice line's (extracted to a temporary folder; never kept or committed).
4. Put the `.wem` under a folder's `source/archive` and export it with REDcode's `project_export`: it decodes to Ogg.

Expect: codec `0xFFFF`, 1 channel, 48,000 Hz, `fmt ` 66 bytes, then `hash` and `data`, as the game's line; the Ogg as long as the WAV.

Last result (2026-10-23): all as expected, 0.5 s per conversion. 2025.1.7 makes the same audio (only the `hash` chunk differs). Not yet heard in the game.

### MCP server over stdio

Run 2026-10-24. A script starts `dist/mcp/edgewave-mcp.cjs` with Node, with `LOCALAPPDATA` pointing at a temporary folder holding an event index built from the game's `eventsmetadata.json` (a temporary copy, not kept), and talks MCP over stdin and stdout.

| Check | Expected | Result |
|---|---|---|
| `tools/list` | `voice_lines`, `voice_status` (read only), `voice_voices` (read only), `sound_events` (read only), `sound_custom`; no ask-first flag | Pass |
| `sound_events` `{ query: "dex", music: true }` | `mus_q001_v_meets_dex_01_START_intro_dialogue_choice`, `..._02_take_the_chip` | Pass |
| `voice_lines` with no key | "No ElevenLabs API key..." and how to give one | Pass |
| `voice_status` with one line | `none` | Pass |
| `sound_custom` on a 48 kHz WAV | `edgewave_test_knock`, `mod_sfx_low_occlusion`, the WAV and the `info.json` entry | Pass |

## Hand tests

### Before any hand test

| Need | How |
|---|---|
| REDcode's main branch, built | Pull `REDcode`, then `npm run build` in `REDcode/extensions/redcode`. EDGEwave needs REDcode's API (0.9.0); A3 needs REDcode #8 (`0f8ebe3`, in 0.10.0) |
| EDGEwave, from source | In this repository, F5 > **Run EDGEwave with REDcode main**. A second VS Code window opens with both loaded from source |
| A REDcode project, and REDbridge running | Open the project in the second window. A3 needs REDbridge 0.9.0: **REDcode: Update REDbridge** |
| The game | A3's in-game steps only |

Report anything that differs, with the phase and the step number.

### A1 Edit

What is built: [A1 Edit](a1-edit.html). **Pass** (2026-10-16).

| Round | Date | Steps | Result |
|---|---|---|---|
| 1 | 2026-10-15 | First look | Three findings, fixed: the page grew past the bottom of the editor on a scaled display (the canvas sized itself from its own height); no REDcode HUD colours; no activity bar icon. Steps 9 and 10 cover them |
| 2 | 2026-10-16 | 9, 10 | Pass |
| 3 | 2026-10-16 | 1 to 8, 11 | Pass, with two findings, fixed: Cut did not keep what it cut for Paste (a paste now names the sound it was copied from); Open Sound in EDGEwave… was missing from REDcode's Project view |
| 4 | 2026-10-16 | Retest of 5 (Cut then Paste) and 11 | Pass. **A1 is done** |

1. **Start.** Run **Run EDGEwave with REDcode main** (F5) and open a REDcode project in the window that starts.
2. **A sound effect.** REDcode: Browse Game Sounds, play a sound, click **Open in EDGEwave**. Expect: a document at `source/raw/sfx/<event>/<hash>.edgewave` opens in the editor, with the waveform and the format in the header.
3. **A voice line.** Open a voice `.wem` from Game Assets in REDcode's player and click **Open in EDGEwave**. Expect: its document at its game path under `source/raw`, **Voice line** ticked, and **Translate** and **Re-Voice** in the header. Clicking either says it is planned.
4. **Listen and select.** Space plays and stops. Drag on the waveform to select; play then plays the selection; loop loops it. Ctrl+wheel zooms, the wheel scrolls, **Fit** shows the whole sound.
5. **Edit.** Try Trim, Cut (Ctrl+X or Delete; what is cut can be pasted), Copy and Paste (Ctrl+C, Ctrl+V at the cursor), Silence, Fade in and out with each curve, Apply gain, Normalize, Mono or Stereo, Set loop. Each appears in **Edits**; × removes one.
6. **Undo and redo.** Ctrl+Z and Ctrl+Y (or Edit > Undo) step through the edits; the tab shows unsaved changes; Ctrl+S saves.
7. **Render.** Pick a sample rate and click **Render WAV**. Expect: the document is saved, and the WAV beside it plays as edited (open it in REDcode's player).
8. **Reopen.** Close the editor and click **Open in EDGEwave** on the same sound again. Expect: the same document, with its edits.
9. **The Sounds view.** Click the EDGEwave icon in the activity bar. Expect: the documents from the steps above, each opening in the editor; with none, the Browse Game Sounds and Open Sound… buttons.
10. **Fit.** Make the editor short (drag the panel up) and narrow. Expect: the waveform shrinks, the panes scroll, nothing runs off the bottom.
11. **A file.** Right-click a `.wav` or `.ogg` in REDcode's Project view, or in the Explorer, > **Open Sound in EDGEwave…**. Expect: a document beside it, rendering `<name>.edit.wav` for a `.wav`. In the Project view the entry shows on sound files only (`.wem`, `.wav`, `.ogg`, `.opus`, `.mp3`, `.flac`), by REDcode 0.10.3's `projectFile.sound` kind (EDGEwave #6; VS Code gives a view's menu no file extension, so the kind is how it tells). Right-click a `.mlsetup` or a `.mesh` there: no EDGEwave entry.

### A2 Mix

What is built: [A2 Mix](a2-mix.html). **Passed 2026-10-20**, after four rounds.

| Round | Date | Steps | Result |
|---|---|---|---|
| 1 | 2026-10-16 | 1 to 11 | Every step works, with five findings, all fixed the same day and kept by the smoke test (below) |
| 2 | 2026-10-18 | 1 to 11, with the five findings | Pass, with one finding, fixed (below) |
| 3 | 2026-10-20 | 12 (the splitter) and 13 (moving lanes), new at the owner's request; the checkboxes' colours | Pass: "It all works great". Found in the round and fixed: the checkboxes were the browser's white box (now the theme's), and a lane moved by a grip, now by dragging the lane itself |
| 4 | 2026-10-20 | Retest of step 3 with a holocall line and a voice line's WAV; step 6 with the checkboxes | Pass |

| Finding (round 1) | Fix |
|---|---|
| Gain dB did not seem to change the clip | Two gains were easy to mix up. The clip editor's button is now **Apply gain** (an edit, default -6 dB, listed in Edits); the track's mix level is now **Level** |
| Fade in did nothing | With no selection and the cursor at the start, its range was empty. It now fades the first half second; Fade out at the start or end fades the last half second |
| Right-click cleared the selection and moved the cursor | Only the left button selects. Right-click on the clip opens EDGEwave's menu of edit actions |
| Undo of Remove brought the track back unselected | A track that comes back (undo, or Add Sound) becomes the selected one |
| Feature request: an icon toolbar, with jumps and Stop | The Mix bar has icons: previous clip edge, play, stop, next clip edge, loop, Add Sound; the clip has play and stop |

| Finding (round 2) | Fix |
|---|---|
| A voice line's WAV (`civ_mid_m_83_jap_30_mt_ow_chats_f_2db31806b446a000.wav`) added as a sound file was not marked **Voice line** | EDGEwave knew a voice line only by the folder `localization\<language>\vo`. A copy on disk is outside it, and holocall, helmet and rewinded lines (`vo_holocall`, `vo_helmet`, `vo_rewinded`, 9,424 lines) were missed too. Now any `vo` or `vo_*` folder counts, and so does the name: voice lines end in `_f_` or `_m_` and 16 hex digits. Checked over all 119,857 `.wem` files in game 2.31: the folders hold all 115,061 voice lines; the name matches every one and none of the game's other 468,737 files. The game's path for this line is `ep1\localization\common\vo\` |

1. **An A1 document.** Open one you made in A1 (the Sounds view). Expect: it opens as one track, with its edits; the Mix bar, one lane and the track controls are above the clip editor.
2. **Add Sound.** Click the Add Sound icon, type part of an event name (such as `gun` or `door`), pick an event and a variation. Expect: a second lane, selected, with its waveform in the clip editor.
3. **Add a game file and a file.** Add Sound > **A game file by its path…** (a voice line's path from Game Assets; try a `vo_holocall` one), and > **A sound file…** (try a voice line's exported WAV). Expect: a lane each. A voice line's track has **Voice line** ticked, by its path or by its name.
4. **Place.** Drag a clip along its lane; or type **Start**. Click an empty part of a lane or the ruler to place the mix cursor. Expect: the lane moves, the mix's length in the Mix bar follows.
5. **Listen.** The Mix bar's play icon (Shift+Space) plays everything from the mix cursor; the Clip bar's (Space) plays the selected clip through its own effects; stop stops either; loop loops either. The edge icons move the mix cursor to the previous or next start or end of a clip.
6. **Track controls.** Change Level, Pan and Rate; with three tracks, uncheck a lane's box, then right-click a lane > **Only This Track**, then > **All Tracks**. Expect: you hear the change in the mix; lanes out of the mix are dimmed and unchecked. (Mute and Solo until 2026-10-19.)
7. **Effects.** Add effects one by one from **Add effect…**, change their values, untick one to bypass it, remove one with ×. Try each preset on a track and on the master.
8. **The radio test (the design's A2 test).** Two game sounds, one with the **Radio** preset, overlapping. **Render WAV**. Expect: one WAV that sounds like the mix, reverb tails not cut off.
9. **Undo and redo.** Ctrl+Z and Ctrl+Y through track moves, effect changes and added tracks.
10. **Remove.** Remove a track. Expect: its lane goes; Remove is greyed when one track is left.
11. **Fit.** Make the editor short and narrow. Expect: nothing runs off the bottom; the lanes scroll past four tracks; the panes scroll.
12. **The splitter** (the owner's request, 2026-10-20). With five or more tracks, drag the bar under the Track bar down, then up; double-click it; with it focused, press the up and down arrows. Expect: the lanes grow and shrink and the waveform takes the rest, never under one lane or past every track, the waveform never under about 110 px; double-click fits every track. Switch to another tab and back, or reload the window: the height stays.
13. **Moving lanes** (the owner's request, 2026-10-20). With three or more tracks, drag a lane up or down, from its clip or the empty part beside it, and past the top or bottom edge when the lanes scroll; drag a clip sideways, a little off level; right-click a lane > **Move Up** and **Move Down**; then Ctrl+Z. Expect: up or down, the cursor is an up-down arrow, a yellow line shows where the lane will land, and the track moves there, keeps its start and stays selected; sideways, the clip moves in time and never changes lane; the lanes' numbers and Add to Project's `Track N` groups follow the new order; each move is one undo.
14. **Create a Sound** (the owner's request, 2026-10-24). In the EDGEwave Sounds view, the + (tooltip **Create a Sound…**). Expect: a save dialog at `source/raw/edgewave/sounds/New sound.edgewave` in the project; Create opens an empty sound: one empty lane saying to drop sound files, a note on the clip, Render WAV and **Add to Project…** off. The folder button beside the + is **Open Sound in EDGEwave…**, as before. Generate Sound or Add Sound on the empty sound adds track 1.
15. **Dropping sound files.** On the empty sound, drag two sound files from the desktop onto the lanes, holding Shift as you drop. Expect: the lanes light up while you drag; each file becomes a track, the last one selected; the files are copied into `New sound.sounds/` beside the document. Then drag one file onto the clip (Shift): the selected track plays the new file, its edits gone, its level and effects kept; Ctrl+Z puts the old sound back. Drag a file from VS Code's Explorer instead: it is used where it is, not copied. Drop a `.txt`: a warning, nothing added. Without Shift: VS Code's own handling, not EDGEwave's (tell me what it does).

### A3 Into the game

What is built, and the research behind the routes: [A3 Into the game](a3-game.html). Steps 1 and 2 are the design's A3 test.

**Passed 2026-10-20**, after three rounds. Verified: the game plays an override (round 1), and REDmod accepts EDGEwave's 48 kHz 16-bit WAV and the game plays it (round 2); an override of a later track's sound, from a mix with that track in or out of it (round 3). Added 2026-10-21, not yet tested by hand: step 9 (how to hear it, EDGEwave #4) and step 10 (As a REDnode sound, EDGEwave #2).

| Round | Date | Result |
|---|---|---|
| 1 | 2026-10-19 | Before the formal steps, the owner overrode a katana equip sound (track 4 of a mix, soloed), packed, deployed and heard it in the game: **the override works**. Two findings on the way, both fixed the same day (below) |
| 2 | 2026-10-19 | Steps 1 to 5 pass. Step 4: the game played a REDmod custom sound for `dev_vending_machine_can_falls` (`mod_sfx_room`); REDmod's deploy found the mod and wrote every entry to `mods.json`, with no complaint about the WAVs. Step 5 first seemed to fail: with `mod_skip`, then two silent WAVs, the can still sounded the same. A short ping as its custom sound showed why: a can dropping plays several events layered together. On `w_melee_katana_equip`, one event on its own, the silent WAV silences it and `mod_skip` (by hand, the audible WAV left in place) does not. Gain 0 in `info.json` left a replacement loud. Three findings, fixed the same day (below). Finding events by ear was hard, so the owner asked REDnode for a Sound Tracer ([REDnode #14](https://github.com/Edgemodders/REDnode/issues/14)) |
| 3 | 2026-10-20 | Step 6 retest with the checkboxes: the tracks in the mix come first, as expected; the last choice, in a group out of the mix, did not seem marked. It was, as the row's small dim description; now in the row's name and its group's heading (below). Then, on that build, steps 6, 7 and 8 (with the swap) pass. **A3 passes** |

| Finding (round 1) | Fix |
|---|---|
| Add to Project offered routes for track 1's source only, so a game sound added as a later track could not be overridden | Every sound effect on a track is a target, grouped by track, the heard tracks first; the mix of the tracks heard goes in; an override takes its target's channels and remembers its hash. Step 8 added |
| The last choice was copied to the top under "Last time", above the soloed track | The last choice is marked "last time" in its own track's group; heard tracks always come first |

| Finding (round 2) | Fix |
|---|---|
| `mod_skip` does not silence an event in the game | Silence writes a silent WAV as the event's custom sound, as modders do: the mix rendered as for a replacement, every sample zeroed, with the type you pick, at gain 1. Silent in the game on the katana equip. (A first try, 0.1 s of mono silence as `mod_sfx_2d` at gain 0, was only tried on the layered vending machine, so it is not known whether it works) |
| Replacing an event from another variation's document overwrote the event's WAV without a word; how variations fit was unclear | The REDmod rows say **every variation**; EDGEwave asks before replacing an event's WAV that this document did not write last. One variation alone is the override route |
| Silencing an event after replacing it left the replaced WAV in `customSounds` | Silence now writes that WAV itself, as silence |
| Step 6 retest (2026-10-20): the last choice in a group out of the mix did not seem marked; it was, but as the row's description, small and dim beside the group's heading | **last time** is now in the row's label and in its group's heading (`Track N · … · not in the mix · last time`) |
| Step 6: with a generated sound soloed, Add to Project listed only the katana's tracks (not heard), last time's first; with several tracks soloed, soloing another did not do what it seemed to | Checkboxes in the lanes in place of Mute and Solo, with **Only This Track** and **All Tracks** ([A2 Mix](a2-mix.html)). Add to Project lists the tracks in the mix in the mixer's order, then **Any event** (first, and saying why, when no track in the mix is a game sound effect), then the tracks out of the mix; the last choice is only marked |

1. **Override.** Open a sound effect from Browse Game Sounds in EDGEwave, change it so you will hear it (reverse a part, or the radio preset), and click **Add to Project…** > **Override sound `<hash>`** under its track. Expect: a message naming the `.opuspak` written under `source/archive`.
2. **Pack and play.** Click **Pack** (plain archive layout), install with REDcode, and play where the sound happens. Expect: your version.
3. **REDmod.** On a sound effect with an event name (its track shows the name, as in `<event> · <hash>`), **Add to Project…** > **Replace the event `<event>`, every variation, with REDmod**, pick a type. Expect: `source/customSounds/<event>.wav` and an entry in `source/resources/info.json`. With `redcode.pack.redmod` off, the message says so. Then open another variation of the same event and replace the event from it: EDGEwave asks before replacing the WAV.
4. **REDmod in the game.** Turn on `redcode.pack.redmod`, Pack, start the game with REDcode's **Run Game** (it adds `-modded`, so the game deploys) and play. Expect: your sound for that event. If REDmod's deploy rejects the WAV, its log (`tools/redmod/bin/REDmodLog.txt`) says why; send the line.
5. **Silence.** **Silence the event `<event>`, every variation, with REDmod**, and pick the type that played in step 4. Expect: `source/customSounds/<event>.wav` is as long as your mix and silent, its entry has that type with gain 1; in the game the event is silent. Pick an event that plays on its own, such as a weapon's equip: an action such as a can dropping from a vending machine plays several events at once, and the others still sound.
6. **The last choice.** Add to Project again on the same document. Expect: the route you used last is marked **last time** where it is listed, at the end of its row's name and of its group's heading. Right-click another game sound's lane > **Only This Track** and open it again: that track comes first, and the last choice stays marked in its own track's group (`Track N · … · not in the mix · last time`). With only a file (such as a generated sound) checked, the row after **A new sound for this project…** is **Replace a game event by name…**, saying no track in the mix is a game sound effect.
7. **A voice line.** Add to Project on a voice line's document. Expect: a message that voice lines cannot go in yet, and only the named REDmod route.
8. **A game sound on a later track** (the owner's finding, 2026-10-19). Track 1 is the top lane; "later" means the game sound is not in it ([what goes in, and what it replaces](a3-game.html#what-goes-in-and-what-it-replaces)).
   1. Open a document whose track 1 is not the sound you will replace: a generated sound, a WAV opened with Open Sound in EDGEwave…, or a game sound's document.
   2. **Add Sound** > a game sound effect that plays on its own, such as a weapon's equip. It lands at the bottom (track 2 or later).
   3. Right-click its lane > **Only This Track**, or also check a file track to mix in. Make it recognisable (a preset, a fade, the file).
   4. **Add to Project…**. Expect: after **A new sound for this project…**, under `Track 2 · <event> · <hash>`, **Override sound `<hash>`**, **Replace the event…** and **Silence the event…**; then **Any game event**; then any other game sound's track, marked **not in the mix**; **In a REDnode package…** last.
   5. Pick its **Override sound**. Expect: a message naming the `.opuspak` written under `source/archive`.
   6. **Pack** (plain archive layout), install and play the sound a few times. Expect: the checked tracks, as in EDGEwave.
   7. **The swap.** Check only track 1 (a file) and uncheck the game sound's track. **Add to Project…**. Expect: **A new sound for this project** first, then **Replace a game event by name**, saying no track in the mix is a game sound effect; the game sound's group last, **not in the mix**. Pick its **Override sound**, Pack and play: the file alone, in place of the game sound.

9. **How to hear it** (EDGEwave #4). Add to Project with an override, then with a REDmod route. Expect: the message ends with how to hear it (Pack and Install, then restart the game; for the override, not to hot-deploy it), with **Pack and Install** and **Pack**. **Pack and Install** runs REDcode's, which says it packed and installed.
10. **As a REDnode sound** (EDGEwave #2). Needs REDnode in the game. On a document with a voice line in the mix: **Add to Project…** > **In a REDnode package, for its code to play…** (As a REDnode sound… until 2026-10-24) > **New package in the game folder…**, id `edgewave-test`, keep the name, **Dialogue** (offered first). Expect: `red4ext/plugins/REDnode/apps/edgewave-test/` with `rednode-app.json` (the sound under `sounds`, category `dialogue`), `mod.mjs` and `sounds/<name>.wav`. With the game running and a save loaded, the new package starts and plays the line once; the Dialogue slider changes its volume. Change the mix and do the same again: no question, and the package restarts with the new sound. Then **New package in the project…**: the same under `source/resources/red4ext/plugins/REDnode/apps/<id>/`; **Pack and Install** puts it in the game folder and it plays (while the game runs, or after a restart). Delete the test packages from the game folder after.
11. **A new sound for this project** (the owner's request, 2026-10-24). On a sound made from files or a generated sound: **Add to Project…**. Expect: **A new sound for this project…** first; it offers `edgewave_<document name>`; typing a game event's name (`sa_airdrop_package_land`) is refused; **A sound effect, heard from where it plays** first. Then `source/customSounds/<name>.wav` and its `info.json` entry; the message has **Copy Name**. In the game, with EDGEquest's test quest posting the name from a phase and a scene: heard or not; tell me which.
12. **Project sounds.** EDGEwave's Sounds view. Expect: **Project sounds** lists the new sound (and any other custom sound of the project) with its type and length; a click plays it; **Copy Name** copies it. In EDGEquest, its sound picker offers it first.

   Before playing, take out an earlier REDmod replacement of the same event (its WAV in `source/customSounds` and its `info.json` entry), or turn `redcode.pack.redmod` off: REDmod's sound would play instead of the override. An override is one variation: an event with several may play another one some of the time.

### V1 Voice tools

What is built: [V1 Voice tools](voice-tools.html). **Passed 2026-10-20**, first round. Needs an ElevenLabs account and API key; each step spends credits (a few seconds of audio each).

| Round | Date | Result |
|---|---|---|
| 1 | 2026-10-20 | Steps 1 to 10 pass, no findings. Settled: a voice's preview (an MP3) plays in VS Code's page (step 4); a remix works on an instant clone (step 6). Step 2: no "refused 48000 Hz" line, so the owner's plan takes 48 kHz |

1. **The key.** In a sound document, click **Generate Sound…**, describe a sound (such as `a heavy metal door slams in a concrete corridor`), **Generate**. Expect: a password box for the key the first time; then **Take 1** in the dialog with a play button, and no new track yet. Change the description, **Generate again**: Take 2 above Take 1; play both. **Add** on the one you want. Expect: the dialog closes; a new track at the mix cursor, selected, with that take. Its WAV is in the document's `.gen` folder; the other take is not saved anywhere.
2. **The rate.** Output › EDGEwave. Expect: no "refused 48000 Hz" line on a plan that allows 48 kHz; with one, the next tools use 24 kHz. Tell me which.
3. **Generate Sound's options.** A length (such as 2 s), Loop, and Follow the prompt at 0.8. Expect: the length you asked for; a loop that plays back seamlessly with the clip's loop.
4. **Speak Line in a voice.** **Speak Line…**, type a line, search the voices (such as `female`), play a preview, pick a voice and a model, **Speak**. Expect: the preview plays (if it does not, say so: it is an MP3); a new voice-line track with the line spoken.
5. **Speak Line in a line's voice.** Select a game voice line's track, **Speak Line…**, **In the selected line's voice**, type a new line, **Speak**. Expect: the consent question once, then a track in something like that voice. A second Speak in the same line's voice makes no new clone (Output › EDGEwave says "Cloned" only once).
6. **Re-Voice by description.** On a voice line, **Re-Voice…**, describe a change (such as `female, calm` or `older, raspy`), **Make previews**, play them, pick one, **Re-Voice**. Expect: a new track at the line's place with the same words and timing in the new voice; the original muted.
7. **Re-Voice into a voice.** **Re-Voice…** > **Into one of your ElevenLabs voices**, pick one, **Re-Voice**. Expect: the same, in that voice; no clone made.
8. **Into the game.** Add to Project on a document with a Re-Voiced line (the named REDmod route, as for any voice line). Expect: the render at 48 kHz, as for any mix.
9. **Clean up.** **EDGEwave: ElevenLabs Voices Made by EDGEwave…**: the clone and the saved remix are listed; delete them. Expect: they are gone from your ElevenLabs account's voices.
10. **Errors.** **EDGEwave: Set ElevenLabs API Key** with a wrong key, then Generate Sound. Expect: the dialog shows ElevenLabs' message (such as "Invalid API key"), nothing is added. Set the right key again.

### Game Assets

What is built: [Game Assets](game-assets.html). Not run yet. Needs REDcode with a project open (its REDbridge running) and the game.

1. **The groups.** EDGEwave's activity bar: **Game Assets** below Sounds. Expect: Sound effects, Voice lines, Music and streamed sounds.
2. **Sound effects.** Open it. Expect: groups by the first part of the names (`amb_…`, `w_…`), a count beside each; inside, events with their variations. Click an event: the Hear panel plays one of its recordings. Events with no name come last, as `event <hash>` with **no name**.
3. **Voice lines.** Open Base game. Expect: only the languages with voice installed (English for most players); `vo` with 78,026, grouped (`judy_…`, `judy_q307_…`). Note how long `vo` takes to open. Click a line: it plays.
4. **Music and streamed sounds.** Open it; click a big one (a few MB). Expect: it plays, or a message naming what failed (tell me which).
5. **Filter.** The filter button: `judy q307`. Expect: under Voice lines, Judy's q307 lines with their folders; Sound effects says nothing matches. Then `*_q307_f_*`; then **Clear the Filter**.
6. **Add to the Open Sound.** With a sound open in EDGEwave, hover a voice line > its + button. Expect: a new track, marked as a voice line. With no sound open: a message offering Open in EDGEwave or Create a Sound.
7. **Open in EDGEwave and Copy Name.** On a sound effect event: the inline open button opens it in its own document, as REDcode's Open in EDGEwave does; right-click > **Copy Name** copies the event's name.

### V2 Voice a quest

What is built: [V2 Voice a quest](voice-lines.html) and [API and MCP](api.html). Not run yet. Needs EDGEquest with its Storyboard's Generate buttons, a quest with a few lines (some by V, one with `say` tags), and an ElevenLabs key; each line spends credits.

1. **From EDGEquest.** In the Storyboard, **Generate** on a scene. Expect: **Voice Lines: <quest>** opens with the scene's lines, V's with F and M takes, all "no take".
2. **Voices.** Pick V's female and male voices and one for each other speaker; ▶ plays each voice's sample. Expect: the picks stay after closing and reopening (they are in `voice.json`).
3. **Generate All.** Expect: the header counts up, each line turns "voiced", ▶ plays each take. Output › EDGEwave lists each line. `source/raw/edgewave/voice/<quest>/` has `v_<quest>_f_<hex>.wav`, `..._m_...`, the others' `_f_` takes, and `voice.json`.
4. **Tags.** On the line with `say` tags: the take follows them on `eleven_v3` (a whisper, a sigh). Change the model to `eleven_multilingual_v2` and **Regenerate** it: spoken without the tags, and no "softly" read out loud.
5. **EDGEquest sees it.** The Storyboard's lines show as voiced; the scene's `voice/<scene>` checklist item ticks once all its lines are. Change a line's text in the story: it shows as changed in both.
6. **One line.** EDGEquest's **Regenerate** on one line. Expect: the panel shows that line; only it is redone; **Previous** swaps back to the old take, and again to the new.
7. **A recording.** **Use a file…** on a take with an MP3 or a WAV. Expect: the take plays your recording; the file is a 48 kHz mono WAV.
8. **Studio.** **Studio** on a take: it opens in the editor; trim it and Render. Expect: ▶ in the panel plays the trimmed take. Then **Regenerate** the line: the new take is kept, and the studio document now renders the previous take (`<name>.previous.edgewave`).
9. **Sound events.** Through EDGEquest's Music and Sound pickers (`soundEvents`): search `dex`, then `airdrop`. Expect: the first time, "reading the game's sound events" in the status bar; the `mus_q001` cues; `sa_airdrop_package_land`. Play `sa_airdrop_package_land`: the Hear panel plays it. Play a music cue: a reason, not a sound.
10. **A custom sound.** From EDGEquest, make a sound into an event (or with `sound_custom`). Expect: `source/customSounds/edgewave_<name>.wav` and its `info.json` entry. In the game, with EDGEquest's test quest posting it from a phase and from a scene: heard or not; tell me which.
11. **An assistant.** **EDGEwave: Connect an Assistant (MCP)…** > Connect Claude Code, with the key. In a new Claude Code session, ask it to voice a quest's lines with EDGEwave. Expect: it calls `voice_lines` without asking first, and the takes appear as in step 3.
12. **Play with no tab** ([#8](https://github.com/Edgemodders/EDGEwave/issues/8), added 2026-10-26). Once EDGEquest's picker passes `show: false` on its ▶: click ▶ on a sound effect, then at once on another. Expect: the first plays within about a second (the player starts when the picker searches), no Hear tab opens, and the second stops the first. Click ▶ on a long one, then **EDGEwave: Stop Sound** in the Command Palette: it stops. A project sound plays its WAV the same way. A music cue still gives a reason.

### Sounds view: Project and Recent

Asked for by the owner on 2026-10-19: a document kept outside the open folder (made with no REDcode project open) did not show in the Sounds view. The view now has two groups.

| Round | Date | Result |
|---|---|---|
| 1 | 2026-10-19 | **Pass**: the owner reports it all works, with the Open Folder icon |

1. **Project.** Open a folder or a REDcode project with sound documents, and click the EDGEwave icon. Expect: **Project**, with the REDcode project's name beside it (or the folder's), listing the folder's documents by their folder.
2. **Recent, outside the folder.** With no REDcode project open, Open Sound… on a `.wav` outside the open folder (such as in Documents). Expect: it is first under **Recent**, with its full folder (your home as `~`); it is not under Project.
3. **Across windows.** Close VS Code and open it on another folder, or none. Expect: Recent still lists the same documents, newest first; clicking one opens it.
4. **Remove and clear.** Hover a Recent sound and click its **×** (or right-click > Remove from Recent); hover **Recent** and click **Clear Recent**. Expect: the one, then all, are gone from Recent; the files stay on disk.
5. **A deleted document.** Delete a document listed in Recent, then Refresh. Expect: it is no longer listed.
6. **No folder.** Close the folder (File > Close Folder) with something in Recent. Expect: **No folder open** under Project; hovering it shows a folder icon on the right, and the icon (or a click on the row) opens VS Code's Open Folder dialog.
7. **Nothing yet.** With no folder open and Recent cleared. Expect: the welcome text with Browse Game Sounds and Open Sound….
