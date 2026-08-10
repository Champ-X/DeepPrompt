# Agent 提示词档案馆

这是一个无构建步骤、正文无运行时数据请求的静态网站。`index.html` 内嵌 Phistory 当前归档的 13 款 Agent 最新 Prompt，并提供原文高亮、左右批注、主题筛选、搜索、Logo 身份系统与横向总结。

## 运行

```bash
make serve
```

打开 `http://127.0.0.1:8765/`。页面也可以直接从文件系统打开；本地服务器主要用于浏览器验收。

## 当前快照

- Phistory commit：`b326cca92451d7046b9bab0ebf6b5dba988ffc9d`
- 上游索引时间：`2026-08-09T02:36:40.178663Z`
- 覆盖：13 个 Agent、1007 个历史快照索引
- 批注：572 组高亮/解读；原有 381 组规则解释完整保留，另有 26 组“设计哲学”证据批注与 165 组逐句覆盖扩展

相较上一固定快照，本轮同步了 Claude Code `2.1.226`、Codex `0.147.0`、Antigravity `1.1.11`、Grok `1.0.0`、MiniMax Code `3.0.60`、Kimi Code `0.34.0`、opencode `1.18.15`、Pi `0.84.1` 与 Oh My Pi `17.2.12`。其中 MiniMax Code 仅版本变化，Prompt 内容哈希未变。

## 数据与证据

- `index.html`：唯一产品入口；HTML、JS、13 份 Prompt 与 572 条批注内嵌，并含 13 份设计哲学画像与 7 条横向分析轴。
- `reader-controls.css`：顶部阅读工具栏与 Agent 环形切换器的独立样式层，复用现有语义 token，并覆盖桌面圆弧与移动端底部形态。
- `data/manifest.json`：固定的 Phistory commit、版本、字节数、哈希、发布日期与快照数量。
- `data/prompts/*.md`：从固定 Phistory commit 逐字节复制的最新 `prompt.md` 证据。
- `data/prompts/codex.trace.jsonl`：Codex wire trace 证据。
- `data/annotation-audit.json`：本轮标注方法、数量、增修清单与业界一手资料。
- `data/coverage-annotations.json`：165 条逐句覆盖扩展的可重建锚点、解读与出现次数契约。
- `data/annotation-coverage.json`：对 16,910 个非空原文行的逐行分类报告，区分已批注、机械 schema、重复材料、结构分隔符和“已复读但无独立解读增量”。
- `agent-icons/`：13 个 Logo 与 `SOURCES.md` 来源说明。

Phistory 的 `prompt.md` 会规范化临时路径、日期、会话 ID 等易变值，便于阅读和 diff；原始 `trace.jsonl` 保留捕获到的 wire request。因此本项目对页面正文主张“与固定 Phistory `prompt.md` 快照规范化文本一致”，对 Codex 原始请求则以 trace 为证。

仓库中的 Codex trace 不包含可用凭据：认证头与账号字段分别固定脱敏为 `Bearer phist...` 和 `phistory-account`。发布前仍应运行密钥扫描，避免后续同步引入新的敏感字段。

## 同步与重建

先准备 Phistory checkout：

```bash
git clone --depth=1 https://github.com/WEIFENG2333/phistory.git /tmp/phistory-source
python3 scripts/sync_phistory.py --source /tmp/phistory-source
python3 scripts/rebuild_archive.py
```

`sync_phistory.py` 更新证据快照、图标、Codex trace 与 manifest。`rebuild_archive.py` 再从证据文件重建页面内的 13 个原文栏，并迁移现有高亮锚点；任何高亮原文在新 Prompt 中消失时，脚本会失败并要求人工 review，避免静默保留错误标注或丢失批注。

如上游只做了经过人工确认的措辞调整，可在 `rebuild_archive.py` 的 `ANCHOR_OVERRIDES` 中显式记录锚点迁移。

## 校验

```bash
make check
```

GitHub Actions 会在 `main` 分支推送与 Pull Request 时执行同一组重建、覆盖审计、归档一致性和浏览器验收。

