import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

/** A workspace rule: apply `input` to .rtl files matching `pattern`. */
interface FixtureRule {
  pattern: string;
  input: string;
}

export function memoKey(uri: vscode.Uri): string {
  return `rtl.fixture:${uri.toString()}`;
}

/** Fixture candidates for a pattern document, most specific source first:
 * remembered choice → `// fixture:` directives → `rtl.fixtures.input`. */
export function fixtureCandidates(
  doc: vscode.TextDocument,
  memo: vscode.Memento
): string[] {
  const out: string[] = [];
  const push = (p: string) => {
    if (p && fs.existsSync(p) && !out.includes(p)) {
      out.push(p);
    }
  };

  const remembered = memo.get<string>(memoKey(doc.uri));
  if (remembered) {
    push(remembered);
  }

  const dir = path.dirname(doc.uri.fsPath);
  const head = doc.getText(new vscode.Range(0, 0, Math.min(doc.lineCount, 20), 0));
  for (const m of head.matchAll(/^\s*\/\/\s*fixture:\s*(.+?)\s*$/gm)) {
    push(path.resolve(dir, m[1]));
  }

  for (const p of settingsCandidates(doc)) {
    push(p);
  }
  return out;
}

function settingsCandidates(doc: vscode.TextDocument): string[] {
  const raw = vscode.workspace
    .getConfiguration("rtl", doc.uri)
    .get<string | FixtureRule[]>("fixtures.input");
  if (!raw) {
    return [];
  }
  const rules: FixtureRule[] =
    typeof raw === "string" ? [{ pattern: "**/*.rtl", input: raw }] : raw;
  const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
  for (const rule of rules) {
    if (!rule?.input) {
      continue;
    }
    const selector: vscode.DocumentFilter = folder
      ? { pattern: new vscode.RelativePattern(folder, rule.pattern) }
      : { pattern: rule.pattern };
    if (vscode.languages.match(selector, doc) === 0) {
      continue;
    }
    // First matching rule wins (plan §5, phase 4 item 1).
    return expandTemplate(rule.input, doc, folder);
  }
  return [];
}

/** Substitute ${basename}/${dir}/${workspaceFolder} and expand a trailing
 * `*` glob segment (magic in directory segments is not supported). */
function expandTemplate(
  template: string,
  doc: vscode.TextDocument,
  folder: vscode.WorkspaceFolder | undefined
): string[] {
  const dir = path.dirname(doc.uri.fsPath);
  const substituted = template
    .replace(/\$\{basename\}/g, path.basename(doc.uri.fsPath, ".rtl"))
    .replace(/\$\{dir\}/g, dir)
    .replace(/\$\{workspaceFolder\}/g, folder ? folder.uri.fsPath : dir);
  const abs = path.isAbsolute(substituted)
    ? substituted
    : path.resolve(dir, substituted);

  const base = path.basename(abs);
  if (!base.includes("*")) {
    return [abs];
  }
  const parent = path.dirname(abs);
  if (parent.includes("*") || !fs.existsSync(parent)) {
    return [];
  }
  const rx = new RegExp(
    "^" + base.split("*").map(escapeRegex).join(".*") + "$"
  );
  return fs
    .readdirSync(parent)
    .filter((f) => rx.test(f))
    .sort()
    .map((f) => path.join(parent, f));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
