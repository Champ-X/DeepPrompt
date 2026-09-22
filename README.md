# Deep Prompt

<div align="center">
  <p><strong>Agent 系统提示词档案馆</strong></p>
  <p>从逐字证据出发，读懂编码 Agent 的规则、边界与设计哲学。</p>
  <p>
    <a href="https://deep-prompt-woad.vercel.app"><img alt="Live on Vercel" src="https://img.shields.io/badge/live-Vercel-000000?logo=vercel&logoColor=white"></a>
    <a href="https://github.com/Champ-X/DeepPrompt/actions/workflows/verify.yml"><img alt="Verify archive" src="https://github.com/Champ-X/DeepPrompt/actions/workflows/verify.yml/badge.svg"></a>
    <a href="https://github.com/WEIFENG2333/phistory/tree/a1fc4ad1f72ad6bf98a2c85b3f0b00cda33190d8"><img alt="Phistory commit" src="https://img.shields.io/badge/Phistory-a1fc4ad1f72a-2f766d"></a>
    <img alt="Agents" src="https://img.shields.io/badge/Agents-15-356aa0">
    <img alt="Annotations" src="https://img.shields.io/badge/Annotations-749-c15f3c">
  </p>
  <p>
    <a href="https://deep-prompt-woad.vercel.app"><strong>在线阅读 →</strong></a>
    ·
    <a href="#本地运行">本地运行</a>
    ·
    <a href="https://phistory.cc">Phistory 数据源</a>
  </p>
</div>

