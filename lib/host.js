/**
 * dsh-remote-automation —— 宿主插件。
 *
 * - `automation_create` 是创建自动化任务的唯一入口：先弹问题让用户选云端还是本地；
 * - `cloud_task_*` 负责云端任务的列表、运行、日志、删除；
 * - `/dsh-remote-automation/*` 供页面客户端插件使用（每个进程一个随机令牌）。
 *
 * 不设置默认执行位置，也不在系统提示里预设立场。
 */

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { loadConfig, publicConfig, saveConfig, configPatchErrors } from './config.js'
import {
  ID_RE,
  addTask,
  deleteTask,
  loadState,
  newTask,
  runTask,
  saveState,
  taskLogs,
  taskStatuses,
  validCron,
} from './tasks.js'
import {
  MAX_TASKS,
  TASK_COMMAND_MAX,
  normalizeTaskCommand,
  normalizeTaskName,
} from './validate.js'

export const name = 'remote-automation'
export const inject = ['tools', 'webServer']

/** 运行期句柄（诊断/测试用；避免 apply 返回值被误当清理函数）。 */
export const runtime = {}

const ROUTE_PREFIX = '/dsh-remote-automation'
const MAX_BODY = 1_000_000

function requireConfig() {
  const { configured, missing, invalid } = loadConfig()
  if (!configured) {
    const problems = []
    if (missing.length) problems.push(`缺少 ${missing.join(', ')}`)
    if (invalid.length) problems.push(`格式不合法 ${invalid.join(', ')}`)
    throw new Error(
      `插件尚未配置（${problems.join('；')}）。请在「云端任务」页面填写，或设置环境变量 ` +
        'DSH_RA_AK_ID / DSH_RA_AK_SECRET / DSH_RA_REGION / DSH_RA_INSTANCE_ID。',
    )
  }
  return loadConfig()
}

function describeTasks(state, statuses) {
  if (state.tasks.length === 0) return '云端还没有自动化任务。'
  const lines = []
  for (const task of state.tasks) {
    const status = statuses[task.id]
    lines.push(
      `- ${task.id}  ${task.name}${task.schedule ? `  [${task.schedule}]` : '  [手动]'}` +
        `  状态=${status?.state ?? 'unknown'}  上次退出=${status?.lastExit ?? 'n/a'}`,
    )
  }
  return lines.join('\n')
}

/**
 * 询问用户这个任务跑云端还是本地。
 * 依赖 dsh-user-questions 服务，失败时抛错（而不是替用户默认）。
 */
async function askTarget(ctx, exec, taskName) {
  const service = ctx.get?.('userQuestions')
  if (!service?.ask) throw new Error('当前环境没有可用的用户提问服务，无法确认执行位置')
  const answer = await service.ask({
    questions: [
      {
        id: 'target',
        header: '执行位置',
        question: `自动化任务「${taskName}」跑在哪里？`,
        detail: '云端：脚本在服务器上按 cron 执行，本机关机也会跑。本地：由 DSH 在会话里定时提醒，需要本机 DSH 在运行。',
        options: [
          { label: '云端（服务器）', description: '不依赖本机开机，适合抓取、同步、备份等' },
          { label: '本地（DSH 提醒）', description: '只在本机 DSH 运行时触发' },
        ],
      },
    ],
    agent: exec.agent,
    signal: exec.signal,
  })
  const first = answer?.answers?.[0]
  const picked = (first?.selected && first.selected[0]) || first?.custom || ''
  if (picked.includes('本地')) return 'local'
  if (picked.includes('云端')) return 'cloud'
  throw new Error('没有识别到执行位置的选择')
}

/** 解析并校验创建任务的入参，返回 {error} 或 {name, command, schedule}。 */
function parseTaskInput(body) {
  const taskName = normalizeTaskName(body?.name)
  if (!taskName) return { error: 'name 不合法（1-80 个字符，不能包含控制字符）' }

  const command = normalizeTaskCommand(body?.command)
  if (!command) return { error: `command 不能为空，且不能超过 ${Math.round(TASK_COMMAND_MAX / 1024)} KB` }

  const rawSchedule = body?.schedule
  const schedule = rawSchedule === undefined || rawSchedule === null || rawSchedule === '' ? null : String(rawSchedule).trim()
  if (schedule && !validCron(schedule)) return { error: 'schedule 不是合法的 5 段 cron 表达式' }

  return { name: taskName, command, schedule }
}

