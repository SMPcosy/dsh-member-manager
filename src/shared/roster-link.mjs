/**
 * roster-link.mjs —— 公司员工 ↔ 名册（registry.json 覆盖层）关联的纯函数层。
 *
 * 背景（v0.3.2）：
 *  - 公司化员工（company.json）与名册成员（registry.json）是两套数据：
 *    前者是「公司组织」的权威数据，后者是「DSH 核心成员」的展示覆盖层。
 *  - v5.8 起「名册→公司」有补档案动作（importRosterProfiles），但「公司→名册」
 *    从来没有入口，于是 emp-* 生成员工（如内容部）只有公司档案、名册里没有条目，
 *    员工中心看不到「名册：已关联/未登记」。
 *
 * 本模块只做纯计算，不读盘、不依赖宿主：
 *  - 解析员工的关联 target（显式 rosterTarget 优先，缺省就是员工 id）
 *  - 由名册成员数组建索引，描述每个员工的关联状态
 *  - 把员工档案映射成名册成员入参（只补空字段，绝不覆盖人工维护的值）
 */

/** 公司员工与名册的关联状态。 */
export const ROSTER_LINK_STATUS = Object.freeze({
  /** 名册有该 target 且处于 active */
  LINKED: "linked",
  /** 名册有该 target，但成员已停用（retired） */
  RETIRED: "retired",
  /** 名册没有该 target */
  UNLINKED: "unlinked",
});

export const ROSTER_DISPLAY_NAME_MAX = 64;
export const ROSTER_NOTE_MAX = 200;
export const ROSTER_DUTIES_MAX = 8;

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanList(value, max = Infinity) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    const text = cleanText(item);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * 员工的关联 target：显式 rosterTarget 优先，缺省用员工 id。
 * 员工 id 本身就是合法成员名（plugin-arch / emp-mvhzc6kr-13qh 都匹配 TARGET_RE），
 * 所以绝大多数员工不需要显式字段。
 */
export function rosterTargetOf(employee) {
  if (!employee || typeof employee !== "object") return "";
  const explicit = cleanText(employee.rosterTarget);
  if (explicit) return explicit;
  return cleanText(employee.id);
}

/** 员工是否设置了显式关联（rosterTarget 与 id 不同，或显式写了 id 也算）。 */
export function hasExplicitRosterTarget(employee) {
  return Boolean(employee && typeof employee === "object" && cleanText(employee.rosterTarget));
}

/**
 * 名册成员数组 → Map<target, member>。
 * 同名重复时保留第一条（名册本身保证 target 唯一，这里只是防御）。
 */
export function buildRosterIndex(members) {
  const index = new Map();
  if (!Array.isArray(members)) return index;
  for (const member of members) {
    if (!member || typeof member !== "object") continue;
    const target = cleanText(member.target);
    if (!target || index.has(target)) continue;
    index.set(target, member);
  }
  return index;
}

/**
 * 描述一个公司与名册的关联。
 * @param {object} employee 公司员工
 * @param {Map<string, object>|null} index buildRosterIndex 的结果；null = 名册不可读
 */
export function describeRosterLink(employee, index) {
  const target = rosterTargetOf(employee);
  const explicit = hasExplicitRosterTarget(employee);
  if (!(index instanceof Map)) {
    return { target, explicit, status: ROSTER_LINK_STATUS.UNLINKED, available: false, member: null };
  }
  const member = target ? index.get(target) : null;
  if (!member) {
    return { target, explicit, status: ROSTER_LINK_STATUS.UNLINKED, available: true, member: null };
  }
  const retired = member.status !== "active";
  return {
    target,
    explicit,
    status: retired ? ROSTER_LINK_STATUS.RETIRED : ROSTER_LINK_STATUS.LINKED,
    available: true,
    member: {
      displayName: cleanText(member.displayName) || target,
      title: cleanText(member.title),
      model: cleanText(member.model),
      provider: cleanText(member.provider),
      status: cleanText(member.status) || "active",
    },
  };
}

/**
 * 汇总关联情况（员工中心页头 / 面板统计用）。
 * index === null 时返回 available:false —— 不能用「读不到名册」推断「全都未登记」。
 */
export function summarizeRosterLinks(employees, index) {
  const list = Array.isArray(employees) ? employees : [];
  const summary = {
    available: index instanceof Map,
    total: list.length,
    linked: 0,
    retired: 0,
    unlinked: 0,
  };
  if (!summary.available) return summary;
  for (const employee of list) {
    const link = describeRosterLink(employee, index);
    if (link.status === ROSTER_LINK_STATUS.LINKED) summary.linked += 1;
    else if (link.status === ROSTER_LINK_STATUS.RETIRED) summary.retired += 1;
    else summary.unlinked += 1;
  }
  return summary;
}

/**
 * 公司员工 → 名册成员入参。
 * 只映射名册支持的字段：displayName/title/duties/skills/model/provider/note。
 * model/provider 为空时不写（避免把「没有模型覆盖」写成空串）。
 * @param {object} employee
 * @param {{department?: object|null}} [opts] 员工所在部门（用于审计备注）
 */
