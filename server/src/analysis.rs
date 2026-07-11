//! Text-level analysis shared by hover, completion and $fragment navigation.
//!
//! Fragment identifiers are case-insensitive (RTL tokens are), so names are
//! compared lower-cased. Scanning skips comments and string literals.

/// A `$name` occurrence: 0-based line, char columns [start, end) including `$`.
#[derive(Debug, PartialEq, Clone)]
pub struct FragOcc {
    pub name: String,
    pub line: u32,
    pub start: u32,
    pub end: u32,
    /// True when the occurrence is followed by `=` (a preamble definition).
    pub is_def: bool,
}

/// Per-character scan state that skips `// …` comments and string literals
/// (`'…'`, `"…"` with doubled-quote and backtick escapes, smart quotes).
fn code_chars(line: &str) -> Vec<(usize, char, bool)> {
    let chars: Vec<char> = line.chars().collect();
    let mut out = Vec::with_capacity(chars.len());
    let mut in_str: Option<char> = None;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        match in_str {
            Some(q) => {
                out.push((i, c, false));
                if c == '`' && i + 1 < chars.len() {
                    out.push((i + 1, chars[i + 1], false));
                    i += 2;
                    continue;
                }
                let closes = match q {
                    '\u{201C}' => c == '\u{201D}' || c == '\u{2033}',
                    _ => c == q,
                };
                if closes {
                    // A doubled quote is an escape, not a terminator.
                    if c == q && i + 1 < chars.len() && chars[i + 1] == q {
                        out.push((i + 1, chars[i + 1], false));
                        i += 2;
                        continue;
                    }
                    in_str = None;
                }
            }
            None => {
                if c == '/' && i + 1 < chars.len() && chars[i + 1] == '/' {
                    break; // comment to end of line
                }
                if c == '\'' || c == '"' || c == '\u{201C}' {
                    in_str = Some(c);
                    out.push((i, c, false));
                } else {
                    out.push((i, c, true));
                }
            }
        }
        i += 1;
    }
    out
}

