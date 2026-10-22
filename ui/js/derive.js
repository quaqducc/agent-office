// Pure views derived from reducer state (Node-safe): the "now" overview, live links, activity feed.
import { plain } from "./util.js";

const OPEN = new Set(["queued", "running"]);

/** Truncate preview text cleanly. */
function previewText(text, max = 52) {
  const clean = plain(text);
  if (!clean) return "(Không có nội dung)";
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
}

export const STATUS_LABEL = {
  running: "đang chạy",
  done: "xong",
  stopped: "dừng",
};

/**
 * Extract all questions across runs and active live log, sorted newest first.
 * @param {{
 *   runs: Array<{runId: string, startedAt: string, endedAt?: string, status: string, firstMessage: string}>,
 *   liveLog?: Array<{runId: string, seq: number, ts: string, type: string, data?: any}>,
 *   activeRunId?: string|null,
 *   cachedEvents?: Record<string, Array<any>> | Map<string, Array<any>>,
 * }} params
 */
export function extractQuestions({ runs = [], liveLog = [], activeRunId = null, cachedEvents = {} } = {}) {
  const getCached = id => (cachedEvents instanceof Map ? cachedEvents.get(id) : cachedEvents[id]);
  const out = [];

  const knownRunIds = new Set(runs.map(r => r.runId));
  const allRuns = [...runs];
  if (activeRunId && !knownRunIds.has(activeRunId)) {
    const firstMsg = liveLog.find(e => e.type === "user_message")?.data?.text || "";
    allRuns.unshift({
      runId: activeRunId,
      startedAt: liveLog[0]?.ts || new Date().toISOString(),
      status: "active",
      firstMessage: firstMsg,
    });
  }

  for (const r of allRuns) {
    const isActive = r.runId === activeRunId || r.status === "active";
    let events = null;
    if (r.runId === activeRunId && liveLog && liveLog.length > 0) {
      events = liveLog;
    } else {
      const cached = getCached(r.runId);
      if (cached && cached.length > 0) {
        events = cached;
      }
    }

    if (events) {
      const userMsgs = events.filter(e => e.type === "user_message" && (!e.runId || e.runId === r.runId));
      if (userMsgs.length > 0) {
        userMsgs.forEach((msg, idx) => {
          const isLatestInRun = idx === userMsgs.length - 1;
          let status = "done";
          if (isActive && isLatestInRun) {
            status = "running";
          } else if (r.status === "stopped" || r.status === "failed" || r.status === "cancelled") {
            status = "stopped";
          } else if (r.status === "active") {
            status = "done";
          } else {
            status = r.status === "done" ? "done" : (r.status === "running" ? "running" : "stopped");
          }

          const text = msg.data?.text || "";
          out.push({
            id: `${r.runId}:seq-${msg.seq}`,
            runId: r.runId,
            seq: msg.seq,
            text,
            shortText: previewText(text),
            ts: msg.ts || r.startedAt,
            status,
            isCurrent: false,
          });
        });
        continue;
      }
    }

    let status = "done";
    if (isActive || r.status === "active" || r.status === "running") {
      status = "running";
    } else if (r.status === "stopped" || r.status === "failed" || r.status === "cancelled") {
      status = "stopped";
    }
    const text = r.firstMessage || "";
    out.push({
      id: `${r.runId}:first`,
      runId: r.runId,
      seq: 1,
      text,
      shortText: previewText(text),
      ts: r.startedAt,
      status,
      isCurrent: false,
    });
  }

  out.sort((a, b) => {
    const ta = Date.parse(a.ts) || 0;
    const tb = Date.parse(b.ts) || 0;
    if (ta !== tb) return tb - ta;
    return (b.seq || 0) - (a.seq || 0);
  });

  if (out.length > 0) {
    out[0].isCurrent = true;
  }

  return out;
}

/**
 * Filter tasks and log events corresponding to a specific question.
 * @param {{
 *   questionId: string,
 *   questions: Array<any>,
 *   events: Array<any>,
 *   tasks: Record<string, any>,
 * }} params
 * @returns {{ tasks: Record<string, any>, log: Array<any> }}
 */
