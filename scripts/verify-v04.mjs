#!/usr/bin/env node
/**
 * verify-v04.mjs —— v0.4「下达任务 → 真的分配到成员」端到端自检
 *
 * 与单测不同：这里用**真实** CompanyStore（落盘到临时目录）+ 真实 ledger/scheduler/dispatcher，
 * 只把宿主的 agents/subagents 换成记录型假适配器。跑完即删临时目录。
 *
 * 用法：node scripts/verify-v04.mjs        # 退出码 0 全通过
 */

import { rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createDispatcher } from "../src/host/company-dispatcher.mjs";
import { createScheduler } from "../src/host/company-scheduler.mjs";
import { createEmployeeSessionManager } from "../src/host/company-employees.mjs";
import { CompanyStore } from "../src/shared/company-store.mjs";
import { emptyCompany, createDepartment, createEmployee, EMPLOYEE_STATE } from "../src/shared/company-org.mjs";
import { emptyLedger, ORDER_STATES } from "../src/shared/company-ledger.mjs";

const log = console.log;
const results = [];
function ok(name, detail) {
  results.push({ name, ok: true, detail: detail == null ? "" : String(detail) });
  log(`  ✓ ${name}${detail ? " · " + detail : ""}`);
}
function bad(name, detail) {
  results.push({ name, ok: false, detail: detail == null ? "" : String(detail) });
  log(`  ✗ ${name}${detail ? " · " + detail : ""}`);
}
function must(name, cond, detail) {
  if (cond) ok(name, detail);
  else bad(name, detail);
}

let seq = 0;
function makeCtx() {
  const started = [];
  return {
    started,
    get(name) {
      if (name === "subagents") {
        return {
          async startActivation(arg) {
            seq += 1;
            started.push(arg);
            return { childId: `session-${seq}`, cancel() {}, dispose() {} };
          },
        };
      }
      if (name === "agents") return { async get() { return null; } };
      return undefined;
    },
  };
}

function makeRuntime(ctx, config = {}) {
  let company = emptyCompany();
  company = createDepartment(company, { id: "D-A", name: "工程部", code: "D01", accepts: ["修复", "开发"], capacity: 2 });
  company = createDepartment(company, { id: "D-B", name: "文档部", code: "D02", accepts: ["文档"], capacity: 2 });
  for (const id of ["e1", "e2"]) {
    company = createEmployee(company, { id, displayName: `员工${id.slice(1)}`, department: "D-A", role: "staff", skills: ["typescript"], state: "idle" });
  }
  company = createEmployee(company, { id: "e3", displayName: "文档员", department: "D-B", role: "staff", skills: ["docs"], state: "idle" });
  return {
    ctx,
    company,
    config: Object.assign({ routingRules: [], limits: {} }, config),
    provider: "verify",
    ledger: emptyLedger(),
    ownerAgent: { id: "owner" },
    logger: console,
  };
}

async function setup(tag) {
  const ctx = makeCtx();
  const runtime = makeRuntime(ctx);
  const dataDir = path.join(os.tmpdir(), `dsh-mm-verify-${tag}-${Date.now()}-${seq}`);
  runtime.dataDir = dataDir;
  const store = new CompanyStore(dataDir);
  await store.saveCompany(runtime.company);
  const employeeManager = createEmployeeSessionManager({ runtime, logger: console });
  const dispatcher = createDispatcher({ runtime, store, employeeManager, logger: console });
  const scheduler = createScheduler({ runtime, dispatcher, logger: console, intervalMs: 5000 });
  runtime.scheduler = scheduler;
  return { ctx, runtime, store, dispatcher, scheduler, dataDir };
}

const orderOf = (rt, id) => rt.ledger.orders.find((o) => o.id === id);
const empOf = (rt, id) => rt.company.employees.find((e) => e.id === id);

