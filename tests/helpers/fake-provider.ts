// Minimal fake LLM endpoints for tests: OpenAI-style, Anthropic-style and Gemini-style model lists + chat.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeProvider { url: string; calls: { path: string; body: any }[]; close(): Promise<void> }

export async function startFakeProvider(o: { key?: string; html?: boolean; reply?: string } = {}): Promise<FakeProvider> {
  const key = o.key ?? "sk-good-key-123456";
  const calls: { path: string; body: any }[] = [];
  const server: Server = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const url = new URL(req.url ?? "/", "http://x");
    calls.push({ path: url.pathname, body: raw ? JSON.parse(raw) : undefined });
    const send = (status: number, data: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
    if (o.html) { res.writeHead(200, { "content-type": "text/html" }); return res.end("<html>login page</html>"); }
    const authorized = req.headers.authorization === `Bearer ${key}` || req.headers["x-api-key"] === key || url.searchParams.get("key") === key;
    if (!authorized) return send(401, { error: { message: "invalid api key" } });
    if (url.pathname === "/v1/models" && req.headers["x-api-key"]) return send(200, { data: [{ id: "claude-x" }] });
    if (url.pathname === "/v1/models") return send(200, { data: [{ id: "model-a" }, { id: "model-b" }] });
    if (url.pathname === "/v1beta/models") return send(200, { models: [{ name: "models/gemini-x" }] });
    if (url.pathname === "/v1/chat/completions") return send(200, { choices: [{ message: { role: "assistant", content: o.reply ?? "pong" } }] });
    return send(404, { error: { message: "not found" } });
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, calls, close: () => new Promise(r => { server.closeAllConnections(); server.close(() => r()); }) };
}
