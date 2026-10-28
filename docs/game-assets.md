# Game Assets

Status: **built 2026-10-24** at the owner's request; hand test pending ([Tests](testing.html#game-assets)). EDGEwave's own Game Assets view, below Sounds in its activity bar, shows the game's sounds and nothing else, so finding a sound no longer means going to REDcode's Game Assets and back.

## What it lists

Counted in game 2.31 through REDbridge:

| Group | What | Where it comes from |
|---|---|---|
| **Sound effects** | Each sound effect event (REDcode's sound index, about 20,000 with recordings), its variations below it. Names from REDcode's index, else from the game's own event list ([API and MCP](api.html#sound-events)); an event with neither shows its hash and **no name** | Opus recordings in 1,878 `.opuspak` files |
| **Voice lines** | **Base game** and **Phantom Liberty**, then each language with voice lines installed (others are left out), then its `vo`, `vo_holocall`, `vo_helmet` and `vo_rewinded` folders, then the `.wem` files. English: 78,026 in `base\localization\en-us\vo`, 24,132 in `ep1` | `archive.tree` |
| **Music and streamed sounds** | The 4,796 `.wem` files in `base\sound\soundbanks\media`: Wwise's streamed sounds, mostly music and long sounds, named by number only, with their sizes | `archive.tree` |

Sound banks (202 `.bnk`) and the `.opuspak` files themselves are not listed: they do not play on their own.

**Big folders are grouped** by the parts of the names, split at `_`, without a voice line's ending (`_f_` or `_m_` and its 16-digit id): `judy`, then `judy_q307`, then the files; a group shows the start its names share and how many it holds (`1,234 files`). A level holds at most 400 items; a group of one shows as its item. When the view is narrow, VS Code cuts the count before the name.

## What it does

| Action | |
|---|---|
| Click | Plays it in the **Hear** panel, through REDcode: an event's variations (one at random, as the game does), a variation, a voice line, a streamed sound |
| **▶** (hover; added 2026-10-27) | Plays it at once with no tab, through the hidden Windows player (as `playEvent` with `show: false`): an event plays one of its variations. **▶** again while it plays stops it; **EDGEwave: Stop Sound** too. A `.wem` comes from REDcode as Ogg Vorbis and is decoded in EDGEwave (libvorbis in WebAssembly, from `@wasm-audio-decoders/ogg-vorbis`, MIT; its LGPL Ogg parser is not used: `src/audio/ogg.ts` splits the pages). When it cannot play, a message offers the Hear tab |
| **Add to the Open Sound** (the + beside it) | A new track on the sound whose EDGEwave editor was active last (a voice line marked as one). With none open, it offers to open the sound on its own, or Create a Sound |
| **Open in EDGEwave** (inline) | The sound in its own document, as REDcode's Open in EDGEwave does |
| **Play in the Game** (right-click an event; added 2026-10-27) | Plays the event in the running game through REDnode 0.43's editor channel, on V, with the game's own mix ([API and MCP](api.html#in-the-running-game)). Without the game: a message saying to start it with REDnode |
| **Copy Name** (right-click) | An event's name, for a quest or a script; a file's path; a variation's hash |
| **Filter** (the view's title) | Words that must all be in the name (`judy q307`), or a pattern with `*` and `?` (`*_q307_f_*`), as REDcode's Game Assets filter takes them. It filters the events by name (or a hash), and searches the files through REDbridge (`archive.search`, the first 5,000 matches; the view says when it stopped). **Clear the Filter** shows everything again |

It needs REDcode's REDbridge running (a REDcode project open, or the bridge started); without it each group says so.

Unverified: that REDcode plays every streamed `.wem` in `soundbanks\media` (a voice line's `.wem` decodes to Ogg Vorbis; some streamed sounds may use another Wwise codec); how long a voice folder of 78,026 files takes to open on the owner's machine.

## What is built

| Part | Where |
|---|---|
| The view, its groups, the filter's search, its commands | `src/gameAssets.ts` |
| The filter, the grouping by name parts, sizes; pure, with unit tests | `src/assetTree.ts`, `test/events.test.ts` |
| The Hear panel for any game sound (`hear`) | `src/soundEvents.ts` |
| Add to the Open Sound (the sound editor active last) | `src/editor.ts` |
| REDbridge's `archive.tree` and `archive.search`, in EDGEwave's copy of REDcode's contract | `src/redcode.ts` |
