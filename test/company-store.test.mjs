import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  companyPaths,
  readJsonFile,
  writeJsonAtomic,
  appendJsonl,
  withFileLock,
  CompanyStore,
} from "../src/shared/company-store.mjs";
import { createOrder, transitionOrder, ORDER_STATES, emptyLedger } from "../src/shared/company-ledger.mjs";

const NOW = "2026-10-20T00:00:00.000Z";

const tmpRoots = [];
async function mkTmp(label) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `dsh-company-store-${label}-`));
  tmpRoots.push(dir);
  return dir;
}

test("companyPaths 返回契约路径形态", () => {
  const p = companyPaths(path.join("data", "root"));
  assert.equal(p.companyFile, path.join("data", "root", "company", "company.json"));
  assert.equal(p.ledgerDir, path.join("data", "root", "company", "ledger"));
  assert.equal(p.auditFile, path.join("data", "root", "company", "audit.jsonl"));
  assert.equal(p.lockFile, path.join("data", "root", "company", "company.lock"));
});

test("writeJsonAtomic + readJsonFile 往返与覆盖", async () => {
  const dir = await mkTmp("atomic");
  const file = path.join(dir, "cfg.json");
  assert.deepEqual(await readJsonFile(file, { fb: 1 }), { fb: 1 });
  await writeJsonAtomic(file, { a: 1 });
  assert.deepEqual(await readJsonFile(file, null), { a: 1 });
  await writeJsonAtomic(file, { a: 2, b: "乙" });
  assert.deepEqual(await readJsonFile(file, null), { a: 2, b: "乙" });
});

test("readJsonFile 缺文件/空文件回退 fallback", async () => {
  const dir = await mkTmp("fallback");
  const missing = path.join(dir, "none.json");
  assert.deepEqual(await readJsonFile(missing, { x: 1 }), { x: 1 });
  const empty = path.join(dir, "empty.json");
  await fs.writeFile(empty, "   \n", "utf8");
  assert.deepEqual(await readJsonFile(empty, { x: 2 }), { x: 2 });
});

test("readJsonFile 坏 JSON 抛错且带 E_JSON_CORRUPT", async () => {
  const dir = await mkTmp("corrupt");
  const file = path.join(dir, "bad.json");
  await fs.writeFile(file, "{not json", "utf8");
  await assert.rejects(() => readJsonFile(file, null), (err) => err?.code === "E_JSON_CORRUPT");
});

test("appendJsonl 逐行可解析且带换行分隔", async () => {
  const dir = await mkTmp("jsonl");
  const file = path.join(dir, "a.jsonl");
  await appendJsonl(file, { n: 1 });
  await appendJsonl(file, { n: 2, s: "中文" });
  const text = await fs.readFile(file, "utf8");
  const lines = text.split("\n").filter((l) => l.trim());
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((l) => JSON.parse(l)), [{ n: 1 }, { n: 2, s: "中文" }]);
  assert.ok(text.endsWith("\n"));
});

test("withFileLock 互斥：并发 fn 不重叠", async () => {
  const dir = await mkTmp("lock-mutex");
  const lockFile = path.join(dir, "l.lock");
  const state = { active: 0, max: 0, count: 0 };
  const work = () =>
    withFileLock(lockFile, async () => {
      state.active += 1;
      state.count += 1;
      state.max = Math.max(state.max, state.active);
      await new Promise((r) => setTimeout(r, 80));
      state.active -= 1;
    });
  await Promise.all([work(), work(), work()]);
  assert.equal(state.count, 3);
  assert.equal(state.max, 1);
});

test("withFileLock 超时抛 E_COMPANY_LOCKED", async () => {
  const dir = await mkTmp("lock-timeout");
  const lockFile = path.join(dir, "l.lock");
  await fs.writeFile(lockFile, "occupied", "utf8"); // 模拟他方持锁
  const before = Date.now();
  await assert.rejects(
    () => withFileLock(lockFile, async () => {}, { timeoutMs: 300 }),
    (err) => err?.code === "E_COMPANY_LOCKED",
  );
  assert.ok(Date.now() - before >= 250);
});

test("fn 抛错也释放锁（锁文件清掉、可再获取）", async () => {
  const dir = await mkTmp("lock-release");
  const lockFile = path.join(dir, "l.lock");
  await assert.rejects(() =>
    withFileLock(lockFile, async () => {
      throw new Error("业务失败");
    }),
  );
  await assert.rejects(() => fs.stat(lockFile));
  const got = await withFileLock(lockFile, async () => "ok");
  assert.equal(got, "ok");
  await assert.rejects(() => fs.stat(lockFile));
});

