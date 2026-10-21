// Pure reducer: TeamEvents → office state. Shared by live mode and replay; unit-tested under Node.

/** @param {string[]} roles */
export function initialState(roles) {
  return {
    runId: null,
    runStatus: "idle",
    startedAt: null,   // ISO ts of the run's first event
    endedAt: null,     // ISO ts of run_finished
    tokens: 0,
    roles: Object.fromEntries(roles.map(r => [r, { status: "idle" }])),
    tasks: {},
    chat: [],
    log: [],
    approvals: {},
    effects: [],
    streaming: {},
  };
}

const setRole = (s, id, patch) => {
  if (!id || !s.roles[id]) return;
  s.roles = { ...s.roles, [id]: { ...s.roles[id], ...patch } };
};

const pushEffect = (s, e, kind, from, to, label) => {
  s.effects = [...s.effects, { kind, from, to, label: String(label ?? "").slice(0, 120), seq: e.seq }];
};

/** Work without a task (e.g. the manager handling a notice) still shows the role as working. */
const markActive = (s, role) => {
  if (s.roles[role]?.status === "idle") setRole(s, role, { status: "working" });
};

/** @returns a new state; the input state is not mutated */
export function reduce(state, e) {
  const d = e.data ?? {};
  if (e.type === "message_delta") {
    const prev = state.streaming[e.role] ?? "";
    const next = { ...state, streaming: { ...state.streaming, [e.role]: prev + (d.delta ?? "") } };
    markActive(next, e.role);
    return next;
  }

  let s = { ...state };
  if (e.type === "run_started") {
    s = { ...initialState(Object.keys(state.roles)), chat: state.chat, runId: e.runId, runStatus: "active", startedAt: e.ts };
  } else if (!s.runId) {
    s.runId = e.runId;
    s.runStatus = "active";
    s.startedAt = e.ts;
  }
  s.log = [...s.log, e];

  switch (e.type) {
    case "user_message":
      s.chat = [...s.chat, { who: "user", text: d.text, ts: e.ts }];
      break;
    case "manager_reply":
      s.chat = [...s.chat, { who: "manager", text: d.text, ts: e.ts }];
      setRole(s, "manager", { status: "idle" });
      pushEffect(s, e, "reply", "manager", "user", d.text);
      break;
    case "task_created":
      s.tasks = { ...s.tasks, [d.taskId]: {
        id: d.taskId, parentTaskId: d.parentTaskId, from: d.from, to: d.to, goal: d.goal,
        status: "queued", depth: d.depth ?? 0, createdAt: e.ts, order: e.seq,
      } };
      if (d.from !== "user" && d.from !== "manager") setRole(s, d.from, { status: "waiting", waitingOn: d.to });
      pushEffect(s, e, "handoff", d.from, d.to, d.goal);
      break;
    case "task_status": {
      const t = s.tasks[e.taskId];
      if (t) {
        const times = d.status === "running" ? { startedAt: t.startedAt ?? e.ts } : d.status === "queued" ? {} : { endedAt: e.ts };
        s.tasks = { ...s.tasks, [e.taskId]: { ...t, status: d.status, reason: d.reason, ...times } };
      }
      if (d.status === "running") setRole(s, e.role, { status: "working", taskId: e.taskId });
      else if (d.status !== "queued") {
        setRole(s, e.role, { status: "idle", taskId: undefined });
        if (s.streaming[e.role] !== undefined) { const { [e.role]: _gone, ...rest } = s.streaming; s.streaming = rest; }
        const caller = t && s.roles[t.from];
        if (caller && caller.status === "waiting" && caller.waitingOn === t.to) setRole(s, t.from, { status: "working", waitingOn: undefined });
        if ((d.status === "done" || d.status === "failed") && t && t.from && t.from !== "user") {
          pushEffect(s, e, d.status === "done" ? "done" : "failed", e.role, t.from, d.status === "done" ? (t.result ? `Xong: ${t.result}` : "Xong việc") : `Lỗi: ${d.reason ?? "thất bại"}`);
        }
      }
      break;
    }
    case "message": {
      const { [e.role]: _done, ...rest } = s.streaming;
      s.streaming = rest;
      setRole(s, e.role, { lastMessage: d.text });
      const t = e.taskId && s.tasks[e.taskId];
      if (t && t.to === e.role) s.tasks = { ...s.tasks, [e.taskId]: { ...t, result: d.text } };
      break;
    }
    case "tool_call":
      markActive(s, e.role);
      break;
    case "checkpoint":
      pushEffect(s, e, "checkpoint", e.role, d.to ?? "manager", d.title);
      break;
    case "approval_request":
      s.approvals = { ...s.approvals, [d.checkpointId]: { id: d.checkpointId, role: e.role, title: d.title, action: d.action, summary: d.summary } };
      setRole(s, e.role, { status: "approval" });
      pushEffect(s, e, "approval", e.role, "user", d.title);
      break;
    case "checkpoint_reply": {
      const a = s.approvals[d.checkpointId];
      if (a) {
        const { [d.checkpointId]: _gone, ...rest } = s.approvals;
        s.approvals = rest;
        setRole(s, a.role, { status: "working" });
      }
      break;
    }
    case "usage":
      s.tokens += Number(d.tokens) || 0;
      break;
    case "run_finished":
      s.runStatus = d.status ?? "done";
      s.endedAt = e.ts;
      if (d.usage?.tokens !== undefined) s.tokens = d.usage.tokens;
      s.approvals = {};
      s.streaming = {};
      s.roles = Object.fromEntries(Object.entries(s.roles).map(([id, r]) => [id, { ...r, status: "idle", taskId: undefined, waitingOn: undefined }]));
      break;
  }
  return s;
}

/** Union of two event lists, de-duplicated by run+seq, ordered by seq. */
export function mergeEvents(existing, incoming) {
  const seen = new Map();
  for (const e of [...existing, ...incoming]) seen.set(`${e.runId}:${e.seq}`, e);
  return [...seen.values()].sort((a, b) => a.seq - b.seq);
}
