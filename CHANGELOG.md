# Changelog

## 0.3.0（2026-10-20）· 公司化运行时 + 品牌重命名

本版本把插件从「名册管理覆盖层」升级为「单包公司化运行时」：不再依赖 DSH 原生团队层（`ctx.agentTeams`），只用 `ctx.agents` / `ctx.subagents` 承载两级组织（部门经理 → 员工）的派工闭环。

### 重命名

- 包名 / 插件 id / 面板 API 前缀：`dsh-plugin-member-manager` → `dsh-member-manager`（版本号仍为 0.3.0，属品牌重整而非 API 破坏）。
- 数据目录保持 `~/.dsh/storages/member-manager`（名册、备份、公司账本连续，不迁移）。

### 新增：公司化运行时（`company_*`）

- 组织架构：部门（charter / accepts / capacity / defaultModel / borrowPolicy）与员工（permanent / shared / temp；manager / staff / window；resident / per_task；toolPolicy）。
- 工单与账本：下单 → 规则路由 → 选人派工 → attempt 凭证 → 员工回报 → 经理验收 → 收尾；attempt 陈旧拒绝、`clientOrderId` 幂等、deps 解锁、append-only 审计（`company.json` 单写点 + `audit.jsonl` 对账）。
- 会话：员工身份与会话解耦；company owner 为根级 runtime agent（`ctx.agents.create`），员工会话为其直接子级（`ctx.subagents.startActivation`）；resident 员工重启后经 `ctx.agents.resume` 恢复；启动时回收上一进程遗留的 running/queued attempt（`running→failed→queued`）。
- 工具四线分离：OWNER（13 个）/ 经理线（11 个）/ 员工线 / 窗口线，白名单 `tools.restrict` + 同步 `tools.guard` + 执行体 `exec.agent.session.id` 反查，三层防越权；越权返回 `E_TOOL_LINE`。
- 用工：共享员工借调（`company_borrow`）、员工升级（`company_escalate`）、求助（`company_ask_help`）均落账并转发经理/owner。
- 稳态：token / 请求数成本按「员工 / 部门 / 工单」拆分统计（`/company/costs`）、单实例文件锁（`E_COMPANY_LOCKED`）、开机自举失败退避重试、shutdown 优雅停工七步（停派工 → 停工 followup → whenIdle 超时 → cancel → drainChildren → dispose owner → 审计）。
- Web：`/api/dsh-member-manager/company/*` 只读接口（overview / org / board / costs / orders）。
- 新增测试：共享内核纯函数（org / ledger / router / store / config）、host 运行时 fake 闭环（dispatcher / employees / runtime）、打包/元数据与切换回滚脚本用例（临时 profile），全量 370 用例。
- 交付自检：`node scripts/verify-company.mjs`（19 项：元数据/文件/语法/导出契约/M/P 等级与面板/全量测试/测试不污染用户数据），切换/回滚脚本默认 dry-run。

### 新增：M/P 双通道等级、编号与公司架构面板

- **双通道等级**：管理通道（M1 主管 → M2 经理 → M3 高级经理 → M4 总监 → M5 副总裁）与专业技术通道（P1 初级工程师 → P6 首席专家）两套等级目录；`manager` 固定走 M，`staff` / `window` 固定走 P；`company_hire` 可显式指定 `channel`/`level`，缺省按岗位取默认（manager→M2、staff→P3、window→P1）。
- **员工编号与部门编号**：员工默认 `E{seq:4}`（E0001 起），部门默认 `D{seq:2}`（D01 起）；支持模板占位符 `{seq}`/`{seq:N}`/`{dept}`/`{channel}`/`{level}` 与自定义起始值，编号全公司唯一、已占用自动跳号；可在配置 `company.numbering` 或运行时 `company_admin.setNumbering` 修改，优先级 `company.json` > 配置 > 内置默认。
- **历史数据迁移**：`normalizeCompany` / boot 阶段 `ensureCompanyCodes` 为缺编号、缺等级的历史员工与部门自动补号补级；等级非法回退岗位默认并记 warning，**不丢弃员工**。
- **晋升**：`company_admin({action:"promoteEmployee"})` 同通道只允许 ±1 级，跨通道须显式指定目标等级且 `role` 随之改写（window 不可转 M，转 M 前必须有部门）；`updateDepartment` 支持改写部门名称/编号等元数据。
- **视图与提示词**：`GET /company/overview` / `company_status` 的 `org.departments` 增加 `code`/`employeeCount`/`managerId`，`org.employees` 增加 `code`/`departmentCode`/`channel`/`level`/`levelName`，新增 `levels`/`numbering`；员工提示词头部带「工号 / 等级 / 通道 / 部门编号」身份行。
- **公司架构面板**：面板新增第 6 个页签「公司架构」，只读展示统计卡、编号规则、M/P 等级图例、部门卡片（编号 + 编制 + M/P 分栏员工行 + 状态点）与无部门员工，5 秒轮询 + 手动刷新；中英双语文案。（后续版本升级为「总架构」首屏页，见下节）
- **工具层校验**：`company_hire` / `company_admin({action:"createEmployee"})` 传入不存在的部门 id 时返回 `{ok:false, code:"E_NOT_FOUND", message:"部门不存在: <id>"}`，不再落孤儿员工（空部门仍允许，由 shared 校验 manager 必须有部门）。
- **新增测试**：shared 等级/编号纯函数与 config 解析（`test/company-levels.test.mjs`）、面板纯函数与渲染（`test/company-panel.test.mjs`）；冻结的 `company-org` 契约测试全绿。

