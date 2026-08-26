//! rtl-lsp: standalone language server for RTL (Regular Table Language).
//!
//! Phase 2 scope (plan §5): compile diagnostics via the pure-Rust pyregtab
//! core in permissive mode (`EXT('…')` never reported as unbound). Documents
//! are synced in full (RTL patterns are small); diagnostics are debounced.

mod analysis;
mod hover_data;
mod preview;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use analysis::{completion_ctx, fragment_occurrences, punct_at, tags, word_at, CompletionCtx};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tower_lsp::jsonrpc::Result;
use tower_lsp::lsp_types::*;
use tower_lsp::{Client, LanguageServer, LspService, Server};

/// Version of the normative RTL grammar the bundled compiler implements.
/// Reported in the `initialize` response (plan §6).
const GRAMMAR_VERSION: &str = "RTL grammar jRegTab 0.5.0";
const DEBOUNCE: Duration = Duration::from_millis(150);

#[derive(Default)]
struct DocState {
    text: String,
    /// Bumped on every edit; a debounced task publishes only if still current.
    seq: u64,
}

struct Backend {
    client: Client,
    docs: Arc<Mutex<HashMap<Url, DocState>>>,
    seq: AtomicU64,
}

impl Backend {
    fn new(client: Client) -> Self {
        Backend {
            client,
            docs: Arc::new(Mutex::new(HashMap::new())),
            seq: AtomicU64::new(0),
        }
    }

    async fn doc_text(&self, uri: &Url) -> Option<String> {
        self.docs.lock().await.get(uri).map(|d| d.text.clone())
    }

    /// Store the new text and schedule a debounced diagnostics pass.
    async fn on_change(&self, uri: Url, text: String, version: Option<i32>) {
        let seq = self.seq.fetch_add(1, Ordering::Relaxed) + 1;
        {
            let mut docs = self.docs.lock().await;
            docs.insert(uri.clone(), DocState { text, seq });
        }
        let docs = Arc::clone(&self.docs);
        let client = self.client.clone();
        tokio::spawn(async move {
            tokio::time::sleep(DEBOUNCE).await;
            let diags = {
                let docs = docs.lock().await;
                match docs.get(&uri) {
                    // A newer edit owns the next publish.
                    Some(doc) if doc.seq != seq => return,
                    Some(doc) => diagnostics(&doc.text),
                    None => return, // closed meanwhile
                }
            };
            client.publish_diagnostics(uri, diags, version).await;
        });
    }
}

/// Compile in permissive mode; empty on success, one diagnostic otherwise.
fn diagnostics(text: &str) -> Vec<Diagnostic> {
    match pyregtab::rtl::compile_permissive(text) {
        Ok(_) => Vec::new(),
        Err(e) => vec![Diagnostic {
            range: error_range(text, e.line, e.col),
            severity: Some(DiagnosticSeverity::ERROR),
            source: Some("rtl".to_string()),
            message: e.msg,
            ..Diagnostic::default()
        }],
    }
}

/// Range for a compile error at (line 1-based, col 0-based); -1 = unknown.
/// The compiler reports a point; underline from it to the end of the current
/// word (or one character), clamped to the line (plan §3.2 p. 3).
fn error_range(text: &str, line: i64, col: i64) -> Range {
    if line < 1 || col < 0 {
        return Range::new(Position::new(0, 0), Position::new(0, 1));
    }
    let line0 = (line - 1) as u32;
    let col0 = col as u32;
    let end_col = match text.lines().nth(line0 as usize) {
        Some(l) => {
            let chars: Vec<char> = l.chars().collect();
            let start = col0 as usize;
            let mut end = start;
            while end < chars.len() && (chars[end].is_alphanumeric() || chars[end] == '_') {
                end += 1;
            }
            if end == start {
                // Not a word: cover one character (if any is left on the line).
                (start + 1).min(chars.len().max(start + 1))
            } else {
                end
            }
        }
        None => (col0 + 1) as usize,
    } as u32;
    Range::new(
        Position::new(line0, col0),
        Position::new(line0, end_col.max(col0 + 1)),
    )
}

