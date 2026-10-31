/**
 * AWS EC2 Systems Manager (SSM) 客户端。
 *
 * 只走出站 HTTPS 到 ssm.<region>.amazonaws.com，实例不需要开放入站端口。
 * 使用官方 @aws-sdk/client-ssm 处理 SigV4 / 重试 / 端点解析，本文件把
 * SendCommand + GetCommandInvocation 收敛成与阿里云/腾讯云一致的 exec()。
 */

import { createRequire } from 'node:module'
import { validInstanceId, validRegion } from './validate.js'

const require = createRequire(import.meta.url)

/** SSM 命令的终态。 */
export const AWS_TERMINAL_STATES = new Set(['Success', 'Failed', 'Cancelled', 'TimedOut', 'Terminated'])

export class AwsSsmError extends Error {
  constructor(message, { code = '', requestId = '' } = {}) {
    super(message)
    this.name = 'AwsSsmError'
    this.code = code
    this.requestId = requestId
  }
}

let sdk

function awsSdk() {
  if (!sdk) sdk = require('@aws-sdk/client-ssm')
  return sdk
}

export class AwsSsmClient {
  constructor({ accessKeyId, secretAccessKey, sessionToken, region, instanceId, endpoint }) {
    if (!accessKeyId || !secretAccessKey) throw new AwsSsmError('缺少 AWS Access Key ID / Secret Access Key')
    if (!validRegion(region)) throw new AwsSsmError('AWS 地域 region 不合法')
    if (!validInstanceId(instanceId)) throw new AwsSsmError('AWS 实例 ID 不合法（i-...）')
    this.accessKeyId = accessKeyId
    this.secretAccessKey = secretAccessKey
    this.sessionToken = sessionToken
    this.region = region
    this.instanceId = instanceId
    this.endpoint = endpoint
    this.client = null
  }

  #ensureClient() {
    if (this.client) return this.client
    const { SSMClient } = awsSdk()
    const credentials = {
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      ...(this.sessionToken ? { sessionToken: this.sessionToken } : {}),
    }
    this.client = new SSMClient({
      region: this.region,
      credentials,
      ...(this.endpoint ? { endpoint: this.endpoint } : {}),
    })
    return this.client
  }

  async call(Command, input) {
    try {
      const client = this.#ensureClient()
      return await client.send(new Command(input))
    } catch (error) {
      const code = error?.name || error?.Code || ''
      const requestId = error?.$metadata?.requestId || ''
      throw new AwsSsmError(`SSM ${code || 'Error'}: ${error.message || String(error)}`, { code, requestId })
    }
  }

  /** 下发一条 shell 命令，返回 CommandId。 */
  async runCommand(command, { timeout = 120 } = {}) {
    const { SendCommandCommand } = awsSdk()
    const response = await this.call(SendCommandCommand, {
      DocumentName: 'AWS-RunShellScript',
      InstanceIds: [this.instanceId],
      Parameters: { commands: [command] },
      TimeoutSeconds: Math.max(1, Math.min(Math.floor(timeout), 86400)),
      Comment: 'dsh-remote-automation',
    })
    const commandId = response?.Command?.CommandId
    if (!commandId) throw new AwsSsmError('SSM SendCommand 未返回 CommandId')
    return commandId
  }

  /** 查询一次命令执行结果；命令尚未创建时返回 null。 */
  async invocation(commandId) {
    const { GetCommandInvocationCommand } = awsSdk()
    try {
      return await this.call(GetCommandInvocationCommand, {
        CommandId: commandId,
        InstanceId: this.instanceId,
      })
    } catch (error) {
      if (error instanceof AwsSsmError && error.code === 'InvocationDoesNotExist') return null
      throw error
    }
  }

  /**
   * 执行并等待结果，与 AliyunEcsClient.exec 返回同构对象。
   * @returns {Promise<{commandId: string, status: string, exitCode: number|null, output: string}>}
   */
  async exec(command, { timeout = 120, interval = 1200 } = {}) {
    const commandId = await this.runCommand(command, { timeout })
    const deadline = Date.now() + (timeout + 30) * 1000
    let invocation = null
    while (Date.now() < deadline) {
      invocation = await this.invocation(commandId)
      if (invocation && AWS_TERMINAL_STATES.has(invocation.Status)) break
      await new Promise((resolve) => setTimeout(resolve, interval))
    }
    if (!invocation || !AWS_TERMINAL_STATES.has(invocation.Status)) {
      throw new AwsSsmError(`等待 SSM 执行结果超时（CommandId=${commandId}）`, { code: 'InvokeTimeout' })
    }
    const output = [invocation.StandardOutputContent, invocation.StandardErrorContent]
      .filter((part) => typeof part === 'string' && part.length > 0)
      .join('\n')
    const exitCode = Number(invocation.ResponseCode)
    return {
      commandId,
      status: invocation.Status || '',
      exitCode: Number.isFinite(exitCode) ? exitCode : null,
      output,
    }
  }

  /** SSM Agent 在线状态（PingStatus: Online / ConnectionLost / Inactive）。 */
  async agentStatus() {
    const { DescribeInstanceInformationCommand } = awsSdk()
    const response = await this.call(DescribeInstanceInformationCommand, {
      Filters: [{ Key: 'InstanceIds', Values: [this.instanceId] }],
    })
    const list = response?.InstanceInformationList || []
    return list.find((item) => item.InstanceId === this.instanceId) || list[0] || {}
  }
}
