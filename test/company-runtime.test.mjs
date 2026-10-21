import { test } from "node:test";
import assert from "node:assert/strict";
import { createCompanyRuntime, TOOL_NAMES } from "../src/host/company-runtime.mjs";
import { resolveDefaultLlmOptions } from "../src/host/company-compat.mjs";
import { buildPromptFor } from "../src/host/company-employees.mjs";

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

function makeExec(sessionId) {
  return { agent: { session: { id: sessionId } } };
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

test("boot 补号审计 count 反映实际补号数量（历史数据）", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-codes-audit-${Date.now()}`;
  const { mkdir, writeFile, readFile } = await import("node:fs/promises");
  await mkdir(`${dataDir}/company`, { recursive: true });
  await writeFile(
    `${dataDir}/company/company.json`,
    JSON.stringify({
      company: {
        version: 1,
        status: "idle",
        departments: [{ id: "legacy", name: "老部门" }],
        employees: [{ id: "old", displayName: "老员工", role: "staff", kind: "permanent", department: "legacy" }],
      },
    }),
    "utf8",
  );
  const rt = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt.boot();
  const dept = rt.view().org.departments.find((d) => d.id === "legacy");
  const emp = rt.view().org.employees.find((e) => e.id === "old");
  assert.equal(dept.code, "D01");
  assert.equal(emp.code, "E0001");
  await rt.shutdown();
  const rows = (await readFile(`${dataDir}/company/audit.jsonl`, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const backfilled = rows.find((r) => r.type === "company.codes.backfilled");
  assert.ok(backfilled, "应写补号审计");
  assert.equal(backfilled.count, 2, "部门 + 员工各补 1 个编号");
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

function findOpRoute(rt) {
  return rt.routes.find((r) => r.method === "POST" && r.path === "/company/op");
}

test("POST /company/op createDepartment 成功且缺 name 失败", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-op-dept-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt.boot();
  const op = findOpRoute(rt);
  const res = await op.handler({}, new URL("http://localhost/company/op"), { action: "createDepartment", args: { name: "研发部", charter: "核心研发", capacity: 10 } });
  assert.equal(res.ok, true);
  assert.ok(res.departmentId.startsWith("dept-"));
  assert.ok(res.code);

  const store = (await import("../src/shared/company-store.mjs")).CompanyStore;
  const s = new store(dataDir);
  const loaded = await s.load();
  const dept = loaded.company.departments.find((d) => d.id === res.departmentId);
  assert.ok(dept);
  assert.equal(dept.name, "研发部");
  assert.equal(dept.charter, "核心研发");
  assert.equal(dept.capacity, 10);

  const rows = loaded.ledger.audit.filter((a) => a.type === "department_created");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].departmentId, res.departmentId);

  const bad = await op.handler({}, new URL("http://localhost/company/op"), { action: "createDepartment", args: {} });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "E_INVALID_INPUT");
  await rt.shutdown();
});

test("POST /company/op createEmployee 成功且部门不存在失败", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-op-emp-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt.boot();
  const op = findOpRoute(rt);

  const deptRes = await op.handler({}, new URL("http://localhost/company/op"), { action: "createDepartment", args: { name: "研发部" } });
  const deptId = deptRes.departmentId;

  const empRes = await op.handler({}, new URL("http://localhost/company/op"), { action: "createEmployee", args: { displayName: "张三", department: deptId, role: "staff", level: "P3" } });
  assert.equal(empRes.ok, true);
  assert.ok(empRes.employeeId.startsWith("emp-"));
  assert.ok(/^E\d{4}$/.test(empRes.code));
  assert.equal(empRes.level, "P3");

  const storeMod = await import("../src/shared/company-store.mjs");
  const s = new storeMod.CompanyStore(dataDir);
  const loaded = await s.load();
  const emp = loaded.company.employees.find((e) => e.id === empRes.employeeId);
  assert.ok(emp);
  assert.equal(emp.department, deptId);

  const bad = await op.handler({}, new URL("http://localhost/company/op"), { action: "createEmployee", args: { displayName: "李四", department: "ghost", role: "staff" } });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "E_NOT_FOUND");
  await rt.shutdown();
});

test("POST /company/op promoteEmployee 逐级成功与跨通道失败", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-op-promote-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt.boot();
  const op = findOpRoute(rt);
  const dept = await op.handler({}, new URL("http://localhost/company/op"), { action: "createDepartment", args: { name: "研发部" } });
  const emp = await op.handler({}, new URL("http://localhost/company/op"), { action: "createEmployee", args: { displayName: "张三", department: dept.departmentId, role: "staff", level: "P3" } });

  const p1 = await op.handler({}, new URL("http://localhost/company/op"), { action: "promoteEmployee", args: { employeeId: emp.employeeId } });
  assert.equal(p1.ok, true);
  assert.equal(p1.from.level, "P3");
  assert.equal(p1.to.level, "P4");

  const bad = await op.handler({}, new URL("http://localhost/company/op"), { action: "promoteEmployee", args: { employeeId: emp.employeeId, channel: "M" } });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "E_CROSS_CHANNEL");
  await rt.shutdown();
});

test("POST /company/op fireEmployee 幂等", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-op-fire-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt.boot();
  const op = findOpRoute(rt);
  const dept = await op.handler({}, new URL("http://localhost/company/op"), { action: "createDepartment", args: { name: "研发部" } });
  const emp = await op.handler({}, new URL("http://localhost/company/op"), { action: "createEmployee", args: { displayName: "张三", department: dept.departmentId, role: "staff" } });

  const f1 = await op.handler({}, new URL("http://localhost/company/op"), { action: "fireEmployee", args: { employeeId: emp.employeeId } });
  assert.equal(f1.ok, true);
  assert.equal(f1.state, "fired");
  const f2 = await op.handler({}, new URL("http://localhost/company/op"), { action: "fireEmployee", args: { employeeId: emp.employeeId } });
  assert.equal(f2.ok, true);

  const storeMod = await import("../src/shared/company-store.mjs");
  const s = new storeMod.CompanyStore(dataDir);
  const loaded = await s.load();
  const e = loaded.company.employees.find((x) => x.id === emp.employeeId);
  assert.equal(e.state, "fired");
  await rt.shutdown();
});

test("POST /company/op moveEmployee 成功/目标部门不存在/shared 清空", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-op-move-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt.boot();
  const op = findOpRoute(rt);
  const dept1 = await op.handler({}, new URL("http://localhost/company/op"), { action: "createDepartment", args: { name: "研发部" } });
  const dept2 = await op.handler({}, new URL("http://localhost/company/op"), { action: "createDepartment", args: { name: "产品部" } });
  const emp = await op.handler({}, new URL("http://localhost/company/op"), { action: "createEmployee", args: { displayName: "张三", department: dept1.departmentId, role: "staff" } });

  const m1 = await op.handler({}, new URL("http://localhost/company/op"), { action: "moveEmployee", args: { employeeId: emp.employeeId, department: dept2.departmentId } });
  assert.equal(m1.ok, true);
  assert.equal(m1.department, dept2.departmentId);

  const bad = await op.handler({}, new URL("http://localhost/company/op"), { action: "moveEmployee", args: { employeeId: emp.employeeId, department: "ghost" } });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "E_NOT_FOUND");

  const sharedEmp = await op.handler({}, new URL("http://localhost/company/op"), { action: "createEmployee", args: { displayName: "共享", department: dept1.departmentId, role: "staff", kind: "shared" } });
  const clear = await op.handler({}, new URL("http://localhost/company/op"), { action: "moveEmployee", args: { employeeId: sharedEmp.employeeId, department: "" } });
  assert.equal(clear.ok, true);
  assert.equal(clear.department, "");

  const permanent = await op.handler({}, new URL("http://localhost/company/op"), { action: "createEmployee", args: { displayName: "正式", department: dept1.departmentId, role: "staff", kind: "permanent" } });
  const bad2 = await op.handler({}, new URL("http://localhost/company/op"), { action: "moveEmployee", args: { employeeId: permanent.employeeId, department: "" } });
  assert.equal(bad2.ok, false);
  assert.equal(bad2.code, "E_INVALID_INPUT");
  await rt.shutdown();
});

test("POST /company/op unknown action → E_UNKNOWN_ACTION", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-op-unknown-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt.boot();
  const op = findOpRoute(rt);
  const res = await op.handler({}, new URL("http://localhost/company/op"), { action: "destroyEverything", args: {} });
  assert.equal(res.ok, false);
  assert.equal(res.code, "E_UNKNOWN_ACTION");
  await rt.shutdown();
});

test("POST /company/op updateDepartment 成功并持久化", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-op-update-dept-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt.boot();
  const op = findOpRoute(rt);
  const dept = await op.handler({}, new URL("http://localhost/company/op"), { action: "createDepartment", args: { name: "研发部" } });
  const updated = await op.handler({}, new URL("http://localhost/company/op"), { action: "updateDepartment", args: { departmentId: dept.departmentId, charter: "新说明", capacity: 8 } });
  assert.equal(updated.ok, true);
  assert.equal(updated.departmentId, dept.departmentId);

  const storeMod = await import("../src/shared/company-store.mjs");
  const s = new storeMod.CompanyStore(dataDir);
  const loaded = await s.load();
  const d = loaded.company.departments.find((x) => x.id === dept.departmentId);
  assert.equal(d.charter, "新说明");
  assert.equal(d.capacity, 8);
  await rt.shutdown();
});

test("POST /company/op syncRoster 同步名册/幂等/dryRun/缺失", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-op-sync-${Date.now()}`;
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(`${dataDir}/company`, { recursive: true });
  const rt = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt.boot();
  const op = findOpRoute(rt);

  const no = await op.handler({}, new URL("http://localhost/company/op"), { action: "syncRoster", args: {} });
  assert.equal(no.ok, false);
  assert.equal(no.code, "E_NO_REGISTRY");

  await writeFile(
    `${dataDir}/registry.json`,
    JSON.stringify({
      groups: [
        {
          id: "g1",
          name: "插件组",
          description: "核心插件团队",
          members: [
            { target: "plugin-arch", displayName: "架构师", status: "active", skills: ["arch"] },
            { target: "plugin-smith", displayName: "实现者", status: "active" },
          ],
        },
        {
          id: "g2",
          name: "数据组",
          members: [{ target: "data-guy", displayName: "数据员", status: "active" }],
        },
      ],
    }),
    "utf8",
  );

  const oldDept = await op.handler({}, new URL("http://localhost/company/op"), { action: "createDepartment", args: { name: "旧部门" } });
  const existingManager = await op.handler({}, new URL("http://localhost/company/op"), { action: "createEmployee", args: { id: "plugin-arch", displayName: "旧名", department: oldDept.departmentId, role: "manager", kind: "permanent" } });
  assert.equal(existingManager.ok, true);

  const dry = await op.handler({}, new URL("http://localhost/company/op"), { action: "syncRoster", args: { dryRun: true } });
  assert.equal(dry.ok, true);
  assert.equal(dry.dryRun, true);
  assert.equal(dry.wouldCreateDepartments.length, 2);
  assert.equal(dry.wouldCreateEmployees.length, 2);
  assert.equal(dry.wouldUpdateEmployees.length, 1);
  assert.equal(rt.view().org.employees.length, 1);

  const res = await op.handler({}, new URL("http://localhost/company/op"), { action: "syncRoster", args: {} });
  assert.equal(res.ok, true);
  assert.equal(res.dryRun, false);
  assert.equal(res.createdDepartments.length, 2);
  assert.equal(res.createdEmployees.length, 2);
  assert.equal(res.updatedEmployees.length, 1);
  assert.equal(res.updatedEmployees[0], "plugin-arch");

  const org = rt.view().org;
  assert.equal(org.departments.length, 3);
  assert.equal(org.employees.length, 3);
  const manager = org.employees.find((e) => e.id === "plugin-arch");
  assert.equal(manager.role, "manager");
  assert.equal(manager.displayName, "架构师");

  const res2 = await op.handler({}, new URL("http://localhost/company/op"), { action: "syncRoster", args: {} });
  assert.equal(res2.ok, true);
  assert.equal(res2.createdDepartments.length, 0);
  assert.equal(res2.createdEmployees.length, 0);
  assert.equal(res2.updatedEmployees.length, 0);

  await rt.shutdown();
});

