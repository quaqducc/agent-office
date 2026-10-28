# Changelog

## 0.3.0 — 2026-10-28

- **Tài liệu cho người non-tech: role mới Explainer (Thuyết minh)**:
  - Role cơ bản thứ 5, có sẵn trong mọi văn phòng (phòng mặc định xếp ở khu "Chuyên gia"; thêm vào template Startup MVP và Software House).
  - Viết và cập nhật `docs/OVERVIEW.md` bằng ngôn ngữ dễ hiểu: tóm tắt, sơ đồ cách app hoạt động, sơ đồ các thành phần, quy trình làm việc của nhóm, tiến độ và cách chạy thử — để người yêu cầu, đồng nghiệp và đối tác (kể cả người không rành kỹ thuật) theo dõi được.
  - Manager tự giao việc cho Explainer khi nhóm xây hoặc sửa lớn một sản phẩm (cuối quá trình, và ngay từ bản kế hoạch nếu việc kéo dài), rồi báo người dùng tài liệu đã sẵn sàng để chia sẻ.
- **Sơ đồ Mermaid hiển thị thành hình vẽ** trong khung chat, kết quả task và trình xem file. Thư viện (Mermaid 12.2.0, đóng gói sẵn, chạy offline) chỉ tải khi trang có sơ đồ; sơ đồ sai cú pháp hiện mã gốc kèm cảnh báo.
- **Xem trước file Markdown** trong trình xem file: `.md` mở dạng đã định dạng (kèm sơ đồ), nút `Xem mã` / `Xem trước` để chuyển qua lại.
- **Khung "Trò chuyện Manager"**:
  - Kéo mép trái để phóng to / thu nhỏ (tối đa 70% màn hình), nhấp đúp để về mặc định; nhớ độ rộng.
  - Nút `Tách ra` biến khung chat thành cửa sổ nổi kiểu sticky note: kéo thanh tiêu đề để di chuyển, kéo góc để đổi kích thước, nút `Gắn lại` để đưa về cạnh phải; nhớ vị trí và kích thước.
  - Nút 📋 sao chép trên mọi khối lệnh / khối code trong tin nhắn.
- **Telegram chia theo workspace**:
  - Lệnh `/workspace` hiện danh sách nút chọn workspace nhận tin nhắn (✅ đánh dấu workspace đang chọn); lựa chọn được lưu lại.
  - Mọi tin bot gửi đều ghi tên workspace: câu trả lời `[Tên] Manager`, checkpoint có dòng `Workspace`, xác nhận gửi tin `Đã chuyển đến Manager [Tên]`; `/status` cho biết workspace đang chọn.
  - Sửa lỗi nút Duyệt / Từ chối gửi quyết định nhầm sang workspace mặc định; nút giờ mang theo workspace của checkpoint. Checkpoint đã xử lý thì bot báo rõ thay vì im lặng.
  - Nút bấm chỉ nhận từ chat đã ghép đôi; workspace đã chọn bị xoá thì bot giữ tin lại và nhắc chọn lại; lỗi khi xử lý được báo trên chat và ghi log thay vì bị nuốt.
- **Sửa lỗi**:
  - Nhân vật "Bạn" để lại một bản tại chỗ khi đi sang bàn khác.
  - `agent-company shortcut` tạo lối tắt vào thư mục Desktop thật (kể cả khi Desktop được OneDrive chuyển hướng hoặc có tên tiếng Việt như "Máy tính"), thay vì `%USERPROFILE%\Desktop` cố định.

## 0.2.5 — 2026-10-24

- **Tab Telegram trong giao diện Cài đặt (Settings UI)**:
  - Thêm tab Telegram trực tiếp trong hộp thoại Cài đặt của web UI.
  - Bổ sung nút `[Lấy mã ghép đôi]` gọi `POST /settings/telegram/pair-code` sinh mã 6 số to rõ ràng (`/pair <mã 6 số>`) có thời hạn 5 phút.
  - Hiển thị trực quan trạng thái cấu hình bot (`Đang bật` / `Chưa bật`) và badge `✅ Đã ghép đôi (Chat ID: ...)` khi bot đã kết nối thành công.

## 0.2.4 — 2026-10-24

- **Tiện ích mở app dễ dàng bằng Shortcut Desktop & Start Menu**:
  - Thêm lệnh `agent-company shortcut [--desktop] [--start-menu]` tạo biểu tượng mở nhanh trên màn hình Desktop hoặc menu Start / Applications.
  - Khởi chạy không hiện cửa sổ command prompt đen: chạy ẩn với PowerShell `-WindowStyle Hidden` và khóa cứng đường dẫn thực thi Node.js (`process.execPath`).
  - Hỗ trợ đa nền tảng: tạo file `.lnk` trên Windows, `.desktop` trên Linux, và `.command` trên macOS.
  - Tự động tạo Shortcut Desktop ngay sau khi hoàn tất cài đặt toàn cục qua `install.ps1`.

