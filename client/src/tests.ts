import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import {
  directivePaths,
  expandTemplate,
  ExpectedBinding,
  expectedOptions,
  expectedRules,
  inputRules,
  pairExpected,
} from "./fixtures";

/** One runnable pair: a `.rtl` pattern × an input CSV with an expected CSV
 * (plan §5, phase 4 item 6 — Test Explorer over the standalone scenario;
 * patterns embedded in host-language literals are out of scope here). */
interface TestCase {
  pattern: vscode.Uri;
  input: string;
  expected: ExpectedBinding;
}

interface MatchOutcome {
  matched: boolean;
  error?: string;
  expected?: {
    pass: boolean;
    missing: string[][];
    extra: string[][];
    headerMismatch?: string;
    error?: string;
  };
}

const EXCLUDE = "**/node_modules/**";

export function registerTests(
  context: vscode.ExtensionContext,
  ensureServer: () => Promise<LanguageClient | undefined>
): void {
  const ctrl = vscode.tests.createTestController("rtl", "RTL Patterns");
  const cases = new Map<string, TestCase>();
  context.subscriptions.push(ctrl);

  const discover = async () => {
    cases.clear();
    ctrl.items.replace([]);
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      for (const [uri, pairs] of await folderPairs(folder)) {
        const fileItem = ctrl.createTestItem(
          uri.toString(),
          vscode.workspace.asRelativePath(uri, false),
          uri
        );
        for (const tc of pairs) {
          const id = `${uri.toString()}::${tc.input}`;
          const item = ctrl.createTestItem(id, path.basename(tc.input), uri);
          item.description = `vs ${path.basename(tc.expected.path)}`;
          cases.set(id, tc);
          fileItem.children.add(item);
        }
        ctrl.items.add(fileItem);
      }
    }
  };

  // Discovery is lazy (first opening of the Testing view) and re-runs on
  // demand, on .rtl file events and on fixture-settings changes.
  ctrl.resolveHandler = async (item) => {
    if (!item) {
      await discover();
    }
  };
  ctrl.refreshHandler = discover;
  let timer: NodeJS.Timeout | undefined;
  const rediscover = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void discover(), 1000);
  };
  const watcher = vscode.workspace.createFileSystemWatcher("**/*.rtl");
  context.subscriptions.push(
    watcher,
    watcher.onDidCreate(rediscover),
    watcher.onDidChange(rediscover),
    watcher.onDidDelete(rediscover),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("rtl.fixtures")) {
        rediscover();
      }
    })
  );

  ctrl.createRunProfile(
    "Run",
    vscode.TestRunProfileKind.Run,
    async (request, token) => {
      const client = await ensureServer();
      if (!client) {
        void vscode.window.showWarningMessage(
          "RTL tests need the rtl-lsp server (not available on this platform; set rtl.server.path)."
        );
        return;
      }
      const run = ctrl.createTestRun(request);
      const leaves: vscode.TestItem[] = [];
      const collect = (item: vscode.TestItem) => {
        if (request.exclude?.includes(item)) {
          return;
        }
        if (cases.has(item.id)) {
          leaves.push(item);
        }
        item.children.forEach(collect);
      };
      if (request.include) {
        request.include.forEach(collect);
      } else {
        ctrl.items.forEach(collect);
      }
      for (const leaf of leaves) {
        if (token.isCancellationRequested) {
          run.skipped(leaf);
          continue;
        }
        const tc = cases.get(leaf.id)!;
        run.started(leaf);
        const t0 = Date.now();
        try {
          const res = await client.sendRequest<MatchOutcome>("rtl/matchFixture", {
            patternUri: tc.pattern.toString(),
            fixturePath: tc.input,
            expected: tc.expected,
          });
          const ms = Date.now() - t0;
          if (res.error) {
            run.errored(leaf, new vscode.TestMessage(res.error), ms);
          } else if (res.expected?.error) {
            run.errored(leaf, new vscode.TestMessage(res.expected.error), ms);
          } else if (res.expected?.pass) {
            run.passed(leaf, ms);
          } else {
            run.failed(leaf, new vscode.TestMessage(failText(res)), ms);
          }
        } catch (e) {
          run.errored(leaf, new vscode.TestMessage(String(e)));
        }
      }
      run.end();
    },
    true
  );
}

