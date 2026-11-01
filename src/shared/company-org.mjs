/**
 * company-org.mjs
 * 组织架构纯函数数据模型（零 DSH 依赖）。
 * 负责人：plugin-arch；本实现为最小化 stub 以满足既有测试并支持 P2 运行时联调。
 * 0.3.0 增量（task-7）：M/P 双通道等级 + 员工/部门编号体系（docs/16-MP双通道等级与编号契约.md §1）。
 * 0.3.1 增量（docs/24-游戏开发模式预设契约.md §4）：部门可套用/清除流程预设。
 */

import { applyPresetToDepartment, clearPresetFromDepartment } from "./company-presets.mjs";
import { isValidMemberName } from "./registry-core.mjs";

export const COMPANY_VERSION = 1;
export const COMPANY_NAME_DEFAULT = "我的公司";
export const COMPANY_NAME_MAX = 40;

/** 公司名：trim + 截断到 40 字符；非字符串 → ""。 */
export function normalizeCompanyName(value) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, COMPANY_NAME_MAX);
}

export const EMPLOYEE_KIND = Object.freeze({
  PERMANENT: "permanent",
  TEMP: "temp",
  SHARED: "shared",
});

export const EMPLOYEE_ROLE = Object.freeze({
  MANAGER: "manager",
  STAFF: "staff",
  WINDOW: "window",
});

export const EMPLOYEE_STATE = Object.freeze({
  IDLE: "idle",
  WORKING: "working",
  COLD: "cold",
  FIRED: "fired",
  // 临时工到期/做满约定次数后自动退场（保留记录与历史，不再参与派工）
  RETIRED: "retired",
});

export const EMPLOYEE_DUTIES_MAX = 8;

export const SESSION_POLICY = Object.freeze({
  PER_TASK: "per_task",
  RESIDENT: "resident",
});

/* ------------------------------------------------------------------ */
/* M/P 双通道等级与编号（docs/16 §1.1 冻结导出）                        */
/* ------------------------------------------------------------------ */

export const LEVEL_CHANNEL = Object.freeze({ MANAGEMENT: "M", PROFESSIONAL: "P" });

export const DEFAULT_LEVELS = Object.freeze({
  M: {
    label: "管理通道",
    description: "管理岗：带团队、管部门、对结果负责；晋升看管理幅度与绩效。",
    levels: [
      { code: "M1", name: "主管" },
      { code: "M2", name: "经理" },
      { code: "M3", name: "高级经理" },
      { code: "M4", name: "总监" },
      { code: "M5", name: "副总裁" },
    ],
  },
  P: {
    label: "技术通道",
    description: "技术岗：不管人，靠专业深度与产出晋升。",
    levels: [
      { code: "P1", name: "初级工程师" },
      { code: "P2", name: "工程师" },
      { code: "P3", name: "高级工程师" },
      { code: "P4", name: "资深工程师" },
      { code: "P5", name: "技术专家" },
      { code: "P6", name: "首席专家" },
    ],
  },
});

export const DEFAULT_EMPLOYEE_LEVEL = Object.freeze({ manager: "M2", staff: "P3", window: "P1" });

export const DEFAULT_NUMBERING = Object.freeze({
  employee: { pattern: "E{seq:4}", start: 1 },
  department: { pattern: "D{seq:2}", start: 1 },
});

/* v5.11：架构图顶层「管理层」虚拟节点的显示名（只做展示，不落部门账本）。 */
export const MANAGEMENT_NAME_DEFAULT = "管理层";
export const MANAGEMENT_NAME_MAX = 40;

export function normalizeManagementName(value) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, MANAGEMENT_NAME_MAX);
}

const LEVEL_CODE_RE = /^([MP])([1-9]\d*)$/;

function cloneLevels(base = DEFAULT_LEVELS) {
  const out = {};
  for (const channel of ["M", "P"]) {
    const ch = (base && base[channel]) || DEFAULT_LEVELS[channel];
    out[channel] = {
      label: ch.label,
      description: ch.description || "",
      levels: (Array.isArray(ch.levels) ? ch.levels : []).map((lv) => ({ code: lv.code, name: lv.name })),
    };
  }
  return out;
}

/**
 * v5.12：等级通道目录校验——等级可增删（代号必须是「通道字母 + 序号」，如 M1、P12），
 * 每个通道至少保留 1 级；返回 {ok:true, levels} 或 {ok:false, code, message, errors}。
 */
export function validateLevelsDirectory(raw, base = DEFAULT_LEVELS) {
  const src = raw && typeof raw === "object" ? raw : {};
  const errors = [];
  const out = {};
  for (const channel of ["M", "P"]) {
    const baseCh = (base && base[channel]) || DEFAULT_LEVELS[channel];
    const found = src[channel] && typeof src[channel] === "object" ? src[channel] : null;
    const label =
      found && typeof found.label === "string" && found.label.trim()
        ? found.label.trim().slice(0, 20)
        : baseCh.label;
    const description =
      found && typeof found.description === "string" && found.description.trim()
        ? found.description.trim().slice(0, 160)
        : baseCh.description || "";
    const rawLevels = found && Array.isArray(found.levels) ? found.levels : null;
    if (!rawLevels) {
      out[channel] = {
        label,
        description,
        levels: (Array.isArray(baseCh.levels) ? baseCh.levels : []).map((lv) => ({ code: lv.code, name: lv.name })),
      };
      continue;
    }
    if (rawLevels.length === 0) errors.push(`${channel} 通道至少保留一个等级`);
    const seen = new Set();
    const cleaned = [];
    for (const lv of rawLevels) {
      const code = lv && typeof lv === "object" && typeof lv.code === "string" ? lv.code.trim() : "";
      const m = LEVEL_CODE_RE.exec(code);
      if (!m || m[1] !== channel) {
        errors.push(`等级代号 ${code || "(空)"} 格式非法（应为 ${channel}1、${channel}2 …）`);
        continue;
      }
      if (seen.has(code)) {
        errors.push(`等级代号 ${code} 重复`);
        continue;
      }
      seen.add(code);
      const name = typeof lv.name === "string" ? lv.name.trim().slice(0, 24) : "";
      if (!name) errors.push(`等级 ${code} 名称不能为空`);
      cleaned.push({ code, name: name || code });
    }
    cleaned.sort((a, b) => Number(a.code.slice(1)) - Number(b.code.slice(1)));
    out[channel] = {
      label,
      description,
      levels: cleaned.length ? cleaned : (Array.isArray(baseCh.levels) ? baseCh.levels : []).map((lv) => ({ code: lv.code, name: lv.name })),
    };
  }
  if (errors.length) return { ok: false, code: "E_INVALID_LEVELS", message: errors[0], errors };
  return { ok: true, levels: out };
}

