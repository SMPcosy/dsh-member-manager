/**
 * company-org.mjs
 * 组织架构纯函数数据模型（零 DSH 依赖）。
 * 负责人：plugin-arch；本实现为最小化 stub 以满足既有测试并支持 P2 运行时联调。
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

const KINDS = new Set(Object.values(EMPLOYEE_KIND));
const ROLES = new Set(Object.values(EMPLOYEE_ROLE));
const STATES = new Set(Object.values(EMPLOYEE_STATE));
const SESSION_POLICIES = new Set(Object.values(SESSION_POLICY));

export class OrgError extends Error {
  constructor(message) {
    super(message);
    this.name = "OrgError";
  }
}

export function emptyCompany(now = new Date().toISOString()) {
  return {
    version: COMPANY_VERSION,
    status: "running",
    startedAt: now,
    departments: [],
    employees: [],
    limits: {},
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

  if (!Array.isArray(raw?.employees)) {
    warnings.push("employees 不是数组，已重置为空。");
  }

  for (const emp of Array.isArray(raw?.employees) ? raw.employees : []) {
    try {
      company.employees.push({
        id: String(emp.id),
        displayName: emp.displayName || String(emp.id),
        kind: normalizeKind(emp.kind),
        role: normalizeRole(emp.role),
        sessionPolicy: normalizeSessionPolicy(emp.sessionPolicy),
        state: normalizeState(emp.state),
        department: emp.department ?? null,
        skills: Array.isArray(emp.skills) ? emp.skills : [],
        lastUsed: emp.lastUsed ?? 0,
      });
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
  return JSON.parse(JSON.stringify(c));
}

function findDepartment(c, id) {
  return c.departments.find((d) => d.id === id);
}

function findEmployee(c, id) {
  return c.employees.find((e) => e.id === id);
}

export function createDepartment(company, { id, name, accepts = [], capacity = 4, borrowPolicy = {}, charter }) {
  const c = clone(company);
  if (findDepartment(c, id)) throw new OrgError(`部门 ${id} 已存在`);
  c.departments.push({
    id,
    name,
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
  const allowed = ["name", "accepts", "capacity", "borrowPolicy", "charter"];
  for (const key of allowed) {
    if (patch[key] !== undefined) dept[key] = patch[key];
  }
  return c;
}

export function createEmployee(company, { id, displayName, department, role, kind, sessionPolicy, state, skills, ...rest }) {
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
