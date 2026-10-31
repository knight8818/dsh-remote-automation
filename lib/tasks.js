/**
 * 云端任务模型与远端操作。
 *
 * 每个任务 = 某台云服务器上的一个 shell 脚本 + 可选 cron 定时；
 * 状态通过云助手实时读取（pid + 日志尾部）。
 *
 * 任务记录自己的 `provider` 与 `serverDir`：以后切换云厂商或目录，
 * 老任务仍然按原来的位置查询/运行/删除。
 *
 * 所有拼进远端命令的路径都经过 validServerDir 校验并用单引号包裹，
 * 任务 id 由本地生成且只含 `[0-9a-f]`，因此不存在命令注入面。
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createClient } from './clients.js'
import { dataDir, statePath } from './config.js'
import { PROVIDER_IDS, providerMeta } from './providers.js'
import { validServerDir } from './validate.js'

const ID_RE = /^t-[0-9a-f]{8}$/
const CRON_RE = /^[0-9*/,\- \t]+$/

const CRON_FIELDS = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12 }, // month
  { min: 0, max: 7 }, // day of week (0 and 7 are both Sunday)
]

/** 单引号包裹，供 POSIX shell / crontab 使用。 */
export function shellQuote(value) {
  return "'" + String(value).replace(/'/g, `'\\''`) + "'"
}

function validCronField(field, { min, max }) {
  for (const part of field.split(',')) {
    if (!part) return false
    const match = /^(\*|\d+|\d+-\d+)(?:\/(\d+))?$/.exec(part)
    if (!match) return false
    const step = match[2] === undefined ? 1 : Number(match[2])
    if (!Number.isInteger(step) || step < 1) return false

    let lo
    let hi
    if (match[1] === '*') {
      lo = min
      hi = max
    } else if (match[1].includes('-')) {
      const [from, to] = match[1].split('-').map(Number)
      lo = from
      hi = to
    } else {
      lo = Number(match[1])
      hi = step > 1 ? max : lo
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) return false
    if (lo < min || hi > max || lo > hi) return false
  }
  return true
}

/** 校验 5 段 cron 表达式（字段值、范围、步长都检查）。 */
export function validCron(expr) {
  if (typeof expr !== 'string') return false
  const trimmed = expr.trim()
  if (!trimmed || trimmed.length > 120 || !CRON_RE.test(trimmed)) return false
  const fields = trimmed.split(/\s+/)
  if (fields.length !== 5) return false
  return fields.every((field, index) => validCronField(field, CRON_FIELDS[index]))
}

function taskProvider(runtime, task) {
  const id = task?.provider || runtime.provider
  if (!PROVIDER_IDS.includes(id)) throw new Error(`任务所属云厂商不合法：${id}`)
  return id
}

function clientFor(runtime, task) {
  const id = taskProvider(runtime, task)
  const state = runtime.state?.[id]
  if (state && !state.configured) {
    const label = providerMeta(id)?.label || id
    throw new Error(`任务属于「${label}」，但该厂商尚未配置完整（缺 ${state.missing.join(', ') || state.invalid.join(', ') || '字段'}）`)
  }
  const config = runtime.providers?.[id]
  if (!config) throw new Error(`缺少「${id}」的配置`)
  if (typeof runtime.clientFactory === 'function') return runtime.clientFactory(id, config, task)
  return createClient(id, config)
}

/**
 * 任务创建时记下自己的脚本目录。服务器目录后来改了也不影响老任务，
 * 否则旧 cron 还在跑、页面却按新目录查询（日志为空、删除失效）。
 */
export function taskDir(runtime, task) {
  const dir = task?.serverDir || runtime.serverDir
  if (!validServerDir(dir)) throw new Error('脚本目录不合法')
  return dir
}

/** 生成任务脚本。导出用于测试，调用前必须已校验 serverDir。 */
export function buildTaskScript(task, serverDir) {
  if (!validServerDir(serverDir)) throw new Error('脚本目录不合法')
  const safeName = String(task.name).replace(/[^\w.\-]/g, '_')
  const dir = shellQuote(serverDir)
  return [
    '#!/usr/bin/env bash',
    'export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    'set -uo pipefail',
    `mkdir -p ${dir}/logs ${dir}/state`,
    `echo $$ > ${dir}/state/${task.id}.pid`,
    `echo "[$(date -Is)] START ${safeName}"`,
    // 子 shell：用户命令里的 exit 只结束它自己，不会让我们丢失退出码。
    '(',
    task.command,
    ')',
    'rc=$?',
    `echo "[$(date -Is)] EXIT $rc"`,
    'exit $rc',
    '',
  ].join('\n')
}

async function writeScript(runtime, task) {
  const dir = shellQuote(taskDir(runtime, task))
  const b64 = Buffer.from(buildTaskScript(task, taskDir(runtime, task)), 'utf8').toString('base64')
  if (b64.length > 24 * 1024) throw new Error('脚本超过云 API 24 KB 上限，请拆分任务')
  const result = await clientFor(runtime, task).exec(
    `mkdir -p ${dir}/scripts ${dir}/logs ${dir}/state && ` +
      `printf '%s' '${b64}' | base64 -d > ${dir}/scripts/${task.id}.sh && ` +
      `chmod +x ${dir}/scripts/${task.id}.sh && echo ok`,
    { timeout: 60 },
  )
  if (result.exitCode !== 0) throw new Error(result.output || '写入服务器脚本失败')
}

async function syncCron(runtime, task) {
  const dir = shellQuote(taskDir(runtime, task))
  const marker = `dsh-auto:${task.id}`
  const line = task.schedule
    ? `${task.schedule} ${dir}/scripts/${task.id}.sh >> ${dir}/logs/${task.id}.log 2>&1 # ${marker}`
    : ''
  const keep = `crontab -l 2>/dev/null | grep -v ${shellQuote(marker)} || true`
  const add = task.schedule ? `echo ${shellQuote(line)}` : 'true'
  const result = await clientFor(runtime, task).exec(`( ${keep}; ${add} ) | crontab - && echo ok`, { timeout: 60 })
  if (result.exitCode !== 0) throw new Error(result.output || '更新 crontab 失败')
}

async function removeRemote(runtime, task) {
  const dir = shellQuote(taskDir(runtime, task))
  const marker = `dsh-auto:${task.id}`
  await clientFor(runtime, task).exec(
    // 原本没有 crontab 时不要凭空创建一个空的。
    `if crontab -l >/dev/null 2>&1; then crontab -l | grep -v ${shellQuote(marker)} | crontab - || true; fi; ` +
      `rm -f ${dir}/scripts/${task.id}.sh ${dir}/logs/${task.id}.log ${dir}/state/${task.id}.pid; echo ok`,
    { timeout: 60 },
  )
}

async function runRemote(runtime, task) {
  const dir = shellQuote(taskDir(runtime, task))
  const result = await clientFor(runtime, task).exec(
    `mkdir -p ${dir}/logs ${dir}/state && cd ${dir} && ` +
      `nohup setsid bash ${dir}/scripts/${task.id}.sh >> ${dir}/logs/${task.id}.log 2>&1 < /dev/null & ` +
      'sleep 0.4; echo started',
    { timeout: 60 },
  )
  if (result.exitCode !== 0) throw new Error(result.output || '启动任务失败')
}

async function readLogs(runtime, task, lines) {
  const dir = shellQuote(taskDir(runtime, task))
  const parsed = Number(lines)
  const count = Math.min(Math.max(Number.isFinite(parsed) ? Math.trunc(parsed) : 100, 1), 2000)
  const result = await clientFor(runtime, task).exec(
    `tail -n ${count} ${dir}/logs/${task.id}.log 2>/dev/null || echo '(暂无日志)'`,
    { timeout: 60 },
  )
  return result.output
}

/** 同一厂商的任务合并成一次远端查询：id|running|pid|lastExit|lastLogTime */
async function readProviderStatuses(runtime, tasks) {
  const specs = tasks.map((task) => shellQuote(`${task.id}|${taskDir(runtime, task)}`)).join(' ')
  const script = [
    `for spec in ${specs}; do`,
    '  id=${spec%%|*}',
    '  dir=${spec#*|}',
    '  pid=$(cat "$dir/state/$id.pid" 2>/dev/null || true)',
    '  running=0',
    '  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then running=1; fi',
    '  last=$(grep -o \'EXIT [0-9]*\' "$dir/logs/$id.log" 2>/dev/null | tail -1 | cut -d\' \' -f2)',
    '  mt=$(stat -c %y "$dir/logs/$id.log" 2>/dev/null | cut -d. -f1)',
    '  printf "%s|%s|%s|%s|%s\\n" "$id" "$running" "${pid:-}" "${last:-}" "${mt:-}"',
    'done',
  ].join('\n')
  const result = await clientFor(runtime, tasks[0]).exec(script, { timeout: 60 })
  const statuses = {}
  for (const line of result.output.split('\n')) {
    const [id, running, pid, lastExit, lastLogTime] = line.trim().split('|')
    if (!ID_RE.test(id || '')) continue
    statuses[id] = {
      state:
        running === '1'
          ? 'running'
          : lastExit === undefined || lastExit === ''
            ? 'idle'
            : Number(lastExit) === 0
              ? 'success'
              : 'failed',
      pid: pid || null,
      lastExit: lastExit === '' || lastExit === undefined ? null : Number(lastExit),
      lastLogTime: lastLogTime || null,
    }
  }
  return statuses
}

function sanitizeTask(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (!ID_RE.test(raw.id || '')) return null
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  const command = typeof raw.command === 'string' ? raw.command : ''
  if (!name || !command) return null
  const provider = PROVIDER_IDS.includes(raw.provider) ? raw.provider : 'aliyun'
  return {
    id: raw.id,
    name: name.slice(0, 120),
    command,
    schedule: validCron(raw.schedule) ? raw.schedule.trim() : null,
    provider,
    serverDir: validServerDir(raw.serverDir) ? raw.serverDir : null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : null,
  }
}

/** 读取持久化状态（任务列表）。损坏的条目会被丢弃而不是带进远端命令。 */
export function loadState() {
  try {
    const raw = JSON.parse(readFileSync(statePath(), 'utf8'))
    const tasks = Array.isArray(raw.tasks) ? raw.tasks.map(sanitizeTask).filter(Boolean) : []
    return { tasks }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      // 保留损坏的文件，避免下一次保存把用户的整个任务列表永久覆盖掉。
      try {
        renameSync(statePath(), `${statePath()}.bad-${Date.now()}`)
      } catch {
        // 备份失败也不能阻塞插件加载。
      }
    }
    return { tasks: [] }
  }
}

