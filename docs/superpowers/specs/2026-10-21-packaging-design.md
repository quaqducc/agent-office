# Agent Company — Packaging & Distribution Design

Date: 2026-10-21 · Status: draft for approval · Builds on: orchestrator, office UI, research (all merged)

## 1. Intent

Turn Agent Company from "runs on the author's machine" into a public, installable app on GitHub
(github.com/quaqducc/agent-company), installed the way public coding harnesses are (Claude Code, pi,
opencode, Codex): one command, works on Windows, macOS and Linux. A new user installs a small base,
enters an **API endpoint URL + API key**, picks a model and starts working. More roles are downloaded
on demand from an in-app role store. OmniRoute is **not** bundled; it is just one endpoint a user may
enter. The author keeps using the app on their own machine (with OmniRoute as their endpoint).

## 2. Decisions made with the user

- Distribution: public GitHub repo; install from GitHub works immediately, plus automatic npm
  publishing of `@quaqducc/agent-company` from GitHub Actions on a `vX.Y.Z` tag (the user creates the
  npm account/token once). The command users run is `agent-company`.
- Base install ships 4 roles: **manager, researcher, developer, critic** (+ the skills they need).
  All other roles are downloaded on demand from the role store.
- Provider setup: endpoint URL + API key is all a user must enter.
- Models: **one default model for all roles, optional per-role override**.
- Web search when the provider has no built-in search: (a) use the endpoint's own search if it has one
  (OmniRoute's `google_search` tool, OpenRouter web search), and (b) a **SearXNG URL** the user can set.

### 2.1 Decided after the builder check

By the user:
- **Git history:** before the repo goes public, replace history with one clean root commit built from
  the cleaned tree (force-push; the repo is private today, nobody else is affected). The full old
  history is kept in a local backup branch only. The 4 accidentally committed `.company/` files are
  removed and `.company/` is git-ignored.
- **Author's machine:** keep running from the code checkout (`D:\agent-company`) on the portable Node;
  `company.cmd` / `company-cli.cmd` stay local only (git-ignored), not in the public repo.

By the designer (the user may override):
- **Skill files with scripts** (`.sh`, `.py`, `.js`, CSV data…) ship as-is in the catalog: they are part
  of the upstream skills. They come only from this repo at a pinned ref, are sha256-verified, and
  nothing is executed at install time. ("Text only" in §5/§8 means: no binaries, no install hooks.)
- **Upgrades:** base roles, base skills, prompt files and `lib/roles.mjs` are read **from the installed
  package** (always current). `~/.agent-company/library/` holds only store-installed roles/skills plus
  optional user overrides (a role file there with the same id overrides the base one). Store installs
  record `{ id, version, sha256 }` in `~/.agent-company/library/installed.json`; the store shows
  "Cập nhật" when the catalog at the current app version differs.
- **Manager with few roles:** each role file gets an `owns:` line (one sentence: what work it owns). The
  Manager's ownership table is generated from the installed roles' `owns` lines instead of being
  hard-coded. Rule added: if no installed role fits, give it to the closest installed role or tell the
  user which store role to install (by name). The rest of `manager.md` stays as tuned.
- **Search capability per provider:** `providers[].search: "google_search" | "openrouter-online" | "none"`
  (Settings suggests one from the base URL: `openrouter.ai` → `openrouter-online`, otherwise `none`;
  the author sets `google_search` for OmniRoute). `config.json.search = { mode, searxngUrl?, model? }`;
  the search call uses `search.model` if set, else the default model, through the default model's
  provider. `auto` = provider capability → SearXNG if configured → "search not configured".
- **Catalog ref:** `v<appVersion>` if that tag exists on GitHub, else `main` (GitHub installs before the
  first tag). The catalog is committed to the repo so both refs work. Running from a git checkout uses
  the local `catalog/` directly.
- **Author migration:** dev runs use the same app home (`~/.agent-company`); `agent-company import
  --from-pi-runtime D:\tools\pi-runtime --workspaces data\workspaces.json` brings over the OmniRoute
  provider (search `google_search`), all roles, and registered workspaces.

## 3. Goals

1. `npm i -g @quaqducc/agent-company` (or `npm i -g github:quaqducc/agent-company`) → `agent-company`
   starts the server and opens the browser at the office UI. Same on Windows/macOS/Linux, Node ≥ 22.19.
2. First run: a setup screen asks endpoint URL + API key (+ API type), lists the endpoint's models,
   tests a call, saves. Nothing else is required to start.
3. Settings page: providers (add/edit/test/remove), default model, per-role model override, web search
   backend (auto / endpoint-native / SearXNG URL / off).
4. Role store page: installed vs available roles, install / uninstall, with the skills each role needs;
   integrity-checked downloads pinned to the app's version.
5. All app data under one home dir, never touching `~/.claude` or `~/.pi`.
6. Existing features keep working (office UI, live SSE, replay, approvals, guard, research tools).
7. CI on Windows/macOS/Linux; release workflow publishes to npm with provenance.

## 4. Non-goals

Desktop wrapper (Electron/Tauri), auto-update daemon, Docker image (later; the author plans a Docker
build that also fetches fonts), multi-user/remote access, bundling OmniRoute, a hosted role registry
beyond the GitHub repo, OAuth logins.

## 5. Anti-goals

- Shipping secrets: the published package and the repo must never contain API keys, `models.json`
  with keys, run logs, or the author's local paths.
- Breaking the author's current setup without a migration path.
- A first-run that requires editing files or knowing pi.
- Downloading and executing unverified code: role-store downloads are text (Markdown + skill assets),
  checksummed, and fetched only from the repo at the app's own version tag.

## 6. Constraints & findings (verified 2026-10-21)

- Node refuses to run TypeScript from inside `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`).
  The published package must contain compiled JavaScript → add a build step (tsc emit to `dist/`).
  Development may keep running `.ts` directly.
