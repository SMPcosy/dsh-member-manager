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
- 新增测试：共享内核纯函数（org / ledger / router / store / config）、host 运行时 fake 闭环（dispatcher / employees / runtime）、打包/元数据与切换回滚脚本用例（临时 profile），全量 315 用例。
- 交付自检：`node scripts/verify-company.mjs`（16 项：元数据/文件/语法/导出契约/全量测试），切换/回滚脚本默认 dry-run。

### 保留

- 名册覆盖层、16 个既有 `member_*` / `group_*` 工具、组织架构图、可视化工作流、备份、更新、一键建组等 0.2.x 能力全部保留，既有测试不回归（全量计数以 `npm test` 为准）。

### 兼容性

- 需要 DSH 0.2.1-rc.2 及以上（`agents.create/resume`、`subagents.startActivation`、`tools.restrict/guard`、`agent/status`、`tool/result`、`assistant/message.usage`）。
- 旧版事件名 `agent/session-start` 在当前宿主不存在，不再需要兼容分支；运行时对事件缺失一律降级。
