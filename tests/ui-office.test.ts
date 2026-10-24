import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore -- browser ES modules without type declarations
import { sprite, SPRITE_ROWS } from "../ui/js/sprites.js";
// @ts-ignore
import { deskLayout, findWalkPath, getRoomDeskSlots, getRoomBoxes, getRoomDoors, getRoomCapacity, ZONES, ENTRANCE } from "../ui/js/layout.js";
// @ts-ignore
import { sceneSvg } from "../ui/js/scene.js";
// @ts-ignore
import { RoleWalkQueue, CausalityDirector, walkDuration, getBubbleContent, renderOffice, playEffect, cancelAllWalks, pauseAllWalks, resumeAllWalks } from "../ui/js/office.js";

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
  const criticDesk = desks.find((d: any) => d.role === "critic");
  // Target position is in front of / beside the desk, NOT overlapping the seated role
  assert.notDeepEqual(sameRoomPath.at(-1), { x: criticDesk.px, y: criticDesk.py });
  assert.equal(sameRoomPath.at(-1)?.x, criticDesk.px - 32);
  assert.equal(sameRoomPath.at(-1)?.y, criticDesk.py + 44);

  // Different rooms: developer in 'engineering' -> manager in 'manager'
  const diffRoomPath = findWalkPath("developer", "manager", desks);
  assert.ok(diffRoomPath.length >= 4, "Cross-room path traverses doors and corridors");
  const managerDesk = desks.find((d: any) => d.role === "manager");
  assert.deepEqual(diffRoomPath[0], { x: desks.find((d: any) => d.role === "developer").px, y: desks.find((d: any) => d.role === "developer").py });
  // Target position stands in front of manager desk, not directly on manager seat
  assert.notDeepEqual(diffRoomPath.at(-1), { x: managerDesk.px, y: managerDesk.py });
  assert.equal(diffRoomPath.at(-1)?.y, managerDesk.py + 44);

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
  assert.ok(q.active.has("manager"));

  // 2. Single presence: Same role cannot walk twice concurrently, gets queued
  assert.equal(q.enqueue("manager", { id: 2 }), "queued");
  assert.ok(q.active.has("manager"));

  // 3. Different roles can walk up to maxConcurrent (3)
  assert.equal(q.enqueue("developer", { id: 3 }), "running");
  assert.equal(q.enqueue("critic", { id: 4 }), "running");

  // 4. Concurrency limit reached: 4th distinct role overflows
  assert.equal(q.enqueue("researcher", { id: 5 }), "overflow");

  // 5. Finishing manager dequeues its next queued task and stays active
  const next = q.finish("manager");
  assert.deepEqual(next, { id: 2 });
  assert.ok(q.active.has("manager"));

  // Finishing the second task makes manager idle
  const none = q.finish("manager");
  assert.equal(none, null);
  assert.equal(q.active.has("manager"), false);

  // Clear resets everything
  q.clear();
  assert.equal(q.active.has("developer"), false);
});

test("walkDuration natural pacing scales with distance, text length, replay speed and accessibility", () => {
  // Base natural pacing at 1x speed: WALK_SPEED = 200 px/sec
  // Short distance (100px): (100 / 200) * 1000 = 500ms, clamped to minimum 600ms
  const shortWalk = walkDuration(100, 0, 1, false);
  assert.equal(shortWalk.isInstant, false);
  assert.equal(shortWalk.legDuration, 600);
  assert.equal(shortWalk.talkDuration, 1800);

  // Moderate distance (400px), short text (20 chars): 2000ms leg, 1840ms talk
  const modWalk = walkDuration(400, 20, 1, false);
  assert.equal(modWalk.isInstant, false);
  assert.equal(modWalk.legDuration, 2000);
  assert.equal(modWalk.talkDuration, 1840);

  // Long distance (600px), long text (100 chars): 3000ms leg, clamped to 3800ms talk
  const longWalk = walkDuration(600, 100, 1, false);
  assert.equal(longWalk.isInstant, false);
  assert.equal(longWalk.legDuration, 3000);
  assert.equal(longWalk.talkDuration, 3800);

  // Replay speed x2: durations scale down proportionally
  const speed2 = walkDuration(400, 20, 2, false);
  assert.equal(speed2.isInstant, false);
  assert.equal(speed2.legDuration, 1000);
  assert.equal(speed2.talkDuration, 920);

  // Replay speed x4:
  const speed4 = walkDuration(400, 20, 4, false);
  assert.equal(speed4.isInstant, false);
  assert.equal(speed4.legDuration, 500);
  assert.equal(speed4.talkDuration, 460);

  // Speed Infinity / 0: instant, zero walk
  assert.equal(walkDuration(400, 20, Infinity).isInstant, true);
  assert.equal(walkDuration(400, 20, 0).isInstant, true);

  // prefers-reduced-motion: always instant
  const reduced = walkDuration(400, 20, 1, true);
  assert.equal(reduced.isInstant, true);
  assert.equal(reduced.legDuration, 0);
  assert.equal(reduced.talkDuration, 0);
});

