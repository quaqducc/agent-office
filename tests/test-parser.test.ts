import test from "node:test";
import assert from "node:assert/strict";
import { isTestCommand, parseTestOutput } from "../src/test-parser.ts";

test("isTestCommand nhận diện chính xác các câu lệnh chạy test", () => {
  assert.equal(isTestCommand("npm test"), true);
  assert.equal(isTestCommand("npm test -- --test-timeout=60000"), true);
  assert.equal(isTestCommand("npm run test"), true);
  assert.equal(isTestCommand("npm t"), true);
  assert.equal(isTestCommand("node --test tests/app.test.ts"), true);
  assert.equal(isTestCommand("pytest -v tests/"), true);
  assert.equal(isTestCommand("python -m pytest"), true);
  assert.equal(isTestCommand("vitest run"), true);
  assert.equal(isTestCommand("jest --coverage"), true);

  // Không phải lệnh test
  assert.equal(isTestCommand("npm run build"), false);
  assert.equal(isTestCommand("git status"), false);
  assert.equal(isTestCommand("cat tests/app.test.ts"), false);
  assert.equal(isTestCommand("ls -la"), false);
});

test("parseTestOutput phân tích kết quả Spec của node:test", () => {
  const output = `
✔ catalog index matches the files on disk (253.8736ms)
✔ plain checkpoint reaches manager with trail (13.1147ms)
✖ approval requires action (6.0241ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected
  + false
  - true
ℹ tests 3
ℹ suites 0
ℹ pass 2
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 340.5
`;

  const summary = parseTestOutput("node --test", output);
  assert.equal(summary.isTestCommand, true);
  assert.equal(summary.framework, "node:test");
  assert.equal(summary.passed, false);
  assert.equal(summary.stats.total, 3);
  assert.equal(summary.stats.passed, 2);
  assert.equal(summary.stats.failed, 1);
  assert.equal(summary.stats.skipped, 0);
  assert.equal(summary.cases.length, 3);
  assert.equal(summary.cases[0].name, "catalog index matches the files on disk");
  assert.equal(summary.cases[0].passed, true);
  assert.equal(summary.cases[2].name, "approval requires action");
  assert.equal(summary.cases[2].passed, false);
});

test("parseTestOutput phân tích kết quả TAP của node:test", () => {
  const output = `
TAP version 13
# Subtest: tests/demo.test.ts
    ok 1 - should add numbers
    not ok 2 - should divide by zero
      ---
      failure: true
      ...
    ok 3 - should skip feature # SKIP
    1..3
# tests 3
# pass 1
# fail 1
# skipped 1
`;

  const summary = parseTestOutput("node --test --test-reporter=tap", output);
  assert.equal(summary.isTestCommand, true);
  assert.equal(summary.framework, "node:test");
  assert.equal(summary.passed, false);
  assert.equal(summary.stats.total, 3);
  assert.equal(summary.stats.passed, 1);
  assert.equal(summary.stats.failed, 1);
  assert.equal(summary.stats.skipped, 1);
  assert.equal(summary.cases.length, 3);
  assert.equal(summary.cases[0].name, "should add numbers");
  assert.equal(summary.cases[0].passed, true);
  assert.equal(summary.cases[1].name, "should divide by zero");
  assert.equal(summary.cases[1].passed, false);
  assert.equal(summary.cases[2].name, "should skip feature");
});

test("parseTestOutput phân tích kết quả pytest", () => {
  const output = `
============================= test session starts =============================
rootdir: /app
collected 6 items

tests/test_auth.py::test_login PASSED                                    [ 16%]
tests/test_auth.py::test_logout PASSED                                   [ 33%]
tests/test_auth.py::test_expired_token FAILED                            [ 50%]
tests/test_db.py::test_connect PASSED                                    [ 66%]
tests/test_db.py::test_query PASSED                                      [ 83%]
tests/test_db.py::test_disconnect PASSED                                 [100%]

=================================== FAILURES ===================================
______________________________ test_expired_token ______________________________
>       assert resp.status_code == 401
E       assert 200 == 401
=========================== short test summary info ============================
FAILED tests/test_auth.py::test_expired_token - assert 200 == 401
========================= 1 failed, 5 passed in 0.42s ==========================
`;

  const summary = parseTestOutput("pytest -v", output);
  assert.equal(summary.isTestCommand, true);
  assert.equal(summary.framework, "pytest");
  assert.equal(summary.passed, false);
  assert.equal(summary.stats.total, 6);
  assert.equal(summary.stats.passed, 5);
  assert.equal(summary.stats.failed, 1);
  assert.equal(summary.cases.length, 6);
  assert.equal(summary.cases[0].name, "tests/test_auth.py::test_login");
  assert.equal(summary.cases[0].passed, true);
  assert.equal(summary.cases[2].name, "tests/test_auth.py::test_expired_token");
  assert.equal(summary.cases[2].passed, false);
});

test("parseTestOutput fallback cho lệnh không phải test hoặc output phi chuẩn", () => {
  const nonTest = parseTestOutput("git status", "On branch main\nnothing to commit");
  assert.equal(nonTest.isTestCommand, false);
  assert.equal(nonTest.framework, "generic");
  assert.equal(nonTest.cases.length, 0);

  const genericTest = parseTestOutput("npm test", "Custom test runner: all 10 tests succeeded!");
  assert.equal(genericTest.isTestCommand, true);
  assert.equal(genericTest.framework, "generic");
  assert.equal(genericTest.passed, true);
});
