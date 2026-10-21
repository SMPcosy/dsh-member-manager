/**
 * 「总架构」面板（docs/16 §4.4 / §5 v4）的离线测试：不需要浏览器，也不需要 DSH 在运行。
 *
 * 做法与 client-bundle.test.mjs 一致：
 *  1. 用 node:vm + `window.__ModuleLoader__.load` 把 lib/client.js 真实加载进来
 *     （require 替身只提供 react），拿到 exports 与 __internals
 *  2. 用 apply() 捕获真实的中英文字典，再把 t 做成真实插值函数，
 *     这样断言的是用户最终看到的中文文案，而不是 key
 *  3. 用种子化 hooks 的 react 替身直接执行 Panel / CompanyOrgPanel / EmployeeCenterPanel
 *     的函数体，从真实元素树里断言架构图、员工中心页签、部门弹层、写操作与各级空态
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
        employee({ id: "emp-lead", code: "E0001", displayName: "插件组负责人", title: "组长", duties: ["带队", "汇报"], skills: ["react"], model: "m-1", provider: "p-1", department: "dept-plugin", departmentCode: "D01", channel: "M", level: "M2", levelName: "经理", role: "manager", state: "working" }),
        employee({ id: "emp-dev", code: "E0002", displayName: "插件工程师", title: "工程师", duties: ["a", "b", "c", "d", "e", "f", "g", "h"], skills: [], model: "", provider: "", department: "dept-plugin", departmentCode: "D01", channel: "P", level: "P4", levelName: "资深工程师" }),
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
  const skills = options.skills || [{ name: "react", description: "前端框架", source: "local" }, { name: "node", description: "运行时", source: "local" }];
  const providers = options.providers || [
    { id: "p-1", displayName: "提供商一", models: [{ id: "m-1", name: "模型一" }] },
    { id: "p-2", displayName: "提供商二", models: [{ id: "m-2", name: "模型二" }] },
  ];
  return async (url, init) => {
    const u = String(url);
    calls.push({ url: u, method: (init && init.method) || "GET", body: init && init.body ? JSON.parse(init.body) : null });
    if (u.endsWith("/company/op")) return { ok: true, status: 200, json: async () => ({ ok: true, data: opResult }) };
    if (u.endsWith("/company/overview")) return { ok: true, status: 200, json: async () => ({ ok: true, data }) };
    if (u.endsWith("/skills")) return { ok: true, status: 200, json: async () => ({ ok: true, data: { skills } }) };
    if (u.endsWith("/models")) return { ok: true, status: 200, json: async () => ({ ok: true, data: { providers } }) };
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

/** CompanyOrgPanel 的 useState 顺序（v5.11：21 槽，追加 15–21 四个编辑器）：
 *  0 overview / 1 error / 2 busy / 3 updatedAt / 4 deptModal / 5 modalTab /
 *  6 newDeptOpen / 7 newDeptDraft / 8 opError / 9 newDeptError / 10 editor /
 *  11 mgmtOpen / 12 saved / 13 rosterPicker / 14 modelProviders /
 *  15 mgmtRename / 16 numberingOpen / 17 numberingDraft / 18 levelsOpen /
 *  19 levelsDraft / 20 deptEditOpen / 21 deptEditDraft */
function cpSeed(options = {}) {
  return [
    options.overview === undefined ? overviewFixture() : options.overview,
    options.error || null,
    options.busy || false,
    null,
    options.deptModal || null,
    options.modalTab || "chart",
    options.newDeptOpen || false,
    options.newDeptDraft || null,
    options.opError || null,
    options.newDeptError || null,
    options.editor || null,
    options.mgmtOpen || false,
    options.saved === undefined ? null : options.saved,
    options.rosterPicker === undefined ? null : options.rosterPicker,
    options.modelProviders === undefined ? null : options.modelProviders,
    options.mgmtRename === undefined ? null : options.mgmtRename,
    options.numberingOpen || false,
    options.numberingDraft === undefined ? null : options.numberingDraft,
    options.levelsOpen || false,
    options.levelsDraft === undefined ? null : options.levelsDraft,
    options.deptEditOpen || false,
    options.deptEditDraft === undefined ? null : options.deptEditDraft,
  ];
}

