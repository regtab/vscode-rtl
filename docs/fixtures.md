# Binding fixtures and expected results

The live match preview, the expected-result diff, and the Test Explorer all
revolve around one question: *which CSV table(s) does this pattern run
against, and which CSV holds the expected recordset?* This page describes
every way to answer it and how the sources interact.

Terminology:

- **Pattern** — a `.rtl` file, or an RTL string literal inside a Python/Java
  file.
- **Input fixture** — a CSV table the pattern is matched against.
- **Expected CSV** — a CSV with the recordset the match is supposed to
  produce; binding one turns the preview into a red/green diff and makes the
  pattern × fixture pair appear in the Test Explorer.

## How an input fixture is chosen

When you run **RTL: Preview Match on Fixture**, candidates are collected in
this order, most specific source first; the first existing file wins:

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

A directive is a line comment anywhere in the first 20 lines of a `.rtl`
file (or anywhere inside an embedded literal):

```rtl
// fixture: quarterly.csv
// expected: quarterly-expected.csv
{ [ [VAL : ''->AVP, ST&C2*->REC] [ATTR] [VAL : SR->AVP] ]
  [ [] [ATTR] [VAL : SR->AVP] ]{3} }+
```

- Relative paths resolve against the **pattern file's directory** (for
  embedded literals — the host file's directory).
- `${workspaceFolder}` is substituted, which spares `../../..` chains in
  deeply nested host files:
  `// fixture: ${workspaceFolder}/fixtures/task_036/input_1.csv`.
- Directives may repeat. The *i*-th `// expected:` pairs with the *i*-th
  `// fixture:`; a single `// expected:` applies to every fixture.
- Directives take precedence over the settings templates below, and their
  comparison options come from the global settings
  (`rtl.fixtures.expectedHasHeader` / `rtl.fixtures.orderedRows` — per-rule
  overrides do not apply to directives).

Directives travel with the pattern — best for self-contained examples and
for embedded literals. For whole catalogs of patterns, templates scale
better.

## Settings templates: `rtl.fixtures.input` / `rtl.fixtures.expected`

Both settings accept either a single template string (applied to every
pattern) or an array of rules; `rtl.fixtures.expected` rules may also
override the comparison options:

```jsonc
"rtl.fixtures.input": [
  {
    "pattern": "**/solutions/regtab/*.rtl",          // glob over pattern files
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
  `${dir}` (its directory), `${workspaceFolder}`.
- A relative result resolves against the pattern file's directory.
- A `*` in the **last** path segment expands as a glob (results are sorted
  alphabetically). Wildcards in directory segments are not supported.

### Name transforms

When the pattern file's name does not literally appear in the fixture
layout — typical for host-language test files — apply a snippet-style regex
transform to `${basename}`:

```jsonc
{
  "pattern": "**/src/test/java/**/RtlTask*Test.java",
  "input": "${workspaceFolder}/fixtures/${basename/RtlTask(.+)Test/task_$1/}/input_*.csv"
}
```

`${basename/regex/replacement/flags}` works like the same construct in VS
Code snippets: here `RtlTask001Test` becomes `task_001`. An invalid regex
leaves the variable unexpanded so the failure is visible in the resulting
(non-existent) path.

## Pairing inputs with expected CSVs

When a template expansion yields several files:

- **One expected file** — it applies to every input.
- **Several expected files** — the sorted input list pairs with the sorted
  expected list **positionally**: `input_1.csv` ↔ `expected_1.csv`,
  `input_2.csv` ↔ `expected_2.csv`, … Keep the naming parallel and the
  pairing takes care of itself.

An input without a paired expected file still previews — just without the
diff section.

## Comparison semantics

The extracted recordset is compared with the expected CSV as follows:

- **Rows are an unordered multiset** by default: order does not matter,
  duplicates do. Set `orderedRows` (globally via
  `rtl.fixtures.orderedRows` or per rule) to make order significant — the
  diff then reports "rows match as a set but their order differs" when that
  is the only discrepancy.
- **Header**: with `hasHeader` (globally via
  `rtl.fixtures.expectedHasHeader` or per rule) the first CSV row holds
  column names checked positionally against the recordset schema; only the
  remaining rows are data. A mismatch is reported separately from the
  row diff.
- The diff lists **Missing** rows (in expected, not extracted) and
  **Extra** rows (extracted, not in expected).

## Test Explorer

Every pattern × input pair **that has an expected CSV** appears in VS Code's
Testing view, grouped by pattern file. Notes:

- Discovery runs when the Testing view is first opened and re-runs on `.rtl`
  file changes and on `rtl.fixtures.*` settings changes (use the refresh
  button to force it).
- Both sources contribute pairs: directives first, then the settings
  templates (a directive pair for the same input wins).
- The remembered **Select Fixture…** choice is deliberately *not* a test
  source — tests stay reproducible from the repository content alone.
- A failing test's message contains the same missing/extra row diff as the
  preview; a compile error or an unreadable CSV marks the test as errored
  rather than failed.
- Patterns embedded in host-language literals are previewable but are not
  discovered as tests.

## Worked layouts

**Sidecar** — fixture next to the pattern, same name:

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
red/green preview for whichever input you preview.
