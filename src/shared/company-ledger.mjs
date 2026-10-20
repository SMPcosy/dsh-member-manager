/**
 * company-ledger.mjs
 * 订单、attempt、审计纯函数状态机（零 DSH 依赖）。
 * 负责人：plugin-arch；本实现为最小化 stub 以满足既有测试并支持 P2 运行时联调。
 */

export const LEDGER_VERSION = 1;

export const ORDER_STATES = Object.freeze({
  QUEUED: "queued",
  ROUTED: "routed",
  RUNNING: "running",
  DONE: "done",
  CANCELLED: "cancelled",
  LOST: "lost",
  FAILED: "failed",
});

const VALID_STATES = new Set(Object.values(ORDER_STATES));

export class LedgerError extends Error {
  constructor(message, code = "E_INTERNAL") {
    super(message);
    this.name = "LedgerError";
    this.code = code;
  }
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

export function emptyLedger(now = new Date().toISOString()) {
  return {
    version: LEDGER_VERSION,
    createdAt: now,
    orders: [],
    audit: [],
    clientMap: {},
  };
}

function nanoid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createOrder(ledger, { type, title, priority = "normal", deps = [], acceptance = [], clientOrderId, ...rest }, now = new Date().toISOString()) {
  const l = clone(ledger);
  if (clientOrderId) {
    const existing = l.clientMap[clientOrderId];
    if (existing) {
      return { ledger: l, order: l.orders.find((o) => o.id === existing) };
    }
  }
  const id = nanoid();
  const order = {
    id,
    type,
    title,
    priority,
    deps: Array.isArray(deps) ? deps : [],
    attempts: [],
    acceptance: Array.isArray(acceptance) ? acceptance : [],
    state: ORDER_STATES.QUEUED,
    createdAt: now,
    ...rest,
  };
  l.orders.push(order);
  if (clientOrderId) l.clientMap[clientOrderId] = id;
  return { ledger: l, order };
}

export function getOrder(ledger, id) {
  return ledger.orders.find((o) => o.id === id) || null;
}

function findOrder(ledger, id) {
  const idx = ledger.orders.findIndex((o) => o.id === id);
  if (idx === -1) throw new LedgerError(`订单 ${id} 不存在`, "E_NOT_FOUND");
  return idx;
}

function isTerminal(state) {
  return state === ORDER_STATES.DONE || state === ORDER_STATES.CANCELLED || state === ORDER_STATES.LOST || state === ORDER_STATES.FAILED;
}

const STATE_MACHINE = {
  [ORDER_STATES.QUEUED]: [ORDER_STATES.ROUTED, ORDER_STATES.RUNNING, ORDER_STATES.CANCELLED],
  [ORDER_STATES.ROUTED]: [ORDER_STATES.RUNNING, ORDER_STATES.CANCELLED],
  [ORDER_STATES.RUNNING]: [ORDER_STATES.DONE, ORDER_STATES.FAILED, ORDER_STATES.LOST, ORDER_STATES.ROUTED],
  [ORDER_STATES.DONE]: [],
  [ORDER_STATES.CANCELLED]: [],
  [ORDER_STATES.LOST]: [],
  [ORDER_STATES.FAILED]: [ORDER_STATES.QUEUED],
};

export function transitionOrder(ledger, id, newState) {
  const l = clone(ledger);
  const idx = findOrder(l, id);
  const order = l.orders[idx];
  if (!VALID_STATES.has(newState)) throw new LedgerError(`非法状态: ${newState}`, "E_INVALID_STATE");
  const allowed = STATE_MACHINE[order.state] || [];
  if (!allowed.includes(newState)) {
    throw new LedgerError(`非法转移 ${order.state} -> ${newState}`, "E_INVALID_TRANSITION");
  }

  if (newState === ORDER_STATES.RUNNING) {
    for (const depId of order.deps || []) {
      const dep = getOrder(l, depId);
      if (!dep || dep.state !== ORDER_STATES.DONE) {
        throw new LedgerError(`依赖 ${depId} 未满足`, "E_DEPS");
      }
    }
  }

  order.state = newState;
  if (isTerminal(newState)) {
    order.endedAt = new Date().toISOString();
  }
  return l;
}

export function assignAttempt(ledger, orderId, employee, sessionId, now = new Date().toISOString()) {
  const l = clone(ledger);
  const idx = findOrder(l, orderId);
  const order = l.orders[idx];
  const attempt = {
    id: nanoid(),
    employee,
    sessionId,
    startedAt: now,
    state: "running",
    invalidated: false,
  };
  order.attempts.push(attempt);
  return { ledger: l, attempt };
}

export function findAttempt(ledger, orderId, attemptId) {
  const order = getOrder(ledger, orderId);
  if (!order) return null;
  return order.attempts.find((a) => a.id === attemptId) || null;
}

export function invalidateAttempt(ledger, orderId, attemptId) {
  const l = clone(ledger);
  const order = l.orders.find((o) => o.id === orderId);
  if (!order) throw new LedgerError(`订单 ${orderId} 不存在`, "E_NOT_FOUND");
  const attempt = order.attempts.find((a) => a.id === attemptId);
  if (!attempt) throw new LedgerError(`attempt ${attemptId} 不存在`, "E_NOT_FOUND");
  attempt.invalidated = true;
  attempt.endedAt = new Date().toISOString();
  return l;
}

export function reportAttempt(ledger, orderId, attemptId, status, payload, now = new Date().toISOString()) {
  const l = clone(ledger);
  const order = l.orders.find((o) => o.id === orderId);
  if (!order) throw new LedgerError(`订单 ${orderId} 不存在`, "E_NOT_FOUND");
  const attempt = order.attempts.find((a) => a.id === attemptId);
  if (!attempt) throw new LedgerError(`attempt ${attemptId} 不存在`, "E_NOT_FOUND");
  if (attempt.invalidated) {
    throw new LedgerError(`STALE stale attempt ${attemptId}`, "E_STALE_ATTEMPT");
  }
  attempt.status = status;
  attempt.payload = payload;
  attempt.endedAt = now;
  return { ledger: l, order, attempt };
}

export function appendAudit(ledger, entry) {
  const l = clone(ledger);
  l.audit.push({ ...entry, ts: entry.ts || new Date().toISOString() });
  return l;
}

export function isOrderReady(ledger, orderId) {
  const order = getOrder(ledger, orderId);
  if (!order) return false;
  for (const depId of order.deps || []) {
    const dep = getOrder(ledger, depId);
    if (!dep || dep.state !== ORDER_STATES.DONE) return false;
  }
  return true;
}
