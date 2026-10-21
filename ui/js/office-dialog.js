// Office customization dialog: templates, dynamic rooms, and role room assignments.
import { api } from "./api.js";
import { icon } from "./icons.js";
import { sprite } from "./sprites.js";
import { esc } from "./util.js";

/**
 * @param {{
 *   wsId: string,
 *   toast: (m: string, k?: string) => void,
 *   openStore: () => void,
 *   onSave: (cfg: { roles: string[]; rooms: any[]; template?: string }) => void
 * }} ctx
 */
export async function openOfficeDialog(ctx) {
  const d = document.getElementById("office-dialog");
  if (!d) return;

  d.innerHTML = `<div class="sheet-head">
    <div>
      <h2 id="office-title">Tùy biến văn phòng</h2>
      <p class="hint">Đang tải cấu hình…</p>
    </div>
    <button type="button" class="icon-btn" data-act="close" aria-label="Đóng">${icon("x")}</button>
  </div>`;
  d.showModal();

  const onClose = () => { d.close(); };
  d.querySelector('[data-act="close"]')?.addEventListener("click", onClose);

  let templates = [];
  let installedRoles = [];
  let currentCfg = null;

  try {
    const [tList, rList, cfg] = await Promise.all([
      api.offices(),
      api.roles(),
      api.config(ctx.wsId),
    ]);
    templates = tList;
    installedRoles = rList;
    currentCfg = cfg;
  } catch (err) {
    ctx.toast(err.message, "bad");
    d.close();
    return;
  }

  const installedIds = new Set(installedRoles.map(r => r.id));
  let selectedTemplate = currentCfg.template || "";
  let activeRoles = new Set(currentCfg.roles || ["manager"]);

  // Initialize rooms: use workspace rooms, or fallback to startup-mvp default rooms or 3 standard rooms
  let rooms = currentCfg.rooms && currentCfg.rooms.length > 0
    ? JSON.parse(JSON.stringify(currentCfg.rooms))
    : [
        { id: "exec", name: "Ban Giám Đốc", roles: ["manager"] },
        { id: "product", name: "Sản Phẩm & Nghiên Cứu", roles: [] },
        { id: "eng", name: "Kỹ Thuật", roles: [] },
      ];

  // Invariant check: manager always in activeRoles and assigned to room 0 if not assigned
  activeRoles.add("manager");
  ensureRoleAssignments();

  function ensureRoleAssignments() {
    const assigned = new Set();
    for (const rm of rooms) {
      rm.roles = (rm.roles || []).filter(r => activeRoles.has(r) && !assigned.has(r));
      rm.roles.forEach(r => assigned.add(r));
    }
    for (const r of activeRoles) {
      if (!assigned.has(r)) {
        rooms[0].roles.push(r);
        assigned.add(r);
      }
    }
  }

  function render() {
    ensureRoleAssignments();

    // Collect all candidate roles: installed roles + any roles mentioned in templates
    const allRoleIds = Array.from(new Set([
      ...installedRoles.map(r => r.id),
      ...templates.flatMap(t => t.roles),
      ...activeRoles,
    ])).sort((a, b) => (a === "manager" ? -1 : b === "manager" ? 1 : a.localeCompare(b)));

    d.innerHTML = `<div class="sheet-head">
      <div>
        <h2 id="office-title">Tùy biến văn phòng</h2>
        <p class="hint">Chọn mẫu văn phòng có sẵn hoặc tùy biến phòng và vai trò (role) của từng phòng.</p>
      </div>
      <button type="button" class="icon-btn" data-act="close" aria-label="Đóng">${icon("x")}</button>
    </div>

    <div class="sheet-body office-dialog-body">
      <section class="office-sec">
        <h3 class="office-sec-title">Mẫu văn phòng (Templates)</h3>
        <div class="office-templates-grid">
          ${templates.map(t => {
            const isSel = selectedTemplate === t.id;
            return `
              <div class="office-tpl-card${isSel ? " selected" : ""}" data-tpl="${esc(t.id)}">
                <div class="tpl-head">
                  <div class="tpl-title">
                    <span class="tpl-name">${esc(t.name)}</span>
                    ${isSel ? `<span class="tag good">Đang chọn</span>` : ""}
                  </div>
                  <small class="tpl-desc">${esc(t.desc)}</small>
                </div>
                <div class="tpl-rooms">
                  ${t.rooms.map(rm => `<span class="tag small">${esc(rm.name)} (${rm.roles.length})</span>`).join("")}
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </section>

      <section class="office-sec">
        <div class="office-sec-header">
          <h3 class="office-sec-title">Quản lý phòng (${rooms.length}/6)</h3>
          <button type="button" class="btn small" data-act="add-room" ${rooms.length >= 6 ? "disabled" : ""}>
            ${icon("plus")}Thêm phòng
          </button>
        </div>
        <div class="office-rooms-list">
          ${rooms.map((rm, idx) => `
            <div class="office-room-row" data-room-idx="${idx}">
              <div class="room-title-col">
                <span class="room-num">${idx + 1}.</span>
                <input type="text" class="input room-name-input" data-room-idx="${idx}" value="${esc(rm.name)}" placeholder="Tên phòng" />
              </div>
              <div class="room-roles-summary">
                ${rm.roles.map(r => `
                  <span class="role-chip" title="${esc(r)}">${sprite(r)}<span>${esc(r)}</span></span>
                `).join("")}
                ${rm.roles.length === 0 ? `<span class="muted text-sm">(Chưa có role nào)</span>` : ""}
              </div>
              <button type="button" class="icon-btn danger room-del-btn" data-del-room="${idx}" ${rooms.length <= 1 ? "disabled" : ""} title="Xoá phòng">
                ${icon("trash")}
              </button>
            </div>
          `).join("")}
        </div>
      </section>

      <section class="office-sec">
        <h3 class="office-sec-title">Phân công Role vào phòng</h3>
        <div class="office-roles-list">
          ${allRoleIds.map(roleId => {
            const isInstalled = installedIds.has(roleId);
            const isEnabled = activeRoles.has(roleId);
            const isManager = roleId === "manager";
            const currentRoomIdx = rooms.findIndex(rm => rm.roles.includes(roleId));

            return `
              <div class="office-role-row${isEnabled ? " active" : ""}">
                <label class="role-check-col">
                  <input type="checkbox" data-role="${esc(roleId)}" ${isEnabled ? "checked" : ""} ${isManager || !isInstalled ? "disabled" : ""} />
                  <span class="role-avatar">${sprite(roleId)}</span>
                  <div class="role-meta-col">
                    <span class="role-name">${esc(roleId)}</span>
                    ${!isInstalled ? `<span class="tag warn small">Chưa cài</span>` : ""}
                  </div>
                </label>
                <div class="role-action-col">
                  ${!isInstalled ? `
                    <button type="button" class="btn small" data-open-store="1">${icon("store")}Cài đặt</button>
                  ` : isEnabled ? `
                    <select class="input select-room" data-role="${esc(roleId)}">
                      ${rooms.map((rm, idx) => `
                        <option value="${idx}" ${idx === currentRoomIdx ? "selected" : ""}>Phòng: ${esc(rm.name)}</option>
                      `).join("")}
                    </select>
                  ` : `<span class="muted text-sm">Không hoạt động</span>`}
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </section>
    </div>

    <div class="sheet-foot">
      <button type="button" class="btn" data-act="close">Huỷ</button>
      <button type="button" class="btn primary" data-act="save">${icon("check")}Lưu cấu hình</button>
    </div>`;

    wireEvents();
  }

  function wireEvents() {
    d.querySelectorAll('[data-act="close"]').forEach(b => b.addEventListener("click", onClose));

    // Template selection
    d.querySelectorAll("[data-tpl]").forEach(elCard => {
      elCard.addEventListener("click", () => {
        const tplId = elCard.dataset.tpl;
        const tpl = templates.find(t => t.id === tplId);
        if (!tpl) return;
        selectedTemplate = tpl.id;
        activeRoles = new Set(tpl.roles);
        activeRoles.add("manager");
        rooms = tpl.rooms.map(rm => ({
          id: rm.id,
          name: rm.name,
          roles: [...rm.roles],
        }));
        render();
      });
    });

    // Room name editing
    d.querySelectorAll(".room-name-input").forEach(input => {
      input.addEventListener("input", e => {
        const idx = Number(e.target.dataset.roomIdx);
        if (rooms[idx]) rooms[idx].name = e.target.value.trim() || `Phòng ${idx + 1}`;
      });
    });

    // Add room
    d.querySelector('[data-act="add-room"]')?.addEventListener("click", () => {
      if (rooms.length >= 6) return;
      rooms.push({
        id: `room-${Date.now()}`,
        name: `Phòng ${rooms.length + 1}`,
        roles: [],
      });
      render();
    });

    // Delete room
    d.querySelectorAll("[data-del-room]").forEach(b => {
      b.addEventListener("click", () => {
        if (rooms.length <= 1) return;
        const idx = Number(b.dataset.delRoom);
        const deletedRoles = rooms[idx].roles || [];
        rooms.splice(idx, 1);
        // Move deleted room's roles to first room
        deletedRoles.forEach(r => {
          if (!rooms[0].roles.includes(r)) rooms[0].roles.push(r);
        });
        render();
      });
    });

    // Role checkbox toggle
    d.querySelectorAll("input[type=checkbox][data-role]").forEach(cb => {
      cb.addEventListener("change", e => {
        const roleId = e.target.dataset.role;
        if (roleId === "manager") return;
        if (e.target.checked) {
          activeRoles.add(roleId);
          if (!rooms[0].roles.includes(roleId)) rooms[0].roles.push(roleId);
        } else {
          activeRoles.delete(roleId);
          for (const rm of rooms) rm.roles = rm.roles.filter(r => r !== roleId);
        }
        render();
      });
    });

    // Role room select
    d.querySelectorAll(".select-room[data-role]").forEach(sel => {
      sel.addEventListener("change", e => {
        const roleId = e.target.dataset.role;
        const newRoomIdx = Number(e.target.value);
        for (const rm of rooms) rm.roles = rm.roles.filter(r => r !== roleId);
        if (rooms[newRoomIdx]) rooms[newRoomIdx].roles.push(roleId);
        render();
      });
    });

    // Open store button
    d.querySelectorAll("[data-open-store]").forEach(b => {
      b.addEventListener("click", () => {
        d.close();
        ctx.openStore();
      });
    });

    // Save configuration
    d.querySelector('[data-act="save"]')?.addEventListener("click", async () => {
      ensureRoleAssignments();
      activeRoles.add("manager");
      const rolesArray = Array.from(activeRoles);
      const saveBtn = d.querySelector('[data-act="save"]');
      if (saveBtn) saveBtn.disabled = true;

      try {
        const updated = await api.saveWorkspaceConfig(ctx.wsId, {
          template: selectedTemplate || undefined,
          roles: rolesArray,
          rooms: rooms.map(rm => ({ id: rm.id, name: rm.name, roles: rm.roles })),
        });
        ctx.toast("Đã lưu cấu hình văn phòng thành công", "good");
        d.close();
        ctx.onSave(updated);
      } catch (err) {
        ctx.toast(err.message, "bad");
        if (saveBtn) saveBtn.disabled = false;
      }
    });
  }

  render();
}
