<div align="center">

# 📇 DSH Member Manager / 成员管理
# 已发布到官方NPM
**A DeepSeek Harness plugin for team org structure, Chinese display names, roles, skills and per‑member model overrides.**

**一个管理团队组织架构、中文显示名、岗位职责、技能，以及按成员模型覆盖的 DSH 插件。**

`dsh-plugin-member-manager` · **v0.1.1** · License: MIT

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

---

## 截图


<img width="2186" height="1640" alt="DSH Member Manager01" src="https://github.com/user-attachments/assets/12b22bc4-97dc-41a7-a04c-3e6d1af3c5e6" />

<img width="2186" height="1640" alt="DSH Member Manager07" src="https://github.com/user-attachments/assets/d9858133-c497-4640-9919-0aa9696ff2c7" />

<img width="2186" height="1640" alt="DSH Member Manager02" src="https://github.com/user-attachments/assets/7ac1a139-412d-4922-b599-a2e59c583bf9" />

---
## 功能特性

- 🧑‍🤝‍🧑 **组织架构**：两级结构「小组 → 成员」，可新建 / 重命名 / 排序小组，成员一键归组。

- 🏷️ **中文显示名与别名**：显示名独立存储，`target` 保持不变。

- 🛠️ **岗位职责**：岗位名称（title）+ 职责条目列表（duties）。

- 🔄 **停用 / 恢复**：软删除，保留历史记录，随时恢复。

<img width="2186" height="1640" alt="DSH Member Manager03" src="https://github.com/user-attachments/assets/c6a603a8-b4fa-4495-a785-0fb65a66ae90" />

- ⭐ **技能赋予**：从本机技能目录选择（可搜索多选），也支持自定义标签。

<img width="2186" height="1640" alt="DSH Member Manager05" src="https://github.com/user-attachments/assets/d544aa19-6aae-4186-9560-fd9e56193696" />

<img width="2186" height="1640" alt="DSH Member Manager06" src="https://github.com/user-attachments/assets/78bd87d1-8922-4dd2-8fde-d6457ac73dc6" />


- 🧠 **按成员模型覆盖**：每个成员可单独指定 `provider/model`，下一次请求即生效；清空即恢复默认。这是通过官方 `agent/request` 水位接缝实现，**真生效**。

<img width="2186" height="1640" alt="DSH Member Manager04" src="https://github.com/user-attachments/assets/b40fe472-cf54-4a8e-b27c-f17cae4c41b6" />


- 📊 **Web 面板**：组织架构、行内编辑、未登记成员一键登记、诊断信息。

- 🛰️ **丰富工具**：12 个宿主端工具，Agent 可完整读写名册。

---

## 安装

### 方式 A：从插件市场安装

```bash
dsh-plugin-member-manager
```
复制上述插件名dsh-plugin-member-manager，在DSH进行如下操作

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

---

## 工具一览（12 个）

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

---

## Web 面板入口

| 插槽                  | 入口              |
| ------------------- | --------------- |
| `settings.section`  | 设置页 →「成员管理」分区   |
| `sidebar.panellist` | 侧栏「👥 成员管理」图标   |
| `main`              | 独立主页面（keyed 面板） |

后端 HTTP 路由：`/api/dsh-plugin-member-manager/{state, op, skills, models, overrides, health}`。

---

## 开发与测试

```bash
# 语法校验
npm run check

# 运行全部 130 个单元/集成测试
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

---

## Screenshots

<img width="2186" height="1640" alt="DSH Member Manager01" src="https://github.com/user-attachments/assets/12b22bc4-97dc-41a7-a04c-3e6d1af3c5e6" />

<img width="2186" height="1640" alt="DSH Member Manager07" src="https://github.com/user-attachments/assets/d9858133-c497-4640-9919-0aa9696ff2c7" />

<img width="2186" height="1640" alt="DSH Member Manager02" src="https://github.com/user-attachments/assets/7ac1a139-412d-4922-b599-a2e59c583bf9" />

---
## Features


- 🧑‍🤝‍🧑 **Org structure**: two‑level "group → member"; create / rename / reorder groups, drag members into groups.

- 🏷️ **Chinese display name & aliases**: stored separately; `target` stays untouched.

- 🛠️ **Roles & duties**: job title (`title`) + a list of duties.

- 🔄 **Retire / restore**: soft deletes keep history; restore anytime.

<img width="2186" height="1640" alt="DSH Member Manager03" src="https://github.com/user-attachments/assets/c6a603a8-b4fa-4495-a785-0fb65a66ae90" />

- ⭐ **Skills**: pick from the local skill catalog (searchable multi‑select), or type custom tags.

<img width="2186" height="1640" alt="DSH Member Manager05" src="https://github.com/user-attachments/assets/d544aa19-6aae-4186-9560-fd9e56193696" />

<img width="2186" height="1640" alt="DSH Member Manager06" src="https://github.com/user-attachments/assets/78bd87d1-8922-4dd2-8fde-d6457ac73dc6" />

- 🧠 **Per‑member model override**: set a `provider/model` for each member that takes effect on the next request; clearing reverts to default. Implemented through the official `agent/request` waterfall seam — it **really works**.

<img width="2186" height="1640" alt="DSH Member Manager04" src="https://github.com/user-attachments/assets/b40fe472-cf54-4a8e-b27c-f17cae4c41b6" />


- 📊 **Web panel**: org‑chart view, inline editing, one‑click registration of unregistered members, diagnostics.

- 🛰️ **Rich tools**: 12 host tools; agents can read and write the roster completely.

---

## Installation

### Option A: install from the plugin registry (after publishing)

```bash
dsh-plugin-member-manager
```
Copy the plugin name dsh-plugin-member-manager, then in DSH perform the following steps:

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

---

## Tools (12)

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

---

## Web panel entry points

| Slot                | Entry                               |
| ------------------- | ----------------------------------- |
| `settings.section`  | Settings → "Member Manager" section |
| `sidebar.panellist` | "👥 Member Manager" sidebar icon    |
| `main`              | Standalone main page (keyed panel)  |

Backend HTTP routes: `/api/dsh-plugin-member-manager/{state, op, skills, models, overrides, health}`.

---

## Development & Tests

```bash
# Syntax check
npm run check

# Run all 130 unit / integration tests
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
