/**
 * dsh-plugin-member-manager · 名册层核心逻辑（纯函数，零 DSH 依赖）
 *
 * 设计要点（见 docs/00-需求与设计决策.md）：
 *  - DSH 核心的 target 是唯一键且只读；本模块只维护「覆盖层」字段。
 *  - 所有写操作返回新对象（不可变），便于测试与回滚。
 *  - 所有校验失败抛出 RegistryError，附带机器可读的 code。
 */

export const REGISTRY_VERSION = 1;

/** DSH 对成员名的格式硬约束（实测：spawn_teammate 会拒绝非法名） */
export const TARGET_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const TARGET_MAX = 64;
export const DISPLAY_NAME_MAX = 64;
/** DSH 的 Lead 伪成员名：不能用于 spawn_teammate，但**可以是名册成员** */
export const RESERVED_TARGETS = ["lead"];

export const STATUS_ACTIVE = "active";
export const STATUS_RETIRED = "retired";

export class RegistryError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = "RegistryError";
    this.code = code;
    this.detail = detail;
  }
}

/* ------------------------------------------------------------------ */
/* 基础构造与校验                                                      */
/* ------------------------------------------------------------------ */

export function emptyRegistry(now = new Date().toISOString()) {
  return { version: REGISTRY_VERSION, updatedAt: now, groups: [], members: [] };
}

/**
 * 名册能表示的成员名。
 *
 * 注意 `lead` 是**合法**的：DSH 的 Lead 就是一个真实团队成员（name 固定为 "lead"），
 * 组织架构里必须能出现它，`member_sync` 也必须能把它登记进来。
 * 禁止 "lead" 的只有 DSH 的 `spawn_teammate`（见 isSpawnableTarget）。
 */
export function isValidMemberName(target) {
  if (typeof target !== "string") return false;
  const t = target.trim();
  if (!t || t.length > TARGET_MAX) return false;
  return TARGET_RE.test(t);
}

/** DSH `spawn_teammate` 能创建的名字（不含 lead）。本插件目前不 spawn，保留以备将来集成。 */
export function isSpawnableTarget(target) {
  return isValidMemberName(target) && !RESERVED_TARGETS.includes(target.trim());
}

/** 兼容旧调用名：语义等同 isValidMemberName（**不再是** spawn 约束） */
export const isValidTarget = isValidMemberName;

function requireTarget(target) {
  if (!isValidMemberName(target)) {
    throw new RegistryError(
      "INVALID_TARGET",
      `成员名必须是小写 kebab-case（a-z0-9 与连字符）、≤${TARGET_MAX} 字符：${JSON.stringify(target)}`,
      { target },
    );
  }
  return target.trim();
}

function requireText(value, field, max = DISPLAY_NAME_MAX) {
  if (typeof value !== "string") {
    throw new RegistryError("INVALID_FIELD", `${field} 必须是字符串`, { field, value });
  }
  const v = value.trim();
  if (!v) throw new RegistryError("EMPTY_FIELD", `${field} 不能为空`, { field });
  if (v.length > max) {
    throw new RegistryError("FIELD_TOO_LONG", `${field} 不能超过 ${max} 字符（当前 ${v.length}）`, { field, length: v.length, max });
  }
  return v;
}

function requireStringList(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new RegistryError("INVALID_FIELD", `${field} 必须是字符串数组`, { field, value });
  }
  const out = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new RegistryError("INVALID_FIELD", `${field} 的元素必须是字符串`, { field, value: item });
    }
    const v = item.trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** 结构性校验：用于「读取已有数据文件」这种可能被手改坏场景，不做业务级抛错 */
