/**
 * company-dispatcher.mjs
 * P2 闭环：order -> route -> attempt -> wake -> report -> review -> done -> unlock deps.
 *
 * 状态机：
 *   queued -> routed -> running -> done
 *                    -> failed -> queued (requeue)
 *                    -> lost
 *   queued -> cancelled
 *   routed -> queued (路由失败回收) / cancelled
 *
 * v0.4 关键修复（工作网「下了任务但没人接」的根因）：
 *  1. 路由五级回退（resolveDepartment），不再因为 routingRules 为空直接 E_NO_DEPT。
 *  2. 依赖门禁在派工前用 isOrderReady 判断，不再靠 transitionOrder 抛 E_DEPS 把订单粘在 routed。
 *  3. attempt 索引改成「内存 + 账本」双读，宿主重启后老 attempt 仍能回报（或明确判 stale）。
 *  4. 改派前先吊销旧 attempt，避免两个 worker 同时改同一份产物。
 *  5. 冷启动 hydrate() 把所有 running 孤儿 attempt 判 stale 并把订单放回队列。
 *  6. 派工消息带工单详情、验收标准、attemptId 与执行要求。
 */

import {
  createOrder,
  transitionOrder,
  assignAttempt,
  getOrder,
  reportAttempt,
  isOrderReady,
  listLiveAttempts,
  markAttemptStale,
  ORDER_STATES,
  stripUndefined,
  LedgerError,
} from "../shared/company-ledger.mjs";
import { resolveDepartment, selectEmployee } from "../shared/company-router.mjs";
import { updateEmployee, EMPLOYEE_STATE } from "../shared/company-org.mjs";
import { normalizePlan } from "../shared/company-plan.mjs";
import { wakeAgent, SOURCE_KIND, newMessageId } from "./company-compat.mjs";

