# Kế hoạch Chi tiết Sửa Lỗi Race Condition Shadow Hook và Triển khai Giai đoạn 4 Panel Đáy (Minimalist Embedded IDE)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:**
1. **Khắc phục triệt để race condition trong Shadow Backup Hook:** Chuyển handler hook `tool_call` trong `pi-runner.ts` sang cơ chế `await` có timeout bảo vệ 2s, đảm bảo bản gốc của file được sao lưu hoàn tất TRƯỚC KHI công cụ `write`/`edit` ghi đè lên đĩa. Cam kết bọc `try/catch` tuyệt đối không làm chậm hoặc gián đoạn quyền ghi của role. Commit riêng: `fix(ide): await shadow backup before tool execution to prevent race condition`.
2. **Triển khai Giai đoạn 4 Panel đáy:** Bổ sung tab "Nhật ký lệnh" (stream trực tiếp lệnh bash/powershell, lọc role/câu hỏi, click xem full output) và tab "Kết quả test" (nhận diện test command, parse kết quả TAP/spec của `node:test` và `pytest`, tóm tắt pass/fail trực quan, fallback output thô). Thêm thanh kéo đổi chiều cao (.resizer), phím tắt `Ctrl+J`, bảo toàn 100% hai tab Luồng việc & Nhật ký và bộ chọn câu hỏi. Commit riêng: `feat(ide): implement phase 4 bottom panel with command log and test summary`.
3. **Bộ tiêu chí nghiệm thu toàn diện 4 giai đoạn IDE cho Reviewer:** Soát xét tính toàn vẹn bảo mật (workspace jail, secret blocking), tính năng kế thừa, hiệu năng workspace lớn, phím tắt không xung đột, bảng đạt/chưa đạt và giới hạn kỹ thuật.

---

## Phần 1: Phân Tích & Sửa Lỗi Race Condition của Shadow Hook

### Phân tích nguyên nhân gốc rễ (Root Cause)
Hiện tại trong `src/pi-runner.ts`:
```ts
if (e.toolName === "write" || e.toolName === "edit") {
  const runId = o.router().activeRunId();
  const targetPath = e.input?.path;
  if (runId && typeof targetPath === "string") {
    void captureShadow(cwd, runId, targetPath).catch(() => {});
  }
}
```
Việc gọi `void captureShadow(...)` không có `await` (fire-and-forget) khiến hàm hook trả về ngay lập tức. Công cụ `write` hoặc `edit` của role được thực thi song song trên tiến trình. Nếu role ghi đè lên file trước khi `captureShadow` hoàn thành việc đọc file cũ từ đĩa, bản shadow sẽ chụp nhầm nội dung **đã bị sửa**, dẫn đến kết quả diff bị rỗng hoặc sai lệch hoàn toàn.

### Giải pháp kỹ thuật
1. Biến extension handler `pi.on("tool_call")` thành hàm bất đồng bộ `async (e: any) => { ... }`.
2. Sử dụng `Promise.race` kết hợp timeout bảo vệ 2000ms:
   ```ts
   if (e.toolName === "write" || e.toolName === "edit") {
     const runId = o.router().activeRunId();
     const targetPath = e.input?.path;
     if (runId && typeof targetPath === "string") {
       try {
         const shadowPromise = captureShadow(cwd, runId, targetPath);
         const timeoutPromise = new Promise<void>(resolve => setTimeout(resolve, 2000));
         await Promise.race([shadowPromise, timeoutPromise]);
       } catch (err) {
         console.warn("[shadow-hook] capture error ignored:", err);
       }
     }
   }
   ```
3. Nếu quá 2 giây hoặc gặp lỗi I/O, `catch` bắt lỗi ngầm và handler tiếp tục trả về, cho phép role thực thi ghi file bình thường, bảo đảm không bao giờ treo agent hoặc làm hỏng tác vụ của role.

---

### Task 1.1: Tái Hiện Race Condition & Sửa Lỗi Shadow Hook (TDD - Commit Riêng)

**Files:**
- Modify: `src/pi-runner.ts`
- Modify: `tests/shadow.test.ts`

