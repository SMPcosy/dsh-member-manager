/**
 * src/host/updater.mjs 的测试。
 *
 * 约定：
 *  - 只用 node:test + 临时目录；不联网（所有 fetch 都是注入的 mock）。
 *  - 不写真实 DSH 目录，全部落在 os.tmpdir() 下。
 *  - tar.gz 由本文件自己的 helper 生成（512 字节 tar 头 + zlib.gzipSync）。
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import zlib from "node:zlib";

import {
  applyPending,
  checkLatest,
  clearPending,
  compareVersions,
  pendingPath,
  readNpmTarball,
  readPending,
  rollbackLast,
  stageUpdate,
  updateStatus,
  UpdateService,
} from "../src/host/updater.mjs";

const PACKAGE = "dsh-member-manager";

/* ------------------------------------------------------------------------- */
/* tar.gz 生成 helper                                                          */
/* ------------------------------------------------------------------------- */

function writeOctal(buf, offset, length, value) {
  const digits = Math.max(0, length - 1);
  const text = value.toString(8).padStart(digits, "0");
  if (text.length > digits) throw new Error(`八进制字段溢出：${value}`);
  buf.write(`${text}\0`, offset, length, "ascii");
}

/** 生成一个合法（含 checksum 与 ustar magic）的 512 字节 tar 头。 */
function tarHeader({ name, size = 0, typeflag = "0", prefix = "" }) {
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, 100, "utf8");
  writeOctal(header, 100, 8, 0o644); // mode
  writeOctal(header, 108, 8, 0); // uid
  writeOctal(header, 116, 8, 0); // gid
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0); // mtime
  header.fill(0x20, 148, 156); // checksum 字段先填空格
  header.write(typeflag, 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  if (prefix) header.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  return header;
}