/** v5.11/v5.12：等级通道目录覆盖；非法时整体回退 base。 */
export function normalizeLevelsOverride(raw, base = DEFAULT_LEVELS) {
  const result = validateLevelsDirectory(raw, base);
  return result.ok ? result.levels : cloneLevels(base);
}

const CHANNELS = new Set(Object.values(LEVEL_CHANNEL));
const MAX_CODE_ATTEMPTS = 100000;
const MAX_CODE_LENGTH = 32;

const KINDS = new Set(Object.values(EMPLOYEE_KIND));
const ROLES = new Set(Object.values(EMPLOYEE_ROLE));
const STATES = new Set(Object.values(EMPLOYEE_STATE));
const SESSION_POLICIES = new Set(Object.values(SESSION_POLICY));

export class OrgError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "OrgError";
    if (code !== undefined) this.code = code;
  }
}

function orgError(message, code) {
  return new OrgError(message, code);
}

export function emptyCompany(now = new Date().toISOString()) {
  return {
    version: COMPANY_VERSION,
    status: "running",
    startedAt: now,
    departments: [],
    employees: [],
    limits: {},
    numbering: clone(DEFAULT_NUMBERING),
    managementName: MANAGEMENT_NAME_DEFAULT,
    companyName: COMPANY_NAME_DEFAULT,
  };
}

export function normalizeCompany(raw, now = new Date().toISOString()) {
  const warnings = [];
  const base = emptyCompany(now);
  const company = {
    ...base,
    ...(raw && typeof raw === "object" ? raw : {}),
    version: COMPANY_VERSION,
    departments: Array.isArray(raw?.departments) ? raw.departments : [],
    employees: [],
    limits: raw?.limits && typeof raw.limits === "object" ? raw.limits : base.limits,
  };
  const numbering = company.numbering && typeof company.numbering === "object" ? company.numbering : DEFAULT_NUMBERING;

  if (!Array.isArray(raw?.employees)) {
    warnings.push("employees 不是数组，已重置为空。");
  }

  const usedCodes = new Set();
  for (const emp of Array.isArray(raw?.employees) ? raw.employees : []) {
    try {
      const e = {
        id: String(emp.id),
        displayName: emp.displayName || String(emp.id),
        kind: normalizeKind(emp.kind),
        role: normalizeRole(emp.role),
        sessionPolicy: normalizeSessionPolicy(emp.sessionPolicy),
        state: normalizeState(emp.state),
        department: emp.department ?? null,
        skills: Array.isArray(emp.skills) ? emp.skills : [],
        lastUsed: emp.lastUsed ?? 0,
        channel: emp.channel,
        level: emp.level,
        channels: Array.isArray(emp.channels) ? emp.channels : undefined,
        code: emp.code,
        title: typeof emp.title === "string" ? emp.title.trim() : "",
        duties: normalizeDuties(emp.duties),
        model: typeof emp.model === "string" ? emp.model.trim() : "",
        provider: typeof emp.provider === "string" ? emp.provider.trim() : "",
      };
      // v0.4：成员属性必须跟着落盘走一遍再回来（withLedger 每次都会 store.load() 重建员工对象，
      // 这里漏字段 = 临时工计次/推理强度/工具黑名单/当前派工在第一次操作后凭空消失）。
      if (typeof emp.reasoningEffort === "string" && emp.reasoningEffort) e.reasoningEffort = emp.reasoningEffort;
      if (emp.memberProvider === "spawn" || emp.memberProvider === "fork") e.memberProvider = emp.memberProvider;
      if (Number.isInteger(emp.maxDepth) && emp.maxDepth >= 0) e.maxDepth = emp.maxDepth;
      if (emp.toolPolicy && typeof emp.toolPolicy === "object" && !Array.isArray(emp.toolPolicy)) {
        e.toolPolicy = {
          allow: Array.isArray(emp.toolPolicy.allow) ? emp.toolPolicy.allow.filter((x) => typeof x === "string") : [],
          deny: Array.isArray(emp.toolPolicy.deny) ? emp.toolPolicy.deny.filter((x) => typeof x === "string") : [],
        };
      }
      if (emp.currentOrderId) e.currentOrderId = String(emp.currentOrderId);
      if (emp.currentAttemptId) e.currentAttemptId = String(emp.currentAttemptId);
      if (emp.lastActiveAt != null) e.lastActiveAt = emp.lastActiveAt;
      if (typeof emp.notes === "string" && emp.notes) e.notes = emp.notes;
      if (typeof emp.tempHiredAt === "string" && emp.tempHiredAt) e.tempHiredAt = emp.tempHiredAt;
      if (emp.tempMaxTasks != null) e.tempMaxTasks = Math.max(0, Math.floor(Number(emp.tempMaxTasks) || 0));
      if (emp.tempCompleted != null) e.tempCompleted = Math.max(0, Math.floor(Number(emp.tempCompleted) || 0));
      if (typeof emp.tempExpiresAt === "string" && emp.tempExpiresAt) e.tempExpiresAt = emp.tempExpiresAt;
      // v0.3.2：显式名册关联（缺省不写字段，把「员工 id 即名册 target」留作隐式约定）
      const rosterTarget = typeof emp.rosterTarget === "string" ? emp.rosterTarget.trim() : "";
      if (rosterTarget) e.rosterTarget = rosterTarget;
      // 等级迁移：非法 level/channel 回退默认 + warning，不丢员工（docs/16 §1.3）。
      try {
        migrateIdentity(emp, e, warnings);
      } catch (err) {
        warnings.push(`员工 ${e.id} 等级迁移失败，已回退默认: ${err.message}`);
        const fallbackRole = e.role ?? EMPLOYEE_ROLE.STAFF;
        e.channel = channelForRole(fallbackRole) ?? LEVEL_CHANNEL.PROFESSIONAL;
        e.level = DEFAULT_EMPLOYEE_LEVEL[fallbackRole] ?? DEFAULT_EMPLOYEE_LEVEL.staff;
      }
      // 编号迁移：缺号/非法/重复自动补号（确定性、可预期）。
      try {
        const kept = adoptCode(emp.code, usedCodes);
        if (kept.ok) {
          e.code = kept.value;
        } else {
          if (kept.reason) warnings.push(`员工 ${e.id} code ${kept.reason}，自动补号`);
          e.code = nextCodeFromSet(
            numbering.employee ?? DEFAULT_NUMBERING.employee,
            usedCodes,
            "员工",
            { dept: departmentCodeOf(company, e.department), channel: e.channel, level: e.level },
          );
        }
      } catch (err) {
        warnings.push(`员工 ${e.id} 补号失败: ${err.message}`);
        e.code = `E-${e.id}`;
      }
      company.employees.push(e);
    } catch (err) {
      warnings.push(`丢弃非法员工 ${emp?.id}: ${err.message}`);
    }
  }

  // v5.11：管理层显示名与等级通道显示名的持久化覆盖（只影响展示，不动账本结构）。
  company.managementName = normalizeManagementName(company.managementName) || MANAGEMENT_NAME_DEFAULT;
  company.companyName = normalizeCompanyName(company.companyName) || COMPANY_NAME_DEFAULT;
  if (raw && raw.levels !== undefined) {
    if (raw.levels && typeof raw.levels === "object") {
      company.levels = normalizeLevelsOverride(raw.levels);
    } else {
      delete company.levels;
      warnings.push("levels 不是对象，已回退默认等级通道。");
    }
  }

  return { company, warnings };
}

