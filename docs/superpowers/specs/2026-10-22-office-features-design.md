# Agent Company — Office Features Technical Architecture & API Design

Date: 2026-10-23 · Status: Proposed · Branch: `dev/office-features`

## 1. Executive Summary

This document specifies the technical design, contracts, interfaces, and test strategies for the four new features in branch `dev/office-features`:
1. **Spatial Character Walking & Direct Interaction**: Replace static link arrows between desks with walking pixel-art characters, conversation bubbles, and waiting postures, respecting replay speeds and `prefers-reduced-motion`.
2. **Workspace In-Menu Rename**: Rename workspaces directly via the UI with `PATCH /workspaces/:id`.
3. **Directory Browser for Workspace Creation**: Interactive folder picker backed by a secure, directory-only server browsing API with drive selection, parent navigation, and hidden-folder filtering.
4. **Office Customization (Roles + Rooms + Templates)**: Workspace office configuration persisted in `<workspace>/.company/config.json` with built-in templates (Startup MVP, Software House, Content & Marketing, Research Lab), dynamic desk layout, and role store integration.

---

## 2. Feature 1: Spatial Character Walking & Direct Interaction

### 2.1 Intent & Visual Concept
Instead of drawing SVG connection lines (`links`) between desks, characters move across the office to interact:
- **Handoff (Task delegation)**: Sender character leaves their desk, walks to receiver's desk, displays a brief speech bubble with the goal, then receiver begins work.
- **Checkpoint (Report / Decision)**: Reporting role walks to the Manager's desk, shows the report title, and either waits for an answer (if `needs_decision`) or returns.
- **Approval Request**: Role walks to the user entrance spot, alerts the user, and waits.
- **Manager Reply**: Manager walks to the user entrance to report progress.
- **Waiting Roles**: When role A waits on role B (blocking delegation), role A either stands beside role B's desk or displays a waiting posture/indicator at their desk until B's task concludes, then walks back.
- **No Desks Connection Lines**: Remove `drawLinks` SVG arrow paths between desks.

### 2.2 Pixel-Art Walking Mechanics & Sprites
- **Walk Cycle**: A 2-frame or 4-frame CSS step animation modifying leg positions and slight vertical body bobbing (`@keyframes walk-cycle { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }` combined with leg pixels).
- **Facing Direction**: The walking sprite faces left or right dynamically based on movement delta:
  ```css
  .actor.face-left { transform: scaleX(-1); }
  .actor.face-right { transform: scaleX(1); }
  ```
- **Actor Layer**: Desks remain structurally stationary. When a character moves:
  1. An `.actor` element is instantiated in `.actor-layer` at point $(x_1, y_1)$ matching the sender's desk coordinate.
  2. The sender's desk chair shows an "away" state (character opacity 0.2 or empty chair).
  3. The `.actor` translates to $(x_2, y_2)$ adjacent to the receiver's desk over duration $T$.
  4. On arrival, a pixel speech bubble pops up with brief text (`tail(label, 60)`).
  5. Upon return, the actor walks back to $(x_1, y_1)$, is removed from `.actor-layer`, and the desk character restores to sitting.

### 2.3 Replay Speed & Accessibility
- **Speed Multipliers**: Replay speeds (1x, 4x, 16x) scale duration:
  $$\text{duration} = \max(80\text{ms}, \frac{T_{\text{base}}}{\text{speed}})$$
- **Instant Mode / Final State (`speed === 0` or `speed === Infinity`)**: Skip actor spawning and walking animation immediately.
- **Accessibility (`prefers-reduced-motion`)**:
  When `matchMedia("(prefers-reduced-motion: reduce)").matches` is true:
  - Skip translation animation; actor teleports or speech bubble renders directly without moving sprites.

---

## 3. Feature 2: Workspace Rename

### 3.1 HTTP API Contract

#### `PATCH /workspaces/:id`
- **Headers**:
  - `Content-Type: application/json`
  - `Host`: must match `127.0.0.1:<port>` or `localhost:<port>`
  - `Origin`: checked against allowed origins
- **Request Body**:
  ```json
  {
    "name": "New Project Title"
  }
  ```
