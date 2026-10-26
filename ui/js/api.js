// Thin client for the orchestrator API (same origin).

function getToken() {
  if (typeof document !== "undefined") {
    const meta = document.querySelector('meta[name="company-token"]');
    if (meta) return meta.getAttribute("content") || "";
  }
  if (typeof window !== "undefined" && window.__COMPANY_TOKEN__) {
    return window.__COMPANY_TOKEN__;
  }
  return "";
}

async function call(method, path, body) {
  const headers = {};
  if (body) headers["content-type"] = "application/json";
  const token = getToken();
  if (token) {
    headers["x-company-token"] = token;
  }
  const r = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.error ?? `${r.status} ${r.statusText}`);
    Object.assign(err, data);
    throw err;
  }
  return data;
}

const enc = encodeURIComponent;

export const api = {
  roles: () => call("GET", "/roles"),
  workspaces: () => call("GET", "/workspaces"),
  addWorkspace: (path, name) => call("POST", "/workspaces", { path, name }),
  renameWorkspace: (id, name) => call("PATCH", `/workspaces/${enc(id)}`, { name }),
  fsPickFolder: () => call("POST", "/fs/pick-folder"),
  fsBrowse: path => call("POST", "/fs/browse", { path }),
  offices: () => call("GET", "/offices"),
  config: id => call("GET", `/workspaces/${enc(id)}/config`),
  saveWorkspaceConfig: (id, config) => call("PUT", `/workspaces/${enc(id)}/config`, config),
  runs: id => call("GET", `/workspaces/${enc(id)}/runs`),
  events: runId => {
    const token = getToken();
    const tokenParam = token ? `?token=${enc(token)}` : "";
    return call("GET", `/runs/${enc(runId)}/events${tokenParam}`);
  },
  send: (id, text) => call("POST", `/workspaces/${enc(id)}/messages`, { text }),
  stop: runId => call("POST", `/runs/${enc(runId)}/stop`, {}),
  approvals: id => call("GET", `/workspaces/${enc(id)}/approvals`),
  reply: (checkpointId, decision, note = "") => call("POST", `/checkpoints/${enc(checkpointId)}/reply`, { decision, note }),
  queue: id => call("GET", `/workspaces/${enc(id)}/queue`),
  deleteQueueItem: (id, qid) => call("DELETE", `/workspaces/${enc(id)}/queue/${enc(qid)}`),
  tree: (workspaceId, subpath = ".", depth = 1) => call("GET", `/workspaces/${enc(workspaceId)}/tree?path=${enc(subpath)}&depth=${depth}`),
  file: (workspaceId, subpath) => call("GET", `/workspaces/${enc(workspaceId)}/files?path=${enc(subpath)}`),
  saveFile: (workspaceId, path, content, expectedSha256, force = false) =>
    call("PUT", `/workspaces/${enc(workspaceId)}/files`, { path, content, expectedSha256, force }),
  createFile: (workspaceId, path, content = "") =>
    call("POST", `/workspaces/${enc(workspaceId)}/files`, { path, content }),
  changes: (workspaceId, runId) =>
    call("GET", `/workspaces/${enc(workspaceId)}/changes?runId=${enc(runId)}`),
  diff: (workspaceId, path, runId) =>
    call("GET", `/workspaces/${enc(workspaceId)}/diff?path=${enc(path)}&runId=${enc(runId)}`),
  health: () => call("GET", "/health"),
  settings: () => call("GET", "/settings"),
  saveSettings: c => call("PUT", "/settings", c),
  telegramPairCode: () => call("POST", "/settings/telegram/pair-code", {}),
  getTelegramPairCode: () => call("POST", "/settings/telegram/pair-code", {}),
  testProvider: (provider, model) => call("POST", "/settings/providers/test", { provider, model }),
  providerModels: provider => call("POST", "/settings/providers/models", { provider }),
  store: () => call("GET", "/store"),
  installRole: id => call("POST", `/store/roles/${enc(id)}/install`, {}),
  uninstallRole: id => call("DELETE", `/store/roles/${enc(id)}`, {}),
};

/** Live TeamEvents for a workspace; returns an unsubscribe function. EventSource reconnects by itself. */
export function subscribe(workspaceId, onEvent, onStatus) {
  const token = getToken();
  const tokenParam = token ? `&token=${enc(token)}` : "";
  const es = new EventSource(`/events?workspace=${enc(workspaceId)}${tokenParam}`);
  es.onmessage = m => onEvent(JSON.parse(m.data));
  es.onopen = () => onStatus?.("open");
  es.onerror = () => onStatus?.("error");
  return () => es.close();
}