test("POST /company/op deleteDepartment 非空拒绝且可删除仅含 fired 员工的部门", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-op-deldept-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt.boot();
  const op = findOpRoute(rt);
  const dept = await op.handler({}, new URL("http://localhost/company/op"), { action: "createDepartment", args: { name: "研发部" } });
  const emp = await op.handler({}, new URL("http://localhost/company/op"), { action: "createEmployee", args: { id: "e1", displayName: "张三", department: dept.departmentId, role: "staff" } });

  const busy = await op.handler({}, new URL("http://localhost/company/op"), { action: "deleteDepartment", args: { departmentId: dept.departmentId } });
  assert.equal(busy.ok, false);
  assert.equal(busy.code, "E_DEPT_NOT_EMPTY");

  await op.handler({}, new URL("http://localhost/company/op"), { action: "fireEmployee", args: { employeeId: emp.employeeId } });
  const del = await op.handler({}, new URL("http://localhost/company/op"), { action: "deleteDepartment", args: { departmentId: dept.departmentId } });
  assert.equal(del.ok, true);
  assert.equal(del.departmentId, dept.departmentId);
  assert.equal(del.code, dept.code);

  const storeMod = await import("../src/shared/company-store.mjs");
  const s = new storeMod.CompanyStore(dataDir);
  const loaded = await s.load();
  assert.equal(loaded.company.departments.find((d) => d.id === dept.departmentId), undefined);
  const e = loaded.company.employees.find((x) => x.id === emp.employeeId);
  assert.equal(e.department, "");
  const audit = loaded.ledger.audit.find((a) => a.type === "department_deleted");
  assert.ok(audit);
  await rt.shutdown();
});

