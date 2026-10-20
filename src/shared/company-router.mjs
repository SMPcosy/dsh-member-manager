/**
 * company-router.mjs
 * 路由规则 + 选人策略纯函数（零 DSH 依赖）。
 * 负责人：plugin-arch；本实现为最小化 stub 以满足既有测试并支持 P2 运行时联调。
 */

export class RouterError extends Error {
  constructor(message) {
    super(message);
    this.name = "RouterError";
  }
}

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

export function selectEmployee({ company, deptId, order, attempts = [], includeShared = false }) {
  const candidates = (company?.employees || []).filter((e) => {
    if (e.state === "working" || e.state === "cold" || e.state === "fired") return false;
    if (e.department === deptId) return true;
    if (includeShared && e.kind === "shared" && e.department === null) return true;
    return false;
  });

  if (candidates.length === 0) return null;

  // 技能匹配优先；负载最低次之；最近使用时间最旧再次之
  const skillSet = new Set(order?.skills || []);
  const scored = candidates.map((e) => {
    const skillMatch = e.skills ? e.skills.filter((s) => skillSet.has(s)).length : 0;
    const load = (attempts || []).filter((a) => a.employee === e.id && !a.endedAt).length;
    return { e, skillMatch, load, lastUsed: e.lastUsed || 0 };
  });

  scored.sort((a, b) => {
    if (b.skillMatch !== a.skillMatch) return b.skillMatch - a.skillMatch;
    if (a.load !== b.load) return a.load - b.load;
    return a.lastUsed - b.lastUsed;
  });

  return scored[0].e;
}
