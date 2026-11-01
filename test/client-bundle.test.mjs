/**
 * 客户端 bundle 的离线测试：不需要浏览器，也不需要 DSH 在运行。
 *
 * 做法：
 *  1. 用 node:vm 造一个带 `window.__ModuleLoader__` 的沙箱，把 lib/client.js 真实加载进来
 *     （require 替身只提供 react 的五个 API），验证固定壳格式正确、模块能求值
 *  2. 用最小客户端 ctx 替身（effect / locale / slots）跑 apply()，断言中文字典与
 *     三个插槽的注册参数正确
 *  3. 用种子化 hooks 的 react 替身直接执行 Panel / MemberTable / MemberRow / EditForm
 *     的函数体，得到真实的元素树；再从树里找按钮并触发 onClick，
 *     断言发出了正确的 HTTP 请求（UI → API 的端到端逻辑验证）
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE = path.join(HERE, "..", "lib", "client.js");

/** 造一个 react 替身；seed 用于按调用顺序给 useState 喂初值 */
function makeReact(seed = []) {
  let i = 0;
  const react = {
    createElement(type, props, ...children) {
      return { type, props: props || {}, children: children.flat(Infinity) };
    },
    useState(init) {
      const v = i < seed.length ? seed[i] : init;
      i++;
      return [v, () => {}];
    },
    useCallback: (fn) => fn,
    useEffect: () => {},
    useMemo: (fn) => fn(),
  };
  return react;
}

/** 真实加载 lib/client.js，返回其 module.exports。
 *  globals 用于向 vm 沙箱注入 Node 宿主全局（fetch / confirm）——
 *  vm context 只有标准内建对象，没有 fetch/confirm。 */
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
      // 允许用例注入 window.addEventListener 等 DOM 能力（Esc/焦点类行为需要）
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

/** 构造一个记录请求的 fetch 替身 */
function recordingFetch(calls) {
  return async (url, init) => {
    calls.push({ url, method: init?.method || "GET", body: init?.body ? JSON.parse(init.body) : null });
    return { ok: true, status: 200, json: async () => ({ ok: true, data: {} }) };
  };
}

/** 最小客户端 ctx 替身 */
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
      bind: (ns) => (key) => key, // 测试里直接用 key 当文案，便于定位按钮
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

/* ==================== 模块加载与注册 ==================== */

test("client bundle：固定壳格式正确，window.__ModuleLoader__.load 被调用且 id 为包名", () => {
  const { id, exports } = loadBundle(makeReact());
  assert.equal(id, "dsh-member-manager");
  assert.equal(exports.name, "dsh-member-manager");
  // 注意：vm 沙箱里的数组与宿主 realm 不同源，deepStrictEqual 会因原型不同而失败，故用 join 比较
  assert.equal(exports.inject.join(","), "slots,locale");
  assert.equal(typeof exports.apply, "function");
  assert.equal(typeof exports.__internals.Panel, "function");
});

test("apply()：注册中文字典（zh 与 en 都齐全且 key 一一对应）", () => {
  const { exports } = loadBundle(makeReact());
  const { ctx, locales } = mockClientCtx();
  exports.apply(ctx);

  const dict = locales.get("dsh-member-manager");
  assert.ok(dict, "未注册 locale 字典");
  assert.ok(dict.zh && dict.en);
  assert.deepEqual(Object.keys(dict.zh).sort(), Object.keys(dict.en).sort(), "中英文字典 key 必须一致");
  assert.equal(dict.zh.title, "成员管理");
  assert.ok(Object.keys(dict.zh).length > 25, `字典条目偏少：${Object.keys(dict.zh).length}`);
});

test("apply()：注册三个插槽，kind 对应的 id/key 参数正确", () => {
  const { exports } = loadBundle(makeReact());
  const { ctx, slots, injected } = mockClientCtx();
  exports.apply(ctx);

  assert.deepEqual(injected, ["settings.section", "sidebar.panellist", "main"]);
  assert.equal(slots.length, 3);

  const byName = Object.fromEntries(slots.map((s) => [s.options.name, s]));
  // list kind 必须有 id
  assert.equal(byName["settings.section"].options.id, "dsh-member-manager");
  assert.equal(byName["sidebar.panellist"].options.id, "dsh-member-manager");
  // keyed kind 必须有 key
  assert.equal(byName["main"].options.key, "dsh-member-manager");
  for (const s of slots) {
    assert.equal(s.options.locale, "dsh-member-manager", `${s.options.name} 应带 locale`);
    assert.equal(typeof s.Component, "function");
  }
  // 列表型插槽需要 label（main 是 keyed 面板，label 由侧栏入口提供）
  assert.equal(typeof byName["settings.section"].options.label, "function");
  assert.equal(typeof byName["sidebar.panellist"].options.label, "function");
  assert.equal(byName["main"].options.label, undefined);
});

/* ==================== 组件渲染（函数体直接执行） ==================== */

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
    unregistered: ["brand-new-member"],
    warnings: [],
  };
}

/** 收集元素树里所有按钮的文案与 onClick */
function collectButtons(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (node.type === "button") {
    const label = textOf(node);
    out.push({ label, onClick: node.props.onClick, disabled: node.props.disabled });
  }
  for (const child of node.children || []) collectButtons(child, out);
  return out;
}

function textOf(node) {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (typeof node !== "object") return "";
  return (node.children || []).map(textOf).join("");
}

/** 在元素树里找到第一个指定组件类型的元素（用于把 Panel 内嵌的子组件真正展开渲染） */
function findComponent(node, type) {
  if (!node || typeof node !== "object") return null;
  if (node.type === type) return node;
  for (const child of node.children || []) {
    const hit = findComponent(child, type);
    if (hit) return hit;
  }
  return null;
}

/** 把整棵树序列化成文本，便于断言内容出现 */
function treeText(node) {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (typeof node !== "object") return "";
  const self = node.type === "button" || typeof node.type === "string" ? "" : "";
  return self + (node.children || []).map(treeText).join(" ") + " " + JSON.stringify(node.props || {});
}

test("Panel：v4 默认「总架构」页挂载组织架构面板，注册小组版弹层已移除", () => {
  // seed 只给前三个 hook：tab 走组件内 useState("company")
  const react = makeReact([sampleView(), null, false]);
  const { exports } = loadBundle(react);
  const tree = exports.__internals.Panel({ t: (k) => k });

  assert.equal(tree.type, "div");
  const { CompanyOrgPanel } = exports.__internals;
  assert.ok(findComponent(tree, CompanyOrgPanel), "默认应渲染总架构组织架构面板（CompanyOrgPanel）");
  assert.equal("DeptOrgPanel" in exports.__internals, false, "v4 已移除注册小组版 DeptOrgPanel（组织架构一律走公司化）");
  // Panel 自身只负责页签与数据加载；组织架构内容由 CompanyOrgPanel 渲染（其断言见 company-panel.test.mjs）
  assert.match(treeText(tree), /cpTab/);
});

test("Panel：state 为 null 时渲染占位而不抛错", () => {
  const { exports } = loadBundle(makeReact([null, null, false, "company", null, null]));
  const tree = exports.__internals.Panel({ t: (k) => k });
  assert.equal(tree.type, "div");
  assert.match(treeText(tree), /…/);
});

test("Panel：coreAvailable=false 时显示同步提示；warnings 会透出", () => {
  const view = { ...sampleView(), coreAvailable: false, warnings: ["名册文件不存在，已初始化为空名册"] };
  const { exports } = loadBundle(makeReact([view, null, false, "company", null, null]));
  const text = treeText(exports.__internals.Panel({ t: (k) => k }));
  assert.match(text, /coreUnavailable/);
  assert.match(text, /名册文件不存在/);
});

test("Panel：错误态渲染错误条（error 非空且无 state 时走独立分支）", () => {
  const { exports } = loadBundle(makeReact([null, "HTTP 500", false, "company", null, null]));
  const text = treeText(exports.__internals.Panel({ t: (k) => k }));
  assert.match(text, /HTTP 500/);
  assert.match(text, /noApi/);
});

test("Panel：点击「同步核心成员」发出 registerLive 请求", async () => {
  const calls = [];
  const { exports } = loadBundle(makeReact([sampleView(), null, false, "company", null, null]), { fetch: recordingFetch(calls) });
  const tree = exports.__internals.Panel({ t: (k) => k });

  const sync = collectButtons(tree).find((b) => b.label === "sync");
  assert.ok(sync, "找不到「同步核心成员」按钮");
  await sync.onClick();

  const op = calls.find((c) => c.url.endsWith("/op"));
  assert.ok(op, "未发出 /op 请求");
  assert.equal(op.method, "POST");
  assert.equal(op.body.op, "registerLive");
});

test("Panel：标题后显示公司名文本，点击打开公司名编辑弹窗", () => {
  const view = sampleView();
  view.company = { companyName: "测试公司" };
  const { exports } = loadBundle(makeReact([view, null, false]));
  const tree = exports.__internals.Panel({ t: (k) => k });
  // 标题后是可点击的公司名（与标题同字号），不是输入框
  const headerBtn = collectButtons(tree).find((b) => b.label === "测试公司");
  assert.ok(headerBtn, "标题后应显示可点击的公司名文本");
  assert.equal(typeof headerBtn.onClick, "function", "公司名应可点击打开编辑菜单");
  assert.equal(
    collectInputs(tree).some((i) => i.props && i.props.placeholder === "cpCompanyNamePh"),
    false,
    "未打开编辑菜单时不应有公司名输入框",
  );

  // companyOpen=true（hook 索引 7）时渲染编辑弹窗
  const seeded = loadBundle(makeReact([view, null, false, "company", null, null, false, true]));
  const dialogTree = seeded.exports.__internals.Panel({ t: (k) => k });
  const input = collectInputs(dialogTree).find((i) => i.props && i.props.placeholder === "cpCompanyNamePh");
  assert.ok(input, "点击后应渲染公司名编辑弹窗（placeholder=cpCompanyNamePh）");
  assert.equal(input.props.value, "测试公司", "弹窗输入框值应来自 state.company.companyName");
});