## 0.2.3 — 2026-10-24

- **Kết nối Telegram Bot (Remote Chat & Checkpoint Approvals)**:
  - Cho phép trò chuyện hai chiều từ xa với Manager qua Telegram Bot không cần mở trình duyệt web.
  - Nhận thông báo Checkpoint tức thời kèm Inline Keyboard `[Duyệt]` và `[Từ chối]` trực tiếp trên điện thoại; tự động cập nhật và gỡ nút tránh thao tác trùng lặp.
  - Zero npm dependencies, sử dụng native `fetch` của Node.js.
  - Bảo mật ghép đôi nghiêm ngặt: mã 6 số ngẫu nhiên thời hạn 5 phút, chỉ nhận tin nhắn riêng tư (private chat), chống brute-force (khóa 15 phút sau 5 lần sai) và so sánh an toàn thời gian (`crypto.timingSafeEqual`).
  - Bảo vệ bot token an toàn trong cài đặt (`maskKey` và `mergeConfig`), tự động xử lý HTTP 429 và fallback plain text khi Telegram gặp lỗi phân tích Markdown 400.

## 0.2.2 — 2026-10-24

- Nhân vật di chuyển đứng trước bàn / bên cạnh role khác khi giao tiếp thay vì đè lên vị trí đang ngồi; tự động quay mặt về phía bàn đối thoại.
- Thêm nút thu gọn và nút bật/tắt (activity bar + nút khôi phục) cho tab "Hoạt động gần đây", tự động mở rộng không gian văn phòng khi ẩn.

## 0.2.1 — 2026-10-24

- Sửa lỗi giao diện không nạp được (lỗi cú pháp app.js và prism.js); thêm kiểm tra cú pháp UI.

## 0.2.0 — 2026-10-23

- **IDE đơn giản**:
  - Explorer cây thư mục workspace với lazy loading và biểu tượng loại file trực quan.
  - Trình biên tập code nhanh hai lớp (textarea + PrismJS highlight) hỗ trợ `Ctrl+S`, lưu tệp nguyên tử và phát hiện xung đột ghi đè.
  - Xem thay đổi (Diff Viewer) theo từng lần chạy dựa trên Shadow Backup và thuật toán Myers diff thuần túy.
  - Panel đáy mở rộng với tab Lệnh (Command Log) và Kết quả test (Test Results: hỗ trợ `node:test` Spec/TAP và pytest) cùng thanh kéo tùy chỉnh độ cao.
- **Hàng đợi tin nhắn (Message Queue)**: Gửi nhiều tin nhắn liên tiếp mà không bị chồng lấn hay xung đột lượt chạy; tự động thực thi tuần tự lần lượt từng tin.
- **Chọn câu hỏi trong Luồng việc & Nhật ký**: Bộ chọn (Question Selector) đồng bộ trên tất cả các tab (Luồng việc, Nhật ký, Lệnh, Test), lọc dữ liệu hiển thị theo từng câu hỏi của người dùng.
- **Nút Browse kiểu VS Code**: Mở hộp thoại chọn thư mục gốc của hệ điều hành (Windows PowerShell OpenFolderDialog, macOS AppleScript, Linux zenity/kdialog) với timeout an toàn và console ngầm.
- **Nhân vật đi lại**: Hoạt hình nhân vật di chuyển giữa các phòng làm việc theo lộ trình cửa và hành lang, tương tác trao đổi trực quan thay thế cho đường kẻ mũi tên.
- **Đổi tên workspace**: Cho phép đổi tên hiển thị của workspace trực tiếp trên thanh đầu trang.
- **Tuỳ biến văn phòng & Template**: Thiết lập phòng làm việc, phân bổ chỗ ngồi cho các role và lưu cấu hình template trong hộp thoại Văn phòng.
- **Bảo mật**: Cơ chế jail workspace nghiêm ngặt, chặn path traversal, chặn symlink escape trỏ ra ngoài workspace root và ngăn chặn truy cập các tệp bí mật (`.env`, `.company`, `.git`, SSH keys).

## 0.1.0 — 2026-10-21

First public release.

- `agent-company` command: `start` (opens the office in the browser), `doctor`, `chat`, `import`.
- Bring your own API: OpenAI-compatible, Anthropic and Gemini endpoints, with presets for OpenAI,
  OpenRouter, DeepSeek, Gemini, Anthropic, Ollama and OmniRoute. One default model plus optional
  per-role models. Keys are stored only in `~/.agent-company/config.json`.
- Base team: Manager, Researcher, Developer, Critic. Ten more roles in the role store, installed on
  demand with checksum-verified downloads.
- Web search through the endpoint (OmniRoute `google_search`, OpenRouter web search) or SearXNG.
- 2D pixel office UI: live team activity, task flow, log, approvals, run replay.
