/**
 * company-employees.mjs
 * 员工/会话生命周期：resident/per_task 策略、幂等键、互斥、行隔离。
 */

import { EMPLOYEE_ROLE, EMPLOYEE_STATE, SESSION_POLICY } from "../shared/company-org.mjs";
import { restrictTools, guardTools, LINE_TOOLS, TOOL_LINES, SOURCE_KIND, normalizeUsage } from "./company-compat.mjs";

export function createEmployeeSessionManager({ runtime, logger }) {
  const sessions = new Map();
  const trackedAgents = new WeakSet();
  let seq = 0;

  function allowedLine(role) {
    if (role === EMPLOYEE_ROLE.MANAGER) return TOOL_LINES.MANAGER;
    if (role === EMPLOYEE_ROLE.WINDOW) return TOOL_LINES.WINDOW;
    return TOOL_LINES.STAFF;
  }

  function setupAgentContext(agent, line) {
    if (!agent || !agent.ctx) return;
    const allowed = LINE_TOOLS[line] || [];
    try {
      restrictTools(agent.ctx, allowed);
    } catch (err) {
      logger?.warn?.(`restrict 失败: ${err.message}`);
    }
    try {
      guardTools(agent.ctx, (exec) => {
        const sid = exec?.agent?.session?.id;
        const tools = runtime.sessionTools;
        if (!sid || !tools) return "无法识别会话身份";
        const set = tools.get(sid);
        if (!set) return "会话未登记";
        const name = exec?.tool?.name || exec?.name;
        if (!name || !set.has(name)) return "E_TOOL_LINE: 该工具不在当前岗位白名单中";
        return undefined;
      });
    } catch (err) {
      logger?.warn?.(`guard 失败: ${err.message}`);
    }
    runtime.sessionTools.set(agent.session.id, new Set(allowed));
  }

  async function ensureSession({ employee, parentAgent, provider, config, cwd, orderId }) {
    const existing = sessions.get(employee.id);

    // resident 且已存在未结束会话 → 复用
    if (existing && !existing.endedAt && employee.sessionPolicy === SESSION_POLICY.RESIDENT) {
      return existing;
    }

    // per_task 且有旧会话 → 先结束（I12）
    if (existing && employee.sessionPolicy === SESSION_POLICY.PER_TASK) {
      end(employee.id, true);
    }

    const agents = runtime.ctx.get("agents");
    const subagents = runtime.ctx.get("subagents");
    if (!subagents || typeof subagents.startActivation !== "function") {
      throw new Error("E_NO_AGENTS");
    }

    let agent = null;
    let handle = null;
    let sessionId = null;

    // resident 优先 resume；resume 失败则新建
    if (employee.sessionPolicy === SESSION_POLICY.RESIDENT && agents && typeof agents.resume === "function") {
      const resumeSessionId = existing?.sessionId || `resident-${employee.id}`;
      try {
        const resumed = await agents.resume({ resumeSessionId, parentAgent: parentAgent?.agent || parentAgent, cwd });
        if (resumed?.agent) {
          agent = resumed.agent;
          handle = resumed;
          sessionId = agent.session?.id || resumeSessionId;
        }
      } catch (err) {
        logger?.warn?.(`resume 失败，将新建: ${err.message}`);
        agent = null;
      }
    }

    // 新建会话
    if (!agent) {
      const delivery = employee.sessionPolicy === SESSION_POLICY.PER_TASK ? "caller" : "parent";
      const childId = employee.sessionPolicy === SESSION_POLICY.PER_TASK
        ? `emp-${employee.id}-${Date.now()}-${++seq}`
        : `resident-${employee.id}`;

      // startActivation 的 spec.signal 是必填（内部会 signal.throwIfAborted()）；
      // 每个会话持有一个 AbortController，end()/shutdown 时中止未建立的激活。
      const controller = new AbortController();
      let result;
      try {
        result = await subagents.startActivation({
          provider,
          label: `company-${employee.role}-${employee.id}`,
          request: { parent: parentAgent, prompt: [{ type: "text", text: buildPromptFor(employee, config, orderId) }], cwd },
          delivery,
          signal: controller.signal,
        });
        handle = result;
        sessionId = result?.childId || result?.sessionId || childId;
        if (sessionId && runtime.sessionAborts) runtime.sessionAborts.set(sessionId, controller);
      } catch (err) {
        controller.abort();
        throw err;
      }

      // 同步从 agents 服务取已发布的 agent 对象
      if (agents && typeof agents.get === "function") {
        try {
          agent = agents.get(sessionId);
        } catch (err) {
          logger?.warn?.(`agents.get 失败: ${err.message}`);
        }
      }
      if (!agent) {
        agent = { id: sessionId, session: { id: sessionId }, followup: () => {} };
      }
    }

    if (agent?.ctx) setupAgentContext(agent, allowedLine(employee.role));

    const session = {
      employeeId: employee.id,
      sessionId,
      handle: agent,
      startedAt: new Date().toISOString(),
    };
    sessions.set(employee.id, session);
    trackChildUsage(sessionId, employee, orderId);
    return session;
  }

  function trackChildUsage(sessionId, employee, orderId) {
    if (!runtime?.costs) return;
    const agents = runtime.ctx.get("agents");
    if (!agents || typeof agents.get !== "function") return;
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      let agent = null;
      try {
        agent = agents.get(sessionId);
      } catch {}
      if (agent && agent.ctx && typeof agent.ctx.on === "function") {
        clearInterval(timer);
        if (trackedAgents.has(agent)) return;
        trackedAgents.add(agent);
        agent.ctx.on("assistant/message", (payload) => {
          const usage = payload?.usage || payload?.payload?.usage;
          if (!usage) return;
          const n = normalizeUsage(usage);
          runtime.costs.tokens += n.totalTokens;
          runtime.costs.requests += 1;
          runtime.costs.byEmployee[employee.id] = runtime.costs.byEmployee[employee.id] || { tokens: 0, requests: 0 };
          runtime.costs.byEmployee[employee.id].tokens += n.totalTokens;
          runtime.costs.byEmployee[employee.id].requests += 1;
          if (employee.department) {
            runtime.costs.byDepartment[employee.department] = runtime.costs.byDepartment[employee.department] || { tokens: 0, requests: 0 };
            runtime.costs.byDepartment[employee.department].tokens += n.totalTokens;
            runtime.costs.byDepartment[employee.department].requests += 1;
          }
          if (orderId) {
            runtime.costs.byOrder[orderId] = runtime.costs.byOrder[orderId] || { tokens: 0, requests: 0 };
            runtime.costs.byOrder[orderId].tokens += n.totalTokens;
            runtime.costs.byOrder[orderId].requests += 1;
          }
        });
      }
      if (tries >= 20) clearInterval(timer);
    }, 100);
  }

  function get(employeeId) {
    return sessions.get(employeeId) || null;
  }

  async function end(employeeId, keepInbox = true) {
    const s = sessions.get(employeeId);
    if (!s) return;
    s.endedAt = new Date().toISOString();
    try {
      if (s.handle && typeof s.handle.cancel === "function") await Promise.resolve(s.handle.cancel("shutdown", { keepInbox })).catch(() => {});
      if (s.handle && typeof s.handle.dispose === "function") await Promise.resolve(s.handle.dispose()).catch(() => {});
    } catch (err) {
      logger?.warn?.(`dispose 会话失败: ${err.message}`);
    }
    if (s.sessionId && runtime.sessionTools) runtime.sessionTools.delete(s.sessionId);
    if (s.sessionId && runtime.sessionAborts) {
      try { runtime.sessionAborts.get(s.sessionId)?.abort(); } catch { /* 已中止 */ }
      runtime.sessionAborts.delete(s.sessionId);
    }
    sessions.delete(employeeId);
  }

  async function endAll() {
    await Promise.all(Array.from(sessions.keys()).map((id) => end(id)));
  }

  return {
    sessions,
    ensureSession,
    get,
    end,
    endAll,
  };
}

