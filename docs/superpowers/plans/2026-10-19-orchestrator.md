# Agent Company Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local server that runs the role library as pi SDK sessions, routes handoffs/checkpoints/approvals between them, logs every event per workspace, and exposes REST + SSE plus a terminal client.

**Architecture:** One Node 24 process runs TypeScript directly (type stripping). A `Router` owns runs, tasks, per-role queues, limits and checkpoints, and talks to roles only through a `RoleRunner` interface; `pi-runner.ts` implements it with pi `AgentSession`s, so the Router is fully testable with fake runners. `EventLog` persists TeamEvents as JSONL and fans them out to SSE.

**Tech Stack:** Node 24.21 portable (`D:\tools\pi-runtime\node`), TypeScript (erasable syntax only, run directly), `@earendil-works/pi-coding-agent@1.0.4`, `typebox@1.3.27`, `typescript` (type-check only), `node:test`, `node:http`.

**Spec:** `docs/superpowers/specs/2026-10-19-orchestrator-design.md`

## Global Constraints

- Always run with `D:\tools\pi-runtime\node\node.exe` / its `npm.cmd`; never the global Node 21, never touch `~/.claude`.
- `PI_CODING_AGENT_DIR=D:\tools\pi-runtime\agent`, `PI_TELEMETRY=0` for every process that loads pi.
- Model: provider `omniroute`, id `antigravity/gemini-3.8-flash-tiered`.
- Role library: `D:\tools\pi-runtime\library` (override with env `COMPANY_LIBRARY`).
- Server binds `127.0.0.1` only; default port `4317`.
- Limits defaults: maxDepth 4, maxPairRounds 3, maxConcurrent 3, taskTimeoutMs 1_200_000 (active model time only), runTokenBudget 2_000_000.
- TS must be erasable-only (no enums, no parameter properties, no namespaces); relative imports end in `.ts`.
- Real-world actions are approved only by the user; the Manager never approves them.
- Never persist `message_delta`; redact secrets before persisting or streaming.

## Review Focus

1. A role hands off to a role that is (transitively) waiting on it → must get an error result, never hang. (Task 3 test `refuses cyclic handoff across branches`.)
2. Two roles hand off to the same busy role at once → second waits in FIFO, both complete. (Task 3 test `queues work for a busy role`.)
3. User stops a run while an approval is pending and children are blocked → everything resolves, tasks `cancelled`, approval rejected, no dangling promise. (Task 4 test `stop rejects pending approval and cancels tasks`.)
4. A model emits a malformed/unknown `to` role or `to: "manager"` → tool returns a clear error text; nothing crashes. (Task 3 tests `rejects unknown role`, `rejects handoff to manager`.)
5. An API key appears in a bash command or tool output → stored log and SSE show `***`. (Task 2 test `redacts secrets`.)

---

### Task 1: Project scaffold + shared role module + prompt split

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `src/config.ts`
- Create: `D:\tools\pi-runtime\library\lib\roles.mjs`
- Modify: `D:\tools\pi-runtime\library\role.mjs` (use `lib/roles.mjs`)
- Create: `D:\tools\pi-runtime\library\roles\_cli.md`, `roles\_orchestrator.md`; Modify: `roles\_team.md`, `roles\manager.md`
- Test: `tests/roles.test.ts`

**Interfaces:**
- Produces (`lib/roles.mjs`): `roleIds(lib: string): string[]`; `loadRole(lib: string, id: string): {id, meta, body, persona, skills: string[], tools: string[]}`; `roleProblems(lib, role): string[]`; `assemblePrompt(lib: string, id: string, mode: "cli"|"orchestrator"): string` (persona + body + roster if `roster: true` + `_team.md` + `_cli.md` or `_orchestrator.md`).
- Produces (`src/config.ts`): `LIBRARY: string`, `AGENT_DIR: string`, `PROVIDER = "omniroute"`, `MODEL_ID = "antigravity/gemini-3.8-flash-tiered"`, `DEFAULT_LIMITS: Limits`, `PORT = 4317`, `DATA_DIR` (repo `data/`).

