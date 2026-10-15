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

import { RegistryStore } from "../src/shared/registry-store.mjs";
import { validateRegistry } from "../src/shared/registry-core.mjs";
import { TeamService } from "../src/shared/team-service.mjs";

export const name = "dsh-plugin-member-manager";
// 显式声明两个依赖：官方 dsh-web-app 与第三方 dsh-skills-manager 都是这么写的。
// webServer 必须在这里声明，否则 ctx.webServer 不可用、Web 面板路由注册不上。
export const inject = ["tools", "webServer"];

const API_PREFIX = "/api/dsh-plugin-member-manager";

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
  /* 核心成员列表：缓存快照                                              */
  /* ------------------------------------------------------------------ */

  /** rootSessionId -> Set<memberName> */
  const rosterCache = new Map();
  let cacheError = null;
  let lastRefresh = null;

  /** Web 面板路由的注册状态，供 member_diagnose 报告 */
  const routeState = { webServerSeen: false, registered: [], errors: [] };

  const teamServiceRef = { current: null };

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
  // onWrite：任何一次成功写入都让名册缓存失效，agent/request 路径立刻拿到新值
  const service = new TeamService({ store, liveTargets, onWrite: () => invalidateRegistryMemo() });
  teamServiceRef.current = service;
  bootMark("service-ready");

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
   * 该 agent 对应的成员是否配置了模型覆盖。
   * 成员名从团队内核的 membership 拿（`tryMembership(agent)` 需要精确的 live agent）。
   */
  function modelOverrideFor(agent) {
    try {
      const teams = ctx.get("agentTeams");
      if (!teams || typeof teams.tryMembership !== "function") return null;
      const membership = teams.tryMembership(agent);
      const target = membership && membership.name;
      if (!target) return null;
      const registry = readRegistryCached();
      if (!registry || !Array.isArray(registry.members)) return null;
      const m = registry.members.find((x) => x.target === target);
      if (!m || m.status !== "active" || !m.model) return null;
      // 带上 target 仅供诊断展示（写请求配置时只取 model / provider）
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

  // 已安装模型覆盖的 agent id（避免重复挂监听）
  const modelOverrideInstalled = new Set();

  /**
   * 模型覆盖的可观测性。
   *
   * 这个功能平时是「隐形」的：设了模型之后，除非盯着会话记录，没人知道覆写到底有没有发生。
   * 实测发现 DSH 的会话投影**不记录**每轮请求的 config，所以外部分析拿不到证据 ——
   * 于是插件自己记录：装了多少个监听、覆写成功多少次、有没有触发但查不到覆盖的情况。
   * 通过 `GET /overrides` 或 `member_diagnose` 可读。
   */
  const overrideStats = {
    applied: 0, // 成功改写请求配置的次数
    misses: 0, // 监听触发、但该成员没有覆盖（正常情况，只说明监听在工作）
    lastApplied: null, // { agentId, target, model, provider?, at }
  };

  /**
   * 给一个 agent 安装 **模型覆盖**。
   *
   * 这不是黑科技：官方 `dsh-agent\lib\types\model-selection.js:61` 就是这么做的 ——
   * `agent/request` 是每轮请求前的水位（waterfall），返回值即最终请求配置。
   * 钩子挂在 agent 的作用域 ctx 上，因此天然是「按成员」生效。
   */
  function installModelOverride(agent) {
    try {
      if (!agent || typeof agent.id !== "string") return;
      if (modelOverrideInstalled.has(agent.id)) return;
      const scoped = agent.ctx;
      if (!scoped || typeof scoped.on !== "function") return;
      modelOverrideInstalled.add(agent.id);

      // 让系统提示里的 provider/model 变量也跟着变（官方同样这么做）
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

      scoped.on("agent/request", async (_payload, next) => {
        const resolved = await next();
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
          at: new Date().toISOString(),
        };
        bootMark(`model-override-applied:${ov.target}=${ov.model}`);
        return {
          ...resolved,
          ...(ov.provider ? { provider: ov.provider } : {}),
          model: ov.model,
        };
      });
      bootMark(`model-override-installed:${agent.id}`);
    } catch (err) {
      warn(`为 agent ${agent && agent.id} 安装模型覆盖失败：${err?.message ?? err}`);
    }
  }

  function handleAgentLifecycle(payload) {
    const agent = agentFromPayload(payload);
    if (!agent) return;
    refreshFromAgent(agent);
    installModelOverride(agent);
  }

  for (const evt of ["agent/created", "agent/status"]) {
    try {
      ctx.on(evt, handleAgentLifecycle);
    } catch {
      /* 事件不存在时静默跳过 */
    }
  }

  // 覆盖插件加载前就已存在的 agent（官方工具包同样先跑一遍 list()）
  try {
    const agents = ctx.get("agents");
    if (agents && typeof agents.list === "function") {
      for (const agent of agents.list()) {
        refreshFromAgent(agent);
        installModelOverride(agent);
      }
      bootMark(`agents-preinstalled:${modelOverrideInstalled.size}`);
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
      "查看本地成员名册的组织架构（小组 → 成员），含中文显示名、DSH target、岗位职责、技能与启用状态。注意：DSH 原生 team 成员名不可改、不可删，本名册是独立覆盖层。",
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
      return {
        coreAvailable: view.coreAvailable,
        stats: view.stats,
        groups: groups.map((g) => ({ id: g.id, name: g.name, description: g.description, members: strip(g.members) })),
        ungrouped: strip(view.ungrouped),
        unregistered: view.unregistered,
        warnings: view.warnings,
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
      return {
        ok: failed.length === 0,
        plugin: { name, version: "0.1.1", registryFile, dataDir },
        checks,
        failed: failed.map((c) => c.name),
        registry: { members: view.stats.members, groups: view.stats.groups, active: view.stats.active, retired: view.stats.retired },
        core: { available: view.coreAvailable, cachedSessions: rosterCache.size, lastRefresh, cacheError },
        // 模型覆盖是否真的在工作：applied 增长即证明覆写发生在真实请求上
        modelOverride: {
          installedAgents: modelOverrideInstalled.size,
          applied: overrideStats.applied,
          lastApplied: overrideStats.lastApplied,
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
      "设置或清除某个成员的模型覆盖。**这是真生效的**：插件在该成员 agent 的 `agent/request` 水位接缝上按名册覆写 provider/model（与官方 dsh-agent 的 model-selection 同一机制），下一次该成员的请求即用新模型。model 传空字符串即清除覆盖。",
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
      const result = service.setModel(target, { model, provider });
      if (!result.ok) return result;
      const m = result.data.members.find((x) => x.target === target);
      // 注意：只挂有值的键，避免 undefined 让工具输出无法无损 JSON 往返
      const member = { target: m.target };
      if (m.model) member.model = m.model;
      if (m.provider) member.provider = m.provider;
      return {
        ...result,
        applied: m.model ? "模型覆盖已写入；该成员下一次请求即生效" : "模型覆盖已清除；恢复使用默认模型",
        member,
      };
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
  const OPERATIONS = {
    addMember: (a) => service.addMember(a),
    registerLive: () => service.registerLive(),
    renameMember: (a) => service.renameMember(a.target, a.patch || {}),
    removeMember: (a) => service.removeMember(a.target),
    restoreMember: (a) => service.restoreMember(a.target),
    setRole: (a) => service.setRole(a.target, a.patch || {}),
    setSkills: (a) => service.setSkills(a.target, a.patch || {}),
    // 面板保存编辑表单时会同时发 setModel；漏掉这一条会让「改模型」静默失败（返回 UNKNOWN_OPERATION）
    setModel: (a) => service.setModel(a.target, { model: a.model, provider: a.provider }),
    assignGroup: (a) => service.assignGroup(a.target, a.groupId ?? null),
    createGroup: (a) => service.createGroup(a),
    renameGroup: (a) => service.renameGroup(a.id, a.patch || {}),
    deleteGroup: (a) => service.deleteGroup(a.id, a.options || {}),
  };

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
      const route = (p, handler) => {
        try {
          const disposer = ctx.effect(
            () => ctx.webServer.register({ kind: "exact", path: `${API_PREFIX}${p}`, handler }),
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
          data: { ...view, registryFile, lastRefresh, cacheError },
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
      const result = fn(payload.args || {});
      const status = result?.ok === false ? 400 : 200;
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
          installedCount: modelOverrideInstalled.size,
          installed: [...modelOverrideInstalled],
          applied: overrideStats.applied,
          misses: overrideStats.misses,
          lastApplied: overrideStats.lastApplied,
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
    route("/health", (req, res) => sendJson(res, 200, { ok: true, data: { name, registryFile, dataDir } }));

      bootMark(`routes-registered:${routeState.registered.length}${routeState.errors.length ? " errors:" + routeState.errors.join("|") : ""}`);
    }
  } catch (err) {
    bootMark(`routes-block-threw:${err?.message ?? err}`);
    warn(`Web 面板路由初始化失败：${err?.message ?? err}（工具不受影响）`);
  }

  bootMark(`apply-completed:tools=${toolState.registered.length} routes=${routeState.registered.length}`);
}