test("POST /company/op fireEmployee 对不存在员工返回 E_NOT_FOUND（审阅建议 R1）", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-op-fire-missing-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt.boot();
  const op = findOpRoute(rt);
  const res = await op.handler({}, new URL("http://localhost/company/op"), { action: "fireEmployee", args: { employeeId: "no-such-employee" } });
  assert.equal(res.ok, false);
  assert.equal(res.code, "E_NOT_FOUND");
  await rt.shutdown();
});

test("view 返回 channels 与 management 聚合（含双通道排序）", async () => {
  const rt = createCompanyRuntime(makeCtx(), { dataDir: `/tmp/test-dsh-member-manager-view-${Date.now()}`, config: { fake: true } });
  await rt.boot();
  const op = findOpRoute(rt);
  await op.handler({}, new URL("http://localhost/company/op"), { action: "createDepartment", args: { id: "d1", name: "研发部" } });
  await op.handler({}, new URL("http://localhost/company/op"), { action: "createDepartment", args: { id: "d2", name: "产品部" } });
  await op.handler({}, new URL("http://localhost/company/op"), { action: "createEmployee", args: { id: "m1", displayName: "张总", department: "d1", role: "manager", channels: [{ channel: "M", level: "M2" }] } });
  await op.handler({}, new URL("http://localhost/company/op"), { action: "createEmployee", args: { id: "s1", displayName: "李四", department: "d1", role: "staff", channels: [{ channel: "P", level: "P3" }, { channel: "M", level: "M1" }] } });
  await op.handler({}, new URL("http://localhost/company/op"), { action: "createEmployee", args: { id: "s2", displayName: "王五", department: "d2", role: "staff", channels: [{ channel: "P", level: "P4" }] } });
  await op.handler({}, new URL("http://localhost/company/op"), { action: "createEmployee", args: { id: "s3", displayName: "赵六", role: "staff", kind: "shared", channels: [{ channel: "M", level: "M3" }] } });

  const v = rt.view();
  const e1 = v.org.employees.find((e) => e.id === "s1");
  assert.ok(e1.channels.length >= 2);
  assert.ok(e1.channels.some((c) => c.channel === "M" && c.primary));
  assert.equal(e1.channel, "M");

  const mgmt = v.management;
  assert.equal(mgmt.channel, "M");
  const ids = mgmt.employees.map((e) => e.id);
  assert.deepEqual(ids, ["m1", "s1", "s3"]); // d1 在前，无部门最后；d1 内 M2 > M1 所以 m1 前；s3 无部门
  assert.equal(mgmt.employees[0].level, "M2");
  assert.equal(mgmt.employees[1].level, "M1");
  assert.equal(mgmt.employees[2].departmentId, null);
  await rt.shutdown();
});

