import * as assert from "assert";
import { CellRole, renderCell } from "../../client/src/previewRender";

function item(
  index: number,
  s: string,
  span: [number, number],
  role: CellRole["role"] = "value",
  tags: string[] = []
): CellRole {
  return { row: 0, col: 0, role, index, s, span, tags };
}

/** Rendered spans in document order, as (class, text) pairs. */
function spans(html: string): [string, string][] {
  return [...html.matchAll(/<span class="([^"]*)"[^>]*>(.*?)<\/span>/g)].map((m) => [
    m[1],
    m[2],
  ]);
}

/** The cell text a reader sees, reassembled from the rendered spans. */
function visibleText(html: string): string {
  return spans(html)
    .map(([, text]) => text)
    .join("")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

describe("renderCell", () => {
  it("renders an empty delimited token as a marker span", () => {
    // pyRegTab 0.5.0: "a,,b" split on "," derives three items, the middle
    // one an empty string with a zero-width span.
    const html = renderCell("a,,b", [
      item(0, "a", [0, 1]),
      item(1, "", [2, 2]),
      item(2, "b", [3, 4]),
    ]);
    const roleSpans = spans(html).filter(([cls]) => cls.startsWith("value"));
    assert.strictEqual(roleSpans.length, 3, "all three items must be rendered");
    assert.deepStrictEqual(roleSpans, [
      ["value", "a"],
      ["value empty", ""],
      ["value", "b"],
    ]);
  });

  it("keeps the cell text intact around an empty token marker", () => {
    const html = renderCell("a,,b", [
      item(0, "a", [0, 1]),
      item(1, "", [2, 2]),
      item(2, "b", [3, 4]),
    ]);
    // The marker carries no text of its own and must not duplicate the
    // delimiters it sits between.
    assert.strictEqual(visibleText(html), "a,,b");
  });

  it("renders a trailing empty token after the last delimiter", () => {
    const html = renderCell("a,", [item(0, "a", [0, 1]), item(1, "", [2, 2])]);
    assert.deepStrictEqual(spans(html), [
      ["value", "a"],
      ["filler", ","],
      ["value empty", ""],
    ]);
    assert.strictEqual(visibleText(html), "a,");
  });

  it("puts a token's leading whitespace inside the highlight, not the filler", () => {
    // 0.5.0 keeps surrounding whitespace: "a, b" yields "a" and " b".
    const html = renderCell("a, b", [item(0, "a", [0, 1]), item(1, " b", [2, 4])]);
    assert.deepStrictEqual(spans(html), [
      ["value", "a"],
      ["filler", ","],
      ["value", " b"],
    ]);
  });

  it("skips an item whose span is already covered by an earlier one", () => {
    // Genuine overlap: the second item ends inside the first.
    const html = renderCell("abcd", [item(0, "abc", [0, 3]), item(1, "b", [1, 2])]);
    assert.deepStrictEqual(spans(html), [
      ["value", "abc"],
      ["filler", "d"],
    ]);
    assert.strictEqual(visibleText(html), "abcd");
  });

  it("marks a cell with no items as unmatched", () => {
    assert.strictEqual(renderCell("x", []), '<td class="unmatched">x</td>');
    assert.strictEqual(renderCell("", []), '<td class="unmatched">&nbsp;</td>');
  });

  it("escapes cell text and tooltips", () => {
    const html = renderCell("<b>&", [item(0, "<b>&", [0, 4], "attribute", ["T<x>"])]);
    assert.ok(html.includes("&lt;b&gt;&amp;"), "cell text must be HTML-escaped");
    assert.ok(!/<b>/.test(html), "raw markup must not reach the webview");
    assert.ok(
      html.includes(
        `title="ATTRIBUTE[0] #&#x27;T&lt;x&gt;&#x27; → &quot;&lt;b&gt;&amp;&quot;"`
      ) ||
        html.includes(
          `title="ATTRIBUTE[0] #'T&lt;x&gt;' → &quot;&lt;b&gt;&amp;&quot;"`
        ),
      `tooltip must be attribute-safe: ${html}`
    );
  });

  it("keeps the empty marker's tooltip readable", () => {
    // The tip for an empty item is `VALUE[1] → ""`; unescaped quotes would
    // truncate the title attribute, leaving the marker unidentifiable.
    const html = renderCell("a,,b", [
      item(0, "a", [0, 1]),
      item(1, "", [2, 2]),
      item(2, "b", [3, 4]),
    ]);
    const marker = /<span class="value empty" title="([^"]*)"><\/span>/.exec(html);
    assert.ok(marker, `empty marker must carry a title: ${html}`);
    assert.strictEqual(marker![1], "VALUE[1] → &quot;&quot;");
  });
});
