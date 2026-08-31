# Deep Prompt

<div align="center">
  <p><strong>Agent 系统提示词档案馆</strong></p>
  <p>从逐字证据出发，读懂编码 Agent 的规则、边界与设计哲学。</p>
  <p>
    <a href="https://deep-prompt-woad.vercel.app"><img alt="Live on Vercel" src="https://img.shields.io/badge/live-Vercel-000000?logo=vercel&logoColor=white"></a>
    <a href="https://github.com/Champ-X/DeepPrompt/actions/workflows/verify.yml"><img alt="Verify archive" src="https://github.com/Champ-X/DeepPrompt/actions/workflows/verify.yml/badge.svg"></a>
    <a href="https://github.com/WEIFENG2333/phistory/tree/7ab8e3bd55b6364eceebf907bab285f256e2c53a"><img alt="Phistory commit" src="https://img.shields.io/badge/Phistory-7ab8e3bd55b6-2f766d"></a>
    <img alt="Agents" src="https://img.shields.io/badge/Agents-14-356aa0">
    <img alt="Annotations" src="https://img.shields.io/badge/Annotations-537-c15f3c">
  </p>
  <p>
    <a href="https://deep-prompt-woad.vercel.app"><strong>在线阅读 →</strong></a>
    ·
    <a href="#本地运行">本地运行</a>
    ·
    <a href="https://phistory.cc">Phistory 数据源</a>
  </p>
</div>

Deep Prompt 是一个可审计的 Agent System Prompt 阅读器。它将 [Phistory](https://phistory.cc) 的规范化 Prompt 快照固定到明确 commit，在保留原文的前提下提供两层分析：

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
| Phistory commit | [`7ab8e3bd55b6`](https://github.com/WEIFENG2333/phistory/tree/7ab8e3bd55b6364eceebf907bab285f256e2c53a) |
| 上游索引时间 | `2026-08-29 18:47 UTC` |
| Agent | 14 |
| 历史版本 / 快照 | 1,116 / 1,165 |
| 当前高亮 / 批注 | 537 / 537 |
| 当前有效规则解释 | 324 |
| 设计哲学证据 / 逐句扩展 | 28 / 190 |
| 已复读的非空原文行 | 16,394 |

已收录 Claude Code、Codex CLI、DeepSeek Harness、Antigravity CLI、Grok Build、MiniMax Code、Kimi Code、MiMo Code、OpenClaw、Hermes Agent、Kimi CLI、opencode、Oh My Pi 与 Pi。完整版本、发布时间、字节数、SHA-256 和变体信息见 [`data/manifest.json`](data/manifest.json)。

## 信息架构

```text
Phistory @ pinned commit
├─ captures/index.json
├─ latest default prompt.md ──→ data/prompts/*.md
└─ latest variants          ──→ data/variants/<agent>/*.md
                                      │
                  reviewed anchors + annotations
                                      ↓
index.html + data/agents/*.html + data/manifest.json
                                      │
                 reproducibility + browser QA
                                      ↓
                         static deployment
```

`index.html` 只是轻量目录壳。进入阅读页后，对应的 `data/agents/<agent>.html` 才会按需载入并缓存，避免把全部 Prompt 和批注塞进首屏。

## 本地运行

需要 Python 3；如要运行完整浏览器验收，还需要 Chrome/Chromium 和 Node.js 22+。

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
| `data/coverage-annotations.json` | 可重建的批注锚点与预期出现次数 |
| `data/annotation-audit.json` | 标注方法、增修/退役清单与研究参考 |
| `data/annotation-coverage.json` | 所有非空原文行的复读分类报告 |
| `scripts/*.py`, `scripts/browser_qa.mjs` | 同步、重建、审计、一致性与浏览器验收 |

视觉规范见 [`DESIGN.md`](DESIGN.md)，当前审计结论见 [`COMPLETION_AUDIT.md`](COMPLETION_AUDIT.md)。

## 证据与批注方法

1. **原文层**：页面正文与固定 Phistory `prompt.md` 的规范化文本一致，字节数与 SHA-256 记录在 manifest。
2. **规则层**：按“原文事实 → 运行机制 → 边界/风险”解读，不用结论代替锚点。
3. **哲学层**：增加“设计推断 → 内在张力”，相关批注必须显式写明“哲学层（推断）”，不冒充厂商声明。
4. **覆盖层**：每个非空行都进入已批注、机械 schema、重复材料、结构分隔符或“已复读但无独立解读增量”之一；不为了密度给括号和基础类型注水。
5. **变更层**：锚点消失会使重建失败。经人工确认的同义迁移记录在 `ANCHOR_OVERRIDES`，失效规则记录为 retired annotation。

### 证据边界

- Phistory 的 `prompt.md` 会规范化临时路径、日期和会话 ID，便于阅读与 diff；它不等同于完全未处理的 wire payload。
- Codex 原始捕获另由 `data/prompts/codex.trace.jsonl` 作为证据，其认证头和账号字段已固定脱敏。
- 批注是独立分析，不代表 Agent 厂商或 Phistory 的立场。
- 固定快照只代表本次审计时点；上游更新后需要重新复读，不能只替换版本号。

## 同步上游

```bash
git clone --depth=1 https://github.com/WEIFENG2333/phistory.git /tmp/phistory-source
python3 scripts/sync_phistory.py --source /tmp/phistory-source
python3 scripts/rebuild_archive.py
make check
```

`sync_phistory.py` 复制每个 Agent 的最新 default Prompt 和全部最新 variants，并更新图标、Codex trace 与 manifest。`rebuild_archive.py` 再从证据文件重建轻量 shell 与 Agent 分片。

**不要在未阅读 diff 的情况下直接提交同步结果。** Prompt 的角色、工具或权限语义可能已发生反转，Antigravity 的当前 default 捕获就是一个典型例子。

## 验证

```bash
make check
```

该命令会依次验证：

1. 当前 shell 和 14 份 Agent 分片可由证据快照重现。
2. 所有非空原文行已进入覆盖审计。
3. Prompt/变体哈希、批注对、Logo、版本与页面元数据一致。
4. Chrome 在 1920×1080、1440×900 和 390×844 三档视口下完成懒加载、切换轨、连线、折叠锚点、响应式与批注空白阈值测试。

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