/** pax 扩展头记录：`<len> key=value\n`，len 含自身位数。 */
function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`;
  const overhead = Buffer.byteLength(body, "utf8");
  let len = overhead + 1;
  while (String(len).length + overhead !== len) len = String(len).length + overhead;
  return Buffer.from(`${len}${body}`, "utf8");
}

/**
 * 拼一个 tar。
 * entry: { name, data?, dir?, typeflag?, prefix?, paxPath?, longName?, rawSize? }
 *  - paxPath 先发一个 'x' 扩展头覆盖路径
 *  - longName 先发一个 'L' GNU longname 头
 *  - rawSize 用于故意写错 size 字段（测截断）
 */
function buildTar(entries) {
  const chunks = [];
  const push = (header, data) => {
    chunks.push(header);
    if (data && data.length > 0) {
      chunks.push(data);
      const pad = (512 - (data.length % 512)) % 512;
      if (pad > 0) chunks.push(Buffer.alloc(pad));
    }
  };
  for (const entry of entries) {
    if (entry.paxPath) {
      const data = paxRecord("path", entry.paxPath);
      push(tarHeader({ name: "PaxHeader", size: data.length, typeflag: "x" }), data);
    }
    if (entry.longName) {
      const data = Buffer.from(`${entry.longName}\0`, "utf8");
      push(tarHeader({ name: "LongName", size: data.length, typeflag: "L" }), data);
    }
    const data = entry.dir ? null : Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? "", "utf8");
    const size = entry.rawSize ?? (data ? data.length : 0);
    push(
      tarHeader({
        name: entry.name,
        size,
        typeflag: entry.typeflag ?? (entry.dir ? "5" : "0"),
        prefix: entry.prefix ?? "",
      }),
      data,
    );
  }
  chunks.push(Buffer.alloc(1024)); // 归档结束的两个零块
  return Buffer.concat(chunks);
}

function makeTgz(entries) {
  return zlib.gzipSync(buildTar(entries));
}

/** 生成一个 npm 包形状的 tarball（package.json + 额外文件）。 */
function makePackageTgz({ version = "0.2.0", name = PACKAGE, files = {} } = {}) {
  const entries = [{ name: "package/package.json", data: JSON.stringify({ name, version }) }];
  for (const [rel, content] of Object.entries(files)) {
    entries.push({ name: `package/${rel}`, data: content });
  }
  return zlib.gzipSync(buildTar(entries));
}

/* ------------------------------------------------------------------------- */
/* fetch / registry 文档 mock                                                  */
/* ------------------------------------------------------------------------- */

function jsonResponse(doc, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(doc),
  };
}

function bufferResponse(buffer) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    arrayBuffer: async () => buffer,
  };
}

function registryDoc(version, { tarball = "https://example.test/pkg.tgz", integrity = null } = {}) {
  const dist = { tarball, shasum: "deadbeef" };
  if (integrity) dist.integrity = integrity;
  return {
    "dist-tags": { latest: version },
    versions: { [version]: { dist } },
  };
}

/** 让 tarball 的 sha512 integrity 与内容匹配。 */
function integrityFor(buffer) {
  return `sha512-${crypto.createHash("sha512").update(buffer).digest("base64")}`;
}

function makeTmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-updater-test-"));
  t.after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows 上 junction 有时需要先删链路本身；清理失败不影响断言
    }
  });
  return dir;
}

function writeFileDeep(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** 直接构造 pending.json（用于闸门测试）。 */
function writePendingRaw(dataDir, record) {
  fs.mkdirSync(path.join(dataDir, "updates"), { recursive: true });
  fs.writeFileSync(pendingPath(dataDir), JSON.stringify(record));
}

/** 建好 <dataDir>/updates/<version>/ 并写 pending.json。 */
function seedStaged(dataDir, { version = "0.2.0", files = {}, name = PACKAGE } = {}) {
  const dir = path.join(dataDir, "updates", version);
  const all = { "package.json": JSON.stringify({ name, version }), ...files };
  for (const [rel, content] of Object.entries(all)) {
    writeFileDeep(path.join(dir, ...rel.split("/")), content);
  }
  writePendingRaw(dataDir, {
    version,
    dir,
    tarball: "https://example.test/pkg.tgz",
    integrity: null,
    createdAt: "2026-10-19T00:00:00.000Z",
    packageName: name,
    fileCount: Object.keys(all).length,
  });
  return dir;
}

/** 建一个已安装目录。 */
function seedInstall(installDir, { version = "0.1.2", name = PACKAGE, files = {} } = {}) {
  writeFileDeep(path.join(installDir, "package.json"), JSON.stringify({ name, version }));
  for (const [rel, content] of Object.entries(files)) {
    writeFileDeep(path.join(installDir, ...rel.split("/")), content);
  }
  return installDir;
}

/* ------------------------------------------------------------------------- */
/* compareVersions                                                             */
/* ------------------------------------------------------------------------- */

test("compareVersions：相等 / 大小 / 段数不等", () => {
  assert.equal(compareVersions("0.2.0", "0.2.0"), 0);
  assert.equal(compareVersions("0.2.0", "0.1.9"), 1);
  assert.equal(compareVersions("0.1.9", "0.2.0"), -1);
  assert.equal(compareVersions("1.0", "1.0.0"), 0);
  assert.equal(compareVersions("1.0.0", "1.0"), 0);
  assert.equal(compareVersions("1.0.1", "1.0"), 1);
  assert.equal(compareVersions("2", "1.9.9"), 1);
  assert.equal(compareVersions("10.0.0", "9.9.9"), 1);
});

test("compareVersions：v 前缀 / 等号 / 空白", () => {
  assert.equal(compareVersions("v1.2.3", "1.2.3"), 0);
  assert.equal(compareVersions(" v0.2.0 ", "0.2.0"), 0);
  assert.equal(compareVersions("=1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("v0.1.2", "0.2.0"), -1);
});

test("compareVersions：预发布按 semver 规则排序", () => {
  assert.equal(compareVersions("1.0.0-beta", "1.0.0"), -1);
  assert.equal(compareVersions("1.0.0", "1.0.0-beta"), 1);
  assert.equal(compareVersions("1.0.0-beta.1", "1.0.0-beta.2"), -1);
  assert.equal(compareVersions("1.0.0-alpha", "1.0.0-beta"), -1);
  assert.equal(compareVersions("1.0.0-beta.10", "1.0.0-beta.9"), 1);
  assert.equal(compareVersions("1.0.0-alpha.1", "1.0.0-alpha"), 1);
  assert.equal(compareVersions("1.0.0-1", "1.0.0-alpha"), -1);
});

test("compareVersions：build 元数据被忽略，非法输入不抛异常", () => {
  assert.equal(compareVersions("1.0.0+build.5", "1.0.0"), 0);
  assert.equal(compareVersions("1.0.0-beta.1+sha", "1.0.0-beta.1"), 0);
  assert.doesNotThrow(() => compareVersions("not-a-version", "1.0.0"));
  assert.equal(compareVersions("garbage", "garbage"), 0);
  assert.doesNotThrow(() => compareVersions(undefined, null));
});

/* ------------------------------------------------------------------------- */
/* checkLatest                                                                 */
/* ------------------------------------------------------------------------- */

test("checkLatest：正常返回 latest / tarball / integrity / updateAvailable", async () => {
  let captured = null;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return jsonResponse(registryDoc("0.2.0", { integrity: "sha512-abc" }));
  };
  const res = await checkLatest({ fetchImpl, currentVersion: "0.1.2" });

  assert.equal(res.ok, true);
  assert.equal(res.current, "0.1.2");
  assert.equal(res.latest, "0.2.0");
  assert.equal(res.updateAvailable, true);
  assert.equal(res.tarball, "https://example.test/pkg.tgz");
  assert.equal(res.integrity, "sha512-abc");
  assert.equal(res.shasum, "deadbeef");
  assert.ok(typeof res.checkedAt === "string" && res.checkedAt.includes("T"));
  assert.equal(captured.url, `https://registry.npmjs.org/${PACKAGE}`);
  assert.equal(captured.options.headers.Accept, "application/vnd.npm.install-v1+json");
  assert.ok(captured.options.signal, "应传 AbortController signal");
});

