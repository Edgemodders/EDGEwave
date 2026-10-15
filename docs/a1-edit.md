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
| `npm test`: 17 unit tests of the edits, the WAV writer and the document | Pass |
| `npm run smoke`: VS Code 1.142 with EDGEwave and a stand-in REDcode serving a 2 s tone; open by sound hash, select, trim, fade out, 44.1 kHz, voice line, render | Pass: document saved with the edits, a 1 s 44.1 kHz stereo WAV that fades to silence |
| With the real REDcode and the game | **Your hand test, below** |

## Hand test

Needs REDcode's main branch (the API ships in REDcode 0.9.0) and REDbridge running.

1. Build REDcode: `npm run build` in `REDcode/extensions/redcode`. In this repository, run **Run EDGEwave with REDcode main** (F5). Open a REDcode project in the window that starts.
2. **A sound effect.** REDcode: Browse Game Sounds, play a sound, click **Open in EDGEwave**. Expect: a document at `source/raw/sfx/<event>/<hash>.edgewave` opens in the editor, with the waveform and the format in the header.
3. **A voice line.** Open a voice `.wem` from Game Assets in REDcode's player and click **Open in EDGEwave**. Expect: its document at its game path under `source/raw`, **Voice line** ticked, and **Translate** and **Re-Voice** in the header. Clicking either says it is planned.
4. **Listen and select.** Space plays and stops. Drag on the waveform to select; Play then plays the selection; **Loop** loops it. Ctrl+wheel zooms, the wheel scrolls, **Fit** shows the whole sound.
5. **Edit.** Try Trim, Cut (Delete), Copy and Paste (Ctrl+C, Ctrl+V at the cursor), Silence, Fade in and out with each curve, Gain, Normalize, Mono or Stereo, Set loop. Each appears in **Edits**; × removes one.
6. **Undo and redo.** Ctrl+Z and Ctrl+Y (or Edit > Undo) step through the edits; the tab shows unsaved changes; Ctrl+S saves.
7. **Render.** Pick a sample rate and click **Render WAV**. Expect: the document is saved, and the WAV beside it plays as edited (open it in REDcode's player).
8. **Reopen.** Close the editor and click **Open in EDGEwave** on the same sound again. Expect: the same document, with its edits.
9. **A file.** Right-click a `.wav` or `.ogg` in the Explorer > **Open Sound in EDGEwave…**. Expect: a document beside it, rendering `<name>.edit.wav` for a `.wav`.

Report anything that differs, with the step number.
