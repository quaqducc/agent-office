# Kế hoạch Chi Tiết Khắc Phục Toàn Diện 12 Lỗ Hổng Bảo Mật Trước Khi Phát Hành

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Khắc phục triệt để 12 lỗ hổng bảo mật đã xác định trong hệ thống Agent Company trước khi phát hành, chia thành 3 commit độc lập theo mức độ nghiêm trọng (HIGH 1-3, MEDIUM 4-7, LOW 8-12). Mỗi lỗ hổng đều có bài kiểm thử TDD tái hiện lỗi TRƯỚC KHI sửa mã nguồn, tuân thủ nghiêm ngặt `--test-timeout=60000`, không publish, không push, không chạy server lâu dài trong bash.

---

## Tổng Quan 12 Lỗ Hổng & Phân Chia Commit

| Nhóm | ID | Lỗ hổng & Nguy cơ | Vị trí ảnh hưởng | Commit |
|---|---|---|---|---|
| **HIGH** | 1 | NTFS Alternate Data Streams (ADS), trailing space/dot, 8.3 short names vượt mặt guard chặn file bí mật | `src/ide-fs.ts`, `src/guard.ts` | Commit 1 |
| **HIGH** | 2 | Symlink/junction trỏ vào file bí mật/`.company` hoặc ghi xuyên symlink trong workspace | `src/ide-fs.ts`, `src/guard.ts` | Commit 1 |
| **HIGH** | 3a | Repo lạ nhúng sẵn `.company/queue.json` tự động thực thi prompt độc hại của kẻ tấn công | `src/workspace.ts`, `src/router.ts` | Commit 1 |
| **HIGH** | 3b | `.company/shadow` bị trỏ bằng symlink khiến `enforceShadowQuota` xoá sạch dữ liệu hệ thống | `src/shadow.ts` | Commit 1 |
| **MEDIUM** | 4 | Ghi đè file tuỳ ý xuyên qua symlink `.company/queue.json` | `src/workspace.ts` | Commit 2 |
| **MEDIUM** | 5 | API cục bộ không xác thực: role bash `curl` gọi localhost để thao tác file hoặc tự duyệt approval | `src/server.ts`, `src/guard.ts`, `ui/` | Commit 2 |
| **MEDIUM** | 6 | DoS hệ thống: `/diff` đọc file vô hạn / binary, `tree` quét không giới hạn, Myers diff $O(D^2)$ bùng nổ CPU | `src/server.ts`, `src/ide-fs.ts`, `src/diff.ts` | Commit 2 |
| **MEDIUM** | 7 | `PUT /files` ghi file thiếu an toàn: thiếu `expectedSha256`, race condition rename, mất mode/permission gốc | `src/ide-fs.ts`, `src/server.ts` | Commit 2 |
| **LOW** | 8 | `/fs/pick-folder` bị spam hộp thoại (thiếu mutex) và hijack powershell binary | `src/server.ts`, `src/fs-browse.ts` | Commit 3 |
| **LOW** | 9 | `runId` thiếu validation định dạng UUID, nguy cơ thoát thư mục trong `getShadowFileContent` | `src/server.ts`, `src/shadow.ts` | Commit 3 |
| **LOW** | 10 | `captureShadow` chụp xuyên qua symlink và race condition khi ghi `.manifest.json` | `src/shadow.ts` | Commit 3 |
| **LOW** | 11 | Thiếu các tên file bí mật phổ biến (`.npmrc`, `.netrc`, `.git-credentials`, `.pypirc`, `credentials.json`, `.kube`) | `src/ide-fs.ts`, `src/guard.ts` | Commit 3 |
| **LOW** | 12 | Bản quyền & provenance thư viện tô màu cú pháp `ui/vendor/prism.js` và `THIRD_PARTY_NOTICES.md` | `ui/`, `THIRD_PARTY_NOTICES.md` | Commit 3 |

---