- npm `overrides` only apply to the root project. Installed as a dependency/global package, pi 1.0.4's
  `^1.0.4` sibling ranges would resolve to 1.3.0 and break. Fix: declare the siblings
  (`@earendil-works/pi-ai`, `pi-agent-core`, `pi-codemode`, `pi-mcp`, `pi-tui`, `chord`, `pi-telemetry`)
  as **direct dependencies pinned to 1.0.4** (npm dedupes to them). Upgrading pi (1.3.0 now pins its
  siblings exactly) is a separate, later change.
- Licenses of vendored roles/skills are permissive (MIT; Apache-2.0 for Anthropic's `frontend-design`).
  Redistribution requires shipping their license texts → `THIRD_PARTY_NOTICES.md` + per-source license
  files in the catalog.
- Current code is Windows-specific in places: `src/guard.ts` uses `path.win32`; `src/config.ts`
  defaults to `D:/tools/pi-runtime`; launchers are `.cmd`. All must become cross-platform.
- `web_search` currently relies on OmniRoute turning a `google_search` function into Gemini grounding.

## 7. Architecture

### 7.1 App home (`AGENT_COMPANY_HOME`, default `~/.agent-company`)
```
~/.agent-company/
  config.json          providers, default model, per-role models, search, server port (0600 on POSIX)
  workspaces.json      registered workspaces (was repo data/)
  library/             installed roles & skills (same layout as today's library: roles/, skills/, lib/)
  pi/                  pi agent dir: generated models.json (from config.json), settings.json
```
Workspace data stays in `<workspace>/.company/` as today.

### 7.2 Package layout (repo)
```
bin/agent-company.js   CLI entry (plain JS): start server, open browser, subcommands
src/*.ts               sources (dev runs them directly); build → dist/*.js (published)
ui/                    unchanged static UI
library/               BASE library shipped in the package: manager, researcher, developer, critic,
                       their skills, prompt files (_team.md, _orchestrator*.md, _cli.md), lib/roles.mjs
catalog/               ALL other roles + skills + index.json (not in the npm package; fetched from GitHub)
scripts/build-catalog.mjs   generates catalog/index.json (files + sha256) and checks licenses
THIRD_PARTY_NOTICES.md, LICENSE (MIT for the app)
```
On first start the app copies `library/` (base) into `~/.agent-company/library/` if absent, and on
upgrades adds new base files without overwriting user-installed roles.

### 7.3 CLI (`agent-company`)
- `agent-company` — start server on configured port (default 4317), open browser (unless `--no-open`).
- `agent-company --port <n>`, `--home <dir>`, `--version`, `--help`.
- `agent-company doctor` — checks Node version, home dir, provider reachability, prints fixes.
Server binds 127.0.0.1 only (unchanged).

### 7.4 Providers & models
- `config.json.providers[]`: `{ id, name, api: "openai-completions" | "anthropic-messages" | "google-generative-ai",
  baseUrl, apiKey, models?: string[] }` (pi supports these API types via `models.json`). Default type
  OpenAI-compatible — works for OpenAI, OpenRouter, DeepSeek, Groq, Together, Ollama, vLLM, LM Studio,
  Gemini's OpenAI endpoint and OmniRoute.
- `config.json.defaultModel`: `{ provider, model }`; `roleModels`: `{ [roleId]: { provider, model } }`.
- The app writes `~/.agent-company/pi/models.json` from `config.json` and builds the pi `ModelRuntime`
  from it; `buildRoleSession` picks the role's model (override or default).
- Model discovery: `GET {baseUrl}/models` (OpenAI-style) with the key; manual entry if it fails.
- Connection test: one tiny completion call; show latency and the model's reply.

### 7.5 Web search backends
`config.json.search`: `{ mode: "auto" | "endpoint" | "searxng" | "off", searxngUrl? }`.
- `endpoint`: provider-native search through the default provider:
  - OmniRoute-style: `google_search` function (current behaviour);
  - OpenRouter: model with `:online` suffix / web plugin (verify against OpenRouter docs during build).
- `searxng`: `GET {searxngUrl}/search?q=…&format=json` → top results (title, url, snippet) returned to the
  model; the model then uses `web_fetch` to read sources.
- `auto`: endpoint-native if the provider is recognised as supporting it, else SearXNG if configured,
  else `web_search` answers "search not configured" (and the researcher says so; never guesses).
- `web_fetch` and the "search before fetch" rule stay as they are.

### 7.6 Role store
- `catalog/index.json`: `{ version, roles: [{ id, name, description, skills[], persona?, files[] }],
  skills: [{ name, files: [{ path, sha256, size }], license, source }] }`.
- Download URL: `https://raw.githubusercontent.com/quaqducc/agent-company/v<appVersion>/catalog/<path>`
  (dev: from the local `catalog/` dir when running from a git checkout).
- Install = download role file (+ persona) + missing skills, verify sha256, write atomically into
  `~/.agent-company/library/`; uninstall removes the role (skills kept if another role uses them).
  Base roles cannot be uninstalled (manager must always exist).
- API: `GET /store` (catalog + installed state), `POST /store/roles/:id/install`, `DELETE /store/roles/:id`.
- Workspace role lists still come from `config.json`/workspace config intersected with installed roles.

### 7.7 UI additions
- **Setup screen** (shown when no provider is configured): endpoint URL, API key (password field),
  API type (default OpenAI-compatible), "Lấy danh sách model" → model picker, "Thử kết nối", Save.
- **Settings** (gear in the top bar): providers list, default model, per-role overrides, search backend.
- **Role store** (in Settings or its own dialog): cards per role with avatar, description, skills, size,
  Install/Uninstall, progress and errors.
- API keys are never sent back to the browser in full (masked `sk-…abcd`); edits replace them.

### 7.8 Migration for the author
`agent-company import --from-pi-runtime <dir>` (one-time): reads the old `models.json` (OmniRoute
endpoint + key), installs all roles from the old library into the new home, imports
`data/workspaces.json`. Old paths stay untouched.

### 7.9 Build, CI, release
- `npm run build`: `tsc -p tsconfig.build.json` → `dist/` (rewrite `.ts` import extensions to `.js`).
- `package.json`: `bin`, `files` (`bin`, `dist`, `ui`, `library`, licenses, README), `engines.node >=22.19`.
- CI (`.github/workflows/ci.yml`): Windows/macOS/Linux × Node 22/24: typecheck, tests, build, a smoke
  that packs (`npm pack`), installs the tarball into a temp prefix and runs `agent-company --version`
  and `doctor` without a provider.
- Release (`release.yml`): on tag `v*` → same checks → `npm publish --access public --provenance`
  (needs `NPM_TOKEN` secret) → GitHub Release with notes.
- Install scripts: `install.sh` (macOS/Linux) and `install.ps1` (Windows) check Node ≥ 22.19 (print how
  to install it if missing) then `npm i -g` the package (npm if published, else GitHub).
- Docs: README rewritten for public users (install, first run, providers, role store, security notes),
  CHANGELOG, CONTRIBUTING (short).

## 8. Security

- Keys live only in `~/.agent-company/config.json` (0600 on POSIX) and the generated pi `models.json`
  under the same home; the guard's secret list covers the whole app home.
- The server still binds 127.0.0.1 with Host/Origin checks, CSP and frame protection.
- Role-store downloads: GitHub raw URLs at the app's tag only, sha256 verified, text files only.
- `npm pack` content check in CI: fail if the tarball contains `.env`, `models.json`, `auth.json`, `data/`,
  `.company/`, or the author's paths.

## 9. Verification

- Unit tests (existing + new): config/home, models.json generation, provider API, search backends with
  fake fetch, catalog builder (hashes), store install/uninstall with a local catalog and tampered-hash
  rejection, cross-platform guard (POSIX and Windows paths), CLI arg parsing.
- Packaging smoke (CI and locally): `npm pack` → install into temp prefix → `agent-company --version`,
  `doctor`, start server with `--no-open`, GET `/` returns the UI, setup endpoints work with a fake provider.
- Real-model check on the author's machine via OmniRoute entered as a normal provider: the research
  e2e and the delegation e2e still pass.
- Fresh-user walkthrough in a headless browser: setup screen → model list → test → office → install a
  role from the store → send a message.

## 10. Left to the builder

Exact UI layout of setup/settings/store (follow the existing office design system), CLI help text,
browser-open helper, file-permission handling on Windows, catalog builder details, how much of today's
`D:/tools/pi-runtime/library` becomes `catalog/` vs `library/` (rule: base 4 roles in `library/`, all
others in `catalog/`), CHANGELOG wording.