### 变更：面板信息架构重构（总架构 / 部门架构）

- **页签重排**：「总架构」（`company`）提到第一个页签并成为默认落地页；其余页签（已停用 / 未登记 / 工作流 / 备份与更新）顺延，功能不变；「部门架构」不再占页签，改为总架构页内按钮唤起的**弹层（次级页面）**。
- **总架构页（原公司架构页升级）**：在原有统计卡 / 编号规则 / M/P 等级图例 / 部门卡片之外，新增工单数、已完成工单、Token 合计、请求数 KPI，并新增**成本归因区**：按员工（姓名 + 工号）/ 按部门（编号 + 名称）/ 按工单（orderId）三列展示 tokens 前 5 名，附请求数；无用量时空态提示。数据来自 `GET /company/overview` 的 `board` 与 `costs`，仍为 5 秒轮询 + 手动刷新。
- **部门架构弹层（原组织架构页升级）**：入口在总架构页——工具栏「部门架构」按钮打开全部部门，部门卡片上的按钮打开并预设该部门；弹层为遮罩 + 卡片，标题「部门架构」+ 关闭按钮，支持点遮罩/ESC 关闭；内容按部门分组管理成员（部门过滤 pills、搜索框按姓名 / DSH 名 / 岗位 / 技能，大小写不敏感），未分配卡文案「未分配部门」，无匹配显示「没有匹配的成员」，成员行保留编辑/停用/恢复/调整分组操作；新建部门表单文案同步为 新建部门 / 部门名称 / 部门说明。
- **视图归一扩展**：`buildCompanyOrgView(overview)` 新增 `costs`（按 tokens 降序、各 5 条的 byEmployee/byDepartment/byOrder 数组）与 `board` 字段，缺省/类型异常一律兜底为空值，不抛异常。
- **测试**：`test/company-panel.test.mjs` 更新页签/默认页断言并新增成本归因、部门架构弹层（按钮/预设/关闭路径）、部门过滤、搜索、空态与归一兜底用例；`test/client-bundle.test.mjs` 适配新默认页签与弹层入口；全量用例数随更新调整。

### 新增：总架构组织架构图与面板写接口（v4）

