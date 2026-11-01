/**
 * inbox-message-id.test.mjs
 * 回归：收件箱消息必须带唯一 id。
 *
 * 背景（2026-10-30 弹窗事故）：内核 dsh-agent-loop 在插入消息前会检查
 *   if (ids.has(message.id)) throw new Error(`message "${message.id}" is already pending`)
 * ids 里已经收着上一次 pending 消息的 id。插件早期构造的消息**没有 id 字段**，
 * 于是第二次插入时 Set 里已有 undefined，必然抛
 *   message "undefined" is already pending
 * 这条错误在 shutdown 时打出来，掩盖了真正致命的 turn/end reason=null。
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildUserMessage, makeIdleMessage, newMessageId } from "../src/host/company-compat.mjs";

test("newMessageId：前缀 + 唯一值", () => {
  const a = newMessageId("order-x");
  const b = newMessageId("order-x");
  assert.ok(a.startsWith("order-x-"), a);
  assert.notEqual(a, b);
});

test("buildUserMessage：带非空唯一 id", () => {
  const m1 = buildUserMessage({ text: "派单", attemptId: "a1", orderId: "o1" });
  const m2 = buildUserMessage({ text: "派单", attemptId: "a1", orderId: "o1" });
  assert.equal(typeof m1.id, "string");
  assert.ok(m1.id.length > 0);
  assert.notEqual(m1.id, m2.id, "同一 attempt 连续两次派单也必须不同 id");
  assert.ok(m1.id.startsWith("order-a1"), m1.id);
});

test("buildUserMessage：无 attemptId 时用 company 前缀", () => {
  const m = buildUserMessage({ text: "x" });
  assert.ok(m.id.startsWith("company-"), m.id);
});

test("makeIdleMessage：带非空唯一 id，会话名进入前缀", () => {
  const m1 = makeIdleMessage("shutdown", "sess-1");
  const m2 = makeIdleMessage("shutdown", "sess-1");
  assert.ok(m1.id.startsWith("idle-sess-1"), m1.id);
  assert.notEqual(m1.id, m2.id);
  assert.ok(makeIdleMessage("shutdown").id.startsWith("idle-anon"));
});

test("模拟内核去重：连插两条不再撞 undefined", () => {
  const pending = new Set();
  const insert = (message) => {
    if (pending.has(message.id)) throw new Error(`message "${message.id}" is already pending`);
    pending.add(message.id);
  };
  assert.doesNotThrow(() => {
    insert(buildUserMessage({ text: "第一条", attemptId: "a1" }));
    insert(buildUserMessage({ text: "第二条", attemptId: "a1" }));
    insert(makeIdleMessage("shutdown", "s1"));
    insert(makeIdleMessage("shutdown", "s1"));
  });
});
