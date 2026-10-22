# Agent Company — Minimalist IDE Transformation Architecture & UI/UX Design

Date: 2026-10-23 · Status: Proposed / Ready for Architecture Review · Author: ArchitectUX

---

## 1. Mục tiêu và Triết lý Thiết kế (Design Philosophy)

Mục tiêu của dự án là biến đổi **Agent Company** từ một giao diện dashboard theo dõi văn phòng sang một **IDE tối giản (Minimalist Agentic IDE)**. 

### Triết lý cốt lõi:
1. **Developer-First & Agent-Centric**: Lấy code và tiến độ dự án làm trung tâm, trong khi vẫn duy trì sự hiện diện sống động của đội ngũ nhân viên AI trong văn phòng pixel.
2. **Zero-Build & Ultra-Lightweight**: Không sử dụng bundler phức tạp (Webpack, Vite,...). Giao diện web chạy trực tiếp bằng Vanilla HTML5, CSS3 hiện đại, và ES Modules độc lập (có thể vendor thư viện siêu nhẹ vào `ui/vendor/`).
3. **Phù hợp chuẩn màn hình 1366px**: Đảm bảo toàn bộ các vùng làm việc hoạt động hài hòa, thoải mái trên độ phân giải phổ biến của laptop phổ thông (1366 × 768) mà không bị chật chội hay tràn viền.
4. **Tối giản có chủ đích (Intentional Minimalism)**: Kiên quyết nói "KHÔNG" với những tính năng nặng nề làm loãng trải nghiệm cốt lõi (không terminal tương tác PTY, không debugger, không LSP phức tạp).

---

## 2. Bố cục Không gian 4 Vùng (Spatial Layout Architecture)

### 2.1 Sơ đồ Bố cục Tổng thể

```
┌────┬───────────────┬──────────────────────────────────────────┬────────────────────────┐
│    │ TOPBAR: Brand | Workspace Menu | Run Selector | Office Toggle | Quick Actions         │
├────┼───────────────┼──────────────────────────────────────────┼────────────────────────┤
│ A  │ EXPLORER /    │ EDITOR TABS: [🏢 Văn phòng] [📄 app.js] [📄 styles.css ×]         │
│ C  │ RUNS & DIFF   ├──────────────────────────────────────────┤ CHAT MANAGER           │
│ T  │ (Resizable)   │                                          │ (320px - 360px)        │
│ I  │               │              CODE EDITOR AREA            │                        │
│ V  │ 220px - 280px │                                          │ - Luồng giao việc      │
│ I  │               │  - Line numbers                          │ - Thẻ phê duyệt (Card) │
│ T  │ - Tree view   │  - Syntax highlight                      │ - Báo cáo tiến độ      │
│ Y  │ - Lazy load   │  - Conflict banner (nếu có)              │ - Ô nhập lệnh          │
│    │ - File badges │  - Auto-save / Ctrl+S                    │                        │
│ B  │   (M, A)      ├──────────────────────────────────────────┤                        │
│ A  │               │ BOTTOM PANEL: [Lệnh đã chạy] [Kết quả test] [Diff] (160px - 220px)│
│ R  │               │ - Readonly log các lệnh role vừa chạy (bash/powershell)           │
│48px│               │ - Kết quả test runner tự động                                     │
└────┴───────────────┴───────────────────────────────────────────────────────────────────┘
```

### 2.2 Phân bổ Kích thước & Tối ưu cho Màn hình 1366px

Chuẩn màn hình laptop $1366 \times 768\text{px}$ có không gian ngang hạn chế. Phân bổ kích thước cụ thể như sau:

| Vùng (Panel) | Chiều rộng chuẩn | Phạm vi Resizable | Hành vi Thu gọn (Collapse) |
| :--- | :--- | :--- | :--- |
| **Activity Bar** | **48px** (cố định) | Không | Luôn hiển thị dọc theo mép trái |
| **Sidebar (Explorer / Changes)** | **240px** | 180px – 360px | Thu gọn về `0px` bằng phím tắt `Ctrl+B` hoặc click icon trên Activity Bar |
| **Editor trung tâm** | **718px** *(khi mở hết)* | Linh hoạt theo viewport | Tự động mở rộng lên **958px** khi ẩn Explorer, và **1318px** khi ẩn cả Chat |
| **Chat Manager (Phải)** | **340px** | 300px – 420px | Thu gọn về `0px` qua nút toggle trên topbar hoặc phím tắt `Ctrl+J` |
| **Bottom Panel (Dưới)** | Chiều cao **180px** | 120px – 380px | Thu gọn bằng nút Chevron hoặc kéo splitter xuống đáy |

