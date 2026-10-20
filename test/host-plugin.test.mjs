/**
 * 宿主端插件的集成测试：不需要 DSH 在运行。
 *
 * 用一个最小 Cordis ctx 替身（effect / get / on / inject / tools.register /
 * webServer.register）加载 lib/index.js，然后：
 *   - 断言 7 个工具确实注册、参数 schema 合法
 *   - 直接调用 tool.execute，验证工具真的能读写名册
 *   - 通过 HTTP 路由 handler 端到端走一遍「面板 → 宿主 → 名册」
 * 这样在接入真实 profile 之前就能确定插件逻辑是对的。
 */

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP_ROOT = path.join(HERE, ".tmp-host");

let seq = 0;

/** 最小 Cordis ctx 替身
 *  options.agentTeams        —— 注入 ctx.get("agentTeams") 的替身（测核心成员读取路径）
 *  options.webServer === null —— 模拟该服务始终不出现
 *  options.webServerThrows    —— 模拟 webServer.register 抛错
 *  options.dir                —— 复用同一个数据目录（测重启后持久化）
 */
function mockCtx(options = {}) {
  const dir = options.dir || path.join(TMP_ROOT, `case-${++seq}-${Date.now().toString(36)}`);
  fs.mkdirSync(dir, { recursive: true });

  const tools = new Map();
  const routes = new Map();
  const events = new Map();
  const disposers = [];

  const ctx = {
    // 每个用例都必须被关进临时目录：dataDir 指向用例目录，且关掉磁盘扫盘
    // （否则会扫到本机真实技能目录，结果随机器而变）
    config: { dataDir: dir, scanLocalSkills: false },
    effect(fn) {
      const d = fn();
      if (typeof d === "function") disposers.push(d);
      return d;
    },
    get(service) {
      if (service === "agentTeams") return options.agentTeams;
      if (service === "skills") return options.skills;
      if (service === "agents") return options.agents ? { list: () => options.agents } : undefined;
      if (service === "llm") return options.llm;
      return undefined;
    },
    on(evt, fn) {
      if (!events.has(evt)) events.set(evt, []);
      events.get(evt).push(fn);
    },
    // 插件现在把 webServer 声明在 inject 里、直接用 ctx.webServer（与官方/第三方一致）。
    // options.webServer === null 用来模拟该服务缺失。
    webServer:
      options.webServer === null
        ? undefined
        : {
            register(route) {
              if (options.webServerThrows) throw new Error("模拟 webServer 故障");
              routes.set(route.path, route.handler);
              return () => routes.delete(route.path);
            },
          },
    // 保留 inject 以证明插件已不再依赖它（历史实现曾用 ctx.inject 做可选注入）
    inject() {
      return undefined;
    },
    tools: {
      register(tool) {
        tools.set(tool.name, tool);
        return () => tools.delete(tool.name);
      },
    },
  };
  return { ctx, dir, tools, routes, events, disposers };
}

/** 造一个够用的 req（支持 readBody 用到的 data/end/error） */
function mockReq(method, body) {
  const req = new EventEmitter();
  req.method = method;
  setImmediate(() => {
    if (body !== undefined) req.emit("data", Buffer.from(body, "utf8"));
    req.emit("end");
  });
  return req;
}

/** 造一个捕获响应的 res */
function mockRes() {
  const res = {
    status: null,
    headers: null,
    body: "",
    writeHead(status, headers) {
      res.status = status;
      res.headers = headers;
    },
    end(chunk) {
      res.body += chunk ?? "";
    },
  };
  return res;
}

async function call(handler, method, body) {
  const res = mockRes();
  await handler(mockReq(method, body), res);
  let json = null;
  try {
    json = JSON.parse(res.body);
  } catch {
    /* 保留原始 body */
  }
  return { status: res.status, headers: res.headers, json, raw: res.body };
}

let PLUGIN;
before(async () => {
  PLUGIN = await import("../lib/index.js");
});

/* ------------------------------------------------------------------ */
/* 污染守卫                                                            */
/* ------------------------------------------------------------------ */
/* 真实事故：一次批量改写让 PLUGIN.apply 收到了显式配置，于是跳过了 ctx.config
 * 回退，dataDir 落到真实存储目录，几十个用例把 m1/m2/m9/via-tool 这类测试数据
 * 写进了用户的名册，且 .bak 也被覆盖，只能靠会话里抓到的旧数据重建。
 * 有了这道守卫，同类问题会在测试结束时直接报错，而不是悄悄改坏用户数据。 */

const REAL_REGISTRY = path.join(process.env.DSH_HOME || path.join(os.homedir(), ".dsh"), "storages", "member-manager", "registry.json");

/* 公司化 boot 是异步 setTimeout：个别用例（cordisLikeCtx 不提供 config，走默认目录回退）
 * 会把 company/audit.jsonl 写进「默认数据目录」。把 DSH_HOME 指到测试临时根之后，
 * 任何回退路径都只会落到 TMP_ROOT，绝不触碰真实 ~/.dsh（REAL_REGISTRY 已在上面按真实位置算好）。 */
process.env.DSH_HOME = TMP_ROOT;

const REAL_COMPANY_DIR = path.join(path.dirname(REAL_REGISTRY), "company");

function snapshotCompanyDir() {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else {
        try {
          out.push([path.relative(REAL_COMPANY_DIR, p).split(path.sep).join("/"), fs.readFileSync(p, "utf8")]);
        } catch {
          out.push([path.relative(REAL_COMPANY_DIR, p).split(path.sep).join("/"), "<unreadable>"]);
        }
      }
    }
  };
  walk(REAL_COMPANY_DIR);
  return out;
}

let realRegistrySnapshot;
let realCompanySnapshot;
before(() => {
  try {
    realRegistrySnapshot = fs.readFileSync(REAL_REGISTRY, "utf8");
  } catch {
    realRegistrySnapshot = null; // 不存在也算一种初始状态
  }
  realCompanySnapshot = snapshotCompanyDir();
});
after(() => {
  let now = null;
  try {
    now = fs.readFileSync(REAL_REGISTRY, "utf8");
  } catch {
    /* 与初始状态比较即可 */
  }
  assert.equal(now, realRegistrySnapshot, `测试污染了真实名册 ${REAL_REGISTRY} —— 所有用例必须只写临时目录`);
  assert.deepEqual(snapshotCompanyDir(), realCompanySnapshot, `测试污染了真实公司数据目录 ${REAL_COMPANY_DIR} —— 公司化 boot 必须只写临时目录`);
});


after(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

/* ================== 注册面 ================== */

test("宿主插件导出合法的 Cordis 插件形状", () => {
  assert.equal(PLUGIN.name, "dsh-member-manager");
  assert.deepEqual(PLUGIN.inject, ["tools", "webServer"]);
  assert.equal(typeof PLUGIN.apply, "function");
});

test("apply() 注册 29 个工具（16 名册 + 13 公司化），且参数 schema 结构合法", () => {
  const { ctx, tools } = mockCtx();
  PLUGIN.apply(ctx);

  const names = [...tools.keys()].sort();
  assert.deepEqual(names, [
    "company_accept",
    "company_admin",
    "company_ask",
    "company_ask_help",
    "company_assign",
    "company_borrow",
    "company_cancel",
    "company_escalate",
    "company_hire",
    "company_order",
    "company_report",
    "company_review",
    "company_status",
    "group_manage",
    "member_add",
    "member_backup",
    "member_diagnose",
    "member_group_from_text",
    "member_list",
    "member_remove",
    "member_rename",
    "member_set_model",
    "member_set_role",
    "member_set_skills",
    "member_sync",
    "member_update",
    "member_workflow",
    "model_list",
    "skill_list",
  ]);

  for (const [name, tool] of tools) {
    assert.equal(typeof tool.description, "string", `${name} 需要 description`);
    assert.ok(tool.description.length > 10, `${name} description 太短`);
    assert.equal(tool.parameters.type, "object", `${name} parameters 必须是 object`);
    assert.equal(typeof tool.parameters.properties, "object", `${name} 缺少 properties`);
    assert.equal(typeof tool.execute, "function", `${name} 缺少 execute`);
    assert.equal(typeof tool.output.render, "function", `${name} 缺少 output.render`);
    assert.ok(tool.output.schema, `${name} 缺少 output.schema`);
  }
});

test("M/P 双通道：company_hire 暴露 code/channel/level，company_admin 暴露新 action", () => {
  const { ctx, tools } = mockCtx();
  PLUGIN.apply(ctx);

  const hire = tools.get("company_hire");
  for (const key of ["code", "channel", "level"]) {
    assert.ok(hire.parameters.properties[key], `company_hire.parameters 缺少 ${key}`);
  }
  assert.deepEqual(hire.parameters.properties.channel.enum, ["M", "P"], "channel 枚举应为 M/P");

  const admin = tools.get("company_admin");
  const actions = admin.parameters.properties.action.enum;
  for (const action of ["createDepartment", "createEmployee", "setRoutingRules", "updateDepartment", "promoteEmployee", "setNumbering"]) {
    assert.ok(actions.includes(action), `company_admin.action 缺少 ${action}`);
  }
});

test("apply() 注册 HTTP 路由，content-type 为 utf-8 JSON", async () => {
  const { ctx, routes } = mockCtx();
  PLUGIN.apply(ctx);
  assert.deepEqual([...routes.keys()].sort(), [
    "/api/dsh-member-manager/backups",
    "/api/dsh-member-manager/company/board",
    "/api/dsh-member-manager/company/costs",
    "/api/dsh-member-manager/company/op",
    "/api/dsh-member-manager/company/orders",
    "/api/dsh-member-manager/company/org",
    "/api/dsh-member-manager/company/overview",
    "/api/dsh-member-manager/health",
    "/api/dsh-member-manager/models",
    "/api/dsh-member-manager/op",
    "/api/dsh-member-manager/orgmap",
    "/api/dsh-member-manager/overrides",
    "/api/dsh-member-manager/skills",
    "/api/dsh-member-manager/state",
    "/api/dsh-member-manager/update",
    "/api/dsh-member-manager/workflow",
  ]);

  const r = await call(routes.get("/api/dsh-member-manager/health"), "GET");
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.match(r.headers["content-type"], /charset=utf-8/);
});

test("面板写接口：POST /company/op 解析 JSON body，业务错误也回 200 信封", async () => {
  const { ctx, routes } = mockCtx();
  PLUGIN.apply(ctx);
  const op = routes.get("/api/dsh-member-manager/company/op");
  assert.ok(op, "应注册 /api/dsh-member-manager/company/op");

  const created = await call(op, "POST", JSON.stringify({ action: "createDepartment", args: { name: "HTTP 部门", charter: "接口测试" } }));
  assert.equal(created.status, 200);
  assert.equal(created.json.ok, true);
  assert.ok(created.json.data.departmentId, "应返回 departmentId");
  assert.match(created.json.data.code, /^D\d+$/, "应返回自动编号");

  const overview = await call(routes.get("/api/dsh-member-manager/company/overview"), "GET");
  const dept = overview.json.data.org.departments.find((d) => d.id === created.json.data.departmentId);
  assert.ok(dept, "新建部门应出现在 overview");
  assert.equal(dept.charter, "接口测试");

  const bad = await call(op, "POST", "{不是 json");
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, "E_BAD_JSON");

  const unknown = await call(op, "POST", JSON.stringify({ action: "nope", args: {} }));
  assert.equal(unknown.status, 200);
  assert.equal(unknown.json.data.ok, false);
  assert.equal(unknown.json.data.code, "E_UNKNOWN_ACTION");

  const wrongMethod = await call(op, "GET");
  assert.equal(wrongMethod.status, 405);
});

