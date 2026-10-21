// User settings: providers (endpoint + key), default/per-role models, web search. Stored in the app home.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { homePaths } from "./home.ts";

export type ApiType = "openai-completions" | "anthropic-messages" | "google-generative-ai";
export const API_TYPES: ApiType[] = ["openai-completions", "anthropic-messages", "google-generative-ai"];
export type SearchCapability = "google_search" | "openrouter-online" | "none";

export interface Provider {
  id: string;
  name: string;
  api: ApiType;
  baseUrl: string;
  apiKey: string;
  search: SearchCapability;
  contextWindow?: number;
}

export interface ModelRef { provider: string; model: string }

export interface AppConfig {
  providers: Provider[];
  defaultModel?: ModelRef;
  roleModels: Record<string, ModelRef>;
  search: { mode: "auto" | "endpoint" | "searxng" | "off"; searxngUrl?: string; model?: ModelRef };
  port?: number;
}

const emptyConfig = (): AppConfig => ({ providers: [], roleModels: {}, search: { mode: "auto" } });

export function loadConfig(path = homePaths().config): AppConfig {
  if (!existsSync(path)) return emptyConfig();
  let raw: any;
  try { raw = JSON.parse(readFileSync(path, "utf8")); }
  catch (e) { throw new Error(`cannot read settings file ${path}: ${(e as Error).message} — fix or delete it`); }
  return { ...emptyConfig(), ...raw, roleModels: raw.roleModels ?? {}, search: { mode: "auto", ...(raw.search ?? {}) } };
}

/** Atomic write; owner-only permissions on POSIX (the file holds API keys). */
function writePrivate(path: string, data: string) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data, { mode: 0o600 });
  renameSync(tmp, path);
}

export function saveConfig(c: AppConfig, path = homePaths().config): void {
  writePrivate(path, JSON.stringify(c, null, 2));
}

export function validateConfig(c: AppConfig): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  for (const p of c.providers) {
    if (!p.id || ids.has(p.id)) errs.push(`provider id "${p.id}" is missing or duplicated`);
    if (p.id && !/^[a-z0-9][a-z0-9-]*$/.test(p.id)) errs.push(`provider id "${p.id}" may only use a-z, 0-9 and -`);
    ids.add(p.id);
    if (!API_TYPES.includes(p.api)) errs.push(`provider "${p.id}": unknown API type "${p.api}"`);
    try {
      if (!/^https?:$/.test(new URL(p.baseUrl).protocol)) throw new Error();
    } catch { errs.push(`provider "${p.id}": base URL must be http(s)`); }
    if (!["google_search", "openrouter-online", "none"].includes(p.search)) errs.push(`provider "${p.id}": unknown search capability`);
  }
  const refs = [c.defaultModel, c.search.model, ...Object.values(c.roleModels)].filter(Boolean) as ModelRef[];
  for (const r of refs) if (!ids.has(r.provider) || !r.model) errs.push(`model "${r.provider}/${r.model}" points to a missing provider`);
  if (c.search.mode === "searxng" && !c.search.searxngUrl) errs.push("search mode searxng needs a SearXNG URL");
  if (c.port !== undefined && !(Number.isInteger(c.port) && c.port >= 1 && c.port <= 65535)) errs.push("port must be 1-65535");
  return errs;
}

export function maskKey(k: string): string {
  if (!k) return "";
  return k.length < 12 ? "…" : `${k.slice(0, 3)}…${k.slice(-4)}`;
}

const isMasked = (k: string | undefined) => !k || k.includes("…");

export function publicConfig(c: AppConfig): AppConfig {
  return { ...c, providers: c.providers.map(p => ({ ...p, apiKey: maskKey(p.apiKey) })) };
}

/** pi uses a native Gemini base URL as is, so it must name the API version (…/v1beta). */
const geminiVersioned = (p: Provider) => {
  const u = String(p.baseUrl ?? "").replace(/\/+$/, "");
  return p.api === "google-generative-ai" && u && !/\/v1(alpha|beta)?$/.test(u) ? `${u}/v1beta` : p.baseUrl;
};
const origin = (u: string) => { try { return new URL(u).origin; } catch { return ""; } };

/**
 * Apply an edit from the UI: a masked or empty key keeps the stored key of the same provider id, but only
 * while the endpoint origin and API type are unchanged — a stored key never goes to a different server.
 */
export function mergeConfig(current: AppConfig, incoming: AppConfig): AppConfig {
  const old = new Map(current.providers.map(p => [p.id, p]));
  const keep = (p: Provider) => {
    const o = old.get(p.id);
    return o && o.api === p.api && origin(o.baseUrl) !== "" && origin(o.baseUrl) === origin(p.baseUrl) ? o.apiKey : "";
  };
  return {
    providers: (incoming.providers ?? []).map(p => ({ ...p, baseUrl: geminiVersioned(p), apiKey: isMasked(p.apiKey) ? keep(p) : p.apiKey })),
    ...(incoming.defaultModel ? { defaultModel: incoming.defaultModel } : {}),
    roleModels: incoming.roleModels ?? {},
    search: incoming.search ?? { mode: "auto" },
    ...(incoming.port ? { port: incoming.port } : {}),
  };
}

export function modelFor(c: AppConfig, role: string): ModelRef | undefined {
  return c.roleModels[role] ?? c.defaultModel;
}

export function suggestSearch(baseUrl: string): SearchCapability {
  return /(^|\.)openrouter\.ai$/i.test(safeHost(baseUrl)) ? "openrouter-online" : "none";
}
const safeHost = (u: string) => { try { return new URL(u).hostname; } catch { return ""; } };

/** pi's models.json content, generated from the settings (every model the settings reference). */
export function piModelsJson(c: AppConfig): string {
  const used = new Map<string, Set<string>>();
  for (const r of [c.defaultModel, c.search.model, ...Object.values(c.roleModels)]) {
    if (r) (used.get(r.provider) ?? used.set(r.provider, new Set()).get(r.provider)!).add(r.model);
  }
  const providers = Object.fromEntries(c.providers.map(p => [p.id, {
    // pi skips providers without a key; local endpoints (Ollama, LM Studio) accept any placeholder
    baseUrl: p.baseUrl, api: p.api, apiKey: p.apiKey || "none",
    models: [...(used.get(p.id) ?? [])].map(id => (p.contextWindow ? { id, contextWindow: p.contextWindow } : { id })),
  }]));
  return JSON.stringify({ providers }, null, 2);
}

export function writePiModels(c: AppConfig, path = homePaths().piModels): void {
  writePrivate(path, piModelsJson(c));
}
