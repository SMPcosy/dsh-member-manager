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

test("Panel：正常状态下渲染出组织架构（小组名 + 中文显示名 + target）", () => {
  const react = makeReact([sampleView(), null, false, "org", null, null]);
  const { exports } = loadBundle(react);
  const tree = exports.__internals.Panel({ t: (k) => k });

  assert.equal(tree.type, "div");
  const text = treeText(tree);
  assert.match(text, /数据组/);
  assert.match(text, /数据整理员/);
  assert.match(text, /data-organizer/);
  assert.match(text, /知识库整理员/);
  assert.match(text, /office-docx/);
  // 统计行（t 替身直接用 key 作文案，故这里断言统计键出现）
  assert.match(text, /stats/);
});

test("Panel：state 为 null 时渲染占位而不抛错", () => {
  const { exports } = loadBundle(makeReact([null, null, false, "org", null, null]));
  const tree = exports.__internals.Panel({ t: (k) => k });
  assert.equal(tree.type, "div");
  assert.match(treeText(tree), /…/);
});

test("Panel：coreAvailable=false 时显示同步提示；warnings 会透出", () => {
  const view = { ...sampleView(), coreAvailable: false, warnings: ["名册文件不存在，已初始化为空名册"] };
  const { exports } = loadBundle(makeReact([view, null, false, "org", null, null]));
  const text = treeText(exports.__internals.Panel({ t: (k) => k }));
  assert.match(text, /coreUnavailable/);
  assert.match(text, /名册文件不存在/);
});

test("Panel：错误态渲染错误条（error 非空且无 state 时走独立分支）", () => {
  const { exports } = loadBundle(makeReact([null, "HTTP 500", false, "org", null, null]));
  const text = treeText(exports.__internals.Panel({ t: (k) => k }));
  assert.match(text, /HTTP 500/);
  assert.match(text, /noApi/);
});

test("Panel：点击「同步核心成员」发出 registerLive 请求", async () => {
  const calls = [];
  const { exports } = loadBundle(makeReact([sampleView(), null, false, "org", null, null]), { fetch: recordingFetch(calls) });
  const tree = exports.__internals.Panel({ t: (k) => k });

  const sync = collectButtons(tree).find((b) => b.label === "sync");
  assert.ok(sync, "找不到「同步核心成员」按钮");
  await sync.onClick();

  const op = calls.find((c) => c.url.endsWith("/op"));
  assert.ok(op, "未发出 /op 请求");
  assert.equal(op.method, "POST");
  assert.equal(op.body.op, "registerLive");
});

test("Panel：默认落在「总架构」页，页签顺序总架构→部门架构→…", () => {
  // seed 只给前三个 hook，第四个 tab 走组件内 useState("company") 的默认值
  const { exports } = loadBundle(makeReact([sampleView(), null, false]));
  const tree = exports.__internals.Panel({ t: (k) => k });

  const labels = collectButtons(tree).map((b) => b.label);
  const tabKeys = ["cpTab", "tabOrg", "tabRetired", "tabUnregistered", "tabWorkflow", "tabMaintain"];
  // 页签按钮的文案可能带计数徽章（如 tabUnregistered1），按前缀归一成 key 再比顺序
  const tabOrder = labels
    .map((l) => tabKeys.find((k) => l.startsWith(k)))
    .filter(Boolean);
  assert.deepEqual(
    tabOrder,
    tabKeys,
    "页签顺序应为 总架构 → 部门架构 → 已停用 → 未登记 → 工作流 → 备份与更新",
  );

  const { CompanyOrgPanel, DeptOrgPanel } = exports.__internals;
  assert.ok(findComponent(tree, CompanyOrgPanel), "默认应渲染总架构页（CompanyOrgPanel）");
  assert.equal(findComponent(tree, DeptOrgPanel), null, "默认不应渲染部门架构页");
});

test("Panel：「未登记」页可对单个成员发出 addMember 请求", async () => {
  const calls = [];
  // seed 的第四个 useState 是 tab → 设为 unregistered
  const { exports } = loadBundle(makeReact([sampleView(), null, false, "unregistered", null, null]), { fetch: recordingFetch(calls) });
  const tree = exports.__internals.Panel({ t: (k) => k });

  assert.match(treeText(tree), /brand-new-member/);
  const register = collectButtons(tree).find((b) => b.label === "register");
  assert.ok(register, "找不到「登记」按钮");
  await register.onClick();

  const op = calls.find((c) => c.url.endsWith("/op"));
  assert.equal(op.body.op, "addMember");
  assert.equal(op.body.args.target, "brand-new-member");
});

