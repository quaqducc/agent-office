import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore -- browser ES modules without type declarations
import { sprite, SPRITE_ROWS } from "../ui/js/sprites.js";
// @ts-ignore
import { deskLayout, findWalkPath } from "../ui/js/layout.js";
// @ts-ignore
import { RoleWalkQueue, walkDuration, getBubbleContent, renderOffice } from "../ui/js/office.js";

test("sprite template is a 16x16 grid", () => {
  assert.equal(SPRITE_ROWS.length, 16);
  for (const r of SPRITE_ROWS) assert.equal(r.length, 16, r);
});

test("sprite is a deterministic svg with distinct palettes per role", () => {
  const a = sprite("critic");
  assert.equal(a, sprite("critic"));
  assert.match(a, /^<svg [^>]*viewBox="0 0 16 16"/);
  assert.match(a, /shape-rendering="crispEdges"/);
  assert.notEqual(sprite("critic"), sprite("developer"));
  assert.ok(sprite("some-new-role").startsWith("<svg"), "unknown roles still get a sprite");
});

test("deskLayout groups by department and only includes given roles", () => {
  const desks = deskLayout(["manager", "critic", "developer", "brand-new-role"]);
  assert.deepEqual(desks.map((d: any) => [d.role, d.dept]), [
    ["manager", "Phòng Manager"],
    ["critic", "Kế hoạch & Phản biện"],
    ["developer", "Kỹ thuật"],
    ["brand-new-role", "Chuyên gia"],
  ]);
  for (const d of desks) {
    assert.ok(d.x > 0 && d.x < 100 && d.y > 0 && d.y < 100, `${d.role} inside the floor`);
  }
  const twelve = deskLayout(["manager", "brainstormer", "business-strategist", "product-manager", "marketing", "planner", "critic", "architect", "developer", "ai-engineer", "devops", "ui-ux", "reviewer"]);
  const spots = new Set(twelve.map((d: any) => `${Math.round(d.x)}:${Math.round(d.y)}`));
  assert.equal(spots.size, 13, "no two desks overlap");
});

test("deskLayout dynamic rooms: 1 room, 3 rooms, 6 rooms and fallback", () => {
  // 1 room
  const r1 = [
    { id: "all-in-one", name: "Toàn Đội", roles: ["manager", "developer", "researcher"] },
  ];
  const d1 = deskLayout(["manager", "developer", "researcher"], r1);
  assert.equal(d1.length, 3);
  for (const d of d1) {
    assert.equal(d.dept, "Toàn Đội");
    assert.equal(d.zone, "all-in-one");
    assert.ok(d.px >= 12 && d.px <= 1268, `px ${d.px} inside scene width`);
    assert.ok(d.py >= 48 && d.py <= 470, `py ${d.py} inside room height`);
  }
  const s1 = new Set(d1.map((d: any) => `${d.px}:${d.py}`));
  assert.equal(s1.size, 3, "1 room: no two desks overlap");

  // 3 rooms
  const r3 = [
    { id: "exec", name: "Điều Hành", roles: ["manager"] },
    { id: "eng", name: "Kỹ Thuật", roles: ["developer", "reviewer"] },
    { id: "res", name: "Nghiên Cứu", roles: ["researcher", "critic"] },
  ];
  const d3 = deskLayout(["manager", "developer", "reviewer", "researcher", "critic"], r3);
  assert.equal(d3.length, 5);
  for (const d of d3) {
    assert.ok(d.px >= 12 && d.px <= 1268);
    assert.ok(d.py >= 48 && d.py <= 470);
  }
  const s3 = new Set(d3.map((d: any) => `${d.px}:${d.py}`));
  assert.equal(s3.size, 5, "3 rooms: no two desks overlap");

  // 6 rooms
  const r6 = [
    { id: "rm1", name: "Phòng 1", roles: ["manager"] },
    { id: "rm2", name: "Phòng 2", roles: ["architect"] },
    { id: "rm3", name: "Phòng 3", roles: ["developer"] },
    { id: "rm4", name: "Phòng 4", roles: ["reviewer"] },
    { id: "rm5", name: "Phòng 5", roles: ["devops"] },
    { id: "rm6", name: "Phòng 6", roles: ["researcher"] },
  ];
  const d6 = deskLayout(["manager", "architect", "developer", "reviewer", "devops", "researcher"], r6);
  assert.equal(d6.length, 6);
  for (const d of d6) {
    assert.ok(d.px >= 12 && d.px <= 1268);
    assert.ok(d.py >= 48 && d.py <= 470);
  }
  const s6 = new Set(d6.map((d: any) => `${d.px}:${d.py}`));
  assert.equal(s6.size, 6, "6 rooms: no two desks overlap");

  // Unassigned role moves to room 0
  const dUnassigned = deskLayout(["manager", "developer", "critic"], [
    { id: "exec", name: "Điều Hành", roles: ["manager"] },
    { id: "dev", name: "Lập Trình", roles: ["developer"] },
    // critic not assigned to any room
  ]);
  const criticDesk = dUnassigned.find((d: any) => d.role === "critic");
  assert.ok(criticDesk);
  assert.equal(criticDesk.zone, "exec", "unassigned role placed into first room");
});

