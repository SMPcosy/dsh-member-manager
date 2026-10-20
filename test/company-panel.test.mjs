/**
 * 「公司架构」面板（docs/16 §4.1 / §5）的离线测试：不需要浏览器，也不需要 DSH 在运行。
 *
 * 做法与 client-bundle.test.mjs 一致：
 *  1. 用 node:vm + `window.__ModuleLoader__.load` 把 lib/client.js 真实加载进来
 *     （require 替身只提供 react），拿到 exports 与 __internals
 *  2. 用 apply() 捕获真实的中英文字典，再把 t 做成真实插值函数，
 *     这样断言的是用户最终看到的中文文案，而不是 key
 *  3. 用种子化 hooks 的 react 替身直接执行 Panel / CompanyOrgPanel 的函数体，
 *     从真实元素树里断言部门卡片、工号、等级徽章、图例、编号规则与各级空态
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

/* ==================== react 替身 ==================== */

/** 种子化 hooks：seed 按调用顺序给 useState 喂初值，setter 可写入（便于验证页签切换）。 */
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
function makeReactLive() {
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
      if (!(i in states)) states[i] = init;
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
    setTimeout,
    clearTimeout,
    setInterval: globals.setInterval || setInterval,
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
  if (node.type === "button") out.push({ label: textOf(node), onClick: node.props.onClick, disabled: node.props.disabled });
  for (const child of node.children || []) collectButtons(child, out);
  return out;
}

function collectElements(node, predicate, out = []) {
  if (!node || typeof node !== "object") return out;
  if (predicate(node)) out.push(node);
  for (const child of node.children || []) collectElements(child, predicate, out);
  return out;
}

function collectTitled(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (node.props && typeof node.props.title === "string" && node.props.title) {
    out.push({ title: node.props.title, text: textOf(node), style: node.props.style || {} });
  }
  for (const child of node.children || []) collectTitled(child, out);
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
        {
          id: "emp-lead",
          code: "E0001",
          displayName: "插件组负责人",
          department: "dept-plugin",
          departmentCode: "D01",
          channel: "M",
          level: "M2",
          levelName: "经理",
          role: "manager",
          kind: "permanent",
          state: "working",
        },
        {
          id: "emp-dev",
          code: "E0002",
          displayName: "插件工程师",
          department: "dept-plugin",
          departmentCode: "D01",
          channel: "P",
          level: "P4",
          levelName: "资深工程师",
          role: "staff",
          kind: "permanent",
          state: "idle",
        },
        {
          id: "emp-doc",
          code: "E0003",
          displayName: "文档工程师",
          department: "dept-doc",
          departmentCode: "D02",
          channel: "P",
          level: "P3",
          levelName: "高级工程师",
          role: "staff",
          kind: "temp",
          state: "cold",
        },
        { id: "emp-free", code: "E0004", displayName: "特聘专家", department: null, departmentCode: null, channel: "P", level: "P5", levelName: "技术专家", role: "staff", kind: "shared", state: "idle" },
      ],
    },
    levels: LEVELS,
    numbering: NUMBERING,
  };
}

/** Panel 需要的 state 视图（沿用 client-bundle.test.mjs 的最小形状） */
function sampleView() {
  return {
    coreAvailable: true,
    stats: { members: 2, active: 2, retired: 0, groups: 1 },
    groups: [
      {
        id: "g-1",
        name: "数据组",
        description: "知识库与核查",
        members: [
          {
            target: "data-organizer",
            displayName: "数据整理员",
            title: "知识库整理员",
            duties: ["清点", "诊断"],
            skills: ["office-docx"],
            groupId: "g-1",
            status: "active",
            isRetired: false,
            orphan: false,
          },
        ],
      },
    ],
    ungrouped: [],
    unregistered: [],
    warnings: [],
  };
}

/** 只回 overview 的 fetch 替身；返回 data 本体 */
function overviewFetch(calls = [], data = overviewFixture()) {
  return async (url, init) => {
    calls.push({ url: String(url), method: (init && init.method) || "GET" });
    return { ok: true, status: 200, json: async () => ({ ok: true, data }) };
  };
}

/* ==================== ① 源码与字典 ==================== */