test("view().management 按部门编号数值排序（D9 在 D10 之前，而非字典序）", async () => {
  const rt = createCompanyRuntime(makeCtx(), { dataDir: `/tmp/test-dsh-member-manager-view-num-${Date.now()}`, config: { fake: true } });
  await rt.boot();
  const op = findOpRoute(rt);
  await op.handler({}, new URL("http://localhost/company/op"), { action: "createDepartment", args: { id: "d9", name: "九部", code: "D9" } });
  await op.handler({}, new URL("http://localhost/company/op"), { action: "createDepartment", args: { id: "d10", name: "十部", code: "D10" } });
  await op.handler({}, new URL("http://localhost/company/op"), { action: "createEmployee", args: { id: "e9", displayName: "九", department: "d9", role: "manager" } });
  await op.handler({}, new URL("http://localhost/company/op"), { action: "createEmployee", args: { id: "e10", displayName: "十", department: "d10", role: "manager" } });
  const ids = rt.view().management.employees.map((e) => e.id);
  assert.deepEqual(ids, ["e9", "e10"]);
  await rt.shutdown();
});

test("company_hire 支持 channels 配置", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-hire-channels-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt.boot();
  const op = findOpRoute(rt);
  await op.handler({}, new URL("http://localhost/company/op"), { action: "createDepartment", args: { id: "d1", name: "研发部" } });
  const tool = rt.tools.find((t) => t.name === "company_hire");
  const res = await tool.execute({ id: "e-dual", displayName: "双通", department: "d1", channels: [{ channel: "M", level: "M1" }, { channel: "P", level: "P3" }] }, {});
  assert.equal(res.ok, true);
  assert.equal(res.channel, "M");
  assert.equal(res.level, "M1");
  assert.equal(res.channels.length, 2);
  const v = rt.view().org.employees.find((e) => e.id === "e-dual");
  assert.ok(v.channels.some((c) => c.channel === "M"));
  assert.ok(v.channels.some((c) => c.channel === "P"));
  await rt.shutdown();
});

test("company_hire 非法 channels 返回 E_INVALID_CHANNEL", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-hire-err-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt.boot();
  const op = findOpRoute(rt);
  await op.handler({}, new URL("http://localhost/company/op"), { action: "createDepartment", args: { id: "d1", name: "研发部" } });
  const tool = rt.tools.find((t) => t.name === "company_hire");
  const res = await tool.execute({ id: "e-bad", displayName: "坏通道", department: "d1", channels: [{ channel: "X", level: "L1" }] }, {});
  assert.equal(res.ok, false);
  assert.equal(res.code, "E_INVALID_CHANNEL");
  await rt.shutdown();
});

