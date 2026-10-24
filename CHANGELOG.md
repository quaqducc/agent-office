# Changelog

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
