import { test } from "node:test";
import assert from "node:assert/strict";
import { API_TYPES } from "../src/settings.ts";
// @ts-ignore — plain browser module
import { isLocalUrl, providerId, providerPresets, validateProviderForm } from "../ui/js/settings.js";

test("presets have valid urls and api types", () => {
  assert.ok(providerPresets.length >= 7);
  for (const p of providerPresets) {
    assert.ok((API_TYPES as string[]).includes(p.api), `${p.key}: api ${p.api}`);
    assert.ok(["google_search", "openrouter-online", "none"].includes(p.search), `${p.key}: search ${p.search}`);
    if (p.key === "custom") { assert.equal(p.baseUrl, ""); continue; }
    assert.match(new URL(p.baseUrl).protocol, /^https?:$/, p.key);
  }
  assert.equal(providerPresets.find((p: any) => p.key === "openrouter")!.search, "openrouter-online");
  assert.equal(providerPresets.find((p: any) => p.key === "omniroute")!.search, "google_search");
});

test("validateProviderForm: url and key rules", () => {
  const ok = { name: "OpenAI", baseUrl: "https://api.openai.com/v1", apiKey: "sk-x" };
  assert.deepEqual(validateProviderForm(ok), []);
  assert.equal(validateProviderForm({ ...ok, name: " " }).length, 1);
  assert.match(validateProviderForm({ ...ok, baseUrl: "" }).join(), /endpoint URL/);
  assert.match(validateProviderForm({ ...ok, baseUrl: "ftp://x.y" }).join(), /http/);
  assert.match(validateProviderForm({ ...ok, baseUrl: "not a url" }).join(), /http/);
  assert.match(validateProviderForm({ ...ok, apiKey: "" }).join(), /API key/);
  // local endpoints (Ollama, LM Studio, OmniRoute) may have no key
  assert.deepEqual(validateProviderForm({ name: "Ollama", baseUrl: "http://localhost:11434/v1", apiKey: "" }), []);
  assert.deepEqual(validateProviderForm({ name: "Local", baseUrl: "http://127.0.0.1:8080/v1", apiKey: "" }), []);
  // a stored key shown masked counts as present
  assert.deepEqual(validateProviderForm({ ...ok, apiKey: "sk-…abcd" }), []);
});

test("isLocalUrl and providerId", () => {
  assert.equal(isLocalUrl("http://localhost:1/v1"), true);
  assert.equal(isLocalUrl("http://[::1]:1/"), true);
  assert.equal(isLocalUrl("https://api.openai.com"), false);
  assert.equal(isLocalUrl("garbage"), false);
  assert.equal(providerId("OpenRouter", []), "openrouter");
  assert.equal(providerId("OpenRouter", ["openrouter"]), "openrouter-2");
  assert.equal(providerId("Máy chủ riêng (Việt)", []), "may-chu-rieng-viet");
  assert.equal(providerId("!!!", []), "provider");
});
