import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RegistryError,
  addMember,
  assignGroup,
  buildTree,
  createGroup,
  deleteGroup,
  emptyRegistry,
  isSpawnableTarget,
  isValidMemberName,
  isValidTarget,
  normalizeRegistry,
  removeMember,
  renameMember,
  renderTreeText,
  setRole,
  setSkills,
  validateRegistry,
} from "../src/shared/registry-core.mjs";

const NOW = "2026-10-15T05:40:00.000Z";

/** 建一个含 2 组 3 人的名册 */
function fixture() {
  let reg = emptyRegistry(NOW);
  reg = createGroup(reg, { id: "g-1", name: "数据组", order: 1, description: "知识库与核查" }, NOW);
  reg = createGroup(reg, { id: "g-2", name: "文档组", order: 2 }, NOW);
  reg = addMember(reg, { target: "data-organizer", displayName: "数据整理员", groupId: "g-1" }, NOW);
  reg = addMember(reg, { target: "data-verifier", displayName: "数据核查员", groupId: "g-1" }, NOW);
  reg = addMember(reg, { target: "doc-writer", displayName: "文档生成员", groupId: "g-2" }, NOW);
  return reg;
}

/* ---------------- 成员名校验（对应 DSH 核心硬约束） ---------------- */

test("isValidMemberName 接受合法 kebab-case，拒绝中文/大写/下划线/空", () => {
  for (const ok of ["data-organizer", "a", "kb2-org", "x-1-y", "lead"]) {
    assert.equal(isValidMemberName(ok), true, ok);
  }
  for (const bad of ["数据整理员", "Data-Organizer", "data_organizer", "", "  ", "-lead", "a--b", "a-", null, 7]) {
    assert.equal(isValidMemberName(bad), false, String(bad));
  }
});

test("isSpawnableTarget 才是 DSH spawn 约束：lead 可入名册但不可 spawn", () => {
  assert.equal(isSpawnableTarget("data-organizer"), true);
  assert.equal(isSpawnableTarget("lead"), false, "DSH spawn_teammate 禁止 lead");
  // 名册层必须能表示 Lead —— 否则组织架构会缺掉团队负责人
  assert.equal(isValidMemberName("lead"), true);
  assert.equal(isValidTarget("lead"), true, "isValidTarget 现在是名册语义，不再排除 lead");
});

test("addMember 可以把 Lead 登记进名册（组织架构不能没有负责人）", () => {
  const reg = addMember(emptyRegistry(NOW), { target: "lead", displayName: "负责人" }, NOW);
  assert.equal(reg.members[0].target, "lead");
  assert.equal(reg.members[0].displayName, "负责人");
  assert.equal(validateRegistry(reg).ok, true);
});

test("addMember 拒绝中文 target（与 DSH 实测行为一致）", () => {
  assert.throws(() => addMember(emptyRegistry(NOW), { target: "数据整理员" }, NOW), (e) => {
    assert.ok(e instanceof RegistryError);
    assert.equal(e.code, "INVALID_TARGET");
    return true;
  });
});

test("addMember 拒绝重复登记与不存在的小组", () => {
  const reg = fixture();
  assert.throws(() => addMember(reg, { target: "data-organizer" }, NOW), (e) => e.code === "MEMBER_EXISTS");
  assert.throws(() => addMember(reg, { target: "new-one", groupId: "g-404" }, NOW), (e) => e.code === "GROUP_NOT_FOUND");
});

test("addMember 未给 displayName 时回退为 target", () => {
  const reg = addMember(emptyRegistry(NOW), { target: "solo-member" }, NOW);
  assert.equal(reg.members[0].displayName, "solo-member");
  assert.equal(reg.members[0].status, "active");
});

/* ---------------- 重命名 ---------------- */

test("renameMember 只改显示名，target 保持不变（核心断言）", () => {
  const before = fixture();
  const after = renameMember(before, "data-organizer", { displayName: "知识库整理员" }, NOW);
  const m = after.members.find((x) => x.target === "data-organizer");
  assert.equal(m.displayName, "知识库整理员");
  assert.equal(m.target, "data-organizer");
  // 不可变：原对象未被改动
  assert.equal(before.members.find((x) => x.target === "data-organizer").displayName, "数据整理员");
});

test("renameMember 拒绝空显示名与超长显示名", () => {
  const reg = fixture();
  assert.throws(() => renameMember(reg, "data-organizer", { displayName: "   " }, NOW), (e) => e.code === "EMPTY_FIELD");
  assert.throws(() => renameMember(reg, "data-organizer", { displayName: "名".repeat(65) }, NOW), (e) => e.code === "FIELD_TOO_LONG");
});

