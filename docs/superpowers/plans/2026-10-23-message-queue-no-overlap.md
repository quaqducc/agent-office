# Hàng đợi tin nhắn - Không xử lý chồng lấn (Message Queue) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Implement persistent, serialized message queuing per workspace. When a run is active, incoming user messages enter a persistent queue (`<workspace>/.company/queue.json`) instead of interrupting or interleaving with the active run. As soon as the active run completes or is stopped, the next queued message automatically starts a new run. Queued messages survive server restarts, can be cancelled individually via API/UI, and checkpoint approvals bypass the queue completely.

**Architecture:**
- **Storage (`WorkspaceStore` in `src/workspace.ts`):** Atomic persistence of `QueuedMessage[]` in `<workspace>/.company/queue.json`.
- **Orchestration (`Router` in `src/router.ts` & `src/server.ts`):** `Router.sendUserMessage()` inspects `this.active`. If an active run exists, it persists the message to the workspace queue and returns `{ queued: true, position: queue.length }`. When the current run finishes (`finishRun()`) or stops (`stopRun()`), `drainQueue()` triggers the next message in FIFO order under a strict mutual exclusion lock (`drainingMutex`) to prevent race conditions. Server startup drains lingering queued messages.
- **HTTP Server (`src/server.ts`):**
  - `POST /workspaces/:id/messages` returns `{ queued: true, position }` when queued, or `{ runId }` when started immediately.
  - `GET /workspaces/:id/queue` returns the current queued messages array.
  - `DELETE /workspaces/:id/queue/:qid` removes a message by ID and returns `{ deleted: qid }`.
  - `POST /checkpoints/:id/reply` strictly executes immediately without entering the queue.
  - Host/Origin/JSON validation preserved.
- **Frontend (`ui/js/api.js`, `ui/js/app.js`, `ui/index.html`, `ui/styles.css`):**
  - Status banner displays "N tin nhắn đang chờ" when queue is non-empty.
  - Chat feed displays pending messages with label "Đang chờ (#X)" and a "Bỏ" button.
  - Clicking "Bỏ" sends `DELETE /workspaces/:id/queue/:qid`.
  - When a message turns into an active run, SSE emits `run_started` / `user_message` and the UI updates it into a normal chat bubble.
- **Single Git Commit:** `feat(router): implement persistent message queue without overlapping runs`

**Tech Stack:** TypeScript (Node.js >= 22.19, erasable syntax), `node:test`, `node:assert/strict`, vanilla ES modules in `ui/`.

---

## Global Constraints
- Zero added external dependencies.
- No long-running background processes or dev server in bash commands.
- All 5 test cases must use the existing fake runner framework and run under `npm test`.
- TypeScript verification via `npm run check`.
- Vietnamese UI text; English code, comments, documentation, and commit messages.

## Review Focus (Race Condition & Edge Cases)
1. **Run Completion vs Incoming Message Race Condition:**
   - If `sendUserMessage` is called concurrently with `finishRun()`, the queue check and active state transition must be atomic. A mutual exclusion lock / serial microtask queue ensures a message is neither dropped nor concurrently executed with another run.
2. **Crash & Restart Persistence:**
   - After restarting the server (`createServer`), messages lingering in `<workspace>/.company/queue.json` must be picked up and processed sequentially without human intervention.
3. **Run Stoppage (`POST /runs/:id/stop`):**
   - Stopping a run must cancel the current run and immediately proceed to drain the next queued message.
4. **Queue Item Cancellation (`DELETE /workspaces/:id/queue/:qid`):**
   - Deleting a queued item while another run is active cleanly removes it from `queue.json` without disrupting the waiting queue order.
5. **Checkpoint Reply Bypassing Queue:**
   - User approval (`POST /checkpoints/:id/reply`) must resolve waiting tasks directly inside the active run without touching the message queue.

---

### Task 1: Persistent Queue Storage in WorkspaceStore (TDD)

**Files:**
- Modify: `src/workspace.ts`
- Test: `tests/workspace.test.ts`

**Data Type:**
```ts
export interface QueuedMessage {
  id: string;
  text: string;
  createdAt: string;
}
```

- [ ] **Step 1: Write unit tests in `tests/workspace.test.ts`**
  - Test `getQueue returns empty array when queue.json does not exist`.
  - Test `enqueueMessage appends item to queue.json and returns queue position`.
  - Test `dequeueMessage pops first item in FIFO order and updates queue.json`.
  - Test `removeQueuedMessage deletes specific item by id and updates queue.json`.
  - Test `queue survives store re-instantiation (persistence test)`.