#[tower_lsp::async_trait]
impl LanguageServer for Backend {
    async fn initialize(&self, _: InitializeParams) -> Result<InitializeResult> {
        Ok(InitializeResult {
            server_info: Some(ServerInfo {
                name: "rtl-lsp".to_string(),
                version: Some(format!(
                    "{} ({})",
                    env!("CARGO_PKG_VERSION"),
                    GRAMMAR_VERSION
                )),
            }),
            capabilities: ServerCapabilities {
                text_document_sync: Some(TextDocumentSyncCapability::Kind(
                    TextDocumentSyncKind::FULL,
                )),
                hover_provider: Some(HoverProviderCapability::Simple(true)),
                completion_provider: Some(CompletionOptions {
                    trigger_characters: Some(
                        [">", "$", "#", "=", "<"].iter().map(|s| s.to_string()).collect(),
                    ),
                    ..CompletionOptions::default()
                }),
                definition_provider: Some(OneOf::Left(true)),
                references_provider: Some(OneOf::Left(true)),
                rename_provider: Some(OneOf::Right(RenameOptions {
                    prepare_provider: Some(true),
                    work_done_progress_options: WorkDoneProgressOptions::default(),
                })),
                document_symbol_provider: Some(OneOf::Left(true)),
                ..ServerCapabilities::default()
            },
        })
    }

    async fn initialized(&self, _: InitializedParams) {
        self.client
            .log_message(MessageType::INFO, format!("rtl-lsp ready ({GRAMMAR_VERSION})"))
            .await;
    }

    async fn shutdown(&self) -> Result<()> {
        Ok(())
    }

    async fn did_open(&self, params: DidOpenTextDocumentParams) {
        let doc = params.text_document;
        self.on_change(doc.uri, doc.text, Some(doc.version)).await;
    }

    async fn did_change(&self, mut params: DidChangeTextDocumentParams) {
        // Full sync: the last change carries the whole document.
        if let Some(change) = params.content_changes.pop() {
            self.on_change(
                params.text_document.uri,
                change.text,
                Some(params.text_document.version),
            )
            .await;
        }
    }

    async fn did_close(&self, params: DidCloseTextDocumentParams) {
        let uri = params.text_document.uri;
        self.docs.lock().await.remove(&uri);
        self.client.publish_diagnostics(uri, Vec::new(), None).await;
    }

    async fn hover(&self, params: HoverParams) -> Result<Option<Hover>> {
        let pos = params.text_document_position_params;
        let Some(text) = self.doc_text(&pos.text_document.uri).await else {
            return Ok(None);
        };
        Ok(hover_at(&text, pos.position))
    }

    async fn completion(&self, params: CompletionParams) -> Result<Option<CompletionResponse>> {
        let pos = params.text_document_position;
        let Some(text) = self.doc_text(&pos.text_document.uri).await else {
            return Ok(None);
        };
        Ok(Some(CompletionResponse::Array(completions_at(
            &text,
            pos.position,
        ))))
    }

    async fn goto_definition(
        &self,
        params: GotoDefinitionParams,
    ) -> Result<Option<GotoDefinitionResponse>> {
        let pos = params.text_document_position_params;
        let Some(text) = self.doc_text(&pos.text_document.uri).await else {
            return Ok(None);
        };
        let Some(name) = fragment_at(&text, pos.position) else {
            return Ok(None);
        };
        let hit = fragment_occurrences(&text)
            .into_iter()
            .find(|o| o.is_def && o.name == name)
            .map(|o| {
                GotoDefinitionResponse::Scalar(Location::new(
                    pos.text_document.uri.clone(),
                    occ_range(&o),
                ))
            });
        Ok(hit)
    }

    async fn references(&self, params: ReferenceParams) -> Result<Option<Vec<Location>>> {
        let pos = params.text_document_position;
        let Some(text) = self.doc_text(&pos.text_document.uri).await else {
            return Ok(None);
        };
        let Some(name) = fragment_at(&text, pos.position) else {
            return Ok(None);
        };
        let include_decl = params.context.include_declaration;
        let locs = fragment_occurrences(&text)
            .into_iter()
            .filter(|o| o.name == name && (include_decl || !o.is_def))
            .map(|o| Location::new(pos.text_document.uri.clone(), occ_range(&o)))
            .collect();
        Ok(Some(locs))
    }

