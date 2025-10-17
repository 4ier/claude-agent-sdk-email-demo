# Hosting 与部署最佳实践

本项目采用 Claude Agent SDK 的长运行进程模型，建议在容器中部署以实现安全隔离与资源控制。

关键建议：
- 容器化隔离：为每个会话或工作负载提供独立容器，限制CPU/RAM/磁盘与网络。
- 运行环境：Node.js 18+，并安装 Claude Code CLI（`npm install -g @anthropic-ai/claude-code`）。
- 网络权限：允许到 `api.anthropic.com` 的HTTPS出站请求；其他网络访问按需限制。
  - 如需代理或私有网关，设置 `ANTHROPIC_BASE_URL`，系统会映射到 `ANTHROPIC_API_URL`/`ANTHROPIC_BASE_URL`。
- 会话策略：根据业务选择以下模式：
  - Ephemeral：一次性任务执行完销毁容器，适用于修复Bug、批处理、提取数据等。
  - Long-Running：持续运行，适用于需要主动行动或高频消息的代理。
  - Hybrid：按需启动，使用会话历史或SDK的`resume`功能恢复上下文。
- 监控与日志：容器日志可接入现有后端日志系统（本项目使用`pino`）。

Docker 使用：
- `docker compose build` 构建镜像
- `docker compose up -d` 后台运行
- 环境变量：
  - `ANTHROPIC_API_KEY`（必需）
  - `CLAUDE_MODEL`（`sonnet|opus|haiku`）
  - `ANTHROPIC_BASE_URL`（可选）
  - `AGENT_SESSION_ID`（可选）
  - `SMTP_HOST`、`SMTP_PORT`、`SMTP_SECURE`、`SMTP_USER`、`SMTP_PASS`

参考文档：
- Agent SDK（TypeScript）参考：`query()`、`tool()`、`createSdkMcpServer()`
- Hosting 指南与容器化模式：官方文档详细阐述上述模式与资源要求