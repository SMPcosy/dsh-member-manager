/**
 * v0.3.2 · 公司员工 ↔ 名册关联测试
 *
 * 覆盖三层：
 *  1. src/shared/roster-link.mjs —— 纯函数（target 解析 / 档案映射 / 只补空字段 / 批量计划）
 *  2. src/shared/registry-core.mjs patchMember —— 白名单补丁 + 空串清除
 *  3. TeamService.linkProfiles + company-runtime 的 view/action（含真实 registry.json 落盘）
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ROSTER_LINK_STATUS,
  buildRosterIndex,
  buildRosterProfile,
  describeRosterLink,
  hasExplicitRosterTarget,
  planRosterBatch,
  planRosterLink,
  rosterTargetOf,
  summarizeRosterLinks,
} from "../src/shared/roster-link.mjs";
import { RegistryStore } from "../src/shared/registry-store.mjs";
import { TeamService } from "../src/shared/team-service.mjs";
import { patchMember } from "../src/shared/registry-core.mjs";
import { createDepartment, createEmployee, emptyCompany, updateEmployee } from "../src/shared/company-org.mjs";
import { createCompanyRuntime } from "../src/host/company-runtime.mjs";

const NOW = "2026-10-22T09:00:00.000Z";

function tempDir(label = "roster-link") {
  return mkdtempSync(path.join(os.tmpdir(), `${label}-`));
}

function makeCtx(opts = {}) {
  return {
    get(name) {
      if (opts[name] !== undefined) return opts[name];
      return undefined;
    },
    effect() {
      return () => {};
    },
  };
}

/* ------------------------------------------------------------------ */
/* 1. roster-link 纯函数                                               */
/* ------------------------------------------------------------------ */

test("rosterTargetOf：显式 rosterTarget 优先，缺省用员工 id", () => {
  assert.equal(rosterTargetOf({ id: "emp-abc" }), "emp-abc");
  assert.equal(rosterTargetOf({ id: "emp-abc", rosterTarget: " doc-writer " }), "doc-writer");
  assert.equal(rosterTargetOf({ id: "emp-abc", rosterTarget: "" }), "emp-abc");
  assert.equal(rosterTargetOf(null), "");
  assert.equal(hasExplicitRosterTarget({ id: "emp-abc" }), false);
  assert.equal(hasExplicitRosterTarget({ id: "emp-abc", rosterTarget: "doc-writer" }), true);
});

test("buildRosterProfile：只映射名册支持的字段，空 model/provider 不写", () => {
  const profile = buildRosterProfile(
    {
      id: "emp-a",
      displayName: " 平面设计 ",
      title: " 平面设计师 ",
      duties: ["海报设计", " ", "海报设计", "版式排版"],
      skills: ["office-pptx"],
      model: "",
      provider: "",
    },
    { department: { code: "D01", name: "内容" } },
  );
  assert.equal(profile.target, "emp-a");
  assert.equal(profile.displayName, "平面设计");
  assert.equal(profile.title, "平面设计师");
  assert.deepEqual(profile.duties, ["海报设计", "版式排版"]);
  assert.ok(profile.note.includes("emp-a"));
  assert.ok(profile.note.includes("D01 内容"));
  assert.equal("model" in profile, false);
  assert.equal("provider" in profile, false);
});

test("planRosterLink：默认只补空字段，refresh 才覆盖", () => {
  const member = { target: "emp-a", displayName: "emp-a", title: "", duties: [], skills: [], model: "", provider: "" };
  const profile = buildRosterProfile({ id: "emp-a", displayName: "平面设计", title: "平面设计师", duties: ["海报设计"] });
  const plan = planRosterLink(member, profile);
  assert.equal(plan.action, "update");
  assert.equal(plan.patch.displayName, "平面设计");
  assert.equal(plan.patch.title, "平面设计师");
  assert.deepEqual(plan.patch.duties, ["海报设计"]);
  // 已填满 → noop
  const full = planRosterLink({ target: "emp-a", displayName: "平面设计", title: "平面设计师", duties: ["海报设计"], skills: ["x"], note: "n" }, profile);
  assert.equal(full.action, "noop");
  // refresh 覆盖 title
  const refreshed = planRosterLink({ target: "emp-a", displayName: "平面设计", title: "旧岗位", duties: ["海报设计"], note: "n" }, profile, { refresh: true });
  assert.equal(refreshed.patch.title, "平面设计师");
});