> **Khả năng hiển thị Code ở màn hình 1366px**:
> Với chiều rộng 718px của Editor, font chữ monospace kích thước `13px` (khoảng `7.8px` mỗi ký tự), vùng hiển thị code đạt **khoảng 85 – 90 ký tự trên một dòng** trước khi cần soft-wrap hoặc cuộn ngang. Đây là chuẩn mực tối ưu cho hầu hết ngôn ngữ lập trình (PEP 8, standard JS 80-100 chars).

### 2.3 Cơ chế Kéo giãn (Splitter / Resize Handles)
- Giữa Sidebar và Editor: Một thanh phân cách `1px` với hit-box `8px` (`.resizer-x`).
- Giữa Editor và Bottom Panel: Một thanh phân cách ngang `1px` (`.resizer-y`).
- Giữa Editor và Chat Manager: Một thanh phân cách dọc `1px` (`.resizer-x`).
- Kèm double-click để reset về kích thước mặc định. Toàn bộ kích thước người dùng điều chỉnh được lưu trong `localStorage.getItem("ui-layout-sizes")`.

### 2.4 Vị trí và Cơ chế Hiển thị Văn phòng Pixel (Office Docking Strategy)
Người dùng vừa muốn tập trung code, vừa muốn ngắm nhìn nhân viên AI đi lại làm việc. Thiết kế đưa ra **giải pháp Docking linh hoạt (Dual-Mode)**:

1. **Chế độ Tab Cố định (Mặc định - Focus Mode)**:
   - "🏢 Văn phòng" là một Tab cố định (Pinned Tab) luôn nằm ở vị trí đầu tiên của thanh Tab Editor.
   - Khi click vào Tab "Văn phòng": Vùng trung tâm hiển thị toàn cảnh văn phòng pixel art với tỷ lệ scale sắc nét, các bàn làm việc và hoạt cảnh nhân vật.
   - Khi chuyển sang tab file (ví dụ `app.js`): Vùng trung tâm chuyển thành Code Editor.
2. **Chế độ Xem Song song (Split View Mode)**:
   - Trên Topbar và trên thanh tab có nút **"Chia đôi Văn phòng" (Split Office)**.
   - Khi kích hoạt: Văn phòng pixel thu nhỏ về một dải banner linh hoạt (chiều cao 220px) nằm ngay trên Code Editor hoặc gắn lên phía trên Bottom Panel.
   - Người dùng có thể vừa gõ code / xem diff ở dưới, vừa thấy nhân vật đi lại giao việc ở trên.
3. **Phím tắt chuyển nhanh**: `Alt+O` bật/tắt tức thì tab Văn phòng.

---

## 3. Thiết kế Chi tiết Explorer (File Tree & Lazy Loading)

### 3.1 Cấu trúc & Tương tác Cây Thư mục
- **Lazy Loading (Tải lười)**:
  - Khi khởi động, UI chỉ gọi `GET /fs/tree?path=.&depth=1` để lấy các thư mục và file ở cấp gốc (root).
  - Thư mục hiển thị icon mũi tên `▸` (đóng). Khi người dùng nhấp mở thư mục:
    + UI hiển thị icon xoay nhẹ (spinner chấm pixel) và gọi `GET /fs/tree?path=sub/dir&depth=1`.
    + Cache danh sách con tại client. Khi click đóng/mở lại, không cần gọi mạng nếu chưa có sự kiện sửa file trong thư mục đó.
