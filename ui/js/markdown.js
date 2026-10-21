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
