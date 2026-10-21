// Office floor plan in scene pixels (the scene is scaled to fit). Rooms (zones) with desk slots.

export const SCENE = { w: 1280, h: 720 };

/** box = [x, y, w, h] of the room floor; slots = desk anchors (centre of the desk top). */
export const ZONES = [
  { id: "manager", name: "Phòng Manager", box: [460, 48, 360, 202], roles: ["manager"], slots: [[640, 168]] },
  { id: "strategy", name: "Chiến lược & Sản phẩm", box: [12, 48, 438, 422], roles: ["brainstormer", "business-strategist", "product-manager", "marketing"],
    slots: [[130, 205], [330, 205], [130, 385], [330, 385]] },
  { id: "planning", name: "Kế hoạch & Phản biện", box: [460, 260, 360, 210], roles: ["planner", "critic"], slots: [[570, 400], [710, 400]] },
  { id: "engineering", name: "Kỹ thuật", box: [830, 48, 438, 422], roles: ["architect", "developer", "ai-engineer", "devops", "ui-ux", "reviewer"],
    slots: [[905, 205], [1049, 205], [1193, 205], [905, 385], [1049, 385], [1193, 385]] },
  { id: "specialists", name: "Chuyên gia", box: [12, 480, 438, 228], roles: [], slots: [[110, 615], [230, 615], [350, 615]] },
];

/** Where the user "stands": just inside the front door. */
export const ENTRANCE = { x: 640, y: 628 };

const pct = (x, y) => ({ x: (x / SCENE.w) * 100, y: (y / SCENE.h) * 100 });

/** Place the given roles on desks; unknown roles go to the Specialists corner. x/y in percent, px/py in scene pixels. */
export function deskLayout(roles) {
  const specialists = ZONES.at(-1);
  const out = [];
  for (const zone of ZONES.slice(0, -1)) {
    zone.roles.filter(r => roles.includes(r)).forEach((role, i) => {
      const [px, py] = zone.slots[zone.roles.indexOf(role)] ?? zone.slots[i];
      out.push({ role, dept: zone.name, zone: zone.id, px, py, ...pct(px, py) });
    });
  }
  const known = new Set(ZONES.flatMap(z => z.roles));
  roles.filter(r => !known.has(r)).forEach((role, i) => {
    // ponytail: 3 roomy slots, then a tighter grid; a very large custom team would need a bigger floor
    const [px, py] = specialists.slots[i] ?? [70 + ((i - 3) % 5) * 80, 560 + Math.floor((i - 3) / 5) * 70];
    out.push({ role, dept: specialists.name, zone: specialists.id, px, py, ...pct(px, py) });
  });
  // keep the input order of roles for stable rendering
  return roles.map(r => out.find(d => d.role === r)).filter(Boolean);
}
