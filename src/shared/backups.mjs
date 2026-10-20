/**
 * backups.mjs
 *
 * 名册（registry.json）备份/恢复模块。
 * 备份放在数据目录，绝不放在插件目录。
 * 所有导出函数均为同步、返回结果对象、不抛异常（参数非法除外）。
 *
 * rotateBackups 语义：
 * - 保留最近 keep 份（keep>0 时）
 * - ∪ 最近 dailyKeep 个实际日期的每天最后一份（dailyKeep>0 时）
 * - ∪ 兜底至少保留最近 3 份
 * - 删除其余并同步 index.json
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const BACKUPS_DIR = "backups";
const INDEX_FILE = "index.json";
const REASON_RE = /^[a-z0-9\-]+$/;

/* ------------------------------------------------------------------ */
/* 小工具                                                            */
/* ------------------------------------------------------------------ */

function sha256File(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

function sha256Data(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function ensureBackupsDir(dataDir) {
  const backupsDir = path.join(dataDir, BACKUPS_DIR);
  fs.mkdirSync(backupsDir, { recursive: true });
  return backupsDir;
}

function compactTimestamp(date) {
  return date.toISOString().replace(/[:.]/g, "");
}

function sanitizeReason(reason) {
  if (typeof reason !== "string") return "manual";
  const cleaned = reason
    .toLowerCase()
    .replace(/[^a-z0-9\-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "manual";
}

function isUnderBackups(filePath, backupsDir) {
  const resolved = path.resolve(filePath);
  const resolvedDir = path.resolve(backupsDir);
  return resolved.startsWith(resolvedDir + path.sep) || resolved === resolvedDir;
}

function isBackupsJson(filePath) {
  return filePath.toLowerCase().endsWith(".json");
}

function readIndex(dataDir) {
  const indexPath = path.join(dataDir, BACKUPS_DIR, INDEX_FILE);
  try {
    if (!fs.existsSync(indexPath)) return { index: [], indexPath };
    const raw = fs.readFileSync(indexPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { index: [], indexPath };
    return { index: parsed, indexPath };
  } catch {
    return { index: [], indexPath };
  }
}

function writeIndex(dataDir, index) {
  const { indexPath } = readIndex(dataDir);
  try {
    const payload = `${JSON.stringify(index, null, 2)}\n`;
    fs.writeFileSync(indexPath, payload, "utf8");
  } catch {
    // index 写入失败不阻断备份本身
  }
}

function backupEntryFromFile(backupsDir, fileName) {
  try {
    const filePath = path.join(backupsDir, fileName);
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    const raw = fs.readFileSync(filePath, "utf8");
    const hash = sha256Data(raw);
    let version = null;
    let reason = "manual";
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        if (parsed.version !== undefined) version = parsed.version;
      }
    } catch {
      // ignore
    }
    const m = fileName.match(/^registry-(.+?)-([a-z0-9\-]+)\.json$/);
    if (m) reason = m[2];
    return {
      file: fileName,
      path: filePath,
      at: stat.mtime.toISOString(),
      bytes: stat.size,
      reason,
      sha256: hash,
      version,
    };
  } catch {
    return null;
  }
}

function rebuildIndex(dataDir) {
  const backupsDir = path.join(dataDir, BACKUPS_DIR);
  if (!fs.existsSync(backupsDir)) return [];
  const entries = fs
    .readdirSync(backupsDir)
    .filter((f) => f.startsWith("registry-") && f.endsWith(".json"))
    .map((f) => backupEntryFromFile(backupsDir, f))
    .filter(Boolean)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return entries;
}

/* ------------------------------------------------------------------ */
/* 公开 API                                                          */
/* ------------------------------------------------------------------ */

export function backupNow({
  dataDir,
  registryFile,
  reason = "manual",
  now = new Date(),
  keep = 30,
  dailyKeep = 7,
}) {
  if (!dataDir || typeof dataDir !== "string") {
    throw new Error("backupNow 需要 dataDir 参数");
  }
  if (!registryFile || typeof registryFile !== "string") {
    throw new Error("backupNow 需要 registryFile 参数");
  }
  if (!fs.existsSync(registryFile)) {
    return { ok: false, code: "REGISTRY_MISSING" };
  }

  const backupsDir = ensureBackupsDir(dataDir);
  const safeReason = sanitizeReason(reason);
  const stamp = compactTimestamp(now);
  const fileName = `registry-${stamp}-${safeReason}.json`;
  const destPath = path.join(backupsDir, fileName);

  // 原子写
  const tmpPath = `${destPath}.${process.pid}.tmp`;
  try {
    fs.copyFileSync(registryFile, tmpPath);
    fs.renameSync(tmpPath, destPath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    return { ok: false, code: "WRITE_ERROR", message: err?.message };
  }

  const bytes = fs.statSync(destPath).size;
  const sha256 = sha256File(destPath);

  // 维护 index
  const { indexPath } = readIndex(dataDir);
  let index;
  try {
    const { index: existing } = readIndex(dataDir);
    index = existing;
  } catch {
    index = [];
  }
  index.unshift({
    file: fileName,
    at: now.toISOString(),
    bytes,
    reason: safeReason,
    sha256,
    version: 1,
  });
  try {
    const payload = `${JSON.stringify(index, null, 2)}\n`;
    fs.writeFileSync(indexPath, payload, "utf8");
  } catch {
    // index 写入失败不阻断备份
  }

  rotateBackups(dataDir, { keep, dailyKeep, now });

  return {
    ok: true,
    file: fileName,
    path: destPath,
    bytes,
    at: now.toISOString(),
    sha256,
  };
}

export function listBackups(dataDir) {
  if (!dataDir || typeof dataDir !== "string") return [];
  const backupsDir = path.join(dataDir, BACKUPS_DIR);
  if (!fs.existsSync(backupsDir)) return [];

  const { index, indexPath } = readIndex(dataDir);
  if (index.length > 0) {
    return index.map((entry) => ({
      ...entry,
      path: path.join(backupsDir, entry.file),
    }));
  }

  // index 缺失/损坏时扫目录兜底重建
  const rebuilt = rebuildIndex(dataDir);
  try {
    const payload = `${JSON.stringify(rebuilt, null, 2)}\n`;
    fs.writeFileSync(indexPath, payload, "utf8");
  } catch {
    // 重建失败继续返回
  }
  return rebuilt;
}

export function rotateBackups(dataDir, { keep = 30, dailyKeep = 7, now = new Date() } = {}) {
  if (!dataDir || typeof dataDir !== "string") {
    return { ok: false, removed: [], kept: 0 };
  }
  const backupsDir = path.join(dataDir, BACKUPS_DIR);
  if (!fs.existsSync(backupsDir)) return { ok: true, removed: [], kept: 0 };

  let entries = listBackups(dataDir);
  entries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const keepSet = new Set();

  // 1. 保留最近 keep 份（keep>0 时）
  if (keep > 0) {
    entries.slice(0, keep).forEach((e) => keepSet.add(e.file));
  }

  // 2. 保留最近 dailyKeep 个实际日期的每天最后一份（dailyKeep>0 时）
  if (dailyKeep > 0) {
    const dayMap = new Map();
    for (const e of entries) {
      const d = new Date(e.at).toISOString().slice(0, 10);
      // 同一天保留时间最晚的（entries 已按时间倒序，先遇到的就是最新的）
      if (!dayMap.has(d)) dayMap.set(d, e.file);
    }
    const sortedDays = [...dayMap.keys()].sort((a, b) => (a > b ? -1 : 1));
    sortedDays.slice(0, dailyKeep).forEach((d) => keepSet.add(dayMap.get(d)));
  }

  // 3. 兜底：至少保留最近 3 份
  entries.slice(0, 3).forEach((e) => keepSet.add(e.file));

  const removed = [];
  for (const entry of entries) {
    if (!keepSet.has(entry.file)) {
      try {
        fs.unlinkSync(entry.path);
        removed.push(entry.file);
      } catch {
        // 忽略删除失败
      }
    }
  }

  // 同步 index
  const remaining = entries.filter((e) => keepSet.has(e.file));
  writeIndex(dataDir, remaining);

  return { ok: true, removed, kept: remaining.length };
}

export function restoreBackup({ dataDir, registryFile, file, now = new Date(), validate = null }) {
  if (!dataDir || typeof dataDir !== "string") {
    throw new Error("restoreBackup 需要 dataDir 参数");
  }
  if (!registryFile || typeof registryFile !== "string") {
    throw new Error("restoreBackup 需要 registryFile 参数");
  }
  if (!file || typeof file !== "string") {
    throw new Error("restoreBackup 需要 file 参数");
  }

  const backupsDir = path.join(dataDir, BACKUPS_DIR);
  const srcPath = path.join(backupsDir, file);
  if (!isUnderBackups(srcPath, backupsDir) || !isBackupsJson(srcPath)) {
    return { ok: false, code: "PATH_TRAVERSAL" };
  }
  if (!fs.existsSync(srcPath)) {
    return { ok: false, code: "BACKUP_NOT_FOUND" };
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(srcPath, "utf8"));
  } catch (err) {
    return { ok: false, code: "INVALID_JSON", message: err?.message };
  }

  if (typeof validate === "function") {
    const check = validate(data);
    if (!check || check.ok === false) {
      return { ok: false, code: "VALIDATION_FAILED", detail: check };
    }
  }

  // 恢复前先创建安全备份
  const safetyBackup = backupNow({ dataDir, registryFile, reason: "pre-restore", now });

  const dir = path.dirname(registryFile);
  const tmpPath = `${registryFile}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmpPath, registryFile);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    return { ok: false, code: "WRITE_ERROR", message: err?.message };
  }

  return {
    ok: true,
    restoredFrom: file,
    safetyBackup: safetyBackup?.ok ? safetyBackup : null,
    at: now.toISOString(),
  };
}

export function readBackup({ dataDir, file }) {
  if (!dataDir || typeof dataDir !== "string") {
    throw new Error("readBackup 需要 dataDir 参数");
  }
  if (!file || typeof file !== "string") {
    throw new Error("readBackup 需要 file 参数");
  }

  const backupsDir = path.join(dataDir, BACKUPS_DIR);
  const srcPath = path.join(backupsDir, file);
  if (!isUnderBackups(srcPath, backupsDir) || !isBackupsJson(srcPath)) {
    return { ok: false, code: "PATH_TRAVERSAL" };
  }
  if (!fs.existsSync(srcPath)) {
    return { ok: false, code: "BACKUP_NOT_FOUND" };
  }

  try {
    const data = JSON.parse(fs.readFileSync(srcPath, "utf8"));
    return { ok: true, data };
  } catch (err) {
    return { ok: false, code: "INVALID_JSON", message: err?.message };
  }
}

export function exportRegistry({ registryFile, outFile }) {
  if (!registryFile || typeof registryFile !== "string") {
    throw new Error("exportRegistry 需要 registryFile 参数");
  }
  if (!outFile || typeof outFile !== "string") {
    throw new Error("exportRegistry 需要 outFile 参数");
  }
  if (!fs.existsSync(registryFile)) {
    return { ok: false, code: "REGISTRY_MISSING" };
  }

  try {
    const raw = fs.readFileSync(registryFile, "utf8");
    const sha256 = sha256Data(raw);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.copyFileSync(registryFile, outFile);
    const bytes = fs.statSync(outFile).size;
    return { ok: true, outFile, bytes, sha256 };
  } catch (err) {
    return { ok: false, code: "EXPORT_ERROR", message: err?.message };
  }
}

export function importRegistry({ dataDir, registryFile, inFile, now = new Date(), validate = null }) {
  if (!dataDir || typeof dataDir !== "string") {
    throw new Error("importRegistry 需要 dataDir 参数");
  }
  if (!registryFile || typeof registryFile !== "string") {
    throw new Error("importRegistry 需要 registryFile 参数");
  }
  if (!inFile || typeof inFile !== "string") {
    throw new Error("importRegistry 需要 inFile 参数");
  }
  if (!fs.existsSync(inFile)) {
    return { ok: false, code: "IMPORT_FILE_MISSING" };
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(inFile, "utf8"));
  } catch (err) {
    return { ok: false, code: "INVALID_JSON", message: err?.message };
  }

  if (typeof validate === "function") {
    const check = validate(data);
    if (!check || check.ok === false) {
      return { ok: false, code: "VALIDATION_FAILED", detail: check };
    }
  }

  const safetyBackup = backupNow({ dataDir, registryFile, reason: "pre-import", now });

  const dir = path.dirname(registryFile);
  const tmpPath = `${registryFile}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmpPath, registryFile);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    return { ok: false, code: "WRITE_ERROR", message: err?.message };
  }

  const bytes = fs.statSync(registryFile).size;
  return { ok: true, safetyBackup: safetyBackup?.ok ? safetyBackup : null, bytes };
}

export function backupStatus(dataDir) {
  if (!dataDir || typeof dataDir !== "string") {
    throw new Error("backupStatus 需要 dataDir 参数");
  }
  const backupsDir = path.join(dataDir, BACKUPS_DIR);
  const indexPath = path.join(backupsDir, INDEX_FILE);
  const entries = listBackups(dataDir);
  const totalBytes = entries.reduce((sum, e) => sum + (e.bytes || 0), 0);
  const latest = entries.length > 0 ? { file: entries[0].file, at: entries[0].at } : null;
  return {
    ok: true,
    count: entries.length,
    totalBytes,
    latest,
    indexPath,
  };
}