    async fn prepare_rename(
        &self,
        params: TextDocumentPositionParams,
    ) -> Result<Option<PrepareRenameResponse>> {
        let Some(text) = self.doc_text(&params.text_document.uri).await else {
            return Ok(None);
        };
        let pos = params.position;
        let Some(name) = fragment_at(&text, pos) else {
            return Ok(None);
        };
        let hit = fragment_occurrences(&text).into_iter().find(|o| {
            o.name == name
                && o.line == pos.line
                && o.start <= pos.character
                && pos.character <= o.end
        });
        Ok(hit.map(|o| PrepareRenameResponse::Range(occ_range(&o))))
    }

    async fn rename(&self, params: RenameParams) -> Result<Option<WorkspaceEdit>> {
        let pos = params.text_document_position;
        let Some(text) = self.doc_text(&pos.text_document.uri).await else {
            return Ok(None);
        };
        let Some(name) = fragment_at(&text, pos.position) else {
            return Ok(None);
        };
        let new = params.new_name.trim_start_matches('$');
        let valid = !new.is_empty()
            && new.chars().next().unwrap().is_ascii_alphabetic()
            && new.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
        if !valid {
            return Err(tower_lsp::jsonrpc::Error::invalid_params(
                "fragment name must match [A-Za-z][A-Za-z0-9_]*",
            ));
        }
        let edits: Vec<TextEdit> = fragment_occurrences(&text)
            .into_iter()
            .filter(|o| o.name == name)
            .map(|o| TextEdit::new(occ_range(&o), format!("${new}")))
            .collect();
        let mut changes = HashMap::new();
        changes.insert(pos.text_document.uri.clone(), edits);
        Ok(Some(WorkspaceEdit::new(changes)))
    }

    async fn document_symbol(
        &self,
        params: DocumentSymbolParams,
    ) -> Result<Option<DocumentSymbolResponse>> {
        let Some(text) = self.doc_text(&params.text_document.uri).await else {
            return Ok(None);
        };
        Ok(Some(DocumentSymbolResponse::Nested(document_symbols(
            &text,
        ))))
    }
}

/// The lower-cased fragment name under the cursor, if any.
fn fragment_at(text: &str, pos: Position) -> Option<String> {
    let line = text.lines().nth(pos.line as usize)?;
    let (word, _, _) = word_at(line, pos.character as usize)?;
    word.strip_prefix('$').map(|n| n.to_lowercase())
}

fn occ_range(o: &analysis::FragOcc) -> Range {
    Range::new(Position::new(o.line, o.start), Position::new(o.line, o.end))
}

fn hover_at(text: &str, pos: Position) -> Option<Hover> {
    let line = text.lines().nth(pos.line as usize)?;
    let col = pos.character as usize;

    if let Some((word, start, end)) = word_at(line, col) {
        let range = Range::new(Position::new(pos.line, start), Position::new(pos.line, end));
        if let Some(name) = word.strip_prefix('$') {
            let key = name.to_lowercase();
            let def = fragment_occurrences(text)
                .into_iter()
                .find(|o| o.is_def && o.name == key);
            let body = match def {
                Some(d) => {
                    let def_line = text.lines().nth(d.line as usize).unwrap_or("").trim();
                    format!(
                        "**Fragment `${name}`** — defined at line {}:\n\n```rtl\n{}\n```",
                        d.line + 1,
                        def_line
                    )
                }
                None => format!("**Fragment `${name}`** — no definition in this document."),
            };
            return Some(markdown_hover(body, range));
        }
        if let Some(doc) = lookup(&word.to_uppercase()) {
            return Some(markdown_hover(doc.to_string(), range));
        }
    }
    let (key, start, end) = punct_at(line, col)?;
    let doc = lookup(key)?;
    Some(markdown_hover(
        doc.to_string(),
        Range::new(Position::new(pos.line, start), Position::new(pos.line, end)),
    ))
}