- **组织架构图**：「总架构」页改为架构图——最高层「员工中心」卡片与各部门领导节点横向相连，向下接部门图框；领导取该部门 `role=manager` 中 M 通道等级最高者（同级取工号小者），无负责人显示「未设负责人」虚线占位；部门图框可点击，按部门编号升序排列。
- **员工中心**：全员列表，下拉筛选 全体员工（默认，含已停用）/ 单部门 / 未启用成员（`state=fired`）；排序 部门编号 → M 线在前 → 等级从高到低 → 工号；行 = 工号 + 等级徽章 + 姓名 + 岗位 + 状态点。
- **部门弹层（次级页面）**：点部门图框打开，两个页签——「部门架构图」（负责人卡 + M/P 两栏按等级降序）、「成员详情列表」（招聘 / 晋升 / 停用 / 调岗；停用需确认，成功后刷新 overview 且弹层保持打开，失败红字显示 `{code}: {message}`）；关闭按钮 / 遮罩 / ESC 三路关闭；部门失效自动关闭。
- **新建部门合并一句话建组**：工具栏「新建部门」对话框字段 部门 ID（可选）/ 名称 / 说明 / 编制 / 一句话描述 + 「解析」（名称与编制启发式）；原「一句话建组」独立入口与弹层移除。
- **面板写接口**：新增 `POST /api/dsh-member-manager/company/op`（6 个 action：createDepartment / updateDepartment / createEmployee / promoteEmployee / fireEmployee / moveEmployee），与工具共用文件锁 / 校验 / 审计；JSON 解析失败 400 `E_BAD_JSON`、请求体过大 413 `E_BODY_TOO_LARGE`、未知 action `E_UNKNOWN_ACTION`；路由总数 15 → 16。
- **只保留公司化组织架构**：注册小组（registry groups）不再作为组织架构展示，`DeptOrgPanel` 等旧交互移除；4 个维护页签（已停用 / 未登记 / 工作流 / 备份与更新）保留。
- **视图归一**：`buildCompanyOrgView` 增加 `card.leader` / `card.channelCounts` / 员工 `departmentCode`；新增纯函数 `buildEmployeeCenter(view, filter)` 与 `cpParseBrief(text)`。
- **测试**：`test/company-runtime.test.mjs` 25 用例（op 六个 action）、`test/company-panel.test.mjs` 31 用例（v4 面板）、`test/host-plugin.test.mjs` 71 用例（路由 16 + POST op body 解析）、`test/client-bundle.test.mjs` 38 用例；全量 397/397；`node scripts/verify-company.mjs` 19/19。

### 新增：名册同步与部门删除（v4.1）

- **从名册同步**：`POST /company/op {action:"syncRoster"}` 与面板工具栏「从名册同步」按钮——读取团队成员名册 `registry.json`，按其分组/成员同步为公司化部门与员工：分组名对应部门（按名复用或新建，编制随成员数），分组内 `active` 成员对应员工（`id=member.target`，新建为 `staff`/`permanent` 并带技能，已存在只更新显示名与部门，**不改 role/level/code**，因此部门负责人不会被降级）；同一把文件锁内完成，幂等（重复同步不新增），`dryRun:true` 只计算不落盘，名册缺失/解析失败返回 `E_NO_REGISTRY`；审计 `roster.synced`。
- **删除部门**：`POST /company/op {action:"deleteDepartment"}` 与部门弹层底部「删除部门」按钮（二次确认含名称与编号）——仅允许删除不含在职员工的部门（否则 `E_DEPT_NOT_EMPTY`）；删除时把该部门已停用员工的部门清空（保留员工档案），审计 `department_deleted`。
- **测试**：`test/company-runtime.test.mjs` 28 用例（新增 syncRoster 幂等/dryRun/缺失与 deleteDepartment 非空拒绝/清空部门）、`test/company-panel.test.mjs` 39 用例（新增同步按钮载荷与文案/失败红字/5 秒清除/刷新清除/删除确认取消/删除成功关弹层/删除失败红字）；全量 407/407；`node scripts/verify-company.mjs` 19/19。

### 变更：页签改版——员工中心独立页签（v4.2）

- **页签调整**：面板页签由 5 个改为 4 个——`总架构`（默认首屏）/ `员工中心` / `工作流` / `备份与更新`；移除「已停用」「未登记」两个页签（含页面与 `tabRetired`/`tabUnregistered` 文案键）。已停用员工改在「员工中心」页的「未启用成员」筛选中查看，未登记成员的管理入口回归名册工具（`member_*`）。
- **员工中心独立页**：新增 `EmployeeCenterPanel`——全量员工列表（下拉筛选：全体员工 / 单部门 / 未启用成员，按部门与等级排序），筛选下拉位于工具栏、刷新按钮左侧，自带 5 秒轮询、手动刷新、空态与错误提示；总架构页的员工中心收紧为紧凑节点（标题 + 员工总数 +「查看全部」按钮，点击切到员工中心页签）。
- **测试**：`test/company-panel.test.mjs` 44 用例（新增 4 页签顺序与旧页签移除、EmployeeCenterPanel 排序/筛选/空态/轮询、查看全部回调）；`test/client-bundle.test.mjs` 38 用例同步；全量 412/412；`node scripts/verify-company.mjs` 19/19。

### 变更：M/P 通道可并存 + 总架构图「管理层」节点（v5）

