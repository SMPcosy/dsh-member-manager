#!/usr/bin/env node
/**
 * verify-company.mjs —— dsh-member-manager 交付自检（0.5.x）
 *
 * 用法：
 *   node scripts/verify-company.mjs                # 全量（语法 + 元数据 + 全量测试）
 *   node scripts/verify-company.mjs --skip-tests   # 跳过测试（给 company-package.test.mjs 内部调用）
 *
 * 退出码：0 = 全部通过；1 = 至少一项失败。
 * 只读脚本：不改任何文件、不写 profile；仅在跑完测试后校验 ~/.dsh 公司数据目录没有被测试追加。
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const argv = new Set(process.argv.slice(2));
const SKIP_TESTS = argv.has("--skip-tests");

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail == null ? "" : String(detail) });
  } catch (err) {
    results.push({ name, ok: false, detail: err && err.message ? err.message : String(err) });
  }
}
function must(cond, msg) {
  if (!cond) throw new Error(msg);
}
function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

// ---------------------------------------------------------------------------
// 1. 元数据
// ---------------------------------------------------------------------------
let pkg = null;
await check("package.json 可解析", () => {
  pkg = readJson(path.join(REPO, "package.json"));
  return `v${pkg.version}`;
});
await check("包名/版本/入口", () => {
  must(pkg.name === "dsh-member-manager", `name 应为 dsh-member-manager，实际 ${pkg.name}`);
  must(/^0\.(3|4|5)\.\d+$/.test(pkg.version), `version 应形如 0.3.x / 0.4.x / 0.5.x，实际 ${pkg.version}`);
  must(pkg.main === "lib/index.js", `main 应为 lib/index.js，实际 ${pkg.main}`);
  must(pkg.type === "module", "type 应为 module");
  return `${pkg.name}@${pkg.version}`;
});
await check("files 覆盖源码/提示词/脚本/文档", () => {
  const need = ["lib", "src", "prompts", "scripts", "cordis.patch.yml", "docs"];
  for (const n of need) must(pkg.files.includes(n), `files 缺少 ${n}`);
  return need.join(",");
});
await check("bundle/client 元数据", () => {
  must(pkg.dsh?.bundle?.patch === "./cordis.patch.yml", "dsh.bundle.patch 缺失");
  must(pkg.dsh?.client?.platform === "web", "dsh.client.platform 应为 web");
  return "bundle+client";
});

// ---------------------------------------------------------------------------
// 2. 交付文件存在性
// ---------------------------------------------------------------------------
await check("入口与挂载声明", () => {
  for (const f of ["lib/index.js", "lib/client.js", "cordis.patch.yml", "icon.png"]) {
    must(existsSync(path.join(REPO, f)), `缺少 ${f}`);
  }
  return "4 个";
});
await check("共享内核 6 模块", () => {
  const files = ["company-config", "company-org", "company-ledger", "company-router", "company-store", "company-presets"];
  for (const f of files) must(existsSync(path.join(REPO, "src/shared", `${f}.mjs`)), `缺少 src/shared/${f}.mjs`);
  return files.join(",");
});
await check("宿主运行时 5 模块", () => {
  const files = ["company-compat", "company-employees", "company-dispatcher", "company-scheduler", "company-runtime"];
  for (const f of files) must(existsSync(path.join(REPO, "src/host", `${f}.mjs`)), `缺少 src/host/${f}.mjs`);
  return files.join(",");
});
await check("四套角色提示词", () => {
  const files = ["window", "manager", "staff", "temp"];
  for (const f of files) must(existsSync(path.join(REPO, "prompts", `${f}.md`)), `缺少 prompts/${f}.md`);
  return files.join(",");
});
await check("设计/审阅/交付文档", () => {
  const docs = [
    "11-公司化改造-接口契约.md",
    "12-宿主契约实测.md",
    "13-独立审阅报告.md",
    "14-验证与安装.md",
    "15-交付说明与回滚.md",
    "16-MP双通道等级与编号契约.md",
    "24-游戏开发模式预设契约.md",
    "26-公司与名册关联契约.md",
  ];
  for (const d of docs) must(existsSync(path.join(REPO, "docs", d)), `缺少 docs/${d}`);
  return `${docs.length} 篇`;
});
await check("脚本与兼容包", () => {
  for (const f of ["verify-company.mjs", "switch-to-dsh-member-manager.mjs", "rollback-to-dsh-plugin-member-manager.mjs", "migrate-old-plugin.mjs", "apply-preset.mjs", "roster-link.mjs"]) {
    must(existsSync(path.join(REPO, "scripts", f)), `缺少 scripts/${f}`);
  }
  for (const f of ["package.json", "lib/index.js", "lib/client.js", "cordis.patch.yml"]) {
    must(existsSync(path.join(REPO, "compat", "dsh-plugin-member-manager", f)), `缺少 compat/dsh-plugin-member-manager/${f}`);
  }
  return "6 脚本 + 兼容包";
});
await check("关键测试文件", () => {
  for (const f of ["company-levels.test.mjs", "company-panel.test.mjs", "migrate-plugin.test.mjs", "compat-package.test.mjs", "company-presets.test.mjs", "roster-link.test.mjs"]) {
    must(existsSync(path.join(REPO, "test", f)), `缺少 test/${f}`);
  }
  return "6 个";
});
await check("游戏开发模式预设", async () => {
  const p = await import(pathToFileURL(path.join(REPO, "src/shared/company-presets.mjs")).href);
  must(p.PRESET_SCHEMA_VERSION === 1, "PRESET_SCHEMA_VERSION 应为 1");
  must(p.DEFAULT_PRESET_ID === "game-dev", `DEFAULT_PRESET_ID 应为 game-dev，实际 ${p.DEFAULT_PRESET_ID}`);
  must(Array.isArray(p.PRESETS) && p.PRESETS.length >= 1, "PRESETS 至少要有 1 个预设");
  const preset = p.getPreset("game-dev");
  must(preset, "getPreset('game-dev') 应返回预设对象");
  must(preset.roles.length === 7, `game-dev 应有 7 个岗位，实际 ${preset.roles.length}`);
  must(preset.stages.length === 7, `game-dev 应有 7 个阶段，实际 ${preset.stages.length}`);
  const summary = p.listPresets();
  must(
    summary.some((x) => x.id === "game-dev" && x.stageCount === 7 && x.roleCount === 7),
    "listPresets 应包含 game-dev（7 阶段/7 岗位）摘要",
  );
  // D04 真实 fixture（7 员工，2026-10 生产数据副本）
  const employees = [
    { id: "emp-mviizjij-ak7r", code: "E0016", displayName: "主策划", title: "主策划（玩法与数值）", duties: ["玩法与关卡设计", "数值与经济系统设计", "需求文档与验收标准", "版本内容规划与节奏"], skills: ["domain-modeling", "writing-shape", "prototype", "research"], role: "staff", channel: "P", level: "P4", channels: [{ channel: "P", level: "P4" }], department: "dept-mviizjib-q10k" },
    { id: "emp-mviizjiq-t60k", code: "E0017", displayName: "系统策划", title: "系统策划", duties: ["系统规则与数据结构设计", "交互流程与原型", "与程序/美术对齐实现", "需求变更与版本记录"], skills: ["domain-modeling", "writing-fragments", "codebase-design"], role: "staff", channel: "P", level: "P3", channels: [{ channel: "P", level: "P3" }], department: "dept-mviizjib-q10k" },
    { id: "emp-mviizjiy-s743", code: "E0018", displayName: "客户端工程师", title: "Unity 客户端工程师", duties: ["Unity 客户端功能开发", "UI 与交互实现", "性能与包体优化", "联调与问题修复"], skills: ["implement", "tdd", "code-review"], role: "staff", channel: "P", level: "P3", channels: [{ channel: "P", level: "P3" }], department: "dept-mviizjib-q10k" },
    { id: "emp-mviizjj4-3ctr", code: "E0019", displayName: "服务端工程师", title: "服务端工程师", duties: ["服务端逻辑与接口开发", "存档与数据一致性", "联机与同步机制", "压测与可观测性"], skills: ["implement", "diagnosing-bugs", "tdd"], role: "staff", channel: "P", level: "P3", channels: [{ channel: "P", level: "P3" }], department: "dept-mviizjib-q10k" },
    { id: "emp-mviizjj9-e432", code: "E0020", displayName: "美术设计师", title: "游戏美术与 UI 设计师", duties: ["UI 视觉与界面规范", "图标与游戏资源制作", "动效与体验打磨", "资源命名与归档"], skills: ["prototype", "file-processing-master", "office-render"], role: "staff", channel: "P", level: "P3", channels: [{ channel: "P", level: "P3" }], department: "dept-mviizjib-q10k" },
    { id: "emp-mviizjje-crrl", code: "E0021", displayName: "测试工程师", title: "游戏测试工程师", duties: ["测试计划与用例设计", "功能与回归测试", "缺陷跟踪与复现", "版本验收与发版检查"], skills: ["tdd", "diagnosing-bugs", "code-review"], role: "staff", channel: "P", level: "P2", channels: [{ channel: "P", level: "P2" }], department: "dept-mviizjib-q10k" },
    { id: "emp-mvij1z3n-k1qe", code: "E0022", displayName: "游戏制作人", title: "制作人（项目负责人）", duties: ["版本目标与里程碑管理", "跨职能协作与资源协调", "质量与进度把控", "对外汇报与风险升级"], skills: ["chief-of-staff", "research", "code-review"], role: "manager", channel: "M", level: "M2", channels: [{ channel: "M", level: "M2" }], department: "dept-mviizjib-q10k" },
  ];
  const department = { id: "dept-mviizjib-q10k", code: "D04", name: "游戏开发", preset: { id: "game-dev", version: 1, appliedAt: "2026-10-21T00:00:00.000Z", appliedBy: "cli" } };
  const resolved = p.resolveDepartmentPreset(department, employees);
  must(resolved, "resolveDepartmentPreset 应返回已解析预设对象");
  const expected = {
    director: "E0022",
    "lead-planner": "E0016",
    "system-planner": "E0017",
    "client-dev": "E0018",
    "server-dev": "E0019",
    artist: "E0020",
    qa: "E0021",
  };
  for (const role of resolved.roles) {
    must(role.employee, `岗位 ${role.key}（${role.name}）未匹配到员工`);
    must(
      role.employee.code === expected[role.key],
      `岗位 ${role.key} 期望 ${expected[role.key]}，实际 ${role.employee.code}`,
    );
  }
  return "7 岗位 × 7 阶段 + D04 7/7 命中";
});
await check("公司与名册关联（v0.3.2）", async () => {
  const r = await import(pathToFileURL(path.join(REPO, "src", "shared", "roster-link.mjs")).href);
  for (const fn of [
    "rosterTargetOf",
    "hasExplicitRosterTarget",
    "buildRosterIndex",
    "describeRosterLink",
    "summarizeRosterLinks",
    "buildRosterProfile",
    "planRosterLink",
    "planRosterBatch",
  ]) {
    must(typeof r[fn] === "function", `roster-link 缺少导出 ${fn}`);
  }
  must(r.ROSTER_LINK_STATUS.LINKED === "linked", "ROSTER_LINK_STATUS.LINKED 应为 linked");
  // 隐式 target = 员工 id；显式字段优先
  must(r.rosterTargetOf({ id: "emp-a" }) === "emp-a", "隐式关联应回落到员工 id");
  must(r.rosterTargetOf({ id: "emp-a", rosterTarget: "doc-writer" }) === "doc-writer", "显式 rosterTarget 应优先");
  // 只补空字段：已有 displayName/title 不被覆盖
  const profile = r.buildRosterProfile({ id: "emp-a", displayName: "平面设计", title: "平面设计师" });
  const plan = r.planRosterLink({ target: "emp-a", displayName: "人工名", title: "人工岗位", duties: [], skills: [], note: "人工备注" }, profile);
  must(plan.action === "noop", "已有档案字段时不应覆盖（期望 noop）");
  must(r.planRosterLink({ target: "emp-a", displayName: "emp-a" }, profile).patch.displayName === "平面设计", "空 displayName 应可补");
  // CLI + 文档存在
  must(existsSync(path.join(REPO, "scripts", "roster-link.mjs")), "缺少 scripts/roster-link.mjs");
  must(existsSync(path.join(REPO, "docs", "26-公司与名册关联契约.md")), "缺少 docs/26-公司与名册关联契约.md");
  // v0.3.3：新建部门/员工后自动登记（配置默认开 + 创建路径已接线）
  const cfg = await import(pathToFileURL(path.join(REPO, "src", "shared", "company-config.mjs")).href);
  must(cfg.resolveCompanyConfig(undefined).config.autoLinkRoster === true, "company.autoLinkRoster 默认应为 true");
  must(cfg.resolveCompanyConfig({ autoLinkRoster: false }).config.autoLinkRoster === false, "company.autoLinkRoster=false 应生效");
  const runtimeSrc = readFileSync(path.join(REPO, "src", "host", "company-runtime.mjs"), "utf8");
  must(runtimeSrc.includes("autoLinkRosterFor"), "company-runtime 缺少 autoLinkRosterFor（自动登记实现）");
  for (const marker of ["auto:hire", "auto:admin:createEmployee", "auto:panel:createEmployee"]) {
    must(runtimeSrc.includes(marker), `创建路径未接入自动登记：${marker}`);
  }
  return "8 导出 + 只补空字段 + 自动登记默认开 + CLI";
});
await check("总架构组织架构图字样", () => {
  const client = readFileSync(path.join(REPO, "lib", "client.js"), "utf8");
  for (const s of [
    "总架构",
    "Overall arch",
    "员工中心",
    "Employee center",
    "新建部门",
    "New department",
    "部门架构",
    "Department org",
    "company/overview",
    "company/op",
    "cpTab",
    "cpEmployeeCenter",
    "ocFoldIdle",
    "ocFoldHide",
    "cpModalChart",
    "cpModalMembers",
    "cpModalPreset",
    "cpPresetApply",
    "游戏开发模式",
    "cpNewDept",
    "cpPreviewDept",
    "cpEmpTitle",
    "cpEmpSkills",
    "cpEmpModel",
    "cpPlannedHint",
    "cpDeptEmployees",
    "cpPlannedHint",
    "cpEmployeeName",
    "cpViewAll",
    "EmployeeCenterPanel",
    "cpDeleteDept",
    "工作网",
    "worknet",
    "cpRename",
    "cpMgmtName",
    "cpEditNumbering",
    "cpEditLevels",
    "cpDeptEdit",
    "人事管理",
    "cpHr",
    "cpSaveProfile",
    "cpAddDuty",
    "cpRemoveDuty",
    "pickSkills",
    "pickModel",
    "rosterPicker",
    "cpProfile",
    "cpCompanyName",
    "cpCustomize",
    "cpAddLevel",
    "cpRemoveLevel",
    "cpLevelHint",
    "cpManagement",
    "cpMgmtHint",
    "cpMgmtEmpty",
    "cpChannels",
    "cpSave",
    "cpSaved",
    "setChannels",
    "byEmployee",
    "byDepartment",
    "byOrder",
  ]) {
    must(client.includes(s), `lib/client.js 缺少面板字样 ${s}`);
  }
  return "zh+en+route+chart+costs";
});
await check("cordis.patch.yml 品牌", () => {
  const yml = readFileSync(path.join(REPO, "cordis.patch.yml"), "utf8");
  must(/id:\s*dsh-member-manager/.test(yml), "cordis.patch.yml 缺少 id: dsh-member-manager");
  must(/name:\s*dsh-member-manager/.test(yml), "cordis.patch.yml 缺少 name: dsh-member-manager");
  must(!yml.includes("dsh-plugin-member-manager"), "cordis.patch.yml 仍含旧包名");
  return "id+name";
});

// ---------------------------------------------------------------------------
// 3. 语法检查（lib / src / scripts / 新增测试）
// ---------------------------------------------------------------------------
function listFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) listFiles(p, out);
    else if (/\.(mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}
await check("语法检查 node --check", () => {
  const files = [
    path.join(REPO, "lib/index.js"),
    path.join(REPO, "lib/client.js"),
    ...listFiles(path.join(REPO, "src")),
    ...readdirSync(path.join(REPO, "scripts")).filter((f) => f.endsWith(".mjs")).map((f) => path.join(REPO, "scripts", f)),
    ...readdirSync(path.join(REPO, "test")).filter((f) => f.endsWith(".test.mjs")).map((f) => path.join(REPO, "test", f)),
  ];
  for (const f of files) execFileSync(process.execPath, ["--check", f], { cwd: REPO, stdio: "pipe" });
  return `${files.length} 个文件`;
});

// ---------------------------------------------------------------------------
// 4. 模块导出契约（动态 import，模块顶层必须无 IO/副作用）
// ---------------------------------------------------------------------------
await check("共享内核导出", async () => {
  const mods = {
    "company-config": ["resolveCompanyConfig"],
    "company-org": [
      "EMPLOYEE_ROLE",
      "EMPLOYEE_STATE",
      "SESSION_POLICY",
      "LEVEL_CHANNEL",
      "DEFAULT_LEVELS",
      "DEFAULT_EMPLOYEE_LEVEL",
      "DEFAULT_NUMBERING",
      "channelForRole",
      "resolveLevel",
      "describeEmployeeLevel",
      "formatCode",
      "nextEmployeeCode",
      "nextDepartmentCode",
      "ensureCompanyCodes",
      "promoteEmployee",
      "normalizeChannels",
      "primaryChannelOf",
      "resolveChannelLevel",
      "describeEmployeeChannels",
      "setEmployeeChannels",
    ],
    "company-ledger": ["createOrder", "transitionOrder", "isOrderReady"],
    "company-router": ["routeTypeToDept", "selectEmployee"],
    "company-store": ["CompanyStore"],
    "company-presets": [
      "PRESET_SCHEMA_VERSION",
      "DEFAULT_PRESET_ID",
      "GAME_DEV_PRESET",
      "PRESETS",
      "listPresets",
      "getPreset",
      "normalizePresetRef",
      "validatePresetRef",
      "applyPresetToDepartment",
      "clearPresetFromDepartment",
      "matchPresetRoles",
      "resolveDepartmentPreset",
    ],
  };
  const report = [];
  for (const [mod, names] of Object.entries(mods)) {
    const m = await import(pathToFileURL(path.join(REPO, "src/shared", `${mod}.mjs`)).href);
    for (const n of names) must(typeof m[n] !== "undefined", `${mod} 缺少导出 ${n}`);
    report.push(mod);
  }
  return report.join(",");
});
await check("宿主运行时导出", async () => {
  const m = await import(pathToFileURL(path.join(REPO, "src/host/company-runtime.mjs")).href);
  must(typeof m.createCompanyRuntime === "function", "company-runtime 缺少 createCompanyRuntime");
  return "createCompanyRuntime";
});
await check("插件入口导出", async () => {
  const m = await import(pathToFileURL(path.join(REPO, "lib/index.js")).href);
  must(m.name === "dsh-member-manager", `插件 name 应为 dsh-member-manager，实际 ${m.name}`);
  must(typeof m.apply === "function", "lib/index.js 缺少 apply()");
  must(Array.isArray(m.inject), "插件 inject 应为数组");
  must(m.inject.includes("tools") && m.inject.includes("webServer"), "inject 应含 tools/webServer");
  must(!m.inject.includes("agents"), "inject 不应扩到 agents（降级原则）");
  return `${m.name} inject=[${m.inject.join(",")}]`;
});

// ---------------------------------------------------------------------------
// 5. 全量测试
// ---------------------------------------------------------------------------
const HOME_DATA_DIR = path.join(process.env.DSH_HOME || path.join(os.homedir(), ".dsh"), "storages", "member-manager");
const REAL_AUDIT = path.join(HOME_DATA_DIR, "company", "audit.jsonl");
function fakeOwnerCount() {
  try {
    return readFileSync(REAL_AUDIT, "utf8").split(/\r?\n/).filter((l) => l.includes('"fake-owner"')).length;
  } catch {
    return 0;
  }
}
const fakeBefore = fakeOwnerCount();

if (SKIP_TESTS) {
  results.push({ name: "全量测试", ok: true, detail: "已跳过（--skip-tests）" });
} else {
  await check("全量测试 test/*.test.mjs", () => {
    const out = execFileSync(process.execPath, ["--test", "test/*.test.mjs"], {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 300000,
    });
    const m = out.match(/(?:#|ℹ) pass (\d+)/);
    must(m, "测试输出中找不到 pass 计数");
    return `${m[1]} pass`;
  });
  await check("测试不污染用户数据目录", () => {
    const fakeAfter = fakeOwnerCount();
    must(
      fakeAfter === fakeBefore,
      `测试向 ${REAL_AUDIT} 追加了 ${fakeAfter - fakeBefore} 条 fake-owner 审计（测试必须只用临时目录）`
    );
    return `${REAL_AUDIT} 无新增`;
  });
}

// ---------------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------------
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} 项通过${failed ? `，${failed} 项失败` : "，全部通过"}`);
process.exit(failed ? 1 : 0);