fn lookup(key: &str) -> Option<&'static str> {
    hover_data::HOVER
        .iter()
        .find(|(k, _)| *k == key)
        .map(|(_, v)| *v)
}

fn markdown_hover(value: String, range: Range) -> Hover {
    Hover {
        contents: HoverContents::Markup(MarkupContent {
            kind: MarkupKind::Markdown,
            value,
        }),
        range: Some(range),
    }
}

fn completions_at(text: &str, pos: Position) -> Vec<CompletionItem> {
    let line = text.lines().nth(pos.line as usize).unwrap_or("");
    let prefix: String = line.chars().take(pos.character as usize).collect();
    let item = |label: &str, kind: CompletionItemKind, detail: &str| CompletionItem {
        label: label.to_string(),
        kind: Some(kind),
        detail: Some(detail.to_string()),
        documentation: lookup(label.trim_end_matches(['(', ')']).trim())
            .or_else(|| lookup(label))
            .map(|d| {
                Documentation::MarkupContent(MarkupContent {
                    kind: MarkupKind::Markdown,
                    value: d.to_string(),
                })
            }),
        ..CompletionItem::default()
    };
    match completion_ctx(&prefix) {
        CompletionCtx::Actions => ["REC", "AVP", "JOIN", "FILL", "PREFIX", "SUFFIX"]
            .iter()
            .map(|k| item(k, CompletionItemKind::FUNCTION, "interpretation action"))
            .collect(),
        CompletionCtx::Extractors => ["NORM", "TRIM", "UC", "LC", "SUBSTR", "REPL"]
            .iter()
            .map(|k| item(k, CompletionItemKind::FUNCTION, "string extractor"))
            .collect(),
        CompletionCtx::Settings => ["NORM", "ANCH", "SPLIT"]
            .iter()
            .map(|k| item(k, CompletionItemKind::PROPERTY, "setting"))
            .collect(),
        CompletionCtx::Fragments => {
            let mut names: Vec<String> = fragment_occurrences(text)
                .into_iter()
                .filter(|o| o.is_def)
                .map(|o| o.name)
                .collect();
            names.dedup();
            names
                .into_iter()
                .map(|n| CompletionItem {
                    label: n.to_uppercase(),
                    kind: Some(CompletionItemKind::VARIABLE),
                    detail: Some("fragment".to_string()),
                    ..CompletionItem::default()
                })
                .collect()
        }
        CompletionCtx::Tags => tags(text)
            .into_iter()
            .map(|t| CompletionItem {
                label: format!("'{t}'"),
                kind: Some(CompletionItemKind::CONSTANT),
                detail: Some("tag".to_string()),
                ..CompletionItem::default()
            })
            .collect(),
        CompletionCtx::General => {
            let mut out: Vec<CompletionItem> = Vec::new();
            for k in ["VAL", "ATTR", "AUX", "SKIP"] {
                out.push(item(k, CompletionItemKind::KEYWORD, "item derivation directive"));
            }
            for k in ["LT", "RT", "AV", "BW", "ROW", "COL", "SR", "SC", "ST", "NCL", "CL"] {
                out.push(item(k, CompletionItemKind::CONSTANT, "spatial constraint"));
            }
            for k in ["BLANK", "STR", "EXT"] {
                out.push(item(k, CompletionItemKind::CONSTANT, "content constraint"));
            }
            out
        }
    }
}

