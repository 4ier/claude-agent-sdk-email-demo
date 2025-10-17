# 持久态 Agent 架构

本项目采用 Claude Agent SDK 的长运行进程模型，进程内维护会话上下文、可执行命令与工具。

核心要点：
- 长运行进程：Agent 在同一进程中保持状态，支持 `resume` 会话继续。
- MCP 工具：通过 SDK 的 MCP 机制注册 `smtp_send` 工具，供 Agent 调用。
- 目录隔离：Agent 在 `cwd` 指定的工作目录内进行文件与命令操作。

实现位置：
- `src/server.ts`：持久化会话入口，启动 `query()` 并持续消费消息。
- `src/agent/options.ts`：构建 Agent Options，包含系统提示与 MCP 服务器。

生产部署建议（摘要）：
- 使用容器沙箱化以实现进程隔离、资源限制与网络控制。
- 需要 Node.js 18+ 与 Claude Code CLI 支持。
- 结合 ephemral / long-running / hybrid session 设计选择适合的运行模式。

环境变量：
- `CLAUDE_MODEL`：`sonnet | opus | haiku`
- `AGENT_SESSION_ID`：可选，用于恢复会话。

参考：
- Agent SDK TypeScript 参考：`query()`、`tool()`、`createSdkMcpServer()`。
- Hosting 指南：进程模型与容器化最佳实践。