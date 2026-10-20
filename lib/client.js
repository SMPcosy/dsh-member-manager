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

    const { createElement: h, useCallback, useEffect, useMemo, useRef, useState } = require("react");

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
      statMembers: "成员",
      statActive: "启用",
      statRetired: "停用",
      statGroups: "小组",
      actions: "操作",
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
      duties: "岗位职责",
      dutiesHint: "每行一条",
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
      pickModel: "选择模型",
      searchModels: "搜索 provider 或模型 id…",
      noModels: "没有匹配的模型",
      modelTotal: "共 {n} 个模型",
      useDefault: "使用默认（清除覆盖）",
      modelHint: "目录外的 id 仍可在下方直接手填",
      clear: "清除",
      editTitle: "编辑成员",
      basicInfo: "基本信息",
      skillsSection: "技能",
      modelSection: "模型",
      closeHint: "按 Esc 或点击空白处关闭",
      displayNameRequired: "中文显示名不能为空",
      statusActive: "启用中",
      statusRetired: "已停用",
      ocTitle: "组织架构 · 实时工作网",
      ocHeaderBtn: "组织架构",
      ocCollapse: "折叠/展开",
      ocDockLeft: "磁吸到左侧",
      ocDockRight: "磁吸到右侧",
      ocRefresh: "立即刷新",
      ocNoWork: "空闲（没有进行中的任务）",
      ocTotals: "合计",
      ocActive: "活跃",
      ocSample: "采样",
      ocFail: "数据获取失败：",
      ocUngrouped: "未分组",
      tcTaskLabel: "任务",
      tcNoTasks: "暂无任务",
      ocEmptyTask: "还没有可显示的任务：当前没有带成员的会话，或工作流观测未开启。",
      tabWorkflow: "工作流",
      tabMaintain: "备份与更新",
      wfTitle: "工作流实时看板",
      wfSub: "成员状态、当前工作包、token 消耗与用时（旁路采集，不影响会话）。",
      wfLive: "实时",
      wfPaused: "已暂停",
      wfRefreshHint: "每 2 秒自动刷新",
      wfStatus: "状态",
      wfWork: "当前工作包",
      wfTokens: "Token（入 / 出）",
      wfElapsed: "用时",
      wfRequests: "请求",
      wfNoWork: "（空闲）",
      wfNoData: "还没有采集到数据。发起一次对话或让成员执行任务后，这里会自动出现。",
      wfTasks: "任务板",
      wfTaskPending: "待认领",
      wfTaskRunning: "进行中",
      wfTaskDone: "已完成",
      wfTasksUnavailable: "任务板不可用：{msg}",
      wfTotals: "合计",
      wfCacheHit: "缓存命中率",
      wfUpdated: "采样于 {time}",
      wfStatusRunning: "运行中",
      wfStatusIdle: "空闲",
      wfStatusUnknown: "未知",
      brief: "一句话建组",
      briefTitle: "一句话建组",
      briefExampleLabel: "示例",
      briefExample: "把插件组扩成 3 人：插件架构负责机制与架构，插件编写负责实现，插件审阅负责独立复核。",
      briefFill: "填入示例",
      briefPlaceholder: "例：新建「文档组」：文档编写负责正文，文档审阅负责校对，模型都用 flash。",
      briefParse: "解析预览",
      briefPreviewTitle: "将创建",
      briefConfirm: "确认创建",
      briefBack: "返回修改",
      briefDone: "已创建 {n} 名成员",
      briefNone: "（未解析出成员）",
      mtTitle: "备份与自动更新",
      mtSub: "名册每次写入都会自动快照；更新采用「下载 → 暂存 → 下次启动前原子替换」，运行中不替换自己。",
      mtBackupTitle: "名册备份",
      mtBackupNow: "立即备份",
      mtBackupCount: "共 {n} 份备份",
      mtNoBackups: "还没有备份。",
      mtRestore: "恢复",
      mtRestoreConfirm: "用备份 {name} 覆盖当前名册？当前名册会先自动快照一份。",
      mtUpdateTitle: "插件版本",
      mtCurrent: "当前版本",
      mtLatest: "最新版本",
      mtCheck: "检查更新",
      mtStage: "下载并暂存",
      mtApply: "应用更新",
      mtRollback: "回滚上次更新",
      mtPending: "待应用：{v}",
      mtNoPending: "没有待应用的更新",
      mtNoUpdate: "已是最新版",
      mtUnknown: "尚未检查",
      mtApplyHint: "安全约束：不在运行中替换自己。请先退出 DSH，再在终端运行下面命令应用（staged 包不会丢）；junction（link:）安装会被拒绝。",
      mtRestart: "应用后需要重启 DSH 才能生效",
      mtResult: "结果",
      mtDisabled: "自动更新已关闭（update.enabled=false）",
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
      statMembers: "Members",
      statActive: "Active",
      statRetired: "Retired",
      statGroups: "Groups",
      actions: "Actions",
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
      duties: "Duties",
      dutiesHint: "one per line",
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
      pickModel: "Pick model",
      searchModels: "Search provider or model id…",
      noModels: "No matching models",
      modelTotal: "{n} models",
      useDefault: "Use default (clear override)",
      modelHint: "Ids outside the catalog can still be typed below",
      clear: "Clear",
      editTitle: "Edit member",
      basicInfo: "Basics",
      skillsSection: "Skills",
      modelSection: "Model",
      closeHint: "Press Esc or click outside to close",
      displayNameRequired: "Display name is required",
      statusActive: "Active",
      statusRetired: "Retired",
      ocTitle: "Org chart · live network",
      ocHeaderBtn: "Org chart",
      ocCollapse: "Collapse / expand",
      ocDockLeft: "Dock to left",
      ocDockRight: "Dock to right",
      ocRefresh: "Refresh now",
      ocNoWork: "Idle (no active task)",
      ocTotals: "Total",
      ocActive: "Active",
      ocSample: "Sampled",
      ocFail: "Failed to load: ",
      ocUngrouped: "Ungrouped",
      tcTaskLabel: "Task",
      tcNoTasks: "No tasks",
      ocEmptyTask: "Nothing to show yet: no session with members is alive, or workflow observation is off.",
      tabWorkflow: "Workflow",
      tabMaintain: "Backups & updates",
      wfTitle: "Live workflow board",
      wfSub: "Member status, current work package, token usage and elapsed time (side-channel observation, never blocks the session).",
      wfLive: "Live",
      wfPaused: "Paused",
      wfRefreshHint: "Auto refresh every 2s",
      wfStatus: "Status",
      wfWork: "Work package",
      wfTokens: "Tokens (in / out)",
      wfElapsed: "Elapsed",
      wfRequests: "Requests",
      wfNoWork: "(idle)",
      wfNoData: "No data yet. Start a conversation or let a member run a task and it will appear here.",
      wfTasks: "Task board",
      wfTaskPending: "Pending",
      wfTaskRunning: "In progress",
      wfTaskDone: "Completed",
      wfTasksUnavailable: "Task board unavailable: {msg}",
      wfTotals: "Total",
      wfCacheHit: "Cache hit rate",
      wfUpdated: "Sampled at {time}",
      wfStatusRunning: "Running",
      wfStatusIdle: "Idle",
      wfStatusUnknown: "Unknown",
      brief: "Create group from text",
      briefTitle: "Create group from one sentence",
      briefExampleLabel: "Example",
      briefExample: "Turn the plugin group into 3 people: plugin architect owns mechanism and design, plugin builder owns implementation, plugin reviewer owns independent review.",
      briefFill: "Fill example",
      briefPlaceholder: "e.g. Create a 'Docs' group: writer owns docs, reviewer owns proofreading, both use flash.",
      briefParse: "Parse preview",
      briefPreviewTitle: "Will create",
      briefConfirm: "Create",
      briefBack: "Back",
      briefDone: "Created {n} members",
      briefNone: "(no members parsed)",
      mtTitle: "Backups & auto update",
      mtSub: "The roster is snapshotted on every write; updates are downloaded and staged first, then atomically swapped before next boot — a running plugin is never replaced in place.",
      mtBackupTitle: "Roster backups",
      mtBackupNow: "Backup now",
      mtBackupCount: "{n} backups",
      mtNoBackups: "No backups yet.",
      mtRestore: "Restore",
      mtRestoreConfirm: "Overwrite the current roster with backup {name}? The current roster is snapshotted first.",
      mtUpdateTitle: "Plugin version",
      mtCurrent: "Current",
      mtLatest: "Latest",
      mtCheck: "Check for updates",
      mtStage: "Download & stage",
      mtApply: "Apply update",
      mtRollback: "Roll back",
      mtPending: "Pending: {v}",
      mtNoPending: "No pending update",
      mtNoUpdate: "Up to date",
      mtUnknown: "Not checked yet",
      mtApplyHint: "Safety: the plugin never replaces itself while DSH is running. Quit DSH, then run the command below (the staged build is kept); junction (link:) installs are refused.",
      mtRestart: "Restart DSH to activate",
      mtResult: "Result",
      mtDisabled: "Auto update is disabled (update.enabled=false)",
    };

    /* ------------------------------ 样式 ------------------------------ */

    const S = {
      // 面板根容器：既能在「宿主给了固定高度」的插槽（main / settings.section）里
      // 以 100% 高度 + 纵向滚动成为自己的滚动容器，又能在宿主不限制高度时自然长高
      // 交给页面滚动。box-sizing + minWidth/minHeight:0 保证 flex/grid 布局里不被挤压。
      wrap: {
        padding: "20px 22px",
        font: "13px/1.6 system-ui, 'Segoe UI', 'Microsoft YaHei', sans-serif",
        color: "inherit",
        maxWidth: 1040,
        boxSizing: "border-box",
        minWidth: 0,
        minHeight: 0,
        height: "100%",
        overflowY: "auto",
      },
      // 页头：左「标题 + 副标题 + 统计胶囊」，右操作按钮；容器窄时自动换行
      head: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 14 },
      titleBlock: { minWidth: 0 },
      h: { margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: ".01em" },
      sub: { margin: "4px 0 0", opacity: 0.68, fontSize: 12, maxWidth: 620 },
      statsRow: { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 },
      statChip: { display: "inline-flex", alignItems: "baseline", gap: 5, padding: "2px 9px", borderRadius: 999, background: "rgba(127,127,127,.10)", fontSize: 11.5, opacity: 0.85 },
      statNum: { fontWeight: 600, fontSize: 12.5 },
      actions: { display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" },
      bar: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 },
      btn: { padding: "6px 12px", borderRadius: 7, border: "1px solid rgba(127,127,127,.38)", background: "transparent", color: "inherit", cursor: "pointer", fontSize: 12.5 },
      btnPrimary: { padding: "6px 12px", borderRadius: 7, border: "1px solid transparent", background: "#2f6feb", color: "#fff", cursor: "pointer", fontSize: 12.5 },
      // 页签：分段控件外观（浅底容器 + 选中项用 Canvas 色浮起），与操作按钮区分开
      tabs: { display: "inline-flex", gap: 2, padding: 3, borderRadius: 9, background: "rgba(127,127,127,.10)", marginBottom: 14 },
      tab: { padding: "5px 12px", borderRadius: 7, border: "1px solid transparent", background: "transparent", color: "inherit", cursor: "pointer", fontSize: 12.5, opacity: 0.75 },
      tabOn: { padding: "5px 12px", borderRadius: 7, border: "1px solid rgba(127,127,127,.18)", background: "Canvas", color: "CanvasText", cursor: "pointer", fontSize: 12.5, fontWeight: 600, boxShadow: "0 1px 2px rgba(0,0,0,.10)", opacity: 1 },
      tabCount: { marginLeft: 5, opacity: 0.55, fontWeight: 400 },
      // 小组卡片：表头做成有底色的条，表格贴边（卡片不再有内边距）
      card: { border: "1px solid rgba(127,127,127,.22)", borderRadius: 10, marginBottom: 14, overflow: "hidden", background: "transparent" },
      cardHead: { display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderBottom: "1px solid rgba(127,127,127,.14)", background: "rgba(127,127,127,.045)" },
      cardTitle: { fontWeight: 600, fontSize: 13.5 },
      cardDesc: { fontSize: 12, opacity: 0.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320 },
      countPill: { padding: "1px 8px", borderRadius: 999, background: "rgba(127,127,127,.14)", fontSize: 11.5 },
      table: { width: "100%", borderCollapse: "collapse", tableLayout: "fixed" },
      // 固定列宽，避免内容长短把列挤得忽宽忽窄；操作列要放得下并排的「编辑 / 停用」
      colName: { width: "28%" },
      colRole: { width: "25%" },
      colSkills: { width: "20%" },
      colGroup: { width: "13%" },
      colActions: { width: "14%" },
      th: { textAlign: "left", padding: "7px 14px", borderBottom: "1px solid rgba(127,127,127,.16)", fontSize: 11.5, opacity: 0.6, fontWeight: 500, background: "rgba(127,127,127,.02)" },
      td: { padding: "10px 14px", borderBottom: "1px solid rgba(127,127,127,.08)", verticalAlign: "top" },
      mono: { fontFamily: "ui-monospace, Consolas, monospace", fontSize: 11.5, opacity: 0.65 },
      badge: { display: "inline-block", padding: "1px 7px", margin: "0 4px 3px 0", borderRadius: 10, background: "rgba(127,127,127,.16)", fontSize: 11 },
      // 模型徽标可能很长（provider/model），单行省略，避免把名称列撑成两行
      modelTag: {
        display: "inline-block",
        maxWidth: "100%",
        padding: "1px 7px",
        borderRadius: 10,
        background: "rgba(127,127,127,.16)",
        fontSize: 11,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        verticalAlign: "bottom",
        boxSizing: "border-box",
      },
      warnBadge: { display: "inline-block", padding: "1px 7px", margin: "0 4px 3px 0", borderRadius: 10, background: "rgba(210,150,30,.18)", fontSize: 11 },
      retired: { opacity: 0.55 },
      rowActions: { display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "nowrap" },
      btnSm: { padding: "3px 9px", borderRadius: 6, border: "1px solid rgba(127,127,127,.35)", background: "transparent", color: "inherit", cursor: "pointer", fontSize: 11.5, whiteSpace: "nowrap" },
      btnSmDanger: { padding: "3px 9px", borderRadius: 6, border: "1px solid rgba(200,60,60,.42)", background: "transparent", color: "#c33", cursor: "pointer", fontSize: 11.5, whiteSpace: "nowrap" },
      btnGhostDanger: { padding: "3px 8px", borderRadius: 6, border: "1px solid transparent", background: "transparent", color: "#c33", cursor: "pointer", fontSize: 11.5, opacity: 0.8 },
      selectSm: { width: "100%", boxSizing: "border-box", padding: "4px 7px", borderRadius: 6, border: "1px solid rgba(127,127,127,.35)", background: "transparent", color: "inherit", font: "inherit", fontSize: 12 },
      emptyBox: { padding: "22px 14px", textAlign: "center", opacity: 0.5, fontSize: 12 },
      err: { padding: "8px 10px", borderRadius: 6, background: "rgba(200,60,60,.12)", color: "#c33", marginBottom: 10, fontSize: 12 },
      hint: { padding: "8px 10px", borderRadius: 6, background: "rgba(210,150,30,.12)", marginBottom: 10, fontSize: 12 },
      form: { border: "1px solid rgba(127,127,127,.3)", borderRadius: 8, padding: 12, marginBottom: 12, background: "rgba(127,127,127,.05)" },
      // 编辑弹窗：position:fixed 相对视口定位，长页面滚到哪儿都能就地弹出，
      // 不再把表单插在页面顶部、逼用户滚回去找。
      modal: {
        position: "fixed",
        inset: 0,
        zIndex: 2147483000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(0,0,0,.45)",
      },
      // 面板底色用系统色 Canvas/CanvasText，随浅色/深色主题自动适配
      modalPanel: {
        width: "min(900px, 100%)",
        maxHeight: "90vh",
        overflow: "auto",
        boxSizing: "border-box",
        padding: 18,
        borderRadius: 12,
        background: "Canvas",
        color: "CanvasText",
        border: "1px solid rgba(127,127,127,.35)",
        boxShadow: "0 18px 50px rgba(0,0,0,.45)",
      },
      field: { marginBottom: 8 },
      label: { display: "block", fontSize: 11.5, opacity: 0.7, marginBottom: 3 },
      input: { width: "100%", boxSizing: "border-box", padding: "5px 8px", borderRadius: 6, border: "1px solid rgba(127,127,127,.4)", background: "transparent", color: "inherit", font: "inherit", fontSize: 12.5 },
      ta: { width: "100%", boxSizing: "border-box", minHeight: 56, padding: "5px 8px", borderRadius: 6, border: "1px solid rgba(127,127,127,.4)", background: "transparent", color: "inherit", font: "inherit", fontSize: 12.5 },
      // 弹窗专用的大号控件：面板放大到 900px/90vh 后，字段与文字同步放大，
      // 避免「面板变大、内容还是小字」的失衡。仅在弹窗（plain）下启用，
      // 页面里的内嵌表单（如新建分组）保持原尺寸。
      titleLg: { fontWeight: 600, fontSize: 18, letterSpacing: ".01em", margin: 0 },
      fieldLg: { marginBottom: 0 },
      labelLg: { display: "block", fontSize: 12.5, opacity: 0.72, marginBottom: 5 },
      inputLg: { width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 7, border: "1px solid rgba(127,127,127,.4)", background: "transparent", color: "inherit", font: "inherit", fontSize: 14 },
      // 职责文本域压到 88px：默认能看到 3~4 行，仍可手动拉高，整张表单因此能塞进一屏
      taLg: { width: "100%", boxSizing: "border-box", minHeight: 88, padding: "8px 10px", borderRadius: 7, border: "1px solid rgba(127,127,127,.4)", background: "transparent", color: "inherit", font: "inherit", fontSize: 14, lineHeight: 1.55, resize: "vertical" },
      btnLg: { padding: "8px 16px", borderRadius: 7, border: "1px solid rgba(127,127,127,.4)", background: "transparent", color: "inherit", cursor: "pointer", fontSize: 13.5 },
      btnPrimaryLg: { padding: "8px 16px", borderRadius: 7, border: "1px solid transparent", background: "#2f6feb", color: "#fff", cursor: "pointer", fontSize: 13.5 },
      // 弹窗的版式：标题区 → 分组（细线上边 + 左侧强调条）→ 两列网格对齐 → 底部操作栏
      headLg: { marginBottom: 12 },
      subLg: { marginTop: 4, display: "flex", alignItems: "center", gap: 8, fontSize: 12, opacity: 0.65 },
      monoLg: { fontFamily: "ui-monospace, Consolas, monospace", fontSize: 12 },
      sectionLg: { marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(127,127,127,.16)" },
      sectionHeadLg: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 12.5, fontWeight: 600, letterSpacing: ".02em", opacity: 0.85 },
      accentLg: { width: 3, height: 12, borderRadius: 2, background: "#2f6feb", flex: "0 0 auto" },
      gridLg: { display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 16, rowGap: 10, alignItems: "start" },
      // 技能 / 模型并排成两列，省掉一整段纵向高度（一屏内显示的关键）
      duoLg: { display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 20, alignItems: "start" },
      // 分组标题旁的「选择…」高亮小按钮：蓝底淡色 + 蓝字，不与底部主按钮抢视觉
      pickLg: { padding: "2px 10px", borderRadius: 999, border: "1px solid rgba(47,111,235,.55)", background: "rgba(47,111,235,.12)", color: "#2f6feb", cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" },
      modelLineLg: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8, minHeight: 20 },
      modelValueLg: { fontFamily: "ui-monospace, Consolas, monospace", fontSize: 12, opacity: 0.8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
      clearLinkLg: { fontSize: 11.5, opacity: 0.6, cursor: "pointer", textDecoration: "underline", flex: "0 0 auto" },
      stackLg: { marginBottom: 10 },
      chipsLg: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 6 },
      footerLg: { display: "flex", alignItems: "center", gap: 10, marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(127,127,127,.16)" },
      hintLg: { fontSize: 12, opacity: 0.5, marginRight: "auto" },
      badgeLg: { display: "inline-block", padding: "2px 9px", borderRadius: 10, background: "rgba(127,127,127,.16)", fontSize: 12 },
      statusLg: { display: "inline-block", padding: "1px 8px", borderRadius: 10, fontSize: 11.5, background: "rgba(47,111,235,.14)", color: "inherit" },
      // 技能 / 模型选择弹层（两个弹层共用一套外观，跟随主题色）
      pickerBox: {
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.38)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      },
      pickerCard: {
        width: 580,
        maxWidth: "92vw",
        maxHeight: "80vh",
        background: "Canvas",
        color: "CanvasText",
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxShadow: "0 12px 40px rgba(0,0,0,.3)",
        border: "1px solid rgba(127,127,127,.3)",
      },
      pickerHead: { padding: "12px 14px", borderBottom: "1px solid rgba(127,127,127,.2)" },
      pickerTitle: { fontWeight: 600, marginBottom: 8, fontSize: 13.5 },
      pickerSearch: { width: "100%", boxSizing: "border-box", padding: "6px 9px", borderRadius: 6, border: "1px solid rgba(127,127,127,.4)", background: "transparent", color: "inherit", font: "inherit", fontSize: 13 },
      pickerList: { overflowY: "auto", flex: 1, padding: "6px 0" },
      pickerFoot: { padding: "10px 14px", borderTop: "1px solid rgba(127,127,127,.2)", display: "flex", gap: 8, alignItems: "center" },
      pickerMeta: { fontSize: 12, opacity: 0.6 },
      pickerGroup: { padding: "6px 14px 2px", fontSize: 11, opacity: 0.55, letterSpacing: ".02em" },
      pickerEmpty: { padding: 14, opacity: 0.6, fontSize: 12 },
      pickerRow: (on) => ({ display: "flex", gap: 9, alignItems: "flex-start", padding: "7px 14px", cursor: "pointer", background: on ? "rgba(47,111,235,.10)" : "transparent" }),
      pickerRowTitle: { fontSize: 13, fontWeight: 500 },
      pickerRowMeta: { fontSize: 11.5, opacity: 0.6, marginTop: 2 },
    };

    // 弹窗与内嵌表单共用同一份 EditForm：按 plain 选尺寸，避免复制两份表单逻辑。
    const FORM_SM = {
      editTitle: { fontWeight: 600, fontSize: 13, margin: 0 },
      head: { marginBottom: 10 },
      sub: { marginTop: 2, display: "flex", alignItems: "center", gap: 6, fontSize: 11, opacity: 0.65 },
      mono: { fontFamily: "ui-monospace, Consolas, monospace", fontSize: 11 },
      section: { marginTop: 12, paddingTop: 10, borderTop: "1px solid rgba(127,127,127,.16)" },
      sectionHead: { display: "flex", alignItems: "center", gap: 6, marginBottom: 8, fontSize: 11.5, fontWeight: 600, letterSpacing: ".02em", opacity: 0.8 },
      accent: { width: 3, height: 11, borderRadius: 2, background: "#2f6feb", flex: "0 0 auto" },
      grid: { display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 10, rowGap: 8, alignItems: "start" },
      field: S.field,
      label: S.label,
      input: S.input,
      ta: S.ta,
      btn: S.btn,
      btnPrimary: S.btnPrimary,
      stack: { marginBottom: 8 },
      chips: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 6 },
      footer: Object.assign({}, S.bar, { marginTop: 12, paddingTop: 10, borderTop: "1px solid rgba(127,127,127,.16)" }),
      hint: { fontSize: 11, opacity: 0.5, marginRight: "auto" },
      aside: { marginLeft: 6, fontWeight: 400, opacity: 0.6, fontSize: 11 },
      duo: { display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 12, alignItems: "start" },
      pick: { padding: "1px 8px", borderRadius: 999, border: "1px solid rgba(47,111,235,.5)", background: "rgba(47,111,235,.12)", color: "#2f6feb", cursor: "pointer", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" },
      modelLine: { display: "flex", alignItems: "center", gap: 6, marginBottom: 6, minHeight: 18 },
      modelValue: { fontFamily: "ui-monospace, Consolas, monospace", fontSize: 11, opacity: 0.8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
      clearLink: { fontSize: 11, opacity: 0.6, cursor: "pointer", textDecoration: "underline", flex: "0 0 auto" },
      badge: S.badge,
      status: { display: "inline-block", padding: "0 6px", borderRadius: 10, fontSize: 10.5, background: "rgba(47,111,235,.14)" },
    };
    const FORM_LG = {
      editTitle: S.titleLg,
      head: S.headLg,
      sub: S.subLg,
      mono: S.monoLg,
      section: S.sectionLg,
      sectionHead: S.sectionHeadLg,
      accent: S.accentLg,
      grid: S.gridLg,
      field: S.fieldLg,
      label: S.labelLg,
      input: S.inputLg,
      ta: S.taLg,
      btn: S.btnLg,
      btnPrimary: S.btnPrimaryLg,
      stack: S.stackLg,
      chips: S.chipsLg,
      footer: S.footerLg,
      hint: S.hintLg,
      aside: { marginLeft: 8, fontWeight: 400, opacity: 0.6, fontSize: 12 },
      duo: S.duoLg,
      pick: S.pickLg,
      modelLine: S.modelLineLg,
      modelValue: S.modelValueLg,
      clearLink: S.clearLinkLg,
      badge: S.badgeLg,
      status: S.statusLg,
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
      const { m, groups, t, busy, onEdit, onRetire, onRestore, onAssign, last } = props;
      const options = [{ id: "", name: "" }].concat(groups);
      // 最后一行去掉底边：卡片自身有边框，避免出现双线
      const tdStyle = last ? Object.assign({}, S.td, { borderBottom: "none" }) : S.td;
      return h(
        "tr",
        { style: m.isRetired ? S.retired : undefined },
        // 名称列：中文名 / target / 模型覆盖 / 「当前会话未列出」标记
        h(
          "td",
          { style: tdStyle },
          h("div", { style: { fontWeight: 600 } }, m.displayName || m.target),
          h("div", { style: S.mono }, m.target),
          m.model
            ? h(
                "div",
                { style: { marginTop: 4 } },
                // 徽标只放 model（provider 较长，放 tooltip 里），保证名称列不折行
                h("span", { style: S.modelTag, title: m.provider ? m.provider + " / " + m.model : m.model }, "模型: " + m.model),
              )
            : null,
          m.orphan ? h("div", { style: { marginTop: 4 } }, h("span", { style: S.warnBadge }, t("currentSessionMissing"))) : null,
        ),
        // 岗位列：岗位名 + 职责条目（不带项目符号的原生列表，逐行收起）
        h(
          "td",
          { style: tdStyle },
          m.title ? h("div", null, m.title) : h("span", { style: { opacity: 0.4 } }, "—"),
          m.duties && m.duties.length
            ? h(
                "ul",
                { style: { margin: "4px 0 0", padding: 0, listStyle: "none", opacity: 0.75 } },
                m.duties.map((d, i) => h("li", { key: i, style: { lineHeight: 1.55 } }, "· " + d)),
              )
            : null,
        ),
        h(
          "td",
          { style: tdStyle },
          m.skills && m.skills.length ? m.skills.map((s) => h("span", { key: s, style: S.badge }, s)) : h("span", { style: { opacity: 0.4 } }, "—"),
        ),
        // 分组：表格内用轻量下拉，宽度吃满列宽，不再固定 130px
        h(
          "td",
          { style: tdStyle },
          h(
            "select",
            { style: S.selectSm, value: m.groupId || "", disabled: busy, onChange: (e) => onAssign(m.target, e.target.value || null) },
            options.map((g) => h("option", { key: g.id || "_none", value: g.id }, g.name || t("none"))),
          ),
        ),
        // 操作列：右对齐的小号按钮，编辑在前、启停在后
        h(
          "td",
          { style: tdStyle },
          h(
            "div",
            { style: S.rowActions },
            h("button", { style: S.btnSm, disabled: busy, onClick: () => onEdit(m) }, t("edit")),
            m.isRetired
              ? h("button", { style: S.btnSm, disabled: busy, onClick: () => onRestore(m.target) }, t("restore"))
              : h("button", { style: S.btnSmDanger, disabled: busy, onClick: () => onRetire(m) }, t("retire")),
          ),
        ),
      );
    }

    function MemberTable(props) {
      const { members, groups, t, busy, onEdit, onRetire, onRestore, onAssign, emptyText } = props;
      if (!members.length) {
        return h("div", { style: S.emptyBox }, emptyText);
      }
      return h(
        "table",
        { style: S.table },
        // 固定列宽：名册/岗位/技能/分组/操作
        h(
          "colgroup",
          null,
          h("col", { style: S.colName }),
          h("col", { style: S.colRole }),
          h("col", { style: S.colSkills }),
          h("col", { style: S.colGroup }),
          h("col", { style: S.colActions }),
        ),
        h(
          "thead",
          null,
          h(
            "tr",
            null,
            h("th", { style: S.th }, "显示名 / target"),
            h("th", { style: S.th }, t("role")),
            h("th", { style: S.th }, t("skillsSection")),
            h("th", { style: S.th }, t("group")),
            h("th", { style: Object.assign({}, S.th, { textAlign: "right" }) }, t("actions")),
          ),
        ),
        h(
          "tbody",
          null,
          members.map((m, i) =>
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
              last: i === members.length - 1,
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

      return h(
        "div",
        { style: S.pickerBox, onClick: props.onClose },
        h(
          "div",
          { style: S.pickerCard, onClick: (e) => e.stopPropagation() },
          h(
            "div",
            { style: S.pickerHead },
            h("div", { style: S.pickerTitle }, t("pickSkills") + (selected.length ? "（" + selected.length + "）" : "")),
            h("input", {
              style: S.pickerSearch,
              placeholder: t("searchSkills"),
              value: search,
              autoFocus: true,
              onChange: (e) => setSearch(e.target.value),
            }),
          ),
          h(
            "div",
            { style: S.pickerList },
            error
              ? h("div", { style: Object.assign({}, S.pickerEmpty, { color: "#c33" }) }, error)
              : catalog === null
                ? h("div", { style: S.pickerEmpty }, "…")
                : filtered.length === 0
                  ? h("div", { style: S.pickerEmpty }, t("noSkills"))
                  : filtered.map((s) => {
                      const on = selected.indexOf(s.name) >= 0;
                      return h(
                        "label",
                        { key: s.name, style: S.pickerRow(on) },
                        h("input", { type: "checkbox", checked: on, onChange: () => props.onToggle(s.name), style: { marginTop: 3 } }),
                        h(
                          "div",
                          { style: { flex: 1 } },
                          h(
                            "div",
                            { style: S.pickerRowTitle },
                            s.name,
                            s.source ? h("span", { style: { marginLeft: 6, fontWeight: 400, fontSize: 11, opacity: 0.6 } }, "· " + s.source) : null,
                          ),
                          s.description ? h("div", { style: Object.assign({}, S.pickerRowMeta, { lineHeight: 1.5 }) }, s.description) : null,
                        ),
                      );
                    }),
          ),
          h(
            "div",
            { style: S.pickerFoot },
            h("span", { style: S.pickerMeta }, all.length ? t("skillTotal").replace("{n}", String(all.length)) : ""),
            h("span", { style: { marginLeft: "auto" } }),
            h("button", { style: S.btnPrimary, onClick: props.onClose }, t("done")),
          ),
        ),
      );
    }

    /* --------- 可搜索模型选择弹层（与技能弹层同一套外观）--------- */

    function ModelPicker(props) {
      const { t, providers, current, busy, onPick, onClear, onClose } = props;
      const [search, setSearch] = useState("");
      const q = String(search || "").trim().toLowerCase();
      const curProvider = (current && current.provider) || "";
      const curModel = (current && current.model) || "";
      const groups = [];
      let total = 0;
      for (const p of providers || []) {
        const models = (p.models || []).filter((m) => {
          if (!q) return true;
          return (
            String(m.id).toLowerCase().indexOf(q) >= 0 ||
            String(m.name || "").toLowerCase().indexOf(q) >= 0 ||
            String(p.id).toLowerCase().indexOf(q) >= 0
          );
        });
        total += (p.models || []).length;
        if (models.length) groups.push({ id: p.id, displayName: p.displayName, models: models });
      }
      const modelRow = (p, m) => {
        const on = curProvider === p.id && curModel === m.id;
        return h(
          "label",
          { key: p.id + "/" + m.id, style: S.pickerRow(on) },
          h("input", { type: "radio", name: "mm-model", checked: on, disabled: busy, onChange: () => onPick(p.id, m.id), style: { marginTop: 3 } }),
          h(
            "div",
            { style: { flex: 1, minWidth: 0 } },
            h("div", { style: Object.assign({}, S.pickerRowTitle, on ? { fontWeight: 600 } : null) }, m.name || m.id),
            h(
              "div",
              { style: S.pickerRowMeta },
              p.id + " · " + m.id + (m.contextWindow ? " · " + Math.round(m.contextWindow / 1000) + "k" : ""),
            ),
          ),
        );
      };
      // 「使用默认」始终在第一项：目录拉空 / 拉失败时也能清除覆盖
      const defaultRow = h(
        "label",
        { key: "__default", style: S.pickerRow(!curModel) },
        h("input", { type: "radio", name: "mm-model", checked: !curModel, disabled: busy, onChange: onClear, style: { marginTop: 3 } }),
        h(
          "div",
          { style: { flex: 1, minWidth: 0 } },
          h("div", { style: S.pickerRowTitle }, t("useDefault")),
          h("div", { style: S.pickerRowMeta }, t("modelHint")),
        ),
      );

      return h(
        "div",
        { style: S.pickerBox, onClick: onClose },
        h(
          "div",
          { style: S.pickerCard, onClick: (e) => e.stopPropagation() },
          h(
            "div",
            { style: S.pickerHead },
            h("div", { style: S.pickerTitle }, t("pickModel")),
            h("input", {
              style: S.pickerSearch,
              placeholder: t("searchModels"),
              value: search,
              autoFocus: true,
              onChange: (e) => setSearch(e.target.value),
            }),
          ),
          h(
            "div",
            { style: S.pickerList },
            providers === null || providers === undefined
              ? h("div", { style: S.pickerEmpty }, "…")
              : [defaultRow].concat(
                  groups.length === 0
                    ? [h("div", { key: "__empty", style: S.pickerEmpty }, t("noModels"))]
                    : groups.map((g) =>
                        h(
                          "div",
                          { key: "__p_" + g.id },
                          h("div", { style: S.pickerGroup }, g.displayName ? g.displayName + " · " + g.id : g.id),
                          g.models.map((m) => modelRow({ id: g.id, displayName: g.displayName }, m)),
                        ),
                      ),
                ),
          ),
          h(
            "div",
            { style: S.pickerFoot },
            h("span", { style: S.pickerMeta }, total ? t("modelTotal").replace("{n}", String(total)) : ""),
            h("span", { style: { marginLeft: "auto" } }),
            h("button", { style: S.btnPrimary, onClick: onClose }, t("done")),
          ),
        ),
      );
    }

    function EditForm(props) {
      const { draft, setDraft, t, busy, onSave, onCancel, plain } = props;
      // 弹窗（plain）用放大版控件，内嵌表单保持原尺寸
      const U = plain ? FORM_LG : FORM_SM;
      const [picking, setPicking] = useState(false);
      const [pickingModel, setPickingModel] = useState(false);
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
      // Esc：先关子弹层、再关弹窗（否则弹层开着时按 Esc 会把整张表单一起关掉，
      // 用户刚选的模型没保存就丢了）。只在挂载期监听，卸载即摘除。
      // 测试环境没有 DOM 全局（window 可能不存在），因此必须守卫，
      // 否则 EditForm 在无浏览器环境渲染时会直接抛错。
      useEffect(() => {
        if (typeof window === "undefined" || typeof window.addEventListener !== "function") return undefined;
        if (typeof onCancel !== "function") return undefined;
        function onKey(e) {
          if (e.key !== "Escape") return;
          if (picking) {
            setPicking(false);
            return;
          }
          if (pickingModel) {
            setPickingModel(false);
            return;
          }
          onCancel();
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
      }, [onCancel, picking, pickingModel]);
      function f(key) {
        return {
          style: U.input,
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
      // 下拉每项编码成 "provider\u0000model"（模型选择已改弹层，这里保留注释给旧数据/手填逻辑）
      // 分组标题：左侧强调条 + 组名；按钮紧贴组名右侧（不再推到最右端）
      function sectionHead(title, action) {
        return h(
          "div",
          { style: U.sectionHead },
          h("span", { style: U.accent, "aria-hidden": "true" }),
          h("span", null, title),
          action ? h("span", { style: { marginLeft: 6 } }, action) : null,
        );
      }
      const statusBadge =
        draft.isRetired === undefined || draft.isRetired === null
          ? null
          : h("span", { style: U.status }, t(draft.isRetired ? "statusRetired" : "statusActive"));
      // 中文显示名是必填项（宿主 requireText 拒空），提前禁用保存，别让用户点完才看到 EMPTY_FIELD
      const canSave = !busy && String(draft.displayName || "").trim().length > 0;

      return h(
        "div",
        { style: plain ? Object.assign({}, S.form, { border: "none", background: "transparent", padding: 0, marginBottom: 0 }) : S.form },
        // 标题区：成员标识 + 启用状态放在副标题，正文里不再重复 target
        h(
          "div",
          { style: U.head },
          h("h2", { style: U.editTitle }, t("editTitle")),
          h("div", { style: U.sub }, h("span", { style: U.mono }, draft.target), statusBadge),
        ),
        // 基本信息：两列网格，左右控件严格对齐
        h(
          "div",
          { style: U.section },
          sectionHead(t("basicInfo")),
          h(
            "div",
            { style: U.grid },
            h("div", null, h("label", { style: U.label }, t("displayName")), h("input", f("displayName"))),
            h("div", null, h("label", { style: U.label }, t("role")), h("input", f("title"))),
          ),
        ),
        // 岗位职责：整行文本域
        h(
          "div",
          { style: U.section },
          sectionHead(h("span", null, t("duties"), h("span", { style: U.aside }, t("dutiesHint")))),
          h("textarea", Object.assign(f("dutiesText"), { style: U.ta })),
        ),
        // 技能 / 模型并排成两列：各占一半宽度，按钮紧贴分组标题，整张表单可在一屏内放下
        h(
          "div",
          { style: U.section },
          h(
            "div",
            { style: U.duo },
            // 技能列
            h(
              "div",
              null,
              sectionHead(t("skillsSection"), h("button", { style: U.pick, disabled: busy, onClick: () => setPicking(true) }, t("pickSkills"))),
              h(
                "div",
                { style: U.chips },
                selected.length
                  ? selected.map((s) =>
                      h(
                        "span",
                        { key: s, style: U.badge },
                        s,
                        h("span", { style: { marginLeft: 6, cursor: "pointer", opacity: 0.55 }, onClick: () => toggleSkill(s) }, "×"),
                      ),
                    )
                  : h("span", { style: { opacity: 0.5, fontSize: plain ? 13 : 12 } }, t("none")),
              ),
              h("input", Object.assign(f("skillsText"), { placeholder: t("skillsHint") })),
            ),
            // 模型列：弹层选择（与技能同一套交互）+ 当前值 + 手填 provider/model
            h(
              "div",
              null,
              sectionHead(t("modelSection"), h("button", { style: U.pick, disabled: busy, onClick: () => setPickingModel(true) }, t("pickModel"))),
              h(
                "div",
                { style: U.modelLine },
                h(
                  "span",
                  { style: U.modelValue, title: draft.model ? (draft.provider ? draft.provider + " / " : "") + draft.model : "" },
                  draft.model ? (draft.provider ? draft.provider + " · " : "") + draft.model : t("none"),
                ),
                draft.model
                  ? h(
                      "span",
                      {
                        style: U.clearLink,
                        onClick: () => {
                          if (busy) return;
                          setDraft(Object.assign({}, draft, { model: "", provider: "" }));
                        },
                      },
                      t("clear"),
                    )
                  : null,
              ),
              h(
                "div",
                { style: U.grid },
                h("div", null, h("label", { style: U.label }, t("model")), h("input", Object.assign(f("model"), { placeholder: t("modelPh") }))),
                h("div", null, h("label", { style: U.label }, "provider"), h("input", Object.assign(f("provider"), { placeholder: t("providerPh") }))),
              ),
            ),
          ),
        ),
        // 底部操作栏：左侧关闭提示，右侧「取消 / 保存」，主操作靠最右
        h(
          "div",
          { style: U.footer },
          h("span", { style: U.hint }, t("closeHint")),
          h("button", { style: U.btn, disabled: busy, onClick: onCancel }, t("cancel")),
          h("button", { style: U.btnPrimary, disabled: !canSave, title: canSave ? "" : t("displayNameRequired"), onClick: onSave }, t("save")),
        ),
        picking ? h(SkillPicker, { t: t, selected: selected, onToggle: toggleSkill, onClose: () => setPicking(false) }) : null,
        pickingModel
          ? h(ModelPicker, {
              t: t,
              providers: models,
              current: { provider: draft.provider || "", model: draft.model || "" },
              busy: busy,
              onPick: (provider, model) => setDraft(Object.assign({}, draft, { provider: provider, model: model })),
              onClear: () => setDraft(Object.assign({}, draft, { provider: "", model: "" })),
              onClose: () => setPickingModel(false),
            })
          : null,
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
      const [briefOpen, setBriefOpen] = useState(false);

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
          // 仅供弹窗副标题显示「启用中/已停用」，不参与保存
          isRetired: !!m.isRetired,
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
          // 保存是 4 个 op 顺序执行，可能「前几条已落盘、后一条失败」。立刻回读一次，
          // 让面板显示名册的真实状态，避免用户误以为整次保存都没生效。
          try {
            await load();
          } catch {
            /* 回读失败就保留原错误 */
          }
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

      const tabBtn = (key, label, count) =>
        h(
          "button",
          { style: tab === key ? S.tabOn : S.tab, onClick: () => setTab(key) },
          label,
          count ? h("span", { style: S.tabCount }, count) : null,
        );
      const statChip = (label, value) => h("span", { style: S.statChip }, label, h("span", { style: S.statNum }, String(value)));

      return h(
        "div",
        { style: S.wrap },
        // 页头：左边标题 / 副标题 / 统计胶囊，右边操作按钮
        h(
          "div",
          { style: S.head },
          h(
            "div",
            { style: S.titleBlock },
            h("h3", { style: S.h }, t("title")),
            h("p", { style: S.sub }, t("subtitle")),
            // 统计拆成四个胶囊便于扫读；完整汇总放 title 里做悬停提示
            h(
              "div",
              {
                style: S.statsRow,
                title: t("stats", { members: stats.members || 0, active: stats.active || 0, retired: stats.retired || 0, groups: stats.groups || 0 }),
              },
              statChip(t("statMembers"), stats.members || 0),
              statChip(t("statActive"), stats.active || 0),
              statChip(t("statRetired"), stats.retired || 0),
              statChip(t("statGroups"), stats.groups || 0),
            ),
          ),
          h(
            "div",
            { style: S.actions },
            h("button", { style: S.btn, disabled: busy, onClick: load }, t("refresh")),
            h("button", { style: S.btn, disabled: busy, onClick: () => setBriefOpen(true) }, t("brief")),
            h("button", { style: S.btn, disabled: busy, onClick: () => setGroupDraft({ name: "", description: "" }) }, t("addGroup")),
            h("button", { style: S.btnPrimary, disabled: busy, onClick: () => run("registerLive") }, busy ? t("syncing") : t("sync")),
          ),
        ),

        error ? h("div", { style: S.err }, t("error") + "：" + error) : null,
        !state.coreAvailable ? h("div", { style: S.hint }, t("coreUnavailable")) : null,
        state.warnings && state.warnings.length ? h("div", { style: S.hint }, state.warnings.join("；")) : null,

        // 新建小组：两列并排，按钮右对齐
        groupDraft
          ? h(
              "div",
              { style: S.form },
              h("div", { style: { fontWeight: 600, marginBottom: 10 } }, t("addGroup")),
              h(
                "div",
                { style: { display: "flex", gap: 12, flexWrap: "wrap" } },
                h(
                  "div",
                  { style: Object.assign({}, S.field, { flex: 1, minWidth: 200 }) },
                  h("label", { style: S.label }, t("groupName")),
                  h("input", { style: S.input, value: groupDraft.name, onChange: (e) => setGroupDraft(Object.assign({}, groupDraft, { name: e.target.value })) }),
                ),
                h(
                  "div",
                  { style: Object.assign({}, S.field, { flex: 1, minWidth: 200 }) },
                  h("label", { style: S.label }, t("groupDesc")),
                  h("input", { style: S.input, value: groupDraft.description, onChange: (e) => setGroupDraft(Object.assign({}, groupDraft, { description: e.target.value })) }),
                ),
              ),
              h(
                "div",
                { style: { display: "flex", gap: 8, justifyContent: "flex-end" } },
                h("button", { style: S.btn, disabled: busy, onClick: () => setGroupDraft(null) }, t("cancel")),
                h(
                  "button",
                  {
                    style: S.btnPrimary,
                    disabled: busy || !groupDraft.name.trim(),
                    onClick: () => run("createGroup", { name: groupDraft.name, description: groupDraft.description }, () => setGroupDraft(null)),
                  },
                  t("create"),
                ),
              ),
            )
          : null,

        // 编辑弹窗：固定在视口中央，点遮罩或按 Esc 关闭。
        // 之前表单内嵌在页面顶部，长列表时点下方成员的「编辑」要滚回顶部才看得见。
        draft
          ? h(
              "div",
              {
                style: S.modal,
                onClick: (e) => {
                  // 保存进行中不响应遮罩点击：请求还在飞时把表单关掉，用户会以为没保存
                  if (busy) return;
                  if (e.target === e.currentTarget) setDraft(null);
                },
              },
              h(
                "div",
                { style: S.modalPanel },
                h(EditForm, { draft: draft, setDraft: setDraft, t: t, busy: busy, onSave: saveDraft, onCancel: () => setDraft(null), plain: true }),
              ),
            )
          : null,

        // 页签：分段控件，放在内容正上方
        h(
          "div",
          { style: S.tabs },
          tabBtn("org", t("tabOrg"), ""),
          tabBtn("retired", t("tabRetired"), retired.length ? String(retired.length) : ""),
          tabBtn("unregistered", t("tabUnregistered"), unregistered.length ? String(unregistered.length) : ""),
          tabBtn("workflow", t("tabWorkflow"), ""),
          tabBtn("maintain", t("tabMaintain"), ""),
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
                      h("span", { style: S.countPill }, g.members.filter((m) => !m.isRetired).length + " " + t("people")),
                      g.description ? h("span", { style: S.cardDesc }, g.description) : null,
                      h(
                        "span",
                        { style: { marginLeft: "auto" } },
                        h(
                          "button",
                          {
                            style: S.btnGhostDanger,
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
                      h(
                        "div",
                        { style: S.cardHead },
                        h("span", { style: S.cardTitle }, t("ungrouped")),
                        h("span", { style: S.countPill }, ungrouped.filter((m) => !m.isRetired).length + " " + t("people")),
                      ),
                      h(MemberTable, Object.assign({}, tableProps, { members: ungrouped.filter((m) => !m.isRetired) })),
                    )
                  : null,
              )
            : h("div", { style: S.card }, h("div", { style: S.emptyBox }, t("empty")))
          : null,

        tab === "retired"
          ? h(
              "div",
              { style: S.card },
              h(
                "div",
                { style: S.cardHead },
                h("span", { style: S.cardTitle }, t("tabRetired")),
                h("span", { style: S.countPill }, retired.length + " " + t("people")),
              ),
              h(MemberTable, Object.assign({}, tableProps, { members: retired, emptyText: "—" })),
            )
          : null,

        tab === "unregistered"
          ? h(
              "div",
              { style: S.card },
              h(
                "div",
                { style: S.cardHead },
                h("span", { style: S.cardTitle }, t("tabUnregistered")),
                h("span", { style: S.countPill }, String(unregistered.length)),
                h("span", { style: S.cardDesc }, t("unregisteredHint")),
              ),
              unregistered.length
                ? h(
                    "div",
                    null,
                    unregistered.map((target) =>
                      h(
                        "div",
                        { key: target, style: { display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderBottom: "1px solid rgba(127,127,127,.08)" } },
                        h("span", { style: S.mono }, target),
                        h(
                          "span",
                          { style: { marginLeft: "auto" } },
                          h("button", { style: S.btnSm, disabled: busy, onClick: () => run("addMember", { target: target }) }, t("register")),
                        ),
                      ),
                    ),
                    h(
                      "div",
                      { style: { display: "flex", justifyContent: "flex-end", padding: "10px 14px" } },
                      h("button", { style: S.btnPrimary, disabled: busy, onClick: () => run("registerLive") }, t("registerAll")),
                    ),
                  )
                : h("div", { style: S.emptyBox }, "—"),
            )
          : null,
        tab === "workflow" ? h(WorkflowPanel, { t: t }) : null,
        tab === "maintain" ? h(MaintainPanel, { t: t }) : null,

        // 一句话建组：弹窗形式，预览 → 确认两步，绝不因为一句话解析误差直接写名册
        briefOpen
          ? h(
              "div",
              {
                style: S.modal,
                onClick: (e) => {
                  if (e.target === e.currentTarget) setBriefOpen(false);
                },
              },
              h(
                "div",
                { style: S.modalPanel },
                h(GroupBriefForm, {
                  t: t,
                  onClose: () => {
                    setBriefOpen(false);
                    load();
                  },
                  onCreated: () => load(),
                }),
              ),
            )
          : null,
      );
    }

    // 侧边栏入口图标：与插件列表共用同一张三人图标（内联 data URI，随位置缩放）
    const SIDEBAR_ICON = "data:image/png;base64,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";

    /* ---------------------- 0.2.0 工作流 / 维护 / 一句话建组 ---------------------- */

    function fmtNum(n) {
      if (typeof n !== "number" || !Number.isFinite(n)) return "—";
      if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
      if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
      if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
      return String(Math.round(n));
    }

    function fmtDur(ms) {
      if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "—";
      if (ms < 1000) return (ms / 1000).toFixed(1) + "s";
      if (ms < 60000) return Math.round(ms / 1000) + "s";
      if (ms < 3600000) return Math.floor(ms / 60000) + "m " + Math.round((ms % 60000) / 1000) + "s";
      return Math.floor(ms / 3600000) + "h " + Math.round((ms % 3600000) / 60000) + "m";
    }

    function statusDot(status) {
      const color = status === "running" ? "#1a7f37" : status === "idle" ? "#9aa4b2" : "#c9a227";
      return h("span", { style: { display: "inline-block", width: 8, height: 8, borderRadius: 4, background: color, marginRight: 6 } });
    }

    const WF_TH = { padding: "6px 8px", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap", borderBottom: "1px solid rgba(127,127,127,0.25)" };
    const WF_TD = { padding: "6px 8px", verticalAlign: "top", borderBottom: "1px solid rgba(127,127,127,0.12)" };
    const WF_CARD = { border: "1px solid rgba(127,127,127,0.25)", borderRadius: 8, padding: "12px 14px", marginBottom: 14 };

    function WorkflowPanel(props) {
      const t = props.t;
      const [snap, setSnap] = useState(null);
      const [error, setError] = useState(null);
      const [auto, setAuto] = useState(true);
      const [busy, setBusy] = useState(false);

      useEffect(() => {
        let alive = true;
        let timer = null;
        async function pull() {
          try {
            const data = await api("/workflow");
            if (!alive) return;
            setSnap(data);
            setError(null);
          } catch (err) {
            if (alive) setError(err.message || String(err));
          }
        }
        pull();
        if (auto) timer = setInterval(pull, 2000);
        return () => {
          alive = false;
          if (timer) clearInterval(timer);
        };
      }, [auto]);

      async function refreshOnce() {
        setBusy(true);
        try {
          setSnap(await api("/workflow"));
          setError(null);
        } catch (err) {
          setError(err.message || String(err));
        } finally {
          setBusy(false);
        }
      }

      if (!snap) return h("div", { style: S.emptyBox }, busy ? "…" : error ? t("error") + "：" + error : "…");

      const rows = snap.members || [];
      const tasks = snap.tasks || [];
      const totals = snap.totals || {};
      const counts = snap.taskCounts || {};
      const running = rows.filter((r) => r.status === "running").length;

      const kpi = (label, value, hint) =>
        h(
          "div",
          { style: { flex: "1 1 130px", minWidth: 120, padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(127,127,127,0.22)" }, title: hint || "" },
          h("div", { style: { fontSize: 11, opacity: 0.7 } }, label),
          h("div", { style: { fontSize: 18, fontWeight: 600, marginTop: 2 } }, value),
        );

      return h(
        "div",
        null,
        h(
          "div",
          { style: Object.assign({}, WF_CARD, { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }) },
          h("div", { style: { fontWeight: 600, marginRight: 6 } }, t("wfTitle")),
          h("span", { style: Object.assign({}, S.badge, { background: auto ? "rgba(26,127,55,0.14)" : "rgba(127,127,127,0.14)" }) }, auto ? t("wfLive") : t("wfPaused")),
          h("span", { style: { fontSize: 11, opacity: 0.65 } }, t("wfRefreshHint")),
          h("div", { style: { marginLeft: "auto", display: "flex", gap: 8 } },
            h("button", { style: S.btnSm, disabled: busy, onClick: refreshOnce }, busy ? "…" : t("refresh")),
            h("button", { style: auto ? S.btnSm : S.btnPrimary, onClick: () => setAuto(!auto) }, auto ? t("wfPaused") : t("wfLive")),
          ),
        ),
        error ? h("div", { style: S.err }, t("error") + "：" + error) : null,
        snap.enabled === false ? h("div", { style: S.hint }, snap.tasksError || t("wfNoData")) : null,
        h(
          "div",
          { style: { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 } },
          kpi(t("statActive") + " / " + t("wfStatusRunning"), running + " / " + rows.length),
          kpi(t("wfTokens"), fmtNum(totals.inputTokens) + " / " + fmtNum(totals.outputTokens)),
          kpi(t("wfRequests"), fmtNum(totals.requests)),
          kpi(t("wfCacheHit"), typeof totals.cacheHitRate === "number" ? (totals.cacheHitRate * 100).toFixed(1) + "%" : t("wfHitNa")),
          kpi(t("wfElapsed"), fmtDur(totals.activeMs)),
          kpi(t("wfTasks"), (counts.in_progress || 0) + " / " + (counts.pending || 0) + " / " + (counts.completed || 0), t("wfTaskRunning") + " / " + t("wfTaskPending") + " / " + t("wfTaskDone")),
        ),
        h(
          "div",
          { style: WF_CARD },
          h(
            "table",
            { style: { width: "100%", borderCollapse: "collapse", fontSize: 12.5 } },
            h("thead", null, h("tr", null,
              h("th", { style: WF_TH }, t("displayName")),
              h("th", { style: WF_TH }, t("role")),
              h("th", { style: WF_TH }, t("model")),
              h("th", { style: WF_TH }, t("wfStatus")),
              h("th", { style: WF_TH }, t("wfWork")),
              h("th", { style: WF_TH }, t("wfTokens")),
              h("th", { style: WF_TH }, t("wfElapsed")),
              h("th", { style: WF_TH }, t("wfRequests")),
            )),
            h("tbody", null,
              rows.length === 0
                ? h("tr", null, h("td", { style: Object.assign({}, WF_TD, { opacity: 0.7 }), colSpan: 8 }, t("wfNoData")))
                : rows.map((r) =>
                    h("tr", { key: r.target },
                      h("td", { style: WF_TD }, h("div", { style: { fontWeight: 600 } }, r.displayName), h("div", { style: Object.assign({}, S.mono, { fontSize: 11, opacity: 0.65 }) }, r.target)),
                      h("td", { style: WF_TD }, r.title || "—"),
                      h("td", { style: Object.assign({}, WF_TD, S.mono) }, r.model || "—"),
                      h("td", { style: WF_TD }, statusDot(r.status), r.status === "running" ? t("wfStatusRunning") : r.status === "idle" ? t("wfStatusIdle") : r.status === "unknown" ? t("wfStatusUnknown") : r.status),
                      h("td", { style: WF_TD },
                        r.work
                          ? h("div", null,
                              h("div", { style: { fontWeight: 500 } }, r.work.subject || r.work.taskId),
                              h("div", { style: { fontSize: 11, opacity: 0.65 } }, (r.work.status === "in_progress" ? t("wfTaskRunning") : t("wfTaskPending")) + " · " + fmtDur(r.work.elapsedMs)),
                            )
                          : h("span", { style: { opacity: 0.55 } }, t("wfNoWork")),
                      ),
                      h("td", { style: Object.assign({}, WF_TD, { whiteSpace: "nowrap" }) }, fmtNum(r.usage && r.usage.input) + " / " + fmtNum(r.usage && r.usage.output)),
                      h("td", { style: WF_TD }, fmtDur(r.elapsedMs)),
                      h("td", { style: WF_TD }, String((r.usage && r.usage.requests) || 0)),
                    ),
                  ),
            ),
          ),
          h("div", { style: { fontSize: 11, opacity: 0.6, marginTop: 8 } }, t("wfUpdated", { time: new Date(snap.generatedAt || Date.now()).toLocaleTimeString() })),
        ),
        h(
          "div",
          { style: WF_CARD },
          h("div", { style: { fontWeight: 600, marginBottom: 8 } }, t("wfTasks") + "  " + (snap.tasksAvailable === false ? "" : "")),
          snap.tasksAvailable === false
            ? h("div", { style: S.hint }, t("wfTasksUnavailable", { msg: snap.tasksError || "—" }))
            : tasks.length === 0
              ? h("div", { style: S.hint }, t("wfNoData"))
              : h(
                  "table",
                  { style: { width: "100%", borderCollapse: "collapse", fontSize: 12.5 } },
                  h("thead", null, h("tr", null,
                    h("th", { style: WF_TH }, "id"),
                    h("th", { style: WF_TH }, t("wfWork")),
                    h("th", { style: WF_TH }, t("wfStatus")),
                    h("th", { style: WF_TH }, t("displayName")),
                    h("th", { style: WF_TH }, t("wfElapsed")),
                  )),
                  h("tbody", null, tasks.map((task) =>
                    h("tr", { key: task.taskId },
                      h("td", { style: Object.assign({}, WF_TD, S.mono) }, task.taskId),
                      h("td", { style: WF_TD }, task.subject || "—"),
                      h("td", { style: WF_TD }, task.status),
                      h("td", { style: WF_TD }, task.ownerName || "—"),
                      h("td", { style: WF_TD }, fmtDur(task.elapsedMs)),
                    ),
                  )),
                ),
        ),
      );
    }

    function MaintainPanel(props) {
      const t = props.t;
      const [upd, setUpd] = useState(null);
      const [bak, setBak] = useState(null);
      const [error, setError] = useState(null);
      const [busy, setBusy] = useState(false);
      const [result, setResult] = useState(null);

      const load = useCallback(async () => {
        try {
          const [u, b] = await Promise.all([
            api("/update").catch((err) => ({ error: err.message })),
            api("/backups").catch((err) => ({ error: err.message })),
          ]);
          setUpd(u && u.error ? null : u);
          setBak(b && b.error ? null : b);
          setError(u && u.error ? u.error : b && b.error ? b.error : null);
        } catch (err) {
          setError(err.message || String(err));
        }
      }, []);
      useEffect(() => {
        load();
      }, [load]);

      async function act(op, args, label) {
        setBusy(true);
        setResult(null);
        try {
          const data = await post(op, args || {});
          setResult({ ok: true, label, data });
          await load();
        } catch (err) {
          setResult({ ok: false, label, message: err.message || String(err) });
        } finally {
          setBusy(false);
        }
      }

      const backups = (bak && bak.backups) || [];
      return h(
        "div",
        null,
        error ? h("div", { style: S.hint }, t("hint") + "：" + error) : null,
        h(
          "div",
          { style: WF_CARD },
          h("div", { style: { fontWeight: 600 } }, t("mtTitle")),
          h("div", { style: { opacity: 0.7, fontSize: 12, margin: "4px 0 12px" } }, t("mtSub")),
          h(
            "div",
            { style: { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 } },
            h("div", { style: { flex: "1 1 220px", minWidth: 200 } },
              h("div", { style: { fontSize: 11, opacity: 0.7 } }, t("mtCurrent")),
              h("div", { style: { fontSize: 16, fontWeight: 600 } }, (upd && upd.current) || "—"),
              h("div", { style: { fontSize: 11, opacity: 0.6, wordBreak: "break-all" } }, (upd && upd.installDir) || ""),
            ),
            h("div", { style: { flex: "1 1 220px", minWidth: 200 } },
              h("div", { style: { fontSize: 11, opacity: 0.7 } }, t("mtLatest")),
              h("div", { style: { fontSize: 16, fontWeight: 600 } }, upd && upd.latest && upd.latest.latest ? upd.latest.latest : upd && upd.latest && upd.latest.version ? upd.latest.version : t("mtUnknown")),
              h("div", { style: { fontSize: 11, opacity: 0.6 } }, upd && upd.lastCheck ? t("wfUpdated", { time: new Date(upd.lastCheck).toLocaleString() }) : ""),
            ),
            h("div", { style: { flex: "1 1 220px", minWidth: 200 } },
              h("div", { style: { fontSize: 11, opacity: 0.7 } }, t("mtResult")),
              h("div", { style: { fontSize: 13 } }, upd && upd.pending ? t("mtPending", { v: upd.pending.version }) : t("mtNoPending")),
            ),
          ),
          h("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
            h("button", { style: S.btnSm, disabled: busy || !upd || upd.enabled === false, onClick: () => act("updateCheck", {}, t("mtCheck")) }, t("mtCheck")),
            h("button", { style: S.btnSm, disabled: busy || !upd || upd.enabled === false, onClick: () => act("updateStage", {}, t("mtStage")) }, t("mtStage")),
            h("button", { style: S.btnPrimary, disabled: busy || !upd || !upd.pending, onClick: () => act("updateApply", {}, t("mtApply")) }, t("mtApply")),
            h("button", { style: S.btnSmDanger, disabled: busy || !upd || upd.enabled === false, onClick: () => act("updateRollback", {}, t("mtRollback")) }, t("mtRollback")),
          ),
          h("div", { style: { fontSize: 11, opacity: 0.6, marginTop: 8 } }, t("mtApplyHint") + (upd && upd.pending ? " · " + t("mtRestart") : "")),
          upd && upd.applyCommand
            ? h(
                "pre",
                { style: { fontSize: 11, background: "#f6f7f9", border: "1px solid rgba(127,127,127,0.25)", borderRadius: 6, padding: "6px 8px", overflowX: "auto", marginTop: 6 } },
                upd.applyCommand,
              )
            : null,
          upd && upd.enabled === false ? h("div", { style: S.hint }, t("mtDisabled")) : null,
          upd && upd.lastError ? h("div", { style: S.hint }, t("error") + "：" + upd.lastError) : null,
        ),
        h(
          "div",
          { style: WF_CARD },
          h("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
            h("div", { style: { fontWeight: 600 } }, t("mtBackupTitle")),
            h("span", { style: { fontSize: 11, opacity: 0.65 } }, t("mtBackupCount", { n: (bak && bak.total) || backups.length })),
            h("button", { style: S.btnSm, disabled: busy, onClick: () => act("backupNow", { reason: "manual" }, t("mtBackupNow")) }, t("mtBackupNow")),
          ),
          backups.length === 0
            ? h("div", { style: S.hint }, t("mtNoBackups"))
            : h(
                "table",
                { style: { width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginTop: 8 } },
                h("thead", null, h("tr", null,
                  h("th", { style: WF_TH }, t("groupName")),
                  h("th", { style: WF_TH }, t("wfElapsed")),
                  h("th", { style: WF_TH }, t("actions")),
                )),
                h("tbody", null, backups.map((b) =>
                  h("tr", { key: b.name },
                    h("td", { style: WF_TD },
                      h("div", { style: S.mono }, b.name),
                      h("div", { style: { fontSize: 11, opacity: 0.65 } }, (b.reason || "") + " · " + fmtNum(b.bytes) + "B"),
                    ),
                    h("td", { style: WF_TD }, b.mtime ? new Date(b.mtime).toLocaleString() : "—"),
                    h("td", { style: WF_TD }, h("button", {
                      style: S.btnSm,
                      disabled: busy,
                      onClick: () => {
                        if (!window.confirm(t("mtRestoreConfirm", { name: b.name }))) return;
                        act("restoreBackup", { name: b.name }, t("mtRestore"));
                      },
                    }, t("mtRestore"))),
                  ),
                )),
              ),
        ),
        result
          ? h("div", { style: result.ok ? S.hint : S.err },
              result.label + "：" + (result.ok ? t("done") : result.message),
              result.ok ? h("pre", { style: { maxHeight: 240, overflow: "auto", fontSize: 11, marginTop: 6 } }, JSON.stringify(result.data, null, 2)) : null,
            )
          : null,
      );
    }

    function GroupBriefForm(props) {
      const t = props.t;
      const [text, setText] = useState(props.initialText || "");
      const [preview, setPreview] = useState(null);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);
      const [created, setCreated] = useState(null);

      async function parse() {
        setBusy(true);
        setError(null);
        setPreview(null);
        try {
          setPreview(await post("createGroupFromText", { text }));
        } catch (err) {
          setError(err.message || String(err));
        } finally {
          setBusy(false);
        }
      }

      async function confirm() {
        setBusy(true);
        setError(null);
        try {
          const data = await post("createGroupFromText", { text, confirm: true });
          setCreated(data);
          if (typeof props.onCreated === "function") props.onCreated(data);
        } catch (err) {
          setError(err.message || String(err));
        } finally {
          setBusy(false);
        }
      }

      return h(
        "div",
        null,
        h("div", { style: { fontWeight: 600, marginBottom: 6 } }, t("briefTitle")),
        h("div", { style: { fontSize: 12, opacity: 0.7, marginBottom: 10 } }, t("briefExampleLabel") + "：" + t("briefExample")),
        h("textarea", {
          style: Object.assign({}, S.ta, { minHeight: 72 }),
          placeholder: t("briefPlaceholder"),
          value: text,
          onChange: (e) => setText(e.target.value),
        }),
        h("div", { style: { display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" } },
          h("button", { style: S.btnSm, disabled: busy, onClick: () => { setText(t("briefExample")); setPreview(null); setCreated(null); } }, t("briefFill")),
          h("button", { style: S.btnPrimary, disabled: busy || !text.trim(), onClick: parse }, busy ? "…" : t("briefParse")),
          h("button", { style: S.btnSm, disabled: busy, onClick: props.onClose }, t("cancel")),
        ),
        error ? h("div", { style: S.err }, t("error") + "：" + error) : null,
        created
          ? h("div", { style: Object.assign({}, WF_CARD, { marginTop: 12 }) },
              h("div", { style: { fontWeight: 600 } }, t("briefDone", { n: (created.added || []).length })),
              h("div", { style: { fontSize: 12, opacity: 0.75, marginTop: 4 } }, created.summary || ""),
              created.failures && created.failures.length
                ? h("div", { style: S.err }, created.message || "")
                : null,
              h("div", { style: { marginTop: 8, display: "flex", gap: 8 } },
                h("button", { style: S.btnPrimary, onClick: props.onClose }, t("done")),
              ),
            )
          : preview
            ? h("div", { style: Object.assign({}, WF_CARD, { marginTop: 12 }) },
                h("div", { style: { fontWeight: 600 } }, t("briefPreviewTitle") + "：" + preview.group.name),
                preview.group.description ? h("div", { style: { fontSize: 12, opacity: 0.7, marginTop: 4 } }, preview.group.description) : null,
                h("pre", { style: { fontSize: 12, whiteSpace: "pre-wrap", marginTop: 8 } }, preview.summary || t("briefNone")),
                preview.warnings && preview.warnings.length ? h("div", { style: S.hint }, preview.warnings.join("；")) : null,
                h("div", { style: { display: "flex", gap: 8, marginTop: 8 } },
                  h("button", { style: S.btnSm, disabled: busy, onClick: () => setPreview(null) }, t("briefBack")),
                  h("button", { style: S.btnPrimary, disabled: busy, onClick: confirm }, t("briefConfirm")),
                ),
              )
            : null,
      );
    }

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

    /* ================================================================ */
    /* 0.2.1 · 组织架构图悬浮层（独立于插槽，挂在 document.body 上）      */
    /* ================================================================ */

    const ORGMAP_VERSION = 2;
    const ORGMAP_MAX_EDGES = 12;
    // 并联（同层兄弟）横向排列，串联（父→子）纵向连接：
    //   第 1 层 = 大总管；第 2 层 = 分组色块（横向并联）；第 3 层 = 各组组内成员（组内横向并联）。
    // 层与层之间用竖直总线连接，同层之间不画线。
    const ORGMAP_CARD_W = 188;
    const ORGMAP_LEAD_W = 230;
    // 右侧边栏 tab：类型 id 全注册唯一，kind 是 openTab 的页面身份。
    const ORGMAP_TAB_ID = "dsh-plugin-member-manager/orgmap";
    const ORGMAP_TAB_KIND = "member-orgmap";

    const ORGMAP_CSS = [
      "#mm-orgchart-root{position:relative;width:100%;height:100%;min-height:0;display:flex;",
      "flex-direction:column;font:12px/1.45 ui-sans-serif,system-ui,'Segoe UI','Microsoft YaHei',sans-serif;",
      "color:#1f2328;background:transparent;overflow:hidden}",
      "#mm-orgchart-root[data-embedded='1']{border:none;border-radius:0;box-shadow:none}",
      ".mmo-canvas{flex:1;min-height:0;overflow:auto;padding:8px 10px 4px;position:relative}",
      ".mmo-stage{position:relative;width:max-content;min-width:100%;padding:2px 4px 10px;box-sizing:border-box}",
      ".mmo-svg{position:absolute;left:0;top:0;pointer-events:none;overflow:visible;z-index:0}",
      ".mmo-lead-row{position:relative;z-index:1;display:flex;justify-content:center}",
      ".mmo-lead-row .mmo-card{width:" + ORGMAP_LEAD_W + "px}",
      ".mmo-groups{position:relative;z-index:1;display:flex;align-items:flex-start;justify-content:center;",
      "gap:28px;margin-top:38px}",
      ".mmo-cluster{display:flex;flex-direction:column;align-items:center;gap:12px}",
      ".mmo-chip{display:inline-flex;align-items:center;gap:6px;border-radius:7px;padding:3px 8px;",
      "font-size:11px;font-weight:600;color:#fff;background:#2f6feb;box-shadow:0 1px 2px rgba(23,32,46,.12);",
      "white-space:nowrap}",
      ".mmo-chip[data-gi='0']{background:#2f6feb}.mmo-chip[data-gi='1']{background:#b45309}",
      ".mmo-chip[data-gi='2']{background:#1a7f37}.mmo-chip[data-gi='3']{background:#8250df}",
      ".mmo-chip[data-gi='4']{background:#0e7490}.mmo-chip[data-gi='5']{background:#b42318}",
      ".mmo-chip-count{background:rgba(255,255,255,.24);border-radius:999px;padding:0 5px;font-size:10px;font-weight:500}",
      ".mmo-members{display:flex;align-items:stretch;gap:10px}",
      ".mmo-card{box-sizing:border-box;width:" + ORGMAP_CARD_W + "px;border:1px solid rgba(31,35,40,.14);",
      "border-radius:9px;padding:6px 8px;background:#fff;position:relative;transition:border-color .2s,box-shadow .2s}",
      ".mmo-card[data-active='1']{border-color:rgba(47,111,235,.55);box-shadow:0 0 0 2px rgba(47,111,235,.12)}",
      ".mmo-card[data-running='1']{background:linear-gradient(180deg,rgba(47,111,235,.06),#fff)}",
      ".mmo-row1{display:flex;align-items:center;gap:5px;min-width:0}",
      ".mmo-dot{width:7px;height:7px;border-radius:50%;background:#b8bfc7;flex:none}",
      ".mmo-dot[data-state='running']{background:#1a7f37;animation:mmo-pulse 1.4s ease-in-out infinite}",
      ".mmo-dot[data-state='idle']{background:#8c959f}",
      ".mmo-name{font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".mmo-model{font-size:10px;color:#6b747e;background:#f3f5f8;border-radius:5px;padding:1px 4px;",
      "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px;flex:none}",
      ".mmo-task{font-size:11px;color:#4a525b;margin-top:3px;display:-webkit-box;-webkit-line-clamp:2;",
      "-webkit-box-orient:vertical;overflow:hidden}",
      ".mmo-task[data-empty='1']{color:#9aa2ab}",
      ".mmo-meta{display:flex;gap:6px;margin-top:3px;font-size:10px;color:#6b747e;flex-wrap:wrap}",
      ".mmo-badge{font-size:9px;border-radius:4px;padding:0 4px;background:rgba(47,111,235,.12);color:#2f6feb}",
      ".mmo-ok{background:rgba(26,127,55,.12);color:#1a7f37}",
      ".mmo-foot{flex:none;display:flex;gap:10px;flex-wrap:wrap;padding:2px 12px 6px;font-size:10px;color:#6b747e}",
      ".mmo-fail{display:none;padding:2px 12px 4px;color:#b42318;font-size:11px}",
      ".mmo-toolbar{flex:none;display:flex;align-items:center;gap:8px;padding:7px 12px 2px}",
      ".mmo-toolbar-label{font-size:11px;color:#6b747e;white-space:nowrap}",
      ".mmo-select{flex:1;min-width:0;max-width:100%;font:11px/1.5 inherit;padding:2px 6px;",
      "border:1px solid rgba(31,35,40,.18);border-radius:6px;background:#fff;color:#1f2328}",
      ".mmo-empty{display:none;padding:20px 12px;color:#9aa2ab;font-size:11px;text-align:center}",
      ".mmo-branch{fill:none;stroke:rgba(100,116,139,.55);stroke-width:1.2;stroke-linejoin:round;stroke-linecap:round}",
      ".mmo-edge{fill:none;stroke:rgba(47,111,235,.5);stroke-width:1.4;stroke-linejoin:round}",
      ".mmo-edge[data-kind='dep']{stroke:rgba(154,103,0,.55);stroke-dasharray:3 3}",
      ".mmo-edge-active{stroke:#2f6feb;stroke-width:2;stroke-dasharray:7 5;animation:mmo-dash 0.8s linear infinite}",
      "@keyframes mmo-dash{to{stroke-dashoffset:-24}}",
      "@keyframes mmo-pulse{0%,100%{box-shadow:0 0 0 0 rgba(26,127,55,.45)}50%{box-shadow:0 0 0 4px rgba(26,127,55,0)}}",
      "@media (prefers-reduced-motion:reduce){.mmo-dot[data-state='running'],.mmo-edge-active{animation:none}}",
    ].join("");

    function orgmapFormatTokens(n) {
      const v = Number(n) || 0;
      if (v >= 1e9) return (v / 1e9).toFixed(1) + "B";
      if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
      if (v >= 1e3) return (v / 1e3).toFixed(1) + "k";
      return String(Math.round(v));
    }

    function orgmapShorten(text, max) {
      const s = String(text || "").replace(/\s+/g, " ").trim();
      if (!s) return "";
      const n = typeof max === "number" && max > 1 ? max : 40;
      return s.length <= n ? s : s.slice(0, n - 1) + "…";
    }

    const GROUP_COLORS = ["#2f6feb", "#b45309", "#1a7f37", "#8250df", "#0e7490", "#b42318"];

    /** 组织架构图：无窗口框、无位置按钮，固定渲染在右侧边栏 tab 里。 */
    function createOrgChartOverlay(options) {
      const doc = options.document;
      const win = options.window || (doc && doc.defaultView) || null;
      if (!doc || !doc.body) return null;
      const apiBase = options.apiBase;
      const t = typeof options.t === "function" ? options.t : (k) => k;
      const pollMs = options.pollMs || 2000;
      const reportError = typeof options.reportError === "function" ? options.reportError : () => {};
      const host = options.host || null;
      // 任务作用域：一个 root 会话 = 一个任务；换任务只换这个 id，图表结构不变。
      let taskId = options.taskId || "";

      const STYLE_ID = "mm-orgchart-style";
      if (!doc.getElementById(STYLE_ID)) {
        const style = doc.createElement("style");
        style.id = STYLE_ID;
        style.textContent = ORGMAP_CSS;
        (doc.head || doc.body).appendChild(style);
      }

      const root = doc.createElement("div");
      root.id = "mm-orgchart-root";
      root.setAttribute("data-mm-orgchart", "1");
      root.setAttribute("data-embedded", "1");
      root.setAttribute("data-layout", "levels");

      const canvas = doc.createElement("div");
      canvas.className = "mmo-canvas";
      const stage = doc.createElement("div");
      stage.className = "mmo-stage";
      const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "mmo-svg");
      svg.setAttribute("aria-hidden", "true");
      stage.appendChild(svg);
      const leadRow = doc.createElement("div");
      leadRow.className = "mmo-lead-row";
      stage.appendChild(leadRow);
      const groupsRow = doc.createElement("div");
      groupsRow.className = "mmo-groups";
      stage.appendChild(groupsRow);
      canvas.appendChild(stage);

      const failLine = doc.createElement("div");
      failLine.className = "mmo-fail";
      const foot = doc.createElement("div");
      foot.className = "mmo-foot";

      const toolbar = doc.createElement("div");
      toolbar.className = "mmo-toolbar";
      const toolbarLabel = doc.createElement("span");
      toolbarLabel.className = "mmo-toolbar-label";
      const picker = doc.createElement("select");
      picker.className = "mmo-select";
      picker.setAttribute("aria-label", "task");
      picker.addEventListener("change", () => {
        taskId = picker.value || "";
        scaledOnce = false;
        refresh(true);
      });
      toolbar.appendChild(toolbarLabel);
      toolbar.appendChild(picker);

      const emptyLine = doc.createElement("div");
      emptyLine.className = "mmo-empty";

      root.appendChild(toolbar);
      root.appendChild(failLine);
      root.appendChild(canvas);
      root.appendChild(foot);
      canvas.appendChild(emptyLine);

      const raf = (fn) => {
        try {
          if (win && typeof win.requestAnimationFrame === "function") win.requestAnimationFrame(fn);
          else setTimeout(fn, 16);
        } catch {
          fn();
        }
      };

      // ---- 渲染 ----
      let lastData = null;
      let cardIndex = new Map();
      let layout = { lead: null, groups: [] };
      let timer = null;
      let disposed = false;
      let fetching = false;
      let failed = 0;

      function el(tag, cls, text) {
        const node = doc.createElement(tag);
        if (cls) node.className = cls;
        if (text !== undefined && text !== null) node.textContent = String(text);
        return node;
      }

      function cardFor(m) {
        const card = el("div", "mmo-card");
        card.setAttribute("data-target", String(m.target || ""));
        const running = m.status === "running";
        const work = m.work || null;
        const inProgress = !!(work && work.status === "in_progress");
        if (running) card.setAttribute("data-running", "1");
        if (running || inProgress) card.setAttribute("data-active", "1");

        const row1 = el("div", "mmo-row1");
        const dot = el("span", "mmo-dot");
        dot.setAttribute("data-state", running ? "running" : m.status === "idle" ? "idle" : "unknown");
        row1.appendChild(dot);
        const name = el("span", "mmo-name", m.displayName || m.target || "");
        name.title = (m.displayName || m.target || "") + (m.title ? " · " + m.title : "");
        row1.appendChild(name);
        if (m.model) {
          const model = el("span", "mmo-model", orgmapShorten(String(m.model).replace(/^deepseek-/, ""), 18));
          model.title = m.provider ? m.provider + " / " + m.model : m.model;
          row1.appendChild(model);
        }
        card.appendChild(row1);

        const taskText = work ? orgmapShorten(work.subject, 46) : "";
        const task = el("div", "mmo-task", taskText || t("ocNoWork"));
        if (!taskText) task.setAttribute("data-empty", "1");
        card.appendChild(task);

        const meta = el("div", "mmo-meta");
        const usage = m.usage || {};
        meta.appendChild(el("span", "", orgmapFormatTokens(usage.total) + " tok"));
        if (usage.requests) meta.appendChild(el("span", "", usage.requests + " req"));
        meta.appendChild(el("span", "", typeof fmtDur === "function" ? fmtDur(m.elapsedMs) : ""));
        if (work && work.status) {
          const badge = el("span", "mmo-badge" + (work.status === "completed" ? " mmo-ok" : ""), work.status);
          meta.appendChild(badge);
        }
        card.appendChild(meta);
        return card;
      }

      /** 任务下拉：数据来自 /orgmap 的 tasks；只在内容变化时重建 option，避免打断用户选择。 */
      function updatePicker(data) {
        toolbarLabel.textContent = t("tcTaskLabel");
        const tasks = Array.isArray(data && data.tasks) ? data.tasks : [];
        const current = (data && data.task && data.task.id) || taskId || "";
        if (!taskId && current) taskId = current;
        const sig = tasks.map((x) => x.id + ":" + (x.title || "") + ":" + (x.running ? "1" : "0") + ":" + x.memberCount).join("|") + "#" + current;
        if (picker.getAttribute("data-sig") === sig) return;
        picker.setAttribute("data-sig", sig);
        while (picker.firstChild) picker.removeChild(picker.firstChild);
        if (!tasks.length) {
          const opt = doc.createElement("option");
          opt.value = "";
          opt.textContent = t("tcNoTasks");
          picker.appendChild(opt);
          picker.disabled = true;
          return;
        }
        picker.disabled = false;
        for (const item of tasks) {
          const opt = doc.createElement("option");
          opt.value = String(item.id || "");
          opt.textContent =
            orgmapShorten(item.title || String(item.id || "").slice(0, 8), 42) +
            " · " + (item.memberCount || 0) + (item.running ? " ●" : "");
          if (String(item.id || "") === String(current)) opt.selected = true;
          picker.appendChild(opt);
        }
      }

      function render(data) {
        lastData = data || {};
        const d = lastData;
        updatePicker(d);
        const hasTask = !!(d.task || d.lead);
        emptyLine.style.display = hasTask ? "none" : "block";
        emptyLine.textContent = hasTask ? "" : t("ocEmptyTask");
        cardIndex = new Map();
        layout = { lead: null, groups: [] };
        leadRow.textContent = "";
        groupsRow.textContent = "";

        if (d.lead) {
          const leadCard = cardFor(d.lead);
          leadCard.setAttribute("data-role", "lead");
          cardIndex.set(String(d.lead.target || "lead"), leadCard);
          leadRow.appendChild(leadCard);
          layout.lead = leadCard;
        }

        const groups = Array.isArray(d.groups) ? d.groups : [];
        const ungrouped = Array.isArray(d.ungrouped) ? d.ungrouped : [];
        const sections = groups.map((g) => ({ name: g.name || t("ocUngrouped"), members: g.members || [] }));
        if (ungrouped.length) sections.push({ name: t("ocUngrouped"), members: ungrouped });

        sections.forEach((section, gi) => {
          const gidx = gi % 6;
          const cluster = el("div", "mmo-cluster");
          cluster.setAttribute("data-gi", String(gidx));
          const chip = el("div", "mmo-chip");
          chip.setAttribute("data-gi", String(gidx));
          chip.appendChild(el("span", "mmo-chip-name", section.name));
          chip.appendChild(el("span", "mmo-chip-count", String(section.members.length)));
          cluster.appendChild(chip);
          const membersBox = el("div", "mmo-members");
          const memberCards = [];
          for (const m of section.members) {
            const card = cardFor(m);
            card.setAttribute("data-gi", String(gidx));
            cardIndex.set(String(m.target || ""), card);
            membersBox.appendChild(card);
            memberCards.push(card);
          }
          cluster.appendChild(membersBox);
          groupsRow.appendChild(cluster);
          layout.groups.push({ chip: chip, members: memberCards, gi: gidx });
        });

        const totals = d.totals || {};
        foot.textContent = "";
        foot.appendChild(el("span", "", t("ocTotals") + " " + orgmapFormatTokens(totals.totalTokens) + " tok"));
        if (totals.requests !== undefined) foot.appendChild(el("span", "", totals.requests + " req"));
        const activeCount = (d.members || []).filter(
          (m) => m.status === "running" || (m.work && m.work.status === "in_progress"),
        ).length;
        foot.appendChild(el("span", "", t("ocActive") + " " + activeCount));
        if (d.taskCounts) {
          const done = d.taskCounts.completed || 0;
          const total = (d.taskCounts.pending || 0) + (d.taskCounts.in_progress || 0) + done;
          foot.appendChild(el("span", "", "任务 " + done + "/" + total));
        }
        if (d.generatedAt) foot.appendChild(el("span", "", t("ocSample") + " " + String(d.generatedAt).slice(11, 19)));

        raf(() => {
          drawEdges(d);
          centerViewport();
        });
      }

      function rectOf(node) {
        if (!node || typeof node.getBoundingClientRect !== "function") return null;
        const s = stage.getBoundingClientRect();
        const r = node.getBoundingClientRect();
        const width = typeof r.width === "number" ? r.width : (r.right || 0) - (r.left || 0);
        if (!width) return null;
        const left = r.left - s.left;
        const top = r.top - s.top;
        return {
          left: left,
          right: left + width,
          top: top,
          bottom: top + (r.height || 0),
          cx: left + width / 2,
          cy: top + (r.height || 0) / 2,
        };
      }

      function addPath(d, cls, color) {
        const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", d);
        path.setAttribute("class", cls);
        if (color) path.setAttribute("stroke", color);
        svg.appendChild(path);
      }

      function drawEdges(data) {
        if (!data) return;
        const w = Math.max(1, Math.ceil(stage.scrollWidth || stage.offsetWidth || 1));
        const h = Math.max(1, Math.ceil(stage.scrollHeight || stage.offsetHeight || 1));
        svg.setAttribute("viewBox", "0 0 " + w + " " + h);
        svg.setAttribute("width", String(w));
        svg.setAttribute("height", String(h));
        while (svg.firstChild) svg.removeChild(svg.firstChild);

        const lead = rectOf(layout.lead);
        const groups = layout.groups || [];

        // ---- 串联：大总管（第 1 层）→ 分组色块（第 2 层），纵向总线 ----
        const chips = groups.map((g) => ({ g: g, r: rectOf(g.chip) })).filter((c) => c.r);
        if (lead && chips.length) {
          const tops = chips.map((c) => c.r.top);
          const busY = lead.bottom + Math.max(14, (Math.min.apply(null, tops) - lead.bottom) / 2);
          addPath("M " + lead.cx.toFixed(1) + " " + lead.bottom.toFixed(1) + " V " + busY.toFixed(1), "mmo-branch");
          const xs = chips.map((c) => c.r.cx);
          const minX = Math.min.apply(null, xs);
          const maxX = Math.max.apply(null, xs);
          if (maxX - minX > 0.5) {
            addPath("M " + minX.toFixed(1) + " " + busY.toFixed(1) + " H " + maxX.toFixed(1), "mmo-branch");
          }
          for (const item of chips) {
            addPath(
              "M " + item.r.cx.toFixed(1) + " " + busY.toFixed(1) + " V " + item.r.top.toFixed(1),
              "mmo-branch",
            );
          }
        }

        // ---- 串联：分组（第 2 层）→ 组内成员（第 3 层），组色总线；组内成员横向并联 ----
        for (const g of groups) {
          const chip = rectOf(g.chip);
          const cards = g.members.map((card) => rectOf(card)).filter(Boolean);
          if (!chip || !cards.length) continue;
          const color = GROUP_COLORS[g.gi];
          const tops = cards.map((c) => c.top);
          const busY = Math.min.apply(null, tops) - 12;
          addPath("M " + chip.cx.toFixed(1) + " " + chip.bottom.toFixed(1) + " V " + busY.toFixed(1), "mmo-branch", color);
          const xs = cards.map((c) => c.cx);
          const minX = Math.min.apply(null, xs);
          const maxX = Math.max.apply(null, xs);
          if (maxX - minX > 0.5) {
            addPath("M " + minX.toFixed(1) + " " + busY.toFixed(1) + " H " + maxX.toFixed(1), "mmo-branch", color);
          }
          for (const c of cards) {
            addPath("M " + c.cx.toFixed(1) + " " + busY.toFixed(1) + " V " + c.top.toFixed(1), "mmo-branch", color);
          }
        }

        // ---- 动态线：分发 / 依赖，一律正交折线（父→子走纵向，同层走横向）----
        const edges = [];
        const push = (from, to, kind, status) => {
          if (!from || !to || from === to) return;
          const a = cardIndex.get(String(from));
          const b = cardIndex.get(String(to));
          if (!a || !b) return;
          edges.push({ a: a, b: b, kind: kind, status: status });
        };
        const dispatch = Array.isArray(data.dispatch) ? data.dispatch : [];
        for (const e of dispatch) {
          if (e.status === "completed") continue;
          push(e.from, e.to, "dispatch", e.status);
        }
        const dep = Array.isArray(data.dependency) ? data.dependency : [];
        for (const e of dep) {
          if (e.status === "completed") continue;
          push(e.from, e.to, "dep", e.status);
        }
        edges.slice(0, ORGMAP_MAX_EDGES).forEach((e, i) => {
          const a = rectOf(e.a);
          const b = rectOf(e.b);
          if (!a || !b) return;
          let d;
          if (b.top >= a.bottom) {
            // 父在上、子在下：先下沉到过渡带，再沿目标左侧外沿垂直下到卡片上方，避免压住分组色块
            const yTop = Math.min(b.top - 8, a.bottom + 10);
            d =
              "M " + a.cx.toFixed(1) + " " + a.bottom.toFixed(1) +
              " V " + yTop.toFixed(1) +
              " H " + (b.left - 12).toFixed(1) +
              " V " + (b.top - 8).toFixed(1) +
              " H " + b.cx.toFixed(1) + " V " + b.top.toFixed(1);
          } else if (b.bottom <= a.top) {
            const yBot = Math.max(b.bottom + 8, a.top - 10);
            d =
              "M " + a.cx.toFixed(1) + " " + a.top.toFixed(1) +
              " V " + yBot.toFixed(1) +
              " H " + (b.left - 12).toFixed(1) +
              " V " + (b.bottom + 8).toFixed(1) +
              " H " + b.cx.toFixed(1) + " V " + b.bottom.toFixed(1);
          } else {
            // 同一层：从下方绕行，避免压住卡片
            const laneY = Math.max(a.bottom, b.bottom) + 12 + (i % 3) * 6;
            d =
              "M " + a.cx.toFixed(1) + " " + a.bottom.toFixed(1) +
              " V " + laneY.toFixed(1) + " H " + b.cx.toFixed(1) + " V " + b.bottom.toFixed(1);
          }
          addPath(d, "mmo-edge" + (e.status === "in_progress" ? " mmo-edge-active" : ""), e.kind === "dep" ? "#b45309" : "#2f6feb");
        });
      }

      async function refresh(manual) {
        if (disposed || fetching) return;
        fetching = true;
        try {
          const url = apiBase + "/orgmap" + (taskId ? "?task=" + encodeURIComponent(taskId) : "");
          const res = await fetch(url, { headers: { accept: "application/json" } });
          const payload = await res.json();
          if (!res.ok || !payload || payload.ok === false) throw new Error((payload && payload.message) || "HTTP " + res.status);
          failed = 0;
          failLine.style.display = "none";
          render(payload.data);
        } catch (err) {
          failed += 1;
          failLine.style.display = "block";
          failLine.textContent = t("ocFail") + " " + (err && err.message ? err.message : String(err));
          if (failed === 1 || manual) reportError("组织架构图数据刷新", err);
        } finally {
          fetching = false;
        }
      }

      // 窄右栏里整棵树宽于可视区：首次渲染后把视口横向居中到大总管，避免一进来只看到边角。
      let scaledOnce = false;
      function centerViewport() {
        if (scaledOnce) return;
        if (!canvas || typeof canvas.scrollWidth !== "number") return;
        const over = canvas.scrollWidth - canvas.clientWidth;
        if (over > 8 && layout.lead) {
          const lead = rectOf(layout.lead);
          if (lead) {
            const target = Math.max(0, Math.min(over, lead.cx - canvas.clientWidth / 2));
            canvas.scrollLeft = target;
            scaledOnce = true;
          }
        } else if (over <= 8) {
          scaledOnce = true;
        }
      }

      function start() {
        if (timer) return;
        refresh(true);
        timer = setInterval(() => refresh(false), pollMs);
        if (timer && typeof timer.unref === "function") timer.unref();
      }

      function destroy() {
        disposed = true;
        if (timer) clearInterval(timer);
        timer = null;
        if (root.parentNode) root.parentNode.removeChild(root);
      }

      (host || doc.body).appendChild(root);
      start();

      return {
        root: root,
        refresh: refresh,
        destroy: destroy,
        getData: () => lastData,
        getTaskId: () => taskId,
        setTask: (id) => {
          taskId = String(id || "");
          scaledOnce = false;
          return refresh(true);
        },
        isCollapsed: () => false,
        toggleCollapse: () => {},
      };
    }

    /** 右侧边栏 tab 正文：把内嵌版组织架构图挂进宿主 div；轮询/销毁由图表实例自己管理。 */
    function OrgChartTabBody(props) {
      const hostRef = useRef(null);
      props = props || {};
      useEffect(() => {
        const host = hostRef.current;
        if (!host) return undefined;
        const hostDoc = host.ownerDocument || (typeof document !== "undefined" ? document : null);
        const hostWin = (hostDoc && hostDoc.defaultView) || (typeof window !== "undefined" ? window : null);
        let inst = null;
        try {
          inst = createOrgChartOverlay({
            document: hostDoc,
            window: hostWin,
            apiBase: API,
            t: typeof props.t === "function" ? props.t : (k) => k,
            reportError: typeof props.reportError === "function" ? props.reportError : () => {},
            embedded: true,
            host: host,
          });
        } catch (err) {
          if (typeof props.reportError === "function") props.reportError("组织架构图面板", err);
        }
        return () => {
          if (inst) inst.destroy();
        };
      }, []);
      // 不写死高度：右栏容器自身是列布局，这里撑满剩余空间。
      return h("div", {
        ref: hostRef,
        "data-mm-orgchart-host": "1",
        style: { height: "100%", minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" },
      });
    }

    /** 会话 header 的小按钮：手动重新打开组织架构 tab（关闭后还能找回）。 */
    function OrgMapAction(props) {
      props = props || {};
      const t = typeof props.t === "function" ? props.t : (k) => k;
      return h(
        "button",
        {
          type: "button",
          title: t("ocTitle"),
          "aria-label": t("ocTitle"),
          onClick: () => {
            try {
              if (typeof props.open === "function") props.open();
            } catch (err) {
              if (typeof props.reportError === "function") props.reportError("打开组织架构图", err);
            }
          },
          style: {
            border: "1px solid var(--dsw-alias-border-secondary, rgba(31,35,40,.16))",
            background: "transparent",
            color: "inherit",
            borderRadius: 6,
            padding: "2px 8px",
            fontSize: 12,
            lineHeight: 1.4,
            cursor: "pointer",
          },
        },
        t("ocHeaderBtn"),
      );
    }

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

      // 组织架构图：注册为 DSH 右侧边栏（sidebar.right）的常驻 tab，不是浮动窗口。
      // 右栏服务在部分宿主/测试环境可能不存在，因此用可选 inject，缺失时静默降级。
      let orgmapAutoOpened = false;

      // 宿主启动时可能还没有挂载会话，openTab 会失败；失败则退避重试几次，
      // 之后用户随时可用会话头部的「组织架构」按钮手动打开。
      function scheduleOrgMapAutoOpen(attempt) {
        if (orgmapAutoOpened) return;
        if (openOrgMapTab()) { orgmapAutoOpened = true; return; }
        if (attempt >= 5) return;
        const timer = setTimeout(function () { scheduleOrgMapAutoOpen(attempt + 1); }, 2000);
        if (timer && typeof timer.unref === "function") timer.unref();
      }

      function openOrgMapTab() {
        try {
          const side = ctx.get("sidebarRight");
          if (!side || typeof side.openTab !== "function") return false;
          side.openTab(ORGMAP_TAB_KIND);
          return true;
        } catch (err) {
          reportError("打开组织架构图 tab", err);
          return false;
        }
      }

      function wireOrgChart(sideCtx) {
        const c = sideCtx || ctx;
        try {
          c.effect(
            () =>
              c.sidebarRightTabs.register({
                id: ORGMAP_TAB_ID,
                kind: ORGMAP_TAB_KIND,
                priority: "builtin",
                keepMounted: false,
                title: () => t("ocTitle"),
              }),
            NS + ": orgmap tab type",
          );
        } catch (err) {
          reportError("注册组织架构图 tab 类型", err);
        }
        try {
          c.effect(
            () =>
              c.slots.inject("sidebar.right.pane.tab", () =>
                c.slots.register(
                  {
                    name: "sidebar.right.pane.tab",
                    key: ORGMAP_TAB_ID,
                    locale: NS,
                    inject: () => ({ t: t, reportError: reportError }),
                  },
                  OrgChartTabBody,
                ),
              ),
            NS + ": orgmap tab body",
          );
        } catch (err) {
          reportError("注册组织架构图 tab 正文", err);
        }
        try {
          c.slots.inject("conversation.session.header.actions", () =>
            c.slots.register(
              {
                name: "conversation.session.header.actions",
                id: NS + "-orgmap",
                order: 40,
                locale: NS,
                inject: () => ({ t: t, open: openOrgMapTab, reportError: reportError }),
              },
              OrgMapAction,
            ),
          );
        } catch (err) {
          reportError("注册组织架构图入口按钮", err);
        }
        scheduleOrgMapAutoOpen(0);
      }

      if (typeof ctx.inject === "function") {
        try {
          ctx.inject(["sidebarRightTabs", "sidebarRight"], (sideCtx) => wireOrgChart(sideCtx));
        } catch (err) {
          reportError("接入右侧边栏", err);
        }
      }
    };

    // 暴露内部组件以便离线测试（不影响插件运行）
    exports.Panel = Panel;
    exports.__internals = {
      Panel: Panel,
      MemberRow: MemberRow,
      MemberTable: MemberTable,
      EditForm: EditForm,
      SkillPicker: SkillPicker,
      ModelPicker: ModelPicker,
      WorkflowPanel: WorkflowPanel,
      MaintainPanel: MaintainPanel,
      GroupBriefForm: GroupBriefForm,
      OrgChartOverlay: createOrgChartOverlay,
      orgmapFormatTokens: orgmapFormatTokens,
      orgmapShorten: orgmapShorten,
      ORGMAP_VERSION: ORGMAP_VERSION,
      ORGMAP_CARD_W: ORGMAP_CARD_W,
    };

    return module.exports;
  },
});
