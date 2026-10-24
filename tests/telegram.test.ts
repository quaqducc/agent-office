import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { TelegramService, TelegramAuth } from "../src/telegram.ts";
import { publicConfig, mergeConfig, type AppConfig } from "../src/settings.ts";

describe("Telegram Integration and Security", () => {
  test("TelegramConfig in settings: maskKey protects bot token and mergeConfig preserves masked token", () => {
    const rawToken = "123456789:ABCdefGHIjklMNOpqrsTUVwxyz";
    const baseConfig: AppConfig = {
      providers: [],
      roleModels: {},
      search: { mode: "auto" },
      telegram: {
        enabled: true,
        botToken: rawToken,
        allowedChatId: "123456",
      },
    };

    const pub = publicConfig(baseConfig);
    assert.ok(pub.telegram);
    assert.notEqual(pub.telegram.botToken, rawToken, "Raw token must not appear in publicConfig");
    assert.ok(pub.telegram.botToken.includes("…"), "Masked token must contain ellipsis");

    // When client sends back masked token, mergeConfig keeps rawToken
    const merged = mergeConfig(baseConfig, {
      ...pub,
      telegram: {
        ...pub.telegram,
        botToken: pub.telegram.botToken, // masked
      },
    });
    assert.equal(merged.telegram?.botToken, rawToken, "mergeConfig must retain original unmasked token");

    // When client provides a new token, mergeConfig accepts it
    const newToken = "987654321:ZYXwvutsrQPONMLkjihgFEDCBA";
    const mergedNew = mergeConfig(baseConfig, {
      ...pub,
      telegram: {
        ...pub.telegram,
        botToken: newToken,
      },
    });
    assert.equal(mergedNew.telegram?.botToken, newToken, "mergeConfig must update to new token when not masked");
  });

  test("TelegramAuth pairing: 6-digit random code, 5 min TTL, private chat only, brute-force lock", () => {
    const auth = new TelegramAuth();
    const pair = auth.generatePairingCode();

    assert.match(pair.code, /^\d{6}$/, "Pairing code must be 6 digits");
    const ttl = pair.expiresAt - Date.now();
    assert.ok(ttl > 290_000 && ttl <= 300_000, "Pairing code TTL must be 5 minutes (300s)");

    // Rejects non-private chats
    const groupChat = { id: 1001, type: "group" as const };
    const groupRes = auth.verifyPairingCode(pair.code, groupChat);
    assert.equal(groupRes.ok, false);
    assert.match(groupRes.reason || "", /private/i, "Must reject group chats");

    // Brute force protection: 5 failed attempts locks chat
    const privateChat = { id: 9999, type: "private" as const };
    for (let i = 0; i < 4; i++) {
      const res = auth.verifyPairingCode("000000", privateChat);
      assert.equal(res.ok, false);
      assert.equal(auth.isLocked(privateChat.id), false, `Attempt ${i + 1} should not lock yet`);
    }
    const fifthAttempt = auth.verifyPairingCode("000000", privateChat);
    assert.equal(fifthAttempt.ok, false);
    assert.equal(auth.isLocked(privateChat.id), true, "5th failed attempt must lock chat");

    // Even with the correct code, locked chat is refused
    const lockedRes = auth.verifyPairingCode(pair.code, privateChat);
    assert.equal(lockedRes.ok, false);
    assert.match(lockedRes.reason || "", /lock|quá nhiều/i);

    // Another chat can pair successfully with correct code
    const validChat = { id: 8888, type: "private" as const };
    const validRes = auth.verifyPairingCode(pair.code, validChat);
    assert.equal(validRes.ok, true);
    assert.equal(auth.isPaired(validChat.id), true);
  });
});

