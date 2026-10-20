<div align="center">

# 📇 DSH Member Manager / 成员管理
# 已发布到官方NPM
**A DeepSeek Harness plugin for team org structure, Chinese display names, roles, skills and per‑member model overrides.**

**一个管理团队组织架构、中文显示名、岗位职责、技能，以及按成员模型覆盖的 DSH 插件。**

`dsh-member-manager` · **v0.3.0** · License: MIT

点击下方标题可查看 **中文** 或 **English**。  
Click a heading below to view **English** or **中文** .

</div>

---

<details open>

<summary><b>🀄 中文（默认打开）</b></summary>

## 简介

**成员管理（Member Manager）** 是一个 DeepSeek Harness（DSH）插件，让你以「小组 → 成员」的两级结构管理团队组织架构，并为成员维护 **中文显示名、岗位职责、技能标签、启用/停用状态**，还可以**按成员单独指定模型**。

> ⚠️ 重要背景：DSH 的成员名（`target`）由核心强制为小写 kebab-case 且**不可改名、不可删除**。因此本插件**不改动核心团队状态**，而是在自己的「覆盖层名册」里维护这些附加字段——数据读写完全安全，不碰官方内核。

- 数据落盘于：`~/.dsh/storages/member-manager/registry.json`（可配置）。
- 提供**宿主端工具**（Agent 可调用）与 **Web 管理面板**（人可操作）。

## v0.3.0 更新要点

- 🏷️ **品牌重整（不破坏数据）**：包名 / 插件 id / 客户端命名空间 / 面板 API 前缀统一为 `dsh-member-manager`（原 `dsh-plugin-member-manager`）；版本号仍为 **0.3.0**。名册数据目录与 `registry.json` 格式不变，旧名安装可直接切换、可回滚。
- 🏢 **公司化运行时（本版核心）**：在名册覆盖层之上，把成员当作「公司」来编排——**部门、工单（order）、派工凭证（attempt）、回报与验收、审计流水、token 成本归因**。全部建立在 `ctx.agents` / `ctx.subagents` 的会话能力之上，**不依赖原生 team 层**。
- 🧵 **四条工具线自动隔离**：窗口线（`company_order` / `company_status` / `company_ask` / `company_cancel`）只能下单、查询、催办；经理线（`company_assign` / `company_review` / `company_borrow` / `company_report` / `company_escalate` 等 11 个）管理派工与验收；员工线（`company_accept` / `company_report` / `company_ask_help`）只做自己的活；管理线（`company_hire` / `company_admin`）仅 owner 可用。越权调用返回 `E_TOOL_LINE`，隔离由 `tools.restrict` 白名单 + 同步 `tools.guard` + 执行体 `exec.agent.session.id` 反查三道共同保证。
- 🪪 **attempt 凭证防串单**：`company_report` 必带 `attemptId`，陈旧 attempt 直接拒绝；`company_order` 支持 `clientOrderId` 幂等重放；工单依赖完成后才解锁下游。
- 💰 **成本与审计**：员工/经理会话的 token 与请求数按「员工 / 部门 / 工单」聚合（`GET /company/costs`）；组织与账本落 `company.json`，审计追加到 `audit.jsonl`（append-only、加载时对账重放）。`company_admin` 当前支持 `createDepartment` / `createEmployee` / `setRoutingRules`。
- 🧯 **全链路降级**：宿主没有 `agents` / `subagents` 服务时，公司化工具返回 `E_NO_AGENTS`，名册覆盖层（既有 16 个名册工具 + 面板 + 路由）不受影响；Agent 启动失败只记 warning，不阻断插件加载。
- 🧩 **新增 Web 只读接口**：`GET /company/{overview,org,board,costs,orders}`，统一 `{ ok: true, data }` 信封；`GET /state` 附带 `company` 摘要。
- 🎖️ **M/P 双通道等级与编号体系**：管理通道（M1 主管 → M5 副总裁）与专业技术通道（P1 初级工程师 → P6 首席专家）双通道；每名员工有唯一工号（默认 `E0001`、`E0002`…）并标注等级与部门，每个部门有唯一编号（默认 `D01`、`D02`…），两者都支持自定义模板。`company_hire` 可指定 `code/channel/level`，`company_admin` 新增 `updateDepartment` / `promoteEmployee` / `setNumbering`；历史数据在 boot 时自动补号，不丢员工。
- 🖥️ **「总架构」组织架构图面板**：首个页签「总架构」默认就是组织架构图——最高层「员工中心」（下拉筛选：全体员工 / 单部门 / 未启用成员，按部门与等级排序）横向连接各部门领导，向下接各部门图框；点部门图框弹出部门弹层（两个页签：部门架构图 / 成员详情列表，可招聘、晋升、停用、调岗）；工具栏「新建部门」内置一句话解析（原「一句话建组」并入）；图表下方保留 KPI、编号规则、等级图例与成本归因（按员工/部门/工单 top5），5 秒轮询 + 手动刷新，读 `GET /api/dsh-member-manager/company/overview`，写 `POST /api/dsh-member-manager/company/op`。
- 🎯 **组织架构图任务视角（并入本版）**：组织架构图从「全团队」改为**任务作用域**——一个 root 会话就是一个任务，图上只出现这个任务真正需要的参与者（大总管 + `parentSession` 指向它的成员），不再把整个名册都铺出来。
- 🔽 **任务下拉切换（并入本版）**：右栏 tab 顶部新增任务选择器（由 `GET /orgmap` 返回的 `tasks[]` 驱动，带运行中标记与人数），切任务即换图；没有任何任务时显示空态并禁用下拉。
- 🧭 布局不变（并入本版）：仍是并联横向 / 串联纵向的三层视图（大总管 → 分组色块 → 组内成员），工作区卡片、结构线与动态引导线保留；任务内成员的 token / 用时只统计该任务各会话的用量。
- 🔌 `GET /orgmap` 契约升级到 `version: 2`：新增 `tasks` / `task` / `lead` / `groups` / `members` / `dispatch` / `dependency` / `totals`，支持 `?task=<rootSessionId>` 指定任务；未指定或指定失效时回落到最近活跃任务。
- 🧪 测试：既有测试全部保留并通过，新增公司化纯函数（org / ledger / router / store / config）、运行时 fake 闭环、打包元数据等用例（最终数量以仓库内 `npm test` 输出为准）。