test("company_admin setChannels 成功并审计", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-setchannels-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt.boot();
  const op = findOpRoute(rt);
  await op.handler({}, new URL("http://localhost/company/op"), { action: "createDepartment", args: { id: "d1", name: "研发部" } });
  await op.handler({}, new URL("http://localhost/company/op"), { action: "createEmployee", args: { id: "e1", displayName: "李四", department: "d1", role: "staff", channels: [{ channel: "P", level: "P3" }] } });
  const tool = rt.tools.find((t) => t.name === "company_admin");
  const res = await tool.execute({ action: "setChannels", args: { employeeId: "e1", channels: [{ channel: "M", level: "M2" }, { channel: "P", level: "P4" }] } }, {});
  assert.equal(res.ok, true);
  assert.equal(res.employeeId, "e1");
  assert.equal(res.channels.length, 2);
  assert.equal(res.channel, "M");
  const v = rt.view().org.employees.find((e) => e.id === "e1");
  assert.ok(v.channels.some((c) => c.channel === "M" && c.level === "M2"));
  const storeMod = await import("../src/shared/company-store.mjs");
  const s = new storeMod.CompanyStore(dataDir);
  const loaded = await s.load();
  const audit = loaded.ledger.audit.find((a) => a.type === "employee_channels_set");
  assert.ok(audit);
  assert.equal(audit.employeeId, "e1");
  await rt.shutdown();
});

test("company_admin setChannels 错误返回对应 code", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-setchannels-err-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt.boot();
  const op = findOpRoute(rt);
  await op.handler({}, new URL("http://localhost/company/op"), { action: "createDepartment", args: { id: "d1", name: "研发部" } });
  await op.handler({}, new URL("http://localhost/company/op"), { action: "createEmployee", args: { id: "e1", displayName: "李四", department: "d1", role: "staff", channels: [{ channel: "P", level: "P3" }] } });
  const tool = rt.tools.find((t) => t.name === "company_admin");
  const res = await tool.execute({ action: "setChannels", args: { employeeId: "no-one", channels: [{ channel: "M", level: "M2" }] } }, {});
  assert.equal(res.ok, false);
  assert.equal(res.code, "E_NOT_FOUND");
  const res2 = await tool.execute({ action: "setChannels", args: { employeeId: "e1", channels: [] } }, {});
  assert.equal(res2.ok, false);
  assert.equal(res2.code, "E_LAST_CHANNEL");
  await rt.shutdown();
});

test("company_admin promoteEmployee 支持 addChannel / removeChannel", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-promote-channels-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt.boot();
  const op = findOpRoute(rt);
  await op.handler({}, new URL("http://localhost/company/op"), { action: "createDepartment", args: { id: "d1", name: "研发部" } });
  await op.handler({}, new URL("http://localhost/company/op"), { action: "createEmployee", args: { id: "e1", displayName: "李四", department: "d1", role: "staff", channels: [{ channel: "P", level: "P3" }] } });
  const tool = rt.tools.find((t) => t.name === "company_admin");
  const add = await tool.execute({ action: "promoteEmployee", args: { employeeId: "e1", addChannel: { channel: "M", level: "M1" } } }, {});
  assert.equal(add.ok, true);
  const v1 = rt.view().org.employees.find((e) => e.id === "e1");
  assert.ok(v1.channels.some((c) => c.channel === "M"));
  const rem = await tool.execute({ action: "promoteEmployee", args: { employeeId: "e1", removeChannel: "M" } }, {});
  assert.equal(rem.ok, true);
  const v2 = rt.view().org.employees.find((e) => e.id === "e1");
  assert.ok(!v2.channels.some((c) => c.channel === "M"));
  await rt.shutdown();
});

test("buildPromptFor 双通道身份行包含 M/P 双等级", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-prompt-channels-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt.boot();
  const op = findOpRoute(rt);
  await op.handler({}, new URL("http://localhost/company/op"), { action: "createDepartment", args: { id: "d1", name: "研发部" } });
  await op.handler({}, new URL("http://localhost/company/op"), { action: "createEmployee", args: { id: "e1", displayName: "李四", department: "d1", role: "staff", channels: [{ channel: "M", level: "M2" }, { channel: "P", level: "P3" }] } });
  const emp = rt.view().org.employees.find((e) => e.id === "e1");
  const prompt = buildPromptFor(emp, null, { company: rt.view().org, config: { levels: rt.view().levels } });
  assert.ok(prompt.includes("M2"));
  assert.ok(prompt.includes("P3"));
  assert.ok(prompt.includes("等级："));
  await rt.shutdown();
});

test("legacy 单通道员工迁移后 view 仍可正常描述 channels", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-legacy-channels-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt.boot();
  const op = findOpRoute(rt);
  await op.handler({}, new URL("http://localhost/company/op"), { action: "createDepartment", args: { id: "d1", name: "研发部" } });
  await op.handler({}, new URL("http://localhost/company/op"), { action: "createEmployee", args: { id: "e1", displayName: "李四", department: "d1", role: "staff", channel: "P", level: "P3" } });
  const v = rt.view().org.employees.find((e) => e.id === "e1");
  assert.equal(v.channels.length, 1);
  assert.equal(v.channels[0].channel, "P");
  assert.equal(v.channels[0].level, "P3");
  assert.equal(v.channels[0].primary, true);
  await rt.shutdown();
});

