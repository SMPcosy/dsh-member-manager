/**
 * company-store.mjs —— 文件存储 + 单实例锁 + 原子写（零 DSH 依赖）。
 *
 * 契约：docs/11-公司化改造-接口契约.md §1.2（签名冻结）。
 *
 * 落盘形态：
 *   dataDir/company/company.json   = { company, ledger, savedAt }（单一原子写点，saveCompany 与
 *                                    saveLedger 都写这里，避免 company 与 ledger 双文件撕裂）
 *   dataDir/company/ledger/*.jsonl = 追加式 checkpoint 日志（诊断/对账用；每次 saveLedger 追加一行
 *                                    { kind:"checkpoint", savedAt, orders, audit }，非权威数据源）
 *   dataDir/company/audit.jsonl    = 追加式审计流（append-only，审计事实源）
 *
 * 一致性约定：
 * - company.json 是权威快照；audit.jsonl 只追加、永不改写。
 * - appendAudit 先写 jsonl 再更新内存 ledger.audit，因此 jsonl 行数 >= 快照 audit 长度；
 *   load() 用该不变式对账：行数一致用快照，jsonl 更长则以 jsonl 重放为准。
 * - 所有读-改-写进入 withLock()；单进程内由 E_COMPANY_LOCKED 保护，多进程靠 O_EXCL 锁文件。
 *
 * 损坏降级：load() 对缺失/损坏文件返回空结构 + warnings，永不抛（docs/11 §1.2）。
 */

import fs from "node:fs/promises";
import path from "node:path";
import { emptyCompany, normalizeCompany } from "./company-org.mjs";
import { emptyLedger, LEDGER_VERSION } from "./company-ledger.mjs";

export function companyPaths(dataDir) {
  const dir = path.join(dataDir, "company");
  return {
    dir,
    companyFile: path.join(dir, "company.json"),
    ledgerDir: path.join(dir, "ledger"),
    auditFile: path.join(dir, "audit.jsonl"),
    lockFile: path.join(dir, "company.lock"),
  };
}

/**
 * 读 JSON 文件；文件缺失/空内容返回 fallback；JSON 损坏抛错（由 load() 捕获降级）。
 */
export async function readJsonFile(file, fallback) {
  let text;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) return fallback;
    throw err;
  }
  if (!text || !text.trim()) return fallback;
  try {
    return JSON.parse(text);
  } catch (err) {
    err.code = "E_JSON_CORRUPT";
    throw err;
  }
}

/**
 * 原子写：唯一临时文件 + rename（覆盖目标）。
 */
export async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/**
 * 追加一行 JSONL（自动 mkdir -p）。
 */
export async function appendJsonl(file, record) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, JSON.stringify(record) + "\n", "utf8");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 单实例锁：O_EXCL 创建 lockFile（内容 { pid, at }）。
 * - timeoutMs 内轮询未拿到 → 抛 Error，code = "E_COMPANY_LOCKED"。
 * - 锁文件 mtime 距 staleMs 以上视为陈旧（持有者进程已死/句柄已释放），可抢占。
 * - fn 抛错也保证释放（finally 关闭 fd + unlink）。
 * Windows 说明：活进程持有句柄时 unlink 会 EBUSY，陈旧抢占只对「崩溃后无句柄」的锁生效，符合设计意图。
 */
export async function withFileLock(lockFile, fn, { timeoutMs = 5000, staleMs = 60000 } = {}) {
  await fs.mkdir(path.dirname(lockFile), { recursive: true });
  const startedAt = Date.now();
  for (;;) {
    let fd = null;
    try {
      fd = await fs.open(lockFile, "wx");
      await fd.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), "utf8");
      try {
        return await fn();
      } finally {
        try {
          await fd.close();
          fd = null;
        } catch {
          /* ignore */
        }
        await fs.rm(lockFile, { force: true }).catch(() => {});
      }
    } catch (err) {
      if (fd) {
        await fd.close().catch(() => {});
        fd = null;
      }
      if (!err || err.code !== "EEXIST") throw err;
      let stale = false;
      try {
        const stat = await fs.stat(lockFile);
        stale = Date.now() - stat.mtimeMs > staleMs;
      } catch (statErr) {
        if (statErr.code === "ENOENT") continue; // 锁刚被释放，立刻重试
        throw statErr;
      }
      if (stale) {
        await fs.rm(lockFile, { force: true }).catch(() => {});
        continue; // 立即重试抢占
      }
      if (Date.now() - startedAt > timeoutMs) {
        const error = new Error(`公司锁忙，等待超时: ${lockFile} (timeoutMs=${timeoutMs})`);
        error.code = "E_COMPANY_LOCKED";
        throw error;
      }
      await sleep(50 + Math.floor(Math.random() * 50));
    }
  }
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

/**
 * 审计记录字段归一（task-6，2026-10-20）：
 * 契约 §1.2 约定 `action`，builder 大量写成 `{ type }`。归一后每条记录**同时**含 action 与 type：
 * - 有 type 无 action → action = type；
 * - 有 action 无 type → type = action；
 * - 两者都有但不等 → 保留 action，type 覆盖为 action，并回调 warn 记一条（action 优先）。
 */
function normalizeAuditRecord(record, warn) {
  const rec = { ...record };
  const hasAction = typeof rec.action === "string" && rec.action !== "";
  const hasType = typeof rec.type === "string" && rec.type !== "";
  if (hasAction && hasType && rec.action !== rec.type) {
    if (warn) warn(`audit 记录 action 与 type 不一致，按 action 优先归一: type="${rec.type}" -> action="${rec.action}"`);
    rec.type = rec.action;
  } else if (hasType) {
    rec.action = rec.type;
  } else if (hasAction) {
    rec.type = rec.action;
  }
  return rec;
}