## 公司化运行时怎么用

1. 确认名册里有成员（`member_list` / 面板）。
2. 首次需要时调用 `company_admin({ action: "createDepartment" | "createEmployee" | "setRoutingRules" })` 建组织，或直接 `company_order`：运行时会在 boot 时创建根级 owner 会话，并按配置建立部门与经理会话。
3. 在任意前台会话里 `company_order({ type, title, dept?, acceptance? })` 下单；经理线用 `company_assign` 派工，员工收到唤醒消息后干活，并**必须** `company_report({ orderId, attemptId, status, summary })` 回报。
4. 用 `company_status` 或面板/`GET /company/board` 看工单与工位；`GET /company/costs` 看成本。
5. 停机/卸载时运行时按「停派工 → 等 idle（超时）→ cancel → drainChildren → dispose owner」顺序优雅收尾，审计落盘。

> 公司化数据只写 `~/.dsh/storages/member-manager/`（`company.json`、`ledger/`、`audit/`），绝不写入插件目录或工作区。配置见下一节「公司化配置」。

## M/P 双通道等级与编号

**双通道**：`manager` 走管理通道 M，`staff` / `window` 走专业技术通道 P；等级目录默认：

| 通道 | 等级 |
| --- | --- |
| 管理 M | M1 主管 → M2 经理 → M3 高级经理 → M4 总监 → M5 副总裁 |
| 专业技术 P | P1 初级工程师 → P2 工程师 → P3 高级工程师 → P4 资深工程师 → P5 技术专家 → P6 首席专家 |

`company_hire` 不传等级时按岗位取默认（manager→M2，staff→P3，window→P1）；`company_admin({action:"promoteEmployee"})` 同通道只允许逐级晋升（±1 级），跨通道必须显式指定目标等级且 `role` 随之改变（window 不可转 M，转 M 前必须有部门）。历史数据缺等级/编号时在启动时自动补齐（等级非法回退默认、不丢员工）。

**编号**：员工编号默认 `E{seq:4}`（E0001 起），部门编号默认 `D{seq:2}`（D01 起）；模板占位符 `{seq}` / `{seq:N}` / `{dept}` / `{channel}` / `{level}`，全公司唯一，已占用则自动跳号。自定义示例：

```json
{
  "company": {
    "numbering": {
      "employee": { "pattern": "E{dept}-{seq:4}", "start": 1 },
      "department": { "pattern": "D{seq:2}", "start": 1 }
    },
    "levels": {
      "M": { "label": "管理通道", "levels": [{ "code": "M1", "name": "主管" }, { "code": "M2", "name": "经理" }] },
      "P": { "label": "专业技术通道", "levels": [{ "code": "P1", "name": "初级工程师" }, { "code": "P2", "name": "工程师" }] }
    }
  }
}
```

优先级：`company.json` 内持久化的 `numbering`（如 `company_admin.setNumbering` 写入）> 配置 `company.numbering` > 内置默认；等级同理。员工提示词头部会带一行身份（工号 / 等级 / 通道 / 部门编号），派工时员工直接看得到。

**面板**：设置页 →「成员管理」→ 默认「总架构」即组织架构图：员工中心（下拉筛选：全体员工 / 单部门 / 未启用成员）+ 各部门领导 + 部门图框；点部门图框打开弹层，第一个页签看部门架构图，第二个页签在成员详情列表里招聘 / 晋升 / 停用 / 调岗；工具栏「新建部门」输入一句话即可自动解析部门名称与编制（原「一句话建组」已并入）。面板写操作走 `POST /company/op`，也可以继续用 `company_hire` / `company_admin`。

## v0.2.4 更新要点

- 🪟 **去掉图表自带的窗口框**：删掉标题栏、折叠、⇤/⇥、刷新按钮与外框，组织架构图直接铺在右侧边栏 tab 里，宽度随右栏变化，内部横向滚动。
- 🧱 **并联—横向 / 串联—纵向**：同一层级的兄弟横向并排（并联），父子层级之间用纵向正交总线连接（串联）。三层结构为「大总管 → 分组色块（横向并排）→ 组内成员（横向并排）」。
- 🎯 首次渲染自动把视口横向居中到大总管；任务分发 / 依赖的动态引导线改走目标卡片外侧过渡带，不再压住分组色块和卡片。
- 🧪 测试保持 **228** 全绿。

## v0.2.3 更新要点

- 🧭 **组织架构图改为右侧边栏常驻 tab**：不再用浮在页面上的 fixed 覆盖层，而是注册为 DSH 右侧边栏（`sidebar.right`）的一个 tab，随右栏开合 / 分屏 / 全屏；关掉后可从会话头部的「组织架构」按钮重新打开。
- 🌳 层级树与工作区卡片、动态引导线保持不变；窄面板里动态线改走左侧沟槽的括号式折线，避免贴边糊成一条竖线。
- 🧹 移除拖拽、磁吸、浮动位置记忆等浮层遗留交互，只保留折叠。
- 🧪 测试 225 → **228**（client-bundle 新增 tab 注册 / 降级 / 内嵌三条）。

## v0.2.2 更新要点

- 组织架构图默认常驻**右侧边栏**，改为「大总管 → 分组色块 → 组内成员」的**层级树**布局，正交连接线；工作区卡片与动态引导线保留。
- 拖动不再自由漂浮，松手按落点吸附左右两侧；⇤/⇥ 可手动切换。

## v0.2.1 更新要点

