# Kế Hoạch Triển Khai Bản 0.2.3 (Telegram Remote Chat) & Bản 0.2.4 (Launcher Mở App Tiện Lợi)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
> **Status:** Đã được Critic phản biện và phê duyệt (Approved with changes) — đã tích hợp 100% khuyến nghị an ninh và tính tương thích Windows.

**Goal:**
- **Bản 0.2.3 (Telegram Remote Chat):** Cho phép người dùng điều khiển và trò chuyện 2 chiều từ xa với Manager qua Telegram Bot mà không cần mở trình duyệt web. Hỗ trợ nhận thông báo duyệt Checkpoint khẩn cấp và click Duyệt/Từ chối trực tiếp qua Inline Keyboard. Zero npm dependencies (sử dụng native `fetch` của Node 22). Bảo mật nghiêm ngặt với cơ chế Pairing 6 số chống brute-force/timing attack, chỉ cho phép Private Chat (chặn group), mask token an toàn trong API settings, và fallback plain text chống nuốt tin nhắn.
- **Bản 0.2.4 (Convenient App Launcher):** Tối ưu trải nghiệm khởi động app cho người dùng không rành dòng lệnh. Lệnh CLI `agent-company shortcut` tự động tạo shortcut `.lnk` trên Desktop và Start Menu khóa cứng đường dẫn `process.execPath` (hỗ trợ nvm/fnm/volta); loại bỏ hoàn toàn `.vbs` để chống Windows Defender / Antivirus chặn heuristic; tự động tạo shortcut Desktop ngay khi chạy `install.ps1`.

---

## Kiến Trúc Tổng Thể