test("源码：新增「公司架构」中英文案与 overview 轮询，且不把动态文本拼成 innerHTML", () => {
  const src = fs.readFileSync(BUNDLE, "utf8");
  assert.match(src, /cpTab: "公司架构"/);
  assert.match(src, /cpTab: "Company org"/);
  assert.match(src, /CompanyOrgPanel/);
  assert.match(src, /api\("\/company\/overview"\)/);
  assert.match(src, /setInterval\(pull, CP_POLL_MS\)/);
  assert.match(src, /const CP_POLL_MS = 5000;/);
  // 页签与分支接线
  assert.match(src, /tabBtn\("company", t\("cpTab"\), ""\)/);
  assert.match(src, /tab === "company" \? h\(CompanyOrgPanel, \{ t: t \}\) : null/);
  // 安全：不写 HTML 字符串
  assert.equal(/\.innerHTML\s*=/.test(src), false, "不应给 innerHTML 赋值");
  assert.equal(src.includes("dangerouslySetInnerHTML"), false, "不应使用 dangerouslySetInnerHTML");
});

test("字典：cp* 文案 zh/en 一一对应，中文与 docs/16 §5 一致", () => {
  const { zh, en } = dictionaries();
  const zhCp = Object.keys(zh)
    .filter((k) => k.startsWith("cp"))
    .sort();
  const enCp = Object.keys(en)
    .filter((k) => k.startsWith("cp"))
    .sort();
  assert.ok(zhCp.length >= 30, `cp* 文案过少：${zhCp.length}`);
  assert.deepEqual(zhCp, enCp);
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort(), "zh 与 en 的 key 必须完全一致");

  // 契约点名的 key
  assert.equal(zh.cpTab, "公司架构");
  assert.equal(en.cpTab, "Company org");
  assert.equal(zh.cpTitle, "公司架构");
  assert.equal(zh.cpDeptCount, "部门");
  assert.equal(zh.cpChannelM, "管理通道");
  // 需求点名的文案
  assert.equal(zh.cpEmpCount, "员工");
  assert.equal(zh.cpChannelP, "专业技术通道");
  assert.equal(zh.cpCode, "工号");
  assert.equal(zh.cpLevel, "等级");
  assert.equal(zh.cpHeadcount, "编制");
  assert.equal(zh.cpNumbering, "编号规则");
  assert.equal(zh.cpDisabled, "公司化运行时未启用");
  assert.equal(zh.cpRefresh, "刷新");
  assert.equal(zh.cpLoadFailed, "加载失败");
  assert.equal(zh.cpEmptyOrg, "暂无部门");

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

test("Panel：默认仍停在 org，页签条出现第 6 个「公司架构」", () => {
  const t = translator("zh");
  const { exports } = loadBundle(makeReact([sampleView(), null, false, "org", null, null, false]));
  const tree = exports.__internals.Panel({ t });

  const labels = collectButtons(tree).map((b) => b.label);
  const tabLabels = [t("tabOrg"), t("tabRetired"), t("tabUnregistered"), t("tabWorkflow"), t("tabMaintain"), t("cpTab")];
  assert.deepEqual(
    labels.filter((label) => tabLabels.includes(label)),
    tabLabels,
    "页签顺序应为 org/retired/unregistered/workflow/maintain/company",
  );
  assert.ok(labels.includes("公司架构"), "第 6 个页签文案应为「公司架构」");

  // 默认 tab=org：不渲染公司架构面板
  const panelType = exports.__internals.CompanyOrgPanel;
  assert.equal(collectElements(tree, (n) => n.type === panelType).length, 0);
});

test("Panel：点「公司架构」页签后 tab 切到 company 并渲染 CompanyOrgPanel", () => {
  const t = translator("zh");
  const seed = [sampleView(), null, false, "org", null, null, false];
  const react = makeReact(seed, { mutable: true });
  const { exports } = loadBundle(react);

  let tree = exports.__internals.Panel({ t });
  const tabButton = collectButtons(tree).find((b) => b.label === "公司架构");
  assert.ok(tabButton, "找不到「公司架构」页签按钮");
  assert.equal(typeof tabButton.onClick, "function");

  tabButton.onClick();
  assert.equal(seed[3], "company", "点击页签应把 tab 置为 company");

  // 重渲染：hooks 游标归零，useState 重新按顺序读同一份 state
  react.reset();
  tree = exports.__internals.Panel({ t });
  const panelType = exports.__internals.CompanyOrgPanel;
  const rendered = collectElements(tree, (n) => n.type === panelType);
  assert.equal(rendered.length, 1, "tab=company 时应渲染一个 CompanyOrgPanel");
  assert.equal(typeof rendered[0].props.t, "function", "CompanyOrgPanel 需要拿到 t");
});

/* ==================== ③ 完整数据渲染 ==================== */

test("CompanyOrgPanel：统计头 + 编号规则 + 等级图例 + 部门卡片 + 员工行 + 通道分栏", () => {
  const t = translator("zh");
  const { exports } = loadBundle(makeReact([overviewFixture(), null, false, null]));
  const tree = exports.__internals.CompanyOrgPanel({ t });
  const text = treeText(tree);

  // ① 统计头：部门/员工/M 线/P 线
  assert.match(text, /部门 2/);
  assert.match(text, /员工 4/);
  assert.match(text, /管理通道 1/);
  assert.match(text, /专业技术通道 3/);

  // ① 编号规则小字：模板 + 起始示例
  assert.match(text, /编号规则：员工 E\{seq:4\} · 部门 D\{seq:2\}/);
  assert.match(text, /工号 E0001 起/);
  assert.match(text, /部门编号 D01 起/);

  // ② 等级图例：M/P 通道标题 + 等级 code 与中文名
  assert.match(text, /等级图例/);
  assert.match(text, /M1 主管/);
  assert.match(text, /M2 经理/);
  assert.match(text, /P3 高级工程师/);
  assert.match(text, /P5 技术专家/);

  // ③ 部门卡片：编号 + 名称 + 编制
  assert.match(text, /\[D01\]/);
  assert.match(text, /插件组/);
  assert.match(text, /\[D02\]/);
  assert.match(text, /文档组/);
  assert.match(text, /编制 3\/4/);
  assert.match(text, /编制 1\/2/);

  // ③ 员工行：工号 + 等级徽章 + 姓名 + 岗位
  assert.match(text, /E0001/);
  assert.match(text, /E0002/);
  assert.match(text, /E0003/);
  assert.match(text, /E0004/); // 无部门的员工也要出现
  assert.match(text, /M2 经理/);
  assert.match(text, /P4 资深工程师/);
  assert.match(text, /P5 技术专家/);
  assert.match(text, /插件组负责人/);
  assert.match(text, /插件工程师/);
  assert.match(text, /管理岗/);
  assert.match(text, /员工岗/);
  assert.match(text, /未分配部门/);

  // 状态点在 title 上可读，且 working/idle/cold 三种颜色都出现了
  const titles = collectTitled(tree).map((item) => item.title);
  assert.ok(titles.includes("工号"), "工号列应有 title");
  assert.ok(titles.includes("工作中"), "状态点应有「工作中」title");
  assert.ok(titles.includes("空闲"), "状态点应有「空闲」title");
  assert.ok(titles.includes("冷备"), "状态点应有「冷备」title");
  const dotColors = collectElements(tree, (n) => n.props && n.props.style && n.props.style.borderRadius === 4).map((n) => n.props.style.background);
  assert.ok(dotColors.includes("#1a7f37"), "working 状态点应为绿色");
  assert.ok(dotColors.includes("#8b95a3"), "idle 状态点应为灰色");
  assert.ok(dotColors.includes("#c9a227"), "cold 状态点应为琥珀色");

  // 刷新按钮存在
  assert.ok(collectButtons(tree).some((b) => b.label === "刷新"), "应有刷新按钮");
});

test("CompanyOrgPanel：刷新按钮重新拉 /company/overview", async () => {
  const t = translator("zh");
  const calls = [];
  const react = makeReact([overviewFixture(), null, false, null]);
  const { exports } = loadBundle(react, { fetch: overviewFetch(calls) });
  const tree = exports.__internals.CompanyOrgPanel({ t });
  const button = collectButtons(tree).find((b) => b.label === "刷新");
  assert.ok(button, "找不到刷新按钮");

  await button.onClick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, OVERVIEW_URL);
  assert.equal(calls[0].method, "GET");
});

