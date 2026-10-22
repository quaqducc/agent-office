// Wiring: workspaces, live SSE, history replay, rendering, menus and dialogs.
import { Marked } from "/vendor/marked.js";
import { createMarkdown } from "./markdown.js";
import { api, subscribe } from "./api.js";
import { initialState, mergeEvents, reduce } from "./state.js";
import { cancelAllWalks, fit, pauseAllWalks, playEffect, renderOffice, resumeAllWalks } from "./office.js";
import { deskLayout } from "./layout.js";
import { icon } from "./icons.js";
import { duration, extractQuestions, filterQuestionData } from "./derive.js";
import { renderApprovals, renderChat, renderDrawer, renderFeed, renderFlow, renderLog, renderNow, renderQuestionOptions, runLabel } from "./panels.js";
import { esc } from "./util.js";
import { openSettings, showSetup } from "./settings.js";
import { openStore } from "./store.js";
import { openOfficeDialog } from "./office-dialog.js";
import { createExplorerTree } from "./ide/tree.js";
import { createEditorViewer } from "./ide/viewer.js";

const $ = sel => document.querySelector(sel);
const el = {
  office: $("#office"), stage: $("#stage"), onboard: $("#onboard"), chat: $("#chat"), flow: $("#flow"), log: $("#log"),
  flowQuestion: $("#flow-question"), logQuestion: $("#log-question"),
  approvals: $("#approvals"), feed: $("#feed"), now: $("#now-body"),
  queueBanner: $("#queue-banner"),
  wsBtn: $("#ws-btn"), wsPop: $("#ws-pop"), wsName: $("#ws-name"), runBtn: $("#run-btn"), runPop: $("#run-pop"), runName: $("#run-name"),
  stop: $("#stop-run"), conn: $("#conn"), replay: $("#replay-controls"), replayToggle: $("#replay-toggle"), replayBar: $("#replay-bar"),
  logRole: $("#log-role"), logType: $("#log-type"), logCount: $("#log-count"), flowCount: $("#flow-count"),
  form: $("#chat-form"), input: $("#chat-input"), drawer: $("#drawer"), drawerBody: $("#drawer-body"), ask: $("#ask"), toast: $("#toast"),
  openOffice: $("#open-office"),
  actExplorer: $("#act-explorer"), actPanel: $("#act-panel"), actChat: $("#act-chat"),
  actStore: $("#act-store"), actSettings: $("#act-settings"), actTheme: $("#act-theme"),
  sidebarExplorer: $("#sidebar-explorer"), explorerTree: $("#explorer-tree"), explorerRefresh: $("#explorer-refresh"),
  explorerTitle: $("#explorer-title"), explorerCreateFile: $("#explorer-create-file"),
  editorTabs: $("#editor-tabs"), viewOffice: $("#view-office"), viewEditor: $("#view-editor"),
  bottomPanel: $("#bottom-panel"), bottomTabFlow: $("#bottom-tab-flow"), bottomTabLog: $("#bottom-tab-log"),
  panelFlow: $("#panel-flow"), panelLog: $("#panel-log"), bottomPanelClose: $("#bottom-panel-close"),
  sideChat: $("#side-chat"), sideChatClose: $("#side-chat-close"),
};

const app = {
  meta: {},            // role id → {name, description}
  names: {},           // role id → display name
  dept: {},            // role id → department name
  workspaces: [],
  runs: [],
  wsId: null,
  roles: [],
  rooms: null,
  template: null,
  live: null,          // live reducer state
  liveReady: false,
  buffer: [],          // SSE events received before the live state finished loading
  unsubscribe: null,
  mode: "live",        // "live" | "replay"
  replay: null,        // {runId, state, events, i, speed, paused, timer}
  fxDone: { live: 0, replay: 0 },
  gen: 0,              // bumps on every workspace/replay switch; stale async results are dropped
  sseLost: false,
  selected: null,
  tab: "flow",
  logType: "",
  version: "",
  queue: [],
  selectedQuestionId: "current",
  cachedRunEvents: new Map(),
  cachedRunStates: new Map(),
};

const md = createMarkdown(Marked);
for (const i of document.querySelectorAll("i[data-icon]")) i.outerHTML = icon(i.dataset.icon, i.className);

const editorViewer = createEditorViewer({
  tabsContainer: el.editorTabs,
  officeViewEl: el.viewOffice,
  editorViewEl: el.viewEditor,
  toast,
  ask,
});

const explorerTree = createExplorerTree({
  container: el.explorerTree,
  onFileSelect: filePath => {
    editorViewer.openFile(filePath);
  },
});

/** Panels cache their last render by a signature; clear it whenever the data source changes. */
function resetPanels() {
  for (const node of [el.chat, el.flow, el.log, el.approvals, el.feed, el.drawerBody]) node.dataset.sig = "";
  el.office.dataset.roles = "";
}

function toast(msg, kind = "") {
  el.toast.textContent = msg;
  el.toast.className = `toast ${kind}`;
  el.toast.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.toast.hidden = true), 3500);
}

// ---------- in-page dialog (replaces prompt/confirm) ----------
/**
 * @param {{title:string, text?:string, fields?:{name:string,label:string,placeholder?:string,required?:boolean,multiline?:boolean,hint?:string}[], confirm:string, danger?:boolean}} o
 * @returns {Promise<Record<string,string>|null>} field values, or null when cancelled
 */
