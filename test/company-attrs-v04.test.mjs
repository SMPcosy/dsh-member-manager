/**
 * v0.4 成员属性回归（参照 dsh-agent-teams）：
 * 推理强度 / 派生方式 / 子代理深度 / 工具策略 / 会话策略 / 临时工计次，
 * 以及这些属性对员工身份提示与工具拦截的实际影响。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCompanyRuntime } from "../src/host/company-runtime.mjs";
import { buildPromptFor } from "../src/host/company-employees.mjs";

function makeCtx(opts = {}) {
  return {
    get(name) {
      if (opts[name] !== undefined) return opts[name];
      return undefined;
    },
    effect() {
      return () => {};
    },
  };
}

function findOpRoute(rt) {
  return rt.routes.find((r) => r.method === "POST" && r.path === "/company/op");
}

async function setup(tag) {
  const dataDir = `/tmp/dsh-mm-attrs-${tag}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const rt = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt.boot();
  const op = findOpRoute(rt);
  await op.handler({}, new URL("http://localhost/company/op"), {
    action: "createDepartment",
    args: { id: "d1", name: "研发部", capacity: 4 },
  });
  return { rt, op, dataDir };
}

const call = (op, args) => op.handler({}, new URL("http://localhost/company/op"), { action: "updateEmployeeProfile", args });

test("v0.4 成员属性：reasoningEffort / memberProvider / maxDepth / toolPolicy 可写入并回显", async () => {
  const { rt, op } = await setup("attrs");
  try {
    await op.handler({}, new URL("http://localhost/company/op"), {
      action: "createEmployee",
      args: { id: "e1", displayName: "张三", department: "d1", role: "staff" },
    });
    const res = await call(op, {
      employeeId: "e1",
      reasoningEffort: "high",
      memberProvider: "fork",
      maxDepth: 0,
      toolPolicy: { allow: ["ops_bash"], deny: ["company_borrow", "web_fetch"] },
    });
    assert.equal(res.ok, true);
    assert.equal(res.employee.reasoningEffort, "high");
    assert.equal(res.employee.memberProvider, "fork");
    assert.equal(res.employee.maxDepth, 0);
    assert.deepEqual(res.employee.toolPolicy, { allow: ["ops_bash"], deny: ["company_borrow", "web_fetch"] });

    const persisted = rt.view().org.employees.find((e) => e.id === "e1");
    assert.equal(persisted.reasoningEffort, "high");
    assert.equal(persisted.maxDepth, 0);
  } finally {
    await rt.shutdown();
  }
});

test("v0.4 成员属性：非法值被拒（推理强度 / 派生方式 / 深度 / 会话策略）", async () => {
  const { rt, op } = await setup("invalid");
  try {
    await op.handler({}, new URL("http://localhost/company/op"), {
      action: "createEmployee",
      args: { id: "e1", displayName: "张三", department: "d1", role: "staff" },
    });
    for (const [field, value] of [
      ["reasoningEffort", "ultra"],
      ["memberProvider", "clone"],
      ["maxDepth", 9],
      ["sessionPolicy", "forever"],
    ]) {
      const res = await call(op, { employeeId: "e1", [field]: value });
      assert.equal(res.ok, false, `${field}=${value} 应被拒`);
      assert.equal(res.code, "E_INVALID_INPUT");
    }
  } finally {
    await rt.shutdown();
  }
});

test("v0.4 临时工：创建时 size=temp 带计次上限，profile 回显 temp 字段", async () => {
  const { rt, op } = await setup("temp");
  try {
    await op.handler({}, new URL("http://localhost/company/op"), {
      action: "createEmployee",
      args: { id: "t1", displayName: "临时工甲", department: "d1", role: "staff", kind: "temp", tempMaxTasks: 2 },
    });
    const res = await call(op, { employeeId: "t1", tempMaxTasks: 3 });
    assert.equal(res.ok, true);
    assert.equal(res.employee.kind, "temp");
    assert.equal(res.employee.tempMaxTasks, 3);
    assert.equal(res.employee.tempCompleted, 0);
  } finally {
    await rt.shutdown();
  }
});

test("v0.4 身份提示：临时工 / 推理强度 / 禁止子代理 写进员工系统提示", async () => {
  const { rt } = await setup("prompt");
  try {
    const prompt = buildPromptFor(
      {
        id: "t1",
        code: "E0009",
        displayName: "临时工甲",
        role: "staff",
        kind: "temp",
        reasoningEffort: "low",
        memberProvider: "spawn",
        maxDepth: 0,
        toolPolicy: { deny: ["ops_bash"] },
        department: "d1",
        channels: [{ channel: "P", level: "P2", primary: true }],
      },
      null,
      { company: rt.view().org, config: { levels: rt.view().levels } },
    );
    assert.ok(prompt.includes("临时工"), "应标明临时工身份");
    assert.ok(prompt.includes("推理强度：low"));
    assert.ok(prompt.includes("派生方式：spawn"));
    assert.ok(prompt.includes("不得开启"), "maxDepth=0 应写明禁止子代理");
    assert.ok(prompt.includes("禁用：ops_bash"), "工具黑名单应出现在提示里");
  } finally {
    await rt.shutdown();
  }
});