export function saveState(state) {
  const dir = dataDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = `${statePath()}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
  writeFileSync(tmp, JSON.stringify({ tasks: state.tasks }, null, 2), { encoding: 'utf8', mode: 0o600 })
  try {
    chmodSync(tmp, 0o600)
  } catch {
    // Windows 上没有 POSIX 权限位，忽略。
  }
  renameSync(tmp, statePath())
}

export function newTask({ name, command, schedule, provider, serverDir }) {
  return {
    id: 't-' + randomUUID().replace(/-/g, '').slice(0, 8),
    name: String(name).trim(),
    command: String(command).trim(),
    schedule: schedule ? String(schedule).trim() : null,
    provider: PROVIDER_IDS.includes(provider) ? provider : 'aliyun',
    serverDir: validServerDir(serverDir) ? serverDir : null,
    createdAt: new Date().toISOString(),
  }
}

export async function addTask(runtime, task) {
  await writeScript(runtime, task)
  if (task.schedule) {
    try {
      await syncCron(runtime, task)
    } catch (error) {
      // cron 写入失败时回滚脚本，避免留下无法触发的孤儿任务。
      try {
        await removeRemote(runtime, task)
      } catch {
        // 回滚失败不掩盖原始错误。
      }
      throw error
    }
  }
}

export async function deleteTask(runtime, task) {
  await removeRemote(runtime, task)
}

export async function runTask(runtime, task) {
  await runRemote(runtime, task)
}

export async function taskLogs(runtime, task, lines) {
  return readLogs(runtime, task, lines)
}

export async function taskStatuses(runtime, tasks) {
  if (tasks.length === 0) return {}
  const groups = new Map()
  for (const task of tasks) {
    const id = taskProvider(runtime, task)
    if (!groups.has(id)) groups.set(id, [])
    groups.get(id).push(task)
  }

  const statuses = {}
  for (const [providerId, group] of groups) {
    const state = runtime.state?.[providerId]
    if (state && !state.configured) {
      for (const task of group) statuses[task.id] = { state: 'unconfigured' }
      continue
    }
    try {
      Object.assign(statuses, await readProviderStatuses(runtime, group))
    } catch (error) {
      for (const task of group) statuses[task.id] = { state: 'error', error: error.message }
    }
  }
  return statuses
}

export { ID_RE }
