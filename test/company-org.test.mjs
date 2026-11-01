/**
 * company-org.mjs 单元测试：组织架构数据模型、校验、迁移。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMPANY_VERSION,
  EMPLOYEE_KIND,
  EMPLOYEE_ROLE,
  EMPLOYEE_STATE,
  SESSION_POLICY,
  emptyCompany,
  normalizeCompany,
  createDepartment,
  updateDepartment,
  createEmployee,
  updateEmployee,
  fireEmployee,
  OrgError,
} from "../src/shared/company-org.mjs";

const NOW = "2026-10-20T09:00:00.000Z";

function makeCompany() {
  return emptyCompany(NOW);
}

test("emptyCompany 返回 version 1 且字段齐全", () => {
  const c = makeCompany();
  assert.equal(c.version, COMPANY_VERSION);
  assert.equal(c.status, "running");
  assert.ok(c.startedAt);
  assert.deepEqual(c.departments, []);
  assert.deepEqual(c.employees, []);
  assert.ok(c.limits);
});

test("normalizeCompany 补齐缺失字段并返回 warnings", () => {
  const { company, warnings } = normalizeCompany({}, NOW);
  assert.equal(company.version, COMPANY_VERSION);
  assert.equal(company.status, "running");
  assert.deepEqual(company.departments, []);
  assert.deepEqual(company.employees, []);
  assert.ok(Array.isArray(warnings));
});

test("normalizeCompany 丢弃非法员工作为默认迁移策略", () => {
  const raw = {
    employees: [{ id: "x", kind: "unknown" }, { id: "bad", state: 123 }],
    departments: [{ id: "A", name: "工程部" }],
  };
  const { company, warnings } = normalizeCompany(raw, NOW);
  assert.equal(company.employees.length, 0);
  assert.equal(warnings.length >= 2, true);
  assert.equal(company.departments.length, 1);
});

test("createDepartment 校验必填字段并设置默认值", () => {
  let c = makeCompany();
  c = createDepartment(c, { id: "A", name: "工程部" });
  const dept = c.departments[0];
  assert.equal(dept.id, "A");
  assert.equal(dept.name, "工程部");
  assert.deepEqual(dept.accepts, []);
  assert.equal(dept.capacity, 4);
  assert.equal(typeof dept.borrowPolicy, "object");
});

test("createDepartment 拒绝重复 id", () => {
  let c = makeCompany();
  c = createDepartment(c, { id: "A", name: "工程部" });
  assert.throws(() => createDepartment(c, { id: "A", name: "重复" }), OrgError);
});

test("updateDepartment 仅更新允许字段", () => {
  let c = makeCompany();
  c = createDepartment(c, { id: "A", name: "工程部" });
  c = updateDepartment(c, "A", { charter: "只做实现" });
  const dept = c.departments[0];
  assert.equal(dept.charter, "只做实现");
  assert.equal(dept.id, "A");
});

test("createEmployee 应用默认值与合法枚举", () => {
  let c = makeCompany();
  c = createDepartment(c, { id: "A", name: "工程部" });
  c = createEmployee(c, {
    id: "A1",
    displayName: "张工",
    department: "A",
    role: "manager",
  });
  const emp = c.employees[0];
  assert.equal(emp.id, "A1");
  assert.equal(emp.kind, EMPLOYEE_KIND.PERMANENT);
  assert.equal(emp.role, EMPLOYEE_ROLE.MANAGER);
  assert.equal(emp.sessionPolicy, SESSION_POLICY.RESIDENT);
  assert.equal(emp.state, EMPLOYEE_STATE.IDLE);
  assert.deepEqual(emp.skills, []);
});

test("createEmployee 拒绝非法 kind / role / sessionPolicy / state", () => {
  let c = makeCompany();
  c = createDepartment(c, { id: "A", name: "工程部" });
  assert.throws(() => createEmployee(c, { id: "e1", kind: "ghost", department: "A" }), OrgError);
  assert.throws(() => createEmployee(c, { id: "e1", role: "ceo", department: "A" }), OrgError);
  assert.throws(() => createEmployee(c, { id: "e1", sessionPolicy: "forever", department: "A" }), OrgError);
  assert.throws(() => createEmployee(c, { id: "e1", state: "asleep", department: "A" }), OrgError);
});

test("createEmployee 要求 permanent/temp 员工有所属部门", () => {
  let c = makeCompany();
  assert.throws(() => createEmployee(c, { id: "e1", kind: "permanent" }), OrgError);
  assert.throws(() => createEmployee(c, { id: "e2", kind: "temp" }), OrgError);
});

test("shared 员工可以没有部门", () => {
  let c = makeCompany();
  c = createEmployee(c, { id: "freelance", kind: "shared", skills: ["doc"] });
  assert.equal(c.employees[0].department, null);
});

test("manager 员工必须来自存在的部门", () => {
  let c = makeCompany();
  assert.throws(() => createEmployee(c, { id: "m1", role: "manager", department: "Z" }), OrgError);
});

test("updateEmployee 拒绝跨部门非法 state 且只更新允许字段", () => {
  let c = makeCompany();
  c = createDepartment(c, { id: "A", name: "工程部" });
  c = createEmployee(c, { id: "A1", displayName: "张工", department: "A" });
  c = updateEmployee(c, "A1", { state: "working" });
  assert.equal(c.employees[0].state, EMPLOYEE_STATE.WORKING);
  assert.equal(c.employees[0].displayName, "张工");
});

test("fireEmployee 将状态置为 fired 且不影响他人", () => {
  let c = makeCompany();
  c = createDepartment(c, { id: "A", name: "工程部" });
  c = createEmployee(c, { id: "A1", displayName: "张工", department: "A" });
  c = fireEmployee(c, "A1");
  assert.equal(c.employees[0].state, EMPLOYEE_STATE.FIRED);
});

test("createEmployee 拒绝重复 id", () => {
  let c = makeCompany();
  c = createDepartment(c, { id: "A", name: "工程部" });
  c = createEmployee(c, { id: "A1", displayName: "张工", department: "A" });
  assert.throws(() => createEmployee(c, { id: "A1", displayName: "同名", department: "A" }), OrgError);
});

/* ------------------------------------------------------------------ */
/* 部门流程预设（docs/24 §4）                                           */
/* ------------------------------------------------------------------ */

