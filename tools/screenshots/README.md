# Screenshots and GIF for the README

The captures in `images/` were generated automatically (2026-07-20, VS Code
1.100.0 from `.vscode-test`, 200% display scaling for crisp 2× output) by the
scripts in this directory. The `images/` directory is excluded from the `.vsix`
by `.vscodeignore`; the Marketplace loads the images from GitHub through links
rewritten by `vsce`, so the captures must be pushed before publication.

## How it works

1. **Demo workspace** (see “Assets” below) with configured
   `rtl.fixtures.input/expected` and five patterns from data-wrangling-eval.
2. **Launch**: `Code.exe --extensionDevelopmentPath=<repo>
   --user-data-dir=<clean> --disable-extensions --remote-debugging-port=9333
   <workspace>` (a fresh `user-data-dir` with `workbench.colorTheme: "Default
   Dark Modern"`, `window.zoomLevel: 0`, and minimal UI chrome).
3. **Control** — `tools/screenshots/driver.mjs` (CDP over port 9333, no
   dependencies): commands `palette`, `quickopen`, `keys`, `click`, `dblclick`,
   `wheel`, `type`, `shot`. Window size is managed by
   `tools/screenshots/win.ps1` (SetWindowPos, physical pixels).
4. **GIF** — `gifrec.mjs` captures frames (an approximately 350 ms screenshot
   loop) during the “{2} → double-click → 3 → preview redraws” scenario;
   `assemble.mjs` (requires `npm i gifenc pngjs`) assembles `preview.gif` with
   2× downscaling. Known issue: CDP `rawKeyDown` does not handle Backspace or
   selection operations; replace text only through `dblclick` +
   `Input.insertText`.

## Captures

| File | Content | Assets |
|---|---|---|
| `preview.gif` | Main animation: editing the quantifier `{2}`→`{3}` redraws the preview — ragged records containing ∅ become a clean recordset | Synthetic `quarterly.rtl` + `quarterly.csv` (city × quarter, task_026 structure) with a `// fixture:` directive |
| `diagnostics.png` | Error squiggle and Problems entry “expected cell match constraint…” | Variant of task_018 with a typo (`->AVP` without a provider) |
| `expected-diff.png` | “✗ Recordset differs… — 1 missing, 1 extra”, Missing/Extra sections | task_026, with one value changed in expected_1.csv |
| `test-explorer.png` | Testing view: 24/25, expanded red node, pattern on the right | 5 tasks × 5 fixtures from data-wrangling-eval |
| `embedded-python.png` | RTL highlighting in `RtlCompiler.compile("""…""")` + CodeLens | Synthetic `extract.py` with the task_036 pattern |

## Assets

The demo workspace is assembled from `d:\YandexDisk\code2\data-wrangling-eval`:
`solutions/regtab/task_{013,018,023,026,036}.rtl` + their `fixtures/`, with these settings:

```json
{
  "rtl.fixtures.input": [{ "pattern": "**/solutions/regtab/*.rtl",
    "input": "${workspaceFolder}/fixtures/${basename}/input_*.csv" }],
  "rtl.fixtures.expected": [{ "pattern": "**/solutions/regtab/*.rtl",
    "expected": "${workspaceFolder}/fixtures/${basename}/expected_*.csv" }],
  "rtl.fixtures.expectedHasHeader": true
}
```

For the failing test, change one value in a copy of `expected_1.csv` for
task_026. Do not modify the original fixtures.