- **双通道并存**：员工改为携带 `channels: [{channel:"M"|"P", level}]`（至少 1 个、通道不重复、等级必须属于该通道目录，M 在前）；旧的单通道字段 `channel`/`level` 仍保留并始终由 `channels` 推导（含 M 则主通道为 M）。岗位规则放宽：`manager` 必含 M，`staff` 可只有 M、只有 P 或 M+P，`window` 禁止 M。
- **shared 内核**：新增 `normalizeChannels` / `primaryChannelOf` / `resolveChannelLevel` / `describeEmployeeChannels` / `setEmployeeChannels`；`createEmployee` 支持 `channels`；`promoteEmployee` 支持 `patch.channel` / `addChannel` / `removeChannel`（最后一条通道不可移除、manager 不可移除 M、window 不可加 M，逐级 ±1 规则不变）；老数据由 `normalizeCompany` 迁移并归正（warning，不丢员工）。
- **宿主视图与工具**：`/company/overview` / `company_status` 的 `org.employees[]` 增加 `channels`（含 `levelName` 与 `primary`），新增 `management`（M 通道员工只读聚合，部门编号 → 通道等级 → 工号排序）；`company_hire` 支持可选 `channels`；`company_admin` 新增 `action:"setChannels"`（审计 `employee_channels_set`），`promoteEmployee` 透传通道参数；员工提示词身份行支持「M2（经理，M）、P3（高级工程师，P）」双通道展示（主通道在前）。
- **面板**：总架构图移除「员工中心」按钮节点（员工中心仍为独立页签），最高层改为「管理层」虚拟节点（M 通道人数徽章，点击打开只读弹层；**只用于展示，不改变员工部门归属与代码层级**），竖直连接线向下接各部门；员工行按通道各显示一枚等级徽章（M 琥珀 / P 蓝）；部门弹层成员详情新增通道编辑（M/P 复选框 + 等级下拉，至少保留一个，`window`/`manager` 的 M 受限），保存走 `POST /company/op {action:"setChannels"}`。
- **测试**：shared 双通道与通道归一往返用例（`test/company-levels.test.mjs` 33 用例）、host 运行时（`test/company-runtime.test.mjs` 36 用例）、面板（`test/company-panel.test.mjs` 55 用例）、客户端集成（`test/client-bundle.test.mjs` 38 用例）；全量 **442/442**，`node scripts/verify-company.mjs` **19/19**。

### 变更：总架构页去掉自动刷新、工具栏左对齐（v5.1）

- **自动刷新**：总架构页删除「每 5 秒自动刷新」胶囊，并在代码层移除该页的 `setInterval` 轮询——打开拉一次 + 手动「刷新」；`CP_POLL_MS` 常量与员工中心页的 5s 轮询保持不变（员工中心页仍自动刷新）。删除 `cpRefreshHint` 文案键（zh/en），`cpSubtitle` 同步去掉失效措辞。
- **工具栏**：改为全左对齐固定顺序 `总架构`（标题）→「新建部门」→「从名册同步」→「刷新」→`更新于 …`；移除 `toolbarSpacer` 右推布局。
- **测试**：`test/company-panel.test.mjs` 56 用例（新增「总架构页无自动轮询」「工具栏顺序与左对齐」断言）；全量 443/443。
- **v5.2 追加**：员工中心页的 5 秒轮询也删除——两个面板页统一为「打开拉一次 + 手动刷新」，`CP_POLL_MS` 常量与定时器全部移除；面板用例新增「员工中心页无定时器」断言。

### 改进：人事详情技能/模型改为选择器（v5.5）

- 「人事管理」详情页的「技能」与「模型覆盖」不再手填文本：技能按钮带已选数量，打开可搜索的多选弹层（数据来自 `GET /skills`）；模型按钮打开模型目录弹层（数据来自 `GET /models`，含「使用默认」清空）。
- 选择结果即时写回详情草稿并随「保存名册资料」提交（`setSkills` / `setModel`），关闭弹层不会丢草稿。
- **测试**：`test/company-panel.test.mjs` 61→64 用例；全量 **452/452**，`node scripts/verify-company.mjs` **19/19**。

### 新增：名册档案迁入公司化员工（v5.8）

