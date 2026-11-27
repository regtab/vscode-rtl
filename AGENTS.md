# vscode-rtl

VS Code extension for RTL (Regular Table Language), a DSL for table patterns in
the RegTab project. It is implementation-independent: it supports all RegTab
implementations (jRegTab, pyRegTab, and future ones) without requiring Python or
a JDK on the user's machine.

**Roadmap: `plans/VSCODE_RTL_PLUGIN_PLAN.md`.** Implementation follows its phases
(0: migrate and publish syntax highlighting → 1: snippets/grammar tests → 2: LSP
diagnostics → 3: language features → 4: match preview). Consult the plan before
changing architectural decisions; every such change must update the plan in the
same PR.

## Related projects (local paths)

| Project | Path | What this repository uses |
|---|---|---|
| pyRegTab | `d:\YandexDisk\code2\pyregtab` | Extension prototype `ide/vscode/` (tmLanguage `.rtl`, Python injection, language-configuration, package.json); normative grammar `grammar/RTL.g4`; Rust compiler core `src/rtl/*` (the foundation for `rtl-lsp`); conformance corpus `conformance/{positive,negative}` (`.rtl` test files); reference guide `docs/rtl-reference.md` (source for hover content and snippets); `tools/check_grammar_sync.py` |
| jRegTab | `d:\YandexDisk\code2\jregtab` | Origin of the normative `RTL.g4`; ready-made Java injection `ide/vscode/syntaxes/rtl-java-injection.tmLanguage.json`; its own `ide/README.md` |
| data-wrangling-eval | `d:\YandexDisk\code2\data-wrangling-eval` | Real-world example of standalone `.rtl` usage: solutions `solutions/regtab/task_NNN.rtl`, data `fixtures/task_NNN/{input_k.csv, expected_k.csv, task_match_options.json}` — the reference scenario for preview and `rtl.fixtures.*` |

## Key facts and invariants

- **Extension identifier** `regtab.regtab` (name component `regtab`), publisher
  `regtab`, `displayName` “Regular Table Language (RTL)”. History: ID
  `regtab.regtab-rtl` and `displayName` “RegTab — Regular Table Language” were
  published but **deleted by the user on 2026-07-24**. Marketplace deletion
  **permanently retires both the ID and `displayName`** (both subsequently
  report “already exists / display name is taken”), so new ones were required.
  The tagline “RegTab matches tables the way RegEx matches text” (the
  RegEx↔RegTab association) is retained in the description. The ID is immutable
  after publication; `displayName` can be changed (and was changed in an
  update). **Never delete the listing again** — doing so would permanently
  retire `regtab` and the current `displayName`. The name “RegTab Tools” is
  reserved for a future extension pack (advanced linter, visual designer) and
  must not be used for a single extension. Publication blocking details:
  [[marketplace-injection-keyword-block]].
- **Normative grammar** — `RTL.g4` (pinned from jRegTab, with a copy in pyRegTab;
  currently at parity with jRegTab 0.5.1). RTL tokens are **case-insensitive**.
- **Single source of truth for TextMate grammars** — this repository since
  phase 0; `pyregtab/ide/` and `jregtab/ide/` contain only pointers. Changing
  `RTL.g4` in upstream projects requires synchronized grammar updates here
  (CI: `check:sync`).
- **`rtl-lsp`** — a standalone Rust binary built with tower-lsp and the pyRegTab
  core: a git dependency **pinned to a release tag** (currently `v0.5.1`,
  `default-features = false` — without `pyo3`), with the commit recorded in
  `server/Cargo.lock`. No adjacent pyRegTab checkout is required for building;
  only the hover generator needs one. The pin is mandatory: RTL execution
  semantics are part of the extension contract, and a floating `main` has
  already silently changed preview behavior (`S_delim` in 0.5.0). Update the tag
  only through a deliberate `server/Cargo.toml` change following the procedure
  in DEVELOPMENT.md. Core prerequisites have been released: the `python`
  feature (`pyo3` gating, since 0.4.0), `compile_permissive` (`EXT('…')`
  stubs), and error spans.
- **Marketplace discoverability**: the query “RTL” is dominated by right-to-left
  extensions; use “Regular Table Language”, “RegTab”, and “table extraction” in
  names and keywords.
- Canonicalization via `AtpToRtlSerializer` is normalization, not stylistic
  formatting (inherited actions are expanded at the atom level). It is
  implemented **only** as the read-only command “RTL: Show Canonical Form”
  (decision dated 2026-07-17): serialization discards comments (including
  `// fixture:`), so no formatter or format-on-save support exists or will be
  added.

## Conventions

- Documentation (including README sections), code, identifiers, extension UI
  text, and the Marketplace page are in English. Documents under `plans/`
  remain in Russian.
- Test `.rtl` files are copied from the pyRegTab conformance corpus with its
  version recorded (`conformance/VERSION`) and must not be edited manually.
- Commits and releases: extension SemVer is independent of jRegTab/pyRegTab
  versions; the grammar version is recorded in the README and the server's
  `initialize` response.
- **Publishing to the Marketplace or Open VSX requires explicit user approval**
  every time. Without that approval, do not run `vsce publish` or `ovsx publish`
  and do not push `v*` tags (`release.yml` performs publishing).
