import { test } from "node:test";
import assert from "node:assert/strict";
import { checkUrl, htmlToText, searchPageQuery, webFetch } from "../src/web.ts";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("htmlToText keeps readable text, drops scripts/styles, decodes entities", () => {
  const html = `<html><head><title>OKF &amp; you</title><style>p{color:red}</style><script>alert(1)</script></head>
    <body><h1>Open Knowledge Format</h1><p>Markdown&nbsp;+ YAML &lt;frontmatter&gt;</p><ul><li>one</li><li>two</li></ul></body></html>`;
  const { title, text } = htmlToText(html);
  assert.equal(title, "OKF & you");
  assert.match(text, /Open Knowledge Format\n/);
  assert.match(text, /Markdown \+ YAML <frontmatter>/);
  assert.match(text, /one\n.*two/s);
  assert.ok(!/alert|color:red/.test(text));
});

test("checkUrl allows public http(s) and blocks local/private targets", async () => {
  assert.equal(await checkUrl("https://cloud.google.com/blog", publicLookup), undefined);
  for (const u of ["file:///C:/x", "ftp://x.org/a", "http://localhost:20128/v1", "http://127.0.0.1:4317/", "http://[::1]/",
    "http://10.0.0.5/", "http://192.168.1.10/", "http://172.20.0.1/", "http://169.254.169.254/latest", "not a url"]) {
    assert.ok(await checkUrl(u, publicLookup), u);
  }
  const toPrivate = async () => [{ address: "127.0.0.1", family: 4 }];
  assert.match(await checkUrl("https://evil.example/", toPrivate) ?? "", /private|local/);
});

