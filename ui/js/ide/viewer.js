// Embedded IDE Editor & Tab Manager (Phase 2: Two-layer Editor with IME support & Concurrency)
import { api } from "../api.js";
import Prism from "../../vendor/prism.js";
import { renderDiffView } from "./diff.js";

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
  toast,
  ask,
  onTabChange,
}) {
  let currentWorkspaceId = null;
  const openTabs = []; // { path, name, content, savedContent, sha256, mtime, size, isBinary, dirty, liveConflict, conflictDiskData }
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

    // File & Diff Tabs
    for (const tab of openTabs) {
      const tabId = tab.id || tab.path;
      const tabEl = document.createElement("div");
      tabEl.className = `editor-tab ${activeTab === tabId ? "active" : ""}`;
      tabEl.setAttribute("role", "tab");
      tabEl.setAttribute("aria-selected", String(activeTab === tabId));
      tabEl.setAttribute("data-path", tabId);

      const title = document.createElement("span");
      title.className = "tab-title";
      title.title = tab.path;

      if (tab.type === "diff") {
        const diffIco = document.createElement("span");
        diffIco.textContent = "🔀 ";
        title.appendChild(diffIco);
      }

      const titleText = document.createElement("span");
      titleText.textContent = tab.name;
      title.appendChild(titleText);

      if (tab.dirty) {
        const dot = document.createElement("span");
        dot.className = "dirty-dot";
        dot.title = "Chưa lưu";
        title.appendChild(dot);
      }

      title.addEventListener("click", () => selectTab(tabId));
      tabEl.appendChild(title);

      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "tab-close";
      closeBtn.setAttribute("aria-label", `Đóng ${tab.name}`);
      closeBtn.innerHTML = "×";
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        requestCloseTab(tabId);
      });
      tabEl.appendChild(closeBtn);

      tabsContainer.appendChild(tabEl);
    }
  }

  function updateTabUI(tab) {
    const tabEl = tabsContainer.querySelector(`[data-path="${CSS.escape(tab.path)}"]`);
    if (!tabEl) return;
    const title = tabEl.querySelector(".tab-title");
    if (!title) return;

    let dot = title.querySelector(".dirty-dot");
    if (tab.dirty) {
      if (!dot) {
        dot = document.createElement("span");
        dot.className = "dirty-dot";
        dot.title = "Chưa lưu";
        title.appendChild(dot);
      }
    } else {
      dot?.remove();
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
      const tab = openTabs.find((t) => (t.id || t.path) === path);
      if (tab) renderEditor(tab);
    }
    onTabChange?.(activeTab);
  }

  async function requestCloseTab(path) {
    const tab = openTabs.find((t) => (t.id || t.path) === path);
    if (!tab) return;

    if (tab.dirty && ask) {
      const confirmed = await ask({
        title: "Đóng tệp chưa lưu",
        text: `Tệp "${tab.name}" có thay đổi chưa lưu. Bạn có chắc muốn đóng và huỷ bỏ thay đổi?`,
        confirm: "Đóng và huỷ",
        danger: true,
      });
      if (!confirmed) return;
    }

    closeTab(path);
  }

  function closeTab(path) {
    const index = openTabs.findIndex((t) => (t.id || t.path) === path);
    if (index === -1) return;

    openTabs.splice(index, 1);
    if (activeTab === path) {
      if (openTabs.length > 0) {
        const nextIndex = Math.max(0, index - 1);
        selectTab(openTabs[nextIndex].id || openTabs[nextIndex].path);
      } else {
        selectTab("office");
      }
    } else {
      renderTabs();
    }
  }

  function closeActiveTab() {
    if (activeTab !== "office") {
      requestCloseTab(activeTab);
    }
  }

  function toggleOfficeFile() {
    if (activeTab === "office") {
      if (lastActiveFileTab && openTabs.some((t) => (t.id || t.path) === lastActiveFileTab)) {
        selectTab(lastActiveFileTab);
      } else if (openTabs.length > 0) {
        selectTab(openTabs[openTabs.length - 1].id || openTabs[openTabs.length - 1].path);
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
        type: "file",
        id: filePath,
        path: filePath,
        name,
        content: fileData.content,
        savedContent: fileData.content,
        sha256: fileData.sha256,
        mtime: fileData.mtime,
        size: fileData.size,
        isBinary: fileData.isBinary,
        dirty: false,
        liveConflict: false,
        conflictDiskData: null,
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

  async function openDiff(filePath, runId) {
    const tabId = `diff:${runId}:${filePath}`;
    const existing = openTabs.find((t) => t.id === tabId);
    if (existing) {
      selectTab(tabId);
      return;
    }

    try {
      editorViewEl.innerHTML = `<div class="viewer-loading">Đang tải diff ${escapeHtml(filePath)}…</div>`;
      showView(tabId);

      const diffData = await api.diff(currentWorkspaceId, filePath, runId);
      const name = `Diff: ${filePath.split("/").pop() || filePath}`;
      const tab = {
        type: "diff",
        id: tabId,
        path: filePath,
        runId,
        name,
        diffData,
        dirty: false,
      };

      openTabs.push(tab);
      selectTab(tabId);
    } catch (err) {
      editorViewEl.innerHTML = `
        <div class="viewer-error">
          <h3>Không thể tải diff</h3>
          <p>${escapeHtml(err.message)}</p>
          <button class="btn small" type="button" id="viewer-back-btn">Quay lại Văn phòng</button>
        </div>
      `;
      editorViewEl.querySelector("#viewer-back-btn")?.addEventListener("click", () => selectTab("office"));
    }
  }

  async function saveTab(tab, force = false) {
    if (!currentWorkspaceId || !tab || tab.isBinary) return;

    try {
      const res = await api.saveFile(currentWorkspaceId, tab.path, tab.content, tab.sha256, force);
      tab.savedContent = tab.content;
      tab.sha256 = res.sha256;
      tab.mtime = res.mtime;
      tab.size = res.size;
      tab.dirty = false;
      tab.liveConflict = false;
      tab.conflictDiskData = null;

      updateTabUI(tab);
      if (activeTab === tab.path) {
        renderEditor(tab);
      }
      toast?.("Đã lưu tệp", "ok");
    } catch (err) {
      if (err.status === 409) {
        showConflictModal(tab, err);
      } else {
        toast?.(err.message || "Lỗi lưu file", "bad");
      }
    }
  }

  function showConflictModal(tab, err) {
    const dialog = document.getElementById("conflict-dialog");
    if (!dialog) {
      alert(`⚠️ Xung đột tệp: ${err.message}`);
      return;
    }

    const diskContent = err.diskContent ?? tab.conflictDiskData?.content ?? "";
    const diskSha256 = err.diskSha256 ?? tab.conflictDiskData?.sha256 ?? "";
    const diskMtime = err.diskMtime ?? tab.conflictDiskData?.mtime ?? new Date().toISOString();

    dialog.innerHTML = `
      <form method="dialog" class="ask-form">
        <h2>⚠️ Xung đột tệp khi lưu</h2>
        <p class="ask-text">Tệp <b>${escapeHtml(tab.path)}</b> trên đĩa đã bị thay đổi bởi AI hoặc tiến trình khác kể từ lần nạp cuối.</p>
        
        <div class="diff-viewer" id="diff-box">
          <div class="diff-pane">
            <div class="diff-pane-header">Nội dung của bạn (chưa lưu)</div>
            <div class="diff-pane-content">${escapeHtml(tab.content)}</div>
          </div>
          <div class="diff-pane">
            <div class="diff-pane-header">Nội dung trên đĩa (mới nhất)</div>
            <div class="diff-pane-content">${escapeHtml(diskContent)}</div>
          </div>
        </div>

        <div class="ask-buttons" style="justify-content: space-between; margin-top: 14px;">
          <button type="button" class="btn" id="conflict-btn-cancel">Huỷ</button>
          <div style="display: flex; gap: 8px;">
            <button type="button" class="btn" id="conflict-btn-reload">Nạp lại từ đĩa</button>
            <button type="button" class="btn danger" id="conflict-btn-overwrite">Ghi đè bản này</button>
          </div>
        </div>
      </form>
    `;

    dialog.querySelector("#conflict-btn-cancel")?.addEventListener("click", () => dialog.close());

    dialog.querySelector("#conflict-btn-reload")?.addEventListener("click", () => {
      tab.content = diskContent;
      tab.savedContent = diskContent;
      tab.sha256 = diskSha256;
      tab.mtime = diskMtime;
      tab.dirty = false;
      tab.liveConflict = false;
      tab.conflictDiskData = null;
      dialog.close();
      updateTabUI(tab);
      if (activeTab === tab.path) renderEditor(tab);
      toast?.("Đã nạp lại tệp từ đĩa", "ok");
    });

    dialog.querySelector("#conflict-btn-overwrite")?.addEventListener("click", async () => {
      dialog.close();
      await saveTab(tab, true);
    });

    dialog.showModal();
  }

  function renderEditor(tab) {
    if (tab.type === "diff") {
      renderDiffView(editorViewEl, tab.diffData, (p) => openFile(p));
      return;
    }

    editorViewEl.innerHTML = "";

    // Header
    const header = document.createElement("div");
    header.className = "viewer-header";
    header.innerHTML = `
      <div class="viewer-filepath">
        <span>📄 <b>${escapeHtml(tab.path)}</b></span>
      </div>
      <div class="viewer-header-actions">
        ${tab.dirty ? `<button type="button" class="btn small primary viewer-header-btn" id="viewer-save-btn">Lưu (Ctrl+S)</button>` : ""}
        <span class="viewer-meta">${formatSize(tab.size)} · ${new Date(tab.mtime).toLocaleString("vi-VN")}</span>
      </div>
    `;
    header.querySelector("#viewer-save-btn")?.addEventListener("click", () => saveTab(tab));
    editorViewEl.appendChild(header);

    // Binary warning
    if (tab.isBinary) {
      const banner = document.createElement("div");
      banner.className = "viewer-banner warning";
      banner.textContent = "File nhị phân (.png, .zip, .exe...). Không hỗ trợ chỉnh sửa văn bản.";
      editorViewEl.appendChild(banner);
      return;
    }

    // Live conflict banner
    if (tab.liveConflict) {
      const banner = document.createElement("div");
      banner.className = "viewer-banner conflict";
      banner.innerHTML = `
        <span>⚠️ Đội AI vừa chỉnh sửa tệp này trên đĩa. Bạn đang có thay đổi chưa lưu!</span>
        <div class="viewer-banner-actions">
          <button type="button" class="btn small" id="banner-btn-diff">Xem khác biệt</button>
          <button type="button" class="btn small" id="banner-btn-reload">Nạp lại từ đĩa</button>
          <button type="button" class="btn small primary" id="banner-btn-dismiss">Giữ bản của tôi</button>
        </div>
      `;
      banner.querySelector("#banner-btn-diff")?.addEventListener("click", () => {
        showConflictModal(tab, {
          message: "Xung đột từ AI",
          diskContent: tab.conflictDiskData?.content ?? "",
          diskSha256: tab.conflictDiskData?.sha256 ?? "",
          diskMtime: tab.conflictDiskData?.mtime ?? tab.mtime,
        });
      });
      banner.querySelector("#banner-btn-reload")?.addEventListener("click", async () => {
        try {
          const fresh = await api.file(currentWorkspaceId, tab.path);
          tab.content = fresh.content;
          tab.savedContent = fresh.content;
          tab.sha256 = fresh.sha256;
          tab.mtime = fresh.mtime;
          tab.size = fresh.size;
          tab.dirty = false;
          tab.liveConflict = false;
          tab.conflictDiskData = null;
          updateTabUI(tab);
          renderEditor(tab);
          toast?.("Đã nạp lại tệp mới nhất", "ok");
        } catch (e) {
          toast?.(e.message, "bad");
        }
      });
      banner.querySelector("#banner-btn-dismiss")?.addEventListener("click", () => {
        tab.liveConflict = false;
        banner.remove();
      });
      editorViewEl.appendChild(banner);
    }

    const lines = tab.content.split("\n");
    const isLarge = lines.length > 500 || tab.size > 200 * 1024;

    if (isLarge) {
      const banner = document.createElement("div");
      banner.className = "viewer-banner info";
      banner.textContent = "Đã tắt tô màu cú pháp (file lớn >500 dòng hoặc >200KB) để bảo đảm hiệu năng soạn thảo 60fps.";
      editorViewEl.appendChild(banner);
    }

    // Body container: gutter + stage
    const bodyContainer = document.createElement("div");
    bodyContainer.className = "viewer-body";

    // Gutter for line numbers
    const gutter = document.createElement("div");
    gutter.className = "viewer-gutter";
    gutter.setAttribute("aria-hidden", "true");

    function updateGutterText(count) {
      let gutterText = "";
      for (let i = 1; i <= count; i++) {
        gutterText += `${i}\n`;
      }
      gutter.textContent = gutterText;
    }
    updateGutterText(lines.length);
    bodyContainer.appendChild(gutter);

    // Code container (holds pre and textarea)
    const codeContainer = document.createElement("div");
    codeContainer.className = `editor-code-container ${isLarge ? "large-file" : ""}`;

    const pre = document.createElement("pre");
    pre.className = "editor-pre";
    pre.setAttribute("aria-hidden", "true");

    const code = document.createElement("code");
    const ext = tab.name.split(".").pop()?.toLowerCase() || "";
    const lang = EXT_LANG_MAP[ext] || "text";
    code.className = `language-${lang}`;
    code.textContent = tab.content.endsWith("\n") ? tab.content + " " : tab.content;
    pre.appendChild(code);
    codeContainer.appendChild(pre);

    const textarea = document.createElement("textarea");
    textarea.className = "editor-textarea";
    textarea.spellcheck = false;
    textarea.autocomplete = "off";
    textarea.autocapitalize = "off";
    textarea.value = tab.content;
    textarea.setAttribute("aria-label", `Trình soạn thảo ${tab.name}`);
    codeContainer.appendChild(textarea);

    bodyContainer.appendChild(codeContainer);
    editorViewEl.appendChild(bodyContainer);

    // Highlight helper
    function highlightCode() {
      if (isLarge || lang === "text" || !Prism.languages[lang]) return;
      try {
        code.textContent = textarea.value.endsWith("\n") ? textarea.value + " " : textarea.value;
        Prism.highlightElement(code);
      } catch (e) {
        console.warn("Prism highlight error:", e);
      }
    }

    if (!isLarge) {
      highlightCode();
    }

    // Synchronize scrolling
    textarea.addEventListener("scroll", () => {
      pre.scrollTop = textarea.scrollTop;
      pre.scrollLeft = textarea.scrollLeft;
      gutter.scrollTop = textarea.scrollTop;
    });

    // Vietnamese IME Composition Guard
    let isComposing = false;
    textarea.addEventListener("compositionstart", () => {
      isComposing = true;
    });
    textarea.addEventListener("compositionend", () => {
      isComposing = false;
      highlightCode();
    });

    // Handle input & dirty detection
    function handleInput() {
      tab.content = textarea.value;
      const numLines = tab.content.split("\n").length;
      updateGutterText(numLines);

      const nowDirty = tab.content !== tab.savedContent;
      if (nowDirty !== tab.dirty) {
        tab.dirty = nowDirty;
        updateTabUI(tab);
        let saveBtn = header.querySelector("#viewer-save-btn");
        if (tab.dirty && !saveBtn) {
          saveBtn = document.createElement("button");
          saveBtn.type = "button";
          saveBtn.className = "btn small primary viewer-header-btn";
          saveBtn.id = "viewer-save-btn";
          saveBtn.textContent = "Lưu (Ctrl+S)";
          saveBtn.addEventListener("click", () => saveTab(tab));
          header.querySelector(".viewer-header-actions")?.prepend(saveBtn);
        } else if (!tab.dirty && saveBtn) {
          saveBtn.remove();
        }
      }

      if (!isLarge) {
        if (!isComposing) {
          highlightCode();
        } else {
          code.textContent = textarea.value.endsWith("\n") ? textarea.value + " " : textarea.value;
        }
      }
    }

    textarea.addEventListener("input", handleInput);

    // Handle keys: Tab (2 spaces), Ctrl+S (save)
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const val = textarea.value;
        textarea.value = val.substring(0, start) + "  " + val.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + 2;
        handleInput();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        saveTab(tab);
        return;
      }
    });
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  async function handleExternalFileChange(changedRelPath) {
    if (!changedRelPath || !currentWorkspaceId) return;
    const normChanged = changedRelPath.replace(/^\.\//, "").replace(/\\/g, "/");

    const tab = openTabs.find((t) => {
      const normTab = t.path.replace(/^\.\//, "").replace(/\\/g, "/");
      return normTab === normChanged || normTab.endsWith(normChanged) || normChanged.endsWith(normTab);
    });

    if (!tab) return;

    if (!tab.dirty) {
      try {
        const fresh = await api.file(currentWorkspaceId, tab.path);
        tab.content = fresh.content;
        tab.savedContent = fresh.content;
        tab.sha256 = fresh.sha256;
        tab.mtime = fresh.mtime;
        tab.size = fresh.size;
        tab.dirty = false;
        tab.liveConflict = false;
        tab.conflictDiskData = null;

        if (activeTab === tab.path) {
          renderEditor(tab);
          toast?.(`Tệp ${tab.name} đã được cập nhật từ đội AI`, "ok");
        }
      } catch (e) {
        console.warn("Lỗi tự động nạp lại file:", e);
      }
    } else {
      // Tab is dirty: live conflict!
      tab.liveConflict = true;
      try {
        const fresh = await api.file(currentWorkspaceId, tab.path);
        tab.conflictDiskData = fresh;
      } catch {}

      if (activeTab === tab.path) {
        renderEditor(tab);
      }
    }
  }

  return {
    init,
    openFile,
    openDiff,
    selectTab,
    closeActiveTab,
    toggleOfficeFile,
    saveCurrentTab: () => {
      const tab = openTabs.find((t) => (t.id || t.path) === activeTab && t.type !== "diff");
      if (tab) saveTab(tab);
    },
    hasDirtyTabs: () => openTabs.some((t) => t.dirty),
    getDirtyTabs: () => openTabs.filter((t) => t.dirty),
    handleExternalFileChange,
    getActiveTab: () => activeTab,
  };
}
