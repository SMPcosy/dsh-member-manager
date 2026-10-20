/**
 * 工作流观测器测试（0.2.0 可视化工作流面板的数据源）。
 *
 * 覆盖目标（见 docs/08-可视化工作流.md）：
 *  - token 用量来自 session/event 的 assistant/message.usage，按会话累计
 *  - 成员状态由 agent 生命周期累计 activeMs（running 区间）
 *  - 工作包来自任务板投影，用时靠「第一次看见」推算（任务板无时间字段）
 *  - 任务板不可用时整体降级，不抛错、不清空已有观测
 *  - 落盘/加载往返，过期会话在快照与加载时被剔除
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  WORKFLOW_VERSION,
  WorkflowTracker,
  formatDuration,
  normalizeUsage,
} from "../src/host/workflow.mjs";

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-wf-test-"));
process.on("exit", () => {
  try {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function tmpDir(label) {
  return fs.mkdtempSync(path.join(TMP_ROOT, `${label}-`));
}

/** 可控时钟：每次 advance 都推进 now。 */
function clockAt(start = 1_700_000_000_000) {
  let now = start;
  const nowFn = () => now;
  nowFn.advance = (ms) => {
    now += ms;
    return now;
  };
  return nowFn;
}

function assistant(usage) {
  return { type: "assistant/message", seq: 1, time: 0, data: { turn: 1, step: 1, message: {}, usage } };
}

test("normalizeUsage：兼容 inputTokens/promptTokens，异常值归零", () => {
  assert.deepEqual(normalizeUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }), {
    input: 10,
    output: 5,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    total: 15,
  });
  const aliased = normalizeUsage({ promptTokens: 7, completionTokens: 3 });
  assert.equal(aliased.input, 7);
  assert.equal(aliased.output, 3);
  assert.equal(aliased.total, 10, "total 缺失时用 input+output 兜底");
  const junk = normalizeUsage({ inputTokens: -1, outputTokens: Number.NaN, totalTokens: "x" });
  assert.deepEqual(junk, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 });
  assert.deepEqual(normalizeUsage(null), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 });
});

test("formatDuration：秒/分/小时的人读格式", () => {
  assert.equal(formatDuration(0), "0.0 s");
  assert.equal(formatDuration(900), "0.9 s");
  assert.equal(formatDuration(1500), "2 s");
  assert.equal(formatDuration(59_000), "59 s");
  assert.equal(formatDuration(61_000), "1 分 1 秒");
  assert.equal(formatDuration(120_000), "2 分");
  assert.equal(formatDuration(3_600_000 + 120_000), "1 小时 2 分");
  assert.equal(formatDuration(-1), "—");
  assert.equal(formatDuration("x"), "—");
});

test("observeEvent：同一会话的 assistant/message 用量累加，其它事件忽略", () => {
  const tracker = new WorkflowTracker({ now: clockAt() });
  const session = { id: "s-1" };

  tracker.observeEvent(session, assistant({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 900, totalTokens: 120 }));
  tracker.observeEvent(session, assistant({ inputTokens: 50, outputTokens: 10, totalTokens: 60 }));
  // 非 assistant/message：不计
  tracker.observeEvent(session, { type: "tool/call", data: { usage: { inputTokens: 999 } } });
  // 用量为 0：不计 requests
  tracker.observeEvent(session, assistant({ inputTokens: 0, outputTokens: 0 }));

  const snap = tracker.snapshot([{ target: "s-1", displayName: "s-1" }]);
  const row = snap.members.find((m) => m.target === "s-1");
  assert.equal(row.usage.input, 150);
  assert.equal(row.usage.output, 30);
  assert.equal(row.usage.total, 180);
  assert.equal(row.usage.requests, 2);
  assert.equal(row.usage.cacheRead, 900);
  assert.equal(snap.totals.inputTokens, 150);
  assert.equal(snap.totals.requests, 2);
  // cacheHitRate = cacheRead / (input + cacheRead)
  assert.ok(Math.abs(snap.totals.cacheHitRate - 900 / 1050) < 1e-9);
});

test("observeEvent：targetHint 把会话用量并入该成员行（宿主解析 live agent 用）", () => {
  const tracker = new WorkflowTracker({ now: () => 1000 });
  const session = { id: "s-hint" };
  tracker.observeEvent(
    session,
    { type: "assistant/message", data: { usage: { inputTokens: 40, outputTokens: 10, totalTokens: 50 } } },
    "lead",
  );
  const snap = tracker.snapshot([{ target: "lead", displayName: "大总管" }]);
  const row = snap.members.find((m) => m.target === "lead");
  assert.equal(row.usage.total, 50);
  assert.equal(row.usage.requests, 1);
});

