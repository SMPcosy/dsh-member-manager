/**
 * 插件自更新基础设施（宿主端，纯 node: 内置模块，无第三方依赖）。
 *
 * 背景（2026-10-19 事故）：在 Windows 上用 `link:` 安装插件时，node_modules 下留下
 * junction（reparse point）；pnpm 的 `rename(tmp → node_modules/<name>)` 对 reparse
 * point 返回 ERR_PNPM_EPERM；同时 host 插件文件在运行中被替换也不安全。
 *
 * 因此更新流程被拆成四段，任何一段失败都不破坏现有安装：
 *   1) checkLatest   只读查询 registry，判断是否有新版本
 *   2) stageUpdate   下载 tarball → 校验完整性 → 解包到 <dataDir>/updates/<version>/
 *                    → 写 pending.json（此时还没碰安装目录）
 *   3) 用户确认后 applyPending：先备份旧文件，再逐文件覆盖；失败则用备份回滚
 *   4) rollbackLast  兜底：按 last-apply.json 把上一次应用的文件还原
 *
 * 设计约定：
 *  - 所有导出函数都不抛异常，统一返回 `{ ok, ... }`；网络/解析/IO 错误放在
 *    `code` + `message` 里（个别函数额外带 `warnings`）。
 *  - 网络请求必须注入 `fetchImpl`（测试不得真的联网）。
 *  - junction / symlink 安装一律拒绝，给出人工步骤（见 JUNCTION_INSTALL）。
 *  - tar 解析器只覆盖 npm 包实际用到的子集：见 readNpmTarball 的注释。
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export const PACKAGE_NAME = "dsh-plugin-member-manager";
export const REGISTRY_URL = "https://registry.npmjs.org/";
export const DEFAULT_TIMEOUT_MS = 8000;
export const DEFAULT_STAGE_TIMEOUT_MS = 30000;
export const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

const ACCEPT_INSTALL_V1 = "application/vnd.npm.install-v1+json";
const UPDATES_DIRNAME = "updates";
const PENDING_FILENAME = "pending.json";
const LAST_APPLY_FILENAME = "last-apply.json";
const BACKUPS_DIRNAME = "backups";
/** 备份/复制时跳过的顶层目录与文件后缀（node_modules 体积大且由包管理器维护） */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist"]);
const SKIP_FILE_SUFFIXES = [".tgz"];
/** 版本号目录名只允许这些字符，防止 meta.latest 被用来做目录穿越 */
const SAFE_VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/;

export class UpdateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "UpdateError";
    this.code = code;
  }
}

/* ------------------------------------------------------------------------- */
/* 版本比较                                                                    */
/* ------------------------------------------------------------------------- */

/**
 * 解析 semver 字符串。非法输入返回 null（调用方按 0.0.0 处理，避免抛错）。
 * 支持：v 前缀、段数不足补 0、预发布段、build 元数据（忽略）。
 * @param {unknown} input
 * @returns {{core: number[], pre: (string|number)[]} | null}
 */
function parseVersion(input) {
  if (typeof input !== "string") return null;
  let text = input.trim();
  if (text.startsWith("v") || text.startsWith("V")) text = text.slice(1);
  if (text.startsWith("=")) text = text.slice(1).trim();
  if (!text) return null;
  // 去掉 build metadata（+ 之后的部分）
  const plus = text.indexOf("+");
  if (plus !== -1) text = text.slice(0, plus);
  let coreText = text;
  let preText = "";
  const dash = text.indexOf("-");
  if (dash !== -1) {
    coreText = text.slice(0, dash);
    preText = text.slice(dash + 1);
  }
  if (!/^\d+(\.\d+)*$/.test(coreText)) return null;
  const core = coreText.split(".").map((part) => Number.parseInt(part, 10));
  while (core.length < 3) core.push(0);
  const pre = preText ? preText.split(".").map((id) => (/^\d+$/.test(id) ? Number.parseInt(id, 10) : id)) : [];
  return { core, pre };
}

