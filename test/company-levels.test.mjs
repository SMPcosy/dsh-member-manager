/**
 * company-levels.test.mjs —— M/P 双通道等级与编号体系（docs/16 §6 shared 行）。
 * 零 DSH 依赖，node --test 直跑。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LEVEL_CHANNEL,
  DEFAULT_LEVELS,
  DEFAULT_EMPLOYEE_LEVEL,
  DEFAULT_NUMBERING,
  EMPLOYEE_ROLE,
  EMPLOYEE_STATE,
  OrgError,
  emptyCompany,
  normalizeCompany,
  createDepartment,
  updateDepartment,
  createEmployee,
  channelForRole,
  resolveLevel,
  describeEmployeeLevel,
  formatCode,
  nextEmployeeCode,
  nextDepartmentCode,
  ensureCompanyCodes,
  promoteEmployee,
  normalizeChannels,
  normalizeManagementName,
  normalizeLevelsOverride,
  MANAGEMENT_NAME_DEFAULT,
  primaryChannelOf,
  resolveChannelLevel,
  describeEmployeeChannels,
  setEmployeeChannels,
} from "../src/shared/company-org.mjs";

const NOW = "2026-10-20T12:00:00.000Z";

/** 造一个带 A 部门的公司，便于快速建员工 */
function bizCompany() {
  let c = emptyCompany(NOW);
  c = createDepartment(c, { id: "A", name: "工程部" });
  return c;
}

/* ------------------------------ 默认目录 ------------------------------ */

test("DEFAULT_LEVELS 含 M/P 双通道，M 5 级 / P 6 级，编号默认值冻结", () => {
  assert.deepEqual(Object.keys(DEFAULT_LEVELS), ["M", "P"]);
  assert.equal(DEFAULT_LEVELS.M.levels.length, 5);
  assert.equal(DEFAULT_LEVELS.P.levels.length, 6);
  assert.equal(DEFAULT_LEVELS.M.levels[0].code, "M1");
  assert.equal(DEFAULT_LEVELS.P.levels[5].code, "P6");
  assert.equal(LEVEL_CHANNEL.MANAGEMENT, "M");
  assert.equal(LEVEL_CHANNEL.PROFESSIONAL, "P");
  assert.equal(DEFAULT_EMPLOYEE_LEVEL.manager, "M2");
  assert.equal(DEFAULT_EMPLOYEE_LEVEL.staff, "P3");
  assert.equal(DEFAULT_NUMBERING.employee.pattern, "E{seq:4}");
  assert.equal(DEFAULT_NUMBERING.department.pattern, "D{seq:2}");
});

/* --------------------------- 通道/岗位一致性 --------------------------- */

test("channelForRole：manager→M、staff/window→P、缺省→null、非法抛 OrgError", () => {
  assert.equal(channelForRole("manager"), "M");
  assert.equal(channelForRole("staff"), "P");
  assert.equal(channelForRole("window"), "P");
  assert.equal(channelForRole(undefined), null);
  assert.equal(channelForRole(""), null);
  assert.throws(() => channelForRole("boss"), OrgError);
});

test("resolveLevel 解析默认/自定义目录；非法通道/等级抛 OrgError", () => {
  assert.deepEqual(resolveLevel("M", "M2"), { channel: "M", code: "M2", name: "经理" });
  assert.deepEqual(resolveLevel("P", "P6", DEFAULT_LEVELS), { channel: "P", code: "P6", name: "首席专家" });
  const custom = {
    M: { label: "M", levels: [{ code: "M1", name: "组长" }] },
    P: { label: "P", levels: [{ code: "P1", name: "初级", extra: 1 }] },
  };
  assert.deepEqual(resolveLevel("P", "P1", custom), { channel: "P", code: "P1", name: "初级" });
  assert.throws(() => resolveLevel("X", "M1"), OrgError);
  assert.throws(() => resolveLevel("M", "P3"), OrgError);
  assert.throws(() => resolveLevel("M", "M9"), OrgError);
});

