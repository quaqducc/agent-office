# Packaging & Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Agent Company a public, cross-platform app installed with one command, configured with endpoint URL + API key, with a base set of 4 roles and an in-app role store.

**Architecture:** An app home (`~/.agent-company`) holds config, keys, workspaces and store-installed roles; base roles ship inside the package. Settings generate pi's `models.json`; each role session picks its model. A `catalog/` in the repo (checksummed `index.json`) feeds the role store over raw GitHub URLs. A small JS bin starts the compiled server.

**Tech Stack:** Node ≥ 22.19, TypeScript (dev runs `.ts`; package ships `dist/*.js` built by `tsc`), pi SDK 1.0.4 (siblings pinned as direct deps), vanilla UI, `node:test`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-21-packaging-design.md`

## Global Constraints
- Package name `@quaqducc/agent-company`, command `agent-company`, `engines.node >=22.19.0`, version `0.1.0`.
- App home: `AGENT_COMPANY_HOME` env, default `<os.homedir()>/.agent-company`; never touch `~/.claude` or `~/.pi`.
- Server binds 127.0.0.1, default port 4317; keep Host/Origin/CSP/frame protections.
- No secrets, run logs, `.company/`, `data/`, or `D:/tools/...` paths in the repo tree or the npm tarball.
- Cross-platform: Windows, macOS, Linux — use `node:path` for the current OS (tests may exercise both `path.win32` and `path.posix`).
- Base roles in the package: `manager`, `researcher`, `developer`, `critic`. All other roles live in `catalog/`.
- Catalog downloads: `https://raw.githubusercontent.com/quaqducc/agent-company/<ref>/catalog/<path>`, ref = `v<version>` if the tag exists else `main`; sha256 verified; from a git checkout use local `catalog/`.
- Every role file gets an `owns:` line; the Manager's ownership table is generated from installed roles.

## Review Focus
1. No provider configured yet → server starts, UI shows setup, sending a message returns a clear "chưa cấu hình model" error instead of crashing. (Task 3 test `run without provider fails clearly`.)
2. Wrong key / unreachable endpoint / non-OpenAI response on "Thử kết nối" → clear error text, config not saved. (Task 3 test `test reports provider errors`.)
3. Store download with a tampered file or a network failure halfway → nothing partially installed. (Task 5 test `tampered file aborts install atomically`.)
4. Home or workspace paths with spaces and Vietnamese characters (`C:\Users\Nguyễn Văn A`) work end to end. (Task 1 test `home with spaces and unicode`.)
5. Upgrading the package keeps `config.json` and store-installed roles, and base prompts come from the new version. (Task 2 test `base files come from the package, overrides from home`.)

---

### Task 1: App home, settings model, cross-platform guard

**Files:** Create `src/home.ts`, `src/settings.ts`; modify `src/config.ts`, `src/guard.ts`, `src/workspace.ts` (no change in API), `src/server.ts` (dataDir default → home); tests `tests/home.test.ts`, `tests/settings.test.ts`, update `tests/guard.test.ts`.

**Interfaces (produces):**
- `home.ts`: `appHome(): string`; `homePaths(home = appHome()): { home, config, workspaces, library, installed, pi, piModels, piSettings }`; `ensureHome(home?): void` (mkdir; on POSIX chmod 0700 home).
- `settings.ts`:
  - `type ApiType = "openai-completions" | "anthropic-messages" | "google-generative-ai"`
  - `interface Provider { id: string; name: string; api: ApiType; baseUrl: string; apiKey: string; search: "google_search" | "openrouter-online" | "none"; contextWindow?: number }`
  - `interface ModelRef { provider: string; model: string }`
  - `interface AppConfig { providers: Provider[]; defaultModel?: ModelRef; roleModels: Record<string, ModelRef>; search: { mode: "auto" | "endpoint" | "searxng" | "off"; searxngUrl?: string; model?: ModelRef }; port?: number }`
  - `loadConfig(path?): AppConfig` (missing file → empty defaults, `search.mode = "auto"`); `saveConfig(c, path?)` (atomic write, 0600 on POSIX); `validateConfig(c): string[]`;
  - `maskKey(k): string` (`sk-…abcd`, empty → ""); `publicConfig(c)` (keys masked); `mergeConfig(current, incoming)` (a masked/empty incoming key keeps the stored key);
  - `modelFor(c, role): ModelRef | undefined` (role override → default); `suggestSearch(baseUrl): Provider["search"]` (`openrouter.ai` → `openrouter-online`, else `none`);
  - `writePiModels(c, path)`: pi `models.json` `{ providers: { [id]: { baseUrl, api, apiKey, models: [{ id, contextWindow? }] } } }` with every model referenced by defaultModel/roleModels/search.model.
