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
}

#[derive(Debug, Serialize)]
pub struct CellRole {
    pub row: usize,
    pub col: usize,
    /// "value" | "attribute" | "auxiliary"
    pub role: &'static str,
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

pub fn match_fixture(pattern: &str, fixture_path: &str) -> MatchFixtureResult {
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
            res
        }
        Err(e) => MatchFixtureResult {
            table: grid,
            error: Some(e),
            ..MatchFixtureResult::default()
        },
    }
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
    })
}

fn err_text(e: &pyregtab::util::CoreErr) -> String {
    match e {
        pyregtab::util::CoreErr::Msg(m) => m.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn no_match_is_not_an_error() {
        let grid = vec![vec!["x".into(), "y".into()]];
        let res = run("[ [BLANK] ]", &grid).unwrap();
        assert!(!res.matched);
        assert!(res.error.is_none());
    }
}
