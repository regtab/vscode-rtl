# Binding fixtures and expected results

The live match preview, expected-result diff, and Test Explorer use two kinds
of CSV input: an input fixture and an optional expected-result CSV. This page
describes every way to bind them and how the sources interact.

Terminology:

- **Pattern** — a `.rtl` file or an RTL string literal inside a Python or Java
  file.
- **Input fixture** — a CSV table against which the pattern is matched.
- **Expected CSV** — a CSV containing the recordset the match is expected to
  produce. Binding one adds a red/green diff to the preview. For standalone
  `.rtl` patterns, it also makes the pattern × fixture pair appear in the Test
  Explorer.

## How an input fixture is chosen

When you run **RTL: Preview Match on Fixture**, candidates are collected from
the following sources in order; the first existing file wins:

1. **Remembered choice** — whatever you last picked via **RTL: Select
   Fixture…** for this pattern (stored per file, and per literal for embedded
   patterns, in workspace state).
2. **`// fixture:` directives** in the pattern source.
3. **The `rtl.fixtures.input` setting** — the first rule whose glob matches
   the pattern file.

**RTL: Select Fixture…** shows the full candidate list (plus *Browse…*) and
remembers your pick. Files that do not exist on disk are silently skipped, so
a stale directive simply falls through to the next source.

## `// fixture:` and `// expected:` directives

Each directive is a line comment within the first 20 lines of a `.rtl` file
(or anywhere inside an embedded literal):

```rtl
// fixture: quarterly.csv
// expected: quarterly-expected.csv
{ [ [VAL : ''->AVP, ST&C2*->REC] [ATTR] [VAL : SR->AVP] ]
  [ [] [ATTR] [VAL : SR->AVP] ]{3} }+
```

- Relative paths resolve against the **pattern file's directory** (for embedded
  literals, the host file's directory).
- `${workspaceFolder}` is substituted, avoiding `../../..` chains in deeply
  nested host files:
  `// fixture: ${workspaceFolder}/fixtures/task_036/input_1.csv`.
- Directives may repeat. Expected and fixture directives are paired by
  position: the first `// expected:` with the first `// fixture:`, the second
  with the second, and so on. A single `// expected:` applies to every fixture.
- Directives take precedence over the settings templates below, and their
  comparison options come from the global settings
  (`rtl.fixtures.expectedHasHeader` and `rtl.fixtures.orderedRows`; per-rule
  overrides do not apply to directives).

Because directives are stored with the pattern, they are ideal for
self-contained examples and embedded literals. For entire catalogs of patterns,
templates scale better.

## Settings templates: `rtl.fixtures.input` and `rtl.fixtures.expected`

Both settings accept either a single template string (applied to every
pattern) or an array of rules; `rtl.fixtures.expected` rules may also
override the comparison options:

```jsonc
"rtl.fixtures.input": [
  {
    "pattern": "**/solutions/regtab/*.rtl",          // glob for pattern file paths
    "input": "${workspaceFolder}/fixtures/${basename}/input_*.csv"
  }
],
"rtl.fixtures.expected": [
  {
    "pattern": "**/solutions/regtab/*.rtl",
    "expected": "${workspaceFolder}/fixtures/${basename}/expected_*.csv",
    "hasHeader": true,                                 // optional overrides
    "orderedRows": false
  }
]
```

- `pattern` is a glob matched against the pattern file's workspace-relative
  path; **the first matching rule wins** — order rules from specific to
  general.
- Template variables: `${basename}` (pattern file name without extension),
  `${dir}` (its directory), and `${workspaceFolder}`.
- Relative paths produced by a template resolve against the pattern file's
  directory.
- A `*` in the **last** path segment expands as a glob (results are sorted
  alphabetically). Wildcards in directory segments are not supported.

### Name transforms

When the pattern file's name does not literally appear in the fixture
layout — typical for host-language test files — apply a snippet-style regular
expression transform to `${basename}`:

```jsonc
{
  "pattern": "**/src/test/java/**/RtlTask*Test.java",
  "input": "${workspaceFolder}/fixtures/${basename/RtlTask(.+)Test/task_$1/}/input_*.csv"
}
```

`${basename/regex/replacement/flags}` works like the equivalent construct in
VS Code snippets: here `RtlTask001Test` becomes `task_001`. An invalid regular
expression leaves the variable unexpanded, making the failure visible in the
resulting (non-existent) path.

## Pairing inputs with expected CSVs

When a template expansion yields several files:

- **One expected file** — it applies to every input.
- **Several expected files** — the sorted input list pairs with the sorted
  expected list **positionally**: `input_1.csv` ↔ `expected_1.csv`,
  `input_2.csv` ↔ `expected_2.csv`, and so on. Use parallel naming schemes to
  preserve the intended pairings.

An input without a paired expected CSV can still be previewed, but no diff is
shown.

## Comparison semantics

The extracted recordset is compared with the expected CSV as follows:

- **Extracted and expected rows are compared as unordered multisets** by
  default: row order is ignored, but duplicate counts are significant. Set
  `orderedRows` (globally via `rtl.fixtures.orderedRows` or per rule) to make
  order significant. The diff then reports "rows match as a set but their order
  differs" when that is the only discrepancy.
- **Header**: when `hasHeader` is enabled (globally via
  `rtl.fixtures.expectedHasHeader` or per rule), the first CSV row contains
  column names checked positionally against the recordset schema; only the
  remaining rows are data. A mismatch is reported separately from the row diff.
- The diff lists **Missing** rows (present in the expected CSV but absent from
  the extracted recordset) and **Extra** rows (present in the extracted
  recordset but absent from the expected CSV).

## Test Explorer

Every standalone `.rtl` pattern × fixture pair **that has an expected CSV**
appears in VS Code's Testing view, grouped by pattern file. Note the following:

- Discovery runs when the Testing view is first opened and reruns when `.rtl`
  files or `rtl.fixtures.*` settings change (use the refresh button to force
  discovery).
- Directives and settings templates both contribute pairs: directives first,
  then templates (a directive pair for the same input wins).
- The remembered **Select Fixture…** choice is deliberately *not* a test
  source — tests remain reproducible from the repository content alone.
- A failing test's message contains the same diff of missing and extra rows as
  the preview; a compilation error or an unreadable CSV marks the test as
  errored rather than failed.
- Patterns embedded in host-language literals can be previewed but are not
  discovered as tests.

## Example layouts

**Sidecar** — fixture next to the pattern, with the same name:

```
patterns/
  monthly.rtl        // fixture: monthly.csv  (or a template, see below)
  monthly.csv
```

```jsonc
"rtl.fixtures.input": "${dir}/${basename}.csv"
```

**Catalog** — patterns and fixtures in parallel trees (the layout of
[data-wrangling-eval](https://github.com/regtab/data-wrangling-eval)):

```
solutions/regtab/task_036.rtl
fixtures/task_036/input_1.csv … input_5.csv
fixtures/task_036/expected_1.csv … expected_5.csv
```

```jsonc
"rtl.fixtures.input": [{
  "pattern": "**/solutions/regtab/*.rtl",
  "input": "${workspaceFolder}/fixtures/${basename}/input_*.csv"
}],
"rtl.fixtures.expected": [{
  "pattern": "**/solutions/regtab/*.rtl",
  "expected": "${workspaceFolder}/fixtures/${basename}/expected_*.csv",
  "hasHeader": true
}]
```

This yields five runnable tests per pattern in the Test Explorer and a
red/green diff for the selected input.
