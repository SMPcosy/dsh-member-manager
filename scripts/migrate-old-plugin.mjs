#!/usr/bin/env node
/**
 * migrate-old-plugin.mjs —— 从旧包 dsh-plugin-member-manager 一键迁到 dsh-member-manager
 *
 * 用法：
 *   node scripts/migrate-old-plugin.mjs                  # dry-run（默认，只打印计划）
 *   node scripts/migrate-old-plugin.mjs --apply          # 切换 profile + 写入数据迁移标记
 *   node scripts/migrate-old-plugin.mjs --data-only --apply   # 只写数据迁移标记（已在新包的用户）
 *   可选：--home <DSH_HOME> --profile <name> --data-dir <dir>
 *         --mode npm|link（默认 npm） --target <插件目录> --no-marker --no-uninstall
 *
 * 做的事（--apply 时先备份 profile 的 package.json / cordis.yml 到 <home>/backups/migrate-<TS>/）：
 *   1. profile package.json：dependencies 删旧名、加新名
 *        npm 模式  → "^<本包版本>"
 *        link 模式 → "link:<target>"
 *      dsh.profile.bundles 里旧名替换为新名。
 *   2. profile cordis.yml：旧包名替换为新包名（只影响插件挂载条目）。
 *   3. profile node_modules：删除旧名目录/链接（--no-uninstall 可跳过）。
 *   4. 写 <data-dir>/pending-migration.json：新插件首次 boot 自动执行
 *        syncRoster（小组→部门、active 成员→员工）+ importRosterProfiles（岗位/职责/技能/模型补空）。
 * 完成后重启 DSH 才会加载新插件并消费迁移标记。
 *
 * 只改 profile 三处 + 写一个迁移标记；不改 registry.json，不改公司化数据。
 */

import { readFileSync, writeFileSync, existsSync, lstatSync, rmSync, unlinkSync, mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const OLD_NAME = "dsh-plugin-member-manager";
const NEW_NAME = "dsh-member-manager";
const MARKER_FILE = "pending-migration.json";

const argv = process.argv.slice(2);
function opt(name, fallback) {
  const i = argv.indexOf(name);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  return fallback;
}
const APPLY = argv.includes("--apply");
const DATA_ONLY = argv.includes("--data-only");
const NO_MARKER = argv.includes("--no-marker");
const NO_UNINSTALL = argv.includes("--no-uninstall");
const MODE = opt("--mode", "npm");
const HOME = path.resolve(opt("--home", process.env.DSH_HOME || path.join(os.homedir(), ".dsh")));
const PROFILE = opt("--profile", "desktop");
const PROFILE_DIR = path.join(HOME, "profiles", PROFILE);
const PKG_PATH = path.join(PROFILE_DIR, "package.json");
const CORDIS_PATH = path.join(PROFILE_DIR, "cordis.yml");
const NODE_MODULES = path.join(PROFILE_DIR, "node_modules");
const DATA_DIR = path.resolve(opt("--data-dir", path.join(HOME, "storages", "member-manager")));
const TARGET = path.resolve(opt("--target", REPO));
const TS = new Date().toISOString().replace(/[:.]/g, "-");
const BACKUP_DIR = path.join(HOME, "backups", `migrate-${TS}`);

function fail(msg) {
  console.error(`错误：${msg}`);
  process.exit(1);
}
function isSymlink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}
function existsLinkOrDir(p) {
  return existsSync(p) || isSymlink(p);
}
function removePath(p) {
  try {
    if (isSymlink(p)) unlinkSync(p);
    else rmSync(p, { recursive: true, force: true });
  } catch (err) {
    console.log(`警告：删除 ${p} 失败（${err.message}），请手工删除`);
  }
}
function linkSpec(dir) {
  return `link:${dir.replace(/\\/g, "/")}`;
}

if (MODE !== "npm" && MODE !== "link") fail(`--mode 只能是 npm 或 link（收到：${MODE}）`);

let ownPkg = {};
try {
  ownPkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"));
} catch (err) {
  fail(`读取本包 package.json 失败：${err.message}`);
}
const ownVersion = String(ownPkg.version || "0.3.0");
if (MODE === "link" && (!existsSync(TARGET) || !existsSync(path.join(TARGET, "package.json")))) {
  fail(`--mode link 的 --target 不是插件目录：${TARGET}`);
}

// ---- 读 profile（data-only 模式不需要） ----
let pkg = null;
let cordisRaw = null;
let oldSpec;
let bundles = [];
if (!DATA_ONLY) {
  if (!existsSync(PKG_PATH)) fail(`找不到 profile：${PKG_PATH}（可用 --home/--profile 指定，或加 --data-only）`);
  pkg = JSON.parse(readFileSync(PKG_PATH, "utf8"));
  pkg.dependencies = pkg.dependencies || {};
  pkg.dsh = pkg.dsh || {};
  pkg.dsh.profile = pkg.dsh.profile || {};
  oldSpec = pkg.dependencies[OLD_NAME];
  bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : [];
  cordisRaw = existsSync(CORDIS_PATH) ? readFileSync(CORDIS_PATH, "utf8") : null;
}

// ---- 数据侧检测 ----
const registryPath = path.join(DATA_DIR, "registry.json");
const hasRegistry = existsSync(registryPath);
const markerPath = path.join(DATA_DIR, MARKER_FILE);
const markerExists = existsSync(markerPath);
let registrySummary = null;
if (hasRegistry) {
  try {
    const reg = JSON.parse(readFileSync(registryPath, "utf8"));
    registrySummary = {
      groups: Array.isArray(reg.groups) ? reg.groups.length : 0,
      members: Array.isArray(reg.members) ? reg.members.length : 0,
    };
  } catch {
    registrySummary = null;
  }
}

