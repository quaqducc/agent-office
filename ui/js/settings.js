// Settings: provider presets and form checks (pure, Node-safe), the first-run setup screen and the settings dialog.
import { api } from "./api.js";
import { icon } from "./icons.js";
import { sprite } from "./sprites.js";
import { esc } from "./util.js";

/** Endpoints people commonly have keys for. `noKey`: usually runs locally without a key. */
export const providerPresets = [
  { key: "openai", name: "OpenAI", api: "openai-completions", baseUrl: "https://api.openai.com/v1", search: "none" },
  { key: "openrouter", name: "OpenRouter", api: "openai-completions", baseUrl: "https://openrouter.ai/api/v1", search: "openrouter-online" },
  { key: "deepseek", name: "DeepSeek", api: "openai-completions", baseUrl: "https://api.deepseek.com", search: "none" },
  { key: "gemini", name: "Gemini", api: "openai-completions", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", search: "none" },
  { key: "anthropic", name: "Anthropic", api: "anthropic-messages", baseUrl: "https://api.anthropic.com", search: "none" },
  { key: "ollama", name: "Ollama", api: "openai-completions", baseUrl: "http://localhost:11434/v1", search: "none", noKey: true },
  { key: "omniroute", name: "OmniRoute", api: "openai-completions", baseUrl: "http://localhost:20128/v1", search: "google_search" },
  { key: "custom", name: "Tuỳ chỉnh (endpoint khác)", api: "openai-completions", baseUrl: "", search: "none" },
];

const API_VI = { "openai-completions": "OpenAI-compatible", "anthropic-messages": "Anthropic Messages", "google-generative-ai": "Gemini (native)" };
const SEARCH_VI = { google_search: "Google Search qua endpoint (OmniRoute)", "openrouter-online": "Web search của OpenRouter", none: "Không có" };

/** True for endpoints on this machine, which may run without an API key. */
export function isLocalUrl(u) {
  try { return /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i.test(new URL(u).hostname); } catch { return false; }
}

/** Problems with a provider form, in Vietnamese; empty when it can be saved. */
export function validateProviderForm(f) {
  const errs = [];
  if (!String(f.name ?? "").trim()) errs.push("Nhập tên nhà cung cấp.");
  const url = String(f.baseUrl ?? "").trim();
  if (!url) errs.push("Nhập endpoint URL.");
  else {
    let ok = false;
    try { ok = /^https?:$/.test(new URL(url).protocol); } catch { /* not a URL */ }
    if (!ok) errs.push("Endpoint URL phải bắt đầu bằng http:// hoặc https://.");
  }
  if (!String(f.apiKey ?? "").trim() && !isLocalUrl(url)) errs.push("Nhập API key (chỉ endpoint chạy trên máy này, như Ollama, mới được để trống).");
  return errs;
}

/** A readable, unique provider id from its display name. */
export function providerId(name, taken) {
  const base = String(name ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, "d")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "provider";
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

const originOf = u => { try { return new URL(u).origin; } catch { return ""; } };
const presetFor = p => providerPresets.find(x => x.baseUrl && x.baseUrl === p.baseUrl)?.key ?? (p.baseUrl ? "custom" : "openai");
const secs = ms => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} giây`);
const opts = (pairs, cur) => pairs.map(([v, label]) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(label)}</option>`).join("");

