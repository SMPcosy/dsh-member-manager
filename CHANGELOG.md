# Changelog

## 0.3.0（2026-10-20）· 公司化运行时 + 品牌重命名

本版本把插件从「名册管理覆盖层」升级为「单包公司化运行时」：不再依赖 DSH 原生团队层（`ctx.agentTeams`），只用 `ctx.agents` / `ctx.subagents` 承载两级组织（部门经理 → 员工）的派工闭环。

### 新增：旧包一键迁移与首次启动自动数据迁移（v5.25）

- 新增 `scripts/migrate-old-plugin.mjs`：一键把 profile 从旧包 `dsh-plugin-member-manager` 升级到 `dsh-member-manager`——默认 dry-run，`--apply` 时先备份 profile，再改写 `dependencies` / `bundles` / `cordis.yml` 三处、删除旧包目录，并写入数据迁移标记 `<dataDir>/pending-migration.json`；支持 `--mode npm|link`、`--target`、`--data-only`（只写标记）、`--no-marker`、`--no-uninstall`。
- 新插件首次启动自动消费该标记：依次执行 `syncRoster`（名册小组→部门、active 成员→员工）与 `importRosterProfiles`（只补空档案字段），成功后删除标记并写审计 `company.migration_started` / `company.migration_completed`；`registry.json` 缺失时跳过并写 `company.migration_skipped`；失败保留标记并累加 `attempts`，满 3 次改名 `pending-migration.json.failed` 停止重试。
- 名册数据与数据目录格式不变：旧包用户的成员、小组、备份、技能/模型覆盖在升级后原样可用；公司化组织由迁移生成，幂等（重复 dryRun 全空）。
- 新增 `test/migrate-plugin.test.mjs`（5 用例）与 `test/company-runtime.test.mjs` 的 3 个标记消费用例；全量 **496/496**、`node scripts/verify-company.mjs` **19/19**。

### 修复：员工会话保留宿主标准工具（v5.24）

- **现象**：给「内容部」派发宣传图工单后，员工（staff 线）调用 `ops_bash` 被 `E_TOOL_LINE` 拒绝，无法运行 Python/Pillow、无法写文件，只能回报 blocked（单元测试全绿但真实任务做不了）。
- **根因**：`setupAgentContext` 用 `tools.restrict(allow=company_* 白名单)` 过滤继承层，把宿主标准工具（读写文件 / bash / 技能）一并滤掉；`guard` 又对一切工具名做白名单校验。
- **修复**：`src/host/company-employees.mjs` 不再调用 `restrictTools`；`guard` 只对 `company_*` 工具做线白名单校验（其他工具放行），执行体内部仍保留会话反查。行隔离语义 = 拦公司管理工具越权，不剥夺员工干活所需的标准工具。
- **影响**：员工/窗口线仍不能调用 `company_hire`/`company_admin` 等越权公司工具；488 测试全绿，无需数据迁移。

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

### 改进：总架构图连接线与视觉美化（v6）

- **画布卡片化**：架构图外层改为圆角卡片（淡蓝渐变底 + 1px 描边），与上下内容分行更清晰；`minWidth: 640` 保证窄屏出现横向滚动而不是挤压变形。
- **管理层节点胶囊化**：中心「管理层」节点改为蓝紫渐变胶囊（圆角 999、投影、加粗），点击行为不变（打开只读弹层）。
- **连接线改为「每分支自绘臂」**（v6.1 修正错位）：横向总线不再用百分比定位，而是由每个分支各画左右两段半臂（首分支隐藏左臂、末分支隐藏右臂）；分支彼此紧贴，半臂在分支中心处首尾相接，形成从首个领导节点到最后一个领导节点的连续横线，因此不受 `minWidth/maxWidth` 上限影响、不会再出现断点与错位。连接路径：管理层 → 竖直主干（落在整行正中）→ 横线（各分支半臂拼成）→ 分支下垂线 → 领导节点 → 短竖线 → 部门框。
- **分支等宽对齐**：每个分支 `flex: 1 1 0`（172–300px），领导节点胶囊描边，部门框统一为圆角 12 卡片（描边 + 阴影），各卡片的领导节点、部门框上下对齐。
- **部门框信息重排**：编号徽章 + 名称一行；负责人一行；底部改为 **M / P 通道人数徽章**（复用通道配色）+ 右侧编制（已用/上限），信息密度和扫描性更好。
- **图表下方数据区重排（v6.1）**：8 项 KPI 改为 4 列等宽紧凑网格（`maxWidth 660`、数值 15.5px、标签 10.5px、等宽数字）；编号规则与等级图例合并进同一张「元信息」卡片（两行：编号规则 / 等级图例），不再各自散落；成本归因三列改为三等宽网格（`repeat(3, minmax(0,1fr))`），行高与字号收紧，整体宽度统一、留白减少。
- **测试**：`test/company-panel.test.mjs` 架构图断言改为按「部门框」元素校验编号 / 负责人 / M、P 人数 / 编制；全量 **465/465**，`node scripts/verify-company.mjs` **19/19**。

