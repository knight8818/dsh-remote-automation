# dsh-remote-automation

<img src="https://raw.githubusercontent.com/knight8818/dsh-remote-automation/main/assets/icon.png" width="88" align="right" alt="dsh-remote-automation icon">

[English](README.en.md) | 简体中文

[![CI](https://github.com/knight8818/dsh-remote-automation/actions/workflows/ci.yml/badge.svg)](https://github.com/knight8818/dsh-remote-automation/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

**在 DeepSeek Harness 里把定时任务放到远程阿里云 ECS 上跑。**

给 DSH 增加一个侧栏「**云端任务**」页面和一组工具。脚本通过阿里云云助手在你自己的 ECS 上执行：实例**不需要任何入站端口**，安全组可以一直关着，本机关机也不影响任务。

> 目前只支持阿里云 ECS。`tasks` / `aliyun` 的模块边界已经按可替换设计，后续加别的云厂商不用动页面。

## 特性

- **独立页面**：侧栏「自动化任务」下方新增「云端任务」，查看实时状态、立即运行、看日志、删除，不挤占官方页面。
- **每次都先问**：通过 `automation_create` 创建任务时会先问「云端服务器」还是「本地 DSH 提醒」，没有默认值。
- **真实状态**：运行中 / 空闲 / 成功 / 失败、上次退出码、最近日志时间；打开即刷新，页面可见时轮询。
- **零入站**：只走出站 HTTPS 到 `ecs.<region>.aliyuncs.com`，通过云助手执行，不需要 SSH 或开放端口。
- **密钥不出本机**：仓库里没有任何凭证；页面只拿到打码后的 AccessKey ID，Secret 永不回传、不写日志。
- **对 Agent 友好**：仓库自带 [`AGENTS.md`](AGENTS.md)，DeepSeek 读完就知道怎么安装、验证、升级和卸载。

## 环境要求

| 要求 | 说明 |
| --- | --- |
| DeepSeek Harness | `>= 0.2.0`（需要 bundle layer + 客户端插件支持） |
| Node.js | `>= 20`（宿主侧只用标准库，零运行时依赖） |
| 阿里云 ECS | 实例云助手在线（公共镜像默认已安装） |
| 网络 | 实例能出站访问 `ecs.<region>.aliyuncs.com:443` |
| Git | 仅「从 GitHub 直接安装」时需要 |

插件需要 **Web profile**（桌面版或 `dsh web`）：它要在 `webServer` 服务上注册侧栏页面和 HTTP 路由。headless / SDK profile 没有这个服务，插件不会加载。

## 安装

### 1. 让你的 DeepSeek 安装（推荐）

把下面这段和仓库链接一起发给 DSH 里的 Agent：

```text
请安装这个 DSH 插件：https://github.com/knight8818/dsh-remote-automation
按仓库里的 AGENTS.md 操作：装到我的 desktop profile，验证 YAML layer 和
node --check，不要打印 ~/.dsh/remote-automation 下的任何文件，不要重启 DSH，
装完告诉我什么时候需要完全退出再启动。
```

Agent 会读 [`AGENTS.md`](AGENTS.md)，里面有确切的 `dsh plugin` 命令、手动兜底、验证步骤和安全规则。

### 2. 一条命令

先装一次 `dsh` CLI，或者用 `npx` 一次性执行：

```bash
npm install -g @deepseek-ai/dsh
dsh plugin --profile desktop add github:knight8818/dsh-remote-automation
```

桌面版 profile 一般叫 `desktop`，`dsh web` 用 `web`；如果你的 profile 名字不同就换成实际名字。profile 不存在时 `dsh plugin` 会自动初始化。

不想全局安装：

```bash
npx --yes @deepseek-ai/dsh@latest plugin --profile desktop add github:knight8818/dsh-remote-automation
```

因为包里声明了 `dsh.bundle.patch`，这条命令会把包加进 profile，并自动把 bundle layer 追加到 `dsh.profile.bundles`。不用手改 YAML，也不用复制文件。

不启动、只验证 layer：

```bash
dsh --profile desktop --dump-config | grep dsh-remote-automation
```

### 3. 手动兜底（离线 / 没有 pnpm）

```bash
git clone https://github.com/knight8818/dsh-remote-automation
# 目标已存在就停下，不要在它里面再套一层
test -e ~/.dsh/profiles/node_modules/dsh-remote-automation \
  && echo "already installed: remove or back it up first" \
  || cp -r dsh-remote-automation ~/.dsh/profiles/node_modules/dsh-remote-automation
```

Windows PowerShell：

```powershell
git clone https://github.com/knight8818/dsh-remote-automation
$dst = "$env:USERPROFILE\.dsh\profiles\node_modules\dsh-remote-automation"
if (Test-Path $dst) { throw "already installed: $dst" }
Copy-Item -Recurse .\dsh-remote-automation $dst
```

然后在 `~/.dsh/profiles/desktop/cordis.patch.yml` 末尾追加（仅当文件里还没有 `id: remote-automation` 时）：

```yaml
- insert:
    - id: remote-automation
      name: dsh-remote-automation
```

Windows 下路径是 `%USERPROFILE%\.dsh\profiles\node_modules\` 和 `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml`。

无论用哪种方式，装完都要**完全退出 DSH**（托盘图标也要退出，不是只关窗口）再启动。只刷新页面不够，宿主插件需要重启才会挂载。

### 从手动安装的 `0.1.x` 升级

先删掉旧副本（`~/.dsh/profiles/node_modules/dsh-remote-automation`）和 profile 的
`cordis.patch.yml` 里那段三行 `- insert:`，再用上面的一条命令安装。两套都留着会让
`id: remote-automation` 注册两次。

## 配置

打开侧栏「云端任务」，点「编辑」，填写：

| 字段 | 说明 |
| --- | --- |
| AccessKey ID / Secret | RAM 子账号，建议只授下面 5 个动作 |
| 地域 | 例如 `cn-shenzhen` |
| 实例 ID | 例如 `i-xxxxxxxxxxxxxxxx` |
| 脚本目录 | 默认 `/opt/automation` |

已保存的 Secret 不会回传页面，输入框显示占位符并保持为空；留空保存就沿用旧值。

环境变量优先于配置文件：`DSH_RA_AK_ID`、`DSH_RA_AK_SECRET`、`DSH_RA_REGION`、`DSH_RA_INSTANCE_ID`、`DSH_RA_SERVER_DIR`。配置文件位于 `$DSH_HOME/remote-automation/config.json`（默认 `~/.dsh/remote-automation/config.json`），在支持的平台上以 `0600` 权限写入。

### RAM 最小权限

新建自定义策略，只勾下面这些动作，授权给该 RAM 用户：

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecs:RunCommand",
        "ecs:DescribeInvocationResults",
        "ecs:DescribeCloudAssistantStatus",
        "ecs:DescribeInstances",
        "ecs:InstallCloudAssistant"
      ],
      "Resource": "*"
    }
  ]
}
```

它不能删实例、改安全组、动磁盘或网络。

## 使用

在对话里说：

```text
每天 9 点，在云端服务器上跑我的 daily-report 脚本。
```

`automation_create` 会先问「云端」还是「本地」。选云端 → 在服务器生成脚本 + 可选 cron；选本地 → 转去创建 `schedule_*` 提醒。

工具：

| 工具 | 作用 |
| --- | --- |
| `automation_create` | 创建自动化任务的唯一入口，先问云端/本地 |
| `cloud_task_list` | 列出任务和实时状态（一次云助手查询） |
| `cloud_task_run` | 立即触发 |
| `cloud_task_logs` | 查看日志尾部 |
| `cloud_task_delete` | 删除脚本、cron 和日志 |

## 安全模型

- **仓库和 git 历史里没有密钥**；配置来自环境变量或运行时写入的本机文件。
- 本机 HTTP 接口（`/dsh-remote-automation/*`）要求每个进程随机生成、仅注入已登录页面的令牌，比较使用常量时间算法。
- 页面只拿到打码的 AccessKey ID；Secret 不回传、不写日志、不渲染。
- 命令通过云助手下发，实例上没有新增监听端口。
- `state.json` 会保存你要求执行的命令，请当作 shell history 对待；写入权限 `0600`。
- 插件不上报任何遥测。

发现安全问题请看 [`SECURITY.md`](SECURITY.md)。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| `dsh: command not found` | 改用 `npx` 形式，或 `npm install -g @deepseek-ai/dsh` |
| 侧栏没有「云端任务」 | 完全退出 DSH（含托盘进程）再启动 |
| 提示「插件尚未配置」 | 在页面填写，或设置 `DSH_RA_*` 环境变量 |
| `Forbidden.RAM` | 给 RAM 用户挂上面的最小权限策略 |
| 云助手离线 | 在实例上启动/安装云助手 agent |
| `id: remote-automation` 出现两次 | 同时用了 bundle 和手动 patch，删掉其中一个 |
| 刚点「运行」日志是空的 | 进程刚启动，过几秒刷新 |

## 卸载

```bash
dsh plugin --profile desktop remove dsh-remote-automation
```

手动安装的话，删除 `~/.dsh/profiles/node_modules/dsh-remote-automation`，并从 profile 的 `cordis.patch.yml` 里移除那段三行 `- insert:`。`~/.dsh/remote-automation/` 里的凭证会保留；要彻底清除请自行删除该目录。

## 开发

```bash
npm install          # 仅为测试安装 yaml
npm run check        # 对所有运行时文件执行 node --check
npm test             # node:test
```

目录：

```
lib/host.js      宿主插件：工具 + HTTP 路由 + 页面令牌
lib/client.js    浏览器插件：侧栏页面（预构建，lazy-CJS 模块格式）
lib/tasks.js     任务模型 + 远端脚本/cron/日志操作
lib/aliyun.js    ECS 云助手 RPC 客户端（HMAC-SHA1，零依赖）
lib/config.js    配置读取与打码
lib/validate.js  配置、任务、HTTP 共用的输入校验
cordis.patch.yml bundle layer（插入插件行）
```

`lib/client.js` 是手写产物，格式为 DSH 客户端模块的 `window.__ModuleLoader__.load`，不是构建输出。运行时没有依赖，安装后的副本不需要 `npm install`。

## License

[MIT](LICENSE)
