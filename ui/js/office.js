// Office view: scaled pixel scene, desks with characters and status, employee walking animations and interaction speech bubbles.
import { sprite } from "./sprites.js";
import { deskLayout, ENTRANCE, SCENE, findWalkPath } from "./layout.js";
import { sceneSvg } from "./scene.js";
import { activeLinks } from "./derive.js";
import { esc, plain } from "./util.js";

/** Desk name plates stay short: "Senior Developer" → "Developer", "DevOps / SRE" → "DevOps". */
const SHORT = { "business-strategist": "Strategist", "product-manager": "Product", "ai-engineer": "AI Engineer", "ui-ux": "UI/UX", architect: "Architect", developer: "Developer", marketing: "Marketing" };
export const shortName = (role, name) => SHORT[role] ?? String(name ?? role).split(" / ")[0];

const STATUS_VI = { working: "đang làm", waiting: "đang chờ", approval: "chờ bạn duyệt", idle: "rảnh" };
const head = (s, n) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, Math.max(0, n - 1)) + "…" : t; };
const tail = (s, n) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? "…" + t.slice(-(n - 1)) : t; };

const DESK = `<svg class="desk-art" viewBox="0 0 132 64" shape-rendering="crispEdges" aria-hidden="true">
  <rect x="2" y="60" width="128" height="4" class="d-shadow"/>
  <rect x="0" y="24" width="132" height="24" class="d-top"/><rect x="0" y="24" width="132" height="3" class="d-edge"/>
  <rect x="0" y="46" width="132" height="12" class="d-front"/><rect x="6" y="58" width="6" height="4" class="d-front"/><rect x="120" y="58" width="6" height="4" class="d-front"/>
  <rect x="40" y="34" width="44" height="8" class="d-kb"/><rect x="42" y="36" width="40" height="1" class="d-kb-key"/><rect x="42" y="39" width="40" height="1" class="d-kb-key"/>
  <rect x="12" y="30" width="9" height="10" class="d-mug"/><rect x="21" y="32" width="3" height="5" class="d-mug"/>
  <rect x="97" y="0" width="32" height="26" class="d-mon"/><rect x="100" y="3" width="26" height="19" class="d-screen"/>
  <rect x="103" y="7" width="12" height="2" class="d-code"/><rect x="103" y="11" width="18" height="2" class="d-code d-code-2"/><rect x="103" y="15" width="9" height="2" class="d-code"/>
  <rect x="110" y="26" width="6" height="5" class="d-mon"/><rect x="104" y="30" width="18" height="3" class="d-mon"/>
</svg>`;

const BADGE = {
  working: '<span class="dots"><i></i><i></i><i></i></span>',
  waiting: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5h6M3 10.5h6M3.5 1.5c0 3 5 3 5 4.5s-5 1.5-5 4.5M8.5 1.5c0 3-5 3-5 4.5s5 1.5 5 4.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  approval: "<b>!</b>",
};

/** Calculate replay walk duration and accessibility options. */
export function walkDuration(speed = 1, prefersReducedMotion = false) {
  if (prefersReducedMotion || speed === 0 || speed === Infinity) {
    return { isInstant: true, legDuration: 0, talkDuration: 0 };
  }
  const s = Math.max(0.1, Number(speed) || 1);
  return {
    isInstant: false,
    legDuration: Math.round(1200 / s),
    talkDuration: Math.round(1000 / s),
  };
}

/** Single Presence and concurrency management for walking characters. */
export class RoleWalkQueue {
  constructor({ maxConcurrent = 3, maxPerRoleQueue = 1 } = {}) {
    this.maxConcurrent = maxConcurrent;
    this.maxPerRoleQueue = maxPerRoleQueue;
    this.active = new Set();
    this.queues = new Map();
  }

  isRoleBusy(role) {
    return this.active.has(role);
  }

