/* PrismJS 1.29.0 - Lightweight ES Module build for JS, TS, HTML, CSS, JSON, Markdown, Python, Bash
 * https://prismjs.com/
 * License: MIT - Copyright (c) 2012 Lea Verou
 */

const Prism = {
  languages: {},
  plugins: {},
  highlight(text, grammar, language) {
    if (!grammar) return escapeHtml(text);
    const tokens = tokenize(text, grammar);
    return stringify(tokens, language);
  },
  highlightElement(element) {
    const language = (element.className.match(/\blanguage-(\w+)\b/) || [, ""])[1];
    const grammar = Prism.languages[language];
    if (!grammar) return;
    element.innerHTML = Prism.highlight(element.textContent || "", grammar, language);
  }
};

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function Token(type, content, alias) {
  this.type = type;
  this.content = content;
  this.alias = alias;
}

function tokenize(text, grammar) {
  let strarr = [text];
  const rest = grammar.rest;
  if (rest) {
    for (let token in rest) grammar[token] = rest[token];
    delete grammar.rest;
  }

  for (let token in grammar) {
    if (!grammar.hasOwnProperty(token) || !grammar[token]) continue;
    let patterns = grammar[token];
    patterns = Array.isArray(patterns) ? patterns : [patterns];

    for (let j = 0; j < patterns.length; ++j) {
      let pattern = patterns[j];
      let inside = pattern.inside;
      let lookbehind = !!pattern.lookbehind;
      let regex = pattern.pattern || pattern;

      for (let i = 0; i < strarr.length; i++) {
        let str = strarr[i];
        if (str instanceof Token) continue;

        regex.lastIndex = 0;
        let match = regex.exec(str);
        if (match) {
          let from = match.index;
          let matchStr = match[0];
          if (lookbehind && match[1]) {
            from += match[1].length;
            matchStr = matchStr.slice(match[1].length);
          }
          let to = from + matchStr.length;
          let before = str.slice(0, from);
          let after = str.slice(to);

          let wrapped = new Token(token, inside ? tokenize(matchStr, inside) : matchStr, pattern.alias);
          let args = [i, 1];
          if (before) args.push(before);
          args.push(wrapped);
          if (after) args.push(after);

          strarr.splice(...args);
          i += args.length - 2;
        }
      }
    }
  }
  return strarr;
}

function stringify(o, language) {
  if (typeof o === "string") return escapeHtml(o);
  if (Array.isArray(o)) return o.map(element => stringify(element, language)).join("");

  const classes = ["token", o.type];
  if (o.alias) classes.push(o.alias);
  return `<span class="${classes.join(" ")}">${stringify(o.content, language)}</span>`;
}