### 新增：名册档案迁入公司化员工（v5.8）

- **员工档案字段**：员工新增 `title`（岗位名称）、`duties`（职责条目，≤8 条）、`model`/`provider`（模型覆盖）三个可选档案字段，与既有 `displayName`/`skills` 一起构成公司化档案；`company.json` 重载时归一保留（非法值丢弃、职责截断 8 条）。
- **新写接口**：`POST /company/op` 新增 `updateEmployeeProfile`（一次请求写显示名/岗位/职责/技能/模型，`employee_profile_updated` 审计）与 `importRosterProfiles`（把名册 active 成员的档案**只补空字段、绝不覆盖**地迁入同名员工，支持 `dryRun`，`roster.profiles_imported` 审计）。
- **模型覆盖生效**：员工同时配置 `provider` + `model` 时，其公司化会话通过 `agentOptions` 继承该路由；缺一沿用宿主默认。
- **面板**：「人事管理」详情页的「名册资料」改为「公司化资料」，直接读写公司化员工并用单次 `updateEmployeeProfile` 保存（不再串行发名册 op）；总架构工具栏新增「导入名册资料」按钮一键迁移名册档案。调岗表单里的「名册部门」暂保留。
- **修复**：`importRosterProfiles` 曾误读 `member.duties.title` / `member.duties.duties`，而名册成员的真实形状是 `{ title, duties: string[] }`（title 与 duties 同级），导致真实名册的岗位与职责永远导不进来；现改为读 `member.title` 与 `member.duties` 数组，单测夹具同步改为真实形状并断言 title/duties 被补入。
- **测试**：shared/host/panel 新增用例，全量 **465/465**，`node scripts/verify-company.mjs` **19/19**。


### 变更：移除名册分组与名册 UI（v5.9）

- **数据**：删除 `registry.json` 的 3 个名册分组（管理层 / 插件部 / 知识库），13 名成员变为未分组（删除前备份 `~/.dsh/backups/registry-before-group-removal-20261021T142037.json`，成员档案保留，人事详情页的显示名/岗位/职责/技能/模型已由 v5.8 迁入公司化员工）。
- **面板**：总架构工具栏移除「从名册同步」按钮；调岗表单移除「名册部门」下拉；client 侧 `cpSyncRoster`/`cpSyncDone`/`cpSyncSummary`/`cpRegistryMembers` 删除，`CompanyOrgPanel` 不再接收名册 props。保留「导入名册资料」按钮（只补公司化员工空字段）。
- **host**：`syncRoster` action 保留（向后兼容，面板不再暴露）；`moveEmployee` 不再联动 `assignGroup`。
- **测试**：`test/company-panel.test.mjs` 66→60 用例（删除名册同步与名册部门用例，新增「CompanyOrgPanel 只接收 t」）；全量 **459/459**，`node scripts/verify-company.mjs` **19/19**。


### 新增：总架构图可编辑——管理层重命名、编号规则/等级通道自定义、部门编辑（v5.11）

