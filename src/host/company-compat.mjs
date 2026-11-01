/**
 * company-compat.mjs
 * 宿主能力探测、版本兼容、wake/resume 封装、normalizeUsage、fake 服务。
 */

import { randomUUID } from "node:crypto";

export const SOURCE_KIND = "company-runtime";

/**
 * 收件箱消息必须带**唯一 id**。
 * 内核的 inbox 投影（dsh-agent-loop）在插入后会把 next-turn + next-step 里所有 pending
 * 消息的 id 收进 Set，撞了就抛 `message "undefined" is already pending`
 * （消息没有 id 时，第二次插入必然撞，因为 Set 里已经有 undefined）。
 * 以前本插件所有消息都不带 id，于是「已有排队消息的员工」在 shutdown 时 followup
 * 必然报错，把这条错误留在崩溃日志里误导判读。
 */
export function newMessageId(prefix = "msg") {
  return `${prefix}-${randomUUID()}`;
}

export const TOOL_LINES = {
  MANAGER: "manager",
  STAFF: "staff",
  WINDOW: "window",
  OWNER: "owner",
};

export const LINE_TOOLS = {
  [TOOL_LINES.OWNER]: [
    "company_order", "company_plan", "company_status", "company_ask", "company_cancel",
    "company_assign", "company_review", "company_borrow", "company_report",
    "company_escalate", "company_accept", "company_ask_help",
    "company_hire", "company_admin",
  ],
  [TOOL_LINES.MANAGER]: [
    "company_order", "company_plan", "company_status", "company_ask", "company_cancel",
    "company_assign", "company_review", "company_borrow", "company_report",
    "company_escalate", "company_accept", "company_ask_help",
  ],
  [TOOL_LINES.STAFF]: [
    "company_report", "company_accept", "company_ask_help",
    "company_status", "company_ask",
  ],
  [TOOL_LINES.WINDOW]: [
    "company_order", "company_plan", "company_status", "company_ask", "company_cancel",
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

/**
 * 读取宿主默认 LLM 路由（agent-default-model 服务）。
 * 公司运行时的 owner/员工都是插件自己创建的根级/子级 Agent，不经过 GUI 会话创建路径，
 * 因此拿不到会话默认模型；必须显式把默认 provider/model 写进 owner 的 agentOptions，
 * 子会话再通过 resolveChildAgentOptions 继承。读不到时返回空对象（交给宿主兜底）。
 */
export function resolveDefaultLlmOptions(ctx) {
  try {
    const svc = safeCtxGet(ctx, "agentDefaultModel");
    const selection = svc && typeof svc.currentSelection === "function" ? svc.currentSelection() : undefined;
    if (selection && typeof selection.provider === "string" && typeof selection.model === "string") {
      return {
        provider: selection.provider,
        model: selection.model,
        ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
      };
    }
  } catch {}
  return {};
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
    id: newMessageId(attemptId ? `order-${attemptId}` : "company"),
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
    const sessionListeners = new Set();
    let eventSeq = 0;
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
          // 只承认真实宿主存在的 session/event 订阅；assistant/message 是会话事件，
          // 不是 agent 级触发事件，fake 不再提供这条捷径。
          if (event !== "session/event") return () => {};
          sessionListeners.add(fn);
          return () => sessionListeners.delete(fn);
        },
      },
      emitAssistantMessage(payload) {
        // 真实宿主里 assistant/message 是会话事件：agent.ctx.on("session/event", (session, event) => ...)
        const usage = payload?.usage ?? payload;
        const event = {
          type: "assistant/message",
          seq: ++eventSeq,
          data: { usage, message: payload?.message || { role: "assistant", content: [] } },
        };
        for (const fn of sessionListeners) {
          try { fn(agent.session, event); } catch {}
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

/**
 * 唤醒成员。
 *
 * v0.4 修复三件事：
 * 1. `agents.get()` 在宿主里可能是 async，旧代码没 await，拿到的是 Promise（恒真），
 *    于是 `followup` 静默不执行——成员压根没被叫醒，订单自然一直 running。
 * 2. 拿不到 agent 时用 `agents.resume` 复用旧会话。
 * 3. 仍然拿不到（子会话已随重启销毁）就退回 `subagents.startActivation` 起一个
 *    新会话并把这单当首条消息投递，绝不静默丢单。
 */
export async function wakeAgent({ agents, subagents, sessionId, parentAgent, userMessage, provider, label = "company-staff", cwd }) {
  let agent = null;
  if (agents && typeof agents.get === "function") {
    try {
      // 注意：这里必须 await——同步实现 await 也安全。
      agent = await agents.get(sessionId);
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
  if (agent) {
    if (typeof agent.followup === "function") {
      await agent.followup(userMessage);
    }
    return { ok: true, agent, sessionId, resumed: true };
  }

  // 子会话已不存在：起一个新的 activation 直接吃这条消息。
  if (subagents && typeof subagents.startActivation === "function") {
    const activation = await subagents.startActivation({
      agent: parentAgent?.agent || parentAgent,
      label,
      provider,
      cwd,
      prompt: userMessage?.content || [{ type: "text", text: String(userMessage?.text || "") }],
      delivery: "parent",
    });
    return { ok: true, agent: activation?.agent || null, sessionId: activation?.childId || sessionId, restarted: true };
  }

  return { ok: false, code: "E_NO_SESSION", message: `无法唤醒会话 ${sessionId}` };
}

export function makeIdleMessage(reason = "shutdown", sessionId = "") {
  return {
    id: newMessageId(`idle-${sessionId || "anon"}`),
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