- `config.ts`: remove `PROVIDER`, `MODEL_ID`, `LIBRARY`, `DATA_DIR`, `RUNTIME`; add `PACKAGE_ROOT`, `PACKAGE_LIBRARY = <root>/library`, `CATALOG_DIR = <root>/catalog`, `VERSION` (from package.json); `AGENT_DIR = homePaths().pi`; keep `PORT`, `DEFAULT_LIMITS`, PI env defaults.
- `guard.ts`: same `checkToolCall(tool, input, workspace, pathApi = path)`; secrets also include the app home (`homePaths().home` subtree except nothing) and work with POSIX paths (`~/.ssh`, `/home/x/.env`).

- [ ] **Step 1: Failing tests** — `home.test.ts`: `defaults to ~/.agent-company and honours AGENT_COMPANY_HOME`; `home with spaces and unicode` (set env to `tmp/Nguyễn Văn A/.ac`, `ensureHome`, write+read config works). `settings.test.ts`: `empty config defaults`; `saveConfig is atomic and private` (POSIX: mode 0600; Windows: file exists, no temp leftovers); `maskKey`; `mergeConfig keeps stored key when masked`; `modelFor prefers role override`; `suggestSearch`; `writePiModels lists every referenced model`; `validateConfig rejects bad URL / unknown api / duplicate ids`. `guard.test.ts`: add `posix secrets` cases via `pathApi = path.posix` (`/home/u/.ssh/id_rsa`, `/home/u/.agent-company/config.json` blocked; `/srv/docs/a.md` readable) and `app home is secret`.
- [ ] **Step 2:** Run, see failures. **Step 3:** Implement. **Step 4:** `node --test "tests/**/*.test.ts"` green, `tsc --noEmit` clean. **Step 5:** Commit.

### Task 2: Library split, multi-root loader, owns-based Manager table, catalog builder

**Files:** Create `library/` (from `D:/tools/pi-runtime/library`: roles `manager, researcher, developer, critic`, prompt files `_team.md _orchestrator.md _orchestrator_manager.md _cli.md`, their skills, their personas, `lib/roles.mjs`), `catalog/` (all other roles + skills + personas + `licenses/<source>.txt` + `index.json`), `scripts/build-catalog.mjs`, `THIRD_PARTY_NOTICES.md`; modify `src/library.ts`, every role file (`owns:`), `library/roles/manager.md` (table placeholder); tests `tests/roles.test.ts`, `tests/catalog.test.ts`.

**Interfaces:**
- `library/lib/roles.mjs`: all functions take `roots: string[]` (home first, package last): `roleIds(roots)`, `loadRole(roots, id)` (first root that has `roles/<id>.md`; `persona` resolved against that root; skill lookup across roots), `skillDir(roots, name): string | undefined`, `roleProblems(roots, role)`, `assemblePrompt(roots, id, mode)` — prompt files `_*.md` are read from the LAST root (package); the Manager's body placeholder `{{OWNERSHIP_TABLE}}` is replaced by a table of installed roles' `owns` lines.
- `src/library.ts`: `libraryRoots(): string[]` = `[homePaths().library, PACKAGE_LIBRARY]`; typed `roleIds()`, `loadRole(id)`, `skillDir(name)`, `roleProblems(role)`, `assemblePrompt(id, mode)`; `Role.meta.owns`.
- `catalog/index.json`: `{ format: 1, roles: [{ id, name, description, owns, skills: string[], files: [{ path, sha256, size }] }], skills: [{ name, source, license, files: [...] }] }` (paths relative to `catalog/`). `scripts/build-catalog.mjs [--check]` writes it (or with `--check` fails if stale) and fails when a skill/persona lacks a known source license.
- `manager.md` keeps its tuned text; its static table becomes `{{OWNERSHIP_TABLE}}` plus the rule: "If no installed role fits, give the work to the closest installed role, or tell the user which role to install from the role store (Kho role)."