function normalizeDuties(v) {
  if (!Array.isArray(v)) return [];
  return v
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, EMPLOYEE_DUTIES_MAX);
}

function normalizeKind(v) {
  if (!v) return EMPLOYEE_KIND.PERMANENT;
  if (KINDS.has(v)) return v;
  throw new OrgError(`非法 kind: ${v}`);
}

function normalizeRole(v) {
  if (!v) return EMPLOYEE_ROLE.STAFF;
  if (ROLES.has(v)) return v;
  throw new OrgError(`非法 role: ${v}`);
}

function normalizeState(v) {
  if (!v) return EMPLOYEE_STATE.IDLE;
  if (STATES.has(v)) return v;
  throw new OrgError(`非法 state: ${v}`);
}

function normalizeSessionPolicy(v) {
  if (!v) return SESSION_POLICY.PER_TASK;
  if (SESSION_POLICIES.has(v)) return v;
  throw new OrgError(`非法 sessionPolicy: ${v}`);
}

function clone(c) {
  return JSON.parse(JSON.stringify(c === undefined ? null : c));
}

function findDepartment(c, id) {
  return c.departments.find((d) => d.id === id);
}

function findEmployee(c, id) {
  return c.employees.find((e) => e.id === id);
}

function departmentCodeOf(company, departmentId) {
  const d = findDepartment(company, departmentId);
  return typeof d?.code === "string" ? d.code : "";
}

/* ------------------------------------------------------------------ */
/* 等级与通道（docs/16 §1.1）                                           */
/* ------------------------------------------------------------------ */

/**
 * 通道 ↔ 岗位一致性：manager → M；staff/window → P。
 * role 缺省返回 null；非法 role 抛 OrgError。
 */
export function channelForRole(role) {
  if (role === undefined || role === null || role === "") return null;
  if (role === EMPLOYEE_ROLE.MANAGER) return LEVEL_CHANNEL.MANAGEMENT;
  if (role === EMPLOYEE_ROLE.STAFF || role === EMPLOYEE_ROLE.WINDOW) return LEVEL_CHANNEL.PROFESSIONAL;
  throw orgError(`非法 role: ${role}`, "E_INVALID_ROLE");
}

/**
 * 校验并解析等级，返回规范形 { channel, code, name }。非法抛 OrgError。
 */
export function resolveLevel(channel, level, levels = DEFAULT_LEVELS) {
  if (!CHANNELS.has(channel)) throw orgError(`非法通道: ${channel}`, "E_INVALID_CHANNEL");
  const track = levels?.[channel];
  if (!track || !Array.isArray(track.levels)) throw orgError(`通道 ${channel} 缺少等级目录`, "E_INVALID_CHANNEL");
  const entry = track.levels.find((l) => l?.code === level);
  if (!entry) throw orgError(`非法等级 ${level}（通道 ${channel}）`, "E_INVALID_LEVEL");
  return { channel, code: entry.code, name: entry.name };
}

/**
 * 由员工档案推导通道/等级/等级名（用于补号与展示；永不抛）。
 */
export function describeEmployeeLevel(employee, levels = DEFAULT_LEVELS) {
  const role = employee?.role ?? EMPLOYEE_ROLE.STAFF;
  let channel = CHANNELS.has(employee?.channel) ? employee.channel : null;
  if (!channel) channel = (() => { try { return channelForRole(role); } catch { return null; } })();
  if (!channel) channel = LEVEL_CHANNEL.PROFESSIONAL;
  const level = employee?.level ?? DEFAULT_EMPLOYEE_LEVEL[role] ?? DEFAULT_EMPLOYEE_LEVEL.staff;
  const track = levels?.[channel];
  const entry = Array.isArray(track?.levels) ? track.levels.find((l) => l?.code === level) : undefined;
  return { channel, level, levelName: entry?.name ?? level };
}

/**
 * 历史数据身份迁移（normalizeCompany / ensureCompanyCodes 共用；就地改写 target）。
 * - channel 缺失 → 按 role 推导；channel 非法或与岗位冲突 → 按 role 归正 + warning。
 * - level 缺失或不在该通道目录 → 回退 DEFAULT_EMPLOYEE_LEVEL[role] + warning。
 */
const CHANNEL_ORDER = Object.freeze({ M: 0, P: 1 });

