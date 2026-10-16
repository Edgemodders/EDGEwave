# Dev setup

EDGEwave follows the EDGE platform's shared setup: [REDnode's dev setup](https://edgemodders.github.io/REDnode/dev-setup.html) installs Git, Node and VS Code, and sets the per-repository Git identity. This page lists what EDGEwave adds.

| Tool | Version | Why |
|---|---|---|
| Node | 24 (24.11.1 tested) | Builds the extension |
| VS Code | 1.80 or later | Runs it |
| REDbridge | From A1 on | Reads the game's audio. REDdeck's **Get REDbridge** or REDcode's **Install REDbridge** fetches it |

## Build

```powershell
git clone https://github.com/Edgemodders/EDGEwave.git
cd EDGEwave
npm install
npm run build       # bundles src/ to dist/extension.js
npm run typecheck
npm test            # unit tests of the edits, the WAV writer and the document
npm run smoke       # VS Code with a stand-in REDcode, driven end to end (downloads VS Code once)
```

What each test checks, and the hand tests: [Tests](testing.html).

Press **F5** with the repository open in VS Code to run the extension in an Extension Development Host: **Run EDGEwave** in `.vscode/launch.json` builds first. EDGEwave needs REDcode's API (REDcode 0.9.0); until that is released, **Run EDGEwave with REDcode main** loads REDcode from `../REDcode` beside it (build REDcode first). The **Check** workflow typechecks and builds every push to `main`.

## Git identity

Set per repository, never globally, as on every EDGE repository:

```powershell
git config user.name CyberbuildsAI
git config user.email 340969962+CyberbuildsAI@users.noreply.github.com
git config credential.https://github.com.username CyberbuildsAI
```