- **员工档案字段**：员工新增 `title`（岗位名称）、`duties`（职责条目，≤8 条）、`model`/`provider`（模型覆盖）三个可选档案字段，与既有 `displayName`/`skills` 一起构成公司化档案；`company.json` 重载时归一保留（非法值丢弃、职责截断 8 条）。
- **新写接口**：`POST /company/op` 新增 `updateEmployeeProfile`（一次请求写显示名/岗位/职责/技能/模型，`employee_profile_updated` 审计）与 `importRosterProfiles`（把名册 active 成员的档案**只补空字段、绝不覆盖**地迁入同名员工，支持 `dryRun`，`roster.profiles_imported` 审计）。
- **模型覆盖生效**：员工同时配置 `provider` + `model` 时，其公司化会话通过 `agentOptions` 继承该路由；缺一沿用宿主默认。
- **面板**：「人事管理」详情页的「名册资料」改为「公司化资料」，直接读写公司化员工并用单次 `updateEmployeeProfile` 保存（不再串行发名册 op）；总架构工具栏新增「导入名册资料」按钮一键迁移名册档案。调岗表单里的「名册部门」暂保留。
- **测试**：shared/host/panel 新增用例，全量 **465/465**，`node scripts/verify-company.mjs` **19/19**。

### 调整：名册部门并入调岗、岗位职责条目化（v5.7）

- **名册部门移入调岗**：人事详情页的名册资料不再包含「名册部门」下拉；调岗表单新增「名册部门」下拉（仅关联名册的员工显示），提交时先发公司化 `moveEmployee`，再发名册 `assignGroup`，成功后刷新名册与总架构概览并回到详情。
- **岗位职责条目化**：职责输入改为条目列表（最多 8 条，可添加/删除每条），取消「每行一条」要求；保存时自动 trim、丢弃空条目并截断到 8 条。
- **测试**：`test/company-panel.test.mjs` 64→66 用例（新增调岗携带名册部门、职责条目上限）；全量 **454/454**，`node scripts/verify-company.mjs` **19/19**。

### 调整：部门弹层收窄、「成员详情」页签、选择器置顶（v5.6）

- **弹层收窄减留白**：部门弹层卡片宽度 `min(1100px, 95vw)` → `min(940px, 92vw)`，卡片内边距 18→14；人事详情面板与信息网格的行距/内边距同步收紧。
- **页签改名**：第二个页签「成员详情列表」→「**成员详情**」（`cpModalMembers`，英文仍 "Member details"）；弹层副标题 `dpModalHint` 同步。
- **选择器置顶**：技能/模型选择弹层原先渲染在总架构面板末尾且 `zIndex: 9999`，会被部门弹层遮住；现改为渲染在面板树最前，`pickerBox` 的 `zIndex` 提升到 `2147483600`，始终可见。
- **测试**：`test/company-panel.test.mjs` 64/64 用例同步断言；全量 **452/452**，`node scripts/verify-company.mjs` **19/19**。

### 新增：面板「人事管理」详情页（v5.4）

- **合并操作入口**：总架构 → 部门弹层 → 成员详情列表中，原先每行四个按钮（通道 / 晋升 / 停用 / 调岗）合并为单个「人事管理」按钮；点击在该行下方展开员工详情页（保持原有向下展开模式，不开二级弹窗）。
- **详情页内容**：头部（人事管理 + 工号 + 姓名 + 通道等级徽章）；基本信息（部门编号与名称、类型、角色、状态、会话策略、通道说明）；**可编辑的名册资料**（中文显示名、岗位名称、岗位职责、技能、模型覆盖与 provider、名册分组，保存时依次调用 `renameMember/setRole/setSkills/setModel/assignGroup`）；未关联名册的员工显示提示。
- **四项人事操作**：详情页内保留通道 / 晋升 / 停用 / 调岗，点击后详情保持、表单在下方展开，保存成功回到详情页。
- **测试**：`test/company-panel.test.mjs` 56→61 用例（迁移 10 个旧交互 + 新增 5 个），`test/client-bundle.test.mjs` 38 用例；全量 **449/449**，`node scripts/verify-company.mjs` **19/19**。

### 修复：v5 审阅建议（v5.3）

