# Agent Company — Simple IDE Technical Architecture & Phased Implementation Plan

Date: 2026-10-24 · Status: Proposed / Ready for Review · Author: Software Architect

---

## 1. Executive Summary & Goals

Agent Company empowers human users to collaborate with a local AI team inside a 2D pixel-art office. While users interact with the team via chat and follow tasks visually, reviewing code changes, editing source files, and verifying AI-generated output currently forces the user to switch back and forth to an external editor (e.g. VS Code).

The **Simple Embedded IDE** provides a lightweight, focused developer workspace directly inside Agent Company:
1. **Directory Tree Explorer & File Viewer**: Browse files safely within the workspace.
2. **Editor with Concurrency Protection**: Edit and save files with instant `Ctrl+S`, backed by ETag / SHA-256 conflict detection when AI roles simultaneously edit code.
3. **Diff Viewer (Git & Shadow Backup)**: Clear visual inspection of changes made by the AI or user, working seamlessly for both Git repositories and non-Git folders.
4. **Bottom Output Panel**: Real-time inspection of commands executed by roles (e.g. `bash`, tests, tool calls) streamed from the orchestrator.

### Core Architectural Constraints
- **Zero New Dependencies**: Implemented using Node.js built-ins (`node:fs`, `node:path`, `node:crypto`, `node:child_process`) and pure browser ES modules. No Monaco editor, no heavy PTY daemons, no LSP bloat.
- **Guard & Security Boundary**: Complete reuse and enforcement of `guard.ts` security rules: absolute path traversal defense, symlink resolution escape defense (`realpathSync`), blocking `.env`, secrets, credentials, `.company/`, and respecting strict localhost (`127.0.0.1`), Host, and Origin headers.
- **TDD (Test-Driven Development)**: All backend logic and pure UI reducers tested via `node:test` without model calls.

---

## 2. Server API Architecture & Security Model

```
                    Browser (ui/js/ide/)
                             │
     ┌───────────────────────┼───────────────────────┐
     ▼                       ▼                       ▼
GET /tree               GET/PUT /files          GET /diff
     │                       │                       │
     ▼                       ▼                       ▼
 ┌─────────────────────────────────────────────────────────┐
 │               Security & Guard Middleware               │
 │  - Host (127.0.0.1) & Origin validation (DNS rebinding) │
 │  - Path Traversal & symlink resolution (realpathSync)   │
 │  - Secret filter (.env, *.key, .ssh, .company/, etc.)   │
 │  - File size capping (2MB text limit)                   │
 └───────────────────────────┬─────────────────────────────┘
                             │
       ┌─────────────────────┼─────────────────────┐
       ▼                     ▼                     ▼
 Directory Walker       File Store &          Diff Engine
 (lazy / max depth)    Conflict Engine     ┌───────┴────────┐
                        (ETag / sha256)    ▼                ▼
                                       Git Diff      Shadow Backup
                                     (git repos)    (non-git repos)
```

### 2.1 API Endpoints Specification

#### 1. `GET /workspaces/:id/tree`
- **Query Parameters**:
  - `path` (optional, default: `.`): Relative path from workspace root.
  - `depth` (optional, default: `2`, max: `4`): Traversal depth for responsive lazy loading.
- **Security Validations**:
  - `validateSafeWorkspacePath(workspacePath, subpath)`: Resolves full path, checks `realpathSync` stays strictly inside workspace root, rejects any traversal into `.company/` or credentials folders.
  - Skips system and sensitive directories: `.git`, `.company`, `node_modules` (collapsed by default), `.ssh`, `.aws`.
- **Response `200 OK`**:
  ```json
  {
    "root": ".",
    "entries": [
      { "name": "src", "path": "src", "type": "dir", "hasChildren": true },
      { "name": "package.json", "path": "package.json", "type": "file", "size": 1420, "mtime": "2026-10-22T08:30:00.000Z" }
    ]
  }
  ```

#### 2. `GET /workspaces/:id/files`
- **Query Parameters**:
  - `path` (required): Relative path to the target file.
- **Security & Safety Checks**:
  - `isSecretPath(path)` from `guard.ts`: Strictly blocks `.env*` (except `.env.example`, `.env.sample`), `*.pem`, `*.key`, `*.pfx`, `id_*`, `.company/`, `.ssh/`, `.agent-company/`. Returns `403 Forbidden`.
  - `stat.size > 2 * 1024 * 1024` (2MB): Returns `413 Payload Too Large` or `{ binary: true, size }` to prevent browser tab crashing on large files/binaries.
  - Binary file detection: Checks initial 512 bytes for null bytes (`0x00`). If binary, returns `{ binary: true, path, size }`.