/* ==================== ④ 空态 / 未启用 / 失败 ==================== */

test("CompanyOrgPanel：启用但空组织 → 暂无部门 + 建部门/招人提示", () => {
  const t = translator("zh");
  const empty = { enabled: true, status: "running", warnings: [], org: { departments: [], employees: [] }, levels: LEVELS, numbering: NUMBERING };
  const { exports } = loadBundle(makeReact([empty, null, false, null]));
  const text = treeText(exports.__internals.CompanyOrgPanel({ t }));

  assert.match(text, /暂无部门/);
  assert.match(text, /company_admin/);
  assert.match(text, /company_hire/);
  assert.match(text, /部门 0/);
  assert.match(text, /员工 0/);
  assert.doesNotMatch(text, /插件组/);
});

test("CompanyOrgPanel：enabled=false → 公司化运行时未启用", () => {
  const t = translator("zh");
  const off = { enabled: false, status: "stopped", warnings: [], org: { departments: [], employees: [] } };
  const { exports } = loadBundle(makeReact([off, null, false, null]));
  const text = treeText(exports.__internals.CompanyOrgPanel({ t }));

  assert.match(text, /公司化运行时未启用/);
  assert.match(text, /boot/);
  assert.match(text, /暂无部门/);
});

test("CompanyOrgPanel：接口失败（500 / 404）显示加载失败，且不抛异常", async () => {
  const t = translator("zh");

  for (const failure of [
    { ok: false, status: 500, json: async () => ({ ok: false, message: "公司运行时异常" }) },
    { ok: false, status: 404, json: async () => { throw new Error("no body"); } },
  ]) {
    const react = makeReactLive();
    const { exports } = loadBundle(react, { fetch: async () => failure });
    react.reset();
    exports.__internals.CompanyOrgPanel({ t });
    const cleanups = react.flushEffects();
    await tick();
    react.reset();
    const tree = exports.__internals.CompanyOrgPanel({ t });
    const text = treeText(tree);
    assert.match(text, /加载失败/, "失败时应显示加载失败提示");
    assert.match(text, /刷新/, "失败时仍应保留刷新按钮");
    for (const cleanup of cleanups) if (typeof cleanup === "function") cleanup();
  }
});

