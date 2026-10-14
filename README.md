# EDGEwave

Sound tools for Cyberpunk 2077 modding, as a VS Code extension. Part of the EDGE platform, beside [REDcode](https://github.com/Edgemodders/REDcode).

**[Read the docs](https://edgemodders.github.io/EDGEwave/)** &middot; [Design](https://edgemodders.github.io/EDGEwave/design.html)

> [!NOTE]
> **Status: design phase (A0).** The repository holds the extension skeleton and the design. Nothing else is built yet.

EDGEwave will index the game's audio from your own install, search it (sound effects, voice-over with its subtitles, music, radio), show what plays each sound and why, play it, and put a sound into the mod you are making in REDcode, to add or override a game sound.

| Part of EDGE | Role for EDGEwave |
|---|---|
| [REDbridge](https://github.com/Edgemodders/REDbridge) | Reads the game's archives, sound banks and Opus packs, and converts audio |
| [REDcode](https://github.com/Edgemodders/REDcode) | Owns the mod project that sounds go into |
| [REDnode](https://github.com/Edgemodders/REDnode) | Plays sounds in the running game (its Sound API is planned) |

EDGEwave is a clean-room implementation inspired by [Cyberpunk 2077 SoundDB](https://gitlab.com/cp2077-sounddb/frontend) by Zhincore: it uses none of SoundDB's code or data, only what its public documentation describes. See the design for the rule.

## Build

```powershell
npm install
npm run build
```

[Dev setup](https://edgemodders.github.io/EDGEwave/dev-setup.html) has the details.

## License

MIT. EDGEwave never contains game files or data extracted from the game.