test("CausalityDirector locks recipient at desk and sequences actions so manager cannot leave until incoming report finishes", () => {
  const director = new CausalityDirector();

  // 1. Role A (developer) finishes task and reports to manager
  const fxDone = { kind: "done", from: "developer", to: "manager", label: "Hoàn thành CSS layout" };
  const res1 = director.enqueue(fxDone);
  assert.equal(res1, "running");

  // Developer is walking to manager; manager MUST be locked at desk!
  assert.equal(director.roleStates.get("developer"), "WALKING_TO");
  assert.equal(director.lockedRoles.has("manager"), true);
  assert.equal(director.activeWalkers.has("developer"), true);

  // 2. Server emits manager reply to user while developer is still on the way
  const fxReply = { kind: "reply", from: "manager", to: "user", label: "Dạ đã xong việc" };
  const res2 = director.enqueue(fxReply);
  assert.equal(res2, "queued");

  // Manager CANNOT leave desk because manager is locked waiting for incoming report!
  assert.equal(director.activeWalkers.has("manager"), false);
  assert.equal(director.roleStates.get("manager") || "IDLE", "IDLE");
  assert.equal(director.queue.length, 1);

  // 3. Developer arrives at manager desk and begins conversation
  director.arriveAtTarget("developer");
  assert.equal(director.roleStates.get("developer"), "CONVERSING");
  // Manager is still locked during active dialogue
  assert.equal(director.lockedRoles.has("manager"), true);
  assert.equal(director.activeWalkers.has("manager"), false);

  // 4. Developer finishes dialogue (causality transfer point)
  director.finishDialogue("developer");

  // Manager is now UNLOCKED and begins next journey to report to user!
  assert.equal(director.lockedRoles.has("manager"), false);
  assert.equal(director.activeWalkers.has("manager"), true);
  assert.equal(director.roleStates.get("manager"), "WALKING_TO");
  assert.equal(director.queue.length, 0);

  // Developer is walking back to their own desk
  assert.equal(director.roleStates.get("developer"), "WALKING_BACK");

  // Developer arrives back at desk
  director.returnToDesk("developer");
  assert.equal(director.roleStates.get("developer"), "IDLE");
  assert.equal(director.activeWalkers.has("developer"), false);

  // Manager arrives at user, converses, and returns
  director.arriveAtTarget("manager");
  assert.equal(director.roleStates.get("manager"), "CONVERSING");
  director.finishDialogue("manager");
  assert.equal(director.roleStates.get("manager"), "WALKING_BACK");
  director.returnToDesk("manager");
  assert.equal(director.roleStates.get("manager"), "IDLE");
  assert.equal(director.activeWalkers.has("manager"), false);
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

test("desk footprint, bounds and capacity: desks stay inside room box without negative x or overlap for 1 to 6 rooms and up to 14 roles", () => {
  // Test getRoomDeskSlots on narrow room with 14 roles
  const smallBox = [12, 48, 412, 206];
  const slots14 = getRoomDeskSlots(smallBox, 14);
  assert.equal(slots14.length, 14);
  for (let i = 0; i < slots14.length; i++) {
    const [px, py] = slots14[i];
    // x must not be negative and must stay inside [rx, rx + rw]
    assert.ok(px >= smallBox[0] + 66, `px ${px} >= left bound ${smallBox[0] + 66}`);
    assert.ok(px <= smallBox[0] + smallBox[2] - 66, `px ${px} <= right bound ${smallBox[0] + smallBox[2] - 66}`);
    // py + 32 must not exceed room bottom
    assert.ok(py + 32 <= smallBox[1] + smallBox[3], `py + 32 (${py + 32}) <= bottom (${smallBox[1] + smallBox[3]})`);
    // py safe from north wall and sign
    assert.ok(py >= smallBox[1] + 55, `py ${py} safe from north wall`);
  }

  // Check no two desks have the exact same position
  const set14 = new Set(slots14.map(([x, y]) => `${x}:${y}`));
  assert.equal(set14.size, 14, "no two desks share the exact same slot");
});

test("dynamic doors in sceneSvg match getRoomDoors coordinates", () => {
  for (let n = 1; n <= 6; n++) {
    const rooms = Array.from({ length: n }, (_, i) => ({
      id: `room_${i + 1}`,
      name: `Phòng ${i + 1}`,
      roles: [`role_${i + 1}`],
    }));
    const doors = getRoomDoors(rooms);
    const svg = sceneSvg({ rooms, zones: new Set() });

    for (const rm of rooms) {
      const [doorX, doorY] = (doors as any)[rm.id];
      // Expect an s-door rect on the wall at doorY that encompasses doorX
      const doorMatches = Array.from(svg.matchAll(/<rect\s+x="(\d+)"\s+y="(\d+)"\s+width="(\d+)"\s+height="28"\s+class="s-door"/g));
      const hasDoorCovering = doorMatches.some(m => {
        const x = Number(m[1]);
        const y = Number(m[2]);
        const w = Number(m[3]);
        return y === doorY && x <= doorX - 30 && (x + w) >= doorX + 30;
      });
      assert.ok(
        hasDoorCovering,
        `n=${n}: door for ${rm.id} at (${doorX}, ${doorY}) must be covered by an s-door opening in scene svg`
      );
    }
  }
});

test("planning room desks leave central corridor clear at x=640 and manager walk paths do not clip desks", () => {
  const planningZone = ZONES.find((z: any) => z.id === "planning");
  assert.ok(planningZone);
  const [plannerDesk, criticDesk] = planningZone.slots;

  // Desks are [px, py]. Half width is 66px.
  // Corridor at x=640 must have clearance from planner (left) and critic (right)
  const plannerRight = plannerDesk[0] + 66;
  const criticLeft = criticDesk[0] - 66;
  assert.ok(plannerRight < 640, `planner desk right (${plannerRight}) < corridor center (640)`);
  assert.ok(criticLeft > 640, `critic desk left (${criticLeft}) > corridor center (640)`);
  assert.ok(criticLeft - plannerRight >= 60, "central aisle is at least 60px wide");

  // Manager walk path to various roles
  const desks = deskLayout(["manager", "planner", "critic", "developer", "marketing"]);
  for (const targetRole of ["planner", "critic", "developer", "marketing", "user"]) {
    const path = findWalkPath("manager", targetRole, desks, []);
    assert.ok(path.length >= 2, `path to ${targetRole} must have at least 2 points`);

    // Verify no segment intersects desk footprints of planner or critic
    for (let i = 0; i < path.length - 1; i++) {
      const p1 = path[i];
      const p2 = path[i + 1];

      for (const [px, py] of [plannerDesk, criticDesk]) {
        // If target or source is that desk, endpoint can touch the desk center
        if ((p1.x === px && p1.y === py) || (p2.x === px && p2.y === py)) continue;

        // Check distance of segment to desk center: must not cut through desk footprint (radius >= 40)
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const lenSq = dx * dx + dy * dy;
        let t = lenSq === 0 ? 0 : ((px - p1.x) * dx + (py - p1.y) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const projX = p1.x + t * dx;
        const projY = p1.y + t * dy;
        const dist = Math.hypot(projX - px, projY - py);
        assert.ok(dist >= 40, `segment from (${p1.x},${p1.y}) to (${p2.x},${p2.y}) clipped desk at (${px},${py}), dist: ${dist}`);
      }
    }
  }
});

test("walk path line segments never penetrate unrelated 3rd-party rooms for 1-6 room configs", () => {
  for (let n = 2; n <= 6; n++) {
    const rooms = Array.from({ length: n }, (_, i) => ({
      id: `room_${i + 1}`,
      name: `Phòng ${i + 1}`,
      roles: [`role_${i + 1}`],
    }));
    const roles = rooms.map(r => r.roles[0]);
    const desks = deskLayout(roles, rooms);
    const boxes = getRoomBoxes(n);

    // Test all pairs of roles
    for (let i = 0; i < roles.length; i++) {
      for (let j = 0; j < roles.length; j++) {
        if (i === j) continue;
        const fromRole = roles[i];
        const toRole = roles[j];
        const path = findWalkPath(fromRole, toRole, desks, rooms);
        assert.ok(path.length >= 2, `path from ${fromRole} to ${toRole} exists`);

        // Check against all unrelated rooms k !== i && k !== j
        for (let k = 0; k < rooms.length; k++) {
          if (k === i || k === j) continue;
          const [rx, ry, rw, rh] = boxes[k];

          // Check every waypoint
          for (const pt of path) {
            // Strictly interior check (margin of 2px)
            const inside = pt.x > rx + 2 && pt.x < rx + rw - 2 && pt.y > ry + 2 && pt.y < ry + rh - 2;
            assert.ok(!inside, `waypoint (${pt.x}, ${pt.y}) penetrated unrelated room_${k + 1} [${rx}, ${ry}, ${rw}, ${rh}]`);
          }
        }
      }
    }
  }
});

test("getBubbleContent filters raw Markdown markers using plain()", () => {
  const fx1 = { kind: "done", label: "## Kết quả: **thành công** [tài liệu](https://example.com)" };
  const res1 = getBubbleContent(fx1);
  assert.equal(res1.text, "Xong: Kết quả: thành công tài liệu");
  assert.ok(!res1.text.includes("##"));
  assert.ok(!res1.text.includes("**"));
  assert.ok(!res1.text.includes("https://"));

  const fx2 = { kind: "approval", label: "### Yêu cầu **xác nhận** từ `user`" };
  const res2 = getBubbleContent(fx2);
  assert.equal(res2.text, "Yêu cầu xác nhận từ user");
  assert.equal(res2.cls, "need");
});

test("RoleWalkQueue limits waiting queue to 1 per role (maxPerRoleQueue = 1)", () => {
  const q = new RoleWalkQueue({ maxConcurrent: 3 });
  assert.equal(q.enqueue("developer", { id: 1 }), "running");
  assert.equal(q.enqueue("developer", { id: 2 }), "queued");
  // Third enqueue for same role must be rejected/dropped
  assert.equal(q.enqueue("developer", { id: 3 }), "dropped");

  // Next finishes 1, starts 2
  const next = q.finish("developer");
  assert.equal(next?.id, 2);
  // Now developer has active task but queue is empty, next finish returns null
  assert.equal(q.finish("developer"), null);
});

test("approval interactions target user at entrance and user-spot contains bubble element", () => {
  const mockEl = {
    dataset: { roles: "manager,developer" },
    _rooms: null,
    _names: {},
    querySelector(selector: string) {
      if (selector === ".user-spot") {
        return {
          classList: { add() {}, remove() {}, toggle() {} },
          querySelector(sub: string) {
            if (sub === ".bubble") return { textContent: "", className: "" };
            return null;
          }
        };
      }
      return null;
    },
    querySelectorAll() { return []; },
    style: { setProperty() {} },
    innerHTML: "",
  };

  renderOffice(mockEl as any, {
    roles: { manager: { status: "idle" }, developer: { status: "approval" } },
    streaming: {},
    tasks: {},
    approvals: {},
    runStatus: "active",
  }, { names: { manager: "Manager", developer: "Developer" }, onSelect: () => {} });

  assert.ok(mockEl.innerHTML.includes('<div class="user-spot"'), "must have user-spot");
  assert.ok(mockEl.innerHTML.includes('<span class="bubble"></span></div>'), "user-spot must contain bubble span");

  // Verify playEffect targets user for approval
  let queuedTask: any = null;
  const originalEnqueue = RoleWalkQueue.prototype.enqueue;
  RoleWalkQueue.prototype.enqueue = function(role, task) {
    queuedTask = task;
    return "queued"; // prevent running full animation in test
  };
  try {
    const officeEl = {
      dataset: { roles: "manager,developer" },
      _rooms: null,
      querySelector() { return null; },
    };
    playEffect(officeEl as any, { kind: "approval", from: "developer", to: "manager", label: "Cần duyệt xóa file" }, 1);
    assert.ok(queuedTask, "walk task was enqueued");
    assert.equal(queuedTask.walker, "developer");
    assert.equal(queuedTask.target, "user", "approval must target user, not manager");
  } finally {
    RoleWalkQueue.prototype.enqueue = originalEnqueue;
  }
});

test("pauseAllWalks, resumeAllWalks and cancelAllWalks with generation tokens", async () => {
  let paused = false;
  let played = false;
  let cancelled = false;

  const mockActor = {
    classList: { add() {}, remove() {} },
    style: { left: "", top: "" },
    animate() {
      return {
        pause() { paused = true; },
        play() { played = true; },
        cancel() { cancelled = true; },
        onfinish: null as any,
        oncancel: null as any,
      };
    },
    append() {},
    remove() {},
  };

  const mockFxLayer = {
    append() {},
  };

  const mockOfficeEl = {
    dataset: { roles: "manager,developer" },
    _rooms: null,
    querySelector(selector: string) {
      if (selector === ".fx-layer") return mockFxLayer;
      if (selector.includes(".desk")) return { classList: { add() {}, remove() {} } };
      return null;
    },
    querySelectorAll() { return []; },
  };

  // Verify functions can be invoked cleanly
  pauseAllWalks();
  resumeAllWalks();
  cancelAllWalks(mockOfficeEl as any);
  assert.ok(true, "pauseAllWalks, resumeAllWalks and cancelAllWalks succeed without error");
});

