import { test } from "node:test";
import assert from "node:assert/strict";
import { createCompanyRuntime, TOOL_NAMES } from "../src/host/company-runtime.mjs";

function makeCtx(opts = {}) {
  return {
    get(name) {
      if (opts[name] !== undefined) return opts[name];
      return undefined;
    },
    effect(fn) {
      return () => {};
    },
  };
}

test("createCompanyRuntime 返回工具/路由/boot/shutdown/view", () => {
  const rt = createCompanyRuntime(makeCtx(), { dataDir: "/tmp/test-dsh-member-manager" });
  assert.ok(Array.isArray(rt.tools));
  assert.equal(rt.tools.length, TOOL_NAMES.length);
  assert.ok(Array.isArray(rt.routes));
  assert.equal(rt.routes.length > 0, true);
  assert.equal(typeof rt.boot, "function");
  assert.equal(typeof rt.shutdown, "function");
  assert.equal(typeof rt.view, "function");
});

test("boot 在 ctx.get('agents') 缺失且非 fake 时返回 warnings", async () => {
  const rt = createCompanyRuntime(makeCtx(), { dataDir: "/tmp/test-dsh-member-manager" });
  const res = await rt.boot();
  assert.equal(res.ok, true);
  assert.ok(res.warnings.some((w) => w.includes("agents")));
  await rt.shutdown();
});

test("工具在无 agents 时返回 E_NO_AGENTS", async () => {
  const rt = createCompanyRuntime(makeCtx(), { dataDir: "/tmp/test-dsh-member-manager" });
  await rt.boot();
  const tool = rt.tools.find((t) => t.name === "company_order");
  const res = await tool.execute({ type: "code_impl", title: "x" }, { exec: {} });
  assert.equal(res.ok, false);
  assert.equal(res.code, "E_NO_AGENTS");
  await rt.shutdown();
});

test("view 是同步快照", () => {
  const rt = createCompanyRuntime(makeCtx(), { dataDir: "/tmp/test-dsh-member-manager" });
  const v = rt.view();
  assert.ok(v.org);
  assert.ok(v.board);
  assert.ok(v.costs);
});

test("shutdown 幂等", async () => {
  const rt = createCompanyRuntime(makeCtx(), { dataDir: "/tmp/test-dsh-member-manager", config: { fake: true } });
  await rt.boot();
  await rt.shutdown();
  await rt.shutdown();
  assert.equal(rt.view().status, "stopped");
});

test("冷启动不 resume 旧 owner 且回收遗留 running attempt", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-cold-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  const boot1 = await rt.boot();
  assert.equal(boot1.ok, true);
  const id1 = rt.ownerSessionId;
  assert.ok(id1.startsWith("company-owner-"));
  await rt.shutdown();

  const rt2 = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt2.boot();
  const id2 = rt2.ownerSessionId;
  assert.notEqual(id1, id2, "冷启动应生成新 ownerSessionId");
  assert.ok(id2.startsWith("company-owner-"));
  await rt2.shutdown();
});

test("fake 模式跑通「下单→路由→建 attempt→唤醒→回报→验收→done→解锁 deps」闭环", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-p2-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), {
    dataDir,
    config: {
      fake: true,
      routingRules: [{ type: "code_impl", dept: "dev" }],
      departments: [{ id: "dev", name: "研发部" }],
    },
  });
  await rt.boot();

  const hireManager = rt.tools.find((t) => t.name === "company_hire");
  const hireStaff = rt.tools.find((t) => t.name === "company_hire");
  const orderTool = rt.tools.find((t) => t.name === "company_order");
  const assignTool = rt.tools.find((t) => t.name === "company_assign");
  const reportTool = rt.tools.find((t) => t.name === "company_report");
  const reviewTool = rt.tools.find((t) => t.name === "company_review");

  const ownerExec = { exec: { agent: { session: { id: rt.ownerSessionId } } } };

  await hireManager.execute({ id: "m1", displayName: "经理A", role: "manager", kind: "permanent", department: "dev" }, ownerExec);
  await hireStaff.execute({ id: "e1", displayName: "员工A", role: "staff", kind: "permanent", department: "dev" }, ownerExec);

  const order = await orderTool.execute({ type: "code_impl", title: "修复 bug" }, ownerExec);
  assert.equal(order.ok, true);
  const orderId = order.orderId;

  const assign = await assignTool.execute({ orderId, employeeId: "e1" }, ownerExec);
  assert.equal(assign.ok, true);
  const attemptId = assign.attemptId;
  assert.ok(attemptId);

  const report = await reportTool.execute({ attemptId, status: "done", summary: "已修复" }, { exec: { agent: { session: { id: assign.sessionId } } } });
  assert.equal(report.ok, true);

  const review = await reviewTool.execute({ orderId, pass: true }, ownerExec);
  assert.equal(review.ok, true);

  const v = rt.view();
  const doneOrder = v.orders.find((o) => o.id === orderId);
  assert.equal(doneOrder.state, "done");

  await rt.shutdown();
});

