# EDGEwave: notes for Claude sessions

EDGEwave is the sound studio of the EDGE platform: a VS Code extension to edit, mix and re-voice Cyberpunk 2077's sounds and put them into a mod. It builds on REDcode (the IDE), which owns the project and the quick lookup of game sounds, reads the game through REDbridge (the engine host, GPL-3.0, its own program) and will play sounds in the game through REDnode. REDnode's `CLAUDE.md` and `docs/dev-setup.md` set the shared conventions.

## Current status and next step

- **A0 Scaffold (2026-10-14):** the extension skeleton (`src/extension.ts`, one placeholder command), the docs site in the HUD style, and the design in `docs/design.md`. Build nothing more until the design is agreed.
- **Design draft 2 (2026-10-14):** REDcode shipped a game sound browser and player (its C5 V2) the same day, so the owner decided (option A): REDcode keeps the lookup and gets an **Open in EDGEwave** button; EDGEwave is the studio (edit, mix, effects, render into the mod), depends on REDcode (`extensionDependencies`) and uses an API REDcode exports, as REDcode uses REDdeck's. Studio first: A1 Edit, A2 Mix, A3 Into the game, then the SoundDB-style index (A4). **Translate** and **Re-Voice** (AI voice tools through third-party services) are stub buttons only until the owner defines them. Opus or Vorbis encoding is deferred to A3; render WAV until then.
- **Next:** the owner reviews draft 2. Filed as REDcode issue #4 (https://github.com/Edgemodders/REDcode/issues/4, label `request`) for Open in EDGEwave and its exported API; REDcode's session builds them. Then A1, which needs #4. Never change REDcode or REDbridge from here; new REDbridge methods (the existing group is `sound`, with `sound.events`) are agreed with its session first.
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
