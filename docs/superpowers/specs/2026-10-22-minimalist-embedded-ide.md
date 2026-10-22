# Agent Company — Minimalist Embedded IDE Specification & Architecture

Date: 2026-10-22 · Status: Approved / Ready for Implementation · Author: Software Architect (incorporating Critic reviews)

---

## 1. Triết lý Thiết kế & Tầm nhìn Cốt lõi (Design Philosophy & Vision)

Bản đặc tả này định hình kiến trúc kỹ thuật để bổ sung một **IDE nhúng tối giản (Minimalist Embedded IDE)** cho **Agent Company**. Hệ thống giúp người dùng có thể duyệt cây mã nguồn, đọc/sửa file, theo dõi thay đổi (Diff) do AI thực hiện và kiểm tra lệnh chạy trực tiếp mà không phải liên tục chuyển đổi sang VS Code ngoài máy tính.

### 5 Nguyên tắc Tối thượng:
1. **Developer-First & Agent-Centric**: Lấy mã nguồn và hiệu quả cộng tác làm trung tâm, nhưng vẫn bảo tồn nét độc đáo của văn phòng pixel art.
2. **Zero-Build & Ultra-Lightweight**: Không dùng bundler (Webpack, Vite), không framework nặng. 100% Vanilla HTML5, CSS3 hiện đại, ES Modules native. Thư viện siêu nhẹ (CodeJar + PrismJS) được vendor trực tiếp vào `ui/vendor/`.
3. **Chuẩn hóa màn hình 1366 × 768px**: Thiết kế tối ưu cho laptop phổ thông, bố trí các panel linh hoạt, không bị vỡ hoặc ép chật giao diện.
4. **Bảo mật tuyệt đối (Workspace Jail & Guard Integration)**: Kế thừa và tái sử dụng 100% quy tắc an ninh từ `src/guard.ts`. Ngăn chặn hoàn toàn path traversal, symlink escape, và rò rỉ secret credentials.
5. **Tối giản có chủ đích (Intentional Minimalism)**: Kiên quyết loại bỏ terminal tương tác PTY, debugger, LSP và extension store để giữ app siêu nhẹ, ổn định và bảo mật.

---

## 2. Bố cục Không gian 4 Vùng (Spatial Layout Architecture)

### 2.1 Sơ đồ Bố cục Tổng thể

```
┌────┬───────────────┬──────────────────────────────────────────┬────────────────────────┐
│    │ TOPBAR: Brand | Workspace Menu | Run Selector | Office Toggle | Quick Actions         │
├────┼───────────────┼──────────────────────────────────────────┼────────────────────────┤
│ A  │ EXPLORER /    │ EDITOR TABS: [🏢 Văn phòng 📌] [📄 app.js] [📄 styles.css ×]      │
│ C  │ RUNS & DIFF   ├──────────────────────────────────────────┤ CHAT MANAGER           │
│ T  │ (Resizable)   │                                          │ (340px)                │
│ I  │               │              CODE EDITOR AREA            │                        │
│ V  │ 240px         │                                          │ - Luồng giao việc      │
│ I  │ (180 - 360px) │  - Line numbers                          │ - Thẻ duyệt (Approval) │
│ T  │               │  - Syntax highlight (PrismJS)            │ - Báo cáo tiến độ      │
│ Y  │ - Tree view   │  - Conflict banner (409)                 │ - Ô nhập chỉ đạo       │
│    │ - Lazy load   │  - Auto-save / Ctrl+S                    │                        │
│ B  │ - File badges ├──────────────────────────────────────────┤                        │
│ A  │   (M, A)      │ BOTTOM PANEL: [Lệnh đã chạy] [Kết quả test] (160px - 220px)      │
│ R  │               │ - Readonly log các lệnh role vừa chạy (bash/powershell)           │
│48px│ [Ctrl+B]      │ - Kết quả test runner tự động                                     │
└────┴───────────────┴───────────────────────────────────────────────────────────────────┘
```

### 2.2 Phân bổ Kích thước & Khả năng Hiển thị trên Màn hình 1366px

Chuẩn màn hình laptop $1366 \times 768\text{px}$ có chiều cao hiển thị hữu dụng khoảng $\sim 650\text{px}$ (sau khi trừ thanh taskbar hệ điều hành và topbar app). Phân bổ kích thước chi tiết:

