/**
 * company-presets.mjs
 * 部门流程预设注册表 + 纯函数（零 DSH 依赖、模块顶层无 IO/副作用）。
 * 契约：docs/24-游戏开发模式预设契约.md §3（冻结）。
 */

export const PRESET_SCHEMA_VERSION = 1;
export const DEFAULT_PRESET_ID = "game-dev";

export const GAME_DEV_PRESET = {
  id: "game-dev",
  name: "游戏开发模式",
  version: 1, // 预设内容版本；套用时快照进部门
  description: "围绕可玩 demo 的七阶段研发流水线：立项 → 原型 → 开发 → 美术 → 测试 → 验收 → 迭代。",
  roles: [
    // 岗位槽位，顺序即匹配优先级
    { key: "director", name: "制作人", channel: "M", level: "M2", titleHint: "游戏制作人", match: ["制作人", "经理"] },
    { key: "lead-planner", name: "主策划", channel: "P", level: "P4", titleHint: "主策划（玩法与数值）", match: ["主策划"] },
    { key: "system-planner", name: "系统策划", channel: "P", level: "P3", titleHint: "系统策划", match: ["系统策划", "数值", "策划"] },
    { key: "client-dev", name: "客户端工程师", channel: "P", level: "P3", titleHint: "Unity 客户端工程师", match: ["客户端"] },
    { key: "server-dev", name: "服务端工程师", channel: "P", level: "P3", titleHint: "服务端工程师", match: ["服务端", "后端"] },
    { key: "artist", name: "美术/UI 设计师", channel: "P", level: "P3", titleHint: "游戏美术与 UI 设计师", match: ["美术", "UI", "界面", "视觉"] },
    { key: "qa", name: "测试工程师", channel: "P", level: "P2", titleHint: "测试工程师", match: ["测试", "QA"] },
  ],
  stages: [
    {
      key: "init",
      index: 1,
      name: "立项",
      goal: "定义目标、范围与成功标准，确定本版本核心可玩假设",
      ownerRole: "director",
      participantRoles: ["lead-planner"],
      deliverables: [
        { key: "charter", name: "立项书", description: "目标 / 范围 / 成功标准 / 风险与假设" },
        { key: "hypothesis", name: "核心玩法假设", description: "一句话说明玩家反复玩什么" },
      ],
      gates: [{ key: "G1", name: "立项批准", approverRole: "director", description: "目标与范围明确、风险已登记" }],
    },
    {
      key: "prototype",
      index: 2,
      name: "原型",
      goal: "用最小成本验证核心循环是否成立",
      ownerRole: "lead-planner",
      participantRoles: ["system-planner", "client-dev", "artist"],
      deliverables: [
        { key: "playable", name: "可玩原型", description: "跑通一次核心循环的可运行版本" },
        { key: "playtest", name: "玩法验证记录", description: "假设验证结论与调整方向" },
      ],
      gates: [{ key: "G2", name: "核心循环可玩", approverRole: "director", description: "原型可独立启动并完成一次循环" }],
    },
    {
      key: "develop",
      index: 3,
      name: "开发",
      goal: "把原型扩展为本版本完整功能",
      ownerRole: "client-dev",
      participantRoles: ["server-dev", "system-planner"],
      deliverables: [
        { key: "build", name: "功能实现与构建说明", description: "启动方式 / 依赖 / 已知限制" },
        { key: "integration", name: "联调说明", description: "客户端与服务端接口与数据约定" },
      ],
      gates: [{ key: "G3", name: "核心功能自测通过", approverRole: "lead-planner", description: "构建可跑、核心功能可用" }],
    },
    {
      key: "art",
      index: 4,
      name: "美术",
      goal: "统一视觉与 UI，让版本具备可交付观感",
      ownerRole: "artist",
      participantRoles: ["lead-planner"],
      deliverables: [
        { key: "style", name: "视觉与 UI 规范", description: "配色 / 字体 / 组件 / 界面说明" },
        { key: "screens", name: "关键界面稿", description: "至少主界面与核心操作界面" },
      ],
      gates: [{ key: "G4", name: "界面一致性与可读性确认", approverRole: "director", description: "关键界面风格统一、信息可读" }],
    },
    {
      key: "test",
      index: 5,
      name: "测试",
      goal: "系统验证功能与稳定性，产出可复现缺陷清单",
      ownerRole: "qa",
      participantRoles: ["client-dev", "server-dev"],
      deliverables: [
        { key: "report", name: "测试报告", description: "覆盖范围 / 用例数 / 通过率" },
        { key: "bugs", name: "缺陷清单", description: "每条含复现步骤与严重级别" },
      ],
      gates: [{ key: "G5", name: "阻断级缺陷清零", approverRole: "qa", description: "无阻断级缺陷，其余缺陷已登记" }],
    },
    {
      key: "accept",
      index: 6,
      name: "验收",
      goal: "确认版本达成度并决定是否可交付",
      ownerRole: "director",
      participantRoles: ["qa", "lead-planner"],
      deliverables: [
        { key: "verdict", name: "验收结论", description: "通过 / 有条件通过 / 打回，附理由" },
        { key: "known", name: "已知问题清单", description: "随版本发布的已知限制" },
      ],
      gates: [{ key: "G6", name: "验收通过", approverRole: "director", description: "成功标准逐条对照，结论明确" }],
    },
    {
      key: "iterate",
      index: 7,
      name: "迭代",
      goal: "沉淀复盘并规划下一版本",
      ownerRole: "director",
      participantRoles: ["lead-planner", "system-planner", "client-dev", "server-dev", "artist", "qa"],
      deliverables: [
        { key: "plan", name: "下版本目标与排期", description: "目标 / 范围 / 里程碑" },
        { key: "retro", name: "复盘记录", description: "做对了什么、下次改什么" },
      ],
      gates: [{ key: "G7", name: "下一轮立项就绪", approverRole: "director", description: "下一版本目标与范围已确认" }],
    },
  ],
};