export function apply(ctx) {
  const state = loadState()
  const token = randomUUID()
  const tokenDigest = createHash('sha256').update(token).digest()
  runtime.token = token

  ctx.logger?.info?.(`remote-automation: 已加载（tasks=${state.tasks.length}）`)

  // ---- 工具 -------------------------------------------------------------

  const textTool = (toolName, description, parameters, handler) => {
    try {
      ctx.tools.register(
        defineTool({
          name: toolName,
          description,
          parameters,
          output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: value }],
          },
          async execute(args, exec) {
            try {
              return await handler(args, exec)
            } catch (error) {
              return `错误：${error.message}`
            }
          },
        }),
      )
    } catch (error) {
      ctx.logger?.warn?.(`remote-automation: 注册工具 ${toolName} 失败：${error.message}`)
    }
  }

  textTool(
    'automation_create',
    '创建自动化任务的唯一入口。调用后会弹问题让用户选择：跑在云端服务器，还是用本地 DSH 定时提醒。不要绕过它直接创建任务。云端执行需要用户先在「云端任务」页面配置阿里云凭证。',
    {
      name: { type: 'string', required: true, description: '任务名，用于识别，如 daily-report' },
      command: { type: 'string', required: true, description: '云端执行时在服务器上运行的 shell 命令/脚本内容' },
      schedule: { type: 'string', description: '可选 5 段 cron 表达式，如 "0 9 * * *"；用户选择本地时忽略' },
    },
    async (args, exec) => {
      const input = parseTaskInput(args)
      if (input.error) return `错误：${input.error}`
      if (state.tasks.length >= MAX_TASKS) return `错误：云端任务已达上限（${MAX_TASKS} 个）`

      const choice = await askTarget(ctx, exec, input.name)

      if (choice === 'local') {
        return (
          `用户选择「本地」。请改用 schedule_create 创建本地定时提醒，沿用用户原始的时间要求（不要用云端 cron）。` +
          `任务名：${input.name}。`
        )
      }

      const { config } = requireConfig()
      const task = newTask(input)
      await addTask(config, task)
      state.tasks.push(task)
      saveState(state)
      return `用户选择「云端」，已创建任务 ${task.id}（${task.name}）${task.schedule ? '，cron=' + task.schedule : '，仅手动触发'}`
    },
  )

  textTool(
    'cloud_task_list',
    '列出云端自动化任务及实时状态（会触发一次服务器查询，约 2 秒）。',
    {},
    async () => {
      const { config } = requireConfig()
      const statuses = await taskStatuses(config, state.tasks)
      return describeTasks(state, statuses)
    },
  )

  textTool(
    'cloud_task_run',
    '立即在云端服务器触发一个自动化任务。',
    { id: { type: 'string', required: true, description: '任务 id，如 t-1a2b3c4d' } },
    async (args) => {
      const { config } = requireConfig()
      const task = state.tasks.find((t) => t.id === args.id)
      if (!task) return `错误：找不到任务 ${args.id}`
      await runTask(config, task)
      return `已触发 ${task.id}（${task.name}）`
    },
  )

  textTool(
    'cloud_task_delete',
    '删除云端自动化任务（脚本、cron 条目、日志一并清理）。',
    { id: { type: 'string', required: true, description: '任务 id' } },
    async (args) => {
      const { config } = requireConfig()
      const task = state.tasks.find((t) => t.id === args.id)
      if (!task) return `错误：找不到任务 ${args.id}`
      await deleteTask(config, task)
      state.tasks = state.tasks.filter((t) => t.id !== task.id)
      saveState(state)
      return `已删除 ${task.id}（${task.name}）`
    },
  )

  textTool(
    'cloud_task_logs',
    '查看云端任务的运行日志。',
    {
      id: { type: 'string', required: true, description: '任务 id' },
      lines: { type: 'number', description: '返回最后多少行，默认 100，最多 2000' },
    },
    async (args) => {
      const { config } = requireConfig()
      const task = state.tasks.find((t) => t.id === args.id)
      if (!task) return `错误：找不到任务 ${args.id}`
      const output = await taskLogs(config, task, args.lines)
      return output || '(暂无日志)'
    },
  )

  // ---- HTTP 接口 --------------------------------------------------------

  const webServer = ctx.get?.('webServer')
  if (!webServer?.register) return

  const send = (res, status, payload) => {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify(payload))
  }

  const readJson = (req) =>
    new Promise((resolve, reject) => {
      let size = 0
      const chunks = []
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > MAX_BODY) {
          reject(new Error('请求体过大'))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        if (!chunks.length) return resolve({})
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch {
          reject(new Error('JSON 解析失败'))
        }
      })
      req.on('error', reject)
    })

  const authorized = (req) => {
    const header = req.headers['x-dsh-ra-token']
    if (typeof header !== 'string') return false
    const digest = createHash('sha256').update(header).digest()
    return timingSafeEqual(digest, tokenDigest)
  }

  const handler = async (req, res) => {
    try {
      if (!authorized(req)) {
        return send(res, 401, { error: 'unauthorized' })
      }
      const url = new URL(req.url, 'http://127.0.0.1')
      const path = url.pathname.slice(ROUTE_PREFIX.length) || '/'
      const method = req.method || 'GET'

      if (method === 'GET' && path === '/state') {
        const pub = publicConfig()
        let statuses = {}
        let error = ''
        if (state.tasks.length > 0 && pub.configured) {
          try {
            statuses = await taskStatuses(requireConfig().config, state.tasks)
          } catch (e) {
            error = e.message
          }
        }
        return send(res, 200, {
          configured: pub.configured,
          config: pub,
          tasks: state.tasks.map((task) => ({ ...task, status: statuses[task.id] || null })),
          error,
        })
      }

      if (method === 'POST' && path === '/config') {
        const body = await readJson(req)
        const patch = {}
        for (const key of ['accessKeyId', 'accessKeySecret', 'region', 'instanceId', 'serverDir']) {
          const value = body?.[key]
          if (value === null) patch[key] = null
          else if (typeof value === 'string' && value.trim()) patch[key] = value.trim()
        }
        const errors = configPatchErrors(patch)
        if (errors.length) {
          return send(res, 400, { error: `配置格式不合法：${errors.join(', ')}`, fields: errors })
        }
        saveConfig(patch)
        return send(res, 200, publicConfig())
      }

      if (method === 'POST' && path === '/tasks') {
        if (state.tasks.length >= MAX_TASKS) {
          return send(res, 400, { error: `云端任务已达上限（${MAX_TASKS} 个）` })
        }
        const input = parseTaskInput(await readJson(req))
        if (input.error) return send(res, 400, { error: input.error })
        const { config } = requireConfig()
        const task = newTask(input)
        await addTask(config, task)
        state.tasks.push(task)
        saveState(state)
        return send(res, 200, { task })
      }

      const match = path.match(/^\/tasks\/([^/]+)\/(run|delete|logs)$/)
      if (match && ID_RE.test(match[1])) {
        const task = state.tasks.find((t) => t.id === match[1])
        if (!task) return send(res, 404, { error: '任务不存在' })
        const { config } = requireConfig()
        if (match[2] === 'run' && method === 'POST') {
          await runTask(config, task)
          return send(res, 200, { ok: true })
        }
        if (match[2] === 'delete' && method === 'POST') {
          // 先清远端，成功后再改本地列表：失败时任务仍可重试删除。
          await deleteTask(config, task)
          state.tasks = state.tasks.filter((t) => t.id !== task.id)
          saveState(state)
          return send(res, 200, { ok: true })
        }
        if (match[2] === 'logs' && method === 'GET') {
          const lines = url.searchParams.get('lines') ?? 200
          const output = await taskLogs(config, task, lines)
          return send(res, 200, { id: task.id, log: output })
        }
      }

      return send(res, 404, { error: 'not found' })
    } catch (error) {
      ctx.logger?.warn?.(`remote-automation: ${error.stack || error.message}`)
      return send(res, 500, { error: error.message })
    }
  }

  try {
    const dispose = webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler })
    ctx.on?.('dispose', () => dispose())
  } catch (error) {
    ctx.logger?.warn?.(`remote-automation: 注册 HTTP 路由失败：${error.message}`)
  }

  // 页面内客户端插件读取的一次性令牌
  try {
    ctx.on?.('webserver/index-inject', (table) => {
      table.push({ kind: 'global', name: '__DSH_REMOTE_AUTOMATION__', value: { token } })
    })
  } catch (error) {
    ctx.logger?.warn?.(`remote-automation: 注入页面令牌失败：${error.message}`)
  }
}
