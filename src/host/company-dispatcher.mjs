/**
 * company-dispatcher.mjs
 * P2 闭环：order -> route -> attempt -> wake -> report -> review -> done -> unlock deps.
 *
 * 状态机：
 *   queued -> routed -> running -> done
 *                    -> failed -> queued (requeue)
 *                    -> lost
 *   queued -> cancelled
 *   routed -> cancelled
 */

import { createOrder, transitionOrder, assignAttempt, getOrder, reportAttempt, ORDER_STATES } from "../shared/company-ledger.mjs";
import { routeTypeToDept, selectEmployee } from "../shared/company-router.mjs";
import { updateEmployee, EMPLOYEE_STATE } from "../shared/company-org.mjs";
import { LedgerError } from "../shared/company-ledger.mjs";
import { wakeAgent, SOURCE_KIND } from "./company-compat.mjs";

export function createDispatcher({ runtime, store, employeeManager, logger }) {
  const activeAttempts = new Map();

  function isTerminal(state) {
    return state === ORDER_STATES.DONE || state === ORDER_STATES.CANCELLED || state === ORDER_STATES.LOST || state === ORDER_STATES.FAILED;
  }

  function mapLedgerError(err) {
    return err?.code || "E_INTERNAL";
  }

  async function withLedger(fn) {
    return store.withLock(async () => {
      try {
        const loaded = await store.load();
        runtime.ledger = loaded.ledger || runtime.ledger;
        runtime.company = loaded.company || runtime.company;
        return await fn();
      } catch (err) {
        if (err instanceof LedgerError) {
          return { ok: false, code: mapLedgerError(err), message: err.message };
        }
        logger?.warn?.(`dispatcher withLedger error: ${err.message}`);
        return { ok: false, code: err?.code || "E_INTERNAL", message: err.message };
      }
    });
  }

  async function persist() {
    await store.saveLedger(runtime.ledger);
  }

  async function append(type, payload) {
    await store.appendAudit({ type, ...payload });
  }

  // 工具 schema 把 deps/acceptance 声明为 string 或 string[]，统一归一成数组，
  // 避免字符串被账本层按 Array.isArray 丢弃。
  function normalizeStringList(value) {
    if (Array.isArray(value)) return value.filter((v) => typeof v === "string" && v.trim() !== "");
    if (typeof value === "string" && value.trim() !== "") return [value.trim()];
    return Array.isArray(value) ? value : undefined;
  }

  function normalizeInput(args) {
    return {
      project: args.project,
      type: args.type,
      title: args.title,
      detail: args.detail,
      priority: args.priority,
      dept: args.dept,
      deps: normalizeStringList(args.deps),
      acceptance: normalizeStringList(args.acceptance),
      mode: args.mode,
      timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
      clientOrderId: args.clientOrderId,
    };
  }

  async function placeOrder(input, now = new Date().toISOString()) {
    return withLedger(async () => {
      const { ledger, order } = createOrder(runtime.ledger, normalizeInput(input), now);
      runtime.ledger = ledger;
      await persist();
      await append("order_created", { orderId: order.id, clientOrderId: input.clientOrderId });
      return { ok: true, orderId: order.id };
    });
  }

  async function routeOrder(orderId, now = new Date().toISOString()) {
    return withLedger(async () => {
      const order = getOrder(runtime.ledger, orderId);
      if (!order) return { ok: false, code: "E_ORDER_NOT_FOUND" };
      runtime.ledger = transitionOrder(runtime.ledger, orderId, ORDER_STATES.ROUTED);
      await persist();
      await append("order_routed", { orderId });
      return { ok: true, orderId };
    });
  }

  async function assignAndWake(orderId, employeeId) {
    return withLedger(async () => {
      const emp = runtime.company.employees.find((e) => e.id === employeeId);
      if (!emp) return { ok: false, code: "E_EMPLOYEE_NOT_FOUND" };

      const order = getOrder(runtime.ledger, orderId);
      if (!order) return { ok: false, code: "E_ORDER_NOT_FOUND" };

      if (order.state !== ORDER_STATES.ROUTED && order.state !== ORDER_STATES.RUNNING) {
        runtime.ledger = transitionOrder(runtime.ledger, orderId, ORDER_STATES.ROUTED);
      }
      if (order.state !== ORDER_STATES.RUNNING) {
        runtime.ledger = transitionOrder(runtime.ledger, orderId, ORDER_STATES.RUNNING);
      }

      let session;
      try {
        session = await employeeManager.ensureSession({
          employee: emp,
          parentAgent: runtime.ownerAgent,
          provider: runtime.provider,
          config: runtime.config,
          cwd: runtime.dataDir,
          orderId,
        });
      } catch (error) {
        // 派工失败（provider 未注册、会话创建失败等）必须把订单回滚到 queued，
        // 不能留下「running 且无 attempt」的僵单。
        const code = error?.code || "E_DISPATCH_FAILED";
        const message = String(error?.message || error);
        if (getOrder(runtime.ledger, orderId)?.state === ORDER_STATES.RUNNING) {
          runtime.ledger = transitionOrder(runtime.ledger, orderId, ORDER_STATES.FAILED);
          runtime.ledger = transitionOrder(runtime.ledger, orderId, ORDER_STATES.QUEUED);
        }
        await persist();
        await append("assign_failed", { orderId, employeeId, code, message });
        return { ok: false, code, message };
      }

      const { ledger, attempt } = assignAttempt(runtime.ledger, orderId, employeeId, session.sessionId);
      runtime.ledger = ledger;
      runtime.company = updateEmployee(runtime.company, employeeId, { state: "working", lastUsed: Date.now() });
      activeAttempts.set(attempt.id, { attemptId: attempt.id, orderId, employeeId, sessionId: session.sessionId });
      await persist();
      await append("attempt_assigned", { orderId, attemptId: attempt.id, employeeId, sessionId: session.sessionId });

      const { wakeAgent } = await import("./company-compat.mjs");
      const userMessage = {
        role: "user",
        content: [{ type: "text", text: `执行订单 ${orderId}` }],
        source: { kind: "company-runtime", attemptId: attempt.id, orderId },
      };
      await wakeAgent({
        agents: runtime.ctx.get("agents"),
        subagents: runtime.ctx.get("subagents"),
        sessionId: session.sessionId,
        parentAgent: runtime.ownerAgent,
        userMessage,
        provider: runtime.provider,
        cwd: runtime.dataDir,
      });
      return { ok: true, attemptId: attempt.id, sessionId: session.sessionId };
    });
  }

  async function routeAndAssign(orderId) {
    const routed = await routeOrder(orderId);
    if (!routed.ok) return routed;
    const order = getOrder(runtime.ledger, orderId);
    const deptId = routeTypeToDept(order.type, runtime.config.routingRules || [], runtime.company);
    if (!deptId) return { ok: false, code: "E_NO_DEPT" };
    const picked = selectEmployee({ company: runtime.company, deptId, order, attempts: order.attempts || [] });
    if (!picked) return { ok: false, code: "E_NO_EMPLOYEE" };
    return assignAndWake(orderId, picked.id);
  }

  async function report({ attemptId, orderId, status, summary, artifacts, acceptanceResults }) {
    const meta = activeAttempts.get(attemptId);
    if (!meta) return { ok: false, code: "E_STALE_ATTEMPT" };
    if (orderId && orderId !== meta.orderId) return { ok: false, code: "E_STALE_ATTEMPT" };

    return withLedger(async () => {
      const payload = { summary, artifacts: artifacts || [], acceptanceResults: acceptanceResults || [] };
      const res = reportAttempt(runtime.ledger, meta.orderId, attemptId, status, payload);
      runtime.ledger = res.ledger;
      runtime.company = updateEmployee(runtime.company, meta.employeeId, { state: "idle" });
      activeAttempts.delete(attemptId);
      let unlocked = [];
      if (status === "done") {
        runtime.ledger = transitionOrder(runtime.ledger, meta.orderId, ORDER_STATES.DONE);
        unlocked = unlockDeps(meta.orderId);
      } else {
        runtime.ledger = transitionOrder(runtime.ledger, meta.orderId, ORDER_STATES.FAILED);
      }
      await persist();
      await append("report_received", { orderId: meta.orderId, attemptId, status });
      await append(status === "done" ? "order_done" : "order_failed", {
        orderId: meta.orderId,
        attemptId,
        employeeId: meta.employeeId,
      });
      return { ok: true, orderId: meta.orderId, unlocked };
    });
  }

  function unlockDeps(doneOrderId) {
    const unlocked = [];
    for (const o of runtime.ledger.orders || []) {
      if ((o.deps || []).includes(doneOrderId) && o.state === ORDER_STATES.QUEUED) {
        unlocked.push(o.id);
      }
    }
    return unlocked;
  }

  async function review({ orderId, pass }) {
    return withLedger(async () => {
      const order = getOrder(runtime.ledger, orderId);
      if (!order) return { ok: false, code: "E_ORDER_NOT_FOUND" };
      if (order.state === ORDER_STATES.DONE) {
        return { ok: true, state: "done" };
      }
      if (order.state !== ORDER_STATES.RUNNING && order.state !== ORDER_STATES.FAILED) {
        return { ok: false, code: "E_INVALID_STATE", message: `无法在 ${order.state} 状态复核` };
      }
      if (pass) {
        runtime.ledger = transitionOrder(runtime.ledger, orderId, ORDER_STATES.DONE);
        await persist();
        await append("order_reviewed", { orderId, pass });
        return { ok: true, state: "done" };
      }
      // reject: 先失败后重入队
      runtime.ledger = transitionOrder(runtime.ledger, orderId, ORDER_STATES.FAILED);
      runtime.ledger = transitionOrder(runtime.ledger, orderId, ORDER_STATES.QUEUED);
      await persist();
      await append("order_reviewed", { orderId, pass });
      return { ok: true, state: "queued" };
    });
  }

  async function completeOrder(orderId) {
    return withLedger(async () => {
      const order = getOrder(runtime.ledger, orderId);
      if (!order) return { ok: false, code: "E_ORDER_NOT_FOUND" };
      if (order.state !== ORDER_STATES.RUNNING) {
        return { ok: false, code: "E_INVALID_TRANSITION" };
      }
      runtime.ledger = transitionOrder(runtime.ledger, orderId, ORDER_STATES.DONE);
      await persist();
      await append("order_completed", { orderId });
      return { ok: true };
    });
  }

  async function cancelOrder(orderId) {
    return withLedger(async () => {
      const order = getOrder(runtime.ledger, orderId);
      if (!order) return { ok: false, code: "E_ORDER_NOT_FOUND" };
      const state = order.state;
      if (state === ORDER_STATES.RUNNING) {
        runtime.ledger = transitionOrder(runtime.ledger, orderId, ORDER_STATES.FAILED);
        runtime.ledger = transitionOrder(runtime.ledger, orderId, ORDER_STATES.QUEUED);
        runtime.ledger = transitionOrder(runtime.ledger, orderId, ORDER_STATES.CANCELLED);
      } else if (state === ORDER_STATES.QUEUED || state === ORDER_STATES.ROUTED) {
        runtime.ledger = transitionOrder(runtime.ledger, orderId, ORDER_STATES.CANCELLED);
      } else {
        return { ok: false, code: "E_INVALID_TRANSITION" };
      }
      await persist();
      await append("order_cancelled", { orderId });
      return { ok: true };
    });
  }

  async function escalate(orderId, reason) {
    return withLedger(async () => {
      const order = getOrder(runtime.ledger, orderId);
      if (!order) return { ok: false, code: "E_NOT_FOUND" };
      if (isTerminal(order.state)) return { ok: false, code: "E_INVALID_STATE" };
      order.escalatedAt = new Date().toISOString();
      order.escalatedReason = reason || "";
      await persist();
      await append("order_escalated", { orderId, reason: reason || "" });
      return { ok: true, orderId, escalated: true };
    });
  }

  async function borrow(orderId, sharedEmployeeId) {
    return withLedger(async () => {
      const order = getOrder(runtime.ledger, orderId);
      if (!order) return { ok: false, code: "E_NOT_FOUND", message: "订单不存在" };
      if (isTerminal(order.state)) return { ok: false, code: "E_INVALID_STATE", message: `订单状态 ${order.state} 已终态` };

      const emp = runtime.company.employees.find((e) => e.id === sharedEmployeeId);
      if (!emp) return { ok: false, code: "E_NOT_FOUND", message: `员工 ${sharedEmployeeId} 不存在` };
      if (emp.kind !== "shared") return { ok: false, code: "E_INVALID_STATE", message: "仅可借调 shared 员工" };
      if (emp.state !== EMPLOYEE_STATE.IDLE) return { ok: false, code: "E_INVALID_STATE", message: "shared 员工非空闲" };

      if (order.state === ORDER_STATES.QUEUED) {
        runtime.ledger = transitionOrder(runtime.ledger, orderId, ORDER_STATES.ROUTED);
      }
      const currentOrder = getOrder(runtime.ledger, orderId);
      if (currentOrder.state === ORDER_STATES.ROUTED || currentOrder.state === ORDER_STATES.RUNNING) {
        if (currentOrder.state !== ORDER_STATES.RUNNING) {
          runtime.ledger = transitionOrder(runtime.ledger, orderId, ORDER_STATES.RUNNING);
        }
      } else {
        return { ok: false, code: "E_INVALID_STATE", message: `订单状态 ${currentOrder.state} 不可借调` };
      }

      runtime.company = updateEmployee(runtime.company, sharedEmployeeId, { state: EMPLOYEE_STATE.WORKING });
      const session = await employeeManager.ensureSession({
        employee: emp,
        parentAgent: runtime.ownerAgent,
        provider: runtime.provider,
        config: runtime.config,
        cwd: runtime.dataDir,
        orderId,
      });

      const { ledger, attempt } = assignAttempt(runtime.ledger, orderId, sharedEmployeeId, session.sessionId);
      runtime.ledger = ledger;
      activeAttempts.set(attempt.id, { attemptId: attempt.id, orderId, employeeId: sharedEmployeeId, sessionId: session.sessionId });

      await persist();
      await append("order_borrowed", { orderId, sharedEmployeeId, attemptId: attempt.id, sessionId: session.sessionId });

      const userMessage = {
        role: "user",
        content: [{ type: "text", text: `借调执行订单 ${orderId}` }],
        source: { kind: SOURCE_KIND, attemptId: attempt.id, orderId },
      };
      await wakeAgent({
        agents: runtime.ctx.get("agents"),
        subagents: runtime.ctx.get("subagents"),
        sessionId: session.sessionId,
        parentAgent: runtime.ownerAgent,
        userMessage,
        provider: runtime.provider,
        cwd: runtime.dataDir,
      });

      return { ok: true, attemptId: attempt.id, childId: session.sessionId };
    });
  }

  async function askHelp(attemptId, question, sessionId) {
    return withLedger(async () => {
      let orderId = null;
      for (const o of runtime.ledger.orders || []) {
        const a = o.attempts.find((x) => x.id === attemptId);
        if (a) {
          orderId = o.id;
          break;
        }
      }
      if (!orderId) return { ok: false, code: "E_NOT_FOUND" };
      const order = getOrder(runtime.ledger, orderId);
      const attempt = order.attempts.find((a) => a.id === attemptId);
      if (!attempt || attempt.invalidated) return { ok: false, code: "E_STALE_ATTEMPT" };
      attempt.helpRequestedAt = new Date().toISOString();
      attempt.helpQuestion = question || "";
      await persist();
      await append("attempt_help_requested", { orderId, attemptId, question: question || "", sessionId });
      return { ok: true, orderId, attemptId, forwardedTo: null };
    });
  }

  function findAttemptMetaBySessionId(sessionId) {
    for (const meta of activeAttempts.values()) {
      if (meta.sessionId === sessionId) return meta;
    }
    return null;
  }

  return {
    placeOrder,
    routeOrder,
    assignAndWake,
    routeAndAssign,
    report,
    review,
    completeOrder,
    cancelOrder,
    escalate,
    borrow,
    askHelp,
    findAttemptMetaBySessionId,
    activeAttempts,
  };
}
