//! `rtl/matchFixture` — the live-preview custom request (plan §5, phase 4):
//! compile the pattern permissively, read a CSV fixture, run the matcher and
//! the interpreter, and report matched cell roles plus the extracted
//! recordset.

use pyregtab::interp::{interpret, InterpreterCfg};
use pyregtab::matcher::match_atp;
use pyregtab::rtl::compile_permissive;
use pyregtab::spec::ItemType;
use pyregtab::syntax::SyntaxCore;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchFixtureParams {
    pub pattern_uri: String,
    pub fixture_path: String,
    /// RTL source extracted by the client (e.g. from a host-language string
    /// literal, plan §5 phase 5 step 0). When present, it wins over reading
    /// the document at `pattern_uri`.
    #[serde(default)]
    pub pattern_text: Option<String>,
    /// Expected recordset to diff against (plan §5, phase 4 item 5).
    #[serde(default)]
    pub expected: Option<ExpectedSpec>,
}

/// What to compare the extracted recordset with, and how. The comparison
/// semantics mirror the data-wrangling-eval harness (`harness/compare.py`):
/// a row is an ordered tuple of cells (column order significant), rows are
/// compared as a multiset unless `ordered_rows`, cells compare exactly.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpectedSpec {
    /// Path of the expected CSV.
    pub path: String,
    /// First expected row holds column names: it is checked positionally
    /// against the recordset schema, the rest are data rows.
    #[serde(default)]
    pub has_header: bool,
    /// Row order is significant (bag comparison otherwise).
    #[serde(default)]
    pub ordered_rows: bool,
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MatchFixtureResult {
    /// The fixture grid as parsed (for rendering).
    pub table: Vec<Vec<String>>,
    /// Roles of matched cells; cells not listed are unmatched.
    pub cells: Vec<CellRole>,
    pub schema: Vec<String>,
    pub records: Vec<Vec<Option<String>>>,
    pub matched: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Diff against the expected recordset, when an `ExpectedSpec` was given
    /// and the pattern compiled (plan §5, phase 4 item 5).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected: Option<ExpectedCheck>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpectedCheck {
    pub path: String,
    pub pass: bool,
    /// Rows present in the expected CSV but absent from the recordset
    /// (multiset difference, in expected-file order).
    pub missing: Vec<Vec<String>>,
    /// Recordset rows absent from the expected CSV.
    pub extra: Vec<Vec<String>>,
    /// Set when `has_header` and the header row differs from the schema.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header_mismatch: Option<String>,
    /// Set when the expected CSV could not be read; other fields are empty.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// One cell-derived item (plan §5.4 p. 2, refined 2026-07-12): a single cell
/// may hold several items with different roles (compound/delimited content).
#[derive(Debug, Serialize)]
pub struct CellRole {
    pub row: usize,
    pub col: usize,
    /// "value" | "attribute" | "auxiliary"
    pub role: &'static str,
    /// Ordinal of the item within its cell.
    pub index: usize,
    /// The extracted string (after extractors — may differ from the segment).
    pub s: String,
    /// Range of the item's source segment within the raw cell text,
    /// in Unicode scalar values (code points), end-exclusive.
    pub span: (usize, usize),
    pub tags: Vec<String>,
}

pub fn read_csv(path: &str) -> Result<Vec<Vec<String>>, String> {
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_path(path)
        .map_err(|e| format!("cannot read fixture {path}: {e}"))?;
    let mut grid: Vec<Vec<String>> = Vec::new();
    for rec in rdr.records() {
        let rec = rec.map_err(|e| format!("CSV error in {path}: {e}"))?;
        grid.push(rec.iter().map(|s| s.to_string()).collect());
    }
    if grid.is_empty() {
        return Err(format!("fixture {path} is empty"));
    }
    let cols = grid.iter().map(|r| r.len()).max().unwrap_or(0);
    for row in &mut grid {
        row.resize(cols, String::new());
    }
    Ok(grid)
}

pub fn match_fixture(
    pattern: &str,
    fixture_path: &str,
    expected: Option<&ExpectedSpec>,
) -> MatchFixtureResult {
    let grid = match read_csv(fixture_path) {
        Ok(g) => g,
        Err(e) => {
            return MatchFixtureResult {
                error: Some(e),
                ..MatchFixtureResult::default()
            }
        }
    };
    match run(pattern, &grid) {
        Ok(mut res) => {
            res.table = grid;
            // An unmatched pattern still gets a diff: everything is missing.
            res.expected = expected.map(|s| check_expected(s, &res.schema, &res.records));
            res
        }
        Err(e) => MatchFixtureResult {
            table: grid,
            error: Some(e),
            ..MatchFixtureResult::default()
        },
    }
}

/// Compare the extracted recordset against the expected CSV (semantics of
/// `harness/compare.py` in data-wrangling-eval; see `ExpectedSpec`).
pub fn check_expected(
    spec: &ExpectedSpec,
    schema: &[String],
    records: &[Vec<Option<String>>],
) -> ExpectedCheck {
    let mut check = ExpectedCheck {
        path: spec.path.clone(),
        pass: false,
        missing: Vec::new(),
        extra: Vec::new(),
        header_mismatch: None,
        error: None,
    };
    let grid = match read_csv(&spec.path) {
        Ok(g) => g,
        Err(e) => {
            check.error = Some(e);
            return check;
        }
    };
    let produced: Vec<Vec<String>> = records
        .iter()
        .map(|r| r.iter().map(|v| v.clone().unwrap_or_default()).collect())
        .collect();
    let data: &[Vec<String>] = if spec.has_header {
        let header = &grid[0];
        if header.as_slice() != schema {
            check.header_mismatch = Some(format!(
                "expected columns [{}], recordset schema [{}]",
                header.join(", "),
                schema.join(", ")
            ));
        }
        &grid[1..]
    } else {
        &grid
    };
    let (missing, extra) = bag_diff(&produced, data);
    let rows_equal = if spec.ordered_rows {
        produced == data
    } else {
        missing.is_empty() && extra.is_empty()
    };
    check.pass = rows_equal && check.header_mismatch.is_none();
    check.missing = missing;
    check.extra = extra;
    check
}

/// Multiset difference of rows: (expected − actual, actual − expected),
/// each in its source order.
fn bag_diff(
    actual: &[Vec<String>],
    expected: &[Vec<String>],
) -> (Vec<Vec<String>>, Vec<Vec<String>>) {
    let mut count: std::collections::HashMap<&[String], i64> = std::collections::HashMap::new();
    for r in actual {
        *count.entry(r.as_slice()).or_default() += 1;
    }
    let mut missing = Vec::new();
    for r in expected {
        let c = count.entry(r.as_slice()).or_default();
        *c -= 1;
        if *c < 0 {
            missing.push(r.clone());
        }
    }
    let mut extra = Vec::new();
    for r in actual {
        let c = count.get_mut(r.as_slice()).unwrap();
        if *c > 0 {
            extra.push(r.clone());
            *c -= 1;
        }
    }
    (missing, extra)
}

fn run(pattern: &str, grid: &[Vec<String>]) -> Result<MatchFixtureResult, String> {
    let atp = compile_permissive(pattern).map_err(|e| {
        if e.line >= 0 {
            format!("RTL compile error at {}:{}: {}", e.line, e.col, e.msg)
        } else {
            format!("RTL compile error: {}", e.msg)
        }
    })?;

    let mut syntax = SyntaxCore::new(grid.len(), grid[0].len())
        .map_err(|_| "empty table".to_string())?;
    for (r, row) in grid.iter().enumerate() {
        for (c, text) in row.iter().enumerate() {
            syntax.cell_mut(r, c).set_text(text.clone());
        }
    }

    let sem = match_atp(&atp, &mut syntax, Vec::new())
        .map_err(|e| err_text(&e))?;
    let Some(sem) = sem else {
        return Ok(MatchFixtureResult::default()); // matched: false
    };

    let cells = sem
        .cell_items
        .iter()
        .map(|it| CellRole {
            row: it.row,
            col: it.col,
            role: match it.ty {
                ItemType::Value => "value",
                ItemType::Attribute => "attribute",
                ItemType::Auxiliary => "auxiliary",
            },
            index: it.index,
            s: it.s.clone(),
            span: byte_span_to_chars(&grid[it.row][it.col], it.span),
            tags: it.tags.clone(),
        })
        .collect();

    let cfg = InterpreterCfg {
        transformations: atp.transformations.clone(),
        ..InterpreterCfg::default()
    };
    let rs = interpret(&cfg, &syntax, &sem, None).map_err(|e| err_text(&e))?;

    Ok(MatchFixtureResult {
        table: Vec::new(), // filled by the caller
        cells,
        schema: rs.schema.attributes,
        records: rs.records.into_iter().map(|r| r.values).collect(),
        matched: true,
        error: None,
        expected: None, // filled by the caller
    })
}

pub fn err_text(e: &pyregtab::util::CoreErr) -> String {
    match e {
        pyregtab::util::CoreErr::Msg(m) => m.clone(),
    }
}

/// Convert a byte span within `text` to Unicode-scalar (code point) indices
/// so the webview can slice the string safely.
fn byte_span_to_chars(text: &str, span: (usize, usize)) -> (usize, usize) {
    let mut from = 0;
    let mut to = 0;
    for (chars, (b, _)) in text.char_indices().enumerate() {
        if b < span.0 {
            from = chars + 1;
        }
        if b < span.1 {
            to = chars + 1;
        }
    }
    (from, to)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn expected_csv(name: &str, content: &str) -> String {
        let path = std::env::temp_dir().join(format!("rtl_lsp_test_{name}.csv"));
        std::fs::write(&path, content).unwrap();
        path.to_string_lossy().to_string()
    }

    fn spec(path: String, has_header: bool, ordered_rows: bool) -> ExpectedSpec {
        ExpectedSpec {
            path,
            has_header,
            ordered_rows,
        }
    }

    fn rec(vals: &[&str]) -> Vec<Option<String>> {
        vals.iter().map(|v| Some(v.to_string())).collect()
    }

    #[test]
    fn expected_bag_comparison_ignores_row_order() {
        let path = expected_csv("bag", "b,2\na,1\n");
        let schema = vec!["X".to_string(), "Y".to_string()];
        let records = vec![rec(&["a", "1"]), rec(&["b", "2"])];
        let check = check_expected(&spec(path, false, false), &schema, &records);
        assert!(check.pass, "{check:?}");
        assert!(check.missing.is_empty() && check.extra.is_empty());
    }

    #[test]
    fn expected_diff_counts_duplicates() {
        // expected has "a,1" twice; recordset has it once plus a stray row.
        let path = expected_csv("dups", "a,1\na,1\n");
        let schema = vec!["X".to_string(), "Y".to_string()];
        let records = vec![rec(&["a", "1"]), rec(&["z", "9"])];
        let check = check_expected(&spec(path, false, false), &schema, &records);
        assert!(!check.pass);
        assert_eq!(check.missing, vec![vec!["a".to_string(), "1".to_string()]]);
        assert_eq!(check.extra, vec![vec!["z".to_string(), "9".to_string()]]);
    }

    #[test]
    fn expected_header_is_checked_positionally_against_schema() {
        let path = expected_csv("header", "X,Y\na,1\n");
        let records = vec![rec(&["a", "1"])];
        let ok = check_expected(
            &spec(path.clone(), true, false),
            &["X".to_string(), "Y".to_string()],
            &records,
        );
        assert!(ok.pass, "{ok:?}");
        let bad = check_expected(
            &spec(path, true, false),
            &["Y".to_string(), "X".to_string()],
            &records,
        );
        assert!(!bad.pass);
        assert!(bad.header_mismatch.is_some());
        assert!(bad.missing.is_empty(), "data rows still match: {bad:?}");
    }

    #[test]
    fn ordered_rows_fails_on_reordering_with_empty_diff() {
        let path = expected_csv("ordered", "a,1\nb,2\n");
        let schema = vec!["X".to_string(), "Y".to_string()];
        let records = vec![rec(&["b", "2"]), rec(&["a", "1"])];
        let check = check_expected(&spec(path, false, true), &schema, &records);
        assert!(!check.pass);
        assert!(check.missing.is_empty() && check.extra.is_empty());
    }

    #[test]
    fn missing_values_compare_as_empty_cells() {
        let path = expected_csv("nulls", "a,\n");
        let check = check_expected(
            &spec(path, false, false),
            &["X".to_string(), "Y".to_string()],
            &[vec![Some("a".to_string()), None]],
        );
        assert!(check.pass, "{check:?}");
    }

    #[test]
    fn unreadable_expected_reports_an_error() {
        let check = check_expected(
            &spec("no/such/file.csv".to_string(), false, false),
            &[],
            &[],
        );
        assert!(!check.pass);
        assert!(check.error.is_some());
    }

    #[test]
    fn end_to_end_match_on_grid() {
        let grid = vec![
            vec!["City".into(), "Year".into()],
            vec!["IKT".into(), "2020".into()],
            vec!["SVO".into(), "2021".into()],
        ];
        let res = run(
            "[ [ATTR]{2} ]\n[ [VAL : SC->AVP, SR*->REC] [VAL : SC->AVP] ]+",
            &grid,
        )
        .unwrap();
        assert!(res.matched);
        assert_eq!(res.schema, vec!["City", "Year"]);
        assert_eq!(res.records.len(), 2);
        assert_eq!(res.records[0], vec![Some("IKT".into()), Some("2020".into())]);
        // Header cells are attributes, data cells are values.
        assert!(res.cells.iter().any(|c| c.role == "attribute" && c.row == 0));
        assert!(res.cells.iter().any(|c| c.role == "value" && c.row > 0));
    }

    #[test]
    fn compound_cell_yields_per_item_spans() {
        let grid = vec![vec!["0 Jan".into()]];
        let res = run("[ [VAL: 'ND'->AVP ' ' VAL: 'MON'->AVP] ]", &grid).unwrap();
        assert!(res.matched);
        let mut items: Vec<(&str, (usize, usize), usize)> = res
            .cells
            .iter()
            .map(|c| (c.s.as_str(), c.span, c.index))
            .collect();
        items.sort_by_key(|i| i.2);
        assert_eq!(items, vec![("0", (0, 1), 0), ("Jan", (2, 5), 1)]);
    }

    #[test]
    fn spans_are_code_point_indices() {
        // Cyrillic text: byte offsets differ from char offsets.
        let grid = vec![vec!["юг Янв".into()]];
        let res = run("[ [VAL ' ' VAL] ]", &grid).unwrap();
        assert!(res.matched);
        let spans: Vec<(usize, usize)> = res.cells.iter().map(|c| c.span).collect();
        assert!(spans.contains(&(0, 2)), "{spans:?}"); // "юг"
        assert!(spans.contains(&(3, 6)), "{spans:?}"); // "Янв"
    }

    #[test]
    fn no_match_is_not_an_error() {
        let grid = vec![vec!["x".into(), "y".into()]];
        let res = run("[ [BLANK] ]", &grid).unwrap();
        assert!(!res.matched);
        assert!(res.error.is_none());
    }
}