- **管理层重命名**：最高层「管理层」节点标题与只读弹层标题改用 `company.managementName`（默认「管理层」）；弹层新增「重命名」入口，保存 `POST /company/op {action:"setManagementName"}`（1–40 字符、审计 `company.management_renamed`），重启后保留。
- **编号规则可编辑**：图表下方 meta 卡「编号规则」行新增编辑按钮 → 弹层里改员工/部门模板与起始号，保存 `setNumbering`（模板必须含 `{seq}`/`{seq:N}`，占位符限 `seq`/`dept`/`channel`/`level`，审计 `numbering_set`）。
- **等级通道可编辑**：meta 卡「等级图例」行新增编辑按钮 → 弹层按 M/P 两段改通道名称与各等级名称，保存 `setLevels`（代号不可增删、名称非空、审计 `company.levels_set`），图例与员工等级徽章即时更新。
- **部门编辑**：部门弹层「部门架构图」页签新增「部门编辑」按钮，表单含名称/编号/编制容量/职责描述/接单范围/借调策略，保存 `updateDepartment`（`borrowPolicy` 透传并落盘）。
- **工具层**：`company_admin` 新增 `setManagementName`/`setLevels`，`setNumbering` 返回值补 `numbering`；shared 新增 `normalizeManagementName`/`normalizeLevelsOverride`/`MANAGEMENT_NAME_DEFAULT`。
- **测试**：company-levels 41、company-runtime 48、company-panel 65；全量 **472/472**，`node scripts/verify-company.mjs` **19/19**。

### 变更：预设技能改从已安装技能列表拉取；点「创建」真正创建部门与员工（v5.23）

- **技能取自本机技能目录**：打开「创建预览」时先 `GET /skills`（模块级缓存一次），把角色技能标签经 `CP_SKILL_LABEL_CATALOG` 映射为真实技能名——如系统设计→`codebase-design`、代码审阅→`code-review`、接口设计→`implement`、单元测试→`tdd`、数据分析→`office-xlsx`、文案撰写→`writing-shape`、培训→`teach`、团队管理→`chief-of-staff` 等；每行最多 4 条、去重；技能服务不可用时回退预设标签，不阻断流程。
- **创建即落库**：点「创建」先建部门，再逐个 `createEmployee`，把**姓名/岗位/职责/技能/模型/通道/等级**一并写入（role=staff、kind=permanent）；不再是「只预设不写入」。
- **部分失败可续建**：部门创建成功但个别员工失败时，预览保持打开并提示 `cpPreviewEmpFailed`（失败数/总数 + 首个错误），已建员工标 ✓、`createdId` 记录部门，重试只补建失败者；全部成功才关闭并刷新；部门已建后「返回修改」与行编辑禁用。
- **提示文案**：`cpPlannedHint` 改为「技能来自本机已安装技能列表…点创建会连同员工一并写入」。
- **测试**：company-panel 72（新增「点创建先建部门再逐个创建员工（岗位/技能/模型写入）」「cpMapCatalogSkills 从目录拉取」）；全量 488/488、verify 19/19。

### 改进：补充创意/平面设计/文案等岗位预设（v5.22）

- **新增 10 个创意与内容岗位**：平面设计师（海报设计/版式排版/印刷规范）、品牌设计师（品牌规范/VI 设计/视觉统一）、插画师、创意策划（创意提案/概念提炼/方案撰写）、编剧（脚本创作/分镜设计/台词打磨）、3D 设计师（三维建模/材质渲染/灯光渲染）、动画师、摄影师、文案编辑、内容策划；模型档位与既有规则一致（创意/设计类 pro，文案/摄影/内容类 flash）。
- **匹配细化**：原「平面/品牌设计/创意」不再粗暴归到界面设计师——平面/品牌/创意各自命中专用岗位；「动画/动效」从视频组拆出为动画师；「编剧/脚本/分镜」独立；「内容策划/选题策划」独立于运营。
- **消歧**：数据科学家不再用「建模」泛匹配（避免「3D 建模」误判），改为「统计建模/数据科学/数据挖掘」。
- **测试**：岗位覆盖用例扩到 30 组断言；company-panel 71、全量 487/487、verify 19/19。

### 改进：角色词典覆盖电脑办公常见岗位，并按岗位模拟技能与模型（v5.21）