/// Fragments + top-level structure (subtables and rows), text-based.
fn document_symbols(text: &str) -> Vec<DocumentSymbol> {
    #[allow(deprecated)]
    let symbol = |name: String, kind: SymbolKind, range: Range, children: Vec<DocumentSymbol>| {
        DocumentSymbol {
            name,
            detail: None,
            kind,
            tags: None,
            deprecated: None,
            range,
            selection_range: range,
            children: if children.is_empty() { None } else { Some(children) },
        }
    };

    let mut out: Vec<DocumentSymbol> = Vec::new();
    for o in fragment_occurrences(text).into_iter().filter(|o| o.is_def) {
        out.push(symbol(
            format!("${}", o.name.to_uppercase()),
            SymbolKind::VARIABLE,
            occ_range(&o),
            Vec::new(),
        ));
    }

    // Top-level structure: depth-0 brackets outside fragment definitions.
    // `{` opens a subtable, `[` a row; rows inside an explicit subtable
    // become its children.
    let mut depth = 0i32;
    let mut subtable: Option<(Position, Vec<DocumentSymbol>)> = None;
    let mut open_pos = Position::new(0, 0);
    let mut counter = (0u32, 0u32); // (subtables, rows)
    let occs = fragment_occurrences(text);
    let mut def_lines: Vec<u32> = occs.iter().filter(|o| o.is_def).map(|o| o.line).collect();
    def_lines.dedup();
    for (lineno, line) in text.lines().enumerate() {
        if def_lines.contains(&(lineno as u32)) {
            continue; // fragment bodies are represented by their own symbol
        }
        let mut in_str: Option<char> = None;
        let chars: Vec<char> = line.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            let c = chars[i];
            if let Some(q) = in_str {
                if c == q {
                    in_str = None;
                }
                i += 1;
                continue;
            }
            match c {
                '/' if i + 1 < chars.len() && chars[i + 1] == '/' => break,
                '\'' | '"' => in_str = Some(c),
                '{' | '[' => {
                    if depth == 0 {
                        open_pos = Position::new(lineno as u32, i as u32);
                        if c == '{' && !(i + 1 < chars.len() && chars[i + 1].is_ascii_digit()) {
                            counter.0 += 1;
                            subtable = Some((open_pos, Vec::new()));
                        }
                    }
                    if depth == 1 && c == '[' {
                        if let Some((_, rows)) = subtable.as_mut() {
                            counter.1 += 1;
                            rows.push(symbol(
                                format!("row {}", counter.1),
                                SymbolKind::ARRAY,
                                Range::new(
                                    Position::new(lineno as u32, i as u32),
                                    Position::new(lineno as u32, i as u32 + 1),
                                ),
                                Vec::new(),
                            ));
                        }
                    }
                    if !(c == '{' && i + 1 < chars.len() && chars[i + 1].is_ascii_digit()) {
                        depth += 1;
                    } else {
                        // quantifier {n}: skip to its closing brace
                        while i + 1 < chars.len() && chars[i + 1] != '}' {
                            i += 1;
                        }
                        i += 1;
                    }
                }
                '}' | ']' => {
                    depth -= 1;
                    if depth == 0 {
                        let end = Position::new(lineno as u32, i as u32 + 1);
                        let range = Range::new(open_pos, end);
                        if c == '}' {
                            if let Some((_, rows)) = subtable.take() {
                                out.push(symbol(
                                    format!("subtable {}", counter.0),
                                    SymbolKind::STRUCT,
                                    range,
                                    rows,
                                ));
                            }
                        } else {
                            counter.1 += 1;
                            out.push(symbol(
                                format!("row {}", counter.1),
                                SymbolKind::ARRAY,
                                range,
                                Vec::new(),
                            ));
                        }
                    }
                }
                _ => {}
            }
            i += 1;
        }
    }
    out
}

/// Params of the custom request `rtl/check` (plan §5, phase 5 step 1):
/// compile a client-extracted pattern (a host-language string literal) and
/// return the diagnostics in the coordinates of the extracted text — the
/// client maps them back into the host document through its offset map.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CheckParams {
    text: String,
}

/// Params/result of the custom request `rtl/canonicalize` (plan §5, phase 3
/// item 5 as amended 2026-07-17): the canonical form of a pattern for a
/// read-only view — `compile_permissive` → `AtpToRtlSerializer`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalizeParams {
    pattern_uri: String,
    /// RTL source extracted by the client (host-language string literals);
    /// wins over reading the document at `pattern_uri`.
    #[serde(default)]
    pattern_text: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CanonicalizeResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// Canonical (normalized) form of the pattern: inherited actions are pushed