function sortChannels(list) {
  return [...list].sort((a, b) => CHANNEL_ORDER[a.channel] - CHANNEL_ORDER[b.channel]);
}

function defaultLevelFor(channel, role, levels = DEFAULT_LEVELS) {
  const preferred = DEFAULT_EMPLOYEE_LEVEL[role];
  const track = levels?.[channel]?.levels;
  const has = (code) => !Array.isArray(track) || track.some((l) => l.code === code);
  const first = () => (Array.isArray(track) && track.length ? track[0].code : undefined);
  if (!(typeof preferred === "string" && preferred.startsWith(channel))) {
    const legacy = channel === LEVEL_CHANNEL.MANAGEMENT ? DEFAULT_EMPLOYEE_LEVEL.manager : DEFAULT_EMPLOYEE_LEVEL.staff;
    return has(legacy) ? legacy : (first() ?? legacy);
  }
  return has(preferred) ? preferred : (first() ?? preferred);
}

/** 主通道：含 M 即 M，否则 P（docs/21 §1.1）。 */
export function primaryChannelOf(channels) {
  return Array.isArray(channels) && channels.some((c) => c?.channel === LEVEL_CHANNEL.MANAGEMENT)
    ? LEVEL_CHANNEL.MANAGEMENT
    : LEVEL_CHANNEL.PROFESSIONAL;
}

/**
 * 把任意员工档案（旧 channel/level 或新 channels）归一为规范通道列表。
 * 永不抛：非法通道/等级丢弃或回退默认；role 规则（manager 必含 M、window 禁 M）在此归正。
 */
export function normalizeChannels(employeeLike, levels = DEFAULT_LEVELS) {
  const warnings = [];
  const id = employeeLike?.id ?? "?";
  const role = employeeLike?.role ?? EMPLOYEE_ROLE.STAFF;
  const seen = [];

  const push = (channel, level) => {
    if (seen.some((c) => c.channel === channel)) {
      warnings.push(`员工 ${id} 通道重复（${channel}），已去重`);
      return;
    }
    const track = levels?.[channel]?.levels;
    if (!Array.isArray(track) || track.length === 0) {
      warnings.push(`员工 ${id} 通道 ${channel} 缺少等级目录，已忽略`);
      return;
    }
    let lv = level;
    if (!track.some((l) => l?.code === lv)) {
      lv = defaultLevelFor(channel, role, levels);
      if (level !== undefined && level !== null && level !== "") {
        warnings.push(`员工 ${id} ${channel} 等级非法（${level}），回退默认 ${lv}`);
      }
    }
    seen.push({ channel, level: lv });
  };

  const raw = Array.isArray(employeeLike?.channels) ? employeeLike.channels : [];
  for (const item of raw) {
    if (!item || !CHANNELS.has(item.channel)) {
      warnings.push(`员工 ${id} 通道非法（${item?.channel}），已忽略`);
      continue;
    }
    push(item.channel, item.level);
  }
  if (seen.length === 0) {
    const legacyChannel = CHANNELS.has(employeeLike?.channel) ? employeeLike.channel : null;
    const fallback = legacyChannel ?? (role === EMPLOYEE_ROLE.MANAGER ? LEVEL_CHANNEL.MANAGEMENT : LEVEL_CHANNEL.PROFESSIONAL);
    push(fallback, employeeLike?.level);
  }

  if (role === EMPLOYEE_ROLE.WINDOW) {
    const ix = seen.findIndex((c) => c.channel === LEVEL_CHANNEL.MANAGEMENT);
    if (ix >= 0) {
      seen.splice(ix, 1);
      warnings.push(`员工 ${id} 为 window 岗位，M 通道已按规则移除`);
    }
  }
  if (role === EMPLOYEE_ROLE.MANAGER && !seen.some((c) => c.channel === LEVEL_CHANNEL.MANAGEMENT)) {
    push(LEVEL_CHANNEL.MANAGEMENT, undefined);
    warnings.push(`员工 ${id} 为 manager，已补 M 通道`);
  }
  if (seen.length === 0) push(LEVEL_CHANNEL.PROFESSIONAL, undefined);

  return { channels: sortChannels(seen), warnings };
}

/** 员工在某通道的等级；没有该通道返回 null；永不抛。 */
export function resolveChannelLevel(employee, channel, levels = DEFAULT_LEVELS) {
  if (!CHANNELS.has(channel)) return null;
  const { channels } = normalizeChannels(employee, levels);
  const hit = channels.find((c) => c.channel === channel);
  if (!hit) return null;
  const track = levels?.[channel]?.levels;
  const entry = Array.isArray(track) ? track.find((l) => l?.code === hit.level) : undefined;
  return { channel, level: hit.level, name: entry?.name ?? hit.level };
}

/** 员工全部通道的展示描述（主通道标记 primary）。 */
export function describeEmployeeChannels(employee, levels = DEFAULT_LEVELS) {
  const { channels } = normalizeChannels(employee, levels);
  const primary = primaryChannelOf(channels);
  return channels.map((c) => {
    const track = levels?.[c.channel]?.levels;
    const entry = Array.isArray(track) ? track.find((l) => l?.code === c.level) : undefined;
    return { channel: c.channel, level: c.level, levelName: entry?.name ?? c.level, primary: c.channel === primary };
  });
}

/**
 * 直接设置员工通道列表（docs/21 §1.2）。返回 { company, from, to }。
 * 校验：≥1（E_LAST_CHANNEL）、通道合法（E_INVALID_CHANNEL）、重复（E_CHANNEL_CONFLICT）、
 * 等级合法（E_INVALID_LEVEL）、role 规则（manager 必含 M / window 禁 M，均 E_CHANNEL_CONFLICT）。
 */
