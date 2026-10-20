/**
 * company-runtime.mjs
 * 公司运行时统一入口：组装 compat / employees / dispatcher / scheduler，注册工具与路由。
 */

import { detectCap, isFakeMode, normalizeUsage, buildUserMessage, SOURCE_KIND, makeIdleMessage, buildFakeServices, TOOL_LINES, LINE_TOOLS, safeCtxGet, safeCtxProp, resolveDefaultLlmOptions } from "./company-compat.mjs";
import { createEmployeeSessionManager } from "./company-employees.mjs";
import { createDispatcher } from "./company-dispatcher.mjs";
import { createScheduler } from "./company-scheduler.mjs";
import { CompanyStore } from "../shared/company-store.mjs";
import { resolveCompanyConfig } from "../shared/company-config.mjs";
import { emptyCompany, createDepartment, createEmployee, updateDepartment, updateEmployee, promoteEmployee, fireEmployee, ensureCompanyCodes, describeEmployeeLevel, describeEmployeeChannels, setEmployeeChannels, primaryChannelOf, EMPLOYEE_ROLE, EMPLOYEE_STATE, EMPLOYEE_KIND, SESSION_POLICY, DEFAULT_LEVELS, DEFAULT_NUMBERING } from "../shared/company-org.mjs";
import { emptyLedger, transitionOrder, ORDER_STATES } from "../shared/company-ledger.mjs";
import path from "node:path";
import { readFile } from "node:fs/promises";
import crypto from "node:crypto";

export const TOOL_NAMES = [
  "company_order", "company_status", "company_ask", "company_cancel",
  "company_assign", "company_review", "company_borrow", "company_report", "company_escalate",
  "company_accept", "company_ask_help",
  "company_hire", "company_admin",
];