- [ ] **Step 1: Failing tests** — `roles.test.ts`: `package library has exactly the 4 base roles`; `every role file (library + catalog) has owns`; `base files come from the package, overrides from home` (temp home with `roles/critic.md` override → loaded; `_team.md` in home ignored); `manager table lists only installed roles` (base only → 4 rows, no `planner`; after copying `planner` into temp home → row appears); `missing-role rule present`. `catalog.test.ts`: `index matches files` (run builder `--check`); `every skill names its source license`.
- [ ] **Step 2–4:** split (one-off script in scratchpad, not committed), update loader, run builder, green. **Step 5:** Commit.

### Task 3: Providers, models, settings API, per-role model in sessions

**Files:** Create `src/providers.ts`; modify `src/pi-runner.ts`, `src/server.ts`; tests `tests/providers.test.ts`, `tests/settings-api.test.ts`, update `tests/pi-runner.test.ts`.

**Interfaces:**
- `providers.ts`: `listModels(p: Provider, fetchImpl = fetch): Promise<string[]>` (OpenAI `GET {baseUrl}/models` → `data[].id`; Anthropic `GET /v1/models` with `x-api-key` + `anthropic-version`; Google `GET /v1beta/models?key=`), `testProvider(p, model, fetchImpl = fetch): Promise<{ ok: true; ms: number; reply: string } | { ok: false; error: string }>` (one tiny completion; errors: unreachable, 401/403 "API key bị từ chối", 404 "endpoint/model không đúng", non-JSON "endpoint không trả về API hợp lệ").
- `pi-runner.ts`: `buildRoleSession` resolves `modelFor(loadConfig(), role)`; throws `NoModelError("Chưa cấu hình model — mở Cài đặt để thêm endpoint và API key")` when undefined; regenerates `models.json` via `writePiModels` when config changed (mtime/hash).
- `server.ts` routes: `GET /settings` → `publicConfig`; `PUT /settings` (validate, `mergeConfig`, save, rewrite pi models) → 200/400; `POST /settings/providers/test {provider, model}` (provider may carry masked key → merged); `POST /settings/providers/models {provider}` → `{ models }`; `GET /health` → `{ version, configured: boolean }`.
- Router/runner failure from `NoModelError` surfaces as a `manager_reply`-visible error in the run (task failed + `error` event with that text).

- [ ] **Step 1: Failing tests** with a local fake provider (`node:http` on port 0 implementing `/v1/models` + `/v1/chat/completions`): `listModels openai`; `testProvider ok`; `test reports provider errors` (401, 404, HTML body, closed port); `settings API masks keys and keeps them on update`; `PUT rejects invalid config`; `run without provider fails clearly`; `role override model is used` (session model id equals override).
- [ ] **Step 2–4.** **Step 5:** Commit.

### Task 4: Search backends

**Files:** Modify `src/web.ts`, `src/tools.ts`; test `tests/web.test.ts`.

**Interfaces:** `webSearch(query, deps = { config: loadConfig(), fetchImpl: fetch }): Promise<string>`:
- `searchBackend(config): "google_search" | "openrouter-online" | "searxng" | "none"` — `off` → none; `endpoint` → provider capability; `searxng` → searxng (requires url); `auto` → provider capability if not `none`, else searxng if `searxngUrl`, else none.
- google_search: current OmniRoute call, model = `search.model ?? defaultModel`, provider = that model's provider.
- openrouter-online: chat completion with model `<model>:online`; append `annotations[].url_citation.url` (if present) as `Sources:`.
- searxng: `GET {url}/search?q=&format=json` → top 8 `title — url\nsnippet`.
- none: `"ERROR: web search is not configured (Cài đặt → Tìm kiếm). Say you could not verify instead of guessing."`