test("describeEmployeeLevel 推导通道/等级/名称，缺省与非法数据都不抛", () => {
  assert.deepEqual(describeEmployeeLevel({ role: "manager" }), { channel: "M", level: "M2", levelName: "经理" });
  assert.deepEqual(describeEmployeeLevel({ role: "staff", channel: "P", level: "P5" }), {
    channel: "P",
    level: "P5",
    levelName: "技术专家",
  });
  // 显式 channel 优先展示；等级不在该通道目录时 levelName 回落为 code 本身；永不抛
  const odd = describeEmployeeLevel({ role: "staff", channel: "M", level: "P9" });
  assert.equal(odd.channel, "M");
  assert.equal(odd.level, "P9");
  assert.equal(odd.levelName, "P9");
});

/* ------------------------------ 编号生成 ------------------------------ */

test("formatCode 渲染全部占位符，未知占位符原样保留", () => {
  assert.equal(formatCode("E{seq:4}", { seq: 1 }), "E0001");
  assert.equal(formatCode("{dept}-{seq:3}", { dept: "D01", seq: 7 }), "D01-007");
  assert.equal(formatCode("{channel}{level}-{seq}", { channel: "P", level: "P4", seq: 2 }), "PP4-2");
  assert.equal(formatCode("X{foo}-{seq}", { seq: 1 }), "X{foo}-1");
  assert.equal(formatCode("E{seq}", {}), "E");
});

test("createDepartment 缺省自动编号 D01、D02，重复 id 仍抛 OrgError", () => {
  let c = emptyCompany(NOW);
  c = createDepartment(c, { id: "A", name: "工程部" });
  c = createDepartment(c, { id: "B", name: "产品部" });
  assert.equal(c.departments[0].code, "D01");
  assert.equal(c.departments[1].code, "D02");
  assert.throws(() => createDepartment(c, { id: "A", name: "重复" }), OrgError);
});

test("createDepartment 显式编号 + 唯一性（重复抛 E_DUPLICATE_CODE）", () => {
  let c = emptyCompany(NOW);
  c = createDepartment(c, { id: "A", name: "工程部", code: "ENG" });
  assert.equal(c.departments[0].code, "ENG");
  c = createDepartment(c, { id: "B", name: "产品部" });
  assert.equal(c.departments[1].code, "D01");
  assert.throws(() => createDepartment(c, { id: "C", name: "X", code: "ENG" }), (e) => e instanceof OrgError && e.code === "E_DUPLICATE_CODE");
});

test("updateDepartment 可改 code，且改后唯一性校验", () => {
  let c = emptyCompany(NOW);
  c = createDepartment(c, { id: "A", name: "工程部" });
  c = createDepartment(c, { id: "B", name: "产品部" });
  c = updateDepartment(c, "B", { code: "PD" });
  assert.equal(c.departments.find((d) => d.id === "B").code, "PD");
  assert.throws(() => updateDepartment(c, "A", { code: "PD" }), OrgError);
});

/* ------------------------------ 员工字段 ------------------------------ */

test("createEmployee 自动编号 E0001/E0002，且跳过已显式占用的编号", () => {
  let c = bizCompany();
  c = createEmployee(c, { id: "e1", kind: "permanent", department: "A" });
  assert.equal(c.employees[0].code, "E0001");
  c = createEmployee(c, { id: "e2", kind: "permanent", department: "A", code: "E0005" });
  c = createEmployee(c, { id: "e3", kind: "permanent", department: "A" });
  assert.equal(c.employees[2].code, "E0002");
});

test("createEmployee 默认等级：manager→M2(通道M)、staff→P3、window→P1", () => {
  let c = bizCompany();
  c = createEmployee(c, { id: "m1", role: "manager", kind: "permanent", department: "A" });
  c = createEmployee(c, { id: "s1", role: "staff", kind: "permanent", department: "A" });
  c = createEmployee(c, { id: "w1", role: "window", kind: "shared" });
  const byId = Object.fromEntries(c.employees.map((e) => [e.id, e]));
  assert.equal(byId.m1.channel, "M");
  assert.equal(byId.m1.level, "M2");
  assert.equal(byId.s1.channel, "P");
  assert.equal(byId.s1.level, "P3");
  assert.equal(byId.w1.channel, "P");
  assert.equal(byId.w1.level, "P1");
});