## Kế Hoạch Triển Khai Commit 1 (HIGH: Mục 1 - 3)
**Commit Message:** `fix(security): fix alternate data streams, symlink jail escapes, and queue/shadow tampering`

### Task 1.1: Chặn NTFS Alternate Data Streams, Trailing Dots/Spaces & Short Names 8.3 (Mục 1)
- **Vấn đề:** Trên Windows/NTFS, các định dạng `.env::$DATA`, `.git::$INDEX_ALLOCATION`, `secret.key:stream`, `.env. `, hoặc tên 8.3 (`SECRE~1`) giúp vượt qua các regex so khớp tên file thông thường trong `isSecretPath` và `guard.ts`.
- **Giải pháp:**
  - Chuẩn hoá các segment đường dẫn: loại bỏ dấu `:` và toàn bộ nội dung stream phía sau (`name.split(":")[0]`).
  - Cắt bỏ trailing dots `.` và spaces ` ` ở cuối tên từng segment trước khi kiểm tra bí mật.
  - Cấm hoàn toàn ký tự `:` trong subpath (ngoại trừ ký tự ổ đĩa Windows hợp lệ ở đầu path tuyệt đối `C:`).
  - Nhận diện và chặn short names DOS 8.3: bắt pattern `/~[0-9]+/` trong segment.
- [ ] **Step 1: Viết failing test trong `tests/security-high.test.ts`**
  - Tái hiện: `assertSafeWorkspacePath(ws, ".env::$DATA")` không bị chặn (trước khi fix).
  - Tái hiện: `assertSafeWorkspacePath(ws, "secret.key:stream")` không bị chặn.
  - Tái hiện: `assertSafeWorkspacePath(ws, ".env. ")` không bị chặn.
  - Tái hiện: `assertSafeWorkspacePath(ws, "PROGRA~1")` hoặc short name bị chặn.
  - Tái hiện trong `checkToolCall`: `read` file `.env::$DATA` bị chặn.
- [ ] **Step 2: Triển khai trong `src/ide-fs.ts` và `src/guard.ts`**
  - Cập nhật hàm lọc segment và regex kiểm tra.
- [ ] **Step 3: Chạy test xác nhận pass**
  - Command: `node --test --test-timeout=60000 tests/security-high.test.ts`

### Task 1.2: Chặn Symlink / Junction Vượt Rào Bí Mật & Ghi Xuyên Symlink (Mục 2)
- **Vấn đề:** Tạo symlink `gl -> .git` hoặc `sec -> ~/.ssh` hoặc symlink trỏ đến file bí mật ngay trong workspace. `assertSafeWorkspacePath` hiện tại chỉ kiểm tra xem realpath có nằm trong workspace hay không, nhưng không kiểm tra xem đích thực sự của nó có phải là thư mục nhạy cảm (`.git`, `.company`, credentials) hay không! Ngoài ra, ghi file xuyên symlink cho phép ghi đè ra ngoài.
- **Giải pháp:**
  - Trong `assertSafeWorkspacePath`:
    - Tìm realpath của tổ tiên gần nhất + phần còn lại (`rest`).
    - Kiểm tra `isSecretPath` trên CẢ đường dẫn danh nghĩa (nominal path) VÀ đường dẫn thực tế (real path).
    - Cấm ghi xuyên qua symlink: khi mở/tạo/ghi file, kiểm tra `lstatSync`, nếu đích hoặc bất kỳ thành phần nào là symlink trỏ vào vùng cấm, từ chối với mã 403.
  - Trong `src/guard.ts`: hàm `within()` cho công cụ `write`/`edit` phải kiểm tra `real()` để không ghi xuyên qua symlink.
