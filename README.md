# dsh-remote-automation

把 DSH「自动化任务」页面变成**本地 + 云端双模式**：任务可以跑在本机，也可以跑在远程服务器上（当前支持阿里云 ECS），一个页面管理，一键切换，默认云端。

> 形态说明：官方「自动化任务」页面由 `@deepseek-ai/dsh-client-ui-schedule` 渲染，没有提供子槽位。本插件在这一页的 `section[data-testid="task-manager-page"]` 里、标题下方注入「云端任务」卡片，实现同页合并。这是有意的「魔改」，官方页面结构变化时可能需要跟随适配。

## 特性

- **同页合并**：不新增侧栏入口，云端任务紧跟在官方任务列表上方。
- **默认云端**：执行位置默认 `cloud`；切到 `local` 后本地定时/后台任务恢复。
- **真实状态**：运行中 / 空闲 / 成功 / 失败、上次退出码、最近日志时间，打开即刷新、每 8 秒轮询、可手动刷新。
- **零入站**：只走云助手 API（出站 HTTPS），安全组不需要任何入站规则。
- **无密钥入库**：所有凭证来自环境变量或本地配置文件，仓库里没有任何默认值。

## 安装

```bash
# 1. 放进 DSH profile 的 node_modules
cp -r dsh-remote-automation ~/.dsh/profiles/node_modules/

# 2. 在 profile 的 cordis.patch.yml 末尾追加
# - insert:
#     - id: remote-automation
#       name: dsh-remote-automation

# 3. 完全退出并重启 DSH
```

## 配置

打开「自动化任务」页面，卡片会在未配置时显示表单，填入：

| 字段 | 说明 |
| --- | --- |
| AccessKey ID / Secret | RAM 子账号，建议只授 ECS 的 5 个动作（见下） |
| 地域 | 例如 `cn-shenzhen` |
| 实例 ID | 例如 `i-xxxxxxxx` |
| 脚本目录 | 默认 `/opt/automation` |

也可以走环境变量（优先级高于配置文件）：

```bash
DSH_RA_AK_ID=...
DSH_RA_AK_SECRET=...
DSH_RA_REGION=cn-shenzhen
DSH_RA_INSTANCE_ID=i-xxxxxxxx
DSH_RA_SERVER_DIR=/opt/automation   # 可选
```

配置文件位置：`$DSH_HOME/remote-automation/config.json`（默认 `~/.dsh/...`）。

### RAM 最小权限

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

## 使用

在对话里说「每天 9 点跑 daily-report」，模型会调用 `cloud_task_create` 在服务器上生成脚本与 cron；页面里可以立即运行、看日志、删除。

工具：

| 工具 | 作用 |
| --- | --- |
| `cloud_task_create` | 创建云端任务（脚本 + 可选 cron） |
| `cloud_task_list` | 列出任务与实时状态 |
| `cloud_task_run` | 立即触发 |
| `cloud_task_delete` | 删除任务并清理服务器文件 |
| `cloud_task_logs` | 查看日志 |
| `automation_target` | 读取/切换执行位置 |

## 要求

- DSH Web（含 Electron 桌面端），客户端插件机制可用。
- Node.js >= 20（宿主侧只用标准库）。
- 目标实例已安装并运行云助手 agent（阿里云公共镜像默认有）。
- 实例能出站访问 `ecs.<region>.aliyuncs.com:443`。

## 安全

- 安全组零入站；所有操作通过云助手通道完成。
- 页面接口要求每个进程随机生成的令牌（通过 index 注入下发，仅已登录页面可见）。
- AccessKey 只保存在本地配置文件 / 环境变量，不会写入日志或返回给页面（页面只看到掩码）。

## 限制

- 目前只有阿里云 ECS 一个 provider；`lib/aliyun.js` 与 `lib/tasks.js` 的边界已按可替换设计。
- 页面注入依赖官方 `data-testid="task-manager-page"`；官方改版后需要同步调整 `lib/client.js` 的挂载逻辑。
- 云端任务的状态查询是一次远程命令（约 2 秒），任务很多时会变慢。

## 开发

```bash
npm test          # node:test
node --check lib/host.js
node --check lib/client.js
```

`lib/client.js` 是手写产物，不是构建输出；格式为 `window.__ModuleLoader__.load({ id, factory })`，与 DSH 客户端模块系统一致。

## License

MIT