- 🛡️ **名册自动备份**：每次写入名册后防抖 1.5s 自动快照，启动时再补一份；按「最近 N 份 + 最近 M 天每天一份」轮转，升级/回滚/误操作都能一键恢复（恢复前先自动备份当前状态）。
- ⬆️ **分阶段自动更新**：`check → stage → apply → rollback` 四段式。下载解到 `{dataDir}/updates/<version>/` 并记 `pending`；**面板不会在线应用**，退出 DSH 后运行 `node scripts/apply-pending.mjs ... --yes` 才替换；遇到 lnk/junction 安装、包名不符、staged 内容非法等 5 道闸门直接拒绝并给出可操作提示，失败自动回滚。
- 💬 **一句话建组**：面板「一句话建组」或工具 `member_group_from_text`，用自然语言描述小组与成员（示例已内置），先给**预览**（不落盘），确认后才创建小组并登记成员。
- 🗺 **组织架构图悬浮层**：把名册层级固化成常驻浮层，独立显示在 DSH 主界面（不占插槽、不进页面路由）。每个成员一张工作区卡片（名字、模型、任务简介、token 用量、用时）；任务活动时按「Lead 分发 / 任务依赖」画动态流动引导线；浮层可拖动，拖到窗口左右边缘 48px 内自动磁吸，也可点 ⇤ / ⇥ 手动吸附，折叠/展开与位置写入 localStorage。
- 📊 **可视化工作流面板**：新增「工作流」页签，显示每个成员的状态、当前工作包、token 消耗（入/出/缓存命中共）、用时、请求数，以及任务板进度；数据全部旁路采集，不阻塞会话。
- 🔧 工具从 12 个增至 **16 个**，HTTP 路由 6 → **10** 条（新增 `GET /orgmap`），测试 134 → **225**。

---

## v0.2.0 更新要点

- 备份/分阶段更新/一句话建组/工作流面板首次落地；安全红线：不在 DSH 运行中替换自身（`applyMode=offline-script`）。

## v0.1.2 更新要点

- 🖥️ **编辑弹窗重排**：一屏放下（技能 / 模型并排两列、职责框收紧），「选择技能 / 选择模型」改为紧贴标题的高亮按钮。
- 🧠 **模型改为弹层选择**：可搜索、按 provider 分组、显示上下文窗口、单选 + 「使用默认（清除覆盖）」，与技能弹层同一套交互。
- 🛡️ **宿主更健壮**：HTTP 路由统一兜底（写盘失败返回 500 + `INTERNAL_ERROR`，不再伪装成 400），`/health` 校验 method。
- ⌨️ **交互修复**：弹层开着时 Esc 只关弹层；保存中不响应遮罩关闭；显示名为空时禁用保存；保存部分失败会自动回读真实状态。
- 🧹 清理未使用的文案与样式键；测试从 130 增至 **134**，并新增静态交叉审计脚本。

---

## 截图


<img width="2196" height="1640" alt="DSH Member Manager01" src="https://github.com/user-attachments/assets/12b22bc4-97dc-41a7-a04c-3e6d1af3c5e6" />

<img width="2196" height="1640" alt="DSH Member Manager07" src="https://github.com/user-attachments/assets/d9858133-c497-4640-9919-0aa9696ff2c7" />

<img width="2196" height="1640" alt="DSH Member Manager02" src="https://github.com/user-attachments/assets/7ac1a139-412d-4922-b599-a2e59c583bf9" />

---
## 功能特性

- 🧑‍🤝‍🧑 **组织架构**：两级结构「小组 → 成员」，可新建 / 重命名 / 排序小组，成员一键归组。

- 🏷️ **中文显示名与别名**：显示名独立存储，`target` 保持不变。

- 🛠️ **岗位职责**：岗位名称（title）+ 职责条目列表（duties）。

- 🔄 **停用 / 恢复**：软删除，保留历史记录，随时恢复。

<img width="2196" height="1640" alt="DSH Member Manager03" src="https://github.com/user-attachments/assets/c6a603a8-b4fa-4495-a785-0fb65a66ae90" />

- ⭐ **技能赋予**：从本机技能目录选择（可搜索多选），也支持自定义标签。

<img width="2196" height="1640" alt="DSH Member Manager05" src="https://github.com/user-attachments/assets/d544aa19-6aae-4186-9560-fd9e56193696" />

<img width="2196" height="1640" alt="DSH Member Manager06" src="https://github.com/user-attachments/assets/78bd87d1-8922-4dd2-8fde-d6457ac73dc6" />


- 🧠 **按成员模型覆盖**：每个成员可单独指定 `provider/model`，下一次请求即生效；清空即恢复默认。这是通过官方 `agent/request` 水位接缝实现，**真生效**。

<img width="2196" height="1640" alt="DSH Member Manager04" src="https://github.com/user-attachments/assets/b40fe472-cf54-4a8e-b27c-f17cae4c41b6" />


- 📊 **Web 面板**：组织架构、行内编辑、未登记成员一键登记、诊断信息。

- 🛰️ **丰富工具**：12 个宿主端工具，Agent 可完整读写名册。

---

## 安装

### 方式 A：从插件市场安装

```bash
dsh-member-manager
```
复制上述插件名dsh-member-manager，在DSH进行如下操作

<img width="2558" height="1640" alt="member-manager​安装图示" src="https://github.com/user-attachments/assets/b0b211a3-898f-4dc2-9a17-d13a4671581a" />


### 方式 B：本地源码加载（开发/自用）

```bash
# 在插件源码所在目录的上一级执行
dsh plugin --profile desktop add link:"<本仓库绝对路径>"
```

> 安装后**必须重启 DSH**（该插件不支持热重载）：  
> 重启桌面应用，或退出重进。刷新 GUI 后在设置页 / 侧栏即可看到「成员管理」。



### 卸载

把插件条目从 profile 的 `cordis.patch.yml` / bundle 列表移除后重启 DSH 即可。名册文件会保留在 `~/.dsh/storages/member-manager/`，可手动删除。

---

## 使用

- **在对话里调用工具**：直接对 Agent 说「列出组织架构」「把张三加入数据组」等，或用 `member_list` / `member_add` / `member_set_role` / `member_set_skills` / `group_manage` 等工具。
- **在面板里操作**：进入 Web 面板 → 组织架构视图可视化编辑。
- **同步核心成员**：点击面板「同步核心成员」或调用 `member_sync`，把当前团队批量登记进名册。

---

## 配置项

在 DSH 插件配置里可用字段（均为可选，省略即用默认）：

