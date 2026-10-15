import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { RegistryStore } from "../src/shared/registry-store.mjs";
import { TeamService } from "../src/shared/team-service.mjs";
import { emptyRegistry, createGroup, addMember } from "../src/shared/registry-core.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP_ROOT = path.join(HERE, ".tmp");
const NOW = "2026-10-15T06:00:00.000Z";
const now = () => NOW;

let seq = 0;
function freshStore() {
  const dir = path.join(TMP_ROOT, `case-${++seq}-${Date.now().toString(36)}`);
  fs.mkdirSync(dir, { recursive: true });
  return { dir, file: path.join(dir, "registry.json"), store: new RegistryStore({ file: path.join(dir, "registry.json"), now }) };
}

after(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

/* ================= RegistryStore ================= */

test("store: 文件不存在时返回空名册并标记 created", () => {
  const { store } = freshStore();
  const r = store.load();
  assert.equal(r.created, true);
  assert.deepEqual(r.registry.members, []);
  assert.equal(r.recovered, false);
  assert.ok(r.warnings.length > 0);
});

test("store: save → load 往返一致，且第二次 save 生成 .bak", () => {
  const { store } = freshStore();
  let reg = emptyRegistry(NOW);
  reg = createGroup(reg, { id: "g-1", name: "数据组" }, NOW);
  reg = addMember(reg, { target: "data-organizer", displayName: "数据整理员", groupId: "g-1" }, NOW);

  store.save(reg);
  assert.equal(fs.existsSync(store.backupFile), false, "首次保存无旧文件，不应产生 .bak");

  const loaded = store.load();
  assert.deepEqual(loaded.registry.members.map((m) => m.target), ["data-organizer"]);
  assert.equal(loaded.registry.members[0].displayName, "数据整理员");

  store.save(loaded.registry);
  assert.equal(fs.existsSync(store.backupFile), true, "第二次保存应产生 .bak");
});

test("store: 写入是原子且无临时文件残留", () => {
  const { dir, store } = freshStore();
  store.save(emptyRegistry(NOW));
  const leftovers = fs.readdirSync(dir).filter((f) => f.includes(".tmp"));
  assert.deepEqual(leftovers, []);
});

test("store: 非法 JSON 被隔离，回退空名册而不是抛错", () => {
  const { store } = freshStore();
  fs.writeFileSync(store.file, "{ 这不是 JSON ", "utf8");
  const r = store.load();
  assert.equal(r.recovered, true);
  assert.deepEqual(r.registry.members, []);
  assert.ok(r.quarantine && fs.existsSync(r.quarantine), "坏文件应被隔离保存");
  assert.match(fs.readFileSync(r.quarantine, "utf8"), /这不是 JSON/);
});

test("store: 结构损坏（悬空 groupId / 重复 target）被归一化并可继续使用", () => {
  const { store } = freshStore();
  fs.writeFileSync(
    store.file,
    JSON.stringify({
      version: 1,
      groups: [{ id: "g-1", name: "组一" }],
      members: [
        { target: "a-member", groupId: "g-404" },
        { target: "a-member" },
        { target: "中文名" },
      ],
    }),
    "utf8",
  );
  const r = store.load();
  assert.deepEqual(r.registry.members.map((m) => m.target), ["a-member"]);
  assert.equal(r.registry.members[0].groupId, null);
  assert.ok(r.warnings.some((w) => w.includes("groupId")));
  // 归一化结果可再次安全写入
  const res = store.save(r.registry);
  assert.ok(res.bytes > 0);
});

test("store: version 缺失/偏低/偏高都有告警，且不丢字段", () => {
  const { store } = freshStore();
  fs.writeFileSync(store.file, JSON.stringify({ groups: [], members: [] }), "utf8");
  assert.ok(store.load().warnings.some((w) => w.includes("version")));

  fs.writeFileSync(store.file, JSON.stringify({ version: 0, groups: [], members: [] }), "utf8");
  assert.ok(store.load().warnings.some((w) => w.includes("低于当前")));

  fs.writeFileSync(store.file, JSON.stringify({ version: 99, groups: [], members: [] }), "utf8");
  const r = store.load();
  assert.ok(r.warnings.some((w) => w.includes("高于插件支持")));
  assert.equal(r.registry.version, 1);
});

test("store: update 中 mutator 抛错时不写盘（原文件保持不变）", () => {
  const { store } = freshStore();
  let reg = emptyRegistry(NOW);
  reg = addMember(reg, { target: "keep-me" }, NOW);
  store.save(reg);
  const before = fs.readFileSync(store.file, "utf8");

  assert.throws(
    () => store.update(() => {
      throw new Error("模拟业务失败");
    }),
    /模拟业务失败/,
  );
  assert.equal(fs.readFileSync(store.file, "utf8"), before, "失败时不得改动磁盘");

  // 由 registry-core 抛出的 RegistryError 同样不写盘
  assert.throws(() => store.update((r) => addMember(r, { target: "中文名" }, NOW)), (e) => e.code === "INVALID_TARGET");
  assert.equal(fs.readFileSync(store.file, "utf8"), before);
});

test("store: 拒绝写入不合法名册", () => {
  const { store } = freshStore();
  assert.throws(() => store.save({ version: 1, groups: [], members: [{ target: "非法 名" }] }), (e) => e.code === "INVALID_REGISTRY");
});

/* ================= TeamService ================= */

function freshService(liveTargets = () => []) {
  const { store } = freshStore();
  return new TeamService({ store, liveTargets, now });
}

test("service: 空名册视图可用，且核心成员被列为「未登记」", () => {
  const svc = freshService(() => ["lead", "data-organizer"]);
  const v = svc.view();
  assert.deepEqual(v.unregistered, ["data-organizer", "lead"]);
  assert.equal(v.stats.members, 0);
  assert.ok(svc.text().includes("未登记"));
});

test("service: addMember 返回结果对象，错误码可读（不抛异常）", () => {
  const svc = freshService();
  assert.equal(svc.addMember({ target: "data-organizer", displayName: "数据整理员" }).ok, true);
  const dup = svc.addMember({ target: "data-organizer" });
  assert.equal(dup.ok, false);
  assert.equal(dup.code, "MEMBER_EXISTS");
  const cn = svc.addMember({ target: "数据整理员" });
  assert.equal(cn.ok, false);
  assert.equal(cn.code, "INVALID_TARGET");
});

test("service: registerLive 批量登记（含 Lead），已存在的跳过", () => {
  const svc = freshService(() => ["lead", "data-organizer", "data-verifier"]);
  svc.addMember({ target: "data-organizer", displayName: "数据整理员" });
  const r = svc.registerLive();
  assert.equal(r.ok, true);
  // lead 也是真实团队成员，必须能被登记 —— 否则组织架构会缺掉团队负责人
  assert.deepEqual(r.data.added, ["lead", "data-verifier"]);
  assert.deepEqual(r.data.skipped, ["data-organizer"]);
  assert.deepEqual(svc.unregistered(), []);
});

test("service: registerLive 过滤非法 target，不污染名册", () => {
  const svc = freshService();
  const r = svc.registerLive(["good-one", "非法 名", "", "UPPER"]);
  assert.deepEqual(r.data.added, ["good-one"]);
  assert.equal(svc.view().stats.members, 1);
});

test("service: 重命名后显示名为中文，target 不变；核心列表不受影响", () => {
  const live = ["data-organizer"];
  const svc = freshService(() => live);
  svc.addMember({ target: "data-organizer", displayName: "旧名" });
  assert.equal(svc.renameMember("data-organizer", { displayName: "数据整理员" }).ok, true);

  const m = svc.getMember("data-organizer");
  assert.equal(m.data.displayName, "数据整理员");
  assert.equal(m.data.target, "data-organizer");
  assert.deepEqual(live, ["data-organizer"], "插件不应改动核心成员列表");
});

test("service: 软删除后默认视图仍可统计，可恢复；重复操作返回错误码", () => {
  const svc = freshService(() => ["doc-writer"]);
  svc.addMember({ target: "doc-writer", displayName: "文档生成员" });
  assert.equal(svc.removeMember("doc-writer").ok, true);
  let m = svc.getMember("doc-writer");
  assert.equal(m.data.status, "retired");
  assert.equal(m.data.retiredAt, NOW);

  const again = svc.removeMember("doc-writer");
  assert.equal(again.ok, false);
  assert.equal(again.code, "ALREADY_RETIRED");

  assert.equal(svc.restoreMember("doc-writer").ok, true);
  assert.equal(svc.getMember("doc-writer").data.status, "active");
  assert.equal(svc.view().stats.retired, 0);
});

test("service: 岗位职责与技能可写可读", () => {
  const svc = freshService();
  svc.addMember({ target: "data-organizer" });
  assert.equal(svc.setRole("data-organizer", { title: "知识库整理员", duties: ["清点", "诊断"] }).ok, true);
  assert.equal(svc.setSkills("data-organizer", { skills: ["file-processing-master"] }).ok, true);
  assert.equal(svc.setSkills("data-organizer", { add: ["office-docx"] }).ok, true);

  const m = svc.getMember("data-organizer").data;
  assert.equal(m.title, "知识库整理员");
  assert.deepEqual(m.duties, ["清点", "诊断"]);
  assert.deepEqual(m.skills, ["file-processing-master", "office-docx"]);

  const missing = svc.setRole("nobody-here", { title: "x" });
  assert.equal(missing.code, "MEMBER_NOT_FOUND");
});

test("service: 小组增删改与归档，删除小组不丢成员", () => {
  const svc = freshService();
  assert.equal(svc.createGroup({ id: "g-1", name: "数据组" }).ok, true);
  assert.equal(svc.createGroup({ id: "g-2", name: "文档组", order: 2 }).ok, true);
  svc.addMember({ target: "a-member", groupId: "g-1" });
  svc.addMember({ target: "b-member", groupId: "g-1" });

  assert.equal(svc.renameGroup("g-1", { name: "数据与核查组" }).ok, true);
  assert.equal(svc.assignGroup("b-member", "g-2").ok, true);

  const notEmpty = svc.deleteGroup("g-1", { unassignMembers: false });
  assert.equal(notEmpty.code, "GROUP_NOT_EMPTY");

  assert.equal(svc.deleteGroup("g-1").ok, true);
  const v = svc.view();
  assert.equal(v.stats.members, 2, "删组不应删人");
  assert.equal(v.groups.length, 1);
  assert.deepEqual(v.ungrouped.map((m) => m.target), ["a-member"]);
});

test("service: 组织架构按小组分区渲染中文文本", () => {
  const svc = freshService(() => ["data-organizer"]);
  svc.createGroup({ id: "g-1", name: "数据组", description: "知识库与核查" });
  svc.addMember({ target: "data-organizer", displayName: "数据整理员", groupId: "g-1" });
  svc.setRole("data-organizer", { title: "知识库整理员", duties: ["清点"] });

  const t = svc.text();
  assert.match(t, /【数据组】 — 知识库与核查/);
  assert.match(t, /数据整理员 \(data-organizer\) · 知识库整理员/);
});

test("service: 孤儿 / 未登记 判定正确", () => {
  const svc = freshService(() => ["data-organizer", "brand-new"]);
  svc.addMember({ target: "data-organizer" });
  svc.addMember({ target: "gone-member" });
  assert.deepEqual(svc.unregistered(), ["brand-new"]);
  assert.deepEqual(svc.orphans(), ["gone-member"]);
  const v = svc.view();
  assert.equal(v.stats.orphans, 1);
  assert.equal(v.stats.unregistered, 1);
});

test("service: liveTargets 抛异常时视图仍可用（不把宿主异常带崩）", () => {
  const svc = freshService(() => {
    throw new Error("核心读取失败");
  });
  svc.addMember({ target: "solo" });
  const v = svc.view();
  assert.equal(v.stats.members, 1);
  assert.equal(v.stats.orphans, 0, "读不到核心时不得误判为孤儿");
  assert.deepEqual(v.unregistered, []);
});

test("service: 多次写操作后数据持久化一致（重新建 store 读取）", () => {
  const { store } = freshStore();
  const svc = new TeamService({ store, liveTargets: () => ["a-member", "b-member"], now });
  svc.createGroup({ id: "g-1", name: "组一" });
  svc.addMember({ target: "a-member", displayName: "成员甲", groupId: "g-1" });
  svc.addMember({ target: "b-member", displayName: "成员乙" });
  svc.setRole("a-member", { title: "整理员", duties: ["甲职责"] });
  svc.removeMember("b-member");

  const reopened = new TeamService({ store: new RegistryStore({ file: store.file, now }), liveTargets: () => ["a-member", "b-member"], now });
  const v = reopened.view();
  assert.equal(v.stats.members, 2);
  assert.equal(v.stats.retired, 1);
  assert.equal(reopened.getMember("a-member").data.displayName, "成员甲");
  assert.deepEqual(reopened.getMember("a-member").data.duties, ["甲职责"]);
  assert.equal(reopened.getMember("b-member").data.status, "retired");
});