test("checkLatest：当前已是最新 / 本地更新时 updateAvailable=false", async () => {
  const doc = registryDoc("0.2.0");
  const same = await checkLatest({ fetchImpl: async () => jsonResponse(doc), currentVersion: "0.2.0" });
  assert.equal(same.ok, true);
  assert.equal(same.updateAvailable, false);

  const newerLocal = await checkLatest({ fetchImpl: async () => jsonResponse(doc), currentVersion: "0.3.0" });
  assert.equal(newerLocal.updateAvailable, false);
});

test("checkLatest：404 → NOT_FOUND", async () => {
  const res = await checkLatest({
    fetchImpl: async () => jsonResponse({ error: "not found" }, { status: 404 }),
    currentVersion: "0.1.2",
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, "NOT_FOUND");
  assert.match(res.message, /404|不存在/);
});

test("checkLatest：超时 → TIMEOUT", async () => {
  const fetchImpl = (url, options) =>
    new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      });
    });
  const res = await checkLatest({ fetchImpl, currentVersion: "0.1.2", timeoutMs: 20 });
  assert.equal(res.ok, false);
  assert.equal(res.code, "TIMEOUT");
});

test("checkLatest：坏 JSON → BAD_JSON", async () => {
  const res = await checkLatest({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => "<html>not json</html>",
    }),
    currentVersion: "0.1.2",
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, "BAD_JSON");
});