test("createEmployee 显式 channel/level/code 生效", () => {
  let c = bizCompany();
  c = createEmployee(c, {
    id: "e1",
    role: "staff",
    kind: "permanent",
    department: "A",
    channel: "P",
    level: "P5",
    code: "GZ-0007",
  });
  assert.equal(c.employees[0].channel, "P");
  assert.equal(c.employees[0].level, "P5");
  assert.equal(c.employees[0].code, "GZ-0007");
});

test("createEmployee 一致性硬校验：channel 冲突 E_CHANNEL_CONFLICT、等级前缀不符 E_INVALID_LEVEL", () => {
  let c = bizCompany();
  assert.throws(
    () => createEmployee(c, { id: "m1", role: "manager", kind: "permanent", department: "A", channel: "P" }),
    (e) => e instanceof OrgError && e.code === "E_CHANNEL_CONFLICT",
  );
  assert.throws(
    () => createEmployee(c, { id: "s1", role: "staff", kind: "permanent", department: "A", level: "M3" }),
    (e) => e instanceof OrgError && e.code === "E_INVALID_LEVEL",
  );
  assert.throws(
    () => createEmployee(c, { id: "s2", role: "staff", kind: "permanent", department: "A", code: "E 1" }),
    (e) => e instanceof OrgError && e.code === "E_INVALID_CODE",
  );
});

test("createEmployee 显式编号全局唯一（重复抛 E_DUPLICATE_CODE）", () => {
  let c = bizCompany();
  c = createEmployee(c, { id: "e1", kind: "permanent", department: "A", code: "X007" });
  assert.throws(
    () => createEmployee(c, { id: "e2", kind: "permanent", department: "A", code: "X007" }),
    (e) => e instanceof OrgError && e.code === "E_DUPLICATE_CODE",
  );
});

test("nextEmployeeCode/nextDepartmentCode 只读产出下一个可用编号", () => {
  let c = bizCompany();
  c = createEmployee(c, { id: "e1", kind: "permanent", department: "A" });
  assert.equal(nextEmployeeCode(c), "E0002");
  assert.equal(nextDepartmentCode(c), "D02");
});

test("编号耗尽抛 E_CODE_EXHAUSTED（模板每次渲染同码且被占用）", () => {
  let c = emptyCompany(NOW);
  c = createEmployee(c, { id: "e1", kind: "shared", code: "X" });
  assert.throws(
    // {dept} 无部门渲染为空串且 employee 只有 "X" 占用 → 每一跳都重合 → 100000 次耗尽
    () => nextEmployeeCode(c, { employee: { pattern: "X{dept}", start: 1 } }),
    (e) => e instanceof OrgError && e.code === "E_CODE_EXHAUSTED",
  );
});

/* ---------------------------- 晋升/转通道 ---------------------------- */

test("promoteEmployee 无参：同通道晋升一级；最高级抛 E_MAX_LEVEL", () => {
  let c = bizCompany();
  c = createEmployee(c, { id: "s1", role: "staff", kind: "permanent", department: "A" });
  const r = promoteEmployee(c, "s1", {});
  assert.deepEqual(r.from, { channel: "P", level: "P3" });
  assert.deepEqual(r.to, { channel: "P", level: "P4" });
  assert.equal(r.company.employees[0].level, "P4");

  let m = bizCompany();
  m = createEmployee(m, { id: "m1", role: "manager", kind: "permanent", department: "A", level: "M5" });
  assert.throws(() => promoteEmployee(m, "m1", {}), (e) => e instanceof OrgError && e.code === "E_MAX_LEVEL");
});

