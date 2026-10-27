# V1 Voice tools

Status: **done 2026-10-20** (built 2026-10-18; hand test passed, [Tests](testing.html#v1-voice-tools)). Three buttons in the editor's header make new tracks through [ElevenLabs](https://elevenlabs.io), with the modder's own API key. Each use spends ElevenLabs credits. Plan agreed with the owner on 2026-10-18.

## The tools

| Button | Shown | What it does | ElevenLabs |
|---|---|---|---|
| **Generate Sound…** | Always | A sound effect from a description, 0.5 to 30 s (or from the prompt), seamless loop optional, and how closely to follow the prompt (0 to 1). Each try is a **take** in the dialog, with a play button: change the description and generate again, then **Add** the take you want as a new track at the mix cursor | `POST /v1/sound-generation` |
| **Speak Line…** | Always | Text spoken in a voice: one of the account's voices (searchable by name, gender, accent; each with a play button for its preview), or **the selected voice line's voice**. A model from the account's list. A new voice-line track at the mix cursor | `GET /v2/voices`, `GET /v1/models`, `POST /v1/text-to-speech/{voice}`; the line's voice is an instant clone, `POST /v1/voices/add` |
| **Re-Voice…** | On a voice line | The selected line's words, timing and delivery in another voice. **Describe the change** (such as "female", "older and raspy", "shouting, angry"): EDGEwave clones the line's voice, asks for remixes, you play the previews and pick one. Or **into one of your voices**. A new track at the line's place; the original is left out of the mix (untick to keep it in) | Describe: clone, `POST /v1/text-to-voice/{voice}/remix`, `POST /v1/text-to-voice` (saves the pick), then `POST /v1/speech-to-speech/{voice}`. Into a voice: speech-to-speech only |
| **Translate** | On a voice line | Still a stub: planned | |

Each result (for Generate Sound, the take added) is a mono WAV in the document's `<name>.gen` folder, beside it (for `42.edgewave`, `42.gen/`), named from the tool, the prompt or line, and the time. The track's `made` says how it was made: the tool, the prompt or text, the voice and model, and for a clone or Re-Voice the track it came from. Like Add Sound, a new track is an unsaved change to the document; undo removes the track but not its WAV.

## The API key

| | |
|---|---|
| Where | VS Code's secret storage (the operating system's keychain), never in settings or the document. The owner chose this over a setting on 2026-10-18 |
| Asked for | The first time a tool calls ElevenLabs, in a password box |
| Commands | **EDGEwave: Set ElevenLabs API Key**, **EDGEwave: Clear ElevenLabs API Key** |
| Missing or refused | Added 2026-10-27 at the owner's request. When there is no key (the password box closed) or ElevenLabs refuses it (a 401 that is not a used-up quota), the dialog, its voice list, or the Voice Lines panel says so, with **Set ElevenLabs API Key…** and **Where to make one** (ElevenLabs' help page). Once a key is set there, the voices and models load again; a request that failed is tried again by its button |
| Where to make one | elevenlabs.io > Developers > API Keys. A new key is restricted by default: turn on text to speech, voices, sound effects and voice changer ([ElevenLabs' help](https://help.elevenlabs.io/hc/en-us/articles/14599447207697-How-do-I-authorize-myself-using-an-API-key)) |
| In the page | Never: the page sends its request to the extension, which calls ElevenLabs |

## Cloning a voice

Speak Line in a line's voice, and Re-Voice by description, make an instant clone of the selected line's voice in the modder's ElevenLabs account. A game line's voice is a real voice actor's. ElevenLabs' usage policy forbids cloning a real person's voice without their consent, and they may block some voices. That comes from summaries of the policy; its text was not checked (**unverified**). The first clone asks, once, in a modal: **I have the right to clone this voice**, with a link to [ElevenLabs' policy](https://elevenlabs.io/use-policy). The owner agreed to this check on 2026-10-18.

| | |
|---|---|
| Reused | One clone per line (its source and edits): the second use of the same line makes no new clone |
| Made again | When a remembered clone was deleted on the website |
| A better clone | Comes from a longer line. ElevenLabs suggests more audio than one line (**unverified** how much) |
| Delete | **EDGEwave: ElevenLabs Voices Made by EDGEwave…** lists the clones and saved remixes EDGEwave made, to delete them. They take voice slots in the account |

## Audio format

EDGEwave asks for raw 16-bit PCM (`output_format=pcm_<rate>`) and wraps it as WAV, so no MP3 decoding is needed. The rate is `edgewave.elevenlabs.sampleRate`, 48 kHz by default. ElevenLabs' docs mark only 44.1 kHz as needing the Pro plan; if a plan refuses the rate asked for, EDGEwave uses 24 kHz from then on (the smoke test checks this). Add to Project resamples to what the game needs.

| Setting | Default | |
|---|---|---|
| `edgewave.elevenlabs.sampleRate` | 48000 | 48000, 44100 (Pro), 32000, 24000, 22050, 16000 |
| `edgewave.elevenlabs.speechModel` | ElevenLabs' default | Speak Line's first model, such as `eleven_v3` |
| `edgewave.elevenlabs.voiceChangerModel` | `eleven_multilingual_sts_v2` | Re-Voice's first model |
| `edgewave.elevenlabs.baseUrl` | `https://api.elevenlabs.io` | The US, EU, India and Singapore servers, for data residency |

**Verified in the hand test (2026-10-20):** a remix works on an instant clone (the docs do not say which voices can be remixed); a voice's preview (an MP3) plays in VS Code's page; 48 kHz PCM works on the owner's plan (no fallback to 24 kHz; other plans may refuse it, and EDGEwave then falls back). **Still unverified:** how well one game line clones.

## What is built

| Part | Where |
|---|---|
| The ElevenLabs client: the calls, PCM to WAV, errors as a modder reads them, file names from prompts. No VS Code imports; unit tests against a stand-in server | `src/elevenlabs.ts`, `test/elevenlabs.test.ts` |
| The tools on the extension's side: the key, the clone consent, the voices EDGEwave made, the rate fallback, Generate Sound's takes (the last 20, in memory), writing the WAV and the new track | `src/voiceTools.ts` |
| The forms, the voice list, the previews and takes | `webview/voice.ts`, `media/editor.css` |
| The track's `made` | `src/doc.ts` |
| The commands and settings; VS Code 1.90 or later (Node's own `fetch`) | `package.json`, `src/extension.ts` |

## Tests

The unit tests, the smoke test (against a stand-in ElevenLabs) and the hand test (with the real service, which spends credits) are in [Tests](testing.html#v1-voice-tools).
