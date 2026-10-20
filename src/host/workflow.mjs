/**
 * 工作流观测器（0.2.0 可视化工作流面板的数据源）。
 *
 * 设计原则（docs/08-可视化工作流-AI与人类）：旁路采集、绝不阻塞会话。
 *  - token 用量：订阅宿主 `session/event` 里的 `assistant/message`（带 usage），
 *    只在内存累加，定时落盘，不参与会话主链路。
 *  - 成员状态：复用 agent/created｜agent/status 生命周期事件，累计 activeMs。
 *  - 工作包：只读任务板（task board）的投影视图，按 ownerName 对应到成员。
 *    任务板没有时间字段，所以「用时」由本观测器第一次看到该任务的时间推算。
 *  - 任务板不可用（没装 agent-team / 当前 agent 不是成员）时整体降级，
 *    面板显示「无任务数据」，不影响名册管理。
 *
 * 这个模块不 import 任何 DSH 包，宿主侧能力（agents/agentTeams/taskBoard）
 * 全部由 index.js 以「取值函数」注入，方便单测。
 */

import fs from "node:fs";
import path from "node:path";

export const WORKFLOW_VERSION = 1;
const HOUR = 3600 * 1000;

/** 从 llm Usage 里取出我们要累计的字段（缺字段按 0）。 */
export function normalizeUsage(usage) {
  const num = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
  const input = num(usage && (usage.inputTokens ?? usage.promptTokens));
  const output = num(usage && (usage.outputTokens ?? usage.completionTokens));
  const cacheRead = num(usage && (usage.cacheReadTokens ?? usage.cachedInputTokens));
  const cacheWrite = num(usage && usage.cacheWriteTokens);
  const reasoning = num(usage && usage.reasoningTokens);
  const total = num(usage && usage.totalTokens) || input + output;
  return { input, output, cacheRead, cacheWrite, reasoning, total };
}

