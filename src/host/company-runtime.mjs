/**
 * company-runtime.mjs
 * 公司运行时统一入口：组装 compat / employees / dispatcher / scheduler，注册工具与路由。
 */

import { detectCap, isFakeMode, normalizeUsage, buildUserMessage, SOURCE_KIND, newMessageId, buildFakeServices, TOOL_LINES, LINE_TOOLS, safeCtxGet, safeCtxProp, resolveDefaultLlmOptions } from "./company-compat.mjs";
import { createEmployeeSessionManager } from "./company-employees.mjs";
import { createDispatcher } from "./company-dispatcher.mjs";
import { createScheduler } from "./company-scheduler.mjs";
import { CompanyStore } from "../shared/company-store.mjs";
import { resolveCompanyConfig } from "../shared/company-config.mjs";
import { emptyCompany, createDepartment, createEmployee, updateDepartment, updateEmployee, promoteEmployee, fireEmployee, ensureCompanyCodes, describeEmployeeLevel, describeEmployeeChannels, setEmployeeChannels, primaryChannelOf, EMPLOYEE_ROLE, EMPLOYEE_STATE, EMPLOYEE_KIND, SESSION_POLICY, DEFAULT_LEVELS, DEFAULT_NUMBERING, normalizeManagementName, normalizeLevelsOverride, validateLevelsDirectory, MANAGEMENT_NAME_DEFAULT, normalizeCompanyName, COMPANY_NAME_DEFAULT } from "../shared/company-org.mjs";
import { emptyLedger, transitionOrder, ORDER_STATES, listLiveAttempts } from "../shared/company-ledger.mjs";
import { listPresets, validatePresetRef, resolveDepartmentPreset } from "../shared/company-presets.mjs";
import { ROSTER_LINK_STATUS, buildRosterIndex, buildRosterProfile, describeRosterLink, planRosterLink, rosterTargetOf, summarizeRosterLinks } from "../shared/roster-link.mjs";
import { isValidMemberName } from "../shared/registry-core.mjs";
import path from "node:path";
import { readFile, writeFile, rm, mkdir, rename } from "node:fs/promises";
import crypto from "node:crypto";

export const TOOL_NAMES = [
  "company_order", "company_plan", "company_status", "company_ask", "company_cancel",
  "company_assign", "company_review", "company_borrow", "company_report", "company_escalate",
  "company_accept", "company_ask_help",
  "company_hire", "company_admin",
];