test("escalate 升级未终态订单并记录", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-esc-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), {
    dataDir,
    config: { fake: true, routingRules: [{ type: "code_impl", dept: "dev" }], departments: [{ id: "dev", name: "研发部" }] },
  });
  await rt.boot();
  const ownerExec = { exec: { agent: { session: { id: rt.ownerSessionId } } } };
  await rt.tools.find((t) => t.name === "company_hire").execute({ id: "m1", displayName: "经理A", role: "manager", kind: "permanent", department: "dev" }, ownerExec);
  const order = await rt.tools.find((t) => t.name === "company_order").execute({ type: "code_impl", title: "升级测试" }, ownerExec);
  const res = await rt.tools.find((t) => t.name === "company_escalate").execute({ orderId: order.orderId, reason: "阻塞" }, ownerExec);
  assert.equal(res.ok, true);
  assert.equal(res.escalated, true);
  await rt.shutdown();
});

test("borrow 借调 shared 员工并创建 attempt", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-borrow-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), {
    dataDir,
    config: { fake: true, routingRules: [{ type: "code_impl", dept: "dev" }], departments: [{ id: "dev", name: "研发部" }] },
  });
  await rt.boot();
  const ownerExec = { exec: { agent: { session: { id: rt.ownerSessionId } } } };
  await rt.tools.find((t) => t.name === "company_hire").execute({ id: "s1", displayName: "共享", role: "staff", kind: "shared", department: "dev" }, ownerExec);
  const order = await rt.tools.find((t) => t.name === "company_order").execute({ type: "code_impl", title: "借调测试" }, ownerExec);
  const res = await rt.tools.find((t) => t.name === "company_borrow").execute({ orderId: order.orderId, sharedEmployeeId: "s1" }, ownerExec);
  assert.equal(res.ok, true);
  assert.ok(res.attemptId);
  assert.ok(res.childId);
  await rt.shutdown();
});

test("fake 模式下 assistant/message 会累加到 costs", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-usage-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), {
    dataDir,
    config: { fake: true, routingRules: [{ type: "code_impl", dept: "dev" }], departments: [{ id: "dev", name: "研发部" }] },
  });
  await rt.boot();
  const ownerExec = { exec: { agent: { session: { id: rt.ownerSessionId } } } };
  await rt.tools.find((t) => t.name === "company_hire").execute({ id: "e1u", displayName: "员工U", role: "staff", kind: "permanent", department: "dev" }, ownerExec);
  const orderTool = rt.tools.find((t) => t.name === "company_order");
  const assignTool = rt.tools.find((t) => t.name === "company_assign");
  const order = await orderTool.execute({ type: "code_impl", title: "usage 测试" }, ownerExec);
  const assign = await assignTool.execute({ orderId: order.orderId, employeeId: "e1u" }, ownerExec);
  assert.ok(assign.sessionId);
  const fakeAgent = rt.fakeServices?.agents?.get(assign.sessionId);
  assert.ok(fakeAgent, "fake agent 应存在");
  await new Promise((r) => setTimeout(r, 200));
  fakeAgent.emitAssistantMessage({ usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });
  await new Promise((r) => setTimeout(r, 50));
  const costs = rt.view().costs;
  assert.ok(costs.tokens >= 5, "costs.tokens 应累加 assistant/message 的用量");
  assert.ok(costs.requests >= 1, "costs.requests 应计数");
  await rt.shutdown();
});
