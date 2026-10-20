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

test("源码：总架构/部门架构文案、overview 轮询、成本归因接线，且不把动态文本拼成 innerHTML", () => {
  const src = fs.readFileSync(BUNDLE, "utf8");
  assert.match(src, /cpTab: "总架构"/);
  assert.match(src, /cpTab: "Overall arch"/);
  assert.match(src, /cpTitle: "总架构"/);
  assert.match(src, /cpTitle: "Overall architecture"/);
  assert.match(src, /tabOrg: "部门架构"/);
  assert.match(src, /tabOrg: "Department org"/);
  assert.match(src, /CompanyOrgPanel/);
  assert.match(src, /DeptOrgPanel/);
  assert.match(src, /api\("\/company\/overview"\)/);
  assert.match(src, /setInterval\(pull, CP_POLL_MS\)/);
  assert.match(src, /const CP_POLL_MS = 5000;/);

  // 默认 tab = company，且 company 页签排在 org 之前
  assert.match(src, /useState\("company"\)/);
  assert.ok(src.indexOf('tabBtn("company"') >= 0, "源码应注册 company 页签");
  assert.ok(src.indexOf('tabBtn("company"') < src.indexOf('tabBtn("org"'), "总架构页签应排在部门架构之前");

  // 两个页面的分支接线
  assert.match(src, /tab === "company" \? h\(CompanyOrgPanel, \{ t: t \}\) : null/);
  assert.match(src, /tab === "org"\s*\? h\(DeptOrgPanel,/);

  // 成本归因：三个维度统一走 cpCostRows 并按 tokens 降序，渲染时取前 5
  assert.match(src, /cpCostRows/);
  assert.match(src, /slice\(0, 5\)/);
  assert.match(src, /cpNormalizeBoard/);

  // 安全：不写 HTML 字符串
  assert.equal(/\.innerHTML\s*=/.test(src), false, "不应给 innerHTML 赋值");
  assert.equal(src.includes("dangerouslySetInnerHTML"), false, "不应使用 dangerouslySetInnerHTML");
});

test("字典：cp*/dp* 文案 zh/en 一一对应，中文与 docs/16 §5 及 m02493 重构一致", () => {
  const { zh, en } = dictionaries();
  const zhCp = Object.keys(zh)
    .filter((k) => k.startsWith("cp") || k.startsWith("dp"))
    .sort();
  const enCp = Object.keys(en)
    .filter((k) => k.startsWith("cp") || k.startsWith("dp"))
    .sort();
  assert.ok(zhCp.length >= 45, `cp*/dp* 文案过少：${zhCp.length}`);
  assert.deepEqual(zhCp, enCp);
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort(), "zh 与 en 的 key 必须完全一致");

  // 页签与页面标题（任务重构后的文案）
  assert.equal(zh.cpTab, "总架构");
  assert.equal(en.cpTab, "Overall arch");
  assert.equal(zh.cpTitle, "总架构");
  assert.equal(en.cpTitle, "Overall architecture");
  assert.equal(zh.tabOrg, "部门架构");
  assert.equal(en.tabOrg, "Department org");
  // 总架构页：原有 KPI
  assert.equal(zh.cpDeptCount, "部门");
  assert.equal(zh.cpChannelM, "管理通道");
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
  // 总架构页：工单/成本 KPI 与成本归因
  assert.equal(zh.cpOrders, "工单数");
  assert.equal(zh.cpDone, "已完成");
  assert.equal(zh.cpTokens, "Token 合计");
  assert.equal(zh.cpRequests, "请求数");
  assert.equal(zh.cpCost, "成本归因");
  assert.equal(zh.cpByEmployee, "按员工");
  assert.equal(zh.cpByDepartment, "按部门");
  assert.equal(zh.cpByOrder, "按工单");
  assert.equal(zh.cpNoCost, "暂无成本数据");
  assert.ok(zh.cpCostTotal.includes("{tokens}") && zh.cpCostTotal.includes("{requests}"));
  assert.ok(zh.cpCostRow.includes("{tokens}") && zh.cpCostRow.includes("{requests}"));
  // 部门架构页工具条与空态
  assert.equal(zh.dpTitle, "部门架构 · 按部门管理成员");
  assert.equal(zh.dpAllDepts, "全部部门");
  assert.equal(zh.dpNoDept, "未分配部门");
  assert.equal(zh.dpNoMatch, "没有匹配的成员");
  assert.ok(zh.dpSearch.includes("技能"));
  assert.equal(zh.addGroup, "新建部门");
  assert.equal(zh.groupName, "部门名称");
  assert.ok(zh.groupDesc.includes("部门说明"));

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

test("Panel：默认页签为总架构（company），页签顺序 company → org → retired → unregistered → workflow → maintain", () => {
  const t = translator("zh");
  const { exports } = loadBundle(makeReact([sampleView(), null, false, "company", null, null, false]));
  const tree = exports.__internals.Panel({ t });

  const labels = collectButtons(tree).map((b) => b.label);
  const tabLabels = [t("cpTab"), t("tabOrg"), t("tabRetired"), t("tabUnregistered"), t("tabWorkflow"), t("tabMaintain")];
  assert.deepEqual(
    labels.filter((label) => tabLabels.includes(label)),
    tabLabels,
    "页签顺序应为 company/org/retired/unregistered/workflow/maintain",
  );
  assert.equal(tabLabels[0], "总架构");
  assert.equal(tabLabels[1], "部门架构");

  // 默认 tab=company：渲染总架构面板，不渲染部门架构面板
  const panelType = exports.__internals.CompanyOrgPanel;
  const deptType = exports.__internals.DeptOrgPanel;
  assert.equal(collectElements(tree, (n) => n.type === panelType).length, 1, "默认应渲染 CompanyOrgPanel");
  assert.equal(collectElements(tree, (n) => n.type === deptType).length, 0, "默认不应渲染 DeptOrgPanel");
});

test("Panel：点「部门架构」/「总架构」页签在两类面板间切换", () => {
  const t = translator("zh");
  const seed = [sampleView(), null, false, "company", null, null, false];
  const react = makeReact(seed, { mutable: true });
  const { exports } = loadBundle(react);

  let tree = exports.__internals.Panel({ t });
  const orgButton = collectButtons(tree).find((b) => b.label === "部门架构");
  assert.ok(orgButton, "找不到「部门架构」页签按钮");
  assert.equal(typeof orgButton.onClick, "function");

  orgButton.onClick();
  assert.equal(seed[3], "org", "点击页签应把 tab 置为 org");
  react.reset();
  tree = exports.__internals.Panel({ t });
  const rendered = collectElements(tree, (n) => n.type === exports.__internals.DeptOrgPanel);
  assert.equal(rendered.length, 1, "tab=org 时应渲染一个 DeptOrgPanel");
  assert.equal(typeof rendered[0].props.t, "function", "DeptOrgPanel 需要拿到 t");
  assert.ok(Array.isArray(rendered[0].props.groups), "DeptOrgPanel 需要拿到分组列表");

  const companyButton = collectButtons(tree).find((b) => b.label === "总架构");
  assert.ok(companyButton, "找不到「总架构」页签按钮");
  companyButton.onClick();
  assert.equal(seed[3], "company");
  react.reset();
  tree = exports.__internals.Panel({ t });
  assert.equal(collectElements(tree, (n) => n.type === exports.__internals.CompanyOrgPanel).length, 1);
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

/* ==================== ⑦ 总架构页：工单/成本 KPI 与成本归因 ==================== */

/** 在 overviewFixture 上补 board + costs（shape 同 docs/16 §4.1 与宿主 runtime.costs） */
function costOverviewFixture() {
  const data = overviewFixture();
  data.board = { orders: 7, done: 5 };
  data.costs = {
    tokens: 12345,
    requests: 42,
    byEmployee: {
      "emp-lead": { tokens: 1000, requests: 5 },
      "emp-dev": { tokens: 6000, requests: 20 },
      "emp-doc": { tokens: 900, requests: 3 },
      "emp-free": { tokens: 0, requests: 0 },
    },
    byDepartment: {
      "dept-plugin": { tokens: 7000, requests: 25 },
      "dept-doc": { tokens: 900, requests: 3 },
      "dept-ghost": { tokens: 500, requests: 1 },
    },
    byOrder: {
      "ord-9": { tokens: 5000, requests: 12 },
      "ord-1": { tokens: 2000, requests: 8 },
    },
  };
  return data;
}

test("CompanyOrgPanel：KPI 扩展到工单数/已完成/Token 合计/请求数", () => {
  const t = translator("zh");
  const { exports } = loadBundle(makeReact([costOverviewFixture(), null, false, null]));
  const text = treeText(exports.__internals.CompanyOrgPanel({ t }));

  assert.match(text, /工单数 7/);
  assert.match(text, /已完成 5/);
  assert.match(text, /Token 合计 12,345/);
  assert.match(text, /请求数 42/);
  // 原有 KPI 不能被顶掉
  assert.match(text, /部门 2/);
  assert.match(text, /员工 4/);
  assert.match(text, /管理通道 1/);
  assert.match(text, /专业技术通道 3/);
});

test("CompanyOrgPanel：成本归因区渲染总量 + 三列（姓名+工号 / 编号+名称 / orderId）", () => {
  const t = translator("zh");
  const { exports } = loadBundle(makeReact([costOverviewFixture(), null, false, null]));
  const text = treeText(exports.__internals.CompanyOrgPanel({ t }));

  assert.match(text, /成本归因/);
  assert.match(text, /合计 12,345 tokens · 42 次请求/);
  assert.match(text, /按员工/);
  assert.match(text, /按部门/);
  assert.match(text, /按工单/);

  // 员工列：姓名 · 工号（docs/16 §5.1-5）
  assert.match(text, /插件工程师 · E0002/);
  assert.match(text, /插件组负责人 · E0001/);
  // 部门列：编号 + 名称；未知部门 id 回落成 key 本身
  assert.match(text, /D01 插件组/);
  assert.match(text, /D02 文档组/);
  assert.match(text, /dept-ghost/);
  // 工单列：orderId
  assert.match(text, /ord-9/);
  assert.match(text, /ord-1/);
  // 每行附 tokens / requests
  assert.match(text, /6,000 tokens · 20 请求/);
  assert.match(text, /5,000 tokens · 12 请求/);
});

test("CompanyOrgPanel：三列各按 tokens 降序只展示 top5", () => {
  const t = translator("zh");
  const data = overviewFixture();
  data.board = { orders: 6, done: 0 };
  data.costs = { tokens: 2100, requests: 21, byEmployee: {}, byDepartment: {}, byOrder: {} };
  const employees = [];
  for (let i = 1; i <= 6; i += 1) {
    const id = "emp-" + i;
    employees.push({ id, code: "E900" + i, displayName: "员工" + i, department: "dept-plugin", departmentCode: "D01", channel: "P", level: "P2", levelName: "工程师", role: "staff", state: "idle" });
    data.costs.byEmployee[id] = { tokens: 700 - i * 100, requests: i };
  }
  data.org.employees = employees;

  const { exports } = loadBundle(makeReact([data, null, false, null]));
  const text = treeText(exports.__internals.CompanyOrgPanel({ t }));

  // 降序：员工1(600) → 员工5(200) 渲染；员工6(100) 被截掉
  const i1 = text.indexOf("员工1 · E9001");
  const i2 = text.indexOf("员工2 · E9002");
  const i5 = text.indexOf("员工5 · E9005");
  assert.ok(i1 >= 0 && i2 >= 0 && i5 >= 0, "top5 应包含员工1/2/5");
  assert.ok(i1 < i2 && i2 < i5, "员工列应按 tokens 降序");
  assert.equal(text.includes("员工6 · E9006"), false, "第 6 名不应出现在 top5 里");

  // 纯函数保留完整降序列表，截断只发生在渲染层
  const view = exports.__internals.buildCompanyOrgView(data);
  assert.equal(view.costs.byEmployee.length, 6);
  assert.equal(view.costs.byEmployee.map((row) => row.tokens).join(","), "600,500,400,300,200,100");
  assert.equal(view.costs.byEmployee[0].label, "员工1 · E9001");
});

test("CompanyOrgPanel：旧宿主没有 costs/board → 成本空态与 0 KPI，不崩", () => {
  const t = translator("zh");
  const old = overviewFixture(); // 无 board / costs
  const { exports } = loadBundle(makeReact([old, null, false, null]));
  const text = treeText(exports.__internals.CompanyOrgPanel({ t }));

  assert.match(text, /成本归因/);
  assert.match(text, /暂无成本数据/);
  assert.match(text, /工单数 0/);
  assert.match(text, /已完成 0/);
  assert.match(text, /Token 合计 0/);
  assert.match(text, /请求数 0/);
});

/* ==================== ⑧ 纯函数 buildCompanyOrgView 的 costs/board 归一 ==================== */

test("buildCompanyOrgView：board 与 costs 归一为有序数组，并保留缺省兜底", () => {
  const { exports } = loadBundle(makeReact());
  const view = exports.__internals.buildCompanyOrgView(costOverviewFixture());

  assert.equal(view.board.orders, 7);
  assert.equal(view.board.done, 5);
  assert.equal(view.costs.tokens, 12345);
  assert.equal(view.costs.requests, 42);
  assert.equal(view.costs.hasData, true);

  // 按员工：tokens 降序，0 值行被丢弃，标签 = 姓名 · 工号
  assert.equal(view.costs.byEmployee.length, 3, "0 值成本行应被过滤");
  assert.equal(view.costs.byEmployee.map((row) => row.label).join("|"), "插件工程师 · E0002|插件组负责人 · E0001|文档工程师 · E0003");
  assert.equal(view.costs.byEmployee.map((row) => row.tokens).join(","), "6000,1000,900");

  // 按部门：编号 + 名称；未知部门回落 key
  assert.equal(view.costs.byDepartment.map((row) => row.label).join("|"), "D01 插件组|D02 文档组|dept-ghost");

  // 按工单：orderId 原样
  assert.equal(view.costs.byOrder.map((row) => row.label).join("|"), "ord-9|ord-1");

  // 老宿主：全缺 → 0 / 空数组 / hasData=false
  const empty = exports.__internals.buildCompanyOrgView({});
  assert.deepEqual({ ...empty.board }, { orders: 0, done: 0 });
  assert.equal(empty.costs.tokens, 0);
  assert.equal(empty.costs.requests, 0);
  assert.equal(empty.costs.hasData, false);
  assert.equal(empty.costs.byEmployee.length, 0);
  assert.equal(empty.costs.byDepartment.length, 0);
  assert.equal(empty.costs.byOrder.length, 0);

  // board 缺失但 orders 数组存在 → 用长度兜底
  const withOrders = exports.__internals.buildCompanyOrgView({ orders: [{}, {}, {}] });
  assert.equal(withOrders.board.orders, 3);
  assert.equal(withOrders.board.done, 0);

  // costs 只有分桶没有总量 → 总量用员工桶求和兜底
  const summed = exports.__internals.buildCompanyOrgView({
    costs: { byEmployee: { a: { tokens: 10, requests: 2 }, b: { tokens: 5, requests: 1 } } },
  });
  assert.equal(summed.costs.tokens, 15);
  assert.equal(summed.costs.requests, 3);
  assert.equal(summed.costs.hasData, true);
});

/* ==================== ⑨ 部门架构页（DeptOrgPanel） ==================== */

function deptSampleView() {
  const view = sampleView();
  view.groups.push({
    id: "g-2",
    name: "插件组",
    description: "插件实现",
    members: [
      { target: "plugin-smith", displayName: "插件匠", title: "插件工程师", duties: ["实现页签"], skills: ["cordis-plugin"], groupId: "g-2", isRetired: false },
      { target: "plugin-old", displayName: "已退休插件工", title: "退休", skills: ["cordis-plugin"], groupId: "g-2", isRetired: true },
    ],
  });
  view.ungrouped = [{ target: "free-agent", displayName: "自由成员", title: "顾问", skills: ["research"], isRetired: false }];
  return view;
}

function deptTableProps(t, groups) {
  return {
    t,
    busy: false,
    groups: groups.map((g) => ({ id: g.id, name: g.name })),
    onEdit() {},
    onRetire() {},
    onRestore() {},
    onAssign() {},
    emptyText: t("emptyGroup"),
  };
}

/** 把 MemberTable / MemberRow 元素展开成真实渲染树，便于断言成员行 */
function expandTables(node, internals) {
  if (!node || typeof node !== "object") return node;
  if (node.type === internals.MemberTable) return expandTables(internals.MemberTable(node.props), internals);
  if (node.type === internals.MemberRow) return internals.MemberRow(node.props);
  return Object.assign({}, node, { children: (node.children || []).map((child) => expandTables(child, internals)) });
}

/** 渲染 DeptOrgPanel：seed = [filter, query] */
function renderDept(view, { filter = "all", query = "" } = {}) {
  const t = translator("zh");
  const react = makeReact([filter, query]);
  const { exports } = loadBundle(react);
  const internals = exports.__internals;
  const calls = { refresh: 0, deleted: [] };
  const tree = internals.DeptOrgPanel({
    t,
    groups: view.groups,
    ungrouped: view.ungrouped,
    busy: false,
    tableProps: deptTableProps(t, view.groups),
    onRefresh: () => {
      calls.refresh += 1;
    },
    onDeleteGroup: (g) => calls.deleted.push(g.id),
  });
  return { t, internals, tree, expanded: expandTables(tree, internals), calls };
}

test("DeptOrgPanel：工具条 + 部门 pills + 搜索框 + 按部门分卡", () => {
  const view = deptSampleView();
  const { t, tree, expanded, calls } = renderDept(view);
  const text = treeText(expanded);

  // 工具条标题与刷新
  assert.match(text, /部门架构 · 按部门管理成员/);
  const buttons = collectButtons(tree);
  assert.ok(buttons.some((b) => b.label === "刷新"), "应有刷新按钮");
  buttons.find((b) => b.label === "刷新").onClick();
  assert.equal(calls.refresh, 1, "点刷新应触发 onRefresh");

  // 部门 pills：全部部门 + 每个部门名 + 未分配部门
  const pillLabels = buttons.map((b) => b.label);
  for (const label of ["全部部门", "数据组", "插件组", "未分配部门"]) {
    assert.ok(pillLabels.includes(label), `缺少部门 pill：${label}`);
  }

  // 搜索框占位符
  const inputs = collectElements(tree, (n) => n.type === "input");
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].props.placeholder, t("dpSearch"));
  assert.match(inputs[0].props.placeholder, /技能/);

  // 卡片：名称 + 人数 + 说明，成员行显示姓名/岗位；已停用成员被过滤
  assert.match(text, /数据组 1 人 知识库与核查/);
  assert.match(text, /插件组 1 人 插件实现/);
  assert.match(text, /数据整理员/);
  assert.match(text, /知识库整理员/);
  assert.match(text, /插件匠/);
  assert.match(text, /插件工程师/);
  assert.equal(text.includes("已退休插件工"), false, "已停用成员不应出现在成员表里");
  // 未分组 → 「未分配部门」卡
  assert.match(text, /未分配部门 1 人/);
  assert.match(text, /自由成员/);

  // 删除按钮绑到对应小组
  const removeButtons = collectButtons(tree).filter((b) => b.label === "移除");
  assert.equal(removeButtons.length, 2, "两个部门卡各一个删除按钮，未分配部门卡没有");
  removeButtons[0].onClick();
  assert.deepEqual(calls.deleted, ["g-1"]);
});

test("DeptOrgPanel：部门 pill 只显示该部门成员", () => {
  const view = deptSampleView();
  const { expanded } = renderDept(view, { filter: "g-2" });
  const text = treeText(expanded);

  assert.match(text, /插件匠/);
  assert.equal(text.includes("数据整理员"), false, "筛选 g-2 时不应出现数据组成员");
  assert.equal(text.includes("自由成员"), false, "筛选 g-2 时不应出现未分配部门成员");
  assert.equal(text.includes("数据组 1 人"), false, "筛选 g-2 时不应渲染别的部门卡");
});

test("DeptOrgPanel：搜索按姓名 / DSH 名 / 岗位 / 技能过滤，无命中显示空态", () => {
  const view = deptSampleView();

  // 姓名
  let text = treeText(renderDept(view, { query: "插件匠" }).expanded);
  assert.match(text, /插件匠/);
  assert.equal(text.includes("数据整理员"), false);

  // DSH 名（target）
  text = treeText(renderDept(view, { query: "data-organizer" }).expanded);
  assert.match(text, /数据整理员/);
  assert.equal(text.includes("插件匠"), false);

  // 岗位
  text = treeText(renderDept(view, { query: "顾问" }).expanded);
  assert.match(text, /自由成员/);

  // 技能
  text = treeText(renderDept(view, { query: "cordis-plugin" }).expanded);
  assert.match(text, /插件匠/);
  assert.equal(text.includes("数据整理员"), false);

  // 无命中：空态文案，且不显示任何部门卡
  text = treeText(renderDept(view, { query: "并不存在的成员" }).expanded);
  assert.match(text, /没有匹配的成员/);
  assert.equal(text.includes("数据组 1 人"), false);
});

test("DeptOrgPanel：过滤值指向已消失的部门时回落到「全部部门」", () => {
  const view = deptSampleView();
  const { expanded } = renderDept(view, { filter: "g-already-deleted" });
  const text = treeText(expanded);
  assert.match(text, /数据组 1 人/);
  assert.match(text, /插件组 1 人/);
  assert.match(text, /未分配部门 1 人/);
});

test("DeptOrgPanel：一个成员都没有时沿用「还没有成员」空态", () => {
  const view = sampleView();
  view.groups = [];
  view.ungrouped = [];
  const { expanded } = renderDept(view);
  const text = treeText(expanded);
  assert.match(text, /还没有成员/);
  assert.match(text, /同步核心成员/);
  assert.equal(text.includes("没有匹配的成员"), false);
});
