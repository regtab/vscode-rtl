import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { directivePaths, expandTemplate, pairExpected } from "./fixturesCore";

export { directivePaths, expandTemplate, pairExpected } from "./fixturesCore";

/** A workspace rule: apply `input` to .rtl files matching `pattern`. */
export interface FixtureRule {
  pattern: string;
  input: string;
}

/** A workspace rule binding expected CSVs (plan §5, phase 4 item 5).
 * `hasHeader`/`orderedRows` override the global comparison settings. */
export interface ExpectedRule {
  pattern: string;
  expected: string;
  hasHeader?: boolean;
  orderedRows?: boolean;
}

/** An expected CSV to diff the recordset against, with comparison options. */
export interface ExpectedBinding {
  path: string;
  hasHeader: boolean;
  orderedRows: boolean;
}

export function memoKey(uri: vscode.Uri, litIndex?: number): string {
  const suffix = litIndex === undefined ? "" : `#lit${litIndex}`;
  return `rtl.fixture:${uri.toString()}${suffix}`;
}

/** Fixture candidates for a pattern, most specific source first: remembered
 * choice → `// fixture:` directives → `rtl.fixtures.input`. For a pattern
 * embedded in a host-language literal, pass the extracted RTL text and the
 * literal's ordinal — directives are read from the literal itself, and the
 * remembered choice is per-literal. */
export function fixtureCandidates(
  doc: vscode.TextDocument,
  memo: vscode.Memento,
  literal?: { text: string; index: number }
): string[] {
  const out: string[] = [];
  const push = (p: string) => {
    if (p && fs.existsSync(p) && !out.includes(p)) {
      out.push(p);
    }
  };

  const remembered = memo.get<string>(memoKey(doc.uri, literal?.index));
  if (remembered) {
    push(remembered);
  }

  const dir = path.dirname(doc.uri.fsPath);
  const folder = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath;
  for (const p of directivePaths(directiveText(doc, literal), dir, "fixture", folder)) {
    push(p);
  }

  for (const p of settingsInputs(doc)) {
    push(p);
  }
  return out;
}

/** The expected CSV paired with `inputPath`, or undefined (plan §5, phase 4
 * item 5). Sources, most specific first:
 * 1. `// expected:` directives — the i-th pairs with the i-th `// fixture:`
 *    directive; a lone one applies to any input.
 * 2. `rtl.fixtures.expected` — template/rules symmetric to
 *    `rtl.fixtures.input`; a multi-file expansion pairs with the input
 *    expansion positionally (both are sorted), a single file applies to
 *    every input. */
export function expectedFor(
  doc: vscode.TextDocument,
  inputPath: string,
  literal?: { text: string; index: number }
): ExpectedBinding | undefined {
  const dir = path.dirname(doc.uri.fsPath);
  const folder = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath;
  const text = directiveText(doc, literal);
  const expDirectives = directivePaths(text, dir, "expected", folder);
  if (expDirectives.length > 0) {
    const fixDirectives = directivePaths(text, dir, "fixture", folder);
    const i = fixDirectives.indexOf(inputPath);
    const p =
      expDirectives.length === 1
        ? expDirectives[0]
        : i >= 0
          ? expDirectives[i]
          : undefined;
    if (p && fs.existsSync(p)) {
      return { path: p, ...expectedOptions(doc.uri) };
    }
  }

  const rule = firstMatch(expectedRules(doc.uri), doc);
  if (!rule) {
    return undefined;
  }
  const expecteds = expandTemplate(rule.expected, doc.uri.fsPath, folder);
  const inputRule = firstMatch(inputRules(doc.uri), doc);
  const inputs = inputRule
    ? expandTemplate(inputRule.input, doc.uri.fsPath, folder)
    : [];
  const p = pairExpected(inputPath, inputs, expecteds);
  return p && fs.existsSync(p)
    ? { path: p, ...expectedOptions(doc.uri, rule) }
    : undefined;
}

/** Comparison options: rule-level override wins over the global settings. */
export function expectedOptions(
  uri: vscode.Uri,
  rule?: ExpectedRule
): { hasHeader: boolean; orderedRows: boolean } {
  const cfg = vscode.workspace.getConfiguration("rtl", uri);
  return {
    hasHeader: rule?.hasHeader ?? cfg.get<boolean>("fixtures.expectedHasHeader", false),
    orderedRows: rule?.orderedRows ?? cfg.get<boolean>("fixtures.orderedRows", false),
  };
}

/** The text scanned for `// fixture:` / `// expected:` directives: the whole
 * extracted literal, or the leading lines of a `.rtl` document. */
function directiveText(
  doc: vscode.TextDocument,
  literal?: { text: string; index: number }
): string {
  return (
    literal?.text ??
    doc.getText(new vscode.Range(0, 0, Math.min(doc.lineCount, 20), 0))
  );
}

/** Normalized `rtl.fixtures.input` rules for a resource. */
export function inputRules(uri: vscode.Uri): FixtureRule[] {
  const raw = vscode.workspace
    .getConfiguration("rtl", uri)
    .get<string | FixtureRule[]>("fixtures.input");
  if (!raw) {
    return [];
  }
  return typeof raw === "string" ? [{ pattern: "**/*", input: raw }] : raw.filter((r) => r?.input);
}

/** Normalized `rtl.fixtures.expected` rules for a resource. */
export function expectedRules(uri: vscode.Uri): ExpectedRule[] {
  const raw = vscode.workspace
    .getConfiguration("rtl", uri)
    .get<string | ExpectedRule[]>("fixtures.expected");
  if (!raw) {
    return [];
  }
  return typeof raw === "string"
    ? [{ pattern: "**/*", expected: raw }]
    : raw.filter((r) => r?.expected);
}

/** First rule whose glob matches the document (plan §5, phase 4 item 1). */
function firstMatch<R extends { pattern: string }>(
  rules: R[],
  doc: vscode.TextDocument
): R | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
  for (const rule of rules) {
    const selector: vscode.DocumentFilter = folder
      ? { pattern: new vscode.RelativePattern(folder, rule.pattern) }
      : { pattern: rule.pattern };
    if (vscode.languages.match(selector, doc) !== 0) {
      return rule;
    }
  }
  return undefined;
}

function settingsInputs(doc: vscode.TextDocument): string[] {
  const rule = firstMatch(inputRules(doc.uri), doc);
  if (!rule) {
    return [];
  }
  const folder = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath;
  return expandTemplate(rule.input, doc.uri.fsPath, folder);
}

