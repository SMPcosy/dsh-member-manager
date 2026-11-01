/**
 * company-scheduler.mjs
 * 调度器：定时巡检 + 事件驱动 kick。
 *
 * v0.4：以前只扫 queued，导致两类订单永久失踪：
 *   - 路由失败卡在 routed 的；
 *   - 依赖满足后被 unlockDeps 提到的（后者其实是 queued，没问题）。
 * 现在每轮按下面的顺序推进：
 *   1) recoverStranded：running 但无活 attempt 的订单放回队列；
 *   2) 扫 queued ∪ routed，过滤依赖未满足与退避中的订单；
 *   3) 按优先级 + 创建时间排序；
 *   4) 逐条 routeAndAssign，命中并发上限后本轮停止（避免空转）。
 */

import { isOrderReady, ORDER_STATES } from "../shared/company-ledger.mjs";

const PRIORITY_WEIGHT = { urgent: 0, high: 1, normal: 2, low: 3 };

export function createScheduler({ runtime, dispatcher, logger, intervalMs = 5000, maxPerTick = 8 }) {
  let timer = null;
  let disposed = false;
  let running = false;
  let kickTimer = null;

  function start() {
    if (timer) return;
    timer = setInterval(() => tick(), intervalMs);
    if (timer && typeof timer.unref === "function") timer.unref();
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (kickTimer) {
      clearTimeout(kickTimer);
      kickTimer = null;
    }
  }

  function weight(order) {
    return PRIORITY_WEIGHT[order?.priority] ?? PRIORITY_WEIGHT.normal;
  }

  /** 当前可以尝试派工的订单（不含依赖未满足 / 退避中的）。 */
  function candidates() {
    const now = Date.now();
    return (runtime.ledger.orders || [])
      .filter((o) => o.state === ORDER_STATES.QUEUED || o.state === ORDER_STATES.ROUTED)
      .filter((o) => !o.retryAfter || o.retryAfter <= now)
      .filter((o) => isOrderReady(runtime.ledger, o.id))
      .sort((a, b) => weight(a) - weight(b) || String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  }

  async function tick() {
    if (disposed || running) return;
    running = true;
    try {
      const recovery = await dispatcher.recoverStranded();
      if (recovery?.recovered?.length) {
        logger?.info?.(`scheduler: 回收搁浅订单 ${recovery.recovered.length} 条`);
      }
      // 临时工到期退场（不打断正在执行的 attempt）
      try { await dispatcher.sweepTemps?.(); } catch (err) { logger?.warn?.(`scheduler sweepTemps: ${err.message}`); }
      let assigned = 0;
      // 已经饱和的部门本轮不再尝试（否则一个满编部门会饿死其它部门的所有订单）
      const saturated = new Set();
      for (const order of candidates()) {
        if (disposed) break;
        if (assigned >= maxPerTick) break;
        const res = await dispatcher.routeAndAssign(order.id);
        if (res?.ok) {
          assigned += 1;
          continue;
        }
        // 容量/无人：只跳过这个部门，继续给其它部门派工（订单已带 retryAfter 退避）。
        if (res?.code === "E_CAPACITY" || res?.code === "E_NO_EMPLOYEE") {
          if (res.deptId) saturated.add(res.deptId);
          continue;
        }
      }
      return { assigned };
    } catch (err) {
      logger?.warn?.(`scheduler tick: ${err.message}`);
      return { assigned: 0, error: err.message };
    } finally {
      running = false;
    }
  }

  /** 事件驱动：下完单立刻试一次，不等 interval。 */
  function kick(delayMs = 0) {
    if (disposed) return;
    if (kickTimer) return;
    kickTimer = setTimeout(() => {
      kickTimer = null;
      void tick();
    }, delayMs);
    if (kickTimer && typeof kickTimer.unref === "function") kickTimer.unref();
  }

  function dispose() {
    disposed = true;
    stop();
  }

  function isRunning() {
    return Boolean(timer) && !disposed;
  }

  /** 当前轮询间隔（ms）：面板自检要能确认「调度器真的按 5 秒在跑」，而不是被别的阈值顶替。 */
  function intervalMsNow() {
    return intervalMs;
  }

  return { start, stop, tick, kick, candidates, isRunning, intervalMs: intervalMsNow, dispose };
}
