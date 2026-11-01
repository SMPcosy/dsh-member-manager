#!/usr/bin/env node
/**
 * verify-panel-v04.mjs —— 走**真实面板 op 通道**验证 v0.4：
 * 面板按钮 → POST /company/op → runtime → scheduler → dispatcher → 唤醒成员。
 *
 * 与 verify-v04.mjs 的区别：那边直接调 dispatcher，这边必须经过 runtime 的
 * handleCompanyOp（也就是「工作网」看板上每个按钮真正走的那条路），
 * 并把 orgmap 快照用的 view() 数据面一起验一遍。
 *
 * 用法：node scripts/verify-panel-v04.mjs   # 退出码 0 全通过
 */

import { rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createCompanyRuntime } from "../src/host/company-runtime.mjs";

const log = console.log;
const results = [];
function must(name, cond, detail) {
  results.push({ name, ok: Boolean(cond), detail: detail == null ? "" : String(detail) });
  log(`  ${cond ? "✓" : "✗"} ${name}${detail ? " · " + detail : ""}`);
}

let seq = 0;
const started = [];
function makeCtx() {
  return {
    get(name) {
      if (name === "subagents") {
        return {
          async startActivation(arg) {
            seq += 1;
            started.push(arg);
            return { childId: `sess-${seq}`, cancel() {}, dispose() {} };
          },
        };
      }
      if (name === "agents") {
        return {
          async get() { return null; },
          async resume() { return null; },
        };
      }
      return undefined;
    },
    effect() { return () => {}; },
  };
}

const URL_OP = "http://localhost/company/op";
function opCaller(rt) {
  const route = rt.routes.find((r) => r.method === "POST" && r.path === "/company/op");
  if (!route) throw new Error("未注册 POST /company/op 路由");
  return (action, args) => route.handler({}, new URL(URL_OP), { action, args });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dataDir = path.join(os.tmpdir(), `dsh-mm-panel-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
  const rt = createCompanyRuntime(makeCtx(), { dataDir, config: { fake: true } });
  await rt.boot();
  const call = opCaller(rt);

  try {
    log("\n== 1. 组织与成员走面板 op ==");
    const d = await call("createDepartment", { id: "D-P", name: "产品部", code: "D01", accepts: ["需求", "文档"], capacity: 2 });
    must("createDepartment", d.ok === true, JSON.stringify(d).slice(0, 120));
    const e1 = await call("createEmployee", { id: "p1", displayName: "小产", department: "D-P", role: "staff", skills: ["需求"] });
    must("createEmployee", e1.ok === true, JSON.stringify(e1).slice(0, 120));

    log("\n== 2. 下达任务（placeOrder）→ 调度（runScheduler）→ 真派工 ==");
    const po = await call("placeOrder", { type: "需求", title: "写一份需求说明", priority: "high", acceptance: "含目标/范围/验收" });
    must("placeOrder 成功", po.ok === true, JSON.stringify(po).slice(0, 160));
    const orderId = po.orderId || (po.order && po.order.id);
    must("拿到订单号", Boolean(orderId), orderId);

    const tick = await call("runScheduler", {});
    must("runScheduler 可被面板触发", tick.ok !== false, JSON.stringify(tick).slice(0, 160));

    const v1 = rt.view();
    const order = v1.orders.find((o) => o.id === orderId);
    must("订单已进入 running", order && order.state === "running", order && order.state);
    must("订单落到了具体成员", order && order.employee === "p1", order && order.employee);
    must("订单带 attemptId", Boolean(order && order.attemptId), order && order.attemptId);
    const emp1 = v1.org.employees.find((e) => e.id === "p1");
    must("成员状态 working", emp1.state === "working", emp1.state);
    must("成员 currentAttemptId 与订单一致", emp1.currentAttemptId === order.attemptId, emp1.currentAttemptId);

    const dispatchMsg = started.map((s) => JSON.stringify(s.request || s.prompt || "")).join("\n");
    must("派工单含 attemptId", dispatchMsg.includes(order.attemptId), order.attemptId);
    must("派工单含验收标准", dispatchMsg.includes("含目标/范围/验收"));

    log("\n== 3. 面板数据面（工作网看板用的就是这些字段）==");
    must("view.board.byState.running ≥ 1", v1.board && v1.board.byState.running >= 1, v1.board && JSON.stringify(v1.board.byState));
    must("view.attempts 含该 attempt", Array.isArray(v1.attempts) && v1.attempts.some((a) => a.attemptId === order.attemptId));
    must("view.health.capacity 是数组", Array.isArray(v1.health && v1.health.capacity));
    must("view.health.scheduler 存在", Boolean(v1.health && v1.health.scheduler));

    log("\n== 4. 验收通过 → 订单 done、成员回 idle ==");
    const rev = await call("reviewOrder", { orderId, pass: true });
    must("reviewOrder(pass) 成功", rev.ok === true, JSON.stringify(rev).slice(0, 160));
    const v2 = rt.view();
    const done = v2.orders.find((o) => o.id === orderId);
    must("订单状态 done", done.state === "done", done.state);
    const emp2 = v2.org.employees.find((e) => e.id === "p1");
    must("成员回到 idle", emp2.state === "idle", emp2.state);

    log("\n== 5. 临时工（hireTemp / releaseTemp）==");
    const ht = await call("hireTemp", { displayName: "外包小临", department: "D-P", tempMaxTasks: 1 });
    must("hireTemp 成功", ht.ok === true, JSON.stringify(ht).slice(0, 200));
    const tempId = ht.employeeId || (ht.employee && ht.employee.id);
    const temp = tempId && rt.view().org.employees.find((e) => e.id === tempId);
    must("临时工已入职且 kind=temp", Boolean(temp) && temp.kind === "temp", temp && `${temp.id}/${temp.kind}/cap=${temp.tempMaxTasks}`);
    if (tempId) {
      const rt2 = await call("releaseTemp", { employeeId: tempId });
      must("releaseTemp 成功", rt2.ok === true, JSON.stringify(rt2).slice(0, 160));
      const gone = rt.view().org.employees.find((e) => e.id === tempId);
      must("临时工已退场", !gone || gone.state === "retired", gone && gone.state);
    }

    log("\n== 6. 定时器与自动派工 ==");
    const po2 = await call("placeOrder", { type: "文档", title: "自动派工验证单" });
    const orderId2 = po2.orderId || (po2.order && po2.order.id);
    await sleep(300);
    const v3 = rt.view();
    const auto = v3.orders.find((o) => o.id === orderId2);
    must("placeOrder 后无需手动 tick 即被派工", auto && auto.state === "running", auto && auto.state);
  } finally {
    await rt.shutdown();
    await rm(dataDir, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  log(`\n—— 面板链路自检：${results.length - failed.length}/${results.length} 通过 ——`);
  if (failed.length) {
    for (const f of failed) log(`FAIL: ${f.name} · ${f.detail}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("自检脚本异常：", err);
  process.exitCode = 1;
});