// ---------- provider editor (setup screen and settings) ----------
let uid = 0;
function editorHtml(p, { modelLabel, model = "" }) {
  const id = `pe${++uid}`;
  const preset = presetFor(p);
  return `<div class="pe">
    <label class="field"><span>Nhà cung cấp</span>
      <select class="select big" name="preset">${opts(providerPresets.map(x => [x.key, x.name]), preset)}</select></label>
    <div class="grid2">
      <label class="field"><span>Tên hiển thị</span><input name="name" value="${esc(p.name)}" autocomplete="off"></label>
      <label class="field"><span>Endpoint URL</span><input name="baseUrl" value="${esc(p.baseUrl)}" placeholder="https://…/v1" autocomplete="off" spellcheck="false" inputmode="url"></label>
    </div>
    <label class="field"><span>API key</span>
      <input name="apiKey" type="password" autocomplete="new-password" spellcheck="false" placeholder="${p.apiKey ? `Đã lưu (${esc(p.apiKey)}) — để trống để giữ nguyên` : "Dán API key vào đây"}">
      <small>Key chỉ lưu trên máy này (thư mục ~/.agent-company), không gửi đi đâu ngoài endpoint ở trên.</small></label>
    <details class="adv"><summary>Nâng cao</summary>
      <div class="grid2">
        <label class="field"><span>Kiểu API</span><select class="select" name="api">${opts(Object.entries(API_VI), p.api)}</select></label>
        <label class="field"><span>Tìm kiếm web qua endpoint</span><select class="select" name="search">${opts(Object.entries(SEARCH_VI), p.search)}</select></label>
      </div>
    </details>
    <div class="field"><span>${esc(modelLabel)}</span>
      <div class="model-row">
        <input name="model" list="${id}-models" value="${esc(model)}" placeholder="Chọn hoặc gõ tên model" autocomplete="off" spellcheck="false">
        <button type="button" class="btn" data-pe="models">${icon("refresh")}Tải danh sách</button>
        <button type="button" class="btn" data-pe="test">${icon("zap")}Kiểm tra</button>
      </div>
      <datalist id="${id}-models"></datalist>
    </div>
    <p class="status-line" role="status"></p>
  </div>`;
}

/** Wire an editor rendered by editorHtml. `orig` is the stored provider when editing (its key arrives masked). */
function bindEditor(root, orig = {}) {
  const q = n => root.querySelector(`[name="${n}"]`);
  const status = root.querySelector(".status-line");
  const list = root.querySelector("datalist");
  const say = (text, kind = "") => { status.textContent = text; status.className = `status-line ${kind}`; };
  let lastPreset = q("preset").value;

  q("preset").addEventListener("change", () => {
    const prev = providerPresets.find(x => x.key === lastPreset);
    const next = providerPresets.find(x => x.key === q("preset").value);
    if (!q("name").value.trim() || q("name").value === prev?.name) q("name").value = next.key === "custom" ? "" : next.name;
    q("baseUrl").value = next.baseUrl;
    q("api").value = next.api;
    q("search").value = next.search;
    lastPreset = next.key;
    list.innerHTML = "";
    say(next.noKey ? "Ollama chạy trên máy bạn nên không cần API key." : "");
    (next.baseUrl ? q("apiKey") : q("baseUrl")).focus();
  });

  const read = () => {
    const provider = {
      id: orig.id ?? "", name: q("name").value.trim(), api: q("api").value, baseUrl: q("baseUrl").value.trim(),
      apiKey: q("apiKey").value.trim() || orig.apiKey || "", search: q("search").value,
      ...(orig.contextWindow ? { contextWindow: orig.contextWindow } : {}),
    };
    const errors = validateProviderForm(provider);
    // the server keeps a stored key only for the same endpoint and API type (it never sends it elsewhere)
    const moved = orig.apiKey && !q("apiKey").value.trim() && (orig.api !== provider.api || originOf(orig.baseUrl) !== originOf(provider.baseUrl));
    if (moved) errors.unshift("Bạn đã đổi endpoint hoặc kiểu API — nhập lại API key cho endpoint mới.");
    return { provider, model: q("model").value.trim(), errors };
  };

  async function loadModels(quiet = false) {
    const { provider, errors } = read();
    if (errors.length) { if (!quiet) say(errors[0], "bad"); return; }
    say("Đang tải danh sách model…", "busy");
    try {
      const r = await api.providerModels(provider);
      if (r.error) return say(`Không tải được danh sách model: ${r.error}. Bạn vẫn có thể gõ tên model.`, quiet ? "" : "bad");
      list.innerHTML = r.models.map(m => `<option value="${esc(m)}"></option>`).join("");
      say(r.models.length ? `Có ${r.models.length} model — bấm vào ô model để chọn.` : "Endpoint không liệt kê model — hãy gõ tên model.", r.models.length ? "good" : "");
    } catch (e) { say(e.message, "bad"); }
  }

  /** One real request through the endpoint; resolves true when the model answered. */
  async function test() {
    const { provider, model, errors } = read();
    if (errors.length) { say(errors[0], "bad"); return false; }
    if (!model) { say("Chọn model để kiểm tra.", "bad"); q("model").focus(); return false; }
    say("Đang gửi một câu thử tới model…", "busy");
    try {
      const r = await api.testProvider(provider, model);
      if (r.ok) say(`Kết nối tốt — model trả lời sau ${secs(r.ms)}.`, "good");
      else say(r.error, "bad");
      return r.ok;
    } catch (e) { say(e.message, "bad"); return false; }
  }

  root.querySelector('[data-pe="models"]').addEventListener("click", () => loadModels());
  root.querySelector('[data-pe="test"]').addEventListener("click", () => test());
  for (const n of ["baseUrl", "apiKey"]) q(n).addEventListener("change", () => loadModels(true));
  return { read, test, say, loadModels, focus: () => (q("baseUrl").value ? q("apiKey") : q("baseUrl")).focus() };
}

