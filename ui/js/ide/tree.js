// Explorer Tree View (Lazy load depth 1)
import { api } from "../api.js";
import { icon } from "../icons.js";

export function createExplorerTree({ container, onFileSelect }) {
  let currentWorkspaceId = null;
  const folderCache = new Map(); // path -> TreeNode[]
  let focusedNodeEl = null;
  const changedFilesMap = new Map(); // normalized relative path -> "A" | "M"

  function norm(p) {
    return String(p || "").replace(/\\/g, "/").replace(/^\.\//, "").trim();
  }

  async function load(workspaceId) {
    currentWorkspaceId = workspaceId;
    folderCache.clear();
    container.innerHTML = `<div class="tree-loading">Đang tải cây thư mục…</div>`;

    try {
      const res = await api.tree(workspaceId, ".", 1);
      const nodes = Array.isArray(res) ? res : (res?.entries || []);
      folderCache.set(".", nodes);
      render();
    } catch (err) {
      container.innerHTML = `<div class="tree-error">Lỗi tải thư mục: ${escapeHtml(err.message)}</div>`;
    }
  }

  function render() {
    container.innerHTML = "";
    const rootNodes = folderCache.get(".") || [];
    if (!rootNodes.length) {
      container.innerHTML = `<div class="tree-empty">Thư mục trống</div>`;
      return;
    }

    const ul = document.createElement("ul");
    ul.className = "tree-list";
    ul.setAttribute("role", "tree");
    for (const node of rootNodes) {
      ul.appendChild(createNodeElement(node, 0));
    }
    container.appendChild(ul);
  }

  function createNodeElement(node, level) {
    const li = document.createElement("li");
    li.className = `tree-item ${node.type}`;
    li.setAttribute("role", "treeitem");
    li.setAttribute("data-path", node.path);
    li.setAttribute("data-type", node.type);
    li.setAttribute("tabindex", "-1");

    const row = document.createElement("div");
    row.className = "tree-row";
    row.style.paddingLeft = `${level * 16 + 8}px`;

    if (node.type === "directory") {
      const arrow = document.createElement("span");
      arrow.className = "tree-arrow";
      arrow.innerHTML = "▸";
      row.appendChild(arrow);

      const fIcon = document.createElement("span");
      fIcon.className = "tree-icon folder-icon";
      fIcon.innerHTML = icon("folder");
      row.appendChild(fIcon);
    } else {
      const spacer = document.createElement("span");
      spacer.className = "tree-arrow-spacer";
      row.appendChild(spacer);

      const fileIcon = document.createElement("span");
      fileIcon.className = "tree-icon file-icon";
      fileIcon.innerHTML = node.isSecret ? icon("lock") : icon("file");
      row.appendChild(fileIcon);
    }

    const label = document.createElement("span");
    label.className = "tree-label";
    label.textContent = node.name;
    row.appendChild(label);

    const normNodePath = norm(node.path);

    if (node.type === "file") {
      const changeStatus = changedFilesMap.get(normNodePath);
      if (changeStatus) {
        const badge = document.createElement("span");
        badge.className = `badge-tag badge-${changeStatus.toLowerCase()}`;
        badge.textContent = changeStatus;
        badge.title = changeStatus === "A" ? "Tệp thêm mới" : "Tệp đã chỉnh sửa";
        row.appendChild(badge);
      }
    } else if (node.type === "directory") {
      // Check bubble-up: any changed file inside this directory
      let hasChildChange = false;
      const prefix = normNodePath ? normNodePath + "/" : "";
      for (const p of changedFilesMap.keys()) {
        if (p.startsWith(prefix)) {
          hasChildChange = true;
          break;
        }
      }
      if (hasChildChange) {
        const dot = document.createElement("span");
        dot.className = "bubble-dot";
        dot.title = "Có tệp thay đổi bên trong thư mục này";
        row.appendChild(dot);
      }
    }

    if (node.isSecret) {
      const lockBadge = document.createElement("span");
      lockBadge.className = "tree-badge secret";
      lockBadge.title = "Bảo vệ bởi guard.ts";
      lockBadge.textContent = "🔒";
      row.appendChild(lockBadge);
    }

    li.appendChild(row);

    // Click handler
    row.addEventListener("click", async (e) => {
      e.stopPropagation();
      setFocus(li);
      if (node.type === "directory") {
        await toggleDirectory(li, node, level);
      } else {
        if (!node.isSecret) {
          onFileSelect?.(node.path);
        }
      }
    });

    return li;
  }

  async function toggleDirectory(li, node, level) {
    const arrow = li.querySelector(".tree-arrow");
    const existingChildren = li.querySelector(".tree-children");

    if (existingChildren) {
      const isExpanded = existingChildren.style.display !== "none";
      existingChildren.style.display = isExpanded ? "none" : "block";
      if (arrow) arrow.textContent = isExpanded ? "▸" : "▾";
      li.setAttribute("aria-expanded", String(!isExpanded));
      return;
    }

    if (arrow) arrow.textContent = "▾";
    li.setAttribute("aria-expanded", "true");

    let children = folderCache.get(node.path);
    if (!children) {
      try {
        const res = await api.tree(currentWorkspaceId, node.path, 1);
        children = Array.isArray(res) ? res : (res?.entries || []);
        folderCache.set(node.path, children);
      } catch (err) {
        const errDiv = document.createElement("div");
        errDiv.className = "tree-children tree-error";
        errDiv.textContent = `Lỗi: ${err.message}`;
        li.appendChild(errDiv);
        return;
      }
    }

    const childUl = document.createElement("ul");
    childUl.className = "tree-children";
    for (const child of children) {
      childUl.appendChild(createNodeElement(child, level + 1));
    }
    li.appendChild(childUl);
  }

  function setFocus(li) {
    if (focusedNodeEl) focusedNodeEl.classList.remove("focused");
    focusedNodeEl = li;
    if (focusedNodeEl) {
      focusedNodeEl.classList.add("focused");
      focusedNodeEl.focus();
    }
  }

  // Keyboard navigation on container
  container.addEventListener("keydown", async (e) => {
    if (!focusedNodeEl) {
      const first = container.querySelector(".tree-item");
      if (first) setFocus(first);
      return;
    }

    const allItems = Array.from(container.querySelectorAll(".tree-item:not([style*='display: none'])"));
    const currentIndex = allItems.indexOf(focusedNodeEl);

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = allItems[currentIndex + 1];
      if (next) setFocus(next);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = allItems[currentIndex - 1];
      if (prev) setFocus(prev);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      const isDir = focusedNodeEl.getAttribute("data-type") === "directory";
      if (isDir) {
        const arrow = focusedNodeEl.querySelector(".tree-arrow");
        if (arrow && arrow.textContent === "▸") {
          const path = focusedNodeEl.getAttribute("data-path");
          const node = { path, type: "directory" };
          const level = (focusedNodeEl.querySelector(".tree-row").style.paddingLeft.replace("px", "") - 8) / 16;
          await toggleDirectory(focusedNodeEl, node, level);
        }
      }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const isDir = focusedNodeEl.getAttribute("data-type") === "directory";
      if (isDir) {
        const arrow = focusedNodeEl.querySelector(".tree-arrow");
        if (arrow && arrow.textContent === "▾") {
          const path = focusedNodeEl.getAttribute("data-path");
          const node = { path, type: "directory" };
          const level = (focusedNodeEl.querySelector(".tree-row").style.paddingLeft.replace("px", "") - 8) / 16;
          await toggleDirectory(focusedNodeEl, node, level);
        }
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      focusedNodeEl.querySelector(".tree-row")?.click();
    }
  });

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function setChangedFiles(changes) {
    changedFilesMap.clear();
    if (Array.isArray(changes)) {
      for (const item of changes) {
        if (item && item.path && item.status) {
          changedFilesMap.set(norm(item.path), item.status);
        }
      }
    }
    // Re-render current tree
    if (folderCache.has(".")) {
      render();
    }
  }

  return {
    load,
    refresh: () => currentWorkspaceId && load(currentWorkspaceId),
    setChangedFiles,
  };
}
