/**
 * company-plan.mjs
 * 任务图（DAG）校验与分层。
 *
 * 用途：一次提交多张订单，把「任务 + 依赖」展开成订单图。没有未满足依赖的
 * 任务处在同一层，因此可以被调度器在同一轮里并行派发；有依赖的等上游 done，
 * 由既有 isOrderReady 门禁自动放行。
 *
 * 纯函数，零依赖，不碰账本——建单与落盘由 dispatcher.placePlan 负责。
 */

const MAX_TASKS = 50;

function fail(code, message, extra) {
  return { ok: false, code, message, ...(extra || {}) };
}

/** 与 dispatcher.normalizeStringList 语义一致：字符串单值 / 数组过滤空串。 */
function normalizeList(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string" && value.trim() !== "") return [value.trim()];
  return [];
}

/**
 * @param {{ tasks?: Array<object> }} input
 * @returns {{ ok: true, tasks: object[], layers: object[][] } | { ok: false, code: string, message: string }}
 */
export function normalizePlan(input) {
  const rawTasks = Array.isArray(input?.tasks) ? input.tasks : [];
  if (!rawTasks.length) return fail("E_PLAN_EMPTY", "tasks 不能为空");
  if (rawTasks.length > MAX_TASKS) {
    return fail("E_PLAN_TOO_LARGE", `一次最多 ${MAX_TASKS} 个任务，收到 ${rawTasks.length}`);
  }

  const tasks = [];
  const seen = new Set();
  for (let i = 0; i < rawTasks.length; i++) {
    const raw = rawTasks[i] || {};
    const key = String(raw.key || `t${i + 1}`).trim();
    if (!key) return fail("E_PLAN_TASK_INVALID", `第 ${i + 1} 个任务缺少 key`);
    if (seen.has(key)) return fail("E_PLAN_DUP_KEY", `任务 key 重复：${key}`);
    if (!raw.type || !raw.title) {
      return fail("E_PLAN_TASK_INVALID", `任务 ${key} 缺少 type 或 title`);
    }
    seen.add(key);
    tasks.push({
      key,
      type: String(raw.type),
      title: String(raw.title),
      deps: normalizeList(raw.deps),
      priority: raw.priority,
      dept: raw.dept,
      project: raw.project,
      detail: raw.detail,
      acceptance: normalizeList(raw.acceptance),
    });
  }

  for (const task of tasks) {
    for (const dep of task.deps) {
      if (dep === task.key) return fail("E_PLAN_CYCLE", `任务 ${task.key} 依赖自己`);
      if (!seen.has(dep)) return fail("E_PLAN_BAD_REF", `任务 ${task.key} 依赖不存在的 key：${dep}`);
    }
  }

  // Kahn 分层：每层都是「此刻依赖已全部满足」的任务，可并行。
  const byKey = new Map(tasks.map((t) => [t.key, t]));
  const pending = new Map(tasks.map((t) => [t.key, new Set(t.deps)]));
  const layers = [];
  while (pending.size) {
    const layerKeys = [];
    for (const [key, deps] of pending) {
      if (deps.size === 0) layerKeys.push(key);
    }
    if (!layerKeys.length) {
      const cycle = [...pending.keys()];
      return fail("E_PLAN_CYCLE", `任务图存在环，无法排序：${cycle.join(" / ")}`, { cycle });
    }
    for (const key of layerKeys) pending.delete(key);
    for (const deps of pending.values()) {
      for (const key of layerKeys) deps.delete(key);
    }
    layers.push(layerKeys.map((key) => byKey.get(key)));
  }

  return { ok: true, tasks, layers };
}

/** 图宽度：第一层任务数，用来告诉调用方「这一批会同时起几个」。 */
export function firstLayerSize(layers) {
  return Array.isArray(layers) && layers.length ? layers[0].length : 0;
}
