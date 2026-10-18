# <span class="y">Tests</span>

Every test run on EDGEwave so far: how to run it again, what to expect, and what it showed. Each phase ends with a hand test by the owner ([design, "Phases"](design.html#phases)); new tests are added here when they are first run.

Last updated 2026-10-18.

## At a glance

| Test | Kind | Phase | Last run | Result |
|---|---|---|---|---|
| [Type check, build and unit tests](#type-check-build-and-unit-tests) | Automated, also on GitHub (Check) | A1 to A3 | 2026-10-16 | Pass, 27 tests |
| [Smoke test](#smoke-test-vs-code-with-a-stand-in-redcode) | Automated, no game needed | A1 to A3 | 2026-10-16 | Pass |
| [Spike: decoding and encoding in the webview](#spike-decoding-and-encoding-in-vs-codes-webview) | By script, with game sounds | A1 | 2026-10-15 | Done |
| [A1 Edit hand test](#a1-edit) | By hand, F5 | A1 | 2026-10-16 | Pass, after four rounds |
| [A2 Mix hand test](#a2-mix) | By hand, F5 | A2 | 2026-10-18 | Pass but one finding, fixed; its retest (step 3) pending |
| [A3 Into the game hand test](#a3-into-the-game) | By hand, F5 and in the game | A3 | Not run | |

## Automated

### Type check, build and unit tests

```powershell
npm install
npm run typecheck
npm run build
npm test
```

Expected: no errors, `dist/extension.js` and `dist/editor.js` written, and every unit test passing. The **Check** workflow (`.github/workflows/check.yml`) runs the same on every push to `main` that changes code, and on pull requests.

The unit tests are in `test/edits.test.ts`, over the pure code in `src/audio/`, `src/doc.ts` and `src/redmod.ts`:

| Area | Tests |
|---|---|
| Edits | Trim; cut in either order; paste; paste after a cut moves the range; a paste from an earlier sound survives edits in between; a stereo paste into mono takes a channel; silence; edits run in order; times past the end are clamped; fade in and fade out over their range only; gain of -6 dB halves; normalize to a target, and of silence; stereo to mono and back; the input is never changed |
| WAV | A round trip keeps the rate, the channels and the samples to 16 bits; samples past full scale are clipped |
| Documents | A round trip, and what is not a document is rejected; an A1 document (version 1) opens as one track; voice lines are found by their folder (`vo`, `vo_holocall`, `vo_helmet`, `vo_rewinded`) or, for a copy on disk, by their name |
| Mix | Mute and solo choose the tracks heard; the end is the latest track's end at its rate, plus reverb tails; presets are fresh copies with every parameter known |
| REDmod | A custom sound is added to `info.json`, keeping its other fields; the same event replaces its entry; a skip has no file; gain and pitch stay 0 to 1; every type but `mod_skip` is offered once |

### Smoke test: VS Code with a stand-in REDcode

```powershell
npm run build
npm run smoke
```

Downloads VS Code stable once (cached in `%TEMP%\ewsmoke`), and runs it at 150% scaling with EDGEwave and a stand-in REDcode (`tools/smoke/stub`). The stub serves generated tones, so no game or REDbridge is needed: sound 42 (2 s stereo, 440 Hz, event `smoke_event`) and sound 43 (1.5 s mono, 660 Hz, event `smoke_second`). The script drives the editor page over the DevTools protocol, including VS Code's own quick picks and Ctrl+Z, then checks the files written. It writes `editor.png` and `mix.png` to `%TEMP%\ewsmoke`.

To run it from a terminal inside VS Code, unset `ELECTRON_RUN_AS_NODE` (the script does this for the VS Code it starts). Keep the temp path short: VS Code's files pass Windows' 260-character limit otherwise.

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
| A3 | Into the Game > Override this variation | `42.wav` at 48 kHz stereo handed to REDcode's Import (the stub writes `imported.json`) |
| A3 | Into the Game > Replace the event with REDmod, 2D | `source/customSounds/smoke_event.wav` at 48 kHz, an entry in `source/resources/info.json`, and the document's `game` keeps the choice |

Last run 2026-10-16: **pass** (`PASS A1 edits; A2 Add Sound, preset, start, a two-track render; A3 Into the Game, override and REDmod`).

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
11. **A file.** Right-click a `.wav` or `.ogg` in REDcode's Project view, or in the Explorer, > **Open Sound in EDGEwave…**. Expect: a document beside it, rendering `<name>.edit.wav` for a `.wav`. In the Project view the entry shows on every file (VS Code gives a view's menu no file extension); on a file that is not a sound it says so.

### A2 Mix

What is built: [A2 Mix](a2-mix.html). **Retest pending** of round 2's finding (step 3).

| Round | Date | Steps | Result |
|---|---|---|---|
| 1 | 2026-10-16 | 1 to 11 | Every step works, with five findings, all fixed the same day and kept by the smoke test (below) |
| 2 | 2026-10-18 | 1 to 11, with the five findings | Pass, with one finding, fixed (below) |
| 3 | | Retest of step 3 with a holocall line and a voice line's WAV | Not run |

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
6. **Track controls.** Change Level, Pan and Rate; try Mute and Solo with three tracks. Expect: you hear the change in the mix; muted lanes are dimmed.
7. **Effects.** Add effects one by one from **Add effect…**, change their values, untick one to bypass it, remove one with ×. Try each preset on a track and on the master.
8. **The radio test (the design's A2 test).** Two game sounds, one with the **Radio** preset, overlapping. **Render WAV**. Expect: one WAV that sounds like the mix, reverb tails not cut off.
9. **Undo and redo.** Ctrl+Z and Ctrl+Y through track moves, effect changes and added tracks.
10. **Remove.** Remove a track. Expect: its lane goes; Remove is greyed when one track is left.
11. **Fit.** Make the editor short and narrow. Expect: nothing runs off the bottom; the lanes scroll past four tracks; the panes scroll.

### A3 Into the game

What is built, and the research behind the routes: [A3 Into the game](a3-game.html). **Not run yet.** Steps 1 and 2 are the design's A3 test.

**Unverified until this test:** that the game plays an override, and that REDmod accepts a 48 kHz 16-bit WAV.

1. **Override.** Open a sound effect from Browse Game Sounds in EDGEwave, change it so you will hear it (reverse a part, or the radio preset), and click **Into the Game…** > **Override this variation**. Expect: a message naming the `.opuspak` written under `source/archive`.
2. **Pack and play.** Click **Pack** (plain archive layout), install with REDcode, and play where the sound happens. Expect: your version.
3. **REDmod.** On a sound effect with an event name, **Into the Game…** > **Replace the event with REDmod**, pick a type. Expect: `source/customSounds/<event>.wav` and an entry in `source/resources/info.json`. With `redcode.pack.redmod` off, the message says so.
4. **REDmod in the game.** Turn on `redcode.pack.redmod`, Pack, deploy and play. Expect: your sound for that event. If REDmod's deploy rejects the WAV, its log (`tools/redmod/bin/REDmodLog.txt`) says why; send the line.
5. **Silence.** **Silence the event with REDmod** on another event. Expect: a `mod_skip` entry; in the game the event is silent.
6. **The last choice.** Into the Game again on the same document. Expect: the route you used last is first.
7. **A voice line.** Into the Game on a voice line's document. Expect: a message that voice lines cannot go in yet, and only the named REDmod route.
