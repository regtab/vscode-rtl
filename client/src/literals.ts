/** Extraction of RTL patterns from host-language string literals
 * (plan §5, phase 5 step 0). Pure string functions — no vscode imports —
 * so the logic is unit-testable outside the extension host.
 *
 * Triggers mirror the injection grammars: `RtlCompiler.compile(…)` in Python
 * and Java, `@RtlSource(…)` and the `language=RTL` block-comment marker in
 * Java. Inherited limitations: the opening quote must be on the trigger's
 * line; concatenation and f-strings are out of scope. */

export interface RtlLiteral {
  /** RTL source: unescaped, text blocks stripped of incidental indentation. */
  text: string;
  /** Offset range of the literal content in the host document (raw). */
  start: number;
  end: number;
  /** Short label for lenses/pickers, e.g. `compile(…)`. */
  form: string;
}

export function findRtlLiterals(source: string, languageId: string): RtlLiteral[] {
  switch (languageId) {
    case "python":
      return findPython(source);
    case "java":
      return findJava(source);
    default:
      return [];
  }
}

// ---------------------------------------------------------------- python

const PY_TRIGGER = /\bRtlCompiler\s*\.\s*compile\s*\(\s*([rRbBuU]{0,2})("""|'''|"|')/g;

function findPython(source: string): RtlLiteral[] {
  const out: RtlLiteral[] = [];
  for (const m of source.matchAll(PY_TRIGGER)) {
    const raw = m[1].toLowerCase().includes("r");
    const quote = m[2];
    const start = m.index + m[0].length;
    const end =
      quote.length === 3
        ? source.indexOf(quote, start)
        : scanSingleLine(source, start, quote);
    if (end < 0) {
      continue;
    }
    const rawText = source.slice(start, end);
    out.push({
      text: raw ? rawText : unescapeCommon(rawText),
      start,
      end,
      form: "compile(…)",
    });
  }
  return out;
}

// ---------------------------------------------------------------- java

const JAVA_TRIGGERS: [RegExp, string][] = [
  [/\bRtlCompiler\s*\.\s*compile\s*\(\s*(""")/g, "compile(…)"],
  [/\bRtlCompiler\s*\.\s*compile\s*\(\s*(")/g, "compile(…)"],
  [/@RtlSource\s*\(\s*(?:value\s*=\s*)?(""")/g, "@RtlSource(…)"],
  [/@RtlSource\s*\(\s*(?:value\s*=\s*)?(")/g, "@RtlSource(…)"],
  [/\/\*\s*language=RTL\s*\*\/\s*(""")/g, "language=RTL"],
  [/\/\*\s*language=RTL\s*\*\/\s*(")/g, "language=RTL"],
];

function findJava(source: string): RtlLiteral[] {
  const out: RtlLiteral[] = [];
  for (const [trigger, form] of JAVA_TRIGGERS) {
    for (const m of source.matchAll(trigger)) {
      const quote = m[1];
      const start = m.index + m[0].length;
      // A `"""` trigger also matches the `"` variant at the same spot;
      // keep only the first (longest-quote) hit per position.
      if (out.some((l) => start > l.start - 4 && start <= l.start)) {
        continue;
      }
      if (quote === '"""') {
        const end = scanSingleLine(source, start, '"""');
        if (end < 0) {
          continue;
        }
        out.push({
          text: unescapeCommon(stripTextBlockIndent(source.slice(start, end))),
          start,
          end,
          form,
        });
      } else {
        const end = scanSingleLine(source, start, '"');
        if (end < 0) {
          continue;
        }
        out.push({ text: unescapeCommon(source.slice(start, end)), start, end, form });
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Java 15+ text block: content starts after the line terminator following
 * the opening `"""`; incidental indentation (the minimum over non-blank
 * lines and the closing-delimiter line) is removed. */
export function stripTextBlockIndent(content: string): string {
  let body = content;
  const nl = body.indexOf("\n");
  if (nl >= 0 && body.slice(0, nl).trim() === "") {
    body = body.slice(nl + 1);
  }
  const lines = body.split("\n");
  const closingIndent = lines[lines.length - 1].trim() === ""
    ? lines[lines.length - 1].length
    : Number.MAX_SAFE_INTEGER;
  let indent = closingIndent;
  for (const line of lines) {
    if (line.trim() !== "") {
      indent = Math.min(indent, line.length - line.trimStart().length);
    }
  }
  if (!isFinite(indent) || indent === Number.MAX_SAFE_INTEGER) {
    indent = 0;
  }
  const stripped = lines.map((l) => l.slice(indent).replace(/\s+$/, ""));
  if (stripped[stripped.length - 1] === "") {
    stripped.pop();
  }
  return stripped.join("\n");
}

// ---------------------------------------------------------------- shared

/** End offset of a quote-delimited literal, honoring backslash escapes.
 * Works for single- and triple-character closers. */
function scanSingleLine(source: string, from: number, closer: string): number {
  let i = from;
  while (i < source.length) {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (source.startsWith(closer, i)) {
      return i;
    }
    i += 1;
  }
  return -1;
}

/** Minimal unescape shared by Python non-raw strings and Java literals:
 * the sequences that plausibly occur in RTL patterns. Unknown escapes are
 * kept verbatim (Python's behavior for invalid sequences; good enough for
 * a preview — the compiler will complain if the pattern is broken). */
export function unescapeCommon(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c !== "\\" || i + 1 >= s.length) {
      out += c;
      i += 1;
      continue;
    }
    const n = s[i + 1];
    switch (n) {
      case "n":
        out += "\n";
        break;
      case "t":
        out += "\t";
        break;
      case "r":
        out += "\r";
        break;
      case "\\":
        out += "\\";
        break;
      case "'":
        out += "'";
        break;
      case '"':
        out += '"';
        break;
      case "\n":
        break; // line continuation
      default:
        out += c + n; // keep unknown escapes verbatim
    }
    i += 2;
  }
  return out;
}
