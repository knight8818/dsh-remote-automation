/**
 * 云端任务模型与远端操作。
 *
 * 每个任务 = 服务器上的一个 shell 脚本 + 可选 cron 定时；
 * 状态通过云助手实时读取（pid + 日志尾部）。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { AliyunEcsClient } from './aliyun.js'
import { statePath, dataDir } from './config.js'

const ID_RE = /^t-[0-9a-f]{8}$/
const CRON_RE = /^[0-9*/,\-\s]+$/

export function validCron(expr) {
  if (typeof expr !== 'string') return false
  const trimmed = expr.trim()
  if (!trimmed || !CRON_RE.test(trimmed)) return false
  return trimmed.split(/\s+/).length === 5
}

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, `'\\''`) + "'"
}

/** 读取持久化状态（执行位置 + 任务列表）。 */
export function loadState() {
  try {
    const raw = JSON.parse(readFileSync(statePath(), 'utf8'))
    return {
      target: raw.target === 'local' ? 'local' : 'cloud',
      tasks: Array.isArray(raw.tasks) ? raw.tasks.filter((t) => ID_RE.test(t?.id || '')) : [],
    }
  } catch {
    return { target: 'cloud', tasks: [] }
  }
}

export function saveState(state) {
  const dir = dataDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmp = statePath() + '.tmp'
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
  renameSync(tmp, statePath())
}

function client(config) {
  return new AliyunEcsClient(config)
}

function scriptFor(task, serverDir) {
  const safeName = String(task.name).replace(/[^\w.\-]/g, '_')
  return [
    '#!/usr/bin/env bash',
    'export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    'set -uo pipefail',
    `mkdir -p ${serverDir}/logs ${serverDir}/state`,
    `echo $$ > ${serverDir}/state/${task.id}.pid`,
    `echo "[$(date -Is)] START ${safeName}"`,
    task.command,
    'rc=$?',
    `echo "[$(date -Is)] EXIT $rc"`,
    'exit $rc',
    '',
  ].join('\n')
}

async function writeScript(config, task) {
  const serverDir = config.serverDir
  const b64 = Buffer.from(scriptFor(task, serverDir), 'utf8').toString('base64')
  const result = await client(config).exec(
    `mkdir -p ${serverDir}/scripts ${serverDir}/logs ${serverDir}/state && ` +
      `printf '%s' '${b64}' | base64 -d > ${serverDir}/scripts/${task.id}.sh && ` +
      `chmod +x ${serverDir}/scripts/${task.id}.sh && echo ok`,
    { timeout: 60 },
  )
  if (result.exitCode !== 0) throw new Error(result.output || '写入服务器脚本失败')
}

async function syncCron(config, task) {
  const serverDir = config.serverDir
  const marker = `dsh-auto:${task.id}`
  const line = task.schedule
    ? `${task.schedule} ${serverDir}/scripts/${task.id}.sh >> ${serverDir}/logs/${task.id}.log 2>&1 # ${marker}`
    : ''
  const keep = `crontab -l 2>/dev/null | grep -v ${shellQuote(marker)} || true`
  const add = task.schedule ? `echo ${shellQuote(line)}` : 'true'
  const result = await client(config).exec(`( ${keep}; ${add} ) | crontab - && echo ok`, { timeout: 60 })
  if (result.exitCode !== 0) throw new Error(result.output || '更新 crontab 失败')
}

async function removeRemote(config, task) {
  const serverDir = config.serverDir
  const marker = `dsh-auto:${task.id}`
  await client(config).exec(
    `crontab -l 2>/dev/null | grep -v ${shellQuote(marker)} | crontab - || true; ` +
      `rm -f ${serverDir}/scripts/${task.id}.sh ${serverDir}/logs/${task.id}.log ${serverDir}/state/${task.id}.pid; echo ok`,
    { timeout: 60 },
  )
}

async function runRemote(config, task) {
  const serverDir = config.serverDir
  const result = await client(config).exec(
    `mkdir -p ${serverDir}/logs ${serverDir}/state && cd ${serverDir} && ` +
      `nohup setsid bash scripts/${task.id}.sh >> logs/${task.id}.log 2>&1 < /dev/null & ` +
      'sleep 0.4; echo started',
    { timeout: 60 },
  )
  if (result.exitCode !== 0) throw new Error(result.output || '启动任务失败')
}

async function readLogs(config, task, lines) {
  const serverDir = config.serverDir
  const count = Math.max(1, Math.min(Number(lines) || 100, 2000))
  const result = await client(config).exec(
    `tail -n ${count} ${serverDir}/logs/${task.id}.log 2>/dev/null || echo '(暂无日志)'`,
    { timeout: 60 },
  )
  return result.output
}

/** 一次查询所有任务状态：id|running|pid|lastExit|lastLogTime */
async function readStatuses(config, tasks) {
  if (tasks.length === 0) return {}
  const serverDir = config.serverDir
  const ids = tasks.map((t) => t.id).join(' ')
  const script = [
    `for id in ${ids}; do`,
    `  pid=$(cat ${serverDir}/state/$id.pid 2>/dev/null || true)`,
    '  running=0',
    '  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then running=1; fi',
    `  last=$(grep -o 'EXIT [0-9]*' ${serverDir}/logs/$id.log 2>/dev/null | tail -1 | cut -d' ' -f2)`,
    `  mt=$(stat -c %y ${serverDir}/logs/$id.log 2>/dev/null | cut -d. -f1)`,
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
  if (task.schedule) await syncCron(config, task)
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