- **角色词典扩容**：`CP_BRIEF_ROLE_PRESETS` 从 8 条扩到 41 条，覆盖技术（架构、算法/AI、数据工程、数据分析、数据科学、安全、DBA、运维、测试、审阅、交互/视觉设计、前端、移动端、全栈、后端、嵌入式、IT 支持、技术经理）、管理与业务（总经理、总监、经理/主管、产品经理、项目经理、咨询顾问）、职能（市场、销售、客服、运营、文案、翻译、视频、通用设计、人事、行政、会计、审计、法务、供应链、金融、培训、研究、品控）以及工程师/专员/经理兜底。
- **技能模拟**：每个岗位预置 3–4 条贴合职责的技能（如会计→账务处理/报表编制/税务申报；销售经理→客户开发/商务谈判/合同跟进；数据分析师→数据分析/SQL 查询/可视化报表）。
- **模型模拟**：按岗位类型给出建议模型——规划/分析/审阅类 `deepseek-v4-pro-0813`、研发/测试/运维类 `kimi-k2.7-code`、事务/职能类 `deepseek-v4.1-flash-1017`；解析出的预设行直接带模型，仍可在预览里手改，且不写入后台。
- **匹配顺序**：具体岗位优先（法务→法务专员先于「审查」→审阅工程师、UI 设计→设计师先于前端），避免误判。
- **测试**：新增「角色词典覆盖常见办公岗位 + 技能/模型模拟」用例（20 组岗位断言）；company-panel 71、全量 487/487；`node scripts/verify-company.mjs` 19/19。

### 变更：新建部门预览改为「员工预设方案」——只建部门，员工不写后台（v5.20）

- **一句话解析员工预设**：`cpParseBrief` 返回新增 `employees`；解析「新建插件部，编制 3 人：插件架构负责机制、插件编写负责实现」时，取最后一个 `：` 之后的片段按顿号/comma 切分，匹配「名称负责职责」生成预设行（≤12 行、按编制截断）。
- **角色词典预设岗位/技能**：新增 `CP_BRIEF_ROLE_PRESETS` 与 `cpBriefRolePreset`，按姓名+职责关键词匹配（架构→架构师[系统设计,代码审阅]、审阅→审阅工程师、验证/测试→测试工程师、设计/界面/前端→界面工程师、文档/知识→文档工程师、数据/分析→数据分析师、运维/部署→运维工程师、编写/开发/实现/工程→工程师[编码实现,单元测试]）。
- **预览编辑器四列扩展**：预设行可编辑姓名/岗位/技能（「、」分隔，≤12 条）/模型，另可改通道（M/P）/等级或删除行；无成员描述时仍按编制生成「新员工 1..N」默认行。
- **只建部门**：点「创建」只发一次 `createDepartment`，不再逐个 `createEmployee`；`cpPlannedHint` 明示「岗位/技能/模型仅作参考，不会写入后台」；移除 `cpPreviewEmpFailed` 与 createdId/✓ 重试逻辑；`返回修改` 常驻可用。
- **测试**：company-panel 70 用例（新增「预览员工只是预设，点创建只 POST createDepartment」「一句话解析预生成员工 + 角色词典」）；全量 486/486。

### 新增：新建部门预览按编制预生成员工并一并创建（v5.19）

- 点「创建预览」时按编制人数 N（上限 50）自动**预生成 N 名员工行**：默认姓名「新员工 1..N」、通道 P、等级取该通道目录首级；预览内可改姓名、切换 M/P 通道与等级、删除行。
- 点「创建」时先建部门，再按预览行逐个 `POST /company/op createEmployee`（role=staff、kind=permanent、department=新部门）；全部成功后关闭并刷新 overview。
- 部分员工失败时对话框保持打开并提示 `cpPreviewEmpFailed`；已成功员工标记 ✓，预览记住已创建的部门 id，重试时只补建未成功的员工（不会重复建部门）。
- 命中已存在部门的预览仍只读展示该部门员工。
- 新增文案键 `cpPlannedHint`/`cpEmployeeName`/`cpPreviewEmpFailed`（zh/en 对称）；`test/company-panel.test.mjs` 增加预生成与「建部门 + 逐个建员工」「部分失败重试」用例（69 用例）。

### 新增：预览/部门编辑列出「本部门员工」详情（v5.18）

