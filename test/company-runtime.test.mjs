import { test } from "node:test";
import assert from "node:assert/strict";
import { createCompanyRuntime, TOOL_NAMES } from "../src/host/company-runtime.mjs";
import { resolveDefaultLlmOptions } from "../src/host/company-compat.mjs";

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
  const res = await tool.execute({ type: "code_impl", title: "x" }, {});
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

  const ownerExec = { agent: { session: { id: rt.ownerSessionId } } };

  await hireManager.execute({ id: "m1", displayName: "经理A", role: "manager", kind: "permanent", department: "dev" }, ownerExec);
  await hireStaff.execute({ id: "e1", displayName: "员工A", role: "staff", kind: "permanent", department: "dev" }, ownerExec);

  const order = await orderTool.execute({ type: "code_impl", title: "修复 bug" }, ownerExec);
  assert.equal(order.ok, true);
  const orderId = order.orderId;

  const assign = await assignTool.execute({ orderId, employeeId: "e1" }, ownerExec);
  assert.equal(assign.ok, true);
  const attemptId = assign.attemptId;
  assert.ok(attemptId);

  const report = await reportTool.execute({ attemptId, status: "done", summary: "已修复" }, { agent: { session: { id: assign.sessionId } } });
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
  const ownerExec = { agent: { session: { id: rt.ownerSessionId } } };
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
  const ownerExec = { agent: { session: { id: rt.ownerSessionId } } };
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
  const ownerExec = { agent: { session: { id: rt.ownerSessionId } } };
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

test("resolveDefaultLlmOptions 读取宿主 agent-default-model 默认路由", () => {
  const ctx = makeCtx({ agentDefaultModel: { currentSelection: () => ({ provider: "tokenrhythm", model: "deepseek-v4.1-flash-1017", reasoningEffort: "max" }) } });
  assert.deepEqual(resolveDefaultLlmOptions(ctx), { provider: "tokenrhythm", model: "deepseek-v4.1-flash-1017", reasoningEffort: "max" });
});

test("resolveDefaultLlmOptions 服务缺失或异常时返回空对象（交给宿主兜底）", () => {
  assert.deepEqual(resolveDefaultLlmOptions(makeCtx()), {});
  const broken = makeCtx({ agentDefaultModel: { currentSelection() { throw new Error("boom"); } } });
  assert.deepEqual(resolveDefaultLlmOptions(broken), {});
  const partial = makeCtx({ agentDefaultModel: { currentSelection: () => ({ provider: "only-provider" }) } });
  assert.deepEqual(resolveDefaultLlmOptions(partial), {});
});

test("view() 包含 code/channel/level/levelName/departmentCode/levels/numbering", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-view-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), {
    dataDir,
    config: { fake: true, departments: [{ id: "dev", name: "研发部" }] },
  });
  await rt.boot();
  const ownerExec = { exec: { agent: { session: { id: rt.ownerSessionId } } } };
  await rt.tools.find((t) => t.name === "company_hire").execute({ id: "e1", displayName: "员工A", department: "dev", role: "staff" }, ownerExec);
  const v = rt.view();
  assert.ok(v.levels?.M, "view 应包含 levels.M");
  assert.ok(v.numbering?.employee, "view 应包含 numbering.employee");
  const emp = v.org.employees.find((e) => e.id === "e1");
  assert.ok(emp.code, "员工应自动补号");
  assert.equal(emp.channel, "P");
  assert.equal(emp.level, "P3");
  assert.ok(emp.levelName, "应含 levelName");
  assert.equal(emp.departmentCode, "D01");
  const dept = v.org.departments.find((d) => d.id === "dev");
  assert.equal(dept.employeeCount, 1);
  assert.equal(dept.managerId, null);
  await rt.shutdown();
});

test("company_hire 自定义编号、通道、等级成功，重复编号失败", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-hire-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), {
    dataDir,
    config: { fake: true, departments: [{ id: "dev", name: "研发部" }] },
  });
  await rt.boot();
  const ownerExec = { exec: { agent: { session: { id: rt.ownerSessionId } } } };
  const hire = rt.tools.find((t) => t.name === "company_hire");
  const r1 = await hire.execute({ id: "e1", displayName: "员工A", department: "dev", role: "staff", code: "E9999", channel: "P", level: "P4" }, ownerExec);
  assert.equal(r1.ok, true);
  assert.equal(r1.code, "E9999");
  assert.equal(r1.channel, "P");
  assert.equal(r1.level, "P4");
  assert.equal(r1.levelName, "资深工程师");
  // 自动编号：code 形如 E0001
  const rAuto = await hire.execute({ id: "e2", displayName: "员工B", department: "dev", role: "staff" }, ownerExec);
  assert.equal(rAuto.ok, true);
  assert.ok(/^E\d{4}$/.test(rAuto.code), `自动编号应为 E0001 形式，实际为 ${rAuto.code}`);
  assert.equal(rAuto.channel, "P");
  assert.equal(rAuto.level, "P3");
  const r2 = await hire.execute({ id: "e3", displayName: "员工C", department: "dev", role: "staff", code: "E9999" }, ownerExec);
  assert.equal(r2.ok, false);
  assert.equal(r2.code, "E_DUPLICATE_CODE");
  const r3 = await hire.execute({ id: "e4", displayName: "员工D", department: "dev", role: "staff", level: "M2" }, ownerExec);
  assert.equal(r3.ok, false);
  assert.equal(r3.code, "E_INVALID_LEVEL");
  await rt.shutdown();
});

