# Agent Company — Orchestrator Design

Date: 2026-10-19 · Status: draft for approval · Scope: orchestrator only (the 2D office UI is a separate, later project)

## 1. Intent

The user wants to run an "AI company": a team of role agents (Manager, Brainstormer, Planner,
Critic, Developer, …) that talk to each other to produce results, while the user talks only to
the Manager. A later UI will visualize the team as characters in a 2D office, show who is talking
to whom, the plan flow, logs and results. This document covers the engine underneath: running the
roles, letting them hand work to each other, reporting checkpoints to the Manager, and exposing
everything as an event stream + history the UI can consume.

The first real workload will be an MMO side project (surveying premium-account resellers on
Telegram, then automating purchases). That project is out of scope here; it only motivates the
need for logs, approvals and safety limits.

## 2. Goals

1. Run each role as an isolated pi agent session with its own persona, skills and tool allowlist,
   loaded from the existing role library.
2. Let any role hand work directly to any other role (peer-to-peer), not only via the Manager.
3. Checkpoints: important milestones are reported to the Manager, and every checkpoint report
   includes what was done since the previous checkpoint (role-written summary + automatic trail).
4. The process is decided by the Manager at run time; nothing in the engine hardcodes a pipeline.
5. Every interaction is logged per workspace and replayable; live events stream to clients.
6. The user can talk to the Manager, watch progress, and stop a run.

## 3. Non-goals (v1)

- The office UI (separate project; this engine only provides the API it needs).
- Web/Telegram/browser tools for roles.
- Auto-resuming runs after a server crash (runs are marked `interrupted`; sessions stay on disk).
- Multi-user, authentication, remote access.
- Per-role model selection (all roles use one model for now).
- Cost dashboards beyond token counts per event/task/run.

## 4. Anti-goals (would make this a failure even if it works)

- A fixed pipeline baked into code ("always Brainstormer → Critic → Planner").
- Hidden agent-to-agent communication that does not appear in the log/event stream.
- Modifying the user's Claude Code setup (`~/.claude`, global Node 21, global npm packages).
- Runaway loops or unbounded spend with no automatic stop.

## 5. Constraints and existing assets

- **Isolation:** run on the portable Node at `D:\tools\pi-runtime\node` (v24.21.0). Never use or
  modify the global Node 21 or `~/.claude`.
- **pi:** `@earendil-works/pi-coding-agent@1.0.4` (pinned). pi config dir is
  `D:\tools\pi-runtime\agent` (has `models.json`, `auth.json`, `settings.json`).
- **Model:** provider `omniroute`, model `antigravity/gemini-3.8-flash-tiered`, via OmniRoute at
  `http://localhost:20128/v1` (OpenAI-compatible; already configured in `models.json`).
  Verified: plain prompts (~3–5 s) and tool calling work through it.