test("promoteEmployee 同通道 {level} 逐级 ±1；跳级抛 E_LEVEL_STEP", () => {
  let c = bizCompany();
  c = createEmployee(c, { id: "s1", role: "staff", kind: "permanent", department: "A" });
  let r = promoteEmployee(c, "s1", { level: "P4" });
  assert.deepEqual(r.to, { channel: "P", level: "P4" });
  r = promoteEmployee(r.company, "s1", { level: "P3" }); // 降级也允许
  assert.deepEqual(r.to, { channel: "P", level: "P3" });
  assert.throws(() => promoteEmployee(c, "s1", { level: "P5" }), (e) => e instanceof OrgError && e.code === "E_LEVEL_STEP");
  assert.throws(() => promoteEmployee(c, "s1", { level: "P3" }), (e) => e instanceof OrgError && e.code === "E_LEVEL_STEP");
});

test("promoteEmployee 跨通道：须显式 level，role 自动跟随（P→M 变 manager）", () => {
  let c = bizCompany();
  c = createEmployee(c, { id: "s1", role: "staff", kind: "permanent", department: "A" });
  const r = promoteEmployee(c, "s1", { channel: "M", level: "M1" });
  assert.deepEqual(r.from, { channel: "P", level: "P3" });
  assert.deepEqual(r.to, { channel: "M", level: "M1" });
  assert.equal(r.company.employees[0].role, "manager");
  assert.throws(() => promoteEmployee(c, "s1", { channel: "M" }), (e) => e instanceof OrgError && e.code === "E_CROSS_CHANNEL");
});

test("promoteEmployee 边界：window 禁转 M（E_WINDOW_TO_M）；无部门转 M 抛 E_DEPT_REQUIRED", () => {
  let c = bizCompany();
  c = createEmployee(c, { id: "w1", role: "window", kind: "permanent", department: "A" });
  assert.throws(
    () => promoteEmployee(c, "w1", { channel: "M", level: "M1" }),
    (e) => e instanceof OrgError && e.code === "E_WINDOW_TO_M",
  );
  let s = bizCompany();
  s = createEmployee(s, { id: "s1", role: "staff", kind: "shared" });
  assert.throws(
    () => promoteEmployee(s, "s1", { channel: "M", level: "M2" }),
    (e) => e instanceof OrgError && e.code === "E_DEPT_REQUIRED",
  );
});

/* --------------------------- 迁移与补号 --------------------------- */

test("normalizeCompany 历史员工补 channel/level/code（非法 level 回退默认 + warning，不丢员工）", () => {
  const { company, warnings } = normalizeCompany(
    {
      departments: [{ id: "A", name: "工程部" }],
      employees: [
        { id: "e1", kind: "permanent", role: "manager", department: "A" },
        { id: "e2", kind: "permanent", role: "staff", department: "A", level: "B9" },
        { id: "e3", kind: "permanent", role: "staff", department: "A", channel: "M", level: "P1" },
      ],
    },
    NOW,
  );
  assert.equal(company.employees.length, 3);
  const e1 = company.employees.find((e) => e.id === "e1");
  const e2 = company.employees.find((e) => e.id === "e2");
  const e3 = company.employees.find((e) => e.id === "e3");
  assert.deepEqual([e1.channel, e1.level, e1.code], ["M", "M2", "E0001"]);
  assert.deepEqual([e2.channel, e2.level, e2.code], ["P", "P3", "E0002"]);
  assert.deepEqual([e3.channel, e3.level, e3.code], ["M", "M2", "E0003"]); // v5：staff 可含 M 通道；P1 在 M 目录非法 → 回退 M2
  assert.deepEqual(e3.channels, [{ channel: "M", level: "M2" }]);
  assert.ok(warnings.some((w) => w.includes("e2") && w.includes("非法")));
  assert.ok(warnings.some((w) => w.includes("e3") && w.includes("非法")));
});