- [ ] **Step 1: Viết failing test trong `tests/security-high.test.ts`**
  - Tái hiện: Tạo symlink trong workspace `lnk -> .git`, truy cập `lnk/config` bị chặn 403.
  - Tái hiện: Tạo symlink trong workspace `sec -> .env`, truy cập `sec` bị chặn 403.
  - Tái hiện: `within()` trong `guard.ts` chặn ghi vào symlink trỏ tới `.company`.
- [ ] **Step 2: Triển khai cập nhật trong `src/ide-fs.ts` và `src/guard.ts`**
- [ ] **Step 3: Chạy test xác nhận pass**
  - Command: `node --test --test-timeout=60000 tests/security-high.test.ts`

### Task 1.3: Bảo Vệ Queue Khỏi Repo Lạ & Chặn Xoá Dữ Liệu Qua Symlink Shadow (Mục 3a, 3b)
- **Vấn đề 3a:** Khi người dùng mở repo lạ chứa sẵn `.company/queue.json`, các lệnh prompt độc hại có thể tự động chạy mà không qua kiểm soát.
  - **Giải pháp 3a:** Lưu một secret ngẫu nhiên của máy cục bộ tại `~/.agent-company/queue-secret`. Khi ứng dụng enqueue, ký HMAC-SHA256 trên `id + text + createdAt`. Khi dequeue để tự chạy (auto-run), kiểm tra chữ ký HMAC. Nếu thiếu hoặc sai chữ ký: đánh dấu `untrusted: true`, KHÔNG tự động chạy, chỉ hiển thị cảnh báo trên UI. Validate `text` độ dài $\le 20.000$ ký tự, `id` bắt buộc là UUID.
- **Vấn đề 3b:** Kẻ tấn công tạo symlink `.company/shadow -> /` hoặc thư mục quan trọng. Khi `enforceShadowQuota` quét dọn dẹp, lệnh `rm` sẽ xoá các thư mục đích ngoài ý muốn.
  - **Giải pháp 3b:**
    - Kiểm tra bằng `lstatSync`: nếu `.company` hoặc `.company/shadow` là symlink, từ chối hoàn toàn.
    - Trong `enforceShadowQuota`: chỉ xoá các thư mục con có tên khớp chuẩn UUID `runId`, kiểm tra `lstatSync` không phải là symlink, và `realpathSync` phải nằm chặt chẽ bên trong thư mục shadow thực sự.
    - Hàm đo dung lượng `getDirSizeAndMtime` sử dụng `lstatSync` (không đi theo symlink).
- [ ] **Step 1: Viết failing test trong `tests/security-high.test.ts`**
  - Tái hiện: Queue item không có HMAC hợp lệ bị từ chối tự chạy trong router/workspace.
  - Tái hiện: Text queue > 20000 ký tự bị từ chối.
  - Tái hiện: `.company/shadow` là symlink bị `enforceShadowQuota` từ chối xử lý, không xoá đích.
- [ ] **Step 2: Triển khai trong `src/workspace.ts`, `src/router.ts` và `src/shadow.ts`**
- [ ] **Step 3: Chạy test và thực hiện Commit 1**
  - Command: `node --test --test-timeout=60000 tests/security-high.test.ts`
  - Command: `npm run check`
  - Commit: `git commit -am "fix(security): fix alternate data streams, symlink jail escapes, and queue/shadow tampering"`

---

## Kế Hoạch Triển Khai Commit 2 (MEDIUM: Mục 4 - 7)
**Commit Message:** `fix(security): add api token auth, queue symlink check, put files safety, and dos limits`

### Task 2.1: Chống Ghi Xuyên Symlink Cho `queue.json` (Mục 4)
- **Vấn đề:** Ghi `queue.json` trực tiếp có thể bị lợi dụng nếu `queue.json` bị tráo bằng symlink.
- **Giải pháp:**
  - Kiểm tra `lstatSync(queueFile(ws))`: nếu là symlink, ném lỗi và từ chối ghi.
  - Ghi atomic: ghi nội dung ra tệp tạm `.queue.json.tmp.${Date.now()}` trong cùng thư mục `.company/` rồi mới dùng `renameSync`.