| Phân vùng | Chiều rộng / Chiều cao | Hành vi Resizable | Cơ chế Đóng/Mở & Phím tắt |
| :--- | :--- | :--- | :--- |
| **Activity Bar** | **48px** cố định | Không | Luôn hiển thị dọc mép trái |
| **Sidebar (Explorer / Runs)** | **240px** | 180px – 360px | Phím tắt **`Ctrl+B`** hoặc click icon trên Activity Bar |
| **Editor trung tâm** | **738px** *(khi mở hết)* | Co giãn theo viewport | Mở rộng lên **978px** khi đóng Explorer, và **1318px** khi đóng cả Chat |
| **Chat Manager (Phải)** | **340px** | 300px – 420px | Nút thu gọn trên Topbar hoặc phím tắt `Ctrl+J` |
| **Bottom Panel (Dưới)** | Chiều cao **180px** | 120px – 320px | Nút chevron góc panel hoặc kéo splitter xuống đáy |

> **Khả năng hiển thị Code ở màn hình 1366px**:
> Với chiều rộng 738px của Editor, font chữ monospace kích thước `13px` (khoảng `7.8px` mỗi ký tự), vùng hiển thị code đạt **khoảng 90 – 95 ký tự trên một dòng** trước khi cần soft-wrap. Đây là chuẩn mực tối ưu cho hầu hết ngôn ngữ lập trình phổ biến (PEP 8, ESLint 80-100 ký tự).

### 2.3 Vị trí Văn phòng Pixel: Pinned Tab thay vì Split View trên 1366px
- **Phản biện kiến trúc (Critic Finding)**: Màn hình 1366 × 768px có chiều cao rất hạn chế. Nếu chia đôi (Split View) chiều dọc hoặc chiều ngang, vùng Editor và vùng Văn phòng đều chỉ còn $\sim 250\text{px}$ chiều cao, khiến cả hai bị biến dạng và không thể làm việc hiệu quả.
- **Quyết định chuẩn**:
  1. **Tab Cố định (Pinned Tab)**: Tab "🏢 Văn phòng" luôn là tab đầu tiên, cố định ở góc trái thanh Tab Editor.
  2. Khi chọn tab "🏢 Văn phòng": Vùng trung tâm chuyển sang hiển thị toàn cảnh văn phòng 2D pixel với đầy đủ bàn ghế, nhân viên và hoạt ảnh đi lại.
  3. Khi click vào bất kỳ file nào trong Explorer: Tab file được kích hoạt, vùng trung tâm hiển thị Code Editor.
  4. **Phím tắt chuyển đổi tức thì**: **`Alt+O`** giúp chuyển đổi qua lại giữa Văn phòng và File code đang sửa mà không cần click chuột.

---

## 3. Thiết kế Explorer (Cây Thư mục, Lazy Load & File Badges)

### 3.1 Cơ chế Tải lười (Lazy Loading `depth=1`)
- Khi người dùng mở một workspace, client gọi `GET /workspaces/:id/tree?path=.&depth=1` để chỉ lấy danh sách các file và thư mục con trực tiếp ở cấp gốc (root).
- Cây thư mục hiển thị icon mũi tên `▸` đối với thư mục.
- Khi người dùng nhấp mở một thư mục:
  - Client gọi `GET /workspaces/:id/tree?path=<subpath>&depth=1`.
  - Client lưu cache danh sách con. Việc đóng/mở lại sau đó diễn ra tức thì không tốn network call.

### 3.2 Danh sách Thư mục Ẩn Mở rộng & Hỗ trợ `.gitignore`
Nhằm tránh làm ô nhiễm cây thư mục và bảo vệ hiệu năng máy:
- **Danh sách tự động ẩn mở rộng**:
  - Thư mục hệ thống & điều phối: `.git/`, `.company/`, `.svn/`, `.hg/`.
  - Thư mục phụ thuộc: `node_modules/`, `vendor/`.
  - Thư mục build & artifacts: `dist/`, `build/`, `out/`, `.next/`, `.nuxt/`, `.turbo/`, `.cache/`, `coverage/`.
  - File rác hệ điều hành: `.DS_Store`, `Thumbs.db`.