export function setEmployeeChannels(company, employeeId, channels, { levels = DEFAULT_LEVELS } = {}) {
  const c = clone(company);
  const emp = findEmployee(c, employeeId);
  if (!emp) throw orgError(`员工 ${employeeId} 不存在`, "E_NOT_FOUND");
  if (!Array.isArray(channels) || channels.length === 0) throw orgError("至少保留一个通道", "E_LAST_CHANNEL");

  const seen = [];
  for (const item of channels) {
    const channel = item?.channel;
    if (!CHANNELS.has(channel)) throw orgError(`非法通道: ${channel}`, "E_INVALID_CHANNEL");
    if (seen.some((x) => x.channel === channel)) throw orgError(`通道重复: ${channel}`, "E_CHANNEL_CONFLICT");
    resolveLevel(channel, item?.level, levels);
    seen.push({ channel, level: item.level });
  }
  if (emp.role === EMPLOYEE_ROLE.WINDOW && seen.some((x) => x.channel === LEVEL_CHANNEL.MANAGEMENT)) {
    throw orgError("window 岗位不能拥有 M 通道", "E_CHANNEL_CONFLICT");
  }
  if (emp.role === EMPLOYEE_ROLE.MANAGER && !seen.some((x) => x.channel === LEVEL_CHANNEL.MANAGEMENT)) {
    throw orgError("manager 岗位必须保留 M 通道", "E_CHANNEL_CONFLICT");
  }

  const from = { channels: describeEmployeeChannels(emp, levels).map(({ channel, level }) => ({ channel, level })) };
  const next = sortChannels(seen);
  emp.channels = next;
  emp.channel = primaryChannelOf(next);
  emp.level = next.find((x) => x.channel === emp.channel).level;
  return { company: c, from, to: { channels: next.map((x) => ({ ...x })), channel: emp.channel, level: emp.level } };
}

function migrateIdentity(source, target, warnings) {
  const { channels, warnings: chWarnings } = normalizeChannels(target, DEFAULT_LEVELS);
  for (const w of chWarnings) warnings.push(w);
  target.channels = channels;
  target.channel = primaryChannelOf(channels);
  target.level = channels.find((c) => c.channel === target.channel).level;
}

/* ------------------------------------------------------------------ */
/* 编号体系（docs/16 §1.1 / §3）                                        */
/* ------------------------------------------------------------------ */

/**
 * 渲染编号模板。占位符：{seq} {seq:N} {dept} {channel} {level}；未知占位符原样保留。
 */
export function formatCode(pattern, vars = {}) {
  const seq = vars.seq ?? "";
  const dept = vars.dept ?? "";
  const channel = vars.channel ?? "";
  const level = vars.level ?? "";
  return String(pattern)
    .replace(/\{seq:(\d+)\}/g, (_m, w) => String(seq).padStart(Number(w), "0"))
    .replace(/\{seq\}/g, String(seq))
    .replace(/\{dept\}/g, dept)
    .replace(/\{channel\}/g, channel)
    .replace(/\{level\}/g, level);
}

/** 去空格后非空、长度 ≤32、不含空白字符；返回 cleanup 后的编号。 */
function sanitizeCode(raw, owner) {
  if (typeof raw !== "string") return { ok: false, reason: "缺失或非字符串" };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "为空" };
  if (trimmed.length > MAX_CODE_LENGTH) return { ok: false, reason: `超过 ${MAX_CODE_LENGTH} 字符` };
  if (/\s/.test(trimmed)) return { ok: false, reason: "含空白字符" };
  return { ok: true, value: trimmed };
}

/** 显式编号校验（唯一 + 格式）；重复抛 E_DUPLICATE_CODE。 */
function normalizeCodeInput(raw, owner, used) {
  const cleaned = sanitizeCode(raw, owner);
  if (!cleaned.ok) throw orgError(`${owner}编号非法：${cleaned.reason}`, "E_INVALID_CODE");
  if (used.has(cleaned.value)) throw orgError(`${owner}编号 ${cleaned.value} 已存在`, "E_DUPLICATE_CODE");
  return cleaned.value;
}

/** adopt：合法且未占用则占用并返回；否则返回原因（不占位、不抛）。 */
function adoptCode(raw, used) {
  const cleaned = sanitizeCode(raw, "编号");
  if (!cleaned.ok) return { ok: false, reason: cleaned.reason };
  if (used.has(cleaned.value)) return { ok: false, reason: `${cleaned.value} 重复` };
  used.add(cleaned.value);
  return { ok: true, value: cleaned.value };
}

/** 从 start 起递增渲染模板，占用即跳号，最多 100000 次；耗尽抛 E_CODE_EXHAUSTED。 */
function nextCodeFromSet(spec, used, owner, context = {}) {
  const { pattern = owner === "部门" ? "D{seq:2}" : "E{seq:4}", start = 1 } = spec && typeof spec === "object" ? spec : {};
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const candidate = formatCode(pattern, { seq: start + attempt, ...context });
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  throw orgError(`${owner}编号已耗尽：从 ${start} 起尝试 ${MAX_CODE_ATTEMPTS} 次均被占用`, "E_CODE_EXHAUSTED");
}

/** 员工下一个可用编号（company 只读）。context: {dept, channel, level}。 */
export function nextEmployeeCode(company, numbering = DEFAULT_NUMBERING, context = {}) {
  const spec = numbering?.employee ?? DEFAULT_NUMBERING.employee;
  const used = new Set((company?.employees ?? []).map((e) => e?.code).filter(Boolean));
  return nextCodeFromSet(spec, used, "员工", context);
}

/** 部门下一个可用编号（company 只读）。 */
export function nextDepartmentCode(company, numbering = DEFAULT_NUMBERING) {
  const spec = numbering?.department ?? DEFAULT_NUMBERING.department;
  const used = new Set((company?.departments ?? []).map((d) => d?.code).filter(Boolean));
  return nextCodeFromSet(spec, used, "部门", {});
}

/**
 * 给缺号的历史数据补号（幂等；返回新对象）。先补部门后补员工，
 * 保证员工模板里的 {dept} 取到部门新编号。
 */
