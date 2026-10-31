/**
 * dsh-remote-automation —— 宿主插件。
 *
 * - 注册 cloud_task_* / automation_target 工具；
 * - 注册 /dsh-remote-automation/* HTTP 接口，供页面内的客户端插件调用；
 * - 云端模式下拒绝本地定时与本地后台任务（宿主侧守卫，非提示词）。
 *
 * 配置全部来自环境变量或 ~/.dsh/remote-automation/config.json，仓库内无任何密钥。
 */

import { randomUUID } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { loadConfig, publicConfig, saveConfig } from './config.js'
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

export const name = 'remote-automation'
export const inject = ['tools', 'webServer']

/** 运行期句柄（诊断/测试用；避免 apply 返回值被误当清理函数）。 */
export const runtime = {}

const LOCAL_AUTOMATION_TOOLS = ['schedule_create', 'schedule_list', 'schedule_delete']
const ROUTE_PREFIX = '/dsh-remote-automation'
const MAX_BODY = 1_000_000

function requireConfig() {
  const { configured, missing, config } = loadConfig()
  if (!configured) {
    throw new Error(`插件尚未配置（缺少 ${missing.join(', ')}）。请在「自动化任务」页面填写，或设置环境变量 DSH_RA_AK_ID / DSH_RA_AK_SECRET / DSH_RA_REGION / DSH_RA_INSTANCE_ID。`)
  }
  return { config }
}

function describeTasks(state, statuses) {
  if (state.tasks.length === 0) return '云端还没有自动化任务。'
  const lines = [`执行位置：${state.target === 'cloud' ? '云端' : '本地'}`, '']
  for (const task of state.tasks) {
    const status = statuses[task.id]
    lines.push(
      `- ${task.id}  ${task.name}${task.schedule ? `  [${task.schedule}]` : '  [手动]'}` +
        `  状态=${status?.state ?? 'unknown'}  上次退出=${status?.lastExit ?? 'n/a'}`,
    )
  }
  return lines.join('\n')
}

