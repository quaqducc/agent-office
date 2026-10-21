import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadConfig, saveConfig, validateConfig, maskKey, publicConfig, mergeConfig, modelFor, suggestSearch, writePiModels, piModelsJson,
  type AppConfig, type Provider,
} from "../src/settings.ts";

const dir = () => mkdtempSync(join(tmpdir(), "settings-"));
const prov = (over: Partial<Provider> = {}): Provider => ({
  id: "omni", name: "OmniRoute", api: "openai-completions", baseUrl: "http://localhost:20128/v1",
  apiKey: "sk-1234567890abcdef", search: "google_search", ...over,
});
const cfg = (over: Partial<AppConfig> = {}): AppConfig => ({
  providers: [prov()], defaultModel: { provider: "omni", model: "gemini-flash" }, roleModels: {}, search: { mode: "auto" }, ...over,
});

test("empty config defaults", () => {
  const c = loadConfig(join(dir(), "missing.json"));
  assert.deepEqual(c, { providers: [], roleModels: {}, search: { mode: "auto" } });
});

test("saveConfig is atomic and private", () => {
  const d = dir();
  const file = join(d, "config.json");
  saveConfig(cfg(), file);
  assert.deepEqual(loadConfig(file).providers[0].id, "omni");
  assert.deepEqual(readdirSync(d), ["config.json"], "no temp files left");
  if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);
});

test("maskKey", () => {
  assert.equal(maskKey("sk-1234567890abcdef"), "sk-…cdef");
  assert.equal(maskKey("short"), "…");
  assert.equal(maskKey(""), "");
});

test("publicConfig masks keys and mergeConfig keeps stored key when masked", () => {
  const stored = cfg();
  const pub = publicConfig(stored);
  assert.equal(pub.providers[0].apiKey, "sk-…cdef");
  assert.ok(!JSON.stringify(pub).includes("1234567890"));
  const back = mergeConfig(stored, { ...pub, providers: [{ ...pub.providers[0], name: "Omni" }] });
  assert.equal(back.providers[0].apiKey, "sk-1234567890abcdef");
  assert.equal(back.providers[0].name, "Omni");
  const replaced = mergeConfig(stored, { ...pub, providers: [{ ...pub.providers[0], apiKey: "sk-new-key-000000" }] });
  assert.equal(replaced.providers[0].apiKey, "sk-new-key-000000");
});

test("a stored key never follows the provider to another endpoint or API type", () => {
  const stored = cfg();
  const pub = publicConfig(stored);
  const moved = mergeConfig(stored, { ...pub, providers: [{ ...pub.providers[0], baseUrl: "http://attacker.example/v1" }] });
  assert.equal(moved.providers[0].apiKey, "", "new origin: the user must type the key again");
  const google = mergeConfig(stored, { ...pub, providers: [{ ...pub.providers[0], api: "google-generative-ai" }] });
  assert.equal(google.providers[0].apiKey, "", "a different API type would send the key differently (e.g. in the URL)");
  const samePlace = mergeConfig(stored, { ...pub, providers: [{ ...pub.providers[0], baseUrl: stored.providers[0].baseUrl + "/" }] });
  assert.equal(samePlace.providers[0].apiKey, stored.providers[0].apiKey, "same origin keeps the key");
});

test("modelFor prefers role override", () => {
  const c = cfg({ roleModels: { critic: { provider: "omni", model: "deepseek" } } });
  assert.deepEqual(modelFor(c, "critic"), { provider: "omni", model: "deepseek" });
  assert.deepEqual(modelFor(c, "developer"), { provider: "omni", model: "gemini-flash" });
  assert.equal(modelFor({ ...c, defaultModel: undefined }, "developer"), undefined);
});

test("suggestSearch", () => {
  assert.equal(suggestSearch("https://openrouter.ai/api/v1"), "openrouter-online");
  assert.equal(suggestSearch("https://api.openai.com/v1"), "none");
});

test("writePiModels lists every referenced model", () => {
  const file = join(dir(), "models.json");
  writePiModels(cfg({ roleModels: { critic: { provider: "omni", model: "deepseek" } }, search: { mode: "auto", model: { provider: "omni", model: "gemini-pro" } } }), file);
  const m = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(m.providers.omni.baseUrl, "http://localhost:20128/v1");
  assert.equal(m.providers.omni.api, "openai-completions");
  assert.equal(m.providers.omni.apiKey, "sk-1234567890abcdef");
  assert.deepEqual(m.providers.omni.models.map((x: any) => x.id).sort(), ["deepseek", "gemini-flash", "gemini-pro"]);
});

test("validateConfig rejects bad URL / unknown api / duplicate ids / dangling model", () => {
  assert.deepEqual(validateConfig(cfg()), []);
  assert.ok(validateConfig(cfg({ providers: [prov({ baseUrl: "ftp://x" })] })).length);
  assert.ok(validateConfig(cfg({ providers: [prov({ api: "nope" as any })] })).length);
  assert.ok(validateConfig(cfg({ providers: [prov(), prov()] })).length);
  assert.ok(validateConfig(cfg({ defaultModel: { provider: "ghost", model: "m" } })).length);
  assert.ok(validateConfig(cfg({ search: { mode: "searxng" } })).length, "searxng needs a URL");
});

test("keyless local providers, native Gemini URLs and a broken settings file", () => {
  const local = cfg({ providers: [{ id: "ollama", name: "Ollama", api: "openai-completions", baseUrl: "http://localhost:11434/v1", apiKey: "", search: "none" }],
    defaultModel: { provider: "ollama", model: "llama3" } });
  assert.equal(JSON.parse(piModelsJson(local)).providers.ollama.apiKey, "none", "pi ignores providers without a key");
  const g = mergeConfig(cfg(), { ...cfg(), providers: [{ id: "g", name: "Gemini", api: "google-generative-ai", baseUrl: "https://generativelanguage.googleapis.com/", apiKey: "AIzaX", search: "none" }] });
  assert.equal(g.providers[0].baseUrl, "https://generativelanguage.googleapis.com/v1beta");
  const broken = join(mkdtempSync(join(tmpdir(), "cfg-bad-")), "config.json");
  writeFileSync(broken, "{ not json");
  assert.throws(() => loadConfig(broken), (e: any) => e.message.includes(broken));
});