test("findWalkPath returns direct line for same room and door-corridor-door path across rooms", () => {
  const roles = ["manager", "planner", "critic", "developer", "product-manager"];
  const desks = deskLayout(roles);

  // Same room: planner & critic are both in 'planning'
  const sameRoomPath = findWalkPath("planner", "critic", desks);
  assert.equal(sameRoomPath.length, 2, "Same room path has exactly 2 points: [start, end]");
  assert.equal(sameRoomPath[0].x, desks.find((d: any) => d.role === "planner").px);
  assert.equal(sameRoomPath[1].x, desks.find((d: any) => d.role === "critic").px);

  // Different rooms: developer in 'engineering' -> manager in 'manager'
  const diffRoomPath = findWalkPath("developer", "manager", desks);
  assert.ok(diffRoomPath.length >= 4, "Cross-room path traverses doors and corridors");
  assert.deepEqual(diffRoomPath[0], { x: desks.find((d: any) => d.role === "developer").px, y: desks.find((d: any) => d.role === "developer").py });
  assert.deepEqual(diffRoomPath.at(-1), { x: desks.find((d: any) => d.role === "manager").px, y: desks.find((d: any) => d.role === "manager").py });

  // Manager to user at ENTRANCE
  const toUserPath = findWalkPath("manager", "user", desks);
  assert.ok(toUserPath.length >= 3);
  assert.deepEqual(toUserPath.at(-1), { x: 640, y: 628 });

  // Edge cases: unknown role or same role
  assert.deepEqual(findWalkPath("manager", "manager", desks), []);
  assert.deepEqual(findWalkPath("manager", "non-existent", desks), []);
});

test("deskLayout ensures minimum center-to-center distance (>= 140px) between desks in the same room", () => {
  // Test case like "Product" and "Researcher" sharing room 2 in a 3-room layout
  const rooms = [
    { id: "exec", name: "Ban Giám Đốc", roles: ["manager"] },
    { id: "product", name: "Sản Phẩm & Nghiên Cứu", roles: ["product-manager", "researcher"] },
    { id: "eng", name: "Kỹ Thuật", roles: ["developer", "critic"] },
  ];
  const desks = deskLayout(["manager", "product-manager", "researcher", "developer", "critic"], rooms);

  const byRoom: Record<string, any[]> = {};
  for (const d of desks) {
    byRoom[d.zone] = byRoom[d.zone] || [];
    byRoom[d.zone].push(d);
  }

  for (const [zone, rDesks] of Object.entries(byRoom)) {
    for (let i = 0; i < rDesks.length; i++) {
      for (let j = i + 1; j < rDesks.length; j++) {
        const dist = Math.hypot(rDesks[i].px - rDesks[j].px, rDesks[i].py - rDesks[j].py);
        assert.ok(
          dist >= 139.9,
          `Room ${zone}: distance between ${rDesks[i].role} and ${rDesks[j].role} is ${dist.toFixed(1)}px, must be >= 140px`
        );
      }
    }
  }
});

