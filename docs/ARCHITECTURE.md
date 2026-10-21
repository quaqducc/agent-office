# Agent Company — architecture and codebase guide

This document is for developers who take over or contribute to the codebase. It explains what the
system does, how the pieces fit together, where each responsibility lives, and the rules the code
follows. Read [README.md](../README.md) first for what users see. Read this document before
changing code.

Status: v0.1.0. It is packaged for npm (`@quaqducc/agent-company`) and GitHub, and CI runs on
Ubuntu, Windows and macOS with Node 22.19 and 24.

---

## 1. What the system is

Agent Company is a local web app. A small team of AI **roles** works on a project folder (a
**workspace**):
- The user talks only to the **Manager** role.
- The Manager delegates to other roles: Researcher, Developer, Critic, and roles installed from the
  role store.
- Roles hand work to each other, report **checkpoints**, and must get the **user's approval**
  before real-world actions (spending money, sending things outside, deleting).
- Everything that happens is an event. Each event is logged per workspace and streamed to a 2D
  pixel-office UI.

Each role is an agent session of the [pi](https://github.com/earendil-works/pi) coding-agent SDK
(`@earendil-works/pi-coding-agent` 1.0.4). Agent Company adds:
- the **Router**: the team, task queues, limits and approvals;
- the **role library** (prompts, personas, skills);
- the **tools** roles use to coordinate;
- a **guard** on every tool call;
- the **HTTP/SSE server**;
- the **office UI**;
- the **settings** (bring your own model API) and the **role store**.

---

## 2. Tech stack and hard constraints

| Area | Choice | Notes |
|---|---|---|
| Runtime | Node.js **≥ 22.19** | Runs `.ts` files directly through Node's type stripping. Only *erasable* TypeScript is allowed (`erasableSyntaxOnly`): no enums, no namespaces, no parameter properties. |
| Language | TypeScript (server), plain ES modules (UI) | The UI has no build step and no framework; the browser loads `ui/js/*.js` as they are. |
| Agent SDK | `@earendil-works/*` **pinned to 1.0.4** | All 8 sibling packages are direct dependencies at an exact version. npm `overrides` do not apply when the app is installed as a package. |
| Other deps | `marked` (Markdown in the UI), `typebox` (tool schemas) | Keep the dependency list this small. |
| Package build | `tsc -p tsconfig.build.json` → `dist/` | Node refuses to strip types inside `node_modules`, so the published package ships compiled JS. In a git checkout, `bin/agent-company.js` runs `src/` directly. |
| Tests | `node:test` + `node:assert` | No test framework. `npm test` makes no model calls. |
| Line endings | LF everywhere (`.gitattributes`) | The role store checks file bytes with SHA-256, so every OS must see identical bytes. |

---

## 3. Repository layout

```
bin/agent-company.js       CLI entry: Node version check, then dist/main.js (installed) or src/main.ts (checkout)
src/
  main.ts                  commands: start | doctor | chat | import | --version | --help  (parseArgs is unit-tested)
  server.ts                HTTP API + SSE + static UI; one Router per workspace ("context")
  router.ts                the orchestrator: runs, tasks, per-role queues, handoff/checkpoint/approval, limits
  pi-runner.ts             builds a pi session per role (model, tools, prompt, guard hook); maps pi events → TeamEvents
  tools.ts                 custom tools given to roles: handoff, checkpoint, reply_checkpoint, internet_search, web_fetch
  guard.ts                 allow/deny for every tool call (paths, secrets, shell commands)
  web.ts                   web_fetch (SSRF-checked) and internet_search backends (endpoint search / SearXNG)
  settings.ts              ~/.agent-company/config.json: providers, models, search; pi models.json generation
  providers.ts             talk to a provider directly: list models, one-shot connection test
  store.ts                 role store: catalog resolution, verified install/update/uninstall
  library.ts               role library API over the multi-root loader (library/lib/roles.mjs)
  workspace.ts             registered workspaces, per-workspace config, run index
  event-log.ts             append-only JSONL run logs with secret redaction; "trail" summaries
  home.ts                  app home paths (~/.agent-company or AGENT_COMPANY_HOME)
  config.ts                package paths, version, PORT, default limits
  types.ts                 shared types: TeamEvent, Task, Limits, tool argument shapes
  cli.ts                   terminal client used by `agent-company chat`
library/                   shipped in the npm package
  roles/*.md               base roles: manager, researcher, developer, critic
  roles/_*.md              prompt fragments: _team (all roles), _orchestrator, _orchestrator_manager, _cli
  personas/                persona texts referenced by roles
  skills/<name>/SKILL.md   skills the base roles use (each has a .source file naming its origin)
  licenses/                licenses of the vendored third-party content
  lib/roles.mjs            role loader / prompt assembler (plain JS so other tools can share it)
catalog/                   role store content, served from GitHub (NOT packed, except index.json)
  roles/, personas/, skills/, licenses/
  index.json               every file with sha256 + size; built by scripts/build-catalog.mjs
ui/
  index.html, styles.css   single page; tokens for light/dark at the top of styles.css
  js/app.js                wiring: workspaces, SSE, replay, menus, dialogs
  js/state.js              pure reducer: TeamEvents → office state (live and replay share it)
  js/derive.js             pure derived views: overview strip, live links, activity feed
  js/office.js, scene.js, layout.js, sprites.js   pixel office rendering
  js/panels.js             chat, task flow, log, approvals, role drawer
  js/settings.js           first-run setup + settings dialog (pure helpers are unit-tested)
  js/store.js              role store dialog
  js/api.js                thin fetch/SSE client;  markdown.js  safe Markdown;  util.js, icons.js
scripts/
  build-catalog.mjs        regenerate / --check catalog/index.json
  pack-check.mjs           fail if the npm tarball would contain secrets, local data or author paths
  pack-smoke.mjs           pack → install into a temp prefix → run --version, doctor, start, fetch UI
tests/                     unit tests (*.test.ts), helpers/ (fake runner, fake provider), e2e/ (real model)
docs/superpowers/          design specs and implementation plans (history of decisions)
.github/workflows/         ci.yml (3 OS × 2 Node), release.yml (npm publish on v* tags)
install.sh, install.ps1    one-line installers (check Node, then npm i -g)
```

---

## 4. Runtime architecture

```
 Browser (ui/)                         agent-company process (127.0.0.1:4317)
 ┌──────────────┐  HTTP JSON   ┌──────────────────────────────────────────────────────────┐
 │ office UI    │ ───────────► │ server.ts                                                 │
 │ settings     │ ◄─────────── │  ├─ settings / store / roles / workspaces routes          │
 │ role store   │  SSE events  │  └─ per workspace: Ctx { Router, EventLog }               │
 └──────────────┘              │        Router (router.ts)                                 │
                               │          ├─ queue + RoleRunner per role ──► pi session    │
                               │          │     (pi-runner.ts)                ├─ tools.ts  │
                               │          │                                   ├─ guard.ts  │
                               │          │                                   └─ model API │──► provider (OpenAI-compatible /
                               │          └─ emits TeamEvents ──► EventLog ──► SSE          │    Anthropic / Gemini, or a gateway
                               └──────────────────────────────────────────────────────────┘    such as OmniRoute / OpenRouter)
   files: ~/.agent-company/ (settings, keys, installed roles)   <workspace>/.company/ (run logs, sessions)
```

### 4.1 A run, end to end

1. **User message.** The UI sends `POST /workspaces/:id/messages`. Then
   `Router.sendUserMessage` runs:
   - with no active run, it starts one: a `runId` and a root task `user → manager`, and emits
     `run_started`, `user_message` and `task_created`;
   - during an active run, the message is queued to the Manager as a follow-up.
2. **Queues.** Every role has a FIFO queue of work items. A role processes one item at a time. A
   global `maxConcurrent` limits how many roles talk to the model at once.
3. **Runners.** The Router gets a `RoleRunner` for the role from the `RunnerFactory`.
   - In production this is `createPiRunnerFactory` (in `pi-runner.ts`).
   - Unit tests inject `tests/helpers/fake-runner.ts`.
   - The pi session is built lazily on the first `run()` and rebuilt when the role's model or the
     provider settings change. Its conversation history persists in
     `<workspace>/.company/sessions/<role>/`.
4. **Delegation: the `handoff` tool.** The Router checks:
   - the target role exists, and it is not the caller and not `manager`;
   - `maxDepth`, `maxPairRounds`, and wait cycles (A waits on B, and B tries to hand back to A).

   Then:
   - **Manager → role** is non-blocking. The tool returns "queued", and the result arrives later as
     a message to the Manager.
   - **Role → role** is blocking. The caller's tool call waits for the result. While waiting, the
     caller releases its concurrency slot (`waitReleasing`).
5. **Checkpoints: the `checkpoint` tool.**
   - A plain checkpoint is a progress report to the Manager.
   - `needs_decision` blocks until the Manager answers with `reply_checkpoint`.
   - `approval_required` (with an exact `action`) blocks until **the user** answers through
     `POST /checkpoints/:id/reply`. The Manager cannot approve.
6. **Limits** (in `types.ts`, defaults in `config.ts`, override per workspace in
   `<workspace>/.company/config.json`):
   - `maxDepth`, `maxPairRounds`, `maxConcurrent`;
   - `taskTimeoutMs`, which counts active model time only;
   - `runTokenBudget` and `maxTaskTokens`, unlimited by default.

   Hitting a limit emits `limit_hit`, plus an automatic checkpoint for non-Manager roles.
7. **End of run.** The run finishes when no role has queued or running work for it. It also ends
   when it is stopped or goes over budget. Then `run_finished` is emitted and `onRunFinished`
   appends a summary to `runs/index.json`.
8. **Events.** Every step is a `TeamEvent` (`types.ts`): `{ts, seq, workspaceId, runId, taskId?,
   role?, type, data}`. `EventLog` redacts secrets, appends the event to
   `.company/runs/<runId>.jsonl`, and notifies subscribers. The server forwards events over SSE
   (`GET /events?workspace=`). The UI reduces them with `state.js`. Replay feeds a stored JSONL
   through the same reducer.

### 4.2 Server contexts

`server.ts` keeps one context per workspace (`ctxFor`), holding a Router, an EventLog and the role
list it was built with. Contexts are built on demand. When roles are installed or removed, an idle
context is rebuilt with the new team. A context with an active run keeps its team until the run
ends.

---

## 5. Roles, prompts and the library

### 5.1 Role file format (`roles/<id>.md`)

```markdown
---
name: Senior Developer
description: Implements features and fixes with tests, minimal focused changes.
owns: Code, scripts, bots, bug fixes            # one line; becomes a row of the Manager's ownership table
persona: personas/engineering-minimal-change-engineer.md
tools: read,grep,find,ls,write,edit,bash,internet_search,web_fetch
skills: test-driven-development, systematic-debugging
roster: true                                    # Manager only: also gets the team roster
---
## Your focus in this team
...role-specific instructions...
```

The frontmatter parser is deliberately minimal (one `key: value` per line). See `roles.mjs`.

- **Tools.** The role file lists the tools the role may use: the pi built-ins
  (`read, grep, find, ls, write, edit, bash`) plus `internet_search` and `web_fetch`.
  Orchestration tools (`handoff`, `checkpoint`, and `reply_checkpoint` for the Manager) are always
  enabled.
- **Thinking roles.** Manager, Researcher and Critic have no `write`, `edit` or `bash`.

### 5.2 Library roots and prompt assembly

`library/lib/roles.mjs` loads roles from several **roots**, highest priority first:
`[~/.agent-company/library, <package>/library]`.

- **Role files.** The first root that has `roles/<id>.md` wins, so the app home can hold store
  installs and user overrides. A role's persona is resolved in the same root as its role file.
- **Prompt fragments.** The `_*.md` files always come from the package (the last root).
- **Assembly.** `assemblePrompt(id, "orchestrator")` builds each role's system-prompt addendum, in
  this order:
  1. persona;
  2. role body, with `{{OWNERSHIP_TABLE}}` replaced by the `owns` lines of the installed roles;
  3. roster (Manager only);
  4. `_team.md`;
  5. `_orchestrator.md`, plus `_orchestrator_manager.md` for the Manager.

  The `cli` mode uses `_cli.md` instead (text HANDOFF blocks for standalone pi).
- **Skills.** Each role's skills are passed to pi as `additionalSkillPaths`. pi's own skill
  discovery is off (`noSkills`), so only declared skills load.

### 5.3 Role store (`store.ts`, `catalog/`)

- **Catalog.** `catalog/` holds 10 extra roles and their skills. `scripts/build-catalog.mjs` writes
  `catalog/index.json` with the files, sha256, sizes, sources and licenses of every role and skill.
- **Where files come from.**
  - In a git checkout, the local `catalog/` is used.
  - In an installed package, the trusted `index.json` is shipped inside the package, and files
    are downloaded from `raw.githubusercontent.com/quaqducc/agent-company/v<version>/catalog/`.
  - The `main` branch is used only when that tag returns 404. A network error does not switch to
    `main`.
- **Install** (`installRole`):
  - validates the role and skill names and requires each file path to belong to its role or skill;
  - downloads into `library/.staging-<uuid>`, verifies every sha256, then moves the files into
    `~/.agent-company/library`;
  - records the role in `library/installed.json` as `{sha256, ref, digest, files, skills}`.
- **Update.** "Update available" compares a digest over every file the role brings. An update
  re-downloads the skills the store installed for that role.
- **Uninstall.** Removes the role file, plus the personas and skills the store installed that no
  remaining role uses. Base roles return 409. Server-side, the role's per-role model choice is
  dropped as well.
- **Adding a store role:**
  1. add files under `catalog/` (roles/, personas/, skills/<name>/ with a `.source`);
  2. run `npm run catalog`;
  3. commit `index.json`;
  4. add the source to `THIRD_PARTY_NOTICES.md`.

  Base roles in `library/` need no index.

---

## 6. Settings, providers and models

`~/.agent-company/config.json` (type `AppConfig` in `settings.ts`):

```jsonc
{
  "providers": [{ "id": "openrouter", "name": "OpenRouter", "api": "openai-completions",   // | anthropic-messages | google-generative-ai
                  "baseUrl": "https://openrouter.ai/api/v1", "apiKey": "sk-…", "search": "openrouter-online" }],
  "defaultModel": { "provider": "openrouter", "model": "…" },
  "roleModels":   { "developer": { "provider": "…", "model": "…" } },
  "search":       { "mode": "auto", "searxngUrl": "http://localhost:8888" },             // auto | endpoint | searxng | off
  "port": 4317
}
```

- **Writing and reading the file.** It is written atomically with mode 0600 on POSIX. A file that
  cannot be parsed raises an error that names the file.
- **What the browser sees.**
  - `publicConfig` masks keys before any API response.
  - `mergeConfig` applies UI edits. A masked or empty key keeps the stored key **only** if the
    provider id, the endpoint origin and the API type are unchanged, so a stored key is never sent
    to a different server.
  - Native Gemini base URLs get `/v1beta` appended.
- **Model resolution** (`pi-runner.ts` → `resolveModel`):
  1. `modelFor(cfg, role)` picks the per-role model or the default model.
  2. `piModelsJson` regenerates `~/.agent-company/pi/models.json`. It lists only the models in
     use, and keyless local providers get the placeholder key `"none"`.
  3. A pi `ModelRuntime` is cached per content hash.

  Without a model, `NoModelError` is raised, and the UI shows the setup screen
  (`GET /health` → `configured: false`).
- **`providers.ts`** lists models and runs a tiny completion as a connection test against the
  OpenAI, Anthropic or Gemini APIs. Its errors are user-facing Vietnamese strings.
- **Environment.** `PI_CODING_AGENT_DIR` is set to `~/.agent-company/pi` and `PI_TELEMETRY` to `0`
  (`config.ts`), so the app never touches a user's own pi setup.

---

## 7. Web research tools (`tools.ts`, `web.ts`)

- **`internet_search`.** Its backend comes from `searchBackend(cfg)`:
  - `google_search`: a function named `google_search` sent through a gateway that maps it to Gemini
    grounding (OmniRoute);
  - `openrouter-online`: the `:online` model variant;
  - `searxng`: the JSON API of a SearXNG instance;
  - `none`.

  `auto` uses the endpoint's own search capability and falls back to SearXNG.
- **Why the tool is not called `web_search`.** It was renamed from `web_search` because the
  OmniRoute/Antigravity route never delivers a function with that name to the model, and Anthropic
  and OpenAI reserve the name for their server tools. Role files that still list `web_search` are
  mapped to the new name in `buildRoleSession`.
- **`web_fetch`.**
  - It fetches public http(s) pages only. `checkUrl` blocks private and loopback targets (SSRF)
    and is re-checked on redirects. HTML is converted to text and the size is capped.
  - Before the first search in a prompt, fetching a URL fails with "search first", unless the URL
    appeared in the task. This stops the model from "confirming" its own guesses.
  - A fetch of a search-engine result page (DuckDuckGo, Google, Bing, Brave) runs the configured
    `internet_search` instead.

---

## 8. Security model

| Layer | Where | What it does |
|---|---|---|
| Tool guard | `guard.ts`, pi `tool_call` hook in `pi-runner.ts` | Read tools may read anywhere **except secrets**: `.env*`, key files, `.ssh`, `.aws`, `.claude`, `.gnupg`, `.docker`, the app home, `.company/`. Symlinks are resolved and globs are checked. `grep` over the home folder is refused. Writes and shell commands stay inside the workspace. The shell check also blocks `~`, `$HOME`, `%USERPROFILE%`, bare `cd`, env dumps, `..` and absolute paths outside the workspace (device files like `/dev/null` are allowed). |
| Approvals | `router.ts` | `approval_required` checkpoints can only be answered by the user's API call. The Manager is told it cannot approve. |
| Local server | `server.ts` | Binds to 127.0.0.1 only. Rejects foreign `Host` headers (DNS rebinding) and browser `Origin`s not listed in `COMPANY_ALLOWED_ORIGINS`. POST, PUT and DELETE must be `application/json`. Sends CSP, `X-Frame-Options: DENY` and `nosniff`. |
| Secrets at rest | `settings.ts`, `event-log.ts` | Keys exist only in `config.json` (0600 on POSIX) and the generated `pi/models.json`. Run logs redact key-like strings and fields named like keys. |
| Store integrity | `store.ts` | Hashes come from the package's own `index.json`. Install is staged and verified before anything moves. Names and paths are validated. |
| Release hygiene | `scripts/pack-check.mjs` | Fails if the tarball would contain `.env`, `models.json`/`auth.json`, `data/`, `.company/`, tests, catalog files, key-like strings or the author's local paths. |

The guard is defense in depth, **not a sandbox** (`ponytail:` note in `guard.ts`). A builder
role's `bash` can still escape with enough creativity. Untrusted work belongs in a container or VM;
a per-role sandbox is the planned upgrade.

---

## 9. HTTP API (127.0.0.1)

| Method & path | Purpose |
|---|---|
| `GET /health` | `{version, configured}`; the UI shows the setup screen when `configured` is false |
| `GET /settings` · `PUT /settings` | read (keys masked) / save settings (validated; 400 with reasons) |
| `POST /settings/providers/models` `{provider}` | list a provider's models (`{models, error?}`) |
| `POST /settings/providers/test` `{provider, model}` | one-shot completion (`{ok, ms, reply}` or `{ok:false, error}`) |
| `GET /store` | base + catalog roles with `installed` (`"base"` \| `"store"` \| `false`) and `updateAvailable` |
| `POST /store/roles/:id/install` · `DELETE /store/roles/:id` | install or update / uninstall a store role |
| `GET /roles` | installed roles (`id, name, description, owns`) |
| `GET /fs/drives` | list drive roots (`{roots, home}`) |
| `POST /fs/browse` `{path?}` | browse folders only (`{current, parent, home, roots, folders, error?}`) |
| `GET /offices` | preset office templates (`startup-mvp`, `software-house`, `content-marketing`, `research-lab`) |
| `GET /workspaces` · `POST /workspaces {path, name?}` | list / register a workspace |
| `PATCH /workspaces/:id {name}` | rename a workspace |
| `GET /workspaces/:id/config` · `/runs` · `/approvals` | team + limits / run history / pending approvals |
| `PUT /workspaces/:id/config` `{template?, roles?, rooms?, limits?}` | update workspace roles, template, and rooms (validates installed roles; rebuilds router context when idle) |
| `POST /workspaces/:id/messages {text}` | message the Manager (starts or joins a run) |
| `GET /runs/:runId/events` · `POST /runs/:runId/stop` | full event log of a run / stop a run |
| `POST /checkpoints/:id/reply {decision: approve\|reject\|edit, note}` | the user's answer to an approval |
| `GET /events?workspace=:id` | live Server-Sent Events (TeamEvents) |
| `GET /`, `/ui/*`, `/vendor/marked.js` | the UI |

---

## 10. UI architecture (`ui/`)

- **No build step.** `index.html` loads `js/app.js` as an ES module, and the CSP allows only
  same-origin scripts. Fonts come from Google Fonts; a Docker image may later add them as a layer.
- **Data flow.**
  1. `api.js` fetches the run history and subscribes to SSE.
  2. `state.js` (a pure reducer) turns events into state.
  3. `derive.js` computes views.
  4. `office.js`, `panels.js` and `scene.js` render.

  Live mode and replay use the same reducer. `app.js` guards async races with a generation counter
  (`app.gen`).
- **Testing.** The pure modules (`state`, `derive`, `markdown`, `settings` helpers, `office`
  layout) are unit-tested under Node in `tests/ui-*.test.ts`. The DOM code is verified in a browser.
- **Office customization & dynamic rooms (`layout.js`, `scene.js`, `office-dialog.js`).**
  Workspaces support dynamic 1–6 room configurations and role assignments stored in `<workspace>/.company/config.json`.
  Users can pick from preset templates (`/offices`) or customize rooms in the UI. `deskLayout` computes
  desk coordinates dynamically per room without overlap while keeping the entrance and corridor at `y >= 480`.
- **Rendering safety.** Model text is escaped (`util.esc`) or rendered with the safe Markdown
  wrapper: raw HTML shows as text, only http(s) links, no images.
- **Look and copy.** Light and dark themes follow the system through CSS tokens at the top of
  `styles.css`. UI copy is Vietnamese.
- **First run and settings.** The first-run setup screen and the settings dialog live in
  `settings.js`, the role store in `store.js`. Keys are typed into password fields and only ever
  shown masked.

---

## 11. Where data lives

| Path | Contents |
|---|---|
| `~/.agent-company/config.json` | providers, API keys, model choices, search, port |
| `~/.agent-company/workspaces.json` | registered workspaces (`id, name, path`) |
| `~/.agent-company/library/` | store-installed roles, personas, skills; `installed.json` |
| `~/.agent-company/pi/` | generated `models.json`, pi `auth.json` (do not edit by hand) |
| `<workspace>/.company/config.json` | optional `{roles: [...], limits: {...}}` for that workspace |
| `<workspace>/.company/runs/` | `<runId>.jsonl` event logs + `index.json` run summaries |
| `<workspace>/.company/sessions/<role>/` | pi conversation history per role |

You can override the app home with `--home <dir>` or `AGENT_COMPANY_HOME`.

---

## 12. Development workflow

```sh
npm install
npm start                      # node src/main.ts start  (opens the browser; --no-open, --port, --home)
npm test                       # all unit tests, no model calls
npm run check                  # tsc --noEmit
npm run catalog                # rebuild catalog/index.json after changing catalog/
npm run build                  # dist/ (only needed for packaging)
node scripts/pack-check.mjs    # what would be published is clean
node scripts/pack-smoke.mjs    # install the packed tarball and run it (needs network)
node tests/e2e/ui-demo.ts      # scripted team, no model → http://127.0.0.1:4318 (UI work)
```

- **Unit tests.**
  - `tests/helpers/fake-runner.ts` replaces pi with scripted roles, which is enough for every
    Router behaviour.
  - `tests/helpers/fake-provider.ts` is a local fake of the OpenAI, Anthropic and Gemini endpoints.
  - Tests that need settings set `AGENT_COMPANY_HOME` to a temp folder.
- **Real-model checks** (`tests/e2e/`) use the configured provider and cost tokens. Run them when
  you change prompts, tools or orchestration:
  - `research.ts`: a factual question goes to the Researcher, which must search, identify Google
    Cloud's OKF and cite sources;
  - `delegation.ts`: the Manager must delegate setup or fix work instead of doing it itself. One run
    can use more than a million tokens;
  - `smoke.ts`: a minimal end-to-end check.
- **CI** (`ci.yml`) runs on push to master and on PRs. Matrix: ubuntu/windows/macos × Node
  22.19/24. Steps: `npm ci`, check, test, catalog check, build, pack-check, pack-smoke.
- **Release** (`release.yml`) runs on a `v*` tag. The tag must equal the `package.json` version.
  It runs the same checks, then `npm publish --access public --provenance` (secret `NPM_TOKEN`)
  and creates a GitHub Release. To ship a version:
  1. bump the version;
  2. update `CHANGELOG.md`;
  3. commit;
  4. run `git tag vX.Y.Z && git push origin vX.Y.Z`.

  The catalog tag must exist before users install that version, which the release tag ensures.

---

## 13. Conventions

- **Language.** Code, comments, commits and docs are in English. UI text and user-facing error
  messages from the server are in Vietnamese.
- **Tests.** Write a failing test first, keep changes small, and give each behaviour change a test.
- **Simplicity.** Use the simplest thing that works. Where the code deliberately cuts a corner, it
  says so in a `ponytail:` comment that names the limit and the upgrade path. Run
  `grep -rn "ponytail:" src library ui` to list them.
- **Isolation.** Never read or write the user's `~/.claude`, global Node or own pi config. The app
  keeps everything under its home folder.
- **Secrets.** Never commit keys, `.company/` run logs, `data/`, or anything from
  `~/.agent-company`. `pack-check` and `.gitignore` back this up. They are not a substitute for
  care.

---

## 14. Known limitations and next steps

- **Guard.** It is regex-based, not a sandbox. Planned: a per-role container/sandbox for builder
  roles.
- **Token cost.** No token limits by default. Long debugging tasks can cost a lot; per-workspace
  `limits` can cap it.
- **Search depends on the endpoint.** `google_search` relies on a gateway feature (OmniRoute).
  With a plain OpenAI or Anthropic key and no SearXNG, web search is off and the Researcher
  reports "chưa kiểm chứng" for unverified claims.
- **OpenRouter `:online`.** It is deprecated upstream, so the code will move to the server-side
  web-search tool when that is stable (see `ponytail:` in `web.ts`).
- **Role store updates.** Store installs are not atomic across items. If a move fails halfway
  (e.g. antivirus locking a file on Windows), a role can end up partially installed. Re-installing
  repairs it.
- **Live team changes.** Installing or removing roles while a run is active takes effect after
  that run.
- **Skill ownership.** A skill shared between two store roles belongs to the role that installed
  it first. Uninstalling that role keeps the skill while another role uses it.

## 15. Further reading

- `docs/superpowers/specs/`: design documents (orchestrator, office UI, packaging), with the
  reasoning behind decisions.
- `docs/superpowers/plans/`: the task-by-task implementation plans that built each part.
- [CONTRIBUTING.md](../CONTRIBUTING.md), [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md),
  [CHANGELOG.md](../CHANGELOG.md).
