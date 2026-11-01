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

/**
 * 剥掉值为 undefined 的自有键，递归清洗并返回新对象。
 *
 * 为什么必须有：插件把 order 对象原样返回给宿主当工具结果，宿主的
 * isJsonValue（@deepseek-ai/dsh-util-values）遇到 undefined 就判「非无损 JSON」，
 * 整个工具结果被丢弃并抛 `value is not lossless JSON`。而落盘走 JSON 序列化时
 * undefined 键本来就会被丢掉，于是出现「工具报错、账本其实已经建单」的割裂。
 * 清洗后内存对象与落盘形状一致，同一份数据不再有两种真相。
 */
export function stripUndefined(obj) {
  if (Array.isArray(obj)) {
    return obj.map((item) => (item === undefined ? null : stripUndefined(item)));
  }
  if (!obj || typeof obj !== "object") return obj;
  const out = {};
  for (const key of Object.keys(obj)) {
    if (obj[key] === undefined) continue;
    out[key] = stripUndefined(obj[key]);
  }
  return out;
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
  // stripUndefined：rest 里可能带着显式 undefined 的可选字段（project/dept/mode/timeoutMs），
  // 不清洗的话 order 会带 4 个值为 undefined 的自有键，宿主侧工具结果直接被判非无损 JSON。
  const order = stripUndefined({
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
  });
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
  [ORDER_STATES.QUEUED]: [ORDER_STATES.ROUTED, ORDER_STATES.RUNNING, ORDER_STATES.CANCELLED, ORDER_STATES.LOST],
  // routed -> queued：路由失败/领取失败要能退回队列重试，否则订单会永久粘在 routed。
  [ORDER_STATES.ROUTED]: [ORDER_STATES.RUNNING, ORDER_STATES.QUEUED, ORDER_STATES.FAILED, ORDER_STATES.CANCELLED],
  [ORDER_STATES.RUNNING]: [ORDER_STATES.DONE, ORDER_STATES.FAILED, ORDER_STATES.LOST, ORDER_STATES.ROUTED],
  [ORDER_STATES.DONE]: [],
  [ORDER_STATES.CANCELLED]: [],
  [ORDER_STATES.LOST]: [],
  // failed -> done：经理人工验收「这个失败的活其实改好了」，直接结单；
  // failed -> queued：重新排队重跑（派工走这条路）。两者都得允许，否则失败单是死路。
  [ORDER_STATES.FAILED]: [ORDER_STATES.QUEUED, ORDER_STATES.DONE, ORDER_STATES.CANCELLED],
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
    // attemptNo：该订单第几次派工，面板用它显示「第 2 次尝试」
    attemptNo: (order.attempts || []).length + 1,
    state: "running",
    status: "running",
    invalidated: false,
    lastSeenAt: now,
  };
  order.attempts.push(attempt);
  // 订单上冗余一份当前执行人 + 当前 attempt：面板/工作网按订单直接取人取 attempt，
  // 不用再翻 attempts 数组（重启后 view 也能直接显示「谁在做、第几次」）。
  order.employee = employee;
  order.attemptId = attempt.id;
  order.attemptNo = attempt.attemptNo;
  order.attemptStartedAt = now;
  return { ledger: l, attempt };
}

/** 所有「还活着」的 attempt（订单未终态、attempt 未吊销未结束）。 */
export function listLiveAttempts(ledger) {
  const out = [];
  for (const order of ledger?.orders || []) {
    if (order.state === ORDER_STATES.DONE || order.state === ORDER_STATES.CANCELLED || order.state === ORDER_STATES.LOST) continue;
    for (const attempt of order.attempts || []) {
      if (attempt.invalidated || attempt.endedAt) continue;
      out.push({ ...attempt, orderId: order.id, orderState: order.state });
    }
  }
  return out;
}

/**
 * 把 attempt 标记为 stale（不删除历史）。reason 落盘，供面板与审计解释。
 * 与 invalidateAttempt 的差别：这里不抛错，找不到就返回原账本。
 */
export function markAttemptStale(ledger, orderId, attemptId, reason, now = new Date().toISOString()) {
  const l = clone(ledger);
  const order = l.orders.find((o) => o.id === orderId);
  if (!order) return l;
  const attempt = (order.attempts || []).find((a) => a.id === attemptId);
  if (!attempt) return l;
  attempt.invalidated = true;
  attempt.state = "stale";
  attempt.status = attempt.status && attempt.status !== "running" ? attempt.status : "stale";
  attempt.staleReason = reason || "unknown";
  attempt.endedAt = attempt.endedAt || now;
  return l;
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
  if (attempt.endedAt) {
    throw new LedgerError(`attempt ${attemptId} 已回报过`, "E_DUPLICATE_REPORT");
  }
  attempt.status = status;
  attempt.state = status === "done" ? "done" : "failed";
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
