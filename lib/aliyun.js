/**
 * 阿里云 ECS Cloud Assistant 客户端（仅 Node 标准库）。
 *
 * 只使用出站 HTTPS：实例不需要开放任何入站端口，安全组保持关闭即可。
 * 凭证只存在于内存里，不写日志、不拼进 URL 之外的任何输出。
 */

import { createHmac, randomUUID } from 'node:crypto'
import { validInstanceId, validRegion } from './validate.js'

const API_VERSION = '2014-05-26'
const REQUEST_TIMEOUT_MS = 30_000

/** RFC3986 编码，符合阿里云 RPC 签名规则（空格 %20、`*` %2A、`~` 保留）。 */
export function percentEncode(value) {
  return encodeURIComponent(String(value)).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  )
}

export class AliyunError extends Error {
  constructor(message, { code = '', requestId = '' } = {}) {
    super(message)
    this.name = 'AliyunError'
    this.code = code
    this.requestId = requestId
  }
}

export class AliyunEcsClient {
  constructor({ accessKeyId, accessKeySecret, region, instanceId, endpoint }) {
    if (!accessKeyId || !accessKeySecret) throw new AliyunError('缺少 AccessKey')
    if (!validRegion(region)) throw new AliyunError('地域 region 不合法')
    if (!validInstanceId(instanceId)) throw new AliyunError('实例 instanceId 不合法')
    this.accessKeyId = accessKeyId
    this.accessKeySecret = accessKeySecret
    this.region = region
    this.instanceId = instanceId
    this.endpoint = endpoint || `https://ecs.${region}.aliyuncs.com/`
    // 单块原始字节数：块内 base64 + 整条命令 base64 后仍留足余量。
    // 云助手 RunCommand 的命令长度上限按 16 KB 保守估算（不同版本/文档有差异）。
    this.chunkSize = 8 * 1024
  }

