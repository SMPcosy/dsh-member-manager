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
      mtModelPrefix: "模型: ",
      hrNameCol: "显示名 / target",
      uProviderLabel: "provider",
      hrDefaultName: "新员工 ",
      wbCapacityUnit: " 人",
      ocLeadTitle: "负责人：",
      wbTaskProgress: "任务 ",
      providerPh: "provider（留空用公司默认）",
      title: "成员管理",
      subtitle: "成员名由 DSH 内核持有，改不了；这里改的是本名册的显示名。名册里的删除只是停用，原生成员永远还在。",
      refresh: "刷新",
      sync: "同步核心成员",
      syncing: "同步中…",
      tabOrg: "部门架构",
      empty: "还没有成员。点「同步核心成员」把当前团队成员登记进来。",
      emptyGroup: "（空部门）",
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
      group: "所属部门",
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
      ocFoldIdle: "展开空闲成员",
      ocFoldHide: "收起空闲成员",
      tcTaskLabel: "任务",
      tcNoTasks: "暂无任务",
      ocEmptyTask: "还没有可显示的工作网：公司化运行时未启用，或还没有员工。",
      // v0.4：工作网任务泳道（调度看板）
      wbTitle: "调度 · 任务流",
      wbLaneQueued: "排队",
      wbLaneRouted: "已路由",
      wbLaneRunning: "执行中",
      wbLaneDone: "已完成",
      wbLaneAbnormal: "异常",
      wbSchedRunning: "调度器运行中",
      wbSchedStopped: "调度器已停止",
      wbTick: "立即调度",
      wbNewOrder: "下达工单",
      wbEmptyLane: "本列暂无工单",
      wbNoOrder: "还没有工单。点「下达工单」创建第一条，或让总指挥调用 company_order。",
      wbAssign: "派工",
      wbAssignAuto: "自动派工",
      wbReviewPass: "复核通过",
      wbReviewReject: "打回重做",
      wbCancel: "取消订单",
      wbEscalate: "升级",
      wbDetail: "订单详情",
      wbAttempts: "派工历史",
      wbAcceptance: "验收标准",
      wbDeps: "依赖",
      wbRouteError: "上次派工失败",
      wbRetryIn: "秒后重试",
      wbCapacity: "产能",
      wbBusy: "在跑",
      wbIdle: "空闲",
      wbNoAttempt: "尚未派工",
      wbTemp: "临时工",
      wbHireTemp: "雇临时工",
      wbTempName: "临时工名称（可留空）",
      wbTempCap: "任务上限（0=不限）",
      wbNoDept: "还没有部门，先建部门再派工",
      wbBorrowed: "跨部门借调",
      wbClose: "关闭",
      wbCreated: "创建",
      wbElapsed: "已用时",
      wbAttemptNo: "第 N 次",
      wbOrderTitle: "任务标题",
      wbOrderType: "类型",
      wbOrderDept: "部门",
      wbOrderProject: "项目",
      wbOrderDetail: "说明",
      wbSubmit: "提交",
      wbOrderPlaceholder: "一句话说明要做什么",
      wbPriority: "优先级",
      wbApplied: "已提交",
      wbFailed: "操作失败：",
      wbDepsBlocked: "依赖未完成",
      wbStale: "已吊销",
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
      mtApplyHint: "应用前先退出 DSH——运行中不替换自己。命令在终端执行，staged 包不会丢；junction（link:）安装会被拒绝。",
      mtRestart: "应用后需要重启 DSH 才能生效",
      mtResult: "结果",
      mtDisabled: "自动更新已关闭（update.enabled=false）",

      /* ---------- M/P 双通道等级与编号 · 公司架构面板（docs/16 §5） ---------- */
      cpCompanyName: "公司名称",
      cpCompanyNamePh: "输入公司名称",
      cpCompanyNameRequired: "公司名称不能为空",
      cpCompanyNameSaved: "已保存",
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
      cpStateFired: "已停用",
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
      cpECFilterLinked: "已关联名册",
      cpECFilterUnlinked: "未关联名册",
      cpRosterTitle: "名册关联",
      cpRosterLinked: "名册·已登记",
      cpRosterUnlinked: "名册·未登记",
      cpRosterRetired: "名册·已停用",
      cpRosterLink: "登记到名册",
      cpRosterUnlink: "解除关联",
      cpRosterSyncAll: "批量登记未关联",
      cpRosterUnavailable: "名册不可用（读不到 registry.json）",
      cpRosterHint: "员工中心会显示每位员工的名册关联状态；「登记到名册」会把公司档案（姓名/岗位/职责/技能/模型）写入名册。",
      cpNoLeader: "未设负责人",
      cpChartEmpty: "暂无部门，点右上角「新建部门」",
      cpDeptBoxHint: "点击查看部门详情",
      cpNewDept: "新建部门",
      cpNewDeptId: "部门 ID（可选）",
      cpNewDeptName: "部门名称",
      cpNewDeptDesc: "部门说明",
      cpNewDeptCapacity: "编制人数",
      cpNewDeptBrief: "一句话描述（可选，自动解析）",
      cpNewDeptBriefPh: "例：新建市场部，编制 5 人，负责市场推广",
      cpPreviewDept: "创建预览",
      cpPreviewTitle: "创建预览",
      cpPreviewHint: "以下为自动解析结果，可直接修改，确认无误后点「创建」。",
      cpPreviewRosterHint: "创建后员工会自动登记进名册（名册可用时），员工中心会显示「名册·已登记」。",
      cpPreviewBack: "返回修改",
      cpDeptEmployees: "本部门员工",
      cpPreviewNoEmployees: "暂无员工，创建后可招聘或调岗",
      cpPlannedHint: "技能来自本机已安装技能列表；岗位/技能/模型可作为预设修改，点「创建」会连同员工一并写入。可修改姓名/岗位/技能/模型/通道/等级或删除。",
      cpEmployeeName: "员工姓名",
      cpPreviewEmpFailed: "部门已创建，但有员工创建失败：",
      cpEmpTitle: "岗位",
      cpEmpSkills: "技能（、分隔）",
      cpEmpModel: "模型（默认继承）",
      cpModalChart: "部门架构图",
      cpModalMembers: "成员详情",
      // v6（docs/24 §6.4）：开发模式预设面板文案
      cpModalPreset: "开发模式",
      cpPresetTitle: "游戏开发模式",
      cpPresetApply: "套用模式",
      cpPresetClear: "清除模式",
      cpPresetEmpty: "该部门尚未套用开发模式。",
      cpPresetOutdated: "可更新",
      cpPresetAppliedAt: "套用于 {time}",
      cpPresetOwner: "负责人",
      cpPresetParticipants: "参与",
      cpPresetDeliverables: "交付物",
      cpPresetGates: "验收门禁",
      cpPresetUnassigned: "未分配",
      cpPresetStage: "阶段",
      cpPresetHint: "套用后可在成员详情里补齐岗位与技能。",
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
      cpEffort: "推理强度",
      cpEffortDefault: "跟随模型默认",
      cpMemberProvider: "派生方式",
      cpMemberProviderDefault: "跟随公司默认",
      cpMemberProviderSpawn: "spawn（新会话）",
      cpMemberProviderFork: "fork（继承当前上下文）",
      cpMaxDepth: "子代理深度",
      cpMaxDepthHint: "0 = 禁止成员再开子代理",
      cpSessionPolicy: "会话策略",
      cpSessionPolicyDefault: "跟随雇佣类型",
      cpSessionPolicyResident: "resident（常驻复用）",
      cpSessionPolicyPerTask: "per_task（每单一个）",
      cpToolPolicy: "工具黑名单",
      cpToolPolicyHint: "逗号分隔，命中即拒绝调用（如 ops_bash, web_fetch）",
      cpTempMaxTasks: "任务上限",
      cpTempMaxTasksHint: "0 = 不限；到达上限后自动退场",
      cpAttrs: "运行属性",
      cpClose: "关闭",
      dpModalHint: "查看与修改成员：部门架构图与成员详情",
      wbEmptyQueued: "队列空着，点「下达任务」派一单",
      wbEmptyRouted: "已派单的工单会出现在这里",
      wbEmptyRunning: "当前没人正在执行",
      wbEmptyDone: "还没有完成的工单",
      wbEmptyAbnormal: "没有异常，一切正常",
      // 异常泳道里「已取消 / 已丢失」属于历史存档：默认收起，免得每次刷新都被旧单塞满
      wbClosedGroup: "已取消、已丢失",
      wbFoldShow: "展开",
      wbFoldHide: "收起",
      // v0.5.1：异常泳道增强——历史记录 + 手动清理 + 空泳道「重启进度」
      wbExceptionHistory: "异常记录",
      wbExceptionHistoryTip: "已关闭的异常订单（取消 / 失败 / 丢失），可手动清理",
      wbClearHistory: "清理记录",
      wbClearHistoryConfirm: "确定要清理 {count} 条异常记录吗？此操作不可撤销。",
      wbRestartProgress: "重启进度",
      wbNoCurrentAbnormal: "当前没有卡住的异常单",
      wbRestartProgressTip: "立即触发一次调度，推进所有可派 / 可恢复的单",
      // v0.5.2：已完成 / 异常记录跟随会话归档
      wbScopeSession: "只看本会话",
      wbScopeAll: "全部会话",
      wbScopeTip: "已完成与异常记录默认只显示当前对话的单；切到「全部会话」查看历史归档",
      wbArchivedHint: "另有 {count} 单属于其他会话，已归档",
      wbAbnormalTip: "活跃异常单；已关闭的历史在下方异常记录区",
      wbClearHistoryAgain: "再点一次确认",
      wbClearHistoryScope: "只清本会话",
      wbChat: "会话",
      wbChatUnknown: "无会话归属",
      wbCleared: "已清理 {count} 条",
    };

    const en = {
      mtModelPrefix: "Model: ",
      hrNameCol: "Display name / target",
      uProviderLabel: "provider",
      hrDefaultName: "New member ",
      wbCapacityUnit: " people",
      ocLeadTitle: "Owner: ",
      wbTaskProgress: "Tasks ",
      providerPh: "provider (blank = company default)",
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
      ocFoldIdle: "Show idle members",
      ocFoldHide: "Hide idle members",
      tcTaskLabel: "Task",
      tcNoTasks: "No tasks",
      ocEmptyTask: "Nothing to show yet: the company runtime is off, or it has no employees.",
      wbTitle: "Dispatch · Task flow",
      wbLaneQueued: "Queued",
      wbLaneRouted: "Routed",
      wbLaneRunning: "Running",
      wbLaneDone: "Done",
      wbLaneAbnormal: "Failed",
      wbSchedRunning: "Scheduler running",
      wbSchedStopped: "Scheduler stopped",
      wbTick: "Run now",
      wbNewOrder: "New order",
      wbEmptyLane: "none",
      wbNoOrder: "No orders yet. Use “New order”, or let the lead call company_order.",
      wbAssign: "Assign",
      wbAssignAuto: "Auto assign",
      wbReviewPass: "Approve",
      wbReviewReject: "Send back",
      wbCancel: "Cancel order",
      wbEscalate: "Escalate",
      wbDetail: "Order detail",
      wbAttempts: "Attempts",
      wbAcceptance: "Acceptance",
      wbDeps: "Dependencies",
      wbRouteError: "Last dispatch error",
      wbRetryIn: "s to retry",
      wbCapacity: "Capacity",
      wbBusy: "busy",
      wbIdle: "idle",
      wbNoAttempt: "not dispatched",
      wbTemp: "temp",
      wbHireTemp: "Hire temp",
      wbTempName: "Temp name (optional)",
      wbTempCap: "Task cap (0 = unlimited)",
      wbNoDept: "No department yet — create one first",
      wbBorrowed: "cross-dept",
      wbClose: "Close",
      wbCreated: "created",
      wbElapsed: "elapsed",
      wbAttemptNo: "attempt #",
      wbOrderTitle: "Title",
      wbOrderType: "Type",
      wbOrderDept: "Department",
      wbOrderProject: "Project",
      wbOrderDetail: "Detail",
      wbSubmit: "Submit",
      wbOrderPlaceholder: "What should be done",
      wbPriority: "Priority",
      wbApplied: "Submitted",
      wbFailed: "Failed: ",
      wbDepsBlocked: "blocked by deps",
      wbStale: "revoked",
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
      cpCompanyName: "Company name",
      cpCompanyNamePh: "Enter company name",
      cpCompanyNameRequired: "Company name is required",
      cpCompanyNameSaved: "Saved",
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
      cpECFilterLinked: "Linked to roster",
      cpECFilterUnlinked: "Not linked to roster",
      cpRosterTitle: "Roster link",
      cpRosterLinked: "Roster · linked",
      cpRosterUnlinked: "Roster · not linked",
      cpRosterRetired: "Roster · retired",
      cpRosterLink: "Register in roster",
      cpRosterUnlink: "Unlink",
      cpRosterSyncAll: "Register all unlinked",
      cpRosterUnavailable: "Roster unavailable (cannot read registry.json)",
      cpRosterHint: "The employee center shows each employee's roster link; “Register in roster” writes the company profile (name/title/duties/skills/model) into the roster.",
      cpNoLeader: "No leader",
      cpChartEmpty: "No departments yet. Use “New department”.",
      cpDeptBoxHint: "Click to view department",
      cpNewDept: "New department",
      cpNewDeptId: "Department ID (optional)",
      cpNewDeptName: "Department name",
      cpNewDeptDesc: "Department description",
      cpNewDeptCapacity: "Headcount capacity",
      cpNewDeptBrief: "One-line description (optional, auto-parsed)",
      cpNewDeptBriefPh: "e.g. New marketing department, 5 people, handles promotion",
      cpPreviewDept: "Create preview",
      cpPreviewTitle: "Create preview",
      cpPreviewHint: "Auto-parsed details below; edit if needed, then click Create.",
      cpPreviewRosterHint: "Employees will be auto-registered to the roster on creation (when available); the employee center shows \"Roster · registered\".",
      cpPreviewBack: "Back to edit",
      cpDeptEmployees: "Department employees",
      cpPreviewNoEmployees: "No employees yet. Hire or transfer after creation.",
      cpPlannedHint: "Skills come from the installed skill catalog. Title/skills/model presets are editable; Create writes the department together with its employees.",
      cpEmployeeName: "Employee name",
      cpPreviewEmpFailed: "Department created, but some employees failed:",
      cpEmpTitle: "Title",
      cpEmpSkills: "Skills (comma separated)",
      cpEmpModel: "Model (inherit by default)",
      cpModalChart: "Department chart",
      cpModalMembers: "Member details",
      // v6 (docs/24 §6.4): game dev preset panel copy
      cpModalPreset: "Game dev mode",
      cpPresetTitle: "Game dev mode",
      cpPresetApply: "Apply mode",
      cpPresetClear: "Clear mode",
      cpPresetEmpty: "This department has not applied a game dev preset yet.",
      cpPresetOutdated: "update available",
      cpPresetAppliedAt: "Applied {time}",
      cpPresetOwner: "Owner",
      cpPresetParticipants: "Participants",
      cpPresetDeliverables: "Deliverables",
      cpPresetGates: "Acceptance gates",
      cpPresetUnassigned: "Unassigned",
      cpPresetStage: "Stage",
      cpPresetHint: "After applying, fill role slots and skills in member details.",
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
      cpEffort: "Reasoning effort",
      cpEffortDefault: "Model default",
      cpMemberProvider: "Member provider",
      cpMemberProviderDefault: "Company default",
      cpMemberProviderSpawn: "spawn (new session)",
      cpMemberProviderFork: "fork (inherit context)",
      cpMaxDepth: "Sub-agent depth",
      cpMaxDepthHint: "0 = members may not spawn sub-agents",
      cpSessionPolicy: "Session policy",
      cpSessionPolicyDefault: "Follow hiring kind",
      cpSessionPolicyResident: "resident (reuse)",
      cpSessionPolicyPerTask: "per_task (one per order)",
      cpToolPolicy: "Tool deny list",
      cpToolPolicyHint: "Comma separated; matched tools are rejected (e.g. ops_bash, web_fetch)",
      cpTempMaxTasks: "Task cap",
      cpTempMaxTasksHint: "0 = unlimited; retires automatically when reached",
      cpAttrs: "Runtime attributes",
      cpClose: "Close",
      dpModalHint: "View and edit members: department chart and member details",
      wbEmptyQueued: "Queue is empty — use New order to dispatch one",
      wbEmptyRouted: "Routed orders show up here",
      wbEmptyRunning: "Nobody is executing right now",
      wbEmptyDone: "No finished orders yet",
      wbEmptyAbnormal: "No anomalies — all good",
      wbClosedGroup: "Cancelled / lost",
      wbFoldShow: "Show",
      wbFoldHide: "Hide",
      // v0.5.1
      wbExceptionHistory: "Exception history",
      wbExceptionHistoryTip: "Closed exception orders (cancelled / failed / lost). You can clear them manually.",
      wbClearHistory: "Clear history",
      wbClearHistoryConfirm: "Are you sure you want to clear {count} exception records? This cannot be undone.",
      wbRestartProgress: "Restart progress",
      wbNoCurrentAbnormal: "No stuck exceptions right now",
      wbRestartProgressTip: "Trigger scheduler now to advance all dispatchable / recoverable orders",
      // v0.5.2: archive done / exception records by chat
      wbScopeSession: "This chat",
      wbScopeAll: "All chats",
      wbScopeTip: "Done and exception records default to the current chat only; switch to All chats to see the archive",
      wbArchivedHint: "{count} from other chats archived",
      wbAbnormalTip: "Live exception orders; closed ones are listed in Exception history below",
      wbClearHistoryAgain: "Click again to confirm",
      wbClearHistoryScope: "This chat only",
      wbChat: "chat",
      wbChatUnknown: "no chat",
      wbCleared: "Cleared {count}",
    };

    /* ------------------------------ 样式 ------------------------------ */

    /* --------------- 面板交互态样式（作用域 .mm-panel） ---------------
   内联 style 对象表达不了 :hover/:active/:disabled，因此按钮只保留尺寸，
   颜色与四态全部交给这张注入表；作用域锁在面板根，不污染宿主 UI。 */
const PANEL_THEME_ID = "mm-theme-style";
const PANEL_THEME_CSS = [
  ".mm-panel button{border-radius:6px;font-size:11.5px;line-height:1.4;cursor:pointer}",
  ".mm-panel .mm-btn,.mm-panel .mm-btn-p,.mm-panel .mm-btn-d{border:1px solid rgba(127,127,127,.38);background:transparent;color:inherit;",
  "transition:background .15s,border-color .15s,color .15s,box-shadow .15s}",
  ".mm-panel .mm-btn:hover:not(:disabled){border-color:rgba(127,127,127,.70);background:rgba(127,127,127,.13)}",
  ".mm-panel .mm-btn:active:not(:disabled){background:rgba(127,127,127,.20)}",
  ".mm-panel button:focus-visible{outline:2px solid var(--mm-ring,var(--mm-accent,#2f6feb));outline-offset:2px}",
  ".mm-panel button:disabled{opacity:.62;cursor:not-allowed!important;border-style:dashed!important}",
  ".mm-panel button[data-on='1']{cursor:default}",
  ".mm-panel button[data-on='0']:hover{background:rgba(127,127,127,.10)!important}",
  ".mm-panel .mm-btn{padding:6px 12px}",
  // .mm-btn-sm 的尺寸（padding/圆角/字号/nowrap）由 S.btnSm 内联给出，
  // 这里不再重复一遍 —— 双份真相会导致「改内联不生效」「改 CSS 只在部分按钮生效」。
  ".mm-panel .mm-btn-sm{white-space:nowrap}",
  ".mm-panel .mm-btn-p{border-color:transparent;background:var(--mm-accent,#2f6feb);color:#fff}",
  ".mm-panel .mm-btn-p:hover:not(:disabled){background:#2559c4!important;border-color:transparent!important;color:#fff!important}",
  ".mm-panel .mm-btn-p:active:not(:disabled){background:#1f4aa8!important;color:#fff!important}",
  ".mm-panel .mm-btn-d{border-color:rgba(180,35,24,.42);color:#b42318}",
  ".mm-panel .mm-btn-d:hover:not(:disabled){border-color:rgba(180,35,24,.62)!important;background:rgba(180,35,24,.08)!important;color:#b42318!important}",
  ".mm-panel input:focus-visible,.mm-panel select:focus-visible,.mm-panel textarea:focus-visible{",
  "outline:2px solid var(--mm-ring,var(--mm-accent,#2f6feb));outline-offset:1px;border-color:var(--mm-ring,var(--mm-accent,#2f6feb))!important}",
  ".mm-panel table tbody tr{transition:background .12s}",
  ".mm-panel table tbody tr:hover{background:rgba(127,127,127,.10)}",
  ".mm-panel{color-scheme:light dark;--mm-ring:#2f6feb;--mm-accent:#2f6feb}",
  ".mm-panel ::-webkit-scrollbar-thumb{background:rgba(127,127,127,.28);border-radius:8px;",
  "border:2px solid transparent;background-clip:content-box}",
  ".mm-panel ::-webkit-scrollbar-thumb:hover{background:rgba(127,127,127,.46);background-clip:content-box}",
  ".mm-panel ::-webkit-scrollbar{width:10px;height:10px}",
  ".mm-panel ::-webkit-scrollbar-track{background:transparent}",
  "@media (prefers-reduced-motion:reduce){.mm-panel *{transition:none!important;animation:none!important}}",
].join("");
(function injectPanelTheme() {
  try {
    const d = typeof document !== "undefined" ? document : null;
    if (!d || !d.head || d.getElementById(PANEL_THEME_ID)) return;
    const st = d.createElement("style");
    st.id = PANEL_THEME_ID;
    st.textContent = PANEL_THEME_CSS;
    d.head.appendChild(st);
  } catch (err) {
    /* 注入失败不影响功能，退回宿主默认外观 */
  }
})();

