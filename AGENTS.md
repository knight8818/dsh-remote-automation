# AGENTS.md — install & maintain dsh-remote-automation

This file is written for a coding agent (DeepSeek, or any DSH agent) that has been asked to
install, update, verify or remove this plugin. Follow it literally. The plugin is a **DSH
bundle**: a package with `dsh.bundle.patch`, a host half (`lib/host.js`), a prebuilt browser
half (`lib/client.js`) and a bundle layer (`cordis.patch.yml`).

Repository: <https://github.com/knight8818/dsh-remote-automation>

## Non-negotiable rules

1. **Never print, copy, diff or commit** anything under `<DSH_HOME>/remote-automation/`
   (`config.json`, `state.json`). They contain the user's Aliyun AccessKey and their shell
   commands. If you must check existence, use a boolean, never the contents.
2. **Never add credentials** to the repo, to `cordis.patch.yml`, to issues or to chat.
3. **Never start, restart or kill DSH** on your own. After installing, tell the user to
   *fully quit* DSH (tray included) and relaunch it, then verify afterwards if asked.
4. **Never edit the repository's source** to make an install work; install the package as-is.
   If the package is broken, report the error instead of patching around it.
5. **Confirm before destructive actions**: removing an existing install, deleting
   `~/.dsh/remote-automation/`, deleting server tasks.
6. Prefer the official CLI path below; use the manual path only when `dsh plugin` is
   unavailable (offline, no pnpm, locked-down machine).

## 1. Detect the target profile

- `DSH_HOME` defaults to `~/.dsh` on every OS.
- Profiles live in `<DSH_HOME>/profiles/<name>` and contain `package.json` (with
  `dsh.profile.bundles`) and `cordis.patch.yml`.
- The desktop app profile is normally `desktop`; `dsh web` uses `web`.
- If exactly one profile exists, use it. If several exist, use `desktop` when it exists,
  otherwise ask the user which profile they run.

Check whether the plugin is already installed:

```bash
dsh plugin --profile <name> why dsh-remote-automation
```

or inspect the profile's `package.json` `dsh.profile.bundles` for `dsh-remote-automation`
(boolean check only). If present and the user wants an update, use `update` (below); do not
append a second layer.

## 2. Install (preferred, one command)

```bash
dsh plugin --profile <name> add github:knight8818/dsh-remote-automation
```

If `dsh` is not on `PATH`, use:

```bash
npx --yes @deepseek-ai/dsh@latest plugin --profile <name> add github:knight8818/dsh-remote-automation
```

What this does: pnpm installs the package into the profile and, because the package declares
`dsh.bundle.patch`, `dsh plugin` appends `dsh-remote-automation` to `dsh.profile.bundles`.
Do **not** edit `cordis.patch.yml` in this path — the bundle layer is applied automatically
and a manual duplicate would register `id: remote-automation` twice.

## 3. Manual fallback

Only if the CLI path is impossible:

1. Copy the checkout to `<DSH_HOME>/profiles/node_modules/dsh-remote-automation`
   (the directory must not already exist; back it up or stop if it does).
2. Read `<profile>/cordis.patch.yml`. **If the text already contains
   `remote-automation`, stop** — do not append.
3. Append exactly this LF-terminated block (preserve the file's existing newline style):

   ```yaml
   - insert:
       - id: remote-automation
         name: dsh-remote-automation
   ```

4. Back up the file before editing (e.g. `cordis.patch.yml.bak-<timestamp>`), then re-read the
   file and confirm there is exactly one `id: remote-automation`.

## 4. Verify before asking for a restart

Run all of these and report the results:

```bash
# 1. syntax of the shipped host and browser halves
node --check <install-dir>/lib/host.js
node --check <install-dir>/lib/client.js
```

For a CLI/bundle install, verify the effective composition without booting a server:

```bash
dsh --profile <name> --dump-config | grep -c 'dsh-remote-automation'
```

Expect `1` (the layer header plus its row are counted once). Do not print the whole dumped
config if it may contain other users' settings; grep only. PowerShell:
`dsh --profile <name> --dump-config | Select-String dsh-remote-automation`.

For a manual install, read the profile's `cordis.patch.yml` and confirm exactly one
`id: remote-automation` and one `name: dsh-remote-automation`; the bundled
`<install-dir>/cordis.patch.yml` must contain the same single row.

Credential file safety check — existence only:

```bash
test -f "<DSH_HOME>/remote-automation/config.json" && echo present || echo absent
```

If it is present, never overwrite it. Installing this plugin must not create or modify it.

## 5. Tell the user

Report:

- what was installed (package name, version, profile),
- which method was used (bundle vs manual) and the resulting line/entry,
- that they must **fully quit DSH and relaunch** (window reload is not enough),
- what they should see afterwards: a **Cloud Tasks** entry in the sidebar, and the
  `automation_create` / `cloud_task_*` tools,
- that configuration happens in the page (RAM AccessKey, region, instance ID) or through
  `DSH_RA_*` environment variables, and that secrets are stored locally only.

Do not restart DSH for them. Do not configure credentials for them unless they explicitly ask
and provide them through a safe channel (never paste secrets into chat logs).

## 6. Update

```bash
dsh plugin --profile <name> update dsh-remote-automation
```

or `add` the same spec again if the CLI version has no `update`. After updating, re-run the
verification in section 4 and ask for a restart if the host half changed.

## 7. Uninstall

```bash
dsh plugin --profile <name> remove dsh-remote-automation
```

Manual install: delete `<DSH_HOME>/profiles/node_modules/dsh-remote-automation` and remove the
three-line `- insert:` block that contains `id: remote-automation` from the profile's
`cordis.patch.yml`. Do not delete `<DSH_HOME>/remote-automation/` without explicit user
confirmation — it holds their credentials.

## 8. Development (only when asked to change the plugin)

```bash
npm install     # dev-only dependency: yaml (tests)
npm run check   # node --check on every runtime file
npm test        # node:test
```

- Runtime code is dependency-free. Do not add runtime dependencies without a strong reason.
- `lib/client.js` is hand-written in the DSH lazy-CJS module format
  (`window.__ModuleLoader__.load({ id, factory })`); it is not built. Keep it valid with
  `node --check`.
- Any value interpolated into a remote shell command must be validated with `lib/validate.js`
  and quoted with `shellQuote` from `lib/tasks.js`.
- Keep the repo free of credentials, personal paths, instance IDs and emails.

## 9. Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| `dsh: command not found` | Use the `npx` form; or `npm install -g @deepseek-ai/dsh` |
| `ERR_PNPM_...` during add | Git missing, offline, or proxy; fall back to manual install |
| `engines.dsh` mismatch | The running DSH is older than the bundle supports; upgrade DSH |
| Sidebar entry missing | DSH was only reloaded, not fully restarted (tray process) |
| Duplicate `id: remote-automation` | Bundle plus manual layer; remove one |
| `unauthorized` in the page | The page token was not injected; full restart |
| `插件尚未配置` | No credentials yet; use the page or `DSH_RA_*` |
