// Office view: scaled pixel scene, desks with characters and status, live links and interaction effects.
import { sprite } from "./sprites.js";
import { deskLayout, ENTRANCE, SCENE } from "./layout.js";
import { sceneSvg } from "./scene.js";
import { activeLinks } from "./derive.js";
import { esc, plain } from "./util.js";

const PIX = (w, h, rects) => `<svg viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
const ICONS = {
  envelope: PIX(10, 8, '<rect y="0" width="10" height="8" fill="#fffaf0"/><rect width="10" height="1" fill="#b98a2e"/><rect y="7" width="10" height="1" fill="#b98a2e"/><rect width="1" height="8" fill="#b98a2e"/><rect x="9" width="1" height="8" fill="#b98a2e"/><rect x="1" y="1" width="2" height="1" fill="#b98a2e"/><rect x="7" y="1" width="2" height="1" fill="#b98a2e"/><rect x="3" y="2" width="1" height="1" fill="#b98a2e"/><rect x="6" y="2" width="1" height="1" fill="#b98a2e"/><rect x="4" y="3" width="2" height="1" fill="#b98a2e"/><rect x="4" y="4" width="2" height="2" fill="#e03e3e"/>'),
  flag: PIX(8, 8, '<rect x="1" width="1" height="8" fill="#5b3a1e"/><rect x="2" width="5" height="1" fill="#12a37a"/><rect x="2" y="1" width="6" height="2" fill="#12a37a"/><rect x="2" y="3" width="4" height="1" fill="#12a37a"/>'),
  alert: PIX(8, 8, '<rect x="1" width="6" height="8" fill="#e03e3e"/><rect x="3" y="1" width="2" height="4" fill="#fff"/><rect x="3" y="6" width="2" height="1" fill="#fff"/>'),
  reply: PIX(9, 8, '<rect width="9" height="6" fill="#4453d6"/><rect x="1" y="6" width="2" height="2" fill="#4453d6"/><rect x="1" y="1" width="7" height="1" fill="#fff"/><rect x="1" y="3" width="5" height="1" fill="#fff"/>'),
};

/** Desk name plates stay short: "Senior Developer" → "Developer", "DevOps / SRE" → "DevOps". */
const SHORT = { "business-strategist": "Strategist", "product-manager": "Product", "ai-engineer": "AI Engineer", "ui-ux": "UI/UX", architect: "Architect", developer: "Developer", marketing: "Marketing" };
export const shortName = (role, name) => SHORT[role] ?? String(name ?? role).split(" / ")[0];

const STATUS_VI = { working: "đang làm", waiting: "đang chờ", approval: "chờ bạn duyệt", idle: "rảnh" };
const head = (s, n) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n) + "…" : t; };
const tail = (s, n) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? "…" + t.slice(-n) : t; };

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

/**
 * Build (once per role set) and update the office.
 * @param {HTMLElement} el the .office element
 * @param {object} state reducer state
 * @param {{names: Record<string,string>, selected?: string, onSelect(role:string): void}} opts
 */
export function renderOffice(el, state, opts) {
  const roles = Object.keys(state.roles);
  const key = roles.join(",");
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
  el.querySelector(".user-spot").classList.toggle("in-chain", chain.has("user"));
  drawLinks(el, links);
}

function build(el, roles, opts) {
  el.dataset.roles = roles.join(",");
  const desks = deskLayout(roles);
  el.innerHTML = `<div class="scene" style="width:${SCENE.w}px;height:${SCENE.h}px">
    ${sceneSvg({ zones: new Set(desks.map(d => d.zone)) })}
    <svg class="links" viewBox="0 0 ${SCENE.w} ${SCENE.h}" aria-hidden="true"><g class="trails"></g><g class="live"></g></svg>
    <div class="user-spot" style="left:${ENTRANCE.x}px;top:${ENTRANCE.y}px"><div class="halo"></div><div class="char">${sprite("user")}</div><div class="plate">Bạn</div></div>
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

/** Scene-pixel anchor of a role (its chest) or of the user at the door. */
function point(el, who) {
  const node = who === "user" ? el.querySelector(".user-spot") : el.querySelector(`.desk[data-role="${CSS.escape(who)}"]`);
  if (!node) return { x: ENTRANCE.x, y: ENTRANCE.y };
  return { x: parseFloat(node.style.left), y: parseFloat(node.style.top) - 36 };
}