- [ ] **Step 1: Viết test tái hiện race condition trong `tests/shadow.test.ts`**
  - Giả lập tình huống: File gốc chứa `"v1"`.
  - Gọi hook sao lưu shadow và ghi đè nội dung file thành `"v2"` ngay lập tức.
  - Kỳ vọng: Bản sao lưu trong `.company/shadow/<runId>/<file>` phải chứa chính xác `"v1"`, không bị dính `"v2"`.
- [ ] **Step 2: Chạy test để xác nhận kiểm thử thất bại nếu không await**
  - Command: `node --test --test-timeout=60000 tests/shadow.test.ts`
- [ ] **Step 3: Triển khai sửa lỗi trong `src/pi-runner.ts`**
  - Cập nhật handler `pi.on("tool_call")` sang `async`.
  - Áp dụng `Promise.race` với timeout 2000ms và bọc trong `try/catch`.
- [ ] **Step 4: Chạy lại test `tests/shadow.test.ts`**
  - Command: `node --test --test-timeout=60000 tests/shadow.test.ts`
  - Expected: Toàn bộ test pass xanh.
- [ ] **Step 5: Kiểm tra TypeScript & Pack Check**
  - Command: `npm run check && node scripts/pack-check.mjs`
- [ ] **Step 6: Thực hiện Git Commit riêng**
  - Command: `git commit -am "fix(ide): await shadow backup before tool execution to prevent race condition"`

---

## Phần 2: Kế Hoạch Triển Khai Giai Đoạn 4: Panel Đáy

### Task 4.1: Bộ Trích Xuất Lệnh & Phân Tích Kết Quả Test (Pure Parsers)

**Files:**
- Create: `src/command-parser.ts`
- Create: `src/test-parser.ts`
- Create: `tests/command-parser.test.ts`
- Create: `tests/test-parser.test.ts`

**Interfaces:**
```ts
export interface CommandEntry {
  id: string;
  runId?: string;
  role: string;
  command: string;
  tool: "bash" | "powershell";
  timestamp: string;
  durationMs?: number;
  ok?: boolean;
  exitCode?: number;
  preview: string;
  output: string;
}

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
```

- [ ] **Step 1: Viết failing unit tests trong `tests/command-parser.test.ts`**
  - Test trích xuất cặp `tool_call` và `tool_result` cho các lệnh bash/powershell từ danh sách sự kiện stream.
  - Test gán đúng role, thời gian, câu lệnh, preview và output đầy đủ (cắt tối đa 50KB).
- [ ] **Step 2: Viết failing unit tests trong `tests/test-parser.test.ts`**
  - Test 1: Nhận diện lệnh test: `npm test`, `node --test`, `pytest`, `pytest -v`.
  - Test 2: Parse output TAP của `node:test` (`ok 1 - ...`, `not ok 2 - ...`, `# pass 4`, `# fail 1`).
  - Test 3: Parse output Spec của `node:test` (`✔ test a`, `✖ test b`).
  - Test 4: Parse output `pytest` (`=== 5 passed, 1 failed in 0.20s ===`).
  - Test 5: Fallback cho output không nhận diện được (hiển thị raw output, `isTestCommand: false` hoặc `framework: "generic"`).
- [ ] **Step 3: Triển khai `src/command-parser.ts` và `src/test-parser.ts`**
  - Cài đặt các biểu thức chính quy (RegExp) bắt lệnh và bóc tách định dạng TAP/Spec/Pytest chuẩn xác.
- [ ] **Step 4: Chạy test xác nhận pass**
  - Command: `node --test --test-timeout=60000 tests/command-parser.test.ts tests/test-parser.test.ts`
  - Expected: Toàn bộ tests pass.
- [ ] **Step 5: Kiểm tra TypeScript**
  - Command: `npm run check`

---

### Task 4.2: Frontend UI Panel Đáy - Resizer & Phím Tắt Ctrl+J

**Files:**
- Modify: `ui/index.html`
- Modify: `ui/styles.css`
- Modify: `ui/js/layout.js` (hoặc `ui/js/panels.js`)

