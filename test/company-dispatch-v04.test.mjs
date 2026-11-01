/**
 * v0.4 派工链路回归：真派工 / 依赖门禁 / 容量门禁 / 冷恢复 / 搁浅回收 / 临时工。
 * 这些用例锁的是「下达任务后真的能分配到成员」这条主链路，任何一条红都代表工作网是假的。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { createDispatcher } from "../src/host/company-dispatcher.mjs";
import { createEmployeeSessionManager } from "../src/host/company-employees.mjs";
import { CompanyStore } from "../src/shared/company-store.mjs";
import {
  emptyCompany,
  createDepartment,
  createEmployee,
  EMPLOYEE_STATE,
} from "../src/shared/company-org.mjs";
import { emptyLedger, ORDER_STATES, markAttemptStale } from "../src/shared/company-ledger.mjs";

function makeCtx() {
  let id = 0;
  const started = [];
  return {
    started,
    get(name) {
      if (name === "subagents") {
        return {
          // 记录整个参数：ensureSession 传 request，wakeAgent 的回退分支传 prompt
          async startActivation(arg) {
            id += 1;
            started.push(arg);
            return { childId: `session-${id}`, cancel() {}, dispose() {} };
          },
        };
      }
      if (name === "agents") return { async get() { return null; } };
      return undefined;
    },
  };
}

function tmpDir(tag) {
  return `/tmp/dsh-mm-v04-${tag}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

/** 部门 A：accepts 命中「修复」；routingRules 默认空——正是真实环境里订单派不出去的那套配置。 */
function makeRuntime(ctx, extra = {}) {
  let company = emptyCompany();
  company = createDepartment(company, { id: "A", name: "工程部", accepts: ["修复", "开发"], capacity: 4 });
  company = createEmployee(company, {
    id: "e1",
    displayName: "员工1",
    department: "A",
    role: "staff",
    skills: ["typescript"],
    state: "idle",
  });
  company = createEmployee(company, {
    id: "e2",
    displayName: "员工2",
    department: "A",
    role: "staff",
    skills: ["typescript"],
    state: "idle",
  });
  if (extra.company) company = extra.company(company);
  return {
    ctx,
    company,
    config: Object.assign({ routingRules: [], limits: {} }, extra.config || {}),
    provider: "fake",
    ledger: emptyLedger(),
    ownerAgent: { id: "owner" },
  };
}

async function setup(tag, extra) {
  const ctx = makeCtx();
  const runtime = makeRuntime(ctx, extra);
  const dataDir = tmpDir(tag);
  runtime.dataDir = dataDir;
  const store = new CompanyStore(dataDir, { now: () => "2026-01-01T00:00:00.000Z" });
  await store.saveCompany(runtime.company);
  const employeeManager = createEmployeeSessionManager({ runtime, logger: console });
  const dispatcher = createDispatcher({ runtime, store, employeeManager, logger: console });
  return {
    ctx,
    runtime,
    store,
    dataDir,
    dispatcher,
    cleanup: () => rm(dataDir, { recursive: true, force: true }),
  };
}

test("v0.4 真派工：routingRules 为空时按部门 accepts 回退，订单不再卡在 routed", async () => {
  const s = await setup("accepts");
  try {
    const place = await s.dispatcher.placeOrder({ type: "code_impl", title: "修复登录 bug" });
    const res = await s.dispatcher.routeAndAssign(place.orderId);
    assert.equal(res.ok, true, "应派工成功：" + JSON.stringify(res));
    assert.equal(res.deptId, "A", "accepts 命中工程部");
    assert.equal(res.routeReason, "accepts", "回退路径应记录为 accepts");
    assert.ok(res.attemptId, "必须真的生成 attempt");
    assert.ok(s.ctx.started.length >= 1, "必须真的唤醒成员会话");

    const order = s.runtime.ledger.orders.find((o) => o.id === place.orderId);
    assert.equal(order.state, ORDER_STATES.RUNNING);
    assert.equal(order.employee, res.employeeId);
    const emp = s.runtime.company.employees.find((e) => e.id === res.employeeId);
    assert.equal(emp.state, EMPLOYEE_STATE.WORKING);
    assert.equal(emp.currentOrderId, place.orderId);
  } finally {
    await s.cleanup();
  }
});