/* 间距 / 圆角 / 字号 / 语义色的唯一出处：S 里只引用这里，不再写字面量 */
const T = {
  gap: { xs: 4, sm: 8, md: 12, lg: 16 },
  radius: { xs: 2, sm: 6, md: 8, lg: 10, xl: 12, xxl: 14, pill: 999 },
  font: { xxs: 10.5, xs: 10.5, sm: 11.5, md: 11.5, base: 11.5, mdLg: 13, title: 13, lg: 13, xl: 13, xl2: 13, h: 18 },
  line: "rgba(127,127,127,.22)",
  lineSoft: "rgba(127,127,127,.10)",
  surface: "rgba(127,127,127,.05)",
  accent: "#2f6feb",
  accentSoft: "rgba(47,111,235,.12)",
  ok: "#1a7f37",
  warn: "#7d5300",
  danger: "#b42318",
};

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
      h: { margin: 0, fontSize: T.font.h, fontWeight: 600, letterSpacing: ".01em" },
      sub: { margin: "4px 0 0", opacity: 0.68, fontSize: T.font.md, maxWidth: 620 },
      actions: { display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" },
      bar: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 },
      btn: { padding: "6px 12px", borderRadius: T.radius.sm, cursor: "pointer", fontSize: T.font.base },
      btnPrimary: { padding: "6px 12px", borderRadius: T.radius.sm, border: "1px solid transparent", background: T.accent, color: "#fff", cursor: "pointer", fontSize: T.font.base },
      // 页签：分段控件外观（浅底容器 + 选中项用 Canvas 色浮起），与操作按钮区分开
      tabs: { display: "inline-flex", gap: 2, padding: 3, borderRadius: T.radius.md, background: T.surface, marginBottom: T.gap.md },
      tab: { padding: "5px 12px", borderRadius: T.radius.sm, border: "1px solid transparent", background: "transparent", color: "inherit", cursor: "pointer", fontSize: T.font.base, opacity: 0.75 },
      tabOn: { padding: "5px 12px", borderRadius: T.radius.sm, border: "1px solid rgba(127,127,127,.18)", background: "Canvas", color: "CanvasText", cursor: "pointer", fontSize: T.font.base, fontWeight: 600, boxShadow: "0 1px 2px rgba(0,0,0,.10)", opacity: 1 },
      tabCount: { marginLeft: 5, opacity: 1, fontWeight: 400, fontSize: T.font.xs },
      // 小组卡片：表头做成有底色的条，表格贴边（卡片不再有内边距）
      card: { border: "1px solid " + T.line, borderRadius: T.radius.lg, marginBottom: T.gap.md + 2, overflow: "hidden", background: "transparent" },
      cardHead: { display: "flex", alignItems: "center", gap: T.gap.sm + 2, padding: "11px 14px", borderBottom: "1px solid rgba(127,127,127,.14)", background: "rgba(127,127,127,.045)" },
      cardTitle: { fontWeight: 600, fontSize: T.font.title },
      cardDesc: { fontSize: T.font.md, opacity: 0.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320 },
      countPill: { padding: "1px 8px", borderRadius: T.radius.pill, background: "rgba(127,127,127,.14)", fontSize: T.font.sm },
      table: { width: "100%", borderCollapse: "collapse", tableLayout: "fixed" },
      // 固定列宽，避免内容长短把列挤得忽宽忽窄；操作列要放得下并排的「编辑 / 停用」
      colName: { width: "28%" },
      colRole: { width: "25%" },
      colSkills: { width: "20%" },
      colGroup: { width: "13%" },
      colActions: { width: "120px" },
      th: { textAlign: "left", padding: "7px 14px", borderBottom: "1px solid rgba(127,127,127,.16)", fontSize: T.font.sm, opacity: 0.68, fontWeight: 600, background: "rgba(127,127,127,.02)" },
      td: { padding: "10px 14px", borderBottom: "1px solid " + T.lineSoft, verticalAlign: "top" },
      mono: { fontFamily: "ui-monospace, Consolas, monospace", fontSize: T.font.sm, opacity: 0.65 },
      badge: { display: "inline-block", padding: "1px 7px", margin: "0 4px 3px 0", borderRadius: T.radius.pill, background: "rgba(127,127,127,.16)", fontSize: T.font.xs },
      // 模型徽标可能很长（provider/model），单行省略，避免把名称列撑成两行
      modelTag: {
        display: "inline-block",
        maxWidth: "100%",
        padding: "1px 7px",
        borderRadius: T.radius.lg,
        background: "rgba(127,127,127,.16)",
        fontSize: T.font.xs,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        verticalAlign: "bottom",
        boxSizing: "border-box",
      },
      warnBadge: { display: "inline-block", padding: "1px 7px", margin: "0 4px 3px 0", borderRadius: T.radius.lg, background: "rgba(210,150,30,.18)", fontSize: T.font.xs },
      retired: { opacity: 0.55 },
      rowActions: { display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "nowrap" },
      btnSm: { padding: "5px 9px", borderRadius: T.radius.sm, cursor: "pointer", fontSize: T.font.sm, whiteSpace: "nowrap" },
      btnSmDanger: { padding: "5px 9px", borderRadius: T.radius.sm, border: "1px solid rgba(180,35,24,.42)", color: "#b42318", cursor: "pointer", fontSize: T.font.sm, whiteSpace: "nowrap" },
      btnGhostDanger: { padding: "3px 8px", borderRadius: T.radius.sm, border: "1px solid transparent", background: "transparent", color: "#b42318", cursor: "pointer", fontSize: T.font.sm, opacity: 0.8 },
      selectSm: { width: "100%", boxSizing: "border-box", padding: "4px 7px", borderRadius: T.radius.sm, border: "1px solid rgba(127,127,127,.35)", background: "transparent", color: "inherit", font: "inherit", fontSize: T.font.md },
      emptyBox: { padding: "22px 14px", textAlign: "center", color: "#5b6069", fontSize: T.font.md, lineHeight: 1.8, whiteSpace: "pre-line" },
      err: { padding: "8px 10px", borderRadius: T.radius.sm, background: "rgba(180,35,24,.12)", color: "#b42318", marginBottom: 10, fontSize: T.font.md },
      hint: { padding: "8px 10px", borderRadius: T.radius.sm, background: "rgba(210,150,30,.12)", marginBottom: 10, fontSize: T.font.md },
      form: { border: "1px solid rgba(127,127,127,.3)", borderRadius: T.radius.md, padding: 12, marginBottom: 12, background: "rgba(127,127,127,.05)" },
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
        borderRadius: T.radius.xl,
        background: "Canvas",
        color: "CanvasText",
        border: "1px solid rgba(127,127,127,.35)",
        boxShadow: "0 18px 50px rgba(0,0,0,.45)",
      },
      field: { marginBottom: 8 },
      label: { display: "block", fontSize: T.font.sm, opacity: 0.7, marginBottom: 3 },
      input: { width: "100%", boxSizing: "border-box", padding: "5px 8px", borderRadius: T.radius.sm, border: "1px solid rgba(127,127,127,.4)", background: "transparent", color: "inherit", font: "inherit", fontSize: T.font.base },
      ta: { width: "100%", boxSizing: "border-box", minHeight: 56, padding: "5px 8px", borderRadius: T.radius.sm, border: "1px solid rgba(127,127,127,.4)", background: "transparent", color: "inherit", font: "inherit", fontSize: T.font.base },
      // 弹窗专用的大号控件：面板放大到 900px/90vh 后，字段与文字同步放大，
      // 避免「面板变大、内容还是小字」的失衡。仅在弹窗（plain）下启用，
      // 页面里的内嵌表单（如新建分组）保持原尺寸。
      titleLg: { fontWeight: 600, fontSize: T.font.h, letterSpacing: ".01em", margin: 0 },
      fieldLg: { marginBottom: 0 },
      labelLg: { display: "block", fontSize: T.font.base, opacity: 0.72, marginBottom: 5 },
      inputLg: { width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: T.radius.md, border: "1px solid rgba(127,127,127,.4)", background: "transparent", color: "inherit", font: "inherit", fontSize: T.font.lg },
      // 职责文本域压到 88px：默认能看到 3~4 行，仍可手动拉高，整张表单因此能塞进一屏
      taLg: { width: "100%", boxSizing: "border-box", minHeight: 88, padding: "8px 10px", borderRadius: T.radius.md, border: "1px solid rgba(127,127,127,.4)", background: "transparent", color: "inherit", font: "inherit", fontSize: T.font.lg, lineHeight: 1.55, resize: "vertical" },
      btnLg: { padding: "8px 16px", borderRadius: T.radius.md, border: "1px solid rgba(127,127,127,.4)", background: "transparent", color: "inherit", cursor: "pointer", fontSize: T.font.title },
      btnPrimaryLg: { padding: "8px 16px", borderRadius: T.radius.md, border: "1px solid transparent", background: T.accent, color: "#fff", cursor: "pointer", fontSize: T.font.title },
      // 弹窗的版式：标题区 → 分组（细线上边 + 左侧强调条）→ 两列网格对齐 → 底部操作栏
      headLg: { marginBottom: 12 },
      subLg: { marginTop: 4, display: "flex", alignItems: "center", gap: 8, fontSize: T.font.md, opacity: 0.65 },
      monoLg: { fontFamily: "ui-monospace, Consolas, monospace", fontSize: T.font.md },
      sectionLg: { marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(127,127,127,.16)" },
      sectionHeadLg: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: T.font.base, fontWeight: 600, letterSpacing: ".02em", opacity: 0.85 },
      accentLg: { width: 3, height: 12, borderRadius: T.radius.xs, background: T.accent, flex: "0 0 auto" },
      gridLg: { display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 16, rowGap: 10, alignItems: "start" },
      // 技能 / 模型并排成两列，省掉一整段纵向高度（一屏内显示的关键）
      duoLg: { display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 20, alignItems: "start" },
      // 分组标题旁的「选择…」高亮小按钮：蓝底淡色 + 蓝字，不与底部主按钮抢视觉
      pickLg: { padding: "2px 10px", borderRadius: T.radius.pill, border: "1px solid rgba(47,111,235,.55)", background: "rgba(47,111,235,.12)", color: T.accent, cursor: "pointer", fontSize: T.font.md, fontWeight: 600, whiteSpace: "nowrap" },
      modelLineLg: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8, minHeight: 20 },
      modelValueLg: { fontFamily: "ui-monospace, Consolas, monospace", fontSize: T.font.md, opacity: 0.8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
      clearLinkLg: { fontSize: T.font.sm, opacity: 0.6, cursor: "pointer", textDecoration: "underline", flex: "0 0 auto" },
      stackLg: { marginBottom: 10 },
      chipsLg: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 6 },
      footerLg: { display: "flex", alignItems: "center", gap: 10, marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(127,127,127,.16)" },
      hintLg: { fontSize: T.font.md, opacity: 0.5, marginRight: "auto" },
      badgeLg: { display: "inline-block", padding: "2px 9px", borderRadius: T.radius.lg, background: "rgba(127,127,127,.16)", fontSize: T.font.md },
      statusLg: { display: "inline-block", padding: "1px 8px", borderRadius: T.radius.lg, fontSize: T.font.sm, background: "rgba(47,111,235,.14)", color: "inherit" },
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
        borderRadius: T.radius.lg,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxShadow: "0 12px 40px rgba(0,0,0,.3)",
        border: "1px solid rgba(127,127,127,.3)",
      },
      pickerHead: { padding: "12px 14px", borderBottom: "1px solid rgba(127,127,127,.2)" },
      pickerTitle: { fontWeight: 600, marginBottom: 8, fontSize: T.font.title },
      pickerSearch: { width: "100%", boxSizing: "border-box", padding: "6px 9px", borderRadius: T.radius.sm, border: "1px solid rgba(127,127,127,.4)", background: "transparent", color: "inherit", font: "inherit", fontSize: T.font.mdLg },
      pickerList: { overflowY: "auto", flex: 1, padding: "6px 0" },
      pickerFoot: { padding: "10px 14px", borderTop: "1px solid rgba(127,127,127,.2)", display: "flex", gap: 8, alignItems: "center" },
      pickerMeta: { fontSize: T.font.md, opacity: 0.6 },
      pickerGroup: { padding: "6px 14px 2px", fontSize: T.font.xs, opacity: 0.55, letterSpacing: ".02em" },
      pickerEmpty: { padding: 14, opacity: 0.6, fontSize: T.font.md },
      pickerRow: (on) => ({ display: "flex", gap: 9, alignItems: "flex-start", padding: "7px 14px", cursor: "pointer", background: on ? "rgba(47,111,235,.10)" : "transparent" }),
      pickerRowTitle: { fontSize: T.font.mdLg, fontWeight: 500 },
      pickerRowMeta: { fontSize: T.font.sm, opacity: 0.6, marginTop: 2 },
    };

    // 弹窗与内嵌表单共用同一份 EditForm：按 plain 选尺寸，避免复制两份表单逻辑。
    const FORM_SM = {
      editTitle: { fontWeight: 600, fontSize: T.font.mdLg, margin: 0 },
      head: { marginBottom: 10 },
      sub: { marginTop: 2, display: "flex", alignItems: "center", gap: 6, fontSize: T.font.xs, opacity: 0.65 },
      mono: { fontFamily: "ui-monospace, Consolas, monospace", fontSize: T.font.xs },
      section: { marginTop: 12, paddingTop: 10, borderTop: "1px solid rgba(127,127,127,.16)" },
      sectionHead: { display: "flex", alignItems: "center", gap: 6, marginBottom: 8, fontSize: T.font.sm, fontWeight: 600, letterSpacing: ".02em", opacity: 0.8 },
      accent: { width: 3, height: 11, borderRadius: T.radius.xs, background: T.accent, flex: "0 0 auto" },
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
      hint: { fontSize: T.font.xs, opacity: 0.5, marginRight: "auto" },
      aside: { marginLeft: 6, fontWeight: 400, opacity: 0.6, fontSize: T.font.xs },
      duo: { display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 12, alignItems: "start" },
      pick: { padding: "1px 8px", borderRadius: T.radius.pill, border: "1px solid rgba(47,111,235,.5)", background: "rgba(47,111,235,.12)", color: T.accent, cursor: "pointer", fontSize: T.font.xs, fontWeight: 600, whiteSpace: "nowrap" },
      modelLine: { display: "flex", alignItems: "center", gap: 6, marginBottom: 6, minHeight: 18 },
      modelValue: { fontFamily: "ui-monospace, Consolas, monospace", fontSize: T.font.xs, opacity: 0.8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
      clearLink: { fontSize: T.font.xs, opacity: 0.6, cursor: "pointer", textDecoration: "underline", flex: "0 0 auto" },
      badge: S.badge,
      status: { display: "inline-block", padding: "0 6px", borderRadius: T.radius.lg, fontSize: T.font.xxs, background: "rgba(47,111,235,.14)" },
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
      aside: { marginLeft: 8, fontWeight: 400, opacity: 0.6, fontSize: T.font.md },
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

    function companyPost(action, args) {
      return api("/company/op", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: action, args: args || {} }),
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
                h("span", { style: S.modelTag, title: m.provider ? m.provider + " / " + m.model : m.model }, t("mtModelPrefix") + m.model),
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
            h("button", { style: S.btnSm, className: "mm-btn mm-btn-sm", disabled: busy, onClick: () => onEdit(m) }, t("edit")),
            m.isRetired
              ? h("button", { style: S.btnSm, className: "mm-btn mm-btn-sm", disabled: busy, onClick: () => onRestore(m.target) }, t("restore"))
              : h("button", { style: S.btnSmDanger, className: "mm-btn mm-btn-sm mm-btn-d", disabled: busy, onClick: () => onRetire(m) }, t("retire")),
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
            h("th", { style: S.th }, t("hrNameCol")),
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
                            s.source ? h("span", { style: { marginLeft: 6, fontWeight: 400, fontSize: T.font.xs, opacity: 0.6 } }, "· " + s.source) : null,
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
            h("button", { style: S.btnPrimary, className: "mm-btn mm-btn-p", onClick: props.onClose }, t("done")),
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
            h("button", { style: S.btnPrimary, className: "mm-btn mm-btn-p", onClick: onClose }, t("done")),
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
                h("div", null, h("label", { style: U.label }, t("uProviderLabel")), h("input", Object.assign(f("provider"), { placeholder: t("providerPh") }))),
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
      const [companyNameDraft, setCompanyNameDraft] = useState(null);
      const [companyNameSaved, setCompanyNameSaved] = useState(false);
      const [companyOpen, setCompanyOpen] = useState(false);
      const [companyBusy, setCompanyBusy] = useState(false);
      const [companyError, setCompanyError] = useState(null);

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

      const liveCompanyName = (state && state.company && typeof state.company.companyName === "string" && state.company.companyName) || "";

      function openCompanyEditor() {
        setCompanyNameDraft(liveCompanyName);
        setCompanyNameSaved(false);
        setCompanyError(null);
        setCompanyOpen(true);
      }

      async function submitCompanyName() {
        const name = String(companyNameDraft == null ? liveCompanyName : companyNameDraft).trim();
        if (!name) {
          setCompanyError(t("cpCompanyNameRequired"));
          return;
        }
        if (name === liveCompanyName) {
          setCompanyOpen(false);
          return;
        }
        setCompanyBusy(true);
        setCompanyError(null);
        try {
          await companyPost("setCompanyName", { name: name });
          setCompanyNameSaved(true);
          setCompanyOpen(false);
          await load();
        } catch (e) {
          setCompanyError(e && e.message ? e.message : String(e));
        } finally {
          setCompanyBusy(false);
        }
      }

      const companyModal = companyOpen
        ? h(
            "div",
            {
              style: {
                position: "fixed",
                inset: 0,
                zIndex: 2147483600,
                background: "rgba(15,23,32,.42)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 16,
              },
              onMouseDown: (e) => {
                if (e.target === e.currentTarget) setCompanyOpen(false);
              },
            },
            h(
              "div",
              {
                style: {
                  width: "min(420px,100%)",
                  background: "#fff",
                  color: "#1f2328",
                  borderRadius: T.radius.xl,
                  boxShadow: "0 18px 48px rgba(15,23,32,.28)",
                  padding: "16px 18px 14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                },
              },
              h(
                "div",
                { style: { display: "flex", alignItems: "center", gap: 8 } },
                h("strong", { style: { fontSize: T.font.lg } }, t("cpCompanyName")),
                h("span", { style: { flex: 1 } }),
                h("button", { style: S.btn, className: "mm-btn", onClick: () => setCompanyOpen(false) }, t("cancel")),
              ),
              h("input", {
                value: companyNameDraft == null ? liveCompanyName : companyNameDraft,
                placeholder: t("cpCompanyNamePh"),
                maxLength: 40,
                style: {
                  width: "100%",
                  boxSizing: "border-box",
                  font: "13px/1.6 inherit",
                  padding: "6px 10px",
                  border: "1px solid rgba(31,35,40,.22)",
                  borderRadius: T.radius.md,
                  background: "#fff",
                  color: "#1f2328",
                },
                onChange: (e) => {
                  setCompanyNameDraft(e.target.value);
                  setCompanyNameSaved(false);
                  setCompanyError(null);
                },
                onKeyDown: (e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitCompanyName();
                  } else if (e.key === "Escape") {
                    setCompanyOpen(false);
                  }
                },
              }),
              companyError ? h("div", { style: { fontSize: T.font.md, color: "#b42318" } }, companyError) : null,
              companyNameSaved ? h("div", { style: { fontSize: T.font.md, color: "#1a7f37" } }, t("cpCompanyNameSaved")) : null,
              h(
                "div",
                { style: { display: "flex", justifyContent: "flex-end", gap: 8 } },
                h("button", { style: S.btn, className: "mm-btn", disabled: companyBusy, onClick: () => setCompanyOpen(false) }, t("cancel")),
                h("button", { style: S.btnPrimary, className: "mm-btn mm-btn-p", disabled: companyBusy, onClick: submitCompanyName }, companyBusy ? t("cpSave") + "…" : t("cpSave")),
              ),
            ),
          )
        : null;

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
        return h("div", { style: S.wrap, className: "mm-panel" }, h("div", { style: S.err }, t("error") + "：" + error), h("div", { style: S.sub }, t("noApi")));
      }
      if (!state) return h("div", { style: S.wrap, className: "mm-panel" }, h("div", { style: S.sub }, "…"));

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
          { style: tab === key ? S.tabOn : S.tab, "data-on": tab === key ? "1" : "0", onClick: () => setTab(key) },
          label,
          count ? h("span", { style: S.tabCount }, count) : null,
        );

      return h(
        "div",
        { style: S.wrap, className: "mm-panel" },
        // 页头：左边标题 / 副标题 / 统计胶囊，右边操作按钮
        h(
          "div",
          { style: S.head },
          h(
            "div",
            { style: S.titleBlock },
            h(
              "div",
              { style: { display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" } },
              h("h3", { style: S.h }, t("title")),
              h(
                "button",
                {
                  type: "button",
                  title: t("cpCompanyName"),
                  onClick: openCompanyEditor,
                  style: {
                    margin: 0,
                    padding: 0,
                    border: 0,
                    background: "transparent",
                    color: "inherit",
                    cursor: "pointer",
                    font: "inherit",
                    fontSize: S.h.fontSize,
                    fontWeight: S.h.fontWeight,
                    letterSpacing: S.h.letterSpacing,
                    borderBottom: "1px dashed rgba(127,127,127,.45)",
                  },
                },
                liveCompanyName || t("cpCompanyNamePh"),
              ),
            ),
            h("p", { style: S.sub }, t("subtitle")),
          ),
          h(
            "div",
            { style: S.actions },
            h("button", { style: S.btn, className: "mm-btn", disabled: busy, onClick: load }, t("refresh")),
            h("button", { style: S.btnPrimary, className: "mm-btn mm-btn-p", disabled: busy, onClick: () => run("registerLive") }, busy ? t("syncing") : t("sync")),
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

        companyModal,

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
      return h("span", { style: { display: "inline-block", width: 8, height: 8, borderRadius: T.radius.pill, background: color, marginRight: 6 } });
    }

    const WF_TH = { padding: "6px 8px", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap", borderBottom: "1px solid rgba(127,127,127,0.25)" };
    const WF_TD = { padding: "6px 8px", verticalAlign: "top", borderBottom: "1px solid rgba(127,127,127,0.12)" };
    const WF_CARD = { border: "1px solid rgba(127,127,127,0.25)", borderRadius: T.radius.md, padding: "12px 14px", marginBottom: 14 };

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
          { style: { flex: "1 1 130px", minWidth: 120, padding: "10px 12px", borderRadius: T.radius.md, border: "1px solid rgba(127,127,127,0.22)" }, title: hint || "" },
          h("div", { style: { fontSize: T.font.xs, opacity: 0.7 } }, label),
          h("div", { style: { fontSize: T.font.h, fontWeight: 600, marginTop: 2 } }, value),
        );

      return h(
        "div",
        null,
        h(
          "div",
          { style: Object.assign({}, WF_CARD, { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }) },
          h("div", { style: { fontWeight: 600, marginRight: 6 } }, t("wfTitle")),
          h("span", { style: Object.assign({}, S.badge, { background: auto ? "rgba(26,127,55,0.14)" : "rgba(127,127,127,0.14)" }) }, auto ? t("wfLive") : t("wfPaused")),
          h("span", { style: { fontSize: T.font.xs, opacity: 0.65 } }, t("wfRefreshHint")),
          h("div", { style: { marginLeft: "auto", display: "flex", gap: 8 } },
            h("button", { style: S.btnSm, className: "mm-btn mm-btn-sm", disabled: busy, onClick: refreshOnce }, busy ? "…" : t("refresh")),
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
            { style: { width: "100%", borderCollapse: "collapse", fontSize: T.font.base } },
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
                      h("td", { style: WF_TD }, h("div", { style: { fontWeight: 600 } }, r.displayName), h("div", { style: Object.assign({}, S.mono, { fontSize: T.font.xs, opacity: 0.65 }) }, r.target)),
                      h("td", { style: WF_TD }, r.title || "—"),
                      h("td", { style: Object.assign({}, WF_TD, S.mono) }, r.model || "—"),
                      h("td", { style: WF_TD }, statusDot(r.status), r.status === "running" ? t("wfStatusRunning") : r.status === "idle" ? t("wfStatusIdle") : r.status === "unknown" ? t("wfStatusUnknown") : r.status),
                      h("td", { style: WF_TD },
                        r.work
                          ? h("div", null,
                              h("div", { style: { fontWeight: 500 } }, r.work.subject || r.work.taskId),
                              h("div", { style: { fontSize: T.font.xs, opacity: 0.65 } }, (r.work.status === "in_progress" ? t("wfTaskRunning") : t("wfTaskPending")) + " · " + fmtDur(r.work.elapsedMs)),
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
          h("div", { style: { fontSize: T.font.xs, opacity: 0.6, marginTop: 8 } }, t("wfUpdated", { time: new Date(snap.generatedAt || Date.now()).toLocaleTimeString() })),
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
                  { style: { width: "100%", borderCollapse: "collapse", fontSize: T.font.base } },
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
      toolbarTitle: { fontWeight: 600, fontSize: T.font.title, marginRight: 2 },
      toolbarSpacer: { marginLeft: "auto", display: "flex", gap: 8 },
      sub: { fontSize: T.font.sm, opacity: 0.62 },
      stats: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, maxWidth: 660, marginBottom: 12 },
      stat: { minWidth: 0, padding: "7px 10px", borderRadius: T.radius.md, border: "1px solid rgba(127,127,127,.18)", background: "rgba(127,127,127,.025)" },
      statLabel: { fontSize: T.font.xxs, opacity: 0.65, lineHeight: 1.4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
      statNum: { fontSize: T.font.xl, fontWeight: 650, lineHeight: 1.2, fontVariantNumeric: "tabular-nums" },
      metaCard: { maxWidth: 660, padding: "9px 12px", marginBottom: 12, borderRadius: T.radius.lg, border: "1px solid rgba(127,127,127,.18)", background: "rgba(127,127,127,.02)", display: "flex", flexDirection: "column", gap: 7 },
      metaRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 },
      metaLabel: { flex: "0 0 auto", fontSize: T.font.xxs, fontWeight: 600, opacity: 0.6, minWidth: 52 },
      metaText: { fontSize: T.font.xs, opacity: 0.72, lineHeight: 1.5 },
      numbering: { fontSize: T.font.xs, opacity: 0.72, lineHeight: 1.5 },
      legendWrap: { display: "flex", gap: 12, rowGap: 6, flexWrap: "wrap", minWidth: 0 },
      legendGroup: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
      legendTitle: { fontSize: T.font.xxs, fontWeight: 600, opacity: 0.6, marginRight: 2 },
      deptCard: { border: "1px solid rgba(127,127,127,.22)", borderRadius: T.radius.lg, marginBottom: 12, overflow: "hidden" },
      deptHead: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 13px", borderBottom: "1px solid rgba(127,127,127,.14)", background: "rgba(127,127,127,.045)" },
      deptCode: { fontFamily: "ui-monospace, Consolas, monospace", fontSize: T.font.sm, padding: "1px 7px", borderRadius: T.radius.sm, background: "rgba(127,127,127,.14)" },
      deptName: { fontWeight: 600, fontSize: T.font.mdLg },
      deptBody: { padding: "10px 13px" },
      columns: { display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" },
      column: { flex: "1 1 280px", minWidth: 240 },
      columnHead: { display: "flex", alignItems: "center", gap: 6, fontSize: T.font.sm, fontWeight: 600, opacity: 0.82, marginBottom: 6 },
      row: { display: "flex", alignItems: "center", gap: 8, padding: "5px 0", flexWrap: "wrap", borderBottom: "1px solid rgba(127,127,127,.08)" },
      code: { fontFamily: "ui-monospace, Consolas, monospace", fontSize: T.font.sm, minWidth: 54, opacity: 0.85 },
      name: { fontWeight: 600, fontSize: T.font.base },
      role: { fontSize: T.font.sm, opacity: 0.62 },
      emptyCol: { fontSize: T.font.sm, opacity: 0.42 },
      dot: { display: "inline-block", width: 8, height: 8, borderRadius: T.radius.pill, flex: "0 0 auto" },
      emptyHint: { padding: "0 14px 12px", fontSize: T.font.sm, opacity: 0.6 },
      sectionHead: { display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", fontSize: T.font.md, fontWeight: 600, margin: "4px 0 8px" },
      sectionTotal: { fontSize: T.font.sm, fontWeight: 400, opacity: 0.66 },
      costCols: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, alignItems: "stretch", marginBottom: 14, maxWidth: 1080 },
      costCol: { minWidth: 0, padding: "8px 10px", borderRadius: T.radius.md, border: "1px solid rgba(127,127,127,.20)", background: "rgba(127,127,127,.02)" },
      costColHead: { display: "flex", alignItems: "baseline", gap: 6, fontSize: T.font.xs, fontWeight: 600, marginBottom: 5, whiteSpace: "nowrap", overflow: "hidden" },
      costRow: { display: "flex", alignItems: "baseline", gap: 6, padding: "2px 0", borderBottom: "1px solid rgba(127,127,127,.08)" },
      costName: { fontSize: T.font.sm, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: "1 1 auto" },
      costNums: { marginLeft: "auto", fontSize: T.font.xxs, opacity: 0.68, whiteSpace: "nowrap", flex: "0 0 auto" },
      // v4 org chart: employee center card + leader nodes + department boxes (flex + borders as connectors)
      // v6 polished chart: framed canvas, centered management node, explicit connector lines
      // (stem -> bus -> branch drops) and equal-width branches.
      chart: { position: "relative", overflowX: "auto", padding: "18px 16px 16px", marginBottom: 12, borderRadius: T.radius.xxl, border: "1px solid rgba(47,111,235,.20)", background: "linear-gradient(180deg, rgba(47,111,235,.06), rgba(127,127,127,.015))" },
      ecCard: { flex: "0 0 320px", maxWidth: 340, border: "1px solid rgba(127,127,127,.28)", borderRadius: T.radius.lg, padding: "10px 12px", background: "rgba(127,127,127,.035)" },
      ecList: { maxHeight: 360, overflowY: "auto" },
      connectorH: { flex: "0 0 18px", alignSelf: "flex-start", height: 2, marginTop: 18, background: "rgba(127,127,127,.42)" },
      tree: { flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column" },
      leadersRow: { display: "flex", alignItems: "flex-start", gap: 14, borderTop: "2px solid rgba(127,127,127,.42)", overflowX: "auto" },
      branch: { flex: "1 1 0", minWidth: 172, maxWidth: 300, display: "flex", flexDirection: "column", alignItems: "stretch" },
      leaderNode: { display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 11px", borderRadius: T.radius.pill, border: "1px solid rgba(47,111,235,.34)", background: "rgba(47,111,235,.10)", color: "inherit", whiteSpace: "nowrap", boxShadow: "0 1px 3px rgba(47,111,235,.10)" },
      leaderGhost: { display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 11px", borderRadius: T.radius.pill, border: "1px dashed rgba(47,111,235,.38)", background: "transparent", fontSize: T.font.sm, opacity: 0.66, whiteSpace: "nowrap" },
      connectorV: { width: 2, height: 16, background: "rgba(127,127,127,.42)" },
      deptBox: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 5, margin: "0 8px", padding: "10px 12px", borderRadius: T.radius.xl, border: "1px solid rgba(47,111,235,.26)", background: "rgba(127,127,127,.035)", boxShadow: "0 1px 3px rgba(0,0,0,.06)", color: "inherit", cursor: "pointer", font: "inherit", textAlign: "left" },
      deptBoxName: { fontWeight: 600, fontSize: T.font.mdLg },
      deptBoxMeta: { fontSize: T.font.xs, opacity: 0.7, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" },
      leaderCard: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 10px", borderRadius: T.radius.md, border: "1px solid rgba(127,127,127,.26)", marginBottom: 12 },
      inlineForm: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 0 10px", borderBottom: "1px solid rgba(127,127,127,.10)" },
      inlineField: { display: "flex", alignItems: "center", gap: 6, fontSize: T.font.sm },
      mgmtRow: { display: "flex", justifyContent: "center", marginBottom: 0 },
      mgmtNode: { display: "inline-flex", alignItems: "baseline", gap: 8, padding: "8px 18px", borderRadius: T.radius.pill, border: "1px solid rgba(47,111,235,.42)", background: "linear-gradient(90deg, rgba(47,111,235,.16), rgba(124,58,237,.14))", boxShadow: "0 2px 10px rgba(47,111,235,.14)", color: "inherit", cursor: "pointer", font: "inherit", fontWeight: 700, fontSize: T.font.title },
      chartInner: { minWidth: 640, paddingTop: 2 },
      mgmtStem: { width: 2, height: 18, margin: "0 auto", borderRadius: T.radius.xs, background: "linear-gradient(180deg, rgba(47,111,235,.55), rgba(47,111,235,.30))" },
      chartBus: { height: 2, borderRadius: T.radius.xs, background: "linear-gradient(90deg, rgba(47,111,235,.18), rgba(47,111,235,.55), rgba(47,111,235,.18))" },
      branchesRow: { display: "flex", alignItems: "stretch", justifyContent: "center" },
      branchRail: { display: "flex", alignItems: "stretch", height: 2 },
      railArm: { flex: "1 1 0", height: 2, background: "rgba(47,111,235,.45)" },
      railArmHidden: { flex: "1 1 0", height: 2, background: "transparent" },
      branchDrop: { width: 2, height: 12, margin: "0 auto", borderRadius: T.radius.xs, background: "rgba(47,111,235,.45)" },
      branchStem: { width: 2, height: 12, margin: "0 auto", borderRadius: T.radius.xs, background: "rgba(47,111,235,.45)" },
      leaderWrap: { display: "flex", justifyContent: "center", alignItems: "center", minHeight: 30, padding: "0 8px" },
      deptMetaRow: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 2 },
      // v5.4 HR detail (expands below the employee row inside the department modal)
      hrPanel: { border: "1px solid rgba(127,127,127,.30)", borderRadius: T.radius.md, padding: "8px 10px", margin: "3px 0 8px", background: "rgba(127,127,127,.04)" },
      hrHead: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 },
      hrBlock: { marginTop: 6, paddingTop: 6, borderTop: "1px dashed rgba(127,127,127,.28)" },
      hrLabel: { fontSize: T.font.md, fontWeight: 700, marginBottom: 6 },
      hrGrid: { display: "grid", gridTemplateColumns: "minmax(120px, 190px) minmax(120px, 190px) minmax(0, 1fr)", gap: "6px 14px" },
      hrInfo: { display: "flex", gap: 6, fontSize: T.font.md, alignItems: "baseline" },
      hrInfoLabel: { color: "rgba(127,127,127,.95)", flex: "0 0 auto", minWidth: 68 },
      hrField: { display: "flex", flexDirection: "column", gap: 4, fontSize: T.font.sm },
      hrFieldLabel: { color: "rgba(127,127,127,.95)" },
      // v6（docs/24 §6.3）：开发模式预设徽章 / 弹层预设页签 / 阶段块
      presetBadge: { fontSize: T.font.xxs, padding: "1px 7px", borderRadius: T.radius.pill, border: "1px solid rgba(124,58,237,.42)", background: "rgba(124,58,237,.12)", whiteSpace: "nowrap" },
      presetHead: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 },
      presetSection: { border: "1px solid rgba(127,127,127,.20)", borderRadius: T.radius.lg, padding: "8px 10px", marginBottom: 8 },
      presetStage: { border: "1px solid rgba(124,58,237,.22)", borderRadius: T.radius.md, padding: "7px 9px", marginBottom: 6, background: "rgba(124,58,237,.035)" },
      presetStageHead: { display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 3 },
      presetLine: { fontSize: T.font.sm, lineHeight: 1.7, paddingLeft: 12, textIndent: "-12px" },
      presetRoleRow: { display: "flex", alignItems: "center", gap: 6, padding: "3px 0", flexWrap: "wrap" },
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
        borderRadius: T.radius.lg,
        fontSize: T.font.xs,
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

    /**
     * 纯函数：部门 preset 引用或 §3.2 解析结构 → 面板可渲染的预设视图（docs/24 §6.1）。
     * 字段缺失用空值兜底，任何异常都返回 null，绝不抛错（老数据无 preset 时面板照常渲染空态）。
     */
    function cpNormalizeDeptPreset(raw) {
      try {
        if (!raw || typeof raw !== "object") return null;
        const text = (value) => (value == null ? "" : String(value));
        const objectOf = (value) => (value && typeof value === "object" ? value : null);
        const list = (value) => (Array.isArray(value) ? value : []);
        const employeeOf = (value) => {
          const emp = objectOf(value);
          if (!emp) return null;
          const out = {
            id: emp.id == null ? null : text(emp.id),
            code: text(emp.code),
            displayName: text(emp.displayName) || (emp.id == null ? "" : text(emp.id)),
            level: text(emp.level),
          };
          return out.id === null && !out.code && !out.displayName ? null : out;
        };
        const roleOf = (value) => {
          const role = objectOf(value);
          if (!role) return null;
          const roleKey = text(role.roleKey || role.key || role.name);
          const roleName = text(role.roleName || role.name || roleKey);
          return { roleKey: roleKey, roleName: roleName, employee: employeeOf(role.employee) };
        };
        const id = text(raw.id).trim();
        const name = text(raw.name).trim();
        if (!id && !name) return null;
        const version = Number.isInteger(raw.version) && raw.version > 0 ? raw.version : null;
        const currentVersion = Number.isInteger(raw.currentVersion) && raw.currentVersion > 0 ? raw.currentVersion : version;
        const roles = list(raw.roles)
          .map((role) => objectOf(role))
          .filter(Boolean)
          .map((role) => {
            const name2 = text(role.name) || text(role.key);
            return {
              key: text(role.key),
              name: name2,
              channel: text(role.channel),
              level: text(role.level),
              titleHint: text(role.titleHint),
              employee: employeeOf(role.employee),
            };
          })
          .filter((role) => role.key || role.name);
        const stages = list(raw.stages)
          .map((stage) => objectOf(stage))
          .filter(Boolean)
          .map((stage, index) => ({
            key: text(stage.key),
            index: Number.isInteger(stage.index) && stage.index > 0 ? stage.index : index + 1,
            name: text(stage.name) || text(stage.key),
            goal: text(stage.goal),
            owner: roleOf(stage.owner),
            participants: list(stage.participants)
              .map((role) => roleOf(role))
              .filter(Boolean),
            deliverables: list(stage.deliverables)
              .map((item) => objectOf(item))
              .filter(Boolean)
              .map((item) => ({ key: text(item.key), name: text(item.name), description: text(item.description) }))
              .filter((item) => item.key || item.name),
            gates: list(stage.gates)
              .map((gate) => objectOf(gate))
              .filter(Boolean)
              .map((gate) => ({
                key: text(gate.key),
                name: text(gate.name) || text(gate.key),
                approverRole: text(gate.approverRole),
                approverName: text(gate.approverName) || text(gate.approverRole),
                description: text(gate.description),
              }))
              .filter((gate) => gate.key || gate.name),
          }))
          .sort((a, b) => a.index - b.index);
        return {
          id: id || name,
          name: name || id,
          version: version,
          currentVersion: currentVersion,
          outdated: version != null && currentVersion != null && version !== currentVersion,
          description: text(raw.description),
          appliedAt: raw.appliedAt == null || raw.appliedAt === "" ? null : text(raw.appliedAt),
          appliedBy: text(raw.appliedBy),
          roles: roles,
          stages: stages,
        };
      } catch (err) {
        return null;
      }
    }

    /** 纯函数：预设角色槽位 → 「制作人 · 游戏制作人 E0022」；无匹配员工 → 「制作人 · 未分配」。 */
    function cpPresetRoleLabel(item, unassignedLabel) {
      const row = item && typeof item === "object" ? item : {};
      const roleName = [row.name, row.roleName, row.roleKey, row.key]
        .map((value) => (value == null ? "" : String(value)))
        .find((value) => value !== "") || "";
      const fallback = unassignedLabel == null || unassignedLabel === "" ? t("cpPresetUnassigned") : String(unassignedLabel);
      const emp = row.employee && typeof row.employee === "object" ? row.employee : null;
      let who = fallback;
      if (emp) {
        const parts = [];
        if (emp.displayName != null && String(emp.displayName) !== "") parts.push(String(emp.displayName));
        if (emp.code != null && String(emp.code) !== "") parts.push(String(emp.code));
        who = parts.length ? parts.join(" ") : fallback;
      }
      return roleName ? roleName + " · " + who : who;
    }

    /** 纯函数：/company/overview.presets 目录 → [{id,name,version,description,stageCount,roleCount}]。 */
    function cpNormalizePresetCatalog(raw) {
      if (!Array.isArray(raw)) return [];
      const out = [];
      const seen = new Set();
      for (const item of raw) {
        if (!item || typeof item !== "object") continue;
        const id = item.id == null ? "" : String(item.id).trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const name = item.name == null ? "" : String(item.name).trim();
        out.push({
          id: id,
          name: name || id,
          version: Number.isInteger(item.version) && item.version > 0 ? item.version : null,
          description: item.description == null ? "" : String(item.description),
          stageCount: Number.isInteger(item.stageCount) && item.stageCount >= 0 ? item.stageCount : 0,
          roleCount: Number.isInteger(item.roleCount) && item.roleCount >= 0 ? item.roleCount : 0,
        });
      }
      return out;
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

      const cards = departments.map((dept) => ({ dept: dept, employees: [], preset: cpNormalizeDeptPreset(dept.preset) }));
      const cardById = new Map();
      for (const card of cards) {
        if (card.dept.id != null) cardById.set(String(card.dept.id), card);
      }
      // 部门解析不到的员工单独成卡（老宿主 department 字段可能为空/失效）
      const orphan = { dept: null, employees: [], preset: null };
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
            // v0.3.2：公司员工 ↔ 名册关联（roster 为 null 表示宿主/名册不可用，不能当成「未登记」）
            rosterTarget: emp.rosterTarget == null ? "" : String(emp.rosterTarget),
            roster:
              emp.roster && typeof emp.roster === "object"
                ? {
                    status: emp.roster.status == null ? "unlinked" : String(emp.roster.status),
                    target: emp.roster.target == null ? "" : String(emp.roster.target),
                    displayName: emp.roster.displayName == null ? "" : String(emp.roster.displayName),
                    retired: emp.roster.retired === true,
                    explicit: emp.rosterTarget != null && String(emp.rosterTarget) !== "",
                  }
                : null,
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
        // v6（docs/24 §3.2/§5）：部门可用预设目录 + 每张部门卡的 preset
        presets: cpNormalizePresetCatalog(data.presets),
        // v0.3.2：名册关联汇总（available=false 时面板显示「名册不可用」而不是全员未登记）
        roster: cpNormalizeRosterSummary(data.roster, allEmployees),
        managementName:
          data.management && typeof data.management === "object" && typeof data.management.name === "string"
            ? data.management.name.trim()
            : "",
      };
    }

    /**
     * v0.3.2：名册关联汇总。available=false（宿主未启用公司 / 读不到名册）时
     * 其余计数保持 0，面板据此提示「名册不可用」，绝不把「读不到」渲染成「全员未登记」。
     */
    function cpNormalizeRosterSummary(raw, employees) {
      const base = raw && typeof raw === "object" ? raw : {};
      const list = Array.isArray(employees) ? employees : [];
      const counts = { linked: 0, unlinked: 0, retired: 0 };
      for (const emp of list) {
        const status = emp && emp.roster && typeof emp.roster === "object" ? String(emp.roster.status || "unlinked") : "unlinked";
        if (status === "linked") counts.linked += 1;
        else if (status === "retired") counts.retired += 1;
        else counts.unlinked += 1;
      }
      return {
        available: base.available === true,
        total: list.length,
        linked: counts.linked,
        unlinked: counts.unlinked,
        retired: counts.retired,
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
     * "disabled" (state === "fired" only) | "linked" / "unlinked"（v0.3.2 名册关联）| department id.
     * Returns {filter,total,allCount,employees,linkedCount,unlinkedCount}; employees sorted per docs/16 §5.1.
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
        key !== "linked" &&
        key !== "unlinked" &&
        !cards.some((card) => card && card.dept && (String(card.dept.id) === key || String(card.dept.code) === key))
      ) {
        // 过滤目标部门已被删除时回落到全体员工，避免空列表卡住
        key = "all";
      }
      const isLinked = (emp) => Boolean(emp && emp.roster && emp.roster.status === "linked");
      let rows;
      if (key === "disabled") rows = all.filter((emp) => emp.state === "fired");
      else if (key === "linked") rows = all.filter(isLinked);
      else if (key === "unlinked") rows = all.filter((emp) => !isLinked(emp));
      else if (key === "all") rows = all.slice();
      else
        rows = all.filter(
          (emp) =>
            (emp.department != null && String(emp.department) === key) ||
            (emp.departmentCode != null && String(emp.departmentCode) === key),
        );
      rows.sort(cpCompareEmployee);
      const linkedCount = all.filter(isLinked).length;
      return {
        filter: key,
        total: rows.length,
        allCount: all.length,
        linkedCount,
        unlinkedCount: all.length - linkedCount,
        employees: rows,
      };
    }

    /** One-line "new department" heuristic parser (client-side only; docs/16 §5.3). */
    // v5.23: preset skills are pulled from the installed skill catalog (GET /skills).
    let CP_SKILL_CATALOG = null;
    let CP_SKILL_CATALOG_PENDING = null;
    async function ensureSkillCatalog() {
      if (Array.isArray(CP_SKILL_CATALOG)) return CP_SKILL_CATALOG;
      if (CP_SKILL_CATALOG_PENDING) return CP_SKILL_CATALOG_PENDING;
      CP_SKILL_CATALOG_PENDING = (async () => {
        let names = [];
        try {
          const data = await api("/skills");
          const rows = data && Array.isArray(data.skills) ? data.skills : [];
          names = rows.map((row) => String((row && row.name) || "")).filter(Boolean);
        } catch {
          names = [];
        }
        CP_SKILL_CATALOG = names;
        CP_SKILL_CATALOG_PENDING = null;
        return names;
      })();
      return CP_SKILL_CATALOG_PENDING;
    }
    // Chinese role-skill labels -> candidate catalog skill names (first existing wins, deduped).
    const CP_SKILL_LABEL_CATALOG = [
      { test: /系统设计|领域建模|技术选型|技术规划/, names: ["codebase-design", "domain-modeling"] },
      { test: /代码审阅|质量把关|审查|评审/, names: ["code-review"] },
      { test: /单元测试|自动化测试|用例设计|缺陷跟踪|质量检验|问题追踪/, names: ["tdd", "diagnosing-bugs"] },
      { test: /故障排查|应急响应|安全评估|漏洞扫描|问题升级|工单处理/, names: ["diagnosing-bugs"] },
      { test: /网络维护|终端支持|账号权限|系统管理|性能调优/, names: ["diagnose-windows-sandbox-acl"] },
      { test: /部署运维|监控告警|部署上线|数据管道|编码实现|服务端开发|前后端开发|接口设计|数据库设计|前端性能|组件开发|界面实现|移动开发|跨端适配|嵌入式开发|驱动调试|算法设计|模型训练/, names: ["implement"] },
      { test: /数据分析|SQL|可视化|报表|账务处理|报表编制|税务申报|数据建模|统计建模|特征工程|实验设计|财务分析|风险评估|库存管理|采购执行|数据质量/, names: ["office-xlsx", "research"] },
      { test: /文档写作|会议纪要|文档整理|合同审查|法规检索|合同跟进|方案撰写|汇报呈现|客户沟通|技术文档/, names: ["office-docx", "research"] },
      { test: /交互设计|视觉规范|原型制作|原型设计|海报设计|版式排版|印刷规范|品牌规范|VI 设计|视觉统一|插画绘制|创意提案|概念提炼|三维建模|材质渲染|灯光渲染|分镜设计|动效设计|需求分析|产品设计/, names: ["prototype", "writing-shape"] },
      { test: /文案撰写|校对润色|选题策划|内容规划|排期管理|内容投放|研究写作|脚本创作|台词打磨|内容运营/, names: ["writing-shape", "writing-fragments", "writing-beats"] },
      { test: /授课讲授|课程设计|效果评估|培训/, names: ["teach"] },
      { test: /文献调研|行业研究|调研|战略决策|客户开发|商务谈判/, names: ["research"] },
      { test: /团队管理|任务派发|绩效反馈|目标拆解|目标跟进|流程建设|计划排期|风险管控|跨团队协作|经营管理|组织建设|招聘管理|员工关系|绩效跟进|合规检查|底稿编制/, names: ["chief-of-staff"] },
      { test: /版本规划|计划排期|跨团队协作/, names: ["to-spec", "to-tickets"] },
      { test: /活动策划|活动执行|数据复盘|新媒体/, names: ["writing-shape", "office-xlsx"] },
      { test: /日程安排|行政事务|事务执行|沟通协调|客户沟通/, names: ["office-docx"] },
      { test: /拍摄执行|布光构图|素材管理|剪辑合成|字幕包装|版式排版/, names: ["file-processing-master", "office-render"] },
      { test: /技术选型|行业研究/, names: ["research", "codebase-design"] },
    ];
    function cpMapCatalogSkills(labels, catalog) {
      const names = Array.isArray(catalog) ? catalog.map((name) => String(name || "")) : [];
      if (!names.length) return Array.isArray(labels) ? labels.slice() : [];
      const out = [];
      for (const label of Array.isArray(labels) ? labels : []) {
        const text = String(label || "");
        if (!text) continue;
        const hit = CP_SKILL_LABEL_CATALOG.find((row) => row.test.test(text));
        for (const candidate of hit ? hit.names : []) {
          const found = names.find((name) => name === candidate || name.indexOf(candidate) >= 0 || candidate.indexOf(name) >= 0);
          if (found && out.indexOf(found) < 0) out.push(found);
        }
      }
      return out.slice(0, 4);
    }

    // v5.20/v5.21: role dictionary used to preset 岗位/技能/模型 for employees parsed from a brief.
    // Covers common office/computer-work roles; ordered specific -> generic (first match wins).
    const CP_PRESET_MODEL_PRO = "deepseek-v4-pro-0813";
    const CP_PRESET_MODEL_CODE = "kimi-k2.7-code";
    const CP_PRESET_MODEL_FLASH = "deepseek-v4.1-flash-1017";
    const CP_BRIEF_ROLE_PRESETS = [
      { test: /架构/, title: "架构师", skills: ["系统设计", "领域建模", "代码审阅", "技术选型"], model: CP_PRESET_MODEL_PRO },
      { test: /算法|机器学习|深度学习|大模型|AI|人工智能/i, title: "算法工程师", skills: ["算法设计", "模型训练", "效果评测"], model: CP_PRESET_MODEL_CODE },
      { test: /数据工程|ETL|数仓|大数据/, title: "数据工程师", skills: ["数据管道", "数据建模", "数据质量"], model: CP_PRESET_MODEL_CODE },
      { test: /数据分析|BI|报表/i, title: "数据分析师", skills: ["数据分析", "SQL 查询", "可视化报表"], model: CP_PRESET_MODEL_PRO },
      { test: /数据科学|数据挖掘|统计建模/, title: "数据科学家", skills: ["统计建模", "特征工程", "实验设计"], model: CP_PRESET_MODEL_PRO },
      { test: /安全|渗透|等保|风控安全/, title: "安全工程师", skills: ["安全评估", "漏洞扫描", "应急响应"], model: CP_PRESET_MODEL_CODE },
      { test: /DBA|数据库管理/i, title: "数据库管理员", skills: ["数据库运维", "备份恢复", "性能调优"], model: CP_PRESET_MODEL_CODE },
      { test: /运维|DevOps|SRE|部署|发布/i, title: "运维工程师", skills: ["部署运维", "监控告警", "故障排查"], model: CP_PRESET_MODEL_CODE },
      { test: /测试|QA|质量保证/i, title: "测试工程师", skills: ["自动化测试", "用例设计", "缺陷跟踪"], model: CP_PRESET_MODEL_CODE },
      { test: /3D|C4D|三维|建模|渲染/i, title: "3D 设计师", skills: ["三维建模", "材质渲染", "灯光渲染"], model: CP_PRESET_MODEL_PRO },
      { test: /平面设计|平面|海报|包装设计|印刷|宣传物料/, title: "平面设计师", skills: ["海报设计", "版式排版", "印刷规范"], model: CP_PRESET_MODEL_PRO },
      { test: /品牌|VI|视觉识别/i, title: "品牌设计师", skills: ["品牌规范", "VI 设计", "视觉统一"], model: CP_PRESET_MODEL_PRO },
      { test: /插画|原画|手绘/, title: "插画师", skills: ["插画绘制", "色彩搭配", "素材整理"], model: CP_PRESET_MODEL_PRO },
      { test: /创意|美术指导|广告创意/, title: "创意策划", skills: ["创意提案", "概念提炼", "方案撰写"], model: CP_PRESET_MODEL_PRO },
      { test: /编剧|脚本|分镜/, title: "编剧", skills: ["脚本创作", "分镜设计", "台词打磨"], model: CP_PRESET_MODEL_PRO },
      { test: /动画|动效/, title: "动画师", skills: ["动效设计", "动画制作", "节奏把控"], model: CP_PRESET_MODEL_PRO },
      { test: /摄影|摄像/, title: "摄影师", skills: ["拍摄执行", "布光构图", "素材管理"], model: CP_PRESET_MODEL_FLASH },
      { test: /文案|撰稿|写作|编辑/, title: "文案编辑", skills: ["文案撰写", "校对润色", "选题策划"], model: CP_PRESET_MODEL_FLASH },
      { test: /内容策划|选题策划|内容规划/, title: "内容策划", skills: ["内容规划", "选题策划", "排期管理"], model: CP_PRESET_MODEL_FLASH },
      { test: /交互|用户体验|UI|UX|视觉/i, title: "设计师", skills: ["交互设计", "视觉规范", "原型制作"], model: CP_PRESET_MODEL_PRO },
      { test: /前端|界面工程/, title: "界面工程师", skills: ["界面实现", "组件开发", "前端性能"], model: CP_PRESET_MODEL_CODE },
      { test: /移动端|Android|iOS|小程序|鸿蒙/i, title: "移动端工程师", skills: ["移动开发", "跨端适配", "性能优化"], model: CP_PRESET_MODEL_CODE },
      { test: /全栈/, title: "全栈工程师", skills: ["前后端开发", "接口设计", "部署上线"], model: CP_PRESET_MODEL_CODE },
      { test: /后端|服务端|Java|Go\b|Python|Node/i, title: "后端工程师", skills: ["服务端开发", "接口设计", "数据库设计"], model: CP_PRESET_MODEL_CODE },
      { test: /嵌入式|硬件|电子|驱动/, title: "嵌入式工程师", skills: ["嵌入式开发", "驱动调试", "硬件联调"], model: CP_PRESET_MODEL_CODE },
      { test: /网络|IT 支持|IT支持|桌面运维|系统管理/i, title: "IT 支持工程师", skills: ["网络维护", "终端支持", "账号权限"], model: CP_PRESET_MODEL_FLASH },
      { test: /技术经理|研发经理|技术负责人/, title: "技术经理", skills: ["技术规划", "团队管理", "代码审阅"], model: CP_PRESET_MODEL_PRO },
      { test: /产品经理|产品设计|产品规划/, title: "产品经理", skills: ["需求分析", "原型设计", "版本规划"], model: CP_PRESET_MODEL_PRO },
      { test: /项目经理|PMO|敏捷教练|项目主管/i, title: "项目经理", skills: ["计划排期", "风险管控", "跨团队协作"], model: CP_PRESET_MODEL_PRO },
      { test: /总经理|CEO|总裁|首席/i, title: "总经理", skills: ["经营管理", "战略决策", "组织建设"], model: CP_PRESET_MODEL_PRO },
      { test: /总监/, title: "总监", skills: ["业务规划", "团队管理", "目标拆解"], model: CP_PRESET_MODEL_PRO },
      { test: /经理|主管|组长|负责人/, title: "经理", skills: ["团队管理", "任务派发", "绩效反馈"], model: CP_PRESET_MODEL_PRO },
      { test: /战略|咨询|顾问/, title: "咨询顾问", skills: ["行业研究", "方案设计", "汇报呈现"], model: CP_PRESET_MODEL_PRO },
      { test: /市场|品牌|公关|广告|投放|渠道/, title: "市场专员", skills: ["活动策划", "内容投放", "数据复盘"], model: CP_PRESET_MODEL_FLASH },
      { test: /销售|商务|客户经理|大客户/, title: "销售经理", skills: ["客户开发", "商务谈判", "合同跟进"], model: CP_PRESET_MODEL_FLASH },
      { test: /客服|客户成功|售后/, title: "客服专员", skills: ["工单处理", "客户沟通", "问题升级"], model: CP_PRESET_MODEL_FLASH },
      { test: /运营|电商|活动|用户增长|新媒体/, title: "运营专员", skills: ["内容运营", "活动执行", "数据复盘"], model: CP_PRESET_MODEL_FLASH },
      { test: /翻译|本地化|口译/, title: "翻译", skills: ["中英互译", "术语管理", "校对"], model: CP_PRESET_MODEL_FLASH },
      { test: /视频|剪辑|摄影|动画/, title: "视频编辑", skills: ["剪辑合成", "字幕包装", "素材管理"], model: CP_PRESET_MODEL_FLASH },
      { test: /设计|美术/, title: "设计师", skills: ["视觉设计", "版式排版", "素材整理"], model: CP_PRESET_MODEL_PRO },
      { test: /人事|HR|招聘|薪酬|绩效|培训发展/i, title: "人事专员", skills: ["招聘管理", "员工关系", "绩效跟进"], model: CP_PRESET_MODEL_FLASH },
      { test: /行政|前台|秘书|助理/, title: "行政专员", skills: ["日程安排", "会议纪要", "行政事务"], model: CP_PRESET_MODEL_FLASH },
      { test: /财务|会计|出纳|税务|记账/, title: "会计", skills: ["账务处理", "报表编制", "税务申报"], model: CP_PRESET_MODEL_FLASH },
      { test: /审计|内控|合规/, title: "审计师", skills: ["底稿编制", "合规检查", "风险提示"], model: CP_PRESET_MODEL_PRO },
      { test: /法务|律师|知识产权|合同/, title: "法务专员", skills: ["合同审查", "风险提示", "法规检索"], model: CP_PRESET_MODEL_PRO },
      { test: /采购|供应链|物流|仓储|计划员/, title: "供应链专员", skills: ["采购执行", "库存管理", "供应商协同"], model: CP_PRESET_MODEL_FLASH },
      { test: /风控|投资|融资|金融|证券|银行/, title: "金融分析师", skills: ["财务分析", "风险评估", "报告撰写"], model: CP_PRESET_MODEL_PRO },
      { test: /教育|讲师|课程|培训师/, title: "培训讲师", skills: ["课程设计", "授课讲授", "效果评估"], model: CP_PRESET_MODEL_FLASH },
      { test: /研究|研究员|科研|实验/, title: "研究员", skills: ["文献调研", "实验设计", "研究写作"], model: CP_PRESET_MODEL_PRO },
      { test: /品控|质量工程|检验/, title: "质量工程师", skills: ["质量检验", "问题追踪", "标准执行"], model: CP_PRESET_MODEL_FLASH },
      { test: /审阅|评审|审查/, title: "审阅工程师", skills: ["代码审阅", "质量把关", "问题记录"], model: CP_PRESET_MODEL_PRO },
      { test: /编写|开发|实现|工程/, title: "工程师", skills: ["编码实现", "单元测试", "接口设计"], model: CP_PRESET_MODEL_CODE },
      { test: /专员|科员|干事/, title: "专员", skills: ["事务执行", "文档整理", "沟通协调"], model: CP_PRESET_MODEL_FLASH },
      { test: /管理/, title: "经理", skills: ["团队管理", "流程建设", "目标跟进"], model: CP_PRESET_MODEL_PRO },
    ];
    function cpBriefRolePreset(text) {
      const source = String(text || "");
      const hit = CP_BRIEF_ROLE_PRESETS.find((row) => row.test.test(source));
      return hit
        ? { title: hit.title, skills: hit.skills.slice(), model: hit.model || "" }
        : { title: "", skills: [], model: "" };
    }
    // Parse "名称负责职责、名称负责职责" style briefs into preset employee rows (pure client).
    function cpParseBriefEmployees(raw, capacity) {
      const text = String(raw || "");
      const cut = Math.max(text.lastIndexOf("："), text.lastIndexOf(":"));
      const tail = cut >= 0 ? text.slice(cut + 1) : text;
      const specs = tail
        .split(/[、，,;；\n]+/)
        .map((row) => row.trim())
        .filter(Boolean);
      const rows = [];
      for (const spec of specs) {
        if (rows.length >= 12) break;
        const m = /^(.{1,24}?)(?:负责|主管|承担)(.{1,80})$/.exec(spec);
        if (!m) continue;
        const displayName = m[1].trim();
        const duty = m[2].trim();
        if (!displayName || /^(新建|创建|成立|设立|部门|编制)/.test(displayName)) continue;
        const preset = cpBriefRolePreset(displayName + " " + duty);
        rows.push({
          displayName: displayName,
          title: preset.title,
          duties: duty ? [duty] : [],
          skills: preset.skills,
          channel: "P",
          level: "",
          model: preset.model || "",
        });
      }
      const cap = Number.isFinite(capacity) && capacity > 0 ? capacity : rows.length;
      return rows.slice(0, Math.max(0, cap));
    }
    function cpParseBrief(text) {
      const raw = text == null ? "" : String(text);
      const out = { name: "", capacity: null, charter: raw.trim(), employees: [] };
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
      out.employees = cpParseBriefEmployees(raw, out.capacity);
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
      const rosterChip = (() => {
        const link = emp && emp.roster && typeof emp.roster === "object" ? emp.roster : null;
        if (!link) return null;
        const status = String(link.status || "unlinked");
        const linked = status === "linked";
        const retired = status === "retired";
        return h(
          "span",
          {
            key: "roster",
            style: Object.assign({}, CP_STYLE.role, {
              color: linked ? "#1a7f37" : retired ? "#8a5a00" : "#a05a00",
              background: linked ? "rgba(26,127,55,.10)" : "rgba(210,150,30,.12)",
              borderRadius: T.radius.pill,
              padding: "1px 7px",
              fontSize: T.font.xs,
              fontWeight: 600,
              whiteSpace: "nowrap",
            }),
            title: t("cpRosterTitle") + "：" + (link.target || emp.id || ""),
          },
          linked ? t("cpRosterLinked") : retired ? t("cpRosterRetired") : t("cpRosterUnlinked"),
        );
      })();
      const cells = [
        h("span", { key: "code", style: CP_STYLE.code, title: t("cpCode") }, emp.code || "—"),
        ...badges,
        h("span", { key: "name", style: CP_STYLE.name }, emp.displayName || emp.id || "—"),
        h("span", { key: "role", style: CP_STYLE.role }, cpRoleLabel(t, emp.role)),
        rosterChip,
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
      // v0.3.2：名册关联操作的互斥状态（null / employeeId / "__all__"）
      const [linkBusy, setLinkBusy] = useState(null);

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

      /* ---------- v0.3.2：公司员工 ↔ 名册（登记 / 解除 / 批量登记） ---------- */

      const runRosterOp = useCallback(
        async (stateKey, action, args) => {
          if (linkBusy) return;
          setLinkBusy(stateKey);
          try {
            await companyPost(action, args || {});
            await load();
            setError(null);
          } catch (err) {
            setError(err && err.message ? err.message : String(err));
          } finally {
            setLinkBusy(null);
          }
        },
        [linkBusy, load],
      );

      const linkOne = useCallback((employeeId) => runRosterOp(String(employeeId), "linkEmployeeRoster", { employeeId: String(employeeId) }), [runRosterOp]);
      const unlinkOne = useCallback((employeeId) => runRosterOp(String(employeeId), "unlinkEmployeeRoster", { employeeId: String(employeeId) }), [runRosterOp]);
      const syncAll = useCallback(() => {
        const deptId =
          filter !== "all" && filter !== "disabled" && filter !== "linked" && filter !== "unlinked" ? filter : null;
        return runRosterOp("__all__", "syncEmployeesRoster", deptId ? { departmentId: deptId } : {});
      }, [filter, runRosterOp]);

      const header = (count, selectNode, rosterLine, syncNode) =>
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
            syncNode || null,
            h("button", { style: S.btnSm, className: "mm-btn mm-btn-sm", disabled: busy, onClick: load }, t("cpRefresh")),
          ),
          updatedAt ? h("div", { style: CP_STYLE.sub }, t("cpUpdated", { time: new Date(updatedAt).toLocaleTimeString() })) : null,
          rosterLine || null,
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
        h("option", { value: "linked" }, t("cpECFilterLinked")),
        h("option", { value: "unlinked" }, t("cpECFilterUnlinked")),
      );

      // v0.3.2：页头名册关联摘要 + 批量登记按钮（按当前筛选的部门；非部门筛选时对全公司）
      const roster = view.roster;
      const rosterLine = roster.available
        ? h(
            "div",
            { style: CP_STYLE.sub },
            t("cpRosterTitle") + "：" + t("cpRosterLinked") + " " + String(roster.linked) + " · " + t("cpRosterUnlinked") + " " + String(roster.unlinked) + (roster.retired ? " · " + t("cpRosterRetired") + " " + String(roster.retired) : ""),
          )
        : h("div", { style: S.hint }, t("cpRosterUnavailable"));
      const syncButton = roster.available && roster.unlinked > 0
        ? h(
            "button",
            { style: S.btnSm, className: "mm-btn mm-btn-sm", disabled: Boolean(linkBusy) || busy, onClick: syncAll },
            linkBusy === "__all__" ? t("cpLoading") : t("cpRosterSyncAll"),
          )
        : null;

      return h(
        "div",
        null,
        header(view.counts.employees, filterSelect, rosterLine, syncButton),
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
            ? h(
                "div",
                { style: CP_STYLE.ecList },
                ec.employees.map((emp, index) => {
                  const key = empKey(emp, index);
                  const link = emp && emp.roster && typeof emp.roster === "object" ? emp.roster : null;
                  const linked = Boolean(link && link.status === "linked");
                  let actionNode = null;
                  if (link) {
                    if (linked) {
                      // 只有显式 rosterTarget 才可解除；隐式关联（员工 id 即 target）没有可清除的字段
                      if (emp.rosterTarget) {
                        actionNode = h(
                          "button",
                          { key: "unlink", style: S.btnSm, className: "mm-btn mm-btn-sm", disabled: Boolean(linkBusy), onClick: () => unlinkOne(emp.id) },
                          t("cpRosterUnlink"),
                        );
                      }
                    } else {
                      actionNode = h(
                        "button",
                        {
                          key: "link",
                          style: S.btnSm, className: "mm-btn mm-btn-sm",
                          disabled: Boolean(linkBusy),
                          onClick: () => linkOne(emp.id),
                          title: t("cpRosterHint"),
                        },
                        linkBusy === String(emp.id) ? t("cpLoading") : t("cpRosterLink"),
                      );
                    }
                  }
                  return h(
                    "div",
                    { key: key, style: CP_STYLE.row },
                    cpRenderEmployeeRow(t, emp),
                    h("span", { style: { marginLeft: "auto" } }),
                    actionNode,
                  );
                }),
              )
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
      // v5.17：新建部门改为「创建预览」两步（一句话自动解析 → 预览可改 → 实际创建）。
      const [newDeptPreview, setNewDeptPreview] = useState(null);
      // v6（docs/24 §6.3）：部门弹层「开发模式」页签里待套用的预设 id（空串 = 用目录首项兜底）。
      const [presetPick, setPresetPick] = useState("");

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

      // v6（docs/24 §6.3）：开发模式预设的写操作——走既有 companyPost，成功后刷新 overview。
      async function applyDeptPreset(card, presetId) {
        if (!card || !card.dept || !presetId) return;
        setBusy(true);
        setOpError(null);
        setSaved(null);
        try {
          await companyPost("applyDepartmentPreset", { departmentId: card.dept.id, presetId: String(presetId) });
          setPresetPick("");
          await load();
          setSaved(t("cpSaved"));
        } catch (err) {
          setOpError(cpErrorText(err));
        } finally {
          setBusy(false);
        }
      }

      async function clearDeptPreset(card) {
        if (!card || !card.dept) return;
        setBusy(true);
        setOpError(null);
        setSaved(null);
        try {
          await companyPost("clearDepartmentPreset", { departmentId: card.dept.id });
          setPresetPick("");
          await load();
          setSaved(t("cpSaved"));
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
            style: S.btnSm, className: "mm-btn mm-btn-sm",
            disabled: busy,
            onClick: () => {
              setNewDeptError(null);
              setNewDeptDraft({ id: "", name: "", charter: "", capacity: "4", brief: "" });
              setNewDeptOpen(true);
            },
          },
          t("cpNewDept"),
        ),
        h("button", { style: S.btnSm, className: "mm-btn mm-btn-sm", disabled: busy, onClick: refresh }, busy ? "…" : t("cpRefresh")),
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
        h("span", { style: { fontWeight: 700, fontSize: T.font.title } }, view.managementName || t("cpManagement")),
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
            // v6（docs/24 §6.2）：已套用开发模式的部门卡显示预设徽章，版本落后时追加「· 可更新」
            card.preset
              ? h(
                  "span",
                  { style: CP_STYLE.presetBadge, title: t("cpPresetTitle") },
                  card.preset.name + (card.preset.outdated ? " · " + t("cpPresetOutdated") : ""),
                )
              : null,
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
          h("span", { style: { marginLeft: "auto" } }, h("button", { style: S.btnSm, className: "mm-btn mm-btn-sm", onClick: openNumberingEditor }, t("cpCustomize"))),
        ),
        h(
          "div",
          { style: CP_STYLE.metaRow },
          h("span", { style: CP_STYLE.metaLabel }, t("cpLegend")),
          legend,
          h("span", { style: { marginLeft: "auto" } }, h("button", { style: S.btnSm, className: "mm-btn mm-btn-sm", onClick: openLevelsEditor }, t("cpCustomize"))),
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

      /** 下拉型档案字段：value 空串表示「跟随默认」。 */
      function profileSelect(field, options, fallback) {
        const draft = profileDraft();
        const current = draft[field] !== undefined ? draft[field] : fallback;
        return h(
          "select",
          {
            style: S.input,
            value: current == null ? "" : String(current),
            onChange: (e) => setProfileField(field, e.target.value),
          },
          options.map((opt) => h("option", { key: opt.value, value: opt.value }, opt.label)),
        );
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
          // v0.4 运行属性（参照 agent-teams）：空串表示跟随默认，后端会清空对应字段
          reasoningEffort: String(pick("reasoningEffort", emp.reasoningEffort || "") || "").trim(),
          memberProvider: String(pick("memberProvider", emp.memberProvider || "") || "").trim(),
          maxDepth: (() => {
            const raw = String(pick("maxDepth", emp.maxDepth == null ? "" : emp.maxDepth) || "").trim();
            return raw === "" ? null : Number(raw);
          })(),
          sessionPolicy: String(pick("sessionPolicy", emp.sessionPolicy || "") || "").trim(),
          toolPolicy: {
            allow: Array.isArray(emp.toolPolicy?.allow) ? emp.toolPolicy.allow : [],
            deny: splitCommas(String(pick("denyText", (emp.toolPolicy?.deny || []).join(", ")) || "")),
          },
        };
        if ((emp.kind || "permanent") === "temp") {
          args.tempMaxTasks = Math.max(0, Number(pick("tempMaxTasks", emp.tempMaxTasks || 0)) || 0);
        }
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
                      style: S.btnSm, className: "mm-btn mm-btn-sm",
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
                    { style: S.btnSm, className: "mm-btn mm-btn-sm", disabled: busy, onClick: () => setProfileDuties(profileDutiesList(emp).concat([""])) },
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
                h("button", { style: S.btnSm, className: "mm-btn mm-btn-sm", disabled: busy, onClick: () => openSkillsPicker(emp) }, t("pickSkills")),
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
                h("button", { style: S.btnSm, className: "mm-btn mm-btn-sm", disabled: busy, onClick: () => openModelPicker(emp) }, t("pickModel")),
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
            h("button", { style: S.btnPrimary, className: "mm-btn mm-btn-p", disabled: !canSave, onClick: () => saveProfile(emp) }, t("cpSaveProfile")),
          ),
        );
      }

      /** v0.4 运行属性块：推理强度 / 派生方式 / 子代理深度 / 会话策略 / 工具黑名单 / 临时工计次。 */
      function hrAttrsBlock(emp) {
        const kind = emp.kind || "permanent";
        const effort = emp.reasoningEffort || "";
        const memberProvider = emp.memberProvider || "";
        const sessionPolicy = emp.sessionPolicy || "";
        return h(
          "div",
          { style: CP_STYLE.hrBlock },
          h("div", { style: CP_STYLE.hrLabel }, t("cpAttrs")),
          h(
            "div",
            { style: CP_STYLE.hrGrid },
            h(
              "label",
              { style: Object.assign({}, CP_STYLE.hrField, { gridColumn: "1" }) },
              h("span", { style: CP_STYLE.hrFieldLabel }, t("cpEffort")),
              profileSelect(
                "reasoningEffort",
                [
                  { value: "", label: t("cpEffortDefault") },
                  { value: "minimal", label: "minimal" },
                  { value: "low", label: "low" },
                  { value: "medium", label: "medium" },
                  { value: "high", label: "high" },
                  { value: "xhigh", label: "xhigh" },
                ],
                effort,
              ),
            ),
            h(
              "label",
              { style: Object.assign({}, CP_STYLE.hrField, { gridColumn: "2" }) },
              h("span", { style: CP_STYLE.hrFieldLabel }, t("cpMemberProvider")),
              profileSelect(
                "memberProvider",
                [
                  { value: "", label: t("cpMemberProviderDefault") },
                  { value: "spawn", label: t("cpMemberProviderSpawn") },
                  { value: "fork", label: t("cpMemberProviderFork") },
                ],
                memberProvider,
              ),
            ),
            h(
              "label",
              { style: Object.assign({}, CP_STYLE.hrField, { gridColumn: "3" }) },
              h("span", { style: CP_STYLE.hrFieldLabel }, t("cpSessionPolicy")),
              profileSelect(
                "sessionPolicy",
                [
                  { value: "", label: t("cpSessionPolicyDefault") },
                  { value: "resident", label: t("cpSessionPolicyResident") },
                  { value: "per_task", label: t("cpSessionPolicyPerTask") },
                ],
                sessionPolicy,
              ),
            ),
            h(
              "label",
              { style: Object.assign({}, CP_STYLE.hrField, { gridColumn: "1" }) },
              h("span", { style: CP_STYLE.hrFieldLabel }, t("cpMaxDepth") + " · " + t("cpMaxDepthHint")),
              profileInput("maxDepth", {
                value: emp.maxDepth == null ? "" : String(emp.maxDepth),
                placeholder: "0 / 1 / 2",
              }),
            ),
            h(
              "label",
              { style: Object.assign({}, CP_STYLE.hrField, { gridColumn: "2 / span 2" }) },
              h("span", { style: CP_STYLE.hrFieldLabel }, t("cpToolPolicy") + " · " + t("cpToolPolicyHint")),
              profileInput("denyText", {
                value: (emp.toolPolicy?.deny || []).join(", "),
                placeholder: "ops_bash, web_fetch",
              }),
            ),
            kind === "temp"
              ? h(
                  "label",
                  { style: Object.assign({}, CP_STYLE.hrField, { gridColumn: "1" }) },
                  h("span", { style: CP_STYLE.hrFieldLabel }, t("cpTempMaxTasks") + " · " + t("cpTempMaxTasksHint")),
                  profileInput("tempMaxTasks", {
                    value: String(emp.tempMaxTasks || 0),
                    placeholder: "0",
                  }),
                )
              : null,
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
            h("span", { style: { fontWeight: 700, fontSize: T.font.mdLg } }, t("cpHr")),
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
              h("button", { style: S.btnSm, className: "mm-btn mm-btn-sm", onClick: () => setEditor(null) }, t("cpClose")),
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
          hrAttrsBlock(emp),
          h(
            "div",
            { style: CP_STYLE.hrBlock },
            h("div", { style: CP_STYLE.hrLabel }, t("cpHrActions")),
            h(
              "div",
              { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
              h("button", { style: S.btnSm, className: "mm-btn mm-btn-sm", disabled: busy || fired, onClick: openChannels }, t("cpChannels")),
              h("button", { style: S.btnSm, className: "mm-btn mm-btn-sm", disabled: busy || fired, onClick: openPromote }, t("cpPromote")),
              h("button", { style: S.btnSm, className: "mm-btn mm-btn-sm", disabled: busy || fired, onClick: () => fireEmployee(emp, true) }, t("cpFire")),
              h("button", { style: S.btnSm, className: "mm-btn mm-btn-sm", disabled: busy, onClick: openMove }, t("cpMove")),
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
            h("button", { style: S.btnPrimary, className: "mm-btn mm-btn-p", disabled: busy, onClick: () => submitOp("promoteEmployee", { employeeId: emp.id, channel: channel, level: level }) }, t("cpPromote")),
            h("button", { style: S.btnSm, className: "mm-btn mm-btn-sm", onClick: closeEditor }, t("cancel")),
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
                style: S.btnPrimary, className: "mm-btn mm-btn-p",
                disabled: busy || !channels.length,
                onClick: () => submitOp("setChannels", { employeeId: emp.id, channels: channels }, t("cpSaved")),
              },
              t("cpSave"),
            ),
            h("button", { style: S.btnSm, className: "mm-btn mm-btn-sm", onClick: closeEditor }, t("cancel")),
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
            h("button", { style: S.btnPrimary, className: "mm-btn mm-btn-p", disabled: busy || (!value && !canClear), onClick: () => submitMove(emp) }, t("cpMove")),
            h("button", { style: S.btnSm, className: "mm-btn mm-btn-sm", onClick: closeEditor }, t("cancel")),
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
            h("button", { style: S.btnSm, className: "mm-btn mm-btn-sm", onClick: closeEditor }, t("cancel")),
            h("button", { style: S.btnPrimary, className: "mm-btn mm-btn-p", disabled: busy || !(editor.displayName || "").trim(), onClick: () => submitHire(editor.deptId) }, t("cpHire")),
          ),
        );
      }

      function chartTab(card) {
        const leader = card.leader;
        const leaderBlock = leader
          ? h(
              "div",
              { style: CP_STYLE.leaderCard },
              h("span", { style: { fontSize: T.font.xs, opacity: 0.6 } }, t("cpLeaderTag")),
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
              { style: S.btnSm, className: "mm-btn mm-btn-sm", disabled: busy, onClick: () => setEditor({ kind: "hr", employeeId: emp.id }) },
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
                style: S.btnSm, className: "mm-btn mm-btn-sm",
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

      /**
       * v6（docs/24 §6.3）：部门弹层「开发模式」页签。
       * 无预设 → 空态 + 选择 + 套用；有预设 → 头部/岗位槽位/七阶段（goal·负责人·参与·交付物·门禁）+ 切换/清除。
       * 所有动态文本都走文本节点；preset 字段缺失时由 cpNormalizeDeptPreset 兜底，绝不影响渲染。
       */
      function presetTab(card) {
        const preset = card && card.preset ? card.preset : null;
        const catalog = Array.isArray(view.presets) ? view.presets : [];
        const picked = presetPick || (preset ? preset.id : catalog.length ? catalog[0].id : "");
        const appliedText = (() => {
          if (!preset || !preset.appliedAt) return "";
          const stamp = new Date(String(preset.appliedAt));
          return isNaN(stamp.getTime()) ? String(preset.appliedAt) : stamp.toLocaleString();
        })();
        const roleLabel = (row) => cpPresetRoleLabel(row, t("cpPresetUnassigned"));
        const selector = h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8 } },
          catalog.length
            ? h(
                "select",
                { style: S.input, value: picked, disabled: busy, onChange: (e) => setPresetPick(e.target.value) },
                catalog.map((item) =>
                  h("option", { key: item.id, value: item.id }, item.name + (item.version == null ? "" : " v" + item.version)),
                ),
              )
            : null,
          h(
            "button",
            { style: S.btnPrimary, className: "mm-btn mm-btn-p", disabled: busy || !picked || !catalog.length, onClick: () => applyDeptPreset(card, picked) },
            t("cpPresetApply"),
          ),
          preset ? h("button", { style: S.btn, className: "mm-btn", disabled: busy, onClick: () => clearDeptPreset(card) }, t("cpPresetClear")) : null,
        );
        const bullets = (label, lines) =>
          lines.length
            ? h(
                "div",
                { style: { marginTop: 3 } },
                h("div", { style: Object.assign({}, CP_STYLE.sub, { fontWeight: 600 }) }, label + "："),
                lines.map((line, index) => h("div", { key: "b-" + index, style: CP_STYLE.presetLine }, "• " + line)),
              )
            : null;
        if (!preset) {
          return h(
            "div",
            null,
            h("div", { style: CP_STYLE.hrLabel }, t("cpPresetTitle")),
            h("div", { style: S.emptyBox }, t("cpPresetEmpty")),
            selector,
            h("div", { style: Object.assign({}, CP_STYLE.sub, { marginTop: 8 }) }, t("cpPresetHint")),
            saved ? h("div", { style: S.hint }, saved) : null,
          );
        }
        return h(
          "div",
          null,
          h(
            "div",
            { style: CP_STYLE.presetHead },
            h("span", { style: { fontWeight: 650, fontSize: T.font.mdLg } }, preset.name),
            preset.version != null ? h("span", { style: CP_STYLE.deptCode }, "v" + String(preset.version)) : null,
            preset.outdated ? h("span", { style: CP_STYLE.presetBadge }, t("cpPresetOutdated")) : null,
            preset.description ? h("span", { style: CP_STYLE.sub }, preset.description) : null,
            appliedText
              ? h("span", { style: Object.assign({}, CP_STYLE.sub, { marginLeft: "auto" }) }, t("cpPresetAppliedAt", { time: appliedText }))
              : null,
          ),
          h("div", { style: CP_STYLE.hrLabel }, t("cpRole")),
          preset.roles.length
            ? h(
                "div",
                { style: CP_STYLE.presetSection },
                preset.roles.map((role) =>
                  h(
                    "div",
                    { key: "role-" + (role.key || role.name), style: CP_STYLE.presetRoleRow },
                    h("span", { style: { fontSize: T.font.md, fontWeight: 550 } }, roleLabel(role)),
                    role.channel
                      ? h("span", { style: cpChipStyle(role.channel === "M" ? "M" : "P", false) }, role.channel + (role.level ? " " + role.level : ""))
                      : null,
                    role.titleHint ? h("span", { style: CP_STYLE.sub }, role.titleHint) : null,
                  ),
                ),
              )
            : null,
          h("div", { style: CP_STYLE.hrLabel }, t("cpPresetStage") + " " + String(preset.stages.length)),
          preset.stages.length
            ? h(
                "div",
                null,
                preset.stages.map((stage) =>
                  h(
                    "div",
                    { key: "stage-" + (stage.key || stage.index), style: CP_STYLE.presetStage },
                    h(
                      "div",
                      { style: CP_STYLE.presetStageHead },
                      h("span", { style: CP_STYLE.deptCode }, "#" + String(stage.index)),
                      h("span", { style: { fontWeight: 650, fontSize: T.font.base } }, stage.name || t("cpPresetStage") + " " + String(stage.index)),
                      stage.goal ? h("span", { style: CP_STYLE.sub }, stage.goal) : null,
                    ),
                    h("div", { style: CP_STYLE.presetLine }, t("cpPresetOwner") + "：" + roleLabel(stage.owner)),
                    stage.participants.length
                      ? h(
                          "div",
                          { style: CP_STYLE.presetLine },
                          t("cpPresetParticipants") + "：" + stage.participants.map((row) => roleLabel(row)).join(", "),
                        )
                      : null,
                    // 契约 §6.3：交付物 bullet 只取 name；验收门禁为 name + description。
                    bullets(
                      t("cpPresetDeliverables"),
                      stage.deliverables.map((item) => item.name),
                    ),
                    bullets(
                      t("cpPresetGates"),
                      stage.gates.map((gate) => gate.name + (gate.description ? " — " + gate.description : "")),
                    ),
                  ),
                ),
              )
            : h("div", { style: S.emptyBox }, t("cpPresetEmpty")),
          selector,
          h("div", { style: Object.assign({}, CP_STYLE.sub, { marginTop: 8 }) }, t("cpPresetHint")),
          saved ? h("div", { style: S.hint }, saved) : null,
        );
      }

      // v5.18: read-only department employee details block (dept edit form + create preview)
      const deptEmployeesBlock = (employees) => {
        const list = Array.isArray(employees) ? employees : [];
        return h(
          "div",
          { style: Object.assign({}, CP_STYLE.hrBlock, { marginTop: 10 }) },
          h("div", { style: CP_STYLE.hrLabel }, t("cpDeptEmployees") + "（" + list.length + "）"),
          list.length
            ? h(
                "div",
                { style: { display: "flex", flexDirection: "column", gap: 2 } },
                list.map((emp) =>
                  h(
                    "div",
                    {
                      key: "dept-emp-" + (emp.id || emp.code || ""),
                      style: {
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: 8,
                        padding: "4px 0",
                        borderBottom: "1px solid rgba(127,127,127,.12)",
                      },
                    },
                    cpRenderEmployeeRow(t, emp),
                  ),
                ),
              )
            : h("div", { style: CP_STYLE.sub }, t("cpPreviewNoEmployees")),
        );
      };

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
          { style: { border: "1px solid rgba(127,127,127,.18)", borderRadius: T.radius.lg, padding: 12, marginBottom: 12 } },
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
          deptEmployeesBlock(card.employees),
          h(
            "div",
            { style: { display: "flex", gap: 8, marginTop: 8 } },
            h("button", { style: S.btnPrimary, className: "mm-btn mm-btn-p", disabled: busy, onClick: () => saveDeptEdit(card) }, t("cpSave")),
            h(
              "button",
              {
                style: S.btn, className: "mm-btn",
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
                h("span", { style: { fontWeight: 600, fontSize: T.font.lg } }, view.managementName || t("cpManagement")),
                h("span", { style: CP_STYLE.sub }, t("cpMgmtHint")),
                h(
                  "span",
                  { style: { marginLeft: "auto", display: "inline-flex", gap: 6 } },
                  h(
                    "button",
                    {
                      style: S.btnSm, className: "mm-btn mm-btn-sm",
                      disabled: busy,
                      onClick: () => setMgmtRename(view.managementName || t("cpManagement")),
                    },
                    t("cpRename"),
                  ),
                  h("button", { style: S.btnSm, className: "mm-btn mm-btn-sm", onClick: () => setMgmtOpen(false) }, t("cpClose")),
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
                      h("button", { style: S.btnPrimary, className: "mm-btn mm-btn-p", disabled: busy || !String(mgmtRename).trim(), onClick: saveMgmtName }, t("cpSave")),
                      h("button", { style: S.btn, className: "mm-btn", disabled: busy, onClick: () => setMgmtRename(null) }, t("cancel")),
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
                          { style: { marginLeft: "auto", fontSize: T.font.xs, opacity: 0.7, whiteSpace: "nowrap" } },
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
                h("span", { style: { fontWeight: 600, fontSize: T.font.lg } }, modalCard.dept.name || modalCard.dept.code || t("cpDept")),
                h("span", { style: CP_STYLE.sub }, t("tabOrg") + " · " + t("dpModalHint")),
                h("span", { style: { marginLeft: "auto" } }, h("button", { style: S.btnSm, className: "mm-btn mm-btn-sm", onClick: () => setDeptModal(null) }, t("cpClose"))),
              ),
              h(
                "div",
                { style: { display: "flex", gap: 6, marginBottom: 10, alignItems: "center", flexWrap: "wrap" } },
                h("button", { style: modalTab === "chart" ? S.tabOn : S.tab, onClick: () => setModalTab("chart") }, t("cpModalChart")),
                h("button", { style: modalTab === "members" ? S.tabOn : S.tab, onClick: () => setModalTab("members") }, t("cpModalMembers")),
                // v6（docs/24 §6.3）：第三页签「开发模式」。
                h("button", { style: modalTab === "preset" ? S.tabOn : S.tab, onClick: () => setModalTab("preset") }, t("cpModalPreset")),
                h(
                  "span",
                  { style: { marginLeft: "auto" } },
                  h(
                    "button",
                    {
                      style: S.btnSm, className: "mm-btn mm-btn-sm",
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
              modalTab === "members" ? membersTab(modalCard) : modalTab === "preset" ? presetTab(modalCard) : chartTab(modalCard),
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
                h("span", { style: { fontWeight: 600, fontSize: T.font.lg } }, t("cpEditNumbering")),
                h("span", { style: { marginLeft: "auto" } }, h("button", { style: S.btnSm, className: "mm-btn mm-btn-sm", onClick: () => setNumberingOpen(false) }, t("cpClose"))),
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
                h("button", { style: S.btn, className: "mm-btn", disabled: busy, onClick: () => setNumberingOpen(false) }, t("cancel")),
                h("button", { style: S.btnPrimary, className: "mm-btn mm-btn-p", disabled: busy, onClick: saveNumbering }, t("cpSaveNumbering")),
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
                h("span", { style: { fontWeight: 600, fontSize: T.font.lg } }, t("cpEditLevels")),
                h("span", { style: { marginLeft: "auto" } }, h("button", { style: S.btnSm, className: "mm-btn mm-btn-sm", onClick: () => setLevelsOpen(false) }, t("cpClose"))),
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
                            ? h("button", { style: S.btnSm, className: "mm-btn mm-btn-sm", disabled: busy, onClick: () => removeLevel(channel, lv.code) }, t("cpRemoveLevel"))
                            : null,
                        ),
                        h("input", { style: S.input, value: lv.name || "", disabled: busy, maxLength: 24, onChange: (e) => setName(lv.code, e.target.value) }),
                      ),
                    ),
                  ),
                  h(
                    "div",
                    { style: { marginTop: 6 } },
                    h("button", { style: S.btnSm, className: "mm-btn mm-btn-sm", disabled: busy, onClick: () => addLevel(channel) }, t("cpAddLevel")),
                  ),
                );
              }),
              h(
                "div",
                { style: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 } },
                h("button", { style: S.btn, className: "mm-btn", disabled: busy, onClick: () => setLevelsOpen(false) }, t("cancel")),
                h("button", { style: S.btnPrimary, className: "mm-btn mm-btn-p", disabled: busy, onClick: saveLevels }, t("cpSaveLevels")),
              ),
            ),
          )
        : null;

      const nd = newDeptDraft || { id: "", name: "", charter: "", capacity: "4", brief: "" };
      const setNd = (patch) => setNewDeptDraft(Object.assign({}, nd, patch));
      // 点「创建预览」：解析一句话 + 按编制预生成员工，打开预览弹窗（纯客户端，不发请求）。
      async function openPreview() {
        const parsed = cpParseBrief(nd.brief);
        // v5.23: preset skills come from the installed catalog; fall back to labels when unavailable.
        let catalog = Array.isArray(CP_SKILL_CATALOG) ? CP_SKILL_CATALOG : null;
        if (!catalog) {
          try {
            catalog = await ensureSkillCatalog();
          } catch {
            catalog = [];
          }
        }
        const capacity = String(nd.capacity || "").trim() || (parsed.capacity != null ? String(parsed.capacity) : "4");
        const plannedRows = [];
        const headcount = parseInt(capacity, 10);
        const stamp = Date.now().toString(36);
        const parsedRows = Array.isArray(parsed.employees) ? parsed.employees : [];
        const sourceRows = parsedRows.length
          ? parsedRows
          : Number.isFinite(headcount) && headcount > 0
            ? Array.from({ length: Math.min(headcount, 50) }, (_, i) => ({ displayName: t("hrDefaultName") + (i + 1), channel: "P", level: "" }))
            : [];
        sourceRows.slice(0, 50).forEach((row, i) => {
          const channel = row.channel === "M" ? "M" : "P";
          plannedRows.push({
            key: "plan-" + i + "-" + stamp,
            displayName: row.displayName || t("hrDefaultName") + (i + 1),
            title: row.title || "",
            duties: Array.isArray(row.duties) ? row.duties.slice() : [],
            skills: cpMapCatalogSkills(row.skills, catalog),
            model: row.model || "",
            channel: channel,
            level: row.level || firstLevelCode(channel),
            created: false,
          });
        });
        setNewDeptError(null);
        setNewDeptPreview({
          id: String(nd.id || "").trim(),
          name: String(nd.name || "").trim() || parsed.name,
          charter: String(nd.charter || "").trim() || parsed.charter || "",
          capacity: capacity,
          employees: plannedRows,
          createdId: null,
        });
      }

      const pv = newDeptPreview || { id: "", name: "", charter: "", capacity: "4", employees: [], createdId: null };
      const setPv = (patch) => setNewDeptPreview(Object.assign({}, pv, patch));
      const firstLevelCode = (channel) => {
        const dir = (view.levels && view.levels[channel]) || {};
        const first = (dir.levels || [])[0];
        if (first && first.code) return first.code;
        return channel === "M" ? "M1" : "P1";
      };
      const planned = Array.isArray(pv.employees) ? pv.employees : [];
      const locked = !!pv.createdId;
      const updatePlanned = (key, patch) =>
        setPv({ employees: planned.map((row) => (row.key === key ? Object.assign({}, row, patch) : row)) });
      const removePlanned = (key) => setPv({ employees: planned.filter((row) => row.key !== key) });
      // v5.19: editable pre-generated employee rows shown in the create preview
      const plannedEmployeesEditor = () => {
        const channels = Object.keys(view.levels || {});
        return h(
          "div",
          { style: Object.assign({}, CP_STYLE.hrBlock, { marginTop: 10 }) },
          h("div", { style: CP_STYLE.hrLabel }, t("cpDeptEmployees") + "（" + planned.length + "）"),
          h("div", { style: Object.assign({}, CP_STYLE.sub, { marginBottom: 6 }) }, t("cpPlannedHint")),
          planned.length
            ? h(
                "div",
                { style: { display: "flex", flexDirection: "column", gap: 6 } },
                planned.map((row, idx) =>
                  h(
                    "div",
                    { key: row.key, style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 } },
                    h("span", { style: { fontSize: T.font.sm, opacity: 0.7, minWidth: 22 } }, row.created ? "✓" : "#" + (idx + 1)),
                    h("input", {
                      style: Object.assign({}, S.input, { flex: "1 1 150px", minWidth: 130 }),
                      value: row.displayName || "",
                      placeholder: t("cpEmployeeName"),
                      disabled: busy || locked || row.created,
                      onChange: (e) => updatePlanned(row.key, { displayName: e.target.value }),
                    }),
                    h(
                      "select",
                      {
                        style: Object.assign({}, S.input, { flex: "0 0 108px" }),
                        value: row.channel || "P",
                        disabled: busy || locked || row.created,
                        onChange: (e) => {
                          const ch = e.target.value;
                          updatePlanned(row.key, { channel: ch, level: firstLevelCode(ch) });
                        },
                      },
                      channels.map((ch) =>
                        h("option", { key: ch, value: ch }, ch + " · " + (((view.levels[ch] || {}).label) || "")),
                      ),
                    ),
                    h(
                      "select",
                      {
                        style: Object.assign({}, S.input, { flex: "0 0 168px" }),
                        value: row.level || firstLevelCode(row.channel || "P"),
                        disabled: busy || locked || row.created,
                        onChange: (e) => updatePlanned(row.key, { level: e.target.value }),
                      },
                      (((view.levels[row.channel || "P"] || {}).levels) || []).map((lv) =>
                        h("option", { key: lv.code, value: lv.code }, lv.code + " · " + lv.name),
                      ),
                    ),
                    h(
                      "button",
                      { style: S.btnSm, className: "mm-btn mm-btn-sm", disabled: busy || locked || row.created, onClick: () => removePlanned(row.key) },
                      t("cpRemoveDuty"),
                    ),
                    h("input", {
                      style: Object.assign({}, S.input, { flex: "1 1 140px", minWidth: 120 }),
                      value: row.title || "",
                      placeholder: t("cpEmpTitle"),
                      disabled: busy,
                      onChange: (e) => updatePlanned(row.key, { title: e.target.value }),
                    }),
                    h("input", {
                      style: Object.assign({}, S.input, { flex: "1 1 170px", minWidth: 130 }),
                      value: Array.isArray(row.skills) ? row.skills.join("、") : "",
                      placeholder: t("cpEmpSkills"),
                      disabled: busy,
                      onChange: (e) =>
                        updatePlanned(row.key, {
                          skills: String(e.target.value || "")
                            .split(/[、,，;；]/)
                            .map((name) => name.trim())
                            .filter(Boolean)
                            .slice(0, 12),
                        }),
                    }),
                    h("input", {
                      style: Object.assign({}, S.input, { flex: "0 1 170px", minWidth: 130 }),
                      value: row.model || "",
                      placeholder: t("cpEmpModel"),
                      disabled: busy,
                      onChange: (e) => updatePlanned(row.key, { model: e.target.value }),
                    }),
                  ),
                ),
              )
            : h("div", { style: CP_STYLE.sub }, t("cpPreviewNoEmployees")),
        );
      };
      const pvCap = parseInt(pv.capacity, 10);
      const pvValid =
        String(pv.name || "").trim().length > 0 &&
        String(pv.capacity).trim() !== "" &&
        Number.isFinite(pvCap) &&
        pvCap >= 0;

      async function createDepartment() {
        if (!pvValid) return;
        setBusy(true);
        setNewDeptError(null);
        const working = planned.map((row) => Object.assign({}, row));
        try {
          let createdId = pv.createdId || null;
          if (!createdId) {
            const args = { name: pv.name.trim(), charter: pv.charter || "", capacity: pvCap };
            if ((pv.id || "").trim()) args.id = pv.id.trim();
            const created = await opPost("createDepartment", args);
            createdId = (created && created.departmentId) || args.id || pv.name.trim();
          }
          let failed = 0;
          let firstError = "";
          for (let i = 0; i < working.length; i += 1) {
            const row = working[i];
            if (row.created) continue;
            const channel = row.channel === "M" ? "M" : "P";
            const level = row.level || firstLevelCode(channel);
            const args = {
              displayName: String(row.displayName || "").trim() || t("hrDefaultName") + (i + 1),
              department: createdId,
              role: "staff",
              kind: "permanent",
              channel: channel,
              level: level,
            };
            if (row.title) args.title = String(row.title);
            if (Array.isArray(row.duties) && row.duties.length) args.duties = row.duties.slice(0, 8);
            if (Array.isArray(row.skills) && row.skills.length) args.skills = row.skills.slice(0, 12);
            if (row.model) args.model = String(row.model);
            try {
              await opPost("createEmployee", args);
              working[i] = Object.assign({}, row, { created: true });
            } catch (err) {
              failed += 1;
              if (!firstError) firstError = cpErrorText(err);
            }
          }
          setPv({ createdId: createdId, employees: working });
          if (failed > 0) {
            setNewDeptError(t("cpPreviewEmpFailed") + " " + failed + "/" + working.length + "（" + firstError + "）");
            await load();
            return;
          }
          setNewDeptOpen(false);
          setNewDeptPreview(null);
          setNewDeptDraft(null);
          await load();
        } catch (err) {
          setNewDeptError(cpErrorText(err));
          await load();
        } finally {
          setBusy(false);
        }
      }

      const ndField = (label, input) =>
        h("div", { style: Object.assign({}, S.field, { flex: "1 1 200px", minWidth: 180 }) }, h("label", { style: S.label }, label), input);

      const ndBriefInput = h("textarea", {
        style: Object.assign({}, S.input, { minHeight: 56 }),
        placeholder: t("cpNewDeptBriefPh"),
        value: nd.brief,
        onChange: (e) => setNd({ brief: e.target.value }),
      });

      // A 步：填写（一句话描述可自动解析）
      const newDeptModal =
        newDeptOpen && !newDeptPreview
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
                  h("span", { style: { fontWeight: 600, fontSize: T.font.lg } }, t("cpNewDept")),
                  h("span", { style: { marginLeft: "auto" } }, h("button", { style: S.btnSm, className: "mm-btn mm-btn-sm", onClick: () => setNewDeptOpen(false) }, t("cpClose"))),
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
                ndField(t("cpNewDeptBrief"), ndBriefInput),
                h(
                  "div",
                  { style: { display: "flex", alignItems: "center", gap: 8, marginTop: 8 } },
                  h(
                    "span",
                    { style: { marginLeft: "auto", display: "inline-flex", gap: 8 } },
                    h("button", { style: S.btn, className: "mm-btn", onClick: () => setNewDeptOpen(false) }, t("cancel")),
                    h("button", { style: S.btnPrimary, className: "mm-btn mm-btn-p", disabled: busy, onClick: openPreview }, t("cpPreviewDept")),
                  ),
                ),
              ),
            )
          : null;

      const previewResolvedCard = (() => {
        const pid = String(pv.id || "").trim();
        const pname = String(pv.name || "").trim();
        for (const card of view.cards) {
          if (!card.dept) continue;
          if ((pid && String(card.dept.id) === pid) || (pname && String(card.dept.name) === pname)) return card;
        }
        return null;
      })();

      // B 步：创建预览（可手动修改，确认后实际创建）
      const previewDeptModal =
        newDeptOpen && newDeptPreview
          ? h(
              "div",
              {
                style: S.modal,
                onClick: (e) => {
                  if (busy) return;
                  if (e.target === e.currentTarget) setNewDeptPreview(null);
                },
              },
              h(
                "div",
                { style: S.modalPanel, onClick: (e) => e.stopPropagation() },
                h(
                  "div",
                  { style: { display: "flex", alignItems: "center", marginBottom: 8 } },
                  h("span", { style: { fontWeight: 600, fontSize: T.font.lg } }, t("cpPreviewTitle")),
                  h("span", { style: { marginLeft: "auto" } }, h("button", { style: S.btnSm, className: "mm-btn mm-btn-sm", onClick: () => setNewDeptPreview(null) }, t("cpClose"))),
                ),
                h("div", { style: Object.assign({}, CP_STYLE.sub, { marginBottom: 8 }) }, t("cpPreviewHint")),
                h("div", { style: Object.assign({}, CP_STYLE.sub, { marginBottom: 8 }) }, t("cpPreviewRosterHint")),
                newDeptError ? h("div", { style: S.err }, t("cpOpFailed") + "：" + newDeptError) : null,
                h(
                  "div",
                  { style: { display: "flex", gap: 10, flexWrap: "wrap" } },
                  ndField(t("cpNewDeptId"), h("input", { style: S.input, placeholder: t("cpAutoId"), value: pv.id, onChange: (e) => setPv({ id: e.target.value }) })),
                  ndField(t("cpNewDeptName"), h("input", { style: S.input, value: pv.name, onChange: (e) => setPv({ name: e.target.value }) })),
                  ndField(t("cpNewDeptDesc"), h("input", { style: S.input, value: pv.charter, onChange: (e) => setPv({ charter: e.target.value }) })),
                  ndField(t("cpNewDeptCapacity"), h("input", { style: S.input, type: "number", min: 0, value: pv.capacity, onChange: (e) => setPv({ capacity: e.target.value }) })),
                ),
                previewResolvedCard ? deptEmployeesBlock(previewResolvedCard.employees) : plannedEmployeesEditor(),
                h(
                  "div",
                  { style: { display: "flex", alignItems: "center", gap: 8, marginTop: 10 } },
                  h(
                    "span",
                    { style: { marginLeft: "auto", display: "inline-flex", gap: 8 } },
                    h("button", { style: S.btn, className: "mm-btn", disabled: busy || !!pv.createdId, onClick: () => setNewDeptPreview(null) }, t("cpPreviewBack")),
                    h("button", { style: S.btnPrimary, className: "mm-btn mm-btn-p", disabled: busy || !pvValid, onClick: createDepartment }, t("cpCreateDept")),
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
        previewDeptModal,
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
          h("div", { style: { opacity: 0.7, fontSize: T.font.md, margin: "4px 0 12px" } }, t("mtSub")),
          h(
            "div",
            { style: { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 } },
            h("div", { style: { flex: "1 1 220px", minWidth: 200 } },
              h("div", { style: { fontSize: T.font.xs, opacity: 0.7 } }, t("mtCurrent")),
              h("div", { style: { fontSize: T.font.xl2, fontWeight: 600 } }, (upd && upd.current) || "—"),
              h("div", { style: { fontSize: T.font.xs, opacity: 0.6, wordBreak: "break-all" } }, (upd && upd.installDir) || ""),
            ),
            h("div", { style: { flex: "1 1 220px", minWidth: 200 } },
              h("div", { style: { fontSize: T.font.xs, opacity: 0.7 } }, t("mtLatest")),
              h("div", { style: { fontSize: T.font.xl2, fontWeight: 600 } }, upd && upd.latest && upd.latest.latest ? upd.latest.latest : upd && upd.latest && upd.latest.version ? upd.latest.version : t("mtUnknown")),
              h("div", { style: { fontSize: T.font.xs, opacity: 0.6 } }, upd && upd.lastCheck ? t("wfUpdated", { time: new Date(upd.lastCheck).toLocaleString() }) : ""),
            ),
            h("div", { style: { flex: "1 1 220px", minWidth: 200 } },
              h("div", { style: { fontSize: T.font.xs, opacity: 0.7 } }, t("mtResult")),
              h("div", { style: { fontSize: T.font.mdLg } }, upd && upd.pending ? t("mtPending", { v: upd.pending.version }) : t("mtNoPending")),
            ),
          ),
          h("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
            h("button", { style: S.btnSm, className: "mm-btn mm-btn-sm", disabled: busy || !upd || upd.enabled === false, onClick: () => act("updateCheck", {}, t("mtCheck")) }, t("mtCheck")),
            h("button", { style: S.btnSm, className: "mm-btn mm-btn-sm", disabled: busy || !upd || upd.enabled === false, onClick: () => act("updateStage", {}, t("mtStage")) }, t("mtStage")),
            h("button", { style: S.btnPrimary, className: "mm-btn mm-btn-p", disabled: busy || !upd || !upd.pending, onClick: () => act("updateApply", {}, t("mtApply")) }, t("mtApply")),
            h("button", { style: S.btnSmDanger, className: "mm-btn mm-btn-sm mm-btn-d", disabled: busy || !upd || upd.enabled === false, onClick: () => act("updateRollback", {}, t("mtRollback")) }, t("mtRollback")),
          ),
          h("div", { style: { fontSize: T.font.xs, opacity: 0.6, marginTop: 8 } }, t("mtApplyHint") + (upd && upd.pending ? " · " + t("mtRestart") : "")),
          upd && upd.applyCommand
            ? h(
                "pre",
                { style: { fontSize: T.font.xs, background: "#f6f7f9", border: "1px solid rgba(127,127,127,0.25)", borderRadius: T.radius.sm, padding: "6px 8px", overflowX: "auto", marginTop: 6 } },
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
            h("span", { style: { fontSize: T.font.xs, opacity: 0.65 } }, t("mtBackupCount", { n: (bak && bak.total) || backups.length })),
            h("button", { style: S.btnSm, className: "mm-btn mm-btn-sm", disabled: busy, onClick: () => act("backupNow", { reason: "manual" }, t("mtBackupNow")) }, t("mtBackupNow")),
          ),
          backups.length === 0
            ? h("div", { style: S.hint }, t("mtNoBackups"))
            : h(
                "table",
                { style: { width: "100%", borderCollapse: "collapse", fontSize: T.font.base, marginTop: 8 } },
                h("thead", null, h("tr", null,
                  h("th", { style: WF_TH }, t("groupName")),
                  h("th", { style: WF_TH }, t("wfElapsed")),
                  h("th", { style: WF_TH }, t("actions")),
                )),
                h("tbody", null, backups.map((b) =>
                  h("tr", { key: b.name },
                    h("td", { style: WF_TD },
                      h("div", { style: S.mono }, b.name),
                      h("div", { style: { fontSize: T.font.xs, opacity: 0.65 } }, (b.reason || "") + " · " + fmtNum(b.bytes) + "B"),
                    ),
                    h("td", { style: WF_TD }, b.mtime ? new Date(b.mtime).toLocaleString() : "—"),
                    h("td", { style: WF_TD }, h("button", {
                      style: S.btnSm, className: "mm-btn mm-btn-sm",
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
              result.ok ? h("pre", { style: { maxHeight: 240, overflow: "auto", fontSize: T.font.xs, marginTop: 6 } }, JSON.stringify(result.data, null, 2)) : null,
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
        h("div", { style: { fontSize: T.font.md, opacity: 0.7, marginBottom: 10 } }, t("briefExampleLabel") + "：" + t("briefExample")),
        h("textarea", {
          style: Object.assign({}, S.ta, { minHeight: 72 }),
          placeholder: t("briefPlaceholder"),
          value: text,
          onChange: (e) => setText(e.target.value),
        }),
        h("div", { style: { display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" } },
          h("button", { style: S.btnSm, className: "mm-btn mm-btn-sm", disabled: busy, onClick: () => { setText(t("briefExample")); setPreview(null); setCreated(null); } }, t("briefFill")),
          h("button", { style: S.btnPrimary, className: "mm-btn mm-btn-p", disabled: busy || !text.trim(), onClick: parse }, busy ? "…" : t("briefParse")),
          h("button", { style: S.btnSm, className: "mm-btn mm-btn-sm", disabled: busy, onClick: props.onClose }, t("cancel")),
        ),
        error ? h("div", { style: S.err }, t("error") + "：" + error) : null,
        created
          ? h("div", { style: Object.assign({}, WF_CARD, { marginTop: 12 }) },
              h("div", { style: { fontWeight: 600 } }, t("briefDone", { n: (created.added || []).length })),
              h("div", { style: { fontSize: T.font.md, opacity: 0.75, marginTop: 4 } }, created.summary || ""),
              created.failures && created.failures.length
                ? h("div", { style: S.err }, created.message || "")
                : null,
              h("div", { style: { marginTop: 8, display: "flex", gap: 8 } },
                h("button", { style: S.btnPrimary, className: "mm-btn mm-btn-p", onClick: props.onClose }, t("done")),
              ),
            )
          : preview
            ? h("div", { style: Object.assign({}, WF_CARD, { marginTop: 12 }) },
                h("div", { style: { fontWeight: 600 } }, t("briefPreviewTitle") + "：" + preview.group.name),
                preview.group.description ? h("div", { style: { fontSize: T.font.md, opacity: 0.7, marginTop: 4 } }, preview.group.description) : null,
                h("pre", { style: { fontSize: T.font.md, whiteSpace: "pre-wrap", marginTop: 8 } }, preview.summary || t("briefNone")),
                preview.warnings && preview.warnings.length ? h("div", { style: S.hint }, preview.warnings.join("；")) : null,
                h("div", { style: { display: "flex", gap: 8, marginTop: 8 } },
                  h("button", { style: S.btnSm, className: "mm-btn mm-btn-sm", disabled: busy, onClick: () => setPreview(null) }, t("briefBack")),
                  h("button", { style: S.btnPrimary, className: "mm-btn mm-btn-p", disabled: busy, onClick: confirm }, t("briefConfirm")),
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
    const ORGMAP_LEAD_W = 118;
    // 右侧边栏 tab：类型 id 全注册唯一，kind 是 openTab 的页面身份。
    const ORGMAP_TAB_ID = "dsh-member-manager/orgmap";
    const ORGMAP_TAB_KIND = "member-orgmap";

    const ORGMAP_CSS = [
  "#mm-orgchart-root{--mmo-ink:#1f2328;--mmo-ink2:#4a525b;--mmo-muted:#6b747e;--mmo-fill:#f3f5f8;--mmo-surface:#ffffff}",
  // ---- 颜色变量：浅色真值只写一次，深色只改变量（§8.1 硬编码色清零） ----
      "#mm-orgchart-root{position:relative;width:100%;height:100%;min-height:0;display:flex;",
      "flex-direction:column;font:12px/1.45 ui-sans-serif,system-ui,'Segoe UI','Microsoft YaHei',sans-serif;",
      "color:var(--mmo-ink);background:transparent;overflow:hidden}",
      "#mm-orgchart-root[data-embedded='1']{border:none;border-radius:0;box-shadow:none}",
      ".mmo-canvas{flex:1;min-height:0;overflow:auto;padding:8px 10px 4px;position:relative}",
      ".mmo-stage{position:relative;width:max-content;min-width:100%;padding:2px 4px 10px;box-sizing:border-box}",
      ".mmo-stage[data-mode='h']{display:flex;flex-direction:row;align-items:center;gap:36px}",
      ".mmo-stage[data-mode='h'] .mmo-lead-row{flex:none;align-items:center;padding-left:0}",
      ".mmo-stage[data-mode='h'] .mmo-groups{gap:14px;margin-top:0;min-width:0}",
      ".mmo-stage[data-mode='h'] .mmo-members{flex-direction:column;align-items:flex-start;gap:8px;flex:none;min-width:0}",
      ".mmo-svg{position:absolute;left:0;top:0;pointer-events:none;overflow:visible;z-index:0}",
      ".mmo-lead-row{position:relative;z-index:1;display:flex;justify-content:flex-start;padding-left:4px}",
      ".mmo-lead-row .mmo-card{width:" + ORGMAP_LEAD_W + "px}",
      ".mmo-lead-card{align-self:center;display:flex;flex-direction:column;align-items:center;justify-content:center;",
      "gap:5px;min-height:100px;padding:12px 9px;border-radius:12px;text-align:center;",
      "border-color:rgba(47,111,235,.3);background:linear-gradient(180deg,#f7f9fc,#fff);box-shadow:0 2px 8px rgba(23,32,46,.07)}",
      ".mmo-lead-card .mmo-dot{width:8px;height:8px}",
      ".mmo-lead-card .mmo-name{font-size:13px;font-weight:700;max-width:100%}",
      ".mmo-lead-card .mmo-task{font-size:10.5px;margin-top:0;color:var(--mmo-muted);line-height:1.35}",
      ".mmo-lead-card .mmo-meta{margin-top:2px;justify-content:center;gap:4px;font-size:9.5px}",
      ".mmo-joint{fill:#fff;stroke:rgba(100,116,139,.55);stroke-width:1.2}",
      ".mmo-groups{position:relative;z-index:1;display:flex;flex-direction:column;align-items:flex-start;",
      "gap:16px;margin-top:32px;width:max-content;min-width:100%}",
      ".mmo-cluster{display:flex;flex-direction:row;align-items:center;gap:14px;width:100%}",
      ".mmo-chip{flex:none}",
      ".mmo-chip{display:inline-flex;align-items:center;gap:6px;border-radius:7px;padding:3px 8px;",
      "font-size:11px;font-weight:600;color:#fff;background:var(--mm-accent,#2f6feb);box-shadow:0 1px 2px rgba(23,32,46,.12);",
      "white-space:nowrap}",
      ".mmo-chip[data-gi='0']{background:var(--mm-accent,#2f6feb)}.mmo-chip[data-gi='1']{background:#b45309}",
      ".mmo-chip[data-gi='2']{background:#1a7f37}.mmo-chip[data-gi='3']{background:#8250df}",
      ".mmo-chip[data-gi='4']{background:#0e7490}.mmo-chip[data-gi='5']{background:#b42318}",
      ".mmo-chip-count{background:rgba(255,255,255,.24);border-radius:999px;padding:0 5px;font-size:10px;font-weight:500}",
      ".mmo-fold{box-sizing:border-box;width:" + ORGMAP_CARD_W + "px;font:11px/1.5 inherit;color:var(--mmo-muted);background:var(--mmo-surface);",
      "border:1px dashed rgba(31,35,40,.24);border-radius:9px;padding:5px 8px;cursor:pointer;white-space:nowrap;text-align:center}",
      ".mmo-fold:hover{color:var(--mm-accent,#2f6feb);border-color:rgba(47,111,235,.45)}",
      ".mmo-members{display:flex;align-items:stretch;gap:10px;flex-wrap:wrap;flex:1;min-width:0}",
      ".mmo-card{box-sizing:border-box;width:" + ORGMAP_CARD_W + "px;border:1px solid rgba(31,35,40,.14);",
      "border-radius:9px;padding:6px 8px;background:var(--mmo-surface);position:relative;transition:border-color .2s,box-shadow .2s}",
      ".mmo-card[data-active='1']{border-color:rgba(47,111,235,.55);box-shadow:0 0 0 2px rgba(47,111,235,.12)}",
      ".mmo-card[data-running='1']{background:linear-gradient(180deg,rgba(47,111,235,.06),#fff)}",
      ".mmo-row1{display:flex;align-items:center;gap:5px;min-width:0}",
      ".mmo-dot{width:7px;height:7px;border-radius:50%;background:#b8bfc7;flex:none}",
      ".mmo-dot[data-state='running']{background:#1a7f37;animation:mmo-pulse 1.4s ease-in-out infinite}",
      ".mmo-dot[data-state='idle']{background:var(--mmo-muted)}",
      ".mmo-name{font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".mmo-model{font-size:10px;color:var(--mmo-muted);background:var(--mmo-fill);border-radius:5px;padding:1px 4px;",
      "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px;flex:none}",
      ".mmo-task{font-size:11px;color:var(--mmo-ink2);margin-top:3px;display:-webkit-box;-webkit-line-clamp:2;",
      "-webkit-box-orient:vertical;overflow:hidden}",
      ".mmo-task[data-empty='1']{color:#9aa2ab}",
      ".mmo-meta{display:flex;gap:6px;margin-top:3px;font-size:10px;color:var(--mmo-muted);flex-wrap:wrap}",
      ".mmo-badge{font-size:9px;border-radius:4px;padding:0 4px;background:rgba(47,111,235,.12);color:var(--mm-accent,#2f6feb)}",
      ".mmo-ok{background:rgba(26,127,55,.12);color:#1a7f37}",
      // 失败/取消/丢失的卡片：人名徽标不能还是绿的（绿=好事），旁边还要能写清失败原因
      ".mmo-badge.mmo-bad{background:rgba(180,35,24,.12);color:#b42318}",
      // v0.5.2：已完成卡片的会话徽标——弱化处理，避免和状态徽标抢注意力
      ".mmo-badge.mmo-chat{background:rgba(31,35,40,.08);color:var(--mmo-muted);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".mmo-foot{flex:none;display:flex;gap:10px;flex-wrap:wrap;padding:2px 12px 6px;font-size:10px;color:var(--mmo-muted)}",
      ".mmo-fail{display:none;padding:2px 12px 4px;color:#b42318;font-size:11px}",
      ".mmo-toolbar{flex:none;display:flex;align-items:center;gap:8px;padding:7px 12px 2px}",
      ".mmo-toolbar-label{font-size:11px;color:var(--mmo-muted);white-space:nowrap}",
      ".mmo-select{flex:1;min-width:0;max-width:100%;font:11px/1.5 inherit;padding:2px 6px;",
      "border:1px solid rgba(31,35,40,.18);border-radius:6px;background:var(--mmo-surface);color:var(--mmo-ink)}",
      ".mmo-empty{display:none;padding:20px 12px;color:#9aa2ab;font-size:11px;text-align:center}",
      ".mmo-branch{fill:none;stroke:rgba(100,116,139,.45);stroke-width:1.3;stroke-linejoin:round;stroke-linecap:round}",
      ".mmo-edge{fill:none;stroke:rgba(47,111,235,.5);stroke-width:1.4;stroke-linejoin:round}",
      ".mmo-edge[data-kind='dep']{stroke:rgba(154,103,0,.55);stroke-dasharray:3 3}",
      ".mmo-edge-active{stroke:var(--mm-accent,#2f6feb);stroke-width:2;stroke-dasharray:7 5;animation:mmo-dash 0.8s linear infinite}",
      "@keyframes mmo-dash{to{stroke-dashoffset:-24}}",
      "@keyframes mmo-pulse{0%,100%{box-shadow:0 0 0 0 rgba(26,127,55,.45)}50%{box-shadow:0 0 0 4px rgba(26,127,55,0)}}",
      "@media (prefers-reduced-motion:reduce){.mmo-dot[data-state='running'],.mmo-edge-active{animation:none}}",
      // ---- v0.4 调度泳道 ----
      // 根节点是 flex column：用 order 把泳道排在 toolbar 之下、拓扑画布之上，
      // 而 DOM 顺序保持在末尾，避免打乱既有结构与测试锚点。
      "#mm-orgchart-root>.mmo-toolbar{order:1}",
      "#mm-orgchart-root>.mmo-fail{order:2}",
      "#mm-orgchart-root>.mmo-board{order:3}",
      "#mm-orgchart-root>.mmo-canvas{order:4}",
      "#mm-orgchart-root>.mmo-foot{order:5}",
      ".mmo-board{flex:none;display:flex;flex-direction:column;gap:6px;padding:6px 12px 4px;max-height:46%;min-height:132px;overflow:auto}",
      ".mmo-board[data-collapsed='1'] .mmo-lanes,.mmo-board[data-collapsed='1'] .mmo-health{display:none}",
      ".mmo-board-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap}",
      ".mmo-board-title{font-size:12px;font-weight:700;color:var(--mmo-ink);margin-right:2px}",
      ".mmo-kpi{display:inline-flex;align-items:center;gap:4px;font-size:10px;padding:1px 6px;border-radius:999px;",
      "background:var(--mmo-fill);color:var(--mmo-ink2);white-space:nowrap}",
      ".mmo-kpi[data-k='running']{background:rgba(47,111,235,.12);color:var(--mm-accent,#2f6feb)}",
      ".mmo-kpi[data-k='done']{background:rgba(26,127,55,.12);color:#1a7f37}",
      ".mmo-kpi[data-k='abnormal']{background:rgba(180,35,24,.12);color:#b42318}",
      ".mmo-sched{font-size:10px;padding:1px 6px;border-radius:999px;background:var(--mmo-fill);color:var(--mmo-muted);white-space:nowrap}",
      ".mmo-sched[data-state='running']{background:rgba(26,127,55,.12);color:#1a7f37}",
      ".mmo-grow{flex:1;min-width:4px}",
      ".mmo-btn{font:11px/1.5 inherit;padding:1px 8px;border-radius:6px;border:1px solid rgba(31,35,40,.18);",
      "background:var(--mmo-surface);color:var(--mmo-ink);cursor:pointer;white-space:nowrap}",
      ".mmo-btn:hover{border-color:rgba(47,111,235,.5);color:var(--mm-accent,#2f6feb)}",
      ".mmo-btn[data-kind='primary']{background:var(--mm-accent,#2f6feb);border-color:var(--mm-accent,#2f6feb);color:#fff}",
      ".mmo-btn[data-kind='primary']:hover{background:#2559c4;color:#fff}",
      ".mmo-btn[data-kind='danger']:hover{border-color:rgba(180,35,24,.5);color:#b42318}",
      ".mmo-lanes{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;align-items:start}",
      ".mmo-lane{display:flex;flex-direction:column;gap:4px;min-width:0;background:#f7f8fa;border-radius:8px;padding:4px}",
      ".mmo-lane-head{display:flex;align-items:center;gap:4px;font-size:10px;font-weight:600;color:var(--mmo-ink2);padding:0 2px}",
      ".mmo-lane-count{margin-left:auto;color:var(--mmo-muted);font-weight:600}",
      ".mmo-lane-body{display:flex;flex-direction:column;gap:4px;min-height:26px}",
      ".mmo-order{box-sizing:border-box;border:1px solid rgba(31,35,40,.12);border-left-width:3px;border-radius:6px;",
      "background:var(--mmo-surface);padding:3px 5px;cursor:pointer;transition:border-color .15s,box-shadow .15s}",
      ".mmo-order:hover{border-color:rgba(47,111,235,.55);box-shadow:0 1px 4px rgba(23,32,46,.1)}",
      ".mmo-order[data-state='queued']{border-left-color:var(--mmo-muted)}",
      ".mmo-order[data-state='routed']{border-left-color:#b45309}",
      ".mmo-order[data-state='running']{border-left-color:var(--mm-accent,#2f6feb)}",
      ".mmo-order[data-state='done']{border-left-color:#1a7f37}",
      ".mmo-order[data-state='failed'],.mmo-order[data-state='cancelled'],.mmo-order[data-state='lost']{border-left-color:#b42318}",
      ".mmo-order[data-sel='1']{box-shadow:0 0 0 2px rgba(47,111,235,.28)}",
      ".mmo-order-title{font-size:11px;font-weight:600;color:var(--mmo-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".mmo-order-meta{display:flex;gap:4px;flex-wrap:wrap;font-size:9.5px;color:var(--mmo-muted);margin-top:1px}",
      ".mmo-order-err{font-size:9.5px;color:#b42318;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".mmo-health{display:flex;gap:6px;flex-wrap:wrap}",
      ".mmo-health-item{display:inline-flex;align-items:center;gap:4px;font-size:10px;color:var(--mmo-ink2);",
      "background:var(--mmo-surface);border:1px solid rgba(31,35,40,.12);border-radius:6px;padding:1px 6px}",
      ".mmo-bar{width:34px;height:4px;border-radius:2px;background:#e6e9ee;overflow:hidden}",
      ".mmo-bar>i{display:block;height:100%;background:var(--mm-accent,#2f6feb)}",
      ".mmo-detail{box-sizing:border-box;width:100%;margin-top:4px;background:var(--mmo-surface);",
      "border:1px solid rgba(31,35,40,.16);border-radius:6px;display:none;",
      "flex-direction:column;gap:6px;padding:8px 10px}",
      ".mmo-detail[data-open='1']{display:flex}",
      ".mmo-detail-head{display:flex;align-items:center;gap:6px}",
      ".mmo-detail-title{font-size:12px;font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".mmo-kv{display:grid;grid-template-columns:64px 1fr;gap:2px 6px;font-size:11px;color:var(--mmo-ink)}",
      ".mmo-kv>span:nth-child(odd){color:var(--mmo-muted)}",
      ".mmo-sec{font-size:11px;font-weight:700;color:var(--mmo-ink2);margin-top:4px}",
      ".mmo-attempt{font-size:10.5px;color:var(--mmo-ink2);border-left:2px solid #e6e9ee;padding-left:6px;margin-bottom:3px}",
      ".mmo-attempt[data-stale='1']{color:#9aa2ab}",
      ".mmo-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:auto;padding-top:6px}",
      ".mmo-form{display:flex;flex-direction:column;gap:5px}",
      ".mmo-input,.mmo-textarea{font:11px/1.5 inherit;padding:3px 6px;border:1px solid rgba(31,35,40,.18);",
      "border-radius:6px;background:var(--mmo-surface);color:var(--mmo-ink);box-sizing:border-box;width:100%}",
      ".mmo-textarea{min-height:52px;resize:vertical}",
      ".mmo-toast{font-size:10.5px;color:#1a7f37}",
      ".mmo-toast[data-err='1']{color:#b42318}",
      "@media (max-width:720px){.mmo-lanes{grid-template-columns:repeat(2,minmax(0,1fr))}}",
      // ---- v0.5 侧边栏：只留任务流，泳道改竖排 ----
      // 右栏宽度 320–420px，五列并排每列只剩 60–70px，标题必然被截断；
      // 竖排后每条泳道独占整行，卡片能显示「标题 + 负责人 + 用时」三段信息。
      "#mm-orgchart-root[data-embedded='1'] .mmo-canvas{display:none}",
      "#mm-orgchart-root[data-embedded='1'] .mmo-toolbar{display:none}",
      "#mm-orgchart-root[data-embedded='1'] .mmo-foot{display:none}",
      "#mm-orgchart-root[data-embedded='1'] .mmo-board{flex:1 1 auto;max-height:none;min-height:0;overflow:auto;gap:10px;padding:10px 12px 16px}",
      "#mm-orgchart-root[data-embedded='1'] .mmo-lanes{grid-template-columns:1fr;gap:10px;align-items:stretch}",
      // 视觉顺序≠DOM 顺序：最需要被看见的「执行中/异常」提到最上面，测试锚点不受影响
      "#mm-orgchart-root[data-embedded='1'] .mmo-lane[data-lane='running']{order:1}",
      "#mm-orgchart-root[data-embedded='1'] .mmo-lane[data-lane='abnormal']{order:2}",
      "#mm-orgchart-root[data-embedded='1'] .mmo-lane[data-lane='queued']{order:3}",
      "#mm-orgchart-root[data-embedded='1'] .mmo-lane[data-lane='routed']{order:4}",
      "#mm-orgchart-root[data-embedded='1'] .mmo-lane[data-lane='done']{order:5}",
      // 侧栏只有 316px 可用宽：五枚状态 KPI 与泳道表头的圆点+计数完全重复，挤到第二行反而遮住表头。
      // 泳道表头已承担计数职责，故在 embedded 下收起 KPI（DOM 保留，测试与无障碍读屏不受影响）。
      "#mm-orgchart-root[data-embedded='1'] .mmo-kpi{display:none}",
      "#mm-orgchart-root[data-embedded='1'] .mmo-board-head{flex-wrap:nowrap;min-width:0}",
      ".mmo-board-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:6px;flex-wrap:wrap;",
      "padding:2px 0 9px;background:Canvas;border-bottom:1px solid rgba(127,127,127,.14)}",
      ".mmo-board-title{font-size:12.5px;font-weight:700;letter-spacing:.01em;margin-right:2px}",
      ".mmo-lane{background:rgba(127,127,127,.05);border:1px solid rgba(127,127,127,.14);border-radius:10px;",
      "padding:8px 9px 9px;gap:7px;min-width:0}",
      ".mmo-lane-head{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:CanvasText;",
      "opacity:.88;padding:0 1px 6px;border-bottom:1px dashed rgba(127,127,127,.18)}",
      ".mmo-lane-head::before{content:'';width:6px;height:6px;border-radius:50%;flex:none;background:var(--mmo-muted);",
      "box-shadow:0 0 0 2px rgba(127,127,127,.12)}",
      ".mmo-lane[data-lane='routed'] .mmo-lane-head::before{background:#7d5300}",
      ".mmo-lane[data-lane='running'] .mmo-lane-head::before{background:var(--mm-accent,#2f6feb)}",
      ".mmo-lane[data-lane='done'] .mmo-lane-head::before{background:#1a7f37}",
      ".mmo-lane[data-lane='abnormal'] .mmo-lane-head::before{background:#b42318}",
      ".mmo-lane-count{margin-left:auto;min-width:18px;text-align:center;font-family:ui-monospace,Consolas,monospace;",
      "font-size:10px;line-height:16px;padding:0 5px;border-radius:999px;background:rgba(127,127,127,.14);",
      "color:CanvasText;opacity:.9;font-weight:500}",
      ".mmo-lane-body{display:flex;flex-direction:column;gap:6px;min-height:8px}",
      ".mmo-lane-empty{border:1px dashed rgba(127,127,127,.26);border-radius:8px;padding:8px 6px;text-align:center;",
      "font-size:10.5px;opacity:.55;color:CanvasText}",
      ".mmo-order{border-radius:8px;border:1px solid rgba(127,127,127,.18);border-left-width:3px;background:Canvas;",
      "padding:6px 8px 7px;box-shadow:0 1px 2px rgba(23,32,46,.06)}",
      ".mmo-order-title{font-size:11.5px;line-height:1.4}",
      ".mmo-order-meta{font-size:10px;opacity:.82;margin-top:2px;row-gap:3px}",
      ".mmo-order-err{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.35}",
      // 异常泳道里的「已取消 / 已丢失」分组：一行折叠条 + 展开后的卡片列表（存档已淡化）
      ".mmo-lane-fold{margin-top:6px;display:flex;flex-direction:column;gap:5px}",
      ".mmo-fold-toggle{align-self:flex-start;border:1px dashed rgba(127,127,127,.32);background:transparent;color:var(--mmo-muted);",
      "font:11px/1.4 inherit;padding:3px 8px;border-radius:999px;cursor:pointer}",
      ".mmo-fold-toggle:hover{background:rgba(127,127,127,.10);color:var(--mmo-ink2)}",
      ".mmo-fold-toggle:focus-visible{outline:2px solid var(--mm-ring,#2f6feb);outline-offset:1px}",
      ".mmo-lane-fold[data-open='0'] .mmo-fold-box{display:none}",
      ".mmo-fold-box{display:flex;flex-direction:column;gap:5px;opacity:.72}",
      ".mmo-detail{background:Canvas;color:CanvasText;border-color:rgba(127,127,127,.2)}",
      ".mmo-kpi{font-size:10px;padding:1px 7px}",
      ".mmo-btn{font-size:11px;padding:2px 9px;border-radius:6px;transition:background .15s,border-color .15s,color .15s}",
      ".mmo-btn:focus-visible{outline:2px solid rgba(47,111,235,.55);outline-offset:1px}",
      ".mmo-health-item{background:Canvas;font-size:10px}",
      // v0.5.1：异常记录区样式 + 空异常泳道「重启进度」按钮
      ".mmo-exception-history{margin-top:10px;border:1px dashed rgba(127,127,127,.26);border-radius:8px;padding:8px;background:rgba(127,127,127,.03)}",
      ".mmo-exception-history-head{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:600;color:var(--mmo-ink2);padding:0 2px 6px}",
      ".mmo-exception-history-count{margin-left:auto;color:var(--mmo-muted);font-weight:500}",
      ".mmo-exception-history-body{display:flex;flex-direction:column;gap:5px}",
      ".mmo-exception-history-body:empty{display:none}",
      ".mmo-restart-progress{margin-top:6px;align-self:flex-start}",
      // v0.5.2：清理按钮两段式确认——第二次点击前给出明确的「再点一次」视觉
      ".mmo-exception-history-head .mmo-btn[data-armed=\"1\"]{border-color:#b42318;color:#b42318;background:rgba(180,35,24,.08)}",
      "@media (prefers-reduced-motion:reduce){.mmo-order,.mmo-btn{transition:none}}",
      // ---- 深色主题：11 处写死的浅色字（var(--mmo-ink) 压 #1E1E1E 只有 1.06:1）统一改暗底可读值 ----
  "@media (prefers-color-scheme: dark){",
  "#mm-orgchart-root{--mmo-ink:#ECECEC;--mmo-ink2:#C2C9D1;--mmo-muted:#9AA3AD;--mmo-fill:rgba(255,255,255,.06);--mmo-surface:rgba(255,255,255,.045);color:#ECECEC;--mm-ring:#598CEF}",
  ".mmo-select,.mmo-input,.mmo-textarea,.mmo-btn{background:#1B1F24;border-color:rgba(255,255,255,.18)}",
  ".mmo-detail{background:#16191D;border-color:rgba(255,255,255,.14)}",
  ".mmo-card,.mmo-order,.mmo-health-item,.mmo-fold,.mmo-lane{border-color:rgba(255,255,255,.14)}",
  ".mmo-lane-head,.mmo-board-head{border-bottom-color:rgba(255,255,255,.14)}",
  ".mmo-bar{background:rgba(255,255,255,.14)}",
  ".mmo-attempt{border-left-color:rgba(255,255,255,.16)}",
  ".mmo-toast[data-err='1']{color:#FF9B90}",
  ".mm-panel{--mm-ring:#598CEF}",
  ".mmo-kpi,.mmo-lane-count,.mmo-count{font-variant-numeric:tabular-nums}",
  "}",
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

    const GROUP_COLORS = [T.accent, "#b45309", "#1a7f37", "#8250df", "#0e7490", "#b42318"];

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

      // ---- v0.4 调度泳道（默认收起在拓扑上方，不抢画布空间；数据来自 /state 的 orders/pipeline）----
      const board = doc.createElement("div");
      board.className = "mmo-board";
      const boardHead = doc.createElement("div");
      boardHead.className = "mmo-board-head";
      const boardTitle = doc.createElement("span");
      boardTitle.className = "mmo-board-title";
      boardHead.appendChild(boardTitle);
      const kpiRefs = {};
      ["queued", "routed", "running", "done", "abnormal"].forEach(function (key) {
        const chip = doc.createElement("span");
        chip.className = "mmo-kpi";
        if (key === "queued") chip.setAttribute("data-k", "queued");
        chip.setAttribute("data-k", key);
        kpiRefs[key] = chip;
        boardHead.appendChild(chip);
      });
      const schedChip = doc.createElement("span");
      schedChip.className = "mmo-sched";
      // 调度器开关：点一下暂停/恢复自动派工（暂停后仍可手动「立刻调度」）
      schedChip.style.cursor = "pointer";
      schedChip.addEventListener("click", () => {
        const runningNow = schedChip.getAttribute("data-state") !== "stopped";
        runBoardOp(runningNow ? "stopScheduler" : "startScheduler", {}, runningNow ? t("wbSchedStopped") : t("wbSchedRunning"));
      });
      boardHead.appendChild(schedChip);
      const growEl = doc.createElement("span");
      growEl.className = "mmo-grow";
      boardHead.appendChild(growEl);
      const tickBtn = doc.createElement("button");
      tickBtn.type = "button";
      tickBtn.className = "mmo-btn";
      tickBtn.addEventListener("click", function () {
        runBoardOp("runScheduler", {}, t("wbTick"));
      });
      boardHead.appendChild(tickBtn);
      const tempBtn = doc.createElement("button");
      tempBtn.type = "button";
      tempBtn.className = "mmo-btn";
      tempBtn.setAttribute("data-kind", "temp");
      tempBtn.addEventListener("click", function () {
        openTempForm();
      });
      boardHead.appendChild(tempBtn);
      const newBtn = doc.createElement("button");
      newBtn.type = "button";
      newBtn.className = "mmo-btn";
      newBtn.setAttribute("data-kind", "primary");
      newBtn.addEventListener("click", function () {
        openNewOrderForm();
      });
      boardHead.appendChild(newBtn);
      // v0.5.2：已完成 / 异常记录的范围开关——默认只看本会话，历史归档不占版面
      const scopeBtn = doc.createElement("button");
      scopeBtn.type = "button";
      scopeBtn.className = "mmo-btn";
      scopeBtn.setAttribute("data-mm-scope", "session");
      scopeBtn.addEventListener("click", function () {
        archivedScope = !archivedScope;
        renderBoard(boardData);
      });
      boardHead.appendChild(scopeBtn);
      board.appendChild(boardHead);

      const lanesEl = doc.createElement("div");
      lanesEl.className = "mmo-lanes";
      const laneRefs = {};
      [
        ["queued", "wbLaneQueued"],
        ["routed", "wbLaneRouted"],
        ["running", "wbLaneRunning"],
        ["done", "wbLaneDone"],
        ["abnormal", "wbLaneAbnormal"],
      ].forEach(function (pair) {
        const lane = doc.createElement("div");
        lane.className = "mmo-lane";
        // v0.5：泳道带上自己的身份，表头圆点与配色由 CSS 按泳道取，不再靠 5 列挤宽度
        lane.setAttribute("data-lane", pair[0]);
        const head = doc.createElement("div");
        head.className = "mmo-lane-head";
        const label = doc.createElement("span");
        label.setAttribute("data-lane-label", pair[1]);
        label.textContent = t(pair[1]);
        head.appendChild(label);
        const count = doc.createElement("span");
        count.className = "mmo-lane-count";
        head.appendChild(count);
        const body = doc.createElement("div");
        body.className = "mmo-lane-body";
        lane.appendChild(head);
        lane.appendChild(body);
        lanesEl.appendChild(lane);
        laneRefs[pair[0]] = { body: body, count: count };
      });
      board.appendChild(lanesEl);

      // v0.5.1：异常记录区——显示已关闭的异常订单（cancelled / lost / failed），并提供手动清理
      const exceptionHistoryEl = doc.createElement("div");
      exceptionHistoryEl.className = "mmo-exception-history";
      const exceptionHistoryHead = doc.createElement("div");
      exceptionHistoryHead.className = "mmo-exception-history-head";
      const exceptionHistoryTitle = doc.createElement("span");
      exceptionHistoryTitle.textContent = t("wbExceptionHistory");
      exceptionHistoryTitle.title = t("wbExceptionHistoryTip");
      const exceptionHistoryCount = doc.createElement("span");
      exceptionHistoryCount.className = "mmo-exception-history-count";
      const clearHistoryBtn = doc.createElement("button");
      clearHistoryBtn.type = "button";
      clearHistoryBtn.className = "mmo-btn";
      clearHistoryBtn.textContent = t("wbClearHistory");
      // 两段式确认（v0.5.2）：以前用 window.confirm，宿主 Web 环境里常被拦或直接返回
      // false，点上去像没反应，于是「异常清不掉」。改成按钮自身二次确认，3 秒不点自动复位。
      let clearArmed = false;
      let clearArmTimer = 0;
      clearHistoryBtn.addEventListener("click", async function () {
        const count = Number(exceptionHistoryCount.getAttribute("data-count") || "0");
        if (!count) return;
        if (!clearArmed) {
          clearArmed = true;
          clearArmTimer = setTimeout(function () {
            clearArmed = false;
            clearArmTimer = 0;
            renderBoard(boardData);
          }, 3000);
          if (clearArmTimer && typeof clearArmTimer.unref === "function") clearArmTimer.unref();
          renderBoard(boardData);
          return;
        }
        clearArmed = false;
        if (clearArmTimer) clearTimeout(clearArmTimer);
        clearArmTimer = 0;
        // 只看本会话时只清本会话的异常记录：别的对话的失败单不该被这个对话一键清掉。
        const sid = archivedScope ? sessionKey() : "";
        const res = await runBoardOp("clearExceptionHistory", sid ? { sessionId: sid } : {}, t("wbClearHistory"));
        // 报后端实际删掉的条数：界面上只列本会话，但后端可能连带清掉无归属的老单
        if (res && res.ok) toast(t("wbCleared").replace("{count}", String(res.count || 0)));
      });
      exceptionHistoryHead.appendChild(exceptionHistoryTitle);
      exceptionHistoryHead.appendChild(exceptionHistoryCount);
      exceptionHistoryHead.appendChild(clearHistoryBtn);
      exceptionHistoryEl.appendChild(exceptionHistoryHead);
      const exceptionHistoryBody = doc.createElement("div");
      exceptionHistoryBody.className = "mmo-exception-history-body";
      exceptionHistoryEl.appendChild(exceptionHistoryBody);
      board.appendChild(exceptionHistoryEl);

      const healthEl = doc.createElement("div");
      healthEl.className = "mmo-health";
      board.appendChild(healthEl);

      const boardEmpty = doc.createElement("div");
      boardEmpty.className = "mmo-board-empty";
      boardEmpty.style.color = "#9aa2ab";
      boardEmpty.style.padding = "6px 2px";
      boardEmpty.textContent = t("wbNoOrder");
      board.appendChild(boardEmpty);

      const toastEl = doc.createElement("div");
      toastEl.className = "mmo-toast";
      toastEl.style.display = "none";
      boardHead.appendChild(toastEl);

      const detail = doc.createElement("div");
      detail.className = "mmo-detail";
      // 点击详情内部不触发外部关闭；点击详情外部任意位置关闭详情
      detail.addEventListener("click", (e) => e.stopPropagation());
      let detailOpenAt = 0;
      if (doc.addEventListener) {
        doc.addEventListener("click", () => {
          if (!selectedOrderId) return;
          // 打开详情的同一次点击也会冒泡上来，跳过它
          if (Date.now() - detailOpenAt < 60) return;
          closeDetail();
        });
      }
      board.appendChild(detail);

      root.appendChild(toolbar);
      root.appendChild(failLine);
      root.appendChild(canvas);
      root.appendChild(foot);
      root.appendChild(board);
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
      const foldState = new Map();
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
          opt.textContent = (data && data.companyName) || t("tcNoTasks");
          picker.appendChild(opt);
          picker.disabled = true;
          return;
        }
        picker.disabled = false;
        for (const item of tasks) {
          const opt = doc.createElement("option");
          opt.value = String(item.id || "");
          const tid = String(item.id || "");
          const companyTitle = data && data.source === "company" ? String(data.companyName || "") : "";
          const label = tid.startsWith("company-owner-") && companyTitle
            ? companyTitle
            : (item.title || companyTitle || tid.slice(0, 8));
          opt.textContent =
            orgmapShorten(label, 42) +
            " · " + (item.memberCount || 0) + (item.running ? " ●" : "");
          if (tid === String(current)) opt.selected = true;
          picker.appendChild(opt);
        }
      }

      /* ---------------- v0.4 泳道看板：渲染 + 交互 ---------------- */
      let boardData = { orders: [], pipeline: null, health: null, members: [], deptStats: [], task: null };
      let selectedOrderId = "";
      let boardBusy = false;
      // 已完成 / 异常记录是否只显示当前会话（默认开启：已完成跟随会话归档，不再堆在看板上）
      let archivedScope = true;

      const STATE_LABEL = {
        queued: "wbLaneQueued",
        routed: "wbLaneRouted",
        running: "wbLaneRunning",
        done: "wbLaneDone",
        failed: "wbLaneAbnormal",
        cancelled: "wbLaneAbnormal",
        lost: "wbLaneAbnormal",
      };
      const laneOf = (state) => (state === "queued" || state === "routed" || state === "running" || state === "done" ? state : "abnormal");

      /* ---------------- 异常泳道里「已取消 / 已丢失」的分组开关 ----------------
         这类单是历史存档：既不能重跑也不会自愈，堆在异常泳道里只会让人以为一直有故障。
         默认收起；用户点开一次之后按记忆保持（localStorage 不可用时静默降级为默认收起）。 */
      const CLOSED_FOLD_KEY = "mm-wb-closed-open";
      let closedFoldMemo = null;
      function closedFoldOpen() {
        if (closedFoldMemo !== null) return closedFoldMemo;
        let v = false;
        try {
          v = globalThis.localStorage?.getItem(CLOSED_FOLD_KEY) === "1";
        } catch (err) {
          v = false;
        }
        closedFoldMemo = v;
        return v;
      }
      function setClosedFoldOpen(next) {
        closedFoldMemo = Boolean(next);
        try {
          globalThis.localStorage?.setItem(CLOSED_FOLD_KEY, next ? "1" : "0");
        } catch (err) {
          /* 无 storage 就只记忆在本页内存里 */
        }
      }

      /** 当前看板会话的 root id：优先用服务端回传的 task.id（taskId 为空时它指向最近活跃任务）。 */
      function sessionKey() {
        const cur = boardData && boardData.task;
        return (cur && cur.id) || taskId || "";
      }

      /** 面板派活时附带的会话归属：看板直接下的单也要能跟随对话归档，而不是永远无主。 */
      function sessionArgs() {
        const id = sessionKey();
        if (!id) return {};
        const title = (boardData && boardData.task && boardData.task.title) || "";
        return title ? { sessionId: id, sessionTitle: title } : { sessionId: id };
      }

      /** 已完成订单的收尾时间：交给订单自己的 endedAt，而不是当前时钟。 */
      function fmtClock(iso) {
        if (!iso) return "";
        const ms = Date.parse(iso);
        if (!Number.isFinite(ms)) return "";
        const diff = Date.now() - ms;
        if (diff >= 0 && diff < 86400000) {
          const s = Math.floor(diff / 1000);
          const h = Math.floor(s / 3600);
          const m = Math.floor((s % 3600) / 60);
          if (h > 0) return h + "h" + (m ? m + "m" : "");
          return (m || 1) + "m";
        }
        const d = new Date(ms);
        const pad = (n) => (n < 10 ? "0" + n : String(n));
        return pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
      }

      function fmtElapsed(ms) {
        const v = Number(ms) || 0;
        if (v <= 0) return "";
        const s = Math.floor(v / 1000);
        if (s < 60) return s + "s";
        const m = Math.floor(s / 60);
        if (m < 60) return m + "m" + (s % 60 ? (s % 60) + "s" : "");
        return Math.floor(m / 60) + "h" + (m % 60 ? (m % 60) + "m" : "");
      }

      function badge(text, cls) {
        const b = el("span", "mmo-badge" + (cls ? " " + cls : ""), text);
        return b;
      }

      async function runBoardOp(action, args, label) {
        if (boardBusy) return null;
        boardBusy = true;
        try {
          const res = await companyPost(action, args || {});
          return res;
        } catch (err) {
          const msg = (label ? label + " " : "") + t("wbFailed") + (err && err.message ? err.message : String(err));
          toast(msg, true);
          reportError("工作网看板操作 " + action, err);
          return null;
        } finally {
          boardBusy = false;
          refresh(true);
        }
      }

      let toastTimer = null;
      function toast(message, isErr) {
        toastEl.setAttribute("data-err", isErr ? "1" : "0");
        toastEl.style.display = "block";
        toastEl.textContent = message;
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
          toastEl.style.display = "none";
          toastEl.textContent = "";
        }, 4000);
        if (toastTimer && typeof toastTimer.unref === "function") toastTimer.unref();
      }

      const cardNodes = new Map();
      function closeDetail() {
        selectedOrderId = "";
        detail.setAttribute("data-open", "0");
        detail.textContent = "";
        for (const node of cardNodes.values()) node.setAttribute("data-sel", "0");
      }

      function orderCard(order) {
        const card = el("div", "mmo-order");
        card.setAttribute("data-state", order.state || "");
        card.setAttribute("data-order", order.id);
        if (order.id === selectedOrderId) card.setAttribute("data-sel", "1");
        const title = el("div", "mmo-order-title", orgmapShorten(order.title || order.id, 40));
        title.title = order.title || order.id;
        card.appendChild(title);
        const meta = el("div", "mmo-order-meta");
        // 绿徽标只在「这件单还是活的」时用；失败/取消/丢失标签必须换成红的，不然读起来像已完成
        const closed = order.state === "failed" || order.state === "cancelled" || order.state === "lost";
        if (order.employeeName) meta.appendChild(badge(order.employeeName, closed ? "mmo-bad" : order.state === "running" ? "" : "mmo-ok"));
        else if (order.deptName) meta.appendChild(badge(order.deptName, closed ? "mmo-bad" : ""));
        // 运行中的任务标出执行模型（对照 agent-teams 的执行中展示模型），方便判断是不是选错了人
        if (order.state === "running" && order.employee) {
          const who = (boardData.members || []).find((m) => m.target === order.employee);
          const model = who && (who.model || who.provider);
          if (model) meta.appendChild(badge("model " + model));
        }
        if (order.priority && order.priority !== "normal") meta.appendChild(badge(order.priority));
        // 任务图：同批的并行任务共用一个批次号，卡面标出来才知道「这几张是一起下的」
        if (order.group) meta.appendChild(badge("#" + orgmapShorten(String(order.group), 12) + (order.taskKey ? "·" + order.taskKey : "")));
        const el2 = fmtElapsed(order.elapsedMs);
        if (el2) meta.appendChild(el("span", "", el2));
        if (order.attemptNo) meta.appendChild(el("span", "", "#" + order.attemptNo));
        // v0.5.2：卡面标出归属会话与收尾时间——已完成区默认只显示本会话，
        // 切到「全部会话」时靠这个徽标分辨这单来自哪个对话。
        if (order.sessionId || order.sessionTitle) {
          const chatText = order.sessionTitle || orgmapShorten(order.sessionId, 10);
          const chatBadge = badge(t("wbChat") + " " + orgmapShorten(chatText, 16), "mmo-chat");
          chatBadge.title = (order.sessionTitle || t("wbChatUnknown")) + (order.sessionId ? "\n" + order.sessionId : "");
          meta.appendChild(chatBadge);
        }
        if (order.endedAt) {
          const ended = el("span", "", fmtClock(order.endedAt));
          ended.title = order.endedAt;
          meta.appendChild(ended);
        }
        if (order.deps && order.deps.length) meta.appendChild(badge(t("wbDeps") + " " + order.deps.length));
        card.appendChild(meta);
        // 失败单要在卡面就写清「为什么失败」，否则用户只能点开详情猜
        let failText = order.routeError || "";
        if (!failText && order.state === "failed" && Array.isArray(order.attempts) && order.attempts.length) {
          const last = order.attempts[order.attempts.length - 1];
          failText = (last && (last.summary || last.error)) || "";
        }
        if (failText) {
          const err = el("div", "mmo-order-err", failText);
          err.title = failText;
          card.appendChild(err);
        }
        card.addEventListener("click", () => openOrderDetail(order.id));
        return card;
      }

      function renderBoard(d) {
        boardData = {
          orders: Array.isArray(d.orders) ? d.orders : [],
          pipeline: d.pipeline || null,
          health: d.health || null,
          members: Array.isArray(d.members) ? d.members : [],
          deptStats: Array.isArray(d.deptStats) ? d.deptStats : [],
          task: d.task || null,
        };
        boardTitle.textContent = t("wbTitle");
        tickBtn.textContent = t("wbTick");
        newBtn.textContent = t("wbNewOrder");
        tempBtn.textContent = t("wbHireTemp");
        tempBtn.title = t("cpTempMaxTasksHint");

        const orders = boardData.orders;
        cardNodes.clear();
        const byId = new Map(orders.map((o) => [o.id, o]));
        const buckets = { queued: [], routed: [], running: [], done: [], abnormal: [] };
        const pipeline = boardData.pipeline;
        if (pipeline && typeof pipeline === "object") {
          for (const key of Object.keys(buckets)) {
            for (const id of pipeline[key] || []) {
              const o = byId.get(id);
              if (o) buckets[key].push(o);
            }
          }
        } else {
          for (const o of orders) buckets[laneOf(o.state)].push(o);
        }

        // ---- 会话归档（v0.5.2）----
        // root 会话是已完成区的归属单位：本会话的单留在看板，其他会话的单归档只计数。
        const sid = sessionKey();
        const ownSession = (o) => {
          if (!sid) return true;              // 拿不到会话标识时不过滤：宁可多显示，也不凭空清空版面
          if (!o.sessionId) return true;      // 无归属的老单归本机遗留：留在本会话，否则永远藏在归档里清不掉
          return o.sessionId === sid;         // 只有明确属于其他会话的单才归档
        };
        // 终态即历史：cancelled / lost / 已交回执的 failed。
        // failed 但没 endedAt 的单留在活跃异常泳道——它还能重派或人工验收通过，
        // 一律沉进历史会让用户失去「重派这张失败单」的入口。清理时后端按终态判定，
        // 所以这类单也能被显式取消后清掉，不再是永久僵尸。
        const isClosedException = (o) => o.state === "cancelled" || o.state === "lost" || (o.state === "failed" && !!o.endedAt);
        const exceptionAll = buckets.abnormal.filter(isClosedException);
        const liveAbnormal = buckets.abnormal.filter((o) => !isClosedException(o));
        const scopeList = (all) => (archivedScope ? all.filter(ownSession) : all);
        const doneShown = scopeList(buckets.done);
        const exceptionShown = scopeList(exceptionAll);
        const archivedCount = buckets.done.length - doneShown.length + (exceptionAll.length - exceptionShown.length);

        scopeBtn.textContent = (archivedScope ? t("wbScopeSession") : t("wbScopeAll")) + (archivedCount ? " · +" + archivedCount : "");
        scopeBtn.title = t("wbScopeTip");
        scopeBtn.setAttribute("data-mm-scope", archivedScope ? "session" : "all");
        scopeBtn.setAttribute("data-archived", String(archivedCount));
        for (const key of Object.keys(kpiRefs)) {
          const chip = kpiRefs[key];
          let text = "";
          if (key === "queued") text = t("wbLaneQueued") + " " + buckets.queued.length;
          else if (key === "routed") text = t("wbLaneRouted") + " " + buckets.routed.length;
          else if (key === "running") text = t("wbLaneRunning") + " " + buckets.running.length;
          else if (key === "done") text = t("wbLaneDone") + " " + doneShown.length;
          // 异常口径与泳道一致：只算活跃异常。历史单在下方异常记录区，
          // 旧版把历史也算进这个数，于是「异常 11」怎么清都清不掉。
          else text = t("wbLaneAbnormal") + " " + liveAbnormal.length;
          chip.textContent = text;
          if (key === "abnormal") chip.title = t("wbAbnormalTip");
        }
        const health = boardData.health;
        const schedRunning = !health || !health.scheduler || health.scheduler.running !== false;
        schedChip.setAttribute("data-state", schedRunning ? "running" : "stopped");
        const interval = health && health.scheduler && health.scheduler.intervalMs ? Math.round(health.scheduler.intervalMs / 1000) : 0;
        schedChip.textContent = (schedRunning ? t("wbSchedRunning") : t("wbSchedStopped")) + (interval ? " · " + interval + "s" : "");
        schedChip.title = health && Array.isArray(health.routeErrors) && health.routeErrors.length
          ? health.routeErrors.map((r) => r.subject + " → " + r.reason).join("\n")
          : "";

        for (const key of Object.keys(laneRefs)) {
          const ref = laneRefs[key];
          ref.body.textContent = "";
          // 已完成按会话归档；异常泳道只显示当前卡住的单（已关闭的进下方异常记录区）
          const list = key === "done" ? doneShown : key === "abnormal" ? liveAbnormal : buckets[key];
          ref.count.textContent = String(list.length);
          if (!list.length) {
            // 保留 mmo-order-err 是测试锚点（client-bundle.test.mjs 断言空泳道占位），视觉交给 mmo-lane-empty
            const EMPTY_BY_LANE = { queued: "wbEmptyQueued", routed: "wbEmptyRouted", running: "wbEmptyRunning", done: "wbEmptyDone", abnormal: "wbEmptyAbnormal" };
            const empty = el("div", "mmo-order-err mmo-lane-empty", t(EMPTY_BY_LANE[key] || "wbEmptyLane"));
            ref.body.appendChild(empty);
            // 异常泳道为空时提供「重启进度」入口：触发一次调度，推进可派/可恢复的单
            if (key === "abnormal") {
              const restartBtn = el("button", "mmo-btn mmo-restart-progress", t("wbRestartProgress"));
              restartBtn.type = "button";
              restartBtn.title = t("wbRestartProgressTip");
              restartBtn.addEventListener("click", () => runBoardOp("restartProgress", {}, t("wbRestartProgress")));
              ref.body.appendChild(restartBtn);
            }
            continue;
          }
          // 服务端已按「活单 createdAt / 终态 endedAt」降序排好，客户端不再二次反转
          for (const o of list) {
            const card = orderCard(o);
            cardNodes.set(o.id, card);
            ref.body.appendChild(card);
          }
        }

        // 渲染「异常记录」区域（同样按会话归档）
        exceptionHistoryBody.textContent = "";
        exceptionHistoryCount.setAttribute("data-count", String(exceptionShown.length));
        exceptionHistoryCount.textContent = "(" + exceptionShown.length + ")";
        clearHistoryBtn.disabled = exceptionShown.length === 0;
        clearHistoryBtn.textContent = clearArmed ? t("wbClearHistoryAgain") : t("wbClearHistory");
        clearHistoryBtn.setAttribute("data-armed", clearArmed ? "1" : "0");
        clearHistoryBtn.title = archivedScope ? t("wbClearHistoryScope") : t("wbScopeAll");
        if (!exceptionShown.length) {
          const empty = el("div", "mmo-lane-empty", t("wbNoCurrentAbnormal"));
          exceptionHistoryBody.appendChild(empty);
        } else {
          for (const o of exceptionShown) {
            const card = orderCard(o);
            cardNodes.set(o.id, card);
            exceptionHistoryBody.appendChild(card);
          }
        }
        healthEl.textContent = "";
        for (const row of boardData.deptStats) {
          const item = el("span", "mmo-health-item");
          item.appendChild(el("span", "", row.name));
          const bar = el("span", "mmo-bar");
          const fill = el("i");
          const ratio = row.capacity ? Math.min(1, (row.busy || 0) / row.capacity) : 0;
          fill.style.width = Math.round(ratio * 100) + "%";
          bar.appendChild(fill);
          item.appendChild(bar);
          item.appendChild(el("span", "", (row.busy || 0) + "/" + (row.capacity || 0) + " " + t("wbBusy") + " · " + (row.idle || 0) + " " + t("wbIdle")));
          item.title = t("wbCapacity") + ": " + (row.capacity || 0) + " / " + (row.total || 0) + t("wbCapacityUnit");
          healthEl.appendChild(item);
        }
        const tempCount = boardData.members.filter((m) => m.kind === "temp").length;
        if (tempCount) healthEl.appendChild(el("span", "mmo-health-item", t("wbTemp") + " " + tempCount));

        if (!orders.length) {
          boardEmpty.style.display = "block";
          boardEmpty.textContent = t("wbNoOrder");
        } else {
          boardEmpty.style.display = "none";
          boardEmpty.textContent = "";
        }

        if (selectedOrderId) {
          const still = byId.get(selectedOrderId);
          if (still) {
            renderDetail(still);
            const card = cardNodes.get(selectedOrderId);
            if (card && card.parentNode) card.parentNode.insertBefore(detail, card.nextSibling);
          } else {
            closeDetail();
          }
        }
      }

      function memberOptions(select, order) {
        const opts = [{ id: "", label: t("wbAssignAuto") }];
        const members = boardData.members || [];
        const inDept = members.filter((m) => m.kind !== "temp" || true);
        for (const m of inDept) {
          if (m.state === "fired" || m.state === "retired") continue;
          const tag = m.kind === "temp" ? "[" + t("wbTemp") + "] " : "";
          opts.push({ id: m.target, label: tag + (m.displayName || m.target) + (m.groupName ? " · " + m.groupName : "") });
        }
        for (const o of opts) {
          const opt = doc.createElement("option");
          opt.value = o.id;
          opt.textContent = o.label;
          if (order && o.id === order.employee) opt.selected = true;
          select.appendChild(opt);
        }
      }

      function renderDetail(order) {
        detail.textContent = "";
        const head = el("div", "mmo-detail-head");
        const title = el("div", "mmo-detail-title", order.title || order.id);
        title.title = order.title || order.id;
        head.appendChild(title);
        head.appendChild(badge(STATE_LABEL[order.state] ? t(STATE_LABEL[order.state]) : order.state));
        const close = el("button", "mmo-btn", "×");
        close.type = "button";
        close.title = t("wbClose");
        close.addEventListener("click", closeDetail);
        head.appendChild(close);
        detail.appendChild(head);

        const kv = el("div", "mmo-kv");
        const addKv = (k, v) => {
          if (!v) return;
          kv.appendChild(el("span", "", k));
          kv.appendChild(el("span", "", v));
        };
        addKv(t("wbOrderType"), order.type || "");
        addKv(t("wbOrderDept"), order.deptName || "");
        addKv(t("wbOrderProject"), order.project || "");
        addKv(t("wbPriority"), order.priority || "");
        addKv(t("wbCreated"), order.createdAt ? String(order.createdAt).replace("T", " ").slice(0, 19) : "");
        addKv(t("wbElapsed"), fmtElapsed(order.elapsedMs));
        if (order.routeError) addKv(t("wbRouteError"), order.routeError);
        detail.appendChild(kv);

        if (order.detail) {
          detail.appendChild(el("div", "mmo-sec", t("wbOrderDetail")));
          detail.appendChild(el("div", "", order.detail));
        }
        if (order.acceptance && order.acceptance.length) {
          detail.appendChild(el("div", "mmo-sec", t("wbAcceptance")));
          for (const a of order.acceptance) detail.appendChild(el("div", "mmo-attempt", typeof a === "string" ? a : JSON.stringify(a)));
        }
        if (order.deps && order.deps.length) {
          detail.appendChild(el("div", "mmo-sec", t("wbDeps")));
          const byId = new Map((boardData.orders || []).map((o) => [o.id, o]));
          for (const id of order.deps) {
            const dep = byId.get(id);
            detail.appendChild(el("div", "mmo-attempt", (dep ? dep.title : id) + (dep ? " · " + dep.state : "")));
          }
        }
        detail.appendChild(el("div", "mmo-sec", t("wbAttempts")));
        const attempts = order.attempts || [];
        if (!attempts.length) detail.appendChild(el("div", "mmo-attempt", t("wbNoAttempt")));
        for (const a of attempts) {
          const row = el(
            "div",
            "mmo-attempt",
            "#" + (a.attemptNo || "-") + " " + (a.employeeName || a.employee || "") + " · " + (a.state || "") +
              (a.staleReason ? " · " + a.staleReason : "") +
              (a.startedAt ? " · " + String(a.startedAt).replace("T", " ").slice(11, 19) : ""),
          );
          if (a.invalidated) row.setAttribute("data-stale", "1");
          if (a.summary) row.textContent += " — " + orgmapShorten(a.summary, 80);
          detail.appendChild(row);
        }

        // 操作区：派工（可指定成员）/ 复核 / 取消 / 升级
        const pick = doc.createElement("select");
        pick.className = "mmo-select";
        pick.style.marginTop = "6px";
        memberOptions(pick, order);
        detail.appendChild(pick);

        const actions = el("div", "mmo-actions");
        const mkBtn = (label, kind, fn) => {
          const b = el("button", "mmo-btn", label);
          b.type = "button";
          if (kind) b.setAttribute("data-kind", kind);
          b.addEventListener("click", fn);
          return b;
        };
        if (order.state === "queued" || order.state === "routed" || order.state === "failed") {
          actions.appendChild(
            mkBtn(t("wbAssign"), "primary", () =>
              runBoardOp("assignOrder", { orderId: order.id, employeeId: pick.value || null, ...sessionArgs() }, t("wbAssign")),
            ),
          );
        }
        if (order.state === "running") {
          actions.appendChild(mkBtn(t("wbReviewPass"), "primary", () => runBoardOp("reviewOrder", { orderId: order.id, pass: true }, t("wbReviewPass"))));
          actions.appendChild(mkBtn(t("wbReviewReject"), "", () => runBoardOp("reviewOrder", { orderId: order.id, pass: false }, t("wbReviewReject"))));
        }
        // 失败单人工确认「其实改好了」→ 直接结单（账本里 failed -> done 已放行）
        if (order.state === "failed") {
          actions.appendChild(mkBtn(t("wbReviewPass"), "", () => runBoardOp("reviewOrder", { orderId: order.id, pass: true }, t("wbReviewPass"))));
        }
        if (order.state !== "done" && order.state !== "cancelled" && order.state !== "lost") {
          // 升级只对「还在流程里」的单有意义；failed 是终态，escalate 会直接拒（E_INVALID_STATE）
          if (order.state !== "failed") {
            actions.appendChild(mkBtn(t("wbEscalate"), "", () => runBoardOp("escalateOrder", { orderId: order.id }, t("wbEscalate"))));
          }
          actions.appendChild(mkBtn(t("wbCancel"), "danger", () => runBoardOp("cancelOrder", { orderId: order.id }, t("wbCancel"))));
        }
        detail.appendChild(actions);
      }

      function openOrderDetail(orderId) {
        selectedOrderId = String(orderId || "");
        detailOpenAt = Date.now();
        const order = (boardData.orders || []).find((o) => o.id === selectedOrderId);
        if (!order) return;
        for (const [id, node] of cardNodes) node.setAttribute("data-sel", id === selectedOrderId ? "1" : "0");
        // 就地展开：详情跟着被点的卡片走（插在它后面），视线不离开这条泳道
        const card = cardNodes.get(selectedOrderId);
        if (card && card.parentNode) card.parentNode.insertBefore(detail, card.nextSibling);
        detail.setAttribute("data-open", "1");
        renderDetail(order);
      }

      function openNewOrderForm() {
        selectedOrderId = "";
        // 表单不是某张卡片的详情，放到泳道区顶部：不必滚到底部才能填
        if (lanesEl && lanesEl.parentNode) lanesEl.parentNode.insertBefore(detail, lanesEl);
        detail.setAttribute("data-open", "1");
        detail.textContent = "";
        const head = el("div", "mmo-detail-head");
        head.appendChild(el("div", "mmo-detail-title", t("wbNewOrder")));
        const close = el("button", "mmo-btn", "×");
        close.type = "button";
        close.addEventListener("click", closeDetail);
        head.appendChild(close);
        detail.appendChild(head);

        const form = el("div", "mmo-form");
        const titleInput = doc.createElement("input");
        titleInput.className = "mmo-input";
        titleInput.placeholder = t("wbOrderPlaceholder");
        const typeInput = doc.createElement("input");
        typeInput.className = "mmo-input";
        typeInput.placeholder = t("wbOrderType");
        const prioInput = doc.createElement("select");
        prioInput.className = "mmo-select";
        for (const p of ["normal", "high", "urgent", "low"]) {
          const opt = doc.createElement("option");
          opt.value = p;
          opt.textContent = t("wbPriority") + ": " + p;
          prioInput.appendChild(opt);
        }
        const detailInput = doc.createElement("textarea");
        detailInput.className = "mmo-textarea";
        detailInput.placeholder = t("wbOrderDetail");
        const submit = el("button", "mmo-btn", t("wbSubmit"));
        submit.type = "button";
        submit.setAttribute("data-kind", "primary");
        submit.addEventListener("click", async () => {
          const title = String(titleInput.value || "").trim();
          if (!title) {
            toast(t("wbOrderTitle") + " ?", true);
            titleInput.focus();
            return;
          }
          const res = await runBoardOp(
            "placeOrder",
            {
              title,
              type: String(typeInput.value || "").trim() || "general",
              priority: prioInput.value || "normal",
              detail: String(detailInput.value || "").trim(),
              ...sessionArgs(),
            },
            t("wbNewOrder"),
          );
          if (res && res.ok) {
            toast(t("wbApplied") + (res.orderId ? " · " + res.orderId : ""));
            closeDetail();
          }
        });
        form.appendChild(titleInput);
        form.appendChild(typeInput);
        form.appendChild(prioInput);
        form.appendChild(detailInput);
        form.appendChild(submit);
        detail.appendChild(form);
      }

      /** 雇临时工：名字 + 部门 + 任务上限；到期/满额自动退场。 */
      function openTempForm() {
        selectedOrderId = "";
        detail.setAttribute("data-open", "1");
        detail.textContent = "";
        const head = el("div", "mmo-detail-head");
        head.appendChild(el("div", "mmo-detail-title", t("wbHireTemp")));
        const close = el("button", "mmo-btn", "×");
        close.type = "button";
        close.addEventListener("click", closeDetail);
        head.appendChild(close);
        detail.appendChild(head);

        const form = el("div", "mmo-form");
        const nameInput = doc.createElement("input");
        nameInput.className = "mmo-input";
        nameInput.placeholder = t("wbTempName");
        const deptSelect = doc.createElement("select");
        deptSelect.className = "mmo-select";
        const depts = (boardData.deptStats || []).slice();
        if (!depts.length) {
          const opt = doc.createElement("option");
          opt.value = "";
          opt.textContent = t("wbNoDept");
          deptSelect.appendChild(opt);
        }
        for (const d of depts) {
          const opt = doc.createElement("option");
          opt.value = d.id;
          opt.textContent = (d.name || d.id) + " · " + (d.idle || 0) + "/" + (d.capacity || 0);
          deptSelect.appendChild(opt);
        }
        const capInput = doc.createElement("input");
        capInput.className = "mmo-input";
        capInput.placeholder = t("wbTempCap");
        capInput.value = "1";
        const submit = el("button", "mmo-btn", t("wbSubmit"));
        submit.type = "button";
        submit.setAttribute("data-kind", "primary");
        submit.addEventListener("click", async () => {
          const department = deptSelect.value || "";
          if (!department) {
            toast(t("wbNoDept"), true);
            return;
          }
          const res = await runBoardOp(
            "hireTemp",
            {
              displayName: String(nameInput.value || "").trim() || t("wbTemp") + " · " + department,
              department: department,
              tempMaxTasks: Math.max(0, Number(capInput.value) || 0),
            },
            t("wbHireTemp"),
          );
          if (res && res.ok) {
            toast(t("wbApplied") + (res.employeeId ? " · " + res.employeeId : ""));
            closeDetail();
          }
        });
        form.appendChild(nameInput);
        form.appendChild(deptSelect);
        form.appendChild(capInput);
        form.appendChild(submit);
        detail.appendChild(form);
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
        const companyMode = d.source === "company";
        stage.setAttribute("data-mode", companyMode ? "h" : "v");
        leadRow.textContent = "";
        groupsRow.textContent = "";

        if (d.lead) {
          const lead = d.lead;
          const leadCard = el("div", "mmo-card mmo-lead-card");
          leadCard.setAttribute("data-target", String(lead.target || ""));
          leadCard.setAttribute("data-role", "lead");
          if (lead.status === "running") leadCard.setAttribute("data-running", "1");
          const leadDot = el("span", "mmo-dot");
          leadDot.setAttribute("data-state", lead.status === "running" ? "running" : "idle");
          leadCard.appendChild(leadDot);
          const leadName = el("div", "mmo-name", lead.displayName || t("cpManagement"));
          leadName.title = lead.displayName || t("cpManagement");
          leadCard.appendChild(leadName);
          const leadSub = el("div", "mmo-task", lead.title || "");
          leadCard.appendChild(leadSub);
          const leadMeta = el("div", "mmo-meta");
          const leadUsage = lead.usage || {};
          leadMeta.appendChild(el("span", "", orgmapFormatTokens(leadUsage.total) + " tok"));
          if (leadUsage.requests) leadMeta.appendChild(el("span", "", leadUsage.requests + " req"));
          leadCard.appendChild(leadMeta);
          cardIndex.set(String(lead.target || "lead"), leadCard);
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
          if (section.managerName) chip.setAttribute("title", t("ocLeadTitle") + section.managerName);
          chip.appendChild(el("span", "mmo-chip-name", section.name));
          chip.appendChild(el("span", "mmo-chip-count", String(section.members.length)));
          cluster.appendChild(chip);
          const membersBox = el("div", "mmo-members");
          const foldKey = "section-" + gi;
          const expanded = companyMode && foldState.get(foldKey) === true;
          const isActiveMember = (m) =>
            !!m && (m.status === "running" || (m.work && m.work.status === "in_progress"));
          const visibleMembers = !companyMode || expanded ? section.members : section.members.filter(isActiveMember);
          const memberCards = [];
          for (const m of visibleMembers) {
            const card = cardFor(m);
            card.setAttribute("data-gi", String(gidx));
            cardIndex.set(String(m.target || ""), card);
            membersBox.appendChild(card);
            memberCards.push(card);
          }
          const foldedCount = section.members.length - visibleMembers.length;
          let foldEl = null;
          if (companyMode && (foldedCount > 0 || (expanded && section.members.length > visibleMembers.length))) {
            const fold = el("button", "mmo-fold", foldedCount > 0 ? "+" + foldedCount + " " + t("ocFoldIdle") : t("ocFoldHide"));
            fold.setAttribute("type", "button");
            fold.setAttribute("title", foldedCount > 0 ? t("ocFoldIdle") : t("ocFoldHide"));
            fold.addEventListener("click", () => {
              foldState.set(foldKey, foldedCount > 0);
              if (lastData) render(lastData);
            });
            membersBox.appendChild(fold);
            foldEl = fold;
          }
          cluster.appendChild(membersBox);
          groupsRow.appendChild(cluster);
          layout.groups.push({ chip: chip, members: memberCards, fold: foldEl, gi: gidx });
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
          foot.appendChild(el("span", "", t("wbTaskProgress") + done + "/" + total));
        }
        if (d.generatedAt) foot.appendChild(el("span", "", t("ocSample") + " " + String(d.generatedAt).slice(11, 19)));

        // 泳道看板：订单/派工/容量/健康度全部来自同一份快照，和拓扑图一起刷新
        renderBoard(d);

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

      /** 端点小圆点（美化连线落点）。 */
      function addJoint(x, y, color) {
        const c = doc.createElementNS("http://www.w3.org/2000/svg", "circle");
        c.setAttribute("cx", x.toFixed(1));
        c.setAttribute("cy", y.toFixed(1));
        c.setAttribute("r", "2.2");
        c.setAttribute("class", "mmo-joint");
        if (color) c.setAttribute("stroke", color);
        svg.appendChild(c);
      }

      /** 扇形总线：父节点右缘 → 竖脊（圆角）→ 每个子节点左缘，端点带小圆点。 */
      function addFan(parent, children, color, gap) {
        const kids = (children || []).filter(Boolean).sort((a, b) => a.cy - b.cy);
        if (!kids.length) return;
        const busX = parent.right + (gap || 26);
        addPath("M " + parent.right.toFixed(1) + " " + parent.cy.toFixed(1) + " H " + busX.toFixed(1), "mmo-branch", color);
        if (kids.length === 1) {
          const only = kids[0];
          addPath("M " + busX.toFixed(1) + " " + only.cy.toFixed(1) + " H " + only.left.toFixed(1), "mmo-branch", color);
          addJoint(only.left, only.cy, color);
          return;
        }
        const first = kids[0];
        const last = kids[kids.length - 1];
        const room = first.left - busX - 2;
        const r = Math.max(0, Math.min(8, room, (last.cy - first.cy) / 2));
        if (r <= 0.5) {
          for (const k of kids) {
            addPath("M " + busX.toFixed(1) + " " + k.cy.toFixed(1) + " H " + k.left.toFixed(1), "mmo-branch", color);
            addJoint(k.left, k.cy, color);
          }
          return;
        }
        // 首个子节点：圆角后接入
        addPath(
          "M " + busX.toFixed(1) + " " + (first.cy + r).toFixed(1) +
            " Q " + busX.toFixed(1) + " " + first.cy.toFixed(1) +
            " " + (busX + r).toFixed(1) + " " + first.cy.toFixed(1) +
            " H " + first.left.toFixed(1),
          "mmo-branch",
          color,
        );
        // 竖脊 + 末个子节点圆角
        addPath(
          "M " + busX.toFixed(1) + " " + (first.cy + r).toFixed(1) +
            " V " + (last.cy - r).toFixed(1) +
            " Q " + busX.toFixed(1) + " " + last.cy.toFixed(1) +
            " " + (busX + r).toFixed(1) + " " + last.cy.toFixed(1) +
            " H " + last.left.toFixed(1),
          "mmo-branch",
          color,
        );
        // 中间子节点：竖脊短枝
        for (let i = 1; i < kids.length - 1; i++) {
          addPath("M " + busX.toFixed(1) + " " + kids[i].cy.toFixed(1) + " H " + kids[i].left.toFixed(1), "mmo-branch", color);
        }
        for (const k of kids) addJoint(k.left, k.cy, color);
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

        const companyMode = !!(data && data.source === "company");
        const chips = groups.map((g) => ({ g: g, r: rectOf(g.chip) })).filter((c) => c.r);
        if (!companyMode && lead && chips.length) {
          // 旧版任务视图：管理层在上，部门自上而下堆叠（保留原竖向连线）。
          const first = chips[0];
          const busY = lead.bottom + Math.max(12, Math.min(26, (first.r.top - lead.bottom) / 2));
          addPath("M " + lead.cx.toFixed(1) + " " + lead.bottom.toFixed(1) + " V " + busY.toFixed(1), "mmo-branch");
          if (Math.abs(first.r.cx - lead.cx) > 0.5) {
            addPath("M " + lead.cx.toFixed(1) + " " + busY.toFixed(1) + " H " + first.r.cx.toFixed(1), "mmo-branch");
          }
          addPath("M " + first.r.cx.toFixed(1) + " " + busY.toFixed(1) + " V " + first.r.top.toFixed(1), "mmo-branch");
          for (let i = 1; i < chips.length; i++) {
            const prev = chips[i - 1].r;
            const cur = chips[i].r;
            const midY = (prev.bottom + cur.top) / 2;
            addPath("M " + prev.cx.toFixed(1) + " " + prev.bottom.toFixed(1) + " V " + midY.toFixed(1), "mmo-branch");
            if (Math.abs(cur.cx - prev.cx) > 0.5) {
              addPath("M " + prev.cx.toFixed(1) + " " + midY.toFixed(1) + " H " + cur.cx.toFixed(1), "mmo-branch");
            }
            addPath("M " + cur.cx.toFixed(1) + " " + midY.toFixed(1) + " V " + cur.top.toFixed(1), "mmo-branch");
          }
        }
        // ---- v5.15 横向层级（公司化工作网，按草图）：管理层向右扇形连到每个部门；
        // 每个部门再向右扇形连到自己的员工卡 + 空闲折叠按钮（同层节点竖向排列，直线连接）。
        if (companyMode && lead && chips.length) {
          addFan(lead, chips.map((c) => c.r), null, 30);
        }
        if (companyMode) {
          for (const g of groups) {
            const chip = rectOf(g.chip);
            if (!chip) continue;
            const color = GROUP_COLORS[g.gi];
            const children = g.members.map((card) => rectOf(card)).filter(Boolean);
            const foldRect = rectOf(g.fold);
            if (foldRect) children.push(foldRect);
            addFan(chip, children, color, 24);
          }
        } else {
          // 旧版任务视图：部门色块 → 组内成员，横向并联。
          for (const g of groups) {
            const chip = rectOf(g.chip);
            const cards = g.members.map((card) => rectOf(card)).filter(Boolean);
            if (!chip || !cards.length) continue;
            const color = GROUP_COLORS[g.gi];
            const busX = chip.right + 7;
            addPath("M " + chip.right.toFixed(1) + " " + chip.cy.toFixed(1) + " H " + busX.toFixed(1), "mmo-branch", color);
            const ys = cards.map((c) => c.cy);
            const minY = Math.min.apply(null, ys);
            const maxY = Math.max.apply(null, ys);
            if (maxY - minY > 1) {
              addPath("M " + busX.toFixed(1) + " " + minY.toFixed(1) + " V " + maxY.toFixed(1), "mmo-branch", color);
            }
            for (const c of cards) {
              addPath("M " + busX.toFixed(1) + " " + c.cy.toFixed(1) + " H " + c.left.toFixed(1), "mmo-branch", color);
            }
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
          if (data && data.source === "company" && b.left >= a.right - 2) {
            // 左→右层级：父在左、子在右，横向出主干，再纵向对齐子卡中线，最后横向接入子卡左缘。
            const midX = a.right + Math.max(14, Math.min(30, (b.left - a.right) / 2));
            d =
              "M " + a.right.toFixed(1) + " " + a.cy.toFixed(1) +
              " H " + midX.toFixed(1) +
              " V " + b.cy.toFixed(1) +
              " H " + b.left.toFixed(1);
          } else if (b.top >= a.bottom) {
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
          addPath(d, "mmo-edge" + (e.status === "in_progress" ? " mmo-edge-active" : ""), e.kind === "dep" ? "#b45309" : T.accent);
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
            borderRadius: T.radius.sm,
            padding: "2px 8px",
            fontSize: T.font.md,
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
      // v0.4 起**绝不自动打开**：只在用户点会话头部「工作网」按钮时打开（入口见 openOrgMapTab 的调用方）。

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
      cpBriefRolePreset: cpBriefRolePreset,
      cpMapCatalogSkills: cpMapCatalogSkills,
      cpParseBriefEmployees: cpParseBriefEmployees,
      cpCompareEmployee: cpCompareEmployee,
      cpCompareDept: cpCompareDept,
      // v6（docs/24 §3.2/§5）：开发模式预设的规范化与展示工具，离线测试直接复用。
      cpNormalizeDeptPreset: cpNormalizeDeptPreset,
      cpNormalizePresetCatalog: cpNormalizePresetCatalog,
      cpPresetRoleLabel: cpPresetRoleLabel,
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
