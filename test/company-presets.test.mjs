/**
 * company-presets.test.mjs —— 部门流程预设注册表（game-dev）单元测试。
 * 契约：docs/24-游戏开发模式预设契约.md §3 / §4 / §9.1。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PRESET_SCHEMA_VERSION,
  DEFAULT_PRESET_ID,
  GAME_DEV_PRESET,
  PRESETS,
  listPresets,
  getPreset,
  normalizePresetRef,
  validatePresetRef,
  applyPresetToDepartment,
  clearPresetFromDepartment,
  matchPresetRoles,
  resolveDepartmentPreset,
} from "../src/shared/company-presets.mjs";

/* ------------------------------------------------------------------ */
/* D04 真实 fixture（2026-10 生产数据副本的 7 名员工）                  */
/* ------------------------------------------------------------------ */

const D04_EMPLOYEES = [
  {
    id: "emp-mviizjij-ak7r",
    code: "E0016",
    displayName: "主策划",
    title: "主策划（玩法与数值）",
    duties: ["玩法与关卡设计", "数值与经济系统设计", "需求文档与验收标准", "版本内容规划与节奏"],
    skills: ["domain-modeling", "writing-shape", "prototype", "research"],
    role: "staff",
    channel: "P",
    level: "P4",
    channels: [{ channel: "P", level: "P4" }],
    department: "d04",
  },
  {
    id: "emp-mviizjiq-t60k",
    code: "E0017",
    displayName: "系统策划",
    title: "系统策划",
    duties: ["系统规则与数据结构设计", "交互流程与原型", "与程序/美术对齐实现", "需求变更与版本记录"],
    skills: ["domain-modeling", "writing-fragments", "codebase-design"],
    role: "staff",
    channel: "P",
    level: "P3",
    channels: [{ channel: "P", level: "P3" }],
    department: "d04",
  },
  {
    id: "emp-mviizjiy-s743",
    code: "E0018",
    displayName: "客户端工程师",
    title: "Unity 客户端工程师",
    duties: ["Unity 客户端功能开发", "UI 与交互实现", "性能与包体优化", "联调与问题修复"],
    skills: ["implement", "tdd", "code-review"],
    role: "staff",
    channel: "P",
    level: "P3",
    channels: [{ channel: "P", level: "P3" }],
    department: "d04",
  },
  {
    id: "emp-mviizjj4-3ctr",
    code: "E0019",
    displayName: "服务端工程师",
    title: "服务端工程师",
    duties: ["服务端逻辑与接口开发", "存档与数据一致性", "联机与同步机制", "压测与可观测性"],
    skills: ["implement", "diagnosing-bugs", "tdd"],
    role: "staff",
    channel: "P",
    level: "P3",
    channels: [{ channel: "P", level: "P3" }],
    department: "d04",
  },
  {
    id: "emp-mviizjj9-e432",
    code: "E0020",
    displayName: "美术设计师",
    title: "游戏美术与 UI 设计师",
    duties: ["UI 视觉与界面规范", "图标与游戏资源制作", "动效与体验打磨", "资源命名与归档"],
    skills: ["prototype", "file-processing-master", "office-render"],
    role: "staff",
    channel: "P",
    level: "P3",
    channels: [{ channel: "P", level: "P3" }],
    department: "d04",
  },
  {
    id: "emp-mviizjje-crrl",
    code: "E0021",
    displayName: "测试工程师",
    title: "游戏测试工程师",
    duties: ["测试计划与用例设计", "功能与回归测试", "缺陷跟踪与复现", "版本验收与发版检查"],
    skills: ["tdd", "diagnosing-bugs", "code-review"],
    role: "staff",
    channel: "P",
    level: "P2",
    channels: [{ channel: "P", level: "P2" }],
    department: "d04",
  },
  {
    id: "emp-mvij1z3n-k1qe",
    code: "E0022",
    displayName: "游戏制作人",
    title: "制作人（项目负责人）",
    duties: ["版本目标与里程碑管理", "跨职能协作与资源协调", "质量与进度把控", "对外汇报与风险升级"],
    skills: ["chief-of-staff", "research", "code-review"],
    role: "manager",
    channel: "M",
    level: "M2",
    channels: [{ channel: "M", level: "M2" }],
    department: "d04",
  },
];

const D04_EXPECTED = {
  director: "E0022",
  "lead-planner": "E0016",
  "system-planner": "E0017",
  "client-dev": "E0018",
  "server-dev": "E0019",
  artist: "E0020",
  qa: "E0021",
};