// Grammars
Prism.languages.clike = {
  comment: [
    { pattern: /(^|[^\\])\/\*[\s\S]*?(?:\*\/|$)/, lookbehind: true },
    { pattern: /(^|[^\\:])\/\/.*/, lookbehind: true, greedy: true }
  ],
  string: { pattern: /(["'])(?:\\(?:\r\n|[\s\S])|(?!\1)[^\\\r\n])*\1/, greedy: true },
  "class-name": { pattern: /(\b(?:class|interface|extends|implements|instanceof|new)\s+|\b)[A-Z]\w*/ },
  keyword: /\b(?:if|else|while|do|for|return|in|instanceof|function|new|try|throw|catch|finally|null|break|continue|var|let|const)\b/,
  boolean: /\b(?:true|false)\b/,
  function: /\b\w+(?=\()/,
  number: /\b0x[\da-f]+\b|(?:\b\d+(?:\.\d*)?|\B\.\d+)(?:e[+-]?\d+)?/i,
  operator: /[<>]=?|[!=]=?=?|--?|\+\+?|&&?|\|\|?|[?*/~^%]/,
  punctuation: /[{}[\];(),.:]/
};

Prism.languages.javascript = Object.assign({}, Prism.languages.clike, {
  keyword: /\b(?:as|async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|from|function|get|if|import|in|instanceof|let|new|of|return|set|static|super|switch|this|throw|try|typeof|var|void|while|with|yield)\b/,
  string: [
    { pattern: /`(?:\\[\s\S]|\${(?:[^{}]|{(?:[^{}]|{[^}]*})*})+}|(?!\${)[^\\`])*`/, greedy: true },
    { pattern: /(["'])(?:\\(?:\r\n|[\s\S])|(?!\1)[^\\\r\n])*\1/, greedy: true }
  ]
});

Prism.languages.js = Prism.languages.javascript;
Prism.languages.typescript = Object.assign({}, Prism.languages.javascript, {
  keyword: /\b(?:abstract|as|async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|instanceof|interface|is|keyof|let|module|namespace|new|of|package|private|protected|public|readonly|return|set|static|super|switch|this|throw|try|type|typeof|var|void|while|with|yield)\b/
});
Prism.languages.ts = Prism.languages.typescript;

Prism.languages.json = {
  property: { pattern: /(^|[^\\])"(?:\\.|[^\\"\r\n])*"(?=\s*:)/, lookbehind: true, greedy: true },
  string: { pattern: /(^|[^\\])"(?:\\.|[^\\"\r\n])*"(?!\s*:)/, lookbehind: true, greedy: true },
  comment: { pattern: /\/\/.*|\/\*[\s\S]*?(?:\*\/|$)/, greedy: true },
  number: /-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/i,
  punctuation: /[{}[\],]/,
  operator: /:/,
  boolean: /\b(?:true|false)\b/,
  null: /\bnull\b/
};

Prism.languages.css = {
  comment: /\/\*[\s\S]*?\*\//,
  atrule: { pattern: /@[\w-]+[\s\S]*?(?:;|(?=\s*\{))/, inside: { rule: /@[\w-]+/ } },
  url: { pattern: /url\(.*?\)/i, greedy: true },
  selector: /[^{}\s][^{};]*?(?=\s*\{)/,
  string: { pattern: /("|')(?:\\(?:\r\n|[\s\S])|(?!\1)[^\\\r\n])*\1/, greedy: true },
  property: /[-_a-z\xA0-\uFFFF][-\w\xA0-\uFFFF]*(?=\s*:)/i,
  important: /!important\b/i,
  function: /[-_a-z\xA0-\uFFFF][-\w\xA0-\uFFFF]*(?=\()/i,
  punctuation: /[(){};:,]/
};

Prism.languages.markup = {
  comment: /<!--[\s\S]*?-->/,
  prolog: /<\?[\s\S]+?\?>/,
  doctype: { pattern: /<!DOCTYPE[\s\S]+?>/i, greedy: true },
  cdata: /<!\[CDATA\[[\s\S]*?\]\]>/i,
  tag: {
    pattern: /<\/?(?!\d)[^\s>\/=$<%]+(?:\s(?:\s*[^\s>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s'">=]+(?=[\s\/>]))|(?=[\s\/>])))+)?\s*\/?>/,
    greedy: true,
    inside: {
      tag: { pattern: /^<\/?[^\s>\/]+/, inside: { punctuation: /^<\/?/, namespace: /^[^\s>\/]+:/ } },
      "attr-value": { pattern: /=\s*(?:"[^"]*"|'[^']*'|[^\s'">=]+)/, inside: { punctuation: [/^=/, /^['"]|['"]$/] } },
      punctuation: /\/?>/,
      "attr-name": { pattern: /[^\s>\/]+/ }
    }
  },
  entity: [
    { pattern: /&[\da-z]{1,8};/i },
    { pattern: /&#x?[\da-f]{1,8};/i }
  ]
};
Prism.languages.html = Prism.languages.markup;

Prism.languages.python = {
  comment: { pattern: /(^|[^\\])#.*/, lookbehind: true, greedy: true },
  "string-interpolation": { pattern: /(?:f|fr|rf)(?:("""|''')[\s\S]*?\1|("|')(?:\\.|(?!\2)[^\\\r\n])*\2)/i, greedy: true },
  "triple-quoted-string": { pattern: /(?:[rub]|rb|br)?("""|''')[\s\S]*?\1/i, greedy: true, alias: "string" },
  string: { pattern: /(?:[rub]|rb|br)?("|')(?:\\.|(?!\1)[^\\\r\n])*\1/i, greedy: true },
  function: { pattern: /((?:def|class)\s+)[a-zA-Z_]\w*(?=\s*\()/, lookbehind: true },
  keyword: /\b(?:and|as|assert|async|await|break|class|continue|def|del|elif|else|except|exec|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|print|raise|return|try|while|with|yield)\b/,
  boolean: /\b(?:True|False|None)\b/,
  number: /-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/i,
  operator: /[-+%=]=?|!=|:=|\*\*?=?|\/\/?=?|<[<=>]?|>[=>]?|[&|^~]/,
  punctuation: /[{}[\];(),.:]/
};
Prism.languages.py = Prism.languages.python;

Prism.languages.bash = {
  comment: { pattern: /(^|[\s#])#.*/, lookbehind: true },
  string: { pattern: /(["'])(?:\\(?:\r\n|[\s\S])|(?!\1)[^\\\r\n])*\1/, greedy: true },
  variable: /\$[\w#?*!@$]+|\${[^}]+}/,
  function: { pattern: /(^|[\s;])(?!\d)\w+(?=\s*\(\s*\)\s*\{)/, lookbehind: true },
  keyword: /\b(?:if|then|else|elif|fi|for|while|in|do|done|case|esac|function|return|select)\b/,
  boolean: /\b(?:true|false)\b/,
  operator: /&&?|\|\|?|==?|!=?|<<?|>>?|[;&]/,
  punctuation: /[{}[\](),.:]/
};
Prism.languages.sh = Prism.languages.bash;

Prism.languages.markdown = {
  blockquote: { pattern: /^>(?:[ \t]*>)*[ \t]?.+/m },
  code: [
    { pattern: /^(?: {4}|\t).+/m, alias: "keyword" },
    { pattern: /``.+?``|`[^`\r\n]+`/, alias: "keyword" }
  ],
  title: { pattern: /\S.*(?:\r?\n|\r)(?:==+|--+)|#+.+/m, alias: "important", inside: { punctuation: /^#+|[=-]+$/ } },
  hr: { pattern: /(^\s*)([*-])(?:[\t ]*\2){2,}(?=\s*$)/m, lookbehind: true, alias: "punctuation" },
  list: { pattern: /(^\s*)(?:[*+-]|\d+\.)(?=[\t ].)/m, lookbehind: true, alias: "punctuation" },
  bold: { pattern: /(^|[^\\])(\*\*|__)(?:(?:\r?\n|\r)(?!\r?\n|\r)|.)+?\2/, lookbehind: true, greedy: true },
  italic: { pattern: /(^|[^\\])([*_])(?:(?:\r?\n|\r)(?!\r?\n|\r)|.)+?\2/, lookbehind: true, greedy: true }
};
Prism.languages.md = Prism.languages.markdown;

export default Prism;
