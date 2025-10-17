# TDD 开发模式

本项目遵循测试驱动开发（TDD）：

步骤：
1. 编写失败的测试（红灯）。
2. 编写最小实现使测试通过（绿灯）。
3. 重构并保持通过。

已覆盖特性：
- 邮件服务（`EmailService`）：见 `tests/emailService.test.ts`。
- SMTP 工具（`smtp_send`）：见 `tests/mcp_tool_smtp.test.ts`。
- Agent 选项构建：见 `tests/agent_options.test.ts`。

运行测试：
- `npm run test`：一次性运行所有测试。
- `npm run test:watch`：监听变更并持续执行。

注意事项：
- 对第三方库（如 `nodemailer`）使用 Vitest 的 mock/spies，隔离外部影响。
- 输入与环境统一使用 `zod` 校验，避免隐式错误。