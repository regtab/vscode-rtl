/** Extraction of RTL patterns from host-language string literals
 * (plan §5, phase 5 step 0; step 1 adds the offset maps). Pure string
 * functions — no vscode imports — so the logic is unit-testable outside the
 * extension host.
 *
 * Triggers mirror the embedded-language grammars: `RtlCompiler.compile(…)` in Python
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
  /** Offset map for diagnostics (plan §5, phase 5 step 1): `map[k]` is the
   * host-document offset of the source char that produced `text[k]`;
   * `map[text.length]` points just past the literal content. Extraction is
   * not 1:1 (unescaping, text-block indent stripping), so ranges reported
   * against `text` are translated through this map. */
  map: number[];
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
    const u = raw ? verbatim(rawText) : unescapeWithMap(rawText);
    out.push({
      text: u.text,
      start,
      end,
      form: "compile(…)",
      map: u.map.map((o) => start + o),
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
      const end = scanSingleLine(source, start, quote);
      if (end < 0) {
        continue;
      }
      const rawText = source.slice(start, end);
      // Text blocks: strip incidental indentation, then unescape; the maps
      // compose (extracted → stripped → raw).
      const s1 = quote === '"""' ? stripIndentWithMap(rawText) : verbatim(rawText);
      const s2 = unescapeWithMap(s1.text);
      out.push({
        text: s2.text,
        start,
        end,
        form,
        map: s2.map.map((o) => start + s1.map[o]),
      });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Java 15+ text block: content starts after the line terminator following
 * the opening `"""`; incidental indentation (the minimum over non-blank
 * lines and the closing-delimiter line) is removed. */
export function stripTextBlockIndent(content: string): string {
  return stripIndentWithMap(content).text;
}

export function stripIndentWithMap(content: string): { text: string; map: number[] } {
  let base = 0;
  const nl = content.indexOf("\n");
  if (nl >= 0 && content.slice(0, nl).trim() === "") {
    base = nl + 1;
  }
  const lines = content.slice(base).split("\n");
  const starts: number[] = [];
  let acc = 0;
  for (const l of lines) {
    starts.push(acc);
    acc += l.length + 1;
  }
  const closingIndent =
    lines[lines.length - 1].trim() === ""
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
  const kept = lines.map((l) => l.slice(indent).replace(/\s+$/, ""));
  if (kept[kept.length - 1] === "") {
    kept.pop();
  }
  let text = "";
  const map: number[] = [];
  kept.forEach((line, i) => {
    if (i > 0) {
      text += "\n";
      map.push(base + starts[i] - 1); // the newline ending the previous line
    }
    for (let j = 0; j < line.length; j++) {
      map.push(base + starts[i] + indent + j);
    }
    text += line;
  });
  map.push(content.length);
  return { text, map };
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

/** Identity transform: text kept verbatim, offsets map one-to-one. */
function verbatim(s: string): { text: string; map: number[] } {
  const map: number[] = [];
  for (let i = 0; i <= s.length; i++) {
    map.push(i);
  }
  return { text: s, map };
}

/** Minimal unescape shared by Python non-raw strings and Java literals:
 * the sequences that plausibly occur in RTL patterns. Unknown escapes are
 * kept verbatim (Python's behavior for invalid sequences; good enough for
 * a preview — the compiler will complain if the pattern is broken). */
export function unescapeCommon(s: string): string {
  return unescapeWithMap(s).text;
}

export function unescapeWithMap(s: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c !== "\\" || i + 1 >= s.length) {
      text += c;
      map.push(i);
      i += 1;
      continue;
    }
    const n = s[i + 1];
    switch (n) {
      case "n":
        text += "\n";
        map.push(i);
        break;
      case "t":
        text += "\t";
        map.push(i);
        break;
      case "r":
        text += "\r";
        map.push(i);
        break;
      case "\\":
        text += "\\";
        map.push(i);
        break;
      case "'":
        text += "'";
        map.push(i);
        break;
      case '"':
        text += '"';
        map.push(i);
        break;
      case "\n":
        break; // line continuation
      default:
        text += c + n; // keep unknown escapes verbatim
        map.push(i);
        map.push(i + 1);
    }
    i += 2;
  }
  map.push(s.length);
  return { text, map };
}
