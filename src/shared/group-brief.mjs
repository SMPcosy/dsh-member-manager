/**
 * group-brief.mjs
 *
 * 把一句中文自然语言解析成「小组 + 成员」结构。
 * 纯函数，不写盘、不联网。
 */

import {
  DISPLAY_NAME_MAX,
  RESERVED_TARGETS,
  TARGET_MAX,
  TARGET_RE,
} from "./registry-core.mjs";

const DESCRIPTION_MAX = 500;
const DUTY_MAX = 200;
const MEMBER_MAX = 12;
const DUTIES_MAX = 8;
const SKILLS_MAX = 12;

const MODEL_TOKENS = [
  "v4",
  "flash",
  "pro",
  "kimi",
  "qwen",
  "seed",
  "glm",
  "deepseek",
];

/** 中文岗位/关键词 → ASCII target 映射 */
const ROLE_KEYWORDS = [
  ["审阅", "reviewer"],
  ["复核", "verifier"],
  ["验证", "prober"],
  ["测试", "tester"],
  ["架构", "architect"],
  ["实现", "builder"],
  ["编写", "builder"],
  ["开发", "developer"],
  ["资产", "curator"],
  ["文档", "writer"],
  ["协调", "coordinator"],
  ["设计", "designer"],
  ["分析", "analyst"],
  ["记录", "recorder"],
  ["质检", "qc"],
  ["运营", "ops"],
  ["负责人", "lead-role"],
];

/* ------------------------------------------------------------------ */
/* 小工具                                                            */
/* ------------------------------------------------------------------ */

function truncate(text, max) {
  if (typeof text !== "string") return "";
  return text.length > max ? text.slice(0, max) : text;
}

