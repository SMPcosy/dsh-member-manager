/**
 * company-router.mjs
 * 路由规则 + 选人策略纯函数（零 DSH 依赖）。
 *
 * v0.4：路由不再只依赖显式 routingRules。
 * 以前的实现里 routingRules 为空 → routeTypeToDept 返回 null → dispatcher 直接
 * 返回 E_NO_DEPT，订单永远卡在 routed，也就表现为「工作网里下了任务但没人接」。
 * 现在改成五级回退（显式部门 → 规则表 → 部门 accepts → 技能覆盖 → 有产能兜底），
 * 每一级都记录命中原因，方便面板解释「为什么派给了谁」。
 */

export class RouterError extends Error {
  constructor(message) {
    super(message);
    this.name = "RouterError";
  }
}

/** 规则表命中（保持旧语义：未命中返回 null）。 */
export function routeTypeToDept(type, rules = [], company) {
  for (const rule of rules) {
    const t = typeof rule === "object" ? rule.type : rule;
    const d = typeof rule === "object" ? rule.dept : undefined;
    if (t && typeMatches(type, t)) return d;
  }
  return null;
}

function typeMatches(type, pattern) {
  if (typeof pattern === "string") return type === pattern;
  if (pattern instanceof RegExp) return pattern.test(type);
  if (pattern && typeof pattern.test === "function") return pattern.test(type);
  return false;
}

function norm(value) {
  return String(value ?? "").trim().toLowerCase();
}

function tokensOf(value) {
  return String(value ?? "")
    .toLowerCase()
    .split(/[\s,;，；、/|·]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 订单关键词：类型、项目、标签、技能、标题分词。 */
export function orderKeywords(order) {
  if (!order) return [];
  const out = new Set();
  for (const raw of [order.type, order.project, ...(order.tags || []), ...(order.skills || []), order.title]) {
    for (const t of tokensOf(raw)) out.add(t);
  }
  return [...out].filter((t) => t.length >= 1);
}

function looselyMatches(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // 中文场景下常出现「开发」vs「游戏开发」这类包含关系；英文用 3 字符以上才做包含，
  // 避免 "a" 命中一切。
  const minLen = /[\u4e00-\u9fa5]/.test(y) ? 1 : 3;
  if (y.length >= minLen && x.includes(y)) return true;
  if (x.length >= minLen && y.includes(x)) return true;
  return false;
}

function idleCountOf(deptId, employees) {
  return employees.filter(
    (e) => e.department === deptId && e.state !== "working" && e.state !== "cold" && e.state !== "fired" && e.state !== "retired",
  ).length;
}

function deptById(company, id) {
  return (company?.departments || []).find((d) => d.id === id) || null;
}

function pickBest(candidates, employees, reason, order) {
  if (!candidates.length) return null;
  const skills = new Set((order?.skills || []).map(norm));
  const scored = candidates.map((d) => {
    const members = employees.filter((e) => e.department === d.id && e.state !== "fired" && e.state !== "retired");
    const idle = idleCountOf(d.id, employees);
    const skillHits = members.filter((e) => (e.skills || []).some((s) => skills.has(norm(s)))).length;
    const capacity = Number(d.capacity) || 4;
    return { d, idle, skillHits, capacity, load: members.length - idle };
  });
  scored.sort((a, b) => {
    if (b.skillHits !== a.skillHits) return b.skillHits - a.skillHits;
    if (b.idle !== a.idle) return b.idle - a.idle;
    if (b.capacity !== a.capacity) return b.capacity - a.capacity;
    return String(a.d?.code || a.d?.id || "").localeCompare(String(b.d?.code || b.d?.id || ""), undefined, { numeric: true });
  });
  return { deptId: scored[0].d.id, reason, dept: scored[0].d, idle: scored[0].idle };
}

/**
 * 五级路由。返回 { deptId, reason, dept?, idle? }；全都落空时 deptId=null
 * 并给出 reason，供调度器/面板解释「为什么没派出去」。
 */
export function resolveDepartment({ order, rules = [], company } = {}) {
  const departments = company?.departments || [];
  const employees = company?.employees || [];
  if (!departments.length) return { deptId: null, reason: "no_department" };

  // 1) 订单显式指定部门
  const explicit = order?.dept ? deptById(company, order.dept) : null;
  if (explicit) return { deptId: explicit.id, reason: "explicit", dept: explicit, idle: idleCountOf(explicit.id, employees) };

  // 2) 规则表
  const ruleHit = routeTypeToDept(order?.type, rules, company);
  if (ruleHit && deptById(company, ruleHit)) {
    const dept = deptById(company, ruleHit);
    return { deptId: dept.id, reason: "rule", dept, idle: idleCountOf(dept.id, employees) };
  }

  const keywords = orderKeywords(order);

  // 3) 部门 accepts（D04 那种「开发/设计/测试/调研」就是靠这一级接住的）
  const acceptHits = departments.filter((d) => (d.accepts || []).some((a) => keywords.some((k) => looselyMatches(a, k))));
  const acceptBest = pickBest(acceptHits, employees, "accepts", order);
  if (acceptBest) return acceptBest;

  // 4) 技能覆盖：部门里有人的技能命中订单 needed skills
  const needed = (order?.skills || []).map(norm).filter(Boolean);
  if (needed.length) {
    const skillHits = departments.filter((d) =>
      employees.some((e) => e.department === d.id && (e.skills || []).some((s) => needed.includes(norm(s)))),
    );
    const skillBest = pickBest(skillHits, employees, "skills", order);
    if (skillBest) return skillBest;
  }

  // 5) 兜底：还有空闲人的部门里挑产能最大的
  const open = departments.filter((d) => idleCountOf(d.id, employees) > 0);
  const fallback = pickBest(open, employees, "fallback", order);
  if (fallback) return fallback;

  return { deptId: null, reason: "no_capacity" };
}

/**
 * 选人：同部门优先；deptId 为空或 crossDept=true 时全公司找。
 * 排序：技能命中 → 负载最低 → 最近使用时间最旧。
 */
export function selectEmployee({ company, deptId, order, attempts = [], includeShared = false, crossDept = false }) {
  const candidates = (company?.employees || []).filter((e) => {
    if (e.state === "working" || e.state === "cold" || e.state === "fired" || e.state === "retired") return false;
    // 不限部门：全公司找（调度器在第一轮路由失败时用它兜底）
    if (!deptId || crossDept) return true;
    if (e.department === deptId) return true;
    // 共享池/临时工池可以借调到任意部门
    if (includeShared && (e.kind === "shared" || e.kind === "temp")) return true;
    if (includeShared && e.department === null) return true;
    return false;
  });

  if (candidates.length === 0) return null;

  const skillSet = new Set((order?.skills || []).map(norm));
  const typeKey = norm(order?.type);
  const scored = candidates.map((e) => {
    const skills = (e.skills || []).map(norm);
    const skillMatch = skills.filter((s) => skillSet.has(s)).length;
    const typeMatch = typeKey && skills.some((s) => looselyMatches(s, typeKey)) ? 1 : 0;
    const load = (attempts || []).filter((a) => a.employee === e.id && !a.endedAt).length;
    return { e, skillMatch, typeMatch, load, lastUsed: e.lastUsed || 0 };
  });

  scored.sort((a, b) => {
    if (b.skillMatch !== a.skillMatch) return b.skillMatch - a.skillMatch;
    if (b.typeMatch !== a.typeMatch) return b.typeMatch - a.typeMatch;
    if (a.load !== b.load) return a.load - b.load;
    return a.lastUsed - b.lastUsed;
  });

  return scored[0].e;
}