// ---- 纯内存计算计划 ----
const plan = [];
let changed = false;
if (!DATA_ONLY) {
  const MODE_EXPLICIT = argv.includes("--mode");
  const existingNewSpec = pkg.dependencies[NEW_NAME];
  const newSpec = existingNewSpec && !MODE_EXPLICIT ? existingNewSpec : (MODE === "npm" ? `^${ownVersion}` : linkSpec(TARGET));
  plan.push(`[profile] ${PKG_PATH}`);
  plan.push(`  dependencies[${OLD_NAME}]${oldSpec === undefined ? "（不存在，跳过）" : `: ${oldSpec} → 删除`}`);
  plan.push(`  dependencies[${NEW_NAME}] = ${newSpec}${existingNewSpec && !MODE_EXPLICIT ? "（已存在，保持）" : ""}`);
  changed = changed || oldSpec !== undefined || pkg.dependencies[NEW_NAME] !== newSpec;
  pkg.dependencies = { ...pkg.dependencies, [NEW_NAME]: newSpec };
  delete pkg.dependencies[OLD_NAME];
  const nextBundles = bundles.map((b) => (b === OLD_NAME ? NEW_NAME : b)).filter((b, i, arr) => arr.indexOf(b) === i);
  if (!nextBundles.includes(NEW_NAME)) nextBundles.push(NEW_NAME);
  plan.push(`  bundles: ${JSON.stringify(bundles)} → ${JSON.stringify(nextBundles)}`);
  pkg.dsh.profile.bundles = nextBundles;
  changed = changed || JSON.stringify(bundles) !== JSON.stringify(nextBundles);
  const cordisReplacements = cordisRaw == null ? 0 : cordisRaw.split(OLD_NAME).length - 1;
  plan.push(`[cordis] ${CORDIS_PATH}${cordisRaw == null ? "（不存在，跳过）" : `：替换 ${cordisReplacements} 处旧名`}`);
  changed = changed || cordisReplacements > 0;
  const oldLink = path.join(NODE_MODULES, OLD_NAME);
  if (NO_UNINSTALL) {
    plan.push(`[uninstall] 跳过（--no-uninstall）：${oldLink}`);
  } else if (existsLinkOrDir(oldLink)) {
    plan.push(`[uninstall] 删除旧包目录/链接：${oldLink}`);
    changed = true;
  } else {
    plan.push(`[uninstall] 旧包目录/链接不存在（跳过）：${oldLink}`);
  }
}
if (NO_MARKER) {
  plan.push(`[data] 跳过数据迁移标记（--no-marker）`);
} else if (markerExists) {
  plan.push(`[data] 已存在迁移标记，保留：${markerPath}`);
} else {
  plan.push(`[data] 写入迁移标记：${markerPath}`);
  plan.push(`  boot 时自动执行 syncRoster + importRosterProfiles（registry.json：${hasRegistry ? `${registrySummary?.groups ?? "?"} 组 / ${registrySummary?.members ?? "?"} 名成员` : "不存在，将跳过"}）`);
  changed = true;
}

console.log(`== ${APPLY ? "APPLY" : "DRY-RUN"}：旧包 → ${NEW_NAME} 一键迁移（mode=${MODE}${DATA_ONLY ? "，data-only" : ""}）==`);
for (const line of plan) console.log(line);
if (!changed) {
  console.log("\n未发现需要变更的内容。");
}
if (!APPLY) {
  console.log("\n未写入任何文件（dry-run）。确认无误后加 --apply 执行；完成后重启 DSH。");
  process.exit(0);
}

// ---- 备份并写入 ----
if (!DATA_ONLY) {
  mkdirSync(BACKUP_DIR, { recursive: true });
  copyFileSync(PKG_PATH, path.join(BACKUP_DIR, "package.json"));
  if (cordisRaw != null) copyFileSync(CORDIS_PATH, path.join(BACKUP_DIR, "cordis.yml"));
  writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  if (cordisRaw != null) writeFileSync(CORDIS_PATH, cordisRaw.split(OLD_NAME).join(NEW_NAME), "utf8");
  const oldLink = path.join(NODE_MODULES, OLD_NAME);
  if (!NO_UNINSTALL && existsLinkOrDir(oldLink)) removePath(oldLink);
  console.log(`\nprofile 已写入。备份在：${BACKUP_DIR}`);
}

if (!NO_MARKER && !markerExists) {
  mkdirSync(DATA_DIR, { recursive: true });
  const marker = {
    version: 1,
    source: "migrate-old-plugin",
    requestedAt: new Date().toISOString(),
    mode: DATA_ONLY ? "data-only" : MODE,
    pluginVersion: ownVersion,
    attempts: 0,
  };
  writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
  console.log(`数据迁移标记已写入：${markerPath}`);
}

console.log("\n下一步：重启 DSH。启动时新插件会：");
console.log("  - 消费 pending-migration.json（小组→部门、active 成员→员工、岗位/职责/技能/模型补空）");
console.log("  - 完成后删除标记，并在 audit.jsonl 记录 company.migration_started/completed");
console.log("  - 启动后确认 /api/dsh-member-manager/health 返回 ok");
console.log(`回滚：node scripts/rollback-to-dsh-plugin-member-manager.mjs --apply --home "${HOME}" --profile ${PROFILE}`);