export function ensureCompanyCodes(company, { levels = DEFAULT_LEVELS, numbering = DEFAULT_NUMBERING } = {}) {
  const c = clone(company);
  const warnings = [];
  const num = c.numbering && typeof c.numbering === "object" ? c.numbering : numbering;
  const dUsed = new Set();
  for (const d of c.departments ?? []) {
    const adopted = adoptCode(d?.code, dUsed);
    if (adopted.ok) {
      d.code = adopted.value;
      continue;
    }
    if (d?.code !== undefined && d?.code !== null && d?.code !== "") {
      warnings.push(`部门 ${d.id} code ${typeof d.code === "string" ? d.code : JSON.stringify(d.code)} 非法或重复，自动补号`);
    }
    d.code = nextCodeFromSet(num.department ?? DEFAULT_NUMBERING.department, dUsed, "部门", {});
  }
  const eUsed = new Set();
  for (const emp of c.employees ?? []) {
    try {
      migrateIdentity(emp, emp, warnings);
    } catch (err) {
      warnings.push(`员工 ${emp.id} 等级迁移失败，已回退默认: ${err.message}`);
      const fallbackRole = emp.role ?? EMPLOYEE_ROLE.STAFF;
      emp.channel = channelForRole(fallbackRole) ?? LEVEL_CHANNEL.PROFESSIONAL;
      emp.level = DEFAULT_EMPLOYEE_LEVEL[fallbackRole] ?? DEFAULT_EMPLOYEE_LEVEL.staff;
    }
    const adopted = adoptCode(emp?.code, eUsed);
    if (adopted.ok) {
      emp.code = adopted.value;
      continue;
    }
    if (emp?.code !== undefined && emp?.code !== null && emp?.code !== "") {
      warnings.push(`员工 ${emp.id} code ${typeof emp.code === "string" ? emp.code : JSON.stringify(emp.code)} 非法或重复，自动补号`);
    }
    emp.code = nextCodeFromSet(num.employee ?? DEFAULT_NUMBERING.employee, eUsed, "员工", {
      dept: departmentCodeOf(c, emp.department),
      channel: emp.channel,
      level: emp.level,
    });
  }
  return { company: c, warnings };
}

/* ------------------------------------------------------------------ */
/* 部门（docs/16 §1.2）                                                 */
/* ------------------------------------------------------------------ */

export function createDepartment(company, { id, name, accepts = [], capacity = 4, borrowPolicy = {}, charter, code, preset }) {
  const c = clone(company);
  if (findDepartment(c, id)) throw new OrgError(`部门 ${id} 已存在`);
  const usedCodes = new Set(c.departments.map((d) => d.code).filter(Boolean));
  const deptCode =
    code === undefined
      ? nextCodeFromSet(
          c.numbering?.department ?? DEFAULT_NUMBERING.department,
          usedCodes,
          "部门",
          {},
        )
      : normalizeCodeInput(code, "部门", usedCodes);
  c.departments.push({
    id,
    name,
    code: deptCode,
    accepts,
    capacity,
    borrowPolicy,
    charter,
  });
  if (preset === undefined || preset === null) return c;
  // 创建即套用（docs/24 §4）：默认 appliedBy=owner；非法/未知预设抛 E_UNKNOWN_PRESET/E_INVALID_PRESET。
  return applyPresetToDepartment(c, id, preset, { appliedBy: "owner" });
}

export function updateDepartment(company, id, patch) {
  const c = clone(company);
  const dept = findDepartment(c, id);
  if (!dept) throw new OrgError(`部门 ${id} 不存在`);
  const allowed = ["name", "accepts", "capacity", "borrowPolicy", "charter", "code"];
  for (const key of allowed) {
    if (patch[key] === undefined) continue;
    if (key === "code") {
      const usedCodes = new Set(c.departments.filter((d) => d.id !== id).map((d) => d.code).filter(Boolean));
      dept.code = normalizeCodeInput(patch[key], "部门", usedCodes);
    } else {
      dept[key] = patch[key];
    }
  }
  // preset 单独处理（docs/24 §4）：undefined 不动；null/"" 清除；其余值套用/切换。
  if (patch.preset !== undefined) {
    if (patch.preset === null || patch.preset === "") return clearPresetFromDepartment(c, id);
    return applyPresetToDepartment(c, id, patch.preset, {
      appliedAt: new Date().toISOString(),
      appliedBy: "owner",
    });
  }
  return c;
}

/* ------------------------------------------------------------------ */
/* 员工（docs/16 §1.3 / §1.4）                                          */
/* ------------------------------------------------------------------ */

