/**
 * dsh-member-manager · Web 面板（客户端半侧）
 *
 * 本文件是**手写的客户端 bundle**，遵循 DSH 客户端插件的固定壳格式：
 *   window.__ModuleLoader__.load({ id, factory: (require) => module.exports })
 * 只依赖基座模块表里的 react（`require("react")`），无其它依赖。
 *
 * 之所以手写而不经 esbuild 打包：本机没有任何 esbuild（profile 与 DSH 运行时里都没有），
 * 而本插件的客户端代码是单文件、无 JSX、无相对导入，手写壳反而更少依赖、更可复现。
 *
 * 数据来自宿主端 HTTP 路由：
 *   GET  /api/dsh-plugin-member-manager/state   → 组织架构视图
 *   POST /api/dsh-plugin-member-manager/op      → { op, args } 统一写入口
 *   GET  /api/dsh-plugin-member-manager/health  → 元信息
 */

window.__ModuleLoader__.load({
  id: "dsh-plugin-member-manager",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const { createElement: h, useCallback, useEffect, useMemo, useState } = require("react");

    const NS = "dsh-plugin-member-manager";
    const API = "/api/dsh-plugin-member-manager";

    const zh = {
      title: "成员管理",
      subtitle: "DSH 原生成员不可改名、不可删除；这里维护的是独立的组织架构覆盖层。",
      refresh: "刷新",
      sync: "同步核心成员",
      syncing: "同步中…",
      tabOrg: "组织架构",
      tabRetired: "已停用",
      tabUnregistered: "未登记",
      empty: "还没有成员。点「同步核心成员」把当前团队成员登记进来。",
      emptyGroup: "（空小组）",
      ungrouped: "未分组",
      unregisteredHint: "以下成员存在于 DSH 核心，但还没登记进名册：",
      register: "登记",
      registerAll: "全部登记",
      stats: "共 {members} 人 · 启用 {active} · 停用 {retired} · 小组 {groups}",
      coreUnavailable:
        "尚未同步到核心成员列表：在对话里执行一次 member_list / member_sync 工具即可同步（HTTP 路由拿不到 Agent 凭证）。",
      edit: "编辑",
      retire: "停用",
      restore: "恢复",
      save: "保存",
      cancel: "取消",
      remove: "移除",
      addGroup: "新建小组",
      groupName: "小组名称",
      groupDesc: "小组说明（可选）",
      create: "创建",
      displayName: "中文显示名",
      role: "岗位名称",
      duties: "岗位职责（每行一条）",
      skills: "技能（逗号分隔）",
      group: "所属小组",
      none: "（无）",
      confirmDeleteGroup: "删除小组「{name}」？组内成员会被置为未分组，不会被删除。",
      confirmRetire: "停用成员「{name}」？成员记录会保留，可随时恢复。",
      noApi: "插件后端未就绪（路由未注册）。",
      error: "操作失败",
      currentSessionMissing: "当前会话未列出",
      people: "人",
      pickSkills: "选择技能",
      searchSkills: "搜索技能名称或描述…",
      noSkills: "没有匹配的技能",
      done: "完成",
      skillTotal: "共 {n} 个技能",
      skillsHint: "也可直接输入自定义标签（逗号分隔）",
      model: "模型",
      modelPh: "模型 id（留空＝使用默认）",
      providerPh: "provider（可选）",
      modelPick: "从可用模型选择…",
    };

    const en = {
      title: "Member Manager",
      subtitle: "DSH members cannot be renamed or removed natively; this maintains a separate org overlay.",
      refresh: "Refresh",
      sync: "Register core members",
      syncing: "Syncing…",
      tabOrg: "Org chart",
      tabRetired: "Retired",
      tabUnregistered: "Unregistered",
      empty: "No members yet. Click “Register core members” to import the current team.",
      emptyGroup: "(empty group)",
      ungrouped: "Ungrouped",
      unregisteredHint: "These members exist in DSH core but are not in the registry yet:",
      register: "Register",
      registerAll: "Register all",
      stats: "{members} members · {active} active · {retired} retired · {groups} groups",
      coreUnavailable: "Core roster not synced yet: run the member_list / member_sync tool once so the host can cache it.",
      edit: "Edit",
      retire: "Retire",
      restore: "Restore",
      save: "Save",
      cancel: "Cancel",
      remove: "Remove",
      addGroup: "New group",
      groupName: "Group name",
      groupDesc: "Description (optional)",
      create: "Create",
      displayName: "Display name",
      role: "Job title",
      duties: "Duties (one per line)",
      skills: "Skills (comma separated)",
      group: "Group",
      none: "(none)",
      confirmDeleteGroup: "Delete group “{name}”? Its members become ungrouped, not deleted.",
      confirmRetire: "Retire “{name}”? The record is kept and can be restored.",
      noApi: "Plugin backend is not ready (routes not registered).",
      error: "Operation failed",
      currentSessionMissing: "not in current session",
      people: "",
      pickSkills: "Pick skills",
      searchSkills: "Search skill name or description…",
      noSkills: "No matching skills",
      done: "Done",
      skillTotal: "{n} skills available",
      skillsHint: "Or type custom tags (comma separated)",
      model: "Model",
      modelPh: "Model id (empty = default)",
      providerPh: "Provider (optional)",
      modelPick: "Pick from available models…",
    };

    /* ------------------------------ 样式 ------------------------------ */

    const S = {
      // 面板根容器：既能在「宿主给了固定高度」的插槽（main / settings.section）里
      // 以 100% 高度 + 纵向滚动成为自己的滚动容器，又能在宿主不限制高度时自然长高
      // 交给页面滚动。box-sizing + minWidth/minHeight:0 保证 flex/grid 布局里不被挤压。
      wrap: {
        padding: "16px 18px",
        font: "13px/1.6 system-ui, 'Segoe UI', 'Microsoft YaHei', sans-serif",
        color: "inherit",
        maxWidth: 1000,
        boxSizing: "border-box",
        minWidth: 0,
        minHeight: 0,
        height: "100%",
        overflowY: "auto",
      },
      h: { margin: "0 0 4px", fontSize: 16, fontWeight: 600 },
      sub: { margin: "0 0 12px", opacity: 0.7, fontSize: 12 },
      bar: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 },
      btn: { padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(127,127,127,.4)", background: "transparent", color: "inherit", cursor: "pointer", fontSize: 12 },
      btnPrimary: { padding: "5px 10px", borderRadius: 6, border: "1px solid transparent", background: "#2f6feb", color: "#fff", cursor: "pointer", fontSize: 12 },
      btnDanger: { padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(200,60,60,.5)", background: "transparent", color: "#c33", cursor: "pointer", fontSize: 12 },
      btnOn: { padding: "5px 10px", borderRadius: 6, border: "1px solid transparent", background: "rgba(47,111,235,.15)", color: "inherit", cursor: "pointer", fontSize: 12, fontWeight: 600 },
      card: { border: "1px solid rgba(127,127,127,.25)", borderRadius: 8, padding: 12, marginBottom: 12 },
      cardHead: { display: "flex", gap: 8, alignItems: "center", marginBottom: 8 },
      cardTitle: { fontWeight: 600, fontSize: 13 },
      count: { opacity: 0.6, fontSize: 12 },
      table: { width: "100%", borderCollapse: "collapse" },
      th: { textAlign: "left", padding: "6px 8px", borderBottom: "1px solid rgba(127,127,127,.25)", fontSize: 12, opacity: 0.7, fontWeight: 500 },
      td: { padding: "7px 8px", borderBottom: "1px solid rgba(127,127,127,.12)", verticalAlign: "top" },
      mono: { fontFamily: "ui-monospace, Consolas, monospace", fontSize: 11.5, opacity: 0.65 },
      badge: { display: "inline-block", padding: "1px 6px", margin: "0 4px 3px 0", borderRadius: 10, background: "rgba(127,127,127,.16)", fontSize: 11 },
      warnBadge: { display: "inline-block", padding: "1px 6px", margin: "0 4px 3px 0", borderRadius: 10, background: "rgba(210,150,30,.18)", fontSize: 11 },
      retired: { opacity: 0.55 },
      err: { padding: "8px 10px", borderRadius: 6, background: "rgba(200,60,60,.12)", color: "#c33", marginBottom: 10, fontSize: 12 },
      hint: { padding: "8px 10px", borderRadius: 6, background: "rgba(210,150,30,.12)", marginBottom: 10, fontSize: 12 },
      form: { border: "1px solid rgba(127,127,127,.3)", borderRadius: 8, padding: 12, marginBottom: 12, background: "rgba(127,127,127,.05)" },
      field: { marginBottom: 8 },
      label: { display: "block", fontSize: 11.5, opacity: 0.7, marginBottom: 3 },
      input: { width: "100%", boxSizing: "border-box", padding: "5px 8px", borderRadius: 6, border: "1px solid rgba(127,127,127,.4)", background: "transparent", color: "inherit", font: "inherit", fontSize: 12.5 },
      ta: { width: "100%", boxSizing: "border-box", minHeight: 56, padding: "5px 8px", borderRadius: 6, border: "1px solid rgba(127,127,127,.4)", background: "transparent", color: "inherit", font: "inherit", fontSize: 12.5 },
      row2: { display: "flex", gap: 10 },
    };

    /* ------------------------------- HTTP ------------------------------- */

    async function api(path, init) {
      const res = await fetch(API + path, init);
      let payload;
      try {
        payload = await res.json();
      } catch (e) {
        throw new Error("HTTP " + res.status);
      }
      if (!res.ok || (payload && payload.ok === false)) {
        throw new Error((payload && (payload.message || payload.code)) || "HTTP " + res.status);
      }
      return payload.data;
    }

    function post(op, args) {
      return api("/op", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: op, args: args || {} }),
      });
    }

    function splitLines(text) {
      return String(text || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    }
    function splitCommas(text) {
      return String(text || "").split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    }

    /* ------------------------------ 子组件 ------------------------------ */

    function MemberRow(props) {
      const { m, groups, t, busy, onEdit, onRetire, onRestore, onAssign } = props;
      const options = [{ id: "", name: "" }].concat(groups);
      return h(
        "tr",
        { style: m.isRetired ? S.retired : undefined },
        h(
          "td",
          { style: S.td },
          h("div", { style: { fontWeight: 600 } }, m.displayName || m.target),
          h("div", { style: S.mono }, m.target),
          m.model ? h("div", { style: { marginTop: 3 } }, h("span", { style: S.badge }, "模型: " + m.model)) : null,
        ),
        h(
          "td",
          { style: S.td },
          m.title ? h("div", null, m.title) : h("span", { style: { opacity: 0.4 } }, "—"),
          m.duties && m.duties.length
            ? h("ul", { style: { margin: "3px 0 0", paddingLeft: 16, opacity: 0.75 } }, m.duties.map((d, i) => h("li", { key: i }, d)))
            : null,
        ),
        h(
          "td",
          { style: S.td },
          m.skills && m.skills.length
            ? m.skills.map((s) => h("span", { key: s, style: S.badge }, s))
            : h("span", { style: { opacity: 0.4 } }, "—"),
          m.orphan ? h("div", null, h("span", { style: S.warnBadge }, t("currentSessionMissing"))) : null,
        ),
        h(
          "td",
          { style: S.td },
          h(
            "select",
            {
              style: Object.assign({}, S.input, { width: 130 }),
              value: m.groupId || "",
              disabled: busy,
              onChange: (e) => onAssign(m.target, e.target.value || null),
            },
            options.map((g) => h("option", { key: g.id || "_none", value: g.id }, g.name || t("none"))),
          ),
        ),
        h(
          "td",
          { style: Object.assign({}, S.td, { whiteSpace: "nowrap" }) },
          h("button", { style: S.btn, disabled: busy, onClick: () => onEdit(m) }, t("edit")),
          " ",
          m.isRetired
            ? h("button", { style: S.btn, disabled: busy, onClick: () => onRestore(m.target) }, t("restore"))
            : h("button", { style: S.btnDanger, disabled: busy, onClick: () => onRetire(m) }, t("retire")),
        ),
      );
    }

    function MemberTable(props) {
      const { members, groups, t, busy, onEdit, onRetire, onRestore, onAssign, emptyText } = props;
      if (!members.length) {
        return h("div", { style: { opacity: 0.5, fontSize: 12, padding: "4px 0" } }, emptyText);
      }
      return h(
        "table",
        { style: S.table },
        h(
          "thead",
          null,
          h(
            "tr",
            null,
            h("th", { style: S.th }, "显示名 / target"),
            h("th", { style: S.th }, t("role")),
            h("th", { style: S.th }, t("skills")),
            h("th", { style: S.th }, t("group")),
            h("th", { style: S.th }, ""),
          ),
        ),
        h(
          "tbody",
          null,
          members.map((m) =>
            h(MemberRow, {
              key: m.target,
              m: m,
              groups: groups,
              t: t,
              busy: busy,
              onEdit: onEdit,
              onRetire: onRetire,
              onRestore: onRestore,
              onAssign: onAssign,
            }),
          ),
        ),
      );
    }

    /* --------- 可搜索多选技能弹层（功能②）--------- */

    function SkillPicker(props) {
      const { t, selected } = props;
      const [catalog, setCatalog] = useState(null);
      const [search, setSearch] = useState("");
      const [error, setError] = useState(null);

      // 打开时才拉取技能目录，并缓存一次
      useEffect(() => {
        let alive = true;
        api("/skills")
          .then((d) => {
            if (alive) setCatalog(d && d.skills ? d.skills : []);
          })
          .catch((e) => {
            if (alive) setError(e && e.message ? e.message : String(e));
          });
        return () => {
          alive = false;
        };
      }, []);

      const q = String(search || "").trim().toLowerCase();
      const all = catalog || [];
      const filtered = q
        ? all.filter((s) => String(s.name).toLowerCase().indexOf(q) >= 0 || String(s.description || "").toLowerCase().indexOf(q) >= 0)
        : all;

      const box = { position: "fixed", inset: 0, background: "rgba(0,0,0,.38)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 };
      const card = { width: 580, maxWidth: "92vw", maxHeight: "80vh", background: "#fff", color: "#111", borderRadius: 10, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 12px 40px rgba(0,0,0,.3)" };
      const rowStyle = (on) => ({ display: "flex", gap: 9, alignItems: "flex-start", padding: "8px 14px", cursor: "pointer", background: on ? "rgba(47,111,235,.08)" : "transparent" });

      return h(
        "div",
        { style: box, onClick: props.onClose },
        h(
          "div",
          { style: card, onClick: (e) => e.stopPropagation() },
          h(
            "div",
            { style: { padding: "12px 14px", borderBottom: "1px solid #e5e7eb" } },
            h("div", { style: { fontWeight: 600, marginBottom: 8 } }, t("pickSkills") + (selected.length ? "（" + selected.length + "）" : "")),
            h("input", {
              style: { width: "100%", boxSizing: "border-box", padding: "6px 9px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13 },
              placeholder: t("searchSkills"),
              value: search,
              autoFocus: true,
              onChange: (e) => setSearch(e.target.value),
            }),
          ),
          h(
            "div",
            { style: { overflowY: "auto", flex: 1, padding: "6px 0" } },
            error
              ? h("div", { style: { padding: 14, color: "#c33", fontSize: 12 } }, error)
              : catalog === null
                ? h("div", { style: { padding: 14, opacity: 0.6, fontSize: 12 } }, "…")
                : filtered.length === 0
                  ? h("div", { style: { padding: 14, opacity: 0.6, fontSize: 12 } }, t("noSkills"))
                  : filtered.map((s) => {
                      const on = selected.indexOf(s.name) >= 0;
                      return h(
                        "label",
                        { key: s.name, style: rowStyle(on) },
                        h("input", { type: "checkbox", checked: on, onChange: () => props.onToggle(s.name), style: { marginTop: 3 } }),
                        h(
                          "div",
                          { style: { flex: 1 } },
                          h(
                            "div",
                            { style: { fontWeight: 600, fontSize: 13 } },
                            s.name,
                            s.source ? h("span", { style: { marginLeft: 6, fontWeight: 400, fontSize: 11, opacity: 0.6 } }, "· " + s.source) : null,
                          ),
                          s.description ? h("div", { style: { fontSize: 12, opacity: 0.75, marginTop: 2, lineHeight: 1.5 } }, s.description) : null,
                        ),
                      );
                    }),
          ),
          h(
            "div",
            { style: { padding: "10px 14px", borderTop: "1px solid #e5e7eb", display: "flex", gap: 8, alignItems: "center" } },
            h("span", { style: { fontSize: 12, opacity: 0.6 } }, all.length ? t("skillTotal").replace("{n}", String(all.length)) : ""),
            h("span", { style: { marginLeft: "auto" } }),
            h("button", { style: S.btnPrimary, onClick: props.onClose }, t("done")),
          ),
        ),
      );
    }

    function EditForm(props) {
      const { draft, setDraft, t, busy, onSave, onCancel } = props;
      const [picking, setPicking] = useState(false);
      const [models, setModels] = useState(null);
      // 拉一次可用模型目录，供下拉选择（目录外的 id 仍可手填）
      useEffect(() => {
        let alive = true;
        api("/models")
          .then((d) => {
            if (alive) setModels(d && d.providers ? d.providers : []);
          })
          .catch(() => {
            if (alive) setModels([]);
          });
        return () => {
          alive = false;
        };
      }, []);
      function f(key) {
        return {
          style: S.input,
          value: draft[key] || "",
          disabled: busy,
          onChange: (e) => setDraft(Object.assign({}, draft, { [key]: e.target.value })),
        };
      }
      const selected = splitCommas(draft.skillsText);
      function toggleSkill(name) {
        const has = selected.indexOf(name) >= 0;
        const next = has ? selected.filter((x) => x !== name) : selected.concat([name]);
        setDraft(Object.assign({}, draft, { skillsText: next.join(", ") }));
      }
      // 下拉每项编码成 "provider\u0000model"
      const modelOptions = [h("option", { key: "__pick", value: "" }, t("modelPick"))];
      for (const p of models || []) {
        for (const m of p.models || []) {
          modelOptions.push(h("option", { key: p.id + "/" + m.id, value: p.id + "\u0000" + m.id }, p.id + " · " + m.id));
        }
      }
      return h(
        "div",
        { style: S.form },
        h("div", { style: { fontWeight: 600, marginBottom: 8 } }, t("edit") + "：" + draft.target),
        h(
          "div",
          { style: S.row2 },
          h("div", { style: Object.assign({}, S.field, { flex: 1 }) }, h("label", { style: S.label }, t("displayName")), h("input", f("displayName"))),
          h("div", { style: Object.assign({}, S.field, { flex: 1 }) }, h("label", { style: S.label }, t("role")), h("input", f("title"))),
        ),
        h("div", { style: S.field }, h("label", { style: S.label }, t("duties")), h("textarea", Object.assign(f("dutiesText"), { style: S.ta }))),
        h(
          "div",
          { style: S.field },
          h("label", { style: S.label }, t("skills")),
          h(
            "div",
            { style: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 6 } },
            selected.length
              ? selected.map((s) =>
                  h(
                    "span",
                    { key: s, style: Object.assign({}, S.badge, { padding: "2px 8px" }) },
                    s,
                    h("span", { style: { marginLeft: 6, cursor: "pointer", opacity: 0.55 }, onClick: () => toggleSkill(s) }, "×"),
                  ),
                )
              : h("span", { style: { opacity: 0.5, fontSize: 12 } }, t("none")),
            h("button", { style: S.btn, disabled: busy, onClick: () => setPicking(true) }, t("pickSkills")),
          ),
          h("input", Object.assign(f("skillsText"), { placeholder: t("skillsHint") })),
        ),
        h(
          "div",
          { style: S.row2 },
          h(
            "div",
            { style: Object.assign({}, S.field, { flex: 2 }) },
            h("label", { style: S.label }, t("model")),
            h(
              "select",
              {
                style: Object.assign({}, S.input, { marginBottom: 4 }),
                value: "",
                disabled: busy,
                onChange: (e) => {
                  const v = e.target.value;
                  if (!v) return;
                  const parts = v.split("\u0000");
                  setDraft(Object.assign({}, draft, { provider: parts[0], model: parts[1] }));
                },
              },
              modelOptions,
            ),
            h("input", Object.assign(f("model"), { placeholder: t("modelPh") })),
          ),
          h(
            "div",
            { style: Object.assign({}, S.field, { flex: 1 }) },
            h("label", { style: S.label }, "provider"),
            h("input", Object.assign(f("provider"), { placeholder: t("providerPh") })),
          ),
        ),
        h(
          "div",
          { style: Object.assign({}, S.bar, { marginBottom: 0 }) },
          h("button", { style: S.btnPrimary, disabled: busy, onClick: onSave }, t("save")),
          h("button", { style: S.btn, disabled: busy, onClick: onCancel }, t("cancel")),
        ),
        picking ? h(SkillPicker, { t: t, selected: selected, onToggle: toggleSkill, onClose: () => setPicking(false) }) : null,
      );
    }

    /* ------------------------------ 主面板 ------------------------------ */

    function Panel(props) {
      const t = props.t;
      const [state, setState] = useState(null);
      const [error, setError] = useState(null);
      const [busy, setBusy] = useState(false);
      const [tab, setTab] = useState("org");
      const [draft, setDraft] = useState(null);
      const [groupDraft, setGroupDraft] = useState(null);

      const load = useCallback(async () => {
        try {
          setState(await api("/state"));
          setError(null);
        } catch (e) {
          setError(e && e.message ? e.message : String(e));
        }
      }, []);

      useEffect(() => {
        load();
      }, [load]);

      const run = useCallback(
        async (op, args, after) => {
          setBusy(true);
          setError(null);
          try {
            await post(op, args);
            await load();
            if (after) after();
          } catch (e) {
            setError(e && e.message ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        },
        [load],
      );

      const groups = (state && state.groups) || [];
      const groupRefs = useMemo(() => groups.map((g) => ({ id: g.id, name: g.name })), [groups]);

      function onEdit(m) {
        setDraft({
          target: m.target,
          displayName: m.displayName || "",
          title: m.title || "",
          dutiesText: (m.duties || []).join("\n"),
          skillsText: (m.skills || []).join(", "),
          model: m.model || "",
          provider: m.provider || "",
        });
      }

      async function saveDraft() {
        setBusy(true);
        setError(null);
        try {
          await post("renameMember", { target: draft.target, patch: { displayName: draft.displayName } });
          await post("setRole", { target: draft.target, patch: { title: draft.title || "", duties: splitLines(draft.dutiesText) } });
          await post("setSkills", { target: draft.target, patch: { skills: splitCommas(draft.skillsText) } });
          // 模型覆盖：空串即清除。走 service.setModel，真正影响该成员后续请求
          await post("setModel", { target: draft.target, model: draft.model || "", provider: draft.provider || "" });
          setDraft(null);
          await load();
        } catch (e) {
          setError(e && e.message ? e.message : String(e));
        } finally {
          setBusy(false);
        }
      }

      if (error && !state) {
        return h("div", { style: S.wrap }, h("div", { style: S.err }, t("error") + "：" + error), h("div", { style: S.sub }, t("noApi")));
      }
      if (!state) return h("div", { style: S.wrap }, h("div", { style: S.sub }, "…"));

      const stats = state.stats || {};
      const ungrouped = state.ungrouped || [];
      const allMembers = groups.reduce((acc, g) => acc.concat(g.members), []).concat(ungrouped);
      const retired = allMembers.filter((m) => m.isRetired);
      const unregistered = state.unregistered || [];

      function retire(m) {
        if (typeof confirm === "function" && !confirm(t("confirmRetire", { name: m.displayName || m.target }))) return;
        run("removeMember", { target: m.target });
      }
      function restore(target) {
        run("restoreMember", { target: target });
      }
      function assign(target, groupId) {
        run("assignGroup", { target: target, groupId: groupId });
      }

      const tableProps = {
        groups: groupRefs,
        t: t,
        busy: busy,
        onEdit: onEdit,
        onRetire: retire,
        onRestore: restore,
        onAssign: assign,
        emptyText: t("emptyGroup"),
      };

      return h(
        "div",
        { style: S.wrap },
        h("h3", { style: S.h }, t("title")),
        h("p", { style: S.sub }, t("subtitle")),

        error ? h("div", { style: S.err }, t("error") + "：" + error) : null,
        !state.coreAvailable ? h("div", { style: S.hint }, t("coreUnavailable")) : null,
        state.warnings && state.warnings.length ? h("div", { style: S.hint }, state.warnings.join("；")) : null,

        h(
          "div",
          { style: S.bar },
          h("button", { style: S.btn, disabled: busy, onClick: load }, t("refresh")),
          h("button", { style: S.btnPrimary, disabled: busy, onClick: () => run("registerLive") }, busy ? t("syncing") : t("sync")),
          h("button", { style: S.btn, disabled: busy, onClick: () => setGroupDraft({ name: "", description: "" }) }, t("addGroup")),
          h(
            "span",
            { style: Object.assign({}, S.count, { marginLeft: "auto" }) },
            t("stats", { members: stats.members || 0, active: stats.active || 0, retired: stats.retired || 0, groups: stats.groups || 0 }),
          ),
        ),

        groupDraft
          ? h(
              "div",
              { style: S.form },
              h("div", { style: { fontWeight: 600, marginBottom: 8 } }, t("addGroup")),
              h("div", { style: S.field }, h("label", { style: S.label }, t("groupName")), h("input", { style: S.input, value: groupDraft.name, onChange: (e) => setGroupDraft(Object.assign({}, groupDraft, { name: e.target.value })) })),
              h("div", { style: S.field }, h("label", { style: S.label }, t("groupDesc")), h("input", { style: S.input, value: groupDraft.description, onChange: (e) => setGroupDraft(Object.assign({}, groupDraft, { description: e.target.value })) })),
              h(
                "div",
                { style: Object.assign({}, S.bar, { marginBottom: 0 }) },
                h(
                  "button",
                  {
                    style: S.btnPrimary,
                    disabled: busy || !groupDraft.name.trim(),
                    onClick: () => run("createGroup", { name: groupDraft.name, description: groupDraft.description }, () => setGroupDraft(null)),
                  },
                  t("create"),
                ),
                h("button", { style: S.btn, disabled: busy, onClick: () => setGroupDraft(null) }, t("cancel")),
              ),
            )
          : null,

        draft ? h(EditForm, { draft: draft, setDraft: setDraft, t: t, busy: busy, onSave: saveDraft, onCancel: () => setDraft(null) }) : null,

        h(
          "div",
          { style: S.bar },
          h("button", { style: tab === "org" ? S.btnOn : S.btn, onClick: () => setTab("org") }, t("tabOrg")),
          h("button", { style: tab === "retired" ? S.btnOn : S.btn, onClick: () => setTab("retired") }, t("tabRetired") + (retired.length ? " (" + retired.length + ")" : "")),
          h("button", { style: tab === "unregistered" ? S.btnOn : S.btn, onClick: () => setTab("unregistered") }, t("tabUnregistered") + (unregistered.length ? " (" + unregistered.length + ")" : "")),
        ),

        tab === "org"
          ? groups.length || ungrouped.length
            ? h(
                "div",
                null,
                groups.map((g) =>
                  h(
                    "div",
                    { key: g.id, style: S.card },
                    h(
                      "div",
                      { style: S.cardHead },
                      h("span", { style: S.cardTitle }, g.name),
                      h("span", { style: S.count }, g.members.filter((m) => !m.isRetired).length + " " + t("people")),
                      g.description ? h("span", { style: S.count }, "· " + g.description) : null,
                      h(
                        "span",
                        { style: { marginLeft: "auto" } },
                        h(
                          "button",
                          {
                            style: S.btnDanger,
                            disabled: busy,
                            onClick: () => {
                              if (typeof confirm === "function" && !confirm(t("confirmDeleteGroup", { name: g.name }))) return;
                              run("deleteGroup", { id: g.id, options: {} });
                            },
                          },
                          t("remove"),
                        ),
                      ),
                    ),
                    h(MemberTable, Object.assign({}, tableProps, { members: g.members.filter((m) => !m.isRetired) })),
                  ),
                ),
                ungrouped.filter((m) => !m.isRetired).length
                  ? h(
                      "div",
                      { style: S.card },
                      h("div", { style: S.cardHead }, h("span", { style: S.cardTitle }, t("ungrouped"))),
                      h(MemberTable, Object.assign({}, tableProps, { members: ungrouped.filter((m) => !m.isRetired) })),
                    )
                  : null,
              )
            : h("div", { style: S.card }, t("empty"))
          : null,

        tab === "retired" ? h("div", { style: S.card }, h(MemberTable, Object.assign({}, tableProps, { members: retired }))) : null,

        tab === "unregistered"
          ? h(
              "div",
              { style: S.card },
              h("div", { style: S.cardHead }, h("span", { style: S.count }, t("unregisteredHint"))),
              unregistered.length ? h("div", { style: S.bar }, h("button", { style: S.btnPrimary, disabled: busy, onClick: () => run("registerLive") }, t("registerAll"))) : null,
              unregistered.map((target) =>
                h(
                  "div",
                  { key: target, style: { display: "flex", alignItems: "center", gap: 8, padding: "5px 0" } },
                  h("span", { style: S.mono }, target),
                  h("button", { style: S.btn, disabled: busy, onClick: () => run("addMember", { target: target }) }, t("register")),
                ),
              ),
              unregistered.length === 0 ? h("div", { style: { opacity: 0.5, fontSize: 12 } }, "—") : null,
            )
          : null,
      );
    }

    // 侧边栏入口图标：与插件列表共用同一张三人图标（内联 data URI，随位置缩放）
    const SIDEBAR_ICON = "data:image/png;base64,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";

    function SidebarIcon() {
      return h("img", {
        src: SIDEBAR_ICON,
        alt: "",
        "aria-hidden": "true",
        style: { width: 16, height: 16, display: "block", objectFit: "contain" },
      });
    }

    /* ------------------------------- 注册 ------------------------------- */

    exports.name = NS;
    exports.inject = ["slots", "locale"];

    exports.apply = function apply(ctx) {
      // 记录失败但不抛出：字典、插槽都是可选部分，
      // 任何一处出问题都不应让整个插件加载失败。
      function reportError(what, err) {
        try {
          if (typeof console !== "undefined" && console && typeof console.warn === "function") {
            console.warn("[" + NS + "] " + what + " 失败（该部分不可用）：" + (err && err.message ? err.message : String(err)));
          }
        } catch (e) {
          /* 日志失败也绝不影响插件 */
        }
      }

      let t = function (key) {
        return key;
      };
      try {
        ctx.effect(() => ctx.locale.register(NS, { zh: zh, en: en }), NS + ": dictionaries");
        t = ctx.locale.bind(NS);
      } catch (err) {
        reportError("注册中文字典", err); // 降级：文案退化为 key，面板仍可用
      }
      const label = () => t("title");

      function mountSlot(name, options, Component) {
        try {
          return ctx.slots.inject(name, function () {
            try {
              return ctx.slots.register(Object.assign({ name: name }, options), Component);
            } catch (err) {
              reportError("插槽 " + name + " 注册", err);
              return undefined;
            }
          });
        } catch (err) {
          reportError("插槽 " + name + " 挂载", err);
          return undefined;
        }
      }

      // 设置页分区：最可靠的入口（若它也不可用，插件仍会以「仅工具」形态工作）
      mountSlot("settings.section", { id: NS, order: 32, label: label, locale: NS, inject: () => ({ t: t }) }, Panel);

      // 侧栏入口
      mountSlot("sidebar.panellist", { id: NS, order: 32, label: label, locale: NS }, SidebarIcon);

      // 主区域独立页面（keyed，用 key 而非 id）
      mountSlot("main", { key: NS, locale: NS, inject: () => ({ t: t }) }, Panel);
    };

    // 暴露内部组件以便离线测试（不影响插件运行）
    exports.Panel = Panel;
    exports.__internals = { Panel: Panel, MemberRow: MemberRow, MemberTable: MemberTable, EditForm: EditForm, SkillPicker: SkillPicker };

    return module.exports;
  },
});
