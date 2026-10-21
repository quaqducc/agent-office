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
