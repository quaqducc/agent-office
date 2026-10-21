// Web research tools for roles: internet_search (Gemini + Google Search via OmniRoute) and web_fetch.
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { loadConfig, type AppConfig } from "./settings.ts";

type Lookup = (host: string) => Promise<{ address: string; family: number }[]>;
const defaultLookup: Lookup = host => dnsLookup(host, { all: true });

function privateIp(ip: string): boolean {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return privateIp(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** Error text when a URL must not be fetched (non-http(s), local or private network); undefined when OK. */
export async function checkUrl(raw: string, lookup: Lookup = defaultLookup): Promise<string | undefined> {
  let u: URL;
  try { u = new URL(raw); } catch { return "invalid URL"; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return `only http(s) URLs are allowed (got ${u.protocol})`;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return "local addresses are not allowed";
  const ips = isIP(host) ? [host] : await lookup(host).then(r => r.map(x => x.address), () => [] as string[]);
  if (!ips.length) return `cannot resolve ${host}`;
  if (ips.some(privateIp)) return "private/local network addresses are not allowed";
  return undefined;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) =>
  e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m);

/** Readable text of an HTML page. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").trim();
  const text = decode(html
    .replace(/<(script|style|noscript|svg|head|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/section|\/article|\/pre|\/blockquote)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, text };
}

export interface FetchOptions {
  fetchImpl?: (u: string | URL | Request, init?: RequestInit) => Promise<Response>;
  lookup?: Lookup;
  maxChars?: number;
}

/** Fetch a public page as readable text (never throws; errors start with "ERROR:"). */
export async function webFetch(url: string, o: FetchOptions = {}): Promise<string> {
  const doFetch = o.fetchImpl ?? fetch;
  const maxChars = o.maxChars ?? 20_000;
  let current = url;
  try {
    for (let hop = 0; hop < 5; hop++) {
      const bad = await checkUrl(current, o.lookup);
      if (bad) return `ERROR: ${bad} (${current})`;
      const res = await doFetch(current, { redirect: "manual", signal: AbortSignal.timeout(20_000), headers: { "user-agent": "agent-company-research/0.1", accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.1" } });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        current = new URL(res.headers.get("location")!, current).toString();
        continue;
      }
      if (!res.ok) return `ERROR: HTTP ${res.status} for ${current}`;
      const type = res.headers.get("content-type") ?? "";
      if (!/^(text\/|application\/(json|xml|xhtml))/i.test(type)) return `ERROR: unsupported content type "${type}" for ${current}`;
      const body = (await res.text()).slice(0, 2_000_000);
      const { title, text } = /html/i.test(type) ? htmlToText(body) : { title: "", text: body };
      const clipped = text.length > maxChars ? `${text.slice(0, maxChars)}\n\n[truncated: ${text.length - maxChars} more characters]` : text;
      return `# ${title || current}\n${current}\n\n${clipped}`;
    }
    return `ERROR: too many redirects (${url})`;
  } catch (e) {
    return `ERROR: ${(e as Error).message} (${current})`;
  }
}

const SEARCH_PROMPT = "You are a web search tool. Search the web to answer the query with current, verifiable facts. " +
  "Reply with: a short factual answer (max 8 sentences), then a 'Sources:' list of the URLs you actually used. " +
  "If the search finds nothing relevant, say exactly that. Do not guess.";

/** The query of a search-engine result page (DuckDuckGo, Google, Bing, Brave), or undefined for any other URL. */
export function searchPageQuery(raw: string): string | undefined {
  let u: URL;
  try { u = new URL(raw); } catch { return undefined; }
  const host = u.hostname.replace(/^www\./, "");
  const engine = /^((html|lite)\.)?duckduckgo\.com$/.test(host)
    || (/^google\.[a-z.]+$/.test(host) && u.pathname === "/search")
    || ((host === "bing.com" || host === "search.brave.com") && u.pathname === "/search");
  const q = u.searchParams.get("q");
  return engine && q ? q : undefined;
}

export type SearchBackend ="google_search" | "openrouter-online" | "searxng" | "none";

/** Which search backend the settings select (see design §2.1: provider capability, then SearXNG). */
export function searchBackend(c: AppConfig): SearchBackend {
  const s = c.search;
  if (s.mode === "off") return "none";
  const ref = s.model ?? c.defaultModel;
  const capability = c.providers.find(p => p.id === ref?.provider)?.search ?? "none";
  if (s.mode === "endpoint") return capability;
  if (s.mode === "searxng") return s.searxngUrl ? "searxng" : "none";
  return capability !== "none" ? capability : s.searxngUrl ? "searxng" : "none";
}

interface SearchDeps { config?: AppConfig; fetchImpl?: typeof fetch }

/** Search the web with whatever backend the settings select. Never throws; errors start with "ERROR:". */
export async function webSearch(query: string, deps: SearchDeps = {}): Promise<string> {
  const cfg = deps.config ?? loadConfig();
  const doFetch = deps.fetchImpl ?? fetch;
  const backend = searchBackend(cfg);
  try {
    if (backend === "none") {
      return "ERROR: web search is not configured (Cài đặt → Tìm kiếm). Say you could not verify instead of guessing.";
    }
    if (backend === "searxng") {
      const base = cfg.search.searxngUrl!.replace(/\/+$/, "");
      const res = await doFetch(`${base}/search?q=${encodeURIComponent(query)}&format=json`, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) return `ERROR: search failed (SearXNG HTTP ${res.status})`;
      const results = ((await res.json() as any).results ?? []).slice(0, 8);
      if (!results.length) return "No results found.";
      return "Search results (open the relevant ones with web_fetch before relying on them):\n" +
        results.map((r: any, i: number) => `${i + 1}. ${r.title} — ${r.url}\n   ${String(r.content ?? "").slice(0, 300)}`).join("\n");
    }
    const ref = (cfg.search.model ?? cfg.defaultModel)!;
    const provider = cfg.providers.find(p => p.id === ref.provider)!;
    const request: Record<string, unknown> = { messages: [{ role: "system", content: SEARCH_PROMPT }, { role: "user", content: query }] };
    if (backend === "google_search") {
      request.model = ref.model;
      // OmniRoute turns a function named google_search into Gemini's googleSearch grounding tool.
      request.tools = [{ type: "function", function: { name: "google_search", description: "Google Search", parameters: { type: "object", properties: {} } } }];
    } else {
      // ponytail: OpenRouter's ":online" variant is deprecated in favour of the openrouter:web_search server tool; switch when it is stable
      request.model = `${ref.model.replace(/:online$/, "")}:online`;
    }
    const res = await doFetch(`${provider.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST", signal: AbortSignal.timeout(90_000),
      headers: { "content-type": "application/json", authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify(request),
    });
    const data = await res.json() as any;
    if (!res.ok || data.error) return `ERROR: search failed (${data.error?.message ?? res.status})`;
    const message = data.choices?.[0]?.message ?? {};
    const text = String(message.content ?? "").trim();
    if (!text) return "ERROR: empty search result";
    const urls = (message.annotations ?? []).map((a: any) => a.url_citation?.url ?? a.url).filter(Boolean);
    return urls.length && !/Sources:/i.test(text) ? `${text}\n\nSources:\n${[...new Set(urls)].map(u => `- ${u}`).join("\n")}` : text;
  } catch (e) {
    return `ERROR: search failed (${(e as Error).message})`;
  }
}
