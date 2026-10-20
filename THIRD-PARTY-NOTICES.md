# 第三方声明 / Third-Party Notices

本包（`dsh-member-manager@0.3.0`）自身以 MIT 许可证发布（见 `LICENSE`）。

## 1. dsh-agent-teams（设计参考 / 部分实现思路移植）

公司化运行时（`src/shared/company-*.mjs`、`src/host/company-*.mjs`、`prompts/`）在设计阶段参考了下列项目的公开源码、数据结构与运行机制（任务图、attempt 凭证、事件驱动调度、文件锁状态、工具策略等）：

- 名称：`@nanmicoder/dsh-agent-teams`（v0.1.25）
- 作者：程序员阿江（Relakkes）<relakkes@gmail.com>
- 主页：https://github.com/NanmiCoder/dsh-agent-teams
- 许可证：MIT

本包未直接复制该项目的源码文件；对其思想的移植与重写仍按 MIT 义务署名并附许可证全文。若后续把该项目的具体代码片段整体迁入本包，必须在该文件头部保留原版权声明。

原始许可证全文：

```
MIT License

Copyright (c) 2026 程序员阿江(Relakkes)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 2. DeepSeek Harness 宿主 API

公司化运行时只通过公开的宿主服务（`ctx.agents` / `ctx.subagents` / `ctx.tools` / `ctx.llm` / `ctx.systemPrompt` / `ctx.webServer`）工作，不包含宿主源码。宿主各包版权归 DeepSeek 所有，按其自身许可证使用。

## 3. 其他

- 无第三方运行时依赖（`dependencies` 为空；仅使用 Node 内置模块与宿主注入服务）。
- `demo/` 与 `docs/` 中的示例数据为虚构演示数据。
