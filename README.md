# Agent Company

An AI team that works in a 2D pixel office on your computer. You talk to the **Manager**; it hands
work to the other roles (Researcher, Developer, Critic, and more from the role store), they pass
tasks between each other, and every step shows up live in the office. Anything with real-world
consequences (spending money, sending something outside, deleting) waits for **your** approval.

Bring your own model: any OpenAI-compatible, Anthropic or Gemini endpoint. Built on the
[pi](https://github.com/earendil-works/pi) agent SDK. The UI is in Vietnamese.

## Install

You need **Node.js 22.19 or newer** ([nodejs.org](https://nodejs.org)).

```sh
npm install -g @quaqduc/agent-company
```

Or use the installer, which checks your Node.js version first:

```sh
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/quaqducc/agent-office/main/install.sh | sh
```

```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/quaqducc/agent-office/main/install.ps1 | iex
```

From source: `git clone https://github.com/quaqducc/agent-office.git && cd agent-office && npm install && npm start`.

## First run

```sh
agent-company
```

The office opens at **http://127.0.0.1:4317**. The first screen asks for:

1. **Provider**: pick a preset or "Tuỳ chỉnh" for any other endpoint.
2. **API key**: stored only on your machine.
3. **Model**: press "Tải danh sách" to list the endpoint's models, then "Kiểm tra" to send a test message.

Then add a **workspace** (a project folder the team works in) and message the Manager.

| Preset | Endpoint URL | API type | Web search through the endpoint |
|---|---|---|---|
| OpenAI | `https://api.openai.com/v1` | OpenAI-compatible | — |
| OpenRouter | `https://openrouter.ai/api/v1` | OpenAI-compatible | OpenRouter web search |
| DeepSeek | `https://api.deepseek.com` | OpenAI-compatible | — |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | OpenAI-compatible | — |
| Anthropic | `https://api.anthropic.com` | Anthropic Messages | — |
| Ollama | `http://localhost:11434/v1` | OpenAI-compatible (no key) | — |
| OmniRoute | `http://localhost:20128/v1` | OpenAI-compatible | Google Search (`google_search`) |

Native Gemini (`https://generativelanguage.googleapis.com/v1beta`, API type "Gemini (native)") is
available under **Nâng cao** (Advanced).

## Interface Overview

```
+--------------------------------------------------------------------------------------------------+
|  Agent Office   [Workspace Name (click to rename)]           [Văn phòng] [Kho role] [Cài đặt]    |
+---+-----------------------------+------------------------------------+---------------------------+
| A | Explorer / Thay đổi         | Code Editor                        | Trò chuyện (Manager)      |
| c | --------------------------- | ---------------------------------- | ------------------------- |
| t | > src                       | [tab: app.js] [tab: diff: index.js]| Hàng đợi tin nhắn         |
| i |   v components              |                                    | [1] Follow-up prompt...   |
| v |     - button.ts             | 1 | function init() {              | [2] Another prompt...     |
| i |     - modal.ts              | 2 |   setupOffice();               | ------------------------- |
| t |   - server.ts               | 3 | }                              | Manager: Em đã giao việc  |
| y |   - types.ts                |                                    | cho Developer xử lý...    |
|   |                             |                                    |                           |
| B | Thay đổi:                   |                                    |                           |
| a | M src/server.ts (+12/-4)    |                                    |                           |
| r | A src/modal.ts (+45/-0)     |                                    |                           |
|   +-----------------------------+------------------------------------+                           |
|   | Bottom Panel (Lệnh / Test / Luồng việc / Nhật ký)                |                           |
|   | [Luồng việc] [Nhật ký] [Lệnh (3)] [Kết quả test: PASS]           |                           |
|   | ---------------------------------------------------------------- |                           |
|   | ✔ npm test: 249 passed, 0 failed (4.8s)                          |                           |
+---+------------------------------------------------------------------+---------------------------+
```

## Using it

- **The office & Customization**:
  - each role sits at an assigned desk; 2D pixel characters walk along corridors and through doors to interact and deliver handoffs;
  - configure rooms, desk layouts and room templates via the **Văn phòng** (Office) dialog;
  - rename workspaces anytime by clicking the workspace title;
  - click any character to view its active tasks, messages and tool calls.
- **Message queue**:
  - send prompts or follow-up messages anytime without waiting for the active run to finish;
  - incoming requests enter a persistent FIFO queue and execute sequentially without overlap;
  - view and remove queued items directly in the chat panel.
- **Embedded IDE**:
  - **Explorer**: browse workspace files with lazy loading and file icons; create new files with `+`;
  - **Code Editor**: edit files with fast PrismJS syntax highlighting, atomic saving (`Ctrl+S`), CRLF/LF preservation, and 409 conflict detection against disk changes;
  - **Thay đổi (Diff Viewer)**: inspect pre-edit shadow backups vs current file changes per run using pure Myers diff with inline additions/deletions badges;
  - **Bottom Panel**:
    - **Lệnh (Command Log)**: chronological log of shell executions (`bash`, `powershell`) with statuses, durations, and output modal dialog with 1-click clipboard copy;
    - **Kết quả test (Test Results)**: auto-detects test runners (`node:test` Spec/TAP, `pytest`) with pass/fail badges, summary metrics, test case breakdown, and raw output details;
    - **Luồng việc & Nhật ký**: task hierarchy and event log with synchronized **Question Selector** dropdown to filter data per question;
    - **Shortcuts & Resize**: drag `.bottom-panel-resizer` to resize (persisted in localStorage); press `Ctrl+J` to toggle bottom panel, `Ctrl+S` to save file, `Ctrl+B` to toggle sidebar.
- **Settings** (gear icon):
  - add several providers;
  - set one default model for the team, with optional per-role overrides (e.g. a strong coding
    model for the Developer, a cheap fast one for the Researcher);
  - choose how web search works.
- **Role store** ("Kho role"):
  - the base team is Manager, Researcher, Developer and Critic;
  - ten more roles can be installed on demand: Brainstormer, Planner, Product Manager,
    Architect, Reviewer, UI/UX, AI Engineer, DevOps, Marketing, Business Strategist;
  - downloads are checked against SHA-256 checksums;
  - the Manager uses a new role as soon as it is installed.
- **Web search** lets the Researcher check facts before answering. It runs through the endpoint
  (OmniRoute's Google Search, OpenRouter's web search) or through your own
  [SearXNG](https://docs.searxng.org) instance, which needs the JSON format enabled.
  "Tự động" (Auto) uses the endpoint's search when available and falls back to SearXNG.
- **Side panel**:
  - **Trò chuyện**: chat with the Manager;
  - **Luồng việc**: the task tree;
  - **Nhật ký**: the full event log.
- **Lần chạy** replays any past run.

### Commands

| Command | Purpose |
|---|---|
| `agent-company` | start the app and open the browser (`--port <n>`, `--no-open`, `--home <dir>`) |
| `agent-company doctor` | check Node.js, the app folder, the configured model and web search |
| `agent-company chat <folder> [name]` | talk to a workspace's Manager in the terminal (the app must be running) |
| `agent-company --version` | print the version |

Terminal chat commands:

| Command | Purpose |
|---|---|
| `/approvals` | list pending approvals |
| `/approve <id>` | approve |
| `/reject <id> [note]` | reject |
| `/edit <id> <note>` | ask for a change |
| `/stop` | stop the run |
| `/quit` | exit |

## Where your data lives

```
~/.agent-company/              (override with --home or AGENT_COMPANY_HOME)
  config.json                  providers, API keys, model choices (owner-only permissions on macOS/Linux)
  workspaces.json              registered workspaces
  library/                     roles and skills installed from the store
  pi/                          model settings generated for the pi SDK

<workspace>/.company/
  config.json                  optional: {"roles": [...], "limits": {...}}
  runs/                        every event of every run (secrets redacted) + run index
  sessions/<role>/             each role's conversation history
```

Add `.company/` to your project's `.gitignore` if you do not want run logs in git.

## Safety

- **Approvals.** Real-world actions (spend, send outside, delete) go through an approval that only
  you can answer.
- **File access.**
  - Roles read files on your machine except secrets: `.env` files, keys, `~/.ssh`, cloud
    credentials, and the app's own folder.
  - Writes and shell commands are confined to the workspace folder.
  - Thinking roles have no shell.
  - Builder roles' shell is **not a sandbox**; review the log, and run the app in a container or VM
    for untrusted work.
- **Local server.**
  - The server listens on 127.0.0.1 only.
  - It rejects foreign `Host` headers (DNS rebinding) and browser origins not listed in
    `COMPANY_ALLOWED_ORIGINS`.
  - POST, PUT and DELETE requests must be JSON.
  - API keys never reach the browser; the UI only sees them masked.
- **Cost.** There are no token limits by default. Each run's token count is shown in the office.
  To cap a run, set `limits.runTokenBudget` / `limits.maxTaskTokens` in `<workspace>/.company/config.json`.

## Configuration reference

| Variable | Default | Purpose |
|---|---|---|
| `AGENT_COMPANY_HOME` | `~/.agent-company` | app folder |
| `COMPANY_PORT` | `4317` | port (also `--port`, or `port` in `config.json`) |
| `COMPANY_ALLOWED_ORIGINS` | empty | extra browser origins allowed to call the API (comma-separated) |
| `COMPANY_URL` | `http://127.0.0.1:4317` | server used by `agent-company chat` |

Workspace limits (`<workspace>/.company/config.json` → `limits`):

| Limit | Default | Notes |
|---|---|---|
| `maxDepth` | 4 | |
| `maxPairRounds` | 3 | |
| `maxConcurrent` | 3 | |
| `taskTimeoutMs` | 1200000 | counts active model time only |
| `runTokenBudget` | unlimited | |
| `maxTaskTokens` | unlimited | |

## Development

```sh
npm install
npm start                    # run from the TypeScript sources
npm test                     # unit tests (no model calls)
npm run check                # type-check
node tests/e2e/ui-demo.ts    # offline office demo with a scripted team → http://127.0.0.1:4318
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and the architecture guide [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Design notes are in `docs/superpowers/`.

## License

MIT, see [LICENSE](LICENSE). Bundled and downloadable personas and skills come from open-source
projects under their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