function makeCompanyWithDepartment(preset) {
  return {
    version: 1,
    departments: [{ id: "d04", code: "D04", name: "游戏开发", preset }],
    employees: [],
  };
}

function codeOf(promiseLike) {
  return (err) => {
    assert.equal(err.code, promiseLike);
    return true;
  };
}

/* ------------------------------------------------------------------ */
/* 注册表自检（§3）                                                     */
/* ------------------------------------------------------------------ */

test("注册表常量：schema 版本 1、默认预设 game-dev、PRESETS 非空", () => {
  assert.equal(PRESET_SCHEMA_VERSION, 1);
  assert.equal(DEFAULT_PRESET_ID, "game-dev");
  assert.ok(Array.isArray(PRESETS));
  assert.ok(PRESETS.length >= 1);
  assert.ok(PRESETS.includes(GAME_DEV_PRESET));
});

test("game-dev 预设：7 个岗位 + 7 个阶段，id/version/name 齐全", () => {
  assert.equal(GAME_DEV_PRESET.id, "game-dev");
  assert.equal(GAME_DEV_PRESET.version, 1);
  assert.equal(typeof GAME_DEV_PRESET.name, "string");
  assert.ok(GAME_DEV_PRESET.name.length > 0);
  assert.equal(GAME_DEV_PRESET.roles.length, 7);
  assert.equal(GAME_DEV_PRESET.stages.length, 7);
});

test("game-dev 岗位 key 唯一，通道只能是 M/P，等级形如 M2/P4", () => {
  const keys = GAME_DEV_PRESET.roles.map((role) => role.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const role of GAME_DEV_PRESET.roles) {
    assert.ok(["M", "P"].includes(role.channel), `岗位 ${role.key} 通道非法: ${role.channel}`);
    assert.match(role.level, /^[MP]\d+$/);
    assert.equal(typeof role.name, "string");
    assert.ok(role.name.length > 0);
    assert.equal(typeof role.titleHint, "string");
  }
});

test("game-dev 阶段 key 唯一、index 从 1 连续到 7", () => {
  const keys = GAME_DEV_PRESET.stages.map((stage) => stage.key);
  assert.equal(new Set(keys).size, keys.length);
  const indexes = GAME_DEV_PRESET.stages.map((stage) => stage.index);
  assert.deepEqual(indexes, [1, 2, 3, 4, 5, 6, 7]);
});

test("game-dev 每个阶段的 ownerRole/participantRoles/gates.approverRole 都指向已声明岗位", () => {
  const roleKeys = new Set(GAME_DEV_PRESET.roles.map((role) => role.key));
  for (const stage of GAME_DEV_PRESET.stages) {
    assert.ok(roleKeys.has(stage.ownerRole), `阶段 ${stage.key} ownerRole 未声明: ${stage.ownerRole}`);
    for (const participant of stage.participantRoles) {
      assert.ok(roleKeys.has(participant), `阶段 ${stage.key} participantRole 未声明: ${participant}`);
    }
    for (const gate of stage.gates) {
      assert.ok(roleKeys.has(gate.approverRole), `阶段 ${stage.key} gate ${gate.key} approverRole 未声明: ${gate.approverRole}`);
    }
  }
});

test("game-dev 每个阶段至少 1 个交付物、1 个门禁，且 key 在本阶段内唯一", () => {
  for (const stage of GAME_DEV_PRESET.stages) {
    assert.ok(stage.deliverables.length >= 1, `阶段 ${stage.key} 缺少交付物`);
    assert.ok(stage.gates.length >= 1, `阶段 ${stage.key} 缺少门禁`);
    assert.equal(new Set(stage.deliverables.map((item) => item.key)).size, stage.deliverables.length);
    assert.equal(new Set(stage.gates.map((item) => item.key)).size, stage.gates.length);
    for (const deliverable of stage.deliverables) {
      assert.equal(typeof deliverable.name, "string");
      assert.ok(deliverable.description.length > 0);
    }
  }
});

/* ------------------------------------------------------------------ */
/* listPresets / getPreset / normalizePresetRef / validatePresetRef     */
/* ------------------------------------------------------------------ */

test("listPresets 返回摘要（不含 roles/stages 明细）", () => {
  const list = listPresets();
  assert.ok(Array.isArray(list));
  assert.equal(list.length, PRESETS.length);
  const gameDev = list.find((item) => item.id === "game-dev");
  assert.ok(gameDev);
  assert.deepEqual(Object.keys(gameDev).sort(), ["description", "id", "name", "roleCount", "stageCount", "version"]);
  assert.equal(gameDev.stageCount, 7);
  assert.equal(gameDev.roleCount, 7);
  assert.equal(gameDev.version, 1);
});