export function createCompanyRuntime(ctx, { dataDir, config: rawConfig = {}, logger = console }) {
  const warnings = [];
  const fake = isFakeMode({ fake: rawConfig.fake });
  const { config } = resolveCompanyConfig(rawConfig);
  const workspaceDir = path.resolve(dataDir || process.env.DSH_DATA_DIR || ".", "workspace");
  const store = new CompanyStore(dataDir, { now: () => new Date().toISOString() });

  let fakeServices = null;
  // fake 模式注入 fake agents/subagents/provider，同时保留原 ctx 的其它能力
  if (fake) {
    const originalCtx = ctx;
    const originalGet = (name) => safeCtxGet(originalCtx, name);
    fakeServices = buildFakeServices({ runtime: null });
    ctx = {
      ...originalCtx,
      get(name) {
        if (name === "agents" && !originalGet("agents")) return fakeServices.agents;
        if (name === "subagents" && !originalGet("subagents")) return fakeServices.subagents;
        if (name === "llm" && !originalGet("llm")) return fakeServices.provider;
        return originalGet(name);
      },
    };
  }

  const caps = detectCap(ctx);
  const runtime = {
    ctx,
    config,
    fake,
    caps,
    dataDir,
    workspaceDir,
    sessionTools: new Map(),
    sessionAborts: new Map(),
    company: emptyCompany(),
    ledger: emptyLedger(),
    ownerAgent: null,
    ownerHandle: null,
    ownerSessionId: null,
    // 宿主已注册的 provider 名是 "spawn"/"fork" 等；"default" 会抛 NO_PROVIDER。
    provider: rawConfig.provider || config.provider || "spawn",
    shuttingDown: false,
    costs: { tokens: 0, requests: 0, byEmployee: {}, byDepartment: {}, byOrder: {} },
  };
  if (fake && fakeServices) {
    fakeServices.runtime = runtime;
    runtime.fakeServices = fakeServices;
  }
  const employeeManager = createEmployeeSessionManager({ runtime, logger });
  const dispatcher = createDispatcher({ runtime, store, employeeManager, logger });
  runtime.dispatcher = dispatcher;
  const scheduler = createScheduler({ runtime, dispatcher, logger, intervalMs: config.limits.staleAttemptMs });

  async function followupManagersAndOwner(text) {
    const owner = runtime.ownerAgent;
    if (owner && typeof owner.followup === "function") {
      try { await owner.followup({ role: "user", content: text, source: { kind: SOURCE_KIND, signal: "escalation" } }); } catch {}
    }
    for (const s of employeeManager.sessions.values()) {
      if (s.endedAt) continue;
      const emp = runtime.company.employees.find((e) => e.id === s.employeeId);
      if (emp && emp.role === EMPLOYEE_ROLE.MANAGER && s.handle && typeof s.handle.followup === "function") {
        try { await s.handle.followup({ role: "user", content: text, source: { kind: SOURCE_KIND, signal: "escalation" } }); } catch {}
      }
    }
  }

  let booted = false;
  let bootWarnings = [];
  let bootAttempts = 0;
  let bootRetryTimer = null;
  const BOOT_RETRY_DELAYS = [30000, 60000, 120000];

  const toolDescriptions = {
    company_order: "提交一条新的公司工单，触发后续路由、派单、执行与验收流程。",
    company_status: "查询公司组织结构、工单看板、成本统计与订单列表的当前状态。",
    company_ask: "针对某个工单向责任员工或经理发起追问，要求补充信息或澄清需求。",
    company_cancel: "取消一个尚未完成的公司工单，释放相关员工与资源。",
    company_assign: "经理将已路由的工单指派给具体员工，创建 attempt 并唤醒员工执行。",
    company_review: "经理对已完成回报的工单进行复核，决定验收通过或打回重试。",
    company_borrow: "从共享员工池中临时借调一名员工到目标部门处理指定工单。",
    company_report: "员工向公司运行时回报 attempt 执行结果、产物与验收数据。",
    company_escalate: "当员工遇到阻塞或异常时，将工单升级到经理或更高层处理。",
    company_accept: "员工收到派单后确认接单，表示开始执行该 attempt。",
    company_ask_help: "员工在执行 attempt 遇到问题时向经理或其它员工求助。",
    company_hire: "向公司组织架构中新增一名员工（支持经理、员工、共享、临时工等角色）。",
    company_admin: "执行公司管理操作，如调整部门、配置策略、批量清理等。",
  };

  function mkTool(name, parameters, execute) {
    return {
      name,
      description: toolDescriptions[name] || `公司运行时工具 ${name}`,
      parameters: { ...parameters, additionalProperties: false },
      execute: wrapExecute(execute),
    };
  }

  function defineTools() {
    return [
      mkTool("company_order", {
        type: "object",
        properties: {
          project: { type: "string" },
          type: { type: "string" },
          title: { type: "string" },
          detail: { type: "string" },
          priority: { type: "string" },
          dept: { type: "string" },
          deps: { type: "array", items: { type: "string" } },
          acceptance: { type: "string" },
          mode: { type: "string" },
          timeoutMs: { type: "number" },
          clientOrderId: { type: "string" },
        },
        required: ["type", "title"],
      }, company_order),
      mkTool("company_status", { type: "object", properties: { orderId: { type: "string" } } }, company_status),
      mkTool("company_ask", { type: "object", properties: { orderId: { type: "string" }, question: { type: "string" } }, required: ["orderId", "question"] }, company_ask),
      mkTool("company_cancel", { type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"] }, company_cancel),
      mkTool("company_assign", { type: "object", properties: { orderId: { type: "string" }, employeeId: { type: "string" } }, required: ["orderId", "employeeId"] }, company_assign),
      mkTool("company_review", { type: "object", properties: { orderId: { type: "string" }, pass: { type: "boolean" } }, required: ["orderId", "pass"] }, company_review),
      mkTool("company_borrow", { type: "object", properties: { orderId: { type: "string" }, sharedEmployeeId: { type: "string" } }, required: ["orderId", "sharedEmployeeId"] }, company_borrow),
      mkTool("company_report", {
        type: "object",
        properties: {
          attemptId: { type: "string" },
          orderId: { type: "string" },
          status: { type: "string" },
          summary: { type: "string" },
          artifacts: { type: "array" },
          acceptanceResults: { type: "array" },
        },
        required: ["attemptId", "status"],
      }, company_report),
      mkTool("company_escalate", { type: "object", properties: { orderId: { type: "string" }, reason: { type: "string" } }, required: ["orderId"] }, company_escalate),
      mkTool("company_accept", { type: "object", properties: { attemptId: { type: "string" } }, required: ["attemptId"] }, company_accept),
      mkTool("company_ask_help", { type: "object", properties: { attemptId: { type: "string" }, question: { type: "string" } }, required: ["attemptId"] }, company_ask_help),
      mkTool("company_hire", {
        type: "object",
        properties: {
          id: { type: "string" },
          displayName: { type: "string" },
          department: { type: "string" },
          role: { type: "string" },
          kind: { type: "string" },
          code: { type: "string", description: "员工编号，可选" },
          channel: { type: "string", enum: ["M", "P"], description: "通道：M 管理/P 专业（旧字段，与 channels 互斥）" },
          level: { type: "string", description: "等级 code，如 M2/P4（旧字段，与 channels 互斥）" },
          channels: { type: "array", items: { type: "object", properties: { channel: { type: "string", enum: ["M", "P"] }, level: { type: "string" } }, required: ["channel", "level"], additionalProperties: false }, description: "双通道配置，优先于旧 channel/level" },
        },
        required: ["id"],
      }, company_hire),
      mkTool("company_admin", {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["createDepartment", "createEmployee", "setRoutingRules", "updateDepartment", "promoteEmployee", "setNumbering", "setChannels"],
            description: "管理动作",
          },
          args: { type: "object" },
        },
        required: ["action"],
      }, company_admin),
    ];
  }

  function hasAgentsNow() {
    return Boolean(safeCtxGet(runtime.ctx, "agents")) && Boolean(safeCtxGet(runtime.ctx, "subagents"));
  }

  function wrapExecute(fn) {
    return async (args, exec = {}) => {
      try {
        // B8: 动态探测能力
        if (!hasAgentsNow()) {
          return { ok: false, code: "E_NO_AGENTS" };
        }
        // 第三道防线：通过 exec.agent.session.id 反查允许的工具集合
        const sid = exec?.agent?.session?.id;
        if (sid && runtime.sessionTools.has(sid)) {
          const allowed = runtime.sessionTools.get(sid);
          const name = exec?.tool?.name || exec?.name;
          if (name && !allowed.has(name)) {
            return { ok: false, code: "E_TOOL_LINE", message: "该工具不在当前岗位白名单中" };
          }
        }
        // 宿主工具签名是 execute(args, executionContext)；公司工具的处理函数按
        // { exec } 解构使用执行上下文（真实宿主没有 ctx.exec 这一层）。这里做一次
        // 形状归一，避免 sid/agent 取不到导致身份校验永远失败。
        return await fn(args, { exec });
      } catch (err) {
        logger.warn(`company tool error: ${err.message}`);
        return { ok: false, code: err.code || "E_INTERNAL", message: err.message };
      }
    };
  }

  async function company_order(args, { exec }) {
    return await dispatcher.placeOrder(args);
  }

  async function company_status(args) {
    return { ok: true, view: view() };
  }

  async function company_ask(args) {
    return { ok: true };
  }

  async function company_cancel(args) {
    return await dispatcher.cancelOrder(args.orderId);
  }

  async function company_assign(args) {
    const order = runtime.ledger.orders.find((o) => o.id === args.orderId);
    if (order && order.state !== "routed" && order.state !== "running") {
      const routed = await dispatcher.routeOrder(args.orderId);
      if (!routed.ok) return routed;
    }
    return await dispatcher.assignAndWake(args.orderId, args.employeeId);
  }

  async function company_review(args) {
    return await dispatcher.review(args);
  }

  async function company_borrow(args) {
    const res = await dispatcher.borrow(args.orderId, args.sharedEmployeeId);
    if (!res.ok) return res;
    await followupManagersAndOwner(`已借调员工 ${args.sharedEmployeeId} 处理订单 ${args.orderId}，attempt ${res.attemptId}`);
    return res;
  }

  async function company_report(args, { exec }) {
    // 身份校验：exec.agent.session.id 必须和 activeAttempts 中登记的 sessionId 一致
    const sid = exec?.agent?.session?.id;
    if (!sid) return { ok: false, code: "E_STALE_ATTEMPT" };
    const meta = Array.from(dispatcher.activeAttempts.values()).find((m) => m.sessionId === sid);
    if (!meta) return { ok: false, code: "E_STALE_ATTEMPT" };
    if (args.attemptId && args.attemptId !== meta.attemptId) return { ok: false, code: "E_STALE_ATTEMPT" };
    return await dispatcher.report({ ...args, attemptId: meta.attemptId });
  }

  async function company_escalate(args) {
    const res = await dispatcher.escalate(args.orderId, args.reason);
    if (!res.ok) return res;
    await followupManagersAndOwner(`订单 ${args.orderId} 已升级：${args.reason || ""}`);
    return res;
  }

  async function company_accept(args) {
    return { ok: true };
  }

  async function company_ask_help(args, { exec }) {
    const sid = exec?.agent?.session?.id;
    if (!sid) return { ok: false, code: "E_STALE_ATTEMPT" };
    const meta = dispatcher.findAttemptMetaBySessionId(sid);
    if (!meta) return { ok: false, code: "E_STALE_ATTEMPT" };
    const res = await dispatcher.askHelp(meta.attemptId, args.question, sid);
    if (!res.ok) return res;
    await followupManagersAndOwner(`员工在 attempt ${res.attemptId} 求助：${args.question || ""}`);
    return { ok: true, forwardedTo: res.forwardedTo };
  }

  function assertDepartmentExists(departmentId) {
    if (departmentId && !runtime.company.departments.find((d) => d.id === departmentId)) {
      throw Object.assign(new Error(`部门不存在: ${departmentId}`), { code: "E_NOT_FOUND" });
    }
  }

  async function company_hire(args) {
    return store.withLock(async () => {
      try {
        const loaded = await store.load();
        runtime.company = loaded.company || runtime.company;
        runtime.ledger = loaded.ledger || runtime.ledger;
        assertDepartmentExists(args.department);
        runtime.company = createEmployee(runtime.company, {
          id: args.id,
          displayName: args.displayName,
          department: args.department,
          role: args.role || "staff",
          kind: args.kind || "permanent",
          code: args.code,
          channels: Array.isArray(args.channels) ? args.channels : undefined,
          channel: args.channel,
          level: args.level,
        });
        await store.saveCompany(runtime.company);
        await store.appendAudit({ type: "employee_hired", employeeId: args.id });
        const emp = runtime.company.employees.find((e) => e.id === args.id);
        const levelInfo = describeEmployeeLevel(emp, runtime.config.levels);
        return { ok: true, employeeId: args.id, code: emp.code, channel: levelInfo.channel, level: levelInfo.level, levelName: levelInfo.levelName, channels: emp.channels };
      } catch (err) {
        return { ok: false, code: err.code || "E_INVALID_INPUT", message: err.message };
      }
    });
  }

  async function company_admin(args) {
    return store.withLock(async () => {
      try {
        switch (args.action) {
          case "createDepartment": {
            runtime.company = createDepartment(runtime.company, { id: args.args.id, name: args.args.name, code: args.args.code });
            await store.saveCompany(runtime.company);
            await store.appendAudit({ type: "department_created", departmentId: args.args.id });
            const newDept = runtime.company.departments.find((d) => d.id === args.args.id);
            return { ok: true, departmentId: args.args.id, code: newDept?.code };
          }
          case "updateDepartment": {
            runtime.company = updateDepartment(runtime.company, args.args.id, {
              name: args.args.name,
              code: args.args.code,
              accepts: args.args.accepts,
              capacity: args.args.capacity,
              charter: args.args.charter,
            });
            await store.saveCompany(runtime.company);
            await store.appendAudit({ type: "department_updated", departmentId: args.args.id });
            const updatedDept = runtime.company.departments.find((d) => d.id === args.args.id);
            return { ok: true, departmentId: args.args.id, code: updatedDept?.code };
          }
          case "createEmployee": {
            assertDepartmentExists(args.args.department);
            runtime.company = createEmployee(runtime.company, {
              id: args.args.id,
              displayName: args.args.displayName,
              department: args.args.department,
              role: args.args.role,
              kind: args.args.kind,
              skills: args.args.skills,
              code: args.args.code,
              channels: Array.isArray(args.args.channels) ? args.args.channels : undefined,
              channel: args.args.channel,
              level: args.args.level,
            });
            await store.saveCompany(runtime.company);
            await store.appendAudit({ type: "employee_created", employeeId: args.args.id });
            const createdEmp = runtime.company.employees.find((e) => e.id === args.args.id);
            const createdLevelInfo = describeEmployeeLevel(createdEmp, runtime.config.levels);
            return { ok: true, employeeId: args.args.id, code: createdEmp.code, channel: createdLevelInfo.channel, level: createdLevelInfo.level, levelName: createdLevelInfo.levelName, channels: createdEmp.channels };
          }
          case "setRoutingRules": {
            runtime.config.routingRules = args.args.rules || [];
            runtime.company = { ...runtime.company, routingRules: runtime.config.routingRules };
            await store.saveCompany(runtime.company);
            await store.appendAudit({ type: "routing_rules_set", count: (args.args.rules || []).length });
            break;
          }
          case "setChannels": {
            const result = setEmployeeChannels(runtime.company, args.args.employeeId, args.args.channels, { levels: runtime.config.levels });
            runtime.company = result.company;
            await store.saveCompany(runtime.company);
            await store.appendAudit({ type: "employee_channels_set", employeeId: args.args.employeeId, channels: result.to.channels });
            return { ok: true, employeeId: args.args.employeeId, channels: result.to.channels, channel: result.to.channel, level: result.to.level };
          }
          case "promoteEmployee": {
            const result = promoteEmployee(runtime.company, args.args.employeeId, { level: args.args.level, channel: args.args.channel, addChannel: args.args.addChannel, removeChannel: args.args.removeChannel }, { levels: runtime.config.levels });
            runtime.company = result.company;
            await store.saveCompany(runtime.company);
            await store.appendAudit({ type: "employee_promoted", employeeId: args.args.employeeId, from: result.from, to: result.to });
            return { ok: true, from: result.from, to: result.to };
          }
          case "setNumbering": {
            const numbering = validateNumberingArgs(args.args, runtime.config.numbering);
            runtime.config.numbering = numbering;
            runtime.company = { ...runtime.company, numbering };
            await store.saveCompany(runtime.company);
            await store.appendAudit({ type: "numbering_set", numbering });
            break;
          }
          default:
            return { ok: false, code: "E_UNKNOWN_ACTION" };
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, code: err.code || "E_INTERNAL", message: err.message };
      }
    });
  }

  function validateNumberingArgs(args, fallback = DEFAULT_NUMBERING) {
    const numbering = JSON.parse(JSON.stringify(fallback));
    if (!args || typeof args !== "object") return numbering;
    const allowed = new Set(["seq", "seq:1", "seq:2", "seq:3", "seq:4", "seq:5", "seq:6", "seq:7", "seq:8", "dept", "channel", "level"]);
    for (const key of ["employee", "department"]) {
      const entry = args[key] || args[`${key}Pattern`] || args[`${key}Start`] !== undefined ? {} : undefined;
      if (!entry) continue;
      const pattern = args[key]?.pattern ?? args[`${key}Pattern`];
      const start = args[key]?.start ?? args[`${key}Start`];
      if (typeof pattern === "string") {
        if (!pattern.includes("{seq") && !pattern.includes("{seq:")) {
          throw Object.assign(new Error("编号模板必须包含 {seq} 或 {seq:N}"), { code: "E_INVALID_NUMBERING" });
        }
        const found = pattern.match(/\{([^}]*)\}/g) || [];
        for (const ph of found) {
          const name = ph.slice(1, -1);
          if (!allowed.has(name)) {
            throw Object.assign(new Error(`编号模板含非法占位符 ${name}`), { code: "E_INVALID_NUMBERING" });
          }
        }
        numbering[key].pattern = pattern;
      }
      if (typeof start === "number" && Number.isInteger(start) && start > 0) {
        numbering[key].start = start;
      }
    }
    return numbering;
  }

  function makeOpId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  async function withCompanyRefresh(fn) {
    return store.withLock(async () => {
      const loaded = await store.load();
      runtime.company = loaded.company || runtime.company;
      return fn();
    });
  }

  async function handleCompanyOp(req, url, body) {
    if (!body || typeof body !== "object") {
      return { ok: false, code: "E_INVALID_INPUT", message: "请求体必须是 JSON 对象" };
    }
    const { action, args = {} } = body;
    try {
      switch (action) {
        case "createDepartment": {
          if (!args.name || typeof args.name !== "string" || args.name.trim() === "") {
            return { ok: false, code: "E_INVALID_INPUT", message: "name 必填" };
          }
          return await withCompanyRefresh(async () => {
            const id = args.id || makeOpId("dept");
            runtime.company = createDepartment(runtime.company, {
              id,
              name: args.name,
              code: args.code,
              charter: args.charter,
              capacity: args.capacity,
              accepts: args.accepts,
            });
            await store.saveCompany(runtime.company);
            const dept = runtime.company.departments.find((d) => d.id === id);
            await store.appendAudit({ type: "department_created", departmentId: id, code: dept?.code });
            return { ok: true, departmentId: id, code: dept?.code };
          });
        }
        case "updateDepartment": {
          const departmentId = args.departmentId || args.id;
          if (!departmentId) {
            return { ok: false, code: "E_INVALID_INPUT", message: "departmentId 必填" };
          }
          return await withCompanyRefresh(async () => {
            runtime.company = updateDepartment(runtime.company, departmentId, {
              name: args.name,
              code: args.code,
              charter: args.charter,
              capacity: args.capacity,
              accepts: args.accepts,
            });
            await store.saveCompany(runtime.company);
            const dept = runtime.company.departments.find((d) => d.id === departmentId);
            await store.appendAudit({ type: "department_updated", departmentId, code: dept?.code });
            return { ok: true, departmentId, code: dept?.code };
          });
        }
        case "createEmployee": {
          if (!args.displayName || typeof args.displayName !== "string" || args.displayName.trim() === "") {
            return { ok: false, code: "E_INVALID_INPUT", message: "displayName 必填" };
          }
          return await withCompanyRefresh(async () => {
            assertDepartmentExists(args.department);
            const id = args.id || makeOpId("emp");
            runtime.company = createEmployee(runtime.company, {
              id,
              displayName: args.displayName,
              department: args.department,
              role: args.role,
              kind: args.kind,
              skills: args.skills,
              code: args.code,
              channels: Array.isArray(args.channels) ? args.channels : undefined,
              channel: args.channel,
              level: args.level,
            });
            await store.saveCompany(runtime.company);
            const emp = runtime.company.employees.find((e) => e.id === id);
            const levelInfo = describeEmployeeLevel(emp, runtime.config.levels);
            await store.appendAudit({ type: "employee_hired", employeeId: id, code: emp?.code });
            return { ok: true, employeeId: id, code: emp?.code, channel: levelInfo.channel, level: levelInfo.level, levelName: levelInfo.levelName };
          });
        }
        case "promoteEmployee": {
          const employeeId = args.employeeId;
          if (!employeeId) {
            return { ok: false, code: "E_INVALID_INPUT", message: "employeeId 必填" };
          }
          return await withCompanyRefresh(async () => {
            const result = promoteEmployee(runtime.company, employeeId, { level: args.level, channel: args.channel, addChannel: args.addChannel, removeChannel: args.removeChannel }, { levels: runtime.config.levels });
            runtime.company = result.company;
            await store.saveCompany(runtime.company);
            await store.appendAudit({ type: "employee_promoted", employeeId, from: result.from, to: result.to });
            return { ok: true, from: result.from, to: result.to };
          });
        }
        case "setChannels": {
          const employeeId = args.employeeId;
          if (!employeeId) {
            return { ok: false, code: "E_INVALID_INPUT", message: "employeeId 必填" };
          }
          return await withCompanyRefresh(async () => {
            const res = setEmployeeChannels(runtime.company, employeeId, args.channels, { levels: runtime.config.levels });
            runtime.company = res.company;
            await store.saveCompany(runtime.company);
            await store.appendAudit({ type: "employee_channels_set", employeeId, channels: res.to.channels });
            return { ok: true, employeeId, channels: res.to.channels, channel: res.to.channel, level: res.to.level };
          });
        }
        case "fireEmployee": {
          const employeeId = args.employeeId;
          if (!employeeId) {
            return { ok: false, code: "E_INVALID_INPUT", message: "employeeId 必填" };
          }
          return await withCompanyRefresh(async () => {
            const target = runtime.company.employees.find((e) => e.id === employeeId);
            if (!target) {
              return { ok: false, code: "E_NOT_FOUND", message: `员工 ${employeeId} 不存在` };
            }
            runtime.company = fireEmployee(runtime.company, employeeId);
            await store.saveCompany(runtime.company);
            await store.appendAudit({ type: "employee_fired", employeeId });
            return { ok: true, employeeId, state: EMPLOYEE_STATE.FIRED };
          });
        }
        case "moveEmployee": {
          const employeeId = args.employeeId;
          const department = args.department;
          if (!employeeId) {
            return { ok: false, code: "E_INVALID_INPUT", message: "employeeId 必填" };
          }
          if (department === undefined) {
            return { ok: false, code: "E_INVALID_INPUT", message: "department 必填" };
          }
          return await withCompanyRefresh(async () => {
            const emp = runtime.company.employees.find((e) => e.id === employeeId);
            if (!emp) {
              throw Object.assign(new Error(`员工 ${employeeId} 不存在`), { code: "E_NOT_FOUND" });
            }
            if (department === "") {
              if (emp.kind !== EMPLOYEE_KIND.SHARED) {
                return { ok: false, code: "E_INVALID_INPUT", message: "仅 shared 类型允许清空部门" };
              }
              runtime.company = updateEmployee(runtime.company, employeeId, { department: "" });
            } else {
              const dept = runtime.company.departments.find((d) => d.id === department);
              if (!dept) {
                return { ok: false, code: "E_NOT_FOUND", message: `部门 ${department} 不存在` };
              }
              if (emp.kind !== EMPLOYEE_KIND.SHARED) {
                // permanent/temp/manager 目标部门必须非空（已由 department 非空保证）
              }
              runtime.company = updateEmployee(runtime.company, employeeId, { department });
            }
            await store.saveCompany(runtime.company);
            await store.appendAudit({ type: "employee_moved", employeeId, department });
            return { ok: true, employeeId, department };
          });
        }
        case "syncRoster": {
          let registry;
          try {
            const raw = await readFile(path.join(dataDir, "registry.json"), "utf8");
            registry = JSON.parse(raw);
          } catch (err) {
            if (err.name === "SyntaxError") {
              return { ok: false, code: "E_NO_REGISTRY", message: "registry.json 解析失败" };
            }
            return { ok: false, code: "E_NO_REGISTRY", message: `registry.json 读取失败: ${err.message}` };
          }
          const dryRun = Boolean(args.dryRun);
          return await store.withLock(async () => {
            const loaded = await store.load();
            runtime.company = loaded.company || runtime.company;
                let workingCompany = runtime.company;
            const wouldCreateDepartments = [];
            const wouldCreateEmployees = [];
            const wouldUpdateEmployees = [];
            for (const group of registry.groups || []) {
              let dept = workingCompany.departments.find((d) => d.name === group.name);
              if (!dept) {
                const deptId = makeOpId("dept");
                const capacity = Math.max(4, (group.members || []).length);
                workingCompany = createDepartment(workingCompany, { id: deptId, name: group.name, charter: group.description || "", capacity });
                dept = workingCompany.departments.find((d) => d.id === deptId);
                wouldCreateDepartments.push({ id: dept.id, code: dept.code, name: dept.name });
              }
              for (const member of group.members || []) {
                if (member.status !== "active") continue;
                const existing = workingCompany.employees.find((e) => e.id === member.target);
                if (existing) {
                  const needsUpdate = existing.displayName !== member.displayName || existing.department !== dept.id;
                  if (needsUpdate) {
                    workingCompany = {
                      ...workingCompany,
                      employees: workingCompany.employees.map((e) =>
                        e.id === existing.id ? { ...e, displayName: member.displayName, department: dept.id } : e,
                      ),
                    };
                    wouldUpdateEmployees.push({ id: existing.id, department: dept.id });
                  }
                } else {
                  const id = member.target;
                  workingCompany = createEmployee(workingCompany, {
                    id,
                    displayName: member.displayName,
                    department: dept.id,
                    role: "staff",
                    kind: "permanent",
                    skills: member.skills,
                  });
                  const emp = workingCompany.employees.find((e) => e.id === id);
                  wouldCreateEmployees.push({ id: emp.id, code: emp.code, department: dept.id });
                }
              }
            }
            if (dryRun) {
              return { ok: true, dryRun: true, wouldCreateDepartments, wouldCreateEmployees, wouldUpdateEmployees };
            }
            runtime.company = workingCompany;
            await store.saveCompany(runtime.company);
            await store.appendAudit({ type: "roster.synced", counts: { departments: wouldCreateDepartments.length, employees: wouldCreateEmployees.length, updated: wouldUpdateEmployees.length } });
            return {
              ok: true,
              dryRun: false,
              createdDepartments: wouldCreateDepartments.map((d) => d.code),
              createdEmployees: wouldCreateEmployees.map((e) => e.code),
              updatedEmployees: wouldUpdateEmployees.map((e) => e.id),
              departments: runtime.company.departments.length,
              employees: runtime.company.employees.length,
            };
          });
        }
        case "deleteDepartment": {
          const departmentId = args.departmentId;
          if (!departmentId) {
            return { ok: false, code: "E_INVALID_INPUT", message: "departmentId 必填" };
          }
          return await withCompanyRefresh(async () => {
            const dept = runtime.company.departments.find((d) => d.id === departmentId);
            if (!dept) {
              return { ok: false, code: "E_NOT_FOUND", message: `部门 ${departmentId} 不存在` };
            }
            const active = runtime.company.employees.filter((e) => e.department === departmentId && e.state !== EMPLOYEE_STATE.FIRED);
            if (active.length > 0) {
              return { ok: false, code: "E_DEPT_NOT_EMPTY", message: "部门仍有在职员工，请先停用或调岗" };
            }
            runtime.company = {
              ...runtime.company,
              employees: runtime.company.employees.map((e) =>
                e.department === departmentId && e.state === EMPLOYEE_STATE.FIRED ? { ...e, department: "" } : e,
              ),
              departments: runtime.company.departments.filter((d) => d.id !== departmentId),
            };
            await store.saveCompany(runtime.company);
            await store.appendAudit({ type: "department_deleted", departmentId, code: dept.code });
            return { ok: true, departmentId, code: dept.code };
          });
        }
        default:
          return { ok: false, code: "E_UNKNOWN_ACTION", message: `未知 action: ${action}` };
      }
    } catch (err) {
      return { ok: false, code: err.code || "E_INTERNAL", message: err.message };
    }
  }

  function defineRoutes() {
    return [
      { method: "GET", path: "/company/overview", handler: (req, url) => view() },
      { method: "GET", path: "/company/org", handler: (req, url) => view().org },
      { method: "GET", path: "/company/board", handler: (req, url) => view().board },
      { method: "GET", path: "/company/costs", handler: (req, url) => view().costs },
      { method: "GET", path: "/company/orders", handler: (req, url) => view().orders },
      { method: "POST", path: "/company/op", handler: handleCompanyOp },
    ];
  }

  async function boot() {
    if (booted) return { ok: true, warnings: bootWarnings };
    bootWarnings = [];
    if (!caps.hasAgents) {
      bootWarnings.push("ctx.agents 不可用，运行时降级");
    }
    if (!caps.hasSubagents) {
      bootWarnings.push("ctx.subagents 不可用，运行时降级");
    }
    let loadedCompany = null;
    let loadCodeMigrations = 0;
    try {
      const loaded = await store.load();
      runtime.company = loaded.company || runtime.company;
      runtime.ledger = loaded.ledger || runtime.ledger;
      loadedCompany = loaded.company || null;
      if (loaded.warnings) {
        bootWarnings.push(...loaded.warnings);
        // store.load 内部的 normalizeCompany 已为历史员工补号（不经过下面的 ensureCompanyCodes），
        // 审计计数必须把这一部分算进去。
        loadCodeMigrations = loaded.warnings.filter((w) => String(w).includes("自动补号")).length;
      }
    } catch (err) {
      bootWarnings.push(`store.load 失败: ${err.message}`);
    }
    // 编号：company.numbering > config.numbering > DEFAULT_NUMBERING
    const numbering = runtime.company.numbering || config.numbering || DEFAULT_NUMBERING;
    runtime.config.numbering = numbering;
    if (!runtime.company.numbering) {
      runtime.company = { ...runtime.company, numbering };
    }
    // 自动补号（历史数据迁移）
    try {
      const beforeCompany = runtime.company;
      const before = JSON.stringify(runtime.company);
      const ensured = ensureCompanyCodes(runtime.company, { levels: runtime.config.levels, numbering: runtime.config.numbering });
      runtime.company = ensured.company;
      if (ensured.warnings.length > 0) bootWarnings.push(...ensured.warnings);
      if (JSON.stringify(runtime.company) !== before) {
        await store.saveCompany(runtime.company);
        const count = loadCodeMigrations + countNewCodes(beforeCompany, runtime.company);
        await store.appendAudit({ type: "company.codes.backfilled", count });
      }
    } catch (err) {
      bootWarnings.push(`补号失败: ${err.message}`);
    }
    if (runtime.company.routingRules) {
      runtime.config.routingRules = runtime.company.routingRules;
    }
    // 种子部门：配置中的部门在 store 加载后写入（仅当公司尚无部门时）
    if (Array.isArray(config.departments)) {
      for (const d of config.departments) {
        if (!runtime.company.departments.find((x) => x.id === d.id)) {
          try {
            runtime.company = createDepartment(runtime.company, d);
          } catch (err) {
            bootWarnings.push(`种子部门失败: ${err.message}`);
          }
        }
      }
      if (runtime.company.departments.length > 0) {
        try { await store.saveCompany(runtime.company); } catch (err) { bootWarnings.push(`保存种子部门失败: ${err.message}`); }
      }
    }

    runtime.shuttingDown = false;

    // 冷启动：创建新 owner，旧 owner 会话作废
    try {
      runtime.ownerSessionId = await createOwnerAgent(runtime);
      runtime.sessionTools.set(runtime.ownerSessionId, new Set(LINE_TOOLS[TOOL_LINES.OWNER]));
      bootAttempts = 0;
      if (bootRetryTimer) { clearTimeout(bootRetryTimer); bootRetryTimer = null; }
    } catch (err) {
      bootWarnings.push(`owner 创建失败: ${err.message}`);
      scheduleBootRetry();
    }

    // 回收旧进程遗留的 attempt
    await recycleStaleAttempts(runtime, store, bootWarnings);

    await store.appendAudit({ type: "runtime.startup", ownerSessionId: runtime.ownerSessionId });

    scheduler.start();
    booted = true;
    return { ok: true, warnings: bootWarnings };
  }

  function scheduleBootRetry() {
    if (runtime.fake) return;
    if (bootRetryTimer) { clearTimeout(bootRetryTimer); bootRetryTimer = null; }
    if (bootAttempts >= BOOT_RETRY_DELAYS.length) return;
    const delay = BOOT_RETRY_DELAYS[bootAttempts];
    bootRetryTimer = setTimeout(() => {
      bootAttempts += 1;
      boot().catch((err) => logger?.warn?.(`boot retry failed: ${err.message}`));
    }, delay);
    if (bootRetryTimer && typeof bootRetryTimer.unref === "function") bootRetryTimer.unref();
  }

  async function shutdown() {
    if (runtime.shuttingDown) return;
    runtime.shuttingDown = true;
    if (bootRetryTimer) { clearTimeout(bootRetryTimer); bootRetryTimer = null; }
    // 1. 停派工：调度器不再派发新单
    try { scheduler.dispose(); } catch (e) { bootWarnings.push(e.message); }

    // 2. 给每个 live child followup 一条「停工」信号
    const children = Array.from(employeeManager.sessions.values()).filter((s) => !s.endedAt);
    for (const s of children) {
      try {
        if (s.handle && typeof s.handle.followup === "function") {
          await s.handle.followup(makeIdleMessage("shutdown"));
        }
      } catch (err) {
        logger?.warn?.(`followup 停工失败: ${err.message}`);
      }
    }

    // 3. await whenIdle (超时)
    await Promise.all(children.map((s) => whenIdleOrTimeout(s, 10000)));

    // 4. 逐个 cancel
    for (const s of children) {
      try {
        if (s.handle && typeof s.handle.cancel === "function") await Promise.resolve(s.handle.cancel("shutdown", { keepInbox: true })).catch(() => {});
      } catch (err) {
        logger?.warn?.(`cancel 失败: ${err.message}`);
      }
    }

    // 4.5 结束会话并释放资源
    try {
      await employeeManager.endAll();
    } catch (err) {
      logger?.warn?.(`endAll 失败: ${err.message}`);
    }

    // 5. drainChildren + dispose owner
    try {
      const subagents = runtime.ctx.get("subagents");
      if (subagents && runtime.ownerAgent && children.length > 0 && typeof subagents.drainChildren === "function") {
        const ids = children.map((s) => s.sessionId).filter(Boolean);
        await subagents.drainChildren(runtime.ownerAgent, ids);
      }
    } catch (err) {
      logger?.warn?.(`drainChildren 失败: ${err.message}`);
    }

    // 6. ownerHandle.dispose()
    try {
      if (runtime.ownerHandle && typeof runtime.ownerHandle.dispose === "function") await runtime.ownerHandle.dispose();
    } catch (err) {
      logger?.warn?.(`owner dispose 失败: ${err.message}`);
    }

    // 7. 写审计
    try {
      await store.appendAudit({ type: "runtime.shutdown", ownerSessionId: runtime.ownerSessionId });
    } catch (err) {
      logger?.warn?.(`shutdown audit 失败: ${err.message}`);
    }

    booted = false;
  }

  function view() {
    const deptMap = new Map((runtime.company.departments || []).map((d) => [d.id, d]));
    const employees = (runtime.company.employees || []).map((e) => {
      const dept = deptMap.get(e.department);
      const levelInfo = describeEmployeeLevel(e, runtime.config.levels);
      return {
        ...e,
        departmentCode: dept?.code ?? null,
        levelName: levelInfo.levelName,
        channels: describeEmployeeChannels(e, runtime.config.levels),
      };
    });
    const departments = (runtime.company.departments || []).map((d) => {
      const manager = employees.find((e) => e.department === d.id && e.role === EMPLOYEE_ROLE.MANAGER);
      return {
        ...d,
        employeeCount: employees.filter((e) => e.department === d.id).length,
        managerId: manager?.id ?? null,
      };
    });

    // 管理层：所有含 M 通道员（虚拟聚合，不写 company）。排序：部门编号升序（无部门最后）→ M 等级降序 → 工号升序
    const managementEmployees = employees
      .filter((e) => e.channels?.some((c) => c.channel === "M"))
      .sort((a, b) => {
        const deptA = deptMap.get(a.department);
        const deptB = deptMap.get(b.department);
        const codeA = deptA?.code ?? "\uFFFF";
        const codeB = deptB?.code ?? "\uFFFF";
        if (codeA !== codeB) return String(codeA).localeCompare(String(codeB));
        const mA = a.channels.find((c) => c.channel === "M")?.level ?? "";
        const mB = b.channels.find((c) => c.channel === "M")?.level ?? "";
        if (mA !== mB) return String(mB).localeCompare(String(mA));
        const codeEmpA = a.code ?? "";
        const codeEmpB = b.code ?? "";
        return String(codeEmpA).localeCompare(String(codeEmpB));
      })
      .map((e) => {
        const dept = deptMap.get(e.department);
        const mChannel = e.channels.find((c) => c.channel === "M");
        return {
          id: e.id,
          code: e.code,
          displayName: e.displayName,
          departmentId: e.department ?? null,
          departmentCode: dept?.code ?? null,
          departmentName: dept?.name ?? null,
          level: mChannel?.level ?? null,
          levelName: mChannel?.levelName ?? null,
          role: e.role,
        };
      });

    return {
      enabled: config.enabled,
      status: booted ? "running" : "stopped",
      warnings: bootWarnings,
      org: { departments, employees },
      management: { channel: "M", employees: managementEmployees },
      board: {
        orders: (runtime.ledger.orders || []).length,
        done: (runtime.ledger.orders || []).filter((o) => o.state === "done").length,
      },
      levels: runtime.config.levels,
      numbering: runtime.config.numbering,
      costs: runtime.costs,
      orders: (runtime.ledger.orders || []).slice(-50),
    };
  }

  const api = {
    tools: defineTools(),
    routes: defineRoutes(),
    boot,
    shutdown,
    view,
    get ownerSessionId() {
      return runtime.ownerSessionId;
    },
  };
  if (fake) api.fakeServices = fakeServices;
  return api;
}