async function main() {
  log("\n== A. 下达任务后真的分配到成员（routingRules 为空，靠部门 accepts 回退）==");
  const s = await setup("main");
  try {
    const place = await s.dispatcher.placeOrder({
      type: "code_impl",
      title: "修复登录闪退",
      detail: "登录页点了就崩",
      acceptance: "点击登录不再闪退",
      priority: "high",
    });
    must("订单创建即 queued", orderOf(s.runtime, place.orderId).state === ORDER_STATES.QUEUED);

    await s.scheduler.tick();
    const o1 = orderOf(s.runtime, place.orderId);
    must("调度器一轮内把订单派出去", o1.state === ORDER_STATES.RUNNING, `state=${o1.state}`);
    const live = (o1.attempts || []).filter((a) => !a.invalidated);
    must("生成活的 attempt", live.length === 1, `attempts=${(o1.attempts || []).length}`);
    must("订单上直接可读当前执行人", !!o1.employee, `employee=${o1.employee}`);
    const emp = empOf(s.runtime, o1.employee);
    must("被派到 accepts 命中的部门", emp.department === "D-A", `dept=${emp.department}`);
    must("成员状态转为 working 并记住当前订单", emp.state === EMPLOYEE_STATE.WORKING && emp.currentOrderId === place.orderId, `${emp.state}/${emp.currentOrderId}`);
    must("真的唤醒了成员会话", s.ctx.started.length >= 1, `activations=${s.ctx.started.length}`);
    const wake = JSON.stringify(s.ctx.started.at(-1));
    must("唤起消息是完整派工单", ["修复登录闪退", "点击登录不再闪退", live[0].id, "company_report"].every((x) => wake.includes(x)));

    log("\n== B. 容量门禁：不超派，派不出去的订单回 queued（不粘死在 routed）==");
    const p2 = await s.dispatcher.placeOrder({ type: "bugfix", title: "修复导出乱码" });
    const p3 = await s.dispatcher.placeOrder({ type: "bugfix", title: "修复上传超时" });
    const p4 = await s.dispatcher.placeOrder({ type: "bugfix", title: "修复第三单" });
    await s.scheduler.tick();
    const states = [p2, p3, p4].map((p) => orderOf(s.runtime, p.orderId).state);
    const deptBusy = s.runtime.ledger.orders.filter((o) => o.state === ORDER_STATES.RUNNING).length;
    must("容量 2 的部门在跑不超过 2 单", deptBusy <= 2, `running=${deptBusy} · ${states.join(",")}`);
    must("超出的订单没有并行开工", states.filter((x) => x === ORDER_STATES.RUNNING).length <= 1, states.join(","));
    const overflow = [p2, p3, p4].map((p) => orderOf(s.runtime, p.orderId)).find((o) => o.state !== ORDER_STATES.RUNNING);
    must("超出的订单回到 queued", overflow.state === ORDER_STATES.QUEUED, `state=${overflow.state}`);
    must("路由失败原因可查", !!overflow.routeError, `routeError=${overflow.routeError}`);

    log("\n== C. 依赖门禁：上游未完成不派工，上游完成后自动接走 ==");
    const up = await s.dispatcher.placeOrder({ type: "文档", title: "写接口文档" });
    const down = await s.dispatcher.placeOrder({ type: "文档", title: "写用户手册", deps: [up.orderId] });
    await s.scheduler.tick();
    const upOrder = orderOf(s.runtime, up.orderId);
    must("上游被派工", upOrder.state === ORDER_STATES.RUNNING, `state=${upOrder.state} · ${upOrder.routeError || ""}`);
    must("下游仍是 queued（依赖未满足）", orderOf(s.runtime, down.orderId).state === ORDER_STATES.QUEUED);
    const upAttempt = (upOrder.attempts || []).at(-1);
    must("上游有活 attempt", !!upAttempt, upAttempt && upAttempt.id);
    if (!upAttempt) throw new Error("上游未派工，后续断言无意义");
    const rep = await s.dispatcher.report({ attemptId: upAttempt.id, status: "done", summary: "文档已提交" });
    must("上游回报成功", rep.ok === true, JSON.stringify(rep));
    const rev = await s.dispatcher.review({ orderId: up.orderId, pass: true });
    must("上游验收通过", rev.ok === true, JSON.stringify(rev));
    must("上游进入 done", orderOf(s.runtime, up.orderId).state === ORDER_STATES.DONE);
    await s.scheduler.tick();
    must("下游解除阻塞被接走", orderOf(s.runtime, down.orderId).state === ORDER_STATES.RUNNING, `state=${orderOf(s.runtime, down.orderId).state}`);

    log("\n== D. 重复回报不污染账本 ==");
    const dup = await s.dispatcher.report({ attemptId: upAttempt.id, status: "done", summary: "又交一遍" });
    must("重复回报被拒", dup.ok === false && dup.code === "E_DUPLICATE_REPORT", JSON.stringify(dup));

    log("\n== E. 重启冷恢复：重启后旧 attempt 吊销、订单重派（attemptNo+1）==");
    const before = orderOf(s.runtime, place.orderId).attempts.filter((a) => !a.invalidated).length;
    await s.store.saveCompany(s.runtime.company);
    const store2 = new CompanyStore(s.dataDir);
    const loaded2 = await store2.load();
    const runtime2 = makeRuntime(makeCtx());
    runtime2.company = loaded2.company || runtime2.company;
    runtime2.ledger = loaded2.ledger || runtime2.ledger;
    runtime2.dataDir = s.dataDir;
    const em2 = createEmployeeSessionManager({ runtime: runtime2, logger: console });
    const d2 = createDispatcher({ runtime: runtime2, store: store2, employeeManager: em2, logger: console });
    const recovered = await d2.hydrate({ recoverOrphans: true });
    must("hydrate 报告回收数量", !!recovered && Array.isArray(recovered.recovered) && recovered.recovered.length > 0, JSON.stringify(recovered && recovered.recovered));
    const oFirst = orderOf(runtime2, place.orderId);
    must("重启后在跑的订单被重新排队", oFirst.state === ORDER_STATES.QUEUED || oFirst.state === ORDER_STATES.FAILED, `state=${oFirst.state}`);
    const sched2 = createScheduler({ runtime: runtime2, dispatcher: d2, logger: console, intervalMs: 5000 });
    await sched2.tick();
    const oAfter = orderOf(runtime2, place.orderId);
    must("重启后能重新派工", oAfter.state === ORDER_STATES.RUNNING, `state=${oAfter.state}`);
    must("重派生成第二次 attempt", (oAfter.attempts || []).length > before, `attempts=${(oAfter.attempts || []).length}`);

    log("\n== F. 临时工：借调派工 → 回报后满额自动退场 ==");
    {
      const { createDepartment: mkDept, createEmployee: mkEmp } = await import("../src/shared/company-org.mjs");
      s.runtime.company = mkDept(s.runtime.company, { id: "D-C", name: "外包组", code: "D03", accepts: ["整理"], capacity: 2 });
      s.runtime.company = mkEmp(s.runtime.company, {
        id: "t1",
        displayName: "临时工甲",
        department: "D-C",
        role: "staff",
        kind: "temp",
        tempMaxTasks: 1,
        skills: ["整理"],
        state: "idle",
      });
      await s.store.saveCompany(s.runtime.company);
    }
    const temp = s.runtime.company.employees.find((e) => e.kind === "temp");
    must("临时工已入职", !!temp, temp && temp.id);
    const tOrder = await s.dispatcher.placeOrder({ type: "整理", title: "临时整理文档" });
    const tAssigned = await s.dispatcher.dispatchOrder(tOrder.orderId, temp.id);
    must("临时工可被派工", tAssigned.ok === true, JSON.stringify(tAssigned));
    const tAttempt = orderOf(s.runtime, tOrder.orderId).attempts.at(-1);
    const tRep = await s.dispatcher.report({ attemptId: tAttempt.id, status: "done", summary: "整理完" });
    must("临时工回报成功", tRep.ok === true, JSON.stringify(tRep));
    const tempAfter = empOf(s.runtime, temp.id);
    must("满额后临时工自动 retired", tempAfter.state === EMPLOYEE_STATE.RETIRED, `state=${tempAfter.state}`);

    log("\n== G. 面板数据面（view）==");
    const view = s.runtime.view ? s.runtime.view() : null;
    if (view) {
      must("view 带 board.pipeline 计数", !!view.board && !!view.board.byState, JSON.stringify(view.board && view.board.byState));
      must("view 带 health.capacity", Array.isArray(view.health && view.health.capacity), JSON.stringify(view.health && view.health.capacity));
      must("view 带 attempts 列表", Array.isArray(view.attempts) && view.attempts.length > 0, `attempts=${view.attempts && view.attempts.length}`);
    } else {
      ok("view 由宿主包装层提供，本脚本不重复验证");
    }
  } finally {
    await rm(s.dataDir, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  log(`\n—— 自检结果：${results.length - failed.length}/${results.length} 通过 ——`);
  if (failed.length) {
    for (const f of failed) log(`FAIL: ${f.name} · ${f.detail}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("自检脚本异常：", err);
  process.exitCode = 1;
});
