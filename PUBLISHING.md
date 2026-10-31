# 发布到 DSH 插件生态

DSH **没有官方中心商店**：官方只提供「自定义插件市场（Discover）」机制，生态由若干社区索引和市场组成。
要让别人搜到，实际路径是：

1. **发布到 npm**（`dsh plugin add <包名>` 的前提，也是多数索引收录的前提）；
2. **提交到 awesome-dsh-plugin**（dsh-market、dsh-plugin-catalog、官方 Discover 索引源都以它为目录源）；
3. 按需提交「开放插件市场」和「DSH-Store」。

本文件记录本仓库的发布流程，命令可直接复制。

## 1. 发布 npm 包

包名 `dsh-remote-automation`（未加 scope，便于 `dsh plugin add`）。发布前确认名字仍可用：

```bash
npm view dsh-remote-automation version   # 404 = 可用
```

登录并发布（首次会要求浏览器授权或 2FA）：

```bash
npm login
npm whoami
npm publish
```

需要 2FA 时加 `--otp=123456`。发布后验证：

```bash
npm view dsh-remote-automation version   # 0.2.0
npm view dsh-remote-automation dist.tarball
```

发布成功后再把 README 的安装方式从 `github:...` 换成 npm 包名，并加 npm 徽章：

```bash
dsh plugin --profile desktop add dsh-remote-automation
```

**凭证注意**：不要在仓库、README、聊天或 CI 日志里写 token。本地用 `npm login` 存系统钥匙串；
CI 用 npm Trusted Publishing（OIDC）或仓库 Secret `NPM_TOKEN`，并加 `--provenance`。
发布前用 `npm publish --dry-run` 检查内容，应只有 `lib/`、`cordis.patch.yml`、README、LICENSE 等 13 个文件。

## 2. 提交 awesome-dsh-plugin（最重要）

- 仓库：<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin>
- 规则：<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md>
- 入口：一个 PR **只加一个文件** `data/plugins/knight8818__dsh-remote-automation.yml`，不要手改 README。

文件内容：

```yaml
url: https://github.com/knight8818/dsh-remote-automation
name: knight8818/dsh-remote-automation
category: remote
description:
  en: Run scheduled shell automation on a remote Aliyun ECS through Cloud Assistant, with a Cloud Tasks sidebar page and agent tools.
  zh: 在 DSH 侧栏管理云端定时任务：通过阿里云云助手在 ECS 上执行脚本，零入站端口，并提供 Agent 工具。
icon: https://raw.githubusercontent.com/knight8818/dsh-remote-automation/main/assets/icon.png
```

硬性要求（CI 会自动检查）：

- `package.json` 声明 `dsh.bundle.patch`（本仓库已满足）；
- 仓库有真实可用的代码（非占位）；
- 仓库**创建满 24 小时**——本仓库创建于 `2026-10-31T21:07:08Z`，即 **2026-11-02 05:07（+08:00）之后**才能提交；
  以 `gh api repos/knight8818/dsh-remote-automation --jq .created_at` 为准；
- 仓库带 `dsh-plugin` topic（已添加）；
- 描述只陈述功能，不夸大；分类贴合实际用途（这里用 `remote`）。

PR 流程：

```bash
gh repo fork awesome-dsh-plugin/awesome-dsh-plugin --clone
cd awesome-dsh-plugin
git checkout -b add-dsh-remote-automation
# 写入 data/plugins/knight8818__dsh-remote-automation.yml
git add data/plugins/knight8818__dsh-remote-automation.yml
git commit -m "Add knight8818/dsh-remote-automation"
git push -u origin add-dsh-remote-automation
gh pr create --repo awesome-dsh-plugin/awesome-dsh-plugin \
  --title "Add knight8818/dsh-remote-automation" \
  --body "Remote automation on Aliyun ECS for DSH, with a Cloud Tasks page and agent tools."
```

合并后会自动重新生成 README，并被以下位置读到（通常一天内）：

- **dsh-market**（`dshmarket`）的插件目录；
- npm 包 **dsh-plugin-catalog** / `https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`；
- DSH 官方实验性「自定义插件市场 → Discover → 索引源」；
- <https://awesome-dsh-plugin.com>。

## 3. 开放插件市场（dshopen.org）

- 提交：<https://github.com/polang233/dsh-plugin-index/issues/new?template=plugin-add.yml>
- 要求：公开源码、**可安装的 npm 版本**、明确许可证；有 Logo 和完整描述优先。
- 插件地址填 npm 包名 `dsh-remote-automation`（或仓库地址），说明一句话即可。

收录后用户可在 Discover 添加 `https://dshopen.org/index.json` 搜到。

## 4. DSH-Store（dsh.store）

- 提交：<https://github.com/AI-Scarlett/DSH-Store/issues/new?template=plugin-submission.yml>
- 只需公开 GitHub 仓库地址；机器人会固定默认分支 Commit、读取 `package.json`、Bundle Patch、README，
  做静态安全检查。要求：`dsh.bundle.patch`、入口 ID 唯一、无生命周期脚本、不冒充官方包、许可证一致。
- 本仓库无 `preinstall/install/postinstall/prepare` 脚本，符合要求。
- 收录后用户可在 Discover 添加 `https://dsh.store/plugin-market.json`。

## 5. 其他自动聚合

以下项目会自动按 GitHub topic / 搜索同步，无需单独提交，但保持 `dsh-plugin` topic、仓库活跃即可：

- Oh-My-DSH：<https://github.com/like-study1/Oh-My-DSH>
- DSH Plugin Radar：<https://github.com/AdamPlatin123/dsh-plugin-radar>
- Blue-Whale-Harness：<https://github.com/leenkcool/Blue-Whale-Harness>

## 6. 用户侧怎么搜到

DSH 0.2.1+：**插件 → 实验性插件 → 更多 → 开启「自定义插件市场」→ 发现 → 添加索引源**，可加：

| 索引源 | 地址 |
| --- | --- |
| awesome / dsh-market（本插件目标） | `https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json` |
| 开放插件市场 | `https://dshopen.org/index.json` |
| DSH-Store | `https://dsh.store/plugin-market.json` |

在索引里搜索 `remote`、`automation`、`aliyun`、`cron` 或插件名即可；也可以直接
`dsh plugin --profile <name> add dsh-remote-automation`。

## 7. 发布检查清单

- [ ] `npm publish --dry-run` 内容正确（13 个文件，约 32 KB）
- [ ] `npm publish` 成功，`npm view` 能查到 0.2.0
- [ ] GitHub Release 与 npm 版本一致
- [ ] 仓库有 `dsh-plugin` topic、icon、README 安装说明
- [ ] 仓库创建满 24h 后提交 awesome PR
- [ ] npm 发布后提交开放插件市场 issue
- [ ] 提交 DSH-Store issue
- [ ] 收到合并/收录后，在 README 加对应徽章或“可在 Discover 搜索”说明
