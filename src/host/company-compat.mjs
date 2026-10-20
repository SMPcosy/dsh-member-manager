/**
 * company-compat.mjs
 * 宿主能力探测、版本兼容、wake/resume 封装、normalizeUsage、fake 服务。
 */

export const SOURCE_KIND = "company-runtime";

export const TOOL_LINES = {
  MANAGER: "manager",
  STAFF: "staff",
  WINDOW: "window",
  OWNER: "owner",
};

export const LINE_TOOLS = {
  [TOOL_LINES.OWNER]: [
    "company_order", "company_status", "company_ask", "company_cancel",
    "company_assign", "company_review", "company_borrow", "company_report",
    "company_escalate", "company_accept", "company_ask_help",
    "company_hire", "company_admin",
  ],
  [TOOL_LINES.MANAGER]: [
    "company_order", "company_status", "company_ask", "company_cancel",
    "company_assign", "company_review", "company_borrow", "company_report",
    "company_escalate", "company_accept", "company_ask_help",
  ],
  [TOOL_LINES.STAFF]: [
    "company_report", "company_accept", "company_ask_help",
    "company_status", "company_ask",
  ],
  [TOOL_LINES.WINDOW]: [
    "company_order", "company_status", "company_ask", "company_cancel",
  ],
};

/**
 * 安全读取 ctx 上的属性。
 * cordis 的 ctx 是 Proxy：访问未 inject 的服务属性会直接 throw（真实故障根因）。
 * 这里所有探测都必须经 try/catch，绝不把异常漏给 apply()。
 */
export function safeCtxProp(ctx, name, fallback = undefined) {
  try {
    return ctx?.[name] ?? fallback;
  } catch {
    return fallback;
  }
}

export function safeCtxGet(ctx, name, fallback = undefined) {
  try {
    return ctx?.get(name);
  } catch {
    return fallback;
  }
}

export function detectCap(ctx) {
  const hasGet = typeof safeCtxProp(ctx, "get") === "function";
  return {
    hasAgents: hasGet ? Boolean(safeCtxGet(ctx, "agents")) : false,
    hasSubagents: hasGet ? Boolean(safeCtxGet(ctx, "subagents")) : false,
    hasTools: hasGet ? Boolean(safeCtxGet(ctx, "tools")) : false,
    hasLLM: hasGet ? Boolean(safeCtxGet(ctx, "llm")) : false,
    hasSystemPrompt: hasGet ? Boolean(safeCtxGet(ctx, "systemPrompt")) : false,
    hasWebServer: hasGet ? Boolean(safeCtxGet(ctx, "webServer")) : false,
    hasEffect: typeof safeCtxProp(ctx, "effect") === "function",
    hasOn:
      typeof safeCtxProp(ctx, "on") === "function" &&
      typeof safeCtxProp(ctx, "removeListener") === "function",
  };
}

export function normalizeUsage(raw = {}) {
  const inputTokens = raw?.inputTokens ?? raw?.prompt_tokens ?? raw?.input_tokens ?? 0;
  const outputTokens = raw?.outputTokens ?? raw?.completion_tokens ?? raw?.output_tokens ?? 0;
  const totalTokens = raw?.totalTokens ?? raw?.total_tokens ?? inputTokens + outputTokens;
  return {
    inputTokens: Number(inputTokens) || 0,
    outputTokens: Number(outputTokens) || 0,
    totalTokens: Number(totalTokens) || 0,
    model: raw?.model || "unknown",
    provider: raw?.provider || "unknown",
    cost: raw?.cost ?? null,
  };
}

export function buildUserMessage({ text, attemptId, orderId, sourceKind = SOURCE_KIND }) {
  return {
    role: "user",
    content: text || "",
    source: {
      kind: sourceKind,
      attemptId,
      orderId,
    },
  };
}

export function isFakeMode(options = {}) {
  if (options.fake === true || options.fake === false) return options.fake;
  if (process.env.DSH_COMPANY_FAKE === "1") return true;
  return false;
}

export function buildFakeProvider() {
  return {
    name: "fake-provider",
    async chat({ messages, tools = [] }) {
      const last = messages[messages.length - 1]?.content || "";
      return {
        message: { role: "assistant", content: `fake-response: ${last}` },
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      };
    },
  };
}

