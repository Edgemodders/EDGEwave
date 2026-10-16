# A2 Mix

Status: **built 2026-10-16, hand test pending.** Several sounds on one timeline, each with its own edits and effects, rendered to one WAV.

## What is built

| Part | Where |
|---|---|
| Version 2 of the sound document: tracks, each a source with its own edits, start, gain, pan, rate, mute, solo and effects; a master with gain and effects. An A1 document opens as one track and is written as version 2 at its next change | `src/doc.ts` |
| The mix's arithmetic (which tracks are heard, where the mix ends, reverb tails), the effects' parameters and the presets, pure, with unit tests | `src/audio/mix.ts`, `test/` |
| The audio graph: per track the edited clip at its rate, its effects, gain and pan; then the master. Playback and render build the same graph, so what is heard is what is rendered | `webview/graph.ts` |
| The page: the mix lanes and the selected track's controls above A1's clip editor; Edits, Effects and Master panes below; Render in the Mix bar | `webview/editor.ts`, `media/editor.css` |
| **Add Sound…**: a quick pick over the game's sound effects (REDcode's index, by event name or tag, then the variation), a game file by path, or a sound file | `src/editor.ts` |

| Effect | Parameters |
|---|---|
| EQ | Low shelf at 250 Hz, peak at 1.5 kHz, high shelf at 4 kHz, in dB |
| Low-pass, high-pass, band-pass | Frequency, Q |
| Reverb | Decay (seconds), mix. A generated room, the same on every render |
| Distortion | Amount |
| Compressor | Threshold, ratio |

| Preset | Chain |
|---|---|
| Radio | High-pass 300 Hz, low-pass 3.4 kHz, EQ mid +4 dB, distortion 0.25, compressor |
| Holocall | High-pass 400 Hz, low-pass 5 kHz, EQ, light distortion, short reverb |
| PA speaker | High-pass 250 Hz, low-pass 4.5 kHz, distortion, 1.4 s reverb |
| Muffled through a wall | Low-pass 600 Hz, EQ, short reverb |

A preset replaces the chain it is applied to; every value stays editable, and each effect can be bypassed or removed.

Not in A2, as agreed: pitch without changing speed (Rate changes both together). The render writes WAV only; the game's formats are A3.

## Checks run

| Check | Result |
|---|---|
| `npm test`: 24 unit tests, adding A2's: documents round trip, an A1 document opens as one track, mute and solo, the mix's end at each track's rate, reverb tails and bypass, presets | Pass |
| `npm run smoke`: A1's steps, then Add Sound through VS Code's quick pick (typed over DevTools), the radio preset and a start of 0.25 s on track 2, and a render | Pass: the document holds both tracks; the WAV is 1.75 s (0.25 s + track 2's 1.5 s), stereo, 44.1 kHz, with sound from both tracks |
| With the real REDcode and the game | **Your hand test, below** |

## Hand test

Same setup as A1: **Run EDGEwave with REDcode main** (F5), with a REDcode project open and REDbridge running.

1. **An A1 document.** Open one you made in A1 (the Sounds view). Expect: it opens as one track, with its edits; the Mix bar, one lane and the track controls are above the clip editor.
2. **Add Sound.** Click **Add Sound…**, type part of an event name (such as `gun` or `door`), pick an event and a variation. Expect: a second lane, selected, with its waveform in the clip editor.
3. **Add a game file and a file.** Add Sound… > **A game file by its path…** (a voice line's path from Game Assets), and > **A sound file…**. Expect: a lane each. A voice line's track has **Voice line** ticked.
4. **Place.** Drag a clip along its lane; or type **Start**. Click an empty part of a lane or the ruler to place the mix cursor. Expect: the lane moves, the mix's length in the Mix bar follows.
5. **Listen.** **Play mix** (Shift+Space) plays everything from the mix cursor; **Play clip** (Space) plays the selected clip through its own effects. **Loop** loops either.
6. **Track controls.** Change Gain, Pan and Rate; try Mute and Solo with three tracks. Expect: you hear the change in Play mix; muted lanes are dimmed.
7. **Effects.** Add effects one by one from **Add effect…**, change their values, untick one to bypass it, remove one with ×. Try each preset on a track and on the master.
8. **The radio test (the design's A2 test).** Two game sounds, one with the **Radio** preset, overlapping. **Render WAV**. Expect: one WAV that sounds like the mix, reverb tails not cut off.
9. **Undo and redo.** Ctrl+Z and Ctrl+Y through track moves, effect changes and added tracks.
10. **Remove.** Remove a track. Expect: its lane goes; Remove is greyed when one track is left.
11. **Fit.** Make the editor short and narrow. Expect: nothing runs off the bottom; the lanes scroll past four tracks; the panes scroll.

Report anything that differs, with the step number.