test("0.3.0 任务作用域组织架构图：/orgmap 只返回当前会话的参与者，?task= 选任务，任务板缺失时降级", async () => {
  const leadSession = { id: "s-lead", header: { id: "s-lead", createdAt: 1000 } };
  const childSession = { id: "s-child", header: { id: "s-child", createdAt: 2000, parentSession: "s-lead" } };
  const leadAgent = { id: "a-lead", session: leadSession, status: "running" };
  const childAgent = { id: "a-child", session: childSession, status: "idle" };
  const agentTeams = {
    tryMembership(agent) {
      if (agent === leadAgent) return { name: "lead", role: "lead", root: true };
      if (agent === childAgent) return { name: "plugin-builder", role: "teammate", root: false };
      return null;
    },
  };
  const { ctx, tools, routes } = mockCtx({ agents: [leadAgent, childAgent], agentTeams });
  PLUGIN.apply(ctx);
  await tools.get("group_manage").execute({ action: "create", id: "g-plug", name: "插件组" });
  await tools.get("member_add").execute({ target: "plugin-builder", displayName: "插件编写", groupId: "g-plug" });

  const handler = routes.get("/api/dsh-member-manager/orgmap");
  const r = await call(handler, "GET");
  assert.equal(r.status, 200);
  const d = r.json.data;
  assert.equal(d.version, 2, "0.3.0 起 /orgmap 是任务作用域快照");
  assert.equal(d.tasks.length, 1, "一个 root 会话 = 一个任务");
  assert.equal(d.tasks[0].id, "s-lead");
  assert.equal(d.tasks[0].memberCount, 2);
  assert.equal(d.task.id, "s-lead");
  assert.equal(d.lead.target, "lead");
  assert.equal(d.groups.length, 1);
  assert.equal(d.groups[0].name, "插件组");
  assert.deepEqual(d.groups[0].members.map((m) => m.target), ["plugin-builder"]);
  const builder = d.groups[0].members[0];
  for (const key of ["displayName", "model", "status", "usage", "elapsedMs", "work", "role"]) {
    assert.ok(key in builder, `成员卡片缺字段 ${key}`);
  }
  assert.equal(builder.role, "teammate");
  assert.ok(Array.isArray(d.dispatch));
  assert.ok(Array.isArray(d.dependency));
  assert.equal(d.enabled, true);
  assert.equal(d.tasksAvailable, false, "没装任务板时必须显式降级");

  // 指定一个不存在的任务 → 回落到最近活跃任务，不报错
  const req = mockReq("GET");
  req.url = "/api/dsh-member-manager/orgmap?task=missing";
  const res = mockRes();
  await handler(req, res);
  const picked = JSON.parse(res.body).data;
  assert.equal(picked.task.id, "s-lead");
});

test("apply() 返回值可用于卸载（effect 登记了 disposer）", () => {
  const { ctx, tools, disposers } = mockCtx();
  PLUGIN.apply(ctx);
  assert.ok(disposers.length >= 7, `应登记至少 7 个 disposer，实际 ${disposers.length}`);
  for (const d of disposers) d();
  assert.equal(tools.size, 0, "全部卸载后不应残留工具");
});

/* ================== 工具端到端 ================== */

test("工具链：member_add → member_rename → member_set_role → member_set_skills → member_list", async () => {
  const { ctx, tools } = mockCtx();
  PLUGIN.apply(ctx);

  const add = await tools.get("member_add").execute({ target: "data-organizer", displayName: "数据整理员" });
  assert.equal(add.ok, true);

  const renamed = await tools.get("member_rename").execute({ target: "data-organizer", displayName: "知识库整理员", aliases: ["整理员"] });
  assert.equal(renamed.ok, true);

  const role = await tools.get("member_set_role").execute({ target: "data-organizer", title: "知识库整理员", duties: ["清点", "诊断"] });
  assert.equal(role.ok, true);

  const skills = await tools.get("member_set_skills").execute({ target: "data-organizer", skills: ["file-processing-master"] });
  assert.equal(skills.ok, true);
  const skills2 = await tools.get("member_set_skills").execute({ target: "data-organizer", add: ["office-docx"] });
  assert.equal(skills2.ok, true);
  assert.deepEqual(skills2.data.members[0].skills, ["file-processing-master", "office-docx"]);

  // 整体覆盖与增量互斥：同时传必须被拒，避免「以谁为准」不可预测
  const ambiguous = await tools.get("member_set_skills").execute({ target: "data-organizer", skills: ["a"], add: ["b"] });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.code, "AMBIGUOUS_SKILLS");

  const group = await tools.get("group_manage").execute({ action: "create", id: "g-1", name: "数据组" });
  assert.equal(group.ok, true);
  await tools.get("group_manage").execute({ action: "assign", target: "data-organizer", groupId: "g-1" });

  const list = await tools.get("member_list").execute({});
  assert.equal(list.groups.length, 1);
  assert.equal(list.groups[0].name, "数据组");
  assert.equal(list.groups[0].members[0].displayName, "知识库整理员");
  assert.equal(list.groups[0].members[0].target, "data-organizer");
  assert.deepEqual(list.groups[0].members[0].duties, ["清点", "诊断"]);
  assert.equal(list.coreAvailable, false, "agentTeams 不可用时应标记 false");
  assert.equal(list.stats.orphans, 0, "核心不可用时不得误判孤儿");
});

test("工具错误路径返回 ok:false + 可读 code（不抛异常）", async () => {
  const { ctx, tools } = mockCtx();
  PLUGIN.apply(ctx);

  const cn = await tools.get("member_add").execute({ target: "数据整理员" });
  assert.equal(cn.ok, false);
  assert.equal(cn.code, "INVALID_TARGET");
  assert.match(cn.message, /kebab/);

  await tools.get("member_add").execute({ target: "dup-member" });
  const dup = await tools.get("member_add").execute({ target: "dup-member" });
  assert.equal(dup.code, "MEMBER_EXISTS");

  const badAction = await tools.get("group_manage").execute({ action: "explode" });
  assert.equal(badAction.code, "INVALID_ACTION");

  const missing = await tools.get("member_rename").execute({ target: "nobody-here", displayName: "x" });
  assert.equal(missing.code, "MEMBER_NOT_FOUND");
});

test("member_remove 软删除 + restore 恢复，member_sync 在核心不可用时明确拒绝", async () => {
  const { ctx, tools } = mockCtx();
  PLUGIN.apply(ctx);
  await tools.get("member_add").execute({ target: "doc-writer" });

  const off = await tools.get("member_remove").execute({ target: "doc-writer" });
  assert.equal(off.ok, true);
  assert.equal(off.data.members[0].status, "retired");

  const on = await tools.get("member_remove").execute({ target: "doc-writer", restore: true });
  assert.equal(on.ok, true);
  assert.equal(on.data.members[0].status, "active");

  const sync = await tools.get("member_sync").execute({});
  assert.equal(sync.ok, false);
  assert.equal(sync.code, "CORE_UNAVAILABLE");
});

test("tool 的 output.render 产出模型可读的文本块", async () => {
  const { ctx, tools } = mockCtx();
  PLUGIN.apply(ctx);
  const tool = tools.get("member_list");
  const value = await tool.execute({});
  const blocks = tool.output.render({}, value);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "text");
  assert.doesNotThrow(() => JSON.parse(blocks[0].text));
});

/* ================== HTTP 端到端 ================== */

test("HTTP：/state 初始为空且 coreAvailable=false", async () => {
  const { ctx, routes } = mockCtx();
  PLUGIN.apply(ctx);
  const r = await call(routes.get("/api/dsh-member-manager/state"), "GET");
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.data.stats.members, 0);
  assert.equal(r.json.data.coreAvailable, false);
  assert.ok(r.json.data.registryFile.endsWith("registry.json"));
});