function sanitizeLedger(raw, now) {
  if (!raw || typeof raw !== "object") return emptyLedger(now);
  const ledger = {
    version: typeof raw.version === "number" ? raw.version : LEDGER_VERSION,
    createdAt: raw.createdAt ?? now,
    orders: Array.isArray(raw.orders) ? raw.orders.filter((o) => o && typeof o === "object") : [],
    audit: Array.isArray(raw.audit) ? raw.audit.filter((a) => a && typeof a === "object") : [],
    clientMap: raw.clientMap && typeof raw.clientMap === "object" ? raw.clientMap : {},
    seq: typeof raw.seq === "number" ? raw.seq : 0,
  };
  return ledger;
}

async function readAllJsonlLines(file) {
  let text;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) return { ok: true, records: [], problems: [] };
    throw err;
  }
  const records = [];
  const problems = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      problems.push(line.slice(0, 80));
    }
  }
  return { ok: true, records, problems };
}

/**
 * 组合存储（宿主侧唯一事实源）。docs/11 §1.2。
 */
export class CompanyStore {
  constructor(dataDir, { now = () => new Date().toISOString() } = {}) {
    this.dataDir = dataDir;
    this.now = now;
    this._paths = companyPaths(dataDir);
    this._company = null;
    this._ledger = null;
    this._auditWarnings = [];
  }

  /** appendAudit 归一期间发现 action/type 冲突的记录（非致命）。 */
  get auditWarnings() {
    return this._auditWarnings;
  }

  get paths() {
    return this._paths;
  }

  get company() {
    if (this._company === null) this._company = emptyCompany(this.now());
    return this._company;
  }

  get ledger() {
    if (this._ledger === null) this._ledger = emptyLedger(this.now());
    return this._ledger;
  }

  async load() {
    const warnings = [];

    let raw = undefined;
    try {
      raw = await readJsonFile(this._paths.companyFile, undefined);
    } catch (err) {
      warnings.push(`company.json 损坏，已降级为空结构: ${err.message}`);
    }

    if (raw === undefined) {
      this._company = emptyCompany(this.now());
    } else if (typeof raw !== "object") {
      warnings.push("company.json 形态非法，已降级为空结构");
      this._company = emptyCompany(this.now());
    } else {
      const source = raw.company && typeof raw.company === "object" ? raw.company : raw;
      const normalized = normalizeCompany(source, this.now());
      this._company = normalized.company;
      warnings.push(...normalized.warnings.map((w) => `company.json: ${w}`));
    }

    const hasLedgerInSnapshot = raw && typeof raw === "object" && raw.ledger && typeof raw.ledger === "object";
    if (!hasLedgerInSnapshot && raw !== undefined) {
      warnings.push("company.json 缺少 ledger 快照，已降级为空白账本");
    }
    this._ledger = sanitizeLedger(hasLedgerInSnapshot ? raw.ledger : undefined, this.now());

    // audit.jsonl 对账：jsonl 只追加，行数应 >= 快照 audit；更长则以 jsonl 重放为准。
    try {
      const { records, problems } = await readAllJsonlLines(this._paths.auditFile);
      for (const p of problems) warnings.push(`audit.jsonl 存在不可解析行，已跳过: ${p}`);
      const normalizedRecords = records.map((r) =>
        normalizeAuditRecord(r, (w) => warnings.push(`audit.jsonl: ${w}`)),
      );
      if (normalizedRecords.length > this._ledger.audit.length) {
        this._ledger.audit = normalizedRecords;
      } else if (normalizedRecords.length < this._ledger.audit.length) {
        warnings.push(`audit.jsonl (${normalizedRecords.length} 行) 少于快照 audit (${this._ledger.audit.length} 条)，保留快照`);
      }
      // 快照里的 audit 同样归一（旧版快照可能只有 type 或 action 单字段）。
      if (this._ledger.audit.length > 0 && normalizedRecords.length <= this._ledger.audit.length) {
        this._ledger.audit = this._ledger.audit.map((r) =>
          normalizeAuditRecord(r, (w) => warnings.push(`company.json: ${w}`)),
        );
      }
    } catch (err) {
      warnings.push(`audit.jsonl 读取失败: ${err.message}`);
    }

    return { company: clone(this._company), ledger: clone(this._ledger), warnings };
  }

  async #persist() {
    await writeJsonAtomic(this._paths.companyFile, {
      company: this.company,
      ledger: this.ledger,
      savedAt: this.now(),
    });
  }

  async saveCompany(company) {
    this._company = clone(company);
    await this.#persist();
  }

  async saveLedger(ledger) {
    this._ledger = clone(ledger);
    await this.#persist();
    // 追加 checkpoint 日志（best-effort，不阻塞主写入）
    try {
      await appendJsonl(path.join(this._paths.ledgerDir, "ledger.jsonl"), {
        kind: "checkpoint",
        savedAt: this.now(),
        orders: this._ledger.orders ? this._ledger.orders.length : 0,
        audit: this._ledger.audit ? this._ledger.audit.length : 0,
      });
    } catch {
      /* checkpoint 是诊断日志，失败不影响持久化 */
    }
  }

  async appendAudit(entry) {
    const raw = { ...(entry && typeof entry === "object" ? entry : {}), ts: entry?.ts ?? this.now() };
    const record = normalizeAuditRecord(raw, (w) => this._auditWarnings.push(w));
    await appendJsonl(this._paths.auditFile, record);
    if (this._ledger !== null) {
      this._ledger = clone(this._ledger);
      this._ledger.audit.push(record);
    }
  }

  async withLock(fn) {
    return withFileLock(this._paths.lockFile, fn);
  }
}