- **Responses**:
  - `200 OK`:
    ```json
    {
      "id": "mmo-shop-7a8f3b",
      "name": "New Project Title",
      "path": "D:\\projects\\mmo-shop"
    }
    ```
  - `400 Bad Request`: `{ "error": "name is required" }` (if empty or not a string)
  - `404 Not Found`: `{ "error": "unknown workspace <id>" }`
  - `415 Unsupported Media Type`: if `Content-Type` is not `application/json`

### 3.2 Backend Implementation (`src/workspace.ts` & `src/server.ts`)
- **`WorkspaceStore.rename(id: string, name: string): Workspace`**:
  - Trims `name`. Throws `Error("name is required")` if empty.
  - Finds workspace by `id`. Throws `Error("workspace not found")` if missing.
  - Updates in-memory entry and rewrites `workspaces.json`.
  - Returns updated `Workspace`.
- **`server.ts`**:
  - Intercepts `m === "PATCH" && parts[0] === "workspaces" && parts[1] && !parts[2]`.
  - Updates `ctx.ws` if active in `ctxs`.

### 3.3 UI Implementation (`ui/js/app.js` & `ui/js/api.js`)
- `api.renameWorkspace(id, name)`: sends `PATCH /workspaces/${id}`.
- In `renderWorkspaceMenu()`:
  - An edit pencil icon button `[data-act="rename-ws"]` is added beside the active workspace.
  - Clicking prompts via `ask({ title: "Đổi tên workspace", fields: [...] })`.
  - Updates `app.workspaces`, refreshes menu and header.

---

## 4. Feature 3: Directory Browser for Workspace Creation

### 4.1 Security Constraints
- **Subdirectory Metadata Only**: Never read file contents or list files. Only subdirectories are returned.
- **Localhost Enforcement**: Bound to `127.0.0.1` and protected by existing Host/Origin/CORS checks.
- **Hidden & System Folder Filtering**:
  - Directory names starting with `.` (e.g. `.git`, `.company`, `.ssh`, `.cache`) are excluded.
  - Windows system folders (e.g. `$Recycle.Bin`, `System Volume Information`, `Recovery`, `Windows`) are excluded.
- **Graceful Permission Handling**: Catch `EACCES` / `EPERM` without crashing, returning an empty list or friendly notice.

### 4.2 HTTP API Contracts

#### `GET /fs/drives`
- Returns available filesystem roots and user home directory:
  ```json
  {
    "roots": [
      { "name": "C:", "path": "C:\\" },
      { "name": "D:", "path": "D:\\" }
    ],
    "home": "C:\\Users\\Hi"
  }
  ```
  *(On Linux/macOS, roots contains `[{ "name": "/", "path": "/" }]`)*.

#### `POST /fs/browse`
- **Request Body**:
  ```json
  {
    "path": "D:\\projects"
  }
  ```
  *(If `path` is omitted or empty, defaults to user home directory)*.
- **Response `200 OK`**:
  ```json
  {
    "current": "D:\\projects",
    "parent": "D:\\",
    "folders": [
      { "name": "agent-company", "path": "D:\\projects\\agent-company" },
      { "name": "ecommerce-api", "path": "D:\\projects\\ecommerce-api" }
    ]
  }
  ```
- **Error `400 Bad Request`**: If path does not exist or is not a folder.

### 4.3 UI Implementation
- Interactive folder browsing modal in `ui/js/app.js`:
  - Quick action buttons: Roots/Drives (`C:`, `D:`), Home (`~`), Up (`..`).
  - Path input bar allowing direct path pasting or manual typing.
  - Scrollable folder list with folder icons. Click navigates inside.
  - Selected folder preview with button "Chọn thư mục này làm workspace".

---

## 5. Feature 4: Office Customization (Roles + Rooms + Templates)

### 5.1 Workspace Configuration Schema (`<workspace>/.company/config.json`)

```json
{
  "template": "software-house",
  "roles": ["manager", "architect", "developer", "reviewer", "devops", "critic"],
  "rooms": [
    { "id": "manager", "name": "Phòng Điều hành", "roles": ["manager"] },
    { "id": "planning", "name": "Phản biện & Thiết kế", "roles": ["architect", "critic"] },
    { "id": "engineering", "name": "Kỹ thuật & Vận hành", "roles": ["developer", "reviewer", "devops"] }
  ],
  "limits": {
    "maxDepth": 6,
    "maxPairRounds": 4,
    "maxConcurrent": 3
  }
}
```

