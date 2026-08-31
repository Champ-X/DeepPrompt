# Contributing

感谢你帮助 Deep Prompt 变得更准确、更可追溯。本项目欢迎上游同步、批注纠错、新的设计哲学证据、可访问性修复和浏览器回归改进。

## 开始之前

1. 从 `main` 创建短生命周期分支。
2. 使用 Python 3、Node.js 22+ 和 Chrome/Chromium。
3. 本地启动 `make serve`，完整验收运行 `make check`。
4. 不要在 PR 中提交 `.vercel/`、本地环境文件、临时截图或任何凭据。

## 贡献类型

### 同步 Phistory

```bash
git clone --depth=1 https://github.com/WEIFENG2333/phistory.git /tmp/phistory-source
python3 scripts/sync_phistory.py --source /tmp/phistory-source
python3 scripts/rebuild_archive.py
make check
```

同步 PR 必须：

- 在 `data/manifest.json` 中锁定一个可追溯的 Phistory commit。
- 检查每个更新 Agent 的 Prompt diff，不只替换版本号。
- 保存 default Prompt 与全部最新 variants 的哈希、字节数和来源路径。
- 对消失、改写或含义反转的锚点进行人工 review。
- 同义迁移通过 `ANCHOR_OVERRIDES` 显式记录；失效规则进入 retired annotation 审计，不得静默删除或错配。
- 更新 README 的快照统计和 `COMPLETION_AUDIT.md` 的审计结论。

### 新增或修订批注

每条批注都应包含可验证锚点、类别、标题、短引文和完整解读。

- **规则解释**：按“原文事实 → 运行机制 → 边界/风险”展开。
- **设计哲学**：先给出规则证据，再推导设计取向与内在张力；批注正文必须包含“哲学层（推断）”。
- **覆盖扩展**：只在一个句子能提供独立规则、失败模式、取舍或设计推断时新增；不给括号、原始类型和重复 schema 注水。
- 对作者动机、模型版本或产品成果的因果判断，如果没有证据，必须删除或降级为明确推断。

### 前端与可访问性

- `index.html` 必须保持轻量，Agent 正文继续按需加载。
- 可见批注必须能定位到可见原文锚点。
- 交互必须支持键盘、清晰焦点和 reduced motion。
- 变更后必须检查 1920×1080、1440×900 和 390×844 视口。
- 新的样式或组件应遵守 `DESIGN.md` 的语义 token 和身份色/批注色分层。

## Pull Request 检查清单

- [ ] PR 说明了动机、产品影响和证据来源。
- [ ] 上游更新绑定了精确 commit，批注更新绑定了精确原文。
- [ ] 所有生成文件已重建，没有手工修改后不可重现的产物。
- [ ] `make check` 在本地通过。
- [ ] 未引入 token、cookie、未脱敏 trace 或个人路径。
- [ ] 面向读者的文档、快照数字和审计记录已同步。

## 许可提醒

本仓库目前没有声明开源许可证。提交贡献表示你确认自己有权提交该内容；仓库维护者将在合并前根据未来明确的许可策略处理授权。