- **Bộ lọc & Quy tắc Ẩn File tự động**:
  - Tự động ẩn: `.git/`, `node_modules/`, `.company/`, `.DS_Store`, `Thumbs.db`.
  - Hỗ trợ file `.gitignore`: Backend đọc file `.gitignore` ở thư mục gốc (dùng logic ignore đơn giản), các file bị ignore sẽ bị làm mờ (opacity: 0.45) hoặc có toggle "Ẩn file ignored" ở đầu Explorer.
- **Hệ thống Icon & Chỉ báo Trực quan**:
  - Icon thư mục: Thư mục đóng `📁`, thư mục mở `📂`.
  - Icon file: Phân biệt theo đuôi mở rộng: JS/TS (`🟨 js`, `🟦 ts`), HTML (`🟧 html`), CSS (`🎨 css`), JSON (`📦 json`), Markdown (`📝 md`), v.v.

### 3.2 Đánh dấu File đội vừa sửa trong Lần chạy (Run Modified Badges)
- **Cơ chế thu thập dữ liệu**:
  - Khi một lần chạy (Run) đang diễn ra hoặc khi người dùng chọn xem lại một Run trong lịch sử:
  - Client quét qua danh sách sự kiện `tool_call` của các role (các tool `write` và `edit`).
  - Trích xuất tập hợp các file bị thay đổi: `modifiedFiles = Set<string>`.
- **Hiển thị trên Tree**:
  - File mới được tạo (`tool === "write"` và file chưa từng tồn tại trước đó): Hiển thị chữ `A` (Added) màu xanh lá `#10b981`.
  - File bị chỉnh sửa (`edit` hoặc ghi đè): Hiển thị chữ `M` (Modified) màu cam hổ phách `#f59e0b`.
  - Cây thư mục cha tự động gắn một chấm màu cam/xanh để người dùng dễ dàng định vị file con đang nằm sâu trong các folder đóng.
  - Hover chuột vào badge: Hiện Tooltip rõ ràng: *"Được sửa bởi developer trong Run #12"*.

---

## 4. Nghiên cứu & Lựa chọn Công nghệ Code Editor

### 4.1 Bảng So sánh Các Giải pháp (Trong Ngữ cảnh Zero-Build Web App)

| Tiêu chí | Phương án A: Tự viết `<textarea>` + Highlight Overlay | Phương án B: Monaco Editor / CodeMirror 6 | Phương án C: CodeJar + PrismJS (ĐỀ XUẤT) |
| :--- | :--- | :--- | :--- |
| **Dung lượng (Bundle Size)** | Siêu nhẹ (~2 KB code) | Rất nặng: Monaco (~5 MB+), CodeMirror 6 (~300 KB nhiều package) | **Cực kỳ nhẹ**: CodeJar (~2.5 KB) + PrismJS core & grammars (~20 KB) |
| **Zero-Build & Vanilla ESM** | 100% Native, không cần build | Cần bundler hoặc load loader.js/AMD phức tạp; worker tách riêng dễ lỗi CORS | **Hoàn hảo**: 1 file `codejar.js` native ES module, 1 file `prism.js` |
| **Đồng bộ Cuộn & Con trỏ** | Dễ lệch dòng (desync) khi gõ nhanh, cuộn mượt bị giật, xử lý font chữ phức tạp | Mượt mà, chuyên nghiệp | Sử dụng `contenteditable` với engine giữ selection chuẩn, **không bị lệch dòng** |
| **Hỗ trợ Tính năng** | Phải tự viết Tab indentation, Undo/Redo, Line numbers | Quá thừa tính năng (Intellisense, minimap) | Đủ dùng: Tab indent, Auto-close brackets, History Undo/Redo, Line numbers |
| **Độ phức tạp duy trì** | Rất cao (dễ sinh lỗi trên các trình duyệt khác nhau) | Rất cao | Rất thấp (mã nguồn CodeJar chỉ ~250 dòng dễ hiểu) |

### 4.2 Quyết định Lựa chọn: CodeJar + PrismJS
- **Lý do**:
  1. `CodeJar` chỉ nặng chưa đầy **3 KB**, không cần build bước nào, hoạt động trực tiếp qua native `import { CodeJar } from '/ui/vendor/codejar.js'`.
  2. `PrismJS` hỗ trợ highlight nhanh, tô màu đẹp cho JS, TS, HTML, CSS, JSON, Markdown, Python, Shell.
  3. Cung cấp plugin số dòng (`line-numbers`) thanh lịch, mượt mà và không chiếm tài nguyên máy tính.

