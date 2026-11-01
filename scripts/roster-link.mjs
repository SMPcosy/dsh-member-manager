#!/usr/bin/env node
/**
 * roster-link.mjs —— 把公司员工档案登记/回填进名册（「公司 → 名册」唯一 CLI 入口）。
 *
 * 背景（v0.3.2）：
 *   公司员工（company.json）与名册成员（registry.json）是两套数据。v5.8 起只有「名册 → 公司」
 *   的补档案动作（importRosterProfiles），没有反方向的入口，于是 emp-* 生成员工（如内容部）
 *   只有公司档案、名册里没有条目。本脚本补齐这个方向：按「只补空字段、绝不覆盖」的原则，
 *   把公司档案（姓名/岗位/职责/技能/模型）写入名册；名册还没有该 target 时新建成员。
 *
 * 用法：
 *   node scripts/roster-link.mjs --list [--department <id|编号|名称>] [选项]
 *   node scripts/roster-link.mjs --department <id|编号|名称> [选项]
 *   node scripts/roster-link.mjs --employee <员工 id> [--employee <员工 id> ...] [选项]
 *   node scripts/roster-link.mjs --all [选项]
 *
 * 选项：
 *   --department <id|code|name>  只处理某个部门的员工
 *   --employee <id>              只处理指定员工（可重复）
 *   --all                        处理全部员工（未指定范围时只列状态，不写盘）
 *   --list                       只列出关联状态，不写盘
 *   --refresh                    用公司档案覆盖名册已有档案字段（默认只补空字段）
 *   --dry-run                    只计算不写盘（打印将要执行的动作）
 *   --data-dir <dir>             数据目录；缺省 %DSH_HOME%/storages/member-manager
 *   --json                       单行 JSON 输出
 *   -h, --help                   打印帮助
 *
 * 退出码：0 成功 / 2 参数或部门/员工不存在 / 1 其它失败
 *
 * 说明：本脚本不依赖 DSH 运行时；写名册走 RegistryStore/TeamService（原子写 + .bak），
 * 写 company 侧审计走 CompanyStore.appendAudit，两者各自加锁、互不嵌套。
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { CompanyStore } from "../src/shared/company-store.mjs";
import { RegistryStore } from "../src/shared/registry-store.mjs";
import { TeamService } from "../src/shared/team-service.mjs";
import {
  ROSTER_LINK_STATUS,
  buildRosterIndex,
  describeRosterLink,
  planRosterBatch,
  rosterTargetOf,
} from "../src/shared/roster-link.mjs";

function parseArgs(argv) {
  const out = { json: false, dryRun: false, list: false, refresh: false, all: false, help: false, employees: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") out.json = true;
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--list") out.list = true;
    else if (arg === "--refresh") out.refresh = true;
    else if (arg === "--all") out.all = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg.startsWith("--department=")) out.department = arg.slice("--department=".length);
    else if (arg === "--department") out.department = argv[++i];
    else if (arg.startsWith("--employee=")) out.employees.push(arg.slice("--employee=".length));
    else if (arg === "--employee") out.employees.push(argv[++i]);
    else if (arg.startsWith("--data-dir=")) out.dataDir = arg.slice("--data-dir=".length);
    else if (arg === "--data-dir") out.dataDir = argv[++i];
    else out.unexpected = arg;
  }
  out.employees = out.employees.filter((id) => typeof id === "string" && id.trim() !== "").map((id) => id.trim());
  return out;
}

function defaultDataDir() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
  return path.join(home, "storages", "member-manager");
}

function printHelp() {
  process.stdout.write(
    [
      "用法：node scripts/roster-link.mjs [--list] [--department <id|编号|名称>] [--employee <id> ...] [--all] [选项]",
      "",
      "选项：",
      "  --department <id|code|name>  只处理某个部门的员工",
      "  --employee <id>              只处理指定员工（可重复）",
      "  --all                        处理全部员工（未指定范围时只列状态，不写盘）",
      "  --list                       只列出关联状态，不写盘",
      "  --refresh                    用公司档案覆盖名册已有档案字段（默认只补空字段）",
      "  --dry-run                    只计算不写盘",
      "  --data-dir <dir>             数据目录，缺省 %DSH_HOME%/storages/member-manager",
      "  --json                       单行 JSON 输出",
      "  -h, --help                   打印本帮助",
      "",
    ].join("\n"),
  );
}

function printJson(value) {
  process.stdout.write(JSON.stringify(value) + "\n");
}

function formatEmployeeLine(employee, link) {
  const code = employee.code || "—";
  const name = employee.displayName || employee.id;
  const status = link.status === ROSTER_LINK_STATUS.LINKED ? "已登记" : link.status === ROSTER_LINK_STATUS.RETIRED ? "名册已停用" : "未登记";
  const target = link.target ? ` → ${link.target}` : "";
  return `  ${code} ${name}（${employee.id}）${target} · ${status}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return 0;
  }
  if (args.unexpected) {
    process.stderr.write(`未知参数：${args.unexpected}\n`);
    printHelp();
    return 2;
  }

  const dataDir = args.dataDir || defaultDataDir();
  const companyStore = new CompanyStore(dataDir);
  const companyLoaded = await companyStore.load();
  const company = companyLoaded.company || {};
  const departments = Array.isArray(company.departments) ? company.departments : [];
  const employees = Array.isArray(company.employees) ? company.employees : [];

  const registryFile = path.join(dataDir, "registry.json");
  const registryStore = new RegistryStore({ file: registryFile });
  const registryLoaded = registryStore.load();
  const index = buildRosterIndex(registryLoaded.registry.members);
  const service = new TeamService({ store: registryStore });

  const deptById = new Map(departments.map((d) => [String(d.id), d]));
  const deptOfEmployee = (employee) => deptById.get(String(employee.department || "")) || null;

  // ---- 范围解析 ----
  let scope = "none";
  let scopeLabel = "（未指定，仅列状态）";
  let selected = employees;
  if (args.department) {
    const key = String(args.department).trim();
    const dept = departments.find((d) => String(d.id) === key || String(d.code) === key || String(d.name) === key);
    if (!dept) {
      process.stderr.write(`部门不存在：${key}\n`);
      return 2;
    }
    selected = employees.filter((e) => String(e.department || "") === String(dept.id));
    scope = "department";
    scopeLabel = `[${dept.code || "—"}] ${dept.name || dept.id}（${selected.length} 人）`;
  }
  if (args.employees.length > 0) {
    const wanted = new Set(args.employees.map(String));
    const missing = [...wanted].filter((id) => !employees.some((e) => String(e.id) === id));
    if (missing.length > 0) {
      process.stderr.write(`员工不存在：${missing.join(", ")}\n`);
      return 2;
    }
    selected = selected.filter((e) => wanted.has(String(e.id)));
    scope = scope === "department" ? "department+employee" : "employee";
    scopeLabel = `${scopeLabel === "（未指定，仅列状态）" ? "" : scopeLabel + " · "}指定 ${selected.length} 人`;
  }
  if (args.all) {
    selected = employees;
    scope = "all";
    scopeLabel = `全部员工（${selected.length} 人）`;
  }

  const rows = selected.map((employee) => ({
    employee,
    link: describeRosterLink(employee, index),
    department: deptOfEmployee(employee),
  }));
  const summary = {
    available: true,
    companyEmployees: employees.length,
    rosterMembers: index.size,
    linked: rows.filter((r) => r.link.status === ROSTER_LINK_STATUS.LINKED).length,
    retired: rows.filter((r) => r.link.status === ROSTER_LINK_STATUS.RETIRED).length,
    unlinked: rows.filter((r) => r.link.status === ROSTER_LINK_STATUS.UNLINKED).length,
  };

  const shouldWrite = !args.list && scope !== "none";
  if (!shouldWrite) {
    if (args.json) {
      printJson({
        ok: true,
        mode: "list",
        dataDir,
        registryFile,
        scope: scopeLabel,
        summary,
        employees: rows.map((r) => ({
          id: r.employee.id,
          code: r.employee.code || "",
          displayName: r.employee.displayName || "",
          departmentId: r.employee.department || null,
          departmentCode: r.department?.code || null,
          target: r.link.target,
          status: r.link.status,
        })),
      });
      return 0;
    }
    process.stdout.write(`数据目录：${dataDir}\n`);
    process.stdout.write(`范围：${scopeLabel}\n`);
    process.stdout.write(
      `名册：${index.size} 名成员；范围员工：已登记 ${summary.linked} / 名册已停用 ${summary.retired} / 未登记 ${summary.unlinked}\n`,
    );
    if (registryLoaded.warnings.length > 0) process.stdout.write(`名册告警：${registryLoaded.warnings.join("；")}\n`);
    for (const row of rows) process.stdout.write(formatEmployeeLine(row.employee, row.link) + "\n");
    if (scope === "none") {
      process.stdout.write("\n未指定范围：用 --department / --employee / --all 选择要登记的员工，或加 --list 只看状态。\n");
    }
    return 0;
  }

  // ---- 生成计划（范围非空才写） ----
  const plan = planRosterBatch(selected, { index, refresh: args.refresh, departmentOf: deptOfEmployee, onlyUnlinked: !args.refresh });
  const creates = plan.filter((p) => p.action === "create");
  const updates = plan.filter((p) => p.action === "update");
  const skipped = selected.length - plan.length;

  if (args.dryRun) {
    if (args.json) {
      printJson({
        ok: true,
        dryRun: true,
        dataDir,
        registryFile,
        scope: scopeLabel,
        summary,
        planned: plan.map((p) => ({ employeeId: p.employee.id, target: p.target, action: p.action, reason: p.reason, patch: p.patch })),
      });
      return 0;
    }
    process.stdout.write(`数据目录：${dataDir}\n范围：${scopeLabel}\n`);
    process.stdout.write(`将新建 ${creates.length} 条、更新 ${updates.length} 条，跳过 ${skipped} 条（dry-run，未写盘）\n`);
    for (const p of plan) {
      const fields = Object.keys(p.patch || {});
      process.stdout.write(
        `  ${p.action === "create" ? "[新建]" : "[回填]"} ${p.employee.code || "—"} ${p.employee.displayName || p.employee.id}（${p.employee.id}）→ ${p.target}${fields.length ? "：" + fields.join(",") : ""}\n`,
      );
    }
    return 0;
  }

  if (plan.length === 0) {
    if (args.json) {
      printJson({ ok: true, dataDir, registryFile, scope: scopeLabel, summary, created: 0, updated: 0, skipped, results: [] });
      return 0;
    }
    process.stdout.write(`范围：${scopeLabel}\n无需写入：范围内 ${skipped} 名员工在名册中均已有条目（用 --refresh 可强制回填档案）。\n`);
    return 0;
  }

  await fs.mkdir(dataDir, { recursive: true });
  const linkResult = service.linkProfiles(plan.map((p) => ({ profile: p.profile, refresh: Boolean(args.refresh), create: true })));
  if (!linkResult.ok) {
    process.stderr.write(`登记失败：${linkResult.code || "ERROR"} ${linkResult.message || ""}\n`);
    return 1;
  }
  const results = linkResult.data.results || [];
  const created = results.filter((r) => r.action === "create").length;
  const updated = results.filter((r) => r.action === "update").length;
  try {
    await companyStore.appendAudit({
      type: "roster.employees_linked",
      count: results.length,
      created,
      updated,
      employeeIds: plan.map((p) => p.employee.id),
      source: "cli",
    });
  } catch (err) {
    // 审计失败不影响名册写入结果，但要明确告知
    process.stderr.write(`公司审计写入失败（名册已写入）：${err.message}\n`);
  }

  if (args.json) {
    printJson({
      ok: true,
      dataDir,
      registryFile,
      scope: scopeLabel,
      summary,
      created,
      updated,
      skipped,
      results,
    });
    return 0;
  }
  process.stdout.write(`范围：${scopeLabel}\n`);
  process.stdout.write(`登记完成：新建 ${created} 条、更新 ${updated} 条、跳过 ${skipped} 条\n`);
  for (const p of plan) {
    if (p.action === "create") process.stdout.write(`  [新建] ${p.employee.displayName || p.employee.id} → ${p.target}\n`);
    else process.stdout.write(`  [回填] ${p.employee.displayName || p.employee.id} → ${p.target}（${Object.keys(p.patch || {}).join(",") || "无变化"}）\n`);
  }
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    process.stderr.write(`失败：${err && err.message ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