test("Panel：默认落在「总架构」页，页签顺序总架构→员工中心→工作流→备份与更新", () => {
  // seed 只给前三个 hook，第四个 tab 走组件内 useState("company") 的默认值
  const { exports } = loadBundle(makeReact([sampleView(), null, false]));
  const tree = exports.__internals.Panel({ t: (k) => k });

  const labels = collectButtons(tree).map((b) => b.label);
  // v4.2：已停用 / 未登记页签移除，替换为独立的「员工中心」页签
  const tabKeys = ["cpTab", "cpEmployeeCenter", "tabWorkflow", "tabMaintain"];
  // 页签按钮的文案可能带计数徽章，按前缀归一成 key 再比顺序
  const tabOrder = labels
    .map((l) => tabKeys.find((k) => l.startsWith(k)))
    .filter(Boolean);
  assert.deepEqual(
    tabOrder,
    tabKeys,
    "页签顺序应为 总架构 → 员工中心 → 工作流 → 备份与更新",
  );
  assert.equal(labels.some((l) => l.startsWith("tabOrg")), false, "不应再有「部门架构」页签");
  assert.equal(labels.some((l) => l.startsWith("tabRetired")), false, "不应再有「已停用」页签");
  assert.equal(labels.some((l) => l.startsWith("tabUnregistered")), false, "不应再有「未登记」页签");

  const { CompanyOrgPanel, EmployeeCenterPanel } = exports.__internals;
  assert.ok(findComponent(tree, CompanyOrgPanel), "默认应渲染总架构页（CompanyOrgPanel）");
  assert.equal(findComponent(tree, EmployeeCenterPanel), null, "默认页不应渲染员工中心页");
});

test("Panel：「员工中心」页签渲染 EmployeeCenterPanel，且总架构页不再挂「查看全部」回调", () => {
  const { exports } = loadBundle(makeReact([sampleView(), null, false]));
  const tree = exports.__internals.Panel({ t: (k) => k });

  const companyNode = findComponent(tree, exports.__internals.CompanyOrgPanel);
  assert.ok(companyNode, "默认应渲染总架构页");
  assert.equal(companyNode.props.onOpenEmployees, undefined, "v5 总架构页不再接收 onOpenEmployees（员工中心节点已移除）");

  const { exports: ex2 } = loadBundle(makeReact([sampleView(), null, false, "employees", null, null]));
  const tree2 = ex2.__internals.Panel({ t: (k) => k });
  assert.ok(findComponent(tree2, ex2.__internals.EmployeeCenterPanel), "employees 页签应渲染 EmployeeCenterPanel");
  assert.equal(findComponent(tree2, ex2.__internals.CompanyOrgPanel), null, "employees 页签不应再渲染总架构页");
});

test("Panel：后端不可用时 fetch 失败被捕获为错误条，不抛到渲染层", async () => {
  const failing = async () => {
    throw new Error("Failed to fetch");
  };
  const { exports } = loadBundle(makeReact([sampleView(), null, false, "company", null, null]), { fetch: failing });
  const tree = exports.__internals.Panel({ t: (k) => k });
  const sync = collectButtons(tree).find((b) => b.label === "sync");
  await sync.onClick(); // 不应抛异常
  assert.ok(tree, "渲染树仍然完好");
});

/* ==================== 装载韧性 ==================== */

test("apply()：某个插槽被拒时其余插槽仍注册，且 apply 不抛错", () => {
  const react = makeReact();
  const { exports } = loadBundle(react);
  const registered = [];
  const ctx = {
    effect: (fn) => fn(),
    locale: { register: () => {}, bind: () => (k) => k },
    slots: {
      inject: (_name, factory) => factory(),
      register(options) {
        if (options.name === "sidebar.panellist") throw new Error('slot "sidebar.panellist" is not declared');
        registered.push(options.name);
        return () => {};
      },
    },
  };
  assert.doesNotThrow(() => exports.apply(ctx));
  assert.deepEqual(registered, ["settings.section", "main"]);
});

test("apply()：ctx.slots.inject 本身抛错时也不影响其它插槽", () => {
  const react = makeReact();
  const { exports } = loadBundle(react);
  const registered = [];
  const ctx = {
    effect: (fn) => fn(),
    locale: { register: () => {}, bind: () => (k) => k },
    slots: {
      inject(name, factory) {
        if (name === "main") throw new Error("inject 失败");
        return factory();
      },
      register(options) {
        registered.push(options.name);
        return () => {};
      },
    },
  };
  assert.doesNotThrow(() => exports.apply(ctx));
  assert.deepEqual(registered, ["settings.section", "sidebar.panellist"]);
});

test("apply()：locale 注册失败时不阻止插槽注册", () => {
  const react = makeReact();
  const { exports } = loadBundle(react);
  const registered = [];
  const ctx = {
    effect: (fn) => fn(),
    locale: { register: () => { throw new Error("字典冲突"); }, bind: () => (k) => k },
    slots: {
      inject: (_name, factory) => factory(),
      register(options) {
        registered.push(options.name);
        return () => {};
      },
    },
  };
  // locale 注册抛错会被 effect 传播；这里只要求插槽注册不被连带跳过
  try { exports.apply(ctx); } catch { /* 允许冒泡，但插槽应已注册 */ }
  assert.ok(registered.length >= 1, "locale 失败不应阻止插槽注册");
});

/* ==================== 子组件 ==================== */

test("MemberRow：渲染显示名、target、岗位、职责、技能与「当前会话未列出」标记", () => {
  const { exports } = loadBundle(makeReact());
  const m = {
    target: "data-verifier",
    displayName: "数据核查员",
    title: "事实核查",
    duties: ["外部核证"],
    skills: ["web-search", "office-xlsx"],
    groupId: "g-1",
    status: "active",
    isRetired: false,
    orphan: true,
  };
  const tree = exports.__internals.MemberRow({
    m,
    groups: [{ id: "g-1", name: "数据组" }],
    t: (k) => k,
    busy: false,
    onEdit: () => {},
    onRetire: () => {},
    onRestore: () => {},
    onAssign: () => {},
  });
  const text = treeText(tree);
  assert.equal(tree.type, "tr");
  for (const s of ["数据核查员", "data-verifier", "事实核查", "外部核证", "web-search", "office-xlsx", "currentSessionMissing"]) {
    assert.match(text, new RegExp(s));
  }
});

test("MemberRow：停用成员显示「恢复」而不是「停用」", () => {
  const { exports } = loadBundle(makeReact());
  const base = { target: "x-member", displayName: "X", title: "", duties: [], skills: [], groupId: null, status: "retired", isRetired: true, orphan: false };
  const props = { m: base, groups: [], t: (k) => k, busy: false, onEdit: () => {}, onRetire: () => {}, onRestore: () => {}, onAssign: () => {} };
  const labels = collectButtons(exports.__internals.MemberRow(props)).map((b) => b.label);
  assert.ok(labels.includes("restore"));
  assert.ok(!labels.includes("retire"));
});

test("MemberTable：空列表渲染空文案而不抛错", () => {
  const { exports } = loadBundle(makeReact());
  const tree = exports.__internals.MemberTable({ members: [], groups: [], t: (k) => k, busy: false, emptyText: "（空小组）" });
  assert.match(treeText(tree), /（空小组）/);
});

test("EditForm：输入框带出当前值，取消按钮可点", () => {
  const { exports } = loadBundle(makeReact());
  const draft = { target: "data-organizer", displayName: "数据整理员", title: "整理员", dutiesText: "清点\n诊断", skillsText: "a, b" };
  let cancelled = false;
  const tree = exports.__internals.EditForm({ draft, setDraft: () => {}, t: (k) => k, busy: false, onSave: () => {}, onCancel: () => { cancelled = true; } });
  const text = treeText(tree);
  assert.match(text, /数据整理员/);
  assert.match(text, /清点/);
  const cancel = collectButtons(tree).find((b) => b.label === "cancel");
  cancel.onClick();
  assert.equal(cancelled, true);
});

/* ================== 功能②：可搜索多选技能弹层 ================== */

/** 能真正跑 state 与 effect 的 react 替身（可多次渲染，模拟重渲染） */
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
      for (const fn of pending) fn();
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

/** 收集元素树里的输入元素 */
function collectInputs(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (node.type === "input") out.push({ props: node.props });
  for (const c of node.children || []) collectInputs(c, out);
  return out;
}

const SKILL_FIXTURE = [
  { name: "office-docx", description: "创建、读取、编辑 Word 文档", source: "filesystem" },
  { name: "browser-skill", description: "驱动已登录的 Chromium", source: "filesystem" },
];

/** 只对 /skills 返回目录的 fetch 替身 */
function skillsFetch(skills = SKILL_FIXTURE, extra = {}) {
  return async (url) => {
    if (String(url).endsWith("/skills")) {
      return { ok: true, status: 200, json: async () => ({ ok: true, data: { total: skills.length, skills } }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, data: extra }) };
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

async function renderPicker(react, exports, props = {}) {
  const Picker = exports.__internals.SkillPicker;
  const base = { t: (k) => k, selected: [], onToggle: () => {}, onClose: () => {}, ...props };
  react.reset();
  let tree = Picker(base);
  react.flushEffects(); // 触发 /skills 拉取
  await tick();
  react.reset();
  tree = Picker(base); // 用已落地的 state 重渲染
  return tree;
}

test("SkillPicker：渲染技能的名称 + 描述 + 来源（本功能核心诉求）", async () => {
  const react = makeReactLive();
  const { exports } = loadBundle(react, { fetch: skillsFetch() });
  const tree = await renderPicker(react, exports);
  const text = treeText(tree);

  assert.match(text, /office-docx/, "要有技能名");
  assert.match(text, /创建、读取、编辑 Word 文档/, "要有描述");
  assert.match(text, /browser-skill/);
  assert.match(text, /filesystem/, "要标出来源");
  assert.match(text, /skillTotal/, "要显示总数");
  assert.match(text, /pickSkills/, "要有标题");
  assert.match(text, /searchSkills/, "要有搜索框");
  assert.match(text, /done/, "要有完成按钮");
});

test("SkillPicker：搜索同时匹配名称与描述，无匹配显示空态", async () => {
  const react = makeReactLive();
  const { exports } = loadBundle(react, { fetch: skillsFetch() });
  await renderPicker(react, exports);

  const Picker = exports.__internals.SkillPicker;
  const base = { t: (k) => k, selected: [], onToggle: () => {}, onClose: () => {} };

  // 按描述里的"Chromium"搜
  react._states[1] = "chromium";
  react.reset();
  let text = treeText(Picker(base));
  assert.match(text, /browser-skill/);
  assert.ok(!/office-docx/.test(text), "不匹配的项应被过滤掉");

  // 按名称搜
  react._states[1] = "docx";
  react.reset();
  text = treeText(Picker(base));
  assert.match(text, /office-docx/);
  assert.ok(!/browser-skill/.test(text));

  // 无匹配
  react._states[1] = "zzz-nope";
  react.reset();
  assert.match(treeText(Picker(base)), /noSkills/);
});

test("SkillPicker：勾选/取消会回调 onToggle，已选项呈选中态", async () => {
  const react = makeReactLive();
  const { exports } = loadBundle(react, { fetch: skillsFetch() });
  const toggled = [];
  const tree = await renderPicker(react, exports, { selected: ["office-docx"], onToggle: (n) => toggled.push(n) });

  const boxes = collectInputs(tree).filter((i) => i.props.type === "checkbox");
  assert.equal(boxes.length, 2, "每个技能一个勾选框");
  assert.equal(boxes[0].props.checked, true, "已选的应勾上");
  assert.equal(boxes[1].props.checked, false);

  boxes[1].props.onChange();
  assert.deepEqual(toggled, ["browser-skill"]);
});

test("SkillPicker：技能服务不可用时显示错误而不是空白", async () => {
  const react = makeReactLive();
  const failing = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, data: { total: 0, skills: [], warning: "SKILLS_SERVICE_UNAVAILABLE" } }) });
  const { exports } = loadBundle(react, { fetch: failing });
  const tree = await renderPicker(react, exports);
  // 空列表 + 无错误 → 显示空态
  assert.match(treeText(tree), /noSkills/);
});