- **Hỗ trợ `.gitignore`**:
  - Backend đọc file `.gitignore` ở thư mục gốc (nếu có). Các file khớp quy tắc ignore sẽ được gắn cờ `{ ignored: true }`.
  - Trên giao diện: File ignored hiển thị mờ hơn (`opacity: 0.45`) hoặc có nút toggle "Ẩn file ignored" ở đầu thanh công cụ Explorer.

### 3.3 Huy hiệu Trạng thái File (File Badges `A` / `M`)
- **Nguồn dữ liệu**: Client trích xuất lịch sử các sự kiện `tool_call` trong lần chạy hiện tại (hoặc Run đang xem lại) từ state:
  - Nếu role gọi công cụ `write` trên file mới: Đánh dấu badge **`A`** (Added - Xanh lá `#10b981`).
  - Nếu role gọi công cụ `edit` hoặc `write` đè: Đánh dấu badge **`M`** (Modified - Vàng cam `#f59e0b`).
- **Lan truyền huy hiệu (Bubble-up)**: Nếu file bị sửa nằm sâu trong thư mục đang đóng, thư mục cha hiển thị một chấm tròn nhỏ màu cam/xanh để người dùng dễ dàng phát hiện.

---

## 4. Công nghệ Code Editor & An toàn Lưu file (Ctrl+S)

### 4.1 Đề xuất Công nghệ: CodeJar + PrismJS với IME Guard & Fallback
So sánh với các giải pháp khác, CodeJar + PrismJS là lựa chọn hoàn hảo nhất cho ứng dụng web không có bước build (Zero-Build Vanilla ESM):
- Dung lượng siêu nhẹ: CodeJar ($\sim 2.5\text{ KB}$) + PrismJS core & grammars ($\sim 20\text{ KB}$).
- Hỗ trợ đầy đủ: Highlight cú pháp (JS, TS, HTML, CSS, JSON, MD, Python, Shell), thụt dòng Tab tự động, auto-close brackets, Undo/Redo.

#### ⚠️ Cải tiến Trọng yếu từ Critic: IME Guard (`isComposing`)
Khi người dùng gõ tiếng Việt bằng bộ gõ Unikey / Telex / VNI trên phần tử `contenteditable`, việc PrismJS re-highlight và can thiệp vào selection ở mỗi sự kiện `input` sẽ làm **gãy ký tự gõ dở, mất dấu hoặc sinh lỗi lặp từ** (ví dụ gõ "tiếng" biến thành "tieeesng").
**Giải pháp kiến trúc bắt buộc**:
```javascript
let isComposing = false;
editorElement.addEventListener("compositionstart", () => { isComposing = true; });
editorElement.addEventListener("compositionend", () => {
  isComposing = false;
  jar.highlight(); // Chỉ highlight khi đã kết thúc gõ từ tiếng Việt
});
// Trong hàm input listener của CodeJar:
if (!isComposing) {
  highlight();
}
```

#### Fallback Graceful Degradation (`<textarea>`)
Nếu trình duyệt của người dùng gặp lỗi rendering `contenteditable` hoặc tắt script, hệ thống tự động fallback về thẻ `<textarea class="code-fallback">` chuẩn với font monospace và tab-indentation thủ công, đảm bảo không bao giờ làm gián đoạn việc xem và sửa code.

### 4.2 Lưu file (Ctrl+S) & Cơ chế Phát hiện Xung đột (409 Conflict)
Khi cả người dùng và AI role đều có quyền sửa file trên đĩa:
1. **Lúc đọc file (`GET /files`)**: Server trả về nội dung kèm `sha256` và `mtime`.
2. **Lúc lưu file (`PUT /files`)**: Client gửi kèm `expectedSha256` (hoặc header `If-Match`).
3. **Kiểm tra Concurrency**: Server đọc hash file hiện tại trên đĩa.
   - Nếu `currentSha256 === expectedSha256`: Ghi file an toàn (atomic write) và trả về `200 OK`.
   - Nếu `currentSha256 !== expectedSha256` (do AI vừa gọi `edit`/`write` trước đó vài giây):
     Server trả về **`409 Conflict`** kèm `diskContent` mới nhất.
4. **Xử lý UI**: Editor lập tức hiển thị Banner cảnh báo xung đột màu vàng:
   ```
   ⚠️ XUNG ĐỘT GHI ĐÈ: File này vừa được sửa bởi AI Developer cách đây ít giây.
   [ Xem so sánh (Diff) ]    [ Nạp lại từ đĩa ]    [ Ghi đè bản của tôi ]
   ```

