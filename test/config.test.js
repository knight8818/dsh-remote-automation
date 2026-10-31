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

const { configPatchErrors, loadConfig, saveConfig, publicConfig, configPath } = await import('../lib/config.js')

test('file config is read', () => {
  const { configured, config } = loadConfig()
  assert.equal(configured, true)
  assert.equal(config.region, 'cn-hangzhou')
  assert.equal(config.accessKeyId, 'LTAIfile')
  assert.equal(config.serverDir, '/opt/automation')
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
  const saved = JSON.parse(readFileSync(configPath(), 'utf8'))
  saveConfig({ accessKeySecret: null })
  const result = loadConfig()
  assert.equal(result.configured, false)
  assert.ok(result.missing.includes('accessKeySecret'))
  saveConfig({ accessKeySecret: saved.accessKeySecret })
  assert.equal(loadConfig().configured, true)
})

test('invalid values are reported instead of silently used', () => {
  saveConfig({ region: 'not a region' })
  const result = loadConfig()
  assert.equal(result.configured, false)
  assert.deepEqual(result.invalid, ['region'])
  saveConfig({ region: 'cn-hangzhou' })
  assert.deepEqual(loadConfig().invalid, [])
})

test('publicConfig masks the secret', () => {
  const pub = publicConfig()
  assert.equal(pub.accessKeyIdMasked, 'LTAI****file')
  assert.equal(JSON.stringify(pub).includes('file-secret'), false)
})

test('saveConfig ignores unknown keys and empty strings', () => {
  saveConfig({ evilKey: 'x', region: '' })
  const saved = JSON.parse(readFileSync(configPath(), 'utf8'))
  assert.equal('evilKey' in saved, false)
  assert.equal(saved.region, 'cn-hangzhou')
})

test('configPatchErrors rejects malformed session fields', () => {
  assert.deepEqual(configPatchErrors({ region: 'cn-shenzhen', instanceId: 'i-abc123' }), [])
  assert.deepEqual(configPatchErrors({ region: 'cn shenzhen' }), ['region'])
  assert.deepEqual(configPatchErrors({ instanceId: 'abc' }), ['instanceId'])
  assert.deepEqual(configPatchErrors({ serverDir: 'relative/dir' }), ['serverDir'])
  assert.deepEqual(configPatchErrors({ serverDir: '/opt/../etc' }), ['serverDir'])
  assert.deepEqual(configPatchErrors({ region: null }), [])
})