- **R1 文档纠错**：v5 as-built 把 `test/client-bundle.test.mjs` 误记为 39 用例（实测 38），已更正。
- **R2 跨通道晋升默认等级**：部门弹层「晋升」表单在双通道员工切换通道时，此前用主通道的 `emp.level` 去目标通道找下一级，可能算不到而回退最低级；现改为先取该员工在所选通道的现有等级，再计算下一等级（该通道无等级时默认该通道最低级）。
- **R3 管理层排序自然序**：`view().management` 的部门编号/等级代号/工号比较改用 `localeCompare(..., {numeric:true})`，未来出现 D9→D10、M9→M10 时不再按字典序排错；新增回归用例「D9 在 D10 之前」。
- **测试**：全量 **444/444**、`node scripts/verify-company.mjs` 19/19。

### 修复（真实宿主端到端验证发现）

- **派工 provider 名**：`company.provider` 默认值由错误的 `"default"` 改为宿主真实注册名 `"spawn"`（`"default"` 会让 `subagents.startActivation` 抛 `NO_PROVIDER`）；配置支持 `company.provider`，非法值回退默认并 warning。
- **验收标准归一**：`company_order` 的 `acceptance`/`deps` 传字符串时自动归一为数组，不再被账本层丢弃。
- **真实宿主激活参数**：`subagents.startActivation` 补上必填的 `signal`（AbortController，会话结束时中止）；初始 prompt 改为消息块数组；`agents.create` 的 `agentOptions` 不再误把 subagent provider 名当 LLM provider（留空走宿主默认模型，子会话继承）。
- **工具执行上下文形状**：`wrapExecute` 曾把宿主原始 executionContext 直接传给处理函数，而处理函数按 `{ exec }` 解构，真实宿主没有 `.exec` 这一层 → `exec.agent.session.id` 恒为空，员工 `company_report`/`company_ask_help` 一律返回 `E_STALE_ATTEMPT`。现由 `wrapExecute` 统一归一为 `fn(args, { exec })`，并把测试的第二参改为真实形状（裸 executionContext），新增回归保护。
- **成本归因监听错事件**：`assistant/message` 是**会话事件**，只能通过 `agent.ctx.on("session/event", (session, event) => ...)` 观察；原先监听的 `agent.ctx.on("assistant/message")` 在真实宿主上永不触发，导致 `/company/costs` 恒为 0。员工与 owner 两条用量累加路径均改为 `session/event`，fake 也改为只提供该形状（不再提供捷径）。
- **attempt 落定与完成审计**：员工 `company_report` 后 attempt 的 `state` 停在 `running`（只有 `status`/`payload` 更新），且审计流只有 `report_received`、没有 `order_done`。现 `reportAttempt` 同步把 `state` 落为 `done`/`failed`，dispatcher 追加 `order_done`/`order_failed` 审计事件；新增回归断言。
- **派工失败回滚**：会话创建失败时订单回滚到 queued（不再留下 running 无 attempt 的僵单），并写 `assign_failed` 审计。
- **owner/员工模型路由**：插件自建的根级 owner Agent 不经过 GUI 会话创建路径，拿不到会话默认模型；改为启动时读取宿主 `agent-default-model` 服务的默认 provider/model 写入 owner 的 `agentOptions`，子会话继承。此前会导致子会话首轮请求前抛 `agent "..." has no provider/model`，表现为「派工成功但员工毫无动静、costs 为 0」。
- **员工静默失败可见化**：owner 与每个员工会话注册 `agent/error` 监听，把错误写进 boot.log（此前 agent loop 会吞掉首轮错误，看起来像卡住）。
- **补号审计计数**：`company.codes.backfilled` 的 `count` 原取 `ensureCompanyCodes(...).warnings.length`；但「缺号」是无 warning 直接补的，历史员工编号又已在 `store.load` 的 `normalizeCompany` 阶段补好，导致真实补号时 count 恒为 0。现改为「load 阶段迁移数 + boot 阶段实际变更编号数」，新增回归用例锁定历史数据补 2 个编号（部门 D01 + 员工 E0001）时 count=2。

### 保留

- 名册覆盖层、16 个既有 `member_*` / `group_*` 工具、组织架构图、可视化工作流、备份、更新、一键建组等 0.2.x 能力全部保留，既有测试不回归（全量计数以 `npm test` 为准）。

### 兼容性

- 需要 DSH 0.2.1-rc.2 及以上（`agents.create/resume`、`subagents.startActivation`、`tools.restrict/guard`、`agent/status`、`tool/result`、`assistant/message.usage`）。
- 旧版事件名 `agent/session-start` 在当前宿主不存在，不再需要兼容分支；运行时对事件缺失一律降级。
