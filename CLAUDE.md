# OpenMAIC — Claude 工作约定

本文件用于让 Claude Code 在每次进入本仓库时，自动“记住”关键约定与操作流程，尤其是 **MCP（Model Context Protocol）服务的使用方式**。

## MCP 使用的硬规则（必须遵守）

Claude 在使用任何 MCP service 之前，必须按以下顺序执行（不得凭记忆/臆测参数）：

1. **先确认该 MCP service 真的“已启用且可见”**  
   - 依据：当前 Cursor 会在工程对应的 MCP 描述符目录下暴露 server 与 tools schema。  
   - 如果找不到该 service 的 `tools/*.json`，就视为“本项目中不可用”，不要继续假设它存在。

2. **读取该 service 的 tool schema（`tools/*.json`）与说明文档（如 `INSTRUCTIONS.md`）**  
   - 目标：拿到每个 tool 的 `name`、参数结构、必填字段、示例输入/输出。

3. **再执行调用**  
   - 调用时严格遵循 schema，参数不确定就回到第 2 步继续读 schema，而不是猜。

更详细的可复制步骤与速查模板见：`.cursor/rules/mcp.md`。

## 本仓库的默认行为

- 遇到“你怎么不会用 stitch MCP”这类问题，优先判断：**stitch 是否真的在本项目里启用并暴露了 tools schema**。  
- 若未启用：给出“如何让 stitch 出现在 tools schema 中”的排查清单（见 `.cursor/rules/mcp.md`），而不是编造用法。