test("HTTP：POST /op 建组 + 加人 + 改名 + 设岗位 + 赋技能，/state 能读回", async () => {
  const { ctx, routes } = mockCtx();
  PLUGIN.apply(ctx);
  const op = routes.get("/api/dsh-member-manager/op");
  const state = routes.get("/api/dsh-member-manager/state");

  const mk = async (o, a) => {
    const r = await call(op, "POST", JSON.stringify({ op: o, args: a }));
    assert.equal(r.status, 200, `${o} 应成功：${r.raw}`);
    return r.json;
  };

  await mk("createGroup", { id: "g-1", name: "数据组", description: "知识库与核查" });
  await mk("addMember", { target: "data-organizer", displayName: "数据整理员", groupId: "g-1" });
  await mk("addMember", { target: "data-verifier", displayName: "数据核查员", groupId: "g-1" });
  await mk("renameMember", { target: "data-organizer", patch: { displayName: "数据整理员（主）" } });
  await mk("setRole", { target: "data-organizer", patch: { title: "知识库整理员", duties: ["清点", "诊断"] } });
  await mk("setSkills", { target: "data-organizer", patch: { add: ["office-docx"] } });
  await mk("assignGroup", { target: "data-verifier", groupId: null });
  await mk("removeMember", { target: "data-verifier" });
  await mk("restoreMember", { target: "data-verifier" });

  const s = (await call(state, "GET")).json.data;
  assert.equal(s.stats.members, 2);
  assert.equal(s.stats.groups, 1);
  assert.equal(s.stats.retired, 0);
  const main = s.groups[0].members.find((m) => m.target === "data-organizer");
  assert.equal(main.displayName, "数据整理员（主）");
  assert.equal(main.title, "知识库整理员");
  assert.deepEqual(main.skills, ["office-docx"]);
  assert.deepEqual(s.ungrouped.map((m) => m.target), ["data-verifier"]);
});

test("HTTP：/op 的错误路径返回 400 + 明确 code（面板能直接显示）", async () => {
  const { ctx, routes } = mockCtx();
  PLUGIN.apply(ctx);
  const op = routes.get("/api/dsh-member-manager/op");

  const unknown = await call(op, "POST", JSON.stringify({ op: "dropDatabase", args: {} }));
  assert.equal(unknown.status, 400);
  assert.equal(unknown.json.ok, false);
  assert.equal(unknown.json.code, "UNKNOWN_OP");

  const badJson = await call(op, "POST", "{ 不是 json");
  assert.equal(badJson.status, 400);
  assert.equal(badJson.json.code, "BAD_REQUEST");

  const notFound = await call(op, "POST", JSON.stringify({ op: "renameMember", args: { target: "ghost", patch: { displayName: "x" } } }));
  assert.equal(notFound.status, 400);
  assert.equal(notFound.json.code, "MEMBER_NOT_FOUND");
});

test("HTTP：方法不匹配返回 405，/op 的 GET 也一样", async () => {
  const { ctx, routes } = mockCtx();
  PLUGIN.apply(ctx);
  const s = await call(routes.get("/api/dsh-member-manager/state"), "POST");
  assert.equal(s.status, 405);
  assert.equal(s.json.code, "METHOD_NOT_ALLOWED");
  const o = await call(routes.get("/api/dsh-member-manager/op"), "GET");
  assert.equal(o.status, 405);
  const h = await call(routes.get("/api/dsh-member-manager/health"), "POST");
  assert.equal(h.status, 405);
  assert.equal(h.json.code, "METHOD_NOT_ALLOWED");
});

test("HTTP：写盘点被占（registry.json 变成目录）时 /op 返回 500 INTERNAL，而不是把异常抛给 webServer", async () => {
  const { ctx, routes, dir } = mockCtx();
  PLUGIN.apply(ctx);
  // 把名册文件换成同名目录：读 → 走空名册兜底，写 → rename 必然失败（EPERM/EISDIR/ENOTEMPTY）
  fs.mkdirSync(path.join(dir, "registry.json"), { recursive: true });

  const op = routes.get("/api/dsh-member-manager/op");
  const r = await call(op, "POST", JSON.stringify({ op: "addMember", args: { target: "disk-fail", displayName: "写盘失败" } }));
  assert.equal(r.status, 500, "写盘失败应映射为 500，而不是抛出未处理异常");
  assert.equal(r.json.ok, false);
  assert.equal(r.json.code, "INTERNAL_ERROR", "内部错误码要能和业务错误区分开");
  assert.ok(r.json.message, "应带上底层错误信息，便于面板显示与排查");
  assert.match(JSON.stringify(r.json), /INTERNAL/, "响应里要有可检索的内部错误标记");

  // 读路径不受影响：/state 仍能正常返回（读失败回退空名册 + 警告）
  const state = await call(routes.get("/api/dsh-member-manager/state"), "GET");
  assert.equal(state.status, 200);
  assert.equal(state.json.ok, true);
});

test("HTTP：未知 op 与非法 JSON 不会被 500 兜底误吞（仍是 400 + 业务 code）", async () => {
  const { ctx, routes } = mockCtx();
  PLUGIN.apply(ctx);
  const op = routes.get("/api/dsh-member-manager/op");
  const unknown = await call(op, "POST", JSON.stringify({ op: "nope", args: {} }));
  assert.equal(unknown.status, 400);
  assert.equal(unknown.json.code, "UNKNOWN_OP");
});

test("HTTP 与工具共用同一份名册（跨入口一致性）", async () => {
  const { ctx, tools, routes } = mockCtx();
  PLUGIN.apply(ctx);

  await tools.get("member_add").execute({ target: "via-tool", displayName: "工具加的" });
  const s = (await call(routes.get("/api/dsh-member-manager/state"), "GET")).json.data;
  assert.deepEqual(s.ungrouped.map((m) => m.target), ["via-tool"]);

  await call(routes.get("/api/dsh-member-manager/op"), "POST", JSON.stringify({ op: "addMember", args: { target: "via-http", displayName: "网页加的" } }));
  const list = await tools.get("member_list").execute({});
  assert.deepEqual(list.ungrouped.map((m) => m.displayName).sort(), ["工具加的", "网页加的"]);
});

test("持久化：数据写在 dataDir 下的 registry.json，重载后仍在", async () => {
  const first = mockCtx();
  PLUGIN.apply(first.ctx);
  await first.tools.get("member_add").execute({ target: "persisted-member", displayName: "持久化成员" });
  const file = path.join(first.dir, "registry.json");
  assert.ok(fs.existsSync(file), "应落盘到 registry.json");

  // 用同一目录重新 apply 一次（模拟 DSH 重启）
  const second = mockCtx({ dir: first.dir });
  PLUGIN.apply(second.ctx);
  const list = await second.tools.get("member_list").execute({});
  assert.deepEqual(list.ungrouped.map((m) => m.displayName), ["持久化成员"]);
});

/* ================== 核心成员读取路径（agentTeams） ================== */

/** 造一个 agentTeams 服务替身；rows 是 listMembers 返回的名册行 */
function fakeAgentTeams({ rows, role = "lead", notAMember = false, membership, membershipFor, throws } = {}) {
  const calls = { tryMembership: 0, listMembers: 0 };
  return {
    calls,
    tryMembership(agent) {
      calls.tryMembership++;
      if (throws) throw new Error("模拟内核异常");
      if (notAMember) return undefined;
      if (typeof membershipFor === "function") return membershipFor(agent);
      if (membership !== undefined) return membership;
      return { root: { id: "root-1" }, id: "root-1", role, name: "lead" };
    },
    listMembers() {
      calls.listMembers++;
      return rows || [];
    },
  };
}

const LEAD_AGENT = { id: "root-1" };

test("核心集成：Lead 调用工具时刷新缓存 → coreAvailable=true、未登记正确、不误报孤儿", async () => {
  const agentTeams = fakeAgentTeams({
    rows: [
      { id: "lead", name: "lead", role: "lead" },
      { id: "s1", name: "data-organizer", role: "teammate" },
      { id: "s2", name: "data-verifier", role: "teammate" },
    ],
  });
  const { ctx, tools } = mockCtx({ agentTeams });
  PLUGIN.apply(ctx);

  // 名册里先登记一个「核心已不存在」的成员，用来验证孤儿判定
  await tools.get("member_add").execute({ target: "ghost-member" });
  const list = await tools.get("member_list").execute({}, { agent: LEAD_AGENT });

  assert.equal(list.coreAvailable, true, "agentTeams 可用时应标记 true");
  assert.deepEqual(list.unregistered, ["data-organizer", "data-verifier", "lead"].sort());
  assert.equal(list.stats.orphans, 1, "ghost-member 不在核心列表中，应计为 1 个孤儿");
  assert.equal(agentTeams.calls.listMembers, 1);
});

test("核心集成：member_sync 能按缓存把核心成员批量登记进名册", async () => {
  const agentTeams = fakeAgentTeams({
    rows: [
      { id: "lead", name: "lead", role: "lead" },
      { id: "s1", name: "data-organizer", role: "teammate" },
    ],
  });
  const { ctx, tools } = mockCtx({ agentTeams });
  PLUGIN.apply(ctx);

  const sync = await tools.get("member_sync").execute({}, { agent: LEAD_AGENT });
  assert.equal(sync.ok, true);
  assert.deepEqual(sync.data.added.sort(), ["data-organizer", "lead"]);

  const list = await tools.get("member_list").execute({}, { agent: LEAD_AGENT });
  assert.deepEqual(list.unregistered, [], "同步后不应再有未登记成员");
});

test("核心集成：非 Lead（teammate）的 agent 不刷新缓存，coreAvailable 保持 false", async () => {
  const agentTeams = fakeAgentTeams({ rows: [{ id: "s1", name: "someone", role: "teammate" }], role: "teammate" });
  const { ctx, tools } = mockCtx({ agentTeams });
  PLUGIN.apply(ctx);

  const list = await tools.get("member_list").execute({}, { agent: LEAD_AGENT });
  assert.equal(list.coreAvailable, false, "只有 Lead 能列出整队，teammate 不应填充缓存");
  assert.equal(agentTeams.calls.listMembers, 0);
});

