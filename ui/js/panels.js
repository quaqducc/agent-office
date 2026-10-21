// Panels: now strip, activity feed, chat, task flow, log, approvals, role drawer. All model text is escaped or Markdown-sanitised.
import { sprite } from "./sprites.js";
import { icon } from "./icons.js";
import { activityFeed, duration, logGroup, overview } from "./derive.js";
import { esc, plain, summarize, time } from "./util.js";

const who = (role, names) => role === "user" ? "Bạn" : role === "system" ? "Hệ thống" : names[role] ?? role;
export const avatar = (role, cls = "") => role === "system"
  ? `<span class="av sys ${cls}">${icon("alert")}</span>`
  : `<span class="av ${cls}">${sprite(role)}</span>`;

const RUN_VI = { active: "Đang chạy", idle: "Chưa chạy", done: "Đã xong", stopped: "Đã dừng", budget_exceeded: "Hết ngân sách token", interrupted: "Bị gián đoạn" };
export const runLabel = s => RUN_VI[s] ?? s;
const TASK_VI = { queued: "Chờ bắt đầu", running: "Đang làm", done: "Xong", failed: "Lỗi", cancelled: "Đã huỷ" };
const ROLE_VI = { working: "Đang làm", waiting: "Đang chờ", approval: "Chờ bạn duyệt", idle: "Rảnh" };
const GROUP_VI = { task: "Việc", message: "Tin nhắn", tool: "Công cụ", approval: "Duyệt", error: "Lỗi", system: "Hệ thống" };

/** The "now" strip: run status, elapsed, tokens, task counts, who waits on whom, pending approvals. */
export function renderNow(el, state, { names, replay, noWorkspace }) {
  if (!state.runId && !replay) {
    el.innerHTML = `<span class="run-pill st-idle">Chưa có lần chạy</span><span class="now-hint">${noWorkspace
      ? "Thêm một workspace để bắt đầu."
      : "Nhắn cho Manager ở khung bên phải để giao việc đầu tiên."}</span>`;
    return;
  }
  // replay: the clock is the last replayed event, not the wall clock
  const o = overview(state, replay ? Date.parse(state.log.at(-1)?.ts) || Date.now() : Date.now());
  const st = replay ? "replay" : state.runStatus;
  const pill = replay
    ? `<span class="run-pill st-replay">${icon("history")}Đang xem lại</span>`
    : `<span class="run-pill st-${esc(st)}">${st === "active" ? '<i class="live-dot"></i>' : ""}${esc(runLabel(st))}</span>`;
  const waits = o.waits.length
    ? `<span class="waits"><span class="lbl">${icon("hourglass")}Đang chờ</span>${o.waits.slice(0, 3).map(w => `<span class="wait-pair" title="${esc(who(w.role, names))} đang chờ ${esc(who(w.on, names))}">${avatar(w.role, "xs")}<span class="wait-arrow">${icon("arrow")}</span>${avatar(w.on, "xs")}</span>`).join("")}${o.waits.length > 3 ? `<span class="more">+${o.waits.length - 3}</span>` : ""}</span>`
    : o.working.length
      ? `<span class="waits"><span class="lbl">Đang làm</span>${o.working.slice(0, 5).map(r => `<span title="${esc(who(r, names))}">${avatar(r, "xs")}</span>`).join("")}</span>`
      : "";
  const appr = !replay && o.approvals
    ? `<button class="approval-alert" type="button" data-act="show-approvals">${icon("alert")}${o.approvals} việc cần bạn duyệt</button>` : "";
  el.innerHTML = `${pill}
    <span class="stat" title="Thời gian chạy">${icon("clock")}<b>${duration(o.elapsedMs)}</b></span>
    <span class="stat" title="Token đã dùng">${icon("zap")}<b>${state.tokens.toLocaleString("vi-VN")}</b> token</span>
    <span class="stat" title="Các việc trong lần chạy">${icon("tasks")}<b>${o.running}</b> đang làm<span class="sep"></span><b>${o.queued}</b> chờ<span class="sep"></span><b>${o.done}</b> xong${o.failed ? `<span class="sep"></span><b class="bad">${o.failed}</b> lỗi` : ""}</span>
    ${waits}${appr}`;
}