### 5.2 Built-in Office Templates
1. **Startup MVP**:
   - `roles`: `["manager", "brainstormer", "product-manager", "developer"]`
   - `rooms`: Strategy ("Chiến lược & Sản phẩm"), Executive ("Phòng Manager"), Engineering ("Kỹ thuật").
2. **Software House**:
   - `roles`: `["manager", "architect", "developer", "reviewer", "devops", "critic"]`
   - `rooms`: Executive ("Phòng Điều hành"), Design & Critique ("Phản biện & Thiết kế"), Engineering ("Kỹ thuật & Vận hành").
3. **Content & Marketing**:
   - `roles`: `["manager", "brainstormer", "marketing", "critic"]`
   - `rooms`: Executive ("Phòng Manager"), Creative ("Sáng tạo & Tiếp thị"), Review ("Duyệt & Đánh giá").
4. **Research Lab**:
   - `roles`: `["manager", "planner", "critic", "brainstormer"]`
   - `rooms`: Executive ("Phòng Điều hành"), Research ("Nghiên cứu & Ý tưởng"), Critique ("Phản biện học thuật").

### 5.3 Invariant Rules
- **Manager Required**: The `manager` role is strictly mandatory and cannot be removed.
- **Installed Roles Guarantee**: If a template or custom selection contains a role not yet installed, the UI indicates "(Chưa cài)" and provides a one-click shortcut to install it via the Role Store (`openStore()`).
- **Dynamic Floor Plan Rendering**:
  `deskLayout(roles, rooms)` in `ui/js/layout.js` maps roles into their designated rooms. If a role is not explicitly assigned to a room, it defaults to the Specialists room.

### 5.4 HTTP API Contracts

#### `PUT /workspaces/:id/config`
- **Request Body**:
  ```json
  {
    "roles": ["manager", "developer", "critic"],
    "rooms": [...],
    "template": "software-house"
  }
  ```
- **Responses**:
  - `200 OK`: returns the persisted configuration.
  - `400 Bad Request`: if `manager` is missing or invalid structure.

---

## 6. Architecture Decision Records (ADRs)

### ADR-001: Separation of Mobile Actor Layer from Static Desk DOM
- **Status**: Accepted
- **Context**: Drawing walking characters directly inside the desk DOM hierarchy complicates z-indexing, relative positioning, and CSS transforms, causing layout shifts.
- **Decision**: Introduce a dedicated `.actor-layer` inside `.scene`. When an interaction begins, an ephemeral `.actor` is placed at the scene-pixel coordinates of the origin, animates to the destination, and is removed upon task completion. The desk avatar displays an "away" state.
- **Consequences**: Desks remain stationary anchors. Desks and actors share identical SVG sprite assets without DOM nesting issues.

### ADR-002: Directory Browsing Restricted to Metadata Only
- **Status**: Accepted
- **Context**: The app needs folder selection for workspaces without arbitrary file system exposure or security vulnerabilities.
- **Decision**: Server exposes `/fs/drives` and `/fs/browse` that only inspect `stat.isDirectory()`, filter out dotfiles/system directories, and never read file data. All standard localhost/Origin/Host guards apply.
- **Consequences**: Zero risk of accidental secret/file leakage while enabling an intuitive browser dialog.

### ADR-003: Declarative Workspace Office Configuration
- **Status**: Accepted
- **Context**: Users want custom offices per workspace without altering global settings or hardcoding layout zones.
- **Decision**: Extend `<workspace>/.company/config.json` with `rooms` and `template`. `WorkspaceStore.config()` and `saveConfig()` provide round-trip persistence with validation enforcing the `manager` invariant.
- **Consequences**: Each workspace owns its office topology. Switching workspaces dynamically redraws the appropriate floor plan.

---

## 7. Files to Modify & Create