/* ==================== ⑤ 轮询与清理 ==================== */

test("CompanyOrgPanel：打开拉一次 + 注册 5 秒轮询 + 卸载后清理定时器", async () => {
  const t = translator("zh");
  const calls = [];
  const timers = [];
  const cleared = [];
  const timerId = 41;

  const react = makeReactLive();
  const { exports } = loadBundle(react, {
    fetch: overviewFetch(calls),
    setInterval: (fn, ms) => {
      timers.push({ fn, ms });
      return timerId;
    },
    clearInterval: (id) => cleared.push(id),
  });
  const Panel = exports.__internals.CompanyOrgPanel;
  assert.equal(exports.__internals.CP_POLL_MS, 5000);

  react.reset();
  Panel({ t });
  const cleanups = react.flushEffects(); // 触发首次拉取 + 注册轮询

  assert.equal(timers.length, 1, "应注册 1 个轮询定时器");
  assert.equal(timers[0].ms, 5000, "轮询间隔应为 5 秒");
  assert.equal(calls.length, 1, "打开时应立即拉一次");
  assert.equal(calls[0].url, OVERVIEW_URL);

  await tick();
  react.reset();
  const tree = Panel({ t });
  assert.match(treeText(tree), /插件组/, "首次拉取成功后应渲染真实数据");

  // 一个轮询周期后再拉一次
  timers[0].fn();
  await tick();
  assert.equal(calls.length, 2, "轮询周期应再发一次请求");

  // 卸载：定时器必须被清理
  assert.equal(cleanups.length, 1, "useEffect 应返回清理函数");
  cleanups[0]();
  assert.deepEqual(cleared, [timerId], "卸载时应 clearInterval 自己注册的定时器");

  // 卸载后即使定时器回调被触发，也不再发请求
  timers[0].fn();
  await tick();
  assert.equal(calls.length, 2, "卸载后不应再发请求");
});

/* ==================== ⑥ 纯函数 buildCompanyOrgView ==================== */

