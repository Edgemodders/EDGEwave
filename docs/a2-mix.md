# A2 Mix

Status: **done 2026-10-20** (built 2026-10-16; hand test passed after four rounds, [Tests](testing.html#a2-mix)). Several sounds on one timeline, each with its own edits and effects, rendered to one WAV.

## What is built

| Part | Where |
|---|---|
| Version 2 of the sound document: tracks, each a source with its own edits, start, gain, pan, rate, in the mix or not (`mute`), and effects; a master with gain and effects. An A1 document opens as one track and is written as version 2 at its next change | `src/doc.ts` |
| The mix's arithmetic (which tracks are in the mix, where the mix ends, reverb tails), the effects' parameters and the presets, pure, with unit tests | `src/audio/mix.ts`, `test/` |
| The audio graph: per track the edited clip at its rate, its effects, gain and pan; then the master. Playback and render build the same graph, so what is heard is what is rendered | `webview/graph.ts` |
| The page: the mix lanes, each with a checkbox at its left (checked, the track is in the mix; right-click a lane for **Only This Track** and **All Tracks**), each dragged up or down to move it (and **Move Up** and **Move Down** in the lanes' menu), and the selected track's controls above A1's clip editor, with a splitter between them; Edits, Effects and Master panes below; Render in the Mix bar | `webview/editor.ts`, `media/editor.css` |
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

The owner's request, from A3's step 8: Add to Project names its groups by track number (the lane, top to bottom), so the order of the lanes matters. The first build had a grip per lane; the owner asked for the lane itself, as a clip already drags sideways, so the drag's direction decides (the same day).

| You drag a lane | What happens |
|---|---|
| Mostly sideways | On the clip: the clip moves in time (as before); the lane stays. On the empty part: nothing |
| Mostly up or down | From the clip or the empty part: the lane moves. The cursor is an up-down arrow, a yellow line shows where it will land, past the top or bottom edge the lanes scroll. The clip keeps its start |
| A click, no movement | Selects the track and places the mix cursor |

The first 4 pixels of movement pick the direction, and it holds for the drag: a sideways drag never turns into a move, a move never shifts the clip in time.

| | |
|---|---|
| Drop | The track moves there and stays selected; the numbers follow; one edit (Ctrl+Z undoes it) |
| Menu | Right-click a lane: **Move Up**, **Move Down** |
| Add to Project | The last choice is kept by sound and event, not by track number, so a move never loses it |

## Create a Sound and dropping sound files (2026-10-24)

The owner's request, from EDGEquest's tests: EDGEwave makes sounds itself (Generate Sound, Speak Line, Voice Lines), so a sound need not start from a file. Hand test pending ([Tests](testing.html#a2-mix), steps 14 and 15).

| Part | What it does |
|---|---|
| **Create a Sound…** (the + in the Sounds view, `edgewave.newSound`) | Asks for a name and a place, by default `source/raw/edgewave/sounds/New sound.edgewave` in the REDcode project (the workspace folder without one), and opens an empty sound: no tracks, rendering `<name>.wav` beside it. A document may now have no tracks |
| **Open Sound in EDGEwave…** (the folder button beside it) | A sound file from disk, as before |
| The empty sound | One empty lane and a note on the clip saying what fills it: dropped files, Add Sound (+), Generate Sound, Speak Line. The track's controls, Render WAV and Add to Project are off until there is a track. Remove now takes the last track too |
| Drop on the lanes | Each sound file becomes a new track at the start of the mix, the last one selected |
| Drop on the clip | The first file becomes the selected track's sound: its edits are cleared (their times were the old sound's), its level, pan, rate, start and effects kept. With no track, a new one. Any other files become new tracks |
| Where the files go | A file from the desktop reaches the page as bytes only, so it is copied into `<name>.sounds/` beside the document (the same file dropped twice is one copy; another with its name gets a number). A file dragged from VS Code's Explorer is used where it is |
| Which files | `.wav`, `.ogg`, `.mp3`, `.flac`, `.opus`, `.wem`; others are left out with a warning |
| Undo | One edit per drop (Ctrl+Z). A copy stays in `<name>.sounds` |

**Hold Shift as you drop.** VS Code opens a file dropped on an editor in its own tab unless Shift is held; with Shift, the drop reaches the page. Checked in the smoke test with real desktop drags (DevTools' `Input.dispatchDragEvent` with file paths): with Shift the page took them, without it the page got nothing.
