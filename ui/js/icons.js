// Minimal stroke icons (24×24, currentColor). Filled shapes are marked with "F:".
const P = {
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
  history: "M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5M3.5 4v4.5H8M12 8v4l3 2",
  chevron: "m6 9 6 6 6-6",
  plus: "M12 5v14M5 12h14",
  stop: "F:M7 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z",
  play: "F:M8 5.5v13a.8.8 0 0 0 1.2.7l10.2-6.5a.8.8 0 0 0 0-1.4L9.2 4.8A.8.8 0 0 0 8 5.5z",
  pause: "F:M7 5h3.5v14H7zM13.5 5H17v14h-3.5z",
  skip: "M5 5l10 7-10 7zM19 5v14",
  replay: "M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5M3.5 4v4.5H8",
  send: "M4 12 20 4l-6 16-2.5-6.5z",
  x: "M6 6l12 12M18 6 6 18",
  check: "m5 12.5 4.5 4.5L19 7.5",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  alert: "M12 3.5 2.5 20h19zM12 10v4.5M12 17.5v.01",
  zap: "M13 2 4 14h7l-1 8 9-12h-7z",
  chat: "M4 5h16v11H10l-5 4v-4H4z",
  flow: "M6 4v16M6 9h7M6 16h7M17 9a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM17 16a2 2 0 1 1-4 0 2 2 0 0 1 4 0z",
  log: "M9 6h11M9 12h11M9 18h11M4.5 6v.01M4.5 12v.01M4.5 18v.01",
  hourglass: "M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9",
  arrow: "M5 12h14M13 6l6 6-6 6",
  tasks: "M4 6h3M4 12h3M4 18h3M10 6h10M10 12h10M10 18h10",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  store: "M3.5 9 5 4h14l1.5 5M3.5 9h17M3.5 9a2.8 2.8 0 0 0 5.7 0 2.8 2.8 0 0 0 5.6 0 2.8 2.8 0 0 0 5.7 0M5 11v9h14v-9M10 20v-5h4v5",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  sparkle:"M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6",
};

/** Inline SVG markup for a named icon. */
export function icon(name, cls = "") {
  const d = P[name] ?? "";
  const filled = d.startsWith("F:");
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${filled ? d.slice(2) : d}" ${filled ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'}/></svg>`;
}