function ask(o) {
  const d = el.ask;
  d.innerHTML = `<form method="dialog" class="ask-form">
    <h2>${esc(o.title)}</h2>${o.text ? `<p class="ask-text">${esc(o.text)}</p>` : ""}
    ${(o.fields ?? []).map(f => `<label class="field"><span>${esc(f.label)}${f.required ? "" : ' <em>(tuỳ chọn)</em>'}</span>
      ${f.multiline ? `<textarea name="${esc(f.name)}" rows="3" placeholder="${esc(f.placeholder ?? "")}"${f.required ? " required" : ""}>${esc(f.value ?? "")}</textarea>`
                    : `<input name="${esc(f.name)}"${f.value !== undefined ? ` value="${esc(f.value)}"` : ""} placeholder="${esc(f.placeholder ?? "")}" autocomplete="off"${f.required ? " required" : ""}>`}
      ${f.hint ? `<small>${esc(f.hint)}</small>` : ""}</label>`).join("")}
    <div class="ask-buttons"><button type="button" class="btn" value="cancel">Huỷ</button><button type="submit" class="btn ${o.danger ? "danger" : "primary"}" value="ok">${esc(o.confirm)}</button></div>
  </form>`;
  return new Promise(resolve => {
    const form = d.querySelector("form");
    d.querySelector('button[value="cancel"]').addEventListener("click", () => d.close("cancel"));
    form.addEventListener("submit", ev => {
      ev.preventDefault();
      if (!form.reportValidity()) return;
      d.close("ok");
    });
    d.addEventListener("close", () => {
      resolve(d.returnValue === "ok" ? Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, String(v).trim()])) : null);
    }, { once: true });
    d.returnValue = "";
    d.showModal();
    (d.querySelector("input, textarea") ?? d.querySelector('button[type="submit"]')).focus();
  });
}