| 字段                | 默认值                              | 说明                                |
| ----------------- | -------------------------------- | --------------------------------- |
| `dataDir`         | `~/.dsh/storages/member-manager` | 名册目录                              |
| `registryFile`    | `{dataDir}/registry.json`        | 名册文件路径                            |
| `scanLocalSkills` | `true`                           | 是否直接扫盘补充本地技能目录（`~/.dsh/skills` 等） |
| `extraSkillRoots` | `[]`                             | 追加的技能扫描根目录（绝对路径数组）                |
| `backups`         | `{enabled:true, keep:20, dailyKeep:7}` | 名册自动备份：保留最近 keep 份 ∪ 最近 dailyKeep 个实际日期每天最后一份 ∪ 兜底 3 份 |
| `update`          | `{enabled:true, checkOnBoot:false, autoStage:false, allowOnlineApply:false, registryUrl, installDir}` | 分阶段更新：检查/暂存/离线应用；`installDir` 一般不用填 |
| `workflow`        | `{enabled:true, persistMs:5000, retentionHours:6, tasksPollMs:3000}` | 可视化工作流采集：落盘间隔、保留时长、任务板轮询 |
| `enabled` / `company.enabled` | `true`                | 公司化运行时总开关；`false` 时 `company_*` 工具返回 `E_DISABLED`、名册功能不受影响 |
| `company.autoBoot` | `true`                          | 是否在插件 apply 后自动 boot 公司运行时（非阻塞；失败只 warning） |
| `company.defaultSessionPolicy` | `"per_task"`         | 员工会话策略：`per_task`（一单一会话）或 `resident`（常驻经理） |
| `company.managerActsAsStaff` | `false`             | 经理是否可被派活 |
| `company.defaultOrderMode` | `"async"`            | 下单默认模式：`async` 立即返回 / `wait` 等验收 |
| `company.provider` | `"spawn"`           | 派工使用的 subagent provider 名，必须与宿主已注册名一致（内置 `spawn`；需 fork 隔离时改 `fork`）。写错会在派工时返回 `NO_PROVIDER` |
| `company.requireManagerReview` | `true`         | 带验收标准的工单是否需要经理 review 才 done |
| `company.limits` | `{maxConcurrentPerProvider:4, maxTemps:4, budgetTokensPerDay:5000000, attemptTimeoutMs:1800000, lostReportGraceMs:120000, staleAttemptMs:3600000}` | 容量/预算/超时配置（结构校验 + 非法值回退默认并产生 warning；`staleAttemptMs` 用作调度 tick 周期；并发/预算闸门为后续里程碑，当前仅校验与展示） |
| `company.departments` | `[]`                    | 种子部门：`[{id,name,manager,skills,capacity}]` |
| `company.routingRules` | `[]`                  | 下单路由规则：`[{match, dept}]`（按标题/类型匹配部门） |
| `company.toolPolicies` | `{}`                   | 每条线的工具策略覆盖：`{window:{allow,deny}, manager:{...}, staff:{...}}` |
| `company.levels` | 内置 M1–M5 / P1–P6 目录 | 双通道等级目录覆盖：`{M:{label,levels:[{code,name}]},P:{...}}`（非法整体回退默认 + warning） |
| `company.numbering` | `{employee:{pattern:"E{seq:4}",start:1}, department:{pattern:"D{seq:2}",start:1}}` | 工号/部门编号模板；占位符 `{seq}`/`{seq:N}`/`{dept}`/`{channel}`/`{level}`；也可用 `company_admin.setNumbering` 运行时修改 |

> 自动更新默认**不**在启动时自动检查（`checkOnBoot:false`），且**永远不会**在进程运行中替换自身：面板的「应用」会拒绝并给出命令，需退出 DSH 后在终端运行 `node scripts/apply-pending.mjs --data-dir ... --install-dir ... --yes`。只有显式设置 `allowOnlineApply:true` 才允许在线应用（不推荐）。

---

## 工具一览（16 个名册工具 + 13 个公司化工具）

| 工具                  | 作用                                   |
| ------------------- | ------------------------------------ |
| `member_list`       | 输出组织架构视图（小组 → 成员），含显示名/岗位/技能/状态      |
| `member_add`        | 登记一名成员（可带显示名、分组、岗位、技能）               |
| `member_rename`     | 设置中文显示名 / 别名（`target` 不变）            |
| `member_remove`     | 停用（软删除）或 `restore:true` 恢复           |
| `member_set_role`   | 设置岗位名称与职责条目                          |
| `member_set_skills` | 整体覆盖或增量增删技能                          |
| `member_set_model`  | 设置/清除该成员的 `provider/model` 覆盖（空串＝清除） |
| `group_manage`      | 小组 create / rename / delete / assign |
| `member_sync`       | 把核心当前成员批量登记进名册                       |
| `member_diagnose`   | 诊断运行状态（目录可写、服务可用、路由注册、缓存与告警）         |
| `skill_list`        | 列出本机已安装技能（名称 + 描述 + 来源 + 是否可被模型调用）   |
| `model_list`        | 列出可用 provider 与模型目录                  |
| `member_backup`     | 名册备份：status / list / backup / restore / prune / export |
| `member_group_from_text` | 一句话建组：自然语言 → 预览 → 确认创建（默认只预览） |
| `member_workflow`   | 读取可视化工作流的聚合摘要（成员状态 / token / 用时 / 任务） |
| `member_update`     | 分阶段更新：status / check / stage / apply / rollback |

### 公司化工具（13 个，按工具线隔离）

| 工具 | 线 | 作用 |
| --- | --- | --- |
| `company_order` | 窗口 | 下单：`{type,title,dept?,priority?,deps?,acceptance?,clientOrderId?,mode?}` → `{orderId,state}` |
| `company_status` | 窗口 | 查询工单/员工/部门视图：`{orderId?,project?,dept?}` |
| `company_ask` | 窗口 | 催办：`{orderId,question}` |
| `company_cancel` | 窗口 | 取消工单：`{orderId}` |
| `company_assign` | 经理 | 派工：`{orderId,employeeId}` → `{attemptId,sessionId}` |
| `company_review` | 经理 | 验收：`{orderId,pass:true|false}`（`true` 验收通过，`false` 打回重做） |
| `company_borrow` | 经理 | 借调共享员工：`{orderId,sharedEmployeeId}` → `{attemptId}` |
| `company_report` | 经理/员工 | 回报（必带 `attemptId`，陈旧 attempt 拒绝）：`{orderId?,attemptId,status,summary,artifacts?,acceptanceResults?}` |
| `company_escalate` | 经理 | 升级：`{orderId,reason?}`，记录 `escalatedAt/reason` 并转发 owner |
| `company_accept` | 员工 | 接受派工：`{attemptId}` |
| `company_ask_help` | 员工 | 求助：`{attemptId,question?}`，落账并转发经理 |
| `company_hire` | OWNER | 新增员工：`{id,displayName?,department?,role?,kind?,code?,channel?,level?}`（可指定工号/通道/等级，缺省按 role 推导并自动编号） |
| `company_admin` | OWNER | 控制面：`{action:"createDepartment"|"createEmployee"|"updateDepartment"|"promoteEmployee"|"setRoutingRules"|"setNumbering",args}`（`promoteEmployee` 同通道逐级晋升/跨通道显式转，`setNumbering` 改编号模板） |

