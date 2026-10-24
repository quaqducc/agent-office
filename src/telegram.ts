import { randomInt, timingSafeEqual } from "node:crypto";
import type { Router } from "./router.ts";
import type { Workspace } from "./workspace.ts";
import type { EventLog } from "./event-log.ts";

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
}

export interface PairingResult {
  ok: boolean;
  reason?: string;
}

export class TelegramAuth {
  private activePairingCode: string | null = null;
  private codeExpiresAt = 0;
  private failedAttempts = new Map<number, { count: number; lockedUntil: number }>();
  private pairedChatIds = new Set<number>();

  constructor(initialAllowedChatId?: string) {
    if (initialAllowedChatId) {
      const parsed = parseInt(initialAllowedChatId, 10);
      if (!Number.isNaN(parsed)) this.pairedChatIds.add(parsed);
    }
  }

  generatePairingCode(): { code: string; expiresAt: number } {
    const code = String(randomInt(100000, 999999));
    this.activePairingCode = code;
    this.codeExpiresAt = Date.now() + 5 * 60 * 1000; // 5 mins
    return { code, expiresAt: this.codeExpiresAt };
  }

  isLocked(chatId: number): boolean {
    const record = this.failedAttempts.get(chatId);
    if (!record || record.count < 5) return false;
    if (Date.now() > record.lockedUntil) {
      this.failedAttempts.delete(chatId);
      return false;
    }
    return true;
  }

  isPaired(chatId: number): boolean {
    return this.pairedChatIds.has(chatId);
  }

  addPairedChat(chatId: number): void {
    this.pairedChatIds.add(chatId);
  }

  verifyPairingCode(candidate: string, chat: TelegramChat): PairingResult {
    if (chat.type !== "private") {
      return { ok: false, reason: "Chỉ cho phép ghép đôi qua tin nhắn riêng tư (private chat)." };
    }

    if (this.isLocked(chat.id)) {
      return { ok: false, reason: "Tài khoản bị khóa tạm thời do thử sai quá nhiều lần. Vui lòng thử lại sau 15 phút." };
    }

    if (!this.activePairingCode || Date.now() > this.codeExpiresAt) {
      return { ok: false, reason: "Mã ghép đôi đã hết hạn hoặc chưa được tạo từ giao diện." };
    }

    const candidateClean = String(candidate).trim();
    const targetCode = this.activePairingCode;

    // Timing-safe comparison
    const bufA = Buffer.from(candidateClean, "utf8");
    const bufB = Buffer.from(targetCode, "utf8");
    const match = bufA.length === bufB.length && timingSafeEqual(bufA, bufB);

    if (match) {
      this.pairedChatIds.add(chat.id);
      this.activePairingCode = null;
      this.codeExpiresAt = 0;
      this.failedAttempts.delete(chat.id);
      return { ok: true };
    }

    // Record failure
    const current = this.failedAttempts.get(chat.id) || { count: 0, lockedUntil: 0 };
    current.count += 1;
    if (current.count >= 5) {
      current.lockedUntil = Date.now() + 15 * 60 * 1000; // Lock 15 mins
    }
    this.failedAttempts.set(chat.id, current);

    return {
      ok: false,
      reason: current.count >= 5
        ? "Nhập sai mã 5 lần liên tiếp. Chức năng ghép đôi bị khóa 15 phút."
        : `Mã ghép đôi không chính xác. Bạn còn ${5 - current.count} lần thử.`,
    };
  }
}

export interface TelegramServiceOptions {
  botToken: string;
  allowedChatId?: string;
  apiBaseUrl?: string;
  pollIntervalMs?: number;
  getContext: (workspaceId?: string) => { ws: Workspace; router: Router; log: EventLog } | undefined;
  onChatPaired?: (chatId: string) => void;
}

export class TelegramService {
  private botToken: string;
  private allowedChatId?: string;
  private apiBaseUrl: string;
  private pollIntervalMs: number;
  private getContext: (workspaceId?: string) => { ws: Workspace; router: Router; log: EventLog } | undefined;
  private onChatPaired?: (chatId: string) => void;
  private auth: TelegramAuth;
  private running = false;
  private abortController: AbortController | null = null;
  private lastUpdateId = 0;