test("observeEvent：畸形输入不抛错（观测绝不影响会话）", () => {
  const logs = [];
  const tracker = new WorkflowTracker({ now: clockAt(), log: (m) => logs.push(m) });
  assert.doesNotThrow(() => tracker.observeEvent(null, null));
  assert.doesNotThrow(() => tracker.observeEvent({}, { type: "assistant/message" }));
  assert.doesNotThrow(() => tracker.observeEvent({ id: "s" }, { type: "assistant/message", data: { usage: {} } }));
  // 事件本身触发了异常时也只能记日志
  assert.doesNotThrow(() =>
    tracker.observeEvent(
      { id: "s" },
      {
        type: "assistant/message",
        get data() {
          throw new Error("boom");
        },
      },
    ),
  );
  assert.equal(logs.length, 1);
  assert.match(logs[0], /boom/);
});

test("observeAgent：running→idle 累计 activeMs，快照里 running 用实时差补", () => {
  const now = clockAt();
  const tracker = new WorkflowTracker({ now });

  tracker.observeAgent({ id: "a1", session: { id: "s1" }, status: "idle" }, "plugin-arch");
  now.advance(1000);
  tracker.observeAgent({ id: "a1", session: { id: "s1" }, status: "running" }, "plugin-arch");
  now.advance(5000);
  tracker.observeAgent({ id: "a1", session: { id: "s1" }, status: "idle" }, "plugin-arch");

  let snap = tracker.snapshot([{ target: "plugin-arch", displayName: "插件架构" }]);
  let row = snap.members[0];
  assert.equal(row.status, "idle");
  assert.equal(row.elapsedMs, 5000);
  assert.equal(row.live.agentId, "a1");

  // 再次 running，快照里的 elapsedMs 应该是 activeMs + 未结束的 running 区间
  now.advance(100);
  tracker.observeAgent({ id: "a1", session: { id: "s1" }, status: "running" }, "plugin-arch");
  now.advance(2000);
  snap = tracker.snapshot([{ target: "plugin-arch", displayName: "插件架构" }]);
  row = snap.members[0];
  assert.equal(row.status, "running");
  assert.equal(row.elapsedMs, 7000);
});

test("sessionToTarget：agent 登记后，该会话用量记到成员名下", () => {
  const tracker = new WorkflowTracker({ now: clockAt() });
  tracker.observeAgent({ id: "a1", session: { id: "s-arch" }, status: "running" }, "plugin-arch");
  tracker.observeEvent({ id: "s-arch" }, assistant({ inputTokens: 1000, outputTokens: 200 }));

  const snap = tracker.snapshot([{ target: "plugin-arch", displayName: "插件架构" }]);
  assert.equal(snap.members[0].usage.input, 1000);
  assert.equal(snap.members[0].usage.requests, 1);
  // 未登记的 target 不凭空出现
  assert.equal(snap.members.length, 1);
});

test("snapshot：工作包按 ownerName 匹配，用时从第一次看见任务算起", () => {
  const now = clockAt();
  const tracker = new WorkflowTracker({ now });
  tracker.observeAgent({ id: "a1", session: { id: "s1" }, status: "running" }, "plugin-arch");
  tracker.observeTasks([
    { id: "t1", subject: "接线工作流面板", status: "in_progress", ownerName: "插件架构" },
    { id: "t2", subject: "写测试", status: "pending", ownerName: "插件编写" },
  ]);

  now.advance(3000);
  let snap = tracker.snapshot([
    { target: "plugin-arch", displayName: "插件架构" },
    { target: "plugin-builder", displayName: "插件编写" },
  ]);
  const arch = snap.members.find((m) => m.target === "plugin-arch");
  assert.equal(arch.work.taskId, "t1");
  assert.equal(arch.work.status, "in_progress");
  assert.equal(arch.work.elapsedMs, 3000);
  const builder = snap.members.find((m) => m.target === "plugin-builder");
  assert.equal(builder.work.taskId, "t2");
  assert.equal(builder.status, "unknown", "没登记过 agent 的成员状态是 unknown");

  now.advance(2000);
  snap = tracker.snapshot([{ target: "plugin-arch", displayName: "插件架构" }]);
  assert.equal(snap.members[0].work.elapsedMs, 5000, "任务用时随时间增长");
  assert.deepEqual(snap.taskCounts, { pending: 1, in_progress: 1, completed: 0 });
});