// ---------- menus ----------
function menu(btn, pop) {
  const close = () => { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  btn.addEventListener("click", ev => {
    ev.stopPropagation();
    const open = pop.hidden;
    document.querySelectorAll(".menu-pop").forEach(p => { p.hidden = true; });
    document.querySelectorAll(".menu-btn").forEach(b => b.setAttribute("aria-expanded", "false"));
    if (open) { pop.hidden = false; btn.setAttribute("aria-expanded", "true"); pop.querySelector("button")?.focus(); }
  });
  pop.addEventListener("click", ev => { if (ev.target.closest("button")) close(); });
  document.addEventListener("click", ev => { if (!pop.hidden && !pop.contains(ev.target)) close(); });
  pop.addEventListener("keydown", ev => {
    if (ev.key === "Escape") { close(); btn.focus(); }
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      const items = [...pop.querySelectorAll("button")];
      const i = items.indexOf(document.activeElement);
      items[(i + (ev.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
      ev.preventDefault();
    }
  });
}
menu(el.wsBtn, el.wsPop);
menu(el.runBtn, el.runPop);

// ---------- rendering ----------
const current = () => (app.mode === "replay" ? app.replay?.state : app.live);
let frame = 0;
function render() {
  if (frame) return;
  frame = requestAnimationFrame(() => { frame = 0; draw(); });
}

function draw() {
  const s = current();
  if (!s) return;
  const readOnly = app.mode === "replay";
  renderOffice(el.office, s, { names: app.names, rooms: app.rooms, selected: app.selected, onSelect: openDrawer });
  const key = app.mode;
  if (s.effects.length < app.fxDone[key]) app.fxDone[key] = 0; // a new run reset the queue
  const speed = readOnly ? (app.replay.speed || Infinity) : 1;
  for (const fx of s.effects.slice(app.fxDone[key])) playEffect(el.office, fx, speed);
  app.fxDone[key] = s.effects.length;

  renderNow(el.now, s, { names: app.names, replay: readOnly, noWorkspace: !app.wsId, queueCount: app.queue.length });
  renderFeed(el.feed, s, { names: app.names });
  renderChat(el.chat, s, { names: app.names, md, readOnly, queue: app.queue });

  if (el.queueBanner) {
    if (!readOnly && app.queue.length > 0) {
      el.queueBanner.hidden = false;
      el.queueBanner.innerHTML = `${icon("tasks")} <b>${app.queue.length}</b> tin nhắn đang chờ xử lý tuần tự`;
    } else {
      el.queueBanner.hidden = true;
    }
  }

  // Question selector derivation & data slicing for Flow and Log panels
  const questions = extractQuestions({
    runs: app.runs,
    liveLog: app.live?.log ?? [],
    activeRunId: app.live?.runId ?? null,
    cachedEvents: app.cachedRunEvents,
  });
  renderQuestionOptions(el.flowQuestion, questions, app.selectedQuestionId);
  renderQuestionOptions(el.logQuestion, questions, app.selectedQuestionId);

  const currentQ = questions.find(q => q.isCurrent) || questions[0];
  const activeQId = (app.selectedQuestionId && app.selectedQuestionId !== "current")
    ? app.selectedQuestionId
    : currentQ?.id;
  const activeQ = questions.find(q => q.id === activeQId) || currentQ;

  let flowState = s;
  let logState = s;

  if (activeQ) {
    if (activeQ.runId === s.runId) {
      const slice = filterQuestionData({
        questionId: activeQ.id,
        questions,
        events: s.log,
        tasks: s.tasks,
      });
      flowState = { ...s, tasks: slice.tasks };
      logState = { ...s, log: slice.log };
    } else {
      let pastState = app.cachedRunStates.get(activeQ.runId);
      if (!pastState && app.cachedRunEvents.has(activeQ.runId)) {
        const evts = app.cachedRunEvents.get(activeQ.runId);
        if (evts) {
          pastState = evts.reduce(reduce, initialState(app.roles));
          app.cachedRunStates.set(activeQ.runId, pastState);
        }
      }
      if (pastState) {
        const slice = filterQuestionData({
          questionId: activeQ.id,
          questions,
          events: pastState.log,
          tasks: pastState.tasks,
        });
        flowState = { ...pastState, tasks: slice.tasks };
        logState = { ...pastState, log: slice.log };
      } else {
        if (!app.cachedRunEvents.has(activeQ.runId)) {
          app.cachedRunEvents.set(activeQ.runId, null);
          api.events(activeQ.runId).then(evts => {
            app.cachedRunEvents.set(activeQ.runId, evts);
            el.flow.dataset.sig = "";
            el.log.dataset.sig = "";
            render();
          }).catch(() => {
            app.cachedRunEvents.set(activeQ.runId, []);
          });
        }
        flowState = { ...s, tasks: {} };
        logState = { ...s, log: [] };
      }
    }
  }

  if (app.tab === "flow") renderFlow(el.flow, flowState, { names: app.names, md });
  if (app.tab === "log") renderLog(el.log, logState, { names: app.names, role: el.logRole.value, type: app.logType, highlight: app.selected });
  el.logCount.textContent = logState.log.length ? String(logState.log.length) : "";
  const nTasks = Object.keys(flowState.tasks).length;
  el.flowCount.textContent = nTasks ? String(nTasks) : "";
  const apSig = el.approvals.dataset.sig;
  renderApprovals(el.approvals, readOnly ? { approvals: {} } : s, { names: app.names, readOnly, onReply: replyApproval });
  if (el.approvals.dataset.sig !== apSig) el.approvals.classList.remove("min"); // a new request always shows up expanded
  if (!el.drawer.hidden && app.selected) renderDrawer(el.drawerBody, app.selected, s, { names: app.names, meta: app.meta, md, dept: app.dept[app.selected] });

  if (readOnly) {
    const r = app.replay;
    el.replayBar.style.width = `${r.events.length ? (r.i / r.events.length) * 100 : 0}%`;
  }
  el.stop.hidden = readOnly || s.runStatus !== "active";
  el.replay.hidden = !readOnly;
  el.input.disabled = readOnly || !app.wsId;
  el.form.classList.toggle("disabled", el.input.disabled);
  el.input.placeholder = readOnly ? "Đang xem lại — chỉ đọc" : app.wsId ? "Nhắn cho Manager…" : "Thêm workspace trước để bắt đầu";
}

// elapsed time and running task durations tick every second
setInterval(() => {
  const s = current();
  if (!s || s.runStatus !== "active" || app.mode !== "live") return;
  renderNow(el.now, s, { names: app.names, replay: false });
  if (app.tab === "flow") render();
}, 1000);

new ResizeObserver(() => fit(el.office)).observe(el.stage);

function openDrawer(role) {
  app.selected = role;
  el.drawer.hidden = false;
  el.drawerBody.dataset.sig = "";
  render();
  requestAnimationFrame(() => el.drawer.querySelector(".drawer-close").focus());
}
function closeDrawer() {
  const role = app.selected;
  el.drawer.hidden = true;
  app.selected = null;
  render();
  el.office.querySelector(`.desk[data-role="${CSS.escape(role ?? "")}"]`)?.focus();
}

// ---------- workspaces & runs ----------
function setRoles(roles) {
  app.roles = roles;
  app.dept = Object.fromEntries(deskLayout(roles, app.rooms).map(d => [d.role, d.dept]));
  el.logRole.innerHTML = `<option value="">Mọi người</option><option value="user">Bạn</option>` +
    roles.map(r => `<option value="${esc(r)}">${esc(app.names[r] ?? r)}</option>`).join("");
}

function renderWorkspaceMenu() {
  const cur = app.workspaces.find(w => w.id === app.wsId);
  el.wsName.textContent = cur?.name ?? "Chưa có";
  el.wsBtn.title = cur?.path ?? "";
  el.wsPop.innerHTML = (app.workspaces.length ? `<p class="pop-title">Workspace</p>` : "") +
    app.workspaces.map(w => {
      const isCur = w.id === app.wsId;
      if (isCur) {
        return `<div class="pop-item-row on">
          <button type="button" class="pop-item on" data-ws="${esc(w.id)}">
            ${icon("folder")}<span><b>${esc(w.name)}</b><small>${esc(w.path)}</small></span>${icon("check", "tick")}
          </button>
          <button type="button" class="ws-rename-btn" data-act="rename-ws" title="Đổi tên workspace" aria-label="Đổi tên workspace">
            ${icon("edit")}
          </button>
        </div>`;
      }
      return `<button type="button" class="pop-item" data-ws="${esc(w.id)}">
        ${icon("folder")}<span><b>${esc(w.name)}</b><small>${esc(w.path)}</small></span></button>`;
    }).join("") +
    `<button type="button" class="pop-item add" data-act="add-ws">${icon("plus")}<span><b>Thêm workspace…</b><small>Đăng ký một thư mục project</small></span></button>`;
}

async function loadWorkspaces(selectId) {
  app.workspaces = await api.workspaces();
  const list = app.workspaces;
  const pick = [selectId, localStorageGet("ws"), list[0]?.id].find(id => id && list.some(w => w.id === id));
  renderWorkspaceMenu();
  if (pick) { el.onboard.hidden = true; await openWorkspace(pick); }
  else showOnboarding();
}

function showOnboarding() {
  setRoles(Object.keys(app.meta));
  app.live = initialState(app.roles);
  resetPanels();
  el.onboard.hidden = false;
  el.onboard.innerHTML = `<div class="onboard-card">
    <h2>Chào mừng đến Agent Office</h2>
    <p>Đây là văn phòng của đội AI. Bạn chỉ cần nói chuyện với Manager, còn lại cả đội tự phối hợp.</p>
    <ol class="steps">
      <li><b>Thêm workspace</b><span>Chọn thư mục project mà đội sẽ làm việc trong đó.</span></li>
      <li><b>Nhắn cho Manager</b><span>Mô tả việc bạn cần ở khung trò chuyện bên phải.</span></li>
      <li><b>Theo dõi và duyệt</b><span>Xem ai đang làm gì, và duyệt khi đội muốn tiêu tiền hoặc gửi ra ngoài.</span></li>
    </ol>
    <button type="button" class="btn primary" data-act="add-ws">${icon("plus")}Thêm workspace</button>
  </div>`;
  if (el.explorerTitle) el.explorerTitle.textContent = "EXPLORER";
  if (el.explorerTree) el.explorerTree.innerHTML = "";
  editorViewer.init(null);
  render();
}

function localStorageGet(k) { try { return localStorage.getItem(`agent-office:${k}`); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(`agent-office:${k}`, v); } catch { /* storage unavailable */ } }

async function openWorkspace(id) {
  if (editorViewer.hasDirtyTabs()) {
    const dirtyNames = editorViewer.getDirtyTabs().map(t => `"${t.name}"`).join(", ");
    const ok = await ask({
      title: "Chuyển workspace",
      text: `Bạn có các tệp chưa lưu (${dirtyNames}). Bạn có chắc muốn đổi workspace và huỷ bỏ thay đổi?`,
      confirm: "Đổi workspace",
      danger: true,
    });
    if (!ok) return;
  }
  const gen = ++app.gen;
  app.unsubscribe?.();
  app.unsubscribe = null;
  stopReplay();
  app.mode = "live";
  app.wsId = id;
  app.selectedQuestionId = "current";
  app.cachedRunEvents.clear();
  app.cachedRunStates.clear();
  app.queue = [];
  localStorageSet("ws", id);
  renderWorkspaceMenu();
  const curWs = app.workspaces.find(w => w.id === id);
  if (el.explorerTitle && curWs) {
    el.explorerTitle.textContent = curWs.name.toUpperCase();
    el.explorerTitle.title = curWs.path;
  }
  explorerTree.load(id);
  editorViewer.init(id);
  const cfg = await api.config(id);
  if (gen !== app.gen) return;
  app.rooms = cfg.rooms ?? null;
  app.template = cfg.template ?? null;
  setRoles(cfg.roles);
  app.live = initialState(app.roles);
  app.liveReady = false;
  app.buffer = [];
  app.fxDone = { live: 0, replay: 0 };
  resetPanels();

  app.sseLost = false;
  el.conn.hidden = true;
  app.unsubscribe = subscribe(id, e => gen === app.gen && onLiveEvent(e), st => {
    if (gen !== app.gen) return;
    if (st === "error" && !app.sseLost) { app.sseLost = true; el.conn.hidden = false; }
    // events sent while disconnected are gone (no server replay): rebuild from the run logs
    if (st === "open" && app.sseLost) openWorkspace(id).catch(e => toast(e.message, "bad"));
  });
  const runs = await refreshRuns();
  await refreshQueue();
  if (gen !== app.gen) return;
  // Show the latest run (live or finished) as the starting picture, without replaying its animations.
  const latest = runs[0];
  if (latest) {
    const loaded = await api.events(latest.runId).catch(() => []);
    if (gen !== app.gen) return;
    const events = mergeEvents(loaded, app.buffer.filter(e => e.runId === latest.runId));
    app.live = events.reduce(reduce, app.live);
    // A run that ended without a run_finished event (server crash → "interrupted"): nobody is still working.
    if (latest.status !== "active" && app.live.runStatus === "active") {
      const roles = Object.fromEntries(Object.entries(app.live.roles).map(([k, r]) => [k, { ...r, status: "idle", waitingOn: undefined }]));
      const tasks = Object.fromEntries(Object.entries(app.live.tasks).map(([k, t]) =>
        [k, t.status === "queued" || t.status === "running" ? { ...t, status: "cancelled", reason: "Lần chạy bị gián đoạn" } : t]));
      app.live = { ...app.live, runStatus: latest.status, roles, tasks, approvals: {}, streaming: {}, endedAt: latest.endedAt ?? app.live.log.at(-1)?.ts ?? null };
    }
  }
  const seen = new Set(app.live.log.map(e => `${e.runId}:${e.seq}`));
  for (const e of app.buffer) if (!seen.has(`${e.runId}:${e.seq}`)) app.live = reduce(app.live, e);
  app.buffer = [];
  app.fxDone.live = app.live.effects.length;
  app.liveReady = true;
  render();
}

const when = ts => ts ? new Date(ts).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "?";

function renderRunMenu() {
  const cur = app.mode === "replay" ? app.replay?.runId : "live";
  const run = app.runs.find(r => r.runId === cur);
  el.runName.textContent = cur === "live" ? "Trực tiếp" : `Xem lại ${when(run?.startedAt)}`;
  el.runBtn.classList.toggle("is-replay", cur !== "live");
  el.runPop.innerHTML = `<button type="button" class="pop-item${cur === "live" ? " on" : ""}" data-run="live">
      <span class="run-dot live"></span><span><b>Trực tiếp</b><small>Xem đội làm việc theo thời gian thực</small></span>${cur === "live" ? icon("check", "tick") : ""}</button>` +
    (app.runs.length ? `<p class="pop-title">Lần chạy trước — bấm để xem lại</p>` : `<p class="pop-empty">Chưa có lần chạy nào.</p>`) +
    app.runs.map(r => {
      const dur = r.endedAt && r.startedAt ? duration(Date.parse(r.endedAt) - Date.parse(r.startedAt)) : "";
      return `<button type="button" class="pop-item run${r.runId === cur ? " on" : ""}" data-run="${esc(r.runId)}">
        <span class="run-dot st-${esc(r.status)}"></span>
        <span><b>${esc(when(r.startedAt))}<em class="st st-${esc(r.status)}">${esc(runLabel(r.status))}</em></b>
          <small class="first">${esc(r.firstMessage ?? "")}</small>
          <small>${dur ? `${dur} · ` : ""}${Number(r.tokens ?? 0).toLocaleString("vi-VN")} token</small></span></button>`;
    }).join("");
}

async function refreshRuns() {
  if (!app.wsId) return [];
  app.runs = (await api.runs(app.wsId)).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  renderRunMenu();
  return app.runs;
}

async function refreshQueue() {
  if (!app.wsId) { app.queue = []; return []; }
  try {
    app.queue = await api.queue(app.wsId);
    render();
    return app.queue;
  } catch {
    app.queue = [];
    return [];
  }
}

function onLiveEvent(e) {
  if (!app.liveReady) { app.buffer.push(e); return; }
  app.live = reduce(app.live, e);
  if (e.type === "tool_call") {
    const tool = e.data?.tool;
    if (tool === "write" || tool === "edit") {
      const targetPath = e.data?.args?.path || e.data?.args?.file;
      if (targetPath) {
        editorViewer.handleExternalFileChange(targetPath);
      }
    }
  }
  if (e.type === "run_started" || e.type === "run_finished") {
    refreshRuns().catch(() => {});
    refreshQueue().catch(() => {});
  }
  if (e.type === "approval_request" && app.mode === "replay") toast("Có yêu cầu cần bạn duyệt — bấm “Về trực tiếp” để xem");
  if (app.mode === "live") render();
}

// ---------- replay ----------
async function startReplay(runId) {
  const gen = ++app.gen;
  stopReplay();
  const events = await api.events(runId);
  if (gen !== app.gen) return;
  resetPanels();
  app.mode = "replay";
  app.replay = { runId, events, i: 0, speed: Number(document.querySelector(".seg .on")?.dataset.speed ?? 4), paused: false, state: initialState(app.roles), timer: 0 };
  app.fxDone.replay = 0;
  setToggle("pause");
  renderRunMenu();
  stepReplay();
}

function setToggle(kind) {
  el.replayToggle.innerHTML = icon(kind);
  el.replayToggle.setAttribute("aria-label", { pause: "Tạm dừng", play: "Tiếp tục", replay: "Phát lại từ đầu" }[kind]);
}

function stepReplay() {
  const r = app.replay;
  if (!r || r.paused) return;
  if (r.speed === 0) {                       // instant: apply everything, skip animations
    while (r.i < r.events.length) r.state = reduce(r.state, r.events[r.i++]);
    app.fxDone.replay = r.state.effects.length;
  }
  if (r.i >= r.events.length) { r.paused = true; setToggle("replay"); return render(); }
  const e = r.events[r.i++];
  r.state = reduce(r.state, e);
  render();
  const next = r.events[r.i];
  const gap = next ? Math.max(0, Date.parse(next.ts) - Date.parse(e.ts)) : 0;
  r.timer = setTimeout(stepReplay, Math.min(gap / r.speed, 2500 / r.speed) + 60);
}

function stopReplay() {
  if (app.replay) clearTimeout(app.replay.timer);
  app.replay = null;
  cancelAllWalks(el.office);
}

function goLive() {
  app.gen++;
  stopReplay();
  app.mode = "live";
  resetPanels();
  app.fxDone.live = app.live.effects.length;
  renderRunMenu();
  render();
}

// ---------- actions ----------
async function replyApproval(id, decision) {
  let note = "";
  if (decision === "edit") {
    const v = await ask({ title: "Yêu cầu sửa", text: "Role sẽ nhận hướng dẫn này và làm lại trước khi xin duyệt tiếp.", fields: [{ name: "note", label: "Cần sửa gì?", placeholder: "Ví dụ: chỉ mua gói rẻ nhất, tối đa 20.000đ", required: true, multiline: true }], confirm: "Gửi yêu cầu sửa" });
    if (!v) return;
    note = v.note;
  } else if (decision === "reject") {
    const v = await ask({ title: "Từ chối hành động này?", text: "Role sẽ không được thực hiện hành động và phải tìm cách khác.", fields: [{ name: "note", label: "Lý do", placeholder: "Giúp role hiểu vì sao", multiline: true }], confirm: "Từ chối", danger: true });
    if (!v) return;
    note = v.note;
  }
  try {
    await api.reply(id, decision, note);
    toast(decision === "approve" ? "Đã duyệt" : decision === "reject" ? "Đã từ chối" : "Đã gửi yêu cầu sửa", "good");
  } catch (e) { toast(`Không gửi được: ${e.message}`, "bad"); }
}

async function renameWorkspace() {
  const cur = app.workspaces.find(w => w.id === app.wsId);
  if (!cur) return;
  const v = await ask({
    title: "Đổi tên workspace",
    fields: [{ name: "name", label: "Tên mới", value: cur.name, required: true }],
    confirm: "Lưu",
  });
  if (!v || !v.name) return;
  try {
    const updated = await api.renameWorkspace(cur.id, v.name);
    const ws = app.workspaces.find(w => w.id === cur.id);
    if (ws) ws.name = updated.name;
    el.wsName.textContent = updated.name;
    renderWorkspaceMenu();
    toast(`Đã đổi tên thành ${updated.name}`, "good");
  } catch (e) {
    toast(`Không đổi tên được: ${e.message}`, "bad");
  }
}

async function addWorkspace() {
  const d = el.ask;
  d.classList.add("ws-dialog");

  let userEditedName = false;

  function baseName(p) {
    const s = (p ?? "").trim().replace(/^["']|["']$/g, "").replace(/[\\/]+$/, "");
    const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
    return i >= 0 ? s.slice(i + 1) : s;
  }

  d.innerHTML = `<form method="dialog" class="ask-form ws-browse-form">
    <h2>Thêm workspace</h2>
    <p class="ask-text">Mở thư mục dự án trên máy tính hoặc dán trực tiếp đường dẫn bên dưới.</p>

    <div class="ws-pick-hero">
      <button type="button" class="btn primary ws-native-pick-btn">
        ${icon("folder")} <span>Duyệt thư mục trên máy…</span>
      </button>
      <div class="ws-divider"><span>hoặc dán đường dẫn thư mục</span></div>
    </div>

    <div class="ws-form-fields">
      <label class="field">
        <span>Đường dẫn thư mục</span>
        <input id="ws-input-path" name="path" placeholder="D:\\projects\\my-app hoặc /home/user/my-app" autocomplete="off" required>
      </label>
      <label class="field">
        <span>Tên hiển thị <em>(tuỳ chọn)</em></span>
        <input id="ws-input-name" name="name" placeholder="Để trống sẽ dùng tên thư mục" autocomplete="off">
      </label>
    </div>

    <div class="ask-buttons">
      <button type="button" class="btn" value="cancel">Huỷ</button>
      <button type="submit" class="btn primary" value="ok">Thêm workspace</button>
    </div>
  </form>`;

  const form = d.querySelector("form");
  const pickBtn = d.querySelector(".ws-native-pick-btn");
  const pathInput = d.querySelector("#ws-input-path");
  const nameInput = d.querySelector("#ws-input-name");
  const submitBtn = d.querySelector('button[type="submit"]');

  nameInput.addEventListener("input", () => {
    userEditedName = true;
  });

  pathInput.addEventListener("input", () => {
    if (!userEditedName) {
      nameInput.value = baseName(pathInput.value);
    }
  });

  pickBtn.addEventListener("click", async () => {
    pickBtn.disabled = true;
    try {
      const res = await api.fsPickFolder();
      if (!res.canceled && res.path) {
        pathInput.value = res.path;
        if (!userEditedName) {
          nameInput.value = res.name || baseName(res.path);
        }
        submitBtn.focus();
      }
    } catch (err) {
      toast(`Lỗi duyệt thư mục: ${err.message}`, "bad");
    } finally {
      pickBtn.disabled = false;
    }
  });

  d.querySelector('button[value="cancel"]').addEventListener("click", () => d.close("cancel"));

  form.addEventListener("submit", async ev => {
    ev.preventDefault();
    if (!form.reportValidity()) return;
    const targetPath = pathInput.value.trim();
    const targetName = nameInput.value.trim() || undefined;
    try {
      const ws = await api.addWorkspace(targetPath, targetName);
      d.close("ok");
      await loadWorkspaces(ws.id);
      toast(`Đã thêm ${ws.name}`, "good");
    } catch (err) {
      toast(`Không thêm được: ${err.message}`, "bad");
    }
  });

  d.addEventListener("close", () => {
    d.classList.remove("ws-dialog");
  }, { once: true });
  d.showModal();
}
}

el.form.addEventListener("submit", async ev => {
  ev.preventDefault();
  const text = el.input.value.trim();
  if (!text || !app.wsId || app.mode !== "live") return;
  el.input.value = "";
  grow();
  try {
    const res = await api.send(app.wsId, text);
    if (res?.queued) toast(`Đã thêm vào hàng đợi (vị trí #${res.position})`);
    await refreshQueue();
  } catch (e) {
    toast(`Không gửi được: ${e.message}`, "bad");
    el.input.value = text;
    grow();
  }
});
function grow() { el.input.style.height = "auto"; el.input.style.height = `${Math.min(el.input.scrollHeight, 180)}px`; }
el.input.addEventListener("input", grow);
el.input.addEventListener("keydown", ev => {
  if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); el.form.requestSubmit(); }
});

document.addEventListener("click", ev => {
  const t = ev.target.closest("[data-act], [data-ws], [data-run], [data-suggest]");
  if (!t) return;
  if (t.dataset.act === "add-ws") addWorkspace();
  else if (t.dataset.act === "rename-ws") renameWorkspace();
  else if (t.dataset.act === "hide-approvals") el.approvals.classList.add("min");
  else if (t.dataset.act === "cancel-queue") {
    const qid = t.dataset.qid;
    if (qid && app.wsId) {
      api.deleteQueueItem(app.wsId, qid).then(() => {
        toast("Đã bỏ tin nhắn khỏi hàng đợi");
        return refreshQueue();
      }).catch(e => toast(`Không thể bỏ tin: ${e.message}`, "bad"));
    }
  }
  else if (t.dataset.act === "show-approvals") {
    el.approvals.classList.remove("min");
    const card = el.approvals.querySelector(".approval");
    card?.focus();
    card?.classList.remove("flash"); void card?.offsetWidth; card?.classList.add("flash");
  }
  else if (t.dataset.ws && t.dataset.ws !== app.wsId) openWorkspace(t.dataset.ws).catch(e => toast(e.message, "bad"));
  else if (t.dataset.run) {
    if (t.dataset.run === "live") { if (app.mode !== "live") goLive(); }
    else startReplay(t.dataset.run).catch(e => toast(e.message, "bad"));
  }
  else if (t.dataset.suggest) { el.input.value = t.dataset.suggest; grow(); el.input.focus(); }
});

$("#go-live").addEventListener("click", goLive);
el.replayToggle.addEventListener("click", () => {
  const r = app.replay;
  if (!r) return;
  if (r.i >= r.events.length) return startReplay(r.runId);
  r.paused = !r.paused;
  setToggle(r.paused ? "play" : "pause");
  if (!r.paused) {
    resumeAllWalks();
    stepReplay();
  } else {
    clearTimeout(r.timer);
    pauseAllWalks();
    render();
  }
});
document.querySelectorAll(".seg button").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll(".seg button").forEach(x => x.classList.toggle("on", x === b));
  if (app.replay) { app.replay.speed = Number(b.dataset.speed); clearTimeout(app.replay.timer); if (!app.replay.paused) stepReplay(); }
}));