fn is_word(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// Every `$name` in the document outside comments/strings.
pub fn fragment_occurrences(text: &str) -> Vec<FragOcc> {
    let mut out = Vec::new();
    for (lineno, line) in text.lines().enumerate() {
        let code = code_chars(line);
        let mut k = 0;
        while k < code.len() {
            let (i, c, in_code) = code[k];
            if c == '$' && in_code {
                let mut name = String::new();
                let mut k2 = k + 1;
                while k2 < code.len() && code[k2].2 && is_word(code[k2].1) {
                    name.push(code[k2].1);
                    k2 += 1;
                }
                if !name.is_empty() && name.chars().next().unwrap().is_ascii_alphabetic() {
                    // Definition: next code char (skipping spaces) is '='.
                    let mut k3 = k2;
                    while k3 < code.len() && code[k3].1.is_whitespace() {
                        k3 += 1;
                    }
                    let is_def = k3 < code.len() && code[k3].2 && code[k3].1 == '=';
                    let end = if k2 < code.len() { code[k2].0 } else { i + 1 + name.len() };
                    out.push(FragOcc {
                        name: name.to_lowercase(),
                        line: lineno as u32,
                        start: i as u32,
                        end: end as u32,
                        is_def,
                    });
                    k = k2;
                    continue;
                }
            }
            k += 1;
        }
    }
    out
}

/// All distinct tag strings (`#'name'` / `#"name"`) in the document.
pub fn tags(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for line in text.lines() {
        let chars: Vec<char> = line.chars().collect();
        let code = code_chars(line);
        for (k, &(i, c, in_code)) in code.iter().enumerate() {
            if c == '#' && in_code {
                // The tag string itself is "not code": read it from chars.
                let mut j = i + 1;
                while j < chars.len() && chars[j].is_whitespace() {
                    j += 1;
                }
                if j < chars.len() && (chars[j] == '\'' || chars[j] == '"') {
                    let q = chars[j];
                    let mut name = String::new();
                    let mut m = j + 1;
                    while m < chars.len() && chars[m] != q {
                        name.push(chars[m]);
                        m += 1;
                    }
                    if !name.is_empty() && !out.contains(&name) {
                        out.push(name);
                    }
                }
                let _ = k;
            }
        }
    }
    out
}

/// The word (alnum/_) covering `col` (0-based char index), or the `$name`
/// if the word is fragment-prefixed. Returns (text, start, end).
pub fn word_at(line: &str, col: usize) -> Option<(String, u32, u32)> {
    let chars: Vec<char> = line.chars().collect();
    if col >= chars.len() {
        return None;
    }
    let mut start = col;
    let mut end = col;
    if !is_word(chars[col]) && chars[col] != '$' {
        return None;
    }
    while start > 0 && is_word(chars[start - 1]) {
        start -= 1;
    }
    if start > 0 && chars[start - 1] == '$' {
        start -= 1;
    }
    while end < chars.len() && (is_word(chars[end]) || (end == start && chars[end] == '$')) {
        end += 1;
    }
    if start == end {
        return None;
    }
    Some((chars[start..end].iter().collect(), start as u32, end as u32))
}

/// Punctuation token at/starting before `col`: tries 2-char (`->`, `..`,
/// `-^`), then 1-char. Returns (dictionary key, start, end).
pub fn punct_at(line: &str, col: usize) -> Option<(&'static str, u32, u32)> {
    let chars: Vec<char> = line.chars().collect();
    let two = |a: usize| -> Option<(&'static str, u32, u32)> {
        if a + 1 < chars.len() {
            match (chars[a], chars[a + 1]) {
                ('-', '>') => Some(("->", a as u32, a as u32 + 2)),
                ('.', '.') => Some(("..", a as u32, a as u32 + 2)),
                ('-', '^') => Some(("^", a as u32, a as u32 + 2)),
                _ => None,
            }
        } else {
            None
        }
    };
    if let Some(hit) = two(col).or_else(|| if col > 0 { two(col - 1) } else { None }) {
        return Some(hit);
    }
    let c = *chars.get(col)?;
    let key = match c {
        '#' => "#",
        '@' => "@",
        '$' => "$",
        '?' => "?",
        '*' => "*",
        '+' => "+",
        '^' => "^",
        '{' | '}' => "{N}",
        _ => return None,
    };
    Some((key, col as u32, col as u32 + 1))
}

/// Completion context derived from the text before the cursor.
#[derive(Debug, PartialEq)]
pub enum CompletionCtx {
    /// After `->`: interpretation actions.
    Actions,
    /// After `=` following an item derivation directive: extractors.
    Extractors,
    /// After `$`: declared fragments.
    Fragments,
    /// After `#`: known tags.
    Tags,
    /// Inside an unclosed `<…>` settings block.
    Settings,
    /// Anywhere else: constraints, providers, item directives.
    General,
}

pub fn completion_ctx(prefix: &str) -> CompletionCtx {
    let trimmed = prefix.trim_end();
    if trimmed.ends_with("->") {
        return CompletionCtx::Actions;
    }
    // Immediately-typed triggers (no space between trigger and cursor).
    match prefix.chars().last() {
        Some('$') => return CompletionCtx::Fragments,
        Some('#') => return CompletionCtx::Tags,
        _ => {}
    }
    if let Some(rest) = trimmed.strip_suffix('=') {
        let before = rest.trim_end().to_uppercase();
        if before.ends_with("VAL") || before.ends_with("ATTR") || before.ends_with("AUX") {
            return CompletionCtx::Extractors;
        }
    }
    // Unclosed settings block on this line.
    if let Some(open) = trimmed.rfind('<') {
        if !trimmed[open..].contains('>') {
            return CompletionCtx::Settings;
        }
    }
    CompletionCtx::General
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fragments_found_with_defs_and_refs() {
        let text = "$V1=[VAL: -AV->PREFIX(', ')]\n[ [$V1]+ ] // $ignored\n[ ['$notme' ? $v1] ]";
        let occ = fragment_occurrences(text);
        assert_eq!(occ.len(), 3);
        assert!(occ[0].is_def && occ[0].line == 0 && occ[0].start == 0 && occ[0].end == 3);
        assert!(!occ[1].is_def && occ[1].line == 1);
        // Case-insensitive: $v1 == $V1; strings and comments are skipped.
        assert_eq!(occ[2].name, "v1");
        assert_eq!(occ[2].line, 2);
    }

    #[test]
    fn tags_are_collected() {
        let text = "[ [VAL #'HEAD']+ ]\n[ [COL&#'S' ? VAL] ]";
        assert_eq!(tags(text), vec!["HEAD".to_string(), "S".to_string()]);
    }

    #[test]
    fn word_and_punct_lookup() {
        let line = "[ [VAL : ST*->REC] ]";
        assert_eq!(word_at(line, 4), Some(("VAL".into(), 3, 6)));
        assert_eq!(word_at(line, 9), Some(("ST".into(), 9, 11)));
        assert_eq!(punct_at(line, 12), Some(("->", 12, 14)));
        assert_eq!(punct_at(line, 13), Some(("->", 12, 14)));
        assert_eq!(punct_at(line, 11), Some(("*", 11, 12)));
        let frag = "[$V1]";
        assert_eq!(word_at(frag, 2), Some(("$V1".into(), 1, 4)));
    }

    #[test]
    fn completion_contexts() {
        assert_eq!(completion_ctx("[ [VAL : ST*->"), CompletionCtx::Actions);
        assert_eq!(completion_ctx("[ [VAL="), CompletionCtx::Extractors);
        assert_eq!(completion_ctx("[ [$"), CompletionCtx::Fragments);
        assert_eq!(completion_ctx("[ [VAL #"), CompletionCtx::Tags);
        assert_eq!(completion_ctx("<NORM, "), CompletionCtx::Settings);
        assert_eq!(completion_ctx("<NORM> [ ["), CompletionCtx::General);
        assert_eq!(completion_ctx("$V="), CompletionCtx::General);
        assert_eq!(completion_ctx("[ [!BLANK ? "), CompletionCtx::General);
    }
}
