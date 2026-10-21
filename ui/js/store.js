// Role store dialog: browse the catalog, install / update / remove roles.
import { api } from "./api.js";
import { icon } from "./icons.js";
import { sprite } from "./sprites.js";
import { esc } from "./util.js";

const rank = r => (r.installed === "base" ? 0 : r.installed ? 1 : 2);

/**
 * @param {{ toast: (m:string,k?:string)=>void, ask: (o:object)=>Promise<object|null>, onChange: ()=>Promise<void>|void }} ctx
 */
export function openStore(ctx) {
  const d = document.getElementById("store");
  let state = null;
  let filter = "all";
  const busy = {};   // role id → "install" | "remove"
  const errors = {}; // role id → message

  d.innerHTML = `<div class="sheet-head"><div><h2 id="store-title">Kho role</h2>
      <p class="hint">Cài thêm role khi đội cần. Manager sẽ giao việc cho role mới ngay khi cài xong.</p></div>
      <button type="button" class="icon-btn" data-s="close" aria-label="Đóng">${icon("x")}</button></div>
    <div class="chips store-filter" role="group" aria-label="Lọc role">
      <button type="button" data-f="all" class="on">Tất cả</button><button type="button" data-f="installed">Đã cài</button><button type="button" data-f="available">Chưa cài</button>
    </div>
    <div class="sheet-body store-grid" aria-live="polite"></div>`;
  d.setAttribute("aria-labelledby", "store-title");
  const body = d.querySelector(".sheet-body");

  function draw() {
    if (!state) return;
    const roles = [...state.roles]
      .filter(r => filter === "all" || (filter === "installed" ? r.installed : !r.installed))
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "vi"));
    body.innerHTML = roles.length ? roles.map(card).join("") : `<p class="none">Không có role nào ở mục này.</p>`;
  }

  function card(r) {
    const b = busy[r.id];
    const badge = r.installed === "base" ? `<span class="tag">Cơ bản</span>`
      : r.updateAvailable ? `<span class="tag accent">Có bản mới</span>` : r.installed ? `<span class="tag good">Đã cài</span>` : "";
    const action = r.installed === "base" ? `<span class="always">Luôn có sẵn</span>`
      : b ? `<button type="button" class="btn small" disabled><span class="spin" aria-hidden="true"></span>${b === "install" ? "Đang cài…" : "Đang gỡ…"}</button>`
      : r.installed ? `${r.updateAvailable ? `<button type="button" class="btn small primary" data-install="${esc(r.id)}">${icon("refresh")}Cập nhật</button>` : ""}
          <button type="button" class="btn small" data-remove="${esc(r.id)}">${icon("trash")}Gỡ</button>`
      : `<button type="button" class="btn small primary" data-install="${esc(r.id)}">${icon("download")}Cài</button>`;
    return `<article class="role-card${r.installed ? " is-installed" : ""}">
      <div class="rc-head"><span class="av md">${sprite(r.id)}</span><div><h3>${esc(r.name)}</h3>${badge}</div></div>
      <p class="rc-desc">${esc(r.description ?? "")}</p>
      ${r.owns ? `<p class="rc-owns"><b>Phụ trách:</b> ${esc(r.owns)}</p>` : ""}
      <div class="rc-foot"><small>${r.skills?.length ?? 0} kỹ năng</small><span class="rc-actions">${action}</span></div>
      ${errors[r.id] ? `<p class="status-line bad" role="alert">${esc(errors[r.id])}</p>` : ""}
    </article>`;
  }

  async function load() {
    body.innerHTML = `<p class="none"><span class="spin" aria-hidden="true"></span> Đang tải kho role…</p>`;
    try { state = await api.store(); draw(); }
    catch (e) {
      body.innerHTML = `<div class="empty"><h3>Không tải được kho role</h3><p>${esc(e.message)}</p>
        <button type="button" class="btn" data-s="retry">${icon("refresh")}Thử lại</button></div>`;
    }
  }

  async function change(id, kind) {
    const role = state.roles.find(r => r.id === id);
    if (kind === "remove") {
      const ok = await ctx.ask({ title: `Gỡ ${role.name}?`, text: "Role sẽ rời văn phòng. Lịch sử các lần chạy cũ vẫn được giữ. Bạn có thể cài lại bất cứ lúc nào.", confirm: "Gỡ role", danger: true });
      if (!ok) return;
    }
    busy[id] = kind;
    delete errors[id];
    draw();
    try {
      if (kind === "install") await api.installRole(id); else await api.uninstallRole(id);
      state = await api.store();
      ctx.toast(kind === "install" ? `Đã cài ${role.name} — có bàn làm việc trong văn phòng rồi` : `Đã gỡ ${role.name}`, "good");
      await ctx.onChange();
    } catch (e) { errors[id] = `${kind === "install" ? "Cài" : "Gỡ"} không được: ${e.message}`; }
    finally { delete busy[id]; draw(); }
  }

  d.listeners?.abort(); // the dialog element is reused between openings
  d.listeners = new AbortController();
  d.addEventListener("click", ev => {
    const t = ev.target.closest("[data-install], [data-remove], [data-f], [data-s]");
    if (!t || !d.contains(t)) return;
    if (t.dataset.install) change(t.dataset.install, "install");
    else if (t.dataset.remove) change(t.dataset.remove, "remove");
    else if (t.dataset.f) {
      filter = t.dataset.f;
      d.querySelectorAll("[data-f]").forEach(b => b.classList.toggle("on", b === t));
      draw();
    }
    else if (t.dataset.s === "close") d.close();
    else if (t.dataset.s === "retry") load();
  }, { signal: d.listeners.signal });
  d.showModal();
  load();
}