/** Curved path between two points, bowing upward-left so A→B and B→A don't overlap. */
function curve(a, b) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const bend = Math.min(90, len * 0.22);
  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${(mx + (dy / len) * bend).toFixed(1)} ${(my - (dx / len) * bend).toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

function drawLinks(el, links) {
  const g = el.querySelector(".links .live");
  const sig = links.map(l => `${l.id}:${l.from}:${l.to}:${l.kind}:${l.status}`).join("|");
  if (g.dataset.sig === sig) return;
  g.dataset.sig = sig;
  g.innerHTML = links.filter(l => l.from !== l.to).map(l => {
    const a = point(el, l.from), b = point(el, l.to);
    const cls = l.kind === "approval" ? "approval" : l.status === "queued" ? "queued" : "task";
    return `<path class="link ${cls}" d="${curve(a, b)}"/><circle class="link-end ${cls}" cx="${b.x}" cy="${b.y}" r="7"/>`;
  }).join("");
}

/** Scale the scene to fit its stage: by width and height on desktop, by width only when stacked. */
export function fit(el) {
  const stage = el.parentElement;
  if (!stage) return;
  const stacked = matchMedia("(max-width: 1000px)").matches;
  const k = Math.max(0.2, stacked ? stage.clientWidth / SCENE.w : Math.min(stage.clientWidth / SCENE.w, stage.clientHeight / SCENE.h));
  el.style.setProperty("--k", String(k));
  el.style.width = `${SCENE.w * k}px`;
  el.style.height = `${SCENE.h * k}px`;
}

/**
 * Animate one interaction effect from the reducer's queue: a parcel flying along a curve, leaving a fading trail.
 * @param {HTMLElement} el office element
 * @param {{kind:string, from:string, to:string, label:string}} fx
 * @param {number} speed playback speed multiplier (live = 1)
 */
export function playEffect(el, fx, speed = 1) {
  const layer = el.querySelector(".fx-layer");
  if (!layer || speed === Infinity || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const a = point(el, fx.from), b = point(el, fx.to);
  const dur = Math.max(450, 2600 / speed);
  const target = fx.to === "user" ? el.querySelector(".user-spot") : el.querySelector(`.desk[data-role="${CSS.escape(fx.to)}"]`);
  if (fx.kind === "approval") {
    const src = el.querySelector(`.desk[data-role="${CSS.escape(fx.from)}"]`);
    src?.classList.add("ping");
    setTimeout(() => src?.classList.remove("ping"), 1600);
  }
  const d = curve(a, b);
  // trail: draws in with the parcel, then fades
  const trails = el.querySelector(".links .trails");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  path.setAttribute("class", `trail ${fx.kind}`);
  trails.append(path);
  const len = path.getTotalLength();
  path.style.strokeDasharray = `${len}`;
  path.animate([{ strokeDashoffset: len, opacity: 1 }, { strokeDashoffset: 0, opacity: 1, offset: 0.35 }, { strokeDashoffset: 0, opacity: 0.9, offset: 0.6 }, { strokeDashoffset: 0, opacity: 0 }],
    { duration: dur * 3.2, easing: "ease-out", fill: "forwards" }).finished.then(() => path.remove(), () => path.remove());

  const icon = { handoff: ICONS.envelope, checkpoint: ICONS.flag, reply: ICONS.reply, approval: ICONS.alert }[fx.kind] ?? ICONS.envelope;
  const node = document.createElement("div");
  node.className = `fx fx-${fx.kind}`;
  node.style.offsetPath = `path("${d}")`;
  node.innerHTML = `<div class="icon">${icon}</div>${fx.label ? `<div class="label">${esc(head(plain(fx.label), 56))}</div>` : ""}`;
  layer.append(node);
  node.animate([
    { offsetDistance: "0%", opacity: 0, transform: "scale(.6)" },
    { opacity: 1, transform: "scale(1)", offset: 0.12 },
    { offsetDistance: "100%", opacity: 1, transform: "scale(1)", offset: 0.82 },
    { offsetDistance: "100%", opacity: 0, transform: "scale(.7)" },
  ], { duration: dur, easing: "ease-in-out", fill: "forwards" }).finished.then(() => node.remove(), () => node.remove());
  setTimeout(() => { target?.classList.add("ping"); setTimeout(() => target?.classList.remove("ping"), 900); }, dur * 0.8);
}
