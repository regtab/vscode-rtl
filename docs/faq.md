# FAQ and behavior notes

## Where can I learn the RTL language itself?

The extension provides tooling for RTL rather than a language tutorial. The
normative language reference lives in the RegTab project:

- [RTL reference](https://github.com/regtab/pyregtab/blob/main/docs/rtl-reference.md) —
  constraints, actions, providers, extractors, and settings. The extension's
  hover documentation is generated from this document, so hovering over a
  keyword in the editor shows the same content in place.
- The grammar itself is `RTL.g4` (see the version pinned in the README).
  RTL keywords are **case-insensitive**.

## Why is there no formatter or format-on-save support?

This is intentional. The only normalization the toolchain offers is
canonicalization (**RTL: Show Canonical Form**), and canonicalization *loses
information*: comments — including `// fixture:` directives — and the original
formatting are discarded, and inherited actions are expanded at the atom level.
Applying it to your source would be destructive, so it is exposed only as a
separate read-only view. Use it to see how the compiler interpreted the pattern
or to compare two differently written patterns for equivalence — never to
rewrite your file.

## Why doesn't `EXT('…')` produce an “unbound” error?

`EXT` predicates bind to a host runtime (a Python or Java function) at run
time, so in a standalone `.rtl` file there is nothing against which to resolve
them. The bundled language server compiles patterns in *permissive* mode:
`EXT` calls are treated as satisfiable stubs and are not reported as unbound
while editing. They are also stubbed during preview matching — a cell guarded
only by an `EXT` predicate matches as if the predicate returned true.

## The preview says it needs `rtl-lsp`. What is that?

All language features beyond highlighting and snippets (diagnostics, preview,
canonical form, and tests) are provided by `rtl-lsp`, a standalone native
language server built on the RegTab Rust core. Platform-specific VSIX builds
bundle the binary in `bin/`; the *universal* VSIX ships without it.

On a platform without a bundled binary, you can build the server yourself
(see `DEVELOPMENT.md` in the repository) and point the `rtl.server.path`
setting at the executable. Everything else — highlighting for `.rtl` files
and embedded literals, snippets, and editor basics — works without the server.
No Python or JDK is required.

## My Python or Java literal is not highlighted or previewed

The literal must be *statically recognizable*. Supported triggers:

- Python: `RtlCompiler.compile("…")` — single-line, triple-quoted, and raw
  strings.
- Java: `RtlCompiler.compile("…")`, `@RtlSource("…")`, Java 15+ text blocks,
  and literals annotated with a `/* language=RTL */` comment.

Known limitations (inherited from TextMate injection grammars and shared by
the preview/diagnostics scanner):

- the **opening quote must be on the same line** as the trigger
  (`RtlCompiler.compile(` or `@RtlSource(`);
- string concatenation and f-strings are not supported.

Diagnostics inside literals are mapped back through escape sequences and
text-block indentation, so positions in the host file are exact.

## How exactly is the recordset compared with an expected CSV?

The extracted and expected rows are compared as **unordered multisets** by
default: row order is ignored, but duplicate counts are significant. Two
settings control the comparison globally or per `rtl.fixtures.expected` rule:
`expectedHasHeader` (the first CSV row contains column names, checked
positionally against the recordset schema) and `orderedRows` (row order becomes
significant). See
[Binding fixtures and expected results](fixtures.md#comparison-semantics).

## Does the extension send my data anywhere?

No. Matching, diagnostics, and previews all run locally in the bundled (or
your own) `rtl-lsp` process. The extension makes no network requests.

## Troubleshooting

Set `"rtl.trace.server": "verbose"` and check *Output → RTL Language Server*
for the LSP traffic, then file an issue at
[github.com/regtab/vscode-rtl/issues](https://github.com/regtab/vscode-rtl/issues)
with the trace and, if possible, the pattern and fixture that reproduce the
problem.
