#!/usr/bin/env node
/**
 * apply-preset.mjs —— 给某个部门套用/清除流程预设（默认 game-dev：游戏开发模式）。
 *
 * 契约：docs/24-游戏开发模式预设契约.md §7（CLI 冻结）。
 *
 * 用法：
 *   node scripts/apply-preset.mjs --department <部门 id 或编号> --preset <预设 id> [选项]
 *   node scripts/apply-preset.mjs --department <部门 id 或编号> --clear [选项]
 *
 * 选项：
 *   --data-dir <dir>  数据目录；缺省 %DSH_HOME%/storages/member-manager
 *                     （DSH_HOME 未设置时用 ~/.dsh）
 *   --clear           清除该部门已套用的预设
 *   --dry-run         只解析不写盘（apply 时打印将要套用的预设对象）
 *   --json            单行 JSON 输出 {ok,departmentId,departmentCode,preset}
 *   -h, --help        打印帮助
 *
 * 退出码：
 *   0 成功 / 2 部门不存在、预设未知或参数缺失 / 1 其它失败
 *
 * 说明：本脚本是 Lead 手动验证与面板之外唯一的写入口，不依赖 DSH 运行时；
 * 所有写操作都走 CompanyStore 的单实例锁，写入 company.json + audit.jsonl。
 */

import os from "node:os";
import path from "node:path";

import { CompanyStore } from "../src/shared/company-store.mjs";
import { applyPresetToDepartment, clearPresetFromDepartment, getPreset, validatePresetRef } from "../src/shared/company-presets.mjs";

function parseArgs(argv) {
  const out = { json: false, dryRun: false, clear: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") out.json = true;
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--clear") out.clear = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg.startsWith("--department=")) out.department = arg.slice("--department=".length);
    else if (arg === "--department") out.department = argv[++i];
    else if (arg.startsWith("--preset=")) out.preset = arg.slice("--preset=".length);
    else if (arg === "--preset") out.preset = argv[++i];
    else if (arg.startsWith("--data-dir=")) out.dataDir = arg.slice("--data-dir=".length);
    else if (arg === "--data-dir") out.dataDir = argv[++i];
    else if (arg.startsWith("-")) out.unexpected = arg;
    else out.unexpected = arg;
  }
  return out;
}

function defaultDataDir() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
  return path.join(home, "storages", "member-manager");
}

function printHelp() {
  process.stdout.write(
    [
      "用法：node scripts/apply-preset.mjs --department <部门 id 或编号> [--preset <预设 id> | --clear] [选项]",
      "",
      "选项：",
      "  --department <id|code>  部门 id 或部门编号（如 D04），必填",
      "  --preset <id>           预设 id（当前仅 game-dev），apply 用",
      "  --clear                 清除该部门已套用的预设",
      "  --data-dir <dir>        数据目录，缺省 %DSH_HOME%/storages/member-manager",
      "  --dry-run               只解析不写盘",
      "  --json                  单行 JSON 输出 {ok,departmentId,departmentCode,preset}",
      "  -h, --help              打印本帮助",
      "",
    ].join("\n"),
  );
}

function printJson(value) {
  process.stdout.write(JSON.stringify(value) + "\n");
}

function printPretty(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function fail(message, { json } = {}) {
  process.stderr.write(`${message}\n`);
  if (json) printJson({ ok: false, message });
  process.exitCode = 2;
}

/** 按部门 id 精确匹配，或按编号大小写不敏感匹配。 */
function findDepartment(company, input) {
  const departments = Array.isArray(company?.departments) ? company.departments : [];
  const byId = departments.find((d) => d && d.id === input);
  if (byId) return byId;
  const needle = String(input).trim().toLowerCase();
  return departments.find((d) => d && typeof d.code === "string" && d.code.toLowerCase() === needle) ?? null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.department || String(args.department).trim() === "") {
    fail("缺少 --department <部门 id 或编号>", { json: args.json });
    return;
  }
  if (!args.clear && (!args.preset || String(args.preset).trim() === "")) {
    fail("缺少 --preset <预设 id>（或使用 --clear 清除）", { json: args.json });
    return;
  }
  if (args.clear && args.preset) {
    fail("--clear 与 --preset 不能同时使用", { json: args.json });
    return;
  }
  const dataDir = args.dataDir ? path.resolve(args.dataDir) : defaultDataDir();
  const store = new CompanyStore(dataDir);

  // 预设先本地校验：未知 id 直接按契约退出码 2 报错，不碰磁盘。
  let presetId = null;
  if (args.preset) {
    const checked = validatePresetRef(args.preset);
    if (!checked.ok) {
      process.stderr.write(`${checked.code === "E_UNKNOWN_PRESET" ? `未知预设: ${args.preset}` : checked.message}\n`);
      if (args.json) printJson({ ok: false, code: checked.code, message: checked.message });
      process.exitCode = 2;
      return;
    }
    presetId = checked.preset.id;
  }

  const loaded = await store.load();
  const company = loaded.company;
  const department = findDepartment(company, args.department);
  if (!department) {
    fail(`部门不存在: ${args.department}`, { json: args.json });
    return;
  }

  if (args.dryRun) {
    const payload = args.clear
      ? { ok: true, dryRun: true, departmentId: department.id, departmentCode: department.code ?? null, preset: null }
      : {
          ok: true,
          dryRun: true,
          departmentId: department.id,
          departmentCode: department.code ?? null,
          preset: getPreset(presetId),
        };
    if (args.json) printJson(payload);
    else printPretty(args.clear ? payload : payload.preset);
    return;
  }

  const result = await store.withLock(async () => {
    const fresh = await store.load();
    const current = fresh.company;
    const target = findDepartment(current, args.department);
    if (!target) return { error: `部门不存在: ${args.department}` };
    const next = args.clear
      ? clearPresetFromDepartment(current, target.id)
      : applyPresetToDepartment(current, target.id, presetId, { appliedBy: "cli" });
    await store.saveCompany(next);
    const saved = next.departments.find((d) => d.id === target.id);
    await store.appendAudit(
      args.clear
        ? { type: "department.preset.cleared", departmentId: target.id, presetId: saved?.preset?.id ?? null, source: "cli" }
        : { type: "department.preset.applied", departmentId: target.id, presetId: saved?.preset?.id, version: saved?.preset?.version, source: "cli" },
    );
    return { departmentId: target.id, departmentCode: saved?.code ?? null, preset: saved?.preset ?? null };
  });

  if (result.error) {
    fail(result.error, { json: args.json });
    return;
  }
  const payload = { ok: true, departmentId: result.departmentId, departmentCode: result.departmentCode, preset: result.preset };
  if (args.json) printJson(payload);
  else {
    process.stdout.write(
      args.clear
        ? `已清除部门 ${result.departmentCode ?? result.departmentId}（${result.departmentId}）的流程预设\n`
        : `已为部门 ${result.departmentCode ?? result.departmentId}（${result.departmentId}）套用预设「${result.preset?.id}」v${result.preset?.version}\n`,
    );
  }
}

main().catch((err) => {
  process.stderr.write(`apply-preset 失败: ${err?.message || String(err)}\n`);
  process.exitCode = 1;
});
