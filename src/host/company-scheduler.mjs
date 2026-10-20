/**
 * company-scheduler.mjs
 * 调度器：idle 边沿 + 账本变更事件驱动 + 定时巡检。
 */

export function createScheduler({ runtime, dispatcher, logger, intervalMs = 5000 }) {
  let timer = null;
  let disposed = false;

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
  }

  async function tick() {
    if (disposed) return;
    try {
      const ready = (runtime.ledger.orders || []).filter((o) => o.state === "queued");
      for (const order of ready) {
        await dispatcher.routeAndAssign(order.id);
      }
    } catch (err) {
      logger?.warn?.(`scheduler tick: ${err.message}`);
    }
  }

  function dispose() {
    disposed = true;
    stop();
  }

  return { start, stop, tick, dispose };
}