export function createCompanyRuntime(ctx, { dataDir, config: rawConfig = {}, logger = console, roster = null }) {
  const warnings = [];
  const PENDING_MIGRATION_FILE = "pending-migration.json";
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
  // 轮询间隔必须用 schedulerIntervalMs（默认 5s），不能用 staleAttemptMs（1 小时，那是僵死判定阈值）。
  const scheduler = createScheduler({ runtime, dispatcher, logger, intervalMs: config.limits.schedulerIntervalMs });
  runtime.scheduler = scheduler;

  async function followupManagersAndOwner(text) {
    const owner = runtime.ownerAgent;
    if (owner && typeof owner.followup === "function") {
      try { await owner.followup({ id: newMessageId("escalation-owner"), role: "user", content: text, source: { kind: SOURCE_KIND, signal: "escalation" } }); } catch {}
    }
    for (const s of employeeManager.sessions.values()) {
      if (s.endedAt) continue;
      const emp = runtime.company.employees.find((e) => e.id === s.employeeId);
      if (emp && emp.role === EMPLOYEE_ROLE.MANAGER && s.handle && typeof s.handle.followup === "function") {
        try { await s.handle.followup({ id: newMessageId(`escalation-${s.sessionId || emp.id}`), role: "user", content: text, source: { kind: SOURCE_KIND, signal: "escalation" } }); } catch {}
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
    company_plan: "一次提交一个任务图：多个任务用 key 互相声明依赖，无依赖的同一层并行派发，下游等上游完成后自动放行。",
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
      mkTool("company_status", { type: "object", properties: { orderId: { type: "string" }, group: { type: "string" } } }, company_status),
      mkTool("company_plan", {
        type: "object",
        properties: {
          group: { type: "string", description: "批次名，可留空自动生成" },
          tasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                key: { type: "string", description: "图内唯一键，deps 用它引用；留空按 t1/t2 生成" },
                type: { type: "string" },
                title: { type: "string" },
                deps: { type: "array", items: { type: "string" }, description: "依赖的任务 key" },
                priority: { type: "string" },
                dept: { type: "string" },
                detail: { type: "string" },
                project: { type: "string" },
                acceptance: { type: "array", items: { type: "string" } },
              },
              required: ["type", "title"],
            },
          },
        },
        required: ["tasks"],
      }, company_plan),
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
          title: { type: "string", description: "岗位名称" },
          duties: { type: "array", items: { type: "string" }, description: "岗位职责条目，最多 8 条" },
          model: { type: "string", description: "模型覆盖" },
          provider: { type: "string", description: "模型 provider 覆盖" },
        },
        required: ["id"],
      }, company_hire),
      mkTool("company_admin", {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["createDepartment", "createEmployee", "setRoutingRules", "updateDepartment", "promoteEmployee", "setNumbering", "setManagementName", "setCompanyName", "setLevels", "setChannels", "updateEmployeeProfile", "importRosterProfiles", "linkEmployeeRoster", "syncEmployeesRoster", "unlinkEmployeeRoster", "applyDepartmentPreset", "clearDepartmentPreset"],
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

  /**
   * 会话归档所需的归属信息：root 会话 id + 会话标题快照。
   *
   * 为什么要取 parentSession：teammate 子会话不是看板的作用域（看板按 root 任务选），
   * 用子会话 id 归档会永远匹配不上 `?task=`，完成单就再也回不到发起它的会话。
   * 标题取快照而不是每次回查：会话归档后 sessionTitle 服务查不到历史标题，
   * 快照能保证「这条单当时属于哪个对话」长期可读。
   */
  function sessionStamp(exec) {
    const session = exec?.agent?.session || null;
    if (!session) return {};
    const sid = typeof session.id === "string" ? session.id : "";
    const parent = session?.header?.parentSession || "";
    const root = parent || sid;
    if (!root) return {};
    let title = "";
    try {
      const svc = ctx.get("sessionTitle");
      if (svc && typeof svc.get === "function") {
        const snap = svc.get(session);
        const raw = snap && (typeof snap === "string" ? snap : snap.title || snap.text);
        title = typeof raw === "string" ? raw : "";
      }
    } catch {
      title = "";
    }
    return { sessionId: root, sessionTitle: title || "" };
  }

  /** 工具入参 + 会话归属；调用方显式给的值优先（面板/脚本可代填）。 */
  function withSessionStamp(args, exec) {
    const stamp = sessionStamp(exec);
    if (!stamp.sessionId) return args || {};
    const out = { ...(args || {}), sessionId: (args && args.sessionId) || stamp.sessionId };
    if (stamp.sessionTitle) out.sessionTitle = (args && args.sessionTitle) || stamp.sessionTitle;
    return out;
  }

  async function company_order(args, { exec }) {
    const res = await dispatcher.placeOrder(withSessionStamp(args, exec));
    // 下完单立刻推一次调度，不等 interval（「下达任务后真的能分到人」的体感来源）
    if (res?.ok && res.orderId) {
      try { scheduler.kick(0); } catch {}
    }
    return res;
  }

  async function company_plan(args, { exec }) {
    const res = await dispatcher.placePlan(withSessionStamp(args, exec));
    // 建完图立刻推一次调度：第一层没有依赖，当轮就能并行派出去。
    if (res?.ok && res.count) {
      try { scheduler.kick(0); } catch {}
    }
    return res;
  }

  async function company_status(args = {}) {
    const out = { ok: true, view: view() };
    const group = typeof args?.group === "string" ? args.group.trim() : "";
    if (group) {
      const orders = (runtime.ledger.orders || []).filter((o) => o.group === group);
      if (!orders.length) {
        return { ok: false, code: "E_NO_GROUP", message: `没有找到批次 ${group}` };
      }
      const count = (state) => orders.filter((o) => o.state === state).length;
      out.group = {
        name: group,
        total: orders.length,
        done: count("done"),
        running: count("running"),
        pending: count("queued") + count("routed"),
        failed: count("failed"),
        cancelled: count("cancelled"),
        orders: orders.map((o) => ({
          key: o.taskKey || null,
          orderId: o.id,
          title: o.title || null,
          state: o.state || null,
          deps: (o.deps || []).length,
        })),
      };
    }
    return out;
  }

  /** 订单状态一变就立刻推一轮调度：依赖解锁、产能释放都不该等下一次轮询。 */
  function kickScheduler() {
    try { scheduler.kick(0); } catch { /* 调度器已停，忽略 */ }
  }

  async function company_ask(args) {
    return { ok: true };
  }

  async function company_cancel(args) {
    const res = await dispatcher.cancelOrder(args.orderId);
    if (res?.ok) kickScheduler();
    return res;
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
    const res = await dispatcher.review(args);
    // 验收通过会让订单进 done，可能立刻解锁依赖它的下游单。
    if (res?.ok) kickScheduler();
    return res;
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
    const res = await dispatcher.report({ ...args, attemptId: meta.attemptId });
    // 回报常让订单进终态，依赖它的下游单不该等到下一次轮询。
    if (res?.ok) kickScheduler();
    return res;
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

  
    // v5.8（reviewer docs/23 R1/R2）：档案文本字段统一 trim；空串按「未提供」处理，避免覆盖已有值
    function cleanProfileText(value) {
      if (value === undefined) return undefined;
      if (value === null) return "";
      return String(value).trim();
    }
    function normalizeDutiesInput(v) {
    if (!Array.isArray(v)) return [];
    return v.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean).slice(0, 8);
  }

  async function restoreChannelsFromFile(company) {
    try {
      const raw = await readFile(path.join(dataDir, "company.json"), "utf8");
      const saved = JSON.parse(raw);
      const map = new Map((saved.employees || []).map((e) => [e.id, e.channels]));
      for (const emp of (company?.employees || [])) {
        const ch = map.get(emp.id);
        if (Array.isArray(ch)) emp.channels = ch;
      }
    } catch {
      // ignore
    }
  }

  function employeeProfileSummary(emp) {
    return {
      id: emp.id,
      displayName: emp.displayName,
      title: emp.title ?? "",
      duties: emp.duties ?? [],
      skills: emp.skills ?? [],
      model: emp.model ?? "",
      provider: emp.provider ?? "",
      // v0.4：成员属性（参照 agent-teams 的 provider/model/effort + toolPolicies + 派生方式）
      kind: emp.kind ?? "permanent",
      state: emp.state ?? "idle",
      sessionPolicy: emp.sessionPolicy ?? "",
      reasoningEffort: emp.reasoningEffort ?? "",
      memberProvider: emp.memberProvider ?? "",
      maxDepth: emp.maxDepth ?? null,
      toolPolicy: { allow: emp.toolPolicy?.allow ?? [], deny: emp.toolPolicy?.deny ?? [] },
      tempMaxTasks: emp.tempMaxTasks ?? 0,
      tempCompleted: emp.tempCompleted ?? 0,
      tempExpiresAt: emp.tempExpiresAt ?? null,
      currentOrderId: emp.currentOrderId ?? null,
    };
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
          title: args.title,
          duties: Array.isArray(args.duties) ? args.duties : undefined,
          model: args.model,
          provider: args.provider,
        });
        await store.saveCompany(runtime.company);
        await store.appendAudit({ type: "employee_hired", employeeId: args.id });
        const emp = runtime.company.employees.find((e) => e.id === args.id);
        const levelInfo = describeEmployeeLevel(emp, runtime.config.levels);
        // v0.3.3：新建员工自动登记名册（best-effort，失败不影响雇佣结果）
        const roster = await autoLinkRosterFor([args.id], "auto:hire");
        return { ok: true, employeeId: args.id, code: emp.code, channel: levelInfo.channel, level: levelInfo.level, levelName: levelInfo.levelName, channels: emp.channels, roster };
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
            runtime.company = createDepartment(runtime.company, { id: args.args.id, name: args.args.name, code: args.args.code, preset: args.args.preset });
            await store.saveCompany(runtime.company);
            await store.appendAudit({ type: "department_created", departmentId: args.args.id });
            const newDept = runtime.company.departments.find((d) => d.id === args.args.id);
            // v0.3.3：新部门此时通常还没有员工；已挂员工（如先建员工后建部门不会发生）一并补登
            const roster = await autoLinkRosterFor(employeeIdsOfDepartment(args.args.id), "auto:admin:createDepartment");
            return { ok: true, departmentId: args.args.id, code: newDept?.code, roster };
          }
          case "updateDepartment": {
            runtime.company = updateDepartment(runtime.company, args.args.id, {
              name: args.args.name,
              code: args.args.code,
              accepts: args.args.accepts,
              capacity: args.args.capacity,
              charter: args.args.charter,
              preset: args.args.preset,
            });
            await store.saveCompany(runtime.company);
            await store.appendAudit({ type: "department_updated", departmentId: args.args.id });
            const updatedDept = runtime.company.departments.find((d) => d.id === args.args.id);
            return { ok: true, departmentId: args.args.id, code: updatedDept?.code };
          }
          // docs/24 §5.2：套用/清除部门流程预设（game-dev）。
          case "applyDepartmentPreset": {
            const presetArgs = args.args || {};
            const departmentId = presetArgs.departmentId || presetArgs.id;
            assertDepartmentExists(departmentId);
            const checked = validatePresetRef(presetArgs.presetId ?? presetArgs.preset);
            if (!checked.ok) return { ok: false, code: checked.code, message: checked.message };
            runtime.company = updateDepartment(runtime.company, departmentId, { preset: checked.preset.id });
            await store.saveCompany(runtime.company);
            const appliedDept = runtime.company.departments.find((d) => d.id === departmentId);
            await store.appendAudit({ type: "department.preset.applied", departmentId, presetId: appliedDept?.preset?.id, version: appliedDept?.preset?.version });
            return { ok: true, departmentId, preset: appliedDept?.preset ?? null };
          }
          case "clearDepartmentPreset": {
            const presetArgs = args.args || {};
            const departmentId = presetArgs.departmentId || presetArgs.id;
            assertDepartmentExists(departmentId);
            runtime.company = updateDepartment(runtime.company, departmentId, { preset: null });
            await store.saveCompany(runtime.company);
            await store.appendAudit({ type: "department.preset.cleared", departmentId });
            return { ok: true, departmentId };
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
              title: args.args.title,
              duties: Array.isArray(args.args.duties) ? args.args.duties : undefined,
              model: args.args.model,
              provider: args.args.provider,
            });
            await store.saveCompany(runtime.company);
            await store.appendAudit({ type: "employee_created", employeeId: args.args.id });
            const createdEmp = runtime.company.employees.find((e) => e.id === args.args.id);
            const createdLevelInfo = describeEmployeeLevel(createdEmp, runtime.config.levels);
            // v0.3.3：新建员工自动登记名册（best-effort，失败不影响创建结果）
            const roster = await autoLinkRosterFor([args.args.id], "auto:admin:createEmployee");
            return { ok: true, employeeId: args.args.id, code: createdEmp.code, channel: createdLevelInfo.channel, level: createdLevelInfo.level, levelName: createdLevelInfo.levelName, channels: createdEmp.channels, roster };
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
            return { ok: true, numbering };
          }
          case "setManagementName": {
            const name = normalizeManagementName(args.args && args.args.name);
            if (!name) return { ok: false, code: "E_INVALID_INPUT", message: "name 必填（1-40 字符）" };
            runtime.company = { ...runtime.company, managementName: name };
            await store.saveCompany(runtime.company);
            await store.appendAudit({ type: "company.management_renamed", name });
            return { ok: true, name };
          }
          case "setCompanyName": {
            const name = normalizeCompanyName(args.args && args.args.name);
            if (!name) return { ok: false, code: "E_INVALID_COMPANY_NAME", message: "公司名称必填（1-40 字符）" };
            runtime.company = { ...runtime.company, companyName: name };
            await store.saveCompany(runtime.company);
            await store.appendAudit({ type: "company.renamed", name });
            return { ok: true, companyName: name };
          }
          case "setLevels": {
            const result = applyLevelsOverride(args.args || {}, runtime.config.levels);
            if (!result.ok) return result;
            runtime.config.levels = result.levels;
            runtime.company = { ...runtime.company, levels: result.levels };
            await store.saveCompany(runtime.company);
            await store.appendAudit({ type: "company.levels_set" });
            return { ok: true, levels: result.levels };
          }
          // v0.3.2 · 公司员工 → 名册（工具入口；与 handleCompanyOp 同一套语义，锁已在最外层持有）
          case "linkEmployeeRoster": {
            const rosterArgs = args.args || {};
            const employeeId = rosterArgs.employeeId || rosterArgs.id;
            if (!employeeId) return { ok: false, code: "E_INVALID_INPUT", message: "employeeId 必填" };
            return await applyRosterLinks({
              employeeIds: [String(employeeId)],
              explicitTarget: typeof rosterArgs.target === "string" ? rosterArgs.target : null,
              refresh: Boolean(rosterArgs.refresh),
              onlyUnlinked: false,
              dryRun: Boolean(rosterArgs.dryRun),
              source: "tool",
            });
          }
          case "syncEmployeesRoster": {
            const rosterArgs = args.args || {};
            return await applyRosterLinks({
              departmentId: rosterArgs.departmentId || rosterArgs.department || null,
              refresh: Boolean(rosterArgs.refresh),
              onlyUnlinked: rosterArgs.onlyUnlinked !== false,
              dryRun: Boolean(rosterArgs.dryRun),
              source: "tool",
            });
          }
          case "unlinkEmployeeRoster": {
            const rosterArgs = args.args || {};
            return await unlinkEmployeeRoster({ employeeId: rosterArgs.employeeId || rosterArgs.id, source: "tool" });
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

  /** v5.12：等级目录可增删等级；校验格式/名称，并拒绝删除仍被员工引用的等级。 */
  function applyLevelsOverride(input, current) {
    const raw = input && typeof input === "object" && input.levels && typeof input.levels === "object"
      ? input.levels
      : input || {};
    const remap = input && typeof input === "object" && input.levelRemap && typeof input.levelRemap === "object"
      ? input.levelRemap
      : null;
    const checked = validateLevelsDirectory(raw, current);
    if (!checked.ok) return { ok: false, code: "E_INVALID_LEVELS", message: checked.message };
    const levels = checked.levels;
    const updates = [];
    for (const emp of runtime.company.employees || []) {
      const channels = Array.isArray(emp.channels) && emp.channels.length
        ? emp.channels
        : [{ channel: emp.channel, level: emp.level }];
      const next = [];
      for (const entry of channels) {
        const track = levels[entry.channel]?.levels || [];
        const codes = track.map((lv) => lv.code);
        let level = entry.level;
        const mapped = remap && remap[entry.channel] ? remap[entry.channel][level] : undefined;
        if (mapped !== undefined) {
          if (!codes.includes(mapped)) {
            return {
              ok: false,
              code: "E_INVALID_LEVELS",
              message: `等级重映射目标 ${mapped} 不存在于 ${entry.channel} 通道目录`,
            };
          }
          level = mapped;
        } else if (!level || !codes.includes(level)) {
          return {
            ok: false,
            code: "E_LEVEL_IN_USE",
            message: `等级 ${entry.level || "(空)"} 仍被员工「${emp.displayName || emp.id}」使用，不能删除`,
          };
        }
        next.push({ ...entry, level });
      }
      updates.push([emp, next]);
    }
    for (const [emp, nextChannels] of updates) {
      emp.channels = nextChannels;
      if (emp.channel && emp.level) {
        const primary = nextChannels.find((entry) => entry.channel === emp.channel) || nextChannels[0];
        if (primary) {
          emp.channel = primary.channel;
          emp.level = primary.level;
        }
      }
    }
    return { ok: true, levels };
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
              preset: args.preset,
            });
            await store.saveCompany(runtime.company);
            const dept = runtime.company.departments.find((d) => d.id === id);
            await store.appendAudit({ type: "department_created", departmentId: id, code: dept?.code });
            // v0.3.3：新部门员工自动登记名册（面板随后逐个 createEmployee，各自也会自动登记）
            const roster = await autoLinkRosterFor(employeeIdsOfDepartment(id), "auto:panel:createDepartment");
            return { ok: true, departmentId: id, code: dept?.code, roster };
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
              borrowPolicy: args.borrowPolicy,
              preset: args.preset,
            });
            await store.saveCompany(runtime.company);
            const dept = runtime.company.departments.find((d) => d.id === departmentId);
            await store.appendAudit({ type: "department_updated", departmentId, code: dept?.code });
            return { ok: true, departmentId, code: dept?.code };
          });
        }
        // docs/24 §5.3：套用/清除部门流程预设（与 company_admin 同语义）。
        case "applyDepartmentPreset": {
          const departmentId = args.departmentId || args.id;
          if (!departmentId) {
            return { ok: false, code: "E_INVALID_INPUT", message: "departmentId 必填" };
          }
          const checked = validatePresetRef(args.presetId ?? args.preset);
          if (!checked.ok) return { ok: false, code: checked.code, message: checked.message };
          return await withCompanyRefresh(async () => {
            assertDepartmentExists(departmentId);
            runtime.company = updateDepartment(runtime.company, departmentId, { preset: checked.preset.id });
            await store.saveCompany(runtime.company);
            const dept = runtime.company.departments.find((d) => d.id === departmentId);
            await store.appendAudit({ type: "department.preset.applied", departmentId, presetId: dept?.preset?.id, version: dept?.preset?.version });
            return { ok: true, departmentId, preset: dept?.preset ?? null };
          });
        }
        case "clearDepartmentPreset": {
          const departmentId = args.departmentId || args.id;
          if (!departmentId) {
            return { ok: false, code: "E_INVALID_INPUT", message: "departmentId 必填" };
          }
          return await withCompanyRefresh(async () => {
            assertDepartmentExists(departmentId);
            runtime.company = updateDepartment(runtime.company, departmentId, { preset: null });
            await store.saveCompany(runtime.company);
            await store.appendAudit({ type: "department.preset.cleared", departmentId });
            return { ok: true, departmentId };
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
              title: args.title,
              duties: Array.isArray(args.duties) ? args.duties : undefined,
              model: args.model,
              provider: args.provider,
            });
            await store.saveCompany(runtime.company);
            const emp = runtime.company.employees.find((e) => e.id === id);
            const levelInfo = describeEmployeeLevel(emp, runtime.config.levels);
            await store.appendAudit({ type: "employee_hired", employeeId: id, code: emp?.code });
            // v0.3.3：新建员工自动登记名册（面板「新建部门」逐员工创建时也走这里）
            const roster = await autoLinkRosterFor([id], "auto:panel:createEmployee");
            return { ok: true, employeeId: id, code: emp?.code, channel: levelInfo.channel, level: levelInfo.level, levelName: levelInfo.levelName, roster };
          });
        }
        case "updateEmployeeProfile": {
          const employeeId = args.employeeId;
          if (!employeeId) {
            return { ok: false, code: "E_INVALID_INPUT", message: "employeeId 必填" };
          }
          return await withCompanyRefresh(async () => {
            const target = runtime.company.employees.find((e) => e.id === employeeId);
            if (!target) {
              return { ok: false, code: "E_NOT_FOUND", message: `员工 ${employeeId} 不存在` };
            }
            const patch = {};
            const fields = [];
            if (args.displayName !== undefined) {
              patch.displayName = cleanProfileText(args.displayName);
              fields.push("displayName");
            }
            if (args.title !== undefined) {
              patch.title = cleanProfileText(args.title);
              fields.push("title");
            }
            if (args.duties !== undefined) {
              patch.duties = normalizeDutiesInput(args.duties);
              fields.push("duties");
            }
            if (args.skills !== undefined) {
              patch.skills = args.skills;
              fields.push("skills");
            }
            if (args.model !== undefined) {
              patch.model = cleanProfileText(args.model);
              fields.push("model");
            }
            if (args.provider !== undefined) {
              patch.provider = cleanProfileText(args.provider);
              fields.push("provider");
            }
            // v0.4 成员属性：推理强度 / 派生方式 / 子代理深度 / 工具策略 / 会话策略 / 临时工计次
            if (args.reasoningEffort !== undefined) {
              const effort = cleanProfileText(args.reasoningEffort);
              if (effort && !["minimal", "low", "medium", "high", "xhigh"].includes(effort)) {
                return { ok: false, code: "E_INVALID_INPUT", message: "reasoningEffort 只能是 minimal/low/medium/high/xhigh 或空" };
              }
              patch.reasoningEffort = effort;
              fields.push("reasoningEffort");
            }
            if (args.memberProvider !== undefined) {
              const mp = cleanProfileText(args.memberProvider);
              if (mp && mp !== "spawn" && mp !== "fork") {
                return { ok: false, code: "E_INVALID_INPUT", message: "memberProvider 只能是 spawn/fork 或空" };
              }
              patch.memberProvider = mp;
              fields.push("memberProvider");
            }
            if (args.maxDepth !== undefined) {
              const depth = args.maxDepth === null || args.maxDepth === "" ? null : Number(args.maxDepth);
              if (depth !== null && (!Number.isInteger(depth) || depth < 0 || depth > 3)) {
                return { ok: false, code: "E_INVALID_INPUT", message: "maxDepth 只能是 0–3 的整数或空" };
              }
              patch.maxDepth = depth;
              fields.push("maxDepth");
            }
            if (args.toolPolicy !== undefined) {
              const raw = args.toolPolicy || {};
              const norm = (list) => (Array.isArray(list) ? list.map((x) => String(x).trim()).filter(Boolean).slice(0, 40) : []);
              patch.toolPolicy = { allow: norm(raw.allow), deny: norm(raw.deny) };
              fields.push("toolPolicy");
            }
            if (args.sessionPolicy !== undefined) {
              const sp = cleanProfileText(args.sessionPolicy);
              if (sp && sp !== "resident" && sp !== "per_task") {
                return { ok: false, code: "E_INVALID_INPUT", message: "sessionPolicy 只能是 resident/per_task 或空" };
              }
              patch.sessionPolicy = sp || undefined;
              fields.push("sessionPolicy");
            }
            if (args.tempMaxTasks !== undefined) {
              const cap = Number(args.tempMaxTasks) || 0;
              if (cap < 0 || !Number.isFinite(cap)) {
                return { ok: false, code: "E_INVALID_INPUT", message: "tempMaxTasks 必须是非负整数" };
              }
              patch.tempMaxTasks = Math.floor(cap);
              fields.push("tempMaxTasks");
            }
            if (args.tempExpiresAt !== undefined) {
              patch.tempExpiresAt = args.tempExpiresAt === null || args.tempExpiresAt === "" ? null : args.tempExpiresAt;
              fields.push("tempExpiresAt");
            }
            if (fields.length === 0) {
              return { ok: true, employeeId, employee: employeeProfileSummary(target) };
            }
            runtime.company = updateEmployee(runtime.company, employeeId, patch);
            await store.saveCompany(runtime.company);
            const updated = runtime.company.employees.find((e) => e.id === employeeId);
            await store.appendAudit({ type: "employee_profile_updated", employeeId, fields });
            return { ok: true, employeeId, employee: employeeProfileSummary(updated) };
          });
        }
        case "importRosterProfiles": {
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
            await restoreChannelsFromFile(runtime.company);
            const members = (registry.members || []).filter((m) => m.status === "active");
            const memberMap = new Map(members.map((m) => [m.target, m]));
            const filled = [];
            const skipped = [];
            for (const emp of runtime.company.employees) {
              const member = memberMap.get(emp.id);
              if (!member) {
                skipped.push({ employeeId: emp.id, reason: "registry 中无匹配成员" });
                continue;
              }
              const patch = {};
              const fields = [];
              const isDisplayNameEmpty = !emp.displayName || emp.displayName === emp.id;
              if (isDisplayNameEmpty && member.displayName) {
                patch.displayName = cleanProfileText(member.displayName);
                fields.push("displayName");
              }
              // registry 成员形状：{ title: string, duties: string[] }（title/duties 是同级字段）。
              // 早期实现误读 member.duties.title / member.duties.duties，导致真实名册的岗位与
              // 职责永远导不进来（单测夹具也照抄了错误形状）。
              if (!emp.title && member.title) {
                patch.title = cleanProfileText(member.title);
                fields.push("title");
              }
              const incomingDuties = Array.isArray(member.duties) ? member.duties.filter(Boolean) : [];
              if ((!emp.duties || emp.duties.length === 0) && incomingDuties.length > 0) {
                patch.duties = incomingDuties;
                fields.push("duties");
              }
              const incomingSkills = Array.isArray(member.skills) ? member.skills.filter(Boolean) : [];
              if ((!emp.skills || emp.skills.length === 0) && incomingSkills.length > 0) {
                patch.skills = incomingSkills;
                fields.push("skills");
              }
              if (!emp.model && member.model) {
                patch.model = cleanProfileText(member.model);
                fields.push("model");
              }
              if (!emp.provider && member.provider) {
                patch.provider = cleanProfileText(member.provider);
                fields.push("provider");
              }
              if (fields.length === 0) {
                skipped.push({ employeeId: emp.id, reason: "无空字段可补" });
                continue;
              }
              if (!dryRun) {
                runtime.company = updateEmployee(runtime.company, emp.id, patch);
              }
              filled.push({ employeeId: emp.id, fields });
            }
            if (!dryRun) {
              await store.saveCompany(runtime.company);
              await store.appendAudit({ type: "roster.profiles_imported", counts: { filled: filled.length, skipped: skipped.length } });
            }
            return {
              ok: true,
              dryRun,
              filled,
              skipped,
              counts: { filled: filled.length, skipped: skipped.length },
            };
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
        case "setNumbering": {
          const numbering = validateNumberingArgs(args, runtime.config.numbering);
          runtime.config.numbering = numbering;
          runtime.company = { ...runtime.company, numbering };
          await store.saveCompany(runtime.company);
          await store.appendAudit({ type: "numbering_set", numbering });
          return { ok: true, numbering };
        }
        case "setManagementName": {
          const name = normalizeManagementName(args.name);
          if (!name) return { ok: false, code: "E_INVALID_INPUT", message: "name 必填（1-40 字符）" };
          runtime.company = { ...runtime.company, managementName: name };
          await store.saveCompany(runtime.company);
          await store.appendAudit({ type: "company.management_renamed", name });
          return { ok: true, name };
        }
        case "setCompanyName": {
          const name = normalizeCompanyName(args.name);
          if (!name) return { ok: false, code: "E_INVALID_COMPANY_NAME", message: "公司名称必填（1-40 字符）" };
          runtime.company = { ...runtime.company, companyName: name };
          await store.saveCompany(runtime.company);
          await store.appendAudit({ type: "company.renamed", name });
          return { ok: true, companyName: name };
        }
        case "setLevels": {
          const result = applyLevelsOverride(args, runtime.config.levels);
          if (!result.ok) return result;
          runtime.config.levels = result.levels;
          runtime.company = { ...runtime.company, levels: result.levels };
          await store.saveCompany(runtime.company);
          await store.appendAudit({ type: "company.levels_set" });
          return { ok: true, levels: result.levels };
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
        // v0.3.2 · 公司员工 → 名册登记/回填/解除关联
        case "linkEmployeeRoster": {
          const employeeId = args.employeeId || args.id;
          if (!employeeId) {
            return { ok: false, code: "E_INVALID_INPUT", message: "employeeId 必填" };
          }
          return await withCompanyRefresh(async () =>
            applyRosterLinks({
              employeeIds: [String(employeeId)],
              explicitTarget: typeof args.target === "string" ? args.target : null,
              refresh: Boolean(args.refresh),
              onlyUnlinked: false,
              dryRun: Boolean(args.dryRun),
              source: args.source || "panel",
            }),
          );
        }
        case "syncEmployeesRoster": {
          return await withCompanyRefresh(async () =>
            applyRosterLinks({
              departmentId: args.departmentId || args.department || null,
              refresh: Boolean(args.refresh),
              onlyUnlinked: args.onlyUnlinked !== false,
              dryRun: Boolean(args.dryRun),
              source: args.source || "panel",
            }),
          );
        }
        case "unlinkEmployeeRoster": {
          return await withCompanyRefresh(async () =>
            unlinkEmployeeRoster({ employeeId: args.employeeId || args.id, source: args.source || "panel" }),
          );
        }
        // ---- v0.4 工作网看板：订单操作（面板直接驱动派工链路）----
        case "placeOrder": {
          const res = await dispatcher.placeOrder(args);
          if (res?.ok) scheduler.kick(0);
          return res;
        }
        case "routeOrder": {
          const res = await dispatcher.routeOrder(args.orderId);
          scheduler.kick(0);
          return res;
        }
        case "assignOrder": {
          // 带 employeeId = 手动指定；不带 = 交给调度器按路由规则挑人
          // 面板派活没有 agent 上下文，会话 id 由看板把当前 task 带进来：补写归属，
          // 让「在看板直接派活」的订单也跟随会话归档，而不是永远无主的全局单。
          if (args.sessionId) await dispatcher.stampSession(args.orderId, args.sessionId, args.sessionTitle);
          const res = await dispatcher.dispatchOrder(args.orderId, args.employeeId || null);
          if (!res?.ok && res?.code) scheduler.kick(0);
          return res;
        }
        case "borrowOrder": {
          const res = await dispatcher.borrow(args.orderId, args.employeeId || args.sharedEmployeeId);
          if (!res?.ok && res?.code) scheduler.kick(0);
          return res;
        }
        case "reviewOrder": {
          const res = await dispatcher.review({ orderId: args.orderId, pass: args.pass !== false });
          if (res?.state === "queued") scheduler.kick(0);
          return res;
        }
        case "cancelOrder": {
          return await dispatcher.cancelOrder(args.orderId);
        }
        case "escalateOrder": {
          return await dispatcher.escalate(args.orderId, args.reason || "");
        }
        case "hireTemp": {
          // 临时工：按次/按时到期自动退场（kind=temp）
          const id = args.id || makeOpId("temp");
          return await withCompanyRefresh(async () => {
            runtime.company = createEmployee(runtime.company, {
              id,
              displayName: args.displayName || id,
              kind: "temp",
              role: args.role || "staff",
              department: args.department || args.departmentId,
              skills: args.skills || [],
              title: args.title || "临时工",
              model: args.model,
              provider: args.provider,
              reasoningEffort: args.reasoningEffort,
              tempMaxTasks: args.tempMaxTasks,
              tempExpiresAt: args.tempExpiresAt,
            });
            await store.saveCompany(runtime.company);
            await store.appendAudit({ type: "temp_hired", employeeId: id, department: args.department || args.departmentId || null });
            return { ok: true, employeeId: id };
          });
        }
        case "releaseTemp": {
          return await withCompanyRefresh(async () => {
            runtime.company = updateEmployee(runtime.company, args.employeeId, { state: "retired" });
            await store.saveCompany(runtime.company);
            await store.appendAudit({ type: "temp_released", employeeId: args.employeeId, reason: "manual" });
            return { ok: true, employeeId: args.employeeId };
          });
        }
        case "runScheduler": {
          const res = await scheduler.tick();
          return { ok: true, ...res };
        }
        case "restartProgress": {
          // 与 runScheduler 等价，但在「异常」泳道空时作为显式入口：点一下立刻推进所有可派/可恢复的单。
          const tickRes = await scheduler.tick();
          return { ok: true, ...tickRes };
        }
        case "clearExceptionHistory": {
          // 清理已关闭的异常订单（cancelled / lost / failed），从活账本移除并写入审计。
          //
          // 0.5.2 修：这段以前调用了 runtime 作用域里根本不存在的 withLedger/persist/append，
          // 每次点击都抛 ReferenceError → 落进外层 catch 变成 {ok:false,E_INTERNAL}，
          // 账本一条没删，所以「异常状态永远清不掉」。现在直接用 store 的事务锁 + saveLedger。
          //
          // 口径：终态即异常历史，不再要求 failed 必须带 endedAt。老账本里存在
          // state=failed 但没有 endedAt 的单（手工改库/旧版本遗留），按旧口径既不算
          // 「活异常」也不算「已关闭异常」，于是永远卡在看板上——这才是真正的僵尸单。
          const scope = typeof args.sessionId === "string" ? args.sessionId.trim() : "";
          return await store.withLock(async () => {
            const loaded = await store.load();
            runtime.ledger = loaded.ledger || runtime.ledger;
            const keep = [];
            const removed = [];
            for (const o of runtime.ledger.orders || []) {
              const closed = o.state === "cancelled" || o.state === "lost" || o.state === "failed";
              // 指定会话时只清该会话的异常单：别的对话的失败单不该被这个对话一键清掉。
              // 无 sessionId 的老单视为「本机遗留」，跟随当前会话一起清 —— 否则它们永远
              // 停在看板上，正是用户反馈的「异常怎么都清不掉」。
              if (closed && (!scope || !o.sessionId || o.sessionId === scope)) {
                removed.push(o.id);
                continue;
              }
              keep.push(o);
            }
            runtime.ledger = { ...runtime.ledger, orders: keep };
            await store.saveLedger(runtime.ledger);
            await store.appendAudit({
              type: "exception_history_cleared",
              count: removed.length,
              orderIds: removed,
              sessionId: scope || null,
            });
            // 账本删掉的单不能再留在内存索引里，否则调度器还会拿孤儿 attempt 去唤醒员工。
            try { dispatcher.rebuildIndexFromLedger(); } catch { /* 索引重建失败不影响清理结果 */ }
            return { ok: true, count: removed.length, sessionId: scope || null };
          });
        }
        case "startScheduler": {
          scheduler.start();
          return { ok: true, running: typeof scheduler.isRunning === "function" ? scheduler.isRunning() : true };
        }
        case "stopScheduler": {
          scheduler.stop();
          return { ok: true, running: false };
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
      // docs/24 §5.4：预设注册表（只读；面板「套用流程预设」弹窗数据源）
      { method: "GET", path: "/company/presets", handler: () => view().presets },
      { method: "POST", path: "/company/op", handler: handleCompanyOp },
    ];
  }

  // v5.25：旧包升级迁移标记。scripts/migrate-old-plugin.mjs 切换插件后会写入
  // <dataDir>/pending-migration.json；新插件首次 boot 自动执行一次名册迁移：
  //   syncRoster（小组→部门、active 成员→员工）+ importRosterProfiles（岗位/职责/技能/模型补空）。
  // 成功或确认无可迁移数据后删除标记；失败保留标记并累计 attempts，3 次后改名为 .failed。
  async function runPendingMigration() {
    const markerPath = path.join(dataDir, PENDING_MIGRATION_FILE);
    let marker = null;
    try {
      marker = JSON.parse(await readFile(markerPath, "utf8"));
    } catch {
      return null;
    }
    if (!marker || typeof marker !== "object" || marker.version !== 1) {
      bootWarnings.push("pending-migration.json 版本不支持，已忽略");
      return null;
    }
    const source = typeof marker.source === "string" ? marker.source : "migrate-old-plugin";
    const attempts = Number(marker.attempts) || 0;
    const steps = [];
    const summarize = (r) => {
      const out = { ok: r?.ok === true, code: r?.code };
      if (r?.dryRun !== undefined) out.dryRun = Boolean(r.dryRun);
      if (r?.counts) out.counts = r.counts;
      for (const key of ["createdDepartments", "createdEmployees", "updatedEmployees", "wouldCreateDepartments", "wouldCreateEmployees", "wouldUpdateEmployees"]) {
        if (Array.isArray(r?.[key])) out[key] = r[key].length;
      }
      return out;
    };
    const run = async (action, args) => {
      const res = await handleCompanyOp(null, null, { action, args });
      steps.push({ action, dryRun: Boolean(args?.dryRun), result: summarize(res) });
      return res;
    };
    try {
      await store.appendAudit({ type: "company.migration_started", source });
      const syncDry = await run("syncRoster", { dryRun: true });
      if (!syncDry.ok && syncDry.code === "E_NO_REGISTRY") {
        await store.appendAudit({ type: "company.migration_skipped", source, reason: "registry.json 不存在" });
        await rm(markerPath, { force: true });
        return { ok: true, skipped: true, steps };
      }
      if (!syncDry.ok) {
        throw new Error(`syncRoster(dryRun) 失败: ${syncDry.code || "E_INTERNAL"}`);
      }
      const syncReal = await run("syncRoster", {});
      if (!syncReal.ok) throw new Error(`syncRoster 失败: ${syncReal.code || "E_INTERNAL"}`);
      const profilesDry = await run("importRosterProfiles", { dryRun: true });
      if (profilesDry.ok) {
        const profilesReal = await run("importRosterProfiles", {});
        if (!profilesReal.ok) throw new Error(`importRosterProfiles 失败: ${profilesReal.code || "E_INTERNAL"}`);
      }
      await store.appendAudit({ type: "company.migration_completed", source, steps });
      await rm(markerPath, { force: true });
      return { ok: true, steps };
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      bootWarnings.push(`名册迁移失败: ${message}`);
      const nextAttempts = attempts + 1;
      try {
        if (nextAttempts >= 3) {
          await writeFile(markerPath + ".failed", JSON.stringify({ ...marker, attempts: nextAttempts, error: message, failedAt: new Date().toISOString() }, null, 2), "utf8");
          await rm(markerPath, { force: true });
          await store.appendAudit({ type: "company.migration_failed", source, attempts: nextAttempts, message, gaveUp: true });
        } else {
          await writeFile(markerPath, JSON.stringify({ ...marker, attempts: nextAttempts, lastError: message, lastTriedAt: new Date().toISOString() }, null, 2), "utf8");
          await store.appendAudit({ type: "company.migration_failed", source, attempts: nextAttempts, message });
        }
      } catch (writeErr) {
        bootWarnings.push(`迁移标记更新失败: ${writeErr.message}`);
      }
      return { ok: false, steps };
    }
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
    // v5.12.2：历史数据里的旧通道显示名迁移（专业技术通道 → 技术通道）
    if (runtime.company.levels && runtime.company.levels.P && runtime.company.levels.P.label === "专业技术通道") {
      runtime.company = {
        ...runtime.company,
        levels: { ...runtime.company.levels, P: { ...runtime.company.levels.P, label: "技术通道" } },
      };
      try {
        await store.saveCompany(runtime.company);
        await store.appendAudit({ type: "company.levels_label_migrated", label: "技术通道" });
      } catch (err) {
        bootWarnings.push(`通道显示名迁移失败: ${err.message}`);
      }
    }
    // v5.11：等级通道显示名优先用 company.json 里的覆盖（面板可编辑），否则用配置/默认。
    const levels = runtime.company.levels
      ? normalizeLevelsOverride(runtime.company.levels, config.levels)
      : config.levels;
    runtime.company = runtime.company.levels ? { ...runtime.company, levels } : runtime.company;
    runtime.config.levels = levels;
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

    // v5.25：消费旧插件升级迁移标记（成功后会删除标记，故只生效一次）
    const migration = await runPendingMigration();

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

    // 冷启动恢复：running 的 attempt 都是上一进程的孤儿，判 stale 并把订单放回队列
    await recycleStaleAttempts(runtime, store, bootWarnings, dispatcher);

    await store.appendAudit({ type: "runtime.startup", ownerSessionId: runtime.ownerSessionId });

    scheduler.start();
    booted = true;
    return { ok: true, warnings: bootWarnings, migration };
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

    // 2. 不再 followup 一条假用户消息去「通知停工」。
    //    旧实现：对每个活子进程 followup(makeIdleMessage("shutdown"))。
    //    代价有两笔：① 内核 inbox 去重会抛 `message "undefined" is already pending`
    //    （消息没 id，Set 里已有 undefined）；② 这会把子代理唤醒成一个真 turn，
    //    随后 cancel 落在 step 边界 → 该 turn 没有 verdict → 落盘 `turn/end {reason:null}`，
    //    而 rc.3 的 subagentTiming 投影读 `event.data.reason.kind` 时直接崩，下次启动起不来。
    //    停工只需要：等它自己空闲（超时就算了）→ cancel，不再制造新 turn。
    const children = Array.from(employeeManager.sessions.values()).filter((s) => !s.endedAt);
    let cancelled = 0;

    // 3. await whenIdle (超时)
    await Promise.all(children.map((s) => whenIdleOrTimeout(s, 10000)));

    // 4. 逐个 cancel（带上明确的停机原因，让 turn/end 有合法 verdict）
    for (const s of children) {
      try {
        if (s.handle && typeof s.handle.cancel === "function") {
          await Promise.resolve(s.handle.cancel("shutdown", { keepInbox: true })).catch(() => {});
          cancelled += 1;
        }
      } catch (err) {
        logger?.warn?.(`cancel 失败: ${err.message}`);
      }
    }
    if (children.length > 0) {
      logger?.info?.(`[company] 停工：${children.length} 个活子进程，cancel ${cancelled} 个`);
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

  /* ------------------------------------------------------------------ */
  /* v0.3.2 · 公司员工 ↔ 名册关联                                         */
  /* ------------------------------------------------------------------ */

  // 名册桥由宿主注入：company runtime 先于 TeamService 构造（lib/index.js 装配顺序），
  // 所以这里只持有惰性函数，调用时才解析；名册读不到时返回 null，绝不抛给面板。
  const rosterBridge = roster && typeof roster === "object" ? roster : null;

  /** 名册成员数组；null = 读不到名册（不能把「读不到」当成「全都未登记」）。 */
  function readRosterMembers() {
    if (!rosterBridge || typeof rosterBridge.members !== "function") return null;
    try {
      const list = rosterBridge.members();
      return Array.isArray(list) ? list : null;
    } catch {
      return null;
    }
  }

  /** 名册写服务（TeamService，需要 linkProfiles）；null = 不可用。 */
  function readRosterService() {
    if (!rosterBridge || typeof rosterBridge.service !== "function") return null;
    try {
      const service = rosterBridge.service();
      return service && typeof service.linkProfiles === "function" ? service : null;
    } catch {
      return null;
    }
  }

  function rosterIndexOrNull() {
    const members = readRosterMembers();
    return members ? buildRosterIndex(members) : null;
  }

  function departmentOfEmployee(employee) {
    return (runtime.company.departments || []).find((d) => d.id === employee?.department) || null;
  }

  /**
   * 公司员工登记/回填进名册（「公司→名册」唯一写入口）。
   *
   * 规则（沿用 docs/15 §17–20 的「绝不覆盖」原则）：
   *  - 名册没有该 target → 新建成员（displayName/title/duties/skills/model/provider/note 来自公司档案）
   *  - 名册已有 → 只补空字段；refresh=true 才用公司档案覆盖档案字段
   *  - 显式 target（args.target）只允许单员工场景，避免批量时把一个 target 套给多人
   * @param {{employeeIds?: string[]|null, departmentId?: string|null, explicitTarget?: string|null, refresh?: boolean, onlyUnlinked?: boolean, dryRun?: boolean, source?: string}} options
   */
  async function applyRosterLinks(options = {}) {
    const svc = readRosterService();
    if (!svc) return { ok: false, code: "E_NO_ROSTER", message: "名册服务不可用：宿主未注入 TeamService" };
    const index = rosterIndexOrNull();
    if (!index) return { ok: false, code: "E_NO_ROSTER", message: "读不到名册（registry.json）" };
    const { employeeIds = null, departmentId = null, explicitTarget = null, refresh = false, onlyUnlinked = true, dryRun = false, source = "company" } = options;
    const idSet = Array.isArray(employeeIds) && employeeIds.length ? new Set(employeeIds.map((id) => String(id))) : null;
    const employees = (runtime.company.employees || []).filter((e) => {
      if (idSet && !idSet.has(String(e.id))) return false;
      if (departmentId != null && String(departmentId) !== "" && String(e.department || "") !== String(departmentId)) return false;
      return true;
    });
    if (employees.length === 0) return { ok: false, code: "E_NOT_FOUND", message: "没有匹配的员工" };
    const single = employees.length === 1;
    const explicit = typeof explicitTarget === "string" ? explicitTarget.trim() : "";
    if (explicit && !single) {
      return { ok: false, code: "E_INVALID_INPUT", message: "显式 target 只能在单员工时使用（批量请用各员工的 id / rosterTarget）" };
    }
    if (explicit && !isValidMemberName(explicit)) {
      return { ok: false, code: "E_INVALID_TARGET", message: `名册成员名不合法：${explicit}（小写字母/数字/连字符，1-64 位）` };
    }
    const plans = [];
    for (const employee of employees) {
      const target = explicit || rosterTargetOf(employee);
      if (!isValidMemberName(target)) {
        return { ok: false, code: "E_INVALID_TARGET", message: `员工 ${employee.id} 的关联名不合法：${target}` };
      }
      const profile = buildRosterProfile(employee, { department: departmentOfEmployee(employee) });
      profile.target = target;
      const member = index.get(target);
      if (!member) {
        plans.push({ employee, target, action: "create", profile });
        continue;
      }
      // 不做档案回填时（批量「只登记未关联」语义）跳过已有成员
      if (onlyUnlinked) continue;
      const plan = planRosterLink(member, profile, { refresh: Boolean(refresh) });
      if (plan.action === "noop") continue;
      plans.push({ employee, target, action: "update", profile });
    }
    // 显式 target 与员工 id 不同时才落 rosterTarget 字段；否则保持隐式约定、不留冗余字段
    const linkUpdates = [];
    for (const plan of plans) {
      const explicitForEmployee = explicit && explicit !== plan.employee.id ? explicit : "";
      if (explicitForEmployee && plan.employee.rosterTarget !== explicitForEmployee) {
        linkUpdates.push([plan.employee.id, explicitForEmployee]);
      } else if (!explicitForEmployee && plan.employee.rosterTarget) {
        linkUpdates.push([plan.employee.id, ""]);
      }
    }
    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        total: employees.length,
        results: plans.map((p) => ({ employeeId: p.employee.id, target: p.target, action: p.action, profile: p.profile })),
      };
    }
    if (plans.length === 0 && linkUpdates.length === 0) {
      return { ok: true, total: employees.length, linked: 0, skipped: employees.length, results: [], message: "全部已关联，无需写入" };
    }
    let registryResult = { ok: true, data: { results: [] } };
    if (plans.length > 0) {
      registryResult = svc.linkProfiles(plans.map((p) => ({ profile: p.profile, refresh: Boolean(refresh), create: true })));
      if (!registryResult.ok) return registryResult;
    }
    if (linkUpdates.length > 0) {
      let next = runtime.company;
      for (const [employeeId, value] of linkUpdates) next = updateEmployee(next, employeeId, { rosterTarget: value });
      runtime.company = next;
      await store.saveCompany(runtime.company);
    }
    const results = registryResult.data.results || [];
    const created = results.filter((r) => r.action === "create").length;
    const updated = results.filter((r) => r.action === "update").length;
    if (plans.length > 0 || linkUpdates.length > 0) {
      await store.appendAudit({
        type: "roster.employees_linked",
        count: plans.length,
        created,
        updated,
        employeeIds: plans.map((p) => p.employee.id),
        source,
      });
    }
    return { ok: true, total: employees.length, linked: plans.length, created, updated, results };
  }

  /**
   * 解除员工的显式名册关联（隐式关联：员工 id 即 target，返回 cleared:false）。
   * 调用方必须已持有公司锁并完成 refresh —— 本函数不再自己加锁（文件锁不可重入）。
   */
  async function unlinkEmployeeRoster(options = {}) {
    const employeeId = options.employeeId;
    const target = String(employeeId == null ? "" : employeeId).trim();
    if (!target) return { ok: false, code: "E_INVALID_INPUT", message: "employeeId 必填" };
    const employee = (runtime.company.employees || []).find((e) => String(e.id) === target);
    if (!employee) return { ok: false, code: "E_NOT_FOUND", message: `员工 ${target} 不存在` };
    const explicit = typeof employee.rosterTarget === "string" ? employee.rosterTarget.trim() : "";
    if (!explicit) {
      return {
        ok: true,
        employeeId: employee.id,
        cleared: false,
        message: "该员工使用隐式关联（员工 id 即名册 target），无需解除；如需删除名册条目请用 member 工具",
      };
    }
    runtime.company = updateEmployee(runtime.company, employee.id, { rosterTarget: "" });
    await store.saveCompany(runtime.company);
    await store.appendAudit({ type: "roster.employee_unlinked", employeeId: employee.id, target: explicit, source: options.source || "company" });
    return { ok: true, employeeId: employee.id, cleared: true, target: explicit };
  }

  /** 自动登记名册的开关（配置 company.autoLinkRoster，默认开）。 */
  function autoLinkEnabled() {
    return runtime.config.autoLinkRoster !== false;
  }

  /** 某部门当前全部员工 id（新建部门后自动登记用；新部门此时通常还没有员工）。 */
  function employeeIdsOfDepartment(departmentId) {
    const dept = String(departmentId == null ? "" : departmentId).trim();
    if (!dept) return [];
    return (runtime.company.employees || [])
      .filter((e) => String(e.department || "") === dept)
      .map((e) => e.id);
  }

  /**
   * v0.3.3：创建员工/创建部门后自动把员工登记进名册（best-effort）。
   * 名册不可用、写入失败都只回 { ok:false, code }，绝不让创建动作失败 —— 名册是覆盖层，
   * 不能反向卡住公司（此时面板仍显示「未登记」，可手动点「登记到名册」补齐）。
   * 调用方必须已持有公司锁并完成 refresh（文件锁不可重入）。
   */
  async function autoLinkRosterFor(employeeIds, source) {
    const ids = (Array.isArray(employeeIds) ? employeeIds : [employeeIds])
      .map((id) => String(id == null ? "" : id).trim())
      .filter(Boolean);
    if (ids.length === 0) return { ok: true, attempted: 0, created: 0, updated: 0 };
    if (!autoLinkEnabled()) {
      return { ok: true, disabled: true, attempted: ids.length, created: 0, updated: 0 };
    }
    try {
      const res = await applyRosterLinks({ employeeIds: ids, onlyUnlinked: true, source });
      if (!res || res.ok === false) {
        return {
          ok: false,
          code: (res && res.code) || "E_AUTO_LINK_FAILED",
          attempted: ids.length,
          created: 0,
          updated: 0,
          message: (res && res.message) || "自动登记名册失败",
        };
      }
      return {
        ok: true,
        attempted: ids.length,
        created: res.created || 0,
        updated: res.updated || 0,
        linked: res.linked || 0,
      };
    } catch (err) {
      return {
        ok: false,
        code: "E_AUTO_LINK_FAILED",
        attempted: ids.length,
        created: 0,
        updated: 0,
        message: err?.message ?? String(err),
      };
    }
  }

  function view() {
    const deptMap = new Map((runtime.company.departments || []).map((d) => [d.id, d]));
    // v0.3.2：名册关联状态（名册读不到时逐员工 roster=null，汇总 available=false）
    const rosterIndex = rosterIndexOrNull();
    const employees = (runtime.company.employees || []).map((e) => {
      const dept = deptMap.get(e.department);
      const levelInfo = describeEmployeeLevel(e, runtime.config.levels);
      return {
        ...e,
        departmentCode: dept?.code ?? null,
        levelName: levelInfo.levelName,
        channels: describeEmployeeChannels(e, runtime.config.levels),
        roster: rosterIndex ? describeRosterLink(e, rosterIndex) : null,
      };
    });
    const rosterSummary = rosterIndex
      ? summarizeRosterLinks(runtime.company.employees, rosterIndex)
      : { available: false, total: employees.length, linked: 0, retired: 0, unlinked: 0 };
    const departments = (runtime.company.departments || []).map((d) => {
      const manager = employees.find((e) => e.department === d.id && e.role === EMPLOYEE_ROLE.MANAGER);
      return {
        ...d,
        employeeCount: employees.filter((e) => e.department === d.id).length,
        managerId: manager?.id ?? null,
        // docs/24 §5.1：每个部门附带已解析的流程预设（无预设/未知预设 → null）。
        preset: resolveDepartmentPreset(d, employees.filter((e) => e.department === d.id)),
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
        // 用 numeric 比较：部门/员工编号与等级代号出现两位数（D10、E0010、M10）时字典序会错。
        const NUM = { numeric: true };
        if (codeA !== codeB) return String(codeA).localeCompare(String(codeB), undefined, NUM);
        const mA = a.channels.find((c) => c.channel === "M")?.level ?? "";
        const mB = b.channels.find((c) => c.channel === "M")?.level ?? "";
        if (mA !== mB) return String(mB).localeCompare(String(mA), undefined, NUM);
        const codeEmpA = a.code ?? "";
        const codeEmpB = b.code ?? "";
        return String(codeEmpA).localeCompare(String(codeEmpB), undefined, NUM);
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

    const liveAttempts = listLiveAttempts(runtime.ledger);
    const orderRows = runtime.ledger.orders || [];
    const byState = {};
    for (const o of orderRows) byState[o.state] = (byState[o.state] || 0) + 1;
    // 派工健康度：面板顶部要能一眼看出「为什么没有任务在跑」
    const routeErrors = orderRows
      .filter((o) => o.routeError && (o.state === ORDER_STATES.QUEUED || o.state === ORDER_STATES.ROUTED))
      .map((o) => ({ orderId: o.id, subject: o.subject, state: o.state, reason: o.routeError, at: o.routeErrorAt || null, retryAfter: o.retryAfter || null }));

    return {
      enabled: config.enabled,
      status: booted ? "running" : "stopped",
      warnings: bootWarnings,
      // docs/24 §5.1：预设注册表摘要（供面板列出可套用预设），不在每个部门里重复嵌入。
      presets: listPresets(),
      org: { departments, employees },
      // v0.3.2：员工中心页头「名册：已关联 x / 未登记 y」
      roster: rosterSummary,
      companyName: runtime.company.companyName || COMPANY_NAME_DEFAULT,
      management: {
        channel: "M",
        name: runtime.company.managementName || MANAGEMENT_NAME_DEFAULT,
        employees: managementEmployees,
      },
      board: {
        orders: orderRows.length,
        done: orderRows.filter((o) => o.state === "done").length,
        running: liveAttempts.length,
        byState,
      },
      // v0.4：正在跑的 attempt（工作网任务泳道 + 成员卡状态都靠它）
      attempts: liveAttempts.map((a) => ({
        attemptId: a.id,
        attemptNo: a.attemptNo ?? null,
        orderId: a.orderId,
        employee: a.employee,
        sessionId: a.sessionId ?? null,
        startedAt: a.startedAt ?? null,
        lastSeenAt: a.lastSeenAt ?? null,
        orderState: a.orderState ?? null,
      })),
      health: {
        status: booted ? "running" : "stopped",
        scheduler: {
          running: Boolean(runtime.scheduler?.isRunning?.()),
          intervalMs: runtime.scheduler?.intervalMs?.() ?? config.limits.schedulerIntervalMs,
        },
        pending: {
          queued: byState[ORDER_STATES.QUEUED] || 0,
          routed: byState[ORDER_STATES.ROUTED] || 0,
          running: byState[ORDER_STATES.RUNNING] || 0,
        },
        routeErrors,
        capacity: departments.map((d) => ({
          deptId: d.id,
          code: d.code,
          name: d.name,
          capacity: d.capacity ?? null,
          busy: liveAttempts.filter((a) => employees.find((e) => e.id === a.employee)?.department === d.id).length,
          idle: employees.filter((e) => e.department === d.id && e.state === EMPLOYEE_STATE.IDLE).length,
        })),
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

async function recycleStaleAttempts(runtime, store, warnings, dispatcher = null) {
  // 统一走 dispatcher.hydrate：把 running 孤儿 attempt 判 stale（带 reason），
  // 订单经 failed 回到 queued，并重建内存里的 attempt 索引。
  if (dispatcher && typeof dispatcher.hydrate === "function") {
    try {
      const res = await dispatcher.hydrate({ recoverOrphans: true });
      if (res?.recovered?.length) {
        warnings.push(`回收 ${res.recovered.length} 条搁浅订单`);
      }
      if (res?.orphaned?.length) {
        warnings.push(`回收 ${res.orphaned.length} 条终态订单下的孤儿 attempt`);
      }
      return res;
    } catch (err) {
      warnings.push(`回收 stale attempts 失败: ${err.message}`);
      return null;
    }
  }
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
