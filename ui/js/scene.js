// Static office backdrop as one SVG in scene pixels: floors, walls, windows, signs and furniture.
// Colours come from CSS classes (styles.css → .scene-*), so light/dark themes restyle it.
import { getRoomBoxes, SCENE, ZONES } from "./layout.js";
import { esc } from "./util.js";

const r = (x, y, w, h, cls, extra = "") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="${cls}"${extra}/>`;

const PATTERNS = `<defs>
  <pattern id="p-wood" width="96" height="32" patternUnits="userSpaceOnUse">
    ${r(0, 0, 96, 16, "s-wood-a")}${r(0, 16, 96, 16, "s-wood-b")}
    ${r(0, 15, 96, 2, "s-wood-line")}${r(0, 31, 96, 1, "s-wood-line")}${r(60, 0, 2, 16, "s-wood-line")}${r(12, 16, 2, 16, "s-wood-line")}
    ${r(24, 6, 18, 2, "s-wood-grain")}${r(70, 22, 14, 2, "s-wood-grain")}
  </pattern>
  <pattern id="p-carpet-g" width="16" height="16" patternUnits="userSpaceOnUse">${r(0, 0, 16, 16, "s-cg-a")}${r(6, 6, 3, 3, "s-cg-b")}</pattern>
  <pattern id="p-carpet-b" width="16" height="16" patternUnits="userSpaceOnUse">${r(0, 0, 16, 16, "s-cb-a")}${r(6, 6, 3, 3, "s-cb-b")}</pattern>
  <pattern id="p-tile" width="40" height="40" patternUnits="userSpaceOnUse">
    ${r(0, 0, 40, 40, "s-tile-a")}${r(0, 0, 20, 20, "s-tile-b")}${r(20, 20, 20, 20, "s-tile-b")}${r(0, 0, 40, 1, "s-tile-line")}${r(0, 0, 1, 40, "s-tile-line")}
  </pattern>
