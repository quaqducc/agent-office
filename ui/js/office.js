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

const escRole = (r) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(r) : String(r).replace(/"/g, '\\"'));

const BADGE = {
  working: '<span class="dots"><i></i><i></i><i></i></span>',
  waiting: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5h6M3 10.5h6M3.5 1.5c0 3 5 3 5 4.5s-5 1.5-5 4.5M8.5 1.5c0 3-5 3-5 4.5s5 1.5 5 4.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  approval: "<b>!</b>",
};

const WALK_SPEED = 200; // px/sec

function clamp(min, val, max) {
  return Math.min(max, Math.max(min, val));
}

export function pathDistance(points) {
  if (!points || points.length < 2) return 0;
  let dist = 0;
  for (let i = 0; i < points.length - 1; i++) {
    dist += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
  }
  return dist;
}

/** Calculate replay walk duration and accessibility options. */
export function walkDuration(distance = 240, textLength = 0, speed = 1, prefersReducedMotion = false) {
  // Support legacy signature (speed, prefersReducedMotion)
  if (typeof textLength === "boolean") {
    prefersReducedMotion = textLength;
    speed = distance;
    distance = 240;
    textLength = 0;
  }
  if (arguments.length === 1 && (distance === 0 || distance === Infinity)) {
    speed = distance;
    distance = 240;
    textLength = 0;
  }

  if (prefersReducedMotion || speed === 0 || speed === Infinity) {
    return { isInstant: true, legDuration: 0, talkDuration: 0 };
  }

  const s = Math.max(0.1, Number(speed) || 1);
  const d = Math.max(0, Number(distance) || 0);
  const len = Math.max(0, Number(textLength) || 0);

  const legBase = Math.max(600, Math.round((d / WALK_SPEED) * 1000));
  const legDuration = Math.round(legBase / s);

  const talkBase = clamp(1800, 1200 + len * 32, 3800);
  const talkDuration = Math.round(talkBase / s);

  return {
    isInstant: false,
    legDuration,
    talkDuration,
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

/** Causality sequencing and dependency management for character interactions. */
export class CausalityDirector extends RoleWalkQueue {
  constructor({ maxConcurrent = 3, maxPerRoleQueue = 1 } = {}) {
    super({ maxConcurrent, maxPerRoleQueue });
    this.queue = [];
    this.roleStates = new Map(); // role -> "IDLE" | "WALKING_TO" | "CONVERSING" | "WALKING_BACK"
    this.lockedRoles = new Set(); // roles locked at desk (waiting for incoming visitor)
    this.activeWalkers = new Set();
    this.activeControllers = new Set();
    this.roleTokens = new Map();
    this.activeItemTargets = new Map();
    this.isDraining = false;
  }

  resolveActors(fx) {
    let walker = fx?.from;
    let target = fx?.to;
    if (fx?.kind === "reply") {
      walker = "manager";
      target = "user";
    } else if (fx?.kind === "approval") {
      walker = fx?.from;
      target = "user";
    } else if (fx?.kind === "checkpoint") {
      walker = fx?.from;
      target = "manager";
    }
    return { walker, target };
  }

  isRoleBusy(role) {
    const s = this.roleStates.get(role) || "IDLE";
    return s !== "IDLE";
  }

  canStart(walker, target) {
    if (this.lockedRoles.has(walker)) return false;
    if (this.isRoleBusy(walker)) return false;
    if (this.activeWalkers.size >= this.maxConcurrent) return false;
    return true;
  }

  enqueue(fx, speed = 1, el = null) {
    const { walker, target } = this.resolveActors(fx);
    if (!walker || !target) return "dropped";

    // Call RoleWalkQueue.prototype.enqueue for compatibility with test mocks & presence limits
    const task = { walker, target, fx, speed, el };
    const wqStatus = RoleWalkQueue.prototype.enqueue.call(this, walker, task);
    if (wqStatus === "dropped" || wqStatus === "overflow" || wqStatus === "queued") {
      return wqStatus;
    }

    const queuedForWalker = this.queue.filter(q => q.walker === walker).length;
    if (queuedForWalker >= this.maxPerRoleQueue) {
      return "dropped";
    }

    const item = { fx, walker, target, speed, el };

    if (!this.canStart(walker, target)) {
      this.active.delete(walker);
      this.queue.push(item);
      return "queued";
    }

    this.startItem(item);
    return "running";
  }

  startItem(item) {
    const { walker, target, el } = item;
    this.active.add(walker);
    this.activeWalkers.add(walker);
    this.roleStates.set(walker, "WALKING_TO");
    if (target && target !== "user") {
      this.lockedRoles.add(target);
    }
    this.activeItemTargets.set(walker, target);
    if (el) {
      this.runDOMWalk(el, item);
    }
  }

  arriveAtTarget(walker) {
    if (this.roleStates.get(walker) === "WALKING_TO") {
      this.roleStates.set(walker, "CONVERSING");
    }
  }

  finishDialogue(walker) {
    if (this.roleStates.get(walker) === "CONVERSING") {
      this.roleStates.set(walker, "WALKING_BACK");
    }
    const target = this.activeItemTargets.get(walker);
    if (target && target !== "user") {
      this.lockedRoles.delete(target);
    }
    this.activeItemTargets.delete(walker);
    this.drain();
  }

  returnToDesk(walker) {
    this.roleStates.set(walker, "IDLE");
    this.activeWalkers.delete(walker);
    RoleWalkQueue.prototype.finish.call(this, walker);
    this.drain();
  }

  drain() {
    if (this.isDraining) return;
    this.isDraining = true;
    try {
      let progressed = true;
      while (progressed) {
        progressed = false;
        const index = this.queue.findIndex(item => this.canStart(item.walker, item.target));
        if (index !== -1) {
          const [item] = this.queue.splice(index, 1);
          progressed = true;
          this.startItem(item);
        }
      }
    } finally {
      this.isDraining = false;
    }
  }

  clear() {
    this.queue = [];
    this.roleStates.clear();
    this.lockedRoles.clear();
    this.activeWalkers.clear();
    this.activeItemTargets.clear();
    RoleWalkQueue.prototype.clear.call(this);
  }

  cancelAll(el) {
    this.roleTokens.clear();
    for (const ctrl of this.activeControllers) {
      try { ctrl.abort(); } catch (_) {}
    }
    this.activeControllers.clear();
    this.clear();
    if (el) {
      el.querySelectorAll(".actor").forEach(a => a.remove());
      el.querySelectorAll(".desk.away").forEach(d => d.classList.remove("away"));
    }
  }

  pauseAll() {
    for (const ctrl of this.activeControllers) {
      try { ctrl.pause?.(); } catch (_) {}
    }
  }

  resumeAll() {
    for (const ctrl of this.activeControllers) {
      try { ctrl.resume?.(); } catch (_) {}
    }
  }

  async runDOMWalk(el, item) {
    const { fx, walker, target, speed } = item;
    const fxLayer = el.querySelector(".fx-layer") || el;
    const rooms = el._rooms;
    const desks = el._desks || deskLayout((el.dataset.roles ? el.dataset.roles.split(":")[0].split(",") : []).filter(Boolean), rooms);

    const forwardPath = findWalkPath(walker, target, desks, rooms);
    if (forwardPath.length < 2) {
      this.finishDialogue(walker);
      this.returnToDesk(walker);
      return;
    }

    const dist = pathDistance(forwardPath);
    const textLen = (fx?.label || "").length;
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timing = walkDuration(dist, textLen, speed, reduced);

    const walkerDesk = walker === "user" ? el.querySelector(".user-spot") : el.querySelector(`.desk[data-role="${escRole(walker)}"]`);
    walkerDesk?.classList.add("away");

    const actor = document.createElement("div");
    actor.className = "actor";
    actor.dataset.role = walker;
    actor.style.left = `${forwardPath[0].x}px`;
    actor.style.top = `${forwardPath[0].y}px`;
    actor.innerHTML = `<div class="char">${sprite(walker)}</div>`;
    fxLayer.append(actor);

    const token = Symbol(walker);
    this.roleTokens.set(walker, token);

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
    this.activeControllers.add(ctrl);

    try {
      // 1. Walk forward to target
      await animatePath(actor, forwardPath, timing.legDuration, ctrl);
      if (ctrl.aborted) return;

      // 2. Arrive at target and begin conversation
      this.arriveAtTarget(walker);
      const { text, cls } = getBubbleContent(fx);
      const bubble = document.createElement("div");
      bubble.className = "actor-bubble" + (cls ? ` ${cls}` : "");
      bubble.textContent = text;
      actor.append(bubble);

      // Pulse target desk (active listening confirmation)
      const targetDesk = target === "user" ? el.querySelector(".user-spot") : el.querySelector(`.desk[data-role="${escRole(target)}"]`);
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

      // 3. Dialogue finished -> causality transfer point: unlock recipient!
      this.finishDialogue(walker);

      // 4. Walk back to own desk
      const returnPath = forwardPath.slice().reverse();
      await animatePath(actor, returnPath, timing.legDuration, ctrl);
    } finally {
      this.activeControllers.delete(ctrl);
      actor.remove();
      if (this.roleTokens.get(walker) === token) {
        this.roleTokens.delete(walker);
        walkerDesk?.classList.remove("away");
        this.returnToDesk(walker);
      }
    }
  }
}

export const globalCausalityDirector = new CausalityDirector({ maxConcurrent: 3, maxPerRoleQueue: 1 });
export const globalWalkQueue = globalCausalityDirector;

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
  globalCausalityDirector.cancelAll(el);
}

export function pauseAllWalks() {
  globalCausalityDirector.pauseAll();
}

export function resumeAllWalks() {
  globalCausalityDirector.resumeAll();
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
  el.dataset.roles = `${roles.join(",")}:${JSON.stringify(rooms ?? [])}`;
  const desks = deskLayout(roles, rooms);
  el._desks = desks;
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

/**
 * Handle interaction effect by walking characters and speech bubbles with natural pacing and causality sequencing.
 * @param {HTMLElement} el office element
 * @param {{kind:string, from:string, to:string, label:string}} fx
 * @param {number} speed playback speed multiplier (live = 1)
 */
export function playEffect(el, fx, speed = 1) {
  if (!el || !fx) return;

  const { walker, target } = globalCausalityDirector.resolveActors(fx);

  if (!walker || !target || walker === target) {
    const targetDesk = target === "user" ? el.querySelector(".user-spot") : el.querySelector(`.desk[data-role="${escRole(target)}"]`);
    if (targetDesk) {
      targetDesk.classList.add("ping");
      setTimeout(() => targetDesk.classList.remove("ping"), 300);
    }
    return;
  }

  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const timing = walkDuration(240, (fx.label || "").length, speed, reduced);

  // Instant or reduced motion mode: flash bubble at target desk without walking
  if (timing.isInstant) {
    const targetDesk = target === "user" ? el.querySelector(".user-spot") : el.querySelector(`.desk[data-role="${escRole(target)}"]`);
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

  // Enqueue via CausalityDirector with causality locking and single presence
  const status = globalCausalityDirector.enqueue(fx, speed, el);
  if (status === "overflow" || status === "dropped") {
    // Congested or role already has a waiting walk: flash bubble / ping at walker desk immediately
    const walkerDesk = walker === "user" ? el.querySelector(".user-spot") : el.querySelector(`.desk[data-role="${escRole(walker)}"]`);
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
  }
}