test("陈旧锁可抢占（mtime 超过 staleMs）", async () => {
  const dir = await mkTmp("lock-stale");
  const lockFile = path.join(dir, "l.lock");
  await fs.writeFile(lockFile, "dead", "utf8");
  const past = new Date(Date.now() - 30_000);
  await fs.utimes(lockFile, past, past);
  const got = await withFileLock(lockFile, async () => "taken", { staleMs: 1000 });
  assert.equal(got, "taken");
});

test("load 空目录返回空结构 + 无 warnings，不抛", async () => {
  const dir = await mkTmp("load-empty");
  const store = new CompanyStore(dir, { now: () => NOW });
  const { company, ledger, warnings } = await store.load();
  assert.equal(company.version, 1);
  assert.deepEqual(company.departments, []);
  assert.deepEqual(ledger.orders, []);
  assert.deepEqual(ledger.audit, []);
  assert.ok(ledger.clientMap && typeof ledger.clientMap === "object");
  assert.deepEqual(warnings, []);
});

test("load 损坏 company.json 降级为空结构 + warnings，不抛", async () => {
  const dir = await mkTmp("load-corrupt");
  const p = companyPaths(dir);
  await fs.mkdir(p.dir, { recursive: true });
  await fs.writeFile(p.companyFile, "{oops", "utf8");
  const store = new CompanyStore(dir, { now: () => NOW });
  const { company, ledger, warnings } = await store.load();
  assert.equal(company.version, 1);
  assert.deepEqual(ledger.orders, []);
  assert.ok(warnings.some((w) => w.includes("company.json")));
});

test("saveLedger 落盘后新实例 load 可完整读回（含 clientMap）", async () => {
  const dir = await mkTmp("save-ledger");
  const store = new CompanyStore(dir, { now: () => NOW });
  let ledger = emptyLedger(NOW);
  const r1 = createOrder(ledger, { title: "写核心模块", type: "code_impl", clientOrderId: "dup-1" }, NOW);
  ledger = r1.ledger;
  ledger = transitionOrder(ledger, r1.order.id, ORDER_STATES.ROUTED);
  await store.saveLedger(ledger);

  const store2 = new CompanyStore(dir, { now: () => NOW });
  const loaded = await store2.load();
  assert.equal(loaded.ledger.orders.length, 1);
  assert.equal(loaded.ledger.orders[0].state, "routed");
  assert.deepEqual(loaded.ledger.clientMap, { "dup-1": r1.order.id });
  const raw = await readJsonFile(companyPaths(dir).companyFile, null);
  assert.ok(raw.ledger, "快照须含 ledger");
  assert.ok(raw.savedAt, "快照须含 savedAt");
});

test("saveCompany 组合写不丢对方（company.json 单一原子写点）", async () => {
  const dir = await mkTmp("save-merged");
  const store = new CompanyStore(dir, { now: () => NOW });
  let ledger = emptyLedger(NOW);
  const { order } = createOrder(ledger, { title: "订单甲" }, NOW);
  ledger = store.ledger; // snapshot 前的空账本即可；saveLedger 写订单
  await store.saveLedger(store.ledger);
  await store.appendAudit({ ts: NOW, action: "company.audit", detail: "甲" });
  const company = structuredClone(store.company);
  company.status = "running";
  await store.saveCompany(company);

  const store2 = new CompanyStore(dir, { now: () => NOW });
  const loaded = await store2.load();
  assert.equal(loaded.company.status, "running");
  assert.equal(loaded.ledger.audit.length, 1);
  assert.equal(loaded.ledger.audit[0].action, "company.audit");
  void order;
});

test("appendAudit 先落 jsonl 再入内存账本；load 对账一致", async () => {
  const dir = await mkTmp("audit-reconcile");
  let savedOrderTitle = null;
  const store1 = new CompanyStore(dir, { now: () => NOW });
  {
    let l = emptyLedger(NOW);
    const r = createOrder(l, { title: "审计对账单" }, NOW);
    savedOrderTitle = r.order.title;
    l = r.ledger;
    await store1.saveLedger(l);
  }
  await store1.appendAudit({ ts: NOW, action: "order.created", order: "any" });
  await store1.appendAudit({ type: "runtime.shutdown", ownerSessionId: "s1", extra: { ok: true } });

  const store2 = new CompanyStore(dir, { now: () => NOW });
  const { ledger, warnings } = await store2.load();
  assert.equal(ledger.audit.length, 2);
  assert.equal(ledger.audit[1].ownerSessionId, "s1");
  assert.ok(ledger.audit[1].ts, "appendAudit 须补 ts");
  assert.equal(ledger.orders[0].title, savedOrderTitle);
  assert.deepEqual(warnings, [], "jsonl 行数大于快照应以 jsonl 重放为准，不应告警");
});