test("company_hire 透传 title/duties/model/provider 并持久化", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-hire-profile-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true, departments: [{ id: "dev", name: "研发部" }] } });
  await rt.boot();
  const r = await rt.tools.find((t) => t.name === "company_hire").execute({
    id: "p1", displayName: "张三", department: "dev", role: "staff",
    title: "架构师", duties: ["设计", "评审"], model: "claude-3", provider: "anthropic",
  }, makeExec("owner"));
  assert.equal(r.ok, true);
  const emp = rt.view().org.employees.find((e) => e.id === "p1");
  assert.equal(emp.title, "架构师");
  assert.deepEqual(emp.duties, ["设计", "评审"]);
  assert.equal(emp.model, "claude-3");
  assert.equal(emp.provider, "anthropic");
  await rt.shutdown();
});

test("POST /company/op updateEmployeeProfile 截断 duties 并审计", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-update-profile-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt.boot();
  const op = findOpRoute(rt);
  await op.handler({}, new URL("http://localhost/company/op"), { action: "createDepartment", args: { id: "d1", name: "研发部" } });
  await op.handler({}, new URL("http://localhost/company/op"), { action: "createEmployee", args: { id: "e1", displayName: "张三", department: "d1", role: "staff" } });
  const res = await op.handler({}, new URL("http://localhost/company/op"), { action: "updateEmployeeProfile", args: { employeeId: "e1", title: "高级工程师", duties: ["  写代码  ", "", ...Array(10).fill("x")], model: "gpt-4", provider: "openai" } });
  assert.equal(res.ok, true);
  assert.equal(res.employee.title, "高级工程师");
  assert.equal(res.employee.duties.length, 8);
  assert.equal(res.employee.model, "gpt-4");
  assert.equal(res.employee.provider, "openai");
  await rt.shutdown();
});

test("POST /company/op updateEmployeeProfile 档案文本 trim，未提供的字段不覆盖", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-update-profile-trim-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt.boot();
  const op = findOpRoute(rt);
  await op.handler({}, new URL("http://localhost/company/op"), { action: "createDepartment", args: { id: "d1", name: "研发部" } });
  await op.handler({}, new URL("http://localhost/company/op"), { action: "createEmployee", args: { id: "e1", displayName: "张三", department: "d1", role: "staff", title: "架构师" } });
  const res = await op.handler({}, new URL("http://localhost/company/op"), {
    action: "updateEmployeeProfile",
    args: { employeeId: "e1", displayName: "  李四  ", title: "  高级工程师  ", provider: "  openai  " },
  });
  assert.equal(res.ok, true);
  assert.equal(res.employee.displayName, "李四", "显示名应 trim");
  assert.equal(res.employee.title, "高级工程师", "岗位应 trim");
  assert.equal(res.employee.provider, "openai", "provider 应 trim");
  assert.equal(res.employee.model, "", "未提供的 model 不应被覆盖/写入");
  await rt.shutdown();
});

test("POST /company/op updateEmployeeProfile 不存在返回 E_NOT_FOUND", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-update-profile-notfound-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt.boot();
  const op = findOpRoute(rt);
  const res = await op.handler({}, new URL("http://localhost/company/op"), { action: "updateEmployeeProfile", args: { employeeId: "ghost", title: "x" } });
  assert.equal(res.ok, false);
  assert.equal(res.code, "E_NOT_FOUND");
  await rt.shutdown();
});