- [ ] **Step 1:** `package.json` (`"type": "module"`, deps `@earendil-works/pi-coding-agent@1.0.4`, `typebox@1.3.27`; devDep `typescript`; scripts `test: node --test tests/`, `check: tsc --noEmit`), `tsconfig.json` (`noEmit`, `allowImportingTsExtensions`, `erasableSyntaxOnly`, `strict`, `module/moduleResolution: nodenext`, `target: es2023`), `.gitignore` (`node_modules/`, `data/`). Install with `D:\tools\pi-runtime\node\npm.cmd install`.
- [ ] **Step 2:** Split prompts. `_team.md` keeps common rules minus the HANDOFF text block; `_cli.md` = the HANDOFF text-block convention; `_orchestrator.md` = use the `handoff` tool to delegate (never to `manager`; use `checkpoint`), use `checkpoint` for the milestones you were given and ALWAYS before real-world actions (`approval_required: true` + exact `action`) and when blocked/in disagreement; Manager-only: `reply_checkpoint` answers decision checkpoints, handoff results arrive later as messages. `manager.md`: "Delegate with HANDOFF blocks" → "Delegate to the right role".
- [ ] **Step 3: Failing tests** `tests/roles.test.ts`: `loads all 13 roles with no problems` (`roleIds(LIBRARY).length === 13`, every `roleProblems` empty); `orchestrator prompt mentions handoff tool, not HANDOFF block` (`assemblePrompt(LIBRARY,"developer","orchestrator")` includes `` `handoff` `` and not `HANDOFF →`); `cli prompt keeps HANDOFF block`; `manager prompt has roster` (includes `- critic —`).
- [ ] **Step 4:** Implement `lib/roles.mjs` by moving logic out of `role.mjs`; `role.mjs` imports it (mode `"cli"`). Run `node --test tests/roles.test.ts` → PASS; `role.cmd --check` → 13 ok.
- [ ] **Step 5:** Commit (repo) — library changes are outside the repo; note them in the commit message.

### Task 2: Types + EventLog

**Files:** Create `src/types.ts`, `src/event-log.ts`; Test `tests/event-log.test.ts`

**Interfaces:**
- `types.ts`: `TeamEventType` (union of spec §10 names), `TeamEvent {ts, seq, workspaceId, runId, taskId?, role?, type, data}`, `Task {id, runId, parentTaskId?, from, to, goal, inputs, expectedOutput, checkpoints: string[], status: "queued"|"running"|"done"|"failed"|"cancelled", depth, createdAt, endedAt?, result?, activeMs, tokens}`, `Limits {maxDepth, maxPairRounds, maxConcurrent, taskTimeoutMs, runTokenBudget}`, `HandoffArgs {to, goal, inputs, expected_output, checkpoints?}`, `CheckpointArgs {title, summary, decisions?, open_issues?, needs_decision?, approval_required?, action?}`, `Trail {handoffs: {from,to,goal,status}[], files: string[], commands: string[], errors: string[], tokens: number}`.
- `event-log.ts`: `class EventLog { constructor(runsDir: string, workspaceId: string); emit(e: {runId, type, taskId?, role?, data}): TeamEvent; subscribe(fn): () => void; eventsOf(runId): TeamEvent[] }`; `readRun(runsDir, runId): TeamEvent[]`; `redact<T>(v: T): T`; `compileTrail(events: TeamEvent[], taskIds: Set<string>, sinceSeq: number): Trail`.

- [ ] **Step 1: Failing tests:** `persists events except message_delta` (emit 2 + 1 delta → `readRun` length 2, seq increasing); `subscribers receive deltas`; `redacts secrets` (data `{cmd:"curl -H 'Authorization: Bearer sk-abc123def456'", apiKey:"x"}` → persisted string contains no `sk-abc123def456`, `apiKey` is `"***"`); `compileTrail collects handoffs, files, commands, tokens since seq` (events: task_created, tool_call write {path:"a.ts"}, tool_call bash {command:"npm test"}, usage {tokens:10}, error → trail fields; events before `sinceSeq` and of other tasks excluded).
- [ ] **Step 2:** Implement. JSONL path `<runsDir>/<runId>.jsonl`, `appendFileSync`. Redaction: `/sk-[A-Za-z0-9_-]{8,}/g`, `/AIza[0-9A-Za-z_-]{20,}/g`, `/(Bearer\s+)[^\s'"]+/gi`, and object keys matching `/^(api[_-]?key|authorization|token|password|secret)$/i` → `"***"`.
- [ ] **Step 3:** `node --test tests/event-log.test.ts` → PASS. Commit.