> 越权调用（例如员工线调 `company_assign`）返回 `{ ok:false, code:"E_TOOL_LINE" }`；公司运行时未就绪（宿主缺 `agents`/`subagents`）返回 `{ ok:false, code:"E_NO_AGENTS" }`。

---

## Web 面板入口

| 插槽                  | 入口              |
| ------------------- | --------------- |
| `settings.section`  | 设置页 →「成员管理」分区   |
| `sidebar.panellist` | 侧栏「👥 成员管理」图标   |
| `main`              | 独立主页面（keyed 面板） |
| 面板页签            | 「总架构」（默认首屏）＝组织架构图：员工中心（下拉：全体员工 / 单部门 / 未启用成员）+ 部门领导节点 + 部门图框；点图框开部门弹层（页签：部门架构图 / 成员详情列表，可招聘 / 晋升 / 停用 / 调岗）；工具栏「新建部门」含一句话解析；下方 KPI + 编号规则 + 等级图例 + 成本归因三列 top5；5 秒轮询，读 `GET /company/overview`、写 `POST /company/op` |

后端 HTTP 路由：`/api/dsh-member-manager/{state, op, skills, models, overrides, health, backups, update, workflow}`；
公司化只读路由：`/api/dsh-member-manager/company/{overview, org, board, costs, orders}`（返回 `{ ok: true, data }` 信封）。

---

## 开发与测试

```bash
# 语法校验
npm run check

# 运行全部单元/集成测试
npm test
```

环境要求：Node >= 22.19（DSH runtime 内置 Node 已满足）。

---

## 许可证

MIT

---

</details>

---

<details>

<summary><b>🌐 English</b></summary>

## Overview
# It has been published to the official npm registry.

**Member Manager** is a DeepSeek Harness (DSH) plugin that lets you manage your team as a two‑level **group → member** org structure, and attach extra metadata to each member — **Chinese display name, job title & duties, skill tags, active/retired status** — and optionally set a **per‑member model override**.

> ⚠️ Background: DSH member names (`target`) are forced to lower‑kebab‑case by the core and are **immutable** (cannot be renamed or deleted). This plugin therefore **never mutates core team state**; it keeps these extra fields in its own **overlay registry** — safe to read and write, without touching the official core.

- **Registry file**: `~/.dsh/storages/member-manager/registry.json` (configurable).
- Ships with **host tools** (Agent‑callable) and a **Web management panel** (human‑operable).

## v0.3.0 highlights

- 🏷️ **Rebrand without data loss**: package name / plugin id / client namespace / API prefix are now `dsh-member-manager` (was `dsh-plugin-member-manager`); version stays **0.3.0**. Roster data dir and `registry.json` format are unchanged, so an old install can switch over and roll back.
- 🏢 **Company runtime (the core of this release)**: on top of the roster overlay, members can be orchestrated like a company — **departments, orders, attempt credentials, reports & acceptance, audit trail, token cost attribution** — built entirely on `ctx.agents` / `ctx.subagents` session APIs, **no native team layer required**.
- 🧵 **Four auto-isolated tool lines**: window line (`company_order` / `company_status` / `company_ask` / `company_cancel`) can only place, inspect and chase orders; manager line (11 tools incl. `company_assign` / `company_review` / `company_borrow` / `company_report` / `company_escalate`) dispatches and accepts; staff line (`company_accept` / `company_report` / `company_ask_help`) only does its own work; the owner line (`company_hire` / `company_admin`) is owner-only. Cross-line calls return `E_TOOL_LINE`, enforced by a `tools.restrict` allow-list, a synchronous `tools.guard` and an execution-time `exec.agent.session.id` lookup.
- 🪪 **Attempt credentials prevent double-reporting**: `company_report` must carry `attemptId`; stale attempts are rejected. `company_order` accepts `clientOrderId` for idempotent retries, and downstream orders unlock only after their `deps` are done.
- 💰 **Cost & audit**: employee/manager session tokens and request counts are aggregated per employee / department / order (`GET /company/costs`); org and ledger live in `company.json` while an append-only `audit.jsonl` is replayed on load. `company_admin` currently supports `createDepartment` / `createEmployee` / `setRoutingRules`.
- 🧯 **Degrades everywhere**: with no `agents` / `subagents` service the company tools answer `E_NO_AGENTS` while the roster overlay (existing 16 roster tools, panel, routes) keeps working; agent boot failures only log a warning and never break plugin load.
- 🧩 **New read-only web routes**: `GET /company/{overview,org,board,costs,orders}` in a uniform `{ ok: true, data }` envelope; `GET /state` carries a `company` summary.
- 🎖️ **M/P dual-channel levels & numbering**: two career channels — Management (M1 Supervisor → M5 VP) and Professional (P1 Junior Engineer → P6 Principal Expert). Every employee gets a unique employee code (default `E0001`, `E0002`…) plus a level and department; every department gets a unique code (default `D01`, `D02`…). Both patterns are customizable. `company_hire` accepts `code/channel/level`; `company_admin` gains `updateDepartment` / `promoteEmployee` / `setNumbering`; legacy data is back-filled on boot without dropping employees.
- 🖥️ **"Overall architecture" org chart panel**: the first tab is an org chart — the top row links an "Employee center" card (dropdown filter: all employees / one department / disabled members, sorted by department and level) horizontally to department leader nodes, each hanging down to a department box; click a box to open the department modal with two tabs (department chart / member details) supporting hire, promote, disable and transfer; the "New department" toolbar button includes one-line parsing (the old one-line group builder is merged in); KPIs, numbering rules, the level legend and top-5 cost attribution stay below the chart; polled every 5s with manual refresh, reads `GET /api/dsh-member-manager/company/overview` and writes `POST /api/dsh-member-manager/company/op`.
- 🎯 **Task-scoped org chart (folded into this release)**: the chart shows only the current task's participants (lead + members whose `parentSession` points at it) instead of the whole roster.
- 🔽 **Task switcher (folded into this release)**: a selector driven by `tasks[]` from `GET /orgmap` (running marker + member count); empty state disables the picker.
- 🧭 Layout unchanged: the three-level parallel-across / serial-down view (lead → group chips → members) keeps its workspace cards, structural lines and animated guide lines; token/elapsed numbers count only that task's sessions.
- 🔌 `GET /orgmap` is now contract `version: 2` with `tasks` / `task` / `lead` / `groups` / `members` / `dispatch` / `dependency` / `totals`, and accepts `?task=<rootSessionId>`; an unknown/absent id falls back to the most recently active task.
- 🧪 Tests: all existing tests stay green, plus new company unit tests (org / ledger / router / store / config), fake-host closed-loop runtime tests and package-metadata tests (final count follows `npm test` in this repo).