export function apply(ctx) {
  const state = loadState()
  const token = randomUUID()
  runtime.token = token

  ctx.logger?.info?.(`remote-automation: 已加载（target=${state.target}, tasks=${state.tasks.length}）`)

  // ---- 执行位置守卫 -----------------------------------------------------

  ctx.tools.guard((exec) => {
    if (state.target !== 'cloud') return undefined
    if (LOCAL_AUTOMATION_TOOLS.includes(exec.name)) {
      return '本地定时任务在「云端」模式下不可用：请用 cloud_task_create 在服务器上创建；需要本地执行请把页面切到「本地」。'
    }
    if (exec.name !== 'pwsh' && exec.name !== 'bash') return undefined
    const args = exec.arguments
    if (args && typeof args === 'object' && args.run_in_background === true) {
      return '云端模式下本地后台任务已禁用：请用 cloud_task_create / cloud_task_run 在服务器上执行。'
    }
    return undefined
  })

  // ---- 系统提示 ---------------------------------------------------------

  const systemPrompt = ctx.get?.('systemPrompt')
  if (systemPrompt?.section) {
    systemPrompt.section({
      name: 'remote-automation',
      order: 600,
      text: () =>
        [
          '## 自动化执行位置',
          `当前默认：${state.target === 'cloud' ? '云端（远程服务器）' : '本地'}`,
          '云端任务用 cloud_task_* 工具创建和管理，运行在服务器上，与本机是否开机无关。',
          '本地定时任务（schedule_*）仅在「本地」模式下可用。',
        ].join('\n'),
    })
  }

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
          async execute(args) {
            try {
              return await handler(args)
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
    'automation_target',
    '读取或切换自动化执行位置（cloud=云端服务器，local=本地）。不传 target 时只读取当前值。',
    {
      target: { type: 'string', enum: ['cloud', 'local'], description: '要切换到的执行位置；省略则读取' },
    },
    async (args) => {
      if (args.target === 'cloud' || args.target === 'local') {
        state.target = args.target
        saveState(state)
      }
      return `当前自动化执行位置：${state.target}`
    },
  )

  textTool(
    'cloud_task_create',
    '在云端服务器创建定时/手动自动化任务（服务端脚本 + 可选 cron）。默认执行位置是云端。',
    {
      name: { type: 'string', required: true, description: '任务名，用于识别，如 daily-report' },
      command: { type: 'string', required: true, description: '在服务器上执行的 shell 命令/脚本内容' },
      schedule: { type: 'string', description: '可选 5 段 cron 表达式，如 "0 9 * * *"；省略则仅手动触发' },
    },
    async (args) => {
      const { config } = requireConfig()
      const taskName = String(args.name || '').trim()
      const command = String(args.command || '').trim()
      if (!taskName) return '错误：name 不能为空'
      if (!command) return '错误：command 不能为空'
      const schedule = args.schedule ? String(args.schedule).trim() : ''
      if (schedule && !validCron(schedule)) return '错误：schedule 不是合法的 5 段 cron 表达式'

      const task = newTask({ name: taskName, command, schedule })
      await addTask(config, task)
      state.tasks.push(task)
      saveState(state)
      return `已创建云端任务 ${task.id}（${task.name}）${task.schedule ? '，cron=' + task.schedule : '，仅手动触发'}`
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
      const index = state.tasks.findIndex((t) => t.id === args.id)
      if (index < 0) return `错误：找不到任务 ${args.id}`
      const [task] = state.tasks.splice(index, 1)
      saveState(state)
      try {
        await deleteTask(config, task)
      } catch (error) {
        return `已从列表移除，但服务器清理失败：${error.message}`
      }
      return `已删除 ${task.id}（${task.name}）`
    },
  )

  textTool(
    'cloud_task_logs',
    '查看云端任务的运行日志。',
    {
      id: { type: 'string', required: true, description: '任务 id' },
      lines: { type: 'number', description: '返回最后多少行，默认 100' },
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

  const handler = async (req, res) => {
    try {
      if (req.headers['x-dsh-ra-token'] !== token) {
        return send(res, 401, { error: 'unauthorized' })
      }
      const url = new URL(req.url, 'http://127.0.0.1')
      const path = url.pathname.slice(ROUTE_PREFIX.length) || '/'
      const method = req.method || 'GET'

      if (method === 'GET' && path === '/state') {
        let statuses = {}
        let error = ''
        if (state.tasks.length > 0 && publicConfig().configured) {
          try {
            statuses = await taskStatuses(requireConfig().config, state.tasks)
          } catch (e) {
            error = e.message
          }
        }
        return send(res, 200, {
          configured: publicConfig().configured,
          config: publicConfig(),
          target: state.target,
          tasks: state.tasks.map((task) => ({ ...task, status: statuses[task.id] || null })),
          error,
        })
      }

      if (method === 'POST' && path === '/config') {
        const body = await readJson(req)
        const patch = {}
        for (const key of ['accessKeyId', 'accessKeySecret', 'region', 'instanceId', 'serverDir']) {
          if (typeof body[key] === 'string') patch[key] = body[key].trim()
        }
        saveConfig(patch)
        return send(res, 200, publicConfig())
      }

      if (method === 'POST' && path === '/target') {
        const body = await readJson(req)
        if (body.target !== 'cloud' && body.target !== 'local') {
          return send(res, 400, { error: 'target 必须是 cloud 或 local' })
        }
        state.target = body.target
        saveState(state)
        return send(res, 200, { target: state.target })
      }

      if (method === 'POST' && path === '/tasks') {
        const { config } = requireConfig()
        const body = await readJson(req)
        const taskName = String(body.name || '').trim()
        const command = String(body.command || '').trim()
        const schedule = body.schedule ? String(body.schedule).trim() : ''
        if (!taskName || !command) return send(res, 400, { error: 'name 和 command 必填' })
        if (schedule && !validCron(schedule)) return send(res, 400, { error: 'cron 表达式不合法' })
        const task = newTask({ name: taskName, command, schedule })
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
          state.tasks = state.tasks.filter((t) => t.id !== task.id)
          saveState(state)
          await deleteTask(config, task)
          return send(res, 200, { ok: true })
        }
        if (match[2] === 'logs' && method === 'GET') {
          const lines = url.searchParams.get('lines') || 200
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
