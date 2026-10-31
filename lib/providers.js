/**
 * 云厂商元数据与校验。
 *
 * 这里只描述「界面上有哪些字段、怎样算配置完整」，不包含任何网络调用，
 * 因此 config.js 可以放心引用它而不必加载各厂商的客户端。
 */

import { validInstanceId, validRegion, validServerDir, validTencentInstanceId } from './validate.js'

export const PROVIDERS = [
  {
    id: 'aliyun',
    label: '阿里云 ECS',
    short: 'Aliyun',
    credentialKeys: ['accessKeyId', 'accessKeySecret'],
    fields: [
      { key: 'accessKeyId', label: 'AccessKey ID', placeholder: 'LTAI...', secret: false },
      { key: 'accessKeySecret', label: 'AccessKey Secret', placeholder: '留空使用已保存凭据', secret: true },
      { key: 'region', label: '地域 region', placeholder: 'cn-shenzhen', secret: false },
      { key: 'instanceId', label: '实例 ID', placeholder: 'i-xxxxxxxxxxxxxxxx', secret: false },
    ],
    validateKey(key, value) {
      if (key === 'accessKeyId') return typeof value === 'string' && value.length <= 128
      if (key === 'accessKeySecret') return typeof value === 'string' && value.length <= 256
      if (key === 'region') return validRegion(value)
      if (key === 'instanceId') return validInstanceId(value)
      return false
    },
  },
  {
    id: 'tencent',
    label: '腾讯云 CVM',
    short: 'Tencent',
    credentialKeys: ['secretId', 'secretKey'],
    fields: [
      { key: 'secretId', label: 'SecretId', placeholder: 'AKID...', secret: false },
      { key: 'secretKey', label: 'SecretKey', placeholder: '留空使用已保存凭据', secret: true },
      { key: 'region', label: '地域 region', placeholder: 'ap-guangzhou', secret: false },
      { key: 'instanceId', label: '实例 ID', placeholder: 'ins-xxxxxxxx 或 lhins-xxxxxxxx', secret: false },
    ],
    validateKey(key, value) {
      if (key === 'secretId') return typeof value === 'string' && /^[A-Za-z0-9]{10,128}$/.test(value)
      if (key === 'secretKey') return typeof value === 'string' && value.length >= 10 && value.length <= 256
      if (key === 'region') return validRegion(value)
      if (key === 'instanceId') return validTencentInstanceId(value)
      return false
    },
  },
  {
    id: 'aws',
    label: 'AWS EC2 (SSM)',
    short: 'AWS',
    credentialKeys: ['accessKeyId', 'secretAccessKey'],
    fields: [
      { key: 'accessKeyId', label: 'Access Key ID', placeholder: 'AKIA...', secret: false },
      { key: 'secretAccessKey', label: 'Secret Access Key', placeholder: '留空使用已保存凭据', secret: true },
      { key: 'sessionToken', label: 'Session Token（可选）', placeholder: '临时凭证才需要', secret: true, optional: true },
      { key: 'region', label: '地域 region', placeholder: 'us-east-1', secret: false },
      { key: 'instanceId', label: '实例 ID', placeholder: 'i-xxxxxxxxxxxxxxxx', secret: false },
    ],
    validateKey(key, value) {
      if (key === 'accessKeyId') return typeof value === 'string' && /^[A-Za-z0-9]{16,128}$/.test(value)
      if (key === 'secretAccessKey') return typeof value === 'string' && value.length >= 20 && value.length <= 256
      if (key === 'sessionToken') return typeof value === 'string' && value.length >= 10 && value.length <= 4096
      if (key === 'region') return validRegion(value)
      if (key === 'instanceId') return validInstanceId(value)
      return false
    },
  },
]

export const PROVIDER_IDS = PROVIDERS.map((provider) => provider.id)

export function providerMeta(id) {
  return PROVIDERS.find((provider) => provider.id === id) || null
}

/** 脱敏：保留前 4 位和后 4 位。 */
export function maskId(value) {
  if (typeof value !== 'string' || value.length < 8) return value ? '****' : null
  return value.slice(0, 4) + '****' + value.slice(-4)
}

/**
 * 计算某个厂商配置的完整性与脱敏展示。
 * @returns {{id:string,label:string,configured:boolean,missing:string[],invalid:string[],
 *            region:string|null,instanceId:string|null,maskedId:string|null,secretConfigured:boolean}}
 */
export function providerState(id, config = {}) {
  const meta = providerMeta(id)
  if (!meta) throw new Error(`不支持的云厂商：${id}`)
  const missing = []
  const invalid = []
  for (const field of meta.fields) {
    const value = config[field.key]
    const isCredential = meta.credentialKeys.includes(field.key)
    if (!value) {
      if (isCredential || field.key === 'region' || field.key === 'instanceId') missing.push(field.key)
      continue
    }
    if (!meta.validateKey(field.key, value)) invalid.push(field.key)
  }
  return {
    id,
    label: meta.label,
    configured: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
    region: config.region || null,
    instanceId: config.instanceId || null,
    maskedId: maskId(config[meta.credentialKeys[0]]),
    secretConfigured: Boolean(config[meta.credentialKeys[1]]),
  }
}

/** 某个厂商配置里可被页面编辑的键。 */
export function providerKeys(id) {
  const meta = providerMeta(id)
  return meta ? meta.fields.map((field) => field.key) : []
}

export { validServerDir }