test("planRosterBatch：默认 onlyUnlinked，已有条目只在 refresh 时回填", () => {
  const employees = [
    { id: "emp-a", displayName: "A" },
    { id: "emp-b", displayName: "B" },
  ];
  const index = buildRosterIndex([{ target: "emp-b", displayName: "B", status: "active" }]);
  const createOnly = planRosterBatch(employees, { index });
  assert.equal(createOnly.length, 1);
  assert.equal(createOnly[0].action, "create");
  assert.equal(createOnly[0].target, "emp-a");

  const withRefresh = planRosterBatch(employees, { index, onlyUnlinked: false, refresh: true });
  assert.equal(withRefresh.length, 2);
});

test("describeRosterLink / summarizeRosterLinks：读不到名册时 available=false", () => {
  assert.equal(describeRosterLink({ id: "emp-a" }, null).available, false);
  const summary = summarizeRosterLinks([{ id: "emp-a" }], null);
  assert.equal(summary.available, false);
  assert.equal(summary.unlinked, 0);

  const index = buildRosterIndex([
    { target: "emp-a", status: "active" },
    { target: "emp-b", status: "retired" },
  ]);
  assert.equal(describeRosterLink({ id: "emp-a" }, index).status, ROSTER_LINK_STATUS.LINKED);
  assert.equal(describeRosterLink({ id: "emp-b" }, index).status, ROSTER_LINK_STATUS.RETIRED);
  assert.equal(describeRosterLink({ id: "emp-c" }, index).status, ROSTER_LINK_STATUS.UNLINKED);
  const s = summarizeRosterLinks([{ id: "emp-a" }, { id: "emp-b" }, { id: "emp-c" }], index);
  assert.deepEqual({ linked: s.linked, retired: s.retired, unlinked: s.unlinked }, { linked: 1, retired: 1, unlinked: 1 });
});

/* ------------------------------------------------------------------ */
/* 2. registry-core.patchMember                                        */
/* ------------------------------------------------------------------ */

