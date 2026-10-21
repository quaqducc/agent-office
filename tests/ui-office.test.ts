import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore -- browser ES modules without type declarations
import { sprite, SPRITE_ROWS } from "../ui/js/sprites.js";
// @ts-ignore
import { deskLayout } from "../ui/js/layout.js";

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