test("v0.4 唤起消息带完整派工单：标题/验收标准/attemptId/回报要求", async () => {
  const s = await setup("prompt");
  try {
    const place = await s.dispatcher.placeOrder({
      type: "code_impl",
      title: "实现导出功能",
      detail: "导出 CSV",
      acceptance: "能下载 csv",
      priority: "high",
    });
    const res = await s.dispatcher.routeAndAssign(place.orderId);
    assert.equal(res.ok, true);
    const text = JSON.stringify(s.ctx.started.at(-1));
    assert.ok(text.includes("实现导出功能"), "缺标题：" + text);
    assert.ok(text.includes("能下载 csv"), "缺验收标准：" + text);
    assert.ok(text.includes(res.attemptId), "缺 attemptId：" + text);
    assert.ok(text.includes("company_report"), "缺回报要求：" + text);
  } finally {
    await s.cleanup();
  }
});

test("v0.4 依赖门禁：上游未完成时拒绝派工并回报 blockedBy", async () => {
  const s = await setup("deps");
  try {
    const up = await s.dispatcher.placeOrder({ type: "code_impl", title: "先做 A" });
    const down = await s.dispatcher.placeOrder({ type: "code_impl", title: "再做 B", deps: [up.orderId] });
    const res = await s.dispatcher.routeAndAssign(down.orderId);
    assert.equal(res.ok, false);
    assert.equal(res.code, "E_DEPS");
    assert.deepEqual(res.blockedBy, [up.orderId]);
    const order = s.runtime.ledger.orders.find((o) => o.id === down.orderId);
    assert.equal(order.state, ORDER_STATES.QUEUED, "依赖未满足的订单应留在 queued 等下一轮");
  } finally {
    await s.cleanup();
  }
});

test("v0.4 容量门禁：部门 capacity 满了返回 E_CAPACITY，不硬塞", async () => {
  const s = await setup("cap", {
    company: (c) => {
      // 单岗部门：只能塞一个在跑的单
      const depts = c.departments.map((d) => (d.id === "A" ? Object.assign({}, d, { capacity: 1 }) : d));
      return Object.assign({}, c, { departments: depts });
    },
  });
  try {
    const one = await s.dispatcher.placeOrder({ type: "code_impl", title: "修复 1" });
    const two = await s.dispatcher.placeOrder({ type: "code_impl", title: "修复 2" });
    const r1 = await s.dispatcher.routeAndAssign(one.orderId);
    assert.equal(r1.ok, true);
    const r2 = await s.dispatcher.routeAndAssign(two.orderId);
    assert.equal(r2.ok, false);
    assert.equal(r2.code, "E_CAPACITY");
    const order = s.runtime.ledger.orders.find((o) => o.id === two.orderId);
    assert.equal(order.state, ORDER_STATES.QUEUED);
    assert.ok(order.retryAfter, "应写入 retryAfter，避免同一轮空转");
  } finally {
    await s.cleanup();
  }
});

test("v0.4 冷恢复：新 dispatcher.hydrate 把上一进程的 running attempt 判 stale 并放回 queued", async () => {
  const s = await setup("cold");
  try {
    const place = await s.dispatcher.placeOrder({ type: "code_impl", title: "修复登录 bug" });
    const res = await s.dispatcher.routeAndAssign(place.orderId);
    assert.equal(res.ok, true);

    // 模拟宿主重启：同一 dataDir 上起一个全新 dispatcher，内存索引为空
    const booted = createDispatcher({
      runtime: s.runtime,
      store: s.store,
      employeeManager: createEmployeeSessionManager({ runtime: s.runtime, logger: console }),
      logger: console,
    });
    const out = await booted.hydrate({ recoverOrphans: true });
    assert.deepEqual(out.recovered, [place.orderId], "应恢复在跑的订单");
    const order = s.runtime.ledger.orders.find((o) => o.id === place.orderId);
    assert.equal(order.state, ORDER_STATES.QUEUED);
    const attempt = order.attempts.find((a) => a.id === res.attemptId);
    assert.equal(attempt.invalidated, true);
    assert.equal(attempt.state, "stale");
    assert.equal(attempt.staleReason, "host_restart");

    const report = await booted.report({ attemptId: res.attemptId, status: "done" });
    assert.equal(report.ok, false, "旧 attempt 不可回报");
    assert.equal(report.code, "E_STALE_ATTEMPT");
  } finally {
    await s.cleanup();
  }
});

