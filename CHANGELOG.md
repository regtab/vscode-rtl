# Changelog

All notable changes to the RTL language extension are documented here.
The extension follows [semver](https://semver.org) independently of
jRegTab/pyRegTab versions; the pinned normative grammar version is recorded
in the README.

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