test("webFetch converts HTML, caps size, and re-checks redirects", async () => {
  const pages: Record<string, Response> = {
    "https://a.example/": new Response("<title>A</title><p>" + "x".repeat(5000) + "</p>", { headers: { "content-type": "text/html" } }),
    "https://b.example/": new Response("", { status: 302, headers: { location: "http://127.0.0.1:4317/workspaces" } }),
    "https://c.example/f.zip": new Response("PK..", { headers: { "content-type": "application/zip" } }),
  };
  const fetchImpl = async (u: string | URL | Request) => pages[String(u)] ?? new Response("nope", { status: 404 });
  const a = await webFetch("https://a.example/", { fetchImpl, lookup: publicLookup, maxChars: 1000 });
  assert.match(a, /^# A\nhttps:\/\/a\.example\//);
  assert.ok(a.length < 1200 && /truncated/.test(a));
  assert.match(await webFetch("https://b.example/", { fetchImpl, lookup: publicLookup }), /^ERROR: .*(private|local)/);
  assert.match(await webFetch("https://c.example/f.zip", { fetchImpl, lookup: publicLookup }), /^ERROR: .*content type/);
  assert.match(await webFetch("https://nope.example/x", { fetchImpl, lookup: publicLookup }), /^ERROR: HTTP 404/);
});

import { searchBackend, webSearch } from "../src/web.ts";
import type { AppConfig, Provider } from "../src/settings.ts";

const P = (id: string, search: Provider["search"], baseUrl = "https://x.example/v1"): Provider =>
  ({ id, name: id, api: "openai-completions", baseUrl, apiKey: "sk-key-0000000000", search });
const C = (over: Partial<AppConfig> = {}): AppConfig => ({
  providers: [P("omni", "google_search", "http://localhost:20128/v1"), P("or", "openrouter-online", "https://openrouter.ai/api/v1"), P("plain", "none")],
  defaultModel: { provider: "plain", model: "m" }, roleModels: {}, search: { mode: "auto" }, ...over,
});
const fakeFetch = (handler: (url: string, body: any) => object) => (async (u: any, init?: any) =>
  new Response(JSON.stringify(handler(String(u), init?.body ? JSON.parse(init.body) : undefined)), { headers: { "content-type": "application/json" } })) as typeof fetch;

test("backend selection matrix", () => {
  assert.equal(searchBackend(C()), "none");
  assert.equal(searchBackend(C({ search: { mode: "auto", searxngUrl: "http://sx.local" } })), "searxng");
  assert.equal(searchBackend(C({ defaultModel: { provider: "omni", model: "g" } })), "google_search");
  assert.equal(searchBackend(C({ defaultModel: { provider: "or", model: "a/b" } })), "openrouter-online");
  assert.equal(searchBackend(C({ search: { mode: "auto", model: { provider: "omni", model: "g" } } })), "google_search", "search.model wins");
  assert.equal(searchBackend(C({ defaultModel: { provider: "omni", model: "g" }, search: { mode: "off" } })), "none");
  assert.equal(searchBackend(C({ defaultModel: { provider: "omni", model: "g" }, search: { mode: "searxng", searxngUrl: "http://sx" } })), "searxng");
  assert.equal(searchBackend(C({ search: { mode: "endpoint", searxngUrl: "http://sx" } })), "none", "endpoint mode never falls back");
});

test("searxng results formatted", async () => {
  let seen = "";
  const out = await webSearch("open knowledge format", {
    config: C({ search: { mode: "searxng", searxngUrl: "http://sx.local/" } }),
    fetchImpl: fakeFetch(u => { seen = u; return { results: [{ title: "OKF spec", url: "https://okf.md/", content: "Markdown + YAML" }] }; }),
  });
  assert.match(seen, /^http:\/\/sx\.local\/search\?q=open%20knowledge%20format&format=json$/);
  assert.match(out, /OKF spec — https:\/\/okf\.md\//);
  assert.match(out, /Markdown \+ YAML/);
  assert.match(out, /web_fetch/);
});

test("openrouter online appends citations", async () => {
  let body: any;
  const out = await webSearch("q", {
    config: C({ defaultModel: { provider: "or", model: "openai/gpt-x" } }),
    fetchImpl: fakeFetch((_u, b) => { body = b; return { choices: [{ message: { content: "Answer.", annotations: [
      { type: "url_citation", url_citation: { url: "https://a.example", title: "A" } }, { type: "url_citation", url: "https://b.example" }] } }] }; }),
  });
  assert.equal(body.model, "openai/gpt-x:online");
  assert.match(out, /Answer\.[\s\S]*Sources:[\s\S]*https:\/\/a\.example[\s\S]*https:\/\/b\.example/);
});

test("google_search uses search.model and its provider", async () => {
  let url = "", body: any;
  await webSearch("q", {
    config: C({ search: { mode: "auto", model: { provider: "omni", model: "gemini-x" } } }),
    fetchImpl: fakeFetch((u, b) => { url = u; body = b; return { choices: [{ message: { content: "ok" } }] }; }),
  });
  assert.equal(url, "http://localhost:20128/v1/chat/completions");
  assert.equal(body.model, "gemini-x");
  assert.equal(body.tools[0].function.name, "google_search");
});

test("not configured message", async () => {
  assert.match(await webSearch("q", { config: C(), fetchImpl: fakeFetch(() => ({})) }), /^ERROR: web search is not configured/);
});

test("searchPageQuery recognises search-engine result pages", () => {
  assert.equal(searchPageQuery("https://html.duckduckgo.com/html/?q=%22Open+Knowledge+Format%22"), '"Open Knowledge Format"');
  assert.equal(searchPageQuery("https://duckduckgo.com/?q=okf"), "okf");
  assert.equal(searchPageQuery("https://www.google.com/search?q=okf+spec&hl=en"), "okf spec");
  assert.equal(searchPageQuery("https://www.google.com.vn/search?q=okf"), "okf");
  assert.equal(searchPageQuery("https://www.bing.com/search?q=okf"), "okf");
  assert.equal(searchPageQuery("https://search.brave.com/search?q=okf"), "okf");
  assert.equal(searchPageQuery("https://okfn.org/search?q=okf"), undefined, "a site's own search is a normal page");
  assert.equal(searchPageQuery("https://www.google.com/maps"), undefined);
  assert.equal(searchPageQuery("not a url"), undefined);
});
