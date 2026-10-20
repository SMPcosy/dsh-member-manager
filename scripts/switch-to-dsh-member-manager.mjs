#!/usr/bin/env node
/**
 * switch-to-dsh-member-manager.mjs —— 把 live profile 从旧插件名切到 dsh-member-manager
 *
 * 用法：
 *   node scripts/switch-to-dsh-member-manager.mjs            # dry-run（默认，只打印计划）
 *   node scripts/switch-to-dsh-member-manager.mjs --apply    # 真正写入 profile
 *   可选：--home <DSH_HOME>  --profile <name>  --target <插件目录>
 *
 * 做的事（--apply 时先备份 package.json / cordis.yml 到 <home>/backups/）：
 *   1. profile package.json：dependencies 删旧名、加 `dsh-member-manager: link:<target>`；
 *      dsh.profile.bundles 里旧名替换为新名。
 *   2. profile cordis.yml：把旧包名替换为新包名（只影响插件挂载条目）。
 *   3. profile node_modules：移除旧名符号链接、建立新名 → target 的链接。
 * 完成后需重启 DSH 才会加载新插件。
 *
 * 只改 profile 三处，不碰仓库、不碰 ~/.dsh/storages 数据目录。
 */

import { readFileSync, writeFileSync, existsSync, lstatSync, rmSync, symlinkSync, mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const OLD_NAME = "dsh-plugin-member-manager";
const NEW_NAME = "dsh-member-manager";

const argv = process.argv.slice(2);
function opt(name, fallback) {
  const i = argv.indexOf(name);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  return fallback;
}
const APPLY = argv.includes("--apply");
const HOME = path.resolve(opt("--home", process.env.DSH_HOME || path.join(os.homedir(), ".dsh")));
const PROFILE = opt("--profile", "desktop");
const TARGET = path.resolve(opt("--target", REPO));
const PROFILE_DIR = path.join(HOME, "profiles", PROFILE);
const PKG_PATH = path.join(PROFILE_DIR, "package.json");
const CORDIS_PATH = path.join(PROFILE_DIR, "cordis.yml");
const NODE_MODULES = path.join(PROFILE_DIR, "node_modules");
const TS = new Date().toISOString().replace(/[:.]/g, "-");
const BACKUP_DIR = path.join(HOME, "backups", `dsh-member-manager-switch-${TS}`);

function fail(msg) {
  console.error(`错误：${msg}`);
  process.exit(1);
}
function linkSpec(dir) {
  return `link:${dir.replace(/\\/g, "/")}`;
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

if (!existsSync(PKG_PATH)) fail(`找不到 profile：${PKG_PATH}（可用 --home/--profile 指定）`);
if (!existsSync(TARGET) || !existsSync(path.join(TARGET, "package.json"))) fail(`target 不是插件目录：${TARGET}`);

const pkgRaw = readFileSync(PKG_PATH, "utf8");
const pkg = JSON.parse(pkgRaw);
pkg.dependencies = pkg.dependencies || {};
pkg.dsh = pkg.dsh || {};
pkg.dsh.profile = pkg.dsh.profile || {};
const oldSpec = pkg.dependencies[OLD_NAME];
const cordisRaw = existsSync(CORDIS_PATH) ? readFileSync(CORDIS_PATH, "utf8") : null;

// 计算计划（纯内存，不写盘）
pkg.dependencies[NEW_NAME] = linkSpec(TARGET);
if (oldSpec !== undefined) delete pkg.dependencies[OLD_NAME];
const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : [];
const nextBundles = bundles.map((b) => (b === OLD_NAME ? NEW_NAME : b));
if (!nextBundles.includes(NEW_NAME)) nextBundles.push(NEW_NAME);
pkg.dsh.profile.bundles = nextBundles;
const nextCordis = cordisRaw == null ? null : cordisRaw.split(OLD_NAME).join(NEW_NAME);
const targetLink = path.join(NODE_MODULES, NEW_NAME);

const plan = [];
plan.push(`[profile] ${PKG_PATH}`);
plan.push(`  dependencies[${OLD_NAME}]${oldSpec === undefined ? "（不存在，跳过）" : `: ${oldSpec} → 删除`}`);
plan.push(`  dependencies[${NEW_NAME}] = ${linkSpec(TARGET)}`);
plan.push(`  bundles: ${JSON.stringify(bundles)} → ${JSON.stringify(nextBundles)}`);
plan.push(`[cordis] ${CORDIS_PATH}${cordisRaw == null ? "（不存在，跳过）" : "：旧名 → 新名"}`);
plan.push(`[link] ${targetLink} → ${TARGET}`);
if (existsLinkOrDir(targetLink)) plan.push(`  已存在同名链接/目录：${targetLink}（将移除后重建）`);
const oldLink = path.join(NODE_MODULES, OLD_NAME);
if (existsLinkOrDir(oldLink)) plan.push(`[link] 移除旧名链接：${oldLink}`);

console.log(`== ${APPLY ? "APPLY" : "DRY-RUN"}：live profile 切换到 ${NEW_NAME} ==`);
for (const line of plan) console.log(line);

if (!APPLY) {
  console.log("\n未写入任何文件（dry-run）。确认无误后加 --apply 执行；完成后重启 DSH。");
  process.exit(0);
}

// 备份 → 写入
mkdirSync(BACKUP_DIR, { recursive: true });
copyFileSync(PKG_PATH, path.join(BACKUP_DIR, "package.json"));
if (cordisRaw != null) copyFileSync(CORDIS_PATH, path.join(BACKUP_DIR, "cordis.yml"));
writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
if (nextCordis != null) writeFileSync(CORDIS_PATH, nextCordis, "utf8");
mkdirSync(NODE_MODULES, { recursive: true });
if (existsLinkOrDir(targetLink)) rmSync(targetLink, { recursive: true, force: true });
try {
  symlinkSync(TARGET, targetLink, "junction");
} catch (err) {
  console.log(`警告：符号链接创建失败（${err.message}）。请手工执行：mklink /J "${targetLink}" "${TARGET}"`);
}
if (existsLinkOrDir(oldLink)) rmSync(oldLink, { recursive: true, force: true });

console.log(`\n已写入。备份在：${BACKUP_DIR}`);
console.log("下一步：重启 DSH（或重新加载 profile）后生效；启动后确认 /api/dsh-member-manager/health 返回 ok。");
console.log(`回滚：node scripts/rollback-to-dsh-plugin-member-manager.mjs --apply --home "${HOME}" --profile ${PROFILE}`);