function failText(res: MatchOutcome): string {
  const e = res.expected;
  if (!e) {
    return "no expected result to compare with";
  }
  const lines: string[] = [];
  if (!res.matched) {
    lines.push("Pattern did not match the table.");
  }
  if (e.headerMismatch) {
    lines.push(`Header mismatch: ${e.headerMismatch}`);
  }
  if (e.missing.length === 0 && e.extra.length === 0 && !e.headerMismatch) {
    lines.push("Rows match as a set but their order differs (orderedRows is on).");
  }
  const dump = (label: string, sign: string, rows: string[][]) => {
    if (rows.length === 0) {
      return;
    }
    lines.push(`${label} (${rows.length}):`);
    for (const row of rows.slice(0, 10)) {
      lines.push(`  ${sign} ${row.join(" | ")}`);
    }
    if (rows.length > 10) {
      lines.push(`  …and ${rows.length - 10} more`);
    }
  };
  dump("Missing — in expected, not extracted", "−", e.missing);
  dump("Extra — extracted, not in expected", "+", e.extra);
  return lines.join("\n");
}

/** All testable pairs of a workspace folder, keyed by pattern file. A file is
 * testable when an input CSV has a paired expected CSV — via directives or
 * via the `rtl.fixtures.input`/`rtl.fixtures.expected` settings (first
 * matching rule wins, mirroring the preview's resolution; the remembered
 * per-file preview choice is deliberately not a test source). */
async function folderPairs(
  folder: vscode.WorkspaceFolder
): Promise<Map<vscode.Uri, TestCase[]>> {
  // First-match-wins per settings rule, computed with the same glob engine
  // as the preview (VS Code's), but without opening documents.
  const inputRuleOf = await claimByRule(
    folder,
    inputRules(folder.uri).map((r) => r.pattern)
  );
  const expectedRuleOf = await claimByRule(
    folder,
    expectedRules(folder.uri).map((r) => r.pattern)
  );

  const out = new Map<vscode.Uri, TestCase[]>();
  const files = await vscode.workspace.findFiles(
    new vscode.RelativePattern(folder, "**/*.rtl"),
    EXCLUDE
  );
  for (const uri of files.sort((a, b) => a.fsPath.localeCompare(b.fsPath))) {
    const dir = path.dirname(uri.fsPath);
    const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
    const pairs = new Map<string, TestCase>(); // input path → case

    // Directives: the i-th `// expected:` pairs with the i-th `// fixture:`.
    const fixDirectives = directivePaths(text, dir, "fixture", folder.uri.fsPath);
    const expDirectives = directivePaths(text, dir, "expected", folder.uri.fsPath);
    fixDirectives.forEach((input, i) => {
      const expected =
        expDirectives.length === 1 ? expDirectives[0] : expDirectives[i];
      if (expected && fs.existsSync(input) && fs.existsSync(expected)) {
        pairs.set(input, {
          pattern: uri,
          input,
          expected: { path: expected, ...expectedOptions(uri) },
        });
      }
    });

    // Settings templates (positional pairing, as in the preview).
    const inRuleIdx = inputRuleOf.get(uri.fsPath);
    const expRuleIdx = expectedRuleOf.get(uri.fsPath);
    if (inRuleIdx !== undefined && expRuleIdx !== undefined) {
      const inRule = inputRules(folder.uri)[inRuleIdx];
      const expRule = expectedRules(folder.uri)[expRuleIdx];
      const inputs = expandTemplate(inRule.input, uri.fsPath, folder.uri.fsPath);
      const expecteds = expandTemplate(expRule.expected, uri.fsPath, folder.uri.fsPath);
      for (const input of inputs) {
        const expected = pairExpected(input, inputs, expecteds);
        if (
          expected &&
          !pairs.has(input) &&
          fs.existsSync(input) &&
          fs.existsSync(expected)
        ) {
          pairs.set(input, {
            pattern: uri,
            input,
            expected: { path: expected, ...expectedOptions(uri, expRule) },
          });
        }
      }
    }

    if (pairs.size > 0) {
      out.set(uri, [...pairs.values()]);
    }
  }
  return out;
}

/** Which rule (by index) claims each file, first match wins — evaluated with
 * VS Code's own glob matching via findFiles. */
async function claimByRule(
  folder: vscode.WorkspaceFolder,
  patterns: string[]
): Promise<Map<string, number>> {
  const claimed = new Map<string, number>();
  for (let i = 0; i < patterns.length; i++) {
    const files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, patterns[i]),
      EXCLUDE
    );
    for (const f of files) {
      if (f.fsPath.endsWith(".rtl") && !claimed.has(f.fsPath)) {
        claimed.set(f.fsPath, i);
      }
    }
  }
  return claimed;
}