function renderCompany(options = {}) {
  const t = translator(options.lang || "zh");
  const seed = cpSeed(options);
  const react = makeReact(seed, { mutable: true });
  const fetchFn = options.fetch || overviewFetch();
  const { exports } = loadBundle(react, { fetch: fetchFn, confirm: options.confirm });
  const panelProps = { t };
  const render = () => exports.__internals.CompanyOrgPanel(panelProps);
  return {
    t,
    panelProps,
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

/** EmployeeCenterPanel 的 useState 顺序：
 *  0 overview / 1 error / 2 updatedAt / 3 busy / 4 filter */
function ecSeed(options = {}) {
  return [
    options.overview === undefined ? overviewFixture() : options.overview,
    options.error || null,
    null,
    options.busy || false,
    options.filter || "all",
  ];
}

function renderEmployees(options = {}) {
  const t = translator(options.lang || "zh");
  const seed = ecSeed(options);
  const react = makeReact(seed, { mutable: true });
  const fetchFn = options.fetch || overviewFetch();
  const { exports } = loadBundle(react, { fetch: fetchFn, confirm: options.confirm });
  const render = () => exports.__internals.EmployeeCenterPanel({ t });
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
    ? collectElements(overlay, (n) => n.type === "div" && n.props.style && n.props.style.width === "min(940px, 92vw)")[0]
    : null;
  return { overlay: overlay || null, card: card || null };
}

/** 管理层只读弹层：卡片宽度 = min(760px, 95vw)（S 未导出） */
function findMgmtModal(tree) {
  const overlay = collectElements(
    tree,
    (n) => n.type === "div" && n.props.style && n.props.style.position === "fixed" && n.props.style.zIndex === 2147483000,
  )[0];
  const card = overlay
    ? collectElements(overlay, (n) => n.type === "div" && n.props.style && n.props.style.width === "min(760px, 95vw)")[0]
    : null;
  return { overlay: overlay || null, card: card || null };
}

/** 按工号定位员工行（cpRenderEmployeeRow 的第一格是工号） */
function employeeRowByCode(tree, code) {
  // 员工行动行的第一个子节点是工号 span；领导节点/人事详情头部虽然也含工号，但首个子节点不是工号
  return collectElements(
    tree,
    (n) =>
      n.type === "div" &&
      n.children &&
      n.children[0] &&
      n.children[0].type === "span" &&
      textOf(n.children[0]) === code,
  ).pop();
}

function channelButtonFor(tree, t, code) {
  // 注意：领导节点里也会出现同一工号，必须挑带「通道」按钮的那一行行动区
  const rows = collectElements(
    tree,
    (n) => n.type === "div" && (n.children || []).some((c) => c && c.type === "span" && textOf(c) === code),
  );
  for (const row of rows) {
    const button = collectButtons(row).find((b) => b.label === t("cpChannels"));
    if (button) return button;
  }
  assert.fail(`未找到员工行「通道」按钮：${code}`);
}

function checkboxInputs(tree) {
  return collectElements(tree, (n) => n.type === "input" && n.props.type === "checkbox");
}

/** 当前打开的人事详情草稿（editor.profileDraft，v5.8 起读写公司化资料） */
function seed10(made) {
  return (made.seed[10] && made.seed[10].profileDraft) || {};
}

/** 打开某员工的人事管理详情（行下方向下展开） */
function openHr(made, code) {
  made.react.reset();
  const tree = made.internals.CompanyOrgPanel(made.panelProps);
  const row = employeeRowByCode(tree, code);
  assert.ok(row, "找不到员工行：" + code);
  const button = collectButtons(row).find((b) => b.label === made.t("cpHr"));
  assert.ok(button, "员工行应有人事管理按钮：" + code);
  button.onClick();
  return tree;
}

/** 先展开人事详情，再点其中一个操作按钮（通道/晋升/停用/调岗） */
function openHrAction(made, code, label) {
  openHr(made, code);
  assert.equal(String(made.seed[10].kind), "hr", "应先展开人事管理详情");
  made.react.reset();
  const tree = made.internals.CompanyOrgPanel(made.panelProps);
  const button = buttonByLabel(tree, label)[0];
  assert.ok(button, "人事详情缺少操作按钮：" + label);
  button.onClick();
}

/** 按 placeholder 找输入框/多行文本框（名册资料表单） */
function inputByPlaceholder(tree, placeholder) {
  return collectElements(
    tree,
    (n) => (n.type === "input" || n.type === "textarea") && n.props.placeholder === placeholder,
  )[0];
}

/** 双通道员工 fixture：emp-dev 同时持有 M1 + P4（主通道 M） */
function dualOverview() {
  const view = overviewFixture();
  const dev = view.org.employees.find((emp) => emp.id === "emp-dev");
  dev.channels = [
    { channel: "M", level: "M1", levelName: "主管" },
    { channel: "P", level: "P4", levelName: "资深工程师" },
  ];
  return view;
}

/** 含 window 岗位员工的 fixture（用于 M 通道闭锁断言） */
function roleFixture() {
  const view = overviewFixture();
  view.org.employees.push({
    id: "emp-win",
    code: "E0006",
    displayName: "窗口同事",
    department: "dept-plugin",
    departmentCode: "D01",
    channel: "P",
    level: "P2",
    levelName: "工程师",
    role: "window",
    kind: "temp",
    state: "idle",
  });
  return view;
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

test("源码：v5 总架构结构——默认 company、管理层节点、/company/op，且无旧员工中心节点/一句话建组代码", () => {
  const src = fs.readFileSync(BUNDLE, "utf8");

  // 页签与标题文案
  assert.match(src, /cpTab: "总架构"/);
  assert.match(src, /cpTab: "Overall arch"/);
  assert.match(src, /cpTitle: "总架构"/);
  assert.match(src, /cpTitle: "Overall architecture"/);
  assert.match(src, /tabOrg: "部门架构"/);
  assert.match(src, /tabOrg: "Department org"/);

  // 默认 tab = company；页签 4 个，顺序 company → employees → workflow → maintain；部门架构不再占页签
  assert.match(src, /const \[tab, setTab\] = useState\("company"\)/);
  assert.ok(src.indexOf('tabBtn("company"') >= 0, "源码应注册 company 页签");
  assert.ok(src.indexOf('tabBtn("company"') < src.indexOf('tabBtn("employees"'), "员工中心页签应排在总架构之后");
  assert.ok(src.indexOf('tabBtn("employees"') < src.indexOf('tabBtn("workflow"'), "工作流页签应排在员工中心之后");
  assert.ok(src.indexOf('tabBtn("workflow"') < src.indexOf('tabBtn("maintain"'), "备份与更新应排在工作流之后");
  assert.equal(src.includes('tabBtn("retired"'), false, "已停用页签应移除");
  assert.equal(src.includes('tabBtn("unregistered"'), false, "未登记页签应移除");
  assert.equal(src.includes("tabRetired"), false, "tabRetired 文案应移除");
  assert.equal(src.includes("tabUnregistered"), false, "tabUnregistered 文案应移除");
  assert.equal(src.includes('tabBtn("org"'), false, "部门架构不应再注册为页签");

  // 页签只留 4 个；Panel 的 hooks 只剩 state/error/busy/tab/draft
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

  // task-24：员工中心仍是独立页签（v5 从总架构图中移除它的紧凑节点与「查看全部」）
  assert.match(src, /function EmployeeCenterPanel\(props\)/);
  assert.match(src, /EmployeeCenterPanel: EmployeeCenterPanel/);
  assert.equal(src.includes('t("cpViewAll")'), false, "「查看全部」按钮应移除");
  assert.equal(src.includes("onOpenEmployees"), false, "onOpenEmployees 回调应移除");
  assert.equal(src.includes("const employeeCenterCard"), false, "员工中心紧凑节点应移除");

  // task-27（docs/21 §4）：管理层虚拟节点 + 双通道徽章 + 通道编辑
  assert.match(src, /cpManagement: "管理层"/);
  assert.match(src, /cpManagement: "Management"/);
  assert.match(src, /cpMgmtHint: "管理层（只读展示，不影响部门归属）"/);
  assert.match(src, /cpMgmtHint: "Management \(read-only, does not change department membership\)"/);
  assert.match(src, /cpMgmtEmpty: "暂无 M 通道员工"/);
  assert.match(src, /cpMgmtEmpty: "No M-channel employees"/);
  assert.match(src, /cpChannels: "通道"/);
  assert.match(src, /cpChannels: "Channels"/);
  assert.match(src, /cpChannelRequired: "至少保留一个通道"/);
  assert.match(src, /cpChannelLocked: "该岗位不可取消 M 通道"/);
  assert.match(src, /cpSave: "保存"/);
  assert.match(src, /cpSaved: "已保存"/);
  assert.match(src, /function cpChannelsOf\(emp, levels\)/);
  assert.match(src, /function cpPrimaryChannel\(emp\)/);
  assert.match(src, /function cpNormalizeManagement\(raw, departments, employees, levels\)/);
  assert.match(src, /management: cpNormalizeManagement\(data\.management, departments, employees, levels\)/);
  assert.match(src, /submitOp\("setChannels", \{ employeeId: emp\.id, channels: channels \}/);

  // v5.4（docs/21 §4）：四操作合并为「人事管理」详情页（名册资料编辑 + 四操作内嵌）
  assert.match(src, /cpHr: "人事管理"/);
  assert.match(src, /cpHr: "HR management"/);
  assert.match(src, /cpProfile: "公司化资料"/);
  assert.match(src, /cpSaveProfile: "保存公司化资料"/);
  assert.match(src, /cpHrActions: "人事操作"/);
  assert.match(src, /cpHrPolicy: "会话策略"/);
  assert.match(src, /cpMainChannel: "通道说明"/);
  assert.equal(src.includes("cpRegistryMembers"), false, "名册扁平化 helper 应已移除");
  assert.match(src, /function hrDetail\(emp\)/);
  assert.match(src, /function hrProfileBlock\(emp\)/);
  assert.match(src, /function closeEditor\(\)/);
  assert.equal(src.includes("registryMembers"), false, "CompanyOrgPanel 不再接收名册成员");
  assert.match(src, /setEditor\(hrEmployeeId != null \? \{ kind: "hr", employeeId: hrEmployeeId \} : null\)/);
  assert.match(src, /opPost\("updateEmployeeProfile"/);
  // v5.10：公司化资料 3 列布局——显示名/岗位名称第一行，技能/模型第二行，岗位职责占第 3 列两行
  assert.match(src, /hrGrid: { display: "grid", gridTemplateColumns: "minmax\(120px, 190px\) minmax\(120px, 190px\) minmax\(0, 1fr\)"/);
  assert.match(src, /gridColumn: "3", gridRow: "1 \/ span 2"/);
  assert.equal(src.includes('t("cpImportProfiles")'), false, "导入名册资料按钮应移除");

  // 轮询与写接口
  assert.match(src, /api\("\/company\/overview"\)/);

  // v5.2：两页都去掉自动刷新——源码里不应再有 5s 轮询定时器或对应胶囊
  assert.equal(src.includes("CP_POLL_MS"), false, "CP_POLL_MS 应删除（不再自动轮询）");
  assert.equal(/setInterval\(pull,\s*(CP_POLL_MS|5000)\)/.test(src), false, "不应再有公司面板的 pull 轮询定时器");
  assert.equal(src.includes("cpRefreshHint"), false, "cpRefreshHint 文案键应删除");
  assert.equal(src.includes("每 5 秒自动刷新"), false, "自动刷新胶囊文案应删除");
  assert.match(src, /api\("\/company\/op"/);
  assert.match(src, /JSON\.stringify\(\{ action: action, args: args \|\| \{\} \}\)/);

  // 安全：不写 HTML 字符串、不用 eval
  assert.equal(/\.innerHTML\s*=/.test(src), false, "不应给 innerHTML 赋值");
  assert.equal(src.includes("dangerouslySetInnerHTML"), false, "不应使用 dangerouslySetInnerHTML");
  assert.equal(/\beval\s*\(/.test(src), false, "不应使用 eval");
});

test("字典：v5 文案 zh/en 严格对称，中文与 docs/21 §4.3 一致", () => {
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
  assert.equal(zh.cpViewAll, "查看全部");
  assert.equal(en.cpViewAll, "View all");

  // v5：管理层 / 双通道 / 通道编辑（docs/21 §4.3）
  assert.equal(zh.cpManagement, "管理层");
  assert.equal(en.cpManagement, "Management");
  assert.equal(zh.cpMgmtHint, "管理层（只读展示，不影响部门归属）");
  assert.equal(en.cpMgmtHint, "Management (read-only, does not change department membership)");
  assert.equal(zh.cpMgmtEmpty, "暂无 M 通道员工");
  assert.equal(en.cpMgmtEmpty, "No M-channel employees");
  assert.equal(zh.cpChannels, "通道");
  assert.equal(en.cpChannels, "Channels");
  assert.equal(zh.cpChannelRequired, "至少保留一个通道");
  assert.equal(en.cpChannelRequired, "At least one channel is required");
  assert.equal(zh.cpChannelLocked, "该岗位不可取消 M 通道");
  assert.equal(en.cpChannelLocked, "This role cannot drop the M channel");
  assert.equal(zh.cpSave, "保存");
  assert.equal(en.cpSave, "Save");
  assert.equal(zh.cpSaved, "已保存");
  assert.equal(en.cpSaved, "Saved");

  // v5.4：人事管理详情页
  assert.equal(zh.cpHr, "人事管理");
  assert.equal(en.cpHr, "HR management");
  assert.equal(zh.cpHrRoster, "名册资料");
  assert.equal(en.cpHrRoster, "Roster record");
  assert.ok(zh.cpHrNoRoster.length > 0 && en.cpHrNoRoster.length > 0, "未关联名册提示中英文都应存在");
  assert.equal(zh.cpHrActions, "人事操作");
  assert.equal(en.cpHrActions, "HR actions");
  assert.equal(zh.cpHrPolicy, "会话策略");
  assert.equal(en.cpHrPolicy, "Session policy");
  assert.equal(zh.cpHrAliases, "别名（逗号分隔）");
  assert.equal(zh.cpHrModel, "模型覆盖");
  assert.equal(en.cpHrModel, "Model override");
  assert.equal(zh.cpHrStatus, "状态");
  assert.equal(en.cpHrStatus, "Status");
  assert.equal(zh.cpMainChannel, "通道说明");
  assert.equal(en.cpMainChannel, "Channels");
  assert.equal(zh.cpHrSave, "保存名册资料");
  assert.equal(en.cpHrSave, "Save roster record");
  assert.equal(zh.cpProfile, "公司化资料");
  assert.equal(en.cpProfile, "Company profile");
  assert.equal(zh.cpSaveProfile, "保存公司化资料");
  assert.equal(zh.cpHrTarget, "名册 target");
  assert.equal(zh.cpKindPermanent, "常驻成员 · 独立会话");
  assert.ok(zh.cpKindTemp.length > 0 && zh.cpKindShared.length > 0);
  assert.ok(zh.cpECFilterHint.length > 0 && en.cpECFilterHint.length > 0, "筛选提示中英文都应存在");
  assert.equal(zh.cpNoLeader, "未设负责人");
  assert.equal(zh.cpLeaderTag, "负责人");
  assert.equal(zh.cpChartEmpty, "暂无部门，点右上角「新建部门」");
  assert.equal(zh.cpDeptBoxHint, "点击查看部门详情");
  assert.ok(zh.cpECEmpty.length > 0);

  // 部门弹层与写操作
  assert.equal(zh.cpModalChart, "部门架构图");
  assert.equal(zh.cpModalMembers, "成员详情");
  assert.equal(zh.cpHire, "招聘员工");
  assert.equal(zh.cpPromote, "晋升");
  assert.equal(zh.cpFire, "停用");
  assert.equal(zh.cpMove, "调岗");
  assert.ok(zh.cpFireConfirm.includes("{name}"));
  assert.equal(zh.cpOpFailed, "操作失败");
  assert.equal(zh.cpClose, "关闭");

  // v4.1 删除部门
  assert.equal(zh.cpSyncRoster, undefined, "「从名册同步」文案应已移除");
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

test("Panel：默认总架构，页签恰 4 个且顺序为 总架构→员工中心→工作流→备份与更新", () => {
  const { t, tree, internals } = renderPanel();
  const expected = [t("cpTab"), t("cpEmployeeCenter"), t("tabWorkflow"), t("tabMaintain")];
  const labels = collectButtons(tree)
    .map((button) => button.label)
    .filter((label) => expected.includes(label));

  assert.deepEqual(labels, expected);
  assert.equal(labels.length, 4);
  assert.equal(labels.includes(t("tabOrg")), false, "部门架构不应再占页签");
  assert.equal(collectElements(tree, (node) => node.type === internals.CompanyOrgPanel).length, 1, "默认应渲染 CompanyOrgPanel");
  assert.equal(findModal(tree).overlay, null, "默认不应出现部门弹层");
});

test("Panel：总架构页不再传 onOpenEmployees；点员工中心页签才渲染 EmployeeCenterPanel", () => {
  const { t, seed, react, internals } = renderPanel();
  react.reset();
  const tree = internals.Panel({ t });
  const company = collectElements(tree, (node) => node.type === internals.CompanyOrgPanel)[0];
  assert.ok(company, "默认应渲染 CompanyOrgPanel");
  assert.equal(company.props.onOpenEmployees, undefined, "总架构页不再传 onOpenEmployees");
  assert.equal(collectElements(tree, (node) => node.type === internals.EmployeeCenterPanel).length, 0);

  const btn = collectButtons(tree).find((button) => button.label === t("cpEmployeeCenter"));
  assert.ok(btn, "应有员工中心页签");
  btn.onClick();
  assert.equal(seed[3], "employees", "点员工中心页签应切到 employees");
  react.reset();
  const after = internals.Panel({ t });
  assert.equal(collectElements(after, (node) => node.type === internals.EmployeeCenterPanel).length, 1);
  assert.equal(collectElements(after, (node) => node.type === internals.CompanyOrgPanel).length, 0);
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

test("CompanyOrgPanel：架构图 = 管理层虚拟节点 + 领导节点 + 部门框（编号/名称/负责人/编制/通道人数）", () => {
  const { t, tree } = renderCompany();
  const text = treeText(tree);

  // v5：最高层是「管理层」虚拟节点；员工中心节点与「查看全部」已移除
  const mgmtNode = collectButtons(tree).find((button) => String(button.label).startsWith(t("cpManagement")));
  assert.ok(mgmtNode, "架构图应有「管理层」节点（标题 + M 人数 badge）");
  assert.equal(mgmtNode.label, t("cpManagement") + "1", "管理层节点应带 M 人数 badge");
  assert.equal(buttonByLabel(tree, t("cpViewAll")).length, 0, "「查看全部」按钮应移除");
  assert.equal(text.includes(t("cpEmployeeCenter")), false, "总架构页不再出现员工中心节点");
  assert.equal(text.includes(t("cpECFilterAll")), false, "总架构页不再内嵌员工列表与筛选");
  assert.equal(buttonByLabel(tree, t("cpNewDept")).length, 1, "工具栏应有「新建部门」");
  assert.equal(buttonByLabel(tree, t("cpRefresh")).length, 1, "工具栏应有「刷新」");

  // 部门框：编号 + 名称 + 负责人 + 编制 + M/P 人数
  assert.match(text, /\[D01\]/);
  assert.match(text, /插件组/);
  assert.match(text, /\[D02\]/);
  assert.match(text, /文档组/);
  assert.match(text, /负责人：插件组负责人/);
  assert.match(text, /负责人：未设负责人/);

  // v6：部门框内通道人数改为 M/P 徽章 + 右侧编制文本
  const deptBoxes = collectElements(tree, (node) => node.type === "button" && node.props.title === t("cpDeptBoxHint")).map((node) => textOf(node));
  assert.equal(deptBoxes.length, 2, "架构图应有两个部门框");
  assert.match(deptBoxes[0], /\[D01\]/);
  assert.match(deptBoxes[0], /负责人：插件组负责人/);
  assert.match(deptBoxes[0], /M 1/);
  assert.match(deptBoxes[0], /P 2/);
  assert.match(deptBoxes[0], /3\/4/);
  assert.match(deptBoxes[1], /\[D02\]/);
  assert.match(deptBoxes[1], /M 0/);
  assert.match(deptBoxes[1], /P 1/);
  assert.match(deptBoxes[1], /1\/2/);

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

test("CompanyOrgPanel：管理层节点点击打开只读弹层（cpMgmtHint 标题 + M 员工 + 部门编号名）", () => {
  const made = renderCompany();
  const mgmt = collectButtons(made.tree).find((button) => String(button.label).startsWith(made.t("cpManagement")));
  assert.ok(mgmt, "应有管理层节点");
  mgmt.onClick();
  assert.equal(made.seed[11], true, "点管理层节点应打开只读弹层");

  made.react.reset();
  const tree = made.internals.CompanyOrgPanel(made.panelProps);
  const modal = findMgmtModal(tree);
  assert.ok(modal.card, "应渲染管理层只读弹层");
  const text = treeText(modal.card);
  assert.match(text, new RegExp(made.t("cpMgmtHint")), "标题应带 cpMgmtHint");
  assert.match(text, /E0001/, "应列出 M 通道员工工号");
  assert.match(text, /M2/, "应有等级徽章");
  assert.match(text, /经理/, "徽章应带等级名");
  assert.match(text, /\[D01\] 插件组/, "应显示部门编号 + 名称");
  assert.equal(buttonByLabel(modal.card, made.t("cpClose")).length, 1, "只读弹层应有关闭按钮");
  assert.equal(buttonByLabel(modal.card, made.t("cpPromote")).length, 0, "只读弹层不应有写操作按钮");
});

test("EmployeeCenterPanel：默认全员，排序 = 部门编号升序 → M 前 P 后 → 等级降序 → 工号升序", () => {
  const { t, tree } = renderEmployees();
  const text = treeText(tree);

  assert.match(text, new RegExp(t("cpEmployeeCenter")));
  assert.equal(buttonByLabel(tree, t("cpRefresh")).length, 1, "员工中心应有刷新按钮");

  // 全部 5 名员工按既定顺序出现（部门内 M 在前、等级降序、工号升序；无部门最后）
  const expected = ["E0001", "E0002", "E0005", "E0003", "E0004"];
  const positions = expected.map((code) => text.indexOf(code));
  positions.forEach((pos, i) => assert.ok(pos >= 0, `渲染结果缺少工号 ${expected[i]}`));
  assert.deepEqual(positions.slice().sort((a, b) => a - b), positions, "员工顺序应为 " + expected.join("→"));

  // 未启用员工带状态小字
  assert.match(text, new RegExp(t("cpStateFired")));

  // 筛选下拉：全体员工 / 各部门 [编号] 名称 / 未启用成员
  const select = collectElements(tree, (node) => node.type === "select")[0];
  assert.ok(select, "应有部门筛选下拉");
  const optionTexts = (select.children || []).map((opt) => textOf(opt));
  assert.deepEqual(optionTexts, ["全体员工", "[D01] 插件组", "[D02] 文档组", "未启用成员"]);
  assert.equal(select.props.value, "all", "默认筛选项应为全体员工");
});

test("EmployeeCenterPanel：按部门筛选 / 未启用筛选", () => {
  const dept = renderEmployees({ filter: "dept-doc" });
  let text = treeText(dept.tree);
  assert.match(text, /E0003/, "部门筛选应保留该部门员工");
  assert.equal(text.includes("E0001"), false, "部门筛选应过滤掉其它部门员工");

  const disabled = renderEmployees({ filter: "disabled" });
  text = treeText(disabled.tree);
  assert.match(text, /E0005/, "未启用筛选只保留 fired 员工");
  assert.equal(text.includes("E0002"), false);
  assert.match(text, new RegExp(disabled.t("cpStateFired")));
});

test("EmployeeCenterPanel：部门下拉在工具栏、位于刷新按钮之前", () => {
  const { t, tree } = renderEmployees();
  const selects = collectElements(tree, (n) => n.type === "select");
  assert.equal(selects.length, 1, "员工中心页只应有一个部门下拉");
  const rows = collectElements(
    tree,
    (n) =>
      n.type === "div" &&
      (n.children || []).some((c) => c && c.type === "select") &&
      (n.children || []).some((c) => c && c.type === "button"),
  );
  assert.equal(rows.length, 1, "下拉与刷新按钮应在同一行工具栏内");
  const kids = rows[0].children;
  const selectIdx = kids.findIndex((c) => c && c.type === "select");
  const refreshIdx = kids.findIndex((c) => c && c.type === "button" && textOf(c) === t("cpRefresh"));
  assert.ok(selectIdx >= 0 && refreshIdx >= 0, "应同时找到下拉与刷新按钮");
  assert.ok(selectIdx < refreshIdx, "下拉应在刷新按钮之前");
});

test("EmployeeCenterPanel：空组织 = cpECEmpty 空态，下拉只剩全体员工/未启用成员", () => {
  const { t, tree } = renderEmployees({ overview: emptyOrgFixture() });
  assert.match(treeText(tree), new RegExp(t("cpECEmpty")));
  const select = collectElements(tree, (node) => node.type === "select")[0];
  const optionTexts = (select.children || []).map((opt) => textOf(opt));
  assert.deepEqual(optionTexts, ["全体员工", "未启用成员"]);
});

test("EmployeeCenterPanel：刷新按钮立即拉取 overview，完成后 busy 复位", async () => {
  const calls = [];
  const made = renderEmployees({ fetch: companyFetch(calls) });
  const refresh = buttonByLabel(made.tree, made.t("cpRefresh"))[0];
  assert.ok(refresh, "应有刷新按钮");
  assert.equal(calls.length, 0, "静态渲染不跑 effect");

  await refresh.onClick();
  await tick();
  assert.equal(calls.filter((c) => c.url.endsWith("/company/overview")).length, 1, "刷新应拉一次 overview");
  assert.equal(made.seed[3], false, "刷新完成后 busy 应复位");
});

test("EmployeeCenterPanel：打开拉一次、不注册自动轮询定时器，手动刷新再拉一次", async () => {
  const calls = [];
  const timers = [];
  const react = makeReactLive([null, null, null, false, "all"]);
  const { exports } = loadBundle(react, {
    fetch: companyFetch(calls),
    setInterval: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearInterval: () => {},
  });
  const t = translator("zh");
  const tree = exports.__internals.EmployeeCenterPanel({ t });
  assert.match(treeText(tree), new RegExp(t("cpLoading")), "首屏未拉到数据时显示加载中");

  const cleanups = react.flushEffects();
  assert.equal(timers.length, 0, "v5.2 起员工中心页不再注册自动轮询定时器");
  await tick();
  assert.equal(calls.filter((c) => c.url.endsWith("/company/overview")).length, 1, "打开时拉一次");

  const refresh = buttonByLabel(tree, t("cpRefresh"))[0];
  assert.ok(refresh, "应有刷新按钮");
  await refresh.onClick();
  await tick();
  assert.equal(calls.filter((c) => c.url.endsWith("/company/overview")).length, 2, "手动刷新再拉一次");
  assert.equal(timers.length, 0, "刷新也不应创建轮询定时器");

  cleanups[0]();
  await tick();
  assert.equal(calls.filter((c) => c.url.endsWith("/company/overview")).length, 2, "卸载后不再请求");
});

test("CompanyOrgPanel：空组织 = 暂无部门空态，管理层节点仍在（人数 0）", () => {
  const { t, tree } = renderCompany({ overview: emptyOrgFixture() });
  const text = treeText(tree);
  assert.match(text, new RegExp(t("cpChartEmpty")));
  const mgmt = collectButtons(tree).find((button) => String(button.label).startsWith(t("cpManagement")));
  assert.ok(mgmt, "空组织也应渲染管理层节点");
  assert.match(text, /管理层 0/);
  assert.equal(buttonByLabel(tree, t("cpViewAll")).length, 0);
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
  assert.equal(seed[7].name, "市场");
  assert.equal(seed[7].capacity, "5");
  assert.match(seed[7].charter, /新建市场部/);

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
  assert.equal(seed[6], false, "成功后应关闭对话框");
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
  assert.equal(seed[6], true, "失败时对话框保持打开");
  assert.match(String(seed[9]), /E_DEPT_DUPLICATE/);
  assert.match(String(seed[9]), /部门名称重复/);

  const react = makeReact(seed, { mutable: true });
  const { exports } = loadBundle(react, { fetch: companyFetch([]) });
  const text = treeText(exports.__internals.CompanyOrgPanel({ t }));
  assert.match(text, new RegExp(t("cpOpFailed")));
});

test("CompanyOrgPanel：公司未启用时显示提示条但仍渲染管理层节点", () => {
  const view = overviewFixture();
  view.enabled = false;
  const { t, tree } = renderCompany({ overview: view });
  const text = treeText(tree);
  assert.match(text, new RegExp(t("cpDisabled")));
  assert.ok(collectButtons(tree).some((button) => String(button.label).startsWith(t("cpManagement"))));
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
  assert.equal(seed[4], "dept-plugin", "点部门框应记录部门 id");
  assert.equal(seed[5], "chart", "默认应打开部门架构图页签");

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

test("部门弹层：成员详情页签每个员工只有「人事管理」按钮，四操作收进详情页", () => {
  const { t, tree, react, internals } = renderCompany({ deptModal: "dept-plugin", modalTab: "members" });
  assert.ok(tree);
  react.reset();
  const modalTree = internals.CompanyOrgPanel({ t });
  const text = treeText(modalTree);
  assert.match(text, /E0001/);
  assert.match(text, /E0002/);
  assert.match(text, /E0005/);
  assert.equal(buttonByLabel(modalTree, t("cpHire")).length, 1, "应有招聘入口");
  assert.equal(buttonByLabel(modalTree, t("cpHr")).length, 3, "每个员工一行人事管理");
  assert.equal(buttonByLabel(modalTree, t("cpChannels")).length, 0, "通道不再直接暴露在行上");
  assert.equal(buttonByLabel(modalTree, t("cpPromote")).length, 0, "晋升不再直接暴露在行上");
  assert.equal(buttonByLabel(modalTree, t("cpFire")).length, 0, "停用不再直接暴露在行上");
  assert.equal(buttonByLabel(modalTree, t("cpMove")).length, 0, "调岗不再直接暴露在行上");
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
  assert.equal(react._states[4], "dept-plugin");

  // 遮罩上的子元素点击（target !== currentTarget）→ 不关闭
  overlay.props.onClick({ target: {}, currentTarget: {} });
  assert.equal(react._states[4], "dept-plugin");

  // 关闭按钮
  buttonByLabel(tree, t("cpClose"))[0].onClick();
  assert.equal(react._states[4], null, "关闭按钮应关闭弹层");

  // 点遮罩本身
  react._states[4] = "dept-plugin";
  react.reset();
  const again = findModal(exports.__internals.CompanyOrgPanel({ t }));
  const self = {};
  again.overlay.props.onClick({ target: self, currentTarget: self });
  assert.equal(react._states[4], null, "点遮罩应关闭弹层");

  // ESC：effect 里注册 keydown，卸载后摘除
  react._states[4] = "dept-plugin";
  react.reset();
  const openTree = exports.__internals.CompanyOrgPanel({ t });
  assert.ok(findModal(openTree).overlay);
  const cleanups = react.flushEffects();
  assert.equal(listeners.length, 1, "弹层打开时应注册一个 keydown 监听");
  listeners[0]({ key: "a" });
  assert.equal(react._states[4], "dept-plugin", "非 Escape 键不关闭");
  listeners[0]({ key: "Escape" });
  assert.equal(react._states[4], null, "ESC 应关闭弹层");
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
  assert.equal(react._states[4], null, "部门已不存在时应自动关闭弹层");
});

test("写操作：晋升 → 人事详情内展开表单，POST promoteEmployee 后回落到详情并刷新 overview", async () => {
  const calls = [];
  const made = renderCompany({ deptModal: "dept-plugin", modalTab: "members", fetch: companyFetch(calls) });
  openHrAction(made, "E0001", made.t("cpPromote"));
  assert.equal(made.seed[10].kind, "promote");
  assert.equal(made.seed[10].employeeId, "emp-lead");
  assert.equal(made.seed[10].fromHr, true, "人事详情里打开的表单要标记 fromHr");

  made.react.reset();
  const tree = made.internals.CompanyOrgPanel(made.panelProps);
  const submit = primaryButton(tree, made.t("cpPromote"));
  assert.ok(submit, "详情页下方应展开晋升表单");
  await submit.onClick();
  await tick();

  const op = calls.find((c) => c.url.endsWith("/company/op"));
  assert.ok(op, "应发 /company/op");
  assert.deepEqual(op.body, { action: "promoteEmployee", args: { employeeId: "emp-lead", channel: "M", level: "M3" } });
  assert.equal(made.seed[4], "dept-plugin", "写操作成功后部门弹层保持打开");
  assert.equal(String(made.seed[10].kind), "hr", "保存后回落到人事详情（不是直接收起）");
  assert.equal(String(made.seed[10].employeeId), "emp-lead");
  assert.ok(calls.some((c) => c.url.endsWith("/company/overview")), "写操作后应刷新 overview");
});

test("写操作：人事详情里停用需 confirm；取消不发请求，确认后 POST fireEmployee 并回落到详情", async () => {
  const calls = [];
  const asked = [];
  let allow = false;
  const made = renderCompany({
    deptModal: "dept-plugin",
    modalTab: "members",
    fetch: companyFetch(calls),
    confirm: (message) => (asked.push(message), allow),
  });
  openHr(made, "E0001");
  made.react.reset();
  let tree = made.internals.CompanyOrgPanel(made.panelProps);
  buttonByLabel(tree, made.t("cpFire"))[0].onClick();
  assert.equal(asked.length, 1, "停用前应弹确认");
  assert.match(asked[0], /插件组负责人/);
  await tick();
  assert.equal(calls.filter((c) => c.url.endsWith("/company/op")).length, 0, "取消后不发请求");

  allow = true;
  made.react.reset();
  tree = made.internals.CompanyOrgPanel(made.panelProps);
  buttonByLabel(tree, made.t("cpFire"))[0].onClick();
  await tick();
  const op = calls.find((c) => c.url.endsWith("/company/op"));
  assert.ok(op);
  assert.deepEqual(op.body, { action: "fireEmployee", args: { employeeId: "emp-lead" } });
  assert.equal(String(made.seed[10].kind), "hr", "停用成功后回落到人事详情");
});

test("写操作：人事详情里调岗选择目标部门后 POST moveEmployee", async () => {
  const calls = [];
  const made = renderCompany({ deptModal: "dept-plugin", modalTab: "members", fetch: companyFetch(calls) });
  openHrAction(made, "E0002", made.t("cpMove"));
  assert.equal(made.seed[10].employeeId, "emp-dev");
  assert.equal(made.seed[10].department, "dept-doc", "默认目标 = 除当前部门外的第一个部门");

  made.react.reset();
  const tree = made.internals.CompanyOrgPanel(made.panelProps);
  const submit = primaryButton(tree, made.t("cpMove"));
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
  assert.equal(seed[10].kind, "hire");

  react.reset();
  modalTree = internals.CompanyOrgPanel({ t });
  const nameInput = collectElements(modalTree, (node) => node.type === "input" && node.props.placeholder === t("cpNewDeptName"))[0];
  assert.ok(nameInput, "招聘表单应有姓名输入框");
  nameInput.props.onChange({ target: { value: "新人甲" } });
  assert.equal(seed[10].displayName, "新人甲");

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
    args: {
      displayName: "新人甲",
      department: "dept-plugin",
      role: "staff",
      kind: "permanent",
      channels: [{ channel: "P", level: "P3" }],
    },
  });
  assert.equal(seed[4], "dept-plugin", "招聘成功后弹层保持打开");
  assert.equal(seed[10], null);
});

test("写操作失败：/company/op 返回 ok:false → 详情页红字 cpOpFailed + code，弹层与表单保持", async () => {
  const made = renderCompany({
    deptModal: "dept-plugin",
    modalTab: "members",
    fetch: companyFetch([], { opResult: { ok: false, code: "E_INVALID_LEVEL", message: "等级不存在" } }),
  });
  openHrAction(made, "E0001", made.t("cpPromote"));
  made.react.reset();
  const tree = made.internals.CompanyOrgPanel(made.panelProps);
  const submit = primaryButton(tree, made.t("cpPromote"));
  assert.ok(submit);
  await submit.onClick();
  await tick();

  assert.match(String(made.seed[8]), /E_INVALID_LEVEL/);
  assert.match(String(made.seed[8]), /等级不存在/);
  assert.equal(made.seed[4], "dept-plugin", "失败时部门弹层保持打开");
  assert.equal(String(made.seed[10].kind), "promote", "失败时表单保持展开");

  made.react.reset();
  const after = made.internals.CompanyOrgPanel(made.panelProps);
  assert.match(treeText(after), new RegExp(made.t("cpOpFailed")));
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

test("总架构页：打开拉一次、不注册自动轮询定时器，手动刷新再拉一次（v5.1）", async () => {
  const calls = [];
  const timers = [];
  const react = makeReactLive([null, null, false, null]);
  const { exports } = loadBundle(react, {
    fetch: companyFetch(calls),
    setInterval: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearInterval: () => {},
  });
  const t = translator("zh");
  react.reset();
  const tree = exports.__internals.CompanyOrgPanel({ t });
  assert.match(treeText(tree), new RegExp(t("cpLoading")), "首屏未拉到数据时显示加载中");
  assert.equal(treeText(tree).includes("每 5 秒自动刷新"), false, "不应再有自动刷新胶囊");

  react.flushEffects();
  assert.equal(timers.length, 0, "总架构页不应注册自动轮询定时器");
  await tick();
  assert.equal(calls.filter((c) => c.url.endsWith("/company/overview")).length, 1, "打开时拉一次");

  react.reset();
  const loaded = exports.__internals.CompanyOrgPanel({ t });
  assert.equal(treeText(loaded).includes("每 5 秒自动刷新"), false, "拉到数据后仍无自动刷新胶囊");
  const refresh = collectButtons(loaded).find((button) => button.label === t("cpRefresh"));
  assert.ok(refresh, "应有手动刷新按钮");
  refresh.onClick();
  await tick();
  assert.equal(calls.filter((c) => c.url.endsWith("/company/overview")).length, 2, "手动刷新触发第二次请求");
  assert.equal(timers.length, 0, "手动刷新也不应创建定时器");
});

test("总架构工具栏：标题 → 新建部门 → 刷新 → 更新于（全部左对齐）", () => {
  const react = makeReactLive([overviewFixture(), null, false, 1700000000000]);
  const { exports } = loadBundle(react, { fetch: companyFetch([]) });
  const t = translator("zh");
  react.reset();
  const tree = exports.__internals.CompanyOrgPanel({ t });

  const labels = collectButtons(tree).map((button) => String(button.label));
  const start = labels.indexOf(t("cpNewDept"));
  assert.ok(start >= 0, "工具栏应有新建部门按钮");
  assert.deepEqual(
    labels.slice(start, start + 2),
    [t("cpNewDept"), t("cpRefresh")],
    "按钮顺序应为 新建部门 → 刷新（v5.10 移除导入名册资料）",
  );

  const text = treeText(tree);
  assert.equal(text.includes("每 5 秒自动刷新"), false, "不应有自动刷新胶囊");
  assert.ok(text.indexOf(t("cpTitle")) < text.indexOf(t("cpNewDept")), "标题应在按钮之前");
  assert.ok(text.search(/更新于/) > text.indexOf(t("cpRefresh")), "更新于文本应在刷新按钮之后");
  const toolbarNode = collectElements(
    tree,
    (node) =>
      node.type === "div" &&
      node.props &&
      node.props.style &&
      node.props.style.marginBottom === 10 &&
      node.props.style.gap === 10,
  )[0];
  assert.ok(toolbarNode, "应能定位总架构工具栏");
  assert.equal(
    toolbarNode.children.some(
      (child) => child && child.props && child.props.style && child.props.style.marginLeft === "auto",
    ),
    false,
    "工具栏不应再有 marginLeft:auto 的 spacer（按钮全部左对齐）",
  );
});

/* ==================== ⑦ 删除部门（docs/16 §4.4 v4.1） ==================== */

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
  assert.equal(seed[4], "dept-plugin", "取消后弹层保持打开");
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
  assert.equal(seed[4], null, "删除成功后应关闭弹层");
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

  assert.match(String(seed[8]), /E_DEPT_NOT_EMPTY/);
  assert.match(String(seed[8]), /部门内仍有员工/);
  assert.equal(seed[4], "dept-plugin", "失败时弹层保持打开");

  react.reset();
  const after = internals.CompanyOrgPanel({ t });
  const text = treeText(after);
  assert.match(text, new RegExp(t("cpOpFailed")));
  assert.match(text, /E_DEPT_NOT_EMPTY/);
});

/* ==================== ⑧ v5：管理层 / 双通道徽章 / 通道编辑 ==================== */

test("双通道徽章：员工行每通道一个徽章，M 在前 P 在后且带等级名", () => {
  const made = renderCompany({ overview: dualOverview(), deptModal: "dept-plugin", modalTab: "members" });
  made.react.reset();
  const modalTree = made.internals.CompanyOrgPanel(made.panelProps);
  const row = employeeRowByCode(modalTree, "E0002");
  assert.ok(row, "应渲染 E0002 员工行");

  const text = treeText(row);
  assert.match(text, /M1 主管/, "应有 M 通道徽章");
  assert.match(text, /P4 资深工程师/, "应有 P 通道徽章");
  assert.ok(text.indexOf("M1 主管") < text.indexOf("P4 资深工程师"), "主通道徽章应在前");

  const built = made.internals.buildCompanyOrgView(dualOverview());
  const dev = built.employees.find((emp) => emp.code === "E0002");
  assert.equal(dev.channels.map((ch) => ch.channel).join(","), "M,P");
  assert.equal(dev.channels[0].primary, true, "无 primary 标记时首个（M）为主通道");
});

test("buildCompanyOrgView：无 overview.management 字段时从含 M 通道员工兜底聚合，排序按 部门编号→等级降序→工号", () => {
  const view = dualOverview();
  delete view.management;
  const { internals } = renderCompany();
  const built = internals.buildCompanyOrgView(view);

  assert.equal(built.management.channel, "M");
  assert.equal(built.management.employees.map((emp) => emp.code).join(","), "E0001,E0002", "同部门内按 M 等级降序");
  assert.equal(built.management.employees[1].departmentCode, "D01");
  assert.equal(built.counts.M, 2, "双通道员工在 M 人数里也计一次");
  assert.equal(built.counts.P, 4, "双通道员工在 P 人数里也计一次");
});

test("管理层只读弹层：无 M 员工时显示 cpMgmtEmpty 空态", () => {
  const made = renderCompany({ overview: emptyOrgFixture(), mgmtOpen: true });
  const modal = findMgmtModal(made.tree);
  assert.ok(modal.card, "应渲染管理层弹层");
  assert.match(treeText(modal.card), new RegExp(made.t("cpMgmtEmpty")));
});

test("管理层只读弹层：关闭按钮 / 点遮罩 / ESC 关闭，卡片内点击不关闭", () => {
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
  const react = makeReactLive(cpSeed({ mgmtOpen: true }));
  const { exports } = loadBundle(react, { fetch: overviewFetch([]), window: fakeWindow });
  const t = translator("zh");
  const tree = exports.__internals.CompanyOrgPanel({ t });
  const { overlay, card } = findMgmtModal(tree);
  assert.ok(overlay && card);

  let stopped = false;
  card.props.onClick({ stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, true);
  assert.equal(react._states[11], true, "卡片内点击不关闭");

  const self = {};
  overlay.props.onClick({ target: self, currentTarget: self });
  assert.equal(react._states[11], false, "点遮罩应关闭");

  react._states[11] = true;
  react.reset();
  const openTree = exports.__internals.CompanyOrgPanel({ t });
  buttonByLabel(findMgmtModal(openTree).card, t("cpClose"))[0].onClick();
  assert.equal(react._states[11], false, "关闭按钮应关闭");

  react._states[11] = true;
  react.reset();
  exports.__internals.CompanyOrgPanel({ t });
  const cleanups = react.flushEffects();
  const escListeners = listeners.filter((fn) => typeof fn === "function");
  assert.ok(escListeners.length >= 1, "弹层打开时应注册 keydown 监听");
  escListeners[escListeners.length - 1]({ key: "Escape" });
  assert.equal(react._states[11], false, "ESC 应关闭管理层弹层");
  const cleanup = cleanups.filter((fn) => typeof fn === "function").pop();
  assert.ok(cleanup);
  cleanup();
});

test("通道编辑：manager 的 M 强制勾选且禁用，window 的 M 禁用且不可勾选", () => {
  const made = renderCompany({ overview: roleFixture(), deptModal: "dept-plugin", modalTab: "members" });

  openHrAction(made, "E0001", made.t("cpChannels"));
  assert.equal(made.seed[10].kind, "channels");
  made.react.reset();
  let tree = made.internals.CompanyOrgPanel(made.panelProps);
  let boxes = checkboxInputs(tree);
  assert.equal(boxes.length, 2, "通道编辑应有 M/P 两个复选框");
  assert.equal(boxes[0].props.checked, true, "manager 的 M 强制勾选");
  assert.equal(boxes[0].props.disabled, true, "manager 的 M 不可取消");
  assert.equal(boxes[0].props.title, made.t("cpChannelLocked"));

  openHrAction(made, "E0006", made.t("cpChannels"));
  made.react.reset();
  tree = made.internals.CompanyOrgPanel(made.panelProps);
  boxes = checkboxInputs(tree);
  assert.equal(boxes.length, 2);
  assert.equal(boxes[0].props.checked, false, "window 不允许 M 通道");
  assert.equal(boxes[0].props.disabled, true, "window 的 M 禁用");
  assert.equal(boxes[1].props.checked, true, "window 的 P 通道保留");
});

test("写操作：通道编辑保存 POST setChannels（载荷含双通道），成功后回落到详情并显示已保存", async () => {
  const calls = [];
  const made = renderCompany({ deptModal: "dept-plugin", modalTab: "members", fetch: companyFetch(calls) });

  openHrAction(made, "E0002", made.t("cpChannels"));
  assert.equal(made.seed[10].employeeId, "emp-dev");
  assert.equal(made.seed[10].mChecked, false, "staff 默认不勾 M");
  assert.equal(made.seed[10].pChecked, true);

  made.react.reset();
  let tree = made.internals.CompanyOrgPanel(made.panelProps);
  checkboxInputs(tree)[0].props.onChange({ target: { checked: true } });
  assert.equal(made.seed[10].mChecked, true);

  made.react.reset();
  tree = made.internals.CompanyOrgPanel(made.panelProps);
  const submit = primaryButton(tree, made.t("cpSave"));
  assert.ok(submit, "通道编辑应有保存按钮");
  assert.equal(submit.disabled, false);
  await submit.onClick();
  await tick();

  const op = calls.find((c) => c.url.endsWith("/company/op"));
  assert.ok(op, "应发 /company/op");
  assert.deepEqual(op.body, {
    action: "setChannels",
    args: {
      employeeId: "emp-dev",
      channels: [{ channel: "M", level: "M2" }, { channel: "P", level: "P4" }],
    },
  });
  assert.ok(calls.some((c) => c.url.endsWith("/company/overview")), "保存成功后刷新 overview");
  assert.equal(made.seed[4], "dept-plugin", "部门弹层保持打开");
  assert.equal(String(made.seed[10].kind), "hr", "成功后回落到人事详情");
  assert.equal(made.seed[12], made.t("cpSaved"), "成功提示已保存");
});

test("通道编辑：至少保留一个通道——全部取消时保存禁用并显示 cpChannelRequired", () => {
  const made = renderCompany({ deptModal: "dept-plugin", modalTab: "members" });
  openHrAction(made, "E0002", made.t("cpChannels"));

  made.react.reset();
  let tree = made.internals.CompanyOrgPanel(made.panelProps);
  checkboxInputs(tree)[1].props.onChange({ target: { checked: false } });
  assert.equal(made.seed[10].pChecked, false);

  made.react.reset();
  tree = made.internals.CompanyOrgPanel(made.panelProps);
  assert.match(treeText(tree), new RegExp(made.t("cpChannelRequired")));
  const save = buttonByLabel(tree, made.t("cpSave"))[0];
  assert.ok(save);
  assert.equal(save.disabled, true, "至少一选未满足时保存禁用");
});

test("通道编辑保存失败：ok:false → 弹层内红字 cpOpFailed + code，详情与表单保持打开", async () => {
  const made = renderCompany({
    deptModal: "dept-plugin",
    modalTab: "members",
    fetch: companyFetch([], { opResult: { ok: false, code: "E_LAST_CHANNEL", message: "至少保留一个通道" } }),
  });
  openHrAction(made, "E0002", made.t("cpChannels"));

  made.react.reset();
  const tree = made.internals.CompanyOrgPanel(made.panelProps);
  const submit = primaryButton(tree, made.t("cpSave"));
  assert.ok(submit);
  await submit.onClick();
  await tick();

  assert.equal(made.seed[4], "dept-plugin", "失败时弹层保持打开");
  assert.match(String(made.seed[8]), /E_LAST_CHANNEL/);
  assert.equal(String(made.seed[10].kind), "channels", "失败时表单保持展开");
  made.react.reset();
  const after = made.internals.CompanyOrgPanel(made.panelProps);
  const text = treeText(after);
  assert.match(text, new RegExp(made.t("cpOpFailed")));
  assert.match(text, /E_LAST_CHANNEL/);
});

test("晋升：人事详情里通道选择默认主通道——双通道员工默认 M，单 P 员工默认 P", () => {
  const dual = renderCompany({ overview: dualOverview(), deptModal: "dept-plugin", modalTab: "members" });
  openHrAction(dual, "E0002", dual.t("cpPromote"));
  assert.equal(dual.seed[10].employeeId, "emp-dev");
  assert.equal(dual.seed[10].channel, "M", "双通道员工默认 M 主通道");

  const single = renderCompany({ deptModal: "dept-plugin", modalTab: "members" });
  openHrAction(single, "E0002", single.t("cpPromote"));
  assert.equal(single.seed[10].employeeId, "emp-dev");
  assert.equal(single.seed[10].channel, "P", "单 P 员工默认 P 通道");
});

test("招聘：通道选择可选——勾选 M 后 createEmployee channels 含 M2 与 P3", async () => {
  const calls = [];
  const made = renderCompany({ deptModal: "dept-plugin", modalTab: "members", fetch: companyFetch(calls) });
  made.react.reset();
  let modalTree = made.internals.CompanyOrgPanel(made.panelProps);
  buttonByLabel(modalTree, made.t("cpHire"))[0].onClick();
  assert.equal(made.seed[10].kind, "hire");

  made.react.reset();
  modalTree = made.internals.CompanyOrgPanel(made.panelProps);
  const nameInput = collectElements(modalTree, (node) => node.type === "input" && node.props.placeholder === made.t("cpNewDeptName"))[0];
  assert.ok(nameInput, "招聘表单应有姓名输入框");
  nameInput.props.onChange({ target: { value: "双通道新人" } });

  made.react.reset();
  modalTree = made.internals.CompanyOrgPanel(made.panelProps);
  const boxes = checkboxInputs(modalTree);
  assert.equal(boxes.length, 2, "招聘表单应有 M/P 两个复选框");
  assert.equal(boxes[0].props.checked, false, "默认不勾 M");
  assert.equal(boxes[1].props.checked, true, "默认勾 P");
  boxes[0].props.onChange({ target: { checked: true } });

  made.react.reset();
  modalTree = made.internals.CompanyOrgPanel(made.panelProps);
  const submit = primaryButton(modalTree, made.t("cpHire"));
  assert.ok(submit);
  await submit.onClick();
  await tick();

  const op = calls.find((c) => c.url.endsWith("/company/op"));
  assert.ok(op);
  assert.deepEqual(op.body.args.channels, [{ channel: "M", level: "M2" }, { channel: "P", level: "P3" }]);
});

/* ==================== ⑨ v5.4：人事管理详情页 ==================== */

test("人事管理详情：头部 + 基本信息（部门/类型/角色/状态/会话策略/通道）+ 名册提示 + 四操作", () => {
  const made = renderCompany({ deptModal: "dept-plugin", modalTab: "members" });
  openHr(made, "E0001");
  assert.equal(made.seed[10].kind, "hr");
  assert.equal(made.seed[10].employeeId, "emp-lead");

  made.react.reset();
  const tree = made.internals.CompanyOrgPanel(made.panelProps);
  const text = treeText(tree);
  assert.match(text, /人事管理/);
  assert.match(text, /E0001/);
  assert.match(text, /插件组负责人/);
  assert.match(text, /部门 \[D01\] 插件组/);
  assert.match(text, /类型 permanent/);
  assert.match(text, /角色 管理岗/);
  assert.match(text, /状态 工作中/);
  assert.match(text, /会话策略 常驻成员 · 独立会话/);
  assert.match(text, /通道说明 M M2 经理/);
  assert.match(text, /公司化资料/);
  assert.equal(text.includes("未关联名册成员"), false, "公司化资料不依赖名册条目");
  assert.match(text, /人事操作/);
  assert.ok(buttonByLabel(tree, made.t("cpClose")).length >= 1, "详情头部有关闭按钮");
  for (const action of ["cpChannels", "cpPromote", "cpFire", "cpMove"]) {
    assert.equal(buttonByLabel(tree, made.t(action)).length, 1, "详情页应有：" + action);
  }
});

test("人事详情：四操作都在详情页内，点击向下展开原表单（fromHr）；取消回落到详情", () => {
  const made = renderCompany({ deptModal: "dept-plugin", modalTab: "members" });

  openHrAction(made, "E0001", made.t("cpChannels"));
  assert.equal(made.seed[10].kind, "channels");
  assert.equal(made.seed[10].fromHr, true);
  made.react.reset();
  let tree = made.internals.CompanyOrgPanel(made.panelProps);
  assert.ok(primaryButton(tree, made.t("cpSave")), "详情页下方应展开通道表单");
  buttonByLabel(tree, made.t("cancel"))[0].onClick();
  assert.equal(String(made.seed[10].kind), "hr", "取消后回到人事详情");

  openHrAction(made, "E0001", made.t("cpPromote"));
  assert.equal(made.seed[10].kind, "promote");
  assert.equal(made.seed[10].fromHr, true);
  made.react.reset();
  tree = made.internals.CompanyOrgPanel(made.panelProps);
  assert.ok(primaryButton(tree, made.t("cpPromote")), "详情页下方应展开晋升表单");

  openHrAction(made, "E0002", made.t("cpMove"));
  assert.equal(made.seed[10].kind, "move");
  assert.equal(made.seed[10].fromHr, true);
  made.react.reset();
  tree = made.internals.CompanyOrgPanel(made.panelProps);
  assert.ok(primaryButton(tree, made.t("cpMove")), "详情页下方应展开调岗表单");
});

test("公司化资料：展示可编辑字段，保存单次 POST updateEmployeeProfile 并刷新", async () => {
  const calls = [];
  let refreshed = 0;
  const made = renderCompany({
    deptModal: "dept-plugin",
    modalTab: "members",
    fetch: companyFetch(calls),
  });
  openHr(made, "E0001");
  made.react.reset();
  let tree = made.internals.CompanyOrgPanel(made.panelProps);
  const text = treeText(tree);
  assert.match(text, /公司化资料/);
  assert.equal(text.includes(made.t("cpHrSave")), false, "v5.8 不再显示旧「保存名册资料」按钮");

  made.react.reset();
  tree = made.internals.CompanyOrgPanel(made.panelProps);
  collectElements(tree, (node) => node.type === "input" && node.props.placeholder === made.t("displayName"))[0].props.onChange({ target: { value: "新负责人" } });

  made.react.reset();
  tree = made.internals.CompanyOrgPanel(made.panelProps);
  collectElements(tree, (node) => node.type === "input" && node.props.placeholder === made.t("role"))[0].props.onChange({ target: { value: "负责人" } });

  made.react.reset();
  tree = made.internals.CompanyOrgPanel(made.panelProps);
  buttonByLabel(tree, made.t("cpAddDuty"))[0].onClick();
  made.react.reset();
  tree = made.internals.CompanyOrgPanel(made.panelProps);
  const dutyInputs = collectElements(tree, (node) => node.type === "input" && node.props.placeholder === made.t("duties"));
  dutyInputs[dutyInputs.length - 1].props.onChange({ target: { value: "汇报" } });

  made.react.reset();
  tree = made.internals.CompanyOrgPanel(made.panelProps);
  const save = buttonByLabel(tree, made.t("cpSaveProfile"))[0];
  assert.ok(save, "应有保存公司化资料按钮");
  await save.onClick();
  await tick();

  const ops = calls.filter((c) => c.url.endsWith("/company/op")).map((c) => c.body);
  assert.equal(ops.length, 1, "保存公司化资料只发一次 /company/op");
  assert.equal(ops[0].action, "updateEmployeeProfile");
  assert.equal(ops[0].args.employeeId, "emp-lead");
  assert.equal(ops[0].args.displayName, "新负责人");
  assert.equal(ops[0].args.title, "负责人");
  assert.ok(ops[0].args.duties.includes("汇报"), "职责条目应随保存提交");
  assert.ok(ops[0].args.duties.length <= 8, "职责最多 8 条");
  assert.ok(calls.some((c) => c.url.endsWith("/company/overview")), "保存后应刷新 overview");
  assert.equal(String(made.seed[10].kind), "hr", "保存后详情保持打开");
  assert.equal(made.seed[12], made.t("cpSaved"), "保存成功提示");
});

test("调岗表单：选择目标部门后 POST moveEmployee，不再写名册分组", async () => {
  const calls = [];
  const made = renderCompany({ deptModal: "dept-plugin", modalTab: "members", fetch: companyFetch(calls) });

  openHrAction(made, "E0002", made.t("cpMove"));
  made.react.reset();
  const tree = made.internals.CompanyOrgPanel(made.panelProps);
  assert.equal(treeText(tree).includes(made.t("cpHrGroup")), false, "调岗表单不应再有「名册部门」下拉");

  made.react.reset();
  await primaryButton(made.internals.CompanyOrgPanel(made.panelProps), made.t("cpMove")).onClick();
  await tick();

  const companyOps = calls.filter((c) => c.url.endsWith("/company/op")).map((c) => c.body);
  assert.deepEqual(companyOps[0], { action: "moveEmployee", args: { employeeId: "emp-dev", department: "dept-doc" } });
  const registryOps = calls.filter((c) => c.url.endsWith("/op") && !c.url.endsWith("/company/op"));
  assert.equal(registryOps.length, 0, "调岗不应再写名册分组");
  assert.equal(String(made.seed[10].kind), "hr", "调岗成功后回到人事详情");
});

test("公司化资料：岗位职责按条目单列，最多 8 条且不再要求每行一条", () => {
  const made = renderCompany({ deptModal: "dept-plugin", modalTab: "members" });
  openHr(made, "E0002");
  made.react.reset();
  const tree = made.internals.CompanyOrgPanel(made.panelProps);
  const inputs = collectElements(tree, (node) => node.type === "input" && node.props.placeholder === made.t("duties"));
  assert.equal(inputs.length, 8, "岗位职责应按条目单列");
  assert.equal(buttonByLabel(tree, made.t("cpAddDuty")).length, 0, "达到 8 条后不再显示添加按钮");
  assert.equal(inputByPlaceholder(tree, made.t("dutiesHint")), undefined, "不再有「每行一条」文本框");
});

test("v5.5 技能选择弹层：打开时拉 /skills 目录，支持关键词过滤与勾选", async () => {
  const calls = [];
  const react = makeReactLive([null, "", null]);
  const { exports } = loadBundle(react, { fetch: companyFetch(calls) });
  const t = translator("zh");
  exports.__internals.SkillPicker({ t, selected: [], onToggle: () => {}, onClose: () => {} });
  react.flushEffects();
  await tick();
  react.reset();
  let tree = exports.__internals.SkillPicker({ t, selected: [], onToggle: () => {}, onClose: () => {} });
  assert.ok(calls.some((c) => c.url.endsWith("/skills")), "打开时应拉 /skills");
  assert.match(treeText(tree), /react/, "目录应列出 react");
  assert.match(treeText(tree), /node/, "目录应列出 node");

  const searchInput = collectElements(tree, (n) => n.type === "input" && n.props.placeholder === t("searchSkills"))[0];
  assert.ok(searchInput, "弹层应有技能搜索框");
  searchInput.props.onChange({ target: { value: "nod" } });
  react.reset();
  tree = exports.__internals.SkillPicker({ t, selected: [], onToggle: () => {}, onClose: () => {} });
  assert.match(treeText(tree), /node/);
  assert.doesNotMatch(treeText(tree), /react/, "关键词应过滤掉不匹配项");
});

test("v5.5 人事详情：技能选择弹层——按钮带已选数量、勾选写回草稿、关闭只清弹层", () => {
  const made = renderCompany({
    deptModal: "dept-plugin",
    modalTab: "members",
    fetch: companyFetch([]),
  });
  openHr(made, "E0001");
  made.react.reset();
  let tree = made.internals.CompanyOrgPanel(made.panelProps);
  const skillsButton = buttonByLabel(tree, made.t("pickSkills"))[0];
  assert.ok(skillsButton, "公司化资料应有「选择技能」按钮");
  skillsButton.onClick();
  assert.equal(String(made.seed[13].kind), "skills", "应打开技能选择弹层");
  assert.deepEqual(made.seed[13].selected, ["react"], "弹层初值 = 员工公司化资料现有技能");

  made.react.reset();
  tree = made.internals.CompanyOrgPanel(made.panelProps);
  const picker = collectElements(tree, (n) => n.type === made.internals.SkillPicker)[0];
  assert.ok(picker, "应渲染 SkillPicker");
  picker.props.onToggle("node");
  assert.equal(seed10(made).skillsText, "react, node", "勾选应写回公司化资料草稿");
  assert.deepEqual(made.seed[13].selected, ["react", "node"]);

  made.react.reset();
  tree = made.internals.CompanyOrgPanel(made.panelProps);
  collectElements(tree, (n) => n.type === made.internals.SkillPicker)[0].props.onToggle("react");
  assert.equal(seed10(made).skillsText, "node", "取消勾选应从草稿移除");

  made.react.reset();
  tree = made.internals.CompanyOrgPanel(made.panelProps);
  collectElements(tree, (n) => n.type === made.internals.SkillPicker)[0].props.onClose();
  assert.equal(made.seed[13], null, "关闭弹层后草稿保留、弹层状态清空");
  assert.equal(seed10(made).skillsText, "node");
});

test("v5.5 人事详情：模型选择弹层——打开拉 /models、选择写回 provider/model、使用默认清空", async () => {
  const calls = [];
  const made = renderCompany({
    deptModal: "dept-plugin",
    modalTab: "members",
    fetch: companyFetch(calls),
  });
  openHr(made, "E0001");
  made.react.reset();
  let tree = made.internals.CompanyOrgPanel(made.panelProps);
  const modelButton = buttonByLabel(tree, made.t("pickModel"))[0];
  assert.ok(modelButton, "公司化资料应有「选择模型」按钮");
  modelButton.onClick();
  await tick();
  assert.equal(String(made.seed[13].kind), "model", "应打开模型选择弹层");
  assert.ok(calls.some((c) => c.url.endsWith("/models")), "打开模型弹层应拉取 /models 目录");
  assert.equal(made.seed[14].length, 2, "目录应缓存到 modelProviders");

  made.react.reset();
  tree = made.internals.CompanyOrgPanel(made.panelProps);
  const picker = collectElements(tree, (n) => n.type === made.internals.ModelPicker)[0];
  assert.ok(picker, "应渲染 ModelPicker");
  picker.props.onPick("p-2", "m-2");
  assert.equal(seed10(made).provider, "p-2");
  assert.equal(seed10(made).model, "m-2");
  assert.equal(made.seed[13], null, "选择后关闭弹层");

  made.react.reset();
  tree = made.internals.CompanyOrgPanel(made.panelProps);
  buttonByLabel(tree, made.t("pickModel"))[0].onClick();
  made.react.reset();
  tree = made.internals.CompanyOrgPanel(made.panelProps);
  collectElements(tree, (n) => n.type === made.internals.ModelPicker)[0].props.onClear();
  assert.equal(seed10(made).provider, "", "使用默认应清空 provider");
  assert.equal(seed10(made).model, "", "使用默认应清空 model");
});

test("Panel：CompanyOrgPanel 只接收 t，不再传名册 props（v5.9 清理）", () => {
  const { tree, internals } = renderPanel();
  const company = collectElements(tree, (node) => node.type === internals.CompanyOrgPanel)[0];
  assert.ok(company, "默认应渲染 CompanyOrgPanel");
  assert.deepEqual(Object.keys(company.props).sort(), ["t"], "公司化面板不再依赖名册数据");
});

/* ==================== v5.11：管理层重命名 / 编号规则 / 等级通道 / 部门编辑 ==================== */

test("源码：v5.11 四个编辑器入口与四个 op 均已接线", () => {
  const src = fs.readFileSync(BUNDLE, "utf8");
  for (const key of [
    "cpRename",
    "cpMgmtName",
    "cpEditNumbering",
    "cpEditLevels",
    "cpDeptEdit",
    "cpSaveNumbering",
    "cpSaveLevels",
    "cpEmpPattern",
    "cpDeptPattern",
    "cpChannelLabelLabel",
    "cpBorrowPolicyField",
  ]) {
    assert.ok(src.includes(key + ":"), `字典应包含 ${key}`);
  }
  assert.ok(src.includes('opPost("setManagementName"'), "应 POST setManagementName");
  assert.ok(src.includes('opPost("setNumbering"'), "应 POST setNumbering");
  assert.ok(src.includes('opPost("setLevels"'), "应 POST setLevels");
  assert.ok(src.includes("managementName"), "视图应读取 managementName");
  assert.ok(src.includes("numberingModalEl") && src.includes("levelsModalEl"), "应有两个配置弹层");
});

test("管理层弹层：重命名 → POST setManagementName，成功后刷新并提示已保存", async () => {
  const calls = [];
  const made = renderCompany({ fetch: companyFetch(calls) });
  const mgmt = collectButtons(made.tree).find((button) => String(button.label).startsWith(made.t("cpManagement")));
  assert.ok(mgmt, "架构图应有管理层节点");
  mgmt.onClick();
  assert.equal(made.seed[11], true, "点击管理层应打开只读弹层");

  made.react.reset();
  let tree = made.internals.CompanyOrgPanel(made.panelProps);
  const rename = buttonByLabel(tree, made.t("cpRename"))[0];
  assert.ok(rename, "弹层应有重命名按钮");
  rename.onClick();
  assert.equal(made.seed[15], made.t("cpManagement"), "默认填入当前管理层名称");

  made.react.reset();
  tree = made.internals.CompanyOrgPanel(made.panelProps);
  const input = collectElements(tree, (node) => node.type === "input")[0];
  assert.equal(input.props.value, made.t("cpManagement"));
  input.props.onChange({ target: { value: "执行管理层" } });

  made.react.reset();
  tree = made.internals.CompanyOrgPanel(made.panelProps);
  const save = buttonByLabel(tree, made.t("cpSave"))[0];
  assert.ok(save, "应有保存按钮");
  await save.onClick();
  await tick();

  const op = calls.find((call) => call.method === "POST" && /\/company\/op$/.test(call.url));
  assert.ok(op, "应调用 /company/op");
  assert.equal(op.body.action, "setManagementName");
  assert.deepEqual(op.body.args, { name: "执行管理层" });
  assert.equal(made.seed[15], null, "保存成功后关闭重命名输入");
  assert.equal(made.seed[12], made.t("cpSaved"), "应提示已保存");
});

test("总架构 meta 卡：自定义编号规则 → POST setNumbering（含 {seq} 与起始号）", async () => {
  const calls = [];
  const made = renderCompany({ fetch: companyFetch(calls) });
  const edit = buttonByLabel(made.tree, made.t("cpCustomize"))[0];
  assert.ok(edit, "meta 卡应有自定义（编号规则）按钮");
  edit.onClick();
  assert.equal(made.seed[16], true, "应打开编号规则弹层");

  made.react.reset();
  let tree = made.internals.CompanyOrgPanel(made.panelProps);
  const pattern = collectElements(tree, (node) => node.type === "input").find((node) => String(node.props.value).includes("{seq"));
  assert.ok(pattern, "应有编号模板输入");
  pattern.props.onChange({ target: { value: "EMP{seq:3}" } });

  made.react.reset();
  tree = made.internals.CompanyOrgPanel(made.panelProps);
  const save = buttonByLabel(tree, made.t("cpSaveNumbering"))[0];
  assert.ok(save, "应有保存编号规则按钮");
  await save.onClick();
  await tick();

  const op = calls.find((call) => call.method === "POST" && /\/company\/op$/.test(call.url));
  assert.equal(op.body.action, "setNumbering");
  assert.equal(op.body.args.employee.pattern, "EMP{seq:3}");
  assert.equal(op.body.args.employee.start, 1);
  assert.equal(op.body.args.department.pattern.includes("{seq"), true);
  assert.equal(made.seed[16], false, "保存成功后关闭弹层");
});

test("总架构 meta 卡：自定义等级通道 → POST setLevels（只改名称、代号原样）", async () => {
  const calls = [];
  const made = renderCompany({ fetch: companyFetch(calls) });
  const edit = buttonByLabel(made.tree, made.t("cpCustomize"))[1];
  assert.ok(edit, "meta 卡应有自定义（等级通道）按钮");
  edit.onClick();
  assert.equal(made.seed[18], true, "应打开等级通道弹层");

  made.react.reset();
  let tree = made.internals.CompanyOrgPanel(made.panelProps);
  const level = collectElements(tree, (node) => node.type === "input").find((node) => String(node.props.value) === "经理");
  assert.ok(level, "应有 M2 名称输入");
  level.props.onChange({ target: { value: "项目经理" } });

  made.react.reset();
  tree = made.internals.CompanyOrgPanel(made.panelProps);
  const save = buttonByLabel(tree, made.t("cpSaveLevels"))[0];
  await save.onClick();
  await tick();

  const op = calls.find((call) => call.method === "POST" && /\/company\/op$/.test(call.url));
  assert.equal(op.body.action, "setLevels");
  const m2 = op.body.args.levels.M.levels.find((row) => row.code === "M2");
  assert.equal(m2.name, "项目经理");
  assert.equal(op.body.args.levels.M.levels.length, LEVELS.M.levels.length, "未增删时等级数量不变");
  assert.equal(op.body.args.levels.P.levels.length, LEVELS.P.levels.length);
  assert.equal(made.seed[18], false);
});

test("自定义等级通道：可添加等级（代号自动递增）并提交数量变化", async () => {
  const calls = [];
  const made = renderCompany({ fetch: companyFetch(calls) });
  const edit = buttonByLabel(made.tree, made.t("cpCustomize"))[1];
  edit.onClick();
  assert.equal(made.seed[18], true, "应打开等级通道弹层");

  made.react.reset();
  let tree = made.internals.CompanyOrgPanel(made.panelProps);
  const add = buttonByLabel(tree, made.t("cpAddLevel"))[0];
  assert.ok(add, "应有添加等级按钮");
  add.onClick();

  made.react.reset();
  tree = made.internals.CompanyOrgPanel(made.panelProps);
  const inputs = collectElements(tree, (node) => node.type === "input");
  const newLevel = inputs.find((node) => !node.props.value);
  assert.ok(newLevel, "应出现一个空名称的新等级输入框");
  newLevel.props.onChange({ target: { value: "资深总监" } });

  made.react.reset();
  tree = made.internals.CompanyOrgPanel(made.panelProps);
  const save = buttonByLabel(tree, made.t("cpSaveLevels"))[0];
  await save.onClick();
  await tick();

  const op = calls.find((call) => call.method === "POST" && /\/company\/op$/.test(call.url));
  assert.ok(op, "应提交 setLevels");
  assert.equal(op.body.action, "setLevels");
  const levels = op.body.args.levels.M.levels;
  assert.equal(levels.length, LEVELS.M.levels.length + 1, "提交后 M 通道多一级");
  const added = levels[levels.length - 1];
  assert.equal(added.code, "M4", "新等级代号自动递增（M3 之后为 M4）");
  assert.equal(added.name, "资深总监");
});

test("自定义等级通道：删除前序等级后自动顺位，提交 levelRemap", async () => {
  const calls = [];
  const made = renderCompany({ fetch: companyFetch(calls) });
  const edit = buttonByLabel(made.tree, made.t("cpCustomize"))[1];
  edit.onClick();
  assert.equal(made.seed[18], true, "应打开等级通道弹层");

  made.react.reset();
  let tree = made.internals.CompanyOrgPanel(made.panelProps);
  const removeButtons = buttonByLabel(tree, made.t("cpRemoveLevel"));
  assert.equal(removeButtons.length, LEVELS.M.levels.length + LEVELS.P.levels.length, "每个等级都有删除按钮");
  removeButtons[LEVELS.M.levels.length].onClick(); // P1

  made.react.reset();
  tree = made.internals.CompanyOrgPanel(made.panelProps);
  const save = buttonByLabel(tree, made.t("cpSaveLevels"))[0];
  await save.onClick();
  await tick();

  const op = calls.find((call) => call.method === "POST" && /\/company\/op$/.test(call.url));
  assert.ok(op, "应提交 setLevels");
  const levels = op.body.args.levels.P.levels;
  assert.equal(levels.length, LEVELS.P.levels.length - 1, "删除后 P 通道少一级");
  assert.equal(levels[0].code, "P1", "后续等级自动顺位");
  assert.equal(levels[0].name, "工程师", "原 P2 顺位为 P1");
  assert.deepEqual(op.body.args.levelRemap.P, { P2: "P1", P3: "P2", P4: "P3", P5: "P4" }, "提交 levelRemap 供宿主重映射员工");
});

test("部门弹层：部门编辑 → POST updateDepartment 带 borrowPolicy/accepts", async () => {
  const calls = [];
  const made = renderCompany({ deptModal: "dept-plugin", fetch: companyFetch(calls) });
  const edit = buttonByLabel(made.tree, made.t("cpDeptEdit"))[0];
  assert.ok(edit, "部门弹层应有部门编辑按钮");
  edit.onClick();
  assert.equal(made.seed[20], true, "应展开部门编辑表单");
  assert.equal(made.seed[21].name, "插件组");

  made.react.reset();
  let tree = made.internals.CompanyOrgPanel(made.panelProps);
  const name = collectElements(tree, (node) => node.type === "input").find((node) => String(node.props.value) === "插件组");
  name.props.onChange({ target: { value: "插件部" } });
  made.react.reset();
  tree = made.internals.CompanyOrgPanel(made.panelProps);
  const policy = collectElements(tree, (node) => node.type === "input").find((node) => String(node.props.value) === "{}");
  policy.props.onChange({ target: { value: '{"mode":"borrow-only"}' } });
  made.react.reset();
  tree = made.internals.CompanyOrgPanel(made.panelProps);
  const save = buttonByLabel(tree, made.t("cpSave"))[0];
  await save.onClick();
  await tick();

  const op = calls.find((call) => call.method === "POST" && /\/company\/op$/.test(call.url));
  assert.equal(op.body.action, "updateDepartment");
  assert.equal(op.body.args.departmentId, "dept-plugin");
  assert.equal(op.body.args.name, "插件部");
  assert.equal(op.body.args.code, "D01");
  assert.deepEqual(op.body.args.borrowPolicy, { mode: "borrow-only" });
  assert.deepEqual(op.body.args.accepts, []);
  assert.equal(made.seed[20], false);
});