### Task 3: Router core — runs, queues, concurrency, handoff

**Files:** Create `src/router.ts`, `tests/helpers/fake-runner.ts`; Test `tests/router.test.ts`

**Interfaces:**
- Consumes: Task 2 types, `EventLog`.
- `RoleRunner { run(text: string): Promise<string>; abort(): Promise<void>; dispose(): void }`
- `RunnerFactory = (role: string, hooks: { emit(type: TeamEventType, data: object): void }) => Promise<RoleRunner>` — `hooks.emit` attaches runId/taskId/role of the work currently running on that role; `usage` events with `data.tokens` count toward task/run tokens.
- `class Router { constructor(o: {workspaceId, roles: string[], limits: Limits, log: EventLog, createRunner: RunnerFactory, onRunFinished?(runId, status, usage)}); sendUserMessage(text): {runId}; handoff(role: string, a: HandoffArgs): Promise<string>; stopRun(runId): Promise<void>; activeRunId(): string|undefined; whenIdle(): Promise<void>; tasks(runId): Task[] }`
- Fake runner (`tests/helpers/fake-runner.ts`): `fakeFactory(script: (role, text, router) => Promise<string>)`.

Semantics (from spec §7.1, §8.1, §8.2, §8.5):
- Per-role FIFO queue; a role runs one item at a time; a global semaphore of `maxConcurrent` is held only while a runner's model call is active. `handoff` (and later blocking checkpoints) must release the caller's slot while waiting and re-acquire after — expose internal `waitReleasing(role, promise)`.
- User message → emit `user_message {text}`, root task `{from:"user", to:"manager", depth:0}`; starts a run if none active (`run_started`), else queues to the manager.
- Every completed manager work item emits `manager_reply {text}` (what the user sees).
- Every task state change emits `task_created` / `task_status`; every handoff result is stored on the task (`result`).
- Manager `handoff` → returns immediately `"Task <id> queued for <to>"`; on completion enqueue to manager: `"Task <id> from <to> finished (<status>):\n<result>"`.
- Other roles' `handoff` → resolves with the child's final text: `"Result from <to> (task <id>):\n<text>"`.
- Refusals return text starting `"ERROR:"` and emit `limit_hit` or `error`: unknown role; `to === caller`; `to === "manager"` ("use checkpoint"); cycle (target transitively waiting on caller, across all waits in the run); depth > maxDepth; pair (unordered) handoff count in run > maxPairRounds.
- Run finishes when manager idle, no open tasks, empty queues → `run_finished {status:"done", usage}`; `onRunFinished` called.
- `stopRun`: abort running runners, clear queues, mark open tasks `cancelled`, resolve every waiting handoff with `"ERROR: run stopped"`, emit `run_finished {status:"stopped"}`.

- [ ] **Step 1: Failing tests:** `user message runs manager and finishes run`; `manager handoff is non-blocking and result returns to manager`; `peer handoff blocks and returns child result`; `queues work for a busy role` (two parallel handoffs to `critic`, max 1 running, both results returned); `respects maxConcurrent` (3 parallel, limit 2 → peak active 2); `blocked caller releases its slot` (limit 1: dev → reviewer chain completes, no deadlock); `rejects unknown role`; `rejects handoff to manager`; `rejects self handoff`; `refuses cyclic handoff across branches` (a→b, b→a returns ERROR); `enforces maxDepth`; `enforces pair rounds`; `stopRun cancels and unblocks`.
- [ ] **Step 2:** Implement until green (`node --test tests/router.test.ts`). Commit.

### Task 4: Checkpoints, approvals, timeouts, budget

**Files:** Modify `src/router.ts`; Test `tests/checkpoints.test.ts`

