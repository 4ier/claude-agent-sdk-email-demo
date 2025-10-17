# SMTP 邮件发送工具

`smtp_send` 工具允许 Agent 通过 SMTP 协议发送邮件，基于 `nodemailer` 实现。

输入参数：
- `to`：收件人邮箱（必填）
- `subject`：主题（必填）
- `text`：纯文本正文（二选一）
- `html`：HTML 正文（二选一）

工具实现：
- `src/services/emailService.ts`：封装邮件发送逻辑与输入校验。
- `src/mcp/smtpTool.ts`：定义 `smtp_send` 的输入 schema 与 handler。

环境变量（由 `src/config/env.ts` 校验）：
- `SMTP_HOST`：SMTP 主机
- `SMTP_PORT`：SMTP 端口
- `SMTP_SECURE`：`true|false` 是否启用 TLS
- `SMTP_USER`：认证用户名（亦作为发件人）
- `SMTP_PASS`：认证密码

使用说明：
1. 配置 `.env` 中的 SMTP 相关参数。
2. 启动 Agent 后，Agent 可在需要时调用 `smtp_send` 工具发送邮件。

测试：
- `tests/emailService.test.ts`：对邮件服务进行单元测试与mock。
- `tests/mcp_tool_smtp.test.ts`：对工具的schema与handler进行测试。