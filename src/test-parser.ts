export interface TestCaseResult {
  name: string;
  passed: boolean;
  durationMs?: number;
  error?: string;
}

export interface TestRunSummary {
  isTestCommand: boolean;
  framework: "node:test" | "pytest" | "generic";
  passed: boolean;
  stats: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    durationMs?: number;
  };
  cases: TestCaseResult[];
  rawOutput: string;
}

const TEST_CMD_RE = /\b(npm\s+(test|t|run\s+test)|node\s+.*--test|pytest|python\s+.*-m\s+pytest|vitest|jest|mocha|cargo\s+test|go\s+test)\b/i;

export function isTestCommand(command: string): boolean {
  return TEST_CMD_RE.test(command || "");
}

export function parseTestOutput(command: string, output: string): TestRunSummary {
  const isCmdTest = isTestCommand(command);
  const out = output || "";

  // Check if output itself strongly indicates a test run
  const hasNodeTestIndicators = /ℹ tests \d+|TAP version \d+|# tests \d+/m.test(out);
  const hasPytestIndicators = /===+ test session starts ===+|===+ \d+ passed/m.test(out);

  if (!isCmdTest && !hasNodeTestIndicators && !hasPytestIndicators) {
    return {
      isTestCommand: false,
      framework: "generic",
      passed: false,
      stats: { total: 0, passed: 0, failed: 0, skipped: 0 },
      cases: [],
      rawOutput: out,
    };
  }

  // 1. Try node:test (Spec format)
  if (/ℹ tests \d+|[✔✖]\s+.+\([\d.]+m?s\)/m.test(out)) {
    const summary = parseNodeTestSpec(out);
    if (summary) return summary;
  }

  // 2. Try node:test (TAP format)
  if (/TAP version \d+|^\s*(ok|not ok)\s+\d+\s*-/m.test(out)) {
    const summary = parseNodeTestTap(out);
    if (summary) return summary;
  }

  // 3. Try pytest
  if (hasPytestIndicators || /::\S+\s+(PASSED|FAILED|SKIPPED)/m.test(out)) {
    const summary = parsePytest(out);
    if (summary) return summary;
  }

  // 4. Generic fallback
  const passed = !/\b(fail|failed|failure|ERR|AssertionError)\b/i.test(out);
  return {
    isTestCommand: true,
    framework: "generic",
    passed,
    stats: { total: 0, passed: passed ? 1 : 0, failed: passed ? 0 : 1, skipped: 0 },
    cases: [],
    rawOutput: out,
  };
}

function parseNodeTestSpec(out: string): TestRunSummary | null {
  const cases: TestCaseResult[] = [];
  const lines = out.split("\n");

  const caseRegex = /^\s*([✔✖])\s+(.+?)(?:\s+\(([\d.]+)m?s\))?$/;

  for (const line of lines) {
    const m = line.match(caseRegex);
    if (m) {
      const isPass = m[1] === "✔";
      const name = m[2].trim();
      const dur = m[3] ? parseFloat(m[3]) : undefined;
      cases.push({ name, passed: isPass, durationMs: dur });
    }
  }

  let total = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let durationMs: number | undefined;

  const totalMatch = out.match(/ℹ tests\s+(\d+)/);
  if (totalMatch) total = parseInt(totalMatch[1], 10);

  const passMatch = out.match(/ℹ pass\s+(\d+)/);
  if (passMatch) passed = parseInt(passMatch[1], 10);

  const failMatch = out.match(/ℹ fail\s+(\d+)/);
  if (failMatch) failed = parseInt(failMatch[1], 10);

  const skipMatch = out.match(/ℹ skipped\s+(\d+)/);
  if (skipMatch) skipped = parseInt(skipMatch[1], 10);

  const durMatch = out.match(/ℹ duration_ms\s+([\d.]+)/);
  if (durMatch) durationMs = parseFloat(durMatch[1]);

  if (!total && cases.length > 0) {
    total = cases.length;
    passed = cases.filter((c) => c.passed).length;
    failed = cases.filter((c) => !c.passed).length;
  }

  return {
    isTestCommand: true,
    framework: "node:test",
    passed: failed === 0 && total > 0,
    stats: { total, passed, failed, skipped, durationMs },
    cases,
    rawOutput: out,
  };
}

function parseNodeTestTap(out: string): TestRunSummary | null {
  const cases: TestCaseResult[] = [];
  const lines = out.split("\n");

  const tapLineRegex = /^\s*(ok|not ok)\s+\d+\s*-\s*([^#]+)(?:#\s*(.+))?$/;

  for (const line of lines) {
    const m = line.match(tapLineRegex);
    if (m) {
      const isPass = m[1] === "ok";
      const name = m[2].trim();
      cases.push({ name, passed: isPass });
    }
  }

  let total = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  const totalMatch = out.match(/# tests\s+(\d+)/);
  if (totalMatch) total = parseInt(totalMatch[1], 10);

  const passMatch = out.match(/# pass\s+(\d+)/);
  if (passMatch) passed = parseInt(passMatch[1], 10);

  const failMatch = out.match(/# fail\s+(\d+)/);
  if (failMatch) failed = parseInt(failMatch[1], 10);

  const skipMatch = out.match(/# skipped\s+(\d+)/);
  if (skipMatch) skipped = parseInt(skipMatch[1], 10);

  if (!total && cases.length > 0) {
    total = cases.length;
    passed = cases.filter((c) => c.passed).length;
    failed = cases.filter((c) => !c.passed).length;
  }

  return {
    isTestCommand: true,
    framework: "node:test",
    passed: failed === 0 && total > 0,
    stats: { total, passed, failed, skipped },
    cases,
    rawOutput: out,
  };
}

function parsePytest(out: string): TestRunSummary | null {
  const cases: TestCaseResult[] = [];
  const lines = out.split("\n");

  const caseRegex = /^(\S+::\S+)\s+(PASSED|FAILED|SKIPPED)/;

  for (const line of lines) {
    const m = line.match(caseRegex);
    if (m) {
      const name = m[1];
      const status = m[2];
      cases.push({ name, passed: status === "PASSED" });
    }
  }

  let total = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let durationMs: number | undefined;

  const collectedMatch = out.match(/collected\s+(\d+)\s+items/);
  if (collectedMatch) total = parseInt(collectedMatch[1], 10);

  const summaryMatch = out.match(/===+\s*(.+?)\s+in\s+([\d.]+)s\s*===+/);
  if (summaryMatch) {
    const summaryText = summaryMatch[1];
    durationMs = parseFloat(summaryMatch[2]) * 1000;

    const pMatch = summaryText.match(/(\d+)\s+passed/);
    if (pMatch) passed = parseInt(pMatch[1], 10);

    const fMatch = summaryText.match(/(\d+)\s+failed/);
    if (fMatch) failed = parseInt(fMatch[1], 10);

    const sMatch = summaryText.match(/(\d+)\s+skipped/);
    if (sMatch) skipped = parseInt(sMatch[1], 10);
  }

  if (!total && cases.length > 0) {
    total = cases.length;
    passed = cases.filter((c) => c.passed).length;
    failed = cases.filter((c) => !c.passed).length;
  }

  return {
    isTestCommand: true,
    framework: "pytest",
    passed: failed === 0 && total > 0,
    stats: { total, passed, failed, skipped, durationMs },
    cases,
    rawOutput: out,
  };
}