el.stop.addEventListener("click", async () => {
  if (!app.live?.runId) return;
  const ok = await ask({ title: "Dừng lần chạy?", text: "Mọi role đang làm sẽ bị huỷ. Kết quả đã có vẫn được giữ trong nhật ký.", confirm: "Dừng lần chạy", danger: true });
  if (!ok) return;
  try { await api.stop(app.live.runId); } catch (e) { toast(e.message, "bad"); }
});

document.querySelectorAll(".tabs button").forEach(b => b.addEventListener("click", () => {
  app.tab = b.dataset.tab;
  document.querySelectorAll(".tabs button").forEach(x => { x.classList.toggle("on", x === b); x.setAttribute("aria-selected", String(x === b)); });
  document.querySelectorAll(".tab-panel").forEach(p => (p.hidden = p.dataset.panel !== app.tab));
  for (const k of ["flow", "log"]) $(`#${k}`).dataset.sig = "";
  render();
}));

// Bottom panel tabs
el.bottomTabFlow?.addEventListener("click", () => {
  app.tab = "flow";
  el.bottomTabFlow.classList.add("on");
  el.bottomTabFlow.setAttribute("aria-selected", "true");
  el.bottomTabLog.classList.remove("on");
  el.bottomTabLog.setAttribute("aria-selected", "false");
  el.panelFlow.hidden = false;
  el.panelLog.hidden = true;
  el.flow.dataset.sig = "";
  render();
});