### 4.3 Quản lý Lưu file (Ctrl+S) & Phát hiện Xung đột (Conflict Detection)
Khi cả người dùng và Agent (Developer/Tester) đều có thể sửa file:
- **Nguyên lý nhận diện**:
  - Khi mở file: Client nhận nội dung kèm mã băm `fileHash` (hoặc `mtime` - thời điểm sửa cuối).
  - Khi người dùng bấm `Ctrl+S`:
    Client gửi `PUT /fs/file` kèm `{ path, content, baseHash }`.
- **Kịch bản Phát hiện Xung đột (Conflict Handling)**:
  - Nếu `currentServerHash !== baseHash` (nghĩa là trong lúc người dùng đang mở file thì Agent AI đã gọi `edit` hoặc `write` đè lên file đó):
  - Server trả về mã lỗi `409 Conflict`.
  - UI Editor lập tức kích hoạt **Banner Cảnh báo Xung đột màu vàng nổi bật** trên đầu file:
    ```
    ⚠️ CẢNH BÁO XUNG ĐỘT: File này vừa được sửa bởi nhân viên 'developer' cách đây 10 giây.
    [ Nạp bản của AI ]  [ Ghi đè bằng bản của bạn ]  [ Xem so sánh (Diff) ]
    ```
  - Tránh triệt để việc người dùng vô tình bấm Ctrl+S xóa mất mã nguồn mà Agent vừa hoàn thành.

### 4.4 Quy tắc An toàn Tuyệt đối: Chặn File Bí mật (Secret Guard Compliance)
Hệ thống Editor tuân thủ nghiêm ngặt theo các quy tắc kiểm soát an toàn của `src/guard.ts`:
- **Danh sách cấm tuyệt đối**:
  - `.env` và tất cả các biến thể `.env.*` (ngoại trừ `.env.example`, `.env.sample`, `.env.template`).
  - File khóa và chứng chỉ: `*.pem`, `*.key`, `*.pfx`, `*.p12`, `id_rsa*`, `id_ed25519*`.
  - Thư mục hệ thống & cấu hình nhạy cảm: `.company/`, `.ssh/`, `.agent-company/`, `.claude.json`, thông tin credentials.
- **Xử lý trên UI**:
  - Trên cây Explorer: Các file này hiển thị biểu tượng **Ổ khóa bảo vệ `🔒`** bên cạnh tên.
  - Khi người dùng click vào: Không tải nội dung, hiển thị màn hình bảo vệ:
    `🔒 File bí mật được bảo vệ: Hệ thống không cho phép xem hoặc sửa trực tiếp file cấu hình nhạy cảm này.`

### 4.5 Cảnh báo File Nhị phân hoặc Quá lớn
- **File nhị phân** (Images, PDF, ZIP, EXE,...): Hiển thị placeholder: *"File nhị phân (.png, .zip,...). Không hỗ trợ sửa văn bản."*
- **File quá lớn** ($> 2\text{ MB}$): Hiển thị cảnh báo: *"File có kích thước lớn (4.2 MB). Việc mở có thể làm giảm hiệu năng trình duyệt. [Vẫn mở file]"*.

---

## 5. Thiết kế Trải nghiệm Xem Thay đổi (Diff Viewer & Run History)

### 5.1 Danh sách File thay đổi theo Từng Câu hỏi / Lần chạy
Tại Sidebar, ngoài tab **Explorer**, có tab **Lần chạy & Thay đổi (Runs & Changes)**:
- Mỗi lần chạy tương ứng với một chỉ thị từ người dùng (ví dụ: *"Run #5: Thiết kế giao diện CSS"*).
- Bên dưới mỗi Run hiển thị cây danh sách các file mà các Role đã chỉnh sửa.
- Click vào bất kỳ file nào trong danh sách sẽ mở ra **Diff Viewer**.

### 5.2 Cơ chế Tạo Diff (Git & Non-Git Workspaces)