export function buildFakeServices({ runtime } = {}) {
  const agents = new Map();
  let seq = 0;

  function makeAgent({ sessionId, label, parentAgent }) {
    const id = sessionId || `fake-agent-${Date.now()}-${++seq}`;
    const ctxTools = [];
    let guardFn = null;
    const listeners = new Set();
    const agent = {
      id,
      session: { id },
      status: "idle",
      parentAgent,
      ctx: {
        tools: {
          restrict(filter) {
            if (filter?.allow) ctxTools.push(...filter.allow);
            return () => {};
          },
          guard(fn) {
            guardFn = fn;
            return () => {};
          },
          getAllowed() {
            return ctxTools;
          },
          runGuard(exec) {
            return guardFn ? guardFn(exec) : undefined;
          },
        },
        on(event, fn) {
          if (event === "assistant/message") listeners.add(fn);
          return () => listeners.delete(fn);
        },
      },
      emitAssistantMessage(payload) {
        for (const fn of listeners) {
          try { fn(payload); } catch {}
        }
      },
      async followup(message) {
        this.status = "working";
        // 模拟员工产生 usage（供 assistant/message 累加测试）
        const usage = message?.usage || { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 };
        setTimeout(() => {
          this.emitAssistantMessage({ usage, message: { role: "assistant", content: "fake-response" } });
        }, 0);
        // 模拟员工自动回报（仅在 fake 闭环测试需要时触发）
        if (message?.source?.attemptId && runtime?.dispatcher) {
          setTimeout(() => {
            runtime.dispatcher.report({
              attemptId: message.source.attemptId,
              status: "done",
              summary: "fake-report",
            }).catch(() => {});
          }, 5);
        }
      },
      cancel(reason, opts) {
        this.status = "cancelled";
      },
      async whenIdle() {
        return new Promise((resolve) => setImmediate(resolve));
      },
    };
    agents.set(id, agent);
    return agent;
  }

  const fakeAgents = {
    get(id) {
      return agents.get(id);
    },
    list() {
      return Array.from(agents.values());
    },
    async create({ sessionId, setup }) {
      const agent = makeAgent({ sessionId });
      if (typeof setup === "function") {
        await setup(agent.ctx, agent);
      }
      return { agent, dispose() { agents.delete(agent.id); } };
    },
  };

  const fakeSubagents = {
    async startActivation({ provider, label, request }) {
      const parentAgent = request?.parent;
      const agent = makeAgent({ label, parentAgent });
      return {
        childId: agent.id,
        messageId: `msg-${agent.id}`,
        result: Promise.resolve({ ok: true }),
        dispose() { agents.delete(agent.id); },
      };
    },
    async drainChildren(parent, ids) {
      for (const id of ids) {
        const agent = agents.get(id);
        if (agent) agent.status = "drained";
      }
    },
  };

  const fakeProvider = buildFakeProvider();

  return { agents: fakeAgents, subagents: fakeSubagents, provider: fakeProvider };
}

export async function wakeAgent({ agents, subagents, sessionId, parentAgent, userMessage, provider, label = "company-staff", cwd }) {
  let agent = null;
  if (agents && typeof agents.get === "function") {
    try {
      agent = agents.get(sessionId);
    } catch {
      agent = null;
    }
  }
  if (!agent && agents && typeof agents.resume === "function") {
    try {
      const resumed = await agents.resume({ resumeSessionId: sessionId, parentAgent: parentAgent?.agent || parentAgent, cwd });
      if (resumed?.agent) {
        agent = resumed.agent;
      }
    } catch {
      agent = null;
    }
  }
  if (!agent) {
    throw new Error("E_NO_SESSION");
  }
  if (typeof agent.followup === "function") {
    await agent.followup(userMessage);
  }
  return agent;
}

export function makeIdleMessage(reason = "shutdown") {
  return {
    role: "user",
    content: [{ type: "text", text: reason }],
    source: { kind: SOURCE_KIND, signal: "idle" },
  };
}

export function restrictTools(agentCtx, allow) {
  const tools = agentCtx?.tools;
  if (!tools || typeof tools.restrict !== "function") {
    throw new Error("tools.restrict 不可用");
  }
  const filtered = allow.filter((n) => n !== "run_code");
  return tools.restrict({ allow: filtered });
}

export function guardTools(agentCtx, guardFn) {
  const tools = agentCtx?.tools;
  if (!tools || typeof tools.guard !== "function") {
    throw new Error("tools.guard 不可用");
  }
  return tools.guard(guardFn);
}

export function normalizeError(err, code = "E_INTERNAL") {
  if (err && typeof err === "object" && err.code) {
    return { ok: false, code: err.code, message: err.message || "" };
  }
  return { ok: false, code, message: err?.message || String(err) };
}

export function warnOnly(fn, logger) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      logger?.warn?.(String(err));
      return { ok: false, code: "E_INTERNAL", message: String(err) };
    }
  };
}