export function createEmployee(
  company,
  { id, displayName, department, role, kind, sessionPolicy, state, skills, code, channel, level, channels, ...rest },
) {
  const c = clone(company);
  if (findEmployee(c, id)) throw new OrgError(`员工 ${id} 已存在`);

  const k = normalizeKind(kind);
  const r = normalizeRole(role);
  const sp = r === EMPLOYEE_ROLE.MANAGER ? SESSION_POLICY.RESIDENT : normalizeSessionPolicy(sessionPolicy);
  const st = normalizeState(state);

  if ((k === EMPLOYEE_KIND.PERMANENT || k === EMPLOYEE_KIND.TEMP) && !department) {
    throw new OrgError("permanent/temp 员工必须有所属部门");
  }

  if (r === EMPLOYEE_ROLE.MANAGER && !findDepartment(c, department)) {
    throw new OrgError(`manager 必须来自存在的部门: ${department}`);
  }

  // 通道（docs/21 §1.1）：显式 channels 优先；否则旧 channel/level；否则按岗位默认。
  const expectedChannel = channelForRole(r);
  const catalog = (c && c.levels) || DEFAULT_LEVELS;
  let channelList;
  if (Array.isArray(channels)) {
    if (channels.length === 0) throw orgError("至少保留一个通道", "E_LAST_CHANNEL");
    channelList = channels.map((item) => {
      if (!item || !CHANNELS.has(item.channel)) throw orgError(`非法 channel: ${item?.channel}`, "E_INVALID_CHANNEL");
      const resolved = resolveLevel(item.channel, item.level ?? defaultLevelFor(item.channel, r, catalog), catalog);
      return { channel: resolved.channel, level: resolved.code };
    });
    if (new Set(channelList.map((x) => x.channel)).size !== channelList.length) {
      throw orgError("通道重复", "E_CHANNEL_CONFLICT");
    }
  } else {
    const ch = channel === undefined || channel === null || channel === "" ? expectedChannel : channel;
    if (!CHANNELS.has(ch)) throw orgError(`非法 channel: ${ch}`, "E_INVALID_CHANNEL");
    if (ch !== expectedChannel) {
      throw orgError(`channel ${ch} 与岗位 ${r} 不一致（应 ${expectedChannel}）`, "E_CHANNEL_CONFLICT");
    }
    const resolved = resolveLevel(ch, level ?? defaultLevelFor(ch, r, catalog), catalog);
    channelList = [{ channel: resolved.channel, level: resolved.code }];
  }
  if (r === EMPLOYEE_ROLE.MANAGER && !channelList.some((x) => x.channel === LEVEL_CHANNEL.MANAGEMENT)) {
    throw orgError("manager 岗位必须含 M 通道", "E_CHANNEL_CONFLICT");
  }
  if (r === EMPLOYEE_ROLE.WINDOW && channelList.some((x) => x.channel === LEVEL_CHANNEL.MANAGEMENT)) {
    throw orgError("window 岗位不能拥有 M 通道", "E_CHANNEL_CONFLICT");
  }
  const sortedChannels = sortChannels(channelList);
  const primaryChannel = primaryChannelOf(sortedChannels);
  const primaryLevel = sortedChannels.find((x) => x.channel === primaryChannel).level;

  // 编号：缺省自动生成；显式全公司唯一。
  const deptRow = findDepartment(c, department);
  const usedCodes = new Set(c.employees.map((e) => e.code).filter(Boolean));
  const empCode =
    code === undefined
      ? nextCodeFromSet(c.numbering?.employee ?? DEFAULT_NUMBERING.employee, usedCodes, "员工", {
          dept: typeof deptRow?.code === "string" ? deptRow.code : "",
          channel: primaryChannel,
          level: primaryLevel,
        })
      : normalizeCodeInput(code, "员工", usedCodes);

  const record = {
    id,
    displayName: displayName || id,
    kind: k,
    role: r,
    sessionPolicy: sp,
    state: st,
    department: department ?? null,
    skills: Array.isArray(skills) ? skills : [],
    lastUsed: 0,
    code: empCode,
    channel: primaryChannel,
    level: primaryLevel,
    channels: sortedChannels.map((x) => ({ ...x })),
    title: typeof rest.title === "string" ? rest.title.trim() : "",
    duties: normalizeDuties(rest.duties),
    model: typeof rest.model === "string" ? rest.model.trim() : "",
    provider: typeof rest.provider === "string" ? rest.provider.trim() : "",
  };
  // v0.3.2：显式名册 target（缺省不写，员工 id 即隐式 target）
  const rosterTarget = typeof rest.rosterTarget === "string" ? rest.rosterTarget.trim() : "";
  if (rosterTarget) record.rosterTarget = rosterTarget;

  // v0.4：向 agent-teams 对齐的运行时属性（都存在才写，保持旧数据形状不变）
  if (typeof rest.reasoningEffort === "string" && rest.reasoningEffort) record.reasoningEffort = rest.reasoningEffort;
  if (rest.memberProvider === "spawn" || rest.memberProvider === "fork") record.memberProvider = rest.memberProvider;
  if (rest.maxDepth !== undefined) record.maxDepth = Math.max(0, Math.floor(Number(rest.maxDepth) || 0));
  if (rest.toolPolicy && typeof rest.toolPolicy === "object") {
    record.toolPolicy = {
      allow: Array.isArray(rest.toolPolicy.allow) ? rest.toolPolicy.allow.map(String) : [],
      deny: Array.isArray(rest.toolPolicy.deny) ? rest.toolPolicy.deny.map(String) : [],
    };
  }
  // 临时工：按次/按到期时间自动退场
  if (k === EMPLOYEE_KIND.TEMP) {
    record.tempHiredAt = typeof rest.tempHiredAt === "string" ? rest.tempHiredAt : new Date().toISOString();
    record.tempMaxTasks = Math.max(0, Math.floor(Number(rest.tempMaxTasks) || 0));
    record.tempCompleted = 0;
    if (typeof rest.tempExpiresAt === "string" && rest.tempExpiresAt) record.tempExpiresAt = rest.tempExpiresAt;
  }
  c.employees.push(record);
  return c;
}

const EMPLOYEE_PATCH_FIELDS = [
  "displayName",
  "state",
  "skills",
  "lastUsed",
  "sessionPolicy",
  "title",
  "model",
  "provider",
  "reasoningEffort",
  "memberProvider",
  "maxDepth",
  "toolPolicy",
  "currentOrderId",
  "currentAttemptId",
  "lastActiveAt",
  "tempMaxTasks",
  "tempCompleted",
  "tempExpiresAt",
  "notes",
];

export function updateEmployee(company, id, patch) {
  const c = clone(company);
  const emp = findEmployee(c, id);
  if (!emp) throw new OrgError(`员工 ${id} 不存在`);
  const allowed = EMPLOYEE_PATCH_FIELDS;
  for (const key of allowed) {
    if (patch[key] !== undefined) emp[key] = patch[key];
  }
  if (patch.duties !== undefined) emp.duties = normalizeDuties(patch.duties);
  // v0.3.2：显式名册 target；空串表示清除（回到「员工 id 即 target」的隐式约定）
  if (patch.rosterTarget !== undefined) {
    const value = typeof patch.rosterTarget === "string" ? patch.rosterTarget.trim() : "";
    if (value) {
      if (!isValidMemberName(value)) {
        throw new OrgError(`名册成员名不合法：${value}（小写字母/数字/连字符，1-64 位）`);
      }
      emp.rosterTarget = value;
    } else {
      delete emp.rosterTarget;
    }
  }
  return c;
}

export function fireEmployee(company, id) {
  const c = clone(company);
  const emp = findEmployee(c, id);
  if (!emp) throw new OrgError(`员工 ${id} 不存在`);
  emp.state = EMPLOYEE_STATE.FIRED;
  return c;
}

/**
 * 晋升/转通道（docs/16 §1.4）。返回 { company, from: {channel,level}, to: {channel,level} }。
 * - 无参：同通道 +1；最高级抛 OrgError(E_MAX_LEVEL)。
 * - {level} 同通道：目标下标必须 ±1（逐级），禁止跳级（E_LEVEL_STEP）。
 * - {channel} 跨通道：必须显式给 level（E_CROSS_CHANNEL），角色随通道（M→manager，P→staff）；
 *   转 M 要求已有部门（E_DEPT_REQUIRED）；window 不能转 M（E_WINDOW_TO_M）。
 */