- [ ] **Step 1: Viết test trong `tests/security-medium.test.ts`**
  - Tái hiện: `queueFile` là symlink bị chặn, không ghi đè vào đích symlink.
- [ ] **Step 2: Cập nhật `src/workspace.ts`**

### Task 2.2: Xác Thực API Cục Bộ Bằng Token & Chặn Role SSRF Cục Bộ (Mục 5)
- **Vấn đề:** Role agent có quyền chạy bash/powershell có thể gọi `curl http://127.0.0.1:<PORT>/...` để tự phê duyệt approval hoặc đọc/ghi tệp mà không cần quyền.
- **Giải pháp:**
  - Server sinh ngẫu nhiên `apiToken` (32 bytes hex) khi khởi động.
  - Bắt buộc header `x-company-token: <token>` trên tất cả các API HTTP (với `/events` SSE hỗ trợ query param `?token=<token>`).
  - Các tài nguyên tĩnh giao diện (`/`, `/ui/*`, `/styles.css`, `/vendor/*`) không yêu cầu token; server tiêm token trực tiếp vào `index.html` khi render trang web: `<script>window.__COMPANY_TOKEN__ = "...";</script>`.
  - Trong `src/guard.ts`: kiểm tra các câu lệnh shell (`bash`, `powershell`), nếu phát hiện cố gắng kết nối tới `127.0.0.1`, `localhost`, `::1` tới port của app thì lập tức chặn lại.
- [ ] **Step 1: Viết test trong `tests/security-medium.test.ts`**
  - Tái hiện: Gọi API `POST /workspaces/:id/messages` không có token bị trả về 401.
  - Tái hiện: Gọi API có token hợp lệ trả về 200.
  - Tái hiện: Shell command `curl http://localhost:<port>/workspaces` bị `checkToolCall` chặn.
- [ ] **Step 2: Triển khai trong `src/server.ts`, `src/guard.ts`, và `ui/js/api.js`**

### Task 2.3: Phòng Chống Tấn Công DoS: Giới Hạn /diff, Tree & Myers Diff (Mục 6)
- **Vấn đề:** Kẻ tấn công mở file cực lớn hoặc file nhị phân gây nghẽn CPU/RAM; quét cây thư mục hàng trăm ngàn file gây sập bộ nhớ; chạy Myers Diff ma trận lớn gây kẹt event loop.
- **Giải pháp:**
  - Endpoint `/diff`: áp trần kích thước tối đa 2MB, kiểm tra `stat.isFile()`, kiểm tra null-byte (`\0`) để từ chối file nhị phân với mã 400.
  - `listWorkspaceTree`: giới hạn tối đa 5.000 entry. Nếu thư mục có nhiều hơn, dừng duyệt và trả về cờ `truncated: true`.
  - Myers diff: áp trần số lượng sai khác chỉnh sửa $D \le 2.000$. Nếu vượt quá ngưỡng, ngắt thuật toán và trả về kết quả rút gọn (`truncated: true`).
- [ ] **Step 1: Viết test trong `tests/security-medium.test.ts`**
  - Tái hiện: `/diff` với file > 2MB hoặc file nhị phân có null-byte trả về lỗi 400/413.
  - Tái hiện: `listWorkspaceTree` với thư mục > 5.000 files trả về đúng 5.000 và `truncated: true`.
  - Tái hiện: Myers diff dừng khi edit distance $D > 2.000$.
- [ ] **Step 2: Triển khai trong `src/server.ts`, `src/ide-fs.ts`, và `src/diff.ts`**

