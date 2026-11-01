/**
 * v0.5.0：调度器轮询间隔曾经误用 staleAttemptMs（1 小时的「attempt 僵死」判定阈值），
 * 于是调度器每小时才 tick 一次——下单靠 kick(0) 能立刻派出第一层，
 * 但依赖解锁的下游（DAG 第二层起）、改派重试统统要等一小时，表现为「并行任务永远卡在排队」。
 *
 * 本文件锁死三件事：
 * 1. limits 里存在独立的 schedulerIntervalMs，默认 5 秒；
 * 2. 它和 staleAttemptMs 是两个键，谁也不许再顶替谁；
 * 3. runtime 的 view().health.scheduler.intervalMs 如实回报真实轮询间隔。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCompanyConfig } from "../src/shared/company-config.mjs";
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

test("limits.schedulerIntervalMs 默认 5000ms，且与 staleAttemptMs(1h) 分属不同键", () => {
  const { config } = resolveCompanyConfig({});
  assert.equal(config.limits.schedulerIntervalMs, 5000);
  assert.equal(config.limits.staleAttemptMs, 3600000);
  assert.notEqual(config.limits.schedulerIntervalMs, config.limits.staleAttemptMs);
});

test("limits.schedulerIntervalMs 可被配置覆盖", () => {
  const { config } = resolveCompanyConfig({ limits: { schedulerIntervalMs: 1234 } });
  assert.equal(config.limits.schedulerIntervalMs, 1234);
  // 覆盖轮询间隔不应影响僵死阈值
  assert.equal(config.limits.staleAttemptMs, 3600000);
});

test("runtime 的 health.scheduler.intervalMs 回报真实轮询间隔（不是 staleAttemptMs）", async () => {
  const dataDir = `/tmp/dsh-mm-schedint-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const rt = createCompanyRuntime(makeCtx(), {
    dataDir,
    config: { fake: true, limits: { schedulerIntervalMs: 777 } },
  });
  await rt.boot();
  try {
    const health = rt.view().health;
    assert.equal(health.scheduler.intervalMs, 777);
    assert.notEqual(health.scheduler.intervalMs, 3600000);
    assert.equal(health.scheduler.running, true);
  } finally {
    await rt.shutdown();
  }
});