- [ ] **Step 1: Cập nhật HTML cấu trúc Panel Đáy trong `ui/index.html`**
  - Thêm thanh kéo đổi chiều cao: `<div class="bottom-panel-resizer" id="bottom-panel-resizer" title="Kéo để chỉnh độ cao"></div>`.
  - Bổ sung 2 tab mới vào `<nav class="bottom-tabs">`:
    - Tab "Nhật ký lệnh": `<button role="tab" id="bottom-tab-commands" data-bottom-tab="commands" class="bottom-tab"><i data-icon="terminal"></i>Lệnh <span id="commands-count" class="count"></span></button>`.
    - Tab "Kết quả test": `<button role="tab" id="bottom-tab-tests" data-bottom-tab="tests" class="bottom-tab"><i data-icon="check-circle"></i>Kết quả test <span id="tests-badge" class="badge"></span></button>`.
  - Giữ nguyên 100% hai tab cũ: `#bottom-tab-flow` (Luồng việc) và `#bottom-tab-log` (Nhật ký) kèm bộ chọn câu hỏi.
  - Thêm 2 container panel tương ứng: `#panel-commands` và `#panel-tests`.
- [ ] **Step 2: Triển khai kéo đổi chiều cao (Resizer) trong CSS & JS**
  - CSS: `.bottom-panel-resizer` có cursor `row-resize`, hover sáng màu highlight.
  - JS: Xử lý sự kiện `mousedown`, `mousemove`, `mouseup` trên document:
    - Giới hạn chiều cao tối thiểu 120px, tối đa 80% chiều cao màn hình.
    - Lưu chiều cao panel vào `localStorage.getItem("bottom_panel_height")`.
- [ ] **Step 3: Phím tắt Ctrl+J & Nút Đóng**
  - Bấm `Ctrl+J` hoặc nút `×` trên header để ẩn/hiện Panel đáy mà không làm mất trạng thái của các tab bên trong.

---

### Task 4.3: Tab "Nhật Ký Lệnh" (Command Log Tab)

**Files:**
- Modify: `ui/js/panels.js`
- Modify: `ui/styles.css`
- Modify: `ui/js/app.js`

- [ ] **Step 1: Thanh Công Cụ & Bộ Lọc của Tab Lệnh**
  - Bộ chọn câu hỏi: đồng bộ hai chiều với bộ chọn câu hỏi của Flow và Log.
  - Dropdown lọc theo role (Mọi người, developer, tester,...).
- [ ] **Step 2: Danh Sách Lệnh Stream Trực Tiếp**
  - Hiển thị danh sách câu lệnh theo thời gian thực khi nhận sự kiện SSE (`tool_call` bash/powershell).
  - Cột hiển thị: Thời gian, Role badge, Lệnh (code font), Trạng thái (Đang chạy / Thành công / Lỗi kèm exit code).
  - Vùng preview output rút gọn kèm nút "Xem toàn bộ".
- [ ] **Step 3: Modal Xem Toàn Bộ Output (Full Output Modal)**
  - Khi click vào câu lệnh hoặc nút "Xem toàn bộ":
    - Mở dialog hiển thị full stdout/stderr (tối đa 50KB an toàn).
    - Có nút "Sao chép" (Copy to clipboard) tiện lợi.

---

### Task 4.4: Tab "Kết Quả Test" (Test Results Tab)

**Files:**
- Modify: `ui/js/panels.js`
- Modify: `ui/styles.css`
- Modify: `ui/js/app.js`

- [ ] **Step 1: Thẻ Tóm Tắt Kết Quả (Test Summary Banner)**
  - Nếu toàn bộ test pass: Banner xanh lá `"✔ Toàn bộ X test đều đạt"`.
  - Nếu có test fail: Banner đỏ `"✖ X test thất bại / Y tổng số"`.
  - Hiển thị thống kê chi tiết: Tổng số, Đạt, Lỗi, Bỏ qua, Thời gian chạy (ms).
- [ ] **Step 2: Danh Sách Chi Tiết Ca Kiểm Thử (Test Cases List)**
  - Hiển thị từng ca kiểm thử với biểu tượng `✔` (xanh) hoặc `✖` (đỏ).
  - Các ca kiểm thử thất bại được ưu tiên nổi bật lên đầu kèm thông điệp lỗi (stack trace).
- [ ] **Step 3: Accordion Output Thô (Raw Output Fallback)**
  - Dành cho các lệnh test không chuẩn hóa hoặc khi người dùng muốn soi chi tiết log thực thi của tiến trình test.