/** semver 预发布段比较：数字段按数值、数字 < 字母、字母按 ASCII。 */
function comparePrerelease(a, b) {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1; // 有预发布 < 无预发布
  if (b.length === 0) return -1;
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    const left = a[i];
    const right = b[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftNumeric = typeof left === "number";
    const rightNumeric = typeof right === "number";
    if (leftNumeric && rightNumeric) {
      if (left !== right) return left < right ? -1 : 1;
      continue;
    }
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

/**
 * 按 semver 规则比较两个版本号。
 * 支持 0.2.0、1.0.0-beta.1、v1.2、1.0、段数不等；预发布按 semver 排序
 * （1.0.0-beta < 1.0.0）。无法解析的一侧按 0.0.0 处理（本函数不抛异常）。
 * @param {unknown} a
 * @param {unknown} b
 * @returns {-1|0|1}
 */
export function compareVersions(a, b) {
  const left = parseVersion(a) ?? { core: [0, 0, 0], pre: [] };
  const right = parseVersion(b) ?? { core: [0, 0, 0], pre: [] };
  const max = Math.max(left.core.length, right.core.length);
  for (let i = 0; i < max; i += 1) {
    const l = left.core[i] ?? 0;
    const r = right.core[i] ?? 0;
    if (l !== r) return l < r ? -1 : 1;
  }
  return comparePrerelease(left.pre, right.pre);
}

/* ------------------------------------------------------------------------- */
/* 小工具                                                                      */
/* ------------------------------------------------------------------------- */

function toIso(now) {
  const value = typeof now === "function" ? now() : now;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

/** UTC 紧凑时间戳（Windows 文件名安全）：20261019T064308Z */
function compactUtc(now) {
  return toIso(now).replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function ensureString(value) {
  return typeof value === "string" && value.length > 0;
}

function ok(payload) {
  return { ok: true, ...payload };
}

function fail(code, message, extra = {}) {
  return { ok: false, code, message, ...extra };
}

function normalizeRegistryUrl(registryUrl) {
  const url = ensureString(registryUrl) ? registryUrl : REGISTRY_URL;
  return url.endsWith("/") ? url : `${url}/`;
}

function resolveDataDir(dataDir) {
  if (!ensureString(dataDir)) return null;
  return path.resolve(dataDir);
}

function updatesDir(dataDir) {
  return path.join(dataDir, UPDATES_DIRNAME);
}

function lastApplyPath(dataDir) {
  return path.join(updatesDir(dataDir), LAST_APPLY_FILENAME);
}

function backupsDir(dataDir) {
  return path.join(updatesDir(dataDir), BACKUPS_DIRNAME);
}

async function readResponseText(res) {
  if (res && typeof res.text === "function") return await res.text();
  if (res && typeof res.json === "function") return JSON.stringify(await res.json());
  return null;
}

async function readResponseBuffer(res) {
  if (res && typeof res.arrayBuffer === "function") {
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }
  if (res && typeof res.buffer === "function") {
    const buf = await res.buffer();
    return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  }
  throw new UpdateError("BAD_RESPONSE", "下载响应没有 arrayBuffer()，无法读取 tarball");
}

/**
 * 沿 installDir 及其父链查找 symbolic link / junction。
 * Windows 上 junction 的 lstat().isSymbolicLink() 为 true。
 * @returns {string|null} 命中的路径
 */
function findLinkInChain(target) {
  let current = path.resolve(target);
  for (;;) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) return current;
    } catch {
      // 路径不存在就继续往上检查，不阻断
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function fileExists(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function dirExists(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function readJsonFile(file) {
  const raw = fs.readFileSync(file, "utf8");
  return JSON.parse(raw);
}

function writeJsonFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

/** 递归列出目录下的文件（相对路径，posix 分隔符），跳过 node_modules。 */
function listFiles(root, dir = root, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      listFiles(root, path.join(dir, entry.name), out);
    } else if (entry.isFile()) {
      out.push(path.relative(root, path.join(dir, entry.name)).split(path.sep).join("/"));
    }
  }
  return out.sort();
}

/**
 * 递归复制（备份用），跳过 node_modules/.git/dist 与 *.tgz，跳过符号链接。
 * @returns {string[]} 已复制的相对路径列表
 */
function copyTree(src, dst, rel, out) {
  let stat;
  try {
    stat = fs.lstatSync(src);
  } catch {
    return out;
  }
  if (stat.isSymbolicLink()) return out; // 不跟随链接，避免备份出宿主目录外的东西
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      if (SKIP_DIRS.has(entry)) continue;
      if (SKIP_FILE_SUFFIXES.some((suffix) => entry.endsWith(suffix))) continue;
      copyTree(path.join(src, entry), path.join(dst, entry), rel ? `${rel}/${entry}` : entry, out);
    }
    return out;
  }
  if (stat.isFile()) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    out.push(rel);
  }
  return out;
}

/* ------------------------------------------------------------------------- */
/* 1) 查询最新版本                                                             */
/* ------------------------------------------------------------------------- */

/**
 * 查询 npm registry 的最新版本。
 *
 * @param {object} opts
 * @param {Function} opts.fetchImpl       必填，注入的 fetch（测试不联网）
 * @param {string} [opts.packageName]
 * @param {string} [opts.registryUrl]
 * @param {string} opts.currentVersion     当前安装版本
 * @param {number} [opts.timeoutMs]
 * @param {() => Date} [opts.now]
 * @returns {Promise<{ok:true, current:string, latest:string, updateAvailable:boolean,
 *   tarball:string|null, integrity:string|null, shasum:string|null, checkedAt:string,
 *   distTags?:Record<string,string>} | {ok:false, code:string, message:string}>}
 */
export async function checkLatest({
  fetchImpl,
  packageName = PACKAGE_NAME,
  registryUrl = REGISTRY_URL,
  currentVersion,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = () => new Date(),
} = {}) {
  if (typeof fetchImpl !== "function") {
    return fail("NO_FETCH", "checkLatest 需要注入 fetchImpl 函数（本模块不直接联网）");
  }
  if (!ensureString(packageName)) {
    return fail("INVALID_ARGUMENT", "checkLatest 需要非空 packageName");
  }
  const url = `${normalizeRegistryUrl(registryUrl)}${encodeURIComponent(packageName)}`;
  const controller = new AbortController();
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    let res;
    try {
      res = await fetchImpl(url, {
        headers: { Accept: ACCEPT_INSTALL_V1 },
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted || err?.name === "AbortError" || err?.code === "ABORT_ERR") {
        return fail("TIMEOUT", `查询 ${packageName} 超时（${timeout}ms）`);
      }
      return fail("NETWORK_ERROR", `查询 ${packageName} 失败：${err?.message || String(err)}`);
    }
    const status = Number(res?.status ?? 0);
    if (status === 404) {
      return fail("NOT_FOUND", `registry 上不存在包 ${packageName}（HTTP 404）`);
    }
    if (!res || res.ok === false || status < 200 || status >= 300) {
      return fail("HTTP_ERROR", `registry 返回 HTTP ${status || "?"}（${packageName}）`, { status });
    }
    const text = await readResponseText(res);
    if (typeof text !== "string") {
      return fail("BAD_JSON", "registry 响应无法按文本读取");
    }
    let doc;
    try {
      doc = JSON.parse(text);
    } catch (err) {
      return fail("BAD_JSON", `registry 响应不是合法 JSON：${err?.message || String(err)}`);
    }
    if (!doc || typeof doc !== "object") {
      return fail("BAD_JSON", "registry 响应不是 JSON 对象");
    }
    const distTags = doc["dist-tags"] && typeof doc["dist-tags"] === "object" ? doc["dist-tags"] : {};
    const latest = typeof distTags.latest === "string" ? distTags.latest : doc.version;
    if (!ensureString(latest)) {
      return fail("NO_LATEST", `registry 响应里没有可用的 latest 版本（${packageName}）`);
    }
    const versionDoc = doc.versions && typeof doc.versions === "object" ? doc.versions[latest] : null;
    const dist = versionDoc && typeof versionDoc.dist === "object" ? versionDoc.dist : {};
    const current = ensureString(currentVersion) ? currentVersion : null;
    const updateAvailable = current ? compareVersions(latest, current) > 0 : true;
    return ok({
      current,
      latest,
      updateAvailable,
      tarball: ensureString(dist.tarball) ? dist.tarball : null,
      integrity: ensureString(dist.integrity) ? dist.integrity : null,
      shasum: ensureString(dist.shasum) ? dist.shasum : null,
      checkedAt: toIso(now),
      distTags,
    });
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------------- */
/* 2) tar 解析                                                                 */
/* ------------------------------------------------------------------------- */

function cstr(buf, start, length) {
  const slice = buf.subarray(start, start + length);
  const nul = slice.indexOf(0);
  return (nul === -1 ? slice : slice.subarray(0, nul)).toString("utf8");
}

/** 解析 tar 的八进制 size 字段（兼容 base-256 编码）。 */
function parseOctal(buf, start, length) {
  if (buf[start] & 0x80) {
    // base-256：高位为标记，低位大端整数
    let value = 0;
    for (let i = start + 1; i < start + length; i += 1) value = value * 256 + buf[i];
    return value;
  }
  const text = cstr(buf, start, length).trim();
  if (!/^[0-7]+$/.test(text)) return null;
  return Number.parseInt(text, 8);
}

/** 解析 pax 扩展头（typeflag 'x'）：返回 key → value。 */
function parsePax(buf) {
  const out = Object.create(null);
  let pos = 0;
  while (pos < buf.length) {
    const space = buf.indexOf(0x20, pos);
    if (space === -1) break;
    const length = Number.parseInt(buf.subarray(pos, space).toString("utf8"), 10);
    if (!Number.isFinite(length) || length <= 0 || pos + length > buf.length) break;
    const record = buf.subarray(space + 1, pos + length);
    const eq = record.indexOf(0x3d);
    if (eq > 0) {
      const key = record.subarray(0, eq).toString("utf8");
      const value = record.subarray(eq + 1).toString("utf8").replace(/\n$/, "");
      out[key] = value;
    }
    pos += length;
  }
  return out;
}

function isZeroBlock(buf, offset) {
  for (let i = 0; i < 512; i += 1) {
    if (buf[offset + i] !== 0) return false;
  }
  return true;
}

/** 判断一个待落盘相对路径是否危险（绝对路径 / 目录穿越 / 盘符）。 */
function isUnsafeRelPath(rel) {
  if (!rel) return true;
  const normalized = rel.replace(/\\/g, "/");
  if (normalized.startsWith("/")) return true;
  if (/^[A-Za-z]:/.test(normalized)) return true;
  if (normalized.split("/").some((part) => part === "..")) return true;
  return false;
}

/**
 * 解析 npm tarball（.tgz）为 { files: Map<相对路径, Buffer> }。
 *
 * 自己实现 gzip + tar 读取，不依赖 tar 包。支持的 tar 子集：
 *  - 512 字节 ustar 头：name(0-100)、size(124-136, 八进制)、typeflag(156)、prefix(345-500)
 *  - typeflag '0'/'\0' 普通文件、'5' 目录（跳过）、'g' pax 全局头（跳过）
 *  - typeflag 'x' pax 扩展头（支持 path 覆盖）、'L' GNU longname
 *  - 8GiB 级 base-256 size 字段
 * 不支持：sparse 文件、长链接 'K'、多卷、以及 pax 的 size/linkpath 覆盖。
 *
 * 只保留以 "package/" 开头的条目并去掉该前缀；绝对路径、含 ".." 的路径拒绝
 * 并记入 warnings。
 *
 * @param {Buffer|Uint8Array} buffer
 * @returns {{ok:true, files:Map<string,Buffer>, warnings:string[]} |
 *   {ok:false, code:string, message:string, files:Map<string,Buffer>, warnings:string[]}}
 */
export function readNpmTarball(buffer) {
  const warnings = [];
  const files = new Map();
  try {
    if (!buffer || (typeof buffer !== "object" && typeof buffer !== "string")) {
      return fail("BAD_TARBALL", "readNpmTarball 需要 Buffer/Uint8Array", { files, warnings });
    }
    const gz = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    let tar;
    try {
      tar = zlib.gunzipSync(gz);
    } catch (err) {
      return fail("BAD_TARBALL", `gzip 解压失败：${err?.message || String(err)}`, { files, warnings });
    }
    let pos = 0;
    let pendingPax = null;
    let pendingLongName = null;
    while (pos + 512 <= tar.length) {
      if (isZeroBlock(tar, pos)) break; // 归档结束
      const size = parseOctal(tar, pos + 124, 12);
      if (size === null) {
        return fail("BAD_TARBALL", `tar 头 size 字段非法（offset ${pos}）`, { files, warnings });
      }
      const typeflag = String.fromCharCode(tar[pos + 156] || 0x30);
      const nameField = cstr(tar, pos, 100);
      const prefixField = cstr(tar, pos + 345, 155);
      const dataStart = pos + 512;
      if (dataStart + size > tar.length) {
        return fail("BAD_TARBALL", `tar 条目被截断（${nameField || "?"} 需要 ${size} 字节）`, {
          files,
          warnings,
        });
      }
      const data = tar.subarray(dataStart, dataStart + size);
      const nextPos = dataStart + Math.ceil(size / 512) * 512;

      if (typeflag === "x") {
        // pax 扩展头：作用于下一个条目
        pendingPax = parsePax(data);
        pos = nextPos;
        continue;
      }
      if (typeflag === "g") {
        // pax 全局头：忽略
        pos = nextPos;
        continue;
      }
      if (typeflag === "L") {
        // GNU longname：内容就是下一个条目的完整路径
        pendingLongName = cstr(data, 0, data.length).replace(/\0+$/, "");
        pos = nextPos;
        continue;
      }
      if (typeflag === "K") {
        // GNU longlink：本模块不使用链接，跳过内容
        pos = nextPos;
        continue;
      }

      let fullName = prefixField ? `${prefixField}/${nameField}` : nameField;
      if (pendingLongName) fullName = pendingLongName;
      if (pendingPax && typeof pendingPax.path === "string" && pendingPax.path) {
        fullName = pendingPax.path;
      }
      pendingPax = null;
      pendingLongName = null;

      if (typeflag === "5") {
        // 目录条目：只靠文件条目建目录，跳过
        pos = nextPos;
        continue;
      }
      if (typeflag !== "0" && typeflag !== "\0" && typeflag !== "7") {
        warnings.push(`忽略不支持的 tar 条目类型 '${typeflag}'：${fullName}`);
        pos = nextPos;
        continue;
      }

      const normalized = fullName.replace(/\\/g, "/").replace(/^\.\//, "");
      if (!normalized.startsWith("package/")) {
        pos = nextPos;
        continue;
      }
      const rel = normalized.slice("package/".length);
      if (isUnsafeRelPath(rel)) {
        warnings.push(`拒绝不安全路径（绝对路径或含 ".."）：${fullName}`);
        pos = nextPos;
        continue;
      }
      files.set(rel, Buffer.from(data));
      pos = nextPos;
    }
    return ok({ files, warnings });
  } catch (err) {
    return fail("BAD_TARBALL", `tar 解析异常：${err?.message || String(err)}`, { files, warnings });
  }
}

/* ------------------------------------------------------------------------- */
/* 3) 暂存更新（staging）                                                       */
/* ------------------------------------------------------------------------- */

/**
 * 下载新版本 tarball，校验完整性并解包到 <dataDir>/updates/<version>/，
 * 写 pending.json 等待用户确认。**不会碰安装目录。**
 *
 * @param {object} opts
 * @param {Function} opts.fetchImpl
 * @param {string} opts.dataDir
 * @param {string} [opts.packageName]
 * @param {object} opts.meta           checkLatest 的返回值（需要 tarball/latest/integrity）
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.maxBytes]
 * @param {() => Date} [opts.now]
 * @returns {Promise<{ok:true, version:string, dir:string, fileCount:number,
 *   integrityOk:boolean, pending:string} | {ok:false, code:string, message:string}>}
 */
export async function stageUpdate({
  fetchImpl,
  dataDir,
  packageName = PACKAGE_NAME,
  meta,
  timeoutMs = DEFAULT_STAGE_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_BYTES,
  now = () => new Date(),
} = {}) {
  const root = resolveDataDir(dataDir);
  if (!root) return fail("INVALID_ARGUMENT", "stageUpdate 需要非空 dataDir");
  if (typeof fetchImpl !== "function") {
    return fail("NO_FETCH", "stageUpdate 需要注入 fetchImpl 函数（本模块不直接联网）");
  }
  if (!meta || typeof meta !== "object") {
    return fail("INVALID_ARGUMENT", "stageUpdate 需要 checkLatest 返回的 meta 对象");
  }
  const version = typeof meta.latest === "string" ? meta.latest.trim() : "";
  if (!version || !SAFE_VERSION_RE.test(version)) {
    return fail("INVALID_VERSION", `不允许的版本号：${String(meta.latest)}`);
  }
  if (!ensureString(meta.tarball)) {
    return fail("NO_TARBALL", "meta.tarball 为空，无法下载");
  }
  const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : DEFAULT_MAX_BYTES;
  const controller = new AbortController();
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_STAGE_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeout);
  let buffer;
  try {
    let res;
    try {
      res = await fetchImpl(meta.tarball, { signal: controller.signal });
    } catch (err) {
      if (controller.signal.aborted || err?.name === "AbortError" || err?.code === "ABORT_ERR") {
        return fail("TIMEOUT", `下载 tarball 超时（${timeout}ms）：${meta.tarball}`);
      }
      return fail("NETWORK_ERROR", `下载 tarball 失败：${err?.message || String(err)}`);
    }
    const status = Number(res?.status ?? 0);
    if (!res || res.ok === false || status < 200 || status >= 300) {
      return fail("HTTP_ERROR", `下载 tarball 返回 HTTP ${status || "?"}：${meta.tarball}`, { status });
    }
    const declared = Number(res.headers?.get?.("content-length") ?? res.headers?.["content-length"] ?? 0);
    if (Number.isFinite(declared) && declared > limit) {
      return fail("TOO_LARGE", `tarball 声明大小 ${declared} 字节超过上限 ${limit}`);
    }
    try {
      buffer = await readResponseBuffer(res);
    } catch (err) {
      return fail("NETWORK_ERROR", `读取 tarball 响应失败：${err?.message || String(err)}`);
    }
  } finally {
    clearTimeout(timer);
  }
  if (buffer.length > limit) {
    return fail("TOO_LARGE", `tarball 实际大小 ${buffer.length} 字节超过上限 ${limit}`);
  }

  // 完整性：npm 的 dist.integrity 形如 "sha512-<base64>"
  let integrityOk = true;
  if (ensureString(meta.integrity)) {
    const token = String(meta.integrity)
      .trim()
      .split(/\s+/)
      .find((part) => part.startsWith("sha512-"));
    if (token) {
      const expected = token.slice("sha512-".length);
      const actual = crypto.createHash("sha512").update(buffer).digest("base64");
      integrityOk = expected === actual;
      if (!integrityOk) {
        return fail("INTEGRITY_MISMATCH", "tarball 的 sha512 与 meta.integrity 不匹配（下载内容可能被篡改）");
      }
    }
  }

  const parsed = readNpmTarball(buffer);
  if (!parsed.ok) {
    return fail(parsed.code || "BAD_TARBALL", parsed.message || "tarball 无法解析");
  }
  const { files } = parsed;
  if (files.size === 0) {
    return fail("BAD_TARBALL", "tarball 里没有 package/ 下的文件");
  }
  const pkgBuf = files.get("package.json");
  if (!pkgBuf) {
    return fail("STAGED_INVALID", "tarball 缺少 package.json");
  }
  let stagedPkg;
  try {
    stagedPkg = JSON.parse(pkgBuf.toString("utf8"));
  } catch (err) {
    return fail("STAGED_INVALID", `tarball 里的 package.json 解析失败：${err?.message || String(err)}`);
  }
  if (stagedPkg?.name !== packageName) {
    return fail("NAME_MISMATCH", `tarball 包名 ${String(stagedPkg?.name)} 与期望 ${packageName} 不符`);
  }
  if (stagedPkg?.version !== version) {
    return fail(
      "VERSION_MISMATCH",
      `tarball 内 package.json version=${String(stagedPkg?.version)} 与 meta.latest=${version} 不符`,
    );
  }

  const targetDir = path.join(updatesDir(root), version);
  const tmpDir = path.join(updatesDir(root), `.tmp-${crypto.randomBytes(6).toString("hex")}`);
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    for (const [rel, data] of files) {
      const dest = path.join(tmpDir, ...rel.split("/"));
      // 双保险：rel 已由 readNpmTarball 校验，这里再确认没有跳出 tmpDir
      if (!path.resolve(dest).startsWith(path.resolve(tmpDir) + path.sep)) {
        return fail("BAD_TARBALL", `解码路径越界：${rel}`);
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, data);
    }
    if (fs.existsSync(targetDir)) rmrf(targetDir);
    fs.renameSync(tmpDir, targetDir);
  } catch (err) {
    try {
      rmrf(tmpDir);
    } catch {
      /* 清理失败不影响返回 */
    }
    return fail("STAGE_FAILED", `写入暂存目录失败：${err?.message || String(err)}`);
  }

  const pendingFile = pendingPath(root);
  const pendingRecord = {
    version,
    dir: targetDir,
    tarball: meta.tarball,
    integrity: ensureString(meta.integrity) ? meta.integrity : null,
    createdAt: toIso(now),
    packageName,
    fileCount: files.size,
  };
  try {
    writeJsonFile(pendingFile, pendingRecord);
  } catch (err) {
    return fail("STAGE_FAILED", `写 pending.json 失败：${err?.message || String(err)}`);
  }

  return ok({
    version,
    dir: targetDir,
    fileCount: files.size,
    integrityOk,
    pending: pendingFile,
    warnings: parsed.warnings,
  });
}

/* ------------------------------------------------------------------------- */
/* pending / last-apply 读写                                                   */
/* ------------------------------------------------------------------------- */

/** pending.json 的绝对路径。 */
export function pendingPath(dataDir) {
  const root = resolveDataDir(dataDir);
  if (!root) return null;
  return path.join(updatesDir(root), PENDING_FILENAME);
}

/**
 * 读取 pending 记录。文件不存在 → {ok:true, pending:null}；
 * 损坏/结构非法 → 视为 null 并附 warning（不抛错）。
 * @param {string} dataDir
 * @returns {{ok:true, pending:object|null, warnings:string[]}}
 */
export function readPending(dataDir) {
  const warnings = [];
  const root = resolveDataDir(dataDir);
  if (!root) {
    return ok({ pending: null, warnings: ["readPending 需要非空 dataDir"] });
  }
  const file = pendingPath(root);
  if (!fs.existsSync(file)) return ok({ pending: null, warnings });
  let record;
  try {
    record = readJsonFile(file);
  } catch (err) {
    warnings.push(`pending.json 损坏（${err?.message || String(err)}），按无 pending 处理`);
    return ok({ pending: null, warnings });
  }
  if (
    !record ||
    typeof record !== "object" ||
    !ensureString(record.version) ||
    !ensureString(record.dir)
  ) {
    warnings.push("pending.json 结构非法，按无 pending 处理");
    return ok({ pending: null, warnings });
  }
  return ok({ pending: record, warnings });
}

/** 删除 pending.json（文件不存在也返回 ok）。 */
export function clearPending(dataDir) {
  const root = resolveDataDir(dataDir);
  if (!root) return fail("INVALID_ARGUMENT", "clearPending 需要非空 dataDir");
  const file = pendingPath(root);
  let cleared = false;
  try {
    if (fs.existsSync(file)) {
      fs.rmSync(file, { force: true });
      cleared = true;
    }
  } catch (err) {
    return fail("CLEAR_FAILED", `删除 pending.json 失败：${err?.message || String(err)}`);
  }
  return ok({ cleared, pending: null });
}

/** 读取 last-apply.json；损坏返回 null（不抛错）。 */
function readLastApply(dataDir) {
  const file = lastApplyPath(dataDir);
  if (!fs.existsSync(file)) return null;
  try {
    const record = readJsonFile(file);
    if (!record || typeof record !== "object" || !ensureString(record.backupDir)) return null;
    return record;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------- */
/* 4) 应用 / 回滚                                                              */
/* ------------------------------------------------------------------------- */

/**
 * 应用 pending 更新。
 *
 * 安全闸门（按顺序，任一不过直接返回，且不产生任何副作用）：
 *   1. NO_PENDING / STAGED_MISSING
 *   2. INSTALL_MISSING
 *   3. JUNCTION_INSTALL   installDir 或其父链是 junction/symlink
 *   4. NAME_MISMATCH      已安装 package.json 的 name 不符
 *   5. STAGED_INVALID     暂存 package.json 损坏或版本不符
 *
 * 通过后：备份 → 写 last-apply.json → 逐文件覆盖 → 清 pending。
 * 覆盖过程中失败：用备份恢复每个已覆盖/新增的文件，清空 pending 并返回
 * {ok:false, code:"APPLY_FAILED", rolledBack:true}。
 *
 * @param {object} opts
 * @param {string} opts.dataDir
 * @param {string} opts.installDir
 * @param {() => Date} [opts.now]
 */
export async function applyPending({ dataDir, installDir, now = () => new Date() } = {}) {
  const root = resolveDataDir(dataDir);
  if (!root) return fail("INVALID_ARGUMENT", "applyPending 需要非空 dataDir");
  if (!ensureString(installDir)) return fail("INVALID_ARGUMENT", "applyPending 需要非空 installDir");
  const targetDir = path.resolve(installDir);

  // 闸门 1：pending 存在且暂存目录还在
  const pendingRead = readPending(root);
  const pending = pendingRead.pending;
  if (!pending) return fail("NO_PENDING", "没有待应用的更新（pending.json 不存在或无效）");
  if (!dirExists(pending.dir)) {
    return fail("STAGED_MISSING", `暂存目录不存在：${pending.dir}`);
  }

  // 闸门 2：安装目录存在
  if (!dirExists(targetDir)) {
    return fail("INSTALL_MISSING", `安装目录不存在：${targetDir}`);
  }

  // 闸门 3：junction / symlink 安装一律拒绝
  const linkHit = findLinkInChain(targetDir);
  if (linkHit) {
    return fail(
      "JUNCTION_INSTALL",
      `安装目录 ${targetDir}（命中 ${linkHit}）是 junction/symlink 安装，不能自动替换。` +
        "请退出 DSH 后手工安装（例如在 shell 里执行 npm install -g / pnpm add 覆盖安装），" +
        "或改用 npm 真实目录安装（不要用 link: / 文件协议），然后重试。",
    );
  }

  // 闸门 4：已安装包名与 pending 记录一致
  const installedPkgFile = path.join(targetDir, "package.json");
  if (!fileExists(installedPkgFile)) {
    return fail("INSTALL_MISSING", `安装目录缺少 package.json：${installedPkgFile}`);
  }
  let installedPkg;
  try {
    installedPkg = readJsonFile(installedPkgFile);
  } catch (err) {
    return fail("NAME_MISMATCH", `安装目录 package.json 无法解析：${err?.message || String(err)}`);
  }
  if (installedPkg?.name !== pending.packageName) {
    return fail(
      "NAME_MISMATCH",
      `安装目录 package.json name=${String(installedPkg?.name)} 与 pending.packageName=${String(
        pending.packageName,
      )} 不符`,
    );
  }

  // 闸门 5：暂存内容有效
  const stagedPkgFile = path.join(pending.dir, "package.json");
  let stagedPkg;
  try {
    stagedPkg = readJsonFile(stagedPkgFile);
  } catch (err) {
    return fail("STAGED_INVALID", `暂存 package.json 无法解析：${err?.message || String(err)}`);
  }
  if (stagedPkg?.version !== pending.version) {
    return fail(
      "STAGED_INVALID",
      `暂存版本 ${String(stagedPkg?.version)} 与 pending.version=${String(pending.version)} 不符`,
    );
  }

  const fromVersion = ensureString(installedPkg.version) ? String(installedPkg.version) : "unknown";
  // 旧版本号参与目录名，过滤掉路径不友好字符（正常 semver 不会命中）
  const backupName = `${fromVersion.replace(/[^0-9A-Za-z.+_-]/g, "_")}-${compactUtc(now)}`;
  const backupDir = path.join(backupsDir(root), backupName);
  const stagedFiles = listFiles(pending.dir);
  if (stagedFiles.length === 0) {
    return fail("STAGED_INVALID", `暂存目录里没有可应用的文件：${pending.dir}`);
  }

  // 备份：暂存里有的顶层条目 + package.json（已存在的才备份）
  let backedUpFiles;
  try {
    fs.mkdirSync(backupDir, { recursive: true });
    backedUpFiles = [];
    const topEntries = new Set(["package.json", ...new Set(stagedFiles.map((f) => f.split("/")[0]))]);
    for (const entry of topEntries) {
      const src = path.join(targetDir, entry);
      if (!fs.existsSync(src)) continue;
      copyTree(src, path.join(backupDir, entry), entry, backedUpFiles);
    }
  } catch (err) {
    try {
      rmrf(backupDir);
    } catch {
      /* 清理失败忽略 */
    }
    return fail("APPLY_FAILED", `备份现有安装失败：${err?.message || String(err)}`, { rolledBack: false });
  }

  const appliedAt = toIso(now);
  try {
    writeJsonFile(lastApplyPath(root), {
      from: fromVersion,
      to: pending.version,
      backupDir,
      at: appliedAt,
      installDir: targetDir,
      files: stagedFiles,
    });
  } catch (err) {
    return fail("APPLY_FAILED", `写 last-apply.json 失败：${err?.message || String(err)}`, {
      rolledBack: false,
    });
  }

  const copied = [];
  try {
    for (const rel of stagedFiles) {
      const src = path.join(pending.dir, ...rel.split("/"));
      const dest = path.join(targetDir, ...rel.split("/"));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      copied.push(rel);
    }
  } catch (err) {
    const { restored, failures } = restoreFromBackup(backupDir, targetDir, copied);
    try {
      clearPending(root);
    } catch {
      /* 清 pending 失败不覆盖主错误 */
    }
    return fail("APPLY_FAILED", `覆盖安装目录失败：${err?.message || String(err)}`, {
      rolledBack: restored,
      restoreFailures: failures,
    });
  }

  const cleared = clearPending(root);
  return ok({
    applied: true,
    from: fromVersion,
    to: pending.version,
    backupDir,
    fileCount: copied.length,
    restartRequired: true,
    warnings: cleared.ok ? [] : [cleared.message],
  });
}

/**
 * 用备份还原指定文件；备份里没有的（即本次新增的）删除。
 * @returns {{restored:boolean, failures:string[]}}
 */
function restoreFromBackup(backupDir, installDir, files) {
  const failures = [];
  for (const rel of files) {
    const backupFile = path.join(backupDir, ...rel.split("/"));
    const target = path.join(installDir, ...rel.split("/"));
    try {
      if (fs.existsSync(backupFile)) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(backupFile, target);
      } else {
        fs.rmSync(target, { force: true });
      }
    } catch (err) {
      failures.push(`${rel}: ${err?.message || String(err)}`);
    }
  }
  return { restored: failures.length === 0, failures };
}

/**
 * 回滚上一次 applyPending：按 last-apply.json 里的备份目录把文件复制回去。
 * 返回的 from/to 是「回滚方向」：from=被回滚掉的版本，to=恢复到的旧版本。
 *
 * @param {object} opts
 * @param {string} opts.dataDir
 * @param {string} opts.installDir
 * @param {() => Date} [opts.now]
 */
export async function rollbackLast({ dataDir, installDir, now = () => new Date() } = {}) {
  const root = resolveDataDir(dataDir);
  if (!root) return fail("INVALID_ARGUMENT", "rollbackLast 需要非空 dataDir");
  if (!ensureString(installDir)) return fail("INVALID_ARGUMENT", "rollbackLast 需要非空 installDir");
  const targetDir = path.resolve(installDir);
  const record = readLastApply(root);
  if (!record) {
    return fail("NO_LAST_APPLY", "没有 last-apply.json 记录，不知道上次应用了什么");
  }
  if (!dirExists(record.backupDir)) {
    return fail("BACKUP_MISSING", `备份目录不存在：${record.backupDir}`);
  }
  // 与 apply 同一套安全闸门：junction 安装同样不能自动回滚
  const linkHit = findLinkInChain(targetDir);
  if (linkHit) {
    return fail(
      "JUNCTION_INSTALL",
      `安装目录 ${targetDir}（命中 ${linkHit}）是 junction/symlink 安装，不能自动回滚，请退出 DSH 后手工安装。`,
    );
  }
  const files = Array.isArray(record.files) ? record.files.filter(ensureString) : [];
  if (files.length === 0) {
    return fail("NO_FILES", "last-apply.json 没有文件清单，无法回滚");
  }
  const failures = [];
  for (const rel of files) {
    const backupFile = path.join(record.backupDir, ...rel.split("/"));
    const target = path.join(targetDir, ...rel.split("/"));
    try {
      if (fs.existsSync(backupFile)) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(backupFile, target);
      } else {
        // 应用前不存在（新增文件）→ 回滚时删除
        fs.rmSync(target, { force: true });
      }
    } catch (err) {
      failures.push(`${rel}: ${err?.message || String(err)}`);
    }
  }
  if (failures.length > 0) {
    return fail("ROLLBACK_FAILED", `回滚过程中有 ${failures.length} 个文件失败`, { failures });
  }
  return ok({
    restored: true,
    from: ensureString(record.to) ? record.to : "unknown",
    to: ensureString(record.from) ? record.from : "unknown",
    backupDir: record.backupDir,
    fileCount: files.length,
    at: toIso(now),
  });
}

/* ------------------------------------------------------------------------- */
/* 状态汇总                                                                    */
/* ------------------------------------------------------------------------- */

/**
 * 汇总更新状态供宿主/前端展示。
 * @param {string} dataDir
 * @param {{currentVersion?: string}} [opts]
 */
export function updateStatus(dataDir, { currentVersion } = {}) {
  const root = resolveDataDir(dataDir);
  if (!root) {
    return fail("INVALID_ARGUMENT", "updateStatus 需要非空 dataDir");
  }
  const warnings = [];
  let pending = null;
  let lastApply = null;
  try {
    const read = readPending(root);
    warnings.push(...(read.warnings || []));
    if (read.pending) {
      pending = {
        version: read.pending.version,
        createdAt: read.pending.createdAt ?? null,
      };
    }
  } catch (err) {
    warnings.push(`读取 pending 失败：${err?.message || String(err)}`);
  }
  try {
    const record = readLastApply(root);
    if (record) {
      lastApply = { from: record.from ?? null, to: record.to ?? null, at: record.at ?? null };
    }
  } catch (err) {
    warnings.push(`读取 last-apply 失败：${err?.message || String(err)}`);
  }
  const current = ensureString(currentVersion) ? currentVersion : null;
  const newerPending = Boolean(pending && current && compareVersions(pending.version, current) > 0);
  return ok({ current, pending, lastApply, newerPending, warnings });
}

/* ------------------------------------------------------------------------- */
/* 宿主接线用的服务封装（可选）                                                 */
/* ------------------------------------------------------------------------- */

/**
 * 把上面这些纯函数包成有状态的服务，方便宿主直接接线。
 * 构造参数：{ dataDir, installDir, packageName, currentVersion, fetchImpl, registryUrl }。
 */
export class UpdateService {
  constructor({
    dataDir,
    installDir,
    packageName = PACKAGE_NAME,
    currentVersion,
    fetchImpl,
    registryUrl = REGISTRY_URL,
  } = {}) {
    this.dataDir = dataDir;
    this.installDir = installDir;
    this.packageName = packageName;
    this.currentVersion = currentVersion;
    this.fetchImpl = fetchImpl;
    this.registryUrl = registryUrl;
  }

  /** 查询最新版本（不会真的联网，除非注入的 fetchImpl 会）。 */
  async check({ timeoutMs } = {}) {
    return checkLatest({
      fetchImpl: this.fetchImpl,
      packageName: this.packageName,
      registryUrl: this.registryUrl,
      currentVersion: this.currentVersion,
      timeoutMs,
    });
  }

  /** 下载并暂存 meta 对应的版本。 */
  async stage(meta, { timeoutMs, maxBytes } = {}) {
    return stageUpdate({
      fetchImpl: this.fetchImpl,
      dataDir: this.dataDir,
      packageName: this.packageName,
      meta,
      timeoutMs,
      maxBytes,
    });
  }

  /** 应用 pending 更新。 */
  async apply() {
    return applyPending({ dataDir: this.dataDir, installDir: this.installDir });
  }

  /** 回滚上一次应用。 */
  async rollback() {
    return rollbackLast({ dataDir: this.dataDir, installDir: this.installDir });
  }

  /** 汇总状态。 */
  status() {
    return updateStatus(this.dataDir, { currentVersion: this.currentVersion });
  }
}

export default {
  compareVersions,
  checkLatest,
  readNpmTarball,
  stageUpdate,
  pendingPath,
  readPending,
  clearPending,
  applyPending,
  rollbackLast,
  updateStatus,
  UpdateService,
};