- **Role library:** `D:\tools\pi-runtime\library\`
  - `roles\<id>.md`: frontmatter `name`, `description`, optional `persona` (path relative to the
    library), `tools` (comma list of pi tool names), `skills` (comma list of skill dir names),
    optional `roster: true` (Manager gets the team list). Body = role-specific instructions.
  - `roles\_team.md`: rules appended to every role.
  - `skills\<name>\SKILL.md`: 61 curated skills. `vendor\`: pinned source repos.
  - `role.mjs`: existing CLI launcher containing the frontmatter parser and prompt assembly
    (persona + body + roster + `_team.md`). The orchestrator must assemble prompts the same way;
    extract the shared logic into one module used by both rather than duplicating it.
  - 13 roles exist: manager, brainstormer, planner, business-strategist, product-manager,
    marketing, architect, developer, ai-engineer, devops, ui-ux, reviewer, critic.
  - **Prompt split (decided):** the text-block `HANDOFF →` convention in `_team.md` is CLI-only.
    Move it to `roles/_cli.md` (appended only by `role.mjs`); add `roles/_orchestrator.md`
    (appended only by the server) telling roles to delegate with the `handoff` tool and report
    with the `checkpoint` tool, including the mandatory checkpoint rules of §8.3. `_team.md`
    keeps only rules common to both. Update `manager.md` wording from "HANDOFF blocks" to
    "delegate to the right role" so it fits both modes.
- **Platform:** Windows 11, localhost only.
- **Observed model behavior:** Gemini 3.8 Flash wandered during a test (ran `wmic`/PowerShell to
  read other processes' command lines). Tool allowlists per role are therefore mandatory; the
  thinking roles have no `bash`.

## 6. Decisions made with the user

- Roles may hand work to each other directly. Only important checkpoints go to the Manager.
- A checkpoint report must tell the Manager what was done before reaching it.
- The Manager decides the process; the Critic flow (proposal → Critic → revise ≤2 rounds →
  Manager presents with remaining Critic notes) is a guideline in the Manager's prompt, not code.
- All roles use Gemini 3.8 Flash tiered for now.
- Checkpoints: the Manager sets them per handoff; a few are always mandatory (see §8.3).
- Real-world actions (spend, send outside, delete) are always approved by the user, never by the
  Manager or any model.
- Decided by the designer (user may override): the Manager is event-driven and never blocks;
  task timeout and concurrency cap count only active model time; prompt rules split into
  `_team.md` / `_cli.md` / `_orchestrator.md`.

## 7. Architecture

One long-running Node process ("company server"), TypeScript run directly with Node 24's built-in
type stripping (no build step), using the pi SDK **in-process** (not RPC subprocesses).

Rationale: with the SDK, custom tools (`handoff`, `checkpoint`) execute inside the orchestrator,
so routing needs no IPC; events come straight from `session.subscribe()`.

```
client (CLI now, office UI later)
   │  HTTP (REST + Server-Sent Events), 127.0.0.1 only
company server
   ├─ WorkspaceStore   — workspaces, runs, tasks, JSONL logs under <workspace>/.company/
   ├─ RoleRegistry     — loads role library (shared module with role.mjs)
   ├─ SessionPool      — one pi AgentSession per (workspace, role), created lazily
   ├─ Router           — handoff / checkpoint tools, task graph, limits, cycle guard
   └─ EventBus         — normalizes pi events → TeamEvents → log file + SSE subscribers