## M/P dual-channel levels & numbering

**Channels**: `manager` belongs to the Management channel M, `staff` / `window` to the Professional channel P. Default level catalog:

| Channel | Levels |
| --- | --- |
| Management M | M1 Supervisor → M2 Manager → M3 Senior Manager → M4 Director → M5 VP |
| Professional P | P1 Junior Engineer → P2 Engineer → P3 Senior Engineer → P4 Staff Engineer → P5 Technical Expert → P6 Principal Expert |

`company_hire` defaults the level from the role (manager→M2, staff→P3, window→P1). `company_admin({action:"promoteEmployee"})` allows ±1 step within the same channel; crossing channels requires an explicit target level and flips `role` (window cannot become M; M requires a department). Legacy records missing a level/code are back-filled on boot — an invalid level falls back to the role default and the employee is kept.

**Numbering**: employee codes default to `E{seq:4}` (from E0001), department codes to `D{seq:2}` (from D01). Template placeholders: `{seq}` / `{seq:N}` / `{dept}` / `{channel}` / `{level}`; codes are company-unique and numbering skips taken values. Example:

```json
{
  "company": {
    "numbering": {
      "employee": { "pattern": "E{dept}-{seq:4}", "start": 1 },
      "department": { "pattern": "D{seq:2}", "start": 1 }
    },
    "levels": {
      "M": { "label": "Management", "levels": [{ "code": "M1", "name": "Supervisor" }, { "code": "M2", "name": "Manager" }] },
      "P": { "label": "Professional", "levels": [{ "code": "P1", "name": "Junior Engineer" }, { "code": "P2", "name": "Engineer" }] }
    }
  }
}
```

Precedence: persisted `numbering` in `company.json` (e.g. via `company_admin.setNumbering`) > config `company.numbering` > built-in defaults; levels work the same way. Employee prompts start with an identity line (code / level / channel / department code) so a dispatched employee sees exactly who they are.

**Panel**: Settings → "Member Manager" → the default "Overall architecture" tab is the org chart: employee center (dropdown: all / one department / disabled), department leader nodes and department boxes; click a box to open the department modal — the first tab shows the department chart, the second lists members with inline hire / promote / disable / transfer; the "New department" button parses a one-line description into a name and headcount (the old one-line group builder is merged in). Panel writes go through `POST /company/op`; `company_hire` / `company_admin` remain available.

## v0.2.4 highlights

- 🪟 **No more chart chrome**: the panel no longer renders its own window frame, title bar, collapse, ⇤/⇥ or refresh buttons — the chart fills the right-sidebar tab, follows the rail width and scrolls horizontally inside.
- 🧱 **Parallel across, serial down**: siblings of one level line up horizontally while parent→child relations run vertically through orthogonal buses. Three levels — lead → group chips (side by side) → members (side by side).
- 🎯 The viewport is centered on the lead on first paint; task dispatch / dependency edges route through the gap beside the target card so they no longer cross group chips or cards.
- 🧪 Tests stay at **228**, all green.

## v0.2.3 highlights

- 🧭 **The org chart now lives in the right sidebar as a persistent tab** instead of a fixed overlay on `document.body`. It follows the sidebar's open/split/fullscreen states; after closing, reopen it from the "Org chart" button in the conversation header.
- 🌳 The hierarchical tree, member cards and animated guide lines are unchanged; in the narrow panel the dynamic links now use bracket-style polylines in the left gutter so they no longer collapse into an edge line.
- 🧹 Floating-layer leftovers (drag, snap-to-side, placement memory) are gone; only collapse remains.
- 🧪 Tests 225 → **228** (client-bundle: tab registration / graceful degradation / embedded mount).

## v0.2.2 highlights

- The org chart now docks to the **right sidebar** by default and renders a **hierarchical tree** (lead → colored group nodes → members) with orthogonal connectors; member cards and animated guide lines are kept.
- Dragging no longer floats freely: on release it snaps to the nearest side; use ⇤/⇥ to switch manually.

## v0.2.1 highlights

- 🛡️ **Automatic roster backups**: a debounced snapshot ~1.5s after every registry write, plus one at boot; rotated by "latest N copies + one per day for the latest M days". Restore any snapshot in one click (the current state is backed up first).
- ⬆️ **Staged self-update**: `check → stage → apply → rollback`. The tarball is unpacked into `{dataDir}/updates/<version>/` and recorded as *pending*; the panel **never** applies in-process — quit DSH and run `node scripts/apply-pending.mjs ... --yes`. Five safety gates (junction/link install, package-name mismatch, invalid staged payload, ...) refuse with actionable messages, and a failed apply rolls back automatically.
- 💬 **One-sentence group creation**: describe the group and its members in natural language (built-in example); you get a **preview** first, and nothing is written until you confirm.
- 🗺 **Org-chart overlay**: the roster hierarchy becomes a always-on floating layer rendered straight onto the page (no slot, no route). Each member gets a workspace card (name, model, current task, token usage, elapsed time); active work draws animated flow lines for Lead dispatch and task dependencies; drag it anywhere, snap to either side within 48px, collapse, and the placement persists in `localStorage`.
- 📊 **Visual workflow panel**: a new "Workflow" tab shows each member's status, current work package, token usage (input/output/cache hit), elapsed time, request count, and the task board; everything is collected off the hot path and never blocks a session.
- 🔧 Tools 12 → **16**, HTTP routes 6 → **10** (`GET /orgmap`), tests 134 → **225**.

---

## v0.2.0 highlights