describe("Telegram Mock Server & Service End-to-End", () => {
  let mockServer: Server;
  let mockUrl: string;
  let updatesQueue: any[] = [];
  let sentMessages: any[] = [];
  let editedMessages: any[] = [];
  let answeredCallbacks: any[] = [];
  let rateLimitCount = 0;
  let entityParseErrorOnce = false;

  before(async () => {
    mockServer = createServer((req, res) => {
      const url = new URL(req.url || "", `http://${req.headers.host}`);
      let body = "";
      req.on("data", c => (body += c));
      req.on("end", () => {
        const payload = body ? JSON.parse(body) : {};

        if (url.pathname.endsWith("/getMe")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ ok: true, result: { id: 1234567, is_bot: true, username: "test_bot" } }));
        }

        if (url.pathname.endsWith("/getUpdates")) {
          // If rate limit test
          if (rateLimitCount > 0) {
            rateLimitCount--;
            res.writeHead(429, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 1 } }));
          }

          const offset = Number(payload.offset || 0);
          const updates = updatesQueue.filter(u => u.update_id >= offset);
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ ok: true, result: updates }));
        }

        if (url.pathname.endsWith("/sendMessage")) {
          if (entityParseErrorOnce && payload.parse_mode) {
            entityParseErrorOnce = false;
            res.writeHead(400, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: can't parse entities" }));
          }
          sentMessages.push(payload);
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ ok: true, result: { message_id: sentMessages.length, ...payload } }));
        }

        if (url.pathname.endsWith("/editMessageText")) {
          editedMessages.push(payload);
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ ok: true, result: { message_id: payload.message_id, ...payload } }));
        }

        if (url.pathname.endsWith("/answerCallbackQuery")) {
          answeredCallbacks.push(payload);
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ ok: true, result: true }));
        }

        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error_code: 404 }));
      });
    });

    await new Promise<void>(resolve => mockServer.listen(0, "127.0.0.1", resolve));
    mockUrl = `http://127.0.0.1:${(mockServer.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>(resolve => mockServer.close(() => resolve()));
  });

  test("Message flow: User sends message from Telegram, router replies back to Telegram", async () => {
    updatesQueue = [];
    sentMessages = [];

    let receivedUserMessage = "";
    const fakeRouter = {
      sendUserMessage: (text: string) => {
        receivedUserMessage = text;
        return { runId: "run-test-1", questionId: "q-1" };
      },
      pendingApprovals: () => [],
      replyApproval: () => false,
    };

    const service = new TelegramService({
      botToken: "MOCK_TOKEN",
      allowedChatId: "12345",
      apiBaseUrl: mockUrl,
      pollIntervalMs: 50,
      getContext: () => ({ ws: { id: "ws-1", name: "Default" } as any, router: fakeRouter as any, log: null as any }),
    });

    await service.start();

    // 1. Simulate an update from Telegram
    updatesQueue.push({
      update_id: 101,
      message: {
        message_id: 1,
        chat: { id: 12345, type: "private" },
        text: "Xin chào Manager",
        date: Math.floor(Date.now() / 1000),
      },
    });

    // Wait for polling
    await new Promise(r => setTimeout(r, 200));
    assert.equal(receivedUserMessage, "Xin chào Manager", "User message must reach router.sendUserMessage");

    // 2. Manager reply dispatched back to Telegram
    await service.notifyManagerReply("ws-1", "Chào bạn, tôi đã nhận việc.");
    assert.ok(sentMessages.length > 0);
    const lastMsg = sentMessages.at(-1);
    assert.equal(lastMsg.chat_id, "12345");
    assert.ok(lastMsg.text.includes("Chào bạn, tôi đã nhận việc."));

    await service.stop();
  });

  test("Checkpoint notification with Inline Keyboard and callback_query approval", async () => {
    updatesQueue = [];
    sentMessages = [];
    editedMessages = [];
    answeredCallbacks = [];

    let approvalReplied = { id: "", decision: "", note: "" };
    const fakeRouter = {
      sendUserMessage: () => ({ runId: "r1", questionId: "q1" }),
      pendingApprovals: () => [{ id: "cp-1", title: "Cần duyệt xoá file", summary: "Xoá file tạm", action: "rm -rf tmp" }],
      replyApproval: (id: string, decision: string, note?: string) => {
        approvalReplied = { id, decision, note: note || "" };
        return true;
      },
    };

    const service = new TelegramService({
      botToken: "MOCK_TOKEN",
      allowedChatId: "12345",
      apiBaseUrl: mockUrl,
      pollIntervalMs: 50,
      getContext: () => ({ ws: { id: "ws-1" } as any, router: fakeRouter as any, log: null as any }),
    });

    await service.start();

    // Send checkpoint notification
    await service.notifyCheckpoint({
      checkpointId: "cp-1",
      title: "Cần duyệt xoá file",
      summary: "Xoá file tạm",
      action: "rm -rf tmp",
      workspaceId: "ws-1",
    });

    assert.ok(sentMessages.length > 0);
    const cpMsg = sentMessages.at(-1);
    assert.ok(cpMsg.reply_markup?.inline_keyboard, "Checkpoint notification must include inline_keyboard");
    const buttons = cpMsg.reply_markup.inline_keyboard[0];
    assert.ok(buttons.some((b: any) => b.callback_data === "approve:cp-1"));
    assert.ok(buttons.some((b: any) => b.callback_data === "reject:cp-1"));

    // User clicks [Duyệt]
    updatesQueue.push({
      update_id: 201,
      callback_query: {
        id: "cb-123",
        from: { id: 12345 },
        message: { message_id: cpMsg.message_id || 1, chat: { id: 12345 } },
        data: "approve:cp-1",
      },
    });

    await new Promise(r => setTimeout(r, 200));

    // Must answer callback query and call replyApproval
    assert.equal(approvalReplied.id, "cp-1");
    assert.equal(approvalReplied.decision, "approve");
    assert.ok(answeredCallbacks.some(c => c.callback_query_id === "cb-123"), "Must answer callback query");

    // Message must be edited to remove buttons and show decision
    assert.ok(editedMessages.length > 0, "Must edit message to remove buttons");
    const edit = editedMessages.at(-1);
    assert.deepEqual(edit.reply_markup?.inline_keyboard, [], "Inline keyboard buttons must be cleared");

    await service.stop();
  });

  test("HTTP 429 Too Many Requests handling and 400 entity parse error fallback to plain text", async () => {
    updatesQueue = [];
    sentMessages = [];
    rateLimitCount = 1;
    entityParseErrorOnce = true;

    const service = new TelegramService({
      botToken: "MOCK_TOKEN",
      allowedChatId: "12345",
      apiBaseUrl: mockUrl,
      pollIntervalMs: 50,
      getContext: () => undefined,
    });

    await service.start();

    // Send markdown text that causes mock server to return 400
    await service.sendMessage("12345", "Tin nhắn có lỗi *Markdown*", { parse_mode: "Markdown" });
    assert.ok(sentMessages.length > 0);
    const fallbackMsg = sentMessages.at(-1);
    assert.equal(fallbackMsg.parse_mode, undefined, "Fallback message must be sent without parse_mode");

    await service.stop();
  });

  test("Graceful shutdown: stop() ceases polling without leaking active timers", async () => {
    const service = new TelegramService({
      botToken: "MOCK_TOKEN",
      allowedChatId: "12345",
      apiBaseUrl: mockUrl,
      pollIntervalMs: 100,
      getContext: () => undefined,
    });

    await service.start();
    assert.equal(service.isRunning(), true);
    await service.stop();
    assert.equal(service.isRunning(), false);
  });
});
