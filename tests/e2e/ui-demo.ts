// Scripted demo server for UI checks (no model calls): node tests/e2e/ui-demo.ts → http://127.0.0.1:4318
// Manager → planner → (critic review) → developer, then the developer asks the user to approve a purchase.
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../../src/server.ts";
import { fakeFactory, sleep } from "../helpers/fake-runner.ts";

const ws = join(tmpdir(), "agent-office-demo-ws");
mkdirSync(ws, { recursive: true });
const h = (to: string, goal: string) => ({ to, goal, inputs: "-", expected_output: "-" });

const srv = await startServer({
  // stable data dir, like the real server: a restart marks unfinished runs "interrupted"
  port: 4318, dataDir: join(tmpdir(), "agent-office-demo-data"),
  createRunner: (_ws, router) => fakeFactory(async (role, text, hooks) => {
    const r = router();
    await sleep(1200);
    hooks.emit("usage", { tokens: 900 });
    if (role === "manager") {
      if (text.startsWith("User:")) { await r.handoff("manager", h("planner", "Lập kế hoạch khảo sát giá 3 bot Telegram")); return "Đã giao Planner lập kế hoạch."; }
      if (text.includes("from planner finished")) { await r.handoff("manager", h("developer", "Viết tool đọc bảng giá bot Telegram")); return "Kế hoạch ổn, chuyển Developer."; }
      return "Đã ghi nhận.";
    }
    if (role === "planner") {
      hooks.emit("message_delta", { delta: "Đang chia việc thành 3 bước: liệt kê bot, đọc giá, chuẩn hoá…" });
      await sleep(1500);
      const review = await r.handoff("planner", h("critic", "Phản biện kế hoạch khảo sát"));
      return `**Kế hoạch**\n1. Liệt kê bot\n2. Đọc giá\n3. Chuẩn hoá\n\n${review}`;
    }
    if (role === "critic") { await sleep(1500); return "APPROVE WITH CHANGES: thêm bước kiểm tra uy tín bot."; }
    if (role === "developer") {
      hooks.emit("tool_call", { tool: "write", args: { path: "tools/scan.py" } });
      await r.checkpoint("developer", { title: "Tool đã chạy thử", summary: "Đọc được giá 2/3 bot" });
      return r.checkpoint("developer", { title: "Mua thử 1 tài khoản", summary: "Cần mua thử để kiểm tra quy trình giao hàng", approval_required: true, action: "Thanh toán 25.000đ cho @shop_bot (ChatGPT Plus 1 tháng)" });
    }
    return "ok";
  }),
});
const res = await fetch(`${srv.url}/workspaces`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: ws, name: "UI demo" }) });
console.log(`UI demo on ${srv.url} — workspace`, (await res.json() as any).id);
