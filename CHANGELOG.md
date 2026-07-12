# Changelog

All notable changes to the RTL language extension are documented here.
The extension follows [semver](https://semver.org) independently of
jRegTab/pyRegTab versions; the pinned normative grammar version is recorded
in the README.

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