/**
 * 统计补号动作实际新增/变更的编号数量（部门 + 员工各自独立）。
 * 用于审计 `company.codes.backfilled` 的 count：不能直接用 ensureCompanyCodes
 * 的 warnings.length，因为「缺号」是无 warning 直接补的（只有非法/重复才 warning）。
 */
function countNewCodes(before, after) {
  let count = 0;
  for (const key of ["departments", "employees"]) {
    const prev = new Map((Array.isArray(before?.[key]) ? before[key] : []).map((item) => [item?.id, item?.code]));
    for (const item of Array.isArray(after?.[key]) ? after[key] : []) {
      if (prev.get(item?.id) !== item?.code) count += 1;
    }
  }
  return count;
}

async function createOwnerAgent(runtime) {
  const agents = runtime.ctx.get("agents");
  if (!agents || typeof agents.create !== "function") {
    runtime.ownerAgent = { id: "fake-owner" };
    runtime.ownerHandle = { dispose() {} };
    return "fake-owner";
  }
  const ownerSessionId = `company-owner-${crypto.randomUUID()}`;
  const handle = await agents.create({
    sessionId: ownerSessionId,
    // 注意：runtime.provider 是 subagent 后端名（spawn/fork），不是 LLM provider。
    // 插件自建的根级 Agent 不走 GUI 的会话创建路径，拿不到会话默认模型，
    // 必须显式继承宿主 agent-default-model 的默认 provider/model；子会话再沿用 owner
    // 的 options 继承同一路由（否则 dsh-agent-loop 会报 has no provider/model）。
    agentOptions: resolveDefaultLlmOptions(runtime.ctx),
    setup: (agentCtx, agent) => {
      runtime.ownerAgent = agent;
      runtime.ownerSessionId = ownerSessionId;
      runtime.sessionTools.set(ownerSessionId, new Set(TOOL_LINES[TOOL_LINES.OWNER]));
      // owner 出错要能在 boot.log 看到（默认只有循环内部吞掉）
      if (agentCtx && typeof agentCtx.on === "function") {
        agentCtx.on("agent/error", (payload) => {
          const message = payload?.error?.message || String(payload?.error || "");
          runtime.lastAgentError = message;
          logger?.warn?.(`owner agent/error: ${message}`);
        });
      }
      // 在 owner 上下文累加 usage（assistant/message 是会话事件，走 session/event）
      if (agentCtx && typeof agentCtx.on === "function") {
        agentCtx.on("session/event", (session, event) => {
          if (!event || event.type !== "assistant/message") return;
          if (session && agent.session && session !== agent.session) return;
          const usage = event.data?.usage;
          if (!usage) return;
          const n = normalizeUsage(usage);
          runtime.costs.tokens += n.totalTokens;
          runtime.costs.requests += 1;
        });
      }
    },
  });
  runtime.ownerHandle = handle;
  runtime.ownerAgent = handle?.agent || { id: ownerSessionId };
  runtime.ownerSessionId = ownerSessionId;
  return ownerSessionId;
}