</defs>`;

/** Horizontal wall with optional door gap: cap on top, visible face below (3/4 view). */
function hWall(x1, x2, y, gap) {
  const parts = gap ? [[x1, gap[0]], [gap[1], x2]] : [[x1, x2]];
  return parts.map(([a, b]) => r(a, y, b - a, 10, "s-cap") + r(a, y + 10, b - a, 18, "s-face") + r(a, y + 26, b - a, 2, "s-base")).join("") +
    (gap ? r(gap[0], y, gap[1] - gap[0], 28, "s-door") : "");
}

function windowAt(x, w) {
  const panes = Math.max(2, Math.round(w / 44));
  const pw = (w - 8) / panes;
  let s = r(x, 14, w, 28, "s-win-frame");
  for (let i = 0; i < panes; i++) s += r(x + 4 + i * pw + 2, 18, pw - 4, 20, "s-win-glass") + r(x + 4 + i * pw + 6, 21, 6, 3, "s-win-shine");
  return s + r(x - 2, 40, w + 4, 4, "s-win-sill");
}

function plant(x, y, big = false) {
  const k = big ? 1.3 : 1;
  const w = 26 * k;
  return `<g class="prop">${r(x - 9 * k, y - 6 * k, 18 * k, 4 * k, "s-shadow")}
    ${r(x - 13 * k, y - 34 * k, w, 14 * k, "s-leaf")}${r(x - 9 * k, y - 44 * k, 18 * k, 12 * k, "s-leaf")}${r(x - 4 * k, y - 50 * k, 8 * k, 8 * k, "s-leaf-2")}
    ${r(x - 11 * k, y - 28 * k, 8 * k, 6 * k, "s-leaf-2")}${r(x + 4 * k, y - 40 * k, 6 * k, 6 * k, "s-leaf-2")}
    ${r(x - 9 * k, y - 22 * k, 18 * k, 16 * k, "s-pot")}${r(x - 10 * k, y - 22 * k, 20 * k, 4 * k, "s-pot-rim")}</g>`;
}

function shelf(x, y, w) {
  let s = r(x, y, w, 34, "s-shelf") + r(x, y + 16, w, 3, "s-shelf-dark");
  const colors = ["s-book-1", "s-book-2", "s-book-3", "s-book-4"];
  for (let i = 0, bx = x + 4; bx < x + w - 8; i++, bx += 7 + (i % 3)) s += r(bx, y + 3 + (i % 2), 5 + (i % 3), 12 - (i % 2), colors[i % 4]);
  for (let i = 0, bx = x + 6; bx < x + w - 10; i++, bx += 9) s += r(bx, y + 21, 6, 11, colors[(i + 2) % 4]);
  return `<g class="prop">${s}</g>`;
}

function sofa(x, y, w) {
  return `<g class="prop">${r(x, y + 34, w, 6, "s-shadow")}${r(x, y, w, 16, "s-sofa-dark")}${r(x, y + 14, w, 20, "s-sofa")}
    ${r(x - 6, y + 6, 10, 30, "s-sofa-dark")}${r(x + w - 4, y + 6, 10, 30, "s-sofa-dark")}${r(x + w / 2 - 1, y + 16, 2, 16, "s-sofa-dark")}</g>`;
}

function table(x, y, w, h) {
  return `<g class="prop">${r(x + 4, y + h, w - 8, 6, "s-shadow")}${r(x, y, w, h, "s-table")}${r(x, y + h - 5, w, 5, "s-table-dark")}</g>`;
}

function sign(x, y, text) {
  const w = Math.round(text.length * 9.2 + 24);
  return `<g class="sign">${r(x, y, w, 24, "s-sign", ' rx="3"')}<text x="${x + w / 2}" y="${y + 18}" class="s-sign-text" text-anchor="middle">${esc(text)}</text></g>`;
}

/** @param {{zones: Set<string>, rooms?: {id:string, name:string, roles:string[]}[]}} opts */
export function sceneSvg({ zones, rooms }) {
  const { w: W, h: H } = SCENE;
  if (rooms && rooms.length > 0) {
    const n = Math.min(6, Math.max(1, rooms.length));
    const activeRooms = rooms.slice(0, n);
    const boxes = getRoomBoxes(n);
    const patterns = ["p-carpet-g", "p-carpet-b", "p-tile", "p-carpet-g", "p-carpet-b", "p-tile"];
    let s = `<svg class="scene-bg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" shape-rendering="crispEdges" aria-hidden="true">${PATTERNS}`;
    // floors
    s += `<rect width="${W}" height="${H}" fill="url(#p-wood)"/>`;
    activeRooms.forEach((rm, i) => {
      const [x, y, w, h] = boxes[i];
      s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${patterns[i % patterns.length]})"/>`;
      const hasManager = rm.roles && rm.roles.includes("manager");
      if (hasManager) {
        const rugW = Math.max(60, w - 60);
        const rugH = Math.max(60, h - 70);
        const rugX = x + Math.round((w - rugW) / 2);
        const rugY = y + Math.round((h - rugH) / 2);
        s += r(rugX, rugY, rugW, rugH, "s-rug", ' rx="6"');
        s += r(rugX + 6, rugY + 6, rugW - 12, rugH - 12, "s-rug-in", ' rx="4"');
      }
    });
    s += r(600, 672, 80, 30, "s-mat", ' rx="4"') + r(606, 678, 68, 18, "s-mat-in", ' rx="2"');
    // outer north wall with windows
    s += r(0, 0, W, 10, "s-cap") + r(0, 10, W, 38, "s-face") + r(0, 46, W, 2, "s-base");
    // Place windows in north-row rooms without overlapping the room signs
    activeRooms.forEach((rm, i) => {
      const [x, y, w] = boxes[i];
      if (y <= 50) {
        const signW = Math.round(rm.name.length * 9.2 + 24);
        const winLeft = x + 20 + signW + 20;
        const winW = Math.min(120, x + w - 20 - winLeft);
        if (winW >= 70) s += windowAt(winLeft, winW);
      }
    });
    // bottom wall separating rooms from lobby
    s += hWall(12, W - 12, 470, [600, 680]);
    if (n >= 4) {
      s += hWall(12, W - 12, 254, [600, 680]);
    }
    if (n === 2 || n === 4) {
      s += r(635, 48, 10, 422, "s-cap");
    } else if (n === 3 || n === 6) {
      s += r(424, 48, 10, 422, "s-cap") + r(846, 48, 10, 422, "s-cap");
    } else if (n === 5) {
      s += r(424, 48, 10, 206, "s-cap") + r(846, 48, 10, 206, "s-cap");
      s += r(635, 264, 10, 206, "s-cap");
    }
    // outer walls
    s += r(0, 0, 12, H, "s-cap") + r(W - 12, 0, 12, H, "s-cap") + r(0, H - 12, 600, 12, "s-cap") + r(680, H - 12, W - 680, 12, "s-cap");
    s += r(600, H - 12, 80, 12, "s-door");
    // signs on wall faces
    activeRooms.forEach((rm, i) => {
      const [x, y] = boxes[i];
      s += sign(x + 16, y > 100 ? y + 6 : 17, rm.name);
    });
    // lobby & furniture
    s += plant(570, 700, true) + plant(710, 700, true);
    s += `<g class="prop">${r(1100, 500, 156, 34, "s-counter")}${r(1100, 530, 156, 6, "s-counter-dark")}${r(1116, 488, 22, 26, "s-machine")}${r(1120, 494, 14, 6, "s-machine-light")}${r(1150, 496, 10, 10, "s-mug")}${r(1168, 498, 10, 8, "s-mug-2")}</g>`;
    s += `<g class="prop">${r(1052, 494, 24, 14, "s-water")}${r(1050, 508, 28, 34, "s-cooler")}</g>`;
    s += table(990, 600, 110, 50) + sofa(980, 670, 130) + plant(1246, 700) + plant(860, 700);
    s += shelf(30, 486, 150) + sofa(80, 610, 170) + table(110, 570, 110, 28) + plant(420, 700) + plant(36, 700);
    return s + "</svg>";
  }

  const z = id => ZONES.find(q => q.id === id);
  const floor = (id, fill) => { const [x, y, w, h] = z(id).box; return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${fill})"/>`; };
  const specialists = zones.has("specialists");
  let s = `<svg class="scene-bg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" shape-rendering="crispEdges" aria-hidden="true">${PATTERNS}`;
  // floors
  s += `<rect width="${W}" height="${H}" fill="url(#p-wood)"/>`;
  s += floor("strategy", "p-carpet-g") + floor("engineering", "p-carpet-b") + floor("planning", "p-tile");
  s += r(500, 80, 280, 150, "s-rug", ' rx="6"') + r(510, 90, 260, 130, "s-rug-in", ' rx="4"');
  s += r(600, 672, 80, 30, "s-mat", ' rx="4"') + r(606, 678, 68, 18, "s-mat-in", ' rx="2"');
  // outer north wall with windows
  s += r(0, 0, W, 10, "s-cap") + r(0, 10, W, 38, "s-face") + r(0, 46, W, 2, "s-base");
  s += windowAt(258, 84) + windowAt(352, 84) + windowAt(640, 160) + windowAt(960, 120) + windowAt(1110, 120);
  // inner walls
  s += r(450, 48, 10, 432, "s-cap") + r(820, 48, 10, 432, "s-cap");
  s += hWall(460, 820, 250, [604, 676]);
  s += hWall(12, 450, 470, [196, 268]) + hWall(460, 820, 470, [600, 680]) + hWall(830, 1268, 470, [1012, 1084]);
  // outer walls
  s += r(0, 0, 12, H, "s-cap") + r(W - 12, 0, 12, H, "s-cap") + r(0, H - 12, 600, 12, "s-cap") + r(680, H - 12, W - 680, 12, "s-cap");
  s += r(600, H - 12, 80, 12, "s-door");
  // signs on wall faces
  s += sign(24, 17, "Chiến lược & Sản phẩm") + sign(842, 17, "Kỹ thuật") + sign(472, 17, "Phòng Manager") + sign(470, 476, "Kế hoạch & Phản biện");
  if (specialists) s += sign(24, 483, "Chuyên gia");
  // planning: whiteboard and notes
  s += `<g class="prop">${r(480, 262, 108, 22, "s-board")}${r(492, 267, 30, 3, "s-ink-1")}${r(492, 273, 46, 3, "s-ink-2")}${r(544, 266, 12, 12, "s-note-1")}${r(560, 266, 12, 12, "s-note-2")}</g>`;
  // furniture
  s += plant(36, 462) + plant(428, 140) + plant(484, 240) + plant(796, 240, true) + plant(852, 462) + plant(1246, 140) + plant(1246, 462);
  s += shelf(476, 54, 64) + shelf(740, 54, 64);
  s += `<g class="prop">${r(1218, 300, 36, 70, "s-rack")}${r(1222, 306, 28, 8, "s-rack-slot")}${r(1222, 320, 28, 8, "s-rack-slot")}${r(1222, 334, 28, 8, "s-rack-slot")}
    <rect x="1244" y="308" width="3" height="3" class="s-led"/><rect x="1244" y="322" width="3" height="3" class="s-led s-led-2"/><rect x="1244" y="336" width="3" height="3" class="s-led"/></g>`;
  // lobby: plants by the door, kitchen corner on the right
  s += plant(570, 700, true) + plant(710, 700, true);
  s += `<g class="prop">${r(1100, 500, 156, 34, "s-counter")}${r(1100, 530, 156, 6, "s-counter-dark")}${r(1116, 488, 22, 26, "s-machine")}${r(1120, 494, 14, 6, "s-machine-light")}
    ${r(1150, 496, 10, 10, "s-mug")}${r(1168, 498, 10, 8, "s-mug-2")}</g>`;
  s += `<g class="prop">${r(1052, 494, 24, 14, "s-water")}${r(1050, 508, 28, 34, "s-cooler")}</g>`;
  s += table(990, 600, 110, 50) + sofa(980, 670, 130) + plant(1246, 700) + plant(860, 700);
  if (!specialists) s += shelf(30, 486, 150) + sofa(80, 610, 170) + table(110, 570, 110, 28) + plant(420, 700) + plant(36, 700);
  return s + "</svg>";
}