  enqueue(role, task) {
    if (this.active.has(role)) {
      if (!this.queues.has(role)) this.queues.set(role, []);
      const q = this.queues.get(role);
      if (q.length >= this.maxPerRoleQueue) {
        return "dropped";
      }
      q.push(task);
      return "queued";
    }
    if (this.active.size >= this.maxConcurrent) {
      return "overflow";
    }
    this.active.add(role);
    return "running";
  }

  finish(role) {
    this.active.delete(role);
    const q = this.queues.get(role);
    if (q && q.length > 0) {
      const next = q.shift();
      this.active.add(role);
      return next;
    }
    return null;
  }

  clear() {
    this.active.clear();
    this.queues.clear();
  }
}

export const globalWalkQueue = new RoleWalkQueue({ maxConcurrent: 3, maxPerRoleQueue: 1 });
const activeAnimControllers = new Set();
const roleTokens = new Map();

/** Format speech bubble text and styling from interaction effect. */
export function getBubbleContent(fx) {
  let text = plain(fx.label);
  let cls = "";
  if (fx.kind === "approval") {
    cls = "need";
    text = text ? head(text, 60) : "Cần duyệt hành động";
  } else if (fx.kind === "checkpoint") {
    cls = "wait";
    text = text ? head(text, 60) : "Báo cáo tiến độ";
  } else if (fx.kind === "reply") {
    text = head(text, 60);
  } else if (fx.kind === "done") {
    text = text.startsWith("Xong") ? head(text, 60) : `Xong: ${head(text, 54)}`;
  } else if (fx.kind === "failed") {
    cls = "need";
    text = text.startsWith("Lỗi") ? head(text, 60) : `Lỗi: ${head(text, 54)}`;
  } else {
    text = head(text, 60);
  }
  return { text, cls };
}

/** Cancel all walking animations and return everyone to their desk immediately. */
export function cancelAllWalks(el) {
  roleTokens.clear();
  for (const ctrl of activeAnimControllers) {
    try { ctrl.abort(); } catch (_) {}
  }
  activeAnimControllers.clear();
  globalWalkQueue.clear();

  if (el) {
    el.querySelectorAll(".actor").forEach(a => a.remove());
    el.querySelectorAll(".desk.away").forEach(d => d.classList.remove("away"));
  }
}

export function pauseAllWalks() {
  for (const ctrl of activeAnimControllers) {
    try { ctrl.pause?.(); } catch (_) {}
  }
}

export function resumeAllWalks() {
  for (const ctrl of activeAnimControllers) {
    try { ctrl.resume?.(); } catch (_) {}
  }
}

/**
 * Build (once per role set) and update the office.
 * @param {HTMLElement} el the .office element
 * @param {object} state reducer state
 * @param {{names: Record<string,string>, selected?: string, onSelect(role:string): void}} opts
 */
export function renderOffice(el, state, opts) {
  const roles = Object.keys(state.roles);
  const rooms = opts.rooms;
  el._rooms = rooms;
  el._names = opts.names;
  const key = `${roles.join(",")}:${JSON.stringify(rooms ?? [])}`;
  if (el.dataset.roles !== key) build(el, roles, opts);
  const links = state.runStatus === "active" ? activeLinks(state) : [];
  const chain = new Set(links.flatMap(l => [l.from, l.to]));
  for (const desk of el.querySelectorAll(".desk")) {
    const role = desk.dataset.role;
    const r = state.roles[role] ?? { status: "idle" };
    if (desk.dataset.status !== r.status) {
      desk.dataset.status = r.status;
      desk.querySelector(".badge").innerHTML = BADGE[r.status] ?? "";
    }
    desk.classList.toggle("selected", opts.selected === role);
    desk.classList.toggle("in-chain", chain.has(role));
    const bubble = desk.querySelector(".bubble");
    const streaming = state.streaming[role];
    let html = "", cls = "bubble";
    if (r.status === "approval") { html = "Cần bạn duyệt"; cls += " need"; }
    else if (streaming) html = esc(tail(streaming, 90));
    else if (r.status === "waiting") { html = `Chờ ${esc(shortName(r.waitingOn, opts.names[r.waitingOn]))}`; cls += " wait"; }
    if (bubble.innerHTML !== html) bubble.innerHTML = html;
    if (bubble.className !== cls) bubble.className = cls;
    desk.setAttribute("aria-label", `${opts.names[role] ?? role}: ${STATUS_VI[r.status] ?? r.status}`);
  }
  // two neighbours talking at once: lean their bubbles apart so they don't overlap
  const talking = [...el.querySelectorAll(".desk")].filter(d => d.querySelector(".bubble").innerHTML);
  for (const d of el.querySelectorAll(".desk")) d.classList.remove("lean-l", "lean-r");
  for (const a of talking) for (const b of talking) {
    const dx = parseFloat(b.style.left) - parseFloat(a.style.left);
    if (a.style.top === b.style.top && dx > 0 && dx < 230) { a.classList.add("lean-l"); b.classList.add("lean-r"); }
  }
  el.querySelector(".user-spot")?.classList.toggle("in-chain", chain.has("user"));
}