### 4.3 Giới hạn File & Chặn File Bí mật theo `guard.ts`
- **File nhị phân**: Kiểm tra 512 byte đầu tiên, nếu có byte null (`0x00`), từ chối render văn bản và thông báo: *"File nhị phân (.png, .zip, .exe...). Không hỗ trợ sửa văn bản."*
- **File lớn (> 2MB)**: Trả về mã `413 Payload Too Large` hoặc hiển thị cảnh báo: *"File vượt quá 2MB. Vui lòng mở bằng editor bên ngoài để tránh treo trình duyệt."*
- **Chặn file bí mật (`guard.ts`)**:
  - Chặn tuyệt đối: `.env*` (trừ `.env.example`, `.env.sample`, `.env.template`), `*.pem`, `*.key`, `*.pfx`, `id_rsa*`, `id_ed25519*`, `.ssh/`, `.aws/`, `.claude/`, `.company/`.
  - Trên UI Explorer: Hiển thị biểu tượng ổ khóa `🔒`. Khi click vào, server trả về `403 Forbidden` và UI hiển thị thông báo an ninh: *"File cấu hình nhạy cảm được bảo vệ bởi guard.ts"*.

---

## 5. Xem Thay đổi (Diff Viewer, Git & Shadow Backup)

### 5.1 Danh sách File thay đổi theo Câu hỏi / Lần chạy
Tại thanh bên, ngoài tab Explorer, có tab **Lần chạy & Thay đổi**:
- Liệt kê theo từng Run (ví dụ: *"Run #3: Sửa lỗi routing"*).
- Bên dưới là danh sách các file đã được AI chỉnh sửa trong Run đó.
- Nhấp vào file sẽ mở tab **Diff Viewer** tương ứng.

### 5.2 Cơ chế Diff: Git Engine vs Non-Git Shadow Backup Engine

```
                             ┌──────────────────────────────┐
                             │ File yêu cầu xem thay đổi    │
                             └──────────────┬───────────────┘
                                            │
                     ┌──────────────────────┴──────────────────────┐
                     ▼                                             ▼
            [ Workspace có .git ]                        [ Workspace không có Git ]
        Gọi `git diff` an toàn qua:               So sánh file hiện tại với snapshot:
        `git diff --no-color -- <file>`           `.company/shadow/<runId>/<file>`
                     │                            bằng Myers Diff thuần TypeScript.
                     └──────────────────────┬──────────────────────┘
                                            │
                                            ▼
                           Hiển thị giao diện Inline / Split Diff
```

#### A. Với Workspace có Git
- Thực thi `git diff --no-color -- <path>` thông qua `node:child_process.execFile`.
- Thiết lập giới hạn: timeout $5\text{s}$, maxBuffer $2\text{ MB}$.

#### B. Với Workspace không có Git (Shadow Backup Engine) & Critic Guardrails
Đối với các project chưa khởi tạo Git:
- **Thời điểm tạo bản sao lưu**: Trước khi công cụ `write` hoặc `edit` của AI (hoặc `PUT` của User) ghi đè file, server sao chép nội dung gốc vào `<workspace>/.company/shadow/<runId>/<relativePath>`.
- **Cải tiến & Rào chắn An toàn từ Critic (Critic Guardrails)**:
  1. **Cap kích thước file shadow**: Chỉ tạo shadow backup cho file có kích thước $\le 256\text{ KB}$. Bỏ qua các file quá lớn để tránh nghẽn đĩa.
  2. **Giới hạn tổng dung lượng cache**: Thư mục `.company/shadow/` được giới hạn tối đa **$20\text{ MB}$**. Server tự động dọn dẹp các snapshot cũ nhất theo cơ chế LRU khi vượt quá ngưỡng.
  3. **Myers Diff Guardrails**: Thuật toán Myers Diff thuần TS giới hạn so sánh tối đa **$10.000$ dòng code**. Nếu vượt quá, trả về thông báo tóm tắt để tránh làm treo CPU Node.js.

### 5.3 Giao diện Hiển thị Diff
- Tích hợp trực tiếp dưới dạng Tab trong Editor: `[ 🔀 Diff: app.js × ]`.
- Định dạng **Inline Diff**: Các dòng xóa hiển thị nền đỏ nhạt `-` kèm số dòng cũ; các dòng thêm mới hiển thị nền xanh lá nhạt `+` kèm số dòng mới. Thân thiện và dễ đọc trên màn hình laptop 1366px.