async function recycleStaleAttempts(runtime, store, warnings) {
  try {
    await store.withLock(async () => {
      const loaded = await store.load();
      runtime.ledger = loaded.ledger || runtime.ledger;
      runtime.company = loaded.company || runtime.company;
      let changed = false;
      for (const order of runtime.ledger.orders || []) {
        let orderChanged = false;
        for (const attempt of order.attempts || []) {
          if (attempt.state === "running" || attempt.state === "queued") {
            attempt.state = "stale";
            attempt.endedAt = new Date().toISOString();
            orderChanged = true;
          }
        }
        if (orderChanged || order.state === "running") {
          if (order.state === "running") {
            runtime.ledger = transitionOrder(runtime.ledger, order.id, ORDER_STATES.FAILED);
            runtime.ledger = transitionOrder(runtime.ledger, order.id, ORDER_STATES.QUEUED);
          }
          changed = true;
        }
      }
      if (changed) {
        await store.saveLedger(runtime.ledger);
        await store.appendAudit({ type: "stale_attempts_recycled", count: runtime.ledger.orders.length });
      }
    });
  } catch (err) {
    warnings.push(`回收 stale attempts 失败: ${err.message}`);
  }
}

async function whenIdleOrTimeout(session, timeoutMs = 10000) {
  if (!session.handle || typeof session.handle.whenIdle !== "function") return;
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([session.handle.whenIdle(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