- [ ] **Step 2: Run test to verify failure**
  - Command: `node --test tests/workspace.test.ts`
- [ ] **Step 3: Implement Queue methods in `src/workspace.ts`**
  - Define `queueFile(ws: Workspace): string` pointing to `join(companyDir(ws), "queue.json")`.
  - Implement atomic read/write functions for `queue.json`.
  - Implement `WorkspaceStore.getQueue(ws: Workspace): QueuedMessage[]`.
  - Implement `WorkspaceStore.enqueue(ws: Workspace, text: string): { item: QueuedMessage; position: number }`.
  - Implement `WorkspaceStore.dequeue(ws: Workspace): QueuedMessage | undefined`.
  - Implement `WorkspaceStore.removeQueueItem(ws: Workspace, qid: string): boolean`.
- [ ] **Step 4: Run tests to verify pass**
  - Command: `node --test tests/workspace.test.ts`
- [ ] **Step 5: Run typecheck**
  - Command: `npm run check`

---

### Task 2: Router Integration & Race-Free Serialization (TDD)

**Files:**
- Modify: `src/router.ts`
- Test: `tests/router.test.ts`

**Logic Details:**
- Provide `Router` with queue callbacks or direct queue access:
  ```ts
  export interface QueueAdapter {
    getQueue: () => QueuedMessage[];
    enqueue: (text: string) => { item: QueuedMessage; position: number };
    dequeue: () => QueuedMessage | undefined;
    remove: (id: string) => boolean;
  }
  ```
- Update `Router.sendUserMessage(text: string): { runId?: string; queued?: boolean; position?: number; id?: string }`:
  - If `this.active`: enqueue to persistent queue, return `{ queued: true, position, id }`.
  - If NOT `this.active`: create new run as normal, return `{ runId }`.
- When a run finishes (`finishRun`):
  - Mark `this.active = undefined`.
  - Invoke `drainQueue()`:
    - Protect with `private draining = false`.
    - If `this.active` or `this.draining`, return.
    - Set `this.draining = true`.
    - Pop next item from queue: `const next = this.queueAdapter?.dequeue()`.
    - If next: invoke `this.startRun(next.text)`.
    - Set `this.draining = false`.
- If `stopRun` is called:
  - Run finishes, triggers `finishRun()`, which naturally invokes `drainQueue()`.

- [ ] **Step 1: Write unit tests in `tests/router.test.ts`**
  - Test `router queues second message while first run is active`.
  - Test `router automatically starts queued message when first run completes`.
  - Test `router drains next queued message after run is stopped`.
  - Test `router does not overlap runs (mutual exclusion guarantee)`.
- [ ] **Step 2: Run test to verify failure**
  - Command: `node --test tests/router.test.ts`
- [ ] **Step 3: Implement queue integration & drain mechanism in `src/router.ts`**
- [ ] **Step 4: Run tests to verify pass**
  - Command: `node --test tests/router.test.ts`
- [ ] **Step 5: Run typecheck**
  - Command: `npm run check`

---

### Task 3: Server API Endpoints & 5 Required Integration Tests (TDD)

**Files:**
- Modify: `src/server.ts`
- Test: `tests/server.test.ts`

**Endpoints:**
1. `POST /workspaces/:id/messages`
   - Payload: `{ text: string }`.
   - Returns `200 { runId: "..." }` if run starts immediately.
   - Returns `200 { queued: true, position: N, id: "..." }` if queued.
2. `GET /workspaces/:id/queue`
   - Returns `200 QueuedMessage[]`.
3. `DELETE /workspaces/:id/queue/:qid`
   - Removes item from queue. Returns `200 { deleted: qid }`. Returns `404` if not found.
4. `POST /checkpoints/:id/reply`
   - Preserved as immediate execution without touching the queue.
5. Server startup recovery:
   - When a workspace context is initialized (`ctxFor(id)`), if it has queued items and no active run, trigger `drainQueue()`.

- [ ] **Step 1: Write the 5 required integration tests in `tests/server.test.ts`**
  - Test Case 1: `gửi 3 câu liên tiếp → 3 lần chạy tuần tự, không chồng nhau` (Send 3 messages in a row -> 3 sequential runs, 0 overlap).
  - Test Case 2: `xoá tin đang chờ` (Delete waiting message -> removed from queue, subsequent run skips it).
  - Test Case 3: `dừng lần chạy → chạy tiếp tin kế` (Stop active run -> immediately executes next queued message).
  - Test Case 4: `hàng đợi còn sau khi tạo lại server` (Queue persists across server restart and resumes processing).
  - Test Case 5: `reply checkpoint không bị xếp hàng` (Checkpoint reply executes immediately without queueing).