el.bottomTabLog?.addEventListener("click", () => {
  app.tab = "log";
  el.bottomTabLog.classList.add("on");
  el.bottomTabLog.setAttribute("aria-selected", "true");
  el.bottomTabFlow.classList.remove("on");
  el.bottomTabFlow.setAttribute("aria-selected", "false");
  el.panelLog.hidden = false;
  el.panelFlow.hidden = true;
  el.log.dataset.sig = "";
  render();
});

function toggleExplorer() {
  const isCollapsed = el.sidebarExplorer.classList.toggle("collapsed");
  el.actExplorer?.classList.toggle("on", !isCollapsed);
}

function toggleBottomPanel() {
  const isCollapsed = el.bottomPanel.classList.toggle("collapsed");
  el.actPanel?.classList.toggle("on", !isCollapsed);
}

function toggleSideChat() {
  const isCollapsed = el.sideChat.classList.toggle("collapsed");
  el.actChat?.classList.toggle("on", !isCollapsed);
}

el.actExplorer?.addEventListener("click", toggleExplorer);
el.actPanel?.addEventListener("click", toggleBottomPanel);
el.bottomPanelClose?.addEventListener("click", toggleBottomPanel);
el.actChat?.addEventListener("click", toggleSideChat);
el.sideChatClose?.addEventListener("click", toggleSideChat);
el.explorerRefresh?.addEventListener("click", () => explorerTree.refresh());
el.explorerCreateFile?.addEventListener("click", async () => {
  if (!app.wsId) {
    toast("Vui lòng chọn hoặc tạo workspace trước", "bad");
    return;
  }
  const res = await ask({
    title: "Tạo tệp mới",
    fields: [
      { name: "path", label: "Đường dẫn tệp trong workspace", placeholder: "src/utils.ts", required: true },
    ],
    confirm: "Tạo tệp",
  });
  if (!res || !res.path) return;
  try {
    const created = await api.createFile(app.wsId, res.path.trim());
    toast(`Đã tạo ${created.path}`, "ok");
    await explorerTree.refresh();
    await editorViewer.openFile(created.path);
  } catch (e) {
    toast(e.message, "bad");
  }
});

