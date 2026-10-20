/**
 * company-config.mjs —— 公司配置解析（零 DSH 依赖）。
 *
 * 契约：docs/11-公司化改造-接口契约.md §1.3（resolveCompanyConfig）。
 *
 * 语义要点：
 * - 任何非法值都回退到默认并记 warning，永不抛（宿主启动路径不可被配置炸断）。
 * - 双读兼容：先读 config.org（公司化章节），读不到再回落 config 根层同名键。
 *   兼容 plugin-builder 既有宿主代码（resolveCompanyConfig(rawConfig)，rawConfig 可为 undefined）。
 * - org.enabled === false 才关闭（默认 true）；根层 enabled 不回读（插件自身开关与公司开关分离）。
 */

const limitDefaults = Object.freeze({
  maxConcurrentPerProvider: 4,
  maxTemps: 4,
  budgetTokensPerDay: 5000000,
  attemptTimeoutMs: 1800000,
  lostReportGraceMs: 120000,
  staleAttemptMs: 3600000,
});

const enumFields = Object.freeze({
  defaultSessionPolicy: ["per_task", "resident"],
  defaultOrderMode: ["async", "wait"],
});

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === "string" && v.trim() !== "";
const isBoolish = (v) => typeof v === "boolean";

/**
 * org 小节优先、根层回落的双读字段。返回 { value?, present, source }。
 */
function readField(key, root) {
  const org = isPlainObject(root?.org) ? root.org : null;
  if (org && Object.prototype.hasOwnProperty.call(org, key)) {
    return { value: org[key], present: true, source: "org" };
  }
  if (Object.prototype.hasOwnProperty.call(root, key)) {
    return { value: root[key], present: true, source: "root" };
  }
  return { value: undefined, present: false, source: null };
}

function withDefault(raw, fallback, tag, warnings, validator = () => true) {
  if (raw === undefined) return { value: fallback, ok: true }; // 键缺省：静默用默认
  if (validator(raw)) return { value: raw, ok: true };
  warnings.push(`配置 ${tag} 非法（实际 ${JSON.stringify(raw)}），已回退默认 ${JSON.stringify(fallback)}`);
  return { value: fallback, ok: false };
}

export function resolveCompanyConfig(raw) {
  const warnings = [];
  const root = isPlainObject(raw) ? raw : {};
  if (raw !== undefined && !isPlainObject(raw)) {
    warnings.push("配置根必须为对象，已按空配置处理");
  }

  // enabled：org.enabled === false 才关闭；默认开。根层 enabled 是插件级开关，不混读。
  const enabledSigned = withDefault(
    root.org?.enabled,
    true,
    "org.enabled",
    warnings,
    (v) => v === undefined || isBoolish(v),
  );
  const enabled = enabledSigned.value !== false;

  const autoBoot = withDefault(readField("autoBoot", root).value, true, "autoBoot", warnings, (v) => isBoolish(v)).value;
  const managerActsAsStaff = withDefault(
    readField("managerActsAsStaff", root).value,
    false,
    "managerActsAsStaff",
    warnings,
    (v) => isBoolish(v),
  ).value;
  const requireManagerReview = withDefault(
    readField("requireManagerReview", root).value,
    true,
    "requireManagerReview",
    warnings,
    (v) => isBoolish(v),
  ).value;

  const defaultSessionPolicy = withDefault(
    readField("defaultSessionPolicy", root).value,
    "per_task",
    "defaultSessionPolicy",
    warnings,
    (v) => enumFields.defaultSessionPolicy.includes(v),
  ).value;
  const defaultOrderMode = withDefault(
    readField("defaultOrderMode", root).value,
    "async",
    "defaultOrderMode",
    warnings,
    (v) => enumFields.defaultOrderMode.includes(v),
  ).value;

  // limits：键级别合并与校验。
  const limitsProvided = isPlainObject(root.limits) ? root.limits : {};
  if (!isPlainObject(root.limits) && root.limits !== undefined) {
    warnings.push("配置 limits 非法（必须为对象），已整体回退默认");
  }
  const limits = {};
  for (const [key, fallback] of Object.entries(limitDefaults)) {
    const rawv = limitsProvided[key];
    limits[key] = withDefault(
      rawv === undefined ? fallback : rawv,
      fallback,
      `limits.${key}`,
      warnings,
      (v) => Number.isFinite(v) && v > 0,
    ).value;
  }

  // departments：种子部门过滤（id/name 非空字符串的最小结构校验）。
  const departments = [];
  const deptSource = root.org?.departments ?? root.departments;
  if (deptSource !== undefined && !Array.isArray(deptSource)) {
    warnings.push("配置 departments 非法（必须为数组），已忽略");
  } else if (Array.isArray(deptSource)) {
    for (const d of deptSource) {
      if (!isPlainObject(d) || !isNonEmptyString(d.id) || !isNonEmptyString(d.name)) {
        warnings.push(`配置 departments 含非法条目，已丢弃: ${JSON.stringify(d)}`);
        continue;
      }
      departments.push({ ...d });
    }
  }

  // routingRules：{ type|match, dept } 条目透传，dept 非空字符串才保留。
  const routingRules = [];
  const ruleSource = root.org?.routingRules ?? root.routingRules;
  if (ruleSource !== undefined && !Array.isArray(ruleSource)) {
    warnings.push("配置 routingRules 非法（必须为数组），已忽略");
  } else if (Array.isArray(ruleSource)) {
    for (const r of ruleSource) {
      if (!isPlainObject(r) || !isNonEmptyString(r.dept) || (r.type === undefined && r.match === undefined)) {
        warnings.push(`配置 routingRules 含非法条目，已丢弃: ${JSON.stringify(r)}`);
        continue;
      }
      routingRules.push({ ...r });
    }
  }

  // toolPolicies：{line: {allow?, deny?}}，非对象行丢弃其值、非数组的 allow/deny 剥掉。
  const toolPolicies = {};
  const policySource = root.org?.toolPolicies ?? root.toolPolicies;
  if (policySource !== undefined && !isPlainObject(policySource)) {
    warnings.push("配置 toolPolicies 非法（必须为对象），已忽略");
  } else if (isPlainObject(policySource)) {
    for (const [line, policy] of Object.entries(policySource)) {
      if (!isPlainObject(policy)) {
        warnings.push(`配置 toolPolicies.${line} 非法（必须为对象），已设为 {}`);
        toolPolicies[line] = {};
        continue;
      }
      const normalized = {};
      if (policy.allow !== undefined) {
        if (Array.isArray(policy.allow)) normalized.allow = policy.allow.filter(isNonEmptyString);
        else warnings.push(`配置 toolPolicies.${line}.allow 非法（必须为字符串数组），已剔除`);
      }
      if (policy.deny !== undefined) {
        if (Array.isArray(policy.deny)) normalized.deny = policy.deny.filter(isNonEmptyString);
        else warnings.push(`配置 toolPolicies.${line}.deny 非法（必须为字符串数组），已剔除`);
      }
      toolPolicies[line] = normalized;
    }
  }

  const config = {
    enabled,
    autoBoot,
    defaultSessionPolicy,
    managerActsAsStaff,
    defaultOrderMode,
    requireManagerReview,
    limits,
    departments,
    routingRules,
    toolPolicies,
  };
  return { config, warnings };
}