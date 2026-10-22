// Diff Viewer for Run-based changes (Myers Diff visualizer)

export function renderDiffView(container, diffData, onOpenFile) {
  container.innerHTML = "";

  const header = document.createElement("div");
  header.className = "viewer-header diff-header";
  header.innerHTML = `
    <div class="viewer-filepath">
      <span>🔀 <b>${escapeHtml(diffData.path)}</b></span>
      <span class="diff-stats">
        <span class="diff-stat-add">+${diffData.additions}</span>
        <span class="diff-stat-del">-${diffData.deletions}</span>
      </span>
    </div>
    <div class="viewer-header-actions">
      <button type="button" class="btn small primary viewer-header-btn" id="diff-open-editor-btn">Mở file trong Editor</button>
    </div>
  `;
  header.querySelector("#diff-open-editor-btn")?.addEventListener("click", () => {
    onOpenFile?.(diffData.path);
  });
  container.appendChild(header);

  if (diffData.truncated) {
    const banner = document.createElement("div");
    banner.className = "viewer-banner warning";
    banner.textContent = "Tệp vượt quá 10.000 dòng. Diff chi tiết đã được giới hạn để bảo vệ trình duyệt.";
    container.appendChild(banner);
    return;
  }

  const body = document.createElement("div");
  body.className = "diff-body";

  const table = document.createElement("table");
  table.className = "diff-table";
  table.setAttribute("role", "presentation");

  const tbody = document.createElement("tbody");

  for (const line of diffData.lines) {
    const tr = document.createElement("tr");
    tr.className = `diff-row diff-${line.type}`;

    const tdOld = document.createElement("td");
    tdOld.className = "diff-num diff-num-old";
    tdOld.textContent = line.oldLineNo != null ? String(line.oldLineNo) : "";

    const tdNew = document.createElement("td");
    tdNew.className = "diff-num diff-num-new";
    tdNew.textContent = line.newLineNo != null ? String(line.newLineNo) : "";

    const tdSign = document.createElement("td");
    tdSign.className = "diff-sign";
    tdSign.textContent = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";

    const tdCode = document.createElement("td");
    tdCode.className = "diff-code";
    tdCode.textContent = line.text;

    tr.appendChild(tdOld);
    tr.appendChild(tdNew);
    tr.appendChild(tdSign);
    tr.appendChild(tdCode);
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  body.appendChild(table);
  container.appendChild(body);
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
