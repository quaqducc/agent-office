// Safe Markdown for model output: raw HTML shown as text, only http(s) links, no images.
import { esc } from "./util.js";

/** @param {typeof import("marked").Marked} Marked the Marked class (browser: /vendor/marked.js, tests: "marked") */
export function createMarkdown(Marked) {
  const m = new Marked({
    gfm: true,
    breaks: false,
    renderer: {
      html: ({ text }) => esc(text),
      image: () => "",
      // Copy button reads the <pre> text at click time (handler in app.js), so nothing is duplicated into attributes
      code({ text, lang, escaped }) {
        const src = escaped ? text : esc(text);
        // Diagrams: diagrams.js turns the (escaped, inert) source into an SVG once the block is on the page
        if (lang?.trim().toLowerCase() === "mermaid") {
          return `<div class="mermaid-block" data-mermaid><button type="button" class="copy-btn" data-copy title="Sao chép mã sơ đồ" aria-label="Sao chép mã sơ đồ">📋</button>`
            + `<pre><code class="language-mermaid">${src}\n</code></pre></div>\n`;
        }
        const cls = lang ? ` class="language-${esc(lang.split(/\s/)[0])}"` : "";
        return `<div class="code-block"><button type="button" class="copy-btn" data-copy title="Sao chép" aria-label="Sao chép">📋</button>`
          + `<pre><code${cls}>${src}\n</code></pre></div>\n`;
      },
      link({ href, tokens }) {
        const text = this.parser.parseInline(tokens);
        return /^https?:\/\//i.test(href ?? "")
          ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`
          : text;
      },
    },
  });
  return text => m.parse(String(text ?? ""), { async: false });
}