test("ensureCompanyCodes 先部门后员工补号（{dept} 取部门新码），且幂等", () => {
  const numbering = {
    employee: { pattern: "{dept}-{seq:3}", start: 1 },
    department: { pattern: "D{seq:2}", start: 1 },
  };
  const raw = {
    version: 1,
    departments: [{ id: "A", name: "工程部" }],
    employees: [{ id: "e1", kind: "permanent", role: "staff", department: "A" }],
  };
  const first = ensureCompanyCodes(raw, { numbering });
  assert.equal(first.company.departments[0].code, "D01");
  assert.equal(first.company.employees[0].code, "D01-001");
  assert.deepEqual(first.warnings, []);
  const second = ensureCompanyCodes(first.company, { numbering });
  assert.deepEqual(second.company.departments[0].code, "D01");
  assert.deepEqual(second.company.employees[0].code, "D01-001");
  assert.deepEqual(second.warnings, []);
});

test("ensureCompanyCodes 非法旧 code 自动补号 + warning（幂等后无二次告警）", () => {
  const raw = {
    version: 1,
    departments: [{ id: "A", name: "工程部", code: "E 01" }],
    employees: [{ id: "e1", kind: "permanent", role: "staff", department: "A", code: "E 1" }],
  };
  const first = ensureCompanyCodes(raw);
  assert.equal(first.company.departments[0].code, "D01");
  assert.equal(first.company.employees[0].code, "E0001");
  assert.equal(first.warnings.length, 2);
  const second = ensureCompanyCodes(first.company);
  assert.deepEqual(second.warnings, []);
});
/* --------------------------- v5：M/P 双通道并存 --------------------------- */

test("normalizeChannels：缺省按岗位推导；M 在前；staff 可 M+P", () => {
  assert.deepEqual(normalizeChannels({ id: "x", role: "staff" }).channels, [{ channel: "P", level: "P3" }]);
  assert.deepEqual(normalizeChannels({ id: "x", role: "staff", channels: [{ channel: "P", level: "P4" }, { channel: "M", level: "M1" }] }).channels, [
    { channel: "M", level: "M1" },
    { channel: "P", level: "P4" },
  ]);
});

test("normalizeChannels：manager 必含 M、window 禁 M（自动归正 + warning）", () => {
  const mgr = normalizeChannels({ id: "m", role: "manager", channels: [{ channel: "P", level: "P2" }] });
  assert.deepEqual(mgr.channels.map((c) => c.channel), ["M", "P"]);
  assert.ok(mgr.warnings.some((w) => w.includes("manager")));

  const win = normalizeChannels({ id: "w", role: "window", channels: [{ channel: "M", level: "M1" }, { channel: "P", level: "P5" }] });
  assert.deepEqual(win.channels, [{ channel: "P", level: "P5" }]);
  assert.ok(win.warnings.some((w) => w.includes("window")));
});

test("normalizeChannels：非法通道/等级丢弃或回退，永不抛", () => {
  const r = normalizeChannels({ id: "x", role: "staff", channels: [{ channel: "X", level: "P1" }, { channel: "P", level: "B9" }] });
  assert.deepEqual(r.channels, [{ channel: "P", level: "P3" }]);
  assert.equal(r.warnings.length >= 2, true);
});

test("primaryChannelOf：含 M 即 M，否则 P", () => {
  assert.equal(primaryChannelOf([{ channel: "M", level: "M1" }, { channel: "P", level: "P2" }]), "M");
  assert.equal(primaryChannelOf([{ channel: "P", level: "P2" }]), "P");
  assert.equal(primaryChannelOf(undefined), "P");
});

test("createEmployee：显式 channels 并存；channels 与 role 冲突抛 E_CHANNEL_CONFLICT", () => {
  let c = bizCompany();
  c = createEmployee(c, { id: "s1", role: "staff", kind: "permanent", department: "A", channels: [{ channel: "M", level: "M1" }, { channel: "P", level: "P4" }] });
  const emp = c.employees.find((e) => e.id === "s1");
  assert.deepEqual(emp.channels, [{ channel: "M", level: "M1" }, { channel: "P", level: "P4" }]);
  assert.equal(emp.channel, "M");
  assert.equal(emp.level, "M1");

  assert.throws(
    () => createEmployee(c, { id: "w1", role: "window", kind: "permanent", department: "A", channels: [{ channel: "M", level: "M1" }] }),
    (e) => e instanceof OrgError && e.code === "E_CHANNEL_CONFLICT",
  );
  assert.throws(
    () => createEmployee(c, { id: "w2", role: "staff", kind: "permanent", department: "A", channels: [] }),
    (e) => e instanceof OrgError && e.code === "E_LAST_CHANNEL",
  );
});

