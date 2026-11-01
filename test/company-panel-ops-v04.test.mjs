/**
 * v0.4 面板调度开关：工作网看板上的「调度器」小胶囊点一下就暂停/恢复自动派工，
 * 对应的两个面板 op（stopScheduler / startScheduler）必须真的切换状态并回显到 view.health。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCompanyRuntime } from "../src/host/company-runtime.mjs";

function makeCtx() {
  return {
    get() {
      return undefined;
    },
    effect() {
      return () => {};
    },
  };
}

test("v0.4 调度开关：stopScheduler / startScheduler 切换 health.scheduler.running", async () => {
  const dataDir = `/tmp/dsh-mm-sched-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const rt = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt.boot();
  const route = rt.routes.find((r) => r.method === "POST" && r.path === "/company/op");
  const call = (action, args = {}) => route.handler({}, new URL("http://localhost/company/op"), { action, args });
  try {
    const stop = await call("stopScheduler");
    assert.equal(stop.ok, true);
    assert.equal(stop.running, false);
    assert.equal(rt.view().health.scheduler.running, false);

    const start = await call("startScheduler");
    assert.equal(start.ok, true);
    assert.equal(rt.view().health.scheduler.running, true);

    const tick = await call("runScheduler");
    assert.equal(tick.ok, true);
    assert.equal(typeof tick.assigned, "number");
  } finally {
    await rt.shutdown();
  }
});
