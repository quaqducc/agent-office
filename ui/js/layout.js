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

export function getRoomBoxes(count) {
  const n = Math.min(6, Math.max(1, count));
  const topY = 48;
  const totalW = 1256;
  const totalH = 422;
  const wallGap = 10;

  if (n === 1) return [[12, topY, totalW, totalH]];
  if (n === 2) {
    const colW = Math.floor((totalW - wallGap) / 2);
    return [
      [12, topY, colW, totalH],
      [12 + colW + wallGap, topY, colW, totalH],
    ];
  }
  if (n === 3) {
    const colW = Math.floor((totalW - 2 * wallGap) / 3);
    return [
      [12, topY, colW, totalH],
      [12 + colW + wallGap, topY, colW, totalH],
      [12 + 2 * (colW + wallGap), topY, colW, totalH],
    ];
  }
  if (n === 4) {
    const colW = Math.floor((totalW - wallGap) / 2);
    const rowH = Math.floor((totalH - wallGap) / 2);
    return [
      [12, topY, colW, rowH],
      [12 + colW + wallGap, topY, colW, rowH],
      [12, topY + rowH + wallGap, colW, rowH],
      [12 + colW + wallGap, topY + rowH + wallGap, colW, rowH],
    ];
  }
  if (n === 5) {
    const colW3 = Math.floor((totalW - 2 * wallGap) / 3);
    const colW2 = Math.floor((totalW - wallGap) / 2);
    const rowH = Math.floor((totalH - wallGap) / 2);
    return [
      [12, topY, colW3, rowH],
      [12 + colW3 + wallGap, topY, colW3, rowH],
      [12 + 2 * (colW3 + wallGap), topY, colW3, rowH],
      [12, topY + rowH + wallGap, colW2, rowH],
      [12 + colW2 + wallGap, topY + rowH + wallGap, colW2, rowH],
    ];
  }
  const colW = Math.floor((totalW - 2 * wallGap) / 3);
  const rowH = Math.floor((totalH - wallGap) / 2);
  return [
    [12, topY, colW, rowH],
    [12 + colW + wallGap, topY, colW, rowH],
    [12 + 2 * (colW + wallGap), topY, colW, rowH],
    [12, topY + rowH + wallGap, colW, rowH],
    [12 + colW + wallGap, topY + rowH + wallGap, colW, rowH],
    [12 + 2 * (colW + wallGap), topY + rowH + wallGap, colW, rowH],
  ];
}

export function getRoomDeskSlots(box, count) {
  if (count <= 0) return [];
  const [rx, ry, rw, rh] = box;
  if (count === 1) return [[Math.round(rx + rw / 2), Math.round(ry + rh / 2)]];

  const minGap = 140;
  // If height >= 190 and count >= 3, use 2 rows to keep min-dist >= 140
  const maxRows = rh >= 190 && count >= 3 ? 2 : 1;

  if (maxRows === 1) {
    const slots = [];
    const py = Math.round(ry + rh / 2);
    const span = (count - 1) * Math.max(minGap, Math.min(220, (rw - 120) / (count - 1)));
    const startX = rx + rw / 2 - span / 2;
    const step = span / (count - 1);
    for (let i = 0; i < count; i++) {
      slots.push([Math.round(startX + i * step), py]);
    }
    return slots;
  }

  // 2 rows
  const countR1 = Math.ceil(count / 2);
  const countR2 = count - countR1;
  const y1 = rh >= 300 ? Math.round(ry + rh * 0.3) : Math.round(ry + 35);
  const y2 = rh >= 300 ? Math.round(ry + rh * 0.72) : Math.round(ry + rh - 31);
  const slots = [];

  // Row 1
  if (countR1 === 1) {
    slots.push([Math.round(rx + rw / 2), y1]);
  } else {
    const span1 = (countR1 - 1) * Math.max(minGap, Math.min(240, (rw - 120) / (countR1 - 1)));
    const startX1 = rx + rw / 2 - span1 / 2;
    const step1 = span1 / (countR1 - 1);
    for (let i = 0; i < countR1; i++) slots.push([Math.round(startX1 + i * step1), y1]);
  }

  // Row 2
  if (countR2 === 1) {
    slots.push([Math.round(rx + rw / 2), y2]);
  } else {
    const span2 = (countR2 - 1) * Math.max(minGap, Math.min(240, (rw - 120) / (countR2 - 1)));
    const startX2 = rx + rw / 2 - span2 / 2;
    const step2 = span2 / (countR2 - 1);
    for (let i = 0; i < countR2; i++) slots.push([Math.round(startX2 + i * step2), y2]);
  }

  return slots;
}

/** Place the given roles on desks; unknown roles go to the Specialists corner. x/y in percent, px/py in scene pixels. */
export function deskLayout(roles, rooms) {
  if (!rooms || !rooms.length) {
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

  const n = Math.min(6, Math.max(1, rooms.length));
  const activeRooms = rooms.slice(0, n);
  const boxes = getRoomBoxes(n);

  const roomRoles = activeRooms.map(rm => (rm.roles ? rm.roles.filter(r => roles.includes(r)) : []));
  const assigned = new Set(roomRoles.flatMap(list => list));
  for (const r of roles) {
    if (!assigned.has(r)) {
      roomRoles[0].push(r);
      assigned.add(r);
    }
  }

  const out = [];
  activeRooms.forEach((rm, idx) => {
    const box = boxes[idx];
    const rRoles = roomRoles[idx];
    const slots = getRoomDeskSlots(box, rRoles.length);
    rRoles.forEach((role, i) => {
      const [px, py] = slots[i];
      out.push({ role, dept: rm.name, zone: rm.id, px, py, ...pct(px, py) });
    });
  });

  return roles.map(r => out.find(d => d.role === r)).filter(Boolean);
}