test("observeTasks：任务完成后用时冻结；任务从板子上消失即从缓存移除", () => {
  const now = clockAt();
  const tracker = new WorkflowTracker({ now });
  tracker.observeTasks([{ id: "t1", subject: "A", status: "in_progress" }]);
  now.advance(4000);
  tracker.observeTasks([{ id: "t1", subject: "A", status: "completed" }]);
  now.advance(10_000);

  let snap = tracker.snapshot([]);
  assert.equal(snap.tasks.length, 1);
  assert.ok(snap.tasks[0].elapsedMs >= 4000 && snap.tasks[0].elapsedMs < 5000, "completed 后不再增长");

  tracker.observeTasks([]);
  snap = tracker.snapshot([]);
  assert.equal(snap.tasks.length, 0);
});

test("observeTasks：任务板不可用时降级，但不清空旧任务", () => {
  const tracker = new WorkflowTracker({ now: clockAt() });
  tracker.observeTasks([{ id: "t1", subject: "旧任务", status: "in_progress" }]);
  tracker.observeTasks(null, { available: false, error: "taskBoard 不可用" });

  const snap = tracker.snapshot([]);
  assert.equal(snap.tasksAvailable, false);
  assert.equal(snap.tasksError, "taskBoard 不可用");
  assert.equal(snap.tasks.length, 1, "降级不应把已知任务清空");
  assert.ok(snap.lastTasksAt);
});

test("snapshot：过期会话不参与聚合（retention 生效）", () => {
  const now = clockAt();
  const tracker = new WorkflowTracker({ now, retentionMs: 60_000 });
  tracker.observeAgent({ id: "a1", session: { id: "s1" }, status: "running" }, "plugin-arch");
  tracker.observeEvent({ id: "s1" }, assistant({ inputTokens: 100, outputTokens: 10 }));

  now.advance(120_000);
  const snap = tracker.snapshot([{ target: "plugin-arch", displayName: "插件架构" }]);
  assert.equal(snap.members[0].usage.total, 0, "超过 retention 的用量不再计入");
});

test("save/load：落盘后能恢复会话、成员与任务；过期会话加载时丢弃", () => {
  const dir = tmpDir("persist");
  const now = clockAt();
  const tracker = new WorkflowTracker({ dataDir: dir, now, retentionMs: 60_000 });
  tracker.observeAgent({ id: "a1", session: { id: "s1" }, status: "running" }, "plugin-arch");
  tracker.observeEvent({ id: "s1" }, assistant({ inputTokens: 100, outputTokens: 10, totalTokens: 110 }));
  tracker.observeTasks([{ id: "t1", subject: "任务", status: "in_progress", ownerName: "插件架构" }]);

  const saved = tracker.save();
  assert.equal(saved.ok, true);
  assert.ok(fs.existsSync(path.join(dir, "workflow-stats.json")));

  // 同一时钟下新实例加载：数据还在
  const again = new WorkflowTracker({ dataDir: dir, now, retentionMs: 60_000 });
  const loaded = again.load();
  assert.equal(loaded.ok, true);
  const snap = again.snapshot([{ target: "plugin-arch", displayName: "插件架构" }]);
  assert.equal(snap.members[0].usage.total, 110);
  assert.equal(snap.tasks[0].taskId, "t1");
  assert.equal(snap.version, WORKFLOW_VERSION);

  // 时钟推进到超过 retention 后再加载：会话被丢弃
  now.advance(120_000);
  const stale = new WorkflowTracker({ dataDir: dir, now, retentionMs: 60_000 });
  stale.load();
  const staleSnap = stale.snapshot([{ target: "plugin-arch", displayName: "插件架构" }]);
  assert.equal(staleSnap.members[0].usage.total, 0);
});

test("load：文件损坏时返回错误码而不抛错", () => {
  const dir = tmpDir("broken");
  fs.writeFileSync(path.join(dir, "workflow-stats.json"), "{ not json", "utf8");
  const tracker = new WorkflowTracker({ dataDir: dir, now: clockAt() });
  const result = tracker.load();
  assert.equal(result.ok, false);
  assert.equal(result.code, "LOAD_FAILED");
});

test("summary：只带面板需要的字段，不含会话明细", () => {
  const tracker = new WorkflowTracker({ now: clockAt() });
  tracker.observeAgent({ id: "a1", session: { id: "s1" }, status: "running" }, "plugin-arch");
  tracker.observeEvent({ id: "s1" }, assistant({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }));
  const summary = tracker.summary([{ target: "plugin-arch", displayName: "插件架构" }]);
  assert.equal(summary.sessions, undefined);
  assert.equal(summary.members.length, 1);
  assert.equal(summary.totals.totalTokens, 15);
  assert.equal(summary.taskCounts.pending, 0);
});