test("describeEmployeeChannels：返回各通道等级名并标记 primary", () => {
  let c = bizCompany();
  c = createEmployee(c, { id: "s1", role: "staff", kind: "permanent", department: "A", channels: [{ channel: "M", level: "M1" }, { channel: "P", level: "P4" }] });
  const emp = c.employees.find((e) => e.id === "s1");
  assert.deepEqual(describeEmployeeChannels(emp), [
    { channel: "M", level: "M1", levelName: "主管", primary: true },
    { channel: "P", level: "P4", levelName: "资深工程师", primary: false },
  ]);
  assert.deepEqual(resolveChannelLevel(emp, "P"), { channel: "P", level: "P4", name: "资深工程师" });
  assert.equal(resolveChannelLevel(emp, "M").level, "M1");
});

test("setEmployeeChannels：设置/校验（E_LAST_CHANNEL/E_INVALID_CHANNEL/E_CHANNEL_CONFLICT/E_INVALID_LEVEL）", () => {
  let c = bizCompany();
  c = createEmployee(c, { id: "s1", role: "staff", kind: "permanent", department: "A" });
  const r = setEmployeeChannels(c, "s1", [{ channel: "M", level: "M2" }, { channel: "P", level: "P3" }]);
  assert.deepEqual(r.to.channels, [{ channel: "M", level: "M2" }, { channel: "P", level: "P3" }]);
  assert.equal(r.company.employees[0].channel, "M");

  assert.throws(() => setEmployeeChannels(c, "s1", []), (e) => e.code === "E_LAST_CHANNEL");
  assert.throws(() => setEmployeeChannels(c, "s1", [{ channel: "X", level: "M1" }]), (e) => e.code === "E_INVALID_CHANNEL");
  assert.throws(() => setEmployeeChannels(c, "s1", [{ channel: "M", level: "M1" }, { channel: "M", level: "M2" }]), (e) => e.code === "E_CHANNEL_CONFLICT");
  assert.throws(() => setEmployeeChannels(c, "s1", [{ channel: "M", level: "P1" }]), (e) => e.code === "E_INVALID_LEVEL");

  let mgr = createDepartment(emptyCompany(NOW), { id: "A", name: "工程部" });
  mgr = createEmployee(mgr, { id: "m1", role: "manager", kind: "permanent", department: "A" });
  assert.throws(() => setEmployeeChannels(mgr, "m1", [{ channel: "P", level: "P2" }]), (e) => e.code === "E_CHANNEL_CONFLICT");
});

test("promoteEmployee：addChannel 增加 P 通道并保留 M；removeChannel 删 P；manager 不可移除 M", () => {
  let c = bizCompany();
  c = createEmployee(c, { id: "m1", role: "manager", kind: "permanent", department: "A" });
  const add = promoteEmployee(c, "m1", { addChannel: { channel: "P", level: "P2" } });
  let emp = add.company.employees.find((e) => e.id === "m1");
  assert.deepEqual(emp.channels, [{ channel: "M", level: "M2" }, { channel: "P", level: "P2" }]);
  assert.deepEqual(add.to, { channel: "M", level: "M2" });

  const rm = promoteEmployee(add.company, "m1", { removeChannel: "P" });
  emp = rm.company.employees.find((e) => e.id === "m1");
  assert.deepEqual(emp.channels, [{ channel: "M", level: "M2" }]);

  assert.throws(() => promoteEmployee(rm.company, "m1", { removeChannel: "M" }), (e) => e.code === "E_CHANNEL_CONFLICT");
});