**Interfaces:**
- `Router.checkpoint(role: string, a: CheckpointArgs): Promise<string>`; `Router.replyCheckpoint(id: string, answer: string): string`; `Router.replyApproval(id: string, decision: "approve"|"reject"|"edit", note?: string): void`; `Router.pendingApprovals(): {id, runId, role, action, summary, title, createdAt}[]`.

Semantics (spec §8.3, §8.5):
- Trail = `compileTrail(eventsOf(run), <reporter task + descendants>, <seq of previous checkpoint of that task or 0>)`.
- Non-manager, plain → emit `checkpoint`, enqueue to manager `"CHECKPOINT <id> from <role>: <title>\n<summary>…\nTrail: …"`, return `"Checkpoint <id> delivered to manager."`.
- `needs_decision` → as above + "(reply with reply_checkpoint)"; block (releasing slot, pausing timeout) until `replyCheckpoint`; return `"Manager decision: <answer>"`; emit `checkpoint_reply {by:"manager"}`.
- `approval_required` → emit `approval_request`; enqueue informational copy to manager ("approval pending with the user; you cannot approve it"); block until `replyApproval`; return `"User decision: <decision>. <note>"`; emit `checkpoint_reply {by:"user"}`. Missing `action` → `"ERROR: approval_required needs an exact action"`.
- Reporter is manager → emit `checkpoint` to user, return immediately.
- Automatic checkpoints (no model): on each refusal for depth/pair limits, task timeout, task failure → enqueue to manager with trail, emit `checkpoint {automatic:true}`.
- Timeout: per task, accumulate active time only while the runner holds a slot; exceeding `taskTimeoutMs` → `abort()`, task `failed`, automatic checkpoint.
- Budget: run tokens ≥ `runTokenBudget` → `stopRun` with status `"budget_exceeded"` + `limit_hit`.
- `stopRun` also rejects pending approvals/decisions.

- [ ] **Step 1: Failing tests:** `plain checkpoint reaches manager with trail`; `decision checkpoint blocks until manager replies`; `approval goes to user, not manager` (manager calling `replyApproval` impossible — only the API path; assert `pendingApprovals()` length 1 and manager prompt text contains "cannot approve"); `approval requires action`; `stop rejects pending approval and cancels tasks`; `task timeout counts active time only` (fake clock: child waits 10 min blocked, active 1 min, limit 5 min → no timeout); `timeout aborts and reports`; `budget stops run`.
- [ ] **Step 2:** Implement (inject `now(): number` into Router options for tests). Green. Commit.

### Task 5: pi runner + tools

**Files:** Create `src/pi-runner.ts`, `src/tools.ts`; Test `tests/pi-runner.test.ts`