test("POST /company/op importRosterProfiles 只补空字段且不覆盖", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-import-profiles-${Date.now()}`;
  const fs = await import("node:fs/promises");
  await fs.mkdir(dataDir, { recursive: true });
  const registry = {
    members: [
      { target: "e1", status: "active", displayName: "Registry 名", title: "高级", duties: ["a", "b"], model: "m1", provider: "p1" },
      { target: "e2", status: "active", displayName: "已有" },
    ],
  };
  await fs.writeFile(`${dataDir}/registry.json`, JSON.stringify(registry));

  const rt = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt.boot();
  const op = findOpRoute(rt);
  await op.handler({}, new URL("http://localhost/company/op"), { action: "createDepartment", args: { id: "d1", name: "研发部" } });
  await op.handler({}, new URL("http://localhost/company/op"), { action: "createEmployee", args: { id: "e1", displayName: "已有名", department: "d1", role: "staff" } });
  await op.handler({}, new URL("http://localhost/company/op"), { action: "createEmployee", args: { id: "e2", displayName: "已有", department: "d1", role: "staff", title: "不覆盖" } });

  const dry = await op.handler({}, new URL("http://localhost/company/op"), { action: "importRosterProfiles", args: { dryRun: true } });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.counts.filled, 1);

  const res = await op.handler({}, new URL("http://localhost/company/op"), { action: "importRosterProfiles", args: {} });
  assert.equal(res.ok, true);
  assert.equal(res.counts.filled, 1);
  assert.equal(res.counts.skipped, 1);

  const e1 = rt.view().org.employees.find((e) => e.id === "e1");
  assert.equal(e1.displayName, "已有名");
  assert.equal(e1.title, "高级");
  assert.deepEqual(e1.duties, ["a", "b"]);
  const e2 = rt.view().org.employees.find((e) => e.id === "e2");
  assert.equal(e2.title, "不覆盖");
  await rt.shutdown();
});

test("POST /company/op importRosterProfiles registry 缺失返回 E_NO_REGISTRY", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-import-profiles-noreg-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt.boot();
  const op = findOpRoute(rt);
  const res = await op.handler({}, new URL("http://localhost/company/op"), { action: "importRosterProfiles", args: {} });
  assert.equal(res.ok, false);
  assert.equal(res.code, "E_NO_REGISTRY");
  await rt.shutdown();
});

test("company_hire 含 provider+model 时 startActivation 传 agentOptions", async () => {
  let capturedRequest = null;
  let childId = 0;
  const customSub = {
    startActivation: async ({ request }) => {
      capturedRequest = request;
      return { childId: `c-${++childId}`, dispose: () => {} };
    },
    listChildren: async () => [],
    drainChildren: async () => {},
    drainDescendants: async () => {},
  };
  const customAgents = {
    create: () => ({ session: { id: "owner-sid" }, followup: () => {}, cancel: () => {}, whenIdle: () => Promise.resolve(), dispose: () => {} }),
    get: () => ({ session: { id: "c-1" }, followup: () => {}, ctx: { on: () => {} } }),
  };
  const dataDir = `/tmp/test-dsh-member-manager-agent-options-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx({ agents: customAgents, subagents: customSub, llm: {} }), { dataDir, config: { fake: false, departments: [{ id: "dev", name: "研发部" }] } });
  await rt.boot();
  await rt.tools.find((t) => t.name === "company_hire").execute({ id: "e1", displayName: "模型员工", department: "dev", role: "staff", model: "gpt-4", provider: "openai" }, makeExec("owner"));
  await rt.tools.find((t) => t.name === "company_order").execute({ type: "code", title: "测试单", detail: "测试" }, makeExec("owner"));
  const order = rt.view().orders[0];
  await rt.tools.find((t) => t.name === "company_assign").execute({ orderId: order.id, employeeId: "e1" }, makeExec("owner"));
  assert.ok(capturedRequest, "startActivation 应被调用");
  assert.deepEqual(capturedRequest.agentOptions, { provider: "openai", model: "gpt-4" });
  await rt.shutdown();
});

/* ==================== v5.11 管理层重命名 / 编号规则 / 等级通道 / 部门编辑 ==================== */

test("POST /company/op setManagementName 持久化并审计；空名拒绝", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-mgmt-name-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt.boot();
  const op = findOpRoute(rt);

  const res = await op.handler({}, new URL("http://localhost/company/op"), {
    action: "setManagementName",
    args: { name: "  执行管理层  " },
  });
  assert.equal(res.ok, true);
  assert.equal(res.name, "执行管理层");
  assert.equal(rt.view().management.name, "执行管理层", "view().management.name 应更新");

  const empty = await op.handler({}, new URL("http://localhost/company/op"), {
    action: "setManagementName",
    args: { name: "   " },
  });
  assert.equal(empty.ok, false);
  assert.equal(empty.code, "E_INVALID_INPUT");
  await rt.shutdown();

  const rt2 = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt2.boot();
  assert.equal(rt2.view().management.name, "执行管理层", "重启后管理层名称仍在");
  await rt2.shutdown();
});

test("POST /company/op setNumbering 持久化编号规则；非法模板拒绝", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-numbering-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt.boot();
  const op = findOpRoute(rt);

  const res = await op.handler({}, new URL("http://localhost/company/op"), {
    action: "setNumbering",
    args: { employee: { pattern: "EMP{seq:3}", start: 7 }, department: { pattern: "DEPT{seq:2}", start: 3 } },
  });
  assert.equal(res.ok, true);
  assert.equal(res.numbering.employee.pattern, "EMP{seq:3}");
  assert.equal(res.numbering.employee.start, 7);
  assert.equal(rt.view().numbering.department.start, 3);

  const bad = await op.handler({}, new URL("http://localhost/company/op"), {
    action: "setNumbering",
    args: { employee: { pattern: "EMP-", start: 1 } },
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "E_INVALID_NUMBERING");
  await rt.shutdown();

  const rt2 = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt2.boot();
  assert.equal(rt2.view().numbering.employee.pattern, "EMP{seq:3}", "重启后编号规则仍在");
  await rt2.shutdown();
});

