/**
 * company-employees.mjs
 * 员工/会话生命周期：resident/per_task 策略、幂等键、互斥、行隔离。
 */

import { EMPLOYEE_ROLE, EMPLOYEE_STATE, SESSION_POLICY, describeEmployeeLevel, describeEmployeeChannels, LEVEL_CHANNEL } from "../shared/company-org.mjs";
import { guardTools, LINE_TOOLS, TOOL_LINES, SOURCE_KIND, normalizeUsage } from "./company-compat.mjs";

export function createEmployeeSessionManager({ runtime, logger }) {
  const sessions = new Map();
  const trackedAgents = new WeakSet();
  const errorTracked = new Set();
  let seq = 0;

  function allowedLine(role) {
    if (role === EMPLOYEE_ROLE.MANAGER) return TOOL_LINES.MANAGER;
    if (role === EMPLOYEE_ROLE.WINDOW) return TOOL_LINES.WINDOW;
    return TOOL_LINES.STAFF;
  }

  function buildAgentOptions(employee) {
    const options = {};
    if (employee.provider && employee.model) {
      options.provider = employee.provider;
      options.model = employee.model;
    }
    // 参照 agent-teams：同一模型路由下再压一档推理强度；未配置则由宿主取默认。
    if (employee.reasoningEffort) options.reasoningEffort = employee.reasoningEffort;
    return Object.keys(options).length ? options : undefined;
  }

  /** 工具黑名单连宿主标准工具一起管：deny 命中的名字一律拒，deny 优先于岗位白名单。 */
  function deniedBy(employee, name) {
    const list = employee?.toolPolicy?.deny;
    if (!Array.isArray(list) || list.length === 0) return false;
    return list.includes(name) || list.includes("*");
  }

  function setupAgentContext(agent, line, employee) {
    if (!agent || !agent.ctx) return;
    const allowed = LINE_TOOLS[line] || [];
    // 行隔离只约束公司化工具（company_*）：员工仍保有宿主标准工具（读写文件 / bash 等）才能完成真实工作。
    try {
      guardTools(agent.ctx, (exec) => {
        const name = exec?.tool?.name || exec?.name;
        if (!name) return undefined;
        if (deniedBy(employee, name)) return `E_TOOL_POLICY: ${name} 在该成员的工具黑名单中`;
        if (!String(name).startsWith("company_")) return undefined;
        const sid = exec?.agent?.session?.id;
        const tools = runtime.sessionTools;
        if (!sid || !tools) return "无法识别会话身份";
        const set = tools.get(sid);
        if (!set) return "会话未登记";
        if (!set.has(name)) return "E_TOOL_LINE: 该工具不在当前岗位白名单中";
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
    // 只在「真的有过会话 id」时才 resume：以前用 `resident-${employee.id}` 兜底，
    // 那是个从不存在的合成 id，每次冷启动必然抛 `session "resident-xxx" not found`，
    // 白白多一次失败唤醒（还会在 subagent 投影里制造无 verdict 的 turn 边界）。
    if (employee.sessionPolicy === SESSION_POLICY.RESIDENT && existing?.sessionId && agents && typeof agents.resume === "function") {
      const resumeSessionId = existing.sessionId;
      try {
        const agentOptions = buildAgentOptions(employee);
        const resumeArgs = { resumeSessionId, parentAgent: parentAgent?.agent || parentAgent, cwd };
        if (agentOptions) resumeArgs.agentOptions = agentOptions;
        const resumed = await agents.resume(resumeArgs);
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
        const agentOptions = buildAgentOptions(employee);
        const request = { parent: parentAgent, prompt: [{ type: "text", text: buildPromptFor(employee, orderId, runtime) }], cwd };
        if (agentOptions) request.agentOptions = agentOptions;
        result = await subagents.startActivation({
          provider,
          label: `company-${employee.role}-${employee.id}`,
          request,
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

      // 同步从 agents 服务取已发布的 agent 对象（可能是 Promise，必须 await，否则 guard/用量全部挂不上）
      if (agents && typeof agents.get === "function") {
        try {
          agent = await agents.get(sessionId);
        } catch (err) {
          logger?.warn?.(`agents.get 失败: ${err.message}`);
        }
      }
      if (!agent) {
        agent = { id: sessionId, session: { id: sessionId }, followup: () => {} };
      }
    }

    if (agent?.ctx) setupAgentContext(agent, allowedLine(employee.role), employee);
    attachUsage(agent, employee, orderId);

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

  function attachUsage(agent, employee, orderId) {
    if (!agent || !agent.ctx || typeof agent.ctx.on !== "function") return false;
    if (trackedAgents.has(agent)) return true;
    trackedAgents.add(agent);
    if (!errorTracked.has(agent.session?.id)) {
      errorTracked.add(agent.session?.id);
      agent.ctx.on("agent/error", (payload) => {
        const message = payload?.error?.message || String(payload?.error || "");
        runtime.lastAgentError = message;
        logger?.warn?.(`employee agent/error (${employee.id}): ${message}`);
      });
    }
    // assistant/message 是「会话事件」，不是 agent 级触发事件；必须监听 session/event。
    agent.ctx.on("session/event", (session, event) => {
      if (!event || event.type !== "assistant/message") return;
      if (session && agent.session && session !== agent.session) return;
      const usage = event.data?.usage;
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
    return true;
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
      if (agent && attachUsage(agent, employee, orderId)) {
        clearInterval(timer);
        return;
      }
      // 子会话可能正在物化，最多等 5 秒
      if (tries >= 50) clearInterval(timer);
    }, 100);
    if (typeof timer.unref === "function") timer.unref();
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

export function buildPromptFor(employee, orderId, runtime) {
  const isManager = employee.role === EMPLOYEE_ROLE.MANAGER;
  const isWindow = employee.role === EMPLOYEE_ROLE.WINDOW;
  const roleName = isManager ? "经理" : isWindow ? "窗口" : "员工";
  const line = isManager ? TOOL_LINES.MANAGER : isWindow ? TOOL_LINES.WINDOW : TOOL_LINES.STAFF;
  // 白名单只约束公司化工具（company_*）：宿主标准工具（读写文件、bash、子代理等）照常可用。
  // 文案必须写清这一点，否则员工会误判自己「没有文件与 shell 能力」而直接求助停工
  // ——历史上已经发生过三次（E0001 / E0023 / E0017），每次都是读了这段提示就不敢动手。
  const toolList = [
    `本角色白名单（只约束公司化工具 company_*，越权调用会被拒绝）：${(LINE_TOOLS[line] || []).join("、")}`,
    "宿主标准工具（文件读写、命令执行、子代理等）不在上述白名单之内，照常可用；只有你自己的工具黑名单（toolPolicy.deny）会禁掉某个具体名字。",
  ].join("\n- ");
  const dept = runtime.company?.departments?.find((d) => d.id === employee.department);
  const channelDescs = describeEmployeeChannels(employee, runtime.config?.levels);
  const primaryCh = channelDescs.find((c) => c.primary);
  const sortedDescs = channelDescs.sort((a, b) => {
    // 主通道在前
    if (a.primary !== b.primary) return a.primary ? -1 : 1;
    return (a.channel === b.channel ? 0 : a.channel.localeCompare(b.channel));
  });
  const identityLine = `工号：${employee.code || ""} · 等级：${sortedDescs.map((c) => `${c.level}（${c.levelName}，${c.channel}）`).join("、")} · 部门：${dept?.name || "未分配"}（${dept?.code || "-"}）`;
  // 雇佣类型 / 推理强度 / 派生方式：都写进身份区块，成员自己知道自己是临时工还是正式工。
  const kindText = employee.kind === "temp" ? "临时工（按任务计次，任务上限到达后自动退场）" : employee.kind === "shared" ? "共享池成员（按需借调）" : "正式员工";
  const attrs = [`雇佣类型：${kindText}`];
  if (employee.reasoningEffort) attrs.push(`推理强度：${employee.reasoningEffort}`);
  if (employee.memberProvider) attrs.push(`派生方式：${employee.memberProvider}`);
  if (Number.isFinite(Number(employee.maxDepth)) && Number(employee.maxDepth) === 0) attrs.push("子代理：不得开启");
  const deny = Array.isArray(employee.toolPolicy?.deny) ? employee.toolPolicy.deny.filter(Boolean) : [];
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

${identityLine}

  你是公司运行时的 ${roleName}（${employee.displayName || employee.id}）。

${attrs.map((a) => `- ${a}`).join("\n")}

## 核心职责
${duties.join("\n")}

## 可使用的工具
- ${toolList}
${deny.length ? `- 公司已对你禁用：${deny.join("、")}（调用会被拒绝）` : ""}

## 成本约定
- 记录本次 attempt 的预估/实际 token 消耗。
- 完成后在 summary 中简要说明耗时与阻塞点。${orderHint}`;
}
