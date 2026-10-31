import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'dsh-ra-'))
process.env.DSH_HOME = home
mkdirSync(join(home, 'remote-automation'), { recursive: true })
writeFileSync(
  join(home, 'remote-automation', 'config.json'),
  JSON.stringify({
    accessKeyId: 'LTAIfile',
    accessKeySecret: 'file-secret',
    region: 'cn-hangzhou',
    instanceId: 'i-file',
  }),
)

const { loadConfig, saveConfig, publicConfig } = await import('../lib/config.js')

test('file config is read', () => {
  const { configured, config } = loadConfig()
  assert.equal(configured, true)
  assert.equal(config.region, 'cn-hangzhou')
  assert.equal(config.accessKeyId, 'LTAIfile')
})

test('env overrides file', () => {
  process.env.DSH_RA_REGION = 'cn-shenzhen'
  process.env.DSH_RA_INSTANCE_ID = 'i-env'
  const { config } = loadConfig()
  assert.equal(config.region, 'cn-shenzhen')
  assert.equal(config.instanceId, 'i-env')
  delete process.env.DSH_RA_REGION
  delete process.env.DSH_RA_INSTANCE_ID
})

test('missing fields are reported', () => {
  const saved = JSON.parse(readFileSync(join(home, 'remote-automation', 'config.json'), 'utf8'))
  saveConfig({ accessKeySecret: null })
  const result = loadConfig()
  assert.equal(result.configured, false)
  assert.ok(result.missing.includes('accessKeySecret'))
  saveConfig({ accessKeySecret: saved.accessKeySecret })
})

test('publicConfig masks the secret', () => {
  const pub = publicConfig()
  assert.equal(pub.accessKeyIdMasked, 'LTAI****file')
  assert.equal(JSON.stringify(pub).includes('file-secret'), false)
})
