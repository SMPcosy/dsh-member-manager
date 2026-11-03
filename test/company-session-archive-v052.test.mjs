/**
 * v0.5.2 会话归属与异常归档：
 * 1. 下单时把发起会话写进账本（company_order / company_plan 走 exec 快照）；
 * 2. 面板直接派活时补写归属，已有归属不覆盖；
 * 3. clearExceptionHistory 真的删单、按会话划定范围、无归属老单跟随当前会话一起清，
 *    并把实际删除条数写进审计。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCompanyRuntime } from "../src/host/company-runtime.mjs";

function makeCtx() {
  return {
    get() {
      return undefined;
    },
    effect() {
      return () => {};
    },
  };
}

const tmpDir = (tag) =>
  path.join(os.tmpdir(), `dsh-mm-sess-${tag}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);

async function boot(tag) {
  const dataDir = tmpDir(tag);
  const rt = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt.boot();
  const route = rt.routes.find((r) => r.method === "POST" && r.path === "/company/op");
  assert.ok(route, "面板 op 路由应存在");
  const call = (action, args = {}) => route.handler({}, new URL("http://localhost/company/op"), { action, args });
  return { rt, dataDir, call };
}

async function ledgerFile(dataDir) {
  return path.join(dataDir, "company", "company.json");
}

async function readOrders(dataDir) {
  const doc = JSON.parse(await fs.readFile(await ledgerFile(dataDir), "utf8"));
  return (doc.ledger || doc).orders || [];
}

async function readAudit(dataDir) {
  try {
    const raw = await fs.readFile(path.join(dataDir, "company", "audit.jsonl"), "utf8");
    return raw
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

/** 直接把磁盘账本里某单的会话归属抹掉，模拟升级前的老单。 */
async function stripSession(dataDir, orderId) {
  const file = await ledgerFile(dataDir);
  const doc = JSON.parse(await fs.readFile(file, "utf8"));
  const orders = (doc.ledger || doc).orders || [];
  const order = orders.find((o) => o.id === orderId);
  assert.ok(order, "要抹归属的订单应存在");
  delete order.sessionId;
  delete order.sessionTitle;
  await fs.writeFile(file, JSON.stringify(doc, null, 2), "utf8");
}

test("v0.5.2 下单写入会话归属：placeOrder 落库 sessionId 与会话标题快照", async () => {
  const { rt, dataDir, call } = await boot("place");
  try {
    const res = await call("placeOrder", {
      type: "bugfix",
      title: "会话一派的活",
      sessionId: "s1",
      sessionTitle: "修看板异常",
    });
    assert.equal(res.ok, true);
    const order = (await readOrders(dataDir)).find((o) => o.id === res.orderId);
    assert.equal(order.sessionId, "s1");
    assert.equal(order.sessionTitle, "修看板异常");
  } finally {
    await rt.shutdown();
  }
});

test("v0.5.2 异常归档：按会话清理真删单、保留别的会话、无归属老单跟随当前会话", async () => {
  const { rt, dataDir, call } = await boot("clear");
  try {
    const mine = await call("placeOrder", {
      type: "bugfix",
      title: "本会话的取消单",
      sessionId: "s1",
      sessionTitle: "会话一",
    });
    const other = await call("placeOrder", {
      type: "bugfix",
      title: "别的会话的取消单",
      sessionId: "s2",
      sessionTitle: "会话二",
    });
    const legacy = await call("placeOrder", { type: "bugfix", title: "升级前的老单" });
    await stripSession(dataDir, legacy.orderId);

    for (const id of [mine.orderId, other.orderId, legacy.orderId]) {
      const res = await call("cancelOrder", { orderId: id });
      assert.equal(res.ok, true, `取消 ${id} 应成功`);
    }
    assert.equal((await readOrders(dataDir)).filter((o) => o.state === "cancelled").length, 3);

    const cleared = await call("clearExceptionHistory", { sessionId: "s1" });
    assert.equal(cleared.ok, true);
    assert.equal(cleared.count, 2, "本会话 1 条 + 无归属老单 1 条");

    const left = await readOrders(dataDir);
    assert.deepEqual(
      left.map((o) => o.id),
      [other.orderId],
      "别的会话的取消单要留着",
    );

    const audit = (await readAudit(dataDir)).filter((e) => e.type === "exception_history_cleared");
    assert.equal(audit.length, 1, "清理要留审计");
    assert.equal(audit[0].count, 2);
    assert.equal(audit[0].sessionId, "s1");

    const all = await call("clearExceptionHistory");
    assert.equal(all.ok, true);
    assert.equal(all.count, 1, "不带范围时清掉剩余的取消单");
    assert.deepEqual(await readOrders(dataDir), []);
  } finally {
    await rt.shutdown();
  }
});

test("v0.5.2 面板派活补写归属：assignOrder 只补空缺，不覆盖已有会话", async () => {
  const { rt, dataDir, call } = await boot("assign");
  try {
    const res = await call("placeOrder", { type: "bugfix", title: "等派工的单" });
    assert.equal(res.ok, true);
    // 派工本身可能因容量路由失败，但归属补写发生在派工之前，必须已落库。
    await call("assignOrder", { orderId: res.orderId, sessionId: "s9", sessionTitle: "会话九" });
    let order = (await readOrders(dataDir)).find((o) => o.id === res.orderId);
    assert.equal(order.sessionId, "s9", "空缺归属要补上");

    await call("assignOrder", { orderId: res.orderId, sessionId: "s10", sessionTitle: "会话十" });
    order = (await readOrders(dataDir)).find((o) => o.id === res.orderId);
    assert.equal(order.sessionId, "s9", "已有归属不能被后来的会话顶掉");

    const audit = (await readAudit(dataDir)).filter((e) => e.type === "order_session_stamped");
    assert.equal(audit.length, 1, "只有真正补写的那次留痕");
  } finally {
    await rt.shutdown();
  }
});
