export interface DiffLine {
  type: "add" | "del" | "eq";
  oldLineNo?: number;
  newLineNo?: number;
  text: string;
}

export interface DiffResult {
  path: string;
  lines: DiffLine[];
  additions: number;
  deletions: number;
  truncated: boolean;
}

/**
 * Pure TypeScript Myers diff algorithm.
 * Computes shortest edit script with line numbering and 10,000 lines safety cap.
 */
export function myersDiff(path: string, oldText: string, newText: string): DiffResult {
  const normOld = oldText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const normNew = newText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const oldLines = normOld === "" ? [] : normOld.split("\n");
  const newLines = normNew === "" ? [] : normNew.split("\n");

  if (oldLines.length > 10000 || newLines.length > 10000) {
    return { path, lines: [], additions: 0, deletions: 0, truncated: true };
  }

  const N = oldLines.length;
  const M = newLines.length;

  if (N === 0 && M === 0) {
    return { path, lines: [], additions: 0, deletions: 0, truncated: false };
  }

  if (N === 0) {
    const lines: DiffLine[] = newLines.map((text, idx) => ({
      type: "add",
      newLineNo: idx + 1,
      text,
    }));
    return { path, lines, additions: M, deletions: 0, truncated: false };
  }

  if (M === 0) {
    const lines: DiffLine[] = oldLines.map((text, idx) => ({
      type: "del",
      oldLineNo: idx + 1,
      text,
    }));
    return { path, lines, additions: 0, deletions: N, truncated: false };
  }

  // If both are identical
  if (normOld === normNew) {
    const lines: DiffLine[] = oldLines.map((text, idx) => ({
      type: "eq",
      oldLineNo: idx + 1,
      newLineNo: idx + 1,
      text,
    }));
    return { path, lines, additions: 0, deletions: 0, truncated: false };
  }

  const MAX = N + M;
  const V = new Int32Array(2 * MAX + 1);
  V[1 + MAX] = 0;
  const trace: Array<Map<number, number>> = [];

  let foundD = -1;
  const maxD = Math.min(MAX, 10000);

  outer: for (let d = 0; d <= maxD; d++) {
    const vCopy = new Map<number, number>();
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && V[k - 1 + MAX] < V[k + 1 + MAX])) {
        x = V[k + 1 + MAX];
      } else {
        x = V[k - 1 + MAX] + 1;
      }
      let y = x - k;
      while (x < N && y < M && oldLines[x] === newLines[y]) {
        x++;
        y++;
      }
      V[k + MAX] = x;
      vCopy.set(k, x);
      if (x >= N && y >= M) {
        trace.push(vCopy);
        foundD = d;
        break outer;
      }
    }
    trace.push(vCopy);
  }

  if (foundD === -1) {
    return { path, lines: [], additions: 0, deletions: 0, truncated: true };
  }

  // Backtrack to build the diff
  let x = N;
  let y = M;
  let k = N - M;

  const rawOps: Array<{ type: "add" | "del" | "eq"; oldIdx?: number; newIdx?: number }> = [];

  for (let d = foundD; d >= 1; d--) {
    const prevV = trace[d - 1];
    let kPrev: number;
    if (k === -d || (k !== d && (prevV.get(k - 1) ?? -1) < (prevV.get(k + 1) ?? -1))) {
      kPrev = k + 1;
    } else {
      kPrev = k - 1;
    }

    const prevX = prevV.get(kPrev) ?? 0;
    const prevY = prevX - kPrev;

    // Diagonal snake
    while (x > prevX + (kPrev === k - 1 ? 1 : 0) && y > prevY + (kPrev === k + 1 ? 1 : 0)) {
      x--;
      y--;
      rawOps.push({ type: "eq", oldIdx: x, newIdx: y });
    }

    // Move
    if (kPrev === k - 1) {
      // Horizontal move: deletion of oldLines[prevX]
      x--;
      rawOps.push({ type: "del", oldIdx: prevX });
    } else {
      // Vertical move: addition of newLines[prevY]
      y--;
      rawOps.push({ type: "add", newIdx: prevY });
    }

    k = kPrev;
  }

  // Remaining diagonal snake down to (0, 0)
  while (x > 0 && y > 0) {
    x--;
    y--;
    rawOps.push({ type: "eq", oldIdx: x, newIdx: y });
  }

  rawOps.reverse();

  let additions = 0;
  let deletions = 0;
  const lines: DiffLine[] = [];

  for (const op of rawOps) {
    if (op.type === "eq") {
      lines.push({
        type: "eq",
        oldLineNo: op.oldIdx! + 1,
        newLineNo: op.newIdx! + 1,
        text: oldLines[op.oldIdx!],
      });
    } else if (op.type === "del") {
      deletions++;
      lines.push({
        type: "del",
        oldLineNo: op.oldIdx! + 1,
        text: oldLines[op.oldIdx!],
      });
    } else {
      additions++;
      lines.push({
        type: "add",
        newLineNo: op.newIdx! + 1,
        text: newLines[op.newIdx!],
      });
    }
  }

  return {
    path,
    lines,
    additions,
    deletions,
    truncated: false,
  };
}