---

## 6. Kiến trúc API Server Mới & Phân tích Rủi ro Bảo mật

### 6.1 Bảng Đặc tả Các Endpoints Mới

| Method & Endpoint | Tham số / Body | Mục đích | Mã phản hồi |
| :--- | :--- | :--- | :--- |
| `GET /workspaces/:id/tree` | `?path=.&depth=1` | Lấy danh sách cây thư mục con cấp 1 (lazy load) | `200` danh sách nodes, `403` cấm, `404` không thấy |
| `GET /workspaces/:id/files` | `?path=src/app.js` | Đọc nội dung file, lấy `sha256`, `mtime`, `size` | `200` nội dung file, `403` secret, `413` file > 2MB |
| `PUT /workspaces/:id/files` | `?path=src/app.js`<br>`{ content, expectedSha256 }` | Ghi file an toàn atomic, kiểm tra xung đột | `200` thành công, `409` conflict, `403` cấm ghi |
| `GET /workspaces/:id/diff` | `?path=...&runId=...` | Lấy patch diff giữa bản hiện tại và bản trước | `200` unified diff format, `404` không thấy |

### 6.2 Bảo mật `assertSafeWorkspacePath` (Kiểm tra Realpath Ancestor)
- **Rủi ro lớn nhất**: Kẻ tấn công dùng path traversal (`../../etc/passwd`) hoặc tạo symlink trỏ ra ngoài workspace root.
- **Critic Improvement - Xử lý File Mới Tạo**: Khi người dùng hoặc AI tạo một file chưa từng tồn tại, hàm `realpathSync(fullPath)` sẽ văng lỗi `ENOENT`. Kẻ tấn công có thể lợi dụng tạo symlink ở thư mục cha để thoát khỏi sandbox.
- **Hàm thẩm định chuẩn**:
```typescript
export function assertSafeWorkspacePath(workspacePath: string, subpath: string): string {
  // 1. Chuẩn hóa đường dẫn
  const resolved = path.resolve(workspacePath, subpath);
  const root = path.resolve(workspacePath);
  
  // 2. Chống Path Traversal cơ bản
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new HttpError(403, "Access denied: Path escapes workspace root");
  }
  
  // 3. Kiểm tra symlink escape cho cả file tồn tại và file mới tạo
  let checkPath = resolved;
  while (!existsSync(checkPath) && checkPath !== root) {
    checkPath = path.dirname(checkPath); // Lùi dần về thư mục cha gần nhất đang tồn tại
  }
  const realAncestor = realpathSync(checkPath);
  const realRoot = realpathSync(root);
  if (!realAncestor.startsWith(realRoot + path.sep) && realAncestor !== realRoot) {
    throw new HttpError(403, "Access denied: Symlink resolves outside workspace root");
  }

  // 4. Kiểm tra file bí mật theo quy tắc guard.ts
  if (isSecretPath(resolved, workspacePath)) {
    throw new HttpError(403, "Access denied: File or directory is protected by security guard");
  }

  return resolved;
}
```

### 6.3 Ma trận Đe dọa An ninh (Security Threat Matrix)

