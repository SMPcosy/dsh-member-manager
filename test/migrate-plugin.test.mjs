/**
 * migrate-plugin.test.mjs —— 旧包 → 新包「一键迁移」脚本自检（不碰真实 ~/.dsh）
 *
 * 覆盖：
 *   - 默认 dry-run 不写 profile、不写迁移标记；
 *   - --apply 改写临时 profile 的 dependencies / bundles / cordis.yml、删除旧包目录、写入迁移标记；
 *   - --mode link 写入 link: 依赖；
 *   - --data-only 只写迁移标记（profile 已切换的用户）；
 *   - profile 缺失时明确报错退出；
 *   - 已存在迁移标记时不覆盖（幂等）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const OLD = "dsh-plugin-member-manager";
const NEW = "dsh-member-manager";
const SCRIPT = "migrate-old-plugin.mjs";

function run(args, { expectFail = false } = {}) {
  try {
    const stdout = execFileSync(process.execPath, [path.join(REPO, "scripts", SCRIPT), ...args], {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120000,
    });
    assert.equal(expectFail, false, `期望失败但退出 0：${SCRIPT} ${args.join(" ")}`);
    return { status: 0, stdout };
  } catch (err) {
    if (!expectFail) throw err;
    return { status: err.status ?? 1, stdout: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

function ownVersion() {
  return JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8")).version;
}

function makeHome({ withOld = true, withRegistry = true } = {}) {
  const home = mkdtempSync(path.join(os.tmpdir(), "dmm-migrate-"));
  const dir = path.join(home, "profiles", "desktop");
  mkdirSync(path.join(dir, "node_modules", "dsh-plugin-member-manager"), { recursive: true });
  const deps = withOld ? { [OLD]: "link:/old/plugin/dir" } : {};
  const bundles = withOld ? [OLD] : [];
  writeFileSync(
    path.join(dir, "package.json"),
    `${JSON.stringify({ name: "desktop-profile", dependencies: deps, dsh: { profile: { bundles } } }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    path.join(dir, "cordis.yml"),
    `# test profile\n- insert:\n    - id: ${OLD}\n      name: ${OLD}\n`,
    "utf8",
  );
  const dataDir = path.join(home, "storages", "member-manager");
  mkdirSync(dataDir, { recursive: true });
  if (withRegistry) {
    writeFileSync(
      path.join(dataDir, "registry.json"),
      JSON.stringify({
        version: 1,
        groups: [{ id: "g1", name: "老小组", members: [{ target: "u1", status: "active", displayName: "张三" }] }],
        members: [{ target: "u1", status: "active", displayName: "张三" }],
      }),
      "utf8",
    );
  }
  return { home, dataDir, profileDir: dir };
}

function profilePkg(home) {
  return JSON.parse(readFileSync(path.join(home, "profiles", "desktop", "package.json"), "utf8"));
}
function profileCordis(home) {
  return readFileSync(path.join(home, "profiles", "desktop", "cordis.yml"), "utf8");
}
function markerPath(dataDir) {
  return path.join(dataDir, "pending-migration.json");
}

test("迁移脚本默认 dry-run 不写 profile / 不写迁移标记", () => {
  const { home, dataDir } = makeHome();
  const pkgBefore = readFileSync(path.join(home, "profiles", "desktop", "package.json"), "utf8");
  const cordisBefore = profileCordis(home);
  const { stdout } = run(["--home", home]);
  assert.match(stdout, /DRY-RUN/);
  assert.match(stdout, new RegExp(OLD));
  assert.equal(readFileSync(path.join(home, "profiles", "desktop", "package.json"), "utf8"), pkgBefore);
  assert.equal(profileCordis(home), cordisBefore);
  assert.equal(existsSync(markerPath(dataDir)), false);
});

test("迁移脚本 --apply 改写 profile、删除旧包目录并写入迁移标记", () => {
  const { home, dataDir, profileDir } = makeHome();
  const { stdout } = run(["--home", home, "--apply"]);
  assert.match(stdout, /APPLY/);
  assert.match(stdout, /数据迁移标记已写入/);

  const pkg = profilePkg(home);
  assert.equal(pkg.dependencies[OLD], undefined);
  assert.equal(pkg.dependencies[NEW], `^${ownVersion()}`);
  assert.deepEqual(pkg.dsh.profile.bundles, [NEW]);
  const cordis = profileCordis(home);
  assert.equal(cordis.includes(OLD), false);
  assert.equal(cordis.includes(NEW), true);
  assert.equal(existsSync(path.join(profileDir, "node_modules", OLD)), false);

  const marker = JSON.parse(readFileSync(markerPath(dataDir), "utf8"));
  assert.equal(marker.version, 1);
  assert.equal(marker.source, "migrate-old-plugin");
  assert.equal(marker.mode, "npm");
  assert.equal(marker.pluginVersion, ownVersion());
  // registry.json 不应被脚本改动
  const reg = JSON.parse(readFileSync(path.join(dataDir, "registry.json"), "utf8"));
  assert.equal(reg.groups.length, 1);
});

test("迁移脚本 --mode link 写入 link 依赖；已存在的迁移标记不覆盖", () => {
  const { home, dataDir } = makeHome();
  const first = run(["--home", home, "--mode", "link", "--target", REPO, "--apply"]);
  assert.match(first.stdout, /link:/);
  const pkg = profilePkg(home);
  assert.match(pkg.dependencies[NEW], /^link:/);
  const markerBefore = readFileSync(markerPath(dataDir), "utf8");
  const second = run(["--home", home, "--apply"]);
  assert.match(second.stdout, /已存在迁移标记，保留/);
  assert.equal(readFileSync(markerPath(dataDir), "utf8"), markerBefore);
});

test("--data-only 只写迁移标记，不改 profile", () => {
  const { home, dataDir } = makeHome({ withOld: false });
  const pkgBefore = readFileSync(path.join(home, "profiles", "desktop", "package.json"), "utf8");
  const { stdout } = run(["--home", home, "--data-only", "--apply"]);
  assert.match(stdout, /data-only/);
  assert.equal(existsSync(markerPath(dataDir)), true);
  assert.equal(readFileSync(path.join(home, "profiles", "desktop", "package.json"), "utf8"), pkgBefore);
});

test("profile 缺失时报错退出（--data-only 不需要 profile）", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "dmm-migrate-noprof-"));
  const { status, stdout } = run(["--home", home], { expectFail: true });
  assert.notEqual(status, 0);
  assert.match(stdout, /找不到 profile/);
});