  constructor(options: TelegramServiceOptions) {
    this.botToken = options.botToken;
    this.allowedChatId = options.allowedChatId;
    this.apiBaseUrl = options.apiBaseUrl || "https://api.telegram.org";
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.getContext = options.getContext;
    this.onChatPaired = options.onChatPaired;
    this.auth = new TelegramAuth(options.allowedChatId);
  }

  getAuth(): TelegramAuth {
    return this.auth;
  }

  isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.abortController = new AbortController();

    // Start background polling loop
    queueMicrotask(() => this.pollLoop());
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private async fetchApi(method: string, payload: any, signal?: AbortSignal): Promise<any> {
    const url = `${this.apiBaseUrl}/bot${this.botToken}/${method}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err: any = new Error(data.description || `HTTP ${res.status}`);
      err.status = res.status;
      err.parameters = data.parameters;
      err.description = data.description;
      throw err;
    }
    return data;
  }

  async sendMessage(chatId: string | number, text: string, options: { parse_mode?: string; reply_markup?: any } = {}): Promise<any> {
    try {
      return await this.fetchApi("sendMessage", {
        chat_id: chatId,
        text,
        parse_mode: options.parse_mode,
        reply_markup: options.reply_markup,
      });
    } catch (err: any) {
      // 400 Bad Request fallback: can't parse entities
      if (err.status === 400 && options.parse_mode) {
        return await this.fetchApi("sendMessage", {
          chat_id: chatId,
          text,
          reply_markup: options.reply_markup,
        });
      }
      throw err;
    }
  }

  async editMessageText(chatId: string | number, messageId: number, text: string, options: { reply_markup?: any } = {}): Promise<any> {
    return await this.fetchApi("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      reply_markup: options.reply_markup,
    });
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<any> {
    return await this.fetchApi("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text,
    });
  }

  async notifyManagerReply(workspaceId: string, text: string): Promise<void> {
    const chatId = this.allowedChatId;
    if (!chatId) return;
    const formatted = `💬 *Manager*: ${text}`;
    await this.sendMessage(chatId, formatted, { parse_mode: "Markdown" }).catch(() => {
      return this.sendMessage(chatId, `Manager: ${text}`);
    });
  }

  async notifyCheckpoint(item: { checkpointId: string; title: string; summary: string; action?: string; workspaceId?: string }): Promise<void> {
    const chatId = this.allowedChatId;
    if (!chatId) return;

    let body = `🚨 *YÊU CẦU DUYỆT CHECKPOINT*\n\n📌 *Tiêu đề:* ${item.title}\n📝 *Mô tả:* ${item.summary}`;
    if (item.action) {
      body += `\n⚙️ *Hành động:* \`${item.action}\``;
    }

    const inline_keyboard = [
      [
        { text: "✅ Duyệt (Approve)", callback_data: `approve:${item.checkpointId}` },
        { text: "❌ Từ chối (Reject)", callback_data: `reject:${item.checkpointId}` },
      ],
    ];

