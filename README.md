<p align="center">
  <img src="docs/assets/brand/banner.png" alt="EDGEwave: search, hear and use Cyberpunk 2077's audio, from your own game, inside the editor. Search sounds, voice and radio; reads the game with REDbridge; works with REDcode and REDnode." width="100%">
</p>

<p align="center">
  <a href="https://edgemodders.github.io/EDGEwave/"><img src="docs/assets/brand/badges/docs.svg" alt="docs: read the docs"></a>
  <img src="docs/assets/brand/badges/status.svg" alt="status: design phase">
  <a href="https://github.com/Edgemodders/REDcode"><img src="docs/assets/brand/badges/redcode.svg" alt="works with: REDcode"></a>
  <a href="https://github.com/Edgemodders/REDbridge"><img src="docs/assets/brand/badges/redbridge.svg" alt="reads with: REDbridge"></a>
  <a href="LICENSE"><img src="docs/assets/brand/badges/license.svg" alt="license: MIT"></a>
</p>

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

## Repository layout

| Path | Contents |
|---|---|
| `src/` | The extension |
| `docs/` | The documentation site |
| `tools/brand/` | Makes the banner, social preview, icon and badges (`.\tools\brand\render.ps1`) |

## Build

```powershell
npm install
npm run build
```

[Dev setup](https://edgemodders.github.io/EDGEwave/dev-setup.html) has the details.

## License

MIT. EDGEwave never contains game files or data extracted from the game.