function buildPromptFor(employee, config, orderId) {
  const isManager = employee.role === EMPLOYEE_ROLE.MANAGER;
  const isWindow = employee.role === EMPLOYEE_ROLE.WINDOW;
  const roleName = isManager ? "经理" : isWindow ? "窗口" : "员工";
  const line = isManager ? TOOL_LINES.MANAGER : isWindow ? TOOL_LINES.WINDOW : TOOL_LINES.STAFF;
  const toolList = `本角色白名单（越权调用会被拒绝）：${(LINE_TOOLS[line] || []).join("、")}`;
  const duties = isWindow
    ? [
        "- 你负责接单、查询进度与催办：company_order / company_status / company_ask / company_cancel。",
        "- 你不接派工、不验收；工单状态与结果查询用 company_status。",
      ]
    : [
        "- 收到派单后，先调用 company_accept 确认接单。",
        "- 任务完成后，必须立即调用 company_report 回报结果。",
        "- 每个 company_report 必须携带 attemptId，不要遗漏。",
      ];
  if (isManager) {
    duties.push("- 你负责派工（company_assign）、验收（company_review）、借调（company_borrow）与升级（company_escalate）。");
  }
  duties.push("- 你无权 fork 子代理或指派其他员工。");


  const orderHint = orderId
    ? `

## 当前派工
- 工单：${orderId}。请**立即**调用 company_status 查看该工单详情与 attempts[0].id，然后开工；完成后调用 company_report（attemptId 必填）。`
    : "";

  return `# 公司运行时 ${roleName}

你是公司运行时的 ${roleName}（${employee.displayName || employee.id}）。

## 核心职责
${duties.join("\n")}

## 可使用的工具
- ${toolList}

## 成本约定
- 记录本次 attempt 的预估/实际 token 消耗。
- 完成后在 summary 中简要说明耗时与阻塞点。${orderHint}`;
}