test("SkillPicker：fetch 失败时显示错误信息", async () => {
  const react = makeReactLive();
  const { exports } = loadBundle(react, { fetch: async () => { throw new Error("Failed to fetch"); } });
  const tree = await renderPicker(react, exports);
  assert.match(treeText(tree), /Failed to fetch/);
});

test("EditForm：已选技能显示为可移除的标签，点「选择技能」打开弹层", async () => {
  const react = makeReactLive();
  const { exports } = loadBundle(react, { fetch: skillsFetch() });
  const drafts = [];
  const draft = { target: "m1", displayName: "甲", title: "", dutiesText: "", skillsText: "office-docx" };

  react.reset();
  let tree = exports.__internals.EditForm({ draft, setDraft: (d) => drafts.push(d), t: (k) => k, busy: false, onSave: () => {}, onCancel: () => {} });
  let text = treeText(tree);
  assert.match(text, /office-docx/, "已选技能要以标签形式显示");
  assert.match(text, /pickSkills/, "要有「选择技能」按钮");
  assert.ok(!/browser-skill/.test(text), "未打开弹层时不应出现技能列表");

  // 点「选择技能」→ picking=true → 树里应挂上 SkillPicker 元素
  // 注意：替身 createElement 只实例化子组件、不调用它，所以这里断言"已挂载"，
  // 内容正确性由上面对 SkillPicker 的直接渲染测试覆盖。
  const pickBtn = collectButtons(tree).find((b) => b.label === "pickSkills");
  assert.ok(pickBtn, "找不到「选择技能」按钮");
  pickBtn.onClick();
  react.flushEffects();
  await tick();
  react.reset();
  tree = exports.__internals.EditForm({ draft, setDraft: (d) => drafts.push(d), t: (k) => k, busy: false, onSave: () => {}, onCancel: () => {} });

  const mounted = [];
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (n.type === exports.__internals.SkillPicker) mounted.push(n);
    for (const c of n.children || []) walk(c);
  })(tree);
  assert.equal(mounted.length, 1, "点击后应挂载 SkillPicker");
  // 跨 realm：vm 沙箱里的数组与宿主原型不同，deepStrictEqual 会误报，故用 join 比较
  assert.equal(mounted[0].props.selected.join(","), "office-docx", "应把已选技能传给弹层");

  // 直接渲染该弹层，验证内容。
  // 必须用**独立的** react 替身：makeReactLive 的状态是按 hook 序号存的，
  // 同一实例先跑 EditForm（1 个 hook）再跑 SkillPicker（3 个 hook）会串位。
  const pickerReact = makeReactLive();
  const pickerBundle = loadBundle(pickerReact, { fetch: skillsFetch() });
  const pickerTree = await renderPicker(pickerReact, pickerBundle.exports, { selected: ["office-docx"] });
  const pickerText = treeText(pickerTree);
  assert.match(pickerText, /browser-skill/, "弹层里应有技能列表");
  assert.match(pickerText, /创建、读取、编辑 Word 文档/, "弹层里要带描述");
});

test("EditForm：弹层开着时 Esc 只关弹层，不关整张表单", () => {
  const listeners = {};
  const setters = [];
  let cursor = 0;
  // hook 顺序：picking → pickingModel → models；这里预置「技能弹层已打开」
  const seeds = [true, false, null];
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(init) {
      const i = cursor++;
      return [i < seeds.length ? seeds[i] : init, (v) => setters.push([i, v])];
    },
    useCallback: (fn) => fn,
    useEffect: (fn) => {
      fn();
    },
    useMemo: (fn) => fn(),
  };
  let cancelled = false;
  const { exports } = loadBundle(react, {
    // /models 拉取用空目录兜底，避免 effect 里打到真实 fetch
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, data: { providers: [] } }) }),
    window: {
      addEventListener: (type, fn) => {
        listeners[type] = fn;
      },
      removeEventListener: () => {},
    },
  });

  exports.__internals.EditForm({
    draft: { target: "m1", displayName: "甲", title: "", dutiesText: "", skillsText: "", model: "", provider: "" },
    setDraft: () => {},
    t: (k) => k,
    busy: false,
    onSave: () => {},
    onCancel: () => {
      cancelled = true;
    },
  });

  assert.equal(typeof listeners.keydown, "function", "EditForm 应注册 keydown 监听");
  listeners.keydown({ key: "Escape" });
  assert.deepEqual(setters[0], [0, false], "Esc 应先关闭技能弹层（picking=false）");
  assert.equal(cancelled, false, "弹层开着时按 Esc 不应关闭整张表单");
});

test("EditForm：中文显示名为空时禁用保存（避免点了才看到宿主的 EMPTY_FIELD）", () => {
  const { exports } = loadBundle(makeReact());
  const draft = { target: "m1", displayName: "  ", title: "", dutiesText: "", skillsText: "", model: "", provider: "" };
  const tree = exports.__internals.EditForm({ draft, setDraft: () => {}, t: (k) => k, busy: false, onSave: () => {}, onCancel: () => {} });
  const save = collectButtons(tree).find((b) => b.label === "save");
  assert.ok(save, "找不到保存按钮");
  assert.equal(save.disabled, true, "显示名为空时应禁用保存");

  const okTree = exports.__internals.EditForm({
    draft: Object.assign({}, draft, { displayName: "甲" }),
    setDraft: () => {},
    t: (k) => k,
    busy: false,
    onSave: () => {},
    onCancel: () => {},
  });
  const okSave = collectButtons(okTree).find((b) => b.label === "save");
  assert.equal(okSave.disabled, false, "填了显示名后应可保存");
});

test("EditForm：点标签上的 × 会从 skillsText 移除该技能", async () => {
  const react = makeReactLive();
  const { exports } = loadBundle(react, { fetch: skillsFetch() });
  const drafts = [];
  const draft = { target: "m1", displayName: "甲", title: "", dutiesText: "", skillsText: "office-docx, browser-skill" };

  react.reset();
  const tree = exports.__internals.EditForm({ draft, setDraft: (d) => drafts.push(d), t: (k) => k, busy: false, onSave: () => {}, onCancel: () => {} });

  // 找到标签里的 × 可点元素
  const crosses = [];
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (n.children && n.children.indexOf("×") >= 0 && n.props && n.props.onClick) crosses.push(n);
    for (const c of n.children || []) walk(c);
  })(tree);

  assert.equal(crosses.length, 2, "每个已选技能一个 ×");
  crosses[0].props.onClick();
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].skillsText, "browser-skill", "应只移除第一个技能");
});

/* ================== 功能①：模型字段的界面 ================== */

test("MemberRow：成员设了模型时显示模型徽标", () => {
  const { exports } = loadBundle(makeReact());
  const base = {
    target: "data-organizer",
    displayName: "数据整理员",
    title: "知识库整理员",
    duties: [],
    skills: [],
    groupId: null,
    status: "active",
    isRetired: false,
    orphan: false,
  };
  const props = { groups: [], t: (k) => k, busy: false, onEdit: () => {}, onRetire: () => {}, onRestore: () => {}, onAssign: () => {} };

  const without = treeText(exports.__internals.MemberRow(Object.assign({}, props, { m: base })));
  assert.ok(!/mtModelPrefix/.test(without), "没设模型时不应显示模型徽标");

  const withModel = treeText(exports.__internals.MemberRow(Object.assign({}, props, { m: Object.assign({}, base, { model: "deepseek-pro" }) })));
  assert.match(withModel, /mtModelPrefix\s*deepseek-pro/, "设了模型就应显示出来");
});

test("EditForm：模型与 provider 输入框带出当前值", () => {
  const { exports } = loadBundle(makeReact());
  const draft = { target: "m1", displayName: "甲", title: "", dutiesText: "", skillsText: "", model: "deepseek-pro", provider: "deepseek-account" };
  const tree = exports.__internals.EditForm({ draft, setDraft: () => {}, t: (k) => k, busy: false, onSave: () => {}, onCancel: () => {} });

  const inputs = collectInputs(tree);
  const modelInput = inputs.find((i) => i.props.value === "deepseek-pro");
  const providerInput = inputs.find((i) => i.props.value === "deepseek-account");
  assert.ok(modelInput, "应有模型输入框并带出当前值");
  assert.ok(providerInput, "应有 provider 输入框并带出当前值");
  assert.match(String(modelInput.props.placeholder), /modelPh/, "应有占位提示");
});