export const PRESETS = [GAME_DEV_PRESET];

/* ------------------------------------------------------------------ */
/* 内部工具                                                             */
/* ------------------------------------------------------------------ */

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function presetError(message, code) {
  return Object.assign(new Error(message), { code });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function levelRank(employee, channel) {
  try {
    const channels = Array.isArray(employee?.channels) ? employee.channels : [];
    const hit = channels.find((entry) => entry && entry.channel === channel);
    const raw = hit ? hit.level : employee?.level;
    const parsed = Number.parseInt(String(raw ?? "").replace(/^[A-Za-z]+/, ""), 10);
    return Number.isFinite(parsed) ? parsed : -1;
  } catch {
    return -1;
  }
}

function employeeSummary(employee, channel) {
  if (!employee) return null;
  return {
    id: employee.id ?? null,
    code: employee.code ?? null,
    displayName: employee.displayName ?? employee.id ?? null,
    level: (() => {
      const channels = Array.isArray(employee.channels) ? employee.channels : [];
      const hit = channels.find((entry) => entry && entry.channel === channel);
      return hit?.level ?? employee.level ?? null;
    })(),
  };
}

/* ------------------------------------------------------------------ */
/* 注册表 API（§3.1）                                                   */
/* ------------------------------------------------------------------ */

/** → [{id,name,version,description,stageCount,roleCount}]，按 PRESETS 顺序 */
export function listPresets() {
  return PRESETS.map((preset) => ({
    id: preset.id,
    name: preset.name,
    version: preset.version,
    description: preset.description,
    stageCount: Array.isArray(preset.stages) ? preset.stages.length : 0,
    roleCount: Array.isArray(preset.roles) ? preset.roles.length : 0,
  }));
}

/** → preset | null（不抛） */
export function getPreset(id) {
  if (typeof id !== "string") return null;
  const trimmed = id.trim();
  if (!trimmed) return null;
  return PRESETS.find((preset) => preset.id === trimmed) ?? null;
}

/**
 * → {id,version} | null；value 可 string | {id}；version 缺省取注册表 version。
 * 未知 id 仍归一为 {id, version:null}（由 validatePresetRef 判 E_UNKNOWN_PRESET）。
 */
export function normalizePresetRef(value) {
  if (typeof value === "string") {
    const id = value.trim();
    if (!id) return null;
    const preset = getPreset(id);
    return { id, version: preset ? preset.version : null };
  }
  if (!isPlainObject(value)) return null;
  const rawId = value.id;
  if (typeof rawId !== "string") return null;
  const id = rawId.trim();
  if (!id) return null;
  const explicitVersion = Number.isInteger(value.version) && value.version > 0 ? value.version : null;
  const preset = getPreset(id);
  return { id, version: explicitVersion ?? (preset ? preset.version : null) };
}

/** → {ok:true, preset} | {ok:false, code:"E_UNKNOWN_PRESET"|"E_INVALID_PRESET", message} */
export function validatePresetRef(value) {
  const ref = normalizePresetRef(value);
  if (!ref) {
    return {
      ok: false,
      code: "E_INVALID_PRESET",
      message: `非法预设引用: ${typeof value === "string" ? value : JSON.stringify(value ?? null)}`,
    };
  }
  const preset = getPreset(ref.id);
  if (!preset) {
    return { ok: false, code: "E_UNKNOWN_PRESET", message: `未知预设: ${ref.id}` };
  }
  return { ok: true, preset };
}

/* ------------------------------------------------------------------ */
/* 部门套用 / 清除（§3.1、§4）                                          */
/* ------------------------------------------------------------------ */

/**
 * → 新 company（深拷贝，不改入参）；department.preset = { id, version, appliedAt, appliedBy }。
 * 部门不存在抛 E_NO_DEPARTMENT；预设未知抛 E_UNKNOWN_PRESET。
 */
export function applyPresetToDepartment(company, departmentId, presetId, { appliedAt, appliedBy } = {}) {
  const next = clone(company ?? {});
  const departments = Array.isArray(next.departments) ? next.departments : [];
  const department = departments.find((entry) => entry && entry.id === departmentId);
  if (!department) throw presetError(`部门不存在: ${departmentId}`, "E_NO_DEPARTMENT");
  const checked = validatePresetRef(presetId);
  if (!checked.ok) throw presetError(checked.message, checked.code);
  const at = typeof appliedAt === "string" && appliedAt ? appliedAt : new Date().toISOString();
  const by = typeof appliedBy === "string" && appliedBy ? appliedBy : "owner";
  department.preset = { id: checked.preset.id, version: checked.preset.version, appliedAt: at, appliedBy: by };
  return next;
}

/**
 * → 新 company；无 preset 时幂等（原样删字段）。部门不存在抛 E_NO_DEPARTMENT。
 */
export function clearPresetFromDepartment(company, departmentId) {
  const next = clone(company ?? {});
  const departments = Array.isArray(next.departments) ? next.departments : [];
  const department = departments.find((entry) => entry && entry.id === departmentId);
  if (!department) throw presetError(`部门不存在: ${departmentId}`, "E_NO_DEPARTMENT");
  delete department.preset;
  return next;
}

/* ------------------------------------------------------------------ */
/* 岗位匹配（§3.3）与部门已解析预设（§3.2）                             */
/* ------------------------------------------------------------------ */

/**
 * §3.3 v1.1：强字段（岗位身份：title/displayName）与弱字段（职责/技能）分开做 haystack，
 * 避免 duties/skills 里的关键词把本属于后续槽位的员工抢走。
 */
function employeeHaystacks(employee) {
  if (!employee || typeof employee !== "object") return { strong: "", weak: "" };
  const duties = Array.isArray(employee.duties) ? employee.duties.filter((d) => typeof d === "string") : [];
  const skills = Array.isArray(employee.skills) ? employee.skills.filter((s) => typeof s === "string") : [];
  const strong = [typeof employee.title === "string" ? employee.title : "", typeof employee.displayName === "string" ? employee.displayName : ""]
    .join(" ")
    .toLowerCase();
  const weak = [duties.join(" "), skills.join(" ")].join(" ").toLowerCase();
  return { strong, weak };
}

function matchTokens(role) {
  return Array.isArray(role?.match)
    ? role.match.filter((token) => typeof token === "string" && token.trim()).map((token) => token.trim().toLowerCase())
    : [];
}

function compareCandidates(a, b, role) {
  if (a.score !== b.score) return b.score - a.score;
  // M 槽：manager 岗位优先（P 槽不启用该规则）。
  if (role.channel === "M") {
    const managerA = a.employee?.role === "manager" ? 0 : 1;
    const managerB = b.employee?.role === "manager" ? 0 : 1;
    if (managerA !== managerB) return managerA - managerB;
  }
  const rankA = levelRank(a.employee, role.channel);
  const rankB = levelRank(b.employee, role.channel);
  if (rankA !== rankB) return rankB - rankA;
  const codeA = typeof a.employee?.code === "string" && a.employee.code ? a.employee.code : null;
  const codeB = typeof b.employee?.code === "string" && b.employee.code ? b.employee.code : null;
  if (codeA !== codeB) {
    if (codeA === null) return 1;
    if (codeB === null) return -1;
    return codeA < codeB ? -1 : 1;
  }
  return a.index - b.index;
}

/**
 * → [{key,name,channel,level,titleHint,employee:{id,code,displayName,level}|null}]
 * 确定性（§3.3 v1.1）：roles 声明顺序 → 每员工最多一个槽位 → 强字段(2分)优于弱字段(1分)
 * → M 槽 manager 优先 → 通道等级降序 → code 升序 → 原序。
 */
export function matchPresetRoles(preset, employees) {
  const roles = Array.isArray(preset?.roles) ? preset.roles : [];
  const list = Array.isArray(employees) ? employees : [];
  const haystacks = list.map((employee) => employeeHaystacks(employee));
  const used = new Set();
  const matched = [];

  for (const role of roles) {
    const tokens = matchTokens(role);
    const candidates = [];
    for (let index = 0; index < list.length; index++) {
      if (used.has(index)) continue;
      const { strong, weak } = haystacks[index];
      let score = 0;
      if (tokens.some((token) => strong.includes(token))) score = 2;
      else if (tokens.some((token) => weak.includes(token))) score = 1;
      if (score === 0) continue;
      candidates.push({ index, employee: list[index], score });
    }
    candidates.sort((a, b) => compareCandidates(a, b, role));
    const winner = candidates[0];
    if (winner) used.add(winner.index);
    matched.push({
      key: role.key,
      name: role.name,
      channel: role.channel,
      level: role.level,
      titleHint: role.titleHint,
      employee: winner ? employeeSummary(winner.employee, role.channel) : null,
    });
  }
  return matched;
}

/**
 * → null（无 preset / 未知预设）| §3.2 解析结构。
 * 契约 §10：注册表不存在/损坏时对未知 id 返回 null（部门保留原始引用字段，不抛不崩）。
 */
export function resolveDepartmentPreset(department, employees) {
  const ref = isPlainObject(department?.preset) ? department.preset : null;
  if (!ref) return null;
  const preset = getPreset(ref.id);
  if (!preset) return null;
  const matchedRoles = matchPresetRoles(preset, employees);
  const roleByKey = new Map(matchedRoles.map((role) => [role.key, role]));
  const declaredRole = (roleKey) => {
    const declared = (preset.roles || []).find((role) => role.key === roleKey);
    return { roleKey, roleName: declared?.name ?? roleKey, employee: roleByKey.get(roleKey)?.employee ?? null };
  };
  const version = Number.isInteger(ref.version) && ref.version > 0 ? ref.version : preset.version;
  const currentVersion = preset.version;

  const stages = (preset.stages || []).map((stage) => ({
    key: stage.key,
    index: stage.index,
    name: stage.name,
    goal: stage.goal,
    owner: declaredRole(stage.ownerRole),
    participants: (stage.participantRoles || []).map((roleKey) => declaredRole(roleKey)),
    deliverables: (stage.deliverables || []).map((item) => ({ key: item.key, name: item.name, description: item.description })),
    gates: (stage.gates || []).map((gate) => ({
      key: gate.key,
      name: gate.name,
      approverRole: gate.approverRole,
      approverName: (preset.roles || []).find((role) => role.key === gate.approverRole)?.name ?? gate.approverRole,
      description: gate.description,
    })),
  }));

  return {
    id: preset.id,
    name: preset.name,
    version,
    currentVersion,
    outdated: version !== currentVersion,
    description: preset.description,
    appliedAt: ref.appliedAt ?? null,
    appliedBy: ref.appliedBy ?? null,
    roles: matchedRoles,
    stages,
  };
}
