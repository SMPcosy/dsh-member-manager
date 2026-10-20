/**
 * company-ledger.mjs 单元测试：订单状态机、attempt 凭证、幂等、依赖解锁。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LEDGER_VERSION,
  ORDER_STATES,
  emptyLedger,
  createOrder,
  getOrder,
  transitionOrder,
  assignAttempt,
  invalidateAttempt,
  reportAttempt,
  appendAudit,
  isOrderReady,
  LedgerError,
} from "../src/shared/company-ledger.mjs";

const NOW = "2026-10-20T09:00:00.000Z";

function makeLedger() {
  return emptyLedger(NOW);
}

test("emptyLedger 返回 version 1 与空数组", () => {
  const l = makeLedger();
  assert.equal(l.version, LEDGER_VERSION);
  assert.deepEqual(l.orders, []);
  assert.deepEqual(l.audit, []);
  assert.equal(typeof l.clientMap, "object");
});

test("createOrder 生成订单并补齐默认值", () => {
  let l = makeLedger();
  ({ ledger: l } = createOrder(l, { type: "code_impl", title: "修复 bug" }, NOW));
  const o = l.orders[0];
  assert.ok(o.id);
  assert.equal(o.state, "queued");
  assert.equal(o.priority, "normal");
  assert.deepEqual(o.deps, []);
  assert.deepEqual(o.attempts, []);
  assert.deepEqual(o.acceptance, []);
});

test("createOrder 支持 clientOrderId 幂等", () => {
  let l = makeLedger();
  const input = { clientOrderId: "client-1", type: "code_impl", title: "a" };
  ({ ledger: l } = createOrder(l, input, NOW));
  const first = l.orders[0];
  ({ ledger: l } = createOrder(l, { ...input, title: "changed" }, NOW));
  assert.equal(l.orders.length, 1);
  assert.equal(getOrder(l, first.id).title, "a");
});

test("状态机：允许合法转移 queued -> routed -> running -> done", () => {
  let l = makeLedger();
  ({ ledger: l } = createOrder(l, { type: "code_impl", title: "t" }, NOW));
  const id = l.orders[0].id;
  l = transitionOrder(l, id, "routed");
  assert.equal(getOrder(l, id).state, "routed");
  l = transitionOrder(l, id, "running");
  assert.equal(getOrder(l, id).state, "running");
  l = transitionOrder(l, id, "done");
  assert.equal(getOrder(l, id).state, "done");
});

test("状态机：非法转移抛出 LedgerError", () => {
  let l = makeLedger();
  ({ ledger: l } = createOrder(l, { type: "code_impl", title: "t" }, NOW));
  const id = l.orders[0].id;
  assert.throws(() => transitionOrder(l, id, "done"), LedgerError);
  l = transitionOrder(l, id, "routed");
  assert.throws(() => transitionOrder(l, id, "done"), LedgerError);
});

test("assignAttempt 创建 attempt 并附到订单", () => {
  let l = makeLedger();
  ({ ledger: l } = createOrder(l, { type: "code_impl", title: "t" }, NOW));
  const orderId = l.orders[0].id;
  ({ ledger: l } = assignAttempt(l, orderId, "A1", "s-1", NOW));
  const order = getOrder(l, orderId);
  assert.equal(order.attempts.length, 1);
  assert.equal(order.attempts[0].employee, "A1");
  assert.equal(order.attempts[0].sessionId, "s-1");
  assert.ok(order.attempts[0].id);
});

test("invalidateAttempt 后，reportAttempt 拒绝陈旧 attempt", () => {
  let l = makeLedger();
  ({ ledger: l } = createOrder(l, { type: "code_impl", title: "t" }, NOW));
  const orderId = l.orders[0].id;
  ({ ledger: l } = assignAttempt(l, orderId, "A1", "s-1", NOW));
  const attemptId = l.orders[0].attempts[0].id;
  l = transitionOrder(l, orderId, "routed");
  l = transitionOrder(l, orderId, "running");
  l = invalidateAttempt(l, orderId, attemptId);
  assert.equal(getOrder(l, orderId).attempts[0].invalidated, true);
  assert.throws(() => reportAttempt(l, orderId, attemptId, "done", {}), /STALE|stale/);
});

test("deps 未满足时无法转到 running", () => {
  let l = makeLedger();
  ({ ledger: l } = createOrder(l, { type: "code_impl", title: "dep" }, NOW));
  const depId = l.orders[0].id;
  ({ ledger: l } = createOrder(l, { type: "code_impl", title: "main", deps: [depId] }, NOW));
  const mainId = l.orders[1].id;
  l = transitionOrder(l, mainId, "routed");
  assert.throws(() => transitionOrder(l, mainId, "running"), LedgerError);
});

test("deps 完成后主单可继续运行", () => {
  let l = makeLedger();
  ({ ledger: l } = createOrder(l, { type: "code_impl", title: "dep" }, NOW));
  const depId = l.orders[0].id;
  ({ ledger: l } = createOrder(l, { type: "code_impl", title: "main", deps: [depId] }, NOW));
  const mainId = l.orders[1].id;
  l = transitionOrder(l, mainId, "routed");
  l = transitionOrder(l, depId, "running");
  l = transitionOrder(l, depId, "done");
  l = transitionOrder(l, mainId, "running");
  assert.equal(getOrder(l, mainId).state, "running");
});

test("appendAudit 追加审计且不可变", () => {
  let l = makeLedger();
  l = appendAudit(l, { ts: NOW, action: "test" });
  assert.equal(l.audit.length, 1);
  assert.equal(l.audit[0].action, "test");
});

test("isOrderReady 基于 deps 完成状态", () => {
  let l = makeLedger();
  ({ ledger: l } = createOrder(l, { type: "code_impl", title: "dep" }, NOW));
  const depId = l.orders[0].id;
  ({ ledger: l } = createOrder(l, { type: "code_impl", title: "main", deps: [depId] }, NOW));
  const mainId = l.orders[1].id;
  assert.equal(isOrderReady(l, mainId), false);
  l = transitionOrder(l, depId, "done");
  assert.equal(isOrderReady(l, mainId), true);
});