**Interfaces:**
- `makeTools(role: string, router: Router): ToolDefinition[]` — `handoff`, `checkpoint` for all; `reply_checkpoint {checkpoint_id, answer}` for `manager`. TypeBox schemas mirror `HandoffArgs`/`CheckpointArgs`. `execute` returns `{content:[{type:"text", text}], details:{}}`.
- `mapPiEvent(e: any): {type: TeamEventType, data: object} | null` — `message_update` text_delta → `message_delta {delta}`; `message_end` assistant → `message {text}` and, if usage present, a second call path emits `usage {tokens: usage.totalTokens, input, output}` (return an array: signature `mapPiEvent(e): Array<{type, data}>`); `tool_execution_start` (except handoff/checkpoint/reply_checkpoint) → `tool_call {tool, args}`; `tool_execution_end` → `tool_result {tool, ok: !isError, preview: first 300 chars}`.
- `createPiRunnerFactory(o: {workspacePath: string, router: () => Router}): RunnerFactory` — per role: `DefaultResourceLoader({cwd, agentDir: AGENT_DIR, noSkills: true, additionalSkillPaths: <role skill dirs>, appendSystemPrompt: [assemblePrompt(LIBRARY, role, "orchestrator")]})` (if `noSkills` also drops additional paths, use `skillsOverride` to keep only the role's skills — verify with the test below); `createAgentSession({cwd, agentDir, modelRuntime, model, tools: [...role.tools, "handoff","checkpoint", ...(manager? ["reply_checkpoint"]:[])], customTools: makeTools(...), resourceLoader, sessionManager: SessionManager.continueRecent(cwd, <ws>/.company/sessions/<role>)})`; `run(text)` = `prompt(text)` then `getLastAssistantText() ?? ""`; subscribe → `mapPiEvent` → `hooks.emit`.

- [ ] **Step 1: Failing tests:** `maps text delta, message, usage, tool events` (fixtures copied from pi docs json.md); `skips orchestration tools in tool_call`; `role session gets only its skills and tools` (create a real session for `critic` without prompting; assert active tool names = `read,grep,find,ls,handoff,checkpoint` and loaded skill names = critic's 6) — no model call.
- [ ] **Step 2:** Implement. Green. `npm run check` clean. Commit.

### Task 6: Workspace store

**Files:** Create `src/workspace.ts`; Test `tests/workspace.test.ts`

**Interfaces:** `class WorkspaceStore { constructor(dataDir); list(): Workspace[]; add(path, name?): Workspace (idempotent by resolved path; id = slug of name + 6-char hash of path; creates <path>/.company/{runs,sessions}); get(id): Workspace|undefined; config(ws): {roles: string[], limits: Limits} (from .company/config.json merged over all roles + DEFAULT_LIMITS); appendRun(ws, entry: RunIndexEntry); runs(ws): RunIndexEntry[] }`; `RunIndexEntry {runId, startedAt, endedAt?, status, firstMessage, tokens}`.

- [ ] **Step 1: Failing tests:** `add is idempotent`; `config merges defaults`; `run index round-trips`; `rejects missing folder`.
- [ ] **Step 2:** Implement (registry file `<dataDir>/workspaces.json`). Green. Commit.

### Task 7: HTTP server + SSE + terminal client

**Files:** Create `src/server.ts`, `src/cli.ts`, `company.cmd`, `company-cli.cmd`; Test `tests/server.test.ts`

**Interfaces:**
- `startServer(o: {port?: number, dataDir?: string, createRunner?: (ws) => RunnerFactory}): Promise<{url: string, close(): Promise<void>}>` — one `Router` + `EventLog` per workspace (lazy); endpoints exactly as spec §11; SSE frames `data: <json>\n\n`, heartbeat comment every 15 s; JSON errors `{error}` with 400/404.
- `cli.ts <workspace-path>`: registers the workspace, subscribes to SSE, prints one line per event (`[role] type: summary`, message text in full), reads stdin lines → `POST messages`; commands `/stop`, `/approve <id> [note]`, `/reject <id> [note]`, `/edit <id> <note>`, `/approvals`, `/quit`.
- `company.cmd` / `company-cli.cmd`: set `PATH` to portable node, `PI_CODING_AGENT_DIR`, `PI_TELEMETRY=0`, run `node src/server.ts` / `node src/cli.ts %*`.

- [ ] **Step 1: Failing tests** (fake runners via `createRunner`): `registers workspace and lists it`; `message starts run and SSE streams events`; `replays run events`; `approval reply endpoint resolves pending approval`; `stop endpoint stops run`; `binds 127.0.0.1`.
- [ ] **Step 2:** Implement. Green. Commit.

### Task 8: End-to-end smoke with the real model

**Files:** Create `tests/e2e/smoke.ts` (not part of `npm test`), `README.md`

- [ ] **Step 1:** `smoke.ts` starts the server, registers a temp workspace, sends: "Có ý tưởng: app nhắc uống nước cho dân văn phòng. Hãy nhờ Brainstormer mở rộng ý tưởng, Brainstormer nhờ Critic phản biện, rồi tóm tắt cho tôi." Waits for `run_finished` (timeout 10 min), then asserts from the replayed log: a `task_created` to `brainstormer`, a `task_created` from `brainstormer` to `critic`, at least one `message` from each of manager/brainstormer/critic, a final `manager_reply`, no `error` events, status `done`.
- [ ] **Step 2:** Run `company.cmd`-equivalent env: `node tests/e2e/smoke.ts`. Fix issues until it passes. Then a manual run through `company-cli.cmd` with one checkpoint observed.
- [ ] **Step 3:** README: what it is, start server, CLI usage, API table, where logs live, limits, safety notes. Commit.