function normalizeTarget(input) {
  if (typeof input !== "string") return "";
  let s = input
    .toLowerCase()
    .replace(/[^a-z0-9\-_]+/g, "-")
    .replace(/[_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  return s;
}

function mapRoleText(roleText) {
  if (typeof roleText !== "string") return null;
  const t = roleText.trim();
  for (const [cn, en] of ROLE_KEYWORDS) {
    if (t.includes(cn)) return en;
  }
  return null;
}

function baseTargetFrom(roleText) {
  const mapped = mapRoleText(roleText);
  if (mapped) return mapped;
  const normalized = normalizeTarget(roleText);
  if (normalized && TARGET_RE.test(normalized)) return normalized;
  return "member";
}

export function suggestTarget(roleText, usedTargets = []) {
  const used = new Set(usedTargets.filter((t) => typeof t === "string"));
  let base = baseTargetFrom(roleText);

  if (!base || !TARGET_RE.test(base) || base.length > TARGET_MAX) {
    base = "member";
  }

  if (RESERVED_TARGETS.includes(base)) {
    base = `${base}-role`;
  }

  if (base.length > TARGET_MAX) {
    base = base.slice(0, TARGET_MAX).replace(/-+$/, "");
  }

  let candidate = base;
  if (!used.has(candidate)) return candidate;

  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/* ------------------------------------------------------------------ */
/* 组名提取                                                          */
/* ------------------------------------------------------------------ */

function extractGroupName(text) {
  if (!text) return null;

  // 1. 引号/书名号包裹，如「质检组」、"质检组"、《质检组》
  const m1 = text.match(/[「《"'‘]\s*([^「》"'’]+?)\s*[」》"'’]/u);
  if (m1 && m1[1] && m1[1].trim()) return m1[1].trim();

  // 2. 引导词 + 名称，如 "创建一个叫质检组的小组"、"新建小组：质检组"
  const m2 = text.match(/(?:叫|名为|叫做)\s*(\S+?)\s*的?(?:小组|组|团队)/u);
  if (m2 && m2[1] && m2[1].trim()) {
    const name = m2[1].trim();
    if (!/^(创建|新建|成立|一个|一支|一组)$/u.test(name)) return name;
  }

  const m3 = text.match(/(?:新建|创建|成立)(?:一个|一支|一组)?(?:小组|组|团队)\s*[：:]\s*(\S+?)(?=[\s：:，,；;]|$)/u);
  if (m3 && m3[1] && m3[1].trim()) return m3[1].trim();

  // 3. 兜底：成员列表分隔符之前的部分作为组名
  const sepIndex = text.search(/[：:](?!\/)/u);
  if (sepIndex > 0) {
    let name = text.slice(0, sepIndex).trim();
    name = name.replace(/^(?:创建|新建|成立|一个叫|名为|叫做)\s*/u, "").trim();
    name = name.replace(/(?:一个|一支|一组)?(?:小组|组|团队)\s*$/u, "").trim();
    if (name && !/^(成员|包含|成员包括)$/u.test(name)) return name;
  }

  // 4. 最后尝试末尾的「小组/组/团队」之前的词
  const m4 = text.match(/(\S+?)(?:小组|组|团队)/u);
  if (m4 && m4[1].trim()) {
    const name = m4[1].trim();
    if (!/^(创建|一个|新建|成立|叫|名为|叫做)/u.test(name)) return name;
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* 成员列表切分                                                       */
/* ------------------------------------------------------------------ */

function isModelClause(entry) {
  return /模型|[\s:：]用\s+|使用/.test(entry) && /[a-zA-Z0-9\-\.:]+/.test(entry);
}

function isSkillClause(entry) {
  return /技能/.test(entry);
}

function splitMembers(text) {
  if (!text) return [];

  // 去掉成员引导词
  let body = text.replace(/^(?:成员|包含|成员包括)\s*[：:]?/u, "").trim();

  // 去掉数量前缀，如「3 个成员」
  body = body.replace(/^[\d\s]+个\s*(?:成员|人)?/u, "").trim();

  // 去掉前导冒号
  body = body.replace(/^[：:]+/, "").trim();

  // 按分隔符切分（保留括号内容不拆分）
  const parts = [];
  let current = "";
  let depth = 0;
  for (const ch of body) {
    if (ch === "（" || ch === "(") depth += 1;
    if (ch === "）" || ch === ")") depth -= 1;
    if (depth === 0 && "、，,；;以及/".includes(ch)) {
      if (current.trim()) parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());

  return parts.filter((p) => {
    if (!p) return false;
    if (isModelClause(p) || isSkillClause(p)) return false;
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* 单个成员条目解析                                                   */
/* ------------------------------------------------------------------ */

function parseDuties(str) {
  if (!str) return [];
  const raw = str
    .replace(/^(?:负责|主要|职责[是为]?[:：]?)/u, "")
    .split(/[,，、；;+]|以及|和/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out = [];
  for (const item of raw) {
    const clean = item.replace(/^(?:负责|主要|职责[是为]?[:：]?)/u, "").trim();
    if (clean && !out.includes(clean)) out.push(clean);
  }
  return out.slice(0, DUTIES_MAX);
}

function parseMemberEntry(entry) {
  // 取括号内职责
  const parenMatch = entry.match(/[（(]([^）)]+)[）)]/);
  let displayName = entry;
  let duties = [];
  if (parenMatch) {
    displayName = entry.replace(parenMatch[0], "").trim();
    duties = parseDuties(parenMatch[1]);
  }

  // 去掉「负责...」「主要职责...」等非显示名部分，但保留岗位关键词如「负责人」
  displayName = displayName.replace(/[（(][^）)]+[）)]/gu, "").trim();
  if (/(?:负责|主要|职责)[^,，、；;）)\s]{2,}$/u.test(displayName)) {
    displayName = displayName.replace(/(?:负责|主要|职责).*$/u, "").trim();
  }

  // 从显示名中提取「负责X」作为补充职责
  const dutyMatch = entry.match(/(?:负责|主要|职责)\s*([^，,；;、（）\(\)]+)/u);
  if (dutyMatch) {
    const extra = parseDuties(dutyMatch[1]);
    for (const d of extra) {
      if (!duties.includes(d)) duties.push(d);
    }
    duties = duties.slice(0, DUTIES_MAX);
  }

  return { displayName, duties };
}

function findTitle(displayName) {
  let lastPos = -1;
  let title = "";
  for (const [cn, _en] of ROLE_KEYWORDS) {
    const pos = displayName.lastIndexOf(cn);
    if (pos !== -1 && pos >= lastPos) {
      lastPos = pos;
      title = cn;
    }
  }
  return title || displayName;
}

/* ------------------------------------------------------------------ */
/* 模型 / 技能全局/点名解析                                            */
/* ------------------------------------------------------------------ */

function isModelIdAllowed(id) {
  const lower = String(id).toLowerCase();
  return MODEL_TOKENS.some((t) => lower.includes(t));
}

function findGlobalModel(text, excludeRanges = []) {
  let cleaned = text;
  for (const range of excludeRanges) {
    cleaned = cleaned.replace(range, "");
  }
  const patterns = [
    /模型\s*[是为]?\s*([a-zA-Z0-9\-\.:]+)/iu,
    /用\s*([a-zA-Z0-9\-\.:]+)\s*模型/iu,
    /都?使用\s*([a-zA-Z0-9\-\.:]+)/iu,
    /模型是\s*([a-zA-Z0-9\-\.:]+)/iu,
  ];
  for (const re of patterns) {
    const m = cleaned.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

function isMemberReference(key) {
  if (typeof key !== "string") return false;
  if (key.length === 0 || key.length > 40) return false;
  if (/[^a-zA-Z0-9\u4e00-\u9fa5\-]/.test(key)) return false;
  return true;
}

function findNamedAssignments(text, members) {
  const result = new Map();
  const ranges = [];
  const re = /([a-zA-Z0-9\u4e00-\u9fa5\-]+?)\s*(?:用|使用)\s*([a-zA-Z0-9\-\.:]+)/gu;
  let match;
  while ((match = re.exec(text)) !== null) {
    const key = match[1].trim();
    const value = match[2].trim();
    if (!isMemberReference(key)) continue;
    if (!isModelIdAllowed(value)) continue;
    for (const [i, member] of members.entries()) {
      if (
        member.target === key.toLowerCase() ||
        member.displayName.includes(key) ||
        key.includes(member.displayName)
      ) {
        result.set(i, value);
        ranges.push(match[0]);
        break;
      }
    }
  }
  return { result, ranges };
}

function findGlobalSkills(text, excludeRanges = []) {
  let cleaned = text;
  for (const range of excludeRanges) {
    cleaned = cleaned.replace(range, "");
  }
  const m = cleaned.match(/技能\s*[是为：:]?\s*([^。]+?)(?=(?:模型|成员|小组|$))/iu);
  if (!m) return [];
  return m[1]
    .split(/[,，、；;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function findNamedSkills(text, members) {
  const result = new Map();
  const ranges = [];
  const re = /([a-zA-Z0-9\u4e00-\u9fa5\-]+?)\s*技能\s*[是为：:]?\s*([^。,，、；;]+)/gu;
  let match;
  while ((match = re.exec(text)) !== null) {
    const key = match[1].trim();
    if (!isMemberReference(key)) continue;
    const skills = match[2]
      .split(/[,，、；;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const [i, member] of members.entries()) {
      if (
        member.target === key.toLowerCase() ||
        member.displayName.includes(key) ||
        key.includes(member.displayName)
      ) {
        result.set(i, skills);
        ranges.push(match[0]);
        break;
      }
    }
  }
  return { result, ranges };
}

/* ------------------------------------------------------------------ */
/* 主入口                                                            */
/* ------------------------------------------------------------------ */

export function parseGroupBrief(text, options = {}) {
  const maxMembers = Number.isFinite(options.maxMembers)
    ? Math.max(1, options.maxMembers)
    : MEMBER_MAX;

  const errors = [];
  const warnings = [];

  if (!text || typeof text !== "string" || !text.trim()) {
    errors.push("缺少组名");
    return { ok: false, errors, warnings, group: null, members: [] };
  }

  const groupName = extractGroupName(text);
  if (!groupName) {
    errors.push("缺少组名");
    return { ok: false, errors, warnings, group: null, members: [] };
  }

  const group = {
    name: truncate(groupName, DISPLAY_NAME_MAX),
    description: "",
  };

  // 剩余文本用于成员/模型/技能解析：从组名之后第一个分隔符开始
  let remaining = text;
  const postGroupIdx = remaining.indexOf(groupName) + groupName.length;
  const sepRe = /[：:]/gu;
  sepRe.lastIndex = postGroupIdx;
  const sepMatch = sepRe.exec(remaining);
  if (sepMatch) {
    remaining = remaining.slice(sepMatch.index + 1);
  }
  remaining = remaining.replace(/^(?:小组|组|团队)?\s*[，,；;]?\s*(?:成员|包含|成员包括)?\s*[：:]?/, "").trim();

  const rawEntries = splitMembers(remaining);
  const members = [];
  const usedTargets = [];

  for (const entry of rawEntries.slice(0, maxMembers)) {
    const { displayName: rawDisplayName, duties } = parseMemberEntry(entry);
    const displayName = truncate(rawDisplayName || "成员", DISPLAY_NAME_MAX);
    const title = findTitle(displayName);
    const target = suggestTarget(title, usedTargets);
    usedTargets.push(target);

    members.push({
      target,
      displayName,
      title,
      duties: duties.map((d) => truncate(d, DUTY_MAX)),
      skills: [],
    });
  }

  if (rawEntries.length > maxMembers) {
    warnings.push(`成员数量超过上限 ${maxMembers}，仅保留前 ${maxMembers} 个`);
  }

  // 模型
  const { result: namedModels, ranges: namedModelRanges } = findNamedAssignments(text, members);
  const globalModel = findGlobalModel(text, namedModelRanges);
  for (const [i, member] of members.entries()) {
    const model = namedModels.get(i) || globalModel;
    if (model) {
      if (isModelIdAllowed(model)) {
        member.model = model;
      } else {
        warnings.push(`忽略不支持的模型 ID：${model}`);
      }
    }
  }

  // 技能
  const { result: namedSkills, ranges: namedSkillRanges } = findNamedSkills(text, members);
  const globalSkills = findGlobalSkills(text, namedSkillRanges);
  for (const [i, member] of members.entries()) {
    const skills = namedSkills.get(i);
    if (skills && skills.length > 0) {
      member.skills = skills.slice(0, SKILLS_MAX).map((s) => s.trim());
    } else if (globalSkills.length > 0) {
      member.skills = globalSkills.slice(0, SKILLS_MAX).map((s) => s.trim());
    }
  }

  // 长度最终截断
  for (const member of members) {
    member.duties = member.duties.slice(0, DUTIES_MAX);
    member.skills = member.skills.slice(0, SKILLS_MAX);
  }

  return { ok: errors.length === 0, errors, warnings, group, members };
}

/* ------------------------------------------------------------------ */
/* 摘要生成                                                          */
/* ------------------------------------------------------------------ */

export function describeBrief(brief) {
  if (!brief || typeof brief !== "object") return "";
  const groupName = brief.group?.name || "未命名小组";
  const members = Array.isArray(brief.members) ? brief.members : [];
  const lines = [`小组「${groupName}」：共 ${members.length} 人`];
  for (const m of members) {
    const parts = [`${m.displayName || "成员"}(${m.target || "member"})`];
    if (m.title) parts.push(m.title);
    if (m.model) parts.push(`模型:${m.model}`);
    if (Array.isArray(m.duties) && m.duties.length > 0) {
      parts.push(`职责:${m.duties.join("、")}`);
    }
    if (Array.isArray(m.skills) && m.skills.length > 0) {
      parts.push(`技能:${m.skills.join("、")}`);
    }
    lines.push(`  ${parts.join(" ")}`);
  }
  return lines.join("\n");
}
