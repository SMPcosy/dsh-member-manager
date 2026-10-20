import { test } from "node:test";
import assert from "node:assert/strict";
import { createDispatcher } from "../src/host/company-dispatcher.mjs";
import { createEmployeeSessionManager } from "../src/host/company-employees.mjs";
import { CompanyStore } from "../src/shared/company-store.mjs";
import { emptyCompany, createDepartment, createEmployee, EMPLOYEE_ROLE } from "../src/shared/company-org.mjs";
import { emptyLedger } from "../src/shared/company-ledger.mjs";

function makeCtx() {
  let id = 0;
  return {
    get(name) {
      if (name === "subagents") {
        return {
          async startActivation({ request }) {
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

function makeRuntime(ctx) {
  let company = emptyCompany();
  company = createDepartment(company, { id: "A", name: "工程部" });
  company = createEmployee(company, { id: "e1", displayName: "员工1", department: "A", role: "staff", skills: ["typescript"], state: "idle" });
  return { ctx, company, config: { routingRules: [{ type: "code_impl", dept: "A" }] }, provider: "fake", ledger: emptyLedger(), ownerAgent: { id: "owner" } };
}

test("P2 闭环：下单 -> 路由 -> 建 attempt -> 唤醒 -> 回报 -> 验收 -> done", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-disp-${Date.now()}`;
  const ctx = makeCtx();
  const runtime = makeRuntime(ctx);
  runtime.dataDir = dataDir;
  const store = new CompanyStore(dataDir, { now: () => "2026-01-01T00:00:00.000Z" });
  await store.saveCompany(runtime.company);
  const employeeManager = createEmployeeSessionManager({ runtime, logger: console });
  const dispatcher = createDispatcher({ runtime, store, employeeManager, logger: console });

  const place = await dispatcher.placeOrder({ type: "code_impl", title: "修复 bug" });
  assert.equal(place.ok, true);
  const orderId = place.orderId;

  const route = await dispatcher.routeOrder(orderId);
  assert.equal(route.ok, true);

  const wake = await dispatcher.assignAndWake(orderId, "e1");
  assert.equal(wake.ok, true);
  const attemptId = wake.attemptId;

  const report = await dispatcher.report({ attemptId, status: "done", summary: "fixed" });
  assert.equal(report.ok, true);

  const order = runtime.ledger.orders.find((o) => o.id === orderId);
  assert.equal(order.state, "done");
});

test("report 不带 attemptId 视为陈旧", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-disp2-${Date.now()}`;
  const ctx = makeCtx();
  const runtime = makeRuntime(ctx);
  runtime.dataDir = dataDir;
  const store = new CompanyStore(dataDir, { now: () => "2026-01-01T00:00:00.000Z" });
  await store.saveCompany(runtime.company);
  const employeeManager = createEmployeeSessionManager({ runtime, logger: console });
  const dispatcher = createDispatcher({ runtime, store, employeeManager, logger: console });
  await dispatcher.placeOrder({ type: "code_impl", title: "x" });
  const bad = await dispatcher.report({ attemptId: "missing-id", status: "done" });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "E_STALE_ATTEMPT");
});

test("acceptance 字符串归一为数组，不再被账本丢弃", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-disp3-${Date.now()}`;
  const ctx = makeCtx();
  const runtime = makeRuntime(ctx);
  runtime.dataDir = dataDir;
  const store = new CompanyStore(dataDir, { now: () => "2026-01-01T00:00:00.000Z" });
  await store.saveCompany(runtime.company);
  const employeeManager = createEmployeeSessionManager({ runtime, logger: console });
  const dispatcher = createDispatcher({ runtime, store, employeeManager, logger: console });
  const place = await dispatcher.placeOrder({ type: "code_impl", title: "x", acceptance: "summary 含 sum=5" });
  assert.equal(place.ok, true);
  const order = runtime.ledger.orders.find((o) => o.id === place.orderId);
  assert.deepEqual(order.acceptance, ["summary 含 sum=5"]);
});

test("派工失败（NO_PROVIDER）回滚订单到 queued，不留 running 无 attempt 僵单", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-disp4-${Date.now()}`;
  const ctx = makeCtx();
  ctx.get = (name) => {
    if (name === "subagents") {
      return {
        async startActivation() {
          const err = new Error('no subagent provider registered for "default"');
          err.code = "NO_PROVIDER";
          throw err;
        },
      };
    }
    if (name === "agents") return { get() { return null; } };
    return undefined;
  };
  const runtime = makeRuntime(ctx);
  runtime.dataDir = dataDir;
  const store = new CompanyStore(dataDir, { now: () => "2026-01-01T00:00:00.000Z" });
  await store.saveCompany(runtime.company);
  const employeeManager = createEmployeeSessionManager({ runtime, logger: console });
  const dispatcher = createDispatcher({ runtime, store, employeeManager, logger: console });
  const place = await dispatcher.placeOrder({ type: "code_impl", title: "x" });
  const res = await dispatcher.assignAndWake(place.orderId, "e1");
  assert.equal(res.ok, false);
  assert.equal(res.code, "NO_PROVIDER");
  const order = runtime.ledger.orders.find((o) => o.id === place.orderId);
  assert.equal(order.state, "queued");
  assert.deepEqual(order.attempts, []);
});