- [ ] **Step 1: Failing tests** (fake fetch): `backend selection matrix`; `searxng results formatted`; `openrouter online appends citations`; `google_search uses search.model`; `not configured message`. **Step 2–5.**

### Task 5: Role store

**Files:** Create `src/store.ts`; modify `src/server.ts`; test `tests/store.test.ts`.

**Interfaces:**
- `catalogBase(): Promise<{ kind: "local"; dir } | { kind: "remote"; baseUrl }>` — local if `CATALOG_DIR` exists (git checkout); else `https://raw.githubusercontent.com/quaqducc/agent-company/v<VERSION>/catalog/` if `HEAD .../index.json` is 200, else `.../main/catalog/`.
- `loadCatalog(base, fetchImpl)`; `storeState()` → `{ roles: [{ id, name, description, owns, skills, installed: "base" | "store" | false, updateAvailable }] }`;
- `installRole(id)`: download role + persona + missing skills into a temp dir under the home, verify every sha256, then rename into `library/` (atomic per item; on any failure remove the temp dir), update `installed.json` `{ [roleId]: { sha256, ref } }`; `uninstallRole(id)` (base → 409; remove role file; remove skills no longer used by any installed role).
- Routes: `GET /store`, `POST /store/roles/:id/install`, `DELETE /store/roles/:id`.

- [ ] **Step 1: Failing tests** (temp home + local HTTP server serving a copy of `catalog/`): `lists base and available roles`; `installs planner with its skills`; `tampered file aborts install atomically` (bad byte → error, no `planner.md`, no new skills, temp removed); `uninstall keeps shared skills`; `cannot uninstall base role`; `remote ref falls back to main when tag missing`. **Step 2–5.**

### Task 6: CLI, build, package metadata

**Files:** Create `bin/agent-company.js`, `src/main.ts`, `tsconfig.build.json`, `scripts/pack-check.mjs`; modify `package.json`, `src/cli.ts` (becomes `chat` subcommand), `src/server.ts` (`startServer` returns `{url, close}` unchanged); tests `tests/main.test.ts`, `tests/pack.test.ts` (runs `pack-check` on `npm pack --dry-run --json` output).

**Interfaces:**
- `bin/agent-company.js`: loads `../dist/main.js` if present else `../src/main.ts` (dev), forwards `process.argv`; exits 1 with a clear message on Node < 22.19.
- `main.ts`: `parseArgs(argv): { cmd: "start" | "doctor" | "chat" | "import" | "help" | "version"; port?: number; home?: string; open: boolean; rest: string[] }`; `start` (ensureHome, startServer, print URL, open browser unless `--no-open` using `start`/`open`/`xdg-open`), `doctor` (Node version, home writable, providers configured, each provider `testProvider` with default model, search backend), `chat <folder> [name]` (old terminal client), `import --from-pi-runtime <dir> [--workspaces <file>]`.
- `package.json`: `name @quaqducc/agent-company`, `private` removed, `bin { "agent-company": "bin/agent-company.js" }`, `files ["bin","dist","ui","library","README.md","LICENSE","THIRD_PARTY_NOTICES.md","CHANGELOG.md"]`, `engines`, `repository`, `license MIT`, deps: `@earendil-works/pi-coding-agent` + 7 siblings pinned `1.0.4`, `marked`, `typebox`; scripts `build` (`tsc -p tsconfig.build.json`), `prepack` (`npm run build`), `test`, `check`, `start` (`node src/main.ts start`), `catalog` (`node scripts/build-catalog.mjs`).
- `tsconfig.build.json`: `outDir dist`, `rootDir src`, `rewriteRelativeImportExtensions: true`, emit JS only.
- `pack-check.mjs`: fails if the tarball file list contains `.env`, `models.json`, `auth.json`, `data/`, `.company/`, `catalog/`, `tests/`, `.superpowers/` or any file containing `D:/tools` / `D:\\tools`.