| Category | File | Action | Responsibilities |
|---|---|---|---|
| Backend | `src/workspace.ts` | Edit | Add `WorkspaceConfig.rooms`, `WorkspaceConfig.template`, `rename()`, `saveConfig()`. |
| Backend | `src/server.ts` | Edit | Add routes `PATCH /workspaces/:id`, `PUT /workspaces/:id/config`, `GET /fs/drives`, `POST /fs/browse`. |
| Frontend | `ui/js/layout.js` | Edit | Accept configurable `rooms`, compute dynamic desk slots per room, fallback to specialists. |
| Frontend | `ui/js/office.js` | Edit | Remove `drawLinks`, implement `spawnWalkingActor()`, speech bubble popup, waiting posture. |
| Frontend | `ui/js/sprites.js` | Edit | Add walking cycle variations or CSS keyframes, waiting posture attributes. |
| Frontend | `ui/js/api.js` | Edit | Add `renameWorkspace`, `saveWorkspaceConfig`, `fsDrives`, `fsBrowse`. |
| Frontend | `ui/js/app.js` | Edit | Integrate folder browser dialog, workspace rename action, office customizer dialog with template selector. |
| Styling | `ui/styles.css` | Edit | Add styles for `.actor-layer`, `.actor`, `.actor-bubble`, `.folder-browser`, `.office-customizer`. |
| Tests | `tests/workspace.test.ts` | Edit | Unit tests for `rename`, `saveConfig`, manager invariant. |
| Tests | `tests/server.test.ts` | Edit | Integration tests for `PATCH /workspaces/:id`, `PUT .../config`, `/fs/drives`, `/fs/browse`. |
| Tests | `tests/ui-office.test.ts` | Edit | Tests for dynamic desk positioning with custom rooms, walking speed calculation. |
| Documentation | `docs/ARCHITECTURE.md` | Edit | Update API tables, configuration format, and UI architecture. |
| Documentation | `index.md` | Edit | Update feature status and documentation references. |

---

## 8. Technical Risks & Mitigations

1. **Walking Animation Desynchronization during Rapid Replay**:
   - *Risk*: At 16x replay speed or instant forward, hundreds of events could spawn overlapping actors.
   - *Mitigation*: Check `speed === 0 || speed === Infinity` or if elapsed time is below threshold; instantly bypass actor creation and resolve effects. Use `app.gen` generation counters to immediately wipe `.actor-layer` on run/workspace change.
2. **Path Traversal & Windows Drive Probing**:
   - *Risk*: Malformed path strings or probing non-existent drive letters (e.g. floppy or network drives) can cause OS timeouts.
   - *Mitigation*: On Windows, probe common letters `C:` through `Z:` safely with `existsSync` wrapped in try/catch; normalize all paths with `node:path`; refuse any relative upward traversal beyond root.
3. **Configuration Conflicts with Uninstalled Roles**:
   - *Risk*: User applies a template that requires catalog roles not currently installed.
   - *Mitigation*: The customizer inspects installed roles; unavailable roles are flagged with a direct link to install them via the existing role store dialog before enabling them.

---

## 9. Test Strategy (TDD with `node:test`)

1. **Phase 1: Workspace In-Memory & File Store (`tests/workspace.test.ts`)**:
   - Test `rename(id, newName)` updates file and returns object.
   - Test `rename` throws on empty/whitespace-only names.
   - Test `saveConfig` saves `roles`, `rooms`, `template` while preserving default limits and mandatory `manager`.
2. **Phase 2: Server API Endpoints (`tests/server.test.ts`)**:
   - `PATCH /workspaces/:id`: 200 with updated name; 400 on empty name; 404 on invalid id; 403 on invalid host/origin.
   - `GET /fs/drives`: 200 with `roots` array and `home` string.
   - `POST /fs/browse`: 200 listing only subdirectories; excludes hidden files; 400 on non-existent path.
   - `PUT /workspaces/:id/config`: 200 saves config; 400 when omitting `manager`.
3. **Phase 3: UI Layout & Office Engine (`tests/ui-office.test.ts`, `tests/ui-layout.test.ts`)**:
   - Verify `deskLayout` arranges desks correctly when custom rooms are provided.
   - Verify all template presets produce valid non-overlapping coordinates.
   - Verify replay speeds correctly adjust walking animation durations.