```
               ┌─────────────────────────────────────────────────────┐
               │                 TELEGRAM CLOUD                      │
               └───────────────────────┬─────────────────────────────┘
                                       │ HTTPS (Long-polling & Webhook-less)
                                       ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        AGENT COMPANY SERVER                            │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │                 Telegram Bridge (src/telegram.ts)              │   │
│   │  • Zero-dep native fetch (Telegram Bot API)                   │   │
│   │  • Long-polling getUpdates loop (timeout 35s, 429 retry-after) │   │
│   │  • Security Gate: Pairing Code (Private chat only, max 5 tries)│   │
│   │  • Timing-safe comparison (crypto.timingSafeEqual)             │   │
│   │  • Checkpoint Inline Keyboard: [✅ Duyệt] [❌ Từ chối]         │   │
│   │  • Fallback Plain Text nếu Telegram lỗi parse entities         │   │
│   └───────────────▲───────────────────────────────┬────────────────┘   │
│                   │ sendUserMessage / reply       │ eventLog / emitter │
│                   ▼                               ▼                    │
│   ┌───────────────────────────────┐   ┌────────────────────────────┐   │
│   │     Router & Workspace Store   │   │      Web UI & SSE Engine   │   │
│   │  (maskKey token in settings)  │   │   (Pairing 6 digits UI)    │   │
│   └───────────────────────────────┘   └────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│                       DESKTOP / OS LAUNCHER                            │
│                                                                        │
│   • CLI Command: agent-company shortcut [--desktop] [--start-menu]     │
│   • Pinned Node Path: process.execPath (chống lạc path nvm/fnm/volta)  │
│   • Zero-VBS Architecture: Trực tiếp qua PowerShell WindowStyle Hidden  │
│   • Installer Hook: install.ps1 tạo Desktop shortcut an toàn           │
│   • Auto-browser Launch: Mở http://127.0.0.1:4317 mượt mà              │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Rủi Ro Kỹ Thuật & Giải Pháp An Ninh (Sau Khi Critic Phản Biện)

1. **Bảo Vệ Bot Token Trong Settings (`src/settings.ts`):**
   - *Rủi ro:* `GET /settings` có thể để lộ bot token thô ra ngoài trình duyệt.
   - *Giải pháp bắt buộc:* Bổ sung `maskKey(c.telegram.botToken)` vào hàm `publicConfig(c)`. Khi cập nhật settings (`mergeConfig`), nếu token gửi lên chứa chuỗi `...` thì bảo lưu token cũ trong file đĩa.
2. **Cơ Chế Pairing Code Chống Tấn Công (Private Chat & Rate Limiting):**
   - *Chặn Chat Group:* Chỉ chấp nhận lệnh `/pair` khi `update.message.chat.type === "private"`. Tuyệt đối từ chối lệnh pairing gửi từ group hoặc channel.
   - *Chống Brute-force:* Giới hạn tối đa 5 lần thử sai mã pairing trong vòng 5 phút. Vượt quá 5 lần sẽ khóa chức năng pairing tạm thời.
   - *Chống Timing Attack:* So sánh mã pairing qua hàm an toàn thời gian `crypto.timingSafeEqual`.
3. **Độ Ổn Định Long-polling & Xử Lý HTTP 429:**
   - Đặt `signal: AbortSignal.timeout(35000)` cho mỗi vòng lặp `getUpdates` (dài hơn timeout của server Telegram là 30s) để chống treo socket vĩnh viễn khi mạng rớt hoặc máy tính sleep.
   - Khi nhận HTTP 429, trích xuất chính xác trường `parameters.retry_after` và tạm dừng vòng lặp polling đúng số giây Telegram yêu cầu ($+ 1\text{s}$ đệm).
4. **Fallback Plain Text Chống Nuốt Tin Nhắn Duyệt:**
   - Khi gọi `sendMessage` có định dạng HTML/Markdown, nếu Telegram trả về mã `400 Bad Request (can't parse entities)`, hệ thống lập tức tự động gửi lại dưới dạng `text` thuần túy, đảm bảo tin nhắn checkpoint không bao giờ bị thất lạc.
5. **Idempotent Khi Bấm Nút Duyệt Checkpoint:**
   - Khi nhận `callback_query`, lập tức gọi `answerCallbackQuery(id)` để tắt vòng quay trên Telegram. Kiểm tra trạng thái checkpoint; nếu đã được xử lý (trên web hoặc telegram), cập nhật lại tin nhắn Telegram và gỡ bỏ toàn bộ Inline Keyboard (`reply_markup: { inline_keyboard: [] }`).
6. **Loại Bỏ Hoàn Toàn File `.vbs` (Chống Antivirus Gắn Cờ):**
   - Không sử dụng file `.vbs` trung gian (dễ bị Windows Defender/EDR gắn cờ heuristic). Thay vào đó, Shortcut `.lnk` trỏ trực tiếp tới `powershell.exe -WindowStyle Hidden` hoặc file `.cmd` thu nhỏ, sử dụng chính xác `process.execPath` của Node.js.

---

# PHẦN 1: BẢN 0.2.3 — TELEGRAM REMOTE CHAT

### Task 1.1: Module Telegram API Client Thuần Node.js (Zero Dependency - TDD)

**Files:**
- Create: `src/telegram-client.ts`
- Create: `tests/telegram-client.test.ts`

**Interfaces:**
```ts
export interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  allowedChatId?: string;
  defaultWorkspaceId?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; username?: string; first_name?: string };
    chat: { id: number; type: "private" | "group" | "supergroup" | "channel" };
    text?: string;
    date: number;
  };
  callback_query?: {
    id: string;
    from: { id: number };
    message?: { message_id: number; chat: { id: number } };
    data?: string;
  };
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}
```

- [ ] **Step 1: Viết test mock cho Telegram API Client trong `tests/telegram-client.test.ts`**
  - Khởi tạo local mock HTTP server giả lập endpoint Telegram `https://api.telegram.org/bot<token>/...`.
  - Test 1: `getMe` xác thực bot token hợp lệ.
  - Test 2: `getUpdates` nhận danh sách tin nhắn mới và cập nhật offset với timeout 35s.
  - Test 3: Xử lý rate limit HTTP 429 trích xuất đúng `retry_after`.
  - Test 4: `sendMessage` tự động chia nhỏ nội dung khi chuỗi dài hơn 4000 ký tự.
  - Test 5: `sendMessage` tự động fallback sang plain text khi Telegram báo lỗi parse entity 400.
  - Test 6: `answerCallbackQuery` phản hồi khi bấm nút Inline Keyboard.
- [ ] **Step 2: Chạy test để kiểm tra thất bại**
  - Command: `node --test --test-timeout=60000 tests/telegram-client.test.ts`
- [ ] **Step 3: Cài đặt `src/telegram-client.ts` bằng native `fetch`**
  - Dùng `globalThis.fetch` và `AbortSignal.timeout(35000)`.
  - Triển khai `chunkMessage(text: string, limit = 4000): string[]`.
  - Triển khai fallback tự động plain text khi parse lỗi.
- [ ] **Step 4: Chạy lại test xác nhận pass**
  - Command: `node --test --test-timeout=60000 tests/telegram-client.test.ts`
- [ ] **Step 5: Kiểm tra TypeScript**
  - Command: `npm run check`

---

### Task 1.2: Bảo Mật Ghép Đôi (Pairing), Chống Brute-force & Mask Token (TDD)

**Files:**
- Create: `src/telegram-auth.ts`
- Create: `tests/telegram-auth.test.ts`
- Modify: `src/settings.ts`

- [ ] **Step 1: Viết unit tests trong `tests/telegram-auth.test.ts`**
  - Test 1: Sinh mã pairing 6 chữ số ngẫu nhiên có TTL 5 phút.
  - Test 2: Từ chối lệnh pairing nếu `chat.type !== "private"`.
  - Test 3: Khóa pairing tạm thời nếu nhập sai mã 5 lần liên tiếp.
  - Test 4: So sánh mã bằng `crypto.timingSafeEqual`.
  - Test 5: `publicConfig()` trong `src/settings.ts` che giấu bot token (`maskKey`).
  - Test 6: `mergeConfig()` giữ nguyên bot token cũ nếu client gửi chuỗi có `...`.
- [ ] **Step 2: Cài đặt logic trong `src/telegram-auth.ts`**
  - Quản lý bộ đếm `failedAttempts` cho từng `chatId`.
  - `generatePairingCode(): { code: string; expiresAt: number }`.
  - `verifyPairingCode(code: string, chat: { id: number; type: string }): { ok: boolean; reason?: string }`.
- [ ] **Step 3: Cập nhật `src/settings.ts`**
  - Thêm `telegram?: TelegramConfig` vào `AppConfig`.
  - Thêm `maskKey(c.telegram.botToken)` vào `publicConfig()`.
  - Thêm logic bảo toàn token vào `mergeConfig()`.
- [ ] **Step 4: Chạy test xác nhận pass**
  - Command: `node --test --test-timeout=60000 tests/telegram-auth.test.ts`

---

### Task 1.3: Bộ Cầu Nối Telegram Bridge & Điều Hướng Tin Nhắn 2 Chiều (TDD)

**Files:**
- Create: `src/telegram-bridge.ts`
- Create: `tests/telegram-bridge.test.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Viết integration tests trong `tests/telegram-bridge.test.ts`**
  - Test 1: User gửi tin nhắn văn bản $\rightarrow$ `router.sendUserMessage` được kích hoạt.
  - Test 2: Manager phản hồi $\rightarrow$ nội dung được gửi lại vào Telegram chat.
  - Test 3: Checkpoint có `approval_required: true` $\rightarrow$ Telegram nhận tin nhắn cảnh báo kèm 2 nút Inline Keyboard `[✅ Duyệt]` và `[❌ Từ chối]`.
  - Test 4: User bấm nút Inline Keyboard $\rightarrow$ gọi `router.replyCheckpoint` idempotent và xóa nút bấm trên Telegram.
  - Test 5: Reconnect an toàn khi gặp HTTP 429 hoặc rớt mạng.
- [ ] **Step 2: Triển khai `src/telegram-bridge.ts`**
  - Class `TelegramBridge` với vòng lặp `getUpdates` và `AbortController`.
  - Đăng ký lắng nghe checkpoint và event log từ Workspace Router.
  - Các lệnh: `/start`, `/help`, `/status`, `/workspaces`, `/workspace <id>`, `/approve <id>`, `/reject <id>`.
- [ ] **Step 3: Tích hợp vào `src/server.ts`**
  - Khởi động bridge khi server start nếu `telegram.enabled: true`.
  - Dừng graceful khi server shutdown.
- [ ] **Step 4: Chạy test xác nhận pass**
  - Command: `node --test --test-timeout=60000 tests/telegram-bridge.test.ts`
- [ ] **Step 5: Kiểm tra toàn diện bản 0.2.3**
  - `npm test`, `npm run check`, `node scripts/pack-check.mjs`.
  - Bump version lên `0.2.3` trong `package.json` và cập nhật `CHANGELOG.md`.
  - Thực hiện Git Commit: `feat(telegram): remote chat and checkpoint approvals via telegram bot`.

---

# PHẦN 2: BẢN 0.2.4 — LAUNCHER MỞ APP TIỆN LỢI

### Task 2.1: Bộ Tiện Ích Tạo Shortcut Khóa Cứng Node Path (TDD - Zero VBS)

**Files:**
- Create: `src/launcher.ts`
- Create: `tests/launcher.test.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Viết unit tests trong `tests/launcher.test.ts`**
  - Test 1: Khóa cứng `process.execPath` (đường dẫn Node hiện hành) trong thuộc tính Shortcut `.lnk`.
  - Test 2: Tạo Shortcut Windows gọi trực tiếp PowerShell với cờ `-WindowStyle Hidden` (không sử dụng file `.vbs`).
  - Test 3: Sinh file `.desktop` cho Linux Desktop / Application Menu.
  - Test 4: Parse CLI arguments: `agent-company shortcut [--desktop] [--start-menu]`.
- [ ] **Step 2: Triển khai module `src/launcher.ts`**
  - Hàm `createWindowsShortcut(options)`:
    - Target: `powershell.exe`.
    - Arguments: `-WindowStyle Hidden -ExecutionPolicy Bypass -Command "Start-Process '${process.execPath}' -ArgumentList '\"${entryPath}\" start' -WindowStyle Hidden"`.
    - WorkingDirectory: thư mục app hoặc home.
  - Hàm `createLinuxShortcut()` và `createMacShortcut()`.
- [ ] **Step 3: Tích hợp lệnh `shortcut` vào `src/main.ts`**
  - Bổ sung `shortcut` vào danh sách `COMMANDS`.
  - Xử lý CLI và in thông báo thân thiện.
- [ ] **Step 4: Chạy test xác nhận pass**
  - Command: `node --test --test-timeout=60000 tests/launcher.test.ts`
- [ ] **Step 5: Kiểm tra TypeScript**
  - Command: `npm run check`

---

### Task 2.2: Nâng Cấp `install.ps1` & Trải Nghiệm Khởi Động Tức Thì

**Files:**
- Modify: `install.ps1`
- Modify: `README.md`

- [ ] **Step 1: Cập nhật `install.ps1` với Bọc An Toàn**
  - Sau khi `npm install -g @quaqduc/agent-company` hoàn tất:
  - Bọc khối tạo shortcut trong `try { ... } catch { ... }`:
    - Chạy `& agent-company shortcut --desktop`.
    - Nếu thành công, in thông báo:
      ```
      ✨ Đã tạo biểu tượng "Agent Company" trên màn hình Desktop của bạn!
      👉 Chỉ cần click đúp vào biểu tượng trên Desktop để vào ngay văn phòng AI!
      ```
    - Nếu thất bại (do chính sách quyền máy tính), in thông báo thay thế:
      ```
      👉 Bạn có thể tạo biểu tượng Desktop bất kỳ lúc nào bằng lệnh: agent-company shortcut
      ```
- [ ] **Step 2: Cập nhật tài liệu hướng dẫn trong `README.md`**
  - Thêm mục "Khởi chạy tiện lợi với Desktop Shortcut".
  - Thêm mục "Kết nối điều khiển từ xa qua Telegram Bot".
- [ ] **Step 3: Kiểm tra toàn diện bản 0.2.4**
  - `npm test`, `npm run check`, `node scripts/pack-check.mjs`.
  - Bump version lên `0.2.4` trong `package.json` và cập nhật `CHANGELOG.md`.
  - Thực hiện Git Commit: `feat(launcher): convenient desktop shortcut and windowless app launcher`.

---

## Tiêu Chí Nghiệm Thu Cho Reviewer (Definition of Done)

| Hạng mục | Tiêu chí kiểm tra | Kết quả kỳ vọng |
|---|---|---|
| **Zero Dependencies** | Kiểm tra `package.json` | 100% không cài thêm bất kỳ npm runtime dependency nào |
| **Mask Bot Token** | `GET /settings` qua API | Token được che dấu (`123456:AA...xxxx`), không lộ raw token |
| **Bảo mật Pairing** | Thử pair trong Telegram group hoặc brute-force | Bị chặn ngay nếu là group chat; bị khóa nếu thử sai quá 5 lần |
| **Phê duyệt Checkpoint** | Gửi checkpoint cần duyệt qua Telegram | Nhận thông báo kèm 2 nút Inline Keyboard [Duyệt] / [Từ chối], tự động xóa nút sau khi bấm để tránh double-approval |
| **Fallback Tin Nhắn** | Gửi tin nhắn chứa ký tự đặc biệt Markdown | Tự động chuyển sang Plain text nếu Telegram báo lỗi 400 parse entity |
| **Độ Bền Polling** | Giả lập mất mạng hoặc HTTP 429 | Polling timeout 35s không treo process, tuân thủ `retry_after` của Telegram |
| **Zero-VBS Launcher** | Tạo shortcut trên Windows | Không sinh file `.vbs`, dùng PowerShell hidden window, khóa cứng `process.execPath` |
| **An toàn Installer** | Chạy `install.ps1` ở môi trường quyền hạn chế | Không bị crash, tạo shortcut thành công hoặc in hướng dẫn chạy tay |
| **Kiểm thử tự động** | `node --test --test-timeout=60000 "tests/**/*.test.ts"` | 100% tests pass xanh |
| **Phân chia Phiên bản** | Kiểm tra git log và `package.json` | 2 commit tách biệt: bản `0.2.3` và bản `0.2.4` |
