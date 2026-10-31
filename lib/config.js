/**
 * 插件配置：全部来自环境变量或 `$DSH_HOME/remote-automation/config.json`。
 * 仓库中不含任何默认密钥、实例 ID 或私有路径。
 *
 * 环境变量优先于配置文件；保存时合并写入，空字符串忽略、显式 null 删除。
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { validateConfigPatch, validInstanceId, validRegion, validServerDir } from './validate.js'

export const DEFAULT_SERVER_DIR = '/opt/automation'

const CONFIG_KEYS = ['accessKeyId', 'accessKeySecret', 'region', 'instanceId', 'serverDir']

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

function envConfig() {
  const env = process.env
  const read = (...names) => {
    for (const name of names) {
      if (env[name] && env[name].trim() !== '') return env[name].trim()
    }
    return undefined
  }
  return {
    accessKeyId: read('DSH_RA_AK_ID', 'ALIYUN_ACCESS_KEY_ID'),
    accessKeySecret: read('DSH_RA_AK_SECRET', 'ALIYUN_ACCESS_KEY_SECRET'),
    region: read('DSH_RA_REGION', 'ALIYUN_REGION'),
    instanceId: read('DSH_RA_INSTANCE_ID', 'ALIYUN_INSTANCE_ID'),
    serverDir: read('DSH_RA_SERVER_DIR'),
  }
}

function fileConfig() {
  try {
    const raw = JSON.parse(readFileSync(configPath(), 'utf8'))
    return typeof raw === 'object' && raw !== null ? raw : {}
  } catch {
    return {}
  }
}

/**
 * 读取有效配置。环境变量优先于文件。
 * @returns {{configured: boolean, missing: string[], invalid: string[], config: object}}
 */
export function loadConfig() {
  const fromEnv = envConfig()
  const fromFile = fileConfig()
  const merged = {}
  for (const key of CONFIG_KEYS) {
    const value = fromEnv[key] ?? fromFile[key]
    if (value !== undefined && value !== '') merged[key] = value
  }
  merged.serverDir = merged.serverDir || DEFAULT_SERVER_DIR

  const missing = ['accessKeyId', 'accessKeySecret', 'region', 'instanceId'].filter((key) => !merged[key])
  const invalid = []
  if (merged.region && !validRegion(merged.region)) invalid.push('region')
  if (merged.instanceId && !validInstanceId(merged.instanceId)) invalid.push('instanceId')
  if (merged.serverDir && !validServerDir(merged.serverDir)) invalid.push('serverDir')

  return {
    configured: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
    config: merged,
  }
}

/** 合并写入配置文件（空字符串忽略，显式 null 删除）。 */
export function saveConfig(patch) {
  const dir = dataDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  try {
    // 已存在的目录可能是旧版本以 0755 创建的，顺手收紧。
    chmodSync(dir, 0o700)
  } catch {
    // Windows 上没有 POSIX 权限位，忽略。
  }
  const current = fileConfig()
  const next = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (!CONFIG_KEYS.includes(key)) continue
    if (value === undefined || value === '') continue
    if (value === null) delete next[key]
    else next[key] = value
  }
  const tmp = `${configPath()}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
  writeFileSync(tmp, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 })
  try {
    // 先收紧临时文件权限，再原子替换，避免出现 0644 的窗口。
    chmodSync(tmp, 0o600)
  } catch {
    // Windows 上没有 POSIX 权限位，忽略。
  }
  renameSync(tmp, configPath())
  return next
}

/**
 * 校验页面/工具提交的配置补丁。
 * @returns {string[]} 不合法的字段名，空数组表示通过。
 */
export function configPatchErrors(patch) {
  return validateConfigPatch(patch)
}

/** 脱敏后的配置，供页面展示。 */
export function publicConfig() {
  const { configured, missing, invalid, config } = loadConfig()
  return {
    configured,
    missing,
    invalid,
    region: config.region || null,
    instanceId: config.instanceId || null,
    serverDir: config.serverDir || DEFAULT_SERVER_DIR,
    accessKeyIdMasked: config.accessKeyId
      ? config.accessKeyId.slice(0, 4) + '****' + config.accessKeyId.slice(-4)
      : null,
  }
}