Deep Prompt 是一个可审计的 Agent System Prompt 阅读器。它将 [Phistory](https://phistory.cc) 的最新默认捕获固定到明确 commit，在保留原文的前提下提供两层分析：

- **规则解释**：规则要求什么、如何运行、适用边界在哪里。
- **设计哲学**：从规则事实推导 Agent 的自治观、权限观、上下文策略与内在张力，并明确标记为编辑推断。

> A source-grounded archive of coding-agent system prompts, with verbatim snapshots, rule-level annotations, and explicitly labeled design-philosophy analysis.

## 为什么做这个档案馆

系统提示词不只是“模型该怎么说话”，它们实际上定义了 Agent 的执行系统：什么时候自主行动，什么时候请示，如何使用工具、记忆、子代理和定时任务，又如何判定一项工作真正完成。

这个项目试图让这些设计变得可见、可对照、可追溯：

- 中央为固定快照的原始 Prompt，不用摘要替代证据。
- 批注与原文锚点一一对应，支持搜索、主题筛选与视觉连线。
- 首页用七条设计轴和五个主题比较不同 Agent，详情页保留单个 Agent 的语境。
- 上游规则被删除或反转时，旧批注进入退役审计，不冒充当前规则。
- 每次同步都经过哈希、锚点、DOM、响应式和真实 Chrome 交互验收。

## 当前快照

| 指标 | 当前值 |
| --- | ---: |
| Phistory commit | [`a1fc4ad1f72a`](https://github.com/WEIFENG2333/phistory/tree/a1fc4ad1f72ad6bf98a2c85b3f0b00cda33190d8) |
| 上游索引时间 | `2026-09-22 05:18 UTC` |
| Agent | 15 |
| 历史版本 / 快照 | 1,241 / 1,628 |
| 当前高亮 / 批注 | 749 / 749 |
| 当前规则解释 | 307 |
| 设计哲学证据 / 逐句扩展 | 30 / 412 |
| 已机械分类的非空原文行 | 20,738 |

已收录 Claude Code、Codex CLI、DeepSeek Harness、Antigravity CLI、Grok Build、MiniMax Code、Kimi Code、MiMo Code、OpenClaw、Hermes Agent、Kimi CLI、opencode、Oh My Pi、Pi 与 Claude Tag。“最新”指截至 2026-09-22 核查时 Phistory 可见的最新捕获，不保证等同于各厂商线上所有模型的实时 Prompt。当前批注对应 default；23 份最新变体原文均已保存。Claude Tag 为上游手工导入并脱敏的 Slack 捕获，日期不表示软件包版本；Claude Code 同版本默认捕获已由 SDK 切换到 CLI，SDK 单独归档。完整版本、发布时间、字节数、SHA-256 和变体信息见 [`data/manifest.json`](data/manifest.json)。

本轮修订 14 条既有批注、新增 141 条、退役 11 条，补齐 Claude Tag，并校正捕获场景、一次性运行、共享数据与消息送达语义。退役账本累计保留 109 条记录；逐项变化见 [`COMPLETION_AUDIT.md`](COMPLETION_AUDIT.md)。

## 信息架构

```text
Phistory @ pinned commit
├─ captures/index.json
├─ latest default prompt.md ──→ data/prompts/*.md
└─ latest variants          ──→ data/variants/<agent>/*.md
                                      │
       data/annotations.json + data/editorial.json
                                      ↓
index.html + data/agents/*.html + data/manifest.json
                                      │
                 reproducibility + browser QA
                                      ↓
                         static deployment
```

`index.html` 只是轻量目录壳。进入阅读页后，对应的 `data/agents/<agent>.html` 才会按需载入并缓存，避免把全部 Prompt 和批注塞进首屏。

## 本地运行

需要 Python 3.12+；如要运行完整浏览器验收，还需要 Chrome/Chromium 和 Node.js 22+。

```bash
git clone https://github.com/Champ-X/DeepPrompt.git
cd DeepPrompt
make serve
```

打开 <http://127.0.0.1:8765/>。阅读页使用 `fetch()` 加载 Agent 分片，因此不要直接用 `file://` 打开 `index.html`。

## 项目结构

| 路径 | 职责 |
| --- | --- |
| `index.html` | 首页目录、七条横向设计轴、五主题总结与阅读壳 |
| `archive.css` | 全局 token、首页、阅读器、批注和加载状态 |
| `reader-controls.css` | 顶部工具栏与 Agent 色谱切换轨 |
| `scripts/archive-ui.js` | 路由、搜索、筛选、批注连线与分片懒加载 |
| `data/agents/*.html` | 可独立重建的 Agent 阅读分片 |
| `data/prompts/*.md` | 当前 default Prompt 的本地证据副本 |
| `data/variants/**` | 每个 Agent 的全部最新捕获变体 |
| `data/manifest.json` | 固定 commit、来源路径、哈希、版本与快照统计 |
| `data/annotations.json` | 全量批注唯一编辑入口，绑定原文哈希、出现序号与起止行 |
| `data/editorial.json` | 题眼、哲学画像、七条设计轴与五主题总结及其依据 |
| `data/retired-annotations.json`, `data/review-history/` | 退役原文、解读、理由与历史审计 |
| `data/annotation-audit.json` | 本轮语义修订、新增、恢复与退役索引 |
| `data/annotation-coverage.json` | 非空原文行的机械映射与分类，不等于人工复读证明 |
| `scripts/*.py`, `scripts/browser_qa.mjs` | 同步、重建、审计、一致性与浏览器验收 |

视觉规范见 [`DESIGN.md`](DESIGN.md)，当前审计结论见 [`COMPLETION_AUDIT.md`](COMPLETION_AUDIT.md)。

## 证据与批注方法

1. **原文层**：本地 `prompt.md` 与固定上游文件逐字节一致，字节数和 SHA-256 记录在 manifest；页面解析标题、列表与围栏，保留排版后的规范化正文，并提供完整原文件链接。
2. **规则层**：按“原文事实 → 运行机制 → 边界/风险”解读，不用结论代替锚点。
3. **哲学层**：增加“设计推断 → 内在张力”，相关批注必须显式写明“哲学层（推断）”，不冒充厂商声明。
4. **覆盖层**：每个非空行机械分类为已批注、未批注围栏内容、重复材料、结构分隔符或未批注正文。它不能证明未批注行已被人工复读或没有分析价值。
5. **定位层**：短引文直接由真实 anchor 生成。每条批注绑定 Agent、源文件哈希、锚点出现次数、选中出现序号与起止行，页面可跳到固定上游的对应行。
6. **变更层**：来源更新或锚点移动会使重建失败。人工审阅后更新注册表与审计理由；失效规则进入退役账本，历史规则恢复也须重新核对证据。

### 证据边界

- Phistory 的 `prompt.md` 会规范化临时路径、日期和会话 ID，便于阅读与 diff；它不等同于完全未处理的 wire payload。
- Codex 的附带捕获证据见 `data/prompts/codex.trace.jsonl`，沿用上游对敏感字段的处理，并单独校验版本、字节数和哈希。它不是本项目重新发起的请求。
- 单次捕获可能包含专用角色与会话环境。MiMo 此次 default 是标题生成请求，Antigravity 此次则是编码助手；这不代表整个产品的能力边界。
- 批注是独立分析，不代表 Agent 厂商或 Phistory 的立场。
- 固定快照只代表本次审计时点；上游更新后需要重新复读，不能只替换版本号。

## 同步上游

```bash
git clone --depth=1 https://github.com/WEIFENG2333/phistory.git /tmp/phistory-source
python3 scripts/sync_phistory.py --source /tmp/phistory-source
git diff -- data/prompts data/variants
# 人工审阅后更新 annotations.json、editorial.json 与 annotation-audit.json
python3 scripts/rebuild_archive.py
python3 scripts/audit_annotation_coverage.py
make check
```

`sync_phistory.py` 复制每个 Agent 的最新 default Prompt 和全部最新 variants，并更新图标、Codex trace 与 manifest。`rebuild_archive.py` 再从证据文件重建轻量 shell 与 Agent 分片。

**不要在未阅读 diff 的情况下直接提交同步结果。** Prompt 的角色、工具或权限语义可能发生反转。同步脚本要求干净的上游 checkout 与明确的 default，并在复制前检查全部最新变体与 Codex trace；支持没有 package 字段的手工捕获。批注注册表与摘要绑定旧来源时，重建会主动失败，需完成语义审阅后再更新来源绑定。

## 验证

```bash
make check
```

该命令会依次验证：

1. 精确定位回归：重复文本、同一行的第二处引文、多行代码、错误来源/行号/Agent、重叠与错误 HTML 标记。
2. 当前 shell、15 份 Agent 分片和全文分类报告均可重建；画像与横向比较能追溯到有效批注。
3. Prompt/23 份变体/Codex trace 哈希、749 组批注、Logo、版本与页面元数据一致。
4. Chrome 在 1920×1080、1440×900 和 390×844 下逐 Agent 检查引文、来源链接、DOM ID 与页面宽度，并验证懒加载、导航、搜索、筛选、点击配对与折叠连线。

GitHub Actions 在 `main` 推送和 Pull Request 上运行同一套检查。

## 部署

项目是无构建步骤的静态站点，当前生产环境位于 [deep-prompt-woad.vercel.app](https://deep-prompt-woad.vercel.app)。

<a href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FChamp-X%2FDeepPrompt"><img src="https://vercel.com/button" alt="Deploy with Vercel"></a>

也可使用 CLI：

```bash
npx vercel --prod
```

## 贡献与安全

- 数据同步、批注纠错、设计哲学反例、可访问性与浏览器回归都欢迎提交。请先阅读 [`CONTRIBUTING.md`](CONTRIBUTING.md)。
- 如果发现凭据、隐私、供应链或可被利用的前端问题，请按 [`SECURITY.md`](SECURITY.md) 私下报告，不要先在公开 Issue 中粘贴敏感细节。

## 来源、商标与许可状态

- Prompt 快照来自 [WEIFENG2333/phistory](https://github.com/WEIFENG2333/phistory)，各 Agent 图标来源见 [`agent-icons/SOURCES.md`](agent-icons/SOURCES.md)。
- 各 Agent 名称、Logo 和商标归相应权利人所有；收录仅用于来源识别、研究与评论。
- **本仓库目前未声明开源许可证。** 仓库公开可见不等于自动授予复制、修改或再分发权；在许可证明确前，除法律另有规定或获得单独授权外，保留所有权利。