/** Recent interactions, newest first. */
export function renderFeed(el, state, { names }) {
  const sig = `${state.runId}:${state.log.length}`;
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  const items = activityFeed(state, names, 40);
  if (!items.length) {
    el.innerHTML = `<li class="feed-empty">Chưa có trao đổi nào. Khi Manager giao việc, mỗi lần chuyển việc giữa các role sẽ hiện ở đây.</li>`;
    return;
  }
  el.innerHTML = items.map(f => `<li class="fi k-${f.kind}">
      <time>${time(f.ts)}</time>
      <span class="pair">${avatar(f.from, "sm")}<span class="arrow">${icon("arrow")}</span>${avatar(f.to, "sm")}</span>
      <p><b>${esc(who(f.from, names))}</b> ${esc(f.verb)} <b>${esc(who(f.to, names))}</b><span class="txt" title="${esc(plain(f.text).slice(0, 400))}">${esc(plain(f.text).slice(0, 220))}</span></p>
    </li>`).join("");
}

const SUGGESTIONS = [
  "Phân tích nhanh ý tưởng bán khoá học online: thị trường, rủi ro, cách bắt đầu.",
  "Lập kế hoạch 2 tuần để ra mắt landing page cho sản phẩm mới.",
  "Nhờ Critic phản biện kế hoạch kinh doanh trong thư mục docs/.",
];

/** @param {(md:string)=>string} md safe Markdown → HTML */
export function renderChat(el, state, { names, md, readOnly }) {
  const sig = `${state.runId}:${state.chat.length}:${readOnly}`;
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  if (!state.chat.length) {
    el.innerHTML = readOnly
      ? `<div class="empty"><p>Lần chạy này chưa có tin nhắn.</p></div>`
      : `<div class="empty">
          <div class="empty-av">${sprite("manager")}</div>
          <h3>Giao việc cho Manager</h3>
          <p>Manager sẽ chọn người phù hợp trong đội. Bạn xem họ trao đổi ngay trong văn phòng và duyệt những việc tốn tiền hoặc gửi ra ngoài.</p>
          <div class="suggest">${SUGGESTIONS.map(s => `<button type="button" class="suggestion" data-suggest="${esc(s)}">${esc(s)}</button>`).join("")}</div>
        </div>`;
    return;
  }
  el.innerHTML = state.chat.map(m => m.who === "user"
    ? `<div class="msg user"><div class="bubble-u">${esc(m.text)}</div><time>${time(m.ts)}</time></div>`
    : `<div class="msg manager">${avatar("manager", "md")}<div class="msg-body"><div class="msg-meta"><b>${esc(names.manager ?? "Manager")}</b><time>${time(m.ts)}</time></div><div class="md">${md(m.text)}</div></div></div>`).join("");
  el.scrollTop = el.scrollHeight;
}

/** Task flow as a connected tree: who handed what to whom, status, duration, expandable result. */
export function renderFlow(el, state, { names, md }) {
  const tasks = Object.values(state.tasks).sort((a, b) => a.order - b.order);
  const running = tasks.some(t => t.status === "running");
  const sig = JSON.stringify(tasks.map(t => [t.id, t.status, t.result?.length ?? 0])) + (running ? Math.floor(Date.now() / 1000) : "");
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  if (!tasks.length) {
    el.innerHTML = `<div class="empty"><p>Chưa có việc nào trong lần chạy này. Khi Manager chia việc, các bước sẽ hiện thành một cây ở đây.</p></div>`;
    return;
  }
  const open = new Set([...el.querySelectorAll("details[open]")].map(d => d.dataset.id));
  const children = id => tasks.filter(t => t.parentTaskId === id);
  const roots = tasks.filter(t => !t.parentTaskId || !state.tasks[t.parentTaskId]);
  const dur = t => t.startedAt ? duration((t.endedAt ? Date.parse(t.endedAt) : Date.now()) - Date.parse(t.startedAt)) : "";
  const node = t => {
    const kids = children(t.id);
    return `<li class="fnode st-${esc(t.status)}">
      <div class="fcard">
        <div class="fav">${avatar(t.to, "md")}</div>
        <div class="fmain">
          <div class="fhead"><b>${esc(who(t.to, names))}</b><span class="from">nhận từ ${esc(who(t.from, names))}</span>
            <span class="tstatus st-${esc(t.status)}">${esc(TASK_VI[t.status] ?? t.status)}</span>${dur(t) ? `<span class="dur">${icon("clock")}${dur(t)}</span>` : ""}</div>
          <p class="goal">${esc(t.goal)}</p>
          ${t.result ? `<details data-id="${esc(t.id)}"${open.has(t.id) ? " open" : ""}><summary>Xem kết quả</summary><div class="md">${md(t.result)}</div></details>` : ""}
          ${t.reason && t.status !== "done" ? `<p class="reason">${esc(t.reason)}</p>` : ""}
        </div>
      </div>
      ${kids.length ? `<ul>${kids.map(node).join("")}</ul>` : ""}</li>`;
  };
  el.innerHTML = `<ul class="ftree">${roots.map(node).join("")}</ul>`;
}

