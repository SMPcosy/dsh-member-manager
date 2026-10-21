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
 *   GET  /api/dsh-member-manager/state   → 组织架构视图
 *   POST /api/dsh-member-manager/op      → { op, args } 统一写入口
 *   GET  /api/dsh-member-manager/health  → 元信息
 */

window.__ModuleLoader__.load({
  id: "dsh-member-manager",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const { createElement: h, useCallback, useEffect, useMemo, useRef, useState } = require("react");

    const NS = "dsh-member-manager";
    const API = "/api/dsh-member-manager";

    const zh = {
      title: "成员管理",
      subtitle: "DSH 原生成员不可改名、不可删除；这里维护的是独立的组织架构覆盖层。",
      refresh: "刷新",
      sync: "同步核心成员",
      syncing: "同步中…",
      tabOrg: "部门架构",
      empty: "还没有成员。点「同步核心成员」把当前团队成员登记进来。",
      emptyGroup: "（空小组）",
      ungrouped: "未分组",
      unregisteredHint: "以下成员存在于 DSH 核心，但还没登记进名册：",
      register: "登记",
      registerAll: "全部登记",
      actions: "操作",
      coreUnavailable:
        "尚未同步到核心成员列表：在对话里执行一次 member_list / member_sync 工具即可同步（HTTP 路由拿不到 Agent 凭证）。",
      edit: "编辑",
      retire: "停用",
      restore: "恢复",
      save: "保存",
      cancel: "取消",
      remove: "移除",
      addGroup: "新建部门",
      groupName: "部门名称",
      groupDesc: "部门说明（可选）",
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
      ocTitle: "工作网 · 实时任务",
      ocHeaderBtn: "工作网",
      ocCollapse: "折叠/展开",
      ocDockLeft: "磁吸到左侧",
      ocDockRight: "磁吸到右侧",
      ocRefresh: "立即刷新",
      ocNoWork: "空闲（没有进行中的任务）",
      ocStaff: "员工",
      ocDept: "部门",
      ocTotals: "合计",
      ocActive: "活跃",
      ocSample: "采样",
      ocFail: "数据获取失败：",
      ocUngrouped: "未分组",
      tcTaskLabel: "任务",
      tcNoTasks: "暂无任务",
      ocEmptyTask: "还没有可显示的工作网：公司化运行时未启用，或还没有员工。",
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

      /* ---------- M/P 双通道等级与编号 · 公司架构面板（docs/16 §5） ---------- */
      cpTab: "总架构",
      cpTitle: "总架构",
      cpSubtitle: "部门、员工、等级与编号规则一览（只读）。",
      cpRefresh: "刷新",
      cpUpdated: "更新于 {time}",
      cpLoading: "加载中…",
      cpLoadFailed: "加载失败",
      cpDisabled: "公司化运行时未启用",
      cpDisabledHint: "config.company.enabled=false 或 boot 尚未完成，面板暂无数据。",
      cpDeptCount: "部门",
      cpEmpCount: "员工",
      cpMCount: "管理通道",
      cpPCount: "技术通道",
      cpNumbering: "编号规则",
      cpNumberingLine: "编号规则：员工 {emp} · 部门 {dept}（工号 {empSample} 起 · 部门编号 {deptSample} 起）",
      cpLegend: "等级图例",
      cpChannelM: "管理通道",
      cpChannelP: "技术通道",
      cpDept: "部门",
      cpEmployee: "员工",
      cpCode: "工号",
      cpLevel: "等级",
      cpHeadcount: "编制",
      cpHeadcountValue: "{n}/{cap}",
      cpNoCapacity: "{n}/—",
      cpDeptEmpty: "该部门暂无员工",
      cpEmptyOrg: "暂无部门",
      cpEmptyHint: "还没有部门：用 company_admin 建部门、company_hire 招人后，这里会自动出现。",
      cpNoDept: "未分配部门",
      cpRoleManager: "管理岗",
      cpRoleStaff: "员工岗",
      cpRoleWindow: "窗口岗",
      cpStateIdle: "空闲",
      cpStateWorking: "工作中",
      cpStateCold: "冷备",
      cpStateFired: "已解雇",
      // 总架构页：公司级工单/成本 KPI 与成本归因（用户 m02493 重构）
      cpOrders: "工单数",
      cpDone: "已完成",
      cpTokens: "Token 合计",
      cpRequests: "请求数",
      cpCost: "成本归因",
      cpCostTotal: "合计 {tokens} tokens · {requests} 次请求",
      cpCostRow: "{tokens} tokens · {requests} 请求",
      cpByEmployee: "按员工",
      cpByDepartment: "按部门",
      cpByOrder: "按工单",
      cpNoCost: "暂无成本数据",
      cpTopHint: "按 tokens 取前 5",

      /* ---------- 组织架构图 / 部门弹层 / 新建部门（docs/16 §5 v4） ---------- */
      cpEmployeeCenter: "员工中心",
      cpViewAll: "查看全部",
      cpManagement: "管理层",
      cpMgmtHint: "管理层（只读展示，不影响部门归属）",
      cpMgmtEmpty: "暂无 M 通道员工",
      cpRename: "重命名",
      cpMgmtName: "管理层名称",
      cpEdit: "编辑",
      cpEditNumbering: "编辑编号规则",
      cpEditLevels: "编辑等级通道",
      cpCustomize: "自定义",
      cpAddLevel: "添加等级",
      cpRemoveLevel: "删除",
      cpLevelHint: "等级代号按「通道字母 + 序号」自动生成（M1、M2… / P1、P2…），可增删；仍被员工使用的等级不能删除。",
      cpEmpPattern: "员工编号模板",
      cpDeptPattern: "部门编号模板",
      cpStartAt: "起始序号",
      cpPatternHint: "占位符用法：\n{seq} — 顺序号，自动递增（1、2、3…）\n{seq:N} — 顺序号补零到 N 位，如 {seq:4} → 0001\n{dept} — 部门编号（如 D01；无部门时为空）\n{channel} — 通道字母（M / P）\n{level} — 等级代号（如 M2、P3）\n示例：E{seq:4} → E0001；{dept}-{seq:2} → D01-01",
      cpLevelNameLabel: "等级名称",
      cpChannelLabelLabel: "通道名称",
      cpDeptEdit: "部门编辑",
      cpDeptNameField: "部门名称",
      cpDeptCodeField: "部门编号",
      cpCapacityField: "编制容量",
      cpCharterField: "职责描述",
      cpAcceptsField: "接单范围（逗号分隔）",
      cpBorrowPolicyField: "借调策略（JSON）",
      cpInvalidJson: "JSON 格式不正确",
      cpSaveNumbering: "保存编号规则",
      cpSaveLevels: "保存等级通道",
      cpChannels: "通道",
      cpChannelRequired: "至少保留一个通道",
      cpChannelLocked: "该岗位不可取消 M 通道",
      cpSave: "保存",
      cpSaved: "已保存",
      cpECFilterHint: "按部门筛选员工",
      cpECFilterAll: "全体员工",
      cpECFilterDisabled: "未启用成员",
      cpECEmpty: "该筛选下暂无员工",
      cpNoLeader: "未设负责人",
      cpChartEmpty: "暂无部门，点右上角「新建部门」",
      cpDeptBoxHint: "点击查看部门详情",
      cpNewDept: "新建部门",
      cpNewDeptId: "部门 ID（可选）",
      cpNewDeptName: "部门名称",
      cpNewDeptDesc: "部门说明",
      cpNewDeptCapacity: "编制人数",
      cpNewDeptBrief: "一句话描述（可选）",
      cpParse: "解析",
      cpParseHint: "例：「新建市场部，编制 5 人」；点「解析」自动填写名称与编制",
      cpModalChart: "部门架构图",
      cpModalMembers: "成员详情",
      cpHire: "招聘员工",
      cpPromote: "晋升",
      cpFire: "停用",
      cpMove: "调岗",
      cpMoveTo: "调到部门",
      cpFireConfirm: "确认停用「{name}」？",
      cpOpFailed: "操作失败",
      cpDeleteDept: "删除部门",
      cpDeleteDeptConfirm: "确认删除部门「{name}」（{code}）？删除后不可恢复。",
      cpLeaderTag: "负责人",
      cpAutoId: "留空自动生成",
      cpRole: "角色",
      cpKind: "类型",
      cpCreateDept: "创建",
      cpSelectDept: "选择部门",
      cpNoDeptOpt: "不分配部门",
      cpChannelOpt: "通道（可选）",
      cpLevelOpt: "等级（可选，如 M2 / P3）",
      /* ---------- 人事管理详情页（v5.4） ---------- */
      cpHr: "人事管理",
      cpHrRoster: "名册资料",
      cpHrNoRoster: "未关联名册成员（公司化员工没有对应的名册条目）",
      cpHrTarget: "名册 target",
      cpHrActions: "人事操作",
      cpHrPolicy: "会话策略",
      cpHrAliases: "别名（逗号分隔）",
      cpDutiesMax: "最多 8 条（自动按条目保存）",
      cpAddDuty: "添加一条",
      cpRemoveDuty: "删除",
      cpHrModel: "模型覆盖",
      cpHrStatus: "状态",
      cpMainChannel: "通道说明",
      cpHrSave: "保存名册资料",
      cpProfile: "公司化资料",
      cpSaveProfile: "保存公司化资料",
      cpKindPermanent: "常驻成员 · 独立会话",
      cpKindTemp: "临时成员 · 临时会话",
      cpKindShared: "共享成员 · 共享池",
      cpClose: "关闭",
      dpModalHint: "查看与修改成员：部门架构图与成员详情",
    };

    const en = {
      title: "Member Manager",
      subtitle: "DSH members cannot be renamed or removed natively; this maintains a separate org overlay.",
      refresh: "Refresh",
      sync: "Register core members",
      syncing: "Syncing…",
      tabOrg: "Department org",
      empty: "No members yet. Click “Register core members” to import the current team.",
      emptyGroup: "(empty group)",
      ungrouped: "Ungrouped",
      unregisteredHint: "These members exist in DSH core but are not in the registry yet:",
      register: "Register",
      registerAll: "Register all",
      actions: "Actions",
      coreUnavailable: "Core roster not synced yet: run the member_list / member_sync tool once so the host can cache it.",
      edit: "Edit",
      retire: "Retire",
      restore: "Restore",
      save: "Save",
      cancel: "Cancel",
      remove: "Remove",
      addGroup: "New department",
      groupName: "Department name",
      groupDesc: "Department description (optional)",
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
      ocTitle: "Work network · live tasks",
      ocHeaderBtn: "Work net",
      ocCollapse: "Collapse / expand",
      ocDockLeft: "Dock to left",
      ocDockRight: "Dock to right",
      ocRefresh: "Refresh now",
      ocNoWork: "Idle (no active task)",
      ocStaff: "Staff",
      ocDept: "Departments",
      ocTotals: "Total",
      ocActive: "Active",
      ocSample: "Sampled",
      ocFail: "Failed to load: ",
      ocUngrouped: "Ungrouped",
      tcTaskLabel: "Task",
      tcNoTasks: "No tasks",
      ocEmptyTask: "Nothing to show yet: the company runtime is off, or it has no employees.",
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

      /* ---------- M/P dual-track levels & numbering · company org panel (docs/16 §5) ---------- */
      cpTab: "Overall arch",
      cpTitle: "Overall architecture",
      cpSubtitle: "Departments, employees, levels and numbering at a glance (read-only).",
      cpRefresh: "Refresh",
      cpUpdated: "Updated at {time}",
      cpLoading: "Loading…",
      cpLoadFailed: "Failed to load",
      cpDisabled: "Company runtime is not enabled",
      cpDisabledHint: "config.company.enabled=false or boot has not finished, so there is nothing to show yet.",
      cpDeptCount: "Departments",
      cpEmpCount: "Employees",
      cpMCount: "Management",
      cpPCount: "Professional",
      cpNumbering: "Numbering",
      cpNumberingLine: "Numbering: employee {emp} · department {dept} (employee IDs from {empSample}, department codes from {deptSample})",
      cpLegend: "Level legend",
      cpChannelM: "Management track",
      cpChannelP: "Professional track",
      cpDept: "Department",
      cpEmployee: "Employee",
      cpCode: "Employee ID",
      cpLevel: "Level",
      cpHeadcount: "Headcount",
      cpHeadcountValue: "{n}/{cap}",
      cpNoCapacity: "{n}/—",
      cpDeptEmpty: "No employees in this department",
      cpEmptyOrg: "No departments yet",
      cpEmptyHint: "No departments yet: create one with company_admin and hire with company_hire, then this view fills in automatically.",
      cpNoDept: "No department",
      cpRoleManager: "Manager",
      cpRoleStaff: "Staff",
      cpRoleWindow: "Window",
      cpStateIdle: "Idle",
      cpStateWorking: "Working",
      cpStateCold: "Cold",
      cpStateFired: "Fired",
      // Overall architecture: company-wide order/cost KPIs and cost attribution (user m02493 refactor)
      cpOrders: "Orders",
      cpDone: "Done",
      cpTokens: "Total tokens",
      cpRequests: "Requests",
      cpCost: "Cost attribution",
      cpCostTotal: "Total {tokens} tokens · {requests} requests",
      cpCostRow: "{tokens} tokens · {requests} requests",
      cpByEmployee: "By employee",
      cpByDepartment: "By department",
      cpByOrder: "By order",
      cpNoCost: "No cost data yet",
      cpTopHint: "Top 5 by tokens",

      /* ---------- Org chart / department modal / new department (docs/16 §5 v4) ---------- */
      cpEmployeeCenter: "Employee center",
      cpViewAll: "View all",
      cpManagement: "Management",
      cpMgmtHint: "Management (read-only, does not change department membership)",
      cpMgmtEmpty: "No M-channel employees",
      cpRename: "Rename",
      cpMgmtName: "Management name",
      cpEdit: "Edit",
      cpEditNumbering: "Edit numbering",
      cpEditLevels: "Edit levels",
      cpCustomize: "Customize",
      cpAddLevel: "Add level",
      cpRemoveLevel: "Remove",
      cpLevelHint: "Level codes are auto-generated as <channel letter><number> (M1, M2… / P1, P2…). Levels can be added or removed; levels in use by employees cannot be deleted.",
      cpEmpPattern: "Employee ID pattern",
      cpDeptPattern: "Department code pattern",
      cpStartAt: "Start at",
      cpPatternHint: "Placeholder usage:\n{seq} — sequential number, auto-increment (1, 2, 3…)\n{seq:N} — zero-padded to N digits, e.g. {seq:4} → 0001\n{dept} — department code (e.g. D01; empty when unassigned)\n{channel} — channel letter (M / P)\n{level} — level code (e.g. M2, P3)\nExamples: E{seq:4} → E0001; {dept}-{seq:2} → D01-01",
      cpLevelNameLabel: "Level name",
      cpChannelLabelLabel: "Channel label",
      cpDeptEdit: "Edit department",
      cpDeptNameField: "Department name",
      cpDeptCodeField: "Department code",
      cpCapacityField: "Headcount capacity",
      cpCharterField: "Charter",
      cpAcceptsField: "Accepts (comma separated)",
      cpBorrowPolicyField: "Borrow policy (JSON)",
      cpInvalidJson: "Invalid JSON",
      cpSaveNumbering: "Save numbering",
      cpSaveLevels: "Save levels",
      cpChannels: "Channels",
      cpChannelRequired: "At least one channel is required",
      cpChannelLocked: "This role cannot drop the M channel",
      cpSave: "Save",
      cpSaved: "Saved",
      cpECFilterHint: "Filter employees by department",
      cpECFilterAll: "All employees",
      cpECFilterDisabled: "Disabled members",
      cpECEmpty: "No employees in this filter",
      cpNoLeader: "No leader",
      cpChartEmpty: "No departments yet. Use “New department”.",
      cpDeptBoxHint: "Click to view department",
      cpNewDept: "New department",
      cpNewDeptId: "Department ID (optional)",
      cpNewDeptName: "Department name",
      cpNewDeptDesc: "Department description",
      cpNewDeptCapacity: "Headcount capacity",
      cpNewDeptBrief: "One-line description (optional)",
      cpParse: "Parse",
      cpParseHint: "e.g. “New marketing department, 5 people”; click Parse to fill name and capacity",
      cpModalChart: "Department chart",
      cpModalMembers: "Member details",
      cpHire: "Hire employee",
      cpPromote: "Promote",
      cpFire: "Disable",
      cpMove: "Transfer",
      cpMoveTo: "Move to",
      cpFireConfirm: "Disable “{name}”?",
      cpOpFailed: "Operation failed",
      cpDeleteDept: "Delete department",
      cpDeleteDeptConfirm: "Delete department “{name}” ({code})? This cannot be undone.",
      cpLeaderTag: "Leader",
      cpAutoId: "Leave blank to auto-generate",
      cpRole: "Role",
      cpKind: "Type",
      cpCreateDept: "Create",
      cpSelectDept: "Select department",
      cpNoDeptOpt: "No department",
      cpChannelOpt: "Track (optional)",
      cpLevelOpt: "Level (optional, e.g. M2 / P3)",
      /* ---------- HR detail page (v5.4) ---------- */
      cpHr: "HR management",
      cpHrRoster: "Roster record",
      cpHrNoRoster: "No linked roster member (this company employee has no roster entry)",
      cpHrTarget: "Roster target",
      cpHrActions: "HR actions",
      cpHrPolicy: "Session policy",
      cpHrAliases: "Aliases (comma separated)",
      cpDutiesMax: "up to 8 entries (saved as items)",
      cpAddDuty: "Add entry",
      cpRemoveDuty: "Remove",
      cpHrModel: "Model override",
      cpHrStatus: "Status",
      cpMainChannel: "Channels",
      cpHrSave: "Save roster record",
      cpProfile: "Company profile",
      cpSaveProfile: "Save profile",
      cpKindPermanent: "Permanent member · dedicated session",
      cpKindTemp: "Temporary member · temp session",
      cpKindShared: "Shared member · shared pool",
      cpClose: "Close",
      dpModalHint: "View and edit members: department chart and member details",
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
        zIndex: 2147483600,
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
      const [tab, setTab] = useState("company");
      const [draft, setDraft] = useState(null);

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

      const ungrouped = state.ungrouped || [];

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
          ),
          h(
            "div",
            { style: S.actions },
            h("button", { style: S.btn, disabled: busy, onClick: load }, t("refresh")),
            h("button", { style: S.btnPrimary, disabled: busy, onClick: () => run("registerLive") }, busy ? t("syncing") : t("sync")),
          ),
        ),

        error ? h("div", { style: S.err }, t("error") + "：" + error) : null,
        !state.coreAvailable ? h("div", { style: S.hint }, t("coreUnavailable")) : null,
        state.warnings && state.warnings.length ? h("div", { style: S.hint }, state.warnings.join("；")) : null,

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

        // 页签：分段控件，放在内容正上方。顺序 = 总架构 → 员工中心 → 工作流 → 备份与更新
        h(
          "div",
          { style: S.tabs },
          tabBtn("company", t("cpTab"), ""),
          tabBtn("employees", t("cpEmployeeCenter"), ""),
          tabBtn("workflow", t("tabWorkflow"), ""),
          tabBtn("maintain", t("tabMaintain"), ""),
        ),

        tab === "company"
          ? h(CompanyOrgPanel, {
              t: t,
            })
          : null,
        tab === "employees" ? h(EmployeeCenterPanel, { t: t }) : null,
        tab === "workflow" ? h(WorkflowPanel, { t: t }) : null,
        tab === "maintain" ? h(MaintainPanel, { t: t }) : null,

      );
    }

    // 侧边栏入口图标：与插件列表共用同一张三人图标（内联 data URI，随位置缩放）
    const SIDEBAR_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAPJ0lEQVR42u1ba5BcxXX+Tnffe+fOrF68AgiqILy1gIMdA+XETik4MYkJpIJnnEqlSOFUkJVgU3oiIa3uXHb1XD1QAKVWcZIqF07CLK5yuUjMI3EskiIF2MZlWBESxwZbCIyF0Eq7M/fRfU5+zKy0SNrdGWmB/NhTNX9mt2+fc+55fOfrHmBGZmRGZmRGZuQ0RUhECAB9AJu19hL6cE0WoSiKTBRFavz35XJZ12o1Pc3OoFqtpsvlsj6ZDi3nf3BSLtfeo0h/f39p48Zd83bu3BmM//5455yKHP+MWq3mRzt2zF3W31+aTKe2Pdu58WU9ODjoomjrWQj0HWzd77HwpSJSUKSGlVIvGeN9fd8ZwaO7Fy3Ky+WaHhysuFN19OBgxQ0MDHhvvpP8ITv7B8x8DQvPIVCilP6xVupxKbi/i5cvPzCm2/vmgHKtpgcrFbc22vLH2ve2aG3OY2fhnIOIgEjBGAMignP2xTRNFm/qve+5sXWd7FWr1XSlUnGrejbc4BfCXUbpj4oIrLUQYRARtNZQ2sA5+6bL8pV98cpHxtZNuwPGvLumuuVLQaHwl3mWwVpriYhE0CpKJIAIBBIUCoaFR0jcZ+OeFc9EUaTiOOZ2wz6OY14T9X9Ke+qfFOmuNEksCATQ0b2IICIi2hjj+z7SJPny+urKBzuJBN2J8T3rt/6WMd7fp0nimAVEpAEoIlBTQESkiEhZ66xWqiCCW3/9ps98rXfd6iMA1J49e2Qq46vVquTe7Pka+A4Rzc2yzJIi03z2sb2ae5NiFnbWsu8Hn114083PPvzg9h+Vy2W9d+9emcq2torUggUL5K67BjyXuW3C0gr3ydcSweR5nvt+cCZZVyUi6e7unjLiuru7iYiErKv6QXBmnuc5EZkp9lIiTb3SLN1218CAV6vV2oo21U7ex3HMZ583vND3g2uyLHWtNz91fhFMkiQCQXnDhgfPrFQqbrKWJSJUqVRctO2vzxDgc0maCBFMe3uRzrLU+X5wzdn7hxcSkZRrU3eGKR++YGiImlCHFmqtpZnnbZcYYmb2A39O6rKPA3hicHBQRVEkANTevd2yYMGQdHd309DQEO3evZsA5NwYucH3vNlpmgoRqU4wktZaMpKFAJ4a0/20HDCuWl5waoBDnNaGnNgroyh6amhoSMdxnAHgiWqAiFxaKJZUmmYZAL9TgAahC1vpJNPnADolZCdESkGEwLKv1QWyqG/b9Sy4VRxfLSJdpOig0eoFZdTj61YteWXjxl2PjIwc+Y0wLNyeJIlrt1iPS4e2dW3bASz8cxCkQwew7/s6TZO711dXPrY66l/geXozs9zi+z5YMwQCIoIiKmdZ1hv1PfDVQ4cOr9i8edXn1t6/9eEgKPx5kjTarjsgiIDfAoChNlJAtVGVpRla+PdOhhARcYVCqHNrd6yvrnz4vrj/d3zPPGu0ucXaXOr1uk2ShsvSxCWNhqvXG9Y5Fxij/yzo8r+7Otp6Zd+65X+RZ+mThUJBi4hreygjeqbdFKB2wVIURWFOxZeMNhfnuZXJ2qAI2PMMOed+dM684JpfDPNFRO55As3OstwqNWFbExHkYRj6eZYN1YtyQ9eIPZuV2csiBRGZUOexPa21r3mYe3UcL2qM/el0cYDUajUVx3Hd80yP5wdEBCctbSaywxiPRGTLPffckzLn2z3jT2V8K33hNxr1PAgL3cVE3RvHq19jka8FhQKJwE3gNSGC8/yAPN+sjeNF9VqtpqYyvkMo3BxM1sRbtxeL4ZLRkRFpKaTGF0gRYaUUBGjko3J+MMu/gOCGrHUyFXga/za1ViQiB8+YpS8cSfXVzrn/bEWeHvd/AoCJoEtdXVSvN3asj5Yv7WQAa7vHDg5WuFwu6/XR8qVJvR4bz3OlUsn4ga+01qS0Jq01BUFBz5k7TytF3+vvv/eIAv+u7wc0UdubCNk568Tz/DMPHLKfuOrS879vnXOlrpIZv5cf+KpUKhnjeS6p1+Om8WU9OFhpey/VASGhxgaM3mhFlYLCfJvnG4T5OWbez+zeFubXmd2ToyNHFp8959xbARCLXDVptkyCoZRSQgqXVSoVZ7S+O8vzfxHmnzC7t5l5vzA/l+XpBgoK83ujFdXmixp0zfBvr1ibdiezMRjb07v9akVytR0dmatIvcPgbwM0n0AGJA3H9jU/KBYPHHr7OgB7CJjTdIBQp/QDEREEcwCQc/awp4Nnmeh/SWgWwNaxe4NEDooduX1d79ZDLPRyb8/Sl4nIjdf9lB1QLtd0HFdcFEVF8uctXte7/Q5hd40OAvJ93Zr7HZxzQKufEyl0lUp4N02eAPCMEN5SSnUIoY+1BAL2ARAI7SwE4S81mI+qrrWG1hoiAscOLk1lXe/2l6rrH/iqZO/+VRzH9am4CDMVIbEy2nQjvOArWutuZoaIIGk03HEGqVbuigicY6dYZH6zCtMLx/BDJxEgOs8zYVIv3rtpYA6Sw4Ujh4cdN8NJEUGybHyVFyIiTUTXaq23Wm/unat6NvzppkrluclIEpqU/OjdcrMh7zEApTRNbWsen6puCAAopZwoXD7Lm33wSDL8Gik1m60D2ugEIuJ8P1DW5i+ur678WE/fttuNNo+lScMBkyNCEbCIcFAIjAiPiMMtvdGyPRORJOpkOT84OOjW3r/xOg3zmGNXyrLUKUWmzTZGInBBUDDi+IurVi0aFuCBsBAqgdj25gdibTQZz+sFAM7dYoignVpKBKUUmSxNHbN0kabH196/8SNNHvNEkvakBg0MDHjs1N8orUquSXt1OIyITpKGaGUW927ZecmG6sq40Rj9Tqk0yxeRXOSkLVGacFe41DXLS5PkoXjNkm/c17PlNs/3b0rT9nmIMX7AWWuVUl3C+isDAwPelG0wiiITxzHvP9D4fCEMr0sbiZ2KjZmEB3BE1JUlee2+vu3n5QH/fpol3+zqmuUFQaCOH9iUUhSGRR0UQt1o1B9YX135pahv+0e1r3c7Z/NToryJTJoktlAIf3X/z0c+H8cxR1FkJosABgCX519gx4JTG4EhIs4YY5RSZLQ5H87euHnVquHenmW3pVleEZF/JaLhVrgDRAzgF47d19nmn+xbt3xJq5r8tlY6NMbziEgLC5+KH5xz4sBfGG/jCUVwrGdG0UPnWqq/SqDZLCydUudjU6C1+RtK0YZ47bJdref7KMy5AADY0WUEXCvsLgGUASghLa+IxQ+VH/7MWCc9PXe/3ly3Yy6MLHfMX9ZGz8o6TIUWJ0GAHDZSvCKO735rPD44Gg5797YISy+9SImebXPL7WL3cda7MCxq6+ygmqXvipcsORT1bbteBHc65t/k1F5ktPa1UsjzDMxiAQdASIvWxnhw+SgSkXpP3P8qafUkNAbi1UvXro62PqKYHykUwo91xA8AxMxsPDMblF4E4K2jto5PgQULmuSBYzlHa91sKJ2++bCo8zzbff/apRUcOmSjvu1/K4LnjOd9USl1OQG+tRZpmnKTWSbT7C6kmVnSNGXnHCBSVFpf5xl/FVseWte3vXdjvPy/yB7+lLX5t4O2+YFj2mmt4VjOGW/rSbuAsMxRpDrO+TAs6ixLH+1dt3zR6mjrleLNft543p15nkuj3rB5bnlshD4WWU0qe9worMbaQZblXK/XrbO26Hv+2rXV/ieA8/GOO3Kbze3Lvh9okfZrgiIFYZnTRhsk7sx4sDFGZXm6z/p28aaBgTlG4Rtam6vqo6N56xBjDENQ+wUcqkWJy+joaBYWi5+x6vA/7IrjEa3Vn4hwSkqhnZl/MttO+/R2jPwAsGLT6tXvHnnz8C4/CK5IGo2ciLzpOBongj8yciQPC+Gt91U3r4jXLv2+dfxgWAjVRCTJdI/Dk1Bfvs6y7NW+dSv+cU3v1k94nvdHjUbdTZPx75lbkjRhAkVRtPUsT2RbkjYSpUh3FgXTGwHseR4UoQYAkrt7lCJpMTXTKkREzjouFMISK9wRxyvfEifP+H5AndSC6XaAss4C4KebUFM+neU5AaLxPgiRkHNWBHI7AJDWTyulcCqj9oQOaIEf20JMMknlF6VIZWmW5A1+ef+BI5dobc5g5zo6mOgs5YiccyQil5XLNa0Mfa/JRUz5IhmAJXWio05YSFr5YVg0xhgPIBIRJwILwB2PDVpn1I1Nm5Jhy3yB8QwmGHSmKQJA3CRE5i644afzxOFgM/pPoL+kORbDMgsrpbxCGBph9iZ0QLVadU2b5N9GRo7sYJEfECEPw6IOw9B4nq+V0jTW9wFYaUVKudz9Id3YEnVUFzn6YSIiz/NUGIYmDENFivaNjBzZboSfBkAtW6emxe/f/MBlLpdfY3Y3CvArInwFgeZ6vg9C84pKfXQU/733BXP5tR9f6Gv/6SRJO4fQHeF6IgD5GbPmnXtodPjiQrH4XZvnTaADgXMO1to6Ef1YEf0HafWtUBX3rFq1aLgtRkhEqFqt6jiOTyAv+vt3ndOw+fwszy4joYsYOAfC4frqirt71m/7tCHz1AfiAEJmil0XIq/PFUdbrHUHFNG7pOh/oPTrytAr1Xvv+RnRsZyPosjE1aoDvbcOUBtX1BQAxHHsJiuKa3q33ewp/a00/SAiQNJCqXRFz4rmxDgZrwkAlXKZjze8LVa4NTLycdFB42tHd3e3qlQqGT4kuWtgwDtv/34Zf5g7NDQkcRxLO7fFTIdgRFpRwMd7+cOS8/bvd+3ePns/gND4KVIAOKLpR4EnYZ3ddD1sGnNV+b7vawB6DDu0MIFMo9EWABljigBPi+7mdB8wNDQkAOAZ9ZMkSZ4noo8UCmEAANZaOGfBTS6Px9exY5cr38uotyCviBwtWkopUsbztNFGp2ni2Mmj1pd3RISI6LQcPO0Aprd35yWp5J+E4FMicj1ILjbGK2ptjhIgzNwcJZmb2JJaZ0gEKKVASkGRGrtyi9zaEQJ+oMj8M0O+2bdu6dC0ocvpBOpojgAyvmts3rzzwtThCud4AYN/WZgvAHA+gBIEZwEwQs3FAiQEHCTQ2yDaRwp7lfZ+ODvwh5YtW/zG8QTu/4sUGD+qjccO3d3d0jql/Wnr8/QJOOOhh7rCEU83wkRwkBVQzOJ4UX2iHaIo0gB4uozHB/ALD4qiiMYuQrbYZ2ldYJDJANjYmnF9/X0ZsujD/6nNe6fLaeoaMzIjMzIjMzIjbcj/ASpulw/vEHAJAAAAAElFTkSuQmCC";

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

    /* ---------------------------------------------------------------------
       M/P 双通道等级与编号 · 公司架构面板（契约：docs/16 §4.1、§5）
       - 数据源 GET /company/overview：打开拉一次 + 手动刷新（v5.2 起两页均不再自动轮询）
       - 归一化收敛在纯函数 buildCompanyOrgView，组件只做渲染（可离线单测）
       - 对旧宿主缺失字段（code/channel/level/levels/numbering）逐项兜底
       - 所有动态文本走文本节点，不拼 innerHTML
       --------------------------------------------------------------------- */


    // 通道配色：M 线琥珀、P 线蓝，与既有中性配色区分开
    const CP_COLORS = {
      M: { fg: "#8a5a00", bg: "rgba(210,158,42,.16)", border: "rgba(210,158,42,.45)" },
      P: { fg: "#1f4fb8", bg: "rgba(47,111,235,.12)", border: "rgba(47,111,235,.40)" },
    };

    const CP_STATE_COLORS = {
      working: "#1a7f37",
      idle: "#8b95a3",
      cold: "#c9a227",
      fired: "#c0392b",
    };

    // 宿主没回 levels 时的兜底目录（与 docs/16 §1.1 DEFAULT_LEVELS 对齐），
    // 保证图例不空白；真实等级仍以接口返回为准。
    const CP_FALLBACK_LEVELS = {
      M: {
        label: "管理通道",
        levels: [
          { code: "M1", name: "主管" },
          { code: "M2", name: "经理" },
          { code: "M3", name: "高级经理" },
          { code: "M4", name: "总监" },
          { code: "M5", name: "副总裁" },
        ],
      },
      P: {
        label: "技术通道",
        levels: [
          { code: "P1", name: "初级工程师" },
          { code: "P2", name: "工程师" },
          { code: "P3", name: "高级工程师" },
          { code: "P4", name: "资深工程师" },
          { code: "P5", name: "技术专家" },
          { code: "P6", name: "首席专家" },
        ],
      },
    };

    const CP_STYLE = {
      toolbar: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 },
      toolbarTitle: { fontWeight: 600, fontSize: 13.5, marginRight: 2 },
      toolbarSpacer: { marginLeft: "auto", display: "flex", gap: 8 },
      sub: { fontSize: 11.5, opacity: 0.62 },
      stats: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, maxWidth: 660, marginBottom: 12 },
      stat: { minWidth: 0, padding: "7px 10px", borderRadius: 8, border: "1px solid rgba(127,127,127,.18)", background: "rgba(127,127,127,.025)" },
      statLabel: { fontSize: 10.5, opacity: 0.65, lineHeight: 1.4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
      statNum: { fontSize: 15.5, fontWeight: 650, lineHeight: 1.2, fontVariantNumeric: "tabular-nums" },
      metaCard: { maxWidth: 660, padding: "9px 12px", marginBottom: 12, borderRadius: 10, border: "1px solid rgba(127,127,127,.18)", background: "rgba(127,127,127,.02)", display: "flex", flexDirection: "column", gap: 7 },
      metaRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 },
      metaLabel: { flex: "0 0 auto", fontSize: 10.5, fontWeight: 600, opacity: 0.6, minWidth: 52 },
      metaText: { fontSize: 11, opacity: 0.72, lineHeight: 1.5 },
      numbering: { fontSize: 11, opacity: 0.72, lineHeight: 1.5 },
      legendWrap: { display: "flex", gap: 12, rowGap: 6, flexWrap: "wrap", minWidth: 0 },
      legendGroup: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
      legendTitle: { fontSize: 10.5, fontWeight: 600, opacity: 0.6, marginRight: 2 },
      deptCard: { border: "1px solid rgba(127,127,127,.22)", borderRadius: 10, marginBottom: 12, overflow: "hidden" },
      deptHead: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 13px", borderBottom: "1px solid rgba(127,127,127,.14)", background: "rgba(127,127,127,.045)" },
      deptCode: { fontFamily: "ui-monospace, Consolas, monospace", fontSize: 11.5, padding: "1px 7px", borderRadius: 6, background: "rgba(127,127,127,.14)" },
      deptName: { fontWeight: 600, fontSize: 13 },
      deptBody: { padding: "10px 13px" },
      columns: { display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" },
      column: { flex: "1 1 280px", minWidth: 240 },
      columnHead: { display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600, opacity: 0.82, marginBottom: 6 },
      row: { display: "flex", alignItems: "center", gap: 8, padding: "5px 0", flexWrap: "wrap", borderBottom: "1px solid rgba(127,127,127,.08)" },
      code: { fontFamily: "ui-monospace, Consolas, monospace", fontSize: 11.5, minWidth: 54, opacity: 0.85 },
      name: { fontWeight: 600, fontSize: 12.5 },
      role: { fontSize: 11.5, opacity: 0.62 },
      emptyCol: { fontSize: 11.5, opacity: 0.42 },
      dot: { display: "inline-block", width: 8, height: 8, borderRadius: 4, flex: "0 0 auto" },
      emptyHint: { padding: "0 14px 12px", fontSize: 11.5, opacity: 0.6 },
      sectionHead: { display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", fontSize: 12, fontWeight: 600, margin: "4px 0 8px" },
      sectionTotal: { fontSize: 11.5, fontWeight: 400, opacity: 0.66 },
      costCols: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, alignItems: "stretch", marginBottom: 14, maxWidth: 1080 },
      costCol: { minWidth: 0, padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(127,127,127,.20)", background: "rgba(127,127,127,.02)" },
      costColHead: { display: "flex", alignItems: "baseline", gap: 6, fontSize: 11, fontWeight: 600, marginBottom: 5, whiteSpace: "nowrap", overflow: "hidden" },
      costRow: { display: "flex", alignItems: "baseline", gap: 6, padding: "2px 0", borderBottom: "1px solid rgba(127,127,127,.08)" },
      costName: { fontSize: 11.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: "1 1 auto" },
      costNums: { marginLeft: "auto", fontSize: 10.5, opacity: 0.68, whiteSpace: "nowrap", flex: "0 0 auto" },
      // v4 org chart: employee center card + leader nodes + department boxes (flex + borders as connectors)
      // v6 polished chart: framed canvas, centered management node, explicit connector lines
      // (stem -> bus -> branch drops) and equal-width branches.
      chart: { position: "relative", overflowX: "auto", padding: "18px 16px 16px", marginBottom: 12, borderRadius: 14, border: "1px solid rgba(47,111,235,.20)", background: "linear-gradient(180deg, rgba(47,111,235,.06), rgba(127,127,127,.015))" },
      ecCard: { flex: "0 0 320px", maxWidth: 340, border: "1px solid rgba(127,127,127,.28)", borderRadius: 10, padding: "10px 12px", background: "rgba(127,127,127,.035)" },
      ecList: { maxHeight: 360, overflowY: "auto" },
      connectorH: { flex: "0 0 18px", alignSelf: "flex-start", height: 2, marginTop: 18, background: "rgba(127,127,127,.42)" },
      tree: { flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column" },
      leadersRow: { display: "flex", alignItems: "flex-start", gap: 14, borderTop: "2px solid rgba(127,127,127,.42)", overflowX: "auto" },
      branch: { flex: "1 1 0", minWidth: 172, maxWidth: 300, display: "flex", flexDirection: "column", alignItems: "stretch" },
      leaderNode: { display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 11px", borderRadius: 999, border: "1px solid rgba(47,111,235,.34)", background: "rgba(47,111,235,.10)", color: "inherit", whiteSpace: "nowrap", boxShadow: "0 1px 3px rgba(47,111,235,.10)" },
      leaderGhost: { display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 11px", borderRadius: 999, border: "1px dashed rgba(47,111,235,.38)", background: "transparent", fontSize: 11.5, opacity: 0.66, whiteSpace: "nowrap" },
      connectorV: { width: 2, height: 16, background: "rgba(127,127,127,.42)" },
      deptBox: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 5, margin: "0 8px", padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(47,111,235,.26)", background: "rgba(127,127,127,.035)", boxShadow: "0 1px 3px rgba(0,0,0,.06)", color: "inherit", cursor: "pointer", font: "inherit", textAlign: "left" },
      deptBoxName: { fontWeight: 600, fontSize: 13 },
      deptBoxMeta: { fontSize: 11, opacity: 0.7, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" },
      leaderCard: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(127,127,127,.26)", marginBottom: 12 },
      inlineForm: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 0 10px", borderBottom: "1px solid rgba(127,127,127,.10)" },
      inlineField: { display: "flex", alignItems: "center", gap: 6, fontSize: 11.5 },
      mgmtRow: { display: "flex", justifyContent: "center", marginBottom: 0 },
      mgmtNode: { display: "inline-flex", alignItems: "baseline", gap: 8, padding: "8px 18px", borderRadius: 999, border: "1px solid rgba(47,111,235,.42)", background: "linear-gradient(90deg, rgba(47,111,235,.16), rgba(124,58,237,.14))", boxShadow: "0 2px 10px rgba(47,111,235,.14)", color: "inherit", cursor: "pointer", font: "inherit", fontWeight: 700, fontSize: 13.5 },
      chartInner: { minWidth: 640, paddingTop: 2 },
      mgmtStem: { width: 2, height: 18, margin: "0 auto", borderRadius: 2, background: "linear-gradient(180deg, rgba(47,111,235,.55), rgba(47,111,235,.30))" },
      chartBus: { height: 2, borderRadius: 2, background: "linear-gradient(90deg, rgba(47,111,235,.18), rgba(47,111,235,.55), rgba(47,111,235,.18))" },
      branchesRow: { display: "flex", alignItems: "stretch", justifyContent: "center" },
      branchRail: { display: "flex", alignItems: "stretch", height: 2 },
      railArm: { flex: "1 1 0", height: 2, background: "rgba(47,111,235,.45)" },
      railArmHidden: { flex: "1 1 0", height: 2, background: "transparent" },
      branchDrop: { width: 2, height: 12, margin: "0 auto", borderRadius: 2, background: "rgba(47,111,235,.45)" },
      branchStem: { width: 2, height: 12, margin: "0 auto", borderRadius: 2, background: "rgba(47,111,235,.45)" },
      leaderWrap: { display: "flex", justifyContent: "center", alignItems: "center", minHeight: 30, padding: "0 8px" },
      deptMetaRow: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 2 },
      // v5.4 HR detail (expands below the employee row inside the department modal)
      hrPanel: { border: "1px solid rgba(127,127,127,.30)", borderRadius: 8, padding: "8px 10px", margin: "3px 0 8px", background: "rgba(127,127,127,.04)" },
      hrHead: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 },
      hrBlock: { marginTop: 6, paddingTop: 6, borderTop: "1px dashed rgba(127,127,127,.28)" },
      hrLabel: { fontSize: 12, fontWeight: 700, marginBottom: 6 },
      hrGrid: { display: "grid", gridTemplateColumns: "minmax(120px, 190px) minmax(120px, 190px) minmax(0, 1fr)", gap: "6px 14px" },
      hrInfo: { display: "flex", gap: 6, fontSize: 12, alignItems: "baseline" },
      hrInfoLabel: { color: "rgba(127,127,127,.95)", flex: "0 0 auto", minWidth: 68 },
      hrField: { display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 },
      hrFieldLabel: { color: "rgba(127,127,127,.95)" },
    };

    function cpChannelOf(emp) {
      if (!emp || typeof emp !== "object") return "P";
      if (Array.isArray(emp.channels) && emp.channels.length) {
        if (emp.channels.some((item) => item && item.channel === "M")) return "M";
        if (emp.channels.some((item) => item && item.channel === "P")) return "P";
      }
      if (emp.channel === "M" || emp.channel === "P") return emp.channel;
      return emp.role === "manager" ? "M" : "P";
    }

    /**
     * v5 员工通道列表 → [{channel, level, levelName, primary}]，M 在前、P 在后（docs/21 §4.2）。
     * 旧宿主只有 legacy channel/level 时按单通道兜底，永远返回至少 1 项。
     */
    function cpChannelsOf(emp, levels) {
      const out = [];
      if (emp && typeof emp === "object" && Array.isArray(emp.channels)) {
        for (const item of emp.channels) {
          if (!item || typeof item !== "object") continue;
          const channel = item.channel === "M" || item.channel === "P" ? item.channel : null;
          if (!channel || out.some((row) => row.channel === channel)) continue;
          const level = typeof item.level === "string" ? item.level : "";
          const levelName =
            item.levelName != null && item.levelName !== "" ? String(item.levelName) : cpLevelNameOf(levels, channel, level);
          out.push({ channel: channel, level: level, levelName: levelName, primary: item.primary === true });
        }
      }
      if (!out.length) {
        const channel = cpChannelOf(emp);
        const level = typeof emp.level === "string" ? emp.level : "";
        const levelName = emp.levelName != null && emp.levelName !== "" ? String(emp.levelName) : cpLevelNameOf(levels, channel, level);
        return [{ channel: channel, level: level, levelName: levelName, primary: true }];
      }
      out.sort((a, b) => (a.channel === b.channel ? 0 : a.channel === "M" ? -1 : 1));
      if (!out.some((row) => row.primary)) out[0].primary = true;
      return out;
    }

    /** v5 主通道：含 M 即 M，否则 P（docs/21 §1.2 primaryChannelOf 的客户端镜像）。 */
    function cpPrimaryChannel(emp) {
      const list = cpChannelsOf(emp);
      const primary = list.find((row) => row.primary);
      return (primary || list[0] || { channel: "P" }).channel;
    }

    function cpChipStyle(channel, small) {
      const c = CP_COLORS[channel] || CP_COLORS.P;
      return {
        display: "inline-flex",
        alignItems: "baseline",
        gap: 5,
        padding: small ? "0 7px" : "1px 8px",
        borderRadius: 10,
        fontSize: 11,
        lineHeight: "17px",
        background: c.bg,
        color: c.fg,
        border: "1px solid " + c.border,
      };
    }

    function cpLevelNameOf(levels, channel, code) {
      const list = (levels && levels[channel] && levels[channel].levels) || [];
      for (const lv of list) {
        if (lv && lv.code === code) return lv.name || "";
      }
      return "";
    }

    /** 把 {seq:4} 模板按起始序号渲染成示例值，供「工号 E0001 起」小字使用。 */
    function cpFormatSample(pattern, start) {
      let out = String(pattern == null ? "" : pattern);
      out = out.replace(/\{seq:(\d+)\}/g, function (_m, width) {
        const w = Math.max(1, Math.min(8, parseInt(width, 10) || 1));
        return String(start).padStart(w, "0");
      });
      out = out.replace(/\{seq\}/g, String(start));
      // {dept}/{channel}/{level} 之类示例里无法确定的占位符直接去掉
      return out.replace(/\{(?:dept|channel|level)\}/g, "");
    }

    function cpNormalizeNumbering(raw) {
      const fallback = { employee: { pattern: "E{seq:4}", start: 1 }, department: { pattern: "D{seq:2}", start: 1 } };
      const one = function (key) {
        const src = raw && typeof raw === "object" ? raw[key] : null;
        const pattern = src && typeof src.pattern === "string" && src.pattern ? src.pattern : fallback[key].pattern;
        const start = src && typeof src.start === "number" && src.start > 0 ? Math.floor(src.start) : fallback[key].start;
        return { pattern: pattern, start: start, sample: cpFormatSample(pattern, start) };
      };
      return { employee: one("employee"), department: one("department") };
    }

    function cpNormalizeLevels(raw, employees) {
      const out = {};
      for (const channel of ["M", "P"]) {
        const fromApi = raw && raw[channel] && Array.isArray(raw[channel].levels) ? raw[channel].levels : [];
        const list = [];
        const seen = new Set();
        for (const lv of fromApi) {
          const code = lv && typeof lv.code === "string" ? lv.code : "";
          if (!code || seen.has(code)) continue;
          seen.add(code);
          list.push({ code: code, name: lv.name == null ? "" : String(lv.name) });
        }
        if (!list.length && Array.isArray(employees)) {
          // 兜底：从员工档案收集该通道出现过的等级，保持首次出现顺序
          for (const emp of employees) {
            if (!emp || typeof emp !== "object") continue;
            if (cpChannelOf(emp) !== channel) continue;
            const code = typeof emp.level === "string" ? emp.level : "";
            if (!code || seen.has(code)) continue;
            seen.add(code);
            list.push({ code: code, name: emp.levelName == null ? "" : String(emp.levelName) });
          }
        }
        out[channel] = {
          label: (raw && raw[channel] && typeof raw[channel].label === "string" && raw[channel].label) || CP_FALLBACK_LEVELS[channel].label,
          levels: list.length ? list : CP_FALLBACK_LEVELS[channel].levels.map((lv) => ({ code: lv.code, name: lv.name })),
        };
      }
      return out;
    }

    function cpNum(v) {
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : 0;
    }

    /** 数字展示：千分位分隔，避免大 token 数难读。 */
    function cpNumLabel(v) {
      return cpNum(v).toLocaleString();
    }

    /** 成本桶（{key:{tokens,requests}}）→ 按 tokens 降序的行；labelOf 缺失时用 key 原样。 */
    function cpCostRows(raw, labelOf) {
      const rows = [];
      if (raw && typeof raw === "object") {
        for (const key of Object.keys(raw)) {
          const cell = raw[key];
          if (!cell || typeof cell !== "object") continue;
          const tokens = cpNum(cell.tokens);
          const requests = cpNum(cell.requests);
          if (!tokens && !requests) continue;
          const label = labelOf ? labelOf(key) : "";
          rows.push({ key: String(key), label: label || String(key), tokens: tokens, requests: requests });
        }
      }
      rows.sort(function (a, b) {
        if (b.tokens !== a.tokens) return b.tokens - a.tokens;
        if (b.requests !== a.requests) return b.requests - a.requests;
        return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
      });
      return rows;
    }

    /** 成本归因：总量 + 员工/部门/工单三个维度的降序行；旧宿主没有 costs 时全为 0/空。 */
    function cpNormalizeCosts(raw, departments, employees) {
      const costs = raw && typeof raw === "object" ? raw : {};
      const empById = new Map();
      for (const e of employees) {
        if (e && e.id != null) empById.set(String(e.id), e);
      }
      const deptById = new Map();
      for (const d of departments) {
        if (d && d.id != null) deptById.set(String(d.id), d);
      }
      const empLabel = function (id) {
        const emp = empById.get(String(id));
        if (!emp) return "";
        const name = emp.displayName == null ? "" : String(emp.displayName);
        const code = typeof emp.code === "string" ? emp.code : "";
        return [name, code].filter(Boolean).join(" · ");
      };
      const deptLabel = function (id) {
        const dept = deptById.get(String(id));
        if (!dept) return "";
        const code = typeof dept.code === "string" ? dept.code : "";
        const name = dept.name == null ? "" : String(dept.name);
        return [code, name].filter(Boolean).join(" ");
      };
      const byEmployee = cpCostRows(costs.byEmployee, empLabel);
      const byDepartment = cpCostRows(costs.byDepartment, deptLabel);
      const byOrder = cpCostRows(costs.byOrder, null);
      const tokens = cpNum(costs.tokens) || byEmployee.reduce((n, r) => n + r.tokens, 0);
      const requests = cpNum(costs.requests) || byEmployee.reduce((n, r) => n + r.requests, 0);
      return {
        tokens: tokens,
        requests: requests,
        byEmployee: byEmployee,
        byDepartment: byDepartment,
        byOrder: byOrder,
        hasData: !!(byEmployee.length || byDepartment.length || byOrder.length || tokens || requests),
      };
    }

    /** 工单看板：{orders,done}；旧宿主缺 board 时用 orders 数组长度兜底。 */
    function cpNormalizeBoard(raw, orders) {
      const board = raw && typeof raw === "object" ? raw : {};
      const fallbackOrders = Array.isArray(orders) ? orders.length : 0;
      return { orders: cpNum(board.orders) || fallbackOrders, done: cpNum(board.done) };
    }

    /**
     * v5 管理层虚拟节点（docs/21 §4.1）：优先用 overview.management；缺失时从含 M 通道的员工
     * 聚合兜底。只做展示，不改变公司账本里的部门归属。
     * 排序：部门编号升序（无部门最后）→ M 等级降序 → 工号升序。
     */
    function cpNormalizeManagement(raw, departments, employees, levels) {
      const deptById = new Map();
      const deptByCode = new Map();
      for (const dept of departments) {
        if (!dept || typeof dept !== "object") continue;
        if (dept.id != null) deptById.set(String(dept.id), dept);
        if (dept.code) deptByCode.set(String(dept.code), dept);
      }
      const resolveDept = function (emp) {
        if (!emp || typeof emp !== "object") return null;
        if (emp.department != null && deptById.has(String(emp.department))) return deptById.get(String(emp.department));
        if (emp.departmentCode && deptByCode.has(String(emp.departmentCode))) return deptByCode.get(String(emp.departmentCode));
        return null;
      };
      const rows = [];
      const source = raw && typeof raw === "object" && Array.isArray(raw.employees) ? raw.employees : null;
      if (source) {
        for (const row of source) {
          if (!row || typeof row !== "object") continue;
          const level = typeof row.level === "string" ? row.level : "";
          rows.push({
            id: row.id,
            code: typeof row.code === "string" ? row.code : "",
            displayName: row.displayName == null ? "" : String(row.displayName),
            departmentId: row.departmentId == null || row.departmentId === "" ? null : String(row.departmentId),
            departmentCode: row.departmentCode == null || row.departmentCode === "" ? null : String(row.departmentCode),
            departmentName: row.departmentName == null ? "" : String(row.departmentName),
            level: level,
            levelName: row.levelName != null && row.levelName !== "" ? String(row.levelName) : cpLevelNameOf(levels, "M", level),
            role: row.role == null ? "" : String(row.role),
          });
        }
      } else {
        for (const emp of employees) {
          if (!emp || typeof emp !== "object") continue;
          const m = cpChannelsOf(emp, levels).find((row) => row.channel === "M");
          if (!m) continue;
          const dept = resolveDept(emp);
          rows.push({
            id: emp.id,
            code: typeof emp.code === "string" ? emp.code : "",
            displayName: emp.displayName == null ? "" : String(emp.displayName),
            departmentId: dept && dept.id != null ? String(dept.id) : null,
            departmentCode:
              emp.departmentCode != null && emp.departmentCode !== ""
                ? String(emp.departmentCode)
                : dept && dept.code
                  ? String(dept.code)
                  : null,
            departmentName: dept && dept.name != null ? String(dept.name) : "",
            level: m.level,
            levelName: m.levelName,
            role: emp.role == null ? "" : String(emp.role),
          });
        }
      }
      rows.sort(function (a, b) {
        const ca = a.departmentCode || "";
        const cb = b.departmentCode || "";
        if (!!ca !== !!cb) return ca ? -1 : 1;
        if (ca !== cb) return ca < cb ? -1 : 1;
        const la = cpLevelRank(a.level, "M");
        const lb = cpLevelRank(b.level, "M");
        if (la !== lb) return lb - la;
        const ea = a.code || "";
        const eb = b.code || "";
        return ea < eb ? -1 : ea > eb ? 1 : 0;
      });
      return { channel: "M", employees: rows };
    }

    /** 纯函数：/company/overview 的 data → 面板可渲染视图；缺字段逐项兜底。 */
    function buildCompanyOrgView(overview) {
      const data = overview && typeof overview === "object" ? overview : {};
      const org = data.org && typeof data.org === "object" ? data.org : {};
      const departments = Array.isArray(org.departments) ? org.departments.filter((d) => d && typeof d === "object") : [];
      const employees = Array.isArray(org.employees) ? org.employees.filter((e) => e && typeof e === "object") : [];
      const levels = cpNormalizeLevels(data.levels, employees);
      const numbering = cpNormalizeNumbering(data.numbering);

      const deptById = new Map();
      const deptByCode = new Map();
      for (const dept of departments) {
        if (dept.id != null) deptById.set(String(dept.id), dept);
        if (dept.code) deptByCode.set(String(dept.code), dept);
      }

      const cards = departments.map((dept) => ({ dept: dept, employees: [] }));
      const cardById = new Map();
      for (const card of cards) {
        if (card.dept.id != null) cardById.set(String(card.dept.id), card);
      }
      // 部门解析不到的员工单独成卡（老宿主 department 字段可能为空/失效）
      const orphan = { dept: null, employees: [] };
      for (const emp of employees) {
        let dept = null;
        if (emp.department != null && deptById.has(String(emp.department))) dept = deptById.get(String(emp.department));
        else if (emp.departmentCode && deptByCode.has(String(emp.departmentCode))) dept = deptByCode.get(String(emp.departmentCode));
        const card = dept && dept.id != null ? cardById.get(String(dept.id)) : null;
        (card || orphan).employees.push({ emp: emp, dept: dept });
      }
      const allCards = orphan.employees.length ? cards.concat([orphan]) : cards;

      const counts = { departments: departments.length, employees: employees.length, M: 0, P: 0 };
      const allEmployees = [];
      for (const card of allCards) {
        const raw = card.employees;
        card.byChannel = { M: [], P: [] };
        for (const item of raw) {
          const emp = item && item.emp ? item.emp : item;
          const deptOfEmp = item && item.dept ? item.dept : card.dept;
          const channel = cpChannelOf(emp);
          const chans = cpChannelsOf(emp, levels);
          const level = typeof emp.level === "string" ? emp.level : "";
          card.byChannel[channel].push({
            id: emp.id,
            code: typeof emp.code === "string" ? emp.code : "",
            displayName: emp.displayName == null ? "" : String(emp.displayName),
            department: emp.department == null || emp.department === "" ? null : String(emp.department),
            departmentCode:
              emp.departmentCode != null && emp.departmentCode !== ""
                ? String(emp.departmentCode)
                : (deptOfEmp && deptOfEmp.code ? String(deptOfEmp.code) : null),
            channel: channel,
            channels: chans,
            level: level,
            levelName: emp.levelName != null && emp.levelName !== "" ? String(emp.levelName) : cpLevelNameOf(levels, channel, level),
            role: emp.role == null ? "" : String(emp.role),
            kind: emp.kind == null ? "" : String(emp.kind),
            state: emp.state == null ? "" : String(emp.state),
            // v5.8：公司化档案字段（人事详情页以公司化数据为准读写）
            title: emp.title == null ? "" : String(emp.title),
            duties: Array.isArray(emp.duties) ? emp.duties.map((item) => String(item)) : [],
            skills: Array.isArray(emp.skills) ? emp.skills.map((item) => String(item)) : [],
            model: emp.model == null ? "" : String(emp.model),
            provider: emp.provider == null ? "" : String(emp.provider),
          });
          // v5: 双通道员工在 M/P 两个 KPI 里各计一次
          if (chans.some((row) => row.channel === "M")) counts.M += 1;
          if (chans.some((row) => row.channel === "P")) counts.P += 1;
        }
        // employees 统一换成归一后的行，外部消费不必再区分 byChannel
        card.employees = card.byChannel.M.concat(card.byChannel.P);
        // Chart needs leader + M/P headcounts (docs/16 §5.4)
        card.channelCounts = { M: card.byChannel.M.length, P: card.byChannel.P.length };
        card.leader = cpLeaderOf(card);
        for (const emp of card.employees) allEmployees.push(emp);
      }

      return {
        enabled: data.enabled !== false,
        status: data.status == null ? "" : String(data.status),
        warnings: Array.isArray(data.warnings) ? data.warnings : [],
        levels: levels,
        numbering: numbering,
        cards: allCards,
        employees: allEmployees,
        counts: counts,
        board: cpNormalizeBoard(data.board, data.orders),
        costs: cpNormalizeCosts(data.costs, departments, employees),
        management: cpNormalizeManagement(data.management, departments, employees, levels),
        managementName:
          data.management && typeof data.management === "object" && typeof data.management.name === "string"
            ? data.management.name.trim()
            : "",
      };
    }

    function cpLevelRank(code, channel) {
      const m = typeof code === "string" ? /^([MP])(\d+)$/.exec(code) : null;
      if (!m) return -1;
      if (channel && m[1] !== channel) return -1;
      return parseInt(m[2], 10);
    }

    /** Department leader: among role === "manager", highest M level, tie -> smaller code (docs/16 §5.4). */
    function cpLeaderOf(card) {
      const list = card && Array.isArray(card.employees) ? card.employees : [];
      let best = null;
      let bestRank = -1;
      for (const emp of list) {
        if (!emp || emp.role !== "manager") continue;
        const rank = cpLevelRank(emp.level, "M");
        if (!best) {
          best = emp;
          bestRank = rank;
          continue;
        }
        const code = emp.code || "";
        if (rank > bestRank || (rank === bestRank && code && (!best.code || code < best.code))) {
          best = emp;
          bestRank = rank;
        }
      }
      if (!best) return null;
      return {
        id: best.id,
        code: best.code,
        displayName: best.displayName,
        level: best.level,
        levelName: best.levelName,
      };
    }

    /** Employee center order: department code asc (none last) -> M before P -> level desc -> code asc. */
    function cpCompareEmployee(a, b) {
      const da = a && a.departmentCode ? String(a.departmentCode) : "";
      const db = b && b.departmentCode ? String(b.departmentCode) : "";
      if (!!da !== !!db) return da ? -1 : 1;
      if (da !== db) return da < db ? -1 : 1;
      const ca = cpChannelOf(a) === "M" ? 0 : 1;
      const cb = cpChannelOf(b) === "M" ? 0 : 1;
      if (ca !== cb) return ca - cb;
      const la = cpLevelRank(a && a.level, cpChannelOf(a));
      const lb = cpLevelRank(b && b.level, cpChannelOf(b));
      if (la !== lb) return lb - la;
      const ea = a && a.code ? String(a.code) : "";
      const eb = b && b.code ? String(b.code) : "";
      return ea < eb ? -1 : ea > eb ? 1 : 0;
    }

    /** Department cards order: code asc (none last), then name. */
    function cpCompareDept(a, b) {
      const ca = a && a.dept && a.dept.code ? String(a.dept.code) : "";
      const cb = b && b.dept && b.dept.code ? String(b.dept.code) : "";
      if (!!ca !== !!cb) return ca ? -1 : 1;
      if (ca !== cb) return ca < cb ? -1 : 1;
      const na = a && a.dept && a.dept.name != null ? String(a.dept.name) : "";
      const nb = b && b.dept && b.dept.name != null ? String(b.dept.name) : "";
      return na < nb ? -1 : na > nb ? 1 : 0;
    }

    /**
     * Employee center pure function: filter = "all" (default, includes fired) |
     * "disabled" (state === "fired" only) | department id.
     * Returns {filter,total,allCount,employees}; employees sorted per docs/16 §5.1.
     */
    function buildEmployeeCenter(view, filter) {
      const v = view && typeof view === "object" ? view : {};
      const cards = Array.isArray(v.cards) ? v.cards : [];
      const all = [];
      for (const card of cards) {
        for (const emp of Array.isArray(card.employees) ? card.employees : []) {
          if (emp && typeof emp === "object") all.push(emp);
        }
      }
      let key = filter == null || filter === "" ? "all" : String(filter);
      if (
        key !== "all" &&
        key !== "disabled" &&
        !cards.some((card) => card && card.dept && (String(card.dept.id) === key || String(card.dept.code) === key))
      ) {
        // 过滤目标部门已被删除时回落到全体员工，避免空列表卡住
        key = "all";
      }
      let rows;
      if (key === "disabled") rows = all.filter((emp) => emp.state === "fired");
      else if (key === "all") rows = all.slice();
      else
        rows = all.filter(
          (emp) =>
            (emp.department != null && String(emp.department) === key) ||
            (emp.departmentCode != null && String(emp.departmentCode) === key),
        );
      rows.sort(cpCompareEmployee);
      return { filter: key, total: rows.length, allCount: all.length, employees: rows };
    }

    /** One-line "new department" heuristic parser (client-side only; docs/16 §5.3). */
    function cpParseBrief(text) {
      const raw = text == null ? "" : String(text);
      const out = { name: "", capacity: null, charter: raw.trim() };
      const capMatch = /编制\s*(\d+)/.exec(raw) || /(\d+)\s*人/.exec(raw);
      if (capMatch) {
        const n = parseInt(capMatch[1], 10);
        if (Number.isFinite(n) && n > 0) out.capacity = n;
      }
      const nameMatch = /(?:新建|创建|成立|设立)\s*([^，。；：:部组]+?)(?=部门|部|组|，|。|；|$)/.exec(raw);
      let name = nameMatch ? nameMatch[1].trim() : "";
      if (!name) {
        const first = raw.split(/[，。；;\n]/)[0].trim();
        name = first.slice(0, 20);
      }
      out.name = name;
      return out;
    }

    /** Write-op error text: `{code}: {message}` (business failures included; docs/16 §4.4). */
    function cpErrorText(err) {
      if (!err) return "";
      const code = err.code ? String(err.code) + ": " : "";
      return code + (err.message ? String(err.message) : String(err));
    }

    /**
     * Employee row cells shared by the org chart, employee center and department modal.
     * v5：每个通道一个等级徽章（M 琥珀 / P 蓝，含 levelName），主通道在前（docs/21 §4.2）。
     */
    function cpRenderEmployeeRow(t, emp) {
      const badges = cpChannelsOf(emp)
        .filter((row) => row.level)
        .map((row) =>
          h(
            "span",
            {
              key: "level-" + row.channel,
              style: cpChipStyle(row.channel, true),
              title: t("cpChannels") + " " + row.channel + " " + row.level + (row.levelName ? " " + row.levelName : ""),
            },
            h("span", { style: { fontWeight: 700 } }, row.level),
            row.levelName ? h("span", null, row.levelName) : null,
          ),
        );
      const cells = [
        h("span", { key: "code", style: CP_STYLE.code, title: t("cpCode") }, emp.code || "—"),
        ...badges,
        h("span", { key: "name", style: CP_STYLE.name }, emp.displayName || emp.id || "—"),
        h("span", { key: "role", style: CP_STYLE.role }, cpRoleLabel(t, emp.role)),
        h("span", {
          key: "dot",
          style: Object.assign({}, CP_STYLE.dot, { background: CP_STATE_COLORS[emp.state] || CP_STATE_COLORS.idle }),
          title: cpStateLabel(t, emp.state),
        }),
      ];
      if (emp.state === "fired") cells.push(h("span", { key: "fired", style: CP_STYLE.role }, t("cpStateFired")));
      return cells;
    }

    function cpRoleLabel(t, role) {
      if (role === "manager") return t("cpRoleManager");
      if (role === "window") return t("cpRoleWindow");
      if (role === "staff") return t("cpRoleStaff");
      return role || "";
    }

    function cpStateLabel(t, state) {
      if (state === "working") return t("cpStateWorking");
      if (state === "idle") return t("cpStateIdle");
      if (state === "cold") return t("cpStateCold");
      if (state === "fired") return t("cpStateFired");
      return state || "";
    }

    /**
     * Standalone employee center tab (task-24): lists every company employee with a
     * department / disabled filter. Pulls /company/overview once on open (no auto
     * polling since v5.2); refresh button pulls at once.
     * Reuses buildCompanyOrgView + buildEmployeeCenter; all text via text nodes.
     */
    function EmployeeCenterPanel(props) {
      const t = typeof props.t === "function" ? props.t : (key) => key;
      const [overview, setOverview] = useState(null);
      const [error, setError] = useState(null);
      const [updatedAt, setUpdatedAt] = useState(null);
      const [busy, setBusy] = useState(false);
      const [filter, setFilter] = useState("all");

      const load = useCallback(async () => {
        setBusy(true);
        try {
          const data = await api("/company/overview");
          setOverview(data && typeof data === "object" ? data : {});
          setUpdatedAt(Date.now());
          setError(null);
        } catch (err) {
          setError(err && err.message ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }, []);

      useEffect(() => {
        let alive = true;
        async function pull() {
          if (!alive) return;
          try {
            const data = await api("/company/overview");
            if (!alive) return;
            setOverview(data && typeof data === "object" ? data : {});
            setUpdatedAt(Date.now());
            setError(null);
          } catch (err) {
            if (alive) setError(err && err.message ? err.message : String(err));
          }
        }
        pull();
        return () => {
          alive = false;
        };
      }, []);

      const header = (count, selectNode) =>
        h(
          "div",
          { style: CP_STYLE.toolbar },
          h(
            "div",
            { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } },
            h("span", { style: CP_STYLE.toolbarTitle }, t("cpEmployeeCenter")),
            count == null ? null : h("span", { style: S.countPill }, String(count)),
            h("span", { style: CP_STYLE.toolbarSpacer }),
            selectNode || null,
            h("button", { style: S.btnSm, disabled: busy, onClick: load }, t("cpRefresh")),
          ),
          updatedAt ? h("div", { style: CP_STYLE.sub }, t("cpUpdated", { time: new Date(updatedAt).toLocaleTimeString() })) : null,
        );

      if (!overview) {
        return h(
          "div",
          null,
          header(null),
          error
            ? h("div", { style: S.err }, t("cpLoadFailed") + "：" + error)
            : h("div", { style: S.emptyBox }, t("cpLoading")),
        );
      }

      const view = buildCompanyOrgView(overview);
      const orderedCards = view.cards.slice().sort(cpCompareDept).filter((card) => card.dept);
      const ec = buildEmployeeCenter(view, filter);
      const empKey = (emp, index) => (emp && emp.id != null ? String(emp.id) : "emp-" + index);

      const filterSelect = h(
        "select",
        { style: Object.assign({}, S.selectSm, { width: "auto", minWidth: 150 }), value: filter, onChange: (e) => setFilter(e.target.value) },
        h("option", { value: "all" }, t("cpECFilterAll")),
        orderedCards.map((card) =>
          h("option", { key: String(card.dept.id), value: String(card.dept.id) }, "[" + (card.dept.code || "—") + "] " + (card.dept.name || card.dept.id)),
        ),
        h("option", { value: "disabled" }, t("cpECFilterDisabled")),
      );

      return h(
        "div",
        null,
        header(view.counts.employees, filterSelect),
        error ? h("div", { style: S.err }, t("cpLoadFailed") + "：" + error) : null,
        !view.enabled ? h("div", { style: S.hint }, t("cpDisabled") + "：" + t("cpDisabledHint")) : null,
        view.warnings.length ? h("div", { style: S.hint }, view.warnings.join("；")) : null,
        h(
          "div",
          { style: Object.assign({}, CP_STYLE.ecCard, { flex: "1 1 auto", maxWidth: "none" }) },
          h(
            "div",
            { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 } },
            h("span", { style: S.countPill }, String(ec.total)),
            h("span", { style: CP_STYLE.sub }, t("cpECFilterHint")),
            h("span", { style: { marginLeft: "auto" } }),
          ),
          ec.employees.length
            ? h("div", { style: CP_STYLE.ecList }, ec.employees.map((emp, index) => h("div", { key: empKey(emp, index), style: CP_STYLE.row }, cpRenderEmployeeRow(t, emp))))
            : h("div", { style: S.emptyBox }, t("cpECEmpty")),
        ),
      );
    }

    const CP_MODAL_WIDTH = "min(940px, 92vw)";

    /**
     * Org chart page (docs/16 §5.1, v4): employee center + department leaders + department boxes,
     * KPI / numbering / legend / cost attribution below the chart.
     * Department box opens the modal (§5.2); "New department" opens the dialog (§5.3).
     * All dynamic text goes through text nodes (no innerHTML).
     */
    function CompanyOrgPanel(props) {
      const t = typeof props.t === "function" ? props.t : (key) => key;
      const [overview, setOverview] = useState(null);
      const [error, setError] = useState(null);
      const [busy, setBusy] = useState(false);
      const [updatedAt, setUpdatedAt] = useState(null);
      const [deptModal, setDeptModal] = useState(null);
      const [modalTab, setModalTab] = useState("chart");
      const [newDeptOpen, setNewDeptOpen] = useState(false);
      const [newDeptDraft, setNewDeptDraft] = useState(null);
      const [opError, setOpError] = useState(null);
      const [newDeptError, setNewDeptError] = useState(null);
      const [editor, setEditor] = useState(null);
      const [mgmtOpen, setMgmtOpen] = useState(false);
      const [saved, setSaved] = useState(null);
      const [rosterPicker, setRosterPicker] = useState(null);
      const [modelProviders, setModelProviders] = useState(null);
      // v5.11：架构图/资料区的编辑器状态（管理层重命名、编号规则、等级通道、部门编辑）。
      const [mgmtRename, setMgmtRename] = useState(null);
      const [numberingOpen, setNumberingOpen] = useState(false);
      const [numberingDraft, setNumberingDraft] = useState(null);
      const [levelsOpen, setLevelsOpen] = useState(false);
      const [levelsDraft, setLevelsDraft] = useState(null);
      const [deptEditOpen, setDeptEditOpen] = useState(false);
      const [deptEditDraft, setDeptEditDraft] = useState(null);

      const store = (data) => {
        setOverview(data && typeof data === "object" ? data : {});
        setUpdatedAt(Date.now());
        setError(null);
      };

      const load = useCallback(async () => {
        try {
          store(await api("/company/overview"));
        } catch (err) {
          setError(err && err.message ? err.message : String(err));
        }
      }, []);

      // v5.1: open -> pull once; refreshes are manual (the toolbar button) only.
      useEffect(() => {
        let alive = true;
        async function pull() {
          if (!alive) return;
          try {
            const data = await api("/company/overview");
            if (!alive) return;
            setOverview(data && typeof data === "object" ? data : {});
            setUpdatedAt(Date.now());
            setError(null);
          } catch (err) {
            if (alive) setError(err && err.message ? err.message : String(err));
          }
        }
        pull();
        return () => {
          alive = false;
        };
      }, []);

      // Esc closes the department / management modal; guard test environments without DOM globals.
      useEffect(() => {
        if (deptModal === null && !mgmtOpen) return undefined;
        if (typeof window === "undefined" || typeof window.addEventListener !== "function") return undefined;
        function onKey(e) {
          if (e.key !== "Escape") return;
          if (mgmtOpen) setMgmtOpen(false);
          if (deptModal !== null) setDeptModal(null);
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
      }, [deptModal, mgmtOpen]);

      // Stale department id (deleted / renamed away) -> close the modal.
      useEffect(() => {
        if (deptModal === null || !overview) return undefined;
        const org = overview.org && typeof overview.org === "object" ? overview.org : {};
        const depts = Array.isArray(org.departments) ? org.departments : [];
        if (!depts.some((d) => d && String(d.id) === String(deptModal))) setDeptModal(null);
        return undefined;
      }, [deptModal, overview]);

      // "Saved" confirmation line disappears after 5s.
      useEffect(() => {
        if (saved === null) return undefined;
        if (typeof setTimeout !== "function") return undefined;
        const timer = setTimeout(() => setSaved(null), 5000);
        return () => clearTimeout(timer);
      }, [saved]);

      async function refresh() {
        setBusy(true);
        try {
          await load();
        } finally {
          setBusy(false);
        }
      }

      async function opPost(action, args) {
        const data = await api("/company/op", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: action, args: args || {} }),
        });
        if (data && data.ok === false) {
          const err = new Error(data.message ? String(data.message) : String(data.code || ""));
          err.code = data.code ? String(data.code) : "";
          throw err;
        }
        return data;
      }

      async function submitOp(action, args, savedLabel, keepHrEmployeeId) {
        setBusy(true);
        setOpError(null);
        setSaved(null);
        try {
          await opPost(action, args);
          // v5.4：在人事管理详情页里发起的操作，成功后回落到 hr 详情（其余仍直接收起）
          const hrEmployeeId =
            keepHrEmployeeId != null ? keepHrEmployeeId : editor && editor.fromHr ? editor.employeeId : null;
          setEditor(hrEmployeeId != null ? { kind: "hr", employeeId: hrEmployeeId } : null);
          // Refresh overview in place; the modal stays open.
          await load();
          if (savedLabel) setSaved(savedLabel);
        } catch (err) {
          setOpError(cpErrorText(err));
        } finally {
          setBusy(false);
        }
      }

      async function submitMove(emp) {
        const canClear = emp.kind === "shared";
        const value = canClear && editor.department === "" ? "" : String(editor.department || "");
        if (!value && !canClear) return;
        setBusy(true);
        setOpError(null);
        setSaved(null);
        try {
          await opPost("moveEmployee", { employeeId: emp.id, department: value });
          setEditor({ kind: "hr", employeeId: emp.id });
          await load();
        } catch (err) {
          setOpError(cpErrorText(err));
        } finally {
          setBusy(false);
        }
      }

      async function deleteDepartment(card) {
        if (!card || !card.dept) return;
        const deptName = card.dept.name || card.dept.code || String(card.dept.id);
        const deptCode = card.dept.code || "—";
        const ask =
          typeof confirm === "function"
            ? confirm
            : typeof window !== "undefined" && typeof window.confirm === "function"
              ? window.confirm
              : null;
        if (ask && !ask(t("cpDeleteDeptConfirm", { name: deptName, code: deptCode }))) return;
        setBusy(true);
        setOpError(null);
        try {
          await opPost("deleteDepartment", { departmentId: card.dept.id });
          setDeptModal(null);
          setEditor(null);
          await load();
        } catch (err) {
          setOpError(cpErrorText(err));
        } finally {
          setBusy(false);
        }
      }

      // v5.1/v5.10: toolbar is fully left aligned, no auto-refresh badge:
      // title -> 新建部门 -> 刷新 -> 更新于 ***.
      const toolbar = h(
        "div",
        { style: CP_STYLE.toolbar },
        h("div", { style: CP_STYLE.toolbarTitle }, t("cpTitle")),
        h(
          "button",
          {
            style: S.btnSm,
            disabled: busy,
            onClick: () => {
              setNewDeptError(null);
              setNewDeptDraft({ id: "", name: "", charter: "", capacity: "4", brief: "" });
              setNewDeptOpen(true);
            },
          },
          t("cpNewDept"),
        ),
        h("button", { style: S.btnSm, disabled: busy, onClick: refresh }, busy ? "…" : t("cpRefresh")),
        updatedAt ? h("span", { style: CP_STYLE.sub }, t("cpUpdated", { time: new Date(updatedAt).toLocaleTimeString() })) : null,
      );

      if (!overview) {
        return h(
          "div",
          null,
          toolbar,
          error ? h("div", { style: S.err }, t("cpLoadFailed") + "：" + error) : h("div", { style: S.emptyBox }, t("cpLoading")),
        );
      }

      const view = buildCompanyOrgView(overview);
      const orderedCards = view.cards.slice().sort(cpCompareDept);
      const chartCards = orderedCards.filter((card) => card.dept);

      const empKey = (emp, index) => (emp && emp.id != null ? String(emp.id) : "emp-" + index);

      // v5 management node (docs/21 §4.1): the employee-center node and "view all" button are
      // gone; management is a read-only aggregate above all departments (click opens the modal).
      const management = view.management;
      const mgmtNode = h(
        "button",
        {
          type: "button",
          style: CP_STYLE.mgmtNode,
          title: t("cpMgmtHint"),
          onClick: () => setMgmtOpen(true),
        },
        h("span", { style: { fontWeight: 700, fontSize: 13.5 } }, view.managementName || t("cpManagement")),
        h("span", { style: S.countPill }, String(management.employees.length)),
      );

      const leaderNode = (card) => {
        const leader = card.leader;
        if (!leader) return h("div", { style: CP_STYLE.leaderGhost, title: t("cpNoLeader") }, t("cpNoLeader"));
        return h(
          "div",
          { style: CP_STYLE.leaderNode, title: t("cpLeaderTag") },
          leader.level
            ? h(
                "span",
                { style: cpChipStyle("M", true) },
                h("span", { style: { fontWeight: 700 } }, leader.level),
                leader.levelName ? h("span", null, leader.levelName) : null,
              )
            : null,
          h("span", { style: CP_STYLE.name }, leader.displayName || leader.id || "—"),
          leader.code ? h("span", { style: CP_STYLE.code }, leader.code) : null,
        );
      };

      const deptBox = (card) => {
        const dept = card.dept;
        const capacity = typeof dept.capacity === "number" && dept.capacity >= 0 ? dept.capacity : null;
        const used = typeof dept.employeeCount === "number" ? dept.employeeCount : card.employees.length;
        const headcount = capacity == null ? t("cpNoCapacity", { n: used }) : t("cpHeadcountValue", { n: used, cap: capacity });
        return h(
          "button",
          {
            type: "button",
            style: CP_STYLE.deptBox,
            title: t("cpDeptBoxHint"),
            onClick: () => {
              setOpError(null);
              setEditor(null);
              setModalTab("chart");
              setDeptModal(String(dept.id));
            },
          },
          h(
            "span",
            { style: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", width: "100%" } },
            dept.code ? h("span", { style: CP_STYLE.deptCode }, "[" + dept.code + "]") : null,
            h("span", { style: CP_STYLE.deptBoxName }, dept.name || dept.code || t("cpDept")),
          ),
          h("span", { style: CP_STYLE.deptBoxMeta }, t("cpLeaderTag") + "：" + (card.leader ? card.leader.displayName || card.leader.code || "—" : t("cpNoLeader"))),
          h(
            "div",
            { style: CP_STYLE.deptMetaRow },
            h("span", { style: cpChipStyle("M", true) }, "M " + card.channelCounts.M),
            h("span", { style: cpChipStyle("P", true) }, "P " + card.channelCounts.P),
            h("span", { style: Object.assign({}, CP_STYLE.deptBoxMeta, { marginLeft: "auto" }) }, headcount),
          ),
        );
      };

      const chartCount = chartCards.length;
      const chart = h(
        "div",
        { style: CP_STYLE.chart },
        h(
          "div",
          { style: CP_STYLE.chartInner },
          h("div", { style: CP_STYLE.mgmtRow }, mgmtNode),
          chartCount ? h("div", { style: CP_STYLE.mgmtStem }) : null,
          chartCount
            ? h(
                "div",
                { style: CP_STYLE.branchesRow },
                chartCards.map((card, index) =>
                  h(
                    "div",
                    { key: String(card.dept.id), style: CP_STYLE.branch },
                    // Horizontal bus drawn by each branch's own halves: left arm hidden on the
                    // first branch, right arm hidden on the last. Because branches touch, the
                    // arms form one continuous line from the first center to the last center,
                    // regardless of min/max width caps (the old percentage-bus misaligned).
                    h(
                      "div",
                      { style: CP_STYLE.branchRail },
                      h("div", { style: index === 0 ? CP_STYLE.railArmHidden : CP_STYLE.railArm }),
                      h("div", { style: index === chartCount - 1 ? CP_STYLE.railArmHidden : CP_STYLE.railArm }),
                    ),
                    h("div", { style: CP_STYLE.branchDrop }),
                    h("div", { style: CP_STYLE.leaderWrap }, leaderNode(card)),
                    h("div", { style: CP_STYLE.branchStem }),
                    deptBox(card),
                  ),
                ),
              )
            : h("div", { style: { minWidth: 240 } }, h("div", { style: S.emptyBox }, t("cpChartEmpty"))),
        ),
      );

      const kpi = (label, value) =>
        h(
          "div",
          { key: label, style: CP_STYLE.stat },
          h("div", { style: CP_STYLE.statLabel }, label),
          h("div", { style: CP_STYLE.statNum }, String(value)),
        );

      const statHead = h(
        "div",
        { style: CP_STYLE.stats },
        kpi(t("cpDeptCount"), view.counts.departments),
        kpi(t("cpEmpCount"), view.counts.employees),
        kpi(t("cpMCount"), view.counts.M),
        kpi(t("cpPCount"), view.counts.P),
        kpi(t("cpOrders"), view.board.orders),
        kpi(t("cpDone"), view.board.done),
        kpi(t("cpTokens"), cpNumLabel(view.costs.tokens)),
        kpi(t("cpRequests"), cpNumLabel(view.costs.requests)),
      );

      const numberingLine = h(
        "span",
        { style: CP_STYLE.metaText },
        t("cpNumberingLine", {
          emp: view.numbering.employee.pattern,
          dept: view.numbering.department.pattern,
          empSample: view.numbering.employee.sample,
          deptSample: view.numbering.department.sample,
        }),
      );

      const legend = h(
        "div",
        { style: CP_STYLE.legendWrap },
        ["M", "P"].map((channel) =>
          h(
            "div",
            { key: channel, style: CP_STYLE.legendGroup },
            h("span", { style: CP_STYLE.legendTitle }, channel === "M" ? t("cpChannelM") : t("cpChannelP")),
            view.levels[channel].levels.map((lv) =>
              h(
                "span",
                { key: lv.code, style: cpChipStyle(channel, false), title: t("cpLevel") + " " + lv.code },
                h("span", { style: { fontWeight: 700 } }, lv.code),
                lv.name ? h("span", null, lv.name) : null,
              ),
            ),
          ),
        ),
      );

      // Cost attribution: totals + top-5 columns by employee / department / order.
      // Compact meta card: numbering rules + level legend share one bordered block so the
      // page below the chart reads as two tidy bands (KPI grid, then meta) instead of four
      // loose rows of different widths.
      function openNumberingEditor() {
        setOpError(null);
        setNumberingDraft({
          empPattern: view.numbering.employee.pattern,
          empStart: String(view.numbering.employee.start),
          deptPattern: view.numbering.department.pattern,
          deptStart: String(view.numbering.department.start),
        });
        setNumberingOpen(true);
      }

      async function saveNumbering() {
        const d = numberingDraft || {};
        const empPattern = String(d.empPattern || "").trim();
        const deptPattern = String(d.deptPattern || "").trim();
        const empStart = parseInt(d.empStart, 10);
        const deptStart = parseInt(d.deptStart, 10);
        const valid =
          empPattern.includes("{seq") &&
          deptPattern.includes("{seq") &&
          Number.isInteger(empStart) &&
          empStart >= 1 &&
          Number.isInteger(deptStart) &&
          deptStart >= 1;
        if (!valid) {
          setOpError(t("cpPatternHint"));
          return;
        }
        setBusy(true);
        setOpError(null);
        try {
          await opPost("setNumbering", {
            employee: { pattern: empPattern, start: empStart },
            department: { pattern: deptPattern, start: deptStart },
          });
          setNumberingOpen(false);
          setNumberingDraft(null);
          await load();
          setSaved(t("cpSaved"));
        } catch (err) {
          setOpError(cpErrorText(err));
        } finally {
          setBusy(false);
        }
      }

      function openLevelsEditor() {
        setOpError(null);
        const grab = (channel) => ({
          label: view.levels[channel].label || "",
          levels: view.levels[channel].levels.map((lv) => ({ code: lv.code, name: lv.name || "", origin: lv.code })),
        });
        setLevelsDraft({ M: grab("M"), P: grab("P") });
        setLevelsOpen(true);
      }

      async function saveLevels() {
        const d = levelsDraft || { M: { levels: [] }, P: { levels: [] } };
        const empty = ["M", "P"].some((channel) => (d[channel]?.levels || []).length === 0);
        if (empty) {
          setOpError(t("cpLevelHint"));
          return;
        }
        const bad = ["M", "P"].some((channel) =>
          (d[channel]?.levels || []).some((lv) => !String(lv.name || "").trim()),
        );
        if (bad) {
          setOpError(t("cpLevelNameLabel"));
          return;
        }
        setBusy(true);
        setOpError(null);
        try {
          const payload = {};
          const remap = {};
          for (const channel of ["M", "P"]) {
            payload[channel] = {
              label: String(d[channel]?.label || "").trim(),
              levels: (d[channel]?.levels || []).map((lv) => ({ code: lv.code, name: String(lv.name).trim() })),
            };
            for (const lv of d[channel]?.levels || []) {
              if (lv.origin && lv.origin !== lv.code) {
                remap[channel] = remap[channel] || {};
                remap[channel][lv.origin] = lv.code;
              }
            }
          }
          const args = { levels: payload };
          if (Object.keys(remap).length) args.levelRemap = remap;
          await opPost("setLevels", args);
          setLevelsOpen(false);
          setLevelsDraft(null);
          await load();
          setSaved(t("cpSaved"));
        } catch (err) {
          setOpError(cpErrorText(err));
        } finally {
          setBusy(false);
        }
      }

      async function saveMgmtName() {
        const name = String(mgmtRename || "").trim();
        if (!name) return;
        setBusy(true);
        setOpError(null);
        try {
          await opPost("setManagementName", { name });
          setMgmtRename(null);
          await load();
          setSaved(t("cpSaved"));
        } catch (err) {
          setOpError(cpErrorText(err));
        } finally {
          setBusy(false);
        }
      }

      function openDeptEditor(card) {
        if (!card || !card.dept) return;
        setOpError(null);
        const dept = card.dept;
        setDeptEditDraft({
          name: dept.name == null ? "" : String(dept.name),
          code: dept.code == null ? "" : String(dept.code),
          capacity: dept.capacity == null ? "" : String(dept.capacity),
          charter: dept.charter == null ? "" : String(dept.charter),
          accepts: Array.isArray(dept.accepts) ? dept.accepts.map(String).join(", ") : "",
          borrowPolicy:
            dept.borrowPolicy && typeof dept.borrowPolicy === "object" ? JSON.stringify(dept.borrowPolicy) : "{}",
        });
        setDeptEditOpen(true);
      }

      async function saveDeptEdit(card) {
        if (!card || !card.dept) return;
        const d = deptEditDraft || {};
        const name = String(d.name || "").trim();
        if (!name) {
          setOpError(t("cpDeptNameField"));
          return;
        }
        const cap = parseInt(d.capacity, 10);
        if (String(d.capacity).trim() === "" || !Number.isInteger(cap) || cap < 0) {
          setOpError(t("cpCapacityField"));
          return;
        }
        let borrowPolicy = {};
        try {
          const parsed = JSON.parse(String(d.borrowPolicy || "{}").trim() || "{}");
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) borrowPolicy = parsed;
          else throw new Error("not object");
        } catch (err) {
          setOpError(t("cpInvalidJson"));
          return;
        }
        const accepts = String(d.accepts || "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
        setBusy(true);
        setOpError(null);
        try {
          await opPost("updateDepartment", {
            departmentId: card.dept.id,
            name,
            code: String(d.code || "").trim() || undefined,
            capacity: cap,
            charter: String(d.charter == null ? "" : d.charter),
            accepts,
            borrowPolicy,
          });
          setDeptEditOpen(false);
          setDeptEditDraft(null);
          await load();
          setSaved(t("cpSaved"));
        } catch (err) {
          setOpError(cpErrorText(err));
        } finally {
          setBusy(false);
        }
      }

      const metaCard = h(
        "div",
        { style: CP_STYLE.metaCard },
        h(
          "div",
          { style: CP_STYLE.metaRow },
          h("span", { style: CP_STYLE.metaLabel }, t("cpNumbering")),
          numberingLine,
          h("span", { style: { marginLeft: "auto" } }, h("button", { style: S.btnSm, onClick: openNumberingEditor }, t("cpCustomize"))),
        ),
        h(
          "div",
          { style: CP_STYLE.metaRow },
          h("span", { style: CP_STYLE.metaLabel }, t("cpLegend")),
          legend,
          h("span", { style: { marginLeft: "auto" } }, h("button", { style: S.btnSm, onClick: openLevelsEditor }, t("cpCustomize"))),
        ),
      );

      const costColumn = (title, rows) =>
        h(
          "div",
          { key: title, style: CP_STYLE.costCol },
          h(
            "div",
            { style: CP_STYLE.costColHead },
            h("span", null, title),
            h("span", { style: { opacity: 0.5, fontWeight: 400 } }, t("cpTopHint")),
          ),
          rows.length
            ? rows.slice(0, 5).map((row) =>
                h(
                  "div",
                  { key: row.key, style: CP_STYLE.costRow },
                  h("span", { style: CP_STYLE.costName, title: row.label }, row.label),
                  h("span", { style: CP_STYLE.costNums }, t("cpCostRow", { tokens: cpNumLabel(row.tokens), requests: cpNumLabel(row.requests) })),
                ),
              )
            : h("div", { style: CP_STYLE.emptyCol }, t("cpNoCost")),
        );

      const costSection = view.costs.hasData
        ? h(
            "div",
            null,
            h(
              "div",
              { style: CP_STYLE.sectionHead },
              h("span", null, t("cpCost")),
              h("span", { style: CP_STYLE.sectionTotal }, t("cpCostTotal", { tokens: cpNumLabel(view.costs.tokens), requests: cpNumLabel(view.costs.requests) })),
            ),
            h(
              "div",
              { style: CP_STYLE.costCols },
              costColumn(t("cpByEmployee"), view.costs.byEmployee),
              costColumn(t("cpByDepartment"), view.costs.byDepartment),
              costColumn(t("cpByOrder"), view.costs.byOrder),
            ),
          )
        : h(
            "div",
            null,
            h("div", { style: CP_STYLE.sectionHead }, h("span", null, t("cpCost"))),
            h("div", { style: S.emptyBox }, t("cpNoCost")),
          );

      function headcountText(card) {
        const dept = card.dept || {};
        const capacity = typeof dept.capacity === "number" && dept.capacity >= 0 ? dept.capacity : null;
        const used = typeof dept.employeeCount === "number" ? dept.employeeCount : card.employees.length;
        return capacity == null ? t("cpNoCapacity", { n: used }) : t("cpHeadcountValue", { n: used, cap: capacity });
      }

      function fireEmployee(emp, keepHr) {
        const label = emp.displayName || emp.code || emp.id || "";
        if (typeof confirm === "function" && !confirm(t("cpFireConfirm", { name: label }))) return;
        submitOp("fireEmployee", { employeeId: emp.id }, null, keepHr ? emp.id : null);
      }

      function submitHire(deptId) {
        const args = {
          displayName: (editor.displayName || "").trim(),
          department: String(deptId),
          role: editor.role || "staff",
          kind: editor.empKind || "permanent",
        };
        if ((editor.id || "").trim()) args.id = editor.id.trim();
        // v5: channels 可选（不传按 role 默认）；manager 强制含 M，window 禁止 M（docs/21 §4.2）
        const role = editor.role || "staff";
        const mOn = role === "manager" ? true : role === "window" ? false : editor.mChecked === true;
        const pOn = editor.pChecked !== false;
        const channels = [];
        if (mOn) channels.push({ channel: "M", level: editor.mLevel || "M2" });
        if (pOn) channels.push({ channel: "P", level: editor.pLevel || "P3" });
        if (channels.length) args.channels = channels;
        submitOp("createEmployee", args);
      }

      function closeEditor() {
        if (editor && editor.fromHr && editor.employeeId != null) {
          setEditor({ kind: "hr", employeeId: editor.employeeId });
        } else {
          setEditor(null);
        }
      }

      function hrInfoRow(label, value, key) {
        return h(
          "div",
          { key: key || label, style: CP_STYLE.hrInfo },
          h("span", { style: CP_STYLE.hrInfoLabel }, label),
          h("span", null, value),
        );
      }

      function hrDeptLabel(emp) {
        const card = view.cards.find((item) => item.dept && String(item.dept.id) === String(emp.department));
        if (card) return "[" + (card.dept.code || "—") + "] " + (card.dept.name || card.dept.id);
        if (emp.departmentCode) return "[" + emp.departmentCode + "] " + (emp.department || "—");
        return "—";
      }

      function hrPolicyText(kind) {
        if (kind === "temp") return t("cpKindTemp");
        if (kind === "shared") return t("cpKindShared");
        return t("cpKindPermanent");
      }

      // v5.8（docs/16 末尾「v5.8 追加」）：人事详情页以公司化员工（overview.org.employees）为准
      // 读写档案字段；保存一次 POST /company/op updateEmployeeProfile，不再发 registry op。
      function profileDraft() {
        return Object.assign({}, (editor && editor.profileDraft) || {});
      }

      function setProfileField(field, value) {
        const next = profileDraft();
        next[field] = value;
        setEditor(Object.assign({}, editor, { profileDraft: next }));
      }

      // v5.5：技能 / 模型改走已有选择弹层（SkillPicker / ModelPicker），不再手填逗号串
      function profileSkillList(profile) {
        const draft = profileDraft();
        if (draft.skillsText !== undefined) return splitCommas(draft.skillsText);
        return profile && Array.isArray(profile.skills) ? profile.skills.slice() : [];
      }

      function setProfileModel(provider, model) {
        const next = profileDraft();
        next.provider = provider;
        next.model = model;
        setEditor(Object.assign({}, editor, { profileDraft: next }));
      }

      function openSkillsPicker(profile) {
        setRosterPicker({ kind: "skills", selected: profileSkillList(profile) });
      }

      function toggleRosterSkill(name) {
        if (!rosterPicker || rosterPicker.kind !== "skills") return;
        const selected = rosterPicker.selected.slice();
        const at = selected.indexOf(name);
        if (at >= 0) selected.splice(at, 1);
        else selected.push(name);
        setProfileField("skillsText", selected.join(", "));
        setRosterPicker(Object.assign({}, rosterPicker, { selected: selected }));
      }

      function openModelPicker(profile) {
        const draft = profileDraft();
        const provider = draft.provider !== undefined ? draft.provider : (profile && profile.provider) || "";
        const model = draft.model !== undefined ? draft.model : (profile && profile.model) || "";
        if (modelProviders === null && typeof api === "function") {
          api("/models")
            .then((d) => setModelProviders(d && d.providers ? d.providers : []))
            .catch(() => setModelProviders([]));
        }
        setRosterPicker({ kind: "model", current: { provider: provider, model: model } });
      }

      function profileInput(field, options) {
        const draft = profileDraft();
        const current = draft[field] !== undefined ? draft[field] : options.value;
        return h(options.multiline ? "textarea" : "input", {
          style: options.multiline ? Object.assign({}, S.input, { minHeight: 54, resize: "vertical" }) : S.input,
          placeholder: options.placeholder,
          value: current == null ? "" : current,
          onChange: (e) => setProfileField(field, e.target.value),
        });
      }

      function profileDutiesList(profile) {
        const draft = profileDraft();
        if (Array.isArray(draft.dutiesList)) return draft.dutiesList.slice();
        return profile && Array.isArray(profile.duties) ? profile.duties.slice() : [];
      }

      function setProfileDuties(list) {
        setProfileField("dutiesList", list);
      }

      async function saveProfile(emp) {
        const draft = profileDraft();
        const pick = (key, fallback) => (draft[key] !== undefined ? draft[key] : fallback);
        const displayName = String(pick("displayName", emp.displayName || "") || "").trim();
        if (!displayName) {
          setOpError(t("displayNameRequired"));
          return;
        }
        const duties = (pick("dutiesList", emp.duties || []) || [])
          .map((row) => String(row).trim())
          .filter(Boolean)
          .slice(0, 8);
        const args = {
          employeeId: emp.id,
          displayName: displayName,
          title: String(pick("title", emp.title || "") || "").trim(),
          duties: duties,
          skills: splitCommas(String(pick("skillsText", (emp.skills || []).join(", ")) || "")),
          model: String(pick("model", emp.model || "") || "").trim(),
          provider: String(pick("provider", emp.provider || "") || "").trim(),
        };
        setBusy(true);
        setOpError(null);
        setSaved(null);
        try {
          await opPost("updateEmployeeProfile", args);
          await load();
          setEditor({ kind: "hr", employeeId: emp.id });
          setSaved(t("cpSaved"));
        } catch (err) {
          setOpError(cpErrorText(err));
        } finally {
          setBusy(false);
        }
      }

      function hrProfileBlock(emp) {
        const draft = profileDraft();
        const pick = (key, fallback) => (draft[key] !== undefined ? draft[key] : fallback);
        const canSave = String(pick("displayName", emp.displayName || "") || "").trim().length > 0 && !busy;
        const skillList = profileSkillList(emp);
        const duties = profileDutiesList(emp);
        const modelPreviewValue = {
          provider: String(pick("provider", emp.provider || "") || "").trim(),
          model: String(pick("model", emp.model || "") || "").trim(),
        };
        const modelPreview = modelPreviewValue.model
          ? (modelPreviewValue.provider ? modelPreviewValue.provider + " · " : "") + modelPreviewValue.model
          : "";
        return h(
          "div",
          { style: CP_STYLE.hrBlock },
          h("div", { style: CP_STYLE.hrLabel }, t("cpProfile") + " · " + (emp.code || emp.id || "—")),
          h(
            "div",
            { style: CP_STYLE.hrGrid },
            h(
              "label",
              { style: Object.assign({}, CP_STYLE.hrField, { gridColumn: "1", gridRow: "1" }) },
              h("span", { style: CP_STYLE.hrFieldLabel }, t("displayName")),
              profileInput("displayName", { value: emp.displayName || "", placeholder: t("displayName") }),
            ),
            h(
              "label",
              { style: Object.assign({}, CP_STYLE.hrField, { gridColumn: "2", gridRow: "1" }) },
              h("span", { style: CP_STYLE.hrFieldLabel }, t("role")),
              profileInput("title", { value: emp.title || "", placeholder: t("role") }),
            ),
            h(
              "div",
              { style: Object.assign({}, CP_STYLE.hrField, { gridColumn: "3", gridRow: "1 / span 2", minWidth: 0 }) },
              h("span", { style: CP_STYLE.hrFieldLabel }, t("duties") + " · " + t("cpDutiesMax")),
              duties.map((row, index) =>
                h(
                  "div",
                  { key: "duty-" + index, style: { display: "flex", alignItems: "center", gap: 6, marginBottom: 4 } },
                  h("input", {
                    style: S.input,
                    value: row,
                    placeholder: t("duties"),
                    onChange: (e) => {
                      const next = profileDutiesList(emp);
                      next[index] = e.target.value;
                      setProfileDuties(next);
                    },
                  }),
                  h(
                    "button",
                    {
                      style: S.btnSm,
                      disabled: busy,
                      onClick: () => {
                        const next = profileDutiesList(emp);
                        next.splice(index, 1);
                        setProfileDuties(next);
                      },
                    },
                    t("cpRemoveDuty"),
                  ),
                ),
              ),
              duties.length < 8
                ? h(
                    "button",
                    { style: S.btnSm, disabled: busy, onClick: () => setProfileDuties(profileDutiesList(emp).concat([""])) },
                    t("cpAddDuty"),
                  )
                : null,
            ),
            h(
              "div",
              { style: Object.assign({}, CP_STYLE.hrField, { gridColumn: "1", gridRow: "2" }) },
              h("span", { style: CP_STYLE.hrFieldLabel }, t("skillsSection") + "（" + skillList.length + "）"),
              h(
                "div",
                { style: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" } },
                h("button", { style: S.btnSm, disabled: busy, onClick: () => openSkillsPicker(emp) }, t("pickSkills")),
                h(
                  "span",
                  { style: Object.assign({}, CP_STYLE.sub, { lineHeight: 1.5 }) },
                  skillList.length ? skillList.join("、") : t("skillsHint"),
                ),
              ),
            ),
            h(
              "div",
              { style: Object.assign({}, CP_STYLE.hrField, { gridColumn: "2", gridRow: "2" }) },
              h("span", { style: CP_STYLE.hrFieldLabel }, t("cpHrModel")),
              h(
                "div",
                { style: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" } },
                h("button", { style: S.btnSm, disabled: busy, onClick: () => openModelPicker(emp) }, t("pickModel")),
                h(
                  "span",
                  { style: Object.assign({}, CP_STYLE.sub, { lineHeight: 1.5 }) },
                  modelPreview ? modelPreview : t("useDefault"),
                ),
              ),
            ),
          ),
          h(
            "div",
            { style: { display: "flex", justifyContent: "flex-end", marginTop: 6 } },
            h("button", { style: S.btnPrimary, disabled: !canSave, onClick: () => saveProfile(emp) }, t("cpSaveProfile")),
          ),
        );
      }

      function hrDetail(emp) {
        const channels = cpChannelsOf(emp, view.levels);
        const kind = emp.kind || "permanent";
        const fired = emp.state === "fired";
        const actionOpen = editor && editor.kind !== "hr" && editor.fromHr === true && String(editor.employeeId) === String(emp.id);
        const openChannels = () => {
          const m = channels.find((row) => row.channel === "M");
          const p = channels.find((row) => row.channel === "P");
          setEditor({
            kind: "channels",
            employeeId: emp.id,
            fromHr: true,
            mChecked: !!m,
            mLevel: m && m.level ? m.level : "M2",
            pChecked: !!p,
            pLevel: p && p.level ? p.level : "P3",
          });
        };
        const openPromote = () =>
          setEditor({ kind: "promote", employeeId: emp.id, fromHr: true, channel: cpPrimaryChannel(emp), level: "" });
        const openMove = () => {
          const targets = view.cards.filter((card) => card.dept && String(card.dept.id) !== String(emp.department));
          setEditor({
            kind: "move",
            employeeId: emp.id,
            fromHr: true,
            channel: cpChannelOf(emp),
            level: "",
            department: targets.length ? String(targets[0].dept.id) : "",
          });
        };
        return h(
          "div",
          { style: CP_STYLE.hrPanel },
          h(
            "div",
            { style: CP_STYLE.hrHead },
            h("span", { style: { fontWeight: 700, fontSize: 13 } }, t("cpHr")),
            h("span", { style: CP_STYLE.code }, emp.code || "—"),
            h("span", { style: CP_STYLE.name }, emp.displayName || emp.id || "—"),
            channels.map((row) =>
              h(
                "span",
                { key: "hr-chip-" + row.channel, style: cpChipStyle(row.channel, false) },
                h("span", { style: { fontWeight: 700 } }, row.channel),
                row.level ? h("span", null, " " + row.level + (row.levelName ? " " + row.levelName : "")) : null,
              ),
            ),
            h(
              "span",
              { style: { marginLeft: "auto" } },
              h("button", { style: S.btnSm, onClick: () => setEditor(null) }, t("cpClose")),
            ),
          ),
          h(
            "div",
            { style: CP_STYLE.hrBlock },
            h("div", { style: CP_STYLE.hrLabel }, t("basicInfo")),
            h(
              "div",
              { style: CP_STYLE.hrGrid },
              hrInfoRow(t("cpDept"), hrDeptLabel(emp), "dept"),
              hrInfoRow(t("cpKind"), kind, "kind"),
              hrInfoRow(t("cpRole"), cpRoleLabel(t, emp.role), "role"),
              hrInfoRow(t("cpHrStatus"), cpStateLabel(t, emp.state), "state"),
              hrInfoRow(t("cpHrPolicy"), hrPolicyText(kind), "policy"),
              hrInfoRow(
                t("cpMainChannel"),
                channels
                  .map((row) => row.channel + " " + (row.level || "") + (row.levelName ? " " + row.levelName : ""))
                  .join(" · ") || "—",
                "channels",
              ),
            ),
          ),
          hrProfileBlock(emp),
          h(
            "div",
            { style: CP_STYLE.hrBlock },
            h("div", { style: CP_STYLE.hrLabel }, t("cpHrActions")),
            h(
              "div",
              { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
              h("button", { style: S.btnSm, disabled: busy || fired, onClick: openChannels }, t("cpChannels")),
              h("button", { style: S.btnSm, disabled: busy || fired, onClick: openPromote }, t("cpPromote")),
              h("button", { style: S.btnSm, disabled: busy || fired, onClick: () => fireEmployee(emp, true) }, t("cpFire")),
              h("button", { style: S.btnSm, disabled: busy, onClick: openMove }, t("cpMove")),
            ),
          ),
          actionOpen ? h("div", { style: { marginTop: 8 } }, editorForm(emp)) : null,
        );
      }

      function editorForm(emp) {
        if (editor.kind === "promote") {
          const channel = editor.channel || cpChannelOf(emp);
          const levels = (view.levels[channel] && view.levels[channel].levels) || [];
          // 跨通道时不能用主通道的 emp.level 算下一级：先取该员工在所选通道的等级。
          const channelEntry = (emp.channels || []).find((c) => c && c.channel === channel);
          const currentLevelCode = channelEntry ? channelEntry.level : cpPrimaryChannel(emp) === channel ? emp.level : "";
          const currentRank = cpLevelRank(currentLevelCode, channel);
          const nextLevel = levels.find((lv) => cpLevelRank(lv.code, channel) > currentRank);
          const level = editor.level || (nextLevel ? nextLevel.code : currentLevelCode || (levels.length ? levels[0].code : ""));
          return h(
            "div",
            { style: CP_STYLE.inlineForm },
            h(
              "span",
              { style: CP_STYLE.inlineField },
              t("cpChannels"),
              h(
                "select",
                { style: S.selectSm, value: channel, onChange: (e) => setEditor(Object.assign({}, editor, { channel: e.target.value, level: "" })) },
                h("option", { value: "M" }, "M " + t("cpChannelM")),
                h("option", { value: "P" }, "P " + t("cpChannelP")),
              ),
            ),
            h(
              "span",
              { style: CP_STYLE.inlineField },
              t("cpLevel"),
              h(
                "select",
                { style: S.selectSm, value: level, onChange: (e) => setEditor(Object.assign({}, editor, { level: e.target.value })) },
                levels.map((lv) => h("option", { key: lv.code, value: lv.code }, lv.code + (lv.name ? " " + lv.name : ""))),
              ),
            ),
            h("button", { style: S.btnPrimary, disabled: busy, onClick: () => submitOp("promoteEmployee", { employeeId: emp.id, channel: channel, level: level }) }, t("cpPromote")),
            h("button", { style: S.btnSm, onClick: closeEditor }, t("cancel")),
          );
        }
        if (editor.kind === "channels") {
          const levelsM = (view.levels.M && view.levels.M.levels) || [];
          const levelsP = (view.levels.P && view.levels.P.levels) || [];
          const lockedM = emp.role === "manager" || emp.role === "window";
          const mLevel = editor.mLevel || (levelsM.length ? levelsM[levelsM.length - 1].code : "M1");
          const pLevel = editor.pLevel || (levelsP.length ? levelsP[levelsP.length - 1].code : "P1");
          const effM = emp.role === "manager" ? true : emp.role === "window" ? false : editor.mChecked === true;
          const effP = editor.pChecked === true;
          const channels = [];
          if (effM) channels.push({ channel: "M", level: mLevel });
          if (effP) channels.push({ channel: "P", level: pLevel });
          return h(
            "div",
            { style: CP_STYLE.inlineForm },
            h(
              "span",
              { style: CP_STYLE.inlineField },
              t("cpChannels"),
              h("input", {
                type: "checkbox",
                checked: effM,
                disabled: lockedM || busy,
                title: lockedM ? t("cpChannelLocked") : "",
                onChange: (e) => setEditor(Object.assign({}, editor, { mChecked: e.target.checked })),
              }),
              h("span", null, "M " + t("cpChannelM")),
              h(
                "select",
                {
                  style: S.selectSm,
                  value: mLevel,
                  disabled: !effM || lockedM || busy,
                  onChange: (e) => setEditor(Object.assign({}, editor, { mLevel: e.target.value })),
                },
                (levelsM.length ? levelsM : [{ code: "M1", name: "" }]).map((lv) =>
                  h("option", { key: lv.code, value: lv.code }, lv.code + (lv.name ? " " + lv.name : "")),
                ),
              ),
            ),
            h(
              "span",
              { style: CP_STYLE.inlineField },
              h("input", {
                type: "checkbox",
                checked: effP,
                disabled: busy,
                onChange: (e) => setEditor(Object.assign({}, editor, { pChecked: e.target.checked })),
              }),
              h("span", null, "P " + t("cpChannelP")),
              h(
                "select",
                {
                  style: S.selectSm,
                  value: pLevel,
                  disabled: !effP || busy,
                  onChange: (e) => setEditor(Object.assign({}, editor, { pLevel: e.target.value })),
                },
                (levelsP.length ? levelsP : [{ code: "P1", name: "" }]).map((lv) =>
                  h("option", { key: lv.code, value: lv.code }, lv.code + (lv.name ? " " + lv.name : "")),
                ),
              ),
            ),
            !channels.length ? h("span", { style: S.err }, t("cpChannelRequired")) : null,
            h(
              "button",
              {
                style: S.btnPrimary,
                disabled: busy || !channels.length,
                onClick: () => submitOp("setChannels", { employeeId: emp.id, channels: channels }, t("cpSaved")),
              },
              t("cpSave"),
            ),
            h("button", { style: S.btnSm, onClick: closeEditor }, t("cancel")),
          );
        }
        if (editor.kind === "move") {
          const targets = view.cards.filter((card) => card.dept && String(card.dept.id) !== String(emp.department));
          const canClear = emp.kind === "shared";
          const firstTarget = targets.length ? String(targets[0].dept.id) : "";
          const value = canClear && editor.department === "" ? "" : editor.department || firstTarget;
          return h(
            "div",
            { style: CP_STYLE.inlineForm },
            h(
              "span",
              { style: CP_STYLE.inlineField },
              t("cpMoveTo"),
              h(
                "select",
                { style: S.selectSm, value: value, onChange: (e) => setEditor(Object.assign({}, editor, { department: e.target.value })) },
                canClear ? h("option", { value: "" }, t("cpNoDeptOpt")) : null,
                targets.map((card) =>
                  h("option", { key: String(card.dept.id), value: String(card.dept.id) }, "[" + (card.dept.code || "—") + "] " + (card.dept.name || card.dept.id)),
                ),
              ),
            ),
            h("button", { style: S.btnPrimary, disabled: busy || (!value && !canClear), onClick: () => submitMove(emp) }, t("cpMove")),
            h("button", { style: S.btnSm, onClick: closeEditor }, t("cancel")),
          );
        }
        // kind === "hire"
        const roles = ["staff", "manager", "window"];
        const kinds = ["permanent", "temp", "shared"];
        const hireRole = editor.role || "staff";
        const hireM = hireRole === "manager" ? true : hireRole === "window" ? false : editor.mChecked === true;
        const hireP = editor.pChecked !== false;
        const hireMLevels = (view.levels.M && view.levels.M.levels) || [];
        const hirePLevels = (view.levels.P && view.levels.P.levels) || [];
        return h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: 8, padding: "8px 0 10px" } },
          h(
            "div",
            { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
            h("input", { style: Object.assign({}, S.input, { flex: "1 1 150px" }), placeholder: t("cpNewDeptId"), value: editor.id || "", onChange: (e) => setEditor(Object.assign({}, editor, { id: e.target.value })) }),
            h("input", { style: Object.assign({}, S.input, { flex: "1 1 150px" }), placeholder: t("cpNewDeptName"), value: editor.displayName || "", onChange: (e) => setEditor(Object.assign({}, editor, { displayName: e.target.value })) }),
          ),
          h(
            "div",
            { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
            h(
              "select",
              { style: S.selectSm, value: editor.role || "staff", onChange: (e) => setEditor(Object.assign({}, editor, { role: e.target.value })) },
              roles.map((role) => h("option", { key: role, value: role }, role)),
            ),
            h(
              "select",
              { style: S.selectSm, value: editor.empKind || "permanent", onChange: (e) => setEditor(Object.assign({}, editor, { empKind: e.target.value })) },
              kinds.map((kind) => h("option", { key: kind, value: kind }, kind)),
            ),
            h(
              "span",
              { style: CP_STYLE.inlineField },
              h("input", {
                type: "checkbox",
                checked: hireM,
                disabled: hireRole === "manager" || hireRole === "window",
                title: hireRole === "manager" || hireRole === "window" ? t("cpChannelLocked") : "",
                onChange: (e) => setEditor(Object.assign({}, editor, { mChecked: e.target.checked })),
              }),
              h("span", null, "M"),
              h(
                "select",
                {
                  style: S.selectSm,
                  value: editor.mLevel || "M2",
                  disabled: !hireM,
                  onChange: (e) => setEditor(Object.assign({}, editor, { mLevel: e.target.value })),
                },
                (hireMLevels.length ? hireMLevels : [{ code: "M2", name: "" }]).map((lv) =>
                  h("option", { key: lv.code, value: lv.code }, lv.code + (lv.name ? " " + lv.name : "")),
                ),
              ),
            ),
            h(
              "span",
              { style: CP_STYLE.inlineField },
              h("input", {
                type: "checkbox",
                checked: hireP,
                onChange: (e) => setEditor(Object.assign({}, editor, { pChecked: e.target.checked })),
              }),
              h("span", null, "P"),
              h(
                "select",
                {
                  style: S.selectSm,
                  value: editor.pLevel || "P3",
                  disabled: !hireP,
                  onChange: (e) => setEditor(Object.assign({}, editor, { pLevel: e.target.value })),
                },
                (hirePLevels.length ? hirePLevels : [{ code: "P3", name: "" }]).map((lv) =>
                  h("option", { key: lv.code, value: lv.code }, lv.code + (lv.name ? " " + lv.name : "")),
                ),
              ),
            ),
          ),
          h(
            "div",
            { style: { display: "flex", gap: 8, justifyContent: "flex-end" } },
            h("button", { style: S.btnSm, onClick: closeEditor }, t("cancel")),
            h("button", { style: S.btnPrimary, disabled: busy || !(editor.displayName || "").trim(), onClick: () => submitHire(editor.deptId) }, t("cpHire")),
          ),
        );
      }

      function chartTab(card) {
        const leader = card.leader;
        const leaderBlock = leader
          ? h(
              "div",
              { style: CP_STYLE.leaderCard },
              h("span", { style: { fontSize: 11, opacity: 0.6 } }, t("cpLeaderTag")),
              leader.level
                ? h(
                    "span",
                    { style: cpChipStyle("M", false) },
                    h("span", { style: { fontWeight: 700 } }, leader.level),
                    leader.levelName ? h("span", null, leader.levelName) : null,
                  )
                : null,
              h("span", { style: CP_STYLE.name }, leader.displayName || leader.id || "—"),
              leader.code ? h("span", { style: CP_STYLE.code }, leader.code) : null,
            )
          : h("div", { style: CP_STYLE.leaderGhost }, t("cpNoLeader"));
        const column = (channel) => {
          const rows = card.byChannel[channel].slice().sort(function (a, b) {
            const rankDiff = cpLevelRank(b.level, channel) - cpLevelRank(a.level, channel);
            if (rankDiff) return rankDiff;
            return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
          });
          return h(
            "div",
            { key: channel, style: CP_STYLE.column },
            h(
              "div",
              { style: CP_STYLE.columnHead },
              h("span", { style: cpChipStyle(channel, true) }, h("span", { style: { fontWeight: 700 } }, channel)),
              h("span", null, channel === "M" ? t("cpChannelM") : t("cpChannelP")),
              h("span", { style: { opacity: 0.5, fontWeight: 400 } }, String(rows.length)),
            ),
            rows.length ? rows.map((emp, index) => h("div", { key: empKey(emp, index), style: CP_STYLE.row }, cpRenderEmployeeRow(t, emp))) : h("div", { style: CP_STYLE.emptyCol }, "—"),
          );
        };
        return h(
          "div",
          null,
          leaderBlock,
          card.employees.length
            ? h("div", { style: CP_STYLE.columns }, column("M"), column("P"))
            : h("div", { style: S.emptyBox }, t("cpDeptEmpty")),
        );
      }

      function employeeActionRow(emp) {
        const key = emp.id != null ? String(emp.id) : emp.code || emp.displayName;
        const row = h(
          "div",
          { key: key, style: CP_STYLE.row },
          cpRenderEmployeeRow(t, emp),
          h(
            "span",
            { style: { marginLeft: "auto", display: "inline-flex", gap: 6, flexWrap: "wrap" } },
            h(
              "button",
              { style: S.btnSm, disabled: busy, onClick: () => setEditor({ kind: "hr", employeeId: emp.id }) },
              t("cpHr"),
            ),
          ),
        );
        const open =
          editor &&
          String(editor.employeeId) === String(emp.id) &&
          (editor.kind === "hr" || editor.fromHr === true);
        return open ? [row, h("div", { key: key + "-hr" }, hrDetail(emp))] : row;
      }

      function membersTab(card) {
        const hireOpen = editor && editor.kind === "hire";
        return h(
          "div",
          null,
          h(
            "div",
            { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 } },
            h("span", { style: S.countPill }, String(card.employees.length)),
            h("span", { style: CP_STYLE.sub }, t("cpHeadcount") + " " + headcountText(card)),
            h(
              "button",
              {
                style: S.btnSm,
                disabled: busy,
                onClick: () =>
                  setEditor({
                    kind: "hire",
                    employeeId: null,
                    deptId: card.dept.id,
                    id: "",
                    displayName: "",
                    role: "staff",
                    empKind: "permanent",
                    mChecked: false,
                    mLevel: "M2",
                    pChecked: true,
                    pLevel: "P3",
                    department: "",
                  }),
              },
              t("cpHire"),
            ),
          ),
          hireOpen ? h("div", null, editorForm(null)) : null,
          saved ? h("div", { style: S.hint }, saved) : null,
          card.employees.length ? h("div", null, card.employees.map(employeeActionRow)) : h("div", { style: S.emptyBox }, t("cpDeptEmpty")),
        );
      }

      const deptEditForm = (card) => {
        const d = deptEditDraft || {};
        const setD = (patch) => setDeptEditDraft(Object.assign({}, d, patch));
        const field = (label, input, extra) =>
          h(
            "div",
            { style: Object.assign({}, S.field, { flex: "1 1 200px", minWidth: 160 }, extra || {}) },
            h("label", { style: S.label }, label),
            input,
          );
        return h(
          "div",
          { style: { border: "1px solid rgba(127,127,127,.18)", borderRadius: 10, padding: 12, marginBottom: 12 } },
          h(
            "div",
            { style: { display: "flex", gap: 10, flexWrap: "wrap" } },
            field(t("cpDeptNameField"), h("input", { style: S.input, value: d.name || "", disabled: busy, onChange: (e) => setD({ name: e.target.value }) })),
            field(t("cpDeptCodeField"), h("input", { style: S.input, placeholder: t("cpAutoId"), value: d.code || "", disabled: busy, onChange: (e) => setD({ code: e.target.value }) })),
            field(t("cpCapacityField"), h("input", { style: S.input, type: "number", min: 0, value: d.capacity || "", disabled: busy, onChange: (e) => setD({ capacity: e.target.value }) })),
            field(t("cpCharterField"), h("input", { style: S.input, value: d.charter || "", disabled: busy, onChange: (e) => setD({ charter: e.target.value }) })),
            field(t("cpAcceptsField"), h("input", { style: S.input, value: d.accepts || "", disabled: busy, onChange: (e) => setD({ accepts: e.target.value }) })),
            field(t("cpBorrowPolicyField"), h("input", { style: S.input, value: d.borrowPolicy || "", disabled: busy, onChange: (e) => setD({ borrowPolicy: e.target.value }) })),
          ),
          h(
            "div",
            { style: { display: "flex", gap: 8, marginTop: 8 } },
            h("button", { style: S.btnPrimary, disabled: busy, onClick: () => saveDeptEdit(card) }, t("cpSave")),
            h(
              "button",
              {
                style: S.btn,
                disabled: busy,
                onClick: () => {
                  setDeptEditOpen(false);
                  setDeptEditDraft(null);
                },
              },
              t("cancel"),
            ),
          ),
        );
      };

      const modalCard =
        deptModal === null ? null : view.cards.find((card) => card.dept && String(card.dept.id) === String(deptModal)) || null;

      const mgmtModalEl = mgmtOpen
        ? h(
            "div",
            {
              style: S.modal,
              onClick: (e) => {
                if (e.target === e.currentTarget) setMgmtOpen(false);
              },
            },
            h(
              "div",
              {
                style: Object.assign({}, S.modalPanel, { width: "min(760px, 95vw)", maxHeight: "80vh", overflow: "auto" }),
                onClick: (e) => e.stopPropagation(),
              },
              h(
                "div",
                { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 } },
                h("span", { style: { fontWeight: 600, fontSize: 14 } }, view.managementName || t("cpManagement")),
                h("span", { style: CP_STYLE.sub }, t("cpMgmtHint")),
                h(
                  "span",
                  { style: { marginLeft: "auto", display: "inline-flex", gap: 6 } },
                  h(
                    "button",
                    {
                      style: S.btnSm,
                      disabled: busy,
                      onClick: () => setMgmtRename(view.managementName || t("cpManagement")),
                    },
                    t("cpRename"),
                  ),
                  h("button", { style: S.btnSm, onClick: () => setMgmtOpen(false) }, t("cpClose")),
                ),
              ),
              mgmtRename !== null
                ? h(
                    "div",
                    { style: { display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 10 } },
                    h(
                      "div",
                      { style: Object.assign({}, S.field, { flex: "1 1 220px", minWidth: 180 }) },
                      h("label", { style: S.label }, t("cpMgmtName")),
                      h("input", {
                        style: S.input,
                        value: mgmtRename,
                        disabled: busy,
                        maxLength: 40,
                        onChange: (e) => setMgmtRename(e.target.value),
                      }),
                    ),
                    h(
                      "div",
                      { style: { display: "inline-flex", gap: 8 } },
                      h("button", { style: S.btnPrimary, disabled: busy || !String(mgmtRename).trim(), onClick: saveMgmtName }, t("cpSave")),
                      h("button", { style: S.btn, disabled: busy, onClick: () => setMgmtRename(null) }, t("cancel")),
                    ),
                  )
                : null,
              management.employees.length
                ? h(
                    "div",
                    null,
                    management.employees.map((row, index) =>
                      h(
                        "div",
                        { key: row.id != null ? String(row.id) : "mgmt-" + index, style: CP_STYLE.row },
                        h("span", { style: CP_STYLE.code }, row.code || "—"),
                        row.level
                          ? h(
                              "span",
                              {
                                style: cpChipStyle("M", true),
                                title: t("cpLevel") + " " + row.level + (row.levelName ? " " + row.levelName : ""),
                              },
                              h("span", { style: { fontWeight: 700 } }, row.level),
                              row.levelName ? h("span", null, row.levelName) : null,
                            )
                          : null,
                        h("span", { style: CP_STYLE.name }, row.displayName || row.id || "—"),
                        h(
                          "span",
                          { style: { marginLeft: "auto", fontSize: 11, opacity: 0.7, whiteSpace: "nowrap" } },
                          [row.departmentCode ? "[" + row.departmentCode + "]" : "", row.departmentName || ""].filter(Boolean).join(" ") || "—",
                        ),
                      ),
                    ),
                  )
                : h("div", { style: S.emptyBox }, t("cpMgmtEmpty")),
            ),
          )
        : null;

      const deptModalEl = modalCard
        ? h(
            "div",
            {
              style: S.modal,
              onClick: (e) => {
                if (e.target === e.currentTarget) setDeptModal(null);
              },
            },
            h(
              "div",
              {
                style: Object.assign({}, S.modalPanel, { width: CP_MODAL_WIDTH, maxHeight: "88vh", overflow: "auto", padding: 14 }),
                onClick: (e) => e.stopPropagation(),
              },
              h(
                "div",
                { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 } },
                modalCard.dept.code ? h("span", { style: CP_STYLE.deptCode }, "[" + modalCard.dept.code + "]") : null,
                h("span", { style: { fontWeight: 600, fontSize: 14 } }, modalCard.dept.name || modalCard.dept.code || t("cpDept")),
                h("span", { style: CP_STYLE.sub }, t("tabOrg") + " · " + t("dpModalHint")),
                h("span", { style: { marginLeft: "auto" } }, h("button", { style: S.btnSm, onClick: () => setDeptModal(null) }, t("cpClose"))),
              ),
              h(
                "div",
                { style: { display: "flex", gap: 6, marginBottom: 10, alignItems: "center", flexWrap: "wrap" } },
                h("button", { style: modalTab === "chart" ? S.tabOn : S.tab, onClick: () => setModalTab("chart") }, t("cpModalChart")),
                h("button", { style: modalTab === "members" ? S.tabOn : S.tab, onClick: () => setModalTab("members") }, t("cpModalMembers")),
                h(
                  "span",
                  { style: { marginLeft: "auto" } },
                  h(
                    "button",
                    {
                      style: S.btnSm,
                      disabled: busy,
                      onClick: () => {
                        if (deptEditOpen) {
                          setDeptEditOpen(false);
                          setDeptEditDraft(null);
                        } else {
                          openDeptEditor(modalCard);
                        }
                      },
                    },
                    t("cpDeptEdit"),
                  ),
                ),
              ),
              deptEditOpen && deptEditDraft ? deptEditForm(modalCard) : null,
              opError ? h("div", { style: S.err }, t("cpOpFailed") + "：" + opError) : null,
              modalTab === "members" ? membersTab(modalCard) : chartTab(modalCard),
              h(
                "div",
                { style: { display: "flex", alignItems: "center", gap: 8, marginTop: 12, flexWrap: "wrap" } },
                h("button", { style: S.btnGhostDanger, disabled: busy, onClick: () => deleteDepartment(modalCard) }, t("cpDeleteDept")),
              ),
            ),
          )
        : null;

      const cfgField = (label, input, extra) =>
        h(
          "div",
          { style: Object.assign({}, S.field, { flex: "1 1 220px", minWidth: 170 }, extra || {}) },
          h("label", { style: S.label }, label),
          input,
        );

      const numberingModalEl = numberingOpen
        ? h(
            "div",
            {
              style: S.modal,
              onClick: (e) => {
                if (e.target === e.currentTarget) setNumberingOpen(false);
              },
            },
            h(
              "div",
              { style: Object.assign({}, S.modalPanel, { width: "min(600px, 94vw)" }), onClick: (e) => e.stopPropagation() },
              h(
                "div",
                { style: { display: "flex", alignItems: "center", marginBottom: 10 } },
                h("span", { style: { fontWeight: 600, fontSize: 14 } }, t("cpEditNumbering")),
                h("span", { style: { marginLeft: "auto" } }, h("button", { style: S.btnSm, onClick: () => setNumberingOpen(false) }, t("cpClose"))),
              ),
              opError ? h("div", { style: S.err }, t("cpOpFailed") + "：" + opError) : null,
              h(
                "div",
                { style: { display: "flex", gap: 10, flexWrap: "wrap" } },
                cfgField(t("cpEmpPattern"), h("input", { style: S.input, value: numberingDraft?.empPattern || "", disabled: busy, onChange: (e) => setNumberingDraft(Object.assign({}, numberingDraft, { empPattern: e.target.value })) })),
                cfgField(t("cpStartAt"), h("input", { style: S.input, type: "number", min: 1, value: numberingDraft?.empStart || "", disabled: busy, onChange: (e) => setNumberingDraft(Object.assign({}, numberingDraft, { empStart: e.target.value })) })),
                cfgField(t("cpDeptPattern"), h("input", { style: S.input, value: numberingDraft?.deptPattern || "", disabled: busy, onChange: (e) => setNumberingDraft(Object.assign({}, numberingDraft, { deptPattern: e.target.value })) })),
                cfgField(t("cpStartAt"), h("input", { style: S.input, type: "number", min: 1, value: numberingDraft?.deptStart || "", disabled: busy, onChange: (e) => setNumberingDraft(Object.assign({}, numberingDraft, { deptStart: e.target.value })) })),
              ),
              h("div", { style: Object.assign({}, CP_STYLE.sub, { marginTop: 6, whiteSpace: "pre-line", lineHeight: 1.7 }) }, t("cpPatternHint")),
              h(
                "div",
                { style: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 } },
                h("button", { style: S.btn, disabled: busy, onClick: () => setNumberingOpen(false) }, t("cancel")),
                h("button", { style: S.btnPrimary, disabled: busy, onClick: saveNumbering }, t("cpSaveNumbering")),
              ),
            ),
          )
        : null;

      const addLevel = (channel) => {
        if (!levelsDraft || !levelsDraft[channel]) return;
        const ch = levelsDraft[channel];
        const maxNum = Math.max(0, ...(ch.levels || []).map((lv) => Number(String(lv.code || "").slice(1)) || 0));
        const code = channel + String(maxNum + 1);
        setLevelsDraft(Object.assign({}, levelsDraft, {
          [channel]: Object.assign({}, ch, { levels: (ch.levels || []).concat([{ code, name: "", origin: null }]) }),
        }));
      };
      const removeLevel = (channel, code) => {
        if (!levelsDraft || !levelsDraft[channel]) return;
        const ch = levelsDraft[channel];
        if ((ch.levels || []).length <= 1) return;
        const survivors = (ch.levels || [])
          .filter((lv) => lv.code !== code)
          .map((lv, i) => Object.assign({}, lv, { code: channel + String(i + 1) }));
        setLevelsDraft(Object.assign({}, levelsDraft, {
          [channel]: Object.assign({}, ch, { levels: survivors }),
        }));
      };

      const levelsModalEl = levelsOpen
        ? h(
            "div",
            {
              style: S.modal,
              onClick: (e) => {
                if (e.target === e.currentTarget) setLevelsOpen(false);
              },
            },
            h(
              "div",
              { style: Object.assign({}, S.modalPanel, { width: "min(640px, 94vw)" }), onClick: (e) => e.stopPropagation() },
              h(
                "div",
                { style: { display: "flex", alignItems: "center", marginBottom: 10 } },
                h("span", { style: { fontWeight: 600, fontSize: 14 } }, t("cpEditLevels")),
                h("span", { style: { marginLeft: "auto" } }, h("button", { style: S.btnSm, onClick: () => setLevelsOpen(false) }, t("cpClose"))),
              ),
              opError ? h("div", { style: S.err }, t("cpOpFailed") + "：" + opError) : null,
              h("div", { style: Object.assign({}, CP_STYLE.sub, { marginBottom: 8, whiteSpace: "pre-line", lineHeight: 1.6 }) }, t("cpLevelHint")),
              ["M", "P"].map((channel) => {
                const ch = (levelsDraft && levelsDraft[channel]) || { label: "", levels: [] };
                const setLabel = (value) =>
                  setLevelsDraft(Object.assign({}, levelsDraft, {
                    [channel]: Object.assign({}, ch, { label: value }),
                  }));
                const setName = (code, value) =>
                  setLevelsDraft(Object.assign({}, levelsDraft, {
                    [channel]: Object.assign({}, ch, {
                      levels: (ch.levels || []).map((lv) => (lv.code === code ? Object.assign({}, lv, { name: value }) : lv)),
                    }),
                  }));
                return h(
                  "div",
                  { key: channel, style: { borderTop: channel === "P" ? "1px solid rgba(127,127,127,.18)" : "none", paddingTop: channel === "P" ? 10 : 0, marginTop: channel === "P" ? 10 : 0 } },
                  h(
                    "div",
                    { style: { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 6 } },
                    cfgField(
                      t("cpChannelLabelLabel") + " (" + channel + ")",
                      h("input", { style: S.input, value: ch.label || "", disabled: busy, onChange: (e) => setLabel(e.target.value) }),
                    ),
                  ),
                  h(
                    "div",
                    { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
                    (ch.levels || []).map((lv) =>
                      h(
                        "div",
                        { key: lv.code, style: Object.assign({}, S.field, { flex: "1 1 150px", minWidth: 130 }) },
                        h(
                          "div",
                          { style: { display: "flex", alignItems: "center", gap: 6 } },
                          h("label", { style: S.label }, lv.code + " · " + t("cpLevelNameLabel")),
                          (ch.levels || []).length > 1
                            ? h("button", { style: S.btnSm, disabled: busy, onClick: () => removeLevel(channel, lv.code) }, t("cpRemoveLevel"))
                            : null,
                        ),
                        h("input", { style: S.input, value: lv.name || "", disabled: busy, maxLength: 24, onChange: (e) => setName(lv.code, e.target.value) }),
                      ),
                    ),
                  ),
                  h(
                    "div",
                    { style: { marginTop: 6 } },
                    h("button", { style: S.btnSm, disabled: busy, onClick: () => addLevel(channel) }, t("cpAddLevel")),
                  ),
                );
              }),
              h(
                "div",
                { style: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 } },
                h("button", { style: S.btn, disabled: busy, onClick: () => setLevelsOpen(false) }, t("cancel")),
                h("button", { style: S.btnPrimary, disabled: busy, onClick: saveLevels }, t("cpSaveLevels")),
              ),
            ),
          )
        : null;

      const nd = newDeptDraft || { id: "", name: "", charter: "", capacity: "4", brief: "" };
      const setNd = (patch) => setNewDeptDraft(Object.assign({}, nd, patch));
      const ndCap = parseInt(nd.capacity, 10);
      const ndValid = nd.name.trim().length > 0 && String(nd.capacity).trim() !== "" && Number.isFinite(ndCap) && ndCap >= 0;

      async function createDepartment() {
        if (!ndValid) return;
        setBusy(true);
        setNewDeptError(null);
        try {
          const args = { name: nd.name.trim(), charter: nd.charter || "", capacity: ndCap };
          if ((nd.id || "").trim()) args.id = nd.id.trim();
          await opPost("createDepartment", args);
          setNewDeptOpen(false);
          setNewDeptDraft(null);
          await load();
        } catch (err) {
          setNewDeptError(cpErrorText(err));
        } finally {
          setBusy(false);
        }
      }

      function parseBrief() {
        const parsed = cpParseBrief(nd.brief);
        const patch = {};
        if (parsed.name) patch.name = parsed.name;
        if (parsed.capacity != null) patch.capacity = String(parsed.capacity);
        if (!nd.charter.trim() && parsed.charter) patch.charter = parsed.charter;
        setNd(patch);
      }

      const ndField = (label, input) =>
        h("div", { style: Object.assign({}, S.field, { flex: "1 1 200px", minWidth: 180 }) }, h("label", { style: S.label }, label), input);

      const newDeptModal = newDeptOpen
        ? h(
            "div",
            {
              style: S.modal,
              onClick: (e) => {
                if (busy) return;
                if (e.target === e.currentTarget) setNewDeptOpen(false);
              },
            },
            h(
              "div",
              { style: S.modalPanel, onClick: (e) => e.stopPropagation() },
              h(
                "div",
                { style: { display: "flex", alignItems: "center", marginBottom: 10 } },
                h("span", { style: { fontWeight: 600, fontSize: 14 } }, t("cpNewDept")),
                h("span", { style: { marginLeft: "auto" } }, h("button", { style: S.btnSm, onClick: () => setNewDeptOpen(false) }, t("cpClose"))),
              ),
              newDeptError ? h("div", { style: S.err }, t("cpOpFailed") + "：" + newDeptError) : null,
              h(
                "div",
                { style: { display: "flex", gap: 10, flexWrap: "wrap" } },
                ndField(t("cpNewDeptId"), h("input", { style: S.input, placeholder: t("cpAutoId"), value: nd.id, onChange: (e) => setNd({ id: e.target.value }) })),
                ndField(t("cpNewDeptName"), h("input", { style: S.input, value: nd.name, onChange: (e) => setNd({ name: e.target.value }) })),
                ndField(t("cpNewDeptDesc"), h("input", { style: S.input, value: nd.charter, onChange: (e) => setNd({ charter: e.target.value }) })),
                ndField(t("cpNewDeptCapacity"), h("input", { style: S.input, type: "number", min: 0, value: nd.capacity, onChange: (e) => setNd({ capacity: e.target.value }) })),
              ),
              ndField(t("cpNewDeptBrief"), h("textarea", { style: Object.assign({}, S.input, { minHeight: 56 }), value: nd.brief, onChange: (e) => setNd({ brief: e.target.value }) })),
              h(
                "div",
                { style: { display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" } },
                h("button", { style: S.btnSm, disabled: busy, onClick: parseBrief }, t("cpParse")),
                h("span", { style: CP_STYLE.sub }, t("cpParseHint")),
                h(
                  "span",
                  { style: { marginLeft: "auto", display: "inline-flex", gap: 8 } },
                  h("button", { style: S.btn, onClick: () => setNewDeptOpen(false) }, t("cancel")),
                  h("button", { style: S.btnPrimary, disabled: busy || !ndValid, onClick: createDepartment }, t("cpCreateDept")),
                ),
              ),
            ),
          )
        : null;

      const pickersEl = [
        rosterPicker && rosterPicker.kind === "skills"
          ? h(SkillPicker, {
              t: t,
              selected: rosterPicker.selected,
              onToggle: (name) => toggleRosterSkill(name),
              onClose: () => setRosterPicker(null),
            })
          : null,
        rosterPicker && rosterPicker.kind === "model"
          ? h(ModelPicker, {
              t: t,
              providers: modelProviders,
              current: rosterPicker.current,
              busy: busy,
              onPick: (providerId, modelId) => {
                setProfileModel(providerId, modelId);
                setRosterPicker(null);
              },
              onClear: () => {
                setProfileModel("", "");
                setRosterPicker(null);
              },
              onClose: () => setRosterPicker(null),
            })
          : null,
      ];

      return h(
        "div",
        null,
        pickersEl,
        toolbar,
        error ? h("div", { style: S.err }, t("cpLoadFailed") + "：" + error) : null,
        !view.enabled ? h("div", { style: S.hint }, t("cpDisabled") + "：" + t("cpDisabledHint")) : null,
        view.warnings.length ? h("div", { style: S.hint }, view.warnings.join("；")) : null,
        chart,
        statHead,
        metaCard,
        costSection,
        mgmtModalEl,
        deptModalEl,
        numberingModalEl,
        levelsModalEl,
        newDeptModal,
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

    const ORGMAP_VERSION = 3;
    const ORGMAP_MAX_EDGES = 12;
    // 并联（同层兄弟）横向排列，串联（父→子）纵向连接：
    //   第 1 层 = 大总管；第 2 层 = 分组色块（横向并联）；第 3 层 = 各组组内成员（组内横向并联）。
    // 层与层之间用竖直总线连接，同层之间不画线。
    const ORGMAP_CARD_W = 188;
    const ORGMAP_LEAD_W = 230;
    // 右侧边栏 tab：类型 id 全注册唯一，kind 是 openTab 的页面身份。
    const ORGMAP_TAB_ID = "dsh-member-manager/orgmap";
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
        if (m.code) meta.appendChild(el("span", "mmo-badge", m.code));
        if (m.level) {
          const lv = el("span", "mmo-badge", m.level);
          if (m.levelName) lv.title = m.levelName;
          meta.appendChild(lv);
        }
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
        const sections = groups.map((g) => ({
          name: g.name || g.code || t("ocUngrouped"),
          managerName: g.managerName || "",
          members: g.members || [],
        }));
        if (ungrouped.length) sections.push({ name: t("ocUngrouped"), members: ungrouped });

        sections.forEach((section, gi) => {
          const gidx = gi % 6;
          const cluster = el("div", "mmo-cluster");
          cluster.setAttribute("data-gi", String(gidx));
          const chip = el("div", "mmo-chip");
          chip.setAttribute("data-gi", String(gidx));
          if (section.managerName) chip.setAttribute("title", "负责人：" + section.managerName);
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
        const net = d.worknet || null;
        if (net) {
          foot.appendChild(el("span", "", t("ocStaff") + " " + (net.employees || 0)));
          foot.appendChild(el("span", "", t("ocDept") + " " + (net.departments || 0)));
        }
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
      CompanyOrgPanel: CompanyOrgPanel,
      EmployeeCenterPanel: EmployeeCenterPanel,
      buildCompanyOrgView: buildCompanyOrgView,
      buildEmployeeCenter: buildEmployeeCenter,
      cpChannelsOf: cpChannelsOf,
      cpPrimaryChannel: cpPrimaryChannel,
      cpNormalizeManagement: cpNormalizeManagement,
      cpParseBrief: cpParseBrief,
      cpCompareEmployee: cpCompareEmployee,
      cpCompareDept: cpCompareDept,
      CP_FALLBACK_LEVELS: CP_FALLBACK_LEVELS,
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
