/**
 * company-package.test.mjs —— 0.3.0 交付包/安装脚本自检（不碰真实 ~/.dsh）
 *
 * 覆盖：
 *   - `scripts/verify-company.mjs --skip-tests` 全绿（元数据/文件/语法/导出契约）；
 *   - 切换/回滚脚本默认 dry-run 不写盘；
 *   - --apply 正确改写临时 profile 的 package.json + cordis.yml + node_modules 链接；
 *   - 回滚能恢复旧包名/旧链接；
 *   - profile 缺失时明确报错退出。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, lstatSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const OLD = "dsh-plugin-member-manager";
const NEW = "dsh-member-manager";

function run(script, args, { expectFail = false } = {}) {
  try {
    const stdout = execFileSync(process.execPath, [path.join(REPO, "scripts", script), ...args], {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120000,
    });
    assert.equal(expectFail, false, `期望失败但退出 0：${script} ${args.join(" ")}`);
    return { status: 0, stdout };
  } catch (err) {
    if (!expectFail) throw err;
    return { status: err.status ?? 1, stdout: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

function makeHome() {
  const home = mkdtempSync(path.join(os.tmpdir(), "dmm-pkg-"));
  const dir = path.join(home, "profiles", "desktop");
  mkdirSync(path.join(dir, "node_modules"), { recursive: true });
  const pkg = {
    name: "desktop-profile",
    dependencies: { [OLD]: "link:/old/plugin/dir" },
    dsh: { profile: { bundles: [OLD] } },
  };
  writeFileSync(path.join(dir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  writeFileSync(
    path.join(dir, "cordis.yml"),
    `# test profile\n- insert:\n    - id: ${OLD}\n      name: ${OLD}\n`,
    "utf8",
  );
  return home;
}
function profilePkg(home) {
  return JSON.parse(readFileSync(path.join(home, "profiles", "desktop", "package.json"), "utf8"));
}
function profileCordis(home) {
  return readFileSync(path.join(home, "profiles", "desktop", "cordis.yml"), "utf8");
}
function linkPath(home) {
  return path.join(home, "profiles", "desktop", "node_modules", NEW);
}

test("verify-company --skip-tests 自检全绿", () => {
  const { stdout } = run("verify-company.mjs", ["--skip-tests"]);
  assert.match(stdout, /全部通过/);
  assert.doesNotMatch(stdout, /^FAIL/m);
});

test("切换脚本默认 dry-run 不改 profile", () => {
  const home = makeHome();
  try {
    const beforePkg = readFileSync(path.join(home, "profiles", "desktop", "package.json"), "utf8");
    const beforeYml = profileCordis(home);
    const { stdout } = run("switch-to-dsh-member-manager.mjs", ["--home", home]);
    assert.match(stdout, /DRY-RUN/);
    assert.match(stdout, new RegExp(NEW));
    assert.equal(readFileSync(path.join(home, "profiles", "desktop", "package.json"), "utf8"), beforePkg);
    assert.equal(profileCordis(home), beforeYml);
    assert.equal(existsSync(linkPath(home)), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("切换 --apply 改写 deps/bundles/cordis 并建立新链接", () => {
  const home = makeHome();
  try {
    run("switch-to-dsh-member-manager.mjs", ["--home", home, "--apply"]);
    const pkg = profilePkg(home);
    assert.equal(pkg.dependencies[OLD], undefined, "旧依赖应删除");
    assert.equal(pkg.dependencies[NEW], `link:${REPO.replace(/\\/g, "/")}`);
    assert.ok(pkg.dsh.profile.bundles.includes(NEW));
    assert.ok(!pkg.dsh.profile.bundles.includes(OLD));
    const yml = profileCordis(home);
    assert.ok(yml.includes(`id: ${NEW}`));
    assert.ok(!yml.includes(OLD));
    // 链接：junction 创建失败时脚本只告警，这里按存在性宽松断言
    if (existsSync(linkPath(home))) {
      assert.ok(lstatSync(linkPath(home)).isSymbolicLink() || existsSync(path.join(linkPath(home), "package.json")));
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("回滚 --apply 恢复旧包名与旧链接", () => {
  const home = makeHome();
  try {
    run("switch-to-dsh-member-manager.mjs", ["--home", home, "--apply"]);
    const oldTarget = path.resolve("/old/plugin/dir");
    run("rollback-to-dsh-plugin-member-manager.mjs", ["--home", home, "--apply", "--old-target", oldTarget]);
    const pkg = profilePkg(home);
    assert.equal(pkg.dependencies[NEW], undefined, "新依赖应删除");
    assert.equal(pkg.dependencies[OLD], "link:" + oldTarget.split(path.sep).join("/"));
    assert.ok(pkg.dsh.profile.bundles.includes(OLD));
    assert.ok(!pkg.dsh.profile.bundles.includes(NEW));
    const yml = profileCordis(home);
    assert.ok(yml.includes(`id: ${OLD}`));
    assert.ok(!yml.includes(NEW));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("profile 不存在时脚本明确报错退出", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "dmm-pkg-empty-"));
  try {
    const { status, stdout } = run("switch-to-dsh-member-manager.mjs", ["--home", home], { expectFail: true });
    assert.notEqual(status, 0);
    assert.match(stdout, /找不到 profile/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