| Rủi ro An ninh | Vector Tấn công | Giải pháp Ngăn chặn Triệt để |
| :--- | :--- | :--- |
| **Path Traversal** | Truy vấn `?path=../../Windows/win.ini` | `path.resolve` và so sánh tiền tố với Workspace Root. |
| **Symlink Escape** | Tạo symlink `link -> C:/Users/Keys` rồi truy vấn qua link | `assertSafeWorkspacePath` đệ quy tìm realpath của ancestor, chặn đứng nếu link trỏ ra ngoài. |
| **Rò rỉ Secret / Keys** | Xem file `.env`, `id_rsa`, `.aws/credentials` | Tích hợp trực tiếp danh sách đen của `guard.ts`. Bất kỳ path nào trùng khớp đều bị từ chối `403`. |
| **Can thiệp .company/** | Sửa trực tiếp file cấu hình orchestrator và sessions | Mọi truy cập vào phân vùng `.company/` đều bị chặn, ngoại trừ API nội bộ của server. |
| **DNS Rebinding & CSRF** | Trang web độc hại từ trình duyệt gửi request tới `127.0.0.1:4317` | Kế thừa cơ chế kiểm tra `Host` và `Origin` header nghiêm ngặt có sẵn trong `server.ts`. |
| **Cạn kiệt Bộ nhớ (DoS)** | Đọc file video/binary 500MB làm tràn RAM | Kiểm tra `stat.size > 2MB` từ chối đọc ngay từ đầu, kiểm tra null-byte chặn file nhị phân. |

---

## 7. Phân chia 4 Giai đoạn Triển khai Chi tiết

Hệ thống được chia làm 4 giai đoạn độc lập, có thể nghiệm thu và sử dụng được ngay sau mỗi giai đoạn:

### Giai đoạn 1: Layout IDE + Explorer Cây Thư mục + Xem File (Read-Only)
- **Mục tiêu**: Bổ sung tab IDE vào Agent Company, cho phép duyệt cây file và đọc mã nguồn an toàn.
- **File sửa / tạo mới**:
  - Backend: `src/ide-fs.ts` (mới), `src/server.ts` (bổ sung routes `/tree`, `/files`).
  - Frontend: `ui/index.html` (thêm tab IDE), `ui/styles.css` (layout styles), `ui/js/ide/tree.js` (mới), `ui/js/ide/viewer.js` (mới), `ui/js/api.js` (gọi api tree/file).
- **Unit Tests (`node:test`)**:
  - `tests/ide-fs.test.ts`: Test `listWorkspaceTree` lazy loading, test `assertSafeWorkspacePath` chặn path traversal và symlink escape, test chặn file `.env`.
  - `tests/server-ide.test.ts`: Test HTTP endpoint trả về đúng cấu trúc JSON, trả về `403` khi truy cập file cấm, `413` khi file > 2MB.
- **Tiêu chí Hoàn thành (DoD)**:
  1. Click tab "IDE" mở ra bố cục 4 vùng chuẩn.
  2. Cây thư mục lazy load cấp 1, mở thư mục con mượt mà, tự động ẩn `.git`, `node_modules`, `.company`.
  3. Nhấp vào file mở tab xem nội dung code có đánh số dòng và highlight.
  4. File bí mật hiển thị biểu tượng ổ khóa và không thể mở.

### Giai đoạn 2: Sửa & Lưu File (Ctrl+S) + Phát hiện Xung đột + Guard
- **Mục tiêu**: Chỉnh sửa trực tiếp file code với CodeJar + PrismJS, lưu đĩa an toàn, chống ghi đè khi AI đang làm việc.
- **File sửa / tạo mới**:
  - Backend: `src/ide-fs.ts` (thêm `writeWorkspaceFile`), `src/server.ts` (bổ sung route `PUT /files`).
  - Frontend: `ui/vendor/codejar.js` (vendor), `ui/vendor/prism.js` (vendor), `ui/js/ide/editor.js` (mới), `ui/js/ide/conflict-dialog.js` (mới).
- **Unit Tests (`node:test`)**:
  - `tests/ide-write.test.ts`: Test ghi file thành công, test `409 Conflict` khi `expectedSha256` không khớp, test chặn ghi vào file nhạy cảm.
- **Tiêu chí Hoàn thành (DoD)**:
  1. Gõ code mượt mà, hỗ trợ IME tiếng Việt không bị lỗi gãy chữ nhờ `isComposing`.
  2. Bấm `Ctrl+S` lưu file vào đĩa an toàn (atomic write).
  3. Nếu AI role vừa chỉnh sửa file, việc lưu sẽ kích hoạt banner cảnh báo xung đột `409` để người dùng chủ động lựa chọn cách giải quyết.

### Giai đoạn 3: Theo dõi Thay đổi (Diff Viewer Git / Shadow Backup)
- **Mục tiêu**: Cung cấp giao diện trực quan so sánh những dòng code đã được AI thêm bớt theo từng lượt chạy.
- **File sửa / tạo mới**:
  - Backend: `src/ide-diff.ts` (mới), `src/server.ts` (bổ sung route `GET /diff`).
  - Frontend: `ui/js/ide/diff-viewer.js` (mới), `ui/js/ide/runs-panel.js` (mới).
- **Unit Tests (`node:test`)**:
  - `tests/ide-diff.test.ts`: Test git diff trên repo git; test shadow backup và thuật toán Myers diff trên thư mục non-git; test giới hạn dung lượng 20MB và cap 256KB/file.
- **Tiêu chí Hoàn thành (DoD)**:
  1. Tab "Lần chạy & Thay đổi" liệt kê đầy đủ danh sách file bị sửa kèm badge `+N / -M`.
  2. Bấm vào file mở ra giao diện Inline Diff xanh đỏ rõ ràng.
  3. Hoạt động chính xác cho cả project có Git và project không có Git.

### Giai đoạn 4: Bottom Panel (Nhật ký Lệnh & Kết quả Test)
- **Mục tiêu**: Bảng điều khiển phía đáy hiển thị lệnh AI đang thực thi ngầm và tóm tắt kết quả kiểm thử.
- **File sửa / tạo mới**:
  - Frontend: `ui/js/ide/bottom-panel.js` (mới), `ui/js/app.js` (kết nối luồng SSE `tool_call`).
- **Unit Tests (`node:test`)**:
  - `tests/ui-ide-panel.test.ts`: Test parse output kết quả test, lọc lệnh bash/shell từ stream sự kiện.
- **Tiêu chí Hoàn thành (DoD)**:
  1. Bottom panel đóng mở và điều chỉnh độ cao mượt mà.
  2. Lệnh `bash` do AI thực hiện stream trực tiếp dòng lệnh và stdout/stderr dạng read-only.
  3. Tab kết quả test tóm tắt trực quan số lượng test pass/fail.

---

## 8. Những gì KHÔNG LÀM (Anti-Goals để Bảo vệ Tính Tối giản)

Để Agent Company luôn khởi động tức thì, chạy mượt mà và không trở thành bản sao cồng kềnh, kém hiệu quả của VS Code, hệ thống kiên quyết **LOẠI BỎ** các tính năng sau:

1. **KHÔNG nhúng Terminal Tương tác (Interactive PTY / xterm.js / node-pty)**:
   - Ứng dụng là môi trường điều phối đa agent tự động, không phải terminal console cá nhân. Bảng đáy chỉ là trình xem nhật ký một chiều (Read-Only Output Log). Người dùng muốn gõ lệnh tự do có thể mở terminal bên ngoài.
2. **KHÔNG làm Hệ sinh thái Extension / Plugin Marketplace**:
   - Không hỗ trợ cài plugin VS Code hay extension bên thứ ba. Giữ bộ code gọn nhẹ, dễ kiểm soát 100%.
3. **KHÔNG làm Trình gỡ lỗi Debugger (GDB / DAP / Breakpoints)**:
   - Không hỗ trợ đặt breakpoint, step over hay inspect biến. Việc kiểm thử và sửa lỗi là nhiệm vụ tự động của các role `developer` và `critic`.
4. **KHÔNG nhúng Language Server Protocol (LSP)**:
   - Không chạy daemons TypeScript language server ngầm trong browser. Trình soạn thảo tập trung vào đọc code, tô màu cú pháp nhanh và chỉnh sửa thiết yếu.
5. **KHÔNG làm Git GUI phức tạp**:
   - Không có giao diện 3-way merge, rebase, cherry-pick hay staging từng hunk. Chỉ tập trung vào xem Diff thay đổi của Agent.
6. **KHÔNG thêm bất kỳ thư viện NPM bên ngoài nào**:
   - Giữ nguyên `package.json`, tận dụng 100% module có sẵn của Node.js (`node:fs`, `node:path`, `node:crypto`, `node:child_process`).

---

## 9. Kết luận & Trạng thái Sẵn sàng Triển khai

Bản đặc tả kỹ thuật này đã hợp nhất đầy đủ các phát hiện và cải tiến của Critic:
- Giải quyết bài toán không gian 1366px bằng Pinned Tab Văn phòng.
- Bảo đảm trải nghiệm gõ tiếng Việt với IME Guard (`isComposing`).
- Thiết lập chốt chặn an ninh đa tầng với `assertSafeWorkspacePath` (kiểm tra realpath của ancestor) và bộ quy tắc từ `guard.ts`.
- Bảo vệ tài nguyên với cơ chế shadow backup cap 256KB/file, 20MB cache và Myers diff guardrails.

Tài liệu đã hoàn thiện 100% và sẵn sàng làm kim chỉ nam kỹ thuật cho toàn đội.
