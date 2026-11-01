/**
 * v0.4 成员属性持久化回归：属性必须能「存一次 → 读一次」活着回来。
 *
 * 背景：dispatcher 每个操作都走 withLedger → store.load()，normalizeCompany 会按固定字段
 * 重建员工对象。只要它漏一个字段，临时工计次、推理强度、工具黑名单、当前派工就会在
 * 第一次账本操作后凭空消失——这正是「临时工干完活不退休」的根因。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CompanyStore } from "../src/shared/company-store.mjs";
import {
  emptyCompany,
  createDepartment,
  createEmployee,
  updateEmployee,
  EMPLOYEE_STATE,
} from "../src/shared/company-org.mjs";

async function roundTrip(tag, build) {
  const dataDir = `/tmp/dsh-mm-attrs-rt-${tag}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const store = new CompanyStore(dataDir);
  let company = emptyCompany();
  company = createDepartment(company, { id: "d1", name: "研发部", capacity: 4 });
  for (const emp of build()) company = createEmployee(company, emp);
  await store.saveCompany(company);
  const loaded = await store.load();
  return { company: loaded.company, dataDir, store };
}

test("v0.4 属性持久化：temp 计次字段经过一次 load 仍在", async () => {
  const { company } = await roundTrip("temp", () => [
    { id: "t1", displayName: "临时工甲", department: "d1", role: "staff", kind: "temp", tempMaxTasks: 3 },
  ]);
  const emp = company.employees.find((e) => e.id === "t1");
  assert.equal(emp.kind, "temp");
  assert.equal(emp.tempMaxTasks, 3, "tempMaxTasks 不能在 normalize 里丢失");
  assert.equal(emp.tempCompleted, 0);
  assert.ok(emp.tempHiredAt, "入职时间应落盘");
});

test("v0.4 属性持久化：推理强度/派生方式/深度/工具策略/当前派工都应活着回来", async () => {
  const { company } = await roundTrip("attrs", () => [
    {
      id: "e1",
      displayName: "张三",
      department: "d1",
      role: "staff",
      reasoningEffort: "high",
      memberProvider: "fork",
      maxDepth: 0,
      toolPolicy: { allow: ["ops_bash"], deny: ["company_borrow"] },
    },
    { id: "e2", displayName: "李四", department: "d1", role: "staff" },
  ]);
  const e1 = company.employees.find((e) => e.id === "e1");
  assert.equal(e1.reasoningEffort, "high");
  assert.equal(e1.memberProvider, "fork");
  assert.equal(e1.maxDepth, 0);
  assert.deepEqual(e1.toolPolicy, { allow: ["ops_bash"], deny: ["company_borrow"] });

  // 当前派工也要能持久化（否则重启后成员一直显示在执行旧订单）
  const store = new CompanyStore(`/tmp/dsh-mm-attrs-rt-live-${Date.now()}`);
  const patched = updateEmployee(company, "e2", {
    state: EMPLOYEE_STATE.WORKING,
    currentOrderId: "o-live",
    currentAttemptId: "a-live",
    lastActiveAt: 123,
    notes: "试用期",
  });
  await store.saveCompany(patched);
  const reloaded = await store.load();
  const e2 = reloaded.company.employees.find((e) => e.id === "e2");
  assert.equal(e2.state, EMPLOYEE_STATE.WORKING);
  assert.equal(e2.currentOrderId, "o-live");
  assert.equal(e2.currentAttemptId, "a-live");
  assert.equal(e2.lastActiveAt, 123);
  assert.equal(e2.notes, "试用期");
});