  /** 调用一个 ECS RPC 接口，返回解析后的 JSON。 */
  async call(action, params = {}) {
    const common = {
      Action: action,
      Version: API_VERSION,
      Format: 'JSON',
      AccessKeyId: this.accessKeyId,
      SignatureMethod: 'HMAC-SHA1',
      SignatureVersion: '1.0',
      SignatureNonce: randomUUID().replace(/-/g, ''),
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    }
    const all = { ...common }
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) all[key] = String(value)
    }

    const canonical = Object.keys(all)
      .sort()
      .map((key) => `${percentEncode(key)}=${percentEncode(all[key])}`)
      .join('&')
    const stringToSign = `POST&%2F&${percentEncode(canonical)}`
    const signature = createHmac('sha1', this.accessKeySecret + '&')
      .update(stringToSign)
      .digest('base64')
    const body = `${canonical}&Signature=${percentEncode(signature)}`

    let response
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
          'user-agent': 'dsh-remote-automation',
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (error) {
      const reason = error?.name === 'TimeoutError' ? '请求超时' : error.message
      throw new AliyunError(`无法连接阿里云 API：${reason}`)
    }

    const text = await response.text()
    let data
    try {
      data = JSON.parse(text)
    } catch {
      throw new AliyunError(`ECS ${action} 返回非 JSON：${text.slice(0, 200)}`)
    }
    if (!response.ok || data.Code) {
      throw new AliyunError(
        `ECS ${action}: ${data.Code || response.status} ${data.Message || ''}`.trim(),
        { code: data.Code || `HTTP${response.status}`, requestId: data.RequestId || '' },
      )
    }
    return data
  }

  /** 实例基础信息。 */
  async describeInstance() {
    const data = await this.call('DescribeInstances', {
      RegionId: this.region,
      InstanceIds: JSON.stringify([this.instanceId]),
    })
    return data?.Instances?.Instance?.[0] || {}
  }

  /** 云助手在线状态。 */
  async assistantStatus() {
    const data = await this.call('DescribeCloudAssistantStatus', {
      RegionId: this.region,
      'InstanceId.1': this.instanceId,
    })
    return data?.InstanceCloudAssistantStatusSet?.InstanceCloudAssistantStatus?.[0] || {}
  }

  /**
   * 云助手原生文件下发（SendFile），单文件 base64 后 ≤ 32 KB。
   * 比把文件塞进 RunCommand 少一层编码，权限只需要 ecs:SendFile /
   * ecs:DescribeSendFileResults。
   */
  async sendFile({ name, content, targetDir, mode = '0755', overwrite = true, timeout = 60, interval = 800 }) {
    const data = await this.call('SendFile', {
      RegionId: this.region,
      'InstanceId.1': this.instanceId,
      Name: name,
      Content: Buffer.from(content).toString('base64'),
      ContentType: 'Base64',
      TargetDir: targetDir,
      FileMode: mode,
      Overwrite: overwrite,
      Timeout: Math.max(10, Math.min(Math.floor(timeout), 600)),
    })
    const invokeId = data.InvokeId
    if (!invokeId) throw new AliyunError('SendFile 未返回 InvokeId')

    const deadline = Date.now() + (timeout + 30) * 1000
    let status = ''
    let detail = ''
    while (Date.now() < deadline) {
      const result = await this.call('DescribeSendFileResults', {
        RegionId: this.region,
        InvokeId: invokeId,
        InstanceId: this.instanceId,
        MaxResults: 50,
      })
      const invocations = result?.Invocations?.Invocation || []
      const invocation = invocations.find((item) => item.InvokeId === invokeId) || invocations[0]
      const instances = invocation?.InvokeInstances?.InvokeInstance || []
      const instance = instances.find((item) => item.InstanceId === this.instanceId) || instances[0]
      status = invocation?.InvocationStatus || instance?.InvocationStatus || ''
      detail = instance?.ErrorInfo || instance?.ErrorCode || ''
      if (['Success', 'Failed', 'PartialFailed'].includes(status)) break
      await new Promise((resolve) => setTimeout(resolve, interval))
    }
    if (status !== 'Success') {
      throw new AliyunError(`SendFile ${status || '超时'}${detail ? `：${detail}` : ''}`)
    }
    return { invokeId, status }
  }

  /** 下发一条命令，返回 InvokeId。 */
  async runCommand(command, { timeout = 120, scriptType = 'RunShellScript', workingDir } = {}) {
    const params = {
      RegionId: this.region,
      'InstanceId.1': this.instanceId,
      Type: scriptType,
      CommandContent: Buffer.from(command, 'utf8').toString('base64'),
      ContentEncoding: 'Base64',
      Timeout: Math.max(1, Math.min(Math.floor(timeout), 86400)),
    }
    if (workingDir) params.WorkingDir = workingDir
    const data = await this.call('RunCommand', params)
    return data.InvokeId
  }

  /** 查询一次调用的结果。 */
  async invocationResult(invokeId) {
    const data = await this.call('DescribeInvocationResults', {
      RegionId: this.region,
      InvokeId: invokeId,
      'InstanceId.1': this.instanceId,
    })
    const list = data?.Invocation?.InvocationResults?.InvocationResult || []
    return list[0] || {}
  }

  /**
   * 执行并等待结果。
   * @returns {Promise<{invokeId: string, status: string, exitCode: number|null, output: string}>}
   */
  async exec(command, { timeout = 120, interval = 1200 } = {}) {
    const invokeId = await this.runCommand(command, { timeout })
    const deadline = Date.now() + (timeout + 30) * 1000
    let result = {}
    let finished = false
    while (Date.now() < deadline) {
      result = await this.invocationResult(invokeId)
      const status = result.InvocationStatus || result.InvokeRecordStatus || ''
      if (['Success', 'Failed', 'Stopped', 'Timeout', 'Error', 'Finished'].includes(status)) {
        finished = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, interval))
    }
    if (!finished) {
      throw new AliyunError(`等待云助手结果超时（InvokeId=${invokeId}）`, { code: 'InvokeTimeout' })
    }
    return {
      invokeId,
      status: result.InvocationStatus || '',
      exitCode: result.ExitCode ?? null,
      output: result.Output ? Buffer.from(result.Output, 'base64').toString('utf8') : '',
    }
  }
}