test("promoteEmployee：promote within channel 逐级（M2→M3），双通道时 channel 指定 P 则升 P", () => {
  let c = bizCompany();
  c = createEmployee(c, { id: "s1", role: "staff", kind: "permanent", department: "A", channels: [{ channel: "M", level: "M2" }, { channel: "P", level: "P3" }] });
  const r = promoteEmployee(c, "s1", { channel: "P" });
  const emp = r.company.employees.find((e) => e.id === "s1");
  assert.deepEqual(emp.channels, [{ channel: "M", level: "M2" }, { channel: "P", level: "P4" }]);
  assert.deepEqual(r.to, { channel: "M", level: "M2" });
  assert.throws(() => promoteEmployee(c, "s1", { channel: "M", level: "M4" }), (e) => e.code === "E_LEVEL_STEP");
});

test("normalizeCompany：双通道员工序列化→再加载不丢副通道（回归 shared 丢 channels 缺陷）", () => {
  let c = bizCompany();
  c = createEmployee(c, { id: "dual", role: "staff", kind: "permanent", department: "A", channels: [{ channel: "M", level: "M2" }, { channel: "P", level: "P4" }] });
  // 模拟落盘后再加载：同一份 JSON 连续两轮归一，副通道都必须保留。
  const once = normalizeCompany(JSON.parse(JSON.stringify(c))).company;
  const twice = normalizeCompany(JSON.parse(JSON.stringify(once))).company;
  for (const company of [once, twice]) {
    const emp = company.employees.find((e) => e.id === "dual");
    assert.deepEqual(emp.channels, [{ channel: "M", level: "M2" }, { channel: "P", level: "P4" }]);
    assert.equal(emp.channel, "M");
    assert.equal(emp.level, "M2");
  }
});

test("normalizeCompany：只有旧标量 channel/level 的历史数据迁移出单通道 channels", () => {
  const raw = { version: 1, status: "idle", departments: [{ id: "A", name: "A 部" }], employees: [{ id: "old", displayName: "老员工", role: "staff", kind: "permanent", department: "A", channel: "P", level: "P2", code: "E0001" }] };
  const emp = normalizeCompany(raw).company.employees[0];
  assert.deepEqual(emp.channels, [{ channel: "P", level: "P2" }]);
  assert.equal(emp.channel, "P");
  assert.equal(emp.level, "P2");
});

/* --------------------------- v5.8 员工档案字段 --------------------------- */

import { EMPLOYEE_DUTIES_MAX, updateEmployee } from "../src/shared/company-org.mjs";

test("EMPLOYEE_DUTIES_MAX = 8 且 duties 截断到 8 条", () => {
  assert.equal(EMPLOYEE_DUTIES_MAX, 8);
  let c = bizCompany();
  c = createEmployee(c, { id: "s1", role: "staff", kind: "permanent", department: "A", duties: ["a", "b", "c", "d", "e", "f", "g", "h", "i"] });
  assert.deepEqual(c.employees[0].duties, ["a", "b", "c", "d", "e", "f", "g", "h"]);
});

test("normalizeCompany：title/duties/model/provider 归一，非法值丢弃为缺省，重载不丢", () => {
  const raw = { version: 1, status: "idle", departments: [{ id: "A", name: "A 部" }], employees: [{ id: "s1", displayName: "张三", role: "staff", kind: "permanent", department: "A", title: "高级工程师", duties: ["  写代码  ", "  ", "review"], model: "gpt-4", provider: "openai" }] };
  const emp = normalizeCompany(raw).company.employees[0];
  assert.equal(emp.title, "高级工程师");
  assert.deepEqual(emp.duties, ["写代码", "review"]);
  assert.equal(emp.model, "gpt-4");
  assert.equal(emp.provider, "openai");
  // 重载不丢
  const again = normalizeCompany(JSON.parse(JSON.stringify(emp))).company;
  assert.equal(again.title, "高级工程师");
  assert.equal(again.model, "gpt-4");
});

