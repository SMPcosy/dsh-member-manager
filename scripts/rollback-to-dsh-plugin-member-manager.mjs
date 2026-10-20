#!/usr/bin/env node
/**
 * rollback-to-dsh-plugin-member-manager.mjs —— 把 live profile 从 dsh-member-manager 回滚到旧插件名
 *
 * 用法：
 *   node scripts/rollback-to-dsh-plugin-member-manager.mjs            # dry-run（默认）
 *   node scripts/rollback-to-dsh-plugin-member-manager.mjs --apply    # 真正写入 profile
 *   可选：--home <DSH_HOME>  --profile <name>  --old-target <旧插件目录>
 *
 * 做的事（--apply 时先备份到 <home>/backups/）：
 *   1. profile package.json：dependencies 删新名、恢复 `dsh-plugin-member-manager: link:<old-target>`；
 *      bundles 里新名替换回旧名。
 *   2. cordis.yml：新包名替换回旧包名。
 *   3. node_modules：移除新名链接、重建旧名 → old-target 链接。
 * 旧插件目录默认取 default-workspace 下的原仓库；可用 --old-target 指定。
 */

import { readFileSync, writeFileSync, existsSync, lstatSync, rmSync, symlinkSync, mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const OLD_NAME = "dsh-plugin-member-manager";
const NEW_NAME = "dsh-member-manager";
const DEFAULT_OLD_TARGET = path.join(os.homedir(), "Documents", "deepseek-harness", "default-workspace", OLD_NAME);

const argv = process.argv.slice(2);
function opt(name, fallback) {
  const i = argv.indexOf(name);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  return fallback;
}
const APPLY = argv.includes("--apply");
const HOME = path.resolve(opt("--home", process.env.DSH_HOME || path.join(os.homedir(), ".dsh")));
const PROFILE = opt("--profile", "desktop");
const OLD_TARGET = path.resolve(opt("--old-target", DEFAULT_OLD_TARGET));
const PROFILE_DIR = path.join(HOME, "profiles", PROFILE);
const PKG_PATH = path.join(PROFILE_DIR, "package.json");
const CORDIS_PATH = path.join(PROFILE_DIR, "cordis.yml");
const NODE_MODULES = path.join(PROFILE_DIR, "node_modules");
const TS = new Date().toISOString().replace(/[:.]/g, "-");
const BACKUP_DIR = path.join(HOME, "backups", `dsh-member-manager-rollback-${TS}`);

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

const pkgRaw = readFileSync(PKG_PATH, "utf8");
const pkg = JSON.parse(pkgRaw);
pkg.dependencies = pkg.dependencies || {};
pkg.dsh = pkg.dsh || {};
pkg.dsh.profile = pkg.dsh.profile || {};
const cordisRaw = existsSync(CORDIS_PATH) ? readFileSync(CORDIS_PATH, "utf8") : null;

pkg.dependencies[OLD_NAME] = linkSpec(OLD_TARGET);
delete pkg.dependencies[NEW_NAME];
const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : [];
const nextBundles = bundles.map((b) => (b === NEW_NAME ? OLD_NAME : b));
if (!nextBundles.includes(OLD_NAME)) nextBundles.push(OLD_NAME);
pkg.dsh.profile.bundles = nextBundles;
const nextCordis = cordisRaw == null ? null : nextCordisReplace(cordisRaw);
function nextCordisReplace(text) {
  return text.split(NEW_NAME).join(OLD_NAME);
}
const oldLink = path.join(NODE_MODULES, OLD_NAME);
const newLink = path.join(NODE_MODULES, NEW_NAME);

const plan = [];
plan.push(`[profile] ${PKG_PATH}`);
plan.push(`  dependencies[${NEW_NAME}] → 删除`);
plan.push(`  dependencies[${OLD_NAME}] = ${linkSpec(OLD_TARGET)}（目录${existsSync(OLD_TARGET) ? "存在" : "不存在，请确认 --old-target"}）`);
plan.push(`  bundles: ${JSON.stringify(bundles)} → ${JSON.stringify(nextBundles)}`);
plan.push(`[cordis] ${CORDIS_PATH}${cordisRaw == null ? "（不存在，跳过）" : "：新名 → 旧名"}`);
plan.push(`[link] ${oldLink} → ${OLD_TARGET}`);
if (existsLinkOrDir(newLink)) plan.push(`[link] 移除新名链接：${newLink}`);

console.log(`== ${APPLY ? "APPLY" : "DRY-RUN"}：live profile 回滚到 ${OLD_NAME} ==`);
for (const line of plan) console.log(line);

if (!APPLY) {
  console.log("\n未写入任何文件（dry-run）。确认无误后加 --apply 执行；完成后重启 DSH。");
  process.exit(0);
}

mkdirSync(BACKUP_DIR, { recursive: true });
copyFileSync(PKG_PATH, path.join(BACKUP_DIR, "package.json"));
if (cordisRaw != null) copyFileSync(CORDIS_PATH, path.join(BACKUP_DIR, "cordis.yml"));
writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
if (nextCordis != null) writeFileSync(CORDIS_PATH, nextCordis, "utf8");
mkdirSync(NODE_MODULES, { recursive: true });
if (existsLinkOrDir(oldLink)) rmSync(oldLink, { recursive: true, force: true });
try {
  symlinkSync(OLD_TARGET, oldLink, "junction");
} catch (err) {
  console.log(`警告：符号链接创建失败（${err.message}）。请手工执行：mklink /J "${oldLink}" "${OLD_TARGET}"`);
}
if (existsLinkOrDir(newLink)) rmSync(newLink, { recursive: true, force: true });

console.log(`\n已写入。备份在：${BACKUP_DIR}`);
console.log("下一步：重启 DSH 后生效。旧插件目录若缺失（git 历史/备份），先用原仓库恢复。");
console.log(`（本脚本镜像：${REPO}/scripts/switch-to-dsh-member-manager.mjs）`);