- [ ] **Step 2: Run test to verify failure**
  - Command: `node --test tests/server.test.ts`
- [ ] **Step 3: Implement HTTP routes and startup draining in `src/server.ts`**
  - Hook queue adapter into `Router` options inside `ctxFor(id)`.
  - Add route `GET /workspaces/:id/queue`.
  - Add route `DELETE /workspaces/:id/queue/:qid`.
  - Update `POST /workspaces/:id/messages` handler to return `{ queued, position, id }` or `{ runId }`.
  - Call initial `drainQueue()` upon `ctxFor(id)` creation.
- [ ] **Step 4: Run server tests to verify all 5 test cases pass**
  - Command: `node --test tests/server.test.ts`
- [ ] **Step 5: Run full test suite & typecheck**
  - Command: `npm test && npm run check`

---

### Task 4: UI Implementation for Message Queue

**Files:**
- Modify: `ui/js/api.js`
- Modify: `ui/js/app.js`
- Modify: `ui/index.html`
- Modify: `ui/styles.css`

**UI Requirements:**
1. **API Client (`ui/js/api.js`):**
   - `queue: (workspaceId) => call("GET", `/workspaces/${enc(workspaceId)}/queue`)`
   - `deleteQueueItem: (workspaceId, qid) => call("DELETE", `/workspaces/${enc(workspaceId)}/queue/${enc(qid)}`)`
2. **Chat Feed (`ui/js/app.js` & `ui/js/panels.js`):**
   - Pending messages displayed at the bottom of the chat view:
     ```html
     <div class="msg user pending" data-qid="qid-123">
       <div class="bubble-u">
         <span class="queue-badge">Đang chờ (#2)</span>
         <span class="queue-text">Nội dung tin nhắn...</span>
         <button class="btn-cancel-queue" title="Bỏ tin nhắn">Bỏ</button>
       </div>
     </div>
     ```
   - Clicking "Bỏ" calls `api.deleteQueueItem(app.wsId, qid)` and removes the pending item from the UI with a toast.
3. **Queue Status Banner:**
   - Add status element `#queue-bar` above the chat or in the office top bar:
     "N tin nhắn đang chờ" when `queue.length > 0`. Hidden when 0.
4. **Transition to Active Run:**
   - When SSE receives `run_started` for the workspace, refresh queue via `api.queue(app.wsId)`. The pending bubble smoothly turns into the active user message bubble.

- [ ] **Step 1: Add API client methods in `ui/js/api.js`**
- [ ] **Step 2: Add CSS styles in `ui/styles.css` for pending message badges and queue banner**
- [ ] **Step 3: Update `ui/js/app.js` to fetch queue on workspace load and render pending messages**
- [ ] **Step 4: Add cancel queue event listener**
- [ ] **Step 5: Verify in test suite**
  - Command: `npm test`

---

### Task 5: Documentation, Verification & Git Commit

**Files:**
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Update `docs/ARCHITECTURE.md`**
  - Document Message Queue behavior in section 6 ("Run lifecycle & Router") and section 8 ("HTTP API").
  - Detail sequential execution, race condition resolution, persistent file schema (`queue.json`), and API contracts (`/workspaces/:id/queue`).
- [ ] **Step 2: Run verification**
  - `npm test`
  - `npm run check`
- [ ] **Step 3: Git commit**
  - `git commit -m "feat(router): implement persistent message queue without overlapping runs"`
- [ ] **Step 4: Verify git status**
  - Ensure working tree is clean and 0 lingering background servers.

---

## Plan Self-Check
- [x] All 5 specific test cases from the user requirements are explicitly planned as individual tests.
- [x] Persistent storage in `<workspace>/.company/queue.json` designed with atomic read/write.
- [x] Race condition during run completion / message arrival analyzed and mitigated.
- [x] Checkpoint replies verified to bypass queue.
- [x] UI chat badge ("Đang chờ (#2)"), "Bỏ" button, and queue counter banner ("N tin nhắn đang chờ") specified.
- [x] Single commit format `feat(router): ...` planned.
- [x] Zero external dependencies and no background servers in bash.
