# Question Selector in Flow and Log Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Provide a synchronized "Question" (Câu hỏi) selector at the top of both "Luồng việc" (Flow) and "Nhật ký" (Log) tabs, listing user questions sent in the workspace (newest first, showing truncated content, time, and status). Selecting a question displays its dedicated task tree and log slice, supports live updates for the current question, fetches past run events on demand, and keeps the Office and Chat panels strictly in live mode without entering replay.

**Architecture:** Pure derivation functions in `ui/js/derive.js` (`extractQuestions`, `filterQuestionData`) partition events and tasks by user question boundaries (node:test unit-tested). `ui/js/panels.js` renders the selector bar and question-filtered tree/log views. `ui/js/app.js` manages question selection state, caches past run events fetched via `api.events(runId)`, keeps selectors in sync between Flow and Log tabs, and live-updates the current question via SSE without altering office/chat live rendering.

**Tech Stack:** Vanilla ES2022 modules (`ui/js/*.js`), pure CSS (`ui/styles.css`), standard HTML5 semantic elements with keyboard accessibility, Node.js test runner (`node:test`, `node:assert/strict`). Zero extra dependencies.

**Spec:** User prompt requirements:
- Selector at the head of Luồng việc (Flow) and Nhật ký (Log) tabs listing workspace questions, newest first: truncated content, time, status (đang chạy/xong/dừng). Default is current question.
- Mid-run follow-up questions (`user_message` during active run) are distinct items.
- Selecting a question renders its task tree and log. Office and Chat stay in live mode (no replay switch).
- Running question updates live. Past question loads from `/runs/:runId/events`.
- Log role and type chips apply to the selected question.
- Keyboard accessible, Vietnamese UI, zero extra dependencies, single commit `feat(ui): ...`, update `docs/ARCHITECTURE.md`.
- No long-running server in bash.

## Global Constraints
- No build step; files under `ui/` load directly in the browser as ES modules.
- Language conventions: Vietnamese for UI labels and notifications, English for code, comments, commit messages, and architecture docs.
- Zero added external dependencies.
- No long-running background processes or dev server in bash commands.
- Test runner: `node --test "tests/**/*.test.ts"`.
- Type checking: `npm run check` (`tsc --noEmit`).
- Single git commit: `feat(ui): add question selector to flow and log tabs`.

## Review Focus
1. **Mid-run follow-up question:** When user sends a message while a run is already active, it generates a new `user_message`. The question list must show this as a distinct newest question with status "đang chạy", while the previous question in the same run is preserved with its own tasks and log. (Pinned in Task 1 test `extractQuestions separates mid-run follow-up messages`.)
2. **Past run question selection without breaking live mode:** Selecting a past run question fetches its events via `api.events(runId)` without triggering `startReplay()` or mutating `app.mode`. Chat and Office must continue rendering live state. (Pinned in Task 3 browser/wiring check.)
3. **Two-way synchronization between Flow and Log tabs:** Selecting a question in the Flow tab immediately updates the Log tab's dropdown to match, and vice versa. Switching tabs keeps the selected question intact. (Pinned in Task 2 & 3 sync handler.)
4. **Log filtering on selected past question:** Log role dropdown (`#log-role`) and category chips (`#log-type`) must filter the log events of the *selected* question, not crash or revert to live log. (Pinned in Task 2 test & Task 3 verification.)
5. **Keyboard accessibility and empty/single-question states:** The `<select>` element must be operable via Tab, Up/Down arrow keys, Enter, and have clear `aria-label` and Vietnamese text. Workspaces with 0 runs display graceful empty state. (Pinned in Task 2 & 3 checks.)

---

### Task 1: Pure Functions for Question Extraction & Data Slicing (TDD)

**Files:**
- Modify: `ui/js/derive.js`
- Test: `tests/ui-derive.test.ts`

