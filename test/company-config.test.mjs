import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCompanyConfig } from "../src/shared/company-config.mjs";
import { DEFAULT_LEVELS, DEFAULT_NUMBERING } from "../src/shared/company-org.mjs";

const DEFAULTS = {
  enabled: true,
  autoBoot: true,
  autoLinkRoster: true,
  defaultSessionPolicy: "per_task",
  managerActsAsStaff: false,
  defaultOrderMode: "async",
  provider: "spawn",
  requireManagerReview: true,
  limits: {
    maxConcurrentPerProvider: 4,
    maxTemps: 4,
    budgetTokensPerDay: 5000000,
    attemptTimeoutMs: 1800000,
    lostReportGraceMs: 120000,
    schedulerIntervalMs: 5000,
    staleAttemptMs: 3600000,
  },
  departments: [],
  routingRules: [],
  toolPolicies: {},
  levels: DEFAULT_LEVELS,
  numbering: DEFAULT_NUMBERING,
};

test("空配置/undefined 返回全默认且无 warnings", () => {
  for (const raw of [undefined, {}]) {
    const { config, warnings } = resolveCompanyConfig(raw);
    assert.deepEqual(config, DEFAULTS);
    assert.deepEqual(warnings, []);
  }
});

test("org.enabled === false 才关闭公司；true 保持启用", () => {
  assert.equal(resolveCompanyConfig({ org: { enabled: false } }).config.enabled, false);
  assert.equal(resolveCompanyConfig({ org: { enabled: true } }).config.enabled, true);
  // 根层 enabled 是插件级开关，不影响公司开关
  assert.equal(resolveCompanyConfig({ enabled: false }).config.enabled, true);
});

test("org.enabled 非法值回退默认(true)并告警", () => {
  const { config, warnings } = resolveCompanyConfig({ org: { enabled: "no" } });
  assert.equal(config.enabled, true);
  assert.ok(warnings.some((w) => w.includes("org.enabled")));
});

test("根层回落：无 org 小节时读根层同名键", () => {
  const { config, warnings } = resolveCompanyConfig({
    defaultOrderMode: "wait",
    defaultSessionPolicy: "resident",
    autoBoot: false,
  });
  assert.equal(config.defaultOrderMode, "wait");
  assert.equal(config.defaultSessionPolicy, "resident");
  assert.equal(config.autoBoot, false);
  assert.deepEqual(warnings, []);
});

test("org 小节优先于根层同名键", () => {
  const { config } = resolveCompanyConfig({
    org: { defaultOrderMode: "wait" },
    defaultOrderMode: "async",
  });
  assert.equal(config.defaultOrderMode, "wait");
});

test("defaultSessionPolicy 非法枚举回退 per_task 并告警", () => {
  const { config, warnings } = resolveCompanyConfig({ defaultSessionPolicy: "wheel" });
  assert.equal(config.defaultSessionPolicy, "per_task");
  assert.ok(warnings.some((w) => w.includes("defaultSessionPolicy")));
});

test("limits 键级合并：合法覆盖 + 非法回退默认并告警", () => {
  const { config, warnings } = resolveCompanyConfig({
    limits: { maxTemps: 9, attemptTimeoutMs: "x", budgetTokensPerDay: 10_000_000 },
  });
  assert.equal(config.limits.maxTemps, 9);
  assert.equal(config.limits.attemptTimeoutMs, 1800000);
  assert.equal(config.limits.budgetTokensPerDay, 10_000_000);
  assert.equal(config.limits.maxConcurrentPerProvider, 4);
  assert.ok(warnings.some((w) => w.includes("limits.attemptTimeoutMs")));
});

test("limits 非对象整体回退默认并告警", () => {
  const { config, warnings } = resolveCompanyConfig({ limits: "big" });
  assert.deepEqual(config.limits, DEFAULTS.limits);
  assert.ok(warnings.some((w) => w.includes("limits")));
});

test("departments 过滤非法条目（保留合法并透传扩展字段）", () => {
  const { config, warnings } = resolveCompanyConfig({
    departments: [
      { id: "A", name: "工程部", charter: "实现" },
      { id: "", name: "无id部门" },
      { id: "B" },
      "not-an-object",
    ],
  });
  assert.equal(config.departments.length, 1);
  assert.equal(config.departments[0].id, "A");
  assert.equal(config.departments[0].charter, "实现");
  assert.equal(warnings.filter((w) => w.includes("departments")).length, 3);
});