test("renameMember 对不存在成员报 MEMBER_NOT_FOUND，且不给参数时报 NOTHING_TO_UPDATE", () => {
  const reg = fixture();
  assert.throws(() => renameMember(reg, "ghost-member", { displayName: "x" }, NOW), (e) => e.code === "MEMBER_NOT_FOUND");
  assert.throws(() => renameMember(reg, "data-organizer", {}, NOW), (e) => e.code === "NOTHING_TO_UPDATE");
});

/* ---------------- 软删除（用户说的「删除成员」） ---------------- */

test("removeMember 软删除后可恢复，且记录 retiredAt；重复操作被拒", () => {
  let reg = fixture();
  reg = removeMember(reg, "doc-writer", {}, NOW);
  let m = reg.members.find((x) => x.target === "doc-writer");
  assert.equal(m.status, "retired");
  assert.equal(m.retiredAt, NOW);
  assert.throws(() => removeMember(reg, "doc-writer", {}, NOW), (e) => e.code === "ALREADY_RETIRED");

  reg = removeMember(reg, "doc-writer", { restore: true }, NOW);
  m = reg.members.find((x) => x.target === "doc-writer");
  assert.equal(m.status, "active");
  assert.equal(m.retiredAt, null);
  assert.throws(() => removeMember(reg, "doc-writer", { restore: true }, NOW), (e) => e.code === "ALREADY_ACTIVE");
});

test("软删除只改名册，不产生核心副作用（成员条目仍在）", () => {
  const reg = removeMember(fixture(), "doc-writer", {}, NOW);
  assert.equal(reg.members.length, 3);
  assert.ok(reg.members.some((m) => m.target === "doc-writer"));
});

/* ---------------- 岗位职责与技能 ---------------- */

test("setRole 设置岗位名与职责列表，自动去重去空", () => {
  const reg = setRole(fixture(), "data-organizer", { title: "知识库整理员", duties: ["清点", "诊断", "清点", "  "] }, NOW);
  const m = reg.members.find((x) => x.target === "data-organizer");
  assert.equal(m.title, "知识库整理员");
  assert.deepEqual(m.duties, ["清点", "诊断"]);
});

test("setSkills 支持整体覆盖与增量增删", () => {
  let reg = setSkills(fixture(), "data-organizer", { skills: ["file-processing-master", "office-docx"] }, NOW);
  assert.deepEqual(reg.members.find((x) => x.target === "data-organizer").skills, ["file-processing-master", "office-docx"]);

  reg = setSkills(reg, "data-organizer", { add: ["office-xlsx"], remove: ["office-docx"] }, NOW);
  assert.deepEqual(reg.members.find((x) => x.target === "data-organizer").skills, ["file-processing-master", "office-xlsx"]);

  reg = setSkills(reg, "data-organizer", { skills: [] }, NOW);
  assert.deepEqual(reg.members.find((x) => x.target === "data-organizer").skills, []);
});

test("setRole/setSkills 拒绝非数组与非法元素", () => {
  const reg = fixture();
  assert.throws(() => setRole(reg, "data-organizer", { duties: "不是数组" }, NOW), (e) => e.code === "INVALID_FIELD");
  assert.throws(() => setRole(reg, "data-organizer", { duties: [1, 2] }, NOW), (e) => e.code === "INVALID_FIELD");
});

/* ---------------- 小组 ---------------- */

test("createGroup 拒绝重名 id；renameGroup/order 生效", () => {
  let reg = fixture();
  assert.throws(() => createGroup(reg, { id: "g-1", name: "重复" }, NOW), (e) => e.code === "GROUP_EXISTS");
  reg = createGroup(reg, { id: "g-3", name: "质检组", order: 0 }, NOW);
  assert.equal(reg.groups.find((g) => g.id === "g-3").order, 0);
});

test("deleteGroup 默认把组内成员置为未分组，不静默删人；可要求先清空", () => {
  let reg = fixture();
  assert.throws(() => deleteGroup(reg, "g-1", { unassignMembers: false }, NOW), (e) => e.code === "GROUP_NOT_EMPTY");
  reg = deleteGroup(reg, "g-1", {}, NOW);
  assert.equal(reg.groups.some((g) => g.id === "g-1"), false);
  assert.equal(reg.members.length, 3);
  assert.equal(reg.members.find((m) => m.target === "data-organizer").groupId, null);
});