- Backups, staged updates, one-sentence group creation and the workflow panel landed; hard rule: never replace the plugin while DSH is running (`applyMode=offline-script`).

## v0.1.2 highlights

- 🖥️ **Edit modal reworked** to fit one screen (skills / model side by side, shorter duties box); "Pick skills / Pick model" are highlighted buttons right next to their section titles.
- 🧠 **Model picking is now a modal**: searchable, grouped by provider, shows context window, single-select radio + "Use default (clear override)" — same interaction as the skills picker.
- 🛡️ **More robust host**: all HTTP routes are guarded (disk failures now return 500 + `INTERNAL_ERROR` instead of a misleading 400); `/health` validates the method.
- ⌨️ **Interaction fixes**: Esc closes the sub-picker first; overlay click is ignored while saving; Save is disabled until a display name is entered; a partially failed save re-reads the real state.
- 🧹 Dead i18n/style keys removed; tests grew from 130 to **134**, plus a new static cross-audit script.

---

## Screenshots

<img width="2196" height="1640" alt="DSH Member Manager01" src="https://github.com/user-attachments/assets/12b22bc4-97dc-41a7-a04c-3e6d1af3c5e6" />

<img width="2196" height="1640" alt="DSH Member Manager07" src="https://github.com/user-attachments/assets/d9858133-c497-4640-9919-0aa9696ff2c7" />

<img width="2196" height="1640" alt="DSH Member Manager02" src="https://github.com/user-attachments/assets/7ac1a139-412d-4922-b599-a2e59c583bf9" />

---
## Features


- 🧑‍🤝‍🧑 **Org structure**: two‑level "group → member"; create / rename / reorder groups, drag members into groups.

- 🏷️ **Chinese display name & aliases**: stored separately; `target` stays untouched.

- 🛠️ **Roles & duties**: job title (`title`) + a list of duties.

- 🔄 **Retire / restore**: soft deletes keep history; restore anytime.

<img width="2196" height="1640" alt="DSH Member Manager03" src="https://github.com/user-attachments/assets/c6a603a8-b4fa-4495-a785-0fb65a66ae90" />

- ⭐ **Skills**: pick from the local skill catalog (searchable multi‑select), or type custom tags.

<img width="2196" height="1640" alt="DSH Member Manager05" src="https://github.com/user-attachments/assets/d544aa19-6aae-4186-9560-fd9e56193696" />

<img width="2196" height="1640" alt="DSH Member Manager06" src="https://github.com/user-attachments/assets/78bd87d1-8922-4dd2-8fde-d6457ac73dc6" />

- 🧠 **Per‑member model override**: set a `provider/model` for each member that takes effect on the next request; clearing reverts to default. Implemented through the official `agent/request` waterfall seam — it **really works**.

<img width="2196" height="1640" alt="DSH Member Manager04" src="https://github.com/user-attachments/assets/b40fe472-cf54-4a8e-b27c-f17cae4c41b6" />


- 📊 **Web panel**: org‑chart view, inline editing, one‑click registration of unregistered members, diagnostics.

- 🛰️ **Rich tools**: 12 host tools; agents can read and write the roster completely.

---

## Installation

### Option A: install from the plugin registry (after publishing)

```bash
dsh-member-manager
```
Copy the plugin name dsh-member-manager, then in DSH perform the following steps:

<img width="2558" height="1640" alt="member-manager​安装图示" src="https://github.com/user-attachments/assets/b0b211a3-898f-4dc2-9a17-d13a4671581a" />


### Option B: load from local source (dev / self‑hosted)

```bash
# run from the folder that contains the plugin source directory
dsh plugin --profile desktop add link:"<absolute path to this repo>"
```

> **Restart DSH afterwards** (this plugin does not hot‑reload):  
> restart the desktop app, or exit and re‑enter. After the GUI refreshes you'll find "Member Manager" in Settings / the sidebar.

### Uninstall

Remove the plugin entry from the profile's `cordis.patch.yml` / bundle list, then restart DSH. The registry file is kept at `~/.dsh/storages/member-manager/` and can be deleted manually.

---

## Usage

- **Via tools in chat**: tell the Agent "list the org structure", "add 张三 to the 数据组", or call `member_list` / `member_add` / `member_set_role` / `member_set_skills` / `group_manage` directly.
- **Via the panel**: open the Web panel and edit the org chart visually.
- **Sync core members**: click "Register core members" in the panel, or call `member_sync`, to bulk‑register the current team.

---

## Configuration

All options are optional (omitted ⇒ default):

| Field             | Default                          | Description                                                               |
| ----------------- | -------------------------------- | ------------------------------------------------------------------------- |
| `dataDir`         | `~/.dsh/storages/member-manager` | Roster directory                                                          |
| `registryFile`    | `{dataDir}/registry.json`        | Roster file path                                                          |
| `scanLocalSkills` | `true`                           | Also scan disk to complete the local skill catalog (`~/.dsh/skills` etc.) |
| `extraSkillRoots` | `[]`                             | Extra skill scan roots (array of absolute paths)                          |
| `backups`         | `{enabled:true, keep:20, dailyKeep:7}` | Automatic roster backups: `keep` copies, `dailyKeep` days            |
| `update`          | `{enabled:true, checkOnBoot:false, autoStage:false, allowOnlineApply:false, registryUrl, installDir}` | Staged update: check / stage / offline apply |
| `workflow`        | `{enabled:true, persistMs:5000, retentionHours:6, tasksPollMs:3000}` | Visual workflow collection: persist interval, retention, task poll |
| `enabled` / `company.enabled` | `true`            | Master switch for the company runtime; `false` makes `company_*` answer `E_DISABLED` while the roster keeps working |
| `company.autoBoot` | `true`                          | Boot the company runtime right after plugin apply (non-blocking; failures only warn) |
| `company.defaultSessionPolicy` | `"per_task"`         | Staff session policy: `per_task` or `resident` |
| `company.managerActsAsStaff` | `false`             | Whether managers can be assigned work |
| `company.defaultOrderMode` | `"async"`            | Default order mode: `async` (return at once) or `wait` (until accepted) |
| `company.provider` | `"spawn"`           | Subagent provider name used to dispatch work; must match a provider registered in the host (`spawn` ships built-in, use `fork` for fork isolation). A wrong name fails assignment with `NO_PROVIDER` |
| `company.requireManagerReview` | `true`         | Orders with acceptance criteria need manager review before `done` |
| `company.limits` | `{maxConcurrentPerProvider:4, maxTemps:4, budgetTokensPerDay:5000000, attemptTimeoutMs:1800000, lostReportGraceMs:120000, staleAttemptMs:3600000}` | Capacity / budget / timeout gates (invalid values fall back with a warning) |
| `company.departments` | `[]`                    | Seed departments: `[{id,name,manager,skills,capacity}]` |
| `company.routingRules` | `[]`                  | Order routing rules: `[{match, dept}]` |
| `company.toolPolicies` | `{}`                   | Per-line tool policy overrides: `{window:{allow,deny}, manager:{...}, staff:{...}}` |
| `company.levels` | built-in M1–M5 / P1–P6 catalog | Dual-channel level catalog override: `{M:{label,levels:[{code,name}]},P:{...}}` (invalid input falls back to defaults with a warning) |
| `company.numbering` | `{employee:{pattern:"E{seq:4}",start:1}, department:{pattern:"D{seq:2}",start:1}}` | Employee/department code templates; placeholders `{seq}`/`{seq:N}`/`{dept}`/`{channel}`/`{level}`; also mutable at runtime via `company_admin.setNumbering` |