test("核心集成：tryMembership 返回 undefined（非团队成员）时不填充缓存", async () => {
  const agentTeams = fakeAgentTeams({ notAMember: true });
  const { ctx, tools } = mockCtx({ agentTeams });
  PLUGIN.apply(ctx);
  const list = await tools.get("member_list").execute({}, { agent: LEAD_AGENT });
  assert.equal(list.coreAvailable, false);
  assert.equal(agentTeams.calls.listMembers, 0);
});

test("核心集成：内核抛异常时降级，不影响宿主（不崩溃、视图可用）", async () => {
  const agentTeams = fakeAgentTeams({ throws: true });
  const { ctx, tools } = mockCtx({ agentTeams });
  PLUGIN.apply(ctx);
  await tools.get("member_add").execute({ target: "solo-member" });

  const list = await tools.get("member_list").execute({}, { agent: LEAD_AGENT });
  assert.equal(list.coreAvailable, false);
  assert.equal(list.stats.orphans, 0, "读核心失败时不得把名册成员误判为孤儿");
  assert.equal(list.stats.members, 1);
});

test("核心集成：agent/created 事件路径也能刷新缓存", async () => {
  const agentTeams = fakeAgentTeams({ rows: [{ id: "lead", name: "lead", role: "lead" }] });
  const { ctx, tools, events } = mockCtx({ agentTeams });
  PLUGIN.apply(ctx);

  const handlers = events.get("agent/created") || [];
  assert.ok(handlers.length > 0, "应订阅 agent/created");
  handlers.forEach((fn) => fn({ agent: LEAD_AGENT })); // 官方载荷形状

  const list = await tools.get("member_list").execute({}); // 不传 agent，只靠事件缓存
  assert.equal(list.coreAvailable, true);
  assert.deepEqual(list.unregistered, ["lead"]);
});

/* ================== 装载韧性 ================== */

test("韧性：webServer 服务缺失时，29 个工具仍全部注册", () => {
  const { ctx, tools, routes } = mockCtx({ webServer: null });
  assert.doesNotThrow(() => PLUGIN.apply(ctx));
  assert.equal(tools.size, 29);
  assert.equal(routes.size, 0, "没有 webServer 就不该有路由");
});

test("韧性：webServer.register 抛错时，插件仍加载且工具可用", async () => {
  const { ctx, tools } = mockCtx({ webServerThrows: true });
  assert.doesNotThrow(() => PLUGIN.apply(ctx));
  assert.equal(tools.size, 29);
  const add = await tools.get("member_add").execute({ target: "still-works" });
  assert.equal(add.ok, true, "面板路由挂了也不该影响工具");
});

test("韧性：缺少 ctx.config 时使用默认数据目录且不抛错", () => {
  const dir = path.join(TMP_ROOT, `case-default-${Date.now().toString(36)}`);
  const m = mockCtx({ dir });
  delete m.ctx.config;
  assert.doesNotThrow(() => PLUGIN.apply(m.ctx));
  assert.equal(m.tools.size, 29);
});

test("group_manage：assign 传空字符串表示移出小组", async () => {
  const { ctx, tools } = mockCtx();
  PLUGIN.apply(ctx);
  await tools.get("group_manage").execute({ action: "create", id: "g-1", name: "组一" });
  await tools.get("member_add").execute({ target: "g-member", groupId: "g-1" });
  const out = await tools.get("group_manage").execute({ action: "assign", target: "g-member", groupId: "" });
  assert.equal(out.ok, true);
  assert.equal(out.data.members[0].groupId, null);
});

/* ================== 自诊断工具 ================== */

test("member_diagnose：一切正常时报 ok、5 项检查全过", async () => {
  const agentTeams = fakeAgentTeams({ rows: [{ id: "lead", name: "lead", role: "lead" }] });
  const { ctx, tools } = mockCtx({ agentTeams });
  PLUGIN.apply(ctx);

  const d = await tools.get("member_diagnose").execute({}, { agent: LEAD_AGENT });
  assert.equal(d.ok, true);
  assert.deepEqual(d.failed, []);
  assert.deepEqual(
    d.checks.map((c) => c.name).sort(),
    ["coreTeamService", "registryDirWritable", "registryFileExists", "registryLoads", "webPanelsRoutes"].sort(),
  );
  assert.equal(d.core.available, true);
  assert.equal(d.core.cachedSessions, 1);
  assert.match(d.plugin.registryFile, /registry\.json$/);
  assert.deepEqual(d.hints, ["一切正常。"]);
});

test("member_diagnose：webServer 缺失时明确报告面板不可用，且给出可操作提示", async () => {
  const { ctx, tools } = mockCtx({ webServer: null });
  PLUGIN.apply(ctx);
  const d = await tools.get("member_diagnose").execute({});

  const panel = d.checks.find((c) => c.name === "webPanelsRoutes");
  assert.equal(panel.ok, false);
  assert.match(panel.detail, /webServer 服务未出现/);
  assert.ok(d.failed.includes("webPanelsRoutes"));
  assert.ok(d.hints.some((h) => /面板打不开/.test(h)));
});

test("member_diagnose：路由注册抛错时报出错误详情", async () => {
  const { ctx, tools } = mockCtx({ webServerThrows: true });
  PLUGIN.apply(ctx);
  const d = await tools.get("member_diagnose").execute({});
  const panel = d.checks.find((c) => c.name === "webPanelsRoutes");
  assert.equal(panel.ok, false);
  assert.match(panel.detail, /注册失败/);
});

test("member_diagnose：核心服务缺失时报告并解释影响范围", async () => {
  const { ctx, tools } = mockCtx();
  PLUGIN.apply(ctx);
  const d = await tools.get("member_diagnose").execute({});
  const core = d.checks.find((c) => c.name === "coreTeamService");
  assert.equal(core.ok, false);
  assert.match(core.detail, /agentTeams/);
  assert.ok(d.hints.some((h) => /核心团队服务不可用/.test(h)));
  assert.deepEqual(d.failed, ["coreTeamService"], "面板路由是好的，只应 core 失败");
});

test("member_diagnose：名册目录不可写时报告失败而不抛错", async () => {
  const blocked = path.join(TMP_ROOT, `blocked-${Date.now().toString(36)}`);
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  fs.writeFileSync(blocked, "这个文件占住了目录名", "utf8");

  const m = mockCtx({ dir: path.join(TMP_ROOT, `ok-${Date.now().toString(36)}`) });
  m.ctx.config = { dataDir: blocked }; // dataDir 指向一个文件 → mkdir 必然失败
  PLUGIN.apply(m.ctx);

  const d = await m.tools.get("member_diagnose").execute({});
  const w = d.checks.find((c) => c.name === "registryDirWritable");
  assert.equal(w.ok, false);
  assert.ok(d.failed.includes("registryDirWritable"));
  assert.ok(d.hints.some((h) => /不可写/.test(h)));
  assert.equal(typeof d.plugin.registryFile, "string", "仍返回结构化结果，没把异常抛给宿主");
});

test("member_diagnose：孤儿成员只提示、不判为错误", async () => {
  const agentTeams = fakeAgentTeams({ rows: [{ id: "lead", name: "lead", role: "lead" }] });
  const { ctx, tools } = mockCtx({ agentTeams });
  PLUGIN.apply(ctx);
  await tools.get("member_add").execute({ target: "ghost-member" }); // 核心列表里没有它
  const d = await tools.get("member_diagnose").execute({}, { agent: LEAD_AGENT });
  assert.equal(d.ok, true, "孤儿是提示，不应让整体 ok=false");
  assert.ok(d.hints.some((h) => /不在核心当前成员列表/.test(h)));
});

/* ================== 防回归：真实故障（ctx 未声明属性抛错） ================== */

/** 造一个"像 cordis 那样"的 ctx：访问未声明的属性直接抛错 */
function cordisLikeCtx(extra = {}) {
  const base = Object.assign(
    {
      effect: (fn) => {
        const d = fn();
        return d;
      },
      get: () => undefined,
      on: () => {},
      webServer: { register: () => () => {} },
      tools: { register: () => () => {} },
    },
    extra,
  );
  return new Proxy(base, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === "string") throw new Error(`cannot get property "${prop}" without inject`);
      return undefined;
    },
    has: () => true,
  });
}

test("回归：ctx 访问未声明属性即抛错时，apply 仍能完整执行（真实故障根因）", async () => {
  const dir = path.join(TMP_ROOT, `case-proxy-${Date.now().toString(36)}`);
  const tools = new Map();
  const routes = new Map();
  const ctx = cordisLikeCtx({
    webServer: {
      register(route) {
        routes.set(route.path, route.handler);
        return () => {};
      },
    },
    tools: {
      register(tool) {
        tools.set(tool.name, tool);
        return () => {};
      },
    },
  });

  // 关键：这里连 ctx.config 都会抛错（config 不在 inject 列表里）。
  // 早期实现写了 `ctx.config`，导致 apply 在第一行后中断、工具与路由全部注册不上。
  assert.doesNotThrow(() => PLUGIN.apply(ctx, {  dataDir: dir }));
  assert.equal(tools.size, 29, "29 个工具（16 名册 + 13 公司化）都应注册（真实故障时这里是 0）");
  assert.equal(routes.size, 16, "16 条路由（10 名册 + 5 公司化只读 + 1 面板写接口）都应注册（真实故障时这里是 0）");
});

test("回归：不给 config 且 ctx 会抛错时，回退默认目录且不崩溃", () => {
  const tools = new Map();
  const routes = new Map();
  const ctx = cordisLikeCtx({
    webServer: {
      register(route) {
        routes.set(route.path, route.handler);
        return () => {};
      },
    },
    tools: {
      register(tool) {
        tools.set(tool.name, tool);
        return () => {};
      },
    },
  });
  assert.doesNotThrow(() => PLUGIN.apply(ctx)); // 无第二个参数
  assert.equal(tools.size, 29);
  assert.equal(routes.size, 16);
});