- [ ] **Step 1: Failing tests:** `parseArgs` cases (default start, `--port 5000`, `--no-open`, `doctor`, `chat d:/x name`, unknown flag → help); `pack contents are clean`. **Step 2–4:** implement, `npm run build`, `node bin/agent-company.js --version` prints `0.1.0`. **Step 5:** Commit.

### Task 7: UI — setup, settings, role store

**Files:** Create `ui/js/settings.js`, `ui/js/store.js`; modify `ui/index.html`, `ui/styles.css`, `ui/js/app.js`, `ui/js/api.js`; test `tests/ui-settings.test.ts` (pure helpers).

**Interfaces:** `api.js` adds `health()`, `settings()`, `saveSettings(c)`, `testProvider(p, model)`, `providerModels(p)`, `store()`, `installRole(id)`, `uninstallRole(id)`. `settings.js` pure helpers: `providerPresets` (OpenAI, OpenRouter, DeepSeek, Gemini (OpenAI endpoint), Anthropic, Ollama, OmniRoute/Custom) → `{ name, api, baseUrl, search }`; `validateProviderForm(form): string[]`. Screens: first-run **Thiết lập** (shown when `health().configured` is false), **Cài đặt** dialog (gear in top bar: Providers, Model mặc định, Model theo role, Tìm kiếm), **Kho role** dialog (cards: avatar, name, owns, skills, Cài / Gỡ / Cập nhật, progress, errors). Keys use `type=password`, displayed masked.

- [ ] **Step 1: Failing tests:** `presets have valid urls and api types`; `validateProviderForm` errors (missing URL, bad scheme, missing key except Ollama/local). **Step 2–4:** implement; verify in a headless browser against a server with a fake provider (setup → models → test → save → office; store install → desk appears; settings per-role model); light/dark, 1000px. **Step 5:** Commit.

### Task 8: Docs, CI, release, install scripts, author migration, packaging smoke

**Files:** Create `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `install.sh`, `install.ps1`, `LICENSE` (MIT, "Quang Duc"), `CHANGELOG.md` (0.1.0), `CONTRIBUTING.md`, `scripts/pack-smoke.mjs`; rewrite `README.md` (public users: install, first run, providers table, search, role store, data locations, security, development); remove `company.cmd`/`company-cli.cmd` references.

- [ ] **Step 1:** `pack-smoke.mjs`: `npm pack` → install the tarball into a temp prefix → run `agent-company --version`, `doctor` (no provider: exits 0 with "chưa cấu hình"), `start --no-open --port 0` → GET `/` 200, GET `/health` `{configured:false}` → stop. Run it locally; it must pass.
- [ ] **Step 2:** CI matrix `[ubuntu-latest, windows-latest, macos-latest] × [22.19, 24]`: `npm ci`, `npm run check`, `npm test`, `node scripts/build-catalog.mjs --check`, `node scripts/pack-smoke.mjs`. Release on `v*`: same + `npm publish --access public --provenance` (`NPM_TOKEN`), GitHub Release.
- [ ] **Step 3:** Author migration on this machine: `node src/main.ts import --from-pi-runtime D:\tools\pi-runtime --workspaces data\workspaces.json`; then real-model `tests/e2e/research.ts` and `tests/e2e/delegation.ts` pass using the imported OmniRoute provider.
- [ ] **Step 4:** Commit; final whole-branch review; fix pass; merge to master.

### Task 9: Publish preparation (history + push)

- [ ] **Step 1:** Backup branch `backup/full-history` (local only). Create orphan branch from the final tree, single commit `Initial public release (0.1.0)`, verify tree has no forbidden files (`pack-check` + `git grep -nE "D:/tools|D:\\\\tools|sk-[A-Za-z0-9]{8}"` empty), replace `master`, `git push --force origin master`, delete remote feature branches.
- [ ] **Step 2:** Hand over to the user: make the repo public (GitHub settings), create npm account/token → `NPM_TOKEN` secret, then `git tag v0.1.0 && git push --tags` to publish.