- **Response `200 OK`**:
  - Headers: `ETag: W/"<sha256-hash>"`, `Cache-Control: no-cache`
  - Body:
    ```json
    {
      "path": "src/server.ts",
      "content": "import { createServer } from \"node:http\"; ...",
      "size": 12450,
      "mtime": "2026-10-23T14:10:05.120Z",
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "eTag": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    }
    ```

#### 3. `PUT /workspaces/:id/files`
- **Query Parameters**:
  - `path` (required): Target relative file path.
- **Headers & Body**:
  - `Content-Type: application/json`
  - `If-Match`: Optional `<eTag>` string.
  - Body:
    ```json
    {
      "content": "updated code...",
      "expectedSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    }
    ```
- **Execution Flow**:
  1. Validate path via `guard.ts` (strictly reject forbidden paths and secrets).
  2. Verify concurrency precondition: Calculate current disk file SHA-256. If `currentSha256 !== expectedSha256`, return `409 Conflict`.
  3. Pre-write Shadow Backup: If the workspace is not a Git repo, create a snapshot of the pre-write file in `.company/shadow/` before writing.
  4. Write file atomically via temp file rename (`fs.writeFileSync` to `<file>.tmp.<uuid>`, followed by `fs.renameSync`).
  5. Return `200 OK` with updated `sha256`, `mtime`, and `size`.

#### 4. `GET /workspaces/:id/diff`
- **Query Parameters**:
  - `path` (optional): Filter diff for a specific file.
  - `runId` (optional): Scope diff to files touched during a specific task/run.
- **Diff Strategy**:
  - **Git Workspace**: If `.git` exists in workspace root, executes `git diff` (or `git diff --cached`) safely via `execFile` (`git`, `["diff", "--no-color", "--", path]`) with 5s timeout and 2MB max buffer.
  - **Non-Git Workspace (Shadow Backup Engine)**: Compares current file contents against `.company/shadow/<relPath>` using a lightweight Myers diff algorithm implemented in pure TypeScript.
- **Response `200 OK`**:
  ```json
  {
    "engine": "git",
    "files": [
      {
        "path": "src/server.ts",
        "status": "modified",
        "additions": 14,
        "deletions": 3,
        "patch": "@@ -110,6 +110,17 @@\n+ new code line\n- old code line\n"
      }
    ]
  }
  ```

---

## 3. Concurrency & Overwrite Conflict Detection

### 3.1 The Human-AI Collision Problem
In Agent Company, an AI Developer role can execute `write` or `edit` tools at any point during an active run. If a user opens `src/server.ts` at $t_1$, edits the file in the browser, while the AI modifies `src/server.ts` at $t_2$, a naive save at $t_3$ would silently overwrite the AI's contributions (or vice-versa).

### 3.2 Conflict Resolution Mechanism
```
User Editor                       Server / Disk                     AI Role (Runner)
    │                                   │                                  │
    ├─── 1. GET /files?path=app.ts ────>│                                  │
    │<── 2. content, sha256: "AAA" ─────┤                                  │
    │                                   │<─── 3. tool_call: edit(app.ts) ──┤
    │                                   │     Disk sha256 becomes "BBB"    │
    │                                   │─── 4. Tool result: success ─────>│
    │                                   │                                  │
    ├─── 5. PUT /files (expected: "AAA")│                                  │
    │    SHA-256 Check: "AAA" != "BBB"  │                                  │
    │<── 6. 409 Conflict + diskContent ─┤                                  │
    │                                   │                                  │
    ▼                                   │                                  │
[ Display Conflict Dialog: ]            │                                  │
  - Compare Diff (User vs Disk)         │                                  │
  - Overwrite Disk ("Force Save")       │                                  │
  - Reload Disk Version                 │                                  │
```

- When `PUT /files` detects a mismatch between `expectedSha256` and disk `sha256`:
  - Returns `409 Conflict`:
    ```json
    {
      "conflict": true,
      "message": "File was modified on disk by an external process or AI role",
      "diskSha256": "BBB...",
      "diskMtime": "2026-10-24T10:15:30.000Z",
      "diskContent": "..."
    }
    ```
  - The UI highlights the conflicting lines and offers 3 buttons:
    1. **"Xem khác biệt" (Review Diff)**: Visual side-by-side or inline comparison.
    2. **"Nạp lại bản mới" (Reload from Disk)**: Discards user unsaved buffer.
    3. **"Ghi đè bản này" (Force Overwrite)**: Sends `PUT /files` with `force: true`.

---

## 4. Shadow Backup Strategy for Non-Git Workspaces

For workspaces initialized without Git version control, users still need change tracking and diff inspection.