test("getPreset：已知返回对象、未知/非字符串返回 null", () => {
  assert.equal(getPreset("game-dev"), GAME_DEV_PRESET);
  assert.equal(getPreset(" game-dev "), GAME_DEV_PRESET);
  assert.equal(getPreset("nope"), null);
  assert.equal(getPreset(undefined), null);
  assert.equal(getPreset(null), null);
  assert.equal(getPreset(42), null);
});

test("normalizePresetRef：字符串 / {id} / {id,version} / 非法输入", () => {
  assert.deepEqual(normalizePresetRef("game-dev"), { id: "game-dev", version: 1 });
  assert.deepEqual(normalizePresetRef("  game-dev  "), { id: "game-dev", version: 1 });
  assert.deepEqual(normalizePresetRef({ id: "game-dev" }), { id: "game-dev", version: 1 });
  assert.deepEqual(normalizePresetRef({ id: "game-dev", version: 3 }), { id: "game-dev", version: 3 });
  // 未知 id 仍归一为 {id, version:null}，由 validatePresetRef 判 E_UNKNOWN_PRESET
  assert.deepEqual(normalizePresetRef("nope"), { id: "nope", version: null });
  assert.equal(normalizePresetRef(""), null);
  assert.equal(normalizePresetRef(undefined), null);
  assert.equal(normalizePresetRef(null), null);
  assert.equal(normalizePresetRef(123), null);
  assert.equal(normalizePresetRef({}), null);
  assert.equal(normalizePresetRef([]), null);
});

test("validatePresetRef：合法返回 {ok,preset}，未知/非法返回错误码", () => {
  const ok = validatePresetRef("game-dev");
  assert.equal(ok.ok, true);
  assert.equal(ok.preset, GAME_DEV_PRESET);

  const unknown = validatePresetRef("nope");
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, "E_UNKNOWN_PRESET");
  assert.match(unknown.message, /nope/);

  const invalid = validatePresetRef(undefined);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, "E_INVALID_PRESET");
});

/* ------------------------------------------------------------------ */
/* applyPresetToDepartment / clearPresetFromDepartment（§4）            */
/* ------------------------------------------------------------------ */