test("audit.jsonl 行数多于快照时以 jsonl 重放为准", async () => {
  const dir = await mkTmp("audit-grows");
  const p = companyPaths(dir);
  const store = new CompanyStore(dir, { now: () => NOW });
  await store.saveLedger(emptyLedger(NOW)); // 快照 audit: 0 条
  await appendJsonl(p.auditFile, { ts: NOW, action: "direct.1" });
  await appendJsonl(p.auditFile, { ts: NOW, action: "direct.2" });
  await appendJsonl(p.auditFile, { broken: true, oops: "这行其实合法" });
  const { ledger } = await store.load();
  assert.equal(ledger.audit.length, 3);
  assert.equal(ledger.audit[0].action, "direct.1");
});

test("损坏 audit.jsonl 行跳过并告警，不抛", async () => {
  const dir = await mkTmp("audit-corrupt-line");
  const p = companyPaths(dir);
  const store = new CompanyStore(dir, { now: () => NOW });
  await store.saveLedger(emptyLedger(NOW));
  await fs.appendFile(p.auditFile, "{not-json}\n", "utf8");
  const { ledger, warnings } = await store.load();
  assert.deepEqual(ledger.audit, []);
  assert.ok(warnings.some((w) => w.includes("audit.jsonl")));
});

test("store.withLock 依次执行并返回 fn 结果", async () => {
  const dir = await mkTmp("store-lock");
  const store = new CompanyStore(dir, { now: () => NOW });
  const order = [];
  await Promise.all([
    store.withLock(async () => {
      order.push("a");
      await new Promise((r) => setTimeout(r, 60));
    }),
    store.withLock(async () => {
      order.push("b");
    }),
  ]);
  assert.equal(order.length, 2);
});

test("appendAudit 归一：仅 type 的记录，内存与 jsonl 均含 action（task-6）", async () => {
  const dir = await mkTmp("audit-normalize-append");
  const p = companyPaths(dir);
  const store = new CompanyStore(dir, { now: () => NOW });
  await store.saveLedger(emptyLedger(NOW));
  await store.appendAudit({ type: "order.created", order: "o1" });
  // 内存账本同时具备 action 与 type
  assert.equal(store.ledger.audit[0].action, "order.created");
  assert.equal(store.ledger.audit[0].type, "order.created");
  // 落盘 jsonl 同样归一（builder 读 jsonl 或 prober 审计都按 action 可见）
  const jsonl = await fs.readFile(p.auditFile, "utf8");
  const rows = jsonl.trim().split("\n").map((s) => JSON.parse(s));
  assert.equal(rows[0].action, "order.created");
  assert.equal(rows[0].type, "order.created");
  // 冲突归一：action 优先，type 覆盖为 action，并记 warning
  await store.appendAudit({ action: "review.pass", type: "review.fail" });
  assert.equal(store.ledger.audit[1].action, "review.pass");
  assert.equal(store.ledger.audit[1].type, "review.pass");
  assert.equal(store.auditWarnings.length, 1);
  assert.match(store.auditWarnings[0], /action 优先/);
});

test("load 重放旧 jsonl（记录仅 type）后 audit 仍有 action（task-6）", async () => {
  const dir = await mkTmp("audit-normalize-replay");
  const p = companyPaths(dir);
  const store1 = new CompanyStore(dir, { now: () => NOW });
  await store1.saveLedger(emptyLedger(NOW)); // 快照 audit: 0 条
  await appendJsonl(p.auditFile, { ts: NOW, type: "legacy.created" });
  await appendJsonl(p.auditFile, { ts: NOW, action: "legacy.done" });
  const store2 = new CompanyStore(dir, { now: () => NOW });
  const { ledger, warnings } = await store2.load();
  assert.equal(ledger.audit.length, 2);
  assert.equal(ledger.audit[0].action, "legacy.created");
  assert.equal(ledger.audit[0].type, "legacy.created");
  assert.equal(ledger.audit[1].action, "legacy.done");
  assert.equal(ledger.audit[1].type, "legacy.done");
  assert.deepEqual(warnings, [], "仅 type/仅 action 属正常归一，不应告警");
});