### 4.1 Storage & Layout
- Shadow snapshots are stored inside `<workspace>/.company/shadow/`:
  - `.company/shadow/base/`: Contains the baseline copy of files before any run/edit session touched them.
  - `.company/shadow/runs/<runId>/`: Stores snapshots taken immediately prior to an AI run modifying them.
- Because `.company/` is already strictly guarded by `guard.ts` (hidden, read/write/shell blocked from outside tools), shadow data is completely isolated.

### 4.2 Snapshot Lifecycle
1. **On File Open / First AI Touch**:
   - Before an AI tool (`write` or `edit`) or user `PUT /files` touches `path/to/file.ts`:
   - If `.company/shadow/base/path/to/file.ts` does not exist, copy existing disk file to base shadow.
2. **On Diff Request (`GET /workspaces/:id/diff`)**:
   - If no `.git/` folder is present:
   - Compares `<workspace>/path/to/file.ts` with `.company/shadow/base/path/to/file.ts`.
   - Generates unified diff using internal pure-TypeScript Myers diff engine.
3. **Storage Quota & Retention**:
   - Files larger than 2MB are excluded from shadow backups.
   - Total shadow backup directory capped at 50MB (oldest run snapshots pruned automatically).

---

## 5. Detailed 4-Phase Implementation Plan

### Phase 1: IDE Layout + File Tree Explorer + Read-Only File Viewer
*Deliverable: Users can open the IDE tab, navigate the workspace folder tree, and view file contents with syntax formatting.*

- **Backend Files**:
  - `src/ide-fs.ts` (new): Implements `listWorkspaceTree(wsPath, subpath, depth)` and `readWorkspaceFile(wsPath, subpath)`.
  - `src/server.ts` (edit): Register routes `GET /workspaces/:id/tree` and `GET /workspaces/:id/files`.
- **Frontend Files**:
  - `ui/index.html` (edit): Add "IDE" tab button to navigation tabs and `<div class="tab-panel" data-panel="ide">`.
  - `ui/styles.css` (edit): Layout styles for 2-column IDE layout (`.ide-container`, `.ide-sidebar`, `.ide-editor`).
  - `ui/js/ide/tree.js` (new): Tree view component with folder collapse/expand, file icons, and click handlers.
  - `ui/js/ide/viewer.js` (new): Read-only code viewer with line numbers and token highlight styling.
  - `ui/js/api.js` (edit): Add `api.tree(id, path)` and `api.file(id, path)`.
- **Unit Tests (`node:test`)**:
  - `tests/ide-fs.test.ts`: Test directory listing, depth limits, path traversal blocking (`../`), and secret masking.
  - `tests/server-ide.test.ts`: Test HTTP 200 on valid paths, 403 on `.env` and `id_rsa`, 404 on missing files, and 413 on oversized files.
- **Definition of Done (DoD)**:
  1. Clicking "IDE" tab renders the tree explorer of the active workspace.
  2. Clicking any code file loads and displays file content with line numbers.
  3. Sensitive files (`.env`, `key.pem`, `.company/`) cannot be opened and display a clear security warning.

---

### Phase 2: File Editing & Saving (Ctrl+S) + Conflict Detection + Guard Integration
*Deliverable: In-place text editing, keyboard shortcuts, safe atomic writing, and real-time conflict handling.*

- **Backend Files**:
  - `src/ide-fs.ts` (edit): Add `writeWorkspaceFile(wsPath, subpath, content, expectedSha256, options)`.
  - `src/server.ts` (edit): Register route `PUT /workspaces/:id/files`.
- **Frontend Files**:
  - `ui/js/ide/editor.js` (new): Editable textarea/contenteditable with tab indent support, line number sync, dirty buffer indicator (`*`), and `Ctrl+S` handler.
  - `ui/js/ide/conflict-dialog.js` (new): Modal dialog shown on 409 Conflict with diff view and resolution choices.
  - `ui/js/api.js` (edit): Add `api.saveFile(id, path, content, expectedSha256)`.
- **Unit Tests (`node:test`)**:
  - `tests/ide-write.test.ts`:
    - Writing file updates content and returns new sha256/mtime.
    - Supplying outdated `expectedSha256` triggers `409 Conflict`.
    - Writing to `.env` or outside workspace returns `403 Forbidden`.
    - Atomic write prevents file corruption during simulated write failure.
- **Definition of Done (DoD)**:
  1. Editing a file shows an unsaved dot indicator in tab header.
  2. Pressing `Ctrl+S` saves the file and updates disk instantly.
  3. If an AI role modifies the file concurrently, saving triggers the 409 conflict modal without losing either version.

---

### Phase 3: Change Tracking & Diff Viewer (Git & Shadow Backup)
*Deliverable: Interactive Diff tab showing additions/deletions per file, linked to runs and questions.*

