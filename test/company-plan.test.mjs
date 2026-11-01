import test from "node:test";
import assert from "node:assert/strict";

import { normalizePlan, firstLayerSize } from "../src/shared/company-plan.mjs";
import { createOrder, emptyLedger, isOrderReady } from "../src/shared/company-ledger.mjs";

/**
 * 任务图（DAG）分层与建单。
 *
 * 目标：一次提交多个带依赖的任务，同层（依赖已满足）的并行派发，下游等上游。
 * 这里测两层东西——纯函数分层（normalizePlan），以及按层建单后依赖门禁的真实行为。
 */

const NOW = "2026-11-01T00:00:00.000Z";

function plan(tasks) {
  return normalizePlan({ tasks });
}

test("空任务列表被拒", () => {
  const res = plan([]);
  assert.equal(res.ok, false);
  assert.equal(res.code, "E_PLAN_EMPTY");
});

test("缺 type 或 title 的任务被拒", () => {
  assert.equal(plan([{ key: "a", title: "只有标题" }]).code, "E_PLAN_TASK_INVALID");
  assert.equal(plan([{ key: "a", type: "issue" }]).code, "E_PLAN_TASK_INVALID");
});

test("key 重复被拒", () => {
  const res = plan([
    { key: "a", type: "issue", title: "一" },
    { key: "a", type: "issue", title: "二" },
  ]);
  assert.equal(res.code, "E_PLAN_DUP_KEY");
});

test("依赖不存在的 key 被拒", () => {
  const res = plan([{ key: "a", type: "issue", title: "一", deps: ["ghost"] }]);
  assert.equal(res.code, "E_PLAN_BAD_REF");
});

test("自依赖被拒", () => {
  const res = plan([{ key: "a", type: "issue", title: "一", deps: ["a"] }]);
  assert.equal(res.code, "E_PLAN_CYCLE");
});

test("二节点环被拒", () => {
  const res = plan([
    { key: "a", type: "issue", title: "一", deps: ["b"] },
    { key: "b", type: "issue", title: "二", deps: ["a"] },
  ]);
  assert.equal(res.code, "E_PLAN_CYCLE");
  assert.deepEqual(res.cycle.sort(), ["a", "b"]);
});

test("三节点环被拒", () => {
  const res = plan([
    { key: "a", type: "issue", title: "一", deps: ["c"] },
    { key: "b", type: "issue", title: "二", deps: ["a"] },
    { key: "c", type: "issue", title: "三", deps: ["b"] },
  ]);
  assert.equal(res.code, "E_PLAN_CYCLE");
});

test("无依赖的任务全部落在同一层（可并行）", () => {
  const res = plan([
    { key: "a", type: "issue", title: "一" },
    { key: "b", type: "issue", title: "二" },
    { key: "c", type: "issue", title: "三" },
  ]);
  assert.equal(res.ok, true);
  assert.equal(res.layers.length, 1);
  assert.equal(firstLayerSize(res.layers), 3);
});

test("菱形图分三层：a → (b,c) → d", () => {
  const res = plan([
    { key: "a", type: "issue", title: "起点" },
    { key: "b", type: "issue", title: "左", deps: ["a"] },
    { key: "c", type: "issue", title: "右", deps: ["a"] },
    { key: "d", type: "issue", title: "汇合", deps: ["b", "c"] },
  ]);
  assert.equal(res.ok, true);
  assert.deepEqual(
    res.layers.map((layer) => layer.map((t) => t.key)),
    [["a"], ["b", "c"], ["d"]],
  );
  assert.equal(firstLayerSize(res.layers), 1);
});

test("缺省 key 按 t1/t2/t3 生成", () => {
  const res = plan([
    { type: "issue", title: "一" },
    { type: "issue", title: "二", deps: ["t1"] },
  ]);
  assert.equal(res.ok, true);
  assert.deepEqual(res.layers.map((l) => l.map((t) => t.key)), [["t1"], ["t2"]]);
});

test("超过 50 个任务被拒", () => {
  const tasks = Array.from({ length: 51 }, (_, i) => ({ key: `k${i}`, type: "issue", title: `任务 ${i}` }));
  assert.equal(plan(tasks).code, "E_PLAN_TOO_LARGE");
});

/**
 * 按 placePlan 的方式建单：逐层建，依赖映射成真实 orderId。
 * 返回 key → order 的映射，供断言用。
 */
function buildPlan(layers, group = "P-TEST") {
  let ledger = emptyLedger(NOW);
  const byKey = new Map();
  for (const layer of layers) {
    for (const task of layer) {
      const deps = task.deps.map((key) => byKey.get(key).order.id);
      const res = createOrder(ledger, { ...task, deps, group, taskKey: task.key }, NOW);
      ledger = res.ledger;
      byKey.set(task.key, res);
    }
  }
  return { ledger, byKey };
}

test("建单后 group / taskKey 落在订单上，且整体是无损 JSON", () => {
  const { layers } = plan([
    { key: "a", type: "issue", title: "起点" },
    { key: "b", type: "issue", title: "下游", deps: ["a"] },
  ]);
  const { ledger } = buildPlan(layers, "P-DEMO");

  for (const order of ledger.orders) {
    assert.equal(order.group, "P-DEMO");
    assert.ok(order.taskKey);
    assert.equal(
      JSON.stringify(JSON.parse(JSON.stringify(order))),
      JSON.stringify(order),
      "order 必须是无损 JSON",
    );
  }
});

test("同层任务同时 ready（并行），下游要等上游完成", () => {
  const { layers } = plan([
    { key: "a", type: "issue", title: "起点" },
    { key: "b", type: "issue", title: "左", deps: ["a"] },
    { key: "c", type: "issue", title: "右", deps: ["a"] },
    { key: "d", type: "issue", title: "汇合", deps: ["b", "c"] },
  ]);
  const { ledger, byKey } = buildPlan(layers);

  const id = (key) => byKey.get(key).order.id;

  // 第一层没有依赖，立刻可派。
  assert.equal(isOrderReady(ledger, id("a")), true);
  // 下游被挡。
  assert.equal(isOrderReady(ledger, id("b")), false);
  assert.equal(isOrderReady(ledger, id("d")), false);

  // 上游完成后，b、c 同时解锁（并行）。
  ledger.orders.find((o) => o.id === id("a")).state = "done";
  assert.equal(isOrderReady(ledger, id("b")), true);
  assert.equal(isOrderReady(ledger, id("c")), true);
  // 汇合点仍需两个都在。
  assert.equal(isOrderReady(ledger, id("d")), false);

  ledger.orders.find((o) => o.id === id("b")).state = "done";
  assert.equal(isOrderReady(ledger, id("d")), false, "b 完成但 c 没完成，d 仍不可派");

  ledger.orders.find((o) => o.id === id("c")).state = "done";
  assert.equal(isOrderReady(ledger, id("d")), true);
});
