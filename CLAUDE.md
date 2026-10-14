# EDGEwave: notes for Claude sessions

EDGEwave is a VS Code extension with sound tools for Cyberpunk 2077 modding, part of the EDGE platform. It works beside REDcode (the IDE), reads the game through REDbridge (the engine host, GPL-3.0, its own program) and will play sounds in the game through REDnode. REDnode's `CLAUDE.md` and `docs/dev-setup.md` set the shared conventions.

## Current status and next step

- **A0 Scaffold (2026-10-14):** the extension skeleton (`src/extension.ts`, one placeholder command), the docs site in the HUD style, and the design in `docs/design.md`. The owner asked for the scaffold and the design only, so build nothing more until the design is agreed.
- **Next:** the owner reviews the design. Then A1 Index, which needs new `audio` methods in REDbridge: agree them with the REDbridge session first, and never change REDbridge from here without that.
- **REDnode's Sound API** (REDnode `docs/sound.md`) is planned, not built: phases S1 to S4, after REDnode's TweakDB API and Spaces. EDGEwave's in-game features (A5) wait for it.

## Clean-room rule (agreed with the owner on 2026-10-14)

EDGEwave reimplements what [Cyberpunk 2077 SoundDB](https://gitlab.com/cp2077-sounddb/frontend) does. SoundDB's frontend and extractor have no license (all rights reserved); its backend is GPL-3.0.

- Never read, copy or port SoundDB's source code: frontend, extractor or backend. Reading their README files, the frontend's About page and search guide (`content/about.md`), the public API reference (`https://sounddb.zhincore.eu/api.json`, for its endpoint and field names), screenshots and Zhincore's thesis is allowed.
- Never use SoundDB's data files or its API. Build everything from the player's own game.
- When a spec item comes from SoundDB's docs, say so in the design (the "D" source marker).

## Conventions

- **Commits:** commit straight to `main` and push, in small logical commits. Agree the plan in chat first.
- **Git identity:** per repository: `CyberbuildsAI`, `340969962+CyberbuildsAI@users.noreply.github.com`, and `credential.https://github.com.username CyberbuildsAI`. Never change the global identity. Push with `GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never timeout 120 git push`, after `git pull --rebase`.
- **Never commit game files** or anything extracted or converted from them: archives, `.bnk`, `.wem`, Opus packs, decoded audio, or an index built from them. `.gitignore` covers the common cases.
- **Writing style:** plain, short sentences. Tables for comparisons and lists of facts. Mark anything unverified as unverified.
- **Docs site:** `docs/` is published by GitHub Pages (`.github/workflows/pages.yml`) at https://edgemodders.github.io/EDGEwave/; add every new page to `nav` in `docs/_config.yml`. The owner must set Settings > Pages > Source to GitHub Actions once.