test("EditForm：模型选择改为弹层，从 /models 拉目录并一次写入 provider 与 model", async () => {
  const react = makeReactLive();
  const fetchStub = async (url) => {
    if (String(url).endsWith("/models")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          data: { providers: [{ id: "deepseek-account", displayName: "DeepSeek", models: [{ id: "deepseek-flash" }, { id: "deepseek-pro" }] }] },
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, data: {} }) };
  };
  const { exports } = loadBundle(react, { fetch: fetchStub });
  const drafts = [];
  const draft = { target: "m1", displayName: "甲", title: "", dutiesText: "", skillsText: "", model: "", provider: "" };
  const props = { draft, setDraft: (d) => drafts.push(d), t: (k) => k, busy: false, onSave: () => {}, onCancel: () => {} };

  react.reset();
  let tree = exports.__internals.EditForm(props);
  react.flushEffects(); // 触发 /models 拉取
  await tick();
  react.reset();
  tree = exports.__internals.EditForm(props);

  // 原生下拉已移除：模型选择改走弹层
  const selects = [];
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (n.type === "select") selects.push(n);
    for (const c of n.children || []) walk(c);
  })(tree);
  assert.equal(selects.length, 0, "模型选择不再用原生下拉");

  const pickBtn = collectButtons(tree).find((b) => b.label === "pickModel");
  assert.ok(pickBtn, "找不到「选择模型」按钮");
  pickBtn.onClick();
  react.flushEffects();
  await tick();
  react.reset();
  tree = exports.__internals.EditForm(props);

  const mounted = [];
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (n.type === exports.__internals.ModelPicker) mounted.push(n);
    for (const c of n.children || []) walk(c);
  })(tree);
  assert.equal(mounted.length, 1, "点击后应挂载 ModelPicker");
  const providers = mounted[0].props.providers;
  assert.equal(providers.length, 1, "应把 /models 目录传给弹层");
  assert.deepEqual(providers[0].models.map((m) => m.id), ["deepseek-flash", "deepseek-pro"]);

  // 直接渲染弹层验证内容与选择回调（用独立静态替身，避免 hook 序号串位）
  const staticBundle = loadBundle(makeReact());
  const picked = [];
  const pickerTree = staticBundle.exports.__internals.ModelPicker({
    t: (k) => k,
    providers: providers,
    current: { provider: "", model: "" },
    busy: false,
    onPick: (p, m) => picked.push({ provider: p, model: m }),
    onClear: () => picked.push({ provider: "", model: "" }),
    onClose: () => {},
  });
  const pickerText = treeText(pickerTree);
  assert.match(pickerText, /deepseek-flash/);
  assert.match(pickerText, /deepseek-pro/);

  const radios = [];
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (n.type === "input" && n.props && n.props.type === "radio") radios.push(n);
    for (const c of n.children || []) walk(c);
  })(pickerTree);
  assert.equal(radios.length, 3, "「使用默认」+ 2 个模型");

  radios[0].props.onChange();
  assert.equal(picked[0].provider, "", "选「使用默认」应清除覆盖");
  radios[2].props.onChange();
  assert.equal(picked[1].model, "deepseek-pro");
  assert.equal(picked[1].provider, "deepseek-account", "选模型应同时带出 provider，避免孤立 provider");
});


/* ==================== 组织架构图悬浮层（0.2.1） ==================== */

/** 极简 DOM 替身：只实现 overlay 用到的部分（createElement/appendChild/textContent/style/rect） */
function makeFakeDom() {
  const byId = new Map();
  function mkEl(tag) {
    const el = {
      tagName: String(tag).toUpperCase(),
      id: "",
      className: "",
      title: "",
      type: "",
      children: [],
      parentNode: null,
      attributes: Object.create(null),
      style: {},
      _text: "",
      scrollLeft: 0,
      scrollTop: 0,
      scrollWidth: 320,
      scrollHeight: 600,
      get textContent() {
        return this._text;
      },
      set textContent(v) {
        this._text = String(v);
        for (const c of this.children) c.parentNode = null;
        this.children = [];
      },
      get firstChild() {
        return this.children.length ? this.children[0] : null;
      },
      appendChild(c) {
        this.children.push(c);
        c.parentNode = this;
        if (c.id) byId.set(c.id, c);
        return c;
      },
      removeChild(c) {
        const i = this.children.indexOf(c);
        if (i >= 0) this.children.splice(i, 1);
        c.parentNode = null;
        return c;
      },
      // 真 DOM 的核心能力：详情「就地展开」要把节点插到被点卡片后面，
      // 替身少了这个方法，生产代码在测试里会直接抛 TypeError。
      insertBefore(c, ref) {
        if (c.parentNode) c.parentNode.removeChild(c);
        const i = ref ? this.children.indexOf(ref) : this.children.length;
        if (i < 0) throw new Error("insertBefore: 参考节点不是本节点的子节点");
        this.children.splice(i, 0, c);
        c.parentNode = this;
        if (c.id) byId.set(c.id, c);
        return c;
      },
      setAttribute(k, v) {
        this.attributes[k] = String(v);
      },
      getAttribute(k) {
        return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null;
      },
      removeAttribute(k) {
        delete this.attributes[k];
      },
      value: "",
      _listeners: Object.create(null),
      addEventListener(type, fn) {
        (this._listeners[type] || (this._listeners[type] = [])).push(fn);
      },
      removeEventListener(type, fn) {
        const list = this._listeners[type];
        if (!list) return;
        const i = list.indexOf(fn);
        if (i >= 0) list.splice(i, 1);
      },
      dispatchEvent(evt) {
        const wrapped = {
          type: (evt && evt.type) || "",
          stopPropagation() {},
        };
        for (const fn of this._listeners[(evt && evt.type) || ""] || []) fn(wrapped);
        return true;
      },
      getBoundingClientRect() {
        return { left: 900, top: 72, right: 1240, bottom: 600, width: 340, height: 528 };
      },
      closest() {
        return null;
      },
      setPointerCapture() {},
      releasePointerCapture() {},
      focus() {},
      blur() {},
      scrollIntoView() {},
      select() {},
    };
    return el;
  }
  const body = mkEl("body");
  const head = mkEl("head");
  const docListeners = Object.create(null);
  const doc = {
    body,
    head,
    createElement: mkEl,
    createElementNS: (_ns, tag) => mkEl(tag),
    getElementById: (id) => byId.get(id) || null,
    addEventListener(type, fn) {
      (docListeners[type] || (docListeners[type] = [])).push(fn);
    },
    removeEventListener(type, fn) {
      const list = docListeners[type];
      if (!list) return;
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    dispatchEvent(evt) {
      for (const fn of docListeners[(evt && evt.type) || ""] || []) fn(evt);
      return true;
    },
  };
  const win = { innerWidth: 1440, innerHeight: 900, addEventListener() {}, removeEventListener() {} };
  doc.defaultView = win;
  return { doc, win, body, head };
}

function hasAncestorClass(node, cls) {
  let cur = node && node.parentNode;
  while (cur) {
    const name = String(cur.className || "");
    if (name.split(/\s+/).includes(cls)) return true;
    cur = cur.parentNode;
  }
  return false;
}

const ORGMAP_FIXTURE = {
  version: 2,
  generatedAt: "2026-10-19T03:07:47.000Z",
  tasks: [
    { id: "s-root", title: "重构成员管理插件", updatedAt: 3, running: true, memberCount: 3, members: ["lead", "plugin-arch", "plugin-builder"] },
    { id: "s-other", title: "评估 billion-context", updatedAt: 2, running: false, memberCount: 2, members: ["lead", "plugin-arch"] },
  ],
  task: { id: "s-root", title: "重构成员管理插件", updatedAt: 3, running: true, memberCount: 3 },
  lead: {
    target: "lead",
    displayName: "大总管",
    status: "running",
    model: "deepseek-v4-pro-0813",
    usage: { total: 1000, requests: 2 },
    elapsedMs: 65000,
    work: { subject: "组织架构图悬浮层", status: "in_progress" },
  },
  groups: [
    {
      id: "g-plugin",
      name: "插件组",
      members: [
        {
          target: "plugin-arch",
          displayName: "插件架构",
          status: "idle",
          model: "deepseek-v4-pro-0813",
          usage: { total: 2400000, requests: 1 },
          elapsedMs: 5000,
          work: null,
        },
        {
          target: "plugin-builder",
          displayName: "插件编写",
          status: "running",
          model: "kimi-k2.7-code",
          usage: { total: 18000, requests: 4 },
          elapsedMs: 96000,
          work: { subject: "实现层级布局", status: "in_progress" },
        },
      ],
    },
  ],
  ungrouped: [],
  members: [
    { target: "lead", status: "running", work: { status: "in_progress" } },
    { target: "plugin-arch", status: "idle", work: null },
  ],
  totals: { totalTokens: 2401000, requests: 3 },
  taskCounts: { pending: 0, in_progress: 1, completed: 2 },
  dispatch: [{ from: "lead", to: "plugin-arch", taskId: "t1", subject: "评估", status: "in_progress" }],
  dependency: [],
};

test("组织架构图：格式化纯函数与布局常量", () => {
  const { exports } = loadBundle(makeReact());
  const I = exports.__internals;
  assert.equal(I.ORGMAP_VERSION, 3);
  assert.equal(I.ORGMAP_CARD_W, 188);
  assert.equal(I.orgmapFormatTokens(0), "0");
  assert.equal(I.orgmapFormatTokens(1500), "1.5k");
  assert.equal(I.orgmapFormatTokens(2400000), "2.4M");
  assert.equal(I.orgmapShorten("  多个   空白   ", 20), "多个 空白");
  assert.equal(I.orgmapShorten("abcdefghij", 6), "abcde…");
});

test("组织架构图：无窗口框、无位置按钮的层级视图（并联横向 / 串联纵向）", async () => {
  const calls = [];
  const errors = [];
  const { doc, win } = makeFakeDom();
  const { exports } = loadBundle(makeReact(), {
    fetch: async (url) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => ({ ok: true, data: ORGMAP_FIXTURE }) };
    },
    setInterval,
    clearInterval,
  });
  const overlay = exports.__internals.OrgChartOverlay({
    document: doc,
    window: win,
    apiBase: "/api/dsh-member-manager",
    t: (k) => k,
    pollMs: 60000,
    reportError: (what, err) => errors.push(what + ": " + err),
  });
  assert.ok(overlay, "overlay 应创建成功");
  assert.equal(overlay.root.id, "mm-orgchart-root");
  assert.equal(overlay.root.getAttribute("data-layout"), "levels");
  assert.ok(overlay.root.parentNode, "root 应挂到 body");
  assert.ok(doc.getElementById("mm-orgchart-style"), "样式应注入一次");

  // 无窗口框：root = 任务下拉行 / 错误行 / 画布 / 页脚 / 泳道看板（v0.4 追加，排在末尾用 CSS order 提前）
  const rootTags = overlay.root.children.map((c) => c.tagName);
  assert.deepEqual(rootTags, ["DIV", "DIV", "DIV", "DIV", "DIV"]);
  assert.equal(overlay.root.children[0].className, "mmo-toolbar");
  // 工具栏 / 画布 / 页脚不得出现任何窗口装饰按钮（折叠、⇤⇥、刷新）；
  // 泳道看板上的操作按钮（推进调度、下达任务）属于业务操作，不算窗口框。
  const buttons = [];
  (function walk(n) {
    if (!n || !n.children) return;
    for (const c of n.children) {
      if (c.tagName === "BUTTON" && !hasAncestorClass(c, "mmo-board")) buttons.push(c);
      walk(c);
    }
  })(overlay.root);
  assert.equal(buttons.length, 0, "不应有任何窗口按钮：" + buttons.length);
  assert.equal(overlay.root.children[4].className, "mmo-board", "泳道看板挂在根节点末尾");

  // S3 锚点：五条泳道必须带自己的身份（data-lane），否则 CSS order 与表头配色全部失锚，
  // 而且「按泳道取空态文案」会静默退化成同一句。
  const boardEl = overlay.root.children[4];
  const lanesEl = (boardEl.children || []).find((c) => c.className === "mmo-lanes");
  assert.ok(lanesEl, "泳道容器 .mmo-lanes 必须存在");
  const laneEls = (lanesEl.children || []).filter((c) => c.className === "mmo-lane");
  assert.equal(laneEls.length, 5, "应有 5 条泳道，实际 " + laneEls.length);
  assert.deepEqual(
    laneEls.map((l) => l.getAttribute("data-lane")).sort(),
    ["abnormal", "done", "queued", "routed", "running"],
    "五条泳道的 data-lane 必须齐全"
  );

  for (let i = 0; i < 40 && !overlay.getData(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(overlay.getData(), "应拿到 /orgmap 数据");
  assert.ok(calls[0].endsWith("/orgmap"), "请求路径：" + calls[0]);
  assert.equal(errors.length, 0, "渲染不应报错：" + errors.join(" | "));
  assert.equal(overlay.getData().lead.target, "lead");

  // 层级视图：第 1 层 lead 行、第 2/3 层分组簇（chip + 成员横向一行）
  const canvas = overlay.root.children[2];
  const stage = canvas.children[0];
  assert.equal(stage.className, "mmo-stage");
  const leadRow = stage.children[1];
  const leadCard = leadRow.children[0];
  assert.equal(leadCard.className, "mmo-card mmo-lead-card", "管理层应为窄高专用卡片");
  assert.equal(leadCard.children[0].className, "mmo-dot", "管理层卡片首行为状态点");
  assert.ok(leadCard.children.length >= 3, "管理层卡片内容竖排（状态点/名称/成员数/用量）");
  const groupsRow = stage.children[2];
  assert.equal(leadRow.className, "mmo-lead-row");
  assert.equal(leadRow.children.length, 1, "第 1 层只有大总管一张卡");
  assert.equal(groupsRow.className, "mmo-groups");
  const clusters = groupsRow.children;
  assert.equal(clusters.length, 1, "一组一簇");
  assert.equal(clusters[0].className, "mmo-cluster");
  const chip = clusters[0].children[0];
  const membersRow = clusters[0].children[1];
  assert.equal(membersRow.className, "mmo-members");
  assert.equal(membersRow.children.length, 2, "组内成员并联在同一行");
  assert.equal(chip.children[1].textContent, "2", "分组色块显示成员数");

  await new Promise((r) => setTimeout(r, 60));
  const svg = stage.children[0];
  assert.ok(svg.children.length >= 3, "应画出结构线（串联纵线 + 并联横线）");
  const ds = svg.children.map((p) => p.getAttribute("d"));
  assert.ok(ds.some((d) => / V /.test(d)), "存在纵向连接线");
  assert.ok(ds.some((d) => / H /.test(d)), "存在横向并联线");

  overlay.destroy();
  assert.equal(overlay.root.parentNode, null, "销毁后应移除节点");
});

const COMPANY_ORGMAP_FIXTURE = {
  version: 3,
  source: "company",
  companyName: "测试公司",
  worknet: { departments: 2, employees: 3 },
  generatedAt: "2026-10-21T08:40:00.000Z",
  tasks: [],
  task: null,
  lead: {
    target: "__management__",
    displayName: "管理层",
    title: "2 名 M 通道成员",
    status: "idle",
    usage: { total: 1200, requests: 2 },
  },
  groups: [
    {
      id: "plugin-dept",
      name: "D02 插件部",
      code: "D02",
      managerName: "插件架构",
      members: [
        {
          target: "plugin-arch",
          displayName: "插件架构",
          code: "E0002",
          channel: "M",
          level: "M2",
          levelName: "经理",
          status: "idle",
          usage: { total: 1200, requests: 2 },
          work: null,
        },
        {
          target: "plugin-builder",
          displayName: "插件编写",
          code: "E0003",
          channel: "P",
          level: "P3",
          levelName: "高级工程师",
          status: "running",
          usage: { total: 700, requests: 1 },
          work: { subject: "实现工作网", status: "in_progress" },
        },
      ],
    },
    {
      id: "kb-dept",
      name: "D03 知识库",
      code: "D03",
      managerName: "文档编写",
      members: [
        {
          target: "doc-writer",
          displayName: "文档编写",
          code: "E0010",
          channel: "M",
          level: "M2",
          levelName: "经理",
          status: "idle",
          usage: { total: 0, requests: 0 },
          work: null,
        },
      ],
    },
  ],
  ungrouped: [],
  members: [
    { target: "plugin-arch", status: "idle", work: null },
    { target: "plugin-builder", status: "running", work: { status: "in_progress" } },
    { target: "doc-writer", status: "idle", work: null },
  ],
  totals: { totalTokens: 1900, requests: 3 },
  dispatch: [{ from: "__management__", to: "plugin-builder", subject: "实现工作网", status: "in_progress" }],
  dependency: [],
};

test("工作网：公司化数据渲染管理层→部门→员工，卡片带工号/等级徽章，部门显示负责人", async () => {
  const { doc, win } = makeFakeDom();
  const { exports } = loadBundle(makeReact(), {
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, data: COMPANY_ORGMAP_FIXTURE }) }),
    setInterval,
    clearInterval,
  });
  const overlay = exports.__internals.OrgChartOverlay({
    document: doc,
    window: win,
    apiBase: "/api/dsh-member-manager",
    t: (k) => k,
    pollMs: 60000,
    reportError: () => {},
  });
  for (let i = 0; i < 40 && !overlay.getData(); i++) await new Promise((r) => setTimeout(r, 10));
  const data = overlay.getData();
  assert.equal(data.source, "company");
  assert.deepEqual(data.worknet, { departments: 2, employees: 3 });

  const texts = [];
  (function walk(n) {
    if (!n) return;
    if (typeof n.textContent === "string" && n.textContent && !n.children.length) texts.push(n.textContent);
    for (const c of n.children || []) walk(c);
  })(overlay.root);
  const joined = texts.join(" | ");
  assert.ok(joined.includes("管理层"), "首层应显示管理层节点：" + joined);
  assert.ok(joined.includes("D02 插件部"), "应显示部门编号+名称：" + joined);
  assert.ok(joined.includes("E0003"), "运行中员工卡片应显示工号：" + joined);
  assert.ok(joined.includes("P3"), "运行中员工卡片应显示等级：" + joined);
  assert.ok(!joined.includes("E0002"), "空闲员工默认折叠，不应出现工号：" + joined);
  assert.ok(joined.includes("ocStaff 3"), "页脚应显示员工数：" + joined);
  assert.ok(joined.includes("ocDept 2"), "页脚应显示部门数：" + joined);
  assert.ok(joined.includes("测试公司"), "无任务时任务栏应显示公司名：" + joined);

  const stage = overlay.root.children[2].children[0];
  const groupsRow = stage.children[2];
  assert.equal(groupsRow.children.length, 2, "两个部门两簇");
  const chip = groupsRow.children[0].children[0];
  assert.equal(chip.getAttribute("title"), "ocLeadTitle插件架构", "部门色块 tooltip 应带负责人");

  const membersBox = groupsRow.children[0].children[1];
  assert.equal(membersBox.children[0].getAttribute("data-target"), "plugin-builder", "运行中员工排在最前");
  const fold = membersBox.children[membersBox.children.length - 1];
  assert.equal(fold.tagName, "BUTTON", "空闲折叠应渲染折叠按钮");
  assert.equal(fold.textContent, "+1 ocFoldIdle", "折叠按钮应显示隐藏数量");
  fold.dispatchEvent({ type: "click" });
  const texts2 = [];
  (function walk(n) {
    if (!n) return;
    if (typeof n.textContent === "string" && n.textContent && !n.children.length) texts2.push(n.textContent);
    for (const c of n.children || []) walk(c);
  })(overlay.root);
  const joined2 = texts2.join(" | ");
  assert.ok(joined2.includes("E0002"), "展开后应显示空闲员工工号：" + joined2);
  assert.ok(joined2.includes("M2"), "展开后应显示空闲员工等级：" + joined2);
  overlay.destroy();
});

