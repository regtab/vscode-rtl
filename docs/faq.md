# FAQ and behavior notes

## Where do I learn the RTL language itself?

This extension tooling assumes you know (or are learning) RTL. The normative
reference lives in the RegTab project:

- [RTL reference](https://github.com/regtab/pyregtab/blob/main/docs/rtl-reference.md) —
  constraints, actions, providers, extractors, settings. The extension's
  hover documentation is generated from this document, so hovering a keyword
  in the editor gives you the same content in place.
- The grammar itself is `RTL.g4` (see the version pinned in the README).
  RTL keywords are **case-insensitive**.

## Why is there no formatter / format-on-save?

By design. The only normalization the toolchain offers is canonicalization
(**RTL: Show Canonical Form**), and canonicalization *loses information*:
comments — including `// fixture:` directives — and your authored layout are
dropped, and inherited actions are pushed down to atoms. Running that over
your source would be destructive, so it is exposed only as a read-only side
view: use it to see what the compiler actually understood, or to compare two
differently written patterns for equivalence — never to rewrite your file.

## Why doesn't `EXT('…')` produce an "unbound" error?

`EXT` predicates bind to a host runtime (a Python or Java function) at run
time, so in a standalone `.rtl` file there is nothing to resolve them
against. The bundled language server compiles patterns in *permissive* mode:
`EXT` calls are treated as satisfiable stubs and never reported as unbound
while editing. They are also stubbed during preview matching — a cell
guarded only by an `EXT` predicate matches as if the predicate returned
true.

## The preview says it needs `rtl-lsp`. What is that?

All language features beyond highlighting and snippets (diagnostics,
preview, canonical form, tests) are served by `rtl-lsp`, a standalone native
language server built on the RegTab Rust core. Platform-specific VSIX builds
bundle the binary in `bin/`; the *universal* VSIX ships without it.

On a platform without a bundled binary you can build the server yourself
(see `DEVELOPMENT.md` in the repository) and point the `rtl.server.path`
setting at the executable. Everything else — highlighting for `.rtl` files
and for embedded literals, snippets, editor basics — works without the
server. No Python or JDK is ever required.

## My Python/Java literal isn't highlighted or previewed

The literal must be *recognizable statically*. Supported triggers:

- Python: `RtlCompiler.compile("…")` — single-line, triple-quoted, and raw
  strings.
- Java: `RtlCompiler.compile("…")`, `@RtlSource("…")`, Java 15+ text blocks,
  and literals annotated with a `/* language=RTL */` comment.

Known limitations (inherited from TextMate injection grammars and mirrored
by the preview/diagnostics scanner):

- the **opening quote must be on the same line** as the trigger
  (`RtlCompiler.compile(` / `@RtlSource(`);
- string concatenation and f-strings are not scanned.

Diagnostics inside literals are mapped back through escapes and text-block
indentation, so positions in the host file are exact.

## How exactly is the recordset compared with an expected CSV?

Rows are compared as an **unordered multiset** by default (order ignored,
duplicates significant). Two settings refine this, globally or per
`rtl.fixtures.expected` rule: `expectedHasHeader` (first CSV row holds
column names, checked positionally against the recordset schema) and
`orderedRows` (row order becomes significant). See
[Binding fixtures and expected results](fixtures.md#comparison-semantics).

## Does the extension send my data anywhere?

No. Matching, diagnostics, and previews all run locally in the bundled (or
your own) `rtl-lsp` process. The extension makes no network requests.

## Something else is off

Set `"rtl.trace.server": "verbose"` and check *Output → RTL Language Server*
for the LSP traffic, then file an issue at
[github.com/regtab/vscode-rtl/issues](https://github.com/regtab/vscode-rtl/issues)
with the trace and, if possible, the pattern and fixture that reproduce it.
