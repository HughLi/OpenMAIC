# MCP Service 使用速查（防“记不住”专用）

目标：让 Claude Code 在任何项目里都 **可重复、可验证** 地使用 MCP service，而不是“凭记忆乱猜”。

## 结论先行：Claude 为什么会“记不住”

Claude 是否“会用某个 MCP（例如 stitch）”，本质取决于两件事：

- **该 MCP service 是否在当前会话/项目里启用并可见**（能否看到它的 tool 列表）
- **该 MCP service 的 tool schema（参数定义）是否可读取**（能否读到 `tools/*.json`）

只要 schema 不在，Claude 就只能猜 —— 这也是你看到它“又不知道怎么用”的根因。

## 标准流程（每次必走）

### 1) 找到 MCP 描述符目录（Cursor 侧）

通常 Cursor 会在“当前工程对应”的 MCP 描述符目录下提供：

- `mcps/<server>/tools/*.json`：每个工具的 schema
- `mcps/<server>/INSTRUCTIONS.md`：额外强约束（例如 lock/unlock 顺序）

若某个 service（例如 `stitch`）**没有出现在 `mcps/` 目录里**，就视为：

- **本项目当前不可用**（即便你“系统里装过/别的项目用过”）

### 2) 读取 schema，再决定怎么调用

调用任何 MCP tool 之前，先读该 tool 的 json（schema），重点字段：

- tool 名称（通常是 `name`）
- 入参结构（`arguments` / `inputSchema` / `properties`）
- 必填字段（`required`）
- 字段类型与枚举值（`type` / `enum`）
- 备注与示例（`description` / `examples`）

### 3) 形成“项目内速查卡”（持久记忆）

当你确认 stitch 已出现后，把它的 **常用 3–5 个调用**沉淀成以下模板，追加到本文件末尾：

```md
## MCP: stitch（速查）

### 可用工具
- `stitch.<toolA>`：一句话用途
  - 必填：xxx, yyy
  - 可选：zzz
  - 典型输入：{ ... }
  - 典型输出：{ ... }

### 常见任务 → 调用链
- 任务：……  
  调用顺序：tool1 → tool2 → tool3  
  关键参数：……
```

这样 Claude 每次进仓库都能读到“本项目真实可用的 stitch 用法”，而不是依赖跨会话记忆。

## stitch 现在不可用时的排查清单（按优先级）

当你说“stitch MCP 它又不知道如何使用了”，先做这 4 步（不需要猜）：

1. **确认 stitch 是否真的启用**  
   - 期望看到：`mcps/stitch/` 目录，以及 `tools/*.json`

2. **确认 stitch 是否需要认证**  
   - 有些 MCP server 会提供 `mcp_auth` 工具；未认证时工具不会可用或会报错。

3. **确认是“项目级启用”还是“全局启用”**  
   - 很多时候你在别的项目能看到 stitch，但当前项目看不到，原因是启用范围不同。

4. **把 stitch 的 tool schema 拷贝/链接到可见范围（或按 Cursor 的 MCP 配置方式重新启用）**  
   - 一旦 `tools/*.json` 出现，Claude 就能按 schema 稳定调用。

