# A1 Edit

Status: **built 2026-10-15, hand test pending.** The single-sound editor: open a sound from REDcode, edit it, render it to WAV.

## What is built

| Part | Where |
|---|---|
| `edgewave.openSound`, which REDcode's **Open in EDGEwave** runs, and **EDGEwave: Open Sound in EDGEwave…** (also on sound files in the Explorer's menu) | `src/openSound.ts` |
| The REDcode contract (`REDcodeApi` version 1, copied) | `src/redcode.ts` |
| The sound document (`.edgewave`) | `src/doc.ts` |
| The edits and the WAV writer, pure TypeScript with unit tests | `src/audio/`, `test/` |
| The editor: a custom editor over the document's text, so save, undo and redo are VS Code's own | `src/editor.ts`, `webview/editor.ts`, `media/editor.css` |
| The EDGEwave activity bar icon and its **Sounds** view: the workspace's sound documents, with Open Sound… and REDcode's Browse Game Sounds when there are none | `src/soundsView.ts`, `images/activity.svg` |
| The smoke test: VS Code with a stand-in REDcode, driven over DevTools | `tools/smoke/` |

Where a sound's document goes, under the open project's `source/raw` (or a folder you pick when no project is open):

| Sound | Document | Render |
|---|---|---|
| A game file, such as a voice line | `<game path>.edgewave`, at the game file's own path | `<name>.wav` beside it |
| A sound effect | `sfx\<event name>\<sound hash>.edgewave` | `<sound hash>.wav` beside it |
| A file on disk | Beside the file | `<name>.wav`, or `<name>.edit.wav` for a `.wav`, so the source is kept |

Opening the same sound again opens its document. The render is a WAV in the project; putting it into the game is A3.

## Checks run

| Check | Result |
|---|---|
| `npm test`: 20 unit tests of the edits, the WAV writer and the document | Pass |
| `npm run smoke`: VS Code 1.142 at 150% scaling with EDGEwave and a stand-in REDcode serving a 2 s tone; the page fits the editor; open by sound hash, select, trim, fade out, cut and paste by keyboard, 44.1 kHz, voice line, render | Pass: the waveform keeps its height and Render stays in view; document saved with the edits, a 1 s 44.1 kHz stereo WAV that fades to silence |
| With the real REDcode and the game | **Your hand test, below** |

## Hand test

First round (2026-10-15) found: the page grew past the bottom of the editor on a scaled display (the canvas sized itself from its own height), it did not use REDcode's HUD colours, and EDGEwave had no activity bar icon. All three are fixed; steps 9 and 10 cover them. Second round (2026-10-16): steps 9 and 10 pass. Third round (2026-10-16): steps 1 to 8 pass, with two findings, both fixed: Cut did not keep what it cut for Paste (a paste now names the sound it was copied from, so a cut range can be pasted after the cut, and a copy survives later edits), and Open Sound in EDGEwave… was missing from REDcode's Project view (it was only in VS Code's Explorer). To retest: step 5's Cut then Paste, and step 11.

Needs REDcode's main branch (the API ships in REDcode 0.9.0) and REDbridge running.

1. Build REDcode: `npm run build` in `REDcode/extensions/redcode`. In this repository, run **Run EDGEwave with REDcode main** (F5). Open a REDcode project in the window that starts.
2. **A sound effect.** REDcode: Browse Game Sounds, play a sound, click **Open in EDGEwave**. Expect: a document at `source/raw/sfx/<event>/<hash>.edgewave` opens in the editor, with the waveform and the format in the header.
3. **A voice line.** Open a voice `.wem` from Game Assets in REDcode's player and click **Open in EDGEwave**. Expect: its document at its game path under `source/raw`, **Voice line** ticked, and **Translate** and **Re-Voice** in the header. Clicking either says it is planned.
4. **Listen and select.** Space plays and stops. Drag on the waveform to select; Play then plays the selection; **Loop** loops it. Ctrl+wheel zooms, the wheel scrolls, **Fit** shows the whole sound.
5. **Edit.** Try Trim, Cut (Ctrl+X or Delete; what is cut can be pasted), Copy and Paste (Ctrl+C, Ctrl+V at the cursor), Silence, Fade in and out with each curve, Gain, Normalize, Mono or Stereo, Set loop. Each appears in **Edits**; × removes one.
6. **Undo and redo.** Ctrl+Z and Ctrl+Y (or Edit > Undo) step through the edits; the tab shows unsaved changes; Ctrl+S saves.
7. **Render.** Pick a sample rate and click **Render WAV**. Expect: the document is saved, and the WAV beside it plays as edited (open it in REDcode's player).
8. **Reopen.** Close the editor and click **Open in EDGEwave** on the same sound again. Expect: the same document, with its edits.
9. **The Sounds view.** Click the EDGEwave icon in the activity bar. Expect: the documents from the steps above, each opening in the editor; with none, the Browse Game Sounds and Open Sound… buttons.
10. **Fit.** Make the editor short (drag the panel up) and narrow. Expect: the waveform shrinks, the Edits and Render panes scroll, nothing runs off the bottom.
11. **A file.** Right-click a `.wav` or `.ogg` in REDcode's Project view, or in the Explorer, > **Open Sound in EDGEwave…**. Expect: a document beside it, rendering `<name>.edit.wav` for a `.wav`. In the Project view the entry shows on every file (VS Code gives a view's menu no file extension); on a file that is not a sound it says so.

Report anything that differs, with the step number.