test("applyPresetToDepartment 写入 preset 快照且返回新对象（不改入参）", () => {
  const company = makeCompanyWithDepartment(undefined);
  const next = applyPresetToDepartment(company, "d04", "game-dev");
  assert.notEqual(next, company);
  assert.equal(company.departments[0].preset, undefined, "入参不得被修改");
  const preset = next.departments[0].preset;
  assert.deepEqual(Object.keys(preset).sort(), ["appliedAt", "appliedBy", "id", "version"]);
  assert.equal(preset.id, "game-dev");
  assert.equal(preset.version, 1);
  assert.equal(preset.appliedBy, "owner");
  assert.match(preset.appliedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("applyPresetToDepartment 支持 {id} 引用与自定义 appliedAt/appliedBy", () => {
  const company = makeCompanyWithDepartment(undefined);
  const next = applyPresetToDepartment(company, "d04", { id: "game-dev", version: 2 }, {
    appliedAt: "2026-10-21T00:00:00.000Z",
    appliedBy: "cli",
  });
  assert.deepEqual(next.departments[0].preset, {
    id: "game-dev",
    version: 1, // 快照版本取注册表版本
    appliedAt: "2026-10-21T00:00:00.000Z",
    appliedBy: "cli",
  });
});

test("applyPresetToDepartment：部门不存在抛 E_NO_DEPARTMENT", () => {
  const company = makeCompanyWithDepartment(undefined);
  assert.throws(() => applyPresetToDepartment(company, "nope", "game-dev"), codeOf("E_NO_DEPARTMENT"));
});

test("applyPresetToDepartment：未知预设抛 E_UNKNOWN_PRESET，非法引用抛 E_INVALID_PRESET", () => {
  const company = makeCompanyWithDepartment(undefined);
  assert.throws(() => applyPresetToDepartment(company, "d04", "nope"), codeOf("E_UNKNOWN_PRESET"));
  assert.throws(() => applyPresetToDepartment(company, "d04", 123), codeOf("E_INVALID_PRESET"));
});

test("applyPresetToDepartment：重复套用刷新 appliedAt", () => {
  let company = makeCompanyWithDepartment(undefined);
  company = applyPresetToDepartment(company, "d04", "game-dev", { appliedAt: "2026-01-01T00:00:00.000Z" });
  company = applyPresetToDepartment(company, "d04", "game-dev", { appliedAt: "2026-02-02T00:00:00.000Z" });
  assert.equal(company.departments[0].preset.appliedAt, "2026-02-02T00:00:00.000Z");
});

test("clearPresetFromDepartment 删除字段、可幂等、不改入参", () => {
  const company = applyPresetToDepartment(makeCompanyWithDepartment(undefined), "d04", "game-dev");
  const cleared = clearPresetFromDepartment(company, "d04");
  assert.notEqual(cleared, company);
  assert.equal(cleared.departments[0].preset, undefined);
  assert.ok(company.departments[0].preset, "入参不得被修改");
  // 幂等：再清一次不报错
  const clearedAgain = clearPresetFromDepartment(cleared, "d04");
  assert.equal(clearedAgain.departments[0].preset, undefined);
});

test("clearPresetFromDepartment：部门不存在抛 E_NO_DEPARTMENT", () => {
  assert.throws(() => clearPresetFromDepartment(makeCompanyWithDepartment(undefined), "nope"), codeOf("E_NO_DEPARTMENT"));
});

/* ------------------------------------------------------------------ */
/* matchPresetRoles（§3.3 v1.1）                                       */
/* ------------------------------------------------------------------ */

test("matchPresetRoles：D04 真实 fixture 7/7 命中且岗位映射正确", () => {
  const matched = matchPresetRoles(GAME_DEV_PRESET, D04_EMPLOYEES);
  assert.equal(matched.length, 7);
  for (const role of matched) {
    assert.ok(role.employee, `岗位 ${role.key} 未命中`);
    assert.equal(role.employee.code, D04_EXPECTED[role.key], `岗位 ${role.key} 映射错误`);
  }
  // 每人最多一槽：7 名员工各出现一次
  const ids = matched.map((role) => role.employee.id);
  assert.equal(new Set(ids).size, 7);
});

test("matchPresetRoles：弱字段（duties）不得抢走强字段（title）岗位（v1.1 回归）", () => {
  const employees = [
    {
      id: "client",
      code: "E0002",
      displayName: "客户端工程师",
      title: "Unity 客户端工程师",
      duties: ["客户端功能开发", "配合策划做交互"], // 含「策划」但属弱字段
      skills: [],
      channels: [{ channel: "P", level: "P3" }],
    },
    {
      id: "planner",
      code: "E0003",
      displayName: "系统策划",
      title: "系统策划",
      duties: ["规则设计"],
      skills: [],
      channels: [{ channel: "P", level: "P3" }],
    },
  ];
  const matched = matchPresetRoles(GAME_DEV_PRESET, employees);
  const byKey = new Map(matched.map((role) => [role.key, role.employee]));
  assert.equal(byKey.get("system-planner")?.id, "planner");
  assert.equal(byKey.get("client-dev")?.id, "client");
  assert.equal(byKey.get("qa"), null);
});

test("matchPresetRoles：无候选槽位为 null，未匹配员工不被消费", () => {
  const matched = matchPresetRoles(GAME_DEV_PRESET, []);
  assert.equal(matched.length, 7);
  for (const role of matched) assert.equal(role.employee, null);

  const single = matchPresetRoles(GAME_DEV_PRESET, [
    { id: "only-director", code: "E0001", title: "游戏制作人", displayName: "游戏制作人", duties: [], skills: [] },
  ]);
  const assigned = single.filter((role) => role.employee);
  assert.equal(assigned.length, 1);
  assert.equal(assigned[0].key, "director");
});

test("matchPresetRoles：每人最多一个槽位（同 title 两人只占一个槽）", () => {
  const employees = [
    { id: "a", code: "E0001", title: "游戏制作人", displayName: "制作人 A", duties: [], skills: [] },
    { id: "b", code: "E0002", title: "游戏制作人", displayName: "制作人 B", duties: [], skills: [] },
  ];
  const matched = matchPresetRoles(GAME_DEV_PRESET, employees);
  const director = matched.find((role) => role.key === "director");
  assert.ok(director.employee);
  const assignedIds = matched.map((role) => role.employee?.id).filter(Boolean);
  assert.equal(assignedIds.length, 1);
  assert.equal(assignedIds[0], director.employee.id);
});

test("matchPresetRoles：M 槽同分时 manager 优先（P 槽不启用该规则）", () => {
  const employees = [
    { id: "staff", code: "E0001", title: "制作人助理", displayName: "制作人助理", role: "staff", duties: [], skills: [] },
    { id: "manager", code: "E0002", title: "经理", displayName: "经理", role: "manager", duties: [], skills: [] },
  ];
  const matched = matchPresetRoles(GAME_DEV_PRESET, employees);
  assert.equal(matched.find((role) => role.key === "director").employee.id, "manager");

  // P 槽：manager 优先不参与排序，按等级/编号决出
  const pSlot = matchPresetRoles(
    { roles: [{ key: "p-role", name: "P 槽", channel: "P", level: "P3", titleHint: "x", match: ["客户端"] }] },
    [
      { id: "m", code: "E0001", title: "客户端经理", displayName: "客户端经理", role: "manager", duties: [], skills: [] },
      { id: "s", code: "E0002", title: "客户端工程师", displayName: "客户端工程师", role: "staff", duties: [], skills: [] },
    ],
  );
  assert.equal(pSlot[0].employee.id, "m"); // 同分按 code 升序，manager 规则不生效也不改变结果
});

test("matchPresetRoles：同分同身份时等级高者优先（通道等级优先于旧 level 字段）", () => {
  const employees = [
    {
      id: "low",
      code: "E0001",
      title: "游戏制作人",
      displayName: "制作人 low",
      role: "staff",
      level: "M1",
      channels: [{ channel: "M", level: "M1" }],
      duties: [],
      skills: [],
    },
    {
      id: "high",
      code: "E0002",
      title: "游戏制作人",
      displayName: "制作人 high",
      role: "staff",
      level: "M1", // 旧字段更低，但 channels 里 M3 生效
      channels: [{ chain: "M", level: "M3" }, { channel: "M", level: "M3" }],
      duties: [],
      skills: [],
    },
  ];
  const matched = matchPresetRoles(GAME_DEV_PRESET, employees);
  assert.equal(matched.find((role) => role.key === "director").employee.id, "high");
});

test("matchPresetRoles：同分同等级按 code 升序，无 code 排最后", () => {
  const employees = [
    { id: "no-code", code: "", title: "游戏制作人", displayName: "无编号", duties: [], skills: [] },
    { id: "e2", code: "E0002", title: "游戏制作人", displayName: "二号", duties: [], skills: [] },
    { id: "e1", code: "E0001", title: "游戏制作人", displayName: "一号", duties: [], skills: [] },
  ];
  const matched = matchPresetRoles(GAME_DEV_PRESET, employees);
  assert.equal(matched.find((role) => role.key === "director").employee.id, "e1");
});

test("matchPresetRoles：roles 顺序即优先级（前面的槽先选人）", () => {
  const employees = [
    { id: "dual", code: "E0001", title: "游戏制作人 / 主策划", displayName: "双岗", duties: [], skills: [] },
  ];
  const matched = matchPresetRoles(GAME_DEV_PRESET, employees);
  assert.equal(matched.find((role) => role.key === "director").employee?.id, "dual");
  assert.equal(matched.find((role) => role.key === "lead-planner").employee, null);
});

test("matchPresetRoles：返回的 employee 摘要只含 {id,code,displayName,level} 且等级取对应通道", () => {
  const matched = matchPresetRoles(GAME_DEV_PRESET, D04_EMPLOYEES);
  const director = matched.find((role) => role.key === "director");
  assert.deepEqual(Object.keys(director.employee).sort(), ["code", "displayName", "id", "level"]);
  assert.equal(director.employee.level, "M2");
  const qa = matched.find((role) => role.key === "qa");
  assert.equal(qa.employee.level, "P2");
});

test("matchPresetRoles：不修改入参 preset / employees", () => {
  const employees = JSON.parse(JSON.stringify(D04_EMPLOYEES));
  const snapshot = JSON.stringify(employees);
  const presetSnapshot = JSON.stringify(GAME_DEV_PRESET);
  matchPresetRoles(GAME_DEV_PRESET, employees);
  assert.equal(JSON.stringify(employees), snapshot);
  assert.equal(JSON.stringify(GAME_DEV_PRESET), presetSnapshot);
});

/* ------------------------------------------------------------------ */
/* resolveDepartmentPreset（§3.2）                                     */
/* ------------------------------------------------------------------ */

test("resolveDepartmentPreset：无 preset 返回 null", () => {
  assert.equal(resolveDepartmentPreset({ id: "d04" }, D04_EMPLOYEES), null);
  assert.equal(resolveDepartmentPreset({ id: "d04", preset: null }, D04_EMPLOYEES), null);
  assert.equal(resolveDepartmentPreset({ id: "d04", preset: "game-dev" }, D04_EMPLOYEES), null);
  assert.equal(resolveDepartmentPreset(null, D04_EMPLOYEES), null);
});

test("resolveDepartmentPreset：未知预设 id 返回 null（不抛）", () => {
  const department = { id: "d04", preset: { id: "nope", version: 1, appliedAt: "2026-01-01T00:00:00.000Z", appliedBy: "owner" } };
  assert.equal(resolveDepartmentPreset(department, D04_EMPLOYEES), null);
});

test("resolveDepartmentPreset 返回 §3.2 结构且字段逐项齐全", () => {
  const department = {
    id: "d04",
    code: "D04",
    name: "游戏开发",
    preset: { id: "game-dev", version: 1, appliedAt: "2026-10-21T00:00:00.000Z", appliedBy: "cli" },
  };
  const resolved = resolveDepartmentPreset(department, D04_EMPLOYEES);
  assert.deepEqual(Object.keys(resolved).sort(), [
    "appliedAt",
    "appliedBy",
    "currentVersion",
    "description",
    "id",
    "name",
    "outdated",
    "roles",
    "stages",
    "version",
  ]);
  assert.equal(resolved.id, "game-dev");
  assert.equal(resolved.version, 1);
  assert.equal(resolved.currentVersion, 1);
  assert.equal(resolved.outdated, false);
  assert.equal(resolved.appliedAt, "2026-10-21T00:00:00.000Z");
  assert.equal(resolved.appliedBy, "cli");
  assert.equal(resolved.roles.length, 7);
  assert.equal(resolved.stages.length, 7);

  const role = resolved.roles[0];
  assert.deepEqual(Object.keys(role).sort(), ["channel", "employee", "key", "level", "name", "titleHint"]);

  const stage = resolved.stages[0];
  assert.deepEqual(Object.keys(stage).sort(), ["deliverables", "gates", "goal", "index", "key", "name", "owner", "participants"]);
  assert.deepEqual(Object.keys(stage.owner).sort(), ["employee", "roleKey", "roleName"]);
  assert.deepEqual(Object.keys(stage.deliverables[0]).sort(), ["description", "key", "name"]);
  assert.deepEqual(Object.keys(stage.gates[0]).sort(), ["approverName", "approverRole", "description", "key", "name"]);
  for (const participant of stage.participants) {
    assert.deepEqual(Object.keys(participant).sort(), ["employee", "roleKey", "roleName"]);
  }
});

test("resolveDepartmentPreset：D04 每个阶段 owner 与参与人都解析出员工，门禁 approverName 正确", () => {
  const department = {
    id: "d04",
    preset: { id: "game-dev", version: 1, appliedAt: "2026-10-21T00:00:00.000Z", appliedBy: "owner" },
  };
  const resolved = resolveDepartmentPreset(department, D04_EMPLOYEES);
  for (const stage of resolved.stages) {
    assert.ok(stage.owner.employee, `阶段 ${stage.key} owner 未分配`);
    for (const participant of stage.participants) {
      assert.ok(participant.employee, `阶段 ${stage.key} 参与人 ${participant.roleKey} 未分配`);
    }
    for (const gate of stage.gates) {
      assert.equal(typeof gate.approverName, "string");
      assert.ok(gate.approverName.length > 0);
      assert.ok(stage.owner.roleKey === stage.owner.roleKey);
    }
  }
});

test("resolveDepartmentPreset：版本落后时 outdated=true（ref.version 999）", () => {
  const department = { id: "d04", preset: { id: "game-dev", version: 999, appliedAt: null, appliedBy: null } };
  const resolved = resolveDepartmentPreset(department, D04_EMPLOYEES);
  assert.equal(resolved.version, 999);
  assert.equal(resolved.currentVersion, 1);
  assert.equal(resolved.outdated, true);
});

test("applyPresetToDepartment → resolveDepartmentPreset 往返一致（D04 7/7）", () => {
  const company = applyPresetToDepartment(makeCompanyWithDepartment(undefined), "d04", "game-dev");
  const resolved = resolveDepartmentPreset(company.departments[0], D04_EMPLOYEES);
  assert.ok(resolved);
  for (const role of resolved.roles) {
    assert.equal(role.employee.code, D04_EXPECTED[role.key]);
  }
  assert.equal(resolved.stages[0].owner.employee.code, "E0022");
});
