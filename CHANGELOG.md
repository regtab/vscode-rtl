# Changelog

All notable changes to the RTL language extension are documented here.
The extension follows [semver](https://semver.org) independently of
jRegTab/pyRegTab versions; the pinned normative grammar version is recorded
in the README.

## 0.8.4

- README now shows the extension in action: screenshots of diagnostics,
  embedded-Python highlighting, the expected-result diff and the Test
  Explorer, plus an animated GIF of the live match preview.
- New docs: `docs/fixtures.md` — a complete guide to binding `.rtl` patterns
  to CSV fixtures and expected results (directives, settings templates,
  snippet-style transforms); `docs/faq.md` — common questions, linked from
  the README.
- Marketplace metadata: the displayName dash is plain ASCII
  («RegTab - Regular Table Language») and the `regex`-related keywords were
  dropped to keep the listing focused on table extraction.

## 0.8.3

- Renamed for the Marketplace: displayName is now **«RegTab — Regular Table
  Language»** (was «RegTab RTL»), the description opens with the positioning
  hook «RegEx matches text; RegTab matches tables», and `regex` / `regular
  expression` / `table patterns` / `CSV` joined the keywords. The extension id
  is `regtab.regtab-rtl` — the Marketplace requires a globally unique `name`
  and `rtl` is taken by a right-to-left extension. «RegTab Tools» is reserved
  as the name of a future extension pack, not of this extension.
- New icon — the RegTab `][][` mark (rendered from the project's `icon.svg`).

## 0.8.2

- Snippet-style transforms in `rtl.fixtures.input` / `rtl.fixtures.expected`
  templates: `${basename/regex/replacement/flags}` (the VS Code snippet
  transform syntax). Lets a settings rule map host files whose names don't
  literally match the fixture layout — e.g.
  `${workspaceFolder}/src/test/resources/tasks/${basename/RtlTask(.+)Test/task_$1/}/input_*.csv`
  binds jRegTab's `RtlTask001Test.java` to `tasks/task_001/` without touching
  the sources. An invalid regex leaves the variable unsubstituted so the
  failure is visible in the unresolved path.

## 0.8.1

- `${workspaceFolder}` is now substituted in `// fixture:` and `// expected:`
  directive paths (falling back to the file's directory outside a workspace).
  Useful for RTL literals in host files nested deep away from their fixtures —
  e.g. a Java test under `src/test/java/…` can write
  `// fixture: ${workspaceFolder}/src/test/resources/tasks/task_001/input_1.csv`
  instead of a `../../../../../…` chain. Applies everywhere directives are
  read: `.rtl` files, Python/Java literals, and Test Explorer discovery.

## 0.8.0

- **Diagnostics for RTL inside Python/Java string literals** (plan §5,
  phase 5 step 1): compile errors in patterns embedded via
  `RtlCompiler.compile(…)`, `@RtlSource(…)` or a `/* language=RTL */` marker
  are now underlined directly in the host file, at the exact source
  position — escape sequences and the incidental indentation of Java text
  blocks are accounted for by an offset map built during extraction. Same
  limitations as highlighting and preview: the opening quote must be on the
  trigger's line; concatenation and f-strings are not recognized.
- The rtl-lsp server now also starts when an open Python/Java file actually
  contains RTL literals (it still never starts for host files without RTL).

## 0.7.0

- **Expected-result diff in the preview** (plan §5, phase 4 item 5): bind an
  expected CSV to a fixture and the preview shows whether the extracted
  recordset matches it — ✓ green on success, otherwise the missing and extra
  records (rows compare as an unordered multiset, column order significant,
  cells exact — the data-wrangling-eval comparison semantics). Binding
  sources, most specific first: an `// expected: path` directive (the i-th
  pairs with the i-th `// fixture:`), or the `rtl.fixtures.expected`
  setting — a template/rules array symmetric to `rtl.fixtures.input`
  (a multi-file expansion pairs with the input expansion positionally, a
  single file serves every input). Comparison options:
  `rtl.fixtures.expectedHasHeader` (first expected row = column names,
  checked positionally against the recordset schema) and
  `rtl.fixtures.orderedRows`; both can be overridden per rule.
- **Test Explorer** (plan §5, phase 4 item 6): every `.rtl` × input pair
  with an expected result appears in VS Code's Testing view — run one
  pattern or the whole catalog and get pass/fail with the diff text on
  failures. Discovery is lazy (first opening of the Testing view) and
  follows the same binding rules as the preview; the rtl-lsp server starts
  on the first run. The extension now also activates when a workspace
  contains `.rtl` files.

## 0.6.0

- **RTL: Show Canonical Form** (plan §5, phase 3 item 5 as amended): a new
  command that shows the canonical (normalized) form of the pattern —
  inherited actions pushed down to atoms, the same form as the
  `.expected.rtl` files of the conformance corpus — in a read-only editor
  beside the source. Useful for debugging match semantics ("what did the
  compiler actually understand?") and for comparing differently written
  patterns for equivalence. Works on `.rtl` files and on RTL string literals
  in Python/Java. Deliberately **not** a formatter: canonicalization drops
  comments (including the `// fixture:` directive) and the authored layout,
  so it never touches the source document.

## 0.5.1

- Fix: the **▶ Preview RTL…** CodeLens now appears on Python and Java files
  without needing an `.rtl` file open first — the extension activates on
  those languages (`onLanguage:python`, `onLanguage:java`). The rtl-lsp
  server is still started lazily (on the first `.rtl` document or the first
  preview request), so opening a Python/Java file that has no RTL never
  spawns it.

## 0.5.0

- **Preview from host-language string literals** (plan phase 5, step 0): the
  match preview now also works on RTL embedded in Python and Java sources —
  `RtlCompiler.compile("…")` (plain/raw/triple-quoted strings),
  `@RtlSource("…")`, Java text blocks and `/* language=RTL */` markers get a
  **▶ Preview RTL…** CodeLens; the commands also work from the cursor
  position. Java text blocks are stripped of incidental indentation; common
  escape sequences are decoded (raw strings taken verbatim). Fixture binding
  works as for `.rtl` files — a `// fixture:` directive inside the literal,
  a remembered per-literal choice, or `rtl.fixtures.input` (now matched
  against the host file, `${basename}` = host file name).
- Known limitations (same as the highlighting injections): the opening quote
  must be on the same line as the trigger; string concatenation and f-strings
  are not recognized.

## 0.4.1

- Preview granularity refined from cells to **cell-derived items** (plan §5.4
  as amended): one cell may hold several items with different roles —
  compound `[VAL ' ' VAL]`, delimited `(VAL){','}`, mixed `[ATTR ":" VAL]`.
  The webview now highlights each item's source segment inside the raw cell
  text with its role color (delimiters and unmatched text stay dimmed), and
  the segment tooltip shows the item's role, tags and extracted string —
  useful when `REPL`/`SUBSTR`/`NORM` rewrite it. Powered by the new `span`
  field of `CellDerivedItem` in the pyRegTab core.

## 0.4.0

- **Live match preview**: run the current `.rtl` pattern against a CSV
  fixture — a side panel shows the table with matched cells colored by role
  (VAL / ATTR / AUX / unmatched) and the extracted recordset, re-running on
  every edit (debounced). Implemented as the `rtl/matchFixture` custom
  request in `rtl-lsp` (CSV → TableSyntax → matcher → interpreter).
- Fixture association, from specific to generic: a `// fixture: path`
  directive in the pattern, the **RTL: Select Fixture…** command (remembered
  per file), and the `rtl.fixtures.input` workspace setting — a template
  with `${basename}`/`${dir}`/`${workspaceFolder}` variables and a trailing
  `*` glob, or an array of `{pattern, input}` rules (first match wins), so a
  directory of standalone patterns works without editing each file.
- CodeLens on the first line: **▶ Preview with <fixture>** / **Select
  fixture…**.

## 0.3.0

- Hover reference for every RTL keyword — spatial/positional/content
  constraints, actions, extractors, settings, `EXT`, quantifiers, `->`, tags,
  fragments. Content is generated from the normative RTL reference
  (`docs/rtl-reference.md` in pyRegTab) by `tools/gen_hover_data.py`.
- Context-aware completion: actions after `->`, extractors after `=`,
  declared fragments after `$`, known tags after `#`, settings inside `<…>`,
  constraints/directives elsewhere.
- `$fragment` navigation: go to definition, find references, rename
  (definition + all references, case-insensitive), and document symbols
  (fragments, subtables, rows) for Outline/breadcrumbs.

## 0.2.0

- Compile diagnostics via `rtl-lsp`, a standalone native language server built
  on the pyRegTab Rust core (grammar parity: jRegTab 0.4.1). No Python, JDK or
  RegTab installation is required — platform-specific VSIXes bundle the binary.
- Permissive compilation: `EXT('name')` predicates are never reported as
  unbound during standalone editing (they resolve against host-runtime
  `Bindings` only at run time).
- New settings: `rtl.server.path` (use your own server binary; enables
  diagnostics on platforms without a bundled one) and `rtl.trace.server`.
- The universal (platform-neutral) VSIX still works everywhere with
  highlighting and snippets only; a status-bar hint marks the degraded mode.
- Structure-aware bracket colors: each structural level gets a fixed color —
  subtable `{}`, row `[]`, subrow `{}`, cell `[]` (the grammar now tracks the
  nesting instead of tokenizing brackets generically). Depth-cyclic bracket
  pair colorization is disabled by default for RTL so these colors stay
  visible; re-enable with `"[rtl]": {"editor.bracketPairColorization.enabled": true}`.

## 0.1.0

Initial release (grammar parity: jRegTab 0.4.1).

- Syntax highlighting for `.rtl` files (TextMate grammar moved here from
  `pyregtab/ide/vscode/`; this repository is now its canonical home).
- Injection grammars: RTL inside Python string literals
  (`RtlCompiler.compile(…)`) and Java string literals/text blocks
  (`RtlCompiler.compile(…)`, `@RtlSource(…)`, `/* language=RTL */` marker).
- Language configuration: brackets, auto-closing pairs, `//` comments.
- Snippets for frequently used RTL combinations.
- Grammar snapshot tests on conformance-corpus files and a CI sync-check
  against the pinned normative grammar `RTL.g4`.