function updateThemeUI(theme) {
  if (el.actTheme) {
    el.actTheme.innerHTML = icon(theme === "dark" ? "sun" : "moon");
    el.actTheme.title = theme === "dark" ? "Chuyển giao diện Sáng" : "Chuyển giao diện Tối";
  }
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme") || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorageSet("theme", next);
  updateThemeUI(next);
}

const savedTheme = localStorageGet("theme");
if (savedTheme) {
  document.documentElement.setAttribute("data-theme", savedTheme);
  updateThemeUI(savedTheme);
}
el.actTheme?.addEventListener("click", toggleTheme);

window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === "b" || e.key === "B")) {
    e.preventDefault();
    toggleSideChat();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "b" || e.key === "B")) {
    e.preventDefault();
    toggleExplorer();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === "j" || e.key === "J")) {
    e.preventDefault();
    toggleBottomPanel();
    return;
  }
  if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "o" || e.key === "O")) {
    e.preventDefault();
    editorViewer.toggleOfficeFile();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
    if (editorViewer.getActiveTab() !== "office") {
      e.preventDefault();
      editorViewer.saveCurrentTab();
      return;
    }
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === "w" || e.key === "W")) {
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag !== "input" && tag !== "textarea") {
      if (editorViewer.getActiveTab() !== "office") {
        e.preventDefault();
        editorViewer.closeActiveTab();
      }
    }
  }
});
function onQuestionChange(val) {
  app.selectedQuestionId = val;
  if (el.flowQuestion) el.flowQuestion.value = val;
  if (el.logQuestion) el.logQuestion.value = val;
  el.flow.dataset.sig = "";
  el.log.dataset.sig = "";
  render();
}
el.flowQuestion?.addEventListener("change", ev => onQuestionChange(ev.target.value));
el.logQuestion?.addEventListener("change", ev => onQuestionChange(ev.target.value));