- 新建部门的「创建预览」弹窗在字段区下方新增只读「本部门员工（N）」区块；新建部门尚无员工时显示空态文案「暂无员工，创建后可招聘或调岗」，若预览的 ID/名称命中已存在部门则列出该部门员工详情。
- 部门弹层的「部门编辑」表单底部同样列出该部门员工详情（工号、通道等级徽章、姓名、岗位、状态点，含已停用员工），新增 `cpDeptEmployees`/`cpPreviewNoEmployees` 文案键（zh/en 对称）。
- `test/company-panel.test.mjs` 扩展预览与部门编辑用例的断言（员工区块计数/空态/员工详情）。

### 变更：新建部门改为「创建预览」两步（v5.17）

- 「新建部门」对话框删除「解析」按钮与提示行；一句话描述 textarea 改为**灰色示例占位**（`cpNewDeptBriefPh`，例：新建市场部，编制 5 人，负责市场推广）。
- 底部主按钮改为 `创建预览`（`cpPreviewDept`）：点击自动解析一句话（纯客户端、不发请求），把名称/说明/编制写入并打开「创建预览」弹窗。
- 预览弹窗展示可编辑的四项（部门 ID/名称/说明/编制），支持 `返回修改` 回到第一步；点 `创建` 才真正 `POST /company/op createDepartment`，成功后关闭并刷新，失败在预览内显示 `{code}: {message}` 且保持打开。
- `test/company-panel.test.mjs` 的对话框/解析/创建用例改写为两步流程（67 用例）。

### 视觉调整：管理层窄高卡片 + 工作网圆角总线连线（v5.16）

- 管理层节点改为**窄高竖排卡片**：宽度 230px → 118px、最小高度 100px，状态点/名称/成员数/token 用量居中竖排，相对部门列自动上下居中。
- 工作网连线由直线扇形改为**圆角总线扇形**：父节点右缘先横出到竖向总线（首尾圆角）再从总线接入每个子节点左缘；部门→员工按部门色区分，落点绘制小圆点，更接近组织架构图。
- `test/client-bundle.test.mjs` 增加管理层窄高卡片结构断言。

### 变更：工作网改为横向层级视图 + 空闲员工折叠（v5.15）

- 工作网（右栏）改为**从左至右展开**：管理层在最左，部门色块按序竖向堆叠在第二列，各部门员工卡片在第三列竖向排列；连线改为**直线扇形**（管理层→每个部门；部门→本部门每张员工卡与空闲折叠按钮）。
- **空闲员工默认折叠**：仅渲染运行中或有进行中工作的员工，其余折叠为「+N 展开空闲成员」按钮（与员工卡同宽的虚线卡片节点，连线同样接入），点击展开/收起（视图内临时状态，不落盘）。
- 测试：client-bundle 41/41（工作网用例覆盖折叠与展开），全量 **483/483**，`node scripts/verify-company.mjs` 19/19。

### 调整：工作网「管理层」节点左对齐（v5.14.2/v5.14.3）

- 右栏工作网竖向布局中，管理层节点固定为**顶部行最左侧**，部门行仍自左向右排布，连线自动改为跨越式折线。
- 公司化运行时会话（id 以 `company-owner-` 开头）在任务下拉中的标题显示为**自定义公司名**，不再回落为 `company-1` 之类的会话名；host 侧 `/orgmap` 与 client 侧选择器双重兜底。

### 新增：公司名称自定义 + 工作网竖向布局（v5.14）

- 插件面板页头「成员管理」标题后直接显示**公司名称**（与标题同字号），点击弹出编辑菜单保存（1–40 字符，写入 `company.json` 并审计 `company.renamed`），`GET /state` 与 `GET /orgmap` 均返回 `companyName`。
- 工作网改为**竖向布置**：管理层在上，部门自上而下逐行堆叠，每行左侧部门色块、右侧员工卡片；连线改为竖向总线 + 部门到员工的小括号连接。
- 工作网任务栏在无任务时显示**自定义公司名**（此前显示空文案）。
- `POST /company/op` 新增 `setCompanyName`（`E_INVALID_COMPANY_NAME`）；新增 shared 导出 `COMPANY_NAME_DEFAULT`/`COMPANY_NAME_MAX`/`normalizeCompanyName`。
- **测试**：company-levels 44、company-runtime 51、client-bundle 41；全量 **483/483**；`node scripts/verify-company.mjs` 19/19。