---

### Task 4.5: Cập Nhật Tài Liệu, Kiểm Thử Toàn Diện & Git Commit

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/superpowers/specs/2026-10-22-minimalist-embedded-ide.md`

- [ ] **Step 1: Cập nhật `docs/ARCHITECTURE.md` & Specs**
  - Mô tả kiến trúc Bottom Panel đa tab (Luồng việc, Nhật ký, Lệnh, Kết quả test).
  - Mô tả cơ chế stream command và parser test TAP/Spec/Pytest.
- [ ] **Step 2: Chạy toàn bộ Test Suite**
  - Command: `node --test --test-timeout=60000 "tests/**/*.test.ts"`
  - Expected: 100% tests pass xanh.
- [ ] **Step 3: Kiểm tra TypeScript & Pack Check**
  - Command: `npm run check && node scripts/pack-check.mjs`
  - Expected: 0 errors, 0 warnings.
- [ ] **Step 4: Thực hiện Git Commit Giai đoạn 4**
  - Command: `git commit -am "feat(ide): implement phase 4 bottom panel with command log and test summary"`

---

## Phần 3: Bộ Tiêu Chí Nghiệm Thu Toàn Diện 4 Giai Đoạn Cho Reviewer

Reviewer sẽ đánh giá toàn bộ hệ thống Embedded IDE như một khối thống nhất dựa trên các tiêu chí sau:

| Hạng mục | Tiêu chí kiểm tra | Kết quả kỳ vọng |
|---|---|---|
| **1. Bảo mật File & Jail** | `assertSafeWorkspacePath` chặn path traversal (`../`), symlink escape, truy cập file `.env*`, `.company/`, credentials | 100% các thao tác read, write, create, diff đều trả về 403 Forbidden khi vi phạm |
| **2. Bảo toàn tính năng cũ** | Bộ chọn câu hỏi trong Flow & Log, Office pixel art, Chat sidebar, Message queue | Hoạt động bình thường, không suy giảm tính năng, tab Office luôn ghim ở vị trí đầu tiên |
| **3. Hiệu năng & Workspace lớn** | Cây thư mục lazy load, file > 500 dòng hoặc > 200KB tự tắt highlight, diff giới hạn 10.000 dòng | Phản hồi mượt mà ở màn hình 1366×768, không giật lag, không sập bộ nhớ Node.js |
| **4. Trải nghiệm Soạn thảo** | Gõ tiếng Việt Telex/Unikey/VNI mượt mà, Tab 2 spaces, native undo, đồng bộ scroll | Không nuốt ký tự hay mất dấu, caret hiển thị chuẩn |
| **5. Lưu file & Xung đột 409** | Ghi atomic, bảo toàn CRLF/UTF-8, phát hiện hash lệch ném 409 | Dialog xung đột đủ 3 nút: Xem khác biệt, Nạp lại, Ghi đè (`force: true`) |
| **6. Shadow Hook & Race Fix** | Hook chụp bản gốc trước khi role write/edit, timeout 2s, không làm gián đoạn role | Shadow chụp đúng bản gốc trước khi sửa, diff chính xác, không bị race condition |
| **7. Phím tắt IDE** | `Ctrl+B` (Explorer), `Ctrl+J` (Bottom panel), `Ctrl+Alt+B` (Chat), `Alt+O` (Office/Editor), `Ctrl+S` (Save) | Không xung đột với phím tắt hệ điều hành và trình duyệt |
| **8. Giới hạn kỹ thuật ghi rõ** | Lệnh bash (ví dụ `sed -i`) sửa file không đi qua tool write/edit | Ghi chú minh bạch trên UI và tài liệu: *"Chỉ theo dõi file đội sửa bằng công cụ write/edit"* |

---

## Danh Sách Commit & Kiểm Thử Kỳ Vọng
1. `fix(ide): await shadow backup before tool execution to prevent race condition`
2. `feat(ide): implement phase 4 bottom panel with command log and test summary`
- **Kiểm thử:** Tất cả unit tests và integration tests chạy bằng `node:test` kèm cờ `--test-timeout=60000`.
- **Ràng buộc:** Tuyệt đối không khởi chạy tiến trình server ngầm dài hạn trong bash.