el.logRole.addEventListener("change", () => render());
el.logType.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
  app.logType = b.dataset.v;
  el.logType.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
  render();
}));

// ---------- settings & role store ----------
/** Installed roles changed: refresh names and rebuild the office for the current workspace. */
async function reloadRoles() {
  const roles = await api.roles();
  app.meta = {}; app.names = {};
  for (const r of roles) { app.meta[r.id] = r; app.names[r.id] = r.name; }
  if (app.wsId) await openWorkspace(app.wsId); else showOnboarding();
}
$("#open-settings").addEventListener("click", () =>
  openSettings({ roles: Object.values(app.meta), version: app.version, toast, ask }));
el.actSettings?.addEventListener("click", () =>
  openSettings({ roles: Object.values(app.meta), version: app.version, toast, ask }));
$("#open-store").addEventListener("click", () =>
  openStore({ toast, ask, onChange: () => reloadRoles().catch(e => toast(e.message, "bad")) }));
el.actStore?.addEventListener("click", () =>
  openStore({ toast, ask, onChange: () => reloadRoles().catch(e => toast(e.message, "bad")) }));
$("#open-office")?.addEventListener("click", () => {
  if (!app.wsId) {
    toast("Vui lòng chọn hoặc tạo workspace trước", "bad");
    return;
  }
  openOfficeDialog({
    wsId: app.wsId,
    toast,
    reloadRoles: () => reloadRoles().catch(e => toast(e.message, "bad")),
    openStore: () => openStore({ toast, ask, onChange: () => reloadRoles().catch(e => toast(e.message, "bad")) }),
    onSave: updated => {
      app.rooms = updated.rooms ?? null;
      app.template = updated.template ?? null;
      setRoles(updated.roles);
      if (app.live) {
        const nextRoles = {};
        for (const r of updated.roles) {
          nextRoles[r] = app.live.roles[r] || { status: "idle" };
        }
        app.live.roles = nextRoles;
      }
      if (el.office) el.office.dataset.roles = "";
      draw();
    },
  });
});

el.drawer.addEventListener("click", ev => { if (ev.target === el.drawer) closeDrawer(); });
el.drawer.querySelector(".drawer-close").addEventListener("click", closeDrawer);
document.addEventListener("keydown", ev => { if (ev.key === "Escape" && !el.drawer.hidden && !el.ask.open) closeDrawer(); });

// ---------- boot ----------
(async () => {
  try {
    const health = await api.health();
    app.version = health.version;
    if (!health.configured) await showSetup();
    const roles = await api.roles();
    for (const r of roles) { app.meta[r.id] = r; app.names[r.id] = r.name; }
    await loadWorkspaces();
  } catch (e) {
    el.chat.innerHTML = `<div class="empty"><h3>Không kết nối được server</h3><p>${esc(e.message)}</p><p>Kiểm tra server đã chạy chưa rồi tải lại trang.</p></div>`;
  }
})();