- **Backend Files**:
  - `src/ide-diff.ts` (new): Implements Git diff runner (`git diff`) and fallback Myers diff engine against `.company/shadow/`.
  - `src/server.ts` (edit): Register route `GET /workspaces/:id/diff`.
- **Frontend Files**:
  - `ui/js/ide/diff-viewer.js` (new): Side-by-side or unified diff rendering with green `+` and red `-` lines.
  - `ui/js/ide/layout.js` (edit): Toggle between "Code Editor" and "Thay đổi (Diff)" views.
  - `ui/js/api.js` (edit): Add `api.diff(id, path?, runId?)`.
- **Unit Tests (`node:test`)**:
  - `tests/ide-diff.test.ts`:
    - Git workspace: Produces clean unified diff against HEAD.
    - Non-Git workspace: Correctly generates additions/deletions against shadow baseline.
    - Empty diff returns clean `files: []` response.
- **Definition of Done (DoD)**:
  1. Switching to "Thay đổi (Diff)" shows a list of touched files with `+N / -M` badges.
  2. Clicking a file renders the line-by-line diff.
  3. Works reliably on both Git repositories and non-Git project folders.

---

### Phase 4: Bottom Panel (Command & Tool Call Log, Test Results)
*Deliverable: Collapsible bottom panel showing command outputs, terminal tool calls, and test status.*

- **Backend Files**:
  - Taps into existing orchestrator events (`tool_call` of type `bash` and their completion outputs). No new server endpoints needed.
- **Frontend Files**:
  - `ui/js/ide/bottom-panel.js` (new): Resizable collapsible drawer at the bottom of the IDE with tabs: "Lệnh / Tool Calls", "Kết quả Test".
  - `ui/js/ide/terminal-stream.js` (new): Read-only ANSI-styled log viewer rendering stdout/stderr from bash runs.
  - `ui/js/app.js` (edit): Forward relevant live SSE `tool_call` events to the bottom panel.
- **Unit Tests (`node:test`)**:
  - `tests/ui-ide-panel.test.ts`: Test parsing of test output summaries (`passed`, `failed`), ANSI strip/formatting, and panel collapse state persistence.
- **Definition of Done (DoD)**:
  1. Bottom panel can be collapsed, expanded, or resized.
  2. When an AI role runs `bash` or `test`, the exact command line and stdout/stderr stream in real-time.
  3. Test results display clear pass/fail status chips.

---

## 6. What NOT to Do (Anti-Goals & Explicit Non-Goals)

To prevent scope creep and keep Agent Company fast, lightweight, and maintainable, the following are strictly **out of scope**:

1. **NO Heavy Editor Frameworks (Monaco / CodeMirror / Ace)**:
   - We will not bundle Monaco (which adds 20MB+ of minified web workers and complex build pipelines). A styled, robust HTML5 textarea with monospace font, tab-key trapping, line numbers, and regex-based token highlighting meets 95% of review and quick-edit needs.
2. **NO Interactive PTY Terminal (xterm.js + node-pty)**:
   - Agent Company is an orchestrated autonomous multi-agent environment, not a remote SSH terminal. Running an interactive PTY introduces severe security attack surfaces and native compilation issues on Windows. The bottom panel is strictly an execution log viewer.
3. **NO Language Server Protocol (LSP) or Extension System**:
   - No auto-complete daemons, IntelliSense servers, or VS Code extension hosts. External deep authoring belongs in the user's dedicated IDE (VS Code / JetBrains).
4. **NO Real-time Collaborative Multi-Cursor Typing (CRDT / Operational Transform)**:
   - We avoid OT/CRDT complexities. File locking and optimistic concurrency with ETag / SHA-256 conflict detection is completely sufficient for pair programming with an AI.
5. **NO External NPM Dependencies**:
   - Zero additions to `package.json` dependencies.

---

## 7. Architecture Decision Records (ADRs)

### ADR-IDE-001: Pure Standard Library Myers Diff vs External Diff Library
- **Status**: Accepted
- **Context**: Non-git workspaces need file diffing, but project constraints forbid adding third-party dependencies.
- **Decision**: Implement a compact, pure TypeScript Myers diff algorithm (~90 lines) in `src/ide-diff.ts`. For Git repositories, delegate directly to `git diff` via `execFile`.
- **Consequences**: Zero dependency overhead, 100% deterministic output, tested under `node:test`.

### ADR-IDE-002: Optimistic Concurrency Control via SHA-256 Hashes
- **Status**: Accepted
- **Context**: Both user and AI roles write to the same filesystem concurrently.
- **Decision**: The server issues a content SHA-256 hash on read. The client sends this hash on save as `expectedSha256`. The server rejects writes with `409 Conflict` if the disk hash has changed.
- **Consequences**: Prevents silent overwrites with zero background polling overhead.