    await this.sendMessage(chatId, body, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard },
    }).catch(() => {
      // Plain text fallback
      const plain = `YÊU CẦU DUYỆT CHECKPOINT\nTiêu đề: ${item.title}\nMô tả: ${item.summary}${item.action ? `\nHành động: ${item.action}` : ""}`;
      return this.sendMessage(chatId, plain, { reply_markup: { inline_keyboard } });
    });
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const timeoutSignal = AbortSignal.timeout(35000);
        const signal = this.abortController
          ? AbortSignal.any([this.abortController.signal, timeoutSignal])
          : timeoutSignal;

        const res = await this.fetchApi("getUpdates", {
          offset: this.lastUpdateId ? this.lastUpdateId + 1 : 0,
          timeout: 25,
        }, signal);

        if (res.ok && Array.isArray(res.result)) {
          for (const update of res.result) {
            if (update.update_id > this.lastUpdateId) {
              this.lastUpdateId = update.update_id;
            }
            await this.handleUpdate(update);
          }
        }
      } catch (err: any) {
        if (!this.running) break;
        // Rate limit 429
        if (err.status === 429 && err.parameters?.retry_after) {
          const delaySec = Number(err.parameters.retry_after) + 1;
          await new Promise(r => setTimeout(r, delaySec * 1000));
          continue;
        }
      }

      if (this.running) {
        await new Promise(r => setTimeout(r, this.pollIntervalMs));
      }
    }
  }

  private async handleUpdate(update: any): Promise<void> {
    if (update.message) {
      await this.handleMessage(update.message);
    } else if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query);
    }
  }

  private async handleMessage(msg: any): Promise<void> {
    const chatId = msg.chat?.id;
    const text = String(msg.text || "").trim();
    if (!chatId || !text) return;

    // Check pairing
    if (!this.auth.isPaired(chatId) && String(chatId) !== this.allowedChatId) {
      if (text.startsWith("/pair")) {
        const parts = text.split(/\s+/);
        const code = parts[1] || "";
        const res = this.auth.verifyPairingCode(code, msg.chat);
        if (res.ok) {
          this.allowedChatId = String(chatId);
          this.onChatPaired?.(String(chatId));
          await this.sendMessage(chatId, "🎉 Kết nối ghép đôi thành công! Giờ đây bạn có thể chat trực tiếp với Manager.");
        } else {
          await this.sendMessage(chatId, `❌ Ghép đôi thất bại: ${res.reason}`);
        }
        return;
      }

      await this.sendMessage(
        chatId,
        "🔒 Bot chưa được ghép đôi với tài khoản Agent Company của bạn.\nVui lòng mở Cài đặt trên ứng dụng web để lấy mã 6 số và gõ lệnh:\n`/pair <mã 6 số>`",
        { parse_mode: "Markdown" },
      );
      return;
    }

    // Command handling
    if (text === "/start" || text === "/help") {
      const help = "🤖 *Agent Company Remote Bot*\n\n" +
        "• Gõ tin nhắn bất kỳ để giao việc cho Manager\n" +
        "• Khi có Checkpoint cần duyệt, bot sẽ gửi thông báo kèm nút bấm\n" +
        "• Gõ `/status` để xem trạng thái lượt chạy hiện tại\n";
      await this.sendMessage(chatId, help, { parse_mode: "Markdown" });
      return;
    }

    if (text === "/status") {
      const ctx = this.getContext();
      if (!ctx) {
        await this.sendMessage(chatId, "Không tìm thấy workspace mặc định.");
        return;
      }
      const active = ctx.router.activeRunId();
      const statusText = active ? `⏳ Đang có lần chạy đang hoạt động: \`${active}\`` : "💤 Manager hiện đang rảnh rỗi (idle).";
      await this.sendMessage(chatId, statusText, { parse_mode: "Markdown" });
      return;
    }

    // Default: Dispatch as User Message to Router
    const ctx = this.getContext();
    if (!ctx) {
      await this.sendMessage(chatId, "⚠️ Không tìm thấy workspace hoạt động để chuyển tin nhắn.");
      return;
    }

    ctx.router.sendUserMessage(text);
    await this.sendMessage(chatId, "📨 Đã chuyển tin nhắn đến Manager.");
  }

  private async handleCallbackQuery(cb: any): Promise<void> {
    const cbId = cb.id;
    const data = String(cb.data || "");
    const [action, checkpointId] = data.split(":");

    await this.answerCallbackQuery(cbId, "Đang xử lý...").catch(() => {});

    if (!checkpointId || !["approve", "reject"].includes(action)) return;

    const ctx = this.getContext();
    if (!ctx) return;

    const decision = action === "approve" ? "approve" : "reject";
    const ok = ctx.router.replyApproval(checkpointId, decision, "Từ Telegram Bot");

    const msg = cb.message;
    if (msg) {
      const originalText = msg.text || "";
      const statusIcon = decision === "approve" ? "✅ ĐÃ DUYỆT" : "❌ ĐÃ TỪ CHỐI";
      const updatedText = `${originalText}\n\n${statusIcon} (qua Telegram)`;

      await this.editMessageText(msg.chat.id, msg.message_id, updatedText, {
        reply_markup: { inline_keyboard: [] },
      }).catch(() => {});
    }
  }
}