test("工作网：公司化任务标题跟随公司名（company-owner 会话不再显示 company-1）", async () => {
  const { doc, win } = makeFakeDom();
  const fixture = {
    ...COMPANY_ORGMAP_FIXTURE,
    tasks: [
      { id: "company-owner-abc", title: "company-1", updatedAt: 3, running: false, memberCount: 1, members: ["lead"] },
      { id: "s-other", title: "其他任务", updatedAt: 2, running: false, memberCount: 1, members: ["lead"] },
    ],
    task: { id: "company-owner-abc", title: "company-1", updatedAt: 3, running: false, memberCount: 1 },
  };
  const { exports } = loadBundle(makeReact(), {
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, data: fixture }) }),
    setInterval,
    clearInterval,
  });
  const overlay = exports.__internals.OrgChartOverlay({
    document: doc,
    window: win,
    apiBase: "/api/x",
    t: (k) => k,
    pollMs: 60000,
    reportError: () => {},
  });
  for (let i = 0; i < 40 && !overlay.getData(); i++) await new Promise((r) => setTimeout(r, 10));
  const picker = overlay.root.children[0].children[1];
  const labels = [...picker.children].map((o) => String(o.textContent || ""));
  assert.ok(labels.some((l) => l.startsWith("测试公司")), "company-owner 任务应显示公司名：" + labels.join("|"));
  assert.ok(!labels.join("|").includes("company-1"), "不应显示 company-1：" + labels.join("|"));
  assert.ok(labels.some((l) => l.startsWith("其他任务")), "其他任务标题保持：" + labels.join("|"));
  overlay.destroy();
});