/// down to atoms, layout and comments are not preserved — same form as the
/// `.expected.rtl` files of the conformance corpus.
fn canonical_form(text: &str) -> std::result::Result<String, String> {
    let atp = pyregtab::rtl::compile_permissive(text).map_err(|e| {
        if e.line >= 0 {
            format!("RTL compile error at {}:{}: {}", e.line, e.col, e.msg)
        } else {
            format!("RTL compile error: {}", e.msg)
        }
    })?;
    pyregtab::rtl::serialize::serialize(&atp)
        .map_err(|e| format!("serialization error: {}", preview::err_text(&e)))
}

impl Backend {
    /// The pattern source a custom request acts on: the client-extracted
    /// text if given, else the synced or on-disk document at `pattern_uri`.
    async fn pattern_source(
        &self,
        pattern_uri: &str,
        pattern_text: Option<String>,
    ) -> Result<String> {
        if let Some(t) = pattern_text {
            return Ok(t);
        }
        let uri = Url::parse(pattern_uri)
            .map_err(|e| tower_lsp::jsonrpc::Error::invalid_params(e.to_string()))?;
        match self.doc_text(&uri).await {
            Some(t) => Ok(t),
            None => uri
                .to_file_path()
                .ok()
                .and_then(|p| std::fs::read_to_string(p).ok())
                .ok_or_else(|| {
                    tower_lsp::jsonrpc::Error::invalid_params("unknown pattern document")
                }),
        }
    }

    /// Custom request `rtl/matchFixture` (plan §5, phase 4).
    async fn match_fixture(
        &self,
        params: preview::MatchFixtureParams,
    ) -> Result<preview::MatchFixtureResult> {
        let text = self
            .pattern_source(&params.pattern_uri, params.pattern_text)
            .await?;
        Ok(preview::match_fixture(
            &text,
            &params.fixture_path,
            params.expected.as_ref(),
        ))
    }

    /// Custom request `rtl/check` (plan §5, phase 5 step 1).
    async fn check(&self, params: CheckParams) -> Result<Vec<Diagnostic>> {
        Ok(diagnostics(&params.text))
    }

    /// Custom request `rtl/canonicalize` (plan §5, phase 3 item 5).
    async fn canonicalize(&self, params: CanonicalizeParams) -> Result<CanonicalizeResult> {
        let text = self
            .pattern_source(&params.pattern_uri, params.pattern_text)
            .await?;
        Ok(match canonical_form(&text) {
            Ok(text) => CanonicalizeResult {
                text: Some(text),
                error: None,
            },
            Err(error) => CanonicalizeResult {
                text: None,
                error: Some(error),
            },
        })
    }
}