const PRIORITY_WEIGHT = { urgent: 0, high: 1, normal: 2, low: 3 };

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
    // 非数组、非非空字符串（undefined / 空串 / 空白串 / 其他类型）一律返回 undefined，
    // 交给 createOrder 的默认参数兜底成 []。原先这里写 `return Array.isArray(value) ? value : undefined;`
    // 是恒等变换——走到这一行时 Array.isArray(value) 必然为 false——容易被误读成「还留着原值」。
    return undefined;
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
      // 任务图专用：批次号与图内键。company_order 不传这两项，stripUndefined 会把它们删掉。
      group: typeof args.group === "string" && args.group.trim() !== "" ? args.group.trim() : undefined,
      taskKey: typeof args.taskKey === "string" && args.taskKey.trim() !== "" ? args.taskKey.trim() : undefined,
    };
  }

  /* ------------------------------------------------------------------ */
  /* attempt 索引：内存 Map + 账本双读                                    */
  /* ------------------------------------------------------------------ */

  function metaOf(attempt, orderId, orderState) {
    return {
      attemptId: attempt.id,
      orderId,
      orderState,
      employeeId: attempt.employee,
      sessionId: attempt.sessionId,
      startedAt: attempt.startedAt,
    };
  }

  /** 只用账本重建内存索引（不发唤醒、不写盘）。 */
  function rebuildIndexFromLedger() {
    activeAttempts.clear();
    for (const attempt of listLiveAttempts(runtime.ledger)) {
      activeAttempts.set(attempt.id, metaOf(attempt, attempt.orderId, attempt.orderState));
    }
    return activeAttempts.size;
  }

  /** 在账本里按 attemptId 找 attempt（不看存活状态），用于区分「已回报」与「已吊销」。 */
  function findAttemptInLedger(attemptId) {
    for (const order of runtime.ledger.orders || []) {
      const attempt = (order.attempts || []).find((a) => a.id === attemptId);
      if (attempt) return { order, attempt };
    }
    return null;
  }

  /** 内存找不到就回账本捞；捞到才算「还活着」。 */
  function findAttemptMeta(attemptId) {
    const hit = activeAttempts.get(attemptId);
    if (hit) return hit;
    for (const order of runtime.ledger.orders || []) {
      const attempt = (order.attempts || []).find((a) => a.id === attemptId);
      if (!attempt) continue;
      if (attempt.invalidated || attempt.endedAt) return null;
      const meta = metaOf(attempt, order.id, order.state);
      activeAttempts.set(meta.attemptId, meta);
      return meta;
    }
    return null;
  }

  /**
   * 冷启动恢复。
   * 宿主重启后子会话已经不存在，账本里所有 running attempt 都是孤儿：判 stale、
   * 订单经 failed 放回 queued，交给调度器用新 attempt 重跑（与 agent-teams 的
   * cold recovery 对齐）。
   */
  async function hydrate({ recoverOrphans = true } = {}) {
    const loaded = await store.load();
    runtime.ledger = loaded.ledger || runtime.ledger;
    runtime.company = loaded.company || runtime.company;
    rebuildIndexFromLedger();
    if (!recoverOrphans) return { ok: true, attempts: activeAttempts.size, recovered: [], orphaned: [] };

    const recovered = [];
    const orphaned = [];
    await withLedger(async () => {
      const runningOrders = (runtime.ledger.orders || []).filter((o) => o.state === ORDER_STATES.RUNNING).map((o) => o.id);
      for (const orderId of runningOrders) {
        const order = getOrder(runtime.ledger, orderId);
        if (!order || order.state !== ORDER_STATES.RUNNING) continue;
        const live = (order.attempts || []).filter((a) => !a.invalidated && !a.endedAt).map((a) => a.id);
        for (const attemptId of live) {
          runtime.ledger = markAttemptStale(runtime.ledger, orderId, attemptId, "host_restart");
        }
        runtime.ledger = transitionOrder(runtime.ledger, orderId, ORDER_STATES.FAILED);
        runtime.ledger = transitionOrder(runtime.ledger, orderId, ORDER_STATES.QUEUED);
        const current = getOrder(runtime.ledger, orderId);
        if (current) current.recoveredAt = new Date().toISOString();
        recovered.push(orderId);
      }
      // 终态订单下的孤儿 attempt：订单已 done/failed/cancelled/lost，attempt 却仍 running/queued 且无 endedAt。
      // 早期只扫 running 订单，这类 attempt 会永远留在活索引里，污染成本归因、工作网「执行中」与在办人数。
      for (const order of runtime.ledger.orders || []) {
        if (order.state === ORDER_STATES.RUNNING) continue;
        for (const attempt of order.attempts || []) {
          if (attempt.invalidated || attempt.endedAt) continue;
          if (attempt.state !== "running" && attempt.state !== "queued") continue;
          runtime.ledger = markAttemptStale(runtime.ledger, order.id, attempt.id, "orphan_terminal_order");
          orphaned.push({ orderId: order.id, attemptId: attempt.id });
        }
      }
      if (recovered.length || orphaned.length) {
        // 冷恢复：订单回队列了，成员也要从「working」放回 idle，否则调度器永远找不到人。
        for (const emp of runtime.company.employees || []) {
          if (emp.state !== EMPLOYEE_STATE.WORKING) continue;
          const busy = (runtime.ledger.orders || []).some((o) =>
            (o.attempts || []).some((a) => !a.invalidated && !a.endedAt && a.employee === emp.id),
          );
          if (busy) continue;
          runtime.company = updateEmployee(runtime.company, emp.id, {
            state: EMPLOYEE_STATE.IDLE,
            currentOrderId: null,
            currentAttemptId: null,
          });
        }
        rebuildIndexFromLedger();
        await persist();
        await store.saveCompany(runtime.company);
        if (recovered.length) {
          await append("attempts_recovered", { count: recovered.length, orders: recovered, reason: "host_restart" });
        }
        if (orphaned.length) {
          await append("attempts_orphan_reclaimed", { count: orphaned.length, attempts: orphaned });
        }
      }
      return { ok: true };
    });
    return { ok: true, attempts: activeAttempts.size, recovered, orphaned };
  }

  /**
   * 运行期搁浅恢复：订单在 running 但没有任何活 attempt（worker 崩了/回报丢了）。
   * 只在真正没有活 attempt 时动手，避免误杀正在干活的成员。
   */
  async function recoverStranded() {
    const stranded = (runtime.ledger.orders || [])
      .filter((o) => o.state === ORDER_STATES.RUNNING)
      .filter((o) => !(o.attempts || []).some((a) => !a.invalidated && !a.endedAt))
      .map((o) => o.id);
    if (!stranded.length) return { ok: true, recovered: [] };

    return withLedger(async () => {
      const recovered = [];
      for (const orderId of stranded) {
        const order = getOrder(runtime.ledger, orderId);
        if (!order || order.state !== ORDER_STATES.RUNNING) continue;
        for (const attempt of order.attempts || []) {
          if (!attempt.invalidated) runtime.ledger = markAttemptStale(runtime.ledger, orderId, attempt.id, "no_live_attempt");
        }
        runtime.ledger = transitionOrder(runtime.ledger, orderId, ORDER_STATES.FAILED);
        runtime.ledger = transitionOrder(runtime.ledger, orderId, ORDER_STATES.QUEUED);
        recovered.push(orderId);
      }
      rebuildIndexFromLedger();
      await persist();
      if (recovered.length) await append("attempts_recovered", { count: recovered.length, orders: recovered, reason: "no_live_attempt" });
      return { ok: true, recovered };
    });
  }

  /* ------------------------------------------------------------------ */
  /* 订单写入                                                            */
  /* ------------------------------------------------------------------ */

  async function placeOrder(input, now = new Date().toISOString()) {
    return withLedger(async () => {
      const { ledger, order } = createOrder(runtime.ledger, normalizeInput(input), now);
      runtime.ledger = ledger;
      await persist();
      await append("order_created", { orderId: order.id, clientOrderId: input.clientOrderId });
      // 出口再兜一层：这个返回值会原样成为工具结果，任何值为 undefined 的键都会让宿主
      // 判定非无损 JSON 而丢弃整个结果（订单却已落盘），调用方误以为失败就会重复下单。
      return { ok: true, orderId: order.id, order: stripUndefined(order) };
    });
  }

  /**
   * 任务图建单：一次提交多个任务与依赖，展开成多张订单。
   *
   * 依赖用图内 key 表达，建单时按拓扑层顺序映射成真实 orderId。第一层没有依赖，
   * 调度器下一轮就会把它们一起派出去——这就是「并行」；有依赖的等上游 done，
   * 由既有的 isOrderReady 门禁自动放行。
   */
  async function placePlan(input, now = new Date().toISOString()) {
    const plan = normalizePlan(input);
    if (!plan.ok) return plan;

    const rawGroup = typeof input?.group === "string" ? input.group.trim() : "";
    const group = rawGroup || `P${now.replace(/[-:T.Z]/g, "").slice(0, 14)}`;

    return withLedger(async () => {
      const keyToOrderId = new Map();
      const orders = [];
      for (let layerIndex = 0; layerIndex < plan.layers.length; layerIndex++) {
        for (const task of plan.layers[layerIndex]) {
          const deps = task.deps.map((key) => keyToOrderId.get(key)).filter(Boolean);
          const res = createOrder(
            runtime.ledger,
            normalizeInput({ ...task, deps, group, taskKey: task.key }),
            now,
          );
          runtime.ledger = res.ledger;
          keyToOrderId.set(task.key, res.order.id);
          orders.push({ key: task.key, orderId: res.order.id, deps: task.deps, layer: layerIndex });
        }
      }
      await persist();
      await append("plan_created", { group, count: orders.length, keys: orders.map((o) => o.key) });
      return stripUndefined({
        ok: true,
        group,
        count: orders.length,
        parallel: plan.layers[0].length,
        layers: plan.layers.map((layer) => layer.map((task) => task.key)),
        orders,
      });
    });
  }

  /** queued/failed → routed；已经 routed/running 时保持幂等。 */
  async function routeOrder(orderId, now = new Date().toISOString()) {
    return withLedger(async () => {
      let order = getOrder(runtime.ledger, orderId);
      if (!order) return { ok: false, code: "E_ORDER_NOT_FOUND" };
      if (order.state === ORDER_STATES.ROUTED || order.state === ORDER_STATES.RUNNING) return { ok: true, orderId, state: order.state };
      if (order.state === ORDER_STATES.FAILED) {
        runtime.ledger = transitionOrder(runtime.ledger, orderId, ORDER_STATES.QUEUED);
        order = getOrder(runtime.ledger, orderId);
      }
      if (getOrder(runtime.ledger, orderId).state !== ORDER_STATES.QUEUED) {
        return { ok: false, code: "E_INVALID_STATE", message: `订单状态 ${getOrder(runtime.ledger, orderId).state} 不可路由` };
      }
      runtime.ledger = transitionOrder(runtime.ledger, orderId, ORDER_STATES.ROUTED);
      await persist();
      await append("order_routed", { orderId });
      return { ok: true, orderId, state: ORDER_STATES.ROUTED };
    });
  }

  function dispatchMessage(order, employee, attemptId) {
    const lines = [
      `## 派工单 ${order.id}`,
      `- 标题：${order.title || "(未命名)"}`,
      order.project ? `- 项目：${order.project}` : "",
      order.detail ? `- 说明：${order.detail}` : "",
      `- 类型：${order.type} · 优先级：${order.priority || "normal"}`,
      `- 你：${employee.code ? employee.code + " " : ""}${employee.displayName || employee.id}（${employee.id}）`,
      `- attemptId：${attemptId}（回报必填，不要漏）`,
      order.deps && order.deps.length ? `- 前置依赖（已完成）：${order.deps.join("、")}` : "",
    ];
    if (Array.isArray(order.acceptance) && order.acceptance.length) {
      lines.push("", "## 验收标准");
      for (const a of order.acceptance) lines.push(`- ${a}`);
    }
    lines.push(
      "",
      "## 执行要求",
      "1. 先调用 company_accept 确认接单（携带 attemptId）。",
      "2. 按验收标准执行；需要读写文件、跑命令时使用宿主工具。",
      "3. 完成后调用 company_report 回报 summary / artifacts / acceptanceResults，attemptId 必填。",
      "4. 遇到阻塞调用 company_ask_help；需要上级决策调用 company_escalate。",
    );
    return lines.filter(Boolean).join("\n");
  }

  /**
   * 派工并唤醒。
   * superseded：改派时旧的活 attempt 会先被吊销，避免两个 worker 抢同一份产物。
   */
  async function assignAndWake(orderId, employeeId, options = {}) {
    const { routeReason = null, borrowed = false } = options;
    return withLedger(async () => {
      const emp = runtime.company.employees.find((e) => e.id === employeeId);
      if (!emp) return { ok: false, code: "E_EMPLOYEE_NOT_FOUND" };
      if (emp.state === "fired" || emp.state === "retired") return { ok: false, code: "E_EMPLOYEE_RETIRED" };

      // 一个人同时只能干一个活。per_task 策略下，同一员工的新任务会 end() 掉旧会话
      // （ensureSession 里 `if (existing && PER_TASK) end(employee.id, true)`），
      // 旧 attempt 就永远等不到 report，只能卡在「执行中」等重启回收。
      // 这条门禁是双保险：正常情况下 selectEmployee 会因 state=working 而跳过这个人。
      // 排除本单自己的 attempt：改派本单时后面会先把它们 superseded 吊销，不该被这条门禁误伤。
      const busy = (runtime.ledger.orders || [])
        .flatMap((o) => (o.attempts || []).map((a) => ({ attempt: a, orderId: o.id })))
        .find(
          (x) =>
            x.attempt.employee === employeeId &&
            x.orderId !== orderId &&
            !x.attempt.invalidated &&
            !x.attempt.endedAt,
        );
      if (busy) {
        return {
          ok: false,
          code: "E_EMPLOYEE_BUSY",
          message: `员工 ${employeeId} 正在处理订单 ${busy.orderId}`,
        };
      }

      let order = getOrder(runtime.ledger, orderId);
      if (!order) return { ok: false, code: "E_ORDER_NOT_FOUND" };
      // failed 也会返回 isTerminal，但它是「可重跑」的终态：下面 322 行就有 failed -> queued 的恢复路径。
      // 早期这里一刀切拦掉了 failed，导致工作网里失败的单一辈子卡在「异常」泳道，派工按钮点了报 E_TERMINAL_STATE。
      if (isTerminal(order.state) && order.state !== ORDER_STATES.FAILED) {
        return { ok: false, code: "E_TERMINAL_STATE", message: `订单状态 ${order.state}` };
      }

      // 依赖门禁（显式判定，不靠抛错）
      const unmet = (order.deps || []).filter((depId) => {
        const dep = getOrder(runtime.ledger, depId);
        return !dep || dep.state !== ORDER_STATES.DONE;
      });
      if (unmet.length) return { ok: false, code: "E_DEPS", blockedBy: unmet };

      // 改派：先把旧的活 attempt 全部吊销
      const superseded = [];
      for (const attempt of order.attempts || []) {
        if (attempt.invalidated || attempt.endedAt) continue;
        runtime.ledger = markAttemptStale(runtime.ledger, orderId, attempt.id, "superseded");
        superseded.push(attempt.id);
      }

      // 状态推进到 running
      order = getOrder(runtime.ledger, orderId);
      if (order.state === ORDER_STATES.FAILED) {
        runtime.ledger = transitionOrder(runtime.ledger, orderId, ORDER_STATES.QUEUED);
        order = getOrder(runtime.ledger, orderId);
      }
      if (order.state === ORDER_STATES.QUEUED) {
        runtime.ledger = transitionOrder(runtime.ledger, orderId, ORDER_STATES.ROUTED);
        order = getOrder(runtime.ledger, orderId);
      }
      if (order.state === ORDER_STATES.ROUTED) {
        runtime.ledger = transitionOrder(runtime.ledger, orderId, ORDER_STATES.RUNNING);
        order = getOrder(runtime.ledger, orderId);
      }
      if (order.state !== ORDER_STATES.RUNNING) {
        return { ok: false, code: "E_INVALID_TRANSITION", message: `订单状态 ${order.state}` };
      }
      if (order.deptRoute === undefined && routeReason) order.deptRoute = emp.department || null;
      if (routeReason) order.routeReason = routeReason;

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
        const now = getOrder(runtime.ledger, orderId);
        if (now && now.state === ORDER_STATES.RUNNING) {
          runtime.ledger = transitionOrder(runtime.ledger, orderId, ORDER_STATES.FAILED);
          runtime.ledger = transitionOrder(runtime.ledger, orderId, ORDER_STATES.QUEUED);
        }
        await persist();
        await append("assign_failed", { orderId, employeeId, code, message });
        return { ok: false, code, message };
      }

      const { ledger, attempt } = assignAttempt(runtime.ledger, orderId, employeeId, session.sessionId);
      runtime.ledger = ledger;
      runtime.company = updateEmployee(runtime.company, employeeId, {
        state: EMPLOYEE_STATE.WORKING,
        lastUsed: Date.now(),
        currentOrderId: orderId,
        currentAttemptId: attempt.id,
        lastActiveAt: Date.now(),
      });
      activeAttempts.set(attempt.id, metaOf(attempt, orderId, ORDER_STATES.RUNNING));
      // 员工状态必须落盘：withLedger 每次都从 store 重载 company，只 saveLedger 的话
      // 刚派出去的人在下一轮又变回 idle，同一个员工会被连派两个活（见上面 E_EMPLOYEE_BUSY 的注释）。
      await store.saveCompany(runtime.company);
      await persist();
      await append("attempt_assigned", {
        orderId,
        attemptId: attempt.id,
        employeeId,
        sessionId: session.sessionId,
        routeReason,
        borrowed,
        superseded,
      });

      const userMessage = {
        id: newMessageId(`order-${attempt.id}`),
        role: "user",
        content: [{ type: "text", text: dispatchMessage(order, emp, attempt.id) }],
        source: { kind: SOURCE_KIND, attemptId: attempt.id, orderId },
      };
      const woke = await wakeAgent({
        agents: runtime.ctx.get("agents"),
        subagents: runtime.ctx.get("subagents"),
        sessionId: session.sessionId,
        parentAgent: runtime.ownerAgent,
        userMessage,
        provider: runtime.provider,
        cwd: runtime.dataDir,
      });
      if (!woke || woke.ok === false) {
        // 叫不醒就别占着 running：吊销 attempt 并退回队列，下一轮换方式重试。
        runtime.ledger = markAttemptStale(runtime.ledger, orderId, attempt.id, "wake_failed");
        const now = getOrder(runtime.ledger, orderId);
        if (now && now.state === ORDER_STATES.RUNNING) {
          runtime.ledger = transitionOrder(runtime.ledger, orderId, ORDER_STATES.FAILED);
          runtime.ledger = transitionOrder(runtime.ledger, orderId, ORDER_STATES.QUEUED);
        }
        runtime.company = updateEmployee(runtime.company, employeeId, { state: EMPLOYEE_STATE.IDLE, currentOrderId: null, currentAttemptId: null });
        await store.saveCompany(runtime.company);
        await persist();
        await append("wake_failed", { orderId, employeeId, attemptId: attempt.id, code: woke?.code || "E_NO_SESSION" });
        return { ok: false, code: woke?.code || "E_NO_SESSION", message: woke?.message || "无法唤醒成员会话" };
      }
      return {
        ok: true,
        attemptId: attempt.id,
        sessionId: woke.sessionId || session.sessionId,
        // 兼容旧返回：面板/测试把子会话 id 叫 childId
        childId: woke.sessionId || session.sessionId,
        employeeId,
        superseded,
        woken: woke.resumed ? "resumed" : "restarted",
      };
    });
  }

  /**
   * 把「路由过但没派出去」的订单放回队列。
   * routed 状态没有任何 worker 在跑，留着只会让调度器永远扫不到它。
   */
  async function requeueIfRouted(orderId) {
    try {
      const order = getOrder(runtime.ledger, orderId);
      if (!order || order.state !== ORDER_STATES.ROUTED) return false;
      runtime.ledger = transitionOrder(runtime.ledger, orderId, ORDER_STATES.QUEUED);
      await persist();
      return true;
    } catch (err) {
      logger?.warn?.(`requeueIfRouted(${orderId}) 失败：${err.message}`);
      return false;
    }
  }

  function liveAttemptsOfDept(deptId) {
    const empDept = new Map((runtime.company.employees || []).map((e) => [e.id, e.department]));
    return listLiveAttempts(runtime.ledger).filter(
      (a) => a.orderState === ORDER_STATES.RUNNING && empDept.get(a.employee) === deptId,
    );
  }

  async function noteRouteFailure(orderId, code, detail) {
    try {
      const order = getOrder(runtime.ledger, orderId);
      if (!order) return;
      order.routeError = detail ? `${code}: ${detail}` : code;
      order.routeErrorAt = new Date().toISOString();
      // 避免热循环：同一条订单 10s 内不重复尝试
      order.retryAfter = Date.now() + 10000;
      await persist();
    } catch (err) {
      logger?.warn?.(`noteRouteFailure: ${err.message}`);
    }
  }

  /**
   * 调度入口：路由 + 选人 + 派工。
   * 返回结构化诊断（code/reason/deptId），让面板能解释「为什么没派出去」。
   */
  async function routeAndAssign(orderId) {
    const snapshot = getOrder(runtime.ledger, orderId);
    if (!snapshot) return { ok: false, code: "E_ORDER_NOT_FOUND" };
    if (isTerminal(snapshot.state)) return { ok: false, code: "E_TERMINAL_STATE" };
    if (!isOrderReady(runtime.ledger, orderId)) {
      const unmet = (snapshot.deps || []).filter((depId) => getOrder(runtime.ledger, depId)?.state !== ORDER_STATES.DONE);
      return { ok: false, code: "E_DEPS", blockedBy: unmet };
    }

    const routed = await routeOrder(orderId);
    if (!routed.ok) return routed;

    const order = getOrder(runtime.ledger, orderId);
    const route = resolveDepartment({ order, rules: runtime.config.routingRules || [], company: runtime.company });
    if (!route.deptId) {
      await noteRouteFailure(orderId, "E_NO_DEPT", route.reason);
      await requeueIfRouted(orderId);
      return { ok: false, code: "E_NO_DEPT", reason: route.reason };
    }
    const dept = (runtime.company.departments || []).find((d) => d.id === route.deptId) || null;
    const capacity = Number(dept?.capacity) || 4;
    const live = liveAttemptsOfDept(route.deptId);
    if (live.length >= capacity) {
      await noteRouteFailure(orderId, "E_CAPACITY", `${dept?.name || route.deptId} 在跑 ${live.length}/${capacity}`);
      // 容量满不是订单的错：退回 queued 等下一轮，别把它粘在 routed。
      await requeueIfRouted(orderId);
      return { ok: false, code: "E_CAPACITY", deptId: route.deptId, capacity, live: live.length };
    }

    // 自动派工只认正式员工：shared/temp 属于「借调」，必须走 company_borrow 显式动作。
    let picked = selectEmployee({
      company: runtime.company,
      deptId: route.deptId,
      order,
      attempts: order.attempts || [],
      includeShared: false,
    });
    let borrowed = false;
    if (!picked) {
      // 本部门没有空闲正式员工：跨部门找空闲人（仍然不自动借调）
      picked = selectEmployee({
        company: runtime.company,
        deptId: null,
        order,
        attempts: order.attempts || [],
        includeShared: false,
      });
      borrowed = Boolean(picked);
    }
    if (!picked) {
      await noteRouteFailure(orderId, "E_NO_EMPLOYEE", `部门 ${route.deptId} 无空闲成员`);
      await requeueIfRouted(orderId);
      return { ok: false, code: "E_NO_EMPLOYEE", deptId: route.deptId, reason: route.reason };
    }

    const result = await assignAndWake(orderId, picked.id, { routeReason: route.reason, borrowed });
    return { ...result, deptId: route.deptId, routeReason: route.reason, borrowed };
  }

  /**
   * 手动派工（面板/经理指定到人）。不带 deptId，尊重指定。
   */
  async function dispatchOrder(orderId, employeeId) {
    if (employeeId) return assignAndWake(orderId, employeeId, { routeReason: "manual" });
    return routeAndAssign(orderId);
  }

  async function report({ attemptId, orderId, status, summary, artifacts, acceptanceResults }) {
    const known = findAttemptMeta(attemptId);
    if (!known) {
      // 分两种情况说清楚：吊销过（stale）vs 已经回报过（duplicate），面板要能区分。
      const existing = findAttemptInLedger(attemptId);
      if (existing && existing.attempt.invalidated) {
        return {
          ok: false,
          code: "E_STALE_ATTEMPT",
          message: `attempt 已被吊销（${existing.attempt.staleReason || "superseded"}）`,
        };
      }
      if (existing && existing.attempt.endedAt) {
        return { ok: false, code: "E_DUPLICATE_REPORT", message: "该 attempt 已回报过，忽略重复提交" };
      }
      return { ok: false, code: "E_STALE_ATTEMPT", message: "attempt 不存在或已被吊销/回收" };
    }
    if (orderId && orderId !== known.orderId) return { ok: false, code: "E_STALE_ATTEMPT", message: "attempt 与订单不匹配" };

    return withLedger(async () => {
      // 锁内重读：重启/改派后内存索引可能落后于账本
      const meta = findAttemptMeta(attemptId) || known;
      const payload = { summary, artifacts: artifacts || [], acceptanceResults: acceptanceResults || [] };
      const res = reportAttempt(runtime.ledger, meta.orderId, attemptId, status, payload);
      runtime.ledger = res.ledger;
      activeAttempts.delete(attemptId);

      const emp = (runtime.company.employees || []).find((e) => e.id === meta.employeeId);
      if (emp && emp.kind === "temp") {
        // 临时工：按次计费/计数，达到上限自动退场
        const completed = (Number(emp.tempCompleted) || 0) + 1;
        const cap = Number(emp.tempMaxTasks) || 0;
        const exhausted = cap > 0 && completed >= cap;
        runtime.company = updateEmployee(runtime.company, emp.id, {
          tempCompleted: completed,
          currentOrderId: null,
          currentAttemptId: null,
          lastActiveAt: Date.now(),
          ...(exhausted ? { state: "retired" } : { state: EMPLOYEE_STATE.IDLE }),
        });
        if (exhausted) await append("temp_released", { employeeId: emp.id, completed, cap });
      } else {
        runtime.company = updateEmployee(runtime.company, meta.employeeId, {
          state: EMPLOYEE_STATE.IDLE,
          currentOrderId: null,
          currentAttemptId: null,
          lastActiveAt: Date.now(),
        });
      }

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
        for (const attempt of order.attempts || []) {
          if (!attempt.invalidated && !attempt.endedAt) {
            runtime.ledger = markAttemptStale(runtime.ledger, orderId, attempt.id, "order_cancelled");
            activeAttempts.delete(attempt.id);
          }
        }
      } else if (state === ORDER_STATES.QUEUED || state === ORDER_STATES.ROUTED) {
        runtime.ledger = transitionOrder(runtime.ledger, orderId, ORDER_STATES.CANCELLED);
      } else if (state === ORDER_STATES.FAILED) {
        // 账本转移表本来允许 failed → cancelled（company-ledger.mjs:121）。
        // 工具层早前把 failed 归进 else 一拒了之，结果是异常泳道里的失败单永远清不掉：
        // 取消被拒、也没人会自愈，只能靠 review(pass) 假装验收通过。这里补上正路。
        for (const attempt of order.attempts || []) {
          if (!attempt.invalidated && !attempt.endedAt) {
            runtime.ledger = markAttemptStale(runtime.ledger, orderId, attempt.id, "order_cancelled");
            activeAttempts.delete(attempt.id);
          }
        }
        const failedNow = getOrder(runtime.ledger, orderId);
        if (failedNow && failedNow.state === ORDER_STATES.FAILED) {
          runtime.ledger = transitionOrder(runtime.ledger, orderId, ORDER_STATES.CANCELLED);
        }
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
    // 注意：store 的锁不可重入，校验完必须退出锁再走 assignAndWake（它自己加锁）
    const order = getOrder(runtime.ledger, orderId);
    if (!order) return { ok: false, code: "E_NOT_FOUND", message: "订单不存在" };
    if (isTerminal(order.state)) return { ok: false, code: "E_INVALID_STATE", message: `订单状态 ${order.state} 已终态` };

    const emp = (runtime.company.employees || []).find((e) => e.id === sharedEmployeeId);
    if (!emp) return { ok: false, code: "E_NOT_FOUND", message: `员工 ${sharedEmployeeId} 不存在` };
    if (emp.kind !== "shared" && emp.kind !== "temp") {
      return { ok: false, code: "E_INVALID_STATE", message: "仅可借调 shared / temp 员工" };
    }
    if (emp.state === "working" || emp.state === "retired" || emp.state === "fired") {
      return { ok: false, code: "E_INVALID_STATE", message: "该员工不可用" };
    }
    return assignAndWake(orderId, sharedEmployeeId, { routeReason: "borrow", borrowed: true });
  }

  async function askHelp(attemptId, question, sessionId) {
    return withLedger(async () => {
      let orderId = null;
      for (const o of runtime.ledger.orders || []) {
        const a = (o.attempts || []).find((x) => x.id === attemptId);
        if (a) {
          orderId = o.id;
          break;
        }
      }
      if (!orderId) return { ok: false, code: "E_NOT_FOUND" };
      const order = getOrder(runtime.ledger, orderId);
      const attempt = (order.attempts || []).find((a) => a.id === attemptId);
      if (!attempt || attempt.invalidated) return { ok: false, code: "E_STALE_ATTEMPT" };
      attempt.helpRequestedAt = new Date().toISOString();
      attempt.helpQuestion = question || "";
      // 找到部门经理就把求助转给他（以前恒为 null，等于没有求助通道）
      const emp = (runtime.company.employees || []).find((e) => e.id === attempt.employee);
      const dept = (runtime.company.departments || []).find((d) => d.id === emp?.department);
      const manager = (runtime.company.employees || []).find(
        (e) => e.department === dept?.id && e.role === "manager",
      );
      await persist();
      await append("attempt_help_requested", { orderId, attemptId, question: question || "", sessionId, forwardedTo: manager?.id || null });
      return { ok: true, orderId, attemptId, forwardedTo: manager?.id || null };
    });
  }

  /**
   * 临时工退场扫描：到期且手上没有活 attempt 的临时工置 retired。
   * 有活在干的先留着，等它回报后由 report() 按次数回收。
   */
  async function sweepTemps(now = Date.now()) {
    const expired = (runtime.company.employees || []).filter(
      (e) =>
        e.kind === "temp" &&
        e.state !== "retired" &&
        e.state !== "fired" &&
        e.tempExpiresAt &&
        Number.isFinite(Date.parse(e.tempExpiresAt)) &&
        Date.parse(e.tempExpiresAt) <= now,
    );
    if (!expired.length) return { ok: true, released: [] };
    return withLedger(async () => {
      const live = new Set(listLiveAttempts(runtime.ledger).map((a) => a.employee));
      const released = [];
      for (const emp of expired) {
        if (live.has(emp.id)) continue;
        runtime.company = updateEmployee(runtime.company, emp.id, {
          state: "retired",
          currentOrderId: null,
          currentAttemptId: null,
        });
        released.push(emp.id);
      }
      if (released.length) {
        await store.saveCompany(runtime.company);
        await append("temp_released", { employees: released, reason: "expired" });
      }
      return { ok: true, released };
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
    placePlan,
    routeOrder,
    assignAndWake,
    routeAndAssign,
    dispatchOrder,
    report,
    review,
    completeOrder,
    cancelOrder,
    escalate,
    borrow,
    askHelp,
    findAttemptMetaBySessionId,
    findAttemptMeta,
    hydrate,
    recoverStranded,
    rebuildIndexFromLedger,
    sweepTemps,
    activeAttempts,
  };
}
