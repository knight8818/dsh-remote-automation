# dsh-remote-automation

在 DSH 侧栏新增「云端任务」页面：任务可以跑在远程服务器上（当前支持阿里云 ECS），与本地「自动化任务」并存，一键切换，默认云端。

## 特性

- **独立入口**：侧栏「自动化任务」下方新增「云端任务」，不挤占官方页面。
- **每次先问**：创建自动化任务时先弹问题——云端服务器，还是本地 DSH 提醒；不预设立场、没有默认值。
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

打开侧栏「云端任务」，页面里是服务商行（阿里云 ECS + 状态点），点 **编辑** 展开：

- AccessKey ID / Secret 已保存时输入框留空，占位符显示「留空使用已保存凭据」；
- 保存后表单收起，只保留 `region · 实例 ID`；
- 右上角 **配置指南** 打开两栏说明：左栏是创建 RAM 用户 / 建策略 / 授权的步骤，右栏是可直接复制的 5 个动作的最小权限策略；
- 出现 `Forbidden.RAM` 等错误时，卡片会给出「重新配置」入口。

字段：

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

在对话里说「每天 9 点跑 daily-report」，模型会调用 `automation_create`，此时会先弹出问题让你选：**云端服务器** 还是 **本地 DSH 提醒**。选云端才会在服务器上生成脚本与 cron；选本地则转去创建 `schedule_*` 提醒。

工具：

| 工具 | 作用 |
| --- | --- |
| `automation_create` | 创建自动化任务的唯一入口，先询问云端/本地 |
| `cloud_task_list` | 列出云端任务与实时状态 |
| `cloud_task_run` | 立即触发 |
| `cloud_task_delete` | 删除任务并清理服务器文件 |
| `cloud_task_logs` | 查看日志 |

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