**Interfaces:**
```js
/**
 * Represents a user prompt/question item.
 * @typedef {{
 *   id: string,               // e.g. `${runId}:seq-${seq}`
 *   runId: string,
 *   seq: number,              // event sequence of the user_message
 *   text: string,             // full text
 *   shortText: string,        // truncated preview
 *   ts: string,               // ISO timestamp
 *   status: "running"|"done"|"stopped", // "đang chạy"|"xong"|"dừng"
 *   isCurrent: boolean,
 * }} WorkspaceQuestion
 */

/**
 * Extract all questions across runs and active live log, sorted newest first.
 * @param {{
 *   runs: Array<{runId: string, startedAt: string, endedAt?: string, status: string, firstMessage: string}>,
 *   liveLog?: Array<{runId: string, seq: number, ts: string, type: string, data?: any}>,
 *   activeRunId?: string|null,
 *   cachedEvents?: Record<string, Array<any>>,
 * }} params
 * @returns {WorkspaceQuestion[]}
 */
export function extractQuestions({ runs, liveLog = [], activeRunId = null, cachedEvents = {} });

/**
 * Filter tasks and log events corresponding to a specific question.
 * @param {{
 *   questionId: string,
 *   questions: WorkspaceQuestion[],
 *   events: Array<any>,
 *   tasks: Record<string, any>,
 * }} params
 * @returns {{ tasks: Record<string, any>, log: Array<any> }}
 */
export function filterQuestionData({ questionId, questions, events, tasks });
```

- [ ] **Step 1: Write failing unit tests in `tests/ui-derive.test.ts`**
  - Test 1: `extractQuestions extracts single question per finished run from run summary`.
  - Test 2: `extractQuestions extracts mid-run follow-up messages from liveLog as distinct questions`.
  - Test 3: `extractQuestions marks active run question as running and finished run questions as done/stopped`.
  - Test 4: `filterQuestionData slices events and tasks between consecutive user_messages in the same run`.
  - Test 5: `filterQuestionData returns all tasks and events when run has only one question`.
- [ ] **Step 2: Run tests to verify they fail**
  - Command: `node --test tests/ui-derive.test.ts`
  - Expected: Fail with `extractQuestions is not a function`.
- [ ] **Step 3: Implement `extractQuestions` and `filterQuestionData` in `ui/js/derive.js`**
  - Truncate question previews cleanly (e.g. 52 characters + `…`).
  - Map run/task statuses to Vietnamese status labels: `running` → "đang chạy", `done` → "xong", `stopped`/`failed`/`cancelled` → "dừng".
  - Partition event streams using `seq` intervals: events between `user_message[i].seq` and `user_message[i+1].seq` belong to question `i`.
  - Associate tasks created in that sequence interval with question `i`.
- [ ] **Step 4: Run tests to verify they pass**
  - Command: `node --test tests/ui-derive.test.ts`
  - Expected: All tests in `tests/ui-derive.test.ts` pass green.
- [ ] **Step 5: Type check**
  - Command: `npm run check`
  - Expected: Clean compilation, 0 errors.

---

### Task 2: UI Templates & Panel Rendering for Question Selector

**Files:**
- Modify: `ui/index.html`
- Modify: `ui/styles.css`
- Modify: `ui/js/panels.js`
- Test: `tests/ui-markdown.test.ts` (or add panel layout check in `tests/ui-office.test.ts`)

- [ ] **Step 1: Add Question selector HTML containers in `ui/index.html`**
  - In `<div class="tab-panel" data-panel="flow">`:
    Add a header toolbar containing `<label class="question-bar"><span>Câu hỏi:</span><select id="flow-question" class="select question-select" aria-label="Chọn câu hỏi trong Luồng việc"></select></label>`.
  - In `<div class="tab-panel" data-panel="log">`:
    Add the question bar `<label class="question-bar"><span>Câu hỏi:</span><select id="log-question" class="select question-select" aria-label="Chọn câu hỏi trong Nhật ký"></select></label>` above the existing chips and role filter.
- [ ] **Step 2: Add styles in `ui/styles.css`**
  - Style `.question-bar`: clean flex row, subtle border-bottom, alignment with `.log-filters`.
  - Style `.question-select`: full width or flexible width, ellipsis overflow, distinct indicator for active question.
  - Keyboard focus states (`:focus-visible`) matching existing system design.