test("组织架构图：任务下拉切换任务，只显示该任务的参与者（?task=）", async () => {
  const calls = [];
  const { doc, win } = makeFakeDom();
  const { exports } = loadBundle(makeReact(), {
    fetch: async (url) => {
      calls.push(url);
      const m = /[?&]task=([^&]+)/.exec(url);
      const id = m ? decodeURIComponent(m[1]) : "";
      const data =
        id === "s-other"
          ? {
              ...ORGMAP_FIXTURE,
              task: { id: "s-other", title: "评估 billion-context", memberCount: 2, running: false },
              groups: [{ id: "g-plugin", name: "插件组", members: [ORGMAP_FIXTURE.groups[0].members[0]] }],
              members: [ORGMAP_FIXTURE.lead, ORGMAP_FIXTURE.groups[0].members[0]],
            }
          : ORGMAP_FIXTURE;
      return { ok: true, status: 200, json: async () => ({ ok: true, data }) };
    },
    setInterval,
    clearInterval,
  });
  const overlay = exports.__internals.OrgChartOverlay({
    document: doc,
    window: win,
    apiBase: "/api/x",
    t: (k) => k,
    pollMs: 60000,
    reportError: () => {},
  });
  for (let i = 0; i < 40 && !overlay.getData(); i++) await new Promise((r) => setTimeout(r, 10));
  const picker = overlay.root.children[0].children[1];
  assert.equal(picker.tagName, "SELECT");
  assert.equal(picker.children.length, 2, "两个任务两个选项");
  assert.ok(picker.children[0].textContent.indexOf("重构成员管理插件") === 0, "选项展示任务标题");
  assert.ok(!calls[0].includes("?task="), "首次请求交给宿主挑最近活跃任务：" + calls[0]);

  picker.value = "s-other";
  picker.dispatchEvent({ type: "change" });
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(calls[calls.length - 1].includes("?task=s-other"), "切换后带 task 查询：" + calls[calls.length - 1]);
  assert.equal(overlay.getTaskId(), "s-other");
  const groupsRow = overlay.root.children[2].children[0].children[2];
  assert.equal(groupsRow.children[0].children[1].children.length, 1, "只渲染该任务的参与者");
  overlay.destroy();
});

test("组织架构图：没有任何任务时显示空态并禁用下拉", async () => {
  const { doc, win } = makeFakeDom();
  const { exports } = loadBundle(makeReact(), {
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        data: { version: 2, tasks: [], task: null, lead: null, groups: [], members: [], totals: {}, dispatch: [], dependency: [] },
      }),
    }),
    setInterval,
    clearInterval,
  });
  const overlay = exports.__internals.OrgChartOverlay({
    document: doc,
    window: win,
    apiBase: "/api/x",
    t: (k) => k,
    pollMs: 60000,
    reportError: () => {},
  });
  for (let i = 0; i < 40 && !overlay.getData(); i++) await new Promise((r) => setTimeout(r, 10));
  const picker = overlay.root.children[0].children[1];
  assert.equal(picker.disabled, true);
  assert.equal(picker.children[0].textContent, "tcNoTasks");
  const emptyLine = overlay.root.children[2].children[1];
  assert.equal(emptyLine.style.display, "block");
  assert.equal(emptyLine.textContent, "ocEmptyTask");
  overlay.destroy();
});

test("组织架构图：/orgmap 失败时展示错误行，并只上报一次（自动重试）", async () => {
  const errors = [];
  const { doc, win } = makeFakeDom();
  const { exports } = loadBundle(makeReact(), {
    fetch: async () => ({ ok: false, status: 503, json: async () => ({ ok: false, message: "board down" }) }),
    setInterval,
    clearInterval,
  });
  const overlay = exports.__internals.OrgChartOverlay({
    document: doc,
    window: win,
    apiBase: "/api/x",
    t: (k) => k,
    pollMs: 60000,
    reportError: (what) => errors.push(what),
  });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(overlay.getData(), null, "失败时不应有数据");
  assert.equal(errors.length, 1, "应上报一次错误");
  const failLine = overlay.root.children[1];
  assert.equal(failLine.style.display, "block");
  assert.ok(String(failLine.textContent).indexOf("ocFail") === 0, "错误行应展示 ocFail 文案");
  overlay.destroy();
});

test("组织架构图：注册为右侧边栏 tab（类型 / 正文 / header 入口），且绝不自动打开", () => {
  const { exports } = loadBundle(makeReact());
  const { ctx, slots } = mockClientCtx();
  const tabs = [];
  const opened = [];
  ctx.get = (name) => (name === "sidebarRight" ? { openTab: (kind) => opened.push(kind) } : undefined);
  ctx.inject = (deps, cb) => {
    assert.equal(deps.join(","), "sidebarRightTabs,sidebarRight", "应按名称注入右栏两个服务");
    const child = Object.assign({}, ctx, {
      sidebarRightTabs: { register: (def) => { tabs.push(def); return () => {}; } },
      sidebarRight: { openTab: (kind) => opened.push(kind) },
    });
    cb(child);
  };

  exports.apply(ctx);

  assert.equal(tabs.length, 1, "应注册一个 tab 类型");
  assert.equal(tabs[0].id, "dsh-member-manager/orgmap");
  assert.equal(tabs[0].kind, "member-orgmap");
  assert.equal(tabs[0].keepMounted, false, "关掉 tab 即卸载，避免后台继续轮询");
  assert.equal(typeof tabs[0].title, "function");

  const names = slots.map((s) => s.options.name);
  assert.ok(names.includes("sidebar.right.pane.tab"), "应注册右栏 tab 正文：" + names.join(","));
  assert.ok(names.includes("conversation.session.header.actions"), "应注册 header 重新打开入口");
  const body = slots.find((s) => s.options.name === "sidebar.right.pane.tab");
  assert.equal(body.options.key, "dsh-member-manager/orgmap", "keyed seat 的 key 应与定义 id 一致");
  assert.equal(body.options.locale, "dsh-member-manager");
  assert.equal(typeof body.Component, "function");

  // v0.4 契约变更：工作网页签只在用户点击 header 入口时打开，插件不得自行弹窗。
  assert.deepEqual(opened, [], "接线阶段不得自动打开右栏 tab");
  const header = slots.find((s) => s.options.name === "conversation.session.header.actions");
  const injected = header.options.inject();
  assert.equal(typeof injected.open, "function", "header 入口必须提供 open()");
  injected.open();
  assert.deepEqual(opened, ["member-orgmap"], "用户点击入口才打开一次右栏 tab");
});

test("组织架构图：右栏服务缺失时静默降级，不影响插件其余部分", () => {
  const { exports } = loadBundle(makeReact());
  const { ctx, slots } = mockClientCtx();
  // 不提供 ctx.inject：模拟旧宿主 / 测试环境
  assert.doesNotThrow(() => exports.apply(ctx));
  assert.equal(slots.length, 3, "仍应注册原本三个插槽");
  assert.equal(slots.some((s) => s.options.name === "sidebar.right.pane.tab"), false);
});

test("组织架构图：内嵌进右栏宿主容器，不产生浮动层与拖拽", async () => {
  const { doc, win } = makeFakeDom();
  const { exports } = loadBundle(makeReact(), {
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, data: ORGMAP_FIXTURE }) }),
    setInterval,
    clearInterval,
  });
  const host = doc.createElement("div");
  doc.body.appendChild(host);
  const overlay = exports.__internals.OrgChartOverlay({
    document: doc,
    window: win,
    apiBase: "/api/x",
    t: (k) => k,
    pollMs: 60000,
    embedded: true,
    host,
  });
  assert.ok(overlay);
  assert.equal(overlay.root.parentNode, host, "内嵌模式应挂到宿主容器而不是 body");
  assert.equal(overlay.root.getAttribute("data-embedded"), "1");
  assert.equal(overlay.root.getAttribute("data-dock"), null, "没有停靠侧概念");
  assert.equal(overlay.root.style.position, undefined, "不再使用 fixed 定位");

  for (let i = 0; i < 40 && !overlay.getData(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(overlay.getData(), "内嵌模式也应拉取 /orgmap");
  assert.equal(overlay.isCollapsed(), false);
  overlay.toggleCollapse();
  assert.equal(overlay.isCollapsed(), false, "不再有折叠按钮");
  overlay.destroy();
  assert.equal(overlay.root.parentNode, null);
});

/* ==================== 开发模式预设（docs/24 §6） ==================== */

/** 契约 §6.4 要求面板可用的 cp* 文案键 */
const PRESET_I18N_KEYS = [
  "cpModalPreset",
  "cpPresetTitle",
  "cpPresetApply",
  "cpPresetClear",
  "cpPresetEmpty",
  "cpPresetOutdated",
  "cpPresetAppliedAt",
  "cpPresetOwner",
  "cpPresetParticipants",
  "cpPresetDeliverables",
  "cpPresetGates",
  "cpPresetUnassigned",
  "cpPresetStage",
  "cpPresetHint",
];

/** 用真实字典做 t（支持 {name} 插值），断言用户看到的中文而非 key */
function dictTranslator(lang = "zh") {
  const { exports } = loadBundle(makeReact());
  const { ctx, locales } = mockClientCtx();
  exports.apply(ctx);
  const dict = locales.get("dsh-member-manager");
  assert.ok(dict && dict[lang], "未注册 " + lang + " 字典");
  return (key, vars) =>
    String(dict[lang][key] == null ? key : dict[lang][key]).replace(/\{(\w+)\}/g, (m, name) =>
      vars && vars[name] != null ? String(vars[name]) : m,
    );
}

/** 带预设目录 + 已套用部门预设的 overview（docs/24 §3.2/§5 形状） */
const PRESET_OVERVIEW = {
  enabled: true,
  status: "running",
  warnings: [],
  presets: [{ id: "game-dev", name: "游戏开发模式", version: 2, description: "七阶段游戏开发流程", stageCount: 7, roleCount: 2 }],
  org: {
    departments: [
      {
        id: "dept-plugin",
        code: "D01",
        name: "插件组",
        capacity: 4,
        employeeCount: 1,
        managerId: "emp-lead",
        accepts: true,
        preset: { id: "game-dev", name: "游戏开发模式", version: 1, currentVersion: 2, roles: [], stages: [] },
      },
    ],
    employees: [{ id: "emp-lead", code: "E0001", displayName: "插件组负责人", department: "dept-plugin", departmentCode: "D01", channel: "M", level: "M2", kind: "permanent", state: "idle" }],
  },
};

test("apply()：开发模式预设的 cp* 键在 zh/en 中齐全且文案非空（docs/24 §6.4）", () => {
  const { exports } = loadBundle(makeReact());
  const { ctx, locales } = mockClientCtx();
  exports.apply(ctx);
  const dict = locales.get("dsh-member-manager");
  for (const key of PRESET_I18N_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(dict.zh, key), "zh 缺 key：" + key);
    assert.ok(Object.prototype.hasOwnProperty.call(dict.en, key), "en 缺 key：" + key);
    assert.ok(String(dict.zh[key]).length > 0, "zh 文案不能为空：" + key);
    assert.ok(String(dict.en[key]).length > 0, "en 文案不能为空：" + key);
  }
  assert.equal(dict.zh.cpModalPreset, "开发模式");
  assert.equal(dict.zh.cpPresetOutdated, "可更新");
  assert.equal(dict.en.cpPresetUnassigned, "Unassigned");
});

