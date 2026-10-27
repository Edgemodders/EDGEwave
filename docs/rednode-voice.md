# EDGEwave Voice for REDnode

Status: **built 2026-10-27** at the owner's request; hand test in the game pending ([Tests](testing.html#edgewave-voice-for-rednode)). A REDnode package that speaks lines of text in a voice, on demand, in the running game. It is for mods that write their dialogue as they go, such as an AI companion or a generated conversation. Phase 2, a REDnode API that any provider fills, is [REDnode #20](https://github.com/Edgemodders/REDnode/issues/20).

## What it is

| | |
|---|---|
| A game mod | `edgewave-voice`, a REDnode package (a Node mod with a service file). Needs REDnode 0.36 or later (a package's own sounds, secrets, the window builder, and services with their descriptions and tools; no newer REDnode is needed). Downloaded on its own from EDGEwave's [GitHub releases](https://github.com/Edgemodders/EDGEwave/releases) or [Nexus page](https://www.nexusmods.com/cyberpunk2077/mods/35493) (an optional file, `edgewave-voice-<version>.zip`), or installed by EDGEwave's **Voices for REDnode…** |
| Speech | ElevenLabs text to speech, with the player's own API key. Model `eleven_flash_v2_5` unless `voices.json` says otherwise; 24 kHz mono |
| Plays | Through REDnode's audio on the game's **Dialogue** slider; pauses in menus |
| Cache | Each line is kept as a WAV in the package's `.cache` folder: the same text in the same voice plays again at once, with no credits spent. Up to 200 MB; the lines used longest ago go first |
| VS Code | Not needed in the game. EDGEwave makes the voices (Speak Line's clone of a line, Re-Voice's remix) and names them for the package |

## Set it up

1. In VS Code, **EDGEwave: Voices for REDnode…**. Pick the ElevenLabs voices mods may use; the voices EDGEwave made come first. EDGEwave installs the package in the game (`red4ext/plugins/REDnode/apps/edgewave-voice/`, next to REDnode, found through REDcode's game folder), or updates it, and writes `voices.json`: a short name for each voice (such as `judy`), the first the default. A voice already named keeps its name. Edit `voices.json` to rename one or set a voice's `model`.
2. In the game, press **F10**, open **EDGEwave Voice** from REDnode's launcher, paste your ElevenLabs key and press **Enter**. REDnode keeps it encrypted with your Windows account; EDGEwave cannot put it there for you, because a package reads only its own secrets. **Copy the Key** in step 1's message puts it on the clipboard.
3. **Try a line** in the same window: **Speak**.

With a key set, the window starts closed; the launcher shows it again.

## For mod authors

```js
import { service } from 'rednode';

const voice = await service.connect('edgewave-voice');
const line = await voice.speak('Choom, you look like hell.', 'judy');
voice.$on('ended', (e) => { if (e.id === line.id) nextLine(); });
await voice.prepare(next, 'judy'); // make the next line while this one plays
```

Add `"requires": { "edgewave-voice": ">=0.1" }` to your manifest, so the Mod Manager says when it is missing.

| Function | Does | Answers |
|---|---|---|
| `speak(text, voice?, options?)` | Makes the line (or finds it in the cache) and plays it. Resolves once it plays | `{ id, seconds, cached, voice }` |
| `prepare(text, voice?, options?)` | Makes the line without playing it | `{ seconds, cached, voice }` |
| `stop(id?, fadeOut?)` | Stops one line, or all of them | `{ stopped }` |
| `voices()` | The names set up in `voices.json` | `[{ name, label, default }]` |
| `status()` | Whether it can speak | `{ provider, key, voices, model, lastError? }` |
| Event `ended` | A line finished, was stopped, or could not play | `{ id, why, caller }` |

| Argument | |
|---|---|
| `voice` | A name from `voices.json` (any case), or an ElevenLabs voice id (20 letters and digits). Without it, the default |
| `options` | `model` (an ElevenLabs model id), `volume` (1 as made), `pan` (-1 to 1), `category` (`dialogue` unless given) |
| `text` | Up to 2,500 characters. Speak a conversation line by line: each line starts sooner |

`speak`, `stop`, `voices` and `status` are also tools for AI assistants connected to REDnode (`edgewave-voice__speak` and so on); `speak` and `stop` ask the player first.

Errors say what to do: no key yet, the key refused, no such voice, ElevenLabs unreachable, the text too long.

## Limits

| | |
|---|---|
| Wait | A new line takes a second or more (unmeasured). `prepare` hides it when the next line is known. Streaming would start sooner; it needs REDnode ([#20](https://github.com/Edgemodders/REDnode/issues/20)) |
| Credits | Each new line spends the player's ElevenLabs credits. A limit per mod is asked of REDnode in #20 |
| Voices | A voice id belongs to one ElevenLabs account. A mod shared with other players needs their own key and voices; it can name ElevenLabs' stock voices by id, or ask players to set up names it expects |
| A real voice | A clone of a game line is a real voice actor's voice. ElevenLabs' usage policy applies, and sharing it with other players goes further than your own play |
| No lip sync | Voice only. Subtitles are the calling mod's job |
| The cache | In the package's own folder (`.cache`), because REDnode's `audio.play` plays only files inside a package's folder, and hot reload skips dot folders. A supported way is asked of REDnode in #20 |

*Unverified until the hand test:* that a Node mod reaches ElevenLabs from inside the REDnode host; that `audio.play` takes a file written after the package started; that the launcher shows the window again after the package closed it at start.

## Source

`rednode/edgewave-voice/` (the manifest, `mod.mjs` the window, `service.mjs` the functions), `src/voicePackage/core.ts` (the engine, bundled into the package as `core.mjs` with EDGEwave's ElevenLabs client), `src/voicePackage/config.ts` (`voices.json`), `src/voicePackage/install.ts` (the command). `npm run build` puts the package together in `dist/rednode/edgewave-voice`; add that folder as a REDnode development folder to run it from the repo. `npm run rednode-zip` makes the download.
