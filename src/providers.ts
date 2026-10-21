// Talk to a configured provider directly: list its models and run a one-shot connection test.
import type { Provider } from "./settings.ts";

type Fetch = typeof fetch;
const trim = (u: string) => u.replace(/\/+$/, "");
/** Gemini base URLs follow pi's convention (`…/v1beta`); a bare host gets `/v1beta` added. */
const geminiBase = (u: string) => (/\/v1(alpha|beta)?$/.test(trim(u)) ? trim(u) : `${trim(u)}/v1beta`);

/** Model ids the endpoint offers (OpenAI `/models`, Anthropic `/v1/models`, Gemini `/v1beta/models`). */
export async function listModels(p: Provider, fetchImpl: Fetch = fetch): Promise<string[]> {
  const base = trim(p.baseUrl);
  let url: string, headers: Record<string, string> = {};
  if (p.api === "anthropic-messages") {
    url = `${base}/v1/models`;
    headers = { "x-api-key": p.apiKey, "anthropic-version": "2023-06-01" };
  } else if (p.api === "google-generative-ai") {
    url = `${geminiBase(base)}/models?key=${encodeURIComponent(p.apiKey)}`;
  } else {
    url = `${base}/models`;
    if (p.apiKey) headers = { authorization: `Bearer ${p.apiKey}` };
  }
  const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(20_000) });
  const data = await res.json().catch(() => { throw new Error("endpoint không trả về API hợp lệ (không phải JSON)"); }) as any;
  if (!res.ok) throw new Error(httpError(res.status, data));
  const ids: string[] = p.api === "google-generative-ai"
    ? (data.models ?? []).map((m: any) => String(m.name).replace(/^models\//, ""))
    : (data.data ?? []).map((m: any) => String(m.id));
  return ids.filter(Boolean).sort();
}

function httpError(status: number, data: any): string {
  const detail = data?.error?.message ?? data?.message ?? "";
  if (status === 401 || status === 403) return `API key bị từ chối (${status})${detail ? `: ${detail}` : ""}`;
  if (status === 404) return `endpoint hoặc model không đúng (404)${detail ? `: ${detail}` : ""}`;
  if (status === 429) return `bị giới hạn tốc độ / hết hạn mức (429)${detail ? `: ${detail}` : ""}`;
  return `lỗi ${status}${detail ? `: ${detail}` : ""}`;
}

/** One tiny completion through the provider's chat API. */
export async function testProvider(p: Provider, model: string, fetchImpl: Fetch = fetch):
  Promise<{ ok: true; ms: number; reply: string } | { ok: false; error: string }> {
  const base = trim(p.baseUrl);
  const prompt = "Reply with exactly: pong";
  let url: string, headers: Record<string, string>, body: unknown, pick: (d: any) => string;
  if (p.api === "anthropic-messages") {
    url = `${base}/v1/messages`;
    headers = { "x-api-key": p.apiKey, "anthropic-version": "2023-06-01" };
    body = { model, max_tokens: 16, messages: [{ role: "user", content: prompt }] };
    pick = d => d.content?.[0]?.text;
  } else if (p.api === "google-generative-ai") {
    url = `${geminiBase(base)}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(p.apiKey)}`;
    headers = {};
    body = { contents: [{ role: "user", parts: [{ text: prompt }] }] };
    pick = d => d.candidates?.[0]?.content?.parts?.[0]?.text;
  } else {
    url = `${base}/chat/completions`;
    headers = p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {};
    body = { model, messages: [{ role: "user", content: prompt }], max_tokens: 16 };
    pick = d => d.choices?.[0]?.message?.content;
  }
  const started = Date.now();
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST", signal: AbortSignal.timeout(60_000),
      headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, error: `không kết nối được tới ${base} (${(e as Error).message})` };
  }
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch {
    return { ok: false, error: res.ok ? "endpoint không trả về API hợp lệ (không phải JSON) — kiểm tra lại URL" : httpError(res.status, undefined) };
  }
  if (!res.ok) return { ok: false, error: httpError(res.status, data) };
  const reply = String(pick(data) ?? "").trim();
  if (!reply) return { ok: false, error: "endpoint không trả về API hợp lệ (không có nội dung trả lời)" };
  return { ok: true, ms: Date.now() - started, reply };
}
