import * as fs from "fs";
import * as path from "path";

/** Pure fixture-binding helpers (no `vscode` import — unit-testable and
 * shared between the preview and the Test Explorer). */

/** `// <kind>: path` directive values resolved against `dir`, in order.
 * `${workspaceFolder}` in a value is replaced with `workspaceFolder` (falling
 * back to `dir` outside a workspace) — useful for host files located far from
 * their fixtures, where a relative path would require a `../../..` chain. */
export function directivePaths(
  rtlText: string,
  dir: string,
  kind: "fixture" | "expected",
  workspaceFolder?: string
): string[] {
  const rx = new RegExp(String.raw`^\s*//\s*${kind}:\s*(.+?)\s*$`, "gm");
  return [...rtlText.matchAll(rx)].map((m) =>
    path.resolve(dir, m[1].replace(/\$\{workspaceFolder\}/g, workspaceFolder ?? dir))
  );
}

/** The expected CSV paired with `inputPath`: a single expected CSV applies to
 * every input; otherwise the sorted lists pair positionally (plan §5, phase 4
 * item 5 — mirrors the harness convention `input_k.csv` ↔ `expected_k.csv`). */
export function pairExpected(
  inputPath: string,
  inputs: string[],
  expecteds: string[]
): string | undefined {
  if (expecteds.length === 1) {
    return expecteds[0];
  }
  const i = inputs.indexOf(inputPath);
  return i >= 0 ? expecteds[i] : undefined;
}

/** Substitute `${basename}`, `${dir}`, and `${workspaceFolder}` and expand a
 * trailing `*` glob segment (wildcards in directory segments are not
 * supported). `${basename/regex/replacement/flags}` applies a snippet-style
 * transform for host files whose names do not directly match the fixture layout
 * (for example, `RtlTask001Test` → `task_001`). An invalid regular expression
 * leaves the variable untouched, so the failure is visible in the resulting
 * path. */
export function expandTemplate(
  template: string,
  patternPath: string,
  workspaceFolder: string | undefined
): string[] {
  const dir = path.dirname(patternPath);
  const basename = path.basename(patternPath, path.extname(patternPath));
  const substituted = template
    .replace(
      /\$\{basename\/((?:[^/\\]|\\.)+)\/((?:[^/\\]|\\.)*)\/([a-z]*)\}/g,
      (whole, pattern: string, replacement: string, flags: string) => {
        try {
          return basename.replace(
            new RegExp(pattern.replace(/\\\//g, "/"), flags),
            replacement.replace(/\\\//g, "/")
          );
        } catch {
          return whole;
        }
      }
    )
    .replace(/\$\{basename\}/g, basename)
    .replace(/\$\{dir\}/g, dir)
    .replace(/\$\{workspaceFolder\}/g, workspaceFolder ?? dir);
  const abs = path.isAbsolute(substituted)
    ? path.normalize(substituted)
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
