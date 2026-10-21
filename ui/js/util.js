// Small shared helpers for the UI (no DOM access, Node-safe).

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const time = ts => new Date(ts).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

const short = (v, n = 140) => { const s = typeof v === "string" ? v : JSON.stringify(v ?? ""); return s.length > n ? s.slice(0, n) + "…" : s; };

/** One-line human summary of a TeamEvent (Vietnamese). */
export function summarize(e, names = {}) {
  const d = e.data ?? {};
  const n = r => names[r] ?? r;
  switch (e.type) {
    case "run_started": return `Bắt đầu: ${short(d.firstMessage, 100)}`;
    case "run_finished": return `Kết thúc lần chạy (${d.status}) · ${d.usage?.tokens ?? 0} token`;
    case "user_message": return `Bạn: ${short(d.text)}`;
    case "manager_reply": return `Manager trả lời: ${short(d.text)}`;
    case "task_created": return `${n(d.from)} → ${n(d.to)}: ${short(d.goal, 110)}`;
    case "task_status": return `${{ queued: "Xếp hàng", running: "Bắt đầu làm", done: "Xong việc", failed: "Lỗi", cancelled: "Đã huỷ" }[d.status] ?? d.status} · task ${e.taskId}${d.reason ? ` — ${short(d.reason, 80)}` : ""}`;
    case "message": return short(d.text);
    case "tool_call": return `⚙ ${d.tool} ${short(d.args, 110)}`;
    case "tool_result": return `${d.ok ? "✓" : "✗"} ${d.tool}: ${short(d.preview, 110)}`;
    case "checkpoint": return `◆ ${d.automatic ? "(tự động) " : ""}${short(d.title, 80)} — ${short(d.summary, 80)}`;
    case "approval_request": return `‼ Cần duyệt: ${short(d.action, 120)}`;
    case "checkpoint_reply": return `◇ ${d.by === "user" ? "Bạn" : n(d.by)} trả lời ${d.checkpointId}: ${d.decision ?? ""} ${short(d.answer, 80)}`;
    case "usage": return `${d.tokens} token`;
    case "limit_hit": return `⚠ ${d.limit}: ${short(d.message)}`;
    case "error": return `✖ ${short(d.message)}`;
    default: return short(d);
  }
}

/** One-line plain-text preview of Markdown: drops emphasis, heading/list/quote markers and table pipes. */
export const plain = s => String(s ?? "")
  .replace(/\*\*|__|`+|~~/g, "")
  .replace(/(^|\n)\s*(#{1,6}|>|[-*+]|\d+\.)\s+/g, "$1")
  .replace(/\|/g, " ")
  .replace(/\s+/g, " ")
  .trim();
