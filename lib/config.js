/**
 * 插件配置：全部来自环境变量或 `$DSH_HOME/remote-automation/config.json`。
 * 仓库中不含任何默认密钥、实例 ID 或私有路径。
 *
 * 配置有两个版本：
 * - v1（0.2.x）：扁平字段，只有阿里云；
 * - v2（0.3+）：`providers: { aliyun, tencent, ... }`，并记录当前使用的厂商。
 * 读取时自动把 v1 当作阿里云配置，写入时统一升级为 v2。
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { PROVIDER_IDS, providerMeta, providerState } from './providers.js'
import { validServerDir } from './validate.js'

export const DEFAULT_SERVER_DIR = '/opt/automation'
const DEFAULT_PROVIDER = 'aliyun'

/** 解析 DSH 主目录：优先 $DSH_HOME，其次 ~/.dsh。 */
export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

export function dataDir() {
  return join(dshHome(), 'remote-automation')
}

export function configPath() {
  return join(dataDir(), 'config.json')
}

export function statePath() {
  return join(dataDir(), 'state.json')
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pickDefined(source, keys) {
  const out = {}
  for (const key of keys) {
    const value = source?.[key]
    if (value !== undefined && value !== null && String(value).trim() !== '') out[key] = value
  }
  return out
}

function envConfig() {
  const env = process.env
  const read = (...names) => {
    for (const name of names) {
      if (env[name] && env[name].trim() !== '') return env[name].trim()
    }
    return undefined
  }
  return {
    provider: read('DSH_RA_PROVIDER'),
    serverDir: read('DSH_RA_SERVER_DIR'),
    providers: {
      aliyun: pickDefined(
        {
          accessKeyId: read('DSH_RA_AK_ID', 'ALIYUN_ACCESS_KEY_ID'),
          accessKeySecret: read('DSH_RA_AK_SECRET', 'ALIYUN_ACCESS_KEY_SECRET'),
          region: read('DSH_RA_REGION', 'ALIYUN_REGION'),
          instanceId: read('DSH_RA_INSTANCE_ID', 'ALIYUN_INSTANCE_ID'),
        },
        ['accessKeyId', 'accessKeySecret', 'region', 'instanceId'],
      ),
      tencent: pickDefined(
        {
          secretId: read('DSH_RA_TC_SECRET_ID', 'TENCENTCLOUD_SECRET_ID'),
          secretKey: read('DSH_RA_TC_SECRET_KEY', 'TENCENTCLOUD_SECRET_KEY'),
          region: read('DSH_RA_TC_REGION', 'TENCENTCLOUD_REGION'),
          instanceId: read('DSH_RA_TC_INSTANCE_ID'),
        },
        ['secretId', 'secretKey', 'region', 'instanceId'],
      ),
      aws: pickDefined(
        {
          accessKeyId: read('DSH_RA_AWS_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID'),
          secretAccessKey: read('DSH_RA_AWS_SECRET_ACCESS_KEY', 'AWS_SECRET_ACCESS_KEY'),
          sessionToken: read('DSH_RA_AWS_SESSION_TOKEN', 'AWS_SESSION_TOKEN'),
          region: read('DSH_RA_AWS_REGION', 'AWS_REGION', 'AWS_DEFAULT_REGION'),
          instanceId: read('DSH_RA_AWS_INSTANCE_ID'),
        },
        ['accessKeyId', 'secretAccessKey', 'sessionToken', 'region', 'instanceId'],
      ),
    },
  }
}

function readStoredConfig() {
  try {
    const raw = JSON.parse(readFileSync(configPath(), 'utf8'))
    return isObject(raw) ? raw : {}
  } catch {
    return {}
  }
}

/** 把 v1 扁平配置升级成 v2 结构（不写盘）。 */
export function normalizeStoredConfig(raw) {
  if (!isObject(raw)) return { version: 2, provider: DEFAULT_PROVIDER, serverDir: undefined, providers: {} }
  if (isObject(raw.providers)) {
    return {
      version: 2,
      provider: PROVIDER_IDS.includes(raw.provider) ? raw.provider : DEFAULT_PROVIDER,
      serverDir: raw.serverDir,
      providers: raw.providers,
    }
  }
  const aliyun = pickDefined(raw, ['accessKeyId', 'accessKeySecret', 'region', 'instanceId'])
  return {
    version: 2,
    provider: DEFAULT_PROVIDER,
    serverDir: raw.serverDir,
    providers: Object.keys(aliyun).length ? { aliyun } : {},
  }
}

/**
 * 读取有效配置（含各厂商明文凭证，仅供宿主内部使用）。
 * @returns {{
 *   provider: string, serverDir: string,
 *   providers: Record<string, object>,
 *   state: Record<string, ReturnType<typeof providerState>>,
 *   configured: boolean, missing: string[], invalid: string[]
 * }}
 */
export function loadConfig() {
  const file = normalizeStoredConfig(readStoredConfig())
  const env = envConfig()
  const requested = env.provider || file.provider
  const provider = PROVIDER_IDS.includes(requested) ? requested : DEFAULT_PROVIDER
  const providerInvalid = Boolean(requested) && !PROVIDER_IDS.includes(requested)

  const providers = {}
  const state = {}
  for (const id of PROVIDER_IDS) {
    const base = isObject(file.providers[id]) ? { ...file.providers[id] } : {}
    const override = env.providers[id] || {}
    for (const [key, value] of Object.entries(override)) {
      if (value !== undefined && value !== null && String(value).trim() !== '') base[key] = value
    }
    providers[id] = base
    state[id] = providerState(id, base)
  }

  const serverDir = env.serverDir || file.serverDir || DEFAULT_SERVER_DIR
  const serverDirValid = validServerDir(serverDir)
  const active = state[provider]
  const invalid = [...active.invalid]
  if (!serverDirValid) invalid.push('serverDir')
  if (providerInvalid) invalid.push('provider')

  return {
    provider,
    serverDir,
    providers,
    state,
    configured: active.configured && serverDirValid && !providerInvalid,
    missing: active.missing,
    invalid,
  }
}

/**
 * 写入配置（空字符串忽略，显式 null 删除）。
 * @param {{provider?: string, serverDir?: string, values?: object}} patch
 */
export function saveConfig({ provider, serverDir, values } = {}) {
  const dir = dataDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  try {
    chmodSync(dir, 0o700)
  } catch {
    // Windows 上没有 POSIX 权限位，忽略。
  }

  const current = normalizeStoredConfig(readStoredConfig())
  const providers = {}
  for (const [id, config] of Object.entries(current.providers)) {
    providers[id] = isObject(config) ? { ...config } : {}
  }

  if (provider !== undefined) {
    if (!PROVIDER_IDS.includes(provider)) throw new Error(`不支持的云厂商：${provider}`)
    current.provider = provider
    if (!isObject(providers[provider])) providers[provider] = {}
  }

  if (isObject(values)) {
    const target = provider || current.provider || DEFAULT_PROVIDER
    if (!PROVIDER_IDS.includes(target)) throw new Error(`不支持的云厂商：${target}`)
    if (!isObject(providers[target])) providers[target] = {}
    const meta = providerMeta(target)
    for (const [key, value] of Object.entries(values)) {
      if (!meta.fields.some((field) => field.key === key)) continue
      if (value === undefined || value === '') continue
      if (value === null) delete providers[target][key]
      else providers[target][key] = String(value).trim()
    }
  }

  if (typeof serverDir === 'string' && serverDir.trim() !== '') {
    current.serverDir = serverDir.trim()
  }

  const next = {
    version: 2,
    provider: current.provider || DEFAULT_PROVIDER,
    serverDir: current.serverDir || DEFAULT_SERVER_DIR,
    providers,
  }

  const tmp = `${configPath()}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
  writeFileSync(tmp, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 })
  try {
    chmodSync(tmp, 0o600)
  } catch {
    // Windows 上没有 POSIX 权限位，忽略。
  }
  renameSync(tmp, configPath())
  return next
}

/**
 * 校验某个厂商的字段补丁。
 * @returns {string[]} 不合法的字段名，空数组表示通过。
 */
export function configPatchErrors(provider, values) {
  const meta = providerMeta(provider)
  if (!meta) return ['provider']
  const errors = []
  for (const [key, value] of Object.entries(values || {})) {
    if (value === null) continue
    if (!meta.fields.some((field) => field.key === key)) {
      errors.push(key)
      continue
    }
    if (typeof value !== 'string' || !meta.validateKey(key, value)) errors.push(key)
  }
  return errors
}

/** 脱敏后的配置，供页面展示（绝不含 Secret）。 */
export function publicConfig() {
  const { provider, configured, missing, invalid, serverDir, state } = loadConfig()
  const providers = {}
  for (const id of PROVIDER_IDS) providers[id] = state[id]
  return {
    provider,
    configured,
    missing,
    invalid,
    serverDir,
    providers,
  }
}