test("buildCompanyOrgView：统计、M/P 分栏、无部门员工单独成卡", () => {
  const { exports } = loadBundle(makeReact());
  const view = exports.__internals.buildCompanyOrgView(overviewFixture());

  assert.equal(view.enabled, true);
  assert.equal(view.counts.departments, 2);
  assert.equal(view.counts.employees, 4);
  assert.equal(view.counts.M, 1);
  assert.equal(view.counts.P, 3);
  assert.equal(view.cards.length, 3, "2 个部门 + 1 张「未分配部门」卡");

  const plugin = view.cards.find((card) => card.dept && card.dept.code === "D01");
  assert.equal(plugin.byChannel.M.length, 1);
  assert.equal(plugin.byChannel.M[0].code, "E0001");
  assert.equal(plugin.byChannel.M[0].levelName, "经理");
  assert.equal(plugin.byChannel.P.length, 1);
  assert.equal(plugin.byChannel.P[0].code, "E0002");
  // card.employees 也应是归一后的行（M 在前、P 在后）
  assert.equal(plugin.employees.map((emp) => emp.code).join(","), "E0001,E0002");

  const orphan = view.cards[view.cards.length - 1];
  assert.equal(orphan.dept, null);
  assert.equal(orphan.employees.length, 1);
  assert.equal(orphan.employees[0].code, "E0004");

  assert.deepEqual({ ...view.numbering.employee }, { pattern: "E{seq:4}", start: 1, sample: "E0001" });
  assert.deepEqual({ ...view.numbering.department }, { pattern: "D{seq:2}", start: 1, sample: "D01" });
  assert.equal(view.levels.M.levels.length, 3);
  assert.equal(view.levels.P.levels.length, 5);
});

test("buildCompanyOrgView：老宿主缺 code/channel/level/levels/numbering 时逐项兜底", () => {
  const { exports } = loadBundle(makeReact());
  const view = exports.__internals.buildCompanyOrgView({
    org: {
      departments: [{ id: "d1", name: "无编号部门" }],
      employees: [
        { id: "e1", displayName: "甲", department: "d1", role: "manager" },
        { id: "e2", displayName: "乙", department: "missing", role: "staff", channel: "P", level: "P9" },
      ],
    },
  });

  assert.equal(view.cards.length, 2);
  const d1 = view.cards.find((card) => card.dept && card.dept.id === "d1");
  assert.equal(d1.byChannel.M.length, 1, "role=manager 未给 channel 时应推导为 M 线");
  assert.equal(d1.byChannel.M[0].level, "");
  assert.equal(d1.byChannel.M[0].code, "");
  assert.equal(d1.byChannel.P.length, 0);

  assert.equal(view.cards[1].dept, null, "部门解析失败的员工单独成卡");
  assert.equal(view.cards[1].employees[0].code, "");

  // numbering 全缺 → 默认模板
  assert.deepEqual({ ...view.numbering.employee }, { pattern: "E{seq:4}", start: 1, sample: "E0001" });
  // levels 全缺 → M 线用兜底目录，P 线从员工档案推导
  assert.equal(view.levels.M.levels[0].code, "M1");
  assert.equal(view.levels.M.levels.length, 5);
  assert.equal(view.levels.P.levels.length, 1);
  assert.equal(view.levels.P.levels[0].code, "P9");

  // 完全空 / null 输入不崩，且图例仍有兜底目录
  const empty = exports.__internals.buildCompanyOrgView(null);
  assert.equal(empty.cards.length, 0);
  assert.equal(empty.counts.employees, 0);
  assert.equal(empty.counts.M, 0);
  assert.equal(empty.counts.P, 0);
  assert.equal(empty.enabled, true);
  assert.equal(empty.levels.M.levels.length, 5);
  assert.equal(empty.levels.P.levels.length, 6);
  assert.deepEqual({ ...empty.levels.M.levels[0] }, { code: "M1", name: "主管" });
});

test("buildCompanyOrgView：自定义编号模板按 {seq:n} 宽度补齐起始值", () => {
  const { exports } = loadBundle(makeReact());
  const custom = exports.__internals.buildCompanyOrgView({
    numbering: { employee: { pattern: "E{seq:3}", start: 7 }, department: { pattern: "D-{seq:2}", start: 9 } },
  });
  assert.equal(custom.numbering.employee.sample, "E007");
  assert.equal(custom.numbering.department.sample, "D-09");
  assert.equal(custom.numbering.employee.start, 7);

  // 非法 start 回落到默认 1，非法 pattern 回落到默认模板
  const bad = exports.__internals.buildCompanyOrgView({ numbering: { employee: { pattern: "", start: 0 } } });
  assert.equal(bad.numbering.employee.pattern, "E{seq:4}");
  assert.equal(bad.numbering.employee.start, 1);
  assert.equal(bad.numbering.employee.sample, "E0001");
  assert.equal(bad.numbering.department.sample, "D01");
});