function build(el, roles, opts) {
  const rooms = opts.rooms;
  el._rooms = rooms;
  el._names = opts.names;
  el.dataset.roles = `${roles.join(",")}:${JSON.stringify(rooms ?? [])}`;
  const desks = deskLayout(roles, rooms);
  el.innerHTML = `<div class="scene" style="width:${SCENE.w}px;height:${SCENE.h}px">
    ${sceneSvg({ zones: new Set(desks.map(d => d.zone)), rooms })}
    <div class="user-spot" style="left:${ENTRANCE.x}px;top:${ENTRANCE.y}px"><div class="halo"></div><div class="char">${sprite("user")}</div><div class="plate">Bạn</div><span class="bubble"></span></div>
    ${desks.map(d => `<button class="desk" type="button" data-role="${esc(d.role)}" data-status="idle" style="left:${d.px}px;top:${d.py}px">
        <span class="halo"></span><span class="chair"></span>
        <span class="char">${sprite(d.role)}</span>${DESK}
        <span class="badge"></span>
        <span class="plate" title="${esc(opts.names[d.role] ?? d.role)}">${esc(shortName(d.role, opts.names[d.role]))}</span>
        <span class="bubble"></span>
      </button>`).join("")}
    <div class="fx-layer"></div>
  </div>`;
  el.querySelectorAll(".desk").forEach(b => b.addEventListener("click", () => opts.onSelect(b.dataset.role)));
  fit(el);
}

/** Scale the scene to fit its stage: by width and height on desktop, by width only when stacked. */
export function fit(el) {
  const stage = el.parentElement;
  if (!stage) return;
  const stacked = typeof matchMedia === "function" ? matchMedia("(max-width: 1000px)").matches : false;
  const k = Math.max(0.2, stacked ? stage.clientWidth / SCENE.w : Math.min(stage.clientWidth / SCENE.w, stage.clientHeight / SCENE.h));
  el.style.setProperty("--k", String(k));
  el.style.width = `${SCENE.w * k}px`;
  el.style.height = `${SCENE.h * k}px`;
}

/** Animate an actor moving through a sequence of waypoints. */
async function animatePath(actor, points, totalLegDuration, signal) {
  if (points.length < 2) return;
  let totalDist = 0;
  for (let i = 0; i < points.length - 1; i++) {
    totalDist += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
  }
  if (totalDist <= 0) return;

  actor.classList.add("walking");

  for (let i = 0; i < points.length - 1; i++) {
    if (signal.aborted) return;
    const p1 = points[i];
    const p2 = points[i + 1];
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const segDur = Math.max(10, Math.round(totalLegDuration * (dist / totalDist)));

    const dx = p2.x - p1.x;
    if (dx < -2) actor.classList.add("flip");
    else if (dx > 2) actor.classList.remove("flip");

    actor.style.left = `${p1.x}px`;
    actor.style.top = `${p1.y}px`;

    if (typeof actor.animate === "function") {
      const anim = actor.animate([
        { left: `${p1.x}px`, top: `${p1.y}px` },
        { left: `${p2.x}px`, top: `${p2.y}px` }
      ], { duration: segDur, easing: "linear", fill: "forwards" });
      signal.anim = anim;
      await new Promise(res => {
        anim.onfinish = res;
        anim.oncancel = res;
      });
      signal.anim = null;
      if (signal.aborted) {
        try { anim.cancel(); } catch (_) {}
        return;
      }
      actor.style.left = `${p2.x}px`;
      actor.style.top = `${p2.y}px`;
      try { anim.cancel(); } catch (_) {}
    } else {
      actor.style.left = `${p2.x}px`;
      actor.style.top = `${p2.y}px`;
      await new Promise(r => setTimeout(r, segDur));
    }
  }

  actor.classList.remove("walking");
}