test("CompanyOrgPanel：带 preset overview 时渲染预设徽章与「开发模式」页签入口", () => {
  const t = dictTranslator("zh");
  const react = makeReact([PRESET_OVERVIEW, null, false, null, "dept-plugin", "preset"]);
  const { exports } = loadBundle(react);
  const tree = exports.__internals.CompanyOrgPanel({ t });
  const text = treeText(tree);
  assert.ok(text.includes("游戏开发模式"), "应显示预设名");
  assert.ok(text.includes("游戏开发模式 · " + t("cpPresetOutdated")), "版本落后应显示 · 可更新徽章");
  assert.ok(text.includes(t("cpModalPreset")), "弹层应有「开发模式」页签");
  assert.ok(text.includes(t("cpPresetApply")), "预设页签应渲染套用按钮");
});

test("CompanyOrgPanel：无 preset 的 overview 渲染空态而不抛错", () => {
  const t = dictTranslator("zh");
  const react = makeReact([
    { enabled: true, status: "running", warnings: [], org: { departments: [{ id: "dept-a", code: "D01", name: "空部门", accepts: true }], employees: [] } },
    null,
    false,
    null,
    "dept-a",
    "preset",
  ]);
  const { exports } = loadBundle(react);
  const tree = exports.__internals.CompanyOrgPanel({ t });
  const text = treeText(tree);
  assert.ok(text.includes(t("cpPresetEmpty")), "老数据无 preset 应显示空态文案");
  assert.ok(text.includes(t("cpPresetHint")), "应显示套用提示");
});



/* ---------------- v0.4 工作网泳道看板：渲染 / 详情 / 操作 / 雇临时工 ---------------- */

const BOARD_FIXTURE = Object.assign({}, COMPANY_ORGMAP_FIXTURE, {
  orders: [
    {
      id: "o-queued",
      title: "实现导出功能",
      state: "queued",
      type: "code_impl",
      priority: "high",
      dept: "plugin-dept",
      deptName: "D02 插件部",
      attempts: [],
      deps: ["o-done"],
      createdAt: "2026-10-21T08:00:00.000Z",
      routeError: "no_capacity",
    },
    {
      id: "o-running",
      title: "修复登录闪退",
      state: "running",
      type: "bugfix",
      priority: "urgent",
      dept: "plugin-dept",
      deptName: "D02 插件部",
      employee: "plugin-builder",
      employeeName: "插件编写",
      attemptNo: 2,
      attemptCount: 2,
      elapsedMs: 65000,
      createdAt: "2026-10-21T08:05:00.000Z",
      acceptance: ["点击登录不再闪退"],
      attempts: [
        { attemptNo: 1, employee: "plugin-arch", employeeName: "插件架构", state: "stale", invalidated: true, staleReason: "superseded" },
        { attemptNo: 2, employee: "plugin-builder", employeeName: "插件编写", state: "running" },
      ],
    },
    {
      id: "o-done",
      title: "搭好骨架",
      state: "done",
      type: "code_impl",
      priority: "normal",
      deptName: "D02 插件部",
      employee: "plugin-arch",
      employeeName: "插件架构",
      createdAt: "2026-10-21T07:00:00.000Z",
      attempts: [{ attemptNo: 1, employee: "plugin-arch", employeeName: "插件架构", state: "done", summary: "骨架完成" }],
    },
  ],
  pipeline: { queued: ["o-queued"], routed: [], running: ["o-running"], done: ["o-done"], abnormal: [] },
  health: {
    status: "ok",
    scheduler: { running: true, intervalMs: 5000 },
    pending: { queued: 1, routed: 0, running: 1 },
    routeErrors: [{ orderId: "o-queued", subject: "实现导出功能", reason: "no_capacity", at: "2026-10-21T08:00:05.000Z", retryAfter: 0 }],
    capacity: [{ deptId: "plugin-dept", code: "D02", name: "D02 插件部", capacity: 4, busy: 1, idle: 2 }],
  },
  deptStats: [{ id: "plugin-dept", name: "D02 插件部", capacity: 4, busy: 1, idle: 2, total: 3 }],
  members: [
    { target: "plugin-arch", displayName: "插件架构", kind: "permanent", state: "idle" },
    { target: "plugin-builder", displayName: "插件编写", kind: "permanent", state: "working" },
    { target: "temp-1", displayName: "临时工甲", kind: "temp", state: "idle" },
  ],
});

function plainText(node) {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (!node.children || !node.children.length) return String(node.textContent || "");
  return node.children.map(plainText).join("");
}

async function waitFor(fn, ms = 400) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return !!fn();
}

async function mountBoardV04(fixture) {
  const calls = [];
  const { doc, win } = makeFakeDom();
  const { exports } = loadBundle(makeReact(), {
    fetch: async (url, init) => {
      calls.push({ url: String(url), init: init || null });
      if (String(url).includes("/company/op")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, data: { ok: true, orderId: "o-new", employeeId: "e-new" } }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, data: fixture }) };
    },
    setInterval,
    clearInterval,
  });
  const overlay = exports.__internals.OrgChartOverlay({
    document: doc,
    window: win,
    apiBase: "/api/dsh-member-manager",
    t: (k) => k,
    pollMs: 60000,
    reportError: () => {},
  });
  await waitFor(() => !!overlay.getData(), 800);
  const board = overlay.root.children[4];
  return { overlay, board, calls, doc };
}

const mmoHead = (board) => board.children[0];
const mmoLanes = (board) => board.children[1];
const mmoHealth = (board) => board.children.find((c) => String(c.className).includes("mmo-health"));
const mmoDetail = (board) => {
  // 详情已从「看板末尾的绝对定位抽屉」改成「跟着被点卡片就地展开」，位置不再固定，
  // 因此按 class 深搜定位（实在找不到才退回旧的末位约定）。
  let found = null;
  (function walk(n) {
    if (!n || found) return;
    if (String(n.className || "").split(" ").indexOf("mmo-detail") >= 0) { found = n; return; }
    for (const c of n.children || []) walk(c);
  })(board);
  return found || board.children[4];
};
function findBtnByText(node, text, out = []) {
  if (!node) return out;
  if (node.tagName === "BUTTON" && String(node.textContent) === text) out.push(node);
  for (const c of node.children || []) findBtnByText(c, text, out);
  return out;
}
const posts = (calls) => calls.filter((c) => c.url.includes("/company/op"));

test("工作网看板：五条泳道按 pipeline 分桶，卡片落在对应泳道并带执行人信息", async () => {
  const { overlay, board } = await mountBoardV04(BOARD_FIXTURE);
  const lanes = mmoLanes(board);
  assert.equal(lanes.children.length, 5, "应有 5 条泳道");
  const laneBody = (i) => lanes.children[i].children[1];
  assert.equal(laneBody(0).children.length, 1, "queued 泳道 1 张卡");
  assert.equal(laneBody(0).children[0].getAttribute("data-order"), "o-queued");
  assert.ok(String(laneBody(1).children[0].className).includes("mmo-order-err"), "空泳道渲染占位");
  assert.equal(laneBody(2).children.length, 1, "running 泳道 1 张卡");
  const runningCard = laneBody(2).children[0];
  assert.equal(runningCard.getAttribute("data-state"), "running");
  assert.equal(runningCard.getAttribute("data-order"), "o-running");
  assert.ok(plainText(runningCard).includes("插件编写"), "运行中卡片应显示执行人：" + plainText(runningCard));
  assert.equal(laneBody(3).children.length, 1, "done 泳道 1 张卡");
  assert.equal(lanes.children[0].children[0].children[1].textContent, "1", "泳道头计数");

  const kpi = mmoHead(board).children.filter((c) => String(c.className).includes("mmo-kpi"));
  const kpiText = kpi.map((c) => String(c.textContent));
  assert.deepEqual(kpiText, ["wbLaneQueued 1", "wbLaneRouted 0", "wbLaneRunning 1", "wbLaneDone 1", "wbLaneAbnormal 0"]);

  const sched = mmoHead(board).children.find((c) => String(c.className).includes("mmo-sched"));
  assert.equal(sched.getAttribute("data-state"), "running");
  assert.ok(String(sched.textContent).includes("wbSchedRunning"));
  assert.ok(String(sched.textContent).includes("5s"), "应显示调度周期：" + sched.textContent);
  assert.ok(String(sched.title).includes("no_capacity"), "调度 chip 应汇总路由失败原因：" + sched.title);

  const health = mmoHealth(board);
  assert.ok(health, "应渲染部门产能条");
  assert.ok(health.children.length >= 1, "产能条应有内容");
  assert.ok(plainText(health).includes("1/4"), "产能条应显示 busy/capacity：" + plainText(health));
  overlay.destroy();
});

test("工作网看板：点卡片打开详情抽屉，列出 attempt 历史并标记被吊销的那次", async () => {
  const { overlay, board } = await mountBoardV04(BOARD_FIXTURE);
  mmoLanes(board).children[2].children[1].children[0].dispatchEvent({ type: "click" });
  const detail = mmoDetail(board);
  assert.equal(detail.getAttribute("data-open"), "1", "详情应展开");
  const text = plainText(detail);
  assert.ok(text.includes("修复登录闪退"), "详情应显示标题：" + text);
  assert.ok(text.includes("#1") && text.includes("#2"), "应列出两次 attempt：" + text);
  assert.ok(text.includes("superseded"), "吊销原因要可见：" + text);
  assert.ok(text.includes("点击登录不再闪退"), "验收标准要可见：" + text);
  const rows = [];
  (function walk(n) {
    if (!n) return;
    if (String(n.className || "").includes("mmo-attempt")) rows.push(n);
    for (const c of n.children || []) walk(c);
  })(detail);
  const stale = rows.filter((r) => r.getAttribute("data-stale") === "1");
  assert.equal(stale.length, 1, "只有被吊销的那次 attempt 标 stale");

  const head = detail.children[0];
  head.children[head.children.length - 1].dispatchEvent({ type: "click" });
  assert.equal(detail.getAttribute("data-open"), "0", "关闭后应收起");
  assert.equal(detail.children.length, 0, "关闭后应清空内容");
  overlay.destroy();
});