test("POST /company/op setLevels 可增删等级：名称可改、可新增等级；被引用等级不可删；非法代号/空名拒绝", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-levels-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt.boot();
  const op = findOpRoute(rt);
  const base = rt.view().levels;
  const mapLevels = (fn) => ({
    M: { label: base.M.label, levels: base.M.levels.map(fn) },
    P: { label: base.P.label, levels: base.P.levels.map(fn) },
  });

  // 1) 改名
  const renamed = await op.handler({}, new URL("http://localhost/company/op"), {
    action: "setLevels",
    args: { levels: mapLevels((lv) => ({ code: lv.code, name: lv.code === "M2" ? "项目经理" : lv.name })) },
  });
  assert.equal(renamed.ok, true);
  assert.equal(rt.view().levels.M.levels.find((lv) => lv.code === "M2").name, "项目经理");
  assert.equal(rt.view().levels.M.levels.length, base.M.levels.length);

  // 2) 新增一个等级（梯度数量可改）
  const added = await op.handler({}, new URL("http://localhost/company/op"), {
    action: "setLevels",
    args: {
      levels: {
        M: { levels: [...rt.view().levels.M.levels.map((lv) => ({ code: lv.code, name: lv.name })), { code: "M7", name: "资深总监" }] },
        P: { levels: rt.view().levels.P.levels.map((lv) => ({ code: lv.code, name: lv.name })) },
      },
    },
  });
  assert.equal(added.ok, true);
  assert.equal(rt.view().levels.M.levels.length, base.M.levels.length + 1);
  assert.equal(rt.view().levels.M.levels.find((lv) => lv.code === "M7").name, "资深总监");
  // 重启后保留
  await rt.shutdown();
  const rt2 = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt2.boot();
  assert.equal(rt2.view().levels.M.levels.some((lv) => lv.code === "M7"), true, "自定义等级应持久化");
  const op2 = findOpRoute(rt2);

  // 3) 删除仍被员工引用的等级 → E_LEVEL_IN_USE
  await op2.handler({}, new URL("http://localhost/company/op"), { action: "createDepartment", args: { id: "d1", name: "研发部" } });
  await op2.handler({}, new URL("http://localhost/company/op"), {
    action: "createEmployee",
    args: { id: "e1", displayName: "员工一", department: "d1", role: "staff", kind: "permanent", channels: [{ channel: "M", level: "M7" }] },
  });
  const inUse = await op2.handler({}, new URL("http://localhost/company/op"), {
    action: "setLevels",
    args: { levels: { M: { levels: rt2.view().levels.M.levels.filter((lv) => lv.code !== "M7").map((lv) => ({ code: lv.code, name: lv.name })) } } },
  });
  assert.equal(inUse.ok, false);
  assert.equal(inUse.code, "E_LEVEL_IN_USE");
  assert.match(inUse.message, /员工一/);
  assert.equal(rt2.view().levels.M.levels.some((lv) => lv.code === "M7"), true, "被引用等级应保留");

  // 4) 非法代号 / 空名 / 空目录拒绝
  const badCode = await op2.handler({}, new URL("http://localhost/company/op"), {
    action: "setLevels",
    args: { levels: { M: { levels: [{ code: "X2", name: "错" }] } } },
  });
  assert.equal(badCode.ok, false);
  assert.equal(badCode.code, "E_INVALID_LEVELS");
  assert.match(badCode.message, /格式非法/);

  const blank = await op2.handler({}, new URL("http://localhost/company/op"), {
    action: "setLevels",
    args: { levels: { M: { levels: [{ code: "M1", name: "   " }] } } },
  });
  assert.equal(blank.ok, false);
  assert.equal(blank.code, "E_INVALID_LEVELS");

  const empty = await op2.handler({}, new URL("http://localhost/company/op"), {
    action: "setLevels",
    args: { levels: { M: { levels: [] } } },
  });
  assert.equal(empty.ok, false);
  assert.equal(empty.code, "E_INVALID_LEVELS");

  await rt2.shutdown();
});

test("POST /company/op updateDepartment 持久化 borrowPolicy", async () => {
  const dataDir = `/tmp/test-dsh-member-manager-dept-borrow-${Date.now()}`;
  const rt = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt.boot();
  const op = findOpRoute(rt);
  await op.handler({}, new URL("http://localhost/company/op"), { action: "createDepartment", args: { id: "d1", name: "研发部", capacity: 3 } });

  const res = await op.handler({}, new URL("http://localhost/company/op"), {
    action: "updateDepartment",
    args: { departmentId: "d1", name: "研发部", code: "D09", capacity: 5, charter: "负责研发", accepts: ["feature"], borrowPolicy: { mode: "borrow-only" } },
  });
  assert.equal(res.ok, true);
  const dept = rt.view().org.departments.find((d) => d.id === "d1");
  assert.equal(dept.code, "D09");
  assert.equal(dept.capacity, 5);
  assert.deepEqual(dept.borrowPolicy, { mode: "borrow-only" });
  await rt.shutdown();
});
