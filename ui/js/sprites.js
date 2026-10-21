// 16×16 chibi characters generated as SVG: one outlined template, per-role palette, hair style and accessory.

// o outline · h hair · s skin · S skin shade · e eye · b blush · m mouth · c shirt · C shirt shade · p pants · k shoes
export const SPRITE_ROWS = [
  "................",
  "....oooooooo....",
  "...ohhhhhhhho...",
  "..ohhhhhhhhhho..",
  "..ohhsssssshho..",
  "..ohsssssssSho..",
  "..ohsessssesho..",
  "..oosessssesoo..",
  "...osbsmmsbso...",
  "....osssssSo....",
  "...occcssccco...",
  "..occccccccCCo..",
  ".osccccccccCCso.",
  "..oppppppppppo..",
  "..opppoooopppo..",
  "..okkko..okkko..",
];

const range = (row, from, to) => Array.from({ length: to - from + 1 }, (_, i) => [row, from + i]);

/** Accessory pixels drawn with the role's accent colour. */
const ACCESSORIES = {
  tie: [[10, 7], [10, 8], [11, 7], [11, 8], [12, 7], [12, 8]],
  glasses: [...range(6, 4, 11), [7, 4], [7, 6], [7, 9], [7, 11]],
  headset: [...range(0, 5, 10), [1, 3], [1, 12], [5, 2], [6, 2], [7, 2], [5, 13], [6, 13], [7, 13], [8, 3], [8, 4]],
  bulb: [[0, 12], [0, 13], [1, 12], [1, 13], [1, 14], [0, 14]],
  hardhat: [...range(1, 4, 11), ...range(2, 3, 12), ...range(3, 2, 13), [4, 1], [4, 14]],
  cap: [...range(1, 4, 11), ...range(2, 3, 12), ...range(3, 3, 14)],
  beret: [[0, 5], [0, 6], ...range(1, 2, 10), ...range(2, 2, 8)],
  briefcase: [[11, 14], [12, 14], [12, 15], [11, 15]],
  badge: [[11, 4], [11, 5]],
  megaphone: [[10, 14], [11, 14], [11, 15], [12, 15], [10, 15]],
  clipboard: [[11, 9], [11, 10], [12, 9], [12, 10]],
  bow: [[2, 11], [2, 12], [2, 13], [1, 12]],
};

const SKIN = ["#f6cfa6", "#e3ad80", "#c58659", "#8a5636"];

/** role → [skin index, hair, shirt, pants, accent, accessory, long hair] */
const ROLES = {
  manager: [0, "#2a2320", "#2f3e74", "#1f2333", "#e03e3e", "tie"],
  brainstormer: [1, "#e0b45a", "#f59f1b", "#3b3f4a", "#ffe066", "bulb", true],
  "business-strategist": [2, "#2b2118", "#13917a", "#283038", "#8a5a2b", "briefcase"],
  "product-manager": [0, "#9a4a24", "#1fae9b", "#2f3d50", "#ffffff", "badge", true],
  marketing: [3, "#5b3f8f", "#e2468f", "#2d3240", "#ffd166", "megaphone", true],
  planner: [1, "#5a3825", "#8048b0", "#2d3240", "#d9b06a", "clipboard"],
  critic: [2, "#1d1d1d", "#c4382f", "#2d3240", "#16161a", "glasses"],
  architect: [0, "#3a2a1c", "#2b7bc0", "#2d3240", "#f4c430", "hardhat"],
  developer: [1, "#1d1d1d", "#36485e", "#1f2333", "#2fb36b", "headset"],
  "ai-engineer": [3, "#2b2118", "#6c5ce7", "#2d3240", "#13c2c2", "headset", true],
  devops: [2, "#9a4a24", "#e57a1f", "#2d3240", "#2d3240", "cap"],
  "ui-ux": [0, "#e0603f", "#ef6fa6", "#2d3240", "#2d3240", "beret", true],
  reviewer: [1, "#7a8288", "#14a37f", "#2d3240", "#16161a", "glasses"],
  user: [0, "#7a4a2a", "#0f9d8a", "#2d3240", "#ffd166", "bow", true],
};

const hash = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const FALLBACK_SHIRTS = ["#1c7ed6", "#12b886", "#e8590c", "#7950f2", "#f06595", "#0ca678"];

/** Darken a #rrggbb colour by factor f (negative f lightens). */
export function shade(hex, f = 0.25) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.min(255, Math.round(f < 0 ? v + (255 - v) * -f : v * (1 - f))));
  return "#" + c.map(v => v.toString(16).padStart(2, "0")).join("");
}

function palette(role) {
  const p = ROLES[role];
  if (p) return { s: SKIN[p[0]], h: p[1], c: p[2], p: p[3], a: p[4], acc: p[5], long: !!p[6] };
  const n = hash(role);
  return { s: SKIN[n % 4], h: ["#2b2118", "#5a3825", "#1d1d1d"][n % 3], c: FALLBACK_SHIRTS[n % FALLBACK_SHIRTS.length], p: "#2d3240", a: "#2d3240", acc: null, long: n % 2 === 0 };
}

/** Pixel-art SVG markup for a role (deterministic). */
export function sprite(role) {
  const pal = palette(role);
  const colors = {
    o: "#231a17", h: pal.h, s: pal.s, S: shade(pal.s, 0.12), e: "#1b1b22", b: "#f08f8f", m: "#9c3d33",
    c: pal.c, C: shade(pal.c, 0.22), p: pal.p, k: "#1a1a1f",
  };
  const grid = SPRITE_ROWS.map(r => [...r].map(ch => colors[ch] ?? null));
  if (pal.long) for (const r of [7, 8, 9]) { grid[r][2] = pal.h; grid[r][13] = pal.h; grid[r][3] = r === 7 ? pal.h : grid[r][3]; grid[r][12] = r === 7 ? pal.h : grid[r][12]; }
  grid[3][5] = grid[3][6] = shade(pal.h, -0.35); // hair highlight
  for (const [r, c] of ACCESSORIES[pal.acc] ?? []) grid[r][c] = pal.a;
  let rects = "";
  grid.forEach((row, y) => {
    // merge horizontal runs of the same colour to keep the SVG small
    for (let x = 0; x < 16;) {
      const col = row[x];
      let w = 1;
      while (x + w < 16 && row[x + w] === col) w++;
      if (col) rects += `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${col}"/>`;
      x += w;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}
