/**
 * 团队管理服务门面（facade）。
 *
 * 这一层是「宿主端 tool」与「Web 面板 / HTTP 路由」的共同入口：
 *  - 统一把 RegistryError 转成 `{ok:false, code, message}` 结果对象，
 *    这样 tool 层和 HTTP 层都不需要 try/catch，也不会把异常泄漏给宿主。
 *  - 所有写操作经由 RegistryStore 原子落盘。
 *  - 通过注入的 liveTargets() 读取 DSH 核心真实成员名，用于标记「未登记 / 孤儿」。
 *
 * 重要（见子代理 A 的内核结论）：核心 roster 不可变，本插件**只写自己的名册**，
 * 绝不向核心的 team 日志写入任何事件。
 */

import { RegistryError, buildTree, renderTreeText } from "./registry-core.mjs";
import * as core from "./registry-core.mjs";

export class TeamService {
  /**
   * @param {object} opts
   * @param {import('./registry-store.mjs').RegistryStore} opts.store
   * @param {() => string[]} [opts.liveTargets] 返回 DSH 核心当前成员 name 列表
   * @param {() => string} [opts.now]
   * @param {() => void} [opts.onWrite] 每次成功写入后回调（宿主用它失效名册缓存）
   */
  constructor({ store, liveTargets = () => [], now = () => new Date().toISOString(), onWrite = null }) {
    this.store = store;
    this.liveTargets = liveTargets;
    this.now = now;
    this.onWrite = onWrite;
  }

  /* ---------------- 读 ---------------- */

  /**
   * 规范化后的 liveTargets。
   * 返回 `null` 表示「读不到核心成员列表」——这与「核心确实一个成员都没有」是两回事：
   * 前者不能用来判定孤儿/未登记，否则读核心失败会把整个名册误标为孤儿。
   */
  #live() {
    try {
      const list = this.liveTargets();
      if (!Array.isArray(list)) return null;
      return [...new Set(list.filter((t) => typeof t === "string" && t.trim()).map((t) => t.trim()))];
    } catch {
      return null;
    }
  }

  view() {
    const { registry, warnings, recovered } = this.store.load();
    const live = this.#live();
    const tree = buildTree(registry, live ?? undefined);
    return { ...tree, coreAvailable: live !== null, warnings, recovered };
  }

  text() {
    return renderTreeText(this.view());
  }

  getMember(target) {
    const { registry } = this.store.load();
    const m = registry.members.find((x) => x.target === target);
    if (!m) return { ok: false, code: "MEMBER_NOT_FOUND", message: `名册中没有成员：${target}` };
    return { ok: true, data: m };
  }

  /** 核心有、名册没有的成员 */
  unregistered() {
    const live = this.#live();
    if (live === null) return [];
    const { registry } = this.store.load();
    return live.filter((t) => !registry.members.some((m) => m.target === t)).sort();
  }

  /** 名册有、核心当前成员列表里没有的成员（可能属于其他会话，或核心侧已不存在） */
  orphans() {
    const live = this.#live();
    if (live === null) return [];
    const set = new Set(live);
    const { registry } = this.store.load();
    return registry.members.filter((m) => !set.has(m.target)).map((m) => m.target).sort();
  }

  /* ---------------- 写（每个都返回结果对象） ---------------- */

  #run(mutator) {
    try {
      const { registry } = this.store.update(mutator);
      // 写成功后通知宿主失效缓存（agent/request 路径靠缓存读名册）
      try {
        if (typeof this.onWrite === "function") this.onWrite();
      } catch {
        /* 缓存失效失败不影响写入结果 */
      }
      return { ok: true, data: registry };
    } catch (err) {
      if (err instanceof RegistryError) {
        return { ok: false, code: err.code, message: err.message, detail: err.detail };
      }
      return { ok: false, code: "INTERNAL_ERROR", message: err?.message ?? String(err) };
    }
  }

  addMember(input) {
    const now = this.now();
    return this.#run((reg) => core.addMember(reg, input, now));
  }

  /** 把核心已存在的成员批量登记进名册（已登记的跳过） */
  registerLive(targets) {
    const source = Array.isArray(targets) ? targets : this.#live();
    if (source === null) {
      return { ok: false, code: "CORE_UNAVAILABLE", message: "读不到核心成员列表，已取消批量登记（避免误登记空名单）" };
    }
    const list = source.filter((t) => core.isValidTarget(t));
    const now = this.now();
    const skipped = [];
    const added = [];
    const res = this.#run((reg) => {
      let next = reg;
      for (const t of list) {
        if (next.members.some((m) => m.target === t)) {
          skipped.push(t);
          continue;
        }
        next = core.addMember(next, { target: t }, now);
        added.push(t);
      }
      return next;
    });
    return res.ok ? { ok: true, data: { added, skipped } } : res;
  }

  renameMember(target, patch) {
    const now = this.now();
    return this.#run((reg) => core.renameMember(reg, target, patch, now));
  }

  removeMember(target) {
    const now = this.now();
    return this.#run((reg) => core.removeMember(reg, target, {}, now));
  }

  restoreMember(target) {
    const now = this.now();
    return this.#run((reg) => core.removeMember(reg, target, { restore: true }, now));
  }

  setRole(target, patch) {
    const now = this.now();
    return this.#run((reg) => core.setRole(reg, target, patch, now));
  }

  setSkills(target, patch) {
    const now = this.now();
    return this.#run((reg) => core.setSkills(reg, target, patch, now));
  }

  /** 设置/清除成员的模型覆盖（model 传空串即清除） */
  setModel(target, patch) {
    const now = this.now();
    return this.#run((reg) => core.setModel(reg, target, patch, now));
  }

  assignGroup(target, groupId) {
    const now = this.now();
    return this.#run((reg) => core.assignGroup(reg, target, groupId, now));
  }

  createGroup(input) {
    const now = this.now();
    return this.#run((reg) => core.createGroup(reg, input, now));
  }

  renameGroup(groupId, patch) {
    const now = this.now();
    return this.#run((reg) => core.renameGroup(reg, groupId, patch, now));
  }

  deleteGroup(groupId, opts = {}) {
    const now = this.now();
    return this.#run((reg) => core.deleteGroup(reg, groupId, opts, now));
  }
}
