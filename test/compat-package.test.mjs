// 旧包名兼容转发包（compat/dsh-plugin-member-manager）的契约测试。
// 目的：发布到 npm 前就能确认「旧名 -> 新包」的元数据与转发导出是完整的。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, cpSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMPAT = path.join(ROOT, "compat", "dsh-plugin-member-manager");

test("兼容包元数据：沿用旧名、依赖新包、bundle/client 元数据齐全", () => {
  const pkg = JSON.parse(readFileSync(path.join(COMPAT, "package.json"), "utf8"));
  assert.equal(pkg.name, "dsh-plugin-member-manager");
  assert.match(pkg.version, /^\d+\.\d+\.\d+/);
  assert.equal(pkg.dependencies["dsh-member-manager"], "^0.3.0");
  assert.equal(pkg.dsh.bundle.patch, "./cordis.patch.yml");
  assert.equal(pkg.dsh.client.platform, "web");
  assert.ok(Array.isArray(pkg.dsh.client.inject) && pkg.dsh.client.inject.length > 0);
  assert.equal(pkg.exports["."], "./lib/index.js");
  assert.equal(pkg.exports["./client"], "./lib/client.js");
  assert.deepEqual([...pkg.files].sort(), ["README.md", "cordis.patch.yml", "lib"].sort());
});

test("兼容包转发导出：旧包入口解析到 dsh-member-manager 的实现", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "dsh-compat-"));
  try {
    const nm = path.join(tmp, "node_modules");
    mkdirSync(nm, { recursive: true });
    // 复制（而非软链）转发包，确保 Node 从 tmp/node_modules 解析依赖 "dsh-member-manager"
    cpSync(COMPAT, path.join(nm, "dsh-plugin-member-manager"), { recursive: true });
    symlinkSync(ROOT, path.join(nm, "dsh-member-manager"), "junction");
    const entry = pathToFileURL(path.join(nm, "dsh-plugin-member-manager", "lib", "index.js")).href;
    return import(entry).then((mod) => {
      assert.equal(mod.name, "dsh-member-manager", "转发后的插件名应仍是新包名");
      assert.deepEqual(mod.inject, ["tools", "webServer"]);
      assert.equal(typeof mod.apply, "function");
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("兼容包挂载声明与弃用说明：旧名 insert + 指向新包", () => {
  const patch = readFileSync(path.join(COMPAT, "cordis.patch.yml"), "utf8");
  assert.match(patch, /id:\s*dsh-plugin-member-manager/);
  assert.match(patch, /name:\s*dsh-plugin-member-manager/);
  const readme = readFileSync(path.join(COMPAT, "README.md"), "utf8");
  assert.ok(readme.includes("dsh-member-manager"));
  assert.ok(readme.includes("弃用") || readme.includes("Deprecated"));
  const client = readFileSync(path.join(COMPAT, "lib", "client.js"), "utf8");
  assert.ok(client.includes("export * from \"dsh-member-manager/client\""));
});
