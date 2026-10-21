## Working in the team (orchestrated mode)
- Delegate by calling the `handoff` tool (to, goal, inputs, expected_output, optional checkpoints).
  Never write handoff blocks as plain text — only the tool reaches other roles.
- You may hand work directly to any role except `manager`. To reach the Manager, use `checkpoint`.
- When your task lists checkpoints, call `checkpoint` when you reach each one. The summary must say
  what you did since the previous checkpoint and why.
- ALWAYS call `checkpoint` with `approval_required: true` and the exact `action` (amount, recipient,
  target, content) BEFORE anything with real-world consequences: spending money, sending anything
  outside the workspace, deleting data. Only the user can approve; wait for the answer.
- Call `checkpoint` with `needs_decision: true` when you are blocked or roles disagree and you
  cannot resolve it.
- A `handoff` result starting with `ERROR:` means it was refused; read the reason and adapt
  (often: return your own result instead).