/** Event log: lazy append, grouped by consecutive role, raw JSON on demand. */
export function renderLog(el, state, { names, role, type, highlight }) {
  const keep = e => (!role || e.role === role) && (!type || logGroup(e.type) === type);
  // Same source + filters → only append new rows, so opened rows stay open and long runs stay cheap.
  const base = `${state.runId}:${state.log[0]?.seq}:${role}:${type}:${highlight}`;
  const from = el.dataset.sig === base ? Number(el.dataset.n) : -1;
  if (from === state.log.length) return;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  const fresh = state.log.slice(Math.max(from, 0)).filter(keep);
  if (from < 0) { el.innerHTML = ""; el._events = []; el._last = null; }
  el.dataset.sig = base;
  el.dataset.n = String(state.log.length);
  if (!el._events.length && !fresh.length) { el.innerHTML = `<div class="empty"><p>Không có sự kiện nào khớp bộ lọc.</p></div>`; return; }
  el.querySelector(".empty")?.remove();
  const start = el._events.length;
  el._events.push(...fresh);
  el.insertAdjacentHTML("beforeend", fresh.map((e, i) => {
    const r = e.role ?? "system";
    const cont = el._last === r;
    el._last = r;
    const g = logGroup(e.type);
    return `<details data-i="${start + i}" class="lrow g-${g}${cont ? " cont" : ""}${highlight && e.role === highlight ? " hl" : ""}">
      <summary><time>${time(e.ts)}</time><span class="lwho">${cont ? "" : `${avatar(r, "xs")}<span>${esc(who(r, names))}</span>`}</span>
        <span class="ltag g-${g}">${GROUP_VI[g]}</span><span class="ls">${esc(summarize(e, names))}</span></summary><pre></pre></details>`;
  }).join(""));
  if (!el._lazy) {
    el._lazy = true;
    el.addEventListener("toggle", ev => {
      const d = ev.target;
      const pre = d.open && d.querySelector("pre");
      if (pre && !pre.textContent) pre.textContent = JSON.stringify(el._events[Number(d.dataset.i)]?.data, null, 2);
    }, true);
  }
  if (atBottom || from < 0) el.scrollTop = el.scrollHeight;
}

/** Docked approval cards (overlay, no layout shift). */
export function renderApprovals(el, state, { names, readOnly, onReply }) {
  const list = Object.values(state.approvals);
  const sig = JSON.stringify(list.map(a => a.id)) + readOnly;
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  el.innerHTML = list.map(a => `<article class="approval" data-id="${esc(a.id)}" tabindex="-1" aria-label="Yêu cầu duyệt từ ${esc(who(a.role, names))}">
      <div class="ap-head">${avatar(a.role, "md")}<div><p class="ap-kicker">${esc(who(a.role, names))} cần bạn duyệt</p><h3>${esc(a.title)}</h3></div>
        <button class="ap-min" type="button" data-act="hide-approvals" aria-label="Thu gọn để xem văn phòng" title="Thu gọn">${icon("chevron")}</button></div>
      <div class="ap-action"><span>Hành động sẽ thực hiện</span><p>${esc(a.action)}</p></div>
      ${a.summary ? `<p class="ap-summary">${esc(a.summary)}</p>` : ""}
      ${readOnly ? "" : `<div class="ap-buttons">
        <button class="btn danger-soft" data-d="reject" type="button">${icon("x")}Từ chối…</button>
        <button class="btn" data-d="edit" type="button">${icon("edit")}Yêu cầu sửa…</button>
        <button class="btn approve" data-d="approve" type="button">${icon("check")}Duyệt</button></div>`}
    </article>`).join("");
  el.querySelectorAll("button[data-d]").forEach(b => b.addEventListener("click", () => onReply(b.closest(".approval").dataset.id, b.dataset.d)));
}

