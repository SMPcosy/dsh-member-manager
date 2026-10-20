#!/usr/bin/env node
/**
 * apply-pending.mjs —— 在 DSH **已退出** 的前提下，把 staged 更新应用到安装目录。
 *
 * 为什么需要这个脚本：
 *   事故报告（2026-10-19）的结论是「运行中替换插件目录不安全」。Web 面板跑在 DSH 进程里，
 *   所以面板只能 stage，不能 apply。真正替换必须由用户在一个独立进程里、确认 DSH 已退出后执行。
 *
 * 用法：
 *   node scripts/apply-pending.mjs --data-dir "<dataDir>" --install-dir "<installDir>" --yes
 *
 * 缺省值：
 *   --data-dir     %USERPROFILE%\.dsh\storages\member-manager
 *   --install-dir  自动探测 %DSH_HOME%\profiles\*\node_modules\dsh-plugin-member-manager
 *
 * 退出码：
 *   0 成功 / 2 需要 --yes 确认 / 1 失败（含 JUNCTION_INSTALL 等闸门）
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PACKAGE_NAME, applyPending, readPending } from "../src/host/updater.mjs";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const out = { yes: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--yes" || a === "-y") out.yes = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a.startsWith("--data-dir=")) out.dataDir = a.slice("--data-dir=".length);
    else if (a === "--data-dir") out.dataDir = argv[++i];
    else if (a.startsWith("--install-dir=")) out.installDir = a.slice("--install-dir=".length);
    else if (a === "--install-dir") out.installDir = argv[++i];
    else if (a.startsWith("--package-name=")) out.packageName = a.slice("--package-name=".length);
    else if (a === "--package-name") out.packageName = argv[++i];
    else if (!a.startsWith("-")) out.unexpected = a;
  }
  return out;
}

function defaultDataDir() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
  return path.join(home, "storages", "member-manager");
}

function detectInstallDir(packageName) {
  const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
  const profiles = path.join(home, "profiles");
  try {
    if (!fs.existsSync(profiles)) return null;
    for (const entry of fs.readdirSync(profiles, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(profiles, entry.name, "node_modules", packageName);
      if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    }
  } catch {
    /* 探测失败由调用方报错 */
  }
  return null;
}

function printHelp() {
  process.stdout.write(
    [
      "用法：node scripts/apply-pending.mjs [选项]",
      "",
      "  --data-dir <dir>      数据目录（默认 %USERPROFILE%\\.dsh\\storages\\member-manager）",
      "  --install-dir <dir>   插件安装目录（默认自动探测 profiles/*/node_modules/<pkg>）",
      "  --package-name <name> 包名（默认 dsh-plugin-member-manager）",
      "  --yes                 确认已退出 DSH 并执行应用",
      "",
      "安全闸门：junction/link 安装、包名不符、staged 内容非法都会被拒绝，且不改动任何文件。",
    ].join("\n") + "\n",
  );
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}
if (args.unexpected) {
  process.stderr.write(`未知参数：${args.unexpected}\n\n`);
  printHelp();
  process.exit(1);
}

const packageName = args.packageName || PACKAGE_NAME;
const dataDir = path.resolve(args.dataDir || defaultDataDir());
const installDir = args.installDir ? path.resolve(args.installDir) : detectInstallDir(packageName);

if (!installDir) {
  process.stderr.write("找不到插件安装目录，请用 --install-dir 指定。\n");
  process.exit(1);
}

let pending = null;
let readWarnings = [];
try {
  const read = readPending(dataDir);
  pending = read && read.ok ? read.pending ?? null : null;
  readWarnings = (read && read.warnings) || [];
} catch (err) {
  process.stderr.write(`读取 pending 失败：${err?.message || String(err)}
`);
}

process.stdout.write(
  JSON.stringify(
    {
      note: "此脚本必须在 DSH 已退出后运行；它不会启动/重启 DSH。",
      packageName,
      dataDir,
      installDir,
      pending: pending ? { version: pending.version, createdAt: pending.createdAt, dir: pending.dir } : null,
      warnings: readWarnings,
      confirmed: args.yes,
    },
    null,
    2,
  ) + "\n",
);

if (!pending) {
  process.stderr.write("\n没有待应用的更新（pending 为空）。请先在面板「维护 → 暂存更新」或调用 member_update {action:\"stage\"}。\n");
  process.exit(1);
}

if (!args.yes) {
  process.stdout.write("\n这是预览。确认 DSH 已完全退出后，加 --yes 重新运行以真正应用。\n");
  process.exit(2);
}

const result = await applyPending({ dataDir, installDir });
process.stdout.write("\n" + JSON.stringify(result, null, 2) + "\n");

if (result && result.ok) {
  process.stdout.write("\n应用完成。现在可以启动 DSH（新版本会在下次启动时加载）。\n");
  process.exit(0);
}

process.stderr.write("\n应用失败：见上面的 code/message。未完成的替换会自动回滚。\n");
process.exit(1);