> Auto-update does **not** check on boot by default (`checkOnBoot:false`) and **never** replaces the running plugin in-process: the panel's Apply refuses with a command; quit DSH and run `node scripts/apply-pending.mjs --data-dir ... --install-dir ... --yes`. Only `allowOnlineApply:true` (not recommended) enables in-process apply.

---

## Tools (16 roster + 13 company)

| Tool                | Purpose                                                                               |
| ------------------- | ------------------------------------------------------------------------------------- |
| `member_list`       | Output the org‑chart view (group → member) with display name / role / skills / status |
| `member_add`        | Register a member (with display name, group, role, skills)                            |
| `member_rename`     | Set Chinese display name / aliases (`target` unchanged)                               |
| `member_remove`     | Retire (soft delete) or `restore:true` to restore                                     |
| `member_set_role`   | Set job title and duties                                                              |
| `member_set_skills` | Replace skills entirely, or add/remove incrementally                                  |
| `member_set_model`  | Set / clear a member's `provider/model` override (empty string = clear)               |
| `group_manage`      | Groups: create / rename / delete / assign                                             |
| `member_sync`       | Bulk‑register the current core members into the roster                                |
| `member_diagnose`   | Diagnose runtime health (dir writable, services, routes, cache, warnings)             |
| `skill_list`        | List installed skills (name + description + source + model‑invocable)                 |
| `model_list`        | List available providers and their model catalogs                                     |
| `member_backup`     | Roster backups: status / list / backup / restore / prune / export                     |
| `member_group_from_text` | One-sentence group: NL → preview → confirm (preview is the default)               |
| `member_workflow`   | Aggregated workflow summary (member status / tokens / elapsed / tasks)                |
| `member_update`     | Staged update: status / check / stage / apply / rollback                              |

### Company tools (13, isolated per tool line)

| Tool | Line | Purpose |
| --- | --- | --- |
| `company_order` | window | Place an order: `{type,title,dept?,priority?,deps?,acceptance?,clientOrderId?,mode?}` → `{orderId,state}` |
| `company_status` | window | Inspect orders / employees / departments: `{orderId?,project?,dept?}` |
| `company_ask` | window | Chase an order: `{orderId,question}` |
| `company_cancel` | window | Cancel an order: `{orderId}` |
| `company_assign` | manager | Dispatch: `{orderId,employeeId}` → `{attemptId,sessionId}` |
| `company_review` | manager | Accept/return: `{orderId,pass:true|false}` (`true` accepts, `false` sends it back) |
| `company_borrow` | manager | Borrow a shared employee: `{orderId,sharedEmployeeId}` → `{attemptId}` |
| `company_report` | manager/staff | Report (must carry `attemptId`; stale attempts rejected): `{orderId?,attemptId,status,summary,artifacts?,acceptanceResults?}` |
| `company_escalate` | manager | Escalate: `{orderId,reason?}` records `escalatedAt/reason` and forwards to the owner |
| `company_accept` | staff | Accept a dispatch: `{attemptId}` |
| `company_ask_help` | staff | Ask for help: `{attemptId,question?}` records and forwards to the manager |
| `company_hire` | OWNER | Add an employee: `{id,displayName?,department?,role?,kind?,code?,channel?,level?}` (code/channel/level optional; derived from role and auto-numbered when omitted) |
| `company_admin` | OWNER | Control plane: `{action:"createDepartment"|"createEmployee"|"updateDepartment"|"promoteEmployee"|"setRoutingRules"|"setNumbering",args}` (`promoteEmployee` steps one level in-channel or crosses explicitly; `setNumbering` changes code templates) |

> Cross-line calls (e.g. a staff session calling `company_assign`) return `{ ok:false, code:"E_TOOL_LINE" }`; when the host lacks `agents`/`subagents` the company tools return `{ ok:false, code:"E_NO_AGENTS" }`.

---

## Web panel entry points

| Slot                | Entry                               |
| ------------------- | ----------------------------------- |
| `settings.section`  | Settings → "Member Manager" section |
| `sidebar.panellist` | "👥 Member Manager" sidebar icon    |
| `main`              | Standalone main page (keyed panel)  |
| Panel tab           | "Overall architecture" (default landing tab) = org chart: employee center (filter: all / department / disabled) + leader nodes + department boxes; click a box for the department modal (tabs: department chart / member details, with hire, promote, disable, transfer); "New department" includes one-line parsing; KPIs + numbering rules + level legend + cost top-5 below; polls every 5s, reads `GET /company/overview`, writes `POST /company/op` |

Backend HTTP routes: `/api/dsh-member-manager/{state, op, skills, models, overrides, health, backups, update, workflow}`;
company read-only routes: `/api/dsh-member-manager/company/{overview, org, board, costs, orders}` (wrapped in `{ ok: true, data }`).

---

## Development & Tests

```bash
# Syntax check
npm run check

# Run all unit / integration tests
npm test
```

Requires Node >= 22.19 (DSH runtime's bundled Node satisfies this).

---

## License

MIT

---

</details>

---

<div align="center"><sub>DSH Member Manager · © 2026 · Made for DeepSeek Harness</sub></div>