```
                       ┌─────────────────────────────┐
                       │ File được yêu cầu xem Diff │
                       └──────────────┬──────────────┘
                                      │
                   ┌──────────────────┴──────────────────┐
                   ▼                                     ▼
          [ Workspace là Git ]                  [ Workspace không có Git ]
      Gọi lệnh qua backend:                Backend Shadow Snapshots:
  `git diff <commit-trước> -- <file>`    So sánh giữa `.company/shadow/<runId>/<file>`
                   │                     và file hiện tại trên đĩa.
                   └──────────────────┬──────────────────┘
                                      │
                                      ▼
                      Render Unified / Side-by-Side Diff
```

1. **Với Workspace Git**:
   - Backend gọi `git diff` để trích xuất unified diff chuẩn xác nhất.
2. **Với Workspace Không Git (Non-Git Fallback)**:
   - Trước khi bất kỳ tool `write` hoặc `edit` nào thực thi, backend tự động sao lưu bản snapshot nội dung cũ của file vào thư mục `.company/shadow/<runId>/<relativeFilePath>`.
   - Khi xem diff, backend so sánh giữa bản shadow và bản hiện tại trên đĩa để sinh ra unified diff.

### 5.3 Giao diện Diff Viewer
- Hiển thị trực tiếp trong vùng Editor dưới dạng một Tab đặc biệt: `[ 🔀 Diff: app.js ]`.
- Hỗ trợ 2 chế độ xem:
  + **Inline Diff** (Mặc định cho màn hình 1366px): Các dòng xóa màu đỏ nhạt `-` và dòng thêm mới màu xanh lá `+` xếp liền nhau, kèm số dòng cũ và số dòng mới.
  + **Split Diff (Side-by-Side)**: Chia 2 cột dành cho màn hình lớn hơn.

---

## 6. Thiết kế Bottom Panel (Nhật ký Lệnh & Kết quả Test)

Bottom Panel giúp lập trình viên giám sát hành động hậu trường của các agent mà không làm rối màn hình code chính. Gồm 2 tab:

1. **Tab 1: Lệnh đã chạy (Commands & Shell Log)**:
   - Liệt kê toàn bộ các lệnh mà các role đã gọi qua công cụ `bash` hoặc `powershell`.
   - Mỗi lệnh hiển thị:
     + Tên role thực hiện (ví dụ: `developer`, `tester`).
     + Thư mục thực thi (`cwd`).
     + Dòng lệnh: `$ npm test` hoặc `$ git status`.
     + Kết quả trả về (stdout / stderr) kèm mã thoát (Exit code: `0` xanh lá, `≠0` đỏ).
2. **Tab 2: Kết quả kiểm thử (Test Results)**:
   - Trích xuất tự động các lượt chạy test của role `tester`.
   - Đếm số test passed/failed với thanh tiến trình trực quan (`12 passed, 0 failed`).
3. **Tính chất Read-Only**: Hoàn toàn chỉ đọc, tự động cuộn xuống cuối khi có log mới, có nút "Xóa log" và "Sao chép".

---

## 7. Thiết kế Khung Chat Manager (Right Sidebar)

Nằm ở mép phải (340px) để duy trì giao tiếp liền mạch với người dùng:
- **Thanh tiêu đề Chat**: Avatar Manager, trạng thái (`Đang làm việc...` / `Sẵn sàng`), nút thu gọn (`❯`).
- **Thẻ Phê duyệt Nổi bật (Approval Cards)**: Khi một role yêu cầu phê duyệt hành động thật (`checkpoint approval_required: true`), thẻ duyệt hiện ngay đầu khung chat với 2 nút to: `[ Duyệt thực hiện ]` và `[ Từ chối ]`.
- **Tin nhắn Tinh gọn**: Chỉ hiển thị thông điệp chính của Manager, các checkpoint quan trọng và tóm tắt công việc. Chi tiết kỹ thuật sâu được dẫn link mở trực tiếp file hoặc tab Diff trong Editor.
- **Hộp nhập lệnh nhanh**: Gõ yêu cầu mới hoặc chỉ đạo Manager mà không cần rời mắt khỏi code.

