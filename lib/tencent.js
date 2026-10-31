/**
 * 腾讯云 TAT（自动化助手）客户端。
 *
 * 只走出站 HTTPS 调用 tat.tencentcloudapi.com，实例不需要开放任何入站端口。
 * 签名、重试与错误解析交给腾讯云官方 SDK；本文件只负责把 TAT 的
 * 「执行活动 → 执行任务 → 输出」模型收敛成与阿里云客户端一致的 exec() 接口。
 */

import { createRequire } from 'node:module'
import { TENCENT_INSTANCE_ID_RE, validRegion } from './validate.js'

const require = createRequire(import.meta.url)

/** TAT 的终态；见到这些状态就可以取 ExitCode 和输出。 */
export const TENCENT_TERMINAL_STATES = new Set([
  'SUCCESS',
  'FAILED',
  'TIMEOUT',
  'TASK_TIMEOUT',
  'CANCELLED',
  'PARTIAL_FAILED',
])

/** 中国大陆地域使用国内 TAT 域名，其余地域走国际站。 */
const CHINA_TAT_REGIONS = new Set([
  'ap-beijing',
  'ap-chengdu',
  'ap-chongqing',
  'ap-guangzhou',
  'ap-nanjing',
  'ap-shanghai',
  'ap-shenzhen',
  'ap-shenzhen-fsi',
  'ap-tianjin',
  'ap-wuhan',
])

export function tencentEndpoint(region) {
  return CHINA_TAT_REGIONS.has(region) ? 'tat.tencentcloudapi.com' : 'tat.intl.tencentcloudapi.com'
}

export class TencentTatError extends Error {
  constructor(message, { code = '', requestId = '' } = {}) {
    super(message)
    this.name = 'TencentTatError'
    this.code = code
    this.requestId = requestId
  }
}

let ClientClass

function tencentClientClass() {
  if (!ClientClass) {
    const sdk = require('tencentcloud-sdk-nodejs-tat')
    ClientClass = sdk.tat.v20201028.Client
  }
  return ClientClass
}

export class TencentTatClient {
  constructor({ secretId, secretKey, region, instanceId, endpoint }) {
    if (!secretId || !secretKey) throw new TencentTatError('缺少腾讯云 SecretId / SecretKey')
    if (!validRegion(region)) throw new TencentTatError('腾讯云地域 region 不合法')
    if (typeof instanceId !== 'string' || !TENCENT_INSTANCE_ID_RE.test(instanceId)) {
      throw new TencentTatError('腾讯云实例 ID 不合法（ins-... 或 lhins-...）')
    }
    this.secretId = secretId
    this.secretKey = secretKey
    this.region = region
    this.instanceId = instanceId
    this.endpoint = endpoint || tencentEndpoint(region)
    this.chunkSize = 28 * 1024
    this.client = null
  }

  #ensureClient() {
    if (this.client) return this.client
    const Client = tencentClientClass()
    this.client = new Client({
      credential: { secretId: this.secretId, secretKey: this.secretKey },
      region: this.region,
      profile: {
        httpProfile: {
          endpoint: this.endpoint,
          reqTimeout: 60,
        },
      },
    })
    return this.client
  }

  async call(action, params = {}) {
    try {
      const client = this.#ensureClient()
      return await client[action](params)
    } catch (error) {
      const code = error?.code || error?.Code || ''
      const requestId = error?.requestId || error?.RequestId || ''
      const detail = [code, error?.message || String(error)].filter(Boolean).join(' ')
      throw new TencentTatError(`TAT ${action}: ${detail}`.trim(), { code, requestId })
    }
  }

  /** 自动化助手在线状态（Online / Offline）。 */
  async agentStatus() {
    const response = await this.call('DescribeAutomationAgentStatus', { InstanceIds: [this.instanceId] })
    const list = response?.AutomationAgentSet || []
    return list.find((item) => item.InstanceId === this.instanceId) || list[0] || {}
  }

  /** 下发一条 SHELL 命令，返回执行活动 ID。 */
  async runCommand(command, { timeout = 120 } = {}) {
    const content = Buffer.from(command, 'utf8').toString('base64')
    if (content.length > 64 * 1024) throw new TencentTatError('命令超过腾讯云 TAT 64 KB 上限，请拆分任务')
    const response = await this.call('RunCommand', {
      Content: content,
      CommandType: 'SHELL',
      InstanceIds: [this.instanceId],
      Timeout: Math.max(1, Math.min(Math.floor(timeout), 86400)),
    })
    if (!response?.InvocationId) throw new TencentTatError('TAT RunCommand 未返回 InvocationId')
    return response.InvocationId
  }

  /** 按执行活动 ID 查最新的执行任务。 */
  async invocationTask(invocationId) {
    const response = await this.call('DescribeInvocationTasks', {
      Filters: [{ Name: 'invocation-id', Values: [invocationId] }],
      HideOutput: false,
      Limit: 20,
    })
    const list = response?.InvocationTaskSet || []
    return list.find((item) => item.InstanceId === this.instanceId) || list[0] || null
  }

  /**
   * 执行并等待结果，与 AliyunEcsClient.exec 返回同构对象。
   * @returns {Promise<{invocationId: string, status: string, exitCode: number|null, output: string}>}
   */
  async exec(command, { timeout = 120, interval = 1200 } = {}) {
    const invocationId = await this.runCommand(command, { timeout })
    const deadline = Date.now() + (timeout + 30) * 1000
    let task = null
    while (Date.now() < deadline) {
      task = await this.invocationTask(invocationId)
      if (task && TENCENT_TERMINAL_STATES.has(task.TaskStatus)) break
      await new Promise((resolve) => setTimeout(resolve, interval))
    }
    if (!task || !TENCENT_TERMINAL_STATES.has(task.TaskStatus)) {
      throw new TencentTatError(`等待腾讯云执行结果超时（InvocationId=${invocationId}）`, {
        code: 'InvokeTimeout',
      })
    }
    return {
      invocationId,
      status: task.TaskStatus || '',
      exitCode: task.TaskResult?.ExitCode ?? null,
      output: task.TaskResult?.Output
        ? Buffer.from(task.TaskResult.Output, 'base64').toString('utf8')
        : '',
    }
  }
}