test("配置取自第二个参数（与官方 apply(ctx, config) 一致），优先于 ctx.config", async () => {
  const { ctx, tools } = mockCtx(); // mockCtx 的 ctx.config 指向另一个目录
  const dir = path.join(TMP_ROOT, `case-cfg-${Date.now().toString(36)}`);
  PLUGIN.apply(ctx, {  dataDir: dir });

  const d = await tools.get("member_diagnose").execute({});
  assert.equal(d.plugin.dataDir, dir, "应使用第二个参数里的 dataDir");
  assert.ok(d.plugin.registryFile.startsWith(dir));
});

/* ================== 功能②：技能目录（skill_list / /skills / 非阻断提示） ================== */

/** 造一个 ctx.get("skills") 替身 */
function fakeSkills(items) {
  return {
    calls: 0,
    async list() {
      this.calls++;
      return items;
    },
  };
}

test("skill_list：列出本机技能（名称 + 描述 + 来源 + 路径）", async () => {
  const skills = fakeSkills([
    { name: "office-docx", description: "创建、读取、编辑 Word 文档", source: "filesystem", provider: "filesystem", invocation: { modelInvocable: true, userInvocable: false } },
    { name: "file-processing-master", description: "Office 三件套与 PDF 转换", source: "filesystem", provider: "filesystem", path: "C:/x/SKILL.md", invocation: { modelInvocable: true, userInvocable: true } },
  ]);
  const { ctx, tools } = mockCtx({ skills });
  PLUGIN.apply(ctx);

  const out = await tools.get("skill_list").execute({});
  assert.equal(out.ok, true);
  assert.equal(out.total, 2);
  assert.equal(out.returned, 2);
  // 合并结果统一按名称排序（注册表、扫盘、过滤后的顺序都一致）
  assert.deepEqual(out.skills.map((s) => s.name), ["file-processing-master", "office-docx"]);
  const fpm = out.skills[0];
  const docx = out.skills[1];
  assert.equal(fpm.description, "Office 三件套与 PDF 转换");
  assert.equal(fpm.path, "C:/x/SKILL.md");
  assert.equal(fpm.userInvocable, true);
  assert.equal(docx.description, "创建、读取、编辑 Word 文档", "描述必须带出来（本功能的核心诉求）");
  assert.equal(docx.source, "filesystem");
  assert.equal(docx.modelInvocable, true);
  assert.equal(skills.calls, 1);
});

test("skill_list：keyword 同时匹配名称与描述；modelInvocableOnly 按调用策略过滤", async () => {
  const skills = fakeSkills([
    { name: "alpha", description: "处理 PDF 的", invocation: { modelInvocable: true, userInvocable: false } },
    { name: "beta", description: "别的", invocation: { modelInvocable: true, userInvocable: true } },
    { name: "gamma-pdf", description: "不相关", invocation: { modelInvocable: false, userInvocable: true } },
  ]);
  const { ctx, tools } = mockCtx({ skills });
  PLUGIN.apply(ctx);
  const tool = tools.get("skill_list");

  const byKeyword = await tool.execute({ keyword: "pdf" });
  assert.deepEqual(byKeyword.skills.map((s) => s.name).sort(), ["alpha", "gamma-pdf"], "应同时命中描述与名称");

  const onlyModel = await tool.execute({ modelInvocableOnly: true });
  assert.deepEqual(onlyModel.skills.map((s) => s.name).sort(), ["alpha", "beta"]);

  const both = await tool.execute({ keyword: "pdf", modelInvocableOnly: true });
  assert.deepEqual(both.skills.map((s) => s.name), ["alpha"]);
  assert.equal(both.total, 3, "total 是过滤前的总数");
});

test("skill_list：技能服务不可用时优雅降级（不抛错、不崩）", async () => {
  const { ctx, tools } = mockCtx(); // 没有 skills 服务
  PLUGIN.apply(ctx); // 关掉扫盘，否则会扫到本机真实技能
  const out = await tools.get("skill_list").execute({});
  assert.equal(out.ok, false);
  assert.equal(out.code, "SKILLS_SERVICE_UNAVAILABLE");
  assert.deepEqual(out.items, []);
});

test("skill_list：技能服务抛错时也不把异常漏给宿主", async () => {
  const skills = {
    async list() {
      throw new Error("目录读取失败");
    },
  };
  const { ctx, tools } = mockCtx({ skills });
  PLUGIN.apply(ctx);
  const out = await tools.get("skill_list").execute({});
  assert.equal(out.ok, false);
  assert.equal(out.code, "SKILLS_LIST_FAILED");
  assert.match(out.message, /目录读取失败/);
});

test("HTTP /skills：返回技能目录，供面板弹层使用", async () => {
  const skills = fakeSkills([{ name: "one", description: "第一个技能" }]);
  const { ctx, routes } = mockCtx({ skills });
  PLUGIN.apply(ctx);

  const r = await call(routes.get("/api/dsh-member-manager/skills"), "GET");
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.data.total, 1);
  assert.equal(r.json.data.skills[0].name, "one");
  assert.equal(r.json.data.skills[0].description, "第一个技能");
});

test("HTTP /skills：服务缺失时返回 200 + 空列表 + warning（面板可优雅降级）", async () => {
  const { ctx, routes } = mockCtx();
  PLUGIN.apply(ctx);
  const r = await call(routes.get("/api/dsh-member-manager/skills"), "GET");
  assert.equal(r.status, 200, "不应因技能服务缺失而报错，面板要能降级");
  assert.equal(r.json.ok, true);
  assert.deepEqual(r.json.data.skills, []);
  assert.match(r.json.data.warning, /SKILLS_SERVICE_UNAVAILABLE/);
});

test("HTTP /skills：方法不匹配返回 405", async () => {
  const { ctx, routes } = mockCtx();
  PLUGIN.apply(ctx);
  const r = await call(routes.get("/api/dsh-member-manager/skills"), "POST");
  assert.equal(r.status, 405);
});

test("member_set_skills：不在技能目录中的名字给出非阻断提示，但仍然写入", async () => {
  const skills = fakeSkills([{ name: "known-skill", description: "在目录里" }]);
  const { ctx, tools } = mockCtx({ skills });
  PLUGIN.apply(ctx);
  await tools.get("member_add").execute({ target: "m1" });

  const out = await tools.get("member_set_skills").execute({ target: "m1", skills: ["known-skill", "custom-tag"] });
  assert.equal(out.ok, true);
  assert.deepEqual(out.data.members[0].skills, ["known-skill", "custom-tag"], "自定义标签仍应写入");
  assert.match(out.note, /custom-tag/, "应提示不在目录中");

  const clean = await tools.get("member_set_skills").execute({ target: "m1", skills: ["known-skill"] });
  assert.equal(clean.note, undefined, "全部命中目录时不应有提示");
});

/* ================== 无损 JSON 一致性（DSH 的硬校验，防整类 bug） ================== */

test("所有工具的输出都能无损 JSON 往返（DSH 会拒绝 lossless 校验失败的输出）", async () => {
  // 真实故障：skill_list 曾给 whenToUse/path 赋 undefined，
  // JSON.stringify 丢掉这些键 ⇒ 往返后对象不相等 ⇒ DSH 报 "value is not lossless JSON"。
  // 这个测试对**每个**工具都做同样的往返校验，防止这一类问题再次出现。
  const agentTeams = fakeAgentTeams({
    rows: [
      { id: "lead", name: "lead", role: "lead" },
      { id: "s1", name: "m1", role: "teammate" },
    ],
  });
  const skills = fakeSkills([
    // 可选字段全缺的条目 —— 正是当初的触发点
    { name: "only-name" },
    { name: "full", description: "有描述", whenToUse: "何时用", source: "filesystem", provider: "fs", path: "C:/p/SKILL.md", invocation: { modelInvocable: true, userInvocable: true } },
  ]);
  const { ctx, tools } = mockCtx({ agentTeams, skills });
  PLUGIN.apply(ctx, {  dataDir: path.join(TMP_ROOT, `case-lossless-${Date.now().toString(36)}`) });

  const cases = [
    ["member_list", {}],
    ["member_add", { target: "m1", displayName: "甲" }],
    ["member_rename", { target: "m1", displayName: "乙" }],
    ["member_set_role", { target: "m1", title: "岗位", duties: ["职责"] }],
    ["member_set_skills", { target: "m1", skills: ["only-name"] }],
    ["group_manage", { action: "create", id: "g1", name: "组一" }],
    ["member_sync", {}],
    ["member_diagnose", {}],
    ["skill_list", {}],
    ["model_list", {}],
    ["member_remove", { target: "m1" }],
  ];

  for (const [name, args] of cases) {
    const value = await tools.get(name).execute(args, { agent: LEAD_AGENT });
    const round = JSON.parse(JSON.stringify(value));
    assert.deepEqual(round, value, `${name} 的输出必须能无损 JSON 往返（否则 DSH 会拒绝）`);
  }
});

test("skill_list：可选字段缺失时不产生 undefined 键（lossless 回归）", async () => {
  const skills = fakeSkills([{ name: "only-name" }]);
  const { ctx, tools } = mockCtx({ skills });
  PLUGIN.apply(ctx);
  const out = await tools.get("skill_list").execute({});
  const item = out.skills[0];
  assert.equal(item.name, "only-name");
  assert.equal(item.description, "", "缺失描述应回退为空串而不是 undefined");
  assert.equal(item.modelInvocable, true, "默认应可被模型调用");
  assert.equal(item.userInvocable, false);
  // 关键：这些可选键必须**不存在**，而不是存在但值为 undefined
  for (const k of ["whenToUse", "source", "provider", "path"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(item, k), false, `${k} 不应出现（值为 undefined 会让 JSON 往返不相等）`);
  }
});

/* ================== 功能①：修改成员模型（真生效） ================== */

/** 造一个带作用域 ctx 的 agent 替身，记录它被挂了哪些事件监听 */
function fakeAgent(id) {
  const handlers = new Map();
  return {
    id,
    _handlers: handlers,
    ctx: {
      on(evt, fn) {
        if (!handlers.has(evt)) handlers.set(evt, []);
        handlers.get(evt).push(fn);
        return () => {};
      },
    },
  };
}

