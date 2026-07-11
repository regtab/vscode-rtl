# RegTab RTL — Regular Table Language

Language support for **RTL (Regular Table Language)** — the pattern DSL for
extracting structured records from arbitrarily-shaped tables, developed by the
[RegTab](https://github.com/regtab) project.

RTL patterns describe the layout of a table (subtables, rows, cells), constrain
cell content, and specify how matched cells are interpreted into a record set.
This extension works with **any** RegTab implementation — jRegTab (Java),
pyRegTab (Python) — and with standalone `.rtl` files that are not tied to a host
runtime at all.

```rtl
// Airline on-time performance: header row + repeated data rows
[ [] [VAL: 'AIRLINE'->AVP]+ ]
[ [VAL: 'AIRPORT'->AVP] [VAL: (COL,ROW,CL)->REC, 'ND'->AVP ' ' VAL: 'MON'->AVP]+ ]+
```

## Features

- **Compile diagnostics as you type** — powered by `rtl-lsp`, a standalone
  native language server built on the RegTab Rust core. Errors are underlined
  at the exact source position with the compiler's message. `EXT('…')`
  predicates are never reported as unbound while editing standalone files
  (they bind to the host runtime only at run time). Platform-specific builds
  bundle the server; on other platforms point `rtl.server.path` at your own
  binary, or use the extension with highlighting only.
- **Syntax highlighting for `.rtl` files** — keywords, actions, providers,
  extractors, fragments (`$NAME`), tags (`#'…'`), strings, comments, quantifiers.
- **RTL inside Python strings** — literals passed to `RtlCompiler.compile("…")`
  (single-line, triple-quoted, and raw strings) are highlighted as RTL.
- **RTL inside Java strings** — `RtlCompiler.compile("…")`, the `@RtlSource("…")`
  annotation, Java 15+ text blocks (`"""…"""`), and literals marked with
  `/* language=RTL */`.
- **Snippets** for frequently used combinations: `ST*->REC`, `(SC{n}, SR)->REC(n)`,
  `^COL->AVP`, `('LABEL')->AVP`, `CL->JOIN(0)`, `-AV->PREFIX(', ')`, table and
  fragment skeletons, settings, conditional cells.
- **Editor basics** — bracket matching and auto-closing for `[] {} () <>`,
  `//` line comments.

No Python, JDK, or other runtime is required — the extension is fully
self-contained.

### Python

```python
from pyregtab import RtlCompiler

pattern = RtlCompiler.compile("""
[ [ATTR]+ ]
[ [VAL : ST*->REC]+ ]+
""")
```

### Java

```java
@RtlSource("""
    [ [ATTR]+ ]
    [ [VAL : ST*->REC]+ ]+
    """)
String pattern;

var atp = RtlCompiler.compile("[ [VAL: 'LABEL'->AVP] ]+");
```

*(TextMate limitation: the opening quote must be on the same line as
`RtlCompiler.compile(` / `@RtlSource(`.)*

## Roadmap

- Hover reference, completion, `$fragment` navigation and rename.
- Live match preview: run a pattern against a CSV fixture with cell-role
  coloring and the extracted record set.

## Grammar version

Highlighting mirrors the normative RTL grammar `RTL.g4` from **jRegTab 0.4.1**
(RTL tokens are case-insensitive). Any change to the normative grammar must be
accompanied by a matching tmLanguage update in this repository — CI enforces
keyword-coverage sync.

## Related projects

- [jRegTab](https://github.com/regtab/jregtab) — Java implementation of RegTab.
- pyRegTab — Python implementation of RegTab (Rust core).

## License

[MIT](LICENSE)
