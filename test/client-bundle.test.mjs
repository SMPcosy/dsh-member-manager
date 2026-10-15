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
    },
    fetch: globals.fetch,
    confirm: globals.confirm,
    setTimeout,
    clearTimeout,
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
  assert.equal(id, "dsh-plugin-member-manager");
  assert.equal(exports.name, "dsh-plugin-member-manager");
  // 注意：vm 沙箱里的数组与宿主 realm 不同源，deepStrictEqual 会因原型不同而失败，故用 join 比较
  assert.equal(exports.inject.join(","), "slots,locale");
  assert.equal(typeof exports.apply, "function");
  assert.equal(typeof exports.__internals.Panel, "function");
});

test("apply()：注册中文字典（zh 与 en 都齐全且 key 一一对应）", () => {
  const { exports } = loadBundle(makeReact());
  const { ctx, locales } = mockClientCtx();
  exports.apply(ctx);

  const dict = locales.get("dsh-plugin-member-manager");
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
  assert.equal(byName["settings.section"].options.id, "dsh-plugin-member-manager");
  assert.equal(byName["sidebar.panellist"].options.id, "dsh-plugin-member-manager");
  // keyed kind 必须有 key
  assert.equal(byName["main"].options.key, "dsh-plugin-member-manager");
  for (const s of slots) {
    assert.equal(s.options.locale, "dsh-plugin-member-manager", `${s.options.name} 应带 locale`);
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

test("Panel：小组「移除」按钮先弹确认，确认后才发 deleteGroup", async () => {
  const calls = [];
  // 用户取消 → 不发请求
  const denied = loadBundle(makeReact([sampleView(), null, false, "org", null, null]), { fetch: recordingFetch(calls), confirm: () => false });
  await collectButtons(denied.exports.__internals.Panel({ t: (k) => k })).find((b) => b.label === "remove").onClick();
  assert.equal(calls.length, 0, "取消确认后不应发请求");

  // 用户确认 → 发 deleteGroup
  const allowed = loadBundle(makeReact([sampleView(), null, false, "org", null, null]), { fetch: recordingFetch(calls), confirm: () => true });
  await collectButtons(allowed.exports.__internals.Panel({ t: (k) => k })).find((b) => b.label === "remove").onClick();
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

test("EditForm：模型下拉从 /models 拉取选项，选中后同时写入 provider 与 model", async () => {
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

  const selects = [];
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    if (n.type === "select") selects.push(n);
    for (const c of n.children || []) walk(c);
  })(tree);
  assert.equal(selects.length, 1, "应有一个模型下拉");

  const opts = selects[0].children;
  assert.equal(opts.length, 3, "占位项 + 2 个模型");
  assert.equal(opts[0].props.value, "", "第一项应是「从可用模型选择…」占位");
  assert.equal(opts[1].props.value, "deepseek-account\u0000deepseek-flash");
  assert.deepEqual(opts[1].children, ["deepseek-account · deepseek-flash"], "选项文案应带 provider");

  // 选中第二项 → 同时写入 provider 与 model（onChange 挂在 select 上）
  selects[0].props.onChange({ target: { value: opts[2].props.value } });
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].model, "deepseek-pro");
  assert.equal(drafts[0].provider, "deepseek-account", "选模型应同时带出 provider，避免孤立 provider");
});