export function validateRegistry(data) {
  const errors = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, errors: ["根节点必须是对象"] };
  }
  if (data.version !== REGISTRY_VERSION) {
    errors.push(`version 应为 ${REGISTRY_VERSION}，实际为 ${JSON.stringify(data.version)}`);
  }
  if (!Array.isArray(data.groups)) errors.push("groups 必须是数组");
  if (!Array.isArray(data.members)) errors.push("members 必须是数组");

  const groupIds = new Set();
  for (const [i, g] of (Array.isArray(data.groups) ? data.groups : []).entries()) {
    if (!g || typeof g !== "object") { errors.push(`groups[${i}] 必须是对象`); continue; }
    if (typeof g.id !== "string" || !g.id.trim()) errors.push(`groups[${i}].id 必须是非空字符串`);
    else if (groupIds.has(g.id)) errors.push(`groups[${i}].id 重复：${g.id}`);
    else groupIds.add(g.id);
    if (typeof g.name !== "string" || !g.name.trim()) errors.push(`groups[${i}].name 必须是非空字符串`);
  }

  const targets = new Set();
  for (const [i, m] of (Array.isArray(data.members) ? data.members : []).entries()) {
    if (!m || typeof m !== "object") { errors.push(`members[${i}] 必须是对象`); continue; }
    if (!isValidTarget(m.target)) errors.push(`members[${i}].target 非法：${JSON.stringify(m.target)}`);
    else if (targets.has(m.target)) errors.push(`members[${i}].target 重复：${m.target}`);
    else targets.add(m.target);
    if (m.groupId != null && !groupIds.has(m.groupId)) errors.push(`members[${i}].groupId 指向不存在的小组：${m.groupId}`);
    if (m.status !== undefined && ![STATUS_ACTIVE, STATUS_RETIRED].includes(m.status)) {
      errors.push(`members[${i}].status 非法：${JSON.stringify(m.status)}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** 宽松修复：补齐缺失字段，丢弃无法修复的成员条目（返回 {registry, warnings}） */
export function normalizeRegistry(data, now = new Date().toISOString()) {
  const warnings = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { registry: emptyRegistry(now), warnings: ["根节点损坏，已重置为空名册"] };
  }
  const groups = [];
  const seenGroupIds = new Set();
  for (const g of Array.isArray(data.groups) ? data.groups : []) {
    const id = typeof g?.id === "string" ? g.id.trim() : "";
    const name = typeof g?.name === "string" ? g.name.trim() : "";
    if (!id || !name || seenGroupIds.has(id)) {
      warnings.push(`丢弃无法修复的小组条目：${JSON.stringify(g)}`);
      continue;
    }
    seenGroupIds.add(id);
    groups.push({
      id,
      name,
      order: Number.isFinite(g.order) ? g.order : groups.length + 1,
      description: typeof g.description === "string" ? g.description : "",
      createdAt: typeof g.createdAt === "string" ? g.createdAt : now,
    });
  }
  const members = [];
  const seenTargets = new Set();
  for (const m of Array.isArray(data.members) ? data.members : []) {
    const target = typeof m?.target === "string" ? m.target.trim() : "";
    if (!isValidTarget(target) || seenTargets.has(target)) {
      warnings.push(`丢弃无法修复的成员条目：${JSON.stringify(m)}`);
      continue;
    }
    seenTargets.add(target);
    const groupId = m.groupId != null && seenGroupIds.has(m.groupId) ? m.groupId : null;
    if (m.groupId != null && groupId === null) warnings.push(`成员 ${target} 的 groupId 无效，已置空：${m.groupId}`);
    const normalized = {
      target,
      displayName: typeof m.displayName === "string" && m.displayName.trim() ? m.displayName.trim() : target,
      aliases: requireStringList(m.aliases, "aliases"),
      groupId,
      title: typeof m.title === "string" ? m.title.trim() : "",
      duties: requireStringList(m.duties, "duties"),
      skills: requireStringList(m.skills, "skills"),
      status: m.status === STATUS_RETIRED ? STATUS_RETIRED : STATUS_ACTIVE,
      retiredAt: typeof m.retiredAt === "string" ? m.retiredAt : null,
      note: typeof m.note === "string" ? m.note : "",
      createdAt: typeof m.createdAt === "string" ? m.createdAt : now,
      updatedAt: typeof m.updatedAt === "string" ? m.updatedAt : now,
    };
    applyModelFields(normalized, m); // 空的 model/provider 会被删键，不留 undefined
    members.push(normalized);
  }
  return { registry: { version: REGISTRY_VERSION, updatedAt: now, groups, members }, warnings };
}

/* ------------------------------------------------------------------ */
/* 内部工具                                                            */
/* ------------------------------------------------------------------ */

function clone(reg) {
  return {
    version: reg.version,
    updatedAt: reg.updatedAt,
    groups: reg.groups.map((g) => ({ ...g })),
    members: reg.members.map((m) => ({ ...m, aliases: [...m.aliases], duties: [...m.duties], skills: [...m.skills] })),
  };
}

function touch(reg, now) {
  reg.updatedAt = now;
  return reg;
}

function findIndex(reg, target) {
  const i = reg.members.findIndex((m) => m.target === target);
  if (i < 0) {
    throw new RegistryError("MEMBER_NOT_FOUND", `名册中没有成员：${target}`, { target });
  }
  return i;
}

/* ------------------------------------------------------------------ */
/* 成员操作                                                            */
/* ------------------------------------------------------------------ */

export function addMember(reg, input, now = new Date().toISOString()) {
  const target = requireTarget(input?.target);
  if (reg.members.some((m) => m.target === target)) {
    throw new RegistryError("MEMBER_EXISTS", `成员已登记：${target}`, { target });
  }
  const groupId = input.groupId ?? null;
  if (groupId !== null && !reg.groups.some((g) => g.id === groupId)) {
    throw new RegistryError("GROUP_NOT_FOUND", `小组不存在：${groupId}`, { groupId });
  }
  const next = clone(reg);
  const member = {
    target,
    displayName: input.displayName !== undefined ? requireText(input.displayName, "displayName") : target,
    aliases: requireStringList(input.aliases, "aliases"),
    groupId,
    title: input.title ? requireText(input.title, "title") : "",
    duties: requireStringList(input.duties, "duties"),
    skills: requireStringList(input.skills, "skills"),
    status: STATUS_ACTIVE,
    retiredAt: null,
    note: typeof input.note === "string" ? input.note : "",
    createdAt: now,
    updatedAt: now,
  };
  applyModelFields(member, input);
  next.members.push(member);
  return touch(next, now);
}

/**
 * 把可选的 model / provider 挂到成员上。
 * 值为空时**删除键**而不是留 undefined —— 工具输出要能无损 JSON 往返，
 * 带 undefined 值的键会在 JSON.stringify 时消失，导致往返不相等。
 */
function applyModelFields(member, input) {
  for (const key of ["model", "provider"]) {
    const raw = input?.[key];
    if (typeof raw === "string" && raw.trim()) member[key] = raw.trim();
    else delete member[key];
  }
  return member;
}

/** 设置/清除成员的模型覆盖（provider 可选）。空字符串表示清除覆盖。 */
export function setModel(reg, target, { model, provider } = {}, now = new Date().toISOString()) {
  const t = requireTarget(target);
  if (model === undefined && provider === undefined) {
    throw new RegistryError("NOTHING_TO_UPDATE", "setModel 至少需要 model 或 provider", { target: t });
  }
  const next = clone(reg);
  const m = next.members[findIndex(next, t)];
  const nextModel = model !== undefined ? model : m.model;
  // 没有 model 时不留 provider：孤立 provider 无意义，只会在界面上造成困惑
  // （覆盖是否生效只看 model，见宿主的 modelOverrideFor）
  applyModelFields(
    m,
    nextModel && String(nextModel).trim()
      ? { model: nextModel, provider: provider !== undefined ? provider : m.provider }
      : { model: "", provider: "" },
  );
  m.updatedAt = now;
  return touch(next, now);
}

/** 软删除（用户说的「删除成员」）；restore=true 时恢复 */
export function removeMember(reg, target, { restore = false } = {}, now = new Date().toISOString()) {
  const t = requireTarget(target);
  const next = clone(reg);
  const i = findIndex(next, t);
  const m = next.members[i];
  if (restore) {
    if (m.status === STATUS_ACTIVE) {
      throw new RegistryError("ALREADY_ACTIVE", `成员已是启用状态：${t}`, { target: t });
    }
    m.status = STATUS_ACTIVE;
    m.retiredAt = null;
  } else {
    if (m.status === STATUS_RETIRED) {
      throw new RegistryError("ALREADY_RETIRED", `成员已停用：${t}`, { target: t });
    }
    m.status = STATUS_RETIRED;
    m.retiredAt = now;
  }
  m.updatedAt = now;
  return touch(next, now);
}

export function renameMember(reg, target, { displayName, aliases } = {}, now = new Date().toISOString()) {
  const t = requireTarget(target);
  const next = clone(reg);
  const m = next.members[findIndex(next, t)];
  if (displayName !== undefined) m.displayName = requireText(displayName, "displayName");
  if (aliases !== undefined) m.aliases = requireStringList(aliases, "aliases");
  if (displayName === undefined && aliases === undefined) {
    throw new RegistryError("NOTHING_TO_UPDATE", "renameMember 至少需要 displayName 或 aliases", { target: t });
  }
  m.updatedAt = now;
  return touch(next, now);
}

export function setRole(reg, target, { title, duties } = {}, now = new Date().toISOString()) {
  const t = requireTarget(target);
  const next = clone(reg);
  const m = next.members[findIndex(next, t)];
  if (title !== undefined) m.title = title === "" ? "" : requireText(title, "title");
  if (duties !== undefined) m.duties = requireStringList(duties, "duties");
  m.updatedAt = now;
  return touch(next, now);
}

export function setSkills(reg, target, { skills, add = [], remove = [] } = {}, now = new Date().toISOString()) {
  const t = requireTarget(target);
  const addList = requireStringList(add, "add");
  const removeList = requireStringList(remove, "remove");
  // 整体覆盖与增量修改语义互斥：同时传入会让「到底以谁为准」变得不可预测，直接拒绝
  if (skills !== undefined && (addList.length > 0 || removeList.length > 0)) {
    throw new RegistryError(
      "AMBIGUOUS_SKILLS",
      "setSkills 的 skills（整体覆盖）与 add/remove（增量）不能同时使用，请二选一",
      { target: t },
    );
  }
  const next = clone(reg);
  const m = next.members[findIndex(next, t)];
  if (skills !== undefined) {
    m.skills = requireStringList(skills, "skills");
  } else {
    const set = new Set(m.skills);
    for (const s of addList) set.add(s);
    for (const s of removeList) set.delete(s);
    m.skills = [...set];
  }
  m.updatedAt = now;
  return touch(next, now);
}

export function assignGroup(reg, target, groupId, now = new Date().toISOString()) {
  const t = requireTarget(target);
  if (groupId !== null && !reg.groups.some((g) => g.id === groupId)) {
    throw new RegistryError("GROUP_NOT_FOUND", `小组不存在：${groupId}`, { groupId });
  }
  const next = clone(reg);
  const m = next.members[findIndex(next, t)];
  m.groupId = groupId;
  m.updatedAt = now;
  return touch(next, now);
}

/* ------------------------------------------------------------------ */
/* 小组操作                                                            */
/* ------------------------------------------------------------------ */

export function createGroup(reg, { id, name, order, description = "" }, now = new Date().toISOString()) {
  const gid = id ? requireText(id, "id") : `g-${reg.groups.length + 1}-${Date.now().toString(36)}`;
  if (reg.groups.some((g) => g.id === gid)) {
    throw new RegistryError("GROUP_EXISTS", `小组已存在：${gid}`, { groupId: gid });
  }
  const next = clone(reg);
  next.groups.push({
    id: gid,
    name: requireText(name, "name"),
    order: Number.isFinite(order) ? order : next.groups.length + 1,
    description,
    createdAt: now,
  });
  return touch(next, now);
}

export function renameGroup(reg, groupId, { name, order, description } = {}, now = new Date().toISOString()) {
  const next = clone(reg);
  const g = next.groups.find((x) => x.id === groupId);
  if (!g) throw new RegistryError("GROUP_NOT_FOUND", `小组不存在：${groupId}`, { groupId });
  if (name !== undefined) g.name = requireText(name, "name");
  if (order !== undefined) {
    if (!Number.isFinite(order)) throw new RegistryError("INVALID_FIELD", "order 必须是数字", { order });
    g.order = order;
  }
  if (description !== undefined) g.description = String(description);
  return touch(next, now);
}

/** 删除小组：默认把组内成员置为未分组（不静默删人） */
export function deleteGroup(reg, groupId, { unassignMembers = true } = {}, now = new Date().toISOString()) {
  const next = clone(reg);
  const i = next.groups.findIndex((x) => x.id === groupId);
  if (i < 0) throw new RegistryError("GROUP_NOT_FOUND", `小组不存在：${groupId}`, { groupId });
  const affected = next.members.filter((m) => m.groupId === groupId);
  if (affected.length > 0 && !unassignMembers) {
    throw new RegistryError("GROUP_NOT_EMPTY", `小组内还有 ${affected.length} 名成员，请先移出或允许自动置为未分组`, {
      groupId,
      memberCount: affected.length,
    });
  }
  next.groups.splice(i, 1);
  for (const m of affected) {
    m.groupId = null;
    m.updatedAt = now;
  }
  return touch(next, now);
}

/* ------------------------------------------------------------------ */
/* 视图：组织架构树                                                    */
/* ------------------------------------------------------------------ */

/**
 * 构建两级组织架构视图。
 * @param {object} reg 名册
 * @param {string[]} [liveTargets] DSH 核心当前真实的成员 target 列表（用于标记孤儿/未登记）
 */
export function buildTree(reg, liveTargets) {
  const live = liveTargets ? new Set(liveTargets) : null;
  const view = (m) => ({
    ...m,
    orphan: live ? !live.has(m.target) : false,
    isRetired: m.status === STATUS_RETIRED,
  });
  const byName = (a, b) => a.displayName.localeCompare(b.displayName, "zh-Hans-CN");

  const groups = [...reg.groups]
    .sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name, "zh-Hans-CN"))
    .map((g) => ({
      ...g,
      members: reg.members.filter((m) => m.groupId === g.id).map(view).sort(byName),
    }));

  const ungrouped = reg.members.filter((m) => m.groupId === null || !reg.groups.some((g) => g.id === m.groupId));
  const unregistered = live ? [...live].filter((t) => !reg.members.some((m) => m.target === t)) : [];

  return {
    groups,
    ungrouped: ungrouped.map(view).sort(byName),
    unregistered: unregistered.sort(),
    stats: {
      groups: reg.groups.length,
      members: reg.members.length,
      active: reg.members.filter((m) => m.status === STATUS_ACTIVE).length,
      retired: reg.members.filter((m) => m.status === STATUS_RETIRED).length,
      orphans: live ? reg.members.filter((m) => !live.has(m.target)).length : 0,
      unregistered: unregistered.length,
    },
    updatedAt: reg.updatedAt,
  };
}

/** 人类可读的树形文本（给 tool 返回用） */
export function renderTreeText(tree) {
  const lines = [];
  for (const g of tree.groups) {
    lines.push(`【${g.name}】${g.description ? ` — ${g.description}` : ""}  (${g.members.length} 人)`);
    if (g.members.length === 0) lines.push("  (空)");
    for (const m of g.members) lines.push(`  ${renderMemberLine(m)}`);
  }
  if (tree.ungrouped.length) {
    lines.push(`【未分组】(${tree.ungrouped.length} 人)`);
    for (const m of tree.ungrouped) lines.push(`  ${renderMemberLine(m)}`);
  }
  if (tree.unregistered.length) {
    lines.push(`【未登记成员】(核心存在但名册未登记，共 ${tree.unregistered.length})`);
    for (const t of tree.unregistered) lines.push(`  ${t}`);
  }
  return lines.join("\n");
}

function renderMemberLine(m) {
  const flags = [];
  if (m.isRetired) flags.push("已停用");
  // 「不在核心当前成员列表」≠ 已删除：DSH 的团队是每会话的，成员可能属于其他会话
  if (m.orphan) flags.push("当前会话未列出");
  const tail = flags.length ? `  [${flags.join(" / ")}]` : "";
  const role = m.title ? ` · ${m.title}` : "";
  const skills = m.skills.length ? ` · 技能: ${m.skills.join(", ")}` : "";
  const duty = m.duties.length ? `\n      职责: ${m.duties.join("；")}` : "";
  return `${m.displayName} (${m.target})${role}${skills}${tail}${duty}`;
}
