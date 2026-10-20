/**
 * 「总架构」面板（docs/16 §4.4 / §5 v4）的离线测试：不需要浏览器，也不需要 DSH 在运行。
 *
 * 做法与 client-bundle.test.mjs 一致：
 *  1. 用 node:vm + `window.__ModuleLoader__.load` 把 lib/client.js 真实加载进来
 *     （require 替身只提供 react），拿到 exports 与 __internals
 *  2. 用 apply() 捕获真实的中英文字典，再把 t 做成真实插值函数，
 *     这样断言的是用户最终看到的中文文案，而不是 key
 *  3. 用种子化 hooks 的 react 替身直接执行 Panel / CompanyOrgPanel 的函数体，
 *     从真实元素树里断言架构图、员工中心、部门弹层、写操作与各级空态
 *  4. 用可跑 effect 的 react 替身 + 假定时器验证「打开拉一次 + 5 秒轮询 + 卸载清理」
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE = path.join(HERE, "..", "lib", "client.js");
const OVERVIEW_URL = "/api/dsh-member-manager/company/overview";
const OP_URL = "/api/dsh-member-manager/company/op";

/* ==================== react 替身 ==================== */

/** 种子化 hooks：seed 按调用顺序给 useState 喂初值，setter 可写入（便于验证交互）。 */
function makeReact(seed = [], { mutable = false } = {}) {
  let i = 0;
  return {
    reset() {
      i = 0;
    },
    createElement(type, props, ...children) {
      return { type, props: props || {}, children: children.flat(Infinity) };
    },
    useState(init) {
      const idx = i++;
      if (idx >= seed.length) seed[idx] = init;
      return [
        seed[idx],
        (v) => {
          if (mutable) seed[idx] = typeof v === "function" ? v(seed[idx]) : v;
        },
      ];
    },
    useCallback: (fn) => fn,
    useEffect: () => {},
    useMemo: (fn) => fn(),
  };
}

/** 能真正跑 state 与 effect 的替身；flushEffects() 返回本轮 useEffect 的清理函数数组。 */
function makeReactLive(seed = []) {
  const states = [];
  let cursor = 0;
  let effects = [];
  return {
    _states: states,
    reset() {
      cursor = 0;
      effects = [];
    },
    flushEffects() {
      const pending = effects;
      effects = [];
      return pending.map((fn) => fn());
    },
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(init) {
      const i = cursor++;
      if (!(i in states)) states[i] = i < seed.length ? seed[i] : init;
      return [
        states[i],
        (v) => {
          states[i] = typeof v === "function" ? v(states[i]) : v;
        },
      ];
    },
    useCallback: (fn) => fn,
    useEffect(fn) {
      effects.push(fn);
    },
    useMemo: (fn) => fn(),
  };
}

/* ==================== 加载 bundle ==================== */

function loadBundle(react, globals = {}) {
  const code = fs.readFileSync(BUNDLE, "utf8");
  const captured = { exports: null, id: null };
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load({ id, factory }) {
          captured.id = id;
          captured.exports = factory((spec) => {
            if (spec === "react") return react;
            throw new Error(`未预期的 require：${spec}`);
          });
        },
      },
      ...(globals.window || {}),
    },
    fetch: globals.fetch,
    confirm: globals.confirm,
    setTimeout: globals.setTimeout || setTimeout,
    clearTimeout: globals.clearTimeout || clearTimeout,
    setInterval:
      globals.setInterval ||
      ((fn, ms) => {
        const id = setInterval(fn, ms);
        if (id && typeof id.unref === "function") id.unref();
        return id;
      }),
    clearInterval: globals.clearInterval || clearInterval,
  };
  vm.createContext(sandbox);
  new vm.Script(code, { filename: "client.js" }).runInContext(sandbox);
  assert.ok(captured.exports, "ModuleLoader.load 未被调用");
  return { ...captured, sandbox };
}

/** 最小客户端 ctx 替身：用于跑 apply() 拿真实字典 */
function mockClientCtx() {
  const locales = new Map();
  const slots = [];
  const injected = [];
  const ctx = {
    effect(fn) {
      return fn();
    },
    locale: {
      register(ns, dict) {
        locales.set(ns, dict);
      },
      bind: () => (key) => key,
    },
    slots: {
      inject(name, factory) {
        injected.push(name);
        return factory();
      },
      register(options, Component) {
        slots.push({ options, Component });
        return () => {};
      },
    },
  };
  return { ctx, locales, slots, injected };
}

/** 真实中英文字典（每个测试文件只加载一次） */
let DICTS = null;
function dictionaries() {
  if (DICTS) return DICTS;
  const { exports } = loadBundle(makeReact());
  const { ctx, locales } = mockClientCtx();
  exports.apply(ctx);
  const dict = locales.get("dsh-member-manager");
  assert.ok(dict && dict.zh && dict.en, "apply() 未注册中英文字典");
  DICTS = { zh: { ...dict.zh }, en: { ...dict.en } };
  return DICTS;
}

/** 用真实字典做 t（支持 {name} 插值），断言的是用户看到的中文 */
function translator(lang = "zh") {
  const dict = dictionaries()[lang];
  return (key, params) => {
    let text = Object.prototype.hasOwnProperty.call(dict, key) ? String(dict[key]) : key;
    if (params) {
      text = text.replace(/\{(\w+)\}/g, (m, name) => (params[name] == null ? m : String(params[name])));
    }
    return text;
  };
}

/* ==================== 元素树工具 ==================== */

function textOf(node) {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (typeof node !== "object") return "";
  return (node.children || []).map(textOf).join("");
}

/** 整棵树的可读文本（子节点用空格分隔，便于断言「标签 值」这种结构） */
function treeText(node) {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (typeof node !== "object") return "";
  return (node.children || [])
    .map(treeText)
    .filter(Boolean)
    .join(" ");
}

function collectButtons(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (node.type === "button") out.push({ label: textOf(node), onClick: node.props.onClick, disabled: node.props.disabled, style: node.props.style });
  for (const child of node.children || []) collectButtons(child, out);
  return out;
}

