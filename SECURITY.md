# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| `0.2.x` | Yes |
| `0.1.x` | No |

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Use GitHub's private vulnerability reporting:
<https://github.com/knight8818/dsh-remote-automation/security/advisories/new>

Include the affected version, a minimal reproduction, and the impact. You should get an
initial response within a few days. Please give us a reasonable window to release a fix
before publishing details.

Never include real AccessKey IDs, secrets, instance IDs or logs that contain credentials in a
report. Redact them.

## Design notes

- The repository and its git history contain **no credentials**. Configuration is read from
  `DSH_RA_*` environment variables or `$DSH_HOME/remote-automation/config.json` at runtime.
- The config file is written with mode `0600` on platforms that support POSIX permissions.
- The local HTTP surface (`/dsh-remote-automation/*`) requires a random per-process token
  injected into the authenticated DSH page; token comparison is constant-time.
- The page never receives the AccessKey secret; only a masked ID is returned.
- Remote execution uses Aliyun Cloud Assistant over outbound HTTPS. The plugin never opens an
  inbound port and never stores an SSH key.
- Task state (`state.json`) contains the shell commands the user asked to run. Treat it like
  shell history and protect the file accordingly.
- No telemetry is collected or sent.

## Scope

In scope: command injection through task names, schedules, region, instance ID or server
directory; authentication bypass of the local HTTP routes; secret disclosure through the API,
logs or error messages; path traversal in server-side file operations.

Out of scope: an attacker who already controls the local machine or the user's Aliyun account;
misconfiguration of the instance's security group; vulnerabilities in Aliyun's service itself.