---

## 8. Những gì KHÔNG LÀM (Để Giữ "Tối giản" & Nhẹ Nhàng)

Để đảm bảo Agent Company duy trì tốc độ khởi động tức thì, không bị cồng kềnh và không biến thành bản sao nặng nề của VS Code, hệ thống kiên quyết **LOẠI BỎ** các tính năng sau:

1. **KHÔNG làm Terminal Tương tác (Interactive PTY / xterm.js)**:
   - Người dùng không tương tác gõ lệnh trực tiếp trong app (như bash prompt). Mọi lệnh terminal đều do các Agent thực hiện và hiển thị dưới dạng **Read-Only Output Log**. Người dùng muốn gõ lệnh tự do có thể mở terminal của OS bên ngoài.
2. **KHÔNG làm Hệ sinh thái Extension / Plugin Marketplace**:
   - Không có cơ chế cài extension của bên thứ ba. Toàn bộ tính năng phục vụ đúng luồng làm việc giữa Người dùng và Đội ngũ Agent.
3. **KHÔNG làm Debugger (GDB / DAP / Breakpoints)**:
   - Không hỗ trợ đặt breakpoint, step over, xem call stack. Việc debug, kiểm tra biến và sửa lỗi thuộc về trách nhiệm của các Agent Developer và Tester.
4. **KHÔNG làm Language Server Protocol (LSP) nặng nề**:
   - Không nhúng typescript-language-server hay intellisense phức tạp vào trình duyệt. Trình soạn thảo tập trung vào việc đọc code rõ ràng, highlight cú pháp nhanh, chỉnh sửa nhỏ và xem diff.
5. **KHÔNG làm Git GUI phức tạp**:
   - Không có giao diện staging từng hunk, resolve merge conflicts 3-way, git rebase. Chỉ cung cấp tính năng xem sự thay đổi (Diff) mà Agent vừa tạo ra.

---

## 9. Kế hoạch Triển khai Theo Giai đoạn (Implementation Roadmap)

| Giai đoạn | Nội dung công việc | Đầu ra kỹ thuật |
| :--- | :--- | :--- |
| **P1: Khung layout 4 vùng & Responsive** | Cấu trúc CSS Grid / Flexbox 4 vùng; Activity bar; splitter kéo giãn; tối ưu 1366px; cơ chế thu gọn `Ctrl+B`, `Ctrl+J`. | `ui/index.html`, `ui/styles.css`, `ui/js/layout.js` |
| **P2: Explorer & Bộ lọc An toàn** | API `GET /fs/tree` có lazy load; bộ lọc `.git`/`node_modules`; bảo mật file bí mật theo `guard.ts`; đánh dấu badge `M`/`A`. | `src/server.ts`, `ui/js/explorer.js` |
| **P3: Code Editor (CodeJar + PrismJS)** | Tích hợp CodeJar & PrismJS qua ESM; Tab bar; số dòng; Ctrl+S lưu file; kiểm tra xung đột `409 Conflict`. | `ui/vendor/codejar.js`, `ui/js/editor.js` |
| **P4: Bottom Panel & Diff Viewer** | Panel Lệnh đã chạy; Test results; API `GET /fs/diff` (Git & Shadow snapshot); giao diện inline diff. | `src/server.ts`, `ui/js/diff.js`, `ui/js/bottom-panel.js` |
| **P5: Tích hợp Văn phòng Dual-Mode** | Chuyển đổi mượt mà giữa Tab Văn phòng và Split View; đồng bộ animation nhân vật khi mở file. | `ui/js/office.js`, `ui/js/app.js` |

---
**Kết luận**: Thiết kế biến đổi Agent Company thành một **IDE Tối giản** giữ trọn vẹn nét độc đáo của Văn phòng Pixel Art, đồng thời trang bị đầy đủ công cụ làm việc thực chiến (Explorer, Editor, Diff, Command Log) giúp người dùng và đội ngũ Agent phối hợp lập trình mượt mà, tốc độ cao trên mọi dòng laptop. Toàn bộ tài liệu chi tiết đã sẵn sàng cho giai đoạn lập trình.
