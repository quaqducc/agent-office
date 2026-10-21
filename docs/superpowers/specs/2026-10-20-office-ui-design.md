# Agent Company — Office UI Design

Date: 2026-10-20 · Status: approved by delegation (user granted full decision rights) · Depends on: orchestrator (merged)

## 1. Intent

The user wants to *watch* their AI team work: a small 2D office where each role is a pixel
character at a desk, and every interaction (handoffs, checkpoints, approvals, replies) is visible as
it happens. They talk only to the Manager, check logs, and understand the process (team structure,
the flow of the plan, results). Code is read in VS Code, not here.

## 2. Goals

1. **Office view**: one character per active role, placed by department; live status per character
   (idle / working / waiting on another role / waiting for the user's approval); visible handoffs
   (a paper plane flies from sender desk to receiver desk with the goal in a speech bubble),
   checkpoints (flag carried to the Manager's room), approvals (red "!" + banner).
2. **Chat with the Manager** (send messages, see replies rendered as Markdown).
3. **Flow view**: the run's task tree (who delegated what to whom, status, result) = "the plan".
4. **Log view**: all events, filterable by role and type; click to expand raw data.
5. **Role detail**: click a character → its persona summary, current task, its messages and tool
   calls in this run.
6. **Approvals**: approve / reject / edit pending real-world actions (the only place besides CLI).
7. **History**: pick a past run of the workspace and replay it in the office at x1 / x4 / x16 / instant.
8. **Workspaces**: switch between registered workspaces, register a new folder.

## 3. Non-goals

Code viewing/editing, auth/multi-user, mobile-first polish (must still be usable at 1024px+;
narrow screens stack panels), sound, editing roles from the UI, walking/path-finding animations.

## 4. Anti-goals

A UI that hides events (everything in the log must be reachable); an approval flow reachable by a
third-party page (keep the server's Origin/Host checks); a build toolchain the user must run.

## 5. Decisions (designer's calls under delegated authority)

- **Served by the orchestrator** at `GET /` (same origin → no CORS config). The server
  automatically allows its own origins (`http://127.0.0.1:<port>`, `http://localhost:<port>`).
- **No build step**: plain HTML/CSS + native ES modules in `ui/`; `marked` (already a transitive
  dependency; add it as a direct, pinned dependency) served at `/vendor/marked.js`.
- **State is a pure reducer** `reduce(state, event)` in `ui/js/state.js`, shared by live mode and
  replay, unit-tested under Node.
- **Rendering is DOM + CSS** (absolutely positioned desks/characters, CSS transitions), not canvas:
  accessible, inspectable, no game engine.
- **Pixel characters are generated SVG** from a 16×16 template with per-role palettes and one
  accessory per role (tie, glasses, headset…). No external art assets, no licensing questions.
- **Floor plan** (desks by department; roles not listed go to "Specialists"):
  - Manager's room: manager
  - Strategy: brainstormer, business-strategist, product-manager, marketing
  - Planning & Review: planner, critic
  - Engineering: architect, developer, ai-engineer, devops, ui-ux, reviewer
- **Live data flow**: open `EventSource('/events?workspace=…')` first, then fetch the active run's
  events (`GET /runs/:id/events`) and merge, de-duplicating by `seq` per run.
- Typography: system UI font for text; "Press Start 2P" (Google Fonts) only for the office title and
  name tags, with a monospace fallback. Light/dark via `prefers-color-scheme`.

## 6. Server additions

- `GET /` → `ui/index.html`; `GET /ui/*` static files (path-traversal safe, correct content types).
- `GET /vendor/marked.js` → `node_modules/marked/lib/marked.esm.js`.
- `GET /workspaces/:id/config` → `{ roles, limits }` (the office shows only active roles).
- Own origins allowed in addition to `COMPANY_ALLOWED_ORIGINS`.

## 7. State model (reducer contract)

```
state = {
  runId, runStatus: "idle"|"active"|<run_finished status>, tokens,
  roles: { [id]: { status: "idle"|"working"|"waiting"|"approval", taskId?, waitingOn?: string } },
  tasks: { [taskId]: { id, parentTaskId, from, to, goal, status, result?, depth } },
  chat: [{ who: "user"|"manager", text, ts }],
  log: TeamEvent[]            // every non-delta event, in order
  approvals: { [checkpointId]: { role, title, action, summary } },   // pending only
  effects: [{ kind: "handoff"|"checkpoint"|"approval"|"reply", from, to, label, seq }],  // animation queue, consumed by the view
  streaming: { [role]: string }  // current message_delta text per role (cleared on message)
}
```
Event → state rules: `task_status running` → role working; a `task_created` whose `from` is a
non-manager role → sender `waiting` (waitingOn = to) until that child task ends; `approval_request`
→ role `approval` + approvals entry; `checkpoint_reply` by user removes it; `run_finished` → all
roles idle, approvals cleared.

## 8. Verification

- Node unit tests for the reducer (fixtures from real event shapes) and for the new server routes.
- A real-model run driven through the UI in a headless browser (Edge via the `edge-private`
  Playwright MCP): register workspace, send a message, observe handoff/checkpoint effects and the
  task tree, screenshot light + dark.
