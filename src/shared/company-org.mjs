/**
 * company-org.mjs
 * 组织架构纯函数数据模型（零 DSH 依赖）。
 * 负责人：plugin-arch；本实现为最小化 stub 以满足既有测试并支持 P2 运行时联调。
 * 0.3.0 增量（task-7）：M/P 双通道等级 + 员工/部门编号体系（docs/16-MP双通道等级与编号契约.md §1）。
 */

export const COMPANY_VERSION = 1;

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
});

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
    label: "专业技术通道",
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
        code: emp.code,
      };
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

  return { company, warnings };
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
function migrateIdentity(source, target, warnings) {
  const role = target.role;
  const expected = channelForRole(role) ?? LEVEL_CHANNEL.PROFESSIONAL;
  let channel = target.channel;
  if (channel !== undefined && !CHANNELS.has(channel)) {
    if (channel !== null && channel !== "") warnings.push(`员工 ${target.id} channel 非法（${source.channel}），按岗位推导为 ${expected}`);
    channel = expected;
  }
  if (channel === undefined || channel === null || channel === "") channel = expected;
  if (channel !== expected && target.channel !== undefined) {
    warnings.push(`员工 ${target.id} channel ${channel} 与岗位 ${role} 不一致，按岗位归正为 ${expected}`);
    channel = expected;
  }
  target.channel = channel;
  const track = DEFAULT_LEVELS[channel];
  const levelValid = target.level !== undefined && Array.isArray(track?.levels) && track.levels.some((l) => l?.code === target.level);
  if (!levelValid) {
    if (target.level !== undefined && target.level !== null && target.level !== "") {
      warnings.push(`员工 ${target.id} level 非法（${source.level}），回退默认 ${DEFAULT_EMPLOYEE_LEVEL[role]}`);
    }
    target.level = DEFAULT_EMPLOYEE_LEVEL[role] ?? DEFAULT_EMPLOYEE_LEVEL.staff;
  }
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

export function createDepartment(company, { id, name, accepts = [], capacity = 4, borrowPolicy = {}, charter, code }) {
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
  return c;
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
  return c;
}

/* ------------------------------------------------------------------ */
/* 员工（docs/16 §1.3 / §1.4）                                          */
/* ------------------------------------------------------------------ */

export function createEmployee(
  company,
  { id, displayName, department, role, kind, sessionPolicy, state, skills, code, channel, level, ...rest },
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

  // 通道：缺省按岗位推导；显式必须合法且与岗位一致（docs/16 §1.3 一致性硬校验）。
  const expectedChannel = channelForRole(r);
  let ch = channel === undefined || channel === null || channel === "" ? expectedChannel : channel;
  if (!CHANNELS.has(ch)) throw orgError(`非法 channel: ${ch}`, "E_INVALID_CHANNEL");
  if (ch !== expectedChannel) {
    throw orgError(`channel ${ch} 与岗位 ${r} 不一致（应 ${expectedChannel}）`, "E_CHANNEL_CONFLICT");
  }

  // 等级：缺省用 DEFAULT_EMPLOYEE_LEVEL[role]；显式必须属于该通道目录。
  const lv = level ?? DEFAULT_EMPLOYEE_LEVEL[r];
  const resolved = resolveLevel(ch, lv); // 非法 → OrgError(E_INVALID_LEVEL / E_INVALID_CHANNEL)

  // 编号：缺省自动生成；显式全公司唯一。
  const deptRow = findDepartment(c, department);
  const usedCodes = new Set(c.employees.map((e) => e.code).filter(Boolean));
  const empCode =
    code === undefined
      ? nextCodeFromSet(c.numbering?.employee ?? DEFAULT_NUMBERING.employee, usedCodes, "员工", {
          dept: typeof deptRow?.code === "string" ? deptRow.code : "",
          channel: ch,
          level: resolved.code,
        })
      : normalizeCodeInput(code, "员工", usedCodes);

  c.employees.push({
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
    channel: ch,
    level: resolved.code,
    ...rest,
  });
  return c;
}

export function updateEmployee(company, id, patch) {
  const c = clone(company);
  const emp = findEmployee(c, id);
  if (!emp) throw new OrgError(`员工 ${id} 不存在`);
  const allowed = ["displayName", "state", "skills", "lastUsed", "sessionPolicy"];
  for (const key of allowed) {
    if (patch[key] !== undefined) emp[key] = patch[key];
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

  const from = describeEmployeeLevel(emp, levels);
  const hasChannel = patch.channel !== undefined && patch.channel !== null && patch.channel !== "";
  const hasLevel = patch.level !== undefined && patch.level !== null && patch.level !== "";

  let targetChannel = from.channel;
  let targetLevel;
  if (hasChannel) {
    if (!CHANNELS.has(patch.channel)) throw orgError(`非法 channel: ${patch.channel}`, "E_INVALID_CHANNEL");
    targetChannel = patch.channel;
    if (patch.channel !== from.channel && !hasLevel) {
      throw orgError("跨通道转岗必须显式给出 level", "E_CROSS_CHANNEL");
    }
    targetLevel = hasLevel ? patch.level : undefined;
  } else if (hasLevel) {
    const prefix = String(patch.level).charAt(0).toUpperCase();
    if (CHANNELS.has(prefix) && prefix !== from.channel) {
      throw orgError("跨通道转岗必须显式给出 channel", "E_CROSS_CHANNEL");
    }
    targetLevel = patch.level;
  }

  const track = levels?.[targetChannel]?.levels;
  if (!Array.isArray(track) || track.length === 0) throw orgError(`通道 ${targetChannel} 缺少等级目录`, "E_INVALID_CHANNEL");
  const indexOf = (lv) => {
    const ix = track.findIndex((l) => l?.code === lv);
    if (ix < 0) throw orgError(`非法等级 ${lv}（通道 ${targetChannel}）`, "E_INVALID_LEVEL");
    return ix;
  };

  if (targetLevel === undefined) {
    // 无参（或同通道未给 level）：同通道 +1。
    const cur = indexOf(from.level);
    if (cur + 1 >= track.length) throw orgError(`员工 ${employeeId} 已是最高等级 ${from.level}`, "E_MAX_LEVEL");
    targetLevel = track[cur + 1].code;
  } else if (targetChannel === from.channel) {
    const cur = indexOf(from.level);
    const next = indexOf(targetLevel);
    if (next === cur) throw orgError("目标等级与当前等级相同", "E_LEVEL_STEP");
    if (Math.abs(next - cur) !== 1) throw orgError(`等级必须逐级晋升/降级（±1），当前 ${from.level} 目标 ${targetLevel}`, "E_LEVEL_STEP");
  } else {
    indexOf(targetLevel); // 跨通道：目标通道任意合法等级。
  }

  if (targetChannel !== from.channel) {
    if (emp.role === EMPLOYEE_ROLE.WINDOW && targetChannel === LEVEL_CHANNEL.MANAGEMENT) {
      throw orgError("window 岗位不能转 M 管理通道", "E_WINDOW_TO_M");
    }
    if (targetChannel === LEVEL_CHANNEL.MANAGEMENT && !emp.department) {
      throw orgError("转 M 管理通道必须已有部门", "E_DEPT_REQUIRED");
    }
  }

  emp.channel = targetChannel;
  emp.level = targetLevel;
  if (targetChannel !== from.channel) {
    emp.role = targetChannel === LEVEL_CHANNEL.MANAGEMENT ? EMPLOYEE_ROLE.MANAGER : EMPLOYEE_ROLE.STAFF;
  }

  return { company: c, from: { channel: from.channel, level: from.level }, to: { channel: targetChannel, level: targetLevel } };
}