// Read-only Code Viewer & Tab Manager
import { api } from "../api.js";
import Prism from "../../vendor/prism.js";

const EXT_LANG_MAP = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  json: "json",
  css: "css",
  html: "html",
  htm: "html",
  xml: "html",
  svg: "html",
  py: "python",
  sh: "bash",
  bash: "bash",
  md: "markdown",
  markdown: "markdown",
};

export function createEditorViewer({
  tabsContainer,
  officeViewEl,
  editorViewEl,
  onTabChange,
}) {
  let currentWorkspaceId = null;
  const openTabs = []; // { path, name, content, sha256, mtime, size, isBinary }
  let activeTab = "office"; // "office" or file path
  let lastActiveFileTab = null;

  function init(workspaceId) {
    currentWorkspaceId = workspaceId;
    openTabs.length = 0;
    activeTab = "office";
    lastActiveFileTab = null;
    renderTabs();
    showView("office");
  }

  function renderTabs() {
    tabsContainer.innerHTML = "";

    // Pinned Office Tab
    const officeTab = document.createElement("button");
    officeTab.type = "button";
    officeTab.className = `editor-tab pinned ${activeTab === "office" ? "active" : ""}`;
    officeTab.setAttribute("role", "tab");
    officeTab.setAttribute("aria-selected", String(activeTab === "office"));
    officeTab.innerHTML = `<span class="tab-icon">🏢</span><span class="tab-title">Văn phòng</span><span class="tab-pin" title="Cố định">📌</span>`;
    officeTab.addEventListener("click", () => selectTab("office"));
    tabsContainer.appendChild(officeTab);

    // File Tabs
    for (const tab of openTabs) {
      const tabEl = document.createElement("div");
      tabEl.className = `editor-tab ${activeTab === tab.path ? "active" : ""}`;
      tabEl.setAttribute("role", "tab");
      tabEl.setAttribute("aria-selected", String(activeTab === tab.path));
      tabEl.setAttribute("data-path", tab.path);

      const title = document.createElement("span");
      title.className = "tab-title";
      title.textContent = tab.name;
      title.title = tab.path;
      title.addEventListener("click", () => selectTab(tab.path));
      tabEl.appendChild(title);

      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "tab-close";
      closeBtn.setAttribute("aria-label", `Đóng ${tab.name}`);
      closeBtn.innerHTML = "×";
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        closeTab(tab.path);
      });
      tabEl.appendChild(closeBtn);

      tabsContainer.appendChild(tabEl);
    }
  }

  function showView(target) {
    if (target === "office") {
      officeViewEl.hidden = false;
      editorViewEl.hidden = true;
    } else {
      officeViewEl.hidden = true;
      editorViewEl.hidden = false;
    }
  }

  function selectTab(path) {
    if (path !== "office") {
      lastActiveFileTab = path;
    }
    activeTab = path;
    renderTabs();
    showView(path);

    if (path !== "office") {
      const tab = openTabs.find((t) => t.path === path);
      if (tab) renderFileContent(tab);
    }
    onTabChange?.(activeTab);
  }

  function closeTab(path) {
    const index = openTabs.findIndex((t) => t.path === path);
    if (index === -1) return;

    openTabs.splice(index, 1);
    if (activeTab === path) {
      if (openTabs.length > 0) {
        const nextIndex = Math.max(0, index - 1);
        selectTab(openTabs[nextIndex].path);
      } else {
        selectTab("office");
      }
    } else {
      renderTabs();
    }
  }

  function closeActiveTab() {
    if (activeTab !== "office") {
      closeTab(activeTab);
    }
  }

  function toggleOfficeFile() {
    if (activeTab === "office") {
      if (lastActiveFileTab && openTabs.some((t) => t.path === lastActiveFileTab)) {
        selectTab(lastActiveFileTab);
      } else if (openTabs.length > 0) {
        selectTab(openTabs[openTabs.length - 1].path);
      }
    } else {
      selectTab("office");
    }
  }

  async function openFile(filePath) {
    const existing = openTabs.find((t) => t.path === filePath);
    if (existing) {
      selectTab(filePath);
      return;
    }

    try {
      editorViewEl.innerHTML = `<div class="viewer-loading">Đang mở tệp ${escapeHtml(filePath)}…</div>`;
      showView(filePath);

      const fileData = await api.file(currentWorkspaceId, filePath);
      const name = filePath.split("/").pop() || filePath;
      const tab = {
        path: filePath,
        name,
        content: fileData.content,
        sha256: fileData.sha256,
        mtime: fileData.mtime,
        size: fileData.size,
        isBinary: fileData.isBinary,
      };

      openTabs.push(tab);
      selectTab(filePath);
    } catch (err) {
      editorViewEl.innerHTML = `
        <div class="viewer-error">
          <h3>Không thể mở file</h3>
          <p>${escapeHtml(err.message)}</p>
          <button class="btn small" type="button" id="viewer-back-btn">Quay lại Văn phòng</button>
        </div>
      `;
      editorViewEl.querySelector("#viewer-back-btn")?.addEventListener("click", () => selectTab("office"));
    }
  }

  function renderFileContent(tab) {
    editorViewEl.innerHTML = "";

    const header = document.createElement("div");
    header.className = "viewer-header";
    header.innerHTML = `
      <div class="viewer-filepath">📄 <b>${escapeHtml(tab.path)}</b></div>
      <div class="viewer-meta">${formatSize(tab.size)} · ${new Date(tab.mtime).toLocaleString("vi-VN")}</div>
    `;
    editorViewEl.appendChild(header);

    if (tab.isBinary) {
      const banner = document.createElement("div");
      banner.className = "viewer-banner warning";
      banner.textContent = "File nhị phân (.png, .zip, .exe...). Không hỗ trợ xem văn bản.";
      editorViewEl.appendChild(banner);
      return;
    }

    const lines = tab.content.split("\n");
    const isLarge = lines.length > 500 || tab.size > 200 * 1024;

    if (isLarge) {
      const banner = document.createElement("div");
      banner.className = "viewer-banner info";
      banner.textContent = "Đã tắt tô màu cú pháp (file lớn >500 dòng hoặc >200KB) để bảo đảm hiệu năng.";
      editorViewEl.appendChild(banner);
    }

    const container = document.createElement("div");
    container.className = "viewer-body";

    // Gutter for line numbers
    const gutter = document.createElement("div");
    gutter.className = "viewer-gutter";
    gutter.setAttribute("aria-hidden", "true");
    const numLines = lines.length;
    let gutterText = "";
    for (let i = 1; i <= numLines; i++) {
      gutterText += `${i}\n`;
    }
    gutter.textContent = gutterText;
    container.appendChild(gutter);

    // Code pre/code
    const pre = document.createElement("pre");
    pre.className = "viewer-pre";

    const code = document.createElement("code");
    const ext = tab.name.split(".").pop()?.toLowerCase() || "";
    const lang = EXT_LANG_MAP[ext] || "text";
    code.className = `language-${lang}`;
    code.textContent = tab.content;
    pre.appendChild(code);
    container.appendChild(pre);

    // Sync scroll between gutter and pre
    pre.addEventListener("scroll", () => {
      gutter.scrollTop = pre.scrollTop;
    });

    editorViewEl.appendChild(container);

    if (!isLarge && lang !== "text" && Prism.languages[lang]) {
      try {
        Prism.highlightElement(code);
      } catch (e) {
        console.warn("Prism highlight error:", e);
      }
    }
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  return {
    init,
    openFile,
    selectTab,
    closeActiveTab,
    toggleOfficeFile,
    getActiveTab: () => activeTab,
  };
}
