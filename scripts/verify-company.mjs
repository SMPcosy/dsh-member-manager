#!/usr/bin/env node
/**
 * verify-company.mjs —— dsh-member-manager 0.3.0 交付自检
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
  must(pkg.version === "0.3.0", `version 应为 0.3.0，实际 ${pkg.version}`);
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
await check("共享内核 5 模块", () => {
  const files = ["company-config", "company-org", "company-ledger", "company-router", "company-store"];
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
  ];
  for (const d of docs) must(existsSync(path.join(REPO, "docs", d)), `缺少 docs/${d}`);
  return `${docs.length} 篇`;
});
await check("安装/切换/回滚脚本", () => {
  for (const f of ["verify-company.mjs", "switch-to-dsh-member-manager.mjs", "rollback-to-dsh-plugin-member-manager.mjs"]) {
    must(existsSync(path.join(REPO, "scripts", f)), `缺少 scripts/${f}`);
  }
  return "3 个";
});
await check("M/P 等级与面板测试文件", () => {
  for (const f of ["company-levels.test.mjs", "company-panel.test.mjs"]) {
    must(existsSync(path.join(REPO, "test", f)), `缺少 test/${f}`);
  }
  return "2 个";
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
    "cpModalChart",
    "cpModalMembers",
    "cpNewDept",
    "cpSyncRoster",
    "cpDeleteDept",
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
    ],
    "company-ledger": ["createOrder", "transitionOrder", "isOrderReady"],
    "company-router": ["routeTypeToDept", "selectEmployee"],
    "company-store": ["CompanyStore"],
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