```

### 7.1 Sessions

- One `AgentSession` per (workspace, role), created on first use with:
  `cwd` = workspace folder; `tools` = the role's allowlist; skills restricted to the role's list
  (via the resource loader; no global skill discovery); system prompt = assembled role prompt
  appended to pi's default; model = the default above; custom tools `handoff` and `checkpoint`
  registered for every role (Manager included).
- Session history persisted per role at `<workspace>/.company/sessions/<role>/`, so the same role
  keeps its memory across runs within that workspace (this is the "history per workspace").
- A role session processes one prompt at a time. Work arriving while it is busy is queued
  (FIFO) by the Router, not injected mid-turn.
- Concurrency: at most N sessions with an **active model call** at once (default 3; OmniRoute rate
  limits). A session blocked inside a `handoff` waiting for another role does not hold a slot.
  Others wait in queue.
- **The Manager never blocks.** Its `handoff` returns immediately with a task id (see §8.2).
  Task results, checkpoints, automatic checkpoints and user messages are all delivered to the
  Manager as new prompts through its queue (event-driven). This avoids the deadlock where a role
  waits for a Manager decision while the Manager waits for that role, and lets checkpoints and
  user messages reach the Manager while work is in flight.

## 8. Behavior

### 8.1 Runs and tasks

- A **run** starts when the user sends a message to the Manager and ends when the Manager's
  prompt settles with no open tasks (or the user stops it, or a limit trips).
- A **task** is one unit of delegated work: `{id, runId, parentTaskId, from, to, goal, inputs,
  expectedOutput, checkpoints[], status, depth, createdAt, endedAt, usage}`.
  Status: `queued → running → done | failed | cancelled`.
- The user's message to the Manager is the root task (`from: "user"`, `to: "manager"`).

### 8.2 `handoff` tool (all roles)

Parameters: `to` (role id), `goal`, `inputs` (text; may reference files), `expected_output`,
optional `checkpoints` (list of milestone descriptions the receiver must report to the Manager).

Semantics:
1. Router validates: target role exists; target is not the caller; target is not already
   waiting in the caller's chain (cycle → error returned to the caller: "<role> is waiting on you;
   return your result instead"); depth ≤ max depth.
2. Creates a child task, queues it on the target session with a prompt containing the goal,
   inputs, expected output, the requester, and any checkpoints.
3. **Blocking for non-Manager roles**: the tool call returns when the target's prompt settles,
   with the target's final answer as the tool result (plus task id). The caller then continues.
   **Non-blocking for the Manager**: returns `{taskId, status: "queued"}` at once; when the task
   finishes, its result is delivered to the Manager as a new prompt ("Task <id> from <role>
   finished: …"). A run ends when the Manager settles with no open tasks and no queued input.
   Cycle check: refuse a handoff whose target is (directly or transitively) waiting on the
   caller, considering all blocked tasks in the run, not only the caller's own chain.
4. If the model emits several `handoff` calls in one turn and pi executes tool calls
   concurrently, they run in parallel (subject to the concurrency cap). If pi runs them
   sequentially, that is acceptable for v1. Builder: verify which and note it.
5. Revision rounds between the same two roles within one run are counted; above the limit the
   Router refuses further handoffs between that pair and raises an automatic checkpoint.

Checkpoint requirements propagate: if a task carries checkpoints and the receiver hands parts of
it onward, the receiver remains responsible for reporting them.

### 8.3 Checkpoints

**Who reports:** any role, via the `checkpoint` tool.
Parameters: `title`, `summary` (what was done since the last checkpoint and why), `decisions`,
`open_issues`, `needs_decision` (bool).

**When:**
- Milestones the Manager listed in the handoff's `checkpoints`.
- Always mandatory (role prompts must say so — add to `_team.md`):
  1. before any action with real-world consequences (spending money, sending anything outside
     the workspace, deleting data) — must use `approval_required: true` (see "User approvals");
  2. when blocked, or when roles disagree and cannot resolve it.
- Automatic (raised by the Router itself, no model involved): round limit hit, depth limit hit,
  task timeout, token budget reached, task failure.

**What the Manager receives** (one message): the role's fields + an **automatic trail** compiled
from the event log for that task subtree since the previous checkpoint of the same task: handoffs
made (from → to, goal, result status), files written/edited (paths), bash commands run, errors,
token usage.

**Delivery and blocking:**
- `needs_decision: false` → delivered to the Manager (queued if busy); the tool returns
  immediately and the reporting role continues.
- `needs_decision: true` → the tool blocks until the Manager answers; the answer is the tool
  result. The Manager answers by calling the same mechanism in reverse (builder chooses: a
  `reply_checkpoint` tool, or the Manager's next reply addressed to that checkpoint id).
- If the Manager is itself the reporter, the checkpoint goes to the user (shown as a
  question/notice in the client).

**User approvals (decided with the user: the user always approves real-world actions).**
- `checkpoint` has an extra param `approval_required` (bool) plus `action` (exact description of
  what will be done: amount, recipient, target, content).
- With `approval_required: true` the Router sends the request **verbatim to the user**
  (`approval_request` event), and a copy to the Manager as an informational prompt. The Manager
  cannot approve it.
- The tool blocks until the user answers (approve / reject / edit-with-instructions) via
  `POST /checkpoints/:id/reply`. The wait has no time limit and does not count toward the task
  timeout or the concurrency cap. The answer is returned to the role as the tool result and
  logged as `checkpoint_reply`.
- Stopping the run while an approval is pending rejects it.

### 8.4 Manager ↔ user

- The user only sends messages to the Manager. The Manager's replies are shown to the user.
- If the Manager's reply arrives while tasks are still open, it is shown as a progress message.
- The user can send a message mid-run: it is queued to the Manager (delivered after its current
  turn). The user can stop a run: all sessions in the run are aborted, open tasks → `cancelled`.

### 8.5 Limits (defaults, configurable per workspace)

| Limit | Default | On trip |
|---|---|---|
| Max handoff depth | 4 | refuse + automatic checkpoint |
| Max rounds between the same pair per run | 3 | refuse + automatic checkpoint |
| Concurrent running sessions | 3 | queue |
| Task timeout | 20 min of the role's own active model time (excludes queue time, children, human waits) | abort task → `failed` + automatic checkpoint |
| Run token budget | 2,000,000 tokens | stop run + notify user |

## 9. Workspaces and storage

- A workspace = a folder on disk registered with the server (path + display name).
- Per workspace: `<workspace>/.company/`
  - `config.json` — active roles (subset of the library; default all), limit overrides.
  - `runs/<runId>.jsonl` — every TeamEvent of the run, append-only.
  - `runs/index.jsonl` — run summaries (id, started, ended, status, first user message, tokens).
  - `sessions/<role>/` — pi session files.
- The server keeps a small registry of known workspaces in its own data dir (not in `~/.claude`).
- `.company/` should be git-ignored by default in the workspace (write a `.gitignore` entry only
  if the workspace is a git repo and the user agrees — builder: ask nothing, just document it).

## 10. Events (the contract the UI will rely on)

`TeamEvent = { ts, seq, workspaceId, runId, taskId?, role?, type, data }`

| type | data |
|---|---|
| `run_started` / `run_finished` | status, reason, usage |
| `task_created` | from, to, goal, inputs, expectedOutput, checkpoints, parentTaskId, depth |
| `task_status` | status, reason |
| `message` | role's completed assistant text (final, not deltas) |
| `message_delta` | streaming text (SSE only, not persisted) |
| `tool_call` / `tool_result` | tool name, args (redacted), ok/error, short result preview |
| `checkpoint` | role fields + automatic trail + needs_decision + checkpoint id |
| `checkpoint_reply` | checkpoint id, answer, answered by (manager / user) |
| `approval_request` | checkpoint id, role, action (verbatim), summary, trail |
| `user_message` / `manager_reply` | text |
| `usage` | tokens in/out per model call |
| `limit_hit` / `error` | which limit / message |

Persist everything except `message_delta`. Redact obvious secrets (API-key-like strings,
`Authorization` values) from tool args/results before logging.

## 11. API (127.0.0.1 only)

- `GET /workspaces`, `POST /workspaces {path, name}`
- `GET /workspaces/:id/runs` — from `runs/index.jsonl`
- `GET /runs/:runId/events` — full replay
- `GET /events?workspace=:id` — Server-Sent Events, live TeamEvents
- `POST /workspaces/:id/messages {text}` — user → Manager (starts a run if none active)
- `POST /runs/:runId/stop`
- `GET /workspaces/:id/approvals` — pending approval requests
- `POST /checkpoints/:id/reply {decision: approve|reject|edit, note}` — user answers an approval
- `GET /roles` — roster from the library (for the UI's team view)

A minimal terminal client ships with v1 to chat with the Manager and tail events, so the engine
is usable and testable before the UI exists.

## 12. Safety

- Server binds to 127.0.0.1 only.
- Role tool allowlists come from the library and are enforced by pi's tool selection.
- Built-in tools run with `cwd` = workspace. `bash` can still escape the folder; v1 accepts this
  for builder roles and relies on the `_team.md` rules + the log. (Sandboxing is a later item.)
- Secrets live only in `D:\tools\pi-runtime\agent\`; never written to logs or prompts.

## 13. Verification

- Unit tests (Node's built-in test runner, fake sessions — no model calls) for the Router: cycle
  refusal, depth limit, pair-round limit, queueing per role, concurrency cap, checkpoint trail
  compilation, blocking vs non-blocking checkpoints, stop/cancel.
- One end-to-end smoke scenario against the real model: user asks the Manager for a small idea
  review → Manager hands to Brainstormer → Brainstormer hands to Critic → results flow back →
  Manager replies; the run log replays the full exchange including at least one checkpoint.

## 14. Left to the builder

Module/file layout, HTTP server implementation (Node `http` + SSE is enough), the exact mapping
from pi SDK events to TeamEvents, how the shared role-loading module is organized, the terminal
client's look, the exact Manager mechanism for answering a blocking checkpoint, and test fixture
design.
