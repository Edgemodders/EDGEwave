# EDGEwave Voice

A REDnode package: speaks lines of text in a voice, on demand, for other mods. A mod that writes its dialogue as it goes (an AI companion, a generated conversation) calls it, and the line plays on the game's Dialogue volume, spoken through ElevenLabs with your own API key.

```js
import { service } from 'rednode';

const voice = await service.connect('edgewave-voice');
const line = await voice.speak('Choom, you look like hell.', 'judy');
voice.$on('ended', (e) => { if (e.id === line.id) console.log('done'); });
```

- Needs REDnode 0.36 or later in the game, an ElevenLabs account and its API key. Each new line spends your ElevenLabs credits; a line spoken before plays from the cache.
- Set up its voices in VS Code with EDGEwave: **EDGEwave: Voices for REDnode…**. That also installs or updates this package.
- In the game, open **EDGEwave Voice** from REDnode's launcher (F10) and paste your key once. It is kept encrypted with your Windows account.

Docs: https://edgemodders.github.io/EDGEwave/rednode-voice.html