test("v0.4 冷恢复后能重新派出去：新 attempt 编号递增，且旧 attempt 已吊销", async () => {
  const s = await setup("rerun");
  try {
    const place = await s.dispatcher.placeOrder({ type: "code_impl", title: "修复登录 bug" });
    const first = await s.dispatcher.routeAndAssign(place.orderId);
    const booted = createDispatcher({
      runtime: s.runtime,
      store: s.store,
      employeeManager: createEmployeeSessionManager({ runtime: s.runtime, logger: console }),
      logger: console,
    });
    await booted.hydrate({ recoverOrphans: true });
    const second = await booted.routeAndAssign(place.orderId);
    assert.equal(second.ok, true, "恢复后必须能重新派出：" + JSON.stringify(second));
    assert.notEqual(second.attemptId, first.attemptId);
    const order = s.runtime.ledger.orders.find((o) => o.id === place.orderId);
    assert.equal(order.state, ORDER_STATES.RUNNING);
    assert.equal(order.attempts.length, 2);
    assert.equal(order.attempts[1].attemptNo, 2, "attemptNo 应递增");
  } finally {
    await s.cleanup();
  }
});

test("v0.4 搁浅回收：running 但无活 attempt 时 recoverStranded 放回 queued", async () => {
  const s = await setup("stranded");
  try {
    const place = await s.dispatcher.placeOrder({ type: "code_impl", title: "修复登录 bug" });
    const res = await s.dispatcher.routeAndAssign(place.orderId);
    assert.equal(res.ok, true);
    // 手工把 attempt 判 stale：模拟回报丢失 / worker 崩溃，订单仍停在 running
    s.runtime.ledger = markAttemptStale(s.runtime.ledger, place.orderId, res.attemptId, "worker_crash");
    const out = await s.dispatcher.recoverStranded();
    assert.deepEqual(out.recovered, [place.orderId]);
    const order = s.runtime.ledger.orders.find((o) => o.id === place.orderId);
    assert.equal(order.state, ORDER_STATES.QUEUED);
  } finally {
    await s.cleanup();
  }
});

test("v0.4 临时工：sweepTemps 把过期且空闲的临时工置 retired，正式员工不受影响", async () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  const s = await setup("temp", {
    company: (c) =>
      createEmployee(c, {
        id: "t1",
        displayName: "临时工1",
        department: "A",
        kind: "temp",
        role: "staff",
        state: "idle",
        skills: ["typescript"],
        tempExpiresAt: past,
      }),
  });
  try {
    const out = await s.dispatcher.sweepTemps(Date.now());
    assert.ok(out.released.includes("t1"), "过期临时工应被释放：" + JSON.stringify(out));
    const temp = s.runtime.company.employees.find((e) => e.id === "t1");
    assert.equal(temp.state, EMPLOYEE_STATE.RETIRED);
    const perm = s.runtime.company.employees.find((e) => e.id === "e1");
    assert.equal(perm.state, EMPLOYEE_STATE.IDLE, "正式员工不受影响");
  } finally {
    await s.cleanup();
  }
});

test("v0.4 临时工可派工：kind=temp 能被自动派工选中并计入部门占用", async () => {
  const s = await setup("temp-dispatch", {
    company: (c) =>
      createEmployee(c, {
        id: "t1",
        displayName: "临时工1",
        department: "A",
        kind: "temp",
        role: "staff",
        state: "idle",
        tempMaxTasks: 1,
      }),
  });
  try {
    const place = await s.dispatcher.placeOrder({ type: "code_impl", title: "修复登录 bug" });
    const res = await s.dispatcher.routeAndAssign(place.orderId);
    assert.equal(res.ok, true);
    const order = s.runtime.ledger.orders.find((o) => o.id === place.orderId);
    assert.equal(order.state, ORDER_STATES.RUNNING);
    // 自动派工只认正式员工时这里会是 e1/e2；显式指定临时工必须能派
    const manual = await s.dispatcher.placeOrder({ type: "code_impl", title: "修复 2" });
    const r2 = await s.dispatcher.dispatchOrder(manual.orderId, "t1");
    assert.equal(r2.ok, true, "临时工应可被派工：" + JSON.stringify(r2));
  } finally {
    await s.cleanup();
  }
});

