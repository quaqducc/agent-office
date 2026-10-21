# Changelog

## 0.1.0 — 2026-10-21

First public release.

- `agent-company` command: `start` (opens the office in the browser), `doctor`, `chat`, `import`.
- Bring your own API: OpenAI-compatible, Anthropic and Gemini endpoints, with presets for OpenAI,
  OpenRouter, DeepSeek, Gemini, Anthropic, Ollama and OmniRoute. One default model plus optional
  per-role models. Keys are stored only in `~/.agent-company/config.json`.
- Base team: Manager, Researcher, Developer, Critic. Ten more roles in the role store, installed on
  demand with checksum-verified downloads.
- Web search through the endpoint (OmniRoute `google_search`, OpenRouter web search) or SearXNG.
- 2D pixel office UI: live team activity, task flow, log, approvals, run replay.