test("departments 非数组忽略并告警", () => {
  const { config, warnings } = resolveCompanyConfig({ departments: { A: 1 } });
  assert.deepEqual(config.departments, []);
  assert.ok(warnings.some((w) => w.includes("departments")));
});

test("routingRules 支持 type 与 match 两种键，非法条目丢弃", () => {
  const { config, warnings } = resolveCompanyConfig({
    routingRules: [
      { type: "code_impl", dept: "A" },
      { match: "^prd$", dept: "B" },
      { type: "research" },
      { dept: "A" },
    ],
  });
  assert.equal(config.routingRules.length, 2);
  assert.equal(config.routingRules[0].type, "code_impl");
  assert.equal(config.routingRules[1].match, "^prd$");
  assert.equal(warnings.filter((w) => w.includes("routingRules")).length, 2);
});

test("toolPolicies 归一化：合法行透传，非法行/字段回退并告警", () => {
  const { config, warnings } = resolveCompanyConfig({
    toolPolicies: {
      manage: { allow: ["company_*"], deny: ["company_hire"] },
      staff: "oops",
      window: { allow: "not-an-array" },
      temp: { allow: [1, "x", ""], deny: [] },
    },
  });
  assert.deepEqual(config.toolPolicies.manage, { allow: ["company_*"], deny: ["company_hire"] });
  assert.deepEqual(config.toolPolicies.staff, {});
  assert.deepEqual(config.toolPolicies.window, {});
  assert.deepEqual(config.toolPolicies.temp, { allow: ["x"], deny: [] });
  assert.ok(warnings.some((w) => w.includes("toolPolicies.staff")));
  assert.ok(warnings.some((w) => w.includes("toolPolicies.window.allow")));
});

test("布尔字段非法值回退默认并告警", () => {
  const { config, warnings } = resolveCompanyConfig({
    managerActsAsStaff: "yes",
    requireManagerReview: false,
  });
  assert.equal(config.managerActsAsStaff, false);
  assert.equal(config.requireManagerReview, false);
  assert.ok(warnings.some((w) => w.includes("managerActsAsStaff")));
});

test("非对象配置根回退全默认并告警", () => {
  const { config, warnings } = resolveCompanyConfig("bad-root");
  assert.deepEqual(config, DEFAULTS);
  assert.ok(warnings.length >= 1);
});

test("defaultOrderMode 非法枚举回退 async 并告警", () => {
  const { config, warnings } = resolveCompanyConfig({ defaultOrderMode: "sync" });
  assert.equal(config.defaultOrderMode, "async");
  assert.ok(warnings.some((w) => w.includes("defaultOrderMode")));
});
test("provider 默认 spawn，可经 org/根层覆盖，非法值回退并告警", () => {
  assert.equal(resolveCompanyConfig(undefined).config.provider, "spawn");
  assert.equal(resolveCompanyConfig({}).config.provider, "spawn");
  assert.equal(resolveCompanyConfig({ org: { provider: "fork" } }).config.provider, "fork");
  assert.equal(resolveCompanyConfig({ provider: "fork" }).config.provider, "fork");
  const bad = resolveCompanyConfig({ org: { provider: "" } });
  assert.equal(bad.config.provider, "spawn");
  assert.ok(bad.warnings.some((w) => w.includes("provider")), "非法 provider 应产生 warning");
});

/* ------------------------------------------------------------------ */
/* docs/16 增量：levels 与 numbering                                    */
/* ------------------------------------------------------------------ */

test("levels 默认值可用且为独立拷贝（改返回值不影响后续解析）", () => {
  const first = resolveCompanyConfig({}).config.levels;
  assert.deepEqual(first, DEFAULT_LEVELS);
  first.M.levels[0].name = "被篡改";
  assert.deepEqual(resolveCompanyConfig({}).config.levels, DEFAULT_LEVELS);
});