### Task 2.4: Gia Cố An Toàn Cho `PUT /files` (Mục 7)
- **Vấn đề:** Ghi file không có sha256 kiểm tra có thể ghi đè mất mát dữ liệu; race window giữa lúc đọc hash và lúc rename; mất mode/permission gốc của file.
- **Giải pháp:**
  - Bắt buộc phải có `expectedSha256` trong payload (ngoại trừ khi có cờ `force: true`).
  - Đọc và tính toán lại sha256 của file trên đĩa ngay trước thao tác rename cuối cùng.
  - Bảo lưu quyền file gốc: đọc `stat.mode` của file hiện tại và gọi `chmodSync` trên file tạm trước khi `rename`.
- [ ] **Step 1: Viết test trong `tests/security-medium.test.ts`**
  - Tái hiện: `PUT /files` thiếu `expectedSha256` và không có `force: true` trả về 400.
  - Tái hiện: Mode (permissions) của file gốc được bảo toàn sau khi ghi.
- [ ] **Step 2: Triển khai trong `src/ide-fs.ts` và `src/server.ts`**
- [ ] **Step 3: Chạy test và thực hiện Commit 2**
  - Command: `node --test --test-timeout=60000 tests/security-medium.test.ts`
  - Command: `npm run check`
  - Commit: `git commit -am "fix(security): add api token auth, queue symlink check, put files safety, and dos limits"`

---

## Kế Hoạch Triển Khai Commit 3 (LOW: Mục 8 - 12)
**Commit Message:** `fix(security): harden folder picker, validate runId, add secret files, and fix highlighter provenance`

### Task 3.1: Gia Cố Hộp Thoại Chọn Thư Mục `/fs/pick-folder` (Mục 8)
- **Vấn đề:** Người dùng có thể spam click tạo hàng chục process powershell dialog; gọi `powershell` tương đối có nguy cơ DLL/binary hijacking nếu có file `powershell.exe` trong thư mục hiện hành.
- **Giải pháp:**
  - Thêm cờ mutex `isPickerActive: boolean`. Nếu một dialog đang mở, trả về mã 409 Conflict.
  - Sử dụng đường dẫn tuyệt đối cho powershell: `path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")`.
- [ ] **Step 1: Viết test trong `tests/security-low.test.ts`**
  - Tái hiện: Gọi đồng thời 2 request `/fs/pick-folder` thì request thứ 2 bị từ chối với mã 409.
- [ ] **Step 2: Triển khai trong `src/server.ts` và `src/fs-browse.ts`**

### Task 3.2: Xác Thực UUID Cho `runId` & Kiểm Tra Tiền Tố Shadow File (Mục 9)
- **Vấn đề:** `runId` truyền qua query params `/changes` và `/diff` nếu chứa ký tự đặc biệt hoặc `../` có nguy cơ traversal trong thư mục shadow.
- **Giải pháp:**
  - Bắt buộc `runId` phải khớp regex UUID: `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`. Nếu không khớp, trả về lỗi 400.
  - Trong `src/shadow.ts`: hàm `getShadowFileContent` xác thực đường dẫn file thực sự nằm bên trong tiền tố `<workspace>/.company/shadow/<runId>/`.
- [ ] **Step 1: Viết test trong `tests/security-low.test.ts`**
  - Tái hiện: Truy vấn `/changes?runId=../test` trả về 400 Bad Request.
- [ ] **Step 2: Triển khai trong `src/server.ts` và `src/shadow.ts`**

### Task 3.3: Chống Symlink và Race Condition Trong `captureShadow` (Mục 10)
- **Vấn đề:** Nếu target file là symlink, `captureShadow` copy xuyên qua symlink; nhiều tool calls đồng thời có thể ghi đè hỏng file `.manifest.json`.
- **Giải pháp:**
  - Kiểm tra `lstatSync`: nếu target file là symlink, bỏ qua không chụp nội dung (chỉ ghi nhận metadata nếu an toàn).
  - Sử dụng hàng đợi/mutex bất đồng bộ khi cập nhật `.manifest.json`.