- [ ] **Step 3: Update `renderFlow` and `renderLog` in `ui/js/panels.js` to accept filtered question data**
  - Export helper `renderQuestionOptions(selectEl, questions, selectedId)`:
    - Generates `<option value="${q.id}">[${STATUS_LABEL[q.status]}] ${esc(q.shortText)} · ${time(q.ts)}${q.isCurrent ? " (Hiện tại)" : ""}</option>`.
  - Ensure `renderFlow` uses the provided task subset and respects empty states with informative Vietnamese messages ("Chưa có việc nào cho câu hỏi này.").
  - Ensure `renderLog` applies role and type filters against the provided event subset.
- [ ] **Step 4: Verify UI rendering via tests**
  - Command: `npm test`
  - Expected: All existing tests pass without regressions.

---

### Task 3: State Management & Wiring in `ui/js/app.js`

**Files:**
- Modify: `ui/js/app.js`

**State variables to introduce in `app.js`:**
- `app.selectedQuestionId`: string (defaults to `"current"` or active question ID).
- `app.cachedRunEvents`: `Map<string, TeamEvent[]>` (caches loaded events for past runs to avoid refetching).
- Elements: `el.flowQuestion = $("#flow-question")`, `el.logQuestion = $("#log-question")`.

- [ ] **Step 1: Wire question extraction into app rendering cycle**
  - In `draw()`:
    1. Call `extractQuestions` using `app.runs`, `app.live.log`, and `app.live.runId`.
    2. Determine effective question: if `app.selectedQuestionId` is `"current"` or not found, pick the current question.
    3. Update both `el.flowQuestion` and `el.logQuestion` with `renderQuestionOptions`.
    4. If the selected question belongs to the current run:
       - Slice tasks and log with `filterQuestionData`.
       - Pass sliced data to `renderFlow` and `renderLog`.
    5. If the selected question belongs to an older run:
       - Check `app.cachedRunEvents.get(q.runId)`. If not cached, fetch via `api.events(q.runId)` asynchronously, reduce into a question sub-state, and re-render panels.
       - Note: Office and Chat remain tied to `app.live`! No call to `startReplay()`.
- [ ] **Step 2: Wire change event listeners on question selectors**
  - Add event listeners to both `el.flowQuestion` and `el.logQuestion`:
    - On change: update `app.selectedQuestionId = this.value`, synchronize the other `<select>.value`, reset panel signatures (`el.flow.dataset.sig = ""`, `el.log.dataset.sig = ""`), and trigger `render()`.
- [ ] **Step 3: Handle live updates & reset on workspace switch**
  - When SSE receives events (`onLiveEvent`):
    - If `app.selectedQuestionId` is the current question, the new tasks and logs appear immediately.
    - If a new follow-up `user_message` is sent, `extractQuestions` immediately detects the new question; if user was watching the live question, selection updates to the new current question.
  - When workspace changes (`openWorkspace`):
    - Clear `app.cachedRunEvents`.
    - Reset `app.selectedQuestionId = "current"`.
- [ ] **Step 4: Verify end-to-end**
  - Verify switching between questions updates Flow tree and Log entries.
  - Verify changing Log filter chips while an older question is selected filters that question's log.
  - Verify Chat composer and Pixel Office remain in live mode at all times.

---

### Task 4: Documentation, Verification & Git Commit

**Files:**
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Update `docs/ARCHITECTURE.md`**
  - Section 10 ("UI architecture"): Document the Question Selector feature in Flow and Log tabs, explaining the question boundary model (`extractQuestions`, `filterQuestionData`) and how panels inspect specific questions while the office and chat stay live.
- [ ] **Step 2: Run test suite & type checker**
  - Run `npm test` (all unit tests must pass).
  - Run `npm run check` (`tsc --noEmit` must pass with 0 errors).
- [ ] **Step 3: Git commit**
  - Commit all changes in a single focused commit:
    `git commit -m "feat(ui): add question selector to flow and log tabs"`
- [ ] **Step 4: Verify git status & diff hygiene**
  - Ensure no untracked files, no secret leaks, clean status.

---

## Plan Self-Check
- [x] All 4 requirements addressed (Selector in Flow and Log, mid-run follow-up questions, live chat/office preserved, on-demand loading of past events).
- [x] TDD approach specified (unit tests in `tests/ui-derive.test.ts` before implementation).
- [x] Keyboard accessibility ensured via standard `<select>` with `:focus-visible` styling.
- [x] Zero added external dependencies.
- [x] Single commit `feat(ui): ...`.
- [x] No long-running servers in bash.
