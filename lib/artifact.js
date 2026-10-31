/**
 * 制品打包与分块。
 *
 * 复杂任务不再把整个项目塞进一条命令：先把本地文件/目录打成 tar.gz，
 * 再按厂商安全块大小分块上传，最后在服务器上校验 sha256、解压、运行入口。
 */

import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import * as tar from 'tar'

/** 制品硬上限；再大建议用 OSS/COS/S3。 */
export const ARTIFACT_MAX_BYTES = 20 * 1024 * 1024

const EXCLUDED = /(^|\/)(\.git|node_modules|\.DS_Store)(\/|$)/

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * 把文件或目录打成 tar.gz。
 * 返回的 cleanup() 必须在 finally 里调用，删除临时目录。
 */
export async function packArtifact(sourcePath) {
  if (typeof sourcePath !== 'string' || !sourcePath.trim()) throw new Error('sourcePath 不能为空')
  const abs = resolve(sourcePath)
  let stat
  try {
    stat = statSync(abs)
  } catch {
    throw new Error(`本地路径不存在：${sourcePath}`)
  }
  if (!stat.isDirectory() && !stat.isFile()) throw new Error('sourcePath 必须是文件或目录')

  const tmpDir = mkdtempSync(join(tmpdir(), 'dsh-ra-artifact-'))
  const archive = join(tmpDir, 'artifact.tgz')
  const cwd = stat.isDirectory() ? abs : dirname(abs)
  const entries = stat.isDirectory() ? ['.'] : [basename(abs)]

  await tar.create(
    {
      gzip: true,
      cwd,
      file: archive,
      portable: true,
      filter: (path) => !EXCLUDED.test(path),
    },
    entries,
  )

  const bytes = readFileSync(archive)
  if (bytes.length > ARTIFACT_MAX_BYTES) {
    rmSync(tmpDir, { recursive: true, force: true })
    throw new Error(`制品超过 ${Math.round(ARTIFACT_MAX_BYTES / 1024 / 1024)} MB 上限，请改用对象存储`)
  }

  return {
    bytes,
    size: bytes.length,
    sha256: sha256Hex(bytes),
    name: basename(abs),
    isDirectory: stat.isDirectory(),
    cleanup: () => rmSync(tmpDir, { recursive: true, force: true }),
  }
}

/** 默认入口：单文件用 bash 执行；目录必须显式给 entry。 */
export function defaultEntry(pack) {
  if (pack.isDirectory) return null
  const name = "'" + pack.name.replace(/'/g, `'\\''`) + "'"
  return `bash ${name}`
}

/** 按指定字节数切块。 */
export function* chunks(bytes, chunkSize) {
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    yield bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length))
  }
}

/** 人类可读大小。 */
export function formatBytes(value) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(2)} MB`
}
