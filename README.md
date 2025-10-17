# LovTalent 2B Agent

持久态 Claude Agent，支持通过 SMTP 发送邮件，采用 TypeScript + TDD。

## 快速开始

1. 安装依赖：
   - `npm install`
2. 复制环境示例：
   - `cp .env.example .env` 并填写 SMTP 与模型配置
3. 运行测试：
   - `npm run test`
4. 开发运行（需要已安装 Claude Code CLI 与 Node 18+）：
   - `npm run dev`
   - REST API 启动后默认监听 `PORT=3000`

## Docker 部署

- 构建镜像：
  - `docker compose build`
- 启动容器：
  - `docker compose up -d`
- 查看日志：
  - `docker compose logs -f agent`
- 停止容器：
  - `docker compose down`

确保环境中提供以下变量（可使用`.env`文件与compose一起加载）：
- `ANTHROPIC_API_KEY`：Claude API密钥
- `CLAUDE_MODEL`：`sonnet|opus|haiku`
- `CLAUDE_API_BASE_URL`：可选，自定义模型API Base URL（如代理）
- `AGENT_SESSION_ID`：可选，用于恢复会话
- `SMTP_*`：SMTP连接配置

## 目录结构
- `src/config/env.ts` 环境变量校验
- `src/services/emailService.ts` SMTP 邮件服务
- `src/mcp/smtpTool.ts` MCP 工具定义
- `src/agent/options.ts` Agent 选项构建
- `src/server.ts` 持久态 Agent 入口
- `src/server.ts` 同时提供 REST API：
  - `GET /api/health` 健康检查
  - `POST /api/smtp/send` 发送邮件（JSON：`{to, subject, text?, html?}`）
  - `POST /api/joke` 发送笑话（JSON：`{to}`）
- `tests/*` TDD 测试
- `docs/*` 每个特性对应文档

## 环境变量
参考 `.env.example`，关键项：
- `CLAUDE_MODEL`: `sonnet | opus | haiku`
- `AGENT_SESSION_ID`: 用于恢复会话（可选）
- `CLAUDE_API_BASE_URL`: 可选，覆盖默认的 `https://api.anthropic.com`，方便走代理或私有部署
- `SMTP_*`: SMTP 邮件发送配置
- `PORT`: REST API 监听端口（默认 3000）

## 部署建议
- 使用容器沙箱化运行，限制资源并隔离网络。
- 结合业务选择 long-running / ephemeral / hybrid 会话模式。

参考：
- Agent SDK TypeScript: https://docs.claude.com/en/api/agent-sdk/typescript
- Hosting指南: https://docs.claude.com/en/api/agent-sdk/hosting

## License
ISC
## REST API 测试
- 启动构建并运行：`npm run build && npm run start`
- 发送笑话（PowerShell）：
  - `Invoke-RestMethod -Uri http://localhost:3000/api/joke -Method POST -ContentType 'application/json' -Body '{"to":"771040330@qq.com"}'`
- 通用发送（PowerShell）：
  - `Invoke-RestMethod -Uri http://localhost:3000/api/smtp/send -Method POST -ContentType 'application/json' -Body '{"to":"771040330@qq.com","subject":"Hello","text":"Hi"}'`