test("levels 合法覆盖透传（org 优先；preserve description 扩展字段）", () => {
  const custom = {
    M: {
      label: "新管理通道",
      description: "自定义",
      levels: [{ code: "M1", name: "组长", extra: true }],
    },
    P: {
      label: "新专业通道",
      levels: [
        { code: "P1", name: "初级" },
        { code: "P2", name: "高级" },
      ],
    },
  };
  const { config, warnings } = resolveCompanyConfig({ org: { levels: custom } });
  assert.equal(config.levels.M.label, "新管理通道");
  assert.equal(config.levels.M.levels[0].name, "组长");
  assert.equal(config.levels.M.levels[0].extra, true);
  assert.equal(config.levels.P.levels.length, 2);
  assert.equal(warnings.some((w) => w.includes("levels")), false);
});

test("levels 根层回落：无 org 时读根层", () => {
  const { config } = resolveCompanyConfig({ levels: DEFAULT_LEVELS });
  assert.deepEqual(config.levels, DEFAULT_LEVELS);
});

test("levels 非法整体回退默认并告警（缺 P 通道/空等级/非法前缀/重复 code）", () => {
  const cases = [
    { M: { label: "M", levels: [{ code: "M1", name: "主管" }] } }, // 缺 P
    { M: { label: "", levels: [{ code: "M1", name: "主管" }] }, P: { label: "P", levels: [{ code: "P1", name: "初" }] } },
    { M: { label: "M", levels: [{ code: "M1", name: "主管" }] }, P: { label: "P", levels: [] } },
    { M: { label: "M", levels: [{ code: "X1", name: "主管" }] }, P: { label: "P", levels: [{ code: "P1", name: "初" }] } },
    { M: { label: "M", levels: [{ code: "M1", name: "主管" }, { code: "m1", name: "重复" }] }, P: { label: "P", levels: [{ code: "P1", name: "初" }] } },
    "not-an-object",
  ];
  for (const bad of cases) {
    const { config, warnings } = resolveCompanyConfig(
      typeof bad === "string" ? { org: { levels: bad } } : { org: { levels: bad } },
    );
    assert.deepEqual(config.levels, DEFAULT_LEVELS);
    assert.ok(warnings.some((w) => w.includes("levels")), "非法 levels 应产生 warning");
  }
});

test("numbering 合法覆盖：pattern 与 start 透传", () => {
  const { config, warnings } = resolveCompanyConfig({
    numbering: {
      employee: { pattern: "GZ-{dept}-{seq:3}", start: 10 },
      department: { pattern: "{channel}{seq:2}", start: 1 },
    },
  });
  assert.equal(config.numbering.employee.pattern, "GZ-{dept}-{seq:3}");
  assert.equal(config.numbering.employee.start, 10);
  assert.equal(config.numbering.department.pattern, "{channel}{seq:2}");
  assert.deepEqual(warnings, []);
});

test("numbering 条目非法单独回退默认并告警（缺 seq/未知占位/N 越界/start 非法）", () => {
  const cases = [
    { employee: { pattern: "E{dept}", start: 1 } },
    { employee: { pattern: "E{seq:4}{foo}", start: 1 } },
    { employee: { pattern: "E{seq:9}", start: 1 } },
    { employee: { pattern: "E{seq:4}", start: 0 } },
    { employee: { pattern: "E{seq:4}", start: -2 } },
    { employee: { pattern: "E{seq:4}", start: 1.5 } },
    { employee: "not-an-object" },
  ];
  for (const bad of cases) {
    const { config, warnings } = resolveCompanyConfig({ numbering: bad });
    assert.deepEqual(config.numbering.employee, DEFAULT_NUMBERING.employee);
    assert.deepEqual(config.numbering.department, DEFAULT_NUMBERING.department);
    assert.ok(warnings.some((w) => w.includes("numbering.employee")), "非法条目应产生 warning");
  }
});

test("numbering 非对象整体回退默认并告警", () => {
  const { config, warnings } = resolveCompanyConfig({ org: { numbering: [1, 2] } });
  assert.deepEqual(config.numbering.employee, DEFAULT_NUMBERING.employee);
  assert.deepEqual(config.numbering.department, DEFAULT_NUMBERING.department);
  assert.ok(warnings.some((w) => w.includes("numbering")));
});

test("levels/numbering 键缺省时静默使用默认（不产生 warning）", () => {
  const { warnings } = resolveCompanyConfig({ org: {} });
  assert.equal(warnings.some((w) => w.includes("levels") || w.includes("numbering")), false);
});