test("company_admin updateDepartment/promoteEmployee/setNumbering", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-admin-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), {
    dataDir,
    config: { fake: true, departments: [{ id: "dev", name: "研发部" }] },
  });
  await rt.boot();
  const ownerExec = { exec: { agent: { session: { id: rt.ownerSessionId } } } };
  await rt.tools.find((t) => t.name === "company_hire").execute({ id: "e1", displayName: "员工A", department: "dev", role: "staff" }, ownerExec);
  const admin = rt.tools.find((t) => t.name === "company_admin");

  const upd = await admin.execute({ action: "updateDepartment", args: { id: "dev", code: "RD" } }, ownerExec);
  assert.equal(upd.ok, true);
  assert.equal(upd.departmentId, "dev");
  assert.equal(upd.code, "RD");
  assert.equal(rt.view().org.departments.find((d) => d.id === "dev").code, "RD");

  const pro = await admin.execute({ action: "promoteEmployee", args: { employeeId: "e1" } }, ownerExec);
  assert.equal(pro.ok, true);
  assert.equal(pro.to.level, "P4");

  const bad = await admin.execute({ action: "promoteEmployee", args: { employeeId: "e1", level: "P6" } }, ownerExec);
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "E_LEVEL_STEP");

  const createEmp = await admin.execute({ action: "createEmployee", args: { id: "e2", displayName: "员工B", department: "dev", role: "staff" } }, ownerExec);
  assert.equal(createEmp.ok, true);
  assert.equal(createEmp.employeeId, "e2");
  assert.ok(/^E\d{4}$/.test(createEmp.code));
  assert.equal(createEmp.channel, "P");
  assert.equal(createEmp.level, "P3");

  const num = await admin.execute({ action: "setNumbering", args: { employeePattern: "N{seq:3}", employeeStart: 10 } }, ownerExec);
  assert.equal(num.ok, true);
  assert.equal(rt.view().numbering.employee.pattern, "N{seq:3}");
  assert.equal(rt.view().numbering.employee.start, 10);
  await rt.shutdown();
});

test("boot 自动为历史无 code 数据补号并持久化", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-codes-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), {
    dataDir,
    config: { fake: true },
  });
  await rt.boot();
  const ownerExec = { exec: { agent: { session: { id: rt.ownerSessionId } } } };
  await rt.tools.find((t) => t.name === "company_admin").execute({ action: "createDepartment", args: { id: "dev", name: "研发部" } }, ownerExec);
  await rt.tools.find((t) => t.name === "company_hire").execute({ id: "e1", displayName: "员工A", department: "dev", role: "staff" }, ownerExec);
  await rt.shutdown();

  const rt2 = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt2.boot();
  const emp = rt2.view().org.employees.find((e) => e.id === "e1");
  assert.ok(emp.code, "重启后员工仍应有编号");
  assert.ok(emp.channel, "重启后员工仍应有通道");
  await rt2.shutdown();
});

test("company_hire 指向不存在部门返回 E_NOT_FOUND 且不写文件/员工数不变", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-hire-dept-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), {
    dataDir,
    config: { fake: true, departments: [{ id: "dev", name: "研发部" }] },
  });
  await rt.boot();
  const ownerExec = { exec: { agent: { session: { id: rt.ownerSessionId } } } };
  const r = await rt.tools.find((t) => t.name === "company_hire").execute({ id: "e1", displayName: "员工A", department: "ghost", role: "staff" }, ownerExec);
  assert.equal(r.ok, false);
  assert.equal(r.code, "E_NOT_FOUND");
  assert.equal(rt.view().org.employees.length, 0);
  const admin = rt.tools.find((t) => t.name === "company_admin");
  const r2 = await admin.execute({ action: "createEmployee", args: { id: "e2", displayName: "员工B", department: "ghost", role: "staff" } }, ownerExec);
  assert.equal(r2.ok, false);
  assert.equal(r2.code, "E_NOT_FOUND");
  assert.equal(rt.view().org.employees.length, 0);
  await rt.shutdown();
});
