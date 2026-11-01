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
 * - 0.3.0 增量（docs/16）：levels（M/P 双通道等级目录）与 numbering（编号体系），
 *   均走 org 优先 + 根层回落；任一非法回退默认（DEFAULT_LEVELS / DEFAULT_NUMBERING）+ warning。
 */

import { DEFAULT_LEVELS, DEFAULT_NUMBERING } from "./company-org.mjs";

const limitDefaults = Object.freeze({
  maxConcurrentPerProvider: 4,
  maxTemps: 4,
  budgetTokensPerDay: 5000000,
  attemptTimeoutMs: 1800000,
  lostReportGraceMs: 120000,
  // 调度器轮询间隔：多久扫一次 queued/routed 订单。
  // 注意与 staleAttemptMs 的区别——后者是「一个 attempt 多久没有任何动静算僵死」的判定阈值（默认 1 小时）。
  // v0.5.0 修：过去 createScheduler 误把 staleAttemptMs 当作轮询间隔传入，导致调度器每小时才跑一次，
  // 依赖解锁（DAG 下游）与改派后的重试全部要等一小时，表现为「并行任务永远卡在排队」。
  schedulerIntervalMs: 5000,
  staleAttemptMs: 3600000,
});

const enumFields = Object.freeze({
  defaultSessionPolicy: ["per_task", "resident"],
  defaultOrderMode: ["async", "wait"],
});

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === "string" && v.trim() !== "";
const isBoolish = (v) => typeof v === "boolean";

/* ------------------------------------------------------------------ */
/* M/P 双通道等级与编号配置校验（docs/16 §1.1 / §6）                    */
/* ------------------------------------------------------------------ */

const LEVEL_CHANNELS = ["M", "P"];
const SEQ_PLACEHOLDER = /^seq(?::[1-8])?$/;
const STATIC_PLACEHOLDERS = new Set(["dept", "channel", "level"]);

/**
 * 校验等级目录，返回 {ok, value}；value 为规范化深拷贝（保留 description 等扩展字段）。
 * 任一非法 → ok:false（调用侧整体回退 DEFAULT_LEVELS + 一条 warning）。
 */
function validateLevels(candidate) {
  if (!isPlainObject(candidate)) return { ok: false };
  const out = {};
  for (const ch of LEVEL_CHANNELS) {
    const track = candidate[ch];
    if (!isPlainObject(track)) return { ok: false };
    if (!isNonEmptyString(track.label)) return { ok: false };
    if (!Array.isArray(track.levels) || track.levels.length === 0) return { ok: false };
    const seen = new Set();
    const outLevels = [];
    for (const entry of track.levels) {
      if (!isPlainObject(entry)) return { ok: false };
      if (!isNonEmptyString(entry.code) || !isNonEmptyString(entry.name)) return { ok: false };
      const code = entry.code.trim();
      if (!code.startsWith(ch)) return { ok: false };
      if (seen.has(code)) return { ok: false };
      seen.add(code);
      outLevels.push({ ...entry, code });
    }
    out[ch] = { ...track, label: track.label, levels: outLevels };
  }
  return { ok: true, value: out };
}

/**
 * 校验编号条目（pattern/start 已与默认值合并后的形态）。
 * pattern 必须含 {seq} 或 {seq:N}(1≤N≤8)，所有占位符 ∈ {seq, seq:N, dept, channel, level}；start 正整数。
 */
function validateNumberingEntry(merged) {
  if (!isPlainObject(merged)) return false;
  const pattern = merged.pattern;
  if (typeof pattern !== "string" || pattern.length === 0) return false;
  const matches = [...pattern.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]);
  if (matches.length === 0) return false;
  let hasSeq = false;
  for (const p of matches) {
    if (SEQ_PLACEHOLDER.test(p)) hasSeq = true;
    else if (!STATIC_PLACEHOLDERS.has(p)) return false;
  }
  if (!hasSeq) return false;
  return Number.isInteger(merged.start) && merged.start > 0;
}

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
  // v0.3.3：新建员工/新建部门后自动把员工登记进名册（名册可用时，best-effort）；默认开。
  const autoLinkRoster = withDefault(
    readField("autoLinkRoster", root).value,
    true,
    "autoLinkRoster",
    warnings,
    (v) => isBoolish(v),
  ).value;
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

  // provider：派工使用的 subagent provider 名。宿主注册名是 "spawn"/"fork" 等，
  // 不能写死 "default"（未注册会在 startActivation 抛 NO_PROVIDER）。
  const provider = withDefault(
    readField("provider", root).value,
    "spawn",
    "provider",
    warnings,
    (v) => isNonEmptyString(v),
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

  // levels：M/P 双通道等级目录（org 优先、根层回落）。任一非法 → 整体回退默认 + 一条 warning。
  const levelsResolved = withDefault(
    readField("levels", root).value,
    DEFAULT_LEVELS,
    "levels",
    warnings,
    (v) => validateLevels(v).ok,
  ).value;
  const levels = (() => {
    const v = validateLevels(levelsResolved);
    return v.ok ? v.value : JSON.parse(JSON.stringify(DEFAULT_LEVELS));
  })();

  // numbering：非对象 → 整体回退默认 + warning；条目级校验，非法条目单独回退。
  const numberingRaw = withDefault(
    readField("numbering", root).value,
    DEFAULT_NUMBERING,
    "numbering",
    warnings,
    (v) => isPlainObject(v),
  ).value;
  const numbering = {};
  for (const key of ["employee", "department"]) {
    const fallbackEntry = DEFAULT_NUMBERING[key];
    const rawEntry = isPlainObject(numberingRaw) ? numberingRaw[key] : undefined;
    const merged = {};
    for (const k of ["pattern", "start"]) {
      merged[k] = rawEntry?.[k] !== undefined ? rawEntry[k] : fallbackEntry[k];
    }
    if (rawEntry !== undefined && !isPlainObject(rawEntry)) {
      warnings.push(`配置 numbering.${key} 非法（必须为对象），已回退默认`);
      numbering[key] = JSON.parse(JSON.stringify(fallbackEntry));
    } else if (validateNumberingEntry(merged)) {
      numbering[key] = { ...merged, ...(rawEntry ?? {}), pattern: merged.pattern, start: merged.start };
    } else if (rawEntry !== undefined) {
      warnings.push(
        `配置 numbering.${key} 非法（pattern 须含 {seq}/{seq:N}(1≤N≤8)，占位符限 {seq,seq:N,dept,channel,level}，start 正整数），已回退默认`,
      );
      numbering[key] = JSON.parse(JSON.stringify(fallbackEntry));
    } else {
      numbering[key] = JSON.parse(JSON.stringify(fallbackEntry));
    }
  }

  const config = {
    enabled,
    autoBoot,
    autoLinkRoster,
    defaultSessionPolicy,
    managerActsAsStaff,
    defaultOrderMode,
    provider,
    requireManagerReview,
    limits,
    departments,
    routingRules,
    toolPolicies,
    levels,
    numbering,
  };
  return { config, warnings };
}