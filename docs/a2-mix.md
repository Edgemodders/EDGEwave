# A2 Mix

Status: **built 2026-10-16; hand test passed 2026-10-18 but one finding, fixed, to retest.** Several sounds on one timeline, each with its own edits and effects, rendered to one WAV.

## What is built

| Part | Where |
|---|---|
| Version 2 of the sound document: tracks, each a source with its own edits, start, gain, pan, rate, in the mix or not (`mute`), and effects; a master with gain and effects. An A1 document opens as one track and is written as version 2 at its next change | `src/doc.ts` |
| The mix's arithmetic (which tracks are in the mix, where the mix ends, reverb tails), the effects' parameters and the presets, pure, with unit tests | `src/audio/mix.ts`, `test/` |
| The audio graph: per track the edited clip at its rate, its effects, gain and pan; then the master. Playback and render build the same graph, so what is heard is what is rendered | `webview/graph.ts` |
| The page: the mix lanes, each with a checkbox at its left (checked, the track is in the mix; right-click a lane for **Only This Track** and **All Tracks**), each with a grip to drag it up or down (and **Move Up** and **Move Down** in the lanes' menu), and the selected track's controls above A1's clip editor, with a splitter between them; Edits, Effects and Master panes below; Render in the Mix bar | `webview/editor.ts`, `media/editor.css` |
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

## Tests

The unit tests, the smoke test and the hand test, with its steps and every round's results, are in [Tests](testing.html#a2-mix).

## In the mix: checkboxes, not Mute and Solo (2026-10-19)

The owner's finding in the A3 hand test: with several tracks soloed, soloing another did not do what it seemed to, and a track's Mute and Solo showed only while it was selected. Agreed the same day: one checkbox per lane, always shown, in place of both.

| | Before | Now |
|---|---|---|
| In the mix | Not muted, and soloed when any track is | Checked |
| Control | Mute and Solo in the track bar, for the selected track | The lane's checkbox; right-click a lane: **Only This Track**, **All Tracks** |
| In the file | `mute`, `solo` | `mute` alone (unchecked). A document with `solo` opens with the tracks it let be heard checked, the rest unchecked, and loses `solo` at its next change |

## The splitter (2026-10-20)

The owner's request: the lanes need the height more than a single clip's waveform does. A bar sits between the Track bar and the Clip bar, where the mix ends and the clip begins.

| | |
|---|---|
| Drag | Changes the lanes' height; the Track bar moves with them, the waveform takes the rest |
| Limits | One lane at least, every track at most; the waveform keeps 110 px |
| Double-click | Fits every track, as far as the limits allow |
| Keys | Focus it (Tab), then the up and down arrows: one lane at a time |
| Kept | Per editor tab, in the webview's state (it survives switching tabs and a reload), not in the document |
| Never dragged | As before: the lanes grow to four tracks, then scroll |

## Moving lanes (2026-10-20)

The owner's request, from A3's step 8: Into the Game names its groups by track number (the lane, top to bottom), so the order of the lanes matters. Dragging a clip already moves it in time, so a lane moves by its own grip.

| | |
|---|---|
| Grip | The dots left of each lane's checkbox; the cursor is a hand over it |
| Drag | Up or down; a yellow line shows where the lane will land; past the top or bottom edge the lanes scroll |
| Drop | The track moves there and stays selected; the numbers follow; one edit (Ctrl+Z undoes it) |
| Menu | Right-click a lane: **Move Up**, **Move Down** |
| Into the Game | The last choice is kept by sound and event, not by track number, so a move never loses it |
