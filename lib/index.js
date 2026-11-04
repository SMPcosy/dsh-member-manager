/**
 * dsh-member-manager · 宿主端（Cordis 插件）
 *
 * 职责
 *  1. 注册 7 个 member_* / group_* 工具，让 Agent 能读写成员名册
 *  2. 注册 HTTP 路由，供 Web 面板读写同一份名册
 *
 * 关键约束（来自对官方 dsh-experimental-agent-team 的源码分析）：
 *  - 官方内核 roster 是**刻意不可变**的：没有 displayName/label/alias 字段，
 *    没有 rename / remove / setDescription 方法，`name` 还是消息寻址键。
 *    强行向团队日志 append `team/member` 事件会被投影校验拒绝，
 *    并把该 Team 的投影打成**终止性 failure**（之后所有团队操作都抛错）。
 *  - 因此本插件**绝不触碰核心团队状态**，只在 `~/.dsh/storages/member-manager/`
 *    下维护自己的「覆盖层」名册。核心成员的读取一律走只读查询。
 *  - `ctx.agentTeams.listMembers(agent)` 需要一个**精确的 live Agent 实例**做授权凭证，
 *    HTTP 路由里没有 agent，所以成员列表用「工具执行时刷新 + agent/created 事件刷新」
 *    的缓存快照，缓存不可用时视图会明确标记 coreAvailable=false（绝不误判为孤儿）。
 *
 * 本文件不 import 任何 `@deepseek-ai/*` 官方包：它们只存在于 DSH 运行时内部
 * （profile 的 node_modules/@deepseek-ai 为空目录），因此工具定义使用普通对象，
 * 依赖注入统一走 ctx.get / ctx.inject。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { RegistryStore } from "../src/shared/registry-store.mjs";
import { validateRegistry } from "../src/shared/registry-core.mjs";
import { TeamService } from "../src/shared/team-service.mjs";
import { parseGroupBrief, describeBrief, suggestTarget } from "../src/shared/group-brief.mjs";
import {
  backupNow,
  listBackups,
  rotateBackups,
  restoreBackup,
  exportRegistry,
  backupStatus,
} from "../src/shared/backups.mjs";
import { WorkflowTracker, formatDuration } from "../src/host/workflow.mjs";
import { UpdateService, PACKAGE_NAME } from "../src/host/updater.mjs";
import { createCompanyRuntime } from "../src/host/company-runtime.mjs";

export const name = "dsh-member-manager";
// 显式声明两个依赖：官方 dsh-web-app 与第三方 dsh-skills-manager 都是这么写的。
// webServer 必须在这里声明，否则 ctx.webServer 不可用、Web 面板路由注册不上。
export const inject = ["tools", "webServer"];

const API_PREFIX = "/api/dsh-member-manager";

/** 宿主端版本号：从 package.json 读，避免像 v0.1.1 时代那样手改硬编码后忘记同步 */
const PACKAGE_VERSION = (() => {
  try {
    const file = fileURLToPath(new URL("../package.json", import.meta.url));
    return JSON.parse(fs.readFileSync(file, "utf8")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

/**
 * 启动标记：本插件无法热重载（每次改动都要重启 DSH），
 * 一旦"重启后没生效"，需要立刻区分两种完全不同的失败：
 *   - 模块**从未被 import** ⇒ loader 没挂上这一行（装载/激活问题）
 *   - import 了但 `apply` 没跑 ⇒ 服务注入等待中（inject 未满足）
 * 两个标记写在同一文件里，重启后读一眼即可定位。
 * 纯诊断用途，失败绝不影响插件；文件上限 32KB，超出即重写。
 */
function bootMark(stage) {
  try {
    const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
    const dir = path.join(home, "storages", "member-manager");
    const file = path.join(dir, "boot.log");
    fs.mkdirSync(dir, { recursive: true });
    let prev = "";
    try {
      prev = fs.readFileSync(file, "utf8");
    } catch {
      /* 首次运行 */
    }
    if (prev.length > 32 * 1024) prev = "";
    const line = `${new Date().toISOString()} pid=${process.pid} ${stage}\n`;
    fs.writeFileSync(file, prev + line, "utf8");
  } catch {
    /* 诊断失败绝不影响插件 */
  }
}

bootMark("module-imported");

/** 默认数据目录：~/.dsh/storages/member-manager */
function defaultDataDir() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
  return path.join(home, "storages", "member-manager");
}

/**
 * 推断本插件「被加载的那份安装目录」。
 *
 * 为什么不能直接 `path.dirname(import.meta.url)`：Node 默认解析符号链接，
 * 当插件以 junction（pnpm `link:` 安装）挂进 profile 时，import.meta.url 拿到的是
 * **仓库真实路径**，而不是 node_modules 下的 junction —— 而更新/回滚必须作用于
 * junction 本身（并识别出它是 junction 才能拒绝自动替换）。
 *
 * 策略：DSH_HOME 下 profiles 各 profile 的 node_modules/<包名> 里找到的第一个即为安装位；
 * 找不到（例如直接从仓库加载）才回退到真实包根。
 */
/** 插件包根目录（安装位或源码目录，取决于加载方式） */
function packageRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function defaultInstallDir() {
  try {
    const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
    const profiles = path.join(home, "profiles");
    if (fs.existsSync(profiles)) {
      for (const entry of fs.readdirSync(profiles, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const candidate = path.join(profiles, entry.name, "node_modules", PACKAGE_NAME);
        try {
          if (fs.existsSync(candidate)) return candidate;
        } catch {
          /* 单个 profile 不可读就跳过 */
        }
      }
    }
  } catch {
    /* 推断失败走回退 */
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

/** 把诊断结果翻译成可操作的建议 */
function buildHints(checks, view) {
  const by = Object.fromEntries(checks.map((c) => [c.name, c]));
  const hints = [];
  if (!by.registryDirWritable.ok) {
    hints.push("名册目录不可写：检查 DSH_HOME 权限，或在插件配置里指定可写的 dataDir。");
  }
  if (!by.coreTeamService.ok) {
    hints.push(
      "核心团队服务不可用：「未登记成员」列表会为空，但手工 member_add 与组织架构仍然可用。若对话里跑过 member_list 后缓存仍为空，说明服务名或内核 API 与预期不符。",
    );
  }
  if (!by.webPanelsRoutes.ok) {
    hints.push("Web 面板路由未注册：面板打不开，但全部工具仍可用 —— 可直接用工具完成成员管理。");
  }
  if (view.stats.orphans > 0) {
    hints.push(`有 ${view.stats.orphans} 名成员不在核心当前成员列表里（可能属于其他会话或用例已结束）——这是提示，不是错误。`);
  }
  if (hints.length === 0) hints.push("一切正常。");
  return hints;
}

export function apply(ctx, config) {
  bootMark("apply-called");

  // ⚠️ Cordis 把插件配置作为**第二个参数**传入 —— 官方 dsh-web-app、dshmarket、
  // dsh-experimental-tool-agent-team 的签名都是 `apply(ctx, config)`。
  //
  // 千万不要直接写 `ctx.config`：在 cordis 的 Context 上访问**未声明的属性会抛错**，
  // 而 `config` 并不在 inject 列表里。这个错误正是本插件此前"模块已加载、apply 已进入，
  // 但之后什么都没注册（无工具、无路由、无后续启动标记）"的真实原因 ——
  // 它在 apply 的第一行就中断了整条激活流程。
  let cfg = {};
  try {
    if (config && typeof config === "object") cfg = config;
  } catch {
    cfg = {};
  }
  if (Object.keys(cfg).length === 0) {
    // 兼容：某些宿主会把配置挂到 ctx 上。这里必须包在 try 里 —— 在 cordis 上
    // 这次访问本身就是抛错点，包住它才不会重演上面那个故障。
    try {
      if (ctx.config && typeof ctx.config === "object") cfg = ctx.config;
    } catch {
      /* cordis 上 ctx.config 未声明 → 忽略，使用默认值 */
    }
  }
  const dataDir = cfg.dataDir || defaultDataDir();
  const registryFile = cfg.registryFile || path.join(dataDir, "registry.json");
  // 技能目录：默认除注册表外还直接扫盘兜底（见 skillCatalog 的注释）；
  // 测试与特殊部署可用 scanLocalSkills:false 关掉，或 extraSkillRoots 追加自定义根。
  const scanLocalSkills = cfg.scanLocalSkills !== false;
  const extraSkillRoots = Array.isArray(cfg.extraSkillRoots)
    ? cfg.extraSkillRoots.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim())
    : [];

  // 备份（0.2.0）：默认开，任何名册写入后自动快照，避免插件升级/重装丢组织架构。
  const backupsCfg = cfg.backups && typeof cfg.backups === "object" ? cfg.backups : {};
  const backupsEnabled = backupsCfg.enabled !== false;
  const backupsKeep = Number.isInteger(backupsCfg.keep) && backupsCfg.keep > 0 ? backupsCfg.keep : 20;
  const backupsDailyKeep = Number.isInteger(backupsCfg.dailyKeep) && backupsCfg.dailyKeep > 0 ? backupsCfg.dailyKeep : 7;

  // 自动更新（0.2.0）：默认「只检查不自动应用」，应用必须有显式请求。
  const updateCfg = cfg.update && typeof cfg.update === "object" ? cfg.update : {};
  const updateEnabled = updateCfg.enabled !== false;
  const updateCheckOnBoot = updateCfg.checkOnBoot === true;
  const updateRegistryUrl = typeof updateCfg.registryUrl === "string" && updateCfg.registryUrl.trim() ? updateCfg.registryUrl.trim() : undefined;
  const updateInstallDir = typeof updateCfg.installDir === "string" && updateCfg.installDir.trim() ? updateCfg.installDir.trim() : defaultInstallDir();
  // 事故报告的核心教训：运行中替换插件目录不安全。默认只允许「离线应用」
  // （退出 DSH 后运行 scripts/apply-pending.mjs）；只有显式打开时才允许在线应用。
  const updateAllowOnlineApply = updateCfg.allowOnlineApply === true;
  // 自动暂存：启动检查到新版后自动下载到 staging（只写数据目录，不碰安装目录）。
  const updateAutoStage = updateCfg.autoStage === true;
  const applyScriptPath = path.join(packageRoot(), "scripts", "apply-pending.mjs");

  // 可视化工作流（0.2.0）：旁路采集，默认开。
  const workflowCfg = cfg.workflow && typeof cfg.workflow === "object" ? cfg.workflow : {};
  const workflowEnabled = workflowCfg.enabled !== false;
  const workflowPersistMs = Number.isInteger(workflowCfg.persistMs) && workflowCfg.persistMs >= 1000 ? workflowCfg.persistMs : 5000;
  const workflowRetentionHours = Number.isFinite(workflowCfg.retentionHours) && workflowCfg.retentionHours > 0 ? workflowCfg.retentionHours : 6;
  const workflowTasksPollMs = Number.isInteger(workflowCfg.tasksPollMs) && workflowCfg.tasksPollMs >= 1000 ? workflowCfg.tasksPollMs : 3000;

  bootMark(`config-resolved:dataDir=${dataDir}`);

  /** 只记录、不抛出：任何降级都不应让插件加载失败 */
  function warn(message) {
    try {
      if (typeof console !== "undefined" && console && typeof console.warn === "function") {
        console.warn(`[${name}] ${message}`);
      }
    } catch {
      /* 日志失败也绝不影响插件 */
    }
  }

  /* ------------------------------------------------------------------ */
  /* 公司化运行时（0.3.0）                                                */
  /* ------------------------------------------------------------------ */

  // 公司运行时是「附加能力」：创建失败绝不能影响名册覆盖层（工具/路由/面板）。
  // 注意：这里只**同步构造**，不读盘、不建会话、不注册事件 —— 真正的 IO 全部
  // 放在 company.boot() 里，由 apply 末尾的 ctx.effect 非阻塞触发。
  const companyState = { enabled: false, booted: false, warnings: [], error: null };
  // 名册服务引用：company runtime 先于 TeamService 构造，用可变 ref 做惰性桥接
  // （v0.3.2 公司与名册双向关联用；TeamService 在下方服务装配处赋值）。
  const teamServiceRef = { current: null };
  let company = null;
  try {
    company = createCompanyRuntime(ctx, {
      dataDir,
      config: cfg,
      logger: {
        warn: (msg) => warn(`[company] ${msg}`),
        info: (msg) => warn(`[company] ${msg}`),
        debug: () => {},
      },
      // v0.3.2：公司员工 ↔ 名册关联桥。两个函数都在调用时惰性解析：
      // service 取 TeamService（写），members 取名册成员快照（读，1s TTL）。
      // 名册读不到时返回 null —— 面板据此显示「名册不可用」，而不是把全员误标成未登记。
      roster: {
        service: () => teamServiceRef.current,
        members: () => {
          try {
            const registry = readRegistryCached(1000);
            return registry && Array.isArray(registry.members) ? registry.members : null;
          } catch {
            return null;
          }
        },
      },
    });
    companyState.enabled = Boolean(company);
    bootMark(`company-runtime-created:tools=${company?.tools?.length ?? 0}:routes=${company?.routes?.length ?? 0}`);
  } catch (err) {
    const detail = err?.message ?? String(err);
    company = null;
    companyState.error = detail;
    bootMark(`company-runtime-failed:${detail.slice(0, 200)}`);
    warn(`公司运行时初始化失败（名册功能不受影响）：${detail}`);
  }

  /** /state 与 member_diagnose 用的公司摘要：全程 try/catch，绝不让面板 500 */
  function companySummary() {
    let snapshot = null;
    try {
      snapshot = company && typeof company.view === "function" ? company.view() : null;
    } catch (err) {
      companyState.error = err?.message ?? String(err);
      snapshot = null;
    }
    const org = snapshot?.org || {};
    return {
      enabled: Boolean(company),
      booted: companyState.booted,
      warnings: companyState.warnings.slice(-5),
      error: companyState.error,
      status: snapshot?.status ?? "unknown",
      departments: Array.isArray(org.departments) ? org.departments.length : 0,
      employees: Array.isArray(org.employees) ? org.employees.length : 0,
      orders: Array.isArray(snapshot?.orders) ? snapshot.orders.length : 0,
      companyName: snapshot?.companyName ?? null,
    };
  }

  /**
   * v0.3.2：名册 target → 公司员工 的关联索引（member_list / member_diagnose / 面板共用）。
   * 键 = 员工的有效名册 target：显式 rosterTarget 优先，否则员工 id（隐式约定）。
   * 返回 null 表示公司视图读不到（未启用/初始化失败），调用方不要把它当成「全员未关联」。
   */
  function companyRosterIndex() {
    try {
      if (!company || typeof company.view !== "function") return null;
      const snapshot = company.view();
      const employees = Array.isArray(snapshot?.org?.employees) ? snapshot.org.employees : null;
      if (!employees) return null;
      const map = new Map();
      for (const emp of employees) {
        const explicit = typeof emp?.rosterTarget === "string" ? emp.rosterTarget.trim() : "";
        map.set(explicit || String(emp?.id || ""), emp);
      }
      return map;
    } catch (err) {
      companyState.error = err?.message ?? String(err);
      return null;
    }
  }

  /** 名册成员视角的关联信息（未关联返回 null，由调用方决定怎么展示）。 */
  function companyLinkForMember(target, index) {
    if (!index) return null;
    const emp = index.get(String(target || ""));
    if (!emp) return null;
    return {
      employeeId: emp.id,
      code: emp.code ?? null,
      displayName: emp.displayName ?? null,
      departmentId: emp.department ?? null,
      departmentCode: emp.departmentCode ?? null,
      role: emp.role ?? null,
      state: emp.state ?? null,
      explicit: Boolean(typeof emp.rosterTarget === "string" && emp.rosterTarget.trim()),
      linkStatus: emp.roster?.status ?? null,
    };
  }

  /* ------------------------------------------------------------------ */
  /* 核心成员列表：缓存快照                                              */
  /* ------------------------------------------------------------------ */

  /** rootSessionId -> Set<memberName> */
  const rosterCache = new Map();
  let cacheError = null;
  let lastRefresh = null;

  /** Web 面板路由的注册状态，供 member_diagnose 报告 */
  const routeState = { webServerSeen: false, registered: [], errors: [] };

  /** 用 live agent 刷新缓存。任何一步失败都只能降级，不能抛给宿主。 */
  function refreshFromAgent(agent) {
    try {
      const teams = ctx.get("agentTeams");
      if (!teams || !agent) return;
      const membership = teams.tryMembership(agent);
      if (!membership) return;
      // 只有 root（Lead）能列出整队
      if (membership.role !== "lead") return;
      const rows = teams.listMembers(membership.root) || [];
      const names = rows.map((r) => r?.name).filter((n) => typeof n === "string" && n);
      rosterCache.set(membership.root.id, new Set(names));
      lastRefresh = new Date().toISOString();
      cacheError = null;
    } catch (err) {
      cacheError = err?.message ?? String(err);
    }
  }

  function liveTargets() {
    if (rosterCache.size === 0) {
      // 缓存为空 ≠ 核心没有成员：返回 null 让上层标记 coreAvailable=false
      return null;
    }
    const union = new Set();
    for (const set of rosterCache.values()) for (const n of set) union.add(n);
    return [...union];
  }

  const store = new RegistryStore({ file: registryFile });
  // onWrite：任何一次成功写入都让名册缓存失效，agent/request 路径立刻拿到新值；
  // 同时排一次防抖备份 —— 组织架构是用户手工维护的资产，升级/重装不该把它弄丢。
  const service = new TeamService({
    store,
    liveTargets,
    onWrite: () => {
      invalidateRegistryMemo();
      onRegistryWritten();
    },
  });
  teamServiceRef.current = service;
  bootMark("service-ready");

  /* ------------------------------------------------------------------ */
  /* 0.2.0 · 名册备份（组织架构不因升级/重装/误操作丢失）                  */
  /* ------------------------------------------------------------------ */

  const backupState = { lastAt: null, lastFile: null, lastError: null, lastReason: null };
  let backupTimer = null;

  /** 同步做一次备份；任何失败只记录，绝不抛出（写入主流程不能被备份拖垮）。 */
  function runBackup(reason, extra = {}) {
    if (!backupsEnabled) return { ok: false, code: "BACKUP_DISABLED", message: "备份已关闭（backups.enabled=false）" };
    try {
      const result = backupNow({
        dataDir,
        registryFile,
        reason: reason || "manual",
        keep: backupsKeep,
        dailyKeep: backupsDailyKeep,
      });
      if (result && result.ok) {
        backupState.lastAt = result.at;
        backupState.lastFile = result.file;
        backupState.lastError = null;
        backupState.lastReason = reason || "manual";
      } else {
        backupState.lastError = result?.code || "UNKNOWN";
      }
      return result;
    } catch (err) {
      const message = err?.message ?? String(err);
      backupState.lastError = message;
      warn(`名册备份失败：${message}`);
      return { ok: false, code: "BACKUP_FAILED", message };
    }
  }

  /** 写入后防抖备份：连续编辑只在最后一次落一份，避免刷出几十份同分钟备份。 */
  function onRegistryWritten() {
    if (!backupsEnabled) return;
    if (backupTimer) clearTimeout(backupTimer);
    backupTimer = setTimeout(() => {
      backupTimer = null;
      runBackup("auto");
    }, 1500);
    if (backupTimer && typeof backupTimer.unref === "function") backupTimer.unref();
  }

  /** 恢复备份：先校验结构，再写盘；成功后排一次「恢复后快照」并失效缓存。 */
  function restoreBackupFile(args = {}) {
    const file = typeof args.file === "string" ? args.file.trim() : "";
    if (!file) return { ok: false, code: "MISSING_FILE", message: "需要 file（备份文件名，可先 listBackups 查看）" };
    const result = restoreBackup({
      dataDir,
      registryFile,
      file,
      validate: (data) => validateRegistry(data),
    });
    if (result && result.ok) {
      invalidateRegistryMemo();
      runBackup("post-restore");
    }
    return result;
  }

  function backupView() {
    let status = { ok: true, count: 0, totalBytes: 0, latest: null };
    try {
      status = backupStatus(dataDir);
    } catch (err) {
      status = { ok: false, code: "BACKUP_STATUS_FAILED", message: err?.message ?? String(err) };
    }
    let list = [];
    try {
      list = listBackups(dataDir).slice(0, 20);
    } catch {
      list = [];
    }
    return {
      ok: true,
      enabled: backupsEnabled,
      dir: path.join(dataDir, "backups"),
      keep: backupsKeep,
      dailyKeep: backupsDailyKeep,
      autoAfterWrite: backupsEnabled,
      count: status.count ?? 0,
      totalBytes: status.totalBytes ?? 0,
      latest: status.latest ?? null,
      lastAt: backupState.lastAt,
      lastFile: backupState.lastFile,
      lastReason: backupState.lastReason,
      lastError: backupState.lastError,
      list,
    };
  }

  // 启动时先留一份「启动快照」：即使之后被误删/误改，也有最近一次启动时的组织架构。
  // 同一天重复启动会按 rotation 的 dailyKeep 收敛，不会无限增长。
  if (backupsEnabled) runBackup("boot");

  /* ------------------------------------------------------------------ */
  /* 0.2.0 · 工作流观测器（可视化工作流面板的数据源）                      */
  /* ------------------------------------------------------------------ */

  const tracker = workflowEnabled
    ? new WorkflowTracker({
        dataDir,
        persistMs: workflowPersistMs,
        retentionMs: workflowRetentionHours * 3600 * 1000,
        log: warn,
      })
    : null;

  /** 统一登记一个定时器：cordis 卸载时清理，且不阻止进程退出。 */
  function registerInterval(fn, ms) {
    const handle = setInterval(fn, ms);
    if (handle && typeof handle.unref === "function") handle.unref();
    try {
      ctx.effect(() => () => {
        try {
          clearInterval(handle);
        } catch {
          /* 已清理 */
        }
      });
    } catch {
      /* ctx.effect 不可用也不影响观测 */
    }
    return handle;
  }

  function targetForAgent(agent) {
    try {
      const teams = ctx.get("agentTeams");
      if (!teams || typeof teams.tryMembership !== "function") return null;
      const membership = teams.tryMembership(agent);
      return (membership && membership.name) || null;
    } catch {
      return null;
    }
  }

  /** target → live agent 实例（状态、id 都在实例上） */
  function liveAgentsByTarget() {
    const out = new Map();
    try {
      const agents = ctx.get("agents");
      if (!agents || typeof agents.list !== "function") return out;
      for (const agent of agents.list()) {
        const target = targetForAgent(agent);
        if (target) out.set(target, agent);
      }
    } catch {
      /* 查询失败就当作没有 live 数据 */
    }
    return out;
  }

  if (tracker) {
    try {
      tracker.start(registerInterval);
      // 注意：session/event 是位置参数 (session, event)，不是单个对象载荷。
      ctx.on("session/event", (session, event) => {
        if (!session || !event) return;
        let target = null;
        try {
          const sid = session.id || (session.session && session.session.id);
          if (sid) {
            for (const [name, agent] of liveAgentsByTarget()) {
              const asid = agent && agent.session && agent.session.id;
              if (asid === sid) {
                target = name;
                break;
              }
            }
          }
        } catch {
          /* 解析失败就不带 target，只记会话级用量 */
        }
        tracker.observeEvent(session, event, target);
      });
      bootMark("workflow-tracker-ready");
    } catch (err) {
      warn(`工作流观测器启动失败（面板将降级）：${err?.message ?? err}`);
    }

    // 任务板轮询：任务板没有时间字段，插件自己观测「第一次看到」与状态变化来算用时。
    const pollTasks = () => {
      try {
        const teams = ctx.get("agentTeams");
        if (!teams || typeof teams.listTasks !== "function") {
          tracker.observeTasks(null, { available: false, error: "当前宿主未提供 agentTeams.listTasks（任务板不可用）" });
          return;
        }
        let leadAgent = null;
        for (const agent of liveAgentsByTarget().values()) {
          const membership = teams.tryMembership(agent);
          if (membership && membership.role === "lead") {
            leadAgent = agent;
            break;
          }
        }
        if (!leadAgent) {
          tracker.observeTasks(null, { available: false, error: "当前会话还没有可用的 Lead agent（任务板需要 Lead 授权）" });
          return;
        }
        tracker.observeTasks(teams.listTasks(leadAgent) || []);
      } catch (err) {
        tracker.observeTasks(null, { available: false, error: err?.message ?? String(err) });
      }
    };
    registerInterval(pollTasks, workflowTasksPollMs);
    pollTasks();
  }

  /** 名册里的 active 成员 → 工作流面板的行。 */
  function workflowMemberRows() {
    const rows = [];
    try {
      const view = service.view();
      for (const group of view.groups || []) {
        for (const m of group.members || []) {
          if (m.status !== "active") continue;
          rows.push({ target: m.target, displayName: m.displayName, title: m.title, groupName: group.name, model: m.model, provider: m.provider });
        }
      }
      for (const m of view.ungrouped || []) {
        if (m.status !== "active") continue;
        rows.push({ target: m.target, displayName: m.displayName, title: m.title, groupName: "", model: m.model, provider: m.provider });
      }
    } catch (err) {
      warn(`读取名册生成工作流视图失败：${err?.message ?? err}`);
    }
    return rows;
  }

  function workflowSnapshot() {
    if (!tracker) {
      return { enabled: false, generatedAt: new Date().toISOString(), members: [], tasks: [], totals: null, tasksAvailable: false, tasksError: "工作流观测已在配置里关闭（workflow.enabled=false）" };
    }
    try {
      const live = liveAgentsByTarget();
      const snap = tracker.snapshot(workflowMemberRows(), {
        liveStatus: (target) => {
          const agent = live.get(target);
          return agent ? agent.status : null;
        },
      });
      return {
        enabled: true,
        ...snap,
        team: {
          liveMembers: live.size,
          lead: [...live.keys()].find((t) => {
            try {
              return ctx.get("agentTeams")?.tryMembership(live.get(t))?.role === "lead";
            } catch {
              return false;
            }
          }) || null,
        },
      };
    } catch (err) {
      return { enabled: true, generatedAt: new Date().toISOString(), members: [], tasks: [], totals: null, tasksAvailable: false, tasksError: err?.message ?? String(err) };
    }
  }

  /* ------------------------------------------------------------------ */
  /* 0.2.5 · 任务（会话）作用域的组织架构图                                */
  /* ------------------------------------------------------------------ */

  /** 读会话标题；宿主没有 sessionTitle 服务时返回空串（面板自己兜底）。 */
  function sessionTitleOf(session) {
    try {
      const svc = ctx.get("sessionTitle");
      if (!svc || typeof svc.get !== "function") return "";
      const snap = svc.get(session);
      const title = snap && (typeof snap === "string" ? snap : snap.title || snap.text);
      return typeof title === "string" ? title : "";
    } catch {
      return "";
    }
  }

  /** 所有存活 agent → 会话行；parentSession 决定它属于哪个任务。 */
  function liveTaskRows() {
    const rows = new Map();
    let agentList = [];
    try {
      const agents = ctx.get("agents");
      agentList = agents && typeof agents.list === "function" ? agents.list() : [];
    } catch {
      agentList = [];
    }
    let teams = null;
    try {
      teams = ctx.get("agentTeams") || null;
    } catch {
      teams = null;
    }
    for (const agent of agentList) {
      const session = agent && agent.session;
      const sessionId = session && typeof session.id === "string" ? session.id : null;
      if (!sessionId) continue;
      let membership = null;
      try {
        membership = teams && typeof teams.tryMembership === "function" ? teams.tryMembership(agent) : null;
      } catch {
        membership = null;
      }
      const parentSession = (session.header && session.header.parentSession) || null;
      rows.set(sessionId, {
        sessionId,
        agent,
        session,
        target: (membership && membership.name) || (parentSession ? null : "lead"),
        role: (membership && membership.role) || (parentSession ? "teammate" : "lead"),
        parentSession,
        rootId: parentSession || sessionId,
        title: sessionTitleOf(session),
        createdAt: (session.header && session.header.createdAt) || 0,
      });
    }
    return rows;
  }

  /** sessionId → 用量（tracker 里按会话累计）。 */
  function usageOfSession(sessionId) {
    const empty = { input: 0, output: 0, total: 0, requests: 0, cacheRead: 0, lastAt: 0 };
    if (!tracker) return empty;
    const row = tracker.sessions.get(sessionId);
    if (!row) return empty;
    return {
      input: row.input || 0,
      output: row.output || 0,
      total: row.total || 0,
      requests: row.requests || 0,
      cacheRead: row.cacheRead || 0,
      lastAt: row.lastAt || 0,
    };
  }

  /** 名册 target → 展示信息（含分组名）。 */
  function rosterMeta() {
    const map = new Map();
    try {
      const view = service.view();
      for (const g of view.groups || []) {
        for (const m of g.members || []) {
          map.set(m.target, {
            displayName: m.displayName,
            title: m.title,
            groupName: g.name,
            groupId: g.id,
            groupOrder: g.order ?? 0,
            model: m.model,
            provider: m.provider,
            status: m.status,
          });
        }
      }
      for (const m of view.ungrouped || []) {
        map.set(m.target, {
          displayName: m.displayName,
          title: m.title,
          groupName: "",
          groupId: "",
          groupOrder: 9999,
          model: m.model,
          provider: m.provider,
          status: m.status,
        });
      }
    } catch (err) {
      warn(`读取名册生成任务视图失败：${err?.message ?? err}`);
    }
    return map;
  }

  /** 把 liveTaskRows 组装成任务列表（只保留 root 会话；没有可展示成员的不算任务）。 */
  function buildTaskList(rows, meta) {
    const list = [];
    for (const [rootId, row] of rows) {
      if (row.parentSession) continue;
      const participants = [row];
      for (const [sid, child] of rows) {
        if (sid === rootId) continue;
        if (child.rootId === rootId) participants.push(child);
      }
      const visible = participants.filter((p) => p.target && (p.role === "lead" || meta.has(p.target) || p.target === "lead"));
      if (!visible.length) continue;
      let updatedAt = row.createdAt || 0;
      let running = false;
      for (const p of visible) {
        const u = usageOfSession(p.sessionId);
        if (u.lastAt > updatedAt) updatedAt = u.lastAt;
        if (p.agent && p.agent.status === "running") running = true;
      }
      list.push({
        id: rootId,
        title: row.title || "",
        updatedAt,
        running,
        memberCount: visible.length,
        members: visible.map((p) => p.target),
        participants: visible,
        row,
      });
    }
    list.sort((a, b) => b.updatedAt - a.updatedAt || String(a.id).localeCompare(String(b.id)));
    return list;
  }

  /**
   * 公司化工作网快照：管理层（M 通道聚合）→ 部门（含编号/负责人）→ 员工（含工号/等级）。
   * 叠加 tracker 的实时状态、任务与 token 用量；公司化未启用或无员工时返回 null（回退旧任务视图）。
   */
  function companyWorknetSnapshot(taskRows, selected) {
    let view = null;
    try {
      view = company && typeof company.view === "function" ? company.view() : null;
    } catch (err) {
      return null;
    }
    if (!view || !view.enabled || !view.org || !Array.isArray(view.org.employees) || !view.org.employees.length) return null;
    const employees = view.org.employees.filter((e) => e && e.state !== "fired");
    if (!employees.length) return null;
    const depts = [...(view.org.departments || [])].sort(
      (a, b) => String(a.code || "").localeCompare(String(b.code || ""), undefined, { numeric: true }) || String(a.name || "").localeCompare(String(b.name || "")),
    );
    const byId = new Map(employees.map((e) => [e.id, e]));
    const byDept = new Map(depts.map((d) => [d.id, d]));
    const costs = view.costs || {};
    const byEmployee = costs.byEmployee || {};
    const agentEntry = (id) => (tracker ? tracker.agents.get(id) : null);
    const ownedWork = (id) => {
      const owned = taskRows.filter((t) => t.ownerName === id);
      if (!owned.length) return null;
      const row = owned.find((t) => t.lastStatus === "in_progress") || owned[0];
      return { taskId: row.taskId, subject: row.subject || "", status: row.lastStatus || "pending" };
    };
    const cards = employees.map((e) => {
      const dept = e.department ? byDept.get(e.department) : null;
      const usage = byEmployee[e.id] || {};
      const live = agentEntry(e.id);
      const status = live && live.status === "running" ? "running" : live && live.status ? live.status : "idle";
      const elapsedMs = live
        ? (live.activeMs || 0) + (status === "running" && typeof live.runningSince === "number" ? Math.max(0, Date.now() - live.runningSince) : 0)
        : 0;
      return {
        target: e.id,
        displayName: e.displayName || e.id,
        title: e.title || "",
        code: e.code || "",
        channel: e.channel || "",
        level: e.level || "",
        levelName: e.levelName || "",
        channels: Array.isArray(e.channels) ? e.channels : [],
        role: e.role || "",
        state: e.state || "",
        model: e.model || "",
        provider: e.provider || "",
        groupId: e.department || "",
        groupName: dept ? (dept.code ? dept.code + " " : "") + (dept.name || dept.id) : "",
        status: status,
        live: status === "running",
        usage: { total: usage.tokens || 0, requests: usage.requests || 0, input: 0, output: 0, cacheRead: 0 },
        elapsedMs: elapsedMs,
        work: ownedWork(e.id),
      };
    });
    const groups = depts.map((d) => {
      const manager = d.managerId ? byId.get(d.managerId) : null;
      return {
        id: d.id,
        name: (d.code ? d.code + " " : "") + (d.name || d.id),
        code: d.code || "",
        managerName: manager ? manager.displayName || manager.id : "",
        order: d.code || "",
        members: cards.filter((c) => c.groupId === d.id),
      };
    });
    const ungrouped = cards.filter((c) => !c.groupId || !byDept.has(c.groupId));
    const management = view.management || { name: "管理层", employees: [] };
    const mgmtEmployees = Array.isArray(management.employees) ? management.employees : [];
    const mgmtUsage = mgmtEmployees.reduce(
      (acc, e) => {
        const u = byEmployee[e.id] || {};
        acc.total += u.tokens || 0;
        acc.requests += u.requests || 0;
        return acc;
      },
      { total: 0, requests: 0 },
    );
    const lead = {
      target: "__management__",
      displayName: management.name || "管理层",
      title: mgmtEmployees.length + " 名 M 通道成员",
      role: "management",
      status: "idle",
      model: "",
      provider: "",
      usage: { total: mgmtUsage.total, requests: mgmtUsage.requests },
      elapsedMs: 0,
      work: null,
    };
    const dispatch = cards
      .filter((c) => c.work)
      .map((c) => ({ from: lead.target, to: c.target, taskId: c.work.taskId, subject: c.work.subject, status: c.work.status }));
    const dependency = [];
    const known = new Set(cards.map((c) => c.target));
    const byTaskId = new Map(taskRows.map((t) => [t.taskId, t]));
    for (const t of byTaskId.values()) {
      if (!t.ownerName || !known.has(t.ownerName)) continue;
      for (const upId of t.blockedBy || []) {
        const up = byTaskId.get(upId);
        if (up && up.ownerName && known.has(up.ownerName) && up.ownerName !== t.ownerName) {
          dependency.push({ from: up.ownerName, to: t.ownerName, taskId: t.taskId, upstreamId: upId, status: t.lastStatus || "pending" });
        }
      }
    }
    const totals = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: costs.tokens || 0,
      requests: costs.requests || 0,
      cacheReadTokens: 0,
      cacheHitRate: 0,
      activeMs: cards.reduce((acc, c) => acc + (c.elapsedMs || 0), 0),
    };
    // v0.4：订单泳道 + 调度健康度（工作网要能看出「任务到底派给谁了」）
    const orderRows = Array.isArray(view.orders) ? view.orders : [];
    const liveAttempts = Array.isArray(view.attempts) ? view.attempts : [];
    const deptLabel = (id) => {
      const d = id ? byDept.get(id) : null;
      return d ? (d.code ? d.code + " " : "") + (d.name || d.id) : "";
    };
    const empLabel = (id) => (id ? byId.get(id)?.displayName || id : "");
    const orders = orderRows
      .map((o) => {
        const attempts = Array.isArray(o.attempts) ? o.attempts : [];
        const live = liveAttempts.find((a) => a.orderId === o.id) || null;
        const lastAttempt = attempts.length ? attempts[attempts.length - 1] : null;
        const employee = live?.employee || lastAttempt?.employee || null;
        const startedAt = live?.startedAt || null;
        const startedMs = startedAt ? Date.parse(startedAt) : NaN;
        return {
          id: o.id,
          title: o.title || "",
          type: o.type || "",
          priority: o.priority || "normal",
          state: o.state || "",
          project: o.project || "",
          detail: o.detail || "",
          dept: o.dept || null,
          deptName: deptLabel(o.dept),
          employee: employee,
          employeeName: empLabel(employee),
          attemptId: live?.attemptId || null,
          attemptNo: lastAttempt?.attemptNo || attempts.length || 0,
          attemptCount: attempts.length,
          attempts: attempts.map((a) => ({
            id: a.id,
            employee: a.employee,
            employeeName: empLabel(a.employee),
            state: a.state || "",
            attemptNo: a.attemptNo || 0,
            startedAt: a.startedAt || null,
            endedAt: a.endedAt || null,
            invalidated: !!a.invalidated,
            staleReason: a.staleReason || null,
          })),
          createdAt: o.createdAt || null,
          endedAt: o.endedAt || null,
          // 会话归档：订单归属的 root 会话（company_order 由工具侧写入，面板派活由看板补写）。
          // sessionTitle 是建单当时的标题快照，会话被归档/标题被改也不会丢失「属于哪个对话」。
          sessionId: o.sessionId || null,
          sessionTitle: o.sessionTitle || null,
          deps: Array.isArray(o.deps) ? o.deps : [],
          acceptance: Array.isArray(o.acceptance) ? o.acceptance : [],
          routeError: o.routeError || null,
          retryAfter: o.retryAfter || null,
          borrowed: !!o.borrowed,
          // 任务图：同批次的单共享 group，taskKey 是它在图里的键（普通单两者都为空）
          group: o.group || null,
          taskKey: o.taskKey || null,
          elapsedMs: Number.isFinite(startedMs) ? Math.max(0, Date.now() - startedMs) : 0,
          summary: lastAttempt?.summary || "",
        };
      })
      // 统一「最新在前」：未结束的单按 createdAt，已结束的单按 endedAt。
      // 只按 createdAt 排会让「先建后交」的长任务把刚交的活挤到下面，
      // 而这里同时决定 pipeline.done 的次序，所以必须落到 endedAt 上。
      .sort((a, b) => {
        const closed = (o) => o.endedAt && o.state !== "queued" && o.state !== "routed" && o.state !== "running";
        const key = (o) => Date.parse((closed(o) ? o.endedAt : null) || o.createdAt || "") || 0;
        return key(b) - key(a);
      });
    for (const card of cards) {
      card.currentOrder = orders.find((o) => o.employee === card.target && o.state === "running") || null;
      card.deptName = card.groupName || "";
    }
    const pipeline = { queued: [], routed: [], running: [], done: [], abnormal: [] };
    for (const o of orders) {
      if (o.state === "queued") pipeline.queued.push(o.id);
      else if (o.state === "routed") pipeline.routed.push(o.id);
      else if (o.state === "running") pipeline.running.push(o.id);
      else if (o.state === "done") pipeline.done.push(o.id);
      else pipeline.abnormal.push(o.id);
    }
    const health = view.health || null;
    const deptStats = depts.map((d) => {
      const live = liveAttempts.filter((a) => byId.get(a.employee)?.department === d.id);
      return {
        id: d.id,
        name: (d.code ? d.code + " " : "") + (d.name || d.id),
        capacity: Number(d.capacity) || 4,
        busy: live.length,
        idle: cards.filter((c) => c.groupId === d.id && (c.state === "idle" || c.status === "idle")).length,
        total: cards.filter((c) => c.groupId === d.id).length,
      };
    });
    const companyName = view.companyName || "";
    const companyTaskTitle = (t) => (t && String(t.id || "").startsWith("company-owner-") && companyName ? companyName : t && t.title);
    return {
      companyName,
      lead,
      groups,
      ungrouped,
      members: cards,
      dispatch,
      dependency,
      totals,
      orders,
      pipeline,
      health,
      deptStats,
      task: selected
        ? {
            id: selected.id,
            title: companyTaskTitle(selected),
            updatedAt: selected.updatedAt,
            running: selected.running,
            memberCount: selected.memberCount,
          }
        : null,
    };
  }

  /** 当前任务的卡片/连线快照；taskId 为空时取最近活跃任务。 */
  function orgmapSnapshot(taskId) {
    const generatedAt = new Date().toISOString();
    const meta = rosterMeta();
    const rows = liveTaskRows();
    const tasks = buildTaskList(rows, meta);
    const summaries = tasks.map((t) => ({
      id: t.id,
      title: t.title,
      updatedAt: t.updatedAt,
      running: t.running,
      memberCount: t.memberCount,
      members: t.members,
    }));
    const selected = (taskId && tasks.find((t) => t.id === taskId)) || tasks[0] || null;
    const emptyTotals = { inputTokens: 0, outputTokens: 0, totalTokens: 0, requests: 0, cacheReadTokens: 0, cacheHitRate: 0, activeMs: 0 };
    const base = {
      version: 2,
      generatedAt,
      enabled: !!tracker,
      tasks: summaries,
      task: null,
      lead: null,
      groups: [],
      members: [],
      dispatch: [],
      dependency: [],
      totals: emptyTotals,
      tasksAvailable: tracker ? tracker.tasksAvailable === true : false,
      tasksError: tracker ? tracker.tasksError || null : "工作流观测已关闭",
    };
    const taskRows = tracker ? [...tracker.tasks.values()] : [];
    const worknet = companyWorknetSnapshot(taskRows, selected);
    if (worknet) {
      return {
        ...base,
        version: 3,
        source: "company",
        companyName: worknet.companyName,
        worknet: { departments: worknet.groups.length, employees: worknet.members.length },
        tasks: summaries.map((t) =>
          String(t.id || "").startsWith("company-owner-") && worknet.companyName ? { ...t, title: worknet.companyName } : t,
        ),
        lead: worknet.lead,
        groups: worknet.groups,
        ungrouped: worknet.ungrouped,
        members: worknet.members,
        dispatch: worknet.dispatch,
        dependency: worknet.dependency,
        totals: worknet.totals,
        orders: worknet.orders,
        pipeline: worknet.pipeline,
        health: worknet.health,
        deptStats: worknet.deptStats,
        task: worknet.task,
      };
    }
    if (!selected) return base;

    const byTaskId = new Map(taskRows.map((t) => [t.taskId, t]));

    const cards = selected.participants.map((p) => {
      const info = meta.get(p.target) || {};
      const usage = usageOfSession(p.sessionId);
      const agentEntry = tracker ? tracker.agents.get(p.target) : null;
      const liveStatus = p.agent && typeof p.agent.status === "string" ? p.agent.status : null;
      const elapsedMs = agentEntry
        ? (agentEntry.activeMs || 0) +
          (liveStatus === "running" && typeof agentEntry.runningSince === "number" ? Math.max(0, Date.now() - agentEntry.runningSince) : 0)
        : 0;
      const owned = taskRows.filter((t) => t.ownerName === p.target);
      const workRow = owned.find((t) => t.lastStatus === "in_progress") || owned[0] || null;
      return {
        target: p.target,
        displayName: info.displayName || p.target,
        title: info.title || "",
        groupName: info.groupName || "",
        groupId: info.groupId || "",
        groupOrder: info.groupOrder ?? 9999,
        role: p.role,
        model: info.model || "",
        provider: info.provider || "",
        status: liveStatus || (agentEntry && agentEntry.status) || "unknown",
        live: !!p.agent,
        usage: { total: usage.total, input: usage.input, output: usage.output, requests: usage.requests, cacheRead: usage.cacheRead },
        elapsedMs,
        work: workRow ? { taskId: workRow.taskId, subject: workRow.subject || "", status: workRow.lastStatus || "pending" } : null,
      };
    });

    const lead = cards.find((c) => c.role === "lead") || null;
    const others = cards.filter((c) => c !== lead);
    const groupMap = new Map();
    for (const card of others) {
      const key = card.groupId || "__ungrouped__";
      if (!groupMap.has(key)) {
        groupMap.set(key, { id: card.groupId || "", name: card.groupName || "", order: card.groupOrder, members: [] });
      }
      groupMap.get(key).members.push(card);
    }
    const groups = [...groupMap.values()].sort((a, b) => a.order - b.order);

    const known = new Set(cards.map((c) => c.target));
    const dispatch = [];
    const dependency = [];
    for (const card of others) {
      dispatch.push({
        from: lead ? lead.target : "lead",
        to: card.target,
        taskId: card.work ? card.work.taskId : "",
        subject: card.work ? card.work.subject : "",
        status: card.work ? card.work.status : "pending",
      });
      for (const t of byTaskId.values()) {
        if (t.ownerName !== card.target) continue;
        for (const upId of t.blockedBy || []) {
          const up = byTaskId.get(upId);
          if (up && up.ownerName && known.has(up.ownerName) && up.ownerName !== card.target) {
            dependency.push({ from: up.ownerName, to: card.target, taskId: t.taskId, upstreamId: upId, status: t.lastStatus || "pending" });
          }
        }
      }
    }

    const sum = (key) => cards.reduce((acc, c) => acc + (c.usage[key] || 0), 0);
    const totals = {
      inputTokens: sum("input"),
      outputTokens: sum("output"),
      totalTokens: sum("total"),
      requests: sum("requests"),
      cacheReadTokens: sum("cacheRead"),
      cacheHitRate: 0,
      activeMs: cards.reduce((acc, c) => acc + (c.elapsedMs || 0), 0),
    };
    totals.cacheHitRate = totals.inputTokens + totals.cacheReadTokens > 0 ? totals.cacheReadTokens / (totals.inputTokens + totals.cacheReadTokens) : 0;

    return {
      ...base,
      lead,
      groups,
      members: cards,
      dispatch,
      dependency,
      totals,
      task: {
        id: selected.id,
        title: selected.title,
        updatedAt: selected.updatedAt,
        running: selected.running,
        memberCount: selected.memberCount,
      },
    };
  }
  /* ------------------------------------------------------------------ */
  /* 0.2.0 · 自动更新（staging → pending → 显式 apply）                    */
  /* ------------------------------------------------------------------ */

  let currentVersion = "0.0.0";
  try {
    // 版本从包清单读，避免把 "0.2.0" 手抄到代码里
    currentVersion = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")).version || currentVersion;
  } catch {
    /* 读不到就退化为 0.0.0（只影响版本比较展示） */
  }

  const updater = updateEnabled
    ? new UpdateService({
        dataDir,
        installDir: updateInstallDir,
        currentVersion,
        ...(updateRegistryUrl ? { registryUrl: updateRegistryUrl } : {}),
      })
    : null;

  const updateState = { lastCheck: null, lastError: null, latest: null, lastAction: null };

  async function updateCheck() {
    if (!updater) return { ok: false, code: "UPDATE_DISABLED", message: "自动更新已在配置里关闭（update.enabled=false）" };
    try {
      const result = await updater.check();
      updateState.lastCheck = new Date().toISOString();
      updateState.lastError = null;
      updateState.latest = result;
      return { ok: true, data: result };
    } catch (err) {
      updateState.lastCheck = new Date().toISOString();
      updateState.lastError = err?.message ?? String(err);
      return { ok: false, code: err?.code || "UPDATE_CHECK_FAILED", message: updateState.lastError };
    }
  }

  async function updateStage() {
    if (!updater) return { ok: false, code: "UPDATE_DISABLED", message: "自动更新已在配置里关闭" };
    try {
      const meta = updateState.latest && updateState.latest.outdated ? updateState.latest : null;
      if (!meta) return { ok: false, code: "NO_UPDATE", message: "还没有发现比当前版本更新的版本，请先检查更新" };
      const result = await updater.stage(meta);
      updateState.lastAction = { action: "stage", at: new Date().toISOString(), result };
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, code: err?.code || "UPDATE_STAGE_FAILED", message: err?.message ?? String(err) };
    }
  }

  async function updateApply() {
    if (!updater) return { ok: false, code: "UPDATE_DISABLED", message: "自动更新已在配置里关闭" };
    if (!updateAllowOnlineApply) {
      // 运行中替换自己 = 事故报告里明确禁止的操作。这里只告诉用户「怎么做才对」。
      return {
        ok: false,
        code: "NEEDS_OFFLINE_APPLY",
        message: "为了不重演「运行中替换插件目录」的事故，面板不会在线应用更新。请先退出 DSH，再在终端运行下面的命令（staged 包仍保留，不会丢）：",
        detail: {
          applyCommand: `node "${applyScriptPath}" --data-dir "${dataDir}" --install-dir "${updateInstallDir}" --yes`,
          applyScript: applyScriptPath,
          applyMode: "offline-script",
        },
      };
    }
    try {
      const result = await updater.apply();
      updateState.lastAction = { action: "apply", at: new Date().toISOString(), result };
      if (result && result.ok === false) return { ok: false, code: result.code || "UPDATE_APPLY_FAILED", message: result.message || "应用更新失败", detail: result };
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, code: err?.code || "UPDATE_APPLY_FAILED", message: err?.message ?? String(err) };
    }
  }

  async function updateRollback() {
    if (!updater) return { ok: false, code: "UPDATE_DISABLED", message: "自动更新已在配置里关闭" };
    try {
      const result = await updater.rollback();
      updateState.lastAction = { action: "rollback", at: new Date().toISOString(), result };
      if (result && result.ok === false) return { ok: false, code: result.code || "UPDATE_ROLLBACK_FAILED", message: result.message || "回滚失败", detail: result };
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, code: err?.code || "UPDATE_ROLLBACK_FAILED", message: err?.message ?? String(err) };
    }
  }

  if (updater && updateCheckOnBoot) {
    // 启动时只检查（以及可选的自动暂存）；**应用**必须由用户显式触发，
    // 且默认要求在 DSH 退出后离线执行（事故报告的核心教训）。
    updateCheck()
      .then(async (r) => {
        if (!updateAutoStage) return;
        if (r && r.ok && r.data && r.data.outdated) {
          const staged = await updateStage();
          if (staged && staged.ok) bootMark("auto-staged");
        }
      })
      .catch(() => {});
  }

  bootMark(`updater-ready:version=${currentVersion},installDir=${updateInstallDir}`);

  /* ------------------------------------------------------------------ */
  /* 名册读取缓存 + 模型覆盖查询                                          */
  /* ------------------------------------------------------------------ */

  // agent/request 每轮都会触发，不能每次都读盘；写入时由 service 回调精确失效。
  let registryMemo = { at: 0, registry: null };
  function invalidateRegistryMemo() {
    registryMemo = { at: 0, registry: null };
  }
  function readRegistryCached(ttlMs = 1000) {
    const now = Date.now();
    if (registryMemo.registry && now - registryMemo.at < ttlMs) return registryMemo.registry;
    try {
      const { registry } = store.load();
      registryMemo = { at: now, registry };
      return registry;
    } catch {
      return registryMemo.registry; // 读失败就沿用上一份，别让请求路径报错
    }
  }

  /**
   * 该 agent 对应的成员名（不在名册里返回 null）。
   * 成员名从团队内核的 membership 拿（`tryMembership(agent)` 需要精确的 live agent）。
   */
  function memberTargetOf(agent) {
    try {
      const teams = ctx.get("agentTeams");
      if (!teams || typeof teams.tryMembership !== "function") return null;
      const membership = teams.tryMembership(agent);
      return (membership && membership.name) || null;
    } catch {
      return null;
    }
  }

  /**
   * 该 agent 对应的成员是否配置了模型覆盖。
   */
  function modelOverrideFor(agent) {
    try {
      const target = memberTargetOf(agent);
      if (!target) return null;
      const registry = readRegistryCached();
      if (!registry || !Array.isArray(registry.members)) return null;
      const m = registry.members.find((x) => x.target === target);
      if (!m || m.status !== "active" || !m.model) return null;
      // 注意：这里**不做**根会话身份判定。那条判定要遍历 live agents 与团队名册，
      // 而本函数会出现在 `system-prompt/assemble` 这类每步都跑的水位里。
      // 根 agent 的排除放在更便宜的地方：装钩子时算一次（isDelegatedAgent），
      // 以及 member_set_model / 面板写入时对 target 判一次（rootIdentityReason）。
      return { target, model: m.model, provider: m.provider || undefined };
    } catch {
      return null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* agent 生命周期：刷新成员缓存 + 为每个 agent 安装模型覆盖            */
  /* ------------------------------------------------------------------ */

  /**
   * 官方事件的载荷形状是 `{ agent }`（见 dsh-experimental-tool-agent-team
   * `lib\index.js:543-544`：`ctx.on("agent/created", ({ agent }) => ...)`）。
   * 早期实现直接把载荷当 agent 用，导致事件路径**从未**成功刷新过缓存 —— 这里容错两种形状。
   */
  function agentFromPayload(payload) {
    if (!payload || typeof payload !== "object") return undefined;
    // 官方形状：{ agent }
    if (payload.agent && typeof payload.agent === "object") return payload.agent;
    // 兼容直接传 agent 的写法（不同版本/不同事件可能如此）
    if (typeof payload.id === "string") return payload;
    return undefined;
  }

  // 已安装模型覆盖的 agent **实例**（WeakSet 按对象去重）。
  // 不能按 agent.id 去重：可续接成员在后续轮次会换一个 agent 实例，
  // 按 id 去重会让钩子只挂在首轮实例上，之后静默回落到默认模型。
  const modelOverrideInstalled = new WeakSet();
  const modelOverrideInstalledIds = new Set();
  let modelOverrideInstalledCount = 0;

  /**
   * 模型覆盖的可观测性。
   *
   * 这个功能平时是「隐形」的：设了模型之后，除非盯着会话记录，没人知道覆写到底有没有发生。
   * 实测发现 DSH 的会话投影**不记录**每轮请求的 config，所以外部分析拿不到证据 ——
   * 于是插件自己记录：装了多少个监听、覆写成功多少次、有没有触发但查不到覆盖的情况。
   * 通过 `GET /overrides` 或 `member_diagnose` 可读。
   */
  const overrideStats = {
    applied: 0, // 成功应用覆盖的次数（model-select 落 selection 或 legacy 改写返回值）
    misses: 0, // 监听触发、但该成员没有覆盖（正常情况，只说明监听在工作）
    lastApplied: null, // { agentId, target, model, provider?, via, at }
    path: null, // 当前生效的能力：model-select（0.2.2+）| legacy-hook（0.2.1-）| null
    cleared: 0, // 清除覆盖后回到默认路由的次数
    unchanged: 0, // selection 已等于目标值、因此跳过的次数（幂等命中）
    skippedRoot: 0, // 根 agent（顶层会话）被跳过、不自动覆盖的次数
    errors: 0, // select / 改写抛错的次数
    lastError: null, // { agentId, target, message, at }
    // 审计环（最近 50 条）：F5 要求每条能重建 before/after，
    // 否则事故复盘只能靠会话记录猜「到底改了什么」。
    history: [],
  };
  const OVERRIDE_HISTORY_LIMIT = 50;

  /** 宿主是否提供 0.2.2 的 model-selection 能力（`agent.model.select`）。 */
  function modelSelectOf(agent) {
    const model = agent && agent.model;
    return model && typeof model.select === "function" ? model : null;
  }

  /**
   * 我们实际给它落过 selection 的 agent —— 清除覆盖时只回滚这些，别碰用户手选的。
   *
   * **按 `agent.ctx` 记账，不按 agent 包装对象**：同一个 ctx 在 `agent/created`、
   * `agent/status`、`ctx.agents.list()` 三条路径上可能被不同的包装对象送出，
   * 按对象记账会让「清除覆盖」找不到之前那次应用，于是回滚被静默跳过。
   */
  const appliedSelectionsByCtx = new WeakMap();
  /** ctx 拿不到时的兜底：按 agent.id 记账，并限制条数避免长跑泄漏。 */
  const appliedSelectionsById = new Map();
  const APPLIED_ID_LIMIT = 200;

  function selectionKeyOf(agent) {
    const ctx = agent && agent.ctx;
    if (ctx && typeof ctx === "object") return { byId: false, key: ctx };
    const id = agent && agent.id;
    if (typeof id !== "string") return null;
    return { byId: true, key: id };
  }

  function hasAppliedSelection(agent) {
    const k = selectionKeyOf(agent);
    if (!k) return false;
    return k.byId ? appliedSelectionsById.has(k.key) : appliedSelectionsByCtx.has(k.key);
  }

  function rememberAppliedSelection(agent, selection) {
    const k = selectionKeyOf(agent);
    if (!k) return;
    if (k.byId) {
      appliedSelectionsById.set(k.key, selection);
      while (appliedSelectionsById.size > APPLIED_ID_LIMIT) {
        const oldest = appliedSelectionsById.keys().next().value;
        appliedSelectionsById.delete(oldest);
      }
      return;
    }
    appliedSelectionsByCtx.set(k.key, selection);
  }

  function readAppliedSelection(agent) {
    const k = selectionKeyOf(agent);
    if (!k) return null;
    return (k.byId ? appliedSelectionsById.get(k.key) : appliedSelectionsByCtx.get(k.key)) || null;
  }

  function forgetAppliedSelection(agent) {
    const k = selectionKeyOf(agent);
    if (!k) return;
    if (k.byId) appliedSelectionsById.delete(k.key);
    else appliedSelectionsByCtx.delete(k.key);
  }

  /** route + effort 完全相等（effort 缺省当作一个值比较）。 */
  function sameSelection(left, right) {
    return Boolean(
      left &&
        right &&
        left.provider === right.provider &&
        left.model === right.model &&
        (left.reasoningEffort ?? undefined) === (right.reasoningEffort ?? undefined),
    );
  }

  /**
   * 该 target 是否是「用户直接对话的那个会话身份」（根 agent 对应的成员）。
   *
   * 这类成员**不参与模型覆盖**（0.5.3 起的硬规则，0.*.* 都不打算引入）：
   * 模型由用户在会话框里自己选，插件不该有「覆盖」这个概念。
   * 判定有两条，任一成立即算：
   *   1. 活着的 agent 里，同名且是顶层会话（没有 delegationDepth / origin）；
   *   2. 团队内核里该成员的角色是 `lead`。
   */
  function isRootIdentity(target) {
    return rootIdentityReason(target) !== null;
  }

  /** 同 isRootIdentity，但返回判定依据（用于给人看的报错文案）。 */
  function rootIdentityReason(target) {
    if (!target) return null;
    // 1) 活着的 agent 里找同名的那一个：它是顶层会话就是根身份；
    //    若它是子 agent，再看团队角色是不是 lead。
    //    注意：这里逐 agent 调 tryMembership(agent) 取名字与角色，**不调 listMembers** ——
    //    那个 API 要求传一个精确的 live Agent 做授权凭证，会话未打开 / 已归档 / 刚重启时
    //    根本没有可传的对象，缺参会抛错并被 catch 吞掉，判定就静默失效（fail-open）。
    try {
      const agents = ctx.get("agents");
      const list = agents && typeof agents.list === "function" ? agents.list() || [] : [];
      const teams = ctx.get("agentTeams");
      for (const agent of list) {
        let membership = null;
        try {
          if (teams && typeof teams.tryMembership === "function") membership = teams.tryMembership(agent);
        } catch {
          membership = null;
        }
        if (!membership || membership.name !== target) continue;
        if (!isDelegatedAgent(agent)) return "顶层会话";
        if (membership.role === "lead") return "团队角色 lead";
      }
    } catch {
      /* 查询失败就落到下一条 */
    }
    // 2) 命名约定兜底：DSH 的根成员名固定是 lead。
    //    没有 live agent 时（重启后、会话未打开）也必须判得出来，
    //    否则会给用户写进一个永远不生效的覆盖值 —— 那是假成功。
    if (target === "lead") return "默认根成员名 lead";
    return null;
  }

  /**
   * 是否是「派出去干活的子 agent」。
   *
   * 名册成员分两类：
   * - **子 agent**（`delegationDepth > 0` / `origin === "subagent"`）：由派工创建，
   *   没有输入框，名册里的模型就是它唯一的模型来源 —— 覆盖在这里才是有意义的。
   * - **根 agent**（顶层会话，`delegationDepth` 缺省即 0）：用户在会话框里随时能自己选模型，
   *   插件再去自动覆盖，等于把手选改回去。
   *
   * 读不到会话头时按「根 agent」处理：宁可不动，也不误改用户正在用的会话。
   */
  function isDelegatedAgent(agent) {
    try {
      const header = agent && agent.session && agent.session.header;
      if (header && header.origin === "subagent") return true;
      // 对齐官方 delegationDepthOf：Math.max(header.delegationDepth ?? 0, options.subagentDepth ?? 0)。
      // 持久化 header 是单调下限，运行期 options 只能加深，不能把子 agent 降级成顶层。
      const headerDepth = header && typeof header.delegationDepth === "number" ? header.delegationDepth : 0;
      const options = agent && agent.options;
      const runtimeDepth = options && typeof options.subagentDepth === "number" ? options.subagentDepth : 0;
      return Math.max(headerDepth, runtimeDepth) > 0;
    } catch {
      return false;
    }
  }

  /**
   * 把名册里的覆盖落到 `agent.model` 上 —— 0.2.2+ 的唯一正确入口。
   *
   * 为什么不能在 `agent/request` 里改：0.2.2 的 agent-loop 在 pre-step 就把 selection
   * 固定了，随后用 waterfall 拿到 proposedConfig 后逐字段比对，不一致直接抛错
   * （`dsh-agent-loop/lib/index.js:1000`）。所以覆盖必须**提前**写进 session 投影。
   *
   * @param options.force 显式操作（名册刚改）时强制重落；生命周期事件不强制，
   *   以免把用户在输入框里手选的模型改回去。
   */
  function applyModelSelection(agent, reason = "lifecycle", options = {}) {
    const model = modelSelectOf(agent);
    if (!model) return "unsupported";
    // 只对名册成员动模型：非成员（含临时子代理）不碰，否则会把用户手选的模型拉回默认。
    const target = memberTargetOf(agent);
    if (!target) return "not-member";
    const ov = modelOverrideFor(agent);
    // 生命周期事件不强制：已经给这个 agent 落过就不重落，
    // 用户随后在输入框里手选的模型才不会被下一轮改回去。
    if (!options.force && hasAppliedSelection(agent)) {
      overrideStats.unchanged += 1;
      return "already-applied";
    }
    // 根 agent（顶层会话）不自动覆盖：模型在会话框里由用户自己选。
    if (!options.force && !isDelegatedAgent(agent)) {
      overrideStats.skippedRoot += 1;
      return "root-agent";
    }
    // 默认路由取 agent 的公开 options，没有时退回 model 实例上的同名字段。
    const fallback = (agent && agent.options) || model.options;
    try {
      const current = typeof model.current === "function" ? model.current() : undefined;

      if (!ov) {
        // 清除覆盖：只有「当前 selection 仍是我们当时设的那个值」才回滚。
        // 用户在插件之后手选过模型的，只忘掉所有权、不动他的选择（手选优先）。
        const recorded = readAppliedSelection(agent);
        if (!recorded) {
          overrideStats.misses += 1;
          return "no-override";
        }
        if (!sameSelection(current, recorded)) {
          forgetAppliedSelection(agent);
          overrideStats.unchanged += 1;
          bootMark(`model-override-kept-user-choice:${agent.id}`);
          return "kept-user-choice";
        }
        if (!fallback || !fallback.provider || !fallback.model) {
          overrideStats.misses += 1;
          return "no-default";
        }
        const backTo = {
          provider: fallback.provider,
          model: fallback.model,
          ...(fallback.reasoningEffort === undefined ? {} : { reasoningEffort: fallback.reasoningEffort }),
        };
        if (sameSelection(current, backTo)) {
          forgetAppliedSelection(agent);
          return "unchanged";
        }
        model.select(backTo);
        // 只有 select 成功后才放弃所有权：抛错时还能重试。
        forgetAppliedSelection(agent);
        overrideStats.cleared += 1;
        bootMark(`model-override-cleared:${agent.id}`);
        return "cleared";
      }

      const provider = ov.provider || (fallback && fallback.provider);
      if (!provider) {
        overrideStats.errors += 1;
        overrideStats.lastError = {
          agentId: agent.id,
          target: ov.target,
          message: "名册只给了 model，宿主也没有可继承的 provider",
          at: new Date().toISOString(),
        };
        return "no-provider";
      }
      // 名册没写 effort 时沿用当前 effort（0.2.1 的 legacy 路径同样保留，不悄悄降级）。
      const effort = ov.reasoningEffort === undefined ? current && current.reasoningEffort : ov.reasoningEffort;
      const selection = { provider, model: ov.model };
      if (effort !== undefined) selection.reasoningEffort = effort;

      // 幂等：selection 已经等于目标值就什么都不做。
      if (sameSelection(current, selection)) {
        // 仍要记账：selection 可能就是上一次会话/插件重载前落下的，
        // 不记账会让之后的「清除覆盖」找不到归属、durable selection 永远留着。
        rememberAppliedSelection(agent, selection);
        overrideStats.path = "model-select";
        overrideStats.unchanged += 1;
        return "unchanged";
      }

      model.select(selection);
      rememberAppliedSelection(agent, selection);
      overrideStats.applied += 1;
      overrideStats.path = "model-select";
      overrideStats.lastApplied = {
        agentId: agent.id,
        target: ov.target,
        model: selection.model,
        provider,
        ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
        via: "model-select",
        reason,
        at: new Date().toISOString(),
      };
      bootMark(`model-override-applied:${ov.target}=${ov.model}@model-select`);
      try {
        overrideStats.history.push({
          at: new Date().toISOString(),
          agentInstanceId: agent.id,
          target: ov.target,
          source: "roster",
          via: "model-select",
          before: current
            ? {
                provider: current.provider,
                model: current.model,
                ...(current.reasoningEffort === undefined ? {} : { reasoningEffort: current.reasoningEffort }),
              }
            : null,
          after: {
            provider,
            model: selection.model,
            ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
          },
          result: "applied",
          code: null,
        });
        if (overrideStats.history.length > OVERRIDE_HISTORY_LIMIT) overrideStats.history.shift();
      } catch {
        /* 审计失败不影响请求 */
      }
      return "selected";
    } catch (err) {
      overrideStats.errors += 1;
      overrideStats.lastError = {
        agentId: agent && agent.id,
        target: ov && ov.target,
        message: String(err && err.message ? err.message : err).slice(0, 500),
        at: new Date().toISOString(),
      };
      bootMark(`model-select-error:${String(err && err.message ? err.message : err).slice(0, 300)}`);
      return "error";
    }
  }

  /**
   * 对某个 target 名下所有 live agent 落一次 selection。
   * tool 与面板共用这一条路径 —— 面板只写名册不落 selection 的话，
   * 运行中的子 agent 会继续用旧模型，而提示词已经被改成新模型（两者不一致）。
   */
  function applySelectionToLive(target, reason, options = {}) {
    const results = [];
    try {
      const agents = ctx.get("agents");
      const list = agents && typeof agents.list === "function" ? agents.list() || [] : [];
      for (const agent of list) {
        if (memberTargetOf(agent) !== target) continue;
        results.push(applyModelSelection(agent, reason, options));
      }
    } catch {
      /* 查询失败就当没有 live agent */
    }
    return results;
  }

  /**
   * 给一个 agent 安装 **模型覆盖**。
   *
   * 宿主有两套模型选择机制，按能力分流：
   *
   * - **0.2.2 起**：`agent.model.select()` 在 step preparation 之前把 selection 写进
   *   session 投影；`agent/request` 的返回值必须与固定值逐字段一致，不一致会直接抛错
   *   （`dsh-agent-loop/lib/index.js:1000`：use agent.model.select() before step preparation）。
   *   所以这条路径只提前落 selection，**绝不挂改写型 `agent/request`**。
   * - **0.2.1 及更早**：宿主没有 `agent.model`，沿用 `agent/request` 返回覆写
   *   （官方 `dsh-agent/lib/types/model-selection.js` 当年也是这么做的）。
   *
   * 两条路径都保留 `system-prompt/assemble`：它只改提示词里的 provider/model 变量，
   * 不参与请求路由校验。
   */
  function installModelOverride(agent, installOptions = {}) {
    const applySelection = installOptions.apply !== false;
    try {
      if (!agent || typeof agent.id !== "string") return;
      const scoped = agent.ctx;
      if (!scoped || typeof scoped.on !== "function") return;
      if (modelOverrideInstalled.has(scoped)) {
        // 同一个 ctx 再次报到（agent/status 每轮都会）：钩子已装好，不重落 selection，
        // 否则用户刚在输入框里选的模型会被下一轮改回去。
        return;
      }
      modelOverrideInstalled.add(scoped);
      modelOverrideInstalledIds.add(agent.id);
      modelOverrideInstalledCount += 1;

      // 根 agent（顶层会话）不参与覆盖：连提示词变量也不改写。
      // 这里只算一次 —— agent 的派工层级在生命周期内不变，
      // 放进每步都会跑的钩子里会白读一遍会话头。
      const delegated = isDelegatedAgent(agent);

      // 让系统提示里的 provider/model 变量也跟着变（官方同样这么做）。
      // 只对子 agent 装：根 agent 的提示词不该声称它在用名册里的模型。
      if (delegated) {
        try {
          scoped.on("system-prompt/assemble", async (_assembly, _context, next) => {
            const assembled = await next();
            const ov = modelOverrideFor(agent);
            if (!ov) return assembled;
            return {
              ...assembled,
              variables: {
                ...assembled.variables,
                ...(ov.provider ? { provider: ov.provider } : {}),
                model: ov.model,
              },
            };
          });
        } catch {
          /* 该钩子不可用时只影响提示文案，不影响实际模型 */
        }
      }

      const model = modelSelectOf(agent);
      if (model) {
        // 0.2.2+：提前落 selection；不挂 agent/request，避免触发路由校验抛错。
        overrideStats.path = "model-select";
        if (applySelection) applyModelSelection(agent, "install");
      } else if (!delegated) {
        // 根 agent 不装旧改写钩子：每轮请求都拦一次只为了跳过的代价没必要付。
        overrideStats.skippedRoot += 1;
      } else {
        // 0.2.1 及更早：只能靠改写请求配置。
        overrideStats.path = overrideStats.path || "legacy-hook";
        scoped.on("agent/request", async (_payload, next) => {
          const resolved = await next();
          // 与 0.2.2 路径同一条规则：根 agent（顶层会话）的模型由用户在会话框里定。
          if (!isDelegatedAgent(agent)) {
            overrideStats.skippedRoot += 1;
            return resolved;
          }
          const ov = modelOverrideFor(agent);
          if (!ov) {
            overrideStats.misses += 1;
            return resolved;
          }
          overrideStats.applied += 1;
          overrideStats.lastApplied = {
            agentId: agent.id,
            target: ov.target,
            model: ov.model,
            ...(ov.provider ? { provider: ov.provider } : {}),
            via: "legacy-hook",
            at: new Date().toISOString(),
          };
          bootMark(`model-override-applied:${ov.target}=${ov.model}@legacy-hook`);
          // 不再无条件删除 reasoningEffort：dsh-llm 会在任何网络 I/O 之前，用该档位
          // 针对「具体模型」校验，所以正确做法是让目标模型自己声明思考档位
          // （cordis.patch.yml 里每个 ollama 模型都写了 reasoningEfforts）。
          // 无条件删除会把云端模型的思考强度也一起丢掉，属于静默劣化。
          // 若目标模型没声明档位，请求会以 UNSUPPORTED_REASONING_EFFORT 显式失败——
          // 这是有意的：宁可报错，也不要悄悄降级。
          const overridden = { ...resolved };
          if (ov.provider) overridden.provider = ov.provider;
          overridden.model = ov.model;
          // F5：每次改写都留一条可重建的审计记录（before/after + 目标 + 实例 id）
          try {
            overrideStats.history.push({
              at: new Date().toISOString(),
              agentInstanceId: agent.id,
              target: ov.target,
              source: "roster",
              via: "legacy-hook",
              before: {
                provider: resolved.provider,
                model: resolved.model,
                ...(resolved.reasoningEffort === undefined ? {} : { reasoningEffort: resolved.reasoningEffort }),
              },
              after: {
                provider: overridden.provider,
                model: overridden.model,
                ...(overridden.reasoningEffort === undefined ? {} : { reasoningEffort: overridden.reasoningEffort }),
              },
              result: "applied",
              code: null,
            });
            if (overrideStats.history.length > OVERRIDE_HISTORY_LIMIT) overrideStats.history.shift();
          } catch {
            /* 审计失败不影响请求 */
          }
          return overridden;
        });
      }

      // 诊断：记录 LLM 请求/agent 级错误，便于定位「请求在发出前失败」这类问题。
      for (const errorEvent of ["agent/request-error", "agent/error"]) {
        try {
          scoped.on(errorEvent, (payload) => {
            try {
              const raw = payload?.error ?? payload?.failure ?? payload;
              const code = raw?.code ? `${raw.code} ` : "";
              const message = raw?.message ?? (typeof raw === "string" ? raw : JSON.stringify(raw));
              bootMark(`${errorEvent}:${code}${String(message).slice(0, 600)}`);
            } catch {
              /* 记录失败不影响主流程 */
            }
          });
        } catch {
          /* 事件不存在时静默跳过 */
        }
      }
      bootMark(`model-override-installed:${agent.id}@${model ? "model-select" : "legacy-hook"}`);
    } catch (err) {
      warn(`为 agent ${agent && agent.id} 安装模型覆盖失败：${err?.message ?? err}`);
    }
  }

  /**
   * agent 生命周期。
   *
   * 只有 **agent 刚创建** 时才落模型覆盖 —— 那一刻用户还没在输入框里选过模型。
   * `agent/status` 每轮都触发，若也在那里落覆盖，用户手选的模型会被下一轮改回去。
   * 名册变更（`member_set_model`）走的是显式强制路径，不受此限。
   */
  function handleAgentLifecycle(payload, options) {
    const agent = agentFromPayload(payload);
    if (!agent) return;
    refreshFromAgent(agent);
    // 两条事件都要「确保钩子已装」：续接成员会换 agent 实例，新实例的 ctx 没装过钩子。
    // 区别只在是否顺手落 selection —— 落 selection 只发生在创建时与显式写名册时。
    installModelOverride(agent, { apply: !options || options.applyModel !== false });
    if (tracker) {
      try {
        tracker.observeAgent(agent, targetForAgent(agent));
      } catch (err) {
        warn(`登记工作流 agent 失败：${err?.message ?? err}`);
      }
    }
  }

  try {
    ctx.on("agent/created", (payload) => handleAgentLifecycle(payload, { applyModel: true }));
  } catch {
    /* 事件不存在时静默跳过 */
  }
  // 状态流转只刷新缓存与工作流，不碰模型选择：输入框里的手选优先。
  try {
    ctx.on("agent/status", (payload) => handleAgentLifecycle(payload, { applyModel: false }));
  } catch {
    /* 事件不存在时静默跳过 */
  }

  // 覆盖插件加载前就已存在的 agent（官方工具包同样先跑一遍 list()）
  try {
    const agents = ctx.get("agents");
    if (agents && typeof agents.list === "function") {
      for (const agent of agents.list()) {
        refreshFromAgent(agent);
        installModelOverride(agent);
        if (tracker) {
          try {
            tracker.observeAgent(agent, targetForAgent(agent));
          } catch {
            /* 登记失败只影响面板，不影响插件 */
          }
        }
      }
      bootMark(`agents-preinstalled:${modelOverrideInstalledCount}`);
    }
  } catch (err) {
    warn(`遍历已存在的 agent 失败：${err?.message ?? err}`);
  }

  /* ------------------------------------------------------------------ */
  /* 结果封装                                                            */
  /* ------------------------------------------------------------------ */

  function toContent(value) {
    return [{ type: "text", text: JSON.stringify(value, null, 2) }];
  }

  const jsonOutput = (schema) => ({ schema, render: (_args, value) => toContent(value) });

  /** 统一的「操作结果」信封，tool 与 HTTP 共用 */
  /** 把「扁平结果」（{ok,...payload}，如备份/更新）包成 {ok,data}，与 service 结果统一。 */
  function envelopeRaw(result, extra) {
    if (!result) return { ok: false, code: "EMPTY_RESULT", message: "操作没有返回结果", ...extra };
    if (result.ok === false) return { ok: false, code: result.code, message: result.message, detail: result.detail, ...extra };
    return { ok: true, data: result, ...extra };
  }

  function envelope(result, extra) {
    if (!result || result.ok === undefined) return { ok: true, data: result, ...extra };
    if (result.ok) return { ok: true, data: result.data, ...extra };
    return { ok: false, code: result.code, message: result.message, detail: result.detail, ...extra };
  }

  /* ------------------------------------------------------------------ */
  /* 技能目录（来自 ctx.skills 的合并目录）                              */
  /* ------------------------------------------------------------------ */

  /**
   * 读取本机已安装的全部技能。
   *
   * `skills` 服务由 @deepseek-ai/dsh-skill 提供（服务名 "skills"），
   * `list(options)` 返回所有 provider 合并后的、按名称排序的摘要数组，
   * 每项含 name / description / whenToUse? / source / provider / path? / invocation。
   * 注意它**不在**本插件的 inject 列表里，因此用 ctx.get() 安全获取（读不到就降级，不抛错）。
   */
  async function skillCatalog(options = {}) {
    const cwd = typeof options.cwd === "string" && options.cwd.trim() ? options.cwd.trim() : undefined;
    const merged = new Map();
    let registryOk = false;
    let registryError = null;
    let registryCode = "SKILLS_SERVICE_UNAVAILABLE";

    try {
      const skills = ctx.get("skills");
      if (skills && typeof skills.list === "function") {
        // dsh-skill 会把整个 options **原样转发**给每个 provider
        // （`dsh-skill\lib\index.js:350` → `provider.list(options)`），
        // 而本 profile 里 `~/.dsh/skills` 由第三方 provider 提供，它只在拿到
        // cwd / projectCwds 时才扫该层 —— 实测不传时 43 个技能里**没有**
        // `file-processing-master`。projectCwds 是该 provider 的私有键，
        // 多传一个未知键不会有害（provider 自己忽略）。
        const lookup = {};
        if (cwd) {
          lookup.cwd = cwd;
          lookup.projectCwds = [cwd];
        }
        const raw = await skills.list(lookup);
        for (const s of Array.isArray(raw) ? raw : []) {
          if (!s || typeof s.name !== "string" || !s.name) continue;
          // ⚠️ 绝不把值为 undefined 的键放进结果：DSH 会校验工具输出能否**无损**
          // JSON 往返，而 JSON.stringify 会丢掉 undefined 键 → 往返后不相等 →
          // 报 "value is not lossless JSON"。所以只在有值时挂上可选键。
          const item = {
            name: s.name,
            description: typeof s.description === "string" ? s.description : "",
            modelInvocable: s?.invocation?.modelInvocable !== false,
            userInvocable: s?.invocation?.userInvocable === true,
          };
          for (const [key, value] of [
            ["whenToUse", s.whenToUse],
            ["source", s.source],
            ["provider", s.provider],
            ["path", s.path],
          ]) {
            if (typeof value === "string" && value) item[key] = value;
          }
          merged.set(item.name, item);
        }
        registryOk = true;
      } else {
        registryError = "ctx.get('skills') 不可用（dsh-skill 未挂载？）";
      }
    } catch (err) {
      registryError = err?.message ?? String(err);
      registryCode = "SKILLS_LIST_FAILED";
    }

    // 兜底：直接扫盘补齐。用户要的是「本地安装的**所有**技能」，
    // 不能只信注册表 —— 注册表是否扫到某一层取决于 provider 的实现与调用参数。
    // 注册表已有的名字优先，扫盘只补空缺。
    if (scanLocalSkills) {
      for (const root of skillRoots(cwd)) {
        for (const s of scanSkillDir(root)) {
          if (merged.has(s.name)) continue;
          merged.set(s.name, { ...s, modelInvocable: true, userInvocable: false });
        }
      }
    }

    const items = [...merged.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    if (!registryOk && items.length === 0) {
      return {
        ok: false,
        code: registryCode,
        message: registryError || "技能服务不可用",
        items: [],
      };
    }
    return { ok: true, items, ...(registryOk ? {} : { warning: registryError }) };
  }

  /* ------------------------------------------------------------------ */
  /* 本地技能扫盘（注册表的兜底）                                        */
  /* ------------------------------------------------------------------ */

  /** 要扫描的技能根目录（DSH_HOME/skills、用户 agents、项目级） */
  function skillRoots(cwd) {
    const roots = [...extraSkillRoots];
    const dshHome = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
    roots.push(path.join(dshHome, "skills"));
    roots.push(path.join(os.homedir(), ".agents", "skills"));
    if (typeof cwd === "string" && cwd.trim()) {
      roots.push(path.join(cwd, ".dsh", "skills"));
      roots.push(path.join(cwd, ".agents", "skills"));
    }
    return roots;
  }

  /**
   * 从 SKILL.md 的 YAML frontmatter 取 name / description。
   * 只认这两个字段 —— 足够填充下拉菜单，且不必为一个字段引入 YAML 依赖。
   */
  function parseFrontmatter(text) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (!m) return {};
    const out = {};
    for (const rawLine of m[1].split(/\r?\n/)) {
      const kv = /^(name|description)\s*:\s*(.*)$/.exec(rawLine.trim());
      if (!kv) continue;
      let v = kv[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      v = v.replace(/\\"/g, '"').replace(/\\n/g, " ");
      if (v) out[kv[1]] = v;
    }
    return out;
  }

  /** 扫一个根目录：`<name>/SKILL.md` 或平铺 `<name>.md`（与 dsh-skill-filesystem 的公开约定一致） */
  function scanSkillDir(root) {
    const found = [];
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      return found; // 根目录不存在是正常情况
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      try {
        let file = null;
        let fallbackName = e.name;
        if (e.isDirectory()) {
          file = path.join(root, e.name, "SKILL.md");
          if (!fs.existsSync(file)) continue;
        } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
          file = path.join(root, e.name);
          fallbackName = e.name.replace(/\.md$/i, "");
        } else {
          continue;
        }
        const fm = parseFrontmatter(fs.readFileSync(file, "utf8"));
        if (!e.isDirectory() && !fm.name && !fm.description) continue; // 平铺文件里不是技能
        found.push({
          name: fm.name || fallbackName,
          description: fm.description || "",
          path: file,
          source: "local",
          provider: "local-scan",
        });
      } catch {
        /* 单个条目读失败就跳过，不影响其它 */
      }
    }
    return found;
  }


  /* ------------------------------------------------------------------ */
  /* 模型目录（来自 ctx.llm 的 provider / model 广告）                    */
  /* ------------------------------------------------------------------ */

  /**
   * 列出本机可用的 provider 与其模型目录。
   *
   * `ctx.llm.listProviders()` → `LlmProviderInfo[]`（注册顺序）
   * `ctx.llm.listModels(provider)` → `LlmModelInfo[]`，形状由 dsh-llm
   * `lib\types\index.js:487-493` 决定：`{ id, name?, contextWindow?, maxTokens?, inputModalities? }`。
   *
   * README 明确：目录成员资格**不**约束核心路由（未列出的 id 仍可调用），
   * 但"目录驱动的入口"会把选择限制在广告出来的模型内 —— 面板下拉就用这个目录。
   */
  async function modelCatalog(providerFilter) {
    try {
      const llm = ctx.get("llm");
      if (!llm || typeof llm.listProviders !== "function") {
        return { ok: false, code: "LLM_SERVICE_UNAVAILABLE", message: "ctx.get('llm') 不可用", providers: [] };
      }
      const providers = [];
      for (const p of llm.listProviders() || []) {
        const id = p && p.id;
        if (typeof id !== "string" || !id) continue;
        if (providerFilter && id !== providerFilter) continue;
        const entry = { id, models: [] };
        if (typeof p.displayName === "string" && p.displayName) entry.displayName = p.displayName;
        if (typeof llm.listModels === "function") {
          try {
            for (const m of (await llm.listModels(id)) || []) {
              if (!m || typeof m.id !== "string" || !m.id) continue;
              const item = { id: m.id };
              if (typeof m.name === "string" && m.name) item.name = m.name;
              if (Number.isInteger(m.contextWindow) && m.contextWindow > 0) item.contextWindow = m.contextWindow;
              if (Number.isInteger(m.maxTokens) && m.maxTokens > 0) item.maxTokens = m.maxTokens;
              entry.models.push(item);
            }
          } catch (err) {
            // 单个 provider 拉目录失败不影响其它 provider
            entry.error = err?.message ?? String(err);
          }
        }
        providers.push(entry);
      }
      return { ok: true, providers };
    } catch (err) {
      return { ok: false, code: "LLM_LIST_FAILED", message: err?.message ?? String(err), providers: [] };
    }
  }

  /* ------------------------------------------------------------------ */
  /* 工具注册                                                            */
  /* ------------------------------------------------------------------ */

  // 逐个注册工具。任何一个工具被宿主拒绝都**不允许**中断 apply ——
  // 否则 Web 面板路由（在 apply 末尾注册）会一起消失，排查时极难定位。
  const toolState = { registered: [], failed: [] };
  function register(tool) {
    try {
      if (!ctx.tools || typeof ctx.tools.register !== "function") {
        toolState.failed.push(`${tool.name}: ctx.tools.register 不可用`);
        bootMark(`tool-failed:${tool.name}:no-tools-service`);
        return;
      }
      ctx.effect(() => ctx.tools.register(tool), `${name}: ${tool.name}`);
      toolState.registered.push(tool.name);
      bootMark(`tool-ok:${tool.name}`);
    } catch (err) {
      const detail = err?.message ?? String(err);
      toolState.failed.push(`${tool.name}: ${detail}`);
      bootMark(`tool-failed:${tool.name}:${detail}`);
      warn(`工具 ${tool.name} 注册失败：${detail}`);
    }
  }

  register({
    name: "member_list",
    description:
      "查看本地成员名册的组织架构（小组 → 成员），含中文显示名、DSH target、岗位职责、技能与启用状态；同时标注每位成员对应的公司员工（公司↔名册关联）。注意：DSH 原生 team 成员名不可改、不可删，本名册是独立覆盖层。",
    parameters: {
      type: "object",
      properties: {
        includeRetired: { type: "boolean", description: "是否包含已停用成员，默认 false" },
        group: { type: "string", description: "只看某个小组（按小组名或 id）" },
      },
      additionalProperties: false,
    },
    output: jsonOutput({ type: "object" }),
    async execute(args, exec) {
      if (exec?.agent) refreshFromAgent(exec.agent);
      const view = service.view();
      let groups = view.groups;
      if (args?.group) {
        groups = groups.filter((g) => g.id === args.group || g.name === args.group);
      }
      const strip = (list) => (args?.includeRetired ? list : list.filter((m) => !m.isRetired));
      // v0.3.2：把公司员工关联挂在每个名册成员上（公司不可用 → company: null）
      const index = companyRosterIndex();
      const decorate = (m) => ({ ...m, company: companyLinkForMember(m.target, index) });
      const decoratedGroups = groups.map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        members: strip(g.members).map(decorate),
      }));
      const ungrouped = strip(view.ungrouped).map(decorate);
      let linked = 0;
      for (const m of [...decoratedGroups.flatMap((g) => g.members), ...ungrouped]) {
        if (m.company) linked += 1;
      }
      return {
        coreAvailable: view.coreAvailable,
        stats: view.stats,
        groups: decoratedGroups,
        ungrouped,
        unregistered: view.unregistered,
        warnings: view.warnings,
        company: {
          enabled: Boolean(company),
          rosterAvailable: Boolean(index),
          employees: index ? index.size : 0,
          linked,
          unlinked: index ? Math.max(0, index.size - linked) : 0,
        },
        text: service.text(),
      };
    },
  });

  register({
    name: "member_add",
    description:
      "把一名成员登记进本地名册（可同时设中文显示名、所属小组、岗位）。若 DSH 核心已存在同名成员，target 必须与其一致。此操作只写本地名册，不影响 DSH 团队。",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", description: "DSH 成员名（小写 kebab-case），同时是名册主键" },
        displayName: { type: "string", description: "中文显示名，缺省时用 target" },
        groupId: { type: "string", description: "所属小组 id，可省略" },
        title: { type: "string", description: "岗位名称" },
        duties: { type: "array", items: { type: "string" }, description: "岗位职责条目" },
        skills: { type: "array", items: { type: "string" }, description: "技能列表" },
      },
      required: ["target"],
      additionalProperties: false,
    },
    output: jsonOutput({ type: "object" }),
    async execute(args, exec) {
      if (exec?.agent) refreshFromAgent(exec.agent);
      return envelope(service.addMember(args || {}));
    },
  });

  register({
    name: "member_rename",
    description:
      "给成员设置中文显示名或别名（只改本地名册）。DSH 原生成员名不可修改，因此 target 保持不变。",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", description: "成员 target" },
        displayName: { type: "string", description: "新的中文显示名" },
        aliases: { type: "array", items: { type: "string" }, description: "别名列表" },
      },
      required: ["target"],
      additionalProperties: false,
    },
    output: jsonOutput({ type: "object" }),
    async execute(args) {
      const { target, ...patch } = args || {};
      return envelope(service.renameMember(target, patch));
    },
  });

  register({
    name: "member_remove",
    description:
      "停用（软删除）成员或恢复成员。DSH 核心没有删除成员的能力，本操作只在本地名册上标记停用，成员记录与其历史保留。",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", description: "成员 target" },
        restore: { type: "boolean", description: "true 表示恢复（取消停用）" },
      },
      required: ["target"],
      additionalProperties: false,
    },
    output: jsonOutput({ type: "object" }),
    async execute(args) {
      const target = args?.target;
      return envelope(args?.restore ? service.restoreMember(target) : service.removeMember(target));
    },
  });

  register({
    name: "member_set_role",
    description: "设置成员的岗位名称与岗位职责条目。",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", description: "成员 target" },
        title: { type: "string", description: "岗位名称" },
        duties: { type: "array", items: { type: "string" }, description: "职责条目，传入即整体覆盖" },
      },
      required: ["target"],
      additionalProperties: false,
    },
    output: jsonOutput({ type: "object" }),
    async execute(args) {
      const { target, ...patch } = args || {};
      return envelope(service.setRole(target, patch));
    },
  });

  register({
    name: "group_manage",
    description:
      "管理组织架构中的小组：create 新建、rename 改名/排序、delete 删除（组内成员自动置为未分组，不会删人）、assign 把成员移入某组。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create", "rename", "delete", "assign"], description: "操作类型" },
        id: { type: "string", description: "小组 id（create 时可省略，自动生成）" },
        name: { type: "string", description: "小组名称" },
        order: { type: "number", description: "排序值，小的在前" },
        description: { type: "string", description: "小组说明" },
        target: { type: "string", description: "assign 时的成员 target" },
        groupId: { type: "string", description: "assign 时的小组 id；传空字符串表示移出小组" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    output: jsonOutput({ type: "object" }),
    async execute(args) {
      const a = args || {};
      switch (a.action) {
        case "create":
          return envelope(service.createGroup({ id: a.id, name: a.name, order: a.order, description: a.description }));
        case "rename":
          return envelope(service.renameGroup(a.id, { name: a.name, order: a.order, description: a.description }));
        case "delete":
          return envelope(service.deleteGroup(a.id));
        case "assign":
          return envelope(service.assignGroup(a.target, a.groupId === "" ? null : (a.groupId ?? null)));
        default:
          return { ok: false, code: "INVALID_ACTION", message: `未知 action：${a.action}` };
      }
    },
  });

  register({
    name: "member_sync",
    description:
      "把 DSH 核心当前已有的成员批量登记进本地名册（已登记的跳过）。用于新会话/新成员出现后快速补齐组织架构。",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    output: jsonOutput({ type: "object" }),
    async execute(_args, exec) {
      if (exec?.agent) refreshFromAgent(exec.agent);
      return envelope(service.registerLive());
    },
  });

  register({
    name: "member_diagnose",
    description:
      "诊断成员管理插件的运行状态：名册文件是否可读写、核心团队服务 agentTeams 是否可用、Web 面板路由是否注册成功、缓存与告警。当「面板打不开」或「组织架构里看不到核心成员」时先用它排查。",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    output: jsonOutput({ type: "object" }),
    async execute(_args, exec) {
      if (exec?.agent) refreshFromAgent(exec.agent);

      // 1) 数据目录可写性（用一个探针文件实测，而不是只看目录存在）
      const dir = path.dirname(registryFile);
      let writable = false;
      let writeError = null;
      try {
        fs.mkdirSync(dir, { recursive: true });
        const probe = `${registryFile}.probe`;
        fs.writeFileSync(probe, "ok", "utf8");
        fs.unlinkSync(probe);
        writable = true;
      } catch (err) {
        writeError = err?.code ? `${err.code}: ${err.message}` : String(err?.message ?? err);
      }

      // 2) 名册加载
      const loaded = store.load();
      const view = service.view();

      // 3) 核心团队服务
      let teamsService = null;
      try {
        teamsService = ctx.get("agentTeams") ?? null;
      } catch {
        teamsService = null;
      }

      const checks = [
        { name: "registryDirWritable", ok: writable, detail: writable ? dir : `不可写：${writeError}` },
        {
          // 信息项：名册文件不存在是**正常**的（首次写入时才创建），不作为失败
          name: "registryFileExists",
          ok: true,
          detail: fs.existsSync(registryFile) ? registryFile : `${registryFile}（尚未创建，首次写入时自动生成）`,
        },
        { name: "registryLoads", ok: validateRegistry(loaded.registry).ok, detail: loaded.warnings.length ? loaded.warnings.join("；") : "无告警" },
        {
          name: "coreTeamService",
          ok: teamsService !== null,
          detail: teamsService
            ? `agentTeams 可用；已缓存 ${rosterCache.size} 个会话的成员快照，最后刷新 ${lastRefresh ?? "从未"}`
            : "ctx.get('agentTeams') 返回空 —— 核心成员列表将不可用（工具与面板其余功能仍正常）",
        },
        {
          name: "webPanelsRoutes",
          ok: routeState.registered.length > 0,
          detail: routeState.registered.length
            ? `${routeState.registered.length} 条路由：${routeState.registered.join(", ")}`
            : routeState.webServerSeen
              ? `webServer 已注入但注册失败：${routeState.errors.join("；")}`
              : "webServer 服务未出现 —— Web 面板不可用（工具不受影响）",
        },
      ];

      const failed = checks.filter((c) => !c.ok);
      // v0.3.2：名册 ↔ 公司员工关联状态（公司未启用/读不到 → available:false，其余字段为 0）
      const linkIndex = companyRosterIndex();
      const rosterTargets = new Set([
        ...view.groups.flatMap((g) => g.members.map((m) => m.target)),
        ...view.ungrouped.map((m) => m.target),
      ]);
      const linkedCount = linkIndex ? [...rosterTargets].filter((t) => linkIndex.has(t)).length : 0;
      return {
        ok: failed.length === 0,
        plugin: { name, version: PACKAGE_VERSION, registryFile, dataDir },
        checks,
        failed: failed.map((c) => c.name),
        registry: { members: view.stats.members, groups: view.stats.groups, active: view.stats.active, retired: view.stats.retired },
        // v0.3.2：公司员工与名册的双向关联体检
        rosterLinks: {
          available: Boolean(linkIndex),
          companyEmployees: linkIndex ? linkIndex.size : 0,
          rosterMembers: rosterTargets.size,
          linked: linkedCount,
          unlinkedEmployees: linkIndex ? Math.max(0, linkIndex.size - linkedCount) : 0,
        },
        core: { available: view.coreAvailable, cachedSessions: rosterCache.size, lastRefresh, cacheError },
        // 模型覆盖是否真的在工作：applied 增长即证明覆写发生在真实请求上
        modelOverride: {
          installedInstances: modelOverrideInstalledCount,
          // 契约兼容别名：旧字段名继续输出，避免面板与既有测试静默拿到 undefined
          installedAgents: modelOverrideInstalledCount,
          applied: overrideStats.applied,
          misses: overrideStats.misses,
          path: overrideStats.path,
          cleared: overrideStats.cleared,
          unchanged: overrideStats.unchanged,
          skippedRoot: overrideStats.skippedRoot,
          errors: overrideStats.errors,
          lastError: overrideStats.lastError,
          lastApplied: overrideStats.lastApplied,
          // 审计历史：每条含 before/after，可重建「哪一层改的、改前改后是什么」
          history: overrideStats.history.slice(-20),
        },
        hints: buildHints(checks, view),
      };
    },
  });

  register({
    name: "skill_list",
    description:
      "列出本机已安装的**全部**技能（名称 + 描述 + 来源 + 是否可被模型调用），用于给成员赋予技能前挑选。来自所有技能提供方的合并目录，按名称排序。",
    parameters: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "按名称或描述过滤（不区分大小写的子串匹配）" },
        modelInvocableOnly: { type: "boolean", description: "只要可被模型调用的技能（排除仅用户可调用的），默认 false" },
      },
      additionalProperties: false,
    },
    output: jsonOutput({ type: "object" }),
    async execute(args, exec) {
      // 会话的 cwd 让 provider 能扫到项目级技能根（<cwd>/.dsh/skills 等）
      const cwd = exec?.agent?.session?.header?.cwd;
      const cat = await skillCatalog(typeof cwd === "string" && cwd.trim() ? { cwd: cwd.trim() } : {});
      if (!cat.ok) return cat;
      let items = cat.items;
      const kw = typeof args?.keyword === "string" ? args.keyword.trim().toLowerCase() : "";
      if (kw) {
        items = items.filter(
          (s) => s.name.toLowerCase().includes(kw) || String(s.description || "").toLowerCase().includes(kw),
        );
      }
      if (args?.modelInvocableOnly === true) items = items.filter((s) => s.modelInvocable);
      return { ok: true, total: cat.items.length, returned: items.length, skills: items };
    },
  });

  register({
    name: "member_set_skills",
    description: "给成员赋予或撤销技能。可整体覆盖，也可用 add / remove 增量修改。技能名可先用 skill_list 查询。",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", description: "成员 target" },
        skills: { type: "array", items: { type: "string" }, description: "整体覆盖技能列表（与 add/remove 互斥）" },
        add: { type: "array", items: { type: "string" }, description: "追加技能" },
        remove: { type: "array", items: { type: "string" }, description: "移除技能" },
      },
      required: ["target"],
      additionalProperties: false,
    },
    output: jsonOutput({ type: "object" }),
    async execute(args, exec) {
      const { target, ...patch } = args || {};
      const result = service.setSkills(target, patch);
      if (!result.ok) return result;
      // 非阻断提示：把不在技能目录里的名字标出来（仍允许写入，技能可以是自定义标签）
      try {
        const cat = await skillCatalog();
        if (cat.ok) {
          const known = new Set(cat.items.map((s) => s.name));
          const m = result.data.members.find((x) => x.target === target);
          const unknown = (m?.skills ?? []).filter((s) => !known.has(s));
          if (unknown.length) {
            return { ...result, note: `以下技能不在本机技能目录中（作为自定义标签保留）：${unknown.join(", ")}` };
          }
        }
      } catch {
        /* 提示失败不影响写入结果 */
      }
      return result;
    },
  });

  register({
    name: "model_list",
    description:
      "列出本机可用的 provider 与模型目录（来自 ctx.llm 的广告），用于给成员设置模型前挑选。可用 provider 过滤。注意：目录外的 id 核心仍可调用，但面板下拉只提供目录内的模型。",
    parameters: {
      type: "object",
      properties: { provider: { type: "string", description: "只看某个 provider（例如 deepseek-account）" } },
      additionalProperties: false,
    },
    output: jsonOutput({ type: "object" }),
    async execute(args) {
      const filter = typeof args?.provider === "string" && args.provider.trim() ? args.provider.trim() : undefined;
      return modelCatalog(filter);
    },
  });

  register({
    name: "member_set_model",
    description:
      "给某个成员设置或清除模型覆盖。只对**派出去干活的子 agent**生效：0.2.2 起在 step preparation 之前调用 `agent.model.select()` 落 selection（宿主不再允许在 `agent/request` 里改路由）；0.2.1 及更早走 `agent/request` 返回覆写。**根会话身份（lead，即用户直接对话的那个）不接受覆盖**：它的模型由用户在会话框里自己选，传 model 会被拒绝并返回 ROOT_IDENTITY_NO_OVERRIDE。model 传空字符串即清除覆盖、回到默认路由。",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", description: "成员 target" },
        model: { type: "string", description: "模型 id；传空字符串清除覆盖" },
        provider: { type: "string", description: "可选：provider id（例如 deepseek-account）" },
      },
      required: ["target"],
      additionalProperties: false,
    },
    output: jsonOutput({ type: "object" }),
    async execute(args) {
      const { target, model, provider } = args || {};
      // 根会话身份（lead）不参与模型覆盖：模型在会话框里由用户自己选。
      // 0.*.* 都不引入这个概念，所以这里直接拒绝，而不是「接受但忽略」——
      // 后者会让面板显示一个永远不会生效的值。
      if (model) {
        const rootReason = rootIdentityReason(target);
        if (rootReason) {
          return {
            ok: false,
            code: "ROOT_IDENTITY_NO_OVERRIDE",
            message:
              `「${target}」是用户直接对话的会话身份（${rootReason}），不参与模型覆盖：` +
              "它的模型由用户在会话框里自己选。请改给具体干活的成员设置模型。",
          };
        }
      }
      const result = service.setModel(target, { model, provider });
      if (!result.ok) return result;
      const m = result.data.members.find((x) => x.target === target);
      // 0.2.2+：名册一改就把 selection 落到所有活着的同 target agent 上。
      // 与面板共用 applySelectionToLive，避免两条路径行为分叉。
      const liveResults = applySelectionToLive(target, "set-model", { force: true });
      const selectionApplied = liveResults.length > 0 ? liveResults[liveResults.length - 1] : null;
      // 注意：只挂有值的键，避免 undefined 让工具输出无法无损 JSON 往返
      const member = { target: m.target };
      if (m.model) member.model = m.model;
      if (m.provider) member.provider = m.provider;
      // 文案按实际结果分支：没 live agent、select 抛错、缺 provider 都不能说“已生效”。
      let appliedText;
      if (!m.model) {
        appliedText =
          selectionApplied === "cleared"
            ? "模型覆盖已清除；已回到该成员原有的默认模型"
            : "模型覆盖已清除；该成员当前没有活着的实例，下次启动即按默认模型运行";
      } else if (!selectionApplied) {
        appliedText = "模型覆盖已写入名册；该成员当前没有活着的实例，派工时生效";
      } else if (selectionApplied === "selected" || selectionApplied === "unchanged") {
        appliedText = "模型覆盖已写入；该成员下一次请求即生效";
      } else if (selectionApplied === "no-provider") {
        appliedText = "模型覆盖已写入名册，但没能落 selection：缺少 provider。请同时指定 provider";
      } else if (selectionApplied === "root-agent") {
        appliedText = "模型覆盖已写入名册，但该成员是根会话身份，不会自动套用（模型由会话框手选）";
      } else {
        appliedText = `模型覆盖已写入名册，但落 selection 失败（${selectionApplied}）：该成员下一次请求仍用旧模型`;
      }
      return {
        ...result,
        applied: appliedText,
        ...(selectionApplied ? { selectionApplied } : {}),
        ...(liveResults.length > 1 ? { liveInstances: liveResults.length } : {}),
        member,
      };
    },
  });

  register({
    name: "member_group_from_text",
    description:
      "用一句中文描述创建一个成员小组（给出组名、成员、岗位职责，可选模型与技能）。默认只预览（dryRun），必须显式传 confirm:true 才真正写盘。示例：把插件组扩成 3 人：插件架构负责机制、插件编写负责实现、插件审阅负责复核。",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "一句话描述：组名 + 成员 + 各自职责（可带模型/技能名）" },
        confirm: { type: "boolean", description: "true 才真正创建；缺省只返回预览" },
        groupName: { type: "string", description: "覆盖解析出的组名（可选）" },
        description: { type: "string", description: "小组说明（可选）" },
      },
      required: ["text"],
      additionalProperties: false,
    },
    output: jsonOutput({ type: "object" }),
    async execute(args) {
      return envelope(createGroupFromText(args || {}));
    },
  });

  register({
    name: "member_workflow",
    description:
      "查看当前团队的工作流实时快照：每个成员的状态、当前工作包、累计 token 消耗与用时。数据来自会话事件旁路采集 + 任务板，不阻塞会话；任务板不可用时对应字段会明确标注。",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    output: jsonOutput({ type: "object" }),
    async execute() {
      const live = liveAgentsByTarget();
      if (!tracker) return { enabled: false, message: "工作流观测已关闭（workflow.enabled=false）" };
      return tracker.summary(workflowMemberRows(), {
        liveStatus: (target) => {
          const agent = live.get(target);
          return agent ? agent.status : null;
        },
      });
    },
  });

  register({
    name: "member_update",
    description:
      "成员管理插件的自动更新（安全分阶段）：status 查看状态；check 查询 npm 最新版；stage 下载并暂存；apply 应用到安装目录（仅在非运行中安全前提下，失败自动保留回滚材料）；rollback 回滚上一次应用。运行中的插件目录不允许被替换，apply 会明确报错并给出人工步骤。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["status", "check", "stage", "apply", "rollback"], description: "要执行的动作" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    output: jsonOutput({ type: "object" }),
    async execute(args) {
      switch (args?.action) {
        case "check":
          return envelope(await updateCheck());
        case "stage":
          return envelope(await updateStage());
        case "apply":
          return envelope(await updateApply());
        case "rollback":
          return envelope(await updateRollback());
        default:
          return updateStatusView();
      }
    },
  });

  register({
    name: "member_backup",
    description:
      "成员名册（组织架构）的备份与恢复。status/list 查看现有备份；backup 立即打一份快照；restore 用某个备份文件覆盖当前名册（恢复前会自动再备份一份安全副本）；prune 按保留策略清理；export 导出到指定路径。插件每次写入名册后会自动备份，并在启动时留一份启动快照。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["status", "list", "backup", "restore", "prune", "export"], description: "要执行的动作" },
        file: { type: "string", description: "restore 时的备份文件名（从 list 结果里取 file 字段）" },
        reason: { type: "string", description: "backup 时的备注标记（如 before-upgrade）" },
        outFile: { type: "string", description: "export 时的输出路径（缺省写到 dataDir/registry-export.json）" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    output: jsonOutput({ type: "object" }),
    async execute(args) {
      switch (args?.action) {
        case "list":
          return backupView();
        case "backup":
          return envelopeRaw(runBackup(args.reason || "manual"));
        case "restore":
          return envelopeRaw(restoreBackupFile(args));
        case "prune":
          return envelopeRaw(rotateBackups(dataDir, { keep: backupsKeep, dailyKeep: backupsDailyKeep }));
        case "export":
          return envelopeRaw(exportRegistry({ registryFile, outFile: args.outFile }));
        default:
          return backupView();
      }
    },
  });

  bootMark(`tools-done:ok=${toolState.registered.length} failed=${toolState.failed.length}${toolState.failed.length ? " " + toolState.failed.join(" | ") : ""}`);

  /* ------------------------------------------------------------------ */
  /* HTTP 路由（Web 面板用）                                             */
  /* ------------------------------------------------------------------ */

  function sendJson(res, status, payload) {
    const body = JSON.stringify(payload, null, 2);
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
      "cache-control": "no-store",
    });
    res.end(body);
  }

  function readBody(req, limit = 256 * 1024) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on("data", (c) => {
        size += c.length;
        if (size > limit) {
          reject(new Error("请求体过大"));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }

  /** 单入口分派：面板所有写操作都走这里，便于统一校验与审计 */
  /* ------------------------------------------------------------------ */
  /* 0.2.0 · 一句话建组（自然语言 → 小组 + 成员）                          */
  /* ------------------------------------------------------------------ */

  /**
   * 把一句中文描述解析成「小组 + 成员」。
   *
   * 默认 **只预览不落盘**（dryRun），避免自然语言解析误差直接写进名册；
   * 面板与工具都要求调用方显式 confirm:true 才真正创建。
   */
  function createGroupFromText(args = {}) {
    const text = typeof args.text === "string" ? args.text : "";
    if (!text.trim()) return { ok: false, code: "BAD_BRIEF", message: "缺少一句话描述（text）" };
    const confirm = args.confirm === true;
    const brief = parseGroupBrief(text, {});
    if (!brief.ok) {
      return { ok: false, code: "BAD_BRIEF", message: (brief.errors || []).join("；") || "无法解析这段话", detail: { errors: brief.errors, warnings: brief.warnings } };
    }

    // target 撞名时自动加序号，绝不覆盖已有成员
    const registry = store.load().registry;
    const used = new Set((registry.members || []).map((m) => m.target));
    for (const m of brief.members) {
      if (used.has(m.target)) m.target = suggestTarget(m.title || m.displayName, [...used]);
      used.add(m.target);
    }

    const groupName = typeof args.groupName === "string" && args.groupName.trim() ? args.groupName.trim() : brief.group.name;
    const description = typeof args.description === "string" ? args.description : brief.group.description || "";
    const summary = describeBrief({ group: { name: groupName, description }, members: brief.members });
    const preview = {
      group: { name: groupName, description },
      members: brief.members,
      summary,
      warnings: brief.warnings || [],
    };

    if (!confirm) return { ok: true, data: { dryRun: true, ...preview } };

    const created = service.createGroup({ name: groupName, description });
    if (!created.ok) return created;
    const groups = created.data.groups || [];
    const group = groups.find((g) => g.name === groupName) || groups[groups.length - 1];
    if (!group) return { ok: false, code: "INTERNAL", message: "小组创建后找不到对应记录" };

    const added = [];
    const failures = [];
    for (const m of brief.members) {
      const result = service.addMember({
        target: m.target,
        displayName: m.displayName,
        title: m.title,
        duties: m.duties,
        skills: m.skills,
        groupId: group.id,
        ...(m.model ? { model: m.model } : {}),
      });
      if (result.ok) added.push(m.target);
      else failures.push({ target: m.target, code: result.code, message: result.message });
    }
    return {
      ok: failures.length === 0,
      ...(failures.length === 0 ? {} : { code: "PARTIAL", message: `${failures.length} 个成员创建失败：${failures.map((f) => f.target).join("、")}` }),
      data: { dryRun: false, group: { id: group.id, name: group.name }, members: brief.members, added, failures, summary },
    };
  }

  function updateStatusView() {
    let base = { current: currentVersion, pending: null, lastApply: null, newerPending: false, warnings: [] };
    if (updater) {
      try {
        const result = updater.status();
        if (result && result.ok) {
          base = {
            current: result.current || currentVersion,
            pending: result.pending ?? null,
            lastApply: result.lastApply ?? null,
            newerPending: Boolean(result.newerPending),
            warnings: result.warnings || [],
          };
        } else base.warnings = [...(base.warnings || []), result?.message || "读取更新状态失败"];
      } catch (err) {
        base.warnings = [...(base.warnings || []), err?.message ?? String(err)];
      }
    }
    return {
      ...base,
      enabled: Boolean(updater),
      installDir: updateInstallDir,
      checkOnBoot: updateCheckOnBoot,
      autoStage: updateAutoStage,
      lastCheck: updateState.lastCheck,
      lastError: updateState.lastError,
      latest: updateState.latest,
      lastAction: updateState.lastAction,
      // 事故报告的核心约束：默认不提供在线应用，只提供「退出 DSH 后离线应用」
      applyMode: updateAllowOnlineApply ? "online" : "offline-script",
      allowOnlineApply: updateAllowOnlineApply,
      applyScript: applyScriptPath,
      applyCommand: `node "${applyScriptPath}" --data-dir "${dataDir}" --install-dir "${updateInstallDir}" --yes`,
      restartRequired: true,
    };
  }

  const OPERATIONS = {
    addMember: (a) => service.addMember(a),
    registerLive: () => service.registerLive(),
    renameMember: (a) => service.renameMember(a.target, a.patch || {}),
    removeMember: (a) => service.removeMember(a.target),
    restoreMember: (a) => service.restoreMember(a.target),
    setRole: (a) => service.setRole(a.target, a.patch || {}),
    setSkills: (a) => service.setSkills(a.target, a.patch || {}),
    // 面板保存编辑表单时会同时发 setModel；漏掉这一条会让「改模型」静默失败（返回 UNKNOWN_OPERATION）
    // 根会话身份（lead）不接受覆盖：返回明确错误，面板会显示原因而不是静默存一个不生效的值。
    setModel: (a) => {
      if (a && a.model) {
        const reason = rootIdentityReason(a.target);
        if (reason) {
          return {
            ok: false,
            code: "ROOT_IDENTITY_NO_OVERRIDE",
            message: `「${a.target}」是用户直接对话的会话身份（${reason}），不参与模型覆盖；它的模型由用户在会话框里自己选。`,
          };
        }
      }
      const result = service.setModel(a.target, { model: a.model, provider: a.provider });
      // 面板只写名册的话，运行中的子 agent 会继续用旧模型，而 system-prompt/assemble
      // 已经每步按新名册改提示词 —— 提示词与真实请求不一致。这里补上与 tool 相同的落盘。
      if (result && result.ok !== false) {
        const results = applySelectionToLive(a.target, "panel-set-model", { force: true });
        if (results.length) result.selectionApplied = results[results.length - 1];
      }
      return result;
    },
    assignGroup: (a) => service.assignGroup(a.target, a.groupId ?? null),
    createGroup: (a) => service.createGroup(a),
    renameGroup: (a) => service.renameGroup(a.id, a.patch || {}),
    deleteGroup: (a) => service.deleteGroup(a.id, a.options || {}),
    // 0.2.0
    createGroupFromText: (a) => createGroupFromText(a),
    updateCheck: () => updateCheck(),
    updateStage: () => updateStage(),
    updateApply: () => updateApply(),
    updateRollback: () => updateRollback(),
    // 备份与恢复：组织架构资产的安全网
    backupNow: (a) => envelopeRaw(runBackup(a?.reason || "manual")),
    restoreBackup: (a) => envelopeRaw(restoreBackupFile(a)),
    listBackups: () => envelopeRaw(backupView()),
    pruneBackups: () => envelopeRaw(rotateBackups(dataDir, { keep: backupsKeep, dailyKeep: backupsDailyKeep })),
    exportRegistry: (a) => envelopeRaw(exportRegistry({ registryFile, outFile: a?.outFile })),
  };

  /* ------------------------------------------------------------------ */
  /* 公司化工具（0.3.0）                                                  */
  /* ------------------------------------------------------------------ */

  // 全部 company_* 一律**全局注册**（三线隔离不靠「先注册再 deny」——宿主的
  // tools.restrict 只过滤继承层、不过滤自有层，在本 agent 自己的层注册的工具
  // 无法被自有 restrict 挡住）。行隔离由 runtime 内的 restrict（白名单继承）+
  // guards（执行前硬拒）+ 执行体反查三道共同保证。
  if (company) {
    for (const tool of company.tools || []) {
      try {
        const shaped = { ...tool };
        if (!shaped.output || typeof shaped.output.render !== "function") {
          const schema = shaped.outputSchema && typeof shaped.outputSchema === "object" ? shaped.outputSchema : { type: "object" };
          shaped.output = jsonOutput(schema);
        }
        delete shaped.outputSchema;
        // 描述太短会被模型误用，也会被宿主插件测试判为不合格：给出可读的兜底。
        if (typeof shaped.description !== "string" || shaped.description.length <= 10) {
          shaped.description = `${shaped.name}：公司化运行时工具，用于公司/部门/员工/工单的编排、查询与回报。`;
        }
        if (!shaped.parameters || shaped.parameters.type !== "object") {
          shaped.parameters = { type: "object", properties: {}, additionalProperties: false };
        }
        register(shaped);
      } catch (err) {
        const detail = err?.message ?? String(err);
        toolState.failed.push(`${tool?.name || "company_*"}: ${detail}`);
        bootMark(`company-tool-failed:${tool?.name || "?"}:${detail.slice(0, 200)}`);
      }
    }
    bootMark(`company-tools-registered:${toolState.registered.filter((n) => n.startsWith("company_")).length}`);
  }

  // 路由注册：直接声明 webServer 依赖（与官方 dsh-web-app、第三方 dsh-skills-manager 同一写法）。
  // 早期版本用 ctx.inject(["webServer"], cb) 做可选注入——实测在 desktop profile 下该回调未触发，
  // 导致 apply 正常执行但路由一条都没注册。改为在 inject 里声明后可直接用 ctx.webServer。
  try {
    routeState.webServerSeen = Boolean(ctx.webServer && typeof ctx.webServer.register === "function");
    if (!routeState.webServerSeen) {
      bootMark("webServer-missing");
      warn("ctx.webServer 不可用 —— Web 面板将不可用（工具不受影响）");
    } else {
      bootMark("webServer-present");
      // 路由注册失败绝不能影响工具：工具是主要能力，Web 面板是附加入口。
      // 每个 handler 再包一层兜底：service 抛错（典型是写盘失败）时返回 500 INTERNAL 并带
      // message，而不是把异常抛进 webServer 的调用栈——那样面板只能看到「请求失败」，
      // 既没有 code 也没有原因，排查时无从下手。
      const route = (p, handler) => {
        const guarded = async (req, res) => {
          try {
            return await handler(req, res);
          } catch (err) {
            const message = err?.message ?? String(err);
            routeState.errors.push(`${p}: ${message}`);
            bootMark(`route-threw:${p}:${String(message).slice(0, 300)}`);
            try {
              if (!res.headersSent) sendJson(res, 500, { ok: false, code: "INTERNAL", message });
            } catch {
              /* 响应已断开，忽略 */
            }
            return undefined;
          }
        };
        try {
          const disposer = ctx.effect(
            () => ctx.webServer.register({ kind: "exact", path: `${API_PREFIX}${p}`, handler: guarded }),
            `${name}: route ${p}`,
          );
          routeState.registered.push(p);
          return disposer;
        } catch (err) {
          routeState.errors.push(`${p}: ${err?.message ?? err}`);
          warn(`路由 ${p} 注册失败（Web 面板该功能不可用）：${err?.message ?? err}`);
          return undefined;
        }
      };

      route("/state", (req, res) => {
        if (req.method !== "GET") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
        const view = service.view();
        return sendJson(res, 200, {
          ok: true,
          data: { ...view, registryFile, lastRefresh, cacheError, company: companySummary() },
        });
    });

    route("/op", async (req, res) => {
      if (req.method !== "POST") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
      let payload;
      try {
        const raw = await readBody(req);
        payload = raw ? JSON.parse(raw) : {};
      } catch (err) {
        return sendJson(res, 400, { ok: false, code: "BAD_REQUEST", message: err?.message ?? String(err) });
      }
      const op = payload?.op;
      const fn = OPERATIONS[op];
      if (typeof fn !== "function") {
        return sendJson(res, 400, { ok: false, code: "UNKNOWN_OP", message: `未知操作：${op}` });
      }
      // await：service 目前全是同步的，但这里不必假设；异步实现（未来接远端名册）也不会漏 catch。
      const result = await fn(payload.args || {});
      // 业务错误（校验失败、找不到成员…）是 400；写盘失败这类内部错误必须 500，
      // 否则面板会把「磁盘写不进去」显示成「你填错了」，排查方向直接被带偏。
      const internal = result?.ok === false && (result.code === "INTERNAL_ERROR" || result.code === "INTERNAL");
      const status = result?.ok === false ? (internal ? 500 : 400) : 200;
      return sendJson(res, status, { ok: result?.ok !== false, ...(result?.ok === false ? { code: result.code, message: result.message, detail: result.detail } : { data: result?.data }) });
    });

    // 面板的技能选择弹层用：本机已安装的全部技能（名称 + 描述 + 来源）
    route("/skills", async (req, res) => {
      if (req.method !== "GET") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
      // 支持 ?cwd=<项目路径>，让面板也能看到项目级技能根
      let cwd;
      try {
        const url = new URL(req.url || "/", "http://localhost");
        const q = url.searchParams.get("cwd");
        if (q && q.trim()) cwd = q.trim();
      } catch {
        /* 解析失败就当作没传 */
      }
      const cat = await skillCatalog(cwd ? { cwd } : {});
      if (!cat.ok) {
        // 技能服务不可用时仍返回 200 + 空列表 + 提示，让面板能优雅降级而不是报错
        return sendJson(res, 200, { ok: true, data: { total: 0, skills: [], warning: `${cat.code}: ${cat.message}` } });
      }
      return sendJson(res, 200, { ok: true, data: { total: cat.items.length, skills: cat.items } });
    });

    // 模型覆盖的可观测性：装了几个监听、覆写成功多少次、最后一次覆写是什么
    route("/overrides", (req, res) => {
      if (req.method !== "GET") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
      return sendJson(res, 200, {
        ok: true,
        data: {
          installedInstances: modelOverrideInstalledCount,
          // 契约兼容别名：/overrides 的旧字段名继续输出
          installedCount: modelOverrideInstalledCount,
          installed: [...modelOverrideInstalledIds],
          applied: overrideStats.applied,
          misses: overrideStats.misses,
          path: overrideStats.path,
          cleared: overrideStats.cleared,
          unchanged: overrideStats.unchanged,
          skippedRoot: overrideStats.skippedRoot,
          errors: overrideStats.errors,
          lastError: overrideStats.lastError,
          lastApplied: overrideStats.lastApplied,
          // F5-a：审计字段全集，可重建 before/after
          history: overrideStats.history.slice(-20),
        },
      });
    });

    // 面板的模型下拉用：可用 provider 与模型目录
    route("/models", async (req, res) => {
      if (req.method !== "GET") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
      const cat = await modelCatalog();
      if (!cat.ok) {
        return sendJson(res, 200, { ok: true, data: { providers: [], warning: `${cat.code}: ${cat.message}` } });
      }
      return sendJson(res, 200, { ok: true, data: { providers: cat.providers } });
    });

    // 面板首次打开时的一次性元信息
    route("/health", (req, res) => {
      if (req.method !== "GET") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
      return sendJson(res, 200, { ok: true, data: { name, registryFile, dataDir } });
    });

    // 0.2.5 · 任务（会话）作用域的组织架构图（面板每 2s 轮询；?task=<rootSessionId> 选任务）
    route("/orgmap", (req, res) => {
      if (req.method !== "GET") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
      let taskId = "";
      try {
        taskId = new URL(req.url || "/", "http://localhost").searchParams.get("task") || "";
      } catch {
        taskId = "";
      }
      return sendJson(res, 200, { ok: true, data: orgmapSnapshot(taskId) });
    });

    route("/workflow", (req, res) => {
      if (req.method !== "GET") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
      return sendJson(res, 200, { ok: true, data: workflowSnapshot() });
    });

    // 0.2.0 · 自动更新状态（只读；check/stage/apply 走 POST /op）
    route("/update", (req, res) => {
      if (req.method !== "GET") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
      return sendJson(res, 200, { ok: true, data: updateStatusView() });
    });

    // 0.2.0 · 名册备份（面板「维护」页用；备份/恢复动作走 POST /op）
    route("/backups", (req, res) => {
      if (req.method !== "GET") return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
      return sendJson(res, 200, { ok: true, data: backupView() });
    });

    // 0.3.0 · 公司化只读接口（组织树 / 工位看板 / 成本 / 工单）：
    // 统一挂在 /api/dsh-member-manager/company/* 下；handler 返回裸数据，
    // 由这里的 wrapper 负责 405/异常与 { ok:true, data } 信封。
    if (company) {
      for (const r of company.routes || []) {
        try {
          const rawPath = typeof r?.path === "string" && r.path ? r.path : "/company/overview";
          const p = rawPath.startsWith("/company") ? rawPath : `/company${rawPath}`;
          const method = String(r?.method || "GET").toUpperCase();
          route(p, async (req, res) => {
            if (req.method !== method) return sendJson(res, 405, { ok: false, code: "METHOD_NOT_ALLOWED" });
            let url = null;
            try {
              url = new URL(req.url || "/", "http://localhost");
            } catch {
              url = null;
            }
            // v0.3.0 · 面板写接口（POST /company/op 等）：body 在这里统一解析，
            // 作为第三参交给 runtime handler；解析失败直接 400，不进业务逻辑。
            let body = null;
            if (method !== "GET" && method !== "HEAD") {
              let raw = "";
              try {
                raw = await readBody(req);
              } catch {
                return sendJson(res, 413, { ok: false, code: "E_BODY_TOO_LARGE" });
              }
              if (raw.trim()) {
                try {
                  body = JSON.parse(raw);
                } catch {
                  return sendJson(res, 400, { ok: false, code: "E_BAD_JSON" });
                }
              }
            }
            const data = await r.handler(req, url, body);
            return sendJson(res, 200, { ok: true, data });
          });
        } catch (err) {
          const detail = err?.message ?? String(err);
          routeState.errors.push(`company: ${detail}`);
          bootMark(`company-route-failed:${detail.slice(0, 200)}`);
          warn(`公司路由注册失败：${detail}`);
        }
      }
    }

      bootMark(`routes-registered:${routeState.registered.length}${routeState.errors.length ? " errors:" + routeState.errors.join("|") : ""}`);
    }
  } catch (err) {
    bootMark(`routes-block-threw:${err?.message ?? err}`);
    warn(`Web 面板路由初始化失败：${err?.message ?? err}（工具不受影响）`);
  }

  /* ------------------------------------------------------------------ */
  /* 公司化 boot（非阻塞、可降级）                                        */
  /* ------------------------------------------------------------------ */

  // 三条硬约束：
  // 1) 绝不能在 apply 里同步 await —— boot 会读盘/建会话，慢或失败都不该拖住
  //    名册工具与面板路由的注册；
  // 2) boot 失败只记 warning + bootMark，不抛（否则宿主会认为整个插件 apply
  //    失败，名册覆盖层一起消失）；
  // 3) disposer 里按 docs/11 §2.3 的 I6 顺序 shutdown（runtime 内部自带超时与
  //    try/catch，这里只兜「调用本身抛错」）。
  if (company) {
    try {
      ctx.effect(() => {
        let disposed = false;
        const timer = setTimeout(() => {
          if (disposed) return;
          Promise.resolve()
            .then(() => company.boot())
            .then((result) => {
              if (disposed) return;
              companyState.booted = true;
              companyState.warnings = Array.isArray(result?.warnings) ? result.warnings : [];
              bootMark(`company-booted:warnings=${companyState.warnings.length}`);
              for (const item of companyState.warnings) warn(`[company] ${item}`);
            })
            .catch((err) => {
              const detail = err?.message ?? String(err);
              companyState.error = detail;
              bootMark(`company-boot-failed:${detail.slice(0, 200)}`);
              warn(`公司化运行时 boot 失败（降级为只读、不可派工）：${detail}`);
            });
        }, 0);
        if (timer && typeof timer.unref === "function") timer.unref();
        return () => {
          disposed = true;
          try {
            clearTimeout(timer);
          } catch {
            /* ignore */
          }
          try {
            Promise.resolve(company.shutdown?.()).catch((err) => {
              bootMark(`company-shutdown-failed:${(err?.message ?? err).slice(0, 200)}`);
            });
          } catch (err) {
            bootMark(`company-shutdown-threw:${(err?.message ?? err).slice(0, 200)}`);
          }
        };
      }, `${name}: company-boot`);
    } catch (err) {
      companyState.error = err?.message ?? String(err);
      bootMark(`company-boot-effect-failed:${String(companyState.error).slice(0, 200)}`);
      warn(`公司化 boot 未能挂载（名册功能不受影响）：${companyState.error}`);
    }
  }

  bootMark(
    `apply-completed:tools=${toolState.registered.length} routes=${routeState.registered.length} company=${
      companyState.enabled ? (companyState.booted ? "booted" : companyState.error ? "error" : "pending") : "off"
    }`,
  );
}