// ---------- first-run setup ----------
/** Blocking screen shown until a provider and a default model are saved. */
export function showSetup() {
  const d = document.getElementById("setup");
  const first = providerPresets[0];
  d.innerHTML = `<form class="sheet-form" novalidate>
    <header class="setup-head">
      <span class="setup-mark" aria-hidden="true">${sprite("manager")}</span>
      <div><h2>Kết nối model AI</h2>
        <p>Đội AI cần một API để làm việc. Chọn nhà cung cấp, dán API key, chọn model là xong — sau này đổi được trong Cài đặt.</p></div>
    </header>
    ${editorHtml({ name: first.name, api: first.api, baseUrl: first.baseUrl, search: first.search }, { modelLabel: "Model cho cả đội" })}
    <div class="ask-buttons"><button type="submit" class="btn primary">${icon("check")}<span>Lưu và vào văn phòng</span></button></div>
  </form>`;
  const form = d.querySelector("form");
  const btn = form.querySelector('button[type="submit"]');
  const ed = bindEditor(d.querySelector(".pe"));
  let force = false;
  form.addEventListener("input", () => { // edited after a failed test: test again before saving
    if (force) { force = false; btn.querySelector("span").textContent = "Lưu và vào văn phòng"; }
  });
  d.addEventListener("cancel", ev => ev.preventDefault()); // nothing works without a model
  d.showModal();
  ed.focus();
  return new Promise(resolve => {
    form.addEventListener("submit", async ev => {
      ev.preventDefault();
      const { provider, model, errors } = ed.read();
      if (errors.length) return ed.say(errors[0], "bad");
      if (!model) return ed.say("Chọn model cho đội (bấm “Tải danh sách” để xem các model có sẵn).", "bad");
      btn.disabled = true;
      try {
        if (!force && !(await ed.test())) {
          force = true; // some models fail the tiny test but work; let the user decide
          btn.querySelector("span").textContent = "Vẫn lưu";
          return;
        }
        const cfg = await api.settings();
        provider.id = providerId(provider.name, cfg.providers.map(p => p.id));
        cfg.providers.push(provider);
        cfg.defaultModel = { provider: provider.id, model };
        await api.saveSettings(cfg);
        d.close();
        resolve();
      } catch (e) { ed.say(`Không lưu được: ${e.message}`, "bad"); }
      finally { btn.disabled = false; }
    });
  });
}

// ---------- settings dialog ----------
/**
 * @param {{ roles: {id:string,name:string}[], version?: string, toast: (m:string,k?:string)=>void,
 *           ask: (o:object)=>Promise<object|null>, onSaved?: ()=>void }} ctx
 */
