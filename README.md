# dsh-remote-automation

[English](README.md) | [简体中文](README.zh.md)

[![CI](https://github.com/knight8818/dsh-remote-automation/actions/workflows/ci.yml/badge.svg)](https://github.com/knight8818/dsh-remote-automation/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

**Run scheduled automation on a remote Aliyun ECS from DeepSeek Harness.**

A DSH bundle that adds a **Cloud Tasks** sidebar page and a small set of agent tools. Scripts run on your own ECS instance through Aliyun Cloud Assistant, so the instance needs **zero inbound ports** and keeps its security group closed. The local machine can be off.

> Status: Aliyun ECS is the only provider today. The `tasks` / `aliyun` module boundary is designed so another provider can be added without touching the UI.

## Features

- **Dedicated page**, not a hijacked built-in view: a `Cloud Tasks` entry under the sidebar, with live status, run now, logs and delete.
- **Asks every time**: creating an automation through `automation_create` always asks *cloud server* or *local DSH reminder* first. No default target.
- **Real status**, not a guess: running / idle / success / failed, last exit code, last log time, refreshed on open and while visible.
- **Zero inbound**: only outbound HTTPS to `ecs.<region>.aliyuncs.com` through Cloud Assistant. No SSH, no open ports.
- **Secrets stay local**: nothing is bundled in this repo; credentials come from the page or environment variables, and the API only ever returns a masked AccessKey ID.
- **Agent-friendly**: ships [`AGENTS.md`](AGENTS.md), so a DeepSeek agent that reads the repo knows exactly how to install, verify, upgrade and uninstall it.

## Requirements

| Requirement | Notes |
| --- | --- |
| DeepSeek Harness | `>= 0.2.0` (bundle patch + client plugin support) |
| Node.js | `>= 20` (host side uses only the standard library; zero runtime dependencies) |
| Aliyun ECS | An instance with Cloud Assistant online (public images include it) |
| Network | The instance can reach `ecs.<region>.aliyuncs.com:443` outbound |
| Git | Only for installing straight from GitHub |

The plugin needs a **Web profile** (the desktop app or `dsh web`): it registers a sidebar page and an HTTP route on the `webServer` service. Headless/SDK profiles do not compose that service and will not load it.

## Installation

### 1. Let your DeepSeek install it (recommended)

Paste this to the agent in DSH, together with the repository URL:

```text
Install the DSH plugin from https://github.com/knight8818/dsh-remote-automation.
Follow the repository's AGENTS.md: install it into my desktop profile, verify the
YAML layer and node --check, do not print any file under ~/.dsh/remote-automation,
and do not restart DSH — tell me when I should fully quit and relaunch it.
```

The agent reads [`AGENTS.md`](AGENTS.md), which contains the exact `dsh plugin` command, the manual fallback, verification steps and the safety rules.

### 2. One command

Install the `dsh` CLI once (or use `npx` for a one-shot):

```bash
npm install -g @deepseek-ai/dsh
dsh plugin --profile desktop add github:knight8818/dsh-remote-automation
```

The desktop app profile is usually `desktop`; `dsh web` uses `web`. If your profile has another name, use it. On first use `dsh plugin` initializes a missing profile.

Without a global install:

```bash
npx --yes @deepseek-ai/dsh@latest plugin --profile desktop add github:knight8818/dsh-remote-automation
```

The command adds the package to the profile and appends its bundle layer automatically, because the package declares `dsh.bundle.patch`. No YAML editing, no copying files.

Verify the layer without booting:

```bash
dsh --profile desktop --dump-config | grep dsh-remote-automation
```

(PowerShell: `dsh --profile desktop --dump-config | Select-String dsh-remote-automation`.)

### 3. Manual fallback (offline / no pnpm)

```bash
git clone https://github.com/knight8818/dsh-remote-automation
# stop if the target already exists — do not nest a second copy inside it
test -e ~/.dsh/profiles/node_modules/dsh-remote-automation \
  && echo "already installed: remove or back it up first" \
  || cp -r dsh-remote-automation ~/.dsh/profiles/node_modules/dsh-remote-automation
```

Windows PowerShell:

```powershell
git clone https://github.com/knight8818/dsh-remote-automation
$dst = "$env:USERPROFILE\.dsh\profiles\node_modules\dsh-remote-automation"
if (Test-Path $dst) { throw "already installed: $dst" }
Copy-Item -Recurse .\dsh-remote-automation $dst
```

Then append to `~/.dsh/profiles/desktop/cordis.patch.yml` — only if an entry with `id: remote-automation` is not already present:

```yaml
- insert:
    - id: remote-automation
      name: dsh-remote-automation
```

On Windows the paths are `%USERPROFILE%\.dsh\profiles\node_modules\` and `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml`.

After either method, **fully quit DSH** (tray icon included, not just the window) and start it again. A window reload is not enough for the host part.

### Upgrading from a manual `0.1.x` install

Remove the old copy (`~/.dsh/profiles/node_modules/dsh-remote-automation`) and the three-line
`- insert:` block from the profile's `cordis.patch.yml` first, then use the one-command
install above. Keeping both registers `id: remote-automation` twice.

## Configure

Open **Cloud Tasks** in the sidebar, click **Edit**, and fill in:

| Field | Description |
| --- | --- |
| AccessKey ID / Secret | A RAM user, ideally scoped to the five actions below |
| Region | e.g. `cn-shenzhen` |
| Instance ID | e.g. `i-xxxxxxxxxxxxxxxx` |
| Script directory | default `/opt/automation` |

Saved secrets are never sent back to the page; the field shows a placeholder and stays blank. Saving with a blank secret keeps the stored one.

Environment variables override the file (`DSH_RA_AK_ID`, `DSH_RA_AK_SECRET`, `DSH_RA_REGION`, `DSH_RA_INSTANCE_ID`, `DSH_RA_SERVER_DIR`). The config file lives at `$DSH_HOME/remote-automation/config.json` (default `~/.dsh/remote-automation/config.json`) and is written with mode `0600` where the platform supports it.

### RAM policy (least privilege)

Create a custom policy with exactly these actions and attach it to the RAM user:

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

It cannot delete instances, change security groups, disks or networks.

## Usage

Say something like:

```text
Every day at 09:00, run my daily-report script on the cloud server.
```

`automation_create` asks **cloud** or **local** first. Cloud writes a script and an optional cron entry on the server; local hands off to `schedule_*` so DSH reminds you in-session.

Tools:

| Tool | Purpose |
| --- | --- |
| `automation_create` | The only creation entry point; asks cloud vs local first |
| `cloud_task_list` | List tasks with live status (one Cloud Assistant query) |
| `cloud_task_run` | Trigger a task now |
| `cloud_task_logs` | Tail the task log |
| `cloud_task_delete` | Remove script, cron entry and log |

## Security model

- **No secrets in the repo or in git history.** Configuration is read from the environment or a local file written at runtime.
- The local HTTP surface (`/dsh-remote-automation/*`) requires a per-process random token injected only into the authenticated page; comparison is constant-time.
- The page receives a masked AccessKey ID only. The secret is never returned, logged or rendered.
- Commands run through Cloud Assistant; there is no inbound listener on the instance.
- Task state (`state.json`) stores the commands you asked to run, so treat it like shell history; it is written `0600`.
- The plugin sends no telemetry.

See [`SECURITY.md`](SECURITY.md) for reporting a vulnerability.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `dsh: command not found` | Use the `npx` form, or `npm install -g @deepseek-ai/dsh` |
| Sidebar entry does not appear | Fully quit DSH including the tray process, then relaunch |
| "Plugin is not configured" | Fill the page, or set the `DSH_RA_*` variables |
| `Forbidden.RAM` | Attach the policy above to the RAM user |
| Cloud Assistant offline | Start/install the Cloud Assistant agent on the instance |
| `id: remote-automation` appears twice | You installed both the bundle and the manual patch — remove one |
| Logs are empty right after "Run" | The process just started; refresh in a few seconds |

## Uninstall

```bash
dsh plugin --profile desktop remove dsh-remote-automation
```

For a manual install, delete `~/.dsh/profiles/node_modules/dsh-remote-automation` and remove the three-line `- insert:` block from the profile's `cordis.patch.yml`. Your credentials in `~/.dsh/remote-automation/` are kept; delete that folder yourself if you want them gone.

## Development

```bash
npm install          # dev dependency: yaml, for tests only
npm run check        # node --check on every runtime file
npm test             # node:test
```

Layout:

```
lib/host.js      host plugin: tools + HTTP routes + page token
lib/client.js    browser plugin: sidebar page (prebuilt, lazy-CJS module format)
lib/tasks.js     task model + remote script/cron/log operations
lib/aliyun.js    ECS Cloud Assistant RPC client (HMAC-SHA1, zero deps)
lib/config.js    config resolution + masking
lib/validate.js  input validation shared by config, tasks and HTTP
cordis.patch.yml bundle layer (inserts the plugin row)
```

`lib/client.js` is a hand-written artifact in the DSH client module format (`window.__ModuleLoader__.load`), not a build output. There are no runtime dependencies, so an installed copy does not need `npm install`.

## License

[MIT](LICENSE)
