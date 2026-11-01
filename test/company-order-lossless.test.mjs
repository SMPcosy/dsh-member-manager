import test from "node:test";
import assert from "node:assert/strict";

import { createOrder, emptyLedger, stripUndefined } from "../src/shared/company-ledger.mjs";

/**
 * 回归测试：company_order 的工具结果必须是「无损 JSON」。
 *
 * 缺陷背景：它曾返回 { ok: true, orderId, order }，而 order 上带着
 * project / dept / mode / timeoutMs 四个值为 undefined 的自有键。
 * 宿主的 isJsonValue 遇到 undefined 直接判非无损 JSON，工具结果被丢弃并抛
 * `value is not lossless JSON`；但账本落盘时 JSON 序列化已经丢掉了这些键，
 * 订单其实建成并派了工 —— 调用方以为失败、重试，于是重复下单。
 */

/** 递归断言：value 的任意层级都不出现 undefined（含自有键与数组元素）。 */
function assertNoUndefined(value, path = "out") {
  if (value === undefined) {
    assert.fail(`${path} 的值是 undefined`);
  }
  if (value === null || typeof value !== "object") return;

  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoUndefined(item, `${path}[${i}]`));
    return;
  }

  for (const key of Object.keys(value)) {
    assert.notEqual(
      value[key],
      undefined,
      `${path}.${key} 是值为 undefined 的自有键（这会让宿主判定非无损 JSON）`,
    );
    assertNoUndefined(value[key], `${path}.${key}`);
  }
}

/** 无损 JSON 的判定复用宿主口径：JSON 往返后逐字段等价。 */
function assertLossless(value, label = "工具结果") {
  assertNoUndefined(value, label);
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value, `${label} JSON 往返后不等价`);
}

function newLedger() {
  return emptyLedger("2026-10-31T00:00:00.000Z");
}

test("只传 type/title 时，order 不带任何 undefined 键", () => {
  const { order } = createOrder(
    newLedger(),
    {
      type: "bugfix",
      title: "最小入参",
      project: undefined,
      dept: undefined,
      mode: undefined,
      timeoutMs: undefined,
    },
    "2026-10-31T00:00:00.000Z",
  );

  assertNoUndefined(order);
  assertLossless(order, "order");

  // 未传的可选字段「不出现」，而不是「出现为 undefined」。
  for (const key of ["project", "dept", "mode", "timeoutMs"]) {
    assert.equal(Object.hasOwn(order, key), false, `${key} 不该出现在 order 上`);
  }

  // 必填与默认值仍照旧。
  assert.equal(order.type, "bugfix");
  assert.equal(order.title, "最小入参");
  assert.equal(order.priority, "normal");
  assert.deepEqual(order.deps, []);
  assert.deepEqual(order.acceptance, []);
  assert.deepEqual(order.attempts, []);
  assert.equal(order.state, "queued");
  assert.equal(order.createdAt, "2026-10-31T00:00:00.000Z");
  assert.ok(order.id);
});

test("placeOrder 的返回值整体是无损 JSON", () => {
  const { order } = createOrder(newLedger(), { type: "bugfix", title: "工具结果形状" });
  // 与 dispatcher.placeOrder 实际返回的结构一致。
  const toolOutput = { ok: true, orderId: order.id, order };

  assertNoUndefined(toolOutput);
  assertLossless(toolOutput, "工具结果");
});

test("传了 project/dept/mode/timeoutMs 时这些键正常保留", () => {
  const { order } = createOrder(newLedger(), {
    type: "design",
    title: "带可选字段",
    project: "插件工作区",
    dept: "plugin-dept",
    mode: "sequential",
    timeoutMs: 600000,
  });

  assertLossless(order, "order");
  assert.equal(order.project, "插件工作区");
  assert.equal(order.dept, "plugin-dept");
  assert.equal(order.mode, "sequential");
  assert.equal(order.timeoutMs, 600000);
});

test("0 / 空串 / false 这类假值不能被 stripUndefined 误删", () => {
  const stripped = stripUndefined({ zero: 0, empty: "", no: false, nil: null, gone: undefined });

  assert.deepEqual(stripped, { zero: 0, empty: "", no: false, nil: null });
  assert.equal(Object.hasOwn(stripped, "gone"), false);
});

test("order 落账后与磁盘形状一致", () => {
  const { ledger, order } = createOrder(newLedger(), {
    type: "bugfix",
    title: "内存与磁盘同形",
    detail: "detail 必须保留",
    project: undefined,
  });

  const persisted = JSON.parse(JSON.stringify(ledger.orders[0]));

  assert.deepEqual(order, persisted, "内存 order 与 JSON 落盘后的 order 必须同形");
  assert.equal(persisted.detail, "detail 必须保留");
  assert.equal(Object.hasOwn(persisted, "project"), false);
});