export async function openSettings(ctx) {
  const d = document.getElementById("settings");
  let cfg;
  try { cfg = await api.settings(); } catch (e) { return ctx.toast(`Không đọc được cài đặt: ${e.message}`, "bad"); }
  let tab = "providers";
  let editing = null; // provider index being edited, -1 for a new one
  const modelLists = new Map(); // provider id → Promise<string[]>

  d.innerHTML = `<div class="sheet-head"><h2 id="settings-title">Cài đặt</h2>
      <button type="button" class="icon-btn" data-s="close" aria-label="Đóng">${icon("x")}</button></div>
    <nav class="sheet-tabs" role="tablist">
      <button type="button" role="tab" data-tab="providers">Nhà cung cấp</button>
      <button type="button" role="tab" data-tab="models">Model</button>
      <button type="button" role="tab" data-tab="search">Tìm kiếm web</button>
    </nav>
    <div class="sheet-body"></div>
    <div class="sheet-foot"><small class="ver">Agent Company ${esc(ctx.version ?? "")}</small><p class="status-line bad" role="alert"></p>
      <button type="button" class="btn" data-s="close">Huỷ</button><button type="button" class="btn primary" data-s="save">Lưu</button></div>`;
  d.setAttribute("aria-labelledby", "settings-title");
  const body = d.querySelector(".sheet-body");
  const err = d.querySelector(".sheet-foot .status-line");
  const pname = id => cfg.providers.find(p => p.id === id)?.name ?? id;

  const models = id => {
    const p = cfg.providers.find(x => x.id === id);
    if (!p) return Promise.resolve([]);
    if (!modelLists.has(id)) modelLists.set(id, api.providerModels(p).then(r => r.models ?? []).catch(() => []));
    return modelLists.get(id);
  };
  const fillList = async (input, pid) => {
    const dl = d.querySelector(`#${input.getAttribute("list")}`);
    if (dl && !dl.dataset.for) { dl.dataset.for = pid; dl.innerHTML = (await models(pid)).map(m => `<option value="${esc(m)}"></option>`).join(""); }
  };
  const datalists = () => cfg.providers.map(p => `<datalist id="dl-${esc(p.id)}"></datalist>`).join("");

  function draw() {
    d.querySelectorAll(".sheet-tabs button").forEach(b => { b.classList.toggle("on", b.dataset.tab === tab); b.setAttribute("aria-selected", String(b.dataset.tab === tab)); });
    d.querySelector(".sheet-foot").hidden = editing !== null;
    err.textContent = "";
    if (editing !== null) return drawEditor();
    if (tab === "providers") body.innerHTML = providersHtml();
    if (tab === "models") body.innerHTML = modelsHtml();
    if (tab === "search") body.innerHTML = searchHtml();
  }

  function providersHtml() {
    const used = id => cfg.defaultModel?.provider === id || Object.values(cfg.roleModels).some(r => r.provider === id);
    return `<p class="hint">Mỗi nhà cung cấp là một endpoint + API key. Bạn có thể thêm nhiều nhà cung cấp và cho từng role dùng model khác nhau.</p>
      ${cfg.providers.length ? `<ul class="prov-list">${cfg.providers.map((p, i) => `<li class="prov">
        <div class="prov-main"><b>${esc(p.name)}</b><small>${esc(p.baseUrl)}</small>
          <span class="tags"><span class="tag">${esc(API_VI[p.api] ?? p.api)}</span><span class="tag">${p.apiKey ? `key ${esc(p.apiKey)}` : "không key"}</span>
          ${p.search !== "none" ? `<span class="tag good">${esc(SEARCH_VI[p.search])}</span>` : ""}${used(p.id) ? `<span class="tag accent">đang dùng</span>` : ""}</span></div>
        <button type="button" class="btn small" data-edit="${i}">${icon("edit")}Sửa</button>
        <button type="button" class="icon-btn" data-del="${i}" aria-label="Xoá ${esc(p.name)}" title="Xoá">${icon("trash")}</button>
      </li>`).join("")}</ul>` : `<p class="none">Chưa có nhà cung cấp nào.</p>`}
      <button type="button" class="btn" data-edit="-1">${icon("plus")}Thêm nhà cung cấp</button>`;
  }

  let ed = null;
  function drawEditor() {
    const p = editing >= 0 ? cfg.providers[editing] : { name: providerPresets[0].name, api: providerPresets[0].api, baseUrl: providerPresets[0].baseUrl, search: providerPresets[0].search };
    const model = cfg.defaultModel?.provider === p.id ? cfg.defaultModel.model : "";
    body.innerHTML = `<h3 class="sub">${editing >= 0 ? `Sửa ${esc(p.name)}` : "Thêm nhà cung cấp"}</h3>
      ${editorHtml(p, { modelLabel: cfg.defaultModel ? "Model để kiểm tra" : "Model mặc định cho cả đội", model })}
      <div class="ask-buttons"><button type="button" class="btn" data-ed="cancel">Quay lại</button><button type="button" class="btn primary" data-ed="done">Xong</button></div>`;
    ed = bindEditor(body.querySelector(".pe"), editing >= 0 ? p : {});
    ed.focus();
  }

  function modelsHtml() {
    if (!cfg.providers.length) return `<p class="none">Thêm một nhà cung cấp trước.</p>`;
    const provOpts = (cur, withDefault) => (withDefault ? `<option value="">Theo model mặc định</option>` : "") + opts(cfg.providers.map(p => [p.id, p.name]), cur);
    const dm = cfg.defaultModel ?? { provider: cfg.providers[0].id, model: "" };
    return `${datalists()}<section class="set-sec"><h3>Model mặc định</h3>
        <p class="hint">Cả đội dùng model này, trừ những role bạn chọn riêng bên dưới.</p>
        <div class="pick" data-pick="">
          <select class="select" data-k="provider" aria-label="Nhà cung cấp">${provOpts(dm.provider, false)}</select>
          <input data-k="model" list="dl-${esc(dm.provider)}" value="${esc(dm.model)}" placeholder="Tên model" aria-label="Model mặc định" autocomplete="off" spellcheck="false">
          <button type="button" class="btn small" data-test="">${icon("zap")}Kiểm tra</button>
        </div><p class="status-line" data-status="" role="status"></p></section>
      <section class="set-sec"><h3>Model riêng cho từng role</h3>
        <p class="hint">Ví dụ: Developer dùng model mạnh về code, Researcher dùng model rẻ và nhanh.</p>
        <ul class="role-models">${ctx.roles.map(r => {
          const m = cfg.roleModels[r.id];
          return `<li class="pick" data-pick="${esc(r.id)}"><span class="av xs">${sprite(r.id)}</span><b>${esc(r.name)}</b>
            <select class="select" data-k="provider" aria-label="Nhà cung cấp cho ${esc(r.name)}">${provOpts(m?.provider ?? "", true)}</select>
            <input data-k="model" list="dl-${esc(m?.provider ?? "")}" value="${esc(m?.model ?? "")}" placeholder="Tên model" aria-label="Model cho ${esc(r.name)}" autocomplete="off" spellcheck="false"${m ? "" : " hidden"}>
          </li>`;
        }).join("")}</ul></section>`;
  }

  function searchHtml() {
    const s = cfg.search;
    const dp = cfg.providers.find(p => p.id === cfg.defaultModel?.provider);
    const radio = (v, title, text) => `<label class="radio-card"><input type="radio" name="mode" value="${v}"${s.mode === v ? " checked" : ""}>
      <span><b>${title}</b><small>${text}</small></span></label>`;
    return `<p class="hint">Researcher dùng tìm kiếm web để kiểm chứng thông tin trước khi trả lời.</p>
      <fieldset class="radios"><legend class="sr">Cách tìm kiếm</legend>
        ${radio("auto", "Tự động (khuyên dùng)", "Dùng tìm kiếm của endpoint nếu có; nếu không thì dùng SearXNG khi bạn nhập URL bên dưới.")}
        ${radio("endpoint", "Chỉ qua endpoint", "Google Search qua OmniRoute, hoặc web search của OpenRouter.")}
        ${radio("searxng", "Chỉ SearXNG", "Máy chủ SearXNG của bạn (cần bật định dạng JSON).")}
        ${radio("off", "Tắt", "Researcher chỉ đọc các trang có link cụ thể.")}
      </fieldset>
      <label class="field"><span>SearXNG URL <em>(tuỳ chọn)</em></span>
        <input name="searxngUrl" value="${esc(s.searxngUrl ?? "")}" placeholder="http://localhost:8888" autocomplete="off" spellcheck="false" inputmode="url"></label>
      <p class="note">${icon("sparkle")}<span>Endpoint của model mặc định${dp ? ` (${esc(dp.name)})` : ""}: <b>${esc(SEARCH_VI[dp?.search ?? "none"])}</b>. Đổi trong Nhà cung cấp → Sửa → Nâng cao.</span></p>`;
  }

  // edits update the working copy; nothing is stored until "Lưu"
  function readPick(row) {
    const pid = row.querySelector('[data-k="provider"]').value;
    const input = row.querySelector('[data-k="model"]');
    return { role: row.dataset.pick, pid, input, model: input.value.trim() };
  }
  body.addEventListener("change", ev => {
    const row = ev.target.closest("[data-pick]");
    if (row) {
      const { role, pid, input, model } = readPick(row);
      if (ev.target.dataset.k === "provider") {
        input.hidden = !pid;
        input.setAttribute("list", `dl-${pid}`);
        if (pid) { fillList(input, pid); input.focus(); }
      }
      if (role === "") cfg.defaultModel = model ? { provider: pid, model } : undefined;
      else if (!pid) delete cfg.roleModels[role];
      else cfg.roleModels[role] = { provider: pid, model };
      return;
    }
    if (ev.target.name === "mode") cfg.search = { ...cfg.search, mode: ev.target.value };
    if (ev.target.name === "searxngUrl") cfg.search = { ...cfg.search, searxngUrl: ev.target.value.trim() || undefined };
  });
  body.addEventListener("input", ev => { if (ev.target.dataset.k === "model") ev.target.dispatchEvent(new Event("change", { bubbles: true })); });
  body.addEventListener("focusin", ev => {
    if (ev.target.dataset.k !== "model") return;
    const pid = ev.target.closest("[data-pick]").querySelector('[data-k="provider"]').value;
    if (pid) fillList(ev.target, pid);
  });

  body.addEventListener("click", async ev => {
    const t = ev.target.closest("[data-edit], [data-del], [data-ed], [data-test]");
    if (!t) return;
    if (t.dataset.edit !== undefined) { editing = Number(t.dataset.edit); return draw(); }
    if (t.dataset.del !== undefined) {
      const p = cfg.providers[Number(t.dataset.del)];
      const users = [cfg.defaultModel?.provider === p.id ? "model mặc định" : "",
        cfg.search.model?.provider === p.id ? "tìm kiếm web" : "",
        ...Object.entries(cfg.roleModels).filter(([, m]) => m.provider === p.id)
          .map(([id]) => ctx.roles.find(r => r.id === id)?.name ?? id)].filter(Boolean);
      if (users.length) return ctx.toast(`${p.name} đang được dùng cho ${users.join(", ")} — đổi model trước khi xoá.`, "bad");
      cfg.providers = cfg.providers.filter(x => x !== p);
      return draw();
    }
    if (t.dataset.ed === "cancel") { editing = null; return draw(); }
    if (t.dataset.ed === "done") {
      const { provider, model, errors } = ed.read();
      if (errors.length) return ed.say(errors[0], "bad");
      if (editing >= 0) cfg.providers[editing] = provider;
      else {
        provider.id = providerId(provider.name, cfg.providers.map(p => p.id));
        cfg.providers.push(provider);
      }
      modelLists.delete(provider.id);
      if (model && (!cfg.defaultModel || cfg.defaultModel.provider === provider.id)) cfg.defaultModel = { provider: provider.id, model };
      editing = null;
      return draw();
    }
    if (t.dataset.test !== undefined) {
      const row = t.closest("[data-pick]");
      const { pid, model } = readPick(row);
      const st = body.querySelector("[data-status]");
      const p = cfg.providers.find(x => x.id === pid);
      if (!model) { st.className = "status-line bad"; st.textContent = "Nhập tên model."; return; }
      st.className = "status-line busy"; st.textContent = "Đang gửi một câu thử tới model…";
      try {
        const r = await api.testProvider(p, model);
        st.className = `status-line ${r.ok ? "good" : "bad"}`;
        st.textContent = r.ok ? `Kết nối tốt — trả lời sau ${secs(r.ms)}.` : r.error;
      } catch (e) { st.className = "status-line bad"; st.textContent = e.message; }
    }
  });

  function problems() {
    const out = [];
    if (!cfg.defaultModel?.model) out.push("Chọn model mặc định (tab Model).");
    for (const r of ctx.roles) if (cfg.roleModels[r.id] && !cfg.roleModels[r.id].model) out.push(`Nhập model cho ${r.name} (tab Model).`);
    if (cfg.search.mode === "searxng" && !cfg.search.searxngUrl) out.push("Nhập SearXNG URL hoặc chọn cách tìm kiếm khác.");
    if (cfg.search.searxngUrl && validateProviderForm({ name: "x", baseUrl: cfg.search.searxngUrl, apiKey: "x" }).length) out.push("SearXNG URL phải bắt đầu bằng http:// hoặc https://.");
    return out;
  }

  d.querySelectorAll(".sheet-tabs button").forEach(b => b.addEventListener("click", () => { tab = b.dataset.tab; editing = null; draw(); }));
  d.querySelectorAll('[data-s="close"]').forEach(b => b.addEventListener("click", () => d.close()));
  d.querySelector('[data-s="save"]').addEventListener("click", async ev => {
    const p = problems();
    if (p.length) { err.textContent = p[0]; return; }
    const btn = ev.currentTarget;
    btn.disabled = true;
    try {
      cfg = await api.saveSettings(cfg);
      d.close();
      ctx.toast("Đã lưu cài đặt", "good");
      ctx.onSaved?.();
    } catch (e) { err.textContent = `Không lưu được: ${e.message}`; }
    finally { btn.disabled = false; }
  });
  draw();
  d.showModal();
}