export function promoteEmployee(company, employeeId, patch = {}, { levels = DEFAULT_LEVELS } = {}) {
  const c = clone(company);
  const emp = findEmployee(c, employeeId);
  if (!emp) throw new OrgError(`员工 ${employeeId} 不存在`);

  const described = describeEmployeeChannels(emp, levels);
  const current = described.find((x) => x.primary) ?? described[0];
  const from = { channel: current.channel, level: current.level };
  let next = described.map(({ channel, level }) => ({ channel, level }));

  const trackOf = (channel) => {
    const track = levels?.[channel]?.levels;
    if (!Array.isArray(track) || track.length === 0) throw orgError(`通道 ${channel} 缺少等级目录`, "E_INVALID_CHANNEL");
    return track;
  };
  const indexOfLevel = (channel, lv) => {
    const track = trackOf(channel);
    const ix = track.findIndex((l) => l?.code === lv);
    if (ix < 0) throw orgError(`非法等级 ${lv}（通道 ${channel}）`, "E_INVALID_LEVEL");
    return ix;
  };

  const hasChannel = patch.channel !== undefined && patch.channel !== null && patch.channel !== "";
  const hasLevel = patch.level !== undefined && patch.level !== null && patch.level !== "";

  if (patch.addChannel && typeof patch.addChannel === "object") {
    const ch = patch.addChannel.channel;
    if (!CHANNELS.has(ch)) throw orgError(`非法 channel: ${ch}`, "E_INVALID_CHANNEL");
    if (next.some((x) => x.channel === ch)) throw orgError(`通道已存在: ${ch}`, "E_CHANNEL_CONFLICT");
    if (emp.role === EMPLOYEE_ROLE.WINDOW && ch === LEVEL_CHANNEL.MANAGEMENT) {
      throw orgError("window 岗位不能加 M 通道", "E_CHANNEL_CONFLICT");
    }
    const resolved = resolveLevel(ch, patch.addChannel.level ?? defaultLevelFor(ch, emp.role), levels);
    next.push({ channel: resolved.channel, level: resolved.code });
  } else if (patch.removeChannel !== undefined && patch.removeChannel !== null && patch.removeChannel !== "") {
    const ch = patch.removeChannel;
    if (!CHANNELS.has(ch)) throw orgError(`非法 channel: ${ch}`, "E_INVALID_CHANNEL");
    if (!next.some((x) => x.channel === ch)) throw orgError(`通道不存在: ${ch}`, "E_INVALID_CHANNEL");
    if (emp.role === EMPLOYEE_ROLE.MANAGER && ch === LEVEL_CHANNEL.MANAGEMENT) {
      throw orgError("manager 不可移除 M 通道", "E_CHANNEL_CONFLICT");
    }
    if (next.length <= 1) throw orgError("至少保留一个通道", "E_LAST_CHANNEL");
    next = next.filter((x) => x.channel !== ch);
  } else {
    const targetChannel = hasChannel ? patch.channel : from.channel;
    if (!CHANNELS.has(targetChannel)) throw orgError(`非法 channel: ${targetChannel}`, "E_INVALID_CHANNEL");
    const existing = next.find((x) => x.channel === targetChannel);
    if (!existing) {
      // 旧语义：跨通道转岗（单通道员工），必须显式 level，role 跟随。
      if (!hasLevel) throw orgError("跨通道转岗必须显式给出 level", "E_CROSS_CHANNEL");
      if (emp.role === EMPLOYEE_ROLE.WINDOW && targetChannel === LEVEL_CHANNEL.MANAGEMENT) {
        throw orgError("window 岗位不能转 M 管理通道", "E_WINDOW_TO_M");
      }
      if (targetChannel === LEVEL_CHANNEL.MANAGEMENT && !emp.department) {
        throw orgError("转 M 管理通道必须已有部门", "E_DEPT_REQUIRED");
      }
      const resolved = resolveLevel(targetChannel, patch.level, levels);
      next = [{ channel: resolved.channel, level: resolved.code }];
      emp.role = resolved.channel === LEVEL_CHANNEL.MANAGEMENT ? EMPLOYEE_ROLE.MANAGER : EMPLOYEE_ROLE.STAFF;
    } else {
      const track = trackOf(targetChannel);
      const cur = indexOfLevel(targetChannel, existing.level);
      let targetLevel;
      if (!hasLevel) {
        if (cur + 1 >= track.length) throw orgError(`员工 ${employeeId} 在通道 ${targetChannel} 已是最高等级 ${existing.level}`, "E_MAX_LEVEL");
        targetLevel = track[cur + 1].code;
      } else {
        const nextIx = indexOfLevel(targetChannel, patch.level);
        if (nextIx === cur) throw orgError("目标等级与当前等级相同", "E_LEVEL_STEP");
        if (Math.abs(nextIx - cur) !== 1) throw orgError(`等级必须逐级晋升/降级（±1），当前 ${existing.level} 目标 ${patch.level}`, "E_LEVEL_STEP");
        targetLevel = track[nextIx].code;
      }
      next = next.map((x) => (x.channel === targetChannel ? { channel: targetChannel, level: targetLevel } : x));
    }
  }

  if (emp.role === EMPLOYEE_ROLE.MANAGER && !next.some((x) => x.channel === LEVEL_CHANNEL.MANAGEMENT)) {
    throw orgError("manager 岗位必须保留 M 通道", "E_CHANNEL_CONFLICT");
  }
  if (emp.role === EMPLOYEE_ROLE.WINDOW && next.some((x) => x.channel === LEVEL_CHANNEL.MANAGEMENT)) {
    throw orgError("window 岗位不能拥有 M 通道", "E_CHANNEL_CONFLICT");
  }
  if (next.length === 0) throw orgError("至少保留一个通道", "E_LAST_CHANNEL");

  const sorted = sortChannels(next);
  emp.channels = sorted;
  emp.channel = primaryChannelOf(sorted);
  emp.level = sorted.find((x) => x.channel === emp.channel).level;
  return { company: c, from, to: { channel: emp.channel, level: emp.level } };
}