- [ ] **Step 1: Viết test trong `tests/security-low.test.ts`**
  - Tái hiện: File là symlink thì `captureShadow` không copy xuyên symlink.
  - Tái hiện: Gọi `captureShadow` đồng thời 5 lần cho các file khác nhau không làm hỏng `.manifest.json`.
- [ ] **Step 2: Triển khai trong `src/shadow.ts`**

### Task 3.4: Bổ Sung Danh Sách File Bí Mật (Mục 11)
- **Vấn đề:** Danh sách file bí mật hiện thời chưa bao quát các file cấu hình nhạy cảm phổ biến: `.npmrc`, `.netrc`, `.git-credentials`, `.pypirc`, `credentials.json`, `.kube` (hoặc `.kube/config`).
- **Giải pháp:**
  - Bổ sung các mẫu tên file trên vào đồng thời cả `isSecretPath` trong `src/ide-fs.ts` và hàm `secret()` trong `src/guard.ts`.
- [ ] **Step 1: Viết test trong `tests/security-low.test.ts`**
  - Tái hiện: `assertSafeWorkspacePath` và `checkToolCall` chặn truy cập `.npmrc`, `.git-credentials`, `.pypirc`, `.kube/config`, `credentials.json`.
- [ ] **Step 2: Triển khai trong `src/ide-fs.ts` và `src/guard.ts`**

### Task 3.5: Cập Nhật Provenance Thư Viện Tô Màu & `THIRD_PARTY_NOTICES.md` (Mục 12)
- **Vấn đề:** File tô màu cú pháp cần minh bạch nguồn gốc bản quyền theo giấy phép MIT.
- **Giải pháp:**
  - Chuẩn hoá module tô màu nội bộ thành `ui/js/ide/highlight.js` (hoặc giữ Prism 1.29.0 nguyên bản đã kiểm chứng).
  - Cập nhật chi tiết mục `ui/vendor/prism.js` hoặc `ui/js/ide/highlight.js` trong `THIRD_PARTY_NOTICES.md` với đầy đủ thông tin: version, license MIT, copyright notice Lea Verou & Prism contributors.
- [ ] **Step 1: Kiểm tra file `THIRD_PARTY_NOTICES.md` và mã nguồn highlighter**
- [ ] **Step 2: Cập nhật tài liệu và kiểm tra đóng gói**
  - Command: `node scripts/pack-check.mjs`
- [ ] **Step 3: Chạy test và thực hiện Commit 3**
  - Command: `node --test --test-timeout=60000 tests/security-low.test.ts`
  - Command: `npm run check`
  - Commit: `git commit -am "fix(security): harden folder picker, validate runId, add secret files, and fix highlighter provenance"`

---

## Bảng Đối Soát Nghiệm Thu 12 Mục Chi Tiết Cho Reviewer

Reviewer sẽ đối soát từng mục dựa trên bảng ánh xạ tệp nguồn và bài test cụ thể:

