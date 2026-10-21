import { test } from "node:test";
import assert from "node:assert/strict";
import { listModels, testProvider } from "../src/providers.ts";
import type { Provider } from "../src/settings.ts";
import { startFakeProvider } from "./helpers/fake-provider.ts";

const prov = (baseUrl: string, over: Partial<Provider> = {}): Provider =>
  ({ id: "p", name: "P", api: "openai-completions", baseUrl, apiKey: "sk-good-key-123456", search: "none", ...over });

test("listModels: openai, anthropic and google styles", async () => {
  const fp = await startFakeProvider();
  try {
    assert.deepEqual(await listModels(prov(`${fp.url}/v1`)), ["model-a", "model-b"]);
    assert.deepEqual(await listModels(prov(fp.url, { api: "anthropic-messages" })), ["claude-x"]);
    assert.deepEqual(await listModels(prov(fp.url, { api: "google-generative-ai" })), ["gemini-x"]);
    // pi's convention for Gemini is a base URL that already ends in /v1beta
    assert.deepEqual(await listModels(prov(`${fp.url}/v1beta`, { api: "google-generative-ai" })), ["gemini-x"]);
  } finally { await fp.close(); }
});

test("testProvider ok", async () => {
  const fp = await startFakeProvider({ reply: "pong" });
  try {
    const r = await testProvider(prov(`${fp.url}/v1`), "model-a");
    assert.equal(r.ok, true);
    if (r.ok) { assert.equal(r.reply, "pong"); assert.ok(r.ms >= 0); }
    assert.equal(fp.calls.at(-1)!.body.model, "model-a");
  } finally { await fp.close(); }
});

test("test reports provider errors", async () => {
  const fp = await startFakeProvider();
  const html = await startFakeProvider({ html: true });
  try {
    const bad = await testProvider(prov(`${fp.url}/v1`, { apiKey: "sk-wrong-000000000" }), "model-a");
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.match(bad.error, /API key/);
    const wrongPath = await testProvider(prov(`${fp.url}/nope`), "model-a");
    if (!wrongPath.ok) assert.match(wrongPath.error, /endpoint|model/i); else assert.fail("404 must fail");
    const notApi = await testProvider(prov(`${html.url}/v1`), "model-a");
    if (!notApi.ok) assert.match(notApi.error, /API hợp lệ/); else assert.fail("HTML must fail");
    const closed = await testProvider(prov("http://127.0.0.1:9/v1"), "model-a");
    if (!closed.ok) assert.match(closed.error, /kết nối|connect/i); else assert.fail("closed port must fail");
  } finally { await fp.close(); await html.close(); }
});
