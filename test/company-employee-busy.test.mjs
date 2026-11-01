/**
 * v0.5.0：一个员工同时只能干一个活。
 *
 * 真实事故（2026-11-01 12:20）：调度器在同一轮里把 DAG 第二层的两张单都派给了同一个
 * doc-writer。per_task 策略下，第二张单进 ensureSession 时会 `end(employee.id, true)`
 * 把第一张单的会话结束掉，于是第一个 attempt 再也等不到 report，订单卡在「执行中」，
 * 直到下次重启被当成孤儿回收。
 *
 * 根因是 withLedger 每次都从 store 重载 company，而派工路径只 saveLedger 不 saveCompany，
 * 刚被标成 working 的人下一轮又变回 idle —— selectEmployee 自然又挑中他。
 *
 * 三个用例分别锁：忙碌门禁、状态落盘、两张单不会落到同一人头上。
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
import { emptyLedger } from "../src/shared/company-ledger.mjs";

function makeCtx() {
  let id = 0;
  return {
    get(name) {
      if (name === "subagents") {
        return {
          async startActivation() {
            id += 1;
            return { childId: `session-${id}`, cancel() {}, dispose() {} };
          },
        };
      }
      if (name === "agents") return { async get() { return null; } };
      return undefined;
    },
  };
}

async function setup(tag) {
  const ctx = makeCtx();
  let company = emptyCompany();
  company = createDepartment(company, { id: "A", name: "工程部", accepts: ["修复"], capacity: 4 });
  company = createEmployee(company, {
    id: "e1",
    displayName: "甲",
    department: "A",
    role: "staff",
    skills: ["typescript"],
    state: "idle",
  });
  company = createEmployee(company, {
    id: "e2",
    displayName: "乙",
    department: "A",
    role: "staff",
    skills: ["typescript"],
    state: "idle",
  });
  const dataDir = `/tmp/dsh-mm-busy-${tag}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const runtime = {
    ctx,
    company,
    config: { routingRules: [], limits: {} },
    provider: "fake",
    ledger: emptyLedger(),
    ownerAgent: { id: "owner" },
    dataDir,
  };
  const store = new CompanyStore(dataDir, { now: () => "2026-01-01T00:00:00.000Z" });
  await store.saveCompany(company);
  const employeeManager = createEmployeeSessionManager({ runtime, logger: console });
  const dispatcher = createDispatcher({ runtime, store, employeeManager, logger: console });
  return { runtime, store, dispatcher, cleanup: () => rm(dataDir, { recursive: true, force: true }) };
}

test("已有活 attempt 的员工不能再接新单（E_EMPLOYEE_BUSY）", async () => {
  const s = await setup("busy");
  try {
    const a = await s.dispatcher.placeOrder({ type: "code_impl", title: "修复 A" });
    const first = await s.dispatcher.routeAndAssign(a.orderId);
    assert.equal(first.ok, true, "第一单应派出：" + JSON.stringify(first));

    const b = await s.dispatcher.placeOrder({ type: "code_impl", title: "修复 B" });
    const second = await s.dispatcher.assignAndWake(b.orderId, first.employeeId);
    assert.equal(second.ok, false, "同一人不能同时接两单");
    assert.equal(second.code, "E_EMPLOYEE_BUSY");

    // 被拒的单不能留在半路状态
    const orderB = s.runtime.ledger.orders.find((o) => o.id === b.orderId);
    assert.equal(orderB.state, "queued");
  } finally {
    await s.cleanup();
  }
});

test("派工后员工状态必须落盘（working + currentOrderId）", async () => {
  const s = await setup("persist");
  try {
    const a = await s.dispatcher.placeOrder({ type: "code_impl", title: "修复 A" });
    const res = await s.dispatcher.routeAndAssign(a.orderId);
    assert.equal(res.ok, true, JSON.stringify(res));

    // 磁盘上必须已经是 working——withLedger 下一轮就靠这份数据决定谁空闲
    const loaded = await s.store.load();
    const emp = loaded.company.employees.find((e) => e.id === res.employeeId);
    assert.equal(emp.state, EMPLOYEE_STATE.WORKING, "派工后必须落盘 working");
    assert.equal(emp.currentOrderId, a.orderId);
    assert.equal(emp.currentAttemptId, res.attemptId);
  } finally {
    await s.cleanup();
  }
});

test("连续两张单会派给两个不同的人", async () => {
  const s = await setup("two");
  try {
    const a = await s.dispatcher.placeOrder({ type: "code_impl", title: "修复 A" });
    const b = await s.dispatcher.placeOrder({ type: "code_impl", title: "修复 B" });
    const ra = await s.dispatcher.routeAndAssign(a.orderId);
    const rb = await s.dispatcher.routeAndAssign(b.orderId);
    assert.equal(ra.ok, true, JSON.stringify(ra));
    assert.equal(rb.ok, true, JSON.stringify(rb));
    assert.notEqual(ra.employeeId, rb.employeeId, "第二单不能派给正在忙的第一个人");

    const working = s.runtime.company.employees.filter((e) => e.state === EMPLOYEE_STATE.WORKING);
    assert.equal(working.length, 2, "两个人都该是 working");
  } finally {
    await s.cleanup();
  }
});
