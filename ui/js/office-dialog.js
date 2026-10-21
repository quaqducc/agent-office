// Office customization dialog: templates, dynamic rooms, and role room assignments.
import { api } from "./api.js";
import { icon } from "./icons.js";
import { getRoomBoxes, getRoomCapacity, ZONES } from "./layout.js";
import { sprite } from "./sprites.js";
import { esc } from "./util.js";

/**
 * @param {{
 *   wsId: string,
 *   toast: (m: string, k?: string) => void,
 *   reloadRoles?: () => Promise<void> | void,
 *   openStore?: () => void,
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
  let storeState = null;

  try {
    const [tList, rList, cfg, sState] = await Promise.all([
      api.offices(),
      api.roles(),
      api.config(ctx.wsId),
      api.store().catch(() => ({ roles: [] })),
    ]);
    templates = tList;
    installedRoles = rList;
    currentCfg = cfg;
    storeState = sState;
  } catch (err) {
    ctx.toast(err.message, "bad");
    d.close();
    return;
  }

  // Build role display name lookup map
  const roleNames = {};
  for (const r of storeState?.roles || []) {
    if (r.id && r.name) roleNames[r.id] = r.name;
  }
  for (const r of installedRoles || []) {
    if (r.id && r.name) roleNames[r.id] = r.name;
  }
  const getRoleName = id => roleNames[id] || id;

  const installedIds = new Set(installedRoles.map(r => r.id));
  let activeRoles = new Set(currentCfg.roles || ["manager"]);
  activeRoles.add("manager");

  const hasConfiguredRooms = Boolean(currentCfg.rooms && currentCfg.rooms.length > 0);
  let selectedTemplate = hasConfiguredRooms ? (currentCfg.template || "") : "default";

  function getDefaultRooms(rolesSet) {
    const assigned = new Set();
    const res = ZONES.map(z => {
      const inZone = (z.roles || []).filter(r => rolesSet.has(r));
      inZone.forEach(r => assigned.add(r));
      return {
        id: z.id,
        name: z.name,
        roles: inZone,
      };
    });
    const remaining = Array.from(rolesSet).filter(r => !assigned.has(r));
    const spec = res.find(r => r.id === "specialists");
    if (spec) {
      spec.roles.push(...remaining);
    } else if (res[0]) {
      res[0].roles.push(...remaining);
    }
    return res;
  }

  // Initialize rooms: use workspace rooms if set, or default department rooms
  let rooms = hasConfiguredRooms
    ? JSON.parse(JSON.stringify(currentCfg.rooms))
    : getDefaultRooms(activeRoles);

  ensureRoleAssignments();

  function ensureRoleAssignments() {
    const assigned = new Set();
    for (const rm of rooms) {
      rm.roles = (rm.roles || []).filter(r => activeRoles.has(r) && !assigned.has(r));
      rm.roles.forEach(r => assigned.add(r));
    }
    for (const r of activeRoles) {
      if (!assigned.has(r)) {
        if (rooms.length === 0) {
          rooms.push({ id: "exec", name: "Ban Giám Đốc", roles: [] });
        }
        rooms[0].roles.push(r);
        assigned.add(r);
      }
    }
  }

  function render() {
    ensureRoleAssignments();

    // Check for uninstalled roles in active selection
    const missingRoles = Array.from(activeRoles).filter(r => !installedIds.has(r));
    const boxes = getRoomBoxes(rooms.length);
    const hasOverCap = rooms.some((rm, idx) => rm.roles.length > getRoomCapacity(boxes[idx]));

    // Collect all candidate roles: installed roles + template roles + active roles
    const allRoleIds = Array.from(new Set([
      ...installedRoles.map(r => r.id),
      ...templates.flatMap(t => t.roles),
      ...activeRoles,
    ])).sort((a, b) => (a === "manager" ? -1 : b === "manager" ? 1 : getRoleName(a).localeCompare(getRoleName(b))));

    d.innerHTML = `<div class="sheet-head">
      <div>
        <h2 id="office-title">Tùy biến văn phòng</h2>
        <p class="hint">Chọn mẫu văn phòng có sẵn hoặc tùy biến phòng và vai trò (role) của từng phòng.</p>
      </div>
      <button type="button" class="icon-btn" data-act="close" aria-label="Đóng">${icon("x")}</button>
    </div>

    <div class="sheet-body office-dialog-body">
      ${missingRoles.length > 0 ? `
        <div class="office-warning-banner">
          <div class="office-warning-header">
            ${icon("alert")}
            <span>Một số vai trò trong cấu hình chưa được cài đặt:</span>
          </div>
          <div class="office-warning-items">
            ${missingRoles.map(rid => `
              <div class="office-warning-item">
                <span>Cần cài: <strong>${esc(getRoleName(rid))}</strong></span>
                <button type="button" class="btn small primary-subtle" data-install-role="${esc(rid)}">
                  ${icon("download")}Cài ngay
                </button>
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}

      ${hasOverCap ? `
        <div class="banner warn" style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
          ${icon("alert")}
          <span><strong>Cảnh báo sức chứa:</strong> Một số phòng vượt quá sức chứa tối đa. Vui lòng chuyển bớt vai trò sang phòng khác trước khi lưu.</span>
        </div>
      ` : ""}

      <section class="office-sec">
        <h3 class="office-sec-title">Mẫu văn phòng (Templates)</h3>
        <div class="office-templates-grid">
          <div class="office-tpl-card${selectedTemplate === "default" ? " selected" : ""}" data-tpl="default">
            <div class="tpl-head">
              <div class="tpl-title">
                <span class="tpl-name">Mặc định (theo phòng ban)</span>
                ${selectedTemplate === "default" ? `<span class="tag good">Đang chọn</span>` : ""}
              </div>
              <small class="tpl-desc">Sơ đồ 4 phòng ban chuẩn cùng khu Chuyên gia theo mặc định</small>
            </div>
            <div class="tpl-rooms">
              <span class="tag small">Phòng Manager</span>
              <span class="tag small">Chiến lược & Sản phẩm</span>
              <span class="tag small">Kế hoạch & Phản biện</span>
              <span class="tag small">Kỹ thuật</span>
              <span class="tag small">Chuyên gia</span>
            </div>
          </div>
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
          ${rooms.map((rm, idx) => {
            const cap = getRoomCapacity(boxes[idx]);
            const isOver = rm.roles.length > cap;
            const isFull = rm.roles.length === cap;
            return `
            <div class="office-room-row" data-room-idx="${idx}">
              <div class="room-title-col">
                <span class="room-num">${idx + 1}.</span>
                <input type="text" class="input room-name-input" data-room-idx="${idx}" value="${esc(rm.name)}" placeholder="Tên phòng" />
                <span class="tag small ${isOver ? "danger" : isFull ? "warn" : "muted"}" title="Sức chứa tối đa: ${cap} vai trò">${rm.roles.length}/${cap}</span>
              </div>
              <div class="room-roles-summary">
                ${rm.roles.map(r => `
                  <span class="role-chip" title="${esc(getRoleName(r))}">${sprite(r)}<span>${esc(getRoleName(r))}</span></span>
                `).join("")}
                ${rm.roles.length === 0 ? `<span class="muted text-sm">(Chưa có role nào)</span>` : ""}
              </div>
              <button type="button" class="icon-btn danger room-del-btn" data-del-room="${idx}" ${rooms.length <= 1 ? "disabled" : ""} title="Xoá phòng">
                ${icon("trash")}
              </button>
            </div>
          `;}).join("")}
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
                    <span class="role-name">${esc(getRoleName(roleId))}</span>
                    ${!isInstalled ? `<span class="tag warn small">Chưa cài</span>` : ""}
                  </div>
                </label>
                <div class="role-action-col">
                  ${!isInstalled ? `
                    <button type="button" class="btn small primary-subtle" data-install-role="${esc(roleId)}">
                      ${icon("download")}Cài ngay
                    </button>
                  ` : isEnabled ? `
                    <select class="input select-room" data-role="${esc(roleId)}">
                      ${rooms.map((rm, idx) => {
                        const cap = getRoomCapacity(boxes[idx]);
                        const isCurrent = idx === currentRoomIdx;
                        const isFull = !isCurrent && rm.roles.length >= cap;
                        return `
                          <option value="${idx}" ${isCurrent ? "selected" : ""} ${isFull ? "disabled" : ""}>
                            Phòng: ${esc(rm.name)} (${rm.roles.length}/${cap}${isFull ? " - Đầy" : ""})
                          </option>
                        `;
                      }).join("")}
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
        if (tplId === "default") {
          selectedTemplate = "default";
          rooms = getDefaultRooms(activeRoles);
          render();
          return;
        }
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
        if (selectedTemplate === "default") selectedTemplate = null;
        const idx = Number(e.target.dataset.roomIdx);
        if (rooms[idx]) rooms[idx].name = e.target.value.trim() || `Phòng ${idx + 1}`;
      });
    });

    // Add room
    d.querySelector('[data-act="add-room"]')?.addEventListener("click", () => {
      if (rooms.length >= 6) return;
      selectedTemplate = null;
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
        selectedTemplate = null;
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
          if (!rooms.some(rm => rm.roles.includes(roleId))) {
            const availIdx = rooms.findIndex((rm, idx) => rm.roles.length < getRoomCapacity(boxes[idx]));
            if (availIdx !== -1) rooms[availIdx].roles.push(roleId);
            else if (rooms[0]) rooms[0].roles.push(roleId);
          }
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
        selectedTemplate = null;
        const roleId = e.target.dataset.role;
        const newRoomIdx = Number(e.target.value);
        const targetCap = getRoomCapacity(boxes[newRoomIdx]);
        const otherRolesInRoom = rooms[newRoomIdx]?.roles.filter(r => r !== roleId).length ?? 0;
        if (otherRolesInRoom >= targetCap) {
          ctx.toast(`Phòng "${rooms[newRoomIdx]?.name}" đã đầy sức chứa (${targetCap} vai trò)`, "warn");
          render();
          return;
        }
        for (const rm of rooms) rm.roles = rm.roles.filter(r => r !== roleId);
        if (rooms[newRoomIdx]) rooms[newRoomIdx].roles.push(roleId);
        render();
      });
    });

    // Inline install role button
    d.querySelectorAll("[data-install-role]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const rid = btn.dataset.installRole;
        btn.disabled = true;
        btn.textContent = "Đang cài...";
        try {
          await api.installRole(rid);
          installedIds.add(rid);
          ctx.toast(`Đã cài đặt vai trò ${getRoleName(rid)}`, "good");
          if (ctx.reloadRoles) {
            try { await ctx.reloadRoles(); } catch (_) {}
          }
          render();
        } catch (err) {
          ctx.toast(`Lỗi cài đặt ${getRoleName(rid)}: ${err.message}`, "bad");
          btn.disabled = false;
          btn.innerHTML = `${icon("download")}Cài ngay`;
        }
      });
    });

    // Save configuration
    d.querySelector('[data-act="save"]')?.addEventListener("click", async () => {
      if (hasOverCap) {
        ctx.toast("Vui lòng phân bổ lại vai trò để các phòng không vượt quá sức chứa tối đa.", "warn");
        return;
      }
      ensureRoleAssignments();
      activeRoles.add("manager");
      const rolesArray = Array.from(activeRoles);
      const saveBtn = d.querySelector('[data-act="save"]');
      if (saveBtn) saveBtn.disabled = true;

      const payload = selectedTemplate === "default"
        ? { roles: rolesArray, rooms: null, template: null }
        : {
            template: selectedTemplate || undefined,
            roles: rolesArray,
            rooms: rooms.map(rm => ({ id: rm.id, name: rm.name, roles: rm.roles })),
          };

      try {
        const updated = await api.saveWorkspaceConfig(ctx.wsId, payload);
        ctx.toast("Đã lưu cấu hình văn phòng thành công", "good");
        d.close();
        ctx.onSave(updated);
      } catch (err) {
        let msg = err.message || "Lỗi lưu cấu hình";
        if (err.missing && Array.isArray(err.missing) && err.missing.length > 0) {
          const missingNames = err.missing.map(getRoleName).join(", ");
          msg = `Các vai trò sau chưa được cài đặt: ${missingNames}`;
        } else if (msg.includes("uninstalled roles:")) {
          const rawList = msg.replace("uninstalled roles:", "").trim();
          const names = rawList.split(",").map(s => getRoleName(s.trim())).join(", ");
          msg = `Các vai trò sau chưa được cài đặt: ${names}`;
        }
        ctx.toast(msg, "bad");
        if (saveBtn) saveBtn.disabled = false;
      }
    });
  }

  render();
}
