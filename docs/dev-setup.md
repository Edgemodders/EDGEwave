# Dev setup

EDGEwave follows the EDGE platform's shared setup: [REDnode's dev setup](https://edgemodders.github.io/REDnode/dev-setup.html) installs Git, Node and VS Code, and sets the per-repository Git identity. This page lists what EDGEwave adds.

| Tool | Version | Why |
|---|---|---|
| Node | 24 (24.11.1 tested) | Builds the extension |
| VS Code | 1.90 or later | Runs it (Node 20, for the voice tools' fetch) |
| REDbridge | From A1 on | Reads the game's audio. EDGEdeck's **Get REDbridge** or REDcode's **Install REDbridge** fetches it |

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

Press **F5** with the repository open in VS Code to run the extension in an Extension Development Host: **Run EDGEwave** in `.vscode/launch.json` builds first. EDGEwave needs REDcode for Cyberpunk 2077 0.10.3 or later (0.10.0 for all but the Project view's Open Sound in EDGEwave…), installed in your VS Code (the Development Host uses it); **Run EDGEwave with REDcode main** loads REDcode from `../REDcode` beside it instead (build REDcode first), to try EDGEwave against REDcode's unreleased work. The **Check** workflow typechecks and builds every push to `main`; releasing is on [Release](release.html).

## Git identity

Set per repository, never globally, as on every EDGE repository:

```powershell
git config user.name CyberbuildsAI
git config user.email 340969962+CyberbuildsAI@users.noreply.github.com
git config credential.https://github.com.username CyberbuildsAI
```
