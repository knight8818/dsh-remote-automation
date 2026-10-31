/**
 * 输入校验：所有会被拼进远端 shell 或 URL 的配置都在这里把关。
 *
 * 设计原则：
 * - 只接受明确合法的字符集，拒绝空白、引号、分号、点段（`..`）等；
 * - 校验函数是纯函数，便于单元测试，也不依赖 DSH 运行时。
 */

/** 阿里云地域，例如 cn-shenzhen / ap-southeast-1 / us-east-1。 */
export const REGION_RE = /^[a-z]{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/

/** ECS 实例 ID，例如 i-1234567890abcdef0。 */
export const INSTANCE_ID_RE = /^i-[A-Za-z0-9]{3,64}$/

/** 腾讯云 CVM / Lighthouse 实例 ID，例如 ins-xxxxxxxx / lhins-xxxxxxxx。 */
export const TENCENT_INSTANCE_ID_RE = /^(?:ins|lhins)-[a-z0-9]{3,64}$/

/** 服务器脚本目录：绝对 POSIX 路径，只允许安全字符。 */
export const SERVER_DIR_RE = /^\/[A-Za-z0-9._/-]*$/

/** 任务名：避免控制字符，最长 80。 */
export const TASK_NAME_MAX = 80

/**
 * 单个任务命令上限（字节）。
 * 云助手 RunCommand 的 CommandContent 有 24 KB 上限，而脚本还会被 base64 编码，
 * 12 KB 的原命令（含脚本头）编码后约 16 KB，留出安全余量。
 */
export const TASK_COMMAND_MAX = 12 * 1024

/** 云端任务数量上限。 */
export const MAX_TASKS = 100

export function validRegion(value) {
  return typeof value === 'string' && value.length <= 40 && REGION_RE.test(value)
}

export function validInstanceId(value) {
  return typeof value === 'string' && INSTANCE_ID_RE.test(value)
}

export function validTencentInstanceId(value) {
  return typeof value === 'string' && TENCENT_INSTANCE_ID_RE.test(value)
}

/**
 * 校验服务器目录。
 * 拒绝 `/`、`//`、结尾斜杠和 `..` 段，避免命令被引到目录之外。
 */
export function validServerDir(value) {
  if (typeof value !== 'string' || value.length > 200) return false
  if (!SERVER_DIR_RE.test(value)) return false
  if (value === '/' || value.includes('..') || value.includes('//') || value.endsWith('/')) return false
  return value.length >= 2
}

/** 去掉首尾空白后校验任务名，返回规范化后的值或 null。 */
export function normalizeTaskName(value) {
  if (typeof value !== 'string') return null
  const name = value.trim()
  if (!name || name.length > TASK_NAME_MAX) return null
  // 允许任意可见字符，但拒绝控制字符与换行。
  if (/[\u0000-\u001f\u007f]/.test(name)) return null
  return name
}

/** 校验任务命令，返回规范化后的值或 null。 */
export function normalizeTaskCommand(value) {
  if (typeof value !== 'string') return null
  const command = value.trim()
  if (!command) return null
  if (Buffer.byteLength(command, 'utf8') > TASK_COMMAND_MAX) return null
  return command
}

/** 校验一段配置补丁，返回错误字段名数组。null 表示删除该字段，直接放行。 */
export function validateConfigPatch(patch) {
  const errors = []
  if (patch.region != null && !validRegion(patch.region)) errors.push('region')
  if (patch.instanceId != null && !validInstanceId(patch.instanceId)) errors.push('instanceId')
  if (patch.serverDir != null && !validServerDir(patch.serverDir)) errors.push('serverDir')
  if (patch.accessKeyId != null) {
    if (typeof patch.accessKeyId !== 'string' || !patch.accessKeyId || patch.accessKeyId.length > 128) {
      errors.push('accessKeyId')
    }
  }
  if (patch.accessKeySecret != null) {
    if (typeof patch.accessKeySecret !== 'string' || !patch.accessKeySecret || patch.accessKeySecret.length > 256) {
      errors.push('accessKeySecret')
    }
  }
  return errors
}