#[tokio::main]
async fn main() {
    let (service, socket) = LspService::build(Backend::new)
        .custom_method("rtl/matchFixture", Backend::match_fixture)
        .custom_method("rtl/canonicalize", Backend::canonicalize)
        .custom_method("rtl/check", Backend::check)
        .finish();
    Server::new(tokio::io::stdin(), tokio::io::stdout(), socket)
        .serve(service)
        .await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ok_pattern_has_no_diagnostics() {
        assert!(diagnostics("[ [VAL : ST*->REC] ]+").is_empty());
    }

    #[test]
    fn ext_is_permissive() {
        assert!(diagnostics("[ [EXT('custom') ? VAL] ]").is_empty());
    }

    #[test]
    fn error_carries_position_and_word_range() {
        let text = "[ [VAL : ->REC] ]";
        let d = diagnostics(text);
        assert_eq!(d.len(), 1);
        let r = d[0].range;
        assert_eq!((r.start.line, r.start.character), (0, 3));
        // "VAL" is the offending token: underline extends to its end.
        assert_eq!((r.end.line, r.end.character), (0, 6));
    }

    #[test]
    fn unknown_position_maps_to_document_start() {
        let r = error_range("x", -1, -1);
        assert_eq!((r.start.line, r.start.character, r.end.character), (0, 0, 1));
    }

    #[test]
    fn canonical_form_desugars_and_is_idempotent() {
        // Inherited action: `->REC` on the cell is pushed down to the atom.
        let canon = canonical_form("[ [VAL : ST*->REC] ]+").expect("canonical form");
        assert!(!canon.contains("//"), "no comments in canonical form: {canon}");
        let again = canonical_form(&canon).expect("canonical form recompiles");
        assert_eq!(canon, again, "canonicalization must be idempotent");
    }

    #[test]
    fn canonical_form_drops_comments_and_layout() {
        let canon = canonical_form("// fixture: t.csv\n[ [VAL] ]").expect("canonical form");
        assert!(!canon.contains("fixture"), "{canon}");
        assert!(!canon.contains('\n'), "single-line output: {canon}");
    }

    #[test]
    fn canonical_form_reports_compile_errors() {
        let err = canonical_form("[ [VAL : ->REC] ]").unwrap_err();
        assert!(err.contains("RTL compile error at 1:3"), "{err}");
    }

    #[test]
    fn hover_covers_keywords_fragments_and_punctuation() {
        let text = "$V=[VAL: 'X'->AVP]\n[ [$V]{4} [VAL : ST*->REC] ]+";
        // Keyword: VAL (line 0, col 4..7)
        let h = hover_at(text, Position::new(0, 5)).expect("VAL hover");
        let HoverContents::Markup(m) = h.contents else { panic!() };
        assert!(m.value.contains("Item derivation directive"), "{}", m.value);
        // Spatial: ST
        let h = hover_at(text, Position::new(1, 17)).expect("ST hover");
        let HoverContents::Markup(m) = h.contents else { panic!() };
        assert!(m.value.contains("Spatial constraint"), "{}", m.value);
        // Fragment reference: shows the definition line
        let h = hover_at(text, Position::new(1, 4)).expect("$V hover");
        let HoverContents::Markup(m) = h.contents else { panic!() };
        assert!(m.value.contains("defined at line 1"), "{}", m.value);
        // Arrow
        let h = hover_at(text, Position::new(0, 12)).expect("-> hover");
        let HoverContents::Markup(m) = h.contents else { panic!() };
        assert!(m.value.contains("Action arrow"), "{}", m.value);
    }

    #[test]
    fn every_grammar_keyword_has_hover() {
        for kw in [
            "NORM", "ANCH", "SPLIT", "SUBSTR", "REPL", "UC", "LC", "TRIM", "ATTR", "VAL",
            "AUX", "SKIP", "FILL", "PREFIX", "SUFFIX", "AVP", "REC", "JOIN", "LT", "RT",
            "AV", "BW", "ROW", "COL", "SR", "SC", "ST", "NCL", "CL", "BLANK", "STR", "EXT",
            "C", "R", "P",
        ] {
            assert!(lookup(kw).is_some(), "no hover for {kw}");
        }
    }

    #[test]
    fn completion_is_contextual() {
        let text = "$HEAD=[VAL #'H']\n[ [VAL : ST*->";
        let labels = |pos: Position| -> Vec<String> {
            completions_at(text, pos).into_iter().map(|c| c.label).collect()
        };
        // After the arrow: actions only — no providers.
        let after_arrow = labels(Position::new(1, 14));
        assert!(after_arrow.contains(&"REC".to_string()));
        assert!(!after_arrow.contains(&"ROW".to_string()));
        // General position: providers, no actions.
        let general = labels(Position::new(1, 3));
        assert!(general.contains(&"ROW".to_string()));
        assert!(!general.contains(&"REC".to_string()));
        // Fragment position.
        let frags = completions_at("$HEAD=[VAL]\n[ [$", Position::new(1, 4));
        assert_eq!(frags[0].label, "HEAD");
        // Tag position.
        let tags = completions_at("[ [VAL #'H'] [VAL #", Position::new(0, 19));
        assert_eq!(tags[0].label, "'H'");
    }

    #[test]
    fn symbols_show_fragments_subtables_rows() {
        let text = "$V=[VAL]\n[ [VAL] ]\n{ [ [VAL] ]\n  [ [VAL] ]+ }+";
        let syms = document_symbols(text);
        let names: Vec<&str> = syms.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["$V", "row 1", "subtable 1"]);
        let sub = &syms[2];
        let rows: Vec<&str> = sub
            .children
            .as_ref()
            .unwrap()
            .iter()
            .map(|s| s.name.as_str())
            .collect();
        assert_eq!(rows.len(), 2, "{rows:?}");
    }
}