/** Execute a full walk: leave desk, walk to target, speak bubble, walk back. */
async function runWalk(el, walker, target, fx, speed) {
  const fxLayer = el.querySelector(".fx-layer") || el;
  const roles = (el.dataset.roles ? el.dataset.roles.split(":")[0].split(",") : []).filter(Boolean);
  const rooms = el._rooms;
  const desks = deskLayout(roles, rooms);

  const forwardPath = findWalkPath(walker, target, desks, rooms);
  if (forwardPath.length < 2) {
    finishWalk(el, walker);
    return;
  }

  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const timing = walkDuration(speed, reduced);

  const walkerDesk = walker === "user" ? el.querySelector(".user-spot") : el.querySelector(`.desk[data-role="${CSS.escape(walker)}"]`);
  walkerDesk?.classList.add("away");

  const actor = document.createElement("div");
  actor.className = "actor";
  actor.dataset.role = walker;
  actor.style.left = `${forwardPath[0].x}px`;
  actor.style.top = `${forwardPath[0].y}px`;
  actor.innerHTML = `<div class="char">${sprite(walker)}</div>`;
  fxLayer.append(actor);

  const token = Symbol(walker);
  roleTokens.set(walker, token);

  const ctrl = {
    aborted: false,
    anim: null,
    timer: null,
    timerRes: null,
    timerRemaining: 0,
    timerStartedAt: 0,
    abort() {
      this.aborted = true;
      if (this.anim) try { this.anim.cancel(); } catch (_) {}
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      if (this.timerRes) {
        const r = this.timerRes;
        this.timerRes = null;
        r();
      }
    },
    pause() {
      if (this.anim) {
        try { this.anim.pause(); } catch (_) {}
      }
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
        this.timerRemaining = Math.max(0, this.timerRemaining - (Date.now() - this.timerStartedAt));
      }
    },
    resume() {
      if (this.anim) {
        try { this.anim.play(); } catch (_) {}
      }
      if (this.timerRes && this.timerRemaining > 0) {
        this.timerStartedAt = Date.now();
        this.timer = setTimeout(() => {
          this.timer = null;
          const r = this.timerRes;
          this.timerRes = null;
          if (r) r();
        }, this.timerRemaining);
      }
    }
  };
  activeAnimControllers.add(ctrl);

  try {
    // 1. Walk forward to target
    await animatePath(actor, forwardPath, timing.legDuration, ctrl);
    if (ctrl.aborted) return;

    // 2. Arrive and display speech bubble
    const { text, cls } = getBubbleContent(fx);
    const bubble = document.createElement("div");
    bubble.className = "actor-bubble" + (cls ? ` ${cls}` : "");
    bubble.textContent = text;
    actor.append(bubble);

    // Also pulse target desk
    const targetDesk = target === "user" ? el.querySelector(".user-spot") : el.querySelector(`.desk[data-role="${CSS.escape(target)}"]`);
    targetDesk?.classList.add("ping");
    setTimeout(() => targetDesk?.classList.remove("ping"), 600);

    await new Promise(res => {
      ctrl.timerRes = res;
      ctrl.timerRemaining = timing.talkDuration;
      ctrl.timerStartedAt = Date.now();
      ctrl.timer = setTimeout(() => {
        ctrl.timer = null;
        ctrl.timerRes = null;
        res();
      }, timing.talkDuration);
    });
    bubble.remove();
    if (ctrl.aborted) return;

    // 3. Walk back to own desk
    const returnPath = forwardPath.slice().reverse();
    await animatePath(actor, returnPath, timing.legDuration, ctrl);
  } finally {
    activeAnimControllers.delete(ctrl);
    actor.remove();
    if (roleTokens.get(walker) === token) {
      roleTokens.delete(walker);
      walkerDesk?.classList.remove("away");
      finishWalk(el, walker);
    }
  }
}