test("v0.4 回报去重：同一 attempt 二次回报返回 E_DUPLICATE_REPORT", async () => {
  const s = await setup("dup");
  try {
    const place = await s.dispatcher.placeOrder({ type: "code_impl", title: "修复登录 bug" });
    const res = await s.dispatcher.routeAndAssign(place.orderId);
    const first = await s.dispatcher.report({ attemptId: res.attemptId, status: "done", summary: "ok" });
    assert.equal(first.ok, true);
    const second = await s.dispatcher.report({ attemptId: res.attemptId, status: "done", summary: "ok again" });
    assert.equal(second.ok, false);
    assert.equal(second.code, "E_DUPLICATE_REPORT");
  } finally {
    await s.cleanup();
  }
});

/**
 * 回归：失败单不能变成「异常」泳道里的死单。
 * 早期 assignAndWake 的 isTerminal 守卫把 failed 也一起拦了，面板「派工」按钮点了报 E_TERMINAL_STATE，
 * 订单就永久停在异常泳道——工作网看起来永远有故障，且没有任何操作能清掉。
 */
test("v0.5 失败单可重跑：assignOrder 把 failed 拉回 running", async () => {
  const s = await setup("retry-failed");
  try {
    const place = await s.dispatcher.placeOrder({ type: "bugfix", title: "修复登录闪退" });
    const first = await s.dispatcher.routeAndAssign(place.orderId);
    assert.equal(first.ok, true);
    const reported = await s.dispatcher.report({ attemptId: first.attemptId, status: "failed", summary: "口径写错" });
    assert.equal(reported.ok, true);
    const failed = s.runtime.ledger.orders.find((o) => o.id === place.orderId);
    assert.equal(failed.state, ORDER_STATES.FAILED, "回报失败后订单应进 failed（异常泳道）");

    const retry = await s.dispatcher.dispatchOrder(place.orderId, "e2");
    assert.equal(retry.ok, true, "失败单必须可以重派：" + JSON.stringify(retry));
    const after = s.runtime.ledger.orders.find((o) => o.id === place.orderId);
    assert.equal(after.state, ORDER_STATES.RUNNING);
    assert.equal(after.attempts.length, 2, "重跑要新增一次 attempt，历史不能丢");
    assert.equal(after.attempts[1].attemptNo, 2);
  } finally {
    await s.cleanup();
  }
});

test("v0.5 失败单可人工验收通过：review(pass) 把 failed 直接结单", async () => {
  const s = await setup("review-failed");
  try {
    const place = await s.dispatcher.placeOrder({ type: "bugfix", title: "修复登录闪退" });
    const first = await s.dispatcher.routeAndAssign(place.orderId);
    await s.dispatcher.report({ attemptId: first.attemptId, status: "failed", summary: "其实已改好" });
    const rev = await s.dispatcher.review({ orderId: place.orderId, pass: true });
    assert.equal(rev.ok, true, "人工验收通过必须合法：" + JSON.stringify(rev));
    assert.equal(rev.state, "done");
    assert.equal(s.runtime.ledger.orders.find((o) => o.id === place.orderId).state, ORDER_STATES.DONE);
  } finally {
    await s.cleanup();
  }
});

test("v0.5 终态订单下的孤儿 attempt 必须被 hydrate 收走（不能永远留在活索引里）", async () => {
  const s = await setup("orphan-terminal");
  try {
    const place = await s.dispatcher.placeOrder({ type: "bugfix", title: "修复登录闪退" });
    const first = await s.dispatcher.routeAndAssign(place.orderId);
    assert.equal(first.ok, true);

    // 造出真实事故形态：订单已被人工验收结单（done），但当时那条 attempt 从未回报、也没有 endedAt。
    const order = s.runtime.ledger.orders.find((o) => o.id === place.orderId);
    order.state = ORDER_STATES.DONE;
    const zombie = order.attempts.find((a) => a.id === first.attemptId);
    zombie.state = "running";
    zombie.status = "running";
    zombie.invalidated = false;
    delete zombie.endedAt;
    delete zombie.staleReason;
    // 真实事故里这些脏状态是上一进程写进磁盘的，hydrate 会从磁盘重载，所以必须先落盘再重启。
    await s.store.saveLedger(s.runtime.ledger);

    const booted = createDispatcher({
      runtime: s.runtime,
      store: s.store,
      employeeManager: createEmployeeSessionManager({ runtime: s.runtime, logger: console }),
      logger: console,
    });
    const out = await booted.hydrate({ recoverOrphans: true });

    assert.deepEqual(out.orphaned, [{ orderId: place.orderId, attemptId: first.attemptId }], "应回收 1 条孤儿 attempt");
    const after = s.runtime.ledger.orders.find((o) => o.id === place.orderId);
    assert.equal(after.state, ORDER_STATES.DONE, "订单已是终态，回收 attempt 不得改动订单状态");
    const healed = after.attempts.find((a) => a.id === first.attemptId);
    assert.equal(healed.invalidated, true);
    assert.equal(healed.state, "stale");
    assert.equal(healed.staleReason, "orphan_terminal_order");
    assert.ok(healed.endedAt, "必须补上 endedAt，否则索引仍会把它当活的");

    // 落盘也要干净：重新加载后仍然没有活的孤儿
    const reloaded = await s.store.load();
    const disk = reloaded.ledger.orders.find((o) => o.id === place.orderId);
    const diskAttempt = disk.attempts.find((a) => a.id === first.attemptId);
    assert.equal(diskAttempt.invalidated, true);
    assert.ok(diskAttempt.endedAt);
  } finally {
    await s.cleanup();
  }
});