test("checkLatest：HTTP 500 → HTTP_ERROR", async () => {
  const res = await checkLatest({
    fetchImpl: async () => jsonResponse({ error: "boom" }, { status: 500 }),
    currentVersion: "0.1.2",
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, "HTTP_ERROR");
  assert.equal(res.status, 500);
});

test("checkLatest：未注入 fetchImpl → NO_FETCH（不联网）", async () => {
  const res = await checkLatest({ currentVersion: "0.1.2" });
  assert.equal(res.ok, false);
  assert.equal(res.code, "NO_FETCH");
});

/* ------------------------------------------------------------------------- */
/* readNpmTarball                                                              */
/* ------------------------------------------------------------------------- */

test("readNpmTarball：正常解析，剥离 package/ 前缀并忽略目录条目", () => {
  const gz = makeTgz([
    { name: "package/package.json", data: JSON.stringify({ name: PACKAGE, version: "0.2.0" }) },
    { name: "package/lib/index.js", data: "export const a = 1;\n" },
    { name: "package/lib/", dir: true },
    { name: "package/bin/run.mjs", data: "#!/usr/bin/env node\n" },
  ]);
  const res = readNpmTarball(gz);
  assert.equal(res.ok, true);
  assert.deepEqual([...res.files.keys()].sort(), ["bin/run.mjs", "lib/index.js", "package.json"]);
  assert.equal(res.files.get("lib/index.js").toString("utf8"), "export const a = 1;\n");
  assert.deepEqual(res.warnings, []);
});

test("readNpmTarball：拒绝目录穿越与绝对路径，并记入 warnings", () => {
  const gz = makeTgz([
    { name: "package/ok.txt", data: "fine" },
    { name: "package/../../evil.txt", data: "evil" },
    { name: "package/..\\..\\evil-win.txt", data: "evil" },
    { name: "package//etc/passwd", data: "abs" },
    { name: "../outside.txt", data: "outside" },
  ]);
  const res = readNpmTarball(gz);
  assert.equal(res.ok, true);
  assert.deepEqual([...res.files.keys()], ["ok.txt"]);
  assert.ok(res.warnings.length >= 2, `应记录越界告警，实际：${JSON.stringify(res.warnings)}`);
  assert.ok(res.warnings.some((w) => w.includes("..") || w.includes("不安全")));
});

test("readNpmTarball：坏 gzip → BAD_TARBALL", () => {
  const res = readNpmTarball(Buffer.from("this is definitely not gzip"));
  assert.equal(res.ok, false);
  assert.equal(res.code, "BAD_TARBALL");
  assert.ok(res.files instanceof Map);
});

test("readNpmTarball：支持 ustar prefix 与 pax path 长路径", () => {
  const longRel = `deep/${"a".repeat(120)}/file.txt`;
  const gz = makeTgz([
    { name: "file.txt", prefix: "package/deep", data: "prefix-content" },
    { name: "pax-file.txt", paxPath: `package/${longRel}`, data: "pax-content" },
  ]);
  const res = readNpmTarball(gz);
  assert.equal(res.ok, true);
  assert.equal(res.files.get("deep/file.txt").toString("utf8"), "prefix-content");
  assert.equal(res.files.get(longRel).toString("utf8"), "pax-content");
});

test("readNpmTarball：支持 GNU longname（typeflag 'L'）", () => {
  const longName = `package/${"b".repeat(130)}/very-long-name.js`;
  const gz = makeTgz([{ name: "short.js", longName, data: "long-name-content" }]);
  const res = readNpmTarball(gz);
  assert.equal(res.ok, true);
  const rel = longName.slice("package/".length);
  assert.equal(res.files.get(rel).toString("utf8"), "long-name-content");
});

test("readNpmTarball：条目被截断 → BAD_TARBALL", () => {
  const header = tarHeader({ name: "package/a.txt", size: 4096 });
  const truncated = Buffer.concat([header, Buffer.from("short")]);
  const res = readNpmTarball(zlib.gzipSync(truncated));
  assert.equal(res.ok, false);
  assert.equal(res.code, "BAD_TARBALL");
});

/* ------------------------------------------------------------------------- */
/* stageUpdate                                                                 */
/* ------------------------------------------------------------------------- */

test("stageUpdate：下载 → 校验 → 解包 → 写 pending.json", async (t) => {
  const dataDir = makeTmp(t);
  const tgz = makePackageTgz({ files: { "lib/index.js": "export default 1;\n" } });
  const meta = {
    latest: "0.2.0",
    tarball: "https://example.test/pkg-0.2.0.tgz",
    integrity: integrityFor(tgz),
  };
  const res = await stageUpdate({
    fetchImpl: async () => bufferResponse(tgz),
    dataDir,
    meta,
  });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.version, "0.2.0");
  assert.equal(res.fileCount, 2);
  assert.equal(res.integrityOk, true);
  assert.equal(res.pending, pendingPath(dataDir));
  assert.equal(fs.readFileSync(path.join(res.dir, "lib/index.js"), "utf8"), "export default 1;\n");
  const pending = readPending(dataDir);
  assert.equal(pending.ok, true);
  assert.equal(pending.pending.version, "0.2.0");
  assert.equal(pending.pending.packageName, PACKAGE);
  // 不应残留 .tmp-* 目录
  const entries = fs.readdirSync(path.join(dataDir, "updates"));
  assert.ok(!entries.some((name) => name.startsWith(".tmp-")), `残留临时目录：${entries}`);
});