function finishWalk(el, walker) {
  const next = globalWalkQueue.finish(walker);
  if (next) {
    runWalk(el, next.walker, next.target, next.fx, next.speed);
  }
}

/**
 * Handle interaction effect by walking characters and speech bubbles instead of flying envelopes.
 * @param {HTMLElement} el office element
 * @param {{kind:string, from:string, to:string, label:string}} fx
 * @param {number} speed playback speed multiplier (live = 1)
 */
export function playEffect(el, fx, speed = 1) {
  if (!el || !fx) return;

  // Determine walker and target according to interaction rules:
  // - reply: manager goes to user at ENTRANCE
  // - approval / checkpoint: role goes to manager
  // - handoff / done / failed: sender goes to recipient
  let walker = fx.from;
  let target = fx.to;

  if (fx.kind === "reply") {
    walker = "manager";
    target = "user";
  } else if (fx.kind === "approval") {
    walker = fx.from;
    target = "user";
  } else if (fx.kind === "checkpoint") {
    walker = fx.from;
    target = "manager";
  }

  if (!walker || !target || walker === target) {
    const targetDesk = target === "user" ? el.querySelector(".user-spot") : el.querySelector(`.desk[data-role="${CSS.escape(target)}"]`);
    if (targetDesk) {
      targetDesk.classList.add("ping");
      setTimeout(() => targetDesk.classList.remove("ping"), 300);
    }
    return;
  }

  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const timing = walkDuration(speed, reduced);

  // Instant or reduced motion mode: flash bubble at target desk without walking
  if (timing.isInstant) {
    const targetDesk = target === "user" ? el.querySelector(".user-spot") : el.querySelector(`.desk[data-role="${CSS.escape(target)}"]`);
    if (targetDesk) {
      targetDesk.classList.add("ping");
      const { text, cls } = getBubbleContent(fx);
      const b = targetDesk.querySelector(".bubble");
      if (b) {
        const prev = b.textContent;
        const prevCls = b.className;
        b.textContent = text;
        b.className = "bubble" + (cls ? ` ${cls}` : "");
        setTimeout(() => {
          if (b.textContent === text) {
            b.textContent = prev;
            b.className = prevCls;
          }
          targetDesk.classList.remove("ping");
        }, 350);
      }
    }
    return;
  }

  // Queue walk with Single Presence protection
  const status = globalWalkQueue.enqueue(walker, { walker, target, fx, speed });
  if (status === "overflow" || status === "dropped") {
    // Congested or role already has a waiting walk: flash bubble / ping at walker desk immediately
    const walkerDesk = walker === "user" ? el.querySelector(".user-spot") : el.querySelector(`.desk[data-role="${CSS.escape(walker)}"]`);
    if (walkerDesk) {
      walkerDesk.classList.add("ping");
      const { text, cls } = getBubbleContent(fx);
      const b = walkerDesk.querySelector(".bubble");
      if (b) {
        const prev = b.textContent;
        const prevCls = b.className;
        b.textContent = text;
        b.className = "bubble" + (cls ? ` ${cls}` : "");
        setTimeout(() => {
          if (b.textContent === text) {
            b.textContent = prev;
            b.className = prevCls;
          }
          walkerDesk.classList.remove("ping");
        }, 600);
      } else {
        setTimeout(() => walkerDesk.classList.remove("ping"), 300);
      }
    }
    return;
  }
  if (status === "queued") {
    return;
  }

  runWalk(el, walker, target, fx, speed);
}

