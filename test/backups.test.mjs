import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  backupNow,
  backupStatus,
  exportRegistry,
  importRegistry,
  listBackups,
  readBackup,
  restoreBackup,
  rotateBackups,
} from "../src/shared/backups.mjs";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "member-manager-backups-"));
}

function writeRegistry(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

/* ---------------- 基本备份流程 ---------------- */

test("首次备份生成文件与 index", () => {
  const dir = tmpDir();
  const registryFile = path.join(dir, "registry.json");
  writeRegistry(registryFile, { version: 1, members: [] });

  const res = backupNow({ dataDir: dir, registryFile, reason: "manual" });
  assert.equal(res.ok, true);
  assert.ok(fs.existsSync(res.path));
  assert.ok(fs.existsSync(path.join(dir, "backups", "index.json")));

  const list = listBackups(dir);
  assert.equal(list.length, 1);
  assert.equal(list[0].file, res.file);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("registry 缺失时返回 REGISTRY_MISSING", () => {
  const dir = tmpDir();
  const registryFile = path.join(dir, "registry.json");
  const res = backupNow({ dataDir: dir, registryFile });
  assert.equal(res.ok, false);
  assert.equal(res.code, "REGISTRY_MISSING");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("原子写不残留 .tmp 文件", () => {
  const dir = tmpDir();
  const registryFile = path.join(dir, "registry.json");
  writeRegistry(registryFile, { version: 1, members: [] });

  backupNow({ dataDir: dir, registryFile });
  const files = fs.readdirSync(path.join(dir, "backups"));
  assert.ok(files.every((f) => !f.endsWith(".tmp")));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("listBackups 按时间倒序", () => {
  const dir = tmpDir();
  const registryFile = path.join(dir, "registry.json");
  writeRegistry(registryFile, { version: 1, members: [] });

  const t1 = new Date("2026-01-01T00:00:00Z");
  const t2 = new Date("2026-01-02T00:00:00Z");
  const t3 = new Date("2026-01-03T00:00:00Z");

  backupNow({ dataDir: dir, registryFile, now: t1 });
  backupNow({ dataDir: dir, registryFile, now: t2 });
  backupNow({ dataDir: dir, registryFile, now: t3 });

  const list = listBackups(dir);
  assert.equal(list.length, 3);
  assert.equal(new Date(list[0].at).getTime(), t3.getTime());
  assert.equal(new Date(list[1].at).getTime(), t2.getTime());
  assert.equal(new Date(list[2].at).getTime(), t1.getTime());
  fs.rmSync(dir, { recursive: true, force: true });
});

test("index 损坏后扫目录兜底重建", () => {
  const dir = tmpDir();
  const registryFile = path.join(dir, "registry.json");
  writeRegistry(registryFile, { version: 1, members: [] });

  backupNow({ dataDir: dir, registryFile, now: new Date("2026-01-01T00:00:00Z") });
  fs.writeFileSync(path.join(dir, "backups", "index.json"), "not-json");

  const list = listBackups(dir);
  assert.equal(list.length, 1);
  assert.ok(list[0].file.startsWith("registry-"));
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ---------------- rotateBackups ---------------- */

test("rotateBackups 保留最近 keep 个", () => {
  const dir = tmpDir();
  const registryFile = path.join(dir, "registry.json");
  writeRegistry(registryFile, { version: 1, members: [] });

  for (let i = 0; i < 5; i += 1) {
    backupNow({
      dataDir: dir,
      registryFile,
      now: new Date(`2026-01-0${i + 1}T00:00:00Z`),
    });
  }

  rotateBackups(dir, { keep: 3, dailyKeep: 0 });
  const list = listBackups(dir);
  assert.equal(list.length, 3);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("rotateBackups 对最近 dailyKeep 天每天保留最后一个", () => {
  const dir = tmpDir();
  const registryFile = path.join(dir, "registry.json");
  writeRegistry(registryFile, { version: 1, members: [] });

  // 连续 4 天，每天 2 份，共 8 份
  for (let i = 0; i < 8; i += 1) {
    backupNow({
      dataDir: dir,
      registryFile,
      now: new Date(`2026-01-0${Math.floor(i / 2) + 1}T0${i % 2}:00:00Z`),
    });
  }

  // keep=1 保留最近 1 份；dailyKeep=3 保留最近 3 个实际日期每天最后 1 份；并集为 4 份
  rotateBackups(dir, { keep: 1, dailyKeep: 3 });
  const list = listBackups(dir);
  assert.equal(list.length, 4);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("rotateBackups 至少保留 3 个", () => {
  const dir = tmpDir();
  const registryFile = path.join(dir, "registry.json");
  writeRegistry(registryFile, { version: 1, members: [] });

  for (let i = 0; i < 3; i += 1) {
    backupNow({
      dataDir: dir,
      registryFile,
      now: new Date(`2026-01-0${i + 1}T00:00:00Z`),
    });
  }

  rotateBackups(dir, { keep: 0, dailyKeep: 0 });
  const list = listBackups(dir);
  assert.equal(list.length, 3);
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ---------------- restoreBackup ---------------- */

test("restoreBackup 正常恢复", () => {
  const dir = tmpDir();
  const registryFile = path.join(dir, "registry.json");
  writeRegistry(registryFile, { version: 1, members: [{ target: "old" }] });

  const backupRes = backupNow({ dataDir: dir, registryFile });
  writeRegistry(registryFile, { version: 1, members: [{ target: "new" }] });

  const restoreRes = restoreBackup({ dataDir: dir, registryFile, file: backupRes.file });
  assert.equal(restoreRes.ok, true);
  assert.equal(restoreRes.restoredFrom, backupRes.file);

  const data = JSON.parse(fs.readFileSync(registryFile, "utf8"));
  assert.equal(data.members[0].target, "old");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("restoreBackup 拒绝目录穿越 ../", () => {
  const dir = tmpDir();
  const registryFile = path.join(dir, "registry.json");
  writeRegistry(registryFile, { version: 1, members: [] });

  const res = restoreBackup({
    dataDir: dir,
    registryFile,
    file: "../etc/passwd",
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, "PATH_TRAVERSAL");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("restoreBackup 拒绝校验失败", () => {
  const dir = tmpDir();
  const registryFile = path.join(dir, "registry.json");
  writeRegistry(registryFile, { version: 1, members: [] });

  const backupRes = backupNow({ dataDir: dir, registryFile });
  const res = restoreBackup({
    dataDir: dir,
    registryFile,
    file: backupRes.file,
    validate: () => ({ ok: false }),
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, "VALIDATION_FAILED");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("restoreBackup 恢复前自动创建安全备份", () => {
  const dir = tmpDir();
  const registryFile = path.join(dir, "registry.json");
  writeRegistry(registryFile, { version: 1, members: [{ target: "pre" }] });

  const backupRes = backupNow({
    dataDir: dir,
    registryFile,
    reason: "original",
    now: new Date("2026-01-01T00:00:00Z"),
  });
  writeRegistry(registryFile, { version: 1, members: [{ target: "current" }] });

  restoreBackup({ dataDir: dir, registryFile, file: backupRes.file });
  const list = listBackups(dir);
  assert.ok(list.some((b) => b.reason === "pre-restore"));
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ---------------- export/import ---------------- */

test("exportRegistry/importRegistry 往返", () => {
  const dir = tmpDir();
  const registryFile = path.join(dir, "registry.json");
  const original = { version: 1, members: [{ target: "alpha" }] };
  writeRegistry(registryFile, original);

  const outFile = path.join(dir, "export.json");
  const exportRes = exportRegistry({ registryFile, outFile });
  assert.equal(exportRes.ok, true);
  assert.equal(fs.existsSync(outFile), true);

  const importRes = importRegistry({ dataDir: dir, registryFile, inFile: outFile });
  assert.equal(importRes.ok, true);
  const data = JSON.parse(fs.readFileSync(registryFile, "utf8"));
  assert.deepEqual(data, original);
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ---------------- backupStatus ---------------- */

test("backupStatus 返回统计", () => {
  const dir = tmpDir();
  const registryFile = path.join(dir, "registry.json");
  writeRegistry(registryFile, { version: 1, members: [] });

  backupNow({ dataDir: dir, registryFile });
  const status = backupStatus(dir);
  assert.equal(status.ok, true);
  assert.equal(status.count, 1);
  assert.ok(status.totalBytes > 0);
  assert.ok(status.latest);
  assert.ok(status.indexPath.endsWith("index.json"));
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ---------------- readBackup ---------------- */

test("readBackup 限制目录", () => {
  const dir = tmpDir();
  const registryFile = path.join(dir, "registry.json");
  writeRegistry(registryFile, { version: 1, members: [] });

  const backupRes = backupNow({ dataDir: dir, registryFile });
  const data = readBackup({ dataDir: dir, file: backupRes.file });
  assert.equal(data.ok, true);
  assert.equal(data.data.version, 1);

  const traversal = readBackup({ dataDir: dir, file: "../etc/passwd" });
  assert.equal(traversal.ok, false);
  assert.equal(traversal.code, "PATH_TRAVERSAL");
  fs.rmSync(dir, { recursive: true, force: true });
});