test("RoleWalkQueue ensures single presence per role and enforces concurrency limit", () => {
  const q = new RoleWalkQueue({ maxConcurrent: 3 });

  // 1. Initial walk allowed
  assert.equal(q.enqueue("manager", { id: 1 }), "running");
  assert.ok(q.isRoleBusy("manager"));

  // 2. Single presence: Same role cannot walk twice concurrently, gets queued
  assert.equal(q.enqueue("manager", { id: 2 }), "queued");
  assert.ok(q.isRoleBusy("manager"));

  // 3. Different roles can walk up to maxConcurrent (3)
  assert.equal(q.enqueue("developer", { id: 3 }), "running");
  assert.equal(q.enqueue("critic", { id: 4 }), "running");

  // 4. Concurrency limit reached: 4th distinct role overflows
  assert.equal(q.enqueue("researcher", { id: 5 }), "overflow");

  // 5. Finishing manager dequeues its next queued task and stays active
  const next = q.finish("manager");
  assert.deepEqual(next, { id: 2 });
  assert.ok(q.isRoleBusy("manager"));

  // Finishing the second task makes manager idle
  const none = q.finish("manager");
  assert.equal(none, null);
  assert.equal(q.isRoleBusy("manager"), false);

  // Clear resets everything
  q.clear();
  assert.equal(q.isRoleBusy("developer"), false);
});

test("walkDuration scales accurately with replay speed and respects accessibility", () => {
  // Speed x1: 1.2s leg, 1.0s talk
  const x1 = walkDuration(1, false);
  assert.equal(x1.isInstant, false);
  assert.equal(x1.legDuration, 1200);
  assert.equal(x1.talkDuration, 1000);

  // Speed x4: 300ms leg, 250ms talk
  const x4 = walkDuration(4, false);
  assert.equal(x4.isInstant, false);
  assert.equal(x4.legDuration, 300);
  assert.equal(x4.talkDuration, 250);

  // Speed x16: 75ms leg, ~63ms talk
  const x16 = walkDuration(16, false);
  assert.equal(x16.isInstant, false);
  assert.equal(x16.legDuration, 75);
  assert.equal(x16.talkDuration, 63);

  // Speed Infinity / 0: instant, zero walk
  assert.equal(walkDuration(Infinity).isInstant, true);
  assert.equal(walkDuration(0).isInstant, true);

  // prefers-reduced-motion: always instant
  const reduced = walkDuration(1, true);
  assert.equal(reduced.isInstant, true);
  assert.equal(reduced.legDuration, 0);
  assert.equal(reduced.talkDuration, 0);
});

test("getBubbleContent formats text <= 60 chars and assigns warning/wait classes", () => {
  const approval = getBubbleContent({ kind: "approval", label: "Cần duyệt hành động chi tiêu 1000 USD cho server" });
  assert.equal(approval.cls, "need");
  assert.ok(approval.text.length <= 60);

  const checkpoint = getBubbleContent({ kind: "checkpoint", label: "Tiến độ vòng lặp số 1 hoàn tất báo cáo kỹ thuật" });
  assert.equal(checkpoint.cls, "wait");
  assert.ok(checkpoint.text.length <= 60);

  const done = getBubbleContent({ kind: "done", label: "Đã tạo xong trang đăng nhập và kiểm thử giao diện" });
  assert.match(done.text, /^Xong:/);
  assert.ok(done.text.length <= 60);

  const failed = getBubbleContent({ kind: "failed", label: "Không tìm thấy file cấu hình trong thư mục gốc" });
  assert.equal(failed.cls, "need");
  assert.match(failed.text, /^Lỗi:/);
  assert.ok(failed.text.length <= 60);

  const longText = getBubbleContent({
    kind: "handoff",
    label: "A very long task goal that goes on and on and exceeds sixty characters by quite a wide margin",
  });
  assert.ok(longText.text.length <= 60);
  assert.ok(longText.text.endsWith("…"));
});

test("office DOM render does not contain link lines or link-end circles", () => {
  const mockEl: any = {
    dataset: {},
    innerHTML: "",
    style: { setProperty() {}, width: "", height: "" },
    parentElement: { clientWidth: 1280, clientHeight: 720 },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    setAttribute() {},
    classList: { toggle() {}, add() {}, remove() {} },
  };

  const state = {
    roles: { manager: { status: "working" }, developer: { status: "working" } },
    streaming: {},
    tasks: { t1: { id: "t1", from: "manager", to: "developer", status: "running" } },
    approvals: {},
    runStatus: "active",
  };

  renderOffice(mockEl, state, { names: { manager: "Manager", developer: "Developer" }, onSelect: () => {} });

  // Verify that SVG link elements (.link, .link-end, .links) are not present in rendered DOM
  assert.ok(!mockEl.innerHTML.includes('class="link '));
  assert.ok(!mockEl.innerHTML.includes('class="link-end'));
  assert.ok(!mockEl.innerHTML.includes('<svg class="links"'));
  assert.ok(!mockEl.innerHTML.includes('<circle class="link-end'));
});