test("assignGroup 校验目标小组存在，允许置为未分组", () => {
  let reg = fixture();
  assert.throws(() => assignGroup(reg, "data-organizer", "g-404", NOW), (e) => e.code === "GROUP_NOT_FOUND");
  reg = assignGroup(reg, "data-organizer", "g-2", NOW);
  assert.equal(reg.members.find((m) => m.target === "data-organizer").groupId, "g-2");
  reg = assignGroup(reg, "data-organizer", null, NOW);
  assert.equal(reg.members.find((m) => m.target === "data-organizer").groupId, null);
});

/* ---------------- 校验 / 归一化 / 视图 ---------------- */

test("validateRegistry 能发现结构损坏（版本、重复、悬空 groupId）", () => {
  const good = fixture();
  assert.equal(validateRegistry(good).ok, true);

  const bad = JSON.parse(JSON.stringify(good));
  bad.version = 99;
  bad.members.push({ ...bad.members[0] });
  bad.members[1].groupId = "g-404";
  const r = validateRegistry(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("version")));
  assert.ok(r.errors.some((e) => e.includes("重复")));
  assert.ok(r.errors.some((e) => e.includes("不存在的小组")));
});

test("normalizeRegistry 修复可修项、丢弃不可修项、悬空 groupId 置空", () => {
  const dirty = {
    version: 1,
    groups: [{ id: "g-1", name: "组一" }, { id: "", name: "坏组" }],
    members: [
      { target: "ok-member" },
      { target: "另一个中文名" },
      { target: "orphan-group", groupId: "g-404" },
    ],
  };
  const { registry, warnings } = normalizeRegistry(dirty, NOW);
  assert.equal(registry.groups.length, 1);
  assert.deepEqual(registry.members.map((m) => m.target), ["ok-member", "orphan-group"]);
  assert.equal(registry.members[0].displayName, "ok-member");
  assert.equal(registry.members[1].groupId, null);
  assert.ok(warnings.length >= 2);
  assert.equal(validateRegistry(registry).ok, true);
});

test("normalizeRegistry 对完全损坏的输入返回空名册而非抛错", () => {
  for (const junk of [null, undefined, 42, "字符串", []]) {
    const { registry, warnings } = normalizeRegistry(junk, NOW);
    assert.deepEqual(registry.members, []);
    assert.ok(warnings.length > 0);
  }
});

test("buildTree 按 order 排序、分出未分组、标记孤儿与未登记", () => {
  const reg = fixture();
  const tree = buildTree(reg, ["data-organizer", "data-verifier", "doc-writer", "brand-new-member"]);
  assert.deepEqual(tree.groups.map((g) => g.id), ["g-1", "g-2"]);
  assert.equal(tree.groups[0].members.length, 2);
  assert.deepEqual(tree.unregistered, ["brand-new-member"]);
  assert.equal(tree.stats.orphans, 0);
  assert.equal(tree.stats.active, 3);

  // 名册里有、核心已没有 → 孤儿
  const tree2 = buildTree(reg, ["data-organizer"]);
  assert.equal(tree2.stats.orphans, 2);
  assert.equal(tree2.groups[0].members.find((m) => m.target === "data-verifier").orphan, true);
});

test("buildTree 在无 liveTargets 时不误报孤儿/未登记", () => {
  const tree = buildTree(fixture());
  assert.equal(tree.stats.orphans, 0);
  assert.deepEqual(tree.unregistered, []);
});

test("renderTreeText 输出中文组织架构且有停用标记", () => {
  let reg = fixture();
  reg = removeMember(reg, "doc-writer", {}, NOW);
  reg = setRole(reg, "data-organizer", { title: "知识库整理员", duties: ["清点", "诊断"] }, NOW);
  const text = renderTreeText(buildTree(reg, ["data-organizer", "data-verifier", "doc-writer"]));
  assert.match(text, /【数据组】/);
  assert.match(text, /数据整理员 \(data-organizer\) · 知识库整理员/);
  assert.match(text, /职责: 清点；诊断/);
  assert.match(text, /\[已停用\]/);
});

test("整个名册 JSON 可安全往返序列化", () => {
  const reg = fixture();
  const round = normalizeRegistry(JSON.parse(JSON.stringify(reg)), NOW).registry;
  assert.deepEqual(round, reg);
  assert.equal(validateRegistry(round).ok, true);
});
