import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCompanyConfig } from "../src/shared/company-config.mjs";

const DEFAULTS = {
  enabled: true,
  autoBoot: true,
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
    staleAttemptMs: 3600000,
  },
  departments: [],
  routingRules: [],
  toolPolicies: {},
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