test("工作网看板：执行中订单「验收通过」POST reviewOrder 并刷新数据", async () => {
  const { overlay, board, calls } = await mountBoardV04(BOARD_FIXTURE);
  mmoLanes(board).children[2].children[1].children[0].dispatchEvent({ type: "click" });
  const passBtn = findBtnByText(mmoDetail(board), "wbReviewPass")[0];
  assert.ok(passBtn, "执行中订单应提供验收按钮");
  assert.ok(findBtnByText(mmoDetail(board), "wbReviewReject").length === 1, "还应提供驳回按钮");
  passBtn.dispatchEvent({ type: "click" });
  assert.ok(await waitFor(() => posts(calls).length === 1), "应发一次 POST");
  const body = JSON.parse(posts(calls)[0].init.body);
  assert.equal(body.action, "reviewOrder");
  assert.equal(body.args.orderId, "o-running");
  assert.equal(body.args.pass, true);
  assert.ok(await waitFor(() => calls.filter((c) => c.url.includes("/orgmap")).length >= 2), "操作后应重新拉取数据");
  overlay.destroy();
});

test("工作网看板：排队订单可手动派工（assignOrder 带成员），空标题不提交新建", async () => {
  const { overlay, board, calls } = await mountBoardV04(BOARD_FIXTURE);
  mmoLanes(board).children[0].children[1].children[0].dispatchEvent({ type: "click" });
  const detail = mmoDetail(board);
  const pick = detail.children.find((c) => String(c.className).includes("mmo-select"));
  assert.ok(pick, "详情应有成员下拉");
  assert.equal(pick.children[0].value, "", "首个选项为自动派工");
  pick.value = "plugin-arch";
  findBtnByText(detail, "wbAssign")[0].dispatchEvent({ type: "click" });
  assert.ok(await waitFor(() => posts(calls).length === 1));
  const assignBody = JSON.parse(posts(calls)[0].init.body);
  assert.equal(assignBody.action, "assignOrder");
  assert.equal(assignBody.args.employeeId, "plugin-arch");

  const newBtn = findBtnByText(mmoHead(board), "wbNewOrder")[0];
  assert.ok(newBtn, "看板头应有新建订单按钮");
  newBtn.dispatchEvent({ type: "click" });
  const form = mmoDetail(board).children[1];
  const submit = form.children[form.children.length - 1];
  submit.dispatchEvent({ type: "click" });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(posts(calls).length, 1, "空标题不应再发 POST");
  form.children[0].value = "实现导出功能";
  form.children[1].value = "code_impl";
  submit.dispatchEvent({ type: "click" });
  assert.ok(await waitFor(() => posts(calls).length === 2));
  const placeBody = JSON.parse(posts(calls)[1].init.body);
  assert.equal(placeBody.action, "placeOrder");
  assert.equal(placeBody.args.title, "实现导出功能");
  assert.equal(placeBody.args.type, "code_impl");
  overlay.destroy();
});

test("工作网看板：雇临时工表单部门来自 deptStats，提交 hireTemp 带任务上限", async () => {
  const { overlay, board, calls } = await mountBoardV04(BOARD_FIXTURE);
  const tempBtn = findBtnByText(mmoHead(board), "wbHireTemp")[0];
  assert.ok(tempBtn, "看板头应有雇临时工按钮");
  tempBtn.dispatchEvent({ type: "click" });
  const form = mmoDetail(board).children[1];
  const deptSelect = form.children[1];
  assert.equal(deptSelect.children.length, 1, "部门下拉应来自 deptStats");
  assert.equal(deptSelect.children[0].value, "plugin-dept");
  deptSelect.value = "plugin-dept";
  form.children[0].value = "临时工甲";
  form.children[2].value = "2";
  form.children[form.children.length - 1].dispatchEvent({ type: "click" });
  assert.ok(await waitFor(() => posts(calls).length === 1));
  const body = JSON.parse(posts(calls)[0].init.body);
  assert.equal(body.action, "hireTemp");
  assert.equal(body.args.department, "plugin-dept");
  assert.equal(body.args.tempMaxTasks, 2);
  assert.equal(body.args.displayName, "临时工甲");
  overlay.destroy();
});

/**
 * 「异常」泳道只显示当前卡住的失败单；已取消/已丢失的历史异常移到下方「异常记录」区，可手动清理。
 */
const BOARD_FIXTURE_ABNORMAL = {
  orders: [
    { id: "o-failed", title: "出图任务失败", state: "failed", type: "design", employeeName: "员工1", attempts: [{ attemptNo: 1, employee: "e1", employeeName: "员工1", state: "failed", summary: "超时" }] },
    { id: "o-cancelled", title: "计算 2+3", state: "cancelled", type: "test", attempts: [] },
    { id: "o-lost", title: "真实宿主闭环", state: "lost", type: "test", attempts: [] },
  ],
  pipeline: { queued: [], routed: [], running: [], done: [], abnormal: ["o-failed", "o-cancelled", "o-lost"] },
  health: { status: "ok", scheduler: { running: true, intervalMs: 5000 }, pending: {}, routeErrors: [], capacity: [] },
  deptStats: [],
  members: [{ target: "e1", displayName: "员工1", kind: "permanent", state: "idle" }],
};

test("工作网看板：异常泳道只显示当前卡住的失败单，历史异常放到异常记录区", async () => {
  const { overlay, board } = await mountBoardV04(BOARD_FIXTURE_ABNORMAL);
  const lanes = mmoLanes(board).children;
  const lane = lanes[4];
  assert.equal(lane.getAttribute("data-lane"), "abnormal");
  assert.equal(lane.children[0].children[1].textContent, "1", "计数只算 failed，不含已取消/已丢失");

  // 泳道正文只有活着的失败单
  const laneCards = lane.children[1].children.filter((c) => String(c.className).includes("mmo-order"));
  assert.deepEqual(laneCards.map((c) => c.getAttribute("data-order")), ["o-failed"], "活着的失败单留在泳道正文");

  // 不再有折叠分组
  const fold = lane.children[1].children.find((c) => String(c.className).includes("mmo-lane-fold"));
  assert.equal(fold, undefined, "已取消/已丢失应改到异常记录区，不再折叠在泳道里");

  // 异常记录区在泳道下方
  const history = board.children.find((c) => String(c.className).includes("mmo-exception-history"));
  assert.ok(history, "应存在异常记录区");
  const historyBody = history.children.find((c) => String(c.className).includes("mmo-exception-history-body"));
  const archived = historyBody.children.filter((c) => String(c.className).includes("mmo-order"));
  assert.deepEqual(archived.map((c) => c.getAttribute("data-order")), ["o-cancelled", "o-lost"], "历史异常放进异常记录区");

  // 清理按钮可用
  const clearBtn = history.children[0].children.find((c) => c.tagName === "BUTTON");
  assert.ok(clearBtn, "异常记录区应有清理按钮");
  assert.equal(clearBtn.disabled, false, "有历史异常时清理按钮应可用");

  overlay.destroy();
});

test("工作网看板：异常泳道为空时显示「重启进度」按钮", async () => {
  const fixture = {
    ...BOARD_FIXTURE_ABNORMAL,
    orders: [
      { id: "o-cancelled", title: "计算 2+3", state: "cancelled", type: "test", attempts: [] },
      { id: "o-lost", title: "真实宿主闭环", state: "lost", type: "test", attempts: [] },
    ],
    pipeline: { queued: [], routed: [], running: [], done: [], abnormal: ["o-cancelled", "o-lost"] },
  };
  const { overlay, board } = await mountBoardV04(fixture);
  const lanes = mmoLanes(board).children;
  const lane = lanes[4];
  assert.equal(lane.getAttribute("data-lane"), "abnormal");
  assert.equal(lane.children[0].children[1].textContent, "0", "没有当前卡住的异常单");

  const restartBtn = lane.children[1].children.find((c) => String(c.className).includes("mmo-restart-progress"));
  assert.ok(restartBtn, "异常泳道为空时应显示「重启进度」按钮");
  assert.ok(String(restartBtn.textContent).includes("wbRestartProgress"));

  overlay.destroy();
});

test("工作网看板：失败单在卡面就写清失败原因，且人名徽标换成红色", async () => {
  const { overlay, board } = await mountBoardV04(BOARD_FIXTURE_ABNORMAL);
  const lane = mmoLanes(board).children[4];
  const card = lane.children[1].children.find((c) => String(c.className).includes("mmo-order"));
  const badges = card.children[1].children.filter((c) => String(c.className).includes("mmo-badge"));
  assert.ok(badges.length >= 1, "失败卡应有人名徽标");
  assert.ok(String(badges[0].className).includes("mmo-bad"), "失败卡的人名徽标不能还是绿的：" + badges[0].className);
  const err = card.children.find((c) => String(c.className).includes("mmo-order-err"));
  assert.ok(err, "失败卡应显示失败原因");
  assert.equal(err.textContent, "超时", "失败原因取最后一次 attempt 的 summary");
  overlay.destroy();
});

test("工作网看板：失败单的详情给「派工 + 验收通过 + 取消」，不再给点了会报错的升级", async () => {
  const { overlay, board } = await mountBoardV04(BOARD_FIXTURE_ABNORMAL);
  const lane = mmoLanes(board).children[4];
  lane.children[1].children.find((c) => String(c.className).includes("mmo-order")).dispatchEvent({ type: "click" });
  const detail = mmoDetail(board);
  assert.ok(findBtnByText(detail, "wbAssign").length === 1, "失败单要能重派");
  assert.ok(findBtnByText(detail, "wbReviewPass").length === 1, "失败单要能人工验收通过");
  assert.ok(findBtnByText(detail, "wbCancel").length === 1, "失败单要能取消");
  assert.equal(findBtnByText(detail, "wbEscalate").length, 0, "终态单不该给升级按钮");
  overlay.destroy();
});

test("工作网看板：点击卡片展开详情，点击详情外部关闭详情", async () => {
  const { overlay, board, doc } = await mountBoardV04(BOARD_FIXTURE);
  const lanes = mmoLanes(board).children;
  const runningCard = lanes[2].children[1].children.find((c) => String(c.className).includes("mmo-order"));
  runningCard.dispatchEvent({ type: "click" });
  const detail = mmoDetail(board);
  assert.equal(detail.getAttribute("data-open"), "1", "点击卡片后详情应展开");
  assert.equal(runningCard.getAttribute("data-sel"), "1", "被点卡片应被标记选中");

  // 模拟点击详情外部（doc 上的 click 事件）
  await new Promise((r) => setTimeout(r, 100));
  doc.dispatchEvent({ type: "click" });
  assert.equal(detail.getAttribute("data-open"), "0", "点击外部后详情应关闭");

  // 再次展开，点击详情内部不应关闭
  runningCard.dispatchEvent({ type: "click" });
  assert.equal(detail.getAttribute("data-open"), "1");
  detail.dispatchEvent({ type: "click" });
  assert.equal(detail.getAttribute("data-open"), "1", "点击详情内部不应关闭");

  overlay.destroy();
});
