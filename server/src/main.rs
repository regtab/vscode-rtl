//! rtl-lsp: standalone language server for RTL (Regular Table Language).
//!
//! Phase 2 scope (plan §5): compile diagnostics via the pure-Rust pyregtab
//! core in permissive mode (`EXT('…')` never reported as unbound). Documents
//! are synced in full (RTL patterns are small); diagnostics are debounced.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Mutex;
use tower_lsp::jsonrpc::Result;
use tower_lsp::lsp_types::*;
use tower_lsp::{Client, LanguageServer, LspService, Server};

/// Version of the normative RTL grammar the bundled compiler implements.
/// Reported in the `initialize` response (plan §6).
const GRAMMAR_VERSION: &str = "RTL grammar jRegTab 0.4.1";
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
}

#[tokio::main]
async fn main() {
    let (service, socket) = LspService::new(Backend::new);
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
}