/** 格式化毫秒为人读时长：<1s→"n.s s"；<1min→"n s"；<1h→"m 分 s 秒"；否则 "h 小时 m 分"。 */
export function formatDuration(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  if (ms < HOUR) {
    const m = Math.floor(ms / 60_000);
    const s = Math.round((ms % 60_000) / 1000);
    return s ? `${m} 分 ${s} 秒` : `${m} 分`;
  }
  const h = Math.floor(ms / HOUR);
  const m = Math.round((ms % HOUR) / 60_000);
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`;
}

function truncate(text, max = 80) {
  const s = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * 工作流观测器。
 *
 * @param {object} opts
 * @param {string} opts.dataDir           状态目录（与 registry.json 同级）
 * @param {number} [opts.persistMs]       落盘间隔，默认 5000
 * @param {number} [opts.retentionMs]     已结束会话保留时长，默认 6 小时
 * @param {number} [opts.maxSessions]     内存里最多保留多少会话，默认 400
 * @param {() => number} [opts.now]       时间源（毫秒），测试可注入
 * @param {(msg: string) => void} [opts.log]
 */
export class WorkflowTracker {
  constructor({ dataDir, persistMs = 5000, retentionMs = 6 * HOUR, maxSessions = 400, now = () => Date.now(), log = null } = {}) {
    this.dir = dataDir ? path.resolve(dataDir) : null;
    this.file = this.dir ? path.join(this.dir, "workflow-stats.json") : null;
    this.persistMs = Math.max(1000, persistMs);
    this.retentionMs = Math.max(60_000, retentionMs);
    this.maxSessions = Math.max(16, maxSessions);
    this.now = now;
    this.log = log || (() => {});
    this.startedAt = this.now();
    /** sessionId → { sessionId, target, input, output, cacheRead, cacheWrite, reasoning, total, requests, firstAt, lastAt } */
    this.sessions = new Map();
    /** target → { target, agentId, status, runningSince, activeMs, lastStatusAt, lastSeenAt } */
    this.agents = new Map();
    /** taskId → { taskId, firstSeenAt, lastStatus, ownerName, subject } */
    this.tasks = new Map();
    /** sessionId → target 映射（agent 创建时登记） */
    this.sessionToTarget = new Map();
    this.lastTasksAt = 0;
    this.tasksAvailable = null;
    this.tasksError = null;
    this.timer = null;
    this.savedAt = null;
  }

  /* ---------------------------------------------------------------- 采集 */

  /** 登记一个 agent 实例（agent/created 与启动预热都走这里）。 */
  observeAgent(agent, target) {
    const agentId = agent && typeof agent.id === "string" ? agent.id : null;
    const sessionId = agent && agent.session && typeof agent.session.id === "string" ? agent.session.id : null;
    if (!target) return;
    const t = this.now();
    const prev = this.agents.get(target) || { target, activeMs: 0, lastStatusAt: t };
    prev.agentId = agentId || prev.agentId || null;
    prev.lastSeenAt = t;
    if (sessionId) this.sessionToTarget.set(sessionId, target);
    const status = typeof agent?.status === "string" ? agent.status : prev.status;
    if (status && status !== prev.status) {
      if (prev.status === "running" && typeof prev.runningSince === "number") {
        prev.activeMs += Math.max(0, t - prev.runningSince);
        prev.runningSince = undefined;
      }
      if (status === "running") prev.runningSince = t;
      prev.status = status;
      prev.lastStatusAt = t;
    }
    this.agents.set(target, prev);
  }

  /** agent/status 事件。 */
  observeAgentStatus(agent, target) {
    if (!agent) return;
    this.observeAgent(agent, target);
  }

  /**
   * session/event 事件 —— 唯一会高频触发的入口，必须保持极轻。
   * @param {{ id?: string, session?: object }} sessionLike agent.session
   * @param {object} event SessionEvent
   */
  observeEvent(sessionLike, event, targetHint) {
    try {
      if (!event || event.type !== "assistant/message") return;
      const sessionId = (sessionLike && (sessionLike.id || (sessionLike.session && sessionLike.session.id))) || "unknown";
      if (targetHint) this.sessionToTarget.set(sessionId, targetHint);
      const usage = normalizeUsage(event.data && event.data.usage);
      if (usage.total <= 0) return;
      const t = this.now();
      let row = this.sessions.get(sessionId);
      if (!row) {
        row = {
          sessionId,
          target: this.sessionToTarget.get(sessionId) || targetHint || null,
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          reasoning: 0,
          total: 0,
          requests: 0,
          firstAt: t,
          lastAt: t,
        };
        this.sessions.set(sessionId, row);
      }
      row.input += usage.input;
      row.output += usage.output;
      row.cacheRead += usage.cacheRead;
      row.cacheWrite += usage.cacheWrite;
      row.reasoning += usage.reasoning;
      row.total += usage.total;
      row.requests += 1;
      row.lastAt = t;
      if (!row.target) row.target = this.sessionToTarget.get(sessionId) || null;
      if (row.target) {
        const a = this.agents.get(row.target);
        if (a) a.lastSeenAt = t;
      }
      this.#prune(t);
    } catch (err) {
      // 观测失败绝不影响会话
      this.log(`workflow observeEvent failed: ${err && err.message}`);
    }
  }

  /**
   * 任务板快照 → 观测器。（view 由宿主侧 projectTaskView 出来）
   * @param {Array<{id:string,subject?:string,status?:string,ownerName?:string}>} tasks
   */
  observeTasks(tasks, { available = true, error = null } = {}) {
    const t = this.now();
    this.tasksAvailable = available;
    this.tasksError = error;
    this.lastTasksAt = t;
    if (!Array.isArray(tasks)) return;
    for (const task of tasks) {
      if (!task || typeof task.id !== "string") continue;
      const prev = this.tasks.get(task.id) || { taskId: task.id, firstSeenAt: t };
      prev.subject = truncate(task.subject || prev.subject || "", 120);
      prev.lastStatus = task.status || prev.lastStatus || "pending";
      prev.ownerName = task.ownerName || null;
      prev.blockedBy = Array.isArray(task.blockedBy) ? task.blockedBy.slice() : prev.blockedBy || [];
      prev.lastSeenAt = t;
      this.tasks.set(task.id, prev);
    }
    // 任务板是事实源：已不存在的任务从观测缓存里移除
    const alive = new Set(tasks.map((x) => x && x.id).filter(Boolean));
    for (const id of [...this.tasks.keys()]) if (!alive.has(id)) this.tasks.delete(id);
  }

  /* ---------------------------------------------------------------- 查询 */

  /**
   * 生成面板快照。
   * @param {Array<{target:string,displayName?:string,title?:string,groupName?:string,model?:string,provider?:string}>} members
   *        名册里的成员（active），由 index.js 从 registry 视图传入
   * @param {{ liveStatus?: (target:string) => string|null }} [opts]
   */
  snapshot(members, opts = {}) {
    const t = this.now();
    const liveStatus = typeof opts.liveStatus === "function" ? opts.liveStatus : () => null;

    // target → usage 聚合（同一成员可能多会话）
    const usageByTarget = new Map();
    const sessionRows = [];
    for (const row of this.sessions.values()) {
      if (t - row.lastAt > this.retentionMs) continue;
      const target = row.target || row.sessionId;
      const agg = usageByTarget.get(target) || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0, requests: 0, lastAt: 0 };
      agg.input += row.input;
      agg.output += row.output;
      agg.cacheRead += row.cacheRead;
      agg.cacheWrite += row.cacheWrite;
      agg.reasoning += row.reasoning;
      agg.total += row.total;
      agg.requests += row.requests;
      agg.lastAt = Math.max(agg.lastAt, row.lastAt);
      usageByTarget.set(target, agg);
      sessionRows.push({ sessionId: row.sessionId, target: row.target, requests: row.requests, total: row.total, lastAt: row.lastAt });
    }

    const tasks = [...this.tasks.values()].map((x) => ({
      taskId: x.taskId,
      subject: x.subject || "",
      status: x.lastStatus,
      ownerName: x.ownerName || null,
      blockedBy: Array.isArray(x.blockedBy) ? x.blockedBy.slice() : [],
      elapsedMs: this.#elapsedForTask(x, t),
      firstSeenAt: x.firstSeenAt,
    }));

    const rows = [];
    const seen = new Set();
    for (const m of Array.isArray(members) ? members : []) {
      if (!m || !m.target) continue;
      seen.add(m.target);
      rows.push(this.#memberRow(m, t, usageByTarget, tasks, liveStatus(m.target)));
    }
    // 不在名册里但观测到用量的 target（例如未登记的存活 agent）也要显示出来，避免账对不上
    for (const target of usageByTarget.keys()) {
      if (seen.has(target)) continue;
      rows.push(this.#memberRow({ target, displayName: target, title: "", groupName: "", model: "" }, t, usageByTarget, tasks, liveStatus(target)));
    }

    const totals = { input: 0, output: 0, total: 0, requests: 0, cacheRead: 0, activeMs: 0 };
    for (const r of rows) {
      totals.input += r.usage.input;
      totals.output += r.usage.output;
      totals.total += r.usage.total;
      totals.requests += r.usage.requests;
      totals.cacheRead += r.usage.cacheRead;
      totals.activeMs += r.elapsedMs;
    }
    const hitRate = totals.input + totals.cacheRead > 0 ? totals.cacheRead / (totals.input + totals.cacheRead) : null;

    const taskCounts = { pending: 0, in_progress: 0, completed: 0 };
    for (const task of tasks) if (task.status in taskCounts) taskCounts[task.status] += 1;

    return {
      version: WORKFLOW_VERSION,
      generatedAt: new Date(t).toISOString(),
      startedAt: new Date(this.startedAt).toISOString(),
      members: rows,
      tasks,
      taskCounts,
      totals: {
        inputTokens: totals.input,
        outputTokens: totals.output,
        totalTokens: totals.total,
        requests: totals.requests,
        cacheReadTokens: totals.cacheRead,
        cacheHitRate: hitRate,
        activeMs: totals.activeMs,
      },
      tasksAvailable: this.tasksAvailable,
      tasksError: this.tasksError,
      lastTasksAt: this.lastTasksAt ? new Date(this.lastTasksAt).toISOString() : null,
      sessions: sessionRows.sort((a, b) => b.lastAt - a.lastAt).slice(0, 20),
    };
  }

  #memberRow(m, t, usageByTarget, tasks, statusHint) {
    const usage = usageByTarget.get(m.target) || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0, requests: 0, lastAt: 0 };
    const agent = this.agents.get(m.target);
    let status = statusHint || agent?.status || "unknown";
    if (status === "running") status = "running";
    const running = status === "running";
    const activeMs = (agent?.activeMs || 0) + (running && typeof agent?.runningSince === "number" ? Math.max(0, t - agent.runningSince) : 0);
    const owned = tasks.filter((x) => x.ownerName === (m.displayName || m.target) || x.ownerName === m.target);
    const current = owned.find((x) => x.status === "in_progress") || owned.find((x) => x.status === "pending") || null;
    return {
      target: m.target,
      displayName: m.displayName || m.target,
      title: m.title || "",
      groupName: m.groupName || "",
      model: m.model || "",
      provider: m.provider || "",
      status,
      live: { status, agentId: agent?.agentId || null, lastSeenAt: agent?.lastSeenAt ? new Date(agent.lastSeenAt).toISOString() : null },
      work: current
        ? { taskId: current.taskId, subject: current.subject, status: current.status, elapsedMs: current.elapsedMs }
        : null,
      usage: {
        input: usage.input,
        output: usage.output,
        total: usage.total,
        requests: usage.requests,
        cacheRead: usage.cacheRead,
        lastAt: usage.lastAt ? new Date(usage.lastAt).toISOString() : null,
      },
      elapsedMs: activeMs,
    };
  }

  #elapsedForTask(task, t) {
    if (task.lastStatus === "completed") {
      return Math.max(0, (task.completedAt || task.lastSeenAt || t) - task.firstSeenAt);
    }
    return Math.max(0, t - task.firstSeenAt);
  }

  #prune(t) {
    if (this.sessions.size <= this.maxSessions) {
      for (const [id, row] of this.sessions) if (t - row.lastAt > this.retentionMs) this.sessions.delete(id);
      return;
    }
    const sorted = [...this.sessions.entries()].sort((a, b) => a[1].lastAt - b[1].lastAt);
    const drop = sorted.slice(0, this.sessions.size - this.maxSessions);
    for (const [id] of drop) this.sessions.delete(id);
  }

  /* ---------------------------------------------------------------- 持久化 */

  load() {
    if (!this.file || !fs.existsSync(this.file)) return { ok: false, code: "NO_STATE" };
    try {
      const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
      const sessions = Array.isArray(data.sessions) ? data.sessions : [];
      const t = this.now();
      for (const s of sessions) {
        if (!s || typeof s.sessionId !== "string") continue;
        if (t - (s.lastAt || 0) > this.retentionMs) continue;
        this.sessions.set(s.sessionId, s);
        if (s.target) this.sessionToTarget.set(s.sessionId, s.target);
      }
      const agents = Array.isArray(data.agents) ? data.agents : [];
      for (const a of agents) if (a && typeof a.target === "string") this.agents.set(a.target, { ...a, runningSince: undefined });
      const tasks = Array.isArray(data.tasks) ? data.tasks : [];
      for (const x of tasks) if (x && typeof x.taskId === "string") this.tasks.set(x.taskId, x);
      this.savedAt = data.savedAt || null;
      return { ok: true, sessions: this.sessions.size, agents: this.agents.size };
    } catch (err) {
      return { ok: false, code: "LOAD_FAILED", message: err && err.message };
    }
  }

  save() {
    if (!this.file) return { ok: false, code: "NO_STATE" };
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const payload = {
        version: WORKFLOW_VERSION,
        savedAt: new Date(this.now()).toISOString(),
        sessions: [...this.sessions.values()],
        agents: [...this.agents.values()].map((a) => ({ ...a, runningSince: undefined })),
        tasks: [...this.tasks.values()],
      };
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload));
      fs.renameSync(tmp, this.file);
      this.savedAt = payload.savedAt;
      return { ok: true, bytes: Buffer.byteLength(JSON.stringify(payload)), file: this.file };
    } catch (err) {
      return { ok: false, code: "SAVE_FAILED", message: err && err.message };
    }
  }

  start(registerInterval) {
    this.load();
    const tick = () => this.save();
    if (typeof registerInterval === "function") {
      registerInterval(tick, this.persistMs);
    } else {
      this.timer = setInterval(tick, this.persistMs);
      if (this.timer.unref) this.timer.unref();
    }
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    return this.save();
  }

  /** 给工具/HTTP 用的瘦身视图（不带会话明细）。 */
  summary(members, opts) {
    const snap = this.snapshot(members, opts);
    return { generatedAt: snap.generatedAt, totals: snap.totals, taskCounts: snap.taskCounts, tasksAvailable: snap.tasksAvailable, members: snap.members.map((m) => ({ target: m.target, displayName: m.displayName, status: m.status, work: m.work, usage: m.usage, elapsedMs: m.elapsedMs })) };
  }
}
