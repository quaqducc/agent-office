// Office floor plan in scene pixels (the scene is scaled to fit). Rooms (zones) with desk slots.

export const SCENE = { w: 1280, h: 720 };

/** box = [x, y, w, h] of the room floor; slots = desk anchors (centre of the desk top); door = entrance point. */
export const ZONES = [
  { id: "manager", name: "Phòng Manager", box: [460, 48, 360, 202], roles: ["manager"], slots: [[640, 168]], door: [640, 250] },
  { id: "strategy", name: "Chiến lược & Sản phẩm", box: [12, 48, 438, 422], roles: ["brainstormer", "business-strategist", "product-manager", "marketing"],
    slots: [[130, 205], [330, 205], [130, 385], [330, 385]], door: [230, 470] },
  { id: "planning", name: "Kế hoạch & Phản biện", box: [460, 260, 360, 210], roles: ["planner", "critic"], slots: [[535, 400], [745, 400]], door: [640, 470] },
  { id: "engineering", name: "Kỹ thuật", box: [830, 48, 438, 422], roles: ["architect", "developer", "ai-engineer", "devops", "ui-ux", "reviewer"],
    slots: [[905, 205], [1049, 205], [1193, 205], [905, 385], [1049, 385], [1193, 385]], door: [1049, 470] },
  { id: "specialists", name: "Chuyên gia", box: [12, 480, 438, 228], roles: [], slots: [[110, 615], [230, 615], [350, 615]], door: [230, 500] },
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

/** Maximum role capacity of a room based on its width and height. */
export function getRoomCapacity(box) {
  const [, , rw, rh] = box;
  if (rw >= 1000) return 14;
  if (rh >= 350) {
    if (rw >= 600) return 8;
    return 6;
  }
  // Short rooms (rh < 350)
  if (rw >= 600) return 5;
  if (rw >= 400) return 3;
  return 2;
}

export function getRoomDeskSlots(box, count) {
  if (count <= 0) return [];
  const [rx, ry, rw, rh] = box;
  const minY = Math.round(ry + (rh >= 300 ? 75 : 68));
  const maxY = Math.round(ry + rh - (rh >= 300 ? 55 : 38));
  const midX = rx + rw / 2;
  const maxSpan = Math.max(0, rw - 150);

  if (count === 1) {
    return [[Math.round(midX), Math.round((minY + maxY) / 2)]];
  }

  // Determine row count
  let numRows = 1;
  if (rh >= 350) {
    if (count >= 7 || (rw < 500 && count >= 5)) numRows = 3;
    else if (count >= 3 || (rw < 500 && count >= 2)) numRows = 2;
  } else {
    if (count >= 3 || (rw < 500 && count >= 2)) numRows = 2;
  }

  const rowYs = [];
  if (numRows === 1) {
    rowYs.push(Math.round((minY + maxY) / 2));
  } else if (numRows === 2) {
    rowYs.push(minY, maxY);
  } else {
    rowYs.push(minY, Math.round((minY + maxY) / 2), maxY);
  }

  const rowCounts = Array(numRows).fill(0);
  for (let i = 0; i < count; i++) {
    if (numRows === 2 && count === 3) {
      if (i === 0) rowCounts[0]++;
      else rowCounts[1]++;
    } else if (numRows === 3 && count === 5) {
      if (i < 2) rowCounts[0]++;
      else if (i === 2) rowCounts[1]++;
      else rowCounts[2]++;
    } else {
      rowCounts[i % numRows]++;
    }
  }

  const slots = [];
  for (let r = 0; r < numRows; r++) {
    const k = rowCounts[r];
    const py = rowYs[r];
    if (k === 1) {
      slots.push([Math.round(midX), py]);
    } else if (k > 1) {
      const maxStep = 240;
      const step = Math.min(maxStep, maxSpan / (k - 1));
      const span = (k - 1) * step;
      let startX = midX - span / 2;
      if (numRows === 2 && rowCounts[0] === 2 && rowCounts[1] === 2 && rw >= 550) {
        if (r === 0) startX = rx + 75 + (maxSpan - span) * 0.2;
        else startX = rx + 75 + (maxSpan - span) * 0.8;
      }
      for (let i = 0; i < k; i++) {
        slots.push([Math.round(startX + i * step), py]);
      }
    }
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

/** Get door coordinates for each room: [x, y] */
export function getRoomDoors(rooms) {
  if (!rooms || !rooms.length) {
    return Object.fromEntries(ZONES.map(z => [z.id, z.door]));
  }
  const n = Math.min(6, Math.max(1, rooms.length));
  const boxes = getRoomBoxes(n);
  const out = {};
  for (let i = 0; i < n; i++) {
    const [rx, ry, rw, rh] = boxes[i];
    out[rooms[i].id] = [Math.round(rx + rw / 2), ry + rh];
  }
  return out;
}

/**
 * Pure pathfinding function from fromRole to toRole.
 * If same room: direct line [start, end].
 * If different rooms: start -> own door -> corridor -> dest door -> end.
 * @returns {Array<{x: number, y: number}>}
 */
export function findWalkPath(fromRole, toRole, desks, rooms) {
  if (!fromRole || !toRole || fromRole === toRole) return [];
  const findDesk = role => {
    if (role === "user") return { role: "user", px: ENTRANCE.x, py: ENTRANCE.y, zone: "entrance" };
    return desks?.find(d => d.role === role);
  };
  const deskA = findDesk(fromRole);
  const deskB = findDesk(toRole);
  if (!deskA || !deskB) return [];

  const start = { x: deskA.px, y: deskA.py };
  const end = { x: deskB.px, y: deskB.py };

  if (deskA.zone && deskB.zone && deskA.zone === deskB.zone) {
    return [start, end];
  }

  // Special direct connection between manager and planning in default zones
  if (!rooms || !rooms.length) {
    if ((deskA.zone === "manager" && deskB.zone === "planning") || (deskA.zone === "planning" && deskB.zone === "manager")) {
      const isFromManager = deskA.zone === "manager";
      const planningDesk = isFromManager ? end : start;
      const raw = isFromManager
        ? [start, { x: 640, y: 168 }, { x: 640, y: 250 }, { x: 640, y: planningDesk.y }, end]
        : [start, { x: 640, y: planningDesk.y }, { x: 640, y: 250 }, { x: 640, y: 168 }, end];
      const points = [];
      for (const pt of raw) {
        const last = points.at(-1);
        if (!last || Math.hypot(pt.x - last.x, pt.y - last.y) > 2) {
          points.push({ x: Math.round(pt.x), y: Math.round(pt.y) });
        }
      }
      return points;
    }
  }

  const doors = getRoomDoors(rooms);
  const getDoor = zone => {
    if (zone === "entrance") return { x: ENTRANCE.x, y: 560 };
    const pt = doors[zone];
    return pt ? { x: pt[0], y: pt[1] } : { x: 640, y: 470 };
  };

  const doorA = getDoor(deskA.zone);
  const doorB = getDoor(deskB.zone);

  const raw = [start];

  // Route via aisle if originating from planning
  if ((!rooms || !rooms.length) && deskA.zone === "planning") {
    raw.push({ x: 640, y: start.y });
  }

  raw.push({ x: doorA.x, y: doorA.y });

  const corridorA = doorA.y <= 260 ? 254 : (doorA.y >= 540 ? 560 : 490);
  const corridorB = doorB.y <= 260 ? 254 : (doorB.y >= 540 ? 560 : 490);

  if (corridorA !== doorA.y) raw.push({ x: doorA.x, y: corridorA });

  if (corridorA === corridorB) {
    if (doorA.x !== doorB.x) raw.push({ x: doorB.x, y: corridorB });
  } else {
    raw.push({ x: 640, y: corridorA });
    raw.push({ x: 640, y: corridorB });
    if (doorB.x !== 640) raw.push({ x: doorB.x, y: corridorB });
  }

  if (corridorB !== doorB.y) raw.push({ x: doorB.x, y: doorB.y });

  // Route via aisle if destination is planning
  if ((!rooms || !rooms.length) && deskB.zone === "planning") {
    raw.push({ x: 640, y: end.y });
  }

  raw.push(end);

  const points = [];
  for (const pt of raw) {
    const last = points.at(-1);
    if (!last || Math.hypot(pt.x - last.x, pt.y - last.y) > 2) {
      points.push({ x: Math.round(pt.x), y: Math.round(pt.y) });
    }
  }
  return points;
}

