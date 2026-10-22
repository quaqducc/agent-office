import test from "node:test";
import assert from "node:assert/strict";
import { myersDiff } from "../src/diff.ts";

test("myersDiff phát hiện các dòng thêm mới (add) và dòng bị xoá (del) chính xác", () => {
  const oldText = "line 1\nline 2\nline 3";
  const newText = "line 1\nline 2 modified\nline 3\nline 4";
  const res = myersDiff("test.txt", oldText, newText);

  assert.equal(res.path, "test.txt");
  assert.equal(res.truncated, false);
  assert.equal(res.additions, 2); // "line 2 modified", "line 4"
  assert.equal(res.deletions, 1); // "line 2"

  const lines = res.lines;
  assert.equal(lines[0].type, "eq");
  assert.equal(lines[0].text, "line 1");
  assert.equal(lines[0].oldLineNo, 1);
  assert.equal(lines[0].newLineNo, 1);

  assert.equal(lines[1].type, "del");
  assert.equal(lines[1].text, "line 2");
  assert.equal(lines[1].oldLineNo, 2);

  assert.equal(lines[2].type, "add");
  assert.equal(lines[2].text, "line 2 modified");
  assert.equal(lines[2].newLineNo, 2);

  assert.equal(lines[3].type, "eq");
  assert.equal(lines[3].text, "line 3");
  assert.equal(lines[3].oldLineNo, 3);
  assert.equal(lines[3].newLineNo, 3);

  assert.equal(lines[4].type, "add");
  assert.equal(lines[4].text, "line 4");
  assert.equal(lines[4].newLineNo, 4);
});

test("myersDiff xử lý file rỗng biến thành file có nội dung (toàn bộ là add)", () => {
  const oldText = "";
  const newText = "hello\nworld";
  const res = myersDiff("new.txt", oldText, newText);

  assert.equal(res.additions, 2);
  assert.equal(res.deletions, 0);
  assert.equal(res.lines.length, 2);
  assert.equal(res.lines[0].type, "add");
  assert.equal(res.lines[0].text, "hello");
  assert.equal(res.lines[0].newLineNo, 1);
  assert.equal(res.lines[1].type, "add");
  assert.equal(res.lines[1].text, "world");
  assert.equal(res.lines[1].newLineNo, 2);
});

test("myersDiff xử lý file có nội dung biến thành file rỗng (toàn bộ là del)", () => {
  const oldText = "first\nsecond";
  const newText = "";
  const res = myersDiff("deleted.txt", oldText, newText);

  assert.equal(res.additions, 0);
  assert.equal(res.deletions, 2);
  assert.equal(res.lines.length, 2);
  assert.equal(res.lines[0].type, "del");
  assert.equal(res.lines[0].text, "first");
  assert.equal(res.lines[0].oldLineNo, 1);
  assert.equal(res.lines[1].type, "del");
  assert.equal(res.lines[1].text, "second");
  assert.equal(res.lines[1].oldLineNo, 2);
});

test("myersDiff xử lý hai file giống hệt nhau (toàn bộ là eq, additions=0, deletions=0)", () => {
  const text = "abc\ndef\nghi";
  const res = myersDiff("same.txt", text, text);

  assert.equal(res.additions, 0);
  assert.equal(res.deletions, 0);
  assert.equal(res.lines.length, 3);
  for (let i = 0; i < 3; i++) {
    assert.equal(res.lines[i].type, "eq");
    assert.equal(res.lines[i].oldLineNo, i + 1);
    assert.equal(res.lines[i].newLineNo, i + 1);
  }
});

test("myersDiff từ chối so sánh chi tiết và trả về truncated: true khi số dòng vượt quá 10.000", () => {
  const hugeLines = Array.from({ length: 10005 }, (_, i) => `line ${i}`).join("\n");
  const smallText = "hello";
  const res = myersDiff("huge.txt", hugeLines, smallText);

  assert.equal(res.truncated, true);
  assert.equal(res.lines.length, 0);
  assert.equal(res.additions, 0);
  assert.equal(res.deletions, 0);
});
