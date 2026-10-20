/**
 * company-router.mjs 单元测试：type -> dept 规则、选人策略。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { routeTypeToDept, selectEmployee, RouterError } from "../src/shared/company-router.mjs";

function makeCompany() {
  return {
    departments: [
      { id: "A", name: "工程部", accepts: ["code_impl", "refactor", "test"], capacity: 4 },
      { id: "B", name: "产品部", accepts: ["prd"], capacity: 2 },
    ],
    employees: [
      { id: "A1", department: "A", role: "manager", skills: ["typescript", "testing"], state: "idle", lastUsed: 1000 },
      { id: "A2", department: "A", role: "staff", skills: ["typescript"], state: "idle", lastUsed: 2000 },
      { id: "A3", department: "A", role: "staff", skills: ["typescript", "testing"], state: "working", lastUsed: 0 },
      { id: "B1", department: "B", role: "manager", skills: ["prd"], state: "idle", lastUsed: 1500 },
      { id: "F1", department: null, kind: "shared", skills: ["review"], state: "idle", lastUsed: 500 },
    ],
  };
}

test("routeTypeToDept 优先规则表，未命中返回 null", () => {
  const rules = [
    { type: "code_impl", dept: "A" },
    { type: "prd", dept: "B" },
  ];
  assert.equal(routeTypeToDept("code_impl", rules, makeCompany()), "A");
  assert.equal(routeTypeToDept("prd", rules, makeCompany()), "B");
  assert.equal(routeTypeToDept("unknown", rules, makeCompany()), null);
});

test("routeTypeToDept 按规则顺序优先", () => {
  const rules = [
    { type: "code_impl", dept: "B" },
    { type: "code_impl", dept: "A" },
  ];
  assert.equal(routeTypeToDept("code_impl", rules, makeCompany()), "B");
});

test("selectEmployee 排除 working、cold、fired 员工", () => {
  const company = makeCompany();
  const picked = selectEmployee({ company, deptId: "A", order: { type: "code_impl" }, attempts: [] });
  assert.ok(picked);
  assert.notEqual(picked.id, "A3");
});

test("selectEmployee 按技能匹配优先", () => {
  const company = makeCompany();
  const order = { type: "code_impl", skills: ["testing"] };
  const picked = selectEmployee({ company, deptId: "A", order, attempts: [] });
  assert.equal(picked.id, "A1");
});

test("selectEmployee 技能相同时按负载最低，再按最近使用时间最旧", () => {
  const company = makeCompany();
  // 让 A1 和 A2 都只有 typescript，A2 负载低但最近使用时间最新
  company.employees[0].skills = ["typescript"];
  company.employees[1].skills = ["typescript"];
  const attempts = [{ employee: "A1", startedAt: 100 }];
  const picked = selectEmployee({ company, deptId: "A", order: { type: "code_impl" }, attempts });
  assert.equal(picked.id, "A2");
});

test("selectEmployee 返回 null 当部门无可用员工", () => {
  const company = makeCompany();
  company.employees.forEach((e) => {
    if (e.department === "A") e.state = "working";
  });
  const picked = selectEmployee({ company, deptId: "A", order: { type: "code_impl" }, attempts: [] });
  assert.equal(picked, null);
});

test("selectEmployee 可以借调 shared 员工到目标部门", () => {
  const company = makeCompany();
  const picked = selectEmployee({ company, deptId: "A", order: { type: "code_impl" }, attempts: [], includeShared: true });
  assert.equal(picked.id, "F1");
});