| STT | Lỗ hổng | Tệp & Hàm sửa đổi | Bài test kiểm chứng (`node:test`) | Tiêu chí đạt |
|---|---|---|---|---|
| **1** | Alternate Data Streams & Short Names | `src/ide-fs.ts:isSecretPath`, `src/guard.ts:secret` | `tests/security-high.test.ts`: *"NTFS alternate data streams and short names blocked"* | 100% path chứa `:`, trailing space/dot, `~\d` bị chặn 403 |
| **2** | Symlink / Junction Jail Escape | `src/ide-fs.ts:assertSafeWorkspacePath`, `src/guard.ts:within` | `tests/security-high.test.ts`: *"Symlink to sensitive targets rejected"* | Không đọc/ghi xuyên symlink trỏ vào `.git`, `.company` hay bí mật |
| **3a** | Untrusted Queue in Cloned Repo | `src/workspace.ts:getQueue/enqueue`, `src/router.ts` | `tests/security-high.test.ts`: *"Untrusted queue items without local HMAC not auto-run"* | Mục queue không có HMAC hợp lệ bị chặn tự chạy, text > 20KB bị từ chối |
| **3b** | Symlink Attack on Shadow Quota | `src/shadow.ts:enforceShadowQuota` | `tests/security-high.test.ts`: *"Shadow symlinks rejected, quota only deletes valid run directories"* | Không bao giờ xoá xuyên qua symlink ra ngoài thư mục shadow |
| **4** | Symlink Overwrite on `queue.json` | `src/workspace.ts:enqueue/dequeue` | `tests/security-medium.test.ts`: *"Queue file refuses symlink and writes atomically"* | Ghi atomic qua file tạm, ném lỗi nếu `queue.json` là symlink |
| **5** | Local API Missing Token & SSRF | `src/server.ts:handle`, `src/guard.ts:checkToolCall` | `tests/security-medium.test.ts`: *"API requires x-company-token and guard blocks local SSRF"* | API từ chối nếu thiếu token; role shell không thể curl localhost/port app |
| **6** | DoS: File Size, Tree Cap & Diff D Limit | `src/server.ts:/diff`, `src/ide-fs.ts:listWorkspaceTree`, `src/diff.ts` | `tests/security-medium.test.ts`: *"Diff caps 2MB/binary, tree caps 5000, Myers caps D 2000"* | Trả về mã lỗi hoặc `truncated: true`, không treo tiến trình |
| **7** | Safe File Save (`PUT /files`) | `src/ide-fs.ts:saveWorkspaceFile`, `src/server.ts` | `tests/security-medium.test.ts`: *"PUT files requires expectedSha256 and preserves original permissions"* | Trả về 400 nếu thiếu sha256 (khi không force), giữ nguyên mode file gốc |
| **8** | Folder Picker Mutex & Full Path | `src/server.ts`, `src/fs-browse.ts:pickNativeFolder` | `tests/security-low.test.ts`: *"Folder picker enforces single-dialog mutex and uses full path"* | Request thứ hai bị từ chối 409; powershell gọi đường dẫn tuyệt đối SystemRoot |
| **9** | UUID Validation for `runId` | `src/server.ts`, `src/shadow.ts:getShadowFileContent` | `tests/security-low.test.ts`: *"runId strictly validated as UUID with prefix check"* | `runId` không đúng UUID bị từ chối 400 |
| **10** | Safe Shadow Capture (No Symlinks) | `src/shadow.ts:captureShadow` | `tests/security-low.test.ts`: *"captureShadow skips symlinks and safely writes manifest"* | Không sao lưu xuyên symlink; không race condition manifest |
| **11** | Expanded Secret File Blocklist | `src/ide-fs.ts:isSecretPath`, `src/guard.ts:secret` | `tests/security-low.test.ts`: *"Blocks .npmrc, .netrc, .git-credentials, .pypirc, credentials.json, .kube"* | Tất cả các file trong danh sách đều bị chặn 403 |
| **12** | Highlighter Provenance & License Notice | `THIRD_PARTY_NOTICES.md`, `ui/` | `tests/security-low.test.ts`: *"License notices and provenance verified"* | `pack-check` và kiểm tra bản quyền đạt 100% |

---

## Kế Hoạch Kiểm Tra & Điều Kiện Phát Hành (Final Verification)
1. **Kiểm thử tự động:**
   ```bash
   node --test --test-timeout=60000 "tests/**/*.test.ts"
   ```
2. **Kiểm tra kiểu dữ liệu TypeScript:**
   ```bash
   npm run check
   ```
3. **Kiểm tra đóng gói & Giấy phép bản quyền:**
   ```bash
   node scripts/pack-check.mjs
   ```
4. **Quy tắc cam kết:**
   - Tuyệt đối không publish gói lên npm.
   - Tuyệt đối không push lên remote git repo.
   - Tuyệt đối không chạy tiến trình server ngầm dài hạn trong bash.
