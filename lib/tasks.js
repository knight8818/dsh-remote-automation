/**
 * 云端任务模型与远端操作。
 *
 * 每个任务 = 服务器上的一个 shell 脚本 + 可选 cron 定时；
 * 状态通过云助手实时读取（pid + 日志尾部）。
 *
 * 所有拼进远端命令的路径都经过 {@link validServerDir} 校验并用单引号包裹，
 * 任务 id 由本地生成且只含 `[0-9a-f]`，因此不存在命令注入面。
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { AliyunEcsClient } from './aliyun.js'
import { dataDir, statePath } from './config.js'
import { validServerDir } from './validate.js'

const ID_RE = /^t-[0-9a-f]{8}$/
const CRON_RE = /^[0-9*/,\-\s]+$/

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

function client(config) {
  return new AliyunEcsClient(config)
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
    task.command,
    'rc=$?',
    `echo "[$(date -Is)] EXIT $rc"`,
    'exit $rc',
    '',
  ].join('\n')
}

async function writeScript(config, task) {
  if (!validServerDir(config.serverDir)) throw new Error('脚本目录不合法')
  const dir = shellQuote(config.serverDir)
  const b64 = Buffer.from(buildTaskScript(task, config.serverDir), 'utf8').toString('base64')
  const result = await client(config).exec(
    `mkdir -p ${dir}/scripts ${dir}/logs ${dir}/state && ` +
      `printf '%s' '${b64}' | base64 -d > ${dir}/scripts/${task.id}.sh && ` +
      `chmod +x ${dir}/scripts/${task.id}.sh && echo ok`,
    { timeout: 60 },
  )
  if (result.exitCode !== 0) throw new Error(result.output || '写入服务器脚本失败')
}

async function syncCron(config, task) {
  if (!validServerDir(config.serverDir)) throw new Error('脚本目录不合法')
  const dir = shellQuote(config.serverDir)
  const marker = `dsh-auto:${task.id}`
  const line = task.schedule
    ? `${task.schedule} ${dir}/scripts/${task.id}.sh >> ${dir}/logs/${task.id}.log 2>&1 # ${marker}`
    : ''
  const keep = `crontab -l 2>/dev/null | grep -v ${shellQuote(marker)} || true`
  const add = task.schedule ? `echo ${shellQuote(line)}` : 'true'
  const result = await client(config).exec(`( ${keep}; ${add} ) | crontab - && echo ok`, { timeout: 60 })
  if (result.exitCode !== 0) throw new Error(result.output || '更新 crontab 失败')
}

async function removeRemote(config, task) {
  if (!validServerDir(config.serverDir)) throw new Error('脚本目录不合法')
  const dir = shellQuote(config.serverDir)
  const marker = `dsh-auto:${task.id}`
  await client(config).exec(
    `crontab -l 2>/dev/null | grep -v ${shellQuote(marker)} | crontab - || true; ` +
      `rm -f ${dir}/scripts/${task.id}.sh ${dir}/logs/${task.id}.log ${dir}/state/${task.id}.pid; echo ok`,
    { timeout: 60 },
  )
}

async function runRemote(config, task) {
  if (!validServerDir(config.serverDir)) throw new Error('脚本目录不合法')
  const dir = shellQuote(config.serverDir)
  const result = await client(config).exec(
    `mkdir -p ${dir}/logs ${dir}/state && cd ${dir} && ` +
      `nohup setsid bash ${dir}/scripts/${task.id}.sh >> ${dir}/logs/${task.id}.log 2>&1 < /dev/null & ` +
      'sleep 0.4; echo started',
    { timeout: 60 },
  )
  if (result.exitCode !== 0) throw new Error(result.output || '启动任务失败')
}

async function readLogs(config, task, lines) {
  if (!validServerDir(config.serverDir)) throw new Error('脚本目录不合法')
  const dir = shellQuote(config.serverDir)
  const parsed = Number(lines)
  const count = Math.min(Math.max(Number.isFinite(parsed) ? Math.trunc(parsed) : 100, 1), 2000)
  const result = await client(config).exec(
    `tail -n ${count} ${dir}/logs/${task.id}.log 2>/dev/null || echo '(暂无日志)'`,
    { timeout: 60 },
  )
  return result.output
}

/** 一次查询所有任务状态：id|running|pid|lastExit|lastLogTime */
async function readStatuses(config, tasks) {
  if (tasks.length === 0) return {}
  if (!validServerDir(config.serverDir)) throw new Error('脚本目录不合法')
  const dir = shellQuote(config.serverDir)
  const ids = tasks.map((t) => t.id).join(' ')
  const script = [
    `for id in ${ids}; do`,
    `  pid=$(cat ${dir}/state/$id.pid 2>/dev/null || true)`,
    '  running=0',
    '  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then running=1; fi',
    `  last=$(grep -o 'EXIT [0-9]*' ${dir}/logs/$id.log 2>/dev/null | tail -1 | cut -d' ' -f2)`,
    `  mt=$(stat -c %y ${dir}/logs/$id.log 2>/dev/null | cut -d. -f1)`,
    '  printf "%s|%s|%s|%s|%s\\n" "$id" "$running" "${pid:-}" "${last:-}" "${mt:-}"',
    'done',
  ].join('\n')
  const result = await client(config).exec(script, { timeout: 60 })
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
  return {
    id: raw.id,
    name: name.slice(0, 120),
    command,
    schedule: validCron(raw.schedule) ? raw.schedule.trim() : null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : null,
  }
}

/** 读取持久化状态（任务列表）。损坏的条目会被丢弃而不是带进远端命令。 */
export function loadState() {
  try {
    const raw = JSON.parse(readFileSync(statePath(), 'utf8'))
    const tasks = Array.isArray(raw.tasks) ? raw.tasks.map(sanitizeTask).filter(Boolean) : []
    return { tasks }
  } catch {
    return { tasks: [] }
  }
}

export function saveState(state) {
  const dir = dataDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmp = statePath() + '.tmp'
  writeFileSync(tmp, JSON.stringify({ tasks: state.tasks }, null, 2), 'utf8')
  renameSync(tmp, statePath())
  try {
    chmodSync(statePath(), 0o600)
  } catch {
    // Windows 上没有 POSIX 权限位，忽略。
  }
}

export function newTask({ name, command, schedule }) {
  return {
    id: 't-' + randomUUID().replace(/-/g, '').slice(0, 8),
    name: String(name).trim(),
    command: String(command).trim(),
    schedule: schedule ? String(schedule).trim() : null,
    createdAt: new Date().toISOString(),
  }
}

export async function addTask(config, task) {
  await writeScript(config, task)
  if (task.schedule) {
    try {
      await syncCron(config, task)
    } catch (error) {
      // cron 写入失败时回滚脚本，避免留下无法触发的孤儿任务。
      try {
        await removeRemote(config, task)
      } catch {
        // 回滚失败不掩盖原始错误。
      }
      throw error
    }
  }
}

export async function deleteTask(config, task) {
  await removeRemote(config, task)
}

export async function runTask(config, task) {
  await runRemote(config, task)
}

export async function taskLogs(config, task, lines) {
  return readLogs(config, task, lines)
}

export async function taskStatuses(config, tasks) {
  return readStatuses(config, tasks)
}

export { ID_RE }
