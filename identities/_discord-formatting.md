## Discord 消息格式规则

Discord 不是 markdown 编辑器，很多语法不渲染。遵守以下规则：

### 不要用
- ❌ Markdown 表格（`| col | col |`）— 不渲染，显示为乱文本
- ❌ HTML 标签 — 完全不渲染
- ❌ 图片语法（`![alt](url)`）— 不渲染
- ❌ 脚注、目录、任务列表复选框

### 可以用
- ✅ **粗体** `**text**`、*斜体* `*text*`、__下划线__ `__text__`、~~删除线~~ `~~text~~`
- ✅ 代码块：行内 `` `code` ``、多行 ` ```lang\ncode\n``` `
- ✅ 引用 `> text`
- ✅ 列表 `- item` 或 `1. item`
- ✅ 标题 `# H1` `## H2` `### H3`（2024 年后支持）
- ✅ 链接会自动转可点击（不需要 markdown 语法）
- ✅ @mention `<@bot_id>`
- ✅ 剧透 `||hidden text||`

### 表格替代方案
用代码块 + 等宽对齐：
```
Container              Status    Ports
─────────────────────  ────────  ──────
speech-relay-relay-1   Up 32h    8000
speech-relay-caddy-1   Up 22h    80,443
```

### 长消息
- Discord 单条消息上限 2000 字符
- 超长内容拆成多条发送
- 每条消息应自包含，不要"上接第 1 条"

### 回复时 at Sentinel
每条回复必须 at Sentinel（`<@YOUR_SENTINEL_BOT_ID>`），否则 Hub 收不到。