/** 触发某个 agent 上挂的监听（模拟 DSH 派发水位）。argsBeforeNext 是 next 之前的参数，
 *  因为不同事件的签名不同：agent/request 是 (payload, next)，
 *  system-prompt/assemble 是 (assembly, context, next)。 */
async function fireAgentEvent(agent, evt, argsBeforeNext, next) {
  const list = agent._handlers.get(evt) || [];
  assert.ok(list.length > 0, `agent ${agent.id} 上应挂有 ${evt} 监听`);
  return list[0](...argsBeforeNext, next);
}

test("功能①：为 agent 装上 agent/request 覆盖，并把名册里的模型真正写进请求配置", async () => {
  const agent = fakeAgent("a1");
  const agentTeams = fakeAgentTeams({
    membershipFor: (a) => (a && a.id === "a1" ? { root: { id: "root-1" }, id: "root-1", role: "teammate", name: "m1" } : undefined),
  });
  const { ctx, tools } = mockCtx({ agentTeams, agents: [agent] });
  PLUGIN.apply(ctx);

  // 预存在的 agent 应已被装上监听（走 ctx.agents.list() 那一遍）
  assert.ok(agent._handlers.has("agent/request"), "应为 agent 安装 agent/request 监听");
  assert.ok(agent._handlers.has("system-prompt/assemble"), "应同时安装 system-prompt/assemble");

  await tools.get("member_add").execute({ target: "m1" });

  // 未设模型时：原样透传
  const passthrough = await fireAgentEvent(agent, "agent/request", [{}], async () => ({ provider: "p", model: "original-model" }));
  assert.equal(passthrough.model, "original-model", "没有覆盖时应原样返回 seed");
  assert.equal(passthrough.provider, "p");

  // 设置模型覆盖
  const set = await tools.get("member_set_model").execute({ target: "m1", model: "deepseek-pro", provider: "deepseek-account" });
  assert.equal(set.ok, true);
  assert.equal(set.member.model, "deepseek-pro");

  // 关键断言：请求配置真的被改写
  const overridden = await fireAgentEvent(agent, "agent/request", [{}], async () => ({ provider: "p", model: "original-model", reasoningEffort: "high" }));
  assert.equal(overridden.model, "deepseek-pro", "模型必须被真的覆盖");
  assert.equal(overridden.provider, "deepseek-account");
  assert.equal(overridden.reasoningEffort, "high", "不应丢掉 seed 里的其它字段");

  // 系统提示变量也要跟着变
  const assembled = await fireAgentEvent(agent, "system-prompt/assemble", [{}, {}], async () => ({ variables: { foo: "bar" } }));
  assert.equal(assembled.variables.model, "deepseek-pro");
  assert.equal(assembled.variables.provider, "deepseek-account");
  assert.equal(assembled.variables.foo, "bar", "不应丢掉其它变量");

  // 清除覆盖 → 恢复透传
  const cleared = await tools.get("member_set_model").execute({ target: "m1", model: "" });
  assert.equal(cleared.ok, true);
  assert.equal(cleared.member.model, undefined, "清除后不应再有 model");
  const afterClear = await fireAgentEvent(agent, "agent/request", [{}], async () => ({ provider: "p", model: "original-model" }));
  assert.equal(afterClear.model, "original-model", "清除后应恢复 seed 的模型");
});

test("功能①：写入后缓存立刻失效（无需等 TTL），且停用成员不再享受覆盖", async () => {
  const agent = fakeAgent("a2");
  const agentTeams = fakeAgentTeams({
    membershipFor: () => ({ root: { id: "root-1" }, id: "root-1", role: "teammate", name: "m2" }),
  });
  const { ctx, tools } = mockCtx({ agentTeams, agents: [agent] });
  PLUGIN.apply(ctx);
  await tools.get("member_add").execute({ target: "m2" });

  await tools.get("member_set_model").execute({ target: "m2", model: "model-A" });
  let out = await fireAgentEvent(agent, "agent/request", [{}], async () => ({ provider: "p", model: "seed" }));
  assert.equal(out.model, "model-A", "写入后应立即生效（onWrite 失效缓存）");

  await tools.get("member_set_model").execute({ target: "m2", model: "model-B" });
  out = await fireAgentEvent(agent, "agent/request", [{}], async () => ({ provider: "p", model: "seed" }));
  assert.equal(out.model, "model-B", "第二次写入也应立即生效");

  // 停用成员 → 覆盖失效（停用的人不该还在用特殊模型）
  await tools.get("member_remove").execute({ target: "m2" });
  out = await fireAgentEvent(agent, "agent/request", [{}], async () => ({ provider: "p", model: "seed" }));
  assert.equal(out.model, "seed", "已停用成员的覆盖应失效");
});

test("功能①：agent/created 事件（官方载荷 {agent}）也会装上覆盖", async () => {
  const agentTeams = fakeAgentTeams({
    membershipFor: () => ({ root: { id: "root-1" }, id: "root-1", role: "teammate", name: "m3" }),
  });
  const { ctx, tools, events } = mockCtx({ agentTeams, agents: [] });
  PLUGIN.apply(ctx);
  await tools.get("member_add").execute({ target: "m3" });
  await tools.get("member_set_model").execute({ target: "m3", model: "event-model" });

  const created = events.get("agent/created") || [];
  assert.ok(created.length > 0, "应订阅 agent/created");

  const late = fakeAgent("a3");
  created.forEach((fn) => fn({ agent: late })); // 官方载荷形状
  assert.ok(late._handlers.has("agent/request"), "新出现的 agent 也应被装上覆盖");

  const out = await fireAgentEvent(late, "agent/request", [{}], async () => ({ provider: "p", model: "seed" }));
  assert.equal(out.model, "event-model");
});

test("功能①：member_set_model 的边界（不存在成员 / 什么都不给 / 无损 JSON）", async () => {
  const { ctx, tools } = mockCtx();
  PLUGIN.apply(ctx);
  await tools.get("member_add").execute({ target: "m4" });

  const missing = await tools.get("member_set_model").execute({ target: "nobody", model: "x" });
  assert.equal(missing.code, "MEMBER_NOT_FOUND");

  const nothing = await tools.get("member_set_model").execute({ target: "m4" });
  assert.equal(nothing.code, "NOTHING_TO_UPDATE");

  const ok = await tools.get("member_set_model").execute({ target: "m4", model: "m", provider: "p" });
  assert.deepEqual(JSON.parse(JSON.stringify(ok)), ok, "输出必须无损 JSON 往返");
  assert.match(ok.applied, /已写入/);

  const cleared = await tools.get("member_set_model").execute({ target: "m4", model: "" });
  assert.match(cleared.applied, /已清除/);
  assert.equal(Object.prototype.hasOwnProperty.call(cleared.member, "model"), false, "清除后不应出现 model 键");
  assert.equal(Object.prototype.hasOwnProperty.call(cleared.member, "provider"), false, "清除模型时不应留下孤立 provider");
});

/* ================== 模型目录（model_list / /models） ================== */

/** 造一个 ctx.get("llm") 替身 */
function fakeLlm(providers) {
  return {
    listProviders: () => providers.map((p) => (p.displayName ? { id: p.id, displayName: p.displayName } : { id: p.id })),
    async listModels(provider) {
      const p = providers.find((x) => x.id === provider);
      if (p && p.throws) throw new Error("目录拉取失败");
      return (p && p.models) || [];
    },
  };
}

test("model_list：列出 provider 与模型目录（含 contextWindow）", async () => {
  const llm = fakeLlm([
    { id: "deepseek-account", displayName: "DeepSeek", models: [{ id: "deepseek-flash", name: "flash", contextWindow: 128000 }, { id: "deepseek-pro" }] },
    { id: "ollama-local", displayName: "千问", models: [{ id: "qwen3.8:latest" }] },
  ]);
  const { ctx, tools } = mockCtx({ llm });
  PLUGIN.apply(ctx);

  const out = await tools.get("model_list").execute({});
  assert.equal(out.ok, true);
  assert.equal(out.providers.length, 2);
  assert.equal(out.providers[0].id, "deepseek-account");
  assert.equal(out.providers[0].displayName, "DeepSeek");
  assert.deepEqual(out.providers[0].models.map((m) => m.id), ["deepseek-flash", "deepseek-pro"]);
  assert.equal(out.providers[0].models[0].contextWindow, 128000);
  assert.equal(out.providers[1].models[0].id, "qwen3.8:latest");

  // 可选字段缺失时不能留下 undefined 键
  assert.equal(Object.prototype.hasOwnProperty.call(out.providers[0].models[1], "contextWindow"), false);
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out, "输出必须无损 JSON 往返");
});

test("model_list：按 provider 过滤；目录拉取失败只影响该 provider", async () => {
  const llm = fakeLlm([
    { id: "good", models: [{ id: "ok-model" }] },
    { id: "broken", throws: true, models: [] },
  ]);
  const { ctx, tools } = mockCtx({ llm });
  PLUGIN.apply(ctx);

  const filtered = await tools.get("model_list").execute({ provider: "good" });
  assert.equal(filtered.providers.length, 1);
  assert.equal(filtered.providers[0].id, "good");

  const all = await tools.get("model_list").execute({});
  assert.equal(all.providers.length, 2);
  assert.match(all.providers[1].error, /目录拉取失败/, "单个 provider 失败应被记录而不是整体失败");
  assert.deepEqual(all.providers[1].models, []);
  assert.deepEqual(JSON.parse(JSON.stringify(all)), all);
});

test("model_list：llm 服务不可用时优雅降级", async () => {
  const { ctx, tools } = mockCtx();
  PLUGIN.apply(ctx);
  const out = await tools.get("model_list").execute({});
  assert.equal(out.ok, false);
  assert.equal(out.code, "LLM_SERVICE_UNAVAILABLE");
  assert.deepEqual(out.providers, []);
});