test("patchMember：只处理白名单字段，空串清除 model", () => {
  const registry = {
    version: 1,
    groups: [],
    members: [
      {
        target: "emp-a",
        displayName: "旧名",
        aliases: [],
        title: "",
        duties: [],
        skills: [],
        model: "m1",
        provider: "p1",
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  };
  const next = patchMember(registry, "emp-a", { displayName: "新名", ignored: "x" }, "2026-10-22T10:00:00.000Z");
  assert.equal(next.members[0].displayName, "新名");
  assert.equal("ignored" in next.members[0], false);
  const cleared = patchMember(next, "emp-a", { model: "", provider: "" }, NOW);
  assert.equal("model" in cleared.members[0], false);
  assert.equal("provider" in cleared.members[0], false);
  assert.throws(() => patchMember(registry, "nope", { title: "x" }), (err) => err.code === "MEMBER_NOT_FOUND");
});

/* ------------------------------------------------------------------ */
/* 3. TeamService.linkProfiles                                         */
/* ------------------------------------------------------------------ */

test("linkProfiles：create / update / noop / create:false 跳过", () => {
  const dir = tempDir("roster-link-svc");
  const store = new RegistryStore({ file: path.join(dir, "registry.json") });
  const service = new TeamService({ store, liveTargets: () => [] });
  const profileA = buildRosterProfile({ id: "emp-a", displayName: "平面设计", title: "平面设计师" });
  const created = service.linkProfiles([{ profile: profileA, create: true }]);
  assert.equal(created.ok, true);
  assert.deepEqual(created.data.results.map((r) => r.action), ["create"]);
  const saved = store.load().registry.members.find((m) => m.target === "emp-a");
  assert.equal(saved.displayName, "平面设计");
  assert.equal(saved.title, "平面设计师");

  // 同名再次登记 → noop（只补空字段，不覆盖）
  const again = service.linkProfiles([{ profile: profileA, create: true }]);
  assert.deepEqual(again.data.results.map((r) => r.action), ["noop"]);

  // create:false + 不存在 → skip
  const skipped = service.linkProfiles([{ profile: buildRosterProfile({ id: "emp-z" }), create: false }]);
  assert.deepEqual(skipped.data.results.map((r) => r.action), ["skip"]);
  assert.equal(store.load().registry.members.some((m) => m.target === "emp-z"), false);
});

/* ------------------------------------------------------------------ */
/* 4. company-org 的 rosterTarget 字段                                 */
/* ------------------------------------------------------------------ */

test("createEmployee：显式 rosterTarget 才写字段，缺省不写", () => {
  const base = createDepartment(emptyCompany(NOW), { id: "content", name: "内容部" });
  const withExplicit = createEmployee(base, { id: "emp-a", displayName: "A", department: "content", rosterTarget: "doc-writer" });
  assert.equal(withExplicit.employees[0].rosterTarget, "doc-writer");
  const implicit = createEmployee(base, { id: "emp-b", displayName: "B", department: "content" });
  assert.equal("rosterTarget" in implicit.employees[0], false);
});

test("updateEmployee：rosterTarget 可设/可清，非法成员名抛错", () => {
  const base = createEmployee(createDepartment(emptyCompany(NOW), { id: "content", name: "内容部" }), {
    id: "emp-a",
    displayName: "A",
    department: "content",
  });
  const set = updateEmployee(base, "emp-a", { rosterTarget: "doc-writer" });
  assert.equal(set.employees[0].rosterTarget, "doc-writer");
  const cleared = updateEmployee(set, "emp-a", { rosterTarget: "" });
  assert.equal("rosterTarget" in cleared.employees[0], false);
  assert.throws(() => updateEmployee(base, "emp-a", { rosterTarget: "非法 名字" }), /名册成员名不合法/);
});

/* ------------------------------------------------------------------ */
/* 5. company-runtime：view 关联摘要 + 三个 action                     */
/* ------------------------------------------------------------------ */

function makeRosterBridge(dataDir) {
  const store = new RegistryStore({ file: path.join(dataDir, "registry.json") });
  const service = new TeamService({ store, liveTargets: () => [] });
  return { store, service, bridge: { service: () => service, members: () => store.load().registry.members } };
}

function ownerExec(rt) {
  return { exec: { agent: { session: { id: rt.ownerSessionId } } } };
}

test("view：注入名册桥后每个员工带 roster，汇总 available=true", async () => {
  const dataDir = tempDir("roster-link-view");
  const { bridge } = makeRosterBridge(dataDir);
  const rt = createCompanyRuntime(makeCtx(), {
    dataDir,
    // 本文件测「手动登记」语义：关闭 v0.3.3 的自动登记，保持员工初始未关联
    config: { fake: true, autoLinkRoster: false, departments: [{ id: "content", name: "内容部" }] },
    roster: bridge,
  });
  await rt.boot();
  await rt.tools.find((t) => t.name === "company_hire").execute({ id: "emp-a", displayName: "平面设计", department: "content" }, ownerExec(rt));
  const view = rt.view();
  assert.equal(view.roster.available, true);
  assert.equal(view.roster.total, 1);
  assert.equal(view.roster.unlinked, 1);
  const emp = view.org.employees.find((e) => e.id === "emp-a");
  assert.equal(emp.roster.status, ROSTER_LINK_STATUS.UNLINKED);
  assert.equal(emp.roster.target, "emp-a");
  await rt.shutdown();
});

test("view：未注入名册桥时 roster=null / available=false（不能误报未登记）", async () => {
  const rt = createCompanyRuntime(makeCtx(), { dataDir: tempDir("roster-link-nobridge"), config: { fake: true } });
  await rt.boot();
  const view = rt.view();
  assert.equal(view.roster.available, false);
  assert.equal(view.org.employees.length, 0);
  await rt.shutdown();
});

test("company_admin linkEmployeeRoster：写入名册 + 审计 + view 变为已关联", async () => {
  const dataDir = tempDir("roster-link-action");
  const { store, bridge } = makeRosterBridge(dataDir);
  const rt = createCompanyRuntime(makeCtx(), {
    dataDir,
    // 本文件测「手动登记」语义：关闭 v0.3.3 的自动登记，保持员工初始未关联
    config: { fake: true, autoLinkRoster: false, departments: [{ id: "content", name: "内容部" }] },
    roster: bridge,
  });
  await rt.boot();
  const exec = ownerExec(rt);
  await rt.tools
    .find((t) => t.name === "company_hire")
    .execute({ id: "emp-a", displayName: "平面设计", department: "content", title: "平面设计师", duties: ["海报设计", "版式排版"] }, exec);
  const admin = rt.tools.find((t) => t.name === "company_admin");

  const res = await admin.execute({ action: "linkEmployeeRoster", args: { employeeId: "emp-a" } }, exec);
  assert.equal(res.ok, true);
  assert.equal(res.created, 1);
  const member = store.load().registry.members.find((m) => m.target === "emp-a");
  assert.ok(member, "名册应出现 emp-a 成员");
  assert.equal(member.displayName, "平面设计");
  assert.equal(member.title, "平面设计师");
  assert.deepEqual(member.duties, ["海报设计", "版式排版"]);
  assert.ok(member.note.includes("内容部"));

  const view = rt.view();
  assert.equal(view.roster.linked, 1);
  assert.equal(view.org.employees.find((e) => e.id === "emp-a").roster.status, ROSTER_LINK_STATUS.LINKED);

  // 幂等：第二次登记不再写入
  const again = await admin.execute({ action: "linkEmployeeRoster", args: { employeeId: "emp-a" } }, exec);
  assert.equal(again.ok, true);
  assert.equal(again.linked, 0);

  const auditFile = path.join(dataDir, "company", "audit.jsonl");
  assert.equal(existsSync(auditFile), true);
  const audit = readFileSync(auditFile, "utf8");
  assert.ok(audit.includes("roster.employees_linked"));
  await rt.shutdown();
});

test("company_admin syncEmployeesRoster：只登记未关联，支持 dry-run", async () => {
  const dataDir = tempDir("roster-link-sync");
  const { store, bridge } = makeRosterBridge(dataDir);
  const rt = createCompanyRuntime(makeCtx(), {
    dataDir,
    // 本文件测「手动登记」语义：关闭 v0.3.3 的自动登记，保持员工初始未关联
    config: { fake: true, autoLinkRoster: false, departments: [{ id: "content", name: "内容部" }] },
    roster: bridge,
  });
  await rt.boot();
  const exec = ownerExec(rt);
  const hire = rt.tools.find((t) => t.name === "company_hire");
  await hire.execute({ id: "emp-a", displayName: "A", department: "content" }, exec);
  await hire.execute({ id: "emp-b", displayName: "B", department: "content" }, exec);
  const admin = rt.tools.find((t) => t.name === "company_admin");

  const dry = await admin.execute({ action: "syncEmployeesRoster", args: { departmentId: "content", dryRun: true } }, exec);
  assert.equal(dry.ok, true);
  assert.equal(dry.dryRun, true);
  assert.equal(dry.results.length, 2);
  assert.equal(store.load().registry.members.length, 0, "dry-run 不应写名册");

  const real = await admin.execute({ action: "syncEmployeesRoster", args: { departmentId: "content" } }, exec);
  assert.equal(real.ok, true);
  assert.equal(real.created, 2);
  assert.equal(store.load().registry.members.length, 2);

  const second = await admin.execute({ action: "syncEmployeesRoster", args: { departmentId: "content" } }, exec);
  assert.equal(second.ok, true);
  assert.equal(second.linked, 0);
  await rt.shutdown();
});

test("company_admin linkEmployeeRoster 显式 target + unlinkEmployeeRoster 清除", async () => {
  const dataDir = tempDir("roster-link-explicit");
  const { store, bridge } = makeRosterBridge(dataDir);
  const rt = createCompanyRuntime(makeCtx(), {
    dataDir,
    // 本文件测「手动登记」语义：关闭 v0.3.3 的自动登记，保持员工初始未关联
    config: { fake: true, autoLinkRoster: false, departments: [{ id: "content", name: "内容部" }] },
    roster: bridge,
  });
  await rt.boot();
  const exec = ownerExec(rt);
  await rt.tools.find((t) => t.name === "company_hire").execute({ id: "emp-a", displayName: "平面设计", department: "content" }, exec);
  const admin = rt.tools.find((t) => t.name === "company_admin");

  const linked = await admin.execute({ action: "linkEmployeeRoster", args: { employeeId: "emp-a", target: "content-designer" } }, exec);
  assert.equal(linked.ok, true);
  assert.ok(store.load().registry.members.some((m) => m.target === "content-designer"));
  const view = rt.view();
  assert.equal(view.org.employees.find((e) => e.id === "emp-a").rosterTarget, "content-designer");

  const unlinked = await admin.execute({ action: "unlinkEmployeeRoster", args: { employeeId: "emp-a" } }, exec);
  assert.equal(unlinked.ok, true);
  assert.equal(unlinked.cleared, true);
  const after = rt.view().org.employees.find((e) => e.id === "emp-a");
  assert.equal("rosterTarget" in after, false);

  // 隐式关联无法解除 → cleared:false，但仍是 ok
  const implicit = await admin.execute({ action: "unlinkEmployeeRoster", args: { employeeId: "emp-a" } }, exec);
  assert.equal(implicit.ok, true);
  assert.equal(implicit.cleared, false);
  await rt.shutdown();
});

test("company_admin 名册 action：未注入桥时返回 E_NO_ROSTER", async () => {
  const rt = createCompanyRuntime(makeCtx(), { dataDir: tempDir("roster-link-noroster"), config: { fake: true } });
  await rt.boot();
  const exec = ownerExec(rt);
  await rt.tools.find((t) => t.name === "company_hire").execute({ id: "emp-a", displayName: "A" }, exec);
  const res = await rt.tools
    .find((t) => t.name === "company_admin")
    .execute({ action: "linkEmployeeRoster", args: { employeeId: "emp-a" } }, exec);
  assert.equal(res.ok, false);
  assert.equal(res.code, "E_NO_ROSTER");
  await rt.shutdown();
});