export function buildRosterProfile(employee, { department = null } = {}) {
  const emp = employee && typeof employee === "object" ? employee : {};
  const target = rosterTargetOf(emp);
  const displayName = (cleanText(emp.displayName) || target).slice(0, ROSTER_DISPLAY_NAME_MAX);
  const deptCode = cleanText(department && department.code);
  const deptName = cleanText(department && department.name);
  const deptLabel = deptCode ? `${deptCode}${deptName ? ` ${deptName}` : ""}` : deptName;
  const note = `公司员工 ${cleanText(emp.id)}${deptLabel ? ` · ${deptLabel}` : ""}`.slice(0, ROSTER_NOTE_MAX);
  const profile = {
    target,
    displayName,
    title: cleanText(emp.title),
    duties: cleanList(emp.duties, ROSTER_DUTIES_MAX),
    skills: cleanList(emp.skills),
    note,
  };
  const model = cleanText(emp.model);
  const provider = cleanText(emp.provider);
  if (model) profile.model = model;
  if (provider) profile.provider = provider;
  return profile;
}

function isBlank(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * 比较名册现有成员与公司档案，算出「只补空字段」补丁。
 * 规则（沿用 docs/15 §17–20 的「绝不覆盖」原则）：
 *  - displayName 为空或等于 target 时视为空，可补
 *  - title/duties/skills 为空时可补
 *  - model/provider 缺失时可补
 *  - refresh=true 时额外用公司档案覆盖 title/duties/skills/model/provider/displayName（显式要求才覆盖）
 * @returns {{action: "noop"|"update", patch: object, reason: string}}
 */
export function planRosterLink(member, profile, { refresh = false } = {}) {
  if (!member || typeof member !== "object") {
    return { action: "update", patch: { ...profile }, reason: "member-missing" };
  }
  const patch = {};
  const currentDisplay = cleanText(member.displayName);
  const target = cleanText(member.target) || cleanText(profile.target);
  const displayIsBlank = !currentDisplay || currentDisplay === target;

  if (refresh) {
    if (cleanText(profile.displayName) && cleanText(profile.displayName) !== currentDisplay) {
      patch.displayName = profile.displayName;
    }
    if (profile.title !== undefined && cleanText(profile.title) !== cleanText(member.title)) patch.title = profile.title;
    if (Array.isArray(profile.duties) && profile.duties.length && profile.duties.join("\u0000") !== cleanList(member.duties).join("\u0000")) {
      patch.duties = profile.duties;
    }
    if (Array.isArray(profile.skills) && profile.skills.length && profile.skills.join("\u0000") !== cleanList(member.skills).join("\u0000")) {
      patch.skills = profile.skills;
    }
    const memberModel = cleanText(member.model);
    const memberProvider = cleanText(member.provider);
    if (cleanText(profile.model) && cleanText(profile.model) !== memberModel) patch.model = profile.model;
    if (cleanText(profile.provider) && cleanText(profile.provider) !== memberProvider) patch.provider = profile.provider;
  } else {
    if (displayIsBlank && cleanText(profile.displayName)) patch.displayName = profile.displayName;
    if (isBlank(member.title) && cleanText(profile.title)) patch.title = profile.title;
    if (isBlank(member.duties) && Array.isArray(profile.duties) && profile.duties.length) patch.duties = profile.duties;
    if (isBlank(member.skills) && Array.isArray(profile.skills) && profile.skills.length) patch.skills = profile.skills;
    if (isBlank(member.model) && cleanText(profile.model)) patch.model = profile.model;
    if (isBlank(member.provider) && cleanText(profile.provider)) patch.provider = profile.provider;
  }
  // 来源备注只在名册侧还没有备注时补，避免覆盖用户手写内容
  if (isBlank(member.note) && cleanText(profile.note)) patch.note = profile.note;

  const fields = Object.keys(patch);
  if (fields.length === 0) return { action: "noop", patch: {}, reason: "" };
  return { action: "update", patch, reason: "fill-blank" };
}

/**
 * 一批员工 → 名册 upsert 计划（供批量登记使用）。
 * @param {object[]} employees
 * @param {{index?: Map|null, refresh?: boolean, departmentOf?: (emp) => object|null, onlyUnlinked?: boolean}} [opts]
 * @returns {Array<{employee: object, target: string, action: "create"|"update"|"noop"|"skip", patch: object, profile: object, reason: string}>}
 */
export function planRosterBatch(employees, { index = null, refresh = false, departmentOf = null, onlyUnlinked = true } = {}) {
  const list = Array.isArray(employees) ? employees : [];
  const map = index instanceof Map ? index : null;
  const out = [];
  for (const employee of list) {
    if (!employee || typeof employee !== "object") continue;
    const target = rosterTargetOf(employee);
    const department = typeof departmentOf === "function" ? departmentOf(employee) : null;
    const profile = buildRosterProfile(employee, { department });
    const member = map ? map.get(target) : null;
    if (!member) {
      out.push({ employee, target, action: "create", patch: { ...profile }, profile, reason: "member-missing" });
      continue;
    }
    // 默认只登记「名册里还没有条目」的员工；已有条目只在显式要求时才回填档案
    if (onlyUnlinked) continue;
    const plan = planRosterLink(member, profile, { refresh });
    if (plan.action === "noop") continue;
    out.push({ employee, target, action: plan.action, patch: plan.patch, profile, reason: plan.reason });
  }
  return out;
}