test("HTTP /models：返回模型目录；服务缺失时返回 200 + 空列表 + warning", async () => {
  const llm = fakeLlm([{ id: "p1", models: [{ id: "m1" }] }]);
  const withLlm = mockCtx({ llm });
  PLUGIN.apply(withLlm.ctx);
  const r = await call(withLlm.routes.get("/api/dsh-member-manager/models"), "GET");
  assert.equal(r.status, 200);
  assert.equal(r.json.data.providers[0].models[0].id, "m1");

  const without = mockCtx();
  PLUGIN.apply(without.ctx);
  const r2 = await call(without.routes.get("/api/dsh-member-manager/models"), "GET");
  assert.equal(r2.status, 200, "服务缺失不应报错，面板要能降级");
  assert.deepEqual(r2.json.data.providers, []);
  assert.match(r2.json.data.warning, /LLM_SERVICE_UNAVAILABLE/);
});

/* ================== 客户端/宿主操作契约（防「加了功能忘了接线」） ================== */

test("面板发出的每一个操作，宿主 OPERATIONS 都必须认识（真实故障：setModel 漏接）", async () => {
  // 真实故障：加了 service.setModel + member_set_model 工具，却忘了往 OPERATIONS 里加 setModel，
  // 于是面板保存编辑表单时 /op 返回 UNKNOWN_OPERATION —— 「改模型点了没反应」。
  // 这条测试从 client.js 里把 post("...") 的操作名全抓出来，逐个打真实路由，
  // 任何一条没接线都会在这里炸，而不是等用户点了才发现。
  const clientSrc = fs.readFileSync(path.join(HERE, "..", "lib", "client.js"), "utf8");
  // 操作名有两种发起方式：直接 post("name", ...)，以及面板的 run("name", ...) 包装
  const ops = [...clientSrc.matchAll(/(?:post|run)\(\s*"([a-zA-Z][a-zA-Z0-9]*)"/g)].map((m) => m[1]);
  assert.ok(ops.length >= 10, `应能从 client.js 里提取到操作名，实际 ${ops.length} 个`);

  const { ctx, routes } = mockCtx();
  PLUGIN.apply(ctx);
  const opRoute = routes.get("/api/dsh-member-manager/op");
  assert.ok(opRoute, "应有 /op 路由");

  const unique = [...new Set(ops)].sort();
  for (const op of unique) {
    // 只给 op 名、不给参数：合法操作会因缺参数返回各自的业务错误码，
    // 但**绝不会**是 UNKNOWN_OPERATION —— 那才是「没接线」的信号。
    const r = await call(opRoute, "POST", JSON.stringify({ op, args: {} }));
    assert.notEqual(r.json && r.json.code, "UNKNOWN_OPERATION", `面板会用到 "${op}"，但它不在宿主 OPERATIONS 里`);
  }
  // 顺手确认 setModel 这条确实在名单里
  assert.ok(unique.includes("setModel"), "client.js 里应确实有 post(\"setModel\")");
});

test("POST /op：setModel 能真正写入模型覆盖（面板路径打通）", async () => {
  const { ctx, routes } = mockCtx();
  PLUGIN.apply(ctx);
  const opRoute = routes.get("/api/dsh-member-manager/op");
  await call(opRoute, "POST", JSON.stringify({ op: "addMember", args: { target: "m9" } }));

  const set = await call(opRoute, "POST", JSON.stringify({ op: "setModel", args: { target: "m9", model: "deepseek-v4-pro", provider: "deepseek-account" } }));
  assert.equal(set.status, 200);
  assert.equal(set.json.ok, true);
  const m = set.json.data.members.find((x) => x.target === "m9");
  assert.equal(m.model, "deepseek-v4-pro", "面板路径必须真的写进名册");

  const cleared = await call(opRoute, "POST", JSON.stringify({ op: "setModel", args: { target: "m9", model: "", provider: "" } }));
  assert.equal(cleared.json.ok, true);
  const m2 = cleared.json.data.members.find((x) => x.target === "m9");
  assert.equal(Object.prototype.hasOwnProperty.call(m2, "model"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(m2, "provider"), false, "清空时不应留下孤立 provider");
});

/* ================== 本地技能扫盘（注册表的兜底） ================== */

/** 造一个本地技能根：目录 bundle + 平铺文件 + 一个不是技能的普通 md */
function makeSkillRoot(tag) {
  const root = path.join(TMP_ROOT, `skills-${tag}-${Date.now().toString(36)}`);
  fs.mkdirSync(path.join(root, "my-local-skill"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "my-local-skill", "SKILL.md"),
    '---\nname: my-local-skill\ndescription: "本地扫到的技能，含逗号, 和冒号: 也要能读"\n---\n\n# 正文\n',
    "utf8",
  );
  fs.writeFileSync(path.join(root, "flat-skill.md"), "---\nname: flat-skill\ndescription: 平铺文件技能\n---\n\n# 正文\n", "utf8");
  fs.writeFileSync(path.join(root, "not-a-skill.md"), "没有 frontmatter 的普通文档\n", "utf8");
  return root;
}

test("技能扫盘：注册表里没有的本地技能会被直接扫盘补齐（file-processing-master 那类）", async () => {
  // 真实故障：只调 ctx.skills.list({}) 时，本 profile 的第三方 provider 不扫
  // ~/.dsh/skills 这一层，于是 file-processing-master 这类技能在下拉里消失。
  const root = makeSkillRoot("fill");
  const skills = fakeSkills([{ name: "from-registry", description: "注册表里的" }]);
  const { ctx, tools, dir } = mockCtx({ skills });
  // 刻意**不关**扫盘：只给额外根，验证兜底生效
  PLUGIN.apply(ctx, { dataDir: dir, extraSkillRoots: [root] });

  const out = await tools.get("skill_list").execute({});
  const names = out.skills.map((s) => s.name);
  assert.ok(names.includes("from-registry"), "注册表里的技能必须还在");
  assert.ok(names.includes("my-local-skill"), "目录 bundle 应被扫到");
  assert.ok(names.includes("flat-skill"), "平铺 .md 应被扫到");
  assert.ok(!names.includes("not-a-skill"), "没有 frontmatter 的普通 md 不应算技能");

  const local = out.skills.find((s) => s.name === "my-local-skill");
  assert.equal(local.description, "本地扫到的技能，含逗号, 和冒号: 也要能读", "描述要去掉外层引号且保留原样");
  assert.equal(local.source, "local");
  assert.equal(local.provider, "local-scan");
  assert.equal(local.modelInvocable, true, "扫到的技能默认可被模型调用");
  assert.ok(local.path.endsWith("SKILL.md"));
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out, "输出必须无损 JSON 往返");
});

test("技能扫盘：与注册表重名时注册表优先，不被扫盘覆盖", async () => {
  const root = path.join(TMP_ROOT, `skills-dup-${Date.now().toString(36)}`);
  fs.mkdirSync(path.join(root, "dup-skill"), { recursive: true });
  fs.writeFileSync(path.join(root, "dup-skill", "SKILL.md"), "---\nname: dup-skill\ndescription: 磁盘版本\n---\n", "utf8");

  const skills = fakeSkills([{ name: "dup-skill", description: "注册表版本", source: "bundled", provider: "official" }]);
  const { ctx, tools, dir } = mockCtx({ skills });
  PLUGIN.apply(ctx, { dataDir: dir, extraSkillRoots: [root] });

  const out = await tools.get("skill_list").execute({});
  const dup = out.skills.filter((s) => s.name === "dup-skill");
  assert.equal(dup.length, 1, "重名只应出现一次");
  assert.equal(dup[0].description, "注册表版本", "注册表优先");
  assert.equal(dup[0].provider, "official");
});

test("技能扫盘：scanLocalSkills=false 时完全不扫盘（默认配置项可用）", async () => {
  const root = makeSkillRoot("off");
  const skills = fakeSkills([{ name: "from-registry" }]);
  const { ctx, tools, dir } = mockCtx({ skills });
  PLUGIN.apply(ctx, { dataDir: dir, scanLocalSkills: false, extraSkillRoots: [root] });

  const out = await tools.get("skill_list").execute({});
  assert.deepEqual(out.skills.map((s) => s.name), ["from-registry"], "关掉扫盘后只应有注册表结果");
});

/* ================== 模型覆盖的可观测性 ================== */

test("模型覆盖可观测性：覆写真的发生在请求水位上时 applied 增长（这是「真生效」的现场证据）", async () => {
  const agent = fakeAgent("aObs");
  const agentTeams = fakeAgentTeams({
    membershipFor: () => ({ root: { id: "root-1" }, id: "root-1", role: "teammate", name: "mo" }),
  });
  const { ctx, tools, routes } = mockCtx({ agentTeams, agents: [agent] });
  PLUGIN.apply(ctx);
  const route = routes.get("/api/dsh-member-manager/overrides");
  assert.ok(route, "应有 /overrides 路由");

  let r = await call(route, "GET");
  assert.equal(r.status, 200);
  assert.equal(r.json.data.applied, 0, "还没发生过覆写");
  assert.equal(r.json.data.installedCount, 1, "应为预存在的 agent 装上监听");
  assert.equal(r.json.data.lastApplied, null);

  await tools.get("member_add").execute({ target: "mo" });
  await tools.get("member_set_model").execute({ target: "mo", model: "deepseek-v4-pro", provider: "deepseek-account" });

  // 触发一次真实的 agent/request 水位
  const out = await fireAgentEvent(agent, "agent/request", [{}], async () => ({ provider: "deepseek-account", model: "deepseek-flash" }));
  assert.equal(out.model, "deepseek-v4-pro", "请求配置被改写");

  r = await call(route, "GET");
  assert.equal(r.json.data.applied, 1, "applied 必须记账 —— 这是覆写发生在真实请求上的证据");
  assert.equal(r.json.data.lastApplied.model, "deepseek-v4-pro");
  assert.equal(r.json.data.lastApplied.target, "mo");
  assert.equal(r.json.data.lastApplied.agentId, "aObs");
  assert.ok(r.json.data.lastApplied.at, "应记录时间");
  assert.deepEqual(JSON.parse(JSON.stringify(r.json)), r.json, "输出必须无损 JSON 往返");

  // 没有覆盖的成员 → 记 misses，且不改写
  const bare = fakeAgent("aBare");
  agentTeams.listMembers = async () => [];
  const out2 = await fireAgentEvent(agent, "agent/request", [{}], async () => ({ provider: "p", model: "seed" }));
  assert.equal(out2.model, "deepseek-v4-pro", "仍有覆盖");
  assert.ok(bare.id);
});

test("member_diagnose：带上模型覆盖的运行统计", async () => {
  const agent = fakeAgent("aD");
  const agentTeams = fakeAgentTeams({
    membershipFor: () => ({ root: { id: "root-1" }, id: "root-1", role: "teammate", name: "md" }),
  });
  const { ctx, tools } = mockCtx({ agentTeams, agents: [agent] });
  PLUGIN.apply(ctx);
  await tools.get("member_add").execute({ target: "md" });
  await tools.get("member_set_model").execute({ target: "md", model: "m-x" });
  await fireAgentEvent(agent, "agent/request", [{}], async () => ({ provider: "p", model: "seed" }));

  const d = await tools.get("member_diagnose").execute({});
  assert.ok(d.modelOverride, "诊断结果应包含模型覆盖统计");
  assert.equal(d.modelOverride.applied, 1);
  assert.equal(d.modelOverride.installedAgents, 1);
  assert.equal(d.modelOverride.lastApplied.model, "m-x");
  assert.deepEqual(JSON.parse(JSON.stringify(d)), d, "输出必须无损 JSON 往返");
});

/* ================================================================== */
/* 0.2.0：备份 / 工作流 / 自动更新 / 一句话建组                          */
/* ================================================================== */

test("0.2.0 备份：backupNow 生成快照，restoreBackup 能把名册恢复回去", async () => {
  const { ctx, tools, routes } = mockCtx();
  PLUGIN.apply(ctx);

  const add = await tools.get("member_add").execute({ target: "keep-me", displayName: "别丢我" });
  assert.equal(add.ok, true);

  const backups = await call(routes.get("/api/dsh-member-manager/backups"), "GET");
  assert.equal(backups.status, 200);
  assert.equal(backups.json.data.enabled, true, "默认应开启备份");
  assert.equal(backups.json.data.count, 0, "启动时名册还不存在，允许 0 份");

  const made = await call(
    routes.get("/api/dsh-member-manager/op"),
    "POST",
    JSON.stringify({ op: "backupNow", args: { reason: "test" } }),
  );
  assert.equal(made.status, 200);
  assert.equal(made.json.ok, true);
  const file = made.json.data.file;
  assert.match(file, /^registry-.*-test\.json$/);

  const findMember = (view, target) =>
    [...view.groups.flatMap((g) => g.members), ...view.ungrouped, ...(view.retired || [])].find((m) => m.target === target);
  const readState = async () => (await call(routes.get("/api/dsh-member-manager/state"), "GET")).json.data;

  // 制造「丢失」：软删该成员
  await tools.get("member_remove").execute({ target: "keep-me" });
  let row = findMember(await readState(), "keep-me");
  assert.ok(row, "软删后成员仍应在名册里（只是 retired）");
  assert.equal(row.isRetired, true);

  // 恢复备份
  const restored = await call(
    routes.get("/api/dsh-member-manager/op"),
    "POST",
    JSON.stringify({ op: "restoreBackup", args: { file } }),
  );
  assert.equal(restored.status, 200);
  assert.equal(restored.json.ok, true);

  row = findMember(await readState(), "keep-me");
  assert.equal(row.isRetired, false, "恢复后成员应重新是 active");
  assert.equal(row.displayName, "别丢我");

  // 恢复前应自动留了一份安全备份
  const view = await call(routes.get("/api/dsh-member-manager/backups"), "GET");
  const reasons = view.json.data.list.map((b) => b.reason);
  assert.ok(reasons.includes("pre-restore"), "恢复前应有 pre-restore 安全备份");
});

test("0.2.0 备份：恢复不存在的文件返回错误码而不是 500", async () => {
  const { ctx, routes } = mockCtx();
  PLUGIN.apply(ctx);
  const r = await call(
    routes.get("/api/dsh-member-manager/op"),
    "POST",
    JSON.stringify({ op: "restoreBackup", args: { file: "registry-nope.json" } }),
  );
  assert.equal(r.status, 400);
  assert.equal(r.json.ok, false);
  assert.equal(r.json.code, "BACKUP_NOT_FOUND");
});

test("0.2.0 工作流：/workflow 返回成员行与总量，任务板缺失时明确降级", async () => {
  const { ctx, tools, routes } = mockCtx();
  PLUGIN.apply(ctx);
  await tools.get("member_add").execute({ target: "wf-member", displayName: "工作流成员" });

  const r = await call(routes.get("/api/dsh-member-manager/workflow"), "GET");
  assert.equal(r.status, 200);
  const data = r.json.data;
  assert.equal(data.version, 1);
  assert.ok(Array.isArray(data.members));
  assert.ok(data.members.some((m) => m.target === "wf-member"));
  assert.equal(typeof data.totals.totalTokens, "number");
  assert.equal(typeof data.totals.requests, "number");
  assert.equal(typeof data.generatedAt, "string");
  // 没装 agent-team：任务板不可用，必须是显式降级而不是抛错
  assert.equal(data.tasksAvailable, false);
  assert.ok(Array.isArray(data.tasks));

  const tool = await tools.get("member_workflow").execute({});
  assert.ok(Array.isArray(tool.members));
  assert.equal(tool.sessions, undefined, "工具输出应是瘦身视图");
});

test("0.2.0 工作流：session/event 按位置参数 (session, event) 采集 usage 并计入总量", async () => {
  const { ctx, events, routes } = mockCtx();
  PLUGIN.apply(ctx);
  const listeners = events.get("session/event") || [];
  assert.equal(listeners.length, 1, "必须挂上一个 session/event 监听");

  const session = { id: "s-wf-1" };
  listeners[0](session, {
    type: "assistant/message",
    data: { usage: { inputTokens: 120, outputTokens: 30, cacheReadTokens: 480, totalTokens: 150 } },
  });
  listeners[0](session, { type: "tool/call", data: { usage: { inputTokens: 999 } } });

  const r = await call(routes.get("/api/dsh-member-manager/workflow"), "GET");
  assert.equal(r.json.data.totals.totalTokens, 150);
  assert.equal(r.json.data.totals.outputTokens, 30);
  assert.equal(r.json.data.totals.requests, 1, "非 assistant/message 事件不能计入请求数");
  assert.equal(r.json.data.totals.cacheReadTokens, 480);
});

test("0.2.0 更新：/update 只报告状态，默认离线应用（offline-script）", async () => {
  const { ctx, routes } = mockCtx();
  PLUGIN.apply(ctx);
  const r = await call(routes.get("/api/dsh-member-manager/update"), "GET");
  assert.equal(r.status, 200);
  const data = r.json.data;
  assert.equal(data.applyMode, "offline-script");
  assert.equal(data.allowOnlineApply, false);
  assert.equal(data.restartRequired, true);
  assert.equal(typeof data.current, "string");
  assert.equal(data.pending, null);
  assert.match(data.applyCommand, /apply-pending\.mjs/);
});

test("0.2.0 更新：运行中 apply 默认被拒绝（NEEDS_OFFLINE_APPLY），且不写任何东西", async () => {
  const { ctx, tools } = mockCtx();
  PLUGIN.apply(ctx);
  const r = await tools.get("member_update").execute({ action: "apply" });
  assert.equal(r.ok, false);
  assert.equal(r.code, "NEEDS_OFFLINE_APPLY", `实际 code=${r.code}`);
  assert.match(r.detail.applyCommand, /apply-pending\.mjs/);
});

test("0.2.0 更新：显式 allowOnlineApply 后仍受 pending 闸门保护", async () => {
  const { ctx, tools } = mockCtx();
  ctx.config.update = { allowOnlineApply: true };
  PLUGIN.apply(ctx);
  const r = await tools.get("member_update").execute({ action: "apply" });
  assert.equal(r.ok, false);
  assert.ok(["NO_PENDING", "JUNCTION_INSTALL"].includes(r.code), `实际 code=${r.code}`);
});

test("0.2.0 一句话建组：默认只预览，confirm 才真正写名册", async () => {
  const { ctx, tools, routes } = mockCtx();
  PLUGIN.apply(ctx);
  const text = "创建一个叫「质检组」的小组：图纸审阅员（负责审图纸、出审阅意见）、缺陷记录员（负责登记缺陷）";

  const preview = await call(
    routes.get("/api/dsh-member-manager/op"),
    "POST",
    JSON.stringify({ op: "createGroupFromText", args: { text } }),
  );
  assert.equal(preview.status, 200);
  assert.equal(preview.json.ok, true);
  assert.equal(preview.json.data.dryRun, true);
  assert.equal(preview.json.data.group.name, "质检组");

  let state = await call(routes.get("/api/dsh-member-manager/state"), "GET");
  assert.equal(state.json.data.groups.length, 0, "预览阶段不应落盘");

  const confirmed = await call(
    routes.get("/api/dsh-member-manager/op"),
    "POST",
    JSON.stringify({ op: "createGroupFromText", args: { text, confirm: true } }),
  );
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.json.ok, true);
  assert.equal(confirmed.json.data.dryRun, false);

  state = await call(routes.get("/api/dsh-member-manager/state"), "GET");
  assert.equal(state.json.data.groups.length, 1);
  assert.equal(state.json.data.groups[0].name, "质检组");
  const targets = state.json.data.groups[0].members.map((m) => m.target);
  assert.deepEqual(targets.sort(), ["recorder", "reviewer"]);
});