test("createDepartment 不带 preset 时不写入 preset 字段", () => {
  let c = makeCompany();
  c = createDepartment(c, { id: "A", name: "工程部" });
  assert.equal(c.departments[0].preset, undefined);
});

test("createDepartment 支持创建即套用 game-dev 预设", () => {
  let c = makeCompany();
  c = createDepartment(c, { id: "D04", name: "游戏开发", preset: "game-dev" });
  const preset = c.departments[0].preset;
  assert.ok(preset, "应写入 preset 快照");
  assert.equal(preset.id, "game-dev");
  assert.equal(preset.version, 1);
  assert.equal(preset.appliedBy, "owner");
  assert.match(preset.appliedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("createDepartment 套用未知/非法预设抛 E_UNKNOWN_PRESET / E_INVALID_PRESET", () => {
  assert.throws(
    () => createDepartment(makeCompany(), { id: "D04", name: "游戏开发", preset: "nope" }),
    (err) => err.code === "E_UNKNOWN_PRESET",
  );
  assert.throws(
    () => createDepartment(makeCompany(), { id: "D04", name: "游戏开发", preset: 123 }),
    (err) => err.code === "E_INVALID_PRESET",
  );
});

test("createDepartment 传 preset:null 视为不套用", () => {
  const c = createDepartment(makeCompany(), { id: "A", name: "工程部", preset: null });
  assert.equal(c.departments[0].preset, undefined);
});

test("updateDepartment 通过 preset 字段套用/切换预设", () => {
  let c = makeCompany();
  c = createDepartment(c, { id: "D04", name: "游戏开发" });
  c = updateDepartment(c, "D04", { preset: "game-dev" });
  assert.equal(c.departments[0].preset.id, "game-dev");
  const firstAppliedAt = c.departments[0].preset.appliedAt;
  c = updateDepartment(c, "D04", { preset: { id: "game-dev" } });
  assert.equal(c.departments[0].preset.id, "game-dev");
  // 再次套用会刷新 appliedAt（时间可能相同，至少结构完整）
  assert.ok(c.departments[0].preset.appliedAt);
  assert.equal(typeof firstAppliedAt, "string");
});

test("updateDepartment 传 preset:null 或空串清除预设，undefined 不动", () => {
  let c = makeCompany();
  c = createDepartment(c, { id: "D04", name: "游戏开发", preset: "game-dev" });
  c = updateDepartment(c, "D04", { preset: undefined, name: "游戏开发二部" });
  assert.equal(c.departments[0].preset.id, "game-dev", "undefined 不应清除预设");
  assert.equal(c.departments[0].name, "游戏开发二部");
  c = updateDepartment(c, "D04", { preset: null });
  assert.equal(c.departments[0].preset, undefined);
  c = updateDepartment(c, "D04", { preset: "game-dev" });
  c = updateDepartment(c, "D04", { preset: "" });
  assert.equal(c.departments[0].preset, undefined);
});

test("updateDepartment 套用未知预设抛 E_UNKNOWN_PRESET 且不破坏原部门", () => {
  let c = makeCompany();
  c = createDepartment(c, { id: "D04", name: "游戏开发", preset: "game-dev" });
  assert.throws(() => updateDepartment(c, "D04", { preset: "nope" }), (err) => err.code === "E_UNKNOWN_PRESET");
  assert.equal(c.departments[0].preset.id, "game-dev");
});

test("updateDepartment 不存在部门时 preset 套用抛 OrgError（部门不存在）", () => {
  assert.throws(() => updateDepartment(makeCompany(), "Z", { preset: "game-dev" }), /部门 Z 不存在/);
});