### 变更：右侧栏「组织架构」改为公司化「工作网」（v5.13）

- 右侧边栏 tab 更名为「工作网」，数据源从名册/任务参与者改为公司化组织：管理层（M 通道聚合）→ 部门（编号 + 负责人）→ 员工（工号 + 等级徽章 + 模型 + 任务 + 用量）。
- `/orgmap` 升级为 version 3、`source: "company"`，新增 `worknet` 统计、部门 `code`/`managerName`、员工 `code`/`channel`/`level`/`levelName`；公司化未启用或无员工时回退旧任务视图（version 2）。
- 页脚新增「员工 N / 部门 N」；任务下拉保留，仅影响任务摘要与动态连线。
- **测试**：client-bundle 39 用例（新增工作网渲染用例）、全量 478/478；verify 19/19。

### 修复：历史数据中的旧通道显示名自动迁移（v5.12.3）
- boot 时若 `company.json` 持久化的等级目录里 P 通道 label 仍是「专业技术通道」，自动改写为「技术通道」、持久化并写审计 `company.levels_label_migrated`。
- **测试**：company-runtime 50；全量 477/477。

### 变更：P 通道显示名改为「技术通道」（v5.12.2）
- 「专业技术通道」统一改为「技术通道」，与管理通道同为 4 字，面板等级图例、KPI、通道编辑弹层与默认等级目录同步更新（英文仍为 Professional track）。
- 历史数据不受影响（等级代号与员工数据未变）；**全量 476/476**。

### 新增：删除等级后自动顺位（v5.12.1）
- 等级通道弹层删除某一等级后，剩余等级代号立即重排（如删 P1，原 P2 显示为 P1）；保存时随 `setLevels` 提交 `levelRemap`。
- host `applyLevelsOverride` 按 `levelRemap` 同步改写员工 `channels[].level` 与 legacy `channel/level`；无映射且旧代号不在新目录报 `E_LEVEL_IN_USE`，映射目标非法报 `E_INVALID_LEVELS`。
- **测试**：company-runtime 49、company-panel 67；全量 476/476。

### 新增：总架构自定义能力增强——占位符说明、等级可增删、按钮改名「自定义」（v5.12）
- **编号规则说明**：自定义编号规则弹层新增占位符用法说明（`{seq}`/`{seq:N}`/`{dept}`/`{channel}`/`{level}` 含义与示例，多行渲染）。
- **等级梯度可增删**：等级通道弹层每级可删除（仅剩 1 级时隐藏）、每通道可添加等级（代号自动递增），保存走 `setLevels`；shared 新增 `validateLevelsDirectory` 校验代号格式/重复/空名/每通道 ≥1 级。
- **引用保护**：删除仍被员工使用的等级返回 `E_LEVEL_IN_USE` 并提示员工名；`defaultLevelFor`/`createEmployee` 改为按 `company.levels` 目录取等级。
- **按钮改名**：meta 卡两个入口按钮改为「自定义」（`cpCustomize`）。
- **测试**：company-levels 42、company-runtime 48、company-panel 66；全量 474/474；`node scripts/verify-company.mjs` 19/19。

### 变更：移除导入名册按钮 + 人事详情资料区 3 列布局（v5.10）

- **面板**：总架构工具栏删除「导入名册资料」按钮（`cpImportProfiles`/`cpImportDone` 文案、`importRosterProfiles()` 调用、`syncResult`/`syncError` 状态一并删除；host 侧 action 保留）；「人事管理」详情页的「公司化资料」改为 3 列栅格——第 1 行「中文显示名 / 岗位名称」，第 2 行「技能选择 / 模型选择」，第 3 列（跨两行）整列留给「岗位职责」条目编辑；前两列压缩为 `minmax(120px,190px)`，剩余宽度全部给岗位职责列。
- **测试**：`test/company-panel.test.mjs` 同步（移除导入按钮断言与 sync 状态位，新增 3 列布局源码断言）；全量 **459/459**，`node scripts/verify-company.mjs` **19/19**。

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