test("stageUpdate：sha512 integrity 不匹配 → INTEGRITY_MISMATCH", async (t) => {
  const dataDir = makeTmp(t);
  const tgz = makePackageTgz();
  const res = await stageUpdate({
    fetchImpl: async () => bufferResponse(tgz),
    dataDir,
    meta: {
      latest: "0.2.0",
      tarball: "https://example.test/pkg.tgz",
      integrity: `sha512-${crypto.createHash("sha512").update("other").digest("base64")}`,
    },
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, "INTEGRITY_MISMATCH");
  assert.equal(readPending(dataDir).pending, null);
});

test("stageUpdate：tarball 内版本与 meta.latest 不符 → VERSION_MISMATCH", async (t) => {
  const dataDir = makeTmp(t);
  const tgz = makePackageTgz({ version: "0.3.0" });
  const res = await stageUpdate({
    fetchImpl: async () => bufferResponse(tgz),
    dataDir,
    meta: { latest: "0.2.0", tarball: "https://example.test/pkg.tgz", integrity: integrityFor(tgz) },
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, "VERSION_MISMATCH");
});

test("stageUpdate：包名不符 → NAME_MISMATCH", async (t) => {
  const dataDir = makeTmp(t);
  const tgz = makePackageTgz({ name: "someone-else" });
  const res = await stageUpdate({
    fetchImpl: async () => bufferResponse(tgz),
    dataDir,
    meta: { latest: "0.2.0", tarball: "https://example.test/pkg.tgz", integrity: integrityFor(tgz) },
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, "NAME_MISMATCH");
});

test("stageUpdate：超过 maxBytes → TOO_LARGE", async (t) => {
  const dataDir = makeTmp(t);
  const tgz = makePackageTgz();
  const res = await stageUpdate({
    fetchImpl: async () => bufferResponse(tgz),
    dataDir,
    meta: { latest: "0.2.0", tarball: "https://example.test/pkg.tgz" },
    maxBytes: 16,
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, "TOO_LARGE");
});

/* ------------------------------------------------------------------------- */
/* pending 读写                                                                */
/* ------------------------------------------------------------------------- */

test("pending：不存在 → null；损坏 → null + warning；clearPending 清除", async (t) => {
  const dataDir = makeTmp(t);
  assert.equal(pendingPath(dataDir), path.join(dataDir, "updates", "pending.json"));
  const empty = readPending(dataDir);
  assert.equal(empty.ok, true);
  assert.equal(empty.pending, null);

  fs.mkdirSync(path.join(dataDir, "updates"), { recursive: true });
  fs.writeFileSync(pendingPath(dataDir), "{ this is not json");
  const corrupt = readPending(dataDir);
  assert.equal(corrupt.ok, true);
  assert.equal(corrupt.pending, null);
  assert.ok(corrupt.warnings.length >= 1);

  const cleared = clearPending(dataDir);
  assert.equal(cleared.ok, true);
  assert.equal(fs.existsSync(pendingPath(dataDir)), false);
});

/* ------------------------------------------------------------------------- */
/* applyPending 闸门                                                           */
/* ------------------------------------------------------------------------- */

test("applyPending：无 pending → NO_PENDING", async (t) => {
  const dataDir = makeTmp(t);
  const installDir = seedInstall(path.join(dataDir, "install"));
  const res = await applyPending({ dataDir, installDir });
  assert.equal(res.ok, false);
  assert.equal(res.code, "NO_PENDING");
});

test("applyPending：暂存目录不存在 → STAGED_MISSING", async (t) => {
  const dataDir = makeTmp(t);
  const installDir = seedInstall(path.join(dataDir, "install"));
  writePendingRaw(dataDir, {
    version: "0.2.0",
    dir: path.join(dataDir, "updates", "0.2.0"),
    packageName: PACKAGE,
  });
  const res = await applyPending({ dataDir, installDir });
  assert.equal(res.ok, false);
  assert.equal(res.code, "STAGED_MISSING");
});

test("applyPending：安装目录不存在 → INSTALL_MISSING", async (t) => {
  const dataDir = makeTmp(t);
  seedStaged(dataDir);
  const res = await applyPending({ dataDir, installDir: path.join(dataDir, "nope") });
  assert.equal(res.ok, false);
  assert.equal(res.code, "INSTALL_MISSING");
});

test("applyPending：junction 安装 → JUNCTION_INSTALL（无权限创建时跳过）", async (t) => {
  const dataDir = makeTmp(t);
  const realInstall = seedInstall(path.join(dataDir, "real-install"));
  const junctionPath = path.join(dataDir, "linked-install");
  try {
    fs.symlinkSync(realInstall, junctionPath, "junction");
  } catch (err) {
    // Windows 上创建 junction 一般不需要管理员权限；若被策略/权限拒绝则跳过，
    // 该分支只能靠人工在真实 junction 环境里验证。
    t.skip(`无法创建 junction（${err.code || err.message}），跳过该用例`);
    return;
  }
  seedStaged(dataDir, { files: { "lib/index.js": "new" } });
  const res = await applyPending({ dataDir, installDir: junctionPath });
  assert.equal(res.ok, false);
  assert.equal(res.code, "JUNCTION_INSTALL");
  assert.match(res.message, /junction|symlink/);
  assert.match(res.message, /手工安装|退出 DSH/);
  // 不存在副作用：真实安装目录未被写入
  assert.equal(fs.existsSync(path.join(realInstall, "lib/index.js")), false);
});

test("applyPending：已安装包名不符 → NAME_MISMATCH", async (t) => {
  const dataDir = makeTmp(t);
  const installDir = seedInstall(path.join(dataDir, "install"), { name: "other-plugin" });
  seedStaged(dataDir);
  const res = await applyPending({ dataDir, installDir });
  assert.equal(res.ok, false);
  assert.equal(res.code, "NAME_MISMATCH");
});

test("applyPending：暂存 package.json 版本不符 → STAGED_INVALID", async (t) => {
  const dataDir = makeTmp(t);
  const installDir = seedInstall(path.join(dataDir, "install"));
  const stagedDir = seedStaged(dataDir, { version: "0.2.0" });
  fs.writeFileSync(path.join(stagedDir, "package.json"), JSON.stringify({ name: PACKAGE, version: "9.9.9" }));
  const res = await applyPending({ dataDir, installDir });
  assert.equal(res.ok, false);
  assert.equal(res.code, "STAGED_INVALID");
  // 闸门不过不得碰安装目录
  assert.equal(JSON.parse(fs.readFileSync(path.join(installDir, "package.json"), "utf8")).version, "0.1.2");
});

/* ------------------------------------------------------------------------- */
/* applyPending 成功 / 失败回滚                                                 */
/* ------------------------------------------------------------------------- */

test("applyPending：成功应用、备份、记录 last-apply、清 pending", async (t) => {
  const dataDir = makeTmp(t);
  const installDir = seedInstall(path.join(dataDir, "install"), {
    files: { "lib/old.js": "old-lib", "README.md": "keep-me" },
  });
  seedStaged(dataDir, {
    version: "0.2.0",
    files: { "lib/index.js": "new-lib", "src/host/updater.mjs": "// updater" },
  });

  const res = await applyPending({ dataDir, installDir });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.applied, true);
  assert.equal(res.from, "0.1.2");
  assert.equal(res.to, "0.2.0");
  assert.equal(res.restartRequired, true);
  assert.equal(res.fileCount, 3);

  // 新文件落盘
  assert.equal(fs.readFileSync(path.join(installDir, "lib/index.js"), "utf8"), "new-lib");
  assert.equal(fs.readFileSync(path.join(installDir, "src/host/updater.mjs"), "utf8"), "// updater");
  // 不删除安装目录里多余的文件
  assert.equal(fs.readFileSync(path.join(installDir, "lib/old.js"), "utf8"), "old-lib");
  assert.equal(fs.readFileSync(path.join(installDir, "README.md"), "utf8"), "keep-me");
  // package.json 已更新
  assert.equal(JSON.parse(fs.readFileSync(path.join(installDir, "package.json"), "utf8")).version, "0.2.0");

  // 备份存在且含旧版本文件
  assert.ok(fs.existsSync(res.backupDir));
  assert.equal(fs.readFileSync(path.join(res.backupDir, "package.json"), "utf8").includes("0.1.2"), true);
  assert.equal(fs.readFileSync(path.join(res.backupDir, "lib/old.js"), "utf8"), "old-lib");
  // last-apply.json
  const lastApplyFile = path.join(dataDir, "updates", "last-apply.json");
  const record = JSON.parse(fs.readFileSync(lastApplyFile, "utf8"));
  assert.equal(record.from, "0.1.2");
  assert.equal(record.to, "0.2.0");
  assert.equal(record.installDir, installDir);
  assert.ok(Array.isArray(record.files) && record.files.length === 3);
  // pending 已清
  assert.equal(fs.existsSync(pendingPath(dataDir)), false);
});

test("applyPending：复制失败 → APPLY_FAILED 且用备份回滚", async (t) => {
  const dataDir = makeTmp(t);
  const installDir = seedInstall(path.join(dataDir, "install"), {
    files: { "aaa.js": "old-aaa", "zzz": "i-am-a-file-not-a-dir" },
  });
  // 暂存里 zzz/extra.txt 需要把 zzz 当目录 —— 与安装目录里的同名文件冲突，复制必然失败
  seedStaged(dataDir, {
    version: "0.2.0",
    files: { "aaa.js": "new-aaa", "zzz/extra.txt": "boom" },
  });

  const res = await applyPending({ dataDir, installDir });
  assert.equal(res.ok, false);
  assert.equal(res.code, "APPLY_FAILED");
  assert.equal(res.rolledBack, true);
  // 已覆盖的 aaa.js 应恢复旧内容
  assert.equal(fs.readFileSync(path.join(installDir, "aaa.js"), "utf8"), "old-aaa");
  // package.json 也应恢复 0.1.2
  assert.equal(JSON.parse(fs.readFileSync(path.join(installDir, "package.json"), "utf8")).version, "0.1.2");
  // pending 被清空
  assert.equal(fs.existsSync(pendingPath(dataDir)), false);
});

/* ------------------------------------------------------------------------- */
/* rollbackLast                                                               */
/* ------------------------------------------------------------------------- */

test("rollbackLast：按 last-apply 备份恢复旧版本", async (t) => {
  const dataDir = makeTmp(t);
  const installDir = seedInstall(path.join(dataDir, "install"), {
    files: { "lib/old.js": "old-lib" },
  });
  seedStaged(dataDir, { version: "0.2.0", files: { "lib/index.js": "new-lib" } });
  const applied = await applyPending({ dataDir, installDir });
  assert.equal(applied.ok, true, JSON.stringify(applied));
  assert.equal(JSON.parse(fs.readFileSync(path.join(installDir, "package.json"), "utf8")).version, "0.2.0");

  const rolled = await rollbackLast({ dataDir, installDir });
  assert.equal(rolled.ok, true, JSON.stringify(rolled));
  assert.equal(rolled.restored, true);
  assert.equal(rolled.from, "0.2.0");
  assert.equal(rolled.to, "0.1.2");
  assert.equal(JSON.parse(fs.readFileSync(path.join(installDir, "package.json"), "utf8")).version, "0.1.2");
  // 新增文件在回滚时删除（备份里没有它）
  assert.equal(fs.existsSync(path.join(installDir, "lib/index.js")), false);
  assert.equal(fs.readFileSync(path.join(installDir, "lib/old.js"), "utf8"), "old-lib");
});

test("rollbackLast：无记录 → NO_LAST_APPLY", async (t) => {
  const dataDir = makeTmp(t);
  const installDir = seedInstall(path.join(dataDir, "install"));
  const res = await rollbackLast({ dataDir, installDir });
  assert.equal(res.ok, false);
  assert.equal(res.code, "NO_LAST_APPLY");
});

/* ------------------------------------------------------------------------- */
/* updateStatus / UpdateService                                                */
/* ------------------------------------------------------------------------- */

test("updateStatus：有 pending 时 newerPending=true，应用后出现 lastApply", async (t) => {
  const dataDir = makeTmp(t);
  const installDir = seedInstall(path.join(dataDir, "install"));
  seedStaged(dataDir, { version: "0.2.0" });

  const before = updateStatus(dataDir, { currentVersion: "0.1.2" });
  assert.equal(before.ok, true);
  assert.equal(before.current, "0.1.2");
  assert.equal(before.pending.version, "0.2.0");
  assert.equal(before.newerPending, true);
  assert.equal(before.lastApply, null);

  const applied = await applyPending({ dataDir, installDir });
  assert.equal(applied.ok, true, JSON.stringify(applied));
  const after = updateStatus(dataDir, { currentVersion: "0.1.2" });
  assert.equal(after.pending, null);
  assert.equal(after.newerPending, false);
  assert.equal(after.lastApply.from, "0.1.2");
  assert.equal(after.lastApply.to, "0.2.0");
});

test("UpdateService：check / stage / apply / rollback / status 复用纯函数", async (t) => {
  const dataDir = makeTmp(t);
  const installDir = seedInstall(path.join(dataDir, "install"));
  const tgz = makePackageTgz({ version: "0.2.0" });
  const service = new UpdateService({
    dataDir,
    installDir,
    currentVersion: "0.1.2",
    fetchImpl: async (url) => {
      if (url === `https://registry.npmjs.org/${PACKAGE}`) {
        return jsonResponse(registryDoc("0.2.0", { integrity: integrityFor(tgz) }));
      }
      return bufferResponse(tgz);
    },
  });

  const checked = await service.check();
  assert.equal(checked.ok, true);
  assert.equal(checked.updateAvailable, true);

  const staged = await service.stage(checked);
  assert.equal(staged.ok, true, JSON.stringify(staged));
  assert.equal(service.status().pending.version, "0.2.0");

  const applied = await service.apply();
  assert.equal(applied.ok, true, JSON.stringify(applied));
  assert.equal(service.status().pending, null);

  const rolled = await service.rollback();
  assert.equal(rolled.ok, true, JSON.stringify(rolled));
  assert.equal(JSON.parse(fs.readFileSync(path.join(installDir, "package.json"), "utf8")).version, "0.1.2");
});