test("v0.5 失败单可以被取消：异常泳道里的单必须有出路，不能只能靠假装验收", async () => {
  const s = await setup("cancel-failed");
  try {
    const place = await s.dispatcher.placeOrder({ type: "bugfix", title: "修复登录闪退" });
    const first = await s.dispatcher.routeAndAssign(place.orderId);
    await s.dispatcher.report({ attemptId: first.attemptId, status: "failed", summary: "做不了" });
    const failed = s.runtime.ledger.orders.find((o) => o.id === place.orderId);
    assert.equal(failed.state, ORDER_STATES.FAILED);

    const out = await s.dispatcher.cancelOrder(place.orderId);
    assert.equal(out.ok, true, "failed 应可直接取消：" + JSON.stringify(out));
    assert.equal(s.runtime.ledger.orders.find((o) => o.id === place.orderId).state, ORDER_STATES.CANCELLED);

    const again = await s.dispatcher.cancelOrder(place.orderId);
    assert.equal(again.ok, false, "已取消的单不能重复取消");
    assert.equal(again.code, "E_INVALID_TRANSITION");
  } finally {
    await s.cleanup();
  }
});

test("v0.5 取消失败单时把遗留的活 attempt 一并吊销", async () => {
  const s = await setup("cancel-failed-zombie");
  try {
    const place = await s.dispatcher.placeOrder({ type: "bugfix", title: "修复登录闪退" });
    const first = await s.dispatcher.routeAndAssign(place.orderId);
    // 造出「订单已 failed、attempt 却还挂着 running」的形态（回报丢失时的真实事故）
    const order = s.runtime.ledger.orders.find((o) => o.id === place.orderId);
    order.state = ORDER_STATES.FAILED;
    const z = order.attempts.find((a) => a.id === first.attemptId);
    z.state = "running";
    z.invalidated = false;
    delete z.endedAt;

    const out = await s.dispatcher.cancelOrder(place.orderId);
    assert.equal(out.ok, true);
    const after = s.runtime.ledger.orders.find((o) => o.id === place.orderId);
    assert.equal(after.state, ORDER_STATES.CANCELLED);
    const healed = after.attempts.find((a) => a.id === first.attemptId);
    assert.equal(healed.invalidated, true);
    assert.equal(healed.staleReason, "order_cancelled");
  } finally {
    await s.cleanup();
  }
});

test("v0.5 终态回收不误伤 running 订单：orphaned 为空，reason 仍是 host_restart", async () => {
  const s = await setup("orphan-mixed");
  try {
    const place = await s.dispatcher.placeOrder({ type: "bugfix", title: "修复登录闪退" });
    const res = await s.dispatcher.routeAndAssign(place.orderId);
    assert.equal(res.ok, true);

    const booted = createDispatcher({
      runtime: s.runtime,
      store: s.store,
      employeeManager: createEmployeeSessionManager({ runtime: s.runtime, logger: console }),
      logger: console,
    });
    const out = await booted.hydrate({ recoverOrphans: true });

    assert.deepEqual(out.recovered, [place.orderId], "running 订单走 host_restart 路径");
    assert.deepEqual(out.orphaned, [], "running 订单下的 attempt 不该被记成终态孤儿，否则会计两次");
    const order = s.runtime.ledger.orders.find((o) => o.id === place.orderId);
    const attempt = order.attempts.find((a) => a.id === res.attemptId);
    assert.equal(attempt.staleReason, "host_restart");
  } finally {
    await s.cleanup();
  }
});