/** Role detail: persona, status, current task, this run's messages, checkpoints and tool calls. */
export function renderDrawer(el, role, state, { names, meta, md, dept }) {
  const r = state.roles[role] ?? { status: "idle" };
  const task = r.taskId && state.tasks[r.taskId];
  const mine = state.log.filter(e => e.role === role);
  const messages = mine.filter(e => e.type === "message").slice(-8).reverse();
  const tools = mine.filter(e => e.type === "tool_call").slice(-15).reverse();
  const checkpoints = mine.filter(e => e.type === "checkpoint" || e.type === "approval_request");
  const done = Object.values(state.tasks).filter(t => t.to === role && t.id !== r.taskId).sort((a, b) => b.order - a.order);
  const statusVi = r.status === "waiting" ? `Đang chờ ${who(r.waitingOn, names)}` : ROLE_VI[r.status] ?? r.status;
  const sig = `${role}:${state.runId}:${mine.length}:${r.status}:${(state.streaming[role] ?? "").length}`;
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  el.innerHTML = `
    <header class="role-head"><div class="portrait st-${esc(r.status)}">${sprite(role)}</div>
      <div><h2 id="drawer-title">${esc(names[role] ?? role)}</h2><p class="dept">${esc(dept ?? "")}</p>
      <span class="status-pill st-${esc(r.status)}">${esc(statusVi)}</span></div></header>
    ${meta[role]?.description ? `<p class="desc">${esc(meta[role].description)}</p>` : ""}
    ${task ? `<h3 class="section-title">Việc hiện tại</h3><div class="item"><div class="meta">Nhận từ ${esc(who(task.from, names))}</div>${esc(task.goal)}</div>` : ""}
    ${state.streaming[role] ? `<h3 class="section-title">Đang viết</h3><div class="item live">${esc(state.streaming[role])}</div>` : ""}
    ${done.length ? `<h3 class="section-title">Việc đã nhận <span class="count">${done.length}</span></h3>${done.map(t => `<div class="item"><div class="meta">Từ ${esc(who(t.from, names))} · <span class="tstatus st-${esc(t.status)}">${esc(TASK_VI[t.status] ?? t.status)}</span></div>${esc(t.goal)}</div>`).join("")}` : ""}
    <h3 class="section-title">Tin nhắn trong lần chạy <span class="count">${messages.length}</span></h3>
    ${messages.map(e => `<div class="item md"><div class="meta">${time(e.ts)}</div>${md(e.data.text)}</div>`).join("") || `<p class="none">Chưa có tin nhắn.</p>`}
    ${checkpoints.length ? `<h3 class="section-title">Checkpoint</h3>${checkpoints.map(e => `<div class="item"><div class="meta">${time(e.ts)} · ${e.type === "approval_request" ? "cần duyệt" : "báo cáo"}</div><b>${esc(e.data.title)}</b>${e.data.summary ? `<br>${esc(e.data.summary)}` : ""}</div>`).join("")}` : ""}
    <h3 class="section-title">Công cụ đã dùng <span class="count">${tools.length}</span></h3>
    ${tools.map(e => `<div class="item tool"><div class="meta">${time(e.ts)}</div><code>${esc(e.data.tool)}</code> <span class="args">${esc(JSON.stringify(e.data.args ?? {}))}</span></div>`).join("") || `<p class="none">Chưa dùng công cụ nào.</p>`}`;
}