校验覆盖：

- 13 份页面内嵌 Prompt 与固定快照规范化文本一致；
- Prompt 文件的字节数和 SHA-256 与 manifest 一致；
- 572 个高亮与 572 条批注按 ID、主题逐一配对且无重复；
- 381 条原规则解释仍在；26 条哲学批注明确标记为编辑推断；165 条覆盖扩展遍及全部 13 个 Agent；
- 16,910 个非空原文行全部进入覆盖分类，新增锚点逐条校验所在 Agent、类别、原文与预期出现次数；
- 每条批注具备主题、标题、原文短语和解读，正文不依赖运行时 Markdown 修补；
- 本轮新增/修订批注和审计文件均绑定同一 Phistory commit；
- 13 个 Agent 的导航、画廊、Logo、版本、发布日期、字节数和快照数一致；
- 页面无重复 DOM ID，并展示固定 commit 与历史快照总数。
- Chrome 1920×1080、1440×900 与 390×844 三档无页面横向溢出，当前 Agent 的高亮/批注数一致，并核验 13 份哲学画像、7 条设计轴与 26 条哲学证据；桌面端还逐 Agent 测量相邻高亮的实际渲染距离，最大空档不得超过 4,000px。验收同时模拟 Agent 圆弧拖拽与方向键切换，并检查顶部工具不溢出及交互目标尺寸。首页截图写入 `/tmp/deepprompt-home-{wide,desktop,mobile}.png`，画像截图写入 `/tmp/deepprompt-philosophy-{wide,desktop,mobile}.png`。

`browser_qa.mjs` 会自启临时静态服务器并直接使用 Chrome DevTools Protocol，不依赖 npm 包；macOS 默认使用 Google Chrome，其他平台可通过 `DEEPPROMPT_CHROME` 指定 Chromium/Chrome 可执行文件。传入 URL 时也可验收一个已运行的站点。

## 本轮标注重点

- 原有规则解释层完整保留：继续回答“规则要求什么、怎样运行、边界在哪里”。
- 新增设计哲学层：按“规则事实 → 运行机制 → 哲学推断 → 内在张力”展开，并以“哲学层（推断）”显式区分分析与原文。
- 逐句覆盖扩展：对 13 份 Prompt 的每个非空行重新分类，在工具协议、技能路由、任务状态、上下文继承、定时调度、记忆、进程与权限边界中新增 165 条深度批注。
- 空白不再靠猜测解释：纯 schema、重复目录和围栏结构保留原文但不逐字段注水；其余未单列批注的句子记录为“已复读、与相邻批注意义重合或没有独立解读增量”。
- 每个 Agent 新增两条高价值证据批注，并在页首形成“哲学命题 + 内在张力”画像。
- 横向新增受托关系、环境可读性、上下文经济、记忆制度、证据闭环、权限与风险、协作拓扑七条设计轴。
- Claude Code：跨会话发现与寻址、消息排队语义、跨会话权限洗白防护。
- Codex：长等待不是拖延，而是避免 busy polling 的负载策略。
- Antigravity：`conversation://` 把会话身份变成可导航、可追溯对象。
- Grok：累计调用预算与瞬时并发上限是两套不同约束。
- Kimi Code：UTF-16 的读取转码不代表编辑器可以原编码写回。
- Pi：`Inspect` 改为 `You can inspect`，从强制动作降为按需能力。
- 既有纠错：移除“模型名导致整套措辞”的无证据因果推断；补足特权标记协议对可信预处理的依赖；修正 `apply_patch` “唯一合法方式”等过度概括。

规则解释采用“原文事实 → 运行机制 → 边界/风险”三层方法；哲学扩展再增加“设计推断 → 内在张力”，且推断不冒充厂商声明。分析参考 Anthropic 的 context engineering、长程 harness、多智能体与 agent evals 实践，OpenAI 的 harness engineering、agent guardrail / prompt injection 指南，MCP 人在回路规范，以及 OWASP 的 least-privilege、excessive-agency 与 confused-deputy 风险框架。完整链接见 `data/annotation-audit.json`。
