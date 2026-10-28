// Renders ```mermaid blocks (emitted by markdown.js as [data-mermaid]) into SVG drawings.
// The ~5 MB library is loaded only when the first diagram appears on the page.

let loading;
let seq = 0;
// Chat re-renders its whole list on every update; reuse drawings by source + theme instead of re-laying them out
const cache = new Map();

function loadMermaid() {
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/ui/vendor/mermaid.min.js";
    s.onload = () => resolve(globalThis.mermaid);
    s.onerror = () => {
      loading = undefined; // allow a retry on the next diagram
      reject(new Error("Không tải được thư viện vẽ sơ đồ"));
    };
    document.head.append(s);
  });
  return loading;
}

function fail(block, message) {
  block.dataset.rendered = "error";
  const p = document.createElement("p");
  p.className = "mermaid-error";
  p.textContent = `⚠️ ${message}`;
  block.append(p);
}

/** Render every not-yet-rendered diagram under root. Safe to call repeatedly. */
export async function renderDiagrams(root = document) {
  const blocks = [...root.querySelectorAll("[data-mermaid]:not([data-rendered])")];
  if (!blocks.length) return;
  for (const b of blocks) b.dataset.rendered = "pending";
  let mermaid;
  try {
    mermaid = await loadMermaid();
  } catch (err) {
    for (const b of blocks) fail(b, err.message);
    return;
  }
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  // strict: no scripts or click handlers inside diagrams written by the model
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default" });
  for (const b of blocks) {
    const src = b.querySelector("pre")?.textContent ?? "";
    const key = `${dark}:${src}`;
    const id = `mmd-${++seq}`;
    try {
      // ponytail: unbounded cache, fine for a chat's worth of diagrams; add LRU if pages ever hold hundreds
      const svg = cache.get(key) ?? (await mermaid.render(id, src)).svg;
      cache.set(key, svg);
      const out = document.createElement("div");
      out.className = "mermaid-svg";
      out.innerHTML = svg;
      b.prepend(out);
      b.dataset.rendered = "ok";
    } catch (err) {
      // a failed render leaves Mermaid's own error drawing at the end of <body>
      document.getElementById(`d${id}`)?.remove();
      document.getElementById(id)?.remove();
      fail(b, `Sơ đồ có lỗi cú pháp, đang hiện mã gốc. (${String(err?.message ?? err).split("\n")[0]})`);
    }
  }
}

/** Keep rendering diagrams as chat messages, task results and file previews are added to the page. */
export function watchDiagrams(root = document.body) {
  let queued = false;
  const run = () => {
    queued = false;
    renderDiagrams(root);
  };
  new MutationObserver(() => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(run);
    }
  }).observe(root, { childList: true, subtree: true });
  run();
}
