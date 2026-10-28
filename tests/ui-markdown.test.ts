import { test } from "node:test";
import assert from "node:assert/strict";
import { Marked } from "marked";
// @ts-ignore -- browser ES module without type declarations
import { createMarkdown } from "../ui/js/markdown.js";

const md = createMarkdown(Marked);

test("code is escaped exactly once", () => {
  assert.match(md("use `a < b && c`"), /<code>a &lt; b &amp;&amp; c<\/code>/);
  assert.match(md("```html\n<div class=\"x\">hi</div>\n```"), /&lt;div class=&quot;x&quot;&gt;hi&lt;\/div&gt;/);
});

test("raw HTML is shown as text, never parsed", () => {
  const out = md("hello <img src=x onerror=alert(1)> <script>alert(2)</script>");
  assert.ok(!/<img|<script/i.test(out), out);
  assert.match(out, /&lt;script&gt;/);
});

test("only http(s) links survive; images are dropped", () => {
  const out = md("[ok](https://example.com) [bad](javascript:alert(1)) ![pic](https://x/y.png)");
  assert.match(out, /<a href="https:\/\/example.com" target="_blank" rel="noopener noreferrer">ok<\/a>/);
  assert.ok(!out.includes("javascript:"), out);
  assert.ok(out.includes("bad"), "link text kept");
  assert.ok(!/<img/i.test(out), out);
});

test("tables and emphasis still render", () => {
  const out = md("**bold**\n\n| a | b |\n|---|---|\n| 1 | 2 |");
  assert.match(out, /<strong>bold<\/strong>/);
  assert.match(out, /<table>/);
});

test("fenced code blocks get a copy button, inline code does not", () => {
  const out = md("run `npm start` then:\n\n```bash\nnpm run build && echo \"<ok>\"\n```");
  assert.equal((out.match(/data-copy/g) ?? []).length, 1, out);
  assert.match(out, /<pre><code class="language-bash">npm run build &amp;&amp; echo &quot;&lt;ok&gt;&quot;\n?<\/code><\/pre>/);
});

test("mermaid blocks become diagram placeholders with their escaped source kept for the renderer", () => {
  const out = md("```mermaid\nflowchart LR\n  A[\"<b>x</b>\"] --> B\n```");
  assert.match(out, /<div class="mermaid-block" data-mermaid>/);
  assert.match(out, /data-copy/);
  assert.match(out, /A\[&quot;&lt;b&gt;x&lt;\/b&gt;&quot;\] --&gt; B/);
  assert.ok(!/<b>x/.test(out), out);
});