test("createEmployee：接受 title/duties/model/provider", () => {
  let c = bizCompany();
  c = createEmployee(c, { id: "s1", role: "staff", kind: "permanent", department: "A", title: "架构师", duties: ["设计", "评审"], model: "claude-3", provider: "anthropic" });
  const emp = c.employees[0];
  assert.equal(emp.title, "架构师");
  assert.deepEqual(emp.duties, ["设计", "评审"]);
  assert.equal(emp.model, "claude-3");
  assert.equal(emp.provider, "anthropic");
});

test("updateEmployee：允许更新 title/duties/model/provider", () => {
  let c = bizCompany();
  c = createEmployee(c, { id: "s1", role: "staff", kind: "permanent", department: "A", title: "初级" });
  c = updateEmployee(c, "s1", { title: "高级", duties: ["  a  ", "", "b"], model: "llama", provider: "local" });
  const emp = c.employees.find((e) => e.id === "s1");
  assert.equal(emp.title, "高级");
  assert.deepEqual(emp.duties, ["a", "b"]);
  assert.equal(emp.model, "llama");
  assert.equal(emp.provider, "local");
});

/* ==================== v5.11：管理层名称与等级通道覆盖 ==================== */

test("normalizeManagementName：trim/截断 40 字，非字符串回落空串", () => {
  assert.equal(normalizeManagementName("  执行管理层  "), "执行管理层");
  assert.equal(normalizeManagementName("x".repeat(60)).length, 40);
  assert.equal(normalizeManagementName(null), "");
  assert.equal(normalizeManagementName(42), "");
});

test("normalizeLevelsOverride：只覆盖 label/description 与各级名称，代号与数量不变", () => {
  const raw = {
    M: { label: "管理岗", description: "带团队", levels: [{ code: "M2", name: "项目经理" }, { code: "M9", name: "影子" }] },
    P: { label: "技术岗", levels: [{ code: "P1", name: "见习工程师" }] },
  };
  const out = normalizeLevelsOverride(raw);
  assert.equal(out.M.label, "管理岗");
  assert.equal(out.M.description, "带团队");
  assert.equal(out.M.levels.length, DEFAULT_LEVELS.M.levels.length, "不能增删等级");
  assert.equal(out.M.levels.find((lv) => lv.code === "M2").name, "项目经理");
  assert.equal(out.M.levels.some((lv) => lv.code === "M9"), false, "未知代号不写入");
  assert.equal(out.P.levels.find((lv) => lv.code === "P1").name, "见习工程师");
  assert.equal(out.P.levels.find((lv) => lv.code === "P3").name, DEFAULT_LEVELS.P.levels.find((lv) => lv.code === "P3").name, "未覆盖的等级保持默认");
});

test("normalizeCompany：managementName 默认「管理层」，自定义名与等级覆盖随数据保留", () => {
  const { company: fresh } = normalizeCompany(emptyCompany());
  assert.equal(fresh.managementName, MANAGEMENT_NAME_DEFAULT);

  const raw = emptyCompany();
  raw.managementName = "  执行层  ";
  raw.levels = { M: { label: "管理岗", levels: [{ code: "M2", name: "项目经理" }] } };
  const { company: once } = normalizeCompany(raw);
  assert.equal(once.managementName, "执行层");
  assert.equal(once.levels.M.label, "管理岗");
  assert.equal(once.levels.M.levels.find((lv) => lv.code === "M2").name, "项目经理");

  const { company: twice } = normalizeCompany(JSON.parse(JSON.stringify(once)));
  assert.equal(twice.managementName, "执行层", "重载不丢管理层名称");
  assert.equal(twice.levels.M.levels.find((lv) => lv.code === "M2").name, "项目经理", "重载不丢等级覆盖");
});

test("normalizeCompany：非法 levels 回退默认并产生 warning", () => {
  const raw = emptyCompany();
  raw.levels = "not-an-object";
  const { company: out, warnings } = normalizeCompany(raw);
  assert.equal(out.levels, undefined, "非法 levels 应被丢弃");
  assert.ok(warnings.some((w) => String(w).includes("levels")), "应有 levels 回退 warning");
});
