// Thin client for the orchestrator API (same origin).

async function call(method, path, body) {
  const r = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
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
  events: runId => call("GET", `/runs/${enc(runId)}/events`),
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
  health: () => call("GET", "/health"),
  settings: () => call("GET", "/settings"),
  saveSettings: c => call("PUT", "/settings", c),
  testProvider: (provider, model) => call("POST", "/settings/providers/test", { provider, model }),
  providerModels: provider => call("POST", "/settings/providers/models", { provider }),
  store: () => call("GET", "/store"),
  installRole: id => call("POST", `/store/roles/${enc(id)}/install`, {}),
  uninstallRole: id => call("DELETE", `/store/roles/${enc(id)}`, {}),
};

/** Live TeamEvents for a workspace; returns an unsubscribe function. EventSource reconnects by itself. */
export function subscribe(workspaceId, onEvent, onStatus) {
  const es = new EventSource(`/events?workspace=${enc(workspaceId)}`);
  es.onmessage = m => onEvent(JSON.parse(m.data));
  es.onopen = () => onStatus?.("open");
  es.onerror = () => onStatus?.("error");
  return () => es.close();
}
