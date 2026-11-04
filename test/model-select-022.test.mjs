/**
 * 0.2.2 适配回归：模型覆盖必须走 `agent.model.select()`，不再改写 `agent/request`。
 *
 * 背景：0.2.2 的 agent-loop 在 pre-step 就把 selection 固定，`agent/request` 的返回值
 * 若与固定值不一致会直接抛错（`use agent.model.select() before step preparation`）。
 * 所以这里锁两件事：
 *   1. 宿主有 `agent.model.select` → 只提前落 selection，不挂 agent/request；
 *   2. 宿主没有（0.2.1 及更早）→ 仍然挂 agent/request 做返回覆写。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mm022-"));
process.env.DSH_HOME = TMP;

function writeRegistry(dir) {
  const file = path.join(dir, "registry.json");
  const now = new Date().toISOString();
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      updatedAt: now,
      groups: [],
      members: [
        {
          target: "lead",
          displayName: "大总管",
          aliases: [],
          groupId: null,
          title: "总经理",
          duties: [],
          skills: [],
          status: "active",
          retiredAt: null,
          note: "",
          createdAt: now,
          updatedAt: now,
          model: "deepseek-v4-pro-0813",
          provider: "tokenrhythm",
        },
      ],
    }),
    "utf8",
  );
  return file;
}

function mockCtx(registryFile, liveAgents, options) {
  const tools = new Map();
  const routes = new Map();
  const events = new Map();
  const leadRole = Boolean(options && options.leadRole);
  const team = {
    tryMembership: (agent) => (agent && agent.__member ? { name: agent.__member } : undefined),
    listMembers: () => (leadRole ? [{ id: "lead", name: "lead", role: "lead" }] : []),
  };
  const ctx = {
    config: { dataDir: path.dirname(registryFile), registryFile, scanLocalSkills: false },
    effect(fn) {
      const d = fn();
      return typeof d === "function" ? d : undefined;
    },
    get(service) {
      if (service === "agentTeams") return team;
      if (service === "agents") return { list: () => liveAgents || [] };
      return undefined;
    },
    on(evt, fn) {
      if (!events.has(evt)) events.set(evt, []);
      events.get(evt).push(fn);
    },
    webServer: {
      register(route) {
        routes.set(route.path, route.handler);
        return () => routes.delete(route.path);
      },
    },
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
  return { ctx, events, tools, routes };
}

const PLUGIN = await import("../lib/index.js");

function fire(events, name, payload) {
  for (const fn of events.get(name) || []) fn(payload);
}

test("0.2.2：有 agent.model.select 时只落 selection，不挂 agent/request", () => {
  const dir = fs.mkdtempSync(path.join(TMP, "case-a-"));
  const reg = writeRegistry(dir);
  const { ctx, events } = mockCtx(reg);
  PLUGIN.apply(ctx);

  const selects = [];
  const agentEvents = [];
  const agentCtx = {
    on(evt) {
      agentEvents.push(evt);
      return () => {};
    },
  };
  const agent = {
    id: "agent-022",
    __member: "lead",
    session: { header: { delegationDepth: 1, origin: "subagent" } },
    ctx: agentCtx,
    model: {
      options: { provider: "deepseek-account", model: "deepseek-flash" },
      current: () => ({ provider: "deepseek-account", model: "deepseek-flash" }),
      select(selection) {
        selects.push(selection);
      },
    },
  };

  fire(events, "agent/created", { agent });

  assert.equal(selects.length, 1, "model.select 应被调用一次");
  assert.equal(selects[0].provider, "tokenrhythm");
  assert.equal(selects[0].model, "deepseek-v4-pro-0813");
  assert.ok(
    !agentEvents.includes("agent/request"),
    "0.2.2 下不得挂 agent/request（宿主会因路由不一致抛错）",
  );
  assert.ok(
    agentEvents.includes("system-prompt/assemble"),
    "提示词变量钩子仍应安装（它不参与路由校验）",
  );
});

test("0.2.1：没有 agent.model 时回落到 agent/request 改写", () => {
  const dir = fs.mkdtempSync(path.join(TMP, "case-b-"));
  const reg = writeRegistry(dir);
  const { ctx, events } = mockCtx(reg);
  PLUGIN.apply(ctx);

  const agentEvents = [];
  const agentCtx = {
    on(evt) {
      agentEvents.push(evt);
      return () => {};
    },
  };
  const agent = {
    id: "agent-021",
    __member: "lead",
    session: { header: { delegationDepth: 1 } },
    ctx: agentCtx,
  };

  fire(events, "agent/created", { agent });

  assert.ok(agentEvents.includes("agent/request"), "0.2.1 宿主仍需 agent/request 覆写");
  assert.ok(!agent.model, "该宿主的 agent 没有 model 字段");
});

test("lead：不接受模型覆盖（member_set_model 直接拒绝）", async () => {
  const dir = fs.mkdtempSync(path.join(TMP, "case-lead-"));
  const reg = writeRegistry(dir); // lead 原本带 model，用来验证「即使有也不生效」
  const { ctx, events, tools } = mockCtx(reg, [{ id: "root", __member: "lead", session: { header: {} } }], {
    leadRole: true,
  });
  PLUGIN.apply(ctx);

  const r = await tools.get("member_set_model").execute({
    target: "lead",
    model: "deepseek-v4-pro-0813",
    provider: "tokenrhythm",
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "ROOT_IDENTITY_NO_OVERRIDE");
  assert.match(r.message, /会话框/);
});

test("lead：清除覆盖仍然允许（用于清掉历史残留）", async () => {
  const dir = fs.mkdtempSync(path.join(TMP, "case-lead-clear-"));
  const reg = writeRegistry(dir);
  const { ctx, tools } = mockCtx(reg, [{ id: "root", __member: "lead", session: { header: {} } }], {
    leadRole: true,
  });
  PLUGIN.apply(ctx);

  const r = await tools.get("member_set_model").execute({ target: "lead", model: "" });
  assert.equal(r.ok, true, "清空不应被拒绝");
  const members = r.data.members;
  const lead = members.find((m) => m.target === "lead");
  assert.equal(lead.model, undefined, "清空后名册里不该再有 model");
});

test("根 agent（顶层会话）：不自动覆盖，模型留给会话框手选", () => {
  const dir = fs.mkdtempSync(path.join(TMP, "case-root-"));
  const reg = writeRegistry(dir);
  const { ctx, events, tools } = mockCtx(reg, []);
  PLUGIN.apply(ctx);

  const selects = [];
  const agentEvents = [];
  const agent = {
    id: "session-root",
    __member: "lead",
    // 没有 delegationDepth / origin：顶层会话
    session: { header: {} },
    ctx: {
      on(evt) {
        agentEvents.push(evt);
        return () => {};
      },
    },
    model: {
      options: { provider: "deepseek-account", model: "deepseek-flash" },
      current: () => ({ provider: "deepseek-account", model: "deepseek-flash" }),
      select(selection) {
        selects.push(selection);
      },
    },
  };

  fire(events, "agent/created", { agent });

  assert.equal(selects.length, 0, "根 agent 不该被自动落模型（会话框里由用户自己选）");
  assert.ok(
    !agentEvents.includes("system-prompt/assemble"),
    "根 agent 也不该装提示词变量钩子：那会让提示词声称它在用名册里的模型",
  );
  assert.ok(tools.get("member_set_model"), "工具仍应注册");
});

test("非名册成员：不碰它的模型选择", () => {
  const dir = fs.mkdtempSync(path.join(TMP, "case-d-"));
  const reg = writeRegistry(dir);
  const { ctx, events } = mockCtx(reg);
  PLUGIN.apply(ctx);

  const selects = [];
  const agent = {
    id: "agent-outsider",
    // 没有 __member：tryMembership 返回 undefined，不是名册成员
    ctx: { on() { return () => {}; } },
    model: {
      options: { provider: "deepseek-account", model: "deepseek-flash" },
      current: () => ({ provider: "deepseek-account", model: "deepseek-flash" }),
      select(selection) {
        selects.push(selection);
      },
    },
  };

  fire(events, "agent/created", { agent });

  assert.equal(selects.length, 0, "非成员不应被改写模型（否则会覆盖用户手选）");
});

test("已等于目标值时不重复 select（agent/status 高频触发下的幂等）", () => {
  const dir = fs.mkdtempSync(path.join(TMP, "case-e-"));
  const reg = writeRegistry(dir);
  const { ctx, events } = mockCtx(reg);
  PLUGIN.apply(ctx);

  const selects = [];
  const agent = {
    id: "agent-idem",
    __member: "lead",
    session: { header: { delegationDepth: 1 } },
    ctx: { on() { return () => {}; } },
    model: {
      options: { provider: "deepseek-account", model: "deepseek-flash" },
      // 已经等于名册值
      current: () => ({ provider: "tokenrhythm", model: "deepseek-v4-pro-0813" }),
      select(selection) {
        selects.push(selection);
      },
    },
  };

  fire(events, "agent/created", { agent });

  assert.equal(selects.length, 0, "selection 已等于目标值就不该再 select 一次");
});

test("没有覆盖、也没被本插件改过：不碰模型选择", () => {
  const dir = fs.mkdtempSync(path.join(TMP, "case-f-"));
  const reg = path.join(dir, "registry.json");
  const now = new Date().toISOString();
  fs.writeFileSync(
    reg,
    JSON.stringify({ version: 1, updatedAt: now, groups: [], members: [
      { target: "lead", displayName: "大总管", aliases: [], groupId: null, title: "", duties: [], skills: [],
        status: "active", retiredAt: null, note: "", createdAt: now, updatedAt: now },
    ] }),
    "utf8",
  );
  const { ctx, events } = mockCtx(reg);
  PLUGIN.apply(ctx);

  const selects = [];
  const agent = {
    id: "agent-manual",
    __member: "lead",
    session: { header: { delegationDepth: 1 } },
    ctx: { on() { return () => {}; } },
    model: {
      options: { provider: "deepseek-account", model: "deepseek-flash" },
      current: () => ({ provider: "tokenrhythm", model: "qwen3.8-max" }), // 用户手选
      select(selection) {
        selects.push(selection);
      },
    },
  };

  fire(events, "agent/created", { agent });

  assert.equal(selects.length, 0, "无覆盖时不得把用户手选的模型改回默认");
});

test("agent/status 不重落模型：输入框里手选的优先", () => {
  const dir = fs.mkdtempSync(path.join(TMP, "case-g-"));
  const reg = writeRegistry(dir);
  const { ctx, events } = mockCtx(reg);
  PLUGIN.apply(ctx);

  const selects = [];
  const agent = {
    id: "agent-status",
    __member: "lead",
    session: { header: { delegationDepth: 1 } },
    ctx: { on() { return () => {}; } },
    model: {
      options: { provider: "deepseek-account", model: "deepseek-flash" },
      current: () => ({ provider: "deepseek-account", model: "deepseek-flash" }),
      select(selection) {
        selects.push(selection);
      },
    },
  };

  fire(events, "agent/created", { agent });
  const afterCreate = selects.length;

  // 用户在输入框里手选了一个别的模型
  agent.model.current = () => ({ provider: "tokenrhythm", model: "qwen3.8-max" });

  // 多轮 status 事件（每轮都会来）
  fire(events, "agent/status", { agent });
  fire(events, "agent/status", { agent });
  fire(events, "agent/status", { agent });

  assert.equal(selects.length, afterCreate, "status 事件不得把手选模型改回去");
});

test("清除覆盖：agent 包装对象变了也能回滚（按 ctx 记账，不按对象）", async () => {
  const dir = fs.mkdtempSync(path.join(TMP, "case-wrap-"));
  const reg = writeRegistry(dir);
  const state = { cur: { provider: "deepseek-account", model: "deepseek-flash" } };
  const picks = [];
  // 同一个 ctx，但每次事件送出不同的 agent 包装对象（宿主真实行为）
  const scopedCtx = { on() { return () => {}; } };
  const makeAgent = (id) => ({
    id,
    __member: "lead",
    session: { header: { delegationDepth: 1 } },
    ctx: scopedCtx,
    model: {
      options: { provider: "deepseek-account", model: "deepseek-flash" },
      current: () => ({ ...state.cur }),
      select(selection) {
        picks.push(selection);
        state.cur = { ...selection };
      },
    },
  });
  const first = makeAgent("agent-wrap-1");
  const second = makeAgent("agent-wrap-2"); // 不同对象、同一 ctx、同一成员

  const { ctx, events, tools } = mockCtx(reg, [first, second]);
  PLUGIN.apply(ctx);

  fire(events, "agent/created", { agent: first });
  assert.equal(picks.length, 1, "首次应落一次覆盖");

  // 用第二个包装对象走清除路径
  const r = await tools.get("member_set_model").execute({ target: "lead", model: "" });
  assert.equal(r.ok, true);
  assert.equal(picks.length, 2, "包装对象不同也必须能回滚（否则清除会静默失效）");
  assert.equal(picks[1].model, "deepseek-flash");
});

test("lead：没有 live agent 时依然拒绝（按根成员名兜底，不 fail-open）", async () => {
  const dir = fs.mkdtempSync(path.join(TMP, "case-lead-nolive-"));
  const reg = writeRegistry(dir);
  // liveAgents 为空、团队名册也拿不到角色：真实重启后/会话未打开时的形态
  const { ctx, tools } = mockCtx(reg, [], {});
  PLUGIN.apply(ctx);

  const r = await tools.get("member_set_model").execute({
    target: "lead",
    model: "deepseek-v4-pro-0813",
    provider: "tokenrhythm",
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "ROOT_IDENTITY_NO_OVERRIDE");
  assert.match(r.message, /lead/);
});

test("覆盖后用户手选了别的模型：清除覆盖不把他改回默认", async () => {
  const dir = fs.mkdtempSync(path.join(TMP, "case-manual-"));
  const reg = writeRegistry(dir);
  const state = { cur: { provider: "deepseek-account", model: "deepseek-flash" } };
  const picks = [];
  const agent = subagent("agent-manual-2", {
    options: { provider: "deepseek-account", model: "deepseek-flash" },
    current: () => ({ ...state.cur }),
    select(sel) {
      picks.push(sel);
      state.cur = { ...sel };
    },
  });
  const { ctx, events, tools } = mockCtx(reg, [agent]);
  PLUGIN.apply(ctx);

  fire(events, "agent/created", { agent });
  assert.equal(picks.length, 1, "首次落覆盖");

  // 用户在会话框里手选了另一个模型
  state.cur = { provider: "tokenrhythm", model: "qwen3.8-max" };

  const r = await tools.get("member_set_model").execute({ target: "lead", model: "" });
  assert.equal(r.ok, true);
  assert.equal(picks.length, 1, "当前 selection 已不是插件设的值，就不该再 select 回默认");
  assert.equal(state.cur.model, "qwen3.8-max", "用户手选必须保留");
  assert.equal(r.selectionApplied, "kept-user-choice");
});

test("安装时 selection 已等于名册值：记账成立，随后清除能回滚", async () => {
  const dir = fs.mkdtempSync(path.join(TMP, "case-same-then-clear-"));
  const reg = writeRegistry(dir);
  // 续接/重载：session 投影里已经是名册值
  const state = { cur: { provider: "tokenrhythm", model: "deepseek-v4-pro-0813" } };
  const picks = [];
  const agent = subagent("agent-same-2", {
    options: { provider: "deepseek-account", model: "deepseek-flash" },
    current: () => ({ ...state.cur }),
    select(sel) {
      picks.push(sel);
      state.cur = { ...sel };
    },
  });
  const { ctx, events, tools } = mockCtx(reg, [agent]);
  PLUGIN.apply(ctx);

  fire(events, "agent/created", { agent });
  assert.equal(picks.length, 0, "已经等于名册值，不该再 select");

  const r = await tools.get("member_set_model").execute({ target: "lead", model: "" });
  assert.equal(picks.length, 1, "清除时应该能回滚（安装时已记账）");
  assert.equal(picks[0].model, "deepseek-flash");
});

test("名册没写 effort 时不丢掉当前 effort（不悄悄降级）", async () => {
  const dir = fs.mkdtempSync(path.join(TMP, "case-effort-"));
  const reg = writeRegistry(dir);
  const state = { cur: { provider: "deepseek-account", model: "deepseek-flash", reasoningEffort: "high" } };
  const picks = [];
  const agent = subagent("agent-effort", {
    options: { provider: "deepseek-account", model: "deepseek-flash" },
    current: () => ({ ...state.cur }),
    select(sel) {
      picks.push(sel);
      state.cur = { ...sel };
    },
  });
  const { ctx, events } = mockCtx(reg, [agent]);
  PLUGIN.apply(ctx);

  fire(events, "agent/created", { agent });
  assert.equal(picks.length, 1);
  assert.equal(picks[0].model, "deepseek-v4-pro-0813");
  assert.equal(picks[0].reasoningEffort, "high", "名册未指定 effort 时沿用当前档位");
});

test("0.2.1：新实例只经 agent/status 报到，也要装上 agent/request 钩子", () => {
  const dir = fs.mkdtempSync(path.join(TMP, "case-legacy-status-"));
  const reg = writeRegistry(dir);
  const { ctx, events } = mockCtx(reg, []);
  PLUGIN.apply(ctx);

  const firstCtx = { on() { return () => {}; } };
  const first = { id: "legacy-1", __member: "lead", session: { header: { delegationDepth: 1 } }, ctx: firstCtx };
  fire(events, "agent/created", { agent: first });

  // 续接成员换了实例、换了 ctx，只经 status 报到（新实例没有 model 字段 = 0.2.1 形态）
  const secondEvents = [];
  const second = {
    id: "legacy-2",
    __member: "lead",
    session: { header: { delegationDepth: 1 } },
    ctx: { on(evt) { secondEvents.push(evt); return () => {}; } },
  };
  fire(events, "agent/status", { agent: second });

  assert.ok(secondEvents.includes("agent/request"), "status 报到也要装 0.2.1 的改写钩子");
  assert.ok(secondEvents.includes("system-prompt/assemble"), "提示词钩子同样要装");
});

test("面板 setModel 也会落 selection（不只是写名册）", async () => {
  const dir = fs.mkdtempSync(path.join(TMP, "case-panel-"));
  const reg = writeRegistry(dir);
  const state = { cur: { provider: "deepseek-account", model: "deepseek-flash" } };
  const picks = [];
  const agent = subagent("agent-panel", {
    options: { provider: "deepseek-account", model: "deepseek-flash" },
    current: () => ({ ...state.cur }),
    select(sel) {
      picks.push(sel);
      state.cur = { ...sel };
    },
  });
  const { ctx, routes } = mockCtx(reg, [agent]);
  PLUGIN.apply(ctx);

  const op = routes.get("/api/dsh-member-manager/op");
  assert.ok(op, "面板 /op 路由应已注册");
  const res = fakeRes();
  await op(
    fakeReq(JSON.stringify({ op: "setModel", args: { target: "lead", model: "deepseek-v4-pro-0813", provider: "tokenrhythm" } })),
    res,
  );
  assert.equal(res.status, 400, "根身份应被拒绝");
  const body = JSON.parse(res.body);
  assert.equal(body.code, "ROOT_IDENTITY_NO_OVERRIDE");
});

test("清除覆盖后回到 agent 自己的默认路由（经 member_set_model 显式触发）", async () => {
  const dir = fs.mkdtempSync(path.join(TMP, "case-c-"));
  const reg = writeRegistry(dir); // lead 有 model=deepseek-v4-pro-0813 / provider=tokenrhythm
  const state = { cur: { provider: "deepseek-account", model: "deepseek-flash" } };
  const picks = [];
  const agent = {
    id: "agent-clear",
    __member: "lead",
    session: { header: { delegationDepth: 1 } },
    ctx: { on() { return () => {}; } },
    model: {
      options: { provider: "deepseek-account", model: "deepseek-flash", reasoningEffort: "max" },
      current: () => ({ ...state.cur }),
      select(selection) {
        picks.push(selection);
        state.cur = { ...selection };
      },
    },
  };

  const { ctx, events, tools } = mockCtx(reg, [agent]);
  PLUGIN.apply(ctx);

  // 第一次：把名册值落上去
  fire(events, "agent/created", { agent });
  assert.equal(picks.length, 1);
  assert.equal(picks[0].model, "deepseek-v4-pro-0813");
  assert.equal(state.cur.model, "deepseek-v4-pro-0813");

  // 通过真实工具清空覆盖：显式路径会强制回滚
  const tool = tools.get("member_set_model");
  const result = await tool.execute({ target: "lead", model: "" });
  assert.ok(result.ok, "member_set_model 应成功");
  assert.equal(picks.length, 2, "清空覆盖后应再落一次 selection");
  assert.equal(picks[1].provider, "deepseek-account");
  assert.equal(picks[1].model, "deepseek-flash");
  assert.equal(picks[1].reasoningEffort, "max");
});

/** 造一个子 agent（默认 delegationDepth=1） */
function subagent(id, modelImpl) {
  return {
    id,
    __member: "lead",
    session: { header: { delegationDepth: 1, origin: "subagent" } },
    ctx: { on() { return () => {}; } },
    model: modelImpl,
  };
}

function fakeReq(body) {
  const listeners = {};
  const req = {
    method: "POST",
    on(evt, fn) {
      listeners[evt] = fn;
      return req;
    },
  };
  setImmediate(() => {
    if (listeners.data) listeners.data(Buffer.from(body, "utf8"));
    if (listeners.end) listeners.end();
  });
  return req;
}

function fakeRes() {
  const res = {
    status: 200,
    headers: {},
    body: "",
    headersSent: false,
    writeHead(status, headers) {
      res.status = status;
      res.headers = headers || {};
      res.headersSent = true;
    },
    end(chunk) {
      if (chunk !== undefined) res.body += chunk;
      res.headersSent = true;
    },
  };
  return res;
}