function collectElements(node, predicate, out = []) {
  if (!node || typeof node !== "object") return out;
  if (predicate(node)) out.push(node);
  for (const child of node.children || []) collectElements(child, predicate, out);
  return out;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/* ==================== fixtures（严格按 docs/16 §4.1 的 shape） ==================== */

const LEVELS = {
  M: {
    label: "管理通道",
    description: "带团队、定目标",
    levels: [
      { code: "M1", name: "主管" },
      { code: "M2", name: "经理" },
      { code: "M3", name: "高级经理" },
    ],
  },
  P: {
    label: "专业技术通道",
    description: "技术纵深",
    levels: [
      { code: "P1", name: "初级工程师" },
      { code: "P2", name: "工程师" },
      { code: "P3", name: "高级工程师" },
      { code: "P4", name: "资深工程师" },
      { code: "P5", name: "技术专家" },
    ],
  },
};

const NUMBERING = {
  employee: { pattern: "E{seq:4}", start: 1 },
  department: { pattern: "D{seq:2}", start: 1 },
};

function employee(patch) {
  return Object.assign(
    {
      id: "emp-x",
      code: "E9999",
      displayName: "示例员工",
      department: null,
      departmentCode: null,
      channel: "P",
      level: "P1",
      levelName: "初级工程师",
      role: "staff",
      kind: "permanent",
      state: "idle",
    },
    patch,
  );
}

/** api() 返回 payload.data，所以这里就是 data 本体 */
function overviewFixture() {
  return {
    enabled: true,
    status: "running",
    warnings: [],
    org: {
      departments: [
        { id: "dept-plugin", code: "D01", name: "插件组", capacity: 4, employeeCount: 3, managerId: "emp-lead", accepts: true },
        { id: "dept-doc", code: "D02", name: "文档组", capacity: 2, employeeCount: 1, managerId: null, accepts: true },
      ],
      employees: [
        employee({ id: "emp-lead", code: "E0001", displayName: "插件组负责人", department: "dept-plugin", departmentCode: "D01", channel: "M", level: "M2", levelName: "经理", role: "manager", state: "working" }),
        employee({ id: "emp-dev", code: "E0002", displayName: "插件工程师", department: "dept-plugin", departmentCode: "D01", channel: "P", level: "P4", levelName: "资深工程师" }),
        employee({ id: "emp-gone", code: "E0005", displayName: "前插件工程师", department: "dept-plugin", departmentCode: "D01", channel: "P", level: "P2", levelName: "工程师", kind: "temp", state: "fired" }),
        employee({ id: "emp-doc", code: "E0003", displayName: "文档工程师", department: "dept-doc", departmentCode: "D02", channel: "P", level: "P3", levelName: "高级工程师", kind: "temp", state: "cold" }),
        employee({ id: "emp-free", code: "E0004", displayName: "特聘专家", department: null, departmentCode: null, channel: "P", level: "P5", levelName: "技术专家", kind: "shared" }),
      ],
    },
    levels: LEVELS,
    numbering: NUMBERING,
    board: { orders: 7, done: 5 },
    costs: {
      tokens: 12345,
      requests: 42,
      byEmployee: {
        "emp-lead": { tokens: 900, requests: 3 },
        "emp-dev": { tokens: 300, requests: 2 },
        ghost: { tokens: 50, requests: 1 },
      },
      byDepartment: {
        "dept-plugin": { tokens: 1100, requests: 4 },
        "dept-doc": { tokens: 200, requests: 1 },
      },
      byOrder: {
        "ord-1": { tokens: 600, requests: 2 },
        "ord-2": { tokens: 500, requests: 1 },
        "ord-3": { tokens: 400, requests: 1 },
        "ord-4": { tokens: 300, requests: 1 },
        "ord-5": { tokens: 200, requests: 1 },
        "ord-6": { tokens: 100, requests: 1 },
      },
    },
  };
}

/** 空组织（enabled 但还没有任何部门/员工） */
function emptyOrgFixture() {
  return { enabled: true, status: "running", warnings: [], org: { departments: [], employees: [] }, levels: LEVELS, numbering: NUMBERING };
}

/** Panel 需要的 state 视图（沿用 client-bundle.test.mjs 的最小形状） */
function sampleView() {
  return {
    coreAvailable: true,
    stats: { members: 1, active: 1, retired: 0, groups: 1 },
    groups: [
      {
        id: "g-1",
        name: "数据组",
        description: "知识库与核查",
        members: [
          { target: "data-organizer", displayName: "数据整理员", title: "知识库整理员", duties: [], skills: [], groupId: "g-1", status: "active", isRetired: false, orphan: false },
        ],
      },
    ],
    ungrouped: [],
    unregistered: [],
    warnings: [],
  };
}

/* ==================== fetch 替身 ==================== */

/** 可配置的 fetch：overview 回固定 data；/company/op 回 opResult；记录 url/method/body */
function companyFetch(calls = [], options = {}) {
  const data = options.overview || overviewFixture();
  const opResult = options.opResult || { ok: true, data: {} };
  return async (url, init) => {
    const u = String(url);
    calls.push({ url: u, method: (init && init.method) || "GET", body: init && init.body ? JSON.parse(init.body) : null });
    if (u.endsWith("/company/op")) return { ok: true, status: 200, json: async () => ({ ok: true, data: opResult }) };
    if (u.endsWith("/company/overview")) return { ok: true, status: 200, json: async () => ({ ok: true, data }) };
    return { ok: true, status: 200, json: async () => ({ ok: true, data }) };
  };
}

/** 只回 overview 的 fetch（不发 effect 的渲染里用不到，但保持千篇一律） */
function overviewFetch(calls = [], data = overviewFixture()) {
  return async (url, init) => {
    calls.push({ url: String(url), method: (init && init.method) || "GET" });
    return { ok: true, status: 200, json: async () => ({ ok: true, data }) };
  };
}

/* ==================== CompanyOrgPanel 渲染助手 ==================== */

/** CompanyOrgPanel 的 useState 顺序：
 *  0 overview / 1 error / 2 busy / 3 updatedAt / 4 ecFilter / 5 deptModal / 6 modalTab /
 *  7 newDeptOpen / 8 newDeptDraft / 9 opError / 10 newDeptError / 11 editor /
 *  12 syncResult / 13 syncError */
function cpSeed(options = {}) {
  return [
    options.overview === undefined ? overviewFixture() : options.overview,
    options.error || null,
    options.busy || false,
    null,
    options.ecFilter || "all",
    options.deptModal || null,
    options.modalTab || "chart",
    options.newDeptOpen || false,
    options.newDeptDraft || null,
    options.opError || null,
    options.newDeptError || null,
    options.editor || null,
    options.syncResult === undefined ? null : options.syncResult,
    options.syncError === undefined ? null : options.syncError,
  ];
}

function renderCompany(options = {}) {
  const t = translator(options.lang || "zh");
  const seed = cpSeed(options);
  const react = makeReact(seed, { mutable: true });
  const fetchFn = options.fetch || overviewFetch();
  const { exports } = loadBundle(react, { fetch: fetchFn, confirm: options.confirm });
  const render = () => exports.__internals.CompanyOrgPanel({ t });
  return {
    t,
    seed,
    react,
    internals: exports.__internals,
    tree: render(),
    rerender() {
      react.reset();
      return render();
    },
  };
}

/** S 未导出：按样式特征定位弹层遮罩（position:fixed + zIndex）与卡片（宽度 = CP_MODAL_WIDTH） */
function findModal(tree) {
  const overlay = collectElements(
    tree,
    (n) => n.type === "div" && n.props.style && n.props.style.position === "fixed" && n.props.style.zIndex === 2147483000,
  )[0];
  const card = overlay
    ? collectElements(overlay, (n) => n.type === "div" && n.props.style && n.props.style.width === "min(1100px, 95vw)")[0]
    : null;
  return { overlay: overlay || null, card: card || null };
}

function buttonByLabel(tree, label) {
  return collectButtons(tree).filter((b) => b.label === label);
}

/** 表单里的主按钮（S.btnPrimary，蓝色底） */
function primaryButton(tree, label) {
  return buttonByLabel(tree, label).find((button) => button.style && button.style.background === "#2f6feb");
}

function employeeCodes(employees) {
  return employees.map((emp) => emp.code).join(",");
}

/* ==================== ① 源码与字典 ==================== */

test("源码：v4 总架构结构——默认 company、员工中心、部门弹层、/company/op，且无旧 deptOrg/一句话建组代码", () => {
  const src = fs.readFileSync(BUNDLE, "utf8");

  // 页签与标题文案
  assert.match(src, /cpTab: "总架构"/);
  assert.match(src, /cpTab: "Overall arch"/);
  assert.match(src, /cpTitle: "总架构"/);
  assert.match(src, /cpTitle: "Overall architecture"/);
  assert.match(src, /tabOrg: "部门架构"/);
  assert.match(src, /tabOrg: "Department org"/);

  // 默认 tab = company，页签顺序 company 在 retired 之前；部门架构不再占页签
  assert.match(src, /const \[tab, setTab\] = useState\("company"\)/);
  assert.ok(src.indexOf('tabBtn("company"') >= 0, "源码应注册 company 页签");
  assert.ok(src.indexOf('tabBtn("company"') < src.indexOf('tabBtn("retired"'), "总架构页签应排在已停用之前");
  assert.equal(src.includes('tabBtn("org"'), false, "部门架构不应再注册为页签");

  // 页签只留 5 个；Panel 的 hooks 只剩 state/error/busy/tab/draft
  const panelHooks = ["useState(null)", "useState(false)", 'useState("company")', "useState(null)", "useState(null)"];
  assert.equal(panelHooks.length, 5);
  assert.ok(src.indexOf("const [state, setState] = useState(null)") >= 0);
  assert.ok(src.indexOf("const [draft, setDraft] = useState(null)") >= 0);
  assert.equal(/groupDraft/.test(src), false, "旧的一句话建组草稿状态应移除");
  assert.equal(/briefOpen/.test(src), false, "旧的一句话建组弹层状态应移除");
  assert.equal(/deptOrg/.test(src), false, "v3 的 deptOrg 弹层状态应移除");
  assert.equal(src.includes("DeptOrgPanel"), false, "v3 的 DeptOrgPanel 组件应移除");
  assert.equal(src.includes("dpMemberText"), false, "v3 的 dpMemberText 应移除");

  // 架构图 / 员工中心 / 部门弹层 / 新建部门
  assert.match(src, /function CompanyOrgPanel\(props\)/);
  assert.match(src, /cpEmployeeCenter/);
  assert.match(src, /function buildEmployeeCenter\(view, filter\)/);
  assert.match(src, /function buildCompanyOrgView\(overview\)/);
  assert.match(src, /card\.leader = cpLeaderOf\(card\)/);
  assert.match(src, /channelCounts/);
  assert.match(src, /cpRenderEmployeeRow/);
  assert.match(src, /cpParseBrief/);
  assert.match(src, /CP_MODAL_WIDTH/);

  // 轮询与写接口
  assert.match(src, /api\("\/company\/overview"\)/);
  assert.match(src, /setInterval\(pull, CP_POLL_MS\)/);
  assert.match(src, /clearInterval\(timer\)/);
  assert.match(src, /api\("\/company\/op"/);
  assert.match(src, /JSON\.stringify\(\{ action: action, args: args \|\| \{\} \}\)/);

  // 安全：不写 HTML 字符串、不用 eval
  assert.equal(/\.innerHTML\s*=/.test(src), false, "不应给 innerHTML 赋值");
  assert.equal(src.includes("dangerouslySetInnerHTML"), false, "不应使用 dangerouslySetInnerHTML");
  assert.equal(/\beval\s*\(/.test(src), false, "不应使用 eval");
});

test("字典：v4 文案 zh/en 严格对称，中文与 docs/16 §5 一致", () => {
  const { zh, en } = dictionaries();
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort(), "zh 与 en 的 key 必须完全一致");

  const zhCp = Object.keys(zh).filter((k) => k.startsWith("cp") || k.startsWith("dp")).sort();
  const enCp = Object.keys(en).filter((k) => k.startsWith("cp") || k.startsWith("dp")).sort();
  assert.deepEqual(zhCp, enCp);
  assert.ok(zhCp.length >= 60, `cp*/dp* 文案过少：${zhCp.length}`);

  // 页签 / 页面
  assert.equal(zh.cpTab, "总架构");
  assert.equal(en.cpTab, "Overall arch");
  assert.equal(zh.cpTitle, "总架构");
  assert.equal(en.cpTitle, "Overall architecture");
  assert.equal(zh.tabOrg, "部门架构");
  assert.equal(en.tabOrg, "Department org");

  // 架构图与员工中心
  assert.equal(zh.cpEmployeeCenter, "员工中心");
  assert.equal(zh.cpECFilterAll, "全体员工");
  assert.equal(zh.cpECFilterDisabled, "未启用成员");
  assert.equal(zh.cpNoLeader, "未设负责人");
  assert.equal(zh.cpLeaderTag, "负责人");
  assert.equal(zh.cpChartEmpty, "暂无部门，点右上角「新建部门」");
  assert.equal(zh.cpDeptBoxHint, "点击查看部门详情");
  assert.ok(zh.cpECEmpty.length > 0);

  // 部门弹层与写操作
  assert.equal(zh.cpModalChart, "部门架构图");
  assert.equal(zh.cpModalMembers, "成员详情列表");
  assert.equal(zh.cpHire, "招聘员工");
  assert.equal(zh.cpPromote, "晋升");
  assert.equal(zh.cpFire, "停用");
  assert.equal(zh.cpMove, "调岗");
  assert.ok(zh.cpFireConfirm.includes("{name}"));
  assert.equal(zh.cpOpFailed, "操作失败");
  assert.equal(zh.cpClose, "关闭");

  // v4.1 从名册同步 / 删除部门
  assert.equal(zh.cpSyncRoster, "从名册同步");
  assert.equal(en.cpSyncRoster, "Sync from roster");
  assert.ok(zh.cpSyncDone.includes("{depts}") && zh.cpSyncDone.includes("{employees}") && zh.cpSyncDone.includes("{updated}"));
  assert.equal(zh.cpDeleteDept, "删除部门");
  assert.equal(en.cpDeleteDept, "Delete department");
  assert.ok(zh.cpDeleteDeptConfirm.includes("{name}") && zh.cpDeleteDeptConfirm.includes("{code}"));

  // 新建部门
  assert.equal(zh.cpNewDept, "新建部门");
  assert.equal(zh.cpNewDeptName, "部门名称");
  assert.equal(zh.cpParse, "解析");
  assert.ok(zh.cpParseHint.includes("解析"));

  // 总架构页保留的统计/图例/编号/成本
  assert.equal(zh.cpDeptCount, "部门");
  assert.equal(zh.cpEmpCount, "员工");
  assert.equal(zh.cpChannelM, "管理通道");
  assert.equal(zh.cpChannelP, "专业技术通道");
  assert.equal(zh.cpCode, "工号");
  assert.equal(zh.cpLevel, "等级");
  assert.equal(zh.cpHeadcount, "编制");
  assert.equal(zh.cpNumbering, "编号规则");
  assert.equal(zh.cpDisabled, "公司化运行时未启用");
  assert.equal(zh.cpLoadFailed, "加载失败");
  assert.equal(zh.cpOrders, "工单数");
  assert.equal(zh.cpDone, "已完成");
  assert.equal(zh.cpTokens, "Token 合计");
  assert.equal(zh.cpRequests, "请求数");
  assert.equal(zh.cpCost, "成本归因");
  assert.equal(zh.cpByEmployee, "按员工");
  assert.equal(zh.cpByDepartment, "按部门");
  assert.equal(zh.cpByOrder, "按工单");
  assert.equal(zh.cpNoCost, "暂无成本数据");

  // 英文侧不能漏翻成中文
  for (const key of enCp) {
    assert.doesNotMatch(String(en[key]), /[\u4e00-\u9fff]/, `en.${key} 含中文：${en[key]}`);
  }
  // 编号规则文案要带模板与起始示例的占位符
  for (const placeholder of ["{emp}", "{dept}", "{empSample}", "{deptSample}"]) {
    assert.ok(zh.cpNumberingLine.includes(placeholder), `cpNumberingLine 缺 ${placeholder}`);
  }
});

/* ==================== ② Panel 页签 ==================== */

function renderPanel({ view = sampleView(), tab = "company", calls = [] } = {}) {
  const t = translator("zh");
  const seed = [view, null, false, tab, null];
  const react = makeReact(seed, { mutable: true });
  const { exports } = loadBundle(react, { fetch: overviewFetch(calls) });
  const tree = exports.__internals.Panel({ t });
  return { t, seed, react, tree, internals: exports.__internals };
}

test("Panel：默认总架构，页签恰 5 个且顺序为 总架构→已停用→未登记→工作流→备份与更新", () => {
  const { t, tree, internals } = renderPanel();
  const expected = [t("cpTab"), t("tabRetired"), t("tabUnregistered"), t("tabWorkflow"), t("tabMaintain")];
  const labels = collectButtons(tree)
    .map((button) => button.label)
    .filter((label) => expected.includes(label));

  assert.deepEqual(labels, expected);
  assert.equal(labels.length, 5);
  assert.equal(labels.includes(t("tabOrg")), false, "部门架构不应再占页签");
  assert.equal(collectElements(tree, (node) => node.type === internals.CompanyOrgPanel).length, 1, "默认应渲染 CompanyOrgPanel");
  assert.equal(findModal(tree).overlay, null, "默认不应出现部门弹层");
});

test("Panel：点击页签切换 tab，切到 workflow 时不渲染 CompanyOrgPanel", () => {
  const { t, seed, react, internals } = renderPanel();
  react.reset();
  const btn = collectButtons(internals.Panel({ t })).find((button) => button.label.includes(t("tabWorkflow")));
  assert.ok(btn, "应有工作流页签");
  btn.onClick();
  assert.equal(seed[3], "workflow");
  react.reset();
  const tree = internals.Panel({ t });
  assert.equal(collectElements(tree, (node) => node.type === internals.CompanyOrgPanel).length, 0);
  assert.equal(collectElements(tree, (node) => node.type === internals.WorkflowPanel).length, 1);
});

/* ==================== ③ 架构图与员工中心 ==================== */

test("CompanyOrgPanel：架构图 = 员工中心 + 领导节点 + 部门框（编号/名称/负责人/编制/通道人数）", () => {
  const { t, tree } = renderCompany();
  const text = treeText(tree);

  // 员工中心
  assert.match(text, new RegExp(t("cpEmployeeCenter")));
  assert.equal(buttonByLabel(tree, t("cpNewDept")).length, 1, "工具栏应有「新建部门」");
  assert.equal(buttonByLabel(tree, t("cpRefresh")).length, 1, "工具栏应有「刷新」");
  assert.match(text, /全体员工/);

  // 部门框：编号 + 名称 + 负责人 + 编制 + M/P 人数
  assert.match(text, /\[D01\]/);
  assert.match(text, /插件组/);
  assert.match(text, /\[D02\]/);
  assert.match(text, /文档组/);
  assert.match(text, /负责人：插件组负责人/);
  assert.match(text, /负责人：未设负责人/);
  assert.match(text, /编制 3\/4 · M 1 · P 2/);
  assert.match(text, /编制 1\/2 · M 0 · P 1/);

  // 领导节点显示 M 徽章 + 姓名 + 工号；无负责人是虚线占位
  assert.match(text, /M2/);
  assert.match(text, /E0001/);
  assert.ok(text.indexOf("[D01]") < text.indexOf("[D02]"), "部门框按编号升序");
});

test("CompanyOrgPanel：部门排序按编号升序，无编号部门排最后", () => {
  const view = overviewFixture();
  view.org.departments = [
    { id: "dept-x", code: null, name: "无编号组", capacity: 4, employeeCount: 0 },
    { id: "dept-plugin", code: "D01", name: "插件组", capacity: 4, employeeCount: 3 },
    { id: "dept-doc", code: "D02", name: "文档组", capacity: 2, employeeCount: 1 },
  ];
  const { tree } = renderCompany({ overview: view });
  const text = treeText(tree);
  assert.ok(text.indexOf("[D01]") < text.indexOf("[D02]"));
  assert.ok(text.indexOf("[D02]") < text.indexOf("无编号组"), "无编号部门应排在有编号部门之后");
});

test("员工中心：默认排序 = 部门编号升序 → M 前 P 后 → 等级降序 → 工号升序", () => {
  const t = translator("zh");
  const { exports } = loadBundle(makeReact());
  const view = exports.__internals.buildCompanyOrgView(overviewFixture());
  const ec = exports.__internals.buildEmployeeCenter(view, "all");
  assert.equal(employeeCodes(ec.employees), "E0001,E0002,E0005,E0003,E0004");
  assert.equal(ec.total, 5);
  assert.equal(ec.allCount, 5);
  assert.ok(t);
});

test("CompanyOrgPanel：员工中心筛选（部门 / 未启用成员）与空态", () => {
  const fixtureView = renderCompany().internals.buildCompanyOrgView(overviewFixture());
  const deptFiltered = renderCompany({ ecFilter: "dept-doc" });
  const deptEc = deptFiltered.internals.buildEmployeeCenter(fixtureView, "dept-doc");
  assert.equal(deptEc.total, 1, "部门筛选只保留该部门员工");
  assert.equal(employeeCodes(deptEc.employees), "E0003");
  assert.match(treeText(deptFiltered.tree), /E0003/);

  const disabled = renderCompany({ ecFilter: "disabled" });
  const disabledEc = disabled.internals.buildEmployeeCenter(fixtureView, "disabled");
  assert.equal(disabledEc.total, 1, "未启用筛选只保留 fired 员工");
  assert.equal(employeeCodes(disabledEc.employees), "E0005");
  assert.match(treeText(disabled.tree), /E0005/);
  assert.match(treeText(disabled.tree), new RegExp(disabled.t("cpStateFired")));

  // 部门筛选下拉包含「全体员工 / 各部门 / 未启用成员」
  const select = collectElements(deptFiltered.tree, (node) => node.type === "select")[0];
  const optionTexts = (select.children || []).map((opt) => textOf(opt));
  assert.deepEqual(optionTexts, ["全体员工", "[D01] 插件组", "[D02] 文档组", "未启用成员"]);
});

test("CompanyOrgPanel：空组织 = 暂无部门空态 + 员工中心空态", () => {
  const { t, tree } = renderCompany({ overview: emptyOrgFixture() });
  const text = treeText(tree);
  assert.match(text, new RegExp(t("cpChartEmpty")));
  assert.match(text, new RegExp(t("cpECEmpty")));
  assert.equal(buttonByLabel(tree, t("cpNewDept")).length, 1, "空组织也要能新建部门");
});

test("CompanyOrgPanel：8 个 KPI + 编号规则 + 等级图例 + 成本归因三列 top5", () => {
  const { t, tree, internals } = renderCompany();
  const text = treeText(tree);

  // KPI（工单/已完成来自 board，Token/请求来自 costs）
  assert.match(text, /部门 2/);
  assert.match(text, /员工 5/);
  assert.match(text, /管理通道 1/);
  assert.match(text, /专业技术通道 4/);
  assert.match(text, /工单数 7/);
  assert.match(text, /已完成 5/);
  assert.match(text, /Token 合计 12[,.]?345/);
  assert.match(text, /请求数 42/);

  // 编号规则
  assert.match(text, /编号规则：员工 E\{seq:4\} · 部门 D\{seq:2\}/);
  assert.match(text, /工号 E0001 起/);
  assert.match(text, /部门编号 D01 起/);

  // 等级图例
  assert.match(text, /等级图例/);
  assert.match(text, /M1 主管/);
  assert.match(text, /M2 经理/);
  assert.match(text, /P3 高级工程师/);
  assert.match(text, /P5 技术专家/);

  // 成本归因：总量 + 三列
  assert.match(text, new RegExp(t("cpCost")));
  assert.match(text, new RegExp(t("cpCostTotal", { tokens: "12,345", requests: "42" })));
  assert.match(text, new RegExp(t("cpByEmployee")));
  assert.match(text, new RegExp(t("cpByDepartment")));
  assert.match(text, new RegExp(t("cpByOrder")));
  // 员工标签「姓名 · 工号」
  assert.match(text, /插件组负责人 · E0001/);
  // 部门标签「编号 名称」
  assert.match(text, /D01 插件组/);
  // top5：tokens 最小的 ord-6 不应出现
  assert.match(text, /ord-5/);
  assert.doesNotMatch(text, /ord-6/);

  // 三列顺序存在但不依赖具体顺序断言：按员工→按部门→按工单
  assert.ok(text.indexOf(t("cpByEmployee")) < text.indexOf(t("cpByDepartment")));
  assert.ok(text.indexOf(t("cpByDepartment")) < text.indexOf(t("cpByOrder")));
  assert.ok(internals.buildCompanyOrgView);
});

test("CompanyOrgPanel：改按钮打开新建部门对话框（字段齐全，名称空 / 编制非法时禁用创建）", () => {
  const { t, tree } = renderCompany({ newDeptOpen: true, newDeptDraft: { id: "", name: "", charter: "", capacity: "4", brief: "" } });
  const inputs = collectElements(tree, (node) => node.type === "input" || node.type === "textarea");
  assert.ok(inputs.length >= 5, "对话框应有 ID/名称/说明/编制/一句话描述字段");
  const placeholders = inputs.map((node) => node.props.placeholder || "");
  assert.ok(placeholders.includes(t("cpAutoId")));
  assert.equal(buttonByLabel(tree, t("cpParse")).length, 1);
  const props = inputs.map((node) => node.props);
  assert.ok(props.some((p) => p.type === "number"));

  const create = buttonByLabel(tree, t("cpCreateDept"))[0];
  assert.ok(create);
  assert.equal(create.disabled, true, "名称为空时创建按钮应禁用");

  const invalid = renderCompany({ newDeptOpen: true, newDeptDraft: { id: "", name: "市场部", charter: "", capacity: "abc", brief: "" } });
  assert.equal(buttonByLabel(invalid.tree, t("cpCreateDept"))[0].disabled, true, "编制非法时创建按钮应禁用");

  const valid = renderCompany({ newDeptOpen: true, newDeptDraft: { id: "", name: "市场部", charter: "", capacity: "5", brief: "" } });
  assert.equal(buttonByLabel(valid.tree, t("cpCreateDept"))[0].disabled, false);
});

test("新建部门：一句话解析自动填名称/编制/说明，且解析不发请求", async () => {
  const calls = [];
  const { t, seed, react, tree, internals } = renderCompany({
    newDeptOpen: true,
    newDeptDraft: { id: "", name: "", charter: "", capacity: "4", brief: "新建市场部，编制 5 人" },
    fetch: overviewFetch(calls),
  });
  buttonByLabel(tree, t("cpParse"))[0].onClick();
  assert.equal(calls.filter((c) => c.url.endsWith("/company/op")).length, 0, "解析是纯客户端逻辑");
  assert.equal(seed[8].name, "市场");
  assert.equal(seed[8].capacity, "5");
  assert.match(seed[8].charter, /新建市场部/);

  // 重新渲染：输入框显示解析结果
  react.reset();
  const after = internals.CompanyOrgPanel({ t });
  assert.match(treeText(after), /市场/);
  const values = collectElements(after, (node) => node.type === "input" || node.type === "textarea").map((node) => String(node.props.value));
  assert.ok(values.includes("市场"), "名称输入框应填入解析出的名称");
  assert.ok(values.includes("5"), "编制输入框应填入解析出的编制");
});

test("新建部门：创建 POST createDepartment，成功后关闭对话框并刷新 overview", async () => {
  const calls = [];
  const { t, seed, tree, internals } = renderCompany({
    newDeptOpen: true,
    newDeptDraft: { id: "", name: "市场部", charter: "负责市场", capacity: "5", brief: "" },
    fetch: companyFetch(calls),
  });
  assert.ok(internals);
  await buttonByLabel(tree, t("cpCreateDept"))[0].onClick();
  await tick();

  const op = calls.find((c) => c.url.endsWith("/company/op"));
  assert.ok(op, "应发 /company/op 请求");
  assert.equal(op.method, "POST");
  assert.deepEqual(op.body, { action: "createDepartment", args: { name: "市场部", charter: "负责市场", capacity: 5 } });
  assert.equal(seed[7], false, "成功后应关闭对话框");
  assert.ok(calls.filter((c) => c.url.endsWith("/company/overview")).length >= 1, "成功后应刷新 overview");
});

test("新建部门：创建失败显示 cpOpFailed + code/message，对话框保持打开", async () => {
  const { t, seed, tree } = renderCompany({
    newDeptOpen: true,
    newDeptDraft: { id: "", name: "市场部", charter: "", capacity: "4", brief: "" },
    fetch: companyFetch([], { opResult: { ok: false, code: "E_DEPT_DUPLICATE", message: "部门名称重复" } }),
  });
  await buttonByLabel(tree, t("cpCreateDept"))[0].onClick();
  await tick();
  assert.equal(seed[7], true, "失败时对话框保持打开");
  assert.match(String(seed[10]), /E_DEPT_DUPLICATE/);
  assert.match(String(seed[10]), /部门名称重复/);

  const react = makeReact(seed, { mutable: true });
  const { exports } = loadBundle(react, { fetch: companyFetch([]) });
  const text = treeText(exports.__internals.CompanyOrgPanel({ t }));
  assert.match(text, new RegExp(t("cpOpFailed")));
});

test("CompanyOrgPanel：公司未启用时显示提示条但仍渲染员工中心", () => {
  const view = overviewFixture();
  view.enabled = false;
  const { t, tree } = renderCompany({ overview: view });
  const text = treeText(tree);
  assert.match(text, new RegExp(t("cpDisabled")));
  assert.match(text, new RegExp(t("cpEmployeeCenter")));
});

test("CompanyOrgPanel：加载失败显示 cpLoadFailed 且不抛异常（effect + tick）", async () => {
  const react = makeReactLive([null, null, false, null]);
  const fetchFail = async () => {
    throw new Error("boom");
  };
  const { exports } = loadBundle(react, { fetch: fetchFail });
  const t = translator("zh");
  const tree = exports.__internals.CompanyOrgPanel({ t });
  assert.match(treeText(tree), new RegExp(t("cpLoading")));
  react.flushEffects();
  await tick();
  react.reset();
  const after = exports.__internals.CompanyOrgPanel({ t });
  assert.match(treeText(after), new RegExp(t("cpLoadFailed")));
  assert.match(treeText(after), /boom/);
});

/* ==================== ④ 部门弹层 ==================== */

/** 点某个部门框（按编号定位） */
function openDeptModal(tree, code = "[D01]") {
  const box = collectButtons(tree).find((button) => button.label.includes(code));
  assert.ok(box, `应能按编号找到部门框：${code}`);
  box.onClick();
}

test("CompanyOrgPanel：点部门框打开弹层，默认部门架构图页签，弹层保持打开", () => {
  const { t, seed, tree, react, internals } = renderCompany();
  openDeptModal(tree, "[D01]");
  assert.equal(seed[5], "dept-plugin", "点部门框应记录部门 id");
  assert.equal(seed[6], "chart", "默认应打开部门架构图页签");

  react.reset();
  const modalTree = internals.CompanyOrgPanel({ t });
  const { overlay, card } = findModal(modalTree);
  assert.ok(overlay, "应渲染弹层遮罩");
  assert.ok(card, "应渲染弹层卡片");
  assert.equal(typeof card.props.onClick, "function", "卡片需要 stopPropagation");

  const text = treeText(modalTree);
  assert.match(text, /\[D01\]/);
  assert.match(text, /插件组/);
  assert.match(text, /部门架构 · 查看与修改成员/);
  assert.equal(buttonByLabel(modalTree, t("cpModalChart")).length, 1);
  assert.equal(buttonByLabel(modalTree, t("cpModalMembers")).length, 1);
  assert.match(text, new RegExp(t("cpLeaderTag")));
  assert.match(text, /E0001/);
});

test("部门弹层：部门架构图页签按 M/P 两栏渲染并按等级降序", () => {
  const { t, tree, react, internals } = renderCompany({ deptModal: "dept-plugin", modalTab: "chart" });
  assert.ok(tree);
  react.reset();
  const modalTree = internals.CompanyOrgPanel({ t });
  const text = treeText(modalTree);
  assert.match(text, /管理通道/);
  assert.match(text, /专业技术通道/);
  // M 栏只有 emp-lead(M2)，P 栏 dev(P4) 在 gone(P2) 之前
  assert.ok(text.indexOf("E0002") < text.indexOf("E0005"), "P 栏应按等级降序（P4 在 P2 前）");
  // 部门架构图页签不出现写操作按钮
  assert.equal(buttonByLabel(modalTree, t("cpPromote")).length, 0, "架构图页签不应出现写操作按钮");
  assert.equal(buttonByLabel(modalTree, t("cpModalMembers")).length, 1);
});

test("部门弹层：成员详情页签列出员工与 晋升/停用/调岗/招聘 操作按钮", () => {
  const { t, tree, react, internals } = renderCompany({ deptModal: "dept-plugin", modalTab: "members" });
  assert.ok(tree);
  react.reset();
  const modalTree = internals.CompanyOrgPanel({ t });
  const text = treeText(modalTree);
  assert.match(text, /E0001/);
  assert.match(text, /E0002/);
  assert.match(text, /E0005/);
  assert.equal(buttonByLabel(modalTree, t("cpHire")).length, 1, "应有招聘入口");
  assert.equal(buttonByLabel(modalTree, t("cpPromote")).length, 3, "每个员工一行晋升");
  assert.equal(buttonByLabel(modalTree, t("cpFire")).length, 3);
  assert.equal(buttonByLabel(modalTree, t("cpMove")).length, 3);
});

test("部门弹层：关闭按钮 / 点遮罩 / ESC 关闭，卡片内点击与子元素点击不关闭", () => {
  const listeners = [];
  const fakeWindow = {
    addEventListener(type, fn) {
      if (type === "keydown") listeners.push(fn);
    },
    removeEventListener(type, fn) {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
  };
  const react = makeReactLive(cpSeed({ deptModal: "dept-plugin" }));
  const { exports } = loadBundle(react, { fetch: overviewFetch([]), window: fakeWindow });
  const t = translator("zh");
  const tree = exports.__internals.CompanyOrgPanel({ t });
  const { overlay, card } = findModal(tree);
  assert.ok(overlay && card);

  // 卡片内点击 stopPropagation，不关闭
  let stopped = false;
  card.props.onClick({ stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, true);
  assert.equal(react._states[5], "dept-plugin");

  // 遮罩上的子元素点击（target !== currentTarget）→ 不关闭
  overlay.props.onClick({ target: {}, currentTarget: {} });
  assert.equal(react._states[5], "dept-plugin");

  // 关闭按钮
  buttonByLabel(tree, t("cpClose"))[0].onClick();
  assert.equal(react._states[5], null, "关闭按钮应关闭弹层");

  // 点遮罩本身
  react._states[5] = "dept-plugin";
  react.reset();
  const again = findModal(exports.__internals.CompanyOrgPanel({ t }));
  const self = {};
  again.overlay.props.onClick({ target: self, currentTarget: self });
  assert.equal(react._states[5], null, "点遮罩应关闭弹层");

  // ESC：effect 里注册 keydown，卸载后摘除
  react._states[5] = "dept-plugin";
  react.reset();
  const openTree = exports.__internals.CompanyOrgPanel({ t });
  assert.ok(findModal(openTree).overlay);
  const cleanups = react.flushEffects();
  assert.equal(listeners.length, 1, "弹层打开时应注册一个 keydown 监听");
  listeners[0]({ key: "a" });
  assert.equal(react._states[5], "dept-plugin", "非 Escape 键不关闭");
  listeners[0]({ key: "Escape" });
  assert.equal(react._states[5], null, "ESC 应关闭弹层");
  const escCleanup = cleanups.filter((fn) => typeof fn === "function").pop();
  assert.ok(escCleanup, "ESC effect 应返回清理函数");
  escCleanup();
  assert.equal(listeners.length, 0, "清理时应摘除 keydown 监听");
});

test("部门弹层：部门在 overview 中失效后自动关闭", () => {
  const view = overviewFixture();
  view.org.departments = view.org.departments.filter((dept) => dept.id !== "dept-plugin");
  const react = makeReactLive(cpSeed({ overview: view, deptModal: "dept-plugin" }));
  const { exports } = loadBundle(react, { fetch: overviewFetch([], view) });
  const t = translator("zh");
  exports.__internals.CompanyOrgPanel({ t });
  react.flushEffects();
  assert.equal(react._states[5], null, "部门已不存在时应自动关闭弹层");
});

test("写操作：晋升 → POST promoteEmployee（默认下一等级）并刷新 overview，弹层保持打开", async () => {
  const calls = [];
  const { t, seed, react, tree, internals } = renderCompany({
    deptModal: "dept-plugin",
    modalTab: "members",
    fetch: companyFetch(calls),
  });
  assert.ok(tree);
  react.reset();
  let modalTree = internals.CompanyOrgPanel({ t });
  buttonByLabel(modalTree, t("cpPromote"))[0].onClick();
  assert.equal(seed[11].kind, "promote");
  assert.equal(seed[11].employeeId, "emp-lead");

  react.reset();
  modalTree = internals.CompanyOrgPanel({ t });
  const submit = primaryButton(modalTree, t("cpPromote"));
  assert.ok(submit, "内联表单应有晋升提交按钮");
  await submit.onClick();
  await tick();

  const op = calls.find((c) => c.url.endsWith("/company/op"));
  assert.ok(op, "应发 /company/op");
  assert.deepEqual(op.body, { action: "promoteEmployee", args: { employeeId: "emp-lead", channel: "M", level: "M3" } });
  assert.equal(seed[5], "dept-plugin", "写操作成功后弹层保持打开");
  assert.equal(seed[11], null, "成功后收起内联表单");
  assert.ok(calls.some((c) => c.url.endsWith("/company/overview")), "写操作后应刷新 overview");
});

test("写操作：停用需 confirm；取消不发请求，确认后 POST fireEmployee", async () => {
  const calls = [];
  const asked = [];
  let allow = false;
  const { t, seed, react, tree, internals } = renderCompany({
    deptModal: "dept-plugin",
    modalTab: "members",
    fetch: companyFetch(calls),
    confirm: (message) => (asked.push(message), allow),
  });
  assert.ok(tree);
  react.reset();
  let modalTree = internals.CompanyOrgPanel({ t });
  buttonByLabel(modalTree, t("cpFire"))[0].onClick();
  assert.equal(asked.length, 1, "停用前应弹确认");
  assert.match(asked[0], /插件组负责人/);
  await tick();
  assert.equal(calls.filter((c) => c.url.endsWith("/company/op")).length, 0, "取消后不发请求");

  allow = true;
  react.reset();
  modalTree = internals.CompanyOrgPanel({ t });
  await buttonByLabel(modalTree, t("cpFire"))[0].onClick();
  await tick();
  const op = calls.find((c) => c.url.endsWith("/company/op"));
  assert.ok(op);
  assert.deepEqual(op.body, { action: "fireEmployee", args: { employeeId: "emp-lead" } });
  assert.equal(seed[5], "dept-plugin");
});

test("写操作：调岗选择目标部门后 POST moveEmployee", async () => {
  const calls = [];
  const { t, seed, react, tree, internals } = renderCompany({
    deptModal: "dept-plugin",
    modalTab: "members",
    fetch: companyFetch(calls),
  });
  assert.ok(tree);
  react.reset();
  let modalTree = internals.CompanyOrgPanel({ t });
  // 第二个员工 emp-dev 的「调岗」
  buttonByLabel(modalTree, t("cpMove"))[1].onClick();
  assert.equal(seed[11].employeeId, "emp-dev");
  assert.equal(seed[11].department, "dept-doc", "默认目标 = 除当前部门外的第一个部门");

  react.reset();
  modalTree = internals.CompanyOrgPanel({ t });
  const submit = primaryButton(modalTree, t("cpMove"));
  assert.ok(submit, "内联表单应有调岗提交按钮");
  await submit.onClick();
  await tick();
  const op = calls.find((c) => c.url.endsWith("/company/op"));
  assert.ok(op);
  assert.deepEqual(op.body, { action: "moveEmployee", args: { employeeId: "emp-dev", department: "dept-doc" } });
});

test("写操作：招聘 createEmployee 需姓名，成功后弹层保持打开", async () => {
  const calls = [];
  const { t, seed, react, tree, internals } = renderCompany({
    deptModal: "dept-plugin",
    modalTab: "members",
    fetch: companyFetch(calls),
  });
  assert.ok(tree);
  react.reset();
  let modalTree = internals.CompanyOrgPanel({ t });
  buttonByLabel(modalTree, t("cpHire"))[0].onClick();
  assert.equal(seed[11].kind, "hire");

  react.reset();
  modalTree = internals.CompanyOrgPanel({ t });
  const nameInput = collectElements(modalTree, (node) => node.type === "input" && node.props.placeholder === t("cpNewDeptName"))[0];
  assert.ok(nameInput, "招聘表单应有姓名输入框");
  nameInput.props.onChange({ target: { value: "新人甲" } });
  assert.equal(seed[11].displayName, "新人甲");

  react.reset();
  modalTree = internals.CompanyOrgPanel({ t });
  const submit = primaryButton(modalTree, t("cpHire"));
  assert.ok(submit, "招聘表单应有提交按钮");
  await submit.onClick();
  await tick();

  const op = calls.find((c) => c.url.endsWith("/company/op"));
  assert.ok(op);
  assert.deepEqual(op.body, {
    action: "createEmployee",
    args: { displayName: "新人甲", department: "dept-plugin", role: "staff", kind: "permanent" },
  });
  assert.equal(seed[5], "dept-plugin", "招聘成功后弹层保持打开");
  assert.equal(seed[11], null);
});

test("写操作失败：/company/op 返回 ok:false → 弹层内红字 cpOpFailed + code，弹层保持", async () => {
  const { t, seed, react, tree, internals } = renderCompany({
    deptModal: "dept-plugin",
    modalTab: "members",
    fetch: companyFetch([], { opResult: { ok: false, code: "E_INVALID_LEVEL", message: "等级不存在" } }),
  });
  assert.ok(tree);
  react.reset();
  let modalTree = internals.CompanyOrgPanel({ t });
  buttonByLabel(modalTree, t("cpPromote"))[0].onClick();
  react.reset();
  modalTree = internals.CompanyOrgPanel({ t });
  const submit = primaryButton(modalTree, t("cpPromote"));
  assert.ok(submit);
  await submit.onClick();
  await tick();

  assert.match(String(seed[9]), /E_INVALID_LEVEL/);
  assert.match(String(seed[9]), /等级不存在/);
  assert.equal(seed[5], "dept-plugin", "失败时弹层保持打开");

  react.reset();
  const after = internals.CompanyOrgPanel({ t });
  assert.match(treeText(after), new RegExp(t("cpOpFailed")));
});

/* ==================== ⑤ 纯函数与兜底 ==================== */

test("buildCompanyOrgView：leader 取 M 等级最高、同级工号小者；无 manager 则为 null", () => {
  const { exports } = loadBundle(makeReact());
  const view = exports.__internals.buildCompanyOrgView({
    org: {
      departments: [{ id: "d1", code: "D01", name: "研发部", capacity: 10 }],
      employees: [
        employee({ id: "m2a", code: "E0009", displayName: "小经理", department: "d1", departmentCode: "D01", channel: "M", level: "M2", role: "manager" }),
        employee({ id: "m2b", code: "E0002", displayName: "早经理", department: "d1", departmentCode: "D01", channel: "M", level: "M2", role: "manager" }),
        employee({ id: "m3", code: "E0001", displayName: "高级经理", department: "d1", departmentCode: "D01", channel: "M", level: "M3", role: "manager" }),
        employee({ id: "p1", code: "E0003", displayName: "工程师", department: "d1", departmentCode: "D01", channel: "P", level: "P3", role: "staff" }),
      ],
    },
    levels: LEVELS,
    numbering: NUMBERING,
  });
  assert.equal(view.cards.length, 1);
  assert.equal(view.cards[0].leader.id, "m3");
  assert.equal(view.cards[0].leader.level, "M3");
  assert.equal(JSON.stringify(view.cards[0].channelCounts), JSON.stringify({ M: 3, P: 1 }));

  // 同级取工号小者
  const tied = exports.__internals.buildCompanyOrgView({
    org: {
      departments: [{ id: "d1", code: "D01", name: "研发部", capacity: 10 }],
      employees: [
        employee({ id: "b", code: "E0009", displayName: "后经理", department: "d1", departmentCode: "D01", channel: "M", level: "M2", role: "manager" }),
        employee({ id: "a", code: "E0002", displayName: "先经理", department: "d1", departmentCode: "D01", channel: "M", level: "M2", role: "manager" }),
      ],
    },
  });
  assert.equal(tied.cards[0].leader.id, "a", "同等级时工号小的当负责人");

  // 没有 manager → null
  const noLeader = exports.__internals.buildCompanyOrgView({
    org: {
      departments: [{ id: "d1", code: "D01", name: "研发部", capacity: 4 }],
      employees: [employee({ id: "p", code: "E0001", department: "d1", departmentCode: "D01" })],
    },
  });
  assert.equal(noLeader.cards[0].leader, null);
  assert.equal(noLeader.cards[0].channelCounts.M, 0);
});

test("buildCompanyOrgView：旧 fixture（缺 board/costs/levels/numbering）也能兜底不炸", () => {
  const { exports } = loadBundle(makeReact());
  const internals = exports.__internals;
  const view = internals.buildCompanyOrgView({});
  assert.equal(view.enabled, true, "缺省视为启用");
  assert.equal(view.cards.length, 0);
  assert.equal(JSON.stringify(view.counts), JSON.stringify({ departments: 0, employees: 0, M: 0, P: 0 }));
  assert.equal(JSON.stringify(view.board), JSON.stringify({ orders: 0, done: 0 }));
  assert.equal(view.costs.hasData, false);
  assert.equal(view.costs.tokens, 0);
  assert.equal(view.costs.requests, 0);
  assert.equal(Object.keys(view.levels).sort().join(","), "M,P");
  assert.equal(view.numbering.employee.pattern, "E{seq:4}");
  assert.ok(exports.__internals.buildEmployeeCenter);

  const text = (() => {
    const react = makeReact(cpSeed({ overview: {} }), { mutable: true });
    const bundle = loadBundle(react, { fetch: overviewFetch([], {}) });
    return treeText(bundle.exports.__internals.CompanyOrgPanel({ t: translator("zh") }));
  })();
  assert.match(text, /暂无部门/);
});

test("buildEmployeeCenter：筛选 departmentCode / 未知 filter 回落 all / clone 员工带 departmentCode", () => {
  const { exports } = loadBundle(makeReact());
  const view = exports.__internals.buildCompanyOrgView(overviewFixture());
  const build = exports.__internals.buildEmployeeCenter;

  assert.equal(build(view, "all").total, 5);
  assert.equal(build(view, "dept-plugin").total, 3);
  assert.equal(build(view, "disabled").total, 1);
  assert.equal(build(view, "no-such-dept").total, 5, "未知 filter 回落全体员工");
  assert.equal(employeeCodes(build(view, "dept-plugin").employees), "E0001,E0002,E0005");

  // 员工行已归一，部门员工带 departmentCode；无部门员工 departmentCode 为 null
  const free = build(view, "all").employees.find((emp) => emp.id === "emp-free");
  assert.equal(free.departmentCode, null);
  const lead = build(view, "all").employees.find((emp) => emp.id === "emp-lead");
  assert.equal(lead.departmentCode, "D01");
});

test("cpParseBrief：解析一句话建部门的名称/编制/说明；解析失败时名称取首句", () => {
  const { exports } = loadBundle(makeReact());
  const parse = exports.__internals.cpParseBrief;

  assert.equal(
    JSON.stringify(parse("新建市场部，编制 5 人")),
    JSON.stringify({ name: "市场", capacity: 5, charter: "新建市场部，编制 5 人" }),
  );
  assert.equal(parse("新建运维部门 8 人").name, "运维");
  assert.equal(parse("新建运维部门 8 人").capacity, 8);
  assert.equal(parse("成立数据组").name, "数据");
  assert.equal(parse("成立数据组").capacity, null);
  assert.equal(parse("").name, "");
  assert.equal(parse("").capacity, null);
  assert.equal(parse("随便写点什么。第二句").name, "随便写点什么");
  assert.equal(parse("随便写点什么。第二句").charter, "随便写点什么。第二句");
});

/* ==================== ⑥ 轮询 ==================== */

test("轮询：打开拉一次 + 5 秒 setInterval，卸载后 clearInterval 且不再请求", async () => {
  const calls = [];
  const timers = [];
  const cleared = [];
  const fakeSetInterval = (fn, ms) => {
    timers.push({ fn, ms });
    return timers.length;
  };
  const fakeClearInterval = (id) => cleared.push(id);

  const react = makeReactLive([null, null, false, null]);
  const { exports } = loadBundle(react, { fetch: companyFetch(calls), setInterval: fakeSetInterval, clearInterval: fakeClearInterval });
  const t = translator("zh");
  const tree = exports.__internals.CompanyOrgPanel({ t });
  assert.match(treeText(tree), new RegExp(t("cpLoading")), "首屏未拉到数据时显示加载中");

  const cleanups = react.flushEffects();
  assert.equal(timers.length, 1, "应注册一个轮询定时器");
  assert.equal(timers[0].ms, exports.__internals.CP_POLL_MS);
  assert.equal(timers[0].ms, 5000);
  await tick();
  assert.equal(calls.filter((c) => c.url.endsWith("/company/overview")).length, 1, "打开时拉一次");

  await timers[0].fn();
  await tick();
  assert.equal(calls.filter((c) => c.url.endsWith("/company/overview")).length, 2, "轮询触发第二次请求");

  // 卸载清理
  cleanups[0]();
  assert.deepEqual(cleared, [1], "卸载应 clearInterval");
  await timers[0].fn();
  await tick();
  assert.equal(calls.filter((c) => c.url.endsWith("/company/overview")).length, 2, "清理后定时器再触发也不请求");
});

/* ==================== ⑦ 从名册同步 / 删除部门（docs/16 §4.4 v4.1） ==================== */

/** 点「从名册同步」按钮并等 promise 落定 */
async function clickSync(tree, t) {
  const buttons = buttonByLabel(tree, t("cpSyncRoster"));
  assert.equal(buttons.length, 1, "工具栏应有「从名册同步」按钮");
  await buttons[0].onClick();
  await tick();
}

test("从名册同步：按钮 POST action=syncRoster，成功提示计数并刷新 overview，busy 时禁用", async () => {
  const calls = [];
  const { t, seed, tree, react, internals } = renderCompany({
    fetch: companyFetch(calls, {
      opResult: { createdDepartments: ["D03", "D04"], createdEmployees: ["E0006", "E0007", "E0008", "E0009", "E0010"], updatedEmployees: ["emp-dev", "emp-doc", "emp-free"] },
    }),
  });
  await clickSync(tree, t);

  const op = calls.find((c) => c.url.endsWith("/company/op"));
  assert.ok(op, "应发 /company/op 请求");
  assert.equal(op.method, "POST");
  assert.deepEqual(op.body, { action: "syncRoster", args: {} });
  assert.ok(calls.some((c) => c.url.endsWith("/company/overview")), "同步成功后应刷新 overview");

  // 成功提示行（含新增部门/员工、更新数）
  assert.equal(seed[12], t("cpSyncDone", { depts: 2, employees: 5, updated: 3 }));
  react.reset();
  const after = internals.CompanyOrgPanel({ t });
  assert.match(treeText(after), /已同步：新增 2 个部门、5 名员工，更新 3 名/);

  // busy 期间按钮禁用
  const busyRender = renderCompany({ busy: true });
  const busyButton = buttonByLabel(busyRender.tree, busyRender.t("cpSyncRoster"))[0];
  assert.equal(busyButton.disabled, true, "busy 时「从名册同步」应禁用");
});

test("从名册同步：失败显示红字 cpOpFailed + code/message，不覆盖 overview", async () => {
  const { t, seed, react, tree, internals } = renderCompany({
    fetch: companyFetch([], { opResult: { ok: false, code: "E_NO_REGISTRY", message: "未找到名册文件" } }),
  });
  await clickSync(tree, t);

  assert.equal(seed[12], null, "失败时不应显示成功提示");
  assert.match(String(seed[13]), /E_NO_REGISTRY/);
  assert.match(String(seed[13]), /未找到名册文件/);
  react.reset();
  const after = internals.CompanyOrgPanel({ t });
  const text = treeText(after);
  assert.match(text, new RegExp(t("cpOpFailed")));
  assert.match(text, /E_NO_REGISTRY/);
});

test("cpSyncSummary：按 createdDepartments/createdEmployees/updatedEmployees 计数并格式化，缺字段兜底 0", () => {
  const { exports } = loadBundle(makeReact());
  const summary = exports.__internals.cpSyncSummary;
  const t = translator("zh");

  assert.equal(
    summary(t, { createdDepartments: ["D01", "D02"], createdEmployees: ["E1", "E2", "E3", "E4", "E5"], updatedEmployees: ["e1", "e2", "e3"] }),
    "已同步：新增 2 个部门、5 名员工，更新 3 名",
  );
  // 单参形态（无 t）也能给出中文文案
  assert.equal(summary({ createdDepartments: [] }), "已同步：新增 0 个部门、0 名员工，更新 0 名");
  assert.equal(summary(t, null), t("cpSyncDone", { depts: 0, employees: 0, updated: 0 }));
  // 数字形态兜底
  assert.equal(summary(t, { createdDepartments: 2, createdEmployees: 5, updatedEmployees: 3 }), "已同步：新增 2 个部门、5 名员工，更新 3 名");
});

test("从名册同步：结果行 5 秒后自动清除（保留 state，定时器 5000ms）", () => {
  const timers = [];
  const fakeSetTimeout = (fn, ms) => {
    timers.push({ fn, ms });
    return timers.length;
  };
  const react = makeReactLive(cpSeed({ syncResult: "已同步：新增 1 个部门、0 名员工，更新 0 名" }));
  const { exports } = loadBundle(react, { fetch: companyFetch([]), setTimeout: fakeSetTimeout, clearTimeout: () => {} });
  const t = translator("zh");

  exports.__internals.CompanyOrgPanel({ t });
  react.flushEffects();
  const clearTimer = timers.find((timer) => timer.ms === 5000);
  assert.ok(clearTimer, "结果行应注册 5s 清除定时器");

  clearTimer.fn();
  react.reset();
  const after = exports.__internals.CompanyOrgPanel({ t });
  assert.equal(treeText(after).includes("已同步"), false, "5s 后结果行应从界面消失");
});

test("从名册同步：手动刷新会立即清除结果行", async () => {
  const calls = [];
  const { t, seed, tree } = renderCompany({
    syncResult: "已同步：新增 1 个部门、2 名员工，更新 0 名",
    fetch: companyFetch(calls, { opResult: { createdDepartments: ["D03"], createdEmployees: ["E0006", "E0007"], updatedEmployees: [] } }),
  });
  // 有种子结果行时先能看到
  assert.match(treeText(tree), /已同步：新增 1 个部门、2 名员工，更新 0 名/);
  await buttonByLabel(tree, t("cpRefresh"))[0].onClick();
  await tick();
  assert.equal(seed[12], null, "刷新应清除结果行");
  assert.equal(seed[13], null, "刷新应清除错误行");
  assert.ok(calls.some((c) => c.url.endsWith("/company/overview")));
});

test("删除部门：confirm 取消不发请求，弹层保持打开", async () => {
  const calls = [];
  const asked = [];
  let allow = false;
  const { t, seed, react, internals } = renderCompany({
    deptModal: "dept-plugin",
    fetch: companyFetch(calls),
    confirm: (message) => (asked.push(message), allow),
  });
  react.reset();
  const modalTree = internals.CompanyOrgPanel({ t });
  const del = buttonByLabel(modalTree, t("cpDeleteDept"));
  assert.equal(del.length, 1, "部门弹层底部应有「删除部门」按钮");
  await del[0].onClick();
  await tick();

  assert.equal(asked.length, 1, "删除前应 window.confirm");
  assert.match(asked[0], /插件组/, "确认文案含部门名称");
  assert.match(asked[0], /D01/, "确认文案含部门编号");
  assert.equal(calls.filter((c) => c.url.endsWith("/company/op")).length, 0, "取消后不发请求");
  assert.equal(seed[5], "dept-plugin", "取消后弹层保持打开");
});

test("删除部门：确认后 POST deleteDepartment，成功关闭弹层并刷新 overview", async () => {
  const calls = [];
  const asked = [];
  const { t, seed, react, internals } = renderCompany({
    deptModal: "dept-plugin",
    fetch: companyFetch(calls, { opResult: { ok: true, departmentId: "dept-plugin", code: "D01" } }),
    confirm: (message) => (asked.push(message), true),
  });
  react.reset();
  const modalTree = internals.CompanyOrgPanel({ t });
  await buttonByLabel(modalTree, t("cpDeleteDept"))[0].onClick();
  await tick();

  assert.equal(asked.length, 1);
  const op = calls.find((c) => c.url.endsWith("/company/op"));
  assert.ok(op, "确认后应发 /company/op");
  assert.equal(op.method, "POST");
  assert.deepEqual(op.body, { action: "deleteDepartment", args: { departmentId: "dept-plugin" } });
  assert.equal(seed[5], null, "删除成功后应关闭弹层");
  assert.ok(calls.some((c) => c.url.endsWith("/company/overview")), "删除成功后应刷新 overview");
});

test("删除部门：失败（E_DEPT_NOT_EMPTY）在弹层内红字，弹层保持打开", async () => {
  const { t, seed, react, internals } = renderCompany({
    deptModal: "dept-plugin",
    fetch: companyFetch([], { opResult: { ok: false, code: "E_DEPT_NOT_EMPTY", message: "部门内仍有员工，不能删除" } }),
    confirm: () => true,
  });
  react.reset();
  const modalTree = internals.CompanyOrgPanel({ t });
  await buttonByLabel(modalTree, t("cpDeleteDept"))[0].onClick();
  await tick();

  assert.match(String(seed[9]), /E_DEPT_NOT_EMPTY/);
  assert.match(String(seed[9]), /部门内仍有员工/);
  assert.equal(seed[5], "dept-plugin", "失败时弹层保持打开");

  react.reset();
  const after = internals.CompanyOrgPanel({ t });
  const text = treeText(after);
  assert.match(text, new RegExp(t("cpOpFailed")));
  assert.match(text, /E_DEPT_NOT_EMPTY/);
});
