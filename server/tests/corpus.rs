//! Diagnostics over the pyRegTab conformance corpus (plan §5, phase 2 item 4).
//!
//! The corpus is copied verbatim from `pyregtab/conformance/` (version pinned
//! in `tests/corpus/VERSION`); `.expected.rtl` canonical forms are omitted —
//! serializer parity is pyregtab's own test suite's job.

use pyregtab::rtl::compile_permissive;
use std::fs;
use std::path::PathBuf;

fn corpus(sub: &str) -> Vec<(String, String)> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/corpus")
        .join(sub);
    let mut out = Vec::new();
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().map(|e| e == "rtl").unwrap_or(false) {
            out.push((
                path.file_stem().unwrap().to_string_lossy().to_string(),
                fs::read_to_string(&path).unwrap(),
            ));
        }
    }
    out.sort();
    assert!(!out.is_empty());
    out
}

/// Every positive-corpus pattern compiles with zero diagnostics.
#[test]
fn positive_corpus_is_clean() {
    let cases = corpus("positive");
    assert!(cases.len() >= 150, "expected ≥150 cases, got {}", cases.len());
    for (name, text) in cases {
        if let Err(e) = compile_permissive(&text) {
            panic!("{name}: unexpected diagnostic at {}:{}: {}", e.line, e.col, e.msg);
        }
    }
}

/// Unbound-EXT cases are the reason permissive mode exists: they must
/// compile cleanly during standalone editing (plan §3.2 p. 2).
#[test]
fn unbound_ext_is_permitted() {
    for (name, text) in corpus("negative") {
        if name.starts_with("ext_unbound") {
            assert!(
                compile_permissive(&text).is_ok(),
                "{name}: unbound EXT must not be a diagnostic in permissive mode"
            );
        }
    }
}

/// Every other negative case produces a diagnostic at the expected position.
#[test]
fn negative_corpus_positions() {
    // (line 1-based, col 0-based); -1 = position unknown (whole document).
    let expected: &[(&str, i64, i64)] = &[
        ("conflict_anch_rec", -1, -1),
        ("conflict_rec_rec", -1, -1),
        ("ext_bad_position", 1, 3),
        ("ext_blank_name", 1, 3),
        ("lexer_bad_char", 1, 6),
        ("lexer_unclosed_string", 1, 9),
        ("parser_bare_quantifier", 1, 0),
        ("parser_empty", 2, 0),
        ("parser_parens_condcontspec", 1, 3),
        ("parser_question_without_contspec", 1, 10),
        ("parser_unclosed_bracket", 2, 0),
        ("semantic_unknown_fragment", -1, -1),
        ("settings_unknown", 1, 1),
    ];
    let cases = corpus("negative");
    for (name, line, col) in expected {
        let (_, text) = cases
            .iter()
            .find(|(n, _)| n == name)
            .unwrap_or_else(|| panic!("{name}: missing from corpus"));
        let err = compile_permissive(text)
            .err()
            .unwrap_or_else(|| panic!("{name}: expected a diagnostic"));
        assert_eq!(
            (err.line, err.col),
            (*line, *col),
            "{name}: wrong position ({})",
            err.msg
        );
    }
    // No negative case is silently missing from the expectations.
    let covered = expected.len() + 2; // + the two ext_unbound_* permissive cases
    assert_eq!(cases.len(), covered, "update the expectations table");
}

/// Helper (run with --nocapture) to print actual positions when re-pinning.
#[test]
#[ignore]
fn dump_negative_positions() {
    for (name, text) in corpus("negative") {
        match compile_permissive(&text) {
            Ok(_) => println!("{name}: OK"),
            Err(e) => println!("{name}: ({}, {}) {}", e.line, e.col, e.msg),
        }
    }
}