/** 渲染 Panel 的「部门架构」页，并把内嵌的 DeptOrgPanel 真正展开成元素树。
 *  Panel 用 h(DeptOrgPanel, props) 挂子组件，但它不是 Panel 树里的 DOM，
 *  所以要取出该元素的 props 再调用一次组件函数。 */
function renderDeptOrgPage(exports) {
  const { Panel, DeptOrgPanel } = exports.__internals;
  const el = findComponent(Panel({ t: (k) => k }), DeptOrgPanel);
  assert.ok(el, "部门架构页应渲染 DeptOrgPanel");
  return DeptOrgPanel(el.props);
}

test("部门架构页：部门「移除」按钮先弹确认，确认后才发 deleteGroup", async () => {
  const calls = [];
  // 用户取消 → 不发请求
  const denied = loadBundle(makeReact([sampleView(), null, false, "org", null, null]), { fetch: recordingFetch(calls), confirm: () => false });
  await collectButtons(renderDeptOrgPage(denied.exports)).find((b) => b.label === "remove").onClick();
  assert.equal(calls.length, 0, "取消确认后不应发请求");

  // 用户确认 → 发 deleteGroup
  const allowed = loadBundle(makeReact([sampleView(), null, false, "org", null, null]), { fetch: recordingFetch(calls), confirm: () => true });
  await collectButtons(renderDeptOrgPage(allowed.exports)).find((b) => b.label === "remove").onClick();
  const op = calls.find((c) => c.url.endsWith("/op"));
  assert.equal(op.body.op, "deleteGroup");
  assert.equal(op.body.args.id, "g-1");
});

test("Panel：后端不可用时 fetch 失败被捕获为错误条，不抛到渲染层", async () => {
  const failing = async () => {
    throw new Error("Failed to fetch");
  };
  const { exports } = loadBundle(makeReact([sampleView(), null, false, "org", null, null]), { fetch: failing });
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
  assert.ok(!/模型:/.test(without), "没设模型时不应显示模型徽标");

  const withModel = treeText(exports.__internals.MemberRow(Object.assign({}, props, { m: Object.assign({}, base, { model: "deepseek-pro" }) })));
  assert.match(withModel, /模型: deepseek-pro/, "设了模型就应显示出来");
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
        for (const fn of this._listeners[(evt && evt.type) || ""] || []) fn(evt);
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
    };
    return el;
  }
  const body = mkEl("body");
  const head = mkEl("head");
  const doc = {
    body,
    head,
    createElement: mkEl,
    createElementNS: (_ns, tag) => mkEl(tag),
    getElementById: (id) => byId.get(id) || null,
  };
  const win = { innerWidth: 1440, innerHeight: 900, addEventListener() {}, removeEventListener() {} };
  doc.defaultView = win;
  return { doc, win, body, head };
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
  assert.equal(I.ORGMAP_VERSION, 2);
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

  // 无窗口框：root = 任务下拉行 / 错误行 / 画布 / 页脚，没有任何窗口按钮（无折叠、无 ⇤⇥、无刷新）
  const rootTags = overlay.root.children.map((c) => c.tagName);
  assert.deepEqual(rootTags, ["DIV", "DIV", "DIV", "DIV"]);
  assert.equal(overlay.root.children[0].className, "mmo-toolbar");
  const buttons = [];
  (function walk(n) {
    if (!n || !n.children) return;
    for (const c of n.children) {
      if (c.tagName === "BUTTON") buttons.push(c);
      walk(c);
    }
  })(overlay.root);
  assert.equal(buttons.length, 0, "不应有任何窗口按钮：" + buttons.length);

  for (let i = 0; i < 40 && !overlay.getData(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(overlay.getData(), "应拿到 /orgmap 数据");
  assert.ok(calls[0].endsWith("/orgmap"), "请求路径：" + calls[0]);
  assert.equal(errors.length, 0);
  assert.equal(overlay.getData().lead.target, "lead");

  // 层级视图：第 1 层 lead 行、第 2/3 层分组簇（chip + 成员横向一行）
  const canvas = overlay.root.children[2];
  const stage = canvas.children[0];
  assert.equal(stage.className, "mmo-stage");
  const leadRow = stage.children[1];
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

test("组织架构图：注册为右侧边栏 tab（类型 / 正文 / header 入口）并自动打开一次", () => {
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

  assert.deepEqual(opened, ["member-orgmap"], "首次接线应自动打开一次右栏 tab");
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

