# Security Policy

Deep Prompt 存储了 Prompt、变体和部分捕获证据。即使当前 trace 已脱敏，上游同步仍可能意外引入凭据、个人识别信息或能被浏览器解释的恶意内容。

## 请私下报告

以下问题请不要先在公开 Issue 中披露完整细节：

- 可用 API token、cookie、账号 ID、未脱敏请求或其他凭据。
- 可通过 Prompt/批注内容触发的 XSS、HTML 注入或 DOM 注入。
- 能替换、伪造或绕过来源哈希/锚点校验的供应链问题。
- 部署配置、GitHub Actions 或 Vercel 中可能暴露数据或扩大权限的问题。

请通过 GitHub 的 [Report a vulnerability](https://github.com/Champ-X/DeepPrompt/security/advisories/new) 私下报告问题，并避免在公开 Issue 中披露可直接利用的细节。

报告建议包含：

- 受影响的路径、快照或部署。
- 可重现的最小步骤。
- 可能影响和你已采取的安全措施。
- 如何在不复制敏感数据的情况下验证问题。

## 不属于安全漏洞

批注观点分歧、文案问题、过期快照和非敏感数据错误请使用普通 Issue 或 Pull Request。
