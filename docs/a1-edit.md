# A1 Edit

Status: **done 2026-10-16** (built 2026-10-15; hand test passed). The single-sound editor: open a sound from REDcode, edit it, render it to WAV.

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

## Tests

The unit tests, the smoke test and the hand test, with its steps and every round's results, are in [Tests](testing.html#a1-edit).