export function filterQuestionData({ questionId, questions = [], events = [], tasks = {} } = {}) {
  if (!questionId || questions.length === 0) {
    return { tasks, log: events };
  }

  const q = questions.find(x => x.id === questionId);
  if (!q) {
    return { tasks, log: events };
  }

  const runQuestions = questions
    .filter(x => x.runId === q.runId)
    .sort((a, b) => (a.seq || 0) - (b.seq || 0));

  if (runQuestions.length <= 1) {
    return { tasks, log: events };
  }

  const qIdx = runQuestions.findIndex(x => x.id === q.id);
  const startSeq = q.seq || 0;
  const nextSeq = qIdx < runQuestions.length - 1 ? runQuestions[qIdx + 1].seq : Infinity;

  const filteredLog = events.filter(e => {
    const s = e.seq || 0;
    return s >= startSeq && s < nextSeq;
  });

  const taskIdsInSlice = new Set();
  for (const e of filteredLog) {
    if (e.taskId) taskIdsInSlice.add(e.taskId);
    if (e.data?.taskId) taskIdsInSlice.add(e.data.taskId);
    if (e.type === "task_created" && e.data?.taskId) taskIdsInSlice.add(e.data.taskId);
  }

  const filteredTasks = {};
  for (const [tid, task] of Object.entries(tasks)) {
    if (taskIdsInSlice.has(tid)) {
      filteredTasks[tid] = task;
    }
  }

  return { tasks: filteredTasks, log: filteredLog };
}

/** "1:05" / "1:02:05" */
export function duration(ms) {
  const t = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const pad = n => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Run summary for the status strip. */
export function overview(state, now = Date.now()) {
  const tasks = Object.values(state.tasks);
  const count = (...st) => tasks.filter(t => st.includes(t.status)).length;
  const start = Date.parse(state.startedAt ?? state.log[0]?.ts);
  const end = state.runStatus === "active" ? now : Date.parse(state.endedAt ?? state.log.at(-1)?.ts);
  const roles = Object.entries(state.roles);
  return {
    elapsedMs: Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0,
    running: count("running"),
    queued: count("queued"),
    done: count("done"),
    failed: count("failed", "cancelled"),
    waits: roles.filter(([, r]) => r.status === "waiting" && r.waitingOn).map(([role, r]) => ({ role, on: r.waitingOn })),
    working: roles.filter(([, r]) => r.status === "working").map(([role]) => role),
    approvals: Object.keys(state.approvals).length,
  };
}

/** Who is talking to whom right now: open tasks plus pending approvals (role → user). */
export function activeLinks(state) {
  const tasks = Object.values(state.tasks).filter(t => OPEN.has(t.status)).sort((a, b) => a.order - b.order);
  return [
    ...tasks.map(t => ({ id: t.id, from: t.from, to: t.to, kind: "task", status: t.status })),
    ...Object.values(state.approvals).map(a => ({ id: a.id, from: a.role, to: "user", kind: "approval" })),
  ];
}

/** Recent interactions (who → whom, what), newest first. */
export function activityFeed(state, names = {}, limit = 60) {
  const out = [];
  const owner = {}; // checkpointId → role that raised it
  const add = (e, kind, from, to, verb, text) => out.push({ seq: e.seq, ts: e.ts, kind, from, to, verb, text: String(text ?? "") });
  for (const e of state.log) {
    const d = e.data ?? {};
    switch (e.type) {
      case "user_message": add(e, "user", "user", "manager", "nhắn", d.text); break;
      case "manager_reply": add(e, "reply", "manager", "user", "trả lời", d.text); break;
      case "task_created":
        if (d.from !== "user") add(e, "handoff", d.from, d.to, "giao việc cho", d.goal);
        break;
      case "task_status": {
        const t = state.tasks[e.taskId];
        if (!t || t.from === "user" || OPEN.has(d.status)) break;
        if (d.status === "done") add(e, "done", t.to, t.from, "báo xong cho", t.result ?? t.goal);
        else add(e, "failed", t.to, t.from, d.status === "cancelled" ? "dừng việc của" : "báo lỗi cho", d.reason ?? t.goal);
        break;
      }
      case "checkpoint":
        owner[d.checkpointId] = e.role;
        add(e, "checkpoint", e.role, d.to ?? "manager", "báo cáo", d.title);
        break;
      case "approval_request":
        owner[d.checkpointId] = e.role;
        add(e, "approval", e.role, "user", "xin duyệt", d.action ?? d.title);
        break;
      case "checkpoint_reply": {
        const verb = { approve: "đã duyệt cho", reject: "từ chối", edit: "yêu cầu sửa" }[d.decision] ?? "trả lời";
        add(e, "answer", d.by ?? "user", owner[d.checkpointId] ?? "manager", verb, d.answer ?? d.note ?? "");
        break;
      }
      case "error": case "limit_hit":
        add(e, "error", e.role ?? "system", e.role ?? "system", e.type === "error" ? "gặp lỗi" : "chạm giới hạn", d.message);
        break;
    }
  }
  return out.reverse().slice(0, limit);
}

const GROUPS = {
  task: ["run_started", "run_finished", "task_created", "task_status"],
  message: ["user_message", "manager_reply", "message"],
  tool: ["tool_call", "tool_result"],
  approval: ["checkpoint", "approval_request", "checkpoint_reply"],
  error: ["error", "limit_hit"],
};
/** Log filter category of an event type. */
export const logGroup = type => Object.keys(GROUPS).find(g => GROUPS[g].includes(type)) ?? "